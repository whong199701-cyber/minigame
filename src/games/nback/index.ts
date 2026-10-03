import type { GameContext, GameInstance, GameModule } from '../../app/types';
import { el, button, segmented } from '../../app/ui';
import { createCanvas, createLoop, roundRect, clamp, type CanvasHandle } from '../../app/canvas';
import {
  DEFAULT_N,
  DEFAULT_TIMING,
  LETTERS,
  MAX_N,
  MIN_N,
  Round,
  channelsFor,
  clampN,
  generateSequence,
  isCleared,
  isMode,
  nextN,
  trialStartMs,
  trialStateAt,
  type Channel,
  type Decision,
  type Mode,
  type RoundScore,
  type TrialState,
} from './logic';
import './style.css';

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Noto Sans SC', sans-serif";
/** Countdown shown after resuming from pause (the current trial restarts after it). */
const RESUME_MS = 2000;
/** How long a "missed" flag stays on a button. */
const MISS_FLASH_MS = 850;
/** Minimum time a hit / false-alarm flash stays on a button. */
const FEEDBACK_MIN_MS = 420;
const KEYS: Record<Channel, string> = { position: 'A', letter: 'L', color: 'C' };
/** Triple-mode square colours: blue / gold / red stay distinct for the common colour-vision deficiencies. */
const TRIPLE = [
  { fill: '#3d7bff', ink: '#ffffff' },
  { fill: '#f2b200', ink: '#1d1d1f' },
  { fill: '#ee3f5c', ink: '#ffffff' },
];
const HISTORY_MAX = 30;

interface HistEntry {
  n: number;
  a: number;
  c: -1 | 0 | 1;
}

const strings = {
  zh: {
    rules:
      '3×3 方格每 2.5 秒亮起一格，并在格中显示一个字母，持续约 1 秒。\n位置与 N 步之前相同 → 按「位置」；字母与 N 步之前相同 → 按「字母」；两者可以同时成立。\n三重模式还要比较方块颜色（3 种），相同则按「颜色」；单项模式只比较位置。\n每轮 20 + N 个试次。按对闪绿、按错闪红，漏按会在该试次结束时标出。\n正确率 = 命中 ÷（应按次数 + 误按次数）。\n正确率 ≥ 80% 下一轮 N+1；< 50% 则 N−1（最低为 1）；其余保持不变。\n纪录：每种模式通过的最高 N，以及每个 N 的最佳正确率。\n键盘：A 位置 · L 字母 · C 颜色 · Esc 暂停。',
    desc: '记住 N 步之前出现过什么，越练越深。',
    single: '单项',
    dual: '双重',
    triple: '三重',
    singleDesc: '只比较位置',
    dualDesc: '位置 + 字母',
    tripleDesc: '位置 + 字母 + 颜色',
    nBack: '{n}-back',
    backSuffix: '-back',
    decrease: '降低 N',
    increase: '提高 N',
    adaptiveHint: '自适应：≥ 80% 升级 · < 50% 降级',
    bestN: '🏆 最高通过：{n}-back',
    noBest: '单轮正确率 ≥ 80% 即可创下纪录',
    bestAcc: '{n}-back 最佳正确率：{p}%',
    recent: '最近几轮',
    playN: '开始 {n}-back',
    position: '位置',
    letter: '字母',
    color: '颜色',
    missed: '漏按',
    trialLabel: '试次',
    levelLabel: '难度',
    accLabel: '正确率',
    getReady: '准备',
    resumeIn: '即将继续',
    pausedHint: '继续后，当前试次会重新开始。',
    menu: '菜单',
    levelUp: '升级！',
    levelSame: '本轮完成',
    levelDown: '降一级',
    hits: '命中',
    misses: '漏按',
    falseAlarms: '误按',
    accuracy: '正确率',
    formula: '正确率 = 命中 {h} ÷（应按 {m} + 误按 {f}）',
    decisionUp: '正确率 ≥ 80%，下一轮 {n}-back',
    decisionStay: '正确率 50%–79%，继续 {n}-back',
    decisionDown: '正确率 < 50%，下一轮 {n}-back',
    decisionFloor: '正确率 < 50%，已是最低的 1-back',
    decisionCeil: '已到最高难度 {n}-back',
    newBestN: '🏆 新纪录：通过 {n}-back！',
    newBestAcc: '🏅 {n}-back 正确率新纪录！',
  },
  en: {
    rules:
      'Every 2.5 s one square of the 3×3 grid lights up for about 1 s and shows a letter.\nSame position as N steps back → tap POSITION. Same letter as N steps back → tap LETTER. Both can be true at once.\nTriple mode also compares the square colour (3 colours) → tap COLOUR. Single mode tracks position only.\nA round has 20 + N trials. Correct presses flash green, wrong ones red; missed matches are flagged when the trial ends.\nAccuracy = hits ÷ (matches + false alarms).\n≥ 80% → next round is N+1; < 50% → N−1 (minimum 1); otherwise N stays.\nRecords: highest N cleared per mode and best accuracy at each N.\nKeyboard: A position · L letter · C colour · Esc pause.',
    desc: 'Remember what happened N steps ago — and keep climbing.',
    single: 'Single',
    dual: 'Dual',
    triple: 'Triple',
    singleDesc: 'Position only',
    dualDesc: 'Position + letter',
    tripleDesc: 'Position + letter + colour',
    nBack: '{n}-back',
    backSuffix: '-back',
    decrease: 'Decrease N',
    increase: 'Increase N',
    adaptiveHint: 'Adaptive: ≥ 80% level up · < 50% level down',
    bestN: '🏆 Highest cleared: {n}-back',
    noBest: 'Score ≥ 80% in a round to set a record',
    bestAcc: 'Best at {n}-back: {p}%',
    recent: 'Recent rounds',
    playN: 'Play {n}-back',
    position: 'Position',
    letter: 'Letter',
    color: 'Colour',
    missed: 'Missed',
    trialLabel: 'Trial',
    levelLabel: 'Level',
    accLabel: 'Accuracy',
    getReady: 'Get ready',
    resumeIn: 'Resuming',
    pausedHint: 'The current trial restarts when you resume.',
    menu: 'Menu',
    levelUp: 'Level up!',
    levelSame: 'Round complete',
    levelDown: 'Level down',
    hits: 'Hits',
    misses: 'Misses',
    falseAlarms: 'False alarms',
    accuracy: 'Accuracy',
    formula: 'Accuracy = hits {h} ÷ (matches {m} + false alarms {f})',
    decisionUp: '≥ 80% — next round: {n}-back',
    decisionStay: '50–79% — stay at {n}-back',
    decisionDown: '< 50% — next round: {n}-back',
    decisionFloor: '< 50% — already at the minimum, 1-back',
    decisionCeil: 'Top level reached: {n}-back',
    newBestN: '🏆 New record: {n}-back cleared!',
    newBestAcc: '🏅 New best accuracy at {n}-back!',
  },
};

interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
}

interface Geometry {
  size: number;
  gap: number;
  cell: number;
  x0: number;
  y0: number;
  r: number;
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const store = ctx.storage;

  const storedMode = store.get<unknown>('mode', 'dual');
  let mode: Mode = isMode(storedMode) ? storedMode : 'dual';
  const levelOf = (m: Mode): number => clampN(Number(store.get<unknown>('n:' + m, DEFAULT_N)));
  const accKey = (m: Mode, n: number) => `${m}@${n}`;
  const readHistory = (m: Mode): HistEntry[] => {
    const h = store.get<unknown>('hist:' + m, []);
    if (!Array.isArray(h)) return [];
    return h.filter((e): e is HistEntry => !!e && Number.isFinite((e as HistEntry).n) && Number.isFinite((e as HistEntry).a));
  };

  // ── Round state ──────────────────────────────────────────────────────
  let round: Round | null = null;
  let n = DEFAULT_N;
  let channels: Channel[] = [];
  let elapsed = 0;
  let lastNow = -1;
  let resumeLeft = 0;
  let paused = false;
  let finished = true;
  let lastTrial = -1;
  let lastTick = 0;
  let frameCount = 0;

  // ── View state ───────────────────────────────────────────────────────
  let cv: CanvasHandle | null = null;
  let overlay: HTMLElement | null = null;
  const btns = new Map<Channel, HTMLButtonElement>();
  const notes = new Map<Channel, HTMLElement>();
  /** performance.now() at which a button's feedback state is cleared (0 = keep until the trial ends). */
  const clearAt: Record<Channel, number> = { position: 0, letter: 0, color: 0 };
  const pressedAt: Record<Channel, number> = { position: 0, letter: 0, color: 0 };
  let segs: HTMLElement[] = [];
  let hudTrial: HTMLElement | null = null;
  let hudLevel: HTMLElement | null = null;
  let hudAcc: HTMLElement | null = null;
  let headerOff: (() => void)[] = [];
  let pal = readPalette();

