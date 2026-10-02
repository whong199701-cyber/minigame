/**
 * Pure logic for Logic Grid (zebra puzzle). No DOM access here so it can be unit tested.
 *
 * Model: N houses in a row (0..n-1), K categories, each with N distinct items. A solution is a permutation
 * per category: `pos[cat][item] = house`. Clues are predicates over such an assignment.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';
export interface DiffConfig {
  n: number;
  k: number;
}
export const DIFFICULTIES: Record<Difficulty, DiffConfig> = {
  easy: { n: 4, k: 3 },
  medium: { n: 5, k: 4 },
  hard: { n: 5, k: 5 },
};
export const DIFFICULTY_LIST: Difficulty[] = ['easy', 'medium', 'hard'];

export type ClueType = 'at' | 'same' | 'leftOf' | 'nextTo' | 'somewhereLeft' | 'notAt' | 'notSame' | 'atEnd';
export const CLUE_TYPES: ClueType[] = ['at', 'same', 'leftOf', 'nextTo', 'somewhereLeft', 'notAt', 'notSame', 'atEnd'];
/** Clue types that reference two items. */
export const BINARY_TYPES: ClueType[] = ['same', 'leftOf', 'nextTo', 'somewhereLeft', 'notSame'];

export interface ItemRef {
  cat: number;
  item: number;
}
export interface Clue {
  type: ClueType;
  a: ItemRef;
  /** Second item for binary clue types. */
  b?: ItemRef;
  /** House index (0-based) for `at` / `notAt`. */
  k?: number;
}

export interface Puzzle {
  difficulty: Difficulty;
  n: number;
  k: number;
  /** solution[cat][item] = house (0-based). */
  solution: number[][];
  clues: Clue[];
  /** Search nodes the solver needed (rough hardness indicator). */
  rating: number;
}

// ── Content (bilingual) ─────────────────────────────────────────────────

