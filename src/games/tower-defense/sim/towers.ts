/**
 * Towers (§2): beacon buffs, targeting, the eight tower behaviours, projectiles, and the build / upgrade / sell
 * commands plus the panel stat block. Hot loops are allocation-free except for events.
 */
import type {
  BuildCheck,
  DeniedReason,
  Enemy,
  GameState,
  Point,
  Projectile,
  SpecId,
  Targeting,
  Tower,
  TowerId,
  TowerLevel,
  TowerLevelStats,
  TowerStatBlock,
} from '../types';
import { TOWER_SPECS } from '../types';
import {
  APOPTOSIS_BOSS_MULT,
  AURA_LINGER,
  CLOT_BOSS_MULT,
  ENEMIES,
  MAST_ARC,
  MAX_BURNS,
  MEMBRANE_VS_REGEN,
  TOWERS,
} from './data';
import { villiBonus } from './maps';
import {
  addMark,
  alive,
  dealDamage,
  dist2,
  emit,
  findEnemy,
  findTower,
  immuneTo,
  info,
  isBurrowed,
  isMarked,
  killEnemy,
  markStacks,
  spendAtp,
  grantAtp,
} from './state';
import { growth, sellValue, upgradeCost } from './waves';

// ── Stats ───────────────────────────────────────────────────────────────────

export function levelStats(type: TowerId, level: TowerLevel, spec: SpecId | null): TowerLevelStats {
  const def = TOWERS[type];
  if (level === 3 && spec !== null) {
    const sp = def.specs[spec];
    if (sp) return sp;
  }
  return def.levels[level - 1];
}

function statsOf(t: Tower): TowerLevelStats {
  return levelStats(t.type, t.level, t.spec);
}

/** Range bonus from the villi pad under a tower (§1.3). */
export function villiRange(t: Pick<Tower, 'onVilli'>, baseRange: number): number {
  return t.onVilli ? villiBonus(baseRange) : 0;
}

/** Beacon buff / reveal radius including the villi bonus. */
function beaconRadius(t: Tower, r: number): number {
  return r + villiRange(t, r);
}

/** Wave the panel's wave-scaled lines apply to (§2 common rules). */
export function statWave(s: GameState): number {
  return Math.max(1, s.phase === 'wave' ? s.wave : s.wave + 1);
}

// ── Beacon buffs (§2.7) ─────────────────────────────────────────────────────

/** Recomputes every tower's `buff` (rate / dmg multipliers, additive range, immunity). Cheap: O(beacons × towers). */
export function computeBuffs(s: GameState): void {
  const towers = s.towers;
  let alarm = false;
  for (let i = 0; i < towers.length; i++) {
    const b = towers[i].buff;
    b.rate = 1;
    b.dmg = 1;
    b.range = 0;
    b.immune = false;
  }
  for (let i = 0; i < towers.length; i++) {
    const bc = towers[i];
    if (bc.type !== 'beacon') continue;
    const st = statsOf(bc);
    if (bc.spec === 'alarm') alarm = true;
    const r = beaconRadius(bc, st.range);
    const r2 = r * r;
    const br = st.buffRate ?? 0;
    const bd = st.buffDmg ?? 0;
    const bg = st.buffRange ?? 0;
    const immune = bc.level === 3;
    for (let j = 0; j < towers.length; j++) {
      const t = towers[j];
      if (t === bc || t.type === 'beacon' || t.type === 'barrier') continue;
      if (dist2(t.x, t.y, bc.x, bc.y) > r2) continue;
      const b = t.buff;
      if (1 + br > b.rate) b.rate = 1 + br;
      if (1 + bd > b.dmg) b.dmg = 1 + bd;
      if (bg > b.range) b.range = bg;
      if (immune) b.immune = true;
    }
  }
  for (let i = 0; i < towers.length; i++) {
    const t = towers[i];
    const b = t.buff;
    if (alarm && t.type !== 'beacon' && t.type !== 'barrier') {
      b.rate += 0.08;
      b.dmg += 0.08;
    }
    if (t.onVilli) b.range += villiBonus(statsOf(t).range);
  }
}

/** Effective attack / aura / buff range of a tower (base + villi + Potentiate). */
export function towerRange(t: Tower): number {
  return statsOf(t).range + t.buff.range;
}

// ── Targeting ───────────────────────────────────────────────────────────────

const zonePos = { x: 0, y: 0, seg: 0 };

/** Head or any trailing segment within `r` of (x, y) (§5.9 e). `pad` adds the enemy radius (splash-style tests). */
export function withinRange(s: GameState, e: Enemy, x: number, y: number, r: number, pad: boolean): boolean {
  const rr = pad ? r + e.radius : r;
  const r2 = rr * rr;
  if (dist2(e.x, e.y, x, y) <= r2) return true;
  const n = e.segments.length;
  if (!n) return false;
  const sp = ENEMIES[e.type].segmentSpacing ?? 0.45;
  const reach = rr + sp * n + 0.01;
  if (dist2(e.x, e.y, x, y) > reach * reach) return false;
  const g = s.geoms[e.pathIndex];
  let seg = e.seg;
  for (let k = 0; k < n; k++) {
    const d = e.segments[k];
    seg = posOnPathFast(g, d, seg);
    if (dist2(zonePos.x, zonePos.y, x, y) <= r2) return true;
  }
  return false;
}

