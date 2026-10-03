/**
 * Pure game logic for Hex Stack (Hextris-style). No DOM access so it can be unit tested.
 *
 * Model: a central hexagon with 6 sides. Each side holds a stack of coloured blocks (bottom → top).
 * Blocks fall inward along 6 fixed *world lanes*; the hexagon (and its stacks) rotate underneath them
 * in 60° steps. `rotation` is the integer number of clockwise steps; world lane `w` currently sits over
 * local side `(w - rotation) mod 6`.
 *
 * Radial positions are measured in *levels* (block thicknesses) from the hexagon surface: level 0 is
 * the block touching the hexagon, level `maxLevels - 1` is the last one inside the boundary ring.
 */

export const SIDES = 6;
export const MIN_GROUP = 3;
/** Seconds between two clears for the combo counter to keep growing. */
export const COMBO_WINDOW = 3;
/** Combo count at which the multiplier stops growing. */
export const MAX_COMBO = 6;
export const MAX_LEVEL = 30;
export const MIN_SPAWN_INTERVAL = 0.5;
export const MAX_SPEED_FACTOR = 2.6;

export type Mode = 'easy' | 'medium' | 'hard';

export interface ModeConfig {
  /** Number of block colours in play. */
  colors: number;
  /** Blocks that fit on one side before it overflows. */
  maxLevels: number;
  /** Levels per second at level 1. */
  baseSpeed: number;
  /** Seconds between spawns at level 1. */
  baseSpawn: number;
  /** Speed multiplier gained per level. */
  speedGrowth: number;
  /** Spawn-rate multiplier gained per level. */
  spawnGrowth: number;
}

export const MODES: Record<Mode, ModeConfig> = {
  easy: { colors: 4, maxLevels: 8, baseSpeed: 1.25, baseSpawn: 2.1, speedGrowth: 0.07, spawnGrowth: 0.05 },
  medium: { colors: 4, maxLevels: 8, baseSpeed: 1.55, baseSpawn: 1.7, speedGrowth: 0.08, spawnGrowth: 0.06 },
  hard: { colors: 5, maxLevels: 8, baseSpeed: 1.9, baseSpawn: 1.35, speedGrowth: 0.09, spawnGrowth: 0.07 },
};
export const MODE_LIST: Mode[] = ['easy', 'medium', 'hard'];

export function isMode(v: unknown): v is Mode {
  return v === 'easy' || v === 'medium' || v === 'hard';
}

/** `stacks[side]` lists colour ids from the hexagon outward. */
export type Stacks = number[][];

export interface Cell {
  side: number;
  level: number;
}

export interface Falling {
  id: number;
  /** World lane (0..5), fixed while falling. */
  lane: number;
  /** Radial position in levels; decreases toward the hexagon. */
  pos: number;
  color: number;
}

export interface Landed {
  side: number;
  level: number;
  color: number;
  lane: number;
}

export interface SimState {
  stacks: Stacks;
  /** Integer number of clockwise 60° steps the hexagon has been turned. */
  rotation: number;
  falling: Falling[];
}

export function emptyStacks(): Stacks {
  return Array.from({ length: SIDES }, () => []);
}

export function createSim(): SimState {
  return { stacks: emptyStacks(), rotation: 0, falling: [] };
}

export function mod6(n: number): number {
  return ((n % SIDES) + SIDES) % SIDES;
}

/** Which local side of the hexagon currently faces world lane `lane`. */
export function localSide(lane: number, rotation: number): number {
  return mod6(lane - rotation);
}

/** Which world lane local side `side` currently faces. */
export function worldLane(side: number, rotation: number): number {
  return mod6(side + rotation);
}

export function cellKey(side: number, level: number): string {
  return side + ':' + level;
}

/** Radial distance (in levels) at which new blocks appear. */
export function spawnDistance(cfg: ModeConfig): number {
  return cfg.maxLevels + 3;
}

/** The four grid neighbours of a cell: same side one level in/out, adjacent sides at the same level. */
export function neighbours(c: Cell): Cell[] {
  return [
    { side: c.side, level: c.level - 1 },
    { side: c.side, level: c.level + 1 },
    { side: mod6(c.side - 1), level: c.level },
    { side: mod6(c.side + 1), level: c.level },
  ];
}

export function colorAt(stacks: Stacks, c: Cell): number | undefined {
  if (c.level < 0) return undefined;
  return stacks[c.side]?.[c.level];
}

