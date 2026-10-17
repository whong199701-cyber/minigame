/**
 * Immune Front (免疫防线) — pure, deterministic simulation. No DOM, no three.js, no Math.random.
 *
 * The implementation lives in ./sim/*.ts; this file is the public entry point: every function is re-exported by
 * name and bundled into `logic: ImmuneLogic` (types.ts). Numbers come from docs/briefs/tower-defense-spec.md.
 *
 * Frame-loop contract (§7.10): the UI calls `step(state, SIM_STEP)` up to MAX_STEPS_PER_FRAME times per frame,
 * then `takeEvents(state)` exactly once, then `snapshot(state, snap, acc / SIM_STEP)`. Timers are absolute
 * `state.time` values, so pausing (not stepping) and saving are free.
 */
import type { ImmuneLogic } from './types';
import { ABILITIES, BOSS_SKILLS, DIFFICULTIES, ENEMIES, HERO_LEVELS, MAPS, TALENTS, TOWERS } from './sim/data';
import { findMap, pathGeometry, pointOnPath, validateMap } from './sim/maps';
import {
  buyTalent,
  defaultMemory,
  grantVaccine,
  isHardUnlocked,
  isMapUnlocked,
  noteRecorded,
  parseMemory,
  recordRun,
  resolveModifiers,
  respec,
  talentPoints,
  talentView,
  totalStars,
} from './sim/memory';
import { deserialize, serialize } from './sim/save';
import { createSnapshot, snapshot } from './sim/snapshot';
import { createGame, takeEvents } from './sim/state';
import { canStartWave, continueEndless, starsFor, startWave, step } from './sim/step';
import { build, canBuild, isPad, isPathCell, sell, setTargeting, towerAt, towerStats, upgrade } from './sim/towers';
import { abilityDamage, castAbility, moveHero } from './sim/hero';
import { buildCost, earlyBonus, expandWave, growth, sellValue, upgradeCost, waveClearBonus, wavePreview, waveScript } from './sim/waves';

export * from './sim/data';
export {
  findMap,
  validateMap,
  pathGeometry,
  pointOnPath,
  posOnPath,
  buildPathCells,
  mapInfo,
  villiBonus,
  segAngle,
  isMapId,
  virusRiskPads,
} from './sim/maps';
export type { MapInfo, PathPos } from './sim/maps';
export {
  growth,
  endlessSpeed,
  enemyHp,
  enemyArmor,
  enemyAttack,
  enemyReward,
  enemySpeed,
  rewardFor,
  waveClearBonus,
  earlyBonus,
  interestFor,
  buildCost,
  upgradeCost,
  sellValue,
  tempo,
  parseScript,
  waveScript,
  expandWave,
  waveBosses,
  wavePreview,
  effectiveBaseHp,
  waveEffectiveHp,
} from './sim/waves';
export {
  defaultMemory,
  parseMemory,
  migrateMemory,
  totalStars,
  talentPoints,
  talentView,
  buyTalent,
  respec,
  grantVaccine,
  isMapUnlocked,
  isHardUnlocked,
  resolveModifiers,
  recordRun,
  noteRecorded,
} from './sim/memory';
export {
  createGame,
  takeEvents,
  dealDamage,
  markMult,
  addMark,
  isMarked,
  effectiveArmor,
  vaccineMult,
  spawnEnemy,
  findEnemy,
  findTower,
  killEnemy,
  infectTower,
  canInfect,
  stopAhead,
} from './sim/state';
export {
  levelStats,
  computeBuffs,
  towerRange,
  pickTarget,
  canTarget,
  applySlow,
  towerSlow,
  withinRange,
  zonesWithin,
  canBuild,
  build,
  upgrade,
  sell,
  setTargeting,
  towerAt,
  isPad,
  isPathCell,
  towerStats,
  statWave,
} from './sim/towers';
export { enemyVelocity } from './sim/enemies';
export { moveHero, castAbility, abilityDamage, heroDamage } from './sim/hero';
export { step, startWave, canStartWave, continueEndless, starsFor, computeStars } from './sim/step';
export { snapshot, createSnapshot } from './sim/snapshot';
export { serialize, deserialize } from './sim/save';

/** The whole pure API as one object (types.ts `ImmuneLogic`). */
export const logic: ImmuneLogic = {
  maps: MAPS,
  towers: TOWERS,
  enemies: ENEMIES,
  bossSkills: BOSS_SKILLS,
  abilities: ABILITIES,
  talents: TALENTS,
  difficulties: DIFFICULTIES,
  heroLevels: HERO_LEVELS,
  findMap,
  validateMap,
  pathGeometry,
  pointOnPath,
  createGame,
  step,
  takeEvents,
  snapshot,
  createSnapshot,
  canBuild,
  build,
  upgrade,
  sell,
  setTargeting,
  towerAt,
  isPad,
  isPathCell,
  towerStats,
  buildCost,
  upgradeCost,
  sellValue,
  moveHero,
  castAbility,
  abilityDamage,
  canStartWave,
  startWave,
  continueEndless,
  wavePreview,
  waveScript,
  expandWave,
  earlyBonus,
  waveClearBonus,
  growth,
  defaultMemory,
  parseMemory,
  resolveModifiers,
  totalStars,
  talentPoints,
  talentView,
  buyTalent,
  respec,
  grantVaccine,
  recordRun,
  noteRecorded,
  isMapUnlocked,
  isHardUnlocked,
  starsFor,
  serialize,
  deserialize,
};

export default logic;
