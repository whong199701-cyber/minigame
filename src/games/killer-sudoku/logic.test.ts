import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALL,
  BORDER_BOTTOM,
  BORDER_LEFT,
  BORDER_RIGHT,
  BORDER_TOP,
  CELLS,
  DIFFICULTIES,
  bit,
  boxOf,
  cageBorderFlags,
  cageCombos,
  cageIndex,
  cageStatus,
  candidateMasks,
  colOf,
  comboMask,
  countSolutions,
  derivedGroups,
  digitCounts,
  findConflicts,
  generatePuzzle,
  generateSolution,
  hintTarget,
  isSolved,
  isValidGrid,
  isValidPuzzle,
  makeRng,
  maskToDigits,
  neighbors,
  partitionCages,
  peersOf,
  popcount,
  repartitionAround,
  rowOf,
  satisfies,
  wrongCells,
  type Cage,
  type Difficulty,
} from './logic';

const EMPTY = (): number[] => new Array<number>(CELLS).fill(0);

/** Cages where every cell is its own cage (fully determined puzzle). */
function singletonCages(solution: number[]): Cage[] {
  return solution.map((d, i) => ({ cells: [i], sum: d }));
}

/** Each row is one cage (massively under-constrained). */
function rowCages(solution: number[]): Cage[] {
  return Array.from({ length: 9 }, (_, r) => {
    const cells = Array.from({ length: 9 }, (_, c) => r * 9 + c);
    return { cells, sum: cells.reduce((s, i) => s + solution[i], 0) };
  });
}

function isConnected(cells: number[]): boolean {
  const set = new Set(cells);
  const seen = new Set<number>([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const c = stack.pop() as number;
    for (const nb of neighbors(c)) {
      if (set.has(nb) && !seen.has(nb)) {
        seen.add(nb);
        stack.push(nb);
      }
    }
  }
  return seen.size === cells.length;
}

describe('indexing helpers', () => {
  it('maps cells to rows, columns and boxes', () => {
    expect(rowOf(0)).toBe(0);
    expect(colOf(8)).toBe(8);
    expect(rowOf(80)).toBe(8);
    expect(boxOf(0)).toBe(0);
    expect(boxOf(40)).toBe(4);
    expect(boxOf(80)).toBe(8);
    expect(boxOf(27)).toBe(3);
  });
  it('neighbors respects the grid edges', () => {
    expect(neighbors(0).sort((a, b) => a - b)).toEqual([1, 9]);
    expect(neighbors(40).sort((a, b) => a - b)).toEqual([31, 39, 41, 49]);
    expect(neighbors(80).sort((a, b) => a - b)).toEqual([71, 79]);
  });
  it('bit helpers', () => {
    expect(bit(1)).toBe(1);
    expect(bit(9)).toBe(256);
    expect(popcount(ALL)).toBe(9);
    expect(maskToDigits(bit(2) | bit(7))).toEqual([2, 7]);
  });
  it('seeded rng is deterministic and in [0,1)', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= 0 && x < 1).toBe(true);
    }
  });
});

describe('generateSolution', () => {
  it('produces valid full grids', () => {
    for (let s = 1; s <= 10; s++) {
      const grid = generateSolution(makeRng(s));
      expect(grid).toHaveLength(81);
      expect(isValidGrid(grid)).toBe(true);
    }
  });
  it('is reproducible for a seed and varies across seeds', () => {
    expect(generateSolution(makeRng(7))).toEqual(generateSolution(makeRng(7)));
    expect(generateSolution(makeRng(7))).not.toEqual(generateSolution(makeRng(8)));
  });
  it('isValidGrid rejects broken grids', () => {
    const grid = generateSolution(makeRng(1));
    const bad = grid.slice();
    bad[0] = bad[1];
    expect(isValidGrid(bad)).toBe(false);
    expect(isValidGrid(grid.slice(0, 80))).toBe(false);
    const zero = grid.slice();
    zero[5] = 0;
    expect(isValidGrid(zero)).toBe(false);
  });
});

