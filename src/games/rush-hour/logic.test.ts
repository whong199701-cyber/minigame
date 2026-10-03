import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES,
  EXIT_ROW,
  GOAL_POS,
  RED,
  SIZE,
  SPECS,
  applyMove,
  bankPuzzle,
  bankSize,
  bestMove,
  boardSignature,
  canMove,
  cellsOf,
  decodePuzzle,
  decodeState,
  encodePuzzle,
  encodeState,
  evaluateLayout,
  DistanceExplorer,
  exploreDistances,
  fillGrid,
  finishRemix,
  getPuzzle,
  hasOverlap,
  hashSeed,
  isSolved,
  isValidLayout,
  legalMoves,
  nextMove,
  pathFromDistances,
  pickStateAt,
  randomLayout,
  remixPlan,
  remixPuzzle,
  searchPuzzle,
  slideRange,
  solve,
  stars,
  targetPar,
  vehicleAt,
  type Difficulty,
  type Vehicle,
} from './logic';
import { seededRandom } from '../../app/canvas';

const red: Vehicle = { id: 0, horiz: true, len: 2, lane: EXIT_ROW };
const pair = (p: { vehicles: Vehicle[]; start: number[] }): [Vehicle[], number[]] => [p.vehicles, p.start];

/** Red at col 0, one vertical car (rows 2-3) in column 3 blocking the way: 2 moves. */
const simple = {
  vehicles: [red, { id: 1, horiz: false, len: 2, lane: 3 }] as Vehicle[],
  start: [0, 2],
};

/**
 * Red at col 0; a vertical truck in column 4 (rows 1-3) blocks the exit row; a horizontal car at
 * row 5 (cols 3-4) stops the truck from moving fully down. Optimal: car left, truck down, red out = 3.
 */
const threeMover = {
  vehicles: [red, { id: 1, horiz: false, len: 3, lane: 4 }, { id: 2, horiz: true, len: 2, lane: 5 }] as Vehicle[],
  start: [0, 1, 3],
};

/** Column 5 is filled by two vertical trucks that can never move: unsolvable. */
const unsolvable = {
  vehicles: [red, { id: 1, horiz: false, len: 3, lane: 5 }, { id: 2, horiz: false, len: 3, lane: 5 }] as Vehicle[],
  start: [0, 0, 3],
};

describe('state encoding', () => {
  it('round-trips positions', () => {
    const pos = [3, 0, 5, 2, 4, 1, 1, 3, 0, 5, 2, 4, 3, 1];
    const key = encodeState(pos);
    expect(decodeState(key, pos.length)).toEqual(pos);
    expect(Number.isSafeInteger(key)).toBe(true);
  });
  it('is injective for distinct states', () => {
    const seen = new Set<number>();
    for (let a = 0; a < SIZE; a++) for (let b = 0; b < SIZE; b++) for (let c = 0; c < SIZE; c++) seen.add(encodeState([a, b, c]));
    expect(seen.size).toBe(SIZE ** 3);
  });
});

