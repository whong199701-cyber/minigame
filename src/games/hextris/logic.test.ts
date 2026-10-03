import { describe, expect, it } from 'vitest';
import {
  BOARD_BOTTOM_RESERVE,
  BOARD_PAD_X,
  BOARD_PAD_Y,
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
  createSim,
  emptyStacks,
  fallSpeed,
  findGroups,
  hexApothem,
  isMode,
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
  worldLane,
  type Cell,
  type Stacks,
} from './logic';
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
  it('picks lanes in range and avoids the previous lane when possible', () => {
    for (let i = 0; i < 200; i++) {
      const lane = pickLane([], 11, 2, Math.random);
      expect(lane).toBeGreaterThanOrEqual(0);
      expect(lane).toBeLessThan(SIDES);
      expect(lane).not.toBe(2);
    }
  });
  it('skips lanes with a block still near the spawn point or already crowded', () => {
    const falling = [
      { lane: 0, pos: 10.5 },
      { lane: 1, pos: 3 },
      { lane: 1, pos: 6 },
    ];
    for (let i = 0; i < 100; i++) {
      const lane = pickLane(falling, 11, -1, Math.random);
      expect([2, 3, 4, 5]).toContain(lane);
    }
  });
  it('returns -1 when every lane is busy and falls back to the last lane when it is the only option', () => {
    const busy = Array.from({ length: SIDES }, (_, lane) => ({ lane, pos: 10.9 }));
    expect(pickLane(busy, 11, 0, Math.random)).toBe(-1);
    const allButOne = busy.filter((f) => f.lane !== 3);
    expect(pickLane(allButOne, 11, 3, Math.random)).toBe(3);
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
