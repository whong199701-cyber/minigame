import { describe, expect, it } from 'vitest';
import {
  BALL_R,
  CUP_R,
  DIFF,
  DIFFICULTIES,
  FIELD_H,
  FIELD_W,
  HOLES,
  HOLE_COUNT,
  PHYS,
  aimFromDrag,
  captureThreshold,
  collideCircle,
  collideRect,
  collideSeg,
  distanceMap,
  formatVsPar,
  freeGrid,
  greedySolve,
  holeIssues,
  holeScore,
  isBallLost,
  isValidProgress,
  moverRect,
  moverVel,
  newSim,
  pointInPoly,
  predictPath,
  progressAfterHole,
  rect,
  scoreTerm,
  shoot,
  stepSim,
  sumScores,
  totalPar,
  vsPar,
  wallSegs,
  type Ball,
  type Hole,
  type PhysEvent,
  type SimState,
} from './logic';

const cfg = DIFF.standard;

/** Big empty field so friction tests do not touch walls. */
function openHole(extra: Partial<Hole> = {}): Hole {
  return {
    par: 2,
    start: { x: 5, y: 8 },
    cup: { x: 5, y: 2 },
    outline: rect(-50, -50, 100, 100),
    blocks: [],
    bumpers: [],
    sand: [],
    water: [],
    movers: [],
    boosters: [],
    ...extra,
  };
}

function runUntilRest(st: SimState, h: Hole, c = cfg, maxT = 30): PhysEvent[] {
  const all: PhysEvent[] = [];
  let t = 0;
  while ((st.moving || t === 0) && t < maxT) {
    all.push(...stepSim(st, h, c, 1 / 60));
    t += 1 / 60;
    if (st.sunk) break;
  }
  return all;
}

describe('geometry', () => {
  it('pointInPoly handles convex and concave shapes', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 16 },
      { x: 5.5, y: 16 },
      { x: 5.5, y: 5 },
      { x: 0, y: 5 },
    ];
    expect(pointInPoly(2, 2, L)).toBe(true);
    expect(pointInPoly(8, 14, L)).toBe(true);
    expect(pointInPoly(2, 10, L)).toBe(false);
    expect(pointInPoly(-1, 2, L)).toBe(false);
  });
  it('movers oscillate around their base and report velocity', () => {
    const m = { cx: 5, cy: 8, w: 2, h: 1, dx: 1.5, dy: 0, period: 2, phase: 0 };
    const r0 = moverRect(m, 0);
    expect(r0.x + r0.w / 2).toBeCloseTo(5);
    const r1 = moverRect(m, 0.5); // quarter period → +amplitude
    expect(r1.x + r1.w / 2).toBeCloseTo(6.5);
    const r3 = moverRect(m, 1.5);
    expect(r3.x + r3.w / 2).toBeCloseTo(3.5);
    expect(moverVel(m, 0).x).toBeGreaterThan(0);
    expect(Math.abs(moverVel(m, 0.5).x)).toBeLessThan(1e-6);
  });
  it('wallSegs includes outline and block edges', () => {
    const h = openHole({ outline: rect(0, 0, 10, 16), blocks: [rect(1, 1, 2, 2)] });
    expect(wallSegs(h)).toHaveLength(8);
  });
});

