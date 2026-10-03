/**
 * Pure physics, terrain generation and rules for Lunar Lander. No DOM access.
 * Units: metres, seconds, radians. World y points UP (the renderer flips it).
 */

// ── Constants ─────────────────────────────────────────────────────────────
/** Fixed physics step. */
export const DT = 1 / 60;
/** Level width in metres. */
export const WORLD_W = 150;
/** Width of the mountain walls that close both sides of the level. */
export const WALL_W = 16;
export const WALL_H = 120;
/** Pads are never placed closer than this to the level edge. */
export const PAD_MARGIN = WALL_W + 6;
export const PAD_GAP = 10;
export const MIN_GROUND = 6;
export const MAX_GROUND = 55;
/** Main engine acceleration (m/s²) at full throttle. */
export const THRUST = 5.5;
/** Maximum angular velocity (rad/s) while a rotate button is held (~86°/s: quick taps give fine trim). */
export const ROT_SPEED = 1.5;
/** How quickly the angular velocity reaches its target (1/s). */
export const ROT_RESPONSE = 14;
export const MAX_VY = 2.5;
export const MAX_VX = 1.5;
export const MAX_TILT_DEG = 10;
export const MAX_TILT = (MAX_TILT_DEG * Math.PI) / 180;
/** Altitude at which every level starts. */
export const START_Y = 115;
/** Seconds the lander hangs still at the start of a level (the "get ready" banner). */
export const READY_TIME = 1.0;
export const CAMPAIGN_LEVELS = 10;
/** Pad widths in metres by multiplier. */
export const PAD_WIDTHS: Record<number, number> = { 1: 22, 2: 14, 3: 9 };
/** Horizontal slack (m) allowed for a foot at the pad edge. */
export const PAD_TOLERANCE = 0.3;
/**
 * Vertical slack (m) between the pad surface and the ground a foot rests on. A foot over a raised rim right next
 * to the pad (higher than this) or touching lower ground beside it is not "on the pad".
 */
export const PAD_LEVEL_TOL = 0.25;
/** Ground steeper than this (rise / run) is a cliff or crater wall rather than rough ground. */
export const CLIFF_SLOPE = 1;
/** The lander is considered "lost" above this altitude. */
export const CEILING = 500;
/** Minimum world height (m) the overview camera keeps in view, so the ground is visible from the start. */
export const VIEW_H_MIN = 140;
/** Exhaust reaches the ground (kicking up dust) within this distance of the nozzle. */
export const EXHAUST_REACH = 14;

/** Lander geometry in local metres (x right, y up, origin at the centre of mass). */
export const FOOT_X = 3.0;
export const FOOT_Y = -2.6;
export const FEET: readonly (readonly [number, number])[] = [
  [-FOOT_X, FOOT_Y],
  [FOOT_X, FOOT_Y],
];
/** Hull outline (ascent stage, descent stage and nozzle), counter-clockwise. */
export const HULL: readonly (readonly [number, number])[] = [
  [-1.0, -2.3],
  [1.0, -2.3],
  [0.6, -1.5],
  [2.0, -1.5],
  [2.0, -0.3],
  [1.4, 0.2],
  [1.5, 1.4],
  [0.8, 2.2],
  [-0.8, 2.2],
  [-1.5, 1.4],
  [-1.4, 0.2],
  [-2.0, -0.3],
  [-2.0, -1.5],
  [-0.6, -1.5],
];

// ── Types ─────────────────────────────────────────────────────────────────
export interface Point {
  x: number;
  y: number;
}

export interface Pad {
  x0: number;
  x1: number;
  y: number;
  mult: number;
}

export interface Terrain {
  /** Surface polyline, strictly increasing x from 0 to WORLD_W. */
  points: Point[];
  pads: Pad[];
  width: number;
}

