/**
 * Greedy autoplay bot used by the balance tests (and handy for demos / integration smoke runs). It only uses the
 * public command API (build / upgrade / castAbility / moveHero / startWave), never touches state directly.
 *
 * Policy: keep a tower count that grows with the wave, building from a diversified cycle (with "need" overrides:
 * a beacon before stealth waves, anti-air before flying waves); place on the pad that covers the most (slow) path;
 * upgrade when nothing needs building and keep building past the curve once everything is maxed; keep two barriers
 * in the busiest kill zone; cast every ability when ready; walk the hero to infected towers, else to meet the most
 * advanced unrevealed prion (so the towers can see it), else guard the last stretch of the path; call waves early
 * when idle.
 *
 * The simulation is deterministic, so the seed varies the bot instead (spec §15.1): ±6 % noise on pad scores, a
 * 0.20–0.35 s decision interval and ±1 tower on the build curve. Same seed → same run; different seeds → different
 * (but equally reasonable) runs.
 */
import type { AbilityId, Difficulty, Enemy, GameState, ImmuneMemory, MapId, SpecId, Tower, TowerId } from '../types';
import { SIM_STEP, WAVES_PER_MAP } from '../types';
import { TOWERS } from './data';
import { mapInfo, pointOnPath, villiBonus } from './maps';
import { defaultMemory } from './memory';
import { createGame, takeEvents } from './state';
import { canStartWave, startWave, step } from './step';
import { build, canBuild, levelStats, towerAt, upgrade } from './towers';
import { castAbility, moveHero } from './hero';
import { buildCost, upgradeCost, wavePreview } from './waves';

export interface BotOptions {
  mapId: MapId;
  difficulty: Difficulty;
  seed?: number;
  memory?: ImmuneMemory;
  /** Stop after this wave is cleared (default 20). */
  waves?: number;
  /** Fixed build plan instead of the adaptive one (single-type experiments). */
  only?: TowerId;
  /** Decision interval (s). */
  think?: number;
  /** Experiment switches (default all on). */
  barriers?: boolean;
  abilities?: boolean;
  hero?: boolean;
  /** Re-plug a destroyed barrier immediately (default true). */
  rebuild?: boolean;
}

export interface BotWaveLog {
  wave: number;
  vitality: number;
  leaks: number;
  /** Seconds from wave start to clear. */
  duration: number;
  towers: number;
  atp: number;
}

export interface BotResult {
  mapId: MapId;
  difficulty: Difficulty;
  cleared: boolean;
  wave: number;
  vitality: number;
  maxVitality: number;
  vitLost: number;
  stars: number;
  towers: number;
  kills: number;
  time: number;
  log: BotWaveLog[];
  state: GameState;
}

const SPEC_CHOICE: Record<TowerId, SpecId> = {
  antibody: 'polyvalent',
  macrophage: 'fastDigestion',
  mast: 'allergyStorm',
  pyrogen: 'highFever',
  tcell: 'perforin',
  complement: 'longChain',
  beacon: 'potentiate',
  barrier: 'fibrin',
};

const CYCLE: TowerId[] = [
  'antibody',
  'antibody',
  'mast',
  'complement',
  'tcell',
  'macrophage',
  'mast',
  'pyrogen',
  'tcell',
  'complement',
  'beacon',
  'mast',
  'antibody',
  'tcell',
  'complement',
  'macrophage',
  'mast',
  'tcell',
  'pyrogen',
  'complement',
  'antibody',
  'tcell',
  'mast',
  'beacon',
  'tcell',
  'complement',
];

/** Before a stealth wave the bot wants at least this fraction of every path inside some beacon's reveal radius. */
const REVEAL_TARGET = 0.2;


interface PadInfo {
  col: number;
  row: number;
  villi: boolean;
}

