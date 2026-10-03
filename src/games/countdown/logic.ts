/**
 * Pure logic for Number Countdown (the "numbers round"): number drawing, operator rules, scoring,
 * an exhaustive solver, target selection and the player's work board. No DOM access here.
 */

export type Op = '+' | '-' | '*' | '/';
export const OPS: readonly Op[] = ['+', '-', '*', '/'];
export const OP_SYMBOL: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

export const LARGE_POOL: readonly number[] = [25, 50, 75, 100];
/** 1–10, each card twice. */
export const SMALL_POOL: readonly number[] = Array.from({ length: 20 }, (_, i) => (i % 10) + 1);
export const NUM_COUNT = 6;
export const MAX_LARGE = 4;
export const TARGET_MIN = 101;
export const TARGET_MAX = 999;
export const ROUNDS = 10;

export type Mode = 'relaxed' | 'normal' | 'hard';
export interface ModeConfig {
  /** Seconds per round. */
  seconds: number;
  /** Probability that the target is deliberately chosen with no exact solution. */
  impossibleRate: number;
  /** Reachable targets must need at least this many operations (falls back when none qualify). */
  minOps: number;
}
export const MODES: Record<Mode, ModeConfig> = {
  relaxed: { seconds: 90, impossibleRate: 0, minOps: 1 },
  normal: { seconds: 60, impossibleRate: 0, minOps: 2 },
  hard: { seconds: 30, impossibleRate: 0.2, minOps: 3 },
};
export const MODE_IDS: readonly Mode[] = ['relaxed', 'normal', 'hard'];
/** Impossible (hard-mode) targets always have a buildable value at most this far away. */
export const IMPOSSIBLE_NEAR = 5;

// ── Random helpers ──────────────────────────────────────────────────────────

/** Seeded PRNG (mulberry32) for reproducible tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(src: readonly T[], rand: () => number): T[] {
  const arr = src.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
}

// ── Rules ───────────────────────────────────────────────────────────────────

export type OpError = 'negative' | 'zero' | 'fraction';

/** Why `a op b` is not allowed (results must be positive integers), or null when it is fine. */
export function opError(a: number, op: Op, b: number): OpError | null {
  if (op === '-') {
    if (a === b) return 'zero';
    if (a < b) return 'negative';
  } else if (op === '/') {
    if (b === 0 || a % b !== 0) return 'fraction';
  }
  return null;
}

/** Result of `a op b`, or null when the operation is not allowed. */
export function applyOp(a: number, op: Op, b: number): number | null {
  if (opError(a, op, b)) return null;
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
  }
}

/** Points for finishing `diff` away from the target (null = no answer). */
export function pointsFor(diff: number | null): number {
  if (diff === null || diff < 0 || !Number.isFinite(diff)) return 0;
  if (diff === 0) return 10;
  if (diff <= 5) return 7;
  if (diff <= 10) return 5;
  return 0;
}

export function clampLarge(large: number): number {
  if (!Number.isFinite(large)) return 1;
  return Math.max(0, Math.min(MAX_LARGE, Math.floor(large)));
}

/** Draw six numbers: `large` distinct cards from 25/50/75/100, the rest from the small pool (1–10 twice). */
export function drawNumbers(large: number, rand: () => number = Math.random): number[] {
  const l = clampLarge(large);
  const big = shuffled(LARGE_POOL, rand).slice(0, l);
  const small = shuffled(SMALL_POOL, rand).slice(0, NUM_COUNT - l);
  return [...big, ...small].sort((a, b) => b - a);
}

// ── Expressions ─────────────────────────────────────────────────────────────

export interface Expr {
  value: number;
  op?: Op;
  left?: Expr;
  right?: Expr;
}

export interface Step {
  a: number;
  op: Op;
  b: number;
  result: number;
}

const PREC: Record<Op, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

/** Infix string with minimal parentheses, e.g. "(75 + 25) × 10 − 1". */
export function exprString(e: Expr): string {
  if (!e.op || !e.left || !e.right) return String(e.value);
  const p = PREC[e.op];
  let l = exprString(e.left);
  if (e.left.op && PREC[e.left.op] < p) l = `(${l})`;
  let r = exprString(e.right);
  if (e.right.op && (PREC[e.right.op] < p || (PREC[e.right.op] === p && (e.op === '-' || e.op === '/')))) r = `(${r})`;
  return `${l} ${OP_SYMBOL[e.op]} ${r}`;
}

/** The operations that build `e`, in an order where every operand exists before it is used. */
export function stepsOf(e: Expr): Step[] {
  const out: Step[] = [];
  const walk = (n: Expr) => {
    if (!n.op || !n.left || !n.right) return;
    walk(n.left);
    walk(n.right);
    out.push({ a: n.left.value, op: n.op, b: n.right.value, result: n.value });
  };
  walk(e);
  return out;
}

