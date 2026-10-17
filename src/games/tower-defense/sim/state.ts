/**
 * Core state helpers shared by every system: game creation, the event double buffer, the damage pipeline (§5.1),
 * marks (§5.5), enemy spawning, kills / splits / division (§3.2), ATP, hero XP (§5.7) and infection (§5.3).
 */
import type {
  AbilityId,
  AbilityState,
  AttackKind,
  BossId,
  BossState,
  CreateGameOptions,
  Enemy,
  EnemyId,
  GameEvent,
  GameState,
  Hero,
  MemoryModifiers,
  RunStats,
  Tower,
  TowerId,
} from '../types';
import { ABILITY_IDS, HERO_SRC, RUN_VERSION, SIM_STEP, TOWER_IDS } from '../types';
import {
  ABILITIES,
  ARMOR_FLOOR,
  BARRIER_STOP,
  BOSS_HP_MULT,
  BOSS_SKILLS,
  DIFFICULTIES,
  ENEMIES,
  HERO_LEVELS,
  HERO_XP_NEAR,
  MARK_DURATION,
  MARK_MAX_STACKS,
  MARK_STACK_BONUS,
  STRONG_MARK_BONUS,
  STRONG_MARK_DURATION,
  VACCINE_MULT,
} from './data';
import { findMap, mapInfo, posOnPath, type MapInfo, type PathPos } from './maps';
import { resolveModifiers } from './memory';
import { enemyArmor, enemyAttack, enemyHp, enemySpeed, rewardFor } from './waves';

// ── Small shared scratch (single-threaded, never retained) ──────────────────

export const scratchPos: PathPos = { x: 0, y: 0, seg: 0 };

/** True during a step whose time crossed a whole second (throttles per-tick events such as DoT `immuneHit`). */
export const tickFlags = { secondBoundary: false };

export function info(s: GameState): MapInfo {
  return mapInfo(s.map);
}

export function zeroByTower(): Record<TowerId, number> {
  const r = {} as Record<TowerId, number>;
  for (const id of TOWER_IDS) r[id] = 0;
  return r;
}

// ── Creation ────────────────────────────────────────────────────────────────

export function newStats(vitality: number): RunStats {
  return {
    kills: 0,
    leaks: 0,
    bossKills: 0,
    atpEarned: 0,
    atpSpent: 0,
    wavesCleared: 0,
    heroKills: 0,
    cures: 0,
    vitLost: 0,
    minVitality: vitality,
    playtime: 0,
    dmgByTowerType: zeroByTower(),
    bossTypesKilled: [],
    recorded: null,
  };
}

export function newHero(mi: MapInfo, mods: MemoryModifiers): Hero {
  const hp = HERO_LEVELS[0].hp * mods.heroHpMult;
  return {
    x: mi.heroX,
    y: mi.heroY,
    px: mi.heroX,
    py: mi.heroY,
    hp,
    maxHp: hp,
    level: 1,
    xp: 0,
    alive: true,
    respawnAt: 0,
    dest: null,
    angle: -Math.PI / 2,
    readyAt: 0,
    lastHitAt: -100,
    targetId: null,
  };
}

export function newAbilities(mods: MemoryModifiers): Record<AbilityId, AbilityState> {
  const r = {} as Record<AbilityId, AbilityState>;
  for (const id of ABILITY_IDS) {
    r[id] = {
      id,
      unlocked: id !== 'booster' || mods.boosterUnlocked,
      cooldown: ABILITIES[id].cooldown * mods.cooldownMult,
      readyAt: 0,
      activeUntil: 0,
      pending: null,
    };
  }
  return r;
}

