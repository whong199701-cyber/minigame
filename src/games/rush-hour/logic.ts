/**
 * Pure logic for Parking Escape (Rush Hour): board model, move rules, BFS solver, distance map,
 * seeded level generation and the compact level-bank codec. No DOM access so it can be unit tested.
 *
 * Board: 6×6 cells. Vehicle 0 is always the red car (horizontal, length 2, on EXIT_ROW); it escapes
 * through the gap in the right wall once it reaches column SIZE - 2.
 *
 * A state is the array of positions (one number per vehicle: the column for horizontal vehicles,
 * the row for vertical ones). A state is encoded as a base-6 integer, which fits exactly in a
 * double for up to 20 vehicles. One move = sliding one vehicle any distance along its axis
 * through free cells.
 */
import { seededRandom, shuffle } from '../../app/canvas';
import { BANK } from './levels';

export const SIZE = 6;
export const EXIT_ROW = 2;
export const RED = 0;
export const RED_LEN = 2;
/** Column the red car must reach to be solved. */
export const GOAL_POS = SIZE - RED_LEN;

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

export interface Vehicle {
  /** Index in the vehicle list; 0 is the red car. */
  id: number;
  horiz: boolean;
  len: 2 | 3;
  /** Fixed coordinate: the row for horizontal vehicles, the column for vertical ones. */
  lane: number;
}

export interface Move {
  id: number;
  from: number;
  to: number;
}

export interface Layout {
  vehicles: Vehicle[];
  positions: number[];
}

export interface Puzzle {
  difficulty: Difficulty;
  level: number;
  vehicles: Vehicle[];
  /** Initial positions (parallel to `vehicles`). */
  start: number[];
  /** Optimal number of moves (verified by BFS). */
  par: number;
  /** True when the puzzle came from the pre-computed bank, false for a remix beyond it. */
  fromBank: boolean;
  /** Colour rotation for the UI palette (0 for bank levels, 1..12 for remixes). */
  tint: number;
}

export interface DifficultySpec {
  minPar: number;
  maxPar: number;
  /** Number of vehicles besides the red car. */
  minVehicles: number;
  maxVehicles: number;
  truckRatio: number;
}

export const SPECS: Record<Difficulty, DifficultySpec> = {
  easy: { minPar: 5, maxPar: 10, minVehicles: 8, maxVehicles: 10, truckRatio: 0.3 },
  medium: { minPar: 11, maxPar: 18, minVehicles: 8, maxVehicles: 11, truckRatio: 0.35 },
  hard: { minPar: 19, maxPar: 30, minVehicles: 9, maxVehicles: 13, truckRatio: 0.4 },
  expert: { minPar: 31, maxPar: 80, minVehicles: 10, maxVehicles: 13, truckRatio: 0.45 },
};

/** Safety cap on the number of states explored for one candidate layout. */
export const STATE_CAP = 90000;

/** Powers of SIZE used by the state encoding (index = vehicle id). */
const POW: number[] = [];
for (let i = 0, m = 1; i < 21; i++, m *= SIZE) POW.push(m);

// ── State encoding ───────────────────────────────────────────────────────

export function encodeState(positions: number[]): number {
  let key = 0;
  for (let i = 0; i < positions.length; i++) key += positions[i] * POW[i];
  return key;
}

export function decodeState(key: number, count: number, out: number[] = new Array<number>(count)): number[] {
  let k = key;
  for (let i = 0; i < count; i++) {
    const d = k % SIZE;
    out[i] = d;
    k = (k - d) / SIZE;
  }
  return out;
}

// ── Grid helpers ─────────────────────────────────────────────────────────

/** Fills `grid` (36 cells, row-major) with vehicle id + 1, or 0 for free cells. */
export function fillGrid(vehicles: Vehicle[], positions: number[], grid: Uint8Array = new Uint8Array(SIZE * SIZE)): Uint8Array {
  grid.fill(0);
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const p = positions[i];
    if (v.horiz) {
      const base = v.lane * SIZE + p;
      for (let k = 0; k < v.len; k++) grid[base + k] = i + 1;
    } else {
      const base = p * SIZE + v.lane;
      for (let k = 0; k < v.len; k++) grid[base + k * SIZE] = i + 1;
    }
  }
  return grid;
}

