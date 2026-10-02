/**
 * Killer Sudoku — pure logic: full-grid generation, random cage partition, a bitmask solver with
 * cage-sum pruning (used for the uniqueness check), and small helpers for the UI. No DOM access.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Rng = () => number;

export interface Cage {
  /** Cell indices (0..80), sorted ascending — cells[0] is the label cell. */
  cells: number[];
  sum: number;
}

export interface Puzzle {
  /** 81 digits 1–9. */
  solution: number[];
  cages: Cage[];
  /** 81 entries, 0 = empty, otherwise a fixed digit. */
  givens: number[];
}

export interface DifficultyConfig {
  minCage: number;
  maxCage: number;
  /** Index = cage size, value = relative weight. */
  sizeWeights: number[];
  /** Number of given digits placed before the uniqueness check. */
  givens: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: { minCage: 1, maxCage: 3, sizeWeights: [0, 1, 6, 4], givens: 12 },
  medium: { minCage: 2, maxCage: 4, sizeWeights: [0, 0, 4, 4, 2], givens: 4 },
  hard: { minCage: 2, maxCage: 5, sizeWeights: [0, 0, 3, 4, 3, 1], givens: 0 },
};

export const CELLS = 81;
export const ALL = 0x1ff;

export function rowOf(i: number): number {
  return (i / 9) | 0;
}
export function colOf(i: number): number {
  return i % 9;
}
export function boxOf(i: number): number {
  return ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);
}
export function bit(d: number): number {
  return 1 << (d - 1);
}

const POP = new Uint8Array(512);
for (let i = 1; i < 512; i++) POP[i] = POP[i >> 1] + (i & 1);

export function popcount(mask: number): number {
  return POP[mask & ALL];
}

export function maskToDigits(mask: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= 9; d++) if (mask & bit(d)) out.push(d);
  return out;
}

/** Deterministic PRNG (mulberry32) so puzzles and tests are reproducible. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rand: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Orthogonal neighbours of a cell. */
export function neighbors(i: number): number[] {
  const r = rowOf(i);
  const c = colOf(i);
  const out: number[] = [];
  if (r > 0) out.push(i - 9);
  if (r < 8) out.push(i + 9);
  if (c > 0) out.push(i - 1);
  if (c < 8) out.push(i + 1);
  return out;
}

// ── Full grid generation ─────────────────────────────────────────────────

/** Random complete sudoku grid via MRV backtracking with shuffled candidates. */
export function generateSolution(rand: Rng = Math.random): number[] {
  const grid = new Uint8Array(CELLS);
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);
  const search = (): boolean => {
    let best = -1;
    let bestMask = 0;
    let bestN = 10;
    for (let i = 0; i < CELLS; i++) {
      if (grid[i]) continue;
      const m = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = POP[m];
      if (n < bestN) {
        bestN = n;
        best = i;
        bestMask = m;
        if (n <= 1) break;
      }
    }
    if (best < 0) return true;
    if (bestN === 0) return false;
    const digits = shuffleInPlace(maskToDigits(bestMask), rand);
    const r = rowOf(best);
    const c = colOf(best);
    const b = boxOf(best);
    for (const d of digits) {
      const bd = bit(d);
      grid[best] = d;
      rows[r] |= bd;
      cols[c] |= bd;
      boxes[b] |= bd;
      if (search()) return true;
      grid[best] = 0;
      rows[r] &= ~bd;
      cols[c] &= ~bd;
      boxes[b] &= ~bd;
    }
    return false;
  };
  search();
  return Array.from(grid);
}

/** True when every row, column and box holds exactly the digits 1–9. */
export function isValidGrid(grid: number[]): boolean {
  if (grid.length !== CELLS) return false;
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);
  for (let i = 0; i < CELLS; i++) {
    const d = grid[i];
    if (!(d >= 1 && d <= 9)) return false;
    const bd = bit(d);
    const r = rowOf(i);
    const c = colOf(i);
    const b = boxOf(i);
    if (rows[r] & bd || cols[c] & bd || boxes[b] & bd) return false;
    rows[r] |= bd;
    cols[c] |= bd;
    boxes[b] |= bd;
  }
  return true;
}

// ── Cage partition ───────────────────────────────────────────────────────

function pickSize(cfg: DifficultyConfig, rand: Rng): number {
  let total = 0;
  for (let s = cfg.minCage; s <= cfg.maxCage; s++) total += cfg.sizeWeights[s] ?? 0;
  let x = rand() * total;
  for (let s = cfg.minCage; s <= cfg.maxCage; s++) {
    x -= cfg.sizeWeights[s] ?? 0;
    if (x < 0) return s;
  }
  return cfg.maxCage;
}

function digitsOf(cells: number[], solution: number[]): number {
  let m = 0;
  for (const c of cells) m |= bit(solution[c]);
  return m;
}

/**
 * Random region growth over the cells marked free (cageOf < 0); other cells keep their cages.
 * `marked` cells (used to break an ambiguity) may never share a cage. Returns the number of cages
 * that stayed below the minimum size because no legal merge existed.
 */
