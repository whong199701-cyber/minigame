import type { GameContext, GameInstance, GameModule, ModalHandle, ThemeName } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import { createCanvas, onPointer, roundRect, clamp, type CanvasHandle } from '../../app/canvas';
import {
  DX,
  DY,
  MODES,
  MODE_IDS,
  SAVE_VERSION,
  autoZoom,
  clampOffset,
  computePower,
  degree,
  generatePuzzle,
  hintTile,
  isModeId,
  isSolved,
  makeThrottle,
  minRotations,
  nextMode,
  parVerdict,
  parseSave,
  period,
  rebuildPuzzle,
  rotCW,
  rotateTimes,
  storedZoom,
  toggleLockAt,
  undoTarget,
  zoomOffset,
  type ModeId,
  type Puzzle,
  type SaveData,
} from './logic';
import './style.css';

const HINT_PENALTY_S = 20;
const LONG_PRESS_MS = 430;
/** The long-press ring only appears after this delay so quick taps do not flash it. */
const RING_DELAY_MS = 110;
const TAP_SLOP_PX = 12;
const WIN_MODAL_DELAY_MS = 1250;
/** Exponential approach rate (1/s) of the rotation tween. */
const SPIN_RATE = 17;
const QUARTER = Math.PI / 2;
/** Empty space allowed around the board (CSS px). */
const MARGIN = 8;
/** Zoom stops once a tile is this big (CSS px). */
const ZOOM_TARGET_CELL = 62;
const TOAST_GAP_MS = 2500;
/** Largest tile on big screens (CSS px). */
const MAX_CELL = 104;

const strings = {
  zh: {
    rules:
      '点按电路，顺时针旋转 90°。\n与中央 ⚡ 电源连通的导线会亮起。\n获胜：全部通电，且没有接口指向空处。\n长按锁定或解锁；↶ 撤销一次旋转（次数照算）。\n标准＝最少旋转次数。纪录：最快用时、最少超标。\n💡 转正并锁定一块：计时 +20 秒，不计超标纪录。\n专家模式边缘环绕；大棋盘可双指缩放。',
    tagline: '转动电路，把电送到每一台终端',
    tip: '点按旋转 · 长按锁定',
    tipZoom: '点按旋转 · 长按锁定 · 双指缩放',
    easyDesc: '5×5 · 25 块电路',
    mediumDesc: '7×7 · 49 块电路',
    hardDesc: '9×9 · 81 块电路',
    expertDesc: '11×11 · 121 块电路 · 边缘环绕',
    wrap: '环绕',
    turns: '旋转',
    par: '标准',
    powered: '通电',
    bestTime: '最快 {t}',
    bestOver: '最少超标 {n} 次',
    bestOnPar: '已达标准',
    solvedCount: '已完成 {n} 题',
    noBest: '暂无纪录',
    continueGame: '继续上一局',
    reset: '重置',
    newPuzzle: '新谜题',
    confirmReset: '把电路恢复到初始朝向？计时和旋转次数会继续累计，提示过的电路保持不变。',
    confirmNew: '放弃当前谜题，换一道新的？',
    lockedTap: '这块电路已锁定，长按解锁',
    hintedTap: '这块电路已由提示转正，保持锁定',
    hintApplied: '已转正并锁定一块电路，计时 +{n} 秒',
    hintNone: '所有电路的朝向都已正确！',
    undoNone: '没有可以撤销的旋转',
    fit: '适应屏幕',
    boardLabel: '电路网格',
    resultTime: '用时 {t}',
    resultTurns: '旋转 {n} 次 · 标准 {par} 次',
    perfectPar: '完美！正好达到标准',
    overPar: '比标准多 {n} 次',
    hintsUsed: '使用提示 {n} 次（计时 +{s} 秒）',
    hintsUsedOne: '使用提示 1 次（计时 +{s} 秒）',
    newBestTime: '新纪录！最快用时',
    newBestTurns: '新纪录！最少超标',
    tryNext: '挑战{mode}（{size}×{size}）→',
  },
  en: {
    rules:
      'Tap a tile to turn it 90° clockwise.\nWires joined to the ⚡ source in the centre light up.\nWin: every tile lit, no connector pointing at nothing.\nLong-press: lock / unlock. ↶ undo (still counts).\nPar = fewest turns. Records: time, turns over par.\n💡 fixes and locks a tile: +20 s, no turns record.\nExpert edges wrap; pinch to zoom big boards.',
    tagline: 'Rotate the tiles until power reaches every terminal',
    tip: 'Tap to rotate · long-press to lock',
    tipZoom: 'Tap to rotate · long-press to lock · pinch to zoom',
    easyDesc: '5×5 · 25 tiles',
    mediumDesc: '7×7 · 49 tiles',
    hardDesc: '9×9 · 81 tiles',
    expertDesc: '11×11 · 121 tiles · wrap-around edges',
    wrap: 'Wrap',
    turns: 'Turns',
    par: 'Par',
    powered: 'Powered',
    bestTime: 'Best {t}',
    bestOver: 'fewest {n} over par',
    bestOnPar: 'par reached',
    solvedCount: '{n} solved',
    noBest: 'No record yet',
    continueGame: 'Continue',
    reset: 'Reset',
    newPuzzle: 'New puzzle',
    confirmReset: 'Turn every tile back to its starting position? Time and turns keep counting; hinted tiles stay fixed.',
    confirmNew: 'Abandon this puzzle and start a new one?',
    lockedTap: 'This tile is locked: long-press to unlock',
    hintedTap: 'A hint fixed this tile, so it stays locked',
    hintApplied: 'One tile fixed and locked, +{n} s on the clock',
    hintNone: 'Every tile is already facing the right way!',
    undoNone: 'No turn to undo',
    fit: 'Fit board',
    boardLabel: 'Circuit grid',
    resultTime: 'Time {t}',
    resultTurns: '{n} turns · par {par}',
    perfectPar: 'Perfect: exactly par!',
    overPar: '{n} over par',
    hintsUsed: '{n} hints used (+{s} s)',
    hintsUsedOne: '1 hint used (+{s} s)',
    newBestTime: 'New best time!',
    newBestTurns: 'New best: fewest turns over par!',
    tryNext: 'Try {mode} ({size}×{size}) →',
  },
};

