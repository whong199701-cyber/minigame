import type { GameContext, GameInstance, GameModule, ThemeName } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import { createCanvas, createLoop, onPointer, roundRect, type CanvasHandle } from '../../app/canvas';
import {
  DX,
  DY,
  MODES,
  MODE_IDS,
  computePower,
  degree,
  generatePuzzle,
  hintTile,
  isModeId,
  isSolved,
  minRotations,
  period,
  rotCW,
  type ModeId,
  type Puzzle,
} from './logic';
import './style.css';

const HINT_PENALTY_S = 20;
const LONG_PRESS_MS = 450;
const TAP_SLOP_PX = 14;
const WIN_MODAL_DELAY_MS = 1100;
/** Exponential approach factor (per second) for the rotation tween. */
const SPIN_SPEED = 16;
const QUARTER = Math.PI / 2;

const strings = {
  zh: {
    rules:
      '网格里每块电路都有 1～4 个接口（直线、弯头、三通、端点、十字），正中央是电源 ⚡。\n点按一块电路，它会顺时针旋转 90°；与电源连通的线路会亮起，终端屏幕也会点亮。\n目标：让所有电路通电，并且每个接口都对接到相邻电路——不能有悬空的接口。\n长按可以锁定 / 解锁一块电路：锁定后不会被误转，适合标记已经确定的部分。\n"标准"是转到解的最少旋转次数；用更少的旋转、更短的时间完成可以刷新纪录。\n提示会把离电源最近的错误电路转正并锁定，每次提示计时 +20 秒。\n专家模式的网格边缘首尾相连：线路可以从一侧穿出，再从对侧进入。',
    tagline: '转动电路，把电源接到每一台终端',
    tip: '点按旋转 · 长按锁定',
    easyDesc: '5×5 · 25 块电路',
    mediumDesc: '7×7 · 49 块电路',
    hardDesc: '9×9 · 81 块电路',
    expertDesc: '11×11 · 121 块电路 · 边缘环绕',
    wrap: '环绕',
    turns: '旋转',
    par: '标准',
    powered: '通电',
    bestTime: '最佳用时 {t}',
    bestOver: '最少多转 {n} 次',
    noBest: '暂无纪录',
    reset: '重置',
    newPuzzle: '新谜题',
    confirmReset: '把这道谜题恢复到初始状态？',
    confirmNew: '放弃当前谜题，生成一道新的？',
    confirmLeave: '放弃当前谜题，返回难度选择？',
    lockedTap: '这块电路已锁定，长按可解锁',
    hintApplied: '已转正并锁定一块电路，用时 +{n} 秒',
    hintNone: '所有电路都已经朝向正确！',
    resultTime: '用时 {t}',
    resultTurns: '旋转 {n} 次 · 标准 {par} 次',
    perfectPar: '完美达标！',
    overPar: '比标准多转 {n} 次',
    hintsUsed: '使用提示 {n} 次（计时 +{s} 秒）',
    newBestTime: '最快用时纪录！',
    newBestTurns: '最少多转纪录！',
  },
  en: {
    rules:
      'Every tile has 1–4 connectors (straight, corner, T, end, cross). The power source ⚡ sits in the centre.\nTap a tile to rotate it 90° clockwise. Wires linked to the source light up and terminal screens switch on.\nGoal: power every tile with every connector joined to a neighbour — nothing may point at empty space.\nLong-press a tile to lock or unlock it: locked tiles cannot be rotated, handy for marking what you are sure of.\n"Par" is the minimum number of rotations needed. Beat your best time and stay close to par.\nA hint fixes and locks the wrong tile nearest the source, but adds 20 s to the clock.\nExpert grids wrap around: a wire leaving one edge comes back in on the opposite side.',
    tagline: 'Rotate the circuit so power reaches every terminal',
    tip: 'Tap to rotate · long-press to lock',
    easyDesc: '5×5 · 25 tiles',
    mediumDesc: '7×7 · 49 tiles',
    hardDesc: '9×9 · 81 tiles',
    expertDesc: '11×11 · 121 tiles · wrap-around edges',
    wrap: 'Wrap',
    turns: 'Turns',
    par: 'Par',
    powered: 'Powered',
    bestTime: 'Best time {t}',
    bestOver: 'fewest over par {n}',
    noBest: 'No record yet',
    reset: 'Reset',
    newPuzzle: 'New puzzle',
    confirmReset: 'Put this puzzle back to its starting position?',
    confirmNew: 'Abandon this puzzle and generate a new one?',
    confirmLeave: 'Abandon this puzzle and go back to the difficulty menu?',
    lockedTap: 'This tile is locked — long-press to unlock',
    hintApplied: 'One tile fixed and locked, +{n} s on the clock',
    hintNone: 'Every tile is already facing the right way!',
    resultTime: 'Time {t}',
    resultTurns: '{n} turns · par {par}',
    perfectPar: 'Perfect par!',
    overPar: '{n} over par',
    hintsUsed: '{n} hints used (+{s} s)',
    newBestTime: 'Fastest time!',
    newBestTurns: 'Fewest turns over par!',
  },
};