export type Lang = 'zh' | 'en';
export interface Bilingual {
  zh: string;
  en: string;
}
export interface ItemDef {
  id: string;
  emoji: string;
  /** Short label for table cells. */
  label: Bilingual;
  /** Noun phrase used inside clue sentences. */
  phrase: Bilingual;
}
export interface CategoryDef {
  id: string;
  emoji: string;
  name: Bilingual;
  items: ItemDef[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'door',
    emoji: '🚪',
    name: { zh: '门色', en: 'Door' },
    items: [
      { id: 'red', emoji: '🔴', label: { zh: '红', en: 'Red' }, phrase: { zh: '红色的门', en: 'the red door' } },
      { id: 'blue', emoji: '🔵', label: { zh: '蓝', en: 'Blue' }, phrase: { zh: '蓝色的门', en: 'the blue door' } },
      { id: 'green', emoji: '🟢', label: { zh: '绿', en: 'Green' }, phrase: { zh: '绿色的门', en: 'the green door' } },
      { id: 'yellow', emoji: '🟡', label: { zh: '黄', en: 'Yellow' }, phrase: { zh: '黄色的门', en: 'the yellow door' } },
      { id: 'white', emoji: '⚪', label: { zh: '白', en: 'White' }, phrase: { zh: '白色的门', en: 'the white door' } },
    ],
  },
  {
    id: 'name',
    emoji: '👤',
    name: { zh: '住户', en: 'Name' },
    items: [
      { id: 'alex', emoji: '', label: { zh: '小明', en: 'Alex' }, phrase: { zh: '小明', en: 'Alex' } },
      { id: 'ben', emoji: '', label: { zh: '小红', en: 'Ben' }, phrase: { zh: '小红', en: 'Ben' } },
      { id: 'carl', emoji: '', label: { zh: '小刚', en: 'Carl' }, phrase: { zh: '小刚', en: 'Carl' } },
      { id: 'dana', emoji: '', label: { zh: '小丽', en: 'Dana' }, phrase: { zh: '小丽', en: 'Dana' } },
      { id: 'eve', emoji: '', label: { zh: '小强', en: 'Eve' }, phrase: { zh: '小强', en: 'Eve' } },
    ],
  },
  {
    id: 'pet',
    emoji: '🐾',
    name: { zh: '宠物', en: 'Pet' },
    items: [
      { id: 'dog', emoji: '🐶', label: { zh: '狗', en: 'Dog' }, phrase: { zh: '养狗的人', en: 'the dog owner' } },
      { id: 'cat', emoji: '🐱', label: { zh: '猫', en: 'Cat' }, phrase: { zh: '养猫的人', en: 'the cat owner' } },
      { id: 'fish', emoji: '🐟', label: { zh: '鱼', en: 'Fish' }, phrase: { zh: '养鱼的人', en: 'the fish owner' } },
      { id: 'bird', emoji: '🐦', label: { zh: '鸟', en: 'Bird' }, phrase: { zh: '养鸟的人', en: 'the bird owner' } },
      { id: 'rabbit', emoji: '🐰', label: { zh: '兔', en: 'Rabbit' }, phrase: { zh: '养兔子的人', en: 'the rabbit owner' } },
    ],
  },
  {
    id: 'drink',
    emoji: '🥤',
    name: { zh: '饮品', en: 'Drink' },
    items: [
      { id: 'tea', emoji: '🍵', label: { zh: '茶', en: 'Tea' }, phrase: { zh: '喝茶的人', en: 'the tea drinker' } },
      { id: 'coffee', emoji: '☕', label: { zh: '咖啡', en: 'Coffee' }, phrase: { zh: '喝咖啡的人', en: 'the coffee drinker' } },
      { id: 'milk', emoji: '🥛', label: { zh: '牛奶', en: 'Milk' }, phrase: { zh: '喝牛奶的人', en: 'the milk drinker' } },
      { id: 'juice', emoji: '🧃', label: { zh: '果汁', en: 'Juice' }, phrase: { zh: '喝果汁的人', en: 'the juice drinker' } },
      { id: 'water', emoji: '💧', label: { zh: '水', en: 'Water' }, phrase: { zh: '喝水的人', en: 'the water drinker' } },
    ],
  },
  {
    id: 'hobby',
    emoji: '🎯',
    name: { zh: '爱好', en: 'Hobby' },
    items: [
      { id: 'chess', emoji: '♟️', label: { zh: '下棋', en: 'Chess' }, phrase: { zh: '下棋的人', en: 'the chess player' } },
      { id: 'painting', emoji: '🎨', label: { zh: '画画', en: 'Paint' }, phrase: { zh: '画画的人', en: 'the painter' } },
      { id: 'hiking', emoji: '🥾', label: { zh: '徒步', en: 'Hike' }, phrase: { zh: '徒步的人', en: 'the hiker' } },
      { id: 'music', emoji: '🎵', label: { zh: '音乐', en: 'Music' }, phrase: { zh: '玩音乐的人', en: 'the musician' } },
      { id: 'cooking', emoji: '🍳', label: { zh: '做饭', en: 'Cook' }, phrase: { zh: '做饭的人', en: 'the cook' } },
    ],
  },
];

/** Sentence templates. Placeholders: {A} {B} item phrases, {k} house number (1-based), {n} house count. */
export const CLUE_TEMPLATES: Record<Lang, Record<ClueType, string>> = {
  zh: {
    at: '{A}在 {k} 号房。',
    same: '{A}和{B}在同一间房。',
    leftOf: '{A}紧挨在{B}的左边。',
    nextTo: '{A}与{B}相邻。',
    somewhereLeft: '{A}在{B}左边的某处。',
    notAt: '{A}不在 {k} 号房。',
    notSame: '{A}和{B}不在同一间房。',
    atEnd: '{A}住在最边上（1 号或 {n} 号房）。',
  },
  en: {
    at: '{A} is in house {k}.',
    same: '{A} is in the same house as {B}.',
    leftOf: '{A} is directly left of {B}.',
    nextTo: '{A} is next to {B}.',
    somewhereLeft: '{A} is somewhere to the left of {B}.',
    notAt: '{A} is not in house {k}.',
    notSame: '{A} is not in the same house as {B}.',
    atEnd: '{A} is at one of the ends (house 1 or {n}).',
  },
};