describe('segment reflection', () => {
  it('reflects the normal component with restitution and keeps the tangent', () => {
    const b: Ball = { x: 0.9, y: 5, vx: 4, vy: 1 };
    const wall = { a: { x: 1, y: 0 }, b: { x: 1, y: 10 } };
    const hit = collideSeg(b, wall, BALL_R, 0.85);
    expect(hit).toBe(true);
    expect(b.vx).toBeCloseTo(-4 * 0.85);
    expect(b.vy).toBeCloseTo(1);
    expect(b.x).toBeCloseTo(1 - BALL_R); // pushed out of the wall
  });
  it('ignores balls moving away from the wall but still pushes them out', () => {
    const b: Ball = { x: 0.9, y: 5, vx: -2, vy: 0 };
    const wall = { a: { x: 1, y: 0 }, b: { x: 1, y: 10 } };
    expect(collideSeg(b, wall, BALL_R, 0.85)).toBe(false);
    expect(b.vx).toBe(-2);
    expect(b.x).toBeCloseTo(1 - BALL_R);
  });
  it('does nothing when the ball is clear of the segment', () => {
    const b: Ball = { x: 0.5, y: 5, vx: 4, vy: 0 };
    expect(collideSeg(b, { a: { x: 1, y: 0 }, b: { x: 1, y: 10 } }, BALL_R, 0.85)).toBe(false);
    expect(b.x).toBe(0.5);
  });
  it('reflects off an endpoint along the radial normal (corner hit)', () => {
    const b: Ball = { x: 1.1, y: 10.1, vx: -3, vy: -3 };
    const wall = { a: { x: 1, y: 0 }, b: { x: 1, y: 10 } };
    expect(collideSeg(b, wall, BALL_R, 1)).toBe(true);
    // Normal is (1,1)/√2 → velocity fully reversed.
    expect(b.vx).toBeCloseTo(3);
    expect(b.vy).toBeCloseTo(3);
  });
  it('uses the segment normal when the centre lies exactly on the wall', () => {
    const b: Ball = { x: 1, y: 5, vx: 2, vy: 0 };
    expect(collideSeg(b, { a: { x: 1, y: 0 }, b: { x: 1, y: 10 } }, BALL_R, 1)).toBe(true);
    expect(b.vx).toBeCloseTo(-2);
  });
  it('adds the wall velocity for moving blocks', () => {
    const b: Ball = { x: 0.9, y: 5, vx: 0, vy: 0 };
    const wall = { a: { x: 1, y: 0 }, b: { x: 1, y: 10 } };
    expect(collideSeg(b, wall, BALL_R, 0.85, { x: -4, y: 0 })).toBe(true);
    expect(b.vx).toBeLessThan(-4); // shoved faster than the block itself
  });
});

describe('moving block (rect) collision', () => {
  const r = { x: 4, y: 4, w: 2, h: 1 };
  it('reflects a ball touching a face', () => {
    const b: Ball = { x: 5, y: 3.9, vx: 0, vy: 3 };
    expect(collideRect(b, r, BALL_R, 1)).toBe(true);
    expect(b.vy).toBeCloseTo(-3);
    expect(b.y).toBeCloseTo(4 - BALL_R);
  });
  it('pushes a centre that ended up inside out through the nearest face', () => {
    const b: Ball = { x: 5.9, y: 4.5, vx: -1, vy: 0 };
    collideRect(b, r, BALL_R, 0.85);
    expect(b.x).toBeCloseTo(6 + BALL_R);
    expect(b.vx).toBeGreaterThan(0);
  });
  it('carries the block velocity into the ball', () => {
    const b: Ball = { x: 6.1, y: 4.5, vx: 0, vy: 0 };
    expect(collideRect(b, r, BALL_R, 0.85, { x: 2, y: 0 })).toBe(true);
    expect(b.vx).toBeGreaterThan(2);
  });
  it('ignores a ball that is clear of the block', () => {
    const b: Ball = { x: 7, y: 4.5, vx: -1, vy: 0 };
    expect(collideRect(b, r, BALL_R, 0.85)).toBe(false);
    expect(b.x).toBe(7);
  });
});

describe('bumper reflection', () => {
  it('bounces a ball off a circle and pushes it out', () => {
    const b: Ball = { x: 5, y: 6.6, vx: 0, vy: -5 };
    const c = { x: 5, y: 6, r: 0.5 };
    expect(collideCircle(b, c, BALL_R, 0.92)).toBe(true);
    expect(b.vy).toBeCloseTo(5 * 0.92);
    expect(b.y).toBeCloseTo(6.7);
  });
  it('ignores a ball that is not overlapping', () => {
    const b: Ball = { x: 5, y: 8, vx: 0, vy: -5 };
    expect(collideCircle(b, { x: 5, y: 6, r: 0.5 }, BALL_R, 0.92)).toBe(false);
  });
});

