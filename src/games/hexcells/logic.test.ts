import { describe, expect, it } from 'vitest';
import {
  BLUE,
  DIFFICULTIES,
  EMPTY,
  HIDDEN,
  applyDeduction,
  applyMark,
  buildConstraints,
  buildGrid,
  carveHoles,
  cellCenter,
  findDeduction,
  generatePuzzle,
  initialState,
  insideHex,
  isComplete,
  isSolvable,
  layoutGrid,
  makePuzzle,
  minimizeGivens,
  mulberry32,
  neighborCoords,
  pickCell,
  remainingBlue,
  solve,
  solvePass,
  type Difficulty,
  type Puzzle,
} from './logic';

/** Helper: build a full cols×rows puzzle from coordinate lists. */
function puzzleFrom(cols: number, rows: number, blues: [number, number][], givens: [number, number][]): Puzzle {
  const shape = buildGrid(cols, rows);
  const key = (c: number, r: number) => c * 1000 + r;
  const blueSet = new Set(blues.map(([c, r]) => key(c, r)));
  const givenSet = new Set(givens.map(([c, r]) => key(c, r)));
  const blue = shape.cells.map((cell) => blueSet.has(key(cell.col, cell.row)));
  const given = shape.cells.map((cell) => givenSet.has(key(cell.col, cell.row)));
  return makePuzzle(cols, rows, null, blue, given);
}

function idOf(p: Puzzle, col: number, row: number): number {
  return p.grid[col][row];
}

describe('neighborCoords (odd-q offset layout)', () => {
  it('even columns shift up', () => {
    expect(neighborCoords(2, 3)).toEqual([
      [3, 3],
      [3, 2],
      [2, 2],
      [1, 2],
      [1, 3],
      [2, 4],
    ]);
  });
  it('odd columns shift down', () => {
    expect(neighborCoords(3, 3)).toEqual([
      [4, 4],
      [4, 3],
      [3, 2],
      [2, 3],
      [2, 4],
      [3, 4],
    ]);
  });
  it('is symmetric on a full grid and clips the border', () => {
    const { cells, neighbors } = buildGrid(6, 7);
    for (const c of cells) {
      expect(neighbors[c.id].length).toBeGreaterThanOrEqual(2);
      expect(neighbors[c.id].length).toBeLessThanOrEqual(6);
      for (const n of neighbors[c.id]) expect(neighbors[n]).toContain(c.id);
    }
    const { grid, neighbors: nb } = buildGrid(3, 3);
    expect(nb[grid[0][0]].sort()).toEqual([grid[1][0], grid[0][1]].sort());
    expect(nb[grid[1][1]]).toHaveLength(6);
  });
});

describe('buildGrid with holes', () => {
  it('skips holes in the cell list, the lookup grid and neighbour lists', () => {
    const { cells, grid, neighbors } = buildGrid(3, 3, (c, r) => !(c === 1 && r === 0));
    expect(cells).toHaveLength(8);
    expect(grid[1][0]).toBe(-1);
    expect(neighbors[grid[0][0]]).toEqual([grid[0][1]]);
    expect(neighbors[grid[1][1]]).toHaveLength(5);
    cells.forEach((c, i) => expect(c.id).toBe(i));
  });
});

describe('carveHoles', () => {
  it('removes roughly the requested share and never strands a cell', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const rng = mulberry32(seed);
      const exists = carveHoles(9, 11, 0.1, rng);
      const { cells, neighbors } = buildGrid(9, 11, (c, r) => exists[c][r]);
      expect(cells.length).toBeLessThan(99);
      expect(cells.length).toBeGreaterThanOrEqual(99 - 10);
      for (const c of cells) expect(neighbors[c.id].length).toBeGreaterThanOrEqual(2);
    }
  });
  it('is deterministic per seed', () => {
    expect(carveHoles(7, 8, 0.1, mulberry32(5))).toEqual(carveHoles(7, 8, 0.1, mulberry32(5)));
  });
});

describe('makePuzzle', () => {
  it('computes clues, totals and rejects blue givens', () => {
    const p = puzzleFrom(3, 3, [[1, 0], [2, 1]], [[1, 1]]);
    expect(p.totalBlue).toBe(2);
    expect(p.clue[idOf(p, 1, 1)]).toBe(2);
    expect(p.clue[idOf(p, 0, 0)]).toBe(1);
    expect(p.clue[idOf(p, 2, 2)]).toBe(1);
    expect(() => puzzleFrom(3, 3, [[1, 1]], [[1, 1]])).toThrow();
  });
});

