import { describe, expect, it } from 'vitest';
import {
  BALL_E,
  CUSHION_E,
  D,
  H,
  HEAD_Y,
  MODES,
  MODE_LIST,
  POCKETS,
  R,
  STEP,
  V_MAX,
  W,
  ballsLeft,
  findFreeSpot,
  insideTable,
  isAtRest,
  isFreeSpot,
  isStripe,
  nearestObjectAngle,
  newGame,
  placeCueBall,
  pocketAt,
  predictShot,
  rackBalls,
  rackNumbers,
  rackPositions,
  settle,
  shoot,
  speedForPower,
  starsFor,
  stepGame,
  stepPhysics,
  type Ball,
  type PhysEvent,
} from './logic';

/** mulberry32 — deterministic rand for reproducible racks / fuzzing. */
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

function ball(id: number, x: number, y: number, vx = 0, vy = 0): Ball {
  return { id, x, y, vx, vy, pocketed: false };
}

function momentum(balls: Ball[]): { px: number; py: number } {
  let px = 0;
  let py = 0;
  for (const b of balls) {
    px += b.vx;
    py += b.vy;
  }
  return { px, py };
}

function energy(balls: Ball[]): number {
  return balls.reduce((e, b) => e + (b.vx * b.vx + b.vy * b.vy) / 2, 0);
}

