/**
 * Pure FreeCell logic: Microsoft deals, move legality (incl. supermoves), safe auto-play, win detection,
 * move encoding for persistence and a time-sliced best-first solver (used for hints and for verifying
 * that reduced-free-cell deals are winnable). No DOM access here.
 *
 * Card encoding (same as the original Microsoft implementation): card = rank * 4 + suit,
 * rank 0..12 = A..K, suit 0..3 = ♣ ♦ ♥ ♠.
 *
 * Locations are small integers:
 *   0..7   cascades
 *   8..11  free cells (only the first `cells.length` exist)
 *   12..15 foundations, one per suit (12 + suit)
 */

export const EMPTY = -1;
export const CASCADES = 8;
export const CELL0 = 8;
export const FOUND0 = 12;
export const MAX_DEAL = 32000;
export const UNSOLVABLE_DEAL = 11982;

export const SUIT_LETTERS = ['C', 'D', 'H', 'S'];
export const SUIT_GLYPHS = ['♣', '♦', '♥', '♠'];
export const RANK_LETTERS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export interface State {
  cascades: number[][];
  /** EMPTY or a card; length = number of free cells in this mode. */
  cells: number[];
  /** Cards on each suit's foundation (0..13); the top card has rank found[suit] - 1. */
  found: number[];
}

export interface Move {
  from: number;
  to: number;
  /** Number of cards moved (> 1 only for cascade → cascade supermoves). */
  n: number;
}

export type MoveCheck = 'ok' | 'rule' | 'capacity';

export const rankOf = (c: number): number => c >> 2;
export const suitOf = (c: number): number => c & 3;
export const isRed = (c: number): boolean => (c & 3) === 1 || (c & 3) === 2;
export const makeCard = (rank: number, suit: number): number => rank * 4 + suit;
export const isCascadeLoc = (l: number): boolean => l >= 0 && l < CASCADES;
export const isCellLoc = (l: number): boolean => l >= CELL0 && l < FOUND0;
export const isFoundLoc = (l: number): boolean => l >= FOUND0 && l < FOUND0 + 4;

/** "JD", "TC", "AS" … (as used in the classic deal listings). */
export function cardCode(c: number): string {
  return RANK_LETTERS[rankOf(c)] + SUIT_LETTERS[suitOf(c)];
}

/** "J♦", "10♣" … for display. */
export function cardLabel(c: number): string {
  return RANK_LABELS[rankOf(c)] + SUIT_GLYPHS[suitOf(c)];
}

/** True when `card` may be placed on `target` inside a cascade (one rank lower, opposite colour). */
export function fitsOn(card: number, target: number): boolean {
  return (target >> 2) === (card >> 2) + 1 && isRed(card) !== isRed(target);
}

// ── Deals ────────────────────────────────────────────────────────────────

/** The Microsoft FreeCell deal generator (deal numbers 1–32000 match the classic layouts). */
export function msDeal(deal: number): number[][] {
  let seed = deal >>> 0;
  const deck: number[] = [];
  for (let i = 0; i < 52; i++) deck.push(i);
  const cascades: number[][] = [];
  for (let i = 0; i < CASCADES; i++) cascades.push([]);
  let left = 52;
  for (let i = 0; i < 52; i++) {
    seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
    const r = (seed >>> 16) & 0x7fff;
    const j = r % left;
    cascades[i % CASCADES].push(deck[j]);
    deck[j] = deck[--left];
  }
  return cascades;
}

export function isValidDeal(deal: number): boolean {
  return Number.isInteger(deal) && deal >= 1 && deal <= MAX_DEAL;
}

/** Random deal number in 1..32000, never the unsolvable #11982 (or any number in `exclude`). */
export function randomDeal(rand: () => number = Math.random, exclude: readonly number[] = []): number {
  for (let tries = 0; tries < 1000; tries++) {
    const d = 1 + Math.floor(rand() * MAX_DEAL);
    if (d !== UNSOLVABLE_DEAL && !exclude.includes(d) && isValidDeal(d)) return d;
  }
  for (let d = 1; d <= MAX_DEAL; d++) if (d !== UNSOLVABLE_DEAL && !exclude.includes(d)) return d;
  return 1;
}

