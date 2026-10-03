/**
 * Pure logic for Circuit Rotate (Netwalk). No DOM access so it can be unit tested.
 *
 * A tile is a 4-bit mask of connectors: bit 0 = up, bit 1 = right, bit 2 = down, bit 3 = left.
 * Rotating a tile 90° clockwise shifts the bits up by one (left wraps round to up).
 */

export type ModeId = 'easy' | 'medium' | 'hard' | 'expert';

export interface ModeConfig {
  size: number;
  /** Connections wrap across the grid borders (torus). */
  wrap: boolean;
  /** Probability of accepting a tree edge that turns a tile into a 4-way cross. */
  crossChance: number;
}

export const MODES: Record<ModeId, ModeConfig> = {
  easy: { size: 5, wrap: false, crossChance: 0.3 },
  medium: { size: 7, wrap: false, crossChance: 0.18 },
  hard: { size: 9, wrap: false, crossChance: 0.08 },
  expert: { size: 11, wrap: true, crossChance: 0.04 },
};

export const MODE_IDS: ModeId[] = ['easy', 'medium', 'hard', 'expert'];

export function isModeId(v: unknown): v is ModeId {
  return typeof v === 'string' && (MODE_IDS as string[]).includes(v);
}

/** The next (bigger) mode, or null after the last one. */
export function nextMode(id: ModeId): ModeId | null {
  const i = MODE_IDS.indexOf(id);
  return i >= 0 && i < MODE_IDS.length - 1 ? MODE_IDS[i + 1] : null;
}

/** The power source always sits in the centre tile. */
export function sourceIndex(size: number): number {
  return Math.floor((size * size) / 2);
}

/** Direction indices and their deltas (0 up, 1 right, 2 down, 3 left). */
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export const UP = 1;
export const RIGHT = 2;
export const DOWN = 4;
export const LEFT = 8;

export function opposite(d: number): number {
  return (d + 2) & 3;
}

/** Rotate a connector mask 90° clockwise. */
export function rotCW(mask: number): number {
  return ((mask << 1) | (mask >> 3)) & 15;
}

export function rotateTimes(mask: number, n: number): number {
  let m = mask & 15;
  for (let i = 0; i < ((n % 4) + 4) % 4; i++) m = rotCW(m);
  return m;
}

/** Number of connectors on a tile. */
export function degree(mask: number): number {
  let c = 0;
  for (let d = 0; d < 4; d++) if (mask & (1 << d)) c++;
  return c;
}

/** Rotational period: a cross never changes (1), a straight repeats after 2, everything else after 4. */
export function period(mask: number): number {
  const m = mask & 15;
  if (m === 15 || m === 0) return 1;
  if (m === 5 || m === 10) return 2;
  return 4;
}

/** Minimal number of clockwise rotations taking `from` to `to`, or -1 if impossible (different tile type). */
export function minRotations(from: number, to: number): number {
  let m = from & 15;
  for (let r = 0; r < 4; r++) {
    if (m === (to & 15)) return r;
    m = rotCW(m);
  }
  return -1;
}

/** Index of the neighbour of tile `i` in direction `d`, or -1 when it would leave a non-wrapping grid. */
export function neighbour(size: number, wrap: boolean, i: number, d: number): number {
  const x = i % size;
  const y = (i - x) / size;
  let nx = x + DX[d];
  let ny = y + DY[d];
  if (wrap) {
    nx = (nx + size) % size;
    ny = (ny + size) % size;
  } else if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
    return -1;
  }
  return ny * size + nx;
}

/** Small seeded PRNG (mulberry32) for reproducible puzzles and tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random spanning tree over the grid rooted at `source` (randomised Prim: grow from the source by picking a
 * uniformly random frontier edge). Returns the connector masks of the solved board. Tree edges that would create
 * a 4-way cross are only accepted with probability `crossChance` (crosses are free moves for the player).
 */
