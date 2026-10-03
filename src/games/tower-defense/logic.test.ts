import { describe, expect, it } from 'vitest';
import {
  AURA_LINGER,
  COUNTDOWN,
  DIFFICULTY,
  ENEMY_DEFS,
  HP_GROWTH,
  MAPS,
  MAX_LEVEL,
  SLOW_CAP,
  TOWER_DEFS,
  TOWER_TYPES,
  WAVES_PER_MAP,
  applySlow,
  build,
  buildCost,
  buildPath,
  canBuild,
  canHit,
  canStartWave,
  continueEndless,
  createGame,
  damage,
  earlyBonus,
  enemyHp,
  enemyReward,
  expandWave,
  findMap,
  isPathCell,
  pathCoverage,
  pathGeometry,
  pickTarget,
  pointOnPath,
  sell,
  sellValue,
  setTargeting,
  slowFactor,
  spawnEnemy,
  startWave,
  takeEvents,
  tick,
  towerAt,
  towerStats,
  upgrade,
  upgradeCost,
  validateMap,
  waveClearBonus,
  waveComposition,
  waveHasBoss,
  type Enemy,
  type GameState,
  type MapDef,
  type Tower,
} from './logic';
import { strings } from './strings';

const DT = 1 / 60;

function run(s: GameState, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) tick(s, DT);
}

function runUntil(s: GameState, done: () => boolean, maxSeconds: number): void {
  const steps = Math.round(maxSeconds / DT);
  for (let i = 0; i < steps && !done(); i++) tick(s, DT);
}

function makeEnemy(s: GameState, type: Enemy['type'], dist: number): Enemy {
  const e = spawnEnemy(s, type);
  e.dist = dist;
  const p = pointOnPath(s.geom, dist);
  e.x = p.x;
  e.y = p.y;
  e.seg = p.seg;
  return e;
}

function firstBuildable(s: GameState): [number, number] {
  for (let r = 0; r < s.map.rows; r++) for (let c = 0; c < s.map.cols; c++) if (canBuild(s, c, r)) return [c, r];
  throw new Error('no buildable cell');
}

// ── Maps ────────────────────────────────────────────────────────────────────

describe('maps', () => {
  it('ships three valid maps with distinct ids', () => {
    expect(MAPS).toHaveLength(3);
    expect(new Set(MAPS.map((m) => m.id)).size).toBe(3);
    for (const m of MAPS) expect(validateMap(m)).toBeNull();
  });

  it('builds contiguous, non-repeating paths that start on an edge', () => {
    for (const m of MAPS) {
      const cells = buildPath(m);
      expect(cells.length).toBeGreaterThan(10);
      const [c0, r0] = cells[0];
      expect(c0 === 0 || r0 === 0 || c0 === m.cols - 1 || r0 === m.rows - 1).toBe(true);
      const keys = new Set<string>();
      for (let i = 0; i < cells.length; i++) {
        const [c, r] = cells[i];
        expect(c >= 0 && c < m.cols && r >= 0 && r < m.rows).toBe(true);
        keys.add(c + ',' + r);
        if (i > 0) {
          const [pc, pr] = cells[i - 1];
          expect(Math.abs(c - pc) + Math.abs(r - pr)).toBe(1);
        }
      }
      expect(keys.size).toBe(cells.length);
    }
  });

  it('rejects broken maps', () => {
    const base: MapDef = { id: 'x', cols: 5, rows: 5, waypoints: [[0, 1], [4, 1]], hpMult: 1 };
    expect(validateMap(base)).toBeNull();
    expect(validateMap({ ...base, waypoints: [[0, 1], [9, 1]] })).toMatch(/out of bounds/);
    expect(validateMap({ ...base, waypoints: [[0, 1], [3, 3]] })).toMatch(/axis-aligned/);
    expect(validateMap({ ...base, waypoints: [[2, 2], [4, 2]] })).toMatch(/edge/);
    expect(validateMap({ ...base, waypoints: [[0, 1], [0, 1]] })).toMatch(/duplicate/);
    expect(validateMap({ ...base, waypoints: [[0, 1]] })).toMatch(/two waypoints/);
    expect(validateMap({ ...base, waypoints: [[0, 1], [3, 1], [3, 3], [1, 3], [1, 0]] })).toMatch(/crosses/);
    expect(validateMap({ ...base, waypoints: [[0, 2], [0, 4]] })).toMatch(/enter from outside/);
    expect(validateMap({ ...base, waypoints: [[1, 0], [1, 4]] })).toBeNull();
    expect(validateMap({ id: 'tiny', cols: 2, rows: 2, waypoints: [[0, 0], [1, 0]], hpMult: 1 })).toMatch(/small/);
  });

  it('findMap falls back to the first map', () => {
    expect(findMap('spiral').id).toBe('spiral');
    expect(findMap('nope').id).toBe(MAPS[0].id);
  });

  it('marks path cells and keeps buildable cells around them', () => {
    const s = createGame(MAPS[0], 'normal');
    const cells = buildPath(MAPS[0]);
    for (const [c, r] of cells) expect(isPathCell(s, c, r)).toBe(true);
    let buildable = 0;
    for (let r = 0; r < s.map.rows; r++) for (let c = 0; c < s.map.cols; c++) if (canBuild(s, c, r)) buildable++;
    expect(buildable).toBe(s.map.cols * s.map.rows - cells.length);
    expect(canBuild(s, -1, 0)).toBe(false);
    expect(canBuild(s, s.map.cols, 0)).toBe(false);
  });
});