describe('aim and shooting', () => {
  it('cancels tiny pulls and scales power up to 1', () => {
    const ball = { x: 5, y: 10 };
    expect(aimFromDrag(ball, { x: 5.1, y: 10.1 }).valid).toBe(false);
    const a = aimFromDrag(ball, { x: 5, y: 12 });
    expect(a.valid).toBe(true);
    expect(a.dir.x).toBeCloseTo(0);
    expect(a.dir.y).toBeCloseTo(-1); // shot goes away from the pointer
    expect(a.power).toBeGreaterThan(0.3);
    expect(a.power).toBeLessThan(0.6);
    expect(aimFromDrag(ball, { x: 5, y: 30 }).power).toBe(1);
  });
  it('honours a custom (screen-based) drag scale and anchor', () => {
    const anchor = { x: 2, y: 2 };
    const a = aimFromDrag(anchor, { x: 4, y: 2 }, 4, 1); // pull 2 of 1..4 → 1/3 power, aimed left
    expect(a.valid).toBe(true);
    expect(a.dir.x).toBeCloseTo(-1);
    expect(a.power).toBeCloseTo(1 / 3);
    expect(aimFromDrag(anchor, { x: 2.9, y: 2 }, 4, 1).valid).toBe(false); // back inside the cancel zone
    expect(aimFromDrag(anchor, { x: 1, y: 2 }, 4, 1).power).toBeGreaterThan(0); // just outside: tiny but valid
    expect(aimFromDrag(anchor, { x: 9, y: 2 }, 1, 1).valid).toBe(false); // degenerate scale is rejected
  });
  it('a drag that started away from the ball cancels when brought back onto the ball', () => {
    const ball = { x: 5, y: 10 };
    const anchor = { x: 5, y: 7 }; // pressed on the course above the ball
    // Pulled down onto the ball: long pull from the anchor, but the finger is on the ball → cancel.
    const onBall = aimFromDrag(anchor, { x: 5.2, y: 10.1 }, 4, 0.6, ball);
    expect(onBall.pull).toBeGreaterThan(0.6);
    expect(onBall.valid).toBe(false);
    // Same pull, released beside the ball → a real putt.
    const beside = aimFromDrag(anchor, { x: 6, y: 10 }, 4, 0.6, ball);
    expect(beside.valid).toBe(true);
    expect(beside.dir.y).toBeLessThan(0);
    // Without a ball (drag anchored on the ball itself) only the pull length matters.
    expect(aimFromDrag(anchor, { x: 5.2, y: 10.1 }, 4, 0.6).valid).toBe(true);
    // Back on the start point still cancels too.
    expect(aimFromDrag(anchor, { x: 5.1, y: 7.1 }, 4, 0.6, ball).valid).toBe(false);
  });
  it('shoot sets velocity, counts a stroke and refuses while moving', () => {
    const h = openHole();
    const st = newSim(h);
    expect(shoot(st, { x: 0, y: -1 }, 1)).toBe(true);
    expect(st.strokes).toBe(1);
    expect(Math.hypot(st.ball.vx, st.ball.vy)).toBeCloseTo(PHYS.maxSpeed);
    expect(shoot(st, { x: 0, y: -1 }, 1)).toBe(false);
    expect(st.strokes).toBe(1);
    expect(shoot(newSim(h), { x: 0, y: -1 }, 0)).toBe(false);
  });
  it('more power travels further and the ball eventually stops', () => {
    const h = openHole();
    const dist = (p: number) => {
      const st = newSim(h, { x: 0, y: 0 });
      shoot(st, { x: 0, y: -1 }, p);
      const ev = runUntilRest(st, h);
      expect(st.moving).toBe(false);
      expect(ev.some((e) => e.type === 'stop')).toBe(true);
      expect(st.lastRest.y).toBeCloseTo(st.ball.y);
      return -st.ball.y;
    };
    const d25 = dist(0.25);
    const d50 = dist(0.5);
    const d100 = dist(1);
    expect(d25).toBeGreaterThan(0.5);
    expect(d50).toBeGreaterThan(d25 * 2);
    expect(d100).toBeGreaterThan(d50);
    expect(d100).toBeGreaterThan(FIELD_H); // full power crosses the whole field
    expect(d100).toBeLessThan(FIELD_H * 1.5);
  });
});