interface Colours {
  board: string;
  border: string;
  cell: string;
  cellOn: string;
  cellLocked: string;
  cellPressed: string;
  cellDone: string;
  lockedEdge: string;
  lock: string;
  wireOff: string;
  wireOffCore: string;
  wireOn: string;
  glow: string;
  wireHighlight: string;
  done: string;
  doneGlow: string;
  accent: string;
  accent2: string;
  success: string;
  text: string;
  termBody: string;
  screenOn: string;
  screenOff: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Weighted blend: `w` of `c1` with `1 - w` of `c2`, returned as a hex colour. */
function mix(c1: string, c2: string, w: number): string {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  const ch = (i: number) => Math.round(a[i] * w + b[i] * (1 - w));
  return '#' + [ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

type Phase = 'start' | 'playing' | 'won';
type Gesture = 'none' | 'press' | 'pan' | 'pinch';

interface Result {
  secs: number;
  rotations: number;
  par: number;
  hints: number;
  bestTime: boolean;
  bestOver: boolean;
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const storedMode = ctx.storage.get<unknown>('mode', 'easy');
  let mode: ModeId = isModeId(storedMode) ? storedMode : 'easy';
  let theme: ThemeName = ctx.theme;
  let col = readColours();
  let destroyed = false;

  // ── Game state ────────────────────────────────────────────────────────
  let phase: Phase = 'start';
  let puzzle: Puzzle | null = null;
  let size = 5;
  let wrap = false;
  let n = 25;
  let source = 12;
  let tiles: Uint8Array = new Uint8Array(0);
  let locked: Uint8Array = new Uint8Array(0);
  let hinted: Uint8Array = new Uint8Array(0);
  let powered: Uint8Array = new Uint8Array(0);
  let poweredCount = 0;
  let rotations = 0;
  let hints = 0;
  let undoStack: number[] = [];
  let result: Result | null = null;

  // Clock: accumulated play time plus the currently running segment.
  let elapsedMs = 0;
  let segStart = 0;
  let clockRunning = false;
  let hidden = false;

  // ── Animation state ───────────────────────────────────────────────────
  let spin = new Float32Array(0); // remaining visual rotation (radians); negative = still turning clockwise
  let flash = new Float32Array(0); // flash when a tile gets powered
  let shake = new Float32Array(0); // wiggle when tapping a locked tile
  let pop = new Float32Array(0); // lock badge pop-in
  let winT = -1;
  let winDist: Int16Array | null = null;
  let winSpeed = 1;
  let winMaxDist = 1;

  // ── View (zoom / pan) ─────────────────────────────────────────────────
  let viewW = 0;
  let viewH = 0;
  let baseCell = 0;
  let cell = 0;
  let zoom = 1;
  let zoomMax = 1;
  let offX = 0;
  let offY = 0;
  let fitting = false;
  /** The wheel changed the zoom since it was last remembered. */
  let zoomDirty = false;
  /** No zoom chosen for this size yet: follow `autoZoom` (finger-sized tiles) on every layout. */
  let zoomAuto = false;

  // ── Input ─────────────────────────────────────────────────────────────
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: Gesture = 'none';
  const press = { id: -1, tile: -1, x: 0, y: 0, at: 0, fired: false };
  const pan = { id: -1, x: 0, y: 0 };
  const pinch = { d0: 1, z0: 1, ux: 0, uy: 0 };
  let lastPointerType = '';
  let cursor = -1; // keyboard cursor, hidden until a key is used
  /** Repeated notices (locked tile, nothing to undo...) are rate limited; the first one always shows. */
  const toastGate = makeThrottle(TOAST_GAP_MS);

  // ── DOM / timers ──────────────────────────────────────────────────────
  let cv: CanvasHandle | null = null;
  let offPointer: (() => void) | null = null;
  let offCanvasExtras: (() => void) | null = null;
  let hudTurns: HTMLElement | null = null;
  let hudPowered: HTMLElement | null = null;
  let hudTime: HTMLElement | null = null;
  let progress: HTMLElement | null = null;
  let fitBtn: HTMLButtonElement | null = null;
  let tipEl: HTMLElement | null = null;
  let headerRemovers: (() => void)[] = [];
  let modal: ModalHandle | null = null;
  let raf = 0;
  let lastFrame = 0;
  let clockTimer = 0;
  let pressTimer = 0;
  let winTimer = 0;

  function readColours(): Colours {
    const v = (name: string, fallback: string): string => {
      const c = ctx.cssVar(name);
      return /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
    };
    const dark = theme === 'dark';
    const bg = v('--bg', dark ? '#0f1218' : '#f4f6fb');
    const surface = v('--surface', dark ? '#1a1f2b' : '#ffffff');
    const surface2 = v('--surface-2', dark ? '#232a39' : '#eef1f7');
    const border = v('--border', dark ? '#2d3548' : '#dde2ec');
    const text = v('--text', dark ? '#e8ecf3' : '#171a21');
    const muted = v('--muted', dark ? '#8b94a7' : '#5c6475');
    const accent = v('--accent', dark ? '#5b8cff' : '#3366ff');
    const accent2 = v('--accent-2', dark ? '#ff7a59' : '#ff6a3d');
    const success = v('--success', dark ? '#3ddc97' : '#1fa86b');
    const cell = surface2;
    return {
      board: surface,
      border,
      cell,
      cellOn: mix(accent, cell, dark ? 0.17 : 0.11),
      cellLocked: dark ? mix(bg, cell, 0.7) : mix(muted, cell, 0.2),
      cellPressed: mix(text, cell, dark ? 0.12 : 0.1),
      cellDone: mix(success, cell, dark ? 0.16 : 0.12),
      lockedEdge: rgba(muted, dark ? 0.55 : 0.5),
      lock: mix(text, muted, 0.35),
      wireOff: mix(muted, cell, dark ? 0.6 : 0.48),
      wireOffCore: mix(muted, cell, dark ? 0.36 : 0.26),
      wireOn: accent,
      glow: rgba(accent, dark ? 0.9 : 0.55),
      wireHighlight: rgba('#ffffff', dark ? 0.5 : 0.55),
      done: success,
      doneGlow: rgba(success, dark ? 0.9 : 0.55),
      accent,
      accent2,
      success,
      text,
      termBody: mix(text, cell, dark ? 0.7 : 0.78),
      screenOn: mix('#ffffff', accent, dark ? 0.3 : 0.18),
      screenOff: mix('#000000', cell, dark ? 0.45 : 0.62),
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────
  ctx.onThemeChange((th) => {
    theme = th;
    col = readColours();
    requestFrame();
  });
  ctx.onVisibility((visible) => {
    if (visible === !hidden) return;
    hidden = !visible;
    if (hidden) {
      pauseClock();
      stopClockTimer();
      cancelGesture();
      cancelAnimationFrame(raf);
      raf = 0;
      saveGame();
    } else {
      if (phase === 'playing') {
        resumeClock();
        startClockTimer();
      }
      requestFrame();
    }
  });
  const onKey = (e: KeyboardEvent) => handleKey(e);
  document.addEventListener('keydown', onKey);
  ctx.onDestroy(() => document.removeEventListener('keydown', onKey));

  function teardownGame(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    stopClockTimer();
    clearTimeout(pressTimer);
    clearTimeout(winTimer);
    modal?.close();
    modal = null;
    offPointer?.();
    offPointer = null;
    offCanvasExtras?.();
    offCanvasExtras = null;
    cv?.destroy();
    cv = null;
    headerRemovers.forEach((off) => off());
    headerRemovers = [];
    hudTurns = hudPowered = hudTime = progress = tipEl = null;
    fitBtn = null;
    pointers.clear();
    gesture = 'none';
    clockRunning = false;
    phase = 'start';
  }

  // ── Clock ─────────────────────────────────────────────────────────────
  function pauseClock(): void {
    if (!clockRunning) return;
    elapsedMs += performance.now() - segStart;
    clockRunning = false;
  }

  function resumeClock(): void {
    if (clockRunning || phase !== 'playing' || hidden) return;
    segStart = performance.now();
    clockRunning = true;
  }

  function playMs(): number {
    return elapsedMs + (clockRunning ? performance.now() - segStart : 0);
  }

  function elapsedSeconds(): number {
    return playMs() / 1000 + hints * HINT_PENALTY_S;
  }

  function startClockTimer(): void {
    stopClockTimer();
    clockTimer = window.setInterval(updateClock, 250);
  }

  function stopClockTimer(): void {
    clearInterval(clockTimer);
    clockTimer = 0;
  }

  function updateClock(): void {
    if (!hudTime) return;
    const s = phase === 'won' && result ? result.secs : Math.floor(elapsedSeconds());
    const txt = formatTime(s);
    if (hudTime.textContent !== txt) hudTime.textContent = txt;
  }

  // ── Persistence ───────────────────────────────────────────────────────
  function readSave(): SaveData | null {
    const s = parseSave(ctx.storage.get<unknown>('save', null));
    if (!s) ctx.storage.remove('save');
    return s;
  }

  function saveGame(): void {
    if (phase !== 'playing' || !puzzle) return;
    const data: SaveData = {
      v: SAVE_VERSION,
      mode,
      solution: Array.from(puzzle.solution),
      start: Array.from(puzzle.tiles),
      tiles: Array.from(tiles),
      locked: Array.from(locked),
      hinted: Array.from(hinted),
      rotations,
      hints,
      elapsedMs: Math.round(playMs()),
    };
    ctx.storage.set('save', data);
    if (zoomDirty) rememberZoom(); // wheel zoom (desktop) is stored lazily
  }

  function clearSave(): void {
    ctx.storage.remove('save');
  }

  /** Puzzles solved per mode (defensive against corrupted storage). */
  function solvedCounts(): Record<string, number> {
    const raw = ctx.storage.get<unknown>('solved', {});
    const out: Record<string, number> = {};
    if (raw && typeof raw === 'object') {
      for (const m of MODE_IDS) {
        const v = (raw as Record<string, unknown>)[m];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[m] = Math.floor(v);
      }
    }
    return out;
  }

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    if (phase === 'playing') saveGame();
    teardownGame();
    root.innerHTML = '';
    ctx.setStatus('');
    const save = readSave();
    const desc = el('p', { class: 'muted nw-desc' });
    const best = el('p', { class: 'muted small nw-best' });
    const refresh = (): void => {
      desc.textContent = t(mode + 'Desc');
      const bt = ctx.storage.getBest(mode);
      const bo = ctx.storage.getBest(mode + ':over');
      const solved = solvedCounts()[mode] ?? 0;
      if (bt === null) {
        best.textContent = t('noBest');
      } else {
        const over = bo === null ? '' : ' · ' + (bo <= 0 ? t('bestOnPar') : t('bestOver', { n: bo }));
        best.textContent = `🏆 ${t('bestTime', { t: formatTime(bt) })}${over} · ${t('solvedCount', { n: solved })}`;
      }
    };
    refresh();
    const actions = el('div', { class: 'nw-start-actions' });
    if (save) {
      const cfg = MODES[save.mode];
      const secs = save.elapsedMs / 1000 + save.hints * HINT_PENALTY_S;
      const info = `${t(save.mode)} · ${cfg.size}×${cfg.size} · ${formatTime(secs)}`;
      const cont = button(t('continueGame'), () => resumeGame(save), { variant: 'primary', size: 'lg', icon: '▶' });
      cont.append(el('span', { class: 'nw-cont-info', text: info }));
      const play = (): void => {
        if (save.rotations === 0 && save.hints === 0) return startGame();
        modal = ctx.showModal({
          title: t('confirm'),
          body: t('confirmNew'),
          buttons: [{ label: t('cancel') }, { label: t('confirm'), primary: true, onClick: startGame }],
        });
      };
      actions.append(cont, button(t('play'), play, { variant: 'secondary', size: 'lg' }));
    } else {
      actions.append(button(t('play'), startGame, { variant: 'primary', size: 'lg' }));
    }
    root.append(
      el(
        'div',
        { class: 'start-screen nw-start' },
        el('div', { class: 'big-icon', text: '🔌' }),
        el('h2', { text: t('chooseDifficulty') }),
        el('p', { class: 'muted nw-tagline', text: t('tagline') }),
        segmented<ModeId>(
          MODE_IDS.map((m) => ({ value: m, label: t(m) })),
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            refresh();
          },
        ),
        desc,
        best,
        actions,
        el('p', { class: 'muted small nw-start-tip', text: t('tip') }),
      ),
    );
  }

  // ── Game screen ───────────────────────────────────────────────────────
  function buildGameScreen(): void {
    root.innerHTML = '';
    const stat = (label: string, value: HTMLElement): HTMLElement =>
      el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), value);
    hudTurns = el('span', { class: 'stat-value' });
    hudPowered = el('span', { class: 'stat-value' });
    hudTime = el('span', { class: 'stat-value' });
    progress = el('div', { class: 'nw-progress-fill' });
    const hud = el(
      'div',
      { class: 'game-hud nw-hud' },
      stat(`${t('turns')} / ${t('par')}`, hudTurns),
      stat(t('powered'), hudPowered),
      stat(t('time'), hudTime),
    );
    const bar = el('div', { class: 'nw-progress' }, progress);
    const area = el('div', { class: 'game-area nw-area' });
    fitBtn = el('button', { class: 'nw-fit', type: 'button', 'aria-label': t('fit'), title: t('fit'), text: '⤢' });
    fitBtn.addEventListener('click', () => {
      ctx.play('swoosh');
      zoomAuto = false;
      fitting = true;
      requestFrame();
    });
    area.append(fitBtn);
    tipEl = el('p', { class: 'nw-tip muted' });
    const footer = el(
      'div',
      { class: 'nw-footer' },
      tipEl,
      el(
        'div',
        { class: 'nw-buttons' },
        button(t('reset'), () => confirmThen(t('confirmReset'), resetPuzzle), { icon: '↺' }),
        button(t('newPuzzle'), () => confirmThen(t('confirmNew'), newPuzzle), { icon: '🎲' }),
      ),
    );
    root.append(el('div', { class: 'nw-game' }, hud, bar, area, footer));
    cv = createCanvas(area, layout);
    cv.canvas.classList.add('nw-canvas');
    cv.canvas.setAttribute('role', 'img');
    cv.canvas.setAttribute('aria-label', t('boardLabel'));
    area.append(fitBtn); // keep the button above the canvas
    offPointer = onPointer(cv.canvas, { down: pointerDown, move: pointerMove, up: pointerUp, cancel: pointerCancel });
    const canvas = cv.canvas;
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      // Right-click locks on desktop; touch long-press is handled by our own timer.
      if (lastPointerType !== 'mouse' || phase !== 'playing') return;
      const r = canvas.getBoundingClientRect();
      const i = tileAt(e.clientX - r.left, e.clientY - r.top);
      if (i >= 0) toggleLock(i);
    };
    const onWheel = (e: WheelEvent) => {
      if (zoomMax <= 1 || phase !== 'playing') return;
      e.preventDefault();
      fitting = false;
      zoomAuto = false;
      zoomDirty = true;
      const r = canvas.getBoundingClientRect();
      setZoom(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    offCanvasExtras = () => {
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('wheel', onWheel);
    };
    headerRemovers.push(
      ctx.addHeaderAction({ icon: '↶', label: t('undo'), onClick: undo }),
      ctx.addHeaderAction({ icon: '💡', label: t('hint'), onClick: useHint }),
      // Saves the game and opens the difficulty screen (Continue / another size); the footer has Reset and New puzzle.
      ctx.addHeaderAction({ icon: '☰', label: t('chooseDifficulty'), onClick: showStart }),
    );
  }

  function confirmThen(message: string, fn: () => void): void {
    if (phase === 'playing' && (rotations > 0 || locked.some((v) => v === 1))) {
      modal = ctx.showModal({
        title: t('confirm'),
        body: message,
        buttons: [{ label: t('cancel') }, { label: t('confirm'), primary: true, onClick: fn }],
      });
    } else {
      fn();
    }
  }

  // ── Layout / view ─────────────────────────────────────────────────────
  function layout(w: number, h: number): void {
    // The board point in the middle of the view stays there across resizes (e.g. turning the phone while zoomed).
    const midX = cell > 0 ? (viewW / 2 - offX) / cell : 0;
    const midY = cell > 0 ? (viewH / 2 - offY) / cell : 0;
    viewW = w;
    viewH = h;
    if (!puzzle) return;
    baseCell = clamp((Math.min(w, h) - MARGIN * 2) / size, 8, MAX_CELL);
    const zm = ZOOM_TARGET_CELL / baseCell;
    zoomMax = zm >= 1.3 ? Math.min(2.6, zm) : 1;
    if (zoomAuto) zoom = autoZoom(baseCell, zoomMax);
    zoom = clamp(zoom, 1, zoomMax);
    cell = baseCell * zoom;
    if (Number.isFinite(midX) && Number.isFinite(midY)) {
      offX = w / 2 - midX * cell;
      offY = h / 2 - midY * cell;
    }
    clampView();
    if (tipEl) tipEl.textContent = t(zoomMax > 1 ? 'tipZoom' : 'tip');
    requestFrame();
  }

  function clampView(): void {
    const bp = cell * size;
    offX = clampOffset(offX, bp, viewW, MARGIN);
    offY = clampOffset(offY, bp, viewH, MARGIN);
    fitBtn?.classList.toggle('show', zoom > 1.01);
  }

  function setZoom(z: number, fx: number, fy: number): void {
    const nz = clamp(z, 1, zoomMax);
    const nextCell = baseCell * nz;
    offX = zoomOffset(offX, fx, cell, nextCell);
    offY = zoomOffset(offY, fy, cell, nextCell);
    zoom = nz;
    cell = nextCell;
    clampView();
    requestFrame();
  }

  function centreView(): void {
    offX = (viewW - cell * size) / 2;
    offY = (viewH - cell * size) / 2;
    clampView();
  }

  /** Remember the zoom per size, so a player who prefers bigger tiles gets them on the next puzzle too. */
  function rememberZoom(): void {
    if (!puzzle) return;
    zoomDirty = false;
    const raw = ctx.storage.get<unknown>('zoom', {});
    const prefs: Record<string, number> = {};
    for (const m of MODE_IDS) {
      const z = storedZoom(raw, m);
      if (z !== null) prefs[m] = z;
    }
    // 1 is stored too: "whole board" is a choice that overrides the automatic zoom-in for small tiles.
    prefs[mode] = zoom > 1.01 ? Math.round(zoom * 100) / 100 : 1;
    ctx.storage.set('zoom', prefs);
  }

  function tileAt(px: number, py: number): number {
    if (cell <= 0) return -1;
    const x = Math.floor((px - offX) / cell);
    const y = Math.floor((py - offY) / cell);
    if (x < 0 || y < 0 || x >= size || y >= size) return -1;
    return y * size + x;
  }

  // ── Pointer input ─────────────────────────────────────────────────────
  function pointerDown(p: { x: number; y: number; id: number; event: PointerEvent }): void {
    pointers.set(p.id, { x: p.x, y: p.y });
    lastPointerType = p.event.pointerType;
    if (phase !== 'playing') return;
    if (cursor >= 0) cursor = -1;
    if (pointers.size === 1) {
      gesture = 'press';
      press.id = p.id;
      press.tile = tileAt(p.x, p.y);
      press.x = p.x;
      press.y = p.y;
      press.at = performance.now();
      press.fired = false;
      clearTimeout(pressTimer);
      if (press.tile >= 0) {
        const tile = press.tile;
        pressTimer = window.setTimeout(() => {
          if (gesture === 'press' && press.tile === tile && !press.fired) {
            press.fired = true;
            toggleLock(tile);
          }
        }, LONG_PRESS_MS);
      }
      requestFrame();
    } else if (pointers.size === 2 && zoomMax > 1) {
      clearTimeout(pressTimer);
      startPinch();
    } else {
      clearTimeout(pressTimer);
      gesture = 'none';
      requestFrame();
    }
  }

  function startPinch(): void {
    const [a, b] = [...pointers.values()];
    gesture = 'pinch';
    zoomAuto = false;
    pinch.d0 = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    pinch.z0 = zoom;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    pinch.ux = (mx - offX) / cell;
    pinch.uy = (my - offY) / cell;
    requestFrame();
  }

  function pointerMove(p: { x: number; y: number; id: number }): void {
    const prev = pointers.get(p.id);
    if (!prev) return;
    pointers.set(p.id, { x: p.x, y: p.y });
    if (gesture === 'press' && p.id === press.id) {
      if (Math.hypot(p.x - press.x, p.y - press.y) > TAP_SLOP_PX) {
        clearTimeout(pressTimer);
        if (zoom > 1.001) {
          gesture = 'pan';
          pan.id = p.id;
          pan.x = p.x;
          pan.y = p.y;
        } else {
          gesture = 'none';
        }
        requestFrame();
      }
    } else if (gesture === 'pan' && p.id === pan.id) {
      offX += p.x - pan.x;
      offY += p.y - pan.y;
      pan.x = p.x;
      pan.y = p.y;
      fitting = false;
      clampView();
      requestFrame();
    } else if (gesture === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      zoom = clamp((pinch.z0 * d) / pinch.d0, 1, zoomMax);
      cell = baseCell * zoom;
      offX = (a.x + b.x) / 2 - pinch.ux * cell;
      offY = (a.y + b.y) / 2 - pinch.uy * cell;
      fitting = false;
      clampView();
      requestFrame();
    }
  }

  function pointerUp(p: { x: number; y: number; id: number }): void {
    if (!pointers.delete(p.id)) return;
    if (gesture === 'press' && p.id === press.id) {
      clearTimeout(pressTimer);
      const tile = press.tile;
      const tap = !press.fired && tile >= 0 && tileAt(p.x, p.y) === tile;
      gesture = 'none';
      press.tile = -1;
      if (tap && phase === 'playing') rotate(tile);
    } else if (gesture === 'pinch') {
      rememberZoom();
      const rest = [...pointers.entries()];
      if (rest.length === 1 && zoom > 1.001) {
        gesture = 'pan';
        pan.id = rest[0][0];
        pan.x = rest[0][1].x;
        pan.y = rest[0][1].y;
      } else if (rest.length === 0) {
        gesture = 'none';
      }
    } else if (gesture === 'pan' && p.id === pan.id) {
      gesture = 'none';
    }
    if (pointers.size === 0) gesture = 'none';
    requestFrame();
  }

  function pointerCancel(p: { id: number }): void {
    pointers.delete(p.id);
    if (pointers.size === 0 || (gesture === 'press' && p.id === press.id)) cancelGesture();
  }

  function cancelGesture(): void {
    clearTimeout(pressTimer);
    pointers.clear();
    gesture = 'none';
    press.tile = -1;
    requestFrame();
  }

  // ── Keyboard (bonus: arrows move, Enter/Space rotate, L lock, U/Z undo, H hint) ──
  function handleKey(e: KeyboardEvent): void {
    if (phase !== 'playing' || !cv || hidden || e.altKey || e.metaKey) return;
    if (document.querySelector('.modal-backdrop')) return;
    const k = e.key;
    // Let a focused button keep its own Enter / Space activation.
    if ((k === 'Enter' || k === ' ') && e.target instanceof HTMLElement && e.target.closest('button, input, textarea, select')) return;
    let handled = true;
    const move = (dx: number, dy: number): void => {
      if (cursor < 0) cursor = source;
      else {
        const x = (cursor % size) + dx;
        const y = Math.floor(cursor / size) + dy;
        cursor = ((y + size) % size) * size + ((x + size) % size);
      }
      revealTile(cursor);
      ctx.play('tap');
    };
    if (k === 'ArrowUp') move(0, -1);
    else if (k === 'ArrowDown') move(0, 1);
    else if (k === 'ArrowLeft') move(-1, 0);
    else if (k === 'ArrowRight') move(1, 0);
    else if ((k === 'Enter' || k === ' ') && !e.ctrlKey) {
      if (cursor < 0) move(0, 0);
      else rotate(cursor);
    } else if ((k === 'l' || k === 'L') && !e.ctrlKey) {
      if (cursor >= 0) toggleLock(cursor);
    } else if (k === 'u' || k === 'U' || ((k === 'z' || k === 'Z') && e.ctrlKey)) undo();
    else if ((k === 'h' || k === 'H') && !e.ctrlKey) useHint();
    else handled = false;
    if (handled) {
      e.preventDefault();
      requestFrame();
    }
  }

  /** Pan so that tile `i` is fully visible (when zoomed in). */
  function revealTile(i: number): void {
    if (zoom <= 1.001) return;
    const x = i % size;
    const y = (i - x) / size;
    const left = offX + x * cell;
    const top = offY + y * cell;
    if (left < MARGIN) offX += MARGIN - left;
    else if (left + cell > viewW - MARGIN) offX -= left + cell - (viewW - MARGIN);
    if (top < MARGIN) offY += MARGIN - top;
    else if (top + cell > viewH - MARGIN) offY -= top + cell - (viewH - MARGIN);
    clampView();
  }

  // ── Puzzle lifecycle ──────────────────────────────────────────────────
  function startGame(): void {
    newPuzzle();
  }

  function newPuzzle(): void {
    loadPuzzle(generatePuzzle(MODES[mode]), null);
    saveGame();
  }

  function resumeGame(save: SaveData): void {
    mode = save.mode;
    ctx.storage.set('mode', mode);
    loadPuzzle(rebuildPuzzle(MODES[mode], save.solution, save.start), save);
  }

  function resetPuzzle(): void {
    if (!puzzle || phase !== 'playing') return;
    for (let i = 0; i < n; i++) {
      const target = hinted[i] ? puzzle.solution[i] : puzzle.tiles[i];
      if (tiles[i] !== target) {
        // Animate the way back as a short counter-clockwise spin.
        const back = minRotations(target, tiles[i]);
        spin[i] += Math.max(0, back) * QUARTER;
        tiles[i] = target;
      }
      locked[i] = hinted[i];
    }
    undoStack = [];
    recomputePower();
    ctx.play('swoosh');
    ctx.haptic('medium');
    updateHud();
    saveGame();
    requestFrame();
  }

  function loadPuzzle(p: Puzzle, save: SaveData | null): void {
    teardownGame();
    buildGameScreen();
    puzzle = p;
    size = p.size;
    wrap = p.wrap;
    n = size * size;
    source = p.source;
    tiles = save ? Uint8Array.from(save.tiles) : p.tiles.slice();
    locked = save ? Uint8Array.from(save.locked) : new Uint8Array(n);
    hinted = save ? Uint8Array.from(save.hinted) : new Uint8Array(n);
    rotations = save ? save.rotations : 0;
    hints = save ? save.hints : 0;
    elapsedMs = save ? save.elapsedMs : 0;
    powered = new Uint8Array(n);
    spin = new Float32Array(n);
    flash = new Float32Array(n);
    shake = new Float32Array(n);
    pop = new Float32Array(n);
    undoStack = [];
    result = null;
    winT = -1;
    winDist = null;
    const zoomPref = storedZoom(ctx.storage.get<unknown>('zoom', null), mode);
    zoomAuto = zoomPref === null;
    zoom = zoomPref ?? 1;
    fitting = false;
    zoomDirty = false;
    cursor = -1;
    phase = 'playing';
    recomputePower();
    flash.fill(0); // no flash for the initial state
    clockRunning = false;
    resumeClock();
    startClockTimer();
    ctx.setStatus(`${t(mode)} · ${size}×${size}${wrap ? ' · ' + t('wrap') : ''}`);
    updateHud();
    if (cv) {
      layout(cv.width, cv.height);
      centreView();
    }
    if (isSolved(size, wrap, tiles, source)) win(); // only possible with a hand-edited save
  }

  function recomputePower(): void {
    const r = computePower(size, wrap, tiles, source);
    for (let i = 0; i < n; i++) if (r.powered[i] && !powered[i] && i !== source) flash[i] = 1;
    powered = r.powered;
    poweredCount = r.count;
  }

  function updateHud(): void {
    if (!hudTurns || !hudPowered || !puzzle) return;
    hudTurns.textContent = `${rotations} / ${puzzle.par}`;
    hudTurns.classList.toggle('nw-over', rotations > puzzle.par);
    hudPowered.textContent = `${poweredCount} / ${n}`;
    if (progress) {
      progress.style.width = `${(100 * poweredCount) / n}%`;
      progress.classList.toggle('full', poweredCount === n);
    }
    updateClock();
  }

  function note(message: string, force = false): void {
    if (toastGate(performance.now(), force)) ctx.toast(message);
  }

  /** Feedback for a tap / undo that hits a locked tile. */
  function rejectLocked(i: number): void {
    shake[i] = 1;
    ctx.play('error');
    ctx.haptic('error');
    note(t(hinted[i] ? 'hintedTap' : 'lockedTap'));
    requestFrame();
  }

  // ── Actions ───────────────────────────────────────────────────────────
  function rotate(i: number): void {
    if (phase !== 'playing') return;
    if (locked[i]) {
      rejectLocked(i);
      return;
    }
    spin[i] -= QUARTER;
    if (period(tiles[i]) === 1) {
      // A cross looks the same from every side: animate for feedback, but it is not a move.
      ctx.play('tap');
      requestFrame();
      return;
    }
    tiles[i] = rotCW(tiles[i]);
    rotations++;
    undoStack.push(i);
    if (undoStack.length > 500) undoStack.shift();
    afterChange(true);
  }

  function undo(): void {
    if (phase !== 'playing') return;
    if (undoStack.length === 0) {
      note(t('undoNone'));
      return;
    }
    // Turns on tiles that were locked afterwards are skipped (and stay in the history until unlocked).
    const k = undoTarget(undoStack, locked);
    if (k < 0) {
      rejectLocked(undoStack[undoStack.length - 1]);
      return;
    }
    const i = undoStack[k];
    undoStack.splice(k, 1);
    tiles[i] = rotateTimes(tiles[i], 3);
    spin[i] += QUARTER;
    ctx.play('swoosh');
    afterChange(false);
  }

  /** Shared bookkeeping after the board changed. */
  function afterChange(byTap: boolean): void {
    const before = poweredCount;
    recomputePower();
    if (byTap) {
      ctx.play(poweredCount > before ? 'success' : 'move');
      ctx.haptic('light');
    }
    updateHud();
    requestFrame();
    if (isSolved(size, wrap, tiles, source)) win();
    else saveGame();
  }

  function toggleLock(i: number): void {
    if (phase !== 'playing') return;
    if (!toggleLockAt(locked, hinted, i)) {
      // A hinted tile is already in its solved orientation and stays locked.
      rejectLocked(i);
      return;
    }
    if (locked[i]) pop[i] = 1;
    ctx.play(locked[i] ? 'place' : 'pop');
    ctx.haptic('medium');
    saveGame();
    requestFrame();
  }

  function useHint(): void {
    if (phase !== 'playing' || !puzzle) return;
    const i = hintTile(puzzle, tiles);
    if (i < 0) {
      note(t('hintNone'));
      return;
    }
    const r = minRotations(tiles[i], puzzle.solution[i]);
    tiles[i] = puzzle.solution[i];
    rotations += Math.max(1, r);
    hints++;
    spin[i] -= Math.max(1, r) * QUARTER;
    locked[i] = 1;
    hinted[i] = 1;
    pop[i] = 1;
    undoStack = undoStack.filter((j) => j !== i);
    revealTile(i);
    ctx.play('coin');
    ctx.haptic('medium');
    note(t('hintApplied', { n: HINT_PENALTY_S }), true);
    afterChange(false);
    flash[i] = 1;
  }

  function win(): void {
    if (!puzzle) return;
    pauseClock();
    phase = 'won';
    stopClockTimer();
    cancelGesture();
    cursor = -1;
    const secs = Math.floor(elapsedSeconds());
    const verdict = parVerdict(rotations, puzzle.par, hints);
    // Time record: hints count, through their 20 s penalty each.
    const bestTime = ctx.storage.recordBest(mode, secs, 'lower');
    // The brief's "fewest rotations" is kept as fewest turns *over par*: par differs from puzzle to puzzle, so a
    // raw turn count would mostly reward a lucky scramble. Hints apply the exact minimal turns for the player, so
    // only hint-free games may set it.
    const bestOver = verdict.turnsRecord && ctx.storage.recordBest(mode + ':over', verdict.over, 'lower');
    const solved = solvedCounts();
    solved[mode] = (solved[mode] ?? 0) + 1;
    ctx.storage.set('solved', solved);
    clearSave();
    result = { secs, rotations, par: puzzle.par, hints, bestTime, bestOver };
    const r = computePower(size, wrap, tiles, source);
    winDist = r.dist;
    winMaxDist = 1;
    for (let i = 0; i < n; i++) if (r.dist[i] > winMaxDist) winMaxDist = r.dist[i];
    winSpeed = (winMaxDist + 3) / 0.9;
    winT = 0;
    ctx.play('win');
    ctx.haptic('success');
    updateHud();
    requestFrame();
    clearTimeout(winTimer);
    winTimer = window.setTimeout(showWinModal, WIN_MODAL_DELAY_MS);
  }

  function showWinModal(): void {
    if (!result || destroyed) return;
    const res = result;
    const verdict = parVerdict(res.rotations, res.par, res.hints);
    const next = nextMode(mode);
    const body = el(
      'div',
      { class: 'nw-result' },
      el('div', { class: 'nw-result-time', text: formatTime(res.secs) }),
      el('p', { class: 'muted', text: t('resultTurns', { n: res.rotations, par: res.par }) }),
      verdict.perfect
        ? el('p', { class: 'nw-good', text: '✨ ' + t('perfectPar') })
        : verdict.over > 0
          ? el('p', { class: 'muted', text: t('overPar', { n: verdict.over }) })
          : null,
      res.hints > 0
        ? el('p', { class: 'muted small', text: t(res.hints === 1 ? 'hintsUsedOne' : 'hintsUsed', { n: res.hints, s: res.hints * HINT_PENALTY_S }) })
        : null,
      res.bestTime ? el('p', { class: 'nw-record', text: '🏆 ' + t('newBestTime') }) : null,
      res.bestOver ? el('p', { class: 'nw-record', text: '🏆 ' + t('newBestTurns') }) : null,
    );
    if (next) {
      const cfg = MODES[next];
      body.append(
        button(
          t('tryNext', { mode: t(next), size: cfg.size }),
          () => {
            modal?.close();
            mode = next;
            ctx.storage.set('mode', mode);
            newPuzzle();
          },
          { variant: 'ghost', class: 'nw-next' },
        ),
      );
    }
    modal = ctx.showModal({
      title: t('win'),
      body,
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        { label: t('newGame'), primary: true, onClick: newPuzzle },
      ],
    });
  }

  // ── Frame scheduling ──────────────────────────────────────────────────
  function requestFrame(): void {
    if (raf || hidden || !cv || destroyed) return;
    lastFrame = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function tick(now: number): void {
    const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
    lastFrame = now;
    const busy = step(dt, now);
    draw(now);
    raf = busy && !hidden && cv ? requestAnimationFrame(tick) : 0;
  }

  /** Advance animations; returns true while anything is still moving. */
  function step(dt: number, now: number): boolean {
    let busy = false;
    const k = 1 - Math.exp(-dt * SPIN_RATE);
    for (let i = 0; i < n; i++) {
      if (spin[i] !== 0) {
        spin[i] -= spin[i] * k;
        if (Math.abs(spin[i]) < 0.004) spin[i] = 0;
        busy = true;
      }
      if (flash[i] > 0) {
        flash[i] = Math.max(0, flash[i] - dt * 2.4);
        busy = true;
      }
      if (shake[i] > 0) {
        shake[i] = Math.max(0, shake[i] - dt * 3.2);
        busy = true;
      }
      if (pop[i] > 0) {
        pop[i] = Math.max(0, pop[i] - dt * 4);
        busy = true;
      }
    }
    if (winT >= 0) {
      winT += dt;
      busy = true;
      if (winT * winSpeed > winMaxDist + 4) winT = -1;
    }
    if (gesture === 'press' && press.tile >= 0 && !press.fired && now - press.at < LONG_PRESS_MS + 100) busy = true;
    if (fitting) {
      const z = zoom + (1 - zoom) * Math.min(1, dt * 14);
      setZoom(Math.abs(z - 1) < 0.004 ? 1 : z, viewW / 2, viewH / 2);
      if (zoom === 1) {
        fitting = false;
        rememberZoom();
      }
      busy = true;
    }
    return busy;
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function draw(now: number): void {
    if (!cv || !puzzle) return;
    const g = cv.ctx;
    const dpr = cv.dpr;
    g.clearRect(0, 0, cv.width, cv.height);
    const bp = cell * size;

    // Board
    g.fillStyle = col.board;
    roundRect(g, offX - 6, offY - 6, bp + 12, bp + 12, 14);
    g.fill();
    g.strokeStyle = col.border;
    g.lineWidth = 1;
    g.stroke();
    if (wrap) {
      g.save();
      g.setLineDash([6, 5]);
      g.strokeStyle = rgba(col.accent, 0.75);
      g.lineWidth = 2;
      roundRect(g, offX - 3, offY - 3, bp + 6, bp + 6, 10);
      g.stroke();
      g.restore();
    }

    // Visible tile range (everything when not zoomed)
    const x0 = Math.max(0, Math.floor(-offX / cell));
    const x1 = Math.min(size - 1, Math.floor((viewW - offX) / cell));
    const y0 = Math.max(0, Math.floor(-offY / cell));
    const y1 = Math.min(size - 1, Math.floor((viewH - offY) / cell));

    const half = cell / 2;
    const lw = Math.max(2.5, cell * 0.19);
    const gap = Math.max(1, cell * 0.045);
    const inner = cell - gap * 2;
    const radius = Math.max(2, cell * 0.14);
    const offPath = new Path2D();
    const onPath = new Path2D();
    const donePath = new Path2D();
    const pressing = gesture === 'press' && !press.fired ? press.tile : -1;

    const centreX = (i: number): number => {
      const x = i % size;
      let cx = offX + (x + 0.5) * cell;
      if (shake[i] > 0) cx += Math.sin(shake[i] * 28) * cell * 0.08 * shake[i];
      return cx;
    };
    const centreY = (i: number): number => offY + (Math.floor(i / size) + 0.5) * cell;
    const isDone = (i: number): boolean =>
      phase === 'won' && powered[i] === 1 && (winT < 0 || !winDist || winT * winSpeed >= winDist[i]);

    // Pass 1: cell backgrounds + collect wire geometry
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * size + x;
        const cx = centreX(i);
        const cy = centreY(i);
        const on = powered[i] === 1;
        const shrink = i === pressing ? cell * 0.035 : 0;
        const done = isDone(i);
        g.fillStyle = i === pressing ? col.cellPressed : locked[i] ? col.cellLocked : done ? col.cellDone : on ? col.cellOn : col.cell;
        roundRect(g, cx - inner / 2 + shrink, cy - inner / 2 + shrink, inner - shrink * 2, inner - shrink * 2, radius);
        g.fill();
        if (locked[i]) {
          g.strokeStyle = col.lockedEdge;
          g.lineWidth = 1.5;
          g.stroke();
        }
        const m = tiles[i];
        const path = !on ? offPath : done ? donePath : onPath;
        const a = spin[i];
        const cs = Math.cos(a);
        const sn = Math.sin(a);
        for (let d = 0; d < 4; d++) {
          if (!(m & (1 << d))) continue;
          const vx = DX[d] * cs - DY[d] * sn;
          const vy = DX[d] * sn + DY[d] * cs;
          path.moveTo(cx, cy);
          path.lineTo(cx + vx * half, cy + vy * half);
        }
      }
    }

    // Wires
    g.lineCap = 'butt';
    g.strokeStyle = col.wireOff;
    g.lineWidth = lw;
    g.stroke(offPath);
    g.strokeStyle = col.wireOffCore;
    g.lineWidth = Math.max(1, lw * 0.3);
    g.stroke(offPath);
    strokeLit(g, onPath, col.wireOn, col.glow, lw, dpr);
    strokeLit(g, donePath, col.done, col.doneGlow, lw, dpr);

    // Pass 2: centre pieces and overlays
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * size + x;
        const cx = centreX(i);
        const cy = centreY(i);
        const on = powered[i] === 1;
        const lit = isDone(i) ? col.done : col.wireOn;
        if (i === source) drawSource(g, cx, cy);
        else if (degree(tiles[i]) === 1) drawTerminal(g, cx, cy, on, lit);
        else drawNode(g, cx, cy, on, lit, lw);
        if (locked[i]) drawLock(g, cx - inner / 2 + cell * 0.07, cy - inner / 2 + cell * 0.06, Math.max(6, cell * 0.17), pop[i]);
        const left = cx - inner / 2;
        const top = cy - inner / 2;
        if (flash[i] > 0) {
          g.fillStyle = rgba(col.accent, flash[i] * 0.35);
          roundRect(g, left, top, inner, inner, radius);
          g.fill();
        }
        if (winT >= 0 && winDist) {
          const wave = winT * winSpeed - winDist[i];
          const w = Math.max(0, 1 - Math.abs(wave) / 2.2);
          if (w > 0) {
            g.fillStyle = rgba(col.success, w * 0.45);
            roundRect(g, left, top, inner, inner, radius);
            g.fill();
          }
        }
      }
    }

