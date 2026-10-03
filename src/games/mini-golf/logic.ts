/**
 * Pure game logic for Mini Golf: hole definitions (normalised 10×16 space, y grows downwards),
 * fixed-step ball physics (circle vs segment / circle collisions, zones, cup capture), scoring and
 * validation helpers. No DOM access so everything is unit-testable.
 */

export interface Vec {
  x: number;
  y: number;
}
export interface Seg {
  a: Vec;
  b: Vec;
}
export interface Circle {
  x: number;
  y: number;
  r: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Block that slides sinusoidally around its base centre (cx, cy) with amplitude (dx, dy). */
export interface Mover {
  cx: number;
  cy: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
  period: number;
  phase: number;
}
export interface Booster extends Rect {
  /** Unit direction of the push. */
  dir: Vec;
  /** Acceleration multiplier (default 1 = PHYS.boostAccel). */
  power?: number;
}
export interface Hole {
  par: number;
  start: Vec;
  cup: Vec;
  /** Playable area border (polygon, any orientation). */
  outline: Vec[];
  /** Solid obstacles (polygons). */
  blocks: Vec[][];
  bumpers: Circle[];
  sand: Rect[];
  water: Rect[];
  movers: Mover[];
  boosters: Booster[];
}

export const FIELD_W = 10;
export const FIELD_H = 16;
export const BALL_R = 0.2;
export const CUP_R = 0.36;
export const HOLE_COUNT = 18;

/** Physics / rules that vary by difficulty. */
export interface DiffConfig {
  /** Aim guide style. */
  guide: 'bounce' | 'line' | 'short';
  /** Ball speed above which it skips over the cup (at the rim; centre hits allow ~1.6×). */
  captureSpeed: number;
  maxStrokes: number;
  /** Friction multiplier inside sand. */
  sandMult: number;
}

export type Difficulty = 'casual' | 'standard' | 'pro';
export const DIFFICULTIES: Difficulty[] = ['casual', 'standard', 'pro'];
export const DIFF: Record<Difficulty, DiffConfig> = {
  casual: { guide: 'bounce', captureSpeed: 5.6, maxStrokes: 8, sandMult: 3 },
  standard: { guide: 'line', captureSpeed: 4.2, maxStrokes: 8, sandMult: 4 },
  pro: { guide: 'short', captureSpeed: 3.3, maxStrokes: 8, sandMult: 5 },
};

export const PHYS = {
  maxSpeed: 14,
  /** Exponential drag per second (speed loss per unit of distance). */
  drag: 0.5,
  /** Constant deceleration (units/s²). */
  decel: 1.4,
  restitution: 0.85,
  /** Rail restitution inside a booster: the belt grips the ball, so it settles against a rail. */
  boostRestitution: 0.35,
  bumperRestitution: 0.92,
  stopSpeed: 0.12,
  boostAccel: 14,
  boostMax: 16,
  /** Default pull distance (units) that maps to full power (the UI passes a screen-based value). */
  maxDrag: 3.6,
  /** Pulls shorter than this cancel the shot. */
  minDrag: 0.6,
  /** Capture threshold multiplier for a dead-centre pass (rim = 1). */
  cupCentreBonus: 0.45,
  /** Speed multiplier when the ball skips over the cup too fast. */
  cupSkip: 0.88,
  /** Extra friction kicks in after this many seconds of rolling (safety net). */
  stuckAfter: 24,
  /** Hard stop after this many seconds of rolling (e.g. a ball pinned by a booster). */
  maxRoll: 32,
  step: 1 / 120,
};

// ── Geometry helpers ──────────────────────────────────────────────────────

export function rect(x: number, y: number, w: number, h: number): Vec[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function poly(...pts: [number, number][]): Vec[] {
  return pts.map(([x, y]) => ({ x, y }));
}

export function polyToSegs(p: Vec[]): Seg[] {
  const segs: Seg[] = [];
  for (let i = 0; i < p.length; i++) segs.push({ a: p[i], b: p[(i + 1) % p.length] });
  return segs;
}

export function pointInPoly(x: number, y: number, p: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i].x;
    const yi = p[i].y;
    const xj = p[j].x;
    const yj = p[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function distToSeg(x: number, y: number, s: Seg): number {
  const abx = s.b.x - s.a.x;
  const aby = s.b.y - s.a.y;
  const len2 = abx * abx + aby * aby || 1e-9;
  let t = ((x - s.a.x) * abx + (y - s.a.y) * aby) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = s.a.x + abx * t;
  const cy = s.a.y + aby * t;
  return Math.hypot(x - cx, y - cy);
}

/** Current rectangle of a mover at time t. */
export function moverRect(m: Mover, t: number): Rect {
  const s = Math.sin((2 * Math.PI * t) / m.period + m.phase);
  return { x: m.cx + m.dx * s - m.w / 2, y: m.cy + m.dy * s - m.h / 2, w: m.w, h: m.h };
}

/** Velocity of a mover at time t. */
export function moverVel(m: Mover, t: number): Vec {
  const w = (2 * Math.PI) / m.period;
  const c = Math.cos(w * t + m.phase) * w;
  return { x: m.dx * c, y: m.dy * c };
}

// ── Hole definitions ──────────────────────────────────────────────────────

const FULL = rect(0, 0, FIELD_W, FIELD_H);

function hole(h: Partial<Hole> & Pick<Hole, 'par' | 'start' | 'cup'>): Hole {
  return {
    outline: FULL,
    blocks: [],
    bumpers: [],
    sand: [],
    water: [],
    movers: [],
    boosters: [],
    ...h,
  };
}

const mover = (cx: number, cy: number, w: number, h: number, dx: number, period: number, phase = 0): Mover => ({ cx, cy, w, h, dx, dy: 0, period, phase });

export const HOLES: Hole[] = [
  // 1 · Tee off — straight, a sand pocket on each side.
  hole({
    par: 2,
    start: { x: 5, y: 13.5 },
    cup: { x: 5, y: 2.6 },
    outline: rect(1.5, 0, 7, 16),
    sand: [
      { x: 1.5, y: 5, w: 1.6, h: 3.2 },
      { x: 6.9, y: 5, w: 1.6, h: 3.2 },
    ],
  }),
  // 2 · Dogleg — L-shaped fairway.
  hole({
    par: 3,
    start: { x: 7.75, y: 13.8 },
    cup: { x: 2, y: 2.5 },
    outline: poly([0, 0], [10, 0], [10, 16], [5.5, 16], [5.5, 5], [0, 5]),
  }),
  // 3 · Bumpers — four bouncy posts guard the line.
  hole({
    par: 3,
    start: { x: 5, y: 14 },
    cup: { x: 5, y: 2.5 },
    outline: rect(1, 0, 8, 16),
    bumpers: [
      { x: 3.4, y: 10, r: 0.5 },
      { x: 6.6, y: 10, r: 0.5 },
      { x: 5, y: 7, r: 0.5 },
      { x: 5, y: 4.4, r: 0.4 },
    ],
  }),
  // 4 · Sand trap — funnel then a wide bunker before the cup.
  hole({
    par: 3,
    start: { x: 5, y: 14 },
    cup: { x: 5, y: 3 },
    outline: rect(0.5, 0, 9, 16),
    blocks: [rect(0.5, 8.5, 2.6, 0.8), rect(6.9, 8.5, 2.6, 0.8)],
    sand: [{ x: 2, y: 4.5, w: 6, h: 2.6 }],
  }),
  // 5 · Water carry — an off-centre bridge.
  hole({
    par: 3,
    start: { x: 3, y: 14 },
    cup: { x: 2.5, y: 2.5 },
    water: [
      { x: 0, y: 6.5, w: 5.8, h: 2.2 },
      { x: 7.6, y: 6.5, w: 2.4, h: 2.2 },
    ],
  }),
  // 6 · Zigzag — three shelves.
  hole({
    par: 4,
    start: { x: 2.5, y: 14.2 },
    cup: { x: 3, y: 1.8 },
    blocks: [rect(0, 11, 7.2, 1), rect(2.8, 7.3, 7.2, 1), rect(0, 3.6, 7.2, 1)],
  }),
  // 7 · Bank shot — chamfered corners and a diagonal.
  hole({
    par: 3,
    start: { x: 7.5, y: 13.5 },
    cup: { x: 2.5, y: 3 },
    outline: poly([2, 0], [8, 0], [10, 2], [10, 14], [8, 16], [2, 16], [0, 14], [0, 2]),
    blocks: [poly([2, 10], [1.5, 9.6], [6.5, 5.6], [7, 6])],
  }),
  // 8 · Crosswind — a full-width conveyor pushes the ball sideways: aim off the line to compensate.
  hole({
    par: 2,
    start: { x: 5, y: 14 },
    cup: { x: 5, y: 2.6 },
    outline: rect(1, 0, 8, 16),
    boosters: [{ x: 1, y: 6.6, w: 8, h: 2.2, dir: { x: 1, y: 0 }, power: 0.45 }],
    sand: [{ x: 1, y: 0, w: 8, h: 1.1 }],
  }),
  // 9 · Moving gate — time the slider.
  hole({
    par: 3,
    start: { x: 5, y: 14 },
    cup: { x: 5, y: 2.5 },
    outline: rect(0.5, 0, 9, 16),
    blocks: [rect(0.5, 8, 2, 0.9), rect(7.5, 8, 2, 0.9)],
    movers: [mover(5, 8.45, 2.4, 0.9, 0.7, 3)],
  }),
  // 10 · Sand island — the cup sits in a bunker flanked by water, a lip guards the front.
  hole({
    par: 3,
    start: { x: 5, y: 14 },
    cup: { x: 5, y: 2.9 },
    blocks: [rect(0, 8, 3.5, 0.8), rect(6.5, 8, 3.5, 0.8), rect(4.3, 4.1, 1.4, 0.4)],
    sand: [{ x: 2.5, y: 0.8, w: 5, h: 4.6 }],
    water: [
      { x: 0, y: 0, w: 2.5, h: 5.4 },
      { x: 7.5, y: 0, w: 2.5, h: 5.4 },
    ],
  }),
  // 11 · Maze — three shelves and a post by the cup.
  hole({
    par: 4,
    start: { x: 2, y: 14.5 },
    cup: { x: 8, y: 2 },
    blocks: [rect(0, 12.2, 6.5, 0.8), rect(0, 8.8, 3.5, 0.8), rect(6.5, 8.8, 3.5, 0.8), rect(3.5, 5.4, 6.5, 0.8)],
    bumpers: [{ x: 5, y: 2.8, r: 0.45 }],
  }),
  // 12 · Pinball — six posts and water on both wings.
  hole({
    par: 4,
    start: { x: 5, y: 14.5 },
    cup: { x: 5, y: 1.8 },
    bumpers: [
      { x: 2.5, y: 5, r: 0.5 },
      { x: 5, y: 4.2, r: 0.5 },
      { x: 7.5, y: 5, r: 0.5 },
      { x: 3.8, y: 7.5, r: 0.45 },
      { x: 6.2, y: 7.5, r: 0.45 },
      { x: 5, y: 10, r: 0.5 },
    ],
    water: [
      { x: 0, y: 2, w: 1.3, h: 6 },
      { x: 8.7, y: 2, w: 1.3, h: 6 },
    ],
  }),
  // 13 · Double dogleg — S-course with sand in the turns.
  hole({
    par: 4,
    start: { x: 1.5, y: 14.5 },
    cup: { x: 8, y: 2.5 },
    blocks: [rect(0, 10, 7, 1.2), rect(3, 6, 7, 1.2)],
    sand: [
      { x: 7, y: 11.2, w: 3, h: 2 },
      { x: 0, y: 4, w: 3, h: 2 },
    ],
    bumpers: [{ x: 5.5, y: 2.5, r: 0.45 }],
  }),
  // 14 · Slingshot — boosters whip the ball round the divider.
  hole({
    par: 3,
    start: { x: 7.5, y: 14 },
    cup: { x: 8, y: 3.9 },
    blocks: [rect(4.6, 3.5, 0.8, 9.5)],
    boosters: [
      { x: 0.5, y: 11.5, w: 2.4, h: 3, dir: { x: 0, y: -1 } },
      { x: 0.5, y: 0.8, w: 2.4, h: 2.4, dir: { x: 1, y: 0 } },
    ],
    water: [{ x: 5.4, y: 5.5, w: 4.6, h: 2 }],
    sand: [{ x: 6, y: 0.6, w: 4, h: 4.4 }],
  }),
  // 15 · Twin gates — two sliders out of phase.
  hole({
    par: 4,
    start: { x: 5, y: 14.5 },
    cup: { x: 5, y: 2 },
    outline: rect(0.5, 0, 9, 16),
    blocks: [rect(0.5, 10.1, 1.5, 0.8), rect(8, 10.1, 1.5, 0.8), rect(0.5, 5.1, 1.5, 0.8), rect(8, 5.1, 1.5, 0.8)],
    movers: [mover(5, 10.5, 3, 0.8, 0.9, 2.6, 0), mover(5, 5.5, 3, 0.8, 0.9, 2.6, Math.PI)],
  }),
  // 16 · Waterways — a bridge, then around the moat.
  hole({
    par: 4,
    start: { x: 5, y: 14.5 },
    cup: { x: 5, y: 1.8 },
    water: [
      { x: 0, y: 9.2, w: 4, h: 1.8 },
      { x: 6, y: 9.2, w: 4, h: 1.8 },
      { x: 2.2, y: 4.2, w: 5.6, h: 1.8 },
    ],
  }),
  // 17 · Alcove — bank off the chamfer to reach the shelf.
  hole({
    par: 3,
    start: { x: 3, y: 14 },
    cup: { x: 1.5, y: 2 },
    outline: poly([0, 0], [8, 0], [10, 2], [10, 16], [0, 16]),
    blocks: [rect(0, 3.6, 7, 0.9)],
    bumpers: [{ x: 5, y: 9, r: 0.5 }],
  }),
  // 18 · Grand finale — everything at once.
  hole({
    par: 5,
    start: { x: 2, y: 14.5 },
    cup: { x: 5, y: 2.2 },
    blocks: [rect(0, 12, 6, 0.8), rect(0, 8, 2.2, 0.8), rect(7.8, 8, 2.2, 0.8)],
    movers: [mover(5, 8.4, 2.4, 0.8, 0.9, 2.8)],
    water: [
      { x: 0, y: 4.5, w: 3.5, h: 1.5 },
      { x: 6.5, y: 4.5, w: 3.5, h: 1.5 },
    ],
    sand: [{ x: 3, y: 0.8, w: 4, h: 3 }],
    bumpers: [
      { x: 2, y: 2.5, r: 0.45 },
      { x: 8, y: 2.5, r: 0.45 },
    ],
  }),
];

export function totalPar(holes: Hole[] = HOLES): number {
  return holes.reduce((s, h) => s + h.par, 0);
}

/** All static wall segments (outline + blocks) of a hole, cached. */
const segCache = new WeakMap<Hole, Seg[]>();
export function wallSegs(h: Hole): Seg[] {
  let s = segCache.get(h);
  if (!s) {
    s = polyToSegs(h.outline);
    for (const b of h.blocks) s = s.concat(polyToSegs(b));
    segCache.set(h, s);
  }
  return s;
}

// ── Simulation ────────────────────────────────────────────────────────────

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimState {
  ball: Ball;
  /** Where the ball last came to rest (water resets here). */
  lastRest: Vec;
  strokes: number;
  moving: boolean;
  sunk: boolean;
  /** Hole clock (drives movers, booster chevrons, water). */
  time: number;
  /** Seconds the ball has been rolling since the last shot. */
  rolling: number;
  /** True while the ball centre is over the cup (one skip-slowdown per pass). */
  overCup: boolean;
  /** Set while the ball is inside a booster (one sound per entry). */
  boosting: boolean;
}

export type PhysEvent =
  | { type: 'wall'; x: number; y: number; speed: number }
  | { type: 'bumper'; index: number; x: number; y: number }
  | { type: 'mover'; x: number; y: number }
  | { type: 'water'; x: number; y: number }
  | { type: 'boost' }
  | { type: 'skip' }
  | { type: 'sunk' }
  | { type: 'stop' }
  | { type: 'rescue' };

export function newSim(h: Hole, at: Vec = h.start, strokes = 0): SimState {
  return {
    ball: { x: at.x, y: at.y, vx: 0, vy: 0 },
    lastRest: { x: at.x, y: at.y },
    strokes,
    moving: false,
    sunk: false,
    time: 0,
    rolling: 0,
    overCup: false,
    boosting: false,
  };
}

export function cloneSim(s: SimState): SimState {
  return { ...s, ball: { ...s.ball }, lastRest: { ...s.lastRest } };
}

export function speedOf(b: Ball): number {
  return Math.hypot(b.vx, b.vy);
}

/** Result of interpreting a slingshot drag. */
export interface Aim {
  valid: boolean;
  /** Unit direction of the shot (ball → away from the pointer). */
  dir: Vec;
  /** 0..1 */
  power: number;
  pull: number;
}

/**
 * Slingshot: the shot goes from the pointer back through the anchor (the ball, or wherever the drag
 * started). Pulls inside `minDrag` cancel; power grows linearly up to `maxDrag`.
 */
export function aimFromDrag(anchor: Vec, pointer: Vec, maxDrag = PHYS.maxDrag, minDrag = PHYS.minDrag): Aim {
  const dx = anchor.x - pointer.x;
  const dy = anchor.y - pointer.y;
  const pull = Math.hypot(dx, dy);
  if (!(pull >= minDrag) || !(maxDrag > minDrag)) return { valid: false, dir: { x: 0, y: -1 }, power: 0, pull };
  const power = Math.max(0.01, Math.min(1, (pull - minDrag) / (maxDrag - minDrag)));
  return { valid: true, dir: { x: dx / pull, y: dy / pull }, power, pull };
}

/** Launch the ball. Returns false when a shot is not allowed right now. */
export function shoot(st: SimState, dir: Vec, power: number): boolean {
  if (st.moving || st.sunk) return false;
  const p = Math.max(0, Math.min(1, power));
  if (p <= 0) return false;
  // Slightly convex curve so light taps are controllable.
  const speed = PHYS.maxSpeed * (0.08 + 0.92 * p * p * (3 - 2 * p));
  const len = Math.hypot(dir.x, dir.y) || 1;
  st.ball.vx = (dir.x / len) * speed;
  st.ball.vy = (dir.y / len) * speed;
  st.moving = true;
  st.rolling = 0;
  st.overCup = false;
  st.strokes++;
  return true;
}

/** Reflect a ball off a segment (two-sided). Returns true when a bounce happened. */
export function collideSeg(b: Ball, s: Seg, r: number, restitution: number, segVel?: Vec): boolean {
  const abx = s.b.x - s.a.x;
  const aby = s.b.y - s.a.y;
  const len2 = abx * abx + aby * aby || 1e-9;
  let t = ((b.x - s.a.x) * abx + (b.y - s.a.y) * aby) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = s.a.x + abx * t;
  const cy = s.a.y + aby * t;
  let nx = b.x - cx;
  let ny = b.y - cy;
  const d = Math.hypot(nx, ny);
  if (d >= r) return false;
  if (d < 1e-6) {
    // Centre exactly on the wall: pick the side the ball came from.
    const len = Math.sqrt(len2);
    nx = -aby / len;
    ny = abx / len;
    if (nx * b.vx + ny * b.vy > 0) {
      nx = -nx;
      ny = -ny;
    }
  } else {
    nx /= d;
    ny /= d;
  }
  b.x += nx * (r - d);
  b.y += ny * (r - d);
  const svx = segVel?.x ?? 0;
  const svy = segVel?.y ?? 0;
  const rvx = b.vx - svx;
  const rvy = b.vy - svy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    b.vx = rvx - (1 + restitution) * vn * nx + svx;
    b.vy = rvy - (1 + restitution) * vn * ny + svy;
    return true;
  }
  return false;
}

/** Reflect a ball off a static circle. */
export function collideCircle(b: Ball, c: Circle, r: number, restitution: number): boolean {
  let nx = b.x - c.x;
  let ny = b.y - c.y;
  const d = Math.hypot(nx, ny);
  const min = r + c.r;
  if (d >= min) return false;
  if (d < 1e-6) {
    nx = 0;
    ny = -1;
  } else {
    nx /= d;
    ny /= d;
  }
  b.x += nx * (min - d);
  b.y += ny * (min - d);
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + restitution) * vn * nx;
    b.vy -= (1 + restitution) * vn * ny;
    return true;
  }
  return false;
}