describe('state helpers', () => {
  it('initialState reveals only givens; marks resolve to the truth', () => {
    const p = puzzleFrom(3, 3, [[1, 0]], [[1, 1]]);
    const s = initialState(p);
    expect(s[idOf(p, 1, 1)]).toBe(EMPTY);
    expect(s.filter((v) => v === HIDDEN).length).toBe(8);
    expect(remainingBlue(p, s)).toBe(1);
    expect(applyMark(p, s, idOf(p, 1, 0), true)).toBe(true); // correct blue mark
    expect(s[idOf(p, 1, 0)]).toBe(BLUE);
    expect(remainingBlue(p, s)).toBe(0);
    expect(applyMark(p, s, idOf(p, 0, 0), true)).toBe(false); // wrong: it is empty
    expect(s[idOf(p, 0, 0)]).toBe(EMPTY);
    expect(() => applyMark(p, s, idOf(p, 0, 0), false)).toThrow();
    expect(isComplete(s)).toBe(false);
  });
});

describe('solver rules', () => {
  it('(a) satisfied clue → remaining neighbours empty', () => {
    const p = puzzleFrom(3, 3, [[0, 0]], [[1, 1]]);
    const d = findDeduction(p, initialState(p), 'basic');
    expect(d).not.toBeNull();
    expect(d!.rule).toBe('satisfied');
    expect(d!.blue).toBe(false);
    expect(d!.cells.sort()).toEqual(p.neighbors[idOf(p, 1, 1)].slice().sort());
    expect(d!.sources).toEqual([idOf(p, 1, 1)]);
  });

  it('(b) saturated clue → remaining neighbours blue', () => {
    const centreNs: [number, number][] = [
      [2, 2],
      [2, 1],
      [1, 0],
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    const p = puzzleFrom(3, 3, centreNs, [[1, 1]]);
    const d = findDeduction(p, initialState(p), 'basic');
    expect(d!.rule).toBe('saturated');
    expect(d!.blue).toBe(true);
    expect(d!.cells).toHaveLength(6);
  });

  it('(c) subset rule deduces on B \\ A', () => {
    // (0,0): neighbours (1,0),(0,1) with 1 blue; (1,1): neighbours (2,1),(1,0),(0,1) with 1 blue → (2,1) empty.
    const p = puzzleFrom(3, 2, [[1, 0]], [[0, 0], [1, 1]]);
    const s = initialState(p);
    const d = findDeduction(p, s, 'basic');
    expect(d!.rule).toBe('subset');
    expect(d!.blue).toBe(false);
    expect(d!.cells).toEqual([idOf(p, 2, 1)]);
    expect(d!.sources).toEqual([idOf(p, 0, 0), idOf(p, 1, 1)]);
    expect(solve(p, s, 'basic')).toBe(true);
  });

  it('(d) global remaining count resolves everything left', () => {
    const none = puzzleFrom(3, 3, [], [[0, 0]]);
    const deds = solvePass(none, initialState(none), 'basic');
    const g = deds.find((d) => d.rule === 'global');
    expect(g).toBeDefined();
    expect(g!.blue).toBe(false);
    expect(g!.cells).toHaveLength(8);

    const all = puzzleFrom(3, 3, [[1, 0], [0, 1], [1, 1], [2, 0], [2, 1], [0, 2], [1, 2], [2, 2]], [[0, 0]]);
    const d2 = solvePass(all, initialState(all), 'basic').find((d) => d.rule === 'global');
    expect(d2!.blue).toBe(true);
    expect(d2!.cells).toHaveLength(8);
  });

  it('global count combined with a clue (subset of global)', () => {
    // one blue in total, next to the given → every cell not adjacent to the given is empty
    const p = puzzleFrom(4, 4, [[1, 0]], [[0, 0]]);
    const s = initialState(p);
    const deds = solvePass(p, s, 'basic');
    expect(deds.some((d) => d.rule === 'satisfied' || d.rule === 'saturated')).toBe(false);
    const g = deds.find((d) => d.rule === 'global' && d.sources.length === 2);
    expect(g).toBeDefined();
    expect(g!.blue).toBe(false);
    expect(g!.cells.length).toBe(16 - 1 - p.neighbors[idOf(p, 0, 0)].length);
  });

  it('overlap rule (advanced only): 4-of-5 next to 1-of-5 sharing two cells', () => {
    const blues: [number, number][] = [
      [1, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [0, 0],
      [3, 2],
    ];
    const p = puzzleFrom(4, 3, blues, [[1, 1], [2, 1]]);
    const s = initialState(p);
    const adv = solvePass(p, s, 'advanced');
    const ov = adv.find((d) => d.rule === 'overlap');
    expect(ov).toBeDefined();
    expect(ov!.blue).toBe(false);
    expect(ov!.cells.sort()).toEqual([idOf(p, 3, 1), idOf(p, 3, 0), idOf(p, 2, 0)].sort());
    const basic = solvePass(p, s, 'basic');
    expect(basic.some((d) => d.rule === 'overlap')).toBe(false);
  });

  it('every deduction agrees with the solution', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const p = generatePuzzle('medium', seed, { minimize: false });
      const s = initialState(p);
      for (let guard = 0; guard < 500; guard++) {
        const deds = solvePass(p, s, 'advanced');
        if (!deds.length) break;
        const before = s.slice();
        for (const d of deds) {
          expect(d.cells.length).toBeGreaterThan(0);
          for (const id of d.cells) {
            expect(before[id]).toBe(HIDDEN);
            expect(p.blue[id]).toBe(d.blue);
          }
          applyDeduction(s, d);
        }
      }
      expect(isComplete(s)).toBe(true);
    }
  });

  it('buildConstraints skips fully resolved clues and tracks known blues', () => {
    const p = puzzleFrom(3, 3, [[1, 0], [2, 1]], [[1, 1]]);
    const s = initialState(p);
    s[idOf(p, 1, 0)] = BLUE;
    const cons = buildConstraints(p, s);
    const c = cons.find((k) => k.source === idOf(p, 1, 1))!;
    expect(c.need).toBe(1);
    expect(c.cells).toHaveLength(5);
    const g = cons.find((k) => k.source === -1)!;
    expect(g.need).toBe(1);
    expect(g.cells).toHaveLength(7);
  });
});

