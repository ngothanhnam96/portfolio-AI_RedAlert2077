/**
 * Procedural skirmish maps. Point-symmetric (180° rotation) so both players get the same
 * distances to ore and to each other; repaired so every ore field and both bases are
 * connected by land. Verified by tests/mapgen.test.js over many seeds.
 */

import { GameMap, GRASS, ROCK, WATER } from "./map.js";
import { mulberry32 } from "./rng.js";

export const MAP_SIZES = { small: 48, medium: 64 };
const START_INSET = 7; // HQ centre distance from the corner
const CLEAR_RADIUS = 8;

function valueNoise(rng, width, height, cell) {
  const gw = Math.ceil(width / cell) + 2;
  const gh = Math.ceil(height / cell) + 2;
  const grid = Array.from({ length: gw * gh }, () => rng());
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = smooth(gx - x0);
    const fy = smooth(gy - y0);
    const at = (i, j) => grid[(y0 + j) * gw + (x0 + i)];
    const top = at(0, 0) * (1 - fx) + at(1, 0) * fx;
    const bottom = at(0, 1) * (1 - fx) + at(1, 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

/** Flood fill over passable terrain from (sx, sy); returns a Uint8Array mask. */
export function reachable(map, sx, sy) {
  const seen = new Uint8Array(map.width * map.height);
  if (map.terrainAt(sx, sy) !== GRASS) return seen;
  const stack = [map.index(sx, sy)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % map.width;
    const y = (i - x) / map.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inside(nx, ny)) continue;
      const j = map.index(nx, ny);
      if (!seen[j] && map.terrain[j] === GRASS) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return seen;
}

export function generateMap({ seed = 1, size = MAP_SIZES.small } = {}) {
  const rng = mulberry32(seed);
  const width = size;
  const height = size;
  const map = new GameMap(width, height);
  const rocks = valueNoise(rng, width, height, 7);
  const rocks2 = valueNoise(rng, width, height, 3);
  const lakes = valueNoise(rng, width, height, 11);
  const starts = [
    { x: START_INSET, y: START_INSET },
    { x: width - 1 - START_INSET, y: height - 1 - START_INSET },
  ];
  const mirror = (x, y) => [width - 1 - x, height - 1 - y];
  const set = (x, y, t) => {
    map.terrain[map.index(x, y)] = t;
    const [mx, my] = mirror(x, y);
    map.terrain[map.index(mx, my)] = t;
  };

  // Terrain from noise, generated on one half and mirrored.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (map.index(x, y) > map.index(...mirror(x, y))) continue;
      const r = rocks(x, y) * 0.7 + rocks2(x, y) * 0.3;
      const w = lakes(x, y);
      let t = GRASS;
      if (w > 0.74) t = WATER;
      else if (r > 0.66) t = ROCK;
      set(x, y, t);
    }
  }

  // Clear the bases.
  for (let y = -CLEAR_RADIUS; y <= CLEAR_RADIUS; y += 1) {
    for (let x = -CLEAR_RADIUS; x <= CLEAR_RADIUS; x += 1) {
      const px = starts[0].x + x;
      const py = starts[0].y + y;
      if (map.inside(px, py) && x * x + y * y <= CLEAR_RADIUS * CLEAR_RADIUS) set(px, py, GRASS);
    }
  }

  // Carves a 3-wide land corridor from a to b (and its mirror image).
  const carve = (a, b, wiggle = 0) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2) + 1;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const cx = Math.round(a.x + (b.x - a.x) * t);
      const cy = Math.round(a.y + (b.y - a.y) * t + Math.sin(t * Math.PI * 2) * wiggle);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (map.inside(cx + dx, cy + dy)) set(cx + dx, cy + dy, GRASS);
    }
  };

  // Guarantee a land route between the bases (the diagonal maps onto itself under the 180°
  // rotation, so symmetry is kept).
  if (!reachable(map, starts[0].x, starts[0].y)[map.index(starts[1].x, starts[1].y)]) carve(starts[0], starts[1], 3);

  // Crystal ore: a field near each base and two contested fields between them.
  const fields = [];
  const toward = { x: width / 2 - starts[0].x, y: height / 2 - starts[0].y };
  const len = Math.hypot(toward.x, toward.y);
  const dir = { x: toward.x / len, y: toward.y / len };
  const side = { x: -dir.y, y: dir.x };
  const jitter = () => (rng() - 0.5) * 3;
  fields.push({ x: starts[0].x + dir.x * 9 + side.x * 5 + jitter(), y: starts[0].y + dir.y * 9 + side.y * 5 + jitter(), r: 3, rich: 1.5 });
  fields.push({ x: starts[0].x + dir.x * 8 - side.x * 9 + jitter(), y: starts[0].y + dir.y * 8 - side.y * 9 + jitter(), r: 2.8, rich: 1.4 });
  const mid = 0.38 + rng() * 0.06;
  fields.push({
    x: starts[0].x + toward.x * 2 * mid - side.x * (6 + rng() * 4),
    y: starts[0].y + toward.y * 2 * mid - side.y * (6 + rng() * 4),
    r: 3.4,
    rich: 1.8,
  });
  for (const field of fields) {
    const r = Math.ceil(field.r);
    for (let y = Math.floor(field.y) - r; y <= Math.floor(field.y) + r; y += 1) {
      for (let x = Math.floor(field.x) - r; x <= Math.floor(field.x) + r; x += 1) {
        const d = Math.hypot(x + 0.5 - field.x, y + 0.5 - field.y);
        if (!map.inside(x, y) || d > field.r) continue;
        set(x, y, GRASS);
        const amount = Math.round((300 + 200 * (1 - d / field.r)) * field.rich);
        for (const [px, py] of [[x, y], mirror(x, y)]) {
          const i = map.index(px, py);
          map.ore[i] = amount;
          map.oreMax[i] = amount;
        }
      }
    }
  }

  // Every field must be reachable from its base, or the tidy-up below would delete it.
  const reach0 = reachable(map, starts[0].x, starts[0].y);
  for (const field of fields) {
    const fx = Math.floor(field.x);
    const fy = Math.floor(field.y);
    if (!map.inside(fx, fy) || !reach0[map.index(fx, fy)]) carve(starts[0], { x: fx, y: fy });
  }

  // Tidy up: land that cannot be reached from the bases becomes rock, so nothing spawns or
  // gets stranded there (reachability is symmetric because the bases are connected).
  const reach = reachable(map, starts[0].x, starts[0].y);
  for (let i = 0; i < map.terrain.length; i += 1) {
    if (map.terrain[i] === GRASS && !reach[i]) {
      map.terrain[i] = ROCK;
      map.ore[i] = 0;
      map.oreMax[i] = 0;
    }
  }
  return { map, starts };
}