export function spanningTree(size: number, wrap: boolean, source: number, rand: () => number = Math.random, crossChance = 0.15): Uint8Array {
  const n = size * size;
  const masks = new Uint8Array(n);
  const inTree = new Uint8Array(n);
  inTree[source] = 1;
  const frontier: number[] = []; // encoded as tile * 4 + direction
  const pushEdges = (i: number): void => {
    for (let d = 0; d < 4; d++) {
      const j = neighbour(size, wrap, i, d);
      if (j >= 0 && !inTree[j]) frontier.push(i * 4 + d);
    }
  };
  const removeAt = (k: number): void => {
    frontier[k] = frontier[frontier.length - 1];
    frontier.pop();
  };
  pushEdges(source);
  let count = 1;
  while (count < n && frontier.length) {
    let k = Math.floor(rand() * frontier.length);
    let i = frontier[k] >> 2;
    let d = frontier[k] & 3;
    let j = neighbour(size, wrap, i, d);
    if (j < 0 || inTree[j]) {
      removeAt(k); // stale entry: the far end joined the tree through another edge
      continue;
    }
    // Avoid turning `i` into a cross most of the time: prefer any other usable frontier edge.
    if (degree(masks[i]) === 3 && rand() >= crossChance) {
      const alternatives: number[] = [];
      for (let q = 0; q < frontier.length; q++) {
        const qi = frontier[q] >> 2;
        const qj = neighbour(size, wrap, qi, frontier[q] & 3);
        if (qj >= 0 && !inTree[qj] && degree(masks[qi]) < 3) alternatives.push(q);
      }
      if (alternatives.length) {
        k = alternatives[Math.floor(rand() * alternatives.length)];
        i = frontier[k] >> 2;
        d = frontier[k] & 3;
        j = neighbour(size, wrap, i, d);
      }
    }
    masks[i] |= 1 << d;
    masks[j] |= 1 << opposite(d);
    inTree[j] = 1;
    count++;
    removeAt(k);
    pushEdges(j);
  }
  return masks;
}

/**
 * Randomly rotate every tile; guarantees at least `minWrongFraction` of all tiles end up in a different
 * orientation from the solution (crosses can never be wrong, so the fraction is best-effort when the board
 * is almost all crosses).
 */
export function scramble(solution: Uint8Array, rand: () => number = Math.random, minWrongFraction = 0.6): Uint8Array {
  const n = solution.length;
  const tiles = new Uint8Array(n);
  for (let i = 0; i < n; i++) tiles[i] = rotateTimes(solution[i], Math.floor(rand() * period(solution[i])));
  const need = Math.ceil(n * minWrongFraction);
  let wrong = 0;
  for (let i = 0; i < n; i++) if (tiles[i] !== solution[i]) wrong++;
  if (wrong < need) {
    const fixable: number[] = [];
    for (let i = 0; i < n; i++) if (tiles[i] === solution[i] && period(solution[i]) > 1) fixable.push(i);
    for (let i = fixable.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [fixable[i], fixable[j]] = [fixable[j], fixable[i]];
    }
    for (const idx of fixable) {
      if (wrong >= need) break;
      const p = period(solution[idx]);
      tiles[idx] = rotateTimes(solution[idx], 1 + Math.floor(rand() * (p - 1)));
      wrong++;
    }
  }
  return tiles;
}

/** "Par": the sum over tiles of the minimal clockwise rotations needed to reach the solution. */
export function computePar(tiles: ArrayLike<number>, solution: ArrayLike<number>): number {
  let par = 0;
  for (let i = 0; i < tiles.length; i++) {
    const r = minRotations(tiles[i], solution[i]);
    if (r > 0) par += r;
  }
  return par;
}

export interface PowerResult {
  /** 1 for every tile reachable from the source through mutual connections. */
  powered: Uint8Array;
  /** Number of powered tiles (including the source). */
  count: number;
  /** BFS distance from the source, -1 when unpowered. */
  dist: Int16Array;
}

/** BFS from the source following mutual connections only. */
export function computePower(size: number, wrap: boolean, tiles: ArrayLike<number>, source: number): PowerResult {
  const n = size * size;
  const powered = new Uint8Array(n);
  const dist = new Int16Array(n).fill(-1);
  const queue: number[] = [source];
  powered[source] = 1;
  dist[source] = 0;
  let count = 1;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (let d = 0; d < 4; d++) {
      if (!(tiles[i] & (1 << d))) continue;
      const j = neighbour(size, wrap, i, d);
      if (j < 0 || powered[j]) continue;
      if (!(tiles[j] & (1 << opposite(d)))) continue;
      powered[j] = 1;
      dist[j] = dist[i] + 1;
      count++;
      queue.push(j);
    }
  }
  return { powered, count, dist };
}

/** Number of connectors that point at nothing (off the grid or at a neighbour without a matching connector). */
export function countDangling(size: number, wrap: boolean, tiles: ArrayLike<number>): number {
  let dangling = 0;
  for (let i = 0; i < tiles.length; i++) {
    for (let d = 0; d < 4; d++) {
      if (!(tiles[i] & (1 << d))) continue;
      const j = neighbour(size, wrap, i, d);
      if (j < 0 || !(tiles[j] & (1 << opposite(d)))) dangling++;
    }
  }
  return dangling;
}