/**
 * Ball vs (possibly moving) axis-aligned rectangle. Unlike four separate segments this also resolves a
 * centre that ended up inside the rectangle, pushing it out through the nearest face.
 */
export function collideRect(b: Ball, r: Rect, radius: number, restitution: number, vel?: Vec): boolean {
  const qx = b.x < r.x ? r.x : b.x > r.x + r.w ? r.x + r.w : b.x;
  const qy = b.y < r.y ? r.y : b.y > r.y + r.h ? r.y + r.h : b.y;
  let nx = b.x - qx;
  let ny = b.y - qy;
  const d = Math.hypot(nx, ny);
  let pen: number;
  if (d > 1e-9) {
    if (d >= radius) return false;
    nx /= d;
    ny /= d;
    pen = radius - d;
  } else {
    const left = b.x - r.x;
    const right = r.x + r.w - b.x;
    const top = b.y - r.y;
    const bottom = r.y + r.h - b.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) [nx, ny] = [-1, 0];
    else if (m === right) [nx, ny] = [1, 0];
    else if (m === top) [nx, ny] = [0, -1];
    else [nx, ny] = [0, 1];
    pen = m + radius;
  }
  b.x += nx * pen;
  b.y += ny * pen;
  const svx = vel?.x ?? 0;
  const svy = vel?.y ?? 0;
  const rvx = b.vx - svx;
  const rvy = b.vy - svy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    b.vx = rvx - (1 + restitution) * vn * nx + svx;
    b.vy = rvy - (1 + restitution) * vn * ny + svy;
    return true;
  }
  return false;
}