describe('path geometry', () => {
  const geom = pathGeometry(MAPS[0]);

  it('starts outside the grid and ends at the last cell centre', () => {
    const p0 = pointOnPath(geom, 0);
    expect(p0.x).toBeLessThan(0);
    const end = pointOnPath(geom, geom.length);
    const [lc, lr] = geom.cells[geom.cells.length - 1];
    expect(end.x).toBeCloseTo(lc + 0.5);
    expect(end.y).toBeCloseTo(lr + 0.5);
    expect(geom.length).toBeCloseTo(geom.cells.length);
  });

  it('interpolates monotonically along the path, with or without a segment hint', () => {
    let prev = pointOnPath(geom, 0);
    let travelled = 0;
    let lastD = 0;
    for (let d = 0.1; d < geom.length; d += 0.1) {
      const a = pointOnPath(geom, d);
      const b = pointOnPath(geom, d, prev.seg);
      expect(a.x).toBeCloseTo(b.x);
      expect(a.y).toBeCloseTo(b.y);
      expect(a.seg).toBeGreaterThanOrEqual(prev.seg);
      travelled += Math.hypot(a.x - prev.x, a.y - prev.y);
      prev = a;
      lastD = d;
    }
    expect(travelled).toBeCloseTo(lastD, 3);
    expect(pointOnPath(geom, -5).x).toBe(geom.points[0].x);
    expect(pointOnPath(geom, geom.length + 5).seg).toBe(geom.points.length - 2);
  });

  it('pathCoverage counts path cells within range', () => {
    const s = createGame(MAPS[0], 'normal');
    expect(pathCoverage(s, 3, 2, 1.1)).toBe(1);
    expect(pathCoverage(s, 3, 2, 0.5)).toBe(0);
    expect(pathCoverage(s, 3, 2, 3)).toBeGreaterThan(5);
  });
});

// ── Definitions ─────────────────────────────────────────────────────────────

describe('definitions', () => {
  it('every tower has three levels with growing damage and range', () => {
    for (const type of TOWER_TYPES) {
      const def = TOWER_DEFS[type];
      expect(def.levels).toHaveLength(MAX_LEVEL);
      for (let i = 1; i < def.levels.length; i++) {
        expect(def.levels[i].dmg).toBeGreaterThan(def.levels[i - 1].dmg);
        expect(def.levels[i].range).toBeGreaterThan(def.levels[i - 1].range);
        expect(def.levels[i].cost).toBeGreaterThan(0);
      }
      expect(towerStats(type, 1)).toBe(def.levels[0]);
      expect(towerStats(type, 99)).toBe(def.levels[MAX_LEVEL - 1]);
      expect(towerStats(type, 0)).toBe(def.levels[0]);
    }
    expect(TOWER_DEFS.sniper.bossMult).toBe(2);
    expect(TOWER_DEFS.cannon.hitsFlying).toBe(false);
    expect(TOWER_DEFS.frost.hitsFlying).toBe(false);
    expect(TOWER_DEFS.arrow.hitsFlying).toBe(true);
    expect(TOWER_DEFS.sniper.hitsFlying).toBe(true);
    expect(TOWER_DEFS.sniper.levels[0].range).toBeGreaterThan(TOWER_DEFS.arrow.levels[2].range);
  });

  it('scales enemy HP by HP_GROWTH per wave and rewards gently', () => {
    expect(enemyHp('normal', 1)).toBe(ENEMY_DEFS.normal.hp);
    expect(enemyHp('normal', 2)).toBe(Math.round(ENEMY_DEFS.normal.hp * HP_GROWTH));
    expect(enemyHp('tank', 11)).toBe(Math.round(ENEMY_DEFS.tank.hp * Math.pow(HP_GROWTH, 10)));
    expect(enemyHp('normal', 5, 1.3)).toBe(Math.round(ENEMY_DEFS.normal.hp * Math.pow(HP_GROWTH, 4) * 1.3));
    expect(enemyReward('normal', 1)).toBe(ENEMY_DEFS.normal.reward);
    expect(enemyReward('normal', 21)).toBe(ENEMY_DEFS.normal.reward * 2);
    expect(enemyReward('fast', 1, 0.01)).toBe(1);
    expect(waveClearBonus(1)).toBe(25);
    expect(waveClearBonus(10, 0.9)).toBe(Math.round(70 * 0.9));
  });

  it('hard mode has fewer lives, less gold and tougher enemies', () => {
    expect(DIFFICULTY.hard.lives).toBeLessThan(DIFFICULTY.normal.lives);
    expect(DIFFICULTY.hard.money).toBeLessThan(DIFFICULTY.normal.money);
    expect(DIFFICULTY.hard.hpMult).toBeGreaterThan(1);
  });
});