/** Number of hit zones (head + segments) within `r`, capped at the enemy's `splashZones` (default 1). */
export function zonesWithin(s: GameState, e: Enemy, x: number, y: number, r: number, pad: boolean): number {
  const cap = ENEMIES[e.type].splashZones ?? 1;
  if (cap <= 1) return withinRange(s, e, x, y, r, pad) ? 1 : 0;
  const rr = pad ? r + e.radius : r;
  const r2 = rr * rr;
  let n = dist2(e.x, e.y, x, y) <= r2 ? 1 : 0;
  const g = s.geoms[e.pathIndex];
  let seg = e.seg;
  for (let k = 0; k < e.segments.length && n < cap; k++) {
    seg = posOnPathFast(g, e.segments[k], seg);
    if (dist2(zonePos.x, zonePos.y, x, y) <= r2) n++;
  }
  return n;
}

function posOnPathFast(g: import('../types').PathGeom, d: number, hint: number): number {
  const points = g.points;
  const cum = g.cum;
  const last = points.length - 1;
  if (d <= 0) {
    const a = points[0];
    const b = points[1];
    const len = cum[1] || 1;
    zonePos.x = a.x + ((b.x - a.x) / len) * d;
    zonePos.y = a.y + ((b.y - a.y) / len) * d;
    return 0;
  }
  if (d >= g.length) {
    zonePos.x = points[last].x;
    zonePos.y = points[last].y;
    return last - 1;
  }
  let seg = hint < 0 ? 0 : hint > last - 1 ? last - 1 : hint;
  while (seg > 0 && cum[seg] > d) seg--;
  while (seg < last - 1 && cum[seg + 1] < d) seg++;
  const a = points[seg];
  const b = points[seg + 1];
  const len = cum[seg + 1] - cum[seg];
  const t = len > 0 ? (d - cum[seg]) / len : 0;
  zonePos.x = a.x + (b.x - a.x) * t;
  zonePos.y = a.y + (b.y - a.y) * t;
  return seg;
}

/** Can this tower type select the enemy as a target right now (§5.9 b, l, o)? */
export function canTarget(s: GameState, type: TowerId, e: Enemy): boolean {
  if (e.dead || e.leaked || e.hp <= 0) return false;
  if (e.flying && !TOWERS[type].hitsFlying) return false;
  if (e.stealth && !e.revealed) return false;
  if (e.boss !== null) {
    const now = s.time;
    if (e.boss.burrowedUntil > now) return false;
    if (e.boss.immuneTo === type && e.boss.immuneUntil > now) return false;
  }
  return true;
}

function remaining(s: GameState, e: Enemy): number {
  return s.geoms[e.pathIndex].length - e.dist;
}

/**
 * Target for a tower: `first` = smallest remaining distance to the core, `strongest` = highest HP (tie → first),
 * `marked` = most mark stacks (tie → first; nothing marked → first). Remaining ties → lowest id (enemy order).
 */
export function pickTarget(s: GameState, t: Tower, range: number, mode: Targeting): Enemy | null {
  const list = s.enemies;
  const now = s.time;
  let best: Enemy | null = null;
  let bestRem = 0;
  let bestKey = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!canTarget(s, t.type, e)) continue;
    if (!withinRange(s, e, t.x, t.y, range, false)) continue;
    const rem = remaining(s, e);
    const key = mode === 'strongest' ? e.hp : mode === 'marked' ? markStacks(e, now) : 0;
    if (best === null || key > bestKey || (key === bestKey && rem < bestRem - 1e-9) || (key === bestKey && Math.abs(rem - bestRem) <= 1e-9 && e.id < best.id)) {
      best = e;
      bestRem = rem;
      bestKey = key;
    }
  }
  return best;
}

// ── Slows / DoTs ────────────────────────────────────────────────────────────

export function applySlow(e: Enemy, src: number, amount: number, until: number): void {
  const list = e.slows;
  for (let i = 0; i < list.length; i++) {
    if (list[i].src === src) {
      list[i].amount = amount;
      if (until > list[i].until) list[i].until = until;
      return;
    }
  }
  list.push({ src, amount, until });
}

/** Tower slow fraction after slow resist, capped at SLOW_CAP; prunes expired slows (§5.2). */
export function towerSlow(e: Enemy, now: number, cap: number): number {
  const list = e.slows;
  if (!list.length) return 0;
  let total = 0;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const sl = list[i];
    if (sl.until <= now) continue;
    total += sl.amount;
    list[w++] = sl;
  }
  list.length = w;
  total *= 1 - ENEMIES[e.type].slowResist;
  return total < cap ? total : cap;
}

function applyBurn(e: Enemy, src: number, dps: number, until: number): void {
  const dots = e.dots;
  for (let i = 0; i < dots.length; i++) {
    if (dots[i].src === src) {
      dots[i].dps = dps;
      dots[i].until = until;
      return;
    }
  }
  if (dots.length < MAX_BURNS) {
    dots.push({ src, dps, until });
    return;
  }
  let oldest = 0;
  for (let i = 1; i < dots.length; i++) if (dots[i].until < dots[oldest].until) oldest = i;
  dots[oldest].src = src;
  dots[oldest].dps = dps;
  dots[oldest].until = until;
}

// ── Tower update ────────────────────────────────────────────────────────────

/** Shot cadence: keeps the exact interval while firing continuously, restarts from `now` after idling. */
function consumeShot(t: Tower, now: number, dt: number, rate: number): void {
  const interval = 1 / rate;
  t.readyAt = (t.readyAt < now - dt - 1e-9 ? now : t.readyAt) + interval;
  t.lastShotAt = now;
}