interface Colours {
  board: string;
  border: string;
  cell: string;
  cellOn: string;
  cellLocked: string;
  cellOnLocked: string;
  wireOff: string;
  wireOffCore: string;
  wireOn: string;
  wireGlow: string;
  wireHighlight: string;
  accent: string;
  accent2: string;
  success: string;
  warning: string;
  termBody: string;
  screenOn: string;
  screenOff: string;
  bolt: string;
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

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const storedMode = ctx.storage.get<unknown>('mode', 'easy');
  let mode: ModeId = isModeId(storedMode) ? storedMode : 'easy';
  let theme: ThemeName = ctx.theme;

  type Phase = 'start' | 'playing' | 'won';
  let phase: Phase = 'start';
  let puzzle: Puzzle | null = null;
  let size = 5;
  let wrap = false;
  let n = 25;
  let source = 12;
  let tiles = new Uint8Array(0);
  let locked = new Uint8Array(0);
  let powered = new Uint8Array(0);
  let poweredCount = 0;
  let rotations = 0;
  let hints = 0;
  let startAt = 0;
  let pausedAt = 0;
  let pausedTotal = 0;
  let hidden = false;
  let finalSeconds = 0;
  let shownSecond = -1;

  // ── Animation state ───────────────────────────────────────────────────
  let spin = new Float32Array(0); // remaining visual rotation (radians, negative = catching up clockwise)
  let glow = new Float32Array(0); // flash when a tile gets powered
  let shake = new Float32Array(0); // wiggle when tapping a locked tile
  let winT = -1;
  let winDist: Int16Array | null = null;
  let winSpeed = 1;
  let winMaxDist = 1;
  let dirty = true;

  // ── DOM / canvas ──────────────────────────────────────────────────────
  let cv: CanvasHandle | null = null;
  let offPointer: (() => void) | null = null;
  let hudTurns: HTMLElement | null = null;
  let hudPowered: HTMLElement | null = null;
  let hudTime: HTMLElement | null = null;
  let boardX = 0;
  let boardY = 0;
  let cell = 0;
  let boardPx = 0;
  let pressTimer = 0;
  let winTimer = 0;
  let pressId = -1;
  let pressTile = -1;
  let pressX = 0;
  let pressY = 0;
  let pressMoved = false;
  let pressConsumed = false;

  let col = readColours();
  const loop = createLoop((dt) => frame(dt));

