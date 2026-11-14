/** UI controller: menu demo, game loop, camera, input, sidebar, minimap, alerts, end screen. */

import { aiController } from "./core/ai.js";
import { Game } from "./core/game.js";
import { randomSeed } from "./core/rng.js";
import { AI_LEVELS, BUILDINGS, DT, INFANTRY_ORDER, STRUCTURE_ORDER, UNITS, VEHICLE_ORDER } from "./core/rules.js";
import { isMusicOn, isMuted, setMusic, setMuted, sfx, startMusic, stopMusic } from "./ui/audio.js";
import { Effects } from "./ui/effects.js";
import { createRenderer, drawIcon, TEAM, TILE } from "./ui/render.js";
import { load, save } from "./ui/storage.js";
import { initAnalytics, track } from "./ui/analytics.js";

initAnalytics();

const HUMAN = 0;
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.2, 1.45];
const EDGE = 14; // px from the edge that scrolls the camera
const SPEEDS = [1, 1.5, 2];
const REASONS = {
  credits: "Không đủ tiền",
  prereq: "Chưa đủ điều kiện",
  busy: "Đang xây một công trình khác",
  "queue-full": "Hàng chờ đã đầy",
  "no-hq": "Cần Sở chỉ huy",
  blocked: "Không thể đặt ở đây",
};
const NAMES = { ...Object.fromEntries(Object.entries(BUILDINGS).map(([k, v]) => [k, v.name])), ...Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v.name])) };
const CATEGORY_ITEMS = { structure: STRUCTURE_ORDER, infantry: INFANTRY_ORDER, vehicle: VEHICLE_ORDER };

const $ = (id) => document.getElementById(id);
const ui = {
  world: $("world"),
  view: $("view"),
  sidebar: $("sidebar"),
  menu: $("menu"),
  setup: $("setup"),
  seed: $("seed"),
  overlay: $("overlay"),
  panel: $("panel"),
  alerts: $("alerts"),
  hudTop: $("hud-top"),
  clock: $("clock"),
  modeHint: $("mode-hint"),
  credits: $("credits"),
  power: document.querySelector(".power"),
  powerMade: $("power-made"),
  powerUsed: $("power-used"),
  powerText: $("power-text"),
  minimap: $("minimap"),
  radarOff: $("radar-off"),
  tabs: [...document.querySelectorAll(".build-tabs [data-cat]")],
  grid: $("build-grid"),
  selection: $("selection"),
  pauseBtn: $("pause-btn"),
  speedBtn: $("speed-btn"),
  soundBtn: $("sound-btn"),
  musicBtn: $("music-btn"),
  touchTools: $("touch-tools"),
  boxTool: $("box-tool"),
  attackTool: $("attack-tool"),
};

const renderer = createRenderer(ui.world);
const effects = new Effects();
const touchUI = window.matchMedia("(pointer: coarse)").matches;

let game = null;
let mode = "menu"; // "menu" | "game" | "over"
let viewer = -1;
const camera = { x: 0, y: 0, zoom: 1 };
let zoomIndex = 3;
let selection = new Set();
const groups = {};
let placing = null;
let placementTile = null;
let attackMode = false;
let boxMode = false;
let paused = false;
let speedIndex = 0;
let acc = 0;
let last = performance.now();
let tab = "structure";
const keys = new Set();
const mouse = { x: 0, y: 0, inside: false };
let drag = null; // { kind: "box" | "pan", x0, y0, x1, y1, camX, camY, moved }
let lastClick = { time: 0, id: 0 };
let lastGroupKey = { key: "", time: 0 };
let lastAttackAlert = -Infinity;
let wasLowPower = false;
let displayCredits = 0;
let sidebarAt = 0;
let minimapAt = 0;
let settings = { ai: "normal", size: 48, credits: 3000, seed: (randomSeed() % 99999) + 1, ...load("settings", {}) };

setMuted(load("muted", false));
setMusic(load("music", true));

// Canvas & camera --------------------------------------------------------------------------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const canvas of [ui.world, ui.minimap]) {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }
  clampCamera();
}

function viewSize() {
  const scale = TILE * camera.zoom;
  return { w: ui.world.clientWidth / scale, h: ui.world.clientHeight / scale };
}

function clampCamera() {
  if (!game) return;
  const { w, h } = viewSize();
  const mw = game.map.width;
  const mh = game.map.height;
  camera.x = w >= mw ? (mw - w) / 2 : Math.max(0, Math.min(mw - w, camera.x));
  camera.y = h >= mh ? (mh - h) / 2 : Math.max(0, Math.min(mh - h, camera.y));
}

function centerOn(x, y) {
  const { w, h } = viewSize();
  camera.x = x - w / 2;
  camera.y = y - h / 2;
  clampCamera();
}

function toWorld(px, py) {
  const scale = TILE * camera.zoom;
  return { x: camera.x + px / scale, y: camera.y + py / scale };
}

function setZoom(index, px = ui.world.clientWidth / 2, py = ui.world.clientHeight / 2) {
  const before = toWorld(px, py);
  zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, index));
  camera.zoom = ZOOMS[zoomIndex];
  const scale = TILE * camera.zoom;
  camera.x = before.x - px / scale;
  camera.y = before.y - py / scale;
  clampCamera();
}

// Screens ----------------------------------------------------------------------------------