/**
 * Flood-fill connected same-colour groups of at least `min` cells. Cells whose key is in `ignore`
 * (e.g. blocks already animating their removal) are treated as empty.
 */
export function findGroups(stacks: Stacks, ignore?: Set<string>, min = MIN_GROUP): Cell[][] {
  const seen = new Set<string>();
  const groups: Cell[][] = [];
  for (let side = 0; side < SIDES; side++) {
    for (let level = 0; level < stacks[side].length; level++) {
      const key = cellKey(side, level);
      if (seen.has(key) || ignore?.has(key)) continue;
      const color = stacks[side][level];
      const group: Cell[] = [];
      const queue: Cell[] = [{ side, level }];
      seen.add(key);
      while (queue.length) {
        const c = queue.pop() as Cell;
        group.push(c);
        for (const n of neighbours(c)) {
          if (n.level < 0 || n.level >= stacks[n.side].length) continue;
          const k = cellKey(n.side, n.level);
          if (seen.has(k) || ignore?.has(k)) continue;
          if (stacks[n.side][n.level] !== color) continue;
          seen.add(k);
          queue.push(n);
        }
      }
      if (group.length >= min) groups.push(group);
    }
  }
  return groups;
}

/** Remove the given cells and let the blocks above them drop down (gravity within each side). */
export function removeCells(stacks: Stacks, cells: Cell[]): Stacks {
  const rm = new Set(cells.map((c) => cellKey(c.side, c.level)));
  return stacks.map((col, side) => col.filter((_, level) => !rm.has(cellKey(side, level))));
}

/** Resolve every clear and chain reaction until the board is stable. */
export function resolveCascade(stacks: Stacks): { stacks: Stacks; clears: Cell[][][] } {
  const clears: Cell[][][] = [];
  let cur = stacks;
  for (let guard = 0; guard < 100; guard++) {
    const groups = findGroups(cur);
    if (!groups.length) break;
    clears.push(groups);
    cur = removeCells(
      cur,
      groups.flatMap((g) => g),
    );
  }
  return { stacks: cur, clears };
}

export function comboMultiplier(combo: number): number {
  const c = Math.min(MAX_COMBO, Math.max(1, Math.floor(combo)));
  return Math.pow(1.5, c - 1);
}

/** Points for clearing a group of `n` blocks as the `combo`-th consecutive clear. */
export function clearScore(n: number, combo: number): number {
  return Math.round(10 * n * n * comboMultiplier(combo));
}

/** Combo counter after a new clear happening `sinceLast` seconds after the previous one. */
export function nextCombo(prev: number, sinceLast: number, window = COMBO_WINDOW): number {
  return sinceLast <= window ? prev + 1 : 1;
}

export function levelFor(elapsedSec: number, score: number): number {
  const e = Math.max(0, elapsedSec);
  const s = Math.max(0, score);
  return Math.min(MAX_LEVEL, 1 + Math.floor(e / 20) + Math.floor(s / 1000));
}

/** Fall speed in levels per second. Non-decreasing in `level`. */
export function fallSpeed(cfg: ModeConfig, level: number): number {
  const l = Math.max(1, level);
  return cfg.baseSpeed * Math.min(MAX_SPEED_FACTOR, 1 + cfg.speedGrowth * (l - 1));
}

/** Seconds between spawns. Non-increasing in `level`, never below MIN_SPAWN_INTERVAL. */
export function spawnInterval(cfg: ModeConfig, level: number): number {
  const l = Math.max(1, level);
  return Math.max(MIN_SPAWN_INTERVAL, cfg.baseSpawn / (1 + cfg.spawnGrowth * (l - 1)));
}

/** Sides whose stack has grown past the boundary. */
export function overflowSides(stacks: Stacks, maxLevels: number): number[] {
  const out: number[] = [];
  stacks.forEach((col, side) => {
    if (col.length > maxLevels) out.push(side);
  });
  return out;
}

export function maxHeight(stacks: Stacks): number {
  return stacks.reduce((m, col) => Math.max(m, col.length), 0);
}

export function blockCount(stacks: Stacks): number {
  return stacks.reduce((n, col) => n + col.length, 0);
}

/**
 * Advance every falling block by `speed * dt` levels. A block lands as soon as it reaches the top of
 * the stack currently under its lane (including when a taller stack is rotated underneath it).
 * Mutates `state`; returns the landings in order.
 */
