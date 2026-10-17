/**
 * Colour language. Theme-dependent environment colours (dark = deep plum interior, light = warm rosy interior) and
 * theme-independent entity colours: immune cells are pale membranes with teal/cyan emissive accents, pathogens are
 * acid green / violet / sickly yellow. Spec emblems use one colour per specialization.
 */
import type { ThemeName } from '../../../app/types';
import type { EnemyId, SpecId, TowerId } from '../types';

export interface Palette {
  bg: number;
  floorLow: number;
  floorBase: number;
  floorHigh: number;
  floorEdge: number;
  floorSpeck: number;
  trench: number;
  trenchWall: number;
  trenchRim: number;
  trenchGlow: number;
  blood: number;
  bloodHi: number;
  flow: number;
  rbc: number;
  pad: number;
  padEdge: number;
  padRing: number;
  padRingHi: number;
  villiRing: number;
  villi: number;
  core: number;
  coreGlow: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  exposure: number;
  rim: number;
  rimStrength: number;
  deco: number;
  glowDot: number;
  shadow: number;
  shadowAlpha: number;
  /** Glow layers blend additively on the dark floor and normally on the light one (additive washes out there). */
  additive: boolean;
  rangeFill: number;
  rangeEdge: number;
  select: number;
  build: number;
  fever: number;
  /** Floating text outline colour. */
  textStroke: string;
  textMain: string;
}

export const PALETTES: Record<ThemeName, Palette> = {
  dark: {
    bg: 0x1c0a1a,
    floorLow: 0x420f2c,
    floorBase: 0x641c42,
    floorHigh: 0x86305a,
    floorEdge: 0x4a1434,
    floorSpeck: 0x8a3a5e,
    trench: 0x3a0820,
    trenchWall: 0x5a1430,
    trenchRim: 0x9a3a5c,
    trenchGlow: 0xff2d55,
    blood: 0xd91e48,
    bloodHi: 0xff7a92,
    flow: 0xffb0c2,
    rbc: 0xff4d64,
    pad: 0xf6d2df,
    padEdge: 0xc68aa6,
    padRing: 0x1fae9f,
    padRingHi: 0x7dfff0,
    villiRing: 0xffc94d,
    villi: 0xff9ab4,
    core: 0xff5c86,
    coreGlow: 0xffb3c8,
    hemiSky: 0xf4f2ff,
    hemiGround: 0x5a2440,
    hemiIntensity: 1.35,
    sun: 0xfffaf5,
    sunIntensity: 2.0,
    exposure: 1.08,
    rim: 0xffa8d0,
    rimStrength: 0.3,
    deco: 0x7a3058,
    glowDot: 0xff7ab0,
    shadow: 0x0a0208,
    shadowAlpha: 0.5,
    additive: true,
    rangeFill: 0x5ff5e2,
    rangeEdge: 0x9ffff2,
    select: 0xffffff,
    build: 0x6dffe9,
    fever: 0xff7a2e,
    textStroke: 'rgba(20,4,16,0.9)',
    textMain: '#ffffff',
  },
  light: {
    bg: 0xefc9c2,
    floorLow: 0xc97478,
    floorBase: 0xdc8f8e,
    floorHigh: 0xeaaba4,
    floorEdge: 0xd88c8a,
    floorSpeck: 0xffe1da,
    trench: 0x9c2a46,
    trenchWall: 0xc04a62,
    trenchRim: 0xfbd3cb,
    trenchGlow: 0xff3d64,
    blood: 0xd81f4a,
    bloodHi: 0xff8aa0,
    flow: 0xfff3f5,
    rbc: 0xe0233f,
    pad: 0xfff4f0,
    padEdge: 0xd99a9e,
    padRing: 0x0f9e8d,
    padRingHi: 0x10d8c2,
    villiRing: 0xe0a100,
    villi: 0xf58aa5,
    core: 0xff3f6d,
    coreGlow: 0xffd2dc,
    hemiSky: 0xfbfaff,
    hemiGround: 0xd29a92,
    hemiIntensity: 1.4,
    sun: 0xfffcf8,
    sunIntensity: 2.0,
    exposure: 0.9,
    rim: 0xffffff,
    rimStrength: 0.22,
    deco: 0xd88f8e,
    glowDot: 0xffffff,
    shadow: 0x5a1a2a,
    shadowAlpha: 0.32,
    additive: false,
    rangeFill: 0x0fb5a0,
    rangeEdge: 0x078c7c,
    select: 0x2a0f22,
    build: 0x0fb5a0,
    fever: 0xff6a1a,
    textStroke: 'rgba(40,10,28,0.85)',
    textMain: '#ffffff',
  },
};

