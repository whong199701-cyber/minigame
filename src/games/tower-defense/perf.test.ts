/**
 * §11.9 allocation budget: `snapshot` and `takeEvents` never allocate per frame, and a whole wave run at ×2 through
 * the frame-loop contract (§7.10: 2 steps, takeEvents, snapshot per frame) leaves the heap where it started — nothing
 * accumulates (event buffers, pools, per-enemy scratch). Uses V8's gc() so the measurements are not GC noise.
 */
import v8 from 'node:v8';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, createSnapshot, defaultMemory, snapshot, startWave, step, takeEvents } from './logic';
import { SIM_STEP } from './types';
import { place } from './sim/testkit';
import type { GameState, SpecId, TowerId } from './types';

let gc: () => void = () => {};

beforeAll(() => {
  v8.setFlagsFromString('--expose_gc');
  gc = vm.runInNewContext('gc') as () => void;
});

function heap(): number {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
}

/** Vessel at wave 19 (44 scripted enemies + sporelings) against a mixed L3 defence using every specialization family. */
function busyState(): GameState {
  const s = createGame({ mapId: 'vessel', difficulty: 'normal', memory: defaultMemory(), seed: 3 });
  s.atp = 1e7;
  const plan: [number, number, TowerId, SpecId][] = [
    [3, 2, 'antibody', 'polyvalent'],
    [5, 2, 'mast', 'allergyStorm'],
    [2, 3, 'tcell', 'perforin'],
    [4, 3, 'complement', 'longChain'],
    [6, 3, 'beacon', 'potentiate'],
    [3, 5, 'pyrogen', 'highFever'],
    [5, 5, 'macrophage', 'enzymes'],
    [2, 6, 'mast', 'histamineBurn'],
    [4, 6, 'antibody', 'neutralizing'],
    [6, 6, 'tcell', 'apoptosis'],
    [3, 8, 'complement', 'membraneAttack'],
    [5, 8, 'macrophage', 'fastDigestion'],
    [4, 9, 'pyrogen', 'lowFever'],
    [6, 9, 'beacon', 'alarm'],
  ];
  for (const [c, r, type, spec] of plan) place(s, c, r, type, 3, spec);
  s.wave = 18;
  startWave(s);
  takeEvents(s);
  return s;
}

describe('allocation budget (§11.9)', () => {
  it('snapshot + takeEvents allocate nothing per frame (20 000 frames)', () => {
    const s = busyState();
    const snap = createSnapshot(s.map);
    for (let i = 0; i < 25 * 60; i++) step(s, SIM_STEP);
    takeEvents(s);
    expect(s.enemies.length).toBeGreaterThanOrEqual(5);
    // warm-up: let the JIT optimise both functions
    for (let i = 0; i < 4000; i++) {
      snapshot(s, snap, 0.5);
      takeEvents(s);
    }
    const h0 = heap();
    for (let i = 0; i < 20000; i++) {
      snapshot(s, snap, 0.5);
      takeEvents(s);
    }
    const grown = process.memoryUsage().heapUsed - h0;
    // one tiny allocation per call would already be ≥ 20 000 × 16 B = 320 KB
    expect(grown).toBeLessThan(200 * 1024);
  });

  it('a whole wave at ×2 through the frame loop leaves no retained heap growth', () => {
    const s = busyState();
    const snap = createSnapshot(s.map);
    // warm-up wave: JIT, pools and preallocated buffers reach their steady size
    for (let f = 0; f < 60 * 60 && s.phase === 'wave'; f++) {
      step(s, SIM_STEP);
      step(s, SIM_STEP);
      takeEvents(s);
      snapshot(s, snap, 0.5);
    }
    // the measured wave: same composition again
    s.wave = 18;
    s.phase = 'build';
    startWave(s);
    takeEvents(s);
    const h0 = heap();
    let frames = 0;
    let peak = 0;
    const inWave = (st: GameState): boolean => st.phase === 'wave';
    for (; frames < 120 * 60 && inWave(s); frames++) {
      step(s, SIM_STEP);
      step(s, SIM_STEP);
      takeEvents(s);
      snapshot(s, snap, 0.5);
      if (s.enemies.length > peak) peak = s.enemies.length;
    }
    takeEvents(s);
    takeEvents(s);
    const retained = heap() - h0;
    expect(frames).toBeGreaterThan(600);
    expect(peak).toBeGreaterThanOrEqual(12);
    expect(retained).toBeLessThan(1024 * 1024);
  });
});