/** Cells (row, col) covered by a vehicle at position `pos`. */
export function cellsOf(v: Vehicle, pos: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let k = 0; k < v.len; k++) cells.push(v.horiz ? [v.lane, pos + k] : [pos + k, v.lane]);
  return cells;
}

/** True if any two vehicles overlap or any vehicle leaves the board. */
export function hasOverlap(vehicles: Vehicle[], positions: number[]): boolean {
  if (vehicles.length !== positions.length) return true;
  const seen = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const p = positions[i];
    if (!Number.isInteger(p) || p < 0 || p + v.len > SIZE || v.lane < 0 || v.lane >= SIZE) return true;
    for (const [r, c] of cellsOf(v, p)) {
      const idx = r * SIZE + c;
      if (seen[idx]) return true;
      seen[idx] = 1;
    }
  }
  return false;
}

/** Structural validity of a vehicle list: red car first, horizontal, length 2, on the exit row. */
export function isValidLayout(vehicles: Vehicle[], positions: number[]): boolean {
  if (vehicles.length === 0) return false;
  const red = vehicles[RED];
  if (!red.horiz || red.len !== RED_LEN || red.lane !== EXIT_ROW) return false;
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (v.id !== i || (v.len !== 2 && v.len !== 3)) return false;
  }
  return !hasOverlap(vehicles, positions);
}

/**
 * Range of positions vehicle `id` can slide to (inclusive) without moving anything else.
 * `grid` may be passed to avoid recomputation.
 */
export function slideRange(vehicles: Vehicle[], positions: number[], id: number, grid?: Uint8Array): { min: number; max: number } {
  const g = grid ?? fillGrid(vehicles, positions);
  const v = vehicles[id];
  const p = positions[id];
  const step = v.horiz ? 1 : SIZE;
  const origin = v.horiz ? v.lane * SIZE : v.lane;
  let min = p;
  while (min > 0 && g[origin + (min - 1) * step] === 0) min--;
  let max = p;
  while (max + v.len < SIZE && g[origin + (max + v.len) * step] === 0) max++;
  return { min, max };
}

/** True if vehicle `id` can legally slide to `to` in one move. */
export function canMove(vehicles: Vehicle[], positions: number[], id: number, to: number): boolean {
  if (id < 0 || id >= vehicles.length) return false;
  if (!Number.isInteger(to)) return false;
  if (to === positions[id]) return false;
  const { min, max } = slideRange(vehicles, positions, id);
  return to >= min && to <= max;
}

/** Returns the new positions after a move (does not validate). */
export function applyMove(positions: number[], move: Move): number[] {
  const next = positions.slice();
  next[move.id] = move.to;
  return next;
}

export function isSolved(positions: number[]): boolean {
  return positions[RED] === GOAL_POS;
}

/** All legal moves from a state (each distinct destination is one move). */
export function legalMoves(vehicles: Vehicle[], positions: number[], grid?: Uint8Array): Move[] {
  const g = grid ?? fillGrid(vehicles, positions);
  const moves: Move[] = [];
  for (let id = 0; id < vehicles.length; id++) {
    const { min, max } = slideRange(vehicles, positions, id, g);
    const from = positions[id];
    for (let to = min; to <= max; to++) if (to !== from) moves.push({ id, from, to });
  }
  return moves;
}

/** Vehicle occupying the given cell in `positions`, or -1. */
export function vehicleAt(vehicles: Vehicle[], positions: number[], row: number, col: number): number {
  if (row < 0 || col < 0 || row >= SIZE || col >= SIZE) return -1;
  const g = fillGrid(vehicles, positions);
  return g[row * SIZE + col] - 1;
}

// ── Solver ───────────────────────────────────────────────────────────────

export interface Solution {
  par: number;
  moves: Move[];
}

