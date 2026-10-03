import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../app/canvas';
import {
  CAP,
  MAX_COLOURS,
  applyPour,
  canPour,
  challengeParFor,
  climbBoard,
  colourCountFor,
  countBlocks,
  emptyCountFor,
  generateLevel,
  greedyHint,
  hasMoves,
  heuristic,
  isChallengeLevel,
  isComplete,
  isMono,
  isSolved,
  listMoves,
  minParFor,
  pourAmount,
  reverseWalk,
  scramble,
  solve,
  solveForPlay,
  starsFor,
  stateKey,
  targetParFor,
  topRun,
  type Move,
  type State,
} from './logic';
import { strings } from './strings';

function play(state: State, moves: Move[]): State {
  let s = state;
  for (const m of moves) {
    const r = applyPour(s, m.from, m.to);
    if (!r) throw new Error(`illegal move ${m.from}->${m.to}`);
    s = r.state;
  }
  return s;
}

/** Exhaustive DFS over the physical pour rules only (no pruning) — an independent oracle for small boards. */
function bruteSolvable(state: State, limit = 300000): boolean {
  const seen = new Set<string>();
  const stack: State[] = [state];
  while (stack.length) {
    const s = stack.pop()!;
    if (isSolved(s)) return true;
    const key = s.map((t) => t.join(',')).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > limit) throw new Error('brute force too large');
    for (let i = 0; i < s.length; i++) {
      for (let j = 0; j < s.length; j++) {
        const r = applyPour(s, i, j);
        if (r) stack.push(r.state);
      }
    }
  }
  return false;
}

function unitCounts(state: State): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of state) for (const c of t) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

describe('tube helpers', () => {
  it('topRun finds the top colour and its run length', () => {
    expect(topRun([])).toBeNull();
    expect(topRun([0])).toEqual({ colour: 0, run: 1 });
    expect(topRun([1, 0, 0])).toEqual({ colour: 0, run: 2 });
    expect(topRun([2, 2, 2, 2])).toEqual({ colour: 2, run: 4 });
    expect(topRun([2, 2, 1, 2])).toEqual({ colour: 2, run: 1 });
  });
  it('isMono / isComplete', () => {
    expect(isMono([])).toBe(false);
    expect(isMono([3, 3])).toBe(true);
    expect(isMono([3, 1])).toBe(false);
    expect(isComplete([3, 3])).toBe(false);
    expect(isComplete([3, 3, 3, 3])).toBe(true);
    expect(isComplete([3, 3, 3, 1])).toBe(false);
  });
  it('countBlocks', () => {
    expect(countBlocks([])).toBe(0);
    expect(countBlocks([1, 1, 1, 1])).toBe(1);
    expect(countBlocks([1, 2, 1, 2])).toBe(4);
    expect(countBlocks([1, 1, 2, 2])).toBe(2);
  });
});

describe('pour rules', () => {
  it('pours into an empty tube: whole top run', () => {
    const s: State = [[0, 1, 1], []];
    expect(pourAmount(s, 0, 1)).toBe(2);
    const r = applyPour(s, 0, 1)!;
    expect(r.moved).toBe(2);
    expect(r.colour).toBe(1);
    expect(r.state).toEqual([[0], [1, 1]]);
    // the input is not mutated
    expect(s).toEqual([[0, 1, 1], []]);
  });
  it('requires a matching top colour', () => {
    const s: State = [[0, 1], [2]];
    expect(canPour(s, 0, 1)).toBe(false);
    expect(applyPour(s, 0, 1)).toBeNull();
    expect(canPour(s, 1, 0)).toBe(false);
    const ok: State = [[0, 1], [2, 1]];
    expect(canPour(ok, 0, 1)).toBe(true);
    expect(canPour(ok, 1, 0)).toBe(true);
  });
  it('only pours what fits (partial run)', () => {
    const s: State = [[2, 1, 1, 1], [0, 0, 1]];
    expect(pourAmount(s, 0, 1)).toBe(1);
    expect(applyPour(s, 0, 1)!.state).toEqual([[2, 1, 1], [0, 0, 1, 1]]);
  });
  it('rejects pouring from empty, into full, or into itself', () => {
    const s: State = [[], [0, 0, 0, 0], [0]];
    expect(canPour(s, 0, 2)).toBe(false);
    expect(canPour(s, 2, 1)).toBe(false);
    expect(canPour(s, 2, 2)).toBe(false);
    expect(canPour(s, 1, 2)).toBe(true);
    expect(pourAmount(s, 1, 2)).toBe(3);
  });
  it('never exceeds capacity', () => {
    const s: State = [[1, 1, 1, 1], [1, 1]];
    expect(pourAmount(s, 0, 1)).toBe(CAP - 2);
    expect(applyPour(s, 0, 1)!.state[1]).toHaveLength(CAP);
  });
  it('out-of-range indices are illegal', () => {
    expect(pourAmount([[0]], 0, 5)).toBe(0);
    expect(pourAmount([[0]], 5, 0)).toBe(0);
  });
});