function aim(t: Tower, e: Enemy): void {
  t.angle = Math.atan2(e.y - t.y, e.x - t.x);
}

const chainHit: Enemy[] = [];

export function updateTowers(s: GameState, dt: number): void {
  computeBuffs(s);
  const now = s.time;
  const adren = s.abilities.adrenaline.activeUntil > now;
  const towers = s.towers;
  const hasEnemies = s.enemies.length > 0;
  for (let i = 0; i < towers.length; i++) {
    const t = towers[i];
    const st = statsOf(t);
    const infected = t.infectedUntil > now;
    const rateMult = t.buff.rate * (adren ? 1.6 : 1) * (infected ? 0.5 : 1);
    const dmgMult = t.buff.dmg * s.memory.dmgMult;
    const range = st.range + t.buff.range;
    switch (t.type) {
      case 'beacon':
        updateBeacon(s, t, st, range);
        break;
      case 'barrier':
        updateBarrier(s, t, st, dt, hasEnemies);
        break;
      case 'pyrogen':
        if (hasEnemies) updatePyrogen(s, t, st, range, dt, rateMult, dmgMult, infected);
        break;
      default: {
        if (!hasEnemies) {
          t.targetId = null;
          break;
        }
        if (t.type === 'macrophage') tryEngulf(s, t, st, range, dmgMult);
        if (t.readyAt > now + 1e-9) {
          if (t.targetId !== null) {
            const held = findEnemy(s, t.targetId);
            if (held && canTarget(s, t.type, held)) aim(t, held);
            else t.targetId = null;
          }
          break;
        }
        const target = pickTarget(s, t, range, t.targeting);
        if (!target) {
          t.targetId = null;
          break;
        }
        t.targetId = target.id;
        aim(t, target);
        consumeShot(t, now, dt, st.rate * rateMult);
        fireAt(s, t, st, target, dmgMult);
      }
    }
  }
}

function fireAt(s: GameState, t: Tower, st: TowerLevelStats, target: Enemy, dmgMult: number): void {
  switch (t.type) {
    case 'antibody':
    case 'mast': {
      const def = TOWERS[t.type];
      const arc = t.type === 'mast';
      const p: Projectile = {
        id: s.nextId++,
        src: t.id,
        kind: t.type,
        x: t.x,
        y: t.y,
        px: t.x,
        py: t.y,
        tx: target.x,
        ty: target.y,
        targetId: target.id,
        speed: def.projectileSpeed,
        dmg: st.dmg * dmgMult,
        splash: st.splash ?? 0,
        arc,
        arcHeight: arc ? MAST_ARC : 0,
        t: 0,
        mark: st.mark ?? null,
        spec: t.spec,
        done: false,
      };
      s.projectiles.push(p);
      emit(s, { type: 'shoot', tower: t.id, kind: t.type, x: t.x, y: t.y, angle: t.angle });
      return;
    }
    case 'macrophage': {
      const dmg = dealDamage(s, target, st.dmg * dmgMult, 'melee', t.id, 'macrophage', t, st.ignoresArmor === true, false);
      emit(s, { type: 'hit', kind: 'macrophage', enemy: target.id, x: target.x, y: target.y, dmg, crit: false });
      return;
    }
    case 'tcell':
      fireTCell(s, t, st, target, dmgMult);
      return;
    case 'complement':
      fireChain(s, t, st, target, dmgMult);
      return;
    default:
      return;
  }
}

function fireTCell(s: GameState, t: Tower, st: TowerLevelStats, e: Enemy, dmgMult: number): void {
  const def = TOWERS.tcell;
  const now = s.time;
  let special = 1;
  if (isMarked(e, now)) special *= def.vsMarked;
  if (e.boss !== null) special *= def.vsBoss;
  if (e.spawned) special *= def.vsSpawned;
  const exec = st.executeBelow ?? 0;
  if (exec > 0 && e.boss !== null && e.hp < e.maxHp * exec) special *= APOPTOSIS_BOSS_MULT;
  if (special > def.multCap) special = def.multCap;
  emit(s, { type: 'tracer', tower: t.id, x1: t.x, y1: t.y, x2: e.x, y2: e.y });
  const dmg = dealDamage(s, e, st.dmg * dmgMult * special, 'tracer', t.id, 'tcell', t, st.ignoresArmor === true, false);
  emit(s, { type: 'hit', kind: 'tcell', enemy: e.id, x: e.x, y: e.y, dmg, crit: special >= 2 });
  if (exec > 0 && e.boss === null && alive(e) && e.hp < e.maxHp * exec) {
    emit(s, { type: 'execute', enemy: e.id, enemyType: e.type, x: e.x, y: e.y, by: 'apoptosis' });
    e.lastHitBy = t.id;
    e.hp = 0;
  }
}

function hasShield(e: Enemy, now: number): boolean {
  return e.regen > 0 || (e.boss !== null && e.boss.hardenedUntil > now);
}

/** Ends Shell Hardening early (Membrane Attack, §2.6). */
export function endHardening(e: Enemy, now: number): void {
  const b = e.boss;
  if (!b || b.hardenedUntil <= now) return;
  b.hardenedUntil = now;
  for (const ks of b.skills) if (ks.id === 'shellHardening' && ks.activeUntil > now) ks.activeUntil = now;
}