export class GreedyBot {
  readonly s: GameState;
  private pads: PadInfo[];
  /** Path sample points with a time weight (seconds a baseline enemy spends there). */
  private samples: { x: number; y: number; w: number; frac: number; path: number }[] = [];
  private cycleIdx = 0;
  private nextThink = 0;
  private readonly think: number;
  private readonly only: TowerId | undefined;
  private readonly opts: { barriers: boolean; abilities: boolean; hero: boolean; rebuild: boolean };
  private barrierCooldownUntil = 0;
  /** xorshift32 state of the bot's own choices (never the simulation's). */
  private rng: number;
  private readonly noise: number;
  private readonly curveOffset: number;

  constructor(s: GameState, opts: { seed?: number; think?: number; only?: TowerId; barriers?: boolean; abilities?: boolean; hero?: boolean; rebuild?: boolean } = {}) {
    this.s = s;
    this.rng = (opts.seed ?? 12345) >>> 0 || 0x9e3779b9;
    for (let i = 0; i < 4; i++) this.rand();
    // seed 0 / undefined keeps the historical exact behaviour (no noise, 0.25 s, no curve offset)
    const varied = opts.seed !== undefined && opts.seed !== 0;
    this.noise = varied ? 0.06 : 0;
    this.think = opts.think ?? (varied ? 0.2 + 0.15 * this.rand() : 0.25);
    this.curveOffset = varied ? Math.floor(this.rand() * 3) - 1 : 0;
    this.only = opts.only;
    this.opts = { barriers: opts.barriers ?? true, abilities: opts.abilities ?? true, hero: opts.hero ?? true, rebuild: opts.rebuild ?? true };
    const map = s.map;
    this.pads = [
      ...map.pads.map(([col, row]) => ({ col, row, villi: false })),
      ...map.villi.map(([col, row]) => ({ col, row, villi: true })),
    ];
    for (const g of s.geoms) {
      for (let d = 0.25; d < g.length; d += 0.5) {
        const seg = Math.min(g.points.length - 2, Math.max(0, g.cum.findIndex((c) => c > d) - 1));
        const a = g.points[seg];
        const b = g.points[seg + 1];
        const t = (d - g.cum[seg]) / Math.max(1e-9, g.cum[seg + 1] - g.cum[seg]);
        const flow = g.segFlow[seg];
        const speed = flow === 1 ? 1.3 : flow === -1 ? 0.8 : 1;
        this.samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: 0.5 / speed, frac: d / g.length, path: g.pathIndex });
      }
    }
  }

  /**
   * Marginal coverage: every path sample within `r` counts its time weight (later samples a bit more), divided by
   * (1 + how many existing towers of the same role already cover it) so new towers spread over every path.
   */
  private coverage(x: number, y: number, r: number, role: 'dmg' | 'reveal'): number {
    let c = 0;
    const r2 = r * r;
    for (const p of this.samples) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy > r2) continue;
      let covered = 0;
      for (const t of this.s.towers) {
        if (t.type === 'barrier') continue;
        if ((role === 'reveal') !== (t.type === 'beacon')) continue;
        const st = levelStats(t.type, t.level, t.spec);
        const tr = role === 'reveal' ? (st.reveal ?? 2.5) : st.range + t.buff.range;
        if ((t.x - p.x) ** 2 + (t.y - p.y) ** 2 <= tr * tr) covered++;
      }
      c += (p.w * (0.75 + 0.5 * p.frac)) / (1 + (role === 'reveal' ? 4 : 0.6) * covered);
    }
    return c;
  }

  private padScore(p: PadInfo, type: TowerId): number {
    const st = TOWERS[type].levels[0];
    const x = p.col + 0.5;
    const y = p.row + 0.5;
    if (type === 'beacon') {
      let n = 0;
      for (const t of this.s.towers) {
        if (t.type === 'beacon' || t.type === 'barrier') continue;
        const r = st.range + (p.villi ? villiBonus(st.range) : 0);
        if ((t.x - x) ** 2 + (t.y - y) ** 2 <= r * r) n += 1 + t.level;
      }
      return n + 2 * this.coverage(x, y, (st.reveal ?? 2.5) + (p.villi ? 1 : 0), 'reveal');
    }
    const r = (type === 'tcell' ? 3.2 : st.range) + (p.villi ? villiBonus(st.range) : 0);
    return this.coverage(x, y, r, 'dmg');
  }

  /** Uniform [0, 1) from the bot's private xorshift32. */
  private rand(): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967296;
  }

  private bestPad(type: TowerId): PadInfo | null {
    let best: PadInfo | null = null;
    let bestScore = -1;
    for (const p of this.pads) {
      if (towerAt(this.s, p.col, p.row)) continue;
      const sc = this.padScore(p, type) * (1 + this.noise * (2 * this.rand() - 1));
      if (sc > bestScore + 1e-9) {
        bestScore = sc;
        best = p;
      }
    }
    return best;
  }

  private count(type: TowerId): number {
    let n = 0;
    for (const t of this.s.towers) if (t.type === type) n++;
    return n;
  }

  /** Lowest fraction of any path's samples inside a beacon's reveal radius. */
  private worstRevealCoverage(): number {
    let worst = 1;
    for (let p = 0; p < this.s.map.paths.length; p++) {
      let n = 0;
      let c = 0;
      for (const sm of this.samples) {
        if (sm.path !== p) continue;
        n++;
        for (const t of this.s.towers) {
          if (t.type !== 'beacon') continue;
          const r = levelStats('beacon', t.level, t.spec).reveal ?? 2.5;
          if ((t.x - sm.x) ** 2 + (t.y - sm.y) ** 2 <= r * r) {
            c++;
            break;
          }
        }
      }
      worst = Math.min(worst, n ? c / n : 1);
    }
    return worst;
  }

  /** Next tower type to build, honouring upcoming-wave needs. */
  private nextType(): TowerId {
    if (this.only) return this.only;
    const s = this.s;
    const next = wavePreview(s.mapId, s.wave + 1);
    const stealthSoon = next.stealth;
    const flyingSoon = next.flying;
    if (stealthSoon && this.worstRevealCoverage() < REVEAL_TARGET) return 'beacon';
    const air = this.count('antibody') + this.count('complement') + this.count('tcell');
    if (flyingSoon && air < 4) return air % 2 === 0 ? 'antibody' : 'complement';
    return CYCLE[this.cycleIdx % CYCLE.length];
  }

  private desiredTowers(): number {
    const w = Math.max(1, this.s.wave + (this.s.phase === 'wave' ? 0 : 1));
    return Math.max(1, Math.min(this.pads.length, 2 + Math.round(w * 0.9) + this.curveOffset));
  }

  private tryBuildOrUpgrade(): void {
    const s = this.s;
    for (let guard = 0; guard < 6; guard++) {
      const nonBarrier = s.towers.filter((t) => t.type !== 'barrier').length;
      // past the build curve, keep building once every tower is maxed (banked ATP is wasted ATP); the single-type
      // experiments keep the spec's fixed 2 + 0.9 w curve and the guard hero (§15.1)
      const maxed = !this.only && s.towers.every((t) => t.type === 'barrier' || upgradeCost(t) === null);
      if (nonBarrier < this.desiredTowers() || (maxed && nonBarrier > 0)) {
        const type = this.nextType();
        if (s.atp < buildCost(type)) return;
        const pad = this.bestPad(type);
        if (!pad) {
          this.cycleIdx++;
          return;
        }
        if (build(s, pad.col, pad.row, type)) {
          if (!this.only && type === CYCLE[this.cycleIdx % CYCLE.length]) this.cycleIdx++;
          continue;
        }
        return;
      }
      if (this.maintainBarriers()) continue;
      // Upgrade: lowest level first, then the most valuable type, then the best spot.
      const cands = s.towers.filter((t) => t.type !== 'barrier' && upgradeCost(t) !== null);
      if (!cands.length) return;
      const value = (t: Tower) => -t.level * 1000 + (t.type === 'tcell' ? 30 : t.type === 'mast' ? 25 : t.type === 'complement' ? 22 : t.type === 'antibody' ? 18 : t.type === 'beacon' ? 15 : 10);
      cands.sort((a, b) => value(b) - value(a) || a.id - b.id);
      const t = cands[0];
      const cost = upgradeCost(t) ?? Infinity;
      if (s.atp < cost) return;
      if (!upgrade(s, t.id, t.level === 2 ? SPEC_CHOICE[t.type] : undefined)) return;
    }
  }

  /** Keeps up to two barriers on the path cell covered by the most towers. Returns true when it spent ATP. */
  private maintainBarriers(): boolean {
    const s = this.s;
    if (this.only || !this.opts.barriers) return false;
    if (!this.opts.rebuild && s.time < this.barrierCooldownUntil) return false;
    const towers = s.towers.filter((t) => t.type !== 'barrier');
    if (towers.length < 6 || s.wave < 5) return false;
    const barriers = s.towers.filter((t) => t.type === 'barrier');
    if (barriers.length < 2 && s.atp >= buildCost('barrier')) {
      const mi = mapInfo(s.map);
      let best: [number, number] | null = null;
      let bestScore = 0;
      for (const g of s.geoms) {
        for (const [c, r] of g.cells) {
          if (!canBuild(s, c, r, 'barrier').ok) continue;
          if (barriers.some((b) => Math.abs(b.col - c) + Math.abs(b.row - r) < 3)) continue;
          let sc = 0;
          for (const t of towers) {
            const st = levelStats(t.type, t.level, t.spec);
            const rr = st.range + t.buff.range;
            if ((t.x - c - 0.5) ** 2 + (t.y - r - 0.5) ** 2 <= rr * rr) sc += t.level;
          }
          sc *= (mi.pathMask[r * s.map.cols + c] & 3) === 3 ? 2 : 1;
          if (sc > bestScore) {
            bestScore = sc;
            best = [c, r];
          }
        }
      }
      if (best && build(s, best[0], best[1], 'barrier')) {
        this.barrierCooldownUntil = s.time + 20;
        return true;
      }
    }
    for (const b of barriers) {
      if (b.level < 2 && s.atp >= (upgradeCost(b) ?? Infinity) + 150) {
        if (upgrade(s, b.id)) return true;
      }
    }
    return false;
  }

  private castAbilities(): void {
    const s = this.s;
    if (s.phase !== 'wave') return;
    const alive = s.enemies.filter((e) => !e.dead && !e.leaked);
    if (!alive.length) return;
    const boss = alive.some((e) => e.boss !== null);
    const ready = (id: AbilityId) => s.abilities[id].unlocked && s.abilities[id].readyAt <= s.time;
    if (ready('fever') && (alive.length >= 6 || boss)) castAbility(s, 'fever');
    if (ready('adrenaline') && (alive.length >= 6 || boss)) castAbility(s, 'adrenaline');
    if (ready('booster')) castAbility(s, 'booster');
    if (ready('antibiotic')) {
      let best: Enemy | null = null;
      let bestN = 0;
      for (const e of alive) {
        if (e.boss !== null && e.boss.burrowedUntil > s.time) continue;
        let n = 0;
        for (const o of alive) if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= 1.5 * 1.5) n += o.boss ? 4 : 1;
        const rem = s.geoms[e.pathIndex].length - e.dist;
        if (n > bestN || (n === bestN && best && rem < s.geoms[best.pathIndex].length - best.dist)) {
          bestN = n;
          best = e;
        }
      }
      if (best && bestN >= 3) castAbility(s, 'antibiotic', { x: best.x, y: best.y });
    }
  }

  private driveHero(): void {
    const s = this.s;
    const h = s.hero;
    if (!h.alive) return;
    let target: Tower | null = null;
    let bestD = Infinity;
    for (const t of s.towers) {
      if (t.infectedUntil <= s.time) continue;
      const d = (t.x - h.x) ** 2 + (t.y - h.y) ** 2;
      if (d < bestD) {
        bestD = d;
        target = t;
      }
    }
    if (target) {
      if (!h.dest || Math.abs(h.dest.x - target.x) > 0.01 || Math.abs(h.dest.y - target.y) > 0.01) moveHero(s, target.x, target.y);
      return;
    }
    // stealth: walk to meet the most advanced unrevealed prion past 40 % of its path, so the towers can see it
    if (!this.only && h.hp > h.maxHp * 0.4) {
      let pr: Enemy | null = null;
      let best = 0.4;
      for (const e of s.enemies) {
        if (!e.stealth || e.revealed || e.dead || e.leaked) continue;
        const f = e.dist / s.geoms[e.pathIndex].length;
        if (f > best) {
          best = f;
          pr = e;
        }
      }
      if (pr) {
        const g = s.geoms[pr.pathIndex];
        const p = pointOnPath(g, Math.min(g.length - 0.5, pr.dist + 1.2));
        if (!h.dest || Math.abs(h.dest.x - p.x) > 0.6 || Math.abs(h.dest.y - p.y) > 0.6) moveHero(s, p.x, p.y);
        return;
      }
    }
    if (h.dest) return;
    // Guard: 80 % along the first path, standing on the vessel.
    const g = s.geoms[0];
    const d = g.length * 0.8;
    const seg = Math.max(0, g.cum.findIndex((c) => c > d) - 1);
    const gx = g.points[seg + 1].x;
    const gy = g.points[seg + 1].y;
    if ((gx - h.x) ** 2 + (gy - h.y) ** 2 > 0.25 && h.hp > h.maxHp * 0.5) moveHero(s, gx, gy);
  }

  /** One decision tick (call every step; it throttles itself). */
  tick(): void {
    const s = this.s;
    if (s.time < this.nextThink) return;
    this.nextThink = s.time + this.think;
    if (s.phase === 'over' || s.phase === 'cleared') return;
    this.tryBuildOrUpgrade();
    if (this.opts.abilities) this.castAbilities();
    if (this.opts.hero) this.driveHero();
    if (canStartWave(s) && s.enemies.length === 0) startWave(s, s.phase === 'countdown');
  }
}

