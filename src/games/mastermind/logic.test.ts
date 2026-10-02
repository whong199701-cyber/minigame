import { describe, expect, it } from 'vitest';
import { countConsistent, generateCode, scoreGuess, type Config } from './logic';

const cfg: Config = { length: 4, colors: 6, maxAttempts: 10, allowRepeats: true };

describe('scoreGuess', () => {
  it('counts exact matches', () => {
    expect(scoreGuess([0, 1, 2, 3], [0, 1, 2, 3])).toEqual({ exact: 4, partial: 0 });
  });
  it('counts partial matches without double counting', () => {
    expect(scoreGuess([0, 0, 1, 1], [1, 1, 0, 0])).toEqual({ exact: 0, partial: 4 });
    expect(scoreGuess([0, 0, 0, 0], [0, 1, 1, 1])).toEqual({ exact: 1, partial: 0 });
    expect(scoreGuess([0, 1, 0, 2], [0, 0, 1, 3])).toEqual({ exact: 1, partial: 2 });
  });
  it('handles no matches', () => {
    expect(scoreGuess([0, 0, 0, 0], [1, 2, 3, 4])).toEqual({ exact: 0, partial: 0 });
  });
});

describe('generateCode', () => {
  it('respects length and palette', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode(cfg);
      expect(code).toHaveLength(4);
      code.forEach((c) => expect(c >= 0 && c < 6).toBe(true));
    }
  });
  it('avoids repeats when configured', () => {
    const noRep = { ...cfg, allowRepeats: false };
    for (let i = 0; i < 50; i++) {
      const code = generateCode(noRep);
      expect(new Set(code).size).toBe(4);
    }
  });
});

describe('countConsistent', () => {
  it('counts all codes with no history', () => {
    expect(countConsistent(cfg, [])).toBe(6 ** 4);
  });
  it('shrinks with feedback and keeps the real code', () => {
    const code = [2, 5, 1, 1];
    const history = [{ guess: [0, 1, 2, 3], fb: scoreGuess([0, 1, 2, 3], code) }];
    const n = countConsistent(cfg, history);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(6 ** 4);
  });
});