function startDemo() {
  game = new Game({ seed: (randomSeed() % 99999) + 1, size: 48, credits: 5000, controllers: [aiController("hard"), aiController("hard")] });
  game._effects = effects;
  viewer = -1;
  mode = "menu";
  effects.clear();
  selection = new Set();
  speedIndex = 1;
  setZoom(2);
  centerOn(game.map.width / 2, game.map.height / 2);
  ui.sidebar.hidden = true;
  ui.hudTop.hidden = true;
  ui.touchTools.hidden = true;
  ui.menu.hidden = false;
  requestAnimationFrame(resize);
}

function startGame(sameSeed = true) {
  if (!sameSeed) settings.seed = (randomSeed() % 99999) + 1;
  save("settings", settings);
  track("rts/start");
  game = new Game({ seed: settings.seed, size: settings.size, credits: settings.credits, controllers: [null, aiController(settings.ai)] });
  game._effects = effects;
  viewer = HUMAN;
  mode = "game";
  paused = false;
  speedIndex = 0;
  acc = 0;
  effects.clear();
  selection = new Set();
  for (const k of Object.keys(groups)) delete groups[k];
  placing = null;
  attackMode = false;
  wasLowPower = false;
  lastAttackAlert = -Infinity;
  displayCredits = game.players[HUMAN].credits;
  ui.menu.hidden = true;
  ui.overlay.hidden = true;
  ui.sidebar.hidden = false;
  ui.hudTop.hidden = false;
  ui.touchTools.hidden = !touchUI;
  ui.alerts.replaceChildren();
  buildSidebar();
  requestAnimationFrame(() => {
    resize();
    setZoom(3);
    const start = game.players[HUMAN].start;
    centerOn(start.x + 4, start.y + 3);
  });
  sfx.unlock();
  syncMusic();
  alert(`Trận đấu bắt đầu · Đối thủ: ${AI_LEVELS[settings.ai].name} · Mã bản đồ ${settings.seed}`, "good");
}

function endGame() {
  mode = "over";
  const won = game.winner === HUMAN;
  track(won ? "rts/win" : "rts/lose");
  won ? sfx.win() : sfx.lose();
  const p = game.players;
  const row = (label, key) => `<tr><td>${label}</td><td>${p[0].stats[key].toLocaleString("vi-VN")}</td><td>${p[1].stats[key].toLocaleString("vi-VN")}</td></tr>`;
  openPanel(`
    <h2 id="panel-title" class="${won ? "win" : "lose"}">${won ? "🏆 CHIẾN THẮNG" : "💥 THẤT BẠI"}</h2>
    <p>${won ? "Căn cứ Phe Đỏ đã bị xóa sổ. Mỏ tinh thể thuộc về Liên Quân Xanh." : "Căn cứ của bạn đã thất thủ. Hãy tái tổ chức và thử lại."}</p>
    <p class="muted">Thời gian: <strong>${formatTime(game.seconds)}</strong> · Đối thủ: ${AI_LEVELS[settings.ai].name} · Mã bản đồ ${settings.seed}</p>
    <table>
      <thead><tr><th></th><th style="color:${TEAM[0].light}">Bạn</th><th style="color:${TEAM[1].light}">Phe Đỏ</th></tr></thead>
      <tbody>
        ${row("Đơn vị sản xuất", "built")}
        ${row("Công trình xây", "structures")}
        ${row("Tiêu diệt", "killed")}
        ${row("Thiệt hại", "lost")}
        ${row("Quặng thu được", "harvested")}
      </tbody>
    </table>
    <div class="actions">
      <button type="button" class="primary" data-action="again">Chơi lại bản đồ này</button>
      <button type="button" class="ghost" data-action="new">Trận mới</button>
      <button type="button" class="ghost" data-action="menu">Về menu</button>
    </div>`);
}

function openPanel(html) {
  ui.panel.innerHTML = html;
  ui.overlay.hidden = false;
  ui.panel.querySelector("button")?.focus();
}

function closePanel() {
  ui.overlay.hidden = true;
}

function togglePause(force) {
  if (mode !== "game") return;
  paused = force ?? !paused;
  ui.pauseBtn.textContent = paused ? "▶" : "⏸";
  if (paused) {
    openPanel(`
      <h2 id="panel-title">Tạm dừng</h2>
      <p class="muted">${formatTime(game.seconds)} · Đối thủ: ${AI_LEVELS[settings.ai].name} · Mã bản đồ ${settings.seed}</p>
      <div class="actions">
        <button type="button" class="primary" data-action="resume">Tiếp tục</button>
        <button type="button" class="ghost" data-action="help">Cách chơi</button>
        <button type="button" class="ghost" data-action="quit">Đầu hàng & về menu</button>
      </div>`);
  } else closePanel();
}