  function readColours(): Colours {
    const v = (name: string, fallback: string): string => {
      const c = ctx.cssVar(name);
      return /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
    };
    const dark = theme === 'dark';
    const surface = v('--surface', dark ? '#1a1f2b' : '#ffffff');
    const surface2 = v('--surface-2', dark ? '#232a39' : '#eef1f7');
    const border = v('--border', dark ? '#2d3548' : '#dde2ec');
    const text = v('--text', dark ? '#e8ecf3' : '#171a21');
    const muted = v('--muted', dark ? '#8b94a7' : '#5c6475');
    const accent = v('--accent', dark ? '#5b8cff' : '#3366ff');
    const accent2 = v('--accent-2', dark ? '#ff7a59' : '#ff6a3d');
    const success = v('--success', dark ? '#3ddc97' : '#1fa86b');
    const warning = v('--warning', dark ? '#ffc857' : '#d9960a');
    const cell = surface2;
    return {
      board: surface,
      border,
      cell,
      cellOn: mix(accent, cell, dark ? 0.2 : 0.13),
      cellLocked: mix(warning, cell, dark ? 0.14 : 0.16),
      cellOnLocked: mix(warning, mix(accent, cell, dark ? 0.2 : 0.13), dark ? 0.14 : 0.16),
      wireOff: mix(muted, cell, dark ? 0.62 : 0.5),
      wireOffCore: mix(muted, cell, dark ? 0.4 : 0.32),
      wireOn: accent,
      wireGlow: rgba(accent, dark ? 0.32 : 0.24),
      wireHighlight: rgba('#ffffff', dark ? 0.36 : 0.42),
      accent,
      accent2,
      success,
      warning,
      termBody: mix(text, cell, dark ? 0.72 : 0.78),
      screenOn: mix('#ffffff', accent, dark ? 0.35 : 0.3),
      screenOff: mix('#000000', cell, dark ? 0.45 : 0.35),
      bolt: '#ffffff',
    };
  }

