/**
 * Enemy systems: wave spawning (§7.2), breathing flow (§5.2), movement with flow / slows / fever and barrier
 * blocking (§5.2, §5.4), leaks (§7.9), boss skills (§3.1), stealth reveal, virus infection (§5.3) and the end-of-step
 * death / division resolution.
 */
import type { BossId, BossSkillDef, BossSkillState, Enemy, GameState, Tower } from '../types';
import { WAVES_PER_MAP } from '../types';
import {
  BARRIER_REGEN_DELAY,
  BARRIER_STOP,
  BOSS_SKILLS,
  BOSS_SMASH_PAUSE,
  DIFFICULTIES,
  ENEMIES,
  HARD_BURROW_DISTANCE,
  MUTATION_REF_DURATION,
  SLOW_CAP,
  SPAWN_SPACING,
} from './data';
import {
  alive,
  divideEnemy,
  dist2,
  emit,
  infectTower,
  canInfect,
  killEnemy,
  layoutSegments,
  spawnEnemy,
  stopAhead,
  dealDamage,
  updateEnemyPos,
} from './state';
import { removeTower, towerSlow, levelStats } from './towers';

// ── Spawning ────────────────────────────────────────────────────────────────

function pathBlocked(s: GameState, pathIndex: number): boolean {
  const list = s.enemies;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.pathIndex === pathIndex && !e.dead && !e.leaked && e.dist < SPAWN_SPACING) return true;
  }
  return false;
}

export function updateSpawns(s: GameState, dt: number): void {
  const ws = s.waveState;
  ws.elapsed += dt;
  const q = ws.queue;
  let i = 0;
  while (i < q.length && q[i].at <= ws.elapsed + 1e-9) {
    const it = q[i];
    if (pathBlocked(s, it.pathIndex)) {
      i++;
      continue;
    }
    q.splice(i, 1);
    const e = spawnEnemy(s, it.type, it.pathIndex, 0, false);
    ws.spawnedCount++;
    if (ws.lastSpawnAt[it.pathIndex] !== undefined) ws.lastSpawnAt[it.pathIndex] = s.time;
    if (e.boss !== null) ws.bossIds.push(e.id);
  }
}

// ── Breathing (Alveoli) ─────────────────────────────────────────────────────

export function updateFlow(s: GameState, dt: number): void {
  const br = s.map.breathing;
  if (!br) return;
  const f = s.flow;
  f.cycleT += dt;
  while (f.cycleT >= br.period) f.cycleT -= br.period;
  const revStart = br.period - br.reverseFor;
  const warnStart = revStart - br.warnFor;
  const reversed = f.cycleT >= revStart - 1e-9;
  const warn = !reversed && f.cycleT >= warnStart - 1e-9;
  if (warn && !f.warn) emit(s, { type: 'flowWarn' });
  f.warn = warn;
  if (reversed !== f.reversed) {
    f.reversed = reversed;
    if (reversed) breathPush(s, br.push, br.interrupt);
    emit(s, { type: 'flowReverse', reversed });
  }
}

/** Reversal onset: every ground enemy is pushed back (bosses half), barrier attackers are interrupted (§5.2). */
function breathPush(s: GameState, push: number, interrupt: number): void {
  const now = s.time;
  for (const e of s.enemies) {
    if (!alive(e) || e.flying) continue;
    if (e.boss !== null && e.boss.burrowedUntil > now) continue;
    e.dist = Math.max(0, e.dist - (e.boss !== null ? push * 0.5 : push));
    if (e.attacking !== null) {
      e.attacking = null;
      e.attackBlockedUntil = now + interrupt;
    }
    updateEnemyPos(s, e);
    e.px = e.x;
    e.py = e.y;
    layoutSegments(e);
    if (e.segments.length) e.pdist = e.segments[e.segments.length - 1];
  }
}

// ── Movement ────────────────────────────────────────────────────────────────

const barriers: Tower[] = [];

function flowFactor(e: Enemy, flow: number): number {
  if (e.flying) return 1;
  if (e.boss !== null) return flow === 1 ? 1.15 : flow === -1 ? 0.9 : 1;
  return flow === 1 ? 1.3 : flow === -1 ? 0.8 : 1;
}

/** Instantaneous speed (cells/s) of an enemy under the current flow, slows and fever (§5.2). */
export function enemyVelocity(s: GameState, e: Enemy): number {
  const now = s.time;
  const b = e.boss;
  if (b !== null && b.burrowedUntil > now) return 0;
  if (b !== null && b.charging) return e.speed * chargeMult(e);
  if (e.stunUntil > now || (b !== null && b.pausedUntil > now)) return 0;
  if (e.attacking !== null) return 0;
  let flow: number = s.geoms[e.pathIndex].segFlow[e.seg] ?? 0;
  if (s.flow.reversed) flow = -flow;
  const slow = towerSlow(e, now, SLOW_CAP);
  const fever = s.abilities.fever.activeUntil > now ? (b !== null ? 0.8 : 0.6) : 1;
  return e.speed * flowFactor(e, flow) * (1 - slow) * fever;
}