describe('win detection', () => {
  it('solved when every tube is empty or full of one colour', () => {
    expect(isSolved([[0, 0, 0, 0], [1, 1, 1, 1], [], []])).toBe(true);
    expect(isSolved([[], []])).toBe(true);
  });
  it('not solved with partial, mixed or split tubes', () => {
    expect(isSolved([[0, 0, 0], [0], []])).toBe(false);
    expect(isSolved([[0, 0, 0, 1], [1, 1, 1, 0]])).toBe(false);
    expect(isSolved([[0, 0, 0, 0], [1, 1], [1, 1]])).toBe(false);
  });
});

describe('listMoves / hasMoves', () => {
  it('skips pointless moves and duplicate empty targets', () => {
    const s: State = [[0, 0, 0, 0], [1, 1], [2, 1], [], []];
    const moves = listMoves(s);
    // no pours out of the complete tube 0
    expect(moves.some((m) => m.from === 0)).toBe(false);
    // the mono tube 1 is not poured into an empty tube, only onto tube 2's matching top? (top is 1 → yes)
    expect(moves).toContainEqual({ from: 1, to: 2 });
    expect(moves.some((m) => m.from === 1 && (m.to === 3 || m.to === 4))).toBe(false);
    // tube 2 → first empty only
    expect(moves).toContainEqual({ from: 2, to: 3 });
    expect(moves.some((m) => m.to === 4)).toBe(false);
    expect(moves).toContainEqual({ from: 2, to: 1 });
  });
  it('detects dead ends', () => {
    expect(hasMoves([[0, 1, 0, 1], [1, 0, 1, 0]])).toBe(false);
    expect(hasMoves([[0, 1, 0, 1], [1, 0, 1, 0], []])).toBe(true);
    expect(hasMoves([[0, 0, 0, 0], [1, 1, 1, 1], []])).toBe(false);
  });
});

describe('state key & heuristic', () => {
  it('is independent of tube order', () => {
    expect(stateKey([[0, 1], [], [2]])).toBe(stateKey([[2], [0, 1], []]));
    expect(stateKey([[0, 1], [2]])).not.toBe(stateKey([[1, 0], [2]]));
    const big: State = [];
    for (let c = 0; c < MAX_COLOURS; c++) big.push([c, (c + 1) % MAX_COLOURS, c, (c + 5) % MAX_COLOURS]);
    big.push([], [3]);
    const shuffled = big.slice().reverse();
    [shuffled[0], shuffled[7]] = [shuffled[7], shuffled[0]];
    expect(stateKey(shuffled)).toBe(stateKey(big));
  });
  it('gives every possible tube its own key (all lengths 0..CAP, all colours)', () => {
    const seen = new Set<string>();
    let tubes: number[][] = [[]];
    let total = 0;
    for (let len = 0; len <= CAP; len++) {
      for (const t of tubes) {
        seen.add(stateKey([t]));
        total++;
      }
      const next: number[][] = [];
      for (const t of tubes) for (let c = 0; c < MAX_COLOURS; c++) next.push([...t, c]);
      tubes = next;
    }
    expect(seen.size).toBe(total);
    // multisets of tubes: same tubes in a different split must not collide either
    expect(stateKey([[0, 1], [2]])).not.toBe(stateKey([[0], [1, 2]]));
    expect(stateKey([[0], [0]])).not.toBe(stateKey([[0, 0], []]));
  });
  it('heuristic is zero on solved states and positive otherwise', () => {
    expect(heuristic([[0, 0, 0, 0], [1, 1, 1, 1], []])).toBe(0);
    expect(heuristic([[0, 1], [1, 0], []])).toBeGreaterThan(0);
    // split colour: two tubes with the same bottom colour must cost at least one move
    expect(heuristic([[0, 0], [0, 0], []])).toBe(1);
  });
  it('heuristic never exceeds the optimal solution length', () => {
    for (let i = 0; i < 40; i++) {
      const s = reverseWalk(4, 2, 40, seededRandom(500 + i));
      const r = solve(s, { maxNodes: 50000, weight: 1 });
      expect(r.status).toBe('solved');
      if (r.status === 'solved') expect(heuristic(s)).toBeLessThanOrEqual(r.moves.length);
    }
  });
});

