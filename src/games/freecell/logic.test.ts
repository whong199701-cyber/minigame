import { describe, expect, it } from 'vitest';
import {
  CELL0,
  EMPTY,
  FOUND0,
  UNSOLVABLE_DEAL,
  Solver,
  applyMove,
  autoplay,
  canMove,
  cardCode,
  cardLabel,
  checkMove,
  cloneState,
  decodeMove,
  encodeMove,
  finishMoves,
  fitsOn,
  hasAnyMove,
  isSafeAutoplay,
  isTriviallySolvable,
  isValidDeal,
  isWon,
  legalMoves,
  makeCard,
  maxMoveSize,
  msDeal,
  newGame,
  playSolution,
  randomDeal,
  replay,
  runLength,
  smartMove,
  solve,
  stateKey,
  type Move,
  type State,
} from './logic';

/** Parse "JD 2D TH" into cards. */
const RANKS = 'A23456789TJQK';
const SUITS = 'CDHS';
function c(code: string): number {
  return makeCard(RANKS.indexOf(code[0]), SUITS.indexOf(code[1]));
}
function cards(s: string): number[] {
  return s.trim() ? s.trim().split(/\s+/).map(c) : [];
}
function rows(cascades: number[][]): string[] {
  const out: string[] = [];
  for (let r = 0; r < 7; r++) {
    out.push(
      cascades
        .map((col) => col[r])
        .filter((x) => x !== undefined)
        .map(cardCode)
        .join(' '),
    );
  }
  return out;
}

/** A hand-built position; cards not listed anywhere are assumed to be on the foundations. */
function pos(cascades: string[], cellCards: string[], found: number[], numCells = 4): State {
  const cells = new Array<number>(numCells).fill(EMPTY);
  cellCards.forEach((x, i) => (cells[i] = x ? c(x) : EMPTY));
  const cas = cascades.map(cards);
  while (cas.length < 8) cas.push([]);
  return { cascades: cas, cells, found: found.slice() };
}

function allCards(s: State): number[] {
  const out: number[] = [];
  s.cascades.forEach((col) => out.push(...col));
  s.cells.forEach((x) => x !== EMPTY && out.push(x));
  s.found.forEach((n, suit) => {
    for (let r = 0; r < n; r++) out.push(makeCard(r, suit));
  });
  return out.sort((a, b) => a - b);
}

describe('Microsoft deals', () => {
  it('deal #1 matches the classic layout', () => {
    const d = msDeal(1);
    expect(rows(d)).toEqual([
      'JD 2D 9H JC 5D 7H 7C 5H',
      'KD KC 9S 5S AD QC KH 3H',
      '2S KS 9D QD JS AS AH 3C',
      '4C 5C TS QH 4H AC 4D 7S',
      '3S TD 4S TH 8H 2C JH 7D',
      '6D 8S 8D QS 6C 3D 8C TC',
      '6S 9C 2H 6H',
    ]);
  });

  it('deal #617 matches the classic layout', () => {
    const d = msDeal(617);
    expect(rows(d).slice(0, 2)).toEqual(['7D AD 5C 3S 5S 8C 2D AH', 'TD 7S QD AC 6D 8H AS KH']);
    expect(rows(d)[6]).toBe('JD KS KC 4H');
  });

  it('every deal has 7,7,7,7,6,6,6,6 cards and each card exactly once', () => {
    for (const deal of [1, 2, 100, 11982, 31999, 32000]) {
      const d = msDeal(deal);
      expect(d.map((col) => col.length)).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
      const flat = d.flat().sort((a, b) => a - b);
      expect(flat).toEqual(Array.from({ length: 52 }, (_, i) => i));
    }
  });

  it('newGame sets up empty cells and foundations', () => {
    const s = newGame(5, 3);
    expect(s.cells).toEqual([EMPTY, EMPTY, EMPTY]);
    expect(s.found).toEqual([0, 0, 0, 0]);
    expect(allCards(s)).toHaveLength(52);
  });

  it('validates deal numbers and never picks #11982', () => {
    expect(isValidDeal(1)).toBe(true);
    expect(isValidDeal(32000)).toBe(true);
    expect(isValidDeal(0)).toBe(false);
    expect(isValidDeal(32001)).toBe(false);
    expect(isValidDeal(1.5)).toBe(false);
    // A generator that first hits 11982, then 7.
    const seq = [(UNSOLVABLE_DEAL - 1) / 32000 + 1e-9, 6.5 / 32000];
    let i = 0;
    expect(randomDeal(() => seq[i++])).toBe(7);
    for (let k = 0; k < 200; k++) {
      const d = randomDeal();
      expect(d).not.toBe(UNSOLVABLE_DEAL);
      expect(isValidDeal(d)).toBe(true);
    }
    expect(randomDeal(() => 0, [1])).not.toBe(1);
  });

  it('formats cards', () => {
    expect(cardCode(c('TD'))).toBe('TD');
    expect(cardLabel(c('TD'))).toBe('10♦');
    expect(cardLabel(c('AS'))).toBe('A♠');
  });
});

