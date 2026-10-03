import { describe, expect, it } from 'vitest';
import {
  BOARD_BOTTOM_RESERVE,
  BOARD_PAD_X,
  BOARD_PAD_Y,
  COLOR_BIAS,
  COMBO_WINDOW,
  COS30,
  MAX_COMBO,
  MAX_LEVEL,
  MIN_SPAWN_INTERVAL,
  MODES,
  MODE_LIST,
  SIDES,
  blockCount,
  cellKey,
  clearScore,
  colorAt,
  comboMultiplier,
  computeBoard,
  coreRotate,
  coreTick,
  createCore,
  createSim,
  emptyEvents,
  emptyStacks,
  FIRST_SPAWN,
  fallSpeed,
  findGroups,
  gestureEnd,
  gestureMove,
  gestureStart,
  hexApothem,
  isMode,
  laneHeights,
  levelFor,
  localSide,
  maxHeight,
  mod6,
  neighbours,
  nextCombo,
  overflowSides,
  pickColor,
  pickLane,
  removeCells,
  resolveCascade,
  spawnDistance,
  spawnInterval,
  stepFalling,
  SWIPE_START,
  SWIPE_STEP,
  TALL_WEIGHT,
  TAP_MAX_DY,
  worldLane,
  type Cell,
  type ClearCell,
  type Core,
  type CoreEvents,
  type Mode,
  type Stacks,
} from './logic';
import { seededRandom } from '../../app/canvas';
import { strings } from './strings';