function fireChain(s: GameState, t: Tower, st: TowerLevelStats, first: Enemy, dmgMult: number): void {
  const def = TOWERS.complement;
  const now = s.time;
  const maxTargets = st.chainTargets ?? 3;
  const jump = st.chainJump ?? 1.3;
  const jumpMarked = st.chainJumpMarked ?? jump;
  const falloff = st.chainFalloff ?? 0.25;
  const membrane = t.spec === 'membraneAttack';
  const vsRegen = membrane ? MEMBRANE_VS_REGEN : def.vsRegen;
  const points: Point[] = [{ x: t.x, y: t.y }];
  const ids: number[] = [-1];
  chainHit.length = 0;
  let cur: Enemy | null = first;
  let mult = 1;
  while (cur !== null && chainHit.length < maxTargets) {
    let special = hasShield(cur, now) ? vsRegen : 1;
    if (special > def.multCap) special = def.multCap;
    const dmg = dealDamage(s, cur, st.dmg * dmgMult * mult * special, 'chain', t.id, 'complement', t, false, false);
    emit(s, { type: 'hit', kind: 'complement', enemy: cur.id, x: cur.x, y: cur.y, dmg, crit: false });
    if (membrane) {
      const sup = now + (st.suppress ?? 6);
      if (cur.regenSuppressedUntil < sup) cur.regenSuppressedUntil = sup;
      endHardening(cur, now);
    }
    chainHit.push(cur);
    points.push({ x: cur.x, y: cur.y });
    ids.push(cur.id);
    mult *= 1 - falloff;
    // Next jump: nearest not-yet-hit targetable enemy within the jump range of the last one.
    const curMarked = isMarked(cur, now);
    let next: Enemy | null = null;
    let bestD = Infinity;
    const list = s.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === cur || !canTarget(s, 'complement', e)) continue;
      let seen = false;
      for (let k = 0; k < chainHit.length; k++) if (chainHit[k] === e) seen = true;
      if (seen) continue;
      const r = curMarked && isMarked(e, now) ? jumpMarked : jump;
      const d = dist2(cur.x, cur.y, e.x, e.y);
      if (d > r * r) continue;
      if (d < bestD - 1e-12) {
        bestD = d;
        next = e;
      }
    }
    cur = next;
  }
  chainHit.length = 0;
  emit(s, { type: 'chain', tower: t.id, points, ids });
}

function tryEngulf(s: GameState, t: Tower, st: TowerLevelStats, range: number, dmgMult: number): void {
  const now = s.time;
  if (t.engulfReadyAt > now || t.digestingUntil > now) return;
  const base = (st.engulfThreshold ?? 0) * growth(Math.max(1, s.wave));
  const list = s.enemies;
  let best: Enemy | null = null;
  let bestRem = Infinity;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!canTarget(s, 'macrophage', e)) continue;
    const def = ENEMIES[e.type];
    if (!def.canBeEngulfed || def.boss || e.flying) continue;
    const thr = base * (isMarked(e, now) ? 1.5 : 1);
    if (e.hp > thr) continue;
    if (!withinRange(s, e, t.x, t.y, range, false)) continue;
    const rem = remaining(s, e);
    if (rem < bestRem - 1e-9) {
      bestRem = rem;
      best = e;
    }
  }
  if (!best) return;
  const e = best;
  t.engulfReadyAt = now + (st.engulfCooldown ?? 7);
  t.digestingUntil = now + (st.digestTime ?? 2.5);
  t.lastShotAt = now;
  aim(t, e);
  e.lastHitBy = t.id;
  emit(s, { type: 'engulf', tower: t.id, enemy: e.id, enemyType: e.type, x: e.x, y: e.y });
  const maxHp = e.maxHp;
  const ex = e.x;
  const ey = e.y;
  killEnemy(s, e, true);
  if (t.spec === 'enzymes') {
    // Acid splash + pool, both fractions of the meal's maxHP, armor-ignoring, ground only (§2.2).
    const r = st.splash ?? 1.2;
    let hits = 0;
    const splashDmg = (st.acidSplashFrac ?? 0.35) * maxHp * dmgMult;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!alive(o) || o.flying || isBurrowed(o, now)) continue;
      const z = zonesWithin(s, o, ex, ey, r, false);
      if (!z) continue;
      dealDamage(s, o, splashDmg * z, 'melee', t.id, 'macrophage', t, true, false);
      hits++;
    }
    emit(s, { type: 'splash', kind: 'macrophage', x: ex, y: ey, radius: r, hits });
    const until = now + (st.acidPoolDuration ?? 3);
    const pr = st.acidPoolRadius ?? 1;
    s.pools.push({ id: s.nextId++, src: t.id, x: ex, y: ey, radius: pr, dps: (st.acidPoolFrac ?? 0.1) * maxHp * dmgMult, until });
    emit(s, { type: 'acid', x: ex, y: ey, radius: pr, until });
  }
}