describe('zones', () => {
  it('sand stops the ball much sooner than felt', () => {
    const felt = openHole();
    const sandy = openHole({ sand: [{ x: -50, y: -50, w: 100, h: 100 }] });
    const roll = (h: Hole) => {
      const st = newSim(h, { x: 0, y: 0 });
      shoot(st, { x: 0, y: -1 }, 0.8);
      runUntilRest(st, h);
      return -st.ball.y;
    };
    expect(roll(sandy)).toBeLessThan(roll(felt) / 2);
  });
  it('pro sand is stickier than casual sand', () => {
    const sandy = openHole({ sand: [{ x: -50, y: -50, w: 100, h: 100 }] });
    const roll = (c = cfg) => {
      const st = newSim(sandy, { x: 0, y: 0 });
      shoot(st, { x: 0, y: -1 }, 0.8);
      runUntilRest(st, sandy, c);
      return -st.ball.y;
    };
    expect(roll(DIFF.pro)).toBeLessThan(roll(DIFF.casual));
  });
  it('water resets the ball to its last rest and adds a penalty stroke', () => {
    const h = openHole({ water: [{ x: -50, y: -10, w: 100, h: 2 }] });
    const st = newSim(h, { x: 0, y: 0 });
    shoot(st, { x: 0, y: -1 }, 1);
    const ev = runUntilRest(st, h);
    expect(ev.some((e) => e.type === 'water')).toBe(true);
    expect(st.strokes).toBe(2);
    expect(st.ball.x).toBe(0);
    expect(st.ball.y).toBe(0);
    expect(st.moving).toBe(false);
  });
  it('boosters accelerate the ball along their direction', () => {
    const plain = openHole();
    const boosted = openHole({ boosters: [{ x: -5, y: -6, w: 10, h: 4, dir: { x: 0, y: -1 } }] });
    const roll = (h: Hole) => {
      const st = newSim(h, { x: 0, y: 0 });
      shoot(st, { x: 0, y: -1 }, 0.35);
      const ev = runUntilRest(st, h);
      return { d: -st.ball.y, boost: ev.some((e) => e.type === 'boost') };
    };
    const a = roll(plain);
    const b = roll(boosted);
    expect(a.boost).toBe(false);
    expect(b.boost).toBe(true);
    expect(b.d).toBeGreaterThan(a.d * 1.5);
  });
  it('a moving block shoves a resting ball without counting a stroke', () => {
    const h = openHole({ movers: [{ cx: 0, cy: 0, w: 2, h: 1, dx: 2, dy: 0, period: 2, phase: 0 }] });
    const st = newSim(h, { x: 1.6, y: 0 }); // just right of the block at t=0, inside its sweep
    let t = 0;
    let shoved = false;
    while (t < 1 && !shoved) {
      const ev = stepSim(st, h, cfg, 1 / 60);
      t += 1 / 60;
      if (ev.some((e) => e.type === 'mover')) shoved = true;
    }
    expect(shoved).toBe(true);
    expect(st.moving).toBe(true);
    expect(st.strokes).toBe(0);
    expect(st.ball.x).toBeGreaterThan(1.6);
  });
});

describe('cup capture', () => {
  it('threshold is highest for a centre hit and equals captureSpeed at the rim', () => {
    expect(captureThreshold(cfg, CUP_R)).toBeCloseTo(cfg.captureSpeed);
    expect(captureThreshold(cfg, 0)).toBeCloseTo(cfg.captureSpeed * (1 + PHYS.cupCentreBonus));
    expect(captureThreshold(cfg, CUP_R / 2)).toBeGreaterThan(cfg.captureSpeed);
    expect(captureThreshold(cfg, CUP_R / 2)).toBeLessThan(captureThreshold(cfg, 0));
    expect(captureThreshold(cfg, CUP_R * 2)).toBeCloseTo(cfg.captureSpeed);
  });
  it('a slow ball drops in, a fast ball skips over', () => {
    const h = openHole({ cup: { x: 0, y: -3 } });
    const slow = newSim(h, { x: 0, y: 0 });
    slow.ball.vx = 0;
    slow.ball.vy = -4;
    slow.moving = true;
    const ev1 = runUntilRest(slow, h);
    expect(slow.sunk).toBe(true);
    expect(ev1.some((e) => e.type === 'sunk')).toBe(true);

    const fast = newSim(h, { x: 0, y: 0 });
    fast.ball.vy = -PHYS.maxSpeed;
    fast.moving = true;
    const ev2 = runUntilRest(fast, h);
    expect(fast.sunk).toBe(false);
    expect(ev2.some((e) => e.type === 'skip')).toBe(true);
    expect(fast.ball.y).toBeLessThan(-3 - CUP_R); // went past the cup
  });
  it('pro requires a gentler touch than casual', () => {
    const h = openHole({ cup: { x: 0, y: -3 } });
    const sinks = (c = cfg, v = 8) => {
      const st = newSim(h, { x: 0, y: 0 });
      st.ball.vy = -v;
      st.moving = true;
      runUntilRest(st, h, c);
      return st.sunk;
    };
    // The ball slows a little on the way; pick a speed that separates the modes.
    expect(sinks(DIFF.casual)).toBe(true);
    expect(sinks(DIFF.pro)).toBe(false);
  });
  it('a sunk ball stays put and ignores further shots', () => {
    const h = openHole({ cup: { x: 0, y: -1 } });
    const st = newSim(h, { x: 0, y: 0 });
    shoot(st, { x: 0, y: -1 }, 0.2);
    runUntilRest(st, h);
    expect(st.sunk).toBe(true);
    expect(shoot(st, { x: 0, y: -1 }, 1)).toBe(false);
    stepSim(st, h, cfg, 1);
    expect(st.sunk).toBe(true);
  });
});