describe('grid helpers', () => {
  it('fills cells with vehicle ids and reports vehicleAt', () => {
    const g = fillGrid(threeMover.vehicles, threeMover.start);
    expect(g[EXIT_ROW * SIZE + 0]).toBe(1);
    expect(g[EXIT_ROW * SIZE + 1]).toBe(1);
    expect(g[1 * SIZE + 4]).toBe(2);
    expect(g[3 * SIZE + 4]).toBe(2);
    expect(g[5 * SIZE + 3]).toBe(3);
    expect(vehicleAt(threeMover.vehicles, threeMover.start, EXIT_ROW, 1)).toBe(RED);
    expect(vehicleAt(threeMover.vehicles, threeMover.start, 5, 4)).toBe(2);
    expect(vehicleAt(threeMover.vehicles, threeMover.start, 0, 0)).toBe(-1);
    expect(vehicleAt(threeMover.vehicles, threeMover.start, -1, 0)).toBe(-1);
    expect(vehicleAt(threeMover.vehicles, threeMover.start, 0, 6)).toBe(-1);
  });
  it('cellsOf lists covered cells along the axis', () => {
    expect(cellsOf({ id: 1, horiz: true, len: 3, lane: 4 }, 2)).toEqual([
      [4, 2],
      [4, 3],
      [4, 4],
    ]);
    expect(cellsOf({ id: 1, horiz: false, len: 2, lane: 1 }, 4)).toEqual([
      [4, 1],
      [5, 1],
    ]);
  });
  it('detects overlap and out-of-bounds', () => {
    expect(hasOverlap(simple.vehicles, simple.start)).toBe(false);
    expect(hasOverlap([red, { id: 1, horiz: false, len: 2, lane: 1 }], [0, 2])).toBe(true); // crosses red
    expect(hasOverlap([red], [5])).toBe(true); // sticks out
    expect(hasOverlap([red], [-1])).toBe(true);
    expect(hasOverlap([red, { id: 1, horiz: true, len: 3, lane: 0 }], [0, 4])).toBe(true);
    expect(hasOverlap([red], [0, 1])).toBe(true); // length mismatch
  });
  it('validates the red car shape', () => {
    expect(isValidLayout(threeMover.vehicles, threeMover.start)).toBe(true);
    expect(isValidLayout([{ id: 0, horiz: false, len: 2, lane: EXIT_ROW }], [0])).toBe(false);
    expect(isValidLayout([{ id: 0, horiz: true, len: 3, lane: EXIT_ROW }], [0])).toBe(false);
    expect(isValidLayout([{ id: 0, horiz: true, len: 2, lane: 1 }], [0])).toBe(false);
    expect(isValidLayout([red, { id: 5, horiz: true, len: 2, lane: 0 }], [0, 0])).toBe(false); // bad id
    expect(isValidLayout([], [])).toBe(false);
  });
});

describe('move rules', () => {
  it('slideRange respects walls and other vehicles', () => {
    // Red blocked by the column-3 car: can only slide to cols 0..1.
    expect(slideRange(simple.vehicles, simple.start, RED)).toEqual({ min: 0, max: 1 });
    // The blocking car (rows 2-3) can go anywhere in its free column.
    expect(slideRange(simple.vehicles, simple.start, 1)).toEqual({ min: 0, max: 4 });
    // Truck in threeMover: up to row 0, down only one (car at row 5).
    expect(slideRange(threeMover.vehicles, threeMover.start, 1)).toEqual({ min: 0, max: 2 });
  });
  it('canMove checks blocking, bounds and no-ops', () => {
    expect(canMove(simple.vehicles, simple.start, RED, 1)).toBe(true);
    expect(canMove(simple.vehicles, simple.start, RED, 2)).toBe(false); // would overlap col 3 car
    expect(canMove(simple.vehicles, simple.start, RED, 0)).toBe(false); // no-op
    expect(canMove(simple.vehicles, simple.start, RED, -1)).toBe(false);
    expect(canMove(simple.vehicles, simple.start, 1, 4)).toBe(true);
    expect(canMove(simple.vehicles, simple.start, 1, 5)).toBe(false); // sticks out
    expect(canMove(simple.vehicles, simple.start, 7, 1)).toBe(false); // no such vehicle
    expect(canMove(simple.vehicles, simple.start, 1, 1.5)).toBe(false);
  });
  it('applyMove returns a new array and isSolved detects the exit', () => {
    const next = applyMove(simple.start, { id: 1, from: 2, to: 4 });
    expect(next).toEqual([0, 4]);
    expect(simple.start).toEqual([0, 2]);
    expect(isSolved(next)).toBe(false);
    expect(isSolved([GOAL_POS, 4])).toBe(true);
  });
  it('legalMoves enumerates each destination once', () => {
    const moves = legalMoves(simple.vehicles, simple.start);
    // red: col 1 (1 move); car: rows 0,1,3,4 (4 moves)
    expect(moves).toHaveLength(5);
    expect(moves.filter((m) => m.id === RED)).toEqual([{ id: 0, from: 0, to: 1 }]);
    expect(new Set(moves.map((m) => `${m.id}:${m.to}`)).size).toBe(5);
  });
});

