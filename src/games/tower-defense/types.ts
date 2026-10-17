/**
 * Immune Front (免疫防线) — shared contracts between logic.ts (pure simulation), the Three.js renderer and the DOM UI.
 *
 * This file holds ONLY types, interfaces and constant id/number lists (no runtime logic) so every module can import
 * it without pulling in anything else (the one import below is type-only). Numbers live in
 * docs/briefs/tower-defense-spec.md; section references (§x.y) point there.
 *
 * Units: grid cells (cell (c, r) is centred at (c + 0.5, r + 0.5); x = column axis, y = row axis, origin at the
 * grid's top-left corner, row 0 is the far edge from the camera, the core sits on the near edge), seconds of
 * simulation time. Heights `h` are cells above the floor. Every timer is an absolute `state.time` value (`until`,
 * `readyAt`, `nextAt`), never a countdown, except `GameState.countdown` (the between-wave timer shown in the HUD).
 *
 * World mapping (§11.8): the renderer maps a logic point (x, y, h) to three.js (x, h, y) — see `WORLD`. The logic
 * never uses the letter z; `ProjectileViewBuffer.h` is the lobbed-arc height.
 */

import type { Lang, ThemeName } from '../../app/types';

// ── Ids ─────────────────────────────────────────────────────────────────────

export type MapId = 'vessel' | 'alveoli' | 'gut' | 'brain';
export type Difficulty = 'normal' | 'hard';
export type GameSpeed = 1 | 2;
/** Start-screen preference; the renderer only ever receives the resolved `RenderQuality`. */
export type Quality = 'auto' | 'high' | 'low';
export type RenderQuality = 'high' | 'low';

export type TowerId = 'antibody' | 'macrophage' | 'mast' | 'pyrogen' | 'tcell' | 'complement' | 'beacon' | 'barrier';

/** Level-3 specializations, two per tower (§2). */
export type SpecId =
  | 'polyvalent'
  | 'neutralizing'
  | 'fastDigestion'
  | 'enzymes'
  | 'allergyStorm'
  | 'histamineBurn'
  | 'highFever'
  | 'lowFever'
  | 'perforin'
  | 'apoptosis'
  | 'longChain'
  | 'membraneAttack'
  | 'alarm'
  | 'potentiate'
  | 'fibrin'
  | 'clotSpikes';

export type TowerLevel = 1 | 2 | 3;

/** How a tower delivers damage; also the key of `EnemyDef.dmgTaken` (Superbug capsule, §3.1). */
export type AttackKind = 'projectile' | 'melee' | 'aura' | 'chain' | 'tracer' | 'support' | 'barrier';

export type EnemyId =
  | 'bacterium'
  | 'flagellate'
  | 'encapsulated'
  | 'virus'
  | 'spore'
  | 'sporeling'
  | 'parasite'
  | 'biofilm'
  | 'prion'
  | 'toxin'
  | 'mutant'
  | 'superbug'
  | 'giantParasite'
  | 'virusKing';

export type BossId = 'superbug' | 'giantParasite' | 'virusKing';

/** Realism multipliers (Antibiotic Strike ×2 vs bacteria, ×0.5 vs viral) and vaccine coverage use families (§3). */
export type EnemyFamily = 'bacteria' | 'viral' | 'parasitic' | 'other';

export type BossSkillId = 'sporulation' | 'shellHardening' | 'charge' | 'burrow' | 'massInfection' | 'mutation' | 'shedding';

export type AbilityId = 'fever' | 'antibiotic' | 'adrenaline' | 'booster';

export type TalentId =
  | 'affinity'
  | 'reserve'
  | 'platelets'
  | 'toughBlanc'
  | 'maturation'
  | 'metabolism'
  | 'cytokines'
  | 'sharpBlanc'
  | 'tissueRepair'
  | 'deepReserve'
  | 'rapidResponse'
  | 'booster';

export type Targeting = 'first' | 'strongest' | 'marked';

/**
 * build: before wave 1 / after loading a save (unlimited time) · wave: enemies spawning or alive · countdown: next
 * wave auto-starts when the timer ends · cleared: wave 20 beaten, waiting for "continue endless" · over: vitality 0.
 */
export type Phase = 'build' | 'wave' | 'countdown' | 'cleared' | 'over';

/** 1 = blood flows with enemy travel (+30 % speed), -1 = against (−20 %), 0 = still. */
export type FlowDir = 1 | 0 | -1;

/** Spawn selector for two-spawn maps; single-path maps ignore it. 'alt' alternates per enemy starting with A/L. */
export type SpawnSel = 'A' | 'B' | 'alt';

export type TutorialId = 'tut_build' | 'tut_infect' | 'tut_barrier' | 'tut_boss' | 'tut_mutation';

/**
 * UI-owned input mode (§11.2). 'heroMove': the next map tap sends the hero. 'abilityTarget': drag-to-aim for the
 * Antibiotic Strike; pan/zoom are disabled. The UI copies it into `RenderSnapshot.interaction` every frame.
 */
export type InteractionMode = 'none' | 'heroMove' | 'abilityTarget';

// ── Ordered id lists (UI iteration order; data, not logic) ───────────────────

export const MAP_IDS: readonly MapId[] = ['vessel', 'alveoli', 'gut', 'brain'];
export const TOWER_IDS: readonly TowerId[] = ['antibody', 'macrophage', 'mast', 'pyrogen', 'tcell', 'complement', 'beacon', 'barrier'];
export const ENEMY_IDS: readonly EnemyId[] = [
  'bacterium',
  'flagellate',
  'encapsulated',
  'virus',
  'spore',
  'sporeling',
  'parasite',
  'biofilm',
  'prion',
  'toxin',
  'mutant',
  'superbug',
  'giantParasite',
  'virusKing',
];
export const BOSS_IDS: readonly BossId[] = ['superbug', 'giantParasite', 'virusKing'];
export const ABILITY_IDS: readonly AbilityId[] = ['fever', 'antibiotic', 'adrenaline', 'booster'];
export const TALENT_IDS: readonly TalentId[] = [
  'affinity',
  'reserve',
  'platelets',
  'toughBlanc',
  'maturation',
  'metabolism',
  'cytokines',
  'sharpBlanc',
  'tissueRepair',
  'deepReserve',
  'rapidResponse',
  'booster',
];
/** Spec A / spec B per tower, in the order the two L3 cards are shown. */
export const TOWER_SPECS: Readonly<Record<TowerId, readonly [SpecId, SpecId]>> = {
  antibody: ['polyvalent', 'neutralizing'],
  macrophage: ['fastDigestion', 'enzymes'],
  mast: ['allergyStorm', 'histamineBurn'],
  pyrogen: ['highFever', 'lowFever'],
  tcell: ['perforin', 'apoptosis'],
  complement: ['longChain', 'membraneAttack'],
  beacon: ['alarm', 'potentiate'],
  barrier: ['fibrin', 'clotSpikes'],
};
export const TARGETING_MODES: readonly Targeting[] = ['first', 'strongest', 'marked'];

// ── Versions and fixed constants ─────────────────────────────────────────────

/**
 * Schema version of the persistent `memory` blob (§12.2). `parseMemory` accepts any `v ≤ MEMORY_VERSION` and
 * migrates it; it discards the blob only when `v` is missing, non-numeric or newer than this build.
 */
