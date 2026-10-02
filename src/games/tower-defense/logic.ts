/**
 * Pure simulation for Mini Tower Defense. No DOM access so it can be unit tested.
 * Units: positions in grid cells (cell (c, r) has its centre at (c + 0.5, r + 0.5)), time in seconds.
 */

export type TowerType = 'arrow' | 'cannon' | 'frost' | 'sniper';
export type EnemyType = 'normal' | 'fast' | 'tank' | 'flying' | 'boss';
export type Targeting = 'first' | 'strongest';
export type Difficulty = 'normal' | 'hard';
/**
 * ready: before wave 1 (unlimited build time) · wave: enemies spawning / alive · countdown: auto start of the
 * next wave pending · cleared: wave 20 beaten, waiting for the player to continue in endless · over: no lives.
 */
export type Phase = 'ready' | 'wave' | 'countdown' | 'cleared' | 'over';

export const WAVES_PER_MAP = 20;
export const COUNTDOWN = 10;
export const SLOW_CAP = 0.65;
export const SELL_RATIO = 0.7;
export const HP_GROWTH = 1.15;
export const MAX_LEVEL = 3;
export const TOWER_TYPES: TowerType[] = ['arrow', 'cannon', 'frost', 'sniper'];
export const ENEMY_TYPES: EnemyType[] = ['normal', 'fast', 'tank', 'flying', 'boss'];

// ── Maps ────────────────────────────────────────────────────────────────────

export interface MapDef {
  id: string;
  cols: number;
  rows: number;
  /** Axis-aligned waypoints [col, row]; the first must lie on an outer edge, enemies enter from outside. */
  waypoints: [number, number][];
  /** Enemy HP multiplier used to balance path length. */
  hpMult: number;
}

export const MAPS: MapDef[] = [
  {
    id: 'scurve',
    cols: 9,
    rows: 13,
    waypoints: [
      [0, 1],
      [7, 1],
      [7, 4],
      [1, 4],
      [1, 7],
      [7, 7],
      [7, 10],
      [1, 10],
      [1, 12],
    ],
    hpMult: 1,
  },
  {
    id: 'zigzag',
    cols: 9,
    rows: 13,
    waypoints: [
      [1, 0],
      [1, 11],
      [4, 11],
      [4, 1],
      [7, 1],
      [7, 12],
    ],
    hpMult: 1.15,
  },
  {
    id: 'spiral',
    cols: 9,
    rows: 13,
    waypoints: [
      [0, 0],
      [8, 0],
      [8, 12],
      [0, 12],
      [0, 2],
      [6, 2],
      [6, 10],
      [2, 10],
      [2, 4],
      [4, 4],
      [4, 8],
    ],
    hpMult: 1.45,
  },
];

export function findMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

/** Returns null when the map is valid, otherwise a short error description. */
export function validateMap(map: MapDef): string | null {
  const { cols, rows, waypoints } = map;
  if (cols < 3 || rows < 3) return 'grid too small';
  if (waypoints.length < 2) return 'need at least two waypoints';
  const inside = (c: number, r: number) => c >= 0 && c < cols && r >= 0 && r < rows;
  for (const [c, r] of waypoints) {
    if (!Number.isInteger(c) || !Number.isInteger(r) || !inside(c, r)) return `waypoint (${c},${r}) out of bounds`;
  }
  const [c0, r0] = waypoints[0];
  if (c0 !== 0 && r0 !== 0 && c0 !== cols - 1 && r0 !== rows - 1) return 'path must start on an edge';
  const seen = new Set<number>();
  for (let i = 1; i < waypoints.length; i++) {
    const [ac, ar] = waypoints[i - 1];
    const [bc, br] = waypoints[i];
    if (ac === bc && ar === br) return `duplicate waypoint at index ${i}`;
    if (ac !== bc && ar !== br) return `segment ${i} is not axis-aligned`;
    const dc = Math.sign(bc - ac);
    const dr = Math.sign(br - ar);
    let c = ac;
    let r = ar;
    if (i === 1) {
      // The entry point (one cell before the first waypoint) must be outside the grid.
      if (inside(ac - dc, ar - dr)) return 'path must enter from outside the grid';
      seen.add(r * cols + c);
    }
    while (c !== bc || r !== br) {
      c += dc;
      r += dr;
      const key = r * cols + c;
      if (seen.has(key)) return `path crosses itself at (${c},${r})`;
      seen.add(key);
    }
  }
  return null;
}

