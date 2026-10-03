import type { GameContext, GameInstance, GameModule, ThemeName } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import { createCanvas, onPointer, type CanvasHandle } from '../../app/canvas';
import { strings } from './strings';
import {
  CLEAR_DUR,
  COMBO_WINDOW,
  MODES,
  MODE_LIST,
  SIDES,
  cellKey,
  comboMultiplier,
  computeBoard,
  coreRotate,
  coreTick,
  createCore,
  gestureEnd,
  gestureMove,
  gestureStart,
  isMode,
  localSide,
  spawnDistance,
  type Board,
  type ClearCell,
  type ClearGroup,
  type Core,
  type CoreEvents,
  type Gesture,
  type Mode,
} from './logic';
import './style.css';

const DEG = Math.PI / 180;
const TAN30 = Math.tan(Math.PI / 6);
const COS30 = Math.cos(Math.PI / 6);
/** Exponential easing rate of the visual rotation (higher = snappier). */
const ROT_EASE = 16;
const LAND_FLASH = 0.22;
const LEVEL_FLASH = 0.9;
/** Seconds of screen shake at game over. */
const OVER_SHAKE = 0.5;
const MAX_PARTICLES = 180;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Noto Sans SC', sans-serif";

/** Block colours per theme: saturated on dark, deeper on light so they read against white. */
const PALETTES: Record<ThemeName, string[]> = {
  dark: ['#ff5c7a', '#ffb13b', '#3ddc97', '#4f8cff', '#c46bff'],
  light: ['#e32e55', '#f08a00', '#1aa364', '#2f63f5', '#8e3fe0'],
};
/** Ink for the per-colour symbols (dark on the bright dark-theme blocks, white on the deeper light ones). */
const GLYPH_INK: Record<ThemeName, string> = {
  dark: 'rgba(12,16,26,0.55)',
  light: 'rgba(255,255,255,0.88)',
};

interface Theme {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  danger: string;
  warning: string;
  blocks: string[];
  glyph: string;
}

function readTheme(ctx: GameContext, name: ThemeName): Theme {
  const v = (n: string, fb: string) => ctx.cssVar(n) || fb;
  const dark = name === 'dark';
  return {
    bg: v('--bg', dark ? '#0f1218' : '#f4f6fb'),
    surface: v('--surface', dark ? '#1a1f2b' : '#ffffff'),
    surface2: v('--surface-2', dark ? '#232a39' : '#eef1f7'),
    border: v('--border', dark ? '#2d3548' : '#dde2ec'),
    text: v('--text', dark ? '#e8ecf3' : '#171a21'),
    muted: v('--muted', dark ? '#8b94a7' : '#5c6475'),
    accent: v('--accent', dark ? '#5b8cff' : '#3366ff'),
    danger: v('--danger', dark ? '#ff5470' : '#e0304f'),
    warning: v('--warning', dark ? '#ffc857' : '#d9960a'),
    blocks: PALETTES[name],
    glyph: GLYPH_INK[name],
  };
}

