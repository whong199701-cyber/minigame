/**
 * Pure simulation for Bullet Dodge (no DOM). Everything is expressed in logical arena units
 * (the arena is ARENA_W units wide; the UI scales it to the screen).
 *
 * The world is advanced with `step(world, dt)` using small fixed steps. Pattern emitters are spawned by a
 * phase-driven scheduler; each emitter first shows a telegraph (`delay`) and then emits its bullets.
 * The UI drains `world.events` after every step for sounds, haptics and particles.
 */

export type Mode = 'easy' | 'normal' | 'hard';
export const MODE_IDS: Mode[] = ['easy', 'normal', 'hard'];

export interface ModeConfig {
  /** Hits you can take (1 = first hit ends the run). */
  lives: number;
  /** Global bullet speed multiplier. */
  speedMul: number;
  /** >1 means more patterns and bullets. */
  densityMul: number;
  /** Slow homing orbs join the pattern pool. */
  homing: boolean;
  /** Phase from which extra single aimed "sniper" shots run in parallel to the patterns. */
  sniperFrom: number;
  /** Invulnerability (s) after losing a life. */
  hitInvuln: number;
}

export const MODES: Record<Mode, ModeConfig> = {
  easy: { lives: 3, speedMul: 0.82, densityMul: 0.8, homing: false, sniperFrom: 6, hitInvuln: 1.5 },
  normal: { lives: 1, speedMul: 1, densityMul: 1, homing: false, sniperFrom: 4, hitInvuln: 1.5 },
  hard: { lives: 1, speedMul: 1.15, densityMul: 1.2, homing: true, sniperFrom: 3, hitInvuln: 1.5 },
};

export function isMode(v: unknown): v is Mode {
  return v === 'easy' || v === 'normal' || v === 'hard';
}

// ── Constants ────────────────────────────────────────────────────────────
export const ARENA_W = 360;
export const ARENA_H_MIN = 520;
export const ARENA_H_MAX = 700;
/** Radius of the ship's vulnerable core (the bright dot). */
export const CORE_R = 3.5;
/** Extra distance beyond contact that counts as a near miss ("graze"). */
export const GRAZE_R = 12;
/** Ship ↔ power-up pickup distance. */
export const PICKUP_R = 22;
/** How close to the arena edge the core may go. */
export const SHIP_MARGIN = 6;
export const PHASE_LEN = 10;
export const SLOW_DURATION = 3;
export const SLOW_SCALE = 0.4;
export const SHIELD_INVULN = 1;
/** Bullets within this radius are wiped when a shield breaks or a life is lost. */
export const CLEAR_RADIUS = 72;
export const CULL_MARGIN = 24;
export const MAX_BULLET_AGE = 25;
export const HARD_BULLET_CAP = 700;
export const WALL_SPACING = 13;
export const RING_MAX = 28;
/** Minimum distance between the ship and a point-origin pattern (radial / spiral) when it is placed. */
export const MIN_POINT_DIST = 160;
/** Minimum distance between the ship and an edge spawner when it is placed. */
export const MIN_EDGE_DIST = 130;
export const POWERUP_LIFE = 8;
export const FIRST_PATTERN_DELAY = 1;

export type PatternType = 'aimed' | 'fan' | 'radial' | 'spiral' | 'wallH' | 'wallV' | 'bounce' | 'homing';
/** Visual / colour class of a bullet: aimed shots (warm), geometric patterns (cool), homing orbs. */
export type BulletKind = 'aim' | 'pat' | 'orb';
export type PowerKind = 'shield' | 'slow';

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  kind: BulletKind;
  /** Remaining reflections off the arena edge. */
  bounces: number;
  /** Seconds of homing left (0 = flies straight). */
  homing: number;
  /** Homing turn rate (rad/s). */
  turn: number;
  age: number;
  grazed: boolean;
  /** 0 = loose bullet, 1 = part of a horizontal wall, 2 = part of a vertical wall. */
  wall: 0 | 1 | 2;
}

export interface Emitter {
  type: PatternType;
  x: number;
  y: number;
  /** Inward normal for edge spawners. */
  nx: number;
  ny: number;
  /** Elapsed (bullet) time since creation. */
  t: number;
  /** Telegraph duration before the first emission. */
  delay: number;
  total: number;
  emitted: number;
  interval: number;
  /** Time (after delay) of the next emission. */
  next: number;
  speed: number;
  r: number;
  /** Ring size, fan width or spiral arm count. */
  count: number;
  angle: number;
  spin: number;
  spread: number;
  /** Wall gap centres (one per emission). */
  gaps: number[];
  gapW: number;
  /** Wall direction (+1 = down / right, -1 = up / left). */
  dir: 1 | -1;
  done: boolean;
  /** Background single aimed shot (not counted towards pattern concurrency). */
  sniper: boolean;
}