describe('solver', () => {
  it('finds the optimal length for hand-written puzzles', () => {
    const a = solve(simple.vehicles, simple.start);
    expect(a?.par).toBe(2);
    const b = solve(threeMover.vehicles, threeMover.start);
    expect(b?.par).toBe(3);
    expect(b?.moves).toHaveLength(3);
    // Replaying the solution must be legal and end solved.
    let pos = threeMover.start;
    for (const m of b!.moves) {
      expect(canMove(threeMover.vehicles, pos, m.id, m.to)).toBe(true);
      pos = applyMove(pos, m);
    }
    expect(isSolved(pos)).toBe(true);
  });
  it('returns 0 moves when already solved', () => {
    expect(solve([red], [GOAL_POS])).toEqual({ par: 0, moves: [] });
  });
  it('returns null for unsolvable layouts', () => {
    expect(solve(unsolvable.vehicles, unsolvable.start)).toBeNull();
    expect(exploreDistances(unsolvable.vehicles, unsolvable.start)).toBeNull();
  });
  it('honours the state cap', () => {
    const p = getPuzzle('easy', 1);
    expect(solve(p.vehicles, p.start, 1)).toBeNull();
    expect(exploreDistances(p.vehicles, p.start, 5)).toBeNull();
  });
  it('distance map agrees with BFS and yields optimal paths', () => {
    const dist = exploreDistances(threeMover.vehicles, threeMover.start)!;
    expect(dist).not.toBeNull();
    expect(dist.get(encodeState(threeMover.start))).toBe(3);
    const path = pathFromDistances(threeMover.vehicles, threeMover.start, dist);
    expect(path).toHaveLength(3);
    const first = bestMove(threeMover.vehicles, threeMover.start, dist)!;
    expect(first).not.toBeNull();
    expect(dist.get(encodeState(applyMove(threeMover.start, first)))).toBe(2);
    // Every state of the component has a neighbour one closer to the exit (except goals).
    for (const [key, d] of dist) {
      if (d === 0) continue;
      const pos = decodeState(key, threeMover.vehicles.length);
      expect(bestMove(threeMover.vehicles, pos, dist)).not.toBeNull();
    }
  });
  it('nextMove works with and without a distance map', () => {
    const dist = exploreDistances(threeMover.vehicles, threeMover.start);
    const a = nextMove(threeMover.vehicles, threeMover.start, dist)!;
    const b = nextMove(threeMover.vehicles, threeMover.start, null)!;
    for (const m of [a, b]) {
      expect(m).not.toBeNull();
      expect(solve(threeMover.vehicles, applyMove(threeMover.start, m))?.par).toBe(2);
    }
    expect(nextMove([red], [GOAL_POS], null)).toBeNull();
    expect(nextMove(unsolvable.vehicles, unsolvable.start, null)).toBeNull();
  });
});

describe('sliced distance exploration', () => {
  it('gives the same map however it is sliced', () => {
    const p = getPuzzle('hard', 34);
    const whole = exploreDistances(p.vehicles, p.start)!;
    expect(whole).not.toBeNull();
    const ex = new DistanceExplorer(p.vehicles, p.start);
    let slices = 0;
    while (!ex.step(97)) slices++;
    expect(slices).toBeGreaterThan(10);
    expect(ex.done).toBe(true);
    const sliced = ex.result!;
    expect(sliced.size).toBe(whole.size);
    expect([...sliced.entries()]).toEqual([...whole.entries()]);
    expect(sliced.get(encodeState(p.start))).toBe(p.par);
    // Further steps are no-ops.
    expect(ex.step(10)).toBe(true);
    expect(ex.result).toBe(sliced);
  });
  it('is not done before the work is finished and reports failures as null', () => {
    const ex = new DistanceExplorer(threeMover.vehicles, threeMover.start);
    expect(ex.done).toBe(false);
    expect(ex.result).toBeNull();
    expect(ex.step(1)).toBe(false);
    expect(ex.run()?.get(encodeState(threeMover.start))).toBe(3);
    const bad = new DistanceExplorer(unsolvable.vehicles, unsolvable.start);
    expect(bad.run()).toBeNull();
    expect(bad.done).toBe(true);
    const capped = new DistanceExplorer(threeMover.vehicles, threeMover.start, 3);
    expect(capped.run()).toBeNull();
  });
});

