/**
 * Hero 小白 Blanc (§6) and the global abilities (§6.1).
 */
import type { AbilityId, CastResult, DeniedReason, Enemy, GameState, Point } from '../types';
import { ABILITY_SRC, HERO_SRC } from '../types';
import {
  ABILITIES,
  ANTIBIOTIC_FAMILY_MULT,
  ENEMIES,
  HERO_ATTACK_TAKEN,
  HERO_CONTACT,
  HERO_LEVELS,
  HERO_REGEN,
  HERO_REGEN_DELAY,
  HERO_SPEED,
} from './data';
import { addMark, alive, dealDamage, dist2, emit, info, isBurrowed, isMarked } from './state';
import { zonesWithin } from './towers';
import { growth } from './waves';

// ── Hero ────────────────────────────────────────────────────────────────────

/** Damage of one hero hit at `wave` before vaccine / mark / armor (§5.1). */
export function heroDamage(s: GameState): number {
  const w = Math.max(1, s.wave);
  return HERO_LEVELS[s.hero.level - 1].dmg * (1 + 0.08 * (w - 1)) * s.memory.heroDmgMult;
}

export function moveHero(s: GameState, x: number, y: number): boolean {
  const h = s.hero;
  if (!h.alive) {
    emit(s, { type: 'denied', reason: 'heroDead' });
    return false;
  }
  if (s.phase === 'over' || !Number.isFinite(x) || !Number.isFinite(y)) {
    emit(s, { type: 'denied', reason: 'phase' });
    return false;
  }
  const m = 0.25;
  const cx = Math.min(s.map.cols - m, Math.max(m, x));
  const cy = Math.min(s.map.rows - m, Math.max(m, y));
  h.dest = { x: cx, y: cy };
  h.targetId = null;
  emit(s, { type: 'heroMove', x: cx, y: cy });
  return true;
}

function respawn(s: GameState): void {
  const h = s.hero;
  const mi = info(s);
  h.alive = true;
  h.hp = h.maxHp;
  h.x = mi.heroX;
  h.y = mi.heroY;
  h.px = h.x;
  h.py = h.y;
  h.dest = null;
  h.targetId = null;
  h.lastHitAt = -100;
  h.readyAt = s.time;
  emit(s, { type: 'heroRespawn', x: h.x, y: h.y });
}

export function updateHero(s: GameState, dt: number): void {
  const h = s.hero;
  const now = s.time;
  const mods = s.memory;
  h.px = h.x;
  h.py = h.y;
  if (!h.alive) {
    if (now >= h.respawnAt) respawn(s);
    return;
  }
  // Walk (straight line: every cell is walkable, §6) — the hero never attacks while walking (§5.9 h).
  if (h.dest !== null) {
    const dx = h.dest.x - h.x;
    const dy = h.dest.y - h.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const stepLen = HERO_SPEED * mods.heroSpeedMult * dt;
    if (d > 1e-9) h.angle = Math.atan2(dy, dx);
    if (d <= stepLen) {
      h.x = h.dest.x;
      h.y = h.dest.y;
      h.dest = null;
    } else {
      h.x += (dx / d) * stepLen;
      h.y += (dy / d) * stepLen;
    }
  }
  // Cure by touch (pass-through, §5.3).
  const cr2 = mods.heroCureRadius * mods.heroCureRadius;
  for (const t of s.towers) {
    if (t.infectedUntil <= now) continue;
    if (dist2(t.x, t.y, h.x, h.y) > cr2) continue;
    t.infectedUntil = now;
    t.immuneUntil = now + mods.heroCureImmunity;
    s.stats.cures++;
    emit(s, { type: 'cure', tower: t.id, by: 'hero', immuneUntil: t.immuneUntil });
  }
  const list = s.enemies;
  // Melee auto-attack on the nearest enemy in range, only while idle.
  if (h.dest === null && list.length) {
    if (h.readyAt <= now + 1e-9) {
      const lv = HERO_LEVELS[h.level - 1];
      let best: Enemy | null = null;
      let bestD = Infinity;
      const r2 = lv.range * lv.range;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!alive(e) || isBurrowed(e, now) || (e.stealth && !e.revealed)) continue;
        const d = dist2(e.x, e.y, h.x, h.y);
        if (d > r2) continue;
        if (d < bestD - 1e-12) {
          bestD = d;
          best = e;
        }
      }
      if (best !== null) {
        h.angle = Math.atan2(best.y - h.y, best.x - h.x);
        h.targetId = best.id;
        h.readyAt = (h.readyAt < now - dt - 1e-9 ? now : h.readyAt) + 1 / lv.rate;
        const dmg = dealDamage(s, best, heroDamage(s), 'melee', HERO_SRC, null, null, false, false);
        if (dmg > 0) addMark(s, best, mods.heroMarkStacks, false);
        emit(s, { type: 'heroAttack', enemy: best.id, x: best.x, y: best.y, dmg });
        emit(s, { type: 'hit', kind: 'hero', enemy: best.id, x: best.x, y: best.y, dmg, crit: false });
      } else h.targetId = null;
    }
  } else h.targetId = null;
  // Damage taken from enemies touching him (§5.4).
  let dps = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!alive(e) || e.flying || isBurrowed(e, now)) continue;
    const r = HERO_CONTACT + e.radius;
    if (dist2(e.x, e.y, h.x, h.y) <= r * r) dps += HERO_ATTACK_TAKEN * e.attack;
  }
  if (dps > 0) {
    const before = h.hp;
    h.hp -= dps * dt;
    h.lastHitAt = now;
    if (Math.ceil((h.hp / h.maxHp) * 10) !== Math.ceil((before / h.maxHp) * 10)) {
      emit(s, { type: 'heroHurt', hp: Math.max(0, h.hp), maxHp: h.maxHp });
    }
    if (h.hp <= 0) {
      h.hp = 0;
      h.alive = false;
      h.dest = null;
      h.targetId = null;
      h.respawnAt = now + mods.heroRespawn;
      emit(s, { type: 'heroDeath', x: h.x, y: h.y, respawnAt: h.respawnAt });
    }
  } else if (now - h.lastHitAt >= HERO_REGEN_DELAY && h.hp < h.maxHp) {
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * HERO_REGEN * dt);
  }
}