export const MEMORY_VERSION = 2;
/** Schema version of the mid-run `run` save (§12.1). Strict: any other `v` is discarded (a run is cheap to lose). */
export const RUN_VERSION = 2;
export const WAVES_PER_MAP = 20;
/** Fixed simulation step (s); the UI accumulates frame time and runs ≤ MAX_STEPS_PER_FRAME steps (§7.10). */
export const SIM_STEP = 1 / 60;
export const MAX_STEPS_PER_FRAME = 8;
/** Frame rate while nothing moves (build / countdown with no enemies and no pending VFX), §11.6. */
export const IDLE_FPS = 30;
/** Preallocated snapshot capacities (§11.5). Entities beyond a capacity are simulated but not drawn. */
export const SNAPSHOT_CAPACITY = { enemies: 160, segments: 1024, projectiles: 256, towers: 40 } as const;

/** Logic → three.js world mapping and the invisible pick proxies (§11.8). */
export const WORLD = {
  /** One grid cell = one world unit. */
  cellSize: 1,
  /** y of the floor plane in three.js; logic (x, y, h) → three.js (x, h, y). */
  floorY: 0,
  /** Top surface of a build pad (membrane disc) above the floor; towers and pick discs sit on it. */
  padHeight: 0.12,
  /** Depth of a vessel trench below the floor (path cells). */
  trenchDepth: 0.18,
  /** Approximate silhouette height per tower level (pick capsules, HP-bar anchors). */
  towerHeight: [0.6, 0.85, 1.1] as readonly [number, number, number],
  heroHeight: 0.5,
  /** Pick proxies: disc radius on every pad (0.7 → ≥ 40 px at the far visible row, §11.8), capsule radius per built tower, sphere around the hero (cells). */
  pickPadRadius: 0.7,
  pickTowerRadius: 0.45,
  pickHeroRadius: 0.5,
  /** A pad candidate snaps to the nearest pad centre within this distance (cells). */
  pickSnap: 0.75,
} as const;

/** Fixed oblique camera (§11.8). */
export const CAMERA = {
  /** 58° (not 55°) and a 30° FOV keep the far/near scale ratio of the visible strip at 1.40 so far pads stay tappable. */
  pitchDeg: 58,
  /** Slight yaw only: more rotates the footprint and shrinks far-row pads below the 44 px target. */
  yawDeg: 8,
  fovDeg: 30,
  /** Default framing: the row at the vertical centre of the viewport spans the width minus this margin per side; vertical pan is allowed. */
  marginCells: 0.5,
  /** Fraction of the map height (from the core edge) visible by default when the whole map does not fit (≈ 8 rows of 15). */
  defaultViewFromCore: 0.55,
  minZoom: 1,
  maxZoom: 2,
  /** Unit-test bound: the farthest pad's pick disc must be ≥ this many CSS px wide at 390 px width, zoom 1. */
  minFarPadPx: 40,
  /** Pan animation used by `centerOn` (ms). */
  panMs: 250,
} as const;

/** Rendering budget the smoke test asserts (§11.9). */
export const RENDER_BUDGET = {
  maxDrawCalls: 150,
  maxPixelRatioHigh: 2,
  /** Pixel-ratio cap on low quality (brief: "capped at 1.5, 2 on high"). */
  maxPixelRatioLow: 1.5,
  /** Last resort: auto quality drops to this pixel ratio when the probe is still under `probeMinFps` on low. */
  degradedPixelRatio: 1,
  probeSeconds: 2,
  probeMinFps: 45,
  flowParticlesHigh: 1200,
  flowParticlesLow: 500,
  chainSegments: 8,
  maxChains: 64,
  maxFloatingText: 30,
} as const;

// ── Maps (§1) ───────────────────────────────────────────────────────────────

/** [col, row] grid cell. */
export type Cell = readonly [number, number];

export interface PathDef {
  /** 'A' / 'B' (Alveoli) or 'L' / 'R' (Brain); single paths use 'A'. */
  id: string;
  /** Axis-aligned waypoints; the first lies on an outer edge (spawn), the last is a core cell. */
  waypoints: readonly Cell[];
  /** One entry per segment (`waypoints.length - 1`). Corner cells belong to the segment that enters them. */
  flow: readonly FlowDir[];
}

export interface BreathingDef {
  /** Cycle length (s). */
  period: number;
  /** Flow is reversed during [period - reverseFor, period) of each cycle. */
  reverseFor: number;
  /** `warn` is true during [period - reverseFor - warnFor, period - reverseFor). */
  warnFor: number;
  /** Cells every ground enemy is pushed back at the reversal onset (bosses: half). */
  push: number;
  /** Seconds a pushed enemy cannot resume attacking a barrier (it walks back first). */
  interrupt: number;
}

export interface MapDef {
  id: MapId;
  cols: number;
  rows: number;
  paths: readonly PathDef[];
  /** Buildable pads (towers other than the barrier). */
  pads: readonly Cell[];
  /** Pads that add range to the tower on them (Gut): +1.0, capped at +0.5 for towers whose base range ≥ 3.5 (§2). */
  villi: readonly Cell[];
  /** Core cells (1 or 2); the core centre is their average. Each path ends on one of them. */
  core: readonly Cell[];
  /** Enemy HP multiplier balancing path length. */
  hpMult: number;
  /** Total stars needed on the start screen. */
  unlockStars: number;
  /** Max living barriers. */
  maxBarriers: number;
  /** Barriers are forbidden on the first/last N cells of every path. */
  barrierBan: number;
  breathing?: BreathingDef;
}

export interface Point {
  x: number;
  y: number;
}

/** Polyline geometry of one path (v1 `pathGeometry`, extended with per-cell flow). */
export interface PathGeom {
  pathIndex: number;
  cells: readonly Cell[];
  /** Cell centres prefixed by the off-grid entry point. */
  points: readonly Point[];
  /** Cumulative distance at each point. */
  cum: readonly number[];
  length: number;
  /** Flow of the segment (between `points[i]` and `points[i+1]`), index-aligned with `points` (last entry unused). */
  segFlow: readonly FlowDir[];
}

// ── Static definitions (data tables the logic exposes; §2, §3, §6, §10) ─────

export interface TowerLevelStats {
  /** Cost to reach this level (build cost at level 1). */
  cost: number;
  dmg: number;
  /**
   * Shots / bites / chain casts per second. 0 for aura, support and barrier rows: an aura has no discrete pulses —
   * `slow` and `auraDps` are applied continuously every step (× dt), §5.9 (d).
   */
  rate: number;
  range: number;
  /** Mast: splash radius (no falloff inside). Enzymes: acid splash radius. */
  splash?: number;
  /** Pyrogen: slow fraction; allergyStorm: per-hit slow. */
  slow?: number;
  /** allergyStorm: per-hit slow duration (s). */
  slowDuration?: number;
  /** lowFever: stun seconds on first aura entry. */
  stun?: number;
  /** Pyrogen aura DPS at wave 1 (armor-ignoring); applied value = auraDps × g(wave)^0.5 (§2.4). */
  auraDps?: number;
  /** Complement: max targets, jump range, jump range between two marked enemies, damage falloff per jump (fraction). */
  chainTargets?: number;
  chainJump?: number;
  chainJumpMarked?: number;
  chainFalloff?: number;
  /** membraneAttack: regen / heal-aura suppression per hit (s). */
  suppress?: number;
  /** Macrophage engulf: cooldown (s), base HP threshold (× g(wave)), digest time (s). */
  engulfCooldown?: number;
  engulfThreshold?: number;
  digestTime?: number;
  /** Enzymes: acid splash damage as a fraction of the engulfed enemy's maxHP, pool DPS fraction, pool radius / seconds. */
  acidSplashFrac?: number;
  acidPoolFrac?: number;
  acidPoolRadius?: number;
  acidPoolDuration?: number;
  /** Beacon: rate / dmg / range buffs (fractions, range additive cells), cure cadence (s), reveal radius, Alarm global buff. */
  buffRate?: number;
  buffDmg?: number;
  buffRange?: number;
  cureEvery?: number;
  reveal?: number;
  globalRate?: number;
  globalDmg?: number;
  /** Barrier: HP and regen per second. */
  hp?: number;
  regen?: number;
  /** Clot Spikes: reflected damage per enemy attack-second and contact DPS, both as fractions of the enemy's maxHP (§2.8). */
  reflectFrac?: number;
  contactFrac?: number;
  contactRadius?: number;
  /** histamineBurn: burn DPS at wave 1 (× g(wave)^0.5, armor-ignoring) and duration (s). */
  dotDps?: number;
  dotDuration?: number;
  /** Polyvalent: extra targets per shot and the radius around the primary target they are picked from (§5.9 f). */
  splitTargets?: number;
  splitRadius?: number;
  /** Mark applied per hit: 'stack' (+1, 4 s) or 'strong' (+35 %, 7 s). */
  mark?: 'stack' | 'strong';
  ignoresArmor?: boolean;
  /** Apoptosis execute threshold (fraction of max HP); vs bosses the hit is ×1.5 instead. */
  executeBelow?: number;
}

