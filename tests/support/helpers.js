import { Game } from "../../src/core/game.js";
import { GameMap, GRASS, ROCK, WATER } from "../../src/core/map.js";

/**
 * Builds a map from ASCII rows: "." grass, "#" rock, "~" water, "*" ore (500).
 * Starts default to near the top-left and bottom-right corners.
 */
export function mapFrom(rows, starts = null) {
  const height = rows.length;
  const width = rows[0].length;
  const map = new GameMap(width, height);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const i = map.index(x, y);
      map.terrain[i] = ch === "#" ? ROCK : ch === "~" ? WATER : GRASS;
      if (ch === "*") {
        map.ore[i] = 500;
        map.oreMax[i] = 500;
      }
    });
  });
  return { map, starts: starts ?? [{ x: 3, y: 3 }, { x: width - 4, y: height - 4 }] };
}

/** An open grass field of the given size. */
export function openMap(width = 40, height = 40, starts = null) {
  return mapFrom(Array.from({ length: height }, () => ".".repeat(width)), starts);
}

/** A game on an open field with no bases: spawn exactly what a test needs. */
export function arena({ width = 40, height = 40, credits = 0 } = {}) {
  return new Game({ map: openMap(width, height), bases: false, credits, startUnits: [] });
}

/** Steps until `done()` is true or `seconds` pass. Returns the seconds taken (Infinity on timeout). */
export function runUntil(game, done, seconds = 60) {
  const start = game.tick;
  const limit = start + seconds * 20;
  while (game.tick < limit) {
    if (done()) return (game.tick - start) / 20;
    game.step();
    if (game.over && !done()) return Infinity;
  }
  return done() ? (game.tick - start) / 20 : Infinity;
}

export function seconds(game, s) {
  for (let i = 0; i < s * 20 && !game.over; i += 1) game.step();
}

export const alive = (game, owner, type) => game.owned(owner, (e) => !type || e.type === type).length;
