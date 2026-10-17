/**
 * Immune memory (§10, §12.2): talents, vaccines, stars, prefs. Every function is pure over a plain object.
 */
import type {
  BossId,
  Difficulty,
  GameState,
  ImmuneMemory,
  MapId,
  MemoryModifiers,
  RecordRunResult,
  TalentId,
  TalentView,
  TutorialId,
} from '../types';
import { BOSS_IDS, MAP_IDS, MEMORY_VERSION, TALENT_IDS } from '../types';
import { TALENTS } from './data';
import { findMap, isMapId } from './maps';

const TUTORIAL_IDS: readonly TutorialId[] = ['tut_build', 'tut_infect', 'tut_barrier', 'tut_boss', 'tut_mutation'];

export function defaultMemory(): ImmuneMemory {
  const per = () => ({ normal: 0, hard: 0 });
  return {
    v: MEMORY_VERSION,
    stars: { vessel: per(), alveoli: per(), gut: per(), brain: per() },
    bestEndless: { vessel: per(), alveoli: per(), gut: per(), brain: per() },
    vaccines: { superbug: false, giantParasite: false, virusKing: false },
    vaccineDates: {},
    talents: [],
    tutorialSeen: [],
    prefs: { map: 'vessel', difficulty: 'normal', speed: 1, quality: 'auto' },
    stats: { runs: 0, kills: 0, bossKills: 0, wavesCleared: 0, playtime: 0 },
  };
}

