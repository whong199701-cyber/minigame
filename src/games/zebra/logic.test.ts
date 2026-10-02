import { describe, expect, it } from 'vitest';
import {
  AT_CAP,
  BINARY_TYPES,
  CATEGORIES,
  CLUE_TEMPLATES,
  CLUE_TYPES,
  DIFFICULTIES,
  DIFFICULTY_LIST,
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
  isSolved,
  makeRng,
  pickHint,
  randomSolution,
  solutionToTable,
  solve,
  type Clue,
  type Table,
} from './logic';

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
