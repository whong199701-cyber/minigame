/**
 * Pure logic for Bridges (Hashiwokakero). No DOM access so everything here can be unit tested.
 *
 * Model
 * - Islands sit on a w×h grid; each has a number 1–8.
 * - A *potential edge* joins two islands that share a row or column with no island in between.
 *   Bridges may only be built on potential edges, 0–2 per edge.
 * - Two edges *cross* when a horizontal one and a vertical one intersect strictly inside both spans.
 * - Solved = every island's bridge count equals its number, no two used edges cross, and all islands
 *   form one connected group. Any arrangement meeting the rules wins (not only the hidden solution).
 */

export type ModeId = 'easy' | 'medium' | 'hard';
export const MODE_IDS: ModeId[] = ['easy', 'medium', 'hard'];

export interface ModeConfig {
  /** Grid is size × size. */
  size: number;
  /** Target island count. */
  islands: number;
}

export const MODES: Record<ModeId, ModeConfig> = {
  easy: { size: 7, islands: 10 },
  medium: { size: 10, islands: 20 },
  hard: { size: 13, islands: 35 },
};

export function isModeId(v: unknown): v is ModeId {
  return v === 'easy' || v === 'medium' || v === 'hard';
}

/** Directions: 0 up, 1 right, 2 down, 3 left. */
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export interface Island {
  x: number;
  y: number;
  /** Required bridge count (1–8). */
  n: number;
}

export interface Edge {
  /** Left (horizontal) or top (vertical) island. */
  a: number;
  /** Right / bottom island. */
  b: number;
  horizontal: boolean;
}

export interface Puzzle {
  w: number;
  h: number;
  islands: Island[];
  /** Bridge count per potential edge (indices as produced by buildBoard). */
  solution: number[];
}

export interface Board {
  w: number;
  h: number;
  islands: Island[];
  edges: Edge[];
  /** For each edge, the indices of the edges it crosses. */
  cross: number[][];
  /** For each island, its incident edge indices. */
  incident: number[][];
  /** nbr[i * 4 + dir] = edge leaving island i in direction dir, or -1. */
  nbr: Int32Array;
}

// ── Random ────────────────────────────────────────────────────────────────

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

function shuffleInPlace<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// ── Board geometry ────────────────────────────────────────────────────────

/** True when horizontal segment (hx1..hx2 at row hy) and vertical segment (vx at vy1..vy2) cross. */
export function segmentsCross(hx1: number, hx2: number, hy: number, vx: number, vy1: number, vy2: number): boolean {
  const x1 = Math.min(hx1, hx2);
  const x2 = Math.max(hx1, hx2);
  const y1 = Math.min(vy1, vy2);
  const y2 = Math.max(vy1, vy2);
  return x1 < vx && vx < x2 && y1 < hy && hy < y2;
}

export function edgesCross(islands: Island[], e1: Edge, e2: Edge): boolean {
  if (e1.horizontal === e2.horizontal) return false;
  const h = e1.horizontal ? e1 : e2;
  const v = e1.horizontal ? e2 : e1;
  const ha = islands[h.a];
  const hb = islands[h.b];
  const va = islands[v.a];
  const vb = islands[v.b];
  return segmentsCross(ha.x, hb.x, ha.y, va.x, va.y, vb.y);
}

/** Build potential edges, crossings and adjacency for a set of islands. */
export function buildBoard(w: number, h: number, islands: Island[]): Board {
  const at = new Int32Array(w * h).fill(-1);
  islands.forEach((p, i) => {
    at[p.y * w + p.x] = i;
  });
  const edges: Edge[] = [];
  const incident: number[][] = islands.map(() => []);
  const nbr = new Int32Array(islands.length * 4).fill(-1);
  const add = (a: number, b: number, horizontal: boolean): void => {
    const idx = edges.length;
    edges.push({ a, b, horizontal });
    incident[a].push(idx);
    incident[b].push(idx);
    if (horizontal) {
      nbr[a * 4 + 1] = idx;
      nbr[b * 4 + 3] = idx;
    } else {
      nbr[a * 4 + 2] = idx;
      nbr[b * 4 + 0] = idx;
    }
  };
  islands.forEach((p, i) => {
    for (let x = p.x + 1; x < w; x++) {
      const j = at[p.y * w + x];
      if (j >= 0) {
        add(i, j, true);
        break;
      }
    }
    for (let y = p.y + 1; y < h; y++) {
      const j = at[y * w + p.x];
      if (j >= 0) {
        add(i, j, false);
        break;
      }
    }
  });
  const cross: number[][] = edges.map(() => []);
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (edgesCross(islands, edges[i], edges[j])) {
        cross[i].push(j);
        cross[j].push(i);
      }
    }
  }
  return { w, h, islands, edges, cross, incident, nbr };
}

