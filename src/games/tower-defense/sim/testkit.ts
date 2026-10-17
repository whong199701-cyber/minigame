/**
 * Test helpers (imported by the *.test.ts files only): sandbox arenas, enemy / tower placement, stepping.
 */
import type { Difficulty, Enemy, EnemyId, GameEvent, GameState, ImmuneMemory, MapId, SpecId, TalentId, Tower, TowerId } from '../types';
import { SIM_STEP } from '../types';
import { defaultMemory } from './memory';
import { createGame, spawnEnemy, takeEvents } from './state';
import { startWave, step } from './step';
import { build, upgrade } from './towers';

export function memoryWith(talents: TalentId[] = [], vaccines: Partial<ImmuneMemory['vaccines']> = {}): ImmuneMemory {
  const m = defaultMemory();
  m.talents = [...talents];
  m.vaccines = { ...m.vaccines, ...vaccines };
  return m;
}

/**
 * A state in the `wave` phase at `wave` with an empty spawn queue held open by a far-future dummy item (so the wave
 * never clears on its own), lots of ATP, and the hero parked in a corner (so he neither fights nor reveals).
 */
export function arena(opts: { map?: MapId; difficulty?: Difficulty; wave?: number; memory?: ImmuneMemory; hero?: boolean } = {}): GameState {
  const s = createGame({ mapId: opts.map ?? 'vessel', difficulty: opts.difficulty ?? 'normal', memory: opts.memory ?? defaultMemory(), seed: 7 });
  s.atp = 1e6;
  s.wave = (opts.wave ?? 1) - 1;
  startWave(s);
  s.waveState.queue = [{ type: 'bacterium', at: 1e9, pathIndex: 0 }];
  if (!opts.hero) parkHero(s);
  takeEvents(s);
  return s;
}

/** Moves the hero (instantly) to the grid corner farthest from every path cell, idle. */
export function parkHero(s: GameState): void {
  let best = { x: 0.3, y: 0.3, d: -1 };
  for (const [x, y] of [
    [0.3, 0.3],
    [s.map.cols - 0.3, 0.3],
    [0.3, s.map.rows - 0.3],
    [s.map.cols - 0.3, s.map.rows - 0.3],
  ]) {
    let d = Infinity;
    for (const g of s.geoms) for (const p of g.points) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
    if (d > best.d) best = { x, y, d };
  }
  const h = s.hero;
  h.x = h.px = best.x;
  h.y = h.py = best.y;
  h.dest = null;
}

/** Spawns an enemy at `dist`; `frozen` sets its speed to 0 so it stays put. */
export function spawnAt(s: GameState, type: EnemyId, dist: number, opts: { path?: number; frozen?: boolean; hp?: number; spawned?: boolean } = {}): Enemy {
  const e = spawnEnemy(s, type, opts.path ?? 0, dist, opts.spawned ?? false);
  if (opts.frozen) e.speed = 0;
  if (opts.hp !== undefined) {
    e.hp = opts.hp;
    e.maxHp = Math.max(e.maxHp, opts.hp);
  }
  return e;
}

/** Builds (and upgrades) a tower; throws when the placement is illegal. */
export function place(s: GameState, col: number, row: number, type: TowerId, level = 1, spec?: SpecId): Tower {
  const t = build(s, col, row, type);
  if (!t) throw new Error(`cannot build ${type} at ${col},${row}`);
  for (let l = 1; l < level; l++) {
    if (!upgrade(s, t.id, l === 2 ? spec : undefined)) throw new Error(`cannot upgrade ${type} to ${l + 1}`);
  }
  return t;
}

/** Steps `seconds` of simulation and returns every event emitted meanwhile. */
export function run(s: GameState, seconds: number): GameEvent[] {
  const out: GameEvent[] = [];
  const n = Math.round(seconds / SIM_STEP);
  for (let i = 0; i < n; i++) {
    step(s, SIM_STEP);
    for (const ev of takeEvents(s)) out.push(ev);
  }
  return out;
}

/** Steps until `pred` is true or `maxSeconds` elapse; returns the events. */
export function runUntil(s: GameState, pred: () => boolean, maxSeconds = 120): GameEvent[] {
  const out: GameEvent[] = [];
  const n = Math.round(maxSeconds / SIM_STEP);
  for (let i = 0; i < n && !pred(); i++) {
    step(s, SIM_STEP);
    for (const ev of takeEvents(s)) out.push(ev);
  }
  return out;
}

export function ofType<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Stable string hash (FNV-1a) of a JSON value — determinism tests. */
export function hashJson(v: unknown): string {
  const str = canonicalJson(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + ':' + str.length;
}

/** JSON with object keys sorted recursively (key order independent). */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) out[k] = o[k];
      return out;
    }
    return val;
  });
}