describe('solver', () => {
  it('solves an already-solved state with zero moves', () => {
    const r = solve([[0, 0, 0, 0], []]);
    expect(r.status).toBe('solved');
    if (r.status === 'solved') expect(r.moves).toEqual([]);
  });
  it('solves a known small level and the path is legal', () => {
    const start: State = [
      [0, 1, 0, 1],
      [1, 0, 1, 0],
      [2, 2, 2, 2],
      [],
      [],
    ];
    const r = solve(start);
    expect(r.status).toBe('solved');
    if (r.status !== 'solved') return;
    expect(r.moves.length).toBeGreaterThan(0);
    const end = play(start, r.moves);
    expect(isSolved(end)).toBe(true);
    expect(unitCounts(end)).toEqual(unitCounts(start));
  });
  it('finds the optimal move count for a hand-made case', () => {
    // 0 on top of 1 twice; optimal: 0→empty (1), 1 from tube1 onto tube0 (2), 0 from tube2 → tube with 0 (3)? let the solver tell us but check bound.
    const start: State = [[1, 1, 1, 0], [0, 0, 0, 1], []];
    const r = solve(start, { weight: 1 });
    expect(r.status).toBe('solved');
    if (r.status === 'solved') {
      expect(r.moves).toHaveLength(3);
      expect(isSolved(play(start, r.moves))).toBe(true);
    }
  });
  it('detects unsolvable states', () => {
    expect(solve([[0, 1, 0, 1], [1, 0, 1, 0]]).status).toBe('unsolvable');
    // three legal opening moves (into the empty tube) but every line of play dead-ends
    const trap: State = [
      [1, 2, 0, 1],
      [0, 2, 0, 1],
      [1, 2, 2, 0],
      [],
    ];
    expect(listMoves(trap).length).toBeGreaterThan(0);
    expect(bruteSolvable(trap)).toBe(false);
    expect(solve(trap).status).toBe('unsolvable');
  });
  it('agrees with an unpruned brute-force search on small boards (both verdicts occur)', () => {
    let solvable = 0;
    let unsolvable = 0;
    for (let i = 0; i < 80; i++) {
      const colours = 3 + (i % 3);
      const s = scramble(colours, 1 + (i % 2), seededRandom(7000 + i));
      const brute = bruteSolvable(s);
      const r = solve(s, { maxNodes: 200000 });
      expect(r.status).not.toBe('limit');
      expect(r.status === 'solved').toBe(brute);
      if (brute) solvable++;
      else unsolvable++;
    }
    expect(solvable).toBeGreaterThan(0);
    expect(unsolvable).toBeGreaterThan(0);
  });
  it('respects the node limit', () => {
    const s = scramble(10, 2, seededRandom(42));
    const r = solve(s, { maxNodes: 1 });
    expect(['limit', 'solved', 'unsolvable']).toContain(r.status);
    if (r.status === 'limit') expect(r.nodes).toBe(1);
  });
  it('is deterministic', () => {
    const s = scramble(7, 2, seededRandom(99));
    const a = solve(s);
    const b = solve(s);
    expect(a).toEqual(b);
  });
  it('solveForPlay falls back to the greedy search when the exact cap is tiny', () => {
    const s = scramble(8, 2, seededRandom(7));
    const r = solveForPlay(s, { exact: 1, greedy: 100000 });
    expect(r.status).toBe('solved');
    if (r.status === 'solved') expect(isSolved(play(s, r.moves))).toBe(true);
  });
});

describe('scramble & reverseWalk', () => {
  it('scramble has CAP units of every colour and the right number of tubes', () => {
    const s = scramble(6, 2, seededRandom(1));
    expect(s).toHaveLength(8);
    expect(s.filter((t) => t.length === 0)).toHaveLength(2);
    const counts = unitCounts(s);
    expect(counts.size).toBe(6);
    for (const n of counts.values()) expect(n).toBe(CAP);
  });
  it('reverseWalk is always solvable and keeps unit counts', () => {
    for (let i = 0; i < 30; i++) {
      const colours = 5 + (i % 8);
      const empties = 1 + (i % 2);
      const s = reverseWalk(colours, empties, colours * 25, seededRandom(1000 + i));
      expect(s).toHaveLength(colours + empties);
      const counts = unitCounts(s);
      for (const n of counts.values()) expect(n).toBe(CAP);
      for (const t of s) expect(t.length).toBeLessThanOrEqual(CAP);
      const r = solve(s, { maxNodes: 80000 });
      expect(r.status).toBe('solved');
    }
  });
});