export function boardOf(p: Puzzle): Board {
  return buildBoard(p.w, p.h, p.islands);
}

/** Edge joining islands i and j, or -1. */
export function edgeBetween(b: Board, i: number, j: number): number {
  for (const e of b.incident[i]) {
    const ed = b.edges[e];
    if ((ed.a === i && ed.b === j) || (ed.b === i && ed.a === j)) return e;
  }
  return -1;
}

export function otherEnd(b: Board, e: number, i: number): number {
  const ed = b.edges[e];
  return ed.a === i ? ed.b : ed.a;
}

/** Number of grid cells strictly between the two islands of an edge. */
export function edgeGap(b: Board, e: number): number {
  const ed = b.edges[e];
  const A = b.islands[ed.a];
  const B = b.islands[ed.b];
  return Math.abs(A.x - B.x) + Math.abs(A.y - B.y) - 1;
}

// ── Rule checks on a player state ─────────────────────────────────────────

/** Cycle used by taps / drags: 0 → 1 → 2 → 0. */
export function nextCount(v: number): number {
  return (v + 1) % 3;
}

export function degrees(b: Board, bridges: ArrayLike<number>): number[] {
  const d = new Array<number>(b.islands.length).fill(0);
  b.edges.forEach((e, i) => {
    const v = bridges[i] ?? 0;
    d[e.a] += v;
    d[e.b] += v;
  });
  return d;
}

/** Per island: -1 needs more bridges, 0 exactly satisfied, 1 too many. */
export function islandStates(b: Board, bridges: ArrayLike<number>): Int8Array {
  const d = degrees(b, bridges);
  const s = new Int8Array(b.islands.length);
  b.islands.forEach((p, i) => {
    s[i] = d[i] < p.n ? -1 : d[i] > p.n ? 1 : 0;
  });
  return s;
}

/** Used edges that cross edge e (these block building on e). */
export function blockersOf(b: Board, bridges: ArrayLike<number>, e: number): number[] {
  return b.cross[e].filter((c) => (bridges[c] ?? 0) > 0);
}

export function hasCrossing(b: Board, bridges: ArrayLike<number>): boolean {
  for (let e = 0; e < b.edges.length; e++) {
    if ((bridges[e] ?? 0) > 0 && blockersOf(b, bridges, e).length > 0) return true;
  }
  return false;
}

/** Component id per island using edges with at least one bridge. */
export function components(b: Board, bridges: ArrayLike<number>): { id: Int32Array; count: number } {
  const n = b.islands.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  b.edges.forEach((e, i) => {
    if ((bridges[i] ?? 0) > 0) {
      const ra = find(e.a);
      const rb = find(e.b);
      if (ra !== rb) parent[ra] = rb;
    }
  });
  const id = new Int32Array(n);
  const map = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!map.has(r)) map.set(r, map.size);
    id[i] = map.get(r) as number;
  }
  return { id, count: map.size };
}

export function isConnected(b: Board, bridges: ArrayLike<number>): boolean {
  return b.islands.length <= 1 || components(b, bridges).count === 1;
}

export interface BoardCheck {
  /** Islands whose count matches their number. */
  satisfied: number;
  allDegrees: boolean;
  crossing: boolean;
  connected: boolean;
  solved: boolean;
}

export function checkBoard(b: Board, bridges: ArrayLike<number>): BoardCheck {
  const st = islandStates(b, bridges);
  let satisfied = 0;
  for (let i = 0; i < st.length; i++) if (st[i] === 0) satisfied++;
  const allDegrees = satisfied === b.islands.length;
  let validCounts = true;
  for (let e = 0; e < b.edges.length; e++) {
    const v = bridges[e] ?? 0;
    if (v < 0 || v > 2 || !Number.isInteger(v)) validCounts = false;
  }
  const crossing = hasCrossing(b, bridges);
  const connected = isConnected(b, bridges);
  return { satisfied, allDegrees, crossing, connected, solved: validCounts && allDegrees && !crossing && connected };
}

export function isSolved(b: Board, bridges: ArrayLike<number>): boolean {
  return checkBoard(b, bridges).solved;
}

