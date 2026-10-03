import type { GameContext, GameInstance, GameModule, ModalHandle } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import { createCanvas, createLoop, onPointer, type CanvasHandle } from '../../app/canvas';
import {
  CORE_R,
  SLOW_DURATION,
  SLOW_SCALE,
  advanceBullets,
  arenaSize,
  createWorld,
  introKey,
  isMode,
  moveShip,
  roundTime,
  step,
  type Bullet,
  type GameEvent,
  type Mode,
  type World,
} from './logic';
import { strings } from './strings';
import './style.css';

// ── Palette & drawing helpers ────────────────────────────────────────────

interface Pal {
  dark: boolean;
  page: string;
  arenaIn: string;
  arenaOut: string;
  grid: string;
  gridMajor: string;
  border: string;
  text: string;
  muted: string;
  warm: string;
  cool: string;
  orb: string;
  ship: string;
  ship2: string;
  shipEdge: string;
  core: string;
  coreRing: string;
  shield: string;
  slow: string;
  success: string;
  danger: string;
  band: string;
}

function palette(cssVar: (n: string) => string): Pal {
  const dark = (document.documentElement.dataset.theme ?? 'dark') !== 'light';
  const v = (name: string, fb: string) => cssVar(name) || fb;
  return dark
    ? {
        dark,
        page: v('--bg', '#0f1218'),
        arenaIn: '#141a29',
        arenaOut: '#090c13',
        grid: 'rgba(140,160,210,0.07)',
        gridMajor: 'rgba(140,160,210,0.13)',
        border: 'rgba(140,160,210,0.22)',
        text: v('--text', '#e8ecf3'),
        muted: v('--muted', '#8b94a7'),
        warm: '#ff4f7b',
        cool: '#46d4ff',
        orb: '#ffa53d',
        ship: '#7aa2ff',
        ship2: '#3d5fd9',
        shipEdge: 'rgba(255,255,255,0.75)',
        core: '#ffffff',
        coreRing: 'rgba(10,14,24,0.85)',
        shield: v('--success', '#3ddc97'),
        slow: '#8f7bff',
        success: v('--success', '#3ddc97'),
        danger: v('--danger', '#ff5470'),
        band: 'rgba(8,11,18,0.62)',
      }
    : {
        dark,
        page: v('--bg', '#f4f6fb'),
        arenaIn: '#ffffff',
        arenaOut: '#e6ebf4',
        grid: 'rgba(40,60,110,0.07)',
        gridMajor: 'rgba(40,60,110,0.12)',
        border: 'rgba(40,60,110,0.22)',
        text: v('--text', '#171a21'),
        muted: v('--muted', '#5c6475'),
        warm: '#e8265a',
        cool: '#0a8fd6',
        orb: '#e07000',
        ship: '#3366ff',
        ship2: '#1f3fa8',
        shipEdge: 'rgba(10,20,50,0.55)',
        core: '#ffffff',
        coreRing: 'rgba(10,14,24,0.9)',
        shield: v('--success', '#1fa86b'),
        slow: '#6a4dff',
        success: v('--success', '#1fa86b'),
        danger: v('--danger', '#e0304f'),
        band: 'rgba(255,255,255,0.78)',
      };
}

function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, c * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Noto Sans SC", sans-serif';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Roboto Mono", monospace';

type Sens = '1' | '1.5' | '2';
type State = 'start' | 'ready' | 'running' | 'paused' | 'dying' | 'over';

const STEP = 1 / 120;
const MAX_STEPS = 8;
const FOCUS_MUL = 0.45;
const KEY_SPEED = 250;
const DYING_TIME = 1.1;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface Floater {
  text: string;
  x: number;
  y: number;
  t: number;
  color: string;
}

interface Sprite {
  c: HTMLCanvasElement;
  R: number;
}