/** Ordered list of path cells (assumes a valid map). */
export function buildPath(map: MapDef): [number, number][] {
  const cells: [number, number][] = [];
  const wp = map.waypoints;
  cells.push([wp[0][0], wp[0][1]]);
  for (let i = 1; i < wp.length; i++) {
    const [ac, ar] = wp[i - 1];
    const [bc, br] = wp[i];
    const dc = Math.sign(bc - ac);
    const dr = Math.sign(br - ar);
    let c = ac;
    let r = ar;
    while (c !== bc || r !== br) {
      c += dc;
      r += dr;
      cells.push([c, r]);
    }
  }
  return cells;
}

export interface Point {
  x: number;
  y: number;
}

export interface PathGeom {
  cells: [number, number][];
  /** Polyline through cell centres, prefixed by the off-grid entry point. */
  points: Point[];
  /** Cumulative distance at each point. */
  cum: number[];
  length: number;
}

export function pathGeometry(map: MapDef): PathGeom {
  const cells = buildPath(map);
  const points: Point[] = cells.map(([c, r]) => ({ x: c + 0.5, y: r + 0.5 }));
  const first = points[0];
  const second = points[1] ?? { x: first.x + 1, y: first.y };
  const dx = Math.sign(second.x - first.x);
  const dy = Math.sign(second.y - first.y);
  points.unshift({ x: first.x - dx, y: first.y - dy });
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return { cells, points, cum, length: cum[cum.length - 1] };
}

/** Position at distance `dist` along the path. `segHint` speeds up the lookup for forward-moving enemies. */
export function pointOnPath(geom: PathGeom, dist: number, segHint = 0): { x: number; y: number; seg: number } {
  const { points, cum } = geom;
  if (dist <= 0) return { x: points[0].x, y: points[0].y, seg: 0 };
  const last = points.length - 1;
  if (dist >= geom.length) return { x: points[last].x, y: points[last].y, seg: last - 1 };
  let seg = Math.min(Math.max(segHint, 0), last - 1);
  while (seg > 0 && cum[seg] > dist) seg--;
  while (seg < last - 1 && cum[seg + 1] < dist) seg++;
  const a = points[seg];
  const b = points[seg + 1];
  const segLen = cum[seg + 1] - cum[seg];
  const t = segLen > 0 ? (dist - cum[seg]) / segLen : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, seg };
}

// ── Definitions ─────────────────────────────────────────────────────────────

export interface TowerLevel {
  dmg: number;
  range: number;
  /** Shots per second. */
  rate: number;
  /** Build cost for level 1, upgrade cost for levels 2 and 3. */
  cost: number;
  /** Splash radius in cells (cannon). */
  splash?: number;
  /** Slow fraction and duration (frost). */
  slow?: number;
  slowDur?: number;
}

export interface TowerDef {
  type: TowerType;
  levels: TowerLevel[];
  hitsFlying: boolean;
  /** Damage multiplier against bosses. */
  bossMult: number;
  /** Projectile speed in cells / s; 0 = instant hit. */
  projectileSpeed: number;
  defaultTargeting: Targeting;
}

