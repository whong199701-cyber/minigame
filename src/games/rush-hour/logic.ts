/**
 * Pure logic for Parking Escape (Rush Hour): board model, move rules, BFS solver and the
 * seeded level generator. No DOM access so it can be unit tested.
 *
 * Board: 6×6 cells. Vehicle 0 is always the red car (horizontal on EXIT_ROW); it escapes through
 * the gap in the right wall once it reaches column SIZE - len.
 *
 * A state is the array of positions (one number per vehicle: column for horizontal vehicles, row
 * for vertical ones). A state is encoded as a base-6 integer, which fits in a double for up to
 * 20 vehicles. One move = sliding one vehicle any distance along its axis through free cells.
 */
import { seededRandom } from '../../app/canvas';

export const SIZE = 6;
export const EXIT_ROW = 2;
export const RED = 0;

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

export interface Puzzle {
  difficulty: Difficulty;
  level: number;
  seed: number;
  vehicles: Vehicle[];
  /** Initial positions (parallel to `vehicles`). */
  start: number[];
  /** Optimal number of moves. */
  par: number;
  /** One optimal solution from `start`. */
  solution: Move[];
  /** Distance to the nearest solved state for every reachable state (key = encodeState). */
  distances: Map<number, number>;
}

export interface DifficultySpec {
  minPar: number;
  maxPar: number;
  minVehicles: number;
  maxVehicles: number;
  truckRatio: number;
}

export const SPECS: Record<Difficulty, DifficultySpec> = {
  easy: { minPar: 5, maxPar: 10, minVehicles: 8, maxVehicles: 10, truckRatio: 0.3 },
  medium: { minPar: 11, maxPar: 18, minVehicles: 9, maxVehicles: 11, truckRatio: 0.35 },
  hard: { minPar: 19, maxPar: 30, minVehicles: 10, maxVehicles: 13, truckRatio: 0.4 },
  expert: { minPar: 31, maxPar: 60, minVehicles: 11, maxVehicles: 13, truckRatio: 0.4 },
};

/** Safety cap on the number of states explored for one candidate layout. */
const STATE_CAP = 90000;

// ── State encoding ───────────────────────────────────────────────────────

export function encodeState(positions: number[]): number {
  let key = 0;
  let mul = 1;
  for (let i = 0; i < positions.length; i++) {
    key += positions[i] * mul;
    mul *= SIZE;
  }
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
      const base = v.lane * SIZE;
      for (let k = 0; k < v.len; k++) grid[base + p + k] = i + 1;
    } else {
      for (let k = 0; k < v.len; k++) grid[(p + k) * SIZE + v.lane] = i + 1;
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
  const seen = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const p = positions[i];
    if (p < 0 || p + v.len > SIZE || v.lane < 0 || v.lane >= SIZE) return true;
    for (const [r, c] of cellsOf(v, p)) {
      const idx = r * SIZE + c;
      if (seen[idx]) return true;
      seen[idx] = 1;
    }
  }
  return false;
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