export interface PowerUp {
  kind: PowerKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

export type GameEvent =
  | { type: 'phase'; phase: number }
  | { type: 'emit'; pattern: PatternType; x: number; y: number }
  | { type: 'hit'; x: number; y: number; lives: number }
  | { type: 'shieldBreak'; x: number; y: number }
  | { type: 'death'; x: number; y: number }
  | { type: 'pickup'; kind: PowerKind; x: number; y: number }
  | { type: 'powerSpawn'; kind: PowerKind; x: number; y: number }
  | { type: 'powerExpire'; x: number; y: number }
  | { type: 'graze'; x: number; y: number }
  | { type: 'clear'; points: { x: number; y: number; kind: BulletKind }[] }
  | { type: 'slowEnd' };

export interface World {
  mode: Mode;
  cfg: ModeConfig;
  W: number;
  H: number;
  rand: () => number;
  /** Survival time in real seconds (the score). */
  time: number;
  phase: number;
  ship: { x: number; y: number };
  lives: number;
  shield: boolean;
  invuln: number;
  slowLeft: number;
  /** Current bullet-time multiplier (eases towards SLOW_SCALE during slow-mo). */
  timeScale: number;
  alive: boolean;
  grazes: number;
  hits: number;
  pickups: number;
  bullets: Bullet[];
  emitters: Emitter[];
  powerups: PowerUp[];
  spawnCd: number;
  sniperCd: number;
  powerCd: number;
  lastPattern: PatternType | null;
  lastWallAt: number;
  /** Patterns unlocked by the latest phase change; shown first. */
  intro: PatternType[];
  events: GameEvent[];
  /** Test aid: hits never cost anything. */
  god: boolean;
}

// ── Small helpers ────────────────────────────────────────────────────────

export function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** True when two circles overlap (touching edges count as no hit). */
export function circleHit(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy < rr * rr;
}

/** Does a bullet touch the ship's core? */
export function bulletHitsCore(b: Pick<Bullet, 'x' | 'y' | 'r'>, sx: number, sy: number): boolean {
  return circleHit(b.x, b.y, b.r, sx, sy, CORE_R);
}

export function phaseAt(time: number): number {
  return 1 + Math.floor(Math.max(0, time) / PHASE_LEN);
}

/** Logical arena size for a container of the given CSS size: fixed width, height follows the aspect ratio. */
export function arenaSize(availW: number, availH: number): { W: number; H: number } {
  const w = Math.max(1, availW);
  const h = Math.max(1, availH);
  return { W: ARENA_W, H: Math.round(clampNum((h * ARENA_W) / w, ARENA_H_MIN, ARENA_H_MAX)) };
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

// ── Phase scaling ────────────────────────────────────────────────────────

export interface PhaseParams {
  /** Multiplier on all base bullet speeds. */
  speed: number;
  /** Seconds between pattern starts. */
  interval: number;
  /** Max concurrent pattern emitters. */
  maxActive: number;
  /** No new pattern starts while this many bullets are alive. */
  bulletCap: number;
  ring: number;
  doubleRing: boolean;
  arms: number;
  spin: number;
  aimedShots: number;
  fanCount: number;
  fanVolleys: number;
  wallGap: number;
  doubleWall: boolean;
  bounceCount: number;
  /** Seconds between sniper shots (Infinity = off). */
  sniperInterval: number;
  maxOrbs: number;
}

export function phaseParams(phase: number, cfg: ModeConfig): PhaseParams {
  const p = Math.max(1, Math.floor(phase));
  const k = p - 1;
  return {
    speed: cfg.speedMul * Math.min(1.85, 1 + 0.07 * k),
    interval: Math.max(0.7, 2.2 - 0.15 * k) / cfg.densityMul,
    maxActive: Math.min(4, 1 + Math.floor(k / 2)),
    bulletCap: Math.round(Math.min(440, 150 + 30 * k) * cfg.densityMul),
    ring: Math.min(RING_MAX, Math.round((10 + 2 * k) * cfg.densityMul)),
    doubleRing: p >= 5,
    arms: Math.min(6, 3 + Math.floor(Math.max(0, p - 3) / 2)),
    spin: Math.min(2.4, 1.3 + 0.1 * k),
    aimedShots: Math.min(7, 3 + Math.floor(k / 2)),
    fanCount: Math.min(7, 3 + 2 * Math.floor(Math.max(0, p - 3) / 3)),
    fanVolleys: p >= 6 ? 3 : 2,
    wallGap: Math.max(36, 58 - 2.5 * k),
    doubleWall: p >= 6,
    bounceCount: Math.min(12, 6 + Math.floor(k / 2)),
    sniperInterval: p >= cfg.sniperFrom ? Math.max(0.55, 1.8 - 0.1 * k) / cfg.densityMul : Infinity,
    maxOrbs: cfg.homing ? Math.min(4, 1 + Math.floor(p / 3)) : 0,
  };
}

interface PatternDef {
  type: PatternType;
  from: number;
  weight: number;
  homingOnly?: boolean;
}

const PATTERNS: PatternDef[] = [
  { type: 'aimed', from: 1, weight: 3 },
  { type: 'radial', from: 1, weight: 3 },
  { type: 'wallH', from: 2, weight: 2.2 },
  { type: 'spiral', from: 3, weight: 2.2 },
  { type: 'fan', from: 3, weight: 2 },
  { type: 'homing', from: 3, weight: 1.6, homingOnly: true },
  { type: 'bounce', from: 4, weight: 2 },
  { type: 'wallV', from: 4, weight: 1.6 },
];

/** Patterns (with weights) that may appear in a phase. */
export function patternPool(phase: number, cfg: ModeConfig): { type: PatternType; weight: number }[] {
  return PATTERNS.filter((p) => phase >= p.from && (!p.homingOnly || cfg.homing)).map((p) => ({ type: p.type, weight: p.weight }));
}

/** Patterns that first appear exactly in this phase. */
export function unlockedAt(phase: number, cfg: ModeConfig): PatternType[] {
  return PATTERNS.filter((p) => p.from === phase && (!p.homingOnly || cfg.homing)).map((p) => p.type);
}

/** i18n key of the subtitle announcing what a new phase brings. */
export function introKey(phase: number, cfg: ModeConfig): string {
  if (phase <= 1) return 'introStart';
  if (phase === 2) return 'introWalls';
  if (phase === 3) return cfg.homing ? 'introSpiralsHoming' : 'introSpirals';
  if (phase === 4) return 'introBounce';
  if (phase === 5) return 'introDoubleRing';
  if (phase === 6) return 'introDoubleWall';
  return 'introFaster';
}

// ── World ────────────────────────────────────────────────────────────────

export function createWorld(mode: Mode, W: number = ARENA_W, H: number = 560, rand: () => number = Math.random): World {
  const cfg = MODES[mode];
  return {
    mode,
    cfg,
    W,
    H,
    rand,
    time: 0,
    phase: 1,
    ship: { x: W / 2, y: Math.round(H * 0.78) },
    lives: cfg.lives,
    shield: false,
    invuln: 0,
    slowLeft: 0,
    timeScale: 1,
    alive: true,
    grazes: 0,
    hits: 0,
    pickups: 0,
    bullets: [],
    emitters: [],
    powerups: [],
    spawnCd: FIRST_PATTERN_DELAY,
    sniperCd: 1.5,
    powerCd: 8 + rand() * 3,
    lastPattern: null,
    lastWallAt: -99,
    intro: ['aimed'],
    events: [],
    god: false,
  };
}

/** Move the ship by a delta, clamped to the arena. */
export function moveShip(w: World, dx: number, dy: number): void {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  w.ship.x = clampNum(w.ship.x + dx, SHIP_MARGIN, w.W - SHIP_MARGIN);
  w.ship.y = clampNum(w.ship.y + dy, SHIP_MARGIN, w.H - SHIP_MARGIN);
}

export function makeBullet(x: number, y: number, vx: number, vy: number, r: number, kind: BulletKind): Bullet {
  return { x, y, vx, vy, r, kind, bounces: 0, homing: 0, turn: 0, age: 0, grazed: false, wall: 0 };
}

function addBullet(w: World, x: number, y: number, angle: number, speed: number, r: number, kind: BulletKind): Bullet | null {
  if (w.bullets.length >= HARD_BULLET_CAP) return null;
  const b = makeBullet(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, r, kind);
  w.bullets.push(b);
  return b;
}

/**
 * A straight wall of bullets entering from one edge with exactly one opening.
 * axis 'h' = a row spanning the width moving vertically, 'v' = a column spanning the height moving horizontally.
 * `gapW` is the clear distance between the bullet edges on both sides of the opening.
 */
export function makeWall(
  axis: 'h' | 'v',
  W: number,
  H: number,
  gapCenter: number,
  gapW: number,
  speed: number,
  dir: 1 | -1,
  r: number,
  spacing: number = WALL_SPACING,
): Bullet[] {
  const L = axis === 'h' ? W : H;
  const n = Math.max(1, Math.ceil(L / spacing));
  const sp = L / n;
  const lo = gapCenter - gapW / 2 - r;
  const hi = gapCenter + gapW / 2 + r;
  const out: Bullet[] = [];
  const start = -(r + 2);
  for (let i = 0; i <= n; i++) {
    const s = i * sp;
    if (s > lo && s < hi) continue;
    let b: Bullet;
    if (axis === 'h') b = makeBullet(s, dir > 0 ? start : H - start, 0, dir * speed, r, 'pat');
    else b = makeBullet(dir > 0 ? start : W - start, s, dir * speed, 0, r, 'pat');
    b.wall = axis === 'h' ? 1 : 2;
    out.push(b);
  }
  return out;
}

/**
 * Intervals along a line of bullets (given their centres, all radius r) where the ship's core can sit without touching
 * any of them, limited to [lo, hi].
 */
export function safeIntervals(centres: number[], r: number, lo: number, hi: number, coreR: number = CORE_R): [number, number][] {
  const c = centres.slice().sort((a, b) => a - b);
  const reach = r + coreR;
  const out: [number, number][] = [];
  let cursor = lo;
  for (const x of c) {
    const a = x - reach;
    if (a > cursor) out.push([cursor, Math.min(a, hi)]);
    cursor = Math.max(cursor, x + reach);
    if (cursor >= hi) break;
  }
  if (cursor < hi) out.push([cursor, hi]);
  return out.filter(([a, b]) => b - a > 1e-9 && a < hi && b > lo);
}

/** A bullet is gone once it is clearly outside the arena. */
export function isOutside(b: Pick<Bullet, 'x' | 'y' | 'r'>, W: number, H: number, margin: number = CULL_MARGIN): boolean {
  const m = b.r + margin;
  return b.x < -m || b.x > W + m || b.y < -m || b.y > H + m;
}

// ── Spawner ──────────────────────────────────────────────────────────────

interface Origin {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

function edgePoint(w: World, edge: number, u: number): Origin {
  const { W, H } = w;
  switch (edge) {
    case 1:
      return { x: 0, y: 40 + u * (H - 80), nx: 1, ny: 0 };
    case 2:
      return { x: W, y: 40 + u * (H - 80), nx: -1, ny: 0 };
    case 3:
      return { x: 30 + u * (W - 60), y: H, nx: 0, ny: -1 };
    default:
      return { x: 30 + u * (W - 60), y: 0, nx: 0, ny: 1 };
  }
}

/** Random point on an edge (top only in phase 1, sides from 2, bottom from 4), away from the ship. */
export function edgeOrigin(w: World, minDist: number = MIN_EDGE_DIST, allowBottom = true): Origin {
  const edges = w.phase >= 4 && allowBottom ? 4 : w.phase >= 2 ? 3 : 1;
  let best: Origin | null = null;
  let bestD = -1;
  for (let i = 0; i < 16; i++) {
    const o = edgePoint(w, Math.floor(w.rand() * edges), w.rand());
    const d = dist(o.x, o.y, w.ship.x, w.ship.y);
    if (d >= minDist) return o;
    if (d > bestD) {
      bestD = d;
      best = o;
    }
  }
  return best as Origin;
}

/** Random interior point (preferably the upper part of the arena), away from the ship. */
export function pointOrigin(w: World, minDist: number = MIN_POINT_DIST): Origin {
  const { W, H } = w;
  let best: Origin | null = null;
  let bestD = -1;
  for (let i = 0; i < 24; i++) {
    const full = i >= 12;
    const x = 40 + w.rand() * (W - 80);
    const y = 50 + w.rand() * ((full ? H - 40 : H * 0.6) - 50);
    const d = dist(x, y, w.ship.x, w.ship.y);
    const o = { x, y, nx: 0, ny: 1 };
    if (d >= minDist) return o;
    if (d > bestD) {
      bestD = d;
      best = o;
    }
  }
  return best as Origin;
}

function baseEmitter(type: PatternType, o: Origin, delay: number): Emitter {
  return {
    type,
    x: o.x,
    y: o.y,
    nx: o.nx,
    ny: o.ny,
    t: 0,
    delay,
    total: 1,
    emitted: 0,
    interval: 0.1,
    next: 0,
    speed: 100,
    r: 5,
    count: 1,
    angle: 0,
    spin: 0,
    spread: 0,
    gaps: [],
    gapW: 0,
    dir: 1,
    done: false,
    sniper: false,
  };
}

function wallBullets(w: World): { h: number; v: number } {
  let h = 0;
  let v = 0;
  for (const b of w.bullets) {
    if (b.wall === 1) h++;
    else if (b.wall === 2) v++;
  }
  return { h, v };
}

/** Whether a pattern may start right now (prevents combinations that could have no way through). */
export function canSpawn(w: World, type: PatternType, pp: PhaseParams = phaseParams(w.phase, w.cfg)): boolean {
  switch (type) {
    case 'wallH':
    case 'wallV': {
      if (w.emitters.some((e) => !e.done && (e.type === 'wallH' || e.type === 'wallV'))) return false;
      if (w.time - w.lastWallAt < 2.5) return false;
      const wb = wallBullets(w);
      // Never cross a horizontal and a vertical wall: their gaps could be in incompatible quadrants.
      return type === 'wallH' ? wb.v === 0 : wb.h === 0;
    }
    case 'spiral':
      return !w.emitters.some((e) => !e.done && e.type === 'spiral');
    case 'homing': {
      const orbs = w.bullets.filter((b) => b.kind === 'orb').length + w.emitters.filter((e) => !e.done && e.type === 'homing').length;
      return orbs < pp.maxOrbs;
    }
    default:
      return true;
  }
}

function pickWeighted<T extends { weight: number }>(items: T[], rand: () => number): T {
  let total = 0;
  for (const i of items) total += i.weight;
  let x = rand() * total;
  for (const i of items) {
    x -= i.weight;
    if (x <= 0) return i;
  }
  return items[items.length - 1];
}

export function choosePattern(w: World, pp: PhaseParams = phaseParams(w.phase, w.cfg)): PatternType | null {
  const avail = patternPool(w.phase, w.cfg).filter((p) => canSpawn(w, p.type, pp));
  if (!avail.length) return null;
  for (let i = 0; i < w.intro.length; i++) {
    const want = w.intro[i];
    if (avail.some((a) => a.type === want)) {
      w.intro.splice(i, 1);
      return want;
    }
  }
  const pool = avail.length > 1 ? avail.filter((a) => a.type !== w.lastPattern) : avail;
  return pickWeighted(pool, w.rand).type;
}

function wallGapRange(L: number, gapW: number): [number, number] {
  const lo = SHIP_MARGIN + gapW / 2 + 4;
  const hi = L - SHIP_MARGIN - gapW / 2 - 4;
  return lo <= hi ? [lo, hi] : [L / 2, L / 2];
}

/** Create the emitter for a pattern with parameters scaled by the current phase. */
export function createEmitter(w: World, type: PatternType, pp: PhaseParams = phaseParams(w.phase, w.cfg)): Emitter {
  const rand = w.rand;
  switch (type) {
    case 'aimed': {
      const e = baseEmitter(type, edgeOrigin(w), 0.45);
      e.total = pp.aimedShots;
      e.interval = 0.13;
      e.speed = 175 * pp.speed;
      e.r = 4.5;
      return e;
    }
    case 'fan': {
      const e = baseEmitter(type, edgeOrigin(w), 0.5);
      e.total = pp.fanVolleys;
      e.interval = 0.38;
      e.count = pp.fanCount;
      e.spread = 0.2;
      e.speed = 150 * pp.speed;
      e.r = 4.5;
      return e;
    }
    case 'radial': {
      const e = baseEmitter(type, pointOrigin(w), 0.7);
      e.total = pp.doubleRing ? 2 : 1;
      e.interval = 0.28;
      e.count = pp.ring;
      e.angle = rand() * Math.PI * 2;
      e.speed = 118 * pp.speed;
      e.r = 5;
      return e;
    }
    case 'spiral': {
      const e = baseEmitter(type, pointOrigin(w, MIN_POINT_DIST + 10), 0.75);
      e.speed = 100 * pp.speed;
      // Bullets on one arm are at least 22 units apart, so the arm can always be slipped through.
      e.interval = Math.max(0.15, 22 / e.speed);
      e.total = Math.max(8, Math.round(3 / e.interval));
      e.count = pp.arms;
      e.spin = (rand() < 0.5 ? -1 : 1) * pp.spin;
      e.angle = rand() * Math.PI * 2;
      e.r = 4.5;
      return e;
    }
    case 'wallH':
    case 'wallV': {
      const axis = type === 'wallH' ? 'h' : 'v';
      const L = axis === 'h' ? w.W : w.H;
      const shipPos = axis === 'h' ? w.ship.x : w.ship.y;
      let dir: 1 | -1 = 1;
      let o: Origin;
      if (axis === 'h') {
        o = { x: w.W / 2, y: 0, nx: 0, ny: 1 };
      } else {
        // Come from the side farther from the ship so there is time to line up with the gap.
        dir = w.ship.x < w.W / 2 ? -1 : 1;
        o = dir > 0 ? { x: 0, y: w.H / 2, nx: 1, ny: 0 } : { x: w.W, y: w.H / 2, nx: -1, ny: 0 };
      }
      const e = baseEmitter(type, o, 0.7);
      e.dir = dir;
      e.gapW = pp.wallGap;
      e.speed = (axis === 'h' ? 92 : 82) * pp.speed;
      e.r = 5;
      const [lo, hi] = wallGapRange(L, e.gapW);
      // First gap within reach of the ship's current lane.
      const reach = axis === 'h' ? 220 : 260;
      const a = Math.max(lo, shipPos - reach);
      const b = Math.min(hi, shipPos + reach);
      const g1 = a <= b ? a + rand() * (b - a) : lo + rand() * (hi - lo);
      e.gaps = [g1];
      if (pp.doubleWall) {
        const shift = (60 + rand() * 80) * (rand() < 0.5 ? -1 : 1);
        let g2 = clampNum(g1 + shift, lo, hi);
        if (Math.abs(g2 - g1) < 40) g2 = clampNum(g1 - shift, lo, hi);
        e.gaps.push(g2);
      }
      e.total = e.gaps.length;
      e.interval = 1;
      return e;
    }
    case 'bounce': {
      const e = baseEmitter(type, edgeOrigin(w), 0.5);
      e.total = pp.bounceCount;
      e.interval = 0.07;
      e.speed = 150 * pp.speed;
      e.r = 5;
      e.angle = Math.atan2(e.ny, e.nx);
      e.spread = 1.1;
      return e;
    }
    case 'homing': {
      const e = baseEmitter(type, edgeOrigin(w, 150, false), 0.8);
      e.total = 1;
      e.speed = 70 * pp.speed;
      e.r = 8;
      return e;
    }
  }
}

function spawnPattern(w: World, type: PatternType, pp: PhaseParams): Emitter {
  const e = createEmitter(w, type, pp);
  w.emitters.push(e);
  w.lastPattern = type;
  if (type === 'wallH' || type === 'wallV') w.lastWallAt = w.time;
  return e;
}

function spawnSniper(w: World, pp: PhaseParams): void {
  const e = baseEmitter('aimed', edgeOrigin(w), 0.35);
  e.total = 1;
  e.speed = 190 * pp.speed;
  e.r = 4;
  e.sniper = true;
  w.emitters.push(e);
}

/** Emit the k-th volley of an emitter. */
export function emitVolley(w: World, e: Emitter, k: number): void {
  const aim = Math.atan2(w.ship.y - e.y, w.ship.x - e.x);
  switch (e.type) {
    case 'aimed':
      addBullet(w, e.x, e.y, aim, e.speed, e.r, 'aim');
      break;
    case 'fan':
      for (let i = 0; i < e.count; i++) addBullet(w, e.x, e.y, aim + (i - (e.count - 1) / 2) * e.spread, e.speed, e.r, 'aim');
      break;
    case 'radial': {
      const stepA = (Math.PI * 2) / e.count;
      const base = e.angle + (k % 2) * (stepA / 2);
      const sp = e.speed * (k > 0 ? 0.85 : 1);
      for (let i = 0; i < e.count; i++) addBullet(w, e.x, e.y, base + i * stepA, sp, e.r, 'pat');
      break;
    }
    case 'spiral': {
      const a0 = e.angle + e.spin * k * e.interval;
      for (let i = 0; i < e.count; i++) addBullet(w, e.x, e.y, a0 + (i * Math.PI * 2) / e.count, e.speed, e.r, 'pat');
      break;
    }
    case 'wallH':
    case 'wallV': {
      const gap = e.gaps[Math.min(k, e.gaps.length - 1)];
      const wall = makeWall(e.type === 'wallH' ? 'h' : 'v', w.W, w.H, gap, e.gapW, e.speed, e.dir, e.r);
      for (const b of wall) if (w.bullets.length < HARD_BULLET_CAP) w.bullets.push(b);
      break;
    }
    case 'bounce': {
      const b = addBullet(w, e.x, e.y, e.angle + (w.rand() * 2 - 1) * e.spread, e.speed, e.r, 'pat');
      if (b) b.bounces = 1;
      break;
    }
    case 'homing': {
      const b = addBullet(w, e.x, e.y, aim, e.speed, e.r, 'orb');
      if (b) {
        b.homing = 5.5;
        b.turn = 1.4;
      }
      break;
    }
  }
  if (k === 0 && !e.sniper) w.events.push({ type: 'emit', pattern: e.type, x: e.x, y: e.y });
}

function updateEmitters(w: World, sdt: number): void {
  for (const e of w.emitters) {
    if (e.done) continue;
    e.t += sdt;
    if (e.t < e.delay) continue;
    const local = e.t - e.delay;
    while (!e.done && local >= e.next) {
      emitVolley(w, e, e.emitted);
      e.emitted++;
      e.next += e.interval;
      if (e.emitted >= e.total) e.done = true;
    }
  }
  let n = 0;
  for (const e of w.emitters) if (!e.done) w.emitters[n++] = e;
  w.emitters.length = n;
}

function runSpawner(w: World, pp: PhaseParams, sdt: number): void {
  w.spawnCd -= sdt;
  if (w.spawnCd <= 0) {
    let active = 0;
    for (const e of w.emitters) if (!e.sniper) active++;
    if (active < pp.maxActive && w.bullets.length < pp.bulletCap) {
      const type = choosePattern(w, pp);
      if (type) {
        spawnPattern(w, type, pp);
        w.spawnCd = pp.interval * (0.85 + 0.3 * w.rand());
      } else {
        w.spawnCd = 0.2;
      }
    }
  }
  if (Number.isFinite(pp.sniperInterval)) {
    w.sniperCd -= sdt;
    if (w.sniperCd <= 0) {
      spawnSniper(w, pp);
      w.sniperCd = pp.sniperInterval * (0.8 + 0.4 * w.rand());
    }
  }
}

// ── Bullets ──────────────────────────────────────────────────────────────

/** Move, steer, bounce and cull bullets by `sdt` seconds of bullet time. */
export function advanceBullets(w: World, sdt: number): void {
  const { W, H } = w;
  const arr = w.bullets;
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i];
    b.age += sdt;
    if (b.homing > 0) {
      const sp = Math.hypot(b.vx, b.vy);
      const cur = Math.atan2(b.vy, b.vx);
      const want = Math.atan2(w.ship.y - b.y, w.ship.x - b.x);
      const maxTurn = b.turn * sdt;
      const a = cur + clampNum(wrapAngle(want - cur), -maxTurn, maxTurn);
      b.vx = Math.cos(a) * sp;
      b.vy = Math.sin(a) * sp;
      b.homing = Math.max(0, b.homing - sdt);
    }
    b.x += b.vx * sdt;
    b.y += b.vy * sdt;
    if (b.bounces > 0) {
      let bounced = false;
      if (b.x < b.r && b.vx < 0) {
        b.x = 2 * b.r - b.x;
        b.vx = -b.vx;
        bounced = true;
      } else if (b.x > W - b.r && b.vx > 0) {
        b.x = 2 * (W - b.r) - b.x;
        b.vx = -b.vx;
        bounced = true;
      }
      if (b.y < b.r && b.vy < 0) {
        b.y = 2 * b.r - b.y;
        b.vy = -b.vy;
        bounced = true;
      } else if (b.y > H - b.r && b.vy > 0) {
        b.y = 2 * (H - b.r) - b.y;
        b.vy = -b.vy;
        bounced = true;
      }
      if (bounced) b.bounces--;
    }
    if (b.age > MAX_BULLET_AGE || isOutside(b, W, H)) continue;
    arr[n++] = b;
  }
  arr.length = n;
}

// ── Power-ups ────────────────────────────────────────────────────────────

export function applyPowerUp(w: World, kind: PowerKind): void {
  if (kind === 'shield') w.shield = true;
  else w.slowLeft = SLOW_DURATION;
  w.pickups++;
}

export function spawnPowerUp(w: World): PowerUp {
  const kind: PowerKind = w.shield ? 'slow' : w.rand() < 0.55 ? 'shield' : 'slow';
  const { W, H } = w;
  let x = W / 2;
  let y = H / 2;
  for (let i = 0; i < 24; i++) {
    const cx = 40 + w.rand() * (W - 80);
    const cy = 80 + w.rand() * (H - 140);
    const d = dist(cx, cy, w.ship.x, w.ship.y);
    x = cx;
    y = cy;
    if (d >= 100 && d <= 280) break;
  }
  const a = w.rand() * Math.PI * 2;
  const p: PowerUp = { kind, x, y, vx: Math.cos(a) * 14, vy: Math.sin(a) * 14, age: 0, life: POWERUP_LIFE };
  w.powerups.push(p);
  w.events.push({ type: 'powerSpawn', kind, x, y });
  return p;
}

function updatePowerUps(w: World, dt: number): void {
  if (w.powerups.length === 0) {
    w.powerCd -= dt;
    if (w.powerCd <= 0) {
      spawnPowerUp(w);
      w.powerCd = 13 + w.rand() * 6;
    }
  }
  const { W, H } = w;
  let n = 0;
  for (const p of w.powerups) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if ((p.x < 30 && p.vx < 0) || (p.x > W - 30 && p.vx > 0)) p.vx = -p.vx;
    if ((p.y < 70 && p.vy < 0) || (p.y > H - 40 && p.vy > 0)) p.vy = -p.vy;
    if (w.alive && dist(p.x, p.y, w.ship.x, w.ship.y) < PICKUP_R) {
      applyPowerUp(w, p.kind);
      w.events.push({ type: 'pickup', kind: p.kind, x: p.x, y: p.y });
      continue;
    }
    if (p.age >= p.life) {
      w.events.push({ type: 'powerExpire', x: p.x, y: p.y });
      continue;
    }
    w.powerups[n++] = p;
  }
  w.powerups.length = n;
}

