import { describe, expect, it } from 'vitest';
import {
  ARENA_W,
  CLEAR_RADIUS,
  CORE_R,
  MIN_EDGE_DIST,
  MIN_POINT_DIST,
  MODES,
  RING_MAX,
  SHIP_MARGIN,
  SLOW_DURATION,
  SLOW_SCALE,
  advanceBullets,
  applyPowerUp,
  arenaSize,
  bulletHitsCore,
  canSpawn,
  choosePattern,
  circleHit,
  clearAround,
  createEmitter,
  createWorld,
  emitVolley,
  introKey,
  isMode,
  isOutside,
  makeBullet,
  makeWall,
  moveShip,
  patternPool,
  phaseAt,
  phaseParams,
  roundTime,
  safeIntervals,
  spawnPowerUp,
  step,
  unlockedAt,
  type Bullet,
  type Mode,
  type PatternType,
  type World,
} from './logic';

const DT = 1 / 120;

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function world(mode: Mode = 'normal', seed = 1, H = 560): World {
  return createWorld(mode, ARENA_W, H, seeded(seed));
}

/** Run a world for `secs`, calling `each` after every step. */
function run(w: World, secs: number, each?: (w: World) => void): void {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n && w.alive; i++) {
    step(w, DT);
    each?.(w);
    w.events.length = 0;
  }
}

/** World at a given phase with an empty arena and no spawning. */
function atPhase(phase: number, mode: Mode = 'normal', seed = 7): World {
  const w = world(mode, seed);
  w.time = (phase - 1) * 10 + 0.5;
  w.phase = phase;
  w.intro = [];
  return w;
}

/** Fire an emitter completely (skipping the telegraph) without moving bullets. */
function fireAll(w: World, type: PatternType): ReturnType<typeof createEmitter> {
  const e = createEmitter(w, type);
  for (let k = 0; k < e.total; k++) emitVolley(w, e, k);
  return e;
}

describe('collision with the tiny core', () => {
  it('circleHit is a strict overlap test', () => {
    expect(circleHit(0, 0, 1, 1.9, 0, 1)).toBe(true);
    expect(circleHit(0, 0, 1, 2, 0, 1)).toBe(false);
    expect(circleHit(0, 0, 1, 3, 0, 1)).toBe(false);
  });

  it('only the core radius counts, not the drawn ship', () => {
    const r = 5;
    const reach = r + CORE_R;
    expect(bulletHitsCore({ x: 100 + reach - 0.1, y: 100, r }, 100, 100)).toBe(true);
    expect(bulletHitsCore({ x: 100 + reach + 0.1, y: 100, r }, 100, 100)).toBe(false);
    // A bullet brushing the wing tips (≈ 9 units from the core) is a miss.
    expect(bulletHitsCore({ x: 100 + 9 + r, y: 100, r }, 100, 100)).toBe(false);
    expect(CORE_R).toBeGreaterThanOrEqual(3);
    expect(CORE_R).toBeLessThanOrEqual(5);
  });

  it('a bullet on the core ends a normal run', () => {
    const w = world('normal');
    w.bullets.push(makeBullet(w.ship.x, w.ship.y - 2, 0, 0, 5, 'aim'));
    step(w, DT);
    expect(w.alive).toBe(false);
    expect(w.events.some((e) => e.type === 'death')).toBe(true);
  });

  it('a bullet passing just outside the core is a graze, counted once', () => {
    const w = world('normal');
    w.bullets.push(makeBullet(w.ship.x + 5 + CORE_R + 4, w.ship.y, 0, 0, 5, 'pat'));
    step(w, DT);
    step(w, DT);
    expect(w.alive).toBe(true);
    expect(w.grazes).toBe(1);
  });
});