/** Deterministic "random" source that replays a list of values. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function stacksFrom(cols: number[][]): Stacks {
  const s = emptyStacks();
  cols.forEach((c, i) => (s[i] = c.slice()));
  return s;
}

function sortCells(cells: Cell[]): Cell[] {
  return cells.slice().sort((a, b) => a.side - b.side || a.level - b.level);
}

describe('lane / side mapping', () => {
  it('mod6 wraps negatives', () => {
    expect(mod6(-1)).toBe(5);
    expect(mod6(6)).toBe(0);
    expect(mod6(-7)).toBe(5);
    expect(mod6(13)).toBe(1);
  });
  it('localSide and worldLane are inverses for every rotation', () => {
    for (let rot = -12; rot <= 12; rot++) {
      for (let lane = 0; lane < SIDES; lane++) {
        const side = localSide(lane, rot);
        expect(side).toBeGreaterThanOrEqual(0);
        expect(side).toBeLessThan(SIDES);
        expect(worldLane(side, rot)).toBe(lane);
      }
    }
  });
  it('one clockwise step moves side 0 under lane 1', () => {
    expect(worldLane(0, 1)).toBe(1);
    expect(localSide(0, 1)).toBe(5);
  });
});

describe('neighbours', () => {
  it('wraps side 5 ↔ 0 and stays on the same level across sides', () => {
    const n = neighbours({ side: 0, level: 2 }).map((c) => cellKey(c.side, c.level));
    expect(n).toContain('0:1');
    expect(n).toContain('0:3');
    expect(n).toContain('5:2');
    expect(n).toContain('1:2');
    expect(n).toHaveLength(4);
    const m = neighbours({ side: 5, level: 0 }).map((c) => cellKey(c.side, c.level));
    expect(m).toContain('0:0');
    expect(m).toContain('4:0');
  });
  it('colorAt returns undefined outside the stacks', () => {
    const s = stacksFrom([[1, 2]]);
    expect(colorAt(s, { side: 0, level: 1 })).toBe(2);
    expect(colorAt(s, { side: 0, level: 2 })).toBeUndefined();
    expect(colorAt(s, { side: 0, level: -1 })).toBeUndefined();
    expect(colorAt(s, { side: 3, level: 0 })).toBeUndefined();
  });
});

describe('findGroups', () => {
  it('finds a vertical run of three on one side', () => {
    const groups = findGroups(stacksFrom([[1, 1, 1]]));
    expect(groups).toHaveLength(1);
    expect(sortCells(groups[0])).toEqual([
      { side: 0, level: 0 },
      { side: 0, level: 1 },
      { side: 0, level: 2 },
    ]);
  });
  it('finds a horizontal run across the 5↔0 wrap at the same level', () => {
    const s = stacksFrom([[2], [], [], [], [2], [2]]);
    const groups = findGroups(s);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
  it('does not connect different levels on neighbouring sides', () => {
    const s = stacksFrom([[0, 3], [3], [0, 3]]);
    // side0 level1 = 3, side1 level0 = 3, side2 level1 = 3 → not connected (diagonals don't count)
    expect(findGroups(s)).toHaveLength(0);
  });
  it('ignores pairs and mixed colours', () => {
    expect(findGroups(stacksFrom([[1, 1], [1]]))).toHaveLength(1); // 0:0,0:1,1:0 → connected 3
    expect(findGroups(stacksFrom([[1, 1], [], [1]]))).toHaveLength(0);
    expect(findGroups(stacksFrom([[1, 2, 1]]))).toHaveLength(0);
  });
  it('finds L and T shapes across sides and levels', () => {
    const s = stacksFrom([[0, 4, 4], [4, 4], [0, 4]]);
    const groups = findGroups(s);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(5);
  });
  it('returns several disjoint groups and respects min size', () => {
    const s = stacksFrom([[1, 1, 1], [], [], [2, 2, 2, 2]]);
    const groups = findGroups(s);
    expect(groups.map((g) => g.length).sort()).toEqual([3, 4]);
    expect(findGroups(s, undefined, 4)).toHaveLength(1);
  });
  it('treats ignored cells as empty', () => {
    const s = stacksFrom([[1, 1, 1]]);
    expect(findGroups(s, new Set([cellKey(0, 1)]))).toHaveLength(0);
  });
});

describe('removeCells / gravity', () => {
  it('drops blocks above a removed cell', () => {
    const s = stacksFrom([[1, 2, 3, 4]]);
    const out = removeCells(s, [{ side: 0, level: 1 }]);
    expect(out[0]).toEqual([1, 3, 4]);
    expect(s[0]).toEqual([1, 2, 3, 4]); // input untouched
  });
  it('removes cells on several sides and keeps six sides', () => {
    const s = stacksFrom([[1, 1, 1], [5], [], [], [], [7, 1]]);
    const out = removeCells(s, [
      { side: 0, level: 0 },
      { side: 0, level: 2 },
      { side: 5, level: 1 },
    ]);
    expect(out).toHaveLength(SIDES);
    expect(out[0]).toEqual([1]);
    expect(out[1]).toEqual([5]);
    expect(out[5]).toEqual([7]);
    expect(blockCount(out)).toBe(3);
  });
});

describe('resolveCascade', () => {
  it('clears a chain: removing the bottom run drops a second run into place', () => {
    // side0: [1,1,1,2]  side1: [3,2]  side2: [2] → after clearing the 1s, side0 = [2] joins 1:1? no: 1:1 is level 1.
    // Build: side0 = [1,1,1,2], side1 = [2], side2 = [2] → after clear side0=[2] at level 0, neighbours 1:0 and 5:0.
    const s = stacksFrom([[1, 1, 1, 2], [2], [], [], [], [2]]);
    const res = resolveCascade(s);
    expect(res.clears).toHaveLength(2);
    expect(res.clears[0][0]).toHaveLength(3);
    expect(res.clears[1][0]).toHaveLength(3);
    expect(blockCount(res.stacks)).toBe(0);
  });
  it('is a no-op on a stable board', () => {
    const s = stacksFrom([[1, 2], [2, 1], [3]]);
    const res = resolveCascade(s);
    expect(res.clears).toHaveLength(0);
    expect(res.stacks).toEqual(s);
  });
});

describe('scoring and combos', () => {
  it('scores 10 × n² for a group', () => {
    expect(clearScore(3, 1)).toBe(90);
    expect(clearScore(4, 1)).toBe(160);
    expect(clearScore(5, 1)).toBe(250);
  });
  it('multiplies by 1.5 per consecutive clear, capped', () => {
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(2)).toBeCloseTo(1.5);
    expect(clearScore(3, 2)).toBe(135);
    expect(clearScore(3, 3)).toBe(Math.round(90 * 2.25));
    expect(comboMultiplier(MAX_COMBO)).toBeCloseTo(comboMultiplier(MAX_COMBO + 5));
    expect(comboMultiplier(0)).toBe(1);
  });
  it('nextCombo continues inside the window and resets outside', () => {
    expect(nextCombo(1, 1)).toBe(2);
    expect(nextCombo(4, COMBO_WINDOW)).toBe(5);
    expect(nextCombo(4, COMBO_WINDOW + 0.01)).toBe(1);
    expect(nextCombo(0, 99)).toBe(1);
  });
});

describe('difficulty curves', () => {
  it('levelFor is monotonic in time and score and capped', () => {
    expect(levelFor(0, 0)).toBe(1);
    let prev = 1;
    for (let s = 0; s <= 600; s += 5) {
      const l = levelFor(s, 0);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
    prev = 1;
    for (let sc = 0; sc <= 50000; sc += 250) {
      const l = levelFor(0, sc);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
    expect(levelFor(1e6, 1e9)).toBe(MAX_LEVEL);
    expect(levelFor(-5, -5)).toBe(1);
  });
  it('fallSpeed never decreases and spawnInterval never increases with level', () => {
    for (const m of MODE_LIST) {
      const cfg = MODES[m];
      for (let l = 1; l < MAX_LEVEL; l++) {
        expect(fallSpeed(cfg, l + 1)).toBeGreaterThanOrEqual(fallSpeed(cfg, l));
        expect(spawnInterval(cfg, l + 1)).toBeLessThanOrEqual(spawnInterval(cfg, l));
        expect(spawnInterval(cfg, l)).toBeGreaterThanOrEqual(MIN_SPAWN_INTERVAL);
      }
      expect(fallSpeed(cfg, 2)).toBeGreaterThan(fallSpeed(cfg, 1));
      expect(fallSpeed(cfg, 0)).toBe(fallSpeed(cfg, 1));
    }
  });
  it('hard is faster and has more colours than medium, which is harder than easy', () => {
    expect(MODES.hard.colors).toBe(5);
    expect(MODES.easy.colors).toBe(4);
    expect(fallSpeed(MODES.hard, 1)).toBeGreaterThan(fallSpeed(MODES.medium, 1));
    expect(fallSpeed(MODES.medium, 1)).toBeGreaterThan(fallSpeed(MODES.easy, 1));
    expect(spawnInterval(MODES.hard, 1)).toBeLessThan(spawnInterval(MODES.medium, 1));
    expect(spawnInterval(MODES.medium, 1)).toBeLessThan(spawnInterval(MODES.easy, 1));
    expect(isMode('hard')).toBe(true);
    expect(isMode('nope')).toBe(false);
  });
  it('spawn distance lies beyond the boundary', () => {
    for (const m of MODE_LIST) expect(spawnDistance(MODES[m])).toBeGreaterThan(MODES[m].maxLevels);
  });
});

describe('game over', () => {
  it('detects only stacks taller than maxLevels', () => {
    const full = stacksFrom([[1, 2, 1, 2, 1, 2, 1, 2]]);
    expect(overflowSides(full, 8)).toEqual([]);
    const over = stacksFrom([[1, 2, 1, 2, 1, 2, 1, 2, 1], [], [], [1, 2, 1, 2, 1, 2, 1, 2, 1, 2]]);
    expect(overflowSides(over, 8)).toEqual([0, 3]);
    expect(maxHeight(over)).toBe(10);
    expect(maxHeight(emptyStacks())).toBe(0);
  });
});

describe('stepFalling', () => {
  it('moves blocks inward and lands them on the stack top', () => {
    const sim = createSim();
    sim.falling.push({ id: 1, lane: 0, pos: 2, color: 3 });
    expect(stepFalling(sim, 0.5, 2)).toEqual([]);
    expect(sim.falling[0].pos).toBeCloseTo(1);
    const landed = stepFalling(sim, 0.5, 2);
    expect(landed).toEqual([{ side: 0, level: 0, color: 3, lane: 0 }]);
    expect(sim.falling).toHaveLength(0);
    expect(sim.stacks[0]).toEqual([3]);
  });
  it('lands on the local side that faces the lane after rotation', () => {
    const sim = createSim();
    sim.rotation = 2;
    sim.falling.push({ id: 1, lane: 1, pos: 0.1, color: 0 });
    const landed = stepFalling(sim, 0.1, 5);
    expect(landed[0].side).toBe(localSide(1, 2));
    expect(sim.stacks[localSide(1, 2)]).toEqual([0]);
  });
  it('snaps onto a taller stack rotated underneath', () => {
    const sim = createSim();
    sim.stacks[0] = [1, 1, 1, 1, 1];
    sim.falling.push({ id: 1, lane: 0, pos: 3, color: 2 });
    const landed = stepFalling(sim, 0.016, 1);
    expect(landed).toEqual([{ side: 0, level: 5, color: 2, lane: 0 }]);
    expect(sim.stacks[0]).toHaveLength(6);
  });
  it('stacks two blocks in one lane in the right order', () => {
    const sim = createSim();
    sim.falling.push({ id: 1, lane: 4, pos: 1.2, color: 7 });
    sim.falling.push({ id: 2, lane: 4, pos: 0.3, color: 8 });
    const landed = stepFalling(sim, 1, 2);
    expect(landed.map((l) => l.color)).toEqual([8, 7]);
    expect(sim.stacks[4]).toEqual([8, 7]);
  });
  it('leaves far blocks falling', () => {
    const sim = createSim();
    sim.falling.push({ id: 1, lane: 2, pos: 10, color: 1 });
    sim.falling.push({ id: 2, lane: 3, pos: 0.01, color: 1 });
    const landed = stepFalling(sim, 0.01, 1);
    expect(landed).toHaveLength(1);
    expect(sim.falling).toHaveLength(1);
    expect(sim.falling[0].id).toBe(1);
  });
});

describe('spawning', () => {
  const flat = [0, 0, 0, 0, 0, 0];
  it('picks lanes in range, and every lane on an even board', () => {
    const hits = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const lane = pickLane([], 11, flat, Math.random);
      expect(lane).toBeGreaterThanOrEqual(0);
      expect(lane).toBeLessThan(SIDES);
      hits.add(lane);
    }
    expect(hits.size).toBe(SIDES);
  });
  it('skips lanes with a block still near the spawn point or already crowded', () => {
    const falling = [
      { lane: 0, pos: 10.5 },
      { lane: 1, pos: 3 },
      { lane: 1, pos: 6 },
    ];
    for (let i = 0; i < 100; i++) {
      const lane = pickLane(falling, 11, flat, Math.random);
      expect([2, 3, 4, 5]).toContain(lane);
    }
  });
  it('returns -1 when every lane is busy and uses the only free lane otherwise', () => {
    const busy = Array.from({ length: SIDES }, (_, lane) => ({ lane, pos: 10.9 }));
    expect(pickLane(busy, 11, flat, Math.random)).toBe(-1);
    const allButOne = busy.filter((f) => f.lane !== 3);
    expect(pickLane(allButOne, 11, flat, seq([0.99]))).toBe(3);
  });
  it('weights lanes by the height of the stack they face', () => {
    // weights: 1,1,1,1,1, 1 + TALL_WEIGHT·8 = 5 → total 10; rand 0.55 → x = 5.5 → past the first five → lane 5.
    const heights = [0, 0, 0, 0, 0, 8];
    expect(1 + TALL_WEIGHT * 8).toBe(5);
    expect(pickLane([], 11, heights, seq([0.55]))).toBe(5);
    expect(pickLane([], 11, heights, seq([0.45]))).toBe(4);
    const rand = seededRandom(7);
    let tall = 0;
    for (let i = 0; i < 4000; i++) if (pickLane([], 11, heights, rand) === 5) tall++;
    expect(tall / 4000).toBeGreaterThan(0.45);
    expect(tall / 4000).toBeLessThan(0.55);
  });
  it('laneHeights follows the rotation', () => {
    const sim = createSim();
    sim.stacks[0] = [1, 1, 1];
    expect(laneHeights(sim)).toEqual([3, 0, 0, 0, 0, 0]);
    sim.rotation = 2; // side 0 now faces lane 2
    expect(laneHeights(sim)).toEqual([0, 0, 3, 0, 0, 0]);
  });
  it('pickColor stays in range and can bias toward top-of-stack colours', () => {
    const s = stacksFrom([[0, 3], [], [2]]);
    for (let i = 0; i < 200; i++) {
      const c = pickColor(s, 4, Math.random);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(4);
    }
    // rand: 0.1 (< bias) then 0.99 → second top (colour 2)
    expect(pickColor(s, 4, seq([0.1, 0.99]))).toBe(2);
    // rand: 0.9 (no bias) then 0.3 → uniform pick floor(0.3*4) = 1
    expect(pickColor(s, 4, seq([0.9, 0.3]))).toBe(1);
    // empty board with bias roll still yields a uniform colour
    expect(pickColor(emptyStacks(), 5, seq([0.1, 0.99]))).toBe(4);
  });
  it('pickColor never hands the facing side its own top colour through the bias', () => {
    const s = stacksFrom([[0, 3], [], [2]]);
    // Avoiding side 0: the only biased candidate is side 2's top (colour 2).
    expect(pickColor(s, 4, seq([0.1, 0.0]), COLOR_BIAS, 0)).toBe(2);
    expect(pickColor(s, 4, seq([0.1, 0.99]), COLOR_BIAS, 0)).toBe(2);
    // Only the facing side has blocks: the bias has nothing to offer, fall back to uniform.
    const lone = stacksFrom([[1, 1]]);
    expect(pickColor(lone, 4, seq([0.1, 0.8]), COLOR_BIAS, 0)).toBe(3);
  });
});

/** Build a core with fixed stacks, no falling blocks and spawning held off. */
function coreWith(cols: number[][], mode: Mode = 'medium'): Core {
  const core = createCore(MODES[mode]);
  core.sim.stacks = stacksFrom(cols);
  core.spawnT = 1e9;
  return core;
}