export function inSand(h: Hole, x: number, y: number): boolean {
  return h.sand.some((r) => rectContains(r, x, y));
}

/** Threshold speed below which the cup captures a ball whose centre is `dist` from the cup centre. */
export function captureThreshold(cfg: DiffConfig, dist: number): number {
  const closeness = Math.max(0, 1 - dist / CUP_R);
  return cfg.captureSpeed * (1 + PHYS.cupCentreBonus * closeness);
}

/** Ball is outside the playable area or deep inside a solid (tunnelling guard). Movers are checked when `time` is given. */
export function isBallLost(h: Hole, b: Vec, time?: number): boolean {
  if (!pointInPoly(b.x, b.y, h.outline)) return true;
  for (const blk of h.blocks) if (pointInPoly(b.x, b.y, blk)) return true;
  if (time === undefined) return false;
  for (const m of h.movers) {
    const r = moverRect(m, time);
    const inset = BALL_R * 0.5;
    if (b.x > r.x + inset && b.x < r.x + r.w - inset && b.y > r.y + inset && b.y < r.y + r.h - inset) return true;
  }
  return false;
}

/** Advance the simulation by `dt` seconds (internally fixed-stepped). */
export function stepSim(st: SimState, h: Hole, cfg: DiffConfig, dt: number): PhysEvent[] {
  const events: PhysEvent[] = [];
  let remaining = dt;
  while (remaining > 1e-9) {
    const step = Math.min(PHYS.step, remaining);
    remaining -= step;
    subStep(st, h, cfg, step, events);
  }
  return events;
}

