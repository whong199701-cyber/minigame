import type { GameContext, GameInstance, GameModule } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import { createCanvas, createLoop, onPointer, type CanvasHandle } from '../../app/canvas';
import {
  BLUE,
  DIFFICULTIES,
  HIDDEN,
  applyMark,
  cellCenter,
  findDeduction,
  generatePuzzle,
  hexPoints,
  initialState,
  isComplete,
  layoutGrid,
  pickCell,
  remainingBlue,
  type Deduction,
  type Difficulty,
  type Layout,
  type Puzzle,
} from './logic';
import './style.css';

const strings = {
  zh: {
    rules:
      '网格中的每个格子要么是蓝色，要么是空白。\n翻开的空白格会显示数字：周围 6 格里有几个蓝格。\n底部选择「翻开」或「标蓝」后点击橙色格子；长按格子则执行相反操作。\n判断错误算一次失误，格子会显示真实状态；失误达到上限即失败。\n顶部的「剩余蓝格」数也是重要线索，尤其在收尾时。\n每一关都能完全靠逻辑推完，不需要猜；卡住时可用 💡 提示（+15 秒）。\n解开全部格子即获胜，用时越短越好，零失误记为完美。',
    desc: '纯逻辑的六边形排雷，无需猜测',
    modeDesc: '{cols}×{rows} · 约 {pct}% 蓝格 · 失误 {m} 次即失败',
    modeReveal: '翻开',
    modeBlue: '标蓝',
    longPress: '长按格子执行相反操作',
    remaining: '剩余蓝格',
    mistakes: '失误',
    hints: '提示',
    bestLine: '最佳 {t} · 完美 {n} 次',
    noBest: '尚无记录',
    hintPenalty: '提示 +15 秒',
    hintSatisfied: '数字 {n} 的蓝格已经凑齐，它其余的邻居都是空白',
    hintSaturated: '数字 {n} 还缺的蓝格数正好等于未知邻居数，所以全是蓝色',
    hintSubset: '一个线索的未知格完全包含在另一个线索里，比较两者的差值',
    hintOverlap: '两个线索有重叠区域，先推重叠部分最多/最少有几个蓝格',
    hintGlobal: '结合顶部的剩余蓝格总数来判断',
    hintFallback: '从高亮的格子开始思考',
    concludeBlue: '→ 高亮格是蓝色',
    concludeEmpty: '→ 高亮格是空白',
    winTime: '用时 {t}',
    winMistakes: '失误 {n} 次 · 提示 {h} 次',
    perfect: '✨ 完美通关：零失误！',
    loseBody: '失误达到 {n} 次，推理链断了。\n每一关都可以纯靠逻辑解开——再试一次吧。',
    restartConfirm: '当前进度将丢失，返回难度选择？',
  },
  en: {
    rules:
      'Every cell is either blue or empty.\nA revealed empty cell shows a number: how many of its 6 neighbours are blue.\nPick Reveal or Mark blue at the bottom, then tap an orange cell; long-press a cell to do the opposite.\nA wrong call is a mistake and the cell shows its true state; reach the mistake limit and you lose.\nThe remaining-blue count at the top is a clue too, especially near the end.\nEvery board can be finished by pure logic — never guess; use 💡 when stuck (+15 s).\nResolve every cell to win; faster is better and zero mistakes counts as perfect.',
    desc: 'Pure-logic hex minesweeper, no guessing',
    modeDesc: '{cols}×{rows} · ~{pct}% blue · {m} mistakes lose',
    modeReveal: 'Reveal',
    modeBlue: 'Mark blue',
    longPress: 'Long-press a cell for the opposite action',
    remaining: 'Blue left',
    mistakes: 'Mistakes',
    hints: 'Hints',
    bestLine: 'Best {t} · Perfect ×{n}',
    noBest: 'No record yet',
    hintPenalty: 'Hint +15 s',
    hintSatisfied: 'Clue {n} already has all its blues, so its other neighbours are empty',
    hintSaturated: 'Clue {n} still needs exactly as many blues as it has unknown neighbours — all blue',
    hintSubset: "One clue's unknown cells sit entirely inside another's — compare the difference",
    hintOverlap: 'Two clues overlap — work out how many blues the shared cells can hold',
    hintGlobal: 'Combine the clues with the remaining blue count at the top',
    hintFallback: 'Start thinking from the highlighted cell',
    concludeBlue: '→ the highlighted cell is blue',
    concludeEmpty: '→ the highlighted cell is empty',
    winTime: 'Time {t}',
    winMistakes: '{n} mistakes · {h} hints',
    perfect: '✨ Perfect clear: zero mistakes!',
    loseBody: '{n} mistakes — the chain of logic broke.\nEvery board is solvable by pure logic. Try again!',
    restartConfirm: 'Current progress will be lost. Back to difficulty select?',
  },
};