export function newGame(deal: number, numCells = 4): State {
  return {
    cascades: msDeal(deal),
    cells: new Array<number>(Math.max(1, Math.min(4, numCells))).fill(EMPTY),
    found: [0, 0, 0, 0],
  };
}

/** The position the player starts from: the deal with any immediately safe cards (exposed aces) auto-played. */
export function initialState(deal: number, numCells = 4): State {
  const s = newGame(deal, numCells);
  autoplayInPlace(s);
  return s;
}

export function cloneState(s: State): State {
  return { cascades: s.cascades.map((c) => c.slice()), cells: s.cells.slice(), found: s.found.slice() };
}

// ── Rules ────────────────────────────────────────────────────────────────

/** Length of the ordered run (alternating colours, descending) at the bottom (exposed end) of a cascade. */
export function runLength(col: readonly number[]): number {
  const len = col.length;
  if (len === 0) return 0;
  let n = 1;
  for (let i = len - 1; i > 0; i--) {
    if (fitsOn(col[i], col[i - 1])) n++;
    else break;
  }
  return n;
}

export function freeCellCount(s: State): number {
  let n = 0;
  for (const c of s.cells) if (c === EMPTY) n++;
  return n;
}

export function emptyCascadeCount(s: State): number {
  let n = 0;
  for (const c of s.cascades) if (c.length === 0) n++;
  return n;
}

/**
 * Supermove capacity: (free cells + 1) × 2^(empty cascades). When the destination itself is an empty cascade
 * it cannot be used as temporary storage, so the exponent drops by one.
 */
export function maxMoveSize(s: State, toEmptyCascade: boolean): number {
  const free = freeCellCount(s);
  let empty = emptyCascadeCount(s);
  if (toEmptyCascade) empty = Math.max(0, empty - 1);
  return (free + 1) * 2 ** empty;
}

/** The card at the head of the moved group (the one that lands on the destination), or EMPTY. */
export function movingCard(s: State, from: number, n: number): number {
  if (isCascadeLoc(from)) {
    const col = s.cascades[from];
    return n >= 1 && n <= col.length ? col[col.length - n] : EMPTY;
  }
  if (isCellLoc(from)) {
    const i = from - CELL0;
    return i < s.cells.length && n === 1 ? s.cells[i] : EMPTY;
  }
  return EMPTY;
}

/** Validate a move. 'capacity' means the cards would fit but there aren't enough free cells / columns. */
export function checkMove(s: State, m: Move): MoveCheck {
  const { from, to, n } = m;
  if (from === to || !Number.isInteger(n) || n < 1) return 'rule';
  let card: number;
  if (isCascadeLoc(from)) {
    const col = s.cascades[from];
    if (n > col.length || n > runLength(col)) return 'rule';
    card = col[col.length - n];
  } else if (isCellLoc(from)) {
    const i = from - CELL0;
    if (i >= s.cells.length || n !== 1) return 'rule';
    card = s.cells[i];
    if (card === EMPTY) return 'rule';
  } else {
    return 'rule';
  }
  if (isFoundLoc(to)) {
    if (n !== 1) return 'rule';
    const suit = to - FOUND0;
    return suitOf(card) === suit && rankOf(card) === s.found[suit] ? 'ok' : 'rule';
  }
  if (isCellLoc(to)) {
    const i = to - CELL0;
    if (n !== 1 || i >= s.cells.length || s.cells[i] !== EMPTY) return 'rule';
    return 'ok';
  }
  if (!isCascadeLoc(to)) return 'rule';
  const dest = s.cascades[to];
  if (dest.length === 0) return n <= maxMoveSize(s, true) ? 'ok' : 'capacity';
  if (!fitsOn(card, dest[dest.length - 1])) return 'rule';
  return n <= maxMoveSize(s, false) ? 'ok' : 'capacity';
}

export function canMove(s: State, m: Move): boolean {
  return checkMove(s, m) === 'ok';
}

/** Apply a move in place without validation (callers validate first). */
export function applyMoveInPlace(s: State, m: Move): void {
  let cards: number[];
  if (isCascadeLoc(m.from)) {
    const col = s.cascades[m.from];
    cards = col.splice(col.length - m.n, m.n);
  } else {
    const i = m.from - CELL0;
    cards = [s.cells[i]];
    s.cells[i] = EMPTY;
  }
  if (isFoundLoc(m.to)) {
    s.found[m.to - FOUND0] += cards.length;
  } else if (isCellLoc(m.to)) {
    s.cells[m.to - CELL0] = cards[0];
  } else {
    const dest = s.cascades[m.to];
    for (const c of cards) dest.push(c);
  }
}