function subStep(st: SimState, h: Hole, cfg: DiffConfig, dt: number, events: PhysEvent[]): void {
  st.time += dt;
  if (st.sunk) return;
  const b = st.ball;
  const segs = wallSegs(h);

  if (!st.moving) {
    // A resting ball can still be shoved by a moving block.
    for (const m of h.movers) {
      const r = moverRect(m, st.time);
      const vel = moverVel(m, st.time);
      if (collideRect(b, r, BALL_R, PHYS.restitution, vel)) {
        // Nudge the ball out of the block's lane so it cannot be shoved back and forth forever.
        const al = Math.hypot(m.dx, m.dy) || 1;
        const px = -m.dy / al;
        const py = m.dx / al;
        const side = (b.x - (r.x + r.w / 2)) * px + (b.y - (r.y + r.h / 2)) * py >= 0 ? 1 : -1;
        b.vx += px * side * 2.5;
        b.vy += py * side * 2.5;
        st.moving = true;
        st.rolling = 0;
        events.push({ type: 'mover', x: b.x, y: b.y });
      }
    }
    if (!st.moving) {
      if (isBallLost(h, b, st.time)) rescue(st, events);
      return;
    }
  }

  // Sub-divide so the ball never moves more than half its radius per integration.
  const speed = speedOf(b);
  const n = Math.max(1, Math.ceil((speed * dt) / (BALL_R * 0.5)));
  const sdt = dt / n;
  for (let i = 0; i < n; i++) {
    integrate(st, h, cfg, sdt, segs, events);
    if (st.sunk || !st.moving) break;
  }
}