export function formatStep(s: Step): string {
  return `${s.a} ${OP_SYMBOL[s.op]} ${s.b} = ${s.result}`;
}

/** Verify a list of steps against the drawn numbers: every operand available, each number used once. */
export function validateSteps(numbers: readonly number[], steps: readonly Step[]): boolean {
  const pool = numbers.slice();
  const take = (v: number) => {
    const i = pool.indexOf(v);
    if (i < 0) return false;
    pool.splice(i, 1);
    return true;
  };
  for (const s of steps) {
    if (!take(s.a) || !take(s.b)) return false;
    if (applyOp(s.a, s.op, s.b) !== s.result) return false;
    pool.push(s.result);
  }
  return true;
}

// ── Solver ──────────────────────────────────────────────────────────────────

export interface Solution {
  /** Closest value that can be built (the target itself when exact). */
  value: number;
  /** |value − target| — 0 when an exact solution exists. */
  diff: number;
  /** A shortest sequence of operations that builds `value` (empty when it is one of the numbers). */
  steps: Step[];
  /** Infix form of the solution, e.g. "(75 + 25) × 10 − 1". */
  expr: string;
}

interface Search {
  target: number;
  total: number;
  budget: number;
  stopOnExact: boolean;
  bestDiff: number;
  best: Expr | null;
  done: boolean;
  memo: Set<string>;
  /** Flags for reachable values below its length (used to enumerate targets). */
  collect: Uint8Array | null;
  nodes: number;
}

function newSearch(target: number, total: number, budget: number, stopOnExact: boolean, collect: Uint8Array | null): Search {
  return { target, total, budget, stopOnExact, bestDiff: Infinity, best: null, done: false, memo: new Set(), collect, nodes: 0 };
}

function record(s: Search, e: Expr): void {
  const v = e.value;
  if (s.collect && v < s.collect.length) s.collect[v] = 1;
  const d = Math.abs(v - s.target);
  if (d < s.bestDiff) {
    s.bestDiff = d;
    s.best = e;
    if (d === 0 && s.stopOnExact) s.done = true;
  }
}

/**
 * Depth-first search over pairs: replace (x, y) with x op y and recurse. `nodes` is sorted by value,
 * descending, so x ≥ y always. States are memoised by their sorted multiset of values. Redundant moves
 * (×1, ÷1, x − y = y, x ÷ y = y) are pruned because they equal simply not using a number.
 */
function dfs(s: Search, nodes: Expr[]): void {
  s.nodes++;
  const n = nodes.length;
  // Ops used by a result created at this level, and whether its child state may create more.
  const used = s.total - n + 1;
  const canRecurse = n > 2 && used + 1 <= s.budget;
  for (let i = 0; i < n - 1; i++) {
    const x = nodes[i];
    if (i > 0 && nodes[i - 1].value === x.value) continue; // same multiset as the previous i
    for (let j = i + 1; j < n; j++) {
      const y = nodes[j];
      if (j > i + 1 && nodes[j - 1].value === y.value) continue;
      const xv = x.value;
      const yv = y.value;
      for (let k = 0; k < 4; k++) {
        let r: number;
        let op: Op;
        if (k === 0) {
          r = xv + yv;
          op = '+';
        } else if (k === 1) {
          if (xv === yv) continue;
          r = xv - yv;
          if (r === yv) continue;
          op = '-';
        } else if (k === 2) {
          if (yv === 1) continue;
          r = xv * yv;
          op = '*';
        } else {
          if (yv === 1 || xv % yv !== 0) continue;
          r = xv / yv;
          if (r === yv) continue;
          op = '/';
        }
        const e: Expr = { value: r, op, left: x, right: y };
        record(s, e);
        if (s.done) return;
        if (!canRecurse) continue;
        // Child state: the other numbers plus r, kept sorted descending.
        const child: Expr[] = [];
        let placed = false;
        for (let m = 0; m < n; m++) {
          if (m === i || m === j) continue;
          const nm = nodes[m];
          if (!placed && r >= nm.value) {
            child.push(e);
            placed = true;
          }
          child.push(nm);
        }
        if (!placed) child.push(e);
        if (child.length >= 3) {
          let key = '' + child[0].value;
          for (let m = 1; m < child.length; m++) key += ',' + child[m].value;
          if (s.memo.has(key)) continue;
          s.memo.add(key);
        }
        dfs(s, child);
        if (s.done) return;
      }
    }
  }
}

function leavesOf(numbers: readonly number[]): Expr[] {
  return numbers.map((v) => ({ value: v })).sort((a, b) => b.value - a.value);
}

