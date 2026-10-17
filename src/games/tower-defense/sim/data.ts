/**
 * Immune Front — static data tables (docs/briefs/tower-defense-spec.md is authoritative; § refs point there).
 * Pure data, no logic. Everything here is frozen-by-convention: never mutate at runtime.
 */
import type {
  AbilityDef,
  AbilityId,
  BossId,
  BossSkillDef,
  Difficulty,
  DifficultyDef,
  EnemyDef,
  EnemyId,
  HeroLevelDef,
  MapDef,
  MapId,
  TalentDef,
  TalentId,
  TowerDef,
  TowerId,
} from '../types';

// ── Fixed rule constants ────────────────────────────────────────────────────

/**
 * Wave HP growth g(w) (§ conventions): HP_GROWTH^(w−1) up to wave 20, then g(20) · ENDLESS_GROWTH^(w−20).
 * Bot pass (spec §15.1): 1.15 left every mixed build with ~4× headroom at wave 19 and let single types clear;
 * 1.22 makes waves 10–19 the economy check while waves 1–3 change by < 15 %.
 */
export const HP_GROWTH = 1.22;
/** Endless per-wave growth on top of g(20); endless also adds enemies (+k), armor (+k) and speed (§8.5). */
export const ENDLESS_GROWTH = 1.06;

/** Tower slows (pyrogen auras, allergy storm) are capped at this fraction (§5.2). Fever is a separate layer. */
export const SLOW_CAP = 0.65;
export const SELL_RATIO = 0.7;
/** Pyrogen slow lingers this long after the enemy leaves the aura (§2.4). */
export const AURA_LINGER = 0.4;
/** A ground enemy stops this far before a barrier's cell centre (§2.8). */
export const BARRIER_STOP = 0.45;
/** Barrier regen resumes this long after the last damage (§2.8). */
export const BARRIER_REGEN_DELAY = 3;
/** Boss pause after smashing a barrier (§2.8). */
export const BOSS_SMASH_PAUSE = 1;
/** Mark rules (§5.5). */
export const MARK_MAX_STACKS = 3;
export const MARK_DURATION = 4;
export const MARK_STACK_BONUS = 0.1;
export const STRONG_MARK_BONUS = 0.35;
export const STRONG_MARK_DURATION = 7;
/** Armor floor: a hit always deals at least this fraction of its raw damage (§5.1). */
export const ARMOR_FLOOR = 0.2;
export const VACCINE_MULT = 1.25;
/** Hero (§6). */
export const HERO_SPEED = 2.6;
export const HERO_CONTACT = 0.5;
export const HERO_ATTACK_TAKEN = 0.25;
export const HERO_REGEN = 0.08;
export const HERO_REGEN_DELAY = 3;
export const HERO_XP_NEAR = 2.5;
/** Spawn spacing rule (§7.2). */
export const SPAWN_SPACING = 0.35;
export const GROUP_PAUSE = 1.5;
export const BOSS_STAGGER = 6;
/** Villi range bonus (§1.3). */
export const VILLI_BONUS = 1;
export const VILLI_BONUS_LONG = 0.5;
export const VILLI_LONG_RANGE = 3.5;
/** Mutation immunity (§3.1). */
export const MUTATION_REF_DURATION = 4;
/** Max simultaneous burn instances per enemy (§5.6). */
export const MAX_BURNS = 3;

// ── Maps (§1) ───────────────────────────────────────────────────────────────

const VESSEL: MapDef = {
  id: 'vessel',
  cols: 9,
  rows: 13,
  paths: [
    {
      id: 'A',
      waypoints: [
        [0, 1],
        [7, 1],
        [7, 4],
        [1, 4],
        [1, 7],
        [7, 7],
        [7, 10],
        [4, 10],
        [4, 12],
      ],
      flow: [1, 1, -1, 1, 1, 1, -1, 1],
    },
  ],
  pads: [
    [3, 0],
    [1, 2],
    [3, 2],
    [5, 2],
    [2, 3],
    [4, 3],
    [6, 3],
    [3, 5],
    [5, 5],
    [7, 5],
    [2, 6],
    [4, 6],
    [6, 6],
    [1, 8],
    [3, 8],
    [5, 8],
    [2, 9],
    [4, 9],
    [6, 9],
    [1, 11],
    [3, 11],
    [5, 11],
    [7, 11],
    [2, 12],
    [6, 12],
  ],
  villi: [],
  core: [[4, 12]],
  hpMult: 1,
  unlockStars: 0,
  maxBarriers: 3,
  barrierBan: 3,
};