export function catKey(cat: number): string {
  return 'cat.' + CATEGORIES[cat].id;
}
export function itemKey(cat: number, item: number): string {
  return `item.${CATEGORIES[cat].id}.${CATEGORIES[cat].items[item].id}`;
}
export function phraseKey(cat: number, item: number): string {
  return `phrase.${CATEGORIES[cat].id}.${CATEGORIES[cat].items[item].id}`;
}

/** Dictionary entries for all content + templates, identical key sets in both languages. */
export function contentStrings(): Record<Lang, Record<string, string>> {
  const out: Record<Lang, Record<string, string>> = { zh: {}, en: {} };
  for (const lang of ['zh', 'en'] as Lang[]) {
    CATEGORIES.forEach((c, ci) => {
      out[lang][catKey(ci)] = c.name[lang];
      c.items.forEach((it, ii) => {
        out[lang][itemKey(ci, ii)] = it.label[lang];
        out[lang][phraseKey(ci, ii)] = it.phrase[lang];
      });
    });
    for (const type of CLUE_TYPES) out[lang]['clue.' + type] = CLUE_TEMPLATES[lang][type];
  }
  return out;
}

export type CluePart = { kind: 'text'; text: string } | { kind: 'ref'; ref: ItemRef; emoji: string; text: string };

/** Split a clue into renderable parts (plain text + item references). `tr` resolves dictionary keys. */
export function clueParts(clue: Clue, n: number, tr: (key: string) => string, lang: Lang): CluePart[] {
  const tpl = tr('clue.' + clue.type);
  const parts: CluePart[] = [];
  const re = /\{(A|B|k|n)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) {
    if (m.index > last) parts.push({ kind: 'text', text: tpl.slice(last, m.index) });
    const ph = m[1];
    if (ph === 'A' || ph === 'B') {
      const ref = ph === 'A' ? clue.a : (clue.b ?? clue.a);
      const emoji = CATEGORIES[ref.cat].items[ref.item].emoji;
      parts.push({ kind: 'ref', ref, emoji, text: tr(phraseKey(ref.cat, ref.item)) });
    } else if (ph === 'k') {
      parts.push({ kind: 'text', text: String((clue.k ?? 0) + 1) });
    } else {
      parts.push({ kind: 'text', text: String(n) });
    }
    last = m.index + m[0].length;
  }
  if (last < tpl.length) parts.push({ kind: 'text', text: tpl.slice(last) });
  const first = parts[0];
  if (lang === 'en' && first && first.kind === 'ref' && first.text.length > 0) {
    first.text = first.text[0].toUpperCase() + first.text.slice(1);
  }
  return parts;
}

/** Plain-text rendering of a clue (emoji included for item references). */
export function clueText(clue: Clue, n: number, tr: (key: string) => string, lang: Lang): string {
  return clueParts(clue, n, tr, lang)
    .map((p) => (p.kind === 'ref' && p.emoji ? p.emoji + ' ' + p.text : p.text))
    .join('');
}

// ── Predicates ──────────────────────────────────────────────────────────

export function clueHolds(clue: Clue, pos: number[][], n: number): boolean {
  const pa = pos[clue.a.cat][clue.a.item];
  switch (clue.type) {
    case 'at':
      return pa === clue.k;
    case 'notAt':
      return pa !== clue.k;
    case 'atEnd':
      return pa === 0 || pa === n - 1;
  }
  const b = clue.b;
  if (!b) return false;
  const pb = pos[b.cat][b.item];
  switch (clue.type) {
    case 'same':
      return pa === pb;
    case 'notSame':
      return pa !== pb;
    case 'leftOf':
      return pb === pa + 1;
    case 'nextTo':
      return Math.abs(pa - pb) === 1;
    case 'somewhereLeft':
      return pa < pb;
  }
}

