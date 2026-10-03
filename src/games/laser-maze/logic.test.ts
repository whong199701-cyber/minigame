import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES,
  DX,
  DY,
  EMITTER,
  EMPTY,
  MIRROR_B,
  MIRROR_S,
  SPLIT_B,
  SPLIT_S,
  TARGET,
  WALL,
  allTargetsLit,
  buildGrid,
  cellIndex,
  curveParams,
  fallbackLevel,
  generateLevel,
  generateWithParams,
  hintFor,
  levelParams,
  levelSeed,
  mirrorCode,
  nextOrient,
  orientOf,
  reflect,
  solve,
  traceBeam,
  type Dir,
  type Emitter,
  type Level,
  type Orient,
} from './logic';

function grid(size: number, cells: Record<string, number> = {}): Uint8Array {
  const g = new Uint8Array(size * size);
  for (const [k, v] of Object.entries(cells)) {
    const [x, y] = k.split(',').map(Number);
    g[y * size + x] = v;
  }
  return g;
}

describe('reflect', () => {
  it("'/' maps N↔E and S↔W", () => {
    expect(reflect(0, '/')).toBe(1);
    expect(reflect(1, '/')).toBe(0);
    expect(reflect(2, '/')).toBe(3);
    expect(reflect(3, '/')).toBe(2);
  });
  it("'\\' maps N↔W and S↔E", () => {
    expect(reflect(0, '\\')).toBe(3);
    expect(reflect(3, '\\')).toBe(0);
    expect(reflect(2, '\\')).toBe(1);
    expect(reflect(1, '\\')).toBe(2);
  });
  it('is an involution and always turns 90°', () => {
    for (const o of ['/', '\\'] as Orient[]) {
      for (const d of [0, 1, 2, 3] as Dir[]) {
        const r = reflect(d, o);
        expect(reflect(r, o)).toBe(d);
        expect(Math.abs(DX[d] * DX[r] + DY[d] * DY[r])).toBe(0);
      }
    }
  });
  it('mirror codes round-trip through orientOf', () => {
    expect(orientOf(mirrorCode('/'))).toBe('/');
    expect(orientOf(mirrorCode('\\'))).toBe('\\');
    expect(orientOf(SPLIT_S)).toBe('/');
    expect(orientOf(SPLIT_B)).toBe('\\');
    expect(orientOf(EMPTY)).toBeNull();
    expect(orientOf(WALL)).toBeNull();
  });
});

