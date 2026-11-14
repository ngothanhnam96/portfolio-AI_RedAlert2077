import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aiController } from "../src/core/ai.js";
import { Game } from "../src/core/game.js";
import { GRASS } from "../src/core/map.js";
import { arena, mapFrom, runUntil } from "./support/helpers.js";

describe("movement (FR-9)", () => {
  it("a unit reaches its destination around obstacles in about path-length / speed", () => {
    const rows = Array.from({ length: 20 }, (_, y) => (y >= 2 && y <= 17 ? "..........#........." : "...................."));
    const game = new Game({ map: mapFrom(rows), bases: false, startUnits: [] });
    const tank = game.spawn(0, "tank", 2.5, 10.5);
    game.spawn(1, "rifle", 19.5, 0.5).order = { type: "hold", fire: false }; // keep player 1 alive
    game.command(0, { type: "move", ids: [tank.id], x: 17.5, y: 10.5 });
    const t = runUntil(game, () => tank.order.type === "idle", 60);
    assert.ok(Math.hypot(tank.x - 17.5, tank.y - 10.5) < 0.3);
    const minimum = (Math.hypot(8, 9) + Math.hypot(7, 9)) / tank.speed; // via the gap at the top
    assert.ok(t < minimum * 1.5, `${t}s vs ${minimum.toFixed(1)}s`);
  });

  it("a group of 12 spreads into formation without stacking", () => {
    const game = arena();
    const ids = [];
    for (let i = 0; i < 12; i += 1) ids.push(game.spawn(0, i % 2 ? "tank" : "rifle", 5 + (i % 4) * 1.1, 5 + Math.floor(i / 4) * 1.1).id);
    game.spawn(1, "rifle", 39.5, 0.5).order = { type: "hold", fire: false };
    game.command(0, { type: "move", ids, x: 28.5, y: 28.5 });
    runUntil(game, () => ids.every((id) => game.entity(id).order.type === "idle"), 60);
    const units = ids.map((id) => game.entity(id));
    for (const u of units) assert.ok(Math.hypot(u.x - 28.5, u.y - 28.5) < 4, "arrived near the target");
    for (let i = 0; i < units.length; i += 1) {
      for (let j = i + 1; j < units.length; j += 1) {
        const d = Math.hypot(units[i].x - units[j].x, units[i].y - units[j].y);
        assert.ok(d > (units[i].radius + units[j].radius) * 0.7, `units ${i},${j} overlap (${d.toFixed(2)})`);
      }
    }
  });

  it("an unreachable destination ends at the closest reachable spot, not in an endless loop", () => {
    const rows = [
      "....................",
      "....................",
      "..............#####.",
      "..............#...#.",
      "..............#####.",
      "....................",
    ];
    const game = new Game({ map: mapFrom(rows, [{ x: 1, y: 1 }, { x: 18, y: 5 }]), bases: false, startUnits: [] });
    const tank = game.spawn(0, "tank", 1.5, 3.5);
    game.spawn(1, "rifle", 19.5, 0.5).order = { type: "hold", fire: false };
    game.command(0, { type: "move", ids: [tank.id], x: 16.5, y: 3.5 });
    const t = runUntil(game, () => tank.order.type === "idle", 30);
    assert.ok(t < 30, "gave up or arrived");
    assert.ok(Math.hypot(tank.x - 16.5, tank.y - 3.5) < 2.5);
  });

  it("in a full AI-vs-AI game no unit ever stands on rock, water or a structure", () => {
    const game = new Game({ seed: 3, size: 48, controllers: [aiController("normal"), aiController("normal")] });
    for (let t = 0; t < 20 * 60 * 6 && !game.over; t += 1) {
      game.step();
      if (t % 10) continue;
      for (const e of game.entities.values()) {
        if (e.kind !== "unit") continue;
        const tx = Math.floor(e.x);
        const ty = Math.floor(e.y);
        assert.equal(game.map.terrainAt(tx, ty), GRASS, `${e.type} #${e.id} on terrain at ${tx},${ty} tick ${game.tick}`);
        assert.equal(game.map.blocked[game.map.index(tx, ty)], 0, `${e.type} #${e.id} inside a structure`);
      }
    }
  });
});

describe("fog of war (FR-10)", () => {
  it("units reveal a circle of their sight radius; explored areas stay explored", () => {
    const game = arena({ width: 40, height: 40 });
    const scout = game.spawn(0, "scout", 10.5, 10.5);
    game.spawn(1, "rifle", 39.5, 39.5).order = { type: "hold", fire: false };
    game.refreshVision();
    const p = game.players[0];
    assert.equal(game.isVisible(0, 10.5 + 7, 10.5), true);
    assert.equal(game.isVisible(0, 10.5 + 9, 10.5), false);
    game.command(0, { type: "move", ids: [scout.id], x: 30.5, y: 10.5 });
    runUntil(game, () => scout.order.type === "idle", 20);
    game.refreshVision();
    assert.equal(game.isVisible(0, 10.5, 10.5), false);
    assert.equal(p.explored[game.map.index(10, 10)], 1);
  });

  it("enemies outside vision are hidden; structures are seen when any tile is visible", () => {
    const game = arena({ width: 40, height: 40 });
    game.spawn(0, "rifle", 5.5, 5.5);
    const hidden = game.spawn(1, "tank", 30.5, 30.5);
    const hq = game.spawnBuilding(1, "hq", 9, 3); // left edge 9: 3.5 tiles from the rifle
    game.refreshVision();
    assert.equal(game.canSee(0, hidden), false);
    assert.equal(game.canSee(0, hq), true);
    assert.equal(game.canSee(1, hidden), true);
  });
});