/** Solved when every tile is powered and no connector dangles. */
export function isSolved(size: number, wrap: boolean, tiles: ArrayLike<number>, source: number): boolean {
  if (computePower(size, wrap, tiles, source).count !== size * size) return false;
  return countDangling(size, wrap, tiles) === 0;
}

export interface DeduceResult {
  /** Remaining candidate orientation masks per tile. */
  cands: number[][];
  /** Every tile has exactly one candidate left (the puzzle is uniquely solvable by local deduction). */
  solved: boolean;
  /** False when a contradiction was found (impossible for a well-formed puzzle). */
  ok: boolean;
}

/**
 * Constraint-propagation solver working only from the tile shapes (orientation is irrelevant).
 * Rules: connectors cannot leave a non-wrapping grid; every connection must be mutual; the final network is a
 * spanning tree, so an undecided edge inside an already-connected group must be off, and a group with a single
 * possible edge to the outside must use it (`useTreeRules` false disables these two). Sound for any valid
 * solution, so when `solved` is true the solution is unique.
 */
export function deduce(size: number, wrap: boolean, tiles: ArrayLike<number>, useTreeRules = true): DeduceResult {
  const n = size * size;
  const cands: number[][] = [];
  for (let i = 0; i < n; i++) {
    const set = new Set<number>();
    let m = tiles[i] & 15;
    for (let r = 0; r < 4; r++) {
      set.add(m);
      m = rotCW(m);
    }
    let list = [...set];
    if (!wrap) {
      list = list.filter((mask) => {
        for (let d = 0; d < 4; d++) if (mask & (1 << d) && neighbour(size, false, i, d) < 0) return false;
        return true;
      });
    }
    cands.push(list);
  }
  // 1 = every candidate has the connector, 0 = none has it, -1 = undecided
  const status = (i: number, d: number): number => {
    let on = 0;
    let off = 0;
    for (const m of cands[i]) if (m & (1 << d)) on++; else off++;
    return on && off ? -1 : on ? 1 : 0;
  };
  /** Drop candidates of tile i whose connector in direction d is present (`has` true) / absent (`has` false). */
  const drop = (i: number, d: number, has: boolean): boolean => {
    const before = cands[i].length;
    cands[i] = cands[i].filter((m) => ((m & (1 << d)) !== 0) !== has);
    return cands[i].length !== before;
  };
  const parent = new Int32Array(n);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  let ok = true;
  let changed = true;
  while (changed && ok) {
    changed = false;
    // Mutual connections.
    for (let i = 0; i < n && ok; i++) {
      for (let d = 0; d < 4; d++) {
        const j = neighbour(size, wrap, i, d);
        if (j < 0) {
          if (status(i, d) !== 0) changed = drop(i, d, true) || changed;
          continue;
        }
        const sj = status(j, opposite(d));
        if (sj === 0) changed = drop(i, d, true) || changed;
        else if (sj === 1) changed = drop(i, d, false) || changed;
      }
      if (cands[i].length === 0) ok = false;
    }
    if (!ok || changed || !useTreeRules) continue;
    // Tree reasoning on top of the decided edges.
    for (let i = 0; i < n; i++) parent[i] = i;
    const unknown: number[] = []; // encoded i * 4 + d, each undirected edge once
    for (let i = 0; i < n; i++) {
      for (const d of [1, 2]) {
        const j = neighbour(size, wrap, i, d);
        if (j < 0) continue;
        const si = status(i, d);
        const sj = status(j, opposite(d));
        if (si === 1 && sj === 1) {
          const a = find(i);
          const b = find(j);
          if (a !== b) parent[a] = b;
        } else if (si !== 0 && sj !== 0) {
          unknown.push(i * 4 + d);
        }
      }
    }
    // An undecided edge between two tiles already linked would close a loop.
    for (const e of unknown) {
      const i = e >> 2;
      const d = e & 3;
      const j = neighbour(size, wrap, i, d);
      if (find(i) === find(j)) {
        drop(i, d, true);
        drop(j, opposite(d), true);
        changed = true;
      }
    }
    if (changed) continue;
    // A group with exactly one possible way out must take it.
    const groupSize = new Int32Array(n);
    const exits = new Int32Array(n);
    const lastExit = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) groupSize[find(i)]++;
    for (const e of unknown) {
      const i = e >> 2;
      const d = e & 3;
      const j = neighbour(size, wrap, i, d);
      const a = find(i);
      const b = find(j);
      exits[a]++;
      exits[b]++;
      lastExit[a] = e;
      lastExit[b] = e;
    }
    for (let r = 0; r < n; r++) {
      if (find(r) !== r || groupSize[r] === n) continue;
      if (exits[r] === 0) {
        ok = false;
        break;
      }
      if (exits[r] === 1) {
        const e = lastExit[r];
        const i = e >> 2;
        const d = e & 3;
        const j = neighbour(size, wrap, i, d);
        changed = drop(i, d, false) || changed;
        changed = drop(j, opposite(d), false) || changed;
      }
    }
  }
  const solved = ok && cands.every((c) => c.length === 1);
  return { cands, solved, ok };
}