describe('modes, lives and invulnerability', () => {
  it('easy has 3 lives with 1.5 s invulnerability; normal and hard have one', () => {
    expect(MODES.easy.lives).toBe(3);
    expect(MODES.easy.hitInvuln).toBe(1.5);
    expect(MODES.normal.lives).toBe(1);
    expect(MODES.hard.lives).toBe(1);
    expect(MODES.hard.homing).toBe(true);
    expect(MODES.normal.homing).toBe(false);
    expect(MODES.easy.speedMul).toBeLessThan(MODES.normal.speedMul);
    expect(MODES.hard.speedMul).toBeGreaterThan(MODES.normal.speedMul);
  });

  it('easy: a hit costs a life, grants invulnerability and clears nearby bullets', () => {
    const w = world('easy');
    w.bullets.push(makeBullet(w.ship.x, w.ship.y, 0, 0, 5, 'aim'));
    w.bullets.push(makeBullet(w.ship.x + 40, w.ship.y, 0, 0, 5, 'pat'));
    w.bullets.push(makeBullet(w.ship.x + CLEAR_RADIUS + 30, w.ship.y, 0, 0, 5, 'pat'));
    step(w, DT);
    expect(w.alive).toBe(true);
    expect(w.lives).toBe(2);
    expect(w.invuln).toBeGreaterThan(1.4);
    expect(w.bullets.length).toBe(1);
    // While invulnerable, a bullet on the core does nothing.
    w.bullets.push(makeBullet(w.ship.x, w.ship.y, 0, 0, 5, 'aim'));
    run(w, 1.0);
    expect(w.lives).toBe(2);
  });

  it('easy: three hits end the run', () => {
    const w = world('easy');
    for (let i = 0; i < 3; i++) {
      w.invuln = 0;
      w.bullets.push(makeBullet(w.ship.x, w.ship.y, 0, 0, 5, 'aim'));
      step(w, DT);
    }
    expect(w.lives).toBe(0);
    expect(w.alive).toBe(false);
  });

  it('isMode validates stored values', () => {
    expect(isMode('easy')).toBe(true);
    expect(isMode('hard')).toBe(true);
    expect(isMode('medium')).toBe(false);
    expect(isMode(null)).toBe(false);
  });
});

describe('phases', () => {
  it('advance every 10 seconds', () => {
    expect(phaseAt(0)).toBe(1);
    expect(phaseAt(9.99)).toBe(1);
    expect(phaseAt(10)).toBe(2);
    expect(phaseAt(35)).toBe(4);
    expect(phaseAt(-3)).toBe(1);
  });

  it('emits a phase event when the clock crosses a boundary', () => {
    const w = world('normal');
    w.god = true;
    const phases: number[] = [];
    run(w, 21, (ww) => ww.events.forEach((e) => e.type === 'phase' && phases.push(e.phase)));
    expect(phases).toEqual([2, 3]);
    expect(w.phase).toBe(3);
  });

  it('scale up speed and density, with caps', () => {
    const cfg = MODES.normal;
    let prev = phaseParams(1, cfg);
    for (let p = 2; p <= 30; p++) {
      const cur = phaseParams(p, cfg);
      expect(cur.speed).toBeGreaterThanOrEqual(prev.speed);
      expect(cur.interval).toBeLessThanOrEqual(prev.interval);
      expect(cur.ring).toBeGreaterThanOrEqual(prev.ring);
      expect(cur.wallGap).toBeLessThanOrEqual(prev.wallGap);
      expect(cur.maxActive).toBeGreaterThanOrEqual(prev.maxActive);
      prev = cur;
    }
    const late = phaseParams(100, cfg);
    expect(late.speed).toBeLessThanOrEqual(1.85);
    expect(late.interval).toBeGreaterThanOrEqual(0.7);
    expect(late.ring).toBeLessThanOrEqual(RING_MAX);
    expect(late.wallGap).toBeGreaterThanOrEqual(36);
    expect(late.arms).toBeLessThanOrEqual(6);
    expect(phaseParams(1, cfg).sniperInterval).toBe(Infinity);
    expect(Number.isFinite(phaseParams(cfg.sniperFrom, cfg).sniperInterval)).toBe(true);
  });

  it('hard is faster and denser than normal, easy gentler', () => {
    for (const p of [1, 4, 9]) {
      const e = phaseParams(p, MODES.easy);
      const n = phaseParams(p, MODES.normal);
      const h = phaseParams(p, MODES.hard);
      expect(e.speed).toBeLessThan(n.speed);
      expect(h.speed).toBeGreaterThan(n.speed);
      expect(e.interval).toBeGreaterThan(n.interval);
      expect(h.interval).toBeLessThan(n.interval);
    }
  });

  it('unlock new patterns phase by phase; homing orbs only on hard', () => {
    const types = (p: number, m: Mode) => patternPool(p, MODES[m]).map((x) => x.type);
    expect(types(1, 'normal').sort()).toEqual(['aimed', 'radial']);
    expect(types(2, 'normal')).toContain('wallH');
    expect(types(3, 'normal')).toEqual(expect.arrayContaining(['spiral', 'fan']));
    expect(types(3, 'normal')).not.toContain('homing');
    expect(types(3, 'hard')).toContain('homing');
    expect(types(4, 'easy')).toEqual(expect.arrayContaining(['bounce', 'wallV']));
    expect(types(50, 'easy')).not.toContain('homing');
    expect(unlockedAt(3, MODES.hard)).toContain('homing');
    expect(unlockedAt(3, MODES.normal)).not.toContain('homing');
    expect(introKey(2, MODES.normal)).toBe('introWalls');
    expect(introKey(3, MODES.hard)).toBe('introSpiralsHoming');
    expect(introKey(12, MODES.normal)).toBe('introFaster');
  });

  it('shows a newly unlocked pattern first', () => {
    const w = atPhase(2);
    w.intro = ['wallH'];
    expect(choosePattern(w)).toBe('wallH');
    expect(w.intro).toEqual([]);
  });
});