type Action = 'reveal' | 'blue';
type Phase = 'start' | 'playing' | 'over';

const REVEAL_DUR = 0.32;
const FLASH_DUR = 0.6;
const LONG_PRESS_MS = 350;
const HINT_DUR = 3.4;
const HINT_PENALTY = 15;
const WIN_DUR = 1.6;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Noto Sans SC', sans-serif";

interface Colors {
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  success: string;
  danger: string;
  warning: string;
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  let mode: Difficulty = ctx.storage.get<Difficulty>('mode', 'easy');
  if (!(mode in DIFFICULTIES)) mode = 'easy';
  let action: Action = ctx.storage.get<Action>('action', 'reveal');
  let cfg = DIFFICULTIES[mode];

  // ── Round state ───────────────────────────────────────────────────────
  let phase: Phase = 'start';
  let puzzle: Puzzle | null = null;
  let state: Uint8Array = new Uint8Array(0);
  let seed = 0;
  let mistakes = 0;
  let hintsUsed = 0;
  let penalty = 0;
  let elapsed = 0;
  let lastStatusSec = -1;

  // ── Animation state ───────────────────────────────────────────────────
  let revealT = new Float32Array(0);
  let flashT = new Float32Array(0);
  let hint: { target: number; sources: number[]; t: number } | null = null;
  let press: { id: number; x: number; y: number; t0: number; fired: boolean } | null = null;
  let pressTimer = 0;
  let finishTimer = 0;
  let pulseTimer = 0;
  let winT = -1;
  let dirty = true;

  // ── DOM / canvas ──────────────────────────────────────────────────────
  let cv: CanvasHandle | null = null;
  let loop: ReturnType<typeof createLoop> | null = null;
  let offPointer: (() => void) | null = null;
  let onCtxMenu: ((e: Event) => void) | null = null;
  let layout: Layout = { size: 20, ox: 0, oy: 0 };
  let fontSize = 16;
  let hudRemaining: HTMLElement | null = null;
  let hudMistakes: HTMLElement | null = null;
  let hudHints: HTMLElement | null = null;
  let modeButtons: HTMLButtonElement[] = [];
  let colors = readColors();

  function readColors(): Colors {
    return {
      surface2: ctx.cssVar('--surface-2') || '#232a39',
      border: ctx.cssVar('--border') || '#2d3548',
      text: ctx.cssVar('--text') || '#e8ecf3',
      muted: ctx.cssVar('--muted') || '#8b94a7',
      accent: ctx.cssVar('--accent') || '#5b8cff',
      accent2: ctx.cssVar('--accent-2') || '#ff7a59',
      success: ctx.cssVar('--success') || '#3ddc97',
      danger: ctx.cssVar('--danger') || '#ff5470',
      warning: ctx.cssVar('--warning') || '#ffc857',
    };
  }