// ── Solver (bitmask domains + propagation + backtracking) ───────────────

const POP = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let c = 0;
  let x = i;
  while (x) {
    c += x & 1;
    x >>= 1;
  }
  POP[i] = c;
}
const highBit = (x: number): number => 31 - Math.clz32(x);
const lowBit = (x: number): number => 31 - Math.clz32(x & -x);

interface SearchState {
  count: number;
  limit: number;
  nodes: number;
  budget: number;
  aborted: boolean;
  found: Uint8Array | null;
}

/** Arc-consistency style propagation. Returns false on contradiction. Mutates `dom`. */
function propagate(dom: Uint8Array, n: number, k: number, clues: Clue[], full: number): boolean {
  let changed = true;
  while (changed) {
    changed = false;
    for (let c = 0; c < k; c++) {
      const base = c * n;
      // Naked singles: a placed item removes its house from the category's other items.
      for (let i = 0; i < n; i++) {
        const d = dom[base + i];
        if (d === 0) return false;
        if (POP[d] === 1) {
          for (let j = 0; j < n; j++) {
            if (j !== i && dom[base + j] & d) {
              dom[base + j] &= ~d;
              if (dom[base + j] === 0) return false;
              changed = true;
            }
          }
        }
      }
      // Hidden singles: a house only one item can occupy gets that item.
      for (let h = 0; h < n; h++) {
        const bit = 1 << h;
        let cnt = 0;
        let idx = -1;
        for (let i = 0; i < n; i++) {
          if (dom[base + i] & bit) {
            cnt++;
            idx = i;
          }
        }
        if (cnt === 0) return false;
        if (cnt === 1 && dom[base + idx] !== bit) {
          dom[base + idx] = bit;
          changed = true;
        }
      }
    }
    for (const cl of clues) {
      const ia = cl.a.cat * n + cl.a.item;
      const da = dom[ia];
      let na = da;
      let ib = -1;
      let db = 0;
      let nb = 0;
      switch (cl.type) {
        case 'at':
          na = da & (1 << (cl.k ?? 0));
          break;
        case 'notAt':
          na = da & ~(1 << (cl.k ?? 0));
          break;
        case 'atEnd':
          na = da & (1 | (1 << (n - 1)));
          break;
        default: {
          const b = cl.b ?? cl.a;
          ib = b.cat * n + b.item;
          db = dom[ib];
          let allowA = full;
          let allowB = full;
          switch (cl.type) {
            case 'same':
              allowA = db;
              allowB = da;
              break;
            case 'notSame':
              allowA = POP[db] === 1 ? full & ~db : full;
              allowB = POP[da] === 1 ? full & ~da : full;
              break;
            case 'leftOf':
              allowA = db >> 1;
              allowB = (da << 1) & full;
              break;
            case 'nextTo':
              allowA = (db >> 1) | ((db << 1) & full);
              allowB = (da >> 1) | ((da << 1) & full);
              break;
            case 'somewhereLeft':
              allowA = (1 << highBit(db)) - 1;
              allowB = full & ~((1 << (lowBit(da) + 1)) - 1);
              break;
          }
          na = da & allowA;
          nb = db & allowB;
        }
      }
      if (na !== da) {
        if (na === 0) return false;
        dom[ia] = na;
        changed = true;
      }
      if (ib >= 0 && nb !== db) {
        if (nb === 0) return false;
        dom[ib] = nb;
        changed = true;
      }
    }
  }
  return true;
}

