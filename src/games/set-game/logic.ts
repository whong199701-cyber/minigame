/**
 * Pure game logic for Set Match. No DOM access so everything here is unit-testable.
 *
 * A card is an integer 0..80 whose four base-3 digits are its attributes:
 *   digit 0 = count (0..2 → 1..3 symbols), digit 1 = shape, digit 2 = colour, digit 3 = fill.
 * The 27-card beginner deck is simply ids 0..26 (fill digit = 0 → every card is solid).
 *
 * Three distinct cards form a SET iff for every attribute the digits sum to 0 mod 3
 * (all equal or all different). Consequently any two cards determine the unique third card.
 */

export type Mode = 'classic' | 'blitz' | 'puzzle';
export type Diff = 'easy' | 'normal' | 'hard';
export type Dims = 3 | 4;

export const ATTR_COUNT = 0;
export const ATTR_SHAPE = 1;
export const ATTR_COLOR = 2;
export const ATTR_FILL = 3;
export const NUM_ATTRS = 4;

const POW3 = [1, 3, 9, 27, 81];

export interface CardAttrs {
  /** 0..2 → 1..3 symbols */
  count: number;
  /** 0 diamond, 1 pill, 2 wave */
  shape: number;
  /** 0..2 palette index */
  color: number;
  /** 0 solid, 1 striped, 2 outline */
  fill: number;
}

export function attr(card: number, a: number): number {
  return Math.floor(card / POW3[a]) % 3;
}

export function decode(card: number): CardAttrs {
  return { count: attr(card, 0), shape: attr(card, 1), color: attr(card, 2), fill: attr(card, 3) };
}

export function encode(a: CardAttrs): number {
  return a.count + a.shape * 3 + a.color * 9 + a.fill * 27;
}

/** Ordered list of every card in the deck (27 for the 3-attribute deck, 81 for the full deck). */
export function makeDeck(dims: Dims = 4): number[] {
  return Array.from({ length: POW3[dims] }, (_, i) => i);
}

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function shuffledDeck(dims: Dims, rand: () => number = Math.random): number[] {
  return shuffle(makeDeck(dims), rand);
}

export function isSet(a: number, b: number, c: number): boolean {
  if (a === b || b === c || a === c) return false;
  for (let i = 0; i < NUM_ATTRS; i++) {
    if ((attr(a, i) + attr(b, i) + attr(c, i)) % 3 !== 0) return false;
  }
  return true;
}

/** Attributes (indices) that break the rule for this triple; empty for a valid set. */
export function failingAttrs(a: number, b: number, c: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < NUM_ATTRS; i++) {
    if ((attr(a, i) + attr(b, i) + attr(c, i)) % 3 !== 0) out.push(i);
  }
  return out;
}

/** The unique card that completes a set with a and b. */
export function thirdCard(a: number, b: number): number {
  let r = 0;
  for (let i = 0; i < NUM_ATTRS; i++) {
    r += ((6 - attr(a, i) - attr(b, i)) % 3) * POW3[i];
  }
  return r;
}

/** Every set on the board as ascending index triples. O(n²) via third-card lookup. */
export function findAllSets(board: readonly number[]): [number, number, number][] {
  const index = new Map<number, number>();
  board.forEach((c, i) => index.set(c, i));
  const out: [number, number, number][] = [];
  for (let i = 0; i < board.length; i++) {
    for (let j = i + 1; j < board.length; j++) {
      const k = index.get(thirdCard(board[i], board[j]));
      if (k !== undefined && k > j) out.push([i, j, k]);
    }
  }
  return out;
}

export function countSets(board: readonly number[]): number {
  return findAllSets(board).length;
}

export function hasSet(board: readonly number[]): boolean {
  const index = new Set(board);
  for (let i = 0; i < board.length; i++) {
    for (let j = i + 1; j < board.length; j++) {
      const c = thirdCard(board[i], board[j]);
      if (c !== board[i] && c !== board[j] && index.has(c)) return true;
    }
  }
  return false;
}

/** Canonical key of a set of cards (order independent). */
export function setKey(cards: readonly number[]): string {
  return [...cards].sort((x, y) => x - y).join('-');
}

// ── Difficulty ─────────────────────────────────────────────────────────────

export interface DiffConfig {
  dims: Dims;
  /** Cards normally on the table. */
  base: number;
  /** Seconds before the dealer adds 3 cards to a set-less table. 0 = immediately, Infinity = never. */
  autoDealDelay: number;
  hints: boolean;
  puzzleCards: number;
  puzzleSets: number;
}

