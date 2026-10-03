import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_LEVELS,
  DT,
  FEET,
  FOOT_Y,
  HULL,
  MAX_TILT,
  MAX_VX,
  MAX_VY,
  PAD_GAP,
  PAD_MARGIN,
  PAD_WIDTHS,
  READY_TIME,
  ROT_SPEED,
  THRUST,
  WORLD_W,
  altitudeAbove,
  checkContact,
  createLander,
  createLevel,
  currentWind,
  evaluateLanding,
  fuelRateFor,
  generateTerrain,
  heightAt,
  hullHits,
  levelConfig,
  levelScore,
  normalizeAngle,
  optimalBurnTime,
  padsFor,
  rng,
  settle,
  stepLander,
  stepLevel,
  toWorld,
  zoomFor,
  type Input,
  type Lander,
  type Level,
  type Terrain,
} from './logic';

const NO_INPUT: Input = { thrust: false, rot: 0 };
const BURN: Input = { thrust: true, rot: 0 };

function flatTerrain(padY = 20, x0 = 60, mult = 2): Terrain {
  const x1 = x0 + PAD_WIDTHS[mult];
  return {
    width: WORLD_W,
    points: [
      { x: 0, y: padY },
      { x: x0, y: padY },
      { x: x1, y: padY },
      { x: WORLD_W, y: padY },
    ],
    pads: [{ x0, x1, y: padY, mult }],
  };
}

function run(l: Lander, input: Input, seconds: number, gravity = 1.6, wind = 0, fuelRate = 5): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) stepLander(l, input, gravity, wind, fuelRate);
}

describe('levelConfig', () => {
  it('escalates gravity, roughness and start speed while tightening fuel across the campaign', () => {
    for (let n = 2; n <= CAMPAIGN_LEVELS; n++) {
      const a = levelConfig(n - 1);
      const b = levelConfig(n);
      expect(b.gravity).toBeGreaterThan(a.gravity);
      expect(b.roughness).toBeGreaterThan(a.roughness);
      expect(b.fuelMargin).toBeLessThan(a.fuelMargin);
      expect(b.startVx).toBeGreaterThanOrEqual(a.startVx);
    }
    expect(levelConfig(1).gravity).toBeCloseTo(1.6, 5);
    expect(levelConfig(10).gravity).toBeCloseTo(3.0, 5);
  });

  it('has no wind before level 6 and light wind from level 6', () => {
    for (let n = 1; n <= 5; n++) expect(levelConfig(n).wind).toBe(0);
    for (let n = 6; n <= 12; n++) {
      expect(levelConfig(n).wind).toBeGreaterThan(0);
      expect(levelConfig(n).wind).toBeLessThanOrEqual(0.55);
    }
  });

  it('keeps thrust above gravity even in endless mode', () => {
    for (let n = 1; n <= 60; n++) expect(levelConfig(n).gravity).toBeLessThan(THRUST - 1.5);
  });

  it('uses fewer / narrower pads later and always at least one pad', () => {
    expect(padsFor(1)).toEqual([1, 2, 3]);
    expect(padsFor(10)).toEqual([3, 3]);
    expect(padsFor(4).length).toBeLessThan(padsFor(1).length);
    for (let n = 1; n <= 30; n++) {
      const pads = padsFor(n);
      expect(pads.length).toBeGreaterThan(0);
      pads.forEach((m) => expect([1, 2, 3]).toContain(m));
    }
    expect(levelConfig(0).level).toBe(1);
    expect(levelConfig(2.7).level).toBe(2);
  });
});

describe('fuel budget', () => {
  it('optimal burn time grows with gravity and height', () => {
    expect(optimalBurnTime(1.6, 100)).toBeLessThan(optimalBurnTime(3.0, 100));
    expect(optimalBurnTime(1.6, 50)).toBeLessThan(optimalBurnTime(1.6, 100));
  });
  it('fuel rate leaves a positive margin over the optimal burn', () => {
    for (let n = 1; n <= 15; n++) {
      const cfg = levelConfig(n);
      const rate = fuelRateFor(cfg, 95);
      const burnSeconds = 100 / rate;
      expect(rate).toBeGreaterThan(0);
      expect(burnSeconds).toBeGreaterThan(optimalBurnTime(cfg.gravity, 95) * 1.3);
    }
  });
});