function updatePyrogen(
  s: GameState,
  t: Tower,
  st: TowerLevelStats,
  range: number,
  dt: number,
  rateMult: number,
  dmgMult: number,
  infected: boolean,
): void {
  const now = s.time;
  const slow = (st.slow ?? 0) * (infected ? 0.5 : 1);
  const dps = (st.auraDps ?? 0) * Math.sqrt(growth(Math.max(1, s.wave))) * dmgMult * rateMult;
  const stun = st.stun ?? 0;
  const list = s.enemies;
  let hits = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!alive(e) || e.flying || isBurrowed(e, now)) continue;
    const z = zonesWithin(s, e, t.x, t.y, range, false);
    if (!z) continue;
    hits++;
    if (immuneTo(e, 'pyrogen', now)) {
      dealDamage(s, e, dps * dt, 'aura', t.id, 'pyrogen', t, true, true);
      continue;
    }
    if (slow > 0) applySlow(e, t.id, slow, now + AURA_LINGER);
    if (stun > 0 && !e.stunnedBy.includes(t.id)) {
      e.stunnedBy.push(t.id);
      if (e.boss === null) {
        if (e.stunUntil < now + stun) e.stunUntil = now + stun;
        emit(s, { type: 'stun', enemy: e.id, x: e.x, y: e.y, duration: stun });
      }
    }
    dealDamage(s, e, dps * dt * z, 'aura', t.id, 'pyrogen', t, true, true);
  }
  if (hits > 0) {
    t.lastShotAt = now;
    if (Math.floor(now) !== Math.floor(now - dt)) emit(s, { type: 'pulse', tower: t.id, x: t.x, y: t.y, range, hits });
  }
}

function updateBeacon(s: GameState, t: Tower, st: TowerLevelStats, range: number): void {
  const now = s.time;
  if (t.cureAt > now) return;
  t.cureAt = now + (st.cureEvery ?? 2);
  const r2 = range * range;
  let cured = 0;
  const towers = s.towers;
  for (let i = 0; i < towers.length; i++) {
    const u = towers[i];
    if (u === t || u.infectedUntil <= now) continue;
    if (dist2(u.x, u.y, t.x, t.y) > r2) continue;
    u.infectedUntil = now;
    cured++;
    emit(s, { type: 'cure', tower: u.id, by: 'beacon', immuneUntil: u.immuneUntil });
  }
  if (cured > 0) {
    t.lastShotAt = now;
    emit(s, { type: 'pulse', tower: t.id, x: t.x, y: t.y, range, hits: cured });
  }
}

function updateBarrier(s: GameState, t: Tower, st: TowerLevelStats, dt: number, hasEnemies: boolean): void {
  const now = s.time;
  if (t.hp <= 0) return;
  if (t.regenAt <= now && t.hp < t.maxHp) t.hp = Math.min(t.maxHp, t.hp + (st.regen ?? 0) * dt);
  const cf = st.contactFrac ?? 0;
  if (cf <= 0 || !hasEnemies) return;
  const r = st.contactRadius ?? 0.6;
  const r2 = r * r;
  const list = s.enemies;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!alive(e) || e.flying || isBurrowed(e, now)) continue;
    if (dist2(e.x, e.y, t.x, t.y) > r2) continue;
    const raw = cf * e.maxHp * (e.boss !== null ? CLOT_BOSS_MULT : 1) * s.memory.dmgMult * dt;
    dealDamage(s, e, raw, 'barrier', t.id, 'barrier', t, true, true);
  }
}

// ── Projectiles ─────────────────────────────────────────────────────────────

export function updateProjectiles(s: GameState, dt: number): void {
  const list = s.projectiles;
  if (!list.length) return;
  const now = s.time;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.done) continue;
    p.px = p.x;
    p.py = p.y;
    const target = findEnemy(s, p.targetId);
    if (target !== undefined && isBurrowed(target, now)) {
      p.done = true; // burrow: projectiles in flight miss (§5.9 o)
      continue;
    }
    const live = target !== undefined && alive(target);
    if (live) {
      p.tx = target.x;
      p.ty = target.y;
    }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const stepLen = p.speed * dt;
    if (d <= stepLen) {
      p.x = p.tx;
      p.y = p.ty;
      p.t = 1;
      p.done = true;
      impact(s, p, live ? (target as Enemy) : null);
    } else {
      p.x += (dx / d) * stepLen;
      p.y += (dy / d) * stepLen;
      p.t += (1 - p.t) * (stepLen / d);
    }
  }
  let w = 0;
  for (let i = 0; i < list.length; i++) if (!list[i].done) list[w++] = list[i];
  list.length = w;
}

function antibodyHit(s: GameState, p: Projectile, e: Enemy, tower: Tower | null): void {
  const dmg = dealDamage(s, e, p.dmg, 'projectile', p.src, 'antibody', tower, false, false);
  emit(s, { type: 'hit', kind: 'antibody', enemy: e.id, x: e.x, y: e.y, dmg, crit: false });
  if (dmg > 0 && p.mark !== null) addMark(s, e, 1, p.mark === 'strong');
}

const polyPick: Enemy[] = [];

