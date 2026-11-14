/** The tile grid: terrain, crystal ore and which structure occupies each tile. */

export const GRASS = 0;
export const ROCK = 1;
export const WATER = 2;

export class GameMap {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.terrain = new Uint8Array(width * height);
    this.ore = new Uint16Array(width * height); // credits left on each tile
    this.oreMax = new Uint16Array(width * height); // regrowth cap
    this.blocked = new Int32Array(width * height); // structure id, 0 = free
  }

  index(x, y) {
    return y * this.width + x;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  terrainAt(x, y) {
    return this.inside(x, y) ? this.terrain[this.index(x, y)] : ROCK;
  }

  oreAt(x, y) {
    return this.inside(x, y) ? this.ore[this.index(x, y)] : 0;
  }

  /** Ground units can stand here. */
  passable(x, y) {
    if (!this.inside(x, y)) return false;
    const i = this.index(x, y);
    return this.terrain[i] === GRASS && this.blocked[i] === 0;
  }

  /** A structure may cover this tile (clear grass, no ore, no structure). */
  buildable(x, y) {
    if (!this.inside(x, y)) return false;
    const i = this.index(x, y);
    return this.terrain[i] === GRASS && this.blocked[i] === 0 && this.ore[i] === 0;
  }

  setBlocked(building, id) {
    for (let y = building.ty; y < building.ty + building.h; y += 1) {
      for (let x = building.tx; x < building.tx + building.w; x += 1) this.blocked[this.index(x, y)] = id;
    }
  }

  totalOre() {
    let sum = 0;
    for (const amount of this.ore) sum += amount;
    return sum;
  }
}