function integrate(st: SimState, h: Hole, cfg: DiffConfig, dt: number, segs: Seg[], events: PhysEvent[]): void {
  const b = st.ball;
  st.rolling += dt;

  // Boosters.
  let boosting = false;
  for (const z of h.boosters) {
    if (rectContains(z, b.x, b.y)) {
      boosting = true;
      const acc = PHYS.boostAccel * (z.power ?? 1) * dt;
      b.vx += z.dir.x * acc;
      b.vy += z.dir.y * acc;
      const sp = speedOf(b);
      if (sp > PHYS.boostMax) {
        b.vx *= PHYS.boostMax / sp;
        b.vy *= PHYS.boostMax / sp;
      }
    }
  }
  if (boosting && !st.boosting) events.push({ type: 'boost' });
  st.boosting = boosting;

  // Friction.
  let sp = speedOf(b);
  if (sp > 0) {
    let mult = inSand(h, b.x, b.y) ? cfg.sandMult : 1;
    if (st.rolling > PHYS.stuckAfter) mult *= 4;
    if (boosting) mult *= 0.3;
    const ns = Math.max(0, sp * (1 - PHYS.drag * mult * dt) - PHYS.decel * mult * dt);
    b.vx *= ns / sp;
    b.vy *= ns / sp;
    sp = ns;
  }

  // Move.
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // Collisions (a few relaxation passes for corners).
  let contact = false;
  const rest = boosting ? PHYS.boostRestitution : PHYS.restitution;
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    for (const s of segs) {
      if (collideSeg(b, s, BALL_R, rest)) {
        any = true;
        if (pass === 0) events.push({ type: 'wall', x: b.x, y: b.y, speed: speedOf(b) });
      }
    }
    h.bumpers.forEach((c, index) => {
      if (collideCircle(b, c, BALL_R, PHYS.bumperRestitution)) {
        any = true;
        if (pass === 0) events.push({ type: 'bumper', index, x: b.x, y: b.y });
      }
    });
    for (const m of h.movers) {
      if (collideRect(b, moverRect(m, st.time), BALL_R, rest, moverVel(m, st.time))) {
        any = true;
        if (pass === 0) events.push({ type: 'mover', x: b.x, y: b.y });
      }
    }
    if (!any) break;
    contact = true;
  }

  // Water.
  for (const w of h.water) {
    if (rectContains(w, b.x, b.y)) {
      events.push({ type: 'water', x: b.x, y: b.y });
      b.x = st.lastRest.x;
      b.y = st.lastRest.y;
      b.vx = 0;
      b.vy = 0;
      st.moving = false;
      st.strokes++;
      st.overCup = false;
      st.boosting = false;
      return;
    }
  }

  // Cup.
  const dc = Math.hypot(b.x - h.cup.x, b.y - h.cup.y);
  if (dc < CUP_R) {
    sp = speedOf(b);
    if (sp < captureThreshold(cfg, dc)) {
      st.sunk = true;
      st.moving = false;
      b.vx = 0;
      b.vy = 0;
      events.push({ type: 'sunk' });
      return;
    }
    if (!st.overCup) {
      st.overCup = true;
      b.vx *= PHYS.cupSkip;
      b.vy *= PHYS.cupSkip;
      events.push({ type: 'skip' });
    }
  } else {
    st.overCup = false;
  }

  // Tunnelling guard.
  if (isBallLost(h, b, st.time)) {
    rescue(st, events);
    return;
  }

  // Rest (or the hard safety stop for a ball that somehow never settles).
  // A booster only lets the ball settle when it is pressed against something (e.g. a crosswind
  // pinning it to a rail); otherwise it keeps pushing until the ball leaves it.
  if ((speedOf(b) < PHYS.stopSpeed && (!boosting || contact)) || st.rolling > PHYS.maxRoll) {
    b.vx = 0;
    b.vy = 0;
    st.moving = false;
    st.boosting = false;
    st.lastRest = { x: b.x, y: b.y };
    events.push({ type: 'stop' });
  }
}

