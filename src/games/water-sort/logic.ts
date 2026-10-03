/**
 * Pure game logic for Water Sort: pour rules, win detection, an A-star / best-first solver with canonical
 * state hashing, and deterministic level generation verified by the solver. No DOM access.
 */
import { seededRandom, shuffle } from '../../app/canvas';

/** Units of liquid a tube can hold. */
export const CAP = 4;
/** Largest number of distinct colours any level uses. */
export const MAX_COLOURS = 12;
/** Hints available per level. */
export const HINTS_PER_LEVEL = 3;

/** A tube is a list of colour indices from bottom to top. */
export type Tube = number[];
export type State = Tube[];
export interface Move {
  from: number;
  to: number;
}

export interface Level {
  level: number;
  colours: number;
  empties: number;
  /** Starting tubes (never mutated by the game — copy before playing). */
  tubes: State;
  /** Solver move count: the "par" for star rating. */
  par: number;
  /** One solution from the starting state. */
  solution: Move[];
  /** Which seed offset produced this level (0 = first try). */
  attempt: number;
  /** True when the level was built by a reverse walk because random scrambles kept failing. */
  fallback: boolean;
}

export type SolveResult =
  | { status: 'solved'; moves: Move[]; nodes: number }
  | { status: 'unsolvable'; nodes: number }
  | { status: 'limit'; nodes: number };

export interface SolveOptions {
  /** Maximum nodes expanded before giving up with status 'limit'. */
  maxNodes?: number;
  /** Heuristic weight: 1 = A* (optimal), >1 = greedier and faster (not optimal). */
  weight?: number;
}

// ── Level parameters ────────────────────────────────────────────────────

/** Number of colours used by a level (grows without bound up to MAX_COLOURS). */
export function colourCountFor(level: number): number {
  if (level <= 3) return 3;
  if (level <= 8) return 4;
  if (level <= 15) return 5;
  if (level <= 25) return 6;
  if (level <= 40) return 7;
  if (level <= 60) return 8;
  if (level <= 90) return 9;
  if (level <= 130) return 10;
  if (level <= 180) return 11;
  return MAX_COLOURS;
}

/** Every 10th level is a "challenge" with a single empty tube. */
export function isChallengeLevel(level: number): boolean {
  return level % 10 === 0;
}

export function emptyCountFor(level: number): number {
  return isChallengeLevel(level) ? 1 : 2;
}

// ── Basic rules ─────────────────────────────────────────────────────────

export function cloneState(state: State): State {
  return state.map((t) => t.slice());
}

/** Colour and run length of the consecutive same-coloured units on top of a tube. */
export function topRun(tube: Tube): { colour: number; run: number } | null {
  const n = tube.length;
  if (n === 0) return null;
  const colour = tube[n - 1];
  let run = 1;
  while (run < n && tube[n - 1 - run] === colour) run++;
  return { colour, run };
}

/** All units in the tube share one colour (an empty tube is not mono). */
export function isMono(tube: Tube): boolean {
  if (tube.length === 0) return false;
  for (let i = 1; i < tube.length; i++) if (tube[i] !== tube[0]) return false;
  return true;
}

/** Full of a single colour: a finished tube. */
export function isComplete(tube: Tube): boolean {
  return tube.length === CAP && isMono(tube);
}

/**
 * Number of units that would move when pouring `from` into `to`; 0 when the pour is illegal.
 * Legal when: distinct tubes, source non-empty, destination not full and either empty or with a
 * matching top colour. Moves all consecutive top units of that colour that fit.
 */
export function pourAmount(state: State, from: number, to: number): number {
  if (from === to) return 0;
  const src = state[from];
  const dst = state[to];
  if (!src || !dst || src.length === 0 || dst.length >= CAP) return 0;
  const top = topRun(src)!;
  if (dst.length > 0 && dst[dst.length - 1] !== top.colour) return 0;
  return Math.min(top.run, CAP - dst.length);
}

export function canPour(state: State, from: number, to: number): boolean {
  return pourAmount(state, from, to) > 0;
}

/** Returns the new state (structurally shared with the old one) and the units moved, or null if illegal. */
export function applyPour(state: State, from: number, to: number): { state: State; moved: number; colour: number } | null {
  const n = pourAmount(state, from, to);
  if (n === 0) return null;
  const src = state[from];
  const colour = src[src.length - 1];
  const next = state.slice();
  next[from] = src.slice(0, src.length - n);
  const dst = state[to].slice();
  for (let i = 0; i < n; i++) dst.push(colour);
  next[to] = dst;
  return { state: next, moved: n, colour };
}

