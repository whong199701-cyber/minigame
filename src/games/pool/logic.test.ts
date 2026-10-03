import { describe, expect, it } from 'vitest';
import {
  AIM_LOCK,
  BALL_E,
  CUSHION_E,
  D,
  FIRE_MIN,
  GRAB_MIN_PX,
  H,
  HEAD_Y,
  HINT_BANDS,
  MODES,
  MODE_LIST,
  POCKETS,
  PULL_PX,
  R,
  STEP,
  V_MAX,
  W,
  ballsLeft,
  beginAim,
  findFreeSpot,
  grabRadiusPx,
  hintBandY,
  insideTable,
  isAtRest,
  isFreeSpot,
  isStripe,
  isTap,
  moveAim,
  nearestObjectAngle,
  newGame,
  placeCueBall,
  pocketAt,
  predictShot,
  rackBalls,
  rackNumbers,
  rackPositions,
  releasePower,
  settle,
  shoot,
  speedForPower,
  starsFor,
  stepGame,
  stepPhysics,
  type AimGesture,
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

describe('aim gesture', () => {
  const UP = -Math.PI / 2;
  const CX = 200;
  const CY = 500;

  /** Press at (x0, y0), move in `steps` equal steps to (x1, y1) (like pointermove events), return the gesture. */
  function dragLine(aim: number, scale: number, x0: number, y0: number, x1: number, y1: number, steps = 15): AimGesture {
    const g = beginAim(CX, CY, x0, y0, aim, grabRadiusPx(scale));
    for (let i = 1; i <= steps; i++) moveAim(g, CX, CY, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    return g;
  }

  it('grabbing the cue ball anywhere and pulling straight back keeps the aim exactly (QA repro)', () => {
    for (const scale of [2.5, 3.18, 4.5]) {
      const r = R * scale;
      // Side offsets 0.3R..1.5R (the reviewer measured 1.6°..14.4° of drift before the fix) and presses in front/behind.
      const offsets = [
        [0.3 * r, 0],
        [0.6 * r, 0],
        [0.9 * r, 0],
        [1.2 * r, 0],
        [1.5 * r, 0],
        [-0.9 * r, 0],
        [0, -1.2 * r],
        [0, 1.2 * r],
        [0.7 * r, -0.7 * r],
      ];
      for (const [dx, dy] of offsets) {
        const g = dragLine(UP, scale, CX + dx, CY + dy, CX + dx, CY + dy + 150);
        expect(g.grab).toBe(true);
        expect(g.aim).toBe(UP);
        expect(g.power).toBeCloseTo(1, 6);
        expect(releasePower(g)).toBeCloseTo(1, 6);
      }
    }
  });

  it('grab: power is the pull along −aim; sideways drift and pushing forward give none', () => {
    const aim = 0.3;
    const back = { x: -Math.cos(aim), y: -Math.sin(aim) };
    const side = { x: -Math.sin(aim), y: Math.cos(aim) };
    let g = dragLine(aim, 3, CX + 5, CY - 4, CX + 5 + back.x * 75 + side.x * 40, CY - 4 + back.y * 75 + side.y * 40);
    expect(g.aim).toBe(aim);
    expect(g.power).toBeCloseTo(75 / PULL_PX, 6);
    g = dragLine(aim, 3, CX, CY, CX + side.x * 120, CY + side.y * 120);
    expect(g.power).toBeCloseTo(0, 9);
    expect(releasePower(g)).toBeNull();
    g = dragLine(aim, 3, CX, CY, CX - back.x * 60, CY - back.y * 60);
    expect(g.power).toBe(0);
    expect(releasePower(g)).toBeNull();
  });

  it('the grab zone is at least a fingertip wide and grows with the table scale', () => {
    expect(grabRadiusPx(1)).toBe(GRAB_MIN_PX);
    expect(grabRadiusPx(3.18)).toBe(GRAB_MIN_PX);
    expect(grabRadiusPx(6)).toBeCloseTo(R * 6 * 2, 9);
    expect(beginAim(CX, CY, CX + GRAB_MIN_PX + 1, CY, UP, grabRadiusPx(3)).grab).toBe(false);
  });

  it('aim-only sideways drags never charge or fire (QA repro: 60 px at 100 px, 80 px at 250 px)', () => {
    let g = dragLine(UP, 3.18, CX, CY - 100, CX + 60, CY - 100, 12);
    expect(g.grab).toBe(false);
    expect(g.power).toBeLessThan(1e-9);
    expect(g.aim).toBeGreaterThan(UP + 0.3); // the aim did turn (finger in front, moving right → aim swings right)
    expect(releasePower(g)).toBeNull();
    g = dragLine(UP, 3.18, CX, CY - 250, CX + 80, CY - 250, 10);
    expect(g.power).toBeLessThan(1e-9);
    expect(releasePower(g)).toBeNull();
    // Even a drag as long as the press distance stays aim-only.
    g = dragLine(UP, 3.18, CX + 120, CY + 30, CX + 120, CY - 90, 40);
    expect(g.power).toBeLessThan(1e-9);
    expect(releasePower(g)).toBeNull();
  });

  it('circling the cue ball rotates the aim by the swept angle without charging', () => {
    const g = beginAim(CX, CY, CX, CY + 120, UP, grabRadiusPx(3));
    const n = 60;
    for (let i = 1; i <= n; i++) {
      const a = Math.PI / 2 + (Math.PI / 2) * (i / n); // finger sweeps from below the ball to its left
      moveAim(g, CX, CY, CX + Math.cos(a) * 120, CY + Math.sin(a) * 120);
    }
    expect(g.aim).toBeCloseTo(0, 6); // aim followed: up → right (the cue butt went from below to the left)
    expect(g.power).toBeLessThan(1e-9);
  });

  it('pulling away from the cue ball charges without changing the aim, and locks it while charged', () => {
    const aim = -2;
    const g = dragLine(aim, 3, CX + 40, CY + 60, CX + 40 * 3, CY + 60 * 3, 20);
    expect(g.aim).toBe(aim);
    const pulled = Math.hypot(40 * 3, 60 * 3) - Math.hypot(40, 60);
    expect(g.power).toBeCloseTo(Math.min(1, pulled / PULL_PX), 6);
    expect(g.power).toBeGreaterThan(AIM_LOCK);
    // Sideways drift while charged neither rotates the aim nor changes the charge.
    const p0 = g.power;
    for (let i = 1; i <= 10; i++) moveAim(g, CX, CY, CX + 120 + i * 4, CY + 180 - i * 2.6);
    expect(g.aim).toBe(aim);
    expect(g.power).toBeCloseTo(p0, 2);
    expect(releasePower(g)).not.toBeNull();
  });

  it('rotate first, then pull: the shot keeps the rotated aim', () => {
    const g = beginAim(CX, CY, CX, CY + 100, UP, grabRadiusPx(3));
    for (let i = 1; i <= 10; i++) moveAim(g, CX, CY, CX + Math.sin(-0.02 * i) * 100, CY + Math.cos(-0.02 * i) * 100);
    const turned = g.aim;
    expect(turned).toBeCloseTo(UP + 0.2, 6);
    const fx = CX + Math.sin(-0.2) * 100;
    const fy = CY + Math.cos(-0.2) * 100;
    for (let i = 1; i <= 15; i++) moveAim(g, CX, CY, fx + Math.sin(-0.2) * 6 * i, fy + Math.cos(-0.2) * 6 * i);
    expect(g.aim).toBeCloseTo(turned, 9);
    expect(g.power).toBeCloseTo(90 / PULL_PX, 6);
  });

  it('sliding back toward the start cancels the shot', () => {
    const g = dragLine(UP, 3, CX, CY + 60, CX, CY + 200, 14);
    expect(g.power).toBeGreaterThan(0.5);
    for (let i = 1; i <= 14; i++) moveAim(g, CX, CY, CX, CY + 200 - i * 10);
    expect(g.power).toBe(0);
    expect(releasePower(g)).toBeNull();
    // The same for a grab.
    const h = dragLine(UP, 3, CX + 3, CY, CX + 3, CY + 120, 12);
    expect(releasePower(h)).not.toBeNull();
    moveAim(h, CX, CY, CX + 3, CY + 4);
    expect(releasePower(h)).toBeNull();
  });

  it('a long press that drifts a few px is neither a tap nor a shot', () => {
    for (const grab of [true, false]) {
      const y0 = grab ? CY : CY + 80;
      const g = beginAim(CX, CY, CX, y0, UP, grabRadiusPx(3));
      expect(g.grab).toBe(grab);
      // Drift 7.9 px straight away from the ball in small steps (the old code fired at 7.5 px).
      for (let i = 1; i <= 8; i++) moveAim(g, CX, CY, CX, y0 + i * 0.9875);
      expect(g.moved).toBe(false);
      expect(isTap(g, 900)).toBe(false);
      expect(releasePower(g)).toBeNull();
      // Just past the tap threshold but still under the fire threshold: no shot either.
      moveAim(g, CX, CY, CX, y0 + 11);
      expect(g.moved).toBe(true);
      expect(releasePower(g)).toBeNull();
    }
    expect(FIRE_MIN * PULL_PX).toBeGreaterThan(8);
  });

  it('a quick press without movement is a tap', () => {
    const g = beginAim(CX, CY, CX + 50, CY - 200, UP, grabRadiusPx(3));
    moveAim(g, CX, CY, CX + 52, CY - 201);
    expect(isTap(g, 120)).toBe(true);
    expect(isTap(g, 400)).toBe(false);
    expect(releasePower(g)).toBeNull();
  });

  it('maps the firing range onto the full shot-power range', () => {
    const g = beginAim(CX, CY, CX, CY, UP, grabRadiusPx(3));
    moveAim(g, CX, CY, CX, CY + FIRE_MIN * PULL_PX + 1e-9);
    expect(releasePower(g)).toBeCloseTo(0, 6);
    moveAim(g, CX, CY, CX, CY + PULL_PX * 3);
    expect(releasePower(g)).toBe(1);
  });

  it('rotation is damped right next to the ball and never jumps more than 0.6 rad per step', () => {
    const g = beginAim(CX, CY, CX + 30, CY, UP, 24);
    expect(g.grab).toBe(false);
    moveAim(g, CX, CY, CX - 30, CY + 1); // finger jumps across the ball
    expect(Math.abs(g.aim - UP)).toBeLessThanOrEqual(0.6 + 1e-9);
  });
});

describe('ball-in-hand hint placement', () => {
  const HW = 40;
  const HH = 4;
  const clearOf = (balls: Ball[], y: number) =>
    balls.slice(1).every((b) => b.pocketed || Math.abs(b.y - y) >= HH + R || Math.abs(b.x - W / 2) >= HW + R);

  it('uses the mid-table band on an empty table and never the bottom-rail area where the toast sits', () => {
    expect(hintBandY([ball(0, 50, 150)], HW, HH)).toBeCloseTo(H * 0.6, 9);
    for (const f of HINT_BANDS) expect(f).toBeLessThan(0.8);
  });

  it('moves off a ball that sits on the preferred band (QA: hint drawn over the 3-ball)', () => {
    const balls = [ball(0, 50, 150), ball(3, 66, H * 0.6), ball(1, 50, 58), ball(2, 80, 90)];
    const y = hintBandY(balls, HW, HH);
    expect(y).not.toBeCloseTo(H * 0.6, 3);
    expect(clearOf(balls, y)).toBe(true);
  });

  it('ignores the cue ball (it follows the finger), pocketed balls and balls beside the text', () => {
    const balls = [ball(0, 50, H * 0.6), ball(1, 50, H * 0.6), ball(2, 3.5, H * 0.6)];
    balls[1].pocketed = true;
    expect(hintBandY(balls, HW, HH)).toBeCloseTo(H * 0.6, 9);
  });

  it('always returns a clear band for real racks and falls back to mid-table when nothing is clear', () => {
    for (const mode of MODE_LIST) {
      const g = newGame(mode, seeded(7));
      expect(clearOf(g.balls, hintBandY(g.balls, HW, HH))).toBe(true);
    }
    const crowded = [ball(0, 50, 150), ...HINT_BANDS.map((f, i) => ball(i + 1, 50, H * f))];
    expect(hintBandY(crowded, HW, HH)).toBeCloseTo(H * HINT_BANDS[0], 9);
  });
});