export function createGame(opts: CreateGameOptions): GameState {
  const map = findMap(opts.mapId);
  const mi = mapInfo(map);
  const difficulty = opts.difficulty === 'hard' ? 'hard' : 'normal';
  const diff = DIFFICULTIES[difficulty];
  const mods = resolveModifiers(opts.memory);
  const seed = ((opts.seed ?? Date.now()) >>> 0) || 0x9e3779b9;
  const s: GameState = {
    v: RUN_VERSION,
    mapId: map.id,
    difficulty,
    map,
    geoms: mi.geoms.slice(),
    rng: seed,
    time: 0,
    phase: 'build',
    wave: 0,
    endless: false,
    countdown: 0,
    vitality: diff.vitality,
    maxVitality: diff.vitality,
    atp: diff.startAtp + mods.startAtpBonus,
    towers: [],
    enemies: [],
    projectiles: [],
    pools: [],
    hero: newHero(mi, mods),
    abilities: newAbilities(mods),
    flow: { breathing: !!map.breathing, cycleT: 0, reversed: false, warn: false },
    waveState: { queue: [], elapsed: 0, total: 0, spawnedCount: 0, bossIds: [], lastSpawnAt: map.paths.map(() => 0) },
    stats: newStats(diff.vitality),
    memory: mods,
    events: [],
    nextId: 1,
    stars: 0,
  };
  return s;
}

// ── Events (double buffer, §11.5) ───────────────────────────────────────────

const spareEvents = new WeakMap<GameState, GameEvent[]>();

export function emit(s: GameState, ev: GameEvent): void {
  s.events.push(ev);
}

/** Swaps the pending buffer with the spare one and returns the pending events (valid until the next call). */
export function takeEvents(s: GameState): readonly GameEvent[] {
  const out = s.events;
  let spare = spareEvents.get(s);
  if (!spare || spare === out) spare = [];
  spare.length = 0;
  s.events = spare;
  spareEvents.set(s, out);
  return out;
}

// ── Lookups ─────────────────────────────────────────────────────────────────

export function findEnemy(s: GameState, id: number): Enemy | undefined {
  const list = s.enemies;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return undefined;
}

export function findTower(s: GameState, id: number): Tower | undefined {
  const list = s.towers;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return undefined;
}

export function alive(e: Enemy): boolean {
  return !e.dead && !e.leaked && e.hp > 0;
}