export const TOWER_DEFS: Record<TowerType, TowerDef> = {
  arrow: {
    type: 'arrow',
    levels: [
      { dmg: 7, range: 2.3, rate: 2.5, cost: 50 },
      { dmg: 12, range: 2.6, rate: 2.9, cost: 45 },
      { dmg: 21, range: 2.9, rate: 3.3, cost: 85 },
    ],
    hitsFlying: true,
    bossMult: 1,
    projectileSpeed: 9,
    defaultTargeting: 'first',
  },
  cannon: {
    type: 'cannon',
    levels: [
      { dmg: 26, range: 2.1, rate: 0.7, cost: 90, splash: 0.9 },
      { dmg: 46, range: 2.4, rate: 0.75, cost: 80, splash: 1.0 },
      { dmg: 80, range: 2.7, rate: 0.8, cost: 140, splash: 1.15 },
    ],
    hitsFlying: false,
    bossMult: 1,
    projectileSpeed: 5,
    defaultTargeting: 'first',
  },
  frost: {
    type: 'frost',
    levels: [
      { dmg: 3, range: 2.0, rate: 1.2, cost: 70, slow: 0.3, slowDur: 1.6 },
      { dmg: 5, range: 2.3, rate: 1.3, cost: 60, slow: 0.4, slowDur: 1.8 },
      { dmg: 8, range: 2.6, rate: 1.5, cost: 100, slow: 0.5, slowDur: 2.0 },
    ],
    hitsFlying: false,
    bossMult: 1,
    projectileSpeed: 7,
    defaultTargeting: 'first',
  },
  sniper: {
    type: 'sniper',
    levels: [
      { dmg: 55, range: 4.2, rate: 0.45, cost: 120 },
      { dmg: 100, range: 4.7, rate: 0.5, cost: 110 },
      { dmg: 180, range: 5.2, rate: 0.55, cost: 180 },
    ],
    hitsFlying: true,
    bossMult: 2,
    projectileSpeed: 0,
    defaultTargeting: 'strongest',
  },
};

export interface EnemyDef {
  hp: number;
  /** Cells per second. */
  speed: number;
  reward: number;
  /** Lives lost when it reaches the base. */
  lives: number;
  radius: number;
  flying: boolean;
  /** Seconds between two spawns of this type. */
  gap: number;
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  normal: { hp: 36, speed: 1.5, reward: 4, lives: 1, radius: 0.22, flying: false, gap: 0.8 },
  fast: { hp: 20, speed: 2.6, reward: 4, lives: 1, radius: 0.18, flying: false, gap: 0.5 },
  tank: { hp: 140, speed: 0.9, reward: 10, lives: 1, radius: 0.28, flying: false, gap: 1.3 },
  flying: { hp: 34, speed: 1.8, reward: 6, lives: 1, radius: 0.2, flying: true, gap: 0.7 },
  boss: { hp: 1000, speed: 0.7, reward: 100, lives: 5, radius: 0.36, flying: false, gap: 2.5 },
};

export interface DifficultyDef {
  lives: number;
  money: number;
  hpMult: number;
  rewardMult: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  normal: { lives: 20, money: 150, hpMult: 1, rewardMult: 1 },
  hard: { lives: 10, money: 130, hpMult: 1.3, rewardMult: 0.9 },
};

export function enemyHp(type: EnemyType, wave: number, hpMult = 1): number {
  return Math.round(ENEMY_DEFS[type].hp * Math.pow(HP_GROWTH, wave - 1) * hpMult);
}

export function enemyReward(type: EnemyType, wave: number, rewardMult = 1): number {
  return Math.max(1, Math.round(ENEMY_DEFS[type].reward * (1 + 0.05 * (wave - 1)) * rewardMult));
}

export function waveClearBonus(wave: number, rewardMult = 1): number {
  return Math.round((20 + wave * 5) * rewardMult);
}

// ── Waves ───────────────────────────────────────────────────────────────────

export interface SpawnGroup {
  type: EnemyType;
  count: number;
  /** Seconds between spawns inside the group. */
  gap: number;
}

export interface SpawnItem {
  type: EnemyType;
  /** Delay before this spawn (from the previous spawn). */
  delay: number;
}

