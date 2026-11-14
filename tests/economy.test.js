import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Game } from "../src/core/game.js";
import { BUILDINGS, ORE_REGROW, UNITS } from "../src/core/rules.js";
import { mapFrom, openMap, runUntil, seconds } from "./support/helpers.js";

const START = [{ x: 6, y: 6 }, { x: 33, y: 33 }];
const base = (credits = 20000) => new Game({ map: openMap(40, 40, START), credits, startUnits: [] });

describe("construction (FR-4)", () => {
  it("costs credits up front and takes exactly its build time", () => {
    const game = base();
    assert.equal(game.whyNot(0, "power"), null);
    assert.equal(game.command(0, { type: "build", item: "power" }).ok, true);
    assert.equal(game.players[0].credits, 20000 - BUILDINGS.power.cost);
    const ticks = BUILDINGS.power.time * 20;
    game.run(ticks - 1);
    assert.equal(game.players[0].ready, null);
    game.step();
    assert.equal(game.players[0].ready, "power");
  });

  it("one structure at a time", () => {
    const game = base();
    game.command(0, { type: "build", item: "power" });
    assert.equal(game.command(0, { type: "build", item: "power" }).reason, "busy");
  });

  it("placement: inside the build radius, on clear grass, not on ore, units or other structures", () => {
    const rows = Array.from({ length: 40 }, (_, y) => (y === 9 ? "..........." + "*" + ".".repeat(28) : ".".repeat(40)));
    const game = new Game({ map: mapFrom(rows, START), credits: 5000, startUnits: [] });
    // HQ covers (5..7, 5..7).
    assert.equal(game.canPlace(0, "power", 9, 5), true);
    assert.equal(game.canPlace(0, "power", 12, 5), true); // gap of 4: still inside the radius
    assert.equal(game.canPlace(0, "power", 13, 12), false); // too far
    assert.equal(game.canPlace(0, "power", 6, 6), false); // on the HQ
    assert.equal(game.canPlace(0, "power", 10, 8), false); // covers ore at (11, 9)
    game.spawn(0, "rifle", 9.5, 9.5);
    assert.equal(game.canPlace(0, "power", 9, 9), false); // a unit stands there
    assert.equal(game.canPlace(1, "power", 9, 5), false); // not near player 1's structures
  });

  it("place requires something ready; placing blocks the tiles", () => {
    const game = base();
    assert.equal(game.command(0, { type: "place", tx: 9, ty: 5 }).reason, "nothing-ready");
    game.command(0, { type: "build", item: "power" });
    seconds(game, BUILDINGS.power.time + 0.1);
    assert.equal(game.command(0, { type: "place", tx: 30, ty: 30 }).reason, "blocked");
    const placed = game.command(0, { type: "place", tx: 9, ty: 5 });
    assert.equal(placed.ok, true);
    assert.equal(game.map.passable(9, 5), false);
    assert.equal(game.players[0].power.made, BUILDINGS.hq.power + BUILDINGS.power.power);
  });

  it("the tech tree gates structures and units", () => {
    const game = base();
    assert.equal(game.whyNot(0, "barracks"), "prereq");
    assert.equal(game.whyNot(0, "factory"), "prereq");
    assert.equal(game.whyNot(0, "rifle"), "prereq");
    assert.equal(game.whyNot(0, "hq"), "unbuildable");
    game.spawnBuilding(0, "power", 9, 5);
    assert.equal(game.whyNot(0, "barracks"), null);
    assert.equal(game.whyNot(0, "heavy"), "prereq");
  });

  it("not enough credits", () => {
    const game = base(100);
    assert.equal(game.whyNot(0, "power"), "credits");
  });

  it("cancel refunds in full; selling refunds half", () => {
    const game = base(1000);
    game.command(0, { type: "build", item: "power" });
    game.command(0, { type: "cancel", category: "structure" });
    assert.equal(game.players[0].credits, 1000);
    const plant = game.spawnBuilding(0, "power", 9, 5);
    game.command(0, { type: "sell", id: plant.id });
    assert.equal(game.players[0].credits, 1000 + BUILDINGS.power.cost / 2);
    assert.equal(game.map.passable(9, 5), true);
    assert.equal(game.command(0, { type: "sell", id: game.owned(0, (e) => e.type === "hq")[0].id }).ok, false);
  });

  it("losing the HQ refunds the structure in progress", () => {
    const game = base(1000);
    game.command(0, { type: "build", item: "power" });
    game.spawn(0, "rifle", 20, 20); // keep player 0 alive
    game.owned(0, (e) => e.type === "hq")[0].hp = 0;
    game.step();
    game.step();
    assert.equal(game.players[0].structure, null);
    assert.equal(game.players[0].credits, 1000);
  });
});

describe("power (FR-5)", () => {
  it("a deficit halves production speed", () => {
    const normal = base();
    normal.spawnBuilding(0, "power", 9, 5);
    normal.spawnBuilding(0, "barracks", 9, 8);
    normal.command(0, { type: "build", item: "rifle" });
    const fast = runUntil(normal, () => normal.count(0, "rifle") === 1, 30);

    const starved = base();
    starved.spawnBuilding(0, "barracks", 9, 8);
    starved.spawnBuilding(0, "radar", 12, 8);
    assert.equal(starved.lowPower(0), true);
    starved.command(0, { type: "build", item: "rifle" });
    const slow = runUntil(starved, () => starved.count(0, "rifle") === 1, 30);
    assert.equal(fast, UNITS.rifle.time);
    assert.equal(slow, UNITS.rifle.time * 2);
  });

  it("radar needs power", () => {
    const game = base();
    game.spawnBuilding(0, "radar", 9, 5);
    assert.equal(game.hasRadar(0), false); // 20 made, 40 used
    game.spawnBuilding(0, "power", 12, 5);
    assert.equal(game.hasRadar(0), true);
  });
});

