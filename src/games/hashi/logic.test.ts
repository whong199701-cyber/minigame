import { describe, expect, it } from 'vitest';
import {
  MODES,
  MODE_IDS,
  bfsDistances,
  blockersOf,
  boardOf,
  buildBoard,
  checkBoard,
  components,
  degrees,
  edgeBetween,
  edgeGap,
  edgesCross,
  findHint,
  generateCandidate,
  generatePuzzle,
  hasCrossing,
  initialHi,
  isConnected,
  isModeId,
  isSolved,
  islandStates,
  nextCount,
  otherEnd,
  propagate,
  rng,
  segmentsCross,
  solve,
  validatePuzzle,
  type Board,
  type Island,
  type Puzzle,
} from './logic';

/** Build a board from an ASCII picture: digits are islands, everything else is water. */
function parse(rows: string[]): Board {
  const islands: Island[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c >= '1' && c <= '8') islands.push({ x, y, n: Number(c) });
    }
  });
  return buildBoard(rows[0].length, rows.length, islands);
}

function islandAt(b: Board, x: number, y: number): number {
  return b.islands.findIndex((p) => p.x === x && p.y === y);
}

function edgeAt(b: Board, x1: number, y1: number, x2: number, y2: number): number {
  return edgeBetween(b, islandAt(b, x1, y1), islandAt(b, x2, y2));
}

function set(b: Board, pairs: [number, number, number, number, number][]): number[] {
  const br = new Array<number>(b.edges.length).fill(0);
  for (const [x1, y1, x2, y2, v] of pairs) {
    const e = edgeAt(b, x1, y1, x2, y2);
    if (e < 0) throw new Error(`no edge ${x1},${y1}-${x2},${y2}`);
    br[e] = v;
  }
  return br;
}

// A plus-shaped crossing: horizontal 1–1 across the middle row, vertical 1–1 down the middle column.
const PLUS = ['..1..', '.....', '1...1', '.....', '..1..'];

describe('segmentsCross / edgesCross', () => {
  it('detects a strict interior crossing', () => {
    expect(segmentsCross(0, 4, 2, 2, 0, 4)).toBe(true);
    expect(segmentsCross(4, 0, 2, 2, 4, 0)).toBe(true);
  });
  it('does not count touching endpoints or out-of-span segments', () => {
    expect(segmentsCross(0, 4, 2, 0, 0, 4)).toBe(false); // vertical at the horizontal's endpoint column
    expect(segmentsCross(0, 4, 2, 2, 2, 5)).toBe(false); // vertical starts on the row
    expect(segmentsCross(0, 4, 2, 6, 0, 4)).toBe(false); // to the right
    expect(segmentsCross(0, 4, 6, 2, 0, 4)).toBe(false); // below
  });
  it('never treats parallel edges as crossing', () => {
    const b = parse(['1.1', '...', '1.1']);
    const top = edgeAt(b, 0, 0, 2, 0);
    const bottom = edgeAt(b, 0, 2, 2, 2);
    expect(edgesCross(b.islands, b.edges[top], b.edges[bottom])).toBe(false);
    expect(b.cross.every((c) => c.length === 0)).toBe(true);
  });
  it('builds crossing lists on a plus shape', () => {
    const b = parse(PLUS);
    expect(b.edges).toHaveLength(2);
    expect(b.cross[0]).toEqual([1]);
    expect(b.cross[1]).toEqual([0]);
  });
});