/** BFS distance (in islands) from `start` over used edges; -1 when unreachable. */
export function bfsDistances(b: Board, bridges: ArrayLike<number>, start: number): Int32Array {
  const dist = new Int32Array(b.islands.length).fill(-1);
  if (start < 0 || start >= b.islands.length) return dist;
  dist[start] = 0;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q];
    for (const e of b.incident[u]) {
      if ((bridges[e] ?? 0) <= 0) continue;
      const v = otherEnd(b, e, u);
      if (dist[v] < 0) {
        dist[v] = dist[u] + 1;
        queue.push(v);
      }
    }
  }
  return dist;
}

// ── Solver (constraint propagation + backtracking) ────────────────────────

/** Initial per-edge upper bounds: ≤ 2, ≤ either island's number, plus the 1–1 / 2=2 isolation rule. */
export function initialHi(b: Board): Int8Array {
  const hi = new Int8Array(b.edges.length);
  const many = b.islands.length > 2;
  b.edges.forEach((e, i) => {
    const na = b.islands[e.a].n;
    const nb = b.islands[e.b].n;
    let v = Math.min(2, na, nb);
    // Two 1s joined by one bridge, or two 2s joined by two, would form a closed pair.
    if (many && na === nb && na <= 2) v = Math.min(v, na - 1);
    hi[i] = Math.max(0, v);
  });
  return hi;
}

/**
 * Connectivity reasoning. Returns -1 on contradiction, 1 when bounds were tightened, 0 otherwise.
 * - the graph of still-possible edges must be connected;
 * - an edge whose removal would disconnect that graph (a cut edge) must carry a bridge;
 * - a group already joined by fixed bridges whose islands are all full may not be smaller than the whole.
 */
function connectivity(b: Board, lo: Int8Array, hi: Int8Array): number {
  const n = b.islands.length;
  if (n <= 1) return 0;
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  let time = 0;
  let changed = 0;
  const cuts: number[] = [];
  const dfs = (u: number, pe: number): void => {
    disc[u] = low[u] = time++;
    for (const e of b.incident[u]) {
      if (hi[e] === 0 || e === pe) continue;
      const v = otherEnd(b, e, u);
      if (disc[v] < 0) {
        dfs(v, e);
        if (low[v] < low[u]) low[u] = low[v];
        if (low[v] > disc[u]) cuts.push(e);
      } else if (disc[v] < low[u]) {
        low[u] = disc[v];
      }
    }
  };
  dfs(0, -1);
  if (time < n) return -1;
  for (const e of cuts) {
    if (lo[e] === 0) {
      lo[e] = 1;
      changed = 1;
    }
  }
  // Closed groups formed by fixed bridges.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  b.edges.forEach((e, i) => {
    if (lo[i] > 0) {
      const ra = find(e.a);
      const rb = find(e.b);
      if (ra !== rb) parent[ra] = rb;
    }
  });
  const size = new Int32Array(n);
  const open = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    size[r]++;
    let s = 0;
    for (const e of b.incident[i]) s += lo[e];
    if (s < b.islands[i].n) open[r] = 1;
  }
  for (let i = 0; i < n; i++) {
    if (find(i) === i && !open[i] && size[i] < n) return -1;
  }
  return changed;
}

/**
 * Tighten lo/hi bounds in place until a fixpoint. Returns false when the state is contradictory.
 * Every rule is sound: it never removes a value that some full solution uses.
 */
export function propagate(b: Board, lo: Int8Array, hi: Int8Array): boolean {
  const E = b.edges.length;
  for (let e = 0; e < E; e++) if (lo[e] > hi[e]) return false;
  for (;;) {
    let changed = false;
    for (let e = 0; e < E; e++) {
      if (lo[e] === 0) continue;
      for (const c of b.cross[e]) {
        if (lo[c] > 0) return false;
        if (hi[c] > 0) {
          hi[c] = 0;
          changed = true;
        }
      }
    }
    for (let i = 0; i < b.islands.length; i++) {
      const inc = b.incident[i];
      const need = b.islands[i].n;
      let sLo = 0;
      let sHi = 0;
      for (const e of inc) {
        sLo += lo[e];
        sHi += hi[e];
      }
      if (sLo > need || sHi < need) return false;
      for (const e of inc) {
        const nl = Math.max(lo[e], need - (sHi - hi[e]));
        const nh = Math.min(hi[e], need - (sLo - lo[e]));
        if (nl > nh) return false;
        if (nl !== lo[e] || nh !== hi[e]) {
          sLo += nl - lo[e];
          sHi += nh - hi[e];
          lo[e] = nl;
          hi[e] = nh;
          changed = true;
        }
      }
    }
    if (changed) continue;
    const c = connectivity(b, lo, hi);
    if (c < 0) return false;
    if (c === 0) return true;
  }
}