function impact(s: GameState, p: Projectile, target: Enemy | null): void {
  const tower = findTower(s, p.src) ?? null;
  const now = s.time;
  if (p.kind === 'antibody') {
    if (!target) return;
    antibodyHit(s, p, target, tower);
    if (p.spec === 'polyvalent') {
      const st = TOWERS.antibody.specs.polyvalent;
      const extra = st?.splitTargets ?? 2;
      const r = st?.splitRadius ?? 1.5;
      polyPick.length = 0;
      const list = s.enemies;
      for (let n = 0; n < extra; n++) {
        let best: Enemy | null = null;
        let bestD = Infinity;
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (e === target || !canTarget(s, 'antibody', e) || polyPick.includes(e)) continue;
          const d = dist2(e.x, e.y, target.x, target.y);
          if (d > r * r) continue;
          if (d < bestD - 1e-12) {
            bestD = d;
            best = e;
          }
        }
        if (!best) break;
        polyPick.push(best);
      }
      for (let k = 0; k < polyPick.length; k++) antibodyHit(s, p, polyPick[k], tower);
      polyPick.length = 0;
    }
    return;
  }
  if (p.kind === 'mast') {
    const st = TOWERS.mast.specs;
    const r = p.splash;
    const list = s.enemies;
    let hits = 0;
    const slow = p.spec === 'allergyStorm' ? st.allergyStorm : undefined;
    const burn = p.spec === 'histamineBurn' ? st.histamineBurn : undefined;
    const burnDps = burn ? (burn.dotDps ?? 16) * Math.sqrt(growth(Math.max(1, s.wave))) * (tower ? tower.buff.dmg : 1) * s.memory.dmgMult : 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!alive(e) || e.flying || isBurrowed(e, now)) continue;
      const z = zonesWithin(s, e, p.tx, p.ty, r, false);
      if (!z) continue;
      hits++;
      // Each hit zone is a full hit (armor applies per zone, §3.1 segmented).
      let dmg = 0;
      for (let k = 0; k < z; k++) dmg += dealDamage(s, e, p.dmg, 'projectile', p.src, 'mast', tower, false, false);
      if (dmg > 0 || !immuneTo(e, 'mast', now)) {
        if (slow) applySlow(e, p.src, slow.slow ?? 0.2, now + (slow.slowDuration ?? 1.5));
        if (burn) applyBurn(e, p.src, burnDps, now + (burn.dotDuration ?? 4));
      }
      emit(s, { type: 'hit', kind: 'mast', enemy: e.id, x: e.x, y: e.y, dmg, crit: false });
    }
    emit(s, { type: 'splash', kind: 'mast', x: p.tx, y: p.ty, radius: r, hits });
  }
}

// ── DoTs, pools, regen, heal (§5.6) ─────────────────────────────────────────

const healed = new Set<number>();

export function updateEnemyEffects(s: GameState, dt: number): void {
  const now = s.time;
  const list = s.enemies;
  const second = Math.floor(now) !== Math.floor(now - dt);
  // Burns (histamine): armor-ignoring, paused while burrowed.
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const dots = e.dots;
    if (!dots.length) continue;
    let w = 0;
    for (let k = 0; k < dots.length; k++) {
      const d = dots[k];
      if (d.until <= now) continue;
      dots[w++] = d;
      if (!alive(e) || isBurrowed(e, now)) continue;
      const tw = findTower(s, d.src) ?? null;
      dealDamage(s, e, d.dps * dt, 'projectile', d.src, 'mast', tw, true, true);
    }
    dots.length = w;
  }
  // Acid pools.
  const pools = s.pools;
  if (pools.length) {
    let w = 0;
    for (let k = 0; k < pools.length; k++) {
      const pool = pools[k];
      if (pool.until <= now) continue;
      pools[w++] = pool;
      const tw = findTower(s, pool.src) ?? null;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!alive(e) || e.flying || isBurrowed(e, now)) continue;
        const z = zonesWithin(s, e, pool.x, pool.y, pool.radius, false);
        if (!z) continue;
        dealDamage(s, e, pool.dps * dt * z, 'melee', pool.src, 'macrophage', tw, true, true);
      }
    }
    pools.length = w;
  }
  // Regen + biofilm heal aura (a target takes healing from at most one biofilm).
  healed.clear();
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!alive(b) || b.regenSuppressedUntil > now) continue;
    const def = ENEMIES[b.type];
    if (b.regen > 0 && b.hp < b.maxHp) {
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * b.regen * dt);
    }
    const hr = def.healRadius ?? 0;
    if (hr <= 0) continue;
    const rate = def.healRate ?? 0;
    const r2 = hr * hr;
    for (let j = 0; j < list.length; j++) {
      const o = list[j];
      if (o === b || !alive(o) || o.regenSuppressedUntil > now || healed.has(o.id) || isBurrowed(o, now)) continue;
      if (dist2(o.x, o.y, b.x, b.y) > r2) continue;
      healed.add(o.id);
      if (o.hp >= o.maxHp) continue;
      const amount = o.maxHp * rate;
      o.hp = Math.min(o.maxHp, o.hp + amount * dt);
      if (second) emit(s, { type: 'heal', enemy: o.id, amount });
    }
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

export function towerAt(s: GameState, col: number, row: number): Tower | undefined {
  for (const t of s.towers) if (t.col === col && t.row === row) return t;
  return undefined;
}

export function isPad(s: GameState, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= s.map.cols || row >= s.map.rows) return false;
  return info(s).padKind[row * s.map.cols + col] > 0;
}

export function isPathCell(s: GameState, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= s.map.cols || row >= s.map.rows) return false;
  return info(s).pathMask[row * s.map.cols + col] > 0;
}

function barrierCount(s: GameState): number {
  let n = 0;
  for (const t of s.towers) if (t.type === 'barrier') n++;
  return n;
}

function deny(s: GameState, reason: DeniedReason): void {
  emit(s, { type: 'denied', reason });
}

