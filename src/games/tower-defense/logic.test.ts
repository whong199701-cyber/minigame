import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOSS_HP_MULT,
  BOSS_SKILLS,
  DIFFICULTIES,
  ENEMIES,
  MAPS,
  TOWERS,
  buyTalent,
  canStartWave,
  computeStars,
  continueEndless,
  createGame,
  createSnapshot,
  defaultMemory,
  deserialize,
  earlyBonus,
  effectiveBaseHp,
  enemyArmor,
  enemyHp,
  enemyReward,
  expandWave,
  findMap,
  grantVaccine,
  growth,
  interestFor,
  isHardUnlocked,
  isMapUnlocked,
  logic,
  mapInfo,
  noteRecorded,
  parseMemory,
  pathGeometry,
  pointOnPath,
  recordRun,
  resolveModifiers,
  respec,
  rewardFor,
  sellValue,
  serialize,
  snapshot,
  starsFor,
  startWave,
  step,
  takeEvents,
  talentPoints,
  talentView,
  totalStars,
  validateMap,
  virusRiskPads,
  waveBosses,
  waveClearBonus,
  waveEffectiveHp,
  wavePreview,
  waveScript,
} from './logic';
import type { GameEvent, ImmuneMemory, MapDef, TalentId } from './types';
import { MAP_IDS, MEMORY_VERSION, RUN_VERSION, SIM_STEP, TOWER_IDS, TOWER_SPECS } from './types';
import { GreedyBot } from './sim/bot';
import { arena, canonicalJson, hashJson, memoryWith, ofType, place, run, runUntil, spawnAt } from './sim/testkit';

// ── Maps (§1, §1.5) ─────────────────────────────────────────────────────────

describe('maps', () => {
  it('every shipped map validates', () => {
    for (const m of MAPS) expect(validateMap(m), m.id).toBeNull();
  });

  it('path cell counts and lengths match the spec', () => {
    const expected: Record<string, number[]> = { vessel: [34], alveoli: [32, 33], gut: [47], brain: [26, 26] };
    for (const m of MAPS) {
      m.paths.forEach((_, i) => {
        const g = pathGeometry(m, i);
        expect(g.cells.length, `${m.id}/${i}`).toBe(expected[m.id][i]);
        // Entry point sits one cell outside the grid, so length = cell count.
        expect(g.length).toBeCloseTo(g.cells.length, 9);
      });
    }
  });

  it('pads, villi and cores match the spec counts and never sit on a path', () => {
    const counts: Record<string, [number, number]> = { vessel: [25, 0], alveoli: [28, 0], gut: [21, 8], brain: [32, 0] };
    for (const m of MAPS) {
      expect([m.pads.length, m.villi.length], m.id).toEqual(counts[m.id]);
      const mi = mapInfo(m);
      const seen = new Set<number>();
      for (const [c, r] of [...m.pads, ...m.villi]) {
        const idx = r * m.cols + c;
        expect(mi.pathMask[idx], `${m.id} pad ${c},${r}`).toBe(0);
        expect(seen.has(idx)).toBe(false);
        seen.add(idx);
      }
      for (const p of m.paths) {
        const [c0, r0] = p.waypoints[0];
        expect(c0 === 0 || r0 === 0 || c0 === m.cols - 1 || r0 === m.rows - 1).toBe(true);
        const last = p.waypoints[p.waypoints.length - 1];
        expect(m.core.some(([c, r]) => c === last[0] && r === last[1])).toBe(true);
      }
    }
    expect(mapInfo(findMap('brain')).coreX).toBeCloseTo(5.0);
    expect(mapInfo(findMap('brain')).coreY).toBeCloseTo(14.5);
  });

  it('paths are contiguous (unit steps between consecutive cells)', () => {
    for (const m of MAPS) {
      m.paths.forEach((_, i) => {
        const g = pathGeometry(m, i);
        for (let k = 1; k < g.points.length; k++) {
          const d = Math.abs(g.points[k].x - g.points[k - 1].x) + Math.abs(g.points[k].y - g.points[k - 1].y);
          expect(d).toBeCloseTo(1, 9);
        }
      });
    }
  });

  it('Alveoli paths share the merged tail; Brain paths never share a cell', () => {
    const al = mapInfo(findMap('alveoli'));
    const idx = (m: MapDef, c: number, r: number) => r * m.cols + c;
    expect(al.pathMask[idx(al.map, 4, 4)]).toBe(3);
    expect(al.pathMask[idx(al.map, 5, 13)]).toBe(3);
    expect(al.pathMask[idx(al.map, 2, 2)]).toBe(1);
    const br = mapInfo(findMap('brain'));
    for (let i = 0; i < br.pathMask.length; i++) expect(br.pathMask[i]).not.toBe(3);
  });

  it('beacon footprints match §2.7 (other pads inside the buff disc)', () => {
    const foot = (id: 'vessel' | 'alveoli' | 'brain' | 'gut', c: number, r: number, R: number) => {
      const m = findMap(id);
      return [...m.pads, ...m.villi].filter(([pc, pr]) => !(pc === c && pr === r) && (pc - c) ** 2 + (pr - r) ** 2 <= R * R).length;
    };
    expect([foot('vessel', 3, 2, 2.0), foot('vessel', 3, 2, 2.6)]).toEqual([5, 5]);
    expect([foot('vessel', 4, 6, 2.0), foot('vessel', 4, 6, 2.6)]).toEqual([4, 6]);
    expect([foot('alveoli', 3, 8, 2.0), foot('alveoli', 3, 8, 2.6)]).toEqual([4, 6]);
    expect([foot('brain', 4, 4, 2.0), foot('brain', 4, 4, 2.6)]).toEqual([3, 5]);
    expect([foot('gut', 5, 8, 2.0), foot('gut', 5, 8, 2.6)]).toEqual([0, 3]);
  });

  it('barrier ban zones cover the first / last 3 cells of each path and the core', () => {
    const mi = mapInfo(findMap('vessel'));
    const at = (c: number, r: number) => mi.banMask[r * 9 + c] & mi.pathMask[r * 9 + c];
    expect(at(0, 1)).toBeTruthy();
    expect(at(2, 1)).toBeTruthy();
    expect(at(3, 1)).toBeFalsy();
    expect(at(4, 12)).toBeTruthy();
    expect(at(4, 11)).toBeTruthy();
    expect(at(4, 10)).toBeTruthy();
    expect(at(5, 10)).toBeFalsy();
  });

  describe('validateMap rejects broken maps', () => {
    const base = findMap('vessel');
    const clone = (patch: Partial<MapDef>): MapDef => ({ ...base, ...patch });
    const path = base.paths[0];
    it.each([
      ['diagonal segment', clone({ paths: [{ ...path, waypoints: [[0, 1], [7, 2], [4, 12]], flow: [1, 1] }] })],
      ['spawn not on an edge', clone({ paths: [{ ...path, waypoints: [[2, 2], [2, 12]], flow: [1] }], core: [[2, 12]] })],
      ['self crossing', clone({ paths: [{ ...path, waypoints: [[0, 1], [5, 1], [5, 4], [3, 4], [3, 0], [3, 12]], flow: [1, 1, 1, 1, 1] }], core: [[3, 12]] })],
      ['entry inside the grid', clone({ paths: [{ ...path, waypoints: [[0, 1], [0, 12]], flow: [1] }], core: [[0, 12]] })],
      ['pad on a path cell', clone({ pads: [...base.pads, [3, 1]] })],
      ['duplicate pad', clone({ pads: [...base.pads, [3, 0]] })],
      ['core not the last waypoint', clone({ core: [[4, 12], [8, 12]] })],
      ['flow length mismatch', clone({ paths: [{ ...path, flow: [1, 1] }] })],
      ['ban zone covers the path', clone({ barrierBan: 20 })],
      ['path passes through the core', clone({ core: [[4, 12], [3, 1]], paths: [path, { id: 'B', waypoints: [[0, 1], [3, 1]], flow: [1] }] })],
    ])('%s', (_name, m) => {
      expect(validateMap(m)).not.toBeNull();
    });
  });
});

