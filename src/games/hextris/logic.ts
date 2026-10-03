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

/** Extra spawn weight per block on the stack a lane faces (see pickLane). */
export const TALL_WEIGHT = 0.5;

/**
 * Choose a lane for the next block, or -1 when every lane is busy. Lanes whose outermost block is still
 * within `minGap` levels of the spawn point, or that already hold `maxInFlight` blocks, are skipped.
 * Free lanes are weighted by `1 + TALL_WEIGHT × height` of the stack they currently face
 * (`heights[lane]`), so blocks drift toward tall stacks: a player who never steers them away overflows
 * much sooner, while an evenly spread board (which tends to clear itself) is not handed out for free.
 */
export function pickLane(
  falling: { lane: number; pos: number }[],
  spawnDist: number,
  heights: number[],
  rand: () => number,
  minGap = 1.6,
  maxInFlight = 2,
): number {
  const candidates: number[] = [];
  const weights: number[] = [];
  let total = 0;
  for (let lane = 0; lane < SIDES; lane++) {
    let count = 0;
    let blocked = false;
    for (const f of falling) {
      if (f.lane !== lane) continue;
      count++;
      if (f.pos > spawnDist - minGap) blocked = true;
    }
    if (blocked || count >= maxInFlight) continue;
    const w = 1 + TALL_WEIGHT * Math.max(0, heights[lane] ?? 0);
    candidates.push(lane);
    weights.push(w);
    total += w;
  }
  if (!candidates.length) return -1;
  let x = rand() * total;
  for (let i = 0; i < candidates.length; i++) {
    x -= weights[i];
    if (x < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** Height of the stack each world lane currently faces. */
export function laneHeights(sim: SimState): number[] {
  return Array.from({ length: SIDES }, (_, lane) => sim.stacks[localSide(lane, sim.rotation)].length);
}

/** Default probability that a new block copies a top-of-stack colour (see pickColor). */
export const COLOR_BIAS = 0.3;

/**
 * Choose a colour: with probability `bias` one that is currently on top of some stack (keeps the game
 * matchable), otherwise uniform over the palette. `avoidSide` (the side the spawn lane faces right now)
 * is left out of the biased choice, so the helpful colour usually has to be *steered* to its match:
 * a player who never rotates gets no free matches from the bias.
 */
export function pickColor(stacks: Stacks, colors: number, rand: () => number, bias = COLOR_BIAS, avoidSide = -1): number {
  if (rand() < bias) {
    const tops: number[] = [];
    stacks.forEach((s, side) => {
      if (side !== avoidSide && s.length > 0 && s[s.length - 1] < colors) tops.push(s[s.length - 1]);
    });
    if (tops.length) return tops[Math.min(tops.length - 1, Math.floor(rand() * tops.length))];
  }
  return Math.min(colors - 1, Math.floor(rand() * colors));
}

// ── Game core: spawning, landing, clearing, cascades and overflow ──────────
// Everything the UI needs to run a round, as plain data, so it can be unit tested and simulated
// headlessly. The UI only turns the returned events into sounds, particles and text.

/** Seconds a cleared group flashes before it is removed. */
export const CLEAR_DUR = 0.32;
/** Delay before the first block of a round appears. */
export const FIRST_SPAWN = 0.4;
/** Retry delay when every lane is busy. */
export const SPAWN_RETRY = 0.12;

export interface ClearCell extends Cell {
  color: number;
}

export interface ClearGroup {
  cells: ClearCell[];
  points: number;
  /** Combo count this group was scored with. */
  combo: number;
}

export interface Core {
  cfg: ModeConfig;
  sim: SimState;
  /** Seconds of play (excludes pauses). */
  elapsed: number;
  level: number;
  score: number;
  combo: number;
  /** `elapsed` at the latest clear. */
  lastClearAt: number;
  spawnT: number;
  nextId: number;
  /**
   * Cells flashing before removal. While a clear runs, stacks only grow on top (landings push), so the
   * stored (side, level) keys stay valid until the clear finishes.
   */
  clearing: { cells: Map<string, ClearCell>; t: number } | null;
  /** Sides that overflowed; set once the round is lost (the core then ignores further input). */
  over: number[] | null;
}

export interface CoreEvents {
  landed: Landed[];
  /** Groups that started clearing (already scored). */
  cleared: ClearGroup[];
  /** Cells removed when a clear animation finished. */
  removed: ClearCell[];
  levelUp: boolean;
  /** Overflowing sides, on the step the round is lost. */
  over: number[] | null;
}

export function emptyEvents(): CoreEvents {
  return { landed: [], cleared: [], removed: [], levelUp: false, over: null };
}

export function createCore(cfg: ModeConfig): Core {
  return {
    cfg,
    sim: createSim(),
    elapsed: 0,
    level: 1,
    score: 0,
    combo: 0,
    lastClearAt: -999,
    spawnT: FIRST_SPAWN,
    nextId: 1,
    clearing: null,
    over: null,
  };
}

function checkOverflow(core: Core, ev: CoreEvents): void {
  const sides = overflowSides(core.sim.stacks, core.cfg.maxLevels);
  if (sides.length) {
    core.over = sides;
    ev.over = sides;
  }
}

function startClear(core: Core, groups: Cell[][], ev: CoreEvents): void {
  core.combo = nextCombo(core.combo, core.elapsed - core.lastClearAt);
  core.lastClearAt = core.elapsed;
  if (!core.clearing) core.clearing = { cells: new Map(), t: 0 };
  for (const g of groups) {
    const cells: ClearCell[] = g.map((c) => ({ side: c.side, level: c.level, color: core.sim.stacks[c.side][c.level] }));
    for (const c of cells) core.clearing.cells.set(cellKey(c.side, c.level), c);
    const points = clearScore(g.length, core.combo);
    core.score += points;
    ev.cleared.push({ cells, points, combo: core.combo });
  }
}

/**
 * React to blocks that just landed: start clearing any new group (cells already clearing count as
 * empty), otherwise check for overflow. Overflow is only judged on a settled board: while a clear is
 * running it waits for the clear (and any cascade) to finish, since those may lower the stack.
 */
function afterLanding(core: Core, landed: Landed[], ev: CoreEvents): void {
  if (!landed.length) return;
  ev.landed.push(...landed);
  const ignore = core.clearing ? new Set(core.clearing.cells.keys()) : undefined;
  const groups = findGroups(core.sim.stacks, ignore);
  if (groups.length) startClear(core, groups, ev);
  else if (!core.clearing) checkOverflow(core, ev);
}

/** Remove the flashed cells, apply gravity, then chain into the next clear or judge overflow. */
function finishClear(core: Core, ev: CoreEvents): void {
  if (!core.clearing) return;
  const cells = [...core.clearing.cells.values()];
  core.sim.stacks = removeCells(core.sim.stacks, cells);
  core.clearing = null;
  ev.removed.push(...cells);
  const groups = findGroups(core.sim.stacks);
  if (groups.length) startClear(core, groups, ev);
  else checkOverflow(core, ev);
}

/** Spawn one block in a free lane. Returns false when every lane is busy. */
export function coreSpawn(core: Core, rand: () => number): boolean {
  const dist = spawnDistance(core.cfg);
  const lane = pickLane(core.sim.falling, dist, laneHeights(core.sim), rand);
  if (lane < 0) return false;
  const color = pickColor(core.sim.stacks, core.cfg.colors, rand, COLOR_BIAS, localSide(lane, core.sim.rotation));
  core.sim.falling.push({ id: core.nextId++, lane, pos: dist, color });
  return true;
}

/** Advance a running round by `dt` seconds. */
export function coreTick(core: Core, dt: number, rand: () => number): CoreEvents {
  const ev = emptyEvents();
  if (core.over) return ev;
  core.elapsed += dt;
  const nl = levelFor(core.elapsed, core.score);
  if (nl !== core.level) {
    core.level = nl;
    ev.levelUp = true;
  }
  core.spawnT -= dt;
  if (core.spawnT <= 0) core.spawnT = coreSpawn(core, rand) ? core.spawnT + spawnInterval(core.cfg, core.level) : SPAWN_RETRY;
  afterLanding(core, stepFalling(core.sim, dt, fallSpeed(core.cfg, core.level)), ev);
  if (core.clearing && !core.over) {
    core.clearing.t += dt;
    if (core.clearing.t >= CLEAR_DUR) finishClear(core, ev);
  }
  return ev;
}

/**
 * Turn the hexagon by `steps` (negative = counter-clockwise), one 60° step at a time. After each step a
 * falling block that now faces a taller stack lands on it immediately.
 */
export function coreRotate(core: Core, steps: number): CoreEvents {
  const ev = emptyEvents();
  const dir = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps) && !core.over; i++) {
    core.sim.rotation += dir;
    afterLanding(core, stepFalling(core.sim, 0, 0), ev);
  }
  return ev;
}

// ── Touch gestures ───────────────────────────────────────────────────────
// A touch is undecided until it either moves far enough sideways to be a swipe or is released (a
// tap). Nothing rotates before that decision, so a swipe that starts on the "wrong" half never turns
// the hexagon the wrong way first (which could land a block on the wrong side).

/** Horizontal drag (CSS px) that turns a touch into a swipe, and the extra drag per further step. */
export const SWIPE_START = 22;
export const SWIPE_STEP = 64;
/** A touch that wandered further than this vertically is not a tap. */
export const TAP_MAX_DY = 48;

export interface Gesture {
  x0: number;
  y0: number;
  /** -1 when the touch started on the left half (counter-clockwise), +1 on the right half. */
  tapDir: number;
  swiping: boolean;
  /** Net steps this swipe has already applied. */
  applied: number;
  maxDy: number;
}

export function gestureStart(x: number, y: number, width: number): Gesture {
  return { x0: x, y0: y, tapDir: x < width / 2 ? -1 : 1, swiping: false, applied: 0, maxDy: 0 };
}

/** Rotation steps to apply now that the pointer moved to (x, y). */
export function gestureMove(g: Gesture, x: number, y: number): number {
  const dx = x - g.x0;
  const adx = Math.abs(dx);
  g.maxDy = Math.max(g.maxDy, Math.abs(y - g.y0));
  if (!g.swiping && adx < SWIPE_START) return 0;
  g.swiping = true;
  const target = adx < SWIPE_START ? 0 : Math.sign(dx) * (1 + Math.floor((adx - SWIPE_START) / SWIPE_STEP));
  const delta = target - g.applied;
  g.applied = target;
  return delta;
}

/** Rotation steps to apply when the pointer is released at (x, y): a tap turns toward the touched half. */
export function gestureEnd(g: Gesture, x: number, y: number): number {
  const delta = gestureMove(g, x, y);
  if (g.swiping) return delta;
  return g.maxDy <= TAP_MAX_DY ? g.tapDir : 0;
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