function search(dom: Uint8Array, n: number, k: number, clues: Clue[], full: number, st: SearchState): void {
  if (st.aborted || st.count >= st.limit) return;
  if (!propagate(dom, n, k, clues, full)) return;
  let best = -1;
  let bestSize = 99;
  const total = n * k;
  for (let idx = 0; idx < total; idx++) {
    const s = POP[dom[idx]];
    if (s > 1 && s < bestSize) {
      best = idx;
      bestSize = s;
      if (s === 2) break;
    }
  }
  if (best < 0) {
    st.count++;
    if (!st.found) st.found = dom.slice();
    return;
  }
  const d = dom[best];
  for (let h = 0; h < n; h++) {
    if (!(d & (1 << h))) continue;
    if (st.count >= st.limit || st.aborted) return;
    st.nodes++;
    if (st.nodes > st.budget) {
      st.aborted = true;
      return;
    }
    const copy = dom.slice();
    copy[best] = 1 << h;
    search(copy, n, k, clues, full, st);
  }
}

function domToPos(dom: Uint8Array, n: number, k: number): number[][] {
  const pos: number[][] = [];
  for (let c = 0; c < k; c++) {
    const row: number[] = [];
    for (let i = 0; i < n; i++) row.push(highBit(dom[c * n + i]));
    pos.push(row);
  }
  return pos;
}

export interface SolveResult {
  /** Number of solutions found (stops at `limit`). */
  count: number;
  /** First solution found, as pos[cat][item] = house. */
  solution: number[][] | null;
  nodes: number;
  /** True when the node budget ran out (count is then a lower bound). */
  aborted: boolean;
}

/** Count solutions (up to `limit`) of a clue set. */
export function solve(n: number, k: number, clues: Clue[], limit = 2, nodeBudget = 40000): SolveResult {
  const full = (1 << n) - 1;
  const dom = new Uint8Array(n * k).fill(full);
  const st: SearchState = { count: 0, limit, nodes: 0, budget: nodeBudget, aborted: false, found: null };
  search(dom, n, k, clues, full, st);
  return { count: st.count, solution: st.found ? domToPos(st.found, n, k) : null, nodes: st.nodes, aborted: st.aborted };
}

// ── Generation ──────────────────────────────────────────────────────────

/** Small seeded PRNG (mulberry32) so puzzles are reproducible in tests. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomSolution(n: number, k: number, rand: () => number): number[][] {
  const pos: number[][] = [];
  for (let c = 0; c < k; c++) {
    const houses = Array.from({ length: n }, (_, i) => i);
    shuffleInPlace(houses, rand);
    pos.push(houses);
  }
  return pos;
}

/** Every true clue of every type for a solution. Symmetric clue types get a random item order. */
export function buildCluePool(pos: number[][], n: number, k: number, rand: () => number = Math.random): Clue[] {
  const items: ItemRef[] = [];
  for (let c = 0; c < k; c++) for (let i = 0; i < n; i++) items.push({ cat: c, item: i });
  const pool: Clue[] = [];
  const sym = (type: ClueType, a: ItemRef, b: ItemRef): Clue => (rand() < 0.5 ? { type, a, b } : { type, a: b, b: a });
  for (const a of items) {
    const pa = pos[a.cat][a.item];
    pool.push({ type: 'at', a, k: pa });
    for (let h = 0; h < n; h++) if (h !== pa) pool.push({ type: 'notAt', a, k: h });
    if (pa === 0 || pa === n - 1) pool.push({ type: 'atEnd', a });
  }
  for (let x = 0; x < items.length; x++) {
    for (let y = x + 1; y < items.length; y++) {
      const a = items[x];
      const b = items[y];
      const pa = pos[a.cat][a.item];
      const pb = pos[b.cat][b.item];
      if (a.cat !== b.cat) {
        if (pa === pb) pool.push(sym('same', a, b));
        else pool.push(sym('notSame', a, b));
      }
      if (pb === pa + 1) pool.push({ type: 'leftOf', a, b });
      else if (pa === pb + 1) pool.push({ type: 'leftOf', a: b, b: a });
      if (Math.abs(pa - pb) === 1) pool.push(sym('nextTo', a, b));
      if (pa < pb) pool.push({ type: 'somewhereLeft', a, b });
      else if (pb < pa) pool.push({ type: 'somewhereLeft', a: b, b: a });
    }
  }
  return pool;
}

