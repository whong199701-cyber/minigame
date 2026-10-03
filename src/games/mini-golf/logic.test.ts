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
  collideSeg,
  distanceMap,
  formatVsPar,
  freeGrid,
  greedySolve,
  holeIssues,
  holeScore,
  isBallLost,
  moverRect,
  moverVel,
  newSim,
  pointInPoly,
  predictPath,
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
    expect(captureThreshold(cfg, 0)).toBeCloseTo(cfg.captureSpeed * 1.6);
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
    const sinks = (c = cfg, v = 10) => {
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
  it('hole 8 can be aced through the booster', () => {
    const h = HOLES[7];
    const st = newSim(h);
    shoot(st, { x: 0, y: -1 }, 0.45);
    runUntilRest(st, h, DIFF.pro, 40);
    expect(st.sunk).toBe(true);
    expect(st.strokes).toBe(1);
  });
});