/** Win: every tube is empty or full of a single colour. */
export function isSolved(state: State): boolean {
  for (const t of state) {
    if (t.length === 0) continue;
    if (!isComplete(t)) return false;
  }
  return true;
}

/**
 * Moves worth considering: legal pours that are not pointless. Skips pouring out of a finished tube,
 * pouring a single-colour tube into an empty tube (same position after relabelling tubes) and all
 * but the first empty destination (empty tubes are interchangeable).
 */
export function listMoves(state: State): Move[] {
  const moves: Move[] = [];
  let firstEmpty = -1;
  for (let i = 0; i < state.length; i++) {
    if (state[i].length === 0) {
      firstEmpty = i;
      break;
    }
  }
  for (let from = 0; from < state.length; from++) {
    const src = state[from];
    if (src.length === 0 || isComplete(src)) continue;
    const top = topRun(src)!;
    const mono = top.run === src.length;
    for (let to = 0; to < state.length; to++) {
      if (to === from) continue;
      const dst = state[to];
      if (dst.length === 0) {
        if (to !== firstEmpty || mono) continue;
        moves.push({ from, to });
      } else if (dst.length < CAP && dst[dst.length - 1] === top.colour) {
        moves.push({ from, to });
      }
    }
  }
  return moves;
}

export function hasMoves(state: State): boolean {
  return listMoves(state).length > 0;
}

// ── Hashing & heuristic ─────────────────────────────────────────────────

const tubeKeyCache = new WeakMap<Tube, string>();

function tubeKey(tube: Tube): string {
  let k = tubeKeyCache.get(tube);
  if (k === undefined) {
    k = '';
    for (let i = 0; i < tube.length; i++) k += String.fromCharCode(65 + tube[i]);
    tubeKeyCache.set(tube, k);
  }
  return k;
}

/** Canonical key: tube order is irrelevant, so tubes are sorted before joining. */
export function stateKey(state: State): string {
  const keys = new Array<string>(state.length);
  for (let i = 0; i < state.length; i++) keys[i] = tubeKey(state[i]);
  keys.sort();
  return keys.join('|');
}

/** Number of maximal same-colour blocks in a tube. */
export function countBlocks(tube: Tube): number {
  if (tube.length === 0) return 0;
  let blocks = 1;
  for (let i = 1; i < tube.length; i++) if (tube[i] !== tube[i - 1]) blocks++;
  return blocks;
}

/**
 * Admissible lower bound on remaining moves: every block that is not the bottom block of its tube
 * must move at least once, and among tubes sharing the same bottom colour all but one must empty
 * that bottom block. Each pour reduces this count by at most one.
 */
export function heuristic(state: State): number {
  let h = 0;
  const bottoms = new Array<number>(MAX_COLOURS).fill(0);
  for (const t of state) {
    if (t.length === 0) continue;
    h += countBlocks(t) - 1;
    bottoms[t[0]]++;
  }
  for (const b of bottoms) if (b > 1) h += b - 1;
  return h;
}

// ── Solver (A* / weighted best-first with canonical closed set) ─────────

interface Node {
  state: State;
  g: number;
  f: number;
  h: number;
  parent: Node | null;
  move: Move | null;
}