// ── Geometry & flow (§5.2) ──────────────────────────────────────────────────

describe('path geometry and flow', () => {
  const vessel = findMap('vessel');
  const g = pathGeometry(vessel, 0);

  it('pointOnPath interpolates along the polyline from the off-grid entry', () => {
    expect(pointOnPath(g, 0)).toMatchObject({ x: -0.5, y: 1.5 });
    expect(pointOnPath(g, 1.5)).toMatchObject({ x: 1, y: 1.5 });
    const end = pointOnPath(g, 99);
    expect([end.x, end.y]).toEqual([4.5, 12.5]);
  });

  it('segment flow follows the waypoint table; corner cells belong to the entering segment', () => {
    // Row 4 (cells (6,4)…(1,4), dist 12…17) is against the flow; the corner (7,4) at dist 11 still belongs to seg 2.
    expect(pointOnPath(g, 10.6).flow).toBe(1);
    expect(pointOnPath(g, 11.5).flow).toBe(-1);
    expect(pointOnPath(g, 16.9).flow).toBe(-1);
    expect(pointOnPath(g, 17.2).flow).toBe(1);
    const gut = pathGeometry(findMap('gut'), 0);
    expect(pointOnPath(gut, 10).flow).toBe(0); // vertical connector is still
  });

  it('a bacterium walks Vessel in 23.4 s and the Superbug in 57.7 s (§1.1)', () => {
    for (const [type, expected] of [
      ['bacterium', 23.45],
      ['superbug', 57.7],
    ] as const) {
      const s = arena();
      s.vitality = 1000;
      const e = spawnAt(s, type, 0);
      const t0 = s.time;
      const ev = runUntil(s, () => e.leaked || e.dead, 90);
      expect(ofType(ev, 'leak').some((l) => l.enemy === e.id)).toBe(true);
      expect(s.time - t0).toBeCloseTo(expected, 0);
    }
  });
});

// ── Formulas (§3, conventions) ──────────────────────────────────────────────

describe('scaling formulas', () => {
  it('growth g(w)', () => {
    const ref: [number, number][] = [
      [1, 1],
      [5, 2.22],
      [10, 5.99],
      [15, 16.18],
      [20, 43.74],
      [25, 58.53],
      [30, 78.32],
    ];
    for (const [w, v] of ref) expect(growth(w)).toBeCloseTo(v, 1);
  });

  it('enemy HP references (§3)', () => {
    expect(enemyHp('superbug', 5)).toBe(1329);
    expect(enemyHp('superbug', 5, 1, 'hard')).toBe(1662);
    expect(enemyHp('superbug', 15)).toBe(9709);
    expect(enemyHp('giantParasite', 10)).toBe(8981);
    expect(enemyHp('virusKing', 20)).toBe(52483);
    expect(enemyHp('virusKing', 20, 1, 'hard')).toBe(65604);
    expect([1, 5, 10, 15, 20].map((w) => enemyHp('bacterium', w))).toEqual([40, 89, 239, 647, 1749]);
    expect(enemyHp('mutant', 13)).toBe(4349);
    expect(enemyHp('bacterium', 1, 1.2)).toBe(48);
  });

  it('per-map boss HP multiplier: Brain bosses (one of two unmerged paths) spawn at hpMult × BOSS_HP_MULT', () => {
    expect(BOSS_HP_MULT).toEqual({ vessel: 1, alveoli: 1, gut: 1, brain: 0.7 });
    const s = arena({ map: 'brain', wave: 20 });
    const vk = spawnAt(s, 'virusKing', 2, { frozen: true });
    const bac = spawnAt(s, 'bacterium', 3, { frozen: true });
    expect(vk.maxHp).toBe(enemyHp('virusKing', 20, 0.8 * 0.7));
    expect(bac.maxHp).toBe(enemyHp('bacterium', 20, 0.8)); // filler only uses hpMult
    const v = arena({ map: 'vessel', wave: 20 });
    expect(spawnAt(v, 'virusKing', 2, { frozen: true }).maxHp).toBe(enemyHp('virusKing', 20));
  });

  it('armor, reward and effective HP', () => {
    expect([3, 10, 20].map((w) => enemyArmor('encapsulated', w))).toEqual([4, 6, 9]);
    expect(enemyArmor('encapsulated', 3, 'hard')).toBe(5);
    expect(enemyArmor('bacterium', 25)).toBe(5); // endless: +k for everything
    expect(enemyReward('mutant', 13)).toBe(89);
    expect(rewardFor(25, 13)).toBe(37);
    expect(enemyReward('sporeling', 1, 'hard')).toBe(1);
    expect(effectiveBaseHp('spore')).toBe(86);
    expect(effectiveBaseHp('mutant')).toBe(640);
  });
});

