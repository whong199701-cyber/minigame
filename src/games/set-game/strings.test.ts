import { describe, expect, it } from 'vitest';
import { strings } from './strings';

describe('strings', () => {
  it('zh and en have identical keys', () => {
    expect(Object.keys(strings.zh).sort()).toEqual(Object.keys(strings.en).sort());
  });
  it('has a thorough rules entry (3–8 lines) in both languages', () => {
    for (const lang of ['zh', 'en'] as const) {
      const lines = strings[lang].rules.split('\n').filter((l) => l.trim());
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.length).toBeLessThanOrEqual(8);
    }
  });
  it('uses the same placeholders in both languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(strings.en) as (keyof typeof strings.en)[]) {
      expect(ph(strings.zh[k]), k).toEqual(ph(strings.en[k]));
    }
  });
  it('no empty strings', () => {
    for (const lang of ['zh', 'en'] as const) for (const v of Object.values(strings[lang])) expect(v.trim().length).toBeGreaterThan(0);
  });
});