describe('partitionCages', () => {
  const diffs: Difficulty[] = ['easy', 'medium', 'hard'];
  for (const diff of diffs) {
    it(`${diff}: covers all 81 cells exactly once with correct sums, no repeats, connected`, () => {
      for (let s = 1; s <= 6; s++) {
        const rand = makeRng(s * 31 + diff.length);
        const solution = generateSolution(rand);
        const cfg = DIFFICULTIES[diff];
        const cages = partitionCages(solution, cfg, rand);
        const seen = new Uint8Array(81);
        for (const cg of cages) {
          expect(cg.cells.length).toBeGreaterThanOrEqual(1);
          expect(cg.cells.length).toBeLessThanOrEqual(cfg.maxCage);
          expect(cg.cells).toEqual(cg.cells.slice().sort((a, b) => a - b));
          const digits = new Set<number>();
          let sum = 0;
          for (const c of cg.cells) {
            expect(seen[c]).toBe(0);
            seen[c] = 1;
            digits.add(solution[c]);
            sum += solution[c];
          }
          expect(digits.size).toBe(cg.cells.length);
          expect(cg.sum).toBe(sum);
          expect(isConnected(cg.cells)).toBe(true);
        }
        expect(Array.from(seen).every((v) => v === 1)).toBe(true);
        expect(satisfies(solution, cages)).toBe(true);
      }
    });
  }
  it('respects the minimum cage size in practice (medium/hard)', () => {
    let small = 0;
    for (let s = 1; s <= 8; s++) {
      const rand = makeRng(s + 500);
      const solution = generateSolution(rand);
      const cages = partitionCages(solution, DIFFICULTIES.hard, rand);
      small += cages.filter((c) => c.cells.length < 2).length;
    }
    expect(small).toBe(0);
  });
  it('cageIndex maps every cell', () => {
    const rand = makeRng(3);
    const solution = generateSolution(rand);
    const cages = partitionCages(solution, DIFFICULTIES.medium, rand);
    const idx = cageIndex(cages);
    for (let i = 0; i < 81; i++) {
      expect(idx[i]).toBeGreaterThanOrEqual(0);
      expect(cages[idx[i]].cells).toContain(i);
    }
  });
});

describe('cageBorderFlags', () => {
  it('marks grid edges and cage boundaries symmetrically', () => {
    const rand = makeRng(11);
    const solution = generateSolution(rand);
    const cages = partitionCages(solution, DIFFICULTIES.medium, rand);
    const idx = cageIndex(cages);
    const flags = cageBorderFlags(cages);
    for (let i = 0; i < 81; i++) {
      const r = rowOf(i);
      const c = colOf(i);
      if (r === 0) expect(flags[i] & BORDER_TOP).toBeTruthy();
      if (c === 0) expect(flags[i] & BORDER_LEFT).toBeTruthy();
      if (r === 8) expect(flags[i] & BORDER_BOTTOM).toBeTruthy();
      if (c === 8) expect(flags[i] & BORDER_RIGHT).toBeTruthy();
      if (c < 8) {
        const boundary = idx[i] !== idx[i + 1];
        expect(!!(flags[i] & BORDER_RIGHT)).toBe(boundary);
        expect(!!(flags[i + 1] & BORDER_LEFT)).toBe(boundary);
      }
      if (r < 8) {
        const boundary = idx[i] !== idx[i + 9];
        expect(!!(flags[i] & BORDER_BOTTOM)).toBe(boundary);
        expect(!!(flags[i + 9] & BORDER_TOP)).toBe(boundary);
      }
    }
  });
  it('a single-cell cage has all four borders', () => {
    const solution = generateSolution(makeRng(2));
    const flags = cageBorderFlags(singletonCages(solution));
    for (let i = 0; i < 81; i++) expect(flags[i]).toBe(BORDER_TOP | BORDER_RIGHT | BORDER_BOTTOM | BORDER_LEFT);
  });
});

