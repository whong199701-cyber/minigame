import type { GameContext, GameInstance, GameModule } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import { createCanvas, createLoop, onPointer, type CanvasHandle } from '../../app/canvas';
import {
  BLUE,
  DIFFICULTIES,
  HIDDEN,
  HINT_PENALTY,
  MISTAKE_PENALTY,
  applyMark,
  cellCenter,
  cellRect,
  chooseBannerSide,
  findDeduction,
  generatePuzzle,
  hexPoints,
  hintFocus,
  hintKind,
  initialState,
  isComplete,
  layoutGrid,
  orderForHint,
  pickCell,
  remainingBlue,
  totalTime,
  type Deduction,
  type Difficulty,
  type HintKind,
  type Layout,
  type Puzzle,
} from './logic';
import './style.css';

const strings = {
  zh: {
    rules:
      '网格中的每个格子要么是蓝色，要么是空白。\n翻开的空白格会显示数字：周围 6 格里有几个蓝格。\n选择「翻开」或「标蓝」，再点橙色格子；长按格子执行相反操作。\n判断错误记一次失误并罚时 30 秒，格子会显示真实状态。\n「剩余蓝格」计数也是线索，收尾时尤其有用。\n每一关都能纯靠逻辑解开，无需猜测；卡住时可用 💡 提示（罚时 15 秒）。\n解开所有格子即获胜：用时越短越好，零失误记为一次完美。',
    desc: '纯逻辑的六边形排雷，无需猜测',
    modeDesc: '{cols}×{rows} · 约 {pct}% 蓝格 · 失误罚时 {mp} 秒',
    modeReveal: '翻开',
    modeBlue: '标蓝',
    longPress: '长按格子执行相反操作',
    remaining: '剩余蓝格',
    mistakes: '失误',
    hints: '提示',
    bestLine: '最佳 {t} · 完美 {n} 次',
    noBest: '尚无记录',
    hintTitle: '💡 提示 · 罚时 {p} 秒',
    hintZero: '数字 0 周围一个蓝格都没有，所以它的邻居全是空白',
    hintSatisfied: '数字 {n} 周围的蓝格已经找齐，其余邻居都是空白',
    hintSaturated: '数字 {n} 还缺的蓝格数正好等于它周围未知格的数量，所以它们全是蓝色',
    hintSubset: '一个线索的未知格全部包含在另一个线索里，比较两者相差的格子和蓝格数',
    hintOverlap: '两个线索有重叠区域：先推算重叠部分最多、最少能有几个蓝格',
    hintGlobal: '把线索和「剩余蓝格」总数（{r}）结合起来判断',
    hintFallback: '从高亮的格子开始思考',
    concludeBlue: '→ 虚线框的格子是蓝色',
    concludeEmpty: '→ 虚线框的格子是空白',
    winMistakes: '失误 {n} 次 · 提示 {h} 次',
    winPenalty: '含罚时 +{p} 秒',
    perfect: '✨ 完美通关：零失误！',
    restartConfirm: '当前进度将丢失，返回难度选择？',
  },
  en: {
    rules:
      'Every cell is either blue or empty.\nA revealed empty cell shows how many of its 6 neighbours are blue.\nChoose Reveal or Mark blue, then tap an orange cell; long-press a cell to do the opposite.\nA wrong call is a mistake: +30 s, and the cell shows its true state.\nThe blue-left count is a clue too, especially near the end.\nEvery board can be solved by pure logic, so never guess; tap 💡 when stuck (+15 s).\nResolve every cell to win. Faster is better, and zero mistakes counts as a perfect clear.',
    desc: 'Pure-logic hex minesweeper, no guessing',
    modeDesc: '{cols}×{rows} · ~{pct}% blue · mistake +{mp} s',
    modeReveal: 'Reveal',
    modeBlue: 'Mark blue',
    longPress: 'Long-press a cell for the opposite action',
    remaining: 'Blue left',
    mistakes: 'Mistakes',
    hints: 'Hints',
    bestLine: 'Best {t} · Perfect ×{n}',
    noBest: 'No record yet',
    hintTitle: '💡 Hint · +{p} s',
    hintZero: 'A 0 has no blue neighbours at all, so every cell around it is empty',
    hintSatisfied: 'Clue {n} already has all its blues, so its other neighbours are empty',
    hintSaturated: 'Clue {n} needs exactly as many more blues as it has unknown neighbours, so they are all blue',
    hintSubset: "One clue's unknown cells all sit inside another's: compare the cells and blues they differ by",
    hintOverlap: 'Two clues overlap: work out the most and fewest blues the shared cells can hold',
    hintGlobal: 'Combine the clues with the blue-left count ({r})',
    hintFallback: 'Start thinking from the highlighted cell',
    concludeBlue: '→ the dashed cell is blue',
    concludeEmpty: '→ the dashed cell is empty',
    winMistakes: 'Mistakes: {n} · Hints: {h}',
    winPenalty: 'Includes +{p} s of penalties',
    perfect: '✨ Perfect clear: zero mistakes!',
    restartConfirm: 'Current progress will be lost. Back to difficulty select?',
  },
};

