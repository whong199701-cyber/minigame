/**
 * Immune Front (免疫防线) — game module: wires the pure simulation (logic.ts) and the lazily loaded Three.js renderer
 * (renderer.ts → render/) into the shell. Screens: start (organ carousel), immune memory (talents / vaccines), game.
 * Persistence (§11.4): `memory` (single source of truth, written immediately), `run` (strict RunSave, written after
 * every wave and on pause / hide / exit), recordBest mirrors for the home cards.
 */
import type { GameContext, GameInstance, GameModule } from '../../app/types';
import { MAP_IDS, type CreateRenderer, type Difficulty, type GameState, type ImmuneMemory, type MapId, type RunSave } from './types';
import { createGame, defaultMemory, deserialize, isMapUnlocked, parseMemory, serialize } from './logic';
import { strings } from './strings';
import { renderStart } from './ui/start';
import { renderMemory } from './ui/memory';
import { GameScreen, type TdDevHooks } from './ui/game';
import './style.css';

type Screen = 'start' | 'memory' | 'game';

let rendererPromise: Promise<CreateRenderer> | null = null;
/** Lazy three.js chunk (§11.10); prefetched on the start screen. */
function loadRenderer(): Promise<CreateRenderer> {
  if (!rendererPromise) {
    rendererPromise = import('./renderer').then((m) => m.default);
    rendererPromise.catch(() => {
      rendererPromise = null;
    });
  }
  return rendererPromise;
}

function create(ctx: GameContext): GameInstance {
  const { root, t, storage } = ctx;
  let destroyed = false;
  let screen: Screen = 'start';
  let cleanupScreen: (() => void) | null = null;
  let game: GameScreen | null = null;
  let rendererReady = false;
  const readyCbs: (() => void)[] = [];

  // ── persistence ──
  for (const legacy of ['map', 'diff', 'speed']) storage.remove(legacy);
  let memory: ImmuneMemory = parseMemory(storage.get<unknown>('memory', null)) ?? defaultMemory();
  storage.set('memory', memory);
  mirrorBests(memory);

  function setMemory(m: ImmuneMemory): void {
    memory = m;
    storage.set('memory', m);
    mirrorBests(m);
  }

  function mirrorBests(m: ImmuneMemory): void {
    for (const id of MAP_IDS) {
      for (const d of ['normal', 'hard'] as const) {
        if (m.stars[id][d] > 0) storage.recordBest(`stars:${id}:${d}`, m.stars[id][d], 'higher');
        if (m.bestEndless[id][d] > 0) storage.recordBest(`endless:${id}:${d}`, m.bestEndless[id][d], 'higher');
      }
    }
  }

  /** The validated run save, or null (a foreign / corrupt / mid-wave save is deleted). */
  let savedCache: { raw: unknown; save: RunSave | null } | null = null;
  function savedRun(): RunSave | null {
    const raw = storage.get<unknown>('run', null);
    if (savedCache && savedCache.raw === raw) return savedCache.save;
    let save: RunSave | null = null;
    if (raw) {
      const st = deserialize(raw, memory);
      if (st) save = raw as RunSave;
      else storage.remove('run');
    }
    savedCache = { raw, save };
    return save;
  }

  function writeRun(s: GameState | null): void {
    savedCache = null;
    if (s === null) storage.remove('run');
    else storage.set('run', serialize(s));
  }

  // ── renderer prefetch ──
  const markReady = () => {
    if (destroyed || rendererReady) return;
    rendererReady = true;
    readyCbs.splice(0).forEach((f) => f());
  };
  const prefetch = () => {
    loadRenderer().then(markReady, (e: unknown) => console.warn('[tower-defense] renderer prefetch failed', e));
  };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(prefetch, { timeout: 400 });
  else window.setTimeout(prefetch, 50);

  // ── screens ──
  function clear(): void {
    cleanupScreen?.();
    cleanupScreen = null;
    if (game) {
      game.destroy();
      game = null;
    }
    root.innerHTML = '';
  }

  function showStart(): void {
    clear();
    screen = 'start';
    ctx.setStatus('');
    cleanupScreen = renderStart(root, {
      ctx,
      t,
      memory: () => memory,
      setMemory,
      savedRun,
      rendererReady: () => rendererReady,
      onRendererReady: (cb) => readyCbs.push(cb),
      play: (map, diff) => {
        writeRun(null);
        startRun(createGame({ mapId: map, difficulty: diff, memory }));
      },
      continueRun: () => {
        const raw = storage.get<unknown>('run', null);
        const st = raw ? deserialize(raw, memory) : null;
        if (!st) {
          storage.remove('run');
          savedCache = null;
          showStart();
          return;
        }
        startRun(st);
      },
      openMemory: () => showMemory(),
    });
  }

  function showMemory(): void {
    clear();
    screen = 'memory';
    ctx.setStatus(t('memoryTitle'));
    cleanupScreen = renderMemory(root, { ctx, t, memory: () => memory, setMemory, back: () => showStart() });
  }

  function startRun(state: GameState): void {
    clear();
    screen = 'game';
    const m = memory;
    if (m.prefs.map !== state.mapId || m.prefs.difficulty !== state.difficulty) setMemory({ ...m, prefs: { ...m.prefs, map: state.mapId, difficulty: state.difficulty } });
    game = new GameScreen(
      {
        ctx,
        t,
        memory: () => memory,
        setMemory,
        loadRenderer,
        writeRun,
        toStart: () => showStart(),
        newRun: (map: MapId, diff: Difficulty) => {
          writeRun(null);
          const mapId = isMapUnlocked(memory, map) ? map : 'vessel';
          startRun(createGame({ mapId, difficulty: diff, memory }));
        },
      },
      root,
      state,
    );
  }

  ctx.onVisibility((visible) => game?.setVisible(visible));
  ctx.onThemeChange((theme) => {
    game?.setTheme(theme);
    if (screen === 'start') showStart();
  });

  // ── dev hook for Playwright reviewers ──
  if (import.meta.env.DEV) {
    const w = window as unknown as { __td?: unknown };
    const hooks = (): TdDevHooks | null => game?.devHooks() ?? null;
    w.__td = new Proxy(
      {},
      {
        get(_o, key: string) {
          if (key === 'screen') return () => screen;
          if (key === 'memory') return () => memory;
          if (key === 'setMemory') return (m: unknown) => setMemory(parseMemory(m) ?? defaultMemory());
          if (key === 'play') return (map: MapId = 'vessel', diff: Difficulty = 'normal') => startRun(createGame({ mapId: map, difficulty: diff, memory }));
          if (key === 'ready') return () => rendererReady;
          const h = hooks();
          if (!h) return () => null;
          return (h as unknown as Record<string, unknown>)[key];
        },
      },
    );
    ctx.onDestroy(() => {
      if (w.__td) delete w.__td;
    });
  }

  showStart();

  return {
    destroy() {
      destroyed = true;
      clear();
    },
  };
}

const game: GameModule = { strings, create };
export default game;
