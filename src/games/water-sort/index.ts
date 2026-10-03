import type { GameContext, GameInstance, GameModule, ThemeName } from '../../app/types';
import { el, button } from '../../app/ui';
import { createCanvas, createLoop, onPointer, roundRect, clamp, type CanvasHandle } from '../../app/canvas';
import {
  CAP,
  HINTS_PER_LEVEL,
  applyPour,
  colourCountFor,
  emptyCountFor,
  generateLevel,
  greedyHint,
  hasMoves,
  isChallengeLevel,
  isComplete,
  isSolved,
  pourAmount,
  solveForPlay,
  starsFor,
  type Level,
  type Move,
  type State,
} from './logic';
import { strings } from './strings';
import './style.css';

/** Twelve liquid colours chosen to stay distinct on both themes. */
const PALETTE = ['#ff3b5c', '#ff8c1a', '#ffd60a', '#a3e635', '#22c55e', '#14b8a6', '#38bdf8', '#3b6cff', '#8b5cf6', '#f472b6', '#a16207', '#94a3b8'];

const LIFT_PX = 18;
const TRAVEL_MS = 150;
const POUR_BASE_MS = 170;
const POUR_PER_UNIT_MS = 45;
const RETURN_MS = 150;
const SHAKE_MS = 320;
const TILT = 0.95; // radians the pouring tube leans
const WIN_DELAY_MS = 700;
/** Win shimmer: a whole number of sweeps, so it ends with the band off the board. */
const WIN_SWEEP_MS = 900;
const WIN_SHIMMER_MS = WIN_SWEEP_MS * 3;
const MAX_PICKER_CHIPS = 100;
/** Top padding of .ws-picker (style.css); chips are scrolled to sit just below it. */
const PICKER_PAD = 4;

type Phase = 'start' | 'playing' | 'won';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  rects: Rect[];
  tubeW: number;
  tubeH: number;
  slotW: number;
}

interface PourAnim {
  from: number;
  to: number;
  colour: number;
  count: number;
  fromBefore: number[];
  toBefore: number[];
  t: number;
  travel: number;
  pour: number;
  ret: number;
  side: 1 | -1;
  /** Hover position (centre) and angle while pouring. */
  hx: number;
  hy: number;
  angle: number;
  /** Rest position (centre) the tube returns to. */
  rx: number;
  ry: number;
}

interface Colours {
  accent: string;
  success: string;
  warning: string;
  text: string;
  muted: string;
  glass: string;
  glassFill: string;
  lip: string;
  sheen: string;
  shadow: string;
}