// ── Entities (theme independent) ───────────────────────────────────────────

export const MEMBRANE = 0xeaf7f4;
export const MEMBRANE_2 = 0xc4e4df;
export const MEMBRANE_WARM = 0xf6e6ee;

/** Pale tinted membrane per tower type (silhouette + hue tell types apart at a glance). */
export const TOWER_BODY: Record<TowerId, number> = {
  antibody: 0x9fe6ff,
  macrophage: 0x8debbf,
  mast: 0xf7bfe2,
  pyrogen: 0xffc29a,
  tcell: 0xb2c4ff,
  complement: 0xc6b8ff,
  beacon: 0xffe29a,
  barrier: 0xf3d2a0,
};

/** Main accent per tower type (emissive parts, projectiles, chain colours, range disc tint). */
export const TOWER_ACCENT: Record<TowerId, number> = {
  antibody: 0x3fe8ff,
  macrophage: 0x2ff0b0,
  mast: 0xff4fa8,
  pyrogen: 0xff8a3d,
  tcell: 0xff3d7f,
  complement: 0x9b86ff,
  beacon: 0xffd24d,
  barrier: 0xffb56b,
};

export const SPEC_COLOR: Record<SpecId, number> = {
  polyvalent: 0xffd25a,
  neutralizing: 0xa77bff,
  fastDigestion: 0x8dff5a,
  enzymes: 0xeaff3d,
  allergyStorm: 0xff8ae0,
  histamineBurn: 0xff5a2a,
  highFever: 0xff3426,
  lowFever: 0xffb347,
  perforin: 0xff4dd2,
  apoptosis: 0x9b6bff,
  longChain: 0x4dc8ff,
  membraneAttack: 0xff6b9a,
  alarm: 0xff4a4a,
  potentiate: 0xffe066,
  fibrin: 0xfff1c1,
  clotSpikes: 0xff3355,
};

export interface EnemyColors {
  body: number;
  accent: number;
  glow: number;
}

export const ENEMY_COLORS: Record<EnemyId, EnemyColors> = {
  bacterium: { body: 0x8fdc52, accent: 0xd8ff7a, glow: 0xb8ff5a },
  flagellate: { body: 0xd9e24a, accent: 0xf6f88f, glow: 0xf0ff6a },
  encapsulated: { body: 0x6f9a3a, accent: 0xb5d86a, glow: 0xc8ff6a },
  virus: { body: 0x9a5cff, accent: 0xff6bd6, glow: 0xd08bff },
  spore: { body: 0xe3c446, accent: 0xfff07a, glow: 0xfff07a },
  sporeling: { body: 0xf0d860, accent: 0xfff6a0, glow: 0xfff07a },
  parasite: { body: 0xc89ee0, accent: 0x6b3f7f, glow: 0xff9ae0 },
  biofilm: { body: 0x5fbf52, accent: 0xd7ff6a, glow: 0x9dff6a },
  prion: { body: 0xb46bff, accent: 0xe2b8ff, glow: 0xc58bff },
  toxin: { body: 0xc6e84a, accent: 0x8aa82a, glow: 0xe6ff6a },
  mutant: { body: 0xd94f7a, accent: 0x5a1a3a, glow: 0xff7aa2 },
  superbug: { body: 0x56cf56, accent: 0x2b6b2b, glow: 0xb6ff5a },
  giantParasite: { body: 0xb07acc, accent: 0x5a2a70, glow: 0xff8ae0 },
  virusKing: { body: 0x7b3cff, accent: 0xffd04d, glow: 0xd07bff },
};

/** Damage-number / spark colour per hit kind. */
export const HIT_COLOR: Record<string, number> = {
  antibody: 0x7ff3ff,
  macrophage: 0x7dffc8,
  mast: 0xff7ac0,
  pyrogen: 0xffa060,
  tcell: 0xff6aa0,
  complement: 0xb9a8ff,
  beacon: 0xffe080,
  barrier: 0xffc080,
  hero: 0xffffff,
  ability: 0xffd060,
};

export const HERO_WHITE = 0xfdfcff;
export const INFECT = 0x9ee62a;
export const MARK = 0xc77dff;
export const MARK_STRONG = 0xff5ad1;
export const ATP_GOLD = 0xffd34d;
export const CURE = 0x7dffb0;
