/**
 * Synthesised battle sounds and an original music loop (WebAudio, no audio files).
 * Sounds are rate-limited per kind and attenuated by distance from the camera.
 */

let context = null;
let master = null;
let musicBus = null;
let noiseBuffer = null;
let muted = false;
let musicOn = true;
const lastPlayed = new Map();

const MASTER = 0.8;
const MUSIC = 0.18;

function audio() {
  if (muted) return null;
  if (!context) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    context = new AC();
    master = context.createGain();
    master.gain.value = MASTER;
    master.connect(context.destination);
    musicBus = context.createGain();
    musicBus.gain.value = musicOn ? MUSIC : 0;
    musicBus.connect(master);
    noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  if (context.state === "suspended") context.resume();
  return context;
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = muted ? 0 : MASTER;
}
export const isMuted = () => muted;
export function setMusic(value) {
  musicOn = value;
  if (musicBus) musicBus.gain.value = musicOn ? MUSIC : 0;
}
export const isMusicOn = () => musicOn;

function tone(freq, duration, { type = "sine", gain = 0.1, delay = 0, slide = 1, bus = null } = {}) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide !== 1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + duration);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(env).connect(bus || master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise(duration, { gain = 0.2, freq = 1000, q = 0.7, type = "lowpass", delay = 0, sweep = 1 } = {}) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (sweep !== 1) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + duration);
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(filter).connect(env).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + duration + 0.02);
}

/** Plays `kind` unless it played less than `gap` seconds ago. */
function limited(kind, gap, fn) {
  const now = performance.now() / 1000;
  if (now - (lastPlayed.get(kind) ?? 0) < gap) return;
  lastPlayed.set(kind, now);
  fn();
}

export const sfx = {
  unlock: () => audio(),
  click: () => tone(1200, 0.04, { type: "square", gain: 0.03 }),
  /** Weapon fire, `volume` 0..1 from distance to the camera. */
  fire(warhead, volume = 1) {
    if (volume <= 0.05) return;
    if (warhead === "bullet") limited("bullet", 0.05, () => noise(0.06, { gain: 0.08 * volume, freq: 3000, type: "highpass" }));
    else if (warhead === "rocket") limited("rocket", 0.08, () => noise(0.35, { gain: 0.1 * volume, freq: 600, sweep: 4, type: "bandpass", q: 2 }));
    else if (warhead === "cannon") limited("cannon", 0.07, () => {
      tone(120, 0.18, { type: "triangle", gain: 0.18 * volume, slide: 0.4 });
      noise(0.15, { gain: 0.12 * volume, freq: 900 });
    });
    else limited("shell", 0.1, () => {
      tone(70, 0.4, { type: "sine", gain: 0.25 * volume, slide: 0.5 });
      noise(0.3, { gain: 0.15 * volume, freq: 500 });
    });
  },
  explode(size = 1, volume = 1) {
    if (volume <= 0.05) return;
    limited(size > 1 ? "big-boom" : "boom", 0.06, () => {
      noise(0.5 + size * 0.3, { gain: Math.min(0.5, 0.2 * size) * volume, freq: 700, sweep: 0.15 });
      tone(55, 0.4 + size * 0.2, { gain: 0.2 * volume, slide: 0.5 });
    });
  },
  place: () => {
    tone(160, 0.12, { type: "square", gain: 0.06 });
    noise(0.15, { gain: 0.12, freq: 400, delay: 0.05 });
  },
  ready: () => [0, 4, 7].forEach((s, i) => tone(523 * 2 ** (s / 12), 0.12, { type: "triangle", gain: 0.07, delay: i * 0.09 })),
  unitReady: () => [0, 7].forEach((s, i) => tone(660 * 2 ** (s / 12), 0.08, { type: "square", gain: 0.035, delay: i * 0.07 })),
  cash: () => limited("cash", 0.25, () => [0, 5].forEach((s, i) => tone(1046 * 2 ** (s / 12), 0.06, { type: "triangle", gain: 0.04, delay: i * 0.05 }))),
  denied: () => tone(150, 0.18, { type: "square", gain: 0.05, slide: 0.8 }),
  alarm: () => limited("alarm", 6, () => [0, 1, 2].forEach((i) => tone(i % 2 ? 620 : 880, 0.18, { type: "sawtooth", gain: 0.04, delay: i * 0.2 }))),
  lowPower: () => limited("low-power", 8, () => tone(400, 0.6, { type: "sawtooth", gain: 0.04, slide: 0.4 })),
  win: () => [0, 4, 7, 12].forEach((s, i) => tone(392 * 2 ** (s / 12), 0.35, { type: "triangle", gain: 0.08, delay: i * 0.15 })),
  lose: () => [0, -3, -7, -12].forEach((s, i) => tone(392 * 2 ** (s / 12), 0.45, { type: "sawtooth", gain: 0.04, delay: i * 0.2 })),
};

// Music: original driving loop in E minor ----------------------------------------------------

const SONG = {
  tempo: 7.5,
  bass: [-29, -29, -17, -29, -29, -17, -26, -24, -29, -29, -17, -29, -31, -19, -27, -26],
  lead: [null, null, -5, null, -2, null, -5, -7, null, null, -5, null, 0, -2, -5, null,
         null, null, -5, null, -2, null, 3, 2, null, 0, -2, null, -5, null, -7, null],
};
let timer = null;
let step = 0;
let next = 0;

export function startMusic() {
  if (timer) return;
  step = 0;
  next = 0;
  timer = setInterval(schedule, 60);
}

export function stopMusic() {
  if (timer) clearInterval(timer);
  timer = null;
}

function schedule() {
  if (!context || muted || !musicOn || context.state !== "running") return;
  const len = 1 / SONG.tempo;
  const now = context.currentTime;
  if (next < now) next = now + 0.05;
  while (next < now + 0.25) {
    const delay = next - now;
    const hz = (s) => 440 * 2 ** (s / 12);
    tone(hz(SONG.bass[step % SONG.bass.length]), len * 0.9, { type: "sawtooth", gain: 0.06, delay, bus: musicBus });
    const lead = SONG.lead[step % SONG.lead.length];
    if (lead !== null) tone(hz(lead), len * 1.6, { type: "square", gain: 0.025, delay, bus: musicBus });
    if (step % 4 === 0) tone(60, 0.12, { type: "sine", gain: 0.2, delay, slide: 0.5, bus: musicBus });
    step += 1;
    next += len;
  }
}
