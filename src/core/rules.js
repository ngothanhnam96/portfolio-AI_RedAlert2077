/**
 * Game rules: every number that defines the balance lives here. Times are in seconds at 1×,
 * distances in tiles, speeds in tiles per second. Changing a value here is verified by the
 * balance tests (tests/balance.test.js).
 */

export const TICK_RATE = 20; // simulation ticks per second
export const DT = 1 / TICK_RATE;

export const BUILD_RADIUS = 4; // tiles between a new structure and an existing one
export const ORE_BALE = 25; // credits gathered per bale
export const ORE_REGROW = { every: 6, amount: 25 }; // seconds, credits per tile
export const MAX_QUEUE = 5;
export const SELL_REFUND = 0.5;
export const LOW_POWER_SPEED = 0.5;
export const PRODUCER_BONUS = 0.75; // extra speed per additional barracks/factory
export const MAX_PRODUCERS = 3; // bonus counts up to this many producers
export const START_CREDITS = 3000;

/** Damage multiplier: WARHEADS[warhead][armour]. */
export const WARHEADS = {
  bullet: { none: 1.0, light: 0.45, heavy: 0.15, building: 0.25 },
  rocket: { none: 0.25, light: 0.9, heavy: 1.0, building: 0.6 },
  cannon: { none: 0.45, light: 0.85, heavy: 0.75, building: 0.65 },
  shell: { none: 1.0, light: 0.7, heavy: 0.45, building: 0.9 },
};

export const UNITS = {
  rifle: {
    name: "Lính súng trường",
    short: "Súng trường",
    category: "infantry",
    cost: 100,
    time: 5,
    hp: 60,
    speed: 1.3,
    sight: 6,
    armor: "none",
    radius: 0.22,
    prereq: ["barracks"],
    weapon: { damage: 10, range: 4, reload: 1.0, warhead: "bullet", speed: 0 },
    info: "Rẻ, mạnh với bộ binh, yếu với xe bọc thép.",
  },
  rocket: {
    name: "Lính tên lửa",
    short: "Tên lửa",
    category: "infantry",
    cost: 250,
    time: 7,
    hp: 55,
    speed: 1.1,
    sight: 6,
    armor: "none",
    radius: 0.22,
    prereq: ["barracks"],
    weapon: { damage: 40, range: 5, reload: 2.2, warhead: "rocket", speed: 9 },
    info: "Diệt xe tăng tốt, yếu trước lính súng trường.",
  },
  scout: {
    name: "Xe trinh sát",
    short: "Trinh sát",
    category: "vehicle",
    cost: 350,
    time: 7,
    hp: 200,
    speed: 3.2,
    sight: 8,
    armor: "light",
    radius: 0.36,
    prereq: ["factory"],
    weapon: { damage: 9, range: 4.5, reload: 0.5, warhead: "bullet", speed: 0 },
    info: "Rất nhanh, tầm nhìn xa, săn bộ binh.",
  },
  tank: {
    name: "Xe tăng Báo",
    short: "Tăng Báo",
    category: "vehicle",
    cost: 700,
    time: 11,
    hp: 360,
    speed: 2.0,
    sight: 6,
    armor: "heavy",
    radius: 0.42,
    turret: true,
    prereq: ["factory"],
    weapon: { damage: 34, range: 4.8, reload: 1.6, warhead: "cannon", speed: 12, splash: 0.6 },
    info: "Xe tăng chủ lực, cân bằng.",
  },
  heavy: {
    name: "Xe tăng Voi",
    short: "Tăng Voi",
    category: "vehicle",
    cost: 1200,
    time: 17,
    hp: 750,
    speed: 1.35,
    sight: 6,
    armor: "heavy",
    radius: 0.48,
    turret: true,
    prereq: ["factory", "tech"],
    weapon: { damage: 60, range: 5.2, reload: 2.0, warhead: "cannon", speed: 12, splash: 0.7 },
    info: "Giáp dày, pháo lớn, chậm.",
  },
  artillery: {
    name: "Pháo tự hành",
    short: "Pháo",
    category: "vehicle",
    cost: 900,
    time: 14,
    hp: 170,
    speed: 1.4,
    sight: 7,
    armor: "light",
    radius: 0.42,
    prereq: ["factory", "tech"],
    weapon: { damage: 80, range: 9.5, minRange: 3, reload: 4.0, warhead: "shell", speed: 7, splash: 1.4, arc: true },
    info: "Bắn xa, sát thương lan, không bắn được ở gần.",
  },
  harvester: {
    name: "Xe khai thác",
    short: "Khai thác",
    category: "vehicle",
    cost: 1000,
    time: 14,
    hp: 650,
    speed: 1.4,
    sight: 4,
    armor: "heavy",
    radius: 0.46,
    prereq: ["factory", "refinery"],
    capacity: 700,
    gather: 0.5, // seconds per bale
    unload: 2.0, // seconds at the refinery
    info: "Thu quặng tinh thể về nhà máy lọc.",
  },
};