describe('generateTerrain', () => {
  it('is deterministic for a seed and spans the level with increasing x', () => {
    const cfg = levelConfig(3);
    const a = generateTerrain(cfg, rng(42));
    const b = generateTerrain(cfg, rng(42));
    expect(a).toEqual(b);
    expect(a.points[0].x).toBe(0);
    expect(a.points[a.points.length - 1].x).toBeCloseTo(WORLD_W, 9);
    for (let i = 1; i < a.points.length; i++) expect(a.points[i].x).toBeGreaterThan(a.points[i - 1].x);
  });

  it('contains every requested pad as an exactly flat segment of the right width', () => {
    for (let n = 1; n <= 14; n++) {
      for (let seed = 1; seed <= 20; seed++) {
        const cfg = levelConfig(n);
        const t = generateTerrain(cfg, rng(seed * 1000 + n));
        expect(t.pads.map((p) => p.mult).sort()).toEqual(cfg.pads.slice().sort());
        for (const p of t.pads) {
          expect(p.x1 - p.x0).toBeCloseTo(PAD_WIDTHS[p.mult], 9);
          const i0 = t.points.findIndex((q) => q.x === p.x0);
          expect(i0).toBeGreaterThanOrEqual(0);
          expect(t.points[i0 + 1].x).toBe(p.x1);
          expect(t.points[i0].y).toBe(p.y);
          expect(t.points[i0 + 1].y).toBe(p.y);
          // interior samples are flat too
          for (let k = 0; k <= 10; k++) expect(heightAt(t, p.x0 + ((p.x1 - p.x0) * k) / 10)).toBeCloseTo(p.y, 9);
          expect(p.x0).toBeGreaterThanOrEqual(PAD_MARGIN);
          expect(p.x1).toBeLessThanOrEqual(WORLD_W - PAD_MARGIN);
        }
        for (let i = 1; i < t.pads.length; i++) expect(t.pads[i].x0 - t.pads[i - 1].x1).toBeGreaterThanOrEqual(PAD_GAP - 1e-9);
      }
    }
  });

  it('raises walls at both edges and keeps the interior within bounds', () => {
    const t = generateTerrain(levelConfig(5), rng(7));
    expect(heightAt(t, 0)).toBeGreaterThan(100);
    expect(heightAt(t, WORLD_W)).toBeGreaterThan(100);
    for (const p of t.points) {
      if (p.x > 20 && p.x < WORLD_W - 20) {
        expect(p.y).toBeGreaterThanOrEqual(6);
        expect(p.y).toBeLessThanOrEqual(57);
      }
    }
    expect(heightAt(t, -1)).toBe(Infinity);
    expect(heightAt(t, WORLD_W + 1)).toBe(Infinity);
  });

  it('interpolates heights between vertices', () => {
    const t: Terrain = { width: WORLD_W, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: WORLD_W, y: 10 }], pads: [] };
    expect(heightAt(t, 5)).toBeCloseTo(5, 9);
    expect(heightAt(t, 7.5)).toBeCloseTo(7.5, 9);
    expect(heightAt(t, 50)).toBe(10);
  });
});

describe('stepLander physics', () => {
  it('free-falls under gravity with the expected kinematics', () => {
    const l = createLander(50, 100, 0);
    run(l, NO_INPUT, 1, 1.6);
    expect(l.vy).toBeCloseTo(-1.6, 3);
    // y ≈ y0 - g t² / 2 (semi-implicit Euler is slightly ahead of the closed form)
    expect(l.y).toBeLessThan(100 - 0.8 + 0.001);
    expect(l.y).toBeGreaterThan(100 - 0.8 - 0.03);
    expect(l.x).toBe(50);
    expect(l.fuel).toBe(100);
  });

  it('accelerates upward when thrusting upright and burns fuel at the given rate', () => {
    const l = createLander(50, 100, 0);
    run(l, BURN, 2, 1.6, 0, 10);
    expect(l.vy).toBeCloseTo((THRUST - 1.6) * 2, 3);
    expect(l.fuel).toBeCloseTo(80, 6);
    expect(l.thrusting).toBe(true);
  });

  it('thrust pushes sideways in the direction of the tilt', () => {
    const r = createLander(50, 100, 0);
    r.angle = 0.3;
    run(r, BURN, 1);
    expect(r.vx).toBeGreaterThan(0);
    const left = createLander(50, 100, 0);
    left.angle = -0.3;
    run(left, BURN, 1);
    expect(left.vx).toBeLessThan(0);
    expect(left.vx).toBeCloseTo(-r.vx, 9);
  });

  it('rotation input produces bounded angular velocity and stops when released', () => {
    const l = createLander(50, 100, 0);
    run(l, { thrust: false, rot: 1 }, 1);
    expect(l.angVel).toBeCloseTo(ROT_SPEED, 3);
    expect(l.angle).toBeGreaterThan(ROT_SPEED * 0.85);
    expect(l.angle).toBeLessThanOrEqual(ROT_SPEED + 1e-9);
    run(l, { thrust: false, rot: -1 }, 1);
    expect(l.angVel).toBeCloseTo(-ROT_SPEED, 3);
    run(l, NO_INPUT, 1);
    expect(Math.abs(l.angVel)).toBeLessThan(1e-4);
    // input is clamped
    const m = createLander(0, 0, 0);
    run(m, { thrust: false, rot: 5 }, 1);
    expect(m.angVel).toBeCloseTo(ROT_SPEED, 3);
  });

  it('runs dry: fuel never goes negative and the engine stops producing thrust', () => {
    const l = createLander(50, 100, 0);
    run(l, BURN, 3, 1.6, 0, 50); // 2 s of fuel
    expect(l.fuel).toBe(0);
    expect(l.thrusting).toBe(false);
    const vyBefore = l.vy;
    run(l, BURN, 1, 1.6, 0, 50);
    expect(l.vy).toBeCloseTo(vyBefore - 1.6, 3);
  });

  it('wind accelerates the lander horizontally', () => {
    const l = createLander(50, 100, 0);
    run(l, NO_INPUT, 2, 1.6, -0.4);
    expect(l.vx).toBeCloseTo(-0.8, 3);
  });

  it('toWorld lowers the right foot when tilted right', () => {
    const l = createLander(0, 0, 0);
    l.angle = 0.2;
    const [lf, rf] = FEET.map((p) => toWorld(l, p));
    expect(rf.y).toBeLessThan(lf.y);
    expect(rf.x).toBeGreaterThan(lf.x);
    l.angle = 0;
    expect(toWorld(l, [0, 2]).y).toBeCloseTo(2, 9);
  });
});