function howTo() {
  openPanel(`
    <h2 id="panel-title">Cách chơi</h2>
    <p><strong>Mục tiêu:</strong> phá hủy toàn bộ công trình và quân đội của Phe Đỏ.</p>
    <ol>
      <li>Xây <strong>Nhà máy điện</strong> → <strong>Nhà máy lọc quặng</strong> (tặng xe khai thác) để có tiền.</li>
      <li>Xây <strong>Doanh trại</strong> và <strong>Xưởng xe</strong> để lập quân. Thiếu điện thì sản xuất chậm một nửa và tháp pháo ngừng bắn.</li>
      <li>Khắc chế: lính súng trường &gt; lính tên lửa &gt; xe tăng &gt; lính súng trường. Pháo bắn xa nhưng yếu ở gần.</li>
      <li><strong>Trạm radar</strong> bật bản đồ nhỏ. <strong>Trung tâm công nghệ</strong> mở Tăng Voi và Pháo tự hành.</li>
    </ol>
    <div class="keys">
      <kbd>Chuột trái</kbd><span>Chọn / kéo để chọn vùng (Shift: thêm)</span>
      <kbd>Nhấp đúp</kbd><span>Chọn mọi đơn vị cùng loại trên màn hình</span>
      <kbd>Chuột phải</kbd><span>Di chuyển · tấn công · khai thác · đặt điểm tập kết</span>
      <kbd>A</kbd><span>Tấn công-di chuyển (đánh mọi thứ trên đường)</span>
      <kbd>S</kbd> <span>Dừng</span>
      <kbd>G</kbd> <span>Giữ vị trí</span>
      <kbd>Ctrl + 1…9</kbd><span>Lập nhóm · <kbd>1…9</kbd> chọn nhóm (bấm 2 lần: tới nhóm)</span>
      <kbd>H</kbd><span>Về căn cứ</span>
      <kbd>← ↑ → ↓</kbd><span>Cuộn bản đồ (hoặc đưa chuột ra mép, kéo chuột giữa)</span>
      <kbd>Lăn chuột</kbd><span>Phóng to / thu nhỏ</span>
      <kbd>P</kbd> <kbd>M</kbd> <kbd>N</kbd><span>Tạm dừng · âm thanh · nhạc</span>
    </div>
    <p class="muted">Cảm ứng: chạm để chọn, chạm đất/địch để ra lệnh, kéo để cuộn, nút ⬚ để chọn vùng, ⚔ để tấn công-di chuyển.</p>
    <div class="actions"><button type="button" class="primary" data-action="${mode === "game" ? "resume" : "close"}">Đã hiểu</button></div>`);
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// Main loop --------------------------------------------------------------------------------

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game && !(mode === "game" && paused) && !(mode === "over")) {
    acc += dt * SPEEDS[speedIndex];
    let steps = 0;
    while (acc >= DT && steps < 8) {
      for (const e of game.entities.values()) {
        if (e.kind === "unit") {
          e._px = e.x;
          e._py = e.y;
        }
      }
      game.step();
      handleEvents(game.takeEvents());
      acc -= DT;
      steps += 1;
      if (mode === "menu" && game.over) break;
    }
    if (steps === 8) acc = 0;
  }
  if (mode === "menu" && game?.over) startDemo();
  effects.update(paused ? 0 : dt * SPEEDS[speedIndex]);
  scrollCamera(dt);
  if (mode === "menu") demoCamera(dt);
  if (game) {
    renderer.draw({
      game,
      camera,
      viewer,
      effects,
      alpha: paused ? 1 : Math.min(1, acc / DT),
      time: now / 1000,
      selection,
      placement: placing && placementTile ? { type: placing, ...placementTile, ok: game.canPlace(HUMAN, placing, placementTile.tx, placementTile.ty) } : null,
      box: drag?.kind === "box" && drag.moved ? drag : null,
    });
  }
  if (mode === "game") {
    if (now - sidebarAt > 100) {
      sidebarAt = now;
      updateSidebar();
    }
    if (now - minimapAt > 150) {
      minimapAt = now;
      drawMinimap();
    }
    ui.clock.textContent = formatTime(game.seconds);
    watchAlerts();
    if (game.over) endGame();
  }
  requestAnimationFrame(frame);
}

function demoCamera(dt) {
  // Drift toward the centre of the fighting.
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const e of game.entities.values()) {
    if (e.kind !== "unit" || e.type === "harvester") continue;
    sx += e.x;
    sy += e.y;
    n += 1;
  }
  const target = n ? { x: sx / n, y: sy / n } : { x: game.map.width / 2, y: game.map.height / 2 };
  const { w, h } = viewSize();
  camera.x += (target.x - w / 2 - camera.x) * Math.min(1, dt * 0.4);
  camera.y += (target.y - h / 2 - camera.y) * Math.min(1, dt * 0.4);
  clampCamera();
}

function scrollCamera(dt) {
  if (mode !== "game") return;
  const speed = (18 / camera.zoom) * dt;
  let dx = 0;
  let dy = 0;
  if (keys.has("ArrowLeft")) dx -= 1;
  if (keys.has("ArrowRight")) dx += 1;
  if (keys.has("ArrowUp")) dy -= 1;
  if (keys.has("ArrowDown")) dy += 1;
  if (!touchUI && mouse.inside && !drag && document.hasFocus()) {
    const w = ui.world.clientWidth;
    const h = ui.world.clientHeight;
    if (mouse.x < EDGE) dx -= 1;
    if (mouse.x > w - EDGE) dx += 1;
    if (mouse.y < EDGE) dy -= 1;
    if (mouse.y > h - EDGE) dy += 1;
  }
  if (dx || dy) {
    camera.x += dx * speed;
    camera.y += dy * speed;
    clampCamera();
  }
}

// Events from the simulation → effects, sound, alerts --------------------------------------------

function seen(x, y) {
  return viewer < 0 || game.isVisible(viewer, x, y);
}

function volumeAt(x, y) {
  const { w, h } = viewSize();
  const d = Math.hypot(x - (camera.x + w / 2), y - (camera.y + h / 2));
  return Math.max(0, 1 - d / (Math.max(w, h) * 0.9));
}

function handleEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case "fire":
        if (!seen(e.x, e.y)) break;
        effects.flash(e.x, e.y, e.warhead === "bullet" ? 0.22 : 0.4);
        if (e.warhead === "bullet") effects.tracer(e.x, e.y, e.tx + (Math.random() - 0.5) * 0.3, e.ty + (Math.random() - 0.5) * 0.3);
        if (mode === "game") sfx.fire(e.warhead, volumeAt(e.x, e.y));
        break;
      case "impact":
        if (!seen(e.x, e.y)) break;
        effects.explosion(e.x, e.y, e.splash ? 0.6 + e.splash * 0.4 : e.warhead === "rocket" ? 0.35 : 0.3);
        break;
      case "destroyed":
        if (!seen(e.x, e.y) && e.owner !== viewer) break;
        effects.explosion(e.x, e.y, e.kind === "building" ? 1 + e.size * 0.5 : UNITS[e.item]?.category === "infantry" ? 0.4 : 1.1);
        if (e.kind === "building") for (let i = 0; i < e.size; i += 1) setTimeout(() => effects.explosion(e.x + (Math.random() - 0.5) * e.size, e.y + (Math.random() - 0.5) * e.size, 0.8), 120 * (i + 1));
        if (mode === "game") {
          sfx.explode(e.kind === "building" ? 2 : 1, volumeAt(e.x, e.y));
          if (e.owner === HUMAN && e.kind === "building") alert(`Mất công trình: ${NAMES[e.item]}`, "bad");
          if (e.owner !== HUMAN && e.kind === "building") alert(`Đã phá hủy ${NAMES[e.item]} của địch`, "good");
        }
        for (const id of [...selection]) if (!game.entity(id)) selection.delete(id);
        break;
      case "ready":
        if (e.owner === HUMAN && mode === "game") {
          sfx.ready();
          alert(`${NAMES[e.item]} đã xong. Bấm vào nút để chọn chỗ đặt.`, "good");
        }
        break;
      case "unit-ready":
        if (e.owner === HUMAN && mode === "game") sfx.unitReady();
        break;
      case "placed":
        if (e.owner === HUMAN) sfx.place();
        break;
      case "unload":
        if (e.owner === viewer) {
          effects.text(e.x, e.y - 0.6, `+${e.amount}`, "#facc15");
          sfx.cash();
        }
        break;
      case "sold":
        if (e.owner === HUMAN) sfx.cash();
        break;
      default:
    }
  }
}

function watchAlerts() {
  const p = game.players[HUMAN];
  const hit = p.lastAttacked;
  if (hit && hit.tick > lastAttackAlert + 8 * 20) {
    const { w, h } = viewSize();
    const onScreen = hit.x > camera.x && hit.y > camera.y && hit.x < camera.x + w && hit.y < camera.y + h;
    if (!onScreen) {
      lastAttackAlert = hit.tick;
      alert(BUILDINGS[hit.item] ? "⚠ Căn cứ đang bị tấn công!" : hit.item === "harvester" ? "⚠ Xe khai thác bị tấn công!" : "⚠ Quân ta đang giao chiến", "bad");
      sfx.alarm();
    }
  }
  const low = game.lowPower(HUMAN);
  if (low && !wasLowPower) {
    alert("⚡ Thiếu điện! Sản xuất chậm lại, tháp pháo và radar ngừng hoạt động.", "bad");
    sfx.lowPower();
  }
  wasLowPower = low;
}

function alert(text, tone = "") {
  const node = document.createElement("div");
  node.className = `alert ${tone}`;
  node.textContent = text;
  ui.alerts.append(node);
  while (ui.alerts.children.length > 4) ui.alerts.firstElementChild.remove();
  setTimeout(() => node.remove(), 4500);
}

// Sidebar ----------------------------------------------------------------------------------

let buttons = new Map();

function buildSidebar() {
  ui.grid.replaceChildren();
  buttons = new Map();
  for (const [category, items] of Object.entries(CATEGORY_ITEMS)) {
    for (const type of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "build";
      btn.dataset.type = type;
      btn.dataset.cat = category;
      const icon = document.createElement("canvas");
      icon.width = 72;
      icon.height = 72;
      drawIcon(icon, type, HUMAN);
      const rule = BUILDINGS[type] ?? UNITS[type];
      btn.innerHTML = `<span class="label">${rule.short ?? rule.name}</span><span class="cost">◈${rule.cost}</span><span class="progress"></span><span class="state"></span><span class="count" hidden></span>`;
      btn.prepend(icon);
      const cancel = document.createElement("span");
      cancel.className = "cancel";
      cancel.textContent = "✕";
      cancel.title = "Hủy";
      cancel.hidden = true;
      cancel.setAttribute("role", "button");
      btn.append(cancel);
      ui.grid.append(btn);
      buttons.set(type, { btn, cancel, progress: btn.querySelector(".progress"), state: btn.querySelector(".state"), count: btn.querySelector(".count") });
    }
  }
  selectTab(tab);
}

function selectTab(category) {
  tab = category;
  for (const t of ui.tabs) t.setAttribute("aria-selected", String(t.dataset.cat === category));
  for (const { btn } of buttons.values()) btn.hidden = btn.dataset.cat !== category;
}

function requirementText(type) {
  const rule = BUILDINGS[type] ?? UNITS[type];
  const missing = rule.prereq.filter((p) => !game.has(HUMAN, p)).map((p) => NAMES[p]);
  return missing.length ? `Cần: ${missing.join(", ")}` : "";
}