describe('generation', () => {
  it('hashSeed is deterministic and spreads', () => {
    expect(hashSeed('easy', 3)).toBe(hashSeed('easy', 3));
    expect(hashSeed('easy', 3)).not.toBe(hashSeed('easy', 4));
    expect(hashSeed('easy', 3)).not.toBe(hashSeed('hard', 3));
  });
  it('randomLayout produces valid layouts with the red car on the exit row', () => {
    for (let s = 1; s <= 40; s++) {
      const { vehicles, positions } = randomLayout(seededRandom(s), 12, 0.4);
      expect(isValidLayout(vehicles, positions)).toBe(true);
      expect(vehicles.length).toBeLessThanOrEqual(13);
      expect(positions[RED]).toBeLessThan(GOAL_POS);
      for (const v of vehicles.slice(1)) expect(v.horiz && v.lane === EXIT_ROW).toBe(false);
    }
  });
  it('evaluateLayout finds the farthest state and pickStateAt honours distances', () => {
    const ev = evaluateLayout({ vehicles: threeMover.vehicles, positions: threeMover.start })!;
    expect(ev).not.toBeNull();
    expect(ev.maxDist).toBeGreaterThanOrEqual(3);
    expect(ev.distances.get(encodeState(ev.far))).toBe(ev.maxDist);
    const s = pickStateAt(ev, 2, seededRandom(1))!;
    expect(s).not.toBeNull();
    expect(solve(ev.vehicles, s)?.par).toBe(2);
    expect(pickStateAt(ev, ev.maxDist + 1, seededRandom(1))).toBeNull();
  });
  it('targetPar climbs through the difficulty range', () => {
    for (const d of DIFFICULTIES) {
      let prev = -1;
      for (let lv = 1; lv <= 60; lv++) {
        const t = targetPar(d, lv);
        expect(t).toBeGreaterThanOrEqual(SPECS[d].minPar);
        expect(t).toBeLessThanOrEqual(SPECS[d].maxPar);
        expect(t).toBeGreaterThanOrEqual(prev);
        prev = t;
      }
      expect(targetPar(d, 1)).toBe(SPECS[d].minPar);
    }
  });
  it('searchPuzzle hill-climbs to a verified par', () => {
    const r = searchPuzzle(hashSeed('hard', 999), SPECS.hard, 12, { iterations: 40 })!;
    expect(r).not.toBeNull();
    expect(isValidLayout(r.vehicles, r.start)).toBe(true);
    expect(r.par).toBeGreaterThan(0);
    expect(solve(r.vehicles, r.start)?.par).toBe(r.par);
    const again = searchPuzzle(hashSeed('hard', 999), SPECS.hard, 12, { iterations: 40 })!;
    expect(again.start).toEqual(r.start);
  }, 30000);
});

