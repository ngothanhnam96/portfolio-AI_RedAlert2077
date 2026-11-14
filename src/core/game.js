/**
 * The simulation. Pure and deterministic: the state after N ticks depends only on the
 * options (seed, size, …) and the commands issued between ticks. No DOM, no Math.random.
 *
 * Coordinates are in tiles (floats); tile (x, y) spans [x, x+1). Structures sit on whole tiles.
 */

import { generateMap } from "./mapgen.js";
import { findPath, smoothPath } from "./pathfind.js";
import { mulberry32 } from "./rng.js";
import {
  BUILD_RADIUS, BUILDINGS, DT, LOW_POWER_SPEED, MAX_PRODUCERS, MAX_QUEUE, ORE_BALE, ORE_REGROW, PRODUCER_BONUS, SELL_REFUND,
  START_CREDITS, START_UNITS, TICK_RATE, UNITS, damageFor, isUnitType,
} from "./rules.js";

const VISION_EVERY = 4; // ticks
const ACQUIRE_EVERY = 5; // ticks
const REPATH_TARGET = 30; // ticks between re-paths when chasing a moving target
const BUCKET = 4; // spatial hash cell, tiles
const PLAYER_COLORS = ["blue", "red"];

let circleCache = new Map();
function circle(radius) {
  if (!circleCache.has(radius)) {
    const offsets = [];
    const r = Math.ceil(radius);
    for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) if (x * x + y * y <= radius * radius) offsets.push([x, y]);
    circleCache.set(radius, offsets);
  }
  return circleCache.get(radius);
}

export class Game {
  /**
   * @param {object} options
   * @param {number} options.seed map + AI seed
   * @param {number} options.size map width/height in tiles
   * @param {number} options.credits starting credits
   * @param {(null|((game: Game, id: number) => {think(): void}))[]} options.controllers
   *        per player: null for a human, or a factory returning an AI controller
   */
  constructor({ seed = 1, size = 48, credits = START_CREDITS, controllers = [null, null], startUnits = START_UNITS, map = null, bases = true } = {}) {
    const generated = map ?? generateMap({ seed, size });
    this.map = generated.map;
    this.starts = generated.starts;
    this.seed = seed;
    this.tick = 0;
    this.rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    this.entities = new Map();
    this.nextId = 1;
    this.projectiles = [];
    this.events = [];
    this.winner = null;
    this.over = false;
    this.buckets = new Map();

    const tiles = this.map.width * this.map.height;
    this.players = this.starts.map((start, id) => ({
      id,
      color: PLAYER_COLORS[id],
      credits,
      start,
      power: { made: 0, used: 0 },
      structure: null, // { type, progress, total } being built
      ready: null, // structure type waiting to be placed
      queues: { infantry: [], vehicle: [] },
      rally: {}, // building id → { x, y }
      visible: new Uint8Array(tiles),
      explored: new Uint8Array(tiles),
      defeated: false,
      lastAttacked: null, // { tick, x, y }
      stats: { built: 0, lost: 0, killed: 0, harvested: 0, structures: 0 },
    }));

    for (const player of this.players) {
      if (!bases) continue;
      this.#addBuilding(player.id, "hq", player.start.x - 1, player.start.y - 1);
      startUnits.forEach((type, i) => {
        const angle = (i / startUnits.length) * Math.PI * 2 + (player.id ? Math.PI : 0);
        const spot = this.freeSpotNear(player.start.x + 0.5 + Math.cos(angle) * 3, player.start.y + 0.5 + Math.sin(angle) * 3);
        this.#addUnit(player.id, type, spot.x, spot.y);
      });
    }
    this.#updatePower();
    this.#updateVision();
    this.controllers = controllers.map((make, id) => (make ? make(this, id) : null));
  }

  // Queries ----------------------------------------------------------------------------------

  get seconds() {
    return this.tick / TICK_RATE;
  }

  entity(id) {
    return this.entities.get(id) ?? null;
  }

  owned(playerId, filter = () => true) {
    const out = [];
    for (const e of this.entities.values()) if (e.owner === playerId && filter(e)) out.push(e);
    return out;
  }

  count(playerId, type) {
    let n = 0;
    for (const e of this.entities.values()) if (e.owner === playerId && e.type === type) n += 1;
    return n;
  }

  has(playerId, type) {
    for (const e of this.entities.values()) if (e.owner === playerId && e.type === type) return true;
    return false;
  }

  lowPower(playerId) {
    const { made, used } = this.players[playerId].power;
    return used > made;
  }

  hasRadar(playerId) {
    return this.has(playerId, "radar") && !this.lowPower(playerId);
  }