describe('spawner patterns', () => {
  it('radial burst emits the phase ring count at the phase speed', () => {
    for (const p of [1, 3, 8]) {
      const w = atPhase(p);
      const pp = phaseParams(p, w.cfg);
      const e = createEmitter(w, 'radial');
      emitVolley(w, e, 0);
      expect(w.bullets.length).toBe(pp.ring);
      for (const b of w.bullets) {
        expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(118 * pp.speed, 6);
        expect(b.kind).toBe('pat');
      }
    }
  });

  it('radial rings from phase 5 are doubled and stay passable at spawn distance', () => {
    const w = atPhase(5);
    const e = fireAll(w, 'radial');
    expect(e.total).toBe(2);
    expect(w.bullets.length).toBe(2 * phaseParams(5, w.cfg).ring);
    // Arc gap between neighbours at the minimum spawn distance is wider than the core.
    const late = phaseParams(99, MODES.hard);
    const arc = (2 * Math.PI * MIN_POINT_DIST) / late.ring - 2 * e.r;
    expect(arc).toBeGreaterThan(2 * CORE_R + 4);
  });

  it('aimed shots fly at the ship with the phase speed', () => {
    const w = atPhase(2);
    const pp = phaseParams(2, w.cfg);
    const e = createEmitter(w, 'aimed');
    expect(e.total).toBe(pp.aimedShots);
    emitVolley(w, e, 0);
    const b = w.bullets[0];
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(175 * pp.speed, 6);
    const toShip = Math.atan2(w.ship.y - e.y, w.ship.x - e.x);
    expect(Math.atan2(b.vy, b.vx)).toBeCloseTo(toShip, 6);
    expect(b.kind).toBe('aim');
  });

  it('fans spread symmetrically around the ship direction', () => {
    const w = atPhase(6);
    const pp = phaseParams(6, w.cfg);
    const e = createEmitter(w, 'fan');
    emitVolley(w, e, 0);
    expect(w.bullets.length).toBe(pp.fanCount);
    const toShip = Math.atan2(w.ship.y - e.y, w.ship.x - e.x);
    const angles = w.bullets.map((b) => Math.atan2(b.vy, b.vx) - toShip);
    const mean = angles.reduce((a, b) => a + b, 0) / angles.length;
    expect(mean).toBeCloseTo(0, 6);
  });

  it('spiral arms match the phase and leave slip-through spacing', () => {
    const w = atPhase(7);
    w.ship = { x: 180, y: 520 };
    const pp = phaseParams(7, w.cfg);
    const e = createEmitter(w, 'spiral');
    expect(e.count).toBe(pp.arms);
    emitVolley(w, e, 0);
    expect(w.bullets.length).toBe(pp.arms);
    // Spacing along one arm: speed × interval.
    expect(e.speed * e.interval).toBeGreaterThanOrEqual(22 - 1e-9);
    // Emit everything while moving bullets like the real emitter does.
    w.bullets.length = 0;
    w.emitters = [e];
    w.spawnCd = w.sniperCd = w.powerCd = 1e9;
    w.god = true;
    e.t = e.delay;
    for (let i = 0; i < 600 && w.emitters.length; i++) {
      step(w, DT);
      w.events.length = 0;
    }
    const far = w.bullets.filter((b) => b.wall === 0 && Math.hypot(b.x - e.x, b.y - e.y) > 40);
    expect(far.length).toBeGreaterThan(20);
    let minD = Infinity;
    for (let i = 0; i < far.length; i++)
      for (let j = i + 1; j < far.length; j++) minD = Math.min(minD, Math.hypot(far[i].x - far[j].x, far[i].y - far[j].y));
    expect(minD).toBeGreaterThan(2 * e.r + 2 * CORE_R);
  });

  it('bouncers reflect off the arena exactly once', () => {
    const w = world();
    const b = makeBullet(10, 200, -100, 0, 5, 'pat');
    b.bounces = 1;
    w.bullets.push(b);
    advanceBullets(w, 0.1);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.bounces).toBe(0);
    expect(b.x).toBeGreaterThanOrEqual(b.r);
    // Second contact with an edge: it leaves and is culled.
    b.vx = -300;
    for (let i = 0; i < 60; i++) advanceBullets(w, 1 / 60);
    expect(w.bullets.length).toBe(0);
  });

  it('bounce pattern bullets start with one bounce, homing orbs steer', () => {
    const w = atPhase(5, 'hard');
    fireAll(w, 'bounce');
    expect(w.bullets.length).toBe(phaseParams(5, w.cfg).bounceCount);
    expect(w.bullets.every((b) => b.bounces === 1)).toBe(true);

    const h = atPhase(4, 'hard');
    h.ship = { x: 300, y: 500 };
    const orb = makeBullet(60, 100, 70, 0, 8, 'orb');
    orb.homing = 5;
    orb.turn = 1.4;
    h.bullets.push(orb);
    const before = Math.atan2(orb.vy, orb.vx);
    advanceBullets(h, 0.5);
    const after = Math.atan2(orb.vy, orb.vx);
    expect(after).toBeGreaterThan(before); // turned towards the ship (downwards)
    expect(after - before).toBeLessThanOrEqual(1.4 * 0.5 + 1e-9);
    expect(Math.hypot(orb.vx, orb.vy)).toBeCloseTo(70, 6);
  });

  it('point patterns are placed away from the ship, edge spawners too', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = atPhase(5, 'normal', seed);
      w.ship = { x: 40 + (seed * 37) % 280, y: 80 + (seed * 53) % 420 };
      const r = createEmitter(w, 'radial');
      expect(Math.hypot(r.x - w.ship.x, r.y - w.ship.y)).toBeGreaterThanOrEqual(MIN_POINT_DIST);
      const a = createEmitter(w, 'aimed');
      expect(Math.hypot(a.x - w.ship.x, a.y - w.ship.y)).toBeGreaterThanOrEqual(MIN_EDGE_DIST);
      expect(r.delay).toBeGreaterThanOrEqual(0.3);
      expect(a.delay).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('phase 1 spawners only use the top edge', () => {
    const w = atPhase(1);
    for (let i = 0; i < 30; i++) expect(createEmitter(w, 'aimed').y).toBe(0);
  });
});