function growCages(
  solution: number[],
  cfg: DifficultyConfig,
  rand: Rng,
  cageOf: Int16Array,
  groups: number[][],
  marked: Uint8Array | null,
): number {
  // marked[c] === 2: anchor — its cage may hold no other marked cell. marked[c] === 1: may share a
  // cage with other 1-cells but never with an anchor.
  const marksOf = (cells: number[]): { anchors: number; marks: number } => {
    let anchors = 0;
    let marks = 0;
    if (marked) {
      for (const c of cells) {
        if (marked[c] === 2) anchors++;
        if (marked[c]) marks++;
      }
    }
    return { anchors, marks };
  };
  const canJoin = (a: { anchors: number; marks: number }, b: { anchors: number; marks: number }): boolean =>
    !(a.anchors && b.marks) && !(b.anchors && a.marks);
  const order: number[] = [];
  for (let i = 0; i < CELLS; i++) if (cageOf[i] < 0) order.push(i);
  shuffleInPlace(order, rand);
  for (const start of order) {
    if (cageOf[start] >= 0) continue;
    const id = groups.length;
    const target = pickSize(cfg, rand);
    const cells = [start];
    cageOf[start] = id;
    let digits = bit(solution[start]);
    const mk = marksOf(cells);
    while (cells.length < target) {
      const frontier: number[] = [];
      for (const c of cells) {
        for (const nb of neighbors(c)) {
          if (cageOf[nb] >= 0 || digits & bit(solution[nb]) || frontier.includes(nb)) continue;
          if (marked && marked[nb] && !canJoin(mk, marksOf([nb]))) continue;
          frontier.push(nb);
        }
      }
      if (!frontier.length) break;
      const pick = frontier[(rand() * frontier.length) | 0];
      cells.push(pick);
      cageOf[pick] = id;
      digits |= bit(solution[pick]);
      if (marked && marked[pick]) {
        mk.marks++;
        if (marked[pick] === 2) mk.anchors++;
      }
    }
    groups.push(cells);
  }
  // Merge cages that ended up smaller than the minimum into a neighbouring cage when legal.
  let undersized = 0;
  for (let id = 0; id < groups.length; id++) {
    const cells = groups[id];
    if (cells.length === 0 || cells.length >= cfg.minCage) continue;
    const mine = digitsOf(cells, solution);
    const myMarks = marksOf(cells);
    let target = -1;
    let targetSize = Infinity;
    for (const c of cells) {
      for (const nb of neighbors(c)) {
        const other = cageOf[nb];
        if (other < 0 || other === id) continue;
        const oc = groups[other];
        if (oc.length + cells.length > cfg.maxCage) continue;
        if (digitsOf(oc, solution) & mine) continue;
        if (marked && !canJoin(myMarks, marksOf(oc))) continue;
        if (oc.length < targetSize) {
          targetSize = oc.length;
          target = other;
        }
      }
    }
    if (target >= 0) {
      groups[target].push(...cells);
      for (const c of cells) cageOf[c] = target;
      groups[id] = [];
    } else {
      undersized++;
    }
  }
  return undersized;
}

function toCages(groups: number[][], solution: number[]): Cage[] {
  const cages: Cage[] = [];
  for (const g of groups) {
    if (!g.length) continue;
    const cells = g.slice().sort((a, b) => a - b);
    cages.push({ cells, sum: cells.reduce((s, c) => s + solution[c], 0) });
  }
  return cages;
}

/**
 * Partition the grid into cages by random region growth. Cages never repeat a digit (growth stops
 * before adding a duplicate). Retries a few times to avoid cages below the minimum size.
 */
export function partitionCages(solution: number[], cfg: DifficultyConfig, rand: Rng = Math.random, maxTries = 40): Cage[] {
  let best: Cage[] | null = null;
  let bestBad = Infinity;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const cageOf = new Int16Array(CELLS).fill(-1);
    const groups: number[][] = [];
    const undersized = growCages(solution, cfg, rand, cageOf, groups, null);
    const cages = toCages(groups, solution);
    if (undersized === 0) return cages;
    if (undersized < bestBad) {
      bestBad = undersized;
      best = cages;
    }
  }
  return best as Cage[];
}

/**
 * Re-partition locally: every cage touching one of `cells` is dissolved and the freed region is
 * re-grown so that no two of those cells share a cage. Used to break a second solution (the cells
 * where two solutions differ) without adding givens. When the freed region is too tight to respect
 * the minimum cage size, the ring of neighbouring cages is dissolved as well and growth is retried.
 */
