import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../app/canvas';
import {
  BLITZ_SECONDS,
  DIFFS,
  PENALTY,
  attr,
  autoDeal,
  computeGrid,
  countSets,
  deal,
  decode,
  encode,
  failingAttrs,
  findAllSets,
  generatePuzzle,
  hasSet,
  isDeckCleared,
  isSet,
  makeDeck,
  maxBoard,
  newTable,
  pickHintSet,
  refillDeck,
  removeCards,
  scoreEvent,
  setKey,
  shuffledDeck,
  slotRect,
  thirdCard,
  type Table,
} from './logic';

const card = (count: number, shape: number, color: number, fill: number) => encode({ count, shape, color, fill });

/** Brute-force reference: every index triple that is a set. */
function bruteSets(board: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < board.length; i++)
    for (let j = i + 1; j < board.length; j++)
      for (let k = j + 1; k < board.length; k++) if (isSet(board[i], board[j], board[k])) out.push(`${i},${j},${k}`);
  return out;
}

/** A known 20-card cap (no set) in AG(4,3): x where the quadratic form has no solutions... built greedily. */
function greedyCap(dims: 3 | 4, rand: () => number): number[] {
  const cap: number[] = [];
  for (const c of shuffledDeck(dims, rand)) {
    if (!cap.some((a, i) => cap.slice(i + 1).some((b) => thirdCard(a, b) === c))) cap.push(c);
  }
  return cap;
}

describe('deck', () => {
  it('has 81 unique cards covering every attribute combination', () => {
    const deck = makeDeck(4);
    expect(deck).toHaveLength(81);
    expect(new Set(deck).size).toBe(81);
    const combos = new Set(deck.map((c) => {
      const a = decode(c);
      return `${a.count}${a.shape}${a.color}${a.fill}`;
    }));
    expect(combos.size).toBe(81);
  });
  it('shuffled deck is a permutation', () => {
    const d = shuffledDeck(4, seededRandom(7));
    expect(d).toHaveLength(81);
    expect([...d].sort((a, b) => a - b)).toEqual(makeDeck(4));
    expect(d).not.toEqual(makeDeck(4));
  });
  it('beginner deck has 27 solid cards', () => {
    const deck = makeDeck(3);
    expect(deck).toHaveLength(27);
    expect(new Set(deck).size).toBe(27);
    deck.forEach((c) => expect(decode(c).fill).toBe(0));
  });
  it('encode / decode round-trip', () => {
    for (const c of makeDeck(4)) expect(encode(decode(c))).toBe(c);
    expect(decode(card(2, 1, 0, 2))).toEqual({ count: 2, shape: 1, color: 0, fill: 2 });
    expect(attr(card(2, 1, 0, 2), 3)).toBe(2);
  });
});

describe('isSet', () => {
  it('accepts all-different on every attribute', () => {
    expect(isSet(card(0, 0, 0, 0), card(1, 1, 1, 1), card(2, 2, 2, 2))).toBe(true);
  });
  it('accepts mixed same / different', () => {
    // same shape, everything else different
    expect(isSet(card(0, 1, 0, 0), card(1, 1, 1, 1), card(2, 1, 2, 2))).toBe(true);
    // same count + colour, different shape + fill
    expect(isSet(card(2, 0, 1, 0), card(2, 1, 1, 2), card(2, 2, 1, 1))).toBe(true);
    // three same apart from one attribute
    expect(isSet(card(1, 2, 0, 0), card(1, 2, 0, 1), card(1, 2, 0, 2))).toBe(true);
  });
  it('rejects two-same-one-different on any attribute', () => {
    expect(isSet(card(0, 0, 0, 0), card(0, 1, 1, 1), card(1, 2, 2, 2))).toBe(false); // count
    expect(isSet(card(0, 0, 0, 0), card(1, 0, 1, 1), card(2, 1, 2, 2))).toBe(false); // shape
    expect(isSet(card(0, 0, 0, 0), card(1, 1, 0, 1), card(2, 2, 1, 2))).toBe(false); // colour
    expect(isSet(card(0, 0, 0, 0), card(1, 1, 1, 0), card(2, 2, 2, 1))).toBe(false); // fill
  });
  it('rejects duplicated cards', () => {
    const a = card(1, 1, 1, 1);
    expect(isSet(a, a, a)).toBe(false);
    expect(isSet(a, a, card(0, 0, 0, 0))).toBe(false);
  });
  it('is order independent', () => {
    const t = [card(0, 1, 0, 0), card(1, 1, 1, 1), card(2, 1, 2, 2)];
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    perms.forEach(([i, j, k]) => expect(isSet(t[i], t[j], t[k])).toBe(true));
  });
  it('total number of sets in the full deck is 1080', () => {
    expect(countSets(makeDeck(4))).toBe(1080);
    expect(countSets(makeDeck(3))).toBe(117);
  });
});

