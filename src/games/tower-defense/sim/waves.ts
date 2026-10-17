/**
 * Wave scripts, enemy scaling formulas and the economy (§3, §8, §9). Pure functions.
 */
import type { BossId, Difficulty, EnemyId, MapDef, MapId, SpawnGroup, SpawnItem, SpawnSel, TowerId, WavePreview } from '../types';
import { WAVES_PER_MAP } from '../types';
import {
  BOSS_STAGGER,
  DIFFICULTIES,
  ENDLESS_BOSS_CYCLE,
  ENDLESS_GROWTH,
  ENDLESS_ROTATION,
  ENEMIES,
  GROUP_PAUSE,
  HP_GROWTH,
  SELL_RATIO,
  SHORT_IDS,
  TOWERS,
  WAVE_SCRIPTS,
} from './data';

// ── Growth and per-enemy scaling (§ conventions, §3) ────────────────────────

const G20 = Math.pow(HP_GROWTH, WAVES_PER_MAP - 1);

/** HP growth g(w): HP_GROWTH^(w−1) (1.22) up to wave 20, then g(20) · ENDLESS_GROWTH^(w−20) (1.06). */
export function growth(wave: number): number {
  const w = Math.max(1, wave);
  return w <= WAVES_PER_MAP ? Math.pow(HP_GROWTH, w - 1) : G20 * Math.pow(ENDLESS_GROWTH, w - WAVES_PER_MAP);
}

/** Endless speed factor min(1.3, 1 + 0.01 (w − 20)) for w > 20. */
export function endlessSpeed(wave: number): number {
  return wave > WAVES_PER_MAP ? Math.min(1.3, 1 + 0.01 * (wave - WAVES_PER_MAP)) : 1;
}

export function enemyHp(type: EnemyId, wave: number, mapHpMult = 1, difficulty: Difficulty = 'normal'): number {
  return Math.round(ENEMIES[type].hp * growth(wave) * mapHpMult * DIFFICULTIES[difficulty].hpMult);
}

export function enemyArmor(type: EnemyId, wave: number, difficulty: Difficulty = 'normal'): number {
  const w = Math.max(1, wave);
  return Math.round(ENEMIES[type].armor * (1 + 0.06 * (w - 1))) + DIFFICULTIES[difficulty].armorBonus + Math.max(0, w - WAVES_PER_MAP);
}

/** DPS against barriers (×0.25 against the hero). `baseAttack` overrides the table (mutant halves use the parent's). */
export function enemyAttack(type: EnemyId, wave: number): number {
  return ENEMIES[type].attack * (1 + 0.08 * (Math.max(1, wave) - 1));
}

export function rewardFor(baseReward: number, wave: number, difficulty: Difficulty = 'normal'): number {
  return Math.max(1, Math.round(baseReward * (1 + 0.04 * (Math.max(1, wave) - 1)) * DIFFICULTIES[difficulty].rewardMult));
}

export function enemyReward(type: EnemyId, wave: number, difficulty: Difficulty = 'normal'): number {
  return rewardFor(ENEMIES[type].reward, wave, difficulty);
}

export function enemySpeed(baseSpeed: number, wave: number, difficulty: Difficulty = 'normal'): number {
  return baseSpeed * DIFFICULTIES[difficulty].speedMult * endlessSpeed(wave);
}

// ── Economy (§9.2) ──────────────────────────────────────────────────────────

export function waveClearBonus(wave: number, difficulty: Difficulty): number {
  return Math.round((25 + 6 * wave) * DIFFICULTIES[difficulty].rewardMult);
}

/**
 * Early-call bonus for calling `wave` (the wave about to start) with `remaining` countdown seconds left (max 12).
 * Wave 5 with 12 s left = 27; wave 15 = 57; hard wave 15 with 8 s = 49.
 */
export function earlyBonus(wave: number, remaining: number, difficulty: Difficulty): number {
  const r = Math.min(12, Math.max(0, remaining));
  if (r <= 0) return 0;
  const d = DIFFICULTIES[difficulty];
  return Math.ceil(r * (1 + 0.25 * wave) * d.rewardMult * d.earlyBonusMult - 1e-9);
}