export function stepFalling(state: SimState, dt: number, speed: number): Landed[] {
  const landed: Landed[] = [];
  const remaining: Falling[] = [];
  // Lower blocks land first so two blocks in one lane stack in the right order.
  const sorted = state.falling.slice().sort((a, b) => a.pos - b.pos);
  for (const f of sorted) {
    f.pos -= speed * dt;
    const side = localSide(f.lane, state.rotation);
    const h = state.stacks[side].length;
    if (f.pos <= h) {
      state.stacks[side].push(f.color);
      landed.push({ side, level: h, color: f.color, lane: f.lane });
    } else {
      remaining.push(f);
    }
  }
  state.falling = remaining;
  return landed;
}

/**
 * Choose a lane for the next block, or -1 when every lane is busy. Lanes whose outermost block is still
 * within `minGap` levels of the spawn point, or that already hold `maxInFlight` blocks, are skipped;
 * the previous lane is avoided when there is any alternative.
 */
export function pickLane(
  falling: { lane: number; pos: number }[],
  spawnDist: number,
  lastLane: number,
  rand: () => number,
  minGap = 1.6,
  maxInFlight = 2,
): number {
  const candidates: number[] = [];
  for (let lane = 0; lane < SIDES; lane++) {
    let count = 0;
    let blocked = false;
    for (const f of falling) {
      if (f.lane !== lane) continue;
      count++;
      if (f.pos > spawnDist - minGap) blocked = true;
    }
    if (!blocked && count < maxInFlight) candidates.push(lane);
  }
  if (!candidates.length) return -1;
  const pool = candidates.length > 1 ? candidates.filter((l) => l !== lastLane) : candidates;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

/**
 * Choose a colour: with probability `bias` one that is currently on top of some stack (keeps the game
 * matchable), otherwise uniform over the palette.
 */
export function pickColor(stacks: Stacks, colors: number, rand: () => number, bias = 0.35): number {
  if (rand() < bias) {
    const tops = stacks.filter((s) => s.length > 0).map((s) => s[s.length - 1]).filter((c) => c < colors);
    if (tops.length) return tops[Math.min(tops.length - 1, Math.floor(rand() * tops.length))];
  }
  return Math.min(colors - 1, Math.floor(rand() * colors));
}

// ── Board geometry ──────────────────────────────────────────────────────

export interface Board {
  cx: number;
  cy: number;
  /** Apothem of the boundary ring (CSS px). */
  R: number;
  /** Apothem of the central hexagon. */
  a0: number;
  /** Radial thickness of one block level. */
  lvl: number;
}

export const COS30 = Math.cos(Math.PI / 6);
export const BOARD_PAD_X = 6;
export const BOARD_PAD_Y = 8;
/** Vertical space kept free at the bottom of the canvas (below any falling block) for the combo readout. */
export const BOARD_BOTTOM_RESERVE = 60;

export function hexApothem(R: number): number {
  return Math.min(44, Math.max(24, R * 0.22));
}

/**
 * Size a pointy-top board for a `w × h` canvas so that a block is *fully* on screen the moment it
 * spawns, in every lane, so no direction gets less warning than another. In portrait the horizontal
 * lanes are the tight ones: the spawn block's outer edge sits at `R + (gap+1)·lvl` from the centre and
 * must stay inside `w/2` (a diagonal lane's outer corner reaches the same x). Vertically the diagonal
 * lanes' outer corner reaches `(R + (gap+1)·lvl) / cos30°` and must fit too.
 */
export function computeBoard(w: number, h: number, cfg: ModeConfig): Board {
  const N = cfg.maxLevels;
  const gap = spawnDistance(cfg) - N;
  const cy = Math.round(h * 0.47);
  const vRoom = Math.min(cy - BOARD_PAD_Y, h - cy - BOARD_PAD_Y - BOARD_BOTTOM_RESERVE);
  let R = 100;
  for (let i = 0; i < 4; i++) {
    const a0 = hexApothem(R);
    const Rh = (w / 2 - BOARD_PAD_X + ((gap + 1) * a0) / N) / (1 + (gap + 1) / N);
    const Rv = (vRoom * COS30 + ((gap + 1) * a0) / N) / (1 + (gap + 1) / N);
    R = Math.max(56, Math.min(Rh, Rv));
  }
  const a0 = hexApothem(R);
  return { cx: w / 2, cy, R, a0, lvl: (R - a0) / N };
}
