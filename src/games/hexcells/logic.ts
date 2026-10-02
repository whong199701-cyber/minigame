/**
 * Pure logic for Hex Logic (Hexcells-style deduction puzzle). No DOM access here so it can be unit tested.
 *
 * Grid: flat-top hexagons in an "odd-q" offset layout (odd columns are shoved half a cell down).
 * Every cell is either BLUE or EMPTY. A revealed empty cell shows how many of its (existing) neighbours are blue.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';
/** Which deduction rules the generator may rely on. 'basic' = satisfied / saturated / subset / global count. */
export type RuleLevel = 'basic' | 'advanced';

export interface DifficultyConfig {
  cols: number;
  rows: number;
  blueRatio: number;
  holeRatio: number;
  /** Random empty cells revealed before the solver-driven clue placement starts. */
  startClues: number;
  rules: RuleLevel;
  /** Reaching this many mistakes loses the round. */
  maxMistakes: number;
  /** Clue minimisation stops once this many givens are left (keeps easy boards friendly). */
  minGivens: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: { cols: 7, rows: 8, blueRatio: 0.25, holeRatio: 0.08, startClues: 3, rules: 'basic', maxMistakes: 4, minGivens: 6 },
  medium: { cols: 9, rows: 11, blueRatio: 0.27, holeRatio: 0.1, startClues: 3, rules: 'advanced', maxMistakes: 3, minGivens: 6 },
  hard: { cols: 11, rows: 13, blueRatio: 0.3, holeRatio: 0.12, startClues: 2, rules: 'advanced', maxMistakes: 3, minGivens: 7 },
};

export const HIDDEN = 0;
export const EMPTY = 1;
export const BLUE = 2;
export type CellState = typeof HIDDEN | typeof EMPTY | typeof BLUE;

export interface Cell {
  id: number;
  col: number;
  row: number;
}

export interface Puzzle {
  difficulty: Difficulty;
  seed: number;
  cols: number;
  rows: number;
  /** Existing cells only (holes are skipped). ids are indices into this array. */
  cells: Cell[];
  /** grid[col][row] → cell id, or -1 for a hole. */
  grid: number[][];
  /** Existing neighbour ids per cell. */
  neighbors: number[][];
  /** Solution. */
  blue: boolean[];
  /** Number of blue neighbours per cell (meaningful for empty cells). */
  clue: number[];
  /** Initially revealed (always empty) cells. */
  given: boolean[];
  totalBlue: number;
}

// ── Random ────────────────────────────────────────────────────────────────

/** mulberry32: small, fast, seedable PRNG. */
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

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Grid ──────────────────────────────────────────────────────────────────

const EVEN_Q: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [0, 1],
];
const ODD_Q: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** The six neighbour coordinates of (col,row) in odd-q layout (may be out of bounds). */
export function neighborCoords(col: number, row: number): [number, number][] {
  const d = col & 1 ? ODD_Q : EVEN_Q;
  return d.map(([dc, dr]) => [col + dc, row + dr]);
}

export interface GridShape {
  cells: Cell[];
  grid: number[][];
  neighbors: number[][];
}

/** Build the cell list, lookup grid and neighbour lists for a cols×rows board with optional holes. */
export function buildGrid(cols: number, rows: number, exists?: (col: number, row: number) => boolean): GridShape {
  const cells: Cell[] = [];
  const grid: number[][] = [];
  for (let c = 0; c < cols; c++) {
    grid.push(new Array<number>(rows).fill(-1));
    for (let r = 0; r < rows; r++) {
      if (exists && !exists(c, r)) continue;
      grid[c][r] = cells.length;
      cells.push({ id: cells.length, col: c, row: r });
    }
  }
  const neighbors = cells.map((cell) => {
    const out: number[] = [];
    for (const [nc, nr] of neighborCoords(cell.col, cell.row)) {
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const id = grid[nc][nr];
      if (id >= 0) out.push(id);
    }
    return out;
  });
  return { cells, grid, neighbors };
}

/**
 * Randomly remove about `ratio` of the cells so the silhouette is irregular. A removal is skipped when it would
 * leave one of its remaining neighbours with fewer than 2 neighbours (no lonely cells).
 */