    // Long-press progress ring
    if (pressing >= 0) {
      const el2 = now - press.at;
      if (el2 > RING_DELAY_MS) {
        const pr = clamp((el2 - RING_DELAY_MS) / (LONG_PRESS_MS - RING_DELAY_MS), 0, 1);
        const cx = centreX(pressing);
        const cy = centreY(pressing);
        g.save();
        g.lineCap = 'round';
        g.lineWidth = Math.max(2.5, cell * 0.06);
        g.strokeStyle = rgba(col.text, 0.18);
        g.beginPath();
        g.arc(cx, cy, cell * 0.44, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = col.text;
        g.beginPath();
        g.arc(cx, cy, cell * 0.44, -Math.PI / 2, -Math.PI / 2 + pr * Math.PI * 2);
        g.stroke();
        g.restore();
      }
    }

    // Keyboard cursor
    if (cursor >= 0 && phase === 'playing') {
      const cx = centreX(cursor);
      const cy = centreY(cursor);
      g.strokeStyle = col.accent2;
      g.lineWidth = 2.5;
      roundRect(g, cx - cell / 2 + 1, cy - cell / 2 + 1, cell - 2, cell - 2, radius + 2);
      g.stroke();
    }
  }

  /** Powered wires: one blurred pass for the glow, then a bright core line. */
  function strokeLit(g: CanvasRenderingContext2D, path: Path2D, colour: string, glow: string, lw: number, dpr: number): void {
    g.save();
    g.shadowColor = glow;
    g.shadowBlur = lw * 1.1 * dpr;
    g.strokeStyle = colour;
    g.lineWidth = lw;
    g.stroke(path);
    g.restore();
    g.strokeStyle = col.wireHighlight;
    g.lineWidth = Math.max(1, lw * 0.28);
    g.stroke(path);
  }

