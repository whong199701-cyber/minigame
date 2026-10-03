/**
 * Pure logic for Dual N-Back: sequence generation, match computation, scoring, the adaptive rule and the
 * trial timing state machine. No DOM access here so everything can be unit tested.
 */

export type Mode = 'single' | 'dual' | 'triple';
export type Channel = 'position' | 'letter' | 'color';

export const MODES: readonly Mode[] = ['single', 'dual', 'triple'];
export const ALL_CHANNELS: readonly Channel[] = ['position', 'letter', 'color'];

/** Eight easily distinguished consonants (the classic Brain Workshop set). */
export const LETTERS: readonly string[] = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'];
export const POSITIONS = 9;
export const COLORS = 3;

export const MIN_N = 1;
export const MAX_N = 12;
export const DEFAULT_N = 2;

/** A round is BASE_TRIALS + N trials, so every round has exactly BASE_TRIALS scorable trials. */
export const BASE_TRIALS = 20;
/** Share of scorable trials that are matches, per channel. */
export const MATCH_RATE = 0.3;
/** Never more than this many consecutive matches in one channel. */
export const MAX_MATCH_RUN = 3;

export const UP_THRESHOLD = 0.8;
export const DOWN_THRESHOLD = 0.5;

export interface Timing {
  /** Countdown before the first stimulus. */
  leadMs: number;
  /** Stimulus onset to stimulus onset. */
  trialMs: number;
  /** How long the stimulus stays visible at the start of each trial. */
  stimulusMs: number;
}

export const DEFAULT_TIMING: Timing = { leadMs: 3000, trialMs: 2500, stimulusMs: 1000 };

export interface Stimulus {
  /** 0..8, row-major over the 3×3 grid. */
  pos: number;
  /** Index into LETTERS. */
  letter: number;
  /** 0..COLORS-1. */
  color: number;
}

export function channelsFor(mode: Mode): Channel[] {
  if (mode === 'single') return ['position'];
  if (mode === 'dual') return ['position', 'letter'];
  return ['position', 'letter', 'color'];
}

export function isMode(v: unknown): v is Mode {
  return v === 'single' || v === 'dual' || v === 'triple';
}

export function clampN(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_N;
  return Math.max(MIN_N, Math.min(MAX_N, Math.round(n)));
}

export function trialCount(n: number): number {
  return BASE_TRIALS + n;
}

/** Number of distinct values a channel can take. */
export function channelSize(ch: Channel): number {
  return ch === 'position' ? POSITIONS : ch === 'letter' ? LETTERS.length : COLORS;
}

export function valueOf(s: Stimulus, ch: Channel): number {
  return ch === 'position' ? s.pos : ch === 'letter' ? s.letter : s.color;
}

function withValue(s: Stimulus, ch: Channel, v: number): void {
  if (ch === 'position') s.pos = v;
  else if (ch === 'letter') s.letter = v;
  else s.color = v;
}

/** Does trial `i` match trial `i - n` on channel `ch`? The first n trials can never match. */
export function isMatch(seq: readonly Stimulus[], i: number, n: number, ch: Channel): boolean {
  if (i < n || i >= seq.length || n < 1) return false;
  return valueOf(seq[i], ch) === valueOf(seq[i - n], ch);
}

export function computeMatches(seq: readonly Stimulus[], n: number, ch: Channel): boolean[] {
  return seq.map((_, i) => isMatch(seq, i, n, ch));
}

export function countMatches(seq: readonly Stimulus[], n: number, ch: Channel): number {
  return computeMatches(seq, n, ch).filter(Boolean).length;
}

/** How many matches a channel gets in a sequence of `total` trials. */
export function targetMatchCount(n: number, total: number = trialCount(n), rate: number = MATCH_RATE): number {
  const eligible = Math.max(0, total - n);
  return Math.min(eligible, Math.round(eligible * rate));
}

/** mulberry32: small deterministic PRNG for reproducible sequences in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand: () => number, k: number): number {
  return Math.min(k - 1, Math.floor(rand() * k));
}

function longestRun(indices: number[]): number {
  const sorted = [...indices].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** Pick `k` distinct indices from [from, to) with no run of consecutive indices longer than `maxRun`. */
