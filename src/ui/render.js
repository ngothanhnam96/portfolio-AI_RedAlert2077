/**
 * Canvas renderer: code-drawn terrain, ore, structures, units, projectiles, effects and fog of
 * war. Reads the simulation; never changes it. World units are tiles; TILE pixels per tile at
 * zoom 1.
 */

import { BUILDINGS, UNITS } from "../core/rules.js";
import { mulberry32 } from "../core/rng.js";
import { GRASS, ROCK, WATER } from "../core/map.js";

export const TILE = 32;

export const TEAM = [
  { main: "#3b82f6", dark: "#1d4ed8", light: "#93c5fd", name: "Xanh" },
  { main: "#ef4444", dark: "#b91c1c", light: "#fca5a5", name: "Đỏ" },
];

const rgb = (hex, a = 1) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Pre-renders the static terrain of a map into an offscreen canvas. */
export function terrainCanvas(map) {
  const canvas = document.createElement("canvas");
  canvas.width = map.width * TILE;
  canvas.height = map.height * TILE;
  const ctx = canvas.getContext("2d");
  const rng = mulberry32(map.width * 7919 + map.height);
  const at = (x, y) => map.terrainAt(x, y);
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const t = at(x, y);
      const px = x * TILE;
      const py = y * TILE;
      if (t === GRASS) {
        const shade = 0.9 + rng() * 0.2;
        ctx.fillStyle = `rgb(${Math.round(70 * shade)},${Math.round(104 * shade)},${Math.round(52 * shade)})`;
        ctx.fillRect(px, py, TILE, TILE);
        for (let k = 0; k < 5; k += 1) {
          ctx.fillStyle = rng() < 0.5 ? "rgba(255,255,200,0.06)" : "rgba(0,0,0,0.08)";
          ctx.fillRect(px + rng() * TILE, py + rng() * TILE, 2, 2);
        }
      } else if (t === WATER) {
        ctx.fillStyle = "#1f4f7a";
        ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = "rgba(160,210,255,0.18)";
        ctx.beginPath();
        const wy = py + 8 + rng() * 16;
        ctx.moveTo(px + 4, wy);
        ctx.quadraticCurveTo(px + 16, wy - 4, px + 28, wy);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#6f655a";
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = "#857a6c";
        ctx.beginPath();
        ctx.moveTo(px + 3 + rng() * 6, py + 6 + rng() * 6);
        ctx.lineTo(px + 14 + rng() * 10, py + 2 + rng() * 6);
        ctx.lineTo(px + 26 + rng() * 4, py + 14 + rng() * 8);
        ctx.lineTo(px + 10 + rng() * 8, py + 26 + rng() * 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(px + rng() * 20, py + rng() * 20, 6, 2);
      }
    }
  }
  // Soft shadows along rock and shore edges.
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (at(x, y) !== GRASS) continue;
      const px = x * TILE;
      const py = y * TILE;
      if (at(x, y - 1) === ROCK) {
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(px, py, TILE, 5);
      }
      if (at(x - 1, y) === ROCK) {
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.fillRect(px, py, 4, TILE);
      }
      for (const [dx, dy, rx, ry, rw, rh] of [[0, -1, 0, 0, TILE, 3], [0, 1, 0, TILE - 3, TILE, 3], [-1, 0, 0, 0, 3, TILE], [1, 0, TILE - 3, 0, 3, TILE]]) {
        if (at(x + dx, y + dy) === WATER) {
          ctx.fillStyle = "rgba(220,200,140,0.55)";
          ctx.fillRect(px + rx, py + ry, rw, rh);
        }
      }
    }
  }
  return canvas;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const fog = document.createElement("canvas");
  const fogCtx = fog.getContext("2d");
  let terrain = null;
  let terrainMap = null;
  let fogData = null;

  function ensureCaches(map) {
    if (terrainMap === map) return;
    terrainMap = map;
    terrain = terrainCanvas(map);
    fog.width = map.width;
    fog.height = map.height;
    fogData = fogCtx.createImageData(map.width, map.height);
  }

  /**
   * @param {object} s
   * @param {import("../core/game.js").Game} s.game
   * @param {{x:number,y:number,zoom:number}} s.camera top-left in tiles
   * @param {number} s.viewer player id, or -1 for a spectator (no fog)
   */
  function draw(s) {
    const { game, camera, viewer, effects, alpha, time } = s;
    const map = game.map;
    ensureCaches(map);
    const dpr = window.devicePixelRatio || 1;
    const scale = TILE * camera.zoom * dpr;
    const viewW = canvas.width / scale;
    const viewH = canvas.height / scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Terrain (cached), in screen pixels for crispness.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrain, camera.x * TILE, camera.y * TILE, viewW * TILE, viewH * TILE, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale);
    ctx.imageSmoothingEnabled = true;

    const x0 = Math.max(0, Math.floor(camera.x) - 1);
    const y0 = Math.max(0, Math.floor(camera.y) - 1);
    const x1 = Math.min(map.width - 1, Math.ceil(camera.x + viewW) + 1);
    const y1 = Math.min(map.height - 1, Math.ceil(camera.y + viewH) + 1);
    const inView = (x, y, m = 2) => x > camera.x - m && y > camera.y - m && x < camera.x + viewW + m && y < camera.y + viewH + m;
    const explored = (x, y) => viewer < 0 || game.players[viewer].explored[map.index(x, y)];

    // Scorch marks.
    for (const sc of effects.scorch) {
      if (!inView(sc.x, sc.y)) continue;
      ctx.fillStyle = `rgba(20,14,8,${Math.min(0.45, sc.life / 20)})`;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, sc.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Crystal ore.
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const amount = map.ore[map.index(x, y)];
        if (!amount || !explored(x, y)) continue;
        drawOre(ctx, x, y, amount, time);
      }
    }

    // Structures (enemy ones only once explored).
    for (const e of game.entities.values()) {
      if (e.kind !== "building" || !inView(e.x, e.y, 4)) continue;
      if (viewer >= 0 && e.owner !== viewer && !explored(Math.floor(e.x), Math.floor(e.y))) continue;
      drawBuilding(ctx, e, game, time, s.selection?.has(e.id));
    }

    // Rally point of a selected producer.
    if (viewer >= 0 && s.selection) {
      for (const id of s.selection) {
        const e = game.entity(id);
        const rally = e && game.players[viewer].rally[e.id];
        if (!rally) continue;
        ctx.strokeStyle = "rgba(124,242,154,0.7)";
        ctx.lineWidth = 0.05;
        ctx.setLineDash([0.2, 0.15]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(rally.x, rally.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#7cf29a";
        ctx.fillRect(rally.x - 0.02, rally.y - 0.5, 0.04, 0.5);
        ctx.beginPath();
        ctx.moveTo(rally.x, rally.y - 0.5);
        ctx.lineTo(rally.x + 0.3, rally.y - 0.4);
        ctx.lineTo(rally.x, rally.y - 0.3);
        ctx.fill();
      }
    }

    // Units (enemy ones only when visible).
    const units = [];
    for (const e of game.entities.values()) {
      if (e.kind !== "unit") continue;
      const x = e._px !== undefined ? e._px + (e.x - e._px) * alpha : e.x;
      const y = e._py !== undefined ? e._py + (e.y - e._py) * alpha : e.y;
      if (!inView(x, y)) continue;
      if (viewer >= 0 && e.owner !== viewer && !game.isVisible(viewer, e.x, e.y)) continue;
      units.push([e, x, y]);
    }
    units.sort((a, b) => (UNITS[a[0].type].category === "infantry") - (UNITS[b[0].type].category === "infantry"));
    for (const [e, x, y] of units) drawUnit(ctx, e, x, y, time, s.selection?.has(e.id));

    // Projectiles.
    for (const p of game.projectiles) {
      if (!inView(p.x, p.y)) continue;
      if (viewer >= 0 && !game.isVisible(viewer, p.x, p.y)) continue;
      drawProjectile(ctx, p);
    }

    // Effects.
    for (const t of effects.tracers) {
      ctx.strokeStyle = rgb("#ffe9a0", t.life / t.max);
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.tx, t.ty);
      ctx.stroke();
    }
    for (const p of effects.particles) {
      const k = p.life / p.max;
      ctx.fillStyle = p.kind === "fire" ? `rgba(255,${Math.round(120 + 120 * k)},40,${Math.min(1, k * 1.4)})` : `rgba(60,60,60,${k * 0.5})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.kind === "smoke" ? 2 - k : 1), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const f of effects.flashes) {
      const k = f.life / f.max;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.size);
      g.addColorStop(0, `rgba(255,250,210,${k})`);
      g.addColorStop(1, "rgba(255,160,40,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const r of effects.rings) {
      const k = r.life / r.max;
      ctx.strokeStyle = rgb(r.color, k);
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 0.2 + k * 0.4, (0.2 + k * 0.4) * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Health bars for selected or damaged things.
    for (const e of game.entities.values()) {
      if (!inView(e.x, e.y, 3)) continue;
      const selected = s.selection?.has(e.id);
      if (!selected && e.hp >= e.maxHp) continue;
      if (viewer >= 0 && e.owner !== viewer && !game.canSee(viewer, e)) continue;
      const x = e.kind === "unit" && e._px !== undefined ? e._px + (e.x - e._px) * alpha : e.x;
      const y = e.kind === "unit" && e._py !== undefined ? e._py + (e.y - e._py) * alpha : e.y;
      const w = e.kind === "building" ? e.w * 0.9 : Math.max(0.6, e.radius * 2.2);
      const top = e.kind === "building" ? e.ty - 0.25 : y - e.radius - 0.32;
      const k = e.hp / e.maxHp;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(x - w / 2 - 0.03, top - 0.03, w + 0.06, 0.16);
      ctx.fillStyle = k > 0.6 ? "#4ade80" : k > 0.3 ? "#facc15" : "#ef4444";
      ctx.fillRect(x - w / 2, top, w * k, 0.1);
      if (e.type === "harvester" && e.owner === viewer) {
        ctx.fillStyle = "#67e8f9";
        ctx.fillRect(x - w / 2, top + 0.13, w * (e.cargo / UNITS.harvester.capacity), 0.06);
      }
    }

    // Floating texts.
    ctx.textAlign = "center";
    ctx.font = "bold 0.42px system-ui, sans-serif";
    for (const t of effects.texts) {
      ctx.fillStyle = rgb(t.color, Math.min(1, t.life / t.max * 1.5));
      ctx.fillText(t.text, t.x, t.y);
    }

    // Fog of war: one pixel per tile, scaled up with smoothing for soft edges.
    if (viewer >= 0) {
      const p = game.players[viewer];
      const d = fogData.data;
      for (let i = 0; i < p.visible.length; i += 1) {
        d[i * 4 + 3] = p.visible[i] ? 0 : p.explored[i] ? 120 : 255;
      }
      fogCtx.putImageData(fogData, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fog, 0, 0, map.width, map.height);
    }

    // Placement ghost.
    if (s.placement) {
      const { type, tx, ty, ok } = s.placement;
      const rule = BUILDINGS[type];
      for (let y = ty; y < ty + rule.h; y += 1) {
        for (let x = tx; x < tx + rule.w; x += 1) {
          ctx.fillStyle = ok && map.buildable(x, y) ? "rgba(74,222,128,0.4)" : "rgba(239,68,68,0.45)";
          ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.92);
        }
      }
      ctx.strokeStyle = ok ? "#4ade80" : "#ef4444";
      ctx.lineWidth = 0.06;
      ctx.strokeRect(tx, ty, rule.w, rule.h);
    }

    // Selection box (screen space).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (s.box) {
      const { x0: bx0, y0: by0, x1: bx1, y1: by1 } = s.box;
      ctx.strokeStyle = "#7cf29a";
      ctx.lineWidth = 1 * dpr;
      ctx.fillStyle = "rgba(124,242,154,0.08)";
      ctx.fillRect(Math.min(bx0, bx1) * dpr, Math.min(by0, by1) * dpr, Math.abs(bx1 - bx0) * dpr, Math.abs(by1 - by0) * dpr);
      ctx.strokeRect(Math.min(bx0, bx1) * dpr, Math.min(by0, by1) * dpr, Math.abs(bx1 - bx0) * dpr, Math.abs(by1 - by0) * dpr);
    }
  }

  return { draw, get terrain() { return terrain; } };
}

// Sprites --------------------------------------------------------------------------------------

function drawOre(ctx, x, y, amount, time) {
  const rng = mulberry32(x * 92821 + y * 68917);
  const n = Math.min(5, 1 + Math.floor(amount / 140));
  for (let i = 0; i < n; i += 1) {
    const cx = x + 0.2 + rng() * 0.6;
    const cy = y + 0.2 + rng() * 0.6;
    const h = 0.18 + rng() * 0.18;
    const glow = 0.75 + Math.sin(time * 2 + x + y * 1.7 + i) * 0.15;
    ctx.fillStyle = `rgba(40,${Math.round(200 * glow)},${Math.round(190 * glow)},0.95)`;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + h * 0.45, cy);
    ctx.lineTo(cx, cy + h * 0.5);
    ctx.lineTo(cx - h * 0.45, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(220,255,250,0.6)";
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + h * 0.2, cy - h * 0.3);
    ctx.lineTo(cx, cy - h * 0.1);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBuilding(ctx, b, game, time, selected) {
  const team = TEAM[b.owner];
  const { tx, ty, w, h } = b;
  const cx = tx + w / 2;
  const cy = ty + h / 2;
  const offline = BUILDINGS[b.type].power < 0 && game.lowPower(b.owner);
  // Shadow and pad.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(tx + 0.12, ty + 0.16, w, h);
  ctx.fillStyle = "#4b5563";
  ctx.fillRect(tx + 0.05, ty + 0.05, w - 0.1, h - 0.1);
  ctx.fillStyle = "#6b7280";
  ctx.fillRect(tx + 0.12, ty + 0.12, w - 0.24, h - 0.24);

  switch (b.type) {
    case "hq": {
      ctx.fillStyle = "#9ca3af";
      ctx.fillRect(tx + 0.35, ty + 0.35, w - 0.7, h - 0.7);
      ctx.fillStyle = team.main;
      ctx.beginPath();
      ctx.arc(cx, cy, 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = team.light;
      ctx.beginPath();
      ctx.arc(cx - 0.2, cy - 0.25, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(tx + w - 0.5, ty + 0.5);
      ctx.lineTo(tx + w - 0.5, ty - 0.3);
      ctx.stroke();
      ctx.fillStyle = Math.sin(time * 4) > 0 ? "#f87171" : "#7f1d1d";
      ctx.fillRect(tx + w - 0.58, ty - 0.38, 0.16, 0.16);
      break;
    }
    case "power": {
      for (const ox of [0.55, 1.45]) {
        ctx.fillStyle = "#d1d5db";
        ctx.beginPath();
        ctx.arc(tx + ox, cy, 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#374151";
        ctx.beginPath();
        ctx.arc(tx + ox, cy, 0.24, 0, Math.PI * 2);
        ctx.fill();
        if (!offline) {
          ctx.fillStyle = `rgba(250,204,21,${0.5 + Math.sin(time * 6 + ox) * 0.3})`;
          ctx.beginPath();
          ctx.arc(tx + ox, cy, 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = team.main;
      ctx.fillRect(tx + 0.2, ty + h - 0.32, w - 0.4, 0.14);
      break;
    }
    case "refinery": {
      ctx.fillStyle = "#9ca3af";
      ctx.fillRect(tx + 0.2, ty + 0.2, 1.6, 1.1);
      for (const [ox, oy] of [[2.3, 0.55], [2.3, 1.25]]) {
        ctx.fillStyle = "#cbd5e1";
        ctx.beginPath();
        ctx.arc(tx + ox, ty + oy, 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#22d3ee";
        ctx.beginPath();
        ctx.arc(tx + ox, ty + oy, 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = team.main;
      ctx.fillRect(tx + 0.3, ty + 0.3, 1.4, 0.25);
      // Dock marker.
      ctx.strokeStyle = "rgba(250,204,21,0.8)";
      ctx.lineWidth = 0.05;
      ctx.setLineDash([0.12, 0.1]);
      ctx.strokeRect(tx + 1.1, ty + h + 0.08, 0.8, 0.8);
      ctx.setLineDash([]);
      break;
    }
    case "barracks": {
      ctx.fillStyle = "#a3a380";
      ctx.beginPath();
      ctx.moveTo(tx + 0.2, ty + h - 0.3);
      ctx.lineTo(cx, ty + 0.25);
      ctx.lineTo(tx + w - 0.2, ty + h - 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#4b4b33";
      ctx.fillRect(cx - 0.2, ty + h - 0.7, 0.4, 0.45);
      ctx.fillStyle = team.main;
      ctx.fillRect(tx + w - 0.45, ty + 0.15, 0.28, 0.18);
      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(tx + w - 0.48, ty + 0.12, 0.04, 0.6);
      break;
    }
    case "factory": {
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(tx + 0.25, ty + 0.25, w - 0.5, h - 0.9);
      for (let i = 0; i < 4; i += 1) {
        ctx.fillStyle = i % 2 ? "#64748b" : "#7c8aa0";
        ctx.fillRect(tx + 0.25, ty + 0.25 + i * 0.45, w - 0.5, 0.45);
      }
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(cx - 0.75, ty + h - 0.65, 1.5, 0.5);
      ctx.fillStyle = "#facc15";
      for (let i = 0; i < 5; i += 1) ctx.fillRect(cx - 0.75 + i * 0.32, ty + h - 0.65, 0.16, 0.08);
      ctx.fillStyle = team.main;
      ctx.fillRect(tx + 0.25, ty + 0.25, 0.3, h - 0.9);
      break;
    }
    case "radar": {
      ctx.fillStyle = "#9ca3af";
      ctx.fillRect(tx + 0.3, ty + 0.3, w - 0.6, h - 0.6);
      const a = offline ? 0.6 : time * 1.5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.fillStyle = "#e5e7eb";
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.7, 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = team.main;
      ctx.fillRect(-0.05, -0.05, 0.6, 0.1);
      ctx.restore();
      break;
    }
    case "turret": {
      ctx.fillStyle = "#9ca3af";
      ctx.beginPath();
      ctx.arc(cx, cy, 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(b.turret);
      ctx.fillStyle = "#374151";
      ctx.fillRect(0, -0.07, 0.6, 0.14);
      ctx.fillStyle = team.main;
      ctx.beginPath();
      ctx.arc(0, 0, 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "tech": {
      ctx.fillStyle = "#cbd5e1";
      ctx.fillRect(tx + 0.25, ty + 0.25, w - 0.5, h - 0.5);
      const glow = offline ? 0.2 : 0.6 + Math.sin(time * 3) * 0.3;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.6);
      g.addColorStop(0, `rgba(167,139,250,${glow})`);
      g.addColorStop(1, "rgba(167,139,250,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = team.main;
      ctx.fillRect(tx + 0.25, ty + 0.25, w - 0.5, 0.18);
      break;
    }
    default:
  }
  if (offline) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(tx + 0.05, ty + 0.05, w - 0.1, h - 0.1);
    ctx.fillStyle = "#facc15";
    ctx.font = "bold 0.5px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("⚡", cx, cy + 0.18);
  }
  if (b.hp < b.maxHp * 0.5 && Math.random() < 0.08) game._effects?.smoke(cx + (Math.random() - 0.5) * w * 0.6, cy);
  if (selected) {
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.05;
    const m = 0.3;
    for (const [x, y, dx, dy] of [[tx, ty, 1, 1], [tx + w, ty, -1, 1], [tx, ty + h, 1, -1], [tx + w, ty + h, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(x, y + dy * m);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * m, y);
      ctx.stroke();
    }
  }
}

function drawUnit(ctx, u, x, y, time, selected) {
  const team = TEAM[u.owner];
  const r = u.radius;
  if (selected) {
    ctx.strokeStyle = "#7cf29a";
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.2, r + 0.12, (r + 0.12) * 0.7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(x, y);
  // Shadow.
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0.06, 0.08, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();

  if (UNITS[u.type].category === "infantry") {
    const bob = u.moving ? Math.sin(time * 14 + u.id) * 0.03 : 0;
    ctx.rotate(u.angle);
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(0.02, -0.03, u.type === "rocket" ? 0.34 : 0.28, u.type === "rocket" ? 0.1 : 0.05);
    ctx.fillStyle = team.main;
    ctx.beginPath();
    ctx.arc(0, bob, r * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8c39e";
    ctx.beginPath();
    ctx.arc(0.02, bob, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.rotate(u.angle);
  const body = (len, wid, color) => {
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(-len / 2, -wid / 2 - 0.06, len, 0.12);
    ctx.fillRect(-len / 2, wid / 2 - 0.06, len, 0.12);
    ctx.fillStyle = color;
    ctx.fillRect(-len / 2 + 0.04, -wid / 2, len - 0.08, wid);
  };
  switch (u.type) {
    case "scout": {
      ctx.fillStyle = "#111827";
      for (const [wx, wy] of [[-0.2, -0.22], [0.2, -0.22], [-0.2, 0.22], [0.2, 0.22]]) ctx.fillRect(wx - 0.08, wy - 0.05, 0.16, 0.1);
      ctx.fillStyle = team.main;
      ctx.fillRect(-0.3, -0.18, 0.6, 0.36);
      ctx.fillStyle = team.light;
      ctx.fillRect(0.05, -0.12, 0.15, 0.24);
      ctx.fillStyle = "#374151";
      ctx.fillRect(-0.05, -0.03, 0.32, 0.06);
      break;
    }
    case "harvester": {
      body(0.86, 0.66, "#a16207");
      ctx.fillStyle = team.main;
      ctx.fillRect(0.15, -0.3, 0.26, 0.6);
      ctx.fillStyle = "#57534e";
      ctx.fillRect(0.41, -0.34, 0.1, 0.68);
      if (u.cargo > 0) {
        ctx.fillStyle = "#22d3ee";
        ctx.fillRect(-0.36, -0.22, 0.46 * Math.min(1, u.cargo / UNITS.harvester.capacity) + 0.02, 0.44);
      }
      if (u.harvest?.state === "gather" && Math.sin(time * 20) > 0) {
        ctx.fillStyle = "rgba(103,232,249,0.7)";
        ctx.beginPath();
        ctx.arc(0.55, 0, 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "artillery": {
      body(0.8, 0.56, team.dark);
      ctx.fillStyle = team.main;
      ctx.fillRect(-0.3, -0.2, 0.4, 0.4);
      ctx.rotate(u.turret - u.angle);
      ctx.fillStyle = "#374151";
      ctx.fillRect(0, -0.05, 0.75, 0.1);
      break;
    }
    case "heavy":
    case "tank": {
      const big = u.type === "heavy";
      body(big ? 0.96 : 0.82, big ? 0.7 : 0.58, team.dark);
      ctx.rotate(u.turret - u.angle);
      ctx.fillStyle = "#374151";
      if (big) {
        ctx.fillRect(0.05, -0.12, 0.62, 0.08);
        ctx.fillRect(0.05, 0.04, 0.62, 0.08);
      } else ctx.fillRect(0.05, -0.05, 0.55, 0.1);
      ctx.fillStyle = team.main;
      ctx.beginPath();
      ctx.arc(0, 0, big ? 0.28 : 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = team.light;
      ctx.beginPath();
      ctx.arc(-0.06, -0.06, 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default:
  }
  ctx.restore();
}

function drawProjectile(ctx, p) {
  const w = p.weapon;
  if (w.arc) {
    const total = Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1;
    const t = 1 - Math.hypot(p.tx - p.x, p.ty - p.y) / total;
    const lift = Math.sin(Math.PI * Math.max(0, Math.min(1, t))) * Math.min(3, total * 0.3);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(p.x, p.y - lift, 0.1, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (w.warhead === "rocket") {
    const a = Math.atan2(p.ty - p.y, p.tx - p.x);
    ctx.strokeStyle = "rgba(200,200,200,0.5)";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - Math.cos(a) * 0.5, p.y - Math.sin(a) * 0.5);
    ctx.stroke();
    ctx.fillStyle = "#fb923c";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.07, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.fillStyle = "#fef08a";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 0.07, 0, Math.PI * 2);
  ctx.fill();
}

/** Small icon of a unit or structure for the build sidebar. */
export function drawIcon(canvas, type, owner = 0) {
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, "#2b3442");
  grad.addColorStop(1, "#151a22");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const fake = { _effects: null, lowPower: () => false };
  if (BUILDINGS[type]) {
    const rule = BUILDINGS[type];
    const s = (size * 0.8) / Math.max(rule.w, rule.h + (type === "refinery" ? 1 : 0));
    ctx.setTransform(s, 0, 0, s, (size - rule.w * s) / 2, (size - rule.h * s) / 2 - (type === "hq" ? 0 : 0));
    drawBuilding(ctx, { type, owner, tx: 0, ty: 0, w: rule.w, h: rule.h, x: rule.w / 2, y: rule.h / 2, hp: 1, maxHp: 1, turret: -0.6 }, fake, 0.3, false);
  } else {
    const rule = UNITS[type];
    const s = size / (rule.category === "infantry" ? 1.1 : 1.5);
    ctx.setTransform(s, 0, 0, s, size / 2, size / 2);
    drawUnit(ctx, { type, owner, radius: rule.radius, angle: -0.6, turret: -0.6, cargo: 0, id: 1 }, 0, 0, 0, false);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
