/**
 * Pool Clear — pure, deterministic physics and rules. No DOM access so everything here is unit-testable.
 *
 * Units: the playing surface (inside the cushions) is W × H = 100 × 200 "table units", portrait
 * (the rack sits at the top, the cue ball starts at the bottom). Ball radius R = 3.4.
 * The cue ball is always `balls[0]`. Time is in seconds.
 */

export const W = 100;
export const H = 200;
export const R = 3.4;
export const D = R * 2;

/** Visible border widths outside the playing surface (renderer + layout). */
export const CUSHION = 2.6;
export const RAIL = 7.5;
export const EDGE = CUSHION + RAIL;

/** Spots. */
export const FOOT_Y = H * 0.25; // rack apex
export const HEAD_Y = H * 0.75; // cue ball start

/** Pocket geometry. Cushion segments stop CORNER_GAP from each corner and SIDE_GAP around the side pockets;
 * the segment ends act as rounded "jaws" so balls rattle instead of clipping through. */
export const CORNER_GAP = 7.8;
export const SIDE_GAP = 6.6;
/** A ball whose centre has gone this far past a wall line (only possible through a pocket gap) is captured. */
export const CAPTURE_DEPTH = 2;

export interface Pocket {
  x: number;
  y: number;
  r: number;
  corner: boolean;
}

export const POCKETS: readonly Pocket[] = [
  { x: 0, y: 0, r: 6.8, corner: true },
  { x: W, y: 0, r: 6.8, corner: true },
  { x: -3.2, y: H / 2, r: 6.0, corner: false },
  { x: W + 3.2, y: H / 2, r: 6.0, corner: false },
  { x: 0, y: H, r: 6.8, corner: true },
  { x: W, y: H, r: 6.8, corner: true },
];

export interface Cushion {
  /** 'x': a vertical wall at x = pos spanning y ∈ [from, to]; 'y': horizontal wall at y = pos spanning x. */
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
  /** Direction of the playing surface relative to the wall (+1 or -1 along the other axis). */
  inward: 1 | -1;
}

export const CUSHIONS: readonly Cushion[] = [
  { axis: 'x', pos: 0, from: CORNER_GAP, to: H / 2 - SIDE_GAP, inward: 1 },
  { axis: 'x', pos: 0, from: H / 2 + SIDE_GAP, to: H - CORNER_GAP, inward: 1 },
  { axis: 'x', pos: W, from: CORNER_GAP, to: H / 2 - SIDE_GAP, inward: -1 },
  { axis: 'x', pos: W, from: H / 2 + SIDE_GAP, to: H - CORNER_GAP, inward: -1 },
  { axis: 'y', pos: 0, from: CORNER_GAP, to: W - CORNER_GAP, inward: 1 },
  { axis: 'y', pos: H, from: CORNER_GAP, to: W - CORNER_GAP, inward: -1 },
];

export const JAWS: readonly { x: number; y: number }[] = CUSHIONS.flatMap((c) =>
  c.axis === 'x'
    ? [
        { x: c.pos, y: c.from },
        { x: c.pos, y: c.to },
      ]
    : [
        { x: c.from, y: c.pos },
        { x: c.to, y: c.pos },
      ],
);

/** Physics constants. */
export const BALL_E = 0.95; // ball–ball restitution
export const CUSHION_E = 0.8; // cushion restitution (normal component)
export const CUSHION_TANGENT = 0.96; // tangential velocity kept on a cushion hit
export const JAW_E = 0.6;
export const FRICTION_CONST = 17; // units/s²
export const FRICTION_LIN = 0.24; // 1/s
export const FRICTION_QUAD = 0.001; // 1/unit
export const STOP_SPEED = 1.5;
export const V_MIN = 22;
export const V_MAX = 330;
export const STEP = 1 / 360;
export const MAX_SHOT_TIME = 20;

export interface Ball {
  /** 0 = cue ball, 1..15 = object ball number. */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pocketed: boolean;
}