export interface LevelConfig {
  level: number;
  gravity: number;
  /** Base wind acceleration (m/s², unsigned). 0 before level 6. */
  wind: number;
  /** Pad multipliers to place (1 = wide, 2 = medium, 3 = narrow). */
  pads: number[];
  /** Initial midpoint-displacement amplitude (m). */
  roughness: number;
  /** Fuel budget relative to the optimal vertical burn (higher = easier). */
  fuelMargin: number;
  /** Initial horizontal speed magnitude (m/s). */
  startVx: number;
}

export interface Lander {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Tilt in radians. Positive = top leans to the right (thrust pushes right). */
  angle: number;
  angVel: number;
  /** 0–100. */
  fuel: number;
  thrusting: boolean;
}

export interface Input {
  thrust: boolean;
  /** -1 (rotate left / counter-clockwise) … 1 (rotate right / clockwise). */
  rot: number;
}

export type CrashReason = 'terrain' | 'cliff' | 'offPad' | 'vspeed' | 'hspeed' | 'tilt' | 'hull' | 'lost';

export type Contact =
  | { kind: 'none' }
  | { kind: 'landed'; pad: Pad }
  | { kind: 'crashed'; reasons: CrashReason[] };

export interface LandingCheck {
  ok: boolean;
  pad: Pad | null;
  reasons: CrashReason[];
}

export interface Score {
  padPts: number;
  fuelPts: number;
  total: number;
}

export type Outcome =
  | { kind: 'landed'; pad: Pad; score: Score }
  | { kind: 'crashed'; reasons: CrashReason[]; outOfFuel: boolean };

export type Phase = 'ready' | 'flying' | 'landed' | 'crashed';

export interface Level {
  level: number;
  seed: number;
  cfg: LevelConfig;
  terrain: Terrain;
  lander: Lander;
  phase: Phase;
  /** Seconds since the level was created (including the ready phase). */
  time: number;
  windDir: number;
  windPhase: number;
  /** Fuel percentage consumed per second of burn. */
  fuelRate: number;
  outcome: Outcome | null;
}

// ── Utilities ─────────────────────────────────────────────────────────────
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wrap an angle to [-π, π]. */
export function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ── Level configuration ───────────────────────────────────────────────────
const PAD_LAYOUTS: number[][] = [
  [1, 2, 3], // 1
  [1, 2, 3], // 2
  [1, 2, 3], // 3
  [2, 3], // 4
  [1, 3], // 5
  [2, 3], // 6 (wind starts)
  [1, 3], // 7
  [2, 3], // 8
  [3, 3], // 9
  [3, 3], // 10
];

export function padsFor(level: number): number[] {
  const n = Math.max(1, Math.floor(level));
  if (n <= CAMPAIGN_LEVELS) return PAD_LAYOUTS[n - 1].slice();
  return n % 2 === 0 ? [2, 3] : [3, 3];
}

/** Deterministic difficulty curve: campaign levels 1–10, then endless escalation with caps. */
export function levelConfig(level: number): LevelConfig {
  const n = Math.max(1, Math.floor(level));
  const c = Math.min(n, CAMPAIGN_LEVELS);
  const extra = Math.max(0, n - CAMPAIGN_LEVELS);
  const gravity = Math.min(3.4, 1.6 + ((c - 1) * 1.4) / 9 + extra * 0.05);
  const wind = n >= 6 ? Math.min(0.55, 0.18 + (n - 6) * 0.06) : 0;
  const roughness = Math.min(26, 9 + (c - 1) * 1.6 + extra * 0.5);
  const fuelMargin = Math.max(1.4, 2.8 - ((c - 1) * 1.2) / 9 - extra * 0.02);
  const startVx = Math.min(8, 3 + (c - 1) * 0.5 + extra * 0.1);
  return { level: n, gravity, wind, pads: padsFor(n), roughness, fuelMargin, startVx };
}

/** Burn time of the fuel-optimal "free fall then full burn" descent from rest at height h. */
export function optimalBurnTime(gravity: number, h: number): number {
  const a = THRUST - gravity;
  const v = Math.sqrt((2 * gravity * h * a) / THRUST);
  return v / a;
}

