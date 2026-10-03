/**
 * Pure logic for Laser Maze: beam tracing (with mirrors, splitters, walls, loop protection),
 * seeded level generation with a guaranteed hidden solution, a small complete solver used to
 * reject trivial puzzles, and the hint helper. No DOM access so everything is unit-testable.
 */

// ── Directions ─────────────────────────────────────────────────────────────
/** 0 = north (up), 1 = east (right), 2 = south (down), 3 = west (left). Screen coords, y grows down. */
export type Dir = 0 | 1 | 2 | 3;
export const DX: readonly number[] = [0, 1, 0, -1];
export const DY: readonly number[] = [-1, 0, 1, 0];

/** Mirror orientation as drawn on screen: '/' bottom-left → top-right, '\' top-left → bottom-right. */
export type Orient = '/' | '\\';

/** Reflection tables. '/' swaps N↔E and S↔W; '\' swaps N↔W and S↔E. */
const REFLECT_SLASH: readonly Dir[] = [1, 0, 3, 2];
const REFLECT_BACK: readonly Dir[] = [3, 2, 1, 0];

export function reflect(dir: Dir, orient: Orient): Dir {
  return orient === '/' ? REFLECT_SLASH[dir] : REFLECT_BACK[dir];
}

// ── Grid cell codes ────────────────────────────────────────────────────────
export const EMPTY = 0;
export const WALL = 1;
export const TARGET = 2;
export const MIRROR_S = 3; // '/'
export const MIRROR_B = 4; // '\'
export const SPLIT_S = 5; // splitter oriented '/'
export const SPLIT_B = 6; // splitter oriented '\'
export const EMITTER = 7;

export function mirrorCode(o: Orient): number {
  return o === '/' ? MIRROR_S : MIRROR_B;
}
export function splitterCode(o: Orient): number {
  return o === '/' ? SPLIT_S : SPLIT_B;
}
export function orientOf(code: number): Orient | null {
  if (code === MIRROR_S || code === SPLIT_S) return '/';
  if (code === MIRROR_B || code === SPLIT_B) return '\\';
  return null;
}
export function isMirror(code: number): boolean {
  return code === MIRROR_S || code === MIRROR_B;
}
export function isSplitter(code: number): boolean {
  return code === SPLIT_S || code === SPLIT_B;
}

// ── Level model ────────────────────────────────────────────────────────────
export interface Pt {
  x: number;
  y: number;
}
export interface Emitter extends Pt {
  dir: Dir;
}
export interface Placement extends Pt {
  orient: Orient;
}

export interface Level {
  size: number;
  emitter: Emitter;
  walls: Pt[];
  targets: Pt[];
  /** Mirrors that are part of the board and cannot be changed. */
  fixedMirrors: Placement[];
  splitters: Placement[];
  /** Mirror budget for the player (= number of hidden mirrors). */
  mirrors: number;
  /** Hidden solution, sorted in the order the beam meets the mirrors. */
  solution: Placement[];
  seed: number;
}

export function cellIndex(size: number, x: number, y: number): number {
  return y * size + x;
}

/** Build the tracing grid: fixed elements from the level plus the given player mirrors. */
export function buildGrid(level: Level, placed?: Iterable<Placement>): Uint8Array {
  const { size } = level;
  const g = new Uint8Array(size * size);
  for (const w of level.walls) g[cellIndex(size, w.x, w.y)] = WALL;
  for (const t of level.targets) g[cellIndex(size, t.x, t.y)] = TARGET;
  for (const m of level.fixedMirrors) g[cellIndex(size, m.x, m.y)] = mirrorCode(m.orient);
  for (const s of level.splitters) g[cellIndex(size, s.x, s.y)] = splitterCode(s.orient);
  g[cellIndex(size, level.emitter.x, level.emitter.y)] = EMITTER;
  if (placed) {
    for (const p of placed) {
      const i = cellIndex(size, p.x, p.y);
      if (g[i] === EMPTY) g[i] = mirrorCode(p.orient);
    }
  }
  return g;
}

// ── Beam tracing ───────────────────────────────────────────────────────────
export interface Segment {
  /** Start / end in cell units (cell centres are at +0.5). */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Beam distance (in cells) at the start / end of the segment, for the reveal animation. */
  d0: number;
  d1: number;
}