export type PhysEvent =
  | { type: 'hit'; a: number; b: number; speed: number; x: number; y: number }
  | { type: 'cushion'; id: number; speed: number; x: number; y: number }
  | { type: 'pocket'; id: number; pocket: number; x: number; y: number }
  | { type: 'settle'; scratch: boolean; pocketed: number[]; done: boolean };

export type Mode = '6' | '9' | '15';
export type Phase = 'aim' | 'moving' | 'inhand' | 'done';

export interface ModeConfig {
  count: number;
  rows: number[];
  par: number;
  guide: boolean;
}

export const MODES: Record<Mode, ModeConfig> = {
  '6': { count: 6, rows: [1, 2, 3], par: 7, guide: true },
  '9': { count: 9, rows: [1, 2, 3, 2, 1], par: 11, guide: true },
  '15': { count: 15, rows: [1, 2, 3, 4, 5], par: 19, guide: false },
};

export const MODE_LIST: Mode[] = ['6', '9', '15'];

export function isMode(v: unknown): v is Mode {
  return v === '6' || v === '9' || v === '15';
}

export interface GameState {
  mode: Mode;
  balls: Ball[];
  shots: number;
  scratches: number;
  phase: Phase;
  /** Physics accumulator (seconds). */
  acc: number;
  /** Seconds since the current shot started. */
  elapsed: number;
  pocketedThisShot: number[];
  /** Object balls pocketed so far, in order. */
  pocketedOrder: number[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function isStripe(id: number): boolean {
  return id >= 9;
}

/** Rack spacing: a tight rack (tiny gap, no jitter by default) scatters best on the break; callers may pass
 * a looser gap / jitter for experiments. Jitter must stay below RACK_GAP / (2·√2) so balls never overlap. */
export const RACK_GAP = 0.06;
export const RACK_JITTER = 0;

/** Rack positions (object balls only) for a mode: apex at the foot spot, rows stacked toward the top. */
export function rackPositions(mode: Mode, gap = D + RACK_GAP): { x: number; y: number }[] {
  const rows = MODES[mode].rows;
  const rowGap = (gap * Math.sqrt(3)) / 2;
  const out: { x: number; y: number }[] = [];
  rows.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
      out.push({ x: W / 2 + (i - (n - 1) / 2) * gap, y: FOOT_Y - r * rowGap });
    }
  });
  return out;
}

/** Ball numbers in rack order. Deterministic given `rand`. */
export function rackNumbers(mode: Mode, rand: () => number = Math.random): number[] {
  const count = MODES[mode].count;
  const nums = new Array<number>(count).fill(0);
  nums[0] = 1;
  if (mode === '15') {
    nums[4] = 8; // centre of the third row
    const solids = shuffle([2, 3, 4, 5, 6, 7], rand);
    const stripes = shuffle([9, 10, 11, 12, 13, 14, 15], rand);
    // Back corners: one solid, one stripe (random sides).
    const s = solids.pop() as number;
    const st = stripes.pop() as number;
    if (rand() < 0.5) {
      nums[10] = s;
      nums[14] = st;
    } else {
      nums[10] = st;
      nums[14] = s;
    }
    const rest = shuffle([...solids, ...stripes], rand);
    for (let i = 0; i < count; i++) if (nums[i] === 0) nums[i] = rest.pop() as number;
  } else if (mode === '9') {
    nums[4] = 9; // centre of the diamond
    const rest = shuffle([2, 3, 4, 5, 6, 7, 8], rand);
    for (let i = 0; i < count; i++) if (nums[i] === 0) nums[i] = rest.pop() as number;
  } else {
    const rest = shuffle([2, 3, 4, 5, 6], rand);
    for (let i = 0; i < count; i++) if (nums[i] === 0) nums[i] = rest.pop() as number;
  }
  return nums;
}