export function repartitionAround(solution: number[], cages: Cage[], cfg: DifficultyConfig, cells: number[], rand: Rng = Math.random, triesPerLevel = 6): Cage[] {
  const idx = cageIndex(cages);
  const marked = new Uint8Array(CELLS);
  for (const c of cells) marked[c] = 1;
  // Anchors: cells that must end up alone (among the differing cells) in their cage. A cage holding
  // exactly one differing cell changes its sum under the alternative solution, which kills it. Small
  // sets are separated completely; large sets (e.g. two swapped columns) get two random anchors.
  const anchors = cells.length <= 6 ? cells.slice() : shuffleInPlace(cells.slice(), rand).slice(0, 2);
  for (const c of anchors) marked[c] = 2;
  const dissolve = new Set<number>();
  for (const c of anchors) dissolve.add(idx[c]);
  let best: Cage[] | null = null;
  let bestBad = Infinity;
  for (let level = 0; level < 3; level++) {
    if (level > 0) {
      // Expand: dissolve every cage adjacent to the currently dissolved region.
      const extra = new Set<number>();
      for (const k of dissolve) for (const c of cages[k].cells) for (const nb of neighbors(c)) if (!dissolve.has(idx[nb])) extra.add(idx[nb]);
      extra.forEach((k) => dissolve.add(k));
    }
    for (let attempt = 0; attempt < triesPerLevel; attempt++) {
      const cageOf = new Int16Array(CELLS).fill(-1);
      const groups: number[][] = [];
      cages.forEach((cg, k) => {
        if (dissolve.has(k)) return;
        const id = groups.length;
        groups.push(cg.cells.slice());
        for (const c of cg.cells) cageOf[c] = id;
      });
      const undersized = growCages(solution, cfg, rand, cageOf, groups, marked);
      const result = toCages(groups, solution);
      if (undersized === 0) return result;
      if (undersized < bestBad) {
        bestBad = undersized;
        best = result;
      }
    }
  }
  return best as Cage[];
}

/** Cell index → cage index. */
export function cageIndex(cages: Cage[]): Int16Array {
  const idx = new Int16Array(CELLS).fill(-1);
  cages.forEach((cg, k) => cg.cells.forEach((c) => (idx[c] = k)));
  return idx;
}

export const BORDER_TOP = 1;
export const BORDER_RIGHT = 2;
export const BORDER_BOTTOM = 4;
export const BORDER_LEFT = 8;

/** Per-cell bit flags marking the sides where the cage boundary runs (neighbour in another cage or grid edge). */
export function cageBorderFlags(cages: Cage[]): Uint8Array {
  const idx = cageIndex(cages);
  const flags = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    const r = rowOf(i);
    const c = colOf(i);
    let f = 0;
    if (r === 0 || idx[i - 9] !== idx[i]) f |= BORDER_TOP;
    if (c === 8 || idx[i + 1] !== idx[i]) f |= BORDER_RIGHT;
    if (r === 8 || idx[i + 9] !== idx[i]) f |= BORDER_BOTTOM;
    if (c === 0 || idx[i - 1] !== idx[i]) f |= BORDER_LEFT;
    flags[i] = f;
  }
  return flags;
}

// ── Cage combination table ───────────────────────────────────────────────

const COMBO_MEMO = new Uint16Array(10 * 46 * 512);

function enumerateCombos(k: number, s: number, avail: number, onCombo: (digits: number[]) => void): void {
  const digits = maskToDigits(avail);
  const chosen: number[] = [];
  const go = (start: number, left: number, rem: number): void => {
    if (left === 0) {
      if (rem === 0) onCombo(chosen.slice());
      return;
    }
    for (let i = start; i < digits.length; i++) {
      const d = digits[i];
      if (d > rem) break;
      // Smallest possible sum with d plus the next (left-1) digits.
      let minRest = 0;
      for (let j = 1; j < left; j++) minRest += digits[i + j] ?? 99;
      if (d + minRest > rem) break;
      chosen.push(d);
      go(i + 1, left - 1, rem - d);
      chosen.pop();
    }
  };
  go(0, k, s);
}

/**
 * Union of digits that can appear in some set of `k` distinct digits drawn from `avail` summing to `s`.
 * Memoised; returns 0 when no combination exists.
 */
export function comboMask(k: number, s: number, avail: number): number {
  if (k < 0 || k > 9 || s < 0 || s > 45) return 0;
  if (k === 0) return 0;
  const key = (k * 46 + s) * 512 + (avail & ALL);
  const cached = COMBO_MEMO[key];
  if (cached) return cached - 1;
  let mask = 0;
  enumerateCombos(k, s, avail & ALL, (digits) => {
    for (const d of digits) mask |= bit(d);
  });
  COMBO_MEMO[key] = mask + 1;
  return mask;
}

/** All ways to fill `k` cells with distinct digits from `avail` summing to `s` (sorted ascending). */
export function cageCombos(k: number, s: number, avail: number = ALL): number[][] {
  if (k <= 0 || k > 9 || s <= 0) return [];
  const out: number[][] = [];
  enumerateCombos(k, s, avail & ALL, (d) => out.push(d));
  return out;
}

// ── Sum groups (cages + 45-rule "innies"/"outies") ───────────────────────

export interface SumGroup {
  cells: number[];
  sum: number;
  /** Digits inside the group cannot repeat (cages, or cells sharing one unit). */
  distinct: boolean;
}