describe('generatePuzzle', () => {
  const diffs: Difficulty[] = ['easy', 'medium', 'hard'];
  for (const diff of diffs) {
    it(`${diff}: valid, consistent and solvable without guessing`, () => {
      const cfg = DIFFICULTIES[diff];
      for (let seed = 1; seed <= 5; seed++) {
        const p = generatePuzzle(diff, seed);
        expect(p.cols).toBe(cfg.cols);
        expect(p.rows).toBe(cfg.rows);
        const n = p.cells.length;
        expect(n).toBeLessThanOrEqual(cfg.cols * cfg.rows);
        expect(n).toBeGreaterThanOrEqual(Math.floor(cfg.cols * cfg.rows * (1 - cfg.holeRatio)) - 1);
        expect(p.totalBlue).toBe(p.blue.filter(Boolean).length);
        expect(Math.abs(p.totalBlue / n - cfg.blueRatio)).toBeLessThan(0.02);
        for (const c of p.cells) {
          expect(p.neighbors[c.id].length).toBeGreaterThanOrEqual(2);
          const blues = p.neighbors[c.id].filter((id) => p.blue[id]).length;
          expect(p.clue[c.id]).toBe(blues);
          if (p.given[c.id]) expect(p.blue[c.id]).toBe(false);
        }
        expect(p.given.some(Boolean)).toBe(true);
        expect(isSolvable(p, cfg.rules)).toBe(true);
      }
    });
  }

  it('is deterministic for a seed and varies across seeds', () => {
    const a = generatePuzzle('easy', 123);
    const b = generatePuzzle('easy', 123);
    expect(a.blue).toEqual(b.blue);
    expect(a.given).toEqual(b.given);
    const c = generatePuzzle('easy', 124);
    expect(c.blue).not.toEqual(a.blue);
  });

  it('minimizeGivens never breaks solvability and does not add givens', () => {
    const p = generatePuzzle('medium', 7, { minimize: false });
    const before = p.given.filter(Boolean).length;
    minimizeGivens(p, 'advanced', mulberry32(1));
    const after = p.given.filter(Boolean).length;
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThan(0);
    expect(isSolvable(p, 'advanced')).toBe(true);
  });

  it('easy puzzles are solvable with the basic rule set only', () => {
    for (let seed = 20; seed < 26; seed++) expect(isSolvable(generatePuzzle('easy', seed), 'basic')).toBe(true);
  });

  it('a hint is always available from any correct partial state', () => {
    for (const diff of diffs) {
      const p = generatePuzzle(diff, 99);
      const cfg = DIFFICULTIES[diff];
      const s = initialState(p);
      const rng = mulberry32(5);
      let steps = 0;
      while (!isComplete(s)) {
        // the player sometimes resolves a random cell (e.g. a "mistake" shown correctly) …
        if (rng() < 0.2) {
          const hidden: number[] = [];
          for (let i = 0; i < s.length; i++) if (s[i] === HIDDEN) hidden.push(i);
          const id = hidden[Math.floor(rng() * hidden.length)];
          applyMark(p, s, id, p.blue[id]);
          continue;
        }
        // … otherwise asks for a hint, which must always exist
        const d = findDeduction(p, s, cfg.rules);
        expect(d).not.toBeNull();
        expect(p.blue[d!.cells[0]]).toBe(d!.blue);
        applyMark(p, s, d!.cells[0], d!.blue);
        if (++steps > 1000) throw new Error('did not finish');
      }
      expect(remainingBlue(p, s)).toBe(0);
    }
  });
});