  function drawSource(g: CanvasRenderingContext2D, cx: number, cy: number): void {
    const s = cell * 0.56;
    const r = s * 0.26;
    g.fillStyle = rgba(col.accent2, 0.32);
    roundRect(g, cx - s / 2 - 3, cy - s / 2 - 3, s + 6, s + 6, r + 3);
    g.fill();
    g.fillStyle = col.accent2;
    roundRect(g, cx - s / 2, cy - s / 2, s, s, r);
    g.fill();
    g.fillStyle = rgba('#ffffff', 0.22);
    roundRect(g, cx - s / 2 + 1.5, cy - s / 2 + 1.5, s - 3, s * 0.42, r);
    g.fill();
    const b = s * 0.8;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(cx + 0.12 * b, cy - 0.5 * b);
    g.lineTo(cx - 0.28 * b, cy + 0.08 * b);
    g.lineTo(cx - 0.04 * b, cy + 0.08 * b);
    g.lineTo(cx - 0.12 * b, cy + 0.5 * b);
    g.lineTo(cx + 0.28 * b, cy - 0.08 * b);
    g.lineTo(cx + 0.04 * b, cy - 0.08 * b);
    g.closePath();
    g.fill();
  }

  function drawTerminal(g: CanvasRenderingContext2D, cx: number, cy: number, on: boolean, lit: string): void {
    const w = cell * 0.5;
    const h = cell * 0.38;
    const by = cy - h / 2 - cell * 0.04;
    const bx = cx - w / 2;
    if (on) {
      g.fillStyle = rgba(lit, 0.32);
      roundRect(g, bx - 3, by - 3, w + 6, h + 6, cell * 0.1);
      g.fill();
    }
    g.fillStyle = col.termBody;
    roundRect(g, bx, by, w, h, cell * 0.07);
    g.fill();
    const pad = Math.max(1.5, cell * 0.045);
    const sw = w - pad * 2;
    const sh = h - pad * 2;
    g.fillStyle = on ? (lit === col.done ? mix('#ffffff', col.done, 0.3) : col.screenOn) : col.screenOff;
    roundRect(g, bx + pad, by + pad, sw, sh, cell * 0.035);
    g.fill();
    if (on) {
      g.fillStyle = rgba('#ffffff', 0.5);
      roundRect(g, bx + pad + 1, by + pad + 1, sw * 0.45, sh * 0.35, 1.5);
      g.fill();
    }
    g.fillStyle = col.termBody;
    g.fillRect(cx - cell * 0.06, by + h, cell * 0.12, cell * 0.05);
    g.fillRect(cx - cell * 0.15, by + h + cell * 0.05, cell * 0.3, cell * 0.04);
  }