/** Plain BFS from `start`; returns an optimal move list or null when unsolvable / over the cap. */
export function solve(vehicles: Vehicle[], start: number[], cap = 400000): Solution | null {
  const n = vehicles.length;
  const startKey = encodeState(start);
  if (start[RED] === GOAL_POS) return { par: 0, moves: [] };
  const parent = new Map<number, number>(); // key -> parent key
  const via = new Map<number, Move>(); // key -> move that reached it
  parent.set(startKey, -1);
  const queue: number[] = [startKey];
  const pos = new Array<number>(n);
  const grid = new Uint8Array(SIZE * SIZE);
  let head = 0;
  while (head < queue.length) {
    const key = queue[head++];
    decodeState(key, n, pos);
    fillGrid(vehicles, pos, grid);
    for (let id = 0; id < n; id++) {
      const { min, max } = slideRange(vehicles, pos, id, grid);
      const from = pos[id];
      const mul = POW[id];
      for (let to = min; to <= max; to++) {
        if (to === from) continue;
        const nk = key + (to - from) * mul;
        if (parent.has(nk)) continue;
        parent.set(nk, key);
        via.set(nk, { id, from, to });
        if (id === RED && to === GOAL_POS) {
          const moves: Move[] = [];
          let cur = nk;
          while (cur !== startKey) {
            moves.push(via.get(cur)!);
            cur = parent.get(cur)!;
          }
          moves.reverse();
          return { par: moves.length, moves };
        }
        queue.push(nk);
      }
    }
    if (parent.size > cap) return null;
  }
  return null;
}

/**
 * Explores the whole connected component of a start state and labels every state with its
 * distance to the nearest solved state. The work can be done in slices (`step(budget)`) so the UI
 * can spread it over several frames; the result is identical however it is sliced.
 *
 * Stage 1 is a forward BFS that collects the component and its solved states; stage 2 is a
 * multi-source BFS from every solved state (moves are reversible, so the graph is undirected).
 * The result is null when the component exceeds `cap` states or contains no solved state.
 */
export class DistanceExplorer {
  private readonly vehicles: Vehicle[];
  private readonly cap: number;
  private readonly pos: number[];
  private readonly grid = new Uint8Array(SIZE * SIZE);
  private visited: Set<number> | null = new Set<number>();
  private goals: number[] = [];
  private queue: number[];
  private head = 0;
  private dist: Map<number, number> | null = null;
  private stage: 'forward' | 'backward' | 'done' = 'forward';
  private out: Map<number, number> | null = null;
  /** Number of states expanded so far (both stages). */
  expanded = 0;

  constructor(vehicles: Vehicle[], start: number[], cap = STATE_CAP) {
    this.vehicles = vehicles;
    this.cap = cap;
    this.pos = new Array<number>(vehicles.length);
    const key = encodeState(start);
    this.visited!.add(key);
    this.queue = [key];
  }

  get done(): boolean {
    return this.stage === 'done';
  }

  /** The distance map once `done` (null when unsolvable or over the cap). */
  get result(): Map<number, number> | null {
    return this.out;
  }

  /** Expands up to `budget` states; returns true once the exploration is complete. */
  step(budget = Infinity): boolean {
    let left = budget;
    while (left > 0 && this.stage !== 'done') {
      left = this.stage === 'forward' ? this.forward(left) : this.backward(left);
    }
    return this.stage === 'done';
  }

  /** Runs to completion and returns the result. */
  run(): Map<number, number> | null {
    this.step();
    return this.out;
  }

  private finish(result: Map<number, number> | null): void {
    this.stage = 'done';
    this.out = result;
    this.visited = null;
    this.dist = null;
    this.queue = [];
    this.goals = [];
  }

  private forward(budget: number): number {
    const { vehicles, pos, grid, queue, cap } = this;
    const visited = this.visited!;
    const n = vehicles.length;
    let left = budget;
    while (left > 0 && this.head < queue.length) {
      left--;
      this.expanded++;
      const key = queue[this.head++];
      decodeState(key, n, pos);
      if (pos[RED] === GOAL_POS) this.goals.push(key);
      fillGrid(vehicles, pos, grid);
      for (let id = 0; id < n; id++) {
        const { min, max } = slideRange(vehicles, pos, id, grid);
        const from = pos[id];
        const mul = POW[id];
        for (let to = min; to <= max; to++) {
          if (to === from) continue;
          const nk = key + (to - from) * mul;
          if (visited.has(nk)) continue;
          visited.add(nk);
          queue.push(nk);
          if (visited.size > cap) {
            this.finish(null);
            return left;
          }
        }
      }
    }
    if (this.head >= queue.length) {
      if (this.goals.length === 0) {
        this.finish(null);
        return left;
      }
      const dist = new Map<number, number>();
      for (const g of this.goals) dist.set(g, 0);
      this.dist = dist;
      this.queue = this.goals;
      this.goals = [];
      this.head = 0;
      this.visited = null;
      this.stage = 'backward';
    }
    return left;
  }

