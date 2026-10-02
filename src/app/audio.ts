import type { SoundName } from './types';
import { getSetting, setSetting } from './storage';

let enabled = getSetting<boolean>('sound', true);
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Unlock the audio context on the first user gesture (required on iOS). */
export function unlockAudio(): void {
  const c = ensure();
  if (c && c.state === 'suspended') void c.resume();
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(v: boolean): void {
  enabled = v;
  setSetting('sound', v);
  if (v) unlockAudio();
}

type Wave = OscillatorType;

interface Note {
  freq: number;
  start: number; // seconds offset
  dur: number;
  wave?: Wave;
  gain?: number;
  slideTo?: number; // frequency glide target
}

function tone(c: AudioContext, n: Note): void {
  if (!master) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  const t0 = c.currentTime + n.start;
  osc.type = n.wave ?? 'sine';
  osc.frequency.setValueAtTime(n.freq, t0);
  if (n.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, n.slideTo), t0 + n.dur);
  const peak = n.gain ?? 0.5;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + n.dur + 0.02);
}

function noise(c: AudioContext, start: number, dur: number, gain = 0.4, lowpass = 1200): void {
  if (!master) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = c.createGain();
  const t0 = c.currentTime + start;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
}

const patterns: Record<SoundName, (c: AudioContext) => void> = {
  tap: (c) => tone(c, { freq: 880, start: 0, dur: 0.05, wave: 'triangle', gain: 0.25 }),
  move: (c) => tone(c, { freq: 520, start: 0, dur: 0.07, wave: 'triangle', gain: 0.3, slideTo: 640 }),
  place: (c) => {
    tone(c, { freq: 330, start: 0, dur: 0.09, wave: 'square', gain: 0.18 });
    tone(c, { freq: 660, start: 0.02, dur: 0.08, wave: 'triangle', gain: 0.25 });
  },
  pop: (c) => tone(c, { freq: 900, start: 0, dur: 0.1, wave: 'sine', gain: 0.35, slideTo: 300 }),
  success: (c) => {
    tone(c, { freq: 660, start: 0, dur: 0.1, wave: 'triangle', gain: 0.3 });
    tone(c, { freq: 990, start: 0.09, dur: 0.14, wave: 'triangle', gain: 0.3 });
  },
  error: (c) => {
    tone(c, { freq: 220, start: 0, dur: 0.12, wave: 'sawtooth', gain: 0.2 });
    tone(c, { freq: 180, start: 0.1, dur: 0.16, wave: 'sawtooth', gain: 0.2 });
  },
  win: (c) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(c, { freq: f, start: i * 0.11, dur: 0.22, wave: 'triangle', gain: 0.3 }));
    tone(c, { freq: 1319, start: 0.46, dur: 0.4, wave: 'sine', gain: 0.25 });
  },
  lose: (c) => {
    [392, 349, 311, 262].forEach((f, i) => tone(c, { freq: f, start: i * 0.16, dur: 0.24, wave: 'sawtooth', gain: 0.18 }));
  },
  tick: (c) => tone(c, { freq: 1200, start: 0, dur: 0.03, wave: 'square', gain: 0.12 }),
  swoosh: (c) => noise(c, 0, 0.18, 0.25, 2500),
  explosion: (c) => {
    noise(c, 0, 0.45, 0.6, 700);
    tone(c, { freq: 90, start: 0, dur: 0.4, wave: 'sine', gain: 0.5, slideTo: 30 });
  },
  coin: (c) => {
    tone(c, { freq: 988, start: 0, dur: 0.08, wave: 'square', gain: 0.18 });
    tone(c, { freq: 1319, start: 0.07, dur: 0.22, wave: 'square', gain: 0.18 });
  },
  shoot: (c) => tone(c, { freq: 700, start: 0, dur: 0.12, wave: 'sawtooth', gain: 0.15, slideTo: 120 }),
};

let last = 0;
export function playSound(name: SoundName): void {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') {
    void c.resume();
    return;
  }
  const now = performance.now();
  // Throttle extremely dense calls (e.g. per-frame) to protect the ears and CPU.
  if (name === 'tick' && now - last < 30) return;
  last = now;
  try {
    patterns[name](c);
  } catch {
    /* ignore */
  }
}