  function drawNode(g: CanvasRenderingContext2D, cx: number, cy: number, on: boolean, lit: string, lw: number): void {
    g.beginPath();
    g.arc(cx, cy, lw * 0.8, 0, Math.PI * 2);
    g.fillStyle = on ? lit : col.wireOff;
    g.fill();
    g.beginPath();
    g.arc(cx, cy, lw * 0.36, 0, Math.PI * 2);
    g.fillStyle = on ? col.wireHighlight : col.wireOffCore;
    g.fill();
  }

  function drawLock(g: CanvasRenderingContext2D, x: number, y: number, s: number, popT: number): void {
    const k = 1 + Math.sin(popT * Math.PI) * 0.45;
    g.save();
    g.translate(x + s / 2, y + s / 2);
    g.scale(k, k);
    g.translate(-s / 2, -s / 2);
    const bh = s * 0.62;
    const sy = s * 0.4;
    g.strokeStyle = col.lock;
    g.lineWidth = Math.max(1.4, s * 0.16);
    g.beginPath();
    g.arc(s / 2, sy, s * 0.27, Math.PI, 0);
    g.stroke();
    g.fillStyle = col.lock;
    roundRect(g, 0, sy, s, bh, s * 0.16);
    g.fill();
    g.restore();
  }

  showStart();
  return {
    destroy() {
      if (destroyed) return;
      if (phase === 'playing') {
        pauseClock();
        saveGame();
      }
      teardownGame();
      destroyed = true;
    },
  };
}

const game: GameModule = { strings, create };
export default game;