const SCRIPT: [EnemyType, number][][] = [
  [['normal', 8]],
  [['normal', 12]],
  [['normal', 8], ['fast', 6]],
  [['normal', 10], ['tank', 2]],
  [['fast', 14]],
  [['normal', 8], ['flying', 6]],
  [['tank', 4], ['normal', 10]],
  [['fast', 10], ['flying', 6]],
  [['normal', 14], ['tank', 4], ['fast', 6]],
  [['boss', 1], ['normal', 10]],
  [['flying', 12]],
  [['tank', 8], ['fast', 8]],
  [['normal', 22]],
  [['fast', 14], ['flying', 8]],
  [['tank', 10], ['normal', 12]],
  [['flying', 14], ['tank', 4]],
  [['fast', 20], ['normal', 10]],
  [['tank', 12], ['flying', 8]],
  [['normal', 24], ['fast', 12], ['tank', 6]],
  [['boss', 2], ['tank', 6], ['normal', 12]],
];

/** Scripted composition for waves 1–20, formula-based afterwards (endless). */
export function waveComposition(wave: number): SpawnGroup[] {
  const w = Math.max(1, Math.floor(wave));
  const tempo = Math.max(0.55, 1 - (w - 1) * 0.015);
  const mk = (type: EnemyType, count: number): SpawnGroup => ({ type, count, gap: Math.round(ENEMY_DEFS[type].gap * tempo * 100) / 100 });
  if (w <= SCRIPT.length) return SCRIPT[w - 1].map(([type, count]) => mk(type, count));
  const k = w - SCRIPT.length;
  const groups: SpawnGroup[] = [];
  if (w % 10 === 0) groups.push(mk('boss', Math.floor(w / 10)));
  groups.push(mk('tank', 6 + k));
  groups.push(mk('normal', 12 + 2 * k));
  groups.push(mk('flying', 6 + k));
  groups.push(mk('fast', 8 + k));
  return groups;
}

/** Flattens spawn groups into timed spawn items (1 s pause between groups). */
export function expandWave(groups: SpawnGroup[]): SpawnItem[] {
  const items: SpawnItem[] = [];
  groups.forEach((g, gi) => {
    for (let i = 0; i < g.count; i++) {
      items.push({ type: g.type, delay: items.length === 0 ? 0 : i === 0 && gi > 0 ? 1 : g.gap });
    }
  });
  return items;
}

// ── Entities ────────────────────────────────────────────────────────────────

export interface Slow {
  src: number;
  amount: number;
  until: number;
}

export interface Enemy {
  id: number;
  type: EnemyType;
  hp: number;
  maxHp: number;
  speed: number;
  reward: number;
  lives: number;
  radius: number;
  flying: boolean;
  dist: number;
  seg: number;
  x: number;
  y: number;
  slows: Slow[];
  leaked: boolean;
  lastHitBy: number;
}

export interface Tower {
  id: number;
  type: TowerType;
  col: number;
  row: number;
  x: number;
  y: number;
  level: number;
  cooldown: number;
  targetId: number | null;
  targeting: Targeting;
  invested: number;
  angle: number;
  kills: number;
}

export interface Projectile {
  id: number;
  kind: TowerType;
  x: number;
  y: number;
  tx: number;
  ty: number;
  targetId: number;
  speed: number;
  dmg: number;
  splash: number;
  slow: number;
  slowDur: number;
  src: number;
  bossMult: number;
  done: boolean;
}

export type GameEvent =
  | { type: 'shoot'; tower: TowerType; x: number; y: number }
  | { type: 'tracer'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'hit'; kind: TowerType; x: number; y: number; splash: number }
  | { type: 'kill'; enemy: EnemyType; x: number; y: number; reward: number }
  | { type: 'leak'; enemy: EnemyType; lives: number }
  | { type: 'spawn'; enemy: EnemyType }
  | { type: 'waveStart'; wave: number; bonus: number }
  | { type: 'waveClear'; wave: number; bonus: number }
  | { type: 'mapCleared'; wave: number }
  | { type: 'gameOver'; wave: number };