describe('combination table', () => {
  it('cageCombos lists the known killer combinations', () => {
    expect(cageCombos(2, 3)).toEqual([[1, 2]]);
    expect(cageCombos(2, 17)).toEqual([[8, 9]]);
    expect(cageCombos(3, 6)).toEqual([[1, 2, 3]]);
    expect(cageCombos(3, 24)).toEqual([[7, 8, 9]]);
    expect(cageCombos(2, 10)).toEqual([
      [1, 9],
      [2, 8],
      [3, 7],
      [4, 6],
    ]);
    expect(cageCombos(4, 10)).toEqual([[1, 2, 3, 4]]);
    expect(cageCombos(2, 1)).toEqual([]);
    expect(cageCombos(2, 18)).toEqual([]);
    expect(cageCombos(0, 0)).toEqual([]);
    expect(cageCombos(9, 45)).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9]]);
  });
  it('cageCombos honours the available-digit mask', () => {
    expect(cageCombos(2, 10, ALL & ~bit(1) & ~bit(9))).toEqual([
      [2, 8],
      [3, 7],
      [4, 6],
    ]);
  });
  it('comboMask is the union of digits in the combinations', () => {
    expect(maskToDigits(comboMask(2, 3, ALL))).toEqual([1, 2]);
    expect(maskToDigits(comboMask(2, 10, ALL))).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
    expect(maskToDigits(comboMask(3, 7, ALL))).toEqual([1, 2, 4]);
    expect(comboMask(2, 18, ALL)).toBe(0);
    expect(comboMask(0, 0, ALL)).toBe(0);
    expect(comboMask(1, 5, ALL & ~bit(5))).toBe(0);
    expect(comboMask(1, 5, ALL)).toBe(bit(5));
    // memoised path returns the same value
    expect(comboMask(2, 10, ALL)).toBe(comboMask(2, 10, ALL));
  });
});

describe('derivedGroups (45 rule)', () => {
  it('finds the innie of a box made of whole cages plus one cell', () => {
    const solution = generateSolution(makeRng(5));
    // Box 0 = cells 0,1,2,9,10,11,18,19,20. Cages: {0,1,2}, {9,10,11}, {18,19} and {20,21} (sticks out).
    const cages: Cage[] = [
      { cells: [0, 1, 2], sum: solution[0] + solution[1] + solution[2] },
      { cells: [9, 10, 11], sum: solution[9] + solution[10] + solution[11] },
      { cells: [18, 19], sum: solution[18] + solution[19] },
      { cells: [20, 21], sum: solution[20] + solution[21] },
    ];
    // Fill the rest with singletons so the partition is complete.
    const covered = new Set(cages.flatMap((c) => c.cells));
    for (let i = 0; i < 81; i++) if (!covered.has(i)) cages.push({ cells: [i], sum: solution[i] });
    const groups = derivedGroups(cages);
    const innie = groups.find((g) => g.cells.length === 1 && g.cells[0] === 20);
    expect(innie).toBeDefined();
    expect(innie?.sum).toBe(solution[20]);
    const outie = groups.find((g) => g.cells.length === 1 && g.cells[0] === 21);
    expect(outie?.sum).toBe(solution[21]);
    // Every derived group is consistent with the solution.
    for (const g of groups) {
      expect(g.cells.reduce((s, c) => s + solution[c], 0)).toBe(g.sum);
      if (g.distinct) expect(new Set(g.cells.map((c) => solution[c])).size).toBe(g.cells.length);
    }
  });
  it('derived groups of a generated puzzle all hold for its solution', () => {
    const rand = makeRng(77);
    const solution = generateSolution(rand);
    const cages = partitionCages(solution, DIFFICULTIES.hard, rand);
    const groups = derivedGroups(cages);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.cells.length).toBeLessThanOrEqual(6);
      expect(g.cells.reduce((s, c) => s + solution[c], 0)).toBe(g.sum);
    }
  });
});

