import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AT_CAP,
  BINARY_TYPES,
  CATEGORIES,
  CHECK_PENALTY,
  CLUE_TEMPLATES,
  CLUE_TYPES,
  DIFFICULTIES,
  DIFFICULTY_LIST,
  HINT_PENALTY,
  RATING_RANGE,
  SAVE_VERSION,
  applyPlacement,
  buildCluePool,
  clueHolds,
  clueParts,
  clueText,
  contentStrings,
  countEmpty,
  countWrong,
  emptyTable,
  generatePuzzle,
  hasProgress,
  isSolved,
  makeRng,
  parseSave,
  penaltySeconds,
  pickHint,
  randomSolution,
  ratingDistance,
  solutionToTable,
  solve,
  type Clue,
  type Difficulty,
  type SavedGame,
  type Table,
} from './logic';
import { UI_STRINGS } from './strings';

const r = (cat: number, item: number) => ({ cat, item });

// Hand-written 3-house, 2-category puzzle. pos[cat][item] = house.
// cat0 (door): red=0, blue=1, green=2   cat1 (name): alex=2, ben=0, carl=1
const handPos = [
  [0, 1, 2],
  [2, 0, 1],
];
const handClues: Clue[] = [
  { type: 'leftOf', a: r(0, 0), b: r(0, 1) }, // red directly left of blue
  { type: 'atEnd', a: r(0, 2) }, // green at an end
  { type: 'same', a: r(1, 1), b: r(0, 0) }, // ben with red
  { type: 'notAt', a: r(1, 0), k: 1 }, // alex not in house 2
  { type: 'notAt', a: r(0, 2), k: 0 }, // green not in house 1
];

function tr(lang: 'zh' | 'en'): (key: string) => string {
  const dict = contentStrings()[lang];
  return (key) => dict[key] ?? key;
}

describe('clueHolds', () => {
  const pos = handPos;
  it('evaluates every clue type against a solution', () => {
    expect(clueHolds({ type: 'at', a: r(0, 1), k: 1 }, pos, 3)).toBe(true);
    expect(clueHolds({ type: 'at', a: r(0, 1), k: 0 }, pos, 3)).toBe(false);
    expect(clueHolds({ type: 'notAt', a: r(0, 1), k: 0 }, pos, 3)).toBe(true);
    expect(clueHolds({ type: 'notAt', a: r(0, 1), k: 1 }, pos, 3)).toBe(false);
    expect(clueHolds({ type: 'atEnd', a: r(0, 0) }, pos, 3)).toBe(true);
    expect(clueHolds({ type: 'atEnd', a: r(0, 1) }, pos, 3)).toBe(false);
    expect(clueHolds({ type: 'same', a: r(0, 0), b: r(1, 1) }, pos, 3)).toBe(true);
    expect(clueHolds({ type: 'same', a: r(0, 0), b: r(1, 0) }, pos, 3)).toBe(false);
    expect(clueHolds({ type: 'notSame', a: r(0, 0), b: r(1, 0) }, pos, 3)).toBe(true);
    expect(clueHolds({ type: 'notSame', a: r(0, 0), b: r(1, 1) }, pos, 3)).toBe(false);
    expect(clueHolds({ type: 'leftOf', a: r(0, 0), b: r(0, 1) }, pos, 3)).toBe(true);
    expect(clueHolds({ type: 'leftOf', a: r(0, 1), b: r(0, 0) }, pos, 3)).toBe(false);
    expect(clueHolds({ type: 'leftOf', a: r(0, 0), b: r(0, 2) }, pos, 3)).toBe(false);
    expect(clueHolds({ type: 'nextTo', a: r(0, 1), b: r(0, 0) }, pos, 3)).toBe(true);
    expect(clueHolds({ type: 'nextTo', a: r(0, 0), b: r(0, 2) }, pos, 3)).toBe(false);
    expect(clueHolds({ type: 'somewhereLeft', a: r(0, 0), b: r(0, 2) }, pos, 3)).toBe(true);
    expect(clueHolds({ type: 'somewhereLeft', a: r(0, 2), b: r(0, 0) }, pos, 3)).toBe(false);
  });
  it('is false for a binary clue missing its second item', () => {
    expect(clueHolds({ type: 'same', a: r(0, 0) }, pos, 3)).toBe(false);
  });
});