function sameUnit(cells: number[]): boolean {
  const r = rowOf(cells[0]);
  const c = colOf(cells[0]);
  const b = boxOf(cells[0]);
  return cells.every((i) => rowOf(i) === r) || cells.every((i) => colOf(i) === c) || cells.every((i) => boxOf(i) === b);
}

/** Unions of complete units (rows ranges, column ranges, boxes and box blocks) used for the 45 rule. */
function unitUnions(): number[][] {
  const unions: number[][] = [];
  for (let a = 0; a < 9; a++) {
    for (let b = a; b < 9; b++) {
      const rows: number[] = [];
      const cols: number[] = [];
      for (let k = a; k <= b; k++) for (let j = 0; j < 9; j++) rows.push(k * 9 + j), cols.push(j * 9 + k);
      if (b - a < 8) unions.push(rows, cols);
    }
  }
  const boxCells = (bx: number): number[] => {
    const out: number[] = [];
    const r0 = ((bx / 3) | 0) * 3;
    const c0 = (bx % 3) * 3;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push((r0 + r) * 9 + c0 + c);
    return out;
  };
  for (let bx = 0; bx < 9; bx++) unions.push(boxCells(bx));
  for (let bx = 0; bx < 9; bx++) {
    if (bx % 3 < 2) unions.push([...boxCells(bx), ...boxCells(bx + 1)]);
    if (bx < 6) unions.push([...boxCells(bx), ...boxCells(bx + 3)]);
    if (bx % 3 < 2 && bx < 6) unions.push([...boxCells(bx), ...boxCells(bx + 1), ...boxCells(bx + 3), ...boxCells(bx + 4)]);
  }
  return unions;
}

const UNIONS = unitUnions();

/**
 * Derive extra sum constraints from the 45 rule: for every union of complete units, the cells of
 * cages that stick out (innies) and the outside cells of those cages (outies) have a known sum.
 */
export function derivedGroups(cages: Cage[], maxCells = 6): SumGroup[] {
  const idx = cageIndex(cages);
  const seen = new Set<string>(cages.map((cg) => cg.cells.join(',')));
  const out: SumGroup[] = [];
  const add = (cells: number[], sum: number): void => {
    if (!cells.length || cells.length > maxCells) return;
    cells.sort((a, b) => a - b);
    const key = cells.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ cells, sum, distinct: sameUnit(cells) });
  };
  const inU = new Uint8Array(CELLS);
  for (const U of UNIONS) {
    inU.fill(0);
    for (const c of U) inU[c] = 1;
    const touched = new Set<number>();
    for (const c of U) touched.add(idx[c]);
    const innies: number[] = [];
    const outies: number[] = [];
    let fullSum = 0;
    let partialSum = 0;
    for (const g of touched) {
      const cg = cages[g];
      let inside = 0;
      for (const c of cg.cells) if (inU[c]) inside++;
      if (inside === cg.cells.length) {
        fullSum += cg.sum;
      } else {
        partialSum += cg.sum;
        for (const c of cg.cells) (inU[c] ? innies : outies).push(c);
      }
    }
    const innieSum = (U.length / 9) * 45 - fullSum;
    add(innies, innieSum);
    add(outies, partialSum - innieSum);
  }
  return out;
}

// ── Solver ───────────────────────────────────────────────────────────────

export interface SolveOptions {
  /** Stop after this many solutions (default 2 → enough to prove uniqueness). */
  limit?: number;
  /** Absolute timestamp (ms) after which the search aborts. */
  deadline?: number;
  maxNodes?: number;
  now?: () => number;
  /** Skip the derived 45-rule groups (slower; for tests). */
  noDerived?: boolean;
}

export interface SolveResult {
  count: number;
  /** First solution found, if any. */
  solution: number[] | null;
  /** Up to `limit` distinct solutions found. */
  solutions: number[][];
  /** True when the search hit its node/time budget before finishing. */
  aborted: boolean;
  nodes: number;
}

/** Digits a single cell may take inside a non-distinct group with `cnt` open cells summing to `rem`. */
const RANGE = new Uint16Array(10 * 128);
for (let cnt = 1; cnt <= 9; cnt++) {
  for (let rem = 0; rem < 128; rem++) {
    const lo = Math.max(1, rem - 9 * (cnt - 1));
    const hi = Math.min(9, rem - (cnt - 1));
    let m = 0;
    for (let d = lo; d <= hi; d++) m |= bit(d);
    RANGE[cnt * 128 + rem] = m;
  }
}

/** Cells of the 27 units: rows 0–8, columns 9–17, boxes 18–26 (9 cells each). */
const UNIT_CELLS = new Uint8Array(27 * 9);
for (let k = 0; k < 9; k++) {
  for (let j = 0; j < 9; j++) {
    UNIT_CELLS[k * 9 + j] = k * 9 + j;
    UNIT_CELLS[(9 + k) * 9 + j] = j * 9 + k;
    UNIT_CELLS[(18 + k) * 9 + j] = ((k / 3) | 0) * 27 + (k % 3) * 3 + ((j / 3) | 0) * 9 + (j % 3);
  }
}