const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);
const easeInOut = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;

  // ── Persistent progress ───────────────────────────────────────────────
  const readInt = (key: string, fallback: number): number => {
    const v = ctx.storage.get<unknown>(key, fallback);
    return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
  };
  let unlocked = Math.max(1, readInt('unlocked', 1));
  let level = clamp(readInt('level', 1), 1, unlocked);
  const readMap = (key: string): Record<string, number> => {
    const v = ctx.storage.get<unknown>(key, {});
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, number>) : {};
  };
  const starsMap = readMap('stars');
  /** Hints spent per level; kept across restarts and cleared when the level is won. */
  const hintsUsed = readMap('hintsUsed');
  const hintsLeftFor = (n: number): number => {
    const used = hintsUsed[String(n)];
    return clamp(HINTS_PER_LEVEL - (typeof used === 'number' && Number.isFinite(used) ? Math.floor(used) : 0), 0, HINTS_PER_LEVEL);
  };

  // ── Round state ───────────────────────────────────────────────────────
  let phase: Phase = 'start';
  let lvl: Level | null = null;
  let state: State = [];
  let history: State[] = [];
  let moves = 0;
  let hintsLeft = HINTS_PER_LEVEL;
  let selected = -1;
  let hintMove: Move | null = null;
  let hintT = 0;
  let anim: PourAnim | null = null;
  let lift = new Float32Array(0);
  let shakeT = new Float32Array(0);
  let doneT = new Float32Array(0);
  let winT = -1;
  let winTimer = 0;
  let dirty = true;

  // ── DOM / canvas ──────────────────────────────────────────────────────
  let cv: CanvasHandle | null = null;
  let loop: ReturnType<typeof createLoop> | null = null;
  let offPointer: (() => void) | null = null;
  let layout: Layout = { rects: [], tubeW: 44, tubeH: 150, slotW: 56 };
  let hudLevel: HTMLElement | null = null;
  let hudMoves: HTMLElement | null = null;
  let hudBest: HTMLElement | null = null;
  let hudHints: HTMLElement | null = null;
  let undoBtn: HTMLButtonElement | null = null;
  let hintBtn: HTMLButtonElement | null = null;
  let headerOff: (() => void)[] = [];
  let colours = readColours(ctx.theme);

  function readColours(theme: ThemeName): Colours {
    const dark = theme === 'dark';
    return {
      accent: ctx.cssVar('--accent') || '#5b8cff',
      success: ctx.cssVar('--success') || '#3ddc97',
      warning: ctx.cssVar('--warning') || '#ffc857',
      text: ctx.cssVar('--text') || (dark ? '#e8ecf3' : '#171a21'),
      muted: ctx.cssVar('--muted') || '#8b94a7',
      glass: dark ? 'rgba(255,255,255,0.4)' : 'rgba(23,26,33,0.35)',
      glassFill: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)',
      lip: dark ? 'rgba(255,255,255,0.5)' : 'rgba(23,26,33,0.45)',
      sheen: dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.45)',
      shadow: dark ? 'rgba(0,0,0,0.45)' : 'rgba(20,30,60,0.18)',
    };
  }

  // ── Global lifecycle (header actions exist only while a level is on screen) ──
  const onKey = (e: KeyboardEvent): void => {
    if (phase !== 'playing') return;
    if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
      e.preventDefault();
      undo();
    } else if (e.key === 'h' || e.key === 'H') {
      giveHint();
    } else if (e.key === 'Escape' && selected >= 0) {
      selected = -1;
      dirty = true;
    }
  };
  window.addEventListener('keydown', onKey);
  ctx.onDestroy(() => {
    window.removeEventListener('keydown', onKey);
    teardownGame();
  });
  ctx.onVisibility((visible) => {
    if (!loop) return;
    if (visible) {
      dirty = true;
      loop.start();
    } else loop.stop();
  });
  ctx.onThemeChange((theme) => {
    colours = readColours(theme);
    dirty = true;
  });

  // ── Start screen with level picker ────────────────────────────────────
  function showStart(): void {
    teardownGame();
    phase = 'start';
    root.innerHTML = '';
    ctx.setStatus('');
    level = clamp(level, 1, unlocked);

    const title = el('div', { class: 'ws-level-title' });
    const sub = el('p', { class: 'muted ws-level-sub' });
    const bestLine = el('p', { class: 'muted small ws-best' });
    const picker = el('div', { class: 'ws-picker', role: 'listbox', 'aria-label': t('chooseLevel') });
    const prev = el('button', { class: 'ws-step', type: 'button', 'aria-label': t('prevLevel'), text: '‹' }) as HTMLButtonElement;
    const next = el('button', { class: 'ws-step', type: 'button', 'aria-label': t('laterLevel'), text: '›' }) as HTMLButtonElement;
    const chips = new Map<number, HTMLButtonElement>();

    const refresh = (scroll: boolean): void => {
      title.textContent = t('levelN', { n: level });
      const c = { c: colourCountFor(level), e: emptyCountFor(level) };
      sub.textContent = t('levelInfo', c) + (isChallengeLevel(level) ? ' · ' : '');
      sub.classList.toggle('ws-challenge', false);
      if (isChallengeLevel(level)) sub.append(el('span', { class: 'ws-challenge', text: t('challengeTag') }));
      const best = ctx.storage.getBest('L' + level);
      const highest = Math.max(unlocked - 1, 1);
      const parts = [t('highest', { n: highest })];
      parts.push(best === null ? t('noRecord') : t('bestMoves', { n: best }));
      bestLine.textContent = parts.join(' · ');
      prev.disabled = level <= 1;
      next.disabled = level >= unlocked;
      for (const [n, chip] of chips) chip.classList.toggle('active', n === level);
      const active = chips.get(level);
      // Scroll only the picker (never the page), row-aligned so no half-clipped row shows at the top.
      if (scroll && active) picker.scrollTop = Math.max(0, active.offsetTop - PICKER_PAD);
      ctx.storage.set('level', level);
    };
    prev.addEventListener('click', () => {
      if (level <= 1) return;
      ctx.play('tap');
      level--;
      refresh(true);
    });
    next.addEventListener('click', () => {
      if (level >= unlocked) return;
      ctx.play('tap');
      level++;
      refresh(true);
    });
    const first = Math.max(1, unlocked - MAX_PICKER_CHIPS + 1);
    for (let n = first; n <= unlocked; n++) {
      const stars = clamp(Math.floor(Number(starsMap[String(n)]) || 0), 0, 3);
      const chip = el(
        'button',
        { class: 'ws-chip' + (isChallengeLevel(n) ? ' challenge' : ''), type: 'button', role: 'option' },
        el('span', { text: String(n) }),
        el('span', { class: 'ws-stars', text: stars > 0 ? '★'.repeat(stars) : '' }),
      ) as HTMLButtonElement;
      chip.addEventListener('click', () => {
        if (level === n) return;
        ctx.play('tap');
        ctx.haptic('light');
        level = n;
        refresh(false);
      });
      chips.set(n, chip);
      picker.append(chip);
    }
    const playBtn = button(t('play'), () => startLevel(level), { variant: 'primary', size: 'lg', class: 'ws-play' });
    root.append(
      el(
        'div',
        { class: 'start-screen ws-start' },
        el(
          'div',
          { class: 'ws-start-inner' },
          el('div', { class: 'big-icon', text: '🧪' }),
          el('p', { class: 'muted ws-desc', text: t('desc') }),
          el('div', { class: 'ws-stepper' }, prev, title, next),
          sub,
          picker,
          bestLine,
          playBtn,
          unlocked > 1 ? null : el('p', { class: 'muted small ws-note', text: t('lockedNote') }),
        ),
      ),
    );
    refresh(true);
  }

  // ── Game screen ───────────────────────────────────────────────────────
  function startLevel(n: number): void {
    teardownGame();
    level = clamp(n, 1, Math.max(unlocked, 1));
    ctx.storage.set('level', level);
    // Levels are deterministic, so a restart or replay reuses the board instead of re-running the solver.
    if (!lvl || lvl.level !== level) lvl = generateLevel(level);
    state = lvl.tubes.map((tube) => tube.slice());
    history = [];
    moves = 0;
    hintsLeft = hintsLeftFor(level);
    selected = -1;
    hintMove = null;
    anim = null;
    winT = -1;
    lift = new Float32Array(state.length);
    shakeT = new Float32Array(state.length);
    doneT = new Float32Array(state.length).fill(-1);
    phase = 'playing';
    dirty = true;

    root.innerHTML = '';
    headerOff = [
      ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: onRestart }),
      ctx.addHeaderAction({ icon: '↶', label: t('undo'), onClick: undo }),
      ctx.addHeaderAction({ icon: '💡', label: t('hint'), onClick: giveHint }),
    ];
    const hud = el(
      'div',
      { class: 'game-hud ws-hud' },
      stat(t('level'), (e) => (hudLevel = e)),
      stat(t('movesPar'), (e) => (hudMoves = e)),
      stat(t('best'), (e) => (hudBest = e)),
      stat(t('hints'), (e) => (hudHints = e)),
    );
    const area = el('div', { class: 'game-area ws-area' });
    undoBtn = button(t('undo'), undo, { variant: 'secondary', icon: '↶' });
    hintBtn = button(t('hintBtn', { n: hintsLeft }), giveHint, { variant: 'secondary', icon: '💡' });
    const controls = el('div', { class: 'game-controls ws-controls' }, undoBtn, hintBtn);
    root.append(hud, area, controls);

    cv = createCanvas(area, (w, h) => {
      layout = computeLayout(w, h, state.length);
      dirty = true;
    });
    offPointer = onPointer(cv.canvas, pointerHandlers());
    loop = createLoop((dt) => {
      update(dt * 1000);
      if (dirty || anim || hintVisible() || (winT >= 0 && winT < WIN_SHIMMER_MS) || anyTransient()) {
        dirty = false;
        draw();
      }
    });
    loop.start();
    updateHud();
  }

  function teardownGame(): void {
    for (const off of headerOff) off();
    headerOff = [];
    loop?.stop();
    loop = null;
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    clearTimeout(winTimer);
    winTimer = 0;
    anim = null;
    hintMove = null;
    hudLevel = hudMoves = hudBest = hudHints = null;
    undoBtn = hintBtn = null;
  }

  function stat(label: string, ref: (e: HTMLElement) => void): HTMLElement {
    const value = el('div', { class: 'stat-value', text: '0' });
    ref(value);
    return el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: label }), value);
  }

  function setBtnLabel(btn: HTMLButtonElement | null, text: string): void {
    if (btn?.lastElementChild) btn.lastElementChild.textContent = text;
  }

  function updateHud(): void {
    if (!lvl) return;
    if (hudLevel) hudLevel.textContent = String(level) + (isChallengeLevel(level) ? ' ⚡' : '');
    if (hudMoves) hudMoves.textContent = `${moves} / ${lvl.par}`;
    if (hudBest) {
      const b = ctx.storage.getBest('L' + level);
      hudBest.textContent = b === null ? '–' : String(b);
    }
    if (hudHints) hudHints.textContent = '💡'.repeat(hintsLeft) || '–';
    setBtnLabel(hintBtn, t('hintBtn', { n: hintsLeft }));
    if (undoBtn) undoBtn.disabled = history.length === 0 || phase !== 'playing';
    if (hintBtn) hintBtn.disabled = hintsLeft <= 0 || phase !== 'playing';
    ctx.setStatus(`${t('levelN', { n: level })} · ${moves}/${lvl.par}`);
  }

  // ── Layout ────────────────────────────────────────────────────────────
  function computeLayout(w: number, h: number, n: number): Layout {
    const padX = 10;
    const padTop = LIFT_PX + 26;
    const padBottom = 12;
    const rowGap = LIFT_PX + 10;
    const maxTubeW = Math.min(76, 44 + w / 24);
    let best: { rows: number; tubeW: number } | null = null;
    for (let rows = 1; rows <= 3; rows++) {
      const cols = Math.ceil(n / rows);
      if (rows > 1 && cols === Math.ceil(n / (rows - 1))) continue;
      const slotW = (w - padX * 2) / cols;
      const availH = h - padTop - padBottom - rowGap * (rows - 1);
      const tubeW = Math.min(slotW * 0.74, maxTubeW, availH / rows / 3.2);
      if (!best || tubeW > best.tubeW * 1.15) best = { rows, tubeW };
    }
    const rows = best?.rows ?? 1;
    const tubeW = Math.max(14, best?.tubeW ?? 14);
    const tubeH = tubeW * 3.2;
    const cols = Math.ceil(n / rows);
    const slotW = Math.min((w - padX * 2) / cols, tubeW * 1.6);
    const totalH = rows * tubeH + (rows - 1) * rowGap;
    const y0 = padTop + Math.max(0, (h - padTop - padBottom - totalH) / 2);
    const rects: Rect[] = [];
    for (let r = 0; r < rows; r++) {
      const count = r < rows - 1 ? cols : n - cols * (rows - 1);
      const rowW = count * slotW;
      const x0 = (w - rowW) / 2;
      for (let c = 0; c < count; c++) {
        rects.push({ x: x0 + c * slotW + (slotW - tubeW) / 2, y: y0 + r * (tubeH + rowGap), w: tubeW, h: tubeH });
      }
    }
    return { rects, tubeW, tubeH, slotW };
  }

  function tubeAt(x: number, y: number): number {
    const { rects, slotW } = layout;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const cx = r.x + r.w / 2;
      if (Math.abs(x - cx) <= slotW / 2 && y >= r.y - LIFT_PX - 12 && y <= r.y + r.h + 10) return i;
    }
    return -1;
  }

  // ── Input ─────────────────────────────────────────────────────────────
  function pointerHandlers() {
    let downX = 0;
    let downY = 0;
    let downId = -1;
    return {
      down(p: { x: number; y: number; id: number }) {
        if (downId !== -1) return;
        downId = p.id;
        downX = p.x;
        downY = p.y;
      },
      up(p: { x: number; y: number; id: number }) {
        if (p.id !== downId) return;
        downId = -1;
        if (Math.hypot(p.x - downX, p.y - downY) > 14) return;
        onTap(tubeAt(p.x, p.y));
      },
      cancel(p: { id: number }) {
        if (p.id === downId) downId = -1;
      },
    };
  }

  /** The pour on screen solves the board: input waits for the win instead of cutting it short. */
  function finalPourPending(): boolean {
    return anim !== null && isSolved(state);
  }

  /** The hint ring shows only while the hinted source tube is the one lifted. */
  function hintVisible(): boolean {
    return hintMove !== null && selected === hintMove.from;
  }

  function onTap(i: number): void {
    if (phase !== 'playing' || finalPourPending()) return;
    if (anim) finishAnim();
    if (phase !== 'playing') return;
    dirty = true;
    if (i < 0) {
      if (selected >= 0) {
        selected = -1;
        ctx.play('tap');
      }
      return;
    }
    const tube = state[i];
    if (selected < 0) {
      if (tube.length === 0) {
        reject(i, t('emptyTube'));
        return;
      }
      if (isComplete(tube)) {
        reject(i, t('sealed'));
        return;
      }
      selected = i;
      ctx.play('tap');
      ctx.haptic('light');
      return;
    }
    if (selected === i) {
      selected = -1;
      ctx.play('tap');
      return;
    }
    if (pourAmount(state, selected, i) > 0) {
      doPour(selected, i);
      return;
    }
    // Invalid pour: shake the target, then move the selection there when it is a usable source.
    ctx.play('error');
    ctx.haptic('error');
    shakeT[i] = SHAKE_MS;
    selected = tube.length > 0 && !isComplete(tube) ? i : -1;
  }

  let lastRejectToast = 0;
  function reject(i: number, msg: string): void {
    ctx.play('error');
    ctx.haptic('error');
    shakeT[i] = SHAKE_MS;
    const now = performance.now();
    if (now - lastRejectToast > 1500) {
      lastRejectToast = now;
      ctx.toast(msg, 1200);
    }
  }

  function doPour(from: number, to: number): void {
    const before = state;
    const res = applyPour(state, from, to);
    if (!res) return;
    history.push(before);
    state = res.state;
    moves++;
    selected = -1;
    hintMove = null;
    const r = layout.rects;
    const src = r[from];
    const dst = r[to];
    const side: 1 | -1 = dst.x + dst.w / 2 > (cv?.width ?? 390) / 2 ? -1 : 1;
    const angle = -side * TILT;
    const mouthX = dst.x + dst.w / 2 + side * dst.w * 0.3;
    const mouthY = dst.y - dst.w * 0.35;
    anim = {
      from,
      to,
      colour: res.colour,
      count: res.moved,
      fromBefore: before[from],
      toBefore: before[to],
      t: 0,
      travel: TRAVEL_MS,
      pour: POUR_BASE_MS + POUR_PER_UNIT_MS * res.moved,
      ret: RETURN_MS,
      side,
      hx: mouthX - (src.h / 2) * Math.sin(angle),
      hy: mouthY + (src.h / 2) * Math.cos(angle),
      angle,
      rx: src.x + src.w / 2,
      ry: src.y + src.h / 2,
    };
    lift[from] = 1;
    ctx.play('move');
    ctx.haptic('light');
    updateHud();
    dirty = true;
  }

  function finishAnim(): void {
    if (!anim) return;
    const a = anim;
    anim = null;
    lift[a.from] = 0;
    afterPour(a.to);
  }

  function afterPour(to: number): void {
    if (phase !== 'playing') return;
    if (isComplete(state[to])) {
      doneT[to] = 0;
      ctx.play('place');
      ctx.haptic('medium');
    }
    if (isSolved(state)) {
      win();
    } else if (!hasMoves(state)) {
      ctx.haptic('medium');
      ctx.toast(t('stuck'), 2200);
    }
    dirty = true;
  }

  function undo(): void {
    if (phase !== 'playing' || history.length === 0 || finalPourPending()) return;
    if (anim) finishAnim();
    if (phase !== 'playing' || history.length === 0) return;
    state = history.pop()!;
    moves = Math.max(0, moves - 1);
    selected = -1;
    hintMove = null;
    for (let i = 0; i < state.length; i++) if (!isComplete(state[i])) doneT[i] = -1;
    ctx.play('pop');
    ctx.haptic('light');
    updateHud();
    dirty = true;
  }

  function giveHint(): void {
    if (phase !== 'playing' || !lvl || finalPourPending()) return;
    if (hintsLeft <= 0) {
      ctx.play('error');
      ctx.toast(t('noHints'));
      return;
    }
    if (anim) finishAnim();
    if (phase !== 'playing') return;
    const res = solveForPlay(state, { exact: 20000, greedy: 40000 });
    if (res.status === 'unsolvable') {
      ctx.play('error');
      ctx.haptic('error');
      ctx.toast(t('hintDeadEnd'), 2400);
      dirty = true;
      return;
    }
    const mv = res.status === 'solved' ? res.moves[0] ?? null : greedyHint(state);
    if (!mv) {
      ctx.toast(t('stuck'));
      return;
    }
    hintsLeft--;
    hintsUsed[String(level)] = HINTS_PER_LEVEL - hintsLeft;
    ctx.storage.set('hintsUsed', hintsUsed);
    hintMove = mv;
    hintT = 0;
    selected = mv.from;
    ctx.play('success');
    ctx.haptic('light');
    ctx.toast(t('hintShown'), 1600);
    updateHud();
    dirty = true;
  }

  function onRestart(): void {
    if (phase !== 'playing' || finalPourPending()) return;
    const untouched = moves === 0 && history.length === 0;
    const replayed = level;
    ctx.showModal({
      title: t('restartTitle'),
      body: untouched ? t('restartFresh') : t('restartBody'),
      buttons: untouched
        ? [{ label: t('cancel') }, { label: t('levels'), primary: true, onClick: () => phase === 'playing' && showStart() }]
        : [
            { label: t('cancel') },
            { label: t('levels'), onClick: () => phase === 'playing' && showStart() },
            { label: t('restartLevel'), primary: true, onClick: () => phase === 'playing' && startLevel(replayed) },
          ],
    });
  }

  function win(): void {
    if (!lvl) return;
    phase = 'won';
    selected = -1;
    hintMove = null;
    winT = 0;
    const par = lvl.par;
    const stars = starsFor(moves, par);
    const prevStars = Number(starsMap[String(level)]) || 0;
    if (stars > prevStars) {
      starsMap[String(level)] = stars;
      ctx.storage.set('stars', starsMap);
    }
    if (level + 1 > unlocked) {
      unlocked = level + 1;
      ctx.storage.set('unlocked', unlocked);
    }
    if (String(level) in hintsUsed) {
      delete hintsUsed[String(level)];
      ctx.storage.set('hintsUsed', hintsUsed);
    }
    const isBest = ctx.storage.recordBest('L' + level, moves, 'lower');
    ctx.storage.recordBest('level', level, 'higher');
    ctx.play('win');
    ctx.haptic('success');
    updateHud();
    const starRow = el('div', { class: 'ws-result-stars' });
    for (let i = 0; i < 3; i++) starRow.append(el('span', { class: i < stars ? '' : 'dim', text: '★' }));
    const body = el(
      'div',
      { class: 'ws-result' },
      starRow,
      el('p', { text: t('resultMoves', { n: moves, p: par }) }),
      stars === 3 ? el('p', { text: t('perfect') }) : null,
      isBest ? el('p', { class: 'ws-new-best', text: '🏆 ' + t('newBest') }) : null,
    );
    clearTimeout(winTimer);
    winTimer = window.setTimeout(() => {
      ctx.showModal({
        title: t('levelComplete'),
        body,
        dismissible: false,
        buttons: [
          { label: t('home'), onClick: () => ctx.exit() },
          { label: t('replay'), onClick: () => startLevel(level) },
          { label: t('nextLevel'), primary: true, onClick: () => startLevel(level + 1) },
        ],
      });
    }, WIN_DELAY_MS);
  }

  // ── Animation update ──────────────────────────────────────────────────
  function anyTransient(): boolean {
    for (let i = 0; i < lift.length; i++) {
      const target = selected === i ? 1 : 0;
      if (Math.abs(lift[i] - target) > 0.001) return true;
      if (shakeT[i] > 0) return true;
      if (doneT[i] >= 0 && doneT[i] < 1200) return true;
    }
    return false;
  }

  function update(ms: number): void {
    const k = Math.min(1, ms / 70);
    for (let i = 0; i < lift.length; i++) {
      const target = selected === i || (anim && anim.from === i) ? 1 : 0;
      if (anim && anim.from === i) continue;
      lift[i] += (target - lift[i]) * k;
      if (Math.abs(lift[i] - target) < 0.002) lift[i] = target;
      if (shakeT[i] > 0) shakeT[i] = Math.max(0, shakeT[i] - ms);
      if (doneT[i] >= 0) doneT[i] += ms;
    }
    if (hintVisible()) hintT += ms;
    if (winT >= 0 && winT < WIN_SHIMMER_MS) {
      winT = Math.min(WIN_SHIMMER_MS, winT + ms);
      if (winT >= WIN_SHIMMER_MS) dirty = true; // one last frame without the band
    }
    if (anim) {
      anim.t += ms;
      if (anim.t >= anim.travel + anim.pour + anim.ret) finishAnim();
    }
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function draw(): void {
    if (!cv) return;
    const g = cv.ctx;
    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);
    const { rects, tubeW } = layout;
    if (rects.length !== state.length) return;
    const a = anim;
    const pourP = a ? clamp((a.t - a.travel) / a.pour, 0, 1) : 0;
    const q = easeInOut(pourP);

    for (let i = 0; i < rects.length; i++) {
      if (a && a.from === i) continue;
      const r = rects[i];
      let x = r.x;
      const y = r.y - lift[i] * LIFT_PX;
      if (shakeT[i] > 0) {
        const p = shakeT[i] / SHAKE_MS;
        x += Math.sin((1 - p) * Math.PI * 6) * 5 * p;
      }
      let units = state[i];
      let levelF = units.length;
      if (a && a.to === i) {
        units = a.toBefore.concat(new Array<number>(a.count).fill(a.colour));
        levelF = a.toBefore.length + a.count * q;
      }
      const complete = isComplete(state[i]) && !(a && a.to === i && pourP < 1);
      drawTube(g, x, y, r.w, r.h, units, levelF, {
        selected: selected === i,
        complete,
        donePulse: complete && doneT[i] >= 0 ? clamp(1 - doneT[i] / 1200, 0, 1) : 0,
        win: winT >= 0 && winT < WIN_SHIMMER_MS && state[i].length > 0 ? winT : -1,
      });
      if (hintMove && hintVisible() && hintMove.to === i) drawHintRing(g, x, y, r.w, r.h);
    }

    if (a) {
      const r = rects[a.from];
      let cx: number;
      let cy: number;
      let ang: number;
      const liftedY = a.ry - LIFT_PX;
      if (a.t < a.travel) {
        const p = easeOutCubic(a.t / a.travel);
        cx = a.rx + (a.hx - a.rx) * p;
        cy = liftedY + (a.hy - liftedY) * p;
        ang = a.angle * p;
      } else if (a.t < a.travel + a.pour) {
        cx = a.hx;
        cy = a.hy;
        ang = a.angle;
      } else {
        const p = easeOutCubic(clamp((a.t - a.travel - a.pour) / a.ret, 0, 1));
        cx = a.hx + (a.rx - a.hx) * p;
        cy = a.hy + (a.ry - a.hy) * p;
        ang = a.angle * (1 - p);
      }
      // Stream while pouring.
      if (a.t >= a.travel && a.t < a.travel + a.pour && pourP < 0.98) {
        const dst = rects[a.to];
        const mouthX = cx + Math.sin(a.angle) * (r.h / 2);
        const mouthY = cy - Math.cos(a.angle) * (r.h / 2);
        const uh = (dst.h - dst.h * 0.1) / CAP;
        const surfaceY = dst.y + dst.h - (a.toBefore.length + a.count * q) * uh;
        g.save();
        g.strokeStyle = PALETTE[a.colour];
        g.globalAlpha = 0.95;
        g.lineCap = 'round';
        g.lineWidth = Math.max(4, tubeW * 0.22);
        g.beginPath();
        g.moveTo(mouthX - a.side * tubeW * 0.12, mouthY + 2);
        g.lineTo(dst.x + dst.w / 2, surfaceY + 2);
        g.stroke();
        g.restore();
      }
      g.save();
      g.translate(cx, cy);
      g.rotate(ang);
      g.shadowColor = colours.shadow;
      g.shadowBlur = 14;
      g.shadowOffsetY = 6;
      drawTube(g, -r.w / 2, -r.h / 2, r.w, r.h, a.fromBefore, a.fromBefore.length - a.count * q, {
        selected: true,
        complete: false,
        donePulse: 0,
        win: -1,
      });
      g.restore();
    }
  }

  function tubePath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const r = w / 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + h - r);
    g.arc(x + r, y + h - r, r, Math.PI, 0, true);
    g.lineTo(x + w, y);
  }

  function drawTube(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    units: number[],
    levelF: number,
    opts: { selected: boolean; complete: boolean; donePulse: number; win: number },
  ): void {
    // Glass body.
    tubePath(g, x, y, w, h);
    g.closePath();
    g.fillStyle = colours.glassFill;
    g.fill();
    // Liquid.
    g.save();
    tubePath(g, x, y, w, h);
    g.closePath();
    g.clip();
    const uh = (h - h * 0.1) / CAP;
    const n = Math.min(units.length, Math.ceil(levelF - 1e-6));
    for (let i = 0; i < n; i++) {
      const frac = clamp(levelF - i, 0, 1);
      if (frac <= 0) break;
      const hh = frac * uh;
      const yTop = y + h - i * uh - hh;
      g.fillStyle = PALETTE[units[i]];
      g.fillRect(x - 1, yTop, w + 2, hh + 0.6);
      // Soft top edge of each block boundary.
      if (i === n - 1 || units[i + 1] !== units[i]) {
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.fillRect(x - 1, yTop, w + 2, Math.min(2, hh));
      }
    }
    // Sheen.
    g.fillStyle = colours.sheen;
    g.fillRect(x + w * 0.14, y, w * 0.13, h);
    g.restore();
    // Outline.
    if (opts.complete) {
      g.save();
      g.shadowColor = colours.success;
      g.shadowBlur = 10 + opts.donePulse * 14;
      tubePath(g, x, y, w, h);
      g.strokeStyle = colours.success;
      g.lineWidth = 2;
      g.stroke();
      g.restore();
      // Cap.
      g.fillStyle = colours.success;
      roundRect(g, x - 3, y - 6, w + 6, 8, 3);
      g.fill();
    } else {
      tubePath(g, x, y, w, h);
      g.strokeStyle = opts.selected ? colours.accent : colours.glass;
      g.lineWidth = opts.selected ? 2.5 : 1.5;
      g.stroke();
      g.fillStyle = opts.selected ? colours.accent : colours.lip;
      roundRect(g, x - 2.5, y - 3, w + 5, 5, 2.5);
      g.fill();
    }
    if (opts.win >= 0) {
      // Gentle shimmer sweep on the finished board.
      const p = (opts.win / WIN_SWEEP_MS) % 1;
      g.save();
      tubePath(g, x, y, w, h);
      g.closePath();
      g.clip();
      g.globalAlpha = 0.25;
      g.fillStyle = '#ffffff';
      g.fillRect(x, y + h * p - 6, w, 12);
      g.restore();
    }
  }

  function drawHintRing(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(hintT / 160);
    g.save();
    g.setLineDash([6, 5]);
    g.lineDashOffset = -hintT / 40;
    g.strokeStyle = colours.warning;
    g.globalAlpha = 0.55 + 0.45 * pulse;
    g.lineWidth = 3;
    roundRect(g, x - 7, y - 12, w + 14, h + 20, w / 2 + 6);
    g.stroke();
    g.restore();
    // Arrow marker above the target.
    g.save();
    g.fillStyle = colours.warning;
    g.font = `700 ${Math.round(w * 0.36)}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText('▼', x + w / 2, y - 9 - pulse * 3);
    g.restore();
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