// ── Collisions ───────────────────────────────────────────────────────────

/** Remove bullets around the ship (after a shield break or a lost life) so the player can recover. */
export function clearAround(w: World, radius: number = CLEAR_RADIUS): number {
  const { x, y } = w.ship;
  const points: { x: number; y: number; kind: BulletKind }[] = [];
  let n = 0;
  for (const b of w.bullets) {
    if (dist(b.x, b.y, x, y) < radius) {
      points.push({ x: b.x, y: b.y, kind: b.kind });
      continue;
    }
    w.bullets[n++] = b;
  }
  w.bullets.length = n;
  if (points.length) w.events.push({ type: 'clear', points });
  return points.length;
}

function onHit(w: World): void {
  const { x, y } = w.ship;
  w.hits++;
  if (w.god) {
    w.invuln = 0.5;
    return;
  }
  if (w.shield) {
    w.shield = false;
    w.invuln = SHIELD_INVULN;
    clearAround(w);
    w.events.push({ type: 'shieldBreak', x, y });
    return;
  }
  w.lives--;
  if (w.lives > 0) {
    w.invuln = w.cfg.hitInvuln;
    clearAround(w);
    w.events.push({ type: 'hit', x, y, lives: w.lives });
    return;
  }
  w.lives = 0;
  w.alive = false;
  w.events.push({ type: 'death', x, y });
}

