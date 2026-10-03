import { describe, expect, it } from 'vitest';
import {
  ALL_CHANNELS,
  BASE_TRIALS,
  COLORS,
  DEFAULT_TIMING,
  LETTERS,
  MAX_MATCH_RUN,
  MAX_N,
  MIN_N,
  MODES,
  POSITIONS,
  Round,
  accuracyOf,
  channelSize,
  channelsFor,
  clampN,
  classify,
  computeMatches,
  countMatches,
  generateSequence,
  isCleared,
  isMatch,
  isMode,
  mulberry32,
  nextN,
  pickMatchSlots,
  roundDuration,
  scoreChannel,
  scoreRound,
  targetMatchCount,
  trialCount,
  trialStartMs,
  trialStateAt,
  type Channel,
  type Stimulus,
} from './logic';

/** Build a sequence from position / letter / colour arrays (missing channels default to 0). */
function seqOf(pos: number[], letter: number[] = [], color: number[] = []): Stimulus[] {
  return pos.map((p, i) => ({ pos: p, letter: letter[i] ?? 0, color: color[i] ?? 0 }));
}

describe('modes and constants', () => {
  it('maps modes to channels', () => {
    expect(channelsFor('single')).toEqual(['position']);
    expect(channelsFor('dual')).toEqual(['position', 'letter']);
    expect(channelsFor('triple')).toEqual(['position', 'letter', 'color']);
  });
  it('validates modes', () => {
    for (const m of MODES) expect(isMode(m)).toBe(true);
    expect(isMode('quad')).toBe(false);
    expect(isMode(null)).toBe(false);
  });
  it('uses 8 consonant letters and channel sizes match', () => {
    expect(LETTERS).toHaveLength(8);
    for (const l of LETTERS) expect('AEIOU').not.toContain(l);
    expect(new Set(LETTERS).size).toBe(8);
    expect(channelSize('position')).toBe(POSITIONS);
    expect(channelSize('letter')).toBe(8);
    expect(channelSize('color')).toBe(COLORS);
  });
  it('round length is 20 + N', () => {
    expect(trialCount(1)).toBe(21);
    expect(trialCount(2)).toBe(22);
    expect(trialCount(7)).toBe(27);
  });
  it('clamps N into range', () => {
    expect(clampN(0)).toBe(MIN_N);
    expect(clampN(99)).toBe(MAX_N);
    expect(clampN(3.4)).toBe(3);
    expect(clampN(Number.NaN)).toBe(2);
  });
});

describe('match computation', () => {
  it('detects 1-back matches', () => {
    const seq = seqOf([0, 0, 1, 1, 1, 2]);
    expect(computeMatches(seq, 1, 'position')).toEqual([false, true, false, true, true, false]);
  });
  it('detects 2-back matches', () => {
    const seq = seqOf([3, 5, 3, 5, 4, 5]);
    expect(computeMatches(seq, 2, 'position')).toEqual([false, false, true, true, false, true]);
  });
  it('never matches in the first N trials', () => {
    const seq = seqOf([1, 1, 1, 1]);
    expect(isMatch(seq, 0, 1, 'position')).toBe(false);
    expect(isMatch(seq, 2, 3, 'position')).toBe(false);
    expect(isMatch(seq, 3, 3, 'position')).toBe(true);
    expect(isMatch(seq, 4, 1, 'position')).toBe(false); // out of range
  });
  it('treats channels independently', () => {
    const seq = seqOf([0, 4, 0, 4], [2, 2, 3, 2], [1, 0, 1, 0]);
    expect(computeMatches(seq, 2, 'position')).toEqual([false, false, true, true]);
    expect(computeMatches(seq, 2, 'letter')).toEqual([false, false, false, true]);
    expect(computeMatches(seq, 2, 'color')).toEqual([false, false, true, true]);
    expect(computeMatches(seq, 1, 'letter')).toEqual([false, true, false, false]);
  });
  it('computes the target match count (30% of the scorable trials)', () => {
    expect(targetMatchCount(1)).toBe(6);
    expect(targetMatchCount(2)).toBe(6);
    expect(targetMatchCount(9)).toBe(6);
    expect(targetMatchCount(2, 12)).toBe(3);
    expect(targetMatchCount(5, 3)).toBe(0);
  });
});

describe('pickMatchSlots', () => {
  it('picks k distinct sorted slots in range', () => {
    const rand = mulberry32(1);
    for (let t = 0; t < 50; t++) {
      const s = pickMatchSlots(3, 23, 6, rand);
      expect(s).toHaveLength(6);
      expect(new Set(s).size).toBe(6);
      expect(s.every((i) => i >= 3 && i < 23)).toBe(true);
      expect([...s].sort((a, b) => a - b)).toEqual(s);
    }
  });
  it('caps k to the available pool', () => {
    expect(pickMatchSlots(0, 3, 10, mulberry32(2), 5)).toEqual([0, 1, 2]);
    expect(pickMatchSlots(0, 3, -1, mulberry32(2))).toEqual([]);
  });
});