export function carveHoles(cols: number, rows: number, ratio: number, rng: () => number): boolean[][] {
  const exists: boolean[][] = Array.from({ length: cols }, () => new Array<boolean>(rows).fill(true));
  const target = Math.round(cols * rows * ratio);
  const countNeighbors = (c: number, r: number): number => {
    let n = 0;
    for (const [nc, nr] of neighborCoords(c, r)) {
      if (nc >= 0 && nr >= 0 && nc < cols && nr < rows && exists[nc][nr]) n++;
    }
    return n;
  };
  let removed = 0;
  let attempts = 0;
  while (removed < target && attempts < target * 20) {
    attempts++;
    const c = Math.floor(rng() * cols);
    const r = Math.floor(rng() * rows);
    if (!exists[c][r]) continue;
    exists[c][r] = false;
    let ok = true;
    for (const [nc, nr] of neighborCoords(c, r)) {
      if (nc >= 0 && nr >= 0 && nc < cols && nr < rows && exists[nc][nr] && countNeighbors(nc, nr) < 2) {
        ok = false;
        break;
      }
    }
    if (ok) removed++;
    else exists[c][r] = true;
  }
  return exists;
}

/** Assemble a puzzle from explicit data (used by the generator and by tests). */
export function makePuzzle(
  cols: number,
  rows: number,
  exists: boolean[][] | null,
  blue: boolean[],
  given: boolean[],
  meta: { difficulty?: Difficulty; seed?: number } = {},
): Puzzle {
  const shape = buildGrid(cols, rows, exists ? (c, r) => exists[c][r] : undefined);
  if (blue.length !== shape.cells.length || given.length !== shape.cells.length) {
    throw new Error('blue/given arrays must match the number of existing cells');
  }
  const clue = shape.neighbors.map((ns) => ns.reduce((n, id) => n + (blue[id] ? 1 : 0), 0));
  let totalBlue = 0;
  for (let i = 0; i < blue.length; i++) {
    if (blue[i]) totalBlue++;
    if (given[i] && blue[i]) throw new Error('a given cell must be empty');
  }
  return {
    difficulty: meta.difficulty ?? 'easy',
    seed: meta.seed ?? 0,
    cols,
    rows,
    cells: shape.cells,
    grid: shape.grid,
    neighbors: shape.neighbors,
    blue,
    clue,
    given,
    totalBlue,
  };
}

// ── Player / solver state ────────────────────────────────────────────────

/** Fresh state: givens revealed, everything else hidden. */
export function initialState(puzzle: Puzzle): Uint8Array {
  const s = new Uint8Array(puzzle.cells.length);
  for (let i = 0; i < s.length; i++) s[i] = puzzle.given[i] ? EMPTY : HIDDEN;
  return s;
}

export function isComplete(state: Uint8Array): boolean {
  for (let i = 0; i < state.length; i++) if (state[i] === HIDDEN) return false;
  return true;
}

export function countHidden(state: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < state.length; i++) if (state[i] === HIDDEN) n++;
  return n;
}

/** Blue cells the player still has to find. */
export function remainingBlue(puzzle: Puzzle, state: Uint8Array): number {
  let found = 0;
  for (let i = 0; i < state.length; i++) if (state[i] === BLUE) found++;
  return puzzle.totalBlue - found;
}

/**
 * The player marks a hidden cell as blue (markBlue) or reveals it as empty. The cell is always resolved to its
 * true state; the return value says whether the player's claim was right.
 */
export function applyMark(puzzle: Puzzle, state: Uint8Array, id: number, markBlue: boolean): boolean {
  if (id < 0 || id >= state.length || state[id] !== HIDDEN) throw new Error('cell is not hidden');
  state[id] = puzzle.blue[id] ? BLUE : EMPTY;
  return puzzle.blue[id] === markBlue;
}

// ── Solver ────────────────────────────────────────────────────────────────

export interface Constraint {
  /** Hidden cells the constraint ranges over. */
  cells: number[];
  /** How many of them are blue. */
  need: number;
  /** Revealed cell id that provides the clue, or -1 for the global remaining-blue count. */
  source: number;
}