/** '#rrggbb' → 'rgba(r,g,b,a)'; other colour formats fall back to the input. */
function rgba(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** True while any shell modal (rules, confirm, results) is up or opening. */
function modalOpen(): boolean {
  return document.querySelector('.modal-backdrop:not(.closing)') !== null;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  color: string;
  size: number;
}

type Phase = 'start' | 'ready' | 'playing' | 'paused' | 'over';

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const savedMode = ctx.storage.get<string>('mode', 'medium');
  let mode: Mode = isMode(savedMode) ? savedMode : 'medium';
  let themeName: ThemeName = ctx.theme;
  let theme = readTheme(ctx, themeName);
  let phase: Phase = 'start';

  // ── Live game state (rules live in the pure core; the rest is presentation) ──
  let core: Core = createCore(MODES[mode]);
  let visualRot = 0; // degrees
  let overT = 0;
  let overSides: number[] = [];
  let particles: Particle[] = [];
  let floats: FloatText[] = [];
  const landFlash = new Map<string, number>();
  let levelFlash = 0;
  let chevL = 0;
  let chevR = 0;
  let lastStatusSec = -1;
  let lastMoveSound = 0;
  const gestures = new Map<number, Gesture>();
  let overTimer = 0;
  let animT = 0;

  let cv: CanvasHandle | null = null;
  let raf = 0;
  let lastFrame = 0;
  let offPointer: (() => void) | null = null;
  let overlay: HTMLElement | null = null;
  let overlayTitle: HTMLElement | null = null;
  let overlayHint: HTMLElement | null = null;
  let hudScore: HTMLElement | null = null;
  let hudLevel: HTMLElement | null = null;
  let hudBest: HTMLElement | null = null;
  let L: Board = { cx: 0, cy: 0, R: 100, a0: 30, lvl: 8 };

  // ── Header / global wiring ────────────────────────────────────────────
  // Header buttons exist only while a round is running: ↻ restarts the same mode, ⏸/▶ pauses/resumes.
  let headerKey = '';
  let headerOff: (() => void)[] = [];
  function syncHeader(): void {
    const key = phase === 'playing' ? 'playing' : phase === 'paused' ? 'paused' : '';
    if (key === headerKey) return;
    headerKey = key;
    headerOff.forEach((off) => off());
    headerOff = [];
    if (!key) return;
    headerOff.push(ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: onRestart }));
    headerOff.push(
      key === 'playing'
        ? ctx.addHeaderAction({ icon: '⏸', label: t('pause'), onClick: pauseGame })
        : ctx.addHeaderAction({ icon: '▶', label: t('resume'), onClick: resumeGame }),
    );
  }

  const onKey = (e: KeyboardEvent): void => {
    if (modalOpen()) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      if (phase === 'playing') {
        rotate(-1);
        e.preventDefault();
      }
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      if (phase === 'playing') {
        rotate(1);
        e.preventDefault();
      }
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (phase === 'ready') {
        begin();
        e.preventDefault();
      } else if (phase === 'paused') {
        resumeGame();
        e.preventDefault();
      }
    } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      if (phase === 'playing') pauseGame();
    }
  };
  window.addEventListener('keydown', onKey);

  ctx.onDestroy(() => {
    window.removeEventListener('keydown', onKey);
    teardownGame();
    headerOff.forEach((off) => off());
    headerOff = [];
  });
  ctx.onVisibility((visible) => {
    if (!visible) {
      if (phase === 'playing') pauseGame();
      sleep();
    } else {
      wake();
    }
  });
  ctx.onThemeChange((name) => {
    themeName = name;
    theme = readTheme(ctx, name);
    drawFrame();
  });

  function hexIcon(cls: string): HTMLElement {
    return el('div', { class: 'hx-icon-wrap ' + cls }, el('div', { class: 'hx-icon' }));
  }

  // ── Frame loop: runs while playing or while an effect is still animating, then sleeps ──
  function wake(): void {
    if (raf || !cv) return;
    lastFrame = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function sleep(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function frame(now: number): void {
    raf = 0;
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    update(dt);
    drawFrame();
    if (cv && (phase === 'playing' || !settled())) raf = requestAnimationFrame(frame);
  }

  /** Nothing left to animate: the board is a still picture until the next input, resize or theme change. */
  function settled(): boolean {
    return (
      visualRot === core.sim.rotation * 60 &&
      chevL === 0 &&
      chevR === 0 &&
      levelFlash === 0 &&
      landFlash.size === 0 &&
      particles.length === 0 &&
      floats.length === 0 &&
      !(phase === 'over' && overT < OVER_SHAKE)
    );
  }

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    teardownGame();
    phase = 'start';
    syncHeader();
    root.innerHTML = '';
    ctx.setStatus('');
    const modeDesc = el('p', { class: 'muted small hx-mode-desc', text: t(mode + 'Desc') });
    const bestLine = el('p', { class: 'muted hx-best' });
    const updateBest = () => {
      const b = ctx.storage.getBest(mode);
      bestLine.textContent = b === null ? t('noBest') : t('bestLine', { n: b });
    };
    updateBest();
    root.append(
      el(
        'div',
        { class: 'start-screen hx-start' },
        hexIcon('hx-icon-big'),
        el('h2', { text: t('chooseDifficulty') }),
        el('p', { class: 'muted hx-desc', text: t('desc') }),
        segmented<Mode>(
          MODE_LIST.map((m) => ({ value: m, label: t(m) })),
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            modeDesc.textContent = t(m + 'Desc');
            updateBest();
          },
        ),
        modeDesc,
        bestLine,
        button(t('play'), () => startGame(false), { variant: 'primary', size: 'lg', class: 'hx-play' }),
        el('p', { class: 'muted hx-hint', text: t('controlsHint') }),
      ),
    );
  }

  // ── Game setup / teardown ─────────────────────────────────────────────
  function teardownGame(): void {
    sleep();
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    clearTimeout(overTimer);
    overTimer = 0;
    overlay = overlayTitle = overlayHint = null;
    hudScore = hudLevel = hudBest = null;
    gestures.clear();
  }

  function resetState(): void {
    core = createCore(MODES[mode]);
    visualRot = 0;
    overT = 0;
    overSides = [];
    particles = [];
    floats = [];
    landFlash.clear();
    levelFlash = 0;
    chevL = chevR = 0;
    lastStatusSec = -1;
    gestures.clear();
    animT = 0;
  }

  function startGame(immediate: boolean): void {
    teardownGame();
    resetState();
    root.innerHTML = '';

    hudScore = el('div', { class: 'stat-value hx-score', text: '0' });
    hudLevel = el('div', { class: 'stat-value', text: '1' });
    hudBest = el('div', { class: 'stat-value', text: String(ctx.storage.getBest(mode) ?? 0) });
    const hud = el(
      'div',
      { class: 'game-hud hx-hud' },
      el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: t('score') }), hudScore),
      el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: t('level') }), hudLevel),
      el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: t('best') }), hudBest),
    );
    const area = el('div', { class: 'game-area hx-area' });
    overlayTitle = el('h2', { text: t('tapToStart') });
    overlayHint = el('p', { text: t('controlsHint') });
    const modesBtn = button(t('modes'), onModes, { variant: 'secondary', size: 'md', class: 'hx-overlay-btn' });
    modesBtn.addEventListener('click', (e) => e.stopPropagation());
    overlay = el('div', { class: 'overlay hx-overlay' }, hexIcon('hx-icon-overlay'), overlayTitle, overlayHint, modesBtn);
    overlay.addEventListener('click', () => {
      if (phase === 'ready') begin();
      else if (phase === 'paused') resumeGame();
    });
    root.append(hud, area);

    cv = createCanvas(area, (w, h) => {
      computeLayout(w, h);
      drawFrame();
    });
    area.append(overlay);
    computeLayout(cv.width, cv.height);
    // A touch rotates only once it is known to be a tap (on release) or a swipe (after a short drag),
    // so a swipe never turns the hexagon the wrong way first.
    offPointer = onPointer(cv.canvas, {
      down(p) {
        if (phase !== 'playing' || !cv) return;
        gestures.set(p.id, gestureStart(p.x, p.y, cv.width));
      },
      move(p) {
        const g = gestures.get(p.id);
        if (!g || phase !== 'playing') return;
        rotate(gestureMove(g, p.x, p.y));
      },
      up(p) {
        const g = gestures.get(p.id);
        gestures.delete(p.id);
        if (!g || phase !== 'playing') return;
        rotate(gestureEnd(g, p.x, p.y));
      },
      cancel(p) {
        gestures.delete(p.id);
      },
    });
    phase = 'ready';
    updateHud();
    updateStatus(true);
    if (immediate) begin();
    else showOverlay(t('tapToStart'), t('controlsHint'));
    syncHeader();
    drawFrame();
    wake();
  }

  function computeLayout(w: number, h: number): void {
    L = computeBoard(w, h, core.cfg);
  }

  function showOverlay(title: string, hint: string): void {
    if (!overlay || !overlayTitle || !overlayHint) return;
    overlayTitle.textContent = title;
    overlayHint.textContent = hint;
    overlay.hidden = false;
  }

  function hideOverlay(): void {
    if (overlay) overlay.hidden = true;
  }

  // ── Phase transitions ─────────────────────────────────────────────────
  function begin(): void {
    if (phase !== 'ready') return;
    phase = 'playing';
    hideOverlay();
    syncHeader();
    ctx.play('swoosh');
    ctx.haptic('light');
    wake();
  }

  function pauseGame(): void {
    if (phase !== 'playing') return;
    phase = 'paused';
    gestures.clear();
    showOverlay(t('paused'), t('tapToResume'));
    syncHeader();
    // The loop finishes any running effect, then sleeps (see frame()).
  }

  function resumeGame(): void {
    if (phase !== 'paused' || modalOpen()) return;
    phase = 'playing';
    hideOverlay();
    syncHeader();
    ctx.play('tap');
    wake();
  }

  /** ↻: start a fresh round of the same mode (after confirming, since progress is lost). */
  function onRestart(): void {
    if (phase !== 'playing' && phase !== 'paused') return;
    pauseGame();
    ctx.showModal({
      title: t('restart'),
      body: t('restartConfirm'),
      buttons: [{ label: t('cancel') }, { label: t('restart'), primary: true, onClick: () => startGame(true) }],
    });
  }

  /** Overlay "Modes" button: back to the difficulty picker (confirming first when a round is under way). */
  function onModes(): void {
    if (phase === 'ready') {
      showStart();
    } else if (phase === 'paused') {
      ctx.showModal({
        title: t('modes'),
        body: t('quitConfirm'),
        buttons: [{ label: t('cancel') }, { label: t('confirm'), primary: true, onClick: () => showStart() }],
      });
    }
  }

  // ── Simulation glue ───────────────────────────────────────────────────
  function rotate(steps: number): void {
    if (!steps || phase !== 'playing') return;
    const now = performance.now();
    if (now - lastMoveSound > 70) {
      ctx.play('move');
      lastMoveSound = now;
    }
    if (steps < 0) chevL = 1;
    else chevR = 1;
    handleEvents(coreRotate(core, steps));
    wake();
  }

  function update(dt: number): void {
    animT += dt;
    if (phase === 'playing') {
      // A shell modal (e.g. the "?" rules sheet) covers the board: pause so the round is not lost unseen.
      if (modalOpen()) pauseGame();
      else {
        handleEvents(coreTick(core, dt, Math.random));
        updateStatus(false);
      }
    } else if (phase === 'over') {
      overT += dt;
    }
    // Visual easing and effects keep running after a pause until they settle.
    const target = core.sim.rotation * 60;
    const diff = target - visualRot;
    visualRot = Math.abs(diff) < 0.02 ? target : visualRot + diff * (1 - Math.exp(-ROT_EASE * dt));
    chevL = Math.max(0, chevL - dt * 4);
    chevR = Math.max(0, chevR - dt * 4);
    levelFlash = Math.max(0, levelFlash - dt);
    for (const [k, v] of landFlash) {
      const nv = v - dt;
      if (nv <= 0) landFlash.delete(k);
      else landFlash.set(k, nv);
    }
    if (particles.length) {
      const keep: Particle[] = [];
      for (const p of particles) {
        p.life -= dt;
        if (p.life <= 0) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 260 * dt;
        p.vx *= 1 - 1.5 * dt;
        keep.push(p);
      }
      particles = keep;
    }
    if (floats.length) {
      const keep: FloatText[] = [];
      for (const f of floats) {
        f.life -= dt;
        if (f.life <= 0) continue;
        f.y -= 28 * dt;
        keep.push(f);
      }
      floats = keep;
    }
  }

  /** Turn core events into sound, haptics and effects. Order matches the core: removals before the cascade they cause. */
  function handleEvents(ev: CoreEvents): void {
    if (ev.levelUp) onLevelUp();
    if (ev.landed.length) {
      ctx.play('place');
      for (const l of ev.landed) landFlash.set(cellKey(l.side, l.level), LAND_FLASH);
    }
    if (ev.removed.length) onRemoved(ev.removed);
    if (ev.cleared.length) onCleared(ev.cleared);
    if (ev.over) gameOver(ev.over);
  }

  function onLevelUp(): void {
    ctx.play('success');
    ctx.haptic('light');
    levelFlash = LEVEL_FLASH;
    if (hudLevel) hudLevel.textContent = String(core.level);
    floats.push({ x: L.cx, y: bannerY(), text: t('levelUp', { n: core.level }), life: 1.3, max: 1.3, color: theme.accent, size: 18 });
    updateStatus(true);
  }

  function onCleared(groups: ClearGroup[]): void {
    let topCombo = 0;
    for (const g of groups) {
      topCombo = Math.max(topCombo, g.combo);
      let sx = 0;
      let sy = 0;
      for (const c of g.cells) {
        const p = cellCentre(c.side, c.level);
        sx += p.x;
        sy += p.y;
      }
      const n = g.cells.length;
      floats.push({ x: sx / n, y: sy / n, text: '+' + g.points, life: 1, max: 1, color: theme.text, size: n >= 5 ? 21 : 17 });
    }
    if (hudScore) hudScore.textContent = String(core.score);
    const best = ctx.storage.getBest(mode) ?? 0;
    if (hudBest && core.score > best) hudBest.textContent = String(core.score);
    ctx.play(topCombo >= 3 ? 'coin' : 'pop');
    ctx.haptic(topCombo >= 3 ? 'medium' : 'light');
  }

  function onRemoved(cells: ClearCell[]): void {
    for (const c of cells) {
      const p = cellCentre(c.side, c.level);
      const color = theme.blocks[c.color % theme.blocks.length];
      for (let i = 0; i < 6 && particles.length < MAX_PARTICLES; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 130;
        particles.push({ x: p.x, y: p.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40, life: 0.45 + Math.random() * 0.3, color, size: 3 + Math.random() * 3 });
      }
    }
    // Blocks above the removed cells dropped, so per-cell landing flashes no longer line up.
    landFlash.clear();
  }

  function gameOver(sides: number[]): void {
    if (phase === 'over') return;
    phase = 'over';
    overT = 0;
    overSides = sides;
    gestures.clear();
    hideOverlay();
    syncHeader();
    ctx.play('lose');
    ctx.haptic('heavy');
    floats.push({ x: L.cx, y: bannerY(), text: t('overflow'), life: 1.5, max: 1.5, color: theme.danger, size: 22 });
    const score = core.score;
    // A round that scored nothing is not a record (the start screen keeps saying "No record yet").
    const isBest = score > 0 && ctx.storage.recordBest(mode, score, 'higher');
    const best = ctx.storage.getBest(mode);
    if (hudBest) hudBest.textContent = String(best ?? 0);
    updateStatus(true);
    const level = core.level;
    const elapsed = core.elapsed;
    overTimer = window.setTimeout(() => {
      overTimer = 0;
      const body = el(
        'div',
        { class: 'hx-result' },
        el('div', { class: 'hx-result-label muted small', text: t('score') }),
        el('div', { class: 'hx-result-score', text: String(score) }),
        el('p', { class: 'muted', text: t('reached', { n: level, t: formatTime(elapsed) }) }),
        el('p', { class: 'muted', text: best === null ? t('noBest') : t('bestLine', { n: best }) }),
        isBest ? el('p', { class: 'hx-result-best', text: '🏆 ' + t('newBest') }) : null,
      );
      ctx.showModal({
        title: t('lose'),
        body,
        dismissible: false,
        buttons: [
          { label: t('home'), onClick: () => ctx.exit() },
          { label: t('modes'), onClick: () => showStart() },
          { label: t('retry'), primary: true, onClick: () => startGame(true) },
        ],
      });
    }, 1000);
  }

  function updateHud(): void {
    if (hudScore) hudScore.textContent = String(core.score);
    if (hudLevel) hudLevel.textContent = String(core.level);
    if (hudBest) hudBest.textContent = String(Math.max(core.score, ctx.storage.getBest(mode) ?? 0));
  }

  function updateStatus(force: boolean): void {
    const sec = Math.floor(core.elapsed);
    if (!force && sec === lastStatusSec) return;
    lastStatusSec = sec;
    ctx.setStatus(`${t('level')} ${core.level} · ${formatTime(core.elapsed)}`);
  }

  // ── Geometry helpers ──────────────────────────────────────────────────
  /** Canvas angle (degrees) of local side `s`'s outward normal, following the eased rotation. */
  function sideAngle(s: number): number {
    return visualRot + s * 60;
  }

  /** Canvas position of the centre of a stacked cell (uses the eased visual rotation). */
  function cellCentre(side: number, levelIdx: number): { x: number; y: number } {
    const ang = sideAngle(side) * DEG;
    const r = L.a0 + (levelIdx + 0.5) * L.lvl;
    return { x: L.cx + Math.cos(ang) * r, y: L.cy + Math.sin(ang) * r };
  }

  /** Y of the free band above the board (no falling block ever reaches it) for banners. */
  function bannerY(): number {
    const gap = spawnDistance(core.cfg) - core.cfg.maxLevels;
    return Math.max(18, L.cy - (L.R + (gap + 1) * L.lvl) / COS30 - 18);
  }

  /** Trapezoid between apothems a1..a2 in a frame whose +x axis is the side's outward normal. */
  function trap(c: CanvasRenderingContext2D, a1: number, a2: number, inset: number): void {
    const i1 = a1 + inset;
    const i2 = a2 - inset;
    const s = inset * 1.15;
    c.beginPath();
    c.moveTo(i1, -i1 * TAN30 + s);
    c.lineTo(i2, -i2 * TAN30 + s);
    c.lineTo(i2, i2 * TAN30 - s);
    c.lineTo(i1, i1 * TAN30 - s);
    c.closePath();
  }

  /** Light edge on the outer face of a block (gives the stack some depth). */
  function edgeHighlight(c: CanvasRenderingContext2D, a2: number, alpha: number): void {
    const e = a2 - 1.6;
    c.beginPath();
    c.moveTo(e, -e * TAN30 + 2.6);
    c.lineTo(e, e * TAN30 - 2.6);
    c.strokeStyle = `rgba(255,255,255,${alpha})`;
    c.lineWidth = 1.5;
    c.stroke();
  }

  /**
   * Small symbol per colour id (dot, triangle, cross, square, ring) at radius `x` of a frame rotated by
   * `frameDeg`, drawn upright so colours can also be told apart by shape (colour-blind players).
   */
  function glyph(c: CanvasRenderingContext2D, x: number, frameDeg: number, id: number): void {
    const r = Math.max(2.6, Math.min(5, L.lvl * 0.27));
    c.save();
    c.translate(x, 0);
    c.rotate(-frameDeg * DEG);
    c.fillStyle = theme.glyph;
    c.strokeStyle = theme.glyph;
    c.lineWidth = Math.max(1.4, r * 0.42);
    c.lineCap = 'round';
    c.beginPath();
    switch (id % 5) {
      case 0:
        c.arc(0, 0, r * 0.78, 0, Math.PI * 2);
        c.fill();
        break;
      case 1:
        c.moveTo(0, -r);
        c.lineTo(r * 0.98, r * 0.72);
        c.lineTo(-r * 0.98, r * 0.72);
        c.closePath();
        c.fill();
        break;
      case 2:
        c.moveTo(-r * 0.72, -r * 0.72);
        c.lineTo(r * 0.72, r * 0.72);
        c.moveTo(r * 0.72, -r * 0.72);
        c.lineTo(-r * 0.72, r * 0.72);
        c.stroke();
        break;
      case 3:
        c.rect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
        c.fill();
        break;
      default:
        c.arc(0, 0, r * 0.72, 0, Math.PI * 2);
        c.stroke();
        break;
    }
    c.restore();
  }

  /** Pointy-top hexagon path (vertices at 30° + k·60°) around the origin. */
  function hexPath(c: CanvasRenderingContext2D, apothem: number, rotDeg: number): void {
    const r = apothem / COS30;
    c.beginPath();
    for (let k = 0; k < SIDES; k++) {
      const a = (rotDeg + 30 + k * 60) * DEG;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (k === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function drawFrame(): void {
    if (!cv) return;
    const c = cv.ctx;
    const W = cv.width;
    const H = cv.height;
    c.setTransform(cv.dpr, 0, 0, cv.dpr, 0, 0);
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, W, H);

    c.save();
    let sx = 0;
    let sy = 0;
    if (phase === 'over' && overT < OVER_SHAKE) {
      const k = (1 - overT / OVER_SHAKE) * 7;
      sx = Math.sin(overT * 90) * k;
      sy = Math.cos(overT * 70) * k * 0.5;
    }
    c.translate(L.cx + sx, L.cy + sy);
    drawBoard(c);
    drawStacks(c);
    drawGhosts(c);
    drawFalling(c);
    drawCentre(c);
    c.restore();

    drawEffects(c);
    drawCombo(c, H);
    drawChevrons(c, W, H);
  }

  function drawBoard(c: CanvasRenderingContext2D): void {
    const maxLevels = core.cfg.maxLevels;
    // Play field tint.
    hexPath(c, L.R, 0);
    c.fillStyle = rgba(theme.surface, themeName === 'dark' ? 0.55 : 0.9);
    c.fill();
    // World-fixed lane dividers (from the centre hexagon out past the ring).
    c.strokeStyle = rgba(theme.border, 0.7);
    c.lineWidth = 1;
    const r1 = L.a0 / COS30;
    const r2 = L.R / COS30;
    c.beginPath();
    for (let k = 0; k < SIDES; k++) {
      const a = (30 + k * 60) * DEG;
      c.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      c.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    }
    c.stroke();
    // Boundary ring (flashes in the accent colour on level up).
    hexPath(c, L.R, 0);
    c.strokeStyle = theme.border;
    c.lineWidth = 2;
    c.stroke();
    if (levelFlash > 0) {
      hexPath(c, L.R, 0);
      c.strokeStyle = rgba(theme.accent, (levelFlash / LEVEL_FLASH) * 0.9);
      c.lineWidth = 3;
      c.stroke();
    }
    // Danger highlight on the ring where a nearly full stack sits.
    const pulse = 0.55 + 0.45 * Math.sin(animT * 8);
    for (let s = 0; s < SIDES; s++) {
      const h = core.sim.stacks[s].length;
      if (h < maxLevels - 1) continue;
      const over = overSides.includes(s) || h > maxLevels;
      const a = sideAngle(s) * DEG;
      const x1 = Math.cos(a - Math.PI / 6) * r2;
      const y1 = Math.sin(a - Math.PI / 6) * r2;
      const x2 = Math.cos(a + Math.PI / 6) * r2;
      const y2 = Math.sin(a + Math.PI / 6) * r2;
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.strokeStyle = rgba(theme.danger, over ? 1 : 0.35 + 0.55 * pulse);
      c.lineWidth = over ? 5 : 3;
      c.stroke();
    }
  }

  function drawStacks(c: CanvasRenderingContext2D): void {
    const clearing = core.clearing;
    const prog = clearing ? Math.min(1, clearing.t / CLEAR_DUR) : 0;
    for (let s = 0; s < SIDES; s++) {
      const col = core.sim.stacks[s];
      if (!col.length) continue;
      const ang = sideAngle(s);
      c.save();
      c.rotate(ang * DEG);
      for (let k = 0; k < col.length; k++) {
        const a1 = L.a0 + k * L.lvl;
        const a2 = a1 + L.lvl;
        const key = cellKey(s, k);
        const color = theme.blocks[col[k] % theme.blocks.length];
        trap(c, a1, a2, 1);
        c.fillStyle = color;
        c.fill();
        edgeHighlight(c, a2, 0.3);
        glyph(c, (a1 + a2) / 2, ang, col[k]);
        if (k >= core.cfg.maxLevels) {
          trap(c, a1, a2, 1);
          c.strokeStyle = theme.danger;
          c.lineWidth = 2;
          c.stroke();
        }
        if (clearing && clearing.cells.has(key)) {
          trap(c, a1, a2, 1);
          c.fillStyle = `rgba(255,255,255,${0.25 + 0.7 * prog})`;
          c.fill();
        } else {
          const f = landFlash.get(key);
          if (f !== undefined) {
            trap(c, a1, a2, 1);
            c.fillStyle = `rgba(255,255,255,${(0.45 * f) / LAND_FLASH})`;
            c.fill();
          }
        }
      }
      c.restore();
    }
  }

  /** Dashed outline where the lowest block in each lane will land (red when that would overflow). */
  function drawGhosts(c: CanvasRenderingContext2D): void {
    if (phase !== 'playing' && phase !== 'paused') return;
    const seen = new Set<number>();
    const sorted = core.sim.falling.slice().sort((a, b) => a.pos - b.pos);
    for (const f of sorted) {
      if (seen.has(f.lane)) continue;
      seen.add(f.lane);
      const side = localSide(f.lane, core.sim.rotation);
      const h = core.sim.stacks[side].length;
      if (f.pos <= h + 0.05) continue;
      const danger = h >= core.cfg.maxLevels;
      const color = danger ? theme.danger : theme.blocks[f.color % theme.blocks.length];
      c.save();
      c.rotate(f.lane * 60 * DEG);
      const a1 = L.a0 + h * L.lvl;
      trap(c, a1, a1 + L.lvl, 1);
      c.fillStyle = rgba(color, danger ? 0.22 : 0.13);
      c.fill();
      c.setLineDash([4, 3]);
      c.strokeStyle = rgba(color, danger ? 0.95 : 0.7);
      c.lineWidth = 1.5;
      c.stroke();
      c.setLineDash([]);
      c.restore();
    }
  }

  function drawFalling(c: CanvasRenderingContext2D): void {
    for (const f of core.sim.falling) {
      const ang = f.lane * 60;
      c.save();
      c.rotate(ang * DEG);
      const a1 = L.a0 + f.pos * L.lvl;
      const a2 = a1 + L.lvl;
      const color = theme.blocks[f.color % theme.blocks.length];
      // Short motion streak behind the block.
      c.globalAlpha = 0.14;
      trap(c, a2, a2 + L.lvl * 0.9, 1);
      c.fillStyle = color;
      c.fill();
      c.globalAlpha = 1;
      trap(c, a1, a2, 1);
      c.fillStyle = color;
      c.fill();
      edgeHighlight(c, a2, 0.35);
      glyph(c, (a1 + a2) / 2, ang, f.color);
      c.restore();
    }
  }

  function drawCentre(c: CanvasRenderingContext2D): void {
    const g = c.createRadialGradient(0, 0, L.a0 * 0.2, 0, 0, L.a0);
    g.addColorStop(0, theme.surface2);
    g.addColorStop(1, theme.surface);
    hexPath(c, L.a0 - 1, visualRot);
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = phase === 'over' ? theme.danger : theme.accent;
    c.lineWidth = 2.5;
    c.stroke();
    hexPath(c, L.a0 * 0.62, visualRot);
    c.strokeStyle = rgba(theme.accent, 0.3);
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = theme.text;
    c.font = `800 ${Math.round(L.a0 * 0.72)}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(core.level), 0, 1);
  }

  function drawEffects(c: CanvasRenderingContext2D): void {
    for (const p of particles) {
      c.globalAlpha = Math.max(0, Math.min(1, p.life / 0.3));
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const f of floats) {
      const k = f.life / f.max;
      c.globalAlpha = k < 0.3 ? k / 0.3 : 1;
      c.font = `800 ${f.size}px ${FONT}`;
      c.lineWidth = 4;
      c.strokeStyle = rgba(theme.bg, 0.85);
      c.strokeText(f.text, f.x, f.y);
      c.fillStyle = f.color;
      c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;
  }

  /** Combo readout in the free band at the bottom of the canvas (reserved by computeBoard). */
  function drawCombo(c: CanvasRenderingContext2D, H: number): void {
    if ((phase !== 'playing' && phase !== 'paused') || core.combo < 2) return;
    const since = core.elapsed - core.lastClearAt;
    if (since > COMBO_WINDOW) return;
    const rem = 1 - since / COMBO_WINDOW;
    const y = H - 48;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 15px ${FONT}`;
    c.fillStyle = theme.warning;
    c.fillText(`${t('combo', { n: core.combo })} · ×${comboMultiplier(core.combo).toFixed(1)}`, L.cx, y);
    const w = 128;
    c.fillStyle = rgba(theme.border, 0.8);
    c.fillRect(L.cx - w / 2, y + 13, w, 4);
    c.fillStyle = theme.warning;
    c.fillRect(L.cx - w / 2, y + 13, w * rem, 4);
  }

  function drawChevrons(c: CanvasRenderingContext2D, W: number, H: number): void {
    if (phase === 'over') return;
    const y = H - 36;
    const tri = (x: number, dir: number, k: number) => {
      c.beginPath();
      c.moveTo(x + dir * 12, y);
      c.lineTo(x - dir * 8, y - 12);
      c.lineTo(x - dir * 8, y + 12);
      c.closePath();
      c.fillStyle = rgba(theme.text, 0.18 + 0.7 * k);
      c.fill();
    };
    tri(40, -1, chevL);
    tri(W - 40, 1, chevR);
  }

  // Dev-only inspection hook for scripted play tests (tree-shaken out of production builds).
  if (import.meta.env.DEV) {
    const w = window as unknown as { __hx?: unknown };
    w.__hx = {
      state: () => ({
        phase,
        score: core.score,
        level: core.level,
        combo: core.combo,
        rotation: core.sim.rotation,
        stacks: core.sim.stacks.map((c) => c.slice()),
        falling: core.sim.falling.map((f) => ({ ...f })),
        looping: raf !== 0,
      }),
    };
    ctx.onDestroy(() => {
      delete w.__hx;
    });
  }

  showStart();
  return {
    destroy() {
      teardownGame();
    },
  };
}

const game: GameModule = { strings, create };
export default game;