/** Plays a whole run with the greedy bot. Pure function of its options (deterministic). */
export function runBot(opts: BotOptions): BotResult {
  const memory = opts.memory ?? defaultMemory();
  const s = createGame({ mapId: opts.mapId, difficulty: opts.difficulty, memory, seed: opts.seed ?? 12345 });
  const bot = new GreedyBot(s, opts);
  const lastWave = opts.waves ?? WAVES_PER_MAP;
  const log: BotWaveLog[] = [];
  let waveStartAt = 0;
  let leaksBefore = 0;
  const maxSteps = Math.ceil((lastWave * 400) / SIM_STEP);
  for (let i = 0; i < maxSteps; i++) {
    bot.tick();
    step(s, SIM_STEP);
    for (const ev of takeEvents(s)) {
      if (ev.type === 'waveStart') {
        waveStartAt = s.time;
        leaksBefore = s.stats.leaks;
      } else if (ev.type === 'waveClear') {
        log.push({ wave: ev.wave, vitality: s.vitality, leaks: s.stats.leaks - leaksBefore, duration: s.time - waveStartAt, towers: s.towers.length, atp: Math.round(s.atp) });
      }
    }
    if (s.phase === 'over' || s.phase === 'cleared') break;
    if (s.endless && s.wave > lastWave) break;
    if (!s.endless && s.wave >= lastWave && s.phase === 'countdown') break;
  }
  const cleared = s.phase === 'cleared' || (s.stats.wavesCleared >= lastWave && s.phase !== 'over');
  return {
    mapId: opts.mapId,
    difficulty: opts.difficulty,
    cleared,
    wave: s.wave,
    vitality: s.vitality,
    maxVitality: s.maxVitality,
    vitLost: s.stats.vitLost,
    stars: s.stars,
    towers: s.towers.length,
    kills: s.stats.kills,
    time: s.time,
    log,
    state: s,
  };
}