describe('solve', () => {
  it('finds the unique solution of a hand-written puzzle', () => {
    const res = solve(3, 2, handClues);
    expect(res.count).toBe(1);
    expect(res.aborted).toBe(false);
    expect(res.solution).toEqual(handPos);
  });
  it('reports multiple solutions when clues are insufficient', () => {
    const res = solve(3, 2, handClues.slice(0, 2));
    expect(res.count).toBe(2);
    expect(res.solution).not.toBeNull();
  });
  it('reports zero solutions for contradictory clues', () => {
    const res = solve(3, 2, [...handClues, { type: 'at', a: r(0, 0), k: 2 }]);
    expect(res.count).toBe(0);
    expect(res.solution).toBeNull();
  });
  it('counts all 3! x 3! assignments with no clues when the limit allows', () => {
    const res = solve(3, 2, [], 1000);
    expect(res.count).toBe(36);
  });
  it('honours the node budget', () => {
    const res = solve(5, 5, [], 1000000, 50);
    expect(res.aborted).toBe(true);
  });
  it('handles somewhereLeft chains with propagation only', () => {
    // red < blue < green < yellow forces the order on 4 houses.
    const clues: Clue[] = [
      { type: 'somewhereLeft', a: r(0, 0), b: r(0, 1) },
      { type: 'somewhereLeft', a: r(0, 1), b: r(0, 2) },
      { type: 'somewhereLeft', a: r(0, 2), b: r(0, 3) },
    ];
    const res = solve(4, 1, clues);
    expect(res.count).toBe(1);
    expect(res.nodes).toBe(0);
    expect(res.solution).toEqual([[0, 1, 2, 3]]);
  });
});

describe('buildCluePool', () => {
  it('produces only true clues and covers every type', () => {
    const rand = makeRng(7);
    const pos = randomSolution(5, 5, rand);
    const pool = buildCluePool(pos, 5, 5, rand);
    const types = new Set(pool.map((c) => c.type));
    for (const t of CLUE_TYPES) expect(types.has(t)).toBe(true);
    for (const c of pool) {
      expect(clueHolds(c, pos, 5)).toBe(true);
      if (BINARY_TYPES.includes(c.type)) {
        expect(c.b).toBeDefined();
        expect(c.a.cat === c.b!.cat && c.a.item === c.b!.item).toBe(false);
        if (c.type === 'same' || c.type === 'notSame') expect(c.a.cat).not.toBe(c.b!.cat);
      }
    }
    expect(pool.filter((c) => c.type === 'at')).toHaveLength(25);
    expect(pool.filter((c) => c.type === 'notAt')).toHaveLength(100);
    expect(pool.filter((c) => c.type === 'atEnd')).toHaveLength(10);
  });
});