  const loop = createLoop((_dt, now) => frame(now));

  function readPalette(): Palette {
    const v = (name: string, fb: string) => ctx.cssVar(name) || fb;
    return {
      bg: v('--bg', '#0f1218'),
      surface: v('--surface', '#1a1f2b'),
      surface2: v('--surface-2', '#232a39'),
      border: v('--border', '#2d3548'),
      text: v('--text', '#e8ecf3'),
      muted: v('--muted', '#8b94a7'),
      accent: v('--accent', '#5b8cff'),
    };
  }

  // ── Header ───────────────────────────────────────────────────────────
  function clearHeader(): void {
    headerOff.forEach((off) => off());
    headerOff = [];
  }
  function setPlayHeader(): void {
    clearHeader();
    headerOff.push(ctx.addHeaderAction({ icon: '⏸', label: t('pause'), onClick: () => togglePause() }));
    headerOff.push(ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: () => startRound() }));
  }

  // ── Teardown of the play view ────────────────────────────────────────
  function teardownPlay(): void {
    loop.stop();
    cv?.destroy();
    cv = null;
    overlay?.remove();
    overlay = null;
    clearHeader();
    btns.clear();
    notes.clear();
    segs = [];
    hudTrial = hudLevel = hudAcc = null;
    round = null;
    finished = true;
    paused = false;
    root.innerHTML = '';
  }

  // ── Start screen ─────────────────────────────────────────────────────
  function showStart(): void {
    teardownPlay();
    ctx.setStatus('');
    let level = levelOf(mode);

    const modeDesc = el('p', { class: 'nb-mode-desc muted small' });
    const levelNum = el('span', { class: 'nb-level-n' });
    const dec = el('button', { class: 'nb-step', type: 'button', 'aria-label': t('decrease'), text: '−' });
    const inc = el('button', { class: 'nb-step', type: 'button', 'aria-label': t('increase'), text: '+' });
    const bestLine = el('p', { class: 'nb-best-main' });
    const accLine = el('p', { class: 'nb-best-acc muted small' });
    const histWrap = el('div', { class: 'nb-hist' });
    const playBtn = button('', () => startRound(), { variant: 'primary', size: 'lg', class: 'nb-play-btn' });
    const playLabel = playBtn.querySelector('span:last-child') as HTMLElement;

    const refresh = () => {
      modeDesc.textContent = t(mode + 'Desc');
      levelNum.textContent = String(level);
      dec.disabled = level <= MIN_N;
      inc.disabled = level >= MAX_N;
      const best = store.getBest(mode);
      bestLine.textContent = best === null ? t('noBest') : t('bestN', { n: best });
      bestLine.classList.toggle('muted', best === null);
      const acc = store.getBest(accKey(mode, level));
      accLine.textContent = acc === null ? '' : t('bestAcc', { n: level, p: acc });
      playLabel.textContent = t('playN', { n: level });
      renderHistory(histWrap, mode);
    };
    const step = (d: number) => {
      const next = clampN(level + d);
      if (next === level) return;
      level = next;
      store.set('n:' + mode, level);
      ctx.play('tap');
      ctx.haptic('light');
      refresh();
    };
    dec.addEventListener('click', () => step(-1));
    inc.addEventListener('click', () => step(1));

    root.append(
      el(
        'div',
        { class: 'start-screen nb-start' },
        el('div', { class: 'big-icon', text: '🧠' }),
        el('p', { class: 'nb-desc muted', text: t('desc') }),
        segmented<Mode>(
          [
            { value: 'single', label: t('single') },
            { value: 'dual', label: t('dual') },
            { value: 'triple', label: t('triple') },
          ],
          mode,
          (m) => {
            mode = m;
            store.set('mode', m);
            level = levelOf(m);
            refresh();
          },
        ),
        modeDesc,
        el(
          'div',
          { class: 'nb-level' },
          dec,
          el('div', { class: 'nb-level-val' }, levelNum, el('span', { class: 'nb-level-unit', text: t('backSuffix') })),
          inc,
        ),
        el('p', { class: 'nb-hint muted small', text: t('adaptiveHint') }),
        el('div', { class: 'nb-best' }, bestLine, accLine),
        histWrap,
        playBtn,
      ),
    );
    refresh();
  }

  function renderHistory(wrap: HTMLElement, m: Mode): void {
    wrap.innerHTML = '';
    const last = readHistory(m).slice(-12);
    wrap.hidden = last.length === 0;
    if (!last.length) return;
    const maxN = Math.max(3, ...last.map((e) => e.n));
    const bars = el('div', { class: 'nb-hist-bars' });
    for (const e of last) {
      const cls = e.c > 0 ? 'nb-up' : e.c < 0 ? 'nb-down' : 'nb-same';
      const bar = el('div', { class: 'nb-hist-bar ' + cls, title: `${t('nBack', { n: e.n })} · ${e.a}%` }, el('span', { text: String(e.n) }));
      bar.style.height = Math.round(16 + (30 * e.n) / maxN) + 'px';
      bars.append(bar);
    }
    wrap.append(el('div', { class: 'nb-hist-title muted small', text: t('recent') }), bars);
  }

  // ── Play view ────────────────────────────────────────────────────────
  function startRound(): void {
    teardownPlay();
    n = levelOf(mode);
    channels = channelsFor(mode);
    round = new Round(generateSequence(n), n, channels);
    elapsed = 0;
    lastNow = -1;
    resumeLeft = 0;
    paused = false;
    finished = false;
    lastTrial = -1;
    lastTick = 0;
    for (const ch of ['position', 'letter', 'color'] as const) clearAt[ch] = pressedAt[ch] = 0;
    pal = readPalette();
    buildPlayView(round);
    setPlayHeader();
    updateHud();
    updateStatus();
    loop.start();
  }

  function stat(label: string, value: HTMLElement): HTMLElement {
    return el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), value);
  }

  function channelIcon(ch: Channel): HTMLElement {
    if (ch === 'position') {
      const ico = el('span', { class: 'nb-ico nb-ico-pos', 'aria-hidden': 'true' });
      for (let i = 0; i < 9; i++) ico.append(el('i', { class: i === 2 ? 'nb-on' : '' }));
      return ico;
    }
    if (ch === 'letter') return el('span', { class: 'nb-ico nb-ico-let', 'aria-hidden': 'true', text: 'Aa' });
    const ico = el('span', { class: 'nb-ico nb-ico-col', 'aria-hidden': 'true' });
    for (const c of TRIPLE) ico.append(el('i', { style: { background: c.fill } }));
    return ico;
  }

  function buildPlayView(r: Round): void {
    hudTrial = el('span', { class: 'stat-value' });
    hudLevel = el('span', { class: 'stat-value' });
    hudAcc = el('span', { class: 'stat-value' });
    const hud = el('div', { class: 'game-hud nb-hud' }, stat(t('trialLabel'), hudTrial), stat(t('levelLabel'), hudLevel), stat(t('accLabel'), hudAcc));

    const prog = el('div', { class: 'nb-progress', 'aria-hidden': 'true' });
    segs = [];
    for (let i = 0; i < r.total; i++) {
      const s = el('i', { class: i < r.n ? 'nb-pre' : '' });
      segs.push(s);
      prog.append(s);
    }

    const area = el('div', { class: 'game-area nb-area' });
    const controls = el('div', { class: `nb-controls nb-c${channels.length}` });
    for (const ch of channels) {
      const note = el('span', { class: 'nb-btn-note', 'aria-hidden': 'true' });
      const b = el(
        'button',
        { class: 'nb-btn', type: 'button', 'aria-label': `${t(ch)} (${KEYS[ch]})` },
        channelIcon(ch),
        el('span', { class: 'nb-btn-label', text: t(ch) }),
        el('span', { class: 'nb-btn-key', text: KEYS[ch], 'aria-hidden': 'true' }),
        note,
      );
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        respond(ch);
      });
      // Keyboard activation (Enter / Space on a focused button) arrives as a click with detail 0.
      b.addEventListener('click', (e) => {
        if (e.detail === 0) respond(ch);
      });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      btns.set(ch, b);
      notes.set(ch, note);
      controls.append(b);
    }

    root.append(el('div', { class: 'nb-play' }, hud, prog, area, controls));
    cv = createCanvas(area, () => drawNow());
    cv.canvas.setAttribute('aria-hidden', 'true');
    drawNow();
  }

  function updateHud(): void {
    if (!round) return;
    const shown = Math.max(0, Math.min(lastTrial + 1, round.total));
    if (hudTrial) hudTrial.textContent = `${shown}/${round.total}`;
    if (hudLevel) hudLevel.textContent = t('nBack', { n });
    if (hudAcc) {
      const s = round.score();
      hudAcc.textContent = s.matches + s.falseAlarms > 0 ? Math.round(s.accuracy * 100) + '%' : '—';
    }
  }

  function updateStatus(): void {
    ctx.setStatus(`${t('nBack', { n })} · ${t(mode)}`);
  }

  // ── Responses & feedback ─────────────────────────────────────────────
  function setBtn(ch: Channel, kind: 'hit' | 'fa' | 'miss' | null): void {
    const b = btns.get(ch);
    const note = notes.get(ch);
    if (!b || !note) return;
    b.classList.remove('nb-hit', 'nb-fa', 'nb-miss');
    if (!kind) {
      note.textContent = '';
      return;
    }
    void b.offsetWidth; // restart the CSS animation
    b.classList.add('nb-' + kind);
    note.textContent = kind === 'hit' ? '✓' : kind === 'fa' ? '✗' : t('missed');
  }

  function respond(ch: Channel): void {
    if (!round || finished || paused || resumeLeft > 0) return;
    const st = trialStateAt(elapsed, round.total);
    if (st.phase !== 'stimulus' && st.phase !== 'gap') return;
    const res = round.respond(st.trial, ch);
    if (res === 'hit' || res === 'falseAlarm') {
      clearAt[ch] = 0;
      pressedAt[ch] = performance.now();
    }
    if (res === 'hit') {
      setBtn(ch, 'hit');
      ctx.play('success');
      ctx.haptic('light');
    } else if (res === 'falseAlarm') {
      setBtn(ch, 'fa');
      ctx.play('error');
      ctx.haptic('error');
    }
  }

  function closeTrial(i: number): void {
    if (!round) return;
    const missed = round.closeTrial(i);
    const now = performance.now();
    for (const ch of missed) {
      setBtn(ch, 'miss');
      clearAt[ch] = now + MISS_FLASH_MS;
    }
    if (missed.length) ctx.haptic('medium');
    const seg = segs[i];
    if (seg) {
      seg.classList.remove('nb-cur');
      seg.classList.add(round.trialCorrect(i) ? 'nb-ok' : 'nb-bad');
    }
  }

  function startTrial(i: number): void {
    // Feedback from the previous trial fades out, but stays visible at least FEEDBACK_MIN_MS after the press.
    const now = performance.now();
    for (const [ch, b] of btns) {
      if (b.classList.contains('nb-hit') || b.classList.contains('nb-fa')) clearAt[ch] = Math.max(now, pressedAt[ch] + FEEDBACK_MIN_MS);
    }
    segs[i]?.classList.add('nb-cur');
  }

  // ── Loop ─────────────────────────────────────────────────────────────
  function frame(now: number): void {
    if (!round || !cv) return;
    if (lastNow < 0) lastNow = now;
    const d = Math.min(250, Math.max(0, now - lastNow));
    lastNow = now;
    if (!paused && !finished) {
      if (resumeLeft > 0) resumeLeft = Math.max(0, resumeLeft - d);
      else elapsed += d;
    }
    const st = trialStateAt(elapsed, round.total);

    const tick = resumeLeft > 0 ? Math.ceil(resumeLeft / 1000) : st.phase === 'lead' ? st.countdown : 0;
    if (tick !== lastTick) {
      lastTick = tick;
      if (tick > 0) ctx.play('tick');
    }

    if (st.trial !== lastTrial) {
      for (let i = Math.max(0, lastTrial); i < Math.min(st.trial, round.total); i++) closeTrial(i);
      lastTrial = st.trial;
      if (st.phase !== 'done') startTrial(st.trial);
      updateHud();
    }

    for (const ch of channels) {
      if (clearAt[ch] && now >= clearAt[ch]) {
        clearAt[ch] = 0;
        setBtn(ch, null);
      }
    }

    if (st.phase === 'done') {
      finish();
      return;
    }

    // A shell modal (e.g. the rules sheet) opened mid-round: pause so the player is not penalised.
    if (++frameCount % 12 === 0 && document.querySelector('.modal-backdrop:not(.closing)')) {
      pause();
      return;
    }
    draw(st);
  }

  function drawNow(): void {
    if (!round || !cv) return;
    draw(trialStateAt(elapsed, round.total));
  }

  function geometry(W: number, H: number): Geometry {
    const pad = 12;
    const barSpace = 20;
    const size = Math.max(90, Math.min(W - pad * 2, H - pad * 2 - barSpace, 480));
    const gap = Math.round(size * 0.035);
    const cell = (size - gap * 2) / 3;
    const x0 = Math.round((W - size) / 2);
    const y0 = Math.round(Math.max(pad, (H - size - barSpace) / 2));
    return { size, gap, cell, x0, y0, r: Math.round(cell * 0.17) };
  }

  function draw(st: TrialState): void {
    if (!round || !cv) return;
    const g = cv.ctx;
    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);
    const G = geometry(W, H);
    const active = !paused && !finished && resumeLeft <= 0;
    const lit = active && st.phase === 'stimulus' ? round.seq[st.trial] : null;

    // Grid
    for (let i = 0; i < 9; i++) {
      const x = G.x0 + (i % 3) * (G.cell + G.gap);
      const y = G.y0 + Math.floor(i / 3) * (G.cell + G.gap);
      roundRect(g, x, y, G.cell, G.cell, G.r);
      g.fillStyle = pal.surface;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = pal.border;
      g.stroke();
    }

    // Fixation cross
    const cx = G.x0 + G.size / 2;
    const cy = G.y0 + G.size / 2;
    if (!lit || lit.pos !== 4) {
      const k = Math.max(6, G.cell * 0.09);
      g.strokeStyle = pal.muted;
      g.globalAlpha = 0.45;
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx - k, cy);
      g.lineTo(cx + k, cy);
      g.moveTo(cx, cy - k);
      g.lineTo(cx, cy + k);
      g.stroke();
      g.globalAlpha = 1;
    }

    // Stimulus
    if (lit) {
      const S = DEFAULT_TIMING.stimulusMs;
      const tIn = st.timeInTrial;
      const a = Math.min(clamp(tIn / 90, 0, 1), clamp((S - tIn) / 120, 0, 1));
      const s = 0.84 + 0.16 * easeOutBack(clamp(tIn / 220, 0, 1));
      const colour = mode === 'triple' ? TRIPLE[lit.color] : { fill: pal.accent, ink: '#ffffff' };
      const x = G.x0 + (lit.pos % 3) * (G.cell + G.gap) + G.cell / 2;
      const y = G.y0 + Math.floor(lit.pos / 3) * (G.cell + G.gap) + G.cell / 2;
      g.save();
      g.globalAlpha = a;
      g.translate(x, y);
      g.scale(s, s);
      roundRect(g, -G.cell / 2, -G.cell / 2, G.cell, G.cell, G.r);
      g.shadowColor = colour.fill;
      g.shadowBlur = 26;
      g.fillStyle = colour.fill;
      g.fill();
      g.shadowBlur = 0;
      const sheen = g.createLinearGradient(0, -G.cell / 2, 0, G.cell / 2);
      sheen.addColorStop(0, 'rgba(255,255,255,0.26)');
      sheen.addColorStop(0.55, 'rgba(255,255,255,0)');
      g.fillStyle = sheen;
      g.fill();
      if (channels.includes('letter')) {
        g.fillStyle = colour.ink;
        g.font = `800 ${Math.round(G.cell * 0.52)}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(LETTERS[lit.letter], 0, G.cell * 0.035);
      }
      g.restore();
    }

    // Response-window bar: shrinks until the next stimulus.
    if (active && (st.phase === 'stimulus' || st.phase === 'gap')) {
      const frac = 1 - st.timeInTrial / DEFAULT_TIMING.trialMs;
      const by = G.y0 + G.size + 12;
      const bw = Math.min(G.size, 220);
      const bx = cx - bw / 2;
      roundRect(g, bx, by, bw, 4, 2);
      g.fillStyle = pal.border;
      g.fill();
      roundRect(g, bx + (bw * (1 - frac)) / 2, by, bw * frac, 4, 2);
      g.fillStyle = pal.muted;
      g.fill();
    }

    // Countdown (lead-in or resume)
    const num = paused || finished ? 0 : resumeLeft > 0 ? Math.ceil(resumeLeft / 1000) : st.phase === 'lead' ? st.countdown : 0;
    if (num > 0) {
      const remain = resumeLeft > 0 ? resumeLeft : DEFAULT_TIMING.leadMs - elapsed;
      const frac = clamp((remain - (num - 1) * 1000) / 1000, 0, 1);
      g.save();
      g.globalAlpha = 0.78;
      g.fillStyle = pal.bg;
      roundRect(g, G.x0 - 2, G.y0 - 2, G.size + 4, G.size + 4, G.r + 2);
      g.fill();
      g.globalAlpha = 1;
      const R = G.cell * 0.62;
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.strokeStyle = pal.border;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = pal.accent;
      g.beginPath();
      g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      g.stroke();
      const pop = frac > 0.8 ? 1 + (frac - 0.8) * 1.1 : 1;
      g.translate(cx, cy);
      g.scale(pop, pop);
      g.fillStyle = pal.text;
      g.font = `800 ${Math.round(G.cell * 0.62)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(num), 0, G.cell * 0.03);
      g.setTransform(cv.dpr, 0, 0, cv.dpr, 0, 0);
      g.fillStyle = pal.text;
      g.font = `700 ${Math.round(clamp(G.cell * 0.17, 14, 22))}px ${FONT}`;
      g.fillText(`${t('nBack', { n })} · ${t(mode)}`, cx, cy - R - G.cell * 0.32);
      g.fillStyle = pal.muted;
      g.font = `600 ${Math.round(clamp(G.cell * 0.14, 12, 18))}px ${FONT}`;
      g.fillText(resumeLeft > 0 ? t('resumeIn') : t('getReady'), cx, cy + R + G.cell * 0.3);
      g.restore();
    }
  }

  // ── Pause ────────────────────────────────────────────────────────────
  function pause(): void {
    if (!round || finished || paused) return;
    paused = true;
    loop.stop();
    drawNow();
    ctx.setStatus(t('paused'));
    overlay = el(
      'div',
      { class: 'overlay nb-pause' },
      el('div', { class: 'nb-pause-icon', text: '⏸' }),
      el('h2', { text: t('paused') }),
      el('p', { class: 'muted small', text: t('pausedHint') }),
      button(t('resume'), () => resume(), { variant: 'primary', size: 'lg', class: 'nb-pause-main' }),
      el('div', { class: 'nb-pause-row' }, button(t('restart'), () => startRound(), { variant: 'secondary' }), button(t('menu'), () => showStart(), { variant: 'secondary' })),
    );
    root.append(overlay);
  }

  function resume(): void {
    if (!round || !paused) return;
    paused = false;
    overlay?.remove();
    overlay = null;
    if (lastTrial >= 0 && lastTrial < round.total) {
      elapsed = trialStartMs(lastTrial);
      resumeLeft = RESUME_MS;
    }
    lastNow = -1;
    lastTick = 0;
    updateStatus();
    loop.start();
  }

  function togglePause(): void {
    if (paused) resume();
    else pause();
  }

  // ── End of round ─────────────────────────────────────────────────────
  function finish(): void {
    if (!round || finished) return;
    finished = true;
    loop.stop();
    clearHeader();
    headerOff.push(ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: () => startRound() }));
    drawNow();

    const score = round.score(round.total);
    const pct = Math.round(score.accuracy * 100);
    const decision = nextN(n, score.accuracy);
    const cleared = isCleared(score.accuracy);
    store.set('n:' + mode, decision.next);
    const newBestN = cleared ? store.recordBest(mode, n, 'higher') : false;
    const prevAcc = store.getBest(accKey(mode, n));
    const newBestAcc = store.recordBest(accKey(mode, n), pct, 'higher') && prevAcc !== null;
    const hist = readHistory(mode);
    hist.push({ n, a: pct, c: decision.change });
    store.set('hist:' + mode, hist.slice(-HISTORY_MAX));

    if (cleared) {
      ctx.play('win');
      ctx.haptic('success');
    } else if (score.accuracy < 0.5) {
      ctx.play('lose');
      ctx.haptic('error');
    } else {
      ctx.play('success');
      ctx.haptic('medium');
    }
    ctx.setStatus(`${t('nBack', { n })} · ${t(mode)} · ${pct}%`);

    const title = decision.change > 0 ? t('levelUp') : decision.change < 0 ? t('levelDown') : cleared ? t('levelComplete') : t('levelSame');
    ctx.showModal({
      title,
      body: resultBody(score, pct, decision, cleared, newBestN, newBestAcc),
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        { label: t('menu'), onClick: () => showStart() },
        { label: t('playN', { n: decision.next }), primary: true, onClick: () => startRound() },
      ],
    });
  }

  function resultBody(score: RoundScore, pct: number, decision: Decision, cleared: boolean, newBestN: boolean, newBestAcc: boolean): HTMLElement {
    const ring = el(
      'div',
      { class: 'nb-ring ' + (cleared ? 'nb-good' : score.accuracy < 0.5 ? 'nb-poor' : 'nb-mid') },
      el('div', { class: 'nb-ring-inner' }, el('span', { class: 'nb-ring-val', text: pct + '%' }), el('span', { class: 'nb-ring-lbl', text: t('accuracy') })),
    );
    ring.style.setProperty('--nb-p', String(pct));

    let decText: string;
    if (decision.change > 0) decText = t('decisionUp', { n: decision.next });
    else if (decision.change < 0) decText = t('decisionDown', { n: decision.next });
    else if (score.accuracy < 0.5) decText = t('decisionFloor');
    else if (cleared) decText = t('decisionCeil', { n: decision.next });
    else decText = t('decisionStay', { n: decision.next });
    const arrow = decision.change > 0 ? '▲' : decision.change < 0 ? '▼' : '●';
    const decEl = el(
      'div',
      { class: 'nb-decision ' + (decision.change > 0 ? 'nb-up' : decision.change < 0 ? 'nb-down' : 'nb-same') },
      el('span', { class: 'nb-decision-arrow', text: arrow }),
      el('span', { text: decText }),
    );

    const head = el('tr', {}, el('th', {}), el('th', { text: t('hits') }), el('th', { text: t('misses') }), el('th', { text: t('falseAlarms') }));
    const body = el('tbody');
    for (const ch of channels) {
      const s = score.perChannel[ch];
      if (!s) continue;
      body.append(
        el(
          'tr',
          {},
          el('th', { text: t(ch) }),
          el('td', { class: s.hits === s.matches ? 'nb-ok' : '', text: `${s.hits}/${s.matches}` }),
          el('td', { class: s.misses ? 'nb-bad' : '', text: String(s.misses) }),
          el('td', { class: s.falseAlarms ? 'nb-bad' : '', text: String(s.falseAlarms) }),
        ),
      );
    }
    const table = el('table', { class: 'nb-table' }, el('thead', {}, head), body);

    return el(
      'div',
      { class: 'nb-result' },
      el('div', { class: 'nb-result-top' }, ring, decEl),
      table,
      el('p', { class: 'nb-formula muted small', text: t('formula', { h: score.hits, m: score.matches, f: score.falseAlarms }) }),
      newBestN ? el('p', { class: 'nb-record', text: t('newBestN', { n }) }) : null,
      newBestAcc ? el('p', { class: 'nb-record', text: t('newBestAcc', { n }) }) : null,
    );
  }

  // ── Global listeners ─────────────────────────────────────────────────
  const onKey = (e: KeyboardEvent) => {
    if (!round || finished) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') {
      e.preventDefault();
      togglePause();
      return;
    }
    if (paused) {
      if (k === ' ' || k === 'enter') {
        e.preventDefault();
        resume();
      }
      return;
    }
    if (e.repeat) return;
    const ch: Channel | null = k === 'a' ? 'position' : k === 'l' ? 'letter' : k === 'c' ? 'color' : null;
    if (ch && round.hasChannel(ch)) {
      e.preventDefault();
      respond(ch);
    }
  };
  window.addEventListener('keydown', onKey);

  ctx.onVisibility((visible) => {
    if (!visible) pause();
  });
  ctx.onThemeChange(() => {
    pal = readPalette();
    drawNow();
  });

  const destroyAll = () => {
    loop.stop();
    window.removeEventListener('keydown', onKey);
    cv?.destroy();
    cv = null;
    clearHeader();
    round = null;
  };
  ctx.onDestroy(destroyAll);

  showStart();
  return { destroy: destroyAll };
}

const game: GameModule = { strings, create };
export default game;
