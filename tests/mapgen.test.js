import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GRASS } from "../src/core/map.js";
import { generateMap, MAP_SIZES, reachable } from "../src/core/mapgen.js";

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

describe("procedural maps (FR-2, NFR-5)", () => {
  it("are deterministic per seed and differ between seeds", () => {
    const a = generateMap({ seed: 7, size: 48 }).map;
    const b = generateMap({ seed: 7, size: 48 }).map;
    const c = generateMap({ seed: 8, size: 48 }).map;
    assert.deepEqual(a.terrain, b.terrain);
    assert.deepEqual(a.ore, b.ore);
    assert.notDeepEqual(a.terrain, c.terrain);
  });

  for (const [name, size] of Object.entries(MAP_SIZES)) {
    it(`${name}: point-symmetric terrain and ore for ${SEEDS.length} seeds`, () => {
      for (const seed of SEEDS) {
        const { map, starts } = generateMap({ seed, size });
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const i = map.index(x, y);
            const j = map.index(size - 1 - x, size - 1 - y);
            assert.equal(map.terrain[i], map.terrain[j], `seed ${seed} terrain ${x},${y}`);
            assert.equal(map.ore[i], map.ore[j], `seed ${seed} ore ${x},${y}`);
          }
        }
        assert.deepEqual(starts[1], { x: size - 1 - starts[0].x, y: size - 1 - starts[0].y });
      }
    });

    it(`${name}: bases connected by land, no unreachable land, all ore reachable`, () => {
      for (const seed of SEEDS) {
        const { map, starts } = generateMap({ seed, size });
        const reach = reachable(map, starts[0].x, starts[0].y);
        assert.equal(reach[map.index(starts[1].x, starts[1].y)], 1, `seed ${seed}: bases not connected`);
        for (let i = 0; i < map.terrain.length; i += 1) {
          if (map.terrain[i] === GRASS) assert.equal(reach[i], 1, `seed ${seed}: pocket at ${i}`);
          if (map.ore[i]) assert.equal(reach[i], 1, `seed ${seed}: unreachable ore`);
        }
      }
    });

    it(`${name}: bases are clear and buildable, every side has plenty of ore`, () => {
      for (const seed of SEEDS) {
        const { map, starts } = generateMap({ seed, size });
        for (const s of starts) {
          for (let y = s.y - 3; y <= s.y + 3; y += 1) for (let x = s.x - 3; x <= s.x + 3; x += 1) assert.ok(map.buildable(x, y), `seed ${seed}: base tile ${x},${y}`);
        }
        let near = [0, 0];
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const amount = map.ore[map.index(x, y)];
            if (!amount) continue;
            const d0 = Math.hypot(x - starts[0].x, y - starts[0].y);
            const d1 = Math.hypot(x - starts[1].x, y - starts[1].y);
            if (d0 < d1) near[0] += amount;
            else if (d1 < d0) near[1] += amount;
          }
        }
        assert.equal(near[0], near[1], `seed ${seed}: unequal ore`);
        assert.ok(near[0] >= 35000, `seed ${seed}: only ${near[0]} ore per side`);
        assert.ok(map.totalOre() >= 80000);
      }
    });
  }
});
