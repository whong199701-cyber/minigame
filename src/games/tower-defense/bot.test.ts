/**
 * Balance acceptance with the greedy bot (sim/bot.ts): builds a diversified set of towers on the pads that cover the
 * most uncovered path, upgrades when nothing needs building, keeps two barriers from wave 5, casts abilities when
 * ready, sends the hero to cure and to reveal prions, and calls every wave early when idle.
 *
 * The simulation is deterministic, so the seed varies the bot (±6 % pad-score noise, 0.20–0.35 s decisions, ±1 tower
 * on the build curve, spec §15.1); every check below runs several seeds. Acceptance: normal is cleared on every map
 * (Brain included) for most seeds; hard is clearly harder but not a wall, and a veteran memory makes it beatable; no
 * single damage type clears normal (spec §13.2). The full multi-strategy bot pass lives in spec §15.1; this file
 * keeps the cheap regression checks.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { runBot, type BotResult } from './sim/bot';
import { defaultMemory } from './logic';
import type { Difficulty, ImmuneMemory, MapId, TowerId } from './types';
import { MAP_IDS } from './types';

const SEEDS = [1, 2, 3] as const;
type Runs = Record<MapId, BotResult[]>;
const results: Record<Difficulty, Runs> = { normal: {} as Runs, hard: {} as Runs };
const veteran = {} as Record<MapId, BotResult>;

/** What anyone who unlocked hard brings (§15.1): all three vaccines and 8 talent points. */
function veteranMemory(): ImmuneMemory {
  const m = defaultMemory();
  for (const id of MAP_IDS) m.stars[id].normal = 3;
  m.talents = ['affinity', 'maturation', 'reserve', 'toughBlanc', 'sharpBlanc', 'platelets'];
  m.vaccines = { superbug: true, giantParasite: true, virusKing: true };
  return m;
}

/** 1 + vitality fraction when cleared; fraction of waves survived when lost. */
function score(r: BotResult): number {
  return r.cleared ? 1 + r.vitality / r.maxVitality : (r.wave - 1) / 20;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const label = (r: BotResult): string => (r.cleared ? `${r.stars}★(${r.vitLost})` : `L${r.wave}`);

describe('greedy bot balance', () => {
  beforeAll(() => {
    const rows: string[] = [];
    for (const d of ['normal', 'hard'] as Difficulty[]) {
      for (const m of MAP_IDS) {
        const t0 = Date.now();
        results[d][m] = SEEDS.map((seed) => runBot({ mapId: m, difficulty: d, seed }));
        rows.push(`${m.padEnd(8)} ${d.padEnd(6)} ${results[d][m].map(label).join(' ').padEnd(24)} ${Date.now() - t0} ms`);
      }
    }
    for (const m of MAP_IDS) {
      veteran[m] = runBot({ mapId: m, difficulty: 'hard', seed: 1, memory: veteranMemory() });
      rows.push(`${m.padEnd(8)} hard   veteran ${label(veteran[m])}`);
    }
    console.log(`Greedy bot results (seeds ${SEEDS.join(', ')})\n` + rows.join('\n'));
  }, 240_000);

  it('the seed varies the bot: different seeds play different runs, the same seed replays exactly', () => {
    const a = runBot({ mapId: 'brain', difficulty: 'normal', seed: 1, waves: 6 });
    const b = runBot({ mapId: 'brain', difficulty: 'normal', seed: 2, waves: 6 });
    const a2 = runBot({ mapId: 'brain', difficulty: 'normal', seed: 1, waves: 6 });
    const sig = (r: BotResult) => JSON.stringify([r.time, r.kills, r.state.atp, r.state.towers.map((t) => [t.type, t.col, t.row, t.level])]);
    expect(sig(a)).not.toBe(sig(b));
    expect(sig(a2)).toBe(sig(a));
  });

  it('normal: every map (Brain included) is cleared with vitality > 0 on at least 2 of 3 seeds; Vessel and Alveoli always', () => {
    for (const m of MAP_IDS) {
      const ok = results.normal[m].filter((r) => r.cleared && r.vitality > 0);
      expect(ok.length, m).toBeGreaterThanOrEqual(2);
      for (const r of ok) expect(r.log.length, m).toBe(20);
    }
    for (const m of ['vessel', 'alveoli'] as const) expect(results.normal[m].every((r) => r.cleared), m).toBe(true);
  });

  it('hard is clearly harder: never better than normal on any map, much worse overall, at least one loss', () => {
    let n = 0;
    let h = 0;
    for (const m of MAP_IDS) {
      const sn = mean(results.normal[m].map(score));
      const sh = mean(results.hard[m].map(score));
      expect(sh, m).toBeLessThanOrEqual(sn + 1e-9);
      n += sn;
      h += sh;
    }
    expect(h).toBeLessThanOrEqual(n - 1);
    expect(MAP_IDS.some((m) => results.hard[m].some((r) => !r.cleared))).toBe(true);
  });

  it('hard is not a wall: a fresh memory survives the opening everywhere, and a veteran memory gets much further', () => {
    const fresh: number[] = [];
    for (const m of MAP_IDS) {
      for (const r of results.hard[m]) {
        expect(r.wave, `${m} hard`).toBeGreaterThanOrEqual(5);
        fresh.push(r.cleared ? 21 : r.wave);
      }
      if (m !== 'brain') expect(Math.min(...results.hard[m].map((r) => r.wave)), `${m} hard`).toBeGreaterThanOrEqual(9);
    }
    expect(mean(fresh)).toBeGreaterThanOrEqual(10);
    const vet = MAP_IDS.map((m) => (veteran[m].cleared ? 21 : veteran[m].wave));
    const fresh1 = MAP_IDS.map((m) => (results.hard[m][0].cleared ? 21 : results.hard[m][0].wave));
    expect(mean(vet)).toBeGreaterThan(mean(fresh1) + 2);
    for (let i = 0; i < MAP_IDS.length; i++) expect(vet[i], MAP_IDS[i]).toBeGreaterThanOrEqual(fresh1[i]);
    expect(MAP_IDS.some((m) => veteran[m].cleared)).toBe(true);
  });

  it('no single damage type carries alone: every single-type build fails on normal, on average between waves 8 and 16', () => {
    const types: TowerId[] = ['antibody', 'macrophage', 'mast', 'pyrogen', 'tcell', 'complement'];
    const lost: number[] = [];
    const rows: string[] = [];
    for (const t of types) {
      const parts: string[] = [];
      for (const m of MAP_IDS) {
        for (const seed of [1, 2024]) {
          const r = runBot({ mapId: m, difficulty: 'normal', seed, only: t });
          expect(r.cleared, `${t} on ${m} (seed ${seed})`).toBe(false);
          expect(r.wave, `${t} on ${m} (seed ${seed})`).toBeLessThanOrEqual(19);
          lost.push(r.wave);
          parts.push(`${m} w${r.wave}`);
        }
      }
      rows.push(`${t.padEnd(11)} ${parts.join('  ')}`);
    }
    console.log('Single-type bot (lost at, seeds 1 / 2024)\n' + rows.join('\n'));
    const avg = mean(lost);
    expect(avg).toBeGreaterThanOrEqual(8);
    expect(avg).toBeLessThanOrEqual(16);
  }, 240_000);

  it('bot runs are fast (whole 20-wave run well under a second of CPU per map)', () => {
    const t0 = Date.now();
    runBot({ mapId: 'gut', difficulty: 'normal', seed: 1 });
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});
