import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameMap, ROCK } from "../src/core/map.js";
import { findPath, lineOfSight, pathLength, smoothPath } from "../src/core/pathfind.js";
import { mulberry32 } from "../src/core/rng.js";
import { mapFrom } from "./support/helpers.js";

/** Reference: Dijkstra with the same move rules, for optimality checks. */
function dijkstra(map, sx, sy, gx, gy) {
  const dist = new Float64Array(map.width * map.height).fill(Infinity);
  const done = new Uint8Array(map.width * map.height);
  dist[map.index(sx, sy)] = 0;
  for (;;) {
    let best = -1;
    for (let i = 0; i < dist.length; i += 1) if (!done[i] && dist[i] < Infinity && (best < 0 || dist[i] < dist[best])) best = i;
    if (best < 0) return Infinity;
    if (best === map.index(gx, gy)) return dist[best];
    done[best] = 1;
    const x = best % map.width;
    const y = (best - x) / map.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!map.passable(nx, ny)) continue;
      if (dx && dy && (!map.passable(x + dx, y) || !map.passable(x, y + dy))) continue;
      const j = map.index(nx, ny);
      dist[j] = Math.min(dist[j], dist[best] + Math.hypot(dx, dy));
    }
  }
}

describe("A* pathfinding (FR-9)", () => {
  it("goes straight on open ground", () => {
    const { map } = mapFrom(["..........", "..........", ".........."]);
    const path = findPath(map, 0, 1, 9, 1);
    assert.equal(path.length, 9);
    assert.deepEqual(path.at(-1), { x: 9, y: 1 });
  });

  it("walks around a wall and never through blocked tiles", () => {
    const { map } = mapFrom([
      "..........",
      "....#.....",
      "....#.....",
      "....#.....",
      "..........",
    ]);
    const path = findPath(map, 1, 2, 8, 2);
    assert.deepEqual(path.at(-1), { x: 8, y: 2 });
    assert.ok(pathLength(1, 2, path) > 7, "a detour is longer than the straight line");
    for (const p of path) assert.ok(map.passable(p.x, p.y));
  });

  it("does not cut corners diagonally past blocked tiles", () => {
    const { map } = mapFrom([
      "...",
      ".#.",
      "...",
    ]);
    const path = findPath(map, 0, 0, 2, 2);
    let prev = { x: 0, y: 0 };
    for (const p of path) {
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      if (dx && dy) assert.ok(map.passable(prev.x + dx, prev.y) && map.passable(prev.x, prev.y + dy));
      prev = p;
    }
  });

  it("returns the closest reachable tile when the goal is walled off", () => {
    const { map } = mapFrom([
      "..........",
      "......###.",
      "......#.#.",
      "......###.",
      "..........",
    ]);
    const path = findPath(map, 0, 2, 7, 2);
    const end = path.at(-1);
    assert.ok(map.passable(end.x, end.y));
    assert.ok(Math.hypot(end.x - 7, end.y - 2) <= 2, "ends right outside the box");
  });

  it("is optimal: matches Dijkstra on 40 random maps", () => {
    const rng = mulberry32(99);
    for (let n = 0; n < 40; n += 1) {
      const map = new GameMap(16, 16);
      for (let i = 0; i < map.terrain.length; i += 1) if (rng() < 0.25) map.terrain[i] = ROCK;
      map.terrain[0] = 0;
      map.terrain[map.terrain.length - 1] = 0;
      const ref = dijkstra(map, 0, 0, 15, 15);
      const path = findPath(map, 0, 0, 15, 15);
      if (ref === Infinity) {
        assert.ok(!path.length || path.at(-1).x !== 15 || path.at(-1).y !== 15);
        continue;
      }
      assert.deepEqual(path.at(-1), { x: 15, y: 15 });
      assert.ok(Math.abs(pathLength(0, 0, path) - ref) < 1e-9, `map ${n}: ${pathLength(0, 0, path)} vs ${ref}`);
    }
  });

  it("smoothing removes waypoints and keeps line of sight between them", () => {
    const { map } = mapFrom([
      "............",
      "............",
      ".....##.....",
      ".....##.....",
      "............",
      "............",
    ]);
    const raw = findPath(map, 0, 0, 11, 5);
    const smooth = smoothPath(map, 0, 0, raw);
    assert.ok(smooth.length < raw.length);
    let prev = { x: 0, y: 0 };
    for (const p of smooth) {
      assert.ok(lineOfSight(map, prev.x, prev.y, p.x, p.y));
      prev = p;
    }
    assert.deepEqual(smooth.at(-1), { x: 11, y: 5 });
  });

  it("returns [] when already at the goal", () => {
    const { map } = mapFrom(["...", "..."]);
    assert.deepEqual(findPath(map, 1, 1, 1, 1), []);
  });
});