  // ── Header actions / lifecycle ────────────────────────────────────────
  const removeMenu = ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: () => confirmThen(t('confirmLeave'), showStart) });
  const removeHint = ctx.addHeaderAction({ icon: '💡', label: t('hint'), onClick: useHint });
  ctx.onDestroy(() => {
    removeMenu();
    removeHint();
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
    if (phase === 'start' || !cv) return;
    if (hidden) {
      pausedAt = performance.now();
      loop.stop();
      cancelPress();
    } else {
      if (phase === 'playing') pausedTotal += performance.now() - pausedAt;
      loop.start();
    }
  });

  function teardown(): void {
    loop.stop();
    clearTimeout(pressTimer);
    clearTimeout(winTimer);
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    hudTurns = hudPowered = hudTime = null;
    phase = 'start';
  }

  function confirmThen(message: string, fn: () => void): void {
    if (phase === 'playing' && rotations > 0) {
      ctx.showModal({
        title: t('confirm'),
        body: message,
        buttons: [{ label: t('cancel') }, { label: t('confirm'), primary: true, onClick: fn }],
      });
    } else if (phase !== 'won') {
      fn();
    }
  }

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    teardown();
    root.innerHTML = '';
    ctx.setStatus('');
    const desc = el('p', { class: 'muted nw-desc' });
    const best = el('p', { class: 'muted small nw-best' });
    const refresh = (): void => {
      desc.textContent = t(mode + 'Desc');
      const bt = ctx.storage.getBest(mode);
      const bo = ctx.storage.getBest(mode + ':over');
      best.textContent = bt === null ? t('noBest') : t('bestTime', { t: formatTime(bt) }) + (bo === null ? '' : ' · ' + t('bestOver', { n: bo }));
    };
    refresh();
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
        button(t('play'), startGame, { variant: 'primary', size: 'lg' }),
        el('p', { class: 'muted small', text: t('tip') }),
      ),
    );
  }

  // ── Game screen ───────────────────────────────────────────────────────
  function buildGameScreen(): void {
    root.innerHTML = '';
    const stat = (label: string, value: HTMLElement): HTMLElement => el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), value);
    hudTurns = el('span', { class: 'stat-value' });
    hudPowered = el('span', { class: 'stat-value' });
    hudTime = el('span', { class: 'stat-value' });
    const hud = el('div', { class: 'game-hud nw-hud' }, stat(`${t('turns')} / ${t('par')}`, hudTurns), stat(t('powered'), hudPowered), stat(t('time'), hudTime));
    const area = el('div', { class: 'game-area nw-area' });
    const footer = el(
      'div',
      { class: 'nw-footer' },
      el('p', { class: 'nw-tip muted', text: t('tip') }),
      el(
        'div',
        { class: 'nw-buttons' },
        button(t('reset'), () => confirmThen(t('confirmReset'), resetPuzzle), { icon: '↺' }),
        button(t('newPuzzle'), () => confirmThen(t('confirmNew'), newPuzzle), { icon: '🎲' }),
      ),
    );
    root.append(hud, area, footer);
    cv = createCanvas(area, layout);
    cv.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    offPointer = onPointer(cv.canvas, {
      down(p) {
        if (phase !== 'playing') return;
        cancelPress();
        pressId = p.id;
        pressTile = tileAt(p.x, p.y);
        pressX = p.x;
        pressY = p.y;
        pressMoved = false;
        pressConsumed = false;
        if (pressTile < 0) return;
        const tile = pressTile;
        pressTimer = window.setTimeout(() => {
          if (pressId === p.id && !pressMoved && pressTile === tile) {
            pressConsumed = true;
            toggleLock(tile);
          }
        }, LONG_PRESS_MS);
      },
      move(p) {
        if (p.id !== pressId || pressMoved) return;
        if (Math.hypot(p.x - pressX, p.y - pressY) > TAP_SLOP_PX) {
          pressMoved = true;
          clearTimeout(pressTimer);
        }
      },
      up(p) {
        if (p.id !== pressId) return;
        clearTimeout(pressTimer);
        const tile = pressTile;
        const isTap = !pressMoved && !pressConsumed && tile >= 0 && tileAt(p.x, p.y) === tile;
        pressId = -1;
        pressTile = -1;
        if (isTap) rotate(tile);
      },
      cancel(p) {
        if (p.id !== pressId) return;
        cancelPress();
      },
    });
  }

  function cancelPress(): void {
    clearTimeout(pressTimer);
    pressId = -1;
    pressTile = -1;
  }

  function layout(w: number, h: number): void {
    const pad = 10;
    const side = Math.max(40, Math.min(w, h) - pad * 2);
    cell = side / size;
    boardPx = cell * size;
    boardX = Math.round((w - boardPx) / 2);
    boardY = Math.round((h - boardPx) / 2);
    dirty = true;
    if (cv && !loop.running) draw();
  }

  function tileAt(px: number, py: number): number {
    const x = Math.floor((px - boardX) / cell);
    const y = Math.floor((py - boardY) / cell);
    if (x < 0 || y < 0 || x >= size || y >= size) return -1;
    return y * size + x;
  }

  function startGame(): void {
    if (!cv) buildGameScreen();
    newPuzzle();
  }

  function newPuzzle(): void {
    loadPuzzle(generatePuzzle(MODES[mode]));
  }

  function resetPuzzle(): void {
    if (puzzle) loadPuzzle(puzzle);
  }

  function loadPuzzle(p: Puzzle): void {
    clearTimeout(winTimer);
    cancelPress();
    puzzle = p;
    size = p.size;
    wrap = p.wrap;
    n = size * size;
    source = p.source;
    tiles = p.tiles.slice();
    locked = new Uint8Array(n);
    powered = new Uint8Array(n);
    spin = new Float32Array(n);
    glow = new Float32Array(n);
    shake = new Float32Array(n);
    rotations = 0;
    hints = 0;
    winT = -1;
    winDist = null;
    phase = 'playing';
    startAt = performance.now();
    pausedTotal = 0;
    pausedAt = startAt;
    shownSecond = -1;
    recomputePower();
    updateHud();
    ctx.setStatus(`${t(mode)} · ${size}×${size}${wrap ? ' · ' + t('wrap') : ''}`);
    if (cv) layout(cv.width, cv.height);
    dirty = true;
    if (!hidden) loop.start();
  }

  function elapsedSeconds(): number {
    const now = hidden ? pausedAt : performance.now();
    return (now - startAt - pausedTotal) / 1000 + hints * HINT_PENALTY_S;
  }

  function recomputePower(): void {
    const r = computePower(size, wrap, tiles, source);
    for (let i = 0; i < n; i++) if (r.powered[i] && !powered[i] && i !== source) glow[i] = 1;
    powered = r.powered;
    poweredCount = r.count;
  }

  function updateHud(): void {
    if (!hudTurns || !hudPowered || !hudTime || !puzzle) return;
    hudTurns.textContent = `${rotations} / ${puzzle.par}`;
    hudPowered.textContent = `${poweredCount} / ${n}`;
    const s = Math.floor(phase === 'won' ? finalSeconds : elapsedSeconds());
    shownSecond = s;
    hudTime.textContent = formatTime(s);
  }

  // ── Actions ───────────────────────────────────────────────────────────
  function rotate(i: number): void {
    if (phase !== 'playing') return;
    if (locked[i]) {
      shake[i] = 1;
      ctx.play('error');
      ctx.haptic('error');
      ctx.toast(t('lockedTap'));
      return;
    }
    spin[i] -= QUARTER;
    if (period(tiles[i]) === 1) {
      // A cross looks the same from every side: animate for feedback, but it is not a move.
      ctx.play('tap');
      return;
    }
    tiles[i] = rotCW(tiles[i]);
    rotations++;
    const before = poweredCount;
    recomputePower();
    ctx.play(poweredCount > before ? 'success' : 'move');
    ctx.haptic('light');
    updateHud();
    dirty = true;
    if (isSolved(size, wrap, tiles, source)) win();
  }

  function toggleLock(i: number): void {
    if (phase !== 'playing') return;
    locked[i] ^= 1;
    ctx.play(locked[i] ? 'place' : 'pop');
    ctx.haptic('medium');
    dirty = true;
  }

  function useHint(): void {
    if (phase !== 'playing' || !puzzle) return;
    const i = hintTile(puzzle, tiles);
    if (i < 0) {
      ctx.toast(t('hintNone'));
      return;
    }
    const r = Math.max(1, minRotations(tiles[i], puzzle.solution[i]));
    tiles[i] = puzzle.solution[i];
    rotations += r;
    hints++;
    spin[i] -= r * QUARTER;
    locked[i] = 1;
    recomputePower();
    glow[i] = 1;
    ctx.play('success');
    ctx.haptic('medium');
    ctx.toast(t('hintApplied', { n: HINT_PENALTY_S }));
    updateHud();
    dirty = true;
    if (isSolved(size, wrap, tiles, source)) win();
  }

  function win(): void {
    phase = 'won';
    finalSeconds = elapsedSeconds();
    cancelPress();
    const r = computePower(size, wrap, tiles, source);
    winDist = r.dist;
    winMaxDist = 1;
    for (let i = 0; i < n; i++) if (r.dist[i] > winMaxDist) winMaxDist = r.dist[i];
    winSpeed = (winMaxDist + 3) / 0.85;
    winT = 0;
    ctx.play('win');
    ctx.haptic('success');
    updateHud();
    dirty = true;
    clearTimeout(winTimer);
    winTimer = window.setTimeout(showWinModal, WIN_MODAL_DELAY_MS);
  }

  function showWinModal(): void {
    if (!puzzle) return;
    const secs = Math.floor(finalSeconds);
    const over = rotations - puzzle.par;
    const bestTime = ctx.storage.recordBest(mode, secs, 'lower');
    const bestOver = ctx.storage.recordBest(mode + ':over', over, 'lower');
    const body = el(
      'div',
      { class: 'nw-result' },
      el('p', { text: t('resultTime', { t: formatTime(secs) }) }),
      el('p', { text: t('resultTurns', { n: rotations, par: puzzle.par }) }),
      over <= 0 ? el('p', { class: 'nw-good', text: '✨ ' + t('perfectPar') }) : el('p', { class: 'muted', text: t('overPar', { n: over }) }),
      hints > 0 ? el('p', { class: 'muted small', text: t('hintsUsed', { n: hints, s: hints * HINT_PENALTY_S }) }) : null,
      bestTime ? el('p', { class: 'nw-best-line', text: '🏆 ' + t('newBest') + ' ' + t('newBestTime') }) : null,
      bestOver ? el('p', { class: 'nw-best-line', text: '🏆 ' + t('newBest') + ' ' + t('newBestTurns') }) : null,
    );
    ctx.showModal({
      title: t('win'),
      body,
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        { label: t('newGame'), primary: true, onClick: newPuzzle },
      ],
    });
  }

  // ── Frame loop / drawing ──────────────────────────────────────────────
  function frame(dt: number): void {
    let animating = false;
    for (let i = 0; i < n; i++) {
      if (spin[i] !== 0) {
        spin[i] -= spin[i] * Math.min(1, dt * SPIN_SPEED);
        if (Math.abs(spin[i]) < 0.004) spin[i] = 0;
        animating = true;
      }
      if (glow[i] > 0) {
        glow[i] = Math.max(0, glow[i] - dt * 2.4);
        animating = true;
      }
      if (shake[i] > 0) {
        shake[i] = Math.max(0, shake[i] - dt * 3.5);
        animating = true;
      }
    }
    if (winT >= 0) {
      winT += dt;
      animating = true;
      if (winT * winSpeed > winMaxDist + 4) winT = -1;
    }
    if (phase === 'playing' && hudTime) {
      const s = Math.floor(elapsedSeconds());
      if (s !== shownSecond) {
        shownSecond = s;
        hudTime.textContent = formatTime(s);
      }
    }
    if (dirty || animating) {
      draw();
      dirty = false;
    }
  }

  function draw(): void {
    if (!cv || !puzzle) return;
    const g = cv.ctx;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = col.board;
    roundRect(g, boardX - 6, boardY - 6, boardPx + 12, boardPx + 12, 14);
    g.fill();
    g.strokeStyle = col.border;
    g.lineWidth = 1;
    g.stroke();
    if (wrap) {
      g.save();
      g.setLineDash([6, 5]);
      g.strokeStyle = rgba(col.accent, 0.7);
      g.lineWidth = 2;
      roundRect(g, boardX - 3, boardY - 3, boardPx + 6, boardPx + 6, 10);
      g.stroke();
      g.restore();
    }
    for (let i = 0; i < n; i++) drawTile(g, i);
  }

  function drawTile(g: CanvasRenderingContext2D, i: number): void {
    const x = i % size;
    const y = (i - x) / size;
    let cx = boardX + (x + 0.5) * cell;
    const cy = boardY + (y + 0.5) * cell;
    if (shake[i] > 0) cx += Math.sin(shake[i] * 26) * 3 * shake[i];
    const m = tiles[i];
    const on = powered[i] === 1;
    const isSrc = i === source;
    const isEnd = !isSrc && degree(m) === 1;
    const gap = Math.max(1, cell * 0.045);
    const inner = cell - gap * 2;
    const radius = Math.max(2, cell * 0.14);
    const left = cx - inner / 2;
    const top = cy - inner / 2;

    // Cell background
    g.fillStyle = locked[i] ? (on ? col.cellOnLocked : col.cellLocked) : on ? col.cellOn : col.cell;
    roundRect(g, left, top, inner, inner, radius);
    g.fill();
    if (locked[i]) {
      g.strokeStyle = rgba(col.warning, 0.65);
      g.lineWidth = 1.5;
      g.stroke();
    }

    // Wires (rotate while the tween catches up with the logical orientation)
    const half = cell / 2;
    const lw = Math.max(3, cell * 0.2);
    g.save();
    g.translate(cx, cy);
    if (spin[i] !== 0) g.rotate(spin[i]);
    g.beginPath();
    for (let d = 0; d < 4; d++) {
      if (!(m & (1 << d))) continue;
      g.moveTo(0, 0);
      g.lineTo(DX[d] * half, DY[d] * half);
    }
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    if (on) {
      g.strokeStyle = col.wireGlow;
      g.lineWidth = lw * 2.1;
      g.stroke();
      g.strokeStyle = col.wireOn;
      g.lineWidth = lw;
      g.stroke();
      g.strokeStyle = col.wireHighlight;
      g.lineWidth = Math.max(1, lw * 0.28);
      g.stroke();
    } else {
      g.strokeStyle = col.wireOff;
      g.lineWidth = lw;
      g.stroke();
      g.strokeStyle = col.wireOffCore;
      g.lineWidth = Math.max(1, lw * 0.28);
      g.stroke();
    }
    g.restore();

    // Centre piece (not rotated, so it reads like a fixed device the wires turn around)
    if (isSrc) drawSource(g, cx, cy);
    else if (isEnd) drawTerminal(g, cx, cy, on);
    else drawNode(g, cx, cy, on, lw);

    if (locked[i]) drawLock(g, left + cell * 0.09, top + cell * 0.08, Math.max(5, cell * 0.17));

    const f = glow[i];
    if (f > 0) {
      g.fillStyle = rgba(col.accent, f * 0.38);
      roundRect(g, left, top, inner, inner, radius);
      g.fill();
    }
    if (winT >= 0 && winDist) {
      const wave = winT * winSpeed - winDist[i];
      const w = Math.max(0, 1 - Math.abs(wave) / 2.2);
      if (w > 0) {
        g.fillStyle = rgba(col.success, w * 0.5);
        roundRect(g, left, top, inner, inner, radius);
        g.fill();
      }
    }
  }

  function drawSource(g: CanvasRenderingContext2D, cx: number, cy: number): void {
    const s = cell * 0.56;
    const r = s * 0.26;
    g.fillStyle = rgba(col.accent2, 0.35);
    roundRect(g, cx - s / 2 - 3, cy - s / 2 - 3, s + 6, s + 6, r + 3);
    g.fill();
    g.fillStyle = col.accent2;
    roundRect(g, cx - s / 2, cy - s / 2, s, s, r);
    g.fill();
    g.fillStyle = rgba('#ffffff', 0.22);
    roundRect(g, cx - s / 2 + 1.5, cy - s / 2 + 1.5, s - 3, s * 0.42, r);
    g.fill();
    // Lightning bolt
    const b = s * 0.8;
    g.fillStyle = col.bolt;
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

  function drawTerminal(g: CanvasRenderingContext2D, cx: number, cy: number, on: boolean): void {
    const w = cell * 0.5;
    const h = cell * 0.38;
    const by = cy - h / 2 - cell * 0.04;
    const bx = cx - w / 2;
    if (on) {
      g.fillStyle = rgba(col.accent, 0.3);
      roundRect(g, bx - 3, by - 3, w + 6, h + 6, cell * 0.1);
      g.fill();
    }
    g.fillStyle = col.termBody;
    roundRect(g, bx, by, w, h, cell * 0.07);
    g.fill();
    const pad = Math.max(1.5, cell * 0.045);
    const sw = w - pad * 2;
    const sh = h - pad * 2;
    g.fillStyle = on ? col.screenOn : col.screenOff;
    roundRect(g, bx + pad, by + pad, sw, sh, cell * 0.035);
    g.fill();
    if (on) {
      g.fillStyle = rgba('#ffffff', 0.45);
      roundRect(g, bx + pad + 1, by + pad + 1, sw * 0.45, sh * 0.35, 1.5);
      g.fill();
    }
    // stand
    g.fillStyle = col.termBody;
    g.fillRect(cx - cell * 0.06, by + h, cell * 0.12, cell * 0.05);
    g.fillRect(cx - cell * 0.15, by + h + cell * 0.05, cell * 0.3, cell * 0.04);
  }

  function drawNode(g: CanvasRenderingContext2D, cx: number, cy: number, on: boolean, lw: number): void {
    g.beginPath();
    g.arc(cx, cy, lw * 0.8, 0, Math.PI * 2);
    g.fillStyle = on ? col.wireOn : col.wireOff;
    g.fill();
    g.beginPath();
    g.arc(cx, cy, lw * 0.36, 0, Math.PI * 2);
    g.fillStyle = on ? col.wireHighlight : col.wireOffCore;
    g.fill();
  }

  function drawLock(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    const bw = s;
    const bh = s * 0.7;
    const sy = y + s * 0.45; // body top
    g.strokeStyle = col.warning;
    g.lineWidth = Math.max(1.5, s * 0.18);
    g.beginPath();
    g.arc(x + bw / 2, sy, bw * 0.3, Math.PI, 0);
    g.stroke();
    g.fillStyle = col.warning;
    roundRect(g, x, sy, bw, bh, s * 0.16);
    g.fill();
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
