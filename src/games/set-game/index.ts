import type { GameContext, GameInstance, GameModule } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import { createLoop } from '../../app/canvas';
import {
  BLITZ_SECONDS,
  DIFFS,
  autoDeal,
  computeGrid,
  deal,
  decode,
  encode,
  failingAttrs,
  generatePuzzle,
  hasSet,
  isDeckCleared,
  isSet,
  maxBoard,
  newTable,
  pickHintSet,
  refillDeck,
  removeCards,
  scoreEvent,
  setKey,
  slotRect,
  PENALTY,
  type DiffConfig,
  type Diff,
  type GameEvent,
  type GridLayout,
  type Mode,
  type Rect,
  type Table,
} from './logic';
import { strings } from './strings';
import './style.css';

// ── Card art (inline SVG, landscape card, symbols side by side) ────────

const DIAMOND = 'M0 -26L9 0L0 26L-9 0Z';
const PILL = 'M-9 -17A9 9 0 0 1 9 -17L9 17A9 9 0 0 1 -9 17Z';

function wavePath(): string {
  const R = 5.5; // half thickness
  const A = 3.6; // wave amplitude
  const L = 26; // half length
  const cx = (y: number) => A * Math.sin((Math.PI * y) / L);
  const half = (y: number) => {
    const d = Math.abs(y) - (L - R);
    return d <= 0 ? R : Math.sqrt(Math.max(0, R * R - d * d));
  };
  const N = 30;
  const right: string[] = [];
  const left: string[] = [];
  for (let i = 0; i <= N; i++) {
    const y = L * Math.sin(-Math.PI / 2 + (Math.PI * i) / N);
    right.push(`${(cx(y) + half(y)).toFixed(2)} ${y.toFixed(2)}`);
    left.push(`${(cx(y) - half(y)).toFixed(2)} ${y.toFixed(2)}`);
  }
  left.reverse();
  return 'M' + right.join('L') + 'L' + left.slice(1, -1).join('L') + 'Z';
}

const SHAPES = [DIAMOND, PILL, wavePath()];
const artCache = new Map<number, string>();

function cardArt(c: number): string {
  const cached = artCache.get(c);
  if (cached) return cached;
  const { count, shape, color, fill } = decode(c);
  const xs = count === 0 ? [36] : count === 1 ? [24.5, 47.5] : [13, 36, 59];
  const paint = fill === 0 ? 'currentColor' : fill === 1 ? `url(#sg-stripe-${color})` : 'none';
  const body = xs.map((x) => `<path transform="translate(${x} 32)" d="${SHAPES[shape]}" fill="${paint}"/>`).join('');
  const svg = `<svg class="sg-art" viewBox="0 0 72 64" aria-hidden="true" focusable="false"><g stroke="currentColor" stroke-width="2.2" stroke-linejoin="round">${body}</g></svg>`;
  artCache.set(c, svg);
  return svg;
}

function defsSvg(): string {
  const pats = [0, 1, 2]
    .map(
      (i) =>
        `<pattern id="sg-stripe-${i}" patternUnits="userSpaceOnUse" width="4" height="3.4"><rect x="0" y="0" width="4" height="1.15" class="sg-fill-${i}"/></pattern>`,
    )
    .join('');
  return `<svg class="sg-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>${pats}</defs></svg>`;
}

// ── Game ────────────────────────────────────────────────────────────────

const MODE_LIST: Mode[] = ['classic', 'blitz', 'puzzle'];
const DIFF_LIST: Diff[] = ['easy', 'normal', 'hard'];

interface SlotView {
  card: number;
  el: HTMLElement;
  inner: HTMLElement;
  rect: Rect | null;
}

interface Run {
  mode: Mode;
  diff: Diff;
  cfg: DiffConfig;
  table: Table;
  selected: number[];
  hint: { cards: number[]; shown: number } | null;
  sets: number;
  mistakes: number;
  hints: number;
  score: number;
  penalty: number;
  /** Seconds of un-paused play. */
  active: number;
  /** Active time when the table became set-less (for the delayed auto-deal), else null. */
  noSetSince: number | null;
  puzzleTotal: number;
  foundKeys: Set<string>;
  over: boolean;
  paused: boolean;
  shownClock: number;
  lastTick: number;
}

interface View {
  board: HTMLElement;
  overlay: HTMLElement;
  timeStat: HTMLElement;
  timeVal: HTMLElement;
  primaryStat: HTMLElement;
  primaryVal: HTMLElement;
  midVal: HTMLElement;
  midStat: HTMLElement;
  barFill: HTMLElement | null;
  found: HTMLElement | null;
  hintBtn: HTMLButtonElement | null;
  noSetBtn: HTMLButtonElement | null;
  ro: ResizeObserver;
  layout: GridLayout | null;
}