export function isSolved(vehicles: Vehicle[], positions: number[]): boolean {
  return positions[RED] === SIZE - vehicles[RED].len;
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

// ── Solver ───────────────────────────────────────────────────────────────

export interface Solution {
  par: number;
  moves: Move[];
}

/** Plain BFS from `start`; returns the optimal move list or null when unsolvable. */
export function solve(vehicles: Vehicle[], start: number[], cap = 400000): Solution | null {
  const n = vehicles.length;
  const goalPos = SIZE - vehicles[RED].len;
  const startKey = encodeState(start);
  if (start[RED] === goalPos) return { par: 0, moves: [] };
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
      for (let to = min; to <= max; to++) {
        if (to === from) continue;
        const nk = key + (to - from) * SIZE ** id;
        if (parent.has(nk)) continue;
        parent.set(nk, key);
        via.set(nk, { id, from, to });
        if (id === RED && to === goalPos) {
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
 * Explores the whole connected component of `start` and labels every state with its distance to
 * the nearest solved state. Returns null when the component exceeds `cap` states or contains no
 * solved state.
 */
export function exploreDistances(vehicles: Vehicle[], start: number[], cap = STATE_CAP): Map<number, number> | null {
  const n = vehicles.length;
  const goalPos = SIZE - vehicles[RED].len;
  const visited = new Set<number>();
  const goals: number[] = [];
  const startKey = encodeState(start);
  visited.add(startKey);
  const queue: number[] = [startKey];
  const pos = new Array<number>(n);
  const grid = new Uint8Array(SIZE * SIZE);
  let head = 0;
  while (head < queue.length) {
    const key = queue[head++];
    decodeState(key, n, pos);
    if (pos[RED] === goalPos) goals.push(key);
    fillGrid(vehicles, pos, grid);
    for (let id = 0; id < n; id++) {
      const { min, max } = slideRange(vehicles, pos, id, grid);
      const from = pos[id];
      const mul = SIZE ** id;
      for (let to = min; to <= max; to++) {
        if (to === from) continue;
        const nk = key + (to - from) * mul;
        if (visited.has(nk)) continue;
        visited.add(nk);
        queue.push(nk);
        if (visited.size > cap) return null;
      }
    }
  }
  if (goals.length === 0) return null;
  // Multi-source BFS from every solved state (moves are reversible, so the graph is undirected).
  const dist = new Map<number, number>();
  const q2: number[] = [];
  for (const g of goals) {
    dist.set(g, 0);
    q2.push(g);
  }
  head = 0;
  while (head < q2.length) {
    const key = q2[head++];
    const d = dist.get(key)! + 1;
    decodeState(key, n, pos);
    fillGrid(vehicles, pos, grid);
    for (let id = 0; id < n; id++) {
      const { min, max } = slideRange(vehicles, pos, id, grid);
      const from = pos[id];
      const mul = SIZE ** id;
      for (let to = min; to <= max; to++) {
        if (to === from) continue;
        const nk = key + (to - from) * mul;
        if (dist.has(nk)) continue;
        dist.set(nk, d);
        q2.push(nk);
      }
    }
  }
  return dist;
}

/** Given a distance map, returns a move from `positions` that reduces the distance by one (or null). */
export function bestMove(vehicles: Vehicle[], positions: number[], distances: Map<number, number>): Move | null {
  const key = encodeState(positions);
  const d = distances.get(key);
  if (d === undefined || d === 0) return null;
  for (const m of legalMoves(vehicles, positions)) {
    const nk = key + (m.to - m.from) * SIZE ** m.id;
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

/** Random layout with the red car on EXIT_ROW and `count` other vehicles. */
export function randomLayout(rand: () => number, count: number, truckRatio: number): { vehicles: Vehicle[]; positions: number[] } {
  const vehicles: Vehicle[] = [{ id: RED, horiz: true, len: 2, lane: EXIT_ROW }];
  const positions: number[] = [Math.floor(rand() * 4)];
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

/**
 * Deterministically generates level `level` of a difficulty. Explores a random layout's state
 * space, labels every state with its distance to the exit and picks a start state whose optimal
 * solution length lies in the difficulty's par range. Retries with the next seed offset until it
 * succeeds (always terminates in practice; a few attempts on average).
 */
export function generatePuzzle(difficulty: Difficulty, level: number): Puzzle {
  const spec = SPECS[difficulty];
  const base = hashSeed(difficulty, level);
  for (let attempt = 0; attempt < 2000; attempt++) {
    const seed = (base + Math.imul(attempt + 1, 0x9e3779b9)) >>> 0;
    const rand = seededRandom(seed);
    const count = spec.minVehicles + Math.floor(rand() * (spec.maxVehicles - spec.minVehicles + 1));
    const { vehicles, positions } = randomLayout(rand, count, spec.truckRatio);
    if (vehicles.length < spec.minVehicles + 1) continue;
    const distances = exploreDistances(vehicles, positions);
    if (!distances) continue;
    // Bucket reachable states by distance within the allowed range.
    const buckets = new Map<number, number[]>();
    for (const [key, d] of distances) {
      if (d < spec.minPar || d > spec.maxPar) continue;
      let b = buckets.get(d);
      if (!b) buckets.set(d, (b = []));
      b.push(key);
    }
    if (buckets.size === 0) continue;
    const available = [...buckets.keys()].sort((a, b) => a - b);
    const target = spec.minPar + Math.floor(rand() * (Math.min(spec.maxPar, available[available.length - 1]) - spec.minPar + 1));
    let par = available[0];
    for (const d of available) if (Math.abs(d - target) < Math.abs(par - target) || (Math.abs(d - target) === Math.abs(par - target) && d > par)) par = d;
    const bucket = buckets.get(par)!;
    const startKey = bucket[Math.floor(rand() * bucket.length)];
    const start = decodeState(startKey, vehicles.length);
    const solution = pathFromDistances(vehicles, start, distances);
    if (solution.length !== par) continue; // should never happen; be safe
    return { difficulty, level, seed, vehicles, start, par, solution, distances };
  }
  throw new Error('rush-hour: could not generate a puzzle');
}

// ── Local search (used offline to build the level bank; deterministic for a seed) ───────

export interface Layout {
  vehicles: Vehicle[];
  positions: number[];
}

export interface Evaluated extends Layout {
  /** Farthest reachable distance from the exit inside the component. */
  maxDist: number;
  distances: Map<number, number>;
}

function cloneLayout(l: Layout): Layout {
  return { vehicles: l.vehicles.map((v) => ({ ...v })), positions: l.positions.slice() };
}

function renumber(l: Layout): Layout {
  l.vehicles.forEach((v, i) => (v.id = i));
  return l;
}

/** Applies one random mutation; returns null when the result overlaps or breaks the rules. */
export function mutateLayout(src: Layout, rand: () => number, minVehicles: number, maxVehicles: number, truckRatio: number): Layout | null {
  const l = cloneLayout(src);
  const others = l.vehicles.length - 1;
  const r = rand();
  if (r < 0.1) {
    // Shift the red car.
    l.positions[RED] = Math.floor(rand() * 4);
  } else if (r < 0.45 && others > 0) {
    // Slide one vehicle to another position in its lane.
    const i = 1 + Math.floor(rand() * others);
    l.positions[i] = Math.floor(rand() * (SIZE - l.vehicles[i].len + 1));
  } else if (r < 0.75 && others > 0) {
    // Re-place one vehicle anywhere.
    const i = 1 + Math.floor(rand() * others);
    const horiz = rand() < 0.5;
    const lane = Math.floor(rand() * SIZE);
    if (horiz && lane === EXIT_ROW) return null;
    const len: 2 | 3 = rand() < truckRatio ? 3 : 2;
    l.vehicles[i] = { id: i, horiz, len, lane };
    l.positions[i] = Math.floor(rand() * (SIZE - len + 1));
  } else if (r < 0.9 && others < maxVehicles) {
    // Add a vehicle.
    const horiz = rand() < 0.5;
    const lane = Math.floor(rand() * SIZE);
    if (horiz && lane === EXIT_ROW) return null;
    const len: 2 | 3 = rand() < truckRatio ? 3 : 2;
    l.vehicles.push({ id: l.vehicles.length, horiz, len, lane });
    l.positions.push(Math.floor(rand() * (SIZE - len + 1)));
  } else if (others > minVehicles) {
    // Remove a vehicle.
    const i = 1 + Math.floor(rand() * others);
    l.vehicles.splice(i, 1);
    l.positions.splice(i, 1);
    renumber(l);
  } else {
    return null;
  }
  return hasOverlap(l.vehicles, l.positions) ? null : l;
}

export function evaluateLayout(l: Layout, cap = STATE_CAP): Evaluated | null {
  const distances = exploreDistances(l.vehicles, l.positions, cap);
  if (!distances) return null;
  let maxDist = 0;
  for (const d of distances.values()) if (d > maxDist) maxDist = d;
  return { ...l, maxDist, distances };
}

/**
 * Hill-climbs a random layout for `iterations` mutations (accepting equal-or-better farthest
 * distances) and returns the best layout found, or null if nothing solvable was found.
 */
export function searchLayout(rand: () => number, spec: DifficultySpec, iterations: number, cap = STATE_CAP): Evaluated | null {
  let cur: Evaluated | null = null;
  for (let i = 0; i < 20 && !cur; i++) {
    const count = spec.minVehicles + Math.floor(rand() * (spec.maxVehicles - spec.minVehicles + 1));
    cur = evaluateLayout(randomLayout(rand, count, spec.truckRatio), cap);
  }
  if (!cur) return null;
  let best = cur;
  for (let i = 0; i < iterations; i++) {
    if (best.maxDist >= spec.minPar) break;
    const cand = mutateLayout(cur, rand, spec.minVehicles, spec.maxVehicles, spec.truckRatio);
    if (!cand) continue;
    const ev = evaluateLayout(cand, cap);
    if (!ev) continue;
    if (ev.maxDist >= cur.maxDist) cur = ev;
    if (cur.maxDist > best.maxDist) best = cur;
  }
  return best;
}

/** Picks a start state in `ev`'s component whose distance is `par` (prefers the farthest ≤ maxPar). */
export function pickStart(ev: Evaluated, rand: () => number, minPar: number, maxPar: number): { start: number[]; par: number } | null {
  const buckets = new Map<number, number[]>();
  for (const [key, d] of ev.distances) {
    if (d < minPar || d > maxPar) continue;
    let b = buckets.get(d);
    if (!b) buckets.set(d, (b = []));
    b.push(key);
  }
  if (buckets.size === 0) return null;
  const par = Math.max(...buckets.keys());
  const bucket = buckets.get(par)!;
  const key = bucket[Math.floor(rand() * bucket.length)];
  return { start: decodeState(key, ev.vehicles.length), par };
}

// ── Compact puzzle strings (level bank) ─────────────────────────────────

/** "par:h220v301..." — 4 chars per vehicle: orientation, length, lane, position. */
export function encodePuzzle(vehicles: Vehicle[], positions: number[], par: number): string {
  return par + ':' + vehicles.map((v, i) => `${v.horiz ? 'h' : 'v'}${v.len}${v.lane}${positions[i]}`).join('');
}

export function decodePuzzle(code: string): { vehicles: Vehicle[]; start: number[]; par: number } {
  const [parStr, body] = code.split(':');
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
  if (!Number.isFinite(par) || vehicles.length === 0 || hasOverlap(vehicles, start)) throw new Error('rush-hour: bad puzzle code ' + code);
  return { vehicles, start, par };
}

/** Star rating: 3 for optimal, 2 within par + 3, else 1. */
export function stars(moves: number, par: number): 1 | 2 | 3 {
  if (moves <= par) return 3;
  if (moves <= par + 3) return 2;
  return 1;
}

/** Vehicle occupying the given cell in `positions`, or -1. */
export function vehicleAt(vehicles: Vehicle[], positions: number[], row: number, col: number): number {
  if (row < 0 || col < 0 || row >= SIZE || col >= SIZE) return -1;
  const g = fillGrid(vehicles, positions);
  return g[row * SIZE + col] - 1;
}