function cloneMemory(m: ImmuneMemory): ImmuneMemory {
  return {
    v: MEMORY_VERSION,
    stars: {
      vessel: { ...m.stars.vessel },
      alveoli: { ...m.stars.alveoli },
      gut: { ...m.stars.gut },
      brain: { ...m.stars.brain },
    },
    bestEndless: {
      vessel: { ...m.bestEndless.vessel },
      alveoli: { ...m.bestEndless.alveoli },
      gut: { ...m.bestEndless.gut },
      brain: { ...m.bestEndless.brain },
    },
    vaccines: { ...m.vaccines },
    vaccineDates: { ...m.vaccineDates },
    talents: [...m.talents],
    tutorialSeen: [...m.tutorialSeen],
    prefs: { ...m.prefs },
    stats: { ...m.stats },
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Per-version migration chain (§12.2). Empty today: v1 and v2 share the shape; missing fields are filled later. */
export function migrateMemory(raw: Record<string, unknown>): Record<string, unknown> {
  return raw;
}

function prereqsMet(id: TalentId, bought: readonly TalentId[]): boolean {
  const def = TALENTS[id];
  if (def.requiresAny.length && !def.requiresAny.some((r) => bought.includes(r))) return false;
  if (def.requiresCount !== undefined && bought.filter((b) => b !== id).length < def.requiresCount) return false;
  return true;
}

function talentCost(list: readonly TalentId[]): number {
  let n = 0;
  for (const t of list) n += TALENTS[t].cost;
  return n;
}

/** Drops talents whose prerequisites are missing (repeatedly) and, if over budget, the latest purchases. */
function sanitizeTalents(list: readonly TalentId[], stars: number): TalentId[] {
  let out = [...list];
  for (;;) {
    let changed = false;
    const kept: TalentId[] = [];
    for (const t of out) {
      if (prereqsMet(t, out)) kept.push(t);
      else changed = true;
    }
    out = kept;
    if (!changed && talentCost(out) > stars && out.length) {
      out.pop();
      changed = true;
    }
    if (!changed) return out;
  }
}

/**
 * Lenient reader (§12.2): accepts any object whose `v` is a number ≤ MEMORY_VERSION, migrates it, fills missing fields
 * from `defaultMemory()`, clamps stars to 0..3 and endless bests to ≥ 0, drops unknown / duplicate talent and
 * tutorial ids and talents whose prerequisites are missing. null only when `v` is missing, non-numeric or newer.
 */
export function parseMemory(raw: unknown): ImmuneMemory | null {
  if (!isObj(raw)) return null;
  if (typeof raw.v !== 'number' || !Number.isFinite(raw.v) || raw.v > MEMORY_VERSION) return null;
  const src = migrateMemory(raw);
  const m = defaultMemory();
  const stars = isObj(src.stars) ? src.stars : {};
  const best = isObj(src.bestEndless) ? src.bestEndless : {};
  for (const id of MAP_IDS) {
    const s = isObj(stars[id]) ? (stars[id] as Record<string, unknown>) : {};
    const b = isObj(best[id]) ? (best[id] as Record<string, unknown>) : {};
    for (const d of ['normal', 'hard'] as const) {
      m.stars[id][d] = Math.max(0, Math.min(3, Math.floor(finiteOr(s[d], 0))));
      m.bestEndless[id][d] = Math.max(0, Math.floor(finiteOr(b[d], 0)));
    }
  }
  const vac = isObj(src.vaccines) ? src.vaccines : {};
  const dates = isObj(src.vaccineDates) ? src.vaccineDates : {};
  for (const id of BOSS_IDS) {
    m.vaccines[id] = vac[id] === true;
    const d = dates[id];
    if (typeof d === 'number' && Number.isFinite(d)) m.vaccineDates[id] = d;
  }
  const tutorials = Array.isArray(src.tutorialSeen) ? src.tutorialSeen : [];
  for (const t of tutorials) if (TUTORIAL_IDS.includes(t as TutorialId) && !m.tutorialSeen.includes(t as TutorialId)) m.tutorialSeen.push(t as TutorialId);
  const prefs = isObj(src.prefs) ? src.prefs : {};
  if (isMapId(prefs.map)) m.prefs.map = prefs.map;
  if (prefs.difficulty === 'normal' || prefs.difficulty === 'hard') m.prefs.difficulty = prefs.difficulty;
  if (prefs.speed === 1 || prefs.speed === 2) m.prefs.speed = prefs.speed;
  if (prefs.quality === 'auto' || prefs.quality === 'high' || prefs.quality === 'low') m.prefs.quality = prefs.quality;
  const st = isObj(src.stats) ? src.stats : {};
  m.stats.runs = Math.max(0, Math.floor(finiteOr(st.runs, 0)));
  m.stats.kills = Math.max(0, Math.floor(finiteOr(st.kills, 0)));
  m.stats.bossKills = Math.max(0, Math.floor(finiteOr(st.bossKills, 0)));
  m.stats.wavesCleared = Math.max(0, Math.floor(finiteOr(st.wavesCleared, 0)));
  m.stats.playtime = Math.max(0, finiteOr(st.playtime, 0));
  const talents: TalentId[] = [];
  if (Array.isArray(src.talents)) {
    for (const t of src.talents) if (TALENT_IDS.includes(t as TalentId) && !talents.includes(t as TalentId)) talents.push(t as TalentId);
  }
  m.talents = sanitizeTalents(talents, totalStars(m));
  return m;
}

export function totalStars(memory: ImmuneMemory): number {
  let n = 0;
  for (const id of MAP_IDS) {
    const s = memory.stars[id];
    if (s) n += Math.max(0, Math.min(3, s.normal | 0)) + Math.max(0, Math.min(3, s.hard | 0));
  }
  return n;
}

export function talentPoints(memory: ImmuneMemory): number {
  return totalStars(memory) - talentCost(memory.talents);
}

export function talentView(memory: ImmuneMemory): TalentView[] {
  const pts = talentPoints(memory);
  return TALENT_IDS.map((id) => {
    const def = TALENTS[id];
    let state: TalentView['state'];
    if (memory.talents.includes(id)) state = 'bought';
    else if (!prereqsMet(id, memory.talents)) state = 'locked';
    else if (def.cost > pts) state = 'unaffordable';
    else state = 'available';
    return { id, def, state };
  });
}

export function buyTalent(memory: ImmuneMemory, id: TalentId): ImmuneMemory | null {
  if (!TALENTS[id] || memory.talents.includes(id)) return null;
  if (!prereqsMet(id, memory.talents)) return null;
  if (TALENTS[id].cost > talentPoints(memory)) return null;
  const m = cloneMemory(memory);
  m.talents.push(id);
  return m;
}

/** Refunds every node (points return, no cost). */
export function respec(memory: ImmuneMemory): ImmuneMemory {
  const m = cloneMemory(memory);
  m.talents = [];
  return m;
}

export function grantVaccine(memory: ImmuneMemory, boss: BossId, at: number): ImmuneMemory {
  if (memory.vaccines[boss] && memory.vaccineDates[boss] !== undefined) return memory;
  const m = cloneMemory(memory);
  m.vaccines[boss] = true;
  if (m.vaccineDates[boss] === undefined) m.vaccineDates[boss] = at;
  return m;
}

export function isMapUnlocked(memory: ImmuneMemory, id: MapId): boolean {
  return totalStars(memory) >= findMap(id).unlockStars;
}

export function isHardUnlocked(memory: ImmuneMemory, id: MapId): boolean {
  return (memory.stars[id]?.normal ?? 0) >= 1;
}

export function resolveModifiers(memory: ImmuneMemory): MemoryModifiers {
  const has = (t: TalentId) => memory.talents.includes(t);
  return {
    dmgMult: 1 + (has('affinity') ? 0.05 : 0) + (has('maturation') ? 0.1 : 0),
    startAtpBonus: (has('reserve') ? 40 : 0) + (has('deepReserve') ? 80 : 0),
    cooldownMult: has('cytokines') ? 0.85 : 1,
    heroHpMult: has('toughBlanc') ? 1.4 : 1,
    heroDmgMult: has('sharpBlanc') ? 1.25 : 1,
    heroMarkStacks: has('sharpBlanc') ? 2 : 1,
    heroRevealRadius: has('sharpBlanc') ? 3 : 2,
    heroCureRadius: has('rapidResponse') ? 1.5 : 0.6,
    heroCureImmunity: has('rapidResponse') ? 5 : 3,
    heroSpeedMult: has('rapidResponse') ? 1.2 : 1,
    heroRespawn: has('rapidResponse') ? 8 : 15,
    barrierHpMult: has('platelets') ? 1.3 : 1,
    interest: has('metabolism') ? 0.03 : 0,
    interestCap: 60,
    vitPerWave: has('tissueRepair') ? 1 : 0,
    boosterUnlocked: has('booster'),
    vaccines: { superbug: memory.vaccines.superbug === true, giantParasite: memory.vaccines.giantParasite === true, virusKing: memory.vaccines.virusKing === true },
  };
}

/**
 * Applies a finished (or ended) run to the memory (pure): stars (max per map/difficulty, only when wave 20 was
 * cleared), best wave reached (`bestEndless` = highest wave started, any run), cumulative stats, and any vaccine
 * whose boss was killed this run (safety net for a missed `vaccineUnlocked`). Call once per run end.
 */
export function recordRun(memory: ImmuneMemory, s: GameState): RecordRunResult {
  const m = cloneMemory(memory);
  const map: MapId = s.mapId;
  const diff: Difficulty = s.difficulty;
  const stars = s.stars > 0 ? s.stars : 0;
  const prevStars = m.stars[map][diff];
  const newStars = stars > prevStars;
  if (newStars) m.stars[map][diff] = Math.min(3, stars);
  const prevBest = m.bestEndless[map][diff];
  const newEndless = s.wave > prevBest;
  if (newEndless) m.bestEndless[map][diff] = s.wave;
  // an endless continuation is the same run: count only what happened since the recorded wave-20 clear
  const prev = s.stats.recorded;
  if (!prev) m.stats.runs += 1;
  m.stats.kills += Math.max(0, s.stats.kills - (prev?.kills ?? 0));
  m.stats.bossKills += Math.max(0, s.stats.bossKills - (prev?.bossKills ?? 0));
  m.stats.wavesCleared += Math.max(0, s.stats.wavesCleared - (prev?.wavesCleared ?? 0));
  m.stats.playtime += Math.max(0, s.stats.playtime - (prev?.playtime ?? 0));
  const killed = s.stats.bossTypesKilled ?? [];
  const now = Date.now();
  for (const b of killed) {
    if (!m.vaccines[b]) {
      m.vaccines[b] = true;
      if (m.vaccineDates[b] === undefined) m.vaccineDates[b] = now;
    }
  }
  return { memory: m, newStars, newEndless };
}

/**
 * Marks the run's current counters as recorded (call right after `recordRun` at the wave-20 clear). The run save
 * carries it, so a game over in endless after a reload does not count the cleared part twice.
 */
export function noteRecorded(s: GameState): void {
  const st = s.stats;
  st.recorded = { kills: st.kills, bossKills: st.bossKills, wavesCleared: st.wavesCleared, playtime: st.playtime };
}
