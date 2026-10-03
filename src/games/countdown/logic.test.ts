import { describe, expect, it } from 'vitest';
import {
  Board,
  LARGE_POOL,
  MODES,
  TARGET_MAX,
  TARGET_MIN,
  applyOp,
  celebration,
  clampLarge,
  currentStreak,
  drawNumbers,
  exprString,
  formatStep,
  generateRound,
  isCloser,
  isPerfect,
  longestStreak,
  makeResult,
  mulberry32,
  opError,
  pointsFor,
  reachableValues,
  solve,
  stepsOf,
  streakMark,
  summarize,
  validateSteps,
  type Expr,
  type Op,
} from './logic';

/** Reference: every value reachable from `nums` by plain recursion over ordered pairs (no pruning). */
function bruteReach(nums: number[], out = new Set<number>(), seen = new Set<string>()): Set<number> {
  const key = [...nums].sort((a, b) => a - b).join(',');
  if (seen.has(key)) return out;
  seen.add(key);
  for (const v of nums) out.add(v);
  for (let i = 0; i < nums.length; i++) {
    for (let j = 0; j < nums.length; j++) {
      if (i === j) continue;
      for (const op of ['+', '-', '*', '/'] as Op[]) {
        const r = applyOp(nums[i], op, nums[j]);
        if (r === null) continue;
        const rest = nums.filter((_, k) => k !== i && k !== j);
        bruteReach([...rest, r], out, seen);
      }
    }
  }
  return out;
}

const leaf = (v: number): Expr => ({ value: v });
const node = (l: Expr, op: Op, r: Expr): Expr => ({ value: applyOp(l.value, op, r.value) as number, op, left: l, right: r });

describe('operator rules', () => {
  it('allows the four operations on positive integers', () => {
    expect(applyOp(7, '+', 5)).toBe(12);
    expect(applyOp(7, '-', 5)).toBe(2);
    expect(applyOp(7, '*', 5)).toBe(35);
    expect(applyOp(75, '/', 25)).toBe(3);
  });
  it('rejects negative and zero results', () => {
    expect(opError(3, '-', 10)).toBe('negative');
    expect(applyOp(3, '-', 10)).toBeNull();
    expect(opError(8, '-', 8)).toBe('zero');
    expect(applyOp(8, '-', 8)).toBeNull();
  });
  it('rejects fractions', () => {
    expect(opError(10, '/', 4)).toBe('fraction');
    expect(applyOp(10, '/', 4)).toBeNull();
    expect(opError(3, '/', 9)).toBe('fraction');
    expect(opError(9, '/', 3)).toBeNull();
    expect(opError(5, '/', 0)).toBe('fraction');
  });
  it('never rejects addition or multiplication', () => {
    expect(opError(1, '+', 100)).toBeNull();
    expect(opError(1, '*', 1)).toBeNull();
  });
});

describe('scoring bands', () => {
  it('scores exact 10, 1–5 away 7, 6–10 away 5, else 0', () => {
    expect(pointsFor(0)).toBe(10);
    expect(pointsFor(1)).toBe(7);
    expect(pointsFor(5)).toBe(7);
    expect(pointsFor(6)).toBe(5);
    expect(pointsFor(10)).toBe(5);
    expect(pointsFor(11)).toBe(0);
    expect(pointsFor(500)).toBe(0);
  });
  it('gives nothing for no answer or junk input', () => {
    expect(pointsFor(null)).toBe(0);
    expect(pointsFor(-1)).toBe(0);
    expect(pointsFor(Number.NaN)).toBe(0);
  });
});