/** Return a new state with the move applied, or null when it is illegal. */
export function applyMove(s: State, m: Move): State | null {
  if (!canMove(s, m)) return null;
  const next = cloneState(s);
  applyMoveInPlace(next, m);
  return next;
}

/**
 * Standard safe auto-play rule: the card is the next one for its foundation and both opposite-colour
 * cards one rank lower are already on foundations (so nothing could ever need to be placed on it).
 * Aces are always safe; twos are too, because the only cards that could go on a two are aces.
 */
export function isSafeAutoplay(found: readonly number[], card: number): boolean {
  const r = rankOf(card);
  if (found[suitOf(card)] !== r) return false;
  if (r <= 1) return true;
  if (isRed(card)) return found[0] >= r && found[3] >= r;
  return found[1] >= r && found[2] >= r;
}

/** Next safe foundation move (free cells first, then cascades), or null. */
export function findAutoMove(s: State): Move | null {
  for (let i = 0; i < s.cells.length; i++) {
    const c = s.cells[i];
    if (c !== EMPTY && isSafeAutoplay(s.found, c)) return { from: CELL0 + i, to: FOUND0 + suitOf(c), n: 1 };
  }
  for (let i = 0; i < CASCADES; i++) {
    const col = s.cascades[i];
    if (col.length === 0) continue;
    const c = col[col.length - 1];
    if (isSafeAutoplay(s.found, c)) return { from: i, to: FOUND0 + suitOf(c), n: 1 };
  }
  return null;
}

/** Apply every safe auto-play move. Returns the resulting state and the moves made (in order). */
export function autoplay(s: State): { state: State; moves: Move[] } {
  const state = cloneState(s);
  const moves = autoplayInPlace(state);
  return { state, moves };
}

export function autoplayInPlace(s: State): Move[] {
  const moves: Move[] = [];
  for (;;) {
    const m = findAutoMove(s);
    if (!m) return moves;
    applyMoveInPlace(s, m);
    moves.push(m);
  }
}

export function foundationTotal(s: State): number {
  return s.found[0] + s.found[1] + s.found[2] + s.found[3];
}

export function isWon(s: State): boolean {
  return s.found[0] === 13 && s.found[1] === 13 && s.found[2] === 13 && s.found[3] === 13;
}

/**
 * True when the rest of the game plays itself: every cascade is non-increasing in rank towards its exposed
 * end, so the lowest outstanding cards are always reachable.
 */
export function isTriviallySolvable(s: State): boolean {
  for (const col of s.cascades) {
    for (let i = 1; i < col.length; i++) if (rankOf(col[i]) > rankOf(col[i - 1])) return false;
  }
  return true;
}

/** Foundation moves that finish a trivially solvable position (empty when it is not trivially solvable). */
export function finishMoves(s: State): Move[] {
  if (!isTriviallySolvable(s)) return [];
  const st = cloneState(s);
  const moves: Move[] = [];
  for (let guard = 0; guard < 60 && !isWon(st); guard++) {
    let best: Move | null = null;
    let bestRank = 99;
    for (let i = 0; i < st.cells.length; i++) {
      const c = st.cells[i];
      if (c !== EMPTY && st.found[suitOf(c)] === rankOf(c) && rankOf(c) < bestRank) {
        best = { from: CELL0 + i, to: FOUND0 + suitOf(c), n: 1 };
        bestRank = rankOf(c);
      }
    }
    for (let i = 0; i < CASCADES; i++) {
      const col = st.cascades[i];
      if (!col.length) continue;
      const c = col[col.length - 1];
      if (st.found[suitOf(c)] === rankOf(c) && rankOf(c) < bestRank) {
        best = { from: i, to: FOUND0 + suitOf(c), n: 1 };
        bestRank = rankOf(c);
      }
    }
    if (!best) return [];
    applyMoveInPlace(st, best);
    moves.push(best);
  }
  return isWon(st) ? moves : [];
}