describe('buildBoard', () => {
  const b = parse(['2.3.1', '.....', '3.4..', '.....', '..2.1']);
  it('links only nearest aligned islands', () => {
    // Row 0: (0,0)-(2,0)-(4,0); no direct (0,0)-(4,0) edge.
    expect(edgeAt(b, 0, 0, 2, 0)).toBeGreaterThanOrEqual(0);
    expect(edgeAt(b, 2, 0, 4, 0)).toBeGreaterThanOrEqual(0);
    expect(edgeAt(b, 0, 0, 4, 0)).toBe(-1);
    // Column 2: (2,0)-(2,2)-(2,4)
    expect(edgeAt(b, 2, 0, 2, 2)).toBeGreaterThanOrEqual(0);
    expect(edgeAt(b, 2, 2, 2, 4)).toBeGreaterThanOrEqual(0);
    expect(edgeAt(b, 2, 0, 2, 4)).toBe(-1);
    // Column 4: (4,0)-(4,4)
    expect(edgeAt(b, 4, 0, 4, 4)).toBeGreaterThanOrEqual(0);
  });
  it('orders edge ends left/top first and fills the direction table', () => {
    for (let e = 0; e < b.edges.length; e++) {
      const ed = b.edges[e];
      const A = b.islands[ed.a];
      const B = b.islands[ed.b];
      if (ed.horizontal) {
        expect(A.y).toBe(B.y);
        expect(A.x).toBeLessThan(B.x);
        expect(b.nbr[ed.a * 4 + 1]).toBe(e);
        expect(b.nbr[ed.b * 4 + 3]).toBe(e);
      } else {
        expect(A.x).toBe(B.x);
        expect(A.y).toBeLessThan(B.y);
        expect(b.nbr[ed.a * 4 + 2]).toBe(e);
        expect(b.nbr[ed.b * 4 + 0]).toBe(e);
      }
      expect(otherEnd(b, e, ed.a)).toBe(ed.b);
      expect(otherEnd(b, e, ed.b)).toBe(ed.a);
    }
    const corner = islandAt(b, 0, 0);
    expect(b.nbr[corner * 4 + 0]).toBe(-1);
    expect(b.nbr[corner * 4 + 3]).toBe(-1);
  });
  it('measures gaps between islands', () => {
    expect(edgeGap(b, edgeAt(b, 0, 0, 2, 0))).toBe(1);
    expect(edgeGap(b, edgeAt(b, 4, 0, 4, 4))).toBe(3);
  });
});

describe('degrees, states and blockers', () => {
  const b = parse(['2.3.1', '.....', '3.4..', '.....', '..2.1']);
  it('counts bridges per island', () => {
    const br = set(b, [
      [0, 0, 2, 0, 2],
      [2, 0, 2, 2, 1],
    ]);
    const d = degrees(b, br);
    expect(d[islandAt(b, 0, 0)]).toBe(2);
    expect(d[islandAt(b, 2, 0)]).toBe(3);
    expect(d[islandAt(b, 2, 2)]).toBe(1);
    expect(d[islandAt(b, 4, 4)]).toBe(0);
    const st = islandStates(b, br);
    expect(st[islandAt(b, 0, 0)]).toBe(0);
    expect(st[islandAt(b, 2, 0)]).toBe(0);
    expect(st[islandAt(b, 2, 2)]).toBe(-1);
  });
  it('flags over-connected islands', () => {
    const br = set(b, [
      [2, 0, 4, 0, 2],
      [4, 0, 4, 4, 1],
    ]);
    expect(islandStates(b, br)[islandAt(b, 4, 0)]).toBe(1);
  });
  it('finds bridges blocking a crossing edge', () => {
    const p = parse(PLUS);
    const h = edgeAt(p, 0, 2, 4, 2);
    const v = edgeAt(p, 2, 0, 2, 4);
    const br = new Array(2).fill(0);
    expect(blockersOf(p, br, h)).toEqual([]);
    br[v] = 1;
    expect(blockersOf(p, br, h)).toEqual([v]);
    expect(hasCrossing(p, br)).toBe(false);
    br[h] = 2;
    expect(hasCrossing(p, br)).toBe(true);
  });
  it('cycles counts 0 → 1 → 2 → 0', () => {
    expect([0, 1, 2].map(nextCount)).toEqual([1, 2, 0]);
  });
});

describe('connectivity', () => {
  const b = parse(['1.2.1', '.....', '1...1']);
  it('reports components', () => {
    const none = new Array(b.edges.length).fill(0);
    expect(components(b, none).count).toBe(b.islands.length);
    expect(isConnected(b, none)).toBe(false);
    const all = set(b, [
      [0, 0, 2, 0, 1],
      [2, 0, 4, 0, 1],
      [0, 0, 0, 2, 1],
      [4, 0, 4, 2, 1],
    ]);
    expect(isConnected(b, all)).toBe(true);
    const split = set(b, [
      [0, 0, 2, 0, 1],
      [4, 0, 4, 2, 1],
    ]);
    const c = components(b, split);
    expect(c.count).toBe(3);
    expect(c.id[islandAt(b, 0, 0)]).toBe(c.id[islandAt(b, 2, 0)]);
    expect(c.id[islandAt(b, 0, 0)]).not.toBe(c.id[islandAt(b, 4, 0)]);
  });
  it('computes BFS distances over used edges', () => {
    const br = set(b, [
      [0, 2, 0, 0, 1],
      [0, 0, 2, 0, 1],
      [2, 0, 4, 0, 1],
    ]);
    const d = bfsDistances(b, br, islandAt(b, 0, 2));
    expect(d[islandAt(b, 0, 2)]).toBe(0);
    expect(d[islandAt(b, 0, 0)]).toBe(1);
    expect(d[islandAt(b, 2, 0)]).toBe(2);
    expect(d[islandAt(b, 4, 0)]).toBe(3);
    expect(d[islandAt(b, 4, 2)]).toBe(-1);
  });
});