export interface SolveOptions {
  /** Stop after this many solutions (default 2, enough to test uniqueness). */
  limit?: number;
  /** Abort after this many search nodes (default 20000). */
  maxNodes?: number;
  /** Optional starting lower bounds (e.g. the player's bridges). */
  lo?: ArrayLike<number>;
  /** Optional starting upper bounds. */
  hi?: ArrayLike<number>;
}

export interface SolveResult {
  count: number;
  /** First solution found (bridge count per edge). */
  solution: number[] | null;
  /** Search nodes visited; 1 means propagation alone solved it. */
  nodes: number;
  /** True when maxNodes ran out before the search finished. */
  aborted: boolean;
}

export function solve(b: Board, opts: SolveOptions = {}): SolveResult {
  const limit = opts.limit ?? 2;
  const maxNodes = opts.maxNodes ?? 20000;
  const E = b.edges.length;
  const lo0 = new Int8Array(E);
  const hi0 = initialHi(b);
  if (opts.lo) for (let e = 0; e < E; e++) lo0[e] = Math.max(lo0[e], opts.lo[e] ?? 0);
  if (opts.hi) for (let e = 0; e < E; e++) hi0[e] = Math.min(hi0[e], opts.hi[e] ?? 2);
  const res: SolveResult = { count: 0, solution: null, nodes: 0, aborted: false };
  const undecided = new Int32Array(b.islands.length);

  const rec = (lo: Int8Array, hi: Int8Array): void => {
    if (res.aborted || res.count >= limit) return;
    if (++res.nodes > maxNodes) {
      res.aborted = true;
      return;
    }
    if (!propagate(b, lo, hi)) return;
    undecided.fill(0);
    for (let e = 0; e < E; e++) {
      if (lo[e] < hi[e]) {
        undecided[b.edges[e].a]++;
        undecided[b.edges[e].b]++;
      }
    }
    let best = -1;
    let bestScore = Infinity;
    for (let e = 0; e < E; e++) {
      if (lo[e] >= hi[e]) continue;
      const ed = b.edges[e];
      const score = (hi[e] - lo[e]) * 16 + Math.min(undecided[ed.a], undecided[ed.b]);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best < 0) {
      res.count++;
      if (!res.solution) res.solution = Array.from(lo);
      return;
    }
    for (let v = hi[best]; v >= lo[best]; v--) {
      const l2 = lo.slice();
      const h2 = hi.slice();
      l2[best] = v;
      h2[best] = v;
      rec(l2, h2);
      if (res.aborted || res.count >= limit) return;
    }
  };
  rec(lo0, hi0);
  return res;
}

// ── Generation ────────────────────────────────────────────────────────────

const FREE = 0;
const ISLAND = 1;
const BRIDGE = 2;

function pairKey(a: number, b: number): number {
  return a < b ? a * 4096 + b : b * 4096 + a;
}

/**
 * Grow one random connected solution as described in the brief, then derive the numbers.
 * Returns null if the grid filled up before reaching ~90 % of the target island count.
 */