describe('failingAttrs', () => {
  it('names exactly the broken attributes', () => {
    expect(failingAttrs(card(0, 0, 0, 0), card(1, 1, 1, 1), card(2, 2, 2, 2))).toEqual([]);
    expect(failingAttrs(card(0, 0, 0, 0), card(0, 1, 1, 1), card(1, 2, 2, 2))).toEqual([0]);
    expect(failingAttrs(card(0, 0, 0, 0), card(0, 0, 1, 1), card(1, 0, 0, 2))).toEqual([0, 2]);
  });
});

describe('thirdCard', () => {
  it('always completes a set for every pair', () => {
    const deck = makeDeck(4);
    for (let i = 0; i < deck.length; i++)
      for (let j = i + 1; j < deck.length; j++) {
        const c = thirdCard(deck[i], deck[j]);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(81);
        expect(isSet(deck[i], deck[j], c)).toBe(true);
      }
  });
  it('stays inside the beginner deck', () => {
    const deck = makeDeck(3);
    for (const a of deck) for (const b of deck) if (a !== b) expect(thirdCard(a, b)).toBeLessThan(27);
  });
});

describe('findAllSets', () => {
  it('matches a brute-force search on random boards', () => {
    const rand = seededRandom(42);
    for (let t = 0; t < 200; t++) {
      const size = 3 + Math.floor(rand() * 19);
      const board = shuffledDeck(4, rand).slice(0, size);
      const fast = findAllSets(board).map((s) => s.join(','));
      expect(fast.sort()).toEqual(bruteSets(board).sort());
      expect(hasSet(board)).toBe(fast.length > 0);
    }
  });
  it('finds the known sets on a fixed board', () => {
    const board = [card(0, 0, 0, 0), card(1, 1, 1, 1), card(2, 2, 2, 2), card(0, 0, 0, 1), card(0, 0, 0, 2)];
    const sets = findAllSets(board);
    expect(sets).toContainEqual([0, 1, 2]);
    expect(sets).toContainEqual([0, 3, 4]);
    expect(sets).toHaveLength(2);
  });
  it('returns nothing for cap sets (no set possible)', () => {
    const rand = seededRandom(3);
    const cap = greedyCap(4, rand);
    expect(cap.length).toBeGreaterThanOrEqual(9);
    expect(findAllSets(cap)).toEqual([]);
    expect(hasSet(cap)).toBe(false);
  });
  it('handles tiny boards', () => {
    expect(findAllSets([])).toEqual([]);
    expect(findAllSets([5, 9])).toEqual([]);
    expect(hasSet([1])).toBe(false);
  });
});

describe('setKey', () => {
  it('is order independent', () => {
    expect(setKey([30, 2, 17])).toBe(setKey([17, 30, 2]));
    expect(setKey([30, 2, 17])).toBe('2-17-30');
  });
});