export function isBurrowed(e: Enemy, now: number): boolean {
  return e.boss !== null && e.boss.burrowedUntil > now;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

// ── Marks (§5.5) ────────────────────────────────────────────────────────────

export function markMult(e: Enemy, now: number): number {
  const m = e.mark;
  if (m.until <= now) return 1;
  return m.strong ? 1 + STRONG_MARK_BONUS : 1 + MARK_STACK_BONUS * m.stacks;
}

export function markStacks(e: Enemy, now: number): number {
  return e.mark.until > now ? e.mark.stacks : 0;
}

export function isMarked(e: Enemy, now: number): boolean {
  return e.mark.until > now && (e.mark.stacks > 0 || e.mark.strong);
}

export function addMark(s: GameState, e: Enemy, stacks: number, strong: boolean): void {
  const m = e.mark;
  const now = s.time;
  if (m.until <= now) {
    m.stacks = 0;
    m.strong = false;
  }
  const ps = m.stacks;
  const pst = m.strong;
  if (strong) {
    m.strong = true;
    m.stacks = MARK_MAX_STACKS;
    m.until = Math.max(m.until, now + STRONG_MARK_DURATION);
  } else {
    m.stacks = Math.min(MARK_MAX_STACKS, m.stacks + stacks);
    m.until = Math.max(m.until, now + MARK_DURATION);
  }
  if (m.stacks !== ps || m.strong !== pst) emit(s, { type: 'mark', enemy: e.id, stacks: m.stacks, strong: m.strong });
}

// ── Damage pipeline (§5.1) ──────────────────────────────────────────────────

export function vaccineMult(s: GameState, type: EnemyId): number {
  const v = s.memory.vaccines;
  switch (type) {
    case 'superbug':
    case 'spore':
    case 'sporeling':
      return v.superbug ? VACCINE_MULT : 1;
    case 'giantParasite':
    case 'parasite':
      return v.giantParasite ? VACCINE_MULT : 1;
    case 'virusKing':
    case 'virus':
      return v.virusKing ? VACCINE_MULT : 1;
    default:
      return 1;
  }
}

export function effectiveArmor(e: Enemy, now: number): number {
  return e.boss !== null && e.boss.hardenedUntil > now ? e.armor * 2 : e.armor;
}

/** Boss currently immune to this tower type (mutation, §3.1). */
export function immuneTo(e: Enemy, type: TowerId, now: number): boolean {
  return e.boss !== null && e.boss.immuneTo === type && e.boss.immuneUntil > now;
}

/**
 * Applies one hit. `raw` already contains base × beacon × talent × min(cap, special mults); this applies vaccine,
 * mark, `dmgTaken[kind]`, mutation immunity and armor, then subtracts HP. `tick` marks DoT / aura ticks (their
 * `immuneHit` events are throttled to one per second). Returns the damage dealt (0 when blocked).
 */
export function dealDamage(
  s: GameState,
  e: Enemy,
  raw: number,
  kind: AttackKind | null,
  src: number,
  towerType: TowerId | null,
  tower: Tower | null,
  ignoresArmor: boolean,
  tick: boolean,
  /** Exact amount: no vaccine / mark multiplier (Booster's flat 8 % maxHP vs bosses, §6.1). */
  flat = false,
): number {
  if (e.dead || e.leaked || e.hp <= 0 || raw <= 0) return 0;
  const now = s.time;
  if (e.boss !== null && e.boss.burrowedUntil > now) return 0;
  let dmg = flat ? raw : raw * vaccineMult(s, e.type) * markMult(e, now);
  if (kind !== null) {
    const taken = ENEMIES[e.type].dmgTaken;
    if (taken) {
      const m = taken[kind];
      if (m !== undefined) dmg *= m;
    }
  }
  if (towerType !== null && e.boss !== null && e.boss.immuneTo === towerType && e.boss.immuneUntil > now) {
    if (!tick || tickFlags.secondBoundary) emit(s, { type: 'immuneHit', enemy: e.id, kind: towerType, x: e.x, y: e.y });
    return 0;
  }
  if (!ignoresArmor) {
    const a = effectiveArmor(e, now);
    dmg = Math.max(dmg * ARMOR_FLOOR, dmg - a);
  }
  if (!(dmg > 0)) return 0;
  const applied = dmg < e.hp ? dmg : e.hp;
  e.hp -= dmg;
  e.lastHitBy = src;
  e.lastHitAt = now;
  if (towerType !== null) {
    s.stats.dmgByTowerType[towerType] += applied;
    if (e.boss !== null) e.boss.dmgByTowerType[towerType] += dmg;
  }
  if (tower !== null) tower.damageDealt += applied;
  return dmg;
}

// ── Enemies ─────────────────────────────────────────────────────────────────

export function updateEnemyPos(s: GameState, e: Enemy): void {
  const g = s.geoms[e.pathIndex];
  e.seg = posOnPath(g, e.dist, e.seg, scratchPos);
  e.x = scratchPos.x;
  e.y = scratchPos.y;
}

/** Rigid trailing segments (parasites): segment k sits `spacing × (k + 1)` behind the head. */
export function layoutSegments(e: Enemy): void {
  const n = e.segments.length;
  if (!n) return;
  const sp = ENEMIES[e.type].segmentSpacing ?? 0.45;
  for (let k = 0; k < n; k++) e.segments[k] = e.dist - sp * (k + 1);
}

function newBossState(s: GameState, type: BossId): BossState {
  const mult = DIFFICULTIES[s.difficulty].bossCooldownMult;
  return {
    skills: BOSS_SKILLS[type].map((d) => ({
      id: d.id,
      nextAt: d.firstAt !== undefined ? s.time + d.firstAt * (d.id === 'mutation' ? 1 : mult) : 0,
      telegraphUntil: 0,
      activeUntil: 0,
      firedThresholds: [],
    })),
    immuneTo: null,
    immuneUntil: 0,
    dmgByTowerType: zeroByTower(),
    mutations: 0,
    charging: false,
    burrowedUntil: 0,
    pausedUntil: 0,
    hardenedUntil: 0,
  };
}

/** Wave whose numbers new enemies use (≥ 1). */
export function curWave(s: GameState): number {
  return s.wave < 1 ? 1 : s.wave;
}

/**
 * Creates an enemy at `dist` on `pathIndex` with the current wave's numbers, prev = cur (§5.2), and emits `spawn`.
 * `divided` creates a Mutant half from `parentMaxHp` (§3.2).
 */
export function spawnEnemy(s: GameState, type: EnemyId, pathIndex: number, dist: number, spawned: boolean, parentMaxHp = 0): Enemy {
  const def = ENEMIES[type];
  const w = curWave(s);
  const diff = s.difficulty;
  const divided = parentMaxHp > 0 && def.divide !== undefined;
  const dv = def.divide;
  const mapMult = s.map.hpMult * (def.boss ? (BOSS_HP_MULT[s.map.id] ?? 1) : 1);
  const hp = divided && dv ? Math.max(1, Math.round(parentMaxHp * dv.hpFraction)) : Math.max(1, enemyHp(type, w, mapMult, diff));
  const segCount = def.segments ?? 0;
  const e: Enemy = {
    id: s.nextId++,
    type,
    pathIndex,
    dist,
    seg: 0,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    hp,
    maxHp: hp,
    speed: enemySpeed(divided && dv ? dv.speed : def.speed, w, diff),
    armor: enemyArmor(type, w, diff),
    reward: rewardFor(divided && dv ? dv.reward : def.reward, w, diff),
    vit: divided && dv ? dv.vit : def.vit,
    attack: enemyAttack(type, w),
    radius: divided && dv ? dv.radius : def.radius,
    flying: def.flying,
    stealth: def.stealth,
    revealed: false,
    spawned,
    divided,
    slows: [],
    stunUntil: 0,
    mark: { stacks: 0, until: 0, strong: false },
    dots: [],
    regen: def.regen,
    regenSuppressedUntil: 0,
    stunnedBy: [],
    infected: [],
    attacking: null,
    attackBlockedUntil: 0,
    segments: segCount > 0 ? new Array<number>(segCount).fill(0) : [],
    pdist: 0,
    boss: def.boss ? newBossState(s, type as BossId) : null,
    lastHitAt: -100,
    lastHitBy: 0,
    leaked: false,
    dead: false,
  };
  updateEnemyPos(s, e);
  e.px = e.x;
  e.py = e.y;
  layoutSegments(e);
  e.pdist = segCount > 0 ? e.segments[segCount - 1] : e.dist;
  s.enemies.push(e);
  emit(s, { type: 'spawn', id: e.id, enemy: type, pathIndex, x: e.x, y: e.y });
  return e;
}

// ── Barriers on paths ───────────────────────────────────────────────────────

/** Stop point (dist) of the first living barrier ahead of `dist` on `pathIndex`, or +Infinity. */
export function stopAhead(s: GameState, pathIndex: number, dist: number): number {
  let best = Infinity;
  const towers = s.towers;
  for (let i = 0; i < towers.length; i++) {
    const t = towers[i];
    if (t.type !== 'barrier' || t.hp <= 0) continue;
    const d = t.pathDist[pathIndex];
    if (d === undefined || d < 0) continue;
    const stop = d - BARRIER_STOP;
    if (stop >= dist - 1e-6 && stop < best) best = stop;
  }
  return best;
}

/** Clamps a child's spawn distance to the path and to the parent's next barrier (children never skip a barrier). */
function childDist(s: GameState, parent: Enemy, d: number): number {
  const len = s.geoms[parent.pathIndex].length;
  let hi = len - 0.5;
  if (!parent.flying) {
    const stop = stopAhead(s, parent.pathIndex, parent.dist);
    if (stop < hi) hi = Math.max(0, stop);
  }
  return d < 0 ? 0 : d > hi ? hi : d;
}

// ── ATP, XP ─────────────────────────────────────────────────────────────────

export function grantAtp(s: GameState, amount: number, x: number, y: number): void {
  if (amount <= 0) return;
  s.atp += amount;
  s.stats.atpEarned += amount;
  emit(s, { type: 'atp', delta: amount, x, y });
}

export function spendAtp(s: GameState, amount: number, x: number, y: number): void {
  s.atp -= amount;
  s.stats.atpSpent += amount;
  emit(s, { type: 'atp', delta: -amount, x, y });
}

export function addHeroXp(s: GameState, xp: number): void {
  const h = s.hero;
  if (!h.alive || xp <= 0) return;
  h.xp += xp;
  while (h.level < 3) {
    const need = HERO_LEVELS[h.level - 1].xpToNext ?? Infinity;
    if (h.xp < need) break;
    h.level = (h.level + 1) as 2 | 3;
    h.maxHp = HERO_LEVELS[h.level - 1].hp * s.memory.heroHpMult;
    h.hp = h.maxHp;
    emit(s, { type: 'heroLevel', level: h.level });
  }
}

/** §5.7: +1 per kill while alive; +3 for the hero's own kill or a kill within 2.5 cells; +15 for a boss. */
function killXp(s: GameState, e: Enemy): void {
  const h = s.hero;
  if (!h.alive) return;
  let xp = 1;
  if (e.boss !== null) xp = 15;
  else if (e.lastHitBy === HERO_SRC || dist2(h.x, h.y, e.x, e.y) <= HERO_XP_NEAR * HERO_XP_NEAR) xp = 3;
  addHeroXp(s, xp);
}

// ── Death, split, division ──────────────────────────────────────────────────

/**
 * Kills an enemy that counts as a kill: reward, `kill` event, tower / hero credit, XP, boss bookkeeping and — unless
 * engulfed — the spore split. Engulf / execute emit their own event before calling this.
 */
export function killEnemy(s: GameState, e: Enemy, engulfed: boolean): void {
  if (e.dead) return;
  e.dead = true;
  if (e.hp > 0) e.hp = 0;
  const def = ENEMIES[e.type];
  grantAtp(s, e.reward, e.x, e.y);
  s.stats.kills++;
  const by = e.lastHitBy;
  if (by > 0) {
    const t = findTower(s, by);
    if (t) t.kills++;
  } else if (by === HERO_SRC) s.stats.heroKills++;
  emit(s, { type: 'kill', enemy: e.id, enemyType: e.type, x: e.x, y: e.y, reward: e.reward, by, boss: def.boss });
  killXp(s, e);
  if (def.boss) {
    s.stats.bossKills++;
    const b = e.type as BossId;
    if (!s.stats.bossTypesKilled.includes(b)) {
      s.stats.bossTypesKilled.push(b);
      if (!s.memory.vaccines[b]) emit(s, { type: 'vaccineUnlocked', boss: b });
    }
  }
  if (!engulfed && def.splitInto) {
    const sp = def.splitInto;
    const children: number[] = [];
    for (let k = 0; k < sp.count; k++) {
      const off = (k - (sp.count - 1) / 2) * sp.spread;
      const c = spawnEnemy(s, sp.type, e.pathIndex, childDist(s, e, e.dist + off), true);
      children.push(c.id);
    }
    emit(s, { type: 'split', parent: e.id, enemyType: e.type, children, x: e.x, y: e.y, reward: 0 });
  }
}

/** Mutant division (§3.2): parent removed without a kill, reward + XP granted via `split`, two halves appear. */
export function divideEnemy(s: GameState, e: Enemy): void {
  const dv = ENEMIES[e.type].divide;
  if (!dv || e.dead) return;
  e.dead = true;
  grantAtp(s, e.reward, e.x, e.y);
  killXp(s, e);
  const a = spawnEnemy(s, e.type, e.pathIndex, childDist(s, e, e.dist - dv.spread), true, e.maxHp);
  const b = spawnEnemy(s, e.type, e.pathIndex, childDist(s, e, e.dist + dv.spread), true, e.maxHp);
  emit(s, { type: 'split', parent: e.id, enemyType: e.type, children: [a.id, b.id], x: e.x, y: e.y, reward: e.reward });
}

// ── Infection (§5.3) ────────────────────────────────────────────────────────

export function canInfect(t: Tower, now: number): boolean {
  return t.type !== 'beacon' && t.type !== 'barrier' && !t.buff.immune && t.immuneUntil <= now;
}

export function infectTower(s: GameState, t: Tower, duration: number, by: number): boolean {
  const now = s.time;
  if (!canInfect(t, now)) return false;
  const until = Math.max(t.infectedUntil, now + duration);
  t.infectedUntil = until;
  emit(s, { type: 'infect', tower: t.id, by, until });
  return true;
}

/** xorshift32 step over `s.rng` (reserved; no v2 system draws from it). */
export function nextRandom(s: GameState): number {
  let x = s.rng | 0 || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return s.rng / 4294967296;
}

/** Ids of the step granularity used by tests (re-export for convenience). */
export const STEP = SIM_STEP;