describe('geometry', () => {
  it('layoutGrid fits every hex inside the box with the margin', () => {
    const p = generatePuzzle('hard', 3);
    const L = layoutGrid(p, 390, 560, 8);
    expect(L.size).toBeGreaterThan(10);
    for (const c of p.cells) {
      const { x, y } = cellCenter(c.col, c.row, L);
      expect(x - L.size).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(x + L.size).toBeLessThanOrEqual(390 - 8 + 1e-6);
      expect(y - L.size).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(y + L.size).toBeLessThanOrEqual(560 - 8 + 1e-6);
    }
  });
  it('caps the hex size on large screens', () => {
    const p = generatePuzzle('easy', 3);
    expect(layoutGrid(p, 2000, 2000, 8).size).toBe(44);
  });
  it('insideHex handles edges and corners', () => {
    expect(insideHex(0, 0, 0, 0, 10)).toBe(true);
    expect(insideHex(9.9, 0, 0, 0, 10)).toBe(true);
    expect(insideHex(10.1, 0, 0, 0, 10)).toBe(false);
    expect(insideHex(0, 8.6, 0, 0, 10)).toBe(true);
    expect(insideHex(0, 8.7, 0, 0, 10)).toBe(false);
    expect(insideHex(7, 7, 0, 0, 10)).toBe(false);
    expect(insideHex(4, 7, 0, 0, 10)).toBe(true);
  });
  it('pickCell finds the cell under its centre and nothing outside the board', () => {
    const p = generatePuzzle('medium', 11);
    const L = layoutGrid(p, 390, 600, 8);
    for (const c of p.cells) {
      const { x, y } = cellCenter(c.col, c.row, L);
      expect(pickCell(p, L, x, y)).toBe(c.id);
      expect(pickCell(p, L, x + L.size * 0.5, y)).toBe(c.id);
    }
    expect(pickCell(p, L, 1, 1)).toBe(-1);
    expect(pickCell(p, L, 389, 599)).toBe(-1);
  });
});

describe('minimizeGivens keep floor', () => {
  it('stops removing once the floor is reached', () => {
    const p = generatePuzzle('hard', 31, { minimize: false });
    const before = p.given.filter(Boolean).length;
    minimizeGivens(p, 'advanced', mulberry32(2), before);
    expect(p.given.filter(Boolean).length).toBe(before);
    minimizeGivens(p, 'advanced', mulberry32(2), 0);
    expect(p.given.filter(Boolean).length).toBeLessThanOrEqual(before);
    expect(isSolvable(p, 'advanced')).toBe(true);
  });
  it('generated boards respect minGivens', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      for (let seed = 40; seed < 44; seed++) {
        const p = generatePuzzle(d, seed);
        expect(p.given.filter(Boolean).length).toBeGreaterThanOrEqual(Math.min(DIFFICULTIES[d].minGivens, 3));
      }
    }
  });
});