function collide(w: World): void {
  if (!w.alive) return;
  const sx = w.ship.x;
  const sy = w.ship.y;
  const vulnerable = w.invuln <= 0;
  for (const b of w.bullets) {
    const dx = b.x - sx;
    const dy = b.y - sy;
    const d2 = dx * dx + dy * dy;
    const hr = b.r + CORE_R;
    if (d2 < hr * hr) {
      if (vulnerable) {
        onHit(w);
        return;
      }
      continue;
    }
    if (vulnerable && !b.grazed) {
      const gr = hr + GRAZE_R;
      if (d2 < gr * gr) {
        b.grazed = true;
        w.grazes++;
        w.events.push({ type: 'graze', x: b.x, y: b.y });
      }
    }
  }
}

// ── Main step ────────────────────────────────────────────────────────────

/** Advance the world by dt real seconds (use small steps, e.g. 1/120 s). */
export function step(w: World, dt: number): void {
  if (!w.alive || !(dt > 0)) return;
  w.time += dt;
  const ph = phaseAt(w.time);
  if (ph > w.phase) {
    for (let p = w.phase + 1; p <= ph; p++) {
      w.events.push({ type: 'phase', phase: p });
      w.intro.push(...unlockedAt(p, w.cfg));
    }
    w.phase = ph;
  }
  if (w.invuln > 0) w.invuln = Math.max(0, w.invuln - dt);
  if (w.slowLeft > 0) {
    w.slowLeft -= dt;
    if (w.slowLeft <= 0) {
      w.slowLeft = 0;
      w.events.push({ type: 'slowEnd' });
    }
  }
  const target = w.slowLeft > 0 ? SLOW_SCALE : 1;
  w.timeScale += (target - w.timeScale) * Math.min(1, dt * 7);
  if (Math.abs(target - w.timeScale) < 0.003) w.timeScale = target;
  const sdt = dt * w.timeScale;
  const pp = phaseParams(w.phase, w.cfg);
  runSpawner(w, pp, sdt);
  updateEmitters(w, sdt);
  advanceBullets(w, sdt);
  updatePowerUps(w, dt);
  collide(w);
}

/** Round a survival time for storage / display (hundredths). */
export function roundTime(t: number): number {
  return Math.round(Math.max(0, t) * 100) / 100;
}