function updateSidebar() {
  const p = game.players[HUMAN];
  displayCredits += (p.credits - displayCredits) * 0.35;
  if (Math.abs(p.credits - displayCredits) < 2) displayCredits = p.credits;
  ui.credits.textContent = Math.round(displayCredits).toLocaleString("vi-VN");
  const { made, used } = p.power;
  const scale = Math.max(made, used, 100) * 1.1;
  ui.powerMade.style.width = `${(made / scale) * 100}%`;
  ui.powerUsed.style.left = `${(used / scale) * 100}%`;
  ui.powerText.textContent = `${made}/${used}`;
  ui.power.classList.toggle("low", used > made);

  for (const [type, b] of buttons) {
    const rule = BUILDINGS[type] ?? UNITS[type];
    const locked = !game.prereqsMet(HUMAN, type);
    let progress = 0;
    let state = "";
    let count = 0;
    let cancellable = false;
    if (BUILDINGS[type]) {
      if (p.ready === type) {
        state = placing === type ? "ĐANG ĐẶT" : "SẴN SÀNG";
        cancellable = true;
      } else if (p.structure?.type === type) {
        progress = p.structure.progress / p.structure.total;
        cancellable = true;
      }
    } else {
      const queue = p.queues[rule.category];
      count = queue.filter((q) => q.type === type).length;
      if (queue[0]?.type === type) progress = queue[0].progress / queue[0].total;
      cancellable = count > 0;
    }
    b.btn.classList.toggle("locked", locked);
    b.btn.classList.toggle("poor", !locked && p.credits < rule.cost && !cancellable);
    b.btn.classList.toggle("ready", p.ready === type);
    b.btn.title = `${rule.name} · ◈${rule.cost}\n${rule.info}${locked ? `\n${requirementText(type)}` : ""}`;
    b.progress.style.top = progress ? `${progress * 100}%` : "100%";
    b.state.textContent = state || (progress ? `${Math.floor(progress * 100)}%` : "");
    b.count.hidden = count < 2;
    b.count.textContent = count;
    b.cancel.hidden = !cancellable;
  }
  for (const t of ui.tabs) t.classList.toggle("has-ready", t.dataset.cat === "structure" && Boolean(p.ready));
  updateSelectionPanel();
  ui.modeHint.hidden = !(attackMode || placing);
  ui.modeHint.textContent = placing ? `Đặt ${NAMES[placing]}: nhấp chuột trái · chuột phải/Esc để hủy` : "Tấn công-di chuyển: chọn điểm đến";
  ui.world.classList.toggle("cursor-attack", attackMode);
  ui.world.classList.toggle("cursor-place", Boolean(placing));
  ui.soundBtn.textContent = isMuted() ? "🔇" : "🔊";
  ui.musicBtn.setAttribute("aria-pressed", String(isMusicOn()));
  ui.speedBtn.textContent = `${SPEEDS[speedIndex]}×`;
}

function updateSelectionPanel() {
  const entities = [...selection].map((id) => game.entity(id)).filter(Boolean);
  let html;
  if (!entities.length) {
    html = `<span class="muted">${touchUI ? "Chạm vào quân để chọn, chạm đất để ra lệnh." : "Kéo chuột trái để chọn quân, chuột phải để ra lệnh."}</span>`;
  } else if (entities.length === 1) {
    const e = entities[0];
    const rule = BUILDINGS[e.type] ?? UNITS[e.type];
    const k = e.hp / e.maxHp;
    const mine = e.owner === HUMAN;
    let extra = "";
    if (e.type === "harvester") extra = `<div class="muted">Hàng: ${e.cargo}/${UNITS.harvester.capacity}</div>`;
    if (e.kind === "building" && mine) {
      extra += `<div class="row">${e.type !== "hq" ? `<button type="button" class="danger" data-action="sell">Bán (+◈${Math.floor(rule.cost * 0.5 * k)})</button>` : ""}</div>`;
      if (rule.produces && rule.produces !== "structure") extra += `<div class="muted">Chuột phải trên bản đồ để đặt điểm tập kết.</div>`;
    }
    if (e.kind === "unit" && mine) extra += `<div class="row"><button type="button" data-action="stop">Dừng</button><button type="button" data-action="hold">Giữ vị trí</button></div>`;
    html = `<h3 style="color:${TEAM[e.owner].light}">${rule.name}${mine ? "" : " (địch)"}</h3><div class="hp"><i style="width:${k * 100}%;background:${k > 0.6 ? "#4ade80" : k > 0.3 ? "#facc15" : "#ef4444"}"></i></div><div class="muted">${Math.ceil(e.hp)}/${e.maxHp} · ${rule.info}</div>${extra}`;
  } else {
    const counts = {};
    for (const e of entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
    html = `<h3>${entities.length} đơn vị</h3><div class="row">${Object.entries(counts).map(([t, n]) => `<span class="pill">${n} × ${UNITS[t]?.short ?? NAMES[t]}</span>`).join("")}</div><div class="row"><button type="button" data-action="stop">Dừng</button><button type="button" data-action="hold">Giữ vị trí</button></div>`;
  }
  if (ui.selection.innerHTML !== html) ui.selection.innerHTML = html;
}

function clickBuild(type) {
  const p = game.players[HUMAN];
  sfx.click();
  if (BUILDINGS[type] && p.ready === type) {
    placing = placing === type ? null : type;
    attackMode = false;
    return;
  }
  if (BUILDINGS[type] && p.structure?.type === type) return;
  const result = game.command(HUMAN, { type: "build", item: type });
  if (!result.ok) {
    sfx.denied();
    alert(result.reason === "prereq" ? requirementText(type) : REASONS[result.reason] ?? result.reason, "bad");
  }
}

function cancelBuild(type) {
  const category = BUILDINGS[type] ? "structure" : UNITS[type].category;
  if (game.command(HUMAN, { type: "cancel", category, item: type }).ok) {
    sfx.click();
    if (placing === type) placing = null;
  }
}

ui.grid.addEventListener("click", (event) => {
  const btn = event.target.closest(".build");
  if (!btn || mode !== "game") return;
  if (event.target.closest(".cancel")) cancelBuild(btn.dataset.type);
  else clickBuild(btn.dataset.type);
  updateSidebar();
});
ui.grid.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const btn = event.target.closest(".build");
  if (btn && mode === "game") cancelBuild(btn.dataset.type);
});
for (const t of ui.tabs) t.addEventListener("click", () => selectTab(t.dataset.cat));