describe('bullet walls', () => {
  const spanOf = (bs: Bullet[], axis: 'h' | 'v') => bs.map((b) => (axis === 'h' ? b.x : b.y));

  it('contain exactly one passable opening of at least the configured width', () => {
    for (const axis of ['h', 'v'] as const) {
      for (const gapW of [36, 45, 58]) {
        const L = axis === 'h' ? 360 : 560;
        for (const gc of [SHIP_MARGIN + gapW / 2 + 4, L / 2, L - SHIP_MARGIN - gapW / 2 - 4, 123.4]) {
          const wall = makeWall(axis, 360, 560, gc, gapW, 90, 1, 5);
          const safe = safeIntervals(spanOf(wall, axis), 5, SHIP_MARGIN, L - SHIP_MARGIN);
          expect(safe.length).toBe(1);
          const [a, b] = safe[0];
          expect(b - a).toBeGreaterThanOrEqual(gapW - 2 * CORE_R - 1e-6);
          expect(a).toBeLessThanOrEqual(gc);
          expect(b).toBeGreaterThanOrEqual(gc);
        }
      }
    }
  });

  it('without a gap there is no hole anywhere (including the arena edges)', () => {
    const wall = makeWall('h', 360, 560, -1000, 40, 90, 1, 5);
    expect(safeIntervals(spanOf(wall, 'h'), 5, SHIP_MARGIN, 360 - SHIP_MARGIN)).toEqual([]);
  });

  it('enter from outside the arena and move inward', () => {
    const top = makeWall('h', 360, 560, 180, 50, 90, 1, 5);
    expect(top.every((b) => b.y < 0 && b.vy > 0 && b.wall === 1)).toBe(true);
    const right = makeWall('v', 360, 560, 280, 50, 80, -1, 5);
    expect(right.every((b) => b.x > 360 && b.vx < 0 && b.wall === 2)).toBe(true);
  });

  it('pattern walls keep their gaps inside the reachable arena, double walls shift the gap', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const w = atPhase(7, 'hard', seed);
      const e = createEmitter(w, seed % 2 ? 'wallH' : 'wallV');
      const L = e.type === 'wallH' ? w.W : w.H;
      expect(e.gaps.length).toBe(2);
      for (const g of e.gaps) {
        expect(g - e.gapW / 2).toBeGreaterThanOrEqual(SHIP_MARGIN);
        expect(g + e.gapW / 2).toBeLessThanOrEqual(L - SHIP_MARGIN);
      }
      expect(Math.abs(e.gaps[1] - e.gaps[0])).toBeGreaterThanOrEqual(40 - 1e-9);
      expect(Math.abs(e.gaps[1] - e.gaps[0])).toBeLessThanOrEqual(140 + 1e-9);
    }
  });

  it('vertical walls come from the side farther from the ship', () => {
    const w = atPhase(5);
    w.ship = { x: 40, y: 300 };
    expect(createEmitter(w, 'wallV').dir).toBe(-1);
    w.ship = { x: 320, y: 300 };
    expect(createEmitter(w, 'wallV').dir).toBe(1);
  });

  it('never crosses a horizontal wall with a vertical one', () => {
    const w = atPhase(6);
    w.bullets.push(...makeWall('h', w.W, w.H, 180, 50, 90, 1, 5));
    w.lastWallAt = -99;
    expect(canSpawn(w, 'wallV')).toBe(false);
    expect(canSpawn(w, 'wallH')).toBe(true);
    w.bullets.length = 0;
    w.bullets.push(...makeWall('v', w.W, w.H, 200, 50, 90, 1, 5));
    expect(canSpawn(w, 'wallH')).toBe(false);
    w.bullets.length = 0;
    expect(canSpawn(w, 'wallH')).toBe(true);
    w.lastWallAt = w.time - 1;
    expect(canSpawn(w, 'wallH')).toBe(false);
  });
});