export function generateCandidate(cfg: ModeConfig, rand: () => number = Math.random): Puzzle | null {
  const w = cfg.size;
  const h = cfg.size;
  const target = cfg.islands;
  const cell = new Uint8Array(w * h);
  const pts: { x: number; y: number }[] = [];
  const conns = new Map<number, number>();
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  const touchesIsland = (x: number, y: number): boolean => {
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (inside(nx, ny) && cell[ny * w + nx] === ISLAND) return true;
    }
    return false;
  };

  // Start somewhere in the middle half so growth can reach every side.
  const sx = Math.floor(w / 4 + rand() * (w / 2));
  const sy = Math.floor(h / 4 + rand() * (h / 2));
  pts.push({ x: sx, y: sy });
  cell[sy * w + sx] = ISLAND;

  let fails = 0;
  const maxFails = target * 60;
  while (pts.length < target && fails < maxFails) {
    const i = Math.floor(rand() * pts.length);
    const d = Math.floor(rand() * 4);
    const len = 2 + Math.floor(rand() * 4); // 2..5
    const { x, y } = pts[i];
    let ok = true;
    for (let k = 1; k < len && ok; k++) {
      const cx = x + DX[d] * k;
      const cy = y + DY[d] * k;
      if (!inside(cx, cy) || cell[cy * w + cx] !== FREE) ok = false;
    }
    const tx = x + DX[d] * len;
    const ty = y + DY[d] * len;
    if (ok && (!inside(tx, ty) || cell[ty * w + tx] !== FREE || touchesIsland(tx, ty))) ok = false;
    if (!ok) {
      fails++;
      continue;
    }
    for (let k = 1; k < len; k++) cell[(y + DY[d] * k) * w + (x + DX[d] * k)] = BRIDGE;
    cell[ty * w + tx] = ISLAND;
    const j = pts.length;
    pts.push({ x: tx, y: ty });
    conns.set(pairKey(i, j), rand() < 0.38 ? 2 : 1);
  }
  if (pts.length < Math.ceil(target * 0.9)) return null;

  // Extra bridges between already aligned pairs create cycles; some single bridges become double.
  const islands: Island[] = pts.map((p) => ({ x: p.x, y: p.y, n: 0 }));
  const board = buildBoard(w, h, islands);
  const order = shuffleInPlace(
    board.edges.map((_, i) => i),
    rand,
  );
  for (const e of order) {
    const ed = board.edges[e];
    const key = pairKey(ed.a, ed.b);
    const cur = conns.get(key);
    if (cur !== undefined) {
      if (cur === 1 && rand() < 0.12) conns.set(key, 2);
      continue;
    }
    if (rand() >= 0.3) continue;
    const A = pts[ed.a];
    const B = pts[ed.b];
    const dx = Math.sign(B.x - A.x);
    const dy = Math.sign(B.y - A.y);
    let clear = true;
    for (let cx = A.x + dx, cy = A.y + dy; cx !== B.x || cy !== B.y; cx += dx, cy += dy) {
      if (cell[cy * w + cx] !== FREE) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    for (let cx = A.x + dx, cy = A.y + dy; cx !== B.x || cy !== B.y; cx += dx, cy += dy) cell[cy * w + cx] = BRIDGE;
    conns.set(key, rand() < 0.3 ? 2 : 1);
  }

  const solution = board.edges.map((ed) => conns.get(pairKey(ed.a, ed.b)) ?? 0);
  const deg = degrees(board, solution);
  islands.forEach((p, i) => {
    p.n = deg[i];
  });
  return { w, h, islands, solution };
}

export interface GenerateOptions {
  /** Max candidates to try (default depends on size). */
  maxAttempts?: number;
  /** Soft time budget in ms (default 260). */
  timeBudgetMs?: number;
  now?: () => number;
}

export interface Generated {
  puzzle: Puzzle;
  /** Proven to have exactly one solution. */
  unique: boolean;
  /** Solver search nodes (1 = solvable by pure deduction). */
  nodes: number;
  attempts: number;
}

/** Search effort we aim for: easy = pure deduction, harder sizes may need a little look-ahead. */
const WANT_NODES: Record<ModeId, number> = { easy: 1, medium: 3, hard: 7 };

/**
 * Generate a puzzle for a mode. Candidates are grown as in the brief; we keep those with a unique
 * solution (so logic alone always suffices) and, for medium/hard, prefer ones that need some look-ahead.
 * Falls back to the best non-unique candidate if the budget runs out (any valid solution is accepted).
 */
export function generatePuzzle(mode: ModeId, rand: () => number = Math.random, opts: GenerateOptions = {}): Generated {
  const cfg = MODES[mode];
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const budget = opts.timeBudgetMs ?? 260;
  const maxAttempts = opts.maxAttempts ?? 400;
  const want = WANT_NODES[mode];
  const t0 = now();
  let best: Generated | null = null;
  let fallback: Generated | null = null;
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts++;
    const p = generateCandidate(cfg, rand);
    if (p) {
      const r = solve(boardOf(p), { limit: 2, maxNodes: 4000 });
      if (!r.aborted && r.count === 1) {
        const g: Generated = { puzzle: p, unique: true, nodes: r.nodes, attempts };
        if (!best || score(g.nodes, want) > score(best.nodes, want)) best = g;
        if (best.nodes >= want) break;
      } else if (!fallback) {
        fallback = { puzzle: p, unique: false, nodes: r.nodes, attempts };
      }
    }
    if (now() - t0 > budget && (best || fallback)) break;
  }
  const out = best ?? fallback;
  if (out) {
    out.attempts = attempts;
    return out;
  }
  // Extremely unlikely: keep trying without limits until a candidate appears.
  for (;;) {
    const p = generateCandidate(cfg, rand);
    if (p) return { puzzle: p, unique: false, nodes: 0, attempts: attempts + 1 };
  }
}