ui.selection.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  const ids = [...selection];
  if (action === "sell") {
    game.command(HUMAN, { type: "sell", id: ids[0] });
    selection.clear();
  }
  if (action === "stop") game.command(HUMAN, { type: "stop", ids });
  if (action === "hold") game.command(HUMAN, { type: "hold", ids });
  sfx.click();
});

// Minimap ------------------------------------------------------------------------------------

const miniFog = document.createElement("canvas");
const miniFogCtx = miniFog.getContext("2d");

function drawMinimap() {
  const ctx = ui.minimap.getContext("2d");
  const W = ui.minimap.width;
  const H = ui.minimap.height;
  const radar = viewer < 0 || game.hasRadar(viewer);
  ui.radarOff.hidden = radar;
  if (!radar) return;
  const map = game.map;
  const s = Math.min(W / map.width, H / map.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(s, 0, 0, s, (W - map.width * s) / 2, (H - map.height * s) / 2);
  if (renderer.terrain) ctx.drawImage(renderer.terrain, 0, 0, map.width, map.height);
  ctx.fillStyle = "#22d3ee";
  for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) if (map.ore[map.index(x, y)]) ctx.fillRect(x + 0.2, y + 0.2, 0.6, 0.6);
  for (const e of game.entities.values()) {
    if (viewer >= 0 && e.owner !== viewer && !game.canSee(viewer, e) && !(e.kind === "building" && game.players[viewer].explored[map.index(Math.floor(e.x), Math.floor(e.y))])) continue;
    ctx.fillStyle = selection.has(e.id) ? "#ffffff" : TEAM[e.owner].main;
    if (e.kind === "building") ctx.fillRect(e.tx, e.ty, e.w, e.h);
    else ctx.fillRect(e.x - 0.6, e.y - 0.6, 1.2, 1.2);
  }
  if (viewer >= 0) {
    const p = game.players[viewer];
    if (miniFog.width !== map.width) {
      miniFog.width = map.width;
      miniFog.height = map.height;
    }
    const img = miniFogCtx.createImageData(map.width, map.height);
    for (let i = 0; i < p.visible.length; i += 1) img.data[i * 4 + 3] = p.visible[i] ? 0 : p.explored[i] ? 110 : 255;
    miniFogCtx.putImageData(img, 0, 0);
    ctx.drawImage(miniFog, 0, 0, map.width, map.height);
  }
  const { w, h } = viewSize();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1 / s;
  ctx.strokeRect(camera.x, camera.y, w, h);
}

function minimapToWorld(event) {
  const rect = ui.minimap.getBoundingClientRect();
  const map = game.map;
  const s = Math.min(rect.width / map.width, rect.height / map.height);
  const ox = (rect.width - map.width * s) / 2;
  const oy = (rect.height - map.height * s) / 2;
  return { x: (event.clientX - rect.left - ox) / s, y: (event.clientY - rect.top - oy) / s };
}

let miniDrag = false;
ui.minimap.addEventListener("pointerdown", (event) => {
  if (mode !== "game" || !game.hasRadar(HUMAN)) return;
  const p = minimapToWorld(event);
  if (event.button === 2) {
    commandAt(p.x, p.y);
    return;
  }
  miniDrag = true;
  ui.minimap.setPointerCapture(event.pointerId);
  centerOn(p.x, p.y);
});
ui.minimap.addEventListener("pointermove", (event) => {
  if (!miniDrag) return;
  const p = minimapToWorld(event);
  centerOn(p.x, p.y);
});
ui.minimap.addEventListener("pointerup", () => {
  miniDrag = false;
});
ui.minimap.addEventListener("contextmenu", (event) => event.preventDefault());

// Selection & commands ------------------------------------------------------------------------

function entityAt(x, y) {
  let best = null;
  let bestD = Infinity;
  for (const e of game.entities.values()) {
    if (viewer >= 0 && e.owner !== viewer && !game.canSee(viewer, e)) continue;
    if (e.kind === "unit") {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < e.radius + 0.2 && d < bestD) {
        best = e;
        bestD = d;
      }
    }
  }
  if (best) return best;
  for (const e of game.entities.values()) {
    if (e.kind !== "building") continue;
    if (viewer >= 0 && e.owner !== viewer && !game.canSee(viewer, e)) continue;
    if (x >= e.tx && x < e.tx + e.w && y >= e.ty && y < e.ty + e.h) return e;
  }
  return null;
}

function selectedUnits() {
  return [...selection].map((id) => game.entity(id)).filter((e) => e && e.kind === "unit" && e.owner === HUMAN);
}

function clickSelect(x, y, add) {
  const e = entityAt(x, y);
  const now = performance.now();
  if (!e) {
    if (!add) selection.clear();
    return;
  }
  if (e.owner === HUMAN && e.kind === "unit" && now - lastClick.time < 350 && lastClick.id === e.id) {
    // Double click: everything of that type on screen.
    const { w, h } = viewSize();
    for (const o of game.owned(HUMAN, (u) => u.type === e.type)) {
      if (o.x > camera.x && o.y > camera.y && o.x < camera.x + w && o.y < camera.y + h) selection.add(o.id);
    }
  } else if (add && e.owner === HUMAN && e.kind === "unit") {
    if (selection.has(e.id)) selection.delete(e.id);
    else selection.add(e.id);
  } else selection = new Set([e.id]);
  lastClick = { time: now, id: e.id };
  sfx.click();
}