// ── Waves ───────────────────────────────────────────────────────────────────

describe('wave composition', () => {
  it('scripts 20 waves with positive counts and bosses on waves 10 and 20 only', () => {
    for (let w = 1; w <= WAVES_PER_MAP; w++) {
      const groups = waveComposition(w);
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) {
        expect(g.count).toBeGreaterThan(0);
        expect(g.gap).toBeGreaterThan(0);
        expect(ENEMY_DEFS[g.type]).toBeDefined();
      }
      expect(waveHasBoss(w)).toBe(w % 10 === 0);
    }
    expect(waveComposition(0)).toEqual(waveComposition(1));
  });

  it('introduces each enemy type before wave 10', () => {
    const seen = new Set<string>();
    for (let w = 1; w <= 10; w++) for (const g of waveComposition(w)) seen.add(g.type);
    expect(seen).toEqual(new Set(['normal', 'fast', 'tank', 'flying', 'boss']));
  });

  it('generates growing endless waves with a boss every 10th wave', () => {
    const total = (w: number) => waveComposition(w).reduce((n, g) => n + g.count, 0);
    expect(total(21)).toBeGreaterThan(0);
    expect(total(30)).toBeGreaterThan(total(21));
    expect(total(45)).toBeGreaterThan(total(30));
    expect(waveHasBoss(30)).toBe(true);
    expect(waveHasBoss(31)).toBe(false);
    expect(waveComposition(40).find((g) => g.type === 'boss')?.count).toBe(4);
  });

  it('spawns faster in later waves but never below the tempo floor', () => {
    const g1 = waveComposition(1)[0];
    const g13 = waveComposition(13)[0];
    expect(g1.type).toBe('normal');
    expect(g13.type).toBe('normal');
    expect(g13.gap).toBeLessThan(g1.gap);
    const g60 = waveComposition(60).find((g) => g.type === 'normal')!;
    expect(g60.gap).toBeCloseTo(ENEMY_DEFS.normal.gap * 0.55, 2);
  });

  it('expands groups into timed spawns', () => {
    const items = expandWave([
      { type: 'normal', count: 3, gap: 0.5 },
      { type: 'fast', count: 2, gap: 0.25 },
    ]);
    expect(items.map((i) => i.type)).toEqual(['normal', 'normal', 'normal', 'fast', 'fast']);
    expect(items.map((i) => i.delay)).toEqual([0, 0.5, 0.5, 1, 0.25]);
    expect(expandWave([])).toEqual([]);
  });
});

// ── Economy ─────────────────────────────────────────────────────────────────

