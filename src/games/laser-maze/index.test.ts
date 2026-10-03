// @vitest-environment jsdom
/**
 * UI-flow tests for laser-maze: drives the real `create()` with a fake GameContext in jsdom
 * (canvas, ResizeObserver and layout are stubbed; timers and rAF are faked).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext, GameInstance, HeaderAction, ModalOptions } from '../../app/types';
import game from './index';
import { EMPTY, allTargetsLit, boardLayout, buildGrid, cellIndex, generateLevel, traceBeam, type Level } from './logic';

const W = 390;
const H = 546;
let drawCalls = 0;

beforeAll(() => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      if (prop === 'clearRect') return () => void drawCalls++;
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  };
  const fakeCtx = new Proxy<Record<string, unknown>>({}, handler);
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as unknown as HTMLCanvasElement['getContext'];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: W, bottom: H, width: W, height: H, toJSON() {} }) as DOMRect;
});

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  drawCalls = 0;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

interface Harness {
  ctx: GameContext;
  root: HTMLElement;
  store: Map<string, unknown>;
  best: Record<string, number>;
  actions: HeaderAction[];
  modals: ModalOptions[];
  toasts: string[];
  exits: number;
  instance?: GameInstance;
}

function harness(): Harness {
  const root = document.createElement('div');
  document.body.append(root);
  const h: Harness = {
    root,
    store: new Map(),
    best: {},
    actions: [],
    modals: [],
    toasts: [],
    exits: 0,
    ctx: undefined as unknown as GameContext,
  };
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  h.ctx = {
    root,
    lang: 'en',
    theme: 'dark',
    t: (k, p) => (p ? `${k}${JSON.stringify(p)}` : k),
    play: () => {},
    haptic: () => {},
    storage: {
      get: <T,>(k: string, fb: T): T => (h.store.has(k) ? clone(h.store.get(k) as T) : fb),
      set: (k, v) => void h.store.set(k, clone(v)),
      remove: (k) => void h.store.delete(k),
      recordBest(mode, v, better = 'higher') {
        const prev = h.best[mode];
        if (prev === undefined || (better === 'higher' ? v > prev : v < prev)) {
          h.best[mode] = v;
          return true;
        }
        return false;
      },
      getBest: (m) => h.best[m] ?? null,
    },
    showModal: (o) => {
      h.modals.push(o);
      return { close() {} };
    },
    toast: (m) => void h.toasts.push(m),
    onDestroy: () => {},
    onThemeChange: () => {},
    onVisibility: () => {},
    setStatus: () => {},
    addHeaderAction: (a) => {
      h.actions.push(a);
      return () => {
        const i = h.actions.indexOf(a);
        if (i >= 0) h.actions.splice(i, 1);
      };
    },
    cssVar: () => '',
    exit: () => void h.exits++,
  };
  return h;
}

const icons = (h: Harness) => h.actions.map((a) => a.icon);
const action = (h: Harness, icon: string) => {
  const a = h.actions.find((x) => x.icon === icon);
  if (!a) throw new Error(`no header action ${icon}`);
  return a;
};
const click = (h: Harness, sel: string) => {
  const b = h.root.querySelector<HTMLElement>(sel);
  if (!b) throw new Error(`missing ${sel}`);
  b.click();
};
const usedMirrors = (h: Harness) => h.root.querySelectorAll('.lm-mi.used').length;

function tapCell(h: Harness, lv: Level, x: number, y: number): void {
  const { cell, ox, oy } = boardLayout(W, H, lv.size);
  const canvas = h.root.querySelector('canvas');
  if (!canvas) throw new Error('no canvas');
  const opts = { clientX: ox + (x + 0.5) * cell, clientY: oy + (y + 0.5) * cell, bubbles: true, button: 0 };
  canvas.dispatchEvent(new MouseEvent('pointerdown', opts));
  canvas.dispatchEvent(new MouseEvent('pointerup', opts));
}

/** Place the hidden solution with real taps ('/' = 1 tap, '\' = 2 taps). */
function solveByTaps(h: Harness, lv: Level, upTo = lv.solution.length): void {
  for (const s of lv.solution.slice(0, upTo)) {
    tapCell(h, lv, s.x, s.y);
    if (s.orient === '\\') tapCell(h, lv, s.x, s.y);
  }
}

