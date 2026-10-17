/**
 * The fixed-step simulation loop and run flow (§7): wave start / clear / countdown / endless / game over, stars.
 */
import type { GameState } from '../types';
import { SIM_STEP, WAVES_PER_MAP } from '../types';
import { DIFFICULTIES, ENEMIES } from './data';
import { moveEnemies, resolveDeaths, updateBosses, updateFlow, updateReveal, updateSpawns } from './enemies';
import { updateAbilities, updateHero } from './hero';
import { emit, grantAtp, info, tickFlags } from './state';
import { computeBuffs, updateEnemyEffects, updateProjectiles, updateTowers } from './towers';
import { earlyBonus, expandWave, interestFor, waveClearBonus, waveScript } from './waves';
import type { BossId } from '../types';

/**
 * Advances the simulation by `dt` seconds. Designed for `dt = SIM_STEP` (1/60 s); a larger dt is split into equal
 * sub-steps ≤ SIM_STEP so combat stays stable. In `cleared` / `over` only the hero moves.
 */
export function step(s: GameState, dt: number): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  if (dt > SIM_STEP * 1.0001) {
    const n = Math.ceil(dt / SIM_STEP - 1e-9);
    const sub = dt / n;
    for (let i = 0; i < n; i++) stepOnce(s, sub);
    return;
  }
  stepOnce(s, dt);
}

function stepOnce(s: GameState, dt: number): void {
  const prev = s.time;
  s.time = prev + dt;
  tickFlags.secondBoundary = Math.floor(s.time) !== Math.floor(prev);
  const phase = s.phase;
  if (phase === 'over' || phase === 'cleared') {
    updateHero(s, dt);
    return;
  }
  s.stats.playtime += dt;
  if (phase === 'wave') {
    updateFlow(s, dt);
    updateSpawns(s, dt);
  }
  updateAbilities(s);
  if (s.enemies.length) {
    updateBosses(s);
    moveEnemies(s, dt);
    updateReveal(s);
  }
  updateTowers(s, dt);
  updateProjectiles(s, dt);
  if (s.enemies.length || s.pools.length) updateEnemyEffects(s, dt);
  updateHero(s, dt);
  if (s.enemies.length) resolveDeaths(s);
  // Phase transitions.
  if (s.vitality <= 0) {
    s.vitality = 0;
    s.phase = 'over';
    s.projectiles.length = 0;
    s.stats.minVitality = 0;
    emit(s, { type: 'gameOver', wave: s.wave });
    return;
  }
  if (s.phase === 'wave') {
    if (s.waveState.queue.length === 0 && s.enemies.length === 0) waveCleared(s);
  } else if (s.phase === 'countdown') {
    s.countdown -= dt;
    if (s.countdown <= 1e-9) {
      s.countdown = 0;
      startWave(s, false);
    }
  }
}

function resetFlow(s: GameState): void {
  const f = s.flow;
  if (f.reversed) emit(s, { type: 'flowReverse', reversed: false });
  f.cycleT = 0;
  f.reversed = false;
  f.warn = false;
}

/** Stars from the total vitality lost to leaks (§5.8). */
export function computeStars(vitLost: number, maxVitality: number): number {
  return 1 + (vitLost <= Math.floor(0.5 * maxVitality) ? 1 : 0) + (vitLost <= Math.floor(0.1 * maxVitality) ? 1 : 0);
}

/** Stars earned this run (frozen when wave 20 is cleared); 0 before. */
export function starsFor(s: GameState): number {
  if (s.stars > 0) return s.stars;
  if (s.phase === 'cleared') return computeStars(s.stats.vitLost, s.maxVitality);
  return 0;
}

function waveCleared(s: GameState): void {
  const mi = info(s);
  const bonus = waveClearBonus(s.wave, s.difficulty);
  grantAtp(s, bonus, mi.coreX, mi.coreY);
  const interest = interestFor(s.atp, s.memory.interest, s.memory.interestCap);
  grantAtp(s, interest, mi.coreX, mi.coreY);
  const vitRestored = Math.max(0, Math.min(s.memory.vitPerWave, s.maxVitality - s.vitality));
  s.vitality += vitRestored;
  s.stats.wavesCleared++;
  resetFlow(s);
  emit(s, { type: 'waveClear', wave: s.wave, bonus, interest, vitRestored });
  if (s.wave >= WAVES_PER_MAP && !s.endless) {
    s.phase = 'cleared';
    s.countdown = 0;
    s.stars = computeStars(s.stats.vitLost, s.maxVitality);
    s.projectiles.length = 0;
    emit(s, { type: 'mapCleared', wave: s.wave, stars: s.stars });
  } else {
    s.phase = 'countdown';
    s.countdown = DIFFICULTIES[s.difficulty].countdown;
  }
}

export function canStartWave(s: GameState): boolean {
  return s.phase === 'build' || s.phase === 'countdown';
}

/**
 * Starts the next wave. `early` in `countdown` grants the early-call bonus for the remaining countdown (§9.2).
 * Returns the bonus granted (0 when none) or -1 when not allowed.
 */
export function startWave(s: GameState, early = false): number {
  if (!canStartWave(s)) return -1;
  const next = s.wave + 1;
  let bonus = 0;
  if (early && s.phase === 'countdown') {
    bonus = earlyBonus(next, s.countdown, s.difficulty);
    if (bonus > 0) {
      const mi = info(s);
      grantAtp(s, bonus, mi.coreX, mi.coreY);
      emit(s, { type: 'earlyBonus', wave: next, bonus });
    }
  }
  s.wave = next;
  s.phase = 'wave';
  s.countdown = 0;
  const groups = waveScript(s.mapId, next);
  const ws = s.waveState;
  ws.queue = expandWave(s.map, groups, next);
  ws.elapsed = 0;
  ws.total = ws.queue.length;
  ws.spawnedCount = 0;
  ws.bossIds = [];
  for (let i = 0; i < ws.lastSpawnAt.length; i++) ws.lastSpawnAt[i] = 0;
  resetFlow(s);
  let boss: BossId | null = null;
  for (const g of groups) {
    if (ENEMIES[g.type].boss) {
      boss = g.type as BossId;
      break;
    }
  }
  computeBuffs(s);
  emit(s, { type: 'waveStart', wave: next, bonus, boss });
  return bonus;
}

/** After the victory modal: keep playing endless waves (§7). */
export function continueEndless(s: GameState): void {
  if (s.phase !== 'cleared') return;
  s.endless = true;
  s.phase = 'countdown';
  s.countdown = DIFFICULTIES[s.difficulty].countdown;
}