  private backward(budget: number): number {
    const { vehicles, pos, grid, queue } = this;
    const dist = this.dist!;
    const n = vehicles.length;
    let left = budget;
    while (left > 0 && this.head < queue.length) {
      left--;
      this.expanded++;
      const key = queue[this.head++];
      const d = dist.get(key)! + 1;
      decodeState(key, n, pos);
      fillGrid(vehicles, pos, grid);
      for (let id = 0; id < n; id++) {
        const { min, max } = slideRange(vehicles, pos, id, grid);
        const from = pos[id];
        const mul = POW[id];
        for (let to = min; to <= max; to++) {
          if (to === from) continue;
          const nk = key + (to - from) * mul;
          if (dist.has(nk)) continue;
          dist.set(nk, d);
          queue.push(nk);
        }
      }
    }
    if (this.head >= queue.length) this.finish(dist);
    return left;
  }
}

/** Synchronous `DistanceExplorer` run (see there). */
export function exploreDistances(vehicles: Vehicle[], start: number[], cap = STATE_CAP): Map<number, number> | null {
  return new DistanceExplorer(vehicles, start, cap).run();
}

/** Given a distance map, returns a move from `positions` that reduces the distance by one (or null). */
export function bestMove(vehicles: Vehicle[], positions: number[], distances: Map<number, number>): Move | null {
  const key = encodeState(positions);
  const d = distances.get(key);
  if (d === undefined || d === 0) return null;
  for (const m of legalMoves(vehicles, positions)) {
    const nk = key + (m.to - m.from) * POW[m.id];
    if (distances.get(nk) === d - 1) return m;
  }
  return null;
}

/** Follows the distance map greedily to build an optimal solution from `positions`. */
export function pathFromDistances(vehicles: Vehicle[], positions: number[], distances: Map<number, number>): Move[] {
  const moves: Move[] = [];
  let cur = positions.slice();
  for (let guard = 0; guard < 500; guard++) {
    const m = bestMove(vehicles, cur, distances);
    if (!m) break;
    moves.push(m);
    cur = applyMove(cur, m);
  }
  return moves;
}

/**
 * Optimal next move from `positions`, using the distance map when it covers the state and a fresh
 * BFS otherwise. Returns null when already solved or unsolvable.
 */
export function nextMove(vehicles: Vehicle[], positions: number[], distances?: Map<number, number> | null): Move | null {
  if (isSolved(positions)) return null;
  if (distances) {
    const m = bestMove(vehicles, positions, distances);
    if (m) return m;
  }
  const s = solve(vehicles, positions);
  return s && s.moves.length ? s.moves[0] : null;
}

// ── Generation ───────────────────────────────────────────────────────────

