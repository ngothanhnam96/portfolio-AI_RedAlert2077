import { UNITS } from "../../src/core/rules.js";
import { arena } from "./helpers.js";

/**
 * Cost-equal skirmish on open ground: side A (left) vs side B (right), both attack-moving
 * at each other. Returns the winner (0, 1 or null on timeout) and the surviving value share.
 */
export function fight(a, b, { seconds = 120 } = {}) {
  const game = arena({ width: 48, height: 32 });
  const place = (owner, groups, x0, dir) => {
    let i = 0;
    for (const [type, n] of groups) {
      for (let k = 0; k < n; k += 1, i += 1) {
        game.spawn(owner, type, x0 + dir * Math.floor(i / 6) * 1.1, 13 + (i % 6) * 1.1);
      }
    }
  };
  place(0, a, 8.5, -1);
  place(1, b, 39.5, 1);
  game.refreshVision();
  for (const owner of [0, 1]) {
    const ids = game.owned(owner).map((e) => e.id);
    game.command(owner, { type: "move", ids, x: owner ? 6.5 : 41.5, y: 16, attackMove: true });
  }
  const limit = seconds * 20;
  while (!game.over && game.tick < limit) game.step();
  const value = (owner) => game.owned(owner).reduce((s, e) => s + UNITS[e.type].cost * (e.hp / e.maxHp), 0);
  const total = (groups) => groups.reduce((s, [type, n]) => s + UNITS[type].cost * n, 0);
  return {
    winner: game.over ? game.winner : null,
    left: [value(0) / total(a), value(1) / total(b)],
    seconds: game.tick / 20,
  };
}

export const cost = (groups) => groups.reduce((s, [type, n]) => s + UNITS[type].cost * n, 0);