function startEasy1(): { h: Harness; lv: Level } {
  const h = harness();
  h.instance = game.create(h.ctx);
  click(h, '.lm-play');
  return { h, lv: generateLevel('easy', 1) };
}

describe('laser-maze UI flow', () => {
  it('shows hint / restart only while a level is played', () => {
    const h = harness();
    h.instance = game.create(h.ctx);
    expect(icons(h)).toEqual([]);
    click(h, '.lm-play');
    expect(icons(h)).toEqual(['💡', '↻']);
    click(h, '.lm-chip');
    expect(icons(h)).toEqual([]);
    h.instance.destroy();
    expect(icons(h)).toEqual([]);
  });

  it('localises the level stepper aria-labels', () => {
    const h = harness();
    h.instance = game.create(h.ctx);
    const steps = h.root.querySelectorAll('.lm-step');
    expect(steps[0].getAttribute('aria-label')).toBe('prevLevel');
    expect(steps[1].getAttribute('aria-label')).toBe('nextLevel');
    h.instance.destroy();
  });

  it('saves a win immediately, so restarting during the celebration keeps it', () => {
    const { h, lv } = startEasy1();
    vi.advanceTimersByTime(3000);
    solveByTaps(h, lv);
    // Persisted synchronously, before any timer runs.
    expect(h.store.get('unlocked:easy')).toBe(2);
    expect(h.best.easy).toBe(1);
    expect((h.store.get('times:easy') as Record<string, number>)['1']).toBeGreaterThan(2.5);
    expect(h.store.get('level:easy')).toBe(2);
    expect(h.store.has('board:easy')).toBe(false);
    expect(icons(h)).toEqual(['↻', '▶']);
    // Restart ~immediately (the reviewer's 80 ms race).
    vi.advanceTimersByTime(80);
    action(h, '↻').onClick();
    expect(icons(h)).toEqual(['💡', '↻']);
    expect(usedMirrors(h)).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(h.modals).toHaveLength(0);
    expect(h.store.get('unlocked:easy')).toBe(2);
    expect(h.best.easy).toBe(1);
    h.instance!.destroy();
  });

  it('leaving the game during the celebration keeps the win and shows no stale modal', () => {
    const { h, lv } = startEasy1();
    solveByTaps(h, lv);
    vi.advanceTimersByTime(100);
    h.instance!.destroy();
    expect(h.store.get('unlocked:easy')).toBe(2);
    expect(h.best.easy).toBe(1);
    expect(h.store.get('times:easy')).toBeDefined();
    vi.advanceTimersByTime(5000);
    expect(h.modals).toHaveLength(0);
    expect(icons(h)).toEqual([]);
  });

  it('the level chip during the celebration lands on the newly unlocked level', () => {
    const { h, lv } = startEasy1();
    solveByTaps(h, lv);
    click(h, '.lm-chip');
    expect(h.root.querySelector('.lm-level-label')!.textContent).toBe('levelN{"n":2}');
    expect(h.store.get('unlocked:easy')).toBe(2);
    vi.advanceTimersByTime(5000);
    expect(h.modals).toHaveLength(0);
    h.instance!.destroy();
  });

  it('result modal offers home, retry and next level', () => {
    const { h, lv } = startEasy1();
    solveByTaps(h, lv);
    expect(h.modals).toHaveLength(0);
    vi.advanceTimersByTime(3000);
    expect(h.modals).toHaveLength(1);
    const buttons = h.modals[0].buttons!;
    expect(buttons.map((b) => b.label)).toEqual(['home', 'retry', 'nextLevel']);
    // Retry: same level, fresh board.
    buttons[1].onClick!();
    expect(h.root.querySelector('.lm-chip')!.textContent).toContain('levelN{"n":1}');
    expect(usedMirrors(h)).toBe(0);
    expect(icons(h)).toEqual(['💡', '↻']);
    // Win again and go to the next level.
    solveByTaps(h, lv);
    vi.advanceTimersByTime(3000);
    expect(h.modals).toHaveLength(2);
    h.modals[1].buttons![2].onClick!();
    expect(h.root.querySelector('.lm-chip')!.textContent).toContain('levelN{"n":2}');
    h.modals[1].buttons![0].onClick!();
    expect(h.exits).toBe(1);
    h.instance!.destroy();
  });

  it('keeps an unfinished board (mirrors, clock, hints) when leaving and resumes it', () => {
    const { h, lv } = startEasy1();
    vi.advanceTimersByTime(4000);
    // A wrong mirror that neither alone nor next to the first solution mirror solves the level.
    const base = buildGrid(lv);
    const solKeys = new Set(lv.solution.map((s) => cellIndex(lv.size, s.x, s.y)));
    let wrong = -1;
    for (let i = 0; i < base.length && wrong < 0; i++) {
      if (base[i] !== EMPTY || solKeys.has(i)) continue;
      const pl = { x: i % lv.size, y: Math.floor(i / lv.size), orient: '/' as const };
      const a = traceBeam(buildGrid(lv, [pl]), lv.size, lv.emitter);
      const b = traceBeam(buildGrid(lv, [lv.solution[0], pl]), lv.size, lv.emitter);
      if (!allTargetsLit(a, lv) && !allTargetsLit(b, lv)) wrong = i;
    }
    expect(wrong).toBeGreaterThanOrEqual(0);
    tapCell(h, lv, wrong % lv.size, Math.floor(wrong / lv.size));
    expect(usedMirrors(h)).toBe(1);
    click(h, '.lm-chip');
    const saved = h.store.get('board:easy') as { level: number; placed: unknown[]; elapsed: number; hints: number };
    expect(saved.level).toBe(1);
    expect(saved.placed).toHaveLength(1);
    expect(saved.elapsed).toBeGreaterThan(3.5);
    expect(h.root.querySelector('.lm-play')!.textContent).toBe('resume');
    click(h, '.lm-play');
    expect(usedMirrors(h)).toBe(1);
    // A hint, then leave via the shell (destroy) and come back: the hint count survives.
    action(h, '💡').onClick();
    h.instance!.destroy();
    expect((h.store.get('board:easy') as { hints: number }).hints).toBe(1);
    h.instance = game.create(h.ctx);
    click(h, '.lm-play');
    // Finish the level with hints only: unlocks, but no best time.
    for (let i = 0; i < 4 && h.store.get('unlocked:easy') === undefined; i++) action(h, '💡').onClick();
    expect(h.store.get('unlocked:easy')).toBe(2);
    expect(h.store.get('times:easy')).toBeUndefined();
    expect(h.store.has('board:easy')).toBe(false);
    vi.advanceTimersByTime(3000);
    // The hint from the first session was restored: 1 + 1 hints in total.
    expect((h.modals.at(-1)!.body as HTMLElement).textContent).toContain('winHints{"n":2}');
    h.instance!.destroy();
  });

  it('entering a level and leaving without a move does not overwrite another saved board', () => {
    const { h, lv } = startEasy1();
    solveByTaps(h, lv, 1);
    click(h, '.lm-chip');
    const before = h.store.get('board:easy');
    // Play level 1 again but leave untouched.
    click(h, '.lm-play');
    click(h, '.lm-chip');
    expect(h.store.get('board:easy')).toEqual(before);
    h.instance!.destroy();
  });

  it('throttles idle redraws and stops them once the win animation is over', () => {
    const { h, lv } = startEasy1();
    vi.advanceTimersByTime(2000); // reveal finished
    drawCalls = 0;
    vi.advanceTimersByTime(1000);
    expect(drawCalls).toBeGreaterThan(15);
    expect(drawCalls).toBeLessThanOrEqual(32);
    vi.advanceTimersByTime(25000); // idle long enough to pause the shimmer
    drawCalls = 0;
    vi.advanceTimersByTime(1000);
    expect(drawCalls).toBe(0);
    solveByTaps(h, lv); // input wakes it up and the win plays out
    vi.advanceTimersByTime(6000);
    drawCalls = 0;
    vi.advanceTimersByTime(1000);
    expect(drawCalls).toBe(0);
    h.instance!.destroy();
  });
});