export type Rule = 'satisfied' | 'saturated' | 'subset' | 'overlap' | 'global';

export interface Deduction {
  cells: number[];
  blue: boolean;
  rule: Rule;
  /** Clue cells used (-1 = the global count). */
  sources: number[];
}

/** Every active constraint: one per revealed empty cell with hidden neighbours, plus the global count. */
export function buildConstraints(puzzle: Puzzle, state: Uint8Array): Constraint[] {
  const out: Constraint[] = [];
  for (let id = 0; id < state.length; id++) {
    if (state[id] !== EMPTY) continue;
    const hidden: number[] = [];
    let knownBlue = 0;
    for (const n of puzzle.neighbors[id]) {
      if (state[n] === HIDDEN) hidden.push(n);
      else if (state[n] === BLUE) knownBlue++;
    }
    if (hidden.length === 0) continue;
    out.push({ cells: hidden, need: puzzle.clue[id] - knownBlue, source: id });
  }
  const allHidden: number[] = [];
  for (let id = 0; id < state.length; id++) if (state[id] === HIDDEN) allHidden.push(id);
  if (allHidden.length > 0) out.push({ cells: allHidden, need: remainingBlue(puzzle, state), source: -1 });
  return out;
}

/**
 * One solver pass. Returns every deduction found (or only the first when `firstOnly`), in order of simplicity:
 * satisfied/saturated clues, the global count, then pairwise subset / overlap reasoning.
 */
export function solvePass(puzzle: Puzzle, state: Uint8Array, level: RuleLevel, firstOnly = false): Deduction[] {
  const cons = buildConstraints(puzzle, state);
  const out: Deduction[] = [];
  // Rules (a), (b), (d): a single constraint resolves all of its cells.
  for (const c of cons) {
    const isGlobal = c.source === -1;
    if (c.need === 0) {
      out.push({ cells: c.cells.slice(), blue: false, rule: isGlobal ? 'global' : 'satisfied', sources: [c.source] });
    } else if (c.need === c.cells.length) {
      out.push({ cells: c.cells.slice(), blue: true, rule: isGlobal ? 'global' : 'saturated', sources: [c.source] });
    }
    if (firstOnly && out.length) return out;
  }
  if (out.length) return out;

  // Rules (c) subset and (advanced) overlap: pairs of constraints that share hidden cells.
  const byCell = new Map<number, number[]>();
  cons.forEach((c, i) => {
    if (c.source === -1) return;
    for (const id of c.cells) {
      const list = byCell.get(id);
      if (list) list.push(i);
      else byCell.set(id, [i]);
    }
  });
  const globalIdx = cons.findIndex((c) => c.source === -1);
  const inB = new Uint8Array(state.length);
  for (let i = 0; i < cons.length; i++) {
    const A = cons[i];
    if (A.source === -1) continue; // global as the subset never deduces anything
    const partners = new Set<number>();
    for (const id of A.cells) for (const j of byCell.get(id) ?? []) if (j !== i) partners.add(j);
    if (globalIdx >= 0) partners.add(globalIdx);
    for (const j of partners) {
      const B = cons[j];
      for (const id of B.cells) inB[id] = 1;
      let aOnly = 0;
      let both = 0;
      for (const id of A.cells) {
        if (inB[id]) both++;
        else aOnly++;
      }
      const bOnlyCount = B.cells.length - both;
      if (both > 0 && bOnlyCount > 0 && (level === 'advanced' || aOnly === 0)) {
        const minI = Math.max(0, A.need - aOnly);
        const maxI = Math.min(A.need, B.need, both);
        const hi = B.need - minI; // most blues B can have outside A
        const lo = B.need - maxI; // fewest
        if (hi === 0 || lo === bOnlyCount) {
          const bOnly: number[] = [];
          for (const id of B.cells) if (!A.cells.includes(id)) bOnly.push(id);
          const rule: Rule = B.source === -1 ? 'global' : aOnly === 0 ? 'subset' : 'overlap';
          out.push({ cells: bOnly, blue: hi !== 0, rule, sources: [A.source, B.source] });
        }
      }
      for (const id of B.cells) inB[id] = 0;
      if (firstOnly && out.length) return out;
    }
  }
  return out;
}

