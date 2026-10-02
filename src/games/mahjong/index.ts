import type { GameContext, GameInstance, GameModule, ThemeName } from '../../app/types';
import { el, button, segmented, toggle, formatTime } from '../../app/ui';
import { createCanvas, createLoop, onPointer, roundRect } from '../../app/canvas';
import {
  LAYOUTS,
  countPairs,
  computeMetrics,
  drawOrder,
  generateBoard,
  hitTestTolerant,
  isFree,
  layoutBounds,
  matches,
  pickHint,
  rankOf,
  reshuffle,
  suitOf,
  tileRect,
  type LayoutId,
  type Metrics,
  type Tile,
} from './logic';
import './style.css';

const HINT_PENALTY = 15;
const SHUFFLE_PENALTY = 30;
const MAX_SHUFFLES = 2;

const strings = {
  zh: {
    rules:
      '目标：两两配对消除所有麻将牌。\n可选的牌：上面没有牌压着，并且左边或右边至少有一侧没有紧挨着的牌。\n点击两张可选且相同的牌即可消除；花牌（梅兰菊竹）互相可配，季牌（春夏秋冬）互相可配，其余必须完全相同。\n每局保证有解，但同一种牌有四张时，消错顺序仍可能陷入死局——先想清楚再出手。\n提示会闪烁一对可消的牌，但计时 +15 秒；洗牌最多 2 次，每次 +30 秒；撤销不受惩罚。\n用时越短越好，三种布局分别记录最佳成绩。',
    desc: '点选两张可移动的相同牌将它们消除，清空整副牌。',
    chooseLayout: '选择布局',
    modeSmall: '金字塔 72',
    modeMedium: '城堡 100',
    modeLarge: '乌龟 144',
    layoutSmall: '金字塔',
    layoutMedium: '城堡',
    layoutLarge: '乌龟',
    descSmall: '72 张 · 3 层 · 热身局',
    descMedium: '100 张 · 3 层 · 城墙与主堡',
    descLarge: '144 张 · 5 层 · 经典乌龟全牌',
    bestLine: '最佳 {time} · 已通关 {n} 次',
    noBest: '尚无纪录，快来创造吧',
    dimBlocked: '压暗不可选的牌',
    tilesLeft: '剩余',
    pairsLeft: '可配对',
    hintBtn: '提示',
    shuffleBtn: '洗牌 {n}',
    status: '{layout} · 洗牌剩 {n} 次',
    hintPenalty: '提示 +{n} 秒',
    shufflePenalty: '已洗牌 +{n} 秒',
    noShuffles: '洗牌次数已用完',
    nothingToUndo: '没有可撤销的操作',
    blockedTile: '这张牌被挡住了',
    noMoves: '没有可消除的牌了',
    noMovesBody: '剩余 {n} 张牌没有可配对的组合。可以洗牌（+{p} 秒）、撤销几步，或重新开始。',
    noMovesNoShuffle: '剩余 {n} 张牌没有可配对的组合，洗牌次数已用完。撤销几步或重新开始。',
    shuffleAction: '洗牌 ({n})',
    winBody: '清空了全部 {n} 张牌！',
    finalTime: '最终用时',
    penalties: '含惩罚：提示 {h} 次 · 洗牌 {s} 次（+{p} 秒）',
    bestTime: '最佳 {time}',
    restartConfirm: '当前进度将丢失，确定重新开始？',
    legendFlower: '花牌互配',
    legendSeason: '季牌互配',
  },
  en: {
    rules:
      'Goal: clear the whole board by removing matching pairs.\nA tile is FREE when nothing lies on top of it and at least one of its left or right sides has no tile touching it.\nTap two free matching tiles to remove them. Any flower matches any flower, any season matches any season; all other tiles must be identical.\nEvery deal is solvable, but with four tiles of a kind the wrong pair can still lead to a dead end — think before you tap.\nHint flashes a playable pair (+15 s). Shuffle re-deals the remaining tiles (max 2, +30 s each). Undo is free.\nFastest clear wins; each layout keeps its own best time.',
    desc: 'Tap two free matching tiles to remove them and clear the board.',
    chooseLayout: 'Choose a layout',
    modeSmall: 'Pyramid 72',
    modeMedium: 'Fortress 100',
    modeLarge: 'Turtle 144',
    layoutSmall: 'Pyramid',
    layoutMedium: 'Fortress',
    layoutLarge: 'Turtle',
    descSmall: '72 tiles · 3 layers · warm-up',
    descMedium: '100 tiles · 3 layers · walls and a keep',
    descLarge: '144 tiles · 5 layers · the classic full set',
    bestLine: 'Best {time} · cleared {n}×',
    noBest: 'No record yet — set one!',
    dimBlocked: 'Dim blocked tiles',
    tilesLeft: 'Tiles',
    pairsLeft: 'Pairs',
    hintBtn: 'Hint',
    shuffleBtn: 'Shuffle {n}',
    status: '{layout} · shuffles left: {n}',
    hintPenalty: 'Hint +{n} s',
    shufflePenalty: 'Shuffled +{n} s',
    noShuffles: 'No shuffles left',
    nothingToUndo: 'Nothing to undo',
    blockedTile: 'That tile is blocked',
    noMoves: 'No moves left',
    noMovesBody: '{n} tiles remain but none can be paired. Shuffle (+{p} s), undo a few moves, or restart.',
    noMovesNoShuffle: '{n} tiles remain but none can be paired, and no shuffles are left. Undo a few moves or restart.',
    shuffleAction: 'Shuffle ({n})',
    winBody: 'All {n} tiles cleared!',
    finalTime: 'Final time',
    penalties: 'Incl. penalties: hints ×{h} · shuffles ×{s} (+{p} s)',
    bestTime: 'Best {time}',
    restartConfirm: 'Current progress will be lost. Restart?',
    legendFlower: 'Flowers pair together',
    legendSeason: 'Seasons pair together',
  },
};