describe('culling', () => {
  it('isOutside only past the margin', () => {
    expect(isOutside({ x: 180, y: 280, r: 5 }, 360, 560)).toBe(false);
    expect(isOutside({ x: -7, y: 280, r: 5 }, 360, 560)).toBe(false);
    expect(isOutside({ x: -40, y: 280, r: 5 }, 360, 560)).toBe(true);
    expect(isOutside({ x: 180, y: 600, r: 5 }, 360, 560)).toBe(true);
  });

  it('removes bullets that left the arena and keeps entering ones', () => {
    const w = world();
    w.bullets.push(makeBullet(180, 550, 0, 300, 5, 'pat')); // leaving at the bottom
    w.bullets.push(...makeWall('h', w.W, w.H, 180, 50, 90, 1, 5)); // entering at the top
    const wallCount = w.bullets.length - 1;
    for (let i = 0; i < 30; i++) advanceBullets(w, 1 / 60);
    expect(w.bullets.length).toBe(wallCount);
    for (let i = 0; i < 60 * 8; i++) advanceBullets(w, 1 / 60);
    expect(w.bullets.length).toBe(0);
  });

  it('drops anything older than the age cap', () => {
    const w = world();
    w.bullets.push(makeBullet(180, 280, 0, 0, 5, 'pat'));
    advanceBullets(w, 26);
    expect(w.bullets.length).toBe(0);
  });
});