export interface TowerDef {
  id: TowerId;
  levels: readonly [TowerLevelStats, TowerLevelStats, TowerLevelStats];
  /** Stats when the L3 tower has chosen a spec (replace the L3 row). */
  specs: Readonly<Partial<Record<SpecId, TowerLevelStats>>>;
  hitsFlying: boolean;
  /** Projectile speed in cells/s; 0 = instant (tracer / chain / melee / aura). */
  projectileSpeed: number;
  attack: AttackKind;
  /** Built on the path instead of a pad. */
  onPath: boolean;
  canBeInfected: boolean;
  defaultTargeting: Targeting;
  /** Targeting toggle hidden in the UI (pyrogen, beacon, barrier). */
  hasTargeting: boolean;
  /** Fixed multipliers (§5.1): vs marked, vs bosses, vs spawned, vs regen/shield; their product is capped at `multCap`. */
  vsMarked: number;
  vsBoss: number;
  vsSpawned: number;
  vsRegen: number;
  multCap: number;
}

/** Mutant Cell division (§3.2): the parent is removed at `below` and two `divided` children appear. */
export interface DivideDef {
  /** HP fraction at which the parent divides (0.5). */
  below: number;
  /** Each child's HP = maxHP = this fraction of the parent's maxHP (0.55). */
  hpFraction: number;
  speed: number;
  radius: number;
  reward: number;
  vit: number;
  /** Children are placed at dist ∓ spread (clamped to the path). */
  spread: number;
}

export interface EnemyDef {
  id: EnemyId;
  family: EnemyFamily;
  hp: number;
  speed: number;
  armor: number;
  reward: number;
  /** Vitality lost when it reaches the core. */
  vit: number;
  /** DPS against barriers (×0.25 vs the hero), scaled by wave. */
  attack: number;
  radius: number;
  /** Seconds between two spawns of this type inside a group. */
  gap: number;
  flying: boolean;
  stealth: boolean;
  /**
   * True only for superbug / giantParasite / virusKing. The Mutant Cell is NOT a boss (§3.2): vsBoss does not apply,
   * it can be stunned, executed and Booster-killed, and it attacks barriers instead of smashing them.
   */
  boss: boolean;
  /** Fraction of maxHP regenerated per second (0 = none). */
  regen: number;
  /** Biofilm heal aura: radius and fraction of the target's maxHP per second. */
  healRadius?: number;
  healRate?: number;
  /** Number of trailing body segments and their spacing (parasites). */
  segments?: number;
  segmentSpacing?: number;
  /** Max hit zones (head + segments) one splash / acid / aura tick may damage: 1 for the parasite, 4 for the Giant Parasite (§5.9 m). */
  splashZones?: number;
  /** Fraction all slows are reduced by (0.25 parasite/mutant, 0.5 bosses, 0.6 Virus King). */
  slowResist: number;
  canBeEngulfed: boolean;
  /** Damage multipliers by attack kind (Superbug capsule: tracer 0.5, chain 1.5), §3.1. */
  dmgTaken?: Partial<Record<AttackKind, number>>;
  /** Spore: children spawned on death (any death except engulf). */
  splitInto?: { type: EnemyId; count: number; spread: number };
  divide?: DivideDef;
  /** Virus infection duration (s). */
  infectDuration?: number;
}

export interface BossSkillDef {
  id: BossSkillId;
  /** First trigger time after spawn (s) and period (s); undefined for HP-threshold skills. Scaled by diff.bossCooldownMult except `mutation`. */
  firstAt?: number;
  every?: number;
  /** HP fractions at which the skill fires once each (shellHardening, burrow, shedding). */
  thresholds?: readonly number[];
  telegraph: number;
  /** Effect duration where applicable (s). Mutation: base duration at `shareRef` share, clamped to [durationMin, durationMax] (§3.1). */
  duration?: number;
  durationMin?: number;
  durationMax?: number;
  shareRef?: number;
  /** Type-specific magnitude: spores spawned (per wave band), charge multiplier, burrow distance, infection radius, viruses shed. */
  amount?: number;
}

export interface AbilityDef {
  id: AbilityId;
  cooldown: number;
  /** Requires a drag/tap target on the map. */
  targeted: boolean;
  /** Effect duration (fever, adrenaline). */
  duration?: number;
  radius?: number;
  /** Antibiotic: dmg = dmgBase × g(wave) (§6.1). */
  dmgBase?: number;
  /** Antibiotic: cast delay before impact (s). */
  delay?: number;
  /** Fever: speed factor for normal enemies / bosses. */
  slow?: number;
  slowBoss?: number;
  /** Adrenaline fire-rate bonus. Booster: execute threshold and boss % damage. */
  rateBonus?: number;
  executeBelow?: number;
  bossPercent?: number;
}

export interface TalentDef {
  id: TalentId;
  tier: 1 | 2 | 3 | 4;
  cost: number;
  /** Any one of these must be bought (empty = none). */
  requiresAny: readonly TalentId[];
  /** Minimum number of bought nodes (Booster: 6). */
  requiresCount?: number;
}

export interface DifficultyDef {
  vitality: number;
  startAtp: number;
  hpMult: number;
  speedMult: number;
  armorBonus: number;
  rewardMult: number;
  /** Multiplies `firstAt`, `every` and `duration` of timed boss skills (not `mutation`). */
  bossCooldownMult: number;
  countdown: number;
  /** Extra multiplier on the early-call bonus (hard rewards tempo), applied after rewardMult. */
  earlyBonusMult: number;
}

export interface HeroLevelDef {
  hp: number;
  /** Base damage at wave 1; applied value = dmg × (1 + 0.08 (wave − 1)) (§6). */
  dmg: number;
  rate: number;
  range: number;
  /** Cumulative XP needed to reach the NEXT level (undefined at max). */
  xpToNext?: number;
}

// ── Waves (§8) ──────────────────────────────────────────────────────────────

export interface SpawnGroup {
  type: EnemyId;
  count: number;
  /** Seconds between spawns inside the group (already tempo-scaled when expanded). */
  gap: number;
  spawn: SpawnSel;
  /** Starts together with the previous group instead of 1.5 s after it ends. */
  parallel: boolean;
}

