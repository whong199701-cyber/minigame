/**
 * Text the renderer draws on its 2D overlay. `renderStrings` holds the renderer's own keys (prefix `fx_`) — merge
 * them into the game's `strings` so `ctx.t` resolves them. Display names (`tower_*`, `enemy_*`, `skill_*`) follow
 * spec §14 and are defined by the UI; `NAME_FALLBACK` only serves the dev harness (no ctx). zh / en key sets match.
 */
import type { Dict, Lang, Strings } from '../../../app/types';

export const renderStrings: Strings = {
  zh: {
    fx_wave: '第 {n} 波',
    fx_waveEndless: '无尽 · 第 {n} 波',
    fx_bossIncoming: '首领来袭 · {name}',
    fx_engulfed: '吞噬!',
    fx_execute: '处决!',
    fx_cured: '治愈',
    fx_immune: '免疫',
    fx_immuneTo: '免疫 {name}',
    fx_flowReverse: '血流逆转!',
    fx_levelUp: '升级!',
    fx_smashed: '击碎!',
    fx_broken: '屏障破裂',
    fx_waveClear: '第 {n} 波 清除',
    fx_infected: '感染!',
  },
  en: {
    fx_wave: 'Wave {n}',
    fx_waveEndless: 'Endless · wave {n}',
    fx_bossIncoming: 'Boss incoming · {name}',
    fx_engulfed: 'Engulfed!',
    fx_execute: 'Execute!',
    fx_cured: 'Cured',
    fx_immune: 'Immune',
    fx_immuneTo: 'Immune: {name}',
    fx_flowReverse: 'Flow reversed!',
    fx_levelUp: 'Level up!',
    fx_smashed: 'Smashed!',
    fx_broken: 'Barrier broken',
    fx_waveClear: 'Wave {n} cleared',
    fx_infected: 'Infected!',
  },
};

/** Spec §14 display names, used only when no `t` is supplied (dev harness). */
export const NAME_FALLBACK: Strings = {
  zh: {
    tower_antibody: '抗体发射器',
    tower_macrophage: '巨噬细胞',
    tower_mast: '肥大细胞',
    tower_pyrogen: '发热节点',
    tower_tcell: '杀伤T细胞',
    tower_complement: '补体级联',
    tower_beacon: '干扰素信标',
    tower_barrier: '血小板屏障',
    enemy_bacterium: '普通细菌',
    enemy_flagellate: '鞭毛菌',
    enemy_encapsulated: '荚膜菌',
    enemy_virus: '病毒',
    enemy_spore: '孢子',
    enemy_sporeling: '孢子体',
    enemy_parasite: '寄生虫',
    enemy_biofilm: '生物膜',
    enemy_prion: '朊病毒',
    enemy_toxin: '毒素云',
    enemy_mutant: '癌变细胞',
    enemy_superbug: '超级细菌',
    enemy_giantParasite: '噬菌巨虫',
    enemy_virusKing: '变异病毒王',
    skill_sporulation: '孢子爆发',
    skill_shellHardening: '荚膜硬化',
    skill_charge: '冲撞',
    skill_burrow: '钻入',
    skill_massInfection: '大规模感染',
    skill_mutation: '突变',
    skill_shedding: '排毒',
  },
  en: {
    tower_antibody: 'Antibody Launcher',
    tower_macrophage: 'Macrophage',
    tower_mast: 'Mast Cell',
    tower_pyrogen: 'Pyrogen Node',
    tower_tcell: 'Killer T-Cell',
    tower_complement: 'Complement Cascade',
    tower_beacon: 'Interferon Beacon',
    tower_barrier: 'Platelet Barrier',
    enemy_bacterium: 'Bacterium',
    enemy_flagellate: 'Flagellate',
    enemy_encapsulated: 'Encapsulated',
    enemy_virus: 'Virus',
    enemy_spore: 'Spore',
    enemy_sporeling: 'Sporeling',
    enemy_parasite: 'Parasite',
    enemy_biofilm: 'Biofilm',
    enemy_prion: 'Prion',
    enemy_toxin: 'Toxin Cloud',
    enemy_mutant: 'Mutant Cell',
    enemy_superbug: 'Superbug',
    enemy_giantParasite: 'Giant Parasite',
    enemy_virusKing: 'Mutant Virus King',
    skill_sporulation: 'Sporulation',
    skill_shellHardening: 'Shell Hardening',
    skill_charge: 'Charge',
    skill_burrow: 'Burrow',
    skill_massInfection: 'Mass Infection',
    skill_mutation: 'Mutation',
    skill_shedding: 'Shedding',
  },
};

export type Translate = (key: string, params?: Record<string, string | number>) => string;

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Prefers the shell's `t` (ctx.t); falls back to the local dictionaries when it returns the key unchanged. */
export function makeTranslator(lang: Lang, t?: Translate): Translate {
  const own: Dict = renderStrings[lang];
  const names: Dict = NAME_FALLBACK[lang];
  return (key, params) => {
    if (t) {
      const s = t(key, params);
      if (s && s !== key) return s;
    }
    const d = own[key] ?? names[key];
    return d === undefined ? key : interpolate(d, params);
  };
}