describe('landing rules', () => {
  const terrain = flatTerrain(20, 60, 2);
  const onPad = (): Lander => {
    const l = createLander(67, 20 - FOOT_Y, 0);
    l.vy = -1;
    return l;
  };

  it('accepts a gentle, level touchdown with both feet on the pad', () => {
    const r = evaluateLanding(onPad(), terrain);
    expect(r.ok).toBe(true);
    expect(r.pad?.mult).toBe(2);
    expect(r.reasons).toEqual([]);
  });

  it('rejects excessive vertical speed', () => {
    const l = onPad();
    l.vy = -(MAX_VY + 0.1);
    expect(evaluateLanding(l, terrain).reasons).toEqual(['vspeed']);
    l.vy = -MAX_VY;
    expect(evaluateLanding(l, terrain).ok).toBe(true);
  });

  it('rejects excessive horizontal speed', () => {
    const l = onPad();
    l.vx = MAX_VX + 0.1;
    expect(evaluateLanding(l, terrain).reasons).toEqual(['hspeed']);
    l.vx = -(MAX_VX + 0.1);
    expect(evaluateLanding(l, terrain).reasons).toEqual(['hspeed']);
  });

  it('rejects too much tilt (both directions, including wrapped angles)', () => {
    const l = onPad();
    l.angle = MAX_TILT + 0.01;
    expect(evaluateLanding(l, terrain).reasons).toEqual(['tilt']);
    l.angle = -(MAX_TILT + 0.01);
    expect(evaluateLanding(l, terrain).reasons).toEqual(['tilt']);
    l.angle = Math.PI * 2 + 0.05;
    expect(evaluateLanding(l, terrain).ok).toBe(true);
    expect(normalizeAngle(Math.PI * 2 + 0.05)).toBeCloseTo(0.05, 9);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 9);
  });

  it('rejects when one foot is off the pad or when landing on rough ground', () => {
    const l = onPad();
    l.x = 60 + 1; // left foot at 58 < pad start 60
    expect(evaluateLanding(l, terrain).reasons).toEqual(['offPad']);
    l.x = 30;
    expect(evaluateLanding(l, terrain).reasons).toEqual(['terrain']);
  });

  it('lists every violated rule', () => {
    const l = onPad();
    l.x = 30;
    l.vx = 3;
    l.vy = -5;
    l.angle = 0.5;
    expect(evaluateLanding(l, terrain).reasons).toEqual(['terrain', 'vspeed', 'hspeed', 'tilt']);
  });
});