describe('safety nets', () => {
  it('a ball that ends up outside the field is rescued to its last rest', () => {
    const h = openHole({ outline: rect(0, 0, 10, 16) });
    const st = newSim(h, { x: 5, y: 8 });
    st.ball.x = 20; // teleported through a wall somehow
    st.ball.vx = 1;
    st.moving = true;
    const ev = stepSim(st, h, cfg, 1 / 60);
    expect(ev.some((e) => e.type === 'rescue')).toBe(true);
    expect(st.ball.x).toBe(5);
    expect(st.moving).toBe(false);
    expect(isBallLost(h, { x: 20, y: 8 }, 0)).toBe(true);
    expect(isBallLost(h, { x: 5, y: 8 }, 0)).toBe(false);
  });
  it('a ball never tunnels through a wall at full power from any angle', () => {
    const h = openHole({ outline: rect(0, 0, 10, 16), blocks: [rect(4, 7, 2, 0.8)] });
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2;
      const st = newSim(h, { x: 5, y: 12 });
      shoot(st, { x: Math.cos(ang), y: Math.sin(ang) }, 1);
      const ev = runUntilRest(st, h);
      expect(ev.some((e) => e.type === 'rescue')).toBe(false);
      expect(pointInPoly(st.ball.x, st.ball.y, h.outline)).toBe(true);
      expect(pointInPoly(st.ball.x, st.ball.y, h.blocks[0])).toBe(false);
    }
  });
  it('a ball can never come to rest on a booster: it is pushed back out', () => {
    const z = { x: -5, y: -6, w: 10, h: 4, dir: { x: 0, y: -1 } };
    const h = openHole({ boosters: [z] });
    const st = newSim(h, { x: 0, y: -8 }); // above the booster, rolling down into it slowly
    st.ball.vy = 3;
    st.moving = true;
    runUntilRest(st, h);
    expect(st.moving).toBe(false);
    expect(st.ball.y).toBeLessThan(z.y); // ended up beyond the booster, in its push direction
  });
  it('a ball pinned against a wall by a booster is eventually stopped', () => {
    const h = openHole({ outline: rect(0, 0, 10, 16), boosters: [{ x: 0, y: 6, w: 3, h: 3, dir: { x: -1, y: 0 } }] });
    const st = newSim(h, { x: 1.5, y: 7.5 });
    shoot(st, { x: -1, y: 0 }, 0.3);
    runUntilRest(st, h, cfg, PHYS.maxRoll + 5);
    expect(st.moving).toBe(false);
  });
  it('a ball trapped between bumpers still comes to rest', () => {
    const h = openHole({
      bumpers: [
        { x: 0, y: -1.2, r: 0.5 },
        { x: 0, y: 1.2, r: 0.5 },
      ],
    });
    const st = newSim(h, { x: 0, y: 0 });
    shoot(st, { x: 0, y: -1 }, 1);
    runUntilRest(st, h, cfg, 60);
    expect(st.moving).toBe(false);
  });
});

describe('predictPath', () => {
  it('returns a path starting at the ball and does not mutate the state', () => {
    const h = HOLES[0];
    const st = newSim(h);
    const pts = predictPath(st, h, cfg, { x: 0, y: -1 }, 0.5);
    expect(pts.length).toBeGreaterThan(5);
    expect(pts[0]).toEqual({ x: h.start.x, y: h.start.y });
    expect(pts[pts.length - 1].y).toBeLessThan(h.start.y);
    expect(st.strokes).toBe(0);
    expect(st.moving).toBe(false);
  });
  it('stops shortly after the first bounce', () => {
    const h = HOLES[0];
    const pts = predictPath(newSim(h), h, cfg, { x: 1, y: 0 }, 1, 5, 0.2);
    expect(pts.length).toBeLessThan(5 * 60);
    expect(Math.max(...pts.map((p) => p.x))).toBeLessThanOrEqual(8.5 - BALL_R + 0.05);
  });
});

