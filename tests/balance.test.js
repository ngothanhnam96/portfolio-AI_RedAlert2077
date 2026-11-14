import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aiController } from "../src/core/ai.js";
import { Game } from "../src/core/game.js";
import { cost, fight } from "./support/fight.js";

const LIMIT_MIN = 25;

const STALEMATE_MIN = 35; // an even mirror match may grind for a while, but must end

function match(a, b, seed, size = 48, limit = LIMIT_MIN) {
  const game = new Game({ seed, size, controllers: [aiController(a), aiController(b)] });
  while (!game.over && game.tick < limit * 60 * 20) game.step();
  return { winner: game.winner, minutes: game.tick / 1200 };
}

describe("counter triangle: cost-equal fights (NFR-4)", () => {
  const cases = [
    ["riflemen beat rocket troopers", [["rifle", 10]], [["rocket", 4]]],
    ["rocket troopers beat Báo tanks", [["rocket", 6]], [["tank", 2]]],
    ["Báo tanks beat riflemen", [["tank", 2]], [["rifle", 14]]],
    ["scouts hunt riflemen", [["scout", 2]], [["rifle", 7]]],
    ["rocket troopers beat the Voi heavy tank", [["rocket", 5]], [["heavy", 1]]],
  ];
  for (const [name, a, b] of cases) {
    it(name, () => {
      const ratio = cost(a) / cost(b);
      assert.ok(ratio >= 0.95 && ratio <= 1.1, `costs ${cost(a)} vs ${cost(b)} are not equal`);
      const result = fight(a, b);
      assert.equal(result.winner, 0, `${name}: ${JSON.stringify(result)}`);
      assert.ok(result.left[0] >= 0.3, `${name}: won with only ${(result.left[0] * 100).toFixed(0)}% left: not a clear counter`);
    });
  }

  it("the triangle is not symmetric: swapping sides gives the same result", () => {
    const left = fight([["tank", 2]], [["rifle", 14]]);
    const right = fight([["rifle", 14]], [["tank", 2]]);
    assert.equal(left.winner, 0);
    assert.equal(right.winner, 1);
  });
});

describe("AI ladder over several seeds (NFR-4, FR-12)", () => {
  it("Khó beats Dễ from either side", () => {
    for (const seed of [2, 3]) {
      assert.equal(match("hard", "easy", seed).winner, 0, `seed ${seed} hard first`);
      assert.equal(match("easy", "hard", seed).winner, 1, `seed ${seed} hard second`);
    }
  });

  it("Thường beats Dễ", () => {
    for (const seed of [4, 7]) assert.equal(match("normal", "easy", seed).winner, 0, `seed ${seed}`);
  });

  it("Khó beats Thường in most games", () => {
    let wins = 0;
    for (const seed of [2, 4, 7]) {
      if (match("hard", "normal", seed).winner === 0) wins += 1;
      if (match("normal", "hard", seed).winner === 1) wins += 1;
    }
    assert.ok(wins >= 5, `hard won ${wins}/6`);
  });

  it(`even mirror matches end within ${STALEMATE_MIN} minutes (no stalemates), on both map sizes`, () => {
    for (const [a, b, seed, size] of [["normal", "normal", 2, 48], ["normal", "normal", 3, 48], ["hard", "hard", 5, 48], ["normal", "normal", 6, 64]]) {
      const result = match(a, b, seed, size, STALEMATE_MIN);
      assert.notEqual(result.winner, null, `${a} vs ${b} seed ${seed} size ${size} did not finish`);
    }
  });
});