/** The single simplest deduction available, or null when the solver is stuck. */
export function findDeduction(puzzle: Puzzle, state: Uint8Array, level: RuleLevel): Deduction | null {
  const d = solvePass(puzzle, state, level, true);
  return d.length ? d[0] : null;
}

export function applyDeduction(state: Uint8Array, d: Deduction): void {
  for (const id of d.cells) state[id] = d.blue ? BLUE : EMPTY;
}

/** Run the solver until it is stuck or done (mutates `state`). Returns true when every cell got resolved. */
export function solve(puzzle: Puzzle, state: Uint8Array, level: RuleLevel): boolean {
  for (;;) {
    const deds = solvePass(puzzle, state, level);
    if (deds.length === 0) break;
    for (const d of deds) applyDeduction(state, d);
    if (isComplete(state)) return true;
  }
  return isComplete(state);
}

/** Can the puzzle be solved from its givens with the given rule set and no guessing? */
export function isSolvable(puzzle: Puzzle, level: RuleLevel): boolean {
  return solve(puzzle, initialState(puzzle), level);
}

// ── Generation ────────────────────────────────────────────────────────────

/**
 * Generate a puzzle that the solver can finish from the givens with no guessing:
 * random blues → a few random clues → solve; when stuck reveal the hidden empty cell that unlocks the most,
 * repeat until solved; then drop every given that is not needed.
 */
export function generatePuzzle(difficulty: Difficulty, seed: number, opts: { minimize?: boolean } = {}): Puzzle {
  const cfg = DIFFICULTIES[difficulty];
  const rng = mulberry32(seed);
  for (let attempt = 0; attempt < 50; attempt++) {
    const exists = carveHoles(cfg.cols, cfg.rows, cfg.holeRatio, rng);
    const shape = buildGrid(cfg.cols, cfg.rows, (c, r) => exists[c][r]);
    const n = shape.cells.length;
    const nBlue = Math.max(1, Math.min(n - 1, Math.round(n * cfg.blueRatio)));
    const ids = shuffle(shape.cells.map((c) => c.id), rng);
    const blue = new Array<boolean>(n).fill(false);
    for (let i = 0; i < nBlue; i++) blue[ids[i]] = true;
    const given = new Array<boolean>(n).fill(false);
    const empties = shuffle(ids.filter((id) => !blue[id]), rng);
    for (let i = 0; i < Math.min(cfg.startClues, empties.length); i++) given[empties[i]] = true;

    const puzzle = makePuzzle(cfg.cols, cfg.rows, exists, blue, given, { difficulty, seed });
    const state = initialState(puzzle);
    let ok = true;
    for (let guard = 0; guard < n; guard++) {
      if (solve(puzzle, state, cfg.rules)) break;
      const best = pickClueCell(puzzle, state, cfg.rules, rng);
      if (best < 0) {
        ok = false;
        break;
      }
      puzzle.given[best] = true;
      state[best] = EMPTY;
    }
    if (!ok || !isComplete(state)) continue;
    if (opts.minimize !== false) minimizeGivens(puzzle, cfg.rules, rng, cfg.minGivens);
    return puzzle;
  }
  throw new Error('could not generate a puzzle');
}

