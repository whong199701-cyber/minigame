// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { common } from '../../app/i18n';
import { MODES, introKey, type Mode } from './logic';
import { strings } from './strings';

const zh = strings.zh as Record<string, string>;
const en = strings.en as Record<string, string>;

describe('strings', () => {
  it('zh and en have identical, non-empty keys and matching placeholders', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(zh)) {
      expect(zh[k].trim().length).toBeGreaterThan(0);
      expect(en[k].trim().length).toBeGreaterThan(0);
      expect(ph(zh[k])).toEqual(ph(en[k]));
    }
  });

  it('rules explain the game in 3–8 lines', () => {
    for (const d of [zh, en]) {
      const lines = d.rules.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.length).toBeLessThanOrEqual(8);
    }
  });

  it('every key the UI uses resolves in both languages', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/games/bullet-dodge/index.ts'), 'utf8');
    const used = new Set<string>();
    for (const m of src.matchAll(/\bt\(\s*'(\w+)'/g)) used.add(m[1]);
    // Conditional keys: t(cond ? 'a' : 'b')
    let ternaries = 0;
    for (const m of src.matchAll(/\bt\([^()]*?\?\s*'(\w+)'\s*:\s*'(\w+)'\s*\)/g)) {
      used.add(m[1]);
      used.add(m[2]);
      ternaries++;
    }
    expect(ternaries).toBeGreaterThanOrEqual(3);
    for (const mode of ['easy', 'normal', 'hard'] as Mode[]) {
      used.add(mode);
      used.add(mode + 'Desc');
      for (let p = 1; p <= 20; p++) used.add(introKey(p, MODES[mode]));
    }
    expect(used.size).toBeGreaterThan(30);
    for (const k of used) {
      expect(k in zh || k in common.zh, `zh missing ${k}`).toBe(true);
      expect(k in en || k in common.en, `en missing ${k}`).toBe(true);
    }
  });
});