describe('generateSequence', () => {
  it('produces 20 + N valid stimuli', () => {
    const rand = mulberry32(42);
    for (let n = MIN_N; n <= MAX_N; n++) {
      const seq = generateSequence(n, rand);
      expect(seq).toHaveLength(BASE_TRIALS + n);
      for (const s of seq) {
        expect(Number.isInteger(s.pos) && s.pos >= 0 && s.pos < POSITIONS).toBe(true);
        expect(Number.isInteger(s.letter) && s.letter >= 0 && s.letter < LETTERS.length).toBe(true);
        expect(Number.isInteger(s.color) && s.color >= 0 && s.color < COLORS).toBe(true);
      }
    }
  });

  it('has ~30% matches per channel and no accidental extra matches', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const n = 1 + (seed % 9);
      const seq = generateSequence(n, mulberry32(seed));
      const eligible = seq.length - n;
      for (const ch of ALL_CHANNELS) {
        const m = countMatches(seq, n, ch);
        expect(m).toBe(targetMatchCount(n));
        const ratio = m / eligible;
        expect(ratio).toBeGreaterThanOrEqual(0.25);
        expect(ratio).toBeLessThanOrEqual(0.35);
      }
    }
  });

  it('works with Math.random too', () => {
    for (let i = 0; i < 100; i++) {
      const n = 1 + (i % 6);
      const seq = generateSequence(n);
      for (const ch of ALL_CHANNELS) expect(countMatches(seq, n, ch)).toBe(6);
    }
  });

  it('limits runs of consecutive matches', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const seq = generateSequence(2, mulberry32(seed));
      for (const ch of ALL_CHANNELS) {
        const m = computeMatches(seq, 2, ch);
        let run = 0;
        let best = 0;
        for (const x of m) {
          run = x ? run + 1 : 0;
          best = Math.max(best, run);
        }
        expect(best).toBeLessThanOrEqual(MAX_MATCH_RUN);
      }
    }
  });

  it('keeps position+letter double matches the exception', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const n = 1 + (seed % 5);
      const seq = generateSequence(n, mulberry32(seed));
      const p = computeMatches(seq, n, 'position');
      const l = computeMatches(seq, n, 'letter');
      const both = p.filter((x, i) => x && l[i]).length;
      expect(both).toBeLessThanOrEqual(3);
    }
  });

  it('is deterministic for a seeded generator and varies between seeds', () => {
    const a = generateSequence(3, mulberry32(7));
    const b = generateSequence(3, mulberry32(7));
    const c = generateSequence(3, mulberry32(8));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('uses the whole grid and the whole letter set over many rounds', () => {
    const rand = mulberry32(99);
    const posSeen = new Set<number>();
    const letSeen = new Set<number>();
    const colSeen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      for (const s of generateSequence(2, rand)) {
        posSeen.add(s.pos);
        letSeen.add(s.letter);
        colSeen.add(s.color);
      }
    }
    expect(posSeen.size).toBe(POSITIONS);
    expect(letSeen.size).toBe(LETTERS.length);
    expect(colSeen.size).toBe(COLORS);
  });

  it('respects a custom match rate', () => {
    const seq = generateSequence(2, mulberry32(5), { rate: 0.5 });
    expect(countMatches(seq, 2, 'position')).toBe(10);
  });
});

describe('scoring', () => {
  it('classifies responses', () => {
    expect(classify(true, true)).toBe('hit');
    expect(classify(true, false)).toBe('miss');
    expect(classify(false, true)).toBe('falseAlarm');
    expect(classify(false, false)).toBe('correctRejection');
  });

  it('accuracy = hits / (matches + false alarms)', () => {
    expect(accuracyOf(6, 6, 0)).toBe(1);
    expect(accuracyOf(5, 6, 1)).toBeCloseTo(5 / 7);
    expect(accuracyOf(0, 6, 4)).toBe(0);
    expect(accuracyOf(0, 0, 0)).toBe(1);
    expect(accuracyOf(0, 0, 3)).toBe(0);
  });

  it('scores a channel', () => {
    const matches = [false, false, true, true, false, true];
    const pressed = [false, true, true, false, false, true];
    const st = scoreChannel(matches, pressed);
    expect(st).toMatchObject({ matches: 3, hits: 2, misses: 1, falseAlarms: 1, correctRejections: 2 });
    expect(st.accuracy).toBeCloseTo(2 / 4);
    // Partial scoring only counts the first trials.
    expect(scoreChannel(matches, pressed, 3)).toMatchObject({ matches: 1, hits: 1, falseAlarms: 1 });
  });

  it('scores a dual round across channels', () => {
    // n = 1: position matches at 1, 3; letter matches at 2.
    const seq = seqOf([4, 4, 0, 0], [1, 2, 2, 3]);
    const pressed = {
      position: [false, true, false, false], // hit at 1, miss at 3
      letter: [false, false, true, true], // hit at 2, false alarm at 3
    };
    const r = scoreRound(seq, 1, ['position', 'letter'], pressed);
    expect(r.perChannel.position).toMatchObject({ hits: 1, misses: 1, falseAlarms: 0, matches: 2 });
    expect(r.perChannel.letter).toMatchObject({ hits: 1, misses: 0, falseAlarms: 1, matches: 1 });
    expect(r.hits).toBe(2);
    expect(r.matches).toBe(3);
    expect(r.misses).toBe(1);
    expect(r.falseAlarms).toBe(1);
    expect(r.accuracy).toBeCloseTo(2 / 4);
    expect(r.perChannel.color).toBeUndefined();
  });

  it('ignores channels that are not part of the mode', () => {
    const seq = seqOf([1, 1], [0, 0], [2, 2]);
    const r = scoreRound(seq, 1, ['position'], { position: [false, true], letter: [false, false] });
    expect(r.matches).toBe(1);
    expect(r.accuracy).toBe(1);
  });
});