describe('traceBeam', () => {
  const em: Emitter = { x: 0, y: 2, dir: 1 };

  it('travels straight and stops at the border', () => {
    const g = grid(5, { '0,2': EMITTER });
    const tr = traceBeam(g, 5, em);
    expect(tr.visits.map((v) => `${v.x},${v.y}`)).toEqual(['0,2', '1,2', '2,2', '3,2', '4,2']);
    expect(tr.length).toBe(4.5); // 4 cells + half a cell to the edge
    expect(tr.capped).toBe(false);
    expect(tr.lit.size).toBe(0);
    const last = tr.segments[tr.segments.length - 1];
    expect(last.bx).toBe(5); // ends exactly on the grid edge
  });

  it('stops at walls (segment ends at the shared edge)', () => {
    const g = grid(5, { '0,2': EMITTER, '3,2': WALL });
    const tr = traceBeam(g, 5, em);
    expect(tr.visits.length).toBe(3);
    expect(tr.length).toBe(2.5);
    const last = tr.segments[tr.segments.length - 1];
    expect(last.bx).toBe(3);
    expect(last.by).toBe(2.5);
  });

  it('turns on mirrors in every direction', () => {
    // E → '/' → N
    let g = grid(5, { '0,2': EMITTER, '2,2': MIRROR_S });
    let tr = traceBeam(g, 5, em);
    expect(tr.visits.map((v) => `${v.x},${v.y},${v.dir}`)).toContain('2,1,0');
    expect(tr.hits.has(cellIndex(5, 2, 2))).toBe(true);
    // E → '\' → S
    g = grid(5, { '0,2': EMITTER, '2,2': MIRROR_B });
    tr = traceBeam(g, 5, em);
    expect(tr.visits.map((v) => `${v.x},${v.y},${v.dir}`)).toContain('2,3,2');
    // S → '/' → W
    g = grid(5, { '2,0': EMITTER, '2,2': MIRROR_S });
    tr = traceBeam(g, 5, { x: 2, y: 0, dir: 2 });
    expect(tr.visits.map((v) => `${v.x},${v.y},${v.dir}`)).toContain('1,2,3');
    // N → '\' → W
    g = grid(5, { '2,4': EMITTER, '2,2': MIRROR_B });
    tr = traceBeam(g, 5, { x: 2, y: 4, dir: 0 });
    expect(tr.visits.map((v) => `${v.x},${v.y},${v.dir}`)).toContain('1,2,3');
  });

  it('counts reflections per visit', () => {
    const g = grid(5, { '0,2': EMITTER, '2,2': MIRROR_S, '2,0': MIRROR_B });
    const tr = traceBeam(g, 5, em);
    const at = (x: number, y: number) => tr.visits.find((v) => v.x === x && v.y === y)!;
    expect(at(1, 2).refl).toBe(0);
    expect(at(2, 1).refl).toBe(1);
    expect(at(1, 0).refl).toBe(2);
  });

  it('splitters pass straight and turn, lighting targets on both branches', () => {
    const g = grid(5, { '0,2': EMITTER, '2,2': SPLIT_S, '4,2': TARGET, '2,0': TARGET });
    const tr = traceBeam(g, 5, em);
    expect(tr.lit.has(cellIndex(5, 4, 2))).toBe(true);
    expect(tr.lit.has(cellIndex(5, 2, 0))).toBe(true);
    expect(tr.hits.has(cellIndex(5, 2, 2))).toBe(true);
    const turned = tr.visits.find((v) => v.x === 2 && v.y === 1)!;
    const straight = tr.visits.find((v) => v.x === 3 && v.y === 2)!;
    expect(turned.refl).toBe(1);
    expect(straight.refl).toBe(0);
  });

  it('targets are transparent: the beam lights several in a row', () => {
    const g = grid(5, { '0,2': EMITTER, '1,2': TARGET, '3,2': TARGET });
    const tr = traceBeam(g, 5, em);
    expect(tr.lit.size).toBe(2);
    expect(tr.visits.length).toBe(5);
  });

  it('the emitter blocks a beam that comes back to it', () => {
    // E → '\\' at (2,2) → S → '/' at (2,4) → W → '\\' at (0,4) → N → arrives at the emitter (0,2) from below.
    const g = grid(5, { '0,2': EMITTER, '2,2': MIRROR_B, '2,4': MIRROR_S, '0,4': MIRROR_B });
    const tr = traceBeam(g, 5, em);
    expect(tr.visits.some((v) => v.x === 0 && v.y === 3)).toBe(true);
    expect(tr.visits.filter((v) => v.x === 0 && v.y === 2).length).toBe(1);
    expect(tr.capped).toBe(false);
  });

  it('terminates on a genuine loop via the visited set and honours the hard step cap', () => {
    // Circuit: splitter (2,2) '/', mirrors (4,2) '\\', (4,4) '/', (2,4) '\\'. The straight branch runs
    // round the circuit, re-enters the splitter from the south and its turned branch rejoins (3,2)→E.
    const g = grid(6, { '0,2': EMITTER, '2,2': SPLIT_S, '4,2': MIRROR_B, '4,4': MIRROR_S, '2,4': MIRROR_B });
    const tr = traceBeam(g, 6, em);
    expect(tr.capped).toBe(false);
    expect(tr.steps).toBeLessThan(40);
    const keys = tr.visits.map((v) => `${v.x},${v.y},${v.dir}`);
    expect(new Set(keys).size).toBe(keys.length);
    // The rejoin segment (2,2)→(3,2) is produced twice (first pass + loop) but traced only once.
    expect(tr.segments.filter((s) => s.ax === 2.5 && s.ay === 2.5 && s.bx === 3.5 && s.by === 2.5).length).toBe(2);
    const capped = traceBeam(g, 6, em, 3);
    expect(capped.capped).toBe(true);
    expect(capped.steps).toBe(3);
    expect(capped.visits.length).toBe(3);
  });

  it('stops at the default cap on a serpentine longer than 500 cells', () => {
    const size = 40;
    const g = new Uint8Array(size * size);
    g[cellIndex(size, 0, 0)] = EMITTER;
    for (let y = 0; y + 2 < size; y += 2) {
      g[cellIndex(size, size - 1, y)] = MIRROR_B; // E → S
      g[cellIndex(size, size - 1, y + 1)] = MIRROR_S; // S → W
      g[cellIndex(size, 0, y + 1)] = MIRROR_S; // W → S
      g[cellIndex(size, 0, y + 2)] = MIRROR_B; // S → E
    }
    const tr = traceBeam(g, size, { x: 0, y: 0, dir: 1 });
    expect(tr.capped).toBe(true);
    expect(tr.steps).toBe(500);
    expect(tr.visits.length).toBe(500);
    const uncapped = traceBeam(g, size, { x: 0, y: 0, dir: 1 }, 10000);
    expect(uncapped.capped).toBe(false);
    expect(uncapped.visits.length).toBeGreaterThan(1000);
  });
});