/** Full ball set: cue ball first, then the rack. */
export function rackBalls(mode: Mode, rand: () => number = Math.random, opts: { gap?: number; jitter?: number } = {}): Ball[] {
  const gap = D + (opts.gap ?? RACK_GAP);
  const jitter = opts.jitter ?? RACK_JITTER;
  const pos = rackPositions(mode, gap);
  const nums = rackNumbers(mode, rand);
  const balls: Ball[] = [{ id: 0, x: W / 2, y: HEAD_Y, vx: 0, vy: 0, pocketed: false }];
  pos.forEach((p, i) =>
    balls.push({
      id: nums[i],
      x: p.x + (rand() * 2 - 1) * jitter,
      y: p.y + (rand() * 2 - 1) * jitter,
      vx: 0,
      vy: 0,
      pocketed: false,
    }),
  );
  return balls;
}

export function newGame(mode: Mode, rand: () => number = Math.random): GameState {
  return {
    mode,
    balls: rackBalls(mode, rand),
    shots: 0,
    scratches: 0,
    phase: 'aim',
    acc: 0,
    elapsed: 0,
    pocketedThisShot: [],
    pocketedOrder: [],
  };
}

export function ballsLeft(balls: Ball[]): number {
  let n = 0;
  for (let i = 1; i < balls.length; i++) if (!balls[i].pocketed) n++;
  return n;
}

export function isAtRest(balls: Ball[]): boolean {
  for (const b of balls) if (!b.pocketed && (b.vx !== 0 || b.vy !== 0)) return false;
  return true;
}

export function speedForPower(power: number): number {
  const p = power < 0 ? 0 : power > 1 ? 1 : power;
  return V_MIN + p * (V_MAX - V_MIN);
}

// ── Physics ───────────────────────────────────────────────────────────────

/** Advance all balls by one fixed step `dt`, appending collision / pocket events. */
export function stepPhysics(balls: Ball[], dt: number, events?: PhysEvent[]): void {
  // 1. Friction + integration.
  for (const b of balls) {
    if (b.pocketed) continue;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp === 0) continue;
    const dec = (FRICTION_CONST + FRICTION_LIN * sp + FRICTION_QUAD * sp * sp) * dt;
    const ns = sp - dec;
    if (ns <= STOP_SPEED) {
      b.vx = 0;
      b.vy = 0;
      continue;
    }
    const k = ns / sp;
    b.vx *= k;
    b.vy *= k;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  // 2. Ball–ball collisions (equal masses: swap normal components, restitution BALL_E) + overlap separation.
  const n = balls.length;
  for (let i = 0; i < n; i++) {
    const a = balls[i];
    if (a.pocketed) continue;
    for (let j = i + 1; j < n; j++) {
      const b = balls[j];
      if (b.pocketed) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= D * D) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) {
        dx = 1;
        dy = 0;
        d = 1;
      }
      const nx = dx / d;
      const ny = dy / d;
      // Separate (half each).
      const push = (D - Math.min(d, D)) / 2 + 1e-4;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      // Approach speed along the normal (positive when closing in).
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel <= 0) continue;
      const imp = ((1 + BALL_E) / 2) * rel;
      a.vx -= imp * nx;
      a.vy -= imp * ny;
      b.vx += imp * nx;
      b.vy += imp * ny;
      events?.push({ type: 'hit', a: a.id, b: b.id, speed: rel, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }

  // 3. Cushions, jaws, pockets.
  for (const b of balls) {
    if (b.pocketed) continue;
    for (const c of CUSHIONS) {
      if (c.axis === 'x') {
        if (b.y < c.from || b.y > c.to) continue;
        const pen = (b.x - c.pos) * c.inward;
        if (pen >= R) continue;
        b.x = c.pos + c.inward * R;
        const vn = b.vx * c.inward;
        if (vn < 0) {
          b.vx = -vn * CUSHION_E * c.inward;
          b.vy *= CUSHION_TANGENT;
          events?.push({ type: 'cushion', id: b.id, speed: -vn, x: b.x, y: b.y });
        }
      } else {
        if (b.x < c.from || b.x > c.to) continue;
        const pen = (b.y - c.pos) * c.inward;
        if (pen >= R) continue;
        b.y = c.pos + c.inward * R;
        const vn = b.vy * c.inward;
        if (vn < 0) {
          b.vy = -vn * CUSHION_E * c.inward;
          b.vx *= CUSHION_TANGENT;
          events?.push({ type: 'cushion', id: b.id, speed: -vn, x: b.x, y: b.y });
        }
      }
    }
    for (const j of JAWS) {
      const dx = b.x - j.x;
      const dy = b.y - j.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      b.x = j.x + nx * R;
      b.y = j.y + ny * R;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + JAW_E) * vn * nx;
        b.vy -= (1 + JAW_E) * vn * ny;
        events?.push({ type: 'cushion', id: b.id, speed: -vn, x: b.x, y: b.y });
      }
    }
    const p = pocketAt(b.x, b.y);
    if (p >= 0) {
      b.pocketed = true;
      b.vx = 0;
      b.vy = 0;
      events?.push({ type: 'pocket', id: b.id, pocket: p, x: b.x, y: b.y });
    }
  }
}