class Heap {
  private a: Node[] = [];
  get size(): number {
    return this.a.length;
  }
  private static less(x: Node, y: Node): boolean {
    if (x.f !== y.f) return x.f < y.f;
    return x.h < y.h; // tie-break: deeper (closer to goal) first
  }
  push(n: Node): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!Heap.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): Node | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && Heap.less(a[l], a[m])) m = l;
        if (r < a.length && Heap.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Searches for a solution. With weight 1 this is A* with an admissible heuristic (optimal move count
 * when it finishes). Returns 'unsolvable' only when the whole reachable space was exhausted, and
 * 'limit' when maxNodes expansions were reached first. Deterministic for a given input.
 */
export function solve(start: State, opts: SolveOptions = {}): SolveResult {
  const maxNodes = opts.maxNodes ?? 60000;
  const weight = opts.weight ?? 1;
  if (isSolved(start)) return { status: 'solved', moves: [], nodes: 0 };
  const open = new Heap();
  const best = new Map<string, number>();
  const h0 = heuristic(start);
  open.push({ state: start, g: 0, f: h0 * weight, h: h0, parent: null, move: null });
  best.set(stateKey(start), 0);
  let expanded = 0;
  while (open.size > 0) {
    const node = open.pop()!;
    const nodeKey = stateKey(node.state);
    const known = best.get(nodeKey);
    if (known !== undefined && known < node.g) continue; // stale entry
    if (node.h === 0 && isSolved(node.state)) {
      const moves: Move[] = [];
      for (let n: Node | null = node; n && n.move; n = n.parent) moves.push(n.move);
      moves.reverse();
      return { status: 'solved', moves, nodes: expanded };
    }
    if (expanded >= maxNodes) return { status: 'limit', nodes: expanded };
    expanded++;
    const moves = listMoves(node.state);
    for (const mv of moves) {
      const res = applyPour(node.state, mv.from, mv.to);
      if (!res) continue;
      const g = node.g + 1;
      const key = stateKey(res.state);
      const prev = best.get(key);
      if (prev !== undefined && prev <= g) continue;
      best.set(key, g);
      const h = heuristic(res.state);
      open.push({ state: res.state, g, f: g + h * weight, h, parent: node, move: mv });
    }
  }
  return { status: 'unsolvable', nodes: expanded };
}

/**
 * Two-stage solve used for par and hints: exact A* first, then a greedier search with a bigger cap.
 * Returns the best solution found (or the first definitive answer).
 */
export function solveForPlay(state: State, caps: { exact?: number; greedy?: number } = {}): SolveResult {
  const exact = solve(state, { maxNodes: caps.exact ?? 40000, weight: 1 });
  if (exact.status !== 'limit') return exact;
  const greedy = solve(state, { maxNodes: caps.greedy ?? 120000, weight: 2.5 });
  if (greedy.status === 'limit') return { status: 'limit', nodes: exact.nodes + greedy.nodes };
  return greedy;
}

// ── Generation ──────────────────────────────────────────────────────────

/** Random scramble: `colours` tubes filled with CAP units each, shuffled, plus `empties` empty tubes. */
export function scramble(colours: number, empties: number, rand: () => number): State {
  const units: number[] = [];
  for (let c = 0; c < colours; c++) for (let i = 0; i < CAP; i++) units.push(c);
  shuffle(units, rand);
  const tubes: State = [];
  for (let t = 0; t < colours; t++) tubes.push(units.slice(t * CAP, t * CAP + CAP));
  for (let e = 0; e < empties; e++) tubes.push([]);
  return tubes;
}

/**
 * Reverse walk from the solved state. Each step is the exact inverse of a legal forward pour, so the
 * result is always solvable (undo the walk backwards). Inverse of "pour k units of colour c from A
 * into B": take k units off the top of B and put them on A, where B keeps a c on top (or becomes
 * empty) and A's top is not c (so the forward pour moves exactly k units back).
 */
export function reverseWalk(colours: number, empties: number, steps: number, rand: () => number): State {
  const tubes: State = [];
  for (let c = 0; c < colours; c++) tubes.push(new Array<number>(CAP).fill(c));
  for (let e = 0; e < empties; e++) tubes.push([]);
  let lastFrom = -1;
  let lastTo = -1;
  const countEmpty = () => tubes.reduce((n, t) => n + (t.length === 0 ? 1 : 0), 0);
  // After `steps` keep walking (bounded) until the board again has exactly `empties` empty tubes.
  for (let s = 0; s < steps * 5 && (s < steps || countEmpty() !== empties); s++) {
    const options: { from: number; to: number; n: number }[] = [];
    for (let from = 0; from < tubes.length; from++) {
      const src = tubes[from];
      if (src.length === 0) continue;
      const top = topRun(src)!;
      for (let to = 0; to < tubes.length; to++) {
        if (to === from) continue;
        const dst = tubes[to];
        const space = CAP - dst.length;
        if (space === 0) continue;
        if (dst.length > 0 && dst[dst.length - 1] === top.colour) continue;
        // Avoid immediately undoing the previous step (keeps the walk moving).
        if (from === lastTo && to === lastFrom) continue;
        const maxN = Math.min(space, top.run === src.length ? src.length : top.run - 1);
        if (maxN <= 0) continue;
        const n = 1 + Math.floor(rand() * maxN);
        if (n < top.run || n === src.length) options.push({ from, to, n });
      }
    }
    if (options.length === 0) break;
    const pick = options[Math.floor(rand() * options.length)];
    const colour = tubes[pick.from][tubes[pick.from].length - 1];
    tubes[pick.from].length -= pick.n;
    for (let i = 0; i < pick.n; i++) tubes[pick.to].push(colour);
    lastFrom = pick.from;
    lastTo = pick.to;
  }
  return tubes;
}

/** Minimum par for a scrambled level to count as non-trivial (random boards usually sit near 3x). */
export function minParFor(colours: number): number {
  return colours * 2;
}

function levelSeed(level: number, attempt: number): number {
  return (level * 7919 + attempt * 104729 + 1234567) >>> 0;
}

const MAX_SCRAMBLE_ATTEMPTS = 24;
const WALK_CANDIDATES = 10;

/**
 * Deterministic level generation: scramble from seededRandom(level + offset), verify with the solver,
 * reject trivial or unsolvable boards and retry with the next offset. Boards with a single empty tube
 * are rarely solvable at random, so after MAX_SCRAMBLE_ATTEMPTS the hardest of several reverse walks
 * (guaranteed solvable, verified again by the solver) is used so a level always exists.
 */
export function generateLevel(level: number): Level {
  const lv = Math.max(1, Math.floor(level));
  const colours = colourCountFor(lv);
  const empties = emptyCountFor(lv);
  const minPar = minParFor(colours);
  for (let attempt = 0; attempt < MAX_SCRAMBLE_ATTEMPTS; attempt++) {
    const rand = seededRandom(levelSeed(lv, attempt));
    const tubes = scramble(colours, empties, rand);
    if (tubes.some(isComplete)) continue;
    const res = solveForPlay(tubes);
    if (res.status !== 'solved') continue;
    if (res.moves.length < minPar) continue;
    return { level: lv, colours, empties, tubes, par: res.moves.length, solution: res.moves, attempt, fallback: false };
  }
  let best: Level | null = null;
  for (let attempt = 0; attempt < WALK_CANDIDATES || (!best && attempt < 200); attempt++) {
    const rand = seededRandom(levelSeed(lv, 1000 + attempt));
    const tubes = reverseWalk(colours, empties, colours * 25, rand);
    if (tubes.filter((t) => t.length === 0).length !== empties) continue;
    if (tubes.some(isComplete) && attempt < 100) continue;
    const res = solveForPlay(tubes);
    if (res.status !== 'solved') continue;
    if (!best || res.moves.length > best.par) {
      best = { level: lv, colours, empties, tubes, par: res.moves.length, solution: res.moves, attempt: 1000 + attempt, fallback: true };
    }
  }
  if (best) return best;
  // Unreachable in practice (a reverse walk is always solvable); keep a safe, playable answer anyway.
  const tubes = reverseWalk(colours, empties, colours * 25, seededRandom(levelSeed(lv, 9999)));
  const res = solveForPlay(tubes, { exact: 60000, greedy: 200000 });
  const solution = res.status === 'solved' ? res.moves : [];
  return { level: lv, colours, empties, tubes, par: Math.max(1, solution.length), solution, attempt: 9999, fallback: true };
}

/** Star rating: 3 at or under par, 2 within a small margin, else 1. */
export function starsFor(moves: number, par: number): 1 | 2 | 3 {
  if (moves <= par) return 3;
  if (moves <= par + Math.max(2, Math.ceil(par * 0.25))) return 2;
  return 1;
}

/** A plausible fallback hint when the solver gives up: prefer merging onto a matching colour. */
export function greedyHint(state: State): Move | null {
  const moves = listMoves(state);
  if (moves.length === 0) return null;
  let bestMove: Move | null = null;
  let bestScore = -Infinity;
  for (const mv of moves) {
    const res = applyPour(state, mv.from, mv.to)!;
    let score = -heuristic(res.state) * 4;
    if (isComplete(res.state[mv.to])) score += 6;
    if (state[mv.to].length === 0) score -= 3;
    if (res.state[mv.from].length === 0) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestMove = mv;
    }
  }
  return bestMove;
}