/** Fuel percentage burnt per second, derived so the level is always solvable with a margin. */
export function fuelRateFor(cfg: LevelConfig, dropHeight: number): number {
  const tOpt = optimalBurnTime(cfg.gravity, Math.max(10, dropHeight));
  const tH = (cfg.startVx / (THRUST * Math.sin((25 * Math.PI) / 180))) * 1.3;
  const tW = cfg.wind > 0 ? 1.5 : 0;
  const budget = (tOpt + tH + tW + 1) * cfg.fuelMargin;
  return 100 / budget;
}

// ── Terrain ───────────────────────────────────────────────────────────────
const SEGMENTS = 64;

function wallHeight(x: number): number {
  const d = Math.min(x, WORLD_W - x);
  if (d >= WALL_W) return 0;
  const t = 1 - d / WALL_W;
  return WALL_H * t * t;
}

function interp(points: Point[], x: number): number {
  // points sorted by x; binary search the segment
  let lo = 0;
  let hi = points.length - 1;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[hi].x) return points[hi].y;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
  return a.y + (b.y - a.y) * t;
}

/** Surface height at x; Infinity outside the level (solid rock). */
export function heightAt(terrain: Terrain, x: number): number {
  if (x < 0 || x > terrain.width) return Infinity;
  return interp(terrain.points, x);
}

function fits(pads: Pad[], x0: number, w: number): boolean {
  return pads.every((p) => x0 + w + PAD_GAP <= p.x0 || x0 >= p.x1 + PAD_GAP);
}

/** Seeded midpoint-displacement terrain with flat landing pads spliced in. */
export function generateTerrain(cfg: LevelConfig, rand: () => number): Terrain {
  const n = SEGMENTS;
  const h = new Array<number>(n + 1).fill(0);
  h[0] = 20 + rand() * 20;
  h[n] = 20 + rand() * 20;
  let amp = cfg.roughness;
  for (let step = n; step > 1; step >>= 1) {
    const half = step >> 1;
    for (let i = half; i < n; i += step) {
      h[i] = (h[i - half] + h[i + half]) / 2 + (rand() * 2 - 1) * amp;
    }
    amp *= 0.55;
  }
  const dx = WORLD_W / n;
  const base: Point[] = h.map((v, i) => {
    const x = i * dx;
    return { x, y: clamp(v, MIN_GROUND, MAX_GROUND) + wallHeight(x) };
  });

  // Place pads (random attempts, then a deterministic scan so every requested pad exists).
  const pads: Pad[] = [];
  for (const mult of cfg.pads) {
    const w = PAD_WIDTHS[mult] ?? PAD_WIDTHS[2];
    let x0 = -1;
    for (let attempt = 0; attempt < 80 && x0 < 0; attempt++) {
      const cand = PAD_MARGIN + rand() * (WORLD_W - 2 * PAD_MARGIN - w);
      if (fits(pads, cand, w)) x0 = cand;
    }
    if (x0 < 0) {
      for (let cand = PAD_MARGIN; cand + w <= WORLD_W - PAD_MARGIN; cand += 0.5) {
        if (fits(pads, cand, w)) {
          x0 = cand;
          break;
        }
      }
    }
    if (x0 < 0) continue; // cannot happen with the shipped layouts; keeps the generator total
    const x1 = x0 + w;
    const y = clamp((interp(base, x0) + interp(base, (x0 + x1) / 2) + interp(base, x1)) / 3, 8, 50);
    pads.push({ x0, x1, y, mult });
  }
  pads.sort((a, b) => a.x0 - b.x0);

  // Splice the flat segments into the polyline.
  let pts: Point[] = base.slice();
  const padVerts = new Set<Point>();
  for (const p of pads) {
    pts = pts.filter((q) => q.x < p.x0 - 1e-6 || q.x > p.x1 + 1e-6);
    const a = { x: p.x0, y: p.y };
    const b = { x: p.x1, y: p.y };
    padVerts.add(a);
    padVerts.add(b);
    pts.push(a, b);
  }
  pts.sort((a, b) => a.x - b.x);
  // Soften cliffs right next to a pad so approaches stay fair.
  for (const p of pads) {
    for (const q of pts) {
      if (padVerts.has(q)) continue;
      const d = q.x < p.x0 ? p.x0 - q.x : q.x > p.x1 ? q.x - p.x1 : 0;
      if (d > 0 && d < 5.5) q.y = clamp(q.y, p.y - 7, p.y + 7);
    }
  }
  return { points: pts, pads, width: WORLD_W };
}

