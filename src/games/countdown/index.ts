import type { GameContext, GameInstance, GameModule } from '../../app/types';
import { el, segmented, formatTime } from '../../app/ui';
import { createLoop } from '../../app/canvas';
import {
  Board,
  MODES,
  MODE_IDS,
  OPS,
  OP_SYMBOL,
  ROUNDS,
  MAX_LARGE,
  NUM_COUNT,
  LARGE_POOL,
  celebration,
  clampLarge,
  currentStreak,
  exprString,
  formatStep,
  generateRound,
  isPerfect,
  makeResult,
  pointsFor,
  streakMark,
  summarize,
  type Mode,
  type Op,
  type RoundResult,
  type RoundSpec,
  type Tile,
} from './logic';
import './style.css';

const strings = {
  zh: {
    rules:
      '用抽到的 6 个数字和 + − × ÷，在倒计时结束前算出目标数（101–999）。\n' +
      '每回合先选大数个数（0–4 个，来自 25 50 75 100），其余是小数（1–10，每个数各两张）。\n' +
      '点一个数字 → 点运算符 → 再点一个数字，两张牌合并成结果。每个数字最多用一次，不必全部用完。\n' +
      '中间结果必须是正整数：不允许分数、0 或负数。\n' +
      '算出目标数立即结束本回合；否则时间到或点「提交」时，以场上最接近目标的那张数字计分。\n' +
      '计分：正好 10 分 · 差 1–5 得 7 分 · 差 6–10 得 5 分 · 更远 0 分。一局 10 回合，每回合后求解器给出一个最短解法。\n' +
      '轻松 90 秒、标准 60 秒：保证有解。困难 30 秒：目标更难，约 1/5 无精确解。\n' +
      '连击 = 连续正好命中的回合数。无精确解的回合做到理论最接近时，连击不中断，但也不增加。',
    tagline: '六个数字，一个目标',
    desc: '在倒计时内用加减乘除凑出目标数\n一局 10 回合，挑战最高分',
    modeRelaxed: '轻松',
    modeNormal: '标准',
    modeHard: '困难',
    relaxedDesc: '每回合 90 秒 · 保证有解',
    normalDesc: '每回合 60 秒 · 保证有解',
    hardDesc: '每回合 30 秒 · 目标更难，约 1/5 无精确解',
    bestTotal: '最高总分',
    bestStreak: '最长连击',
    noRecord: '暂无',
    target: '目标',
    roundOf: '第 {n}/{total} 回合',
    streak: '连击',
    largeQ: '要几个大数？',
    largeHint: '{l} 个大数 + {s} 个小数',
    largePools: '大数 25 · 50 · 75 · 100　小数 1–10',
    draw: '抽数字',
    lockIn: '提交 {v}',
    reset: '重置',
    steps: '步骤',
    stepsEmpty: '点数字 → 运算符 → 另一个数字',
    closest: '最接近 {v}',
    away: '差 {n}',
    exactShort: '正好',
    pts: '+{n}',
    errNegative: '{expr} 结果为负数',
    errZero: '{expr} 结果为 0',
    errFraction: '{expr} 除不尽',
    pickFirst: '先点一个数字',
    noMoves: '只剩一个数了：撤销，或提交答案',
    tapResume: '点击任意位置继续',
    verdictExact: '正好命中！',
    verdictBest: '理论最佳！',
    verdictClose: '差 {n}',
    verdictFar: '差太远了',
    reasonTime: '时间到',
    reasonLock: '已提交',
    reasonExact: '用时 {t}',
    yourAnswer: '你的答案',
    solverTitle: '最短解法',
    solverNone: '本题无精确解，最接近的是 {v}（差 {n}）',
    nextRound: '下一回合',
    seeResults: '查看总成绩',
    totalSoFar: '总分 {n}',
    gameOver: '本局结束',
    finalExact: '正好命中 {n}/{total}',
    finalStreak: '最长连击 {n}',
    newBestTotal: '新纪录：最高总分！',
    newBestStreak: '新纪录：最长连击！',
    outOf: '满分 {n}',
    opPlus: '加',
    opMinus: '减',
    opTimes: '乘',
    opDivide: '除',
    numberN: '数字 {v}',
    emptySlot: '空位',
  },
  en: {
    rules:
      'Use the six numbers and + − × ÷ to reach the target (101–999) before time runs out.\n' +
      'Each round, choose how many large numbers to draw (0–4, from 25 50 75 100); the rest are small (1–10, two of each).\n' +
      'Tap a number, an operator, then another number: the two merge into the result. Each number can be used once; you need not use them all.\n' +
      'Every intermediate result must be a positive whole number: no fractions, zero or negatives.\n' +
      'Hit the target and the round ends at once. Otherwise, when time runs out or you lock in, the number on the board closest to the target counts.\n' +
      'Scoring: exact 10 · 1–5 away 7 · 6–10 away 5 · further 0. A game is 10 rounds; after each, the solver shows a shortest solution.\n' +
      'Relaxed (90 s) and Normal (60 s) are always solvable. Hard (30 s): about 1 in 5 is impossible.\n' +
      'Streak = exact answers in a row. When no exact answer exists, the best possible one keeps the streak alive without adding to it.',
    tagline: 'Six numbers. One target.',
    desc: 'Reach the target with + − × ÷ before the clock runs out.\n10 rounds per game. Chase a high score.',
    modeRelaxed: 'Relaxed',
    modeNormal: 'Normal',
    modeHard: 'Hard',
    relaxedDesc: '90 s per round · always solvable',
    normalDesc: '60 s per round · always solvable',
    hardDesc: '30 s per round · tougher, ~1 in 5 impossible',
    bestTotal: 'Best total',
    bestStreak: 'Best streak',
    noRecord: 'None yet',
    target: 'Target',
    roundOf: 'Round {n}/{total}',
    streak: 'Streak',
    largeQ: 'How many large numbers?',
    largeHint: '{l} large + {s} small',
    largePools: 'Large 25 · 50 · 75 · 100   Small 1–10',
    draw: 'Draw numbers',
    lockIn: 'Lock in {v}',
    reset: 'Reset',
    steps: 'Steps',
    stepsEmpty: 'Tap a number → an operator → another number',
    closest: 'Closest {v}',
    away: '{n} away',
    exactShort: 'exact',
    pts: '+{n}',
    errNegative: '{expr} would be negative',
    errZero: '{expr} would be zero',
    errFraction: '{expr} is not a whole number',
    pickFirst: 'Tap a number first',
    noMoves: 'One number left: undo or lock it in',
    tapResume: 'Tap anywhere to resume',
    verdictExact: 'Spot on!',
    verdictBest: 'Best possible!',
    verdictClose: '{n} away',
    verdictFar: 'Too far',
    reasonTime: "Time's up",
    reasonLock: 'Locked in',
    reasonExact: 'Solved in {t}',
    yourAnswer: 'Your answer',
    solverTitle: 'Shortest solution',
    solverNone: 'No exact solution exists. The best possible is {v} ({n} away)',
    nextRound: 'Next round',
    seeResults: 'See results',
    totalSoFar: 'Total {n}',
    gameOver: 'Game complete',
    finalExact: 'Exact {n}/{total}',
    finalStreak: 'Longest streak {n}',
    newBestTotal: 'New best total!',
    newBestStreak: 'New best streak!',
    outOf: 'out of {n}',
    opPlus: 'Add',
    opMinus: 'Subtract',
    opTimes: 'Multiply',
    opDivide: 'Divide',
    numberN: 'Number {v}',
    emptySlot: 'Empty slot',
  },
};

