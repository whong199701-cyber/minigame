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
  nextMode,
  opposite,
  parseSave,
  period,
  rebuildPuzzle,
  rotCW,
  rotateTimes,
  scramble,
  sourceIndex,
  spanningTree,
  clampOffset,
  zoomOffset,
  undoTarget,
  toggleLockAt,
  parVerdict,
  makeThrottle,
  storedZoom,
  SAVE_VERSION,
  type Puzzle,
  type SaveData,
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

describe('modes', () => {
  it('match the brief: 5, 7, 9, 11 with wrap only on expert', () => {
    expect(MODES.easy).toMatchObject({ size: 5, wrap: false });
    expect(MODES.medium).toMatchObject({ size: 7, wrap: false });
    expect(MODES.hard).toMatchObject({ size: 9, wrap: false });
    expect(MODES.expert).toMatchObject({ size: 11, wrap: true });
  });
  it('steps to the next bigger mode', () => {
    expect(nextMode('easy')).toBe('medium');
    expect(nextMode('medium')).toBe('hard');
    expect(nextMode('hard')).toBe('expert');
    expect(nextMode('expert')).toBeNull();
  });
  it('places the source in the centre', () => {
    expect(sourceIndex(5)).toBe(12);
    expect(sourceIndex(11)).toBe(60);
  });
  it('generates every expert puzzle deducibly within the attempt budget', () => {
    const rand = mulberry32(4242);
    for (let k = 0; k < 8; k++) expect(generatePuzzle(MODES.expert, rand).deducible).toBe(true);
  });
});

describe('rebuildPuzzle', () => {
  it('recreates par and source from stored arrays', () => {
    const p = generatePuzzle(MODES.hard, mulberry32(17));
    const q = rebuildPuzzle(MODES.hard, Array.from(p.solution), Array.from(p.tiles));
    expect(q.par).toBe(p.par);
    expect(q.source).toBe(p.source);
    expect(q.tiles).toEqual(p.tiles);
    expect(q.solution).toEqual(p.solution);
    expect(q.deducible).toBe(true);
  });
});

describe('parseSave', () => {
  const p = generatePuzzle(MODES.easy, mulberry32(21));
  const good = (): SaveData => ({
    v: SAVE_VERSION,
    mode: 'easy',
    solution: Array.from(p.solution),
    start: Array.from(p.tiles),
    tiles: Array.from(p.tiles).map((m, i) => (i % 3 === 0 ? rotCW(m) : m)),
    locked: Array.from(p.tiles, (_, i) => (i === 4 ? 1 : 0)),
    hinted: Array.from(p.tiles, () => 0),
    rotations: 9,
    hints: 1,
    elapsedMs: 12345,
  });
  it('accepts a valid save and returns a copy', () => {
    const raw = good();
    const s = parseSave(JSON.parse(JSON.stringify(raw)));
    expect(s).not.toBeNull();
    expect(s!.tiles).toEqual(raw.tiles);
    expect(s!.rotations).toBe(9);
    expect(s!.tiles).not.toBe(raw.tiles);
  });
  it('rejects garbage and wrong versions', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('save')).toBeNull();
    expect(parseSave({ ...good(), v: 99 })).toBeNull();
    expect(parseSave({ ...good(), mode: 'insane' })).toBeNull();
  });
  it('rejects arrays of the wrong length or with out-of-range values', () => {
    expect(parseSave({ ...good(), tiles: good().tiles.slice(1) })).toBeNull();
    expect(parseSave({ ...good(), mode: 'medium' })).toBeNull(); // 25 tiles cannot be a 7x7 board
    const bad = good();
    bad.tiles[0] = 16;
    expect(parseSave(bad)).toBeNull();
    const bad2 = good();
    bad2.locked[0] = 2;
    expect(parseSave(bad2)).toBeNull();
  });
  it('rejects tiles whose shape does not match the solution', () => {
    const bad = good();
    const i = bad.solution.findIndex((m) => degree(m) === 1);
    bad.tiles[i] = UP | DOWN;
    expect(parseSave(bad)).toBeNull();
  });
  it('rejects an invalid solution and bad counters', () => {
    const bad = good();
    const i = bad.solution.findIndex((m) => period(m) === 4);
    bad.solution[i] = rotCW(bad.solution[i]); // same shape, but the network now has a dangling connector
    expect(parseSave(bad)).toBeNull();
    expect(parseSave({ ...good(), rotations: -1 })).toBeNull();
    expect(parseSave({ ...good(), hints: 1.5 })).toBeNull();
    expect(parseSave({ ...good(), elapsedMs: Number.NaN })).toBeNull();
    expect(parseSave({ ...good(), elapsedMs: -5 })).toBeNull();
  });
});

describe('board view math', () => {
  it('centres a board that fits', () => {
    expect(clampOffset(-500, 300, 400, 8)).toBe(50);
    expect(clampOffset(123, 384, 400, 8)).toBe(8);
  });
  it('clamps a zoomed board so it always covers the viewport', () => {
    // board 600 px in a 400 px viewport with an 8 px margin: offset in [-208, 8]
    expect(clampOffset(50, 600, 400, 8)).toBe(8);
    expect(clampOffset(-1000, 600, 400, 8)).toBe(-208);
    expect(clampOffset(-100, 600, 400, 8)).toBe(-100);
  });
  it('keeps the point under the fingers fixed while zooming', () => {
    const offset = 10;
    const cell = 30;
    const focal = 160; // board coordinate (160 - 10) / 30 = 5 cells
    const next = zoomOffset(offset, focal, cell, 45);
    expect((focal - next) / 45).toBeCloseTo(5);
    expect(zoomOffset(offset, focal, cell, cell)).toBe(offset);
    expect(zoomOffset(offset, focal, 0, 10)).toBe(offset);
  });
});