/** Interest at wave clear (talent `metabolism`): floor(min(cap, rate × unspent)). */
export function interestFor(unspent: number, rate: number, cap: number): number {
  if (rate <= 0) return 0;
  return Math.floor(Math.min(cap, rate * Math.max(0, unspent)));
}

export function buildCost(type: TowerId): number {
  return TOWERS[type].levels[0].cost;
}

/** Cost of the next upgrade, or null when the tower is maxed. */
export function upgradeCost(tower: { type: TowerId; level: number }): number | null {
  if (tower.level >= 3) return null;
  return TOWERS[tower.type].levels[tower.level].cost;
}

export function sellValue(tower: { invested: number }): number {
  return Math.round(SELL_RATIO * tower.invested);
}

// ── Scripts (§8) ────────────────────────────────────────────────────────────

/** Spawn tempo max(0.6, 1 − 0.015 (w − 1)) applied to intra-group gaps. */
export function tempo(wave: number): number {
  return Math.max(0.6, 1 - 0.015 * (Math.max(1, wave) - 1));
}

function mkGroup(type: EnemyId, count: number, wave: number, spawn: SpawnSel, parallel: boolean): SpawnGroup {
  return { type, count, gap: Math.round(ENEMIES[type].gap * tempo(wave) * 1000) / 1000, spawn, parallel };
}

function parseSel(s: string | undefined): SpawnSel {
  if (s === 'A' || s === 'L') return 'A';
  if (s === 'B' || s === 'R') return 'B';
  return 'alt';
}

/** Parses the compact script notation of data.ts (throws on unknown ids — covered by unit tests). */
export function parseScript(script: string, wave: number): SpawnGroup[] {
  const groups: SpawnGroup[] = [];
  for (const raw of script.split(';')) {
    let tok = raw.trim();
    if (!tok) continue;
    let parallel = false;
    if (tok.startsWith('+')) {
      parallel = true;
      tok = tok.slice(1).trim();
    }
    const [body, sel] = tok.split('@');
    const [short, countStr] = body.split('*');
    const type = SHORT_IDS[short.trim()];
    if (!type) throw new Error(`unknown enemy id ${short}`);
    const count = countStr ? parseInt(countStr, 10) : 1;
    groups.push(mkGroup(type, count, wave, parseSel(sel?.trim()), parallel));
  }
  return groups;
}

/** Number of bosses on an endless boss wave (§8.5). */
function endlessBossCount(wave: number): number {
  return Math.min(3, Math.floor((wave - WAVES_PER_MAP) / 15) + 1);
}

/** Expanded group list of a wave: the scripted table for 1–20, the deterministic endless rule afterwards. */
export function waveScript(mapId: MapId, wave: number): SpawnGroup[] {
  const w = Math.max(1, Math.floor(wave));
  const scripts = WAVE_SCRIPTS[mapId] ?? WAVE_SCRIPTS.vessel;
  if (w <= WAVES_PER_MAP) return parseScript(scripts[w - 1], w);
  const k = w - WAVES_PER_MAP;
  const i = k - 1;
  const groups: SpawnGroup[] = [];
  if (w % 5 === 0) {
    const n = endlessBossCount(w);
    const start = (((w / 5 - 5) % 3) + 3) % 3;
    for (let b = 0; b < n; b++) groups.push(mkGroup(ENDLESS_BOSS_CYCLE[(start + b) % 3], 1, w, 'alt', false));
  }
  const rot = ENDLESS_ROTATION[mapId] ?? ENDLESS_ROTATION.vessel;
  const pick = (list: readonly string[]) => SHORT_IDS[list[i % list.length]];
  groups.push(mkGroup(pick(rot[0]), 10 + k, w, 'alt', false));
  groups.push(mkGroup(pick(rot[1]), 6 + k, w, 'alt', false));
  groups.push(mkGroup(pick(rot[2]), 4 + Math.floor(k / 2), w, 'alt', true));
  groups.push(mkGroup(pick(rot[3]), 2 + Math.floor(k / 3), w, 'alt', false));
  return groups;
}