describe('collision', () => {
  const terrain = flatTerrain(20, 60, 1);

  it('reports no contact in the air', () => {
    expect(checkContact(createLander(70, 60, 0), terrain)).toEqual({ kind: 'none' });
    expect(hullHits(createLander(70, 60, 0), terrain)).toBe(false);
  });

  it('lands when the feet reach the pad gently', () => {
    const l = createLander(70, 20 - FOOT_Y - 0.01, 0);
    l.vy = -1;
    const c = checkContact(l, terrain);
    expect(c.kind).toBe('landed');
  });

  it('crashes when the hull hits the ground (e.g. upside down)', () => {
    const l = createLander(70, 20 + 1, 0);
    l.angle = Math.PI; // feet point up, hull in the ground
    const c = checkContact(l, terrain);
    expect(c.kind).toBe('crashed');
    expect(c.kind === 'crashed' && c.reasons).toEqual(['hull']);
  });

  it('crashes on a spike that pokes into the hull between vertices', () => {
    const spiky: Terrain = {
      width: WORLD_W,
      points: [
        { x: 0, y: 10 },
        { x: 69.9, y: 10 },
        { x: 70, y: 21 },
        { x: 70.1, y: 10 },
        { x: WORLD_W, y: 10 },
      ],
      pads: [],
    };
    const l = createLander(70, 20, 0); // feet at 17.4 (above ground 10) but the spike reaches y=21 inside the hull
    expect(hullHits(l, spiky)).toBe(true);
    expect(checkContact(l, spiky).kind).toBe('crashed');
    expect(HULL.length).toBeGreaterThan(8);
  });

  it('is lost outside the level or above the ceiling', () => {
    expect(checkContact(createLander(-1, 50, 0), terrain)).toEqual({ kind: 'crashed', reasons: ['lost'] });
    expect(checkContact(createLander(10, 600, 0), terrain)).toEqual({ kind: 'crashed', reasons: ['lost'] });
  });

  it('settle rests the lander squarely on the pad', () => {
    const l = createLander(70, 30, 1);
    l.angle = 0.1;
    l.vy = -2;
    settle(l, terrain.pads[0]);
    expect(l.angle).toBe(0);
    expect(l.vx).toBe(0);
    expect(l.vy).toBe(0);
    expect(toWorld(l, FEET[0]).y).toBeCloseTo(20, 9);
  });

  it('altitudeAbove measures the feet height over the ground below', () => {
    const l = createLander(70, 30, 0);
    expect(altitudeAbove(l, terrain)).toBeCloseTo(30 + FOOT_Y - 20, 9);
    l.y = 5;
    expect(altitudeAbove(l, terrain)).toBe(0);
    l.x = -3;
    expect(altitudeAbove(l, terrain)).toBe(0);
  });
});

describe('scoring', () => {
  it('awards 100 × multiplier plus 2 per fuel percent', () => {
    expect(levelScore(3, 50)).toEqual({ padPts: 300, fuelPts: 100, total: 400 });
    expect(levelScore(1, 0)).toEqual({ padPts: 100, fuelPts: 0, total: 100 });
    expect(levelScore(2, 100)).toEqual({ padPts: 200, fuelPts: 200, total: 400 });
    expect(levelScore(2, 33.4).fuelPts).toBe(66);
  });
});

describe('level lifecycle', () => {
  it('creates a deterministic level with the lander above the interior', () => {
    const a = createLevel(4, 99);
    const b = createLevel(4, 99);
    expect(a).toEqual(b);
    expect(a.lander.x).toBeGreaterThan(WORLD_W * 0.15);
    expect(a.lander.x).toBeLessThan(WORLD_W * 0.85);
    expect(Math.abs(a.lander.vx)).toBeCloseTo(a.cfg.startVx, 9);
    expect(a.lander.fuel).toBe(100);
    expect(a.phase).toBe('ready');
    expect(heightAt(a.terrain, a.lander.x)).toBeLessThan(a.lander.y - 20);
  });

  it('holds still during the ready phase, then flies', () => {
    const lv = createLevel(1, 5);
    const y0 = lv.lander.y;
    const steps = Math.ceil(READY_TIME / DT) - 1;
    for (let i = 0; i < steps; i++) expect(stepLevel(lv, BURN)).toBeNull();
    expect(lv.phase).toBe('ready');
    expect(lv.lander.y).toBe(y0);
    expect(lv.lander.fuel).toBe(100);
    stepLevel(lv, BURN);
    expect(lv.phase).toBe('flying');
    stepLevel(lv, NO_INPUT);
    expect(lv.lander.y).toBeLessThan(y0);
  });

  it('free fall ends in a crash with a speed reason, and nothing changes afterwards', () => {
    const lv = createLevel(1, 11);
    let result: ReturnType<typeof stepLevel> = null;
    for (let i = 0; i < 60 * 40 && !result; i++) result = stepLevel(lv, NO_INPUT);
    expect(result).toBe('crashed');
    expect(lv.phase).toBe('crashed');
    expect(lv.outcome?.kind).toBe('crashed');
    if (lv.outcome?.kind === 'crashed') {
      expect(lv.outcome.reasons.length).toBeGreaterThan(0);
      expect(lv.outcome.outOfFuel).toBe(false);
    }
    const snapshot = JSON.stringify(lv.lander);
    expect(stepLevel(lv, BURN)).toBeNull();
    expect(JSON.stringify(lv.lander)).toBe(snapshot);
  });

  it('wind is zero before level 6 and bounded gusts afterwards', () => {
    const calm = createLevel(3, 1);
    expect(currentWind(calm)).toBe(0);
    const windy = createLevel(8, 1);
    for (let i = 0; i < 600; i++) {
      windy.time += DT;
      const w = Math.abs(currentWind(windy));
      expect(w).toBeGreaterThanOrEqual(windy.cfg.wind * 0.5 - 1e-9);
      expect(w).toBeLessThanOrEqual(windy.cfg.wind + 1e-9);
    }
  });

  it('zoomFor interpolates between near and far', () => {
    expect(zoomFor(0, 7, 2.5)).toBe(7);
    expect(zoomFor(200, 7, 2.5)).toBe(2.5);
    const mid = zoomFor(46.5, 7, 2.5);
    expect(mid).toBeGreaterThan(2.5);
    expect(mid).toBeLessThan(7);
  });
});

