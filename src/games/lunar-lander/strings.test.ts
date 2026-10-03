// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { common } from '../../app/i18n';
import { CRASH_REASONS } from './logic';
import { strings } from './strings';

const zh = strings.zh as Record<string, string>;
const en = strings.en as Record<string, string>;
const src = fs.readFileSync(path.resolve(process.cwd(), 'src/games/lunar-lander/index.ts'), 'utf8');

describe('lunar-lander strings', () => {
  it('zh and en have identical, non-empty keys and matching placeholders', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(zh)) {
      expect(zh[k].trim().length, k).toBeGreaterThan(0);
      expect(en[k].trim().length, k).toBeGreaterThan(0);
      expect(ph(zh[k]), k).toEqual(ph(en[k]));
    }
  });

  it('rules explain the game in 3–8 lines', () => {
    for (const d of [zh, en]) {
      const lines = d.rules.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.length).toBeLessThanOrEqual(8);
    }
  });

  it('has a crash message for every crash reason the physics can report', () => {
    for (const r of CRASH_REASONS) {
      const key = 'reason' + r[0].toUpperCase() + r.slice(1);
      expect(zh[key], `zh ${key}`).toBeTruthy();
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(src.includes(`'${key}'`), `index.ts uses ${key}`).toBe(true);
      expect(src.includes(`case '${r}':`), `reasonText handles ${r}`).toBe(true);
    }
  });

  it('every key the UI uses resolves in both languages', () => {
    const used = new Set<string>();
    for (const m of src.matchAll(/\bt\(\s*'(\w+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bt\([^()]*?\?\s*'(\w+)'\s*:\s*'(\w+)'\s*\)/g)) {
      used.add(m[1]);
      used.add(m[2]);
    }
    expect(used.size).toBeGreaterThan(40);
    for (const k of used) {
      expect(k in zh || k in common.zh, `zh missing ${k}`).toBe(true);
      expect(k in en || k in common.en, `en missing ${k}`).toBe(true);
    }
  });

  it('keeps visible text out of index.ts (no CJK literals) and English free of CJK', () => {
    expect(/[一-鿿]/.test(src)).toBe(false);
    for (const [k, v] of Object.entries(en)) expect(/[一-鿿]/.test(v), k).toBe(false);
  });
});