export function pickMatchSlots(from: number, to: number, k: number, rand: () => number, maxRun = MAX_MATCH_RUN): number[] {
  const pool: number[] = [];
  for (let i = from; i < to; i++) pool.push(i);
  k = Math.max(0, Math.min(k, pool.length));
  let pick: number[] = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    const p = pool.slice();
    for (let i = p.length - 1; i > 0; i--) {
      const j = randInt(rand, i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    pick = p.slice(0, k);
    if (longestRun(pick) <= maxRun) break;
  }
  return pick.sort((a, b) => a - b);
}

export interface GenerateOptions {
  rate?: number;
  maxRun?: number;
}

/**
 * Generate a round's stimulus sequence. For every channel exactly `targetMatchCount` of the scorable trials
 * (index ≥ n) are N-back matches; every other scorable trial is forced to differ from its N-back partner, so
 * there are no accidental matches at all. Position and letter matches overlap on at most half of the matches
 * so "both" trials stay the exception rather than the rule.
 */
export function generateSequence(n: number, rand: () => number = Math.random, opts: GenerateOptions = {}): Stimulus[] {
  const total = trialCount(n);
  const k = targetMatchCount(n, total, opts.rate ?? MATCH_RATE);
  const maxRun = opts.maxRun ?? MAX_MATCH_RUN;
  const maxOverlap = Math.ceil(k / 2);

  const slots = {} as Record<Channel, Set<number>>;
  let pos: number[] = [];
  let letter: number[] = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    pos = pickMatchSlots(n, total, k, rand, maxRun);
    letter = pickMatchSlots(n, total, k, rand, maxRun);
    const overlap = letter.filter((i) => pos.includes(i)).length;
    if (overlap <= maxOverlap) break;
  }
  slots.position = new Set(pos);
  slots.letter = new Set(letter);
  slots.color = new Set(pickMatchSlots(n, total, k, rand, maxRun));

  const seq: Stimulus[] = [];
  for (let i = 0; i < total; i++) {
    const s: Stimulus = { pos: 0, letter: 0, color: 0 };
    for (const ch of ALL_CHANNELS) {
      const size = channelSize(ch);
      let v: number;
      if (i < n) {
        v = randInt(rand, size);
      } else {
        const prev = valueOf(seq[i - n], ch);
        if (slots[ch].has(i)) {
          v = prev;
        } else {
          // Uniform over the other size-1 values.
          v = randInt(rand, size - 1);
          if (v >= prev) v++;
        }
      }
      withValue(s, ch, v);
    }
    seq.push(s);
  }
  return seq;
}

// ── Scoring ──────────────────────────────────────────────────────────────

export type Outcome = 'hit' | 'miss' | 'falseAlarm' | 'correctRejection';

export function classify(match: boolean, pressed: boolean): Outcome {
  if (match) return pressed ? 'hit' : 'miss';
  return pressed ? 'falseAlarm' : 'correctRejection';
}

export interface ChannelStats {
  matches: number;
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
  accuracy: number;
}

export interface RoundScore {
  perChannel: Partial<Record<Channel, ChannelStats>>;
  hits: number;
  matches: number;
  misses: number;
  falseAlarms: number;
  /** hits / (matches + false alarms), 0..1. */
  accuracy: number;
}

/** Accuracy = correct responses / (matches + false alarms). With nothing to respond to and no errors it is 1. */
export function accuracyOf(hits: number, matches: number, falseAlarms: number): number {
  const denom = matches + falseAlarms;
  if (denom <= 0) return 1;
  return Math.max(0, Math.min(1, hits / denom));
}

export function scoreChannel(matches: readonly boolean[], pressed: readonly boolean[], upTo = matches.length): ChannelStats {
  const st: ChannelStats = { matches: 0, hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0, accuracy: 1 };
  for (let i = 0; i < Math.min(upTo, matches.length); i++) {
    const o = classify(matches[i], !!pressed[i]);
    if (matches[i]) st.matches++;
    if (o === 'hit') st.hits++;
    else if (o === 'miss') st.misses++;
    else if (o === 'falseAlarm') st.falseAlarms++;
    else st.correctRejections++;
  }
  st.accuracy = accuracyOf(st.hits, st.matches, st.falseAlarms);
  return st;
}

export function scoreRound(
  seq: readonly Stimulus[],
  n: number,
  channels: readonly Channel[],
  pressed: Partial<Record<Channel, readonly boolean[]>>,
  upTo = seq.length,
): RoundScore {
  const perChannel: Partial<Record<Channel, ChannelStats>> = {};
  let hits = 0;
  let matches = 0;
  let misses = 0;
  let falseAlarms = 0;
  for (const ch of channels) {
    const st = scoreChannel(computeMatches(seq, n, ch), pressed[ch] ?? [], upTo);
    perChannel[ch] = st;
    hits += st.hits;
    matches += st.matches;
    misses += st.misses;
    falseAlarms += st.falseAlarms;
  }
  return { perChannel, hits, matches, misses, falseAlarms, accuracy: accuracyOf(hits, matches, falseAlarms) };
}

export interface Decision {
  next: number;
  change: -1 | 0 | 1;
}