/** A simple autopilot used to prove every level is winnable with the fuel it gets. */
function autopilot(lv: Level): Input {
  const l = lv.lander;
  const t = lv.terrain;
  const pad = t.pads.reduce((best, p) => {
    const dp = Math.abs((p.x0 + p.x1) / 2 - l.x);
    const db = Math.abs((best.x0 + best.x1) / 2 - l.x);
    return dp < db ? p : best;
  });
  const cx = (pad.x0 + pad.x1) / 2;
  const ahead = Math.max(1, Math.min(WORLD_W - 1, l.x + l.vx * 1.5));
  const ground = Math.max(pad.y, heightAt(t, l.x), heightAt(t, ahead));
  const alt = l.y + FOOT_Y - ground;
  const altPad = l.y + FOOT_Y - pad.y;
  const ex = cx - l.x;
  const wind = currentWind(lv);
  const vxDes = Math.max(-6, Math.min(6, ex * 0.35));
  const evx = vxDes - l.vx;
  const maxTilt = altPad < 3 ? 0.14 : altPad < 12 ? 0.25 : 0.5;
  const angleDes = Math.max(-maxTilt, Math.min(maxTilt, evx * 0.25 - wind / THRUST));
  const rot = Math.max(-1, Math.min(1, (angleDes - l.angle) * 8 - l.angVel * 0.3));
  const aligned = Math.abs(ex) < 1.5 && Math.abs(l.vx) < 1.0;
  // Hold altitude while still translating low down; otherwise a controlled descent profile.
  const vyDes = !aligned && altPad < 30 ? -0.3 : -Math.max(0.8, Math.min(12, alt * 0.22));
  let thrust = l.vy < vyDes;
  if (Math.abs(evx) > 1.5 && altPad > 12 && l.vy < -0.5) thrust = true;
  return { thrust, rot };
}

describe('solvability', () => {
  it('an autopilot lands every campaign and early endless level with fuel to spare', () => {
    const failures: string[] = [];
    for (let n = 1; n <= 14; n++) {
      for (let seed = 1; seed <= 6; seed++) {
        const lv = createLevel(n, seed * 7919 + n);
        let result: ReturnType<typeof stepLevel> = null;
        for (let i = 0; i < 60 * 120 && !result; i++) result = stepLevel(lv, autopilot(lv));
        const fuel = lv.lander.fuel;
        if (result !== 'landed' || fuel < 10) {
          failures.push(`level ${n} seed ${seed}: ${result} fuel ${fuel.toFixed(1)} ${JSON.stringify(lv.outcome)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('a landed level reports a score consistent with the pad and fuel', () => {
    const lv = createLevel(2, 3);
    let result: ReturnType<typeof stepLevel> = null;
    for (let i = 0; i < 60 * 120 && !result; i++) result = stepLevel(lv, autopilot(lv));
    expect(result).toBe('landed');
    expect(lv.outcome?.kind).toBe('landed');
    if (lv.outcome?.kind === 'landed') {
      expect(lv.outcome.score).toEqual(levelScore(lv.outcome.pad.mult, lv.lander.fuel));
      expect(lv.lander.angle).toBe(0);
      expect(toWorld(lv.lander, FEET[1]).y).toBeCloseTo(lv.outcome.pad.y, 9);
    }
  });
});