const CHARGE_MULT = BOSS_SKILLS.giantParasite.find((d) => d.id === 'charge')?.amount ?? 3;

function chargeMult(e: Enemy): number {
  return e.type === 'giantParasite' ? CHARGE_MULT : 1;
}

/** Stop point of the barrier returned by the last `barrierAhead` call (module scratch, no allocation). */
let aheadStop = Infinity;

/** First living barrier ahead of the enemy on its path (sets `aheadStop`), or null. */
function barrierAhead(e: Enemy): Tower | null {
  let best: Tower | null = null;
  let bestStop = Infinity;
  for (let i = 0; i < barriers.length; i++) {
    const t = barriers[i];
    if (t.hp <= 0) continue;
    const d = t.pathDist[e.pathIndex];
    if (d === undefined || d < 0) continue;
    const stop = d - BARRIER_STOP;
    if (stop >= e.dist - 1e-6 && stop < bestStop) {
      bestStop = stop;
      best = t;
    }
  }
  aheadStop = bestStop;
  return best;
}

export function moveEnemies(s: GameState, dt: number): void {
  const now = s.time;
  const list = s.enemies;
  barriers.length = 0;
  for (const t of s.towers) if (t.type === 'barrier' && t.hp > 0) barriers.push(t);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    e.px = e.x;
    e.py = e.y;
    if (e.segments.length) e.pdist = e.segments[e.segments.length - 1];
    if (!alive(e)) continue;
    const g = s.geoms[e.pathIndex];
    const b = e.boss;
    e.attacking = null;
    let nd = e.dist + enemyVelocity(s, e) * dt;
    if (!e.flying && barriers.length) {
      const ahead = barrierAhead(e);
      if (ahead !== null && nd >= aheadStop) {
        if (b !== null) {
          smashBarrier(s, ahead, e);
          if (!b.charging) {
            nd = aheadStop;
            b.pausedUntil = now + BOSS_SMASH_PAUSE;
          }
        } else {
          nd = aheadStop;
          if (now >= e.attackBlockedUntil) e.attacking = ahead.id;
        }
      }
    }
    e.dist = nd;
    if (nd >= g.length) {
      leak(s, e);
      continue;
    }
    updateEnemyPos(s, e);
    if (e.segments.length) layoutSegments(e);
  }
  // Barrier attacks (§5.4) and Clot Spikes reflection.
  if (barriers.length) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.attacking === null || !alive(e)) continue;
      let bt: Tower | null = null;
      for (let k = 0; k < barriers.length; k++) if (barriers[k].id === e.attacking) bt = barriers[k];
      if (bt === null || bt.hp <= 0) {
        e.attacking = null;
        continue;
      }
      const before = bt.hp;
      bt.hp -= e.attack * dt;
      bt.regenAt = now + BARRIER_REGEN_DELAY;
      const st = levelStats('barrier', bt.level, bt.spec);
      if (st.reflectFrac) dealDamage(s, e, st.reflectFrac * e.maxHp * s.memory.dmgMult * dt, 'barrier', bt.id, 'barrier', bt, true, true);
      if (Math.ceil((bt.hp / bt.maxHp) * 20) !== Math.ceil((before / bt.maxHp) * 20) || before === bt.maxHp) {
        emit(s, { type: 'barrierHit', tower: bt.id, enemy: e.id, hp: Math.max(0, bt.hp), maxHp: bt.maxHp });
      }
      if (bt.hp <= 0) {
        bt.hp = 0;
        emit(s, { type: 'barrierBroken', tower: bt.id, x: bt.x, y: bt.y });
      }
    }
  }
  // Remove destroyed barriers (broken or smashed this step).
  for (let k = barriers.length - 1; k >= 0; k--) if (barriers[k].hp <= 0) removeTower(s, barriers[k]);
  // Virus infection of adjacent towers (Chebyshev distance 1 between cells).
  if (s.towers.length) infectByViruses(s);
}

function smashBarrier(s: GameState, t: Tower, boss: Enemy): void {
  if (t.hp <= 0) return;
  t.hp = 0;
  emit(s, { type: 'barrierSmashed', tower: t.id, by: boss.id, x: t.x, y: t.y });
}