export interface Visit {
  x: number;
  y: number;
  dir: Dir;
  dist: number;
  /** Number of 90° turns the beam made before arriving here. */
  refl: number;
}

export interface TraceResult {
  segments: Segment[];
  visits: Visit[];
  /** Cell indexes of lit targets. */
  lit: Set<number>;
  /** Cell indexes of mirrors / splitters the beam actually reflected on. */
  hits: Set<number>;
  steps: number;
  /** True when the step cap stopped the trace (should never happen on sane grids). */
  capped: boolean;
  /** Total beam length (max d1), in cells. */
  length: number;
}

export const DEFAULT_MAX_STEPS = 500;

/**
 * Trace the beam from the emitter. Mirrors turn the beam, splitters both pass and turn it, walls,
 * the emitter and the grid border stop it, targets are transparent. Each (cell, direction) state is
 * entered at most once so loops terminate; `maxSteps` is an extra hard cap.
 */
export function traceBeam(grid: Uint8Array, size: number, emitter: Emitter, maxSteps = DEFAULT_MAX_STEPS): TraceResult {
  const segments: Segment[] = [];
  const visits: Visit[] = [];
  const lit = new Set<number>();
  const hits = new Set<number>();
  const visited = new Uint8Array(size * size * 4);
  const queue: Visit[] = [{ x: emitter.x, y: emitter.y, dir: emitter.dir, dist: 0, refl: 0 }];
  visited[cellIndex(size, emitter.x, emitter.y) * 4 + emitter.dir] = 1;
  let qi = 0;
  let steps = 0;
  let capped = false;
  let length = 0;

  while (qi < queue.length) {
    if (steps >= maxSteps) {
      capped = true;
      break;
    }
    steps++;
    const s = queue[qi++];
    visits.push(s);
    const idx = cellIndex(size, s.x, s.y);
    const code = grid[idx];
    if (code === TARGET) lit.add(idx);

    let outs: { dir: Dir; turned: boolean }[];
    if (isMirror(code)) {
      hits.add(idx);
      outs = [{ dir: reflect(s.dir, orientOf(code) as Orient), turned: true }];
    } else if (isSplitter(code)) {
      hits.add(idx);
      outs = [
        { dir: s.dir, turned: false },
        { dir: reflect(s.dir, orientOf(code) as Orient), turned: true },
      ];
    } else {
      outs = [{ dir: s.dir, turned: false }];
    }

    const cx = s.x + 0.5;
    const cy = s.y + 0.5;
    for (const o of outs) {
      const nx = s.x + DX[o.dir];
      const ny = s.y + DY[o.dir];
      const blocked = nx < 0 || ny < 0 || nx >= size || ny >= size || grid[cellIndex(size, nx, ny)] === WALL || grid[cellIndex(size, nx, ny)] === EMITTER;
      if (blocked) {
        segments.push({ ax: cx, ay: cy, bx: cx + DX[o.dir] * 0.5, by: cy + DY[o.dir] * 0.5, d0: s.dist, d1: s.dist + 0.5 });
        if (s.dist + 0.5 > length) length = s.dist + 0.5;
        continue;
      }
      segments.push({ ax: cx, ay: cy, bx: nx + 0.5, by: ny + 0.5, d0: s.dist, d1: s.dist + 1 });
      if (s.dist + 1 > length) length = s.dist + 1;
      const key = cellIndex(size, nx, ny) * 4 + o.dir;
      if (visited[key]) continue; // merged into an already traced beam (loop or splitter rejoin)
      visited[key] = 1;
      queue.push({ x: nx, y: ny, dir: o.dir, dist: s.dist + 1, refl: s.refl + (o.turned ? 1 : 0) });
    }
  }
  return { segments, visits, lit, hits, steps, capped, length };
}

export function allTargetsLit(trace: TraceResult, level: Level): boolean {
  return trace.lit.size >= level.targets.length;
}

// ── Difficulty curve ───────────────────────────────────────────────────────
export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
/** Each track starts further along the shared difficulty curve. */
export const TRACK_OFFSET: Record<Difficulty, number> = { easy: 0, medium: 6, hard: 12 };

export interface Params {
  size: number;
  targets: number;
  mirrors: number;
  walls: number;
  fixedMirrors: number;
  splitters: number;
}