/**
 * All distinct legal moves (symmetric duplicates such as "to the 2nd empty free cell" are dropped, and so is
 * moving an entire cascade into an empty one, which changes nothing).
 */
export function legalMoves(s: State): Move[] {
  const out: Move[] = [];
  const firstEmptyCell = s.cells.indexOf(EMPTY);
  let firstEmptyCol = -1;
  for (let i = 0; i < CASCADES; i++) if (s.cascades[i].length === 0) {
    firstEmptyCol = i;
    break;
  }
  const capNonEmpty = maxMoveSize(s, false);
  const capEmpty = maxMoveSize(s, true);
  // From free cells.
  for (let i = 0; i < s.cells.length; i++) {
    const c = s.cells[i];
    if (c === EMPTY) continue;
    if (s.found[suitOf(c)] === rankOf(c)) out.push({ from: CELL0 + i, to: FOUND0 + suitOf(c), n: 1 });
    for (let d = 0; d < CASCADES; d++) {
      const dest = s.cascades[d];
      if (dest.length && fitsOn(c, dest[dest.length - 1])) out.push({ from: CELL0 + i, to: d, n: 1 });
    }
    if (firstEmptyCol >= 0) out.push({ from: CELL0 + i, to: firstEmptyCol, n: 1 });
  }
  // From cascades.
  for (let i = 0; i < CASCADES; i++) {
    const col = s.cascades[i];
    const len = col.length;
    if (!len) continue;
    const top = col[len - 1];
    if (s.found[suitOf(top)] === rankOf(top)) out.push({ from: i, to: FOUND0 + suitOf(top), n: 1 });
    const run = runLength(col);
    for (let d = 0; d < CASCADES; d++) {
      if (d === i) continue;
      const dest = s.cascades[d];
      if (!dest.length) continue;
      const t = dest[dest.length - 1];
      // The card that must land on t has rank(t) - 1; it sits k from the end.
      const k = rankOf(t) - rankOf(top);
      if (k >= 1 && k <= run && k <= capNonEmpty && fitsOn(col[len - k], t)) out.push({ from: i, to: d, n: k });
    }
    if (firstEmptyCol >= 0) {
      const maxK = Math.min(run, capEmpty);
      for (let k = 1; k <= maxK; k++) if (k < len) out.push({ from: i, to: firstEmptyCol, n: k });
    }
    if (firstEmptyCell >= 0) out.push({ from: i, to: CELL0 + firstEmptyCell, n: 1 });
  }
  return out;
}

export function hasAnyMove(s: State): boolean {
  return legalMoves(s).length > 0;
}

/**
 * "Smart move" for the group of `n` cards at `from`: foundation if possible, else the best cascade
 * (a non-empty one that extends the longest run, then an empty one), else a free cell.
 */
