import type { GameContext, GameInstance, GameModule, ThemeName } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import { createCanvas, createLoop, onPointer, roundRect, type CanvasHandle } from '../../app/canvas';
import {
  MODES,
  MODE_IDS,
  bfsDistances,
  blockersOf,
  boardOf,
  checkBoard,
  edgeBetween,
  findHint,
  generatePuzzle,
  isModeId,
  islandStates,
  nextCount,
  otherEnd,
  validatePuzzle,
  type Board,
  type ModeId,
  type Puzzle,
} from './logic';
import './style.css';

const HINT_PENALTY_S = 30;
/** Pointer travel (px) before a press counts as a drag instead of a tap. */
const TAP_SLOP = 9;
const WIN_MODAL_DELAY_MS = 1300;
/** Bridge grow / shrink animation speed, in bridges per second. */
const BRIDGE_SPEED = 9;
const TAU = Math.PI * 2;

const strings = {
  zh: {
    rules:
      '网格上散布着标有数字的岛屿，用桥把它们连起来：\n① 桥只能横平竖直，连接同一行或同一列上相邻的两座岛。\n② 两座岛之间最多 2 座桥；桥不能交叉，也不能穿过岛屿。\n③ 每座岛连出的桥数必须正好等于它的数字。\n④ 所有岛屿最终必须连成一个整体。\n操作：从一座岛拖向另一座岛，越过中点松手即可架桥；也可以先点一座岛、再点另一座。重复操作会在 1 → 2 → 0 座之间循环，直接点已有的桥也可以循环。\n数字满足的岛会变绿，桥太多会变红。每道题只有唯一解，全靠推理即可完成。\n提示会给出下一步（或指出错误的桥），但计时 +30 秒。用时越短越好。',
    tagline: '按数字在岛屿之间架桥，把所有岛连成一片',
    tip: '拖动或依次点按两座岛来架桥 · 点桥可循环',
    easyDesc: '7×7 · 约 10 座岛',
    mediumDesc: '10×10 · 约 20 座岛',
    hardDesc: '13×13 · 约 35 座岛',
    islands: '岛屿',
    bestTime: '最快 {t}',
    noBest: '暂无纪录',
    solvedCount: '已完成 {n} 题',
    newPuzzle: '新题目',
    continueGame: '继续上一题',
    savedInfo: '有一道未完成的题目 · 已用 {t}',
    hintBtn: '提示 +30秒',
    clearBridges: '清空桥梁',
    confirmClear: '拆除所有桥，重新做这道题？计时不会重置。',
    confirmNew: '放弃当前题目，换一道新的？',
    crossing: '桥不能交叉',
    notConnected: '数字都满足了，但岛屿还没有连成一个整体',
    nothingToUndo: '没有可以撤销的操作',
    hintForced: '提示：这里必然有桥（+30 秒）',
    hintAny: '提示：加上这座桥（+30 秒）',
    hintFix: '这座桥有误，已帮你改正（+30 秒）',
    hintNone: '没有可以提示的了',
    solved: '完成！',
    resultTime: '用时',
    resultInfo: '{n} 座岛 · {b} 座桥',
    hintsUsed: '使用提示 {n} 次（+{s} 秒）',
    noHints: '未使用提示 ✨',
    boardLabel: '连桥棋盘',
  },
  en: {
    rules:
      'Numbered islands are scattered on a grid. Connect them with bridges:\n① Bridges run straight, horizontally or vertically, between neighbouring islands in the same row or column.\n② At most 2 bridges join a pair; bridges may not cross each other or pass over an island.\n③ Each island needs exactly as many bridges as its number.\n④ In the end all islands must form a single connected group.\nControls: drag from one island toward another and release past halfway to build a bridge, or tap one island and then the other. Repeating cycles 1 → 2 → 0 bridges; tapping a bridge cycles it too.\nIslands turn green when complete and red when over-built. Every puzzle has exactly one solution, reachable by pure logic.\nA hint shows the next step (or fixes a wrong bridge) but adds 30 s. Solve as fast as you can.',
    tagline: 'Build bridges so every island gets its number, and link them all',
    tip: 'Drag or tap two islands to build · tap a bridge to cycle',
    easyDesc: '7×7 · about 10 islands',
    mediumDesc: '10×10 · about 20 islands',
    hardDesc: '13×13 · about 35 islands',
    islands: 'Islands',
    bestTime: 'Best {t}',
    noBest: 'No record yet',
    solvedCount: '{n} solved',
    newPuzzle: 'New puzzle',
    continueGame: 'Continue',
    savedInfo: 'Unfinished puzzle · {t} so far',
    hintBtn: 'Hint +30s',
    clearBridges: 'Clear bridges',
    confirmClear: 'Remove every bridge and start this puzzle over? The clock keeps running.',
    confirmNew: 'Abandon this puzzle and get a new one?',
    crossing: "Bridges can't cross",
    notConnected: 'All numbers match, but the islands are not one connected group yet',
    nothingToUndo: 'Nothing to undo',
    hintForced: 'Hint: this bridge is forced (+30 s)',
    hintAny: 'Hint: add this bridge (+30 s)',
    hintFix: 'That bridge was wrong, now fixed (+30 s)',
    hintNone: 'Nothing left to hint',
    solved: 'Solved!',
    resultTime: 'Time',
    resultInfo: '{n} islands · {b} bridges',
    hintsUsed: 'Hints used: {n} (+{s} s)',
    noHints: 'No hints used ✨',
    boardLabel: 'Bridges board',
  },
};