// ── Lander physics ────────────────────────────────────────────────────────
export function createLander(x: number, y: number, vx: number): Lander {
  return { x, y, vx, vy: 0, angle: 0, angVel: 0, fuel: 100, thrusting: false };
}

/** Local lander point → world. */
export function toWorld(l: Lander, p: readonly [number, number]): Point {
  const c = Math.cos(l.angle);
  const s = Math.sin(l.angle);
  return { x: l.x + p[0] * c + p[1] * s, y: l.y - p[0] * s + p[1] * c };
}

/** One fixed physics step: rotation, thrust, wind, gravity, fuel. Mutates `l`. */
export function stepLander(l: Lander, input: Input, gravity: number, wind: number, fuelRate: number, dt = DT): void {
  const target = clamp(input.rot, -1, 1) * ROT_SPEED;
  const k = 1 - Math.exp(-ROT_RESPONSE * dt);
  l.angVel += (target - l.angVel) * k;
  l.angle += l.angVel * dt;
  const burning = input.thrust && l.fuel > 0;
  l.thrusting = burning;
  let ax = wind;
  let ay = -gravity;
  if (burning) {
    ax += THRUST * Math.sin(l.angle);
    ay += THRUST * Math.cos(l.angle);
    l.fuel = Math.max(0, l.fuel - fuelRate * dt);
  }
  l.vx += ax * dt;
  l.vy += ay * dt;
  l.x += l.vx * dt;
  l.y += l.vy * dt;
}

/** Feet height above the ground directly below the lander (≥ 0). */
export function altitudeAbove(l: Lander, terrain: Terrain): number {
  const g = heightAt(terrain, l.x);
  if (!Number.isFinite(g)) return 0;
  return Math.max(0, l.y + FOOT_Y - g);
}

function footOverPad(f: Point, p: Pad): boolean {
  return f.x >= p.x0 - PAD_TOLERANCE && f.x <= p.x1 + PAD_TOLERANCE;
}

/**
 * A foot counts as on the pad when it is over the pad (with a little edge slack), the ground beneath it is not
 * raised above the pad surface (a rim right next to the pad edge) and, if it is resting on the ground, that
 * ground is level with the pad (not lower ground just past the edge).
 */
export function footOnPad(f: Point, p: Pad, terrain: Terrain): boolean {
  if (!footOverPad(f, p)) return false;
  const ground = heightAt(terrain, f.x);
  if (ground > p.y + PAD_LEVEL_TOL) return false;
  const resting = f.y <= ground + 1e-6;
  return !resting || ground >= p.y - PAD_LEVEL_TOL;
}

/** Local steepness (rise / run) of the terrain around x. */
export function slopeAt(terrain: Terrain, x: number, h = 0.25): number {
  const x0 = Math.max(0, x - h);
  const x1 = Math.min(terrain.width, x + h);
  if (x1 <= x0) return 0;
  return Math.abs(heightAt(terrain, x1) - heightAt(terrain, x0)) / (x1 - x0);
}