export function canBuild(s: GameState, col: number, row: number, type: TowerId): BuildCheck {
  const def = TOWERS[type];
  const cost = def ? def.levels[0].cost : 0;
  const no = (reason: DeniedReason): BuildCheck => ({ ok: false, reason, cost });
  if (!def) return no('notPad');
  if (s.phase === 'over') return no('phase');
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= s.map.cols || row >= s.map.rows) {
    return no(def.onPath ? 'notPath' : 'notPad');
  }
  const mi = info(s);
  const idx = row * s.map.cols + col;
  if (def.onPath) {
    if (!mi.pathMask[idx]) return no('notPath');
    if (mi.banMask[idx] & mi.pathMask[idx]) return no('barrierZone');
    if (towerAt(s, col, row)) return no('occupied');
    if (barrierCount(s) >= s.map.maxBarriers) return no('barrierLimit');
  } else {
    if (!mi.padKind[idx]) return no('notPad');
    if (towerAt(s, col, row)) return no('occupied');
  }
  if (s.atp < cost) return no('noAtp');
  return { ok: true, reason: null, cost };
}

export function build(s: GameState, col: number, row: number, type: TowerId): Tower | null {
  const check = canBuild(s, col, row, type);
  if (!check.ok) {
    deny(s, check.reason ?? 'notPad');
    return null;
  }
  const def = TOWERS[type];
  const st = def.levels[0];
  const mi = info(s);
  const idx = row * s.map.cols + col;
  const hp = def.onPath ? (st.hp ?? 0) * s.memory.barrierHpMult : 0;
  const t: Tower = {
    id: s.nextId++,
    type,
    col,
    row,
    x: col + 0.5,
    y: row + 0.5,
    level: 1,
    spec: null,
    targeting: def.defaultTargeting,
    readyAt: s.time,
    lastShotAt: -1,
    targetId: null,
    angle: -Math.PI / 2,
    invested: check.cost,
    kills: 0,
    damageDealt: 0,
    infectedUntil: 0,
    immuneUntil: 0,
    onVilli: mi.padKind[idx] === 2,
    buff: { rate: 1, dmg: 1, range: 0, immune: false },
    engulfReadyAt: s.time,
    digestingUntil: 0,
    cureAt: s.time,
    hp,
    maxHp: hp,
    regenAt: 0,
    pathDist: mi.cellDist.map((d) => (def.onPath ? d[idx] : -1)),
  };
  spendAtp(s, check.cost, t.x, t.y);
  s.towers.push(t);
  computeBuffs(s);
  emit(s, { type: 'build', tower: t.id, kind: type, x: t.x, y: t.y, cost: check.cost });
  return t;
}

export function upgrade(s: GameState, towerId: number, spec?: SpecId): boolean {
  const t = findTower(s, towerId);
  if (!t) return false;
  if (s.phase === 'over') {
    deny(s, 'phase');
    return false;
  }
  const cost = upgradeCost(t);
  if (cost === null) {
    deny(s, 'maxLevel');
    return false;
  }
  let chosen: SpecId | null = null;
  if (t.level === 2) {
    if (!spec || !TOWER_SPECS[t.type].includes(spec)) {
      deny(s, 'needSpec');
      return false;
    }
    chosen = spec;
  }
  if (s.atp < cost) {
    deny(s, 'noAtp');
    return false;
  }
  spendAtp(s, cost, t.x, t.y);
  t.level = (t.level + 1) as TowerLevel;
  if (chosen) t.spec = chosen;
  t.invested += cost;
  if (t.type === 'barrier') {
    t.maxHp = (statsOf(t).hp ?? 0) * s.memory.barrierHpMult;
    t.hp = t.maxHp;
  }
  computeBuffs(s);
  emit(s, { type: 'upgrade', tower: t.id, kind: t.type, level: t.level, spec: t.spec, cost });
  return true;
}

/** Removes a barrier from the map, releasing every enemy that was attacking it. */
export function removeTower(s: GameState, t: Tower): void {
  const i = s.towers.indexOf(t);
  if (i >= 0) s.towers.splice(i, 1);
  if (t.type === 'barrier') {
    for (const e of s.enemies) if (e.attacking === t.id) e.attacking = null;
  }
  computeBuffs(s);
}

export function sell(s: GameState, towerId: number): number {
  const t = findTower(s, towerId);
  if (!t) return 0;
  if (s.phase === 'over') {
    deny(s, 'phase');
    return 0;
  }
  const refund = sellValue(t);
  removeTower(s, t);
  grantAtp(s, refund, t.x, t.y);
  s.stats.atpEarned -= refund; // refunds are not income
  emit(s, { type: 'sell', tower: t.id, kind: t.type, x: t.x, y: t.y, refund });
  return refund;
}

export function setTargeting(s: GameState, towerId: number, mode: Targeting): void {
  const t = findTower(s, towerId);
  if (!t || !TOWERS[t.type].hasTargeting) return;
  if (mode !== 'first' && mode !== 'strongest' && mode !== 'marked') return;
  if (t.targeting === mode) return;
  t.targeting = mode;
  t.targetId = null;
  emit(s, { type: 'targeting', tower: t.id, mode });
}

// ── Panel stats ─────────────────────────────────────────────────────────────

/**
 * Extras keys (the UI translates `stat_<key>`): splash, slow, slowDuration, stun, auraDps, targets, jump, jumpMarked,
 * falloff, vsRegen, suppress, engulfThreshold, engulfCooldown, digest, acidSplash, acidDps, buffRate, buffDmg,
 * buffRange, cureEvery, reveal, globalRate, globalDmg, hp, regen, reflect, contactDps, burnDps, burnDuration,
 * extraTargets, markBonus, markDuration, execute, vsMarked, vsBoss, vsSpawned, ignoresArmor.
 * Fractions are given as fractions (0.25 = 25 %); HP-fraction effects (acid, clot) are evaluated for a reference
 * enemy: the wave's bacterium maxHP for acid / clot lines.
 */