/** Curve of the brief: 6×6 → 9×9, 1–4 targets, mirror budget 2–6, splitters from (curve) level 8. */
export function curveParams(L: number): Params {
  const size = L <= 3 ? 6 : L <= 7 ? 7 : L <= 12 ? 8 : 9;
  const targets = L <= 2 ? 1 : L <= 5 ? 2 : L <= 10 ? 3 : 4;
  const mirrors = L <= 2 ? 2 : L <= 5 ? 3 : L <= 9 ? 4 : L <= 14 ? 5 : 6;
  const walls = Math.min(Math.floor((size * size) / 6), 2 + Math.floor(L * 0.7));
  const fixedMirrors = L <= 3 ? 0 : L <= 8 ? 1 : 2;
  const splitters = L < 8 ? 0 : L <= 14 ? 1 : 2;
  return { size, targets, mirrors, walls, fixedMirrors, splitters };
}

export function levelParams(mode: Difficulty, level: number): Params {
  return curveParams(Math.max(1, level) + TRACK_OFFSET[mode]);
}

// ── Seeded random ──────────────────────────────────────────────────────────
export type Rand = () => number;

/** mulberry32 */
export function seededRandom(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function levelSeed(mode: Difficulty, level: number): number {
  const m = DIFFICULTIES.indexOf(mode) + 1;
  let h = (m * 0x9e3779b1 + level * 0x85ebca6b + 0x1b873593) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

function shuffleInPlace<T>(arr: T[], rand: Rand): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Solver (complete for "every placed mirror is hit" solutions) ───────────
/**
 * Depth-first search that only places mirrors on cells the current beam passes through. Any
 * solution can be re-ordered so that each mirror is on the beam when it is placed, so this search
 * is complete up to `maxMirrors` placements (within the node budget). Returns the placements or null.
 */
export function solve(grid: Uint8Array, size: number, emitter: Emitter, targetCount: number, maxMirrors: number, maxNodes = 60000): Placement[] | null {
  const g = grid.slice();
  const placed: Placement[] = [];
  let nodes = 0;
  const dfs = (remaining: number): boolean => {
    if (nodes++ > maxNodes) return false;
    const tr = traceBeam(g, size, emitter);
    if (tr.lit.size >= targetCount) return true;
    if (remaining === 0) return false;
    const seen = new Set<number>();
    const cells: number[] = [];
    for (const v of tr.visits) {
      const i = cellIndex(size, v.x, v.y);
      if (g[i] !== EMPTY || seen.has(i)) continue;
      seen.add(i);
      cells.push(i);
    }
    for (const c of cells) {
      for (const orient of ['/', '\\'] as Orient[]) {
        g[c] = mirrorCode(orient);
        placed.push({ x: c % size, y: Math.floor(c / size), orient });
        if (dfs(remaining - 1)) return true;
        placed.pop();
        g[c] = EMPTY;
      }
    }
    return false;
  };
  return dfs(maxMirrors) ? placed.slice() : null;
}

// ── Generation ─────────────────────────────────────────────────────────────
type RouteItem = 'mirror' | 'fixed' | 'splitter';

function tryGenerate(p: Params, rand: Rand, seed: number): Level | null {
  const { size } = p;
  const grid = new Uint8Array(size * size);
  const idx = (x: number, y: number) => cellIndex(size, x, y);

  // Emitter on a border cell (not a corner), pointing inward.
  const side = Math.floor(rand() * 4);
  const pos = 1 + Math.floor(rand() * (size - 2));
  let emitter: Emitter;
  if (side === 0) emitter = { x: pos, y: 0, dir: 2 };
  else if (side === 1) emitter = { x: size - 1, y: pos, dir: 3 };
  else if (side === 2) emitter = { x: pos, y: size - 1, dir: 0 };
  else emitter = { x: 0, y: pos, dir: 1 };
  grid[idx(emitter.x, emitter.y)] = EMITTER;
  const ahead = idx(emitter.x + DX[emitter.dir], emitter.y + DY[emitter.dir]);

  // Walls on random cells (never directly in front of the emitter).
  const free: number[] = [];
  for (let i = 0; i < size * size; i++) if (grid[i] === EMPTY && i !== ahead) free.push(i);
  shuffleInPlace(free, rand);
  const walls: Pt[] = [];
  for (let i = 0; i < p.walls && i < free.length; i++) {
    grid[free[i]] = WALL;
    walls.push({ x: free[i] % size, y: Math.floor(free[i] / size) });
  }

  // Route: hidden mirrors, fixed mirrors and splitters placed one after another along the beam.
  const items: RouteItem[] = [];
  for (let i = 0; i < p.mirrors; i++) items.push('mirror');
  for (let i = 0; i < p.fixedMirrors; i++) items.push('fixed');
  for (let i = 0; i < p.splitters; i++) items.push('splitter');
  shuffleInPlace(items, rand);

  const hidden: Placement[] = [];
  const fixed: Placement[] = [];
  const splitters: Placement[] = [];
  const routeCells: number[] = [];
  let lastDist = 0;

  for (const item of items) {
    const tr = traceBeam(grid, size, emitter);
    const first = new Map<number, Visit>();
    for (const v of tr.visits) {
      const i = idx(v.x, v.y);
      if (grid[i] !== EMPTY || first.has(i)) continue;
      first.set(i, v);
    }
    let cands = [...first.values()].filter((v) => v.dist >= lastDist + 2);
    if (cands.length === 0) cands = [...first.values()].filter((v) => v.dist >= lastDist + 1);
    if (cands.length === 0) return null;
    let ok = false;
    for (let attempt = 0; attempt < 10 && !ok; attempt++) {
      const v = cands[Math.floor(rand() * cands.length)];
      const orient: Orient = rand() < 0.5 ? '/' : '\\';
      const c = idx(v.x, v.y);
      grid[c] = item === 'splitter' ? splitterCode(orient) : mirrorCode(orient);
      const t2 = traceBeam(grid, size, emitter);
      // The turned beam must travel at least one full cell, and every earlier route element must still be hit.
      const out = reflect(v.dir, orient);
      const nx = v.x + DX[out];
      const ny = v.y + DY[out];
      const travels = t2.visits.some((w) => w.x === nx && w.y === ny && w.dir === out);
      const allHit = travels && t2.hits.has(c) && routeCells.every((rc) => t2.hits.has(rc));
      if (!allHit) {
        grid[c] = EMPTY;
        continue;
      }
      ok = true;
      routeCells.push(c);
      lastDist = v.dist;
      const pl: Placement = { x: v.x, y: v.y, orient };
      if (item === 'mirror') hidden.push(pl);
      else if (item === 'fixed') fixed.push(pl);
      else splitters.push(pl);
    }
    if (!ok) return null;
  }

  const full = traceBeam(grid, size, emitter);
  if (full.capped) return null;
  for (const c of routeCells) if (!full.hits.has(c)) return null;

  // Board as the player sees it (hidden mirrors removed).
  const base = grid.slice();
  for (const h of hidden) base[idx(h.x, h.y)] = EMPTY;
  const baseTr = traceBeam(base, size, emitter);
  const onBase = new Set<number>();
  for (const v of baseTr.visits) onBase.add(idx(v.x, v.y));

  // Target candidates: on the solved beam, after at least one turn, unreachable on the empty board.
  const candDist = new Map<number, number>();
  for (const v of full.visits) {
    const i = idx(v.x, v.y);
    if (grid[i] !== EMPTY || v.refl < 1 || onBase.has(i)) continue;
    const d = candDist.get(i);
    if (d === undefined || v.dist > d) candDist.set(i, v.dist);
  }
  if (candDist.size < p.targets) return null;
  const sorted = [...candDist.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const targets: Pt[] = [];
  const chosen = new Set<number>();
  for (let n = 0; n < p.targets; n++) {
    let pool = sorted.filter((c) => !chosen.has(c));
    // Keep targets apart when possible.
    const spaced = pool.filter((c) => {
      const x = c % size;
      const y = Math.floor(c / size);
      return targets.every((t) => Math.abs(t.x - x) + Math.abs(t.y - y) > 1);
    });
    if (spaced.length) pool = spaced;
    // Biased towards the far end of the beam (index 0 = farthest).
    const k = n === 0 ? Math.floor(rand() * Math.min(2, pool.length)) : Math.floor(pool.length * (1 - Math.sqrt(rand())));
    const c = pool[Math.min(k, pool.length - 1)];
    chosen.add(c);
    targets.push({ x: c % size, y: Math.floor(c / size) });
  }
  for (const t of targets) {
    grid[idx(t.x, t.y)] = TARGET;
    base[idx(t.x, t.y)] = TARGET;
  }

  // Validate: solution lights everything, the empty board lights nothing.
  const solved = traceBeam(grid, size, emitter);
  if (solved.lit.size !== targets.length) return null;
  if (traceBeam(base, size, emitter).lit.size !== 0) return null;

  // Reject puzzles that fall to fewer mirrors than the budget suggests.
  const limit = Math.min(2, p.mirrors - 1);
  if (limit >= 1 && solve(base, size, emitter, targets.length, limit) !== null) return null;

  // Order the solution by the distance at which the beam meets each mirror (for hints).
  const hitDist = new Map<number, number>();
  for (const v of solved.visits) {
    const i = idx(v.x, v.y);
    if (isMirror(grid[i]) && !hitDist.has(i)) hitDist.set(i, v.dist);
  }
  const solution = hidden.slice().sort((a, b) => (hitDist.get(idx(a.x, a.y)) ?? 0) - (hitDist.get(idx(b.x, b.y)) ?? 0));

  return { size, emitter, walls, targets, fixedMirrors: fixed, splitters, mirrors: p.mirrors, solution, seed };
}

/** Try to build a level with exactly these parameters. Returns null when no attempt succeeded. */
export function generateWithParams(p: Params, seed: number, maxAttempts = 300): Level | null {
  for (let a = 0; a < maxAttempts; a++) {
    const rand = seededRandom((seed + a * 0x3c6ef372) >>> 0);
    const lv = tryGenerate(p, rand, seed);
    if (lv) return lv;
  }
  return null;
}

function relaxParams(p: Params, step: number): Params {
  const q = { ...p };
  if (step >= 1) q.walls = Math.max(0, Math.floor(p.walls / 2));
  if (step >= 2) {
    q.splitters = 0;
    q.fixedMirrors = Math.min(1, p.fixedMirrors);
  }
  if (step >= 3) {
    q.targets = Math.max(1, p.targets - 1);
    q.walls = 0;
  }
  return q;
}

/** Hand-built level used only if generation somehow fails; always solvable. */
export function fallbackLevel(seed: number): Level {
  return {
    size: 6,
    emitter: { x: 0, y: 2, dir: 1 },
    walls: [{ x: 5, y: 2 }],
    targets: [
      { x: 3, y: 4 },
      { x: 1, y: 5 },
    ],
    fixedMirrors: [],
    splitters: [],
    mirrors: 2,
    solution: [
      { x: 3, y: 2, orient: '\\' },
      { x: 3, y: 5, orient: '/' },
    ],
    seed,
  };
}

/** Deterministic level for a track + number. Never throws, never returns an unsolvable level. */
export function generateLevel(mode: Difficulty, level: number): Level {
  const p = levelParams(mode, level);
  const seed = levelSeed(mode, level);
  for (let step = 0; step <= 3; step++) {
    const lv = generateWithParams(relaxParams(p, step), (seed + step * 0x51ed27) >>> 0);
    if (lv) return lv;
  }
  return fallbackLevel(seed);
}

// ── Hints ──────────────────────────────────────────────────────────────────
export interface Hint {
  place: Placement;
  /** Cell index of a player mirror that must be removed first (budget exhausted). */
  remove?: number;
}

/**
 * The next mirror of the hidden solution that is missing or wrongly oriented on the player's board.
 * Returns null when the board already contains the whole solution.
 */
export function hintFor(level: Level, placed: ReadonlyMap<number, Orient>): Hint | null {
  const { size } = level;
  const solKeys = new Set(level.solution.map((s) => cellIndex(size, s.x, s.y)));
  for (const s of level.solution) {
    const k = cellIndex(size, s.x, s.y);
    if (placed.get(k) === s.orient) continue;
    const hint: Hint = { place: s };
    if (!placed.has(k) && placed.size >= level.mirrors) {
      for (const key of placed.keys()) {
        if (!solKeys.has(key)) {
          hint.remove = key;
          break;
        }
      }
    }
    return hint;
  }
  return null;
}

/** Cycle a cell: empty → '/' → '\' → empty. Returns the new orientation or null for removed. */
export function nextOrient(current: Orient | undefined): Orient | null {
  if (current === undefined) return '/';
  if (current === '/') return '\\';
  return null;
}