describe('rack', () => {
  it('has the right ball counts and unique numbers', () => {
    for (const mode of MODE_LIST) {
      const balls = rackBalls(mode, seeded(1));
      expect(balls).toHaveLength(MODES[mode].count + 1);
      expect(balls[0].id).toBe(0);
      const ids = balls.slice(1).map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
      ids.forEach((id) => expect(id >= 1 && id <= 15).toBe(true));
      expect(balls[1].id).toBe(1); // apex
    }
  });

  it('places balls without overlap and inside the table', () => {
    for (const mode of MODE_LIST) {
      const pos = rackPositions(mode);
      for (let i = 0; i < pos.length; i++) {
        expect(insideTable(pos[i].x, pos[i].y)).toBe(true);
        for (let j = i + 1; j < pos.length; j++) {
          expect(Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y)).toBeGreaterThanOrEqual(D);
        }
      }
      // The cue ball sits clear of the rack and nothing starts in a pocket.
      const balls = rackBalls(mode, seeded(7));
      for (const b of balls) expect(pocketAt(b.x, b.y)).toBe(-1);
      for (let i = 1; i < balls.length; i++) expect(Math.hypot(balls[0].x - balls[i].x, balls[0].y - balls[i].y)).toBeGreaterThan(D * 3);
    }
  });

  it('follows the classic 8-ball layout rules in 15-ball', () => {
    for (let s = 0; s < 40; s++) {
      const nums = rackNumbers('15', seeded(100 + s));
      expect(nums[0]).toBe(1);
      expect(nums[4]).toBe(8);
      expect(isStripe(nums[10])).not.toBe(isStripe(nums[14]));
      expect([...nums].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    }
  });

  it('puts the 9 in the middle of the diamond and uses 1–6 for 6-ball', () => {
    const nine = rackNumbers('9', seeded(3));
    expect(nine[0]).toBe(1);
    expect(nine[4]).toBe(9);
    expect([...nine].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const six = rackNumbers('6', seeded(3));
    expect([...six].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('is deterministic for a given seed', () => {
    expect(rackNumbers('15', seeded(42))).toEqual(rackNumbers('15', seeded(42)));
    expect(rackBalls('15', seeded(42))).toEqual(rackBalls('15', seeded(42)));
  });

  it('never overlaps balls even with a loose, jittered rack', () => {
    for (let s = 0; s < 60; s++) {
      const balls = rackBalls('15', seeded(500 + s), { gap: 0.55, jitter: 0.18 });
      for (let i = 1; i < balls.length; i++) {
        expect(insideTable(balls[i].x, balls[i].y)).toBe(true);
        for (let j = i + 1; j < balls.length; j++) expect(Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y)).toBeGreaterThan(D);
      }
    }
  });

  it('a full-power break scatters the rack', () => {
    const s = newGame('15', seeded(77));
    const start = s.balls.map((b) => ({ x: b.x, y: b.y }));
    shoot(s, -Math.PI / 2, 1);
    let settled = false;
    for (let i = 0; i < 3000 && !settled; i++) settled = stepGame(s, 1 / 60).some((e) => e.type === 'settle');
    expect(settled).toBe(true);
    let moved = 0;
    for (let i = 1; i < s.balls.length; i++) if (s.balls[i].pocketed || Math.hypot(s.balls[i].x - start[i].x, s.balls[i].y - start[i].y) > 10) moved++;
    expect(moved).toBeGreaterThanOrEqual(5);
  });
});

describe('ball–ball collisions', () => {
  it('conserves momentum and does not gain energy in a head-on hit', () => {
    const a = ball(0, 50, 100, 0, -60);
    const b = ball(1, 50, 100 - D + 0.5, 0, 0); // slightly overlapping, closing in
    const balls = [a, b];
    const before = momentum(balls);
    const e0 = energy(balls);
    const ev: PhysEvent[] = [];
    stepPhysics(balls, STEP, ev);
    const after = momentum(balls);
    // Friction over one step is tiny; momentum must match closely.
    expect(after.px).toBeCloseTo(before.px, 1);
    expect(after.py).toBeCloseTo(before.py, 0);
    expect(energy(balls)).toBeLessThanOrEqual(e0 + 1e-6);
    expect(ev.some((e) => e.type === 'hit')).toBe(true);
    // Equal masses: the moving ball hands over most of its speed (restitution 0.95).
    expect(Math.abs(a.vy)).toBeLessThan(60 * (1 - BALL_E) / 2 + 2);
    expect(b.vy).toBeLessThan(-50);
  });

  it('separates overlapping balls', () => {
    const a = ball(0, 50, 100);
    const b = ball(1, 52, 100);
    stepPhysics([a, b], STEP);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(D - 1e-6);
  });

  it('ignores balls that are touching but moving apart', () => {
    const a = ball(0, 50, 100, 0, 10);
    const b = ball(1, 50, 100 - D + 0.01, 0, -10);
    const ev: PhysEvent[] = [];
    stepPhysics([a, b], STEP, ev);
    expect(ev.filter((e) => e.type === 'hit')).toHaveLength(0);
    expect(a.vy).toBeGreaterThan(0);
    expect(b.vy).toBeLessThan(0);
  });

  it('transfers velocity along the line of centres in a cut shot', () => {
    const a = ball(0, 50, 120, 0, -80);
    const b = ball(1, 50 + D * Math.SQRT1_2 - 0.05, 120 - D * Math.SQRT1_2 - 0.05, 0, 0);
    const balls = [a, b];
    for (let i = 0; i < 4; i++) stepPhysics(balls, STEP);
    // The object ball moves along the 45° line of centres: +x and -y.
    expect(b.vx).toBeGreaterThan(5);
    expect(b.vy).toBeLessThan(-5);
    expect(Math.abs(b.vx + b.vy)).toBeLessThan(Math.abs(b.vx) * 0.25);
    // The cue ball deflects the other way (-x).
    expect(a.vx).toBeLessThan(-5);
  });
});

describe('cushions and jaws', () => {
  it('reflects off the left cushion with restitution', () => {
    const b = ball(1, R + 0.2, 60, -50, 10);
    const ev: PhysEvent[] = [];
    for (let i = 0; i < 6 && !ev.length; i++) stepPhysics([b], STEP, ev);
    expect(b.x).toBeGreaterThanOrEqual(R - 1e-9);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vx / 50).toBeCloseTo(CUSHION_E, 1);
    expect(b.vy).toBeGreaterThan(0); // tangential component kept
    expect(ev.some((e) => e.type === 'cushion')).toBe(true);
  });

  it('reflects off top, right and bottom cushions', () => {
    const top = ball(1, 50, R + 0.1, 0, -40);
    const right = ball(2, W - R - 0.1, 60, 40, 0);
    const bottom = ball(3, 50, H - R - 0.1, 0, 40);
    stepPhysics([top, right, bottom], STEP);
    expect(top.vy).toBeGreaterThan(0);
    expect(right.vx).toBeLessThan(0);
    expect(bottom.vy).toBeLessThan(0);
  });

  it('rattles a ball off a pocket jaw instead of letting it clip through', () => {
    // Heading straight down the x = 8.5 line into the top-left corner mouth: clips the jaw at (7.8, 0).
    const b = ball(1, 8.5, 20, 0, -80);
    const ev: PhysEvent[] = [];
    settle([b], 3, ev);
    expect(ev.some((e) => e.type === 'cushion')).toBe(true);
    expect(b.pocketed).toBe(false);
    expect(insideTable(b.x, b.y)).toBe(true);
  });

  it('lets a ball roll along the rail past a side pocket', () => {
    const b = ball(1, R, 70, 0, 60);
    settle([b], 5);
    expect(b.pocketed).toBe(false);
    expect(b.y).toBeGreaterThan(H / 2 + 10);
  });
});

describe('pockets', () => {
  it('captures a ball aimed at the top-left corner', () => {
    const b = ball(1, 20, 20, -60, -60);
    const ev: PhysEvent[] = [];
    settle([b], 3, ev);
    expect(b.pocketed).toBe(true);
    const p = ev.find((e) => e.type === 'pocket');
    expect(p && p.type === 'pocket' && p.pocket).toBe(0);
  });

  it('captures a ball rolling along the top rail into a corner', () => {
    const b = ball(1, 40, R, -70, 0);
    settle([b], 4);
    expect(b.pocketed).toBe(true);
  });

  it('captures a ball driven into a side pocket at an angle', () => {
    const b = ball(1, 30, 80, -60, 45);
    settle([b], 4);
    expect(b.pocketed).toBe(true);
  });

  it('does not capture balls in the middle of the table', () => {
    expect(pocketAt(W / 2, H / 2)).toBe(-1);
    expect(pocketAt(W / 2, R)).toBe(-1);
    expect(pocketAt(R, H * 0.3)).toBe(-1);
  });

  it('captures anything that got past a wall line', () => {
    expect(pocketAt(-3, 100)).toBe(2);
    expect(pocketAt(W + 3, 100)).toBe(3);
    expect(pocketAt(50, -3)).toBeGreaterThanOrEqual(0);
  });

  it('every pocket is reachable: a ball fired straight at each pocket centre drops', () => {
    POCKETS.forEach((p) => {
      const sx = p.x < W / 2 ? 30 : W - 30;
      const sy = p.corner ? (p.y < H / 2 ? 30 : H - 30) : H / 2 - 20;
      const b = ball(1, sx, sy);
      const d = Math.hypot(p.x - sx, p.y - sy);
      b.vx = ((p.x - sx) / d) * 70;
      b.vy = ((p.y - sy) / d) * 70;
      settle([b], 5);
      expect(b.pocketed).toBe(true);
    });
  });
});

describe('motion and rest', () => {
  it('a full-power shot settles within a few seconds and travels more than a table length', () => {
    const b = ball(0, 50, 180, 0, -V_MAX);
    let dist = 0;
    let px = b.x;
    let py = b.y;
    let t = 0;
    while (!isAtRest([b]) && t < 20) {
      stepPhysics([b], STEP);
      dist += Math.hypot(b.x - px, b.y - py);
      px = b.x;
      py = b.y;
      t += STEP;
    }
    expect(isAtRest([b])).toBe(true);
    expect(t).toBeLessThan(8);
    expect(dist).toBeGreaterThan(H);
    expect(b.pocketed).toBe(false);
  });

  it('a gentle tap comes to rest quickly and stays on the table', () => {
    const b = ball(0, 50, 100, 10, 0);
    const t = settle([b], 5);
    expect(t).toBeLessThan(1.5);
    expect(b.x).toBeGreaterThan(50);
    expect(insideTable(b.x, b.y)).toBe(true);
  });

  it('speedForPower clamps and interpolates', () => {
    expect(speedForPower(-1)).toBe(speedForPower(0));
    expect(speedForPower(2)).toBe(V_MAX);
    expect(speedForPower(0.5)).toBeGreaterThan(speedForPower(0));
    expect(speedForPower(0.5)).toBeLessThan(V_MAX);
  });

  it('fuzz: random break shots never lose a ball or produce NaN', () => {
    const rand = seeded(2024);
    for (let n = 0; n < 40; n++) {
      const mode = MODE_LIST[n % 3];
      const s = newGame(mode, rand);
      const cue = s.balls[0];
      cue.x = R + 1 + rand() * (W - 2 * R - 2);
      cue.y = H * 0.45 + rand() * (H * 0.5);
      const spot = findFreeSpot(s.balls, cue.x, cue.y, 0);
      cue.x = spot.x;
      cue.y = spot.y;
      const angle = rand() * Math.PI * 2;
      expect(shoot(s, angle, rand())).toBe(true);
      let t = 0;
      let settled = false;
      while (t < 25 && !settled) {
        const ev = stepGame(s, 1 / 60);
        t += 1 / 60;
        if (ev.some((e) => e.type === 'settle')) settled = true;
      }
      expect(settled).toBe(true);
      expect(t).toBeLessThan(12);
      for (const b of s.balls) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
        if (!b.pocketed) {
          expect(b.x).toBeGreaterThan(-R);
          expect(b.x).toBeLessThan(W + R);
          expect(b.y).toBeGreaterThan(-R);
          expect(b.y).toBeLessThan(H + R);
        }
      }
      // No two resting balls overlap noticeably.
      const live = s.balls.filter((b) => !b.pocketed);
      for (let i = 0; i < live.length; i++)
        for (let j = i + 1; j < live.length; j++) expect(Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y)).toBeGreaterThan(D - 0.05);
    }
  });
});