/** Adaptive rule: ≥ 80% → N+1, < 50% → N−1 (never below MIN_N, never above MAX_N), otherwise stay. */
export function nextN(n: number, accuracy: number): Decision {
  if (accuracy >= UP_THRESHOLD - 1e-9 && n < MAX_N) return { next: n + 1, change: 1 };
  if (accuracy < DOWN_THRESHOLD - 1e-9 && n > MIN_N) return { next: n - 1, change: -1 };
  return { next: n, change: 0 };
}

/** A round counts as "cleared" (for the best-N record) when it would promote the player. */
export function isCleared(accuracy: number): boolean {
  return accuracy >= UP_THRESHOLD - 1e-9;
}

// ── Timing state machine ─────────────────────────────────────────────────

export type Phase = 'lead' | 'stimulus' | 'gap' | 'done';

export interface TrialState {
  phase: Phase;
  /** Current trial index; -1 during the lead-in, `total` once done. */
  trial: number;
  /** ms since the current trial's onset (0 during lead / done). */
  timeInTrial: number;
  /** Seconds left in the lead-in countdown (3, 2, 1), 0 otherwise. */
  countdown: number;
  /** Overall progress of the scored part of the round, 0..1. */
  progress: number;
}

export function roundDuration(total: number, timing: Timing = DEFAULT_TIMING): number {
  return timing.leadMs + total * timing.trialMs;
}

/** The whole trial timeline is a pure function of elapsed (unpaused) time. */
export function trialStateAt(elapsedMs: number, total: number, timing: Timing = DEFAULT_TIMING): TrialState {
  const e = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const { leadMs, trialMs, stimulusMs } = timing;
  if (e < leadMs) {
    return { phase: 'lead', trial: -1, timeInTrial: 0, countdown: Math.max(1, Math.ceil((leadMs - e) / 1000)), progress: 0 };
  }
  const t = e - leadMs;
  const run = total * trialMs;
  if (total <= 0 || t >= run) return { phase: 'done', trial: Math.max(0, total), timeInTrial: 0, countdown: 0, progress: 1 };
  const trial = Math.min(total - 1, Math.floor(t / trialMs));
  const timeInTrial = t - trial * trialMs;
  return { phase: timeInTrial < stimulusMs ? 'stimulus' : 'gap', trial, timeInTrial, countdown: 0, progress: t / run };
}

/** Elapsed time at which trial `i` starts (used to rewind to the current trial on resume). */
export function trialStartMs(i: number, timing: Timing = DEFAULT_TIMING): number {
  return timing.leadMs + Math.max(0, i) * timing.trialMs;
}

// ── Round bookkeeping ────────────────────────────────────────────────────

export type RespondResult = 'hit' | 'falseAlarm' | 'duplicate' | 'ignored';

/** Tracks responses for one round. Pure state; the UI feeds it presses and trial-end events. */
export class Round {
  readonly total: number;
  readonly matches: Record<Channel, boolean[]>;
  readonly pressed: Record<Channel, boolean[]>;
  /** Trials whose response window has closed. */
  closed = 0;

  constructor(
    readonly seq: readonly Stimulus[],
    readonly n: number,
    readonly channels: readonly Channel[],
  ) {
    this.total = seq.length;
    this.matches = {} as Record<Channel, boolean[]>;
    this.pressed = {} as Record<Channel, boolean[]>;
    for (const ch of ALL_CHANNELS) {
      this.matches[ch] = computeMatches(seq, n, ch);
      this.pressed[ch] = new Array<boolean>(this.total).fill(false);
    }
  }

  hasChannel(ch: Channel): boolean {
    return this.channels.includes(ch);
  }

  /** Register a press for `trial` on `ch`. Only the first press per trial and channel counts. */
  respond(trial: number, ch: Channel): RespondResult {
    if (!this.hasChannel(ch) || trial < 0 || trial >= this.total || trial < this.closed) return 'ignored';
    if (this.pressed[ch][trial]) return 'duplicate';
    this.pressed[ch][trial] = true;
    return this.matches[ch][trial] ? 'hit' : 'falseAlarm';
  }

  /** Close the response window of `trial`; returns the channels whose match was missed. */
  closeTrial(trial: number): Channel[] {
    if (trial < 0 || trial >= this.total) return [];
    this.closed = Math.max(this.closed, trial + 1);
    return this.channels.filter((ch) => this.matches[ch][trial] && !this.pressed[ch][trial]);
  }

  /** Every active channel answered correctly (hit or correct rejection) on `trial`. */
  trialCorrect(trial: number): boolean {
    return this.channels.every((ch) => this.matches[ch][trial] === this.pressed[ch][trial]);
  }

  /** Score over the closed trials (or all trials when `upTo` is given). */
  score(upTo = this.closed): RoundScore {
    return scoreRound(this.seq, this.n, this.channels, this.pressed, upTo);
  }
}