describe('drawNumbers', () => {
  it('draws six numbers with the requested number of large ones', () => {
    const rand = mulberry32(1);
    for (let large = 0; large <= 4; large++) {
      for (let k = 0; k < 40; k++) {
        const nums = drawNumbers(large, rand);
        expect(nums).toHaveLength(6);
        const big = nums.filter((n) => LARGE_POOL.includes(n));
        const small = nums.filter((n) => !LARGE_POOL.includes(n));
        expect(big).toHaveLength(large);
        expect(new Set(big).size).toBe(large); // large cards are unique
        expect(small).toHaveLength(6 - large);
        for (const s of small) {
          expect(Number.isInteger(s) && s >= 1 && s <= 10).toBe(true);
          expect(small.filter((x) => x === s).length).toBeLessThanOrEqual(2); // each small card twice
        }
        expect([...nums].sort((a, b) => b - a)).toEqual(nums);
      }
    }
  });
  it('clamps the large count', () => {
    expect(clampLarge(-3)).toBe(0);
    expect(clampLarge(9)).toBe(4);
    expect(clampLarge(2.7)).toBe(2);
    expect(clampLarge(Number.NaN)).toBe(1);
    expect(drawNumbers(7, mulberry32(3)).filter((n) => LARGE_POOL.includes(n))).toHaveLength(4);
  });
  it('eventually uses every small card value', () => {
    const rand = mulberry32(5);
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) drawNumbers(0, rand).forEach((n) => seen.add(n));
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('expressions', () => {
  it('prints minimal parentheses', () => {
    const e = node(node(node(leaf(75), '+', leaf(25)), '*', leaf(10)), '-', leaf(1));
    expect(exprString(e)).toBe('(75 + 25) × 10 − 1');
    expect(exprString(node(leaf(50), '-', node(leaf(10), '+', leaf(5))))).toBe('50 − (10 + 5)');
    expect(exprString(node(leaf(50), '-', node(leaf(10), '-', leaf(5))))).toBe('50 − (10 − 5)');
    expect(exprString(node(leaf(50), '+', node(leaf(10), '-', leaf(5))))).toBe('50 + 10 − 5');
    expect(exprString(node(leaf(100), '/', node(leaf(5), '*', leaf(2))))).toBe('100 ÷ (5 × 2)');
    expect(exprString(node(leaf(100), '/', node(leaf(10), '/', leaf(2))))).toBe('100 ÷ (10 ÷ 2)');
    expect(exprString(node(node(leaf(9), '-', leaf(4)), '*', node(leaf(8), '+', leaf(2))))).toBe('(9 − 4) × (8 + 2)');
    expect(exprString(leaf(42))).toBe('42');
  });
  it('lists steps in a usable order', () => {
    const e = node(node(leaf(75), '+', leaf(25)), '*', node(leaf(9), '+', leaf(1)));
    const steps = stepsOf(e);
    expect(steps.map(formatStep)).toEqual(['75 + 25 = 100', '9 + 1 = 10', '100 × 10 = 1000']);
    expect(validateSteps([75, 25, 9, 1], steps)).toBe(true);
  });
  it('validateSteps rejects reuse and bad arithmetic', () => {
    expect(validateSteps([5, 3], [{ a: 5, op: '*', b: 5, result: 25 }])).toBe(false);
    expect(validateSteps([5, 3], [{ a: 5, op: '+', b: 3, result: 9 }])).toBe(false);
    expect(validateSteps([5, 3], [{ a: 3, op: '-', b: 5, result: -2 }])).toBe(false);
    expect(validateSteps([5, 3, 2], [{ a: 5, op: '+', b: 3, result: 8 }, { a: 8, op: '*', b: 2, result: 16 }])).toBe(true);
  });
});

describe('solver', () => {
  const checkSolution = (nums: number[], target: number) => {
    const s = solve(nums, target);
    expect(validateSteps(nums, s.steps)).toBe(true);
    const last = s.steps.length ? s.steps[s.steps.length - 1].result : s.value;
    expect(last).toBe(s.value);
    expect(s.diff).toBe(Math.abs(s.value - target));
    return s;
  };

  it('finds known exact solutions', () => {
    for (const [nums, target] of [
      [[100, 75, 50, 25, 6, 3], 952],
      [[50, 8, 3, 7, 2, 10], 556],
      [[25, 50, 75, 100, 3, 6], 952],
      [[10, 9, 8, 7, 6, 5], 999],
      [[100, 75, 50, 25, 10, 9], 999],
      [[1, 3, 7, 6, 8, 3], 250],
    ] as [number[], number][]) {
      const s = checkSolution(nums, target);
      expect(s.diff).toBe(0);
      expect(s.value).toBe(target);
    }
  });

  it('returns a shortest solution', () => {
    expect(checkSolution([100, 3, 7, 7, 2, 1], 300).steps).toHaveLength(1);
    expect(checkSolution([100, 50, 9, 4, 3, 1], 450).steps).toHaveLength(1);
    expect(checkSolution([100, 50, 9, 7, 3, 1], 157).steps).toHaveLength(2); // 100 + 50 + 7
  });

  it('returns the closest value when the target is impossible', () => {
    const s = checkSolution([1, 1, 2, 2, 3, 3], 999);
    expect(s.value).toBe(81); // (1 + 2) × (1 + 2) × 3 × 3 is the largest value
    expect(s.diff).toBe(918);
    const s2 = checkSolution([7, 8, 3, 3, 4, 9], 997);
    expect(s2.diff).toBe(1);
    expect(bruteReach([7, 8, 3, 3, 4, 9]).has(997)).toBe(false);
  });

  it('agrees with a brute-force enumeration on random five-number draws', () => {
    const rand = mulberry32(11);
    for (let k = 0; k < 12; k++) {
      const nums = drawNumbers(k % 5, rand).slice(0, 5);
      const brute = bruteReach(nums);
      const fast = reachableValues(nums, 1, 2000);
      const expected = [...brute].filter((v) => v >= 1 && v <= 2000).sort((a, b) => a - b);
      expect(fast).toEqual(expected);
      // Closest value for a random target matches the brute force minimum distance.
      const target = 101 + Math.floor(rand() * 899);
      let bestDiff = Infinity;
      for (const v of brute) bestDiff = Math.min(bestDiff, Math.abs(v - target));
      expect(checkSolution(nums, target).diff).toBe(bestDiff);
    }
  });

  it('agrees with brute force on a full six-number draw', () => {
    const nums = [75, 25, 9, 6, 4, 2];
    const brute = bruteReach(nums);
    const expected = [...brute].filter((v) => v >= TARGET_MIN && v <= TARGET_MAX).sort((a, b) => a - b);
    expect(reachableValues(nums)).toEqual(expected);
  });

  it('respects the op budget for reachableValues', () => {
    expect(reachableValues([100, 3, 2], 1, 1000, 0)).toEqual([2, 3, 100]);
    expect(reachableValues([100, 3, 2], 300, 300, 1)).toEqual([300]);
    expect(reachableValues([100, 3, 2], 600, 600, 1)).toEqual([]);
    expect(reachableValues([100, 3, 2], 600, 600, 2)).toEqual([600]);
  });

  it('handles edge inputs', () => {
    expect(solve([7], 7)).toMatchObject({ value: 7, diff: 0, steps: [] });
    expect(solve([7], 10)).toMatchObject({ value: 7, diff: 3, steps: [] });
    expect(solve([], 5).diff).toBe(5);
    expect(checkSolution([4, 4], 1).value).toBe(1);
  });

  it('solves every six-number deal in under 100 ms, including the slowest (impossible targets)', () => {
    const rand = mulberry32(21);
    const cases: [number[], number][] = [
      [[100, 75, 50, 25, 10, 9], 1],
      [[7, 8, 3, 3, 4, 9], 997],
      [[25, 50, 75, 100, 1, 1], 997],
      [[1, 1, 2, 2, 3, 3], 999],
    ];
    // Random deals; every other one gets an unreachable target, which forces the exhaustive search.
    for (let k = 0; k < 40; k++) {
      const nums = drawNumbers(k % 5, rand);
      let target = 101 + Math.floor(rand() * 899);
      if (k % 2 === 0) {
        const reach = new Set(reachableValues(nums));
        const missing: number[] = [];
        for (let v = TARGET_MIN; v <= TARGET_MAX; v++) if (!reach.has(v)) missing.push(v);
        if (missing.length) target = missing[Math.floor(rand() * missing.length)];
      }
      cases.push([nums, target]);
    }
    solve(cases[0][0], cases[0][1]); // warm up the JIT
    // Best of three runs per deal filters out GC pauses and scheduler noise, not slow deals.
    const times = cases.map(([n, t]) => {
      let best = Infinity;
      for (let r = 0; r < 3; r++) {
        const t0 = performance.now();
        solve(n, t);
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    });
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(100);
    expect(times[times.length - 1]).toBeLessThan(100);
  });

  it('gives a shortest derivation of a closest value when the target is impossible', () => {
    const rand = mulberry32(23);
    let checked = 0;
    for (let k = 0; k < 30 && checked < 8; k++) {
      const nums = drawNumbers(k % 5, rand);
      const reach = new Set(reachableValues(nums));
      const missing: number[] = [];
      for (let v = TARGET_MIN; v <= TARGET_MAX; v++) if (!reach.has(v)) missing.push(v);
      if (!missing.length) continue;
      const target = missing[Math.floor(rand() * missing.length)];
      const s = checkSolution(nums, target);
      expect(s.diff).toBeGreaterThan(0);
      // Nothing is closer, and no value at that distance can be built with fewer operations.
      const near = (ops: number) => reachableValues(nums, target - s.diff, target + s.diff, ops).filter((v) => v !== target);
      expect(reachableValues(nums, target - s.diff + 1, target + s.diff - 1)).toEqual([]);
      expect(near(s.steps.length)).toContain(s.value);
      if (s.steps.length > 0) expect(near(s.steps.length - 1)).toEqual([]);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });
});

describe('generateRound', () => {
  it('relaxed and normal targets are always exactly solvable and in range', () => {
    const rand = mulberry32(31);
    for (let k = 0; k < 40; k++) {
      const mode = k % 2 ? 'relaxed' : 'normal';
      const large = k % 5;
      const r = generateRound(large, mode, rand);
      expect(r.target).toBeGreaterThanOrEqual(TARGET_MIN);
      expect(r.target).toBeLessThanOrEqual(TARGET_MAX);
      expect(r.exact).toBe(true);
      expect(r.solution.diff).toBe(0);
      expect(r.numbers.filter((n) => LARGE_POOL.includes(n))).toHaveLength(large);
      expect(validateSteps(r.numbers, r.solution.steps)).toBe(true);
      expect(r.solution.steps.length).toBeGreaterThanOrEqual(MODES[mode].minOps);
    }
  });

  it('hard mode has an exact solution about 80% of the time', () => {
    const rand = mulberry32(41);
    let impossible = 0;
    const n = 120;
    for (let k = 0; k < n; k++) {
      const r = generateRound(k % 5, 'hard', rand);
      expect(r.target).toBeGreaterThanOrEqual(TARGET_MIN);
      expect(r.target).toBeLessThanOrEqual(TARGET_MAX);
      expect(validateSteps(r.numbers, r.solution.steps)).toBe(true);
      if (!r.exact) {
        impossible++;
        // The solver reports the best achievable, and it is close enough to still score.
        expect(r.solution.diff).toBeGreaterThan(0);
        expect(r.solution.diff).toBeLessThanOrEqual(5);
        expect(reachableValues(r.numbers, r.target, r.target)).toEqual([]);
      } else {
        expect(r.solution.steps.length).toBeGreaterThanOrEqual(MODES.hard.minOps);
      }
    }
    expect(impossible / n).toBeGreaterThan(0.08);
    expect(impossible / n).toBeLessThan(0.32);
  });

  it('is reproducible with a seeded random source', () => {
    expect(generateRound(2, 'normal', mulberry32(77))).toEqual(generateRound(2, 'normal', mulberry32(77)));
  });

  it('survives a random source that always draws tiny numbers', () => {
    // rand() = 0.999… picks the last cards after shuffling, i.e. small numbers.
    const r = generateRound(0, 'normal', () => 0.9999);
    expect(r.exact).toBe(true);
    expect(r.target).toBeGreaterThanOrEqual(TARGET_MIN);
  });
});

describe('Board', () => {
  it('combines two tiles into the second slot and logs the move', () => {
    const b = new Board([100, 75, 6, 5, 3, 1]);
    const res = b.combine(0, '+', 1);
    expect(res.ok).toBe(true);
    expect(b.slots[0]).toBeNull();
    expect(b.slots[1]?.value).toBe(175);
    expect(b.slots[1]?.base).toBe(false);
    expect(b.count).toBe(5);
    expect(b.moves).toHaveLength(1);
    const res2 = b.combine(1, '*', 4);
    expect(res2.ok && res2.tile.value).toBe(525);
    expect(b.slots[4] && exprString(b.slots[4])).toBe('(100 + 75) × 3');
  });

  it('rejects invalid operations without changing the board', () => {
    const b = new Board([100, 75, 6, 5, 3, 1]);
    expect(b.combine(4, '-', 2)).toEqual({ ok: false, error: 'negative' });
    expect(b.combine(2, '/', 3)).toEqual({ ok: false, error: 'fraction' });
    expect(b.combine(2, '+', 2)).toEqual({ ok: false, error: 'invalid' });
    expect(b.count).toBe(6);
    expect(b.moves).toHaveLength(0);
    const same = new Board([5, 5, 1, 1, 2, 2]);
    expect(same.combine(0, '-', 1)).toEqual({ ok: false, error: 'zero' });
    same.combine(0, '+', 1);
    expect(same.combine(0, '+', 1)).toEqual({ ok: false, error: 'invalid' }); // slot 0 is empty now
  });

  it('undo and reset restore earlier states', () => {
    const b = new Board([100, 75, 6, 5, 3, 1]);
    b.combine(0, '+', 1);
    b.combine(2, '*', 1);
    expect(b.slots[1]?.value).toBe(1050);
    const m = b.undo();
    expect(m?.result.value).toBe(1050);
    expect(b.slots[1]?.value).toBe(175);
    expect(b.slots[2]?.value).toBe(6);
    b.combine(3, '-', 4);
    expect(b.reset()).toBe(true);
    expect(b.slots.map((t) => t?.value)).toEqual([100, 75, 6, 5, 3, 1]);
    expect(b.reset()).toBe(false);
    expect(b.undo()).toBeNull();
  });

  it('scores the closest tile still on the board, not a value that was undone or merged away', () => {
    const b = new Board([100, 75, 6, 5, 3, 1]);
    const target = 101;
    expect(b.closest(target)?.value).toBe(100);
    b.combine(5, '+', 0); // 1 + 100 = 101, exact
    expect(b.closest(target)?.value).toBe(101);
    b.undo();
    expect(b.closest(target)?.value).toBe(100); // the undone 101 no longer counts
    b.combine(0, '+', 4); // 103
    expect(b.closest(target)?.value).toBe(103);
    b.combine(4, '*', 3); // 103 × 5 = 515: the near value is merged away
    expect(b.closest(target)?.value).toBe(75);
    b.reset();
    expect(b.closest(target)?.value).toBe(100);
    expect(makeResult(target, b.closest(target)?.value ?? null, 0).points).toBe(7);
  });

  it('finds the closest tile', () => {
    const b = new Board([100, 75, 6, 5, 3, 1]);
    expect(b.closest(80)?.value).toBe(75);
    b.combine(0, '*', 2); // 600
    expect(b.closest(590)?.value).toBe(600);
    expect(isCloser(598, 600, 597)).toBe(true);
    expect(isCloser(600, 598, 597)).toBe(false);
    expect(isCloser(5, null, 597)).toBe(true);
  });
});

describe('summary', () => {
  it('computes streaks', () => {
    expect(longestStreak([])).toBe(0);
    expect(longestStreak([true, true, false, true, true, true, false])).toBe(3);
    expect(currentStreak([true, false, true, true])).toBe(2);
    expect(currentStreak([true, false])).toBe(0);
  });

  it('streaks count exact solutions only; a best-possible impossible round neither adds nor breaks', () => {
    expect(longestStreak(['hit', 'keep', 'hit', 'keep', 'hit'])).toBe(3);
    expect(currentStreak(['hit', 'keep'])).toBe(1);
    expect(currentStreak(['hit', 'hit', 'keep', 'keep'])).toBe(2);
    expect(longestStreak(['keep', 'keep', 'keep'])).toBe(0);
    expect(currentStreak(['keep'])).toBe(0);
    expect(longestStreak(['hit', 'keep', 'miss', 'hit'])).toBe(1);
    expect(currentStreak(['hit', 'miss', 'keep'])).toBe(0);
  });

  it('marks rounds for the streak', () => {
    expect(streakMark(makeResult(500, 500, 0))).toBe('hit');
    expect(streakMark(makeResult(500, 501, 0))).toBe('miss'); // exact was possible
    expect(streakMark(makeResult(777, 779, 2))).toBe('keep'); // impossible, best possible answer
    expect(streakMark(makeResult(777, 775, 2))).toBe('keep');
    expect(streakMark(makeResult(777, 774, 2))).toBe('miss'); // impossible, but not the best
    expect(streakMark(makeResult(777, null, 2))).toBe('miss');
  });

  it('treats the best possible answer as perfect', () => {
    expect(isPerfect(0, 0)).toBe(true);
    expect(isPerfect(2, 2)).toBe(true);
    expect(isPerfect(3, 2)).toBe(false);
    expect(isPerfect(null, 0)).toBe(false);
  });

  it('totals a game', () => {
    const results = [
      makeResult(500, 500, 0), // 10, exact
      makeResult(500, 503, 0), // 7
      makeResult(777, 775, 2), // 7, best possible (keeps, does not extend the streak)
      makeResult(777, 770, 0), // 5
      makeResult(300, null, 0), // 0
      makeResult(300, 300, 0), // 10, exact
      makeResult(300, 300, 0), // 10, exact
    ];
    expect(results.map((r) => r.points)).toEqual([10, 7, 7, 5, 0, 10, 10]);
    expect(summarize(results)).toEqual({ total: 49, exact: 3, perfect: 4, longestStreak: 2, maxTotal: 70 });
  });

  it('a hard-mode streak only grows with exact answers', () => {
    const results = [
      makeResult(400, 400, 0), // hit
      makeResult(851, 853, 2), // keep
      makeResult(851, 849, 2), // keep
      makeResult(620, 620, 0), // hit
      makeResult(999, 998, 1), // keep
    ];
    expect(summarize(results).longestStreak).toBe(2);
    expect(summarize(results).perfect).toBe(5);
    expect(summarize([makeResult(851, 853, 2), makeResult(851, 852, 1)]).longestStreak).toBe(0);
  });

  it('does not celebrate an empty record', () => {
    const zero = summarize([makeResult(500, 100, 0), makeResult(500, null, 0)]);
    // Storage reports any first record as new, even a total of 0.
    expect(celebration(zero, true, false)).toEqual({ bestTotal: false, bestStreak: false, win: false });
    const low = summarize([makeResult(500, 500, 0), makeResult(500, 100, 0)]);
    expect(celebration(low, true, true)).toEqual({ bestTotal: true, bestStreak: true, win: true });
    expect(celebration(low, false, false)).toEqual({ bestTotal: false, bestStreak: false, win: false });
    const high = summarize(Array.from({ length: 10 }, () => makeResult(500, 503, 0))); // 70, no new record
    expect(celebration(high, false, false)).toEqual({ bestTotal: false, bestStreak: false, win: true });
    expect(celebration({ ...low, longestStreak: 0 }, false, true).bestStreak).toBe(false);
  });
});
