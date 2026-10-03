import type { GameContext, GameInstance, GameModule, ThemeName } from '../../app/types';
import { el, button, segmented } from '../../app/ui';
import { createCanvas, createLoop, onPointer, roundRect, type CanvasHandle } from '../../app/canvas';
import {
  CAMPAIGN_LEVELS,
  DT,
  EXHAUST_REACH,
  FEET,
  FOOT_PAD,
  FOOT_X,
  FOOT_Y,
  MAX_TILT,
  MAX_VX,
  MAX_VY,
  READY_TIME,
  WORLD_W,
  altitudeAbove,
  cameraTargetY,
  clamp,
  createLevel,
  currentWind,
  exhaustGroundHit,
  heightAt,
  normalizeAngle,
  overviewZoom,
  rng,
  sanitizeRun,
  smoothstep,
  stepLevel,
  toWorld,
  zoomFor,
  type CrashReason,
  type Input,
  type Level,
  type Pad,
  type Run,
} from './logic';
import { strings } from './strings';
import './style.css';


type Mode = 'campaign' | 'practice';

interface Palette {
  skyTop: string;
  skyBottom: string;
  star: string;
  starAlpha: number;
  hills: string;
  ground: string;
  groundDeep: string;
  groundEdge: string;
  pad: string;
  hull: string;
  hullDark: string;
  gold: string;
  goldDark: string;
  leg: string;
  nozzle: string;
  dust: string;
  smoke: string;
  sea: string;
  land: string;
  earthAlpha: number;
  text: string;
  muted: string;
  accent: string;
  danger: string;
  warning: string;
  success: string;
}

interface Particle {
  kind: 'debris' | 'smoke' | 'dust' | 'flash';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  angle: number;
  spin: number;
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
  ph: number;
}

interface LandingResult {
  level: number;
  mult: number;
  fuel: number;
  padPts: number;
  fuelPts: number;
  total: number;
  levelBest: boolean;
  campaignBest: boolean;
  campaignTotal: number;
  finishedCampaign: boolean;
}

const TAU = Math.PI * 2;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Noto Sans SC', sans-serif";
const FLAME_COLORS = ['#ff6a1f', '#ffb020', '#fff1a8'];
const DEBRIS_COLORS = ['#dfe4ee', '#9aa3b5', '#d9a62a', '#ff6a1f', '#6b7384'];
const MAX_PARTICLES = 260;
/** Distant hills: x range (m) and sample count of the parallax silhouette. */
const HILL_X0 = -WORLD_W;
const HILL_X1 = WORLD_W * 2;
const HILL_N = 72;
const HILL_DEPTH = 0.45;
/** Seconds the lander takes to rock upright onto both feet after a touchdown. */
const SETTLE_TIME = 0.32;
/** Decorative crater rim outside the level (only visible on wide screens): sample spacing (m) and count. */
const OUTER_STEP = 4;
const OUTER_N = 70;