type Action = 'reveal' | 'blue';
type Phase = 'start' | 'playing' | 'over';

const HINT_KEYS: Record<HintKind, string> = {
  zero: 'hintZero',
  satisfied: 'hintSatisfied',
  saturated: 'hintSaturated',
  subset: 'hintSubset',
  overlap: 'hintOverlap',
  global: 'hintGlobal',
};

const REVEAL_DUR = 0.32;
const FLASH_DUR = 0.6;
const LONG_PRESS_MS = 350;
const MOVE_CANCEL_PX = 14;
/** The hint highlight pulses this long, then stays as a static outline until the target is resolved. */
const HINT_PULSE = 2.5;
const WIN_DUR = 1.6;
/** Root wider than this × its height switches to the side-column (landscape) layout. */
const LAND_RATIO = 1.2;
const BANNER_MARGIN = 8;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Noto Sans SC', sans-serif";

interface Colors {
  bg: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  success: string;
  danger: string;
  warning: string;
}

interface Press {
  /** Pointer that started the press: only its own up / cancel / move events count. */
  pointer: number;
  cell: number;
  x: number;
  y: number;
  t0: number;
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  let mode: Difficulty = ctx.storage.get<Difficulty>('mode', 'easy');
  if (!(mode in DIFFICULTIES)) mode = 'easy';
  let action: Action = ctx.storage.get<Action>('action', 'reveal');
  if (action !== 'reveal' && action !== 'blue') action = 'reveal';
  let cfg = DIFFICULTIES[mode];

  // ── Round state ───────────────────────────────────────────────────────
  let phase: Phase = 'start';
  let puzzle: Puzzle | null = null;
  let state: Uint8Array = new Uint8Array(0);
  let mistakes = 0;
  let hintsUsed = 0;
  let elapsed = 0;
  let paused = false;
  let shownTime = -1;

  // ── Animation state ───────────────────────────────────────────────────
  let revealT = new Float32Array(0);
  let flashT = new Float32Array(0);
  let hint: { target: number; sources: number[]; focus: number[]; rule: string; age: number } | null = null;
  let press: Press | null = null;
  let pressTimer = 0;
  let finishTimer = 0;
  const pulseTimers = new Map<HTMLElement, number>();
  let winT = -1;
  let dirty = true;