const ALVEOLI_TAIL: [number, number][] = [
  [4, 4],
  [4, 6],
  [8, 6],
  [8, 9],
  [1, 9],
  [1, 12],
  [5, 12],
  [5, 13],
];

const ALVEOLI: MapDef = {
  id: 'alveoli',
  cols: 10,
  rows: 14,
  paths: [
    {
      id: 'A',
      waypoints: [[0, 1], [2, 1], [2, 4], ...ALVEOLI_TAIL],
      flow: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
    {
      id: 'B',
      waypoints: [[9, 1], [7, 1], [7, 4], ...ALVEOLI_TAIL],
      flow: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
  ],
  pads: [
    [1, 2],
    [4, 2],
    [8, 2],
    [1, 3],
    [3, 3],
    [5, 3],
    [6, 3],
    [8, 3],
    [2, 5],
    [6, 5],
    [8, 5],
    [1, 6],
    [3, 6],
    [4, 7],
    [6, 7],
    [1, 8],
    [3, 8],
    [5, 8],
    [7, 8],
    [2, 10],
    [4, 10],
    [6, 10],
    [8, 10],
    [3, 11],
    [5, 11],
    [7, 11],
    [4, 13],
    [6, 13],
  ],
  villi: [],
  core: [[5, 13]],
  hpMult: 0.9,
  unlockStars: 0,
  maxBarriers: 3,
  barrierBan: 3,
  breathing: { period: 12, reverseFor: 3, warnFor: 1, push: 1, interrupt: 1 },
};

const GUT: MapDef = {
  id: 'gut',
  cols: 10,
  rows: 15,
  paths: [
    {
      id: 'A',
      waypoints: [
        [0, 1],
        [8, 1],
        [8, 4],
        [1, 4],
        [1, 7],
        [8, 7],
        [8, 10],
        [1, 10],
        [1, 13],
        [5, 13],
        [5, 14],
      ],
      flow: [1, 0, -1, 0, 1, 0, -1, 0, 1, 1],
    },
  ],
  pads: [
    [2, 0],
    [6, 0],
    [1, 2],
    [5, 2],
    [3, 3],
    [7, 3],
    [2, 5],
    [6, 5],
    [4, 6],
    [8, 6],
    [1, 8],
    [5, 8],
    [3, 9],
    [7, 9],
    [2, 11],
    [6, 11],
    [4, 12],
    [8, 12],
    [7, 13],
    [3, 14],
    [7, 14],
  ],
  villi: [
    [9, 2],
    [9, 3],
    [0, 5],
    [0, 6],
    [9, 8],
    [9, 9],
    [0, 11],
    [0, 12],
  ],
  core: [[5, 14]],
  hpMult: 1,
  unlockStars: 0,
  maxBarriers: 3,
  barrierBan: 3,
};

const BRAIN_FLOW: (1 | -1)[] = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1];

const BRAIN: MapDef = {
  id: 'brain',
  cols: 10,
  rows: 15,
  paths: [
    {
      id: 'L',
      waypoints: [
        [1, 0],
        [1, 2],
        [3, 2],
        [3, 5],
        [1, 5],
        [1, 8],
        [3, 8],
        [3, 11],
        [1, 11],
        [1, 13],
        [4, 13],
        [4, 14],
      ],
      flow: BRAIN_FLOW,
    },
    {
      id: 'R',
      waypoints: [
        [8, 0],
        [8, 2],
        [6, 2],
        [6, 5],
        [8, 5],
        [8, 8],
        [6, 8],
        [6, 11],
        [8, 11],
        [8, 13],
        [5, 13],
        [5, 14],
      ],
      flow: BRAIN_FLOW,
    },
  ],
  pads: [
    [4, 0],
    [5, 0],
    [0, 1],
    [9, 1],
    [3, 1],
    [6, 1],
    [4, 2],
    [5, 2],
    [1, 3],
    [8, 3],
    [2, 4],
    [7, 4],
    [4, 4],
    [5, 4],
    [3, 6],
    [6, 6],
    [2, 7],
    [7, 7],
    [4, 8],
    [5, 8],
    [1, 9],
    [8, 9],
    [2, 10],
    [7, 10],
    [4, 10],
    [5, 10],
    [3, 12],
    [6, 12],
    [0, 13],
    [9, 13],
    [2, 14],
    [7, 14],
  ],
  villi: [],
  core: [
    [4, 14],
    [5, 14],
  ],
  hpMult: 0.8,
  unlockStars: 6,
  maxBarriers: 3,
  barrierBan: 3,
};

export const MAPS: readonly MapDef[] = [VESSEL, ALVEOLI, GUT, BRAIN];

/**
 * Extra HP multiplier for bosses per map (on top of `hpMult`). Brain's bosses walk one of two paths that never
 * merge, so they face about half the defense; without this the w10 Giant Parasite was a wall there (§1.4, §15.1).
 */
export const BOSS_HP_MULT: Readonly<Record<MapId, number>> = { vessel: 1, alveoli: 1, gut: 1, brain: 0.7 };

// ── Towers (§2) ─────────────────────────────────────────────────────────────

export const TOWERS: Readonly<Record<TowerId, TowerDef>> = {
  antibody: {
    id: 'antibody',
    levels: [
      { cost: 60, dmg: 7, rate: 2.5, range: 2.6, mark: 'stack' },
      { cost: 45, dmg: 11, rate: 2.8, range: 2.8, mark: 'stack' },
      { cost: 80, dmg: 16, rate: 3.1, range: 3.0, mark: 'stack' },
    ],
    specs: {
      polyvalent: { cost: 80, dmg: 10, rate: 3.1, range: 3.0, mark: 'stack', splitTargets: 2, splitRadius: 1.5 },
      neutralizing: { cost: 80, dmg: 18, rate: 3.1, range: 3.0, mark: 'strong' },
    },
    hitsFlying: true,
    projectileSpeed: 10,
    attack: 'projectile',
    onPath: false,
    canBeInfected: true,
    defaultTargeting: 'first',
    hasTargeting: true,
    vsMarked: 1,
    vsBoss: 1,
    vsSpawned: 1,
    vsRegen: 1,
    multCap: 4,
  },
  macrophage: {
    id: 'macrophage',
    levels: [
      { cost: 80, dmg: 22, rate: 0.9, range: 1.6, engulfCooldown: 7, engulfThreshold: 55, digestTime: 2.5 },
      { cost: 60, dmg: 34, rate: 1.0, range: 1.7, engulfCooldown: 6, engulfThreshold: 80, digestTime: 2.5 },
      { cost: 100, dmg: 50, rate: 1.1, range: 1.8, engulfCooldown: 5, engulfThreshold: 110, digestTime: 2.5 },
    ],
    specs: {
      fastDigestion: { cost: 100, dmg: 50, rate: 1.2, range: 1.8, engulfCooldown: 3, engulfThreshold: 150, digestTime: 1.0 },
      enzymes: {
        cost: 100,
        dmg: 55,
        rate: 1.1,
        range: 1.8,
        engulfCooldown: 5,
        engulfThreshold: 110,
        digestTime: 2.5,
        splash: 1.2,
        acidSplashFrac: 0.35,
        acidPoolFrac: 0.1,
        acidPoolRadius: 1.0,
        acidPoolDuration: 3,
        ignoresArmor: false,
      },
    },
    hitsFlying: false,
    projectileSpeed: 0,
    attack: 'melee',
    onPath: false,
    canBeInfected: true,
    defaultTargeting: 'marked',
    hasTargeting: true,
    vsMarked: 1,
    vsBoss: 1,
    vsSpawned: 1,
    vsRegen: 1,
    multCap: 4,
  },
  mast: {
    id: 'mast',
    levels: [
      { cost: 100, dmg: 40, rate: 0.6, range: 2.2, splash: 1.1 },
      { cost: 80, dmg: 65, rate: 0.65, range: 2.4, splash: 1.3 },
      { cost: 130, dmg: 100, rate: 0.7, range: 2.6, splash: 1.5 },
    ],
    specs: {
      allergyStorm: { cost: 130, dmg: 100, rate: 0.7, range: 2.6, splash: 1.9, slow: 0.2, slowDuration: 1.5 },
      histamineBurn: { cost: 130, dmg: 80, rate: 0.7, range: 2.6, splash: 1.5, dotDps: 16, dotDuration: 4 },
    },
    hitsFlying: false,
    projectileSpeed: 6,
    attack: 'projectile',
    onPath: false,
    canBeInfected: true,
    defaultTargeting: 'first',
    hasTargeting: true,
    vsMarked: 1,
    vsBoss: 1,
    vsSpawned: 1,
    vsRegen: 1,
    multCap: 4,
  },
  pyrogen: {
    id: 'pyrogen',
    levels: [
      { cost: 75, dmg: 0, rate: 0, range: 1.9, slow: 0.25, auraDps: 4 },
      { cost: 55, dmg: 0, rate: 0, range: 2.1, slow: 0.32, auraDps: 7 },
      { cost: 95, dmg: 0, rate: 0, range: 2.3, slow: 0.4, auraDps: 11 },
    ],
    specs: {
      highFever: { cost: 95, dmg: 0, rate: 0, range: 2.3, slow: 0.55, auraDps: 14 },
      lowFever: { cost: 95, dmg: 0, rate: 0, range: 3.2, slow: 0.3, auraDps: 9, stun: 0.5 },
    },
    hitsFlying: false,
    projectileSpeed: 0,
    attack: 'aura',
    onPath: false,
    canBeInfected: true,
    defaultTargeting: 'first',
    hasTargeting: false,
    vsMarked: 1,
    vsBoss: 1,
    vsSpawned: 1,
    vsRegen: 1,
    multCap: 4,
  },
  tcell: {
    id: 'tcell',
    levels: [
      { cost: 160, dmg: 70, rate: 0.5, range: 4.0 },
      { cost: 120, dmg: 120, rate: 0.55, range: 4.4 },
      { cost: 190, dmg: 200, rate: 0.6, range: 4.8 },
    ],
    specs: {
      perforin: { cost: 190, dmg: 230, rate: 0.6, range: 4.8, ignoresArmor: true },
      apoptosis: { cost: 190, dmg: 200, rate: 0.6, range: 4.8, executeBelow: 0.15 },
    },
    hitsFlying: true,
    projectileSpeed: 0,
    attack: 'tracer',
    onPath: false,
    canBeInfected: true,
    defaultTargeting: 'strongest',
    hasTargeting: true,
    vsMarked: 1.5,
    vsBoss: 1.5,
    vsSpawned: 2,
    vsRegen: 1,
    multCap: 4,
  },
  complement: {
    id: 'complement',
    levels: [
      { cost: 140, dmg: 20, rate: 1.0, range: 2.4, chainTargets: 3, chainJump: 1.3, chainJumpMarked: 2.4, chainFalloff: 0.25 },
      { cost: 100, dmg: 30, rate: 1.1, range: 2.6, chainTargets: 4, chainJump: 1.3, chainJumpMarked: 2.4, chainFalloff: 0.25 },
      { cost: 165, dmg: 44, rate: 1.2, range: 2.8, chainTargets: 4, chainJump: 1.3, chainJumpMarked: 2.4, chainFalloff: 0.25 },
    ],
    specs: {
      longChain: { cost: 165, dmg: 44, rate: 1.2, range: 2.8, chainTargets: 6, chainJump: 1.8, chainJumpMarked: 3.0, chainFalloff: 0.15 },
      membraneAttack: {
        cost: 165,
        dmg: 44,
        rate: 1.2,
        range: 2.8,
        chainTargets: 4,
        chainJump: 1.3,
        chainJumpMarked: 2.4,
        chainFalloff: 0.25,
        suppress: 6,
      },
    },
    hitsFlying: true,
    projectileSpeed: 0,
    attack: 'chain',
    onPath: false,
    canBeInfected: true,
    defaultTargeting: 'first',
    hasTargeting: true,
    vsMarked: 1,
    vsBoss: 1,
    vsSpawned: 1,
    vsRegen: 1.6,
    multCap: 4,
  },
  beacon: {
    id: 'beacon',
    levels: [
      { cost: 90, dmg: 0, rate: 0, range: 2.0, buffRate: 0.1, buffDmg: 0, cureEvery: 2.0, reveal: 2.5 },
      { cost: 65, dmg: 0, rate: 0, range: 2.3, buffRate: 0.18, buffDmg: 0, cureEvery: 1.5, reveal: 3.0 },
      { cost: 110, dmg: 0, rate: 0, range: 2.6, buffRate: 0.25, buffDmg: 0.1, cureEvery: 1.0, reveal: 3.5 },
    ],
    specs: {
      alarm: { cost: 110, dmg: 0, rate: 0, range: 2.6, buffRate: 0.12, buffDmg: 0, cureEvery: 1.0, reveal: 3.5, globalRate: 0.08, globalDmg: 0.08 },
      potentiate: { cost: 110, dmg: 0, rate: 0, range: 2.6, buffRate: 0.4, buffDmg: 0.2, buffRange: 0.5, cureEvery: 1.0, reveal: 4.0 },
    },
    hitsFlying: false,
    projectileSpeed: 0,
    attack: 'support',
    onPath: false,
    canBeInfected: false,
    defaultTargeting: 'first',
    hasTargeting: false,
    vsMarked: 1,
    vsBoss: 1,
    vsSpawned: 1,
    vsRegen: 1,
    multCap: 4,
  },
  barrier: {
    id: 'barrier',
    levels: [
      { cost: 25, dmg: 0, rate: 0, range: 0, hp: 400, regen: 6 },
      { cost: 25, dmg: 0, rate: 0, range: 0, hp: 800, regen: 10 },
      { cost: 40, dmg: 0, rate: 0, range: 0, hp: 1300, regen: 15 },
    ],
    specs: {
      fibrin: { cost: 40, dmg: 0, rate: 0, range: 0, hp: 2200, regen: 22 },
      clotSpikes: { cost: 40, dmg: 0, rate: 0, range: 0, hp: 1300, regen: 15, reflectFrac: 0.04, contactFrac: 0.02, contactRadius: 0.6, ignoresArmor: true },
    },
    hitsFlying: false,
    projectileSpeed: 0,
    attack: 'barrier',
    onPath: true,
    canBeInfected: false,
    defaultTargeting: 'first',
    hasTargeting: false,
    vsMarked: 1,
    vsBoss: 1,
    vsSpawned: 1,
    vsRegen: 1,
    multCap: 4,
  },
};

/** Mast lobbed projectile arc peak (cells), §2.3. */
export const MAST_ARC = 1.2;
/** Membrane Attack's multiplier vs regen / shield enemies (replaces vsRegen 1.6), §2.6. */
export const MEMBRANE_VS_REGEN = 2.2;
/** Apoptosis hit multiplier vs a boss below the execute threshold, §2.5. */
export const APOPTOSIS_BOSS_MULT = 1.5;
/** Clot Spikes contact damage vs bosses (×0.25), §2.8. */
export const CLOT_BOSS_MULT = 0.25;

// ── Enemies (§3) ────────────────────────────────────────────────────────────

const base = {
  flying: false,
  stealth: false,
  boss: false,
  regen: 0,
  slowResist: 0,
  canBeEngulfed: true,
};

export const ENEMIES: Readonly<Record<EnemyId, EnemyDef>> = {
  bacterium: { ...base, id: 'bacterium', family: 'bacteria', hp: 40, speed: 1.3, armor: 0, reward: 5, vit: 1, attack: 8, radius: 0.22, gap: 0.8 },
  flagellate: { ...base, id: 'flagellate', family: 'bacteria', hp: 24, speed: 2.4, armor: 0, reward: 4, vit: 1, attack: 6, radius: 0.18, gap: 0.5 },
  encapsulated: { ...base, id: 'encapsulated', family: 'bacteria', hp: 90, speed: 1.0, armor: 4, reward: 8, vit: 1, attack: 10, radius: 0.26, gap: 1.2 },
  virus: { ...base, id: 'virus', family: 'viral', hp: 35, speed: 1.6, armor: 0, reward: 6, vit: 1, attack: 5, radius: 0.2, gap: 0.8, infectDuration: 8 },
  spore: {
    ...base,
    id: 'spore',
    family: 'bacteria',
    hp: 50,
    speed: 1.2,
    armor: 0,
    reward: 6,
    vit: 1,
    attack: 4,
    radius: 0.22,
    gap: 1.0,
    splitInto: { type: 'sporeling', count: 3, spread: 0.2 },
  },
  sporeling: { ...base, id: 'sporeling', family: 'bacteria', hp: 12, speed: 1.9, armor: 0, reward: 1, vit: 1, attack: 3, radius: 0.13, gap: 0.5 },
  parasite: {
    ...base,
    id: 'parasite',
    family: 'parasitic',
    hp: 320,
    speed: 0.75,
    armor: 2,
    reward: 18,
    vit: 2,
    attack: 25,
    radius: 0.3,
    gap: 2.0,
    segments: 5,
    segmentSpacing: 0.45,
    splashZones: 1,
    slowResist: 0.25,
    canBeEngulfed: false,
  },
  biofilm: {
    ...base,
    id: 'biofilm',
    family: 'bacteria',
    hp: 110,
    speed: 0.9,
    armor: 0,
    reward: 10,
    vit: 1,
    attack: 12,
    radius: 0.26,
    gap: 1.2,
    regen: 0.03,
    healRadius: 1.2,
    healRate: 0.02,
  },
  prion: { ...base, id: 'prion', family: 'viral', hp: 60, speed: 1.4, armor: 3, reward: 9, vit: 1, attack: 10, radius: 0.2, gap: 0.9, stealth: true },
  toxin: {
    ...base,
    id: 'toxin',
    family: 'other',
    hp: 45,
    speed: 1.5,
    armor: 0,
    reward: 7,
    vit: 2,
    attack: 0,
    radius: 0.24,
    gap: 0.7,
    flying: true,
    canBeEngulfed: false,
  },
  mutant: {
    ...base,
    id: 'mutant',
    family: 'other',
    hp: 400,
    speed: 0.7,
    armor: 4,
    reward: 60,
    vit: 3,
    attack: 30,
    radius: 0.34,
    gap: 3.0,
    regen: 0.01,
    slowResist: 0.25,
    canBeEngulfed: false,
    divide: { below: 0.5, hpFraction: 0.55, speed: 0.9, radius: 0.26, reward: 25, vit: 2, spread: 0.25 },
  },
  superbug: {
    ...base,
    id: 'superbug',
    family: 'bacteria',
    hp: 600,
    speed: 0.55,
    armor: 8,
    reward: 150,
    vit: 5,
    attack: 60,
    radius: 0.45,
    gap: 0,
    boss: true,
    regen: 0.01,
    slowResist: 0.5,
    canBeEngulfed: false,
    dmgTaken: { tracer: 0.5, chain: 1.5 },
  },
  giantParasite: {
    ...base,
    id: 'giantParasite',
    family: 'parasitic',
    hp: 1500,
    speed: 0.7,
    armor: 4,
    reward: 200,
    vit: 8,
    attack: 120,
    radius: 0.5,
    gap: 0,
    boss: true,
    segments: 8,
    segmentSpacing: 0.5,
    splashZones: 4,
    slowResist: 0.5,
    canBeEngulfed: false,
  },
  virusKing: {
    ...base,
    id: 'virusKing',
    family: 'viral',
    hp: 1200,
    speed: 0.6,
    armor: 6,
    reward: 300,
    vit: 10,
    attack: 80,
    radius: 0.5,
    gap: 0,
    boss: true,
    slowResist: 0.6,
    canBeEngulfed: false,
    infectDuration: 10,
  },
};

/** Vaccine coverage (§4): which enemy types the vaccine of each boss applies to. */
export const VACCINE_COVERS: Readonly<Record<BossId, readonly EnemyId[]>> = {
  superbug: ['superbug', 'spore', 'sporeling'],
  giantParasite: ['giantParasite', 'parasite'],
  virusKing: ['virusKing', 'virus'],
};

// ── Boss skills (§3.1) ──────────────────────────────────────────────────────

export const BOSS_SKILLS: Readonly<Record<BossId, readonly BossSkillDef[]>> = {
  superbug: [
    /** amount = spores at wave ≤ 10; 3 for waves 11–20, 4 in endless (see sporulationCount). */
    { id: 'sporulation', firstAt: 8, every: 12, telegraph: 1.0, amount: 2 },
    { id: 'shellHardening', thresholds: [0.5], telegraph: 1.0, duration: 8 },
  ],
  giantParasite: [
    /** amount = speed multiplier while charging. */
    { id: 'charge', firstAt: 8, every: 12, telegraph: 1.5, duration: 2.0, amount: 3 },
    /** amount = cells it re-emerges ahead (hard: HARD_BURROW_DISTANCE). */
    { id: 'burrow', thresholds: [0.6, 0.3], telegraph: 0.5, duration: 3, amount: 3 },
  ],
  virusKing: [
    /** amount = infection radius (cells); duration = infection seconds. */
    { id: 'massInfection', firstAt: 5, every: 15, telegraph: 1.0, duration: 10, amount: 3 },
    { id: 'mutation', firstAt: 8, every: 12, telegraph: 0.5, duration: 4, durationMin: 2, durationMax: 8, shareRef: 0.5 },
    /** amount = viruses spawned per threshold. */
    { id: 'shedding', thresholds: [0.7, 0.4, 0.15], telegraph: 0, amount: 2 },
  ],
};

export const HARD_BURROW_DISTANCE = 4.5;

// ── Abilities (§6.1) ────────────────────────────────────────────────────────

export const ABILITIES: Readonly<Record<AbilityId, AbilityDef>> = {
  fever: { id: 'fever', cooldown: 30, targeted: false, duration: 6, slow: 0.6, slowBoss: 0.8 },
  antibiotic: { id: 'antibiotic', cooldown: 25, targeted: true, radius: 1.5, dmgBase: 60, delay: 0.4 },
  adrenaline: { id: 'adrenaline', cooldown: 40, targeted: false, duration: 8, rateBonus: 0.6 },
  booster: { id: 'booster', cooldown: 45, targeted: false, executeBelow: 0.3, bossPercent: 0.08 },
};

/** Antibiotic Strike family multipliers (§6.1): toxins and mutant cells (`other`) shrug it off like viruses. */
export const ANTIBIOTIC_FAMILY_MULT: Readonly<Record<string, number>> = { bacteria: 2, viral: 0.5, parasitic: 1, other: 0.5 };

// ── Talents (§10.1) ─────────────────────────────────────────────────────────

export const TALENTS: Readonly<Record<TalentId, TalentDef>> = {
  affinity: { id: 'affinity', tier: 1, cost: 1, requiresAny: [] },
  reserve: { id: 'reserve', tier: 1, cost: 1, requiresAny: [] },
  platelets: { id: 'platelets', tier: 1, cost: 1, requiresAny: [] },
  toughBlanc: { id: 'toughBlanc', tier: 1, cost: 1, requiresAny: [] },
  maturation: { id: 'maturation', tier: 2, cost: 2, requiresAny: ['affinity'] },
  metabolism: { id: 'metabolism', tier: 2, cost: 2, requiresAny: ['reserve'] },
  cytokines: { id: 'cytokines', tier: 2, cost: 2, requiresAny: ['platelets', 'toughBlanc'] },
  sharpBlanc: { id: 'sharpBlanc', tier: 2, cost: 2, requiresAny: ['toughBlanc'] },
  tissueRepair: { id: 'tissueRepair', tier: 3, cost: 4, requiresAny: ['platelets', 'metabolism'] },
  deepReserve: { id: 'deepReserve', tier: 3, cost: 4, requiresAny: ['metabolism'] },
  rapidResponse: { id: 'rapidResponse', tier: 3, cost: 4, requiresAny: ['sharpBlanc'] },
  booster: { id: 'booster', tier: 4, cost: 4, requiresAny: ['cytokines'], requiresCount: 6 },
};

// ── Difficulty (§9.1) ───────────────────────────────────────────────────────

export const DIFFICULTIES: Readonly<Record<Difficulty, DifficultyDef>> = {
  normal: {
    vitality: 20,
    startAtp: 220,
    hpMult: 1,
    speedMult: 1,
    armorBonus: 0,
    rewardMult: 1,
    bossCooldownMult: 1,
    countdown: 12,
    earlyBonusMult: 1,
  },
  hard: {
    vitality: 15,
    startAtp: 180,
    hpMult: 1.25,
    speedMult: 1.08,
    armorBonus: 1,
    rewardMult: 0.85,
    bossCooldownMult: 0.8,
    countdown: 8,
    earlyBonusMult: 1.5,
  },
};

// ── Hero (§6) ───────────────────────────────────────────────────────────────

export const HERO_LEVELS: readonly [HeroLevelDef, HeroLevelDef, HeroLevelDef] = [
  { hp: 120, dmg: 12, rate: 1.5, range: 1.2, xpToNext: 40 },
  { hp: 180, dmg: 18, rate: 1.6, range: 1.3, xpToNext: 110 },
  { hp: 260, dmg: 26, rate: 1.8, range: 1.4 },
];

// ── Wave scripts (§8) ───────────────────────────────────────────────────────

/**
 * Compact script notation, one string per wave: groups separated by ';', `+` prefix = parallel with the previous
 * group, `type*count`, optional `@A|@B|@L|@R|@alt` spawn selector. Short ids are listed in SHORT_IDS.
 */
export const SHORT_IDS: Readonly<Record<string, EnemyId>> = {
  bac: 'bacterium',
  fla: 'flagellate',
  enc: 'encapsulated',
  vir: 'virus',
  spo: 'spore',
  par: 'parasite',
  bio: 'biofilm',
  pri: 'prion',
  tox: 'toxin',
  mut: 'mutant',
  SUP: 'superbug',
  GPA: 'giantParasite',
  VKG: 'virusKing',
};

export const WAVE_SCRIPTS: Readonly<Record<MapId, readonly string[]>> = {
  vessel: [
    'bac*8',
    'bac*10; fla*6',
    'enc*3; bac*6; enc*2',
    'vir*6; bac*10; +fla*4',
    'SUP; bac*6',
    'spo*5; bac*8; +fla*4',
    'fla*10; enc*4; vir*6',
    'par*2; bac*8',
    'tox*8; bac*10; enc*3',
    'GPA; fla*8',
    'bio*4; enc*4; bac*10',
    'pri*8; vir*8; +bac*8',
    'mut*1; bac*10; fla*8',
    'spo*8; +tox*6; enc*4',
    'SUP; +bio*4; vir*8',
    'par*3; +enc*5; fla*10',
    'tox*10; +pri*6; bac*12; mut*1',
    'bio*6; +vir*10; par*3; enc*4',
    'bac*20; +fla*12; enc*6; +spo*4; par*2',
    'VKG; +vir*12; pri*4; +tox*4; mut*1',
  ],
  alveoli: [
    'bac*6@A; bac*6@B',
    'fla*8; bac*8',
    'enc*3@A; +bac*8@B',
    'vir*8; spo*3',
    'SUP@A; +bac*8@B',
    'tox*6; fla*8; +bac*8',
    'par*2; bac*6',
    'bio*4; enc*6',
    'pri*4@A; +vir*8@B',
    'GPA@B; +fla*10@A',
    'spo*8; +tox*8',
    'mut*1@A; bac*12@B; fla*8',
    'enc*8; +vir*10; bac*8',
    'par*3; bio*4; +tox*8',
    'SUP@B; +pri*6@A; vir*8',
    'fla*16; +spo*8; enc*4',
    'mut*1; +enc*8; bac*10',
    'tox*14; pri*8; par*3',
    'bio*8; +par*3; bac*12; +fla*10',
    'VKG@A; +vir*14@B; mut*1@B; +tox*6',
  ],
  gut: [
    'bac*10',
    'bac*8; bio*1',
    'fla*10; enc*3',
    'bio*4; +vir*6',
    'SUP; bio*3',
    'spo*6; bio*3',
    'par*2; +bio*2; bac*5',
    'tox*8; enc*5',
    'bio*6; +fla*12',
    'GPA; +bio*4',
    'pri*6; +bio*4; vir*8',
    'mut*1; bio*5',
    'enc*6; +bio*4; spo*6',
    'tox*10; +par*3',
    'SUP; +bio*6; enc*6',
    'bio*10; +fla*16',
    'mut*1; +pri*8; bio*6',
    'par*4; +bio*6; tox*8',
    'bac*20; +bio*8; enc*8; +spo*6',
    'VKG; +bio*8; vir*12; +mut*1',
  ],
  brain: [
    'bac*6@L; bac*6@R',
    'pri*4; bac*8',
    'fla*8; +enc*4',
    'vir*8; +pri*4',
    'SUP@L; +pri*6@R',
    'tox*8; pri*6; +bac*4',
    'par*2; +bac*8',
    'bio*4; +pri*8',
    'spo*8; +vir*8',
    'GPA@R; +pri*8@L',
    'mut*1; +enc*8',
    'pri*12; +tox*8; bac*8',
    'par*3; +bio*6',
    'fla*18; +pri*8',
    'SUP@R; +vir*12@L; pri*6',
    'mut*1; +tox*10; pri*6',
    'enc*8; +pri*8; spo*6',
    'par*3; +bio*6; pri*8',
    'bac*20; +fla*14; pri*12; +mut*1',
    'VKG@L; +pri*10@R; vir*12; +tox*8',
  ],
};

/** Endless filler rotation (§8.5): [main, second, third, special], each indexed by (wave − 21) mod 4. */
export const ENDLESS_ROTATION: Readonly<Record<MapId, readonly [readonly string[], readonly string[], readonly string[], readonly string[]]>> = {
  vessel: [
    ['bac', 'fla', 'enc', 'vir'],
    ['enc', 'spo', 'bio', 'tox'],
    ['fla', 'vir', 'pri', 'spo'],
    ['par', 'mut', 'tox', 'bio'],
  ],
  alveoli: [
    ['bac', 'fla', 'vir', 'enc'],
    ['tox', 'spo', 'enc', 'bio'],
    ['fla', 'tox', 'vir', 'pri'],
    ['par', 'mut', 'bio', 'par'],
  ],
  gut: [
    ['bio', 'bac', 'enc', 'bio'],
    ['bio', 'spo', 'fla', 'enc'],
    ['vir', 'bio', 'tox', 'pri'],
    ['par', 'mut', 'par', 'bio'],
  ],
  brain: [
    ['pri', 'bac', 'vir', 'fla'],
    ['pri', 'enc', 'tox', 'spo'],
    ['vir', 'pri', 'bio', 'fla'],
    ['mut', 'par', 'pri', 'mut'],
  ],
};

export const ENDLESS_BOSS_CYCLE: readonly BossId[] = ['superbug', 'giantParasite', 'virusKing'];