describe('countSolutions', () => {
  it('finds the unique solution of a generated puzzle', () => {
    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const { puzzle } = generatePuzzle(diff, makeRng(100 + diff.length));
      const res = countSolutions(puzzle.cages, puzzle.givens, { limit: 2 });
      expect(res.aborted).toBe(false);
      expect(res.count).toBe(1);
      expect(res.solution).toEqual(puzzle.solution);
      expect(res.solutions).toHaveLength(1);
    }
  });
  it('solves a fully given puzzle and a singleton-cage puzzle', () => {
    const solution = generateSolution(makeRng(9));
    expect(countSolutions(singletonCages(solution), EMPTY()).count).toBe(1);
    expect(countSolutions(singletonCages(solution), solution).count).toBe(1);
  });
  it('counts 2+ solutions for an under-constrained puzzle', () => {
    const solution = generateSolution(makeRng(10));
    const res = countSolutions(rowCages(solution), EMPTY(), { limit: 2 });
    expect(res.aborted).toBe(false);
    expect(res.count).toBe(2);
    expect(res.solutions).toHaveLength(2);
    expect(res.solutions[0]).not.toEqual(res.solutions[1]);
    for (const s of res.solutions) expect(satisfies(s, rowCages(solution))).toBe(true);
  });
  it('counts up to a larger limit', () => {
    const solution = generateSolution(makeRng(10));
    const res = countSolutions(rowCages(solution), EMPTY(), { limit: 5 });
    expect(res.count).toBe(5);
  });
  it('returns 0 for impossible sums or contradictory givens', () => {
    const solution = generateSolution(makeRng(12));
    const cages = singletonCages(solution);
    cages[0] = { cells: [0], sum: 10 };
    expect(countSolutions(cages, EMPTY()).count).toBe(0);
    const good = singletonCages(solution);
    const givens = EMPTY();
    givens[0] = solution[0] === 1 ? 2 : 1;
    expect(countSolutions(good, givens).count).toBe(0);
  });
  it('respects a node budget and reports abort', () => {
    const solution = generateSolution(makeRng(13));
    const res = countSolutions(rowCages(solution), EMPTY(), { limit: 1000, maxNodes: 200 });
    expect(res.aborted).toBe(true);
    expect(res.count).toBeLessThan(1000);
  });
  it('works without derived groups too (slower path)', () => {
    const { puzzle } = generatePuzzle('medium', makeRng(55));
    const res = countSolutions(puzzle.cages, puzzle.givens, { limit: 2, noDerived: true });
    expect(res.aborted).toBe(false);
    expect(res.count).toBe(1);
    expect(res.solution).toEqual(puzzle.solution);
  });
});

describe('generatePuzzle', () => {
  const cases: [Difficulty, number][] = [
    ['easy', 1],
    ['easy', 2],
    ['medium', 3],
    ['medium', 4],
    ['hard', 5],
    ['hard', 6],
  ];
  for (const [diff, seed] of cases) {
    it(`${diff} seed ${seed}: unique, consistent givens, cage sizes within limits`, () => {
      const cfg = DIFFICULTIES[diff];
      const { puzzle, stats } = generatePuzzle(diff, makeRng(seed));
      expect(isValidGrid(puzzle.solution)).toBe(true);
      expect(satisfies(puzzle.solution, puzzle.cages)).toBe(true);
      expect(isValidPuzzle(puzzle)).toBe(true);
      for (let i = 0; i < 81; i++) {
        if (puzzle.givens[i]) expect(puzzle.givens[i]).toBe(puzzle.solution[i]);
      }
      for (const cg of puzzle.cages) expect(cg.cells.length).toBeLessThanOrEqual(cfg.maxCage);
      const res = countSolutions(puzzle.cages, puzzle.givens, { limit: 2 });
      expect(res.aborted).toBe(false);
      expect(res.count).toBe(1);
      expect(stats.ms).toBeLessThan(3000);
      expect(stats.addedGivens).toBe(0);
    });
  }
  it('hard puzzles are pure killer (no givens) and medium/easy have their base givens', () => {
    const hard = generatePuzzle('hard', makeRng(21)).puzzle;
    expect(hard.givens.filter(Boolean).length).toBe(0);
    const medium = generatePuzzle('medium', makeRng(22)).puzzle;
    expect(medium.givens.filter(Boolean).length).toBe(DIFFICULTIES.medium.givens);
    const easy = generatePuzzle('easy', makeRng(23)).puzzle;
    expect(easy.givens.filter(Boolean).length).toBe(DIFFICULTIES.easy.givens);
  });
  it('is reproducible for the same seed', () => {
    expect(generatePuzzle('medium', makeRng(99)).puzzle).toEqual(generatePuzzle('medium', makeRng(99)).puzzle);
  });
  it('falls back to givens when the time budget is zero', () => {
    const { puzzle, stats } = generatePuzzle('hard', makeRng(31), { timeBudgetMs: 0 });
    const res = countSolutions(puzzle.cages, puzzle.givens, { limit: 2 });
    expect(res.count).toBe(1);
    expect(stats.repairs).toBe(0);
    expect(satisfies(puzzle.solution, puzzle.cages)).toBe(true);
  });
});

