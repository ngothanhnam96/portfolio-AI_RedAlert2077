import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AI, aiController, BUILD_ORDER } from "../src/core/ai.js";
import { Game } from "../src/core/game.js";
import { BUILDINGS, STRUCTURE_ORDER } from "../src/core/rules.js";
import { openMap, seconds } from "./support/helpers.js";

describe("AI opponent (FR-12)", () => {
  it("its build order only names real, buildable structures", () => {
    for (const type of BUILD_ORDER) {
      assert.ok(BUILDINGS[type], type);
      assert.ok(STRUCTURE_ORDER.includes(type), type);
    }
  });

  it("against an idle player it builds the core base within 4 minutes and keeps power positive", () => {
    const game = new Game({ seed: 4, size: 48, controllers: [null, aiController("normal")] });
    let lowSamples = 0;
    let samples = 0;
    for (let t = 0; t < 4 * 60 * 20; t += 1) {
      game.step();
      if (t % 20 === 0) {
        samples += 1;
        if (game.lowPower(1)) lowSamples += 1;
      }
    }
    for (const type of ["power", "refinery", "barracks", "factory"]) assert.ok(game.has(1, type), `has ${type}`);
    assert.ok(game.count(1, "harvester") >= 1);
    assert.ok(lowSamples / samples < 0.05, `low power ${lowSamples}/${samples} of the time`);
    assert.ok(game.players[1].stats.harvested > 3000);
  });

  it("every structure it places is legal and leaves a lane around it", () => {
    const game = new Game({ seed: 9, size: 48, controllers: [null, aiController("hard")] });
    game.run(6 * 60 * 20);
    const buildings = game.owned(1, (e) => e.kind === "building" && e.type !== "turret");
    assert.ok(buildings.length >= 6);
    // Every structure can still be reached by ground units from the HQ exit.
    const hq = game.owned(1, (e) => e.type === "hq")[0];
    for (const b of buildings) {
      if (b === hq) continue;
      let open = false;
      for (let x = b.tx - 1; x <= b.tx + b.w && !open; x += 1) for (let y = b.ty - 1; y <= b.ty + b.h && !open; y += 1) if (game.map.passable(x, y)) open = true;
      assert.ok(open, `${b.type} is boxed in`);
    }
  });

  it("defeats a passive player within 15 minutes", () => {
    const game = new Game({ seed: 6, size: 48, controllers: [null, aiController("normal")] });
    while (!game.over && game.tick < 15 * 60 * 20) game.step();
    assert.equal(game.winner, 1);
  });

  it("sends harvesters back to work and replaces lost ones", () => {
    const game = new Game({ seed: 4, size: 48, controllers: [null, aiController("normal")] });
    game.run(4 * 60 * 20);
    const before = game.count(1, "harvester");
    for (const h of game.owned(1, (e) => e.type === "harvester")) h.hp = 0;
    game.players[1].credits += 2000;
    game.run(60 * 20);
    assert.ok(before >= 1 && game.count(1, "harvester") >= 1, "rebuilt a harvester");
  });

  it("when broke with no harvesters, it sells a structure to restart its economy", () => {
    const game = new Game({ map: openMap(48, 48, [{ x: 7, y: 7 }, { x: 40, y: 40 }]), startUnits: [], controllers: [null, (g, id) => new AI(g, id, "normal")] });
    game.spawn(0, "rifle", 2.5, 2.5).order = { type: "hold", fire: false };
    game.spawnBuilding(1, "power", 35, 39);
    game.spawnBuilding(1, "refinery", 43, 38);
    game.spawnBuilding(1, "factory", 39, 35);
    game.spawnBuilding(1, "radar", 43, 42);
    game.spawnBuilding(1, "power", 35, 42);
    game.spawnBuilding(1, "barracks", 38, 43);
    game.spawnBuilding(1, "turret", 36, 37);
    game.players[1].credits = 0;
    seconds(game, 5);
    assert.equal(game.count(1, "radar"), 0, "sold the radar");
    seconds(game, 30);
    assert.ok(game.count(1, "harvester") + game.players[1].queues.vehicle.filter((q) => q.type === "harvester").length >= 1, "a harvester is coming");
  });

  it("attacks in waves that grow", () => {
    const game = new Game({ seed: 4, size: 48, controllers: [aiController("normal"), aiController("normal")] });
    game.run(10 * 60 * 20);
    const ai = game.controllers[0];
    assert.ok(ai.waves >= 1, `${ai.waves} waves`);
    assert.ok(ai.waveSize > 7);
  });
});

describe("performance (NFR-6)", () => {
  it("a 200-unit battle steps in well under the 50 ms tick budget", () => {
    const game = new Game({ map: openMap(64, 64), bases: false, startUnits: [] });
    const types = ["rifle", "rocket", "tank", "scout", "artillery"];
    for (let i = 0; i < 100; i += 1) {
      game.spawn(0, types[i % 5], 6 + (i % 10) * 1.2, 20 + Math.floor(i / 10) * 1.2);
      game.spawn(1, types[i % 5], 58 - (i % 10) * 1.2, 20 + Math.floor(i / 10) * 1.2);
    }
    game.refreshVision();
    for (const owner of [0, 1]) game.command(owner, { type: "move", ids: game.owned(owner).map((e) => e.id), x: owner ? 6 : 58, y: 26, attackMove: true });
    game.run(20); // warm up
    const start = performance.now();
    const ticks = 300;
    game.run(ticks);
    const perTick = (performance.now() - start) / ticks;
    assert.ok(perTick < 5, `${perTick.toFixed(2)} ms per tick`);
  });
});