/** Drop a block of `color` right above the stack facing `lane` so the next tick lands it. */
function dropOn(core: Core, lane: number, color: number): void {
  const side = localSide(lane, core.sim.rotation);
  core.sim.falling.push({ id: core.nextId++, lane, pos: core.sim.stacks[side].length + 0.001, color });
}

const noRand = () => 0.5;

describe('core: landing, clearing, cascades and overflow', () => {
  it('lands a block without clearing when no group forms', () => {
    const core = coreWith([[1, 2]]);
    dropOn(core, 0, 3);
    const ev = coreTick(core, 0.016, noRand);
    expect(ev.landed).toEqual([{ side: 0, level: 2, color: 3, lane: 0 }]);
    expect(ev.cleared).toEqual([]);
    expect(core.clearing).toBeNull();
    expect(core.sim.stacks[0]).toEqual([1, 2, 3]);
  });
  it('starts a clear when a group forms, scores it, and removes it after CLEAR_DUR', () => {
    const core = coreWith([[1, 1]]);
    dropOn(core, 0, 1);
    const ev = coreTick(core, 0.016, noRand);
    expect(ev.cleared).toHaveLength(1);
    expect(ev.cleared[0].cells).toHaveLength(3);
    expect(ev.cleared[0].points).toBe(clearScore(3, 1));
    expect(ev.cleared[0].combo).toBe(1);
    expect(core.score).toBe(90);
    expect(core.clearing?.cells.size).toBe(3);
    // Still on the board while flashing.
    expect(core.sim.stacks[0]).toHaveLength(3);
    let removed: ClearCell[] = [];
    for (let i = 0; i < 40 && !removed.length; i++) removed = coreTick(core, 0.016, noRand).removed;
    expect(removed).toHaveLength(3);
    expect(removed.every((c) => c.color === 1)).toBe(true);
    expect(core.sim.stacks[0]).toEqual([]);
    expect(core.clearing).toBeNull();
  });
  it('chains a cascade after gravity, growing the combo', () => {
    // Sides 1 and 5 hold a 2 at level 0. A 1 lands on side 0 = [1,1] → [1,1,1] starts clearing; a 2 then
    // lands on top of the flashing cells and, once they are removed, drops to level 0 next to 1:0 and 5:0.
    const core = coreWith([[1, 1], [2], [], [], [], [2]]);
    dropOn(core, 0, 1);
    coreTick(core, 0.016, noRand);
    expect(core.clearing?.cells.size).toBe(3);
    dropOn(core, 0, 2); // lands on top of the flashing cells (level 3)
    const ev = coreTick(core, 0.016, noRand);
    expect(ev.landed).toHaveLength(1);
    expect(ev.cleared).toHaveLength(0); // flashing cells count as empty, 2 at level 3 has no partner
    const events: CoreEvents[] = [];
    for (let i = 0; i < 80 && core.score < 90 + clearScore(3, 2); i++) events.push(coreTick(core, 0.016, noRand));
    const cleared = events.flatMap((e) => e.cleared);
    expect(cleared).toHaveLength(1);
    expect(cleared[0].combo).toBe(2);
    expect(cleared[0].points).toBe(clearScore(3, 2));
    for (let i = 0; i < 40 && core.clearing; i++) coreTick(core, 0.016, noRand);
    expect(blockCount(core.sim.stacks)).toBe(0);
    // The final board matches resolveCascade's verdict for the same pre-clear board.
    expect(resolveCascade(stacksFrom([[1, 1, 1, 2], [2], [], [], [], [2]])).stacks).toEqual(core.sim.stacks);
  });
  it('a landing never groups with cells that are already flashing', () => {
    const core = coreWith([[3, 3], [], [], [], [], []]);
    dropOn(core, 0, 3);
    coreTick(core, 0.016, noRand);
    expect(core.clearing?.cells.size).toBe(3);
    dropOn(core, 0, 3); // a 4th same-colour block on top of the flashing three
    const ev = coreTick(core, 0.016, noRand);
    expect(ev.cleared).toHaveLength(0);
    for (let i = 0; i < 40 && core.clearing; i++) coreTick(core, 0.016, noRand);
    expect(core.sim.stacks[0]).toEqual([3]);
  });
  it('reports overflow at once on a settled board', () => {
    const core = coreWith([[0, 1, 0, 1, 0, 1, 0, 1]]);
    dropOn(core, 0, 2);
    const ev = coreTick(core, 0.016, noRand);
    expect(ev.over).toEqual([0]);
    expect(core.over).toEqual([0]);
    // The round is frozen afterwards.
    const after = coreTick(core, 1, noRand);
    expect(after).toEqual(emptyEvents());
    expect(coreRotate(core, 1)).toEqual(emptyEvents());
    expect(core.sim.rotation).toBe(0);
  });
  it('defers overflow while a clear is running, then reports it if the side is still too tall', () => {
    // Side 1 gets a group; meanwhile side 0 holds 8 and a 9th block lands on it.
    const core = coreWith([[0, 1, 0, 1, 0, 1, 2, 2], [2, 2], [], [], [], []]);
    dropOn(core, 1, 2);
    coreTick(core, 0.016, noRand);
    expect(core.clearing).not.toBeNull();
    dropOn(core, 0, 3);
    const ev = coreTick(core, 0.016, noRand);
    expect(ev.over).toBeNull();
    expect(core.sim.stacks[0]).toHaveLength(9);
    // The clear only touches side 1, so side 0 still holds 9 once it finishes: game over then.
    const events: CoreEvents[] = [];
    for (let i = 0; i < 40 && core.clearing; i++) events.push(coreTick(core, 0.016, noRand));
    expect(core.over).toEqual([0]);
    expect(events.some((e) => e.over)).toBe(true);
  });
  it('overflow is lifted when the pending clear takes blocks off that side', () => {
    // Side 0 is full (8) with a 2 on top; side 1 has a 2 at the same level → a pair.
    const core = coreWith([[0, 1, 0, 1, 0, 1, 0, 2], [2, 3, 3, 0, 2, 3, 1, 2], [], [], [], []]);
    expect(findGroups(core.sim.stacks)).toHaveLength(0);
    dropOn(core, 0, 2); // 0:7, 0:8, 1:7 → a group of 3, while side 0 holds 9 for the moment
    const ev = coreTick(core, 0.016, noRand);
    expect(ev.cleared).toHaveLength(1);
    expect(ev.cleared[0].cells).toHaveLength(3);
    expect(ev.over).toBeNull();
    for (let i = 0; i < 40 && core.clearing; i++) coreTick(core, 0.016, noRand);
    expect(core.over).toBeNull();
    expect(core.sim.stacks[0]).toEqual([0, 1, 0, 1, 0, 1, 0]);
    expect(core.sim.stacks[1]).toHaveLength(7);
  });
  it('rotating a taller stack under a low block lands it there and can clear', () => {
    const core = coreWith([[0], [4, 4]]);
    // Lane 0 faces side 0 (height 1); the block hovers at 1.5 so it has not landed yet.
    core.sim.falling.push({ id: 1, lane: 0, pos: 1.5, color: 4 });
    // One counter-clockwise step brings side 1 under lane 0 (localSide(0, -1) = 1).
    const ev = coreRotate(core, -1);
    expect(ev.landed).toEqual([{ side: 1, level: 2, color: 4, lane: 0 }]);
    expect(ev.cleared).toHaveLength(1);
    expect(core.score).toBe(90);
  });
  it('multi-step rotation steps through each side in order', () => {
    const core = coreWith([[], [], [5, 5, 5, 5]]);
    core.sim.falling.push({ id: 1, lane: 0, pos: 3, color: 0 });
    // -1: side 1 (empty) passes; -2: side 2 (height 4 ≥ 3) catches it.
    const ev = coreRotate(core, -3);
    expect(core.sim.rotation).toBe(-3);
    expect(ev.landed).toEqual([{ side: 2, level: 4, color: 0, lane: 0 }]);
  });
  it('spawns at the spawn distance on schedule and levels up with time', () => {
    const core = createCore(MODES.easy);
    const rand = seededRandom(3);
    let ev = coreTick(core, FIRST_SPAWN - 0.01, rand);
    expect(core.sim.falling).toHaveLength(0);
    ev = coreTick(core, 0.02, rand);
    expect(core.sim.falling).toHaveLength(1);
    expect(core.sim.falling[0].pos).toBeLessThanOrEqual(spawnDistance(MODES.easy));
    expect(core.sim.falling[0].color).toBeLessThan(MODES.easy.colors);
    expect(ev.levelUp).toBe(false);
    let leveled = false;
    for (let i = 0; i < 1300 && !core.over; i++) leveled = coreTick(core, 1 / 60, rand).levelUp || leveled;
    expect(core.elapsed).toBeGreaterThan(20);
    expect(leveled).toBe(true);
    expect(core.level).toBeGreaterThanOrEqual(2);
  });
});