/** Index of the pocket that captures a ball centred at (x, y), or -1. */
export function pocketAt(x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < POCKETS.length; i++) {
    const p = POCKETS[i];
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
    if (d < p.r) return i;
  }
  if (x < -CAPTURE_DEPTH || x > W + CAPTURE_DEPTH || y < -CAPTURE_DEPTH || y > H + CAPTURE_DEPTH) return best;
  return -1;
}

/** True when the centre is on the playing surface (allowing the cushion contact line). */
export function insideTable(x: number, y: number): boolean {
  return x >= R - 1e-6 && x <= W - R + 1e-6 && y >= R - 1e-6 && y <= H - R + 1e-6;
}

/** Run the simulation until everything stops (or maxTime). Returns the elapsed time. */
export function settle(balls: Ball[], maxTime = MAX_SHOT_TIME, events?: PhysEvent[]): number {
  let t = 0;
  while (!isAtRest(balls) && t < maxTime) {
    stepPhysics(balls, STEP, events);
    t += STEP;
  }
  return t;
}

// ── Rules ─────────────────────────────────────────────────────────────────

/** Strike the cue ball. Returns false when a shot is not allowed right now. */
export function shoot(s: GameState, angle: number, power: number): boolean {
  if (s.phase !== 'aim') return false;
  const cue = s.balls[0];
  const v = speedForPower(power);
  cue.vx = Math.cos(angle) * v;
  cue.vy = Math.sin(angle) * v;
  s.shots += 1;
  s.phase = 'moving';
  s.acc = 0;
  s.elapsed = 0;
  s.pocketedThisShot = [];
  return true;
}

/** Advance the game by a frame of `dt` seconds (fixed-step internally). Returns the physics events. */
export function stepGame(s: GameState, dt: number): PhysEvent[] {
  const events: PhysEvent[] = [];
  if (s.phase !== 'moving') return events;
  s.acc += Math.max(0, dt);
  let steps = 0;
  while (s.acc >= STEP && steps < 48) {
    stepPhysics(s.balls, STEP, events);
    s.acc -= STEP;
    s.elapsed += STEP;
    steps++;
  }
  if (s.elapsed > MAX_SHOT_TIME) {
    for (const b of s.balls) {
      b.vx = 0;
      b.vy = 0;
    }
  }
  for (const e of events) {
    if (e.type === 'pocket') {
      s.pocketedThisShot.push(e.id);
      if (e.id !== 0) s.pocketedOrder.push(e.id);
    }
  }
  if (isAtRest(s.balls)) events.push(resolveShot(s));
  return events;
}

/** Apply the end-of-shot rules once every ball is at rest. */
export function resolveShot(s: GameState): PhysEvent {
  const cue = s.balls[0];
  const scratch = cue.pocketed;
  if (scratch) {
    s.shots += 1; // penalty
    s.scratches += 1;
    cue.pocketed = false;
    cue.vx = 0;
    cue.vy = 0;
    const spot = findFreeSpot(s.balls, W / 2, HEAD_Y, 0);
    cue.x = spot.x;
    cue.y = spot.y;
    s.phase = 'inhand';
  } else {
    s.phase = 'aim';
  }
  const done = ballsLeft(s.balls) === 0;
  if (done) s.phase = 'done';
  return { type: 'settle', scratch, pocketed: s.pocketedThisShot.slice(), done };
}