describe('checkBoard / isSolved', () => {
  // 2—2
  // |  |
  // 2—2  is not the solution (top/bottom double would split); the ring of singles is.
  const ring = parse(['2.2', '...', '2.2']);
  it('accepts a valid connected arrangement', () => {
    const br = set(ring, [
      [0, 0, 2, 0, 1],
      [0, 2, 2, 2, 1],
      [0, 0, 0, 2, 1],
      [2, 0, 2, 2, 1],
    ]);
    const c = checkBoard(ring, br);
    expect(c).toMatchObject({ satisfied: 4, allDegrees: true, crossing: false, connected: true, solved: true });
  });
  it('rejects correct degrees that leave two groups', () => {
    const br = set(ring, [
      [0, 0, 2, 0, 2],
      [0, 2, 2, 2, 2],
    ]);
    const c = checkBoard(ring, br);
    expect(c.allDegrees).toBe(true);
    expect(c.connected).toBe(false);
    expect(c.solved).toBe(false);
  });
  it('rejects wrong degrees', () => {
    const br = set(ring, [
      [0, 0, 2, 0, 1],
      [0, 2, 2, 2, 1],
      [0, 0, 0, 2, 1],
    ]);
    expect(isSolved(ring, br)).toBe(false);
    expect(checkBoard(ring, br).satisfied).toBe(2);
  });
  it('rejects crossing bridges even when counts fit', () => {
    const p = parse(PLUS);
    const br = [1, 1];
    const c = checkBoard(p, br);
    expect(c.allDegrees).toBe(true);
    expect(c.crossing).toBe(true);
    expect(c.solved).toBe(false);
  });
  it('rejects out-of-range bridge counts', () => {
    const p = parse(['2.2']);
    expect(isSolved(p, [2])).toBe(true);
    expect(isSolved(p, [3])).toBe(false);
  });
});

describe('solver', () => {
  it('applies the isolation rules to initial bounds', () => {
    const b = parse(['1.1.2', '.....', '2...2']);
    const hi = initialHi(b);
    expect(hi[edgeAt(b, 0, 0, 2, 0)]).toBe(0); // 1–1 would be a closed pair
    expect(hi[edgeAt(b, 4, 0, 4, 2)]).toBe(1); // 2=2 would be a closed pair
    expect(hi[edgeAt(b, 2, 0, 4, 0)]).toBe(1); // limited by the 1
    // With only two islands the pair is the whole puzzle and is allowed.
    const pair = parse(['2..2']);
    expect(initialHi(pair)[0]).toBe(2);
  });
  it('solves a small puzzle by propagation alone', () => {
    const b = parse(['2.3..', '.....', '..4.2', '.....', '..1..']);
    const r = solve(b);
    expect(r.count).toBe(1);
    expect(r.nodes).toBe(1);
    const s = r.solution as number[];
    expect(isSolved(b, s)).toBe(true);
    expect(s[edgeAt(b, 0, 0, 2, 0)]).toBe(2);
    expect(s[edgeAt(b, 2, 0, 2, 2)]).toBe(1);
    expect(s[edgeAt(b, 2, 2, 4, 2)]).toBe(2);
    expect(s[edgeAt(b, 2, 2, 2, 4)]).toBe(1);
  });
  it('finds every solution of an ambiguous lattice and each one is valid', () => {
    const b = parse(['3.4.1', '.....', '2.4.2', '.....', '1.3.2']);
    const r = solve(b, { limit: 10 });
    expect(r.count).toBeGreaterThanOrEqual(2);
    expect(isSolved(b, r.solution as number[])).toBe(true);
  });
  it('counts multiple solutions', () => {
    // Four 3s on a square: (top,left) can be (1,2) or (2,1).
    const b = parse(['3.3', '...', '3.3']);
    const r = solve(b, { limit: 5 });
    expect(r.count).toBe(2);
    expect(r.aborted).toBe(false);
  });
  it('reports unsolvable puzzles', () => {
    expect(solve(parse(['1.1.1'])).count).toBe(0);
    expect(solve(parse(PLUS)).count).toBe(0); // the only edges cross
  });
  it('respects starting bounds', () => {
    const b = parse(['3.3', '...', '3.3']);
    const top = edgeAt(b, 0, 0, 2, 0);
    const lo = new Array(b.edges.length).fill(0);
    lo[top] = 2;
    const r = solve(b, { lo, limit: 5 });
    expect(r.count).toBe(1);
    expect((r.solution as number[])[top]).toBe(2);
  });
  it('propagation detects contradictions and forces cut edges', () => {
    const b = parse(['1...2...1']);
    const lo = new Int8Array(b.edges.length);
    const hi = initialHi(b);
    expect(propagate(b, lo, hi)).toBe(true);
    expect(Array.from(lo)).toEqual([1, 1]);
    const bad = parse(['1.1']);
    const lo2 = new Int8Array(1);
    const hi2 = new Int8Array([2]);
    lo2[0] = 2;
    expect(propagate(bad, lo2, hi2)).toBe(false);
  });
  it('honours the abort budget', () => {
    const b = parse(['3.3', '...', '3.3']);
    const r = solve(b, { maxNodes: 1, limit: 5 });
    expect(r.aborted).toBe(true);
  });
});