function rescue(st: SimState, events: PhysEvent[]): void {
  st.ball.x = st.lastRest.x;
  st.ball.y = st.lastRest.y;
  st.ball.vx = 0;
  st.ball.vy = 0;
  st.moving = false;
  st.boosting = false;
  events.push({ type: 'rescue' });
}

/** Simulate a shot on a copy and return the path (for the aim guide). Stops after the first bounce + a tail. */
export function predictPath(st: SimState, h: Hole, cfg: DiffConfig, dir: Vec, power: number, maxTime = 1.6, tailAfterBounce = 0.35): Vec[] {
  const s = cloneSim(st);
  s.moving = false;
  s.sunk = false;
  if (!shoot(s, dir, power)) return [];
  const pts: Vec[] = [{ x: s.ball.x, y: s.ball.y }];
  let t = 0;
  let bounced = -1;
  while (t < maxTime) {
    const ev = stepSim(s, h, cfg, 1 / 60);
    t += 1 / 60;
    pts.push({ x: s.ball.x, y: s.ball.y });
    if (bounced < 0 && ev.some((e) => e.type === 'wall' || e.type === 'bumper' || e.type === 'mover')) bounced = t;
    if (ev.some((e) => e.type === 'water' || e.type === 'sunk' || e.type === 'stop' || e.type === 'rescue')) break;
    if (bounced >= 0 && t - bounced > tailAfterBounce) break;
  }
  return pts;
}

