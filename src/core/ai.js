/**
 * Skirmish AI. Plays only through game.command(), exactly like the human, and only sees what
 * its own fog of war shows, except that, like the classic skirmish AIs, it knows where the
 * enemy base is when choosing where to send an attack wave.
 *
 * Every think it: places a finished structure → keeps power positive → follows a build order
 * → keeps harvesters working → trains a mixed army → defends its base → attacks in waves that
 * grow over time. Difficulty changes how often it thinks and how much it builds.
 */

import { mulberry32 } from "./rng.js";
import { AI_LEVELS, BUILDINGS, TICK_RATE, UNITS } from "./rules.js";

export const BUILD_ORDER = [
  "power", "refinery", "barracks", "power", "factory", "refinery", "radar", "turret",
  "power", "refinery", "tech", "turret", "power", "factory", "turret", "power", "power",
];

export function aiController(level = "normal") {
  return (game, id) => new AI(game, id, level);
}

export class AI {
  constructor(game, id, level) {
    this.game = game;
    this.id = id;
    this.levelName = level;
    this.level = AI_LEVELS[level];
    this.rng = mulberry32((game.seed * 31 + id * 977 + 7) >>> 0);
    this.enemy = 1 - id;
    this.nextThink = Math.round(this.level.think * TICK_RATE) + id; // stagger the two AIs
    this.waveSize = this.level.wave;
    this.attackers = new Set();
    this.rallied = new Set();
    this.waves = 0;
    this.oreTiles = [];
    const map = game.map;
    for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) if (map.oreMax[map.index(x, y)]) this.oreTiles.push({ x, y });
  }

  get player() {
    return this.game.players[this.id];
  }

  think() {
    const game = this.game;
    if (game.tick < this.nextThink) return;
    this.nextThink = game.tick + Math.round(this.level.think * TICK_RATE);
    this.#placeReady();
    const harvesterReserve = this.#harvesters();
    if (!this.#emergency()) {
      // Only spend on the base and army while the economy is alive.
      const reserve = Math.max(this.#construct(), harvesterReserve);
      this.#train(reserve);
    }
    this.#rally();
    this.#defend();
    this.#attack();
  }

  // Base building -----------------------------------------------------------------------------

  /** Next structure to build, or null. */
  nextStructure() {
    const game = this.game;
    const player = this.player;
    const pending = player.structure?.type ?? player.ready;
    const have = (type) => game.count(this.id, type) + (pending === type ? 1 : 0);
    const caps = { refinery: this.level.refineries, factory: this.level.factories, turret: this.level.turrets };
    const tally = {};
    let pick = null;
    for (const type of BUILD_ORDER) {
      tally[type] = (tally[type] ?? 0) + 1;
      if (caps[type] !== undefined && tally[type] > caps[type]) continue;
      if (tally[type] > have(type)) {
        pick = type;
        break;
      }
    }
    // Rich and nothing left in the build order: add production so the bank gets spent.
    if (!pick && player.credits > 2500) {
      if (game.count(this.id, "factory") < Math.min(3, this.level.factories + 1) && game.prereqsMet(this.id, "factory")) pick = "factory";
      else if (game.count(this.id, "barracks") < 2 && game.prereqsMet(this.id, "barracks")) pick = "barracks";
      if (pick && pending === pick) pick = null;
    }
    const { made, used } = player.power;
    const margin = made - used;
    if (pick && BUILDINGS[pick].power < 0 && margin + BUILDINGS[pick].power < 0) pick = "power";
    if (!pick && margin < 30) pick = "power";
    if (pick && pending) return null; // one structure at a time
    return pick;
  }

  #construct() {
    const game = this.game;
    const next = this.nextStructure();
    if (!next) return 0;
    const why = game.whyNot(this.id, next);
    if (!why) {
      game.command(this.id, { type: "build", item: next });
      return 0;
    }
    return why === "credits" ? BUILDINGS[next].cost : 0;
  }

  #placeReady() {
    const type = this.player.ready;
    if (!type) return;
    const spot = this.findSpot(type);
    if (spot) this.game.command(this.id, { type: "place", tx: spot.x, ty: spot.y });
    else this.game.command(this.id, { type: "cancel", category: "structure" });
  }

  /** Best legal spot for a structure, keeping a one-tile lane around buildings. */
  findSpot(type) {
    const game = this.game;
    const rule = BUILDINGS[type];
    const base = this.player.start;
    const enemy = game.players[this.enemy].start;
    let best = null;
    let bestScore = Infinity;
    const R = 13;
    for (let dy = -R; dy <= R; dy += 1) {
      for (let dx = -R; dx <= R; dx += 1) {
        const tx = base.x + dx;
        const ty = base.y + dy;
        if (!game.canPlace(this.id, type, tx, ty)) continue;
        if (type !== "turret" && !this.#lane(tx, ty, rule.w, rule.h)) continue;
        const cx = tx + rule.w / 2;
        const cy = ty + rule.h / 2;
        let score = Math.hypot(cx - base.x, cy - base.y);
        if (type === "refinery") score = this.#oreDistance(tx + rule.dock.x, ty + rule.dock.y) * 3 + score * 0.3;
        if (type === "turret") score = Math.hypot(cx - enemy.x, cy - enemy.y) + Math.abs(Math.hypot(cx - base.x, cy - base.y) - 7) * 2;
        score += this.rng() * 0.01; // break ties deterministically but not always top-left
        if (score < bestScore) {
          bestScore = score;
          best = { x: tx, y: ty };
        }
      }
    }
    return best;
  }

  #lane(tx, ty, w, h) {
    const map = this.game.map;
    for (let y = ty - 1; y <= ty + h; y += 1) {
      for (let x = tx - 1; x <= tx + w; x += 1) {
        if (x >= tx && x < tx + w && y >= ty && y < ty + h) continue;
        if (map.inside(x, y) && map.blocked[map.index(x, y)]) return false;
      }
    }
    return true;
  }

  #oreDistance(x, y) {
    let best = Infinity;
    for (const t of this.oreTiles) best = Math.min(best, Math.hypot(t.x - x, t.y - y));
    return best;
  }

  // Economy and army ---------------------------------------------------------------------------

  /** Keeps harvesters working and replaced. Returns credits to hold back for them. */
  #harvesters() {
    const game = this.game;
    const refineries = game.count(this.id, "refinery");
    const queued = this.player.queues.vehicle.filter((q) => q.type === "harvester").length;
    const alive = game.count(this.id, "harvester");
    const want = Math.min(6, refineries * this.level.harvestersPerRefinery);
    const idle = game.owned(this.id, (e) => e.type === "harvester" && e.order.type === "idle").map((e) => e.id);
    if (idle.length) game.command(this.id, { type: "harvest", ids: idle });
    if (!refineries || alive + queued >= want || !game.has(this.id, "factory")) return 0;
    const why = game.whyNot(this.id, "harvester");
    if (!why) {
      game.command(this.id, { type: "build", item: "harvester" });
      return 0;
    }
    // No income at all and no money for a harvester: sell something to restart the economy.
    if (why === "credits" && alive + queued === 0) this.#emergencySell(UNITS.harvester.cost);
    return UNITS.harvester.cost;
  }

  /** Sells the least important structure (one per think) until `needed` credits are in hand. */
  #emergencySell(needed) {
    const game = this.game;
    if (this.player.credits >= needed) return;
    for (const type of ["tech", "radar", "turret", "barracks"]) {
      const victim = game.owned(this.id, (e) => e.type === type)[0];
      if (victim) {
        game.command(this.id, { type: "sell", id: victim.id });
        return;
      }
    }
    if (game.count(this.id, "factory") > 1) {
      game.command(this.id, { type: "sell", id: game.owned(this.id, (e) => e.type === "factory").at(-1).id });
    } else if (game.count(this.id, "power") > 1) {
      game.command(this.id, { type: "sell", id: game.owned(this.id, (e) => e.type === "power").at(-1).id });
    }
  }

  /** Refinery and factory standing but no harvester alive or queued: save everything for one. */
  #emergency() {
    const game = this.game;
    if (!game.has(this.id, "refinery") || !game.has(this.id, "factory")) return false;
    const queued = this.player.queues.vehicle.some((q) => q.type === "harvester");
    return !queued && game.count(this.id, "harvester") === 0;
  }

  /** True when the economy is dead and cannot be restarted: time to throw everything in. */
  #broke() {
    const game = this.game;
    const income = game.count(this.id, "harvester") + this.player.queues.vehicle.filter((q) => q.type === "harvester").length;
    return income === 0 && this.player.credits < UNITS.harvester.cost;
  }

  #train(reserve) {
    const game = this.game;
    const player = this.player;
    const spare = () => player.credits - reserve;
    const depth = Math.min(5, 2 + Math.floor(player.credits / 3000)); // deeper queues when rich
    if (game.has(this.id, "barracks") && player.queues.infantry.length < depth) {
      const type = this.rng() < 0.6 ? "rifle" : "rocket";
      if (spare() >= UNITS[type].cost && !game.whyNot(this.id, type)) game.command(this.id, { type: "build", item: type });
    }
    if (game.has(this.id, "factory") && player.queues.vehicle.length < depth) {
      const options = [["tank", 5], ["scout", 1]];
      if (game.has(this.id, "tech")) options.push(["heavy", 3], ["artillery", 2]);
      const total = options.reduce((s, [, w]) => s + w, 0);
      let roll = this.rng() * total;
      let type = options[0][0];
      for (const [t, w] of options) {
        if ((roll -= w) < 0) {
          type = t;
          break;
        }
      }
      if (spare() >= UNITS[type].cost && !game.whyNot(this.id, type)) game.command(this.id, { type: "build", item: type });
    }
  }

  #rally() {
    const game = this.game;
    const base = this.player.start;
    const enemy = game.players[this.enemy].start;
    const len = Math.hypot(enemy.x - base.x, enemy.y - base.y) || 1;
    const point = game.freeSpotNear(base.x + ((enemy.x - base.x) / len) * 7, base.y + ((enemy.y - base.y) / len) * 7, false);
    for (const b of game.owned(this.id, (e) => e.type === "barracks" || e.type === "factory")) {
      if (this.rallied.has(b.id)) continue;
      game.command(this.id, { type: "rally", id: b.id, x: point.x, y: point.y });
      this.rallied.add(b.id);
    }
  }

  #army() {
    return this.game.owned(this.id, (e) => e.kind === "unit" && UNITS[e.type].weapon);
  }

  #defend() {
    if (!this.level.defend) return;
    const game = this.game;
    const hit = this.player.lastAttacked;
    if (!hit || game.tick - hit.tick > 4 * TICK_RATE) return;
    const base = this.player.start;
    if (Math.hypot(hit.x - base.x, hit.y - base.y) > 16 && hit.item !== "harvester") return;
    const defenders = this.#army().filter((u) => !this.attackers.has(u.id) && u.order.type !== "attack" && !u.targetId);
    if (defenders.length) game.command(this.id, { type: "move", ids: defenders.map((u) => u.id), x: hit.x, y: hit.y, attackMove: true });
  }

  #attack() {
    const game = this.game;
    for (const id of this.attackers) if (!game.entity(id)) this.attackers.delete(id);

    const home = this.#army().filter((u) => !this.attackers.has(u.id));
    if (home.length && (home.length >= this.waveSize || this.#broke())) {
      const target = this.#targetNear(this.player.start);
      if (target) {
        game.command(this.id, { type: "move", ids: home.map((u) => u.id), x: target.x, y: target.y, attackMove: true });
        for (const u of home) this.attackers.add(u.id);
        this.waves += 1;
        this.waveSize = Math.min(this.level.maxWave, this.waveSize + this.level.waveGrowth);
      }
    }

    // Wave units that arrived (or lost their target) push on to the next enemy target.
    const idle = [...this.attackers].map((id) => game.entity(id)).filter((u) => u && u.order.type === "idle" && !u.targetId);
    if (idle.length) {
      const cx = idle.reduce((s, u) => s + u.x, 0) / idle.length;
      const cy = idle.reduce((s, u) => s + u.y, 0) / idle.length;
      const target = this.#targetNear({ x: cx, y: cy });
      if (target) game.command(this.id, { type: "move", ids: idle.map((u) => u.id), x: target.x, y: target.y, attackMove: true });
    }
  }

  /** Closest enemy structure (or unit if no structures are left) to a point. */
  #targetNear(point) {
    const game = this.game;
    let best = null;
    let bestD = Infinity;
    for (const kind of ["building", "unit"]) {
      for (const e of game.entities.values()) {
        if (e.owner !== this.enemy || e.kind !== kind) continue;
        const d = Math.hypot(e.x - point.x, e.y - point.y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (best) break;
    }
    if (!best) return null;
    // Aim at a free tile next to it (structures themselves are not walkable).
    return best.kind === "building" ? game.freeSpotNear(best.x, best.ty + best.h + 0.5, false) : { x: best.x, y: best.y };
  }
}