/** Sampling weights per clue type (higher = picked earlier). */
const WEIGHTS: Record<Difficulty, Record<ClueType, number>> = {
  easy: { at: 1.1, same: 1.2, leftOf: 1.0, nextTo: 0.8, somewhereLeft: 0.45, notAt: 0.5, notSame: 0.3, atEnd: 0.6 },
  medium: { at: 0.6, same: 1.0, leftOf: 1.0, nextTo: 1.0, somewhereLeft: 0.55, notAt: 0.5, notSame: 0.5, atEnd: 0.7 },
  hard: { at: 0.2, same: 0.9, leftOf: 1.0, nextTo: 1.1, somewhereLeft: 0.6, notAt: 0.55, notSame: 0.8, atEnd: 0.8 },
};
/** Preferred minimum solver search nodes (case analysis) for the final puzzle; best effort within the attempt budget. */
const MIN_RATING: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 2 };
/** Max number of direct "X is in house k" clues allowed into the pool. */
export const AT_CAP: Record<Difficulty, number> = { easy: 3, medium: 2, hard: 1 };
/**
 * Removal priority during minimisation (lower = removed preferentially). Easy keeps direct clues and sheds
 * vague ones; medium/hard shed direct position clues first and otherwise remove in random order so the
 * surviving relational clues stay varied.
 */
const REMOVE_PRIORITY: Record<Difficulty, Partial<Record<ClueType, number>>> = {
  easy: { notSame: 0, notAt: 1, somewhereLeft: 2, atEnd: 3, nextTo: 4, leftOf: 5, same: 6, at: 7 },
  medium: { at: 0, notAt: 1 },
  hard: { at: 0, notAt: 1 },
};
const DEFAULT_PRIORITY = 3;

/** Weighted random order (Efraimidis–Spirakis): key = u^(1/w), descending. */
function weightedOrder(pool: Clue[], weights: Record<ClueType, number>, rand: () => number): Clue[] {
  return pool
    .map((c) => ({ c, key: Math.pow(rand(), 1 / weights[c.type]) }))
    .sort((p, q) => q.key - p.key)
    .map((p) => p.c);
}

interface BuildResult {
  clues: Clue[];
  rating: number;
}

/** Add clues until unique, then strip redundant ones. Returns null if the solver budget was exceeded. */
function buildClueSet(pool: Clue[], n: number, k: number, difficulty: Difficulty, rand: () => number, budget: number): BuildResult | null {
  const chosen: Clue[] = [];
  let unique = false;
  for (const cl of pool) {
    chosen.push(cl);
    const r = solve(n, k, chosen, 2, budget);
    if (r.aborted) return null;
    if (r.count === 1) {
      unique = true;
      break;
    }
  }
  if (!unique) return null;
  const prio = REMOVE_PRIORITY[difficulty];
  const order = chosen
    .map((c, i) => ({ i, key: (prio[c.type] ?? DEFAULT_PRIORITY) + rand() * 0.9 }))
    .sort((p, q) => p.key - q.key)
    .map((p) => p.i);
  const removed = new Set<number>();
  for (const idx of order) {
    removed.add(idx);
    const trial = chosen.filter((_, i) => !removed.has(i));
    const r = solve(n, k, trial, 2, budget);
    if (r.aborted) return null;
    if (r.count !== 1) removed.delete(idx);
  }
  const clues = chosen.filter((_, i) => !removed.has(i));
  const final = solve(n, k, clues, 2, budget);
  return { clues, rating: final.nodes };
}

export interface GenerateOptions {
  maxAttempts?: number;
  nodeBudget?: number;
}