describe('build / upgrade / sell', () => {
  it('builds only on free non-path cells when affordable', () => {
    const s = createGame(MAPS[0], 'normal');
    const [c, r] = firstBuildable(s);
    const [pc, pr] = s.geom.cells[3];
    expect(build(s, pc, pr, 'arrow')).toBeNull();
    const t = build(s, c, r, 'arrow');
    expect(t).not.toBeNull();
    expect(s.money).toBe(DIFFICULTY.normal.money - buildCost('arrow'));
    expect(towerAt(s, c, r)).toBe(t);
    expect(build(s, c, r, 'arrow')).toBeNull();
    s.money = 10;
    const [c2, r2] = firstBuildable(s);
    expect(build(s, c2, r2, 'arrow')).toBeNull();
    expect(s.money).toBe(10);
  });

  it('upgrades twice, charging the level costs, then reports max level', () => {
    const s = createGame(MAPS[0], 'normal');
    s.money = 10000;
    const [c, r] = firstBuildable(s);
    const t = build(s, c, r, 'cannon') as Tower;
    const costs = TOWER_DEFS.cannon.levels.map((l) => l.cost);
    expect(upgradeCost(t)).toBe(costs[1]);
    expect(upgrade(s, t.id)).toBe(true);
    expect(t.level).toBe(2);
    expect(upgradeCost(t)).toBe(costs[2]);
    expect(upgrade(s, t.id)).toBe(true);
    expect(t.level).toBe(MAX_LEVEL);
    expect(upgradeCost(t)).toBeNull();
    expect(upgrade(s, t.id)).toBe(false);
    expect(t.invested).toBe(costs[0] + costs[1] + costs[2]);
    expect(s.money).toBe(10000 - t.invested);
    expect(upgrade(s, 9999)).toBe(false);
  });

  it('refuses an upgrade the player cannot afford', () => {
    const s = createGame(MAPS[0], 'normal');
    const [c, r] = firstBuildable(s);
    const t = build(s, c, r, 'sniper') as Tower;
    s.money = 5;
    expect(upgrade(s, t.id)).toBe(false);
    expect(t.level).toBe(1);
    expect(s.money).toBe(5);
  });

  it('sells for 70 % of everything invested', () => {
    const s = createGame(MAPS[0], 'normal');
    s.money = 1000;
    const [c, r] = firstBuildable(s);
    const t = build(s, c, r, 'frost') as Tower;
    upgrade(s, t.id);
    const before = s.money;
    const expected = Math.round(t.invested * 0.7);
    expect(sellValue(t)).toBe(expected);
    expect(sell(s, t.id)).toBe(expected);
    expect(s.money).toBe(before + expected);
    expect(towerAt(s, c, r)).toBeUndefined();
    expect(canBuild(s, c, r)).toBe(true);
    expect(sell(s, t.id)).toBe(0);
  });

  it('blocks building once the game is over', () => {
    const s = createGame(MAPS[0], 'normal');
    s.phase = 'over';
    const [c, r] = firstBuildable(s);
    expect(build(s, c, r, 'arrow')).toBeNull();
  });

  it('switches targeting mode and drops the current target', () => {
    const s = createGame(MAPS[0], 'normal');
    const [c, r] = firstBuildable(s);
    const t = build(s, c, r, 'sniper') as Tower;
    expect(t.targeting).toBe('strongest');
    t.targetId = 42;
    setTargeting(s, t.id, 'first');
    expect(t.targeting).toBe('first');
    expect(t.targetId).toBeNull();
  });
});

// ── Enemy movement ──────────────────────────────────────────────────────────

describe('enemy progression', () => {
  it('walks along the path at its speed and leaks at the end', () => {
    const s = createGame(MAPS[0], 'normal');
    s.phase = 'wave';
    s.wave = 1;
    const e = spawnEnemy(s, 'fast');
    expect(e.dist).toBe(0);
    run(s, 1);
    expect(e.dist).toBeCloseTo(ENEMY_DEFS.fast.speed, 1);
    const p = pointOnPath(s.geom, e.dist);
    expect(e.x).toBeCloseTo(p.x);
    expect(e.y).toBeCloseTo(p.y);
    const lives = s.lives;
    run(s, s.geom.length / ENEMY_DEFS.fast.speed + 1);
    expect(s.enemies).toHaveLength(0);
    expect(s.lives).toBe(lives - 1);
    expect(s.leaked).toBe(1);
    expect(takeEvents(s).some((ev) => ev.type === 'leak' && ev.enemy === 'fast')).toBe(true);
  });

  it('a boss costs five lives', () => {
    const s = createGame(MAPS[1], 'normal');
    s.phase = 'wave';
    s.wave = 10;
    const e = spawnEnemy(s, 'boss');
    e.dist = s.geom.length - 0.01;
    tick(s, DT);
    expect(s.lives).toBe(DIFFICULTY.normal.lives - 5);
  });

  it('uses difficulty and map multipliers for HP', () => {
    const s = createGame(MAPS[2], 'hard');
    s.wave = 3;
    const e = spawnEnemy(s, 'tank');
    expect(e.maxHp).toBe(enemyHp('tank', 3, DIFFICULTY.hard.hpMult * MAPS[2].hpMult));
    expect(e.reward).toBe(enemyReward('tank', 3, DIFFICULTY.hard.rewardMult));
  });

  it('ends the game when lives reach zero', () => {
    const s = createGame(MAPS[0], 'hard');
    s.phase = 'wave';
    s.wave = 1;
    s.lives = 1;
    const e = spawnEnemy(s, 'normal');
    e.dist = s.geom.length;
    tick(s, DT);
    expect(s.phase).toBe('over');
    expect(s.lives).toBe(0);
    expect(takeEvents(s).some((ev) => ev.type === 'gameOver')).toBe(true);
    const before = s.time;
    tick(s, DT);
    expect(s.time).toBe(before);
  });
});

// ── Slows ───────────────────────────────────────────────────────────────────