export function smartMove(s: State, from: number, n: number): Move | null {
  const card = movingCard(s, from, n);
  if (card === EMPTY) return null;
  if (n === 1) {
    const f: Move = { from, to: FOUND0 + suitOf(card), n: 1 };
    if (canMove(s, f)) return f;
  }
  let best: Move | null = null;
  let bestScore = -1;
  for (let d = 0; d < CASCADES; d++) {
    if (d === from) continue;
    const dest = s.cascades[d];
    if (!dest.length) continue;
    const m = { from, to: d, n };
    if (!canMove(s, m)) continue;
    const score = runLength(dest) * 2 + (dest.length === runLength(dest) ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  if (best) return best;
  const fromWholeColumn = isCascadeLoc(from) && s.cascades[from].length === n;
  if (!fromWholeColumn) {
    for (let d = 0; d < CASCADES; d++) {
      if (d !== from && s.cascades[d].length === 0) {
        const m = { from, to: d, n };
        if (canMove(s, m)) return m;
        break;
      }
    }
  }
  if (n === 1 && !isCellLoc(from)) {
    const i = s.cells.indexOf(EMPTY);
    if (i >= 0) return { from, to: CELL0 + i, n: 1 };
  }
  return null;
}

// ── Persistence helpers ─────────────────────────────────────────────────

/** Pack a move into a small integer (from, to < 16; n < 64). */
export function encodeMove(m: Move): number {
  return (m.from << 10) | (m.to << 6) | m.n;
}

export function decodeMove(x: number): Move {
  return { from: (x >> 10) & 15, to: (x >> 6) & 15, n: x & 63 };
}

/** One user move followed by the auto-play moves it triggered. */
export type MoveGroup = Move[];

/**
 * Rebuild a game from a deal and a list of move groups. Every move is validated; returns null on any
 * inconsistency (corrupt save).
 */
export function replay(deal: number, numCells: number, groups: readonly MoveGroup[]): State[] | null {
  if (!isValidDeal(deal)) return null;
  const states: State[] = [initialState(deal, numCells)];
  let cur = states[0];
  for (const g of groups) {
    if (!g.length) return null;
    let next = cur;
    for (const m of g) {
      const n = applyMove(next, m);
      if (!n) return null;
      next = n;
    }
    states.push(next);
    cur = next;
  }
  return states;
}

// ── Solver ──────────────────────────────────────────────────────────────

/** Order-independent 53-bit hash of a position (cascade order and free cell order don't matter). */
export function stateKey(s: State): number {
  let a = 0;
  let b = 0;
  for (const col of s.cascades) {
    let h1 = 0x811c9dc5;
    let h2 = 0x9747b28c;
    for (let i = 0; i < col.length; i++) {
      const v = col[i] + 1;
      h1 = Math.imul(h1 ^ v, 0x01000193);
      h2 = Math.imul(h2 ^ (v * 31 + i), 0x5bd1e995);
      h2 ^= h2 >>> 15;
    }
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;
    a = (a + h1) >>> 0;
    b = (b + (h2 >>> 0)) >>> 0;
  }
  for (const c of s.cells) {
    if (c === EMPTY) continue;
    let h = Math.imul(c + 101, 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca77);
    h ^= h >>> 13;
    a = (a + h) >>> 0;
    b = (b + Math.imul(c + 7, 0x27d4eb2f)) >>> 0;
  }
  return a * 2097152 + (b & 0x1fffff);
}

/** Heuristic distance to a win (lower is better). */
export function heuristic(s: State): number {
  let h = (52 - foundationTotal(s)) * 3;
  // How deep is the next needed card of each suit buried?
  for (let suit = 0; suit < 4; suit++) {
    const r = s.found[suit];
    if (r >= 13) continue;
    const want = makeCard(r, suit);
    for (const col of s.cascades) {
      const idx = col.indexOf(want);
      if (idx >= 0) {
        h += (col.length - 1 - idx) * 2;
        break;
      }
    }
  }
  // Disorder: cards resting on something they don't build on.
  for (const col of s.cascades) {
    let minRank = 99;
    for (let i = 0; i < col.length; i++) {
      const r = rankOf(col[i]);
      if (i > 0 && !fitsOn(col[i], col[i - 1])) h += 1;
      if (r > minRank) h += 1; // sits above a lower card → must be moved before that one is freed
      if (r < minRank) minRank = r;
    }
  }
  const free = freeCellCount(s);
  const empty = emptyCascadeCount(s);
  h -= free * 2 + empty * 4;
  return h;
}

interface ExpNode {
  parent: ExpNode | null;
  move: number; // encoded move from parent (-1 for the root)
  state: Uint8Array; // compact snapshot
  g: number;
}

interface Pending {
  f: number;
  parent: ExpNode;
  move: number;
  g: number;
}

function packState(s: State): Uint8Array {
  let size = s.cells.length + 4 + CASCADES;
  for (const c of s.cascades) size += c.length;
  const out = new Uint8Array(size + 1);
  let p = 0;
  out[p++] = s.cells.length;
  for (const c of s.cells) out[p++] = c === EMPTY ? 255 : c;
  for (const f of s.found) out[p++] = f;
  for (const col of s.cascades) {
    out[p++] = col.length;
    for (const c of col) out[p++] = c;
  }
  return out;
}

function unpackState(a: Uint8Array): State {
  let p = 0;
  const nc = a[p++];
  const cells: number[] = [];
  for (let i = 0; i < nc; i++) {
    const v = a[p++];
    cells.push(v === 255 ? EMPTY : v);
  }
  const found = [a[p++], a[p++], a[p++], a[p++]];
  const cascades: number[][] = [];
  for (let i = 0; i < CASCADES; i++) {
    const len = a[p++];
    const col: number[] = [];
    for (let j = 0; j < len; j++) col.push(a[p++]);
    cascades.push(col);
  }
  return { cascades, cells, found };
}

class MinHeap {
  private a: Pending[] = [];
  get size(): number {
    return this.a.length;
  }
  push(x: Pending): void {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= x.f) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = x;
  }
  pop(): Pending | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop() as Pending;
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && a[r].f < a[l].f ? r : l;
        if (a[c].f >= last.f) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

export type SolveStatus = 'running' | 'solved' | 'unsolvable' | 'gaveup';

export interface SolverOptions {
  /** Maximum expanded positions before giving up. */
  maxExpansions?: number;
  /** Weight of path length in the priority (0 = pure greedy). */
  pathWeight?: number;
}

/**
 * Best-first search over user moves; auto-play is applied after every move, exactly as in the game, so a
 * solution's first move is directly playable as a hint. Work can be split into small time slices with
 * `step(ms)` so the UI never freezes.
 */
export class Solver {
  status: SolveStatus = 'running';
  /** User moves of the solution (auto-play in between is implied). */
  solution: Move[] = [];
  expanded = 0;
  private heap = new MinHeap();
  private seen = new Set<number>();
  private readonly maxExpansions: number;
  private readonly pathWeight: number;

  constructor(start: State, opts: SolverOptions = {}) {
    this.maxExpansions = opts.maxExpansions ?? 60000;
    this.pathWeight = opts.pathWeight ?? 1;
    const s = cloneState(start);
    autoplayInPlace(s);
    if (isWon(s)) {
      this.status = 'solved';
      return;
    }
    this.seen.add(stateKey(s));
    const root: ExpNode = { parent: null, move: -1, state: packState(s), g: 0 };
    this.expand(root, s);
  }

  private expand(node: ExpNode, s: State): void {
    this.expanded++;
    const moves = legalMoves(s);
    for (const m of moves) {
      const child = cloneState(s);
      applyMoveInPlace(child, m);
      autoplayInPlace(child);
      if (isWon(child)) {
        this.finish({ parent: node, move: encodeMove(m), state: new Uint8Array(0), g: node.g + 1 });
        return;
      }
      const key = stateKey(child);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const g = node.g + 1;
      this.heap.push({ f: heuristic(child) + g * this.pathWeight, parent: node, move: encodeMove(m), g });
    }
  }

  private finish(last: ExpNode): void {
    const path: Move[] = [];
    for (let n: ExpNode | null = last; n && n.move >= 0; n = n.parent) path.push(decodeMove(n.move));
    path.reverse();
    this.solution = path;
    this.status = 'solved';
  }

  /** Run for up to `budgetMs` milliseconds (or `maxNodes` expansions). */
  step(budgetMs = 10, maxNodes = Infinity): SolveStatus {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let n = 0;
    while (this.status === 'running') {
      if (this.expanded >= this.maxExpansions) {
        this.status = 'gaveup';
        break;
      }
      const p = this.heap.pop();
      if (!p) {
        this.status = 'unsolvable';
        break;
      }
      const s = unpackState(p.parent.state);
      applyMoveInPlace(s, decodeMove(p.move));
      autoplayInPlace(s);
      const node: ExpNode = { parent: p.parent, move: p.move, state: packState(s), g: p.g };
      this.expand(node, s);
      n++;
      if (n >= maxNodes) break;
      if ((n & 15) === 0) {
        const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (t - t0 >= budgetMs) break;
      }
    }
    return this.status;
  }
}

/** Synchronous convenience wrapper (tests, small searches). */
export function solve(start: State, opts: SolverOptions = {}): { status: SolveStatus; moves: Move[]; expanded: number } {
  const solver = new Solver(start, opts);
  while (solver.status === 'running') solver.step(1000);
  return { status: solver.status, moves: solver.solution, expanded: solver.expanded };
}

/** Play a solver solution from `start` (with auto-play after each move); returns the final state or null. */
export function playSolution(start: State, moves: readonly Move[]): State | null {
  let s = autoplay(start).state;
  for (const m of moves) {
    const n = applyMove(s, m);
    if (!n) return null;
    s = autoplay(n).state;
  }
  return s;
}