describe('game rules', () => {
  it('counts shots and resolves a normal shot back to aiming', () => {
    const s = newGame('6', seeded(5));
    expect(shoot(s, -Math.PI / 2, 0.2)).toBe(true);
    expect(s.shots).toBe(1);
    expect(s.phase).toBe('moving');
    expect(shoot(s, 0, 1)).toBe(false); // disabled while moving
    let settled: PhysEvent | undefined;
    for (let i = 0; i < 2000 && !settled; i++) settled = stepGame(s, 1 / 60).find((e) => e.type === 'settle');
    expect(settled).toBeDefined();
    expect(s.phase === 'aim' || s.phase === 'inhand').toBe(true);
  });

  it('a scratch costs a penalty shot and gives ball in hand', () => {
    const s = newGame('9', seeded(9));
    // Aim the cue ball straight into the bottom-left corner from close by.
    s.balls[0].x = 20;
    s.balls[0].y = H - 20;
    shoot(s, Math.atan2(H - s.balls[0].y, 0 - s.balls[0].x), 0.5);
    let settled: PhysEvent | undefined;
    for (let i = 0; i < 2000 && !settled; i++) settled = stepGame(s, 1 / 60).find((e) => e.type === 'settle');
    expect(settled && settled.type === 'settle' && settled.scratch).toBe(true);
    expect(s.shots).toBe(2);
    expect(s.scratches).toBe(1);
    expect(s.phase).toBe('inhand');
    expect(s.balls[0].pocketed).toBe(false);
    expect(insideTable(s.balls[0].x, s.balls[0].y)).toBe(true);
    // Ball in hand: placing is only allowed now, and lands on a free spot.
    expect(placeCueBall(s, 50, 150)).toBe(true);
    expect(s.balls[0]).toMatchObject({ x: 50, y: 150 });
    expect(s.phase).toBe('aim');
    expect(placeCueBall(s, 10, 10)).toBe(false);
  });

  it('finishes when the last object ball drops', () => {
    const s = newGame('6', seeded(1));
    for (let i = 1; i < s.balls.length; i++) s.balls[i].pocketed = true;
    const last = s.balls[1];
    last.pocketed = false;
    last.x = 20;
    last.y = 20;
    s.balls[0].x = 50;
    s.balls[0].y = 50;
    const g = predictShot(s.balls, Math.atan2(last.y - 50, last.x - 50));
    expect(g.target).toBe(1);
    shoot(s, Math.atan2(last.y - 50, last.x - 50), 0.6);
    let settled: PhysEvent | undefined;
    for (let i = 0; i < 2000 && !settled; i++) settled = stepGame(s, 1 / 60).find((e) => e.type === 'settle');
    expect(settled && settled.type === 'settle' && settled.done).toBe(true);
    expect(s.phase).toBe('done');
    expect(ballsLeft(s.balls)).toBe(0);
    expect(s.pocketedOrder).toEqual([1]);
  });

  it('stepGame is a no-op outside the moving phase', () => {
    const s = newGame('15', seeded(2));
    const before = JSON.stringify(s.balls);
    expect(stepGame(s, 0.5)).toEqual([]);
    expect(JSON.stringify(s.balls)).toBe(before);
  });

  it('rates shots against par', () => {
    expect(starsFor('6', MODES['6'].par - 1)).toBe(3);
    expect(starsFor('6', MODES['6'].par)).toBe(2);
    expect(starsFor('6', MODES['6'].par + 3)).toBe(1);
  });
});