function score(nodes: number, want: number): number {
  // Prefer reaching `want`; beyond it, prefer staying close.
  return nodes >= want ? 1000 - (nodes - want) : nodes;
}

// ── Hints ─────────────────────────────────────────────────────────────────

export type Hint =
  | { kind: 'add'; edge: number; value: number; forced: boolean }
  | { kind: 'fix'; edge: number; value: number };

/**
 * Suggest the next step for the player's bridges `cur`:
 * - if the current bridges can still be completed, return a bridge that logic forces
 *   (direct deduction first, then one-step look-ahead), or one from a completion;
 * - otherwise return a wrong edge and the count it should have (from `solution`).
 * Returns null when nothing is left to suggest.
 */
export function findHint(b: Board, solution: ArrayLike<number>, cur: ArrayLike<number>): Hint | null {
  const E = b.edges.length;
  const base = new Int8Array(E);
  for (let e = 0; e < E; e++) base[e] = Math.max(0, Math.min(3, cur[e] ?? 0));
  const sol = (e: number): number => solution[e] ?? 0;

  // Can the current bridges still be completed? (Only then are deductions from them meaningful.)
  const completion = solve(b, { limit: 1, maxNodes: 50000, lo: base });
  if (completion.solution) {
    const lo = base.slice();
    const hi = initialHi(b);
    if (propagate(b, lo, hi)) {
      // Direct deduction: prefer the edge that gains the most bridges.
      let bestE = -1;
      for (let e = 0; e < E; e++) {
        if (lo[e] > base[e] && (bestE < 0 || lo[e] - base[e] > lo[bestE] - base[bestE])) bestE = e;
      }
      if (bestE >= 0) return { kind: 'add', edge: bestE, value: lo[bestE], forced: true };
      // One-step look-ahead: a value that immediately leads to a contradiction is impossible.
      for (let e = 0; e < E; e++) {
        if (lo[e] >= hi[e]) continue;
        let minOk = -1;
        for (let v = lo[e]; v <= hi[e]; v++) {
          const l2 = lo.slice();
          const h2 = hi.slice();
          l2[e] = v;
          h2[e] = v;
          if (propagate(b, l2, h2)) {
            minOk = v;
            break;
          }
        }
        if (minOk > base[e]) return { kind: 'add', edge: e, value: minOk, forced: true };
      }
    }
    const s = completion.solution;
    for (let e = 0; e < E; e++) {
      if (s[e] > base[e]) return { kind: 'add', edge: e, value: s[e], forced: false };
    }
    return null;
  }
  // Not completable (or the search gave up): compare with the stored solution.
  let wrong = -1;
  for (let e = 0; e < E; e++) {
    if (base[e] > sol(e) && (wrong < 0 || base[e] - sol(e) > base[wrong] - sol(wrong))) wrong = e;
  }
  if (wrong >= 0) return { kind: 'fix', edge: wrong, value: sol(wrong) };
  for (let e = 0; e < E; e++) {
    if (base[e] < sol(e)) return { kind: 'add', edge: e, value: sol(e), forced: false };
  }
  return null;
}

// ── Persistence helpers ───────────────────────────────────────────────────

/** Validate an untrusted (e.g. stored) puzzle: shape, bounds, spacing and a correct solution. */
export function validatePuzzle(p: unknown): p is Puzzle {
  if (!p || typeof p !== 'object') return false;
  const q = p as Partial<Puzzle>;
  if (!Number.isInteger(q.w) || !Number.isInteger(q.h) || !Array.isArray(q.islands) || !Array.isArray(q.solution)) return false;
  const w = q.w as number;
  const h = q.h as number;
  if (w < 1 || h < 1 || w > 40 || h > 40 || q.islands.length < 2) return false;
  const seen = new Set<number>();
  for (const it of q.islands) {
    if (!it || typeof it !== 'object') return false;
    const { x, y, n } = it as Island;
    if (![x, y, n].every((v) => Number.isInteger(v))) return false;
    if (x < 0 || y < 0 || x >= w || y >= h || n < 1 || n > 8) return false;
    if (seen.has(y * w + x)) return false;
    seen.add(y * w + x);
  }
  const b = buildBoard(w, h, q.islands as Island[]);
  if (q.solution.length !== b.edges.length) return false;
  if (!q.solution.every((v) => v === 0 || v === 1 || v === 2)) return false;
  return isSolved(b, q.solution);
}