function leak(s: GameState, e: Enemy): void {
  e.leaked = true;
  s.vitality -= e.vit;
  s.stats.vitLost += e.vit;
  s.stats.leaks++;
  if (s.vitality < s.stats.minVitality) s.stats.minVitality = Math.max(0, s.vitality);
  emit(s, { type: 'leak', enemy: e.id, enemyType: e.type, vit: e.vit, vitality: Math.max(0, s.vitality) });
}

function infectByViruses(s: GameState): void {
  const now = s.time;
  const towers = s.towers;
  for (const e of s.enemies) {
    if (e.type !== 'virus' || !alive(e)) continue;
    const cx = Math.floor(e.x);
    const cy = Math.floor(e.y);
    const dur = ENEMIES.virus.infectDuration ?? 8;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      if (t.col < cx - 1 || t.col > cx + 1 || t.row < cy - 1 || t.row > cy + 1) continue;
      if (!canInfect(t, now) || e.infected.includes(t.id)) continue;
      if (infectTower(s, t, dur, e.id)) e.infected.push(t.id);
    }
  }
}

// ── Reveal (stealth) ────────────────────────────────────────────────────────

export function updateReveal(s: GameState): void {
  const h = s.hero;
  const hr = s.memory.heroRevealRadius;
  const towers = s.towers;
  for (const e of s.enemies) {
    if (!e.stealth || !alive(e)) continue;
    let rev = h.alive && dist2(h.x, h.y, e.x, e.y) <= hr * hr;
    if (!rev) {
      for (let i = 0; i < towers.length && !rev; i++) {
        const t = towers[i];
        if (t.type !== 'beacon') continue;
        const st = levelStats('beacon', t.level, t.spec);
        const base = st.reveal ?? 0;
        const r = base + (t.onVilli ? (base >= 3.5 ? 0.5 : 1) : 0);
        if (dist2(t.x, t.y, e.x, e.y) <= r * r) rev = true;
      }
    }
    if (rev !== e.revealed) {
      e.revealed = rev;
      emit(s, { type: 'reveal', enemy: e.id, revealed: rev });
    }
  }
}

// ── Boss skills (§3.1) ──────────────────────────────────────────────────────

function sporulationCount(wave: number, def: BossSkillDef): number {
  if (wave > WAVES_PER_MAP) return 4;
  return wave > 10 ? 3 : (def.amount ?? 2);
}

function bossEvent(s: GameState, e: Enemy, skill: BossSkillState['id'], stage: 'telegraph' | 'start' | 'end'): void {
  emit(s, { type: 'bossSkill', boss: e.id, bossType: e.type as BossId, skill, stage, x: e.x, y: e.y });
}

export function updateBosses(s: GameState): void {
  const now = s.time;
  const list = s.enemies;
  const mult = DIFFICULTIES[s.difficulty].bossCooldownMult;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const b = e.boss;
    if (b === null || !alive(e)) continue;
    const defs = BOSS_SKILLS[e.type as BossId];
    for (let k = 0; k < b.skills.length; k++) {
      const ks = b.skills[k];
      const def = defs[k];
      if (!def) continue;
      // Active effect ends.
      if (ks.activeUntil > 0 && now >= ks.activeUntil) {
        ks.activeUntil = 0;
        endSkill(s, e, def);
      }
      // Telegraph finished → execute.
      if (ks.telegraphUntil > 0 && now >= ks.telegraphUntil) {
        ks.telegraphUntil = 0;
        executeSkill(s, e, ks, def, mult);
      }
      if (ks.telegraphUntil > 0 || b.burrowedUntil > now) continue;
      // Timed trigger.
      if (def.every !== undefined && now >= ks.nextAt) {
        ks.nextAt += def.every * (def.id === 'mutation' ? 1 : mult);
        if (ks.nextAt <= now) ks.nextAt = now + def.every * (def.id === 'mutation' ? 1 : mult);
        startSkill(s, e, ks, def, mult);
        continue;
      }
      // HP-threshold trigger (one at a time).
      const th = def.thresholds;
      if (th) {
        for (let j = 0; j < th.length; j++) {
          if (ks.firedThresholds.includes(j)) continue;
          if (e.hp <= e.maxHp * th[j]) {
            ks.firedThresholds.push(j);
            startSkill(s, e, ks, def, mult);
          }
          break;
        }
      }
    }
  }
}

function startSkill(s: GameState, e: Enemy, ks: BossSkillState, def: BossSkillDef, mult: number): void {
  if (def.telegraph > 0) {
    ks.telegraphUntil = s.time + def.telegraph;
    bossEvent(s, e, def.id, 'telegraph');
  } else executeSkill(s, e, ks, def, mult);
}