export interface SpawnItem {
  type: EnemyId;
  /** Absolute wave time (s since the wave started) at which this enemy spawns. */
  at: number;
  /** Path index resolved from the group's spawn selector. */
  pathIndex: number;
}

export interface WavePreview {
  wave: number;
  groups: readonly { type: EnemyId; count: number }[];
  boss: BossId | null;
  /** Second boss on endless double-boss waves. */
  boss2?: BossId;
  flying: boolean;
  stealth: boolean;
  virus: boolean;
}

// ── Entities ────────────────────────────────────────────────────────────────

export interface Slow {
  /** Source tower / effect id (negative ids for abilities). */
  src: number;
  amount: number;
  until: number;
}

export interface Dot {
  src: number;
  dps: number;
  until: number;
}

export interface MarkState {
  stacks: number;
  until: number;
  strong: boolean;
}

export interface BossSkillState {
  id: BossSkillId;
  /** Next scheduled trigger (timed skills). */
  nextAt: number;
  /** Telegraph started (0 = idle). */
  telegraphUntil: number;
  /** Active effect end (0 = inactive). */
  activeUntil: number;
  /** Threshold indices already fired (HP skills). */
  firedThresholds: number[];
}

export interface BossState {
  skills: BossSkillState[];
  /** Mutation immunity (Virus King). */
  immuneTo: TowerId | null;
  immuneUntil: number;
  /** Damage per tower type since the LAST mutation (reset to zeros when a mutation fires); the next pick uses it. */
  dmgByTowerType: Record<TowerId, number>;
  /** Number of mutations fired so far. */
  mutations: number;
  charging: boolean;
  burrowedUntil: number;
  /** Boss pauses after smashing a barrier. */
  pausedUntil: number;
  /** Shell hardening: armor ×2 until. Membrane Attack ends it early (§2.6). */
  hardenedUntil: number;
}

export interface Enemy {
  id: number;
  type: EnemyId;
  pathIndex: number;
  /** Distance along the path (cells) of the head. */
  dist: number;
  /** Segment hint for pointOnPath. */
  seg: number;
  x: number;
  y: number;
  /** Position at the previous step (renderer interpolation). Set equal to x/y on every discontinuity (§5.2). */
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  /** Base speed (already difficulty/endless scaled); the per-step velocity is derived (§5.2). */
  speed: number;
  armor: number;
  reward: number;
  vit: number;
  attack: number;
  radius: number;
  flying: boolean;
  stealth: boolean;
  /** Stealth enemy currently inside a reveal radius (targetable). */
  revealed: boolean;
  /** Created by another enemy (T-cell ×2). */
  spawned: boolean;
  /** Mutant child (cannot divide again). */
  divided: boolean;
  slows: Slow[];
  stunUntil: number;
  mark: MarkState;
  dots: Dot[];
  regen: number;
  regenSuppressedUntil: number;
  /** Tower ids that got the lowFever entry stun from each pyrogen (per tower). */
  stunnedBy: number[];
  /** Tower ids this virus has already infected. */
  infected: number[];
  /** Barrier currently being attacked (null = walking). */
  attacking: number | null;
  /** Time before which this enemy cannot (re)start attacking a barrier (breathing interrupt). */
  attackBlockedUntil: number;
  /** Trailing body segment distances (parasites), head excluded, nearest first. */
  segments: number[];
  /** Distance of the parasite's tail at the previous step (renderer interpolation of segments). */
  pdist: number;
  boss: BossState | null;
  /** Time of the last damage taken (biofilm heal / UI). */
  lastHitAt: number;
  /** Source of the last damage: tower id, HERO_SRC or ABILITY_SRC (see constants). */
  lastHitBy: number;
  leaked: boolean;
  dead: boolean;
}

/** `lastHitBy` / `Slow.src` sentinel sources. */
export const HERO_SRC = -1;
export const ABILITY_SRC = -2;

export interface TowerBuff {
  /** Multipliers applied on top of the base stats (1 = none); recomputed whenever a beacon changes. */
  rate: number;
  dmg: number;
  /** Additive range bonus (villi +1 / +0.5, Potentiate +0.5). */
  range: number;
  /** Inside an immunising beacon's range. */
  immune: boolean;
}

export interface Tower {
  id: number;
  type: TowerId;
  col: number;
  row: number;
  x: number;
  y: number;
  level: TowerLevel;
  spec: SpecId | null;
  targeting: Targeting;
  /** Time the next shot / pulse may fire. */
  readyAt: number;
  /** Time of the last shot / bite / chain (renderer fire animation; −1 before the first). */
  lastShotAt: number;
  targetId: number | null;
  /** Turret yaw (radians) for the renderer. */
  angle: number;
  invested: number;
  kills: number;
  damageDealt: number;
  infectedUntil: number;
  /** Cannot be infected before this time (hero cure immunity, §5.3). */
  immuneUntil: number;
  onVilli: boolean;
  buff: TowerBuff;
  /** Macrophage. */
  engulfReadyAt: number;
  digestingUntil: number;
  /** Beacon cure pulse. */
  cureAt: number;
  /** Barrier (hp 0 for other towers). */
  hp: number;
  maxHp: number;
  /** Barrier: regen resumes after this time. */
  regenAt: number;
  /** Barrier: distance along each path it sits on (index = pathIndex, -1 = not on that path). */
  pathDist: number[];
}

/** Enzymes acid pool on the floor (§2.2): armor-ignoring DoT on ground enemies inside `radius` until `until`. */
export interface AcidPool {
  id: number;
  /** Source macrophage tower id. */
  src: number;
  x: number;
  y: number;
  radius: number;
  /** Damage per second (already a fraction of the engulfed enemy's maxHP). */
  dps: number;
  until: number;
}

export interface Projectile {
  id: number;
  src: number;
  kind: TowerId;
  x: number;
  y: number;
  px: number;
  py: number;
  tx: number;
  ty: number;
  targetId: number;
  speed: number;
  dmg: number;
  splash: number;
  /** Lobbed arc (mast) vs straight (antibody). */
  arc: boolean;
  /** Peak height of the arc (cells); the renderer draws h = 4 · arcHeight · t · (1 − t). */
  arcHeight: number;
  /** Flight progress 0..1 (distance covered / total distance at launch). */
  t: number;
  mark: 'stack' | 'strong' | null;
  /** Spec payload carried to impact. */
  spec: SpecId | null;
  done: boolean;
}

export interface Hero {
  x: number;
  y: number;
  /** Previous-step position; set equal to x/y on respawn (§5.2). */
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  level: 1 | 2 | 3;
  xp: number;
  alive: boolean;
  respawnAt: number;
  /** Destination (null = idle). The hero does not attack while walking (§5.9 h). */
  dest: Point | null;
  /** Facing (radians) for the renderer. */
  angle: number;
  readyAt: number;
  lastHitAt: number;
  /** Currently attacking this enemy (renderer plays the hit). */
  targetId: number | null;
}

export interface AbilityState {
  id: AbilityId;
  unlocked: boolean;
  /** Cooldown length actually used (talent-adjusted). */
  cooldown: number;
  readyAt: number;
  /** Active buff end (fever, adrenaline). */
  activeUntil: number;
  /** Antibiotic: pending impact (x, y, at) or null. */
  pending: { x: number; y: number; at: number } | null;
}

export interface FlowState {
  /** Alveoli only; false elsewhere. */
  breathing: boolean;
  /** Seconds into the current cycle. */
  cycleT: number;
  reversed: boolean;
  warn: boolean;
}