export interface Puzzle {
  size: number;
  wrap: boolean;
  source: number;
  /** Connector masks of the solved board. */
  solution: Uint8Array;
  /** Scrambled starting orientation. */
  tiles: Uint8Array;
  /** Minimal clockwise rotations from `tiles` to `solution`. */
  par: number;
  /** The solution is unique and reachable by pure deduction (no guessing). */
  deducible: boolean;
}

/**
 * Generate a puzzle: draw random spanning trees and keep the first one the deduction solver can fully solve
 * (unique, guess-free). Falls back to the most constrained candidate after `attempts` tries.
 */
export function generatePuzzle(cfg: ModeConfig, rand: () => number = Math.random, attempts = 200): Puzzle {
  const { size, wrap } = cfg;
  const source = sourceIndex(size);
  let best: { solution: Uint8Array; open: number } | null = null;
  for (let a = 0; a < Math.max(1, attempts); a++) {
    const solution = spanningTree(size, wrap, source, rand, cfg.crossChance);
    const r = deduce(size, wrap, solution);
    const open = r.cands.filter((c) => c.length > 1).length;
    if (!best || open < best.open) best = { solution, open };
    if (r.solved) break;
  }
  const solution = best!.solution;
  const tiles = scramble(solution, rand);
  return { size, wrap, source, solution, tiles, par: computePar(tiles, solution), deducible: best!.open === 0 };
}