describe('saved progress', () => {
  const ok = { diff: 'standard', hole: 2, scores: [2, 3], strokes: 1, ball: { ...HOLES[2].start } };
  it('accepts a well-formed save', () => {
    expect(isValidProgress(ok)).toBe(true);
    expect(isValidProgress({ ...ok, strokes: DIFF.standard.maxStrokes })).toBe(true); // last putt was rolling
  });
  it('rejects corrupted or inconsistent saves', () => {
    expect(isValidProgress(null)).toBe(false);
    expect(isValidProgress('x')).toBe(false);
    expect(isValidProgress({ ...ok, diff: 'insane' })).toBe(false);
    expect(isValidProgress({ ...ok, hole: 18, scores: new Array(18).fill(3) })).toBe(false);
    expect(isValidProgress({ ...ok, hole: 1.5 })).toBe(false);
    expect(isValidProgress({ ...ok, scores: [2] })).toBe(false);
    expect(isValidProgress({ ...ok, scores: [2, 0] })).toBe(false);
    expect(isValidProgress({ ...ok, scores: [2, 99] })).toBe(false);
    expect(isValidProgress({ ...ok, strokes: -1 })).toBe(false);
    expect(isValidProgress({ ...ok, strokes: DIFF.standard.maxStrokes + 1 })).toBe(false);
    expect(isValidProgress({ ...ok, ball: null })).toBe(false);
    expect(isValidProgress({ ...ok, ball: { x: NaN, y: 3 } })).toBe(false);
    expect(isValidProgress({ ...ok, ball: { x: -3, y: 3 } })).toBe(false); // off the course
    expect(isValidProgress({ ...ok, ball: { x: 1.01, y: 8 } })).toBe(false); // hugging a wall
    expect(isValidProgress({ ...ok, ball: { x: 5, y: 7.1 } })).toBe(false); // inside a bumper
    const water = HOLES[4].water[0];
    expect(isValidProgress({ ...ok, hole: 4, scores: [2, 3, 3, 3], ball: { x: water.x + 1, y: water.y + 1 } })).toBe(false);
  });
});

describe('progress after a hole', () => {
  it('commits the score and points the save at the next tee', () => {
    const before = [2, 3];
    const r = progressAfterHole({ diff: 'pro', hole: 2, scores: before }, 4);
    expect(r.scores).toEqual([2, 3, 4]);
    expect(before).toEqual([2, 3]); // input untouched
    expect(r.next).toEqual({ diff: 'pro', hole: 3, scores: [2, 3, 4], strokes: 0, ball: HOLES[3].start });
    expect(r.next!.ball).not.toBe(HOLES[3].start); // a copy, not the hole definition itself
    expect(isValidProgress(r.next)).toBe(true);
  });
  it('a max-strokes hole is committed as max + 1 and still yields a valid save', () => {
    const r = progressAfterHole({ diff: 'standard', hole: 0, scores: [] }, holeScore(8, false, cfg));
    expect(r.scores).toEqual([cfg.maxStrokes + 1]);
    expect(isValidProgress(r.next)).toBe(true);
  });
  it('the last hole ends the round (nothing left to save)', () => {
    const played = HOLES.slice(0, HOLE_COUNT - 1).map((h) => h.par);
    const r = progressAfterHole({ diff: 'casual', hole: HOLE_COUNT - 1, scores: played }, 3);
    expect(r.next).toBeNull();
    expect(r.scores).toHaveLength(HOLE_COUNT);
    expect(sumScores(r.scores)).toBe(sumScores(played) + 3);
  });
});

describe('scoring', () => {
  it('maps strokes to golf terms', () => {
    expect(scoreTerm(1, 3)).toBe('holeInOne');
    expect(scoreTerm(2, 5)).toBe('albatross');
    expect(scoreTerm(2, 4)).toBe('eagle');
    expect(scoreTerm(2, 3)).toBe('birdie');
    expect(scoreTerm(3, 3)).toBe('parScore');
    expect(scoreTerm(4, 3)).toBe('bogey');
    expect(scoreTerm(5, 3)).toBe('doubleBogey');
    expect(scoreTerm(6, 3)).toBe('tripleBogey');
    expect(scoreTerm(9, 3)).toBe('overPar');
  });
  it('formats totals versus par', () => {
    expect(formatVsPar(0)).toBe('E');
    expect(formatVsPar(3)).toBe('+3');
    expect(formatVsPar(-2)).toBe('−2');
    // The UI passes the translated "even" label.
    expect(formatVsPar(0, '平')).toBe('平');
    expect(formatVsPar(2, '平')).toBe('+2');
  });
  it('hole score and totals', () => {
    expect(holeScore(3, true, cfg)).toBe(3);
    expect(holeScore(8, false, cfg)).toBe(cfg.maxStrokes + 1);
    expect(sumScores([2, 3, 4])).toBe(9);
    expect(vsPar([HOLES[0].par + 1, HOLES[1].par - 1])).toBe(0);
    expect(totalPar()).toBe(HOLES.reduce((s, h) => s + h.par, 0));
  });
  it('difficulty table is complete', () => {
    expect(DIFFICULTIES).toHaveLength(3);
    for (const d of DIFFICULTIES) {
      expect(DIFF[d].maxStrokes).toBeGreaterThanOrEqual(6);
      expect(DIFF[d].captureSpeed).toBeGreaterThan(0);
    }
    expect(DIFF.pro.captureSpeed).toBeLessThan(DIFF.standard.captureSpeed);
    expect(DIFF.standard.captureSpeed).toBeLessThan(DIFF.casual.captureSpeed);
  });
});