describe('buildGrid', () => {
  const level: Level = {
    size: 4,
    emitter: { x: 0, y: 1, dir: 1 },
    walls: [{ x: 3, y: 3 }],
    targets: [{ x: 2, y: 3 }],
    fixedMirrors: [{ x: 1, y: 0, orient: '/' }],
    splitters: [{ x: 2, y: 0, orient: '\\' }],
    mirrors: 1,
    solution: [{ x: 2, y: 1, orient: '\\' }],
    seed: 1,
  };
  it('encodes every fixed element', () => {
    const g = buildGrid(level);
    expect(g[cellIndex(4, 0, 1)]).toBe(EMITTER);
    expect(g[cellIndex(4, 3, 3)]).toBe(WALL);
    expect(g[cellIndex(4, 2, 3)]).toBe(TARGET);
    expect(g[cellIndex(4, 1, 0)]).toBe(MIRROR_S);
    expect(g[cellIndex(4, 2, 0)]).toBe(SPLIT_B);
    expect(g[cellIndex(4, 2, 1)]).toBe(EMPTY);
  });
  it('adds player mirrors only on empty cells', () => {
    const g = buildGrid(level, [
      { x: 2, y: 1, orient: '\\' },
      { x: 3, y: 3, orient: '/' },
    ]);
    expect(g[cellIndex(4, 2, 1)]).toBe(MIRROR_B);
    expect(g[cellIndex(4, 3, 3)]).toBe(WALL);
    expect(allTargetsLit(traceBeam(g, 4, level.emitter), level)).toBe(true);
  });
});

describe('solve', () => {
  it('finds a one-mirror solution', () => {
    const g = grid(5, { '0,2': EMITTER, '2,0': TARGET });
    const sol = solve(g, 5, { x: 0, y: 2, dir: 1 }, 1, 1);
    expect(sol).not.toBeNull();
    expect(sol!.length).toBe(1);
    expect(sol![0]).toEqual({ x: 2, y: 2, orient: '/' });
  });
  it('returns an empty list when already solved and null when impossible within the budget', () => {
    const g = grid(5, { '0,2': EMITTER, '3,2': TARGET });
    expect(solve(g, 5, { x: 0, y: 2, dir: 1 }, 1, 1)).toEqual([]);
    const two = grid(5, { '0,2': EMITTER, '2,0': TARGET, '4,0': TARGET });
    expect(solve(two, 5, { x: 0, y: 2, dir: 1 }, 2, 1)).toBeNull();
    const sol = solve(two, 5, { x: 0, y: 2, dir: 1 }, 2, 2);
    expect(sol).not.toBeNull();
    expect(sol!.length).toBe(2);
  });
});

describe('difficulty curve', () => {
  it('stays inside the brief ranges and escalates', () => {
    for (let L = 1; L <= 60; L++) {
      const p = curveParams(L);
      expect(p.size).toBeGreaterThanOrEqual(6);
      expect(p.size).toBeLessThanOrEqual(9);
      expect(p.targets).toBeGreaterThanOrEqual(1);
      expect(p.targets).toBeLessThanOrEqual(4);
      expect(p.mirrors).toBeGreaterThanOrEqual(2);
      expect(p.mirrors).toBeLessThanOrEqual(6);
      expect(p.walls + p.targets + p.mirrors + p.fixedMirrors + p.splitters).toBeLessThan(p.size * p.size / 2);
      if (L < 8) expect(p.splitters).toBe(0);
      else expect(p.splitters).toBeGreaterThanOrEqual(1);
    }
    expect(curveParams(1).size).toBe(6);
    expect(curveParams(40).size).toBe(9);
    expect(levelParams('hard', 1).size).toBeGreaterThan(levelParams('easy', 1).size);
  });
  it('seeds differ per mode and level', () => {
    const seen = new Set<number>();
    for (const m of DIFFICULTIES) for (let l = 1; l <= 50; l++) seen.add(levelSeed(m, l));
    expect(seen.size).toBe(150);
  });
});

