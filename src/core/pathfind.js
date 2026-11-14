/**
 * Grid A*: 8 directions, octile heuristic, no cutting corners past blocked tiles. If the goal
 * cannot be reached, returns the path to the reachable tile closest to it. Paths are smoothed
 * with line-of-sight so units move in straight lines where they can.
 */

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(node, priority) {
    const items = this.items;
    items.push({ node, priority });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].priority <= items[i].priority) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l].priority < items[m].priority) m = l;
        if (r < items.length && items[r].priority < items[m].priority) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top.node;
  }
}

const octile = (dx, dy) => {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return Math.max(ax, ay) + (SQRT2 - 1) * Math.min(ax, ay);
};

/**
 * @returns {{x:number,y:number}[] | null} tiles from (excluding) start to goal (or the closest
 * reachable tile); [] if already there; null if the start itself is unusable.
 */
export function findPath(map, sx, sy, gx, gy, { maxNodes = 20000 } = {}) {
  const w = map.width;
  if (!map.inside(sx, sy)) return null;
  gx = Math.max(0, Math.min(map.width - 1, gx));
  gy = Math.max(0, Math.min(map.height - 1, gy));
  const start = sy * w + sx;
  const goal = gy * w + gx;
  if (start === goal) return [];

  const cost = new Float64Array(map.width * map.height).fill(Infinity);
  const from = new Int32Array(map.width * map.height).fill(-1);
  const closed = new Uint8Array(map.width * map.height);
  const open = new MinHeap();
  cost[start] = 0;
  open.push(start, octile(gx - sx, gy - sy));
  let best = start;
  let bestH = octile(gx - sx, gy - sy);
  let expanded = 0;

  while (open.size && expanded < maxNodes) {
    const current = open.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    expanded += 1;
    if (current === goal) {
      best = goal;
      break;
    }
    const cx = current % w;
    const cy = (current - cx) / w;
    const h = octile(gx - cx, gy - cy);
    if (h < bestH || (h === bestH && cost[current] < cost[best])) {
      bestH = h;
      best = current;
    }
    for (const [dx, dy, step] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!map.passable(nx, ny)) continue;
      if (dx && dy && (!map.passable(cx + dx, cy) || !map.passable(cx, cy + dy))) continue;
      const next = ny * w + nx;
      if (closed[next]) continue;
      const g = cost[current] + step;
      if (g < cost[next]) {
        cost[next] = g;
        from[next] = current;
        open.push(next, g + octile(gx - nx, gy - ny));
      }
    }
  }

  const path = [];
  for (let node = best; node !== start && node !== -1; node = from[node]) {
    const x = node % w;
    path.push({ x, y: (node - x) / w });
  }
  return path.reverse();
}

/** Line of sight between tile centres: every tile the segment touches must be passable. */
export function lineOfSight(map, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 3);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const px = x0 + 0.5 + dx * t;
    const py = y0 + 0.5 + dy * t;
    // Check a small cross so units with some width do not clip corners.
    for (const [ox, oy] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
      if (!map.passable(Math.floor(px + ox), Math.floor(py + oy))) return false;
    }
  }
  return true;
}

/** Removes waypoints that can be skipped in a straight line. */
export function smoothPath(map, sx, sy, path) {
  if (path.length < 3) return path;
  const out = [];
  let ax = sx;
  let ay = sy;
  let i = 0;
  while (i < path.length) {
    let j = path.length - 1;
    while (j > i && !lineOfSight(map, ax, ay, path[j].x, path[j].y)) j -= 1;
    out.push(path[j]);
    ax = path[j].x;
    ay = path[j].y;
    i = j + 1;
  }
  return out;
}

/** Path length in tiles (for tests and the AI). */
export function pathLength(sx, sy, path) {
  let length = 0;
  let px = sx;
  let py = sy;
  for (const p of path) {
    length += Math.hypot(p.x - px, p.y - py);
    px = p.x;
    py = p.y;
  }
  return length;
}
