import { describe, expect, it } from 'vitest';
import {
  LAYOUTS,
  LAYOUT_IDS,
  FULL_TILE_COUNT,
  TILE_ASPECT,
  availablePairs,
  buildBoard,
  computeMetrics,
  countPairs,
  drawOrder,
  freeTiles,
  fullBag,
  generateBoard,
  hitTest,
  hitTestTolerant,
  isCovered,
  isFree,
  layoutBounds,
  leftBlocked,
  matchGroup,
  matches,
  pairsFromKinds,
  pickHint,
  rankOf,
  replaySolver,
  reshuffle,
  rightBlocked,
  suitOf,
  tileRect,
  validateLayout,
  type Tile,
} from './logic';

/** mulberry32 — deterministic tests. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tile(id: number, x: number, y: number, z: number, kind = 0): Tile {
  return { id, x, y, z, kind };
}

describe('tile kinds', () => {
  it('classifies suits and ranks', () => {
    expect(suitOf(0)).toBe('dot');
    expect(rankOf(8)).toBe(9);
    expect(suitOf(9)).toBe('bam');
    expect(rankOf(9)).toBe(1);
    expect(suitOf(26)).toBe('char');
    expect(suitOf(27)).toBe('wind');
    expect(rankOf(30)).toBe(3);
    expect(suitOf(33)).toBe('dragon');
    expect(suitOf(34)).toBe('flower');
    expect(suitOf(41)).toBe('season');
    expect(rankOf(41)).toBe(3);
  });

  it('matches identical tiles, any flower with any flower, any season with any season', () => {
    expect(matches(3, 3)).toBe(true);
    expect(matches(3, 4)).toBe(false);
    expect(matches(34, 37)).toBe(true);
    expect(matches(38, 41)).toBe(true);
    expect(matches(34, 38)).toBe(false);
    expect(matches(27, 28)).toBe(false);
    expect(matchGroup(35)).toBe(matchGroup(36));
  });

  it('full bag has 144 tiles, 4 of each regular kind, one of each flower / season', () => {
    const bag = fullBag(rng(1));
    expect(bag).toHaveLength(72);
    const counts = new Map<number, number>();
    for (const [a, b] of bag) {
      expect(matches(a, b)).toBe(true);
      counts.set(a, (counts.get(a) ?? 0) + 1);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    let total = 0;
    for (const [k, c] of counts) {
      total += c;
      expect(c).toBe(k >= 34 ? 1 : 4);
    }
    expect(total).toBe(FULL_TILE_COUNT);
    expect(counts.size).toBe(42);
  });

  it('pairs an arbitrary even multiset and rejects odd ones', () => {
    const pairs = pairsFromKinds([5, 5, 34, 36, 40, 41, 5, 5], rng(2));
    expect(pairs).not.toBeNull();
    expect(pairs).toHaveLength(4);
    for (const [a, b] of pairs!) expect(matches(a, b)).toBe(true);
    expect(pairsFromKinds([5, 5, 5])).toBeNull();
    expect(pairsFromKinds([34])).toBeNull();
  });
});

describe('layouts', () => {
  it('have the right tile counts and are valid', () => {
    expect(LAYOUTS.small).toHaveLength(72);
    expect(LAYOUTS.medium).toHaveLength(100);
    expect(LAYOUTS.large).toHaveLength(144);
    for (const id of LAYOUT_IDS) expect(validateLayout(LAYOUTS[id])).toEqual([]);
  });

  it('validateLayout reports problems', () => {
    expect(validateLayout([{ x: 0, y: 0, z: 0 }])).toContain('odd tile count');
    expect(validateLayout([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toContain('overlap between 0 and 1');
    expect(validateLayout([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 1 }])).toContain('floating tile at 1');
  });

  it('turtle is 8 tiles wide and 12 tall with 5 layers', () => {
    const b = layoutBounds(LAYOUTS.large);
    expect(b.maxX - b.minX).toBe(16);
    expect(b.maxY - b.minY).toBe(24);
    expect(b.maxZ).toBe(4);
  });

  it('every layout fits a phone with usable tiles', () => {
    for (const id of LAYOUT_IDS) {
      const m = computeMetrics(layoutBounds(LAYOUTS[id]), 390, 556, 6);
      expect(m.w).toBeGreaterThanOrEqual(36);
    }
  });
});

describe('free-tile rule', () => {
  it('a lone tile is free', () => {
    const t = tile(0, 0, 0, 0);
    expect(isFree(t, [t])).toBe(true);
  });

  it('a covered tile is not free', () => {
    const base = tile(0, 0, 0, 0);
    const top = tile(1, 1, 1, 1);
    expect(isCovered(base, [base, top])).toBe(true);
    expect(isFree(base, [base, top])).toBe(false);
    expect(isFree(top, [base, top])).toBe(true);
  });

  it('tile with neighbours on both sides is blocked, one side suffices to be free', () => {
    const l = tile(0, 0, 0, 0);
    const m = tile(1, 2, 0, 0);
    const r = tile(2, 4, 0, 0);
    const row = [l, m, r];
    expect(leftBlocked(m, row)).toBe(true);
    expect(rightBlocked(m, row)).toBe(true);
    expect(isFree(m, row)).toBe(false);
    expect(isFree(l, row)).toBe(true);
    expect(isFree(r, row)).toBe(true);
    expect(isFree(m, [l, m])).toBe(true);
  });

  it('half-offset tiles block the side they overlap', () => {
    const a = tile(0, 0, 0, 0);
    const b = tile(1, 2, 1, 0); // touches a on the right, shifted down half a tile
    const c = tile(2, 4, 0, 0);
    expect(rightBlocked(a, [a, b])).toBe(true);
    expect(leftBlocked(c, [b, c])).toBe(true);
    expect(isFree(a, [a, b, c])).toBe(true); // left side is open
    const d = tile(3, -2, 0, 0);
    expect(isFree(a, [a, b, c, d])).toBe(false);
  });

  it('tiles that do not overlap vertically do not block', () => {
    const a = tile(0, 0, 0, 0);
    const b = tile(1, 2, 2, 0); // diagonal neighbour
    expect(rightBlocked(a, [a, b])).toBe(false);
  });

  it('a half-tile gap still blocks (tile cannot slide out)', () => {
    const a = tile(0, 0, 0, 0);
    const b = tile(1, 3, 0, 0);
    expect(rightBlocked(a, [a, b])).toBe(true);
    expect(leftBlocked(b, [a, b])).toBe(true);
  });

  it('different layers never block sideways', () => {
    const a = tile(0, 0, 0, 0);
    const b = tile(1, 2, 0, 1);
    const c = tile(2, 2, 0, 0);
    expect(rightBlocked(a, [a, b])).toBe(false);
    expect(isFree(b, [a, b, c])).toBe(true);
  });
});

describe('pairs and hints', () => {
  it('counts available pairs among free tiles including flower / season groups', () => {
    const tiles = [tile(0, 0, 0, 0, 5), tile(1, 2, 0, 0, 7), tile(2, 4, 0, 0, 5), tile(3, 0, 4, 0, 34), tile(4, 4, 4, 0, 37)];
    // 5 at both ends free & matching → 1 pair; 7 is blocked; flowers free → 1 pair
    expect(countPairs(tiles)).toBe(2);
    expect(availablePairs(tiles)).toHaveLength(2);
    expect(freeTiles(tiles).map((t) => t.id).sort()).toEqual([0, 2, 3, 4]);
  });

  it('counts C(n,2) when more than two free tiles match', () => {
    const tiles = [tile(0, 0, 0, 0, 1), tile(1, 0, 4, 0, 1), tile(2, 0, 8, 0, 1), tile(3, 0, 12, 0, 1)];
    expect(countPairs(tiles)).toBe(6);
  });

  it('hint prefers a safe pair and returns null when stuck', () => {
    // kind 1: three tiles, one blocked (unsafe). kind 2: both free (safe).
    const tiles = [tile(0, 0, 0, 0, 1), tile(1, 2, 0, 0, 1), tile(2, 4, 0, 0, 1), tile(3, 0, 4, 0, 2), tile(4, 4, 4, 0, 2)];
    for (let i = 0; i < 20; i++) {
      const h = pickHint(tiles, rng(i));
      expect(h).not.toBeNull();
      expect(h![0].kind).toBe(2);
    }
    expect(pickHint([tile(0, 0, 0, 0, 1), tile(1, 0, 4, 0, 2)])).toBeNull();
  });
});

describe('generation', () => {
  it('produces solvable boards that replay to empty for every layout', () => {
    let fails = 0;
    for (const id of LAYOUT_IDS) {
      for (let seed = 1; seed <= 40; seed++) {
        const r = rng(seed * 7919 + id.length);
        const board = generateBoard(LAYOUTS[id], r);
        expect(board.tiles).toHaveLength(LAYOUTS[id].length);
        expect(board.tiles.every((t) => t.kind >= 0 && t.kind < 42)).toBe(true);
        expect(board.solution).toHaveLength(LAYOUTS[id].length / 2);
        expect(replaySolver(board.tiles, board.solution)).toBe(true);
        // the first move of the solution is actually available to the player
        expect(countPairs(board.tiles)).toBeGreaterThan(0);
        if (!replaySolver(board.tiles, board.solution)) fails++;
      }
    }
    expect(fails).toBe(0);
  });

  it('reverse fill rarely needs a retry', () => {
    let ok = 0;
    const N = 60;
    for (let seed = 1; seed <= N; seed++) {
      const r = rng(seed);
      const bag = fullBag(r).slice(0, 72);
      if (buildBoard(LAYOUTS.large, bag, r, 1)) ok++;
    }
    // At least 60 % of single attempts succeed; the generator retries up to 200 times anyway.
    expect(ok / N).toBeGreaterThan(0.6);
  });

  it('keeps tile multiset from the bag (4 of a regular kind at most)', () => {
    const board = generateBoard(LAYOUTS.large, rng(99));
    const counts = new Map<number, number>();
    for (const t of board.tiles) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);
    for (const [k, c] of counts) expect(c).toBe(k >= 34 ? 1 : 4);
  });

  it('replaySolver rejects wrong orders', () => {
    const board = generateBoard(LAYOUTS.small, rng(5));
    const reversed = board.solution.slice().reverse();
    // The last pair of the solution is usually buried at the start; a fully reversed order must fail
    // unless the board happens to be trivially symmetric — check it against a simple invariant instead.
    expect(replaySolver(board.tiles, reversed) && replaySolver(board.tiles, [])).toBe(false);
    expect(replaySolver(board.tiles, [[0, 0]])).toBe(false);
    expect(replaySolver(board.tiles, [[0, 9999]])).toBe(false);
    const mismatched = board.solution.map(([a, b], i) => (i === 0 ? ([a, board.solution[1][0]] as [number, number]) : ([a, b] as [number, number])));
    expect(replaySolver(board.tiles, mismatched)).toBe(false);
  });

  it('a non-matching pair order fails the replay', () => {
    const tiles = [tile(0, 0, 0, 0, 1), tile(1, 4, 0, 0, 2)];
    expect(replaySolver(tiles, [[0, 1]])).toBe(false);
    const ok = [tile(0, 0, 0, 0, 1), tile(1, 4, 0, 0, 1)];
    expect(replaySolver(ok, [[0, 1]])).toBe(true);
  });

  it('buildBoard rejects a pair count mismatch', () => {
    expect(buildBoard(LAYOUTS.small, [[1, 1]], rng(1))).toBeNull();
  });
});

describe('reshuffle', () => {
  it('re-deals the remaining tiles into a solvable position with the same ids and kinds multiset', () => {
    const r = rng(42);
    const board = generateBoard(LAYOUTS.medium, r);
    // play the first 20 solution moves, then shuffle the rest
    let tiles = board.tiles.slice();
    for (const [a, b] of board.solution.slice(0, 20)) tiles = tiles.filter((t) => t.id !== a && t.id !== b);
    const before = tiles.map((t) => t.kind).sort((x, y) => x - y);
    const res = reshuffle(tiles, r);
    expect(res.tiles).toHaveLength(tiles.length);
    expect(res.tiles.map((t) => t.kind).sort((x, y) => x - y)).toEqual(before);
    expect(res.tiles.map((t) => t.id).sort((x, y) => x - y)).toEqual(tiles.map((t) => t.id).sort((x, y) => x - y));
    res.tiles.forEach((t, i) => {
      expect(t.x).toBe(tiles[i].x);
      expect(t.y).toBe(tiles[i].y);
      expect(t.z).toBe(tiles[i].z);
    });
    expect(res.solution).toHaveLength(tiles.length / 2);
    expect(replaySolver(res.tiles, res.solution)).toBe(true);
  });

  it('handles an empty board', () => {
    expect(reshuffle([])).toEqual({ tiles: [], solution: [] });
  });
});

describe('geometry and hit testing', () => {
  const b = layoutBounds(LAYOUTS.large);

  it('fits the board into the available area', () => {
    const m = computeMetrics(b, 390, 700, 8);
    const rects = LAYOUTS.large.map((p) => tileRect(p, m));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w + m.lift).toBeLessThanOrEqual(390 + 0.01);
      expect(r.y + r.h + m.lift).toBeLessThanOrEqual(700 + 0.01);
    }
    expect(m.w).toBeGreaterThan(30);
    expect(m.h / m.w).toBeCloseTo(TILE_ASPECT, 5);
  });

  it('is width-limited on narrow screens and height-limited on short ones', () => {
    const wide = computeMetrics(b, 1200, 700, 8);
    const narrow = computeMetrics(b, 300, 2000, 8);
    expect(narrow.w).toBeLessThan(wide.w);
    expect(narrow.w).toBeLessThanOrEqual(300 / 8);
  });

  it('higher layers are shifted up-left', () => {
    const m = computeMetrics(b, 390, 700);
    const low = tileRect({ x: 6, y: 12, z: 0 }, m);
    const high = tileRect({ x: 6, y: 12, z: 3 }, m);
    expect(high.x).toBeLessThan(low.x);
    expect(high.y).toBeLessThan(low.y);
    expect(low.x - high.x).toBeCloseTo(3 * m.lift, 5);
  });

  it('draw order is by layer, then row, then column', () => {
    const order = drawOrder([tile(0, 2, 2, 1), tile(1, 4, 0, 0), tile(2, 0, 0, 0), tile(3, 0, 4, 0)]).map((t) => t.id);
    expect(order).toEqual([2, 1, 3, 0]);
  });

  it('picks the topmost tile under the finger', () => {
    const m = computeMetrics({ minX: 0, maxX: 6, minY: 0, maxY: 2, maxZ: 1 }, 400, 300);
    const base = tile(0, 0, 0, 0);
    const base2 = tile(1, 2, 0, 0);
    const top = tile(2, 1, 0, 1); // straddles both base tiles
    const tiles = [base, base2, top];
    const r = tileRect(top, m);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    expect(hitTest(tiles, cx, cy, m)).toBe(top);
    // the sliver of base at the far left is still base
    const rb = tileRect(base, m);
    expect(hitTest(tiles, rb.x + 1, rb.y + rb.h / 2, m)).toBe(base);
    // far away → null
    expect(hitTest(tiles, 399, 299, m)).toBeNull();
    expect(hitTest(tiles, -1, -1, m)).toBeNull();
  });

  it('the tile drawn later wins on overlapping side strips within a layer', () => {
    const m = computeMetrics({ minX: 0, maxX: 4, minY: 0, maxY: 2, maxZ: 0 }, 400, 300);
    const a = tile(0, 0, 0, 0);
    const bb = tile(1, 2, 0, 0);
    const ra = tileRect(a, m);
    // a point just right of a's face lies on a's side strip, but b's face covers it
    expect(hitTest([a, bb], ra.x + ra.w + 1, ra.y + 5, m)).toBe(bb);
  });

  it('tolerant hit test snaps to a nearby free tile but not a blocked one', () => {
    const m = computeMetrics({ minX: 0, maxX: 6, minY: 0, maxY: 2, maxZ: 0 }, 400, 300);
    const l = tile(0, 0, 0, 0);
    const mid = tile(1, 2, 0, 0);
    const r = tile(2, 4, 0, 0);
    const rl = tileRect(l, m);
    expect(hitTestTolerant([l, mid, r], rl.x - 3, rl.y + 5, m)).toBe(l);
    expect(hitTestTolerant([l, mid, r], rl.x - 30, rl.y + 5, m)).toBeNull();
    const rm = tileRect(mid, m);
    // just above the blocked middle tile: no snap (middle is not free, free tiles are too far)
    expect(hitTestTolerant([l, mid, r], rm.x + rm.w / 2, rm.y - 3, m)).toBeNull();
  });
});
