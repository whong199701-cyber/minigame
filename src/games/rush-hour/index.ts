import type { GameContext, GameInstance, GameModule } from '../../app/types';
import { el, button, segmented } from '../../app/ui';
import { createCanvas, createLoop, onPointer, roundRect, clamp, type CanvasHandle } from '../../app/canvas';
import {
  DIFFICULTIES,
  EXIT_ROW,
  GOAL_POS,
  RED,
  SIZE,
  applyMove,
  bankSize,
  exploreDistances,
  getPuzzle,
  isSolved,
  nextMove,
  slideRange,
  stars as starsFor,
  vehicleAt,
  type Difficulty,
  type Move,
  type Puzzle,
  type Vehicle,
} from './logic';
import './style.css';

const strings = {
  zh: {
    rules:
      '6×6 的停车场里，红色小车必须从右侧出口驶出。\n每辆车只能沿自己的方向（横向或纵向）滑动，不能转弯、不能穿过其他车。\n按住一辆车拖动即可移动；松手后自动停到最近的格子。\n一次滑动（不论距离）算 1 步。步数越接近「最优」越好：等于最优 ⭐⭐⭐，超出 3 步以内 ⭐⭐，其余 ⭐。\n想不出来可以撤销、重置或用「提示」查看最优的下一步。\n难度按最优步数划分：简单 5–10 · 中等 11–18 · 困难 19–30 · 专家 31+。\n通关后解锁下一关，每个难度的进度分别保存。',
    desc: '滑动车辆，让红车驶出停车场',
    easyDesc: '最优 5–10 步 · 8–10 辆车',
    mediumDesc: '最优 11–18 步 · 8–11 辆车',
    hardDesc: '最优 19–30 步 · 9–13 辆车',
    expertDesc: '最优 31 步以上 · 10–13 辆车',
    levelN: '第 {n} 关',
    par: '最优',
    movesPar: '步数 / 最优',
    bestLabel: '最佳',
    levelBest: '最佳 {n} 步',
    unsolved: '尚未通关',
    progress: '已通关 {n} 关 · 完美 {p} 关',
    noProgress: '还没有通关记录',
    levels: '关卡',
    reset: '重置',
    resultMoves: '用了 {m} 步 · 最优 {p} 步',
    starPerfect: '完美！这就是最优解。',
    starGood: '不错，离最优只差一点。',
    starOk: '通关了！再试试更少的步数。',
    hintsUsed: '用了 {n} 次提示',
    hintToast: '沿箭头滑动高亮的车',
    hintNone: '暂时没有提示',
    undoNothing: '没有可撤销的步骤',
    generating: '正在生成关卡…',
    prevLevel: '上一关',
    nextLevelLabel: '下一关',
    exit: '出口',
  },
  en: {
    rules:
      'The red car is stuck in a 6×6 parking lot and must leave through the exit on the right.\nEvery vehicle slides only along its own axis (horizontal or vertical); no turning, no passing through others.\nPress a vehicle and drag it; it snaps to the nearest cell when you let go.\nOne slide of any distance = 1 move. Match the par for ⭐⭐⭐, finish within par + 3 for ⭐⭐, otherwise ⭐.\nStuck? Undo, reset, or use Hint to see the optimal next move.\nDifficulty is the optimal move count: easy 5–10 · medium 11–18 · hard 19–30 · expert 31+.\nClearing a level unlocks the next; progress is saved per difficulty.',
    desc: 'Slide the cars and free the red one',
    easyDesc: 'Par 5–10 · 8–10 vehicles',
    mediumDesc: 'Par 11–18 · 8–11 vehicles',
    hardDesc: 'Par 19–30 · 9–13 vehicles',
    expertDesc: 'Par 31+ · 10–13 vehicles',
    levelN: 'Level {n}',
    par: 'Par',
    movesPar: 'Moves / par',
    bestLabel: 'Best',
    levelBest: 'Best {n} moves',
    unsolved: 'Unsolved',
    progress: '{n} levels cleared · {p} perfect',
    noProgress: 'No levels cleared yet',
    levels: 'Levels',
    reset: 'Reset',
    resultMoves: '{m} moves · par {p}',
    starPerfect: 'Perfect — that is the optimal solution.',
    starGood: 'Nice, just short of optimal.',
    starOk: 'Solved! Try it again in fewer moves.',
    hintsUsed: '{n} hints used',
    hintToast: 'Slide the highlighted vehicle along the arrow',
    hintNone: 'No hint available right now',
    undoNothing: 'Nothing to undo',
    generating: 'Generating level…',
    prevLevel: 'Previous level',
    nextLevelLabel: 'Next level',
    exit: 'EXIT',
  },
};