describe('frost slow stacking', () => {
  const dummy = (): Enemy => ({
    id: 1,
    type: 'normal',
    hp: 10,
    maxHp: 10,
    speed: 1,
    reward: 1,
    lives: 1,
    radius: 0.2,
    flying: false,
    dist: 0,
    seg: 0,
    x: 0,
    y: 0,
    slows: [],
    leaked: false,
    lastHitBy: 0,
  });

  it('stacks different sources up to the cap', () => {
    const e = dummy();
    applySlow(e, 1, 0.3, 1, 0);
    expect(slowFactor(e, 0)).toBeCloseTo(0.3);
    applySlow(e, 2, 0.3, 1, 0);
    expect(slowFactor(e, 0)).toBeCloseTo(0.6);
    applySlow(e, 3, 0.3, 1, 0);
    expect(slowFactor(e, 0)).toBeCloseTo(SLOW_CAP);
    applySlow(e, 4, 0.5, 1, 0);
    expect(slowFactor(e, 0)).toBeCloseTo(SLOW_CAP);
  });

  it('refreshes instead of stacking the same source', () => {
    const e = dummy();
    applySlow(e, 1, 0.3, 1, 0);
    applySlow(e, 1, 0.3, 1, 0.5);
    expect(e.slows).toHaveLength(1);
    expect(slowFactor(e, 0.5)).toBeCloseTo(0.3);
    applySlow(e, 1, 0.5, 0.1, 0.5);
    expect(e.slows[0].amount).toBeCloseTo(0.5);
    expect(e.slows[0].until).toBeCloseTo(1.5);
  });

  it('expires and prunes old slows', () => {
    const e = dummy();
    applySlow(e, 1, 0.3, 1, 0);
    expect(slowFactor(e, 0.99)).toBeCloseTo(0.3);
    expect(slowFactor(e, 1)).toBe(0);
    expect(e.slows).toHaveLength(0);
  });

  it('frost towers slow everything in range and pulse damage, but ignore flyers', () => {
    const s = createGame(MAPS[0], 'normal');
    s.money = 10000;
    s.phase = 'wave';
    s.wave = 1;
    const [pc, pr] = s.geom.cells[4];
    // Cell directly below the first corridor row is buildable on the S-curve map.
    const frost = build(s, pc, pr + 1, 'frost') as Tower;
    expect(frost).not.toBeNull();
    const walker = makeEnemy(s, 'normal', 4.5);
    const flyer = makeEnemy(s, 'flying', 4.5);
    const far = makeEnemy(s, 'normal', 20);
    tick(s, DT);
    expect(slowFactor(walker, s.time)).toBeCloseTo(TOWER_DEFS.frost.levels[0].slow as number);
    expect(slowFactor(flyer, s.time)).toBe(0);
    expect(slowFactor(far, s.time)).toBe(0);
    expect(walker.hp).toBeLessThan(walker.maxHp);
    expect(flyer.hp).toBe(flyer.maxHp);
    expect(takeEvents(s).some((ev) => ev.type === 'pulse' && ev.hits === 1)).toBe(true);
    // Slow lingers only briefly after leaving the aura.
    walker.dist = 30;
    run(s, AURA_LINGER + 0.1);
    expect(slowFactor(walker, s.time)).toBe(0);
  });

  it('two frost towers stack their slows on the same enemy', () => {
    const s = createGame(MAPS[0], 'normal');
    s.money = 10000;
    s.phase = 'wave';
    s.wave = 1;
    const [pc, pr] = s.geom.cells[4];
    build(s, pc, pr + 1, 'frost');
    build(s, pc + 1, pr + 1, 'frost');
    const e = makeEnemy(s, 'tank', 4.5);
    tick(s, DT);
    expect(slowFactor(e, s.time)).toBeCloseTo(2 * (TOWER_DEFS.frost.levels[0].slow as number));
    const before = e.dist;
    tick(s, DT);
    expect(e.dist - before).toBeCloseTo(ENEMY_DEFS.tank.speed * (1 - 0.6) * DT, 5);
  });
});

// ── Targeting & damage ──────────────────────────────────────────────────────