export interface WaveState {
  /** Remaining spawns, sorted by `at`. */
  queue: SpawnItem[];
  /** Seconds since the wave started. */
  elapsed: number;
  total: number;
  spawnedCount: number;
  /** Boss enemy ids of this wave. */
  bossIds: number[];
  /** Per-path spawn gate: time the next enemy may enter (0.35-cell spacing rule). */
  lastSpawnAt: number[];
}

export interface RunStats {
  kills: number;
  leaks: number;
  bossKills: number;
  atpEarned: number;
  atpSpent: number;
  wavesCleared: number;
  heroKills: number;
  cures: number;
  /** Total vitality lost to leaks over the run (stars are computed from this, §5.8; tissueRepair cannot undo it). */
  vitLost: number;
  /** Lowest vitality reached (end-of-run stats). */
  minVitality: number;
  /** Simulation seconds. */
  playtime: number;
  /** Damage dealt per tower type (end-of-run stats). */
  dmgByTowerType: Record<TowerId, number>;
  /** Boss types killed this run, in first-kill order (`vaccineUnlocked` fires once per type; `recordRun` safety net). */
  bossTypesKilled: BossId[];
  /**
   * What `recordRun` already added to the memory at the wave-20 clear (`noteRecorded`). Continuing into endless keeps
   * the same run, so the final `recordRun` (game over, possibly after a save / reload) adds only what happened since
   * and does not count a second run. null until the clear is recorded; serialized with the run save.
   */
  recorded: RecordedRunStats | null;
}

/** Cumulative counters of a run at the moment they were recorded into `ImmuneMemory.stats`. */
export interface RecordedRunStats {
  kills: number;
  bossKills: number;
  wavesCleared: number;
  playtime: number;
}

/** Everything the persistent memory changes about a run, resolved once at createGame / load (§10). */
export interface MemoryModifiers {
  dmgMult: number;
  startAtpBonus: number;
  cooldownMult: number;
  heroHpMult: number;
  heroDmgMult: number;
  /** Mark stacks one hero melee hit applies (1; sharpBlanc 2). */
  heroMarkStacks: number;
  /** Prion reveal radius around the living hero (2.0; sharpBlanc 3.0). */
  heroRevealRadius: number;
  /** Cure radius (0.6; rapidResponse 1.5) and the infection immunity a hero cure grants (3 s; rapidResponse 5 s). */
  heroCureRadius: number;
  heroCureImmunity: number;
  heroSpeedMult: number;
  heroRespawn: number;
  barrierHpMult: number;
  /** Interest fraction of unspent ATP per cleared wave (0 = none) and its cap. */
  interest: number;
  interestCap: number;
  vitPerWave: number;
  boosterUnlocked: boolean;
  vaccines: Record<BossId, boolean>;
}

export interface GameState {
  v: typeof RUN_VERSION;
  mapId: MapId;
  difficulty: Difficulty;
  /** Derived from mapId (not serialized). */
  map: MapDef;
  /** One geometry per path (not serialized). */
  geoms: PathGeom[];
  /**
   * xorshift32 state. RESERVED: no v2 logic system draws from it (spawn gaps and endless rotation are index-based,
   * tie-breaks use the lowest id). It is seeded and serialized so a later feature can use it without a schema
   * change. `Math.random` is forbidden in logic.ts (unit test greps for it); VFX randomness lives in the renderer.
   */
  rng: number;
  time: number;
  phase: Phase;
  wave: number;
  endless: boolean;
  /** Seconds left in the `countdown` phase. */
  countdown: number;
  vitality: number;
  maxVitality: number;
  atp: number;
  towers: Tower[];
  enemies: Enemy[];
  projectiles: Projectile[];
  hero: Hero;
  abilities: Record<AbilityId, AbilityState>;
  flow: FlowState;
  waveState: WaveState;
  stats: RunStats;
  memory: MemoryModifiers;
  /** Enzymes acid pools (§2.2); expired pools are removed every step. */
  pools: AcidPool[];
  /** Pending events for VFX / sound / UI; drained by `takeEvents` (not serialized). */
  events: GameEvent[];
  nextId: number;
  /** Stars earned when `phase === 'cleared'` (0 before). */
  stars: number;
}

/** What `run` stores (§12.1): the state minus derived / transient fields. */
export type SerializedGameState = Omit<GameState, 'map' | 'geoms' | 'events'>;

export interface RunSave {
  v: typeof RUN_VERSION;
  savedAt: number;
  mapId: MapId;
  difficulty: Difficulty;
  state: SerializedGameState;
}

// ── Persistent immune memory (§12.2) ────────────────────────────────────────

export interface PerDifficulty {
  normal: number;
  hard: number;
}

export interface MemoryPrefs {
  map: MapId;
  difficulty: Difficulty;
  speed: GameSpeed;
  quality: Quality;
}

export interface MemoryStats {
  runs: number;
  kills: number;
  bossKills: number;
  wavesCleared: number;
  playtime: number;
}

/** Single source of truth for progression; `recordBest` mirrors are derived from it, never read back (§11.4). */
export interface ImmuneMemory {
  v: typeof MEMORY_VERSION;
  stars: Record<MapId, PerDifficulty>;
  bestEndless: Record<MapId, PerDifficulty>;
  vaccines: Record<BossId, boolean>;
  /** ms epoch of the first kill, for the card footer. */
  vaccineDates: Partial<Record<BossId, number>>;
  talents: TalentId[];
  tutorialSeen: TutorialId[];
  prefs: MemoryPrefs;
  stats: MemoryStats;
}

/** Result of `recordRun`: the new memory plus what the end-of-run modal should celebrate. */
export interface RecordRunResult {
  memory: ImmuneMemory;
  /** Stars on this map/difficulty improved. */
  newStars: boolean;
  /** Best endless wave on this map/difficulty improved. */
  newEndless: boolean;
}

// ── Events (§11.5): drained once per frame for VFX, sound, haptics, floating text, toasts ──

export type DeniedReason =
  | 'noAtp'
  | 'occupied'
  | 'notPad'
  | 'notPath'
  | 'barrierZone'
  | 'barrierLimit'
  | 'maxLevel'
  | 'phase'
  | 'cooldown'
  | 'locked'
  | 'heroDead'
  /** A targeted ability was cast without a target point. */
  | 'needTarget'
  /** L2 → L3 upgrade without one of TOWER_SPECS[type] (the UI opens the specialization cards instead). */
  | 'needSpec';

/**
 * Discontinuity events: in a step that emits one of `spawn`, `split`, `flowReverse`, `bossSkill` (burrow, 'end'),
 * `heroRespawn` the affected entity's prev position equals its current one (§5.2); the interpolation unit test
 * allows a jump only in such steps.
 */