describe('puzzle codes', () => {
  it('round-trips through encode/decode', () => {
    const code = encodePuzzle(threeMover.vehicles, threeMover.start, 3);
    expect(code).toBe('3:h220v341h253');
    const dec = decodePuzzle(code);
    expect(dec.par).toBe(3);
    expect(dec.vehicles).toEqual(threeMover.vehicles);
    expect(dec.start).toEqual(threeMover.start);
  });
  it('boardSignature ignores vehicle order but not positions', () => {
    const swapped = [threeMover.vehicles[0], { ...threeMover.vehicles[2], id: 1 }, { ...threeMover.vehicles[1], id: 2 }];
    const swappedStart = [threeMover.start[0], threeMover.start[2], threeMover.start[1]];
    expect(boardSignature(swapped, swappedStart)).toBe(boardSignature(threeMover.vehicles, threeMover.start));
    expect(boardSignature(threeMover.vehicles, [0, 0, 3])).not.toBe(boardSignature(threeMover.vehicles, threeMover.start));
    expect(boardSignature(threeMover.vehicles, [1, 1, 3])).not.toBe(boardSignature(threeMover.vehicles, threeMover.start));
  });
  it('rejects corrupt codes', () => {
    expect(() => decodePuzzle('3:h220v34')).toThrow(); // truncated
    expect(() => decodePuzzle('x:h220')).toThrow(); // bad par
    expect(() => decodePuzzle('1:v220')).toThrow(); // red not horizontal
    expect(() => decodePuzzle('1:h220h221')).toThrow(); // overlap
    expect(() => decodePuzzle('')).toThrow();
  });
});