type Phase = 'start' | 'pre' | 'reveal' | 'play' | 'ending' | 'result' | 'done';
type EndReason = 'exact' | 'time' | 'lock';

const REVEAL_MS = 1100;
const OP_LABEL: Record<Op, string> = { '+': 'opPlus', '-': 'opMinus', '*': 'opTimes', '/': 'opDivide' };
const MODE_LABEL: Record<Mode, string> = { relaxed: 'modeRelaxed', normal: 'modeNormal', hard: 'modeHard' };

interface GameUI {
  app: HTMLElement;
  hudRound: HTMLElement;
  hudScore: HTMLElement;
  hudStreak: HTMLElement;
  targetCard: HTMLElement;
  targetNum: HTMLElement;
  timerBar: HTMLElement;
  timerFill: HTMLElement;
  timerText: HTMLElement;
  pauseBtn: HTMLButtonElement;
  tiles: HTMLButtonElement[];
  ops: Record<Op, HTMLButtonElement>;
  bottom: HTMLElement;
  lower: HTMLElement;
  playPanel: HTMLElement;
  prePanel: HTMLElement;
  preTitle: HTMLElement;
  lpButtons: HTMLButtonElement[];
  lpHint: HTMLElement;
  drawBtn: HTMLButtonElement;
  steps: HTMLElement;
  stepsPanel: HTMLElement;
  bestChip: HTMLElement;
  msg: HTMLElement;
  undoBtn: HTMLButtonElement;
  resetBtn: HTMLButtonElement;
  lockBtn: HTMLButtonElement;
  fx: HTMLElement;
  sheet: HTMLElement | null;
  pauseOverlay: HTMLElement | null;
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const storedMode = ctx.storage.get<string>('mode', 'normal');
  let mode: Mode = (MODE_IDS as readonly string[]).includes(storedMode) ? (storedMode as Mode) : 'normal';
  let large = clampLarge(ctx.storage.get<number>('large', 1));

  let phase: Phase = 'start';
  let roundNo = 0;
  let results: RoundResult[] = [];
  let spec: RoundSpec | null = null;
  let board: Board | null = null;
  let selected: number | null = null;
  /** True right after a merge: the result is pre-selected for chaining. */
  let softSel = false;
  let pendingOp: Op | null = null;
  let deadline = 0;
  let remainingMs = 0;
  let revealStart = 0;
  let pausedAt = 0;
  let paused = false;
  /** The restart confirmation is open; it holds the pause so nothing may resume the clock behind it. */
  let confirmOpen = false;
  let lastSec = -1;
  let usedMs = 0;
  let lastRoll = 0;
  let renderedMoves = 0;
  let prepared: { key: string; spec: RoundSpec } | null = null;
  let prepareTimer = 0;
  let ui: GameUI | null = null;
  let destroyed = false;