describe('cascade build rule', () => {
  it('needs one rank lower and the opposite colour', () => {
    expect(fitsOn(c('7H'), c('8S'))).toBe(true);
    expect(fitsOn(c('7D'), c('8C'))).toBe(true);
    expect(fitsOn(c('7S'), c('8H'))).toBe(true);
    expect(fitsOn(c('7H'), c('8D'))).toBe(false); // same colour
    expect(fitsOn(c('7C'), c('8S'))).toBe(false);
    expect(fitsOn(c('6H'), c('8S'))).toBe(false); // rank gap
    expect(fitsOn(c('9H'), c('8S'))).toBe(false); // ascending
    expect(fitsOn(c('KH'), c('AS'))).toBe(false);
  });

  it('measures the movable run at the exposed end', () => {
    expect(runLength([])).toBe(0);
    expect(runLength(cards('KS'))).toBe(1);
    expect(runLength(cards('2C 9S 8H 7C 6D'))).toBe(4);
    expect(runLength(cards('9S 8H 7H'))).toBe(1);
  });

  it('allows legal cascade moves and rejects illegal ones', () => {
    const s = pos(['KS 8S', '9D 7H', '5C', 'QH'], [], [0, 0, 0, 0]);
    expect(checkMove(s, { from: 1, to: 0, n: 1 })).toBe('ok'); // 7H on 8S
    expect(checkMove(s, { from: 2, to: 0, n: 1 })).toBe('rule'); // 5C on 8S
    expect(checkMove(s, { from: 1, to: 2, n: 1 })).toBe('rule');
    expect(checkMove(s, { from: 0, to: 0, n: 1 })).toBe('rule');
    expect(checkMove(s, { from: 1, to: 0, n: 2 })).toBe('rule'); // 9D 7H is not a run
    expect(checkMove(s, { from: 3, to: 5, n: 1 })).toBe('ok'); // anything into an empty cascade
    expect(checkMove(s, { from: 0, to: 4, n: 0 })).toBe('rule');
    expect(checkMove(s, { from: FOUND0, to: 4, n: 1 })).toBe('rule'); // never from foundations
  });

  it('handles free cells', () => {
    const s = pos(['KS 8S', '9D'], ['7H', ''], [0, 0, 0, 0], 2);
    expect(checkMove(s, { from: CELL0, to: 0, n: 1 })).toBe('ok');
    expect(checkMove(s, { from: CELL0 + 1, to: 0, n: 1 })).toBe('rule'); // empty cell
    expect(checkMove(s, { from: 1, to: CELL0, n: 1 })).toBe('rule'); // occupied
    expect(checkMove(s, { from: 1, to: CELL0 + 1, n: 1 })).toBe('ok');
    expect(checkMove(s, { from: 1, to: CELL0 + 2, n: 1 })).toBe('rule'); // does not exist in 2-cell mode
    expect(checkMove(s, { from: 0, to: CELL0 + 1, n: 2 })).toBe('rule'); // one card at a time
    expect(checkMove(s, { from: CELL0, to: CELL0 + 1, n: 1 })).toBe('ok');
  });

  it('handles foundations', () => {
    const s = pos(['AH', '2H', '3S'], [], [0, 0, 0, 1]);
    expect(checkMove(s, { from: 0, to: FOUND0 + 2, n: 1 })).toBe('ok');
    expect(checkMove(s, { from: 1, to: FOUND0 + 2, n: 1 })).toBe('rule'); // 2 before A
    expect(checkMove(s, { from: 0, to: FOUND0 + 3, n: 1 })).toBe('rule'); // wrong suit
    expect(checkMove(s, { from: 2, to: FOUND0 + 3, n: 1 })).toBe('rule'); // 3S needs 2S
    const t = applyMove(s, { from: 0, to: FOUND0 + 2, n: 1 }) as State;
    expect(t.found[2]).toBe(1);
    expect(canMove(t, { from: 1, to: FOUND0 + 2, n: 1 })).toBe(true);
  });
});