interface SolverState {
  grid: Uint8Array;
  rows: Uint16Array;
  cols: Uint16Array;
  boxes: Uint16Array;
  /** Flattened per-cell group lists: cellGroups[cellStart[i] .. cellStart[i+1]) */
  cellStart: Int32Array;
  cellGroups: Int16Array;
  /** Cells of every group (cages first, then derived). */
  groupCells: number[][];
  /** Ids of distinct groups (candidates for the small-group consistency pass). */
  distinctIds: number[];
  distinct: Uint8Array;
  used: Uint16Array;
  rem: Int16Array;
  cnt: Uint8Array;
}

function makeState(cages: Cage[], noDerived = false): SolverState {
  const groups: SumGroup[] = cages.map((cg) => ({ cells: cg.cells, sum: cg.sum, distinct: true }));
  if (!noDerived) groups.push(...derivedGroups(cages));
  const lists: number[][] = Array.from({ length: CELLS }, () => []);
  groups.forEach((g, k) => g.cells.forEach((c) => lists[c].push(k)));
  const cellStart = new Int32Array(CELLS + 1);
  for (let i = 0; i < CELLS; i++) cellStart[i + 1] = cellStart[i] + lists[i].length;
  const cellGroups = new Int16Array(cellStart[CELLS]);
  for (let i = 0; i < CELLS; i++) lists[i].forEach((g, j) => (cellGroups[cellStart[i] + j] = g));
  const st: SolverState = {
    grid: new Uint8Array(CELLS),
    rows: new Uint16Array(9),
    cols: new Uint16Array(9),
    boxes: new Uint16Array(9),
    cellStart,
    cellGroups,
    groupCells: groups.map((g) => g.cells),
    distinctIds: groups.map((g, k) => (g.distinct ? k : -1)).filter((k) => k >= 0),
    distinct: new Uint8Array(groups.length),
    used: new Uint16Array(groups.length),
    rem: new Int16Array(groups.length),
    cnt: new Uint8Array(groups.length),
  };
  groups.forEach((g, k) => {
    st.distinct[k] = g.distinct ? 1 : 0;
    st.rem[k] = g.sum;
    st.cnt[k] = g.cells.length;
  });
  return st;
}

function candidates(st: SolverState, i: number): number {
  let m = ALL & ~(st.rows[rowOf(i)] | st.cols[colOf(i)] | st.boxes[boxOf(i)]);
  for (let p = st.cellStart[i], e = st.cellStart[i + 1]; p < e && m; p++) {
    const g = st.cellGroups[p];
    const rem = st.rem[g];
    if (rem < 0 || rem > 127) return 0;
    if (st.distinct[g]) {
      const used = st.used[g];
      m &= ~used & comboMask(st.cnt[g], rem, ALL & ~used);
    } else {
      m &= RANGE[st.cnt[g] * 128 + rem];
    }
  }
  return m;
}

function placeDigit(st: SolverState, i: number, d: number): void {
  const bd = bit(d);
  st.grid[i] = d;
  st.rows[rowOf(i)] |= bd;
  st.cols[colOf(i)] |= bd;
  st.boxes[boxOf(i)] |= bd;
  for (let p = st.cellStart[i], e = st.cellStart[i + 1]; p < e; p++) {
    const g = st.cellGroups[p];
    st.used[g] |= bd;
    st.rem[g] -= d;
    st.cnt[g]--;
  }
}

function removeDigit(st: SolverState, i: number): void {
  const d = st.grid[i];
  const bd = bit(d);
  st.grid[i] = 0;
  st.rows[rowOf(i)] &= ~bd;
  st.cols[colOf(i)] &= ~bd;
  st.boxes[boxOf(i)] &= ~bd;
  for (let p = st.cellStart[i], e = st.cellStart[i + 1]; p < e; p++) {
    const g = st.cellGroups[p];
    st.used[g] &= ~bd;
    st.rem[g] += d;
    st.cnt[g]++;
  }
}

/** Places the givens; returns false when they already contradict each other. */
function applyGivens(st: SolverState, givens: number[]): boolean {
  for (let i = 0; i < CELLS; i++) {
    const d = givens[i];
    if (!d) continue;
    if (!(candidates(st, i) & bit(d))) return false;
    placeDigit(st, i, d);
  }
  return true;
}

/**
 * Backtracking solver: MRV cell choice, bitmask elimination for row/column/box, cage digit
 * uniqueness, cage-sum feasibility through the combination table and the derived 45-rule groups.
 * Counts solutions up to `limit`.
 */
