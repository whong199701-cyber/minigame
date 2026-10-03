import { describe, expect, it } from 'vitest';
import {
  DOWN,
  LEFT,
  MODES,
  MODE_IDS,
  RIGHT,
  UP,
  computePar,
  computePower,
  countDangling,
  deduce,
  degree,
  generatePuzzle,
  hintTile,
  isModeId,
  isSolved,
  minRotations,
  mulberry32,
  neighbour,
  opposite,
  period,
  rotCW,
  rotateTimes,
  scramble,
  spanningTree,
  type Puzzle,
} from './logic';

/** Bring every tile of a puzzle into its solved orientation by applying the minimal clockwise rotations. */
function solveByPar(p: Puzzle): { tiles: Uint8Array; turns: number } {
  const tiles = p.tiles.slice();
  let turns = 0;
  for (let i = 0; i < tiles.length; i++) {
    const r = minRotations(tiles[i], p.solution[i]);
    expect(r).toBeGreaterThanOrEqual(0);
    for (let k = 0; k < r; k++) tiles[i] = rotCW(tiles[i]);
    turns += r;
  }
  return { tiles, turns };
}

describe('rotation math', () => {
  it('rotates connectors clockwise', () => {
    expect(rotCW(UP)).toBe(RIGHT);
    expect(rotCW(RIGHT)).toBe(DOWN);
    expect(rotCW(DOWN)).toBe(LEFT);
    expect(rotCW(LEFT)).toBe(UP);
    expect(rotCW(UP | RIGHT)).toBe(RIGHT | DOWN);
    expect(rotCW(15)).toBe(15);
  });
  it('returns to the start after four rotations', () => {
    for (let m = 1; m < 16; m++) expect(rotateTimes(m, 4)).toBe(m);
    expect(rotateTimes(UP, -1)).toBe(LEFT);
  });
  it('knows the symmetry period of each tile type', () => {
    expect(period(15)).toBe(1);
    expect(period(UP | DOWN)).toBe(2);
    expect(period(LEFT | RIGHT)).toBe(2);
    expect(period(UP)).toBe(4);
    expect(period(UP | RIGHT)).toBe(4);
    expect(period(UP | RIGHT | DOWN)).toBe(4);
  });
  it('computes minimal clockwise rotations respecting symmetry', () => {
    expect(minRotations(UP, UP)).toBe(0);
    expect(minRotations(UP, RIGHT)).toBe(1);
    expect(minRotations(UP, LEFT)).toBe(3);
    expect(minRotations(UP | DOWN, LEFT | RIGHT)).toBe(1); // straight: never more than 1
    expect(minRotations(15, 15)).toBe(0);
    expect(minRotations(UP, UP | DOWN)).toBe(-1); // different tile types
  });
  it('counts connectors and opposite directions', () => {
    expect(degree(0)).toBe(0);
    expect(degree(UP | LEFT)).toBe(2);
    expect(degree(15)).toBe(4);
    expect(opposite(0)).toBe(2);
    expect(opposite(1)).toBe(3);
    expect(opposite(3)).toBe(1);
  });
});

describe('neighbour', () => {
  it('returns -1 outside a non-wrapping grid', () => {
    expect(neighbour(5, false, 0, 0)).toBe(-1); // up from top-left
    expect(neighbour(5, false, 0, 3)).toBe(-1); // left from top-left
    expect(neighbour(5, false, 24, 1)).toBe(-1); // right from bottom-right
    expect(neighbour(5, false, 24, 2)).toBe(-1);
    expect(neighbour(5, false, 12, 0)).toBe(7);
    expect(neighbour(5, false, 12, 1)).toBe(13);
    expect(neighbour(5, false, 12, 2)).toBe(17);
    expect(neighbour(5, false, 12, 3)).toBe(11);
  });
  it('wraps across the borders in wrap mode', () => {
    expect(neighbour(5, true, 0, 0)).toBe(20);
    expect(neighbour(5, true, 0, 3)).toBe(4);
    expect(neighbour(5, true, 24, 1)).toBe(20);
    expect(neighbour(5, true, 24, 2)).toBe(4);
  });
  it('is symmetric: going back returns to the origin', () => {
    for (const wrap of [false, true]) {
      for (let i = 0; i < 49; i++) {
        for (let d = 0; d < 4; d++) {
          const j = neighbour(7, wrap, i, d);
          if (j >= 0) expect(neighbour(7, wrap, j, opposite(d))).toBe(i);
        }
      }
    }
  });
});