describe('supermove capacity', () => {
  it('is (free cells + 1) × 2^empty cascades', () => {
    const base = pos(['KS', 'KH', 'KD', 'KC', 'QS', 'QH', 'QD', 'QC'], [], [11, 11, 11, 11]);
    expect(maxMoveSize(base, false)).toBe(5);
    const one = cloneState(base);
    one.cells[0] = one.cascades[7].pop() as number;
    expect(maxMoveSize(one, false)).toBe(4 * 2);
    expect(maxMoveSize(one, true)).toBe(4); // destination empty: exponent halves
    const s = pos(['KS', 'KH', 'KD'], ['QS', 'QH', 'QD', 'QC'], [11, 11, 11, 11]);
    expect(maxMoveSize(s, false)).toBe(1 * 2 ** 5);
    expect(maxMoveSize(s, true)).toBe(1 * 2 ** 4);
  });

  it('limits run moves by capacity', () => {
    // 6-card run in column 0, target 9C in column 1, other columns full, cells full except n.
    const run = '8H 7S 6D 5C 4H 3S';
    const mk = (freeCells: number): State => {
      const cellsUsed = ['AD', '2D', 'AC', '2C'].slice(0, 4 - freeCells);
      return pos(['KD ' + run, '9C', 'KS', 'KH', 'QS', 'QH', 'QD', 'QC'], cellsUsed, [0, 0, 0, 1]);
    };
    expect(checkMove(mk(4), { from: 0, to: 1, n: 6 })).toBe('capacity'); // 5 max
    expect(checkMove(mk(4), { from: 0, to: 1, n: 5 })).toBe('rule'); // 7S on 9C doesn't fit
    const five = pos(['KD 7S 6D 5C 4H 3S', '8H', 'KS', 'KH', 'QS', 'QH', 'QD', 'QC'], [], [0, 0, 0, 1]);
    expect(checkMove(five, { from: 0, to: 1, n: 5 })).toBe('ok');
    const fiveTwoCells = pos(['KD 7S 6D 5C 4H 3S', '8H', 'KS', 'KH', 'QS', 'QH', 'QD', 'QC'], ['AD', 'AC'], [0, 0, 0, 1]);
    expect(checkMove(fiveTwoCells, { from: 0, to: 1, n: 5 })).toBe('capacity'); // 3 max
    expect(checkMove(fiveTwoCells, { from: 0, to: 1, n: 3 })).toBe('rule');
  });

  it('applies a supermove as one move', () => {
    const s = pos(['KD 7S 6D 5C', '8H', 'KS'], [], [0, 0, 0, 0]);
    const t = applyMove(s, { from: 0, to: 1, n: 3 }) as State;
    expect(t.cascades[0].map(cardCode)).toEqual(['KD']);
    expect(t.cascades[1].map(cardCode)).toEqual(['8H', '7S', '6D', '5C']);
    // input untouched
    expect(s.cascades[0]).toHaveLength(4);
  });

  it('moves to an empty cascade only within the halved capacity', () => {
    // 3 free cells, 1 empty cascade (the destination) → 4 cards max.
    const s = pos(['KD 9S 8H 7S 6D 5C', 'KS', 'KH', 'QS', 'QH', 'QD', 'QC'], ['AD'], [0, 0, 0, 0]);
    expect(checkMove(s, { from: 0, to: 7, n: 4 })).toBe('ok');
    expect(checkMove(s, { from: 0, to: 7, n: 5 })).toBe('capacity');
  });
});