describe('targeting', () => {
  function setup(type: Tower['type']): { s: GameState; t: Tower } {
    const s = createGame(MAPS[0], 'normal');
    s.money = 10000;
    s.phase = 'wave';
    s.wave = 1;
    const [pc, pr] = s.geom.cells[4];
    const t = build(s, pc, pr + 1, type) as Tower;
    return { s, t };
  }

  it('picks the enemy furthest along the path by default', () => {
    const { s, t } = setup('arrow');
    const a = makeEnemy(s, 'normal', 3.5);
    const b = makeEnemy(s, 'normal', 5.5);
    makeEnemy(s, 'normal', 25);
    expect(pickTarget(t, s.enemies)).toBe(b);
    b.hp = 0;
    expect(pickTarget(t, s.enemies)).toBe(a);
  });

  it('sniper prefers the strongest enemy and can be switched to first', () => {
    const { s, t } = setup('sniper');
    const weak = makeEnemy(s, 'fast', 6);
    const strong = makeEnemy(s, 'tank', 3);
    expect(pickTarget(t, s.enemies)).toBe(strong);
    setTargeting(s, t.id, 'first');
    expect(pickTarget(t, s.enemies)).toBe(weak);
  });

  it('cannon and frost cannot target flyers; arrow and sniper can', () => {
    const { s, t } = setup('cannon');
    const flyer = makeEnemy(s, 'flying', 4.5);
    expect(canHit(TOWER_DEFS.cannon, flyer)).toBe(false);
    expect(canHit(TOWER_DEFS.frost, flyer)).toBe(false);
    expect(canHit(TOWER_DEFS.arrow, flyer)).toBe(true);
    expect(canHit(TOWER_DEFS.sniper, flyer)).toBe(true);
    expect(pickTarget(t, s.enemies)).toBeNull();
    const walker = makeEnemy(s, 'normal', 4.5);
    expect(pickTarget(t, s.enemies)).toBe(walker);
  });

  it('ignores enemies out of range', () => {
    const { s, t } = setup('arrow');
    makeEnemy(s, 'normal', 30);
    expect(pickTarget(t, s.enemies)).toBeNull();
  });

  it('damage() reports kills and tracks the last attacker', () => {
    const { s } = setup('arrow');
    const e = makeEnemy(s, 'normal', 4.5);
    expect(damage(e, e.maxHp - 1, 7)).toBe(false);
    expect(e.lastHitBy).toBe(7);
    expect(damage(e, 5, 8)).toBe(true);
    expect(damage(e, 5, 9)).toBe(false);
    expect(e.lastHitBy).toBe(8);
  });

  it('arrow tower shoots, kills and pays the reward to the player and the tower', () => {
    const { s, t } = setup('arrow');
    const e = makeEnemy(s, 'fast', 4.5);
    const money = s.money;
    run(s, 2);
    expect(s.enemies).toHaveLength(0);
    expect(s.kills).toBe(1);
    expect(t.kills).toBe(1);
    // The lone enemy was the whole "wave", so the clear bonus is paid as well.
    expect(s.money).toBe(money + e.reward + waveClearBonus(1));
    const events = takeEvents(s);
    expect(events.some((ev) => ev.type === 'shoot' && ev.tower === 'arrow')).toBe(true);
    expect(events.some((ev) => ev.type === 'waveClear' && ev.wave === 1)).toBe(true);
    expect(events.some((ev) => ev.type === 'kill' && ev.enemy === 'fast' && ev.reward === e.reward)).toBe(true);
  });

  it('sniper hits instantly with a tracer and doubles damage on bosses', () => {
    const { s, t } = setup('sniper');
    const boss = makeEnemy(s, 'boss', 4.5);
    tick(s, DT);
    expect(boss.hp).toBe(boss.maxHp - TOWER_DEFS.sniper.levels[0].dmg * 2);
    expect(takeEvents(s).some((ev) => ev.type === 'tracer')).toBe(true);
    expect(t.cooldown).toBeGreaterThan(0);
    const normal = makeEnemy(s, 'normal', 4.5);
    boss.hp = 0;
    t.cooldown = 0;
    tick(s, DT);
    expect(normal.hp).toBe(normal.maxHp - TOWER_DEFS.sniper.levels[0].dmg);
  });

  it('cannon splash hits every ground enemy near the impact', () => {
    const { s } = setup('cannon');
    const a = makeEnemy(s, 'normal', 4.5);
    const b = makeEnemy(s, 'normal', 4.7);
    const flyer = makeEnemy(s, 'flying', 4.6);
    const far = makeEnemy(s, 'normal', 8);
    run(s, 1.5);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(flyer.hp).toBe(flyer.maxHp);
    expect(far.hp).toBe(far.maxHp);
    expect(takeEvents(s).some((ev) => ev.type === 'hit' && ev.kind === 'cannon' && ev.splash > 0)).toBe(true);
  });

  it('projectiles still land at the last known spot when the target dies', () => {
    const { s, t } = setup('cannon');
    const a = makeEnemy(s, 'normal', 4.5);
    tick(s, DT);
    expect(s.projectiles).toHaveLength(1);
    a.hp = 0;
    run(s, 1);
    expect(s.projectiles).toHaveLength(0);
    expect(t.cooldown).toBeGreaterThan(-1);
  });

  it('tick(): a "strongest" sniper switches from a tank to a boss that enters range on its next shot', () => {
    const { s, t } = setup('sniper');
    s.wave = 10;
    const dmg = TOWER_DEFS.sniper.levels[0].dmg;
    const tank = makeEnemy(s, 'tank', 4.5);
    tank.speed = 0;
    tick(s, DT);
    expect(t.targetId).toBe(tank.id);
    expect(tank.hp).toBe(tank.maxHp - dmg);
    const boss = makeEnemy(s, 'boss', 5.5);
    boss.speed = 0;
    expect(boss.maxHp).toBeGreaterThan(tank.hp);
    // Exactly one more shot: it must go to the boss, not to the tank the sniper was already aiming at.
    run(s, 1 / TOWER_DEFS.sniper.levels[0].rate + 0.05);
    expect(tank.hp).toBe(tank.maxHp - dmg);
    expect(boss.hp).toBe(boss.maxHp - dmg * TOWER_DEFS.sniper.bossMult);
    expect(t.targetId).toBe(boss.id);
  });

  it('tick(): a "first" arrow moves to an enemy further along the path on its next shot', () => {
    const { s, t } = setup('arrow');
    const rear = makeEnemy(s, 'tank', 3);
    const front = makeEnemy(s, 'tank', 6);
    for (const e of [rear, front]) {
      e.speed = 0;
      e.hp = e.maxHp = 1e6;
    }
    // Only the rear enemy exists for the first shot.
    s.enemies = [rear];
    tick(s, DT);
    expect(t.targetId).toBe(rear.id);
    s.enemies.push(front);
    run(s, 1.5);
    const dmg = TOWER_DEFS.arrow.levels[0].dmg;
    // The arrow already in flight lands on the rear enemy; every later shot goes to the front one.
    expect(rear.maxHp - rear.hp).toBe(dmg);
    expect(front.maxHp - front.hp).toBeGreaterThanOrEqual(dmg * 2);
    expect(t.targetId).toBe(front.id);
    // Switching the mode is honoured at once as well.
    rear.hp = rear.maxHp = 2e6;
    setTargeting(s, t.id, 'strongest');
    const before = rear.hp;
    run(s, 1 / TOWER_DEFS.arrow.levels[0].rate + 0.3);
    expect(rear.hp).toBeLessThan(before);
  });

  it('tick(): keeps firing at the current best target and drops it once it is gone', () => {
    const { s, t } = setup('sniper');
    const a = makeEnemy(s, 'normal', 4.5);
    a.speed = 0;
    a.hp = a.maxHp = 1e6;
    tick(s, DT);
    expect(t.targetId).toBe(a.id);
    a.hp = 0;
    tick(s, DT);
    expect(s.enemies).toHaveLength(0);
    t.cooldown = 0;
    tick(s, DT);
    expect(t.targetId).toBeNull();
    expect(t.cooldown).toBe(0);
  });

  it('respects the fire rate', () => {
    const { s, t } = setup('arrow');
    const e = makeEnemy(s, 'tank', 4.5);
    e.hp = e.maxHp = 1e9;
    e.speed = 0;
    run(s, 2);
    const shots = takeEvents(s).filter((ev) => ev.type === 'shoot').length;
    const rate = TOWER_DEFS.arrow.levels[0].rate;
    expect(shots).toBeGreaterThanOrEqual(Math.floor(2 * rate));
    expect(shots).toBeLessThanOrEqual(Math.ceil(2 * rate) + 1);
    expect(t.targetId).toBe(e.id);
  });
});