describe("production queues (FR-6)", () => {
  it("queues up to 5, builds in order, spawns next to the producer and walks to the rally point", () => {
    const game = base();
    game.spawnBuilding(0, "power", 9, 5);
    const barracks = game.spawnBuilding(0, "barracks", 9, 8);
    for (let i = 0; i < 5; i += 1) assert.equal(game.command(0, { type: "build", item: i % 2 ? "rocket" : "rifle" }).ok, true);
    assert.equal(game.command(0, { type: "build", item: "rifle" }).reason, "queue-full");
    game.command(0, { type: "rally", id: barracks.id, x: 20.5, y: 12.5 });
    seconds(game, UNITS.rifle.time + 0.1);
    const first = game.owned(0, (e) => e.type === "rifle")[0];
    assert.ok(first, "first rifle is out");
    assert.ok(Math.hypot(first.x - barracks.x, first.y - barracks.y) < 4);
    seconds(game, 12);
    assert.ok(Math.hypot(first.x - 20.5, first.y - 12.5) < 1.2, "reached the rally point");
    assert.equal(game.count(0, "rocket") >= 1, true);
  });

  it("cancelling a queued unit refunds it", () => {
    const game = base(1000);
    game.spawnBuilding(0, "power", 9, 5);
    game.spawnBuilding(0, "barracks", 9, 8);
    game.command(0, { type: "build", item: "rocket" });
    game.command(0, { type: "cancel", category: "infantry", item: "rocket" });
    assert.equal(game.players[0].credits, 1000);
    assert.equal(game.players[0].queues.infantry.length, 0);
  });

  it("a queue pauses while its producer is gone", () => {
    const game = base();
    game.spawnBuilding(0, "power", 9, 5);
    const barracks = game.spawnBuilding(0, "barracks", 9, 8);
    game.command(0, { type: "build", item: "rifle" });
    barracks.hp = 0;
    seconds(game, 10);
    assert.equal(game.count(0, "rifle"), 0);
    assert.equal(game.players[0].queues.infantry.length, 1);
  });
});

describe("harvesting (FR-3)", () => {
  function oreGame() {
    const rows = Array.from({ length: 30 }, (_, y) => (y >= 4 && y <= 6 ? ".".repeat(16) + "****" + ".".repeat(10) : ".".repeat(30)));
    const game = new Game({ map: mapFrom(rows, [{ x: 6, y: 6 }, { x: 26, y: 26 }]), credits: 5000, startUnits: [] });
    game.spawnBuilding(0, "power", 9, 5);
    return game;
  }

  it("placing a refinery gives a free harvester that starts working", () => {
    const game = oreGame();
    game.players[0].ready = "refinery";
    assert.equal(game.command(0, { type: "place", tx: 12, ty: 4 }).ok, true);
    const harvester = game.owned(0, (e) => e.type === "harvester")[0];
    assert.ok(harvester);
    assert.equal(harvester.order.type, "harvest");
  });

  it("credits gained equal ore removed (minus cargo still on board), at a useful rate", () => {
    const game = oreGame();
    game.players[0].ready = "refinery";
    game.command(0, { type: "place", tx: 12, ty: 4 });
    game.map.oreMax.fill(0); // no regrowth: the books must balance exactly
    const oreBefore = game.map.totalOre();
    const creditsBefore = game.players[0].credits;
    seconds(game, 120);
    const harvester = game.owned(0, (e) => e.type === "harvester")[0];
    const gained = game.players[0].credits - creditsBefore;
    const removed = oreBefore - game.map.totalOre();
    assert.ok(gained >= 1400, `only ${gained} credits in 2 minutes`);
    assert.equal(game.players[0].stats.harvested, gained);
    assert.equal(removed, gained + harvester.cargo, "ore is never created or lost");
  });

  it("harvesters unload at the refinery one at a time and keep cycling", () => {
    const game = oreGame();
    game.players[0].ready = "refinery";
    game.command(0, { type: "place", tx: 12, ty: 4 });
    game.spawn(0, "harvester", 14, 9).order = { type: "idle" };
    const second = game.owned(0, (e) => e.type === "harvester")[1];
    game.command(0, { type: "harvest", ids: [second.id] });
    let unloads = 0;
    for (let i = 0; i < 20 * 150; i += 1) {
      game.step();
      unloads += game.takeEvents().filter((e) => e.type === "unload").length;
    }
    assert.ok(unloads >= 4, `${unloads} unloads`);
  });

  it("ore fields regrow up to their original amount", () => {
    const game = oreGame();
    const i = game.map.index(16, 5);
    game.map.ore[i] = 0;
    seconds(game, ORE_REGROW.every);
    assert.equal(game.map.ore[i], ORE_REGROW.amount);
    seconds(game, 200);
    assert.equal(game.map.ore[i], game.map.oreMax[i]);
  });
});