describe('auto-play safety', () => {
  it('always plays aces and twos', () => {
    expect(isSafeAutoplay([0, 0, 0, 0], c('AH'))).toBe(true);
    expect(isSafeAutoplay([0, 1, 0, 0], c('2D'))).toBe(true);
    expect(isSafeAutoplay([0, 0, 0, 0], c('2D'))).toBe(false); // not next
  });

  it('needs both opposite-colour cards one rank lower on foundations', () => {
    // 5H is next for hearts (found[H] = 4). Needs 4C and 4S on foundations.
    expect(isSafeAutoplay([4, 0, 4, 4], c('5H'))).toBe(true);
    expect(isSafeAutoplay([3, 0, 4, 4], c('5H'))).toBe(false);
    expect(isSafeAutoplay([4, 0, 4, 3], c('5H'))).toBe(false);
    // Black 5C needs 4D and 4H.
    expect(isSafeAutoplay([4, 4, 4, 0], c('5C'))).toBe(true);
    expect(isSafeAutoplay([4, 3, 4, 0], c('5C'))).toBe(false);
    // Same colour progress doesn't matter.
    expect(isSafeAutoplay([4, 4, 4, 0], c('5C'))).toBe(true);
  });

  it('auto-plays chains from cells and cascades', () => {
    const s = pos(['5D AH', '2H', 'KS 3H'], ['AS'], [0, 0, 0, 0]);
    const { state, moves } = autoplay(s);
    // AS (cell), AH, then 2H; 3H needs black twos → stays.
    expect(moves.length).toBe(3);
    expect(state.found).toEqual([0, 0, 2, 1]);
    expect(state.cascades[2].map(cardCode)).toEqual(['KS', '3H']);
    expect(s.found).toEqual([0, 0, 0, 0]); // pure
  });

  it('auto-plays the opening aces of a real deal', () => {
    // Deal #1: AH sits under nothing? Find exposed aces — none at the start, so nothing moves.
    expect(autoplay(newGame(1)).moves).toEqual([]);
  });
});

describe('win & finishing', () => {
  it('detects a win', () => {
    expect(isWon(pos([], [], [13, 13, 13, 13]))).toBe(true);
    expect(isWon(pos(['KS'], [], [13, 13, 13, 12]))).toBe(false);
    expect(isWon(newGame(1))).toBe(false);
  });

  it('recognises trivially solvable positions and finishes them', () => {
    const s = pos(['KS QH JS', 'KH QS', 'KD QC JD', 'KC QD JC', 'JH'], [], [10, 10, 10, 10]);
    expect(isTriviallySolvable(s)).toBe(true);
    const moves = finishMoves(s);
    let t: State = s;
    for (const m of moves) t = applyMove(t, m) as State;
    expect(isWon(t)).toBe(true);
    expect(moves).toHaveLength(12);
    const notYet = pos(['QH KS'], [], [13, 13, 11, 12]);
    expect(isTriviallySolvable(notYet)).toBe(false);
    expect(finishMoves(notYet)).toEqual([]);
  });
});

describe('legal move generation', () => {
  it('produces only legal, distinct moves', () => {
    for (const deal of [1, 2, 3, 617]) {
      const s = newGame(deal);
      const ms = legalMoves(s);
      expect(ms.length).toBeGreaterThan(0);
      const keys = new Set(ms.map(encodeMove));
      expect(keys.size).toBe(ms.length);
      for (const m of ms) expect(checkMove(s, m)).toBe('ok');
    }
  });

  it('finds supermoves of the right size', () => {
    const s = pos(['KD 7S 6D 5C', '8H', 'KS', 'KH', 'QS', 'QH', 'QD', 'QC'], [], [0, 0, 0, 0]);
    const ms = legalMoves(s);
    expect(ms).toContainEqual({ from: 0, to: 1, n: 3 });
  });

  it('detects a dead end with no moves', () => {
    // 1 free cell holding a king, every cascade capped by cards that fit nowhere, the nines buried.
    const s = pos(
      ['9C TD', '9D TH', '9H QD', '9S QH', 'JC TC', 'JD TS', 'JH KD QC', 'JS KH KS QS'],
      ['KC'],
      [8, 8, 8, 8],
      1,
    );
    expect(allCards(s)).toHaveLength(52);
    expect(hasAnyMove(s)).toBe(false);
    expect(solve(s).status).toBe('unsolvable');
  });
});