export type GameEvent =
  | { type: 'spawn'; id: number; enemy: EnemyId; pathIndex: number; x: number; y: number }
  | { type: 'shoot'; tower: number; kind: TowerId; x: number; y: number; angle: number }
  | { type: 'tracer'; tower: number; x1: number; y1: number; x2: number; y2: number }
  /** `points[0]` is the tower; `ids[k]` is the enemy at `points[k]` (−1 for the tower origin). */
  | { type: 'chain'; tower: number; points: Point[]; ids: number[] }
  | { type: 'hit'; kind: TowerId | 'hero' | 'ability'; enemy: number; x: number; y: number; dmg: number; crit: boolean }
  | { type: 'splash'; kind: TowerId | 'ability'; x: number; y: number; radius: number; hits: number }
  | { type: 'pulse'; tower: number; x: number; y: number; range: number; hits: number }
  | { type: 'immuneHit'; enemy: number; kind: TowerId; x: number; y: number }
  | { type: 'engulf'; tower: number; enemy: number; enemyType: EnemyId; x: number; y: number }
  | { type: 'acid'; x: number; y: number; radius: number; until: number }
  | { type: 'mark'; enemy: number; stacks: number; strong: boolean }
  | { type: 'execute'; enemy: number; enemyType: EnemyId; x: number; y: number; by: 'apoptosis' | 'booster' }
  | { type: 'stun'; enemy: number; x: number; y: number; duration: number }
  | { type: 'kill'; enemy: number; enemyType: EnemyId; x: number; y: number; reward: number; by: number; boss: boolean }
  /** Spore death (3 sporelings) or Mutant division (2 mutant halves, parent removed without a `kill`). */
  | { type: 'split'; parent: number; enemyType: EnemyId; children: number[]; x: number; y: number; reward: number }
  | { type: 'leak'; enemy: number; enemyType: EnemyId; vit: number; vitality: number }
  | { type: 'heal'; enemy: number; amount: number }
  | { type: 'reveal'; enemy: number; revealed: boolean }
  | { type: 'infect'; tower: number; by: number; until: number }
  | { type: 'cure'; tower: number; by: 'hero' | 'beacon'; immuneUntil: number }
  | { type: 'barrierHit'; tower: number; enemy: number; hp: number; maxHp: number }
  | { type: 'barrierBroken'; tower: number; x: number; y: number }
  | { type: 'barrierSmashed'; tower: number; by: number; x: number; y: number }
  | { type: 'build'; tower: number; kind: TowerId; x: number; y: number; cost: number }
  | { type: 'upgrade'; tower: number; kind: TowerId; level: TowerLevel; spec: SpecId | null; cost: number }
  | { type: 'sell'; tower: number; kind: TowerId; x: number; y: number; refund: number }
  | { type: 'targeting'; tower: number; mode: Targeting }
  | { type: 'denied'; reason: DeniedReason }
  /** Emitted only by a successful `moveHero`. */
  | { type: 'heroMove'; x: number; y: number }
  | { type: 'heroAttack'; enemy: number; x: number; y: number; dmg: number }
  | { type: 'heroHurt'; hp: number; maxHp: number }
  | { type: 'heroDeath'; x: number; y: number; respawnAt: number }
  | { type: 'heroRespawn'; x: number; y: number }
  | { type: 'heroLevel'; level: 1 | 2 | 3 }
  | { type: 'abilityCast'; ability: AbilityId; x?: number; y?: number }
  | { type: 'abilityImpact'; ability: AbilityId; x: number; y: number; radius: number; hits: number }
  | { type: 'abilityEnd'; ability: AbilityId }
  | { type: 'bossSkill'; boss: number; bossType: BossId; skill: BossSkillId; stage: 'telegraph' | 'start' | 'end'; x: number; y: number }
  | { type: 'mutation'; boss: number; immuneTo: TowerId; until: number }
  | { type: 'flowReverse'; reversed: boolean }
  | { type: 'flowWarn' }
  | { type: 'waveStart'; wave: number; bonus: number; boss: BossId | null }
  | { type: 'waveClear'; wave: number; bonus: number; interest: number; vitRestored: number }
  | { type: 'earlyBonus'; wave: number; bonus: number }
  | { type: 'mapCleared'; wave: number; stars: number }
  | { type: 'gameOver'; wave: number }
  /** The UI must write `memory` synchronously when it sees this (§12.2). */
  | { type: 'vaccineUnlocked'; boss: BossId }
  | { type: 'atp'; delta: number; x: number; y: number };

// ── Render snapshot (§11.5): struct-of-arrays, preallocated, filled by `snapshot()` once per frame ──

/** Index into ENEMY_IDS / TOWER_IDS etc. so the renderer can switch on small ints without string compares. */
export type TypeIndex = number;

export interface EnemyViewBuffer {
  capacity: number;
  /** min(alive enemies, capacity); the rest are simulated but not drawn (dev console warning once). */
  count: number;
  id: Int32Array;
  /** Index into ENEMY_IDS. */
  type: Uint8Array;
  /** Interpolated world position (already lerped by alpha) and the heading in radians. */
  x: Float32Array;
  y: Float32Array;
  angle: Float32Array;
  hpFrac: Float32Array;
  radius: Float32Array;
  /** Bit flags, see EnemyViewFlag. */
  flags: Uint16Array;
  markStacks: Uint8Array;
  /** Slow fraction 0..1 (for shimmer intensity). */
  slow: Float32Array;
  /** Boss immunity tower index + 1 (0 = none). */
  immuneTo: Uint8Array;
  /** Boss skill telegraph progress 0..1 (0 = none). */
  telegraph: Float32Array;
  /** Parasite segments: for enemy i, `segStart[i]..segStart[i]+segCount[i]` index into segX/segY/segAngle. */
  segStart: Int32Array;
  segCount: Uint8Array;
  segCapacity: number;
  segTotal: number;
  segX: Float32Array;
  segY: Float32Array;
  segAngle: Float32Array;
}

export const EnemyViewFlag = {
  Flying: 1,
  Stealth: 2,
  Revealed: 4,
  Boss: 8,
  Spawned: 16,
  Stunned: 32,
  Burrowed: 64,
  Charging: 128,
  Attacking: 256,
  Hardened: 512,
  Burning: 1024,
  Marked: 2048,
  Divided: 4096,
  /** Neutralizing (strong) mark: +35 % flat instead of +10 % per stack (mark pips are drawn differently). */
  StrongMark: 8192,
} as const;

/** One preallocated object per slot (SNAPSHOT_CAPACITY.towers); `snapshot` rewrites fields in place. */
export interface TowerView {
  id: number;
  type: TypeIndex;
  typeId: TowerId;
  level: TowerLevel;
  spec: SpecId | null;
  x: number;
  y: number;
  angle: number;
  /** Fire animation trigger: time of the last shot (−1 = never). */
  lastShotAt: number;
  infected: boolean;
  /** Hero-cure immunity still active (shield glyph). */
  immune: boolean;
  /** 0..1 cooldown progress for macrophage engulf / beacon pulse. */
  charge: number;
  digesting: boolean;
  /** Barrier HP fraction (1 for others). */
  hpFrac: number;
  onVilli: boolean;
  buffed: boolean;
  selected: boolean;
  range: number;
}

export interface ProjectileViewBuffer {
  capacity: number;
  count: number;
  /** Index into TOWER_IDS. */
  kind: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  /** Height above the floor (cells): 4 · arcHeight · t · (1 − t) for arcs, 0.35 for straight shots. */
  h: Float32Array;
  angle: Float32Array;
}

export interface HeroView {
  /** Interpolated position; while dead, the respawn point (his post beside the core, §6). */
  x: number;
  y: number;
  angle: number;
  hpFrac: number;
  level: 1 | 2 | 3;
  xpFrac: number;
  alive: boolean;
  /** 0..1 respawn progress (1 = about to respawn). */
  respawnFrac: number;
  moving: boolean;
  attacking: boolean;
  /** Destination for the move marker (NaN when idle). */
  destX: number;
  destY: number;
  curing: boolean;
}

export interface FlowView {
  breathing: boolean;
  reversed: boolean;
  warn: boolean;
  /** Fever active → particles slow. */
  fever: boolean;
  adrenaline: boolean;
}