describe('undoTarget', () => {
  it('undoes the most recent turn when its tile is free', () => {
    const locked = new Uint8Array(9);
    expect(undoTarget([3, 5, 7], locked)).toBe(2);
    expect(undoTarget([], locked)).toBe(-1);
  });
  it('skips turns on tiles locked afterwards instead of getting stuck', () => {
    // QA round 1: tap tile 7, long-press tile 7 to lock it, press undo -> the older turn on tile 5 is undone.
    const locked = new Uint8Array(9);
    locked[7] = 1;
    expect(undoTarget([3, 5, 7], locked)).toBe(1);
    expect(undoTarget([3, 7, 7], locked)).toBe(0);
  });
  it('returns -1 when every remaining turn is on a locked tile', () => {
    const locked = new Uint8Array(9);
    locked[3] = 1;
    locked[7] = 1;
    expect(undoTarget([3, 7], locked)).toBe(-1);
  });
  it('makes a skipped turn undoable again once the tile is unlocked', () => {
    const locked = new Uint8Array(9);
    const stack = [2, 4, 6];
    locked[6] = 1;
    let k = undoTarget(stack, locked);
    expect(stack[k]).toBe(4);
    stack.splice(k, 1);
    locked[6] = 0;
    k = undoTarget(stack, locked);
    expect(stack[k]).toBe(6);
  });
});

describe('toggleLockAt', () => {
  it('locks and unlocks a normal tile', () => {
    const locked = new Uint8Array(4);
    const hinted = new Uint8Array(4);
    expect(toggleLockAt(locked, hinted, 2)).toBe(true);
    expect(locked[2]).toBe(1);
    expect(toggleLockAt(locked, hinted, 2)).toBe(true);
    expect(locked[2]).toBe(0);
  });
  it('keeps a tile fixed by a hint locked', () => {
    const locked = Uint8Array.from([0, 1, 0, 0]);
    const hinted = Uint8Array.from([0, 1, 0, 0]);
    expect(toggleLockAt(locked, hinted, 1)).toBe(false);
    expect(locked[1]).toBe(1);
  });
});

describe('parVerdict', () => {
  it('calls a hint-free game at par perfect and lets it set the turns record', () => {
    expect(parVerdict(12, 12, 0)).toEqual({ over: 0, perfect: true, turnsRecord: true });
  });
  it('reports turns over par', () => {
    expect(parVerdict(15, 12, 0)).toEqual({ over: 3, perfect: false, turnsRecord: true });
  });
  it('never calls a hinted game perfect, even at exactly par (QA round 1: 78 turns, par 78, 39 hints)', () => {
    expect(parVerdict(78, 78, 39)).toEqual({ over: 0, perfect: false, turnsRecord: false });
    expect(parVerdict(20, 18, 1)).toEqual({ over: 2, perfect: false, turnsRecord: false });
  });
  it('hints apply exactly the minimal turns, so an all-hint solve lands on par', () => {
    const p = generatePuzzle(MODES.medium, mulberry32(21));
    const tiles = p.tiles.slice();
    let turns = 0;
    let hints = 0;
    for (let h = hintTile(p, tiles); h >= 0; h = hintTile(p, tiles)) {
      turns += Math.max(1, minRotations(tiles[h], p.solution[h]));
      tiles[h] = p.solution[h];
      hints++;
    }
    expect(turns).toBe(p.par);
    expect(parVerdict(turns, p.par, hints).perfect).toBe(false);
  });
});

describe('makeThrottle', () => {
  it('accepts the very first notice even right after page load (QA round 1: dropped at t = 1181 ms)', () => {
    const gate = makeThrottle(2500);
    expect(gate(1181)).toBe(true);
    const gate0 = makeThrottle(2500);
    expect(gate0(0)).toBe(true);
  });
  it('drops repeats inside the gap and accepts them after it', () => {
    const gate = makeThrottle(2500);
    expect(gate(1000)).toBe(true);
    expect(gate(2000)).toBe(false);
    expect(gate(3499)).toBe(false);
    expect(gate(3500)).toBe(true);
  });
  it('force always shows and restarts the gap', () => {
    const gate = makeThrottle(2500);
    expect(gate(1000)).toBe(true);
    expect(gate(1200, true)).toBe(true);
    expect(gate(3600)).toBe(false);
    expect(gate(3700)).toBe(true);
  });
});

describe('storedZoom', () => {
  it('reads a remembered zoom per mode', () => {
    expect(storedZoom({ expert: 1.6, hard: 1.2 }, 'expert')).toBe(1.6);
    expect(storedZoom({ expert: 1.6, hard: 1.2 }, 'hard')).toBe(1.2);
    expect(storedZoom({ expert: 1.6 }, 'easy')).toBe(1);
  });
  it('falls back to the whole board for missing or corrupted data', () => {
    expect(storedZoom(null, 'expert')).toBe(1);
    expect(storedZoom('x', 'expert')).toBe(1);
    expect(storedZoom({ expert: 'big' }, 'expert')).toBe(1);
    expect(storedZoom({ expert: NaN }, 'expert')).toBe(1);
    expect(storedZoom({ expert: 0.4 }, 'expert')).toBe(1);
    expect(storedZoom({ expert: 1e9 }, 'expert')).toBe(4);
  });
});