/** FNV-1a hash of "difficulty:level" → 32-bit seed. */
export function hashSeed(difficulty: string, level: number): number {
  const s = `${difficulty}:${level}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Random layout with the red car on EXIT_ROW (never at the exit) and up to `count` other vehicles. */
export function randomLayout(rand: () => number, count: number, truckRatio: number): Layout {
  const vehicles: Vehicle[] = [{ id: RED, horiz: true, len: RED_LEN, lane: EXIT_ROW }];
  const positions: number[] = [Math.floor(rand() * GOAL_POS)];
  const grid = fillGrid(vehicles, positions);
  let tries = 0;
  while (vehicles.length < count + 1 && tries < 300) {
    tries++;
    const horiz = rand() < 0.5;
    const len: 2 | 3 = rand() < truckRatio ? 3 : 2;
    const lane = Math.floor(rand() * SIZE);
    if (horiz && lane === EXIT_ROW) continue; // never clutter the red row
    const pos = Math.floor(rand() * (SIZE - len + 1));
    let free = true;
    for (let k = 0; k < len; k++) {
      const idx = horiz ? lane * SIZE + pos + k : (pos + k) * SIZE + lane;
      if (grid[idx]) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    const v: Vehicle = { id: vehicles.length, horiz, len, lane };
    vehicles.push(v);
    positions.push(pos);
    for (let k = 0; k < len; k++) grid[horiz ? lane * SIZE + pos + k : (pos + k) * SIZE + lane] = v.id + 1;
  }
  return { vehicles, positions };
}

export interface Evaluated {
  vehicles: Vehicle[];
  /** The state of the component that is farthest from any solved state. */
  far: number[];
  maxDist: number;
  distances: Map<number, number>;
}

/** Explores a layout's component and finds its farthest state. Null when unsolvable or too big. */
export function evaluateLayout(l: Layout, cap = STATE_CAP): Evaluated | null {
  const distances = exploreDistances(l.vehicles, l.positions, cap);
  if (!distances) return null;
  let maxDist = -1;
  let farKey = -1;
  for (const [k, d] of distances) {
    if (d > maxDist) {
      maxDist = d;
      farKey = k;
    }
  }
  if (farKey < 0) return null;
  return { vehicles: l.vehicles, far: decodeState(farKey, l.vehicles.length), maxDist, distances };
}

/** Picks a random state of the component at exactly distance `d` (null if none). */
export function pickStateAt(ev: Evaluated, d: number, rand: () => number): number[] | null {
  const keys: number[] = [];
  for (const [k, dist] of ev.distances) if (dist === d) keys.push(k);
  if (keys.length === 0) return null;
  return decodeState(keys[Math.floor(rand() * keys.length)], ev.vehicles.length);
}

/** Cells (grid indices) swept by the optimal path from the farthest state, including rest cells. */
function pathCells(ev: Evaluated): number[] {
  const moves = pathFromDistances(ev.vehicles, ev.far, ev.distances);
  const cells = new Set<number>();
  for (const m of moves) {
    const v = ev.vehicles[m.id];
    const lo = Math.min(m.from, m.to);
    const hi = Math.max(m.from, m.to) + v.len - 1;
    for (let p = lo; p <= hi; p++) cells.add(v.horiz ? v.lane * SIZE + p : p * SIZE + v.lane);
  }
  return [...cells];
}

export interface SearchOptions {
  /** Maximum number of hill-climbing iterations (the only budget, so results never depend on CPU speed). */
  iterations: number;
  cap?: number;
}

/**
 * Deterministic hill-climb that grows a sparse random layout into a hard puzzle: vehicles are
 * added (preferably onto the current optimal path) whenever that does not shorten the farthest
 * distance; when nothing can be added the layout is perturbed. Stops once the component's
 * farthest state is at least `target` moves away and the vehicle count fits the spec. Returns the
 * best layout seen (may fall short of the target when the budget runs out) or null.
 */
export function searchLayout(rand: () => number, spec: DifficultySpec, target: number, opts: SearchOptions): Evaluated | null {
  const cap = opts.cap ?? STATE_CAP;
  let ev: Evaluated | null = null;
  for (let i = 0; i < 40 && !ev; i++) {
    ev = evaluateLayout(randomLayout(rand, 4 + Math.floor(rand() * 3), spec.truckRatio), cap);
  }
  if (!ev) return null;
  const fits = (e: Evaluated) => e.vehicles.length - 1 >= spec.minVehicles && e.vehicles.length - 1 <= spec.maxVehicles;
  const score = (e: Evaluated) => e.maxDist + (fits(e) ? 0.5 : 0);
  let best = ev;
  for (let it = 0; it < opts.iterations; it++) {
    if (ev.maxDist >= target && fits(ev)) break;
    const others = ev.vehicles.length - 1;
    let accepted = false;
    if (others < spec.maxVehicles) {
      const grid = fillGrid(ev.vehicles, ev.far);
      const hint = pathCells(ev).filter((c) => grid[c] === 0);
      for (let t = 0; t < 12 && !accepted; t++) {
        const useHint = hint.length > 0 && rand() < 0.7;
        const cell = useHint ? hint[Math.floor(rand() * hint.length)] : Math.floor(rand() * SIZE * SIZE);
        if (grid[cell]) continue;
        const row = Math.floor(cell / SIZE);
        const col = cell % SIZE;
        const horiz = rand() < 0.5;
        const len: 2 | 3 = rand() < spec.truckRatio ? 3 : 2;
        const lane = horiz ? row : col;
        if (horiz && lane === EXIT_ROW) continue;
        const along = horiz ? col : row;
        const pos = Math.max(0, Math.min(SIZE - len, along - Math.floor(rand() * len)));
        const vehicles = [...ev.vehicles, { id: ev.vehicles.length, horiz, len, lane }];
        const positions = [...ev.far, pos];
        if (hasOverlap(vehicles, positions)) continue;
        const nev = evaluateLayout({ vehicles, positions }, cap);
        if (nev && nev.maxDist >= ev.maxDist) {
          ev = nev;
          accepted = true;
        }
      }
    }
    if (!accepted) {
      // Perturb: remove a random vehicle, or slide one to another spot in its lane.
      const n = ev.vehicles.length - 1;
      if (n > 2 && (rand() < 0.5 || n >= spec.maxVehicles)) {
        const i = 1 + Math.floor(rand() * n);
        const vehicles = ev.vehicles.filter((_, k) => k !== i).map((v, k) => ({ ...v, id: k }));
        const positions = ev.far.filter((_, k) => k !== i);
        const nev = evaluateLayout({ vehicles, positions }, cap);
        if (nev) ev = nev;
      } else if (n > 0) {
        const i = 1 + Math.floor(rand() * n);
        const positions = ev.far.slice();
        positions[i] = Math.floor(rand() * (SIZE - ev.vehicles[i].len + 1));
        if (!hasOverlap(ev.vehicles, positions)) {
          const nev = evaluateLayout({ vehicles: ev.vehicles, positions }, cap);
          if (nev) ev = nev;
        }
      }
    }
    if (score(ev) > score(best)) best = ev;
  }
  return best;
}

/**
 * Builds one puzzle from a seeded search: runs `searchLayout` toward `target` and picks a start
 * state exactly `target` moves from the exit (or the farthest reachable one when the search fell
 * short). Used offline to build the level bank.
 */
export function searchPuzzle(seed: number, spec: DifficultySpec, target: number, opts: SearchOptions): { vehicles: Vehicle[]; start: number[]; par: number } | null {
  const rand = seededRandom(seed);
  const ev = searchLayout(rand, spec, target, opts);
  if (!ev) return null;
  const par = Math.min(target, ev.maxDist);
  const start = pickStateAt(ev, par, rand) ?? ev.far;
  return { vehicles: ev.vehicles, start, par: ev.distances.get(encodeState(start)) ?? par };
}

/** Target par for level `level` of a difficulty: climbs through the par range over the first 40 levels. */
export function targetPar(difficulty: Difficulty, level: number): number {
  const spec = SPECS[difficulty];
  const top = difficulty === 'expert' ? 36 : spec.maxPar;
  const steps = 40;
  const k = Math.min(steps, Math.max(1, level)) - 1;
  return spec.minPar + Math.round(((top - spec.minPar) * k) / (steps - 1));
}

// ── Compact puzzle strings (level bank) ─────────────────────────────────

/** "par:h220v301..." — 4 chars per vehicle: orientation, length, lane, position. */
export function encodePuzzle(vehicles: Vehicle[], positions: number[], par: number): string {
  return par + ':' + vehicles.map((v, i) => `${v.horiz ? 'h' : 'v'}${v.len}${v.lane}${positions[i]}`).join('');
}

export function decodePuzzle(code: string): { vehicles: Vehicle[]; start: number[]; par: number } {
  const [parStr, body = ''] = code.split(':');
  const par = Number(parStr);
  const vehicles: Vehicle[] = [];
  const start: number[] = [];
  for (let i = 0; i + 4 <= body.length; i += 4) {
    const horiz = body[i] === 'h';
    const len = Number(body[i + 1]) as 2 | 3;
    const lane = Number(body[i + 2]);
    const pos = Number(body[i + 3]);
    vehicles.push({ id: vehicles.length, horiz, len, lane });
    start.push(pos);
  }
  if (!Number.isInteger(par) || par < 0 || body.length % 4 !== 0 || !isValidLayout(vehicles, start)) {
    throw new Error('rush-hour: bad puzzle code ' + code);
  }
  return { vehicles, start, par };
}

/** Number of pre-computed levels for a difficulty. */
export function bankSize(difficulty: Difficulty): number {
  return BANK[difficulty].length;
}

/**
 * Colour-blind description of a board: two boards that look the same apart from vehicle colours
 * (i.e. vehicle order) give the same string.
 */
export function boardSignature(vehicles: Vehicle[], positions: number[]): string {
  const parts = vehicles.map((v, i) => `${v.horiz ? 'h' : 'v'}${v.len}${v.lane}${positions[i]}`);
  return parts[0] + '|' + parts.slice(1).sort().join('');
}

interface BankEntry {
  level: number;
  vehicles: Vehicle[];
  start: number[];
  par: number;
}
interface BankData {
  entries: BankEntry[];
  /** Board signatures of every bank start. */
  signatures: Set<string>;
  /** One representative entry per distinct lot (same vehicles in the same lanes), in level order. */
  lots: BankEntry[];
  /** Remix order of `lots` for each round (cached). */
  rounds: number[][];
}
const bankCache = new Map<Difficulty, BankData>();

/** Decoded, in-spec bank entries of a difficulty with derived lookup data. */
function bankData(difficulty: Difficulty): BankData {
  let data = bankCache.get(difficulty);
  if (!data) {
    const spec = SPECS[difficulty];
    const entries: BankEntry[] = [];
    BANK[difficulty].forEach((code, i) => {
      try {
        const p = decodePuzzle(code);
        const others = p.vehicles.length - 1;
        if (p.par < spec.minPar || p.par > spec.maxPar || others < spec.minVehicles || others > spec.maxVehicles) return;
        entries.push({ level: i + 1, ...p });
      } catch {
        /* corrupt entry: skip */
      }
    });
    const lots: BankEntry[] = [];
    const lotKeys = new Set<string>();
    for (const e of entries) {
      const key = lotSignature(e.vehicles);
      if (lotKeys.has(key)) continue;
      lotKeys.add(key);
      lots.push(e);
    }
    data = { entries, signatures: new Set(entries.map((e) => boardSignature(e.vehicles, e.start))), lots, rounds: [] };
    bankCache.set(difficulty, data);
  }
  return data;
}

/** Signature of a lot: which vehicles sit in which lanes, ignoring positions and order. */
function lotSignature(vehicles: Vehicle[]): string {
  return vehicles
    .slice(1)
    .map((v) => `${v.horiz ? 'h' : 'v'}${v.len}${v.lane}`)
    .sort()
    .join('');
}

/** The pre-computed level, or null when `level` is beyond the bank (or the entry is unusable). */
export function bankPuzzle(difficulty: Difficulty, level: number): Puzzle | null {
  const e = bankData(difficulty).entries.find((x) => x.level === level);
  return e ? { difficulty, level, vehicles: e.vehicles, start: e.start.slice(), par: e.par, fromBank: true, tint: 0 } : null;
}

/**
 * Levels beyond the bank are "remixes": a bank lot (each distinct lot is used once per round, in a
 * seeded order) with a new start state taken from the lot's state space at a distance inside the
 * difficulty's par range, never a board that already is a bank level or an earlier round of the
 * same lot, plus a colour rotation. Deterministic for (difficulty, level), independent of timing,
 * always in range, and it costs one component exploration (≤ STATE_CAP states) that the UI runs in
 * time slices and then reuses as the hint map.
 */
export interface RemixPlan {
  difficulty: Difficulty;
  level: number;
  /** Bank level whose lot is reused. */
  baseLevel: number;
  vehicles: Vehicle[];
  /** The bank start state (exploration starts here). */
  baseStart: number[];
  basePar: number;
  /** Levels of the same lot in earlier rounds (oldest first), whose boards must not repeat. */
  earlier: number[];
}

function roundOrder(difficulty: Difficulty, data: BankData, round: number): number[] {
  let order = data.rounds[round];
  if (!order) {
    order = shuffle(
      data.lots.map((_, i) => i),
      seededRandom(hashSeed(difficulty + '/round', round)),
    );
    data.rounds[round] = order;
  }
  return order;
}

export function remixPlan(difficulty: Difficulty, level: number): RemixPlan {
  const data = bankData(difficulty);
  const m = data.lots.length;
  if (m === 0) throw new Error('rush-hour: empty level bank for ' + difficulty);
  const first = bankSize(difficulty) + 1;
  const j = Math.max(0, Math.floor(level) - first);
  const round = Math.floor(j / m);
  const lot = roundOrder(difficulty, data, round)[j % m];
  const earlier: number[] = [];
  for (let r = 0; r < round; r++) earlier.push(first + r * m + roundOrder(difficulty, data, r).indexOf(lot));
  const base = data.lots[lot];
  return { difficulty, level, baseLevel: base.level, vehicles: base.vehicles, baseStart: base.start.slice(), basePar: base.par, earlier };
}

/**
 * Chooses the remix start state from the explored distance map of the plan's lot: a seeded distance
 * inside the par range (preferring at least the base level's par) and, at that distance, the state
 * that differs most from the bank start among boards not used yet. (A lot with almost no in-range
 * boards may fall back to its bank start in later rounds; the result is still in range.)
 */
export function finishRemix(plan: RemixPlan, distances: Map<number, number> | null): Puzzle {
  const { difficulty, level, vehicles, baseStart, basePar } = plan;
  const tint = 1 + (hashSeed(difficulty + '/tint', level) % 12);
  const fallback: Puzzle = { difficulty, level, vehicles, start: baseStart.slice(), par: basePar, fromBank: false, tint };
  if (!distances) return fallback;
  const spec = SPECS[difficulty];
  const n = vehicles.length;
  const byDist = new Map<number, number[]>();
  for (const [key, d] of distances) {
    if (d < spec.minPar || d > spec.maxPar) continue;
    const list = byDist.get(d);
    if (list) list.push(key);
    else byDist.set(d, [key]);
  }
  const all = [...byDist.keys()].sort((a, b) => a - b);
  const used = new Set(bankData(difficulty).signatures);
  const pick = (lv: number): { start: number[]; par: number } | null => {
    const rand = seededRandom(hashSeed(difficulty, lv));
    const order = [...shuffle(all.filter((d) => d >= basePar), rand), ...shuffle(all.filter((d) => d < basePar), rand)];
    for (const d of order) {
      const ranked = byDist.get(d)!.map((key) => {
        const p = decodeState(key, n);
        let moved = 0;
        for (let i = 0; i < n; i++) if (p[i] !== baseStart[i]) moved++;
        return { p, moved, tie: rand() };
      });
      ranked.sort((a, b) => b.moved - a.moved || a.tie - b.tie);
      for (const c of ranked) {
        const sig = boardSignature(vehicles, c.p);
        if (!used.has(sig)) {
          used.add(sig);
          return { start: c.p, par: d };
        }
      }
    }
    return null;
  };
  for (const lv of plan.earlier) pick(lv);
  const chosen = pick(level);
  return chosen ? { ...fallback, start: chosen.start, par: chosen.par } : fallback;
}

/** Synchronous remix (plan + exploration + pick). */
export function remixPuzzle(difficulty: Difficulty, level: number): Puzzle {
  const plan = remixPlan(difficulty, level);
  return finishRemix(plan, exploreDistances(plan.vehicles, plan.baseStart));
}

/**
 * Level `level` (1-based) of a difficulty: the pre-computed bank entry when there is one (built
 * offline by `searchPuzzle` from seed hashSeed(difficulty, level)), else a deterministic remix.
 */
export function getPuzzle(difficulty: Difficulty, level: number): Puzzle {
  return bankPuzzle(difficulty, level) ?? remixPuzzle(difficulty, level);
}

// ── Scoring ──────────────────────────────────────────────────────────────

/** Star rating: 3 for optimal, 2 within par + 3, else 1. A solve that used hints earns at most 2. */
export function stars(moves: number, par: number, hinted = false): 1 | 2 | 3 {
  const s = moves <= par ? 3 : moves <= par + 3 ? 2 : 1;
  return hinted && s === 3 ? 2 : s;
}