export const DIFFS: Record<Diff, DiffConfig> = {
  easy: { dims: 3, base: 9, autoDealDelay: 0, hints: true, puzzleCards: 9, puzzleSets: 5 },
  normal: { dims: 4, base: 12, autoDealDelay: 10, hints: true, puzzleCards: 12, puzzleSets: 6 },
  hard: { dims: 4, base: 12, autoDealDelay: Infinity, hints: false, puzzleCards: 15, puzzleSets: 9 },
};

/**
 * Largest table we ever need. The maximum cap (set-free collection) has 9 cards in AG(3,3) and 20 in
 * AG(4,3), so 10 / 21 cards always contain a set; rounded up to a multiple of 3 for dealing.
 */
export function maxBoard(dims: Dims): number {
  return dims === 4 ? 21 : 12;
}

export const BLITZ_SECONDS = 120;

// ── Table (deck + board) ──────────────────────────────────────────────────

export interface Table {
  /** Remaining cards; drawn from the end. */
  deck: number[];
  /** Cards on the table in slot order. */
  board: number[];
}

export function newTable(dims: Dims, base: number, rand: () => number = Math.random): Table {
  const deck = shuffledDeck(dims, rand);
  const board = deck.splice(deck.length - base, base).reverse();
  return { deck, board };
}

/** Deal up to n cards from the deck onto the end of the board. Returns the new table and the dealt cards. */
export function deal(t: Table, n = 3): { table: Table; dealt: number[] } {
  const deck = t.deck.slice();
  const dealt: number[] = [];
  for (let i = 0; i < n && deck.length; i++) dealt.push(deck.pop() as number);
  return { table: { deck, board: [...t.board, ...dealt] }, dealt };
}

/** While the board has no set (and cards remain, and the board is below `limit`), deal 3 more. */
export function autoDeal(t: Table, limit: number): { table: Table; dealt: number[] } {
  let table = t;
  const dealt: number[] = [];
  while (!hasSet(table.board) && table.deck.length > 0 && table.board.length < limit) {
    const r = deal(table, 3);
    table = r.table;
    dealt.push(...r.dealt);
  }
  return { table, dealt };
}

/**
 * Remove the cards at `slots` (a found set). If the board was at (or below) its normal size and the
 * deck has cards, the holes are refilled in place so the rest of the layout stays put. Otherwise the
 * board shrinks: the last cards slide into the holes.
 */
export function removeCards(t: Table, slots: readonly number[], base: number): { table: Table; dealt: number[] } {
  const holes = [...new Set(slots)].filter((s) => s >= 0 && s < t.board.length).sort((a, b) => a - b);
  const board = t.board.slice();
  const deck = t.deck.slice();
  const dealt: number[] = [];
  const refill = t.board.length <= base;
  const remaining: number[] = [];
  for (const h of holes) {
    if (refill && deck.length) {
      const c = deck.pop() as number;
      board[h] = c;
      dealt.push(c);
    } else remaining.push(h);
  }
  if (remaining.length) {
    const targetLen = board.length - remaining.length;
    const holeSet = new Set(remaining);
    // Cards beyond the new length that survive, in order, fill the holes below the new length.
    const tail: number[] = [];
    for (let i = targetLen; i < board.length; i++) if (!holeSet.has(i)) tail.push(board[i]);
    let ti = 0;
    for (const h of remaining) if (h < targetLen) board[h] = tail[ti++];
    board.length = targetLen;
  }
  return { table: { deck, board }, dealt };
}

/** Classic game ends when the deck is empty and no set remains on the table. */
export function isDeckCleared(t: Table): boolean {
  return t.deck.length === 0 && !hasSet(t.board);
}

/** Blitz never runs out: when the deck is empty, every card not on the table is reshuffled into it. */
export function refillDeck(t: Table, dims: Dims, rand: () => number = Math.random): Table {
  if (t.deck.length > 0) return t;
  const onBoard = new Set(t.board);
  const deck = shuffle(
    makeDeck(dims).filter((c) => !onBoard.has(c)),
    rand,
  );
  return { deck, board: t.board.slice() };
}

// ── Scoring ───────────────────────────────────────────────────────────────

export type GameEvent = 'set' | 'wrong' | 'noSetRight' | 'noSetWrong' | 'hint';

export const PENALTY = { wrong: 5, noSetWrong: 10, hint: 20 } as const;