export type Selection =
  | { kind: 'tower'; id: number }
  | { kind: 'pad'; col: number; row: number; previewType: TowerId | null }
  | { kind: 'hero' }
  | null;

export interface RenderSnapshot {
  time: number;
  /** Interpolation factor applied to positions in this snapshot. */
  alpha: number;
  phase: Phase;
  wave: number;
  enemies: EnemyViewBuffer;
  towers: TowerView[];
  towerCount: number;
  projectiles: ProjectileViewBuffer;
  hero: HeroView;
  flow: FlowView;
  // ── UI-owned fields: `snapshot()` never writes them; the UI sets them before `renderer.render(snap)` ──
  /** Selected tower / pad / hero for the selection ring, range disc and ghost model. */
  selection: Selection;
  interaction: InteractionMode;
  /** Antibiotic target-mode cursor in world cells (NaN when inactive). */
  cursorX: number;
  cursorY: number;
}

// ── Renderer contract (§11.8) ───────────────────────────────────────────────

export interface RendererOptions {
  /** 'auto' starts high and drops to low when the frame-time probe (waves 1 and 5) is under 45 fps (§11.6). */
  quality: Quality | RenderQuality;
  theme: ThemeName;
  lang: Lang;
  /** ctx.t: the renderer's own keys (`fx_*`) and the display names (`tower_*`, `enemy_*`, `skill_*`) resolve through it. */
  t?: (key: string, params?: Record<string, string | number>) => string;
  /** Context lost (true) / restored (false). The UI pauses the sim and shows the reload overlay (§7.10). */
  onContextLost?: (lost: boolean) => void;
}

/**
 * Result of `pick`, resolved by priority hero > tower > pad > path > terrain against invisible proxies (not the floor
 * plane), then snapped to the nearest pad centre within WORLD.pickSnap when a pad is the best candidate.
 */
export type PickResult =
  | { kind: 'hero' }
  | { kind: 'tower'; id: number; col: number; row: number }
  | { kind: 'pad'; col: number; row: number }
  | { kind: 'path'; col: number; row: number }
  | { kind: 'terrain'; x: number; y: number }
  | null;

/**
 * A tap from the renderer's built-in gestures (8 px slop), resolved hero > tower > enemy > pad > path > terrain.
 * `pick` is the enemy-free contract version; the UI routes taps through `onTap`.
 */
export interface TapHit {
  kind: 'hero' | 'tower' | 'enemy' | 'pad' | 'path' | 'terrain';
  /** Tower id or enemy id; −1 otherwise. */
  id: number;
  /** Grid cell (snapped pad cell for pads; the cell under the hit otherwise); −1 outside the grid. */
  col: number;
  row: number;
  /** Logic point on the floor under the tap (pad centre for pads). */
  x: number;
  y: number;
  /** Screen point (CSS px, container-relative). */
  sx: number;
  sy: number;
  /** True when (col, row) is a vessel cell — lets the UI treat an enemy tap as a path tap (barrier building). */
  pathCell: boolean;
}

/** Per-frame renderer counters for the smoke test (§11.9). */
export interface RenderStats {
  calls: number;
  triangles: number;
  /** Mean frame time of the last probe window (ms). */
  frameMs: number;
}

/**
 * Three.js renderer. Fully reconstructible from `map` + the next snapshot (`rebuild`), never reads `GameState`.
 * Screen coordinates (sx, sy) are CSS px relative to the container.
 */
export interface ImmuneRenderer {
  /** Re-reads the container size / DPR (orientation change, bottom-sheet open) and keeps the clamped camera valid. */
  resize(): void;
  render(snap: RenderSnapshot): void;
  /** Same array the UI drained with `takeEvents` this frame; valid only during the call. */
  handleEvents(events: readonly GameEvent[]): void;
  pick(sx: number, sy: number): PickResult;
  /** Projects world (x, y, h) to screen; false when outside the viewport (HP bars, floating text). */
  project(x: number, y: number, h: number, out: Point): boolean;
  /** One-finger drag in CSS px; clamped so the map never leaves the viewport. */
  panBy(dx: number, dy: number): void;
  /** Pinch around a screen point; zoom clamped to [CAMERA.minZoom, CAMERA.maxZoom]. */
  zoomAt(sx: number, sy: number, factor: number): void;
  /** Default framing (§11.8): fit the map width, show the core-side CAMERA.defaultViewFromCore of its height. */
  fitMap(): void;
  /** Animated clamped pan so world (x, y) lands at vertical screen fraction `fy` (default 0.45) of the visible strip. */
  centerOn(x: number, y: number, fy?: number): void;
  /** 'auto' starts high and probes frame time (§11.6); 'high' / 'low' force it. */
  setQuality(q: Quality | RenderQuality): void;
  setTheme(t: ThemeName): void;
  /** Disposes and recreates every GPU resource (context restore, "重新加载"). */
  rebuild(): void;
  stats(): RenderStats;
  destroy(): void;

  // ── Integration surface the DOM UI uses (§7.10, §11.2) ──
  /** Same as `handleEvents` + `render`, with the real frame time in seconds (VFX timing); `alpha` is informational. */
  update(snap: RenderSnapshot, alpha?: number, dt?: number): void;
  /** Built-in tap gestures; returns an unsubscribe function. */
  onTap(cb: (hit: TapHit) => void): () => void;
  /** Screen point (CSS px) → floor point in logic cells; false when the ray misses the floor. */
  floorPoint(sx: number, sy: number, out: Point): boolean;
  /**
   * CSS px covered by UI chrome on top / bottom; framing, clamping and `centerOn` use the strip between them.
   * `refit` (default true) re-applies the default framing; false keeps the camera and eases it back inside the clamp.
   */
  setInsets(top: number, bottom: number, refit?: boolean): void;
  /** Pulsing highlights on pads / path cells (build strip); null clears. */
  showBuildable(cells: readonly (readonly [number, number])[] | null): void;
  /** Pads that a previewed virus wave can infect (§5.3): drawn with a biohazard glyph; null clears. */
  showRisk(cells: readonly (readonly [number, number])[] | null): void;
  /** Range disc of the build-ghost preview (null = the type's built-in L1 range). */
  setGhostRange(r: number | null): void;
  /** Idle frames (build / countdown, nothing moving) use the low flow-particle count (§11.6). */
  setIdle(idle: boolean): void;
  /** True while the wave-start banner is on screen (the UI holds the boss toast until it is gone). */
  readonly bannerShowing: boolean;
  /** Freezes VFX / idle animation while the game is paused (camera gestures still redraw). */
  pause(): void;
  resume(): void;
  setLanguage(lang: Lang, t?: (key: string, params?: Record<string, string | number>) => string): void;
  /** VFX still settling (the UI keeps full frame rate until they finish). */
  readonly busy: boolean;
}

/** renderer.ts default export; the UI lazy-loads it (`import('./renderer')`) and prefetches on the start screen. */
export type CreateRenderer = (container: HTMLElement, map: MapDef, opts: RendererOptions) => ImmuneRenderer;

// ── UI-facing derived views ────────────────────────────────────────────────

/** Resolved stats of one tower for the panel (base × buffs, wave-scaled formulas evaluated for the relevant wave). */
export interface TowerStatBlock {
  dmg: number;
  rate: number;
  range: number;
  dps: number;
  /** Secondary lines in display order (key → number); the UI translates keys. */
  extras: { key: string; value: number }[];
  upgradeCost: number | null;
  sellValue: number;
  nextLevel: Partial<TowerStatBlock> | null;
}