describe('power-ups', () => {
  it('shield absorbs one hit, then the next hit ends the run', () => {
    const w = world('normal');
    applyPowerUp(w, 'shield');
    expect(w.shield).toBe(true);
    w.bullets.push(makeBullet(w.ship.x, w.ship.y, 0, 0, 5, 'aim'));
    step(w, DT);
    expect(w.alive).toBe(true);
    expect(w.shield).toBe(false);
    expect(w.invuln).toBeGreaterThan(0.9);
    expect(w.bullets.length).toBe(0);
    w.invuln = 0;
    w.bullets.push(makeBullet(w.ship.x, w.ship.y, 0, 0, 5, 'aim'));
    step(w, DT);
    expect(w.alive).toBe(false);
  });

  it('slow-mo slows bullets for 3 seconds, the clock keeps running', () => {
    const w = world('normal');
    w.spawnCd = 1e9;
    w.powerCd = 1e9;
    applyPowerUp(w, 'slow');
    expect(w.slowLeft).toBe(SLOW_DURATION);
    run(w, 0.8); // let the time scale ease in
    expect(w.timeScale).toBeCloseTo(SLOW_SCALE, 2);
    const b = makeBullet(20, 20, 100, 0, 4, 'pat');
    w.bullets.push(b);
    const t0 = w.time;
    run(w, 1);
    expect(w.time - t0).toBeCloseTo(1, 6);
    expect(b.x - 20).toBeCloseTo(100 * SLOW_SCALE, 0);
    let ended = false;
    run(w, 2, (ww) => ww.events.forEach((e) => e.type === 'slowEnd' && (ended = true)));
    expect(ended).toBe(true);
    expect(w.slowLeft).toBe(0);
    run(w, 1);
    expect(w.timeScale).toBe(1);
  });

  it('spawn on schedule, can be picked up, and expire', () => {
    const w = world('normal', 3);
    w.god = true;
    let spawned = 0;
    run(w, 12, (ww) => ww.events.forEach((e) => e.type === 'powerSpawn' && spawned++));
    expect(spawned).toBe(1);
    const p = w.powerups[0];
    expect(p).toBeDefined();
    w.ship.x = p.x;
    w.ship.y = p.y;
    const picked: string[] = [];
    run(w, DT, (ww) => ww.events.forEach((e) => e.type === 'pickup' && picked.push(e.kind)));
    expect(picked).toEqual([p.kind]);
    expect(w.powerups.length).toBe(0);
    expect(w.pickups).toBe(1);

    const x = world('normal', 4);
    const q = spawnPowerUp(x);
    x.ship = { x: q.x > 180 ? 10 : 350, y: q.y > 280 ? 10 : 550 };
    q.vx = 0;
    q.vy = 0;
    x.spawnCd = 1e9;
    let expired = false;
    run(x, 8.5, (ww) => ww.events.forEach((e) => e.type === 'powerExpire' && (expired = true)));
    expect(expired).toBe(true);
  });

  it('a shield power-up is never offered while a shield is up', () => {
    const w = world('normal', 9);
    w.shield = true;
    for (let i = 0; i < 20; i++) {
      w.powerups.length = 0;
      expect(spawnPowerUp(w).kind).toBe('slow');
    }
  });

  it('clearAround wipes only bullets near the ship', () => {
    const w = world();
    w.bullets.push(makeBullet(w.ship.x + 10, w.ship.y, 0, 0, 5, 'pat'), makeBullet(w.ship.x + 200, w.ship.y, 0, 0, 5, 'pat'));
    expect(clearAround(w)).toBe(1);
    expect(w.bullets.length).toBe(1);
  });
});