/** Hidden empty cell whose reveal unlocks the most deductions (ties broken randomly). -1 if none. */
function pickClueCell(puzzle: Puzzle, state: Uint8Array, level: RuleLevel, rng: () => number): number {
  const cons = buildConstraints(puzzle, state);
  const participation = new Map<number, number>();
  for (const c of cons) {
    if (c.source === -1) continue;
    for (const id of c.cells) participation.set(id, (participation.get(id) ?? 0) + 1);
  }
  const candidates: number[] = [];
  for (let id = 0; id < state.length; id++) if (state[id] === HIDDEN && !puzzle.blue[id]) candidates.push(id);
  if (candidates.length === 0) return -1;
  shuffle(candidates, rng);
  candidates.sort((a, b) => (participation.get(b) ?? 0) - (participation.get(a) ?? 0));
  const top = candidates.slice(0, 10);
  let best = top[0];
  let bestScore = -1;
  for (const id of top) {
    const trial = state.slice();
    trial[id] = EMPTY;
    const deds = solvePass(puzzle, trial, level);
    const resolved = new Set<number>();
    for (const d of deds) for (const c of d.cells) resolved.add(c);
    // Favour clues that unlock cells; break ties towards clues that touch more constraints.
    const score = resolved.size * 10 + (participation.get(id) ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/** Remove givens that are not required for solvability, keeping at least `keep` (mutates puzzle.given). */
export function minimizeGivens(puzzle: Puzzle, level: RuleLevel, rng: () => number, keep = 0): void {
  const givens: number[] = [];
  for (let id = 0; id < puzzle.given.length; id++) if (puzzle.given[id]) givens.push(id);
  shuffle(givens, rng);
  let count = givens.length;
  for (const id of givens) {
    if (count <= keep) break;
    puzzle.given[id] = false;
    if (isSolvable(puzzle, level)) count--;
    else puzzle.given[id] = true;
  }
}

// ── Geometry (pure, so the hit-test can be unit tested) ──────────────────

export const SQRT3 = Math.sqrt(3);

export interface Layout {
  /** Hex circumradius in CSS px. */
  size: number;
  /** Origin so that cell (0,0)'s centre sits at (ox, oy). */
  ox: number;
  oy: number;
}

/** Centre of a cell in units of the circumradius. */
export function cellUnits(col: number, row: number): { ux: number; uy: number } {
  return { ux: 1.5 * col, uy: SQRT3 * (row + (col & 1 ? 0.5 : 0)) };
}

/** Fit the puzzle's existing cells into a w×h box with a margin, centred. */
export function layoutGrid(puzzle: Puzzle, w: number, h: number, margin: number, maxSize = 44): Layout {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of puzzle.cells) {
    const { ux, uy } = cellUnits(c.col, c.row);
    if (ux < minX) minX = ux;
    if (ux > maxX) maxX = ux;
    if (uy < minY) minY = uy;
    if (uy > maxY) maxY = uy;
  }
  if (!isFinite(minX)) return { size: 10, ox: w / 2, oy: h / 2 };
  const unitsW = maxX - minX + 2;
  const unitsH = maxY - minY + SQRT3;
  const size = Math.max(4, Math.min(maxSize, (w - 2 * margin) / unitsW, (h - 2 * margin) / unitsH));
  const ox = (w - unitsW * size) / 2 + size - minX * size;
  const oy = (h - unitsH * size) / 2 + (SQRT3 / 2) * size - minY * size;
  return { size, ox, oy };
}

export function cellCenter(col: number, row: number, L: Layout): { x: number; y: number } {
  const { ux, uy } = cellUnits(col, row);
  return { x: L.ox + ux * L.size, y: L.oy + uy * L.size };
}

/** Is the point inside a flat-top hexagon of circumradius r centred at (cx, cy)? */
export function insideHex(px: number, py: number, cx: number, cy: number, r: number): boolean {
  const dx = Math.abs(px - cx);
  const dy = Math.abs(py - cy);
  const hh = (SQRT3 / 2) * r;
  if (dy > hh || dx > r) return false;
  return hh * dx + (r / 2) * dy <= hh * r + 1e-9;
}

/** The cell id under a point, or -1. */
export function pickCell(puzzle: Puzzle, L: Layout, px: number, py: number): number {
  let best = -1;
  let bestD = Infinity;
  for (const c of puzzle.cells) {
    const { x, y } = cellCenter(c.col, c.row, L);
    const d = (x - px) * (x - px) + (y - py) * (y - py);
    if (d < bestD) {
      bestD = d;
      best = c.id;
    }
  }
  if (best < 0) return -1;
  const { x, y } = cellCenter(puzzle.cells[best].col, puzzle.cells[best].row, L);
  return insideHex(px, py, x, y, L.size) ? best : -1;
}

/** Vertices of a flat-top hexagon. */
export function hexPoints(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