// ── Tile artwork ──────────────────────────────────────────────────────────

interface Palette {
  face: string;
  faceFlower: string;
  faceSeason: string;
  side: string;
  edge: string;
  ink: string;
  red: string;
  green: string;
  blue: string;
  magenta: string;
  orange: string;
  dim: string;
  table: string;
  accent: string;
  warning: string;
  success: string;
  bg: string;
}

function makePalette(theme: ThemeName, cssVar: (n: string) => string): Palette {
  const accent = cssVar('--accent') || '#5b8cff';
  const warning = cssVar('--warning') || '#ffc857';
  const success = cssVar('--success') || '#3ddc97';
  if (theme === 'dark') {
    return {
      face: '#353d53',
      faceFlower: '#42385a',
      faceSeason: '#4b3f33',
      side: '#161a25',
      edge: '#4b556c',
      ink: '#f2f4f9',
      red: '#ff6d7c',
      green: '#5fd38d',
      blue: '#84b2ff',
      magenta: '#ff85d8',
      orange: '#ffad5c',
      dim: 'rgba(15, 18, 24, 0.5)',
      table: '#161b26',
      accent,
      warning,
      success,
      bg: '#0f1218',
    };
  }
  return {
    face: '#fffdf4',
    faceFlower: '#fbe8f3',
    faceSeason: '#fff0da',
    side: '#b8b2a0',
    edge: '#e4dfcf',
    ink: '#1c2130',
    red: '#c81e35',
    green: '#1e8c4d',
    blue: '#1f4fc1',
    magenta: '#bf1a7e',
    orange: '#d8700a',
    dim: 'rgba(244, 246, 251, 0.5)',
    table: '#e8ecf4',
    accent,
    warning,
    success,
    bg: '#f4f6fb',
  };
}

const CJK_FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC","Noto Sans CJK SC","WenQuanYi Zen Hei",sans-serif';
const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WINDS = ['東', '南', '西', '北'];
const DRAGONS = ['中', '發', '白'];
const FLOWERS = ['梅', '蘭', '菊', '竹'];
const SEASONS = ['春', '夏', '秋', '冬'];