describe('dealing', () => {
  it('newTable deals the base number of distinct cards', () => {
    const t = newTable(4, 12, seededRandom(1));
    expect(t.board).toHaveLength(12);
    expect(t.deck).toHaveLength(69);
    expect(new Set([...t.board, ...t.deck]).size).toBe(81);
    const e = newTable(3, 9, seededRandom(1));
    expect(e.board).toHaveLength(9);
    expect(e.deck).toHaveLength(18);
  });
  it('deal appends from the deck', () => {
    const t: Table = { deck: [1, 2, 3, 4], board: [10, 11] };
    const r = deal(t, 3);
    expect(r.dealt).toEqual([4, 3, 2]);
    expect(r.table.board).toEqual([10, 11, 4, 3, 2]);
    expect(r.table.deck).toEqual([1]);
    expect(t.deck).toEqual([1, 2, 3, 4]); // immutable
    expect(deal({ deck: [7], board: [] }, 3).dealt).toEqual([7]);
  });
  it('autoDeal adds cards when the layout has no set', () => {
    const rand = seededRandom(11);
    const cap = greedyCap(4, rand);
    const board = cap.slice(0, 12);
    expect(hasSet(board)).toBe(false);
    const rest = makeDeck(4).filter((c) => !board.includes(c));
    const r = autoDeal({ deck: rest, board }, 21);
    expect(r.dealt.length).toBeGreaterThanOrEqual(3);
    expect(r.dealt.length % 3).toBe(0);
    expect(hasSet(r.table.board)).toBe(true);
    expect(r.table.board.length).toBe(12 + r.dealt.length);
  });
  it('autoDeal deals nothing when a set exists', () => {
    const board = [card(0, 0, 0, 0), card(1, 1, 1, 1), card(2, 2, 2, 2)];
    const r = autoDeal({ deck: [50, 51, 52], board }, 21);
    expect(r.dealt).toEqual([]);
    expect(r.table.board).toEqual(board);
  });
  it('autoDeal keeps adding until a set appears (deck stacked with set-free cards)', () => {
    const rand = seededRandom(99);
    const cap = greedyCap(4, rand);
    expect(cap.length).toBeGreaterThanOrEqual(15);
    const board = cap.slice(0, 9);
    const others = makeDeck(4).filter((c) => !cap.includes(c));
    // Deck pops from the end: the next 6 cards keep the table set-free, then normal cards.
    const deck = [...others, cap[14], cap[13], cap[12], cap[11], cap[10], cap[9]];
    const r = autoDeal({ deck, board }, 21);
    expect(r.dealt.slice(0, 6)).toEqual(cap.slice(9, 15));
    expect(r.dealt.length).toBeGreaterThanOrEqual(9);
    expect(hasSet(r.table.board)).toBe(true);
  });
  it('autoDeal respects the board limit and an empty deck', () => {
    const rand = seededRandom(5);
    const cap = greedyCap(4, rand);
    const board = cap.slice(0, 9);
    expect(autoDeal({ deck: [], board }, 21).dealt).toEqual([]);
    expect(autoDeal({ deck: cap.slice(9, 12), board }, 9).dealt).toEqual([]);
  });
  it('any 21 cards (full deck) or 10 cards (beginner deck) contain a set', () => {
    const rand = seededRandom(2024);
    for (let t = 0; t < 300; t++) {
      expect(hasSet(shuffledDeck(4, rand).slice(0, maxBoard(4)))).toBe(true);
      expect(hasSet(shuffledDeck(3, rand).slice(0, 10))).toBe(true);
    }
    // greedy caps never exceed the theoretical maxima
    for (let t = 0; t < 30; t++) {
      expect(greedyCap(4, rand).length).toBeLessThanOrEqual(20);
      expect(greedyCap(3, rand).length).toBeLessThanOrEqual(9);
    }
  });
});