export function countSolutions(cages: Cage[], givens: number[], opts: SolveOptions = {}): SolveResult {
  const limit = opts.limit ?? 2;
  const maxNodes = opts.maxNodes ?? 2_000_000;
  const now = opts.now ?? Date.now;
  const deadline = opts.deadline ?? Infinity;
  const st = makeState(cages, opts.noDerived);
  const res: SolveResult = { count: 0, solution: null, solutions: [], aborted: false, nodes: 0 };
  if (!applyGivens(st, givens)) return res;
  const masks = new Uint16Array(CELLS);

  const search = (): void => {
    res.nodes++;
    if ((res.nodes & 63) === 0 && (res.nodes > maxNodes || now() > deadline)) {
      res.aborted = true;
      return;
    }
    for (let i = 0; i < CELLS; i++) masks[i] = st.grid[i] ? 0 : candidates(st, i);
    // Pair / triple consistency inside distinct groups with 2–3 open cells: a digit survives only
    // when the other open cells can still complete the remaining sum with distinct digits.
    for (const g of st.distinctIds) {
      const k = st.cnt[g];
      if (k !== 2 && k !== 3) continue;
      const r = st.rem[g];
      let a = -1;
      let b = -1;
      let c = -1;
      for (const cell of st.groupCells[g]) {
        if (st.grid[cell]) continue;
        if (a < 0) a = cell;
        else if (b < 0) b = cell;
        else c = cell;
      }
      const ma = masks[a];
      const mb = masks[b];
      let na = 0;
      let nb = 0;
      if (k === 2) {
        for (let d = 1; d <= 9; d++) {
          if (!(ma & bit(d))) continue;
          const e = r - d;
          if (e >= 1 && e <= 9 && e !== d && mb & bit(e)) {
            na |= bit(d);
            nb |= bit(e);
          }
        }
        masks[a] = na;
        masks[b] = nb;
      } else {
        const mc = masks[c];
        let nc = 0;
        for (let d = 1; d <= 9; d++) {
          if (!(ma & bit(d))) continue;
          for (let e = 1; e <= 9; e++) {
            if (e === d || !(mb & bit(e))) continue;
            const f = r - d - e;
            if (f < 1 || f > 9 || f === d || f === e || !(mc & bit(f))) continue;
            na |= bit(d);
            nb |= bit(e);
            nc |= bit(f);
          }
        }
        masks[a] = na;
        masks[b] = nb;
        masks[c] = nc;
      }
    }
    let best = -1;
    let bestMask = 0;
    let bestN = 10;
    for (let i = 0; i < CELLS; i++) {
      if (st.grid[i]) continue;
      const n = POP[masks[i]];
      if (n < bestN) {
        bestN = n;
        best = i;
        bestMask = masks[i];
        if (n === 0) break;
      }
    }
    if (best < 0) {
      res.count++;
      const sol = Array.from(st.grid);
      if (!res.solution) res.solution = sol;
      res.solutions.push(sol);
      return;
    }
    if (bestN === 0) return;
    if (bestN > 1) {
      // Hidden singles: a digit with exactly one home in a unit is forced; with none, dead end.
      for (let u = 0; u < 27 && bestN > 1; u++) {
        const base = u * 9;
        const placed = u < 9 ? st.rows[u] : u < 18 ? st.cols[u - 9] : st.boxes[u - 18];
        let missing = ALL & ~placed;
        while (missing) {
          const bd = missing & -missing;
          missing ^= bd;
          let where = -1;
          let n = 0;
          for (let j = 0; j < 9; j++) {
            const i = UNIT_CELLS[base + j];
            if (masks[i] & bd) {
              n++;
              where = i;
              if (n > 1) break;
            }
          }
          if (n === 0) return;
          if (n === 1) {
            best = where;
            bestMask = bd;
            bestN = 1;
            break;
          }
        }
      }
    }
    for (let d = 1; d <= 9; d++) {
      if (!(bestMask & bit(d))) continue;
      placeDigit(st, best, d);
      search();
      removeDigit(st, best);
      if (res.count >= limit || res.aborted) return;
    }
  };
  search();
  return res;
}

/** Candidate mask per cell for the current (possibly partial / inconsistent) values. Filled cells get 0. */
export function candidateMasks(cages: Cage[], values: number[]): Uint16Array {
  const st = makeState(cages);
  for (let i = 0; i < CELLS; i++) if (values[i]) placeDigit(st, i, values[i]);
  const out = new Uint16Array(CELLS);
  for (let i = 0; i < CELLS; i++) out[i] = values[i] ? 0 : candidates(st, i);
  return out;
}

/** True when `values` is a complete grid satisfying sudoku rules and every cage (sum + no repeats). */
export function satisfies(values: number[], cages: Cage[]): boolean {
  if (!isValidGrid(values)) return false;
  for (const cg of cages) {
    let sum = 0;
    let mask = 0;
    for (const c of cg.cells) {
      const d = values[c];
      if (mask & bit(d)) return false;
      mask |= bit(d);
      sum += d;
    }
    if (sum !== cg.sum) return false;
  }
  return true;
}

// ── Puzzle generation ────────────────────────────────────────────────────

export interface GenerateOptions {
  /** Soft total budget in ms (default 1500). Generation always ends with a unique puzzle. */
  timeBudgetMs?: number;
  now?: () => number;
}

export interface GenerateStats {
  ms: number;
  /** Local cage repairs performed to remove alternative solutions. */
  repairs: number;
  /** Givens added beyond the difficulty's base count (only when the time budget ran out). */
  addedGivens: number;
  /** Nodes searched by the final (successful) uniqueness proof. */
  proofNodes: number;
}

