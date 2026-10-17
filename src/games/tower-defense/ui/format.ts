/**
 * UI glyphs and number formatting shared by the start, memory and game screens (no DOM state, no three.js).
 */
import type { AbilityId, BossId, EnemyId, MapId, SpecId, TowerId } from '../types';
import { TOWER_ACCENT, SPEC_COLOR, ENEMY_COLORS } from '../render/palette';

export type T = (key: string, params?: Record<string, string | number>) => string;

export const TOWER_ICON: Record<TowerId, string> = {
  antibody: '🔱',
  macrophage: '😋',
  mast: '💥',
  pyrogen: '🔥',
  tcell: '🎯',
  complement: '🔗',
  beacon: '📡',
  barrier: '🧱',
};

export const ENEMY_ICON: Record<EnemyId, string> = {
  bacterium: '🦠',
  flagellate: '💨',
  encapsulated: '🛡️',
  virus: '☣️',
  spore: '🍄',
  sporeling: '🟤',
  parasite: '🪱',
  biofilm: '🧫',
  prion: '👻',
  toxin: '☁️',
  mutant: '👾',
  superbug: '🪲',
  giantParasite: '🐍',
  virusKing: '👑',
};

export const ABILITY_ICON: Record<AbilityId, string> = {
  fever: '🌡️',
  antibiotic: '💊',
  adrenaline: '💓',
  booster: '💉',
};

export const MAP_ICON: Record<MapId, string> = {
  vessel: '🩸',
  alveoli: '🫁',
  gut: '🌀',
  brain: '🧠',
};

export const BOSS_ICON: Record<BossId, string> = {
  superbug: ENEMY_ICON.superbug,
  giantParasite: ENEMY_ICON.giantParasite,
  virusKing: ENEMY_ICON.virusKing,
};

const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');

export function towerColor(id: TowerId): string {
  return hex(TOWER_ACCENT[id]);
}

export function specColor(id: SpecId): string {
  return hex(SPEC_COLOR[id]);
}

export function enemyColor(id: EnemyId): string {
  return hex(ENEMY_COLORS[id].body);
}

/** WCAG relative luminance of a `#rrggbb` colour (0 black … 1 white). */
export function luminance(color: string): number {
  const n = parseInt(color.replace('#', ''), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio between two `#rrggbb` colours (1 … 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const INK_DARK = '#1a0a18';
const INK_LIGHT = '#ffffff';

/** Text colour (dark plum or white) with the better contrast on a solid `#rrggbb` badge background. */
export function readableInk(bg: string): string {
  return contrast(bg, INK_DARK) >= contrast(bg, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

/** How a towerStats extras key is displayed (spec §2 fractions are fractions). */
type StatKind = 'pct' | 'sec' | 'mult' | 'cells' | 'num' | 'flag' | 'neg';

const STAT_KIND: Record<string, StatKind> = {
  splash: 'cells',
  slow: 'pct',
  slowDuration: 'sec',
  stun: 'sec',
  auraDps: 'num',
  targets: 'num',
  jump: 'cells',
  jumpMarked: 'cells',
  falloff: 'neg',
  vsRegen: 'mult',
  suppress: 'sec',
  engulfThreshold: 'num',
  engulfCooldown: 'sec',
  digest: 'sec',
  acidSplash: 'pct',
  acidDps: 'pct',
  buffRate: 'pct',
  buffDmg: 'pct',
  buffRange: 'cells',
  cureEvery: 'sec',
  reveal: 'cells',
  globalRate: 'pct',
  globalDmg: 'pct',
  hp: 'num',
  regen: 'num',
  reflect: 'num',
  contactDps: 'num',
  burnDps: 'num',
  burnDuration: 'sec',
  extraTargets: 'num',
  markBonus: 'pct',
  markDuration: 'sec',
  execute: 'pct',
  vsMarked: 'mult',
  vsBoss: 'mult',
  vsSpawned: 'mult',
  ignoresArmor: 'flag',
};

export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '–';
  if (Math.abs(v) >= 100) return String(Math.round(v));
  if (Math.abs(v) >= 10) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 100) / 100);
}

/** Formats one extras value; `t` resolves the flag word. */
export function fmtStat(key: string, value: number, t: T): string {
  const kind = STAT_KIND[key] ?? 'num';
  switch (kind) {
    case 'pct':
      return `${Math.round(value * 1000) / 10}%`;
    case 'neg':
      return `−${Math.round(value * 1000) / 10}%`;
    case 'sec':
      return `${fmtNum(value)}s`;
    case 'mult':
      return `×${fmtNum(value)}`;
    case 'cells':
      return fmtNum(value);
    case 'flag':
      return t('yes');
    default:
      return fmtNum(value);
  }
}

/**
 * The wave a saved run continues with. A run is saved in `build` / `countdown`, after `state.wave` was cleared (0 before
 * wave 1), so the start screen names the next wave: after clearing wave 20 and choosing endless it says 21, not 20.
 */
export function savedNextWave(save: { state: { wave: number } }): number {
  const w = Number.isFinite(save.state.wave) ? Math.floor(save.state.wave) : 0;
  return Math.max(1, w + 1);
}

export function starsText(n: number, max = 3): string {
  return '★'.repeat(Math.max(0, Math.min(max, n))) + '☆'.repeat(Math.max(0, max - Math.max(0, Math.min(max, n))));
}

export function fmtDate(ms: number, lang: 'zh' | 'en'): string {
  try {
    return new Date(ms).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** Drops null / false children (Element.append does not accept them). */
export function nodes(...items: (Node | null | undefined | false)[]): Node[] {
  return items.filter((x): x is Node => !!x);
}