describe('adaptive rule', () => {
  it('moves up at ≥ 80%', () => {
    expect(nextN(2, 0.8)).toEqual({ next: 3, change: 1 });
    expect(nextN(2, 1)).toEqual({ next: 3, change: 1 });
    expect(nextN(2, 4 / 5)).toEqual({ next: 3, change: 1 });
  });
  it('stays between 50% and 80%', () => {
    expect(nextN(3, 0.79)).toEqual({ next: 3, change: 0 });
    expect(nextN(3, 0.5)).toEqual({ next: 3, change: 0 });
  });
  it('moves down below 50% but never below 1', () => {
    expect(nextN(3, 0.49)).toEqual({ next: 2, change: -1 });
    expect(nextN(1, 0)).toEqual({ next: 1, change: 0 });
  });
  it('never exceeds MAX_N', () => {
    expect(nextN(MAX_N, 1)).toEqual({ next: MAX_N, change: 0 });
  });
  it('cleared means promotion-worthy', () => {
    expect(isCleared(0.8)).toBe(true);
    expect(isCleared(0.7999)).toBe(false);
  });
});

describe('trial timing state machine', () => {
  const T = DEFAULT_TIMING;
  const total = 22;

  it('starts with a 3-2-1 lead-in', () => {
    expect(trialStateAt(0, total)).toMatchObject({ phase: 'lead', trial: -1, countdown: 3, progress: 0 });
    expect(trialStateAt(999, total).countdown).toBe(3);
    expect(trialStateAt(1000, total).countdown).toBe(2);
    expect(trialStateAt(2500, total).countdown).toBe(1);
    expect(trialStateAt(-50, total).phase).toBe('lead');
  });

  it('shows the stimulus for 1 s every 2.5 s', () => {
    expect(trialStateAt(T.leadMs, total)).toMatchObject({ phase: 'stimulus', trial: 0, timeInTrial: 0 });
    expect(trialStateAt(T.leadMs + 999, total)).toMatchObject({ phase: 'stimulus', trial: 0 });
    expect(trialStateAt(T.leadMs + 1000, total)).toMatchObject({ phase: 'gap', trial: 0 });
    expect(trialStateAt(T.leadMs + 2499, total)).toMatchObject({ phase: 'gap', trial: 0 });
    expect(trialStateAt(T.leadMs + 2500, total)).toMatchObject({ phase: 'stimulus', trial: 1, timeInTrial: 0 });
    expect(trialStateAt(T.leadMs + 5 * 2500 + 1200, total)).toMatchObject({ phase: 'gap', trial: 5, timeInTrial: 1200 });
  });

  it('finishes after the last trial', () => {
    const end = roundDuration(total);
    expect(end).toBe(T.leadMs + total * T.trialMs);
    expect(trialStateAt(end - 1, total)).toMatchObject({ phase: 'gap', trial: total - 1 });
    expect(trialStateAt(end, total)).toMatchObject({ phase: 'done', trial: total, progress: 1 });
    expect(trialStateAt(end + 99999, total).phase).toBe('done');
  });

  it('progress is monotonic and bounded', () => {
    let prev = -1;
    for (let e = 0; e <= roundDuration(total) + 100; e += 37) {
      const s = trialStateAt(e, total);
      expect(s.progress).toBeGreaterThanOrEqual(prev);
      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(1);
      prev = s.progress;
    }
  });

  it('visits every trial exactly once in order', () => {
    const seen: number[] = [];
    for (let e = 0; e < roundDuration(total); e += 16) {
      const s = trialStateAt(e, total);
      if (s.trial >= 0 && seen[seen.length - 1] !== s.trial) seen.push(s.trial);
    }
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => i));
  });

  it('supports custom timing and trial start lookup', () => {
    const fast = { leadMs: 1000, trialMs: 2000, stimulusMs: 500 };
    expect(trialStateAt(1600, 5, fast)).toMatchObject({ phase: 'gap', trial: 0 });
    expect(trialStateAt(3000, 5, fast)).toMatchObject({ phase: 'stimulus', trial: 1 });
    expect(trialStartMs(3, fast)).toBe(7000);
    expect(trialStateAt(trialStartMs(4), total)).toMatchObject({ trial: 4, timeInTrial: 0 });
  });

  it('handles an empty round', () => {
    expect(trialStateAt(T.leadMs, 0).phase).toBe('done');
  });
});