describe('gestures', () => {
  const W = 390;
  it('a tap rotates toward the touched half, on release only', () => {
    const left = gestureStart(80, 300, W);
    expect(gestureMove(left, 84, 302)).toBe(0);
    expect(gestureEnd(left, 85, 303)).toBe(-1);
    const right = gestureStart(300, 300, W);
    expect(gestureEnd(right, 300, 300)).toBe(1);
  });
  it('a swipe right that starts on the LEFT half never turns counter-clockwise', () => {
    // The QA repro: finger down at x=120 (left half), 150 px swipe right in 12 moves.
    const g = gestureStart(120, 300, W);
    let rot = 0;
    const trace = [rot];
    for (let i = 1; i <= 12; i++) {
      rot += gestureMove(g, 120 + (150 * i) / 12, 300);
      trace.push(rot);
    }
    rot += gestureEnd(g, 270, 300);
    expect(Math.min(...trace)).toBe(0);
    for (let i = 1; i < trace.length; i++) expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1]);
    expect(rot).toBe(1 + Math.floor((150 - SWIPE_START) / SWIPE_STEP));
  });
  it('a swipe left from the right half turns only counter-clockwise', () => {
    const g = gestureStart(300, 300, W);
    let rot = 0;
    for (let x = 300; x >= 300 - SWIPE_START - SWIPE_STEP; x -= 5) {
      rot += gestureMove(g, x, 300);
      expect(rot).toBeLessThanOrEqual(0);
    }
    rot += gestureEnd(g, 300 - SWIPE_START - SWIPE_STEP, 300);
    expect(rot).toBe(-2);
  });
  it('dragging back to the start undoes the swipe and the release is not a tap', () => {
    const g = gestureStart(100, 300, W);
    let rot = gestureMove(g, 100 + SWIPE_START + 1, 300);
    expect(rot).toBe(1);
    rot += gestureMove(g, 101, 300);
    expect(rot).toBe(0);
    rot += gestureEnd(g, 100, 300);
    expect(rot).toBe(0);
  });
  it('a mostly vertical drag is neither a tap nor a swipe', () => {
    const g = gestureStart(100, 300, W);
    gestureMove(g, 104, 300 + TAP_MAX_DY + 10);
    expect(gestureEnd(g, 104, 300 + TAP_MAX_DY + 20)).toBe(0);
  });
  it('replays the QA repro with the core: the swipe lands the block on the intended side', () => {
    // side1 = [0,1,2,3,0], side5 = [2,2]; a colour-2 block in lane 0 at pos 3.5, finger down on the left
    // half then swiped right. Turning the wrong way first would face side 1 (height 5) and land it there.
    const core = coreWith([[], [0, 1, 2, 3, 0], [], [], [], [2, 2]]);
    core.sim.falling.push({ id: 1, lane: 0, pos: 3.5, color: 2 });
    const g = gestureStart(120, 300, W);
    const landed: number[] = [];
    const trace: number[] = [];
    for (let i = 1; i <= 12; i++) {
      const ev = coreRotate(core, gestureMove(g, 120 + (60 * i) / 12, 300));
      landed.push(...ev.landed.map((l) => l.side));
      trace.push(core.sim.rotation);
    }
    landed.push(...coreRotate(core, gestureEnd(g, 180, 300)).landed.map((l) => l.side));
    // A 60 px swipe right is one clockwise step: lane 0 now faces side 5, never side 1.
    expect(Math.min(...trace)).toBe(0);
    expect(core.sim.rotation).toBe(1);
    expect(landed).toEqual([]);
    for (let i = 0; i < 200 && !landed.length; i++) landed.push(...coreTick(core, 1 / 60, noRand).landed.map((l) => l.side));
    expect(landed).toEqual([5]);
    expect(core.sim.stacks[1]).toEqual([0, 1, 2, 3, 0]);
    expect(core.score).toBe(90);
  });
});