// ── Game ─────────────────────────────────────────────────────────────────

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const storedMode = ctx.storage.get<unknown>('mode', 'normal');
  let mode: Mode = isMode(storedMode) ? storedMode : 'normal';
  const storedSens = ctx.storage.get<unknown>('sens', '1');
  let sens: Sens = storedSens === '1.5' || storedSens === '2' ? storedSens : '1';

  let state: State = 'start';
  let world: World | null = null;
  let pal = palette(ctx.cssVar);
  let visible = document.visibilityState !== 'hidden';

  // View
  let cv: CanvasHandle | null = null;
  let offPointer: (() => void) | null = null;
  let headerRemovers: (() => void)[] = [];
  let pauseEl: HTMLElement | null = null;
  let pauseInfo: HTMLElement | null = null;
  const view = { scale: 1, ox: 0, oy: 0 };
  const sprites = new Map<number, Sprite>();
  let bgCache: HTMLCanvasElement | null = null;
  let gameOverModal: ModalHandle | null = null;

  // Run state (visual only)
  let acc = 0;
  let particles: Particle[] = [];
  let floaters: Floater[] = [];
  let announce: { title: string; sub: string; t: number } | null = null;
  let flash = { t: 0, color: '#fff' };
  let shake = 0;
  let dyingT = 0;
  let readyIsResume = false;
  let bestAtStart: number | null = null;
  let passedBest = false;
  let lastShootSound = 0;
  let bank = 0;
  let lastShipX = 0;
  let animT = 0;
  let pausedAt = 0;
  let lastStatus = '';

  // Input
  const pointers = new Map<number, { x: number; y: number }>();
  let driver: number | null = null;
  const keys = new Set<string>();

  const loop = createLoop((dt) => frame(dt));

  // ── Start screen ───────────────────────────────────────────────────────
  function showStart(): void {
    teardownGameView();
    state = 'start';
    world = null;
    root.innerHTML = '';
    setStatus('');
    const desc = el('p', { class: 'muted bd-mode-desc', text: t(mode + 'Desc') });
    const best = el('div', { class: 'bd-best' });
    const updateBest = () => {
      const b = ctx.storage.getBest(mode);
      best.textContent = b === null ? t('noBest') : t('bestTime', { t: b.toFixed(2) });
      best.classList.toggle('bd-none', b === null);
    };
    updateBest();
    root.append(
      el(
        'div',
        { class: 'start-screen bd-start' },
        el(
          'div',
          { class: 'bd-hero', 'aria-hidden': 'true' },
          el('div', { class: 'bd-orbit' }, el('span', { class: 'bd-dot bd-warm' }), el('span', { class: 'bd-dot bd-cool' }), el('span', { class: 'bd-dot bd-cool bd-dot3' })),
          el('div', { class: 'big-icon', text: '💫' }),
        ),
        el('h2', { text: t('tagline') }),
        el('p', { class: 'muted bd-desc', text: t('desc') }),
        segmented<Mode>(
          [
            { value: 'easy', label: t('easy') },
            { value: 'normal', label: t('normal') },
            { value: 'hard', label: t('hard') },
          ],
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            desc.textContent = t(m + 'Desc');
            updateBest();
          },
        ),
        desc,
        best,
        button(t('play'), () => enterGame(), { variant: 'primary', size: 'lg', class: 'bd-play' }),
        el(
          'div',
          { class: 'bd-opt' },
          el('span', { text: t('sensLabel') }),
          segmented<Sens>(
            [
              { value: '1', label: t('sens1') },
              { value: '1.5', label: t('sens15') },
              { value: '2', label: t('sens2') },
            ],
            sens,
            (s) => {
              sens = s;
              ctx.storage.set('sens', s);
            },
          ),
        ),
        el('p', { class: 'muted small', text: t('controlsHint') }),
      ),
    );
  }

  // ── Game view ──────────────────────────────────────────────────────────
  function enterGame(): void {
    teardownGameView();
    root.innerHTML = '';
    const area = el('div', { class: 'game-area bd-area' });
    pauseInfo = el('p', { class: 'muted bd-pause-info' });
    pauseEl = el(
      'div',
      { class: 'overlay bd-pause bd-hidden' },
      el('div', { class: 'bd-pause-icon', text: '⏸' }),
      el('h2', { text: t('paused') }),
      pauseInfo,
      button(t('resume'), () => resume(), { variant: 'primary', size: 'lg', class: 'bd-play' }),
      el(
        'div',
        { class: 'bd-pause-row' },
        button(t('restart'), () => newRun(), { variant: 'secondary' }),
        button(t('menu'), () => showStart(), { variant: 'secondary' }),
      ),
    );
    root.append(area);
    cv = createCanvas(area, () => onResize(), { className: 'game-canvas bd-canvas' });
    area.append(pauseEl);
    offPointer = onPointer(cv.canvas, {
      down(p) {
        if (p.event.cancelable) p.event.preventDefault();
        pointers.set(p.id, { x: p.x, y: p.y });
        if (driver === null) driver = p.id;
        if (state === 'ready') beginRunning();
      },
      move(p) {
        const prev = pointers.get(p.id);
        if (!prev) return;
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        prev.x = p.x;
        prev.y = p.y;
        if (p.id !== driver || state !== 'running' || !world) return;
        const k = (Number(sens) / view.scale) * (isFocus() ? FOCUS_MUL : 1);
        moveShip(world, dx * k, dy * k);
      },
      up(p) {
        release(p.id);
      },
      cancel(p) {
        release(p.id);
      },
    });
    headerRemovers = [
      ctx.addHeaderAction({ icon: '⏸', label: t('pause'), onClick: () => togglePause() }),
      ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: () => newRun() }),
    ];
    newRun();
  }

  function teardownGameView(): void {
    loop.stop();
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    headerRemovers.forEach((fn) => fn());
    headerRemovers = [];
    pauseEl = null;
    pauseInfo = null;
    bgCache = null;
    sprites.clear();
    pointers.clear();
    driver = null;
    keys.clear();
    gameOverModal?.close();
    gameOverModal = null;
  }

  function release(id: number): void {
    pointers.delete(id);
    if (driver === id) {
      driver = null;
      for (const k of pointers.keys()) {
        driver = k;
        break;
      }
    }
  }

  function isFocus(): boolean {
    return pointers.size >= 2 || keys.has('shift');
  }

  let runResult: { time: number; prev: number | null; isBest: boolean } | null = null;

  function newRun(): void {
    if (!cv) return;
    runResult = null;
    gameOverModal?.close();
    gameOverModal = null;
    const { W, H } = arenaSize(cv.width, cv.height);
    world = createWorld(mode, W, H);
    state = 'ready';
    readyIsResume = false;
    acc = 0;
    particles = [];
    floaters = [];
    announce = null;
    flash = { t: 0, color: '#fff' };
    shake = 0;
    dyingT = 0;
    passedBest = false;
    bestAtStart = ctx.storage.getBest(mode);
    lastShipX = world.ship.x;
    bank = 0;
    pointers.clear();
    driver = null;
    pauseEl?.classList.add('bd-hidden');
    layout();
    syncLoop();
    draw();
    updateStatus();
  }

  function beginRunning(): void {
    if (state !== 'ready' || !world) return;
    state = 'running';
    acc = 0;
    if (world.time === 0) {
      ctx.play('swoosh');
      announce = { title: t('phase', { n: 1 }), sub: t(introKey(1, world.cfg)), t: 0 };
    }
    ctx.haptic('light');
    syncLoop();
  }

  function pause(): void {
    if (state !== 'running' || !world) return;
    state = 'paused';
    pausedAt = performance.now();
    pointers.clear();
    driver = null;
    keys.clear();
    if (pauseInfo) pauseInfo.textContent = t('pausedInfo', { t: world.time.toFixed(2), p: world.phase });
    pauseEl?.classList.remove('bd-hidden');
    syncLoop();
    draw();
  }

  function resume(): void {
    if (state !== 'paused') return;
    pauseEl?.classList.add('bd-hidden');
    state = 'ready';
    readyIsResume = true;
    syncLoop();
    draw();
  }

  function togglePause(): void {
    if (state === 'running') pause();
    else if (state === 'paused' && performance.now() - pausedAt > 350) resume();
  }

  function syncLoop(): void {
    const animating = state === 'ready' || state === 'running' || state === 'dying' || (state === 'over' && particles.length > 0);
    if (visible && cv && animating) loop.start();
    else loop.stop();
  }

  // ── Layout & caches ────────────────────────────────────────────────────
  function onResize(): void {
    if (!cv) return;
    if (world && state === 'ready' && world.time === 0) {
      const { W, H } = arenaSize(cv.width, cv.height);
      if (W !== world.W || H !== world.H) {
        world = createWorld(mode, W, H);
        lastShipX = world.ship.x;
      }
    }
    layout();
    draw();
  }

  function layout(): void {
    if (!cv || !world) return;
    const s = Math.min(cv.width / world.W, cv.height / world.H);
    view.scale = s > 0 ? s : 1;
    view.ox = Math.round((cv.width - world.W * view.scale) / 2);
    view.oy = Math.round((cv.height - world.H * view.scale) / 2);
    sprites.clear();
    bgCache = null;
  }

  function pxScale(): number {
    return Math.max(0.5, view.scale * (cv?.dpr ?? 1));
  }

  function buildBg(): HTMLCanvasElement | null {
    if (!world || !cv) return null;
    const { W, H } = world;
    const px = pxScale();
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(W * px));
    c.height = Math.max(1, Math.ceil(H * px));
    const g = c.getContext('2d');
    if (!g) return null;
    g.setTransform(px, 0, 0, px, 0, 0);
    const grad = g.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H * 0.5, Math.max(W, H) * 0.75);
    grad.addColorStop(0, pal.arenaIn);
    grad.addColorStop(1, pal.arenaOut);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const cell = 30;
    const lw = 1 / view.scale;
    g.lineWidth = lw;
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass === 0 ? pal.grid : pal.gridMajor;
      g.beginPath();
      for (let x = W / 2 % cell, i = 0; x <= W; x += cell, i++) {
        const major = Math.abs(x - W / 2) % (cell * 3) < 0.5;
        if (major !== (pass === 1)) continue;
        g.moveTo(Math.round(x * px) / px + lw / 2, 0);
        g.lineTo(Math.round(x * px) / px + lw / 2, H);
      }
      for (let y = H / 2 % cell; y <= H; y += cell) {
        const major = Math.abs(y - H / 2) % (cell * 3) < 0.5;
        if (major !== (pass === 1)) continue;
        g.moveTo(0, Math.round(y * px) / px + lw / 2);
        g.lineTo(W, Math.round(y * px) / px + lw / 2);
      }
      g.stroke();
    }
    g.strokeStyle = pal.border;
    g.lineWidth = lw * 1.5;
    g.strokeRect(lw, lw, W - 2 * lw, H - 2 * lw);
    return c;
  }

  function bulletSprite(kind: Bullet['kind'], r: number): Sprite {
    const key = (kind === 'aim' ? 0 : kind === 'pat' ? 1 : 2) * 10000 + Math.round(r * 100);
    const hit = sprites.get(key);
    if (hit) return hit;
    const color = colorFor(kind);
    const R = r * (pal.dark ? 2.6 : 1.9);
    const px = pxScale();
    const size = Math.max(2, Math.ceil(R * 2 * px));
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const spr = { c, R };
    if (!g) return spr;
    const k = size / (2 * R);
    g.setTransform(k, 0, 0, k, R * k, R * k);
    const halo = g.createRadialGradient(0, 0, r * 0.6, 0, 0, R);
    halo.addColorStop(0, rgba(color, pal.dark ? 0.55 : 0.3));
    halo.addColorStop(1, rgba(color, 0));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    if (pal.dark) {
      const hot = g.createRadialGradient(0, 0, 0, 0, 0, r);
      hot.addColorStop(0, 'rgba(255,255,255,1)');
      hot.addColorStop(0.5, 'rgba(255,255,255,0.85)');
      hot.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hot;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
    } else {
      g.strokeStyle = shade(color, 0.6);
      g.lineWidth = Math.max(0.9, r * 0.22);
      g.beginPath();
      g.arc(0, 0, r - g.lineWidth / 2, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.beginPath();
      g.arc(-r * 0.12, -r * 0.12, r * 0.42, 0, Math.PI * 2);
      g.fill();
    }
    sprites.set(key, spr);
    return spr;
  }

  // ── Frame ──────────────────────────────────────────────────────────────
  function frame(dt: number): void {
    animT += dt;
    if (!world) return;
    if (state === 'running') {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < MAX_STEPS) {
        keyboardMove(STEP);
        step(world, STEP);
        acc -= STEP;
        n++;
        handleEvents();
        if (state !== 'running') break;
      }
      if (n >= MAX_STEPS) acc = 0;
      checkBest();
    } else if (state === 'dying') {
      dyingT += dt;
      advanceBullets(world, dt * 0.25);
      if (dyingT >= DYING_TIME) gameOver();
    }
    // Bank the ship with horizontal motion (visual only).
    const vx = (world.ship.x - lastShipX) / Math.max(dt, 1e-3);
    lastShipX = world.ship.x;
    bank += (Math.max(-0.35, Math.min(0.35, vx / 900)) - bank) * Math.min(1, dt * 12);
    updateEffects(dt);
    draw();
    updateStatus();
    if (state === 'over' && particles.length === 0) syncLoop();
  }

  function keyboardMove(dt: number): void {
    if (!world || keys.size === 0) return;
    let dx = 0;
    let dy = 0;
    if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
    if (keys.has('arrowright') || keys.has('d')) dx += 1;
    if (keys.has('arrowup') || keys.has('w')) dy -= 1;
    if (keys.has('arrowdown') || keys.has('s')) dy += 1;
    if (!dx && !dy) return;
    const len = Math.hypot(dx, dy);
    const sp = KEY_SPEED * (isFocus() ? FOCUS_MUL : 1) * dt;
    moveShip(world, (dx / len) * sp, (dy / len) * sp);
  }

  function checkBest(): void {
    if (!world || passedBest || bestAtStart === null || bestAtStart <= 0) return;
    if (world.time > bestAtStart) {
      passedBest = true;
      ctx.play('success');
      ctx.haptic('success');
      floaters.push({ text: t('beatBest'), x: world.W / 2, y: 92, t: 0, color: pal.success });
    }
  }

  // ── Events → feedback ──────────────────────────────────────────────────
  function handleEvents(): void {
    if (!world) return;
    const evs = world.events;
    if (!evs.length) return;
    for (const e of evs) onEvent(e);
    evs.length = 0;
  }

  function onEvent(e: GameEvent): void {
    if (!world) return;
    switch (e.type) {
      case 'phase':
        ctx.play('tick');
        ctx.haptic('light');
        announce = { title: t('phase', { n: e.phase }), sub: t(introKey(e.phase, world.cfg)), t: 0 };
        break;
      case 'emit':
        if ((e.pattern === 'radial' || e.pattern === 'spiral') && animT - lastShootSound > 0.9) {
          lastShootSound = animT;
          ctx.play('shoot');
        }
        if (e.pattern === 'radial') burst(e.x, e.y, 10, pal.cool, 90, 0.35, 2);
        break;
      case 'hit':
        ctx.play('pop');
        ctx.haptic('heavy');
        burst(e.x, e.y, 26, pal.danger, 170, 0.6, 2.4);
        ring(e.x, e.y, pal.danger);
        flash = { t: 0.35, color: pal.danger };
        shake = 0.3;
        floaters.push({ text: t('lifeLost'), x: e.x, y: e.y - 26, t: 0, color: pal.danger });
        break;
      case 'shieldBreak':
        ctx.play('pop');
        ctx.haptic('medium');
        ring(e.x, e.y, pal.shield);
        burst(e.x, e.y, 18, pal.shield, 140, 0.5, 2);
        flash = { t: 0.2, color: pal.shield };
        shake = 0.18;
        floaters.push({ text: t('shieldBroken'), x: e.x, y: e.y - 28, t: 0, color: pal.shield });
        break;
      case 'death':
        ctx.play('explosion');
        ctx.haptic('heavy');
        burst(e.x, e.y, 70, pal.ship, 240, 1.0, 2.8);
        burst(e.x, e.y, 30, '#ffffff', 140, 0.7, 2);
        burst(e.x, e.y, 24, pal.warm, 200, 0.9, 2.2);
        ring(e.x, e.y, pal.warm);
        flash = { t: 0.45, color: pal.dark ? '#ffffff' : pal.danger };
        shake = 0.45;
        state = 'dying';
        dyingT = 0;
        // Record the run immediately so restarting/leaving during the death animation never loses a best.
        if (world) {
          const time = roundTime(world.time);
          const prev = ctx.storage.getBest(mode);
          runResult = { time, prev, isBest: ctx.storage.recordBest(mode, time, 'higher') };
        }
        pointers.clear();
        driver = null;
        break;
      case 'pickup':
        ctx.play('coin');
        ctx.haptic('light');
        ring(e.x, e.y, e.kind === 'shield' ? pal.shield : pal.slow);
        burst(e.x, e.y, 16, e.kind === 'shield' ? pal.shield : pal.slow, 120, 0.5, 2);
        floaters.push({ text: t(e.kind === 'shield' ? 'shieldGot' : 'slowGot'), x: e.x, y: e.y - 24, t: 0, color: e.kind === 'shield' ? pal.shield : pal.slow });
        break;
      case 'powerExpire':
        burst(e.x, e.y, 8, pal.muted, 60, 0.4, 1.6);
        break;
      case 'graze':
        if (particles.length < 360) {
          const sx = world.ship.x;
          const sy = world.ship.y;
          burst(sx + (e.x - sx) * 0.5, sy + (e.y - sy) * 0.5, 3, pal.dark ? '#ffffff' : pal.ship, 70, 0.25, 1.4);
        }
        break;
      case 'clear':
        for (const p of e.points.slice(0, 40)) burst(p.x, p.y, 2, colorFor(p.kind), 60, 0.35, 1.8);
        break;
      case 'slowEnd':
        ctx.play('swoosh');
        break;
      case 'powerSpawn':
        break;
    }
  }

  function burst(x: number, y: number, n: number, color: string, speed: number, life: number, size: number): void {
    for (let i = 0; i < n && particles.length < 420; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.25 + Math.random() * 0.75);
      const l = life * (0.5 + Math.random() * 0.5);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: l, max: l, size: size * (0.6 + Math.random() * 0.6), color });
    }
  }

  const rings: { x: number; y: number; t: number; color: string }[] = [];
  function ring(x: number, y: number, color: string): void {
    rings.push({ x, y, t: 0, color });
  }

  function updateEffects(dt: number): void {
    let n = 0;
    for (const p of particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = Math.exp(-3 * dt);
      p.vx *= drag;
      p.vy *= drag;
      particles[n++] = p;
    }
    particles.length = n;
    n = 0;
    for (const f of floaters) {
      f.t += dt;
      if (f.t < 1.1) floaters[n++] = f;
    }
    floaters.length = n;
    n = 0;
    for (const r of rings) {
      r.t += dt;
      if (r.t < 0.5) rings[n++] = r;
    }
    rings.length = n;
    if (announce) {
      announce.t += dt;
      if (announce.t > 1.9) announce = null;
    }
    if (flash.t > 0) flash.t = Math.max(0, flash.t - dt);
    if (shake > 0) shake = Math.max(0, shake - dt);
  }

  function colorFor(kind: Bullet['kind']): string {
    return kind === 'aim' ? pal.warm : kind === 'orb' ? pal.orb : pal.cool;
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  function draw(): void {
    if (!cv) return;
    const g = cv.ctx;
    g.fillStyle = pal.page;
    g.fillRect(0, 0, cv.width, cv.height);
    if (!world) return;
    const w = world;
    if (!bgCache) bgCache = buildBg();
    let sx = 0;
    let sy = 0;
    if (shake > 0 && !reduceMotion) {
      const m = shake * 14;
      sx = (Math.random() * 2 - 1) * m;
      sy = (Math.random() * 2 - 1) * m;
    }
    g.save();
    g.translate(view.ox + sx, view.oy + sy);
    g.scale(view.scale, view.scale);
    g.beginPath();
    g.rect(0, 0, w.W, w.H);
    g.clip();
    if (bgCache) g.drawImage(bgCache, 0, 0, w.W, w.H);
    else {
      g.fillStyle = pal.arenaOut;
      g.fillRect(0, 0, w.W, w.H);
    }
    const slowAmt = Math.max(0, Math.min(1, (1 - w.timeScale) / (1 - SLOW_SCALE)));
    if (slowAmt > 0.001) {
      g.fillStyle = rgba(pal.slow, 0.1 * slowAmt);
      g.fillRect(0, 0, w.W, w.H);
    }
    // HUD text, announcements and the ready prompt sit *under* the bullets so they never hide a threat.
    drawHud(g, w);
    drawAnnounce(g, w);
    if (state === 'ready') drawReady(g, w);
    drawTelegraphs(g, w);
    drawPowerUps(g, w);
    drawBullets(g, w);
    if (w.alive) drawShip(g, w);
    drawEffects(g);
    if (flash.t > 0) {
      // Edge vignette + a light wash: reads as impact without blinding the player.
      const k = Math.min(1, flash.t / 0.35);
      const vg = g.createRadialGradient(w.W / 2, w.H / 2, Math.min(w.W, w.H) * 0.3, w.W / 2, w.H / 2, Math.max(w.W, w.H) * 0.72);
      vg.addColorStop(0, rgba(flash.color, 0));
      vg.addColorStop(1, rgba(flash.color, 0.5 * k));
      g.fillStyle = vg;
      g.fillRect(0, 0, w.W, w.H);
      g.globalAlpha = (pal.dark ? 0.16 : 0.1) * k;
      g.fillStyle = flash.color;
      g.fillRect(0, 0, w.W, w.H);
      g.globalAlpha = 1;
    }
    g.restore();
  }

  function drawHud(g: CanvasRenderingContext2D, w: World): void {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 40px ${MONO}`;
    g.fillStyle = rgba(pal.dark ? '#e8ecf3' : '#171a21', 0.82);
    g.fillText(w.time.toFixed(2), w.W / 2, 38);
    g.font = `600 12px ${SANS}`;
    if (passedBest) {
      g.fillStyle = pal.success;
      g.fillText(t('beatBest'), w.W / 2, 66);
    } else if (bestAtStart !== null) {
      g.fillStyle = pal.muted;
      g.fillText(t('bestShort', { t: bestAtStart.toFixed(2) }), w.W / 2, 66);
    }
    // Slow-mo meter
    if (w.slowLeft > 0) {
      const bw = 96;
      const f = w.slowLeft / SLOW_DURATION;
      g.fillStyle = rgba(pal.slow, 0.22);
      g.fillRect(w.W / 2 - bw / 2, 78, bw, 4);
      g.fillStyle = pal.slow;
      g.fillRect(w.W / 2 - bw / 2, 78, bw * f, 4);
    }
    // Phase tag
    g.textAlign = 'right';
    g.font = `700 12px ${SANS}`;
    g.fillStyle = pal.muted;
    g.fillText(t('phaseTag', { n: w.phase }), w.W - 12, 18);
    if (w.grazes > 0) {
      g.font = `600 11px ${SANS}`;
      g.fillText(t('grazeTag', { n: w.grazes }), w.W - 12, 34);
    }
    // Lives (easy) and shield
    let x = 16;
    if (w.cfg.lives > 1) {
      for (let i = 0; i < w.cfg.lives; i++) {
        drawMiniShip(g, x, 18, i < w.lives);
        x += 18;
      }
    }
    if (w.shield) {
      drawShieldIcon(g, x + 2, 18, 6.5, pal.shield);
    }
    if (isFocus() && state === 'running') {
      g.textAlign = 'center';
      g.font = `700 11px ${SANS}`;
      g.fillStyle = pal.muted;
      g.fillText(t('focus').toUpperCase(), w.W / 2, w.H - 14);
    }
  }

  function drawMiniShip(g: CanvasRenderingContext2D, x: number, y: number, filled: boolean): void {
    g.beginPath();
    g.moveTo(x, y - 7);
    g.lineTo(x + 5.5, y + 5);
    g.lineTo(x, y + 2.5);
    g.lineTo(x - 5.5, y + 5);
    g.closePath();
    if (filled) {
      g.fillStyle = pal.ship;
      g.fill();
    } else {
      g.strokeStyle = pal.muted;
      g.lineWidth = 1;
      g.stroke();
    }
  }

  function shieldPath(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.85, y - s * 0.62);
    g.lineTo(x + s * 0.78, y + s * 0.15);
    g.quadraticCurveTo(x + s * 0.55, y + s * 0.8, x, y + s * 1.05);
    g.quadraticCurveTo(x - s * 0.55, y + s * 0.8, x - s * 0.78, y + s * 0.15);
    g.lineTo(x - s * 0.85, y - s * 0.62);
    g.closePath();
  }

  function drawShieldIcon(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
    shieldPath(g, x, y, s);
    g.fillStyle = color;
    g.fill();
  }

  function hourglassPath(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    g.beginPath();
    g.moveTo(x - s * 0.7, y - s);
    g.lineTo(x + s * 0.7, y - s);
    g.lineTo(x + s * 0.12, y);
    g.lineTo(x + s * 0.7, y + s);
    g.lineTo(x - s * 0.7, y + s);
    g.lineTo(x - s * 0.12, y);
    g.closePath();
  }

  function drawTelegraphs(g: CanvasRenderingContext2D, w: World): void {
    for (const e of w.emitters) {
      const warn = e.t < e.delay;
      const k = warn ? e.t / e.delay : 1;
      const blink = 0.55 + 0.45 * Math.sin(e.t * 28);
      const isWarm = e.type === 'aimed' || e.type === 'fan';
      const color = isWarm ? pal.warm : e.type === 'homing' ? pal.orb : pal.cool;
      if (e.type === 'radial' || e.type === 'spiral') {
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        if (warn) {
          g.globalAlpha = 0.25 + 0.65 * k;
          g.beginPath();
          g.arc(e.x, e.y, 8 + 26 * (1 - k), 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 0.6 * blink;
          g.beginPath();
          g.moveTo(e.x - 6, e.y);
          g.lineTo(e.x + 6, e.y);
          g.moveTo(e.x, e.y - 6);
          g.lineTo(e.x, e.y + 6);
          g.stroke();
        } else {
          // Active spiral core
          g.globalAlpha = 0.85;
          const a = animT * 6 * (e.spin >= 0 ? 1 : -1);
          g.beginPath();
          for (let i = 0; i < 3; i++) {
            const aa = a + (i * Math.PI * 2) / 3;
            g.moveTo(e.x + Math.cos(aa) * 9, e.y + Math.sin(aa) * 9);
            g.arc(e.x, e.y, 9, aa, aa + 1.2);
          }
          g.stroke();
          g.fillStyle = color;
          g.beginPath();
          g.arc(e.x, e.y, 3, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      } else if (e.type === 'wallH' || e.type === 'wallV') {
        if (!warn) continue;
        const gap = e.gaps[0];
        const half = e.gapW / 2;
        const th = 4;
        const depth = 22;
        const alpha = 0.45 + 0.55 * blink;
        if (e.type === 'wallH') {
          const glow = g.createLinearGradient(0, 0, 0, depth);
          glow.addColorStop(0, rgba(color, 0.35 * alpha));
          glow.addColorStop(1, rgba(color, 0));
          g.fillStyle = glow;
          g.fillRect(0, 0, gap - half, depth);
          g.fillRect(gap + half, 0, w.W - gap - half, depth);
          g.globalAlpha = alpha;
          g.fillStyle = color;
          g.fillRect(0, 0, gap - half, th);
          g.fillRect(gap + half, 0, w.W - gap - half, th);
          drawGapMarks(g, gap - half, gap + half, th + 1, true);
        } else {
          const fromLeft = e.dir > 0;
          const x0 = fromLeft ? 0 : w.W - depth;
          const glow = g.createLinearGradient(fromLeft ? 0 : w.W, 0, fromLeft ? depth : w.W - depth, 0);
          glow.addColorStop(0, rgba(color, 0.35 * alpha));
          glow.addColorStop(1, rgba(color, 0));
          g.fillStyle = glow;
          g.fillRect(x0, 0, depth, gap - half);
          g.fillRect(x0, gap + half, depth, w.H - gap - half);
          g.globalAlpha = alpha;
          g.fillStyle = color;
          const xl = fromLeft ? 0 : w.W - th;
          g.fillRect(xl, 0, th, gap - half);
          g.fillRect(xl, gap + half, th, w.H - gap - half);
          drawGapMarks(g, gap - half, gap + half, fromLeft ? th + 1 : w.W - th - 1, false);
        }
        g.globalAlpha = 1;
      } else {
        if (!warn && !(e.type === 'aimed' || e.type === 'fan' || e.type === 'bounce')) continue;
        // Edge spawner: chevron pointing inwards.
        const ang = Math.atan2(e.ny, e.nx);
        g.save();
        g.translate(e.x + e.nx * 4, e.y + e.ny * 4);
        g.rotate(ang);
        g.globalAlpha = warn ? 0.4 + 0.6 * blink : 0.5;
        g.fillStyle = color;
        const s = e.sniper ? 6 : 8;
        g.beginPath();
        g.moveTo(s + 2, 0);
        g.lineTo(-2, -s);
        g.lineTo(-2, s);
        g.closePath();
        g.fill();
        if (warn) {
          g.strokeStyle = color;
          g.lineWidth = 1.2;
          g.globalAlpha = 0.5 * (1 - k) + 0.2;
          g.beginPath();
          g.arc(0, 0, 10 + 14 * (1 - k), -Math.PI / 2, Math.PI / 2);
          g.stroke();
        }
        g.restore();
        g.globalAlpha = 1;
      }
    }
  }

  function drawGapMarks(g: CanvasRenderingContext2D, a: number, b: number, at: number, horizontal: boolean): void {
    // Arrow heads on both sides of the opening, pointing into it.
    const s = 7;
    g.beginPath();
    if (horizontal) {
      g.moveTo(a + 1, at);
      g.lineTo(a - s, at);
      g.lineTo(a - s, at + s * 1.3);
      g.closePath();
      g.moveTo(b - 1, at);
      g.lineTo(b + s, at);
      g.lineTo(b + s, at + s * 1.3);
      g.closePath();
    } else {
      const d = at < 50 ? 1 : -1;
      g.moveTo(at, a + 1);
      g.lineTo(at, a - s);
      g.lineTo(at + d * s * 1.3, a - s);
      g.closePath();
      g.moveTo(at, b - 1);
      g.lineTo(at, b + s);
      g.lineTo(at + d * s * 1.3, b + s);
      g.closePath();
    }
    g.fill();
  }

  function drawPowerUps(g: CanvasRenderingContext2D, w: World): void {
    for (const p of w.powerups) {
      const left = p.life - p.age;
      if (left < 2 && Math.floor(left * 8) % 2 === 0) continue;
      const color = p.kind === 'shield' ? pal.shield : pal.slow;
      const pulse = 1 + 0.08 * Math.sin(p.age * 6);
      const appear = Math.min(1, p.age * 5);
      const R = 12 * pulse * appear;
      g.globalAlpha = 0.25;
      g.fillStyle = color;
      g.beginPath();
      g.arc(p.x, p.y, R + 7, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(p.x, p.y, R, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = '#ffffff';
      if (p.kind === 'shield') shieldPath(g, p.x, p.y - 0.5, 6.5 * appear);
      else hourglassPath(g, p.x, p.y, 6.5 * appear);
      g.fill();
    }
  }

  function drawBullets(g: CanvasRenderingContext2D, w: World): void {
    for (const b of w.bullets) {
      const spr = bulletSprite(b.kind, b.r);
      let R = spr.R;
      if (b.kind === 'orb') R *= 1 + 0.12 * Math.sin(b.age * 8);
      g.drawImage(spr.c, b.x - R, b.y - R, R * 2, R * 2);
      if (b.bounces > 0) {
        g.strokeStyle = rgba(pal.dark ? '#ffffff' : '#0a1a33', 0.55);
        g.lineWidth = 1;
        g.beginPath();
        g.arc(b.x, b.y, b.r + 2.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  function drawShip(g: CanvasRenderingContext2D, w: World): void {
    const { x, y } = w.ship;
    const flicker = w.invuln > 0 && Math.floor(w.invuln * 14) % 2 === 0;
    g.save();
    g.translate(x, y);
    // Shield bubble
    if (w.shield) {
      const a = 0.65 + 0.25 * Math.sin(animT * 5);
      g.globalAlpha = 0.12;
      g.fillStyle = pal.shield;
      g.beginPath();
      g.arc(0, 0, 18, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = a;
      g.strokeStyle = pal.shield;
      g.lineWidth = 2;
      g.stroke();
      g.globalAlpha = 1;
    }
    g.save();
    g.rotate(bank);
    g.globalAlpha = flicker ? 0.28 : 1;
    // Engine flame
    const fl = 5 + Math.random() * 4;
    g.fillStyle = pal.dark ? 'rgba(255,170,80,0.9)' : 'rgba(255,120,40,0.9)';
    g.beginPath();
    g.moveTo(-3.2, 6.5);
    g.lineTo(0, 6.5 + fl);
    g.lineTo(3.2, 6.5);
    g.closePath();
    g.fill();
    // Body
    const grad = g.createLinearGradient(0, -12, 0, 9);
    grad.addColorStop(0, pal.ship);
    grad.addColorStop(1, pal.ship2);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -12.5);
    g.lineTo(9, 8.5);
    g.lineTo(0, 4.5);
    g.lineTo(-9, 8.5);
    g.closePath();
    g.fill();
    g.strokeStyle = pal.shipEdge;
    g.lineWidth = 1;
    g.stroke();
    g.restore();
    // Core (always fully visible: it is the hitbox)
    if (pal.dark) {
      const glow = g.createRadialGradient(0, 0, 1, 0, 0, 10);
      glow.addColorStop(0, 'rgba(255,255,255,0.9)');
      glow.addColorStop(0.4, rgba(pal.cool, 0.45));
      glow.addColorStop(1, rgba(pal.cool, 0));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(0, 0, 10, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = pal.core;
    g.beginPath();
    g.arc(0, 0, CORE_R - 0.4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = pal.coreRing;
    g.lineWidth = 1.1;
    g.stroke();
    if (isFocus() && state === 'running') {
      g.strokeStyle = rgba(pal.dark ? '#ffffff' : '#0a1a33', 0.7);
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.lineDashOffset = -animT * 12;
      g.beginPath();
      g.arc(0, 0, CORE_R + 7, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();
  }

  function drawEffects(g: CanvasRenderingContext2D): void {
    if (rings.length) {
      for (const r of rings) {
        const k = r.t / 0.5;
        g.globalAlpha = 1 - k;
        g.strokeStyle = r.color;
        g.lineWidth = 3 * (1 - k) + 0.5;
        g.beginPath();
        g.arc(r.x, r.y, 10 + 70 * k, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    if (particles.length) {
      const prev = g.globalCompositeOperation;
      if (pal.dark) g.globalCompositeOperation = 'lighter';
      for (const p of particles) {
        g.globalAlpha = Math.max(0, p.life / p.max);
        g.fillStyle = p.color;
        const s = p.size;
        g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      g.globalCompositeOperation = prev;
      g.globalAlpha = 1;
    }
    if (floaters.length) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `700 14px ${SANS}`;
      for (const f of floaters) {
        g.globalAlpha = f.t < 0.8 ? 1 : 1 - (f.t - 0.8) / 0.3;
        g.fillStyle = f.color;
        g.fillText(f.text, f.x, f.y - f.t * 26);
      }
      g.globalAlpha = 1;
    }
  }

  function band(g: CanvasRenderingContext2D, w: World, y: number, h: number, alpha: number): void {
    g.globalAlpha = alpha;
    g.fillStyle = pal.band;
    g.fillRect(0, y - h / 2, w.W, h);
    g.globalAlpha = 1;
  }

  function drawAnnounce(g: CanvasRenderingContext2D, w: World): void {
    if (!announce) return;
    const a = announce;
    const alpha = a.t < 0.15 ? a.t / 0.15 : a.t > 1.3 ? Math.max(0, 1 - (a.t - 1.3) / 0.6) : 1;
    const pop = 1 + 0.25 * Math.max(0, 1 - a.t / 0.2);
    const y = w.H * 0.36;
    band(g, w, y + 6, 70, alpha * 0.9);
    g.save();
    g.globalAlpha = alpha;
    g.translate(w.W / 2, y);
    g.scale(pop, pop);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 30px ${SANS}`;
    g.fillStyle = pal.text;
    g.fillText(a.title, 0, -6);
    g.font = `600 14px ${SANS}`;
    g.fillStyle = pal.dark ? pal.cool : shade(pal.cool, 0.85);
    g.fillText(a.sub, 0, 20);
    g.restore();
  }

  function drawReady(g: CanvasRenderingContext2D, w: World): void {
    const y = w.H * 0.46;
    band(g, w, y, 74, 1);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 21px ${SANS}`;
    g.fillStyle = pal.text;
    g.fillText(t(readyIsResume ? 'resumeTitle' : 'readyTitle'), w.W / 2, y - 12);
    g.font = `500 13px ${SANS}`;
    g.fillStyle = pal.muted;
    g.fillText(t(readyIsResume ? 'resumeSub' : 'readySub'), w.W / 2, y + 15, w.W - 24);
    // Pulsing touch hint below the ship
    const { x: sx, y: shy } = w.ship;
    const hy = Math.min(w.H - 26, shy + 56);
    const k = (animT % 1.4) / 1.4;
    g.strokeStyle = pal.dark ? pal.cool : pal.ship;
    g.lineWidth = 2;
    g.globalAlpha = 1 - k;
    g.beginPath();
    g.arc(sx, hy, 8 + 18 * k, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 0.8;
    g.fillStyle = pal.dark ? pal.cool : pal.ship;
    g.beginPath();
    g.arc(sx, hy, 6, 0, Math.PI * 2);
    g.fill();
    // Drag arrows
    const off = 26 + Math.sin(animT * 3) * 3;
    g.beginPath();
    g.moveTo(sx - off - 6, hy);
    g.lineTo(sx - off, hy - 5);
    g.lineTo(sx - off, hy + 5);
    g.closePath();
    g.moveTo(sx + off + 6, hy);
    g.lineTo(sx + off, hy - 5);
    g.lineTo(sx + off, hy + 5);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
  }

  // ── Status & end of run ────────────────────────────────────────────────
  function modeLabel(m: Mode): string {
    return t(m);
  }

  function setStatus(s: string): void {
    if (s === lastStatus) return;
    lastStatus = s;
    ctx.setStatus(s);
  }

  function updateStatus(): void {
    if (!world || state === 'start') return setStatus('');
    setStatus(`${modeLabel(mode)} · ${t('phaseTag', { n: world.phase })} · ${formatTime(world.time)}`);
  }

  function gameOver(): void {
    if (!world || state !== 'dying') return;
    state = 'over';
    const time = runResult?.time ?? roundTime(world.time);
    const prev = runResult ? runResult.prev : ctx.storage.getBest(mode);
    const isBest = runResult ? runResult.isBest : ctx.storage.recordBest(mode, time, 'higher');
    runResult = null;
    const best = ctx.storage.getBest(mode) ?? time;
    ctx.play(isBest ? 'win' : 'lose');
    ctx.haptic(isBest ? 'success' : 'error');
    const chip = (label: string, value: string | number) => el('div', { class: 'bd-chip' }, el('span', { class: 'muted', text: label + ' ' }), el('b', { text: String(value) }));
    const body = el(
      'div',
      { class: 'bd-result' },
      el('div', { class: 'bd-result-label', text: `${t('survived')} · ${modeLabel(mode)}` }),
      el('div', { class: 'bd-result-time' }, el('span', { text: time.toFixed(2) }), el('small', { text: t('unit') })),
      el(
        'div',
        { class: 'bd-chips' },
        chip(t('statPhase'), world.phase),
        chip(t('statGraze'), world.grazes),
        chip(t('statPickups'), world.pickups),
      ),
      isBest
        ? prev !== null
          ? el('div', { class: 'bd-result-best bd-new', text: t('prevBest', { t: prev.toFixed(2) }) })
          : null
        : el('div', { class: 'bd-result-best', text: t('bestLine', { t: best.toFixed(2) }) }),
    );
    gameOverModal = ctx.showModal({
      title: isBest ? '🏆 ' + t('newBest') : t('lose'),
      body,
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        { label: t('menu'), onClick: () => showStart() },
        { label: t('retry'), primary: true, onClick: () => newRun() },
      ],
    });
    updateStatus();
    syncLoop();
  }

  // ── Global listeners ───────────────────────────────────────────────────
  const MOVE_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's']);
  const onKeyDown = (e: KeyboardEvent) => {
    if (state === 'start' || state === 'over' || !cv) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (document.querySelector('.modal-backdrop.open')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') {
      if (!e.repeat) {
        if (state === 'running') pause();
        else if (state === 'paused') resume();
      }
      e.preventDefault();
      return;
    }
    if (k === 'shift') {
      keys.add('shift');
      return;
    }
    if (MOVE_KEYS.has(k)) {
      e.preventDefault();
      if (state === 'paused') return;
      keys.add(k);
      if (state === 'ready') beginRunning();
      return;
    }
    if ((k === ' ' || k === 'enter') && state === 'ready') {
      e.preventDefault();
      beginRunning();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.key.toLowerCase());
  };
  // Touching anything outside the game (e.g. the header's rules button) while playing pauses the run.
  const onDocPointer = (e: PointerEvent) => {
    if (state === 'running' && e.target instanceof Node && !root.contains(e.target)) pause();
  };
  const onBlur = () => {
    keys.clear();
    pause();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerdown', onDocPointer, true);

  ctx.onVisibility((v) => {
    visible = v;
    if (!v) {
      pause();
      keys.clear();
    }
    syncLoop();
    if (v) draw();
  });
  ctx.onThemeChange(() => {
    pal = palette(ctx.cssVar);
    sprites.clear();
    bgCache = null;
    draw();
  });

  function destroy(): void {
    teardownGameView();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('pointerdown', onDocPointer, true);
    world = null;
    particles = [];
  }

  showStart();
  return { destroy };
}

const game: GameModule = { strings, create };
export default game;