describe('Round', () => {
  // n = 2; position matches at 2, 4; letter matches at 3.
  const seq = seqOf([0, 1, 0, 5, 0, 6], [3, 4, 5, 4, 1, 2], [0, 1, 2, 0, 1, 2]);

  it('precomputes matches', () => {
    const r = new Round(seq, 2, ['position', 'letter']);
    expect(r.matches.position).toEqual([false, false, true, false, true, false]);
    expect(r.matches.letter).toEqual([false, false, false, true, false, false]);
  });

  it('classifies presses and ignores duplicates / inactive channels / closed trials', () => {
    const r = new Round(seq, 2, ['position', 'letter']);
    expect(r.respond(0, 'position')).toBe('falseAlarm');
    expect(r.respond(0, 'position')).toBe('duplicate');
    expect(r.respond(0, 'color')).toBe('ignored');
    expect(r.respond(-1, 'position')).toBe('ignored');
    expect(r.respond(99, 'position')).toBe('ignored');
    r.closeTrial(0);
    r.closeTrial(1);
    expect(r.respond(1, 'letter')).toBe('ignored');
    expect(r.respond(2, 'position')).toBe('hit');
  });

  it('reports misses when a trial closes', () => {
    const r = new Round(seq, 2, ['position', 'letter']);
    expect(r.closeTrial(2)).toEqual(['position']);
    r.respond(3, 'letter');
    expect(r.closeTrial(3)).toEqual([]);
    expect(r.closeTrial(99)).toEqual([]);
  });

  it('knows whether a trial was answered correctly', () => {
    const r = new Round(seq, 2, ['position', 'letter']);
    expect(r.trialCorrect(0)).toBe(true);
    expect(r.trialCorrect(2)).toBe(false);
    r.respond(2, 'position');
    expect(r.trialCorrect(2)).toBe(true);
    r.respond(5, 'letter');
    expect(r.trialCorrect(5)).toBe(false);
  });

  it('perfect play scores 100% and promotes', () => {
    const big = generateSequence(3, mulberry32(11));
    const chans: Channel[] = ['position', 'letter', 'color'];
    const r = new Round(big, 3, chans);
    for (let i = 0; i < r.total; i++) {
      for (const ch of chans) if (r.matches[ch][i]) expect(r.respond(i, ch)).toBe('hit');
      expect(r.closeTrial(i)).toEqual([]);
      expect(r.trialCorrect(i)).toBe(true);
    }
    const s = r.score();
    expect(s.accuracy).toBe(1);
    expect(s.matches).toBe(18);
    expect(nextN(3, s.accuracy).change).toBe(1);
  });

  it('pressing everything is punished and demotes', () => {
    const big = generateSequence(2, mulberry32(12));
    const r = new Round(big, 2, ['position', 'letter']);
    for (let i = 0; i < r.total; i++) {
      r.respond(i, 'position');
      r.respond(i, 'letter');
      r.closeTrial(i);
    }
    const s = r.score();
    expect(s.hits).toBe(12);
    expect(s.falseAlarms).toBe(2 * r.total - 12);
    expect(s.accuracy).toBeCloseTo(12 / (12 + 2 * r.total - 12));
    expect(nextN(2, s.accuracy).change).toBe(-1);
  });

  it('doing nothing scores 0 and demotes', () => {
    const big = generateSequence(4, mulberry32(13));
    const r = new Round(big, 4, ['position']);
    for (let i = 0; i < r.total; i++) r.closeTrial(i);
    const s = r.score();
    expect(s.misses).toBe(6);
    expect(s.accuracy).toBe(0);
    expect(nextN(4, s.accuracy)).toEqual({ next: 3, change: -1 });
  });

  it('scores only closed trials by default', () => {
    const r = new Round(seq, 2, ['position']);
    r.closeTrial(0);
    r.closeTrial(1);
    r.closeTrial(2);
    expect(r.score().matches).toBe(1);
    expect(r.score(r.total).matches).toBe(2);
  });
});
