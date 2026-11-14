/** Visual-only effects: particles, tracers, floating text, scorch marks. Never touch the simulation. */

export class Effects {
  constructor() {
    this.particles = [];
    this.tracers = [];
    this.texts = [];
    this.scorch = [];
    this.flashes = [];
    this.rings = [];
  }

  /** Command feedback: a shrinking ring where an order was given. */
  ring(x, y, color = "#7cf29a") {
    this.rings.push({ x, y, color, life: 0.45, max: 0.45 });
  }

  clear() {
    this.rings.length = 0;
    this.particles.length = 0;
    this.tracers.length = 0;
    this.texts.length = 0;
    this.scorch.length = 0;
    this.flashes.length = 0;
  }

  tracer(x, y, tx, ty, color = "#ffe9a0") {
    this.tracers.push({ x, y, tx, ty, life: 0.08, max: 0.08, color });
  }

  flash(x, y, size = 0.35) {
    this.flashes.push({ x, y, size, life: 0.07, max: 0.07 });
  }

  explosion(x, y, size = 1) {
    const n = Math.round(10 + size * 14);
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 2.2) * size;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.4 + Math.random() * 0.5 * size,
        max: 0.9 * size + 0.3,
        size: (0.08 + Math.random() * 0.18) * Math.sqrt(size),
        kind: Math.random() < 0.55 ? "fire" : "smoke",
      });
    }
    this.flashes.push({ x, y, size: 0.6 * size + 0.4, life: 0.12, max: 0.12 });
    if (size >= 1) this.scorch.push({ x, y, r: 0.35 + size * 0.3, life: 40 });
    if (this.scorch.length > 120) this.scorch.shift();
  }

  smoke(x, y) {
    this.particles.push({ x, y, vx: (Math.random() - 0.5) * 0.2, vy: -0.4 - Math.random() * 0.3, life: 1.4, max: 1.4, size: 0.12 + Math.random() * 0.1, kind: "smoke" });
  }

  text(x, y, text, color = "#7cf29a") {
    this.texts.push({ x, y, text, color, life: 1.4, max: 1.4 });
  }

  update(dt) {
    for (const list of [this.particles, this.tracers, this.texts, this.flashes, this.rings]) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) {
          list.splice(i, 1);
          continue;
        }
        if (p.vx !== undefined) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.92;
          p.vy *= 0.92;
          if (p.kind === "smoke") p.vy -= 0.3 * dt;
        }
        if (list === this.texts) p.y -= 0.6 * dt;
      }
    }
    for (let i = this.scorch.length - 1; i >= 0; i -= 1) {
      this.scorch[i].life -= dt;
      if (this.scorch[i].life <= 0) this.scorch.splice(i, 1);
    }
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }
}