function assertWellFormed(p: Puzzle): void {
  expect(validatePuzzle(p)).toBe(true);
  const b = boardOf(p);
  // Islands are never orthogonally adjacent and numbers stay within 1..8.
  const pos = new Set(p.islands.map((q) => q.y * p.w + q.x));
  for (const q of p.islands) {
    expect(q.n).toBeGreaterThanOrEqual(1);
    expect(q.n).toBeLessThanOrEqual(8);
    expect(q.x >= 0 && q.y >= 0 && q.x < p.w && q.y < p.h).toBe(true);
    if (q.x + 1 < p.w) expect(pos.has(q.y * p.w + q.x + 1)).toBe(false);
    if (q.y + 1 < p.h) expect(pos.has((q.y + 1) * p.w + q.x)).toBe(false);
  }
  // The hidden solution satisfies every rule.
  const c = checkBoard(b, p.solution);
  expect(c.solved).toBe(true);
  expect(c.crossing).toBe(false);
  expect(c.connected).toBe(true);
  expect(degrees(b, p.solution)).toEqual(p.islands.map((q) => q.n));
}

describe('generateCandidate', () => {
  for (const mode of MODE_IDS) {
    it(`grows valid ${mode} solutions`, () => {
      const rand = rng(1000 + mode.length);
      const cfg = MODES[mode];
      let made = 0;
      for (let i = 0; i < 60; i++) {
        const p = generateCandidate(cfg, rand);
        if (!p) continue;
        made++;
        expect(p.w).toBe(cfg.size);
        expect(p.h).toBe(cfg.size);
        expect(p.islands.length).toBeGreaterThanOrEqual(Math.ceil(cfg.islands * 0.9));
        expect(p.islands.length).toBeLessThanOrEqual(cfg.islands);
        assertWellFormed(p);
      }
      expect(made).toBeGreaterThan(50);
    });
  }
  it('is deterministic for a seed', () => {
    const a = generateCandidate(MODES.medium, rng(42));
    const b = generateCandidate(MODES.medium, rng(42));
    expect(a).toEqual(b);
  });
});

describe('generatePuzzle', () => {
  for (const mode of MODE_IDS) {
    it(`produces unique, logically solvable ${mode} puzzles`, () => {
      const rand = rng(7 + mode.length * 13);
      for (let i = 0; i < 12; i++) {
        const g = generatePuzzle(mode, rand, { timeBudgetMs: 1000 });
        assertWellFormed(g.puzzle);
        expect(g.unique).toBe(true);
        const r = solve(boardOf(g.puzzle), { limit: 2, maxNodes: 100000 });
        expect(r.count).toBe(1);
        expect(r.solution).toEqual(g.puzzle.solution);
      }
    });
  }
  it('makes harder sizes need more look-ahead on average', () => {
    const rand = rng(99);
    const avg = (mode: 'easy' | 'hard'): number => {
      let s = 0;
      for (let i = 0; i < 10; i++) s += generatePuzzle(mode, rand, { timeBudgetMs: 1000 }).nodes;
      return s / 10;
    };
    expect(avg('hard')).toBeGreaterThan(avg('easy'));
  });
  it('stays fast enough for the main thread', () => {
    const rand = rng(5);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) generatePuzzle('hard', rand);
    expect((performance.now() - t0) / 5).toBeLessThan(400);
  });
});