interface Colours {
  board: string;
  boardEdge: string;
  dot: string;
  bridge: string;
  island: string;
  islandRing: string;
  islandText: string;
  shadow: string;
  okFill: string;
  okRing: string;
  okText: string;
  overFill: string;
  overRing: string;
  overText: string;
  accent: string;
  danger: string;
  success: string;
  muted: string;
}

interface SaveData {
  p: Puzzle;
  b: number[];
  /** Seconds played, without hint penalties. */
  t: number;
  h: number;
}

interface Press {
  id: number;
  x: number;
  y: number;
  island: number;
  edge: number;
  moved: boolean;
}

interface Drag {
  /** -1 while the pointer is still over the island. */
  dir: number;
  edge: number;
  target: number;
  /** Distance travelled toward the target, as a fraction of the gap (0..). */
  progress: number;
  armed: boolean;
  blocked: boolean;
  /** Rubber-band end point. */
  px: number;
  py: number;
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

/** `w` of c1 blended with `1 - w` of c2, as hex. */
function mix(c1: string, c2: string, w: number): string {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  const ch = (i: number) => Math.round(a[i] * w + b[i] * (1 - w));
  return '#' + [ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

const easeOut = (x: number): number => 1 - (1 - x) * (1 - x) * (1 - x);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const storedMode = ctx.storage.get<unknown>('mode', 'easy');
  let mode: ModeId = isModeId(storedMode) ? storedMode : 'easy';
  let theme: ThemeName = ctx.theme;
  let col = readColours();

  type Phase = 'start' | 'playing' | 'won';
  let phase: Phase = 'start';
  let puzzle: Puzzle | null = null;
  let board: Board | null = null;
  let bridges: number[] = [];
  let states: Int8Array = new Int8Array(0);
  let undoStack: { e: number; prev: number }[] = [];
  let hints = 0;
  let accMs = 0;
  let segStart = 0;
  let running = false;
  let hidden = false;
  let finalSeconds = 0;
  let shownSecond = -1;
  let lastTouched = 0;

  // ── Animation state ───────────────────────────────────────────────────
  let vis = new Float32Array(0); // displayed bridge count per edge (eases toward the real one)
  let growFrom = new Int32Array(0); // island a bridge grows out of
  let flash = new Float32Array(0); // red flash on bridges that block a crossing attempt
  let glow = new Float32Array(0); // hint highlight per edge
  let glowBad = new Uint8Array(0); // hint highlight colour: 1 = a fixed mistake
  let pop = new Float32Array(0); // island bump when it becomes satisfied
  let shake = new Float32Array(0); // island wiggle on an invalid move
  let pulse = 0; // selection ring phase
  let winT = -1;
  let winDist: Int32Array | null = null;
  let winSpeed = 10;
  let winMax = 1;
  let dirty = true;

  // ── Interaction ───────────────────────────────────────────────────────
  let sel = -1;
  let press: Press | null = null;
  let drag: Drag | null = null;

  // ── Layout ────────────────────────────────────────────────────────────
  let cv: CanvasHandle | null = null;
  let offPointer: (() => void) | null = null;
  let cell = 30;
  let R = 12;
  let ox = 0;
  let oy = 0;
  let minX = 0;
  let minY = 0;
  let cols = 1;
  let rows = 1;
  let icx = new Float32Array(0);
  let icy = new Float32Array(0);
  let occupied = new Uint8Array(0);

  // ── DOM ───────────────────────────────────────────────────────────────
  let hudIslands: HTMLElement | null = null;
  let hudTime: HTMLElement | null = null;
  let hudBest: HTMLElement | null = null;
  let headerOffs: (() => void)[] = [];
  let winTimer = 0;

  const loop = createLoop((dt) => frame(dt));

  function readColours(): Colours {
    const v = (name: string, fallback: string): string => {
      const c = ctx.cssVar(name).trim();
      return /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
    };
    const dark = theme === 'dark';
    const surface = v('--surface', dark ? '#1a1f2b' : '#ffffff');
    const text = v('--text', dark ? '#e8ecf3' : '#171a21');
    const muted = v('--muted', dark ? '#8b94a7' : '#5c6475');
    const accent = v('--accent', dark ? '#5b8cff' : '#3366ff');
    const success = v('--success', dark ? '#3ddc97' : '#1fa86b');
    const danger = v('--danger', dark ? '#ff5470' : '#e0304f');
    const borderC = v('--border', dark ? '#2d3548' : '#dde2ec');
    // A faint blue "water" tint on the board.
    const boardC = mix(accent, surface, dark ? 0.08 : 0.06);
    const island = dark ? mix(text, boardC, 0.13) : '#ffffff';
    return {
      board: boardC,
      boardEdge: mix(accent, borderC, dark ? 0.18 : 0.14),
      dot: mix(accent, boardC, dark ? 0.32 : 0.26),
      bridge: mix(text, boardC, dark ? 0.82 : 0.78),
      island,
      islandRing: mix(text, boardC, dark ? 0.5 : 0.62),
      islandText: text,
      shadow: dark ? 'rgba(0,0,0,0.38)' : 'rgba(20,30,60,0.16)',
      okFill: mix(success, boardC, dark ? 0.24 : 0.16),
      okRing: success,
      okText: dark ? mix(success, '#ffffff', 0.7) : mix(success, '#000000', 0.72),
      overFill: mix(danger, boardC, dark ? 0.26 : 0.14),
      overRing: danger,
      overText: dark ? mix(danger, '#ffffff', 0.72) : mix(danger, '#000000', 0.8),
      accent,
      danger,
      success,
      muted,
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────
  const onKey = (e: KeyboardEvent): void => {
    if (phase !== 'playing') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if (e.key === 'Escape' && sel >= 0) {
      sel = -1;
      dirty = true;
    }
  };
  window.addEventListener('keydown', onKey);

  ctx.onDestroy(() => {
    window.removeEventListener('keydown', onKey);
    teardown();
  });
  ctx.onThemeChange((th) => {
    theme = th;
    col = readColours();
    dirty = true;
    if (cv && !loop.running) draw();
  });
  ctx.onVisibility((visible) => {
    if (visible === !hidden) return;
    hidden = !visible;
    if (!cv) return;
    if (hidden) {
      pauseClock();
      save();
      loop.stop();
      press = null;
      drag = null;
    } else {
      if (phase === 'playing') resumeClock();
      loop.start();
    }
  });

  function teardown(): void {
    if (phase === 'playing') {
      pauseClock();
      save();
    }
    loop.stop();
    clearTimeout(winTimer);
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    headerOffs.forEach((off) => off());
    headerOffs = [];
    hudIslands = hudTime = hudBest = null;
    press = null;
    drag = null;
    sel = -1;
    phase = 'start';
  }

  // ── Clock ─────────────────────────────────────────────────────────────
  function pauseClock(): void {
    if (!running) return;
    accMs += performance.now() - segStart;
    running = false;
  }

  function resumeClock(): void {
    if (running || hidden) return;
    segStart = performance.now();
    running = true;
  }

  /** Seconds played without hint penalties. */
  function playedSeconds(): number {
    return (accMs + (running ? performance.now() - segStart : 0)) / 1000;
  }

  function elapsedSeconds(): number {
    return playedSeconds() + hints * HINT_PENALTY_S;
  }

  // ── Persistence ───────────────────────────────────────────────────────
  const saveKey = (m: ModeId): string => 'save:' + m;

  function save(): void {
    if (phase !== 'playing' || !puzzle) return;
    const data: SaveData = { p: puzzle, b: bridges.slice(), t: Math.floor(playedSeconds()), h: hints };
    ctx.storage.set(saveKey(mode), data);
  }

  function loadSave(m: ModeId): SaveData | null {
    const d = ctx.storage.get<unknown>(saveKey(m), null);
    if (!d || typeof d !== 'object') return null;
    const s = d as Partial<SaveData>;
    if (!validatePuzzle(s.p) || !Array.isArray(s.b)) return null;
    if (s.p.w !== MODES[m].size || s.b.length !== s.p.solution.length) return null;
    if (!s.b.every((v) => v === 0 || v === 1 || v === 2)) return null;
    const secs = typeof s.t === 'number' && Number.isFinite(s.t) && s.t >= 0 ? s.t : 0;
    const h = typeof s.h === 'number' && Number.isInteger(s.h) && s.h >= 0 ? s.h : 0;
    return { p: s.p, b: s.b, t: secs, h };
  }

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    teardown();
    root.innerHTML = '';
    ctx.setStatus('');
    const desc = el('p', { class: 'muted hs-desc' });
    const best = el('p', { class: 'muted small hs-best' });
    const saved = el('p', { class: 'muted small hs-saved' });
    const actions = el('div', { class: 'hs-start-actions' });
    const refresh = (): void => {
      desc.textContent = t(mode + 'Desc');
      const bt = ctx.storage.getBest(mode);
      const solvedN = ctx.storage.get<number>('solved:' + mode, 0);
      const parts = [bt === null ? t('noBest') : t('bestTime', { t: formatTime(bt) })];
      if (solvedN > 0) parts.push(t('solvedCount', { n: solvedN }));
      best.textContent = parts.join(' · ');
      actions.innerHTML = '';
      const s = loadSave(mode);
      // Only offer to continue a puzzle that has actually been worked on.
      if (s && (s.t >= 5 || s.h > 0 || s.b.some((v) => v > 0))) {
        saved.textContent = t('savedInfo', { t: formatTime(s.t + s.h * HINT_PENALTY_S) });
        actions.append(
          button(t('continueGame'), () => resumeSaved(), { variant: 'primary', size: 'lg' }),
          button(t('newPuzzle'), () => startNew(), { variant: 'secondary', icon: '🎲' }),
        );
      } else {
        saved.textContent = '';
        actions.append(button(t('play'), () => startNew(), { variant: 'primary', size: 'lg' }));
      }
    };
    refresh();
    root.append(
      el(
        'div',
        { class: 'start-screen hs-start' },
        el('div', { class: 'big-icon', text: '🌉' }),
        el('h2', { text: t('chooseDifficulty') }),
        el('p', { class: 'muted hs-tagline', text: t('tagline') }),
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
        saved,
        el('p', { class: 'muted small hs-tip-start', text: t('tip') }),
      ),
    );
  }

  // ── Game screen ───────────────────────────────────────────────────────
  function buildGameScreen(): void {
    root.innerHTML = '';
    const stat = (label: string, value: HTMLElement): HTMLElement =>
      el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), value);
    hudIslands = el('span', { class: 'stat-value' });
    hudTime = el('span', { class: 'stat-value' });
    hudBest = el('span', { class: 'stat-value' });
    const hud = el('div', { class: 'game-hud hs-hud' }, stat(t('islands'), hudIslands), stat(t('time'), hudTime), stat(t('best'), hudBest));
    const area = el('div', { class: 'game-area hs-area' });
    const footer = el(
      'div',
      { class: 'hs-footer' },
      el('p', { class: 'hs-tip muted', text: t('tip') }),
      el(
        'div',
        { class: 'hs-buttons' },
        button(t('difficulty'), () => showStart(), { icon: '☰' }),
        button(t('hintBtn'), useHint, { icon: '💡' }),
      ),
    );
    root.append(el('div', { class: 'hs-game' }, hud, area, footer));
    headerOffs.push(
      ctx.addHeaderAction({ icon: '↶', label: t('undo'), onClick: undo }),
      ctx.addHeaderAction({ icon: '↻', label: t('clearBridges'), onClick: askClear }),
      ctx.addHeaderAction({ icon: '🎲', label: t('newPuzzle'), onClick: askNew }),
    );
    cv = createCanvas(area, layout);
    cv.canvas.setAttribute('role', 'img');
    cv.canvas.setAttribute('aria-label', t('boardLabel'));
    cv.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    offPointer = onPointer(cv.canvas, { down: onDown, move: onMove, up: onUp, cancel: onCancel });
  }

  function startNew(): void {
    const g = generatePuzzle(mode);
    loadPuzzle(g.puzzle, null, 0, 0);
  }

  function resumeSaved(): void {
    const s = loadSave(mode);
    if (!s) {
      startNew();
      return;
    }
    loadPuzzle(s.p, s.b, s.t, s.h);
  }

  function loadPuzzle(p: Puzzle, b: number[] | null, playedS: number, hintCount: number): void {
    if (!cv) buildGameScreen();
    clearTimeout(winTimer);
    puzzle = p;
    board = boardOf(p);
    const E = board.edges.length;
    const N = board.islands.length;
    bridges = b ? b.slice() : new Array<number>(E).fill(0);
    states = islandStates(board, bridges);
    undoStack = [];
    hints = hintCount;
    vis = Float32Array.from(bridges);
    growFrom = new Int32Array(E);
    board.edges.forEach((ed, i) => {
      growFrom[i] = ed.a;
    });
    flash = new Float32Array(E);
    glow = new Float32Array(E);
    glowBad = new Uint8Array(E);
    pop = new Float32Array(N);
    shake = new Float32Array(N);
    occupied = new Uint8Array(p.w * p.h);
    for (const q of p.islands) occupied[q.y * p.w + q.x] = 1;
    winT = -1;
    winDist = null;
    sel = -1;
    press = null;
    drag = null;
    phase = 'playing';
    accMs = playedS * 1000;
    running = false;
    resumeClock();
    shownSecond = -1;
    ctx.setStatus(`${t(mode)} · ${p.w}×${p.h}`);
    if (cv) layout(cv.width, cv.height);
    updateHud();
    save();
    dirty = true;
    if (!hidden) loop.start();
  }

  function layout(w: number, h: number): void {
    if (!board) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const q of board.islands) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
    minX = x0;
    minY = y0;
    cols = x1 - x0 + 1;
    rows = y1 - y0 + 1;
    const margin = 16;
    cell = Math.max(10, Math.min((w - margin * 2) / cols, (h - margin * 2) / rows, 66));
    R = Math.max(7, cell * 0.41);
    ox = (w - cols * cell) / 2;
    oy = (h - rows * cell) / 2;
    const N = board.islands.length;
    icx = new Float32Array(N);
    icy = new Float32Array(N);
    board.islands.forEach((q, i) => {
      icx[i] = ox + (q.x - minX + 0.5) * cell;
      icy[i] = oy + (q.y - minY + 0.5) * cell;
    });
    dirty = true;
    if (cv && !loop.running) draw();
  }