  isVisible(playerId, x, y) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return this.map.inside(tx, ty) && this.players[playerId].visible[this.map.index(tx, ty)] === 1;
  }

  /** Can `playerId` see entity `e` right now? (Structures stay known once explored.) */
  canSee(playerId, e) {
    if (e.owner === playerId) return true;
    if (e.kind === "building") {
      for (let y = e.ty; y < e.ty + e.h; y += 1) for (let x = e.tx; x < e.tx + e.w; x += 1) if (this.players[playerId].visible[this.map.index(x, y)]) return true;
      return false;
    }
    return this.isVisible(playerId, e.x, e.y);
  }

  prereqsMet(playerId, type) {
    const rule = BUILDINGS[type] ?? UNITS[type];
    return rule.prereq.every((p) => this.has(playerId, p));
  }

  /** Why `playerId` cannot start building `type` now, or null if it can. */
  whyNot(playerId, type) {
    const player = this.players[playerId];
    const rule = BUILDINGS[type] ?? UNITS[type];
    if (!rule) return "unknown";
    if (rule.buildable === false) return "unbuildable";
    if (!this.prereqsMet(playerId, type)) return "prereq";
    if (player.credits < rule.cost) return "credits";
    if (BUILDINGS[type]) {
      if (!this.has(playerId, "hq")) return "no-hq";
      if (player.structure || player.ready) return "busy";
    } else if (player.queues[rule.category].length >= MAX_QUEUE) return "queue-full";
    return null;
  }

  /** Is the footprint of `type` with top-left (tx, ty) a legal spot for `playerId`? */
  canPlace(playerId, type, tx, ty) {
    const rule = BUILDINGS[type];
    if (!rule) return false;
    for (let y = ty; y < ty + rule.h; y += 1) for (let x = tx; x < tx + rule.w; x += 1) if (!this.map.buildable(x, y)) return false;
    // No units in the way.
    for (const e of this.entities.values()) {
      if (e.kind === "unit" && e.x + e.radius > tx && e.x - e.radius < tx + rule.w && e.y + e.radius > ty && e.y - e.radius < ty + rule.h) return false;
    }
    // Within the build radius of an own structure, and seen by the builder.
    let near = false;
    for (const e of this.entities.values()) {
      if (e.owner !== playerId || e.kind !== "building") continue;
      const gapX = Math.max(e.tx - (tx + rule.w), tx - (e.tx + e.w), 0);
      const gapY = Math.max(e.ty - (ty + rule.h), ty - (e.ty + e.h), 0);
      if (Math.max(gapX, gapY) <= BUILD_RADIUS) {
        near = true;
        break;
      }
    }
    return near;
  }

  /** Nearest passable tile centre to (x, y) (spiral search). */
  freeSpotNear(x, y, avoidUnits = true) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let r = 0; r < 12; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (!this.map.passable(tx, ty)) continue;
          if (avoidUnits && this.#unitNearTile(tx, ty)) continue;
          return { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    return { x: cx + 0.5, y: cy + 0.5 };
  }

  /** Distance from point to an entity's edge. */
  distanceTo(x, y, e) {
    if (e.kind === "building") {
      const dx = Math.max(e.tx - x, 0, x - (e.tx + e.w));
      const dy = Math.max(e.ty - y, 0, y - (e.ty + e.h));
      return Math.hypot(dx, dy);
    }
    return Math.max(0, Math.hypot(e.x - x, e.y - y) - e.radius);
  }

  // Scenario API (tests, sandbox): place things directly, bypassing cost and production.

  spawn(owner, type, x, y) {
    const unit = this.#addUnit(owner, type, x, y);
    this.#rebuildBuckets();
    return unit;
  }

  spawnBuilding(owner, type, tx, ty) {
    const building = this.#addBuilding(owner, type, tx, ty);
    this.#updatePower();
    return building;
  }

  /** Recomputes fog of war now (normally every few ticks). */
  refreshVision() {
    this.#updateVision();
  }

  takeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  // Commands ---------------------------------------------------------------------------------
  // Every player action goes through command(); the AI uses the same entry point.

  command(playerId, cmd) {
    if (this.over || this.players[playerId].defeated) return { ok: false, reason: "over" };
    const handler = {
      move: () => this.#cmdMove(playerId, cmd),
      attack: () => this.#cmdAttack(playerId, cmd),
      stop: () => this.#cmdStop(playerId, cmd),
      hold: () => this.#cmdHold(playerId, cmd),
      harvest: () => this.#cmdHarvest(playerId, cmd),
      build: () => this.#cmdBuild(playerId, cmd),
      cancel: () => this.#cmdCancel(playerId, cmd),
      place: () => this.#cmdPlace(playerId, cmd),
      sell: () => this.#cmdSell(playerId, cmd),
      rally: () => this.#cmdRally(playerId, cmd),
    }[cmd.type];
    if (!handler) return { ok: false, reason: "unknown" };
    return handler();
  }

  #myUnits(playerId, ids) {
    return (ids ?? []).map((id) => this.entities.get(id)).filter((e) => e && e.owner === playerId && e.kind === "unit");
  }

  #cmdMove(playerId, { ids, x, y, attackMove = false }) {
    const units = this.#myUnits(playerId, ids);
    if (!units.length || !Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: "no-units" };
    const slots = this.#formation(units, x, y);
    units.forEach((u, i) => {
      u.order = { type: "move", x: slots[i].x, y: slots[i].y, attackMove };
      u.targetId = 0;
      u.harvest = null;
      this.#pathTo(u, slots[i].x, slots[i].y);
    });
    return { ok: true };
  }

  #cmdAttack(playerId, { ids, target }) {
    const victim = this.entities.get(target);
    if (!victim || victim.owner === playerId || !this.canSee(playerId, victim)) return { ok: false, reason: "target" };
    const units = this.#myUnits(playerId, ids).filter((u) => UNITS[u.type].weapon);
    if (!units.length) return { ok: false, reason: "no-units" };
    for (const u of units) {
      u.order = { type: "attack", target };
      u.targetId = target;
      u.harvest = null;
      u.repathAt = 0;
    }
    return { ok: true };
  }

  #cmdStop(playerId, { ids }) {
    for (const u of this.#myUnits(playerId, ids)) this.#idle(u);
    return { ok: true };
  }

  /** Hold position: shoot what is in range but never move (fire: false = hold fire too). */
  #cmdHold(playerId, { ids, fire = true }) {
    const units = this.#myUnits(playerId, ids);
    if (!units.length) return { ok: false, reason: "no-units" };
    for (const u of units) {
      this.#idle(u);
      u.order = { type: "hold", fire };
    }
    return { ok: true };
  }

  #cmdHarvest(playerId, { ids, x, y }) {
    const units = this.#myUnits(playerId, ids).filter((u) => u.type === "harvester");
    if (!units.length) return { ok: false, reason: "no-units" };
    for (const u of units) {
      u.order = { type: "harvest" };
      u.harvest = { state: "seek", prefer: Number.isFinite(x) ? { x: Math.floor(x), y: Math.floor(y) } : null, timer: 0 };
      u.path = [];
    }
    return { ok: true };
  }

  #cmdBuild(playerId, { item }) {
    const why = this.whyNot(playerId, item);
    if (why) return { ok: false, reason: why };
    const player = this.players[playerId];
    const rule = BUILDINGS[item] ?? UNITS[item];
    player.credits -= rule.cost;
    const entry = { type: item, progress: 0, total: Math.max(1, Math.round(rule.time * TICK_RATE)) };
    if (BUILDINGS[item]) player.structure = entry;
    else player.queues[rule.category].push(entry);
    return { ok: true };
  }

  #cmdCancel(playerId, { item, category }) {
    const player = this.players[playerId];
    if (category === "structure") {
      const type = player.ready ?? player.structure?.type;
      if (!type) return { ok: false, reason: "empty" };
      player.credits += BUILDINGS[type].cost;
      player.ready = null;
      player.structure = null;
      return { ok: true };
    }
    const queue = player.queues[category];
    if (!queue) return { ok: false, reason: "unknown" };
    // Cancel the last queued entry of that type (the one least far along).
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].type === item) {
        player.credits += UNITS[item].cost;
        queue.splice(i, 1);
        return { ok: true };
      }
    }
    return { ok: false, reason: "empty" };
  }

  #cmdPlace(playerId, { tx, ty }) {
    const player = this.players[playerId];
    if (!player.ready) return { ok: false, reason: "nothing-ready" };
    if (!this.canPlace(playerId, player.ready, tx, ty)) return { ok: false, reason: "blocked" };
    const building = this.#addBuilding(playerId, player.ready, tx, ty);
    player.ready = null;
    player.stats.structures += 1;
    this.events.push({ type: "placed", owner: playerId, id: building.id, x: building.x, y: building.y });
    const free = BUILDINGS[building.type].freeUnit;
    if (free) {
      const dock = BUILDINGS[building.type].dock;
      const spot = this.freeSpotNear(tx + dock.x + 0.5, ty + dock.y + 0.5, false);
      const unit = this.#addUnit(playerId, free, spot.x, spot.y);
      unit.order = { type: "harvest" };
      unit.harvest = { state: "seek", prefer: null, timer: 0 };
    }
    this.#updatePower();
    return { ok: true, id: building.id };
  }

  #cmdSell(playerId, { id }) {
    const b = this.entities.get(id);
    if (!b || b.owner !== playerId || b.kind !== "building" || b.type === "hq") return { ok: false, reason: "target" };
    this.players[playerId].credits += Math.floor(BUILDINGS[b.type].cost * SELL_REFUND * (b.hp / b.maxHp));
    this.events.push({ type: "sold", owner: playerId, x: b.x, y: b.y });
    this.#remove(b);
    this.#updatePower();
    return { ok: true };
  }

  #cmdRally(playerId, { id, x, y }) {
    const b = this.entities.get(id);
    if (!b || b.owner !== playerId || !BUILDINGS[b.type]?.produces) return { ok: false, reason: "target" };
    this.players[playerId].rally[id] = { x, y };
    return { ok: true };
  }

  // Simulation step --------------------------------------------------------------------------

  step() {
    if (this.over) return;
    this.tick += 1;
    this.#rebuildBuckets();
    for (const player of this.players) if (!player.defeated) this.#produce(player);
    // Alternate the processing order every tick so neither player always acts first.
    const order = this.tick % 2 ? [1, 0] : [0, 1];
    for (const id of order) this.controllers[id]?.think();
    const list = [...this.entities.values()];
    if (this.tick % 2) list.reverse();
    for (const e of list) {
      if (e.hp <= 0) continue;
      if (e.kind === "unit") this.#updateUnit(e);
      else this.#updateBuilding(e);
    }
    this.#updateProjectiles();
    if (this.tick % (ORE_REGROW.every * TICK_RATE) === 0) this.#regrowOre();
    this.#reap();
    if (this.tick % VISION_EVERY === 0) this.#updateVision();
    this.#checkVictory();
  }

  run(ticks) {
    for (let i = 0; i < ticks && !this.over; i += 1) this.step();
  }

  // Production -------------------------------------------------------------------------------

  #produce(player) {
    const speed = this.lowPower(player.id) ? LOW_POWER_SPEED : 1;
    if (player.structure) {
      if (!this.has(player.id, "hq")) {
        // Lost the HQ: refund and stop.
        player.credits += BUILDINGS[player.structure.type].cost;
        player.structure = null;
      } else {
        player.structure.progress += speed;
        if (player.structure.progress >= player.structure.total) {
          player.ready = player.structure.type;
          player.structure = null;
          this.events.push({ type: "ready", owner: player.id, item: player.ready });
        }
      }
    }
    for (const category of ["infantry", "vehicle"]) {
      const queue = player.queues[category];
      if (!queue.length) continue;
      const producer = this.#producer(player.id, category);
      if (!producer) continue; // paused until a producer exists again
      const head = queue[0];
      const producers = Math.min(MAX_PRODUCERS, this.count(player.id, category === "infantry" ? "barracks" : "factory"));
      head.progress = Math.min(head.total, head.progress + speed * (1 + PRODUCER_BONUS * (producers - 1)));
      if (head.progress < head.total) continue;
      const spot = this.#exitSpot(producer);
      if (!spot) continue;
      queue.shift();
      const unit = this.#addUnit(player.id, head.type, spot.x, spot.y);
      player.stats.built += 1;
      this.events.push({ type: "unit-ready", owner: player.id, id: unit.id, item: head.type });
      if (unit.type === "harvester") {
        unit.order = { type: "harvest" };
        unit.harvest = { state: "seek", prefer: null, timer: 0 };
      } else {
        const rally = player.rally[producer.id];
        if (rally) this.#cmdMove(player.id, { ids: [unit.id], x: rally.x, y: rally.y });
      }
    }
  }

  #producer(playerId, category) {
    const type = category === "infantry" ? "barracks" : "factory";
    let best = null;
    for (const e of this.entities.values()) if (e.owner === playerId && e.type === type && (!best || e.id < best.id)) best = e;
    return best;
  }

  #exitSpot(building) {
    return this.freeSpotNear(building.tx + building.w / 2, building.ty + building.h + 0.5);
  }

  #updatePower() {
    for (const player of this.players) {
      player.power.made = 0;
      player.power.used = 0;
    }
    for (const e of this.entities.values()) {
      if (e.kind !== "building") continue;
      const p = BUILDINGS[e.type].power;
      if (p > 0) this.players[e.owner].power.made += p;
      else this.players[e.owner].power.used -= p;
    }
  }

  // Entities ---------------------------------------------------------------------------------

  #addBuilding(owner, type, tx, ty) {
    const rule = BUILDINGS[type];
    const b = {
      id: this.nextId++,
      kind: "building",
      type,
      owner,
      tx,
      ty,
      w: rule.w,
      h: rule.h,
      x: tx + rule.w / 2,
      y: ty + rule.h / 2,
      hp: rule.hp,
      maxHp: rule.hp,
      sight: rule.sight,
      armor: "building",
      radius: Math.max(rule.w, rule.h) / 2,
      cooldown: 0,
      targetId: 0,
      turret: 0,
      dockBusy: 0,
    };
    this.entities.set(b.id, b);
    this.map.setBlocked(b, b.id);
    // Push out any unit standing on the new footprint (only possible for the starting HQ).
    return b;
  }

  #addUnit(owner, type, x, y) {
    const rule = UNITS[type];
    const u = {
      id: this.nextId++,
      kind: "unit",
      type,
      owner,
      x,
      y,
      angle: owner === 0 ? Math.PI / 4 : (-3 * Math.PI) / 4,
      turret: owner === 0 ? Math.PI / 4 : (-3 * Math.PI) / 4,
      hp: rule.hp,
      maxHp: rule.hp,
      sight: rule.sight,
      armor: rule.armor,
      radius: rule.radius,
      speed: rule.speed,
      order: { type: "idle" },
      path: [],
      targetId: 0,
      cooldown: 0,
      repathAt: 0,
      guard: { x, y },
      stuck: 0,
      lastProgress: { x, y, tick: this.tick },
      cargo: 0,
      harvest: null,
      idleSince: this.tick,
      moving: false,
    };
    this.entities.set(u.id, u);
    return u;
  }

  #remove(e) {
    this.entities.delete(e.id);
    if (e.kind === "building") {
      this.map.setBlocked(e, 0);
      delete this.players[e.owner].rally[e.id];
    }
  }

  #idle(u) {
    u.order = { type: "idle" };
    u.path = [];
    u.targetId = 0;
    u.harvest = null;
    u.guard = { x: u.x, y: u.y };
    u.idleSince = this.tick;
    u.moving = false;
  }

  #unitNearTile(tx, ty) {
    for (const e of this.#nearby(tx + 0.5, ty + 0.5, 1.2)) if (e.kind === "unit" && Math.abs(e.x - tx - 0.5) < 0.6 && Math.abs(e.y - ty - 0.5) < 0.6) return true;
    return false;
  }

  // Spatial hash -----------------------------------------------------------------------------

  #rebuildBuckets() {
    this.buckets.clear();
    for (const e of this.entities.values()) {
      if (e.kind !== "unit") continue;
      const key = Math.floor(e.x / BUCKET) * 1024 + Math.floor(e.y / BUCKET);
      let bucket = this.buckets.get(key);
      if (!bucket) this.buckets.set(key, (bucket = []));
      bucket.push(e);
    }
  }

  /** Units within roughly `radius` of (x, y), from the spatial hash (may include a few more). */
  #nearby(x, y, radius) {
    const out = [];
    const x0 = Math.floor((x - radius) / BUCKET);
    const x1 = Math.floor((x + radius) / BUCKET);
    const y0 = Math.floor((y - radius) / BUCKET);
    const y1 = Math.floor((y + radius) / BUCKET);
    for (let bx = x0; bx <= x1; bx += 1) {
      for (let by = y0; by <= y1; by += 1) {
        const bucket = this.buckets.get(bx * 1024 + by);
        if (bucket) for (const e of bucket) out.push(e);
      }
    }
    return out;
  }

  /** Closest visible enemy (unit or structure) within `range` of entity `e`. */
  #findTarget(e, range, weapon) {
    let best = null;
    let bestScore = Infinity;
    const consider = (o) => {
      if (o.owner === e.owner || o.hp <= 0) return;
      if (!this.canSee(e.owner, o)) return;
      const d = this.distanceTo(e.x, e.y, o);
      if (d > range || (weapon.minRange && d < weapon.minRange)) return;
      // Prefer things that shoot back, then the closest.
      const threat = o.kind === "unit" ? (UNITS[o.type].weapon ? 0 : 2) : BUILDINGS[o.type].weapon ? 1 : 3;
      const score = threat * 100 + d;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    };
    for (const o of this.#nearby(e.x, e.y, range + 1)) consider(o);
    for (const o of this.entities.values()) if (o.kind === "building" && Math.abs(o.x - e.x) < range + 3 && Math.abs(o.y - e.y) < range + 3) consider(o);
    return best;
  }

  // Units ------------------------------------------------------------------------------------

  #pathTo(u, x, y) {
    const raw = findPath(this.map, Math.floor(u.x), Math.floor(u.y), Math.floor(x), Math.floor(y));
    const path = raw ? smoothPath(this.map, Math.floor(u.x), Math.floor(u.y), raw) : [];
    u.path = path.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
    // Finish at the exact destination when it is in the goal tile.
    const last = u.path.at(-1);
    if (last && Math.floor(last.x) === Math.floor(x) && Math.floor(last.y) === Math.floor(y)) u.path[u.path.length - 1] = { x, y };
    if (!u.path.length && this.map.passable(Math.floor(x), Math.floor(y))) u.path = [{ x, y }];
    u.stuck = 0;
    u.lastProgress = { x: u.x, y: u.y, tick: this.tick };
  }

  /** Destination slots so a group spreads over nearby free tiles instead of one point. */
  #formation(units, x, y) {
    if (units.length === 1) return [{ x, y }];
    const slots = [];
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let r = 0; r < 10 && slots.length < units.length; r += 1) {
      for (let dy = -r; dy <= r && slots.length < units.length; dy += 1) {
        for (let dx = -r; dx <= r && slots.length < units.length; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.map.passable(cx + dx, cy + dy)) slots.push({ x: cx + dx + 0.5, y: cy + dy + 0.5 });
        }
      }
    }
    while (slots.length < units.length) slots.push({ x, y });
    // Give each unit the slot that best matches its position in the group (sorted sweep).
    const order = units.map((u, i) => ({ i, key: u.x + u.y * 0.37 })).sort((a, b) => a.key - b.key);
    const slotOrder = slots.map((s, i) => ({ i, key: s.x + s.y * 0.37 })).sort((a, b) => a.key - b.key);
    const result = new Array(units.length);
    order.forEach((o, k) => {
      result[o.i] = slots[slotOrder[k].i];
    });
    return result;
  }

  #updateUnit(u) {
    const rule = UNITS[u.type];
    if (u.cooldown > 0) u.cooldown -= DT;
    u.moving = false;

    if (u.type === "harvester") {
      this.#updateHarvester(u);
    } else if (u.order.type === "attack") {
      const target = this.entities.get(u.order.target);
      if (!target || target.hp <= 0 || !this.canSee(u.owner, target)) this.#idle(u);
      else this.#engage(u, target, true);
    } else if (u.order.type === "move") {
      let engaged = false;
      if (u.order.attackMove && rule.weapon) {
        let target = u.targetId ? this.entities.get(u.targetId) : null;
        if (target && (target.hp <= 0 || !this.canSee(u.owner, target) || this.distanceTo(u.x, u.y, target) > rule.weapon.range + 3)) target = null;
        if (!target && (this.tick + u.id) % ACQUIRE_EVERY === 0) target = this.#findTarget(u, rule.weapon.range + 2, rule.weapon);
        u.targetId = target ? target.id : 0;
        if (target) {
          engaged = true;
          this.#engage(u, target, true);
          u.resumePath = true;
        }
      }
      if (!engaged) {
        if (u.resumePath) {
          u.resumePath = false;
          this.#pathTo(u, u.order.x, u.order.y);
        }
        if (this.#followPath(u)) this.#idle(u);
      }
    } else if (u.order.type === "hold") {
      if (rule.weapon && u.order.fire !== false) {
        let target = u.targetId ? this.entities.get(u.targetId) : null;
        if (target && (target.hp <= 0 || !this.canSee(u.owner, target) || this.distanceTo(u.x, u.y, target) > rule.weapon.range)) target = null;
        if (!target && (this.tick + u.id) % ACQUIRE_EVERY === 0) target = this.#findTarget(u, rule.weapon.range, rule.weapon);
        u.targetId = target ? target.id : 0;
        if (target) this.#engage(u, target, false);
      }
    } else {
      // Idle: shoot what comes in range, chase a little, then return to the guard spot.
      if (rule.weapon) {
        let target = u.targetId ? this.entities.get(u.targetId) : null;
        const leash = rule.weapon.range + 2;
        if (target && (target.hp <= 0 || !this.canSee(u.owner, target) || this.distanceTo(u.guard.x, u.guard.y, target) > leash + 2)) target = null;
        if (!target && (this.tick + u.id) % ACQUIRE_EVERY === 0) target = this.#findTarget(u, leash, rule.weapon);
        u.targetId = target ? target.id : 0;
        if (target) this.#engage(u, target, true);
        else if (Math.hypot(u.x - u.guard.x, u.y - u.guard.y) > 1.5) {
          if (!u.path.length) this.#pathTo(u, u.guard.x, u.guard.y);
          if (this.#followPath(u)) u.path = [];
        }
      }
    }
    this.#separate(u);
  }

  /** Fire at the target if in range, otherwise move toward it. */
  #engage(u, target, chase) {
    const weapon = UNITS[u.type].weapon;
    const d = this.distanceTo(u.x, u.y, target);
    const aim = Math.atan2(target.y - u.y, target.x - u.x);
    if (d <= weapon.range && !(weapon.minRange && d < weapon.minRange)) {
      u.path = [];
      if (UNITS[u.type].turret) u.turret = aim;
      else u.angle = aim;
      if (UNITS[u.type].turret) u.angle = turnToward(u.angle, aim, 0.08);
      if (u.cooldown <= 0) {
        this.#fire(u, target, weapon);
        u.cooldown = weapon.reload;
      }
      return;
    }
    if (!chase) return;
    if (weapon.minRange && d < weapon.minRange) {
      // Too close for artillery: back off.
      const away = this.freeSpotNear(u.x - Math.cos(aim) * 3, u.y - Math.sin(aim) * 3);
      if (!u.path.length) this.#pathTo(u, away.x, away.y);
    } else if (!u.path.length || this.tick >= u.repathAt) {
      this.#pathTo(u, target.x, target.y);
      u.repathAt = this.tick + REPATH_TARGET;
    }
    this.#followPath(u);
  }

  /** Moves along the path. Returns true when the destination is reached (or given up). */
  #followPath(u) {
    if (!u.path.length) return true;
    const next = u.path[0];
    const dx = next.x - u.x;
    const dy = next.y - u.y;
    const dist = Math.hypot(dx, dy);
    const step = u.speed * DT;
    const last = u.path.length === 1;
    if (dist <= Math.max(step, last ? 0.12 : 0.35)) {
      if (last) {
        u.x = next.x;
        u.y = next.y;
      }
      u.path.shift();
      if (!u.path.length) return true;
      return false;
    }
    const angle = Math.atan2(dy, dx);
    u.angle = turnToward(u.angle, angle, 0.25);
    if (!UNITS[u.type].turret || !u.targetId) u.turret = u.angle;
    this.#tryMove(u, (dx / dist) * step, (dy / dist) * step);
    u.moving = true;

    // Stuck detection: little progress for a second → re-path; three times → give up.
    if (this.tick - u.lastProgress.tick >= TICK_RATE) {
      const progressed = Math.hypot(u.x - u.lastProgress.x, u.y - u.lastProgress.y);
      u.lastProgress = { x: u.x, y: u.y, tick: this.tick };
      if (progressed < u.speed * 0.25) {
        u.stuck += 1;
        const goal = u.path.at(-1);
        if (u.stuck >= 3 || Math.hypot(goal.x - u.x, goal.y - u.y) < 1.6) {
          u.path = [];
          return true;
        }
        const tries = u.stuck;
        this.#pathTo(u, goal.x, goal.y);
        u.stuck = tries; // keep the count across re-paths
      } else u.stuck = 0;
    }
    return false;
  }

  #tryMove(u, dx, dy) {
    const fits = (x, y) => {
      const r = Math.min(u.radius, 0.45);
      return (
        this.map.passable(Math.floor(x - r), Math.floor(y - r)) &&
        this.map.passable(Math.floor(x + r), Math.floor(y - r)) &&
        this.map.passable(Math.floor(x - r), Math.floor(y + r)) &&
        this.map.passable(Math.floor(x + r), Math.floor(y + r))
      );
    };
    const tile = (x, y) => this.map.passable(Math.floor(x), Math.floor(y));
    const ok = (x, y) => fits(x, y) || (tile(x, y) && !fits(u.x, u.y)); // allow escaping a tight spot
    if (ok(u.x + dx, u.y + dy)) {
      u.x += dx;
      u.y += dy;
    } else if (ok(u.x + dx, u.y)) u.x += dx;
    else if (ok(u.x, u.y + dy)) u.y += dy;
  }

  /** Soft separation so units do not stack on one point. */
  #separate(u) {
    let px = 0;
    let py = 0;
    for (const o of this.#nearby(u.x, u.y, 1.2)) {
      if (o === u || o.hp <= 0) continue;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      const min = u.radius + o.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.001;
      const push = (min - d) * (o.moving && !u.moving ? 0.6 : 0.35);
      // Deterministic tie-break for exactly overlapping units.
      const nx = d2 === 0 ? (u.id < o.id ? 1 : -1) : dx / d;
      const ny = d2 === 0 ? 0 : dy / d;
      px += nx * push;
      py += ny * push;
    }
    if (px || py) {
      const cap = 0.08;
      const len = Math.hypot(px, py);
      if (len > cap) {
        px = (px / len) * cap;
        py = (py / len) * cap;
      }
      this.#tryMove(u, px, py);
    }
  }

  // Harvesting -------------------------------------------------------------------------------

  #updateHarvester(u) {
    const rule = UNITS.harvester;
    if (u.order.type === "move") {
      if (this.#followPath(u)) this.#idle(u);
      return;
    }
    if (!u.harvest) {
      // Idle harvesters go back to work after a few seconds.
      if (this.tick - u.idleSince > 5 * TICK_RATE && this.has(u.owner, "refinery")) {
        u.order = { type: "harvest" };
        u.harvest = { state: "seek", prefer: null, timer: 0 };
      }
      return;
    }
    const h = u.harvest;
    if (h.state === "seek") {
      if (u.cargo >= rule.capacity) {
        h.state = "return";
        return;
      }
      const tile = this.#findOre(u, h.prefer);
      h.prefer = null;
      if (!tile) {
        if (u.cargo > 0) h.state = "return";
        else {
          h.state = "wait";
          h.timer = 2 * TICK_RATE;
        }
        return;
      }
      h.tile = tile;
      h.state = "to-ore";
      this.#pathTo(u, tile.x + 0.5, tile.y + 0.5);
    } else if (h.state === "wait") {
      if (--h.timer <= 0) h.state = "seek";
    } else if (h.state === "to-ore") {
      if (this.#followPath(u)) {
        const here = { x: Math.floor(u.x), y: Math.floor(u.y) };
        if (this.map.oreAt(here.x, here.y) > 0) {
          h.tile = here;
          h.state = "gather";
          h.timer = Math.round(rule.gather * TICK_RATE);
        } else h.state = "seek";
      }
    } else if (h.state === "gather") {
      if (--h.timer > 0) return;
      const i = this.map.index(h.tile.x, h.tile.y);
      const take = Math.min(ORE_BALE, this.map.ore[i], rule.capacity - u.cargo);
      this.map.ore[i] -= take;
      u.cargo += take;
      h.timer = Math.round(rule.gather * TICK_RATE);
      if (u.cargo >= rule.capacity) h.state = "return";
      else if (this.map.ore[i] === 0) h.state = "seek";
    } else if (h.state === "return") {
      const refinery = this.#nearestRefinery(u);
      if (!refinery) {
        h.state = "wait";
        h.timer = 3 * TICK_RATE;
        return;
      }
      h.refinery = refinery.id;
      h.state = "to-dock";
      const dock = this.#dock(refinery);
      this.#pathTo(u, dock.x, dock.y);
    } else if (h.state === "to-dock") {
      const refinery = this.entities.get(h.refinery);
      if (!refinery) {
        h.state = "return";
        return;
      }
      const dock = this.#dock(refinery);
      const arrived = this.#followPath(u);
      if (Math.hypot(u.x - dock.x, u.y - dock.y) < 0.8 || (arrived && this.distanceTo(u.x, u.y, refinery) < 1.2)) {
        if (refinery.dockBusy > this.tick) return; // another harvester is unloading
        h.state = "unload";
        h.timer = Math.round(rule.unload * TICK_RATE);
        refinery.dockBusy = this.tick + h.timer;
        u.path = [];
      } else if (arrived) this.#pathTo(u, dock.x, dock.y);
    } else if (h.state === "unload") {
      if (--h.timer > 0) return;
      const player = this.players[u.owner];
      player.credits += u.cargo;
      player.stats.harvested += u.cargo;
      this.events.push({ type: "unload", owner: u.owner, amount: u.cargo, x: u.x, y: u.y });
      u.cargo = 0;
      h.state = "seek";
    }
  }

  #dock(refinery) {
    const d = BUILDINGS.refinery.dock;
    return { x: refinery.tx + d.x + 0.5, y: refinery.ty + d.y + 0.5 };
  }

  #nearestRefinery(u) {
    let best = null;
    let bestD = Infinity;
    for (const e of this.entities.values()) {
      if (e.owner !== u.owner || e.type !== "refinery") continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Nearest ore tile not already claimed by another harvester of the same owner. */
  #findOre(u, prefer) {
    const map = this.map;
    const claimed = new Set();
    for (const o of this.entities.values()) {
      if (o !== u && o.type === "harvester" && o.owner === u.owner && o.harvest?.tile && ["to-ore", "gather"].includes(o.harvest.state)) {
        claimed.add(map.index(o.harvest.tile.x, o.harvest.tile.y));
      }
    }
    const ox = prefer ? prefer.x : Math.floor(u.x);
    const oy = prefer ? prefer.y : Math.floor(u.y);
    let best = null;
    let bestD = Infinity;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const i = map.index(x, y);
        if (map.ore[i] === 0 || map.blocked[i] || claimed.has(i)) continue;
        const d = Math.hypot(x - ox, y - oy) + (prefer ? 0 : 0);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  #regrowOre() {
    const map = this.map;
    for (let i = 0; i < map.ore.length; i += 1) {
      if (map.oreMax[i] && map.ore[i] < map.oreMax[i]) map.ore[i] = Math.min(map.oreMax[i], map.ore[i] + ORE_REGROW.amount);
    }
  }

  // Structures -------------------------------------------------------------------------------

  #updateBuilding(b) {
    const weapon = BUILDINGS[b.type].weapon;
    if (!weapon) return;
    if (b.cooldown > 0) b.cooldown -= DT;
    if (this.lowPower(b.owner)) return; // offline
    let target = b.targetId ? this.entities.get(b.targetId) : null;
    if (target && (target.hp <= 0 || !this.canSee(b.owner, target) || this.distanceTo(b.x, b.y, target) > weapon.range)) target = null;
    if (!target && (this.tick + b.id) % ACQUIRE_EVERY === 0) target = this.#findTarget(b, weapon.range, weapon);
    b.targetId = target ? target.id : 0;
    if (!target) return;
    b.turret = Math.atan2(target.y - b.y, target.x - b.x);
    if (b.cooldown <= 0) {
      this.#fire(b, target, weapon);
      b.cooldown = weapon.reload;
    }
  }

  // Combat -----------------------------------------------------------------------------------

  #fire(shooter, target, weapon) {
    const angle = Math.atan2(target.y - shooter.y, target.x - shooter.x);
    const muzzle = { x: shooter.x + Math.cos(angle) * shooter.radius, y: shooter.y + Math.sin(angle) * shooter.radius };
    this.events.push({ type: "fire", owner: shooter.owner, x: muzzle.x, y: muzzle.y, tx: target.x, ty: target.y, warhead: weapon.warhead, shooter: shooter.type });
    if (!weapon.speed) {
      this.#damage(target, damageFor(weapon, target.armor), shooter.owner);
      return;
    }
    this.projectiles.push({
      owner: shooter.owner,
      x: muzzle.x,
      y: muzzle.y,
      sx: muzzle.x,
      sy: muzzle.y,
      targetId: target.id,
      tx: target.x,
      ty: target.y,
      weapon,
    });
  }

  #updateProjectiles() {
    const keep = [];
    for (const p of this.projectiles) {
      const target = this.entities.get(p.targetId);
      // Artillery shells (arc) fly to where the target was; rockets and cannon rounds track it.
      if (target && target.hp > 0 && !p.weapon.arc) {
        p.tx = target.x;
        p.ty = target.y;
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      const step = p.weapon.speed * DT;
      if (dist > step) {
        p.x += (dx / dist) * step;
        p.y += (dy / dist) * step;
        keep.push(p);
        continue;
      }
      this.events.push({ type: "impact", x: p.tx, y: p.ty, warhead: p.weapon.warhead, splash: p.weapon.splash ?? 0 });
      if (p.weapon.splash) {
        const victims = [...this.#nearby(p.tx, p.ty, p.weapon.splash + 1)];
        for (const e of this.entities.values()) if (e.kind === "building" && this.distanceTo(p.tx, p.ty, e) <= p.weapon.splash) victims.push(e);
        for (const e of victims) {
          if (e.owner === p.owner || e.hp <= 0) continue;
          const d = this.distanceTo(p.tx, p.ty, e);
          if (d > p.weapon.splash) continue;
          const falloff = 1 - 0.5 * (d / p.weapon.splash);
          this.#damage(e, damageFor(p.weapon, e.armor) * falloff, p.owner);
        }
      } else if (target && target.hp > 0) {
        this.#damage(target, damageFor(p.weapon, target.armor), p.owner);
      }
    }
    this.projectiles = keep;
  }

  #damage(target, amount, attacker) {
    if (target.hp <= 0) return;
    target.hp -= amount;
    this.players[target.owner].lastAttacked = { tick: this.tick, x: target.x, y: target.y, by: attacker, item: target.type };
    if (target.hp <= 0) {
      target.hp = 0;
      this.players[attacker].stats.killed += 1;
      this.players[target.owner].stats.lost += 1;
      this.events.push({ type: "destroyed", owner: target.owner, kind: target.kind, item: target.type, x: target.x, y: target.y, size: target.kind === "building" ? Math.max(target.w, target.h) : 1 });
    } else if (target.kind === "unit" && target.order.type === "idle" && !target.targetId && UNITS[target.type].weapon) {
      // Fight back against whatever hit us, if we can see it.
      const shooter = this.#nearestEnemyShooter(target, attacker);
      if (shooter) target.targetId = shooter.id;
    }
  }

  #nearestEnemyShooter(u, owner) {
    let best = null;
    let bestD = Infinity;
    for (const e of this.entities.values()) {
      if (e.owner !== owner || e.hp <= 0 || !this.canSee(u.owner, e)) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d < bestD && d < 12) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  #reap() {
    let powerChanged = false;
    for (const e of [...this.entities.values()]) {
      if (e.hp > 0) continue;
      if (e.kind === "building") powerChanged = true;
      this.#remove(e);
    }
    if (powerChanged) this.#updatePower();
  }

  // Vision and victory ----------------------------------------------------------------------

  #updateVision() {
    const map = this.map;
    for (const player of this.players) player.visible.fill(0);
    for (const e of this.entities.values()) {
      const player = this.players[e.owner];
      const cx = Math.floor(e.x);
      const cy = Math.floor(e.y);
      for (const [dx, dy] of circle(e.sight)) {
        const x = cx + dx;
        const y = cy + dy;
        if (!map.inside(x, y)) continue;
        const i = map.index(x, y);
        player.visible[i] = 1;
        player.explored[i] = 1;
      }
    }
  }

  #checkVictory() {
    for (const player of this.players) {
      if (player.defeated) continue;
      let any = false;
      for (const e of this.entities.values()) {
        if (e.owner === player.id) {
          any = true;
          break;
        }
      }
      if (!any) {
        player.defeated = true;
        this.events.push({ type: "defeated", owner: player.id });
      }
    }
    const alive = this.players.filter((p) => !p.defeated);
    if (alive.length <= 1) {
      this.over = true;
      this.winner = alive.length ? alive[0].id : null;
      this.events.push({ type: "game-over", winner: this.winner });
    }
  }

  // Determinism ------------------------------------------------------------------------------

  /** FNV-1a hash of everything that matters; equal hashes ⇒ identical games. */
  hash() {
    let h = 0x811c9dc5;
    const mix = (n) => {
      const v = Math.round(n * 1000) | 0;
      for (let k = 0; k < 4; k += 1) {
        h ^= (v >>> (k * 8)) & 0xff;
        h = Math.imul(h, 0x01000193);
      }
    };
    mix(this.tick);
    for (const p of this.players) {
      mix(p.credits);
      mix(p.stats.killed);
      mix(p.stats.harvested);
    }
    for (const e of this.entities.values()) {
      mix(e.id);
      mix(e.x);
      mix(e.y);
      mix(e.hp);
      mix(e.cargo ?? 0);
    }
    for (const p of this.projectiles) {
      mix(p.x);
      mix(p.y);
    }
    for (let i = 0; i < this.map.ore.length; i += 7) mix(this.map.ore[i]);
    return (h >>> 0).toString(16).padStart(8, "0");
  }
}

function turnToward(current, target, maxStep) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

export { isUnitType };