describe('level parameters', () => {
  it('colour count grows with level as in the brief', () => {
    expect(colourCountFor(1)).toBe(3);
    expect(colourCountFor(3)).toBe(3);
    expect(colourCountFor(4)).toBe(4);
    expect(colourCountFor(8)).toBe(4);
    expect(colourCountFor(9)).toBe(5);
    expect(colourCountFor(15)).toBe(5);
    expect(colourCountFor(16)).toBe(6);
    expect(colourCountFor(25)).toBe(6);
    expect(colourCountFor(26)).toBe(7);
    expect(colourCountFor(40)).toBe(7);
    expect(colourCountFor(41)).toBe(8);
    expect(colourCountFor(60)).toBe(8);
    expect(colourCountFor(61)).toBe(9);
    expect(colourCountFor(90)).toBe(9);
    expect(colourCountFor(91)).toBe(10);
    expect(colourCountFor(500)).toBe(12);
  });
  it('every 10th level is a challenge with one empty tube', () => {
    expect(isChallengeLevel(10)).toBe(true);
    expect(isChallengeLevel(11)).toBe(false);
    expect(emptyCountFor(10)).toBe(1);
    expect(emptyCountFor(7)).toBe(2);
  });
  it('stars', () => {
    expect(starsFor(10, 10)).toBe(3);
    expect(starsFor(9, 10)).toBe(3);
    expect(starsFor(12, 10)).toBe(2);
    expect(starsFor(13, 10)).toBe(2);
    expect(starsFor(14, 10)).toBe(1);
    expect(starsFor(40, 30)).toBe(1);
    expect(starsFor(37, 30)).toBe(2);
  });
});

describe('generateLevel', () => {
  it('is deterministic for the same level', () => {
    const a = generateLevel(17);
    const b = generateLevel(17);
    expect(a.tubes).toEqual(b.tubes);
    expect(a.par).toBe(b.par);
    expect(a.solution).toEqual(b.solution);
    expect(a.work).toBe(b.work);
    const c = generateLevel(220);
    const d = generateLevel(220);
    expect(c.tubes).toEqual(d.tubes);
    expect(c.solution).toEqual(d.solution);
  });
  it('clamps invalid levels to 1', () => {
    expect(generateLevel(0).level).toBe(1);
    expect(generateLevel(-3).level).toBe(1);
    expect(generateLevel(2.7).level).toBe(2);
  });
  it('levels 1–45 are solvable, non-trivial and have the right shape', () => {
    for (let lv = 1; lv <= 45; lv++) {
      const L = generateLevel(lv);
      expect(L.level).toBe(lv);
      expect(L.colours).toBe(colourCountFor(lv));
      expect(L.empties).toBe(emptyCountFor(lv));
      expect(L.tubes).toHaveLength(L.colours + L.empties);
      expect(L.tubes.filter((t) => t.length === 0)).toHaveLength(L.empties);
      const counts = unitCounts(L.tubes);
      expect(counts.size).toBe(L.colours);
      for (const n of counts.values()) expect(n).toBe(CAP);
      expect(L.tubes.some(isComplete)).toBe(false);
      expect(isSolved(L.tubes)).toBe(false);
      expect(L.par).toBe(L.solution.length);
      // no relaxation for any generation path: every level clears the triviality bar
      expect(L.par).toBeGreaterThanOrEqual(minParFor(L.colours));
      // the stored solution really solves the level
      expect(isSolved(play(L.tubes, L.solution))).toBe(true);
    }
  });
  it('high levels (10–12 colours, including challenge levels) are solvable', () => {
    for (const lv of [91, 100, 117, 130, 150, 181, 200, 219, 221, 333]) {
      const L = generateLevel(lv);
      expect(L.colours).toBe(colourCountFor(lv));
      expect(L.tubes.filter((t) => t.length === 0)).toHaveLength(emptyCountFor(lv));
      expect(L.tubes.some(isComplete)).toBe(false);
      expect(isSolved(play(L.tubes, L.solution))).toBe(true);
      expect(L.par).toBeGreaterThanOrEqual(minParFor(L.colours));
    }
  });
  it('the par of a high level is the exact optimum (A* re-check)', () => {
    for (const lv of [100, 220]) {
      const L = generateLevel(lv);
      const r = solve(L.tubes, { maxNodes: 200000, weight: 1 });
      expect(r.status).toBe('solved');
      if (r.status === 'solved') expect(r.moves.length).toBe(L.par);
    }
  });
  it(
    'challenge levels (every 10th, one empty tube) are not trivial and about as long as their neighbours',
    () => {
      const ratios: number[] = [];
      for (let lv = 10; lv <= 300; lv += 10) {
        const L = generateLevel(lv);
        expect(L.empties).toBe(1);
        expect(L.tubes.filter((t) => t.length === 0)).toHaveLength(1);
        expect(L.tubes.some(isComplete)).toBe(false);
        expect(isSolved(play(L.tubes, L.solution))).toBe(true);
        expect(targetParFor(lv)).toBe(challengeParFor(L.colours));
        // the climb may settle one move short of its goal after its node budget
        expect(L.par).toBeGreaterThanOrEqual(challengeParFor(L.colours) - 1);
        expect(L.par).toBeGreaterThan(minParFor(L.colours));
        const around = (generateLevel(lv - 1).par + generateLevel(lv + 1).par) / 2;
        ratios.push(L.par / around);
      }
      // regression guard for the old reverse-walk fallback (L220: par 16 next to 40 and 36)
      for (const r of ratios) expect(r).toBeGreaterThanOrEqual(0.8);
      expect(ratios.reduce((a, b) => a + b, 0) / ratios.length).toBeGreaterThanOrEqual(0.9);
    },
    120000,
  );
  it('generation cost is bounded (solver nodes, independent of machine load)', () => {
    for (const lv of [5, 33, 80, 120, 190, 250, 320, 330, 1000]) {
      const L = generateLevel(lv);
      expect(L.work).toBeGreaterThan(0);
      expect(L.work).toBeLessThan(40000);
    }
  });
});