/**
 * Flattens groups into timed spawn items (§7.2): a sequential group starts GROUP_PAUSE (1.5 s) after every earlier
 * spawn; a parallel group starts together with the previous group; a boss group directly after another boss group
 * starts BOSS_STAGGER (6 s) after it (endless double bosses). `alt` alternates A/B per enemy across the whole wave.
 */
export function expandWave(map: MapDef, groups: SpawnGroup[], wave: number): SpawnItem[] {
  void wave;
  const items: SpawnItem[] = [];
  const twoPaths = map.paths.length > 1;
  let blockEnd = 0;
  let prevStart = 0;
  let prevBoss = false;
  let altCounter = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const isBoss = ENEMIES[g.type].boss;
    let start: number;
    if (gi === 0) start = 0;
    else if (g.parallel) start = prevStart;
    else if (isBoss && prevBoss) start = prevStart + BOSS_STAGGER;
    else start = blockEnd + GROUP_PAUSE;
    for (let i = 0; i < g.count; i++) {
      const at = start + i * g.gap;
      let pathIndex = 0;
      if (twoPaths) {
        if (g.spawn === 'A') pathIndex = 0;
        else if (g.spawn === 'B') pathIndex = 1;
        else pathIndex = altCounter++ % 2;
      }
      items.push({ type: g.type, at: Math.round(at * 1e6) / 1e6, pathIndex });
      if (at > blockEnd) blockEnd = at;
    }
    if (g.count > 0 && start > blockEnd) blockEnd = start;
    prevStart = start;
    prevBoss = isBoss;
  }
  // Stable sort by time (insertion order breaks ties).
  return items.map((it, idx) => ({ it, idx })).sort((a, b) => a.it.at - b.it.at || a.idx - b.idx).map((x) => x.it);
}

/** Bosses of a wave in spawn order. */
export function waveBosses(mapId: MapId, wave: number): BossId[] {
  const out: BossId[] = [];
  for (const g of waveScript(mapId, wave)) if (ENEMIES[g.type].boss) out.push(g.type as BossId);
  return out;
}

/** HUD preview (§8.6): non-boss groups aggregated per type in first-appearance order, plus boss / glyph flags. */
export function wavePreview(mapId: MapId, wave: number): WavePreview {
  const groups = waveScript(mapId, wave);
  const agg: { type: EnemyId; count: number }[] = [];
  let flying = false;
  let stealth = false;
  let virus = false;
  const bosses: BossId[] = [];
  for (const g of groups) {
    const def = ENEMIES[g.type];
    if (def.flying) flying = true;
    if (def.stealth) stealth = true;
    if (g.type === 'virus' || g.type === 'virusKing') virus = true;
    if (def.boss) {
      bosses.push(g.type as BossId);
      continue;
    }
    const found = agg.find((a) => a.type === g.type);
    if (found) found.count += g.count;
    else agg.push({ type: g.type, count: g.count });
  }
  const preview: WavePreview = { wave, groups: agg, boss: bosses[0] ?? null, flying, stealth, virus };
  if (bosses.length > 1) preview.boss2 = bosses[1];
  return preview;
}

/** Effective base HP used by the smoothness rule (§8): spores with their sporelings, mutants at 640. */
export function effectiveBaseHp(type: EnemyId): number {
  const def = ENEMIES[type];
  if (def.splitInto) return def.hp + def.splitInto.count * ENEMIES[def.splitInto.type].hp;
  if (def.divide) return def.hp * def.divide.below + 2 * def.hp * def.divide.hpFraction;
  return def.hp;
}

/** Total effective HP of a scripted wave on a map (normal difficulty). */
export function waveEffectiveHp(mapId: MapId, wave: number, mapHpMult: number): number {
  let total = 0;
  for (const g of waveScript(mapId, wave)) total += g.count * effectiveBaseHp(g.type);
  return total * growth(wave) * mapHpMult;
}