export interface GameState {
  map: MapDef;
  geom: PathGeom;
  isPath: boolean[];
  difficulty: Difficulty;
  lives: number;
  money: number;
  wave: number;
  phase: Phase;
  endless: boolean;
  time: number;
  countdown: number;
  enemies: Enemy[];
  towers: Tower[];
  projectiles: Projectile[];
  spawnQueue: SpawnItem[];
  spawnTimer: number;
  events: GameEvent[];
  nextId: number;
  kills: number;
  leaked: number;
}

export function createGame(map: MapDef, difficulty: Difficulty): GameState {
  const geom = pathGeometry(map);
  const isPath = new Array<boolean>(map.cols * map.rows).fill(false);
  for (const [c, r] of geom.cells) isPath[r * map.cols + c] = true;
  const d = DIFFICULTY[difficulty];
  return {
    map,
    geom,
    isPath,
    difficulty,
    lives: d.lives,
    money: d.money,
    wave: 0,
    phase: 'ready',
    endless: false,
    time: 0,
    countdown: 0,
    enemies: [],
    towers: [],
    projectiles: [],
    spawnQueue: [],
    spawnTimer: 0,
    events: [],
    nextId: 1,
    kills: 0,
    leaked: 0,
  };
}

export function isPathCell(s: GameState, col: number, row: number): boolean {
  return s.isPath[row * s.map.cols + col] === true;
}

export function towerAt(s: GameState, col: number, row: number): Tower | undefined {
  return s.towers.find((t) => t.col === col && t.row === row);
}

export function canBuild(s: GameState, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= s.map.cols || row >= s.map.rows) return false;
  if (isPathCell(s, col, row)) return false;
  return !towerAt(s, col, row);
}

export function towerStats(type: TowerType, level: number): TowerLevel {
  const lv = TOWER_DEFS[type].levels;
  return lv[Math.min(Math.max(level, 1), lv.length) - 1];
}

export function buildCost(type: TowerType): number {
  return TOWER_DEFS[type].levels[0].cost;
}

/** Cost of the next upgrade, or null when the tower is maxed. */
export function upgradeCost(tower: Pick<Tower, 'type' | 'level'>): number | null {
  if (tower.level >= MAX_LEVEL) return null;
  return TOWER_DEFS[tower.type].levels[tower.level].cost;
}

export function sellValue(tower: Pick<Tower, 'invested'>): number {
  return Math.round(tower.invested * SELL_RATIO);
}

export function build(s: GameState, col: number, row: number, type: TowerType): Tower | null {
  if (s.phase === 'over') return null;
  if (!canBuild(s, col, row)) return null;
  const cost = buildCost(type);
  if (s.money < cost) return null;
  s.money -= cost;
  const tower: Tower = {
    id: s.nextId++,
    type,
    col,
    row,
    x: col + 0.5,
    y: row + 0.5,
    level: 1,
    cooldown: 0,
    targetId: null,
    targeting: TOWER_DEFS[type].defaultTargeting,
    invested: cost,
    angle: -Math.PI / 2,
    kills: 0,
  };
  s.towers.push(tower);
  return tower;
}

export function upgrade(s: GameState, towerId: number): boolean {
  if (s.phase === 'over') return false;
  const t = s.towers.find((x) => x.id === towerId);
  if (!t) return false;
  const cost = upgradeCost(t);
  if (cost === null || s.money < cost) return false;
  s.money -= cost;
  t.level++;
  t.invested += cost;
  return true;
}

/** Removes the tower and refunds 70 % of everything invested. Returns the refund (0 if nothing sold). */
export function sell(s: GameState, towerId: number): number {
  const i = s.towers.findIndex((x) => x.id === towerId);
  if (i < 0) return 0;
  const refund = sellValue(s.towers[i]);
  s.towers.splice(i, 1);
  s.money += refund;
  return refund;
}