  const removeRestart = ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: onRestart });
  const removeHint = ctx.addHeaderAction({ icon: '💡', label: t('hint'), onClick: giveHint });
  ctx.onDestroy(() => {
    removeRestart();
    removeHint();
    teardownGame();
  });
  ctx.onVisibility((visible) => {
    if (!loop) return;
    if (visible) loop.start();
    else loop.stop();
  });
  ctx.onThemeChange(() => {
    colors = readColors();
    dirty = true;
  });

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    teardownGame();
    phase = 'start';
    root.innerHTML = '';
    ctx.setStatus('');
    const descLine = el('p', { class: 'muted small' });
    const bestLine = el('p', { class: 'muted' });
    const refresh = () => {
      const c = DIFFICULTIES[mode];
      descLine.textContent = t('modeDesc', { cols: c.cols, rows: c.rows, pct: Math.round(c.blueRatio * 100), m: c.maxMistakes });
      const best = ctx.storage.getBest(mode);
      const perfect = ctx.storage.get<number>('perfect:' + mode, 0);
      bestLine.textContent = best === null ? t('noBest') : t('bestLine', { t: formatTime(best), n: perfect });
    };
    refresh();
    root.append(
      el(
        'div',
        { class: 'start-screen' },
        el('div', { class: 'big-icon', text: '🔶' }),
        el('h2', { text: t('chooseDifficulty') }),
        el('p', { class: 'muted', text: t('desc') }),
        segmented<Difficulty>(
          [
            { value: 'easy', label: t('easy') },
            { value: 'medium', label: t('medium') },
            { value: 'hard', label: t('hard') },
          ],
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            refresh();
          },
        ),
        descLine,
        bestLine,
        button(t('play'), () => startGame(), { variant: 'primary', size: 'lg' }),
      ),
    );
  }

  // ── Game screen ───────────────────────────────────────────────────────
  function startGame(useSeed?: number): void {
    teardownGame();
    cfg = DIFFICULTIES[mode];
    seed = useSeed ?? (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    puzzle = generatePuzzle(mode, seed);
    state = initialState(puzzle);
    revealT = new Float32Array(state.length);
    flashT = new Float32Array(state.length);
    mistakes = 0;
    hintsUsed = 0;
    penalty = 0;
    elapsed = 0;
    lastStatusSec = -1;
    hint = null;
    press = null;
    winT = -1;
    dirty = true;
    phase = 'playing';

    root.innerHTML = '';
    const hud = el(
      'div',
      { class: 'game-hud hx-hud' },
      stat(t('remaining'), (e) => (hudRemaining = e), 'hx-blue'),
      stat(t('mistakes'), (e) => (hudMistakes = e)),
      stat(t('hints'), (e) => (hudHints = e)),
    );
    const area = el('div', { class: 'game-area hx-area' });
    modeButtons = [modeButton('reveal'), modeButton('blue')];
    const controls = el(
      'div',
      { class: 'hx-controls' },
      el('div', { class: 'hx-modes', role: 'radiogroup' }, ...modeButtons),
      el('p', { class: 'hx-tip', text: t('longPress') }),
    );
    root.append(hud, area, controls);
    updateModeButtons();
    updateHud();
    updateStatus(true);

    cv = createCanvas(area, (w, h) => relayout(w, h));
    onCtxMenu = (e: Event) => e.preventDefault();
    cv.canvas.addEventListener('contextmenu', onCtxMenu);
    offPointer = onPointer(cv.canvas, {
      down(p) {
        if (phase !== 'playing' || !puzzle) return;
        const id = pickCell(puzzle, layout, p.x, p.y);
        if (id < 0 || state[id] !== HIDDEN) return;
        cancelPress();
        press = { id, x: p.x, y: p.y, t0: performance.now(), fired: false };
        pressTimer = window.setTimeout(() => {
          if (!press || press.fired) return;
          press.fired = true;
          const id2 = press.id;
          press = null;
          ctx.haptic('medium');
          act(id2, action === 'reveal');
        }, LONG_PRESS_MS);
        dirty = true;
      },
      move(p) {
        if (!press || press.fired) return;
        const dx = p.x - press.x;
        const dy = p.y - press.y;
        if (dx * dx + dy * dy > 14 * 14) cancelPress();
      },
      up() {
        if (press && !press.fired) {
          const id = press.id;
          cancelPress();
          act(id, action === 'blue');
        } else {
          cancelPress();
        }
      },
      cancel() {
        cancelPress();
      },
    });
    loop = createLoop(update);
    loop.start();
  }

  function stat(label: string, ref: (e: HTMLElement) => void, cls = ''): HTMLElement {
    const value = el('div', { class: 'stat-value ' + cls, text: '0' });
    ref(value);
    return el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: label }), value);
  }

  function modeButton(a: Action): HTMLButtonElement {
    const icon =
      a === 'reveal'
        ? el('span', { class: 'hx-ico hx-ico-reveal' }, el('span', { text: '?' }))
        : el('span', { class: 'hx-ico hx-ico-blue' });
    const b = el('button', { class: 'hx-mode', type: 'button', role: 'radio', dataset: { act: a } }, icon, el('span', { text: t(a === 'reveal' ? 'modeReveal' : 'modeBlue') }));
    b.addEventListener('click', () => {
      if (action === a) return;
      action = a;
      ctx.storage.set('action', a);
      ctx.play('tap');
      ctx.haptic('light');
      updateModeButtons();
    });
    return b;
  }

  function updateModeButtons(): void {
    for (const b of modeButtons) {
      const on = b.dataset.act === action;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  function relayout(w: number, h: number): void {
    if (!puzzle) return;
    layout = layoutGrid(puzzle, w, h, 10);
    fontSize = Math.max(14, Math.min(30, Math.round(layout.size * 0.85)));
    dirty = true;
  }

  function cancelPress(): void {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = 0;
    }
    if (press) {
      press = null;
      dirty = true;
    }
  }

  function teardownGame(): void {
    cancelPress();
    if (finishTimer) {
      clearTimeout(finishTimer);
      finishTimer = 0;
    }
    if (pulseTimer) {
      clearTimeout(pulseTimer);
      pulseTimer = 0;
    }
    loop?.stop();
    loop = null;
    offPointer?.();
    offPointer = null;
    if (cv && onCtxMenu) cv.canvas.removeEventListener('contextmenu', onCtxMenu);
    onCtxMenu = null;
    cv?.destroy();
    cv = null;
    hudRemaining = hudMistakes = hudHints = null;
    modeButtons = [];
  }

  // ── HUD / status ──────────────────────────────────────────────────────
  function updateHud(): void {
    if (!puzzle) return;
    if (hudRemaining) hudRemaining.textContent = String(remainingBlue(puzzle, state));
    if (hudMistakes) {
      hudMistakes.textContent = `${mistakes} / ${cfg.maxMistakes}`;
      hudMistakes.classList.toggle('hx-bad', mistakes > 0);
    }
    if (hudHints) hudHints.textContent = String(hintsUsed);
  }

  function updateStatus(force = false): void {
    const sec = Math.floor(elapsed + penalty);
    if (!force && sec === lastStatusSec) return;
    lastStatusSec = sec;
    ctx.setStatus(`${t(mode)} · ${formatTime(sec)}`);
  }

  // ── Actions ───────────────────────────────────────────────────────────
  function act(id: number, markBlue: boolean): void {
    if (phase !== 'playing' || !puzzle || state[id] !== HIDDEN) return;
    const correct = applyMark(puzzle, state, id, markBlue);
    revealT[id] = REVEAL_DUR;
    if (correct) {
      ctx.play(puzzle.blue[id] ? 'place' : 'pop');
      ctx.haptic('light');
    } else {
      mistakes++;
      flashT[id] = FLASH_DUR;
      ctx.play('error');
      ctx.haptic('error');
    }
    if (hint && hint.target === id) hint = null;
    updateHud();
    dirty = true;
    if (mistakes >= cfg.maxMistakes) finish(false);
    else if (isComplete(state)) finish(true);
  }

  function giveHint(): void {
    if (phase !== 'playing' || !puzzle) return;
    cancelPress();
    const d: Deduction | null = findDeduction(puzzle, state, cfg.rules) ?? findDeduction(puzzle, state, 'advanced');
    let target: number;
    let sources: number[] = [];
    let text: string;
    if (d) {
      target = d.cells[0];
      sources = d.sources.filter((s) => s >= 0);
      const clueCell = sources.length ? sources[0] : -1;
      const n = clueCell >= 0 ? puzzle.clue[clueCell] : 0;
      const key =
        d.rule === 'satisfied'
          ? 'hintSatisfied'
          : d.rule === 'saturated'
            ? 'hintSaturated'
            : d.rule === 'subset'
              ? 'hintSubset'
              : d.rule === 'overlap'
                ? 'hintOverlap'
                : 'hintGlobal';
      text = `${t(key, { n })} ${t(d.blue ? 'concludeBlue' : 'concludeEmpty')}`;
      if (d.sources.includes(-1) && hudRemaining) {
        const statEl = hudRemaining.parentElement;
        if (statEl) {
          statEl.classList.remove('hx-pulse');
          void statEl.offsetWidth; // restart the CSS animation
          statEl.classList.add('hx-pulse');
          if (pulseTimer) clearTimeout(pulseTimer);
          pulseTimer = window.setTimeout(() => statEl.classList.remove('hx-pulse'), 2600);
        }
      }
    } else {
      // Should never happen (generator guarantees a logical path), but never leave the player stuck.
      const hidden: number[] = [];
      for (let i = 0; i < state.length; i++) if (state[i] === HIDDEN) hidden.push(i);
      if (!hidden.length) return;
      target = hidden[Math.floor(Math.random() * hidden.length)];
      text = `${t('hintFallback')} ${t(puzzle.blue[target] ? 'concludeBlue' : 'concludeEmpty')}`;
    }
    hintsUsed++;
    penalty += HINT_PENALTY;
    hint = { target, sources, t: HINT_DUR };
    ctx.play('tick');
    ctx.haptic('light');
    updateHud();
    updateStatus(true);
    ctx.toast(`${t('hintPenalty')} · ${text}`, 3800);
    dirty = true;
  }

  function onRestart(): void {
    if (phase === 'playing') {
      ctx.showModal({
        title: t('restart'),
        body: t('restartConfirm'),
        buttons: [{ label: t('cancel') }, { label: t('confirm'), primary: true, onClick: () => showStart() }],
      });
    } else {
      showStart();
    }
  }

  function finish(won: boolean): void {
    if (!puzzle) return;
    phase = 'over';
    cancelPress();
    hint = null;
    updateStatus(true);
    const total = Math.round(elapsed + penalty);
    if (won) {
      winT = 0;
      ctx.play('win');
      ctx.haptic('success');
      const isBest = ctx.storage.recordBest(mode, total, 'lower');
      const perfect = mistakes === 0;
      if (perfect) ctx.storage.set('perfect:' + mode, ctx.storage.get<number>('perfect:' + mode, 0) + 1);
      const cellCount = puzzle.cells.length;
      finishTimer = window.setTimeout(() => {
        finishTimer = 0;
        const body = el(
          'div',
          { class: 'hx-result' },
          el('div', { class: 'hx-big', text: formatTime(total) }),
          el('p', { text: `${t(mode)} · ${cfg.cols}×${cfg.rows} · ${cellCount} ⬡` }),
          el('p', { text: t('winMistakes', { n: mistakes, h: hintsUsed }) }),
          perfect ? el('p', { class: 'hx-perfect', text: t('perfect') }) : null,
          isBest ? el('p', { class: 'hx-best', text: '🏆 ' + t('newBest') }) : null,
        );
        ctx.showModal({
          title: t('congratulations'),
          body,
          dismissible: false,
          buttons: [
            { label: t('home'), onClick: () => ctx.exit() },
            { label: t('newGame'), primary: true, onClick: () => startGame() },
          ],
        });
      }, 900);
    } else {
      ctx.play('lose');
      ctx.haptic('error');
      const replaySeed = seed;
      finishTimer = window.setTimeout(() => {
        finishTimer = 0;
        ctx.showModal({
          title: t('lose'),
          body: `${t('loseBody', { n: mistakes })}\n${t('winTime', { t: formatTime(total) })}`,
          dismissible: false,
          buttons: [
            { label: t('home'), onClick: () => ctx.exit() },
            { label: t('retry'), onClick: () => startGame(replaySeed) },
            { label: t('newGame'), primary: true, onClick: () => startGame() },
          ],
        });
      }, 650);
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────
  function update(dt: number): void {
    let anim = false;
    if (phase === 'playing') {
      elapsed += dt;
      updateStatus();
    }
    for (let i = 0; i < revealT.length; i++) {
      if (revealT[i] > 0) {
        revealT[i] = Math.max(0, revealT[i] - dt);
        anim = true;
      }
      if (flashT[i] > 0) {
        flashT[i] = Math.max(0, flashT[i] - dt);
        anim = true;
      }
    }
    if (hint) {
      hint.t -= dt;
      if (hint.t <= 0) hint = null;
      anim = true;
    }
    if (press && !press.fired) anim = true;
    if (winT >= 0) {
      winT += dt;
      if (winT > WIN_DUR) winT = -1;
      anim = true;
    }
    if (dirty || anim) {
      draw();
      dirty = false;
    }
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    const pts = hexPoints(cx, cy, r);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < 6; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }

  function cellScale(id: number, col: number, row: number): number {
    let s = 1;
    if (revealT[id] > 0) {
      const p = 1 - revealT[id] / REVEAL_DUR;
      s += 0.22 * Math.sin(Math.PI * p);
    }
    if (winT >= 0 && puzzle) {
      const ph = (col / puzzle.cols) * 0.9 + (row / puzzle.rows) * 0.3;
      const u = (winT - ph) * 5;
      if (u > 0 && u < Math.PI) s += 0.14 * Math.sin(u);
    }
    return s;
  }

  function drawCell(g: CanvasRenderingContext2D, id: number, col: number, row: number, scale: number): void {
    if (!puzzle) return;
    const { x, y } = cellCenter(col, row, layout);
    let cx = x;
    const cy = y;
    const f = flashT[id];
    if (f > 0) cx += Math.sin(f * 60) * 3 * (f / FLASH_DUR);
    const rr = layout.size * 0.92 * scale;
    const st = state[id];
    hexPath(g, cx, cy, rr);
    if (st === HIDDEN) {
      g.fillStyle = colors.warning;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(0,0,0,0.2)';
      g.stroke();
    } else if (st === BLUE) {
      g.fillStyle = colors.accent;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.stroke();
    } else {
      g.fillStyle = colors.surface2;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = colors.border;
      g.stroke();
      const n = puzzle.clue[id];
      g.fillStyle = n === 0 ? colors.muted : colors.text;
      g.fillText(String(n), cx, cy + fontSize * 0.06);
    }
    if (f > 0) {
      const k = f / FLASH_DUR; // 1 → 0
      hexPath(g, cx, cy, rr);
      g.globalAlpha = k > 0.6 ? 0.95 : (k / 0.6) * 0.95;
      g.fillStyle = colors.danger;
      g.fill();
      g.globalAlpha = Math.min(1, k * 1.5);
      g.lineWidth = 3;
      g.strokeStyle = colors.danger;
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  function draw(): void {
    if (!cv || !puzzle) return;
    const g = cv.ctx;
    g.clearRect(0, 0, cv.width, cv.height);
    g.font = `700 ${fontSize}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const animated: number[] = [];
    for (const c of puzzle.cells) {
      const s = cellScale(c.id, c.col, c.row);
      if (s !== 1 || flashT[c.id] > 0) {
        animated.push(c.id);
        continue;
      }
      drawCell(g, c.id, c.col, c.row, 1);
    }
    for (const id of animated) {
      const c = puzzle.cells[id];
      drawCell(g, id, c.col, c.row, cellScale(id, c.col, c.row));
    }
    if (hint) {
      const pulse = 0.98 + 0.07 * Math.sin((HINT_DUR - hint.t) * 7);
      const fade = Math.min(1, hint.t / 0.4);
      g.globalAlpha = fade;
      g.lineWidth = 3;
      g.strokeStyle = colors.success;
      for (const s of hint.sources) {
        const c = puzzle.cells[s];
        const { x, y } = cellCenter(c.col, c.row, layout);
        hexPath(g, x, y, layout.size * 0.92);
        g.stroke();
      }
      const tc = puzzle.cells[hint.target];
      const { x, y } = cellCenter(tc.col, tc.row, layout);
      g.lineWidth = 3.5;
      g.strokeStyle = colors.text;
      g.setLineDash([6, 4]);
      hexPath(g, x, y, layout.size * 1.04 * pulse);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    if (press && !press.fired) {
      const p = (performance.now() - press.t0) / LONG_PRESS_MS;
      if (p > 0.12) {
        const c = puzzle.cells[press.id];
        const { x, y } = cellCenter(c.col, c.row, layout);
        g.beginPath();
        g.arc(x, y, layout.size * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p));
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.strokeStyle = action === 'reveal' ? colors.accent : colors.surface2;
        g.stroke();
        g.lineCap = 'butt';
      }
    }
  }

  // Dev-only inspection hook for the Playwright interaction script (stripped from production builds).
  if (import.meta.env.DEV) {
    const w = window as unknown as { __hx?: unknown };
    w.__hx = () => ({ puzzle, state: Array.from(state), layout, phase, mistakes, hintsUsed, action });
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