describe('level bank', () => {
  for (const d of DIFFICULTIES) {
    it(`${d}: every bank entry is valid, in range and has a verified par`, () => {
      const spec = SPECS[d];
      const n = bankSize(d);
      expect(n).toBeGreaterThanOrEqual(30);
      const seen = new Set<string>();
      for (let lv = 1; lv <= n; lv++) {
        const p = getPuzzle(d, lv);
        expect(p.fromBank).toBe(true);
        expect(p.level).toBe(lv);
        expect(isValidLayout(p.vehicles, p.start)).toBe(true);
        expect(isSolved(p.start)).toBe(false);
        expect(p.vehicles.length - 1).toBeGreaterThanOrEqual(spec.minVehicles);
        expect(p.vehicles.length - 1).toBeLessThanOrEqual(spec.maxVehicles);
        expect(p.par).toBeGreaterThanOrEqual(spec.minPar);
        expect(p.par).toBeLessThanOrEqual(spec.maxPar);
        expect(solve(p.vehicles, p.start)?.par).toBe(p.par);
        const key = encodePuzzle(p.vehicles, p.start, p.par);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }, 120000);
  }
  it('every bank level is a distinct board, even ignoring vehicle colours', () => {
    for (const d of DIFFICULTIES) {
      const seen = new Map<string, number>();
      for (let lv = 1; lv <= bankSize(d); lv++) {
        const p = bankPuzzle(d, lv)!;
        expect(p).not.toBeNull();
        expect(p.tint).toBe(0);
        const sig = boardSignature(p.vehicles, p.start);
        expect(seen.get(sig), `${d} ${lv}`).toBeUndefined();
        seen.set(sig, lv);
      }
      expect(bankPuzzle(d, bankSize(d) + 1)).toBeNull();
      expect(bankPuzzle(d, 0)).toBeNull();
    }
  });
});

describe('levels beyond the bank (remix)', () => {
  /** Asserts the brief's guarantees for a generated level. */
  const checkLevel = (d: Difficulty, lv: number) => {
    const spec = SPECS[d];
    const p = getPuzzle(d, lv);
    expect(p.fromBank).toBe(false);
    expect(p.level).toBe(lv);
    expect(p.difficulty).toBe(d);
    expect(isValidLayout(p.vehicles, p.start)).toBe(true);
    expect(isSolved(p.start)).toBe(false);
    expect(p.vehicles.length - 1).toBeGreaterThanOrEqual(spec.minVehicles);
    expect(p.vehicles.length - 1).toBeLessThanOrEqual(spec.maxVehicles);
    expect(p.par, `${d} ${lv}`).toBeGreaterThanOrEqual(spec.minPar);
    expect(p.par, `${d} ${lv}`).toBeLessThanOrEqual(spec.maxPar);
    expect(solve(p.vehicles, p.start)?.par).toBe(p.par);
    expect(p.tint).toBeGreaterThanOrEqual(1);
    expect(p.tint).toBeLessThanOrEqual(12);
    return p;
  };

  for (const d of DIFFICULTIES) {
    it(`${d}: a full round of remixes stays in range and never repeats a board`, () => {
      const n = bankSize(d);
      const bankSigs = new Set<string>();
      for (let lv = 1; lv <= n; lv++) {
        const b = getPuzzle(d, lv);
        bankSigs.add(boardSignature(b.vehicles, b.start));
      }
      const seen = new Set<string>();
      const lots = new Set<number>();
      // One round covers every distinct lot of the bank exactly once.
      let lv = n + 1;
      for (; ; lv++) {
        const plan = remixPlan(d, lv);
        if (plan.earlier.length > 0) break;
        expect(lots.has(plan.baseLevel)).toBe(false);
        lots.add(plan.baseLevel);
        const p = checkLevel(d, lv);
        const sig = boardSignature(p.vehicles, p.start);
        expect(bankSigs.has(sig), `${d} ${lv} repeats a bank level`).toBe(false);
        expect(seen.has(sig), `${d} ${lv} repeats a remix`).toBe(false);
        seen.add(sig);
      }
      expect(lots.size).toBeGreaterThanOrEqual(Math.floor(n * 0.6));
      // The next round reuses the lots in another order and remembers earlier boards.
      const plan = remixPlan(d, lv);
      expect(plan.earlier).toHaveLength(1);
      expect(remixPlan(d, plan.earlier[0]).baseLevel).toBe(plan.baseLevel);
      const p = checkLevel(d, lv);
      expect(boardSignature(p.vehicles, p.start)).not.toBe(boardSignature(...pair(getPuzzle(d, plan.earlier[0]))));
      // Far-away levels still honour the range.
      checkLevel(d, n * 3 + 7);
      checkLevel(d, 1000);
    }, 120000);
  }

  it('is deterministic and independent of how the exploration is sliced', () => {
    for (const [d, lv] of [
      ['expert', 81],
      ['expert', 85],
      ['hard', 81],
      ['medium', 61],
    ] as [Difficulty, number][]) {
      const a = remixPuzzle(d, lv);
      const b = getPuzzle(d, lv);
      expect(b).toEqual(a);
      const plan = remixPlan(d, lv);
      const ex = new DistanceExplorer(plan.vehicles, plan.baseStart);
      while (!ex.step(53));
      expect(finishRemix(plan, ex.result)).toEqual(a);
      // The explored map is the hint map of the generated level.
      expect(ex.result!.get(encodeState(a.start))).toBe(a.par);
      expect(pathFromDistances(a.vehicles, a.start, ex.result!)).toHaveLength(a.par);
    }
    expect(getPuzzle('expert', 81).start).not.toEqual(getPuzzle('expert', 82).start);
  }, 30000);

  it('falls back to the bank start when the lot cannot be explored', () => {
    const plan = remixPlan('expert', 90);
    const p = finishRemix(plan, null);
    expect(p.start).toEqual(plan.baseStart);
    expect(p.par).toBe(plan.basePar);
    expect(p.par).toBeGreaterThanOrEqual(SPECS.expert.minPar);
  });
});

describe('scoring', () => {
  it('awards stars relative to par', () => {
    expect(stars(10, 10)).toBe(3);
    expect(stars(11, 10)).toBe(2);
    expect(stars(13, 10)).toBe(2);
    expect(stars(14, 10)).toBe(1);
    expect(stars(5, 10)).toBe(3);
  });
  it('caps hinted solves at two stars', () => {
    expect(stars(10, 10, true)).toBe(2);
    expect(stars(13, 10, true)).toBe(2);
    expect(stars(14, 10, true)).toBe(1);
    expect(stars(10, 10, false)).toBe(3);
  });
});