// ── Phases ──────────────────────────────────────────────────────────────────

describe('waves and phases', () => {
  it('starts in ready and only starts waves from ready / countdown', () => {
    const s = createGame(MAPS[0], 'normal');
    expect(s.phase).toBe('ready');
    expect(canStartWave(s)).toBe(true);
    expect(startWave(s)).toBe(0);
    expect(s.phase).toBe('wave');
    expect(s.wave).toBe(1);
    expect(s.enemies).toHaveLength(1);
    expect(canStartWave(s)).toBe(false);
    expect(startWave(s)).toBe(-1);
    expect(takeEvents(s).some((ev) => ev.type === 'waveStart' && ev.wave === 1)).toBe(true);
  });

  it('does nothing while ready, then spawns the whole wave over time', () => {
    const s = createGame(MAPS[0], 'normal');
    run(s, 5);
    expect(s.time).toBe(0);
    startWave(s);
    const total = expandWave(waveComposition(1)).length;
    run(s, 15);
    expect(s.enemies.length + s.leaked).toBe(total);
    expect(s.spawnQueue).toHaveLength(0);
  });

  it('pays the clear bonus and counts down to the next wave', () => {
    const s = createGame(MAPS[0], 'normal');
    startWave(s);
    s.spawnQueue = [];
    s.enemies = [];
    const money = s.money;
    tick(s, DT);
    expect(s.phase).toBe('countdown');
    expect(s.countdown).toBeCloseTo(COUNTDOWN);
    expect(s.money).toBe(money + waveClearBonus(1));
    run(s, COUNTDOWN + 0.1);
    expect(s.phase).toBe('wave');
    expect(s.wave).toBe(2);
  });

  it('grants an early-call bonus that shrinks as the countdown runs', () => {
    expect(earlyBonus(1, 0)).toBe(0);
    expect(earlyBonus(5, 10)).toBe(20);
    expect(earlyBonus(5, 5)).toBe(10);
    expect(earlyBonus(5, 10, 0.5)).toBe(10);
    const s = createGame(MAPS[0], 'normal');
    startWave(s);
    s.spawnQueue = [];
    s.enemies = [];
    tick(s, DT);
    const money = s.money;
    const expected = earlyBonus(1, s.countdown);
    expect(startWave(s, true)).toBe(expected);
    expect(s.money).toBe(money + expected);
    expect(s.wave).toBe(2);
  });

  it('clears the map after wave 20 and continues into endless on request', () => {
    const s = createGame(MAPS[0], 'normal');
    s.wave = WAVES_PER_MAP - 1;
    s.phase = 'countdown';
    s.countdown = 0.01;
    tick(s, DT);
    expect(s.wave).toBe(WAVES_PER_MAP);
    s.spawnQueue = [];
    s.enemies = [];
    tick(s, DT);
    expect(s.phase).toBe('cleared');
    expect(takeEvents(s).some((ev) => ev.type === 'mapCleared')).toBe(true);
    expect(canStartWave(s)).toBe(false);
    run(s, 1);
    expect(s.phase).toBe('cleared');
    continueEndless(s);
    expect(s.endless).toBe(true);
    expect(s.phase).toBe('countdown');
    run(s, COUNTDOWN + 0.1);
    expect(s.wave).toBe(WAVES_PER_MAP + 1);
    expect(s.enemies.length).toBeGreaterThan(0);
    // In endless the 'cleared' phase never returns.
    s.spawnQueue = [];
    s.enemies = [];
    tick(s, DT);
    expect(s.phase).toBe('countdown');
  });

  it('continueEndless is a no-op outside the cleared phase', () => {
    const s = createGame(MAPS[0], 'normal');
    continueEndless(s);
    expect(s.endless).toBe(false);
    expect(s.phase).toBe('ready');
  });
});