// ── Waves (§8) ──────────────────────────────────────────────────────────────

describe('waves', () => {
  it('all 80 scripted waves expand to ≥ 1 enemy; boss waves hold exactly the listed boss', () => {
    const bosses = { 5: 'superbug', 10: 'giantParasite', 15: 'superbug', 20: 'virusKing' } as Record<number, string>;
    for (const m of MAPS) {
      for (let w = 1; w <= 20; w++) {
        const items = expandWave(m, waveScript(m.id, w), w);
        expect(items.length, `${m.id} w${w}`).toBeGreaterThan(0);
        const b = waveBosses(m.id, w);
        if (bosses[w]) expect(b, `${m.id} w${w}`).toEqual([bosses[w]]);
        else expect(b).toEqual([]);
      }
    }
  });

  it('smoothness rule: from wave 3, a non-boss wave adds ≤ 30 % effective HP on top of the growth step', () => {
    for (const m of MAPS) {
      for (let w = 3; w <= 20; w++) {
        if (waveBosses(m.id, w).length) continue;
        const ratio = waveEffectiveHp(m.id, w, m.hpMult) / waveEffectiveHp(m.id, w - 1, m.hpMult);
        // Composition step = ratio ÷ (g(w) / g(w − 1)); was 1.5 ÷ 1.15 at the old 1.15 growth (spec §8).
        expect(ratio / (growth(w) / growth(w - 1)), `${m.id} w${w}`).toBeLessThanOrEqual(1.3);
      }
      // At most one mutant per non-boss wave.
      for (let w = 1; w <= 20; w++) {
        const muts = waveScript(m.id, w).filter((g) => g.type === 'mutant').reduce((n, g) => n + g.count, 0);
        expect(muts).toBeLessThanOrEqual(1);
      }
    }
  });

  it('expandWave: gaps × tempo, 1.5 s between sequential groups, parallel groups start together', () => {
    const vessel = findMap('vessel');
    // Wave 4: vir×6; bac×10; +fla×4
    const items = expandWave(vessel, waveScript('vessel', 4), 4);
    const tempo = 1 - 0.015 * 3;
    const vir = items.filter((i) => i.type === 'virus');
    const bac = items.filter((i) => i.type === 'bacterium');
    const fla = items.filter((i) => i.type === 'flagellate');
    expect(vir[1].at - vir[0].at).toBeCloseTo(0.8 * tempo, 2);
    const virEnd = vir[vir.length - 1].at;
    expect(bac[0].at).toBeCloseTo(virEnd + 1.5, 5);
    expect(fla[0].at).toBeCloseTo(bac[0].at, 5);
    for (let i = 1; i < items.length; i++) expect(items[i].at).toBeGreaterThanOrEqual(items[i - 1].at);
  });

  it('two-spawn maps honour @A/@B and alternate for @alt', () => {
    const al = findMap('alveoli');
    const w1 = expandWave(al, waveScript('alveoli', 1), 1);
    expect(w1.slice(0, 6).every((i) => i.pathIndex === 0)).toBe(true);
    expect(w1.slice(6).every((i) => i.pathIndex === 1)).toBe(true);
    const w2 = expandWave(al, waveScript('alveoli', 2), 2);
    const fla = w2.filter((i) => i.type === 'flagellate').map((i) => i.pathIndex);
    expect(fla.slice(0, 4)).toEqual([0, 1, 0, 1]);
  });

  it('endless waves follow the deterministic rotation and boss cycle (§8.5)', () => {
    const w21 = waveScript('vessel', 21);
    expect(w21.map((g) => [g.type, g.count, g.parallel])).toEqual([
      ['bacterium', 11, false],
      ['encapsulated', 7, false],
      ['flagellate', 4, true],
      ['parasite', 2, false],
    ]);
    expect(waveBosses('vessel', 25)).toEqual(['superbug']);
    expect(waveBosses('vessel', 30)).toEqual(['giantParasite']);
    expect(waveBosses('vessel', 35)).toEqual(['virusKing', 'superbug']);
    expect(waveBosses('vessel', 50)).toEqual(['virusKing', 'superbug', 'giantParasite']);
    // Double bosses spawn 6 s apart.
    const items = expandWave(findMap('vessel'), waveScript('vessel', 35), 35);
    const b = items.filter((i) => ENEMIES[i.type].boss);
    expect(b[1].at - b[0].at).toBeCloseTo(6, 5);
    expect(waveScript('vessel', 22)).toEqual(waveScript('vessel', 22)); // pure
  });

  it('wavePreview aggregates types and flags boss / flying / stealth / virus', () => {
    const p = wavePreview('vessel', 20);
    expect(p.boss).toBe('virusKing');
    expect(p.flying && p.stealth && p.virus).toBe(true);
    expect(p.groups.find((g) => g.type === 'virus')?.count).toBe(12);
    const p1 = wavePreview('vessel', 1);
    expect(p1).toMatchObject({ boss: null, flying: false, stealth: false, virus: false, groups: [{ type: 'bacterium', count: 8 }] });
    expect(wavePreview('vessel', 35).boss2).toBe('superbug');
  });
});

// ── Economy (§9) ────────────────────────────────────────────────────────────