  // ── DOM / canvas ──────────────────────────────────────────────────────
  let cv: CanvasHandle | null = null;
  let loop: ReturnType<typeof createLoop> | null = null;
  let offPointer: (() => void) | null = null;
  let onCtxMenu: ((e: Event) => void) | null = null;
  let rootObserver: ResizeObserver | null = null;
  let removeHint: (() => void) | null = null;
  let layout: Layout = { size: 20, ox: 0, oy: 0 };
  let fontSize = 16;
  let gameEl: HTMLElement | null = null;
  let areaEl: HTMLElement | null = null;
  let bannerEl: HTMLElement | null = null;
  let bannerText: HTMLElement | null = null;
  let bannerTitle: HTMLElement | null = null;
  let hudRemaining: HTMLElement | null = null;
  let hudMistakes: HTMLElement | null = null;
  let hudHints: HTMLElement | null = null;
  let hudTime: HTMLElement | null = null;
  let modeButtons: HTMLButtonElement[] = [];
  let colors = readColors();

  function readColors(): Colors {
    return {
      bg: ctx.cssVar('--bg') || '#0f1218',
      surface2: ctx.cssVar('--surface-2') || '#232a39',
      border: ctx.cssVar('--border') || '#2d3548',
      text: ctx.cssVar('--text') || '#e8ecf3',
      muted: ctx.cssVar('--muted') || '#8b94a7',
      accent: ctx.cssVar('--accent') || '#5b8cff',
      accentText: ctx.cssVar('--accent-text') || '#ffffff',
      success: ctx.cssVar('--success') || '#3ddc97',
      danger: ctx.cssVar('--danger') || '#ff5470',
      warning: ctx.cssVar('--warning') || '#ffc857',
    };
  }