export function towerStats(s: GameState, tower: Tower, level?: TowerLevel, spec?: SpecId | null): TowerStatBlock {
  const lv = level ?? tower.level;
  const sp = spec === undefined ? (lv === tower.level ? tower.spec : null) : spec;
  const block = statBlock(s, tower, lv, sp);
  const cur: TowerStatBlock = {
    ...block,
    upgradeCost: upgradeCost({ type: tower.type, level: lv }),
    sellValue: sellValue(tower),
    nextLevel: null,
  };
  if (lv < 3) {
    const next = statBlock(s, tower, (lv + 1) as TowerLevel, null);
    cur.nextLevel = { dmg: next.dmg, rate: next.rate, range: next.range, dps: next.dps, extras: next.extras };
  }
  return cur;
}

function statBlock(s: GameState, tower: Tower, lv: TowerLevel, sp: SpecId | null): { dmg: number; rate: number; range: number; dps: number; extras: { key: string; value: number }[] } {
  const st = levelStats(tower.type, lv, sp);
  const def = TOWERS[tower.type];
  const w = statWave(s);
  const gs = Math.sqrt(growth(w));
  const dmgMult = tower.buff.dmg * s.memory.dmgMult;
  const rate = st.rate * tower.buff.rate;
  const rangeBonus = (tower.onVilli ? villiBonus(st.range) : 0) + (tower.type === 'beacon' || tower.type === 'barrier' ? 0 : tower.buff.range - (tower.onVilli ? villiBonus(levelStats(tower.type, tower.level, tower.spec).range) : 0));
  const range = st.range > 0 ? st.range + rangeBonus : 0;
  const extras: { key: string; value: number }[] = [];
  const x = (key: string, value: number | undefined) => {
    if (value !== undefined) extras.push({ key, value });
  };
  let dmg = st.dmg * dmgMult;
  let dps = dmg * rate;
  const refHp = Math.round(40 * growth(w) * s.map.hpMult);
  switch (tower.type) {
    case 'antibody':
      x('markBonus', st.mark === 'strong' ? 0.35 : 0.1);
      x('markDuration', st.mark === 'strong' ? 7 : 4);
      if (st.splitTargets) x('extraTargets', st.splitTargets);
      break;
    case 'macrophage':
      x('engulfThreshold', Math.round((st.engulfThreshold ?? 0) * growth(w)));
      x('engulfCooldown', st.engulfCooldown);
      x('digest', st.digestTime);
      if (st.acidSplashFrac) {
        x('acidSplash', st.acidSplashFrac);
        x('acidDps', st.acidPoolFrac);
      }
      break;
    case 'mast':
      x('splash', st.splash);
      if (st.slow) {
        x('slow', st.slow);
        x('slowDuration', st.slowDuration);
      }
      if (st.dotDps) {
        x('burnDps', Math.round(st.dotDps * gs * dmgMult * 10) / 10);
        x('burnDuration', st.dotDuration);
      }
      break;
    case 'pyrogen':
      dmg = (st.auraDps ?? 0) * gs * dmgMult;
      dps = dmg * tower.buff.rate;
      x('slow', st.slow);
      x('auraDps', Math.round(dps * 10) / 10);
      if (st.stun) x('stun', st.stun);
      break;
    case 'tcell':
      x('vsMarked', def.vsMarked);
      x('vsBoss', def.vsBoss);
      x('vsSpawned', def.vsSpawned);
      if (st.ignoresArmor) x('ignoresArmor', 1);
      if (st.executeBelow) x('execute', st.executeBelow);
      break;
    case 'complement':
      x('targets', st.chainTargets);
      x('jump', st.chainJump);
      x('jumpMarked', st.chainJumpMarked);
      x('falloff', st.chainFalloff);
      x('vsRegen', sp === 'membraneAttack' ? MEMBRANE_VS_REGEN : def.vsRegen);
      if (st.suppress) x('suppress', st.suppress);
      break;
    case 'beacon':
      dmg = 0;
      dps = 0;
      x('buffRate', st.buffRate);
      x('buffDmg', st.buffDmg);
      if (st.buffRange) x('buffRange', st.buffRange);
      x('cureEvery', st.cureEvery);
      x('reveal', (st.reveal ?? 0) + (tower.onVilli ? villiBonus(st.reveal ?? 0) : 0));
      if (st.globalRate) {
        x('globalRate', st.globalRate);
        x('globalDmg', st.globalDmg);
      }
      break;
    case 'barrier':
      dmg = 0;
      dps = 0;
      x('hp', Math.round((st.hp ?? 0) * s.memory.barrierHpMult));
      x('regen', st.regen);
      if (st.reflectFrac) {
        x('reflect', Math.round(st.reflectFrac * refHp * 10) / 10);
        x('contactDps', Math.round((st.contactFrac ?? 0) * refHp * 10) / 10);
      }
      break;
  }
  return { dmg: Math.round(dmg * 10) / 10, rate: Math.round(rate * 100) / 100, range: Math.round(range * 100) / 100, dps: Math.round(dps * 10) / 10, extras };
}