  // ── Timers & animation helpers ────────────────────────────────────────────
  const timeouts = new Set<number>();
  const later = (fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      if (!destroyed) fn();
    }, ms);
    timeouts.add(id);
    return id;
  };
  const cancelLater = (id: number) => {
    clearTimeout(id);
    timeouts.delete(id);
  };
  const clearAllLater = () => {
    timeouts.forEach((id) => clearTimeout(id));
    timeouts.clear();
  };
  const anim = (node: Element | null | undefined, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null => {
    if (!node || reduceMotion || typeof (node as HTMLElement).animate !== 'function') return null;
    try {
      return (node as HTMLElement).animate(frames, opts);
    } catch {
      return null;
    }
  };

  const loop = createLoop((_dt, now) => frame(now));

  /** Short inline notice over the steps header (keeps the controls below unobstructed). */
  let msgTimer = 0;
  const flash = (text: string, tone: 'error' | 'info') => {
    if (!ui) return;
    cancelLater(msgTimer);
    ui.msg.textContent = text;
    ui.msg.className = `cd-msg cd-msg-${tone} cd-show`;
    // The header underneath fades out so its text never shows through the notice.
    ui.stepsPanel.classList.add('cd-msg-on');
    const { msg: m, stepsPanel: panel } = ui;
    msgTimer = later(() => {
      m.classList.remove('cd-show');
      panel.classList.remove('cd-msg-on');
    }, 2000);
  };

  const clearSel = () => {
    selected = null;
    softSel = false;
    pendingOp = null;
  };
  const seconds = () => MODES[mode].seconds;
  const totalScore = () => results.reduce((s, r) => s + r.points, 0);
  const streakNow = () => currentStreak(results.map(streakMark));
  /** The player's answer: the tile on the board closest to the target (what is scored). */
  const answerTile = (): Tile | null => (board && spec ? board.closest(spec.target) : null);

  // ── Header ────────────────────────────────────────────────────────────────
  const removeRestart = ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: () => askRestart() });

  function askRestart(): void {
    if (phase === 'start') return;
    if (phase === 'done') {
      showStart();
      return;
    }
    if (confirmOpen) return;
    const wasPaused = paused;
    // Stop the clock AND hide the board: otherwise the dialog would be free thinking time.
    pause(true);
    confirmOpen = true;
    ctx.showModal({
      title: t('restart'),
      body: t('quitConfirm'),
      dismissible: false,
      buttons: [
        {
          label: t('cancel'),
          onClick: () => {
            confirmOpen = false;
            if (!wasPaused) resume();
          },
        },
        {
          label: t('confirm'),
          primary: true,
          onClick: () => {
            confirmOpen = false;
            showStart();
          },
        },
      ],
    });
  }

  // ── Start screen ──────────────────────────────────────────────────────────
  function stopRound(): void {
    loop.stop();
    clearAllLater();
    paused = false;
    confirmOpen = false;
    prepared = null;
    ui = null;
  }

  function showStart(): void {
    stopRound();
    phase = 'start';
    root.innerHTML = '';
    ctx.setStatus('');
    const desc = el('p', { class: 'cd-mode-desc', text: t(mode + 'Desc') });
    const recTotal = el('div', { class: 'cd-rec-value' });
    const recStreak = el('div', { class: 'cd-rec-value' });
    const updateRecords = () => {
      const b = ctx.storage.getBest(mode);
      const s = ctx.storage.getBest(mode + 'Streak');
      recTotal.textContent = b === null ? t('noRecord') : `${b}`;
      recStreak.textContent = s === null ? t('noRecord') : `🔥 ${s}`;
      recTotal.classList.toggle('cd-rec-none', b === null);
      recStreak.classList.toggle('cd-rec-none', s === null);
    };
    updateRecords();
    const playBtn = el('button', { class: 'btn btn-primary btn-lg cd-play-btn', type: 'button', text: t('play') });
    playBtn.addEventListener('click', () => {
      ctx.play('tap');
      ctx.haptic('light');
      startGame();
    });
    root.append(
      el(
        'div',
        { class: 'start-screen cd-start' },
        el('div', { class: 'big-icon', text: '🔢' }),
        el('h2', { text: t('tagline') }),
        el('p', { class: 'muted cd-start-desc', text: t('desc') }),
        el('div', { class: 'cd-sample', 'aria-hidden': 'true' }, ...['75', '×', '8', '+', '3', '=', '603'].map((s, i) => el('span', { class: i % 2 ? 'cd-sample-op' : 'cd-sample-num', text: s }))),
        segmented<Mode>(
          MODE_IDS.map((m) => ({ value: m, label: t(MODE_LABEL[m]) })),
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            desc.textContent = t(m + 'Desc');
            updateRecords();
          },
        ),
        desc,
        el(
          'div',
          { class: 'cd-records' },
          el('div', { class: 'cd-rec' }, el('div', { class: 'cd-rec-label', text: t('bestTotal') }), recTotal),
          el('div', { class: 'cd-rec' }, el('div', { class: 'cd-rec-label', text: t('bestStreak') }), recStreak),
        ),
        playBtn,
      ),
    );
  }

  // ── Game DOM ──────────────────────────────────────────────────────────────
  function buildGame(): GameUI {
    root.innerHTML = '';
    const stat = (label: string) => {
      const value = el('span', { class: 'stat-value' });
      return { node: el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), value), value };
    };
    const sRound = stat(t('round'));
    const sScore = stat(t('score'));
    const sStreak = stat(t('streak'));
    const hud = el('div', { class: 'game-hud cd-hud' }, sRound.node, sScore.node, sStreak.node);

    const targetNum = el('div', { class: 'cd-target-num' });
    const timerFill = el('div', { class: 'cd-timer-fill' });
    const timerBar = el('div', { class: 'cd-timer-bar' }, timerFill);
    const timerText = el('div', { class: 'cd-timer-text' });
    const pauseBtn = el('button', { class: 'cd-pause', type: 'button', 'aria-label': t('pause'), title: t('pause'), text: '⏸' });
    pauseBtn.addEventListener('click', () => {
      if (phase !== 'play' || paused) return;
      ctx.play('tap');
      ctx.haptic('light');
      pause(true);
    });
    const targetCard = el(
      'div',
      { class: 'cd-target-card' },
      el('div', { class: 'cd-target-meta' }, el('div', { class: 'cd-target-label', text: t('target') }), el('div', { class: 'cd-mode-chip', text: t(MODE_LABEL[mode]) })),
      pauseBtn,
      targetNum,
      el('div', { class: 'cd-timer' }, timerBar, timerText),
    );

    const tiles: HTMLButtonElement[] = [];
    const tileGrid = el('div', { class: 'cd-tiles' });
    for (let i = 0; i < NUM_COUNT; i++) {
      const b = el('button', { class: 'cd-tile', type: 'button' });
      b.addEventListener('click', () => onTile(i));
      tiles.push(b);
      tileGrid.append(el('div', { class: 'cd-slot' }, b));
    }

    const ops = {} as Record<Op, HTMLButtonElement>;
    const opRow = el('div', { class: 'cd-ops' });
    for (const op of OPS) {
      const b = el('button', { class: 'cd-op', type: 'button', 'aria-label': t(OP_LABEL[op]), text: OP_SYMBOL[op] });
      b.addEventListener('click', () => onOp(op));
      ops[op] = b;
      opRow.append(b);
    }

    const bestChip = el('div', { class: 'cd-best' });
    const steps = el('div', { class: 'cd-steps-list' });
    const msg = el('div', { class: 'cd-msg', role: 'status', 'aria-live': 'polite' });
    const stepsPanel = el('div', { class: 'cd-steps' }, el('div', { class: 'cd-steps-head' }, el('span', { class: 'cd-steps-title', text: t('steps') }), bestChip), steps, msg);

    const mkBtn = (cls: string, label: string, icon: string, fn: () => void) => {
      const b = el('button', { class: `btn btn-lg ${cls}`, type: 'button', 'aria-label': label.trim() }, icon ? el('span', { class: 'btn-icon', text: icon }) : null, el('span', { class: 'cd-btn-label', text: label }));
      b.addEventListener('click', () => {
        if (!b.disabled) fn();
      });
      return b;
    };
    const undoBtn = mkBtn('btn-secondary cd-ctl', t('undo'), '↶', () => undo());
    const resetBtn = mkBtn('btn-secondary cd-ctl', t('reset'), '⟲', () => resetBoard());
    const lockBtn = mkBtn('btn-primary cd-lock', t('lockIn', { v: '' }), '✓', () => lockIn());
    const controls = el('div', { class: 'cd-controls' }, undoBtn, resetBtn, lockBtn);
    const playPanel = el('div', { class: 'cd-play' }, opRow, stepsPanel, controls);

    // Pre-round panel: choose the number of large numbers, then draw.
    const preTitle = el('div', { class: 'cd-pre-title' });
    const lpHint = el('div', { class: 'cd-lp-hint' });
    const lpButtons: HTMLButtonElement[] = [];
    const lpRow = el('div', { class: 'cd-lp', role: 'radiogroup', 'aria-label': t('largeQ') });
    for (let n = 0; n <= MAX_LARGE; n++) {
      const b = el('button', { class: 'cd-lp-btn', type: 'button', role: 'radio', text: String(n) });
      b.addEventListener('click', () => setLarge(n));
      lpButtons.push(b);
      lpRow.append(b);
    }
    const drawBtn = el('button', { class: 'btn btn-primary btn-lg cd-draw', type: 'button', text: t('draw') });
    drawBtn.addEventListener('click', () => draw());
    const prePanel = el(
      'div',
      { class: 'cd-pre' },
      preTitle,
      el('div', { class: 'cd-pre-q', text: t('largeQ') }),
      lpRow,
      lpHint,
      el('div', { class: 'cd-pre-pools muted', text: t('largePools') }),
      drawBtn,
    );

    const bottom = el('div', { class: 'cd-bottom' }, playPanel, prePanel);
    const lower = el('div', { class: 'cd-lower' }, tileGrid, bottom);
    const fx = el('div', { class: 'cd-fx', 'aria-hidden': 'true' });
    const app = el('div', { class: 'cd-app' }, hud, targetCard, lower, fx);
    root.append(app);
    return {
      app,
      hudRound: sRound.value,
      hudScore: sScore.value,
      hudStreak: sStreak.value,
      targetCard,
      targetNum,
      timerBar,
      timerFill,
      timerText,
      pauseBtn,
      tiles,
      ops,
      bottom,
      lower,
      playPanel,
      prePanel,
      preTitle,
      lpButtons,
      lpHint,
      drawBtn,
      steps,
      stepsPanel,
      bestChip,
      msg,
      undoBtn,
      resetBtn,
      lockBtn,
      fx,
      sheet: null,
      pauseOverlay: null,
    };
  }

  // ── Game flow ─────────────────────────────────────────────────────────────
  function startGame(): void {
    stopRound();
    results = [];
    roundNo = 0;
    ui = buildGame();
    enterPre();
  }

  function enterPre(): void {
    if (!ui) return;
    phase = 'pre';
    spec = null;
    board = null;
    clearSel();
    paused = false;
    renderedMoves = 0;
    ui.targetCard.classList.remove('cd-hit', 'cd-urgent');
    ui.targetNum.textContent = '? ? ?';
    ui.targetNum.classList.add('cd-target-hidden');
    setTimerVisual(1, seconds());
    ui.preTitle.textContent = t('roundOf', { n: roundNo + 1, total: ROUNDS });
    ui.prePanel.hidden = false;
    ui.playPanel.hidden = true;
    renderLarge();
    renderAll();
    ctx.setStatus(t('roundOf', { n: roundNo + 1, total: ROUNDS }));
    anim(ui.prePanel, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
    prepare();
  }

  function setLarge(n: number): void {
    if (phase !== 'pre') return;
    const v = clampLarge(n);
    if (v !== large) {
      large = v;
      ctx.storage.set('large', v);
      prepare();
    }
    ctx.play('tap');
    ctx.haptic('light');
    renderLarge();
  }

  function renderLarge(): void {
    if (!ui) return;
    ui.lpButtons.forEach((b, n) => {
      b.classList.toggle('cd-on', n === large);
      b.setAttribute('aria-checked', String(n === large));
    });
    ui.lpHint.textContent = t('largeHint', { l: large, s: NUM_COUNT - large });
  }

  const roundKey = () => `${mode}|${large}|${roundNo}`;

  /** Generate the next round while the player is still choosing, so Draw is instant. */
  function prepare(): void {
    cancelLater(prepareTimer);
    prepared = null;
    const key = roundKey();
    prepareTimer = later(() => {
      if (phase !== 'pre' || roundKey() !== key) return;
      prepared = { key, spec: generateRound(large, mode) };
    }, 160);
  }

  function draw(): void {
    if (phase !== 'pre' || !ui) return;
    cancelLater(prepareTimer);
    spec = prepared && prepared.key === roundKey() ? prepared.spec : generateRound(large, mode);
    prepared = null;
    board = new Board(spec.numbers);
    clearSel();
    renderedMoves = 0;
    phase = 'reveal';
    revealStart = performance.now();
    lastRoll = 0;
    ui.prePanel.hidden = true;
    ui.playPanel.hidden = false;
    ui.targetNum.classList.remove('cd-target-hidden');
    renderAll();
    ctx.play('swoosh');
    ctx.haptic('light');
    ui.tiles.forEach((b, i) =>
      anim(b, [
        { opacity: 0, transform: 'translateY(18px) rotateX(70deg) scale(0.85)' },
        { opacity: 1, transform: 'none' },
      ], { duration: 340, delay: 60 * i, easing: 'cubic-bezier(.2,.9,.3,1.25)', fill: 'backwards' }),
    );
    anim(ui.playPanel, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    loop.start();
  }

  function frame(now: number): void {
    if (paused || !ui || !spec) return;
    if (phase === 'reveal') {
      const elapsed = now - revealStart;
      if (elapsed >= REVEAL_MS) {
        ui.targetNum.textContent = String(spec.target);
        anim(ui.targetNum, [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1.4)' });
        phase = 'play';
        deadline = now + seconds() * 1000;
        lastSec = -1;
        ctx.play('place');
        ctx.haptic('medium');
        renderAll();
        updateTimer(now);
      } else if (now - lastRoll > 45) {
        lastRoll = now;
        // Digits lock left to right while the rest keep spinning.
        const final = String(spec.target);
        let s = '';
        for (let i = 0; i < final.length; i++) {
          const lockAt = REVEAL_MS * (0.45 + 0.25 * i);
          if (elapsed >= lockAt) s += final[i];
          else s += String(i === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10));
        }
        ui.targetNum.textContent = s;
      }
    } else if (phase === 'play') {
      updateTimer(now);
    }
  }

  function setTimerVisual(frac: number, sec: number): void {
    if (!ui) return;
    ui.timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
    ui.timerText.textContent = formatTime(sec);
    ui.timerBar.classList.toggle('cd-warn', sec <= 10 && sec > 5);
    ui.timerBar.classList.toggle('cd-danger', sec <= 5);
  }

  function updateTimer(now: number): void {
    if (!ui) return;
    remainingMs = Math.max(0, deadline - now);
    const total = seconds() * 1000;
    const sec = Math.ceil(remainingMs / 1000);
    ui.timerFill.style.transform = `scaleX(${remainingMs / total})`;
    if (sec !== lastSec) {
      const first = lastSec < 0;
      lastSec = sec;
      setTimerVisual(remainingMs / total, sec);
      ui.targetCard.classList.toggle('cd-urgent', sec <= 5 && sec > 0);
      ctx.setStatus(`${t('roundOf', { n: roundNo + 1, total: ROUNDS })} · ${formatTime(sec)}`);
      if (!first && sec <= 5 && sec > 0) {
        ctx.play('tick');
        ctx.haptic('light');
      }
    }
    if (remainingMs <= 0) endRound('time');
  }

  function pause(showOverlay: boolean): void {
    if (paused || (phase !== 'play' && phase !== 'reveal')) return;
    paused = true;
    pausedAt = performance.now();
    loop.stop();
    if (showOverlay) showPauseOverlay();
  }

  function resume(): void {
    if (!paused) return;
    const shift = performance.now() - pausedAt;
    deadline += shift;
    revealStart += shift;
    paused = false;
    if (ui?.pauseOverlay) {
      ui.pauseOverlay.remove();
      ui.pauseOverlay = null;
    }
    if (phase === 'play' || phase === 'reveal') loop.start();
  }

  function showPauseOverlay(): void {
    if (!ui || ui.pauseOverlay) return;
    const resumeBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button', text: t('resume') });
    const ov = el(
      'div',
      { class: 'overlay cd-paused', role: 'dialog' },
      el('div', { class: 'cd-paused-icon', text: '⏸' }),
      el('h2', { text: t('paused') }),
      el('p', { class: 'muted', text: t('tapResume') }),
      resumeBtn,
    );
    ov.addEventListener('click', () => {
      ctx.play('tap');
      resume();
    });
    ui.pauseOverlay = ov;
    ui.app.append(ov);
  }

  // ── Player actions ────────────────────────────────────────────────────────
  function onTile(i: number): void {
    if (phase !== 'play' || paused || !board || !ui) return;
    const tile = board.slots[i];
    if (!tile) return;
    if (selected === i && softSel && pendingOp === null) {
      // The fresh result is pre-selected; tapping it confirms rather than toggles it off.
      softSel = false;
      ctx.play('tap');
      ctx.haptic('light');
    } else if (selected === null || pendingOp === null) {
      softSel = false;
      selected = selected === i ? null : i;
      ctx.play('tap');
      ctx.haptic('light');
    } else if (selected === i) {
      clearSel();
      ctx.play('tap');
    } else {
      combine(selected, pendingOp, i);
    }
    renderAll();
  }

  function onOp(op: Op): void {
    if (phase !== 'play' || paused || !board || !ui) return;
    if (selected === null) {
      flash(t('pickFirst'), 'info');
      anim(ui.tiles[0]?.parentElement?.parentElement, [{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }], { duration: 240 });
      return;
    }
    if (board.count < 2) {
      flash(t('noMoves'), 'info');
      return;
    }
    softSel = false;
    pendingOp = pendingOp === op ? null : op;
    ctx.play('tap');
    ctx.haptic('light');
    renderAll();
  }

  function combine(from: number, op: Op, to: number): void {
    if (!board || !ui || !spec) return;
    const a = board.slots[from];
    const b = board.slots[to];
    const res = board.combine(from, op, to);
    if (!res.ok) {
      ctx.play('error');
      ctx.haptic('error');
      const shake: Keyframe[] = [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-7px)' },
        { transform: 'translateX(7px)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' },
      ];
      anim(ui.tiles[to], shake, { duration: 320, easing: 'ease-out' });
      anim(ui.ops[op], shake, { duration: 320, easing: 'ease-out' });
      if (a && b && res.error !== 'invalid') {
        const key = res.error === 'negative' ? 'errNegative' : res.error === 'zero' ? 'errZero' : 'errFraction';
        flash(t(key, { expr: `${a.value} ${OP_SYMBOL[op]} ${b.value}` }), 'error');
      }
      pendingOp = null;
      return;
    }
    ctx.play('place');
    ctx.haptic('light');
    flyGhost(from, to);
    selected = to;
    softSel = true;
    pendingOp = null;
    if (res.tile.value === spec.target) {
      exactHit();
    } else if (board.count === 1) {
      flash(t('noMoves'), 'info');
    }
  }

  /** Animate the first operand flying into the second; the board state is already committed. */
  function flyGhost(from: number, to: number): void {
    if (!ui || reduceMotion) return;
    const src = ui.tiles[from];
    const dst = ui.tiles[to];
    const host = ui.app.getBoundingClientRect();
    const r1 = src.getBoundingClientRect();
    const r2 = dst.getBoundingClientRect();
    const ghost = el('div', { class: 'cd-ghost', text: src.textContent ?? '' });
    Object.assign(ghost.style, {
      left: `${r1.left - host.left}px`,
      top: `${r1.top - host.top}px`,
      width: `${r1.width}px`,
      height: `${r1.height}px`,
    });
    ui.fx.append(ghost);
    const dx = r2.left - r1.left;
    const dy = r2.top - r1.top;
    const a = anim(ghost, [
      { transform: 'translate(0,0) scale(1)', opacity: 0.95 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.55)`, opacity: 0 },
    ], { duration: 230, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    if (a) a.onfinish = () => ghost.remove();
    else ghost.remove();
    later(() => ghost.remove(), 600);
    anim(dst, [{ transform: 'scale(0.7)' }, { transform: 'scale(1.1)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 300, delay: 120, easing: 'ease-out', fill: 'backwards' });
  }

  function undo(): void {
    if (phase !== 'play' || paused || !board || !ui) return;
    const m = board.undo();
    if (!m) return;
    clearSel();
    ctx.play('pop');
    ctx.haptic('light');
    renderAll();
    for (const i of [m.from, m.to]) anim(ui.tiles[i], [{ transform: 'scale(0.75)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 220, easing: 'ease-out' });
  }

  function resetBoard(): void {
    if (phase !== 'play' || paused || !board || !ui) return;
    if (!board.reset()) return;
    clearSel();
    ctx.play('swoosh');
    ctx.haptic('medium');
    renderAll();
    ui.tiles.forEach((b, i) => anim(b, [{ transform: 'scale(0.8)', opacity: 0.3 }, { transform: 'scale(1)', opacity: 1 }], { duration: 240, delay: 25 * i, easing: 'ease-out', fill: 'backwards' }));
  }

  function lockIn(): void {
    if (phase !== 'play' || paused) return;
    endRound('lock');
  }

  function exactHit(): void {
    if (!ui) return;
    phase = 'ending';
    clearSel();
    usedMs = seconds() * 1000 - Math.max(0, deadline - performance.now());
    loop.stop();
    ctx.play('success');
    ctx.haptic('success');
    ui.targetCard.classList.remove('cd-urgent');
    ui.targetCard.classList.add('cd-hit');
    burst();
    later(() => endRound('exact'), 850);
  }

  function burst(): void {
    if (!ui || reduceMotion) return;
    const host = ui.app.getBoundingClientRect();
    const r = ui.targetNum.getBoundingClientRect();
    const cx = r.left - host.left + r.width / 2;
    const cy = r.top - host.top + r.height / 2;
    const colors = ['var(--success)', 'var(--accent)', 'var(--warning)', 'var(--accent-2)'];
    for (let i = 0; i < 18; i++) {
      const p = el('span', { class: 'cd-spark' });
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.background = colors[i % colors.length];
      ui.fx.append(p);
      const ang = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
      const dist = 60 + Math.random() * 70;
      const a = anim(p, [
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(0.3)`, opacity: 0 },
      ], { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' });
      if (a) a.onfinish = () => p.remove();
      later(() => p.remove(), 1200);
    }
  }

  function endRound(reason: EndReason): void {
    if (!ui || !spec) return;
    if (reason === 'exact' ? phase !== 'ending' : phase !== 'play') return;
    if (reason !== 'exact') usedMs = seconds() * 1000 - remainingMs;
    loop.stop();
    paused = false;
    phase = 'result';
    clearSel();
    const ans = answerTile();
    const res = makeResult(spec.target, ans ? ans.value : null, spec.solution.diff);
    results.push(res);
    if (reason === 'time') {
      setTimerVisual(0, 0);
      ui.targetCard.classList.remove('cd-urgent');
      ctx.haptic('heavy');
    } else if (reason === 'lock') {
      ctx.haptic('medium');
    }
    if (reason !== 'exact') ctx.play(res.points > 0 ? 'coin' : 'error');
    renderAll();
    ctx.setStatus(`${t('roundOf', { n: roundNo + 1, total: ROUNDS })} · ${t('totalSoFar', { n: totalScore() })}`);
    showSheet(res, reason);
  }

  function showSheet(res: RoundResult, reason: EndReason): void {
    if (!ui || !spec) return;
    const perfect = isPerfect(res.diff, res.bestDiff);
    let icon: string;
    let title: string;
    let tone: string;
    if (res.diff === 0) {
      icon = '🎯';
      title = t('verdictExact');
      tone = 'exact';
    } else if (perfect) {
      icon = '✨';
      title = t('verdictBest');
      tone = 'best';
    } else if (res.points > 0) {
      icon = '👍';
      title = t('verdictClose', { n: res.diff ?? 0 });
      tone = 'close';
    } else {
      icon = '😬';
      title = t('verdictFar');
      tone = 'far';
    }
    const sub: string[] = [reason === 'exact' ? t('reasonExact', { t: formatTime(usedMs / 1000) }) : reason === 'time' ? t('reasonTime') : t('reasonLock')];
    if (perfect && res.diff) sub.push(t('away', { n: res.diff }));

    const ans = answerTile();
    const answer = ans
      ? el('div', { class: 'cd-answer' }, ans.base ? null : el('span', { class: 'cd-answer-expr', text: `${exprString(ans)} = ` }), el('b', { text: String(ans.value) }))
      : el('div', { class: 'cd-answer', text: '—' });

    const sol = spec.solution;
    const solHead = spec.exact ? t('solverTitle') : t('solverNone', { v: sol.value, n: sol.diff });
    const solList = el('ol', { class: 'cd-sol' + (sol.steps.length >= 3 ? ' cd-sol-2col' : '') }, ...sol.steps.map((s) => el('li', { text: formatStep(s) })));
    if (!sol.steps.length) solList.append(el('li', { text: String(sol.value) }));

    const last = roundNo + 1 >= ROUNDS;
    const nextBtn = el('button', { class: 'btn btn-primary btn-lg cd-next', type: 'button', text: last ? t('seeResults') : t('nextRound') });
    nextBtn.addEventListener('click', () => {
      ctx.play('tap');
      ctx.haptic('light');
      next();
    });
    const streak = streakNow();
    const sheet = el(
      'div',
      { class: `cd-sheet cd-tone-${tone}`, role: 'dialog', 'aria-label': title },
      el(
        'div',
        { class: 'cd-sheet-body' },
        el(
          'div',
          { class: 'cd-sheet-head' },
          el('div', { class: 'cd-verdict-icon', text: icon }),
          el('div', { class: 'cd-verdict' }, el('div', { class: 'cd-verdict-title', text: title }), el('div', { class: 'cd-verdict-sub', text: sub.join(' · ') })),
          el('div', { class: `cd-points cd-p${res.points}`, text: t('pts', { n: res.points }) }),
        ),
        el('div', { class: 'cd-sheet-sec' }, el('div', { class: 'cd-sec-label', text: t('yourAnswer') }), answer),
        el('div', { class: 'cd-sheet-sec' }, el('div', { class: 'cd-sec-label', text: solHead }), solList),
      ),
      el(
        'div',
        { class: 'cd-sheet-foot' },
        el('div', { class: 'cd-foot-total' }, el('span', { text: t('totalSoFar', { n: totalScore() }) }), streak > 0 ? el('span', { class: 'cd-foot-streak', text: `🔥 ${streak}` }) : null),
        nextBtn,
      ),
    );
    ui.sheet?.remove();
    ui.sheet = sheet;
    ui.lower.append(sheet);
    requestAnimationFrame(() => sheet.classList.add('cd-open'));
  }

  function next(): void {
    if (phase !== 'result' || !ui) return;
    ui.sheet?.remove();
    ui.sheet = null;
    roundNo++;
    if (roundNo >= ROUNDS) finishGame();
    else enterPre();
  }

  function finishGame(): void {
    phase = 'done';
    loop.stop();
    const sum = summarize(results);
    // A 0 total is still stored (the start screen shows it) but never celebrated.
    const newTotal = ctx.storage.recordBest(mode, sum.total, 'higher');
    const newStreak = sum.longestStreak > 0 && ctx.storage.recordBest(mode + 'Streak', sum.longestStreak, 'higher');
    const { bestTotal, bestStreak, win } = celebration(sum, newTotal, newStreak);
    ctx.play(win ? 'win' : 'lose');
    ctx.haptic(win ? 'success' : 'medium');
    ctx.setStatus(`${t(MODE_LABEL[mode])} · ${t('totalSoFar', { n: sum.total })}`);
    const bars = el('div', { class: 'cd-bars' });
    results.forEach((r, i) => {
      const h = Math.max(6, r.points * 10);
      bars.append(
        el(
          'div',
          { class: 'cd-bar-col' },
          el('div', { class: 'cd-bar-val', text: String(r.points) }),
          el('div', { class: 'cd-bar-track' }, el('div', { class: `cd-bar cd-p${r.points}`, style: { height: `${h}%` } })),
          el('div', { class: 'cd-bar-idx', text: String(i + 1) }),
        ),
      );
    });
    const body = el(
      'div',
      { class: 'cd-final' },
      el('div', { class: 'cd-final-score' }, el('span', { class: 'cd-final-num', text: String(sum.total) }), el('span', { class: 'cd-final-max', text: t('outOf', { n: sum.maxTotal }) })),
      el('div', { class: 'cd-final-stats' }, el('span', { text: `🎯 ${t('finalExact', { n: sum.exact, total: results.length })}` }), el('span', { text: `🔥 ${t('finalStreak', { n: sum.longestStreak })}` })),
      bestTotal ? el('div', { class: 'cd-final-new', text: `🏆 ${t('newBestTotal')}` }) : null,
      bestStreak ? el('div', { class: 'cd-final-new', text: `🔥 ${t('newBestStreak')}` }) : null,
      bars,
    );
    ctx.showModal({
      title: t('gameOver'),
      body,
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        { label: t('newGame'), primary: true, onClick: () => showStart() },
      ],
    });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function renderAll(): void {
    if (!ui) return;
    renderHud();
    renderTiles();
    renderOps();
    renderSteps();
    renderControls();
  }

  function renderHud(): void {
    if (!ui) return;
    const shown = Math.min(ROUNDS, roundNo + 1);
    ui.hudRound.textContent = `${shown}/${ROUNDS}`;
    ui.hudScore.textContent = String(totalScore());
    const s = streakNow();
    ui.hudStreak.textContent = s > 0 ? `🔥${s}` : '0';
  }

  function renderTiles(): void {
    if (!ui) return;
    const active = phase === 'play';
    for (let i = 0; i < NUM_COUNT; i++) {
      const b = ui.tiles[i];
      const tile = board ? board.slots[i] : null;
      let cls = 'cd-tile';
      if (!board) {
        cls += ' cd-back';
        b.textContent = '';
        b.disabled = true;
        b.setAttribute('aria-label', '?');
      } else if (!tile) {
        cls += ' cd-empty';
        b.textContent = '';
        b.disabled = true;
        b.setAttribute('aria-label', t('emptySlot'));
      } else {
        const txt = String(tile.value);
        cls += tile.base ? (LARGE_POOL.includes(tile.value) ? ' cd-large' : ' cd-small') : ' cd-result';
        if (txt.length >= 4) cls += ` cd-len${Math.min(8, txt.length)}`;
        if (selected === i) cls += ' cd-sel';
        if (spec && tile.value === spec.target) cls += ' cd-goal';
        if (!active) cls += ' cd-idle';
        b.textContent = txt;
        b.disabled = false;
        b.setAttribute('aria-label', t('numberN', { v: txt }));
        b.setAttribute('aria-pressed', String(selected === i));
      }
      if (!tile || !board) b.removeAttribute('aria-pressed');
      if (b.className !== cls) b.className = cls;
    }
  }

  function renderOps(): void {
    if (!ui) return;
    const usable = phase === 'play' && !!board && board.count >= 2;
    for (const op of OPS) {
      const b = ui.ops[op];
      b.classList.toggle('cd-on', pendingOp === op);
      b.classList.toggle('cd-dim', !usable || selected === null);
      b.disabled = phase !== 'play';
    }
  }

  function renderSteps(): void {
    if (!ui) return;
    const moves = board ? board.moves : [];
    ui.steps.innerHTML = '';
    if (!moves.length) {
      ui.steps.append(el('div', { class: 'cd-steps-empty', text: t('stepsEmpty') }));
    } else {
      moves.forEach((m, i) => {
        const row = el(
          'div',
          { class: 'cd-step' + (spec && m.result.value === spec.target ? ' cd-step-goal' : '') },
          el('span', { class: 'cd-step-idx', text: String(i + 1) }),
          el('span', { class: 'cd-step-expr', text: `${m.a.value} ${OP_SYMBOL[m.op]} ${m.b.value} =` }),
          el('b', { text: String(m.result.value) }),
        );
        ui!.steps.append(row);
        if (i >= renderedMoves) anim(row, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
      });
      ui.steps.scrollTop = ui.steps.scrollHeight;
    }
    renderedMoves = moves.length;
    // Closest number on the board: the value that is scored.
    ui.bestChip.innerHTML = '';
    const ans = answerTile();
    if (ans && spec && phase !== 'pre') {
      const diff = Math.abs(ans.value - spec.target);
      const pts = pointsFor(diff);
      ui.bestChip.append(
        el('span', { text: t('closest', { v: ans.value }) }),
        el('span', { class: 'cd-best-diff', text: diff === 0 ? t('exactShort') : t('away', { n: diff }) }),
        el('span', { class: `cd-best-pts cd-p${pts}`, text: t('pts', { n: pts }) }),
      );
    }
  }

  function renderControls(): void {
    if (!ui) return;
    const inPlay = phase === 'play';
    const hasMoves = !!board && board.moves.length > 0;
    ui.undoBtn.disabled = !inPlay || !hasMoves;
    ui.resetBtn.disabled = !inPlay || !hasMoves;
    const ans = answerTile();
    ui.lockBtn.disabled = !inPlay || !ans;
    const label = ui.lockBtn.querySelector('.cd-btn-label');
    const lockText = t('lockIn', { v: ans ? ans.value : '' }).trim();
    if (label) label.textContent = lockText;
    ui.lockBtn.setAttribute('aria-label', lockText);
    ui.pauseBtn.disabled = !inPlay;
  }

  // ── Keyboard (bonus; the game is fully playable by touch) ─────────────────
  const KEY_OPS: Record<string, Op> = { '+': '+', '-': '-', '*': '*', x: '*', X: '*', '/': '/' };
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.modal-backdrop.open:not(.closing)')) return;
    const k = e.key;
    let handled = true;
    if (phase === 'play') {
      if (paused) {
        if (k === 'Enter' || k === ' ') resume();
        else handled = false;
      } else if (k >= '1' && k <= '6') onTile(Number(k) - 1);
      else if (KEY_OPS[k]) onOp(KEY_OPS[k]);
      else if (k === 'Backspace' || k === 'u') undo();
      else if (k === 'Escape') {
        clearSel();
        renderAll();
      } else if (k === 'Enter') lockIn();
      else if (k === 'p') pause(true);
      else handled = false;
    } else if (phase === 'pre') {
      if (k >= '0' && k <= '4') setLarge(Number(k));
      else if (k === 'Enter' || k === ' ') draw();
      else handled = false;
    } else if (phase === 'result') {
      if (k === 'Enter' || k === ' ') next();
      else handled = false;
    } else handled = false;
    if (handled) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  ctx.onVisibility((visible) => {
    if (!visible) pause(true);
    // The clock has not started during the reveal, so it may carry on by itself, unless the restart
    // confirmation is holding the pause.
    else if (phase === 'reveal' && paused && !confirmOpen) resume();
  });

  const cleanup = () => {
    if (destroyed) return;
    destroyed = true;
    loop.stop();
    clearAllLater();
    window.removeEventListener('keydown', onKey);
    removeRestart();
  };
  ctx.onDestroy(cleanup);

  showStart();
  return { destroy: cleanup };
}

const game: GameModule = { strings, create };
export default game;