/** Generate a puzzle with a unique solution. Always returns a valid puzzle (falls back to direct clues). */
export function generatePuzzle(difficulty: Difficulty, rand: () => number = Math.random, opts: GenerateOptions = {}): Puzzle {
  const { n, k } = DIFFICULTIES[difficulty];
  const maxAttempts = opts.maxAttempts ?? 12;
  const budget = opts.nodeBudget ?? 40000;
  let fallback: Puzzle | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const solution = randomSolution(n, k, rand);
    const full = buildCluePool(solution, n, k, rand);
    const ats = shuffleInPlace(
      full.filter((c) => c.type === 'at'),
      rand,
    ).slice(0, AT_CAP[difficulty]);
    const pool = weightedOrder([...full.filter((c) => c.type !== 'at'), ...ats], WEIGHTS[difficulty], rand);
    const built = buildClueSet(pool, n, k, difficulty, rand, budget);
    if (!built) continue;
    const puzzle: Puzzle = { difficulty, n, k, solution, clues: shuffleInPlace(built.clues, rand), rating: built.rating };
    if (puzzle.rating >= MIN_RATING[difficulty]) return puzzle;
    if (!fallback || puzzle.rating > fallback.rating) fallback = puzzle;
  }
  if (fallback) return fallback;
  // Fallback (practically unreachable): direct clues for all but one item per category.
  const solution = randomSolution(n, k, rand);
  const clues: Clue[] = [];
  for (let c = 0; c < k; c++) for (let i = 0; i < n - 1; i++) clues.push({ type: 'at', a: { cat: c, item: i }, k: solution[c][i] });
  return { difficulty, n, k, solution, clues, rating: 0 };
}

// ── Player table helpers ────────────────────────────────────────────────

/** Player grid: table[house][cat] = item index or null. */
export type Table = (number | null)[][];

export function emptyTable(n: number, k: number): Table {
  return Array.from({ length: n }, () => new Array<number | null>(k).fill(null));
}

/** Solution as a table (table[house][cat] = item). */
export function solutionToTable(pos: number[][], n: number, k: number): number[][] {
  const t: number[][] = Array.from({ length: n }, () => new Array<number>(k).fill(-1));
  for (let c = 0; c < k; c++) for (let i = 0; i < n; i++) t[pos[c][i]][c] = i;
  return t;
}

/** Place `item` of `cat` in `house`, removing it from any other house of that category. Returns the house it was cleared from, or -1. */
export function applyPlacement(table: Table, house: number, cat: number, item: number): number {
  let cleared = -1;
  for (let h = 0; h < table.length; h++) {
    if (h !== house && table[h][cat] === item) {
      table[h][cat] = null;
      cleared = h;
    }
  }
  table[house][cat] = item;
  return cleared;
}

export function countEmpty(table: Table): number {
  let n = 0;
  for (const row of table) for (const v of row) if (v === null) n++;
  return n;
}

/** Number of filled cells that disagree with the solution. */
export function countWrong(table: Table, pos: number[][]): number {
  const sol = solutionToTable(pos, table.length, pos.length);
  let n = 0;
  for (let h = 0; h < table.length; h++) {
    for (let c = 0; c < pos.length; c++) {
      const v = table[h][c];
      if (v !== null && v !== sol[h][c]) n++;
    }
  }
  return n;
}

export function isSolved(table: Table, pos: number[][]): boolean {
  return countEmpty(table) === 0 && countWrong(table, pos) === 0;
}

/** Pick a cell to reveal: a wrong cell if any, otherwise an empty one. Null when everything is correct. */
export function pickHint(table: Table, pos: number[][], rand: () => number = Math.random): { house: number; cat: number } | null {
  const sol = solutionToTable(pos, table.length, pos.length);
  const wrong: { house: number; cat: number }[] = [];
  const empty: { house: number; cat: number }[] = [];
  for (let h = 0; h < table.length; h++) {
    for (let c = 0; c < pos.length; c++) {
      const v = table[h][c];
      if (v === null) empty.push({ house: h, cat: c });
      else if (v !== sol[h][c]) wrong.push({ house: h, cat: c });
    }
  }
  const list = wrong.length ? wrong : empty;
  if (!list.length) return null;
  return list[Math.floor(rand() * list.length)];
}