/** Index of the wrong tile closest to the source along the solution tree, or -1 when everything is correct. */
export function hintTile(puzzle: Puzzle, tiles: ArrayLike<number>): number {
  const { dist } = computePower(puzzle.size, puzzle.wrap, puzzle.solution, puzzle.source);
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === puzzle.solution[i]) continue;
    if (dist[i] >= 0 && dist[i] < bestDist) {
      bestDist = dist[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Rebuild a puzzle from a stored solution and starting orientation (par is recomputed). */
export function rebuildPuzzle(cfg: ModeConfig, solution: ArrayLike<number>, start: ArrayLike<number>): Puzzle {
  const sol = Uint8Array.from(solution);
  const tiles = Uint8Array.from(start);
  return {
    size: cfg.size,
    wrap: cfg.wrap,
    source: sourceIndex(cfg.size),
    solution: sol,
    tiles,
    par: computePar(tiles, sol),
    deducible: deduce(cfg.size, cfg.wrap, tiles).solved,
  };
}

// ── Player actions (pure helpers used by the UI) ──────────────────────────

/**
 * Position in `stack` (tile indices, oldest first) of the most recent turn that can be undone, i.e. whose tile
 * is not locked now. -1 when there is none. Locked entries are skipped but kept, so they become undoable again
 * once the tile is unlocked.
 */
export function undoTarget(stack: readonly number[], locked: ArrayLike<number>): number {
  for (let k = stack.length - 1; k >= 0; k--) if (!locked[stack[k]]) return k;
  return -1;
}

/**
 * Toggle the player's lock on tile `i`. Tiles fixed by a hint stay locked: returns false and changes nothing.
 * Otherwise flips the lock and returns true.
 */
export function toggleLockAt(locked: Uint8Array, hinted: ArrayLike<number>, i: number): boolean {
  if (hinted[i]) return false;
  locked[i] ^= 1;
  return true;
}

export interface ParVerdict {
  /** Turns over par (0 when exactly par). */
  over: number;
  /** Solved at par without any hint (hints apply the minimal turns for the player, so they never count). */
  perfect: boolean;
  /** The game may set the "fewest turns over par" record (hint-free games only). */
  turnsRecord: boolean;
}

export function parVerdict(rotations: number, par: number, hints: number): ParVerdict {
  const over = Math.max(0, rotations - par);
  const clean = hints === 0;
  return { over, perfect: clean && over === 0, turnsRecord: clean };
}

/**
 * Rate limiter for repeated notices: returns a function that answers true (and remembers `now`) when at least
 * `gapMs` passed since the last accepted call. The very first call is always accepted, whatever the clock says.
 * `force` always accepts (for notices that must show) and restarts the gap.
 */
export function makeThrottle(gapMs: number): (now: number, force?: boolean) => boolean {
  let last = -Infinity;
  return (now: number, force = false): boolean => {
    if (!force && now - last < gapMs) return false;
    last = now;
    return true;
  };
}

/**
 * The zoom the player last chose for `mode`, read defensively from stored data: 1 = whole board (an explicit
 * choice, e.g. the fit button), capped at 4. null when nothing valid is stored, so the board opens at `autoZoom`.
 */
export function storedZoom(raw: unknown, mode: ModeId): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const z = (raw as Record<string, unknown>)[mode];
  if (typeof z !== 'number' || !Number.isFinite(z) || z <= 0) return null;
  return Math.min(Math.max(z, 1), 4);
}

/** Tiles smaller than this (CSS px) are hard to hit with a finger. */
export const SMALL_CELL = 38;
/** Finger-sized tile (CSS px): the 44 px touch target. */
export const TOUCH_CELL = 44;

/**
 * Zoom a board opens at when the player has not chosen one for that size: the whole board, unless that makes the
 * tiles too small to tap reliably (expert, or hard on a small phone), then zoomed in until they reach `TOUCH_CELL`
 * (never beyond `zoomMax`). The fit button still shows the whole board, and that choice is remembered.
 */
export function autoZoom(baseCell: number, zoomMax: number): number {
  if (!(baseCell > 0) || baseCell >= SMALL_CELL) return 1;
  return Math.max(1, Math.min(zoomMax, TOUCH_CELL / baseCell));
}

// ── Saved games ───────────────────────────────────────────────────────────

export const SAVE_VERSION = 1;

/** An in-progress game as stored between sessions (plain JSON). */
export interface SaveData {
  v: number;
  mode: ModeId;
  /** Solved orientation of every tile. */
  solution: number[];
  /** Scrambled starting orientation. */
  start: number[];
  /** Current orientation. */
  tiles: number[];
  /** 1 = locked by the player or by a hint. */
  locked: number[];
  /** 1 = fixed by a hint (stays fixed when the board is reset). */
  hinted: number[];
  rotations: number;
  hints: number;
  /** Play time in milliseconds, without hint penalties. */
  elapsedMs: number;
}

/**
 * Validate untrusted stored data. Returns a clean copy, or null when anything is missing, out of range or
 * inconsistent (wrong board size for the mode, a solution that is not a valid network, tiles of the wrong shape).
 */
export function parseSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.v !== SAVE_VERSION || !isModeId(s.mode)) return null;
  const cfg = MODES[s.mode];
  const n = cfg.size * cfg.size;
  const list = (a: unknown, max: number): number[] | null =>
    Array.isArray(a) && a.length === n && a.every((v) => Number.isInteger(v) && v >= 0 && v <= max) ? (a as number[]).slice() : null;
  const solution = list(s.solution, 15);
  const start = list(s.start, 15);
  const tiles = list(s.tiles, 15);
  const locked = list(s.locked, 1);
  const hinted = list(s.hinted, 1);
  if (!solution || !start || !tiles || !locked || !hinted) return null;
  const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
  if (!count(s.rotations) || !count(s.hints)) return null;
  if (typeof s.elapsedMs !== 'number' || !Number.isFinite(s.elapsedMs) || s.elapsedMs < 0) return null;
  if (!isSolved(cfg.size, cfg.wrap, solution, sourceIndex(cfg.size))) return null;
  for (let i = 0; i < n; i++) {
    if (minRotations(start[i], solution[i]) < 0 || minRotations(tiles[i], solution[i]) < 0) return null;
  }
  return { v: SAVE_VERSION, mode: s.mode, solution, start, tiles, locked, hinted, rotations: s.rotations, hints: s.hints, elapsedMs: s.elapsedMs };
}

// ── Board view (zoom / pan) ───────────────────────────────────────────────

/**
 * Left (or top) offset of a board `boardPx` wide inside a viewport `viewPx` wide: centred when it fits,
 * otherwise clamped so that at most `margin` px of empty space shows at either edge.
 */
export function clampOffset(offset: number, boardPx: number, viewPx: number, margin: number): number {
  if (boardPx + 2 * margin <= viewPx) return (viewPx - boardPx) / 2;
  const lo = viewPx - margin - boardPx;
  const hi = margin;
  return offset < lo ? lo : offset > hi ? hi : offset;
}

/** New offset that keeps the board point under `focal` in place while the cell size changes `cell` -> `nextCell`. */
export function zoomOffset(offset: number, focal: number, cell: number, nextCell: number): number {
  if (cell <= 0) return offset;
  return focal - ((focal - offset) * nextCell) / cell;
}