describe('spanningTree', () => {
  for (const id of MODE_IDS) {
    const { size, wrap, crossChance } = MODES[id];
    it(`covers every tile with mutual connectors (${id})`, () => {
      const rand = mulberry32(7);
      for (let round = 0; round < 5; round++) {
        const source = Math.floor((size * size) / 2);
        const masks = spanningTree(size, wrap, source, rand, crossChance);
        let connectors = 0;
        for (let i = 0; i < masks.length; i++) {
          expect(degree(masks[i])).toBeGreaterThanOrEqual(1);
          connectors += degree(masks[i]);
        }
        expect(connectors).toBe(2 * (size * size - 1)); // a tree has n-1 edges
        expect(countDangling(size, wrap, masks)).toBe(0);
        expect(computePower(size, wrap, masks, source).count).toBe(size * size);
      }
    });
  }
  it('never points off a non-wrapping grid', () => {
    const masks = spanningTree(7, false, 24, mulberry32(3));
    for (let i = 0; i < 49; i++) {
      for (let d = 0; d < 4; d++) {
        if (masks[i] & (1 << d)) expect(neighbour(7, false, i, d)).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it('uses wrap-around edges in wrap mode', () => {
    let wrapped = 0;
    const rand = mulberry32(11);
    for (let round = 0; round < 10; round++) {
      const masks = spanningTree(7, true, 24, rand);
      for (let x = 0; x < 7; x++) if (masks[x] & UP) wrapped++; // top row pointing up => wraps to bottom
    }
    expect(wrapped).toBeGreaterThan(0);
  });
  it('rarely creates crosses when crossChance is 0', () => {
    const rand = mulberry32(5);
    let crosses = 0;
    for (let round = 0; round < 10; round++) {
      const masks = spanningTree(9, false, 40, rand, 0);
      for (let i = 0; i < masks.length; i++) if (masks[i] === 15) crosses++;
    }
    expect(crosses).toBe(0);
  });
});

describe('power and win detection', () => {
  // 3x3 board, source in the centre, a simple plus-shaped tree:
  //   .  |  .
  //   ─  ┼  ─
  //   .  |  .
  const size = 3;
  const src = 4;
  const solved = new Uint8Array([0, DOWN, 0, RIGHT, 15, LEFT, 0, UP, 0]);
  it('powers every tile of a solved board', () => {
    const r = computePower(size, false, solved, src);
    expect(r.count).toBe(5); // corners have no connectors (0 masks are allowed by BFS)
    expect(r.dist[src]).toBe(0);
    expect(r.dist[1]).toBe(1);
    expect(r.dist[0]).toBe(-1);
  });
  it('does not power through one-sided connections', () => {
    const tiles = solved.slice();
    tiles[1] = LEFT; // rotated away from the source
    const r = computePower(size, false, tiles, src);
    expect(r.powered[1]).toBe(0);
    expect(r.count).toBe(4);
    expect(countDangling(size, false, tiles)).toBe(2); // the source's up arm and tile 1's left arm
  });
  it('detects a solved generated puzzle and rejects any single wrong tile', () => {
    const p = generatePuzzle(MODES.easy, mulberry32(42));
    expect(isSolved(p.size, p.wrap, p.solution, p.source)).toBe(true);
    for (let i = 0; i < p.solution.length; i++) {
      if (period(p.solution[i]) === 1) continue;
      const tiles = p.solution.slice();
      tiles[i] = rotCW(tiles[i]);
      expect(isSolved(p.size, p.wrap, tiles, p.source)).toBe(false);
    }
  });
  it('requires both full power and no dangling connectors', () => {
    // A straight line of 3 with a dangling end on the right: 2 tiles powered of 3, dangling > 0.
    const line = new Uint8Array([RIGHT, LEFT | RIGHT, LEFT | RIGHT]);
    expect(isSolved(3, false, [RIGHT, LEFT | RIGHT, LEFT, 0, 0, 0, 0, 0, 0], 0)).toBe(false); // zeros unpowered
    expect(countDangling(3, false, [...line, 0, 0, 0, 0, 0, 0])).toBe(1);
  });
  it('powers across wrapped borders', () => {
    // 3x3 wrap: tile 0 points left, tile 2 points right -> connected through the wrap.
    const tiles = new Uint8Array([LEFT, 0, RIGHT, 0, 0, 0, 0, 0, 0]);
    expect(computePower(3, true, tiles, 0).powered[2]).toBe(1);
    expect(computePower(3, false, tiles, 0).powered[2]).toBe(0);
    expect(countDangling(3, true, tiles)).toBe(0);
    expect(countDangling(3, false, tiles)).toBe(2);
  });
});

describe('scramble and par', () => {
  it('leaves at least 60% of the tiles wrong and keeps tile types', () => {
    const rand = mulberry32(99);
    for (const id of MODE_IDS) {
      const { size, wrap, crossChance } = MODES[id];
      const n = size * size;
      const solution = spanningTree(size, wrap, Math.floor(n / 2), rand, crossChance);
      const tiles = scramble(solution, rand);
      let wrong = 0;
      for (let i = 0; i < n; i++) {
        expect(minRotations(tiles[i], solution[i])).toBeGreaterThanOrEqual(0);
        if (tiles[i] !== solution[i]) wrong++;
      }
      expect(wrong).toBeGreaterThanOrEqual(Math.ceil(n * 0.6));
    }
  });
  it('par is the sum of minimal rotations and respects symmetry', () => {
    const solution = new Uint8Array([UP | DOWN, 15, UP, UP | RIGHT, RIGHT]);
    const tiles = new Uint8Array([LEFT | RIGHT, 15, LEFT, DOWN | LEFT, DOWN]);
    // straight: 1 (never more), cross: 0, end left->up: 1, corner down-left -> up-right: 2, end down->right: 3
    expect(computePar(tiles, solution)).toBe(1 + 0 + 1 + 2 + 3);
    expect(computePar(solution, solution)).toBe(0);
  });
  it('applying par rotations solves the puzzle', () => {
    for (const id of MODE_IDS) {
      const p = generatePuzzle(MODES[id], mulberry32(1234));
      const { tiles, turns } = solveByPar(p);
      expect(turns).toBe(p.par);
      expect(tiles).toEqual(p.solution);
      expect(isSolved(p.size, p.wrap, tiles, p.source)).toBe(true);
    }
  });
});

describe('generatePuzzle', () => {
  it('builds valid puzzles for every mode with the source in the centre', () => {
    for (const id of MODE_IDS) {
      const cfg = MODES[id];
      const p = generatePuzzle(cfg, mulberry32(2024));
      expect(p.size).toBe(cfg.size);
      expect(p.wrap).toBe(cfg.wrap);
      expect(p.source).toBe(Math.floor((cfg.size * cfg.size) / 2));
      expect(p.tiles).toHaveLength(cfg.size * cfg.size);
      expect(isSolved(p.size, p.wrap, p.solution, p.source)).toBe(true);
      expect(isSolved(p.size, p.wrap, p.tiles, p.source)).toBe(false);
      expect(p.par).toBeGreaterThan(0);
    }
  });
  it('is reproducible with a seed', () => {
    const a = generatePuzzle(MODES.medium, mulberry32(77));
    const b = generatePuzzle(MODES.medium, mulberry32(77));
    expect(a.tiles).toEqual(b.tiles);
    expect(a.solution).toEqual(b.solution);
  });
  it('mostly produces puzzles that are deducible without guessing', () => {
    const rand = mulberry32(31337);
    let deducible = 0;
    const rounds = 10;
    for (let k = 0; k < rounds; k++) if (generatePuzzle(MODES.medium, rand).deducible) deducible++;
    expect(deducible).toBeGreaterThanOrEqual(rounds - 2);
  });
});

describe('deduce (solver)', () => {
  it('never eliminates the planted solution', () => {
    const rand = mulberry32(8);
    for (const id of MODE_IDS) {
      const { size, wrap, crossChance } = MODES[id];
      for (let round = 0; round < 3; round++) {
        const solution = spanningTree(size, wrap, Math.floor((size * size) / 2), rand, crossChance);
        const r = deduce(size, wrap, scramble(solution, rand));
        expect(r.ok).toBe(true);
        for (let i = 0; i < solution.length; i++) expect(r.cands[i]).toContain(solution[i]);
      }
    }
  });
  it('fully solves a deducible puzzle and matches the solution', () => {
    for (const id of MODE_IDS) {
      const p = generatePuzzle(MODES[id], mulberry32(55));
      if (!p.deducible) continue;
      const r = deduce(p.size, p.wrap, p.tiles);
      expect(r.solved).toBe(true);
      for (let i = 0; i < p.solution.length; i++) expect(r.cands[i]).toEqual([p.solution[i]]);
    }
  });
  it('uses the border to fix orientations in non-wrap mode', () => {
    // 3x3 tree (source anywhere):   ┌ ┬ ╴
    //                               ╵ │ ╷
    //                               ╶ ┴ ┘
    const solution = new Uint8Array([RIGHT | DOWN, LEFT | DOWN | RIGHT, LEFT, UP, UP | DOWN, DOWN, RIGHT, UP | LEFT | RIGHT, LEFT | UP]);
    expect(countDangling(3, false, solution)).toBe(0);
    expect(computePower(3, false, solution, 4).count).toBe(9);
    const r = deduce(3, false, solution);
    expect(r.ok).toBe(true);
    expect(r.solved).toBe(true);
    for (let i = 0; i < 9; i++) expect(r.cands[i]).toEqual([solution[i]]);
    // The corner tile in the top-left has a single legal orientation even before looking at neighbours.
    expect(deduce(3, false, solution, false).cands[0]).toEqual([RIGHT | DOWN]);
  });
  it('needs the tree rules (no loops, no isolated groups) for some puzzles', () => {
    // 4x4 tree found by search: mutual + border reasoning leaves 6 tiles open, tree reasoning solves it.
    const solution = new Uint8Array([4, 4, 6, 8, 7, 13, 7, 8, 1, 7, 11, 12, 2, 11, 8, 1]);
    expect(countDangling(4, false, solution)).toBe(0);
    expect(computePower(4, false, solution, 5).count).toBe(16);
    const weak = deduce(4, false, solution, false);
    expect(weak.ok).toBe(true);
    expect(weak.solved).toBe(false);
    for (let i = 0; i < 16; i++) expect(weak.cands[i]).toContain(solution[i]);
    const strong = deduce(4, false, solution, true);
    expect(strong.solved).toBe(true);
    for (let i = 0; i < 16; i++) expect(strong.cands[i]).toEqual([solution[i]]);
  });
  it('reports a contradiction for an impossible board (a tile that can never be powered)', () => {
    const r = deduce(3, false, [RIGHT | DOWN, LEFT | DOWN | RIGHT, LEFT, UP, UP | DOWN, DOWN, RIGHT, UP | LEFT | RIGHT, 0]);
    expect(r.ok).toBe(false);
    expect(r.solved).toBe(false);
  });
});

describe('hintTile', () => {
  it('picks the wrong tile nearest the source and -1 when solved', () => {
    const p = generatePuzzle(MODES.easy, mulberry32(3));
    const { dist } = computePower(p.size, p.wrap, p.solution, p.source);
    const h = hintTile(p, p.tiles);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(p.tiles[h]).not.toBe(p.solution[h]);
    for (let i = 0; i < p.tiles.length; i++) {
      if (p.tiles[i] !== p.solution[i]) expect(dist[i]).toBeGreaterThanOrEqual(dist[h]);
    }
    expect(hintTile(p, p.solution)).toBe(-1);
  });
  it('following hints repeatedly solves the puzzle', () => {
    const p = generatePuzzle(MODES.hard, mulberry32(9));
    const tiles = p.tiles.slice();
    let guard = 0;
    for (let h = hintTile(p, tiles); h >= 0; h = hintTile(p, tiles)) {
      tiles[h] = p.solution[h];
      expect(++guard).toBeLessThan(200);
    }
    expect(isSolved(p.size, p.wrap, tiles, p.source)).toBe(true);
  });
});

describe('isModeId', () => {
  it('accepts known ids only', () => {
    expect(isModeId('easy')).toBe(true);
    expect(isModeId('expert')).toBe(true);
    expect(isModeId('nope')).toBe(false);
    expect(isModeId(3)).toBe(false);
  });
});
