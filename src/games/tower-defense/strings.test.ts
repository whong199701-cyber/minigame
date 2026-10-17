/**
 * UI string coverage: identical zh / en key sets, and every id the UI turns into a key (§14) has a translation.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strings } from './strings';
import { ABILITY_IDS, BOSS_IDS, ENEMY_IDS, MAP_IDS, TALENT_IDS, TARGETING_MODES, TOWER_IDS, TOWER_SPECS, type DeniedReason, type GameState, type Tower, type TowerId, type TowerLevel } from './types';
import { BOSS_SKILLS, createGame, defaultMemory, towerStats } from './logic';
import { place as placeAt } from './sim/testkit';

/** Places a tower of `type` on the first free legal cell (a pad, or a mid-path cell for the barrier). */
function place(s: GameState, type: TowerId): Tower {
  if (type === 'barrier') {
    const g = s.geoms[0];
    const [c, r] = g.cells[Math.floor(g.cells.length / 2)];
    return placeAt(s, c, r, type);
  }
  const free = s.map.pads.find(([c, r]) => !s.towers.some((t) => t.col === c && t.row === r))!;
  return placeAt(s, free[0], free[1], type);
}

describe('strings', () => {
  it('zh and en have identical key sets', () => {
    const zh = Object.keys(strings.zh).sort();
    const en = Object.keys(strings.en).sort();
    expect(zh).toEqual(en);
  });

  it('rules: 3–8 lines in both languages, covering the mechanics the guide and spec ask for', () => {
    for (const lang of ['zh', 'en'] as const) {
      const lines = strings[lang].rules.split('\n');
      expect(lines.length, lang).toBeGreaterThanOrEqual(3);
      expect(lines.length, lang).toBeLessThanOrEqual(8);
    }
    const en = strings.en.rules;
    for (const must of ['20 waves', 'smash', 'Toxin clouds', '2 vitality', 'Virus King', 'early', 'Booster', '×2', '×0.5', '+10 %']) expect(en, must).toContain(must);
    const zh = strings.zh.rules;
    for (const must of ['20 波', '撞碎', '毒素云', '2 点生命力', '病毒王', '提前开波', '加强针', '×2', '×0.5', '+10%']) expect(zh, must).toContain(must);
  });

  it('no hard-coded English aria-labels in the game screen', () => {
    const src = readFileSync(join(__dirname, 'ui', 'game.ts'), 'utf8');
    expect(src.match(/'aria-label': '[^']*'/g) ?? []).toEqual([]);
  });

  it('every id-derived key exists', () => {
    const need: string[] = [];
    for (const m of MAP_IDS) need.push('map_' + m, 'mapDesc_' + m);
    for (const t of TOWER_IDS) {
      need.push('tower_' + t, 'towerDesc_' + t);
      for (const s of TOWER_SPECS[t]) need.push('spec_' + s, 'specDesc_' + s);
    }
    for (const e of ENEMY_IDS) need.push('enemy_' + e, 'enemyDesc_' + e);
    for (const a of ABILITY_IDS) need.push('ability_' + a, 'abilityShort_' + a, 'abilityDesc_' + a);
    for (const t of TALENT_IDS) need.push('talent_' + t, 'talentDesc_' + t);
    for (const b of BOSS_IDS) {
      need.push('vaccine_' + b, 'bossTip_' + b);
      for (const sk of BOSS_SKILLS[b]) need.push('skill_' + sk.id);
    }
    for (const m of TARGETING_MODES) need.push('target_' + m);
    const reasons: DeniedReason[] = ['noAtp', 'occupied', 'notPad', 'notPath', 'barrierZone', 'barrierLimit', 'maxLevel', 'phase', 'cooldown', 'locked', 'heroDead', 'needTarget', 'needSpec'];
    for (const r of reasons) need.push('denied_' + r);
    for (const id of ['tut_build', 'tut_infect', 'tut_barrier', 'tut_boss', 'tut_mutation']) need.push(id);
    const missing = need.filter((k) => !(k in strings.zh) || !(k in strings.en));
    expect(missing).toEqual([]);
  });

  it('every towerStats extras key has a stat_ label', () => {
    const s = createGame({ mapId: 'gut', difficulty: 'normal', memory: defaultMemory(), seed: 1 });
    s.atp = 1e6;
    const keys = new Set<string>();
    for (const type of TOWER_IDS) {
      const tw = place(s, type);
      for (const lv of [1, 2, 3] as TowerLevel[]) {
        for (const x of towerStats(s, tw, lv, null).extras) keys.add(x.key);
        if (lv === 3) for (const sp of TOWER_SPECS[type]) for (const x of towerStats(s, tw, 3, sp).extras) keys.add(x.key);
      }
    }
    const missing = [...keys].filter((k) => !(('stat_' + k) in strings.zh));
    expect(missing).toEqual([]);
  });
});