  function updateHud(): void {
    if (!hudIslands || !hudTime || !hudBest || !board) return;
    let ok = 0;
    for (let i = 0; i < states.length; i++) if (states[i] === 0) ok++;
    hudIslands.textContent = `${ok}/${board.islands.length}`;
    hudIslands.classList.toggle('hs-done', ok === board.islands.length);
    const s = Math.floor(phase === 'won' ? finalSeconds : elapsedSeconds());
    shownSecond = s;
    hudTime.textContent = formatTime(s);
    const bt = ctx.storage.getBest(mode);
    hudBest.textContent = bt === null ? '--:--' : formatTime(bt);
  }

  // ── Hit testing ───────────────────────────────────────────────────────
  function islandAt(px: number, py: number): number {
    if (!board) return -1;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < board.islands.length; i++) {
      const d = Math.hypot(px - icx[i], py - icy[i]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return bd <= Math.max(cell * 0.62, 22) ? best : -1;
  }

  function bridgeAt(px: number, py: number): number {
    if (!board) return -1;
    let best = -1;
    let bd = Infinity;
    board.edges.forEach((ed, e) => {
      if (bridges[e] === 0) return;
      let d: number;
      if (ed.horizontal) {
        if (px < icx[ed.a] + R * 0.6 || px > icx[ed.b] - R * 0.6) return;
        d = Math.abs(py - icy[ed.a]);
      } else {
        if (py < icy[ed.a] + R * 0.6 || py > icy[ed.b] - R * 0.6) return;
        d = Math.abs(px - icx[ed.a]);
      }
      if (d < bd) {
        bd = d;
        best = e;
      }
    });
    return bd <= Math.max(cell * 0.4, 16) ? best : -1;
  }

  // ── Pointer handling ──────────────────────────────────────────────────
  function onDown(p: { x: number; y: number; id: number }): void {
    if (phase !== 'playing' || !board || press) return;
    const island = islandAt(p.x, p.y);
    const edge = island < 0 ? bridgeAt(p.x, p.y) : -1;
    press = { id: p.id, x: p.x, y: p.y, island, edge, moved: false };
    drag = null;
    dirty = true;
  }

  function onMove(p: { x: number; y: number; id: number }): void {
    if (!press || p.id !== press.id || phase !== 'playing') return;
    if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > TAP_SLOP) press.moved = true;
    if (press.moved && press.island >= 0) updateDrag(p.x, p.y);
  }

