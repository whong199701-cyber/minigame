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
import { seededRandom } from '../../app/canvas';
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
  /** True when the puzzle came from the pre-computed bank, false when generated on the fly. */
  fromBank: boolean;
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
 * Explores the whole connected component of `start` and labels every state with its distance to
 * the nearest solved state. Returns null when the component exceeds `cap` states or contains no
 * solved state.
 */
export function exploreDistances(vehicles: Vehicle[], start: number[], cap = STATE_CAP): Map<number, number> | null {
  const n = vehicles.length;
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
    if (pos[RED] === GOAL_POS) goals.push(key);
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
      const mul = POW[id];
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
  /** Maximum number of hill-climbing iterations. */
  iterations: number;
  /** Optional wall-clock budget (ms); makes the search non-deterministic across machines. */
  timeMs?: number;
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
  const deadline = opts.timeMs ? Date.now() + opts.timeMs : Infinity;
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
    if (Date.now() > deadline) break;
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
 * short). Used offline to build the bank, and online as a fallback beyond it.
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

/**
 * On-the-fly generation (fallback for levels beyond the bank). Deterministic for (difficulty,
 * level). First tries random layouts, taking the farthest state whose distance lies in the par
 * range; if none fits after a handful of attempts, hill-climbs toward the range. Never throws:
 * when everything falls short it returns the best effort found, so the game always has a level.
 */
export function generateOnline(difficulty: Difficulty, level: number): Puzzle {
  const spec = SPECS[difficulty];
  const base = hashSeed(difficulty, level);
  const target = targetPar(difficulty, level);
  type Candidate = { vehicles: Vehicle[]; start: number[]; par: number };
  let fallback: Candidate | null = null;
  const attempts = difficulty === 'easy' || difficulty === 'medium' ? 24 : 6;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const seed = (base + Math.imul(attempt + 1, 0x9e3779b9)) >>> 0;
    const rand = seededRandom(seed);
    const count = spec.minVehicles + Math.floor(rand() * (spec.maxVehicles - spec.minVehicles + 1));
    const ev = evaluateLayout(randomLayout(rand, count, spec.truckRatio));
    if (!ev || ev.vehicles.length - 1 < spec.minVehicles) continue;
    if (ev.maxDist < spec.minPar) {
      if (!fallback || ev.maxDist > fallback.par) fallback = { vehicles: ev.vehicles, start: ev.far, par: ev.maxDist };
      continue;
    }
    const par = Math.min(ev.maxDist, Math.max(spec.minPar, Math.min(spec.maxPar, target)));
    const start = pickStateAt(ev, par, rand) ?? ev.far;
    return { difficulty, level, vehicles: ev.vehicles, start, par: ev.distances.get(encodeState(start)) ?? par, fromBank: false };
  }
  // Bounded hill-climb so a phone never stalls for long; the result may fall short of the range.
  const searched = searchPuzzle(base ^ 0x5bd1e995, spec, target, { iterations: 120, timeMs: 1500 });
  if (searched && (!fallback || searched.par >= fallback.par)) fallback = searched;
  if (fallback) return { difficulty, level, vehicles: fallback.vehicles, start: fallback.start, par: fallback.par, fromBank: false };
  // Practically unreachable: a sparse random layout is always solvable. Keep the game alive anyway.
  const vehicles: Vehicle[] = [
    { id: 0, horiz: true, len: 2, lane: EXIT_ROW },
    { id: 1, horiz: false, len: 3, lane: 3 },
    { id: 2, horiz: false, len: 2, lane: 5 },
  ];
  const start = [0, 0, 1];
  return { difficulty, level, vehicles, start, par: solve(vehicles, start)?.par ?? 2, fromBank: false };
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
 * Level `level` (1-based) of a difficulty: the pre-computed bank entry when there is one (built
 * offline by `searchPuzzle` from seed hashSeed(difficulty, level)), else generated on the fly.
 */
export function getPuzzle(difficulty: Difficulty, level: number): Puzzle {
  const bank = BANK[difficulty];
  const code = bank[level - 1];
  if (code) {
    try {
      const { vehicles, start, par } = decodePuzzle(code);
      return { difficulty, level, vehicles, start, par, fromBank: true };
    } catch {
      /* corrupt entry: fall through to online generation */
    }
  }
  return generateOnline(difficulty, level);
}

// ── Scoring ──────────────────────────────────────────────────────────────

/** Star rating: 3 for optimal, 2 within par + 3, else 1. */
export function stars(moves: number, par: number): 1 | 2 | 3 {
  if (moves <= par) return 3;
  if (moves <= par + 3) return 2;
  return 1;
}