describe('hole definitions', () => {
  it('has exactly 18 holes with sensible pars', () => {
    expect(HOLES).toHaveLength(HOLE_COUNT);
    expect(totalPar()).toBeGreaterThanOrEqual(50);
    expect(totalPar()).toBeLessThanOrEqual(72);
  });
  it('every hole is valid and the cup is reachable (BFS with ball clearance)', () => {
    HOLES.forEach((h, i) => {
      expect(holeIssues(h), `hole ${i + 1}`).toEqual([]);
    });
  });
  it('every element stays inside the 10×16 field', () => {
    const inField = (x: number, y: number) => x >= 0 && x <= FIELD_W && y >= 0 && y <= FIELD_H;
    for (const h of HOLES) {
      for (const r of [...h.sand, ...h.water, ...h.boosters]) {
        expect(inField(r.x, r.y)).toBe(true);
        expect(inField(r.x + r.w, r.y + r.h)).toBe(true);
      }
      for (const b of h.bumpers) expect(inField(b.x, b.y)).toBe(true);
      for (const m of h.movers) {
        const lo = moverRect(m, m.period * 0.75);
        const hi = moverRect(m, m.period * 0.25);
        expect(inField(lo.x, lo.y)).toBe(true);
        expect(inField(hi.x + hi.w, hi.y + hi.h)).toBe(true);
      }
    }
  });
  it('moving blocks never crush the ball against a static wall', () => {
    // At both extremes, every mover edge must either leave ≥ ball diameter + margin to any wall
    // segment on the same row, or be flush with nothing.
    for (const h of HOLES) {
      for (const m of h.movers) {
        for (const t of [m.period * 0.25, m.period * 0.75]) {
          const r = moverRect(m, t);
          for (const s of wallSegs(h)) {
            // Only vertical segments overlapping the mover's rows matter for horizontal movers.
            if (Math.abs(s.a.x - s.b.x) > 1e-9) continue;
            const yLo = Math.min(s.a.y, s.b.y);
            const yHi = Math.max(s.a.y, s.b.y);
            if (yHi < r.y || yLo > r.y + r.h) continue;
            const gapL = r.x - s.a.x;
            const gapR = s.a.x - (r.x + r.w);
            const gap = gapL >= 0 ? gapL : gapR >= 0 ? gapR : 0;
            expect(gap, `mover gap in hole ${HOLES.indexOf(h) + 1}`).toBeGreaterThanOrEqual(BALL_R * 2 + 0.15);
          }
        }
      }
    }
  });
  it('the distance map marks the start reachable and blocked cells unreachable', () => {
    const h = HOLES[1];
    const g = freeGrid(h);
    const dm = distanceMap(h, g);
    expect(dm[g.index(h.start.x, h.start.y)]).toBeGreaterThan(0);
    expect(g.free[g.index(2, 10)]).toBe(0); // inside the missing quadrant of the L
    expect(dm[g.index(2, 10)]).toBe(-1);
  });
  it('a naive greedy player finishes every hole within the stroke limit on every difficulty', () => {
    for (const d of DIFFICULTIES) {
      HOLES.forEach((h, i) => {
        const n = greedySolve(h, DIFF[d]);
        expect(n, `hole ${i + 1} on ${d}`).not.toBeNull();
        expect(n as number).toBeLessThanOrEqual(h.par + 3);
      });
    }
  }, 60000);
  it('every booster releases the ball or lets it settle against a rail (never jitters forever)', () => {
    HOLES.forEach((h, i) => {
      for (const z of h.boosters) {
        const st = newSim(h, { x: z.x + z.w / 2, y: z.y + z.h / 2 });
        st.ball.vx = z.dir.x * 0.5;
        st.ball.vy = z.dir.y * 0.5;
        st.moving = true;
        let t = 0;
        while (t < 4 && st.moving && z.x <= st.ball.x && st.ball.x <= z.x + z.w && z.y <= st.ball.y && st.ball.y <= z.y + z.h) {
          stepSim(st, h, cfg, 1 / 60);
          t += 1 / 60;
        }
        expect(t, `booster in hole ${i + 1}`).toBeLessThan(4);
      }
    });
  });
  it('a moving block shoving a resting ball never drops it in water or loses it', () => {
    HOLES.forEach((h, i) => {
      for (const m of h.movers) {
        const lo = moverRect(m, m.period * 0.75);
        const hi = moverRect(m, m.period * 0.25);
        const x0 = Math.min(lo.x, hi.x) - 0.4;
        const x1 = Math.max(lo.x + lo.w, hi.x + hi.w) + 0.4;
        for (let x = x0; x <= x1; x += 0.3) {
          for (const y of [m.cy - m.h / 2 - 0.25, m.cy, m.cy + m.h / 2 + 0.25]) {
            const p = { x, y };
            if (!isValidProgress({ diff: 'standard', hole: i, scores: new Array(i).fill(3), strokes: 0, ball: p })) continue;
            const st = newSim(h, p);
            st.time = m.period * 0.6;
            const ev: PhysEvent[] = [];
            for (let t = 0; t < m.period * 2.5; t += 1 / 60) ev.push(...stepSim(st, h, cfg, 1 / 60));
            expect(ev.some((e) => e.type === 'water' || e.type === 'rescue'), `hole ${i + 1} at ${x.toFixed(1)},${y.toFixed(2)}`).toBe(false);
            expect(st.strokes).toBe(0);
          }
        }
      }
    });
  });
  it('random putts on every hole settle quickly and never tunnel through a wall', () => {
    let seed = 99;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    HOLES.forEach((h, i) => {
      let st = newSim(h);
      for (let k = 0; k < 40; k++) {
        if (st.sunk || k % 8 === 0) st = newSim(h);
        const a = rnd() * Math.PI * 2;
        st.strokes = 0;
        shoot(st, { x: Math.cos(a), y: Math.sin(a) }, 0.05 + rnd() * 0.95);
        let t = 0;
        while (st.moving && t < 20) {
          const ev = stepSim(st, h, cfg, 1 / 60);
          expect(ev.some((e) => e.type === 'rescue'), `hole ${i + 1} shot ${k}`).toBe(false);
          t += 1 / 60;
        }
        expect(t, `hole ${i + 1} shot ${k} settle time`).toBeLessThan(10);
        expect(isBallLost(h, st.ball)).toBe(false);
      }
    });
  });
  it('hole 1 needs aim and touch: no straight-pull ace, and no hard-putt ace on pro', () => {
    const h = HOLES[0];
    const run = (deg: number, p: number, c = cfg) => {
      const st = newSim(h);
      const a = (deg * Math.PI) / 180;
      shoot(st, { x: Math.cos(a), y: Math.sin(a) }, p);
      runUntilRest(st, h, c, 25);
      return st;
    };
    const aim = (Math.atan2(h.cup.y - h.start.y, h.cup.x - h.start.x) * 180) / Math.PI;
    for (const d of DIFFICULTIES) {
      // Pulling straight down never drops, whatever the power.
      for (let off = -2; off <= 2; off += 0.5) {
        for (let p = 0.3; p <= 1.0001; p += 0.05) expect(run(270 + off, p, DIFF[d]).sunk, `${d} straight ${off}° p=${p.toFixed(2)}`).toBe(false);
      }
      // A well-judged putt at the cup still drops.
      expect(run(aim, 0.68, DIFF[d]).sunk, `${d} touch putt`).toBe(true);
    }
    // Over-hit putts at the cup do not drop on standard (they die in the back bunker) …
    for (let off = -2; off <= 2; off += 0.5) for (const p of [0.94, 1]) expect(run(aim + off, p).sunk, `standard ${off}° p=${p}`).toBe(false);
    // … and on pro no hard putt (≥ 0.8) drops from anywhere on the tee.
    for (let a = 0; a < 360; a += 1) for (let p = 0.8; p <= 1.0001; p += 0.04) expect(run(a, p, DIFF.pro).sunk, `pro ${a}° p=${p.toFixed(2)}`).toBe(false);
  }, 30000);
  it('hole 8 (crosswind) punishes the straight line and rewards compensating', () => {
    const h = HOLES[7];
    const shot = (deg: number, p: number, c = cfg) => {
      const st = newSim(h);
      const a = -Math.PI / 2 + (deg * Math.PI) / 180;
      shoot(st, { x: Math.cos(a), y: Math.sin(a) }, p);
      runUntilRest(st, h, c, 40);
      return st;
    };
    for (const p of [0.5, 0.6, 0.7]) {
      const st = shot(0, p);
      expect(st.sunk).toBe(false);
      expect(st.ball.x).toBeGreaterThan(h.cup.x + CUP_R); // blown to the right
    }
    for (const c of [DIFF.standard, DIFF.pro]) {
      const st = shot(-10, 0.6, c);
      expect(st.sunk).toBe(true);
      expect(st.strokes).toBe(1);
    }
  });
});