/** Points (blitz) and time penalty in seconds (classic / puzzle) for an event. */
export function scoreEvent(mode: Mode, ev: GameEvent): { points: number; seconds: number } {
  if (mode === 'blitz') {
    if (ev === 'set') return { points: 1, seconds: 0 };
    if (ev === 'wrong' || ev === 'noSetWrong') return { points: -1, seconds: 0 };
    return { points: 0, seconds: 0 };
  }
  if (ev === 'wrong') return { points: 0, seconds: PENALTY.wrong };
  if (ev === 'noSetWrong') return { points: 0, seconds: PENALTY.noSetWrong };
  if (ev === 'hint') return { points: 0, seconds: PENALTY.hint };
  return { points: 0, seconds: 0 };
}

// ── Puzzle ────────────────────────────────────────────────────────────────

/**
 * A table of `size` distinct cards containing exactly `target` sets. Rejection sampling first (the
 * targets used are common: 2–15 %), then a hill-climb that swaps single cards as a guaranteed fallback.
 */
export function generatePuzzle(dims: Dims, size: number, target: number, rand: () => number = Math.random): number[] {
  const all = makeDeck(dims);
  for (let attempt = 0; attempt < 4000; attempt++) {
    const pick = shuffle(all.slice(), rand).slice(0, size);
    if (countSets(pick) === target) return pick;
  }
  // Hill-climb (practically never reached with the shipped targets).
  let cur = shuffle(all.slice(), rand).slice(0, size);
  let dist = Math.abs(countSets(cur) - target);
  for (let iter = 0; iter < 200000 && dist > 0; iter++) {
    const i = Math.floor(rand() * size);
    const inUse = new Set(cur);
    const free = all.filter((c) => !inUse.has(c));
    const next = cur.slice();
    next[i] = free[Math.floor(rand() * free.length)];
    const d = Math.abs(countSets(next) - target);
    if (d <= dist) {
      cur = next;
      dist = d;
    }
  }
  return cur;
}

/** Choose a set on the board (as card ids, shuffled) for the hint, skipping keys in `exclude`. */
export function pickHintSet(board: readonly number[], exclude: ReadonlySet<string> = new Set(), rand: () => number = Math.random): number[] | null {
  const sets = findAllSets(board)
    .map((s) => s.map((i) => board[i]))
    .filter((s) => !exclude.has(setKey(s)));
  if (!sets.length) return null;
  return shuffle(sets[Math.floor(rand() * sets.length)].slice(), rand);
}

// ── Layout ────────────────────────────────────────────────────────────────

export interface GridLayout {
  cols: number;
  rows: number;
  /** card width / height */
  w: number;
  h: number;
  gap: number;
  /** top-left of the grid inside the container */
  ox: number;
  oy: number;
  n: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Card art aspect (landscape card, symbols side by side). */
const ART_W = 72;
const ART_H = 64;

/**
 * Pick the column count that makes the card art as large as possible for n cards in a W×H box,
 * keeping card proportions sensible (not taller than 1.2× width, not wider than 1.75× height).
 */
export function computeGrid(n: number, W: number, H: number, maxCardW = 240): GridLayout {
  const count = Math.max(1, n);
  const gap = Math.max(6, Math.min(14, Math.round(Math.min(W, H) * 0.022)));
  let best: GridLayout | null = null;
  let bestScale = -1;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cw = (W - gap * (cols + 1)) / cols;
    const ch = (H - gap * (rows + 1)) / rows;
    if (cw <= 0 || ch <= 0) continue;
    let w = Math.min(cw, ch * 1.75, maxCardW);
    const h = Math.min(ch, w * 1.2);
    w = Math.min(w, h * 1.75);
    const scale = Math.min((w * 0.84) / ART_W, (h * 0.8) / ART_H);
    if (scale > bestScale * 1.001) {
      bestScale = scale;
      best = { cols, rows, w, h, gap, ox: 0, oy: 0, n: count };
    }
  }
  if (!best) best = { cols: 1, rows: count, w: Math.max(1, W), h: Math.max(1, H / count), gap: 0, ox: 0, oy: 0, n: count };
  const gridW = best.cols * best.w + (best.cols - 1) * best.gap;
  const gridH = best.rows * best.h + (best.rows - 1) * best.gap;
  best.ox = (W - gridW) / 2;
  best.oy = (H - gridH) / 2;
  return best;
}

/** Rectangle of slot i (reading order); a partial last row is centred. */
export function slotRect(i: number, g: GridLayout): Rect {
  const row = Math.floor(i / g.cols);
  const col = i % g.cols;
  const inRow = row === g.rows - 1 ? g.n - row * g.cols : g.cols;
  const shift = ((g.cols - inRow) * (g.w + g.gap)) / 2;
  return { x: g.ox + shift + col * (g.w + g.gap), y: g.oy + row * (g.h + g.gap), w: g.w, h: g.h };
}