/** Judge a touchdown: both feet on one pad, gentle, level. */
export function evaluateLanding(l: Lander, terrain: Terrain, feet: Point[] = FEET.map((p) => toWorld(l, p))): LandingCheck {
  const pad = terrain.pads.find((p) => feet.every((f) => footOnPad(f, p, terrain))) ?? null;
  const reasons: CrashReason[] = [];
  if (!pad) {
    const partly = terrain.pads.some((p) => feet.some((f) => footOverPad(f, p)));
    if (partly) reasons.push('offPad');
    else {
      // The foot that met the ground (or the lowest one) decides between a steep wall and rough ground.
      const ground = feet.filter((f) => f.y <= heightAt(terrain, f.x) + 1e-6);
      const hit = ground.length ? ground : [feet.reduce((a, b) => (b.y < a.y ? b : a))];
      reasons.push(hit.some((f) => slopeAt(terrain, f.x) > CLIFF_SLOPE) ? 'cliff' : 'terrain');
    }
  }
  if (Math.abs(l.vy) > MAX_VY) reasons.push('vspeed');
  if (Math.abs(l.vx) > MAX_VX) reasons.push('hspeed');
  if (Math.abs(normalizeAngle(l.angle)) > MAX_TILT) reasons.push('tilt');
  return { ok: reasons.length === 0, pad, reasons };
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
  const d2 = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
  const d3 = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y);
  const d4 = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** True when the hull polygon touches or penetrates the terrain. */
export function hullHits(l: Lander, terrain: Terrain): boolean {
  const pts = HULL.map((p) => toWorld(l, p));
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of pts) {
    if (p.y <= heightAt(terrain, p.x)) return true;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  const tp = terrain.points;
  for (const v of tp) {
    if (v.x >= minX && v.x <= maxX && pointInPolygon(v, pts)) return true;
  }
  for (let i = 0; i < tp.length - 1; i++) {
    const a = tp[i];
    const b = tp[i + 1];
    if (b.x < minX || a.x > maxX) continue;
    for (let j = 0; j < pts.length; j++) {
      if (segmentsIntersect(a, b, pts[j], pts[(j + 1) % pts.length])) return true;
    }
  }
  return false;
}

/** Collision test for the current lander pose. */
export function checkContact(l: Lander, terrain: Terrain): Contact {
  if (l.x < 0 || l.x > terrain.width || l.y > CEILING) return { kind: 'crashed', reasons: ['lost'] };
  const feet = FEET.map((p) => toWorld(l, p));
  const touching = feet.some((f) => f.y <= heightAt(terrain, f.x));
  if (touching) {
    const check = evaluateLanding(l, terrain, feet);
    if (check.ok && check.pad) return { kind: 'landed', pad: check.pad };
    return { kind: 'crashed', reasons: check.reasons };
  }
  if (hullHits(l, terrain)) return { kind: 'crashed', reasons: ['hull'] };
  return { kind: 'none' };
}

/** Rest the lander squarely on the pad after a successful touchdown. */
export function settle(l: Lander, pad: Pad): void {
  l.angle = 0;
  l.angVel = 0;
  l.vx = 0;
  l.vy = 0;
  l.y = pad.y - FOOT_Y;
  l.thrusting = false;
}

export function levelScore(mult: number, fuel: number): Score {
  const padPts = 100 * mult;
  const fuelPts = Math.round(clamp(fuel, 0, 100)) * 2;
  return { padPts, fuelPts, total: padPts + fuelPts };
}

// ── Level lifecycle ───────────────────────────────────────────────────────
export function createLevel(level: number, seed: number): Level {
  const cfg = levelConfig(level);
  const rand = rng(seed);
  const terrain = generateTerrain(cfg, rand);
  const dir = level <= 2 ? 1 : rand() < 0.5 ? -1 : 1;
  const x = dir > 0 ? WORLD_W * (0.2 + rand() * 0.25) : WORLD_W * (0.55 + rand() * 0.25);
  const windDir = rand() < 0.5 ? -1 : 1;
  const windPhase = rand() * Math.PI * 2;
  const lowestPad = terrain.pads.reduce((m, p) => Math.min(m, p.y), Infinity);
  const fuelRate = fuelRateFor(cfg, START_Y - (Number.isFinite(lowestPad) ? lowestPad : 20));
  return {
    level: cfg.level,
    seed,
    cfg,
    terrain,
    lander: createLander(x, START_Y, cfg.startVx * dir),
    phase: 'ready',
    time: 0,
    windDir,
    windPhase,
    fuelRate,
    outcome: null,
  };
}