describe('repartitionAround', () => {
  it('keeps a valid partition and separates the marked cells', () => {
    const rand = makeRng(41);
    const solution = generateSolution(rand);
    const cages = partitionCages(solution, DIFFICULTIES.hard, rand);
    const marked = [0, 1, 9, 10];
    const next = repartitionAround(solution, cages, DIFFICULTIES.hard, marked, rand);
    const idx = cageIndex(next);
    const seen = new Uint8Array(81);
    for (const cg of next) {
      for (const c of cg.cells) {
        expect(seen[c]).toBe(0);
        seen[c] = 1;
      }
      expect(cg.sum).toBe(cg.cells.reduce((s, c) => s + solution[c], 0));
      expect(new Set(cg.cells.map((c) => solution[c])).size).toBe(cg.cells.length);
      expect(cg.cells.length).toBeLessThanOrEqual(5);
    }
    expect(Array.from(seen).every((v) => v === 1)).toBe(true);
    expect(new Set(marked.map((c) => idx[c])).size).toBe(marked.length);
  });
});

describe('play helpers', () => {
  const rand = makeRng(61);
  const { puzzle } = generatePuzzle('medium', rand);
  const { solution, cages } = puzzle;

  it('findConflicts flags duplicates in rows, columns, boxes and cages only', () => {
    expect(findConflicts(solution, cages).every((v) => !v)).toBe(true);
    const row = solution.slice();
    row[1] = row[0]; // same row
    const fr = findConflicts(row, cages);
    expect(fr[0] && fr[1]).toBe(true);
    const col = EMPTY();
    col[0] = 5;
    col[9] = 5;
    const fc = findConflicts(col, cages);
    expect(fc[0] && fc[9]).toBe(true);
    expect(fc.filter(Boolean).length).toBe(2);
    const box = EMPTY();
    box[0] = 7;
    box[10] = 7;
    expect(findConflicts(box, cages)[10]).toBe(true);
    const cage = cages.find((c) => c.cells.length >= 2 && rowOf(c.cells[0]) !== rowOf(c.cells[1]) && colOf(c.cells[0]) !== colOf(c.cells[1]) && boxOf(c.cells[0]) !== boxOf(c.cells[1]));
    if (cage) {
      const v = EMPTY();
      v[cage.cells[0]] = 4;
      v[cage.cells[1]] = 4;
      const f = findConflicts(v, cages);
      expect(f[cage.cells[0]] && f[cage.cells[1]]).toBe(true);
    }
    const fine = EMPTY();
    fine[0] = 3;
    fine[80] = 3;
    expect(findConflicts(fine, cages).some(Boolean)).toBe(false);
  });

  it('isSolved / wrongCells / digitCounts', () => {
    expect(isSolved(solution, solution)).toBe(true);
    const v = solution.slice();
    v[40] = 0;
    expect(isSolved(v, solution)).toBe(false);
    expect(wrongCells(v, solution)).toEqual([]);
    v[40] = solution[40] === 9 ? 1 : solution[40] + 1;
    expect(wrongCells(v, solution)).toEqual([40]);
    const counts = digitCounts(solution);
    for (let d = 1; d <= 9; d++) expect(counts[d]).toBe(9);
    expect(digitCounts(EMPTY()).slice(1).every((n) => n === 0)).toBe(true);
  });

  it('cageStatus tracks remaining sum and feasibility', () => {
    const cage = cages.find((c) => c.cells.length === 3) as Cage;
    const empty = cageStatus(EMPTY(), cage);
    expect(empty.remCount).toBe(3);
    expect(empty.remSum).toBe(cage.sum);
    expect(empty.complete).toBe(false);
    expect(empty.feasible).toBe(true);
    const v = EMPTY();
    v[cage.cells[0]] = solution[cage.cells[0]];
    const one = cageStatus(v, cage);
    expect(one.placedCount).toBe(1);
    expect(one.remSum).toBe(cage.sum - solution[cage.cells[0]]);
    expect(one.usedMask).toBe(bit(solution[cage.cells[0]]));
    expect(one.feasible).toBe(true);
    const full = cageStatus(solution, cage);
    expect(full.complete).toBe(true);
    expect(full.feasible).toBe(true);
    // Overshoot: put 9s everywhere (duplicates + sum too big)
    const bad = EMPTY();
    for (const c of cage.cells) bad[c] = 9;
    const b = cageStatus(bad, cage);
    expect(b.complete).toBe(true);
    expect(b.feasible).toBe(false);
    // Remaining sum impossible for the remaining count
    const two = cages.find((c) => c.cells.length === 2) as Cage;
    const w = EMPTY();
    w[two.cells[0]] = 9;
    const st = cageStatus(w, two);
    expect(st.feasible).toBe(two.sum - 9 >= 1 && two.sum - 9 <= 8);
  });

  it('peersOf returns row, column, box and cage mates without the cell itself', () => {
    const idx = cageIndex(cages);
    const peers = peersOf(40, idx, cages);
    expect(peers).not.toContain(40);
    for (let j = 0; j < 9; j++) {
      expect(peers).toContain(4 * 9 + j === 40 ? 31 : 4 * 9 + j);
      expect(peers).toContain(j * 9 + 4 === 40 ? 31 : j * 9 + 4);
    }
    expect(peers).toContain(30); // same box
    for (const c of cages[idx[40]].cells) if (c !== 40) expect(peers).toContain(c);
    expect(new Set(peers).size).toBe(peers.length);
  });

  it('candidateMasks respects placed digits', () => {
    const masks = candidateMasks(cages, solution);
    expect(Array.from(masks).every((m) => m === 0)).toBe(true);
    const v = EMPTY();
    v[0] = 5;
    const m = candidateMasks(cages, v);
    expect(m[0]).toBe(0);
    expect(m[1] & bit(5)).toBe(0);
    expect(m[9] & bit(5)).toBe(0);
    expect(m[80] & bit(5)).toBeTruthy();
  });

  it('hintTarget fixes wrong cells first, then picks an empty cell, and -1 when solved', () => {
    const v = solution.slice();
    v[12] = solution[12] === 1 ? 2 : 1;
    expect(hintTarget(v, solution, cages, makeRng(1))).toBe(12);
    const partial = EMPTY();
    const h = hintTarget(partial, solution, cages, makeRng(1));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(partial[h]).toBe(0);
    expect(hintTarget(solution, solution, cages, makeRng(1))).toBe(-1);
  });

  it('isValidPuzzle rejects malformed saves', () => {
    expect(isValidPuzzle(null)).toBe(false);
    expect(isValidPuzzle({})).toBe(false);
    expect(isValidPuzzle({ ...puzzle, givens: puzzle.givens.slice(0, 10) })).toBe(false);
    expect(isValidPuzzle({ ...puzzle, cages: puzzle.cages.slice(1) })).toBe(false);
    const badGiven = puzzle.givens.slice();
    badGiven[3] = solution[3] === 1 ? 2 : 1;
    expect(isValidPuzzle({ ...puzzle, givens: badGiven })).toBe(false);
    expect(isValidPuzzle(puzzle)).toBe(true);
  });
});

describe('i18n strings in index.ts', () => {
  it('zh and en define exactly the same keys, including rules', () => {
    const src = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
    const start = src.indexOf('const strings = {');
    const end = src.indexOf('\n};', start);
    const block = src.slice(start, end);
    const zhStart = block.indexOf('  zh: {');
    const enStart = block.indexOf('  en: {');
    const keysOf = (text: string): string[] => Array.from(text.matchAll(/^ {4}(\w+):/gm), (m) => m[1]);
    const zh = keysOf(block.slice(zhStart, enStart));
    const en = keysOf(block.slice(enStart));
    expect(zh.length).toBeGreaterThan(10);
    expect(zh).toContain('rules');
    expect(new Set(zh).size).toBe(zh.length);
    expect([...en].sort()).toEqual([...zh].sort());
  });
});