function boxSelect(x0, y0, x1, y1, add) {
  const a = toWorld(Math.min(x0, x1), Math.min(y0, y1));
  const b = toWorld(Math.max(x0, x1), Math.max(y0, y1));
  const inside = game.owned(HUMAN, (e) => e.kind === "unit" && e.x >= a.x && e.x <= b.x && e.y >= a.y && e.y <= b.y);
  // Prefer fighters: harvesters only when nothing else is in the box.
  const fighters = inside.filter((e) => e.type !== "harvester");
  const chosen = fighters.length ? fighters : inside;
  if (!add) selection = new Set();
  for (const e of chosen) selection.add(e.id);
  if (chosen.length) sfx.click();
}

function commandAt(x, y, forceAttackMove = false) {
  const units = selectedUnits();
  if (!units.length) {
    const building = [...selection].map((id) => game.entity(id)).find((e) => e && e.owner === HUMAN && BUILDINGS[e.type]?.produces && BUILDINGS[e.type].produces !== "structure");
    if (building) {
      game.command(HUMAN, { type: "rally", id: building.id, x, y });
      sfx.click();
    }
    return;
  }
  const ids = units.map((u) => u.id);
  const target = entityAt(x, y);
  if (target && target.owner !== HUMAN && !forceAttackMove) {
    game.command(HUMAN, { type: "attack", ids, target: target.id });
    effects.ring?.(target.x, target.y, "#ef4444");
  } else {
    const harvesters = units.filter((u) => u.type === "harvester").map((u) => u.id);
    const others = units.filter((u) => u.type !== "harvester").map((u) => u.id);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (harvesters.length && game.map.oreAt(tx, ty) > 0 && !forceAttackMove) {
      game.command(HUMAN, { type: "harvest", ids: harvesters, x, y });
    } else if (harvesters.length) game.command(HUMAN, { type: "move", ids: harvesters, x, y });
    if (others.length) game.command(HUMAN, { type: "move", ids: others, x, y, attackMove: forceAttackMove });
    effects.ring?.(x, y, forceAttackMove ? "#f97316" : "#7cf29a");
  }
  sfx.click();
}

// Pointer input on the battlefield -------------------------------------------------------------

function localPoint(event) {
  const rect = ui.world.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function updatePlacementTile() {
  if (!placing) return;
  const w = toWorld(mouse.x, mouse.y);
  const rule = BUILDINGS[placing];
  placementTile = { tx: Math.floor(w.x - rule.w / 2 + 0.5), ty: Math.floor(w.y - rule.h / 2 + 0.5) };
}

ui.world.addEventListener("pointerdown", (event) => {
  if (mode !== "game") return;
  sfx.unlock();
  const p = localPoint(event);
  mouse.x = p.x;
  mouse.y = p.y;
  const w = toWorld(p.x, p.y);
  const touch = event.pointerType === "touch";
  ui.world.setPointerCapture(event.pointerId);

  if (event.button === 2) {
    if (placing) placing = null;
    else if (attackMode) attackMode = false;
    else commandAt(w.x, w.y);
    return;
  }
  if (event.button === 1) {
    drag = { kind: "pan", x0: p.x, y0: p.y, camX: camera.x, camY: camera.y, moved: false };
    return;
  }
  if (placing) {
    updatePlacementTile();
    const result = game.command(HUMAN, { type: "place", ...placementTile });
    if (result.ok) placing = null;
    else {
      sfx.denied();
      alert(REASONS.blocked, "bad");
    }
    return;
  }
  if (attackMode) {
    commandAt(w.x, w.y, true);
    attackMode = false;
    ui.attackTool.setAttribute("aria-pressed", "false");
    return;
  }
  drag = touch && !boxMode
    ? { kind: "pan", x0: p.x, y0: p.y, camX: camera.x, camY: camera.y, moved: false, touch: true }
    : { kind: "box", x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false };
});

ui.world.addEventListener("pointermove", (event) => {
  const p = localPoint(event);
  mouse.x = p.x;
  mouse.y = p.y;
  mouse.inside = true;
  updatePlacementTile();
  if (!drag) return;
  const dx = p.x - drag.x0;
  const dy = p.y - drag.y0;
  if (Math.hypot(dx, dy) > 6) drag.moved = true;
  if (drag.kind === "pan") {
    const scale = TILE * camera.zoom;
    camera.x = drag.camX - dx / scale;
    camera.y = drag.camY - dy / scale;
    clampCamera();
  } else {
    drag.x1 = p.x;
    drag.y1 = p.y;
  }
});

ui.world.addEventListener("pointerup", (event) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  const p = localPoint(event);
  const w = toWorld(p.x, p.y);
  if (d.kind === "box") {
    if (d.moved) boxSelect(d.x0, d.y0, d.x1, d.y1, event.shiftKey);
    else clickSelect(w.x, w.y, event.shiftKey);
  } else if (d.touch && !d.moved) {
    // Smart tap: own unit → select; anything else with units selected → command.
    const e = entityAt(w.x, w.y);
    if (e && e.owner === HUMAN) clickSelect(w.x, w.y, false);
    else if (selectedUnits().length || [...selection].some((id) => game.entity(id)?.kind === "building")) commandAt(w.x, w.y);
    else clickSelect(w.x, w.y, false);
  }
});