  const removeRestart = ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: onRestart });
  ctx.onDestroy(() => {
    removeRestart();
    teardownGame();
  });
  ctx.onVisibility((visible) => {
    if (!loop) return;
    if (visible) loop.start();
    else {
      cancelPress();
      loop.stop();
    }
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
      descLine.textContent = t('modeDesc', { cols: c.cols, rows: c.rows, pct: Math.round(c.blueRatio * 100), mp: MISTAKE_PENALTY });
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
  function startGame(): void {
    teardownGame();
    cfg = DIFFICULTIES[mode];
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    puzzle = generatePuzzle(mode, seed);
    state = initialState(puzzle);
    revealT = new Float32Array(state.length);
    flashT = new Float32Array(state.length);
    mistakes = 0;
    hintsUsed = 0;
    elapsed = 0;
    paused = false;
    shownTime = -1;
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
      stat(t('time'), (e) => (hudTime = e), 'hx-time'),
    );
    areaEl = el('div', { class: 'game-area hx-area' }, el('div', { class: 'hx-paused-label', text: t('paused') }));
    bannerTitle = el('div', { class: 'hx-banner-title' });
    bannerText = el('div', { class: 'hx-banner-text' });
    bannerEl = el(
      'div',
      { class: 'hx-banner', role: 'status', 'aria-live': 'polite', hidden: true },
      el('div', { class: 'hx-banner-body' }, bannerTitle, bannerText),
      el('button', { class: 'hx-banner-close', type: 'button', 'aria-label': t('close'), text: '×' }),
    );
    bannerEl.addEventListener('click', () => hideBanner());
    modeButtons = [modeButton('reveal'), modeButton('blue')];
    const controls = el(
      'div',
      { class: 'hx-controls' },
      el('div', { class: 'hx-modes', role: 'radiogroup' }, ...modeButtons),
      el('p', { class: 'hx-tip', text: t('longPress') }),
    );
    gameEl = el('div', { class: 'hx-game' }, hud, areaEl, bannerEl, controls);
    root.append(gameEl);
    updateOrientation();
    rootObserver = new ResizeObserver(() => updateOrientation());
    rootObserver.observe(root);
    removeHint = ctx.addHeaderAction({ icon: '💡', label: t('hint'), onClick: giveHint });
    ctx.setStatus(`${t(mode)} · ${cfg.cols}×${cfg.rows}`);
    updateModeButtons();
    updateHud();

    cv = createCanvas(areaEl, (w, h) => relayout(w, h));
    onCtxMenu = (e: Event) => e.preventDefault();
    cv.canvas.addEventListener('contextmenu', onCtxMenu);
    offPointer = onPointer(cv.canvas, {
      down(p) {
        if (phase !== 'playing' || paused || !puzzle) return;
        const id = pickCell(puzzle, layout, p.x, p.y);
        if (id < 0 || state[id] !== HIDDEN) return;
        // A new finger takes over: the earlier press is dropped without acting.
        cancelPress();
        press = { pointer: p.id, cell: id, x: p.x, y: p.y, t0: performance.now() };
        pressTimer = window.setTimeout(() => {
          pressTimer = 0;
          if (!press) return;
          const cell = press.cell;
          press = null;
          dirty = true;
          ctx.haptic('medium');
          act(cell, action === 'reveal');
        }, LONG_PRESS_MS);
        dirty = true;
      },
      move(p) {
        if (!press || p.id !== press.pointer) return;
        const dx = p.x - press.x;
        const dy = p.y - press.y;
        if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) cancelPress();
      },
      up(p) {
        if (!press || p.id !== press.pointer) return;
        const cell = press.cell;
        cancelPress();
        act(cell, action === 'blue');
      },
      cancel(p) {
        if (press && p.id === press.pointer) cancelPress();
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

  /** Wide, short screens get the side-column layout so the board keeps its height. */
  function updateOrientation(): void {
    if (!gameEl) return;
    const r = root.getBoundingClientRect();
    const land = r.width > r.height * LAND_RATIO;
    if (gameEl.classList.contains('hx-land') !== land) gameEl.classList.toggle('hx-land', land);
  }

  function relayout(w: number, h: number): void {
    if (!puzzle) return;
    layout = layoutGrid(puzzle, w, h, 10);
    // ≥14 px whenever the hex can hold it; never larger than the hex itself.
    fontSize = Math.min(30, Math.max(14, Math.round(layout.size * 0.85)), Math.floor(layout.size * 1.25));
    placeBanner();
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
    pulseTimers.forEach((id) => clearTimeout(id));
    pulseTimers.clear();
    loop?.stop();
    loop = null;
    offPointer?.();
    offPointer = null;
    if (cv && onCtxMenu) cv.canvas.removeEventListener('contextmenu', onCtxMenu);
    onCtxMenu = null;
    cv?.destroy();
    cv = null;
    rootObserver?.disconnect();
    rootObserver = null;
    removeHint?.();
    removeHint = null;
    hint = null;
    paused = false;
    gameEl = areaEl = bannerEl = bannerText = bannerTitle = null;
    hudRemaining = hudMistakes = hudHints = hudTime = null;
    modeButtons = [];
  }

  // ── HUD ───────────────────────────────────────────────────────────────
  function currentTime(): number {
    return totalTime(elapsed, hintsUsed, mistakes);
  }

  function updateHud(): void {
    if (!puzzle) return;
    if (hudRemaining) hudRemaining.textContent = String(remainingBlue(puzzle, state));
    if (hudMistakes) {
      hudMistakes.textContent = String(mistakes);
      hudMistakes.classList.toggle('hx-bad', mistakes > 0);
    }
    if (hudHints) hudHints.textContent = String(hintsUsed);
    updateTime(true);
  }

  function updateTime(force = false): void {
    const sec = currentTime();
    if (!force && sec === shownTime) return;
    shownTime = sec;
    if (hudTime) hudTime.textContent = formatTime(sec);
  }

  /** Briefly animate a HUD stat (penalty on the clock, or the blue-left count used by a hint). */
  function pulse(value: HTMLElement | null, cls: string, ms: number): void {
    const statEl = value?.parentElement;
    if (!statEl) return;
    statEl.classList.remove(cls);
    void statEl.offsetWidth; // restart the CSS animation
    statEl.classList.add(cls);
    const prev = pulseTimers.get(statEl);
    if (prev) clearTimeout(prev);
    pulseTimers.set(
      statEl,
      window.setTimeout(() => {
        statEl.classList.remove(cls);
        pulseTimers.delete(statEl);
      }, ms),
    );
  }

  // ── Hint banner ───────────────────────────────────────────────────────
  function showBanner(title: string, text: string): void {
    if (!bannerEl || !bannerTitle || !bannerText) return;
    bannerTitle.textContent = title;
    bannerText.textContent = text;
    bannerEl.hidden = false;
    gameEl?.classList.add('hx-has-banner');
    placeBanner();
  }

  function hideBanner(): void {
    if (!bannerEl || bannerEl.hidden) return;
    bannerEl.hidden = true;
    gameEl?.classList.remove('hx-has-banner');
  }

  /** Portrait: overlay the board at the top or bottom, whichever keeps the hinted cells visible. */
  function placeBanner(): void {
    if (!bannerEl || bannerEl.hidden || !gameEl || !cv || !puzzle) return;
    if (gameEl.classList.contains('hx-land')) {
      bannerEl.classList.remove('hx-bottom');
      return;
    }
    const focus = hint ? hint.focus : [];
    const rects = focus.map((id) => cellRect(puzzle!.cells[id].col, puzzle!.cells[id].row, layout, layout.size * 1.1));
    const side = chooseBannerSide(cv.width, cv.height, bannerEl.offsetWidth, bannerEl.offsetHeight, BANNER_MARGIN, rects);
    bannerEl.classList.toggle('hx-bottom', side === 'bottom');
  }

  // ── Actions ───────────────────────────────────────────────────────────
  function act(id: number, markBlue: boolean): void {
    if (phase !== 'playing' || paused || !puzzle || state[id] !== HIDDEN) return;
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
      pulse(hudTime, 'hx-pulse-bad', 1200);
    }
    if (hint && hint.target === id) {
      hint = null;
      hideBanner();
    }
    updateHud();
    dirty = true;
    if (isComplete(state)) finish();
  }

  function giveHint(): void {
    if (phase !== 'playing' || paused || !puzzle) return;
    cancelPress();
    const found: Deduction | null = findDeduction(puzzle, state, cfg.rules) ?? findDeduction(puzzle, state, 'advanced');
    const d = found && orderForHint(puzzle, found);
    let target: number;
    let sources: number[] = [];
    let focus: number[];
    let text: string;
    if (d) {
      target = d.cells[0];
      sources = d.sources.filter((s) => s >= 0);
      focus = hintFocus(d);
      const kind = hintKind(puzzle, d);
      const n = sources.length ? puzzle.clue[sources[0]] : 0;
      text = `${t(HINT_KEYS[kind], { n, r: remainingBlue(puzzle, state) })} ${t(d.blue ? 'concludeBlue' : 'concludeEmpty')}`;
      if (d.sources.includes(-1)) pulse(hudRemaining, 'hx-pulse', 2600);
    } else {
      // Should never happen (the generator guarantees a logical path), but never leave the player stuck.
      const hidden: number[] = [];
      for (let i = 0; i < state.length; i++) if (state[i] === HIDDEN) hidden.push(i);
      if (!hidden.length) return;
      target = hidden[Math.floor(Math.random() * hidden.length)];
      focus = [target];
      text = `${t('hintFallback')} ${t(puzzle.blue[target] ? 'concludeBlue' : 'concludeEmpty')}`;
    }
    hintsUsed++;
    hint = { target, sources, focus, rule: d ? d.rule : 'fallback', age: 0 };
    ctx.play('tick');
    ctx.haptic('light');
    updateHud();
    pulse(hudTime, 'hx-pulse-bad', 1200);
    showBanner(t('hintTitle', { p: HINT_PENALTY }), text);
    dirty = true;
  }

  function onRestart(): void {
    if (phase === 'playing') {
      // The clock is paused (and the board hidden) while this or any other modal is open; see update().
      ctx.showModal({
        title: t('restart'),
        body: t('restartConfirm'),
        buttons: [{ label: t('cancel') }, { label: t('confirm'), primary: true, onClick: () => showStart() }],
      });
    } else {
      showStart();
    }
  }

  function finish(): void {
    if (!puzzle) return;
    phase = 'over';
    cancelPress();
    hint = null;
    hideBanner();
    // One rounding for the HUD clock, the modal and the stored record.
    const total = currentTime();
    updateTime(true);
    const penalties = hintsUsed * HINT_PENALTY + mistakes * MISTAKE_PENALTY;
    winT = 0;
    ctx.play('win');
    ctx.haptic('success');
    const isBest = ctx.storage.recordBest(mode, total, 'lower');
    const perfect = mistakes === 0;
    if (perfect) ctx.storage.set('perfect:' + mode, ctx.storage.get<number>('perfect:' + mode, 0) + 1);
    const cellCount = puzzle.cells.length;
    const playedMode = mode;
    const playedCfg = cfg;
    finishTimer = window.setTimeout(() => {
      finishTimer = 0;
      const body = el(
        'div',
        { class: 'hx-result' },
        el('div', { class: 'hx-big', text: formatTime(total) }),
        el('p', { text: `${t(playedMode)} · ${playedCfg.cols}×${playedCfg.rows} · ${cellCount} ⬡` }),
        el('p', { text: t('winMistakes', { n: mistakes, h: hintsUsed }) }),
        penalties > 0 ? el('p', { class: 'muted small', text: t('winPenalty', { p: penalties }) }) : null,
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
  }

  // ── Loop ──────────────────────────────────────────────────────────────
  function modalOpen(): boolean {
    return document.querySelector('.modal-backdrop.open:not(.closing)') !== null;
  }

  function update(dt: number): void {
    let anim = false;
    if (phase === 'playing') {
      const p = modalOpen();
      if (p !== paused) {
        paused = p;
        if (paused) cancelPress();
        areaEl?.classList.toggle('hx-paused', paused);
      }
      if (!paused) {
        elapsed += dt;
        updateTime();
      }
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
    if (hint && hint.age < HINT_PULSE) {
      hint.age += dt;
      anim = true;
    }
    if (press) anim = true;
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
    const pts = hexPoints(cx, cy, r, layout.flip);
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
    const lw = Math.max(1, Math.min(2, layout.size / 10));
    hexPath(g, cx, cy, rr);
    if (st === HIDDEN) {
      g.fillStyle = colors.warning;
      g.fill();
      g.lineWidth = lw;
      g.globalAlpha = 0.35;
      g.strokeStyle = colors.bg;
      g.stroke();
      g.globalAlpha = 1;
    } else if (st === BLUE) {
      g.fillStyle = colors.accent;
      g.fill();
      g.lineWidth = lw;
      g.globalAlpha = 0.3;
      g.strokeStyle = colors.accentText;
      g.stroke();
      g.globalAlpha = 1;
    } else {
      g.fillStyle = colors.surface2;
      g.fill();
      g.lineWidth = Math.min(1.5, lw);
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
      const pulsing = hint.age < HINT_PULSE;
      const pulseK = pulsing ? 0.98 + 0.07 * Math.sin(hint.age * 7) : 1;
      g.globalAlpha = Math.min(1, hint.age / 0.15 + 0.2);
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
      const dash = Math.max(3, layout.size * 0.3);
      g.setLineDash([dash, dash * 0.65]);
      hexPath(g, x, y, layout.size * 1.04 * pulseK);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    if (press) {
      const p = (performance.now() - press.t0) / LONG_PRESS_MS;
      if (p > 0.12) {
        const c = puzzle.cells[press.cell];
        const { x, y } = cellCenter(c.col, c.row, layout);
        g.beginPath();
        g.arc(x, y, layout.size * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p));
        g.lineWidth = Math.max(2, Math.min(4, layout.size / 6));
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
    w.__hx = () => ({
      puzzle,
      state: Array.from(state),
      layout,
      fontSize,
      phase,
      mistakes,
      hintsUsed,
      action,
      paused,
      elapsed,
      time: currentTime(),
      hint: hint && { target: hint.target, sources: hint.sources, rule: hint.rule },
    });
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