describe('findHint', () => {
  it('walks a unique puzzle to a solution using only hints', () => {
    for (const mode of MODE_IDS) {
      const g = generatePuzzle(mode, rng(321 + mode.length));
      const b = boardOf(g.puzzle);
      const cur = new Array<number>(b.edges.length).fill(0);
      let steps = 0;
      while (!isSolved(b, cur) && steps < 200) {
        const h = findHint(b, g.puzzle.solution, cur);
        expect(h).not.toBeNull();
        if (!h) break;
        expect(h.kind).toBe('add');
        // In a unique puzzle a hinted value never exceeds the solution.
        expect(h.value).toBeLessThanOrEqual(g.puzzle.solution[h.edge]);
        expect(h.value).toBeGreaterThan(cur[h.edge]);
        cur[h.edge] = h.value;
        steps++;
      }
      expect(isSolved(b, cur)).toBe(true);
      expect(findHint(b, g.puzzle.solution, cur)).toBeNull();
    }
  });
  it('points out a wrong bridge', () => {
    const g = generatePuzzle('medium', rng(77));
    const b = boardOf(g.puzzle);
    const cur = new Array<number>(b.edges.length).fill(0);
    // Build a bridge that the unique solution does not use.
    const wrong = g.puzzle.solution.findIndex((v) => v === 0);
    expect(wrong).toBeGreaterThanOrEqual(0);
    cur[wrong] = 1;
    const h = findHint(b, g.puzzle.solution, cur);
    expect(h).not.toBeNull();
    expect(h?.kind).toBe('fix');
    expect(h?.edge).toBe(wrong);
    expect(h?.value).toBe(0);
  });
  it('prefers deductions that are forced', () => {
    const b = parse(['1...2...1']);
    const sol = [1, 1];
    const h = findHint(b, sol, [0, 0]);
    expect(h).toMatchObject({ kind: 'add', forced: true, value: 1 });
  });
});

describe('validatePuzzle', () => {
  const good: Puzzle = { w: 3, h: 1, islands: [{ x: 0, y: 0, n: 2 }, { x: 2, y: 0, n: 2 }], solution: [2] };
  it('accepts a correct puzzle', () => {
    expect(validatePuzzle(good)).toBe(true);
  });
  it('rejects garbage and broken data', () => {
    expect(validatePuzzle(null)).toBe(false);
    expect(validatePuzzle('x')).toBe(false);
    expect(validatePuzzle({ ...good, w: 'a' })).toBe(false);
    expect(validatePuzzle({ ...good, solution: [1] })).toBe(false); // numbers not met
    expect(validatePuzzle({ ...good, solution: [2, 0] })).toBe(false); // wrong length
    expect(validatePuzzle({ ...good, islands: [{ x: 0, y: 0, n: 2 }, { x: 0, y: 0, n: 2 }] })).toBe(false);
    expect(validatePuzzle({ ...good, islands: [{ x: 0, y: 0, n: 2 }, { x: 5, y: 0, n: 2 }] })).toBe(false);
    expect(validatePuzzle({ ...good, islands: [{ x: 0, y: 0, n: 9 }, { x: 2, y: 0, n: 9 }] })).toBe(false);
  });
  it('rejects a stored solution that crosses', () => {
    const islands = [
      { x: 2, y: 0, n: 1 },
      { x: 0, y: 2, n: 1 },
      { x: 4, y: 2, n: 1 },
      { x: 2, y: 4, n: 1 },
    ];
    expect(validatePuzzle({ w: 5, h: 5, islands, solution: [1, 1] })).toBe(false);
  });
});

describe('modes', () => {
  it('match the brief', () => {
    expect(MODES.easy).toEqual({ size: 7, islands: 10 });
    expect(MODES.medium).toEqual({ size: 10, islands: 20 });
    expect(MODES.hard).toEqual({ size: 13, islands: 35 });
    expect(isModeId('hard')).toBe(true);
    expect(isModeId('expert')).toBe(false);
    expect(isModeId(3)).toBe(false);
  });
});