/** Signed wind acceleration right now (slowly varying gusts). */
export function currentWind(lv: Level): number {
  if (lv.cfg.wind <= 0) return 0;
  return lv.windDir * lv.cfg.wind * (0.75 + 0.25 * Math.sin(lv.time * 0.5 + lv.windPhase));
}

/** Advance the level by one fixed step. Returns the outcome kind when the flight ends. */
export function stepLevel(lv: Level, input: Input, dt = DT): 'landed' | 'crashed' | null {
  if (lv.phase === 'ready') {
    lv.time += dt;
    if (lv.time >= READY_TIME) lv.phase = 'flying';
    return null;
  }
  if (lv.phase !== 'flying') return null;
  lv.time += dt;
  const l = lv.lander;
  stepLander(l, input, lv.cfg.gravity, currentWind(lv), lv.fuelRate, dt);
  const c = checkContact(l, lv.terrain);
  if (c.kind === 'none') return null;
  if (c.kind === 'landed') {
    lv.phase = 'landed';
    settle(l, c.pad);
    lv.outcome = { kind: 'landed', pad: c.pad, score: levelScore(c.pad.mult, l.fuel) };
    return 'landed';
  }
  lv.phase = 'crashed';
  l.thrusting = false;
  lv.outcome = { kind: 'crashed', reasons: c.reasons, outOfFuel: l.fuel <= 0 };
  return 'crashed';
}

// ── Campaign run (persisted progress) ─────────────────────────────────────
export interface Run {
  /** Next level to fly. */
  level: number;
  /** Campaign score banked so far. */
  score: number;
  /** Seed of this campaign's terrain. */
  seed: number;
}

/** Validate a stored campaign run; anything malformed becomes null. */
export function sanitizeRun(raw: unknown): Run | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const { level, score, seed } = r;
  if (typeof level !== 'number' || typeof score !== 'number' || typeof seed !== 'number') return null;
  if (!Number.isFinite(level) || !Number.isFinite(score) || !Number.isFinite(seed)) return null;
  return { level: Math.max(1, Math.floor(level)), score: Math.max(0, Math.round(score)), seed: seed >>> 0 };
}

// ── Exhaust ───────────────────────────────────────────────────────────────
/** Where the exhaust plume meets the ground (marching along the thrust axis), or null if out of reach. */
export function exhaustGroundHit(l: Lander, terrain: Terrain, reach = EXHAUST_REACH): { x: number; y: number; d: number } | null {
  const n = toWorld(l, [0, -2.3]);
  const dx = -Math.sin(l.angle);
  const dy = -Math.cos(l.angle);
  for (let d = 0; d <= reach; d += 0.5) {
    const x = n.x + dx * d;
    const y = n.y + dy * d;
    if (x < 0 || x > terrain.width) return null;
    if (y <= heightAt(terrain, x)) return { x, y: heightAt(terrain, x), d };
  }
  return null;
}

// ── Camera helper ─────────────────────────────────────────────────────────
/**
 * Camera centre height (m) for a view `viewH` metres tall: the lowest visible ground sits near the bottom
 * (22 % margin), the lander stays at least 20 % below the top edge, and nothing far below y = -6 is shown.
 */
export function cameraTargetY(landerY: number, groundLow: number, viewH: number): number {
  const groundAnchored = groundLow - viewH * 0.22 + viewH / 2;
  const followLander = landerY + viewH * 0.2 - viewH / 2;
  return Math.max(groundAnchored, followLander, -6 + viewH / 2);
}

/** Overview zoom (px per metre): the whole level width and the descent column both fit the view. */
export function overviewZoom(w: number, h: number): number {
  return Math.max(0.5, Math.min(w / WORLD_W, h / VIEW_H_MIN));
}

/** Target zoom (px per metre): wide overview high up, close-up near the ground. */
export function zoomFor(altitude: number, near: number, far: number, lo = 18, hi = 75): number {
  const t = smoothstep((altitude - lo) / (hi - lo));
  return near + (far - near) * t;
}