function executeSkill(s: GameState, e: Enemy, ks: BossSkillState, def: BossSkillDef, mult: number): void {
  const now = s.time;
  const b = e.boss;
  if (b === null || !alive(e)) return;
  const dur = (def.duration ?? 0) * (def.id === 'mutation' ? 1 : mult);
  switch (def.id) {
    case 'sporulation': {
      const n = sporulationCount(s.wave, def);
      bossEvent(s, e, def.id, 'start');
      for (let k = 0; k < n; k++) spawnChild(s, e, 'spore', e.dist - 0.25 * k);
      return;
    }
    case 'shellHardening':
      b.hardenedUntil = now + dur;
      ks.activeUntil = b.hardenedUntil;
      bossEvent(s, e, def.id, 'start');
      return;
    case 'charge':
      b.charging = true;
      ks.activeUntil = now + dur;
      bossEvent(s, e, def.id, 'start');
      return;
    case 'burrow':
      b.burrowedUntil = now + dur;
      b.charging = false;
      ks.activeUntil = b.burrowedUntil;
      bossEvent(s, e, def.id, 'start');
      return;
    case 'massInfection': {
      const r = def.amount ?? 3;
      bossEvent(s, e, def.id, 'start');
      for (const t of s.towers) {
        if (dist2(t.x, t.y, e.x, e.y) > r * r) continue;
        infectTower(s, t, dur, e.id);
      }
      return;
    }
    case 'mutation': {
      let total = 0;
      let top: import('../types').TowerId | null = null;
      let topDmg = 0;
      for (const id of Object.keys(b.dmgByTowerType) as import('../types').TowerId[]) {
        const d = b.dmgByTowerType[id];
        total += d;
        if (d > topDmg) {
          topDmg = d;
          top = id;
        }
      }
      if (top === null || total <= 0) return; // nothing hit it since the last pick → skipped
      const share = topDmg / total;
      const lo = def.durationMin ?? 2;
      const hi = def.durationMax ?? 8;
      const ref = def.shareRef ?? 0.5;
      const d = Math.min(hi, Math.max(lo, (def.duration ?? MUTATION_REF_DURATION) * (share / ref)));
      b.immuneTo = top;
      b.immuneUntil = now + d;
      b.mutations++;
      for (const id of Object.keys(b.dmgByTowerType) as import('../types').TowerId[]) b.dmgByTowerType[id] = 0;
      ks.activeUntil = b.immuneUntil;
      bossEvent(s, e, def.id, 'start');
      emit(s, { type: 'mutation', boss: e.id, immuneTo: top, until: b.immuneUntil });
      return;
    }
    case 'shedding': {
      const n = def.amount ?? 2;
      bossEvent(s, e, def.id, 'start');
      for (let k = 0; k < n; k++) spawnChild(s, e, 'virus', e.dist - 0.25 * (k + 1));
      return;
    }
  }
}

function endSkill(s: GameState, e: Enemy, def: BossSkillDef): void {
  const b = e.boss;
  if (b === null) return;
  switch (def.id) {
    case 'charge':
      b.charging = false;
      break;
    case 'mutation':
      b.immuneTo = null;
      b.immuneUntil = 0;
      break;
    case 'burrow': {
      // Re-emerge ahead (§3.1); segments follow; prev positions reset (discontinuity).
      const len = s.geoms[e.pathIndex].length;
      const ahead = s.difficulty === 'hard' ? HARD_BURROW_DISTANCE : (def.amount ?? 3);
      b.burrowedUntil = 0;
      e.dist = Math.min(len - 1, e.dist + ahead);
      updateEnemyPos(s, e);
      e.px = e.x;
      e.py = e.y;
      layoutSegments(e);
      if (e.segments.length) e.pdist = e.segments[e.segments.length - 1];
      break;
    }
    default:
      break;
  }
  bossEvent(s, e, def.id, 'end');
}

function spawnChild(s: GameState, parent: Enemy, type: 'spore' | 'virus', d: number): void {
  const len = s.geoms[parent.pathIndex].length;
  let hi = len - 0.5;
  const stop = stopAhead(s, parent.pathIndex, parent.dist);
  if (stop < hi) hi = Math.max(0, stop);
  const dist = d < 0 ? 0 : d > hi ? hi : d;
  spawnEnemy(s, type, parent.pathIndex, dist, true);
}

// ── Death resolution ────────────────────────────────────────────────────────

/** Divisions, kills (with spore splits) and removal of dead / leaked enemies, in id order. */
export function resolveDeaths(s: GameState): void {
  const list = s.enemies;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead || e.leaked) continue;
    const dv = ENEMIES[e.type].divide;
    if (dv && !e.divided && e.hp <= e.maxHp * dv.below) {
      divideEnemy(s, e);
      continue;
    }
    if (e.hp <= 0) killEnemy(s, e, false);
  }
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.dead && !e.leaked) list[w++] = e;
  }
  list.length = w;
}