/** Ball in hand: put the cue ball at (or near) the requested point. */
export function placeCueBall(s: GameState, x: number, y: number): boolean {
  if (s.phase !== 'inhand') return false;
  const spot = findFreeSpot(s.balls, x, y, 0);
  s.balls[0].x = spot.x;
  s.balls[0].y = spot.y;
  s.balls[0].vx = 0;
  s.balls[0].vy = 0;
  s.phase = 'aim';
  return true;
}

function clampToTable(x: number, y: number): { x: number; y: number } {
  const m = R + 0.2;
  return { x: Math.min(W - m, Math.max(m, x)), y: Math.min(H - m, Math.max(m, y)) };
}

/** Is a ball centred here clear of every other ball (except `ignoreId`) and of the pockets? */
export function isFreeSpot(balls: Ball[], x: number, y: number, ignoreId = 0): boolean {
  const c = clampToTable(x, y);
  if (Math.abs(c.x - x) > 1e-9 || Math.abs(c.y - y) > 1e-9) return false;
  for (const p of POCKETS) if (Math.hypot(x - p.x, y - p.y) < p.r + R * 0.6) return false;
  for (const b of balls) {
    if (b.pocketed || b.id === ignoreId) continue;
    if (Math.hypot(x - b.x, y - b.y) < D + 0.2) return false;
  }
  return true;
}

/** Nearest legal spot to (x, y): the point itself when free, otherwise a spiral search outward. */
export function findFreeSpot(balls: Ball[], x: number, y: number, ignoreId = 0): { x: number; y: number } {
  const c = clampToTable(x, y);
  if (isFreeSpot(balls, c.x, c.y, ignoreId)) return c;
  for (let ring = 1; ring <= 40; ring++) {
    const rad = ring * R;
    const n = 8 + ring * 4;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const q = clampToTable(c.x + Math.cos(a) * rad, c.y + Math.sin(a) * rad);
      if (isFreeSpot(balls, q.x, q.y, ignoreId)) return q;
    }
  }
  return { x: W / 2, y: HEAD_Y }; // unreachable in practice: the table is far larger than 16 balls
}

// ── Aiming ────────────────────────────────────────────────────────────────

export interface AimGuide {
  /** Ghost-ball centre (or the cushion / pocket contact point of the cue ball). */
  hit: { x: number; y: number };
  /** Index into balls of the first object ball hit, or -1. */
  target: number;
  /** Unit direction the object ball will take. */
  objectDir: { x: number; y: number } | null;
  /** Unit direction of the cue ball after impact (null for a dead-centre hit). */
  cueDir: { x: number; y: number } | null;
  /** cos of the cut angle: 1 = full ball, 0 = razor thin. */
  cut: number;
  /** Distance travelled by the cue ball before the hit. */
  dist: number;
}