describe('ship movement and arena', () => {
  it('moveShip clamps to the arena', () => {
    const w = world();
    moveShip(w, -1000, -1000);
    expect(w.ship).toEqual({ x: SHIP_MARGIN, y: SHIP_MARGIN });
    moveShip(w, 5000, 5000);
    expect(w.ship).toEqual({ x: w.W - SHIP_MARGIN, y: w.H - SHIP_MARGIN });
    moveShip(w, NaN, 3);
    expect(w.ship).toEqual({ x: w.W - SHIP_MARGIN, y: w.H - SHIP_MARGIN });
  });

  it('arenaSize keeps a fixed width and a bounded height', () => {
    expect(arenaSize(390, 607)).toEqual({ W: 360, H: 560 });
    expect(arenaSize(1024, 700).H).toBe(520);
    expect(arenaSize(320, 900).H).toBe(700);
    expect(arenaSize(0, 0).H).toBeGreaterThanOrEqual(520);
  });

  it('roundTime keeps hundredths', () => {
    expect(roundTime(12.3456)).toBe(12.35);
    expect(roundTime(-1)).toBe(0);
  });
});

describe('full simulation', () => {
  it('is deterministic for a seed', () => {
    const a = world('hard', 42);
    const b = world('hard', 42);
    a.god = b.god = true;
    run(a, 30);
    run(b, 30);
    expect(a.bullets.length).toBe(b.bullets.length);
    expect(a.bullets.map((x) => x.x + x.y)).toEqual(b.bullets.map((x) => x.x + x.y));
  });

  it('a ship that never moves is eventually hit (no camping)', () => {
    for (const mode of ['easy', 'normal', 'hard'] as Mode[]) {
      const w = world(mode, 11);
      run(w, 180);
      expect(w.alive).toBe(false);
    }
  });

  it('stays bounded and numerically sane for minutes in every mode', () => {
    for (const mode of ['easy', 'normal', 'hard'] as Mode[]) {
      const w = world(mode, 5);
      w.god = true;
      let maxBullets = 0;
      const seen = new Set<PatternType>();
      let t = 0;
      run(w, 241, (ww) => {
        t += DT;
        // Wander around so aimed patterns get varied angles.
        moveShip(ww, Math.sin(t * 0.9) * 2, Math.cos(t * 0.7) * 2);
        maxBullets = Math.max(maxBullets, ww.bullets.length);
        ww.events.forEach((e) => e.type === 'emit' && seen.add(e.pattern));
      });
      expect(w.alive).toBe(true);
      expect(w.phase).toBe(25);
      expect(maxBullets).toBeLessThanOrEqual(700);
      expect(maxBullets).toBeGreaterThan(50);
      for (const b of w.bullets) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      }
      const expected: PatternType[] = ['aimed', 'radial', 'wallH', 'spiral', 'fan', 'bounce', 'wallV'];
      if (mode === 'hard') expected.push('homing');
      for (const p of expected) expect(seen.has(p)).toBe(true);
      if (mode !== 'hard') expect(seen.has('homing')).toBe(false);
    }
  });

  it('never spawns a point pattern on top of the ship and never crosses walls', () => {
    const w = world('hard', 21);
    w.god = true;
    let t = 0;
    let checked = 0;
    run(w, 150, (ww) => {
      t += DT;
      moveShip(ww, Math.sin(t * 1.3) * 3, Math.cos(t * 0.8) * 3);
      for (const e of ww.emitters) {
        if (e.t <= DT * ww.timeScale + 1e-9 && (e.type === 'radial' || e.type === 'spiral')) {
          checked++;
          expect(Math.hypot(e.x - ww.ship.x, e.y - ww.ship.y)).toBeGreaterThanOrEqual(MIN_POINT_DIST - 4);
        }
      }
      let h = 0;
      let v = 0;
      for (const b of ww.bullets) {
        if (b.wall === 1) h++;
        else if (b.wall === 2) v++;
      }
      expect(h > 0 && v > 0).toBe(false);
    });
    expect(checked).toBeGreaterThan(10);
  });
});