describe('smart move', () => {
  it('prefers foundation, then a cascade, then a free cell', () => {
    const s = pos(['AH', '8S', '7D', 'KC 9H'], [], [0, 0, 0, 0]);
    expect(smartMove(s, 0, 1)).toEqual({ from: 0, to: FOUND0 + 2, n: 1 });
    expect(smartMove(s, 2, 1)).toEqual({ from: 2, to: 1, n: 1 }); // 7D on 8S
    expect(smartMove(s, 3, 1)).toEqual({ from: 3, to: 4, n: 1 }); // 9H to an empty cascade
    const full = pos(['AH', '8S', '7D', 'KC 9H', 'QS', 'QH', 'QD', 'QC'], [], [0, 0, 0, 0]);
    expect(smartMove(full, 3, 1)).toEqual({ from: 3, to: CELL0, n: 1 });
  });

  it('never moves a lone column into another empty column', () => {
    const s = pos(['9H', 'KS', 'KH', 'KD', 'KC', 'QS', 'QH'], ['QD', 'QC', 'JS', 'JH'], [0, 0, 0, 0]);
    expect(smartMove(s, 0, 1)).toBeNull();
  });

  it('returns null when nothing works', () => {
    const s = pos(['9H', 'KS', 'KH', 'KD', 'KC', 'QS', 'QH', 'QD'], ['QC', 'JS', 'JH', 'JD'], [0, 0, 0, 0]);
    expect(smartMove(s, 0, 1)).toBeNull();
  });
});

describe('persistence & undo', () => {
  it('encodes moves losslessly', () => {
    const ms: Move[] = [
      { from: 0, to: 15, n: 1 },
      { from: 11, to: 7, n: 1 },
      { from: 3, to: 5, n: 13 },
    ];
    for (const m of ms) expect(decodeMove(encodeMove(m))).toEqual(m);
  });

  it('replays move groups and undo restores the exact previous state', () => {
    const start = newGame(1);
    const first = legalMoves(start)[0];
    const s1 = applyMove(start, first) as State;
    const ap = autoplay(s1);
    const groups = [[first, ...ap.moves]];
    const second = legalMoves(ap.state)[1];
    const s2 = applyMove(ap.state, second) as State;
    const ap2 = autoplay(s2);
    groups.push([second, ...ap2.moves]);
    const states = replay(1, 4, groups) as State[];
    expect(states).toHaveLength(3);
    expect(states[2]).toEqual(ap2.state);
    // Undo = drop the last group.
    const undone = replay(1, 4, groups.slice(0, 1)) as State[];
    expect(undone[undone.length - 1]).toEqual(ap.state);
    expect(stateKey(undone[1])).toBe(stateKey(ap.state));
    expect(replay(1, 4, [])?.[0]).toEqual(start);
  });

  it('rejects corrupt saves', () => {
    expect(replay(1, 4, [[{ from: 0, to: FOUND0, n: 1 }]])).toBeNull();
    expect(replay(0, 4, [])).toBeNull();
    expect(replay(1, 4, [[]])).toBeNull();
  });

  it('hashes positions independent of column and cell order', () => {
    const a = pos(['KS QH', 'KD', ''], ['AS', ''], [0, 0, 0, 0]);
    const b = pos(['KD', '', 'KS QH'], ['', 'AS'], [0, 0, 0, 0]);
    const d = pos(['KS', 'KD QH', ''], ['AS', ''], [0, 0, 0, 0]);
    expect(stateKey(a)).toBe(stateKey(b));
    expect(stateKey(a)).not.toBe(stateKey(d));
  });
});

describe('solver', () => {
  it('solves deal #1 with four free cells', () => {
    const r = solve(newGame(1));
    expect(r.status).toBe('solved');
    const end = playSolution(newGame(1), r.moves);
    expect(end && isWon(end)).toBe(true);
  });

  it('solves several deals with three free cells', () => {
    for (const deal of [2, 3, 4]) {
      const r = solve(newGame(deal, 3), { maxExpansions: 80000 });
      expect(r.status).toBe('solved');
      const end = playSolution(newGame(deal, 3), r.moves);
      expect(end && isWon(end)).toBe(true);
    }
  });

  it('finishes an almost-won game in a few moves', () => {
    const s = pos(['KS', 'KH', 'QH KD', 'KC'], ['QS', 'QD', 'QC'], [11, 11, 11, 11]);
    const r = solve(s);
    expect(r.status).toBe('solved');
    expect(r.moves.length).toBeLessThanOrEqual(2);
  });

  it('reports an already won game as solved with no moves', () => {
    const r = solve(pos([], [], [13, 13, 13, 13]));
    expect(r.status).toBe('solved');
    expect(r.moves).toEqual([]);
  });

  it('can give up and runs in time slices', () => {
    const solver = new Solver(newGame(1, 1), { maxExpansions: 5 });
    let guard = 0;
    while (solver.status === 'running' && guard++ < 100) solver.step(5, 2);
    expect(['gaveup', 'solved', 'unsolvable']).toContain(solver.status);
    expect(solver.expanded).toBeLessThanOrEqual(6);
  });
});