describe('free spot search', () => {
  it('returns the point itself when it is free', () => {
    const balls = rackBalls('9', seeded(1));
    expect(findFreeSpot(balls, 50, 150, 0)).toEqual({ x: 50, y: 150 });
    expect(isFreeSpot(balls, 50, 150, 0)).toBe(true);
  });

  it('moves away from occupied spots, pockets and the rails', () => {
    const balls = rackBalls('15', seeded(1));
    const apex = balls[1];
    const spot = findFreeSpot(balls, apex.x, apex.y, 0);
    expect(isFreeSpot(balls, spot.x, spot.y, 0)).toBe(true);
    expect(Math.hypot(spot.x - apex.x, spot.y - apex.y)).toBeLessThan(R * 6);
    const corner = findFreeSpot(balls, 0, 0, 0);
    expect(isFreeSpot(balls, corner.x, corner.y, 0)).toBe(true);
    expect(pocketAt(corner.x, corner.y)).toBe(-1);
    const off = findFreeSpot(balls, -50, 500, 0);
    expect(insideTable(off.x, off.y)).toBe(true);
    expect(isFreeSpot(balls, off.x, off.y, 0)).toBe(true);
  });
});

describe('aim prediction', () => {
  it('finds the ghost ball two radii before a head-on target', () => {
    const balls = [ball(0, 50, 150), ball(1, 50, 100)];
    const g = predictShot(balls, -Math.PI / 2);
    expect(g.target).toBe(1);
    expect(g.hit.x).toBeCloseTo(50, 5);
    expect(g.hit.y).toBeCloseTo(100 + D, 5);
    expect(g.cut).toBeCloseTo(1, 5);
    expect(g.objectDir).toEqual({ x: expect.closeTo(0, 5), y: expect.closeTo(-1, 5) });
    expect(g.cueDir).toBeNull();
  });

  it('computes object and cue directions for a cut shot', () => {
    const balls = [ball(0, 50, 150), ball(1, 50 + R, 100)];
    const g = predictShot(balls, -Math.PI / 2);
    expect(g.target).toBe(1);
    expect(g.objectDir!.x).toBeGreaterThan(0.3);
    expect(g.objectDir!.y).toBeLessThan(-0.5);
    expect(g.cueDir!.x).toBeLessThan(-0.5);
    expect(g.cut).toBeGreaterThan(0.5);
    expect(g.cut).toBeLessThan(1);
    // Object direction and cue direction are perpendicular.
    expect(Math.abs(g.objectDir!.x * g.cueDir!.x + g.objectDir!.y * g.cueDir!.y)).toBeLessThan(1e-6);
  });

  it('picks the nearest ball along the ray and ignores balls behind', () => {
    const balls = [ball(0, 50, 150), ball(1, 50, 60), ball(2, 50, 100), ball(3, 50, 190)];
    const g = predictShot(balls, -Math.PI / 2);
    expect(g.target).toBe(2);
    expect(g.dist).toBeCloseTo(50 - D, 5);
  });

  it('ends at the cushion when nothing is in the way', () => {
    const balls = [ball(0, 50, 150)];
    const g = predictShot(balls, Math.PI); // straight left
    expect(g.target).toBe(-1);
    expect(g.hit.x).toBeCloseTo(R, 5);
    expect(g.hit.y).toBeCloseTo(150, 5);
  });

  it('nearestObjectAngle points at the closest live ball', () => {
    const balls = [ball(0, 50, 150), ball(1, 50, 120), ball(2, 90, 150)];
    balls[1].pocketed = true;
    expect(nearestObjectAngle(balls)).toBeCloseTo(0, 5);
    balls[1].pocketed = false;
    expect(nearestObjectAngle(balls)).toBeCloseTo(-Math.PI / 2, 5);
    expect(nearestObjectAngle([ball(0, 1, 1)], 0.7)).toBe(0.7);
    expect(HEAD_Y).toBeGreaterThan(H / 2);
  });
});