/** Grid cells (col, row) for dots / bamboo of rank n. Rows span 0..2 (or 0..3 for 4-row patterns). */
const DOT_GRID: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [1, 0],
    [1, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
  7: [
    [0, 0],
    [1, 0.5],
    [2, 1],
    [0, 2],
    [2, 2],
    [0, 3],
    [2, 3],
  ],
  8: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
    [0, 3],
    [2, 3],
  ],
  9: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
};
const BAM_GRID: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [1, 0],
    [1, 2],
  ],
  3: [
    [1, 0],
    [0, 2],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  7: [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  8: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  9: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
};

function rowsOf(cells: [number, number][]): number {
  let max = 0;
  for (const [, r] of cells) max = Math.max(max, r);
  return max > 2 ? 4 : 3;
}

/** Draw one tile face (background + glyph) at (0,0) with size w×h. */
function drawFace(g: CanvasRenderingContext2D, kind: number, w: number, h: number, p: Palette): void {
  const suit = suitOf(kind);
  const rank = rankOf(kind);
  const rad = w * 0.13;
  g.fillStyle = suit === 'flower' ? p.faceFlower : suit === 'season' ? p.faceSeason : p.face;
  roundRect(g, 0, 0, w, h, rad);
  g.fill();
  g.strokeStyle = p.edge;
  g.lineWidth = 1;
  roundRect(g, 0.5, 0.5, w - 1, h - 1, rad);
  g.stroke();

  const mx = w * 0.15;
  const my = h * 0.13;
  const iw = w - mx * 2;
  const ih = h - my * 2;
  const colors = [p.green, p.red, p.blue];

  if (suit === 'dot') {
    const cells = DOT_GRID[rank];
    const rows = rowsOf(cells);
    if (rank === 1) {
      const r = Math.min(iw, ih) * 0.34;
      const cx = w / 2;
      const cy = h / 2;
      g.fillStyle = p.green;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = p.face;
      g.beginPath();
      g.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = p.red;
      g.beginPath();
      g.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
      g.fill();
    } else {
      const r = (Math.min(iw / 3, ih / rows) / 2) * 0.76;
      cells.forEach(([c, rr], i) => {
        const cx = mx + (c + 0.5) * (iw / 3);
        const cy = my + (rr + 0.5) * (ih / rows);
        g.fillStyle = colors[i % 3];
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = p.face;
        g.beginPath();
        g.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
        g.fill();
      });
    }
  } else if (suit === 'bam') {
    const cells = BAM_GRID[rank];
    const rows = rowsOf(cells);
    const cw = iw / 3;
    const ch = ih / rows;
    if (rank === 1) {
      // single bamboo: one tall stick with leaves
      const sw = w * 0.2;
      const sh = ih * 0.82;
      const x = w / 2 - sw / 2;
      const y = h / 2 - sh / 2;
      g.fillStyle = p.green;
      roundRect(g, x, y, sw, sh, sw / 2);
      g.fill();
      g.fillStyle = p.face;
      g.fillRect(x, y + sh * 0.33, sw, Math.max(1, sh * 0.05));
      g.fillRect(x, y + sh * 0.66, sw, Math.max(1, sh * 0.05));
      g.fillStyle = p.red;
      g.beginPath();
      g.ellipse(w / 2 + sw * 0.9, y + sh * 0.25, sw * 0.7, sw * 0.32, -0.6, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(w / 2 - sw * 0.9, y + sh * 0.5, sw * 0.7, sw * 0.32, 0.6, 0, Math.PI * 2);
      g.fill();
    } else {
      const sw = cw * 0.46;
      const sh = ch * 0.8;
      cells.forEach(([c, rr], i) => {
        const x = mx + (c + 0.5) * cw - sw / 2;
        const y = my + (rr + 0.5) * ch - sh / 2;
        g.fillStyle = rank >= 5 && i % 3 === 1 ? p.red : i % 3 === 2 && rank >= 7 ? p.blue : p.green;
        roundRect(g, x, y, sw, sh, sw / 2);
        g.fill();
        g.fillStyle = p.face;
        g.fillRect(x, y + sh * 0.36, sw, Math.max(1, sh * 0.08));
        g.fillRect(x, y + sh * 0.64, sw, Math.max(1, sh * 0.08));
      });
    }
  } else if (suit === 'char') {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = p.blue;
    g.font = `700 ${Math.round(h * 0.34)}px ${CJK_FONT}`;
    g.fillText(NUMERALS[rank - 1], w / 2, h * 0.3);
    g.fillStyle = p.red;
    g.font = `700 ${Math.round(h * 0.36)}px ${CJK_FONT}`;
    g.fillText('萬', w / 2, h * 0.7);
  } else if (suit === 'dragon' && rank === 2) {
    // white dragon: a hollow blue frame
    const lw = Math.max(2, w * 0.07);
    g.strokeStyle = p.blue;
    g.lineWidth = lw;
    roundRect(g, mx + lw, my + lw, iw - lw * 2, ih - lw * 2, w * 0.08);
    g.stroke();
    g.lineWidth = Math.max(1, lw * 0.4);
    roundRect(g, mx + lw * 2.6, my + lw * 2.6, iw - lw * 5.2, ih - lw * 5.2, w * 0.05);
    g.stroke();
  } else {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let ch = '';
    let color = p.ink;
    if (suit === 'wind') ch = WINDS[rank];
    else if (suit === 'dragon') {
      ch = DRAGONS[rank];
      color = rank === 0 ? p.red : p.green;
    } else if (suit === 'flower') {
      ch = FLOWERS[rank];
      color = p.magenta;
    } else {
      ch = SEASONS[rank];
      color = p.orange;
    }
    g.fillStyle = color;
    g.font = `700 ${Math.round(w * 0.62)}px ${CJK_FONT}`;
    g.fillText(ch, w / 2, h * 0.52);
    if (suit === 'flower' || suit === 'season') {
      // small corner tag so the group is recognisable at a glance
      g.font = `600 ${Math.max(7, Math.round(w * 0.2))}px ${CJK_FONT}`;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillText(suit === 'flower' ? '花' : '季', w * 0.1, h * 0.06);
    }
  }
}

// ── Game ──────────────────────────────────────────────────────────────────

interface RemoveAnim {
  tile: Tile;
  t: number;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

const MODE_KEYS: Record<LayoutId, { mode: string; layout: string; desc: string }> = {
  small: { mode: 'modeSmall', layout: 'layoutSmall', desc: 'descSmall' },
  medium: { mode: 'modeMedium', layout: 'layoutMedium', desc: 'descMedium' },
  large: { mode: 'modeLarge', layout: 'layoutLarge', desc: 'descLarge' },
};

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  let mode: LayoutId = ctx.storage.get<LayoutId>('mode', 'small');
  if (!(mode in LAYOUTS)) mode = 'small';
  let dimBlocked = ctx.storage.get<boolean>('dim', true);
  let pal = makePalette(ctx.theme, ctx.cssVar);

  // game state
  let screen: 'start' | 'game' = 'start';
  let tiles: Tile[] = [];
  let solution: [number, number][] = [];
  let totalTiles = 0;
  let freeIds = new Set<number>();
  let pairs = 0;
  let selected: Tile | null = null;
  let history: { a: Tile; b: Tile }[] = [];
  let hintPair: [Tile, Tile] | null = null;
  let hintUntil = 0;
  let shufflesLeft = MAX_SHUFFLES;
  let hintsUsed = 0;
  let shufflesUsed = 0;
  let penalty = 0;
  let elapsed = 0;
  let lastNow = 0;
  let finished = false;
  let modalOpen = false;
  let lastShownSecond = -1;

  // rendering
  let metrics: Metrics | null = null;
  let dirty = true;
  const faceCache = new Map<number, HTMLCanvasElement>();
  const removeAnims: RemoveAnim[] = [];
  const particles: Particle[] = [];
  let shake: { tile: Tile; t: number } | null = null;
  let flash = 0; // shuffle fade-in
  let timers: number[] = [];

  let cv: ReturnType<typeof createCanvas> | null = null;
  let offPointer: (() => void) | null = null;
  let hud: { tiles: HTMLElement; pairs: HTMLElement; time: HTMLElement; shuffleBtn: HTMLButtonElement; hintBtn: HTMLButtonElement } | null = null;

  const loop = createLoop((_dt, now) => tick(now));

  const removeUndo = ctx.addHeaderAction({ icon: '↶', label: t('undo'), onClick: () => undo() });
  const removeRestart = ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: () => requestRestart() });

  ctx.onDestroy(() => {
    removeUndo();
    removeRestart();
    teardownGame();
  });
  ctx.onVisibility((visible) => {
    if (screen !== 'game') return;
    if (visible) {
      lastNow = performance.now();
      dirty = true;
      loop.start();
    } else {
      loop.stop();
    }
  });
  ctx.onThemeChange((theme) => {
    pal = makePalette(theme, ctx.cssVar);
    faceCache.clear();
    dirty = true;
    if (screen === 'game' && !loop.running) draw();
  });

  function later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      timers = timers.filter((x) => x !== id);
      fn();
    }, ms);
    timers.push(id);
  }

  function teardownGame(): void {
    loop.stop();
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    hud = null;
    for (const id of timers) clearTimeout(id);
    timers = [];
    removeAnims.length = 0;
    particles.length = 0;
    shake = null;
    faceCache.clear();
  }

  // ── Start screen ───────────────────────────────────────────────────────
  function showStart(): void {
    teardownGame();
    screen = 'start';
    finished = true;
    ctx.setStatus('');
    root.innerHTML = '';
    const desc = el('p', { class: 'muted small', text: t(MODE_KEYS[mode].desc) });
    const bestLine = el('p', { class: 'muted small' });
    const updateBest = () => {
      const b = ctx.storage.getBest(mode);
      const clears = ctx.storage.get<Record<string, number>>('clears', {})[mode] ?? 0;
      bestLine.textContent = b === null ? t('noBest') : t('bestLine', { time: formatTime(b), n: clears });
    };
    updateBest();
    root.append(
      el(
        'div',
        { class: 'start-screen' },
        el('div', { class: 'big-icon', text: '🀄' }),
        el('h2', { text: t('chooseLayout') }),
        el('p', { class: 'muted', text: t('desc') }),
        segmented<LayoutId>(
          [
            { value: 'small', label: t('modeSmall') },
            { value: 'medium', label: t('modeMedium') },
            { value: 'large', label: t('modeLarge') },
          ],
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            desc.textContent = t(MODE_KEYS[m].desc);
            updateBest();
          },
        ),
        desc,
        bestLine,
        el(
          'div',
          { class: 'mj-option' },
          toggle(t('dimBlocked'), dimBlocked, (v) => {
            dimBlocked = v;
            ctx.storage.set('dim', v);
          }),
        ),
        el('div', { class: 'mj-legend' }, el('span', { text: '🌸 ' + t('legendFlower') }), el('span', { text: '🍂 ' + t('legendSeason') })),
        button(t('play'), () => startGame(), { variant: 'primary', size: 'lg' }),
      ),
    );
  }

  // ── Game screen ────────────────────────────────────────────────────────
  function startGame(): void {
    teardownGame();
    screen = 'game';
    const positions = LAYOUTS[mode];
    const board = generateBoard(positions);
    tiles = board.tiles;
    solution = board.solution;
    totalTiles = tiles.length;
    selected = null;
    history = [];
    hintPair = null;
    hintUntil = 0;
    shufflesLeft = MAX_SHUFFLES;
    hintsUsed = 0;
    shufflesUsed = 0;
    penalty = 0;
    elapsed = 0;
    finished = false;
    modalOpen = false;
    lastShownSecond = -1;
    flash = 0.45;

    root.innerHTML = '';
    const area = el('div', { class: 'mj-area' });
    const stat = (label: string) => {
      const value = el('div', { class: 'mj-stat-value', text: '0' });
      return { value, node: el('div', { class: 'mj-stat' }, el('div', { class: 'mj-stat-label', text: label }), value) };
    };
    const sTiles = stat(t('tilesLeft'));
    const sPairs = stat(t('pairsLeft'));
    const sTime = stat(t('time'));
    const hintBtn = button(t('hintBtn'), () => hint(), { variant: 'secondary', icon: '💡' });
    const shuffleBtn = button(t('shuffleBtn', { n: shufflesLeft }), () => shuffle(), { variant: 'secondary', icon: '🔀' });
    const bar = el(
      'div',
      { class: 'mj-bar' },
      el('div', { class: 'mj-stats' }, sTiles.node, sPairs.node, sTime.node),
      el('div', { class: 'mj-actions' }, hintBtn, shuffleBtn),
    );
    root.append(area, bar);
    hud = { tiles: sTiles.value, pairs: sPairs.value, time: sTime.value, shuffleBtn, hintBtn };

    const bounds = layoutBounds(positions);
    cv = createCanvas(area, (w, h) => {
      metrics = computeMetrics(bounds, w, h, 6);
      faceCache.clear();
      dirty = true;
    });
    offPointer = onPointer(cv.canvas, {
      down(p) {
        handleTap(p.x, p.y);
      },
    });
    recompute();
    updateHud();
    updateStatus();
    lastNow = performance.now();
    dirty = true;
    loop.start();
    ctx.play('swoosh');
  }

  function recompute(): void {
    freeIds = new Set<number>();
    for (const tile of tiles) if (isFree(tile, tiles)) freeIds.add(tile.id);
    pairs = countPairs(tiles);
    dirty = true;
  }

  function updateStatus(): void {
    ctx.setStatus(t('status', { layout: t(MODE_KEYS[mode].layout), n: shufflesLeft }));
  }

  function updateHud(): void {
    if (!hud) return;
    hud.tiles.textContent = String(tiles.length);
    hud.pairs.textContent = String(pairs);
    hud.pairs.classList.toggle('mj-warn', pairs <= 1 && tiles.length > 0);
    const label = hud.shuffleBtn.lastElementChild;
    if (label) label.textContent = t('shuffleBtn', { n: shufflesLeft });
    hud.shuffleBtn.disabled = shufflesLeft <= 0 || finished;
    hud.hintBtn.disabled = finished;
    updateTime(true);
  }

  function updateTime(force = false): void {
    if (!hud) return;
    const total = Math.floor(elapsed + penalty);
    if (force || total !== lastShownSecond) {
      lastShownSecond = total;
      hud.time.textContent = formatTime(total);
    }
  }

  // ── Interaction ────────────────────────────────────────────────────────
  function handleTap(px: number, py: number): void {
    if (screen !== 'game' || finished || !metrics || modalOpen) return;
    const tile = hitTestTolerant(tiles, px, py, metrics, 6);
    if (!tile) {
      if (selected) {
        selected = null;
        dirty = true;
        ctx.play('tap');
      }
      return;
    }
    if (!freeIds.has(tile.id)) {
      shake = { tile, t: 0 };
      dirty = true;
      ctx.play('error');
      ctx.haptic('error');
      return;
    }
    if (selected === tile) {
      selected = null;
      dirty = true;
      ctx.play('tap');
      return;
    }
    if (selected && matches(selected.kind, tile.kind)) {
      removePair(selected, tile);
      return;
    }
    selected = tile;
    dirty = true;
    ctx.play('tap');
    ctx.haptic('light');
  }

  function removePair(a: Tile, b: Tile): void {
    tiles = tiles.filter((x) => x !== a && x !== b);
    history.push({ a, b });
    removeAnims.push({ tile: a, t: 0 }, { tile: b, t: 0 });
    selected = null;
    if (hintPair && (hintPair[0] === a || hintPair[0] === b || hintPair[1] === a || hintPair[1] === b)) hintPair = null;
    ctx.play('pop');
    ctx.haptic('light');
    recompute();
    updateHud();
    checkState();
  }

  function undo(): void {
    if (screen !== 'game' || finished || modalOpen) return;
    const last = history.pop();
    if (!last) {
      ctx.toast(t('nothingToUndo'));
      return;
    }
    tiles.push(last.a, last.b);
    selected = null;
    hintPair = null;
    ctx.play('move');
    recompute();
    updateHud();
  }

  function hint(): void {
    if (screen !== 'game' || finished || modalOpen) return;
    const pair = pickHint(tiles);
    if (!pair) {
      showNoMoves();
      return;
    }
    hintPair = pair;
    hintUntil = performance.now() + 1800;
    selected = null;
    hintsUsed++;
    penalty += HINT_PENALTY;
    dirty = true;
    ctx.play('tick');
    ctx.haptic('medium');
    ctx.toast(t('hintPenalty', { n: HINT_PENALTY }));
    updateTime(true);
  }

  function shuffle(): void {
    if (screen !== 'game' || finished || modalOpen) return;
    if (shufflesLeft <= 0) {
      ctx.toast(t('noShuffles'));
      ctx.play('error');
      return;
    }
    if (tiles.length < 2) return;
    const res = reshuffle(tiles);
    tiles = res.tiles;
    solution = res.solution;
    shufflesLeft--;
    shufflesUsed++;
    penalty += SHUFFLE_PENALTY;
    history = [];
    selected = null;
    hintPair = null;
    flash = 0.45;
    ctx.play('swoosh');
    ctx.haptic('medium');
    ctx.toast(t('shufflePenalty', { n: SHUFFLE_PENALTY }));
    recompute();
    updateHud();
    updateStatus();
    checkState();
  }

  function checkState(): void {
    if (tiles.length === 0) {
      finishWin();
      return;
    }
    if (pairs === 0) later(() => showNoMoves(), 420);
  }

  function showNoMoves(): void {
    if (modalOpen || finished || screen !== 'game' || tiles.length === 0 || pairs > 0) return;
    modalOpen = true;
    ctx.play('lose');
    ctx.haptic('heavy');
    const buttons = [];
    if (shufflesLeft > 0) {
      buttons.push({
        label: t('shuffleAction', { n: shufflesLeft }),
        primary: true,
        onClick: () => {
          modalOpen = false;
          shuffle();
        },
      });
    }
    if (history.length) {
      buttons.push({
        label: t('undo'),
        primary: shufflesLeft <= 0,
        onClick: () => {
          modalOpen = false;
          undo();
        },
      });
    }
    buttons.push({
      label: t('restart'),
      onClick: () => {
        modalOpen = false;
        startGame();
      },
    });
    if (buttons.length < 3) buttons.unshift({ label: t('home'), onClick: () => ctx.exit() });
    ctx.showModal({
      title: t('noMoves'),
      body: shufflesLeft > 0 ? t('noMovesBody', { n: tiles.length, p: SHUFFLE_PENALTY }) : t('noMovesNoShuffle', { n: tiles.length }),
      dismissible: false,
      buttons,
    });
  }

  function finishWin(): void {
    finished = true;
    const total = Math.floor(elapsed + penalty);
    const isBest = ctx.storage.recordBest(mode, total, 'lower');
    const clears = ctx.storage.get<Record<string, number>>('clears', {});
    clears[mode] = (clears[mode] ?? 0) + 1;
    ctx.storage.set('clears', clears);
    updateHud();
    ctx.play('win');
    ctx.haptic('success');
    spawnParticles();
    later(() => {
      modalOpen = true;
      const best = ctx.storage.getBest(mode);
      const body = el(
        'div',
        { class: 'mj-result' },
        el('p', { text: t('winBody', { n: totalTiles }) }),
        el('p', { class: 'muted small', text: t('finalTime') }),
        el('div', { class: 'mj-big', text: formatTime(total) }),
        hintsUsed || shufflesUsed
          ? el('p', { class: 'muted small', text: t('penalties', { h: hintsUsed, s: shufflesUsed, p: hintsUsed * HINT_PENALTY + shufflesUsed * SHUFFLE_PENALTY }) })
          : null,
        isBest ? el('p', { text: '🏆 ' + t('newBest') }) : best !== null ? el('p', { class: 'muted small', text: t('bestTime', { time: formatTime(best) }) }) : null,
      );
      ctx.showModal({
        title: t('congratulations'),
        body,
        dismissible: false,
        buttons: [
          { label: t('home'), onClick: () => ctx.exit() },
          {
            label: t('newGame'),
            primary: true,
            onClick: () => {
              modalOpen = false;
              startGame();
            },
          },
        ],
      });
    }, 900);
  }

  function requestRestart(): void {
    if (screen !== 'game' || modalOpen) return;
    if (finished || history.length === 0) {
      showStart();
      return;
    }
    modalOpen = true;
    ctx.showModal({
      title: t('restart'),
      body: t('restartConfirm'),
      buttons: [
        {
          label: t('cancel'),
          onClick: () => {
            modalOpen = false;
          },
        },
        {
          label: t('confirm'),
          primary: true,
          onClick: () => {
            modalOpen = false;
            showStart();
          },
        },
      ],
    });
  }

  function spawnParticles(): void {
    if (!cv) return;
    const cx = cv.width / 2;
    const cy = cv.height / 2;
    const colors = [pal.red, pal.green, pal.blue, pal.orange, pal.magenta, pal.warning];
    for (let i = 0; i < 90; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 140 + Math.random() * 260;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 120,
        life: 1.2 + Math.random() * 0.8,
        color: colors[i % colors.length],
        size: 4 + Math.random() * 5,
      });
    }
    dirty = true;
  }

  // ── Loop & drawing ─────────────────────────────────────────────────────
  function tick(now: number): void {
    const dt = Math.min(1, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    if (!finished && !modalOpen) {
      elapsed += dt;
      updateTime();
    }
    let animating = false;
    for (let i = removeAnims.length - 1; i >= 0; i--) {
      removeAnims[i].t += dt;
      if (removeAnims[i].t >= 0.24) removeAnims.splice(i, 1);
    }
    if (removeAnims.length) animating = true;
    if (shake) {
      shake.t += dt;
      if (shake.t > 0.35) shake = null;
      animating = true;
    }
    if (flash > 0) {
      flash = Math.max(0, flash - dt);
      animating = true;
    }
    if (particles.length) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.vy += 420 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
      animating = true;
    }
    if (hintPair && now > hintUntil) {
      hintPair = null;
      dirty = true;
    }
    if (selected || hintPair) animating = true;
    if (animating || dirty) draw(now);
  }

  function face(kind: number): HTMLCanvasElement {
    let c = faceCache.get(kind);
    if (c || !metrics || !cv) return c ?? document.createElement('canvas');
    const dpr = cv.dpr;
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(metrics.w * dpr));
    c.height = Math.max(1, Math.ceil(metrics.h * dpr));
    const g = c.getContext('2d');
    if (g) {
      g.scale(dpr, dpr);
      drawFace(g, kind, metrics.w, metrics.h, pal);
    }
    faceCache.set(kind, c);
    return c;
  }

  function draw(now = performance.now()): void {
    if (!cv || !metrics) return;
    dirty = false;
    const g = cv.ctx;
    const m = metrics;
    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);
    const rad = m.w * 0.13;
    // table panel behind the board
    const pad = Math.max(6, m.w * 0.18);
    g.fillStyle = pal.table;
    roundRect(g, m.ox - pad, m.oy - pad, W - 2 * m.ox + 2 * pad, H - 2 * m.oy + 2 * pad, pad * 1.4);
    g.fill();
    const ordered = drawOrder(tiles);
    const alpha = flash > 0 ? 0.2 + 0.8 * (1 - flash / 0.45) : 1;
    g.globalAlpha = alpha;
    for (const tile of ordered) {
      const r = tileRect(tile, m);
      let dx = 0;
      if (shake && shake.tile === tile) dx = Math.sin(shake.t * 55) * 3 * (1 - shake.t / 0.35);
      g.fillStyle = pal.side;
      roundRect(g, r.x + dx + m.lift, r.y + m.lift, r.w, r.h, rad);
      g.fill();
      g.drawImage(face(tile.kind), r.x + dx, r.y, r.w, r.h);
      if (dimBlocked && !freeIds.has(tile.id)) {
        g.fillStyle = pal.dim;
        roundRect(g, r.x + dx, r.y, r.w, r.h, rad);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    // highlights
    if (selected && tiles.includes(selected)) {
      const r = tileRect(selected, m);
      const pulse = 0.65 + 0.35 * Math.sin(now / 140);
      g.fillStyle = pal.accent;
      g.globalAlpha = 0.22 * pulse + 0.08;
      roundRect(g, r.x, r.y, r.w, r.h, rad);
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = pal.accent;
      g.lineWidth = 3;
      roundRect(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, rad);
      g.stroke();
    }
    if (hintPair) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 90);
      for (const tile of hintPair) {
        if (!tiles.includes(tile)) continue;
        const r = tileRect(tile, m);
        g.strokeStyle = pal.warning;
        g.lineWidth = 3 + pulse * 2;
        roundRect(g, r.x - 1, r.y - 1, r.w + 2, r.h + 2, rad);
        g.stroke();
        g.fillStyle = pal.warning;
        g.globalAlpha = 0.18 + 0.2 * pulse;
        roundRect(g, r.x, r.y, r.w, r.h, rad);
        g.fill();
        g.globalAlpha = 1;
      }
    }
    // removal animations
    for (const a of removeAnims) {
      const r = tileRect(a.tile, m);
      const e = Math.min(1, a.t / 0.24);
      const s = 1 + 0.25 * e;
      g.globalAlpha = 1 - e;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2 - 10 * e;
      g.drawImage(face(a.tile.kind), cx - (r.w * s) / 2, cy - (r.h * s) / 2, r.w * s, r.h * s);
    }
    g.globalAlpha = 1;
    for (const p of particles) {
      g.globalAlpha = Math.max(0, Math.min(1, p.life));
      g.fillStyle = p.color;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    g.globalAlpha = 1;
  }

  // Dev-only hook for automated interaction tests (stripped from production builds).
  if (import.meta.env.DEV) {
    const w = window as unknown as { __mj?: unknown };
    w.__mj = {
      tiles: () => tiles.map((x) => ({ ...x })),
      metrics: () => metrics,
      free: () => [...freeIds],
      solution: () => solution.slice(),
      pairs: () => pairs,
      elapsed: () => elapsed + penalty,
    };
    ctx.onDestroy(() => {
      delete w.__mj;
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