describe('economy', () => {
  it('wave bonus, early bonus, interest and sell value formulas', () => {
    expect([1, 10, 20].map((w) => waveClearBonus(w, 'normal'))).toEqual([31, 85, 145]);
    expect(waveClearBonus(10, 'hard')).toBe(72);
    expect(earlyBonus(5, 12, 'normal')).toBe(27);
    expect(earlyBonus(15, 12, 'normal')).toBe(57);
    expect(earlyBonus(15, 8, 'hard')).toBe(49);
    expect(earlyBonus(5, 0, 'normal')).toBe(0);
    expect(earlyBonus(5, 30, 'normal')).toBe(27); // capped at 12 s
    expect(interestFor(1000, 0.03, 60)).toBe(30);
    expect(interestFor(5000, 0.03, 60)).toBe(60);
    expect(interestFor(1000, 0, 60)).toBe(0);
    expect(sellValue({ invested: 185 })).toBe(130);
  });

  it('start ATP / vitality per difficulty and talents', () => {
    const n = createGame({ mapId: 'vessel', difficulty: 'normal', memory: defaultMemory(), seed: 1 });
    expect([n.atp, n.vitality, n.maxVitality]).toEqual([220, 20, 20]);
    const h = createGame({ mapId: 'vessel', difficulty: 'hard', memory: memoryWith(['reserve', 'metabolism', 'deepReserve']), seed: 1 });
    expect([h.atp, h.vitality]).toEqual([180 + 120, 15]);
  });

  it('kill rewards, wave-clear bonus with interest and tissue repair', () => {
    const s = arena({ memory: memoryWith(['reserve', 'metabolism', 'platelets', 'tissueRepair']) });
    s.atp = 1000;
    s.vitality = 15;
    const e = spawnAt(s, 'bacterium', 4, { frozen: true });
    e.hp = 0;
    s.waveState.queue = [];
    const ev = run(s, 0.1);
    const clear = ofType(ev, 'waveClear')[0];
    expect(ofType(ev, 'kill')[0].reward).toBe(5);
    expect(clear.bonus).toBe(31);
    expect(clear.interest).toBe(Math.floor(0.03 * (1000 + 5 + 31)));
    expect(clear.vitRestored).toBe(1);
    expect(s.vitality).toBe(16);
    expect(s.phase).toBe('countdown');
    expect(s.countdown).toBeCloseTo(12, 0);
  });

  it('early call grants the bonus for the remaining countdown; the countdown auto-starts the next wave', () => {
    const s = createGame({ mapId: 'vessel', difficulty: 'normal', memory: defaultMemory(), seed: 1 });
    expect(canStartWave(s)).toBe(true);
    expect(startWave(s)).toBe(0);
    expect(canStartWave(s)).toBe(false);
    expect(startWave(s, true)).toBe(-1);
    s.waveState.queue = [];
    s.enemies.length = 0;
    run(s, 0.05);
    expect(s.phase).toBe('countdown');
    run(s, 6);
    const before = s.atp;
    const bonus = startWave(s, true);
    expect(bonus).toBe(earlyBonus(2, s.countdown + 0, 'normal') || bonus);
    expect(bonus).toBeGreaterThan(0);
    expect(s.atp).toBe(before + bonus);
    expect(s.wave).toBe(2);
    // Auto start.
    s.waveState.queue = [];
    s.enemies.length = 0;
    run(s, 0.05);
    expect(s.phase).toBe('countdown');
    run(s, 12.1);
    expect(s.wave).toBe(3);
    expect(s.phase).toBe('wave');
  });

  it('hard countdown is 8 s', () => {
    expect(DIFFICULTIES.hard.countdown).toBe(8);
  });
});

// ── Stars (§5.8) & run flow ─────────────────────────────────────────────────

describe('stars and run end', () => {
  it('stars from total vitality lost', () => {
    expect([0, 2, 3, 10, 11, 19].map((l) => computeStars(l, 20))).toEqual([3, 3, 2, 2, 1, 1]);
    expect([1, 2, 7, 8].map((l) => computeStars(l, 15))).toEqual([3, 2, 2, 1]);
  });

  it('wave 20 clear → cleared with stars; continueEndless → countdown; leaks to 0 → over', () => {
    const s = arena({ wave: 20 });
    s.stats.vitLost = 3;
    s.waveState.queue = [];
    const ev = run(s, 0.05);
    expect(s.phase).toBe('cleared');
    expect(ofType(ev, 'mapCleared')[0].stars).toBe(2);
    expect(starsFor(s)).toBe(2);
    continueEndless(s);
    expect(s.phase).toBe('countdown');
    expect(s.endless).toBe(true);
    run(s, 12.1);
    expect(s.wave).toBe(21);
    expect(starsFor(s)).toBe(2);
    // Game over.
    s.vitality = 1;
    const e = spawnAt(s, 'bacterium', s.geoms[0].length - 0.01);
    const ev2 = run(s, 0.1);
    expect(ofType(ev2, 'leak')[0]).toMatchObject({ enemy: e.id, vit: 1, vitality: 0 });
    expect(ofType(ev2, 'gameOver')).toHaveLength(1);
    expect(s.phase).toBe('over');
    const t = s.time;
    run(s, 1);
    expect(s.time).toBeGreaterThan(t); // hero-only steps keep running
    expect(s.enemies.length).toBeGreaterThanOrEqual(0);
  });
});

// ── Immune memory (§10, §12.2) ──────────────────────────────────────────────