function run(numbers: readonly number[], target: number, budget: number, stopOnExact: boolean, collect: Uint8Array | null = null): Search {
  const leaves = leavesOf(numbers);
  const s = newSearch(target, leaves.length, budget, stopOnExact, collect);
  for (const l of leaves) {
    record(s, l);
    if (s.done) return s;
  }
  if (leaves.length >= 2 && budget >= 1) dfs(s, leaves);
  return s;
}

function toSolution(e: Expr, target: number): Solution {
  return { value: e.value, diff: Math.abs(e.value - target), steps: stepsOf(e), expr: exprString(e) };
}

/** Shortest derivation of exactly `value` (null when unreachable). Iterative deepening on #operations. */
function shortest(numbers: readonly number[], value: number): Expr | null {
  for (let budget = 0; budget < Math.max(1, numbers.length); budget++) {
    const s = run(numbers, value, budget, true);
    if (s.bestDiff === 0 && s.best) return s.best;
  }
  return null;
}

/**
 * Find an exact solution for `target`, or the closest reachable value when none exists, with a
 * shortest list of steps. Each number may be used at most once; every intermediate is a positive integer.
 */
export function solve(numbers: readonly number[], target: number): Solution {
  if (numbers.length === 0) return { value: 0, diff: Math.abs(target), steps: [], expr: '0' };
  const exact = shortest(numbers, target);
  if (exact) return toSolution(exact, target);
  // No exact answer: exhaustive search for the closest value, then its shortest derivation.
  const full = run(numbers, target, numbers.length - 1, false);
  const best = full.best as Expr;
  const short = shortest(numbers, best.value) ?? best;
  return toSolution(short, target);
}

/** Every value in [lo, hi] that can be built from `numbers` using at most `maxOps` operations. */
export function reachableValues(numbers: readonly number[], lo = TARGET_MIN, hi = TARGET_MAX, maxOps = numbers.length - 1): number[] {
  const flags = new Uint8Array(hi + 1);
  run(numbers, -1, Math.max(0, maxOps), false, flags);
  const out: number[] = [];
  for (let v = Math.max(0, lo); v <= hi; v++) if (flags[v]) out.push(v);
  return out;
}

/** Number of DFS states the full search visits (for performance tests). */
export function searchSize(numbers: readonly number[]): number {
  return run(numbers, -1, numbers.length - 1, false).nodes;
}

// ── Round generation ────────────────────────────────────────────────────────

export interface RoundSpec {
  numbers: number[];
  target: number;
  /** Whether an exact solution exists. */
  exact: boolean;
  solution: Solution;
}

/**
 * Draw numbers and choose a target in [101, 999]. Relaxed / normal: always exactly solvable. Hard: about
 * `impossibleRate` of targets have no exact solution. Targets that are too easy (fewer than the mode's
 * `minOps` operations) are avoided when possible.
 */
export function generateRound(large: number, mode: Mode, rand: () => number = Math.random): RoundSpec {
  const cfg = MODES[mode] ?? MODES.normal;
  // Decided once per round so that redraws below do not skew the rate.
  const wantImpossible = rand() < cfg.impossibleRate;
  for (let attempt = 0; attempt < 60; attempt++) {
    // After many unlucky draws (tiny small numbers), add a large number so a target is reachable.
    const l = attempt < 30 ? clampLarge(large) : Math.max(1, clampLarge(large));
    const numbers = drawNumbers(l, rand);
    const all = new Set(reachableValues(numbers, 0, TARGET_MAX + IMPOSSIBLE_NEAR));
    const reach: number[] = [];
    for (let v = TARGET_MIN; v <= TARGET_MAX; v++) if (all.has(v)) reach.push(v);
    if (reach.length === 0) continue;
    let pool: number[] = reach;
    if (wantImpossible && attempt < 20) {
      // Unreachable targets that still have a value within IMPOSSIBLE_NEAR (so 7 points stay possible).
      const missing: number[] = [];
      for (let v = TARGET_MIN; v <= TARGET_MAX; v++) {
        if (all.has(v)) continue;
        for (let d = 1; d <= IMPOSSIBLE_NEAR; d++) {
          if (all.has(v - d) || all.has(v + d)) {
            missing.push(v);
            break;
          }
        }
      }
      // This draw reaches every target: draw again rather than silently making the round exact.
      if (!missing.length) continue;
      pool = missing;
    } else if (cfg.minOps > 1) {
      const easy = new Set(reachableValues(numbers, TARGET_MIN, TARGET_MAX, cfg.minOps - 1));
      const harder = reach.filter((v) => !easy.has(v));
      if (harder.length) pool = harder;
    }
    const target = pick(pool, rand);
    const solution = solve(numbers, target);
    return { numbers, target, exact: solution.diff === 0, solution };
  }
  // Practically unreachable fallback: a fixed, solvable deal.
  const numbers = [100, 75, 50, 8, 3, 2];
  const target = 853; // 8 × 100 + 50 + 3
  const solution = solve(numbers, target);
  return { numbers, target, exact: solution.diff === 0, solution };
}