describe('removeCards', () => {
  it('refills holes in place at the normal size', () => {
    const t: Table = { deck: [100, 101, 102, 103], board: [0, 1, 2, 3, 4, 5] };
    const r = removeCards(t, [4, 1, 2], 6);
    expect(r.table.board).toEqual([0, 103, 102, 3, 101, 5]);
    expect(r.dealt).toEqual([103, 102, 101]);
    expect(r.table.deck).toEqual([100]);
  });
  it('shrinks back to base when extra cards are out (no refill)', () => {
    const t: Table = { deck: [100, 101, 102], board: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
    const r = removeCards(t, [0, 4, 7], 6);
    expect(r.dealt).toEqual([]);
    expect(r.table.board).toHaveLength(6);
    expect(r.table.deck).toEqual([100, 101, 102]);
    // surviving tail cards (6, 8) move into the holes 0 and 4; card 5 keeps its slot
    expect(r.table.board).toEqual([6, 1, 2, 3, 8, 5]);
    expect(new Set(r.table.board)).toEqual(new Set([1, 2, 3, 5, 6, 8]));
  });
  it('removes tail cards cleanly', () => {
    const r = removeCards({ deck: [], board: [0, 1, 2, 3, 4, 5] }, [3, 4, 5], 6);
    expect(r.table.board).toEqual([0, 1, 2]);
  });
  it('compacts when the deck is empty', () => {
    const r = removeCards({ deck: [], board: [0, 1, 2, 3, 4, 5] }, [0, 2, 3], 6);
    expect(r.table.board.sort()).toEqual([1, 4, 5]);
    expect(r.dealt).toEqual([]);
  });
  it('a full classic game always terminates with a cleared deck', () => {
    for (const diff of ['easy', 'normal'] as const) {
      const cfg = DIFFS[diff];
      const rand = seededRandom(diff === 'easy' ? 8 : 9);
      for (let game = 0; game < 30; game++) {
        let table = autoDeal(newTable(cfg.dims, cfg.base, rand), maxBoard(cfg.dims)).table;
        let sets = 0;
        let guard = 0;
        while (!isDeckCleared(table) && guard++ < 200) {
          const s = findAllSets(table.board)[0];
          expect(s).toBeDefined();
          expect(isSet(table.board[s[0]], table.board[s[1]], table.board[s[2]])).toBe(true);
          table = removeCards(table, s, cfg.base).table;
          sets++;
          expect(new Set(table.board).size).toBe(table.board.length);
          table = autoDeal(table, maxBoard(cfg.dims)).table;
          expect(table.board.length).toBeLessThanOrEqual(maxBoard(cfg.dims));
        }
        expect(isDeckCleared(table)).toBe(true);
        expect(table.deck).toHaveLength(0);
        expect(sets * 3 + table.board.length).toBe(cfg.dims === 4 ? 81 : 27);
      }
    }
  });
});

describe('isDeckCleared', () => {
  it('requires an empty deck and no set', () => {
    expect(isDeckCleared({ deck: [], board: [] })).toBe(true);
    expect(isDeckCleared({ deck: [5], board: [] })).toBe(false);
    expect(isDeckCleared({ deck: [], board: [card(0, 0, 0, 0), card(1, 1, 1, 1), card(2, 2, 2, 2)] })).toBe(false);
    expect(isDeckCleared({ deck: [], board: [card(0, 0, 0, 0), card(1, 1, 1, 1)] })).toBe(true);
  });
});

describe('blitz', () => {
  it('scores +1 per set and -1 per mistake', () => {
    let score = 0;
    const events = ['set', 'set', 'wrong', 'set', 'noSetWrong', 'noSetRight', 'set'] as const;
    for (const e of events) score += scoreEvent('blitz', e).points;
    expect(score).toBe(2);
    expect(scoreEvent('blitz', 'wrong').seconds).toBe(0);
    expect(BLITZ_SECONDS).toBe(120);
  });
  it('classic and puzzle use time penalties instead', () => {
    expect(scoreEvent('classic', 'hint')).toEqual({ points: 0, seconds: PENALTY.hint });
    expect(scoreEvent('classic', 'noSetWrong')).toEqual({ points: 0, seconds: 10 });
    expect(scoreEvent('classic', 'wrong')).toEqual({ points: 0, seconds: 5 });
    expect(scoreEvent('classic', 'set')).toEqual({ points: 0, seconds: 0 });
    expect(scoreEvent('puzzle', 'hint').seconds).toBe(20);
    expect(scoreEvent('classic', 'noSetRight').seconds).toBe(0);
  });
  it('refillDeck reshuffles every card not on the table', () => {
    const board = [1, 2, 3, 40, 41, 42];
    const t = refillDeck({ deck: [], board }, 4, seededRandom(4));
    expect(t.deck).toHaveLength(75);
    expect(t.deck.some((c) => board.includes(c))).toBe(false);
    expect(new Set(t.deck).size).toBe(75);
    const same: Table = { deck: [9], board };
    expect(refillDeck(same, 4)).toBe(same);
    expect(refillDeck({ deck: [], board: [0, 1, 2] }, 3).deck).toHaveLength(24);
  });
  it('an endless blitz run never gets stuck', () => {
    const rand = seededRandom(77);
    const cfg = DIFFS.normal;
    let table = autoDeal(newTable(4, 12, rand), 21).table;
    for (let i = 0; i < 120; i++) {
      const s = findAllSets(table.board)[0];
      expect(s).toBeDefined();
      table = removeCards(table, s, cfg.base).table;
      table = refillDeck(table, 4, rand);
      table = autoDeal(table, 21).table;
      expect(table.board.length).toBeGreaterThanOrEqual(12);
      expect(new Set([...table.board, ...table.deck]).size).toBe(table.board.length + table.deck.length);
    }
  });
});

describe('generatePuzzle', () => {
  it('produces boards with exactly the requested number of sets for every difficulty', () => {
    const rand = seededRandom(123);
    for (const diff of ['easy', 'normal', 'hard'] as const) {
      const cfg = DIFFS[diff];
      for (let i = 0; i < 8; i++) {
        const p = generatePuzzle(cfg.dims, cfg.puzzleCards, cfg.puzzleSets, rand);
        expect(p).toHaveLength(cfg.puzzleCards);
        expect(new Set(p).size).toBe(cfg.puzzleCards);
        p.forEach((c) => expect(c).toBeLessThan(cfg.dims === 4 ? 81 : 27));
        expect(countSets(p)).toBe(cfg.puzzleSets);
      }
    }
  });
  it('falls back to the hill-climb for rare targets', () => {
    const p = generatePuzzle(4, 12, 9, seededRandom(5));
    expect(countSets(p)).toBe(9);
    expect(new Set(p).size).toBe(12);
  });
  it('is reproducible with a seed', () => {
    expect(generatePuzzle(4, 12, 6, seededRandom(9))).toEqual(generatePuzzle(4, 12, 6, seededRandom(9)));
  });
});

describe('pickHintSet', () => {
  it('returns a real set from the board', () => {
    const rand = seededRandom(31);
    for (let i = 0; i < 50; i++) {
      const board = shuffledDeck(4, rand).slice(0, 15);
      const h = pickHintSet(board, new Set(), rand);
      if (!hasSet(board)) {
        expect(h).toBeNull();
        continue;
      }
      expect(h).not.toBeNull();
      const [a, b, c] = h as number[];
      expect(isSet(a, b, c)).toBe(true);
      [a, b, c].forEach((x) => expect(board).toContain(x));
    }
  });
  it('skips excluded (already found) sets', () => {
    const board = [card(0, 0, 0, 0), card(1, 1, 1, 1), card(2, 2, 2, 2), card(0, 0, 0, 1), card(0, 0, 0, 2)];
    const first = setKey([board[0], board[1], board[2]]);
    const h = pickHintSet(board, new Set([first]));
    expect(setKey(h as number[])).toBe(setKey([board[0], board[3], board[4]]));
    const both = new Set([first, setKey([board[0], board[3], board[4]])]);
    expect(pickHintSet(board, both)).toBeNull();
  });
});

describe('difficulty configs', () => {
  it('base tables and puzzle sizes are consistent with the deck', () => {
    for (const cfg of Object.values(DIFFS)) {
      expect(cfg.base % 3).toBe(0);
      expect(((cfg.dims === 4 ? 81 : 27) - cfg.base) % 3).toBe(0);
      expect(maxBoard(cfg.dims)).toBeGreaterThan(cfg.base);
      expect(cfg.puzzleCards).toBeLessThanOrEqual(maxBoard(cfg.dims));
    }
    expect(DIFFS.easy.dims).toBe(3);
    expect(DIFFS.hard.hints).toBe(false);
    expect(DIFFS.hard.autoDealDelay).toBe(Infinity);
    expect(DIFFS.easy.autoDealDelay).toBe(0);
  });
});

describe('computeGrid / slotRect', () => {
  const sizes: [number, number][] = [
    [390, 600],
    [390, 480],
    [844, 300],
    [768, 900],
    [320, 420],
    [1280, 700],
  ];
  for (const [W, H] of sizes) {
    for (const n of [9, 12, 15, 18, 21]) {
      it(`fits ${n} cards in ${W}x${H} without overlap`, () => {
        const g = computeGrid(n, W, H);
        expect(g.cols * g.rows).toBeGreaterThanOrEqual(n);
        const rects = Array.from({ length: n }, (_, i) => slotRect(i, g));
        for (const r of rects) {
          expect(r.x).toBeGreaterThanOrEqual(-0.01);
          expect(r.y).toBeGreaterThanOrEqual(-0.01);
          expect(r.x + r.w).toBeLessThanOrEqual(W + 0.01);
          expect(r.y + r.h).toBeLessThanOrEqual(H + 0.01);
          expect(r.w).toBeGreaterThan(0);
          expect(r.h).toBeGreaterThan(0);
        }
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++) {
            const a = rects[i];
            const b = rects[j];
            const overlap = a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
            expect(overlap).toBe(false);
          }
      });
    }
  }
  it('uses 3 columns for 12 cards on a portrait phone with ≥44px targets', () => {
    const g = computeGrid(12, 390, 600);
    expect(g.cols).toBe(3);
    expect(g.rows).toBe(4);
    expect(g.w).toBeGreaterThanOrEqual(44);
    expect(g.h).toBeGreaterThanOrEqual(44);
    const g21 = computeGrid(21, 390, 600);
    expect(g21.w).toBeGreaterThanOrEqual(44);
    expect(g21.h).toBeGreaterThanOrEqual(44);
  });
  it('centres a partial last row', () => {
    const g = computeGrid(7, 300, 600);
    const last = slotRect(6, g);
    if (g.cols > 1 && 7 % g.cols !== 0) {
      const first = slotRect(0, g);
      expect(last.x).toBeGreaterThan(first.x);
    }
  });
});