function validateLevel(lv: Level, p: { targets: number; mirrors: number; size: number }, maxEasy: number): void {
  const { size } = lv;
  expect(size).toBe(p.size);
  expect(lv.targets.length).toBe(p.targets);
  expect(lv.solution.length).toBe(p.mirrors);
  expect(lv.mirrors).toBe(p.mirrors);
  // Emitter on the border pointing inward.
  const e = lv.emitter;
  const onBorder = e.x === 0 || e.y === 0 || e.x === size - 1 || e.y === size - 1;
  expect(onBorder).toBe(true);
  expect(e.x + DX[e.dir]).toBeGreaterThanOrEqual(0);
  expect(e.x + DX[e.dir]).toBeLessThan(size);
  expect(e.y + DY[e.dir]).toBeGreaterThanOrEqual(0);
  expect(e.y + DY[e.dir]).toBeLessThan(size);
  // Every element on its own cell.
  const base = buildGrid(lv);
  const occupied = new Set<number>();
  const all = [...lv.walls, ...lv.targets, ...lv.fixedMirrors, ...lv.splitters, ...lv.solution, lv.emitter];
  for (const c of all) {
    const i = cellIndex(size, c.x, c.y);
    expect(occupied.has(i)).toBe(false);
    occupied.add(i);
  }
  for (const s of lv.solution) expect(base[cellIndex(size, s.x, s.y)]).toBe(EMPTY);
  // The empty board lights nothing; the solution lights everything.
  expect(traceBeam(base, size, e).lit.size).toBe(0);
  const solved = traceBeam(buildGrid(lv, lv.solution), size, e);
  expect(solved.capped).toBe(false);
  expect(solved.lit.size).toBe(lv.targets.length);
  expect(allTargetsLit(solved, lv)).toBe(true);
  // Every hidden mirror is used by the beam (so the solution needs >= 2 reflections).
  for (const s of lv.solution) expect(solved.hits.has(cellIndex(size, s.x, s.y))).toBe(true);
  expect(lv.solution.length).toBeGreaterThanOrEqual(2);
  // Not solvable with too few mirrors.
  if (maxEasy >= 1) expect(solve(base, size, e, lv.targets.length, maxEasy)).toBeNull();
}

describe('generateLevel', () => {
  it('builds valid, solvable, non-trivial levels for every track', () => {
    for (const mode of DIFFICULTIES) {
      for (let level = 1; level <= 16; level++) {
        const p = levelParams(mode, level);
        const lv = generateWithParams(p, levelSeed(mode, level));
        expect(lv, `${mode} ${level}`).not.toBeNull();
        validateLevel(lv!, p, Math.min(2, p.mirrors - 1));
      }
    }
  });
  it('is deterministic and never falls back for far levels', () => {
    const a = generateLevel('medium', 9);
    const b = generateLevel('medium', 9);
    expect(a).toEqual(b);
    for (const level of [20, 33, 47, 120]) {
      const p = levelParams('hard', level);
      const lv = generateLevel('hard', level);
      expect(lv.size).toBe(p.size);
      expect(lv.targets.length).toBe(p.targets);
      validateLevel(lv, p, 0);
    }
  });
  it('places splitters from curve level 8 and the solution uses them', () => {
    const lv = generateLevel('easy', 8);
    expect(lv.splitters.length).toBeGreaterThanOrEqual(1);
    const solved = traceBeam(buildGrid(lv, lv.solution), lv.size, lv.emitter);
    for (const s of lv.splitters) expect(solved.hits.has(cellIndex(lv.size, s.x, s.y))).toBe(true);
  });
  it('fallback level is valid', () => {
    const lv = fallbackLevel(7);
    validateLevel(lv, { size: 6, targets: 2, mirrors: 2 }, 1);
  });
});

describe('hintFor', () => {
  const lv = fallbackLevel(1);
  const key = (x: number, y: number) => cellIndex(lv.size, x, y);
  it('suggests the first mirror along the beam when the board is empty', () => {
    const h = hintFor(lv, new Map());
    expect(h).toEqual({ place: lv.solution[0] });
  });
  it('fixes a wrongly oriented mirror in place', () => {
    const placed = new Map<number, Orient>([[key(3, 2), '/']]);
    const h = hintFor(lv, placed);
    expect(h!.place).toEqual(lv.solution[0]);
    expect(h!.remove).toBeUndefined();
  });
  it('frees a misplaced mirror when the budget is exhausted', () => {
    const placed = new Map<number, Orient>([
      [key(1, 1), '/'],
      [key(4, 4), '\\'],
    ]);
    const h = hintFor(lv, placed);
    expect(h!.place).toEqual(lv.solution[0]);
    expect([key(1, 1), key(4, 4)]).toContain(h!.remove);
  });
  it('returns null once the solution is on the board', () => {
    const placed = new Map<number, Orient>(lv.solution.map((s) => [key(s.x, s.y), s.orient]));
    expect(hintFor(lv, placed)).toBeNull();
  });
});

describe('nextOrient', () => {
  it("cycles empty → '/' → '\\' → empty", () => {
    expect(nextOrient(undefined)).toBe('/');
    expect(nextOrient('/')).toBe('\\');
    expect(nextOrient('\\')).toBeNull();
  });
});
