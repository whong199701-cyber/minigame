// @vitest-environment jsdom
/**
 * UI-level tests of the game screen (§11.2) in jsdom with a fake renderer: the build strip keeps its DOM — and so its
 * horizontal scroll position — across a card preview, ATP changes and a blocked tap (QA round 2: the strip was
 * rebuilt and snapped back to scrollLeft 0, so the swiped-to 'Build ✓' card left the screen and a second tap at the
 * same spot previewed another tower), and the no-WebGL fallback offers only Home and never writes a run save.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../app/types';
import { GameScreen, type GameHost } from './ui/game';
import { createGame, defaultMemory } from './logic';
import { revealScrollLeft } from './ui/scroll';
import type { CreateRenderer, GameState, ImmuneMemory, TapHit } from './types';

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

interface Rig {
  screen: GameScreen;
  root: HTMLElement;
  state: GameState;
  tap(hit: Partial<TapHit> & Pick<TapHit, 'kind'>): void;
  writes: (GameState | null)[];
  exits: number;
}

async function mount(opts: { noWebgl?: boolean } = {}): Promise<Rig> {
  const root = document.createElement('div');
  document.body.append(root);
  let memory: ImmuneMemory = defaultMemory();
  const store = new Map<string, unknown>();
  const taps: ((h: TapHit) => void)[] = [];
  const rig = { root, writes: [] as (GameState | null)[], exits: 0 } as unknown as Rig;
  const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}${JSON.stringify(p)}` : k);
  const ctx: GameContext = {
    root,
    lang: 'zh',
    theme: 'dark',
    t,
    play: () => undefined,
    haptic: () => undefined,
    storage: {
      get: <T,>(k: string, f: T) => (store.has(k) ? (store.get(k) as T) : f),
      set: (k, v) => void store.set(k, v),
      remove: (k) => void store.delete(k),
      recordBest: () => false,
      getBest: () => null,
    },
    showModal: () => ({ close: () => undefined }),
    toast: () => undefined,
    onDestroy: () => undefined,
    onThemeChange: () => undefined,
    onVisibility: () => undefined,
    setStatus: () => undefined,
    addHeaderAction: () => () => undefined,
    cssVar: () => '',
    exit: () => void rig.exits++,
  };
  const base: Record<string, unknown> = {
    busy: false,
    bannerShowing: false,
    quality: 'high',
    onTap: (cb: (h: TapHit) => void) => {
      taps.push(cb);
      return () => undefined;
    },
    project: () => false,
    floorPoint: () => false,
    stats: () => ({ calls: 0, triangles: 0, frameMs: 16 }),
  };
  const fake = new Proxy(base, { get: (o, k: string) => (k in o ? o[k] : () => undefined) });
  const create = (() => {
    if (opts.noWebgl) throw new Error('WebGL unavailable');
    return fake;
  }) as unknown as CreateRenderer;
  const state = createGame({ mapId: 'vessel', difficulty: 'normal', memory });
  const host: GameHost = {
    ctx,
    t,
    memory: () => memory,
    setMemory: (m) => void (memory = m),
    loadRenderer: () => Promise.resolve(create),
    writeRun: (s) => void rig.writes.push(s),
    toStart: () => undefined,
    newRun: () => undefined,
  };
  rig.screen = new GameScreen(host, root, state);
  rig.state = state;
  for (let i = 0; i < 4; i++) await Promise.resolve();
  rig.tap = (h) => taps.forEach((cb) => cb({ id: -1, col: -1, row: -1, x: 0, y: 0, sx: 0, sy: 0, pathCell: false, ...h } as TapHit));
  return rig;
}

const cards = (root: HTMLElement) => root.querySelector<HTMLElement>('.td-cards')!;
const card = (root: HTMLElement, type: string) => root.querySelector<HTMLElement>(`.td-card[data-type="${type}"]`)!;

describe('build strip (§11.2)', () => {
  it('previewing a swiped-to card keeps the scroller, the cards and their scroll position; the second tap builds it', async () => {
    const g = await mount();
    g.screen.devHooks().addAtp(1000);
    g.tap({ kind: 'pad', col: 3, row: 2 });
    const box = cards(g.root);
    expect(box.querySelectorAll('.td-card')).toHaveLength(7);
    const beacon = card(g.root, 'beacon');
    box.scrollLeft = 230; // the player swiped to the last cards
    beacon.click();
    expect(cards(g.root)).toBe(box);
    expect(card(g.root, 'beacon')).toBe(beacon);
    expect(box.scrollLeft).toBe(230);
    expect(beacon.classList.contains('preview')).toBe(true);
    expect(beacon.querySelector('.td-card-name')!.textContent).toBe('buildConfirm');
    expect(g.root.querySelector('.td-strip-detail')!.textContent).toContain('tower_beacon');
    // ATP crossing a cost mid-strip (refreshSheet) updates the same cards in place
    g.screen.devHooks().addAtp(-g.state.atp);
    expect(cards(g.root)).toBe(box);
    expect(box.scrollLeft).toBe(230);
    expect(beacon.classList.contains('poor')).toBe(true);
    expect(card(g.root, 'antibody').classList.contains('poor')).toBe(true);
    g.screen.devHooks().addAtp(500);
    expect(beacon.classList.contains('poor')).toBe(false);
    expect(beacon.classList.contains('preview')).toBe(true);
    // second tap on the same card builds it
    beacon.click();
    expect(g.state.towers.map((tw) => [tw.type, tw.col, tw.row])).toEqual([['beacon', 3, 2]]);
    expect(g.root.querySelector('.td-sheet')!.hasAttribute('hidden')).toBe(true);
    g.screen.destroy();
  });

  it('a blocked barrier tap (ban zone) explains why in place without rebuilding the strip', async () => {
    const g = await mount();
    g.tap({ kind: 'path', col: 1, row: 1, pathCell: true }); // second path cell: inside the spawn ban zone
    const box = cards(g.root);
    const barrier = card(g.root, 'barrier');
    expect(barrier.classList.contains('blocked')).toBe(true);
    barrier.click();
    expect(cards(g.root)).toBe(box);
    expect(card(g.root, 'barrier')).toBe(barrier);
    expect(g.root.querySelector('.td-strip-detail .td-warn')!.textContent).toBe('denied_barrierZone');
    barrier.click();
    expect(g.state.towers).toHaveLength(0);
    g.screen.destroy();
  });

  it('reveal geometry: a card cut at either edge scrolls just enough, and the tapped point stays on it', () => {
    // box 0..352, card 340..418 cut on the right → scroll by 66; its visible part 340..352 stays inside 274..352
    expect(revealScrollLeft(100, 0, 352, 340, 418)).toBe(166);
    expect(revealScrollLeft(230, 0, 352, -50, 28)).toBe(180);
    expect(revealScrollLeft(230, 0, 352, 10, 88)).toBe(230);
    expect(revealScrollLeft(0, 0, 0, 10, 88)).toBe(0);
  });
});

describe('no-WebGL fallback', () => {
  it('shows only Home (no Retry that also went home) and leaving writes no run save', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const g = await mount({ noWebgl: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const overlay = g.root.querySelector<HTMLElement>('.td-loading')!;
    expect(overlay.textContent).toContain('noWebgl');
    const btns = overlay.querySelectorAll<HTMLButtonElement>('button');
    expect([...btns].map((b) => b.textContent)).toEqual(['home']);
    btns[0].click();
    expect(g.exits).toBe(1);
    g.screen.destroy();
    window.dispatchEvent(new Event('pagehide'));
    expect(g.writes).toEqual([]);
  });

  it('a normal run still saves on leave in the build phase', async () => {
    const g = await mount();
    g.screen.destroy();
    expect(g.writes).toHaveLength(1);
  });
});

describe('floating status labels (overlay)', () => {
  it('keep at most one live label per tower instead of stacking on its anchor', async () => {
    const { Overlay } = await import('./render/overlay');
    const fake2d = new Proxy({}, { get: () => () => ({ addColorStop: () => undefined }) });
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => fake2d) as unknown as typeof orig;
    try {
      const ov = new Overlay(document.createElement('div'));
      // Virus King mass infection with a beacon curing every second: tower 7 flips infected / cured
      let now = 0;
      for (let i = 0; i < 12; i++) {
        ov.addText(3.5, 2.5, 1.2, i % 2 ? 'cured' : 'infected', '#fff', 12, now, 0.9, 24, 7);
        ov.addText(5.5, 2.5, 1.2, 'infected', '#fff', 12, now, 0.9, 24, 8);
        expect(ov.liveTexts(now)).toBeLessThanOrEqual(2);
        now += 0.35;
      }
      expect(ov.liveTexts(now - 0.35, 'infected') + ov.liveTexts(now - 0.35, 'cured')).toBe(2);
      // an identical status is not restarted within the repeat window; unkeyed damage numbers still stack
      for (let i = 0; i < 5; i++) ov.addText(1.5, 1.5, 0.5, '12', '#fff', 13, now, 0.8, 30);
      expect(ov.liveTexts(now, '12')).toBe(5);
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });
});