// ── The player's work board ─────────────────────────────────────────────────

export interface Tile extends Expr {
  id: number;
  /** One of the six drawn numbers (not a result). */
  base: boolean;
  left?: Tile;
  right?: Tile;
}

export interface Move {
  /** Slot of the first operand (emptied). */
  from: number;
  /** Slot of the second operand (receives the result). */
  to: number;
  op: Op;
  a: Tile;
  b: Tile;
  result: Tile;
}

export type CombineResult = { ok: true; tile: Tile; move: Move } | { ok: false; error: OpError | 'invalid' };

/** Six slots of tiles; combining two tiles puts the result in the second tile's slot. */
export class Board {
  readonly numbers: readonly number[];
  readonly slots: (Tile | null)[];
  readonly moves: Move[] = [];
  private seq = 0;

  constructor(numbers: readonly number[]) {
    this.numbers = numbers.slice();
    this.slots = this.numbers.map((v) => ({ id: this.seq++, value: v, base: true }));
  }

  get count(): number {
    return this.slots.reduce((n, t) => n + (t ? 1 : 0), 0);
  }

  tiles(): Tile[] {
    return this.slots.filter((t): t is Tile => t !== null);
  }

  combine(from: number, op: Op, to: number): CombineResult {
    const a = this.slots[from];
    const b = this.slots[to];
    if (from === to || !a || !b) return { ok: false, error: 'invalid' };
    const err = opError(a.value, op, b.value);
    if (err) return { ok: false, error: err };
    const value = applyOp(a.value, op, b.value) as number;
    const tile: Tile = { id: this.seq++, value, base: false, op, left: a, right: b };
    this.slots[from] = null;
    this.slots[to] = tile;
    const move: Move = { from, to, op, a, b, result: tile };
    this.moves.push(move);
    return { ok: true, tile, move };
  }

  undo(): Move | null {
    const m = this.moves.pop();
    if (!m) return null;
    this.slots[m.from] = m.a;
    this.slots[m.to] = m.b;
    return m;
  }

  /** Undo everything; returns false when there was nothing to undo. */
  reset(): boolean {
    if (!this.moves.length) return false;
    while (this.moves.length) this.undo();
    return true;
  }

  /** Tile currently on the board closest to `target` (earliest slot wins ties). */
  closest(target: number): Tile | null {
    let best: Tile | null = null;
    for (const t of this.slots) {
      if (t && (!best || Math.abs(t.value - target) < Math.abs(best.value - target))) best = t;
    }
    return best;
  }
}

/** True when `candidate` is strictly closer to the target than `current` (null counts as infinitely far). */
export function isCloser(candidate: number, current: number | null, target: number): boolean {
  return current === null || Math.abs(candidate - target) < Math.abs(current - target);
}

// ── Game summary ────────────────────────────────────────────────────────────

export interface RoundResult {
  target: number;
  /** The value the player locked in (null when none). */
  answer: number | null;
  /** |answer − target| or null. */
  diff: number | null;
  /** Closest achievable distance (0 when an exact solution exists). */
  bestDiff: number;
  points: number;
}

/** A round is "perfect" when the player matched the best achievable result (exact, when possible). */
export function isPerfect(diff: number | null, bestDiff: number): boolean {
  return diff !== null && diff <= bestDiff;
}

export function makeResult(target: number, answer: number | null, bestDiff: number): RoundResult {
  const diff = answer === null ? null : Math.abs(answer - target);
  return { target, answer, diff, bestDiff, points: pointsFor(diff) };
}

export function longestStreak(flags: readonly boolean[]): number {
  let best = 0;
  let cur = 0;
  for (const f of flags) {
    cur = f ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return best;
}

/** Length of the streak ending at the last element. */
export function currentStreak(flags: readonly boolean[]): number {
  let n = 0;
  for (let i = flags.length - 1; i >= 0 && flags[i]; i--) n++;
  return n;
}

export interface Summary {
  total: number;
  exact: number;
  perfect: number;
  longestStreak: number;
  maxTotal: number;
}

export function summarize(results: readonly RoundResult[]): Summary {
  const perfectFlags = results.map((r) => isPerfect(r.diff, r.bestDiff));
  return {
    total: results.reduce((s, r) => s + r.points, 0),
    exact: results.filter((r) => r.diff === 0).length,
    perfect: perfectFlags.filter(Boolean).length,
    longestStreak: longestStreak(perfectFlags),
    maxTotal: results.length * 10,
  };
}