// ── Scoring ───────────────────────────────────────────────────────────────

export type ScoreTerm = 'holeInOne' | 'albatross' | 'eagle' | 'birdie' | 'parScore' | 'bogey' | 'doubleBogey' | 'tripleBogey' | 'overPar';

export function scoreTerm(strokes: number, par: number): ScoreTerm {
  if (strokes === 1) return 'holeInOne';
  const d = strokes - par;
  if (d <= -3) return 'albatross';
  if (d === -2) return 'eagle';
  if (d === -1) return 'birdie';
  if (d === 0) return 'parScore';
  if (d === 1) return 'bogey';
  if (d === 2) return 'doubleBogey';
  if (d === 3) return 'tripleBogey';
  return 'overPar';
}

/** "E", "+3", "−2". */
export function formatVsPar(diff: number): string {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `−${-diff}`;
}

/** Score for a hole once it ends: sunk strokes, or max+1 when the stroke limit ran out. */
export function holeScore(strokes: number, sunk: boolean, cfg: DiffConfig): number {
  return sunk ? strokes : cfg.maxStrokes + 1;
}

export function sumScores(scores: number[]): number {
  return scores.reduce((a, b) => a + b, 0);
}

/** Total minus par for the holes played so far. */
export function vsPar(scores: number[], holes: Hole[] = HOLES): number {
  let d = 0;
  scores.forEach((s, i) => (d += s - holes[i].par));
  return d;
}

// ── Saved progress ────────────────────────────────────────────────────────

/** Round in progress, persisted between sessions. */
export interface Progress {
  diff: Difficulty;
  /** Index of the hole being played (0-based). */
  hole: number;
  /** Final scores of the holes already finished (length === hole). */
  scores: number[];
  /** Strokes already taken on the current hole. */
  strokes: number;
  /** Where the ball rests on the current hole. */
  ball: Vec;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Guards against corrupted / outdated saves so a bad value can never crash or soft-lock a round. */
export function isValidProgress(p: unknown): p is Progress {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (!DIFFICULTIES.includes(o.diff as Difficulty)) return false;
  const cfg = DIFF[o.diff as Difficulty];
  if (!Number.isInteger(o.hole) || (o.hole as number) < 0 || (o.hole as number) >= HOLES.length) return false;
  if (!Array.isArray(o.scores) || o.scores.length !== o.hole) return false;
  if (!o.scores.every((s) => Number.isInteger(s) && s >= 1 && s <= cfg.maxStrokes + 1)) return false;
  // strokes === maxStrokes is legal: the last putt was in flight when the game was closed.
  if (!Number.isInteger(o.strokes) || (o.strokes as number) < 0 || (o.strokes as number) > cfg.maxStrokes) return false;
  const b = o.ball as Vec | null;
  if (!b || typeof b !== 'object' || !finite(b.x) || !finite(b.y)) return false;
  const h = HOLES[o.hole as number];
  // The saved rest spot must be a legal place for the ball on that hole.
  if (isBallLost(h, b)) return false;
  if (h.water.some((w) => rectContains(w, b.x, b.y))) return false;
  if (wallSegs(h).some((s) => distToSeg(b.x, b.y, s) < BALL_R * 0.9)) return false;
  if (h.bumpers.some((c) => Math.hypot(b.x - c.x, b.y - c.y) < c.r + BALL_R * 0.9)) return false;
  return true;
}

// ── Validation / solvability (tests and sanity checks) ────────────────────

const GRID = 0.2;

export interface FreeGrid {
  cols: number;
  rows: number;
  free: Uint8Array;
  index(x: number, y: number): number;
}

/** Coarse occupancy grid of positions the ball centre may occupy (movers ignored, water blocked). */
export function freeGrid(h: Hole, clearance = BALL_R + 0.02): FreeGrid {
  const cols = Math.round(FIELD_W / GRID) + 1;
  const rows = Math.round(FIELD_H / GRID) + 1;
  const free = new Uint8Array(cols * rows);
  const segs = wallSegs(h);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * GRID;
      const y = r * GRID;
      let ok = pointInPoly(x, y, h.outline);
      if (ok) for (const b of h.blocks) if (pointInPoly(x, y, b)) ok = false;
      if (ok) for (const s of segs) if (distToSeg(x, y, s) < clearance) ok = false;
      if (ok) for (const w of h.water) if (rectContains(w, x, y)) ok = false;
      if (ok) for (const bp of h.bumpers) if (Math.hypot(x - bp.x, y - bp.y) < bp.r + clearance) ok = false;
      free[r * cols + c] = ok ? 1 : 0;
    }
  }
  return {
    cols,
    rows,
    free,
    index(x, y) {
      const c = Math.max(0, Math.min(cols - 1, Math.round(x / GRID)));
      const r = Math.max(0, Math.min(rows - 1, Math.round(y / GRID)));
      return r * cols + c;
    },
  };
}