function pickGiven(cages: Cage[], givens: number[], solution: number[], rand: Rng): boolean {
  const masks = candidateMasks(cages, givens);
  let pick = -1;
  let pickN = -1;
  let ties = 0;
  for (let i = 0; i < CELLS; i++) {
    if (givens[i]) continue;
    const n = POP[masks[i]];
    if (n > pickN) {
      pickN = n;
      pick = i;
      ties = 1;
    } else if (n === pickN && rand() * ++ties < 1) {
      pick = i;
    }
  }
  if (pick < 0) return false;
  givens[pick] = solution[pick];
  return true;
}

/**
 * 1. random full grid → 2. random cage partition → 3. base givens for the difficulty →
 * 4. uniqueness: while a second solution exists, dissolve the cages around the cells where the two
 *    solutions differ and re-grow them so those cells land in different cages (this kills the
 *    alternative without adding givens). Only when the time budget is exhausted are givens added.
 */
export function generatePuzzle(
  difficulty: Difficulty,
  rand: Rng = Math.random,
  opts: GenerateOptions = {},
): { puzzle: Puzzle; stats: GenerateStats } {
  const cfg = DIFFICULTIES[difficulty];
  const now = opts.now ?? Date.now;
  const t0 = now();
  const deadline = t0 + (opts.timeBudgetMs ?? 1500);
  const solution = generateSolution(rand);
  let cages = partitionCages(solution, cfg, rand);

  const givens = new Array<number>(CELLS).fill(0);
  const idx = cageIndex(cages);
  const pool = shuffleInPlace(
    Array.from({ length: CELLS }, (_, i) => i).filter((i) => cages[idx[i]].cells.length > 1),
    rand,
  );
  for (let k = 0; k < cfg.givens && k < pool.length; k++) givens[pool[k]] = solution[pool[k]];

  let repairs = 0;
  let addedGivens = 0;
  let proofNodes = 0;
  for (;;) {
    const remaining = deadline - now();
    const slice = remaining > 0 ? Math.min(500, Math.max(120, remaining)) : 80;
    const res = countSolutions(cages, givens, { limit: 2, deadline: now() + slice, maxNodes: 600_000, now });
    if (!res.aborted && res.count === 1) {
      proofNodes = res.nodes;
      break;
    }
    if (!res.aborted && res.count === 0) break; // impossible for a consistent solution; guard anyway
    if (!res.aborted && res.solutions.length >= 2 && now() < deadline) {
      const [a, b] = res.solutions;
      const diff: number[] = [];
      for (let i = 0; i < CELLS; i++) if (a[i] !== b[i]) diff.push(i);
      cages = repartitionAround(solution, cages, cfg, diff, rand);
      repairs++;
      continue;
    }
    // Out of time (or the proof is too expensive): fall back to a given digit.
    if (!pickGiven(cages, givens, solution, rand)) break;
    addedGivens++;
  }
  // Final polish: a cage below the minimum size (left over from a tight repair) is merged into a
  // neighbour when that keeps the puzzle unique; otherwise it stays (it acts like a given).
  if (cfg.minCage > 1 && now() < deadline + 300) {
    for (let pass = 0; pass < 6; pass++) {
      const small = cages.findIndex((cg) => cg.cells.length < cfg.minCage);
      if (small < 0 || now() > deadline + 300) break;
      const idx2 = cageIndex(cages);
      const me = cages[small];
      const mine = digitsOf(me.cells, solution);
      const options: number[] = [];
      for (const c of me.cells) {
        for (const nb of neighbors(c)) {
          const k = idx2[nb];
          if (k === small || options.includes(k)) continue;
          const oc = cages[k];
          if (oc.cells.length + me.cells.length > cfg.maxCage || digitsOf(oc.cells, solution) & mine) continue;
          options.push(k);
        }
      }
      shuffleInPlace(options, rand);
      let merged = false;
      for (const k of options) {
        const cells = [...cages[k].cells, ...me.cells].sort((a, b) => a - b);
        const next = cages.filter((_, j) => j !== small && j !== k);
        next.push({ cells, sum: cells.reduce((acc, c) => acc + solution[c], 0) });
        const res = countSolutions(next, givens, { limit: 2, deadline: now() + 150, maxNodes: 200_000, now });
        if (!res.aborted && res.count === 1) {
          cages = next;
          merged = true;
          break;
        }
      }
      if (!merged) break;
    }
  }
  return {
    puzzle: { solution, cages, givens },
    stats: { ms: now() - t0, repairs, addedGivens, proofNodes },
  };
}

// ── Play helpers ─────────────────────────────────────────────────────────