// ── Integration ─────────────────────────────────────────────────────────────

describe('integration', () => {
  it('a well-defended first wave is cleared without leaks', () => {
    const s = createGame(MAPS[0], 'normal');
    s.money = 10000;
    const [c, r] = s.geom.cells[2];
    build(s, c, r + 1, 'arrow');
    build(s, c + 1, r + 1, 'arrow');
    build(s, c + 2, r + 1, 'frost');
    build(s, c + 3, r + 1, 'cannon');
    build(s, c + 4, r + 1, 'sniper');
    startWave(s);
    runUntil(s, () => s.phase !== 'wave', 120);
    expect(s.phase).toBe('countdown');
    expect(s.lives).toBe(DIFFICULTY.normal.lives);
    expect(s.kills).toBe(expandWave(waveComposition(1)).length);
    expect(s.enemies).toHaveLength(0);
    expect(s.projectiles).toHaveLength(0);
  });

  it('with no towers the player eventually loses', () => {
    const s = createGame(MAPS[1], 'hard');
    startWave(s);
    let guard = 0;
    while (s.phase !== 'over' && guard++ < 60 * 600) tick(s, DT);
    expect(s.phase).toBe('over');
    expect(s.lives).toBe(0);
    expect(s.leaked).toBeGreaterThanOrEqual(DIFFICULTY.hard.lives);
  });

  it('never leaves dead enemies or finished projectiles behind', () => {
    const s = createGame(MAPS[2], 'normal');
    s.money = 10000;
    let built = 0;
    for (let r = 0; r < s.map.rows && built < 10; r++) {
      for (let c = 0; c < s.map.cols && built < 10; c++) {
        if (canBuild(s, c, r) && pathCoverage(s, c, r, 2.3) > 3) {
          build(s, c, r, TOWER_TYPES[built % TOWER_TYPES.length]);
          built++;
        }
      }
    }
    startWave(s);
    for (let i = 0; i < 60 * 120; i++) {
      tick(s, DT);
      for (const e of s.enemies) expect(e.hp > 0 && !e.leaked).toBe(true);
      for (const p of s.projectiles) expect(p.done).toBe(false);
      takeEvents(s);
    }
    expect(s.wave).toBeGreaterThan(1);
  });
});

// ── Strings ─────────────────────────────────────────────────────────────────

describe('strings', () => {
  it('has identical key sets in zh and en, including rules', () => {
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

  it('covers every tower, enemy and map name', () => {
    for (const t of TOWER_TYPES) {
      expect(strings.en['tower_' + t]).toBeDefined();
      expect(strings.en['towerDesc_' + t]).toBeDefined();
    }
    for (const e of Object.keys(ENEMY_DEFS)) expect(strings.en['enemy_' + e]).toBeDefined();
    for (const m of MAPS) {
      expect(strings.en['map_' + m.id]).toBeDefined();
      expect(strings.en['mapDesc_' + m.id]).toBeDefined();
    }
  });
});