export function setTargeting(s: GameState, towerId: number, mode: Targeting): void {
  const t = s.towers.find((x) => x.id === towerId);
  if (t && t.targeting !== mode) {
    t.targeting = mode;
    t.targetId = null;
  }
}

// ── Waves / phases ──────────────────────────────────────────────────────────

/** Money granted for calling the next wave `remaining` seconds early. */
export function earlyBonus(wave: number, remaining: number, rewardMult = 1): number {
  if (remaining <= 0) return 0;
  return Math.ceil(remaining * (1 + wave * 0.2) * rewardMult);
}

export function canStartWave(s: GameState): boolean {
  return s.phase === 'ready' || s.phase === 'countdown';
}

/** Starts the next wave. Returns the early-call bonus granted (0 when none), or -1 when not allowed. */
export function startWave(s: GameState, early = false): number {
  if (!canStartWave(s)) return -1;
  const bonus = early && s.phase === 'countdown' ? earlyBonus(s.wave, s.countdown, DIFFICULTY[s.difficulty].rewardMult) : 0;
  s.money += bonus;
  s.wave++;
  s.phase = 'wave';
  s.countdown = 0;
  s.spawnQueue = expandWave(waveComposition(s.wave));
  s.spawnTimer = 0;
  s.events.push({ type: 'waveStart', wave: s.wave, bonus });
  processSpawns(s, 0);
  return bonus;
}

export function continueEndless(s: GameState): void {
  if (s.phase !== 'cleared') return;
  s.endless = true;
  s.phase = 'countdown';
  s.countdown = COUNTDOWN;
}

export function spawnEnemy(s: GameState, type: EnemyType): Enemy {
  const def = ENEMY_DEFS[type];
  const d = DIFFICULTY[s.difficulty];
  const start = pointOnPath(s.geom, 0, 0);
  const hp = enemyHp(type, s.wave, d.hpMult * s.map.hpMult);
  const e: Enemy = {
    id: s.nextId++,
    type,
    hp,
    maxHp: hp,
    speed: def.speed,
    reward: enemyReward(type, s.wave, d.rewardMult),
    lives: def.lives,
    radius: def.radius,
    flying: def.flying,
    dist: 0,
    seg: 0,
    x: start.x,
    y: start.y,
    slows: [],
    leaked: false,
    lastHitBy: 0,
  };
  s.enemies.push(e);
  s.events.push({ type: 'spawn', enemy: type });
  return e;
}

function processSpawns(s: GameState, dt: number): void {
  if (!s.spawnQueue.length) return;
  s.spawnTimer -= dt;
  while (s.spawnTimer <= 0 && s.spawnQueue.length) {
    const item = s.spawnQueue.shift() as SpawnItem;
    spawnEnemy(s, item.type);
    if (s.spawnQueue.length) s.spawnTimer += s.spawnQueue[0].delay;
  }
}

// ── Combat helpers ──────────────────────────────────────────────────────────

/** Adds (or refreshes) a slow from `src`. Different sources stack up to SLOW_CAP. */
export function applySlow(e: Enemy, src: number, amount: number, duration: number, now: number): void {
  const existing = e.slows.find((sl) => sl.src === src);
  if (existing) {
    existing.amount = Math.max(existing.amount, amount);
    existing.until = Math.max(existing.until, now + duration);
  } else {
    e.slows.push({ src, amount, until: now + duration });
  }
}