/** Cells whose digit is duplicated in its row, column, box or cage. */
export function findConflicts(values: number[], cages: Cage[]): boolean[] {
  const out = new Array<boolean>(CELLS).fill(false);
  const groups: number[][] = [];
  for (let k = 0; k < 9; k++) {
    const row: number[] = [];
    const col: number[] = [];
    const box: number[] = [];
    for (let j = 0; j < 9; j++) {
      row.push(k * 9 + j);
      col.push(j * 9 + k);
      box.push(((k / 3) | 0) * 27 + (k % 3) * 3 + ((j / 3) | 0) * 9 + (j % 3));
    }
    groups.push(row, col, box);
  }
  for (const cg of cages) groups.push(cg.cells);
  for (const g of groups) {
    const seen = new Map<number, number[]>();
    for (const i of g) {
      const d = values[i];
      if (!d) continue;
      const list = seen.get(d);
      if (list) list.push(i);
      else seen.set(d, [i]);
    }
    for (const list of seen.values()) if (list.length > 1) list.forEach((i) => (out[i] = true));
  }
  return out;
}

export function isSolved(values: number[], solution: number[]): boolean {
  for (let i = 0; i < CELLS; i++) if (values[i] !== solution[i]) return false;
  return true;
}

/** Indices of filled cells that differ from the solution. */
export function wrongCells(values: number[], solution: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) if (values[i] && values[i] !== solution[i]) out.push(i);
  return out;
}

/** How many times each digit (index 1..9) has been placed. */
export function digitCounts(values: number[]): number[] {
  const out = new Array<number>(10).fill(0);
  for (const v of values) if (v) out[v]++;
  return out;
}

export interface CageStatus {
  sum: number;
  size: number;
  placedCount: number;
  placedSum: number;
  usedMask: number;
  remCount: number;
  remSum: number;
  /** Cage is fully filled. */
  complete: boolean;
  /** No duplicates and the remaining sum can still be reached (or, when complete, matches). */
  feasible: boolean;
}

export function cageStatus(values: number[], cage: Cage): CageStatus {
  let placedCount = 0;
  let placedSum = 0;
  let usedMask = 0;
  let dup = false;
  for (const c of cage.cells) {
    const d = values[c];
    if (!d) continue;
    placedCount++;
    placedSum += d;
    if (usedMask & bit(d)) dup = true;
    usedMask |= bit(d);
  }
  const remCount = cage.cells.length - placedCount;
  const remSum = cage.sum - placedSum;
  const complete = remCount === 0;
  const feasible = !dup && (complete ? remSum === 0 : remSum > 0 && comboMask(remCount, remSum, ALL & ~usedMask) !== 0);
  return { sum: cage.sum, size: cage.cells.length, placedCount, placedSum, usedMask, remCount, remSum, complete, feasible };
}

/** Indices sharing a row, column, box or cage with `i` (excluding `i`). */
export function peersOf(i: number, cageOf: Int16Array, cages: Cage[]): number[] {
  const set = new Set<number>();
  const r = rowOf(i);
  const c = colOf(i);
  const br = ((r / 3) | 0) * 3;
  const bc = ((c / 3) | 0) * 3;
  for (let j = 0; j < 9; j++) {
    set.add(r * 9 + j);
    set.add(j * 9 + c);
    set.add((br + ((j / 3) | 0)) * 9 + bc + (j % 3));
  }
  const g = cageOf[i];
  if (g >= 0) for (const cell of cages[g].cells) set.add(cell);
  set.delete(i);
  return Array.from(set);
}

/**
 * Cell to reveal for a hint: a wrong cell first (fixing mistakes), otherwise the empty cell with the
 * fewest candidates (what a solver would fill next). Returns -1 when the grid is complete and correct.
 */
export function hintTarget(values: number[], solution: number[], cages: Cage[], rand: Rng = Math.random): number {
  const wrong = wrongCells(values, solution);
  if (wrong.length) return wrong[(rand() * wrong.length) | 0];
  const masks = candidateMasks(cages, values);
  let pick = -1;
  let pickN = 99;
  let ties = 0;
  for (let i = 0; i < CELLS; i++) {
    if (values[i]) continue;
    const n = POP[masks[i]];
    if (n < pickN) {
      pickN = n;
      pick = i;
      ties = 1;
    } else if (n === pickN && rand() * ++ties < 1) {
      pick = i;
    }
  }
  return pick;
}

/** Shape check for a puzzle restored from storage. */
export function isValidPuzzle(p: unknown): p is Puzzle {
  if (!p || typeof p !== 'object') return false;
  const q = p as Partial<Puzzle>;
  if (!Array.isArray(q.solution) || q.solution.length !== CELLS || !isValidGrid(q.solution)) return false;
  if (!Array.isArray(q.givens) || q.givens.length !== CELLS) return false;
  if (!Array.isArray(q.cages) || !q.cages.length) return false;
  const seen = new Uint8Array(CELLS);
  for (const cg of q.cages) {
    if (!cg || !Array.isArray(cg.cells) || typeof cg.sum !== 'number' || !cg.cells.length) return false;
    for (const c of cg.cells) {
      if (!Number.isInteger(c) || c < 0 || c >= CELLS || seen[c]) return false;
      seen[c] = 1;
    }
  }
  for (let i = 0; i < CELLS; i++) {
    if (!seen[i]) return false;
    const g = q.givens[i];
    if (g !== 0 && g !== q.solution[i]) return false;
  }
  return true;
}
