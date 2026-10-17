/**
 * Run save (§12.1): `serialize` produces a plain JSON-safe RunSave; `deserialize` is strict and rebuilds a valid
 * state field by field (garbage never reaches the simulation). After loading, the phase is `build` (§7).
 */
import type {
  AbilityId,
  BossId,
  Difficulty,
  GameState,
  ImmuneMemory,
  RunSave,
  SerializedGameState,
  SpecId,
  Targeting,
  Tower,
  TowerId,
  TowerLevel,
} from '../types';
import { ABILITY_IDS, BOSS_IDS, RUN_VERSION, TOWER_IDS, TOWER_SPECS } from '../types';
import { DIFFICULTIES, HERO_LEVELS, TOWERS } from './data';
import { isMapId } from './maps';
import { createGame, info } from './state';
import { computeBuffs, levelStats } from './towers';

/** Plain deep copy of the serializable part of the state (map, geoms and events are derived / transient). */
export function serialize(s: GameState): RunSave {
  const state: SerializedGameState = {
    v: s.v,
    mapId: s.mapId,
    difficulty: s.difficulty,
    rng: s.rng,
    time: s.time,
    phase: s.phase,
    wave: s.wave,
    endless: s.endless,
    countdown: s.countdown,
    vitality: s.vitality,
    maxVitality: s.maxVitality,
    atp: s.atp,
    towers: s.towers,
    enemies: s.enemies,
    projectiles: s.projectiles,
    pools: s.pools,
    hero: s.hero,
    abilities: s.abilities,
    flow: s.flow,
    waveState: s.waveState,
    stats: s.stats,
    memory: s.memory,
    nextId: s.nextId,
    stars: s.stars,
  };
  return { v: RUN_VERSION, savedAt: Date.now(), mapId: s.mapId, difficulty: s.difficulty, state: JSON.parse(JSON.stringify(state)) as SerializedGameState };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Bad extends Error {}

function num(v: unknown, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Bad('num');
  return v;
}

function int(v: unknown, min = -Infinity, max = Infinity): number {
  const n = num(v, min, max);
  if (!Number.isInteger(n)) throw new Bad('int');
  return n;
}

function numOr(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') throw new Bad('bool');
  return v;
}

/** Strict loader: null when the save is missing, foreign, mid-wave or inconsistent (§12.1). */
export function deserialize(raw: unknown, memory: ImmuneMemory): GameState | null {
  try {
    return load(raw, memory);
  } catch {
    return null;
  }
}

function load(raw: unknown, memory: ImmuneMemory): GameState | null {
  if (!isObj(raw) || raw.v !== RUN_VERSION) return null;
  if (!isMapId(raw.mapId) || (raw.difficulty !== 'normal' && raw.difficulty !== 'hard')) return null;
  const st = raw.state;
  if (!isObj(st)) return null;
  if (st.mapId !== raw.mapId || st.difficulty !== raw.difficulty || st.v !== RUN_VERSION) return null;
  if (st.phase !== 'build' && st.phase !== 'countdown') return null;
  const difficulty = raw.difficulty as Difficulty;
  const s = createGame({ mapId: raw.mapId, difficulty, memory, seed: 1 });
  const diff = DIFFICULTIES[difficulty];
  const mi = info(s);
  s.rng = int(st.rng, 0, 0xffffffff);
  s.time = num(st.time, 0, 1e9);
  s.wave = int(st.wave, 0, 100000);
  s.endless = bool(st.endless);
  if (s.endless && s.wave < 20) return null;
  s.vitality = num(st.vitality, 0.0001, diff.vitality);
  s.maxVitality = diff.vitality;
  s.atp = num(st.atp, 0, 1e12);
  s.stars = int(numOr(st.stars, 0), 0, 3);
  s.countdown = 0;
  if (Array.isArray(st.enemies) && st.enemies.length > 0) return null;
  // Towers.
  if (!Array.isArray(st.towers)) return null;
  const ids = new Set<number>();
  const cells = new Set<number>();
  let barriers = 0;
  let maxId = 0;
  for (const rt of st.towers) {
    if (!isObj(rt)) return null;
    const type = rt.type as TowerId;
    if (!TOWER_IDS.includes(type)) return null;
    const def = TOWERS[type];
    const id = int(rt.id, 1, 1e9);
    if (ids.has(id)) return null;
    ids.add(id);
    maxId = Math.max(maxId, id);
    const col = int(rt.col, 0, s.map.cols - 1);
    const row = int(rt.row, 0, s.map.rows - 1);
    const idx = row * s.map.cols + col;
    if (cells.has(idx)) return null;
    cells.add(idx);
    if (def.onPath) {
      if (!mi.pathMask[idx] || mi.banMask[idx] & mi.pathMask[idx]) return null;
      if (++barriers > s.map.maxBarriers) return null;
    } else if (!mi.padKind[idx]) return null;
    const level = int(rt.level, 1, 3) as TowerLevel;
    let spec: SpecId | null = null;
    if (rt.spec !== null && rt.spec !== undefined) {
      if (level !== 3 || !TOWER_SPECS[type].includes(rt.spec as SpecId)) return null;
      spec = rt.spec as SpecId;
    }
    const targeting: Targeting = rt.targeting === 'strongest' || rt.targeting === 'marked' || rt.targeting === 'first' ? rt.targeting : def.defaultTargeting;
    const lst = levelStats(type, level, spec);
    const maxHp = def.onPath ? (lst.hp ?? 0) * s.memory.barrierHpMult : 0;
    const t: Tower = {
      id,
      type,
      col,
      row,
      x: col + 0.5,
      y: row + 0.5,
      level,
      spec,
      targeting: def.hasTargeting ? targeting : def.defaultTargeting,
      readyAt: numOr(rt.readyAt, s.time),
      lastShotAt: numOr(rt.lastShotAt, -1),
      targetId: null,
      angle: numOr(rt.angle, -Math.PI / 2),
      invested: num(rt.invested, 0, 1e9),
      kills: int(numOr(rt.kills, 0), 0),
      damageDealt: numOr(rt.damageDealt, 0, 0),
      infectedUntil: numOr(rt.infectedUntil, 0),
      immuneUntil: numOr(rt.immuneUntil, 0),
      onVilli: mi.padKind[idx] === 2,
      buff: { rate: 1, dmg: 1, range: 0, immune: false },
      engulfReadyAt: numOr(rt.engulfReadyAt, s.time),
      digestingUntil: numOr(rt.digestingUntil, 0),
      cureAt: numOr(rt.cureAt, s.time),
      hp: def.onPath ? Math.max(1, Math.min(maxHp, numOr(rt.hp, maxHp))) : 0,
      maxHp,
      regenAt: numOr(rt.regenAt, 0),
      pathDist: mi.cellDist.map((d) => (def.onPath ? d[idx] : -1)),
    };
    s.towers.push(t);
  }
  // Hero.
  const rh = st.hero;
  if (!isObj(rh)) return null;
  const h = s.hero;
  h.level = int(rh.level, 1, 3) as 1 | 2 | 3;
  h.maxHp = HERO_LEVELS[h.level - 1].hp * s.memory.heroHpMult;
  h.xp = num(rh.xp, 0, 1e9);
  h.alive = bool(rh.alive);
  h.hp = h.alive ? Math.max(1, Math.min(h.maxHp, numOr(rh.hp, h.maxHp))) : 0;
  h.x = num(rh.x, 0, s.map.cols);
  h.y = num(rh.y, 0, s.map.rows);
  h.px = h.x;
  h.py = h.y;
  h.respawnAt = numOr(rh.respawnAt, 0);
  h.readyAt = numOr(rh.readyAt, 0);
  h.lastHitAt = numOr(rh.lastHitAt, -100);
  h.angle = numOr(rh.angle, -Math.PI / 2);
  h.dest = null;
  if (isObj(rh.dest)) {
    const dx = numOr(rh.dest.x, NaN, 0, s.map.cols);
    const dy = numOr(rh.dest.y, NaN, 0, s.map.rows);
    if (Number.isFinite(dx) && Number.isFinite(dy)) h.dest = { x: dx, y: dy };
  }
  // Abilities (cooldown lengths / unlocks are re-derived from the current memory).
  const ra = isObj(st.abilities) ? st.abilities : {};
  for (const id of ABILITY_IDS as readonly AbilityId[]) {
    const a = s.abilities[id];
    const r = isObj(ra[id]) ? (ra[id] as Record<string, unknown>) : {};
    a.readyAt = numOr(r.readyAt, 0);
    a.activeUntil = numOr(r.activeUntil, 0);
    a.pending = null;
  }
  // Stats.
  const rs = isObj(st.stats) ? st.stats : {};
  const stats = s.stats;
  stats.kills = int(numOr(rs.kills, 0), 0);
  stats.leaks = int(numOr(rs.leaks, 0), 0);
  stats.bossKills = int(numOr(rs.bossKills, 0), 0);
  stats.atpEarned = numOr(rs.atpEarned, 0);
  stats.atpSpent = numOr(rs.atpSpent, 0);
  stats.wavesCleared = int(numOr(rs.wavesCleared, 0), 0);
  stats.heroKills = int(numOr(rs.heroKills, 0), 0);
  stats.cures = int(numOr(rs.cures, 0), 0);
  stats.vitLost = numOr(rs.vitLost, 0, 0);
  stats.minVitality = numOr(rs.minVitality, s.vitality, 0);
  stats.playtime = numOr(rs.playtime, 0, 0);
  const dbt = isObj(rs.dmgByTowerType) ? rs.dmgByTowerType : {};
  for (const id of TOWER_IDS) stats.dmgByTowerType[id] = numOr(dbt[id], 0, 0);
  if (Array.isArray(rs.bossTypesKilled)) {
    for (const b of rs.bossTypesKilled) if (BOSS_IDS.includes(b as BossId) && !stats.bossTypesKilled.includes(b as BossId)) stats.bossTypesKilled.push(b as BossId);
  }
  // what the wave-20 clear already recorded into the memory (lenient: older saves have none)
  const rec = rs.recorded;
  const part = (v: unknown, max: number): number => Math.min(max, Math.max(0, Math.floor(numOr(v, 0))));
  stats.recorded = isObj(rec)
    ? {
        kills: part(rec.kills, stats.kills),
        bossKills: part(rec.bossKills, stats.bossKills),
        wavesCleared: part(rec.wavesCleared, stats.wavesCleared),
        playtime: Math.min(stats.playtime, Math.max(0, numOr(rec.playtime, 0))),
      }
    : null;
  // Ids.
  const nextId = int(st.nextId, 1, 1e12);
  if (nextId <= maxId) return null;
  s.nextId = nextId;
  s.phase = 'build';
  computeBuffs(s);
  return s;
}