/** Current slow fraction in [0, SLOW_CAP]; expired slows are pruned. */
export function slowFactor(e: Enemy, now: number): number {
  if (!e.slows.length) return 0;
  let total = 0;
  for (let i = e.slows.length - 1; i >= 0; i--) {
    if (e.slows[i].until <= now) e.slows.splice(i, 1);
    else total += e.slows[i].amount;
  }
  return Math.min(SLOW_CAP, total);
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function canHit(def: TowerDef, e: Enemy): boolean {
  return e.hp > 0 && !e.leaked && (def.hitsFlying || !e.flying);
}

export function inRange(tower: Pick<Tower, 'x' | 'y'>, range: number, e: Pick<Enemy, 'x' | 'y'>): boolean {
  return dist2(tower.x, tower.y, e.x, e.y) <= range * range;
}

/** Picks a target: 'first' = furthest along the path, 'strongest' = most HP (ties → furthest). */
export function pickTarget(tower: Tower, enemies: Enemy[], range = towerStats(tower.type, tower.level).range): Enemy | null {
  const def = TOWER_DEFS[tower.type];
  let best: Enemy | null = null;
  for (const e of enemies) {
    if (!canHit(def, e) || !inRange(tower, range, e)) continue;
    if (!best) {
      best = e;
      continue;
    }
    if (tower.targeting === 'strongest') {
      if (e.hp > best.hp || (e.hp === best.hp && e.dist > best.dist)) best = e;
    } else if (e.dist > best.dist) best = e;
  }
  return best;
}

function findEnemy(s: GameState, id: number): Enemy | undefined {
  return s.enemies.find((e) => e.id === id);
}

export function damage(e: Enemy, amount: number, src: number): boolean {
  if (e.hp <= 0) return false;
  e.hp -= amount;
  e.lastHitBy = src;
  return e.hp <= 0;
}

function fire(s: GameState, t: Tower, def: TowerDef, lv: TowerLevel, target: Enemy): void {
  t.angle = Math.atan2(target.y - t.y, target.x - t.x);
  s.events.push({ type: 'shoot', tower: t.type, x: t.x, y: t.y });
  if (def.projectileSpeed <= 0) {
    const dmg = lv.dmg * (target.type === 'boss' ? def.bossMult : 1);
    damage(target, dmg, t.id);
    s.events.push({ type: 'tracer', x1: t.x, y1: t.y, x2: target.x, y2: target.y });
    s.events.push({ type: 'hit', kind: t.type, x: target.x, y: target.y, splash: 0 });
    return;
  }
  s.projectiles.push({
    id: s.nextId++,
    kind: t.type,
    x: t.x,
    y: t.y,
    tx: target.x,
    ty: target.y,
    targetId: target.id,
    speed: def.projectileSpeed,
    dmg: lv.dmg,
    splash: lv.splash ?? 0,
    slow: lv.slow ?? 0,
    slowDur: lv.slowDur ?? 0,
    src: t.id,
    bossMult: def.bossMult,
    done: false,
  });
}

function impact(s: GameState, p: Projectile, target: Enemy | null): void {
  s.events.push({ type: 'hit', kind: p.kind, x: p.tx, y: p.ty, splash: p.splash });
  if (p.splash > 0) {
    const r2 = p.splash * p.splash;
    for (const e of s.enemies) {
      if (e.hp <= 0 || e.leaked || e.flying) continue;
      if (dist2(e.x, e.y, p.tx, p.ty) <= r2) damage(e, p.dmg * (e.type === 'boss' ? p.bossMult : 1), p.src);
    }
    return;
  }
  if (!target) return;
  damage(target, p.dmg * (target.type === 'boss' ? p.bossMult : 1), p.src);
  if (p.slow > 0) applySlow(target, p.src, p.slow, p.slowDur, s.time);
}

// ── Main step ───────────────────────────────────────────────────────────────

/** Advances the simulation by `dt` seconds (call with small steps, ≤ 1/30 s, for stable combat). */
export function tick(s: GameState, dt: number): void {
  if (s.phase === 'ready' || s.phase === 'over' || s.phase === 'cleared') return;
  s.time += dt;
  processSpawns(s, dt);

  // Enemies walk.
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    e.dist += e.speed * (1 - slowFactor(e, s.time)) * dt;
    if (e.dist >= s.geom.length) {
      e.leaked = true;
      continue;
    }
    const p = pointOnPath(s.geom, e.dist, e.seg);
    e.x = p.x;
    e.y = p.y;
    e.seg = p.seg;
  }

  // Towers acquire targets and fire.
  for (const t of s.towers) {
    t.cooldown -= dt;
    const def = TOWER_DEFS[t.type];
    const lv = def.levels[t.level - 1];
    let target = t.targetId === null ? undefined : findEnemy(s, t.targetId);
    if (target && (!canHit(def, target) || !inRange(t, lv.range + 0.15, target))) target = undefined;
    if (!target) {
      target = pickTarget(t, s.enemies, lv.range) ?? undefined;
      t.targetId = target ? target.id : null;
    }
    if (target) {
      if (t.cooldown <= 0) {
        t.cooldown += 1 / lv.rate;
        if (t.cooldown < 0) t.cooldown = 1 / lv.rate;
        fire(s, t, def, lv, target);
      }
    } else if (t.cooldown < 0) t.cooldown = 0;
  }

  // Projectiles home in on their target (or its last position).
  for (const p of s.projectiles) {
    const target = findEnemy(s, p.targetId);
    const alive = target !== undefined && target.hp > 0 && !target.leaked;
    if (alive) {
      p.tx = target.x;
      p.ty = target.y;
    }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * dt;
    if (d <= step) {
      p.x = p.tx;
      p.y = p.ty;
      impact(s, p, alive ? (target as Enemy) : null);
      p.done = true;
    } else {
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
    }
  }
  if (s.projectiles.some((p) => p.done)) s.projectiles = s.projectiles.filter((p) => !p.done);

  // Resolve leaks and deaths.
  let removed = false;
  for (const e of s.enemies) {
    if (e.leaked) {
      s.lives -= e.lives;
      s.leaked++;
      s.events.push({ type: 'leak', enemy: e.type, lives: e.lives });
      removed = true;
    } else if (e.hp <= 0) {
      s.money += e.reward;
      s.kills++;
      const killer = s.towers.find((t) => t.id === e.lastHitBy);
      if (killer) killer.kills++;
      s.events.push({ type: 'kill', enemy: e.type, x: e.x, y: e.y, reward: e.reward });
      removed = true;
    }
  }
  if (removed) s.enemies = s.enemies.filter((e) => !e.leaked && e.hp > 0);

  if (s.lives <= 0) {
    s.lives = 0;
    s.phase = 'over';
    s.projectiles = [];
    s.events.push({ type: 'gameOver', wave: s.wave });
    return;
  }

  if (s.phase === 'wave') {
    if (!s.spawnQueue.length && !s.enemies.length) {
      const bonus = waveClearBonus(s.wave, DIFFICULTY[s.difficulty].rewardMult);
      s.money += bonus;
      s.events.push({ type: 'waveClear', wave: s.wave, bonus });
      if (s.wave >= WAVES_PER_MAP && !s.endless) {
        s.phase = 'cleared';
        s.events.push({ type: 'mapCleared', wave: s.wave });
      } else {
        s.phase = 'countdown';
        s.countdown = COUNTDOWN;
      }
    }
  } else if (s.phase === 'countdown') {
    s.countdown -= dt;
    if (s.countdown <= 0) startWave(s, false);
  }
}

/** Drains and returns pending events. */
export function takeEvents(s: GameState): GameEvent[] {
  if (!s.events.length) return [];
  const ev = s.events;
  s.events = [];
  return ev;
}

/** Number of path cells within `range` of a cell centre — a quick "how good is this spot" heuristic. */
export function pathCoverage(s: GameState, col: number, row: number, range: number): number {
  const cx = col + 0.5;
  const cy = row + 0.5;
  let n = 0;
  for (const [c, r] of s.geom.cells) {
    if (dist2(cx, cy, c + 0.5, r + 0.5) <= range * range) n++;
  }
  return n;
}