/** BFS distance (grid steps) from every free cell to the cup; -1 for unreachable. */
export function distanceMap(h: Hole, g: FreeGrid = freeGrid(h)): Int32Array {
  const dist = new Int32Array(g.cols * g.rows).fill(-1);
  const startIdx = g.index(h.cup.x, h.cup.y);
  if (!g.free[startIdx]) return dist;
  const queue = [startIdx];
  dist[startIdx] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    const nb = [
      [c - 1, r],
      [c + 1, r],
      [c, r - 1],
      [c, r + 1],
    ];
    for (const [nc, nr] of nb) {
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const j = nr * g.cols + nc;
      if (!g.free[j] || dist[j] >= 0) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

/** Problems with a hole definition (empty array = valid). */
export function holeIssues(h: Hole): string[] {
  const issues: string[] = [];
  if (!(h.par >= 2 && h.par <= 6)) issues.push('par out of range');
  if (h.outline.length < 3) issues.push('outline needs 3+ points');
  const g = freeGrid(h);
  if (!g.free[g.index(h.start.x, h.start.y)]) issues.push('start not in free space');
  if (!g.free[g.index(h.cup.x, h.cup.y)]) issues.push('cup not in free space');
  for (const s of wallSegs(h)) {
    if (distToSeg(h.cup.x, h.cup.y, s) < CUP_R + BALL_R) issues.push('cup too close to a wall');
    if (distToSeg(h.start.x, h.start.y, s) < BALL_R * 2) issues.push('start too close to a wall');
  }
  for (const w of h.water) {
    if (rectContains(w, h.start.x, h.start.y)) issues.push('start in water');
    if (rectContains(w, h.cup.x, h.cup.y)) issues.push('cup in water');
  }
  if (Math.hypot(h.cup.x - h.start.x, h.cup.y - h.start.y) < 4) issues.push('cup too close to start');
  const inside = (p: Vec) => p.x >= 0 && p.x <= FIELD_W && p.y >= 0 && p.y <= FIELD_H;
  if (!h.outline.every(inside)) issues.push('outline leaves the field');
  if (!h.blocks.every((b) => b.every(inside))) issues.push('block leaves the field');
  for (const m of h.movers) {
    const r = moverRect(m, 0);
    if (r.w < BALL_R * 4 || r.h < BALL_R * 2) issues.push('mover too small');
  }
  const dist = distanceMap(h, g);
  if (dist[g.index(h.start.x, h.start.y)] < 0) issues.push('cup unreachable from start (BFS)');
  return issues;
}

/**
 * Greedy multi-stroke sanity solver: from the current position try a fan of shots, keep the one
 * that ends closest to the cup (by BFS distance), repeat. Returns strokes used or null.
 */
export function greedySolve(h: Hole, cfg: DiffConfig, maxStrokes = cfg.maxStrokes, angles = 24, powers: number[] = [0.3, 0.55, 0.8, 1]): number | null {
  const g = freeGrid(h);
  const dist = distanceMap(h, g);
  let st = newSim(h);
  const metric = (s: SimState) => {
    const d = dist[g.index(s.ball.x, s.ball.y)];
    return (d < 0 ? 400 : d) + (s.strokes - st.strokes - 1) * 60;
  };
  for (let stroke = 1; stroke <= maxStrokes; stroke++) {
    let best: SimState | null = null;
    let bestM = Infinity;
    for (let a = 0; a < angles; a++) {
      const ang = (a / angles) * Math.PI * 2 + stroke * 0.07;
      for (const p of powers) {
        const s = cloneSim(st);
        if (!shoot(s, { x: Math.cos(ang), y: Math.sin(ang) }, p)) continue;
        let t = 0;
        while (s.moving && t < 14) {
          stepSim(s, h, cfg, 1 / 60);
          t += 1 / 60;
        }
        if (s.sunk) return s.strokes;
        const m = metric(s);
        if (m < bestM) {
          bestM = m;
          best = s;
        }
      }
    }
    if (!best) return null;
    st = best;
    if (st.strokes >= maxStrokes) break;
  }
  return null;
}