/** Parse '#rgb', '#rrggbb' or 'rgb()/rgba()' into channels; null when the format is unknown. */
function rgbOf(c: string): [number, number, number] | null {
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** Blend two theme colours: t = 0 gives `a`, 1 gives `b`. */
function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  if (!x || !y) return a || b;
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * Canvas colours derived from the theme tokens (terrain from --surface-2, sky from --bg, details from --muted /
 * --text …). Only the lander's gold foil and the Earth keep fixed "object" colours.
 */
function palette(theme: ThemeName, cssVar: (n: string) => string): Palette {
  const dark = theme === 'dark';
  const v = (name: string, darkFallback: string, lightFallback: string): string => cssVar(name) || (dark ? darkFallback : lightFallback);
  const bg = v('--bg', '#0f1218', '#f4f6fb');
  const surface = v('--surface', '#1a1f2b', '#ffffff');
  const surface2 = v('--surface-2', '#232a39', '#eef1f7');
  const border = v('--border', '#2d3548', '#dde2ec');
  const text = v('--text', '#e8ecf3', '#171a21');
  const muted = v('--muted', '#8b94a7', '#5c6475');
  const accent = v('--accent', '#5b8cff', '#3366ff');
  const success = v('--success', '#3ddc97', '#1fa86b');
  // The regolith is --surface-2, shaded a little toward --muted so it stands out from the sky and the far hills.
  const ground = mix(surface2, muted, dark ? 0.18 : 0.3);
  return {
    skyTop: dark ? mix(bg, '#000000', 0.7) : mix(border, accent, 0.12),
    skyBottom: dark ? mix(bg, '#000000', 0.2) : mix(bg, accent, 0.04),
    star: dark ? text : muted,
    starAlpha: dark ? 1 : 0.45,
    hills: dark ? mix(bg, surface2, 0.15) : mix(border, bg, 0.25),
    ground,
    groundDeep: dark ? mix(surface2, bg, 0.5) : mix(surface2, muted, 0.55),
    groundEdge: dark ? mix(border, muted, 0.55) : mix(muted, text, 0.1),
    pad: success,
    hull: dark ? text : surface,
    hullDark: dark ? mix(muted, text, 0.1) : mix(muted, surface, 0.12),
    gold: '#d9a62a',
    goldDark: '#9c741a',
    leg: dark ? mix(muted, text, 0.45) : muted,
    nozzle: dark ? mix(muted, bg, 0.3) : mix(muted, text, 0.25),
    dust: dark ? muted : mix(muted, bg, 0.2),
    smoke: dark ? mix(muted, bg, 0.3) : muted,
    sea: dark ? '#3a74d8' : '#4f86e0',
    land: dark ? '#3fbf86' : '#3aa877',
    earthAlpha: dark ? 0.95 : 0.7,
    text,
    muted,
    accent,
    danger: v('--danger', '#ff5470', '#e0304f'),
    warning: v('--warning', '#ffc857', '#d9960a'),
    success,
  };
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const savedMode = ctx.storage.get<string>('mode', 'campaign');
  let mode: Mode = savedMode === 'practice' ? 'practice' : 'campaign';
  let unlocked = Math.max(1, Math.floor(Number(ctx.storage.get<number>('unlocked', 1)) || 1));
  let practiceLevel = clamp(Math.floor(Number(ctx.storage.get<number>('practiceLevel', 1)) || 1), 1, unlocked);
  let pal = palette(ctx.theme, ctx.cssVar);

  // ── Live state ────────────────────────────────────────────────────────
  let lv: Level | null = null;
  let cv: CanvasHandle | null = null;
  let loop: ReturnType<typeof createLoop> | null = null;
  let offPointer: (() => void) | null = null;
  /** Seed of the current campaign (or practice session). */
  let runSeed = 0;
  /** Campaign score banked by completed levels. */
  let runScore = 0;
  let paused = false;
  /** A dialog the game did not open (e.g. the header's rules "?") is covering a live flight. */
  let heldByModal = false;
  let acc = 0;
  let endTimer = 0;
  let clock = 0;
  let zoom = 3;
  let camX = WORLD_W / 2;
  let camY = 60;
  let camSnap = true;
  let shake = 0;
  let wasThrust = false;
  let lastThrustSound = 0;
  let lowFuelWarned = false;
  let emptyWarned = false;
  let landedAt = 0;
  /** Lander pose just before touchdown, so the settle onto the pad can be animated instead of snapped. */
  const preStep = { x: 0, y: 0, angle: 0 };
  let touchdown: { x: number; y: number; angle: number } | null = null;
  let showHint = false;
  /** Where the first-run hint box is drawn (eased, so it glides out of the lander's way). */
  let hintPos: { x: number; y: number } | null = null;
  let dustAcc = 0;
  let result: LandingResult | null = null;
  const particles: Particle[] = [];
  let stars: Star[] = [];
  let hills: number[] = [];
  /** Decorative outer slopes of the crater beyond the left / right level edge (heights every OUTER_STEP m). */
  let outerL: number[] = [];
  let outerR: number[] = [];

  // inputs
  let btnLeft = false;
  let btnRight = false;
  let btnThrust = false;
  let keyLeft = false;
  let keyRight = false;
  let keyThrust = false;
  const canvasPointers = new Map<number, number>();

  // HUD elements
  let hudAlt: HTMLElement | null = null;
  let hudV: HTMLElement | null = null;
  let hudH: HTMLElement | null = null;
  let hudTilt: HTMLElement | null = null;
  let fuelFill: HTMLElement | null = null;
  let fuelPct: HTMLElement | null = null;
  let hudCache = '';

  // ── Header actions (only while a level is on screen) ──────────────────
  let headerRemovers: (() => void)[] = [];
  function showHeaderActions(): void {
    if (headerRemovers.length) return;
    headerRemovers = [
      ctx.addHeaderAction({ icon: '⏸', label: t('pause'), onClick: () => pauseGame() }),
      ctx.addHeaderAction({ icon: '↻', label: t('restartLevel'), onClick: () => restartLevel() }),
    ];
  }
  function hideHeaderActions(): void {
    headerRemovers.forEach((r) => r());
    headerRemovers = [];
  }

  // ── Global listeners ──────────────────────────────────────────────────
  const onKey = (e: KeyboardEvent): void => {
    const down = e.type === 'keydown';
    if (down && modalOpen()) return; // a dialog has the keyboard; key releases still go through
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        keyLeft = down;
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        keyRight = down;
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
      case ' ':
        keyThrust = down;
        break;
      case 'p':
      case 'P':
      case 'Escape':
        if (down && lv && !e.repeat) pauseGame();
        break;
      default:
        return;
    }
    if (lv) e.preventDefault();
  };
  const onBlur = (): void => releaseInputs();
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', onBlur);

  // Dev-only hook so browser play scripts can inspect the live level state (stripped in production).
  const dbg = window as unknown as { __llState?: () => Level | null };
  if (import.meta.env.DEV) dbg.__llState = () => lv;

  ctx.onDestroy(() => {
    if (dbg.__llState) delete dbg.__llState;
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('blur', onBlur);
    teardown();
    hideHeaderActions();
  });
  ctx.onVisibility((visible) => {
    if (visible) {
      if (lv && cv) loop?.start();
    } else {
      releaseInputs();
      if (lv && (lv.phase === 'flying' || lv.phase === 'ready') && !paused) pauseGame();
      loop?.stop();
    }
  });
  ctx.onThemeChange((th) => {
    pal = palette(th, ctx.cssVar);
    if (lv && cv && !loop?.running) draw();
  });

  // ── Persistence helpers ───────────────────────────────────────────────
  function loadRun(): Run | null {
    return sanitizeRun(ctx.storage.get<unknown>('run', null));
  }
  function saveRun(run: Run): void {
    ctx.storage.set('run', run);
  }

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    teardown();
    hideHeaderActions();
    root.innerHTML = '';
    ctx.setStatus('');
    const panel = el('div', { class: 'll-panel' });
    const actions = el('div', { class: 'll-actions' });
    const renderPanel = (): void => {
      panel.innerHTML = '';
      actions.innerHTML = '';
      if (mode === 'campaign') {
        const b = ctx.storage.getBest('campaign');
        const run = loadRun();
        panel.append(
          el('p', { class: 'muted ll-info', text: t('campaignInfo') }),
          el('p', { class: 'll-best' + (b === null ? ' ll-none' : ''), text: b === null ? t('noBest') : t('bestCampaign', { n: b }) }),
        );
        if (run && run.level > 1) {
          panel.append(el('p', { class: 'll-progress', text: t('runProgress', { n: run.level, s: run.score }) }));
          actions.append(
            button(t('continueRun', { n: run.level }), () => continueCampaign(run), { variant: 'primary', size: 'lg' }),
            button(t('newCampaign'), () => confirmNewCampaign(run), { variant: 'secondary', size: 'md' }),
          );
        } else {
          actions.append(button(t('play'), () => newCampaign(), { variant: 'primary', size: 'lg' }));
        }
      } else {
        const label = el('div', { class: 'll-step-label' });
        const best = el('p', { class: 'll-best' });
        const prev = button(
          '‹',
          () => {
            practiceLevel = Math.max(1, practiceLevel - 1);
            ctx.storage.set('practiceLevel', practiceLevel);
            refresh();
          },
          { variant: 'secondary', class: 'll-step-btn' },
        );
        const next = button(
          '›',
          () => {
            practiceLevel = Math.min(unlocked, practiceLevel + 1);
            ctx.storage.set('practiceLevel', practiceLevel);
            refresh();
          },
          { variant: 'secondary', class: 'll-step-btn' },
        );
        prev.setAttribute('aria-label', t('prevLevel'));
        next.setAttribute('aria-label', t('nextLevel'));
        const refresh = (): void => {
          label.textContent = t('levelN', { n: practiceLevel });
          const b = ctx.storage.getBest('level-' + practiceLevel);
          best.textContent = b === null ? t('noBest') : t('bestLevel', { n: b });
          best.className = 'll-best' + (b === null ? ' ll-none' : '');
          prev.disabled = practiceLevel <= 1;
          next.disabled = practiceLevel >= unlocked;
        };
        refresh();
        panel.append(el('div', { class: 'll-stepper' }, prev, label, next), best, el('p', { class: 'muted small', text: t('unlockedN', { n: unlocked }) }));
        actions.append(button(t('play'), () => startPractice(), { variant: 'primary', size: 'lg' }));
      }
    };
    renderPanel();
    root.append(
      el(
        'div',
        { class: 'start-screen ll-start' },
        el('div', { class: 'big-icon', text: '🚀' }),
        el('p', { class: 'muted ll-desc', text: t('desc') }),
        segmented<Mode>(
          [
            { value: 'campaign', label: t('modeCampaign') },
            { value: 'practice', label: t('modePractice') },
          ],
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            renderPanel();
          },
        ),
        panel,
        actions,
        el('p', { class: 'muted small ll-limits', text: t('limits') }),
      ),
    );
  }

  function confirmNewCampaign(run: Run): void {
    ctx.showModal({
      title: t('newCampaign'),
      body: t('newCampaignConfirm', { n: run.level, s: run.score }),
      buttons: [
        { label: t('cancel') },
        { label: t('confirm'), primary: true, onClick: () => newCampaign() },
      ],
    });
  }

  function beginSession(): void {
    showHint = !ctx.storage.get('hinted', false);
    if (showHint) ctx.storage.set('hinted', true);
  }

  function newCampaign(): void {
    mode = 'campaign';
    runSeed = (Math.random() * 0x7fffffff) >>> 0;
    runScore = 0;
    saveRun({ level: 1, score: 0, seed: runSeed });
    beginSession();
    startLevel(1, seedFor(1));
  }

  function continueCampaign(run: Run): void {
    mode = 'campaign';
    runSeed = run.seed;
    runScore = run.score;
    showHint = false;
    startLevel(run.level, seedFor(run.level));
  }

  function startPractice(): void {
    mode = 'practice';
    runSeed = (Math.random() * 0x7fffffff) >>> 0;
    runScore = 0;
    beginSession();
    startLevel(practiceLevel, seedFor(practiceLevel));
  }

  function seedFor(level: number): number {
    return (runSeed + level * 7919 + 17) >>> 0;
  }

  // ── Level setup / teardown ────────────────────────────────────────────
  function teardown(): void {
    loop?.stop();
    loop = null;
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    lv = null;
    clearTimeout(endTimer);
    endTimer = 0;
    particles.length = 0;
    paused = false;
    heldByModal = false;
    result = null;
    releaseInputs();
    hudAlt = hudV = hudH = hudTilt = fuelFill = fuelPct = null;
    hudCache = '';
  }

  function releaseInputs(): void {
    btnLeft = btnRight = btnThrust = false;
    keyLeft = keyRight = keyThrust = false;
    canvasPointers.clear();
    wasThrust = false;
    root.querySelectorAll('.ll-btn.ll-active').forEach((b) => b.classList.remove('ll-active'));
  }

  function startLevel(level: number, seed: number): void {
    teardown();
    root.innerHTML = '';
    showHeaderActions();
    lv = createLevel(level, seed);
    acc = 0;
    clock = 0;
    shake = 0;
    camSnap = true;
    lowFuelWarned = false;
    emptyWarned = false;
    landedAt = 0;
    touchdown = null;
    hintPos = null;
    dustAcc = 0;
    const srand = rng(seed ^ 0x9e3779b9);
    stars = Array.from({ length: 120 }, () => ({
      x: srand(),
      y: srand(),
      r: 0.8 + srand() * 1.4,
      a: 0.35 + srand() * 0.65,
      tw: 1 + srand() * 3,
      ph: srand() * TAU,
    }));
    const p1 = srand() * TAU;
    const p2 = srand() * TAU;
    const p3 = srand() * TAU;
    hills = Array.from({ length: HILL_N + 1 }, (_, i) => {
      const x = HILL_X0 + ((HILL_X1 - HILL_X0) * i) / HILL_N;
      return 44 + 13 * Math.sin(x / 31 + p1) + 7 * Math.sin(x / 13 + p2) + 3 * Math.sin(x / 6 + p3);
    });
    // Beyond the walls the crater rim falls away into rolling ground (only seen when the view is wider than the level).
    const outerSlope = (crest: number, ph: number): number[] =>
      Array.from({ length: OUTER_N + 1 }, (_, i) => {
        const d = i * OUTER_STEP;
        const base = 34 + 9 * Math.sin(d / 27 + ph) + 4 * Math.sin(d / 9.5 + ph * 2.3);
        return crest + (base - crest) * smoothstep(d / 56);
      });
    const tp = lv.terrain.points;
    outerL = outerSlope(tp[0].y, srand() * TAU);
    outerR = outerSlope(tp[tp.length - 1].y, srand() * TAU);

    // HUD
    hudAlt = el('div', { class: 'stat-value', text: '–' });
    hudV = el('div', { class: 'stat-value', text: '–' });
    hudH = el('div', { class: 'stat-value', text: '–' });
    hudTilt = el('div', { class: 'stat-value', text: '–' });
    const hud = el('div', { class: 'game-hud ll-hud' }, stat(t('alt'), hudAlt), stat(t('vspeed'), hudV), stat(t('hspeed'), hudH), stat(t('tilt'), hudTilt));
    fuelFill = el('div', { class: 'll-fuel-fill' });
    fuelPct = el('div', { class: 'll-fuel-pct', text: '100%' });
    const fuelRow = el('div', { class: 'll-fuel' }, el('span', { text: t('fuel') }), el('div', { class: 'll-fuel-bar' }, fuelFill), fuelPct);
    const area = el('div', { class: 'game-area ll-area' });

    // Controls
    const left = holdButton(el('button', { class: 'll-btn', type: 'button', 'aria-label': t('rotateLeft'), text: '◀' }), (d) => (btnLeft = d));
    const thrustBtn = holdButton(
      el('button', { class: 'll-btn ll-thrust', type: 'button', 'aria-label': t('thrust') }, el('span', { text: '🔥' }), el('span', { class: 'll-btn-text', text: t('thrust') })),
      (d) => (btnThrust = d),
    );
    const right = holdButton(el('button', { class: 'll-btn', type: 'button', 'aria-label': t('rotateRight'), text: '▶' }), (d) => (btnRight = d));
    const controls = el('div', { class: 'll-controls' }, left, thrustBtn, right);

    root.append(hud, fuelRow, area, controls);
    updateStatus();

    cv = createCanvas(area, () => {
      camSnap = true;
      if (lv && cv && !loop?.running) draw();
    });
    offPointer = onPointer(cv.canvas, {
      down(p) {
        if (!cv) return;
        canvasPointers.set(p.id, p.x < cv.width / 2 ? -1 : 1);
      },
      move(p) {
        if (!cv || !canvasPointers.has(p.id)) return;
        canvasPointers.set(p.id, p.x < cv.width / 2 ? -1 : 1);
      },
      up(p) {
        canvasPointers.delete(p.id);
      },
    });
    cv.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    loop = createLoop((dt) => frame(dt));
    loop.start();
    ctx.play('tick');
  }

  function restartLevel(): void {
    if (!lv || lv.phase === 'landed') return; // the result is already banked; its modal is on the way
    ctx.play('swoosh');
    startLevel(lv.level, lv.seed);
  }

  function stat(label: string, value: HTMLElement): HTMLElement {
    return el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: label }), value);
  }

  /** A press-and-hold button driven by pointer events (multi-touch safe, no ghost clicks). */
  function holdButton(b: HTMLButtonElement, set: (down: boolean) => void): HTMLButtonElement {
    const active = new Set<number>();
    const down = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      active.add(e.pointerId);
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      b.classList.add('ll-active');
      set(true);
    };
    const up = (e: PointerEvent): void => {
      if (!active.delete(e.pointerId)) return;
      if (active.size === 0) {
        b.classList.remove('ll-active');
        set(false);
      }
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  function levelTitle(level: number): string {
    return level > CAMPAIGN_LEVELS ? `${t('endless')} · ${t('levelN', { n: level })}` : t('levelN', { n: level });
  }

  function updateStatus(): void {
    if (!lv) return;
    let s = mode === 'campaign' ? t('statusCampaign', { n: lv.level, s: runScore }) : t('statusPractice', { n: lv.level });
    if (lv.level > CAMPAIGN_LEVELS) s = `${t('endless')} · ${s}`;
    if (lv.cfg.wind > 0) s += ` · ${t('wind')} ${lv.windDir > 0 ? '→' : '←'}`;
    ctx.setStatus(s);
  }

  // ── Pause ─────────────────────────────────────────────────────────────
  /** True while any dialog is up (ours or the shell's, e.g. the rules sheet). */
  function modalOpen(): boolean {
    return document.querySelector('.modal-backdrop:not(.closing)') !== null;
  }

  function pauseGame(): void {
    if (!lv || paused || (lv.phase !== 'flying' && lv.phase !== 'ready')) return;
    paused = true;
    releaseInputs();
    ctx.showModal({
      title: t('paused'),
      body: mode === 'campaign' ? t('pausedCampaign', { n: lv.level, s: runScore }) : t('pausedBody', { n: lv.level }),
      dismissible: false,
      buttons: [
        { label: t('menu'), onClick: () => showStart() },
        {
          label: t('resume'),
          primary: true,
          onClick: () => {
            paused = false;
            acc = 0;
          },
        },
      ],
    });
  }

  // ── Frame ─────────────────────────────────────────────────────────────
  function currentInput(): Input {
    let rot = (btnLeft ? -1 : 0) + (btnRight ? 1 : 0) + (keyLeft ? -1 : 0) + (keyRight ? 1 : 0);
    for (const s of canvasPointers.values()) rot += s;
    return { thrust: btnThrust || keyThrust, rot: clamp(rot, -1, 1) };
  }

  function frame(dt: number): void {
    if (!lv || !cv) return;
    clock += dt;
    const live = lv.phase === 'ready' || lv.phase === 'flying';
    // Someone else's dialog (the rules "?") over a live flight freezes the simulation; when it closes, the
    // flight stays paused until the player resumes, so nobody crashes while reading.
    if (live && !paused && modalOpen()) {
      if (!heldByModal) {
        heldByModal = true;
        releaseInputs();
      }
    } else if (heldByModal) {
      heldByModal = false;
      acc = 0;
      if (live) pauseGame();
    }
    if (!paused && !heldByModal && live) {
      const input = currentInput();
      if (lv.phase === 'flying') {
        if (input.thrust && !wasThrust && lv.lander.fuel > 0 && clock - lastThrustSound > 0.25) {
          ctx.play('swoosh');
          lastThrustSound = clock;
        }
        wasThrust = input.thrust;
      }
      acc += dt;
      let steps = 0;
      while (acc >= DT && steps < 6) {
        preStep.x = lv.lander.x;
        preStep.y = lv.lander.y;
        preStep.angle = lv.lander.angle;
        const r = stepLevel(lv, input);
        acc -= DT;
        steps++;
        if (r) {
          onOutcome(r);
          break;
        }
      }
      if (steps >= 6) acc = 0;
      if (lv.phase === 'flying') {
        const fuel = lv.lander.fuel;
        if (!lowFuelWarned && fuel < 20) {
          lowFuelWarned = true;
          ctx.play('tick');
          ctx.haptic('medium');
        }
        if (!emptyWarned && fuel <= 0) {
          emptyWarned = true;
          ctx.play('error');
          ctx.haptic('heavy');
        }
        if (lv.lander.thrusting) kickDust(dt);
      }
    }
    updateParticles(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 2.2);
    updateCamera(dt);
    draw();
    updateHud();
    // Nothing left to animate once the flight is over and the debris has settled.
    if ((lv.phase === 'landed' || lv.phase === 'crashed') && particles.length === 0 && shake === 0 && clock - landedAt > 2.5) {
      loop?.stop();
    }
  }

  function onOutcome(r: 'landed' | 'crashed'): void {
    if (!lv) return;
    releaseInputs();
    landedAt = clock;
    const l = lv.lander;
    if (r === 'landed') {
      touchdown = { ...preStep };
      ctx.play('win');
      ctx.haptic('success');
      spawnDust(l.x, l.y + FOOT_Y);
      result = bankLanding();
      endTimer = window.setTimeout(showLanded, 950);
    } else {
      ctx.play('explosion');
      ctx.haptic('heavy');
      spawnExplosion(l.x, l.y);
      shake = 1;
      endTimer = window.setTimeout(showCrashed, 1300);
    }
  }

  /** Record a landing immediately (bests, unlocks, campaign progress) so nothing is lost if the player leaves. */
  function bankLanding(): LandingResult | null {
    if (!lv || lv.outcome?.kind !== 'landed') return null;
    const level = lv.level;
    const { pad, score } = lv.outcome;
    const levelBest = ctx.storage.recordBest('level-' + level, score.total, 'higher');
    if (level + 1 > unlocked) {
      unlocked = level + 1;
      ctx.storage.set('unlocked', unlocked);
    }
    let campaignBest = false;
    if (mode === 'campaign') {
      runScore += score.total;
      campaignBest = ctx.storage.recordBest('campaign', runScore, 'higher');
      saveRun({ level: level + 1, score: runScore, seed: runSeed });
      updateStatus();
    } else {
      practiceLevel = Math.min(unlocked, level + 1);
      ctx.storage.set('practiceLevel', practiceLevel);
    }
    return {
      level,
      mult: pad.mult,
      fuel: Math.round(lv.lander.fuel),
      padPts: score.padPts,
      fuelPts: score.fuelPts,
      total: score.total,
      levelBest,
      campaignBest,
      campaignTotal: runScore,
      finishedCampaign: mode === 'campaign' && level === CAMPAIGN_LEVELS,
    };
  }

  // ── Results ───────────────────────────────────────────────────────────
  function row(label: string, value: string, cls = ''): HTMLElement {
    return el('div', { class: 'll-row ' + cls }, el('span', { text: label }), el('span', { class: 'll-val', text: value }));
  }

  function showLanded(): void {
    if (!lv || !result) return;
    const r = result;
    const seed = lv.seed;
    const body = el(
      'div',
      { class: 'll-result' },
      row(t('padBonus', { m: r.mult }), '+' + r.padPts),
      row(t('fuelBonus', { f: r.fuel }), '+' + r.fuelPts),
      row(t('levelScore'), String(r.total), 'll-total'),
      mode === 'campaign' ? row(t('campaignTotal'), String(r.campaignTotal), 'll-total') : null,
      r.campaignBest ? el('div', { class: 'll-row ll-newbest', text: '🏆 ' + t('newBest') }) : null,
      r.levelBest && !r.campaignBest ? el('div', { class: 'll-row ll-newbest', text: '🏆 ' + t('newLevelBest') }) : null,
      r.finishedCampaign ? el('p', { class: 'll-note', text: t('campaignCompleteBody') }) : null,
    );
    if (r.campaignBest || r.levelBest) ctx.play('coin');
    const next = r.level + 1;
    const goNext = (): void => startLevel(next, seedFor(next));
    ctx.showModal({
      title: r.finishedCampaign ? t('campaignComplete') : t('landedTitle'),
      body,
      dismissible: false,
      buttons:
        mode === 'campaign'
          ? [
              { label: t('home'), onClick: () => ctx.exit() },
              { label: r.finishedCampaign ? t('continueEndless') : t('nextLevel'), primary: true, onClick: goNext },
            ]
          : [
              // practice: back to the level picker (the header ‹ still leads home)
              { label: t('menu'), onClick: () => showStart() },
              { label: t('replay'), onClick: () => startLevel(r.level, seed) },
              { label: t('nextLevel'), primary: true, onClick: goNext },
            ],
    });
  }

  function reasonText(r: CrashReason): string {
    if (!lv) return '';
    const l = lv.lander;
    switch (r) {
      case 'vspeed':
        return t('reasonVspeed', { v: Math.abs(l.vy).toFixed(1) });
      case 'hspeed':
        return t('reasonHspeed', { v: Math.abs(l.vx).toFixed(1) });
      case 'tilt':
        return t('reasonTilt', { a: Math.round(Math.abs((normalizeAngle(l.angle) * 180) / Math.PI)) });
      case 'offPad':
        return t('reasonOffPad');
      case 'terrain':
        return t('reasonTerrain');
      case 'cliff':
        return t('reasonCliff');
      case 'hull':
        return t('reasonHull');
      case 'lost':
        return t('reasonLost');
      default: {
        // Compile-time guard: a new CrashReason without a message here is a type error.
        const unknown: never = r;
        return t('reasonTerrain') + ` (${String(unknown)})`;
      }
    }
  }

  function showCrashed(): void {
    if (!lv || lv.outcome?.kind !== 'crashed') return;
    const level = lv.level;
    const seed = lv.seed;
    const { reasons, outOfFuel } = lv.outcome;
    ctx.play('lose');
    ctx.haptic('error');
    const body = el(
      'div',
      {},
      el(
        'div',
        { class: 'll-reasons' },
        ...reasons.map((r) => el('div', { class: 'll-reason', text: '• ' + reasonText(r) })),
        outOfFuel ? el('div', { class: 'll-reason', text: '⛽ ' + t('outOfFuel') }) : null,
      ),
      el('p', { class: 'muted small', text: t('limits') }),
      mode === 'campaign' ? el('p', { class: 'll-note', text: t('scoreSoFar', { n: runScore }) }) : null,
    );
    ctx.showModal({
      title: t('crashedTitle'),
      body,
      dismissible: false,
      buttons: [
        mode === 'campaign' ? { label: t('home'), onClick: () => ctx.exit() } : { label: t('menu'), onClick: () => showStart() },
        { label: t('retry'), primary: true, onClick: () => startLevel(level, seed) },
      ],
    });
  }

  // ── Particles ─────────────────────────────────────────────────────────
  function pushParticle(p: Particle): void {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(p);
  }

  function spawnExplosion(x: number, y: number): void {
    pushParticle({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: 9, color: '#fff1a8', angle: 0, spin: 0 });
    for (let i = 0; i < 42; i++) {
      const a = Math.random() * TAU;
      const sp = 3 + Math.random() * 16;
      pushParticle({
        kind: 'debris',
        x: x + (Math.random() - 0.5) * 2,
        y: y + (Math.random() - 0.5) * 2,
        vx: Math.cos(a) * sp,
        vy: Math.abs(Math.sin(a)) * sp + 2,
        life: 1.2 + Math.random() * 1.3,
        max: 2.5,
        size: 0.3 + Math.random() * 0.8,
        color: DEBRIS_COLORS[i % DEBRIS_COLORS.length],
        angle: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 12,
      });
    }
    for (let i = 0; i < 14; i++) {
      pushParticle({
        kind: 'smoke',
        x: x + (Math.random() - 0.5) * 3,
        y: y + (Math.random() - 0.5) * 3,
        vx: (Math.random() - 0.5) * 4,
        vy: 1 + Math.random() * 4,
        life: 1.4 + Math.random() * 0.8,
        max: 2.2,
        size: 1.5 + Math.random() * 2,
        color: pal.smoke,
        angle: 0,
        spin: 0,
      });
    }
  }

  function spawnDust(x: number, y: number): void {
    for (let i = 0; i < 16; i++) {
      const dir = i % 2 === 0 ? -1 : 1;
      pushParticle({
        kind: 'dust',
        x: x + dir * (1 + Math.random() * 2),
        y: y + 0.2,
        vx: dir * (2 + Math.random() * 5),
        vy: 0.5 + Math.random() * 1.5,
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        size: 0.4 + Math.random() * 0.6,
        color: pal.dust,
        angle: 0,
        spin: 0,
      });
    }
  }

  /** Engine blast stirs up regolith when the plume reaches the ground. */
  function kickDust(dt: number): void {
    if (!lv) return;
    const hit = exhaustGroundHit(lv.lander, lv.terrain);
    if (!hit) {
      dustAcc = 0;
      return;
    }
    const strength = 1 - hit.d / EXHAUST_REACH;
    dustAcc += dt * 70 * strength;
    while (dustAcc >= 1) {
      dustAcc -= 1;
      const dir = Math.random() < 0.5 ? -1 : 1;
      pushParticle({
        kind: 'dust',
        x: hit.x + dir * Math.random() * 1.2,
        y: hit.y + 0.15,
        vx: dir * (3 + Math.random() * 7) * (0.5 + strength),
        vy: 0.3 + Math.random() * 1.8,
        life: 0.4 + Math.random() * 0.5,
        max: 0.9,
        size: 0.25 + Math.random() * 0.45,
        color: pal.dust,
        angle: 0,
        spin: 0,
      });
    }
  }

  function updateParticles(dt: number): void {
    if (!lv || particles.length === 0) return;
    const g = lv.cfg.gravity;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      if (p.kind === 'flash') continue;
      const grav = p.kind === 'smoke' ? -0.6 : p.kind === 'dust' ? g * 0.5 : g;
      p.vy -= grav * dt;
      p.vx *= 1 - 0.4 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      if (p.kind !== 'smoke') {
        const ground = surfaceAt(p.x);
        if (p.y < ground) {
          p.y = ground;
          p.vy = Math.abs(p.vy) * 0.3;
          p.vx *= 0.6;
          p.spin *= 0.5;
        }
      }
    }
  }

  /** Ground height for drawing and debris: the level terrain, continued by the decorative crater rim outside it. */
  function surfaceAt(x: number): number {
    if (!lv) return 0;
    const w = lv.terrain.width;
    if (x >= 0 && x <= w) return heightAt(lv.terrain, x);
    const arr = x < 0 ? outerL : outerR;
    if (!arr.length) return heightAt(lv.terrain, clamp(x, 0, w));
    const d = Math.min((x < 0 ? -x : x - w) / OUTER_STEP, OUTER_N);
    const i = Math.min(Math.floor(d), OUTER_N - 1);
    return arr[i] + (arr[i + 1] - arr[i]) * (d - i);
  }

  // ── Camera ────────────────────────────────────────────────────────────
  function updateCamera(dt: number): void {
    if (!lv || !cv) return;
    const l = lv.lander;
    const far = overviewZoom(cv.width, cv.height);
    const near = Math.max(7, far * 1.6);
    const alt = altitudeAbove(l, lv.terrain);
    const tz = zoomFor(alt, near, far);
    const kz = camSnap ? 1 : 1 - Math.exp(-dt * 2.5);
    zoom += (tz - zoom) * kz;
    const viewW = cv.width / zoom;
    const viewH = cv.height / zoom;
    const cx = viewW >= WORLD_W ? WORLD_W / 2 : clamp(l.x, viewW / 2, WORLD_W - viewW / 2);
    // lowest ground across the (target) view, so the surface stays framed near the bottom edge
    const x0 = clamp(cx - viewW / 2, 0, WORLD_W);
    const x1 = clamp(cx + viewW / 2, 0, WORLD_W);
    let groundLow = Infinity;
    for (let i = 0; i <= 24; i++) groundLow = Math.min(groundLow, heightAt(lv.terrain, x0 + ((x1 - x0) * i) / 24));
    const cy = cameraTargetY(l.y, groundLow, viewH);
    const k = camSnap ? 1 : 1 - Math.exp(-dt * 5);
    camX += (cx - camX) * k;
    camY += (cy - camY) * k;
    camSnap = false;
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function draw(): void {
    if (!lv || !cv) return;
    const g = cv.ctx;
    const W = cv.width;
    const H = cv.height;
    const l = lv.lander;
    const sx = (x: number): number => (x - camX) * zoom + W / 2;
    const sy = (y: number): number => H / 2 - (y - camY) * zoom;

    // Sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, pal.skyTop);
    sky.addColorStop(1, pal.skyBottom);
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Stars (screen space, gentle parallax + twinkle)
    g.fillStyle = pal.star;
    const px = camX * 1.4;
    const py = camY * 1.4;
    for (const s of stars) {
      const x = (((s.x * W - px) % W) + W) % W;
      const y = (((s.y * H + py) % H) + H) % H;
      g.globalAlpha = pal.starAlpha * s.a * (0.65 + 0.35 * Math.sin(clock * s.tw + s.ph));
      g.fillRect(x, y, s.r, s.r);
    }
    g.globalAlpha = 1;

    drawEarth(g, W - 42, 70, 13);

    g.save();
    if (shake > 0) {
      const amp = 10 * shake * shake;
      g.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }

    // Distant hills (parallax silhouette)
    const hz = zoom * HILL_DEPTH;
    const hsx = (x: number): number => (x - camX) * hz + W / 2;
    const hsy = (y: number): number => H / 2 - (y - camY) * hz;
    g.fillStyle = pal.hills;
    g.beginPath();
    g.moveTo(-10, H + 10);
    for (let i = 0; i <= HILL_N; i++) {
      const x = HILL_X0 + ((HILL_X1 - HILL_X0) * i) / HILL_N;
      g.lineTo(hsx(x), hsy(hills[i]));
    }
    g.lineTo(W + 10, H + 10);
    g.closePath();
    g.fill();

    // Terrain: the level, continued by the crater's outer slopes so wide views never show a void or a flat slab
    const pts = lv.terrain.points;
    const last = pts[pts.length - 1];
    const span = OUTER_N * OUTER_STEP;
    const xl = Math.min(sx(-span), 0) - 20;
    const xr = Math.max(sx(last.x + span), W) + 20;
    const terrainPath = (): void => {
      g.moveTo(xl, sy(outerL[OUTER_N]));
      for (let i = OUTER_N; i >= 1; i--) g.lineTo(sx(-i * OUTER_STEP), sy(outerL[i]));
      for (let i = 0; i < pts.length; i++) g.lineTo(sx(pts[i].x), sy(pts[i].y));
      for (let i = 1; i <= OUTER_N; i++) g.lineTo(sx(last.x + i * OUTER_STEP), sy(outerR[i]));
      g.lineTo(xr, sy(outerR[OUTER_N]));
    };
    g.beginPath();
    terrainPath();
    g.lineTo(xr, H + 40);
    g.lineTo(xl, H + 40);
    g.closePath();
    // --surface-2 at the surface, fading toward the deep shade below it
    const groundGrad = g.createLinearGradient(0, sy(55), 0, sy(-6));
    groundGrad.addColorStop(0, pal.ground);
    groundGrad.addColorStop(1, pal.groundDeep);
    g.fillStyle = groundGrad;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = pal.groundEdge;
    g.lineJoin = 'round';
    g.beginPath();
    terrainPath();
    g.stroke();

    // Pads
    const padW = clamp(zoom * 0.9, 4, 9);
    const fontPx = clamp(zoom * 2.4, 11, 20);
    const lz = Math.max(zoom, 3.4);
    const lsx = sx(l.x);
    const lsy = sy(l.y);
    /** Screen boxes of the on-screen pad labels, so the off-screen indicators can steer clear of them. */
    const taken: Box[] = [];
    for (const p of lv.terrain.pads) {
      const x0 = sx(p.x0);
      const x1 = sx(p.x1);
      const y = sy(p.y);
      if (x1 < -40 || x0 > W + 40) continue;
      g.lineCap = 'round';
      g.strokeStyle = pal.pad;
      g.globalAlpha = 0.3;
      g.lineWidth = padW + 8;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.globalAlpha = 1;
      g.lineWidth = padW;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      // stripes
      g.strokeStyle = pal.skyTop;
      g.globalAlpha = 0.35;
      g.lineWidth = Math.max(1, padW * 0.35);
      g.lineCap = 'butt';
      const n = Math.max(2, Math.round((x1 - x0) / 14));
      for (let i = 1; i < n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        g.beginPath();
        g.moveTo(x, y - padW / 2);
        g.lineTo(x, y + padW / 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.font = `700 ${fontPx}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillStyle = pal.pad;
      // keep the label readable while the pad is partly off-screen, and fade it out of the lander's way
      const lx = clamp((x0 + x1) / 2, Math.min(x1, fontPx * 1.2), Math.max(x0, W - fontPx * 1.2));
      const ly = y - padW / 2 - 3;
      const d = Math.hypot(lx - lsx, ly - fontPx / 2 - lsy);
      g.globalAlpha = clamp((d - lz * 3) / (lz * 4), 0.15, 1);
      const label = '×' + p.mult;
      g.fillText(label, lx, ly);
      g.globalAlpha = 1;
      const tw = g.measureText(label).width;
      taken.push({ x0: lx - tw / 2 - 3, x1: lx + tw / 2 + 3, y0: ly - fontPx - 2, y1: ly + 2 });
    }

    // Off-screen pad indicators, nudged up / down so they never sit on an on-screen label or on each other
    for (const p of lv.terrain.pads) {
      if (sx(p.x1) >= 0 && sx(p.x0) <= W) continue;
      const leftSide = sx(p.x1) < 0;
      const want = clamp(sy(p.y), 40, H - 40);
      const boxAt = (y: number): Box => (leftSide ? { x0: 4, x1: 52, y0: y - 10, y1: y + 10 } : { x0: W - 52, x1: W - 4, y0: y - 10, y1: y + 10 });
      let y = want;
      for (const dy of [0, -24, 24, -48, 48, -72, 72, -96, 96]) {
        const cand = clamp(want + dy, 24, H - 24);
        if (!taken.some((b) => overlaps(b, boxAt(cand)))) {
          y = cand;
          break;
        }
      }
      taken.push(boxAt(y));
      drawPadIndicator(g, p, leftSide, y, W);
    }

    // Lander
    if (lv.phase !== 'crashed') {
      const input = currentInput();
      const flying = lv.phase === 'flying' && !paused && !heldByModal;
      const pose = landerPose();
      drawLander(g, sx(pose.x), sy(pose.y), pose.angle, lz, l.thrusting && flying, flying ? input.rot : 0);
    }

    // Particles
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      const x = sx(p.x);
      const y = sy(p.y);
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
      if (p.kind === 'flash') {
        const r = (1 - a) * p.size * zoom + 4;
        g.globalAlpha = a;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      } else if (p.kind === 'smoke') {
        g.globalAlpha = a * 0.35;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(x, y, (p.size + (1 - a) * 2) * zoom, 0, TAU);
        g.fill();
      } else if (p.kind === 'dust') {
        g.globalAlpha = a * 0.8;
        g.fillStyle = p.color;
        const s = Math.max(1.5, p.size * zoom);
        g.fillRect(x - s / 2, y - s / 2, s, s);
      } else {
        g.globalAlpha = Math.min(1, a * 1.5);
        g.fillStyle = p.color;
        g.save();
        g.translate(x, y);
        g.rotate(p.angle);
        const s = Math.max(2, p.size * zoom);
        g.fillRect(-s / 2, -s / 2, s, s * 0.6);
        g.restore();
      }
    }
    g.globalAlpha = 1;

    // Landed badge
    if (lv.phase === 'landed' && lv.outcome?.kind === 'landed') {
      const a = clamp((clock - landedAt) * 3, 0, 1);
      g.globalAlpha = a;
      g.font = `800 ${Math.round(clamp(zoom * 2.6, 16, 24))}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillStyle = pal.success;
      g.fillText('✓ ' + t('landedBanner', { m: lv.outcome.pad.mult }), sx(l.x), sy(l.y) - lz * 4 - 6 - (1 - a) * 10);
      g.globalAlpha = 1;
    }
    g.restore();

    // Live wind gauge (levels with crosswind)
    if (lv.cfg.wind > 0) drawWindGauge(g, W);

    // Fuel warnings
    if (lv.phase === 'flying' && l.fuel < 20) {
      const empty = l.fuel <= 0;
      const blink = empty ? 1 : 0.55 + 0.45 * Math.sin(clock * 9);
      g.globalAlpha = blink;
      g.font = `800 15px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillStyle = empty ? pal.danger : pal.warning;
      g.fillText('⛽ ' + (empty ? t('outOfFuel') : t('lowFuel')), W / 2, 12);
      g.globalAlpha = 1;
    }

    // First-run controls hint (top of the canvas, clear of the pads and the buttons)
    const hinting = showHint && lv.level <= 1 && lv.time < 9 && (lv.phase === 'ready' || lv.phase === 'flying');
    if (hinting) {
      const fade = clamp((9 - lv.time) / 0.8, 0, 1);
      const lines = t('controlsHint').split('\n');
      g.font = `600 13px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const lh = 18;
      const boxH = lines.length * lh + 14;
      const boxW = Math.min(W - 24, Math.max(...lines.map((ln) => g.measureText(ln).width)) + 28);
      // Top centre unless that covers the lander (short landscape views): then beside it, else below it.
      const pose = landerPose();
      const ext = lz * (FOOT_X + FOOT_PAD) + 10;
      const ship: Box = { x0: sx(pose.x) - ext, x1: sx(pose.x) + ext, y0: sy(pose.y) - lz * 3.2 - 10, y1: sy(pose.y) - lz * FOOT_Y + 10 };
      let bx = (W - boxW) / 2;
      let by = 10;
      if (overlaps(ship, { x0: bx, x1: bx + boxW, y0: by, y1: by + boxH })) {
        if (ship.x1 + 8 + boxW <= W - 8 && (ship.x0 < W / 2 || ship.x0 - 8 - boxW < 8)) bx = ship.x1 + 8;
        else if (ship.x0 - 8 - boxW >= 8) bx = ship.x0 - 8 - boxW;
        else by = Math.min(ship.y1 + 8, H - boxH - 8);
      }
      if (!hintPos || camSnap) hintPos = { x: bx, y: by };
      hintPos.x += (bx - hintPos.x) * 0.18;
      hintPos.y += (by - hintPos.y) * 0.18;
      bx = hintPos.x;
      by = hintPos.y;
      g.fillStyle = pal.skyTop;
      g.globalAlpha = fade * 0.8;
      roundRect(g, bx, by, boxW, boxH, 12);
      g.fill();
      g.globalAlpha = fade;
      g.fillStyle = pal.text;
      lines.forEach((ln, i) => g.fillText(ln, bx + boxW / 2, by + 7 + lh * i + lh / 2));
      g.globalAlpha = 1;
    }

    // Ready banner
    if (lv.phase === 'ready' || (lv.phase === 'flying' && lv.time < READY_TIME + 0.6)) {
      const fade = lv.phase === 'ready' ? 1 : 1 - (lv.time - READY_TIME) / 0.6;
      const by = H * 0.5 - 14; // mid-sky: below the lander's start position, above the terrain
      g.globalAlpha = clamp(fade, 0, 1);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = pal.text;
      g.font = `800 30px ${FONT}`;
      g.fillText(levelTitle(lv.level), W / 2, by);
      g.font = `600 14px ${FONT}`;
      g.fillStyle = pal.muted;
      const windTxt = lv.cfg.wind > 0 ? t('windLabel', { dir: lv.windDir > 0 ? '→' : '←', w: lv.cfg.wind.toFixed(1) }) : t('noWind');
      g.fillText(`${t('gravityLabel', { g: lv.cfg.gravity.toFixed(1) })} · ${windTxt}`, W / 2, by + 28);
      g.globalAlpha = 1;
    }
  }

  /**
   * Where to draw the lander. Right after a touchdown it rocks upright about the foot that touched down while that
   * foot slides to its settled spot (logic.settle), instead of snapping straight to the final pose.
   */
  function landerPose(): { x: number; y: number; angle: number } {
    const l = lv!.lander;
    if (lv!.phase !== 'landed' || !touchdown) return l;
    const k = smoothstep((clock - landedAt) / SETTLE_TIME);
    if (k >= 1) return l;
    const from = { ...l, x: touchdown.x, y: touchdown.y, angle: touchdown.angle };
    const feet = FEET.map((p) => toWorld(from, p));
    const i = feet[0].y <= feet[1].y ? 0 : 1;
    const end = toWorld(l, FEET[i]);
    const fx = feet[i].x + (end.x - feet[i].x) * k;
    const fy = feet[i].y + (end.y - feet[i].y) * k;
    const angle = touchdown.angle * (1 - k);
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const [px, py] = FEET[i];
    return { x: fx - (px * c + py * sn), y: fy - (-px * sn + py * c), angle };
  }

  function drawEarth(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    g.save();
    g.globalAlpha = pal.earthAlpha;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fillStyle = pal.sea;
    g.fill();
    g.clip();
    g.fillStyle = pal.land;
    g.beginPath();
    g.ellipse(x - r * 0.35, y - r * 0.25, r * 0.45, r * 0.3, 0.5, 0, TAU);
    g.ellipse(x + r * 0.3, y + r * 0.35, r * 0.35, r * 0.22, -0.4, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.ellipse(x + r * 0.1, y - r * 0.65, r * 0.6, r * 0.12, 0.1, 0, TAU);
    g.fill();
    // night side
    g.fillStyle = 'rgba(2, 4, 10, 0.55)';
    g.beginPath();
    g.arc(x + r * 0.55, y + r * 0.2, r * 1.05, 0, TAU);
    g.fill();
    g.restore();
  }

  function drawWindGauge(g: CanvasRenderingContext2D, W: number): void {
    if (!lv) return;
    const w = currentWind(lv);
    const len = clamp((Math.abs(w) / 0.6) * 44, 8, 44);
    const dir = w > 0 ? 1 : -1;
    const gx = W - 14;
    const gy = 16;
    g.strokeStyle = pal.warning;
    g.fillStyle = pal.warning;
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    const x0 = dir > 0 ? gx - 56 : gx;
    g.beginPath();
    g.moveTo(x0, gy);
    g.lineTo(x0 + dir * len, gy);
    g.stroke();
    g.beginPath();
    g.moveTo(x0 + dir * (len + 6), gy);
    g.lineTo(x0 + dir * len, gy - 5);
    g.lineTo(x0 + dir * len, gy + 5);
    g.closePath();
    g.fill();
    g.font = `700 11px ${FONT}`;
    g.textAlign = 'right';
    g.textBaseline = 'top';
    g.fillStyle = pal.muted;
    g.fillText(`${t('wind')} ${Math.abs(w).toFixed(2)}`, gx, gy + 9);
  }

  function drawPadIndicator(g: CanvasRenderingContext2D, p: Pad, leftSide: boolean, y: number, W: number): void {
    const x = leftSide ? 16 : W - 16;
    const dir = leftSide ? -1 : 1;
    g.fillStyle = pal.pad;
    g.beginPath();
    g.moveTo(x + dir * 8, y);
    g.lineTo(x - dir * 4, y - 7);
    g.lineTo(x - dir * 4, y + 7);
    g.closePath();
    g.fill();
    g.font = `700 12px ${FONT}`;
    g.textAlign = leftSide ? 'left' : 'right';
    g.textBaseline = 'middle';
    g.fillText('×' + p.mult, x - dir * 10, y);
  }

  function drawLander(g: CanvasRenderingContext2D, x: number, y: number, angle: number, z: number, flame: boolean, rot: number): void {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.scale(z, -z);
    const lw = (px: number): number => Math.max(px / z, 0.08);

    // Flame + glow
    if (flame) {
      const flick = 0.75 + 0.25 * Math.sin(clock * 41) + Math.random() * 0.25;
      const len = 2.4 * flick + 0.6;
      const glow = g.createRadialGradient(0, -3, 0.2, 0, -3, 3.2);
      glow.addColorStop(0, 'rgba(255, 176, 32, 0.45)');
      glow.addColorStop(1, 'rgba(255, 106, 31, 0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(0, -3, 3.2, 0, TAU);
      g.fill();
      g.fillStyle = FLAME_COLORS[0];
      g.beginPath();
      g.moveTo(-0.85, -2.3);
      g.lineTo(0.85, -2.3);
      g.lineTo(0.15 * Math.sin(clock * 23), -2.3 - len);
      g.closePath();
      g.fill();
      g.fillStyle = FLAME_COLORS[1];
      g.beginPath();
      g.moveTo(-0.55, -2.3);
      g.lineTo(0.55, -2.3);
      g.lineTo(0, -2.3 - len * 0.65);
      g.closePath();
      g.fill();
      g.fillStyle = FLAME_COLORS[2];
      g.beginPath();
      g.moveTo(-0.28, -2.3);
      g.lineTo(0.28, -2.3);
      g.lineTo(0, -2.3 - len * 0.35);
      g.closePath();
      g.fill();
    }
    // RCS puffs while rotating
    if (rot !== 0) {
      const side = rot > 0 ? -1 : 1;
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath();
      g.moveTo(side * 1.5, 1.5);
      g.lineTo(side * (2.3 + Math.random() * 0.4), 1.9);
      g.lineTo(side * (2.3 + Math.random() * 0.4), 1.1);
      g.closePath();
      g.fill();
    }

    // Legs
    g.strokeStyle = pal.leg;
    g.lineCap = 'round';
    g.lineWidth = lw(2.2);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(s * 2.0, -0.6);
      g.lineTo(s * FOOT_X, FOOT_Y);
      g.moveTo(s * 2.0, -1.4);
      g.lineTo(s * 2.75, -2.1);
      g.stroke();
      g.lineWidth = lw(2.6);
      g.beginPath();
      g.moveTo(s * (FOOT_X - FOOT_PAD), FOOT_Y);
      g.lineTo(s * (FOOT_X + FOOT_PAD), FOOT_Y);
      g.stroke();
      g.lineWidth = lw(2.2);
    }

    // Descent stage (gold foil)
    g.fillStyle = pal.gold;
    g.fillRect(-2.0, -1.5, 4.0, 1.2);
    g.fillStyle = pal.goldDark;
    g.fillRect(-2.0, -1.5, 4.0, 0.35);
    g.strokeStyle = pal.goldDark;
    g.lineWidth = lw(1);
    g.strokeRect(-2.0, -1.5, 4.0, 1.2);

    // Nozzle
    g.fillStyle = pal.nozzle;
    g.beginPath();
    g.moveTo(-0.6, -1.5);
    g.lineTo(0.6, -1.5);
    g.lineTo(1.0, -2.3);
    g.lineTo(-1.0, -2.3);
    g.closePath();
    g.fill();

    // Ascent stage
    g.fillStyle = pal.hull;
    g.beginPath();
    g.moveTo(-1.4, -0.3);
    g.lineTo(1.4, -0.3);
    g.lineTo(1.5, 1.4);
    g.lineTo(0.8, 2.2);
    g.lineTo(-0.8, 2.2);
    g.lineTo(-1.5, 1.4);
    g.closePath();
    g.fill();
    g.strokeStyle = pal.hullDark;
    g.lineWidth = lw(1);
    g.stroke();
    // Window
    g.fillStyle = pal.accent;
    g.beginPath();
    g.arc(0.55, 0.95, 0.38, 0, TAU);
    g.fill();
    // Hatch line
    g.strokeStyle = pal.hullDark;
    g.beginPath();
    g.moveTo(-1.1, 0.3);
    g.lineTo(-0.2, 0.3);
    g.stroke();
    // Antenna
    g.strokeStyle = pal.leg;
    g.lineWidth = lw(1.2);
    g.beginPath();
    g.moveTo(-0.9, 2.2);
    g.lineTo(-0.9, 3.0);
    g.moveTo(-1.3, 3.0);
    g.lineTo(-0.5, 3.0);
    g.stroke();
    g.restore();
  }

  // ── HUD ───────────────────────────────────────────────────────────────
  function updateHud(): void {
    if (!lv || !hudAlt || !hudV || !hudH || !hudTilt || !fuelFill || !fuelPct) return;
    const l = lv.lander;
    const altM = altitudeAbove(l, lv.terrain);
    const alt = Math.round(altM);
    const vy = l.vy;
    const vx = l.vx;
    const tilt = Math.abs(normalizeAngle(l.angle));
    const tiltDeg = Math.round((normalizeAngle(l.angle) * 180) / Math.PI);
    const fuel = Math.round(l.fuel);
    const near = altM < 25 && lv.phase === 'flying';
    const key = `${alt}|${vy.toFixed(1)}|${vx.toFixed(1)}|${tiltDeg}|${fuel}|${near}`;
    if (key === hudCache) return;
    hudCache = key;
    const mark = (node: HTMLElement, bad: boolean): void => {
      node.classList.toggle('ll-danger', bad);
      node.classList.toggle('ll-ok', near && !bad);
    };
    hudAlt.textContent = alt + ' m';
    hudV.textContent = (vy >= 0 ? '↑ ' : '↓ ') + Math.abs(vy).toFixed(1);
    mark(hudV, -vy > MAX_VY);
    hudH.textContent = (vx >= 0 ? '→ ' : '← ') + Math.abs(vx).toFixed(1);
    mark(hudH, Math.abs(vx) > MAX_VX);
    hudTilt.textContent = tiltDeg + '°';
    mark(hudTilt, tilt > MAX_TILT);
    fuelFill.style.width = fuel + '%';
    fuelFill.classList.toggle('ll-warn', fuel < 35 && fuel >= 15);
    fuelFill.classList.toggle('ll-danger', fuel < 15);
    fuelPct.textContent = fuel + '%';
  }

  showStart();
  return {
    destroy() {
      teardown();
      hideHeaderActions();
    },
  };
}

const game: GameModule = { strings, create };
export default game;