ui.world.addEventListener("pointerleave", () => {
  mouse.inside = false;
});
ui.world.addEventListener("contextmenu", (event) => event.preventDefault());
ui.world.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (mode !== "game") return;
  const p = localPoint(event);
  setZoom(zoomIndex + (event.deltaY < 0 ? 1 : -1), p.x, p.y);
}, { passive: false });

ui.boxTool.addEventListener("click", () => {
  boxMode = !boxMode;
  ui.boxTool.setAttribute("aria-pressed", String(boxMode));
});
ui.attackTool.addEventListener("click", () => {
  attackMode = selectedUnits().length > 0 && !attackMode;
  ui.attackTool.setAttribute("aria-pressed", String(attackMode));
});
$("zoom-in").addEventListener("click", () => setZoom(zoomIndex + 1));
$("zoom-out").addEventListener("click", () => setZoom(zoomIndex - 1));

// Keyboard -------------------------------------------------------------------------------------

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input")) return;
  if (!ui.overlay.hidden) {
    if (event.key === "Escape" || event.key === "p" || event.key === "P") {
      if (mode === "game" && paused) togglePause(false);
      else if (mode !== "over") closePanel();
    }
    return;
  }
  if (mode !== "game") return;
  if (event.key.startsWith("Arrow")) {
    keys.add(event.key);
    event.preventDefault();
    return;
  }
  const key = event.key.toLowerCase();
  const digit = /^[1-9]$/.test(event.key) ? event.key : null;
  if (digit && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    groups[digit] = selectedUnits().map((u) => u.id);
    alert(`Đã lập nhóm ${digit} (${groups[digit].length} đơn vị)`);
    return;
  }
  if (digit) {
    const ids = (groups[digit] ?? []).filter((id) => game.entity(id));
    groups[digit] = ids;
    if (!ids.length) return;
    selection = new Set(ids);
    const now = performance.now();
    if (lastGroupKey.key === digit && now - lastGroupKey.time < 400) {
      const units = ids.map((id) => game.entity(id));
      centerOn(units.reduce((s, u) => s + u.x, 0) / units.length, units.reduce((s, u) => s + u.y, 0) / units.length);
    }
    lastGroupKey = { key: digit, time: now };
    return;
  }
  if (key === "escape") {
    if (placing) placing = null;
    else if (attackMode) attackMode = false;
    else if (selection.size) selection.clear();
    else togglePause(true);
  } else if (key === "p") togglePause();
  else if (key === "m") toggleSound();
  else if (key === "n") toggleMusic();
  else if (key === "a" && selectedUnits().length) attackMode = true;
  else if (key === "s") game.command(HUMAN, { type: "stop", ids: [...selection] });
  else if (key === "g") game.command(HUMAN, { type: "hold", ids: [...selection] });
  else if (key === "h") {
    const hq = game.owned(HUMAN, (e) => e.type === "hq")[0] ?? game.owned(HUMAN)[0];
    if (hq) centerOn(hq.x, hq.y);
  } else if (key === "+" || key === "=") setZoom(zoomIndex + 1);
  else if (key === "-") setZoom(zoomIndex - 1);
});
document.addEventListener("keyup", (event) => keys.delete(event.key));
window.addEventListener("blur", () => keys.clear());

// Buttons, menu, overlay -----------------------------------------------------------------------

function toggleSound() {
  setMuted(!isMuted());
  save("muted", isMuted());
  syncMusic();
}

function toggleMusic() {
  setMusic(!isMusicOn());
  save("music", isMusicOn());
  syncMusic();
}

function syncMusic() {
  if (mode === "game" && isMusicOn() && !isMuted()) startMusic();
  else stopMusic();
}

ui.pauseBtn.addEventListener("click", () => togglePause());
ui.speedBtn.addEventListener("click", () => {
  speedIndex = (speedIndex + 1) % SPEEDS.length;
  updateSidebar();
});
ui.soundBtn.addEventListener("click", toggleSound);
ui.musicBtn.addEventListener("click", toggleMusic);
$("help-btn").addEventListener("click", () => {
  if (mode === "game" && !paused) togglePause(true);
  howTo();
});
$("howto-btn").addEventListener("click", howTo);
$("seed-roll").addEventListener("click", () => {
  ui.seed.value = (randomSeed() % 99999) + 1;
});

function readSetup() {
  const form = new FormData(ui.setup);
  settings = {
    ai: form.get("ai"),
    size: Number(form.get("size")),
    credits: Number(form.get("credits")),
    seed: Math.max(1, Math.min(999999, Math.floor(Number(ui.seed.value) || 1))),
  };
}

function writeSetup() {
  for (const [name, value] of [["ai", settings.ai], ["size", settings.size], ["credits", settings.credits]]) {
    const input = ui.setup.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  }
  ui.seed.value = settings.seed;
}

ui.setup.addEventListener("submit", (event) => {
  event.preventDefault();
  readSetup();
  startGame(true);
});

ui.panel.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "resume") togglePause(false);
  else if (action === "close") closePanel();
  else if (action === "help") howTo();
  else if (action === "again") startGame(true);
  else if (action === "new") startGame(false);
  else if (action === "menu" || action === "quit") {
    closePanel();
    stopMusic();
    writeSetup();
    startDemo();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && mode === "game" && !paused) togglePause(true);
});
window.addEventListener("resize", resize);

// Debug / browser tests.
window.rts = {
  get game() { return game; },
  get mode() { return mode; },
  get selection() { return selection; },
  get camera() { return camera; },
  get paused() { return paused; },
  centerOn,
  setSpeed(i) { speedIndex = i; },
};

writeSetup();
startDemo();
requestAnimationFrame(frame);