describe('immune memory', () => {
  const withStars = (n: number): ImmuneMemory => {
    const m = defaultMemory();
    let left = n;
    for (const id of MAP_IDS) {
      for (const d of ['normal', 'hard'] as const) {
        const k = Math.min(3, left);
        m.stars[id][d] = k;
        left -= k;
      }
    }
    return m;
  };

  it('default memory is valid and round-trips through parseMemory', () => {
    const m = defaultMemory();
    expect(m.v).toBe(MEMORY_VERSION);
    expect(parseMemory(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('parseMemory is lenient but rejects missing / newer versions', () => {
    expect(parseMemory(null)).toBeNull();
    expect(parseMemory('x')).toBeNull();
    expect(parseMemory({})).toBeNull();
    expect(parseMemory({ v: 'two' })).toBeNull();
    expect(parseMemory({ v: MEMORY_VERSION + 1 })).toBeNull();
    const m = parseMemory({
      v: 1,
      stars: { vessel: { normal: 9, hard: -2 }, gut: 'bad' },
      bestEndless: { vessel: { normal: -5, hard: 33 } },
      vaccines: { superbug: true, virusKing: 'yes' },
      talents: ['affinity', 'nope', 'affinity', 'maturation', 'sharpBlanc'],
      tutorialSeen: ['tut_build', 'tut_x'],
      prefs: { map: 'mars', difficulty: 'hard', speed: 3, quality: 'low' },
      stats: { runs: 'many', kills: 12 },
    });
    expect(m).not.toBeNull();
    const mm = m as ImmuneMemory;
    expect(mm.stars.vessel).toEqual({ normal: 3, hard: 0 });
    expect(mm.stars.gut).toEqual({ normal: 0, hard: 0 });
    expect(mm.bestEndless.vessel).toEqual({ normal: 0, hard: 33 });
    expect(mm.vaccines).toEqual({ superbug: true, giantParasite: false, virusKing: false });
    // sharpBlanc lacks toughBlanc → dropped; affinity + maturation cost 3 ≤ 3 stars.
    expect(mm.talents).toEqual(['affinity', 'maturation']);
    expect(mm.tutorialSeen).toEqual(['tut_build']);
    expect(mm.prefs).toEqual({ map: 'vessel', difficulty: 'hard', speed: 1, quality: 'low' });
    expect(mm.stats.runs).toBe(0);
    expect(mm.stats.kills).toBe(12);
  });

  it('parseMemory trims talents that exceed the available stars', () => {
    const raw = { ...withStars(1), talents: ['affinity', 'reserve', 'platelets'] };
    expect(parseMemory(raw)?.talents).toEqual(['affinity']);
  });

  it('talent purchase rules: prerequisites, cost, points, respec', () => {
    let m = withStars(10);
    expect(totalStars(m)).toBe(10);
    expect(talentPoints(m)).toBe(10);
    expect(buyTalent(m, 'maturation')).toBeNull(); // needs affinity
    m = buyTalent(m, 'affinity') as ImmuneMemory;
    m = buyTalent(m, 'maturation') as ImmuneMemory;
    expect(talentPoints(m)).toBe(7);
    expect(buyTalent(m, 'affinity')).toBeNull(); // already bought
    m = buyTalent(m, 'platelets') as ImmuneMemory;
    m = buyTalent(m, 'tissueRepair') as ImmuneMemory; // cost 4, requires platelets
    expect(talentPoints(m)).toBe(2);
    expect(buyTalent(m, 'deepReserve')).toBeNull(); // locked
    const view = talentView(m);
    expect(view.find((v) => v.id === 'tissueRepair')?.state).toBe('bought');
    expect(view.find((v) => v.id === 'deepReserve')?.state).toBe('locked');
    expect(view.find((v) => v.id === 'cytokines')?.state).toBe('available');
    expect(view.find((v) => v.id === 'rapidResponse')?.state).toBe('locked');
    const r = respec(m);
    expect(r.talents).toEqual([]);
    expect(talentPoints(r)).toBe(10);
    expect(m.talents.length).toBe(4); // pure
  });

  it('booster needs cytokines and 6 bought nodes', () => {
    let m = withStars(24);
    for (const t of ['affinity', 'reserve', 'platelets', 'toughBlanc', 'cytokines'] as TalentId[]) m = buyTalent(m, t) as ImmuneMemory;
    expect(buyTalent(m, 'booster')).toBeNull();
    m = buyTalent(m, 'maturation') as ImmuneMemory;
    expect(buyTalent(m, 'booster')?.talents).toContain('booster');
  });

  it('resolveModifiers maps every talent', () => {
    const all = resolveModifiers({ ...defaultMemory(), talents: [...(Object.keys(logic.talents) as TalentId[])], vaccines: { superbug: true, giantParasite: false, virusKing: true } });
    expect(all.dmgMult).toBeCloseTo(1.15, 9);
    expect(all).toMatchObject({
      startAtpBonus: 120,
      cooldownMult: 0.85,
      heroHpMult: 1.4,
      heroDmgMult: 1.25,
      heroMarkStacks: 2,
      heroRevealRadius: 3,
      heroCureRadius: 1.5,
      heroCureImmunity: 5,
      heroSpeedMult: 1.2,
      heroRespawn: 8,
      barrierHpMult: 1.3,
      interest: 0.03,
      interestCap: 60,
      vitPerWave: 1,
      boosterUnlocked: true,
      vaccines: { superbug: true, giantParasite: false, virusKing: true },
    });
    expect(resolveModifiers(defaultMemory())).toMatchObject({ dmgMult: 1, heroRespawn: 15, heroCureRadius: 0.6, heroCureImmunity: 3, heroRevealRadius: 2 });
  });

  it('vaccines, unlocks and recordRun', () => {
    const m0 = defaultMemory();
    const m1 = grantVaccine(m0, 'superbug', 123);
    expect(m0.vaccines.superbug).toBe(false);
    expect(m1.vaccines.superbug).toBe(true);
    expect(m1.vaccineDates.superbug).toBe(123);
    expect(grantVaccine(m1, 'superbug', 999)).toBe(m1); // idempotent
    expect(isMapUnlocked(m0, 'brain')).toBe(false);
    expect(isMapUnlocked(withStars(6), 'brain')).toBe(true);
    expect(isHardUnlocked(m0, 'vessel')).toBe(false);
    const s = createGame({ mapId: 'gut', difficulty: 'normal', memory: m0, seed: 1 });
    s.stars = 2;
    s.wave = 20;
    s.stats.kills = 300;
    s.stats.bossTypesKilled = ['giantParasite'];
    const r = recordRun(m0, s);
    expect(r.newStars).toBe(true);
    expect(r.newEndless).toBe(true);
    expect(r.memory.stars.gut.normal).toBe(2);
    expect(r.memory.bestEndless.gut.normal).toBe(20);
    expect(r.memory.stats).toMatchObject({ runs: 1, kills: 300 });
    expect(r.memory.vaccines.giantParasite).toBe(true);
    expect(isHardUnlocked(r.memory, 'gut')).toBe(true);
    const again = recordRun(r.memory, s);
    expect(again.newStars).toBe(false);
    expect(again.newEndless).toBe(false);
  });
});

// ── Persistence (§12.1) ─────────────────────────────────────────────────────

describe('run save', () => {
  function midGame(): ReturnType<typeof createGame> {
    const s = createGame({ mapId: 'vessel', difficulty: 'normal', memory: defaultMemory(), seed: 99 });
    const bot = new GreedyBot(s);
    runUntilBot(s, bot, () => s.wave >= 3 && s.phase === 'countdown');
    run(s, 4);
    return s;
  }

  it('round-trips a countdown save into a build-phase state', () => {
    const s = midGame();
    const save = serialize(s);
    expect(save.v).toBe(RUN_VERSION);
    const json = JSON.parse(JSON.stringify(save));
    const l = deserialize(json, defaultMemory());
    expect(l).not.toBeNull();
    const loaded = l as NonNullable<typeof l>;
    expect(loaded.phase).toBe('build');
    expect(loaded.wave).toBe(s.wave);
    expect(loaded.atp).toBe(s.atp);
    expect(loaded.towers.map((t) => [t.id, t.type, t.level, t.spec, t.col, t.row])).toEqual(s.towers.map((t) => [t.id, t.type, t.level, t.spec, t.col, t.row]));
    expect(loaded.map).toBe(findMap('vessel'));
    expect(loaded.geoms.length).toBe(1);
    expect(loaded.events).toEqual([]);
    expect(loaded.nextId).toBe(s.nextId);
    expect(canonicalJson(loaded.stats)).toBe(canonicalJson(s.stats));
  });

  it('re-applies the current memory on load (new talents count)', () => {
    const s = midGame();
    const barrier = s.towers.find((t) => t.type === 'barrier');
    const save = JSON.parse(JSON.stringify(serialize(s)));
    const loaded = deserialize(save, memoryWith(['platelets', 'cytokines', 'toughBlanc']));
    expect(loaded?.memory.barrierHpMult).toBe(1.3);
    expect(loaded?.abilities.fever.cooldown).toBeCloseTo(25.5);
    if (barrier) expect(loaded?.towers.find((t) => t.id === barrier.id)?.maxHp).toBeCloseTo(barrier.maxHp * 1.3);
  });

  it('rejects mid-wave, foreign, inconsistent and garbage saves without throwing', () => {
    const s = midGame();
    const good = () => JSON.parse(JSON.stringify(serialize(s)));
    const mem = defaultMemory();
    expect(deserialize(good(), mem)).not.toBeNull();
    const cases: [string, (x: ReturnType<typeof good>) => unknown][] = [
      ['null', () => null],
      ['string', () => 'save'],
      ['empty', () => ({})],
      ['old version', (x) => ({ ...x, v: 1 })],
      ['unknown map', (x) => ({ ...x, mapId: 'liver' })],
      ['map mismatch', (x) => ({ ...x, mapId: 'gut' })],
      ['mid-wave', (x) => ({ ...x, state: { ...x.state, phase: 'wave' } })],
      ['over', (x) => ({ ...x, state: { ...x.state, phase: 'over' } })],
      ['tower off pad', (x) => ({ ...x, state: { ...x.state, towers: [{ ...x.state.towers[0], col: 0, row: 0 }] } })],
      ['tower on path', (x) => ({ ...x, state: { ...x.state, towers: [{ ...x.state.towers.find((t: { type: string }) => t.type !== 'barrier'), col: 3, row: 1 }] } })],
      ['duplicate tower id', (x) => ({ ...x, state: { ...x.state, towers: [x.state.towers[0], { ...x.state.towers[1], id: x.state.towers[0].id }] } })],
      ['bad spec', (x) => ({ ...x, state: { ...x.state, towers: [{ ...x.state.towers[0], level: 3, spec: 'fibrin' }] } })],
      ['nextId too low', (x) => ({ ...x, state: { ...x.state, nextId: 1 } })],
      ['NaN atp', (x) => ({ ...x, state: { ...x.state, atp: 'lots' } })],
      ['no hero', (x) => ({ ...x, state: { ...x.state, hero: null } })],
      ['enemies present', (x) => ({ ...x, state: { ...x.state, enemies: [{}] } })],
      ['zero vitality', (x) => ({ ...x, state: { ...x.state, vitality: 0 } })],
    ];
    for (const [name, mk] of cases) expect(deserialize(mk(good()), mem), name).toBeNull();
  });

  it('survives random field corruption (fuzz): returns null or a state that steps cleanly', () => {
    const s = midGame();
    const base = JSON.stringify(serialize(s));
    const junk: unknown[] = [null, undefined, -1, 0, 1e309, 'x', [], {}, true, NaN, 3.5];
    let seed = 1234567;
    const rnd = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    const paths = (o: unknown, prefix: string[] = [], out: string[][] = []): string[][] => {
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          out.push([...prefix, k]);
          paths(v, [...prefix, k], out);
        }
      }
      return out;
    };
    const all = paths(JSON.parse(base));
    for (let i = 0; i < 300; i++) {
      const obj = JSON.parse(base);
      const p = all[Math.floor(rnd() * all.length)];
      let cur = obj;
      for (let k = 0; k < p.length - 1; k++) cur = cur[p[k]];
      cur[p[p.length - 1]] = junk[Math.floor(rnd() * junk.length)];
      let loaded: ReturnType<typeof deserialize> = null;
      expect(() => (loaded = deserialize(obj, defaultMemory()))).not.toThrow();
      if (loaded) {
        const st = loaded as NonNullable<ReturnType<typeof deserialize>>;
        startWave(st);
        expect(() => run(st, 2)).not.toThrow();
        expect(Number.isFinite(st.atp) && Number.isFinite(st.time)).toBe(true);
      }
    }
  });
});

// ── Determinism (§ conventions, §12.1) ──────────────────────────────────────

function runUntilBot(s: ReturnType<typeof createGame>, bot: GreedyBot, pred: () => boolean, max = 4000): void {
  const n = Math.round(max / SIM_STEP);
  for (let i = 0; i < n && !pred(); i++) {
    bot.tick();
    step(s, SIM_STEP);
    takeEvents(s);
    if (s.phase === 'over' || s.phase === 'cleared') break;
  }
}

describe('determinism', () => {
  it('logic sources never call Math.random', () => {
    const dir = join(__dirname, 'sim');
    const files = [join(__dirname, 'logic.ts'), ...readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f))];
    for (const f of files) {
      if (f.endsWith('.test.ts')) continue;
      expect(/Math\s*\.\s*random\s*\(/.test(readFileSync(f, 'utf8')), f).toBe(false);
    }
  });

  it('same seed + same bot → identical state hash after 8 waves (Alveoli: breathing, two spawns)', () => {
    const play = () => {
      const s = createGame({ mapId: 'alveoli', difficulty: 'normal', memory: defaultMemory(), seed: 42 });
      runUntilBot(s, new GreedyBot(s), () => s.wave >= 8 && s.phase === 'countdown');
      return hashJson(serialize(s).state);
    };
    expect(play()).toBe(play());
  });

  it('save / load round trip at wave 10 continues identically', () => {
    const s = createGame({ mapId: 'vessel', difficulty: 'normal', memory: defaultMemory(), seed: 5 });
    runUntilBot(s, new GreedyBot(s), () => s.wave >= 10 && s.phase === 'countdown');
    run(s, 4);
    const l = deserialize(JSON.parse(JSON.stringify(serialize(s))), defaultMemory());
    expect(l).not.toBeNull();
    const b = l as NonNullable<typeof l>;
    for (const st of [s, b]) {
      startWave(st, false);
      run(st, 40);
    }
    expect(hashJson(serialize(b).state)).toBe(hashJson(serialize(s).state));
  });
});

// ── Events & snapshot (§11.5) ───────────────────────────────────────────────

describe('events and snapshot', () => {
  it('takeEvents swaps two buffers: the drained array stays valid until the next call', () => {
    const s = arena();
    spawnAt(s, 'bacterium', 3);
    const a = takeEvents(s);
    expect(a.some((e) => e.type === 'spawn')).toBe(true);
    const copy = [...a];
    step(s, SIM_STEP);
    expect(a).toEqual(copy);
    const b = takeEvents(s);
    expect(b).not.toBe(a);
    const c = takeEvents(s);
    expect(c).toBe(a);
    expect(c.length).toBe(0);
  });

  it('snapshot fills SoA buffers, interpolates and leaves UI-owned fields alone', () => {
    const s = arena();
    const t = logic.build(s, 3, 2, 'antibody');
    const e = spawnAt(s, 'parasite', 5);
    run(s, 0.5);
    const snap = createSnapshot(s.map);
    snap.selection = { kind: 'tower', id: t?.id ?? 0 };
    snap.interaction = 'heroMove';
    snap.cursorX = 1;
    snapshot(s, snap, 0);
    expect(snap.enemies.count).toBe(1);
    expect(snap.enemies.x[0]).toBeCloseTo(e.px, 4);
    snapshot(s, snap, 1);
    expect(snap.enemies.x[0]).toBeCloseTo(e.x, 4);
    expect(snap.enemies.segCount[0]).toBe(5);
    expect(snap.enemies.segTotal).toBe(5);
    expect(snap.towerCount).toBe(1);
    expect(snap.towers[0].selected).toBe(true);
    expect(snap.towers[0].range).toBeCloseTo(2.6);
    expect(snap.interaction).toBe('heroMove');
    expect(snap.cursorX).toBe(1);
    expect(snap.hero.alive).toBe(true);
    expect(Number.isNaN(snap.hero.destX)).toBe(true);
    // Capacity overflow: simulated but not drawn.
    const small = createSnapshot(s.map, { enemies: 2, segments: 3 });
    spawnAt(s, 'bacterium', 6);
    spawnAt(s, 'bacterium', 7);
    snapshot(s, small, 0.5);
    expect(small.enemies.count).toBe(2);
    expect(small.enemies.segTotal).toBe(3);
  });

  it('discontinuity rule: |cur − prev| stays within 3 × speed × dt × 1.5 unless the step flagged a jump', () => {
    const s = createGame({ mapId: 'alveoli', difficulty: 'normal', memory: defaultMemory(), seed: 3 });
    const bot = new GreedyBot(s);
    let checked = 0;
    for (let i = 0; i < Math.round(400 / SIM_STEP) && s.wave <= 11 && s.phase !== 'over'; i++) {
      bot.tick();
      step(s, SIM_STEP);
      const ev = takeEvents(s) as GameEvent[];
      const jumped = new Set<number>();
      let all = false;
      for (const x of ev) {
        if (x.type === 'spawn') jumped.add(x.id);
        if (x.type === 'split') x.children.forEach((c) => jumped.add(c));
        if (x.type === 'flowReverse') all = true;
        if (x.type === 'bossSkill' && x.skill === 'burrow' && x.stage === 'end') jumped.add(x.boss);
      }
      if (all) continue;
      for (const e of s.enemies) {
        if (jumped.has(e.id)) continue;
        const d = Math.hypot(e.x - e.px, e.y - e.py);
        expect(d).toBeLessThanOrEqual(e.speed * 3 * SIM_STEP * 1.5 + 1e-9);
        checked++;
      }
      const h = s.hero;
      if (!ev.some((x) => x.type === 'heroRespawn')) expect(Math.hypot(h.x - h.px, h.y - h.py)).toBeLessThanOrEqual(2.6 * 1.2 * SIM_STEP * 1.5);
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

// ── API surface ─────────────────────────────────────────────────────────────

describe('logic object', () => {
  it('exposes the full ImmuneLogic surface and consistent data tables', () => {
    for (const k of ['createGame', 'step', 'takeEvents', 'snapshot', 'serialize', 'deserialize', 'towerStats', 'castAbility', 'moveHero', 'recordRun'] as const) {
      expect(typeof logic[k]).toBe('function');
    }
    expect(logic.maps.map((m) => m.id)).toEqual(['vessel', 'alveoli', 'gut', 'brain']);
    for (const id of TOWER_IDS) {
      const def = TOWERS[id];
      expect(def.id).toBe(id);
      for (const sp of TOWER_SPECS[id]) expect(def.specs[sp], `${id}/${sp}`).toBeDefined();
    }
    expect(BOSS_SKILLS.virusKing.map((d) => d.id)).toEqual(['massInfection', 'mutation', 'shedding']);
  });
});

describe('endless continuation after a clear (stats recorded once)', () => {
  it('recordRun counts the cleared part once, even when the endless run is saved, reloaded and then lost', () => {
    const m0 = defaultMemory();
    const s = createGame({ mapId: 'vessel', difficulty: 'normal', memory: m0, seed: 1 });
    Object.assign(s.stats, { kills: 400, bossKills: 4, wavesCleared: 20, playtime: 1200 });
    s.wave = 20;
    s.stars = 3;
    s.phase = 'cleared';
    const atClear = recordRun(m0, s);
    noteRecorded(s);
    expect(atClear.memory.stats).toMatchObject({ runs: 1, kills: 400, bossKills: 4, wavesCleared: 20, playtime: 1200 });
    // continue endless, clear wave 21, save at the countdown, reload
    continueEndless(s);
    Object.assign(s.stats, { kills: 450, wavesCleared: 21, playtime: 1290 });
    s.wave = 21;
    s.phase = 'countdown';
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(s))), atClear.memory);
    expect(loaded).not.toBeNull();
    expect(loaded!.stats.recorded).toEqual({ kills: 400, bossKills: 4, wavesCleared: 20, playtime: 1200 });
    // the reloaded endless run dies at wave 23
    Object.assign(loaded!.stats, { kills: 520, bossKills: 4, wavesCleared: 22, playtime: 1400 });
    loaded!.wave = 23;
    loaded!.phase = 'over';
    const atOver = recordRun(atClear.memory, loaded!);
    expect(atOver.memory.stats).toMatchObject({ runs: 1, kills: 520, bossKills: 4, wavesCleared: 22, playtime: 1400 });
    expect(atOver.memory.bestEndless.vessel.normal).toBe(23);
    expect(atOver.newStars).toBe(false);
  });

  it('a save without `recorded` (older build) loads as a fresh run; garbage there is clamped, not trusted', () => {
    const s = createGame({ mapId: 'gut', difficulty: 'normal', memory: defaultMemory(), seed: 1 });
    s.stats.kills = 30;
    const raw = JSON.parse(JSON.stringify(serialize(s)));
    delete raw.state.stats.recorded;
    expect(deserialize(raw, defaultMemory())!.stats.recorded).toBeNull();
    raw.state.stats.recorded = { kills: 999, bossKills: 'x', wavesCleared: -3, playtime: 5 };
    const l = deserialize(raw, defaultMemory());
    expect(l).not.toBeNull();
    expect(l!.stats.recorded).toEqual({ kills: 30, bossKills: 0, wavesCleared: 0, playtime: 0 });
  });
});

describe('virus risk pads (§5.3 biohazard glyph)', () => {
  it('lists exactly the pads within Chebyshev distance 1 of a cell a virus walks through', () => {
    for (const map of MAPS) {
      const risk = virusRiskPads(map);
      const key = (c: number, r: number) => `${c},${r}`;
      const set = new Set(risk.map(([c, r]) => key(c, r)));
      const walked: [number, number][] = [];
      for (const g of mapInfo(map).geoms) {
        walked.push([Math.floor(g.points[0].x), Math.floor(g.points[0].y)]);
        for (const [c, r] of g.cells) walked.push([c, r]);
      }
      for (const [c, r] of [...map.pads, ...map.villi]) {
        const near = walked.some(([wc, wr]) => Math.abs(wc - c) <= 1 && Math.abs(wr - r) <= 1);
        expect(set.has(key(c, r)), `${map.id} (${c},${r})`).toBe(near);
      }
      expect(virusRiskPads(map)).toBe(risk); // cached
    }
    const has = (id: string, c: number, r: number) => virusRiskPads(findMap(id as 'vessel')).some(([x, y]) => x === c && y === r);
    expect(has('vessel', 3, 0)).toBe(true);
    expect(has('gut', 9, 2)).toBe(true); // villi next to the right connector
    expect(has('brain', 4, 0)).toBe(false);
    expect(has('brain', 5, 0)).toBe(false);
    expect(has('alveoli', 4, 2)).toBe(false);
  });

  it('matches the infection rule: a virus walking the path infects only towers on risk pads', () => {
    const s = arena({ map: 'alveoli', wave: 4 });
    const safe = [4, 2] as const;
    const risky = virusRiskPads(s.map).find(([c, r]) => r < 6)!;
    const a = place(s, safe[0], safe[1], 'antibody');
    const b = place(s, risky[0], risky[1], 'antibody');
    for (const pi of [0, 1]) spawnAt(s, 'virus', 0.1, { path: pi });
    const ev = runUntil(s, () => s.enemies.every((e) => e.dead || e.leaked || e.dist > 12), 30);
    const infected = new Set(ofType(ev, 'infect').map((x) => x.tower));
    expect(infected.has(a.id)).toBe(false);
    expect(infected.has(b.id)).toBe(true);
  });
});