export function predictShot(balls: Ball[], angle: number): AimGuide {
  const c = balls[0];
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let bestT = Infinity;
  let target = -1;
  for (let i = 1; i < balls.length; i++) {
    const b = balls[i];
    if (b.pocketed) continue;
    const rx = b.x - c.x;
    const ry = b.y - c.y;
    const proj = rx * dx + ry * dy;
    if (proj <= 0) continue;
    const perp2 = rx * rx + ry * ry - proj * proj;
    if (perp2 >= D * D) continue;
    const t = proj - Math.sqrt(D * D - perp2);
    if (t < bestT) {
      bestT = Math.max(0, t);
      target = i;
    }
  }
  // Cushion lines.
  let wallT = Infinity;
  let wallAxis: 'x' | 'y' = 'x';
  const tryWall = (t: number, axis: 'x' | 'y') => {
    if (t > 0 && t < wallT) {
      wallT = t;
      wallAxis = axis;
    }
  };
  if (dx < 0) tryWall((R - c.x) / dx, 'x');
  if (dx > 0) tryWall((W - R - c.x) / dx, 'x');
  if (dy < 0) tryWall((R - c.y) / dy, 'y');
  if (dy > 0) tryWall((H - R - c.y) / dy, 'y');
  if (wallT < bestT) {
    target = -1;
    bestT = wallT;
    // In a pocket gap? Then extend the line into the pocket.
    const hx = c.x + dx * wallT;
    const hy = c.y + dy * wallT;
    const along = wallAxis === 'x' ? hy : hx;
    const len = wallAxis === 'x' ? H : W;
    const inGap = along < CORNER_GAP || along > len - CORNER_GAP || (wallAxis === 'x' && Math.abs(along - H / 2) < SIDE_GAP);
    if (inGap) bestT += 5;
  }
  if (!Number.isFinite(bestT)) bestT = 60;
  const hit = { x: c.x + dx * bestT, y: c.y + dy * bestT };
  if (target < 0) return { hit, target, objectDir: null, cueDir: null, cut: 0, dist: bestT };
  const b = balls[target];
  let ox = b.x - hit.x;
  let oy = b.y - hit.y;
  const ol = Math.hypot(ox, oy) || 1;
  ox /= ol;
  oy /= ol;
  const cut = Math.max(0, ox * dx + oy * dy);
  let cx = dx - ox * cut;
  let cy = dy - oy * cut;
  const cl = Math.hypot(cx, cy);
  let cueDir: { x: number; y: number } | null = null;
  if (cl > 0.05) {
    cx /= cl;
    cy /= cl;
    cueDir = { x: cx, y: cy };
  }
  return { hit, target, objectDir: { x: ox, y: oy }, cueDir, cut, dist: bestT };
}

/** Angle from the cue ball to the nearest object ball (a sensible default aim). */
export function nearestObjectAngle(balls: Ball[], fallback = -Math.PI / 2): number {
  const c = balls[0];
  let best = Infinity;
  let angle = fallback;
  for (let i = 1; i < balls.length; i++) {
    const b = balls[i];
    if (b.pocketed) continue;
    const d = Math.hypot(b.x - c.x, b.y - c.y);
    if (d < best) {
      best = d;
      angle = Math.atan2(b.y - c.y, b.x - c.x);
    }
  }
  return angle;
}

// ── Aim / power gesture (pure; screen-pixel units) ───────────────────────────
//
// One-finger control, two flavours decided on press:
//  • "grab": the press lands on (or right next to) the cue ball → slingshot. The aim never changes; power is the
//    finger's pull along the line behind the cue ball (−aim). Sideways drift is ignored, so grabbing the ball
//    anywhere and pulling back shoots exactly where the aim line pointed.
//  • "turn": the press lands elsewhere on the table. Every ≥ SAMPLE_PX step of the finger is split into a part
//    around the cue ball (tangential) and a part away from it (radial). Mostly-tangential steps rotate the aim with
//    the finger's angle around the ball (finer the further away) and never charge power; mostly-radial steps
//    charge (outward) or discharge (inward) power and never rotate the aim. Once the charge reaches AIM_LOCK the
//    aim is locked; sliding back toward the start drops the charge and unlocks it again (= cancel).
// A release fires only when the finger really moved (> TAP_MOVE_PX) and the charge is at least FIRE_MIN, which is
// deliberately larger than TAP_MOVE_PX so a long press with a little drift never shoots.

/** Finger pull (CSS px) for full power. */
export const PULL_PX = 150;
/** Movement (px) from the press point beyond which the gesture is a drag, not a tap. */
export const TAP_MOVE_PX = 8;
/** Smallest charge that fires on release (FIRE_MIN · PULL_PX = 12 px > TAP_MOVE_PX). */
export const FIRE_MIN = 0.08;
/** Charge from which the aim is locked in "turn" mode. */
export const AIM_LOCK = FIRE_MIN;
/** Minimum finger radius (px) that counts as a press on the cue ball (a fingertip is ~40 px wide). */
export const GRAB_MIN_PX = 28;
/** Finger steps shorter than this (px) are accumulated before being classified (reduces jitter). */
export const SAMPLE_PX = 2;
/** Closer than this (px) to the cue ball the finger angle is unstable, so rotation is damped. */
export const NEAR_PX = 36;