  function onUp(p: { x: number; y: number; id: number }): void {
    if (!press || p.id !== press.id) return;
    const pr = press;
    const dg = drag;
    press = null;
    drag = null;
    dirty = true;
    if (phase !== 'playing') return;
    if (pr.island >= 0) {
      if (!pr.moved) {
        tapIsland(pr.island);
      } else if (dg && dg.edge >= 0 && dg.armed) {
        sel = -1;
        cycleEdge(dg.edge, pr.island);
      }
    } else if (pr.edge >= 0 && !pr.moved) {
      sel = -1;
      const ed = board?.edges[pr.edge];
      if (ed) {
        const da = Math.hypot(p.x - icx[ed.a], p.y - icy[ed.a]);
        const db = Math.hypot(p.x - icx[ed.b], p.y - icy[ed.b]);
        cycleEdge(pr.edge, da <= db ? ed.a : ed.b);
      }
    } else if (!pr.moved && sel >= 0) {
      sel = -1;
    }
  }

  function onCancel(p: { id: number }): void {
    if (!press || p.id !== press.id) return;
    press = null;
    drag = null;
    dirty = true;
  }

  function updateDrag(px: number, py: number): void {
    if (!press || !board) return;
    const i = press.island;
    const dx = px - icx[i];
    const dy = py - icy[i];
    const prev = drag;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < R * 0.7) {
      drag = { dir: -1, edge: -1, target: -1, progress: 0, armed: false, blocked: false, px: icx[i], py: icy[i] };
      dirty = true;
      return;
    }
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const dir = horizontal ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
    const e = board.nbr[i * 4 + dir];
    const along = horizontal ? Math.abs(dx) : Math.abs(dy);
    let target = -1;
    let progress = 0;
    let reach = cell * 0.9;
    if (e >= 0) {
      target = otherEnd(board, e, i);
      const span = Math.hypot(icx[target] - icx[i], icy[target] - icy[i]);
      progress = along / span;
      reach = span - R;
    }
    const len = Math.min(along, reach);
    const sx = dir === 1 ? 1 : dir === 3 ? -1 : 0;
    const sy = dir === 2 ? 1 : dir === 0 ? -1 : 0;
    const armed = e >= 0 && progress >= 0.5;
    const blocked = e >= 0 && bridges[e] === 0 && blockersOf(board, bridges, e).length > 0;
    if (armed && !(prev && prev.armed && prev.edge === e)) ctx.haptic('light');
    drag = { dir, edge: e, target, progress, armed, blocked, px: icx[i] + sx * len, py: icy[i] + sy * len };
    dirty = true;
  }

  function tapIsland(i: number): void {
    if (!board) return;
    if (sel < 0) {
      sel = i;
      pulse = 0;
      ctx.play('tap');
    } else if (sel === i) {
      sel = -1;
      ctx.play('tap');
    } else {
      const e = edgeBetween(board, sel, i);
      if (e >= 0) {
        const from = sel;
        sel = -1;
        cycleEdge(e, from);
      } else {
        sel = i;
        pulse = 0;
        ctx.play('tap');
      }
    }
    dirty = true;
  }

  // ── Moves ─────────────────────────────────────────────────────────────
  /** Apply the 0 → 1 → 2 → 0 cycle on edge e, started from island `from`. */
  function cycleEdge(e: number, from: number): void {
    if (!board || phase !== 'playing') return;
    const cur = bridges[e];
    if (cur === 0) {
      const blockers = blockersOf(board, bridges, e);
      if (blockers.length > 0) {
        for (const c of blockers) flash[c] = 1;
        shake[from] = 1;
        ctx.play('error');
        ctx.haptic('error');
        ctx.toast(t('crossing'), 1200);
        dirty = true;
        return;
      }
    }
    const next = nextCount(cur);
    undoStack.push({ e, prev: cur });
    const gained = applyEdge(e, next, from);
    afterMove(gained, next > cur ? 'place' : 'pop');
  }

  /** Set an edge's count; returns true when an endpoint island just became satisfied. */
  function applyEdge(e: number, v: number, from: number): boolean {
    if (!board) return false;
    const ed = board.edges[e];
    if (v > bridges[e] && vis[e] < 0.05) growFrom[e] = from === ed.b ? ed.b : ed.a;
    bridges[e] = v;
    lastTouched = from;
    const before = states;
    states = islandStates(board, bridges);
    let gained = false;
    for (const i of [ed.a, ed.b]) {
      if (states[i] === 0 && before[i] !== 0) {
        pop[i] = 1;
        gained = true;
      }
    }
    dirty = true;
    return gained;
  }

  function afterMove(gained: boolean, sound: 'place' | 'pop' | 'move'): void {
    if (!board) return;
    const c = checkBoard(board, bridges);
    updateHud();
    if (c.solved) {
      win();
      return;
    }
    ctx.play(gained ? 'success' : sound);
    ctx.haptic('light');
    if (c.allDegrees && !c.connected && !c.crossing) {
      ctx.toast(t('notConnected'), 2400);
      ctx.haptic('medium');
    }
    save();
  }

  function undo(): void {
    if (phase !== 'playing' || !board) return;
    const last = undoStack.pop();
    if (!last) {
      ctx.toast(t('nothingToUndo'), 1200);
      return;
    }
    sel = -1;
    const gained = applyEdge(last.e, last.prev, board.edges[last.e].a);
    afterMove(gained, 'move');
  }

  function hasBridges(): boolean {
    return bridges.some((v) => v > 0);
  }

  function confirmThen(message: string, fn: () => void): void {
    ctx.showModal({
      title: t('confirm'),
      body: message,
      buttons: [{ label: t('cancel') }, { label: t('confirm'), primary: true, onClick: fn }],
    });
  }

  function askClear(): void {
    if (phase !== 'playing' || !hasBridges()) return;
    confirmThen(t('confirmClear'), clearAll);
  }

  function clearAll(): void {
    if (phase !== 'playing' || !board) return;
    bridges.fill(0);
    states = islandStates(board, bridges);
    undoStack = [];
    sel = -1;
    ctx.play('swoosh');
    ctx.haptic('medium');
    updateHud();
    save();
    dirty = true;
  }

  function askNew(): void {
    if (phase === 'won') return;
    if (phase === 'playing' && hasBridges()) confirmThen(t('confirmNew'), startNew);
    else startNew();
  }

  function useHint(): void {
    if (phase !== 'playing' || !board || !puzzle) return;
    const h = findHint(board, puzzle.solution, bridges);
    if (!h) {
      ctx.toast(t('hintNone'));
      return;
    }
    hints++;
    sel = -1;
    const ed = board.edges[h.edge];
    undoStack.push({ e: h.edge, prev: bridges[h.edge] });
    const gained = applyEdge(h.edge, h.value, ed.a);
    glow[h.edge] = 1;
    glowBad[h.edge] = h.kind === 'fix' ? 1 : 0;
    ctx.toast(h.kind === 'fix' ? t('hintFix') : h.forced ? t('hintForced') : t('hintAny'), 2200);
    ctx.haptic('medium');
    const c = checkBoard(board, bridges);
    updateHud();
    if (c.solved) {
      win();
      return;
    }
    ctx.play(gained ? 'success' : 'coin');
    save();
  }

  // ── Win ───────────────────────────────────────────────────────────────
  function win(): void {
    if (!board) return;
    pauseClock();
    finalSeconds = elapsedSeconds();
    phase = 'won';
    sel = -1;
    press = null;
    drag = null;
    winDist = bfsDistances(board, bridges, lastTouched);
    winMax = 1;
    for (let i = 0; i < winDist.length; i++) winMax = Math.max(winMax, winDist[i]);
    winSpeed = Math.max(9, (winMax + 1) / 0.9);
    winT = 0;
    ctx.play('win');
    ctx.haptic('success');
    const secs = Math.floor(finalSeconds);
    const isBest = ctx.storage.recordBest(mode, secs, 'lower');
    ctx.storage.set('solved:' + mode, ctx.storage.get<number>('solved:' + mode, 0) + 1);
    ctx.storage.remove(saveKey(mode));
    updateHud();
    dirty = true;
    const nBridges = bridges.reduce((s, v) => s + v, 0);
    const nIslands = board.islands.length;
    const usedHints = hints;
    clearTimeout(winTimer);
    winTimer = window.setTimeout(() => showWinModal(secs, isBest, nIslands, nBridges, usedHints), WIN_MODAL_DELAY_MS);
  }

  function showWinModal(secs: number, isBest: boolean, nIslands: number, nBridges: number, usedHints: number): void {
    const body = el(
      'div',
      { class: 'hs-result' },
      el('p', { class: 'muted small', text: t('resultTime') }),
      el('p', { class: 'hs-big', text: formatTime(secs) }),
      el('p', { text: t('resultInfo', { n: nIslands, b: nBridges }) }),
      usedHints > 0
        ? el('p', { class: 'muted small', text: t('hintsUsed', { n: usedHints, s: usedHints * HINT_PENALTY_S }) })
        : el('p', { class: 'hs-good small', text: t('noHints') }),
      isBest ? el('p', { class: 'hs-record', text: '🏆 ' + t('newBest') }) : null,
    );
    ctx.showModal({
      title: '🌉 ' + t('solved'),
      body,
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        { label: t('newGame'), primary: true, onClick: startNew },
      ],
    });
  }

  // ── Frame loop ────────────────────────────────────────────────────────
  function frame(dt: number): void {
    if (!board) return;
    let anim = false;
    const E = board.edges.length;
    const step = BRIDGE_SPEED * dt;
    for (let e = 0; e < E; e++) {
      const target = bridges[e];
      if (vis[e] !== target) {
        const d = target - vis[e];
        vis[e] = Math.abs(d) <= step ? target : vis[e] + Math.sign(d) * step;
        anim = true;
      }
      if (flash[e] > 0) {
        flash[e] = Math.max(0, flash[e] - dt * 1.6);
        anim = true;
      }
      if (glow[e] > 0) {
        glow[e] = Math.max(0, glow[e] - dt * 0.55);
        anim = true;
      }
    }
    for (let i = 0; i < pop.length; i++) {
      if (pop[i] > 0) {
        pop[i] = Math.max(0, pop[i] - dt * 3.2);
        anim = true;
      }
      if (shake[i] > 0) {
        shake[i] = Math.max(0, shake[i] - dt * 3.5);
        anim = true;
      }
    }
    if (sel >= 0 || drag) {
      pulse += dt;
      anim = true;
    }
    if (winT >= 0) {
      winT += dt;
      anim = true;
      if (winT * winSpeed > winMax + 2.5) {
        winT = -1;
        dirty = true;
      }
    }
    if (phase === 'playing' && hudTime) {
      const s = Math.floor(elapsedSeconds());
      if (s !== shownSecond) {
        shownSecond = s;
        hudTime.textContent = formatTime(s);
      }
    }
    if (dirty || anim) {
      draw();
      dirty = false;
    }
    // Nothing left to animate once the win ripple has finished: let the loop rest.
    if (phase === 'won' && winT < 0 && !anim) loop.stop();
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function lineWidth(): number {
    return Math.max(2, Math.min(4.5, cell * 0.075));
  }

  function bridgeOffset(): number {
    return Math.max(3, Math.min(7.5, cell * 0.12));
  }

  /**
   * Stroke the bridges of edge e as `amount` (0..2, fractional while animating) parallel lines,
   * growing out of island `from`.
   */
  function strokeBridges(g: CanvasRenderingContext2D, e: number, amount: number, from: number, color: string, width: number, dash: number[] | null = null): void {
    if (!board || amount <= 0.001) return;
    const ed = board.edges[e];
    const a = from === ed.b ? ed.b : ed.a;
    const b = a === ed.a ? ed.b : ed.a;
    const x1 = icx[a];
    const y1 = icy[a];
    const x2 = icx[b];
    const y2 = icy[b];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const nx = -uy;
    const ny = ux;
    const inset = R * 0.92;
    const full = Math.max(0, len - inset * 2);
    const sx = x1 + ux * inset;
    const sy = y1 + uy * inset;
    const p1 = easeOut(clamp01(amount));
    const p2 = easeOut(clamp01(amount - 1));
    const off = bridgeOffset() * p2;
    g.save();
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    if (dash) g.setLineDash(dash);
    g.beginPath();
    g.moveTo(sx - nx * off, sy - ny * off);
    g.lineTo(sx - nx * off + ux * full * p1, sy - ny * off + uy * full * p1);
    if (p2 > 0.001) {
      g.moveTo(sx + nx * off, sy + ny * off);
      g.lineTo(sx + nx * off + ux * full * p2, sy + ny * off + uy * full * p2);
    }
    g.stroke();
    g.restore();
  }

  /** Soft wide band along the whole gap of edge e (used for highlights). */
  function band(g: CanvasRenderingContext2D, e: number, color: string, width: number): void {
    if (!board) return;
    const ed = board.edges[e];
    g.save();
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.beginPath();
    if (ed.horizontal) {
      g.moveTo(icx[ed.a] + R, icy[ed.a]);
      g.lineTo(icx[ed.b] - R, icy[ed.b]);
    } else {
      g.moveTo(icx[ed.a], icy[ed.a] + R);
      g.lineTo(icx[ed.b], icy[ed.b] - R);
    }
    g.stroke();
    g.restore();
  }

  function draw(): void {
    if (!cv || !board) return;
    const g = cv.ctx;
    g.clearRect(0, 0, cv.width, cv.height);
    const N = board.islands.length;
    const E = board.edges.length;
    const lw = lineWidth();

    // Board (water) with faint grid dots.
    const pad = Math.min(10, cell * 0.3);
    const bw = cols * cell;
    const bh = rows * cell;
    g.fillStyle = col.board;
    roundRect(g, ox - pad, oy - pad, bw + pad * 2, bh + pad * 2, Math.min(18, cell * 0.55));
    g.fill();
    g.strokeStyle = col.boardEdge;
    g.lineWidth = 1;
    g.stroke();
    const w = board.w;
    const dr = Math.max(1, cell * 0.045);
    g.fillStyle = col.dot;
    g.beginPath();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (occupied[(y + minY) * w + (x + minX)]) continue;
        const px = ox + (x + 0.5) * cell;
        const py = oy + (y + 0.5) * cell;
        g.moveTo(px + dr, py);
        g.arc(px, py, dr, 0, TAU);
      }
    }
    g.fill();

    // Guides from the focused island to the islands it can reach.
    const focus = phase === 'playing' ? (press && press.island >= 0 ? press.island : sel) : -1;
    const candidates = new Set<number>();
    if (focus >= 0) {
      for (let d = 0; d < 4; d++) {
        const e = board.nbr[focus * 4 + d];
        if (e < 0) continue;
        const blocked = bridges[e] === 0 && blockersOf(board, bridges, e).length > 0;
        if (!blocked) candidates.add(otherEnd(board, e, focus));
        if (bridges[e] > 0 && !blocked) continue;
        const ed = board.edges[e];
        g.save();
        g.setLineDash([2, Math.max(4, cell * 0.16)]);
        g.lineCap = 'round';
        g.strokeStyle = blocked ? rgba(col.danger, 0.4) : rgba(col.accent, 0.55);
        g.lineWidth = Math.max(1.5, lw * 0.6);
        g.beginPath();
        if (ed.horizontal) {
          g.moveTo(icx[ed.a] + R + 2, icy[ed.a]);
          g.lineTo(icx[ed.b] - R - 2, icy[ed.b]);
        } else {
          g.moveTo(icx[ed.a], icy[ed.a] + R + 2);
          g.lineTo(icx[ed.b], icy[ed.b] - R - 2);
        }
        g.stroke();
        g.restore();
      }
    }

    // Highlights under the bridges.
    const dragBlockers = drag && drag.blocked && drag.edge >= 0 ? blockersOf(board, bridges, drag.edge) : [];
    for (let e = 0; e < E; e++) {
      if (glow[e] > 0) {
        const k = Math.sin(Math.min(1, (1 - glow[e]) * 1.6) * Math.PI * 3) * 0.25 + 0.75;
        band(g, e, rgba(glowBad[e] ? col.danger : col.accent, glow[e] * 0.42 * k), lw * 2 + bridgeOffset() * 2 + 6);
      }
      if (flash[e] > 0) band(g, e, rgba(col.danger, flash[e] * 0.45), lw * 2 + bridgeOffset() * 2 + 6);
    }
    for (const e of dragBlockers) band(g, e, rgba(col.danger, 0.3 + 0.15 * Math.sin(pulse * 9)), lw * 2 + bridgeOffset() * 2 + 6);

    // Bridges.
    const front = winT >= 0 ? winT * winSpeed : Infinity;
    for (let e = 0; e < E; e++) {
      if (vis[e] <= 0.001) continue;
      const ed = board.edges[e];
      let c = col.bridge;
      if (phase === 'won' && winDist) {
        const reach = Math.max(winDist[ed.a], winDist[ed.b]);
        if (front >= reach) c = col.success;
      }
      if (flash[e] > 0.25 || dragBlockers.includes(e)) c = col.danger;
      strokeBridges(g, e, vis[e], growFrom[e], c, lw);
    }

    // Drag preview.
    if (drag && press && press.island >= 0 && drag.dir >= 0 && phase === 'playing') {
      const i = press.island;
      if (drag.edge >= 0 && drag.armed) {
        const cur = bridges[drag.edge];
        const next = nextCount(cur);
        if (drag.blocked) {
          strokeBridges(g, drag.edge, 1, i, rgba(col.danger, 0.9), lw, [lw * 1.5, lw * 1.8]);
        } else if (next === 0) {
          strokeBridges(g, drag.edge, cur, i, rgba(col.danger, 0.95), lw, [lw * 1.5, lw * 1.8]);
        } else {
          band(g, drag.edge, rgba(col.accent, 0.18), lw * 2 + bridgeOffset() * 2 + 6);
          strokeBridges(g, drag.edge, next, i, rgba(col.accent, 0.95), lw);
        }
      } else {
        const c = drag.edge < 0 ? rgba(col.muted, 0.6) : drag.blocked ? rgba(col.danger, 0.75) : rgba(col.accent, 0.7);
        const sx = drag.dir === 1 ? 1 : drag.dir === 3 ? -1 : 0;
        const sy = drag.dir === 2 ? 1 : drag.dir === 0 ? -1 : 0;
        const x0 = icx[i] + sx * R;
        const y0 = icy[i] + sy * R;
        if ((drag.px - x0) * sx + (drag.py - y0) * sy > 0) {
          g.save();
          g.strokeStyle = c;
          g.lineWidth = lw;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(drag.px, drag.py);
          g.stroke();
          g.beginPath();
          g.arc(drag.px, drag.py, lw * 1.3, 0, TAU);
          g.fillStyle = c;
          g.fill();
          g.restore();
        }
      }
    }

    // Islands.
    const fontSize = Math.max(10, R * 1.12);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
    const armedTarget = drag && drag.armed ? drag.target : -1;
    for (let i = 0; i < N; i++) {
      let x = icx[i];
      const y = icy[i];
      if (shake[i] > 0) x += Math.sin(shake[i] * 30) * 3.5 * shake[i];
      let scale = 1;
      if (pop[i] > 0) scale += 0.2 * Math.sin((1 - pop[i]) * Math.PI);
      let waveK = -1;
      if (winT >= 0 && winDist) {
        waveK = winT * winSpeed - winDist[i];
        if (waveK >= 0 && waveK < 1.6) scale += 0.16 * Math.sin((waveK / 1.6) * Math.PI);
      }
      const r = R * scale;
      const st = states[i];
      const fill = phase === 'won' || st === 0 ? col.okFill : st > 0 ? col.overFill : col.island;
      const ring = phase === 'won' || st === 0 ? col.okRing : st > 0 ? col.overRing : col.islandRing;
      const txt = phase === 'won' || st === 0 ? col.okText : st > 0 ? col.overText : col.islandText;

      // Focus rings (behind the disc).
      if (i === focus || i === armedTarget) {
        const k = 0.5 + 0.5 * Math.sin(pulse * 6);
        g.beginPath();
        g.arc(x, y, r + 4 + k * 2, 0, TAU);
        g.fillStyle = rgba(col.accent, 0.22 + 0.1 * k);
        g.fill();
      }
      // Shadow + disc.
      g.beginPath();
      g.arc(x, y + Math.max(1, r * 0.1), r, 0, TAU);
      g.fillStyle = col.shadow;
      g.fill();
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = Math.max(1.5, r * 0.13);
      g.strokeStyle = i === focus || i === armedTarget ? col.accent : ring;
      g.stroke();
      if (candidates.has(i) && i !== armedTarget) {
        g.save();
        g.setLineDash([3, 3]);
        g.lineWidth = 1.5;
        g.strokeStyle = rgba(col.accent, 0.85);
        g.beginPath();
        g.arc(x, y, r + 3.5, 0, TAU);
        g.stroke();
        g.restore();
      }
      g.fillStyle = txt;
      g.fillText(String(board.islands[i].n), x, y + fontSize * 0.04);

      // Win ripple.
      if (waveK >= 0 && waveK < 1.6) {
        const k = waveK / 1.6;
        g.beginPath();
        g.arc(x, y, R * (1.1 + k * 1.1), 0, TAU);
        g.strokeStyle = rgba(col.success, (1 - k) * 0.8);
        g.lineWidth = 2.5 * (1 - k) + 0.5;
        g.stroke();
      }
    }
  }

  showStart();
  return {
    destroy() {
      teardown();
    },
  };
}

const game: GameModule = { strings, create };
export default game;