// ── Colours ──────────────────────────────────────────────────────────────

const PALETTE = ['#4f8cff', '#3ec9a7', '#f5a623', '#a78bfa', '#f472b6', '#84cc16', '#22d3ee', '#fb923c', '#facc15', '#60a5fa', '#c084fc', '#34d399', '#94a3b8'];
const RED_COLOR = '#ff3b4e';
const shadeCache = new Map<string, string>();

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes a hex colour toward white (amt > 0) or black (amt < 0). */
function shade(hex: string, amt: number): string {
  const key = hex + '|' + amt;
  const cached = shadeCache.get(key);
  if (cached) return cached;
  const rgb = hexToRgb(hex);
  let out = hex;
  if (rgb) {
    const t = amt > 0 ? 255 : 0;
    const a = Math.min(1, Math.abs(amt));
    out = `rgb(${rgb.map((c) => Math.round(c + (t - c) * a)).join(',')})`;
  }
  shadeCache.set(key, out);
  return out;
}

function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : hex;
}

// ── Persistence ──────────────────────────────────────────────────────────

interface LevelResult {
  stars: number;
  moves: number;
}
interface DiffProgress {
  cleared: number;
  results: Record<string, LevelResult>;
}
type Progress = Partial<Record<Difficulty, DiffProgress>>;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
  color: string;
  size: number;
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  let mode: Difficulty = ctx.storage.get<Difficulty>('mode', 'easy');
  if (!DIFFICULTIES.includes(mode)) mode = 'easy';
  let progress: Progress = ctx.storage.get<Progress>('progress', {});
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const progressFor = (d: Difficulty): DiffProgress => {
    const p = progress[d];
    return p && typeof p.cleared === 'number' && p.results ? p : { cleared: 0, results: {} };
  };
  const selectedLevel = (d: Difficulty): number => {
    const p = progressFor(d);
    const saved = ctx.storage.get<number>('level:' + d, p.cleared + 1);
    return clamp(Math.floor(saved) || 1, 1, p.cleared + 1);
  };

  // ── Game state ────────────────────────────────────────────────────────
  let puzzle: Puzzle | null = null;
  let vehicles: Vehicle[] = [];
  let pos: number[] = [];
  let vis: number[] = [];
  let history: number[][] = [];
  let hint: Move | null = null;
  let hintsUsed = 0;
  let distances: Map<number, number> | null | undefined;
  let finished = false;
  let exitT = -1; // seconds since the red car started driving out; -1 = not exiting
  let resultShown = false;
  let particles: Particle[] = [];
  let drag: { id: number; pointerId: number; origin: number; startPos: number; min: number; max: number } | null = null;

  // ── Canvas / layout ───────────────────────────────────────────────────
  let cv: CanvasHandle | null = null;
  let offPointer: (() => void) | null = null;
  let loop: ReturnType<typeof createLoop> | null = null;
  let gameActive = false;
  let generateTimer = 0;
  const headerRemovers: (() => void)[] = [];
  let cell = 50;
  let wall = 8;
  let bx = 0;
  let by = 0;
  let colors = readColors();

  function readColors() {
    return {
      bg: ctx.cssVar('--bg') || '#0f1218',
      surface: ctx.cssVar('--surface') || '#1a1f2b',
      surface2: ctx.cssVar('--surface-2') || '#232a39',
      border: ctx.cssVar('--border') || '#2d3548',
      text: ctx.cssVar('--text') || '#e8ecf3',
      muted: ctx.cssVar('--muted') || '#8b94a7',
      accent: ctx.cssVar('--accent') || '#5b8cff',
      success: ctx.cssVar('--success') || '#3ddc97',
      dark: ctx.theme === 'dark',
    };
  }
  ctx.onThemeChange(() => {
    colors = readColors();
  });
  ctx.onVisibility((visible) => {
    if (!gameActive || !loop) return;
    if (visible) loop.start();
    else loop.stop();
  });
  ctx.onDestroy(() => teardownGame());

  function layout(w: number, h: number): void {
    const pad = 12;
    const side = Math.max(60, Math.min(w, h) - pad * 2);
    wall = clamp(Math.round(side * 0.03), 6, 12);
    cell = Math.floor((side - wall * 2) / SIZE);
    const board = cell * SIZE;
    bx = Math.round((w - board) / 2);
    by = Math.round((h - board) / 2);
  }

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    teardownGame();
    root.innerHTML = '';
    ctx.setStatus('');
    let level = selectedLevel(mode);

    const diffDesc = el('p', { class: 'muted small rh-diff-desc', text: t(mode + 'Desc') });
    const levelLabel = el('div', { class: 'rh-level-label' });
    const levelBest = el('div', { class: 'muted small rh-level-best' });
    const progressLine = el('p', { class: 'muted small rh-progress' });
    const prevBtn = button('‹', () => changeLevel(-1), { variant: 'secondary', class: 'rh-arrow' });
    const nextBtn = button('›', () => changeLevel(1), { variant: 'secondary', class: 'rh-arrow' });
    prevBtn.setAttribute('aria-label', t('prevLevel'));
    nextBtn.setAttribute('aria-label', t('nextLevelLabel'));

    const refresh = () => {
      const p = progressFor(mode);
      level = clamp(level, 1, p.cleared + 1);
      ctx.storage.set('level:' + mode, level);
      levelLabel.textContent = t('levelN', { n: level });
      const r = p.results[level];
      levelBest.textContent = r ? `${starText(r.stars)} · ${t('levelBest', { n: r.moves })}` : t('unsolved');
      const perfect = Object.values(p.results).filter((x) => x.stars === 3).length;
      progressLine.textContent = p.cleared > 0 ? t('progress', { n: p.cleared, p: perfect }) : t('noProgress');
      prevBtn.disabled = level <= 1;
      nextBtn.disabled = level > p.cleared;
      diffDesc.textContent = t(mode + 'Desc');
    };
    const changeLevel = (delta: number) => {
      const p = progressFor(mode);
      const next = level + delta;
      if (next < 1 || next > p.cleared + 1) return;
      level = next;
      refresh();
    };

    root.append(
      el(
        'div',
        { class: 'start-screen rh-start' },
        el('div', { class: 'big-icon', text: '🚗' }),
        el('p', { class: 'muted rh-desc', text: t('desc') }),
        segmented<Difficulty>(
          DIFFICULTIES.map((d) => ({ value: d, label: t(d) })),
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            level = selectedLevel(m);
            refresh();
          },
        ),
        diffDesc,
        el('div', { class: 'rh-level-row' }, prevBtn, el('div', { class: 'rh-level-mid' }, levelLabel, levelBest), nextBtn),
        progressLine,
        button(t('play'), () => startLevel(mode, level), { variant: 'primary', size: 'lg', class: 'rh-play' }),
      ),
    );
    refresh();
  }

  function starText(n: number): string {
    return '⭐'.repeat(clamp(n, 0, 3)) + '☆'.repeat(3 - clamp(n, 0, 3));
  }

  // ── Game screen ───────────────────────────────────────────────────────
  let hudLevel: HTMLElement;
  let hudMoves: HTMLElement;
  let hudBest: HTMLElement;
  let undoBtns: HTMLButtonElement[] = [];

  function teardownGame(): void {
    gameActive = false;
    clearTimeout(generateTimer);
    loop?.stop();
    loop = null;
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    headerRemovers.splice(0).forEach((fn) => fn());
    drag = null;
    undoBtns = [];
  }

  function startLevel(d: Difficulty, level: number): void {
    teardownGame();
    mode = d;
    ctx.storage.set('mode', d);
    ctx.storage.set('level:' + d, level);
    root.innerHTML = '';
    ctx.setStatus(t('levelN', { n: level }));

    const hud = el('div', { class: 'game-hud rh-hud' });
    hudLevel = el('div', { class: 'stat-value' });
    hudMoves = el('div', { class: 'stat-value' });
    hudBest = el('div', { class: 'stat-value rh-best' });
    hud.append(
      el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: t('level') }), hudLevel),
      el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: t('movesPar') }), hudMoves),
      el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: t('bestLabel') }), hudBest),
    );
    const area = el('div', { class: 'game-area rh-area' });
    const undoBtn = button(t('undo'), undo, { variant: 'secondary', class: 'rh-ctl' });
    const controls = el(
      'div',
      { class: 'game-controls rh-controls' },
      button(t('levels'), () => showStart(), { variant: 'secondary', class: 'rh-ctl' }),
      undoBtn,
      button(t('reset'), reset, { variant: 'secondary', class: 'rh-ctl' }),
      button(t('hint'), showHint, { variant: 'secondary', class: 'rh-ctl' }),
    );
    root.append(hud, area, controls);
    undoBtns = [undoBtn];

    headerRemovers.push(ctx.addHeaderAction({ icon: '↶', label: t('undo'), onClick: undo }));
    headerRemovers.push(ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: reset }));

    gameActive = true;
    cv = createCanvas(area, layout);
    offPointer = onPointer(cv.canvas, { down: onDown, move: onMove, up: onUp, cancel: onCancel });
    loop = createLoop(update);
    colors = readColors();

    // Load the puzzle. Bank levels are instant; beyond the bank the generator may take a moment,
    // so let the frame paint (and the toast show) first.
    puzzle = null;
    const bankLevel = level <= bankSize(d);
    const load = () => {
      if (!gameActive) return;
      loadPuzzle(getPuzzle(d, level));
    };
    if (bankLevel) load();
    else {
      ctx.toast(t('generating'));
      generateTimer = window.setTimeout(load, 40);
    }
    if (document.visibilityState !== 'hidden') loop.start();
    draw();
  }

  function loadPuzzle(p: Puzzle): void {
    puzzle = p;
    vehicles = p.vehicles;
    pos = p.start.slice();
    vis = p.start.slice();
    history = [];
    hint = null;
    hintsUsed = 0;
    distances = undefined;
    finished = false;
    exitT = -1;
    resultShown = false;
    pending = null;
    particles = [];
    drag = null;
    updateHud();
  }

  function updateHud(): void {
    if (!puzzle) return;
    const moves = history.length;
    hudLevel.textContent = String(puzzle.level);
    hudMoves.textContent = `${moves} / ${puzzle.par}`;
    hudMoves.classList.toggle('rh-over', moves > puzzle.par);
    const r = progressFor(puzzle.difficulty).results[puzzle.level];
    hudBest.textContent = r ? `${'⭐'.repeat(r.stars)} ${r.moves}` : '—';
    ctx.setStatus(`${t('levelN', { n: puzzle.level })} · ${moves} / ${puzzle.par}`);
    for (const b of undoBtns) b.disabled = moves === 0 || finished;
  }

  // ── Actions ───────────────────────────────────────────────────────────
  function commitMove(id: number, to: number): void {
    if (!puzzle || finished || to === pos[id]) return;
    history.push(pos.slice());
    pos = applyMove(pos, { id, from: pos[id], to });
    hint = null;
    ctx.play('move');
    ctx.haptic('light');
    updateHud();
    if (isSolved(pos)) win();
  }

  function undo(): void {
    if (!puzzle || finished || drag) return;
    const prev = history.pop();
    if (!prev) {
      ctx.toast(t('undoNothing'));
      return;
    }
    pos = prev;
    hint = null;
    ctx.play('pop');
    updateHud();
  }

  function reset(): void {
    if (!puzzle || drag) return;
    if (finished && exitT >= 0 && !resultShown) return; // let the exit animation finish
    pos = puzzle.start.slice();
    vis = puzzle.start.slice();
    history = [];
    hint = null;
    finished = false;
    exitT = -1;
    resultShown = false;
    pending = null;
    particles = [];
    ctx.play('swoosh');
    ctx.haptic('medium');
    updateHud();
  }

  function showHint(): void {
    if (!puzzle || finished || drag) return;
    if (distances === undefined) distances = exploreDistances(vehicles, pos);
    const m = nextMove(vehicles, pos, distances);
    if (!m) {
      ctx.toast(t('hintNone'));
      ctx.play('error');
      return;
    }
    hint = m;
    hintsUsed++;
    ctx.play('tap');
    ctx.toast(t('hintToast'));
  }

  function win(): void {
    if (!puzzle) return;
    finished = true;
    exitT = 0;
    drag = null;
    ctx.play('win');
    ctx.haptic('success');
    spawnConfetti();
    recordResult();
    updateHud();
    if (reduceMotion) showResult();
  }

  let pending: { stars: 1 | 2 | 3; moves: number; isBest: boolean } | null = null;

  /** Persists the result immediately (the modal may be deferred until the drive-out animation ends). */
  function recordResult(): void {
    if (!puzzle) return;
    const moves = history.length;
    const s = starsFor(moves, puzzle.par);
    const d = puzzle.difficulty;
    const p = progressFor(d);
    const prev = p.results[puzzle.level];
    if (!prev || s > prev.stars || moves < prev.moves) {
      p.results[puzzle.level] = { stars: Math.max(s, prev?.stars ?? 0), moves: Math.min(moves, prev?.moves ?? Infinity) };
    }
    p.cleared = Math.max(p.cleared, puzzle.level);
    progress = { ...progress, [d]: p };
    ctx.storage.set('progress', progress);
    ctx.storage.recordBest(d, p.cleared, 'higher');
    const isBest = ctx.storage.recordBest(`${d}:${puzzle.level}`, moves, 'lower');
    pending = { stars: s, moves, isBest };
  }

  function showResult(): void {
    if (!puzzle || resultShown || !pending) return;
    resultShown = true;
    const { stars: s, moves, isBest } = pending;
    const d = puzzle.difficulty;
    const body = el(
      'div',
      { class: 'rh-result' },
      el('div', { class: 'rh-result-stars', text: starText(s) }),
      el('p', { text: t('resultMoves', { m: moves, p: puzzle.par }) }),
      el('p', { class: 'muted', text: t(s === 3 ? 'starPerfect' : s === 2 ? 'starGood' : 'starOk') }),
      hintsUsed > 0 ? el('p', { class: 'muted small', text: t('hintsUsed', { n: hintsUsed }) }) : null,
      isBest ? el('p', { class: 'rh-new-best', text: '🏆 ' + t('newBest') }) : null,
    );
    const level = puzzle.level;
    ctx.showModal({
      title: t('levelComplete'),
      body,
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        { label: t('retry'), onClick: () => startLevel(d, level) },
        { label: t('nextLevel'), primary: true, onClick: () => startLevel(d, level + 1) },
      ],
    });
  }

  // ── Pointer ───────────────────────────────────────────────────────────
  function onDown(p: { x: number; y: number; id: number }): void {
    if (!puzzle || finished || drag) return;
    const col = Math.floor((p.x - bx) / cell);
    const row = Math.floor((p.y - by) / cell);
    const id = vehicleAt(vehicles, pos, row, col);
    if (id < 0) return;
    const v = vehicles[id];
    const { min, max } = slideRange(vehicles, pos, id);
    drag = { id, pointerId: p.id, origin: v.horiz ? p.x : p.y, startPos: pos[id], min, max };
    vis[id] = pos[id];
    ctx.play('tap');
  }

  function onMove(p: { x: number; y: number; id: number }): void {
    if (!drag || p.id !== drag.pointerId) return;
    const v = vehicles[drag.id];
    const delta = ((v.horiz ? p.x : p.y) - drag.origin) / cell;
    vis[drag.id] = clamp(drag.startPos + delta, drag.min, drag.max);
  }

  function onUp(p: { x: number; y: number; id: number }): void {
    if (!drag || p.id !== drag.pointerId) return;
    const { id, min, max } = drag;
    drag = null;
    const to = clamp(Math.round(vis[id]), min, max);
    if (to !== pos[id]) commitMove(id, to);
  }

  function onCancel(p: { x: number; y: number; id: number }): void {
    if (!drag || p.id !== drag.pointerId) return;
    drag = null;
  }

  // ── Animation ─────────────────────────────────────────────────────────
  function spawnConfetti(): void {
    if (reduceMotion) return;
    const x = bx + SIZE * cell + wall;
    const y = by + (EXIT_ROW + 0.5) * cell;
    for (let i = 0; i < 36; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 180 + Math.random() * 260;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        life: 1.1 + Math.random() * 0.6,
        color: i % 5 === 0 ? RED_COLOR : PALETTE[i % PALETTE.length],
        size: 5 + Math.random() * 5,
      });
    }
  }

  function update(dt: number): void {
    if (!cv) return;
    // Ease visual positions toward logical ones (except the dragged vehicle).
    const k = reduceMotion ? 1 : Math.min(1, dt * 16);
    for (let i = 0; i < vis.length; i++) {
      if (drag && drag.id === i) continue;
      if (finished && i === RED && exitT >= 0) continue;
      const diff = pos[i] - vis[i];
      vis[i] = Math.abs(diff) < 0.004 ? pos[i] : vis[i] + diff * k;
    }
    if (finished && exitT >= 0) {
      exitT += dt;
      // Accelerate out through the exit.
      const speed = 3 + exitT * 14;
      vis[RED] = Math.min(GOAL_POS + 4, vis[RED] + speed * dt);
      if (exitT > (reduceMotion ? 0 : 0.75)) showResult();
    }
    if (particles.length) {
      for (const q of particles) {
        q.life -= dt;
        q.vy += 520 * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.rot += q.vr * dt;
      }
      particles = particles.filter((q) => q.life > 0);
    }
    draw();
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function draw(): void {
    if (!cv) return;
    const g = cv.ctx;
    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);
    drawBoard(g);
    if (!puzzle) return;
    const order: number[] = [];
    for (let i = 0; i < vehicles.length; i++) if (!drag || drag.id !== i) order.push(i);
    if (drag) order.push(drag.id);
    const now = performance.now() / 1000;
    if (hint && !finished) drawHintTarget(g, hint);
    for (const i of order) drawVehicle(g, vehicles[i], vis[i], i, now);
    if (hint && !finished) drawHintArrow(g, hint, now);
    drawParticles(g);
  }

  function drawBoard(g: CanvasRenderingContext2D): void {
    const board = cell * SIZE;
    const c = colors;
    // Wall frame.
    g.fillStyle = c.dark ? shade(c.border, 0.08) : shade(c.border, -0.08);
    roundRect(g, bx - wall, by - wall, board + wall * 2, board + wall * 2, wall * 1.6);
    g.fill();
    // Lot surface.
    g.fillStyle = c.surface;
    g.fillRect(bx, by, board, board);
    // Exit lane tint.
    g.fillStyle = withAlpha(c.accent, c.dark ? 0.1 : 0.08);
    g.fillRect(bx, by + EXIT_ROW * cell, board, cell);
    // Grid.
    g.strokeStyle = withAlpha(c.border, c.dark ? 0.9 : 1);
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < SIZE; i++) {
      const x = bx + i * cell + 0.5;
      const y = by + i * cell + 0.5;
      g.moveTo(x, by);
      g.lineTo(x, by + board);
      g.moveTo(bx, y);
      g.lineTo(bx + board, y);
    }
    g.stroke();
    // Exit gap in the right wall.
    const gx = bx + board;
    const gy = by + EXIT_ROW * cell;
    g.fillStyle = c.bg;
    g.fillRect(gx, gy + 2, wall + 1, cell - 4);
    g.fillStyle = withAlpha(c.accent, c.dark ? 0.1 : 0.08);
    g.fillRect(gx, gy + 2, wall + 1, cell - 4);
    // Chevrons pointing out.
    g.strokeStyle = c.success;
    g.lineWidth = Math.max(2, cell * 0.06);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const cxh = gx + wall / 2;
    const cy = gy + cell / 2;
    const s = Math.max(3, wall * 0.42);
    g.beginPath();
    g.moveTo(cxh - s, cy - s * 1.6);
    g.lineTo(cxh + s * 0.4, cy);
    g.lineTo(cxh - s, cy + s * 1.6);
    g.stroke();
    // EXIT label just outside the wall, if there is room.
    if (cv && cv.width - (gx + wall) > 30) {
      g.fillStyle = c.success;
      g.font = `700 ${Math.max(9, Math.round(cell * 0.2))}px -apple-system, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.save();
      g.translate(gx + wall + 11, cy);
      g.rotate(-Math.PI / 2);
      g.fillText(t('exit'), 0, 0);
      g.restore();
    }
  }

  function drawVehicle(g: CanvasRenderingContext2D, v: Vehicle, p: number, id: number, now: number): void {
    const color = id === RED ? RED_COLOR : PALETTE[(id - 1) % PALETTE.length];
    const lifted = drag?.id === id;
    const hinted = hint?.id === id && !finished;
    const L = v.len * cell;
    const cx = v.horiz ? bx + (p + v.len / 2) * cell : bx + (v.lane + 0.5) * cell;
    const cy = v.horiz ? by + (v.lane + 0.5) * cell : by + (p + v.len / 2) * cell;
    const gap = Math.max(3, cell * 0.09);
    const w = L - gap * 2;
    const h = cell - gap * 2;
    const x0 = -w / 2;
    const y0 = -h / 2;
    const r = h * 0.3;
    g.save();
    g.translate(cx, cy);
    if (!v.horiz) g.rotate(Math.PI / 2);
    if (lifted) g.scale(1.05, 1.05);
    if (id === RED && exitT >= 0) g.globalAlpha = clamp(1 - (p - GOAL_POS - 1.2) / 1.6, 0, 1);

    // Wheels (peek out above and below the body).
    g.fillStyle = colors.dark ? '#0b0e14' : '#2a2f3a';
    const ww = h * 0.24;
    const wh = h * 0.2;
    const axles = v.len === 3 ? [0.16, 0.5, 0.84] : [0.22, 0.78];
    for (const a of axles) {
      const ax = x0 + w * a - ww / 2;
      roundRect(g, ax, y0 - wh * 0.35, ww, wh, wh / 2);
      g.fill();
      roundRect(g, ax, y0 + h - wh * 0.65, ww, wh, wh / 2);
      g.fill();
    }

    // Body with soft shadow.
    g.save();
    g.shadowColor = `rgba(0,0,0,${lifted ? 0.45 : 0.28})`;
    g.shadowBlur = lifted ? 18 : 6;
    g.shadowOffsetY = lifted ? 8 : 2;
    const grad = g.createLinearGradient(0, y0, 0, y0 + h);
    grad.addColorStop(0, shade(color, 0.28));
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, shade(color, -0.18));
    g.fillStyle = grad;
    roundRect(g, x0, y0, w, h, r);
    g.fill();
    g.restore();
    g.strokeStyle = shade(color, -0.42);
    g.lineWidth = 1.4;
    roundRect(g, x0, y0, w, h, r);
    g.stroke();

    // Cabin / glass.
    const glass = colors.dark ? 'rgba(205,228,255,0.78)' : 'rgba(225,240,255,0.95)';
    if (v.len === 2) {
      // Car: central cabin with two windows.
      const cw = w * 0.46;
      const cxx = x0 + (w - cw) / 2;
      g.fillStyle = shade(color, -0.3);
      roundRect(g, cxx, y0 + h * 0.12, cw, h * 0.76, r * 0.7);
      g.fill();
      g.fillStyle = glass;
      roundRect(g, cxx + cw * 0.08, y0 + h * 0.2, cw * 0.36, h * 0.6, 3);
      g.fill();
      roundRect(g, cxx + cw * 0.56, y0 + h * 0.2, cw * 0.36, h * 0.6, 3);
      g.fill();
    } else {
      // Truck: cargo box on the left, cab with a windscreen on the right.
      g.fillStyle = shade(color, -0.22);
      roundRect(g, x0 + w * 0.05, y0 + h * 0.1, w * 0.6, h * 0.8, r * 0.5);
      g.fill();
      g.strokeStyle = shade(color, 0.25);
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 1; k <= 3; k++) {
        const lx = x0 + w * (0.05 + 0.15 * k);
        g.moveTo(lx, y0 + h * 0.18);
        g.lineTo(lx, y0 + h * 0.82);
      }
      g.stroke();
      g.fillStyle = shade(color, -0.32);
      roundRect(g, x0 + w * 0.7, y0 + h * 0.12, w * 0.25, h * 0.76, r * 0.6);
      g.fill();
      g.fillStyle = glass;
      roundRect(g, x0 + w * 0.74, y0 + h * 0.22, w * 0.1, h * 0.56, 3);
      g.fill();
    }

    // Headlights on the red car (front faces the exit).
    if (id === RED) {
      g.fillStyle = '#fff4b0';
      g.shadowColor = 'rgba(255,244,176,0.9)';
      g.shadowBlur = 8;
      g.beginPath();
      g.arc(x0 + w - 3, y0 + h * 0.26, h * 0.075, 0, Math.PI * 2);
      g.arc(x0 + w - 3, y0 + h * 0.74, h * 0.075, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = '#7a0f1c';
      g.beginPath();
      g.arc(x0 + 3, y0 + h * 0.26, h * 0.06, 0, Math.PI * 2);
      g.arc(x0 + 3, y0 + h * 0.74, h * 0.06, 0, Math.PI * 2);
      g.fill();
    }

    // Hint pulse.
    if (hinted) {
      g.globalAlpha = 0.55 + 0.45 * Math.sin(now * 6);
      g.strokeStyle = colors.accent;
      g.lineWidth = 3;
      roundRect(g, x0 - 3, y0 - 3, w + 6, h + 6, r + 3);
      g.stroke();
    }
    g.restore();
  }

  function drawHintTarget(g: CanvasRenderingContext2D, m: Move): void {
    const v = vehicles[m.id];
    g.fillStyle = withAlpha(colors.accent, 0.22);
    const x = v.horiz ? bx + m.to * cell : bx + v.lane * cell;
    const y = v.horiz ? by + v.lane * cell : by + m.to * cell;
    const w = v.horiz ? v.len * cell : cell;
    const h = v.horiz ? cell : v.len * cell;
    roundRect(g, x + 3, y + 3, w - 6, h - 6, cell * 0.22);
    g.fill();
  }

  function drawHintArrow(g: CanvasRenderingContext2D, m: Move, now: number): void {
    const v = vehicles[m.id];
    const dir = Math.sign(m.to - m.from);
    const dist = Math.abs(m.to - m.from) * cell;
    const cx = v.horiz ? bx + (vis[m.id] + v.len / 2) * cell : bx + (v.lane + 0.5) * cell;
    const cy = v.horiz ? by + (v.lane + 0.5) * cell : by + (vis[m.id] + v.len / 2) * cell;
    const bob = (Math.sin(now * 5) + 1) * 3;
    g.save();
    g.translate(cx, cy);
    if (!v.horiz) g.rotate(Math.PI / 2);
    const start = (v.len * cell) / 2 - cell * 0.1;
    const end = start + Math.max(cell * 0.35, dist - cell * 0.15) + bob;
    const sx = dir * start;
    const ex = dir * end;
    g.strokeStyle = colors.accent;
    g.fillStyle = colors.accent;
    g.lineWidth = Math.max(3, cell * 0.08);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(sx, 0);
    g.lineTo(ex, 0);
    g.stroke();
    const head = Math.max(6, cell * 0.18);
    g.beginPath();
    g.moveTo(ex + dir * head * 0.6, 0);
    g.lineTo(ex - dir * head * 0.6, -head * 0.7);
    g.lineTo(ex - dir * head * 0.6, head * 0.7);
    g.closePath();
    g.fill();
    g.restore();
  }

  function drawParticles(g: CanvasRenderingContext2D): void {
    for (const q of particles) {
      g.save();
      g.globalAlpha = clamp(q.life, 0, 1);
      g.translate(q.x, q.y);
      g.rotate(q.rot);
      g.fillStyle = q.color;
      g.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2);
      g.restore();
    }
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