export const BUILDINGS = {
  hq: {
    name: "Sở chỉ huy",
    w: 3,
    h: 3,
    hp: 1600,
    cost: 2500,
    time: 0,
    power: 20,
    sight: 8,
    prereq: [],
    buildable: false,
    produces: "structure",
    info: "Trái tim căn cứ: xây mọi công trình.",
  },
  power: { name: "Nhà máy điện", w: 2, h: 2, hp: 450, cost: 300, time: 6, power: 100, sight: 5, prereq: ["hq"], info: "+100 điện." },
  refinery: {
    name: "Nhà máy lọc quặng",
    w: 3,
    h: 2,
    hp: 900,
    cost: 1400,
    time: 12,
    power: -30,
    sight: 5,
    prereq: ["power"],
    freeUnit: "harvester",
    dock: { x: 1, y: 2 }, // tile (relative to top-left) where harvesters unload
    info: "Đổi quặng thành tiền. Tặng kèm 1 xe khai thác.",
  },
  barracks: { name: "Doanh trại", w: 2, h: 2, hp: 500, cost: 400, time: 7, power: -20, sight: 5, prereq: ["power"], produces: "infantry", info: "Huấn luyện bộ binh." },
  factory: { name: "Xưởng xe", w: 3, h: 3, hp: 1000, cost: 1600, time: 14, power: -30, sight: 5, prereq: ["refinery"], produces: "vehicle", info: "Sản xuất xe và xe tăng." },
  radar: { name: "Trạm radar", w: 2, h: 2, hp: 600, cost: 800, time: 10, power: -40, sight: 10, prereq: ["refinery"], info: "Bật bản đồ nhỏ (cần đủ điện)." },
  turret: {
    name: "Tháp pháo",
    w: 1,
    h: 1,
    hp: 500,
    cost: 550,
    time: 8,
    power: -25,
    sight: 7,
    prereq: ["barracks"],
    weapon: { damage: 32, range: 6, reload: 1.4, warhead: "cannon", speed: 12 },
    info: "Phòng thủ chống xe. Tắt khi thiếu điện.",
  },
  tech: { name: "Trung tâm công nghệ", w: 2, h: 2, hp: 700, cost: 1500, time: 14, power: -60, sight: 5, prereq: ["factory", "radar"], info: "Mở khóa Tăng Voi và Pháo tự hành." },
};

export const STRUCTURE_ORDER = ["power", "refinery", "barracks", "factory", "radar", "turret", "tech"];
export const INFANTRY_ORDER = ["rifle", "rocket"];
export const VEHICLE_ORDER = ["harvester", "scout", "tank", "heavy", "artillery"];

export const START_UNITS = ["tank", "rifle", "rifle", "rifle"];

export const AI_LEVELS = {
  easy: { name: "Dễ", think: 3.0, wave: 5, waveGrowth: 1, maxWave: 10, harvestersPerRefinery: 1, refineries: 1, turrets: 1, defend: false, factories: 1 },
  normal: { name: "Thường", think: 1.5, wave: 7, waveGrowth: 2, maxWave: 16, harvestersPerRefinery: 2, refineries: 2, turrets: 2, defend: true, factories: 1 },
  hard: { name: "Khó", think: 0.75, wave: 8, waveGrowth: 3, maxWave: 22, harvestersPerRefinery: 2, refineries: 3, turrets: 2, defend: true, factories: 2 },
};

export function isUnitType(type) {
  return Object.hasOwn(UNITS, type);
}

export function damageFor(weapon, armor) {
  return weapon.damage * WARHEADS[weapon.warhead][armor];
}