export interface BuildCheck {
  ok: boolean;
  reason: DeniedReason | null;
  cost: number;
}

export interface TalentView {
  id: TalentId;
  def: TalentDef;
  state: 'bought' | 'available' | 'unaffordable' | 'locked';
}

export interface CastResult {
  ok: boolean;
  reason: DeniedReason | null;
}

// ── Pure logic API (implemented by logic.ts as named exports AND as `logic: ImmuneLogic`) ──

export interface CreateGameOptions {
  mapId: MapId;
  difficulty: Difficulty;
  memory: ImmuneMemory;
  /** Deterministic seed (tests / replays); default from Date.now(). */
  seed?: number;
}

/**
 * Pure simulation API. Every mutating call takes the state first and returns a plain result; UI feedback comes from
 * the events queue (`denied` events carry the reason) so the UI never needs to re-validate. logic.ts must not import
 * 'three' or touch the DOM.
 */
export interface ImmuneLogic {
  // Static data
  readonly maps: readonly MapDef[];
  readonly towers: Readonly<Record<TowerId, TowerDef>>;
  readonly enemies: Readonly<Record<EnemyId, EnemyDef>>;
  readonly bossSkills: Readonly<Record<BossId, readonly BossSkillDef[]>>;
  readonly abilities: Readonly<Record<AbilityId, AbilityDef>>;
  readonly talents: Readonly<Record<TalentId, TalentDef>>;
  readonly difficulties: Readonly<Record<Difficulty, DifficultyDef>>;
  readonly heroLevels: readonly [HeroLevelDef, HeroLevelDef, HeroLevelDef];

  // Maps
  findMap(id: MapId): MapDef;
  /** null when valid, otherwise a short error (§1.5). */
  validateMap(map: MapDef): string | null;
  pathGeometry(map: MapDef, pathIndex: number): PathGeom;
  pointOnPath(geom: PathGeom, dist: number, segHint?: number): { x: number; y: number; seg: number; flow: FlowDir };

  // Lifecycle
  createGame(opts: CreateGameOptions): GameState;
  /** Advances by `dt` seconds (call with SIM_STEP). No-op in build / cleared / over except hero movement & cures. */
  step(s: GameState, dt: number): void;
  /**
   * Swaps the two preallocated event buffers and returns the one that was pending. Drain exactly once per frame;
   * pass the same array to `renderer.handleEvents` and then to the UI handlers. Valid until the next call.
   */
  takeEvents(s: GameState): readonly GameEvent[];
  /**
   * Fills `out` (preallocated, reused) from the state; `alpha` in [0, 1] interpolates prev → cur positions. Never
   * writes the UI-owned fields (`selection`, `interaction`, `cursorX/Y`).
   */
  snapshot(s: GameState, out: RenderSnapshot, alpha: number): void;
  /** Allocates a snapshot buffer (SNAPSHOT_CAPACITY unless overridden). */
  createSnapshot(map: MapDef, capacity?: Partial<Record<keyof typeof SNAPSHOT_CAPACITY, number>>): RenderSnapshot;

  // Building
  canBuild(s: GameState, col: number, row: number, type: TowerId): BuildCheck;
  build(s: GameState, col: number, row: number, type: TowerId): Tower | null;
  /** L1→L2 needs no spec; L2→L3 requires `spec` to be one of TOWER_SPECS[type] (denied with 'needSpec' otherwise). */
  upgrade(s: GameState, towerId: number, spec?: SpecId): boolean;
  /** Refund actually granted (0 when nothing was sold). */
  sell(s: GameState, towerId: number): number;
  setTargeting(s: GameState, towerId: number, mode: Targeting): void;
  towerAt(s: GameState, col: number, row: number): Tower | undefined;
  isPad(s: GameState, col: number, row: number): boolean;
  isPathCell(s: GameState, col: number, row: number): boolean;
  /**
   * Resolved stats for the panel; `level`/`spec` override the tower's own to preview an upgrade. Wave-scaled lines
   * (aura DPS, burn, acid, clot, engulf threshold) use the wave the stat will apply to (§11.2).
   */
  towerStats(s: GameState, tower: Tower, level?: TowerLevel, spec?: SpecId | null): TowerStatBlock;
  buildCost(type: TowerId): number;
  upgradeCost(tower: Pick<Tower, 'type' | 'level'>): number | null;
  sellValue(tower: Pick<Tower, 'invested'>): number;

  // Hero & abilities
  /** Sends the hero toward a world point (clamped to the grid). false when dead; emits `heroMove` only on success. */
  moveHero(s: GameState, x: number, y: number): boolean;
  castAbility(s: GameState, id: AbilityId, target?: Point): CastResult;
  /** Damage one cast of a damaging ability would deal at `wave` before family multipliers (0 for others); for tooltips. */
  abilityDamage(id: AbilityId, wave: number): number;

  // Waves
  canStartWave(s: GameState): boolean;
  /** Starts the next wave; returns the early-call bonus granted (0 when none) or -1 when not allowed. */
  startWave(s: GameState, early?: boolean): number;
  continueEndless(s: GameState): void;
  wavePreview(mapId: MapId, wave: number): WavePreview;
  waveScript(mapId: MapId, wave: number): SpawnGroup[];
  expandWave(map: MapDef, groups: SpawnGroup[], wave: number): SpawnItem[];
  earlyBonus(wave: number, remaining: number, difficulty: Difficulty): number;
  waveClearBonus(wave: number, difficulty: Difficulty): number;
  /** HP growth g(w) (§ conventions). */
  growth(wave: number): number;

  // Memory & persistence
  defaultMemory(): ImmuneMemory;
  /**
   * Lenient reader for the persistent blob (§12.2): migrates `v < MEMORY_VERSION`, fills missing fields from
   * `defaultMemory()`, clamps stars to 0..3, drops unknown talent / tutorial ids; null only when `v` is missing,
   * non-numeric or newer than this build.
   */
  parseMemory(raw: unknown): ImmuneMemory | null;
  resolveModifiers(memory: ImmuneMemory): MemoryModifiers;
  totalStars(memory: ImmuneMemory): number;
  talentPoints(memory: ImmuneMemory): number;
  talentView(memory: ImmuneMemory): TalentView[];
  /** Returns the updated memory (pure) or null when the node cannot be bought. */
  buyTalent(memory: ImmuneMemory, id: TalentId): ImmuneMemory | null;
  respec(memory: ImmuneMemory): ImmuneMemory;
  /** Pure: grants a vaccine (idempotent); the UI calls it on `vaccineUnlocked` and writes memory at once. */
  grantVaccine(memory: ImmuneMemory, boss: BossId, at: number): ImmuneMemory;
  /** Applies run results (stars, best endless, stats) to the memory; pure. `newStars`/`newEndless` compare against the input. */
  recordRun(memory: ImmuneMemory, s: GameState): RecordRunResult;
  /** Remembers in the run that `recordRun` has counted it so far (call after recording the wave-20 clear). */
  noteRecorded(s: GameState): void;
  isMapUnlocked(memory: ImmuneMemory, id: MapId): boolean;
  isHardUnlocked(memory: ImmuneMemory, id: MapId): boolean;
  /** Stars from `stats.vitLost` (§5.8), 0 unless wave 20 is cleared. */
  starsFor(s: GameState): number;
  serialize(s: GameState): RunSave;
  /** null when the save is missing, foreign, mid-wave or inconsistent (§12.1). */
  deserialize(raw: unknown, memory: ImmuneMemory): GameState | null;
}