// ── Abilities ───────────────────────────────────────────────────────────────

/** Damage one cast deals at `wave` before family multipliers (antibiotic only; 0 for others). */
export function abilityDamage(id: AbilityId, wave: number): number {
  if (id !== 'antibiotic') return 0;
  return (ABILITIES.antibiotic.dmgBase ?? 60) * growth(Math.max(1, wave));
}

function fail(s: GameState, reason: DeniedReason): CastResult {
  emit(s, { type: 'denied', reason });
  return { ok: false, reason };
}

export function castAbility(s: GameState, id: AbilityId, target?: Point): CastResult {
  const a = s.abilities[id];
  const def = ABILITIES[id];
  if (!a || !def) return fail(s, 'locked');
  if (s.phase !== 'build' && s.phase !== 'countdown' && s.phase !== 'wave') return fail(s, 'phase');
  if (!a.unlocked) return fail(s, 'locked');
  const now = s.time;
  if (a.readyAt > now + 1e-9) return fail(s, 'cooldown');
  if (def.targeted && (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y))) return fail(s, 'needTarget');
  a.readyAt = now + a.cooldown;
  switch (id) {
    case 'fever':
    case 'adrenaline':
      a.activeUntil = now + (def.duration ?? 6);
      emit(s, { type: 'abilityCast', ability: id });
      break;
    case 'antibiotic': {
      const tx = Math.min(s.map.cols, Math.max(0, (target as Point).x));
      const ty = Math.min(s.map.rows, Math.max(0, (target as Point).y));
      a.pending = { x: tx, y: ty, at: now + (def.delay ?? 0.4) };
      emit(s, { type: 'abilityCast', ability: id, x: tx, y: ty });
      break;
    }
    case 'booster':
      emit(s, { type: 'abilityCast', ability: id });
      castBooster(s);
      break;
  }
  return { ok: true, reason: null };
}

/** Booster (§6.1): marked non-boss enemies below 30 % die (`execute`), marked bosses take 8 % maxHP. */
function castBooster(s: GameState): void {
  const def = ABILITIES.booster;
  const now = s.time;
  const below = def.executeBelow ?? 0.3;
  const pct = def.bossPercent ?? 0.08;
  let hits = 0;
  for (const e of s.enemies) {
    if (!alive(e) || isBurrowed(e, now) || !isMarked(e, now)) continue;
    if (e.boss !== null) {
      // a flat 8 % of maxHP: the mark that qualifies the boss and its vaccine do not multiply it (§6.1)
      const dmg = dealDamage(s, e, pct * e.maxHp, null, ABILITY_SRC, null, null, true, false, true);
      emit(s, { type: 'hit', kind: 'ability', enemy: e.id, x: e.x, y: e.y, dmg, crit: true });
      hits++;
    } else if (e.hp < e.maxHp * below) {
      emit(s, { type: 'execute', enemy: e.id, enemyType: e.type, x: e.x, y: e.y, by: 'booster' });
      e.lastHitBy = ABILITY_SRC;
      e.hp = 0;
      hits++;
    }
  }
  const mi = info(s);
  emit(s, { type: 'abilityImpact', ability: 'booster', x: mi.coreX, y: mi.coreY, radius: 0, hits });
}

export function updateAbilities(s: GameState): void {
  const now = s.time;
  const ab = s.abilities;
  for (const id of ['fever', 'adrenaline'] as const) {
    const a = ab[id];
    if (a.activeUntil > 0 && now >= a.activeUntil) {
      a.activeUntil = 0;
      emit(s, { type: 'abilityEnd', ability: id });
    }
  }
  const anti = ab.antibiotic;
  if (anti.pending !== null && now >= anti.pending.at - 1e-9) {
    const { x, y } = anti.pending;
    anti.pending = null;
    const def = ABILITIES.antibiotic;
    const r = def.radius ?? 1.5;
    const base = abilityDamage('antibiotic', s.wave);
    let hits = 0;
    for (const e of s.enemies) {
      if (!alive(e) || isBurrowed(e, now)) continue;
      const z = zonesWithin(s, e, x, y, r, false);
      if (!z) continue;
      const fam = ANTIBIOTIC_FAMILY_MULT[ENEMIES[e.type].family] ?? 1;
      const dmg = dealDamage(s, e, base * fam * z, null, ABILITY_SRC, null, null, true, false);
      emit(s, { type: 'hit', kind: 'ability', enemy: e.id, x: e.x, y: e.y, dmg, crit: fam > 1 });
      hits++;
    }
    emit(s, { type: 'splash', kind: 'ability', x, y, radius: r, hits });
    emit(s, { type: 'abilityImpact', ability: 'antibiotic', x, y, radius: r, hits });
  }
}