function fmtPrecise(sec: number): string {
  const tenths = Math.max(0, Math.round(sec * 10));
  return `${formatTime(Math.floor(tenths / 10))}.${tenths % 10}`;
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const storedMode = ctx.storage.get<string>('mode', 'classic');
  const storedDiff = ctx.storage.get<string>('diff', 'normal');
  let mode: Mode = (MODE_LIST as string[]).includes(storedMode) ? (storedMode as Mode) : 'classic';
  let diff: Diff = (DIFF_LIST as string[]).includes(storedDiff) ? (storedDiff as Diff) : 'normal';

  let run: Run | null = null;
  let view: View | null = null;
  const views = new Map<number, SlotView>();
  let destroyed = false;
  let frozenShown = false;
  let lastNow = -1;

  const wrap = el('div', { class: 'sg-root', html: defsSvg() });
  const screen = el('div', { class: 'sg-screen' });
  wrap.append(screen);
  root.append(wrap);

  // timers
  const timers = new Set<number>();
  function later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
  }
  function clearTimers(): void {
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
  }

  const loop = createLoop((_dt, now) => tick(now));
  function startLoop(): void {
    lastNow = -1;
    loop.start();
  }

  // header
  let headerOff: (() => void)[] = [];
  function setHeader(kind: 'none' | 'play' | 'over'): void {
    headerOff.forEach((off) => off());
    headerOff = [];
    if (kind === 'none') return;
    headerOff.push(ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: onRestart }));
    if (kind === 'play') headerOff.push(ctx.addHeaderAction({ icon: '⏸', label: t('pause'), onClick: () => setPaused(!run?.paused) }));
  }

  const bestKey = (m: Mode, d: Diff) => `${m}-${d}`;
  function bestText(m: Mode, d: Diff): string {
    const b = ctx.storage.getBest(bestKey(m, d));
    if (b === null) return t('noBest');
    return m === 'blitz' ? t('bestSets', { n: b }) : t('bestTime', { t: fmtPrecise(b) });
  }
  function bestShort(m: Mode, d: Diff): string {
    const b = ctx.storage.getBest(bestKey(m, d));
    if (b === null) return '—';
    return m === 'blitz' ? String(b) : formatTime(b);
  }

  function cardLabel(c: number): string {
    const a = decode(c);
    return t('cardLabel', { n: a.count + 1, color: t('color' + a.color), fill: t('fill' + a.fill), shape: t('shape' + a.shape) });
  }

  function modalOpen(): boolean {
    return document.querySelector('.modal-backdrop:not(.closing)') !== null;
  }
  function isFrozen(): boolean {
    return !run || run.paused || modalOpen();
  }

  // ── Start screen ──────────────────────────────────────────────────────
  function teardownView(): void {
    view?.ro.disconnect();
    view = null;
    views.clear();
  }

  function showStart(): void {
    clearTimers();
    loop.stop();
    teardownView();
    run = null;
    frozenShown = false;
    setHeader('none');
    ctx.setStatus('');
    screen.innerHTML = '';

    const desc = el('p', { class: 'sg-desc' });
    const best = el('p', { class: 'sg-best' });
    const refresh = () => {
      const cfg = DIFFS[diff];
      const modeLine =
        mode === 'classic'
          ? t('classicDesc', { deck: cfg.dims === 4 ? 81 : 27 })
          : mode === 'blitz'
            ? t('blitzDesc')
            : t('puzzleDesc', { cards: cfg.puzzleCards, sets: cfg.puzzleSets });
      desc.innerHTML = '';
      desc.append(el('span', { text: modeLine }), el('br'), el('span', { class: 'muted', text: t(diff + 'Desc') }));
      best.textContent = '🏆 ' + bestText(mode, diff);
    };
    refresh();

    const example = el(
      'div',
      { class: 'sg-example' },
      ...[encode({ count: 0, shape: 0, color: 0, fill: 0 }), encode({ count: 1, shape: 0, color: 1, fill: 1 }), encode({ count: 2, shape: 0, color: 2, fill: 2 })].map((c) =>
        el('div', { class: `sg-card sg-ex sg-k${decode(c).color}`, html: cardArt(c), 'aria-label': cardLabel(c), role: 'img' }),
      ),
    );

    screen.append(
      el(
        'div',
        { class: 'start-screen sg-start' },
        el('div', { class: 'big-icon', text: '🔷' }),
        el('p', { class: 'sg-tagline', text: t('tagline') }),
        el('div', { class: 'sg-example-wrap' }, example, el('p', { class: 'sg-example-cap small muted', text: t('example') })),
        el(
          'div',
          { class: 'sg-pickers' },
          el('div', { class: 'sg-picker' }, el('span', { class: 'sg-picker-label', text: t('mode') }), segmented<Mode>(MODE_LIST.map((m) => ({ value: m, label: t(m) })), mode, (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            refresh();
          })),
          el('div', { class: 'sg-picker' }, el('span', { class: 'sg-picker-label', text: t('difficulty') }), segmented<Diff>(DIFF_LIST.map((d) => ({ value: d, label: t(d) })), diff, (d) => {
            diff = d;
            ctx.storage.set('diff', d);
            refresh();
          })),
        ),
        desc,
        best,
        button(t('play'), () => startGame(), { variant: 'primary', size: 'lg', class: 'sg-play' }),
      ),
    );
  }

  // ── Play screen ───────────────────────────────────────────────────────
  function stat(label: string, value: string, extra = ''): { wrap: HTMLElement; val: HTMLElement } {
    const val = el('span', { class: 'stat-value', text: value });
    const w = el('div', { class: 'stat sg-stat ' + extra }, el('span', { class: 'stat-label', text: label }), val);
    return { wrap: w, val };
  }

  function ctlButton(icon: string, label: string, cost: string | null, onClick: () => void): HTMLButtonElement {
    const b = el(
      'button',
      { class: 'btn btn-secondary btn-lg sg-ctl', type: 'button' },
      el('span', { class: 'btn-icon', text: icon }),
      el('span', { text: label }),
      cost ? el('span', { class: 'sg-cost', text: cost }) : null,
    );
    b.addEventListener('click', onClick);
    return b;
  }

  function startGame(): void {
    clearTimers();
    loop.stop();
    teardownView();
    screen.innerHTML = '';
    const cfg = DIFFS[diff];
    let table: Table;
    if (mode === 'puzzle') {
      table = { deck: [], board: generatePuzzle(cfg.dims, cfg.puzzleCards, cfg.puzzleSets) };
    } else {
      table = newTable(cfg.dims, cfg.base);
      if (cfg.autoDealDelay === 0) table = autoDeal(table, maxBoard(cfg.dims)).table;
    }
    run = {
      mode,
      diff,
      cfg,
      table,
      selected: [],
      hint: null,
      sets: 0,
      mistakes: 0,
      hints: 0,
      score: 0,
      penalty: 0,
      active: 0,
      noSetSince: null,
      puzzleTotal: cfg.puzzleSets,
      foundKeys: new Set(),
      over: false,
      paused: false,
      shownClock: -1,
      lastTick: -1,
    };
    frozenShown = false;
    ctx.setStatus(`${t(mode)} · ${t(diff)}`);
    setHeader('play');

    // HUD
    const primary = mode === 'blitz' ? stat(t('score'), '0') : mode === 'puzzle' ? stat(t('found'), `0/${cfg.puzzleSets}`) : stat(t('sets'), '0');
    const mid = mode === 'classic' ? stat(t('deck'), String(table.deck.length)) : stat(t('best'), bestShort(mode, diff));
    const time = stat(mode === 'blitz' ? t('timeLeft') : t('time'), mode === 'blitz' ? formatTime(BLITZ_SECONDS) : '00:00', 'sg-time');
    const hud = el('div', { class: 'game-hud sg-hud' }, primary.wrap, mid.wrap, time.wrap);
    screen.append(hud);
    let barFill: HTMLElement | null = null;
    if (mode === 'blitz') {
      barFill = el('div', { class: 'sg-bar-fill' });
      screen.append(el('div', { class: 'sg-bar' }, barFill));
    }
    let found: HTMLElement | null = null;
    if (mode === 'puzzle') {
      found = el('div', { class: 'sg-found' + (cfg.puzzleSets > 6 ? ' sg-found-many' : '') });
      for (let i = 0; i < cfg.puzzleSets; i++) found.append(el('div', { class: 'sg-tile', text: String(i + 1) }));
      screen.append(found);
    }

    const board = el('div', { class: 'sg-board' });
    const overlay = el(
      'div',
      { class: 'overlay sg-pause sg-hidden' },
      el('h2', { text: t('paused') }),
      el('p', { class: 'muted', text: t('pausedHint') }),
      button(t('resume'), () => setPaused(false), { variant: 'primary', size: 'lg' }),
    );
    board.append(overlay);
    screen.append(board);

    // controls
    const showHint = cfg.hints && mode !== 'blitz';
    const showNoSet = mode !== 'puzzle' && cfg.autoDealDelay > 0;
    let hintBtn: HTMLButtonElement | null = null;
    let noSetBtn: HTMLButtonElement | null = null;
    if (showHint || showNoSet) {
      const controls = el('div', { class: 'game-controls sg-controls' });
      if (showHint) {
        hintBtn = ctlButton('💡', t('hintBtn'), t('cost', { s: PENALTY.hint }), onHint);
        controls.append(hintBtn);
      }
      if (showNoSet) {
        noSetBtn = ctlButton('🙅', t('noSetBtn'), null, onNoSet);
        controls.append(noSetBtn);
      }
      screen.append(controls);
    }

    board.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const c = cardAt(e.clientX, e.clientY);
      if (c !== null) onCardTap(c);
    });
    board.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const slot = (e.target as Element).closest('.sg-slot') as HTMLElement | null;
      if (!slot || slot.classList.contains('sg-leaving')) return;
      e.preventDefault();
      onCardTap(Number(slot.dataset.card));
    });

    const ro = new ResizeObserver(() => renderBoard(false));
    view = {
      board,
      overlay,
      timeStat: time.wrap,
      timeVal: time.val,
      primaryStat: primary.wrap,
      primaryVal: primary.val,
      midStat: mid.wrap,
      midVal: mid.val,
      barFill,
      found,
      hintBtn,
      noSetBtn,
      ro,
      layout: null,
    };
    ro.observe(board);
    run.noSetSince = hasSet(table.board) ? null : 0;
    renderBoard(true);
    updateHud();
    startLoop();
  }

  // ── Board rendering ───────────────────────────────────────────────────
  function boardOffset(target: HTMLElement): { x: number; y: number } | null {
    if (!view) return null;
    const b = view.board.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top };
  }

  /**
   * Hit-test against the layout grid rather than the (possibly animating) DOM boxes, so a card can be
   * tapped where it is landing; taps in the gutter snap to the nearest card within half a gap.
   */
  function cardAt(clientX: number, clientY: number): number | null {
    if (!view || !view.layout) return null;
    const b = view.board.getBoundingClientRect();
    const px = clientX - b.left;
    const py = clientY - b.top;
    const tol = view.layout.gap / 2 + 1;
    let best: number | null = null;
    let bestD = Infinity;
    for (const [c, v] of views) {
      const r = v.rect;
      if (!r) continue;
      const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
      const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return bestD <= tol ? best : null;
  }

  function placeSlot(v: SlotView, r: Rect): void {
    v.rect = r;
    const s = v.el.style;
    s.left = r.x + 'px';
    s.top = r.y + 'px';
    s.width = r.w + 'px';
    s.height = r.h + 'px';
  }

  function makeSlot(c: number): SlotView {
    const inner = el('div', { class: `sg-card sg-k${decode(c).color}`, html: cardArt(c) });
    const node = el('div', { class: 'sg-slot', role: 'button', tabindex: '0', 'aria-label': cardLabel(c), dataset: { card: String(c) } }, inner);
    return { card: c, el: node, inner, rect: null };
  }

  function renderBoard(animate: boolean): void {
    if (!view || !run) return;
    const { board } = view;
    const W = board.clientWidth;
    const H = board.clientHeight;
    if (W < 10 || H < 10) return;
    const cards = run.table.board;
    const g = computeGrid(cards.length, W, H);
    view.layout = g;
    board.style.setProperty('--sg-radius', Math.round(Math.max(7, Math.min(14, g.w * 0.085))) + 'px');
    const anim = animate && !reduced;

    // read phase (FLIP "first")
    const bRect = anim ? board.getBoundingClientRect() : null;
    const first = new Map<number, Rect>();
    if (anim && bRect) {
      for (const [c, v] of views) {
        if (!v.rect) continue;
        const r = v.el.getBoundingClientRect();
        first.set(c, { x: r.left - bRect.left, y: r.top - bRect.top, w: r.width, h: r.height });
      }
    }
    const deckOrigin = anim && run.mode === 'classic' ? boardOffset(view.midVal) : null;
    const keep = new Set(cards);
    for (const [c, v] of views) {
      if (!keep.has(c)) {
        v.el.remove();
        views.delete(c);
      }
    }
    let k = 0;
    const initial = views.size === 0;
    cards.forEach((c, i) => {
      const r = slotRect(i, g);
      let v = views.get(c);
      if (!v) {
        v = makeSlot(c);
        views.set(c, v);
        placeSlot(v, r);
        board.insertBefore(v.el, view!.overlay);
        if (anim) {
          const delay = (initial ? 0 : 130) + k * (initial ? 40 : 55);
          k++;
          const s = 0.2;
          const from = deckOrigin
            ? `translate(${deckOrigin.x - r.x - (r.w * s) / 2}px, ${deckOrigin.y - r.y - (r.h * s) / 2}px) scale(${s})`
            : `translate(${r.w * 0.1}px, ${r.h * 0.1}px) scale(0.8)`;
          v.el.animate(
            [
              { transform: from, opacity: 0 },
              { opacity: 1, offset: 0.4 },
              { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
            ],
            { duration: deckOrigin ? 360 : 280, delay, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' },
          );
        }
        return;
      }
      const old = first.get(c);
      const moved = !v.rect || Math.abs(v.rect.x - r.x) > 0.5 || Math.abs(v.rect.y - r.y) > 0.5 || Math.abs(v.rect.w - r.w) > 0.5 || Math.abs(v.rect.h - r.h) > 0.5;
      if (!moved) return;
      v.el.getAnimations().forEach((a) => a.cancel());
      placeSlot(v, r);
      if (anim && old) {
        v.el.animate(
          [
            { transform: `translate(${old.x - r.x}px, ${old.y - r.y}px) scale(${old.w / r.w}, ${old.h / r.h})` },
            { transform: 'translate(0px, 0px) scale(1, 1)' },
          ],
          { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
      }
    });
    syncClasses();
  }

  function syncClasses(): void {
    if (!run) return;
    const hintCards = run.hint ? run.hint.cards.slice(0, run.hint.shown) : [];
    for (const [c, v] of views) {
      const sel = run.selected.includes(c);
      v.inner.classList.toggle('sel', sel);
      v.inner.classList.toggle('hint', hintCards.includes(c));
      v.el.setAttribute('aria-pressed', String(sel));
    }
  }

  function flyOut(cards: number[]): void {
    if (!view) return;
    const target = boardOffset(view.primaryVal);
    for (const c of cards) {
      const v = views.get(c);
      if (!v) continue;
      views.delete(c);
      v.el.classList.add('sg-leaving');
      v.el.removeAttribute('tabindex');
      v.inner.classList.remove('sel', 'hint');
      v.inner.classList.add('ok');
      const r = v.rect;
      if (reduced || !target || !r) {
        v.el.remove();
        continue;
      }
      const s = 0.16;
      const anim = v.el.animate(
        [
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0.3 },
          { transform: `translate(${target.x - r.x - (r.w * s) / 2}px, ${target.y - r.y - (r.h * s) / 2}px) scale(${s})`, opacity: 0.15 },
        ],
        { duration: 600, easing: 'cubic-bezier(.55,0,.75,.4)', fill: 'forwards' },
      );
      anim.onfinish = () => v.el.remove();
    }
  }

  function flash(cards: number[], cls: 'bad' | 'ok' | 'dup', shake: boolean): void {
    for (const c of cards) {
      const v = views.get(c);
      if (!v) continue;
      v.inner.classList.add(cls);
      if (shake && !reduced) {
        v.inner.animate(
          [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-7px)' },
            { transform: 'translateX(7px)' },
            { transform: 'translateX(-5px)' },
            { transform: 'translateX(4px)' },
            { transform: 'translateX(-2px)' },
            { transform: 'translateX(0)' },
          ],
          { duration: 380, easing: 'ease-out' },
        );
      }
      later(() => v.inner.classList.remove(cls), cls === 'ok' ? 650 : 480);
    }
  }

  function floatText(target: HTMLElement, text: string, good: boolean): void {
    if (reduced) return;
    const f = el('span', { class: 'sg-float ' + (good ? 'good' : 'bad'), text });
    target.append(f);
    const a = f.animate(
      [
        { transform: 'translate(-50%, 8px) scale(0.8)', opacity: 0 },
        { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.18 },
        { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.7 },
        { transform: 'translate(-50%, -5px) scale(1)', opacity: 0 },
      ],
      { duration: 1000, easing: 'ease-out', fill: 'forwards' },
    );
    a.onfinish = () => f.remove();
  }

  // ── HUD ───────────────────────────────────────────────────────────────
  function updateHud(): void {
    if (!run || !view) return;
    const r = run;
    if (r.mode === 'blitz') view.primaryVal.textContent = String(r.score);
    else if (r.mode === 'puzzle') view.primaryVal.textContent = `${r.foundKeys.size}/${r.puzzleTotal}`;
    else view.primaryVal.textContent = String(r.sets);
    if (r.mode === 'classic') view.midVal.textContent = String(r.table.deck.length);
    if (view.hintBtn) view.hintBtn.disabled = r.over;
    if (view.noSetBtn) view.noSetBtn.disabled = r.over;
    updateClock();
  }

  function updateClock(): void {
    if (!run || !view) return;
    const r = run;
    let shown: number;
    if (r.mode === 'blitz') {
      const rem = Math.max(0, BLITZ_SECONDS - r.active);
      shown = Math.ceil(rem - 1e-6);
      if (view.barFill) view.barFill.style.transform = `scaleX(${rem / BLITZ_SECONDS})`;
      view.timeStat.classList.toggle('sg-warn', rem <= 10 && !r.over);
      view.barFill?.classList.toggle('warn', rem <= 20);
      view.barFill?.classList.toggle('danger', rem <= 10);
    } else {
      shown = Math.floor(r.active + r.penalty);
    }
    if (shown !== r.shownClock) {
      r.shownClock = shown;
      view.timeVal.textContent = formatTime(shown);
    }
  }

  function applyEvent(ev: GameEvent): void {
    if (!run || !view) return;
    const res = scoreEvent(run.mode, ev);
    run.score += res.points;
    run.penalty += res.seconds;
    if (res.seconds) floatText(view.timeStat, t('penaltyFloat', { s: res.seconds }), false);
    if (res.points) floatText(view.primaryStat, (res.points > 0 ? '+' : '−') + Math.abs(res.points), res.points > 0);
    updateHud();
  }

  // ── Loop ──────────────────────────────────────────────────────────────
  function tick(now: number): void {
    const r = run;
    if (!r || r.over || !view) return;
    if (lastNow < 0) lastNow = now;
    const dt = Math.min(1, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    const frozen = r.paused || modalOpen();
    if (frozen !== frozenShown) {
      frozenShown = frozen;
      view.board.classList.toggle('sg-frozen', frozen);
    }
    if (frozen) return;
    r.active += dt;
    if (r.mode === 'blitz') {
      const rem = BLITZ_SECONDS - r.active;
      const sec = Math.ceil(rem);
      if (sec >= 1 && sec <= 5 && sec !== r.lastTick) {
        r.lastTick = sec;
        ctx.play('tick');
      }
      if (rem <= 0) {
        r.active = BLITZ_SECONDS;
        updateClock();
        finish();
        return;
      }
    }
    const delay = r.cfg.autoDealDelay;
    if (r.noSetSince !== null && delay > 0 && Number.isFinite(delay) && r.active - r.noSetSince >= delay) {
      ctx.toast(t('autoDealt'));
      dealExtra();
    }
    updateClock();
  }

  // ── Actions ───────────────────────────────────────────────────────────
  function canAct(): boolean {
    return !!run && !run.over && !!view && !isFrozen();
  }

  function onCardTap(c: number): void {
    if (!canAct() || !run) return;
    const r = run;
    if (!r.table.board.includes(c)) return;
    const i = r.selected.indexOf(c);
    if (i >= 0) {
      r.selected.splice(i, 1);
      ctx.play('tap');
      syncClasses();
      return;
    }
    r.selected.push(c);
    ctx.play('tap');
    ctx.haptic('light');
    syncClasses();
    if (r.selected.length === 3) resolveSelection();
  }

  function resolveSelection(): void {
    if (!run) return;
    const r = run;
    const sel = r.selected.slice(0, 3);
    r.selected = [];
    const [a, b, c] = sel;
    if (isSet(a, b, c)) {
      if (r.mode === 'puzzle') puzzleFound(sel);
      else setFound(sel);
      return;
    }
    r.mistakes++;
    syncClasses();
    flash(sel, 'bad', true);
    ctx.play('error');
    ctx.haptic('error');
    const list = failingAttrs(a, b, c)
      .map((x) => t('attr' + x))
      .join(t('listSep'));
    ctx.toast(t('notSet', { list }), 1500);
    applyEvent('wrong');
  }

  function setFound(sel: number[]): void {
    if (!run) return;
    const r = run;
    r.sets++;
    ctx.play('success');
    ctx.haptic('success');
    if (r.mode === 'blitz' && r.table.deck.length === 0) r.table = refillDeck(r.table, r.cfg.dims);
    const slots = sel.map((c) => r.table.board.indexOf(c));
    flyOut(sel);
    r.table = removeCards(r.table, slots, r.cfg.base).table;
    applyEvent('set');
    settle();
  }

  /** Called after every change of the cards on the table. */
  function settle(): void {
    if (!run) return;
    const r = run;
    r.hint = null;
    if (r.mode === 'blitz' && r.table.deck.length === 0) r.table = refillDeck(r.table, r.cfg.dims);
    if (r.mode !== 'puzzle' && r.cfg.autoDealDelay === 0 && !hasSet(r.table.board) && r.table.deck.length) {
      const res = autoDeal(r.table, maxBoard(r.cfg.dims));
      r.table = res.table;
      if (res.dealt.length) {
        ctx.toast(t('autoDealt'));
        later(() => ctx.play('swoosh'), 150);
      }
    }
    r.noSetSince = hasSet(r.table.board) ? null : r.active;
    renderBoard(true);
    updateHud();
    if (r.mode === 'classic' && isDeckCleared(r.table)) finish();
  }

  function dealExtra(): void {
    if (!run) return;
    const r = run;
    if (r.mode === 'blitz' && r.table.deck.length === 0) r.table = refillDeck(r.table, r.cfg.dims);
    if (!r.table.deck.length || r.table.board.length >= maxBoard(r.cfg.dims)) {
      r.noSetSince = null;
      if (r.mode === 'classic' && isDeckCleared(r.table)) finish();
      return;
    }
    r.table = deal(r.table, 3).table;
    ctx.play('swoosh');
    settle();
  }

  function onNoSet(): void {
    if (!canAct() || !run) return;
    const r = run;
    if (r.mode === 'puzzle' || r.cfg.autoDealDelay === 0) return;
    if (hasSet(r.table.board)) {
      r.mistakes++;
      ctx.play('error');
      ctx.haptic('error');
      ctx.toast(r.mode === 'blitz' ? t('noSetWrongPts') : t('noSetWrongTime', { s: PENALTY.noSetWrong }));
      applyEvent('noSetWrong');
      return;
    }
    ctx.haptic('medium');
    ctx.toast(t('noSetRight'));
    applyEvent('noSetRight');
    dealExtra();
  }

  function onHint(): void {
    if (!canAct() || !run) return;
    const r = run;
    if (!r.cfg.hints || r.mode === 'blitz') return;
    const board = r.table.board;
    if (r.hint && (r.hint.cards.some((c) => !board.includes(c)) || r.foundKeys.has(setKey(r.hint.cards)))) r.hint = null;
    if (!r.hint) {
      const s = pickHintSet(board, r.mode === 'puzzle' ? r.foundKeys : new Set());
      if (!s) {
        if (r.mode === 'puzzle') return;
        r.hints++;
        ctx.toast(t('hintNoSet', { s: PENALTY.hint }));
        applyEvent('hint');
        dealExtra();
        return;
      }
      r.hint = { cards: s, shown: 0 };
    }
    if (r.hint.shown >= 2) {
      ctx.toast(t('hintMax'));
      ctx.play('tap');
      return;
    }
    r.hint.shown++;
    r.hints++;
    ctx.play('pop');
    ctx.haptic('light');
    applyEvent('hint');
    syncClasses();
  }

  function puzzleFound(sel: number[]): void {
    if (!run || !view) return;
    const r = run;
    const key = setKey(sel);
    syncClasses();
    if (r.foundKeys.has(key)) {
      flash(sel, 'dup', true);
      ctx.play('error');
      ctx.haptic('light');
      ctx.toast(t('alreadyFound'), 1300);
      return;
    }
    r.foundKeys.add(key);
    r.sets++;
    ctx.play('success');
    ctx.haptic('success');
    flash(sel, 'ok', false);
    if (r.hint && setKey(r.hint.cards) === key) r.hint = null;
    syncClasses();
    const tile = view.found?.querySelector('.sg-tile:not(.filled)') as HTMLElement | null;
    if (tile) {
      tile.textContent = '';
      tile.classList.add('filled');
      [...sel].sort((x, y) => x - y).forEach((c) => tile.append(el('div', { class: `sg-mini sg-k${decode(c).color}`, html: cardArt(c) })));
      if (!reduced) tile.animate([{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }], { duration: 360, easing: 'ease-out' });
    }
    updateHud();
    if (r.foundKeys.size >= r.puzzleTotal) finish();
  }

  function setPaused(p: boolean): void {
    if (!run || run.over || !view) return;
    if (run.paused === p) return;
    run.paused = p;
    view.overlay.classList.toggle('sg-hidden', !p);
    view.board.classList.toggle('sg-frozen', p || modalOpen());
    frozenShown = p;
    lastNow = -1;
    if (p) ctx.play('tap');
  }

  function onRestart(): void {
    if (!run || run.over) {
      startGame();
      return;
    }
    ctx.showModal({
      title: t('restart'),
      body: t('restartConfirm'),
      buttons: [
        { label: t('cancel') },
        { label: t('menu'), onClick: () => showStart() },
        { label: t('restart'), primary: true, onClick: () => startGame() },
      ],
    });
  }

  // ── End of round ──────────────────────────────────────────────────────
  function finish(): void {
    if (!run || run.over) return;
    const r = run;
    r.over = true;
    r.selected = [];
    loop.stop();
    setHeader('over');
    syncClasses();
    updateHud();
    later(() => showResult(r), r.mode === 'blitz' ? 350 : 750);
  }

  function showResult(r: Run): void {
    const key = bestKey(r.mode, r.diff);
    const body = el('div', { class: 'sg-result' });
    let title: string;
    let isBest = false;
    if (r.mode === 'blitz') {
      title = t('timeUp');
      isBest = r.score > 0 && ctx.storage.recordBest(key, r.score, 'higher');
      body.append(el('div', { class: 'sg-big' }, el('span', { text: String(r.score) }), el('small', { text: ' ' + t('resSetsUnit') })));
      body.append(el('p', { class: 'muted', text: `${t('resSets', { n: r.sets })} · ${t('resMistakes', { n: r.mistakes })}` }));
    } else {
      title = r.mode === 'puzzle' ? t('puzzleSolved') : t('deckCleared');
      const total = Math.round((r.active + r.penalty) * 10) / 10;
      isBest = ctx.storage.recordBest(key, total, 'lower');
      body.append(el('div', { class: 'sg-big', text: fmtPrecise(total) }));
      if (r.penalty > 0) body.append(el('p', { class: 'muted', text: t('resPenalty', { s: r.penalty }) }));
      const stats = [t('resSets', { n: r.sets }), t('resMistakes', { n: r.mistakes })];
      if (r.cfg.hints) stats.push(t('resHints', { n: r.hints }));
      body.append(el('p', { class: 'muted', text: stats.join(' · ') }));
      if (r.mode === 'classic' && r.table.board.length) body.append(el('p', { class: 'muted small', text: t('resLeft', { n: r.table.board.length }) }));
    }
    body.append(el('p', { class: 'sg-res-best' }, isBest ? el('strong', { class: 'sg-newbest', text: '🏆 ' + t('newBest') }) : t('resBest', { v: bestShortPrecise(r.mode, r.diff) })));
    body.prepend(el('p', { class: 'sg-res-mode muted small', text: `${t(r.mode)} · ${t(r.diff)}` }));
    const good = r.mode !== 'blitz' || r.score > 0;
    ctx.play(good ? 'win' : 'lose');
    ctx.haptic(good ? 'success' : 'error');
    ctx.showModal({
      title,
      body,
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        { label: t('menu'), onClick: () => showStart() },
        { label: t('playAgain'), primary: true, onClick: () => startGame() },
      ],
    });
  }

  function bestShortPrecise(m: Mode, d: Diff): string {
    const b = ctx.storage.getBest(bestKey(m, d));
    if (b === null) return '—';
    return m === 'blitz' ? String(b) : fmtPrecise(b);
  }

  // ── Global listeners ──────────────────────────────────────────────────
  const onKey = (e: KeyboardEvent) => {
    if (!run || run.over || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (run.selected.length) {
        run.selected = [];
        syncClasses();
      }
    } else if (k === 'p') setPaused(!run.paused);
    else if (k === 'h') onHint();
    else if (k === 'n') onNoSet();
  };
  window.addEventListener('keydown', onKey);

  ctx.onVisibility((visible) => {
    if (!visible) {
      if (run && !run.over) setPaused(true);
      loop.stop();
    } else if (run && !run.over) {
      startLoop();
    }
  });

  ctx.onDestroy(() => {
    destroyed = true;
    loop.stop();
    clearTimers();
    teardownView();
    window.removeEventListener('keydown', onKey);
    headerOff.forEach((off) => off());
    headerOff = [];
  });

  showStart();

  return {
    destroy() {
      destroyed = true;
      loop.stop();
      clearTimers();
      teardownView();
      window.removeEventListener('keydown', onKey);
    },
  };
}

const game: GameModule = { strings, create };
export default game;