describe('randomSolution', () => {
  it('is a permutation per category', () => {
    const pos = randomSolution(5, 4, makeRng(3));
    expect(pos).toHaveLength(4);
    for (const row of pos) expect([...row].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('generatePuzzle', () => {
  for (const diff of DIFFICULTY_LIST) {
    it(`generates unique, consistent, minimal ${diff} puzzles`, () => {
      const { n, k } = DIFFICULTIES[diff];
      for (let seed = 1; seed <= 6; seed++) {
        const p = generatePuzzle(diff, makeRng(seed * 101 + 5));
        expect(p.n).toBe(n);
        expect(p.k).toBe(k);
        expect(p.clues.length).toBeGreaterThan(3);
        for (const c of p.clues) expect(clueHolds(c, p.solution, n)).toBe(true);
        const res = solve(n, k, p.clues);
        expect(res.count).toBe(1);
        expect(res.solution).toEqual(p.solution);
        expect(p.clues.filter((c) => c.type === 'at').length).toBeLessThanOrEqual(AT_CAP[diff]);
        // Minimal: removing any single clue breaks uniqueness.
        for (let i = 0; i < p.clues.length; i++) {
          const without = p.clues.filter((_, j) => j !== i);
          expect(solve(n, k, without).count).toBe(2);
        }
      }
    });
  }
  it('is deterministic for a given seed', () => {
    const a = generatePuzzle('medium', makeRng(42));
    const b = generatePuzzle('medium', makeRng(42));
    expect(a).toEqual(b);
  });
  it('mostly uses relational clues on hard', () => {
    let relational = 0;
    let total = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const p = generatePuzzle('hard', makeRng(seed));
      total += p.clues.length;
      relational += p.clues.filter((c) => BINARY_TYPES.includes(c.type)).length;
    }
    expect(relational / total).toBeGreaterThan(0.6);
  });
  it('still returns a valid unique puzzle when the solver budget is tiny (fallback path)', () => {
    const p = generatePuzzle('hard', makeRng(9), { maxAttempts: 1, nodeBudget: 1 });
    const res = solve(p.n, p.k, p.clues);
    expect(res.count).toBe(1);
    expect(res.solution).toEqual(p.solution);
  });
  it('generates hard puzzles quickly', () => {
    const start = performance.now();
    for (let seed = 1; seed <= 10; seed++) generatePuzzle('hard', makeRng(1000 + seed));
    expect(performance.now() - start).toBeLessThan(4000);
  });
});

describe('bilingual content', () => {
  it('has identical key sets in zh and en', () => {
    const s = contentStrings();
    expect(Object.keys(s.zh).sort()).toEqual(Object.keys(s.en).sort());
    for (const key of Object.keys(s.zh)) {
      expect(s.zh[key].length).toBeGreaterThan(0);
      expect(s.en[key].length).toBeGreaterThan(0);
    }
  });
  it('has five categories with five items each, bilingual labels and phrases', () => {
    expect(CATEGORIES).toHaveLength(5);
    for (const c of CATEGORIES) {
      expect(c.items).toHaveLength(5);
      expect(new Set(c.items.map((i) => i.id)).size).toBe(5);
      for (const it of c.items) {
        expect(it.label.zh && it.label.en && it.phrase.zh && it.phrase.en).toBeTruthy();
      }
    }
  });
  it('templates contain all required placeholders in both languages', () => {
    for (const lang of ['zh', 'en'] as const) {
      for (const type of CLUE_TYPES) {
        const tpl = CLUE_TEMPLATES[lang][type];
        expect(tpl).toContain('{A}');
        if (BINARY_TYPES.includes(type)) expect(tpl).toContain('{B}');
        else expect(tpl).not.toContain('{B}');
        if (type === 'at' || type === 'notAt') expect(tpl).toContain('{k}');
        if (type === 'atEnd') expect(tpl).toContain('{n}');
      }
    }
  });
  it('renders every clue type without leftover placeholders', () => {
    const rand = makeRng(11);
    const pos = randomSolution(5, 5, rand);
    const pool = buildCluePool(pos, 5, 5, rand);
    for (const lang of ['zh', 'en'] as const) {
      const t = tr(lang);
      for (const type of CLUE_TYPES) {
        const clue = pool.find((c) => c.type === type)!;
        const text = clueText(clue, 5, t, lang);
        expect(text).not.toMatch(/\{[A-Za-z]\}/);
        const parts = clueParts(clue, 5, t, lang);
        expect(parts.filter((p) => p.kind === 'ref')).toHaveLength(BINARY_TYPES.includes(type) ? 2 : 1);
      }
    }
  });
  it('capitalises an English sentence that starts with a phrase', () => {
    const parts = clueParts({ type: 'at', a: r(2, 0), k: 1 }, 5, tr('en'), 'en');
    expect(parts[0]).toMatchObject({ kind: 'ref', text: 'The dog owner' });
    expect(clueText({ type: 'at', a: r(2, 0), k: 1 }, 5, tr('en'), 'en')).toBe('🐶 The dog owner is in house 2.');
    expect(clueText({ type: 'at', a: r(2, 0), k: 1 }, 5, tr('zh'), 'zh')).toBe('🐶 养狗的人在 2 号房。');
  });
  it('renders house numbers 1-based and the house count', () => {
    expect(clueText({ type: 'notAt', a: r(1, 0), k: 4 }, 5, tr('en'), 'en')).toBe('Alex is not in house 5.');
    expect(clueText({ type: 'atEnd', a: r(1, 1) }, 4, tr('en'), 'en')).toBe('Ben is at one of the ends (house 1 or 4).');
  });
});

describe('table helpers', () => {
  const pos = [
    [0, 1, 2],
    [2, 0, 1],
  ];
  it('converts a solution to a table and back-checks it', () => {
    const t = solutionToTable(pos, 3, 2);
    expect(t).toEqual([
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
    expect(isSolved(t, pos)).toBe(true);
    expect(countWrong(t, pos)).toBe(0);
  });
  it('places an item and clears its previous house', () => {
    const t: Table = emptyTable(3, 2);
    expect(applyPlacement(t, 0, 0, 1)).toBe(-1);
    expect(t[0][0]).toBe(1);
    expect(applyPlacement(t, 2, 0, 1)).toBe(0);
    expect(t[0][0]).toBeNull();
    expect(t[2][0]).toBe(1);
    expect(countEmpty(t)).toBe(5);
  });
  it('counts wrong cells among filled ones only', () => {
    const t: Table = emptyTable(3, 2);
    t[0][0] = 2; // wrong (should be 0)
    t[1][1] = 2; // right
    expect(countWrong(t, pos)).toBe(1);
    expect(isSolved(t, pos)).toBe(false);
  });
  it('hints prefer wrong cells, then empty ones, and return null when solved', () => {
    const t: Table = emptyTable(3, 2);
    t[0][0] = 2;
    expect(pickHint(t, pos, () => 0)).toEqual({ house: 0, cat: 0 });
    t[0][0] = 0;
    const h = pickHint(t, pos, () => 0.99);
    expect(h).not.toBeNull();
    expect(t[h!.house][h!.cat]).toBeNull();
    const full = solutionToTable(pos, 3, 2);
    expect(pickHint(full, pos)).toBeNull();
  });
});

// ── Independent brute-force cross-check ─────────────────────────────────
// Deliberately shares no code with logic.ts (its own predicate and exhaustive permutation search), so a bug in the
// propagation solver cannot hide itself in the uniqueness / minimality tests.

function permutations(n: number): number[][] {
  const out: number[][] = [];
  const a = Array.from({ length: n }, (_, i) => i);
  const rec = (i: number): void => {
    if (i === n) {
      out.push(a.slice());
      return;
    }
    for (let j = i; j < n; j++) {
      [a[i], a[j]] = [a[j], a[i]];
      rec(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
  };
  rec(0);
  return out;
}

function bruteHolds(c: Clue, pos: number[][], n: number): boolean {
  const pa = pos[c.a.cat][c.a.item];
  if (c.type === 'at') return pa === c.k;
  if (c.type === 'notAt') return pa !== c.k;
  if (c.type === 'atEnd') return pa === 0 || pa === n - 1;
  const pb = pos[c.b!.cat][c.b!.item];
  if (c.type === 'same') return pa === pb;
  if (c.type === 'notSame') return pa !== pb;
  if (c.type === 'leftOf') return pa + 1 === pb;
  if (c.type === 'nextTo') return pa - pb === 1 || pb - pa === 1;
  if (c.type === 'somewhereLeft') return pa < pb;
  throw new Error('unknown clue type');
}

/** Exhaustively enumerate assignments (category by category, checking a clue once all its categories are set). */
function bruteSolutions(n: number, k: number, clues: Clue[], limit = 2): number[][][] {
  const all = permutations(n);
  const byCat: Clue[][] = Array.from({ length: k }, () => []);
  const unary: Clue[][] = Array.from({ length: k }, () => []);
  for (const c of clues) (c.b ? byCat[Math.max(c.a.cat, c.b.cat)] : unary[c.a.cat]).push(c);
  // Per category, only the permutations that satisfy its single-item clues.
  const permsFor = unary.map((us, cat) =>
    all.filter((p) => {
      const probe: number[][] = [];
      probe[cat] = p;
      return us.every((c) => bruteHolds(c, probe, n));
    }),
  );
  const pos: number[][] = [];
  const sols: number[][][] = [];
  const rec = (cat: number): void => {
    if (sols.length >= limit) return;
    if (cat === k) {
      sols.push(pos.map((r) => r.slice()));
      return;
    }
    for (const p of permsFor[cat]) {
      pos[cat] = p;
      if (byCat[cat].every((c) => bruteHolds(c, pos, n))) rec(cat + 1);
      if (sols.length >= limit) return;
    }
    pos.length = cat;
  };
  rec(0);
  return sols;
}

describe('brute-force cross-check', () => {
  it('agrees with the propagation solver on the hand-written puzzle', () => {
    expect(bruteSolutions(3, 2, handClues)).toEqual([handPos]);
    expect(bruteSolutions(3, 2, handClues.slice(0, 2))).toHaveLength(2);
    expect(bruteSolutions(3, 2, [], 1000)).toHaveLength(36);
  });
  for (const diff of DIFFICULTY_LIST) {
    it(`independently confirms generated ${diff} puzzles are true, unique, equal to the hidden solution and minimal`, { timeout: 30000 }, () => {
      const { n, k } = DIFFICULTIES[diff];
      for (let seed = 1; seed <= 6; seed++) {
        const p = generatePuzzle(diff, makeRng(seed * 7919 + 13));
        for (const c of p.clues) expect(bruteHolds(c, p.solution, n)).toBe(true);
        expect(bruteSolutions(n, k, p.clues)).toEqual([p.solution]);
        for (let i = 0; i < p.clues.length; i++) {
          const without = p.clues.filter((_, j) => j !== i);
          expect(bruteSolutions(n, k, without).length).toBe(2);
        }
      }
    });
  }
  it('agrees with the propagation solver on random (often ambiguous or contradictory) clue sets', () => {
    const rand = makeRng(2024);
    for (let trial = 0; trial < 40; trial++) {
      const n = 4;
      const k = 3;
      const pool = buildCluePool(randomSolution(n, k, rand), n, k, rand);
      // Mix true clues with clues from a different solution so some sets have no solution at all.
      const other = buildCluePool(randomSolution(n, k, rand), n, k, rand);
      const clues: Clue[] = [];
      const m = 3 + Math.floor(rand() * 8);
      for (let i = 0; i < m; i++) {
        const src = rand() < 0.8 ? pool : other;
        clues.push(src[Math.floor(rand() * src.length)]);
      }
      // 4!^3 = 13824 assignments exist, so a limit above that makes both solvers enumerate everything.
      const brute = bruteSolutions(n, k, clues, 20000);
      const fast = solve(n, k, clues, 20000, 1e7);
      expect(fast.aborted).toBe(false);
      expect(fast.count).toBe(brute.length);
      if (brute.length > 0) expect(brute).toContainEqual(fast.solution);
    }
  });
});

// ── Difficulty calibration ──────────────────────────────────────────────

describe('difficulty calibration', () => {
  const SEEDS = 24;
  const stats = (diff: Difficulty) => {
    let rating = 0;
    let at = 0;
    let clues = 0;
    let inBand = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const p = generatePuzzle(diff, makeRng(31337 + seed));
      rating += p.rating;
      at += p.clues.filter((c) => c.type === 'at').length;
      clues += p.clues.length;
      if (ratingDistance(diff, p.rating) === 0) inBand++;
    }
    return { rating: rating / SEEDS, atShare: at / clues, inBand };
  };
  const all = { easy: stats('easy'), medium: stats('medium'), hard: stats('hard') };

  it('keeps every generated puzzle inside its rating band (no trial-and-error outliers)', () => {
    for (const diff of DIFFICULTY_LIST) expect(all[diff].inBand).toBe(SEEDS);
    for (const diff of DIFFICULTY_LIST) {
      for (let seed = 100; seed < 110; seed++) {
        const p = generatePuzzle(diff, makeRng(seed));
        expect(p.rating).toBeGreaterThanOrEqual(RATING_RANGE[diff].min);
        expect(p.rating).toBeLessThanOrEqual(RATING_RANGE[diff].max);
      }
    }
  });
  it('bands rise with difficulty', () => {
    expect(RATING_RANGE.easy.max).toBeLessThan(RATING_RANGE.medium.max);
    expect(RATING_RANGE.medium.max).toBeLessThan(RATING_RANGE.hard.max);
    expect(RATING_RANGE.easy.min).toBeLessThan(RATING_RANGE.hard.min);
  });
  it('needs more case analysis on harder levels', () => {
    expect(all.easy.rating).toBeLessThan(all.medium.rating);
    expect(all.medium.rating).toBeLessThan(all.hard.rating);
  });
  it('uses fewer direct "lives in house k" clues on harder levels', () => {
    expect(all.easy.atShare).toBeGreaterThan(0.1);
    expect(all.easy.atShare).toBeGreaterThan(all.medium.atShare);
    expect(all.medium.atShare).toBeGreaterThanOrEqual(all.hard.atShare);
    expect(all.hard.atShare).toBeLessThan(0.03);
  });
  it('measures the distance from a band', () => {
    expect(ratingDistance('hard', RATING_RANGE.hard.min - 3)).toBe(3);
    expect(ratingDistance('hard', RATING_RANGE.hard.max + 5)).toBe(5);
    expect(ratingDistance('medium', RATING_RANGE.medium.min)).toBe(0);
  });
});

// ── Penalties ───────────────────────────────────────────────────────────

describe('penalties', () => {
  it('adds the hint and failed-check penalties', () => {
    expect(penaltySeconds(0, 0)).toBe(0);
    expect(penaltySeconds(1, 0)).toBe(HINT_PENALTY);
    expect(penaltySeconds(0, 1)).toBe(CHECK_PENALTY);
    expect(penaltySeconds(2, 3)).toBe(2 * HINT_PENALTY + 3 * CHECK_PENALTY);
  });
});

// ── Saved games ─────────────────────────────────────────────────────────

describe('parseSave', () => {
  const fresh = (diff: Difficulty = 'medium'): SavedGame => {
    const p = generatePuzzle(diff, makeRng(77));
    const table = emptyTable(p.n, p.k);
    const locked = Array.from({ length: p.n }, () => new Array<boolean>(p.k).fill(false));
    const sol = solutionToTable(p.solution, p.n, p.k);
    table[0][0] = sol[0][0];
    locked[0][0] = true;
    table[2][1] = (sol[2][1] + 1) % p.n; // a wrong (but legal) entry
    const struck = p.clues.map((_, i) => i % 3 === 0);
    return { v: SAVE_VERSION, puzzle: p, table, locked, struck, hints: 1, failedChecks: 2, elapsedMs: 12345 };
  };
  /** Simulate storage: a JSON round trip, then mutate. */
  const mutated = (fn: (s: Record<string, any>) => void, diff: Difficulty = 'medium'): unknown => {
    const s = JSON.parse(JSON.stringify(fresh(diff)));
    fn(s);
    return s;
  };

  it('round-trips a saved game through JSON', () => {
    for (const diff of DIFFICULTY_LIST) {
      const save = fresh(diff);
      expect(parseSave(JSON.parse(JSON.stringify(save)), diff)).toEqual(save);
    }
  });
  it('rejects missing or foreign data', () => {
    expect(parseSave(null, 'easy')).toBeNull();
    expect(parseSave('save', 'easy')).toBeNull();
    expect(parseSave([], 'easy')).toBeNull();
    expect(parseSave({}, 'easy')).toBeNull();
    expect(parseSave(mutated((s) => (s.v = SAVE_VERSION + 1)), 'medium')).toBeNull();
    // A medium save is not a hard (or easy) save.
    expect(parseSave(mutated(() => {}), 'hard')).toBeNull();
    expect(parseSave(mutated(() => {}), 'easy')).toBeNull();
  });
  it('rejects a corrupted puzzle', () => {
    expect(parseSave(mutated((s) => (s.puzzle.solution[0][0] = s.puzzle.solution[0][1])), 'medium')).toBeNull();
    expect(parseSave(mutated((s) => s.puzzle.solution.pop()), 'medium')).toBeNull();
    expect(parseSave(mutated((s) => (s.puzzle.clues = [])), 'medium')).toBeNull();
    expect(parseSave(mutated((s) => (s.puzzle.clues[0].type = 'bogus')), 'medium')).toBeNull();
    expect(parseSave(mutated((s) => (s.puzzle.clues[0].a.cat = 9)), 'medium')).toBeNull();
    // Dropping a clue of a minimal puzzle makes it ambiguous.
    expect(parseSave(mutated((s) => s.puzzle.clues.pop()), 'medium')).toBeNull();
    // A clue that contradicts the stored solution.
    expect(
      parseSave(
        mutated((s) => {
          const sol: number[][] = s.puzzle.solution;
          s.puzzle.clues[0] = { type: 'at', a: { cat: 0, item: 0 }, k: (sol[0][0] + 1) % 5 };
        }),
        'medium',
      ),
    ).toBeNull();
  });
  it('rejects corrupted player state', () => {
    expect(parseSave(mutated((s) => s.table.pop()), 'medium')).toBeNull();
    expect(parseSave(mutated((s) => (s.table[1][1] = 7)), 'medium')).toBeNull();
    expect(parseSave(mutated((s) => (s.table[1][1] = 'x')), 'medium')).toBeNull();
    expect(parseSave(mutated((s) => (s.locked[1][1] = 1)), 'medium')).toBeNull();
    // A locked (hint) cell must hold the correct item.
    expect(parseSave(mutated((s) => (s.locked[2][1] = true)), 'medium')).toBeNull();
    // The same item twice in one category.
    expect(
      parseSave(
        mutated((s) => {
          s.table[3][2] = 0;
          s.table[4][2] = 0;
        }),
        'medium',
      ),
    ).toBeNull();
    expect(parseSave(mutated((s) => s.struck.pop()), 'medium')).toBeNull();
    expect(parseSave(mutated((s) => (s.hints = -1)), 'medium')).toBeNull();
    expect(parseSave(mutated((s) => (s.failedChecks = 1.5)), 'medium')).toBeNull();
    expect(parseSave(mutated((s) => (s.elapsedMs = -5)), 'medium')).toBeNull();
    expect(parseSave(mutated((s) => (s.elapsedMs = 'soon')), 'medium')).toBeNull();
  });
  it('detects whether a game has progress worth keeping', () => {
    const t = emptyTable(5, 4);
    expect(hasProgress({ table: t, hints: 0, failedChecks: 0 })).toBe(false);
    expect(hasProgress({ table: t, hints: 1, failedChecks: 0 })).toBe(true);
    expect(hasProgress({ table: t, hints: 0, failedChecks: 1 })).toBe(true);
    t[4][3] = 2;
    expect(hasProgress({ table: t, hints: 0, failedChecks: 0 })).toBe(true);
  });
});

// ── UI dictionary (strings.ts) ──────────────────────────────────────────

describe('UI strings', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const zh = UI_STRINGS.zh;
  const en = UI_STRINGS.en;
  const indexSrc = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

  it('has identical key sets and matching placeholders in zh and en', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(zh)) {
      expect(zh[key].trim().length, key).toBeGreaterThan(0);
      expect(en[key].trim().length, key).toBeGreaterThan(0);
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]));
    }
  });
  it('does not collide with the generated content keys', () => {
    const content = contentStrings().en;
    for (const key of Object.keys(en)) expect(content[key], key).toBeUndefined();
  });
  it('defines both plural forms with a {n} placeholder', () => {
    for (const key of Object.keys(en)) {
      const m = /^(.*)(One|Many)$/.exec(key);
      if (!m) continue;
      expect(en[m[1] + 'One'], key).toBeDefined();
      expect(en[m[1] + 'Many'], key).toBeDefined();
      expect(placeholders(en[key])).toContain('n');
      expect(placeholders(zh[key])).toContain('n');
    }
    expect(en.hintsOne.replace('{n}', '1')).toBe('1 hint');
    expect(en.checksMany.replace('{n}', '2')).toBe('2 failed checks');
  });
  it('interpolates the penalty constants instead of hard-coding them', () => {
    for (const dict of [zh, en]) {
      expect(dict.rules).toContain(String(HINT_PENALTY));
      expect(dict.rules).toContain(String(CHECK_PENALTY));
      expect(dict.hintBtn).toContain(String(HINT_PENALTY));
      expect(dict.hintRevealed).toContain(String(HINT_PENALTY));
      expect(dict.wrongOne).toContain(String(CHECK_PENALTY));
      expect(dict.wrongMany).toContain(String(CHECK_PENALTY));
    }
  });
  it('has rules of 3 to 8 lines in both languages', () => {
    for (const dict of [zh, en]) {
      const lines = dict.rules.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.length).toBeLessThanOrEqual(8);
    }
  });
  it('uses every UI key in index.ts (no dead strings)', () => {
    for (const key of Object.keys(en)) {
      if (key === 'rules') continue; // shown by the shell
      if (/^(easy|medium|hard)Desc$/.test(key)) {
        expect(indexSrc).toContain("mode + 'Desc'");
        continue;
      }
      const plural = /^(.*)(One|Many)$/.exec(key);
      if (plural) {
        expect(indexSrc, key).toContain(`tn('${plural[1]}'`);
        continue;
      }
      expect(indexSrc, key).toContain(`'${key}'`);
    }
  });
  it('only translates keys that exist (own dictionary or the shell common dictionary)', () => {
    const i18nSrc = readFileSync(new URL('../../app/i18n.ts', import.meta.url), 'utf8');
    const common = new Set([...i18nSrc.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]));
    const used = new Set([...indexSrc.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(20);
    for (const key of used) expect(key in en || common.has(key), key).toBe(true);
    for (const base of [...indexSrc.matchAll(/\btn\('(\w+)'/g)].map((m) => m[1])) {
      expect(en[base + 'One'], base).toBeDefined();
      expect(en[base + 'Many'], base).toBeDefined();
    }
    for (const d of DIFFICULTY_LIST) {
      expect(en[d + 'Desc']).toBeDefined();
      expect(common.has(d)).toBe(true);
    }
  });
});