/** Headless player policies for balance and invariant checks (decide every 0.15 s like a human). */
type Policy = (core: Core, rand: () => number) => number;
const POLICIES: Record<string, Policy> = {
  idle: () => 0,
  random: (_c, rand) => (rand() < 0.3 ? (rand() < 0.5 ? -1 : 1) : 0),
  greedy: (core) => {
    const f = core.sim.falling.slice().sort((a, b) => a.pos - b.pos)[0];
    if (!f) return 0;
    let best = 0;
    let bestScore = -1e9;
    for (let side = 0; side < SIDES; side++) {
      const col = core.sim.stacks[side];
      const h = col.length;
      let sc = -h * 2;
      if (h && col[h - 1] === f.color) sc += 20 + (h >= 2 && col[h - 2] === f.color ? 10 : 0);
      for (const n of [mod6(side - 1), mod6(side + 1)]) if (core.sim.stacks[n][h] === f.color) sc += 12;
      if (sc > bestScore) {
        bestScore = sc;
        best = side;
      }
    }
    let d = mod6(mod6(f.lane - best) - mod6(core.sim.rotation));
    if (d > 3) d -= 6;
    return Math.sign(d);
  },
};

function playOut(mode: Mode, seed: number, policy: Policy, maxT: number, check?: (core: Core, ev: CoreEvents) => void) {
  const core = createCore(MODES[mode]);
  const rand = seededRandom(seed);
  let decide = 0;
  let points = 0;
  while (!core.over && core.elapsed < maxT) {
    const ev = coreTick(core, 1 / 60, rand);
    points += ev.cleared.reduce((n, g) => n + g.points, 0);
    check?.(core, ev);
    decide -= 1 / 60;
    if (decide <= 0) {
      decide = 0.15;
      const steps = policy(core, rand);
      if (steps) {
        const rv = coreRotate(core, steps);
        points += rv.cleared.reduce((n, g) => n + g.points, 0);
        check?.(core, rv);
      }
    }
  }
  return { time: core.elapsed, score: core.score, points, over: core.over };
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

describe('core simulation', () => {
  it('keeps its invariants over many random games', () => {
    const problems = new Set<string>();
    for (const mode of MODE_LIST) {
      const cfg = MODES[mode];
      for (const name of ['random', 'greedy']) {
        for (let seed = 1; seed <= 3; seed++) {
          const res = playOut(mode, seed * 101, POLICIES[name], 120, (core, ev) => {
            for (const col of core.sim.stacks) for (const c of col) if (!(c >= 0 && c < cfg.colors)) problems.add('bad colour');
            // A settled board never holds an uncleared group or an unreported overflow.
            if (!core.clearing && !core.over && (ev.landed.length || ev.removed.length)) {
              if (findGroups(core.sim.stacks).length) problems.add('uncleared group');
              if (overflowSides(core.sim.stacks, cfg.maxLevels).length) problems.add('missed overflow');
            }
            if (core.clearing) {
              for (const c of core.clearing.cells.values()) if (core.sim.stacks[c.side][c.level] !== c.color) problems.add('clearing cell moved');
            }
            if (ev.over && !overflowSides(core.sim.stacks, cfg.maxLevels).length) problems.add('false overflow');
          });
          if (res.points !== res.score) problems.add('score drift');
        }
      }
    }
    expect([...problems]).toEqual([]);
  }, 30000);
  it('balance: never touching the screen loses fast and scores little; steering pays off', () => {
    for (const mode of MODE_LIST) {
      const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const idle = seeds.map((s) => playOut(mode, s * 7919, POLICIES.idle, 400));
      const greedy = seeds.map((s) => playOut(mode, s * 7919, POLICIES.greedy, 150));
      const idleTime = median(idle.map((r) => r.time));
      const idleScore = median(idle.map((r) => r.score));
      expect(idle.every((r) => r.over)).toBe(true);
      // Measured medians before the fix: 124 s / 101 s / 72 s and ~1465 / 1465 / 995 points.
      expect(idleTime).toBeLessThan(mode === 'hard' ? 60 : mode === 'medium' ? 80 : 95);
      expect(idleScore).toBeLessThan(900);
      expect(median(greedy.map((r) => r.time))).toBeGreaterThan(idleTime * 1.5);
      expect(median(greedy.map((r) => r.score))).toBeGreaterThan(idleScore * 5);
    }
  }, 30000);
});

describe('strings', () => {
  it('zh and en have identical key sets and a multi-line rules entry', () => {
    const zh = Object.keys(strings.zh).sort();
    const en = Object.keys(strings.en).sort();
    expect(zh).toEqual(en);
    expect(strings.zh.rules.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(strings.en.rules.split('\n').length).toBeGreaterThanOrEqual(3);
    for (const k of zh) {
      expect(strings.zh[k].length).toBeGreaterThan(0);
      expect(strings.en[k].length).toBeGreaterThan(0);
    }
  });
});

describe('computeBoard', () => {
  const sizes: [number, number][] = [
    [390, 720], // iPhone portrait (canvas under header + HUD)
    [360, 640],
    [320, 520],
    [768, 900],
    [844, 300], // landscape phone
    [1024, 700],
  ];
  it('keeps the spawn point on screen in every lane and the ring inside the canvas', () => {
    for (const m of MODE_LIST) {
      const cfg = MODES[m];
      const gap = spawnDistance(cfg) - cfg.maxLevels;
      for (const [w, h] of sizes) {
        const b = computeBoard(w, h, cfg);
        expect(b.lvl).toBeGreaterThan(0);
        expect(b.a0).toBeLessThan(b.R);
        expect(b.a0).toBe(hexApothem(b.R));
        expect(b.cx).toBe(w / 2);
        // Horizontal lanes: the whole just-spawned block (outer edge included) is inside the canvas.
        expect(b.R + (gap + 1) * b.lvl).toBeLessThanOrEqual(w / 2 - BOARD_PAD_X + 1e-6);
        // Diagonal lanes: the spawn block's outer corner stays inside vertically.
        const outer = (b.R + (gap + 1) * b.lvl) / COS30;
        expect(b.cy - outer).toBeGreaterThanOrEqual(BOARD_PAD_Y - 1e-6);
        expect(b.cy + outer).toBeLessThanOrEqual(h - BOARD_PAD_Y - BOARD_BOTTOM_RESERVE + 1e-6);
        // Ring (circumradius) inside the canvas.
        expect(b.R / COS30).toBeLessThanOrEqual(Math.min(b.cy, h - b.cy));
        expect(b.R).toBeLessThanOrEqual(w / 2);
        // The overflow level (index maxLevels) is drawn just outside the ring.
        expect(b.a0 + cfg.maxLevels * b.lvl).toBeCloseTo(b.R);
      }
    }
  });
  it('uses the available width on a portrait phone and grows with it', () => {
    const cfg = MODES.medium;
    const phone = computeBoard(390, 720, cfg);
    expect(phone.R).toBeGreaterThan(125);
    expect(phone.lvl).toBeGreaterThan(12);
    const wide = computeBoard(600, 720, cfg);
    expect(wide.R).toBeGreaterThan(phone.R);
    const short = computeBoard(390, 300, cfg);
    expect(short.R).toBeLessThan(phone.R);
  });
  it('hexApothem is clamped and proportional in between', () => {
    expect(hexApothem(50)).toBe(24);
    expect(hexApothem(1000)).toBe(44);
    expect(hexApothem(150)).toBeCloseTo(33);
  });
});