export interface AimGesture {
  grab: boolean;
  /** Press point. */
  x0: number;
  y0: number;
  /** Last sampled finger point. */
  lx: number;
  ly: number;
  /** "turn" mode: finger distance from the cue ball that counts as zero charge. */
  base: number;
  aim: number;
  /** Charge 0..1 (raw finger pull / PULL_PX). */
  power: number;
  /** Finger has moved more than TAP_MOVE_PX from the press point. */
  moved: boolean;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Radius (px) around the cue-ball centre in which a press grabs the ball, for a given table scale (px/unit). */
export function grabRadiusPx(scale: number): number {
  return Math.max(R * scale * 2, GRAB_MIN_PX);
}

/** Start a gesture: cue ball centre (cx, cy) and press point (px, py) in px, current aim angle. */
export function beginAim(cx: number, cy: number, px: number, py: number, aim: number, grabPx: number): AimGesture {
  const d0 = Math.hypot(px - cx, py - cy);
  return { grab: d0 <= grabPx, x0: px, y0: py, lx: px, ly: py, base: d0, aim, power: 0, moved: false };
}

/** Feed a finger position (px). Mutates `g.aim` / `g.power`. */
export function moveAim(g: AimGesture, cx: number, cy: number, px: number, py: number): void {
  if (!g.moved && Math.hypot(px - g.x0, py - g.y0) > TAP_MOVE_PX) g.moved = true;
  if (g.grab) {
    const pull = -(px - g.x0) * Math.cos(g.aim) - (py - g.y0) * Math.sin(g.aim);
    g.power = clamp01(pull / PULL_PX);
    return;
  }
  const sx = px - g.lx;
  const sy = py - g.ly;
  if (Math.hypot(sx, sy) < SAMPLE_PX) return;
  const rL = Math.hypot(g.lx - cx, g.ly - cy);
  const rP = Math.hypot(px - cx, py - cy);
  // Split the step against the radial direction at its midpoint.
  const mx = (g.lx + px) / 2 - cx;
  const my = (g.ly + py) / 2 - cy;
  const ml = Math.hypot(mx, my) || 1;
  const radial = (sx * mx + sy * my) / ml;
  const tangential = Math.abs(sx * my - sy * mx) / ml;
  if (tangential > Math.abs(radial)) {
    // Sideways: rotate (unless charged) and let the zero-charge distance follow the finger.
    g.base += rP - rL;
    if (g.power < AIM_LOCK) {
      let da = wrapAngle(Math.atan2(py - cy, px - cx) - Math.atan2(g.ly - cy, g.lx - cx));
      if (rP < NEAR_PX) da *= rP / NEAR_PX;
      g.aim = wrapAngle(g.aim + Math.max(-0.6, Math.min(0.6, da)));
    }
  }
  // Coming in closer than the zero-charge distance moves it in, so the pull always starts where the finger is.
  if (rP < g.base) g.base = rP;
  g.power = clamp01((rP - g.base) / PULL_PX);
  g.lx = px;
  g.ly = py;
}

/** True when the gesture is a tap (no real movement within the tap time). */
export function isTap(g: AimGesture, heldMs: number, tapMs = 350): boolean {
  return !g.moved && heldMs < tapMs;
}

/** Shot power (0..1, mapped so FIRE_MIN → softest shot) to fire on release, or null when the release must not shoot. */
export function releasePower(g: AimGesture): number | null {
  if (!g.moved || g.power < FIRE_MIN) return null;
  return clamp01((g.power - FIRE_MIN) / (1 - FIRE_MIN));
}

/** Star rating for a finished game: 3 = under par, 2 = par, 1 = over par. */
export function starsFor(mode: Mode, shots: number): number {
  const par = MODES[mode].par;
  if (shots < par) return 3;
  if (shots <= par + 2) return 2;
  return 1;
}