describe('climbBoard', () => {
  it('builds a solvable, untouched board whose par reaches the goal', () => {
    for (const [colours, empties, seed] of [
      [6, 1, 11],
      [9, 1, 12],
      [12, 1, 13],
      [8, 2, 14],
    ]) {
      const goal = challengeParFor(colours);
      const r = climbBoard(colours, empties, seededRandom(seed), goal, minParFor(colours));
      expect(r).not.toBeNull();
      if (!r) continue;
      expect(r.tubes).toHaveLength(colours + empties);
      expect(r.tubes.filter((t) => t.length === 0)).toHaveLength(empties);
      for (const t of r.tubes) expect(t.length === 0 || t.length === CAP).toBe(true);
      const counts = unitCounts(r.tubes);
      expect(counts.size).toBe(colours);
      for (const n of counts.values()) expect(n).toBe(CAP);
      expect(r.tubes.some(isComplete)).toBe(false);
      expect(r.moves.length).toBeGreaterThanOrEqual(goal - 1);
      expect(isSolved(play(r.tubes, r.moves))).toBe(true);
      // the reported solution is optimal
      const check = solve(r.tubes, { maxNodes: 200000 });
      expect(check.status).toBe('solved');
      if (check.status === 'solved') expect(check.moves.length).toBe(r.moves.length);
      expect(r.work).toBeGreaterThan(0);
    }
  });
  it('is deterministic for a given seed', () => {
    const a = climbBoard(10, 1, seededRandom(5), 30, 20);
    const b = climbBoard(10, 1, seededRandom(5), 30, 20);
    expect(a).toEqual(b);
  });
  it('settles for the floor when the goal is out of reach', () => {
    const r = climbBoard(4, 1, seededRandom(3), 1000, 8);
    expect(r).not.toBeNull();
    if (r) {
      expect(r.moves.length).toBeGreaterThanOrEqual(8);
      expect(isSolved(play(r.tubes, r.moves))).toBe(true);
    }
  });
});

describe('greedyHint', () => {
  it('returns a legal move or null on dead ends', () => {
    const L = generateLevel(12);
    const m = greedyHint(L.tubes);
    expect(m).not.toBeNull();
    expect(canPour(L.tubes, m!.from, m!.to)).toBe(true);
    expect(greedyHint([[0, 1, 0, 1], [1, 0, 1, 0]])).toBeNull();
  });
  it('prefers completing a tube', () => {
    const s: State = [[0, 0, 0], [1, 0], [], [1, 1, 1]];
    const m = greedyHint(s)!;
    expect(m).toEqual({ from: 1, to: 0 });
  });
});

describe('strings', () => {
  it('zh and en have identical key sets and a multi-line rules entry', () => {
    const zh = Object.keys(strings.zh).sort();
    const en = Object.keys(strings.en).sort();
    expect(zh).toEqual(en);
    expect(strings.zh.rules.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(strings.en.rules.split('\n').length).toBeGreaterThanOrEqual(3);
    for (const k of zh) {
      expect(strings.zh[k].length).toBeGreaterThan(0);
      expect(strings.en[k].length).toBeGreaterThan(0);
    }
  });
});
