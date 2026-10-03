import type { GameContext, GameInstance, GameModule, Lang, ModalButton, ModalHandle, ThemeName } from '../../app/types';
import { el, button, segmented, toggle, formatTime } from '../../app/ui';
import { createCanvas, createLoop, onPointer, roundRect } from '../../app/canvas';
import {
  BOARDS,
  LAYOUTS,
  boardFor,
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
  type Board,
  type BoardId,
  type LayoutId,
  type Metrics,
  type Tile,
} from './logic';
import './style.css';

const HINT_PENALTY = 15;
const SHUFFLE_PENALTY = 30;
const MAX_SHUFFLES = 2;
/** Board padding inside the canvas (CSS px); the table panel is drawn inside it. */
const BOARD_PAD = 6;
/** Fixed HUD sizes (must match style.css): bottom bar height in portrait, side bar width in landscape. */
const BAR_H = 50;
const BAR_W = 92;
/**
 * Below this game width four header icons would squeeze the shell's title to nothing, so 🔀 moves out of
 * the header and the HUD's shuffle counter becomes a button instead.
 */
const NARROW_W = 370;

const strings = {
  zh: {
    rules:
      '目标：两两配对消除所有牌，用时越短越好。\n可选的牌：上面没有牌压着，且左右至少一侧没有紧挨着的牌（可设置把不可选的牌压暗）。\n点击两张可选的相同牌即可消除；花牌（梅兰菊竹，左上角有小花）互相可配，季牌（春夏秋冬，左上角有叶子）互相可配，其余须完全相同。\n每局保证有解，但消错顺序仍可能陷入死局，先想清楚再出手。\n💡 提示一对（+15 秒）· 🔀 洗牌，重新分配剩余的牌并保证有解（最多 2 次，每次 +30 秒；剩下的位置怎么分配都清不完时无效，不扣次数）· ↶ 撤销（不罚时）· ↻ 重新发牌或换布局。\n乌龟：横屏和平板上为经典乌龟，竖持手机时为竖屏改编版；每种布局分别记录最佳用时。',
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
    descLarge: '144 张 · 5 层 · 经典乌龟',
    descLargePortrait: '144 张 · 5 层 · 竖屏版乌龟（横屏或平板上为经典乌龟）',
    bestLine: '最佳 {time} · 已通关 {n} 次',
    noBest: '尚无纪录，快来创造吧',
    dimBlocked: '压暗不可选的牌',
    tilesLeft: '剩余',
    pairsLeft: '可配对',
    shufflesLeft: '洗牌',
    hintBtn: '提示（+{n} 秒）',
    shuffleBtn: '洗牌（+{n} 秒）',
    newDeal: '重新发牌',
    changeLayout: '换一个布局',
    hintPenalty: '提示 +{n} 秒',
    shufflePenalty: '已洗牌 +{n} 秒',
    noShuffles: '洗牌次数已用完',
    shuffleUseless: '洗牌也无济于事：剩下的牌无论怎样分配都无法清空',
    nothingToUndo: '没有可撤销的操作',
    noMoves: '没有可消除的牌了',
    noMovesBody: '剩余 {n} 张牌没有可配对的组合。可以洗牌（+{p} 秒）、撤销几步，或重新发牌。',
    noMovesNoShuffle: '剩余 {n} 张牌没有可配对的组合，洗牌次数已用完。撤销几步或重新发牌。',
    noMovesStuck: '剩余 {n} 张牌没有可配对的组合，而且它们的位置无论怎样分配都无法清空，洗牌也无济于事。撤销几步或重新发牌。',
    shuffleAction: '洗牌（剩 {n} 次）',
    winBody: '清空了全部 {n} 张牌！',
    finalTime: '最终用时',
    penalties: '含惩罚：提示 {h} 次 · 洗牌 {s} 次（+{p} 秒）',
    bestTime: '最佳 {time}',
    restartConfirm: '当前进度将丢失。重新发一副牌？',
    restartFresh: '重新发一副牌？',
    legendFlower: '花牌互配',
    legendSeason: '季牌互配',
  },
  en: {
    rules:
      'Goal: clear the board by removing matching pairs, as fast as you can.\nA tile is FREE when nothing lies on it and its left or right side is open (blocked tiles can be dimmed).\nTap two free matching tiles to remove them. Any flower (梅蘭菊竹, blossom mark) matches any flower, any season (春夏秋冬, leaf mark) any season; other tiles must be identical.\nEvery deal is solvable, but a careless pair can still lead to a dead end.\n💡 hint (+15 s) · 🔀 shuffle re-deals the rest solvably (max 2, +30 s; not used up if no arrangement can be cleared) · ↶ undo (free) · ↻ new deal or another layout.\nTurtle: classic in landscape and on tablets, re-shaped for upright phones. Each layout keeps its own best time.',
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
    descLarge: '144 tiles · 5 layers · the classic turtle',
    descLargePortrait: '144 tiles · 5 layers · turtle re-shaped for portrait (classic in landscape / on tablets)',
    bestLine: 'Best {time} · cleared {n}×',
    noBest: 'No record yet — set one!',
    dimBlocked: 'Dim blocked tiles',
    tilesLeft: 'Tiles',
    pairsLeft: 'Pairs',
    shufflesLeft: 'Shuffles',
    hintBtn: 'Hint (+{n} s)',
    shuffleBtn: 'Shuffle (+{n} s)',
    newDeal: 'New deal',
    changeLayout: 'Choose another layout',
    hintPenalty: 'Hint +{n} s',
    shufflePenalty: 'Shuffled +{n} s',
    noShuffles: 'No shuffles left',
    shuffleUseless: "A shuffle can't help: these tiles can't be cleared in any arrangement",
    nothingToUndo: 'Nothing to undo',
    noMoves: 'No moves left',
    noMovesBody: '{n} tiles remain but none can be paired. Shuffle (+{p} s), undo a few moves, or deal again.',
    noMovesNoShuffle: '{n} tiles remain but none can be paired, and no shuffles are left. Undo a few moves or deal again.',
    noMovesStuck: "{n} tiles remain but none can be paired, and their positions can't be cleared in any arrangement, so a shuffle can't help. Undo a few moves or deal again.",
    shuffleAction: 'Shuffle ({n} left)',
    winBody: 'All {n} tiles cleared!',
    finalTime: 'Final time',
    penalties: 'Incl. penalties: hints ×{h} · shuffles ×{s} (+{p} s)',
    bestTime: 'Best {time}',
    restartConfirm: 'Current progress will be lost. Deal a new board?',
    restartFresh: 'Deal a new board?',
    legendFlower: 'Flowers pair together',
    legendSeason: 'Seasons pair together',
  },
};

// ── Colours (derived from the theme tokens) ───────────────────────────────

type RGB = [number, number, number];

/** Token values used only if a custom property cannot be read (mirrors src/styles/base.css). */
const TOKEN_FALLBACK: Record<ThemeName, Record<string, string>> = {
  dark: {
    '--bg': '#0f1218',
    '--surface': '#1a1f2b',
    '--surface-2': '#232a39',
    '--border': '#2d3548',
    '--text': '#e8ecf3',
    '--muted': '#8b94a7',
    '--accent': '#5b8cff',
    '--accent-2': '#ff7a59',
    '--success': '#3ddc97',
    '--danger': '#ff5470',
    '--warning': '#ffc857',
  },
  light: {
    '--bg': '#f4f6fb',
    '--surface': '#ffffff',
    '--surface-2': '#eef1f7',
    '--border': '#dde2ec',
    '--text': '#171a21',
    '--muted': '#5c6475',
    '--accent': '#3366ff',
    '--accent-2': '#ff6a3d',
    '--success': '#1fa86b',
    '--danger': '#e0304f',
    '--warning': '#d9960a',
  },
};

function parseColor(raw: string): RGB | null {
  const s = raw.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as RGB;
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as RGB;
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hex(c: RGB): string {
  return '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function rgba(c: RGB, alpha: number): string {
  return `rgba(${c.map((v) => Math.round(v)).join(', ')}, ${alpha})`;
}

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
  shadow: string;
  accent: string;
  warning: string;
}

/**
 * Canvas colours, all derived from the theme tokens (--bg / --surface / --surface-2 / --border / --text /
 * --muted and the accent colours) so the board follows any change of the theme.
 */
function makePalette(theme: ThemeName, cssVar: (n: string) => string): Palette {
  const v = (name: string): RGB => parseColor(cssVar(name) || '') ?? (parseColor(TOKEN_FALLBACK[theme][name]) as RGB);
  const dark = theme === 'dark';
  const bg = v('--bg');
  const surface = v('--surface');
  const surface2 = v('--surface-2');
  const border = v('--border');
  const text = v('--text');
  const muted = v('--muted');
  const accent = v('--accent');
  const accent2 = v('--accent-2');
  const success = v('--success');
  const danger = v('--danger');
  const warning = v('--warning');
  // Tile face: the border tone lifted towards the text in dark mode, a warm ivory surface in light mode.
  const face = dark ? mix(border, text, 0.09) : mix(surface, warning, 0.05);
  const magenta = mix(mix(danger, accent, 0.35), text, dark ? 0.15 : 0);
  const orange = mix(mix(accent2, warning, 0.35), text, dark ? 0 : 0.15);
  return {
    face: hex(face),
    faceFlower: hex(mix(face, magenta, dark ? 0.14 : 0.09)),
    faceSeason: hex(mix(face, orange, dark ? 0.14 : 0.1)),
    side: hex(dark ? mix(face, bg, 0.45) : mix(face, muted, 0.42)),
    edge: hex(dark ? mix(face, text, 0.14) : mix(face, border, 0.9)),
    ink: hex(text),
    red: hex(mix(danger, text, 0.12)),
    green: hex(mix(success, text, dark ? 0.1 : 0.28)),
    blue: hex(mix(accent, text, 0.3)),
    magenta: hex(magenta),
    orange: hex(orange),
    dim: rgba(bg, 0.52),
    table: hex(dark ? mix(bg, surface, 0.6) : mix(surface2, border, 0.5)),
    shadow: dark ? 'rgba(0, 0, 0, 0.55)' : rgba(text, 0.4),
    accent: hex(accent),
    warning: hex(warning),
  };
}

const CJK_FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC","Noto Sans CJK SC","WenQuanYi Zen Hei",sans-serif';
const LATIN_FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WINDS = ['東', '南', '西', '北'];
const WIND_INDEX = ['E', 'S', 'W', 'N'];
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

/** Five-petal blossom: the corner mark of the flower tiles (and the start-screen legend). */
function drawBlossom(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, center: string): void {
  g.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.45, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = center;
  g.beginPath();
  g.arc(cx, cy, r * 0.26, 0, Math.PI * 2);
  g.fill();
}

/** A leaf with a midrib: the corner mark of the season tiles. */
function drawLeaf(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, vein: string): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(-Math.PI / 4);
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(0, 0, r, r * 0.52, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = vein;
  g.lineWidth = Math.max(1, r * 0.16);
  g.beginPath();
  g.moveTo(-r * 1.15, 0);
  g.lineTo(r * 0.75, 0);
  g.stroke();
  g.restore();
}

/**
 * Draw one tile face (background + glyph) at (0,0) with size w×h. In English, character and wind tiles
 * also get a small Latin corner index (1–9 / E S W N) as on western sets.
 */
function drawFace(g: CanvasRenderingContext2D, kind: number, w: number, h: number, p: Palette, lang: Lang): void {
  const suit = suitOf(kind);
  const rank = rankOf(kind);
  const rad = w * 0.13;
  const faceColor = suit === 'flower' ? p.faceFlower : suit === 'season' ? p.faceSeason : p.face;
  g.fillStyle = faceColor;
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
  const cornerIndex = (text: string, color: string) => {
    g.fillStyle = color;
    g.font = `700 ${Math.max(7, Math.round(w * 0.22))}px ${LATIN_FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText(text, w * 0.08, h * 0.05);
  };

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
      g.fillStyle = faceColor;
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
        g.fillStyle = faceColor;
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
      g.fillStyle = faceColor;
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
        g.fillStyle = faceColor;
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
    if (lang === 'en') cornerIndex(String(rank), p.blue);
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
    const bonus = suit === 'flower' || suit === 'season';
    g.fillStyle = color;
    g.font = `700 ${Math.round(w * (bonus ? 0.58 : 0.62))}px ${CJK_FONT}`;
    g.fillText(ch, w / 2, h * (bonus ? 0.58 : 0.52));
    if (suit === 'wind' && lang === 'en') cornerIndex(WIND_INDEX[rank], p.ink);
    // language-neutral corner mark so the matching group is recognisable at a glance
    const r = w * 0.13;
    if (suit === 'flower') drawBlossom(g, w * 0.22, h * 0.17, r, p.magenta, faceColor);
    else if (suit === 'season') drawLeaf(g, w * 0.22, h * 0.17, r, p.orange, faceColor);
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

const MODE_KEYS: Record<LayoutId, { mode: string; layout: string }> = {
  small: { mode: 'modeSmall', layout: 'layoutSmall' },
  medium: { mode: 'modeMedium', layout: 'layoutMedium' },
  large: { mode: 'modeLarge', layout: 'layoutLarge' },
};
const BOARD_DESC: Record<BoardId, string> = {
  small: 'descSmall',
  medium: 'descMedium',
  large: 'descLargePortrait',
  largeClassic: 'descLarge',
};

/** Landscape-shaped play areas put the HUD in a side column instead of a bottom bar. */
function sideHud(rootW: number, rootH: number): boolean {
  return rootW > rootH * 1.15;
}

/** Any modal on screen (ours, or the shell's rules / settings sheet), ignoring ones that are closing. */
function modalShowing(): boolean {
  return document.querySelector('.modal-backdrop:not(.closing)') !== null;
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  let mode: LayoutId = ctx.storage.get<LayoutId>('mode', 'small');
  if (!(mode in LAYOUTS)) mode = 'small';
  let dimBlocked = ctx.storage.get<boolean>('dim', true);
  let pal = makePalette(ctx.theme, ctx.cssVar);

  // game state
  let screen: 'start' | 'game' = 'start';
  let boardId: BoardId = mode;
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
  /** One of OUR modals is up. Cleared by its buttons, or by `paused()` if it was dismissed otherwise. */
  let modalOpen = false;
  let lastShownSecond = -1;

  // rendering
  let metrics: Metrics | null = null;
  let dirty = true;
  const faceCache = new Map<number, HTMLCanvasElement>();
  let shadowSprite: { c: HTMLCanvasElement; pad: number } | null = null;
  const removeAnims: RemoveAnim[] = [];
  const particles: Particle[] = [];
  let shake: { tile: Tile; t: number } | null = null;
  let flash = 0; // shuffle / deal fade-in
  let timers: number[] = [];

  let cv: ReturnType<typeof createCanvas> | null = null;
  let offPointer: (() => void) | null = null;
  let screenEl: HTMLElement | null = null;
  let hud: { tiles: HTMLElement; pairs: HTMLElement; shuffles: HTMLElement; time: HTMLElement } | null = null;
  let headerOff: (() => void)[] = [];
  let headerNarrow = false;
  let refreshStart: (() => void) | null = null;
  let legendTiles: { c: HTMLCanvasElement; kind: number }[] = [];

  const loop = createLoop((_dt, now) => tick(now));

  const narrow = () => (root.clientWidth || window.innerWidth) < NARROW_W;
  const onWindowResize = () => {
    if (screen === 'start') {
      refreshStart?.();
      return;
    }
    screenEl?.classList.toggle('mj-side', sideHud(root.clientWidth, root.clientHeight));
    screenEl?.classList.toggle('mj-narrow', narrow());
    mountHeader();
  };
  window.addEventListener('resize', onWindowResize);

  ctx.onDestroy(() => {
    window.removeEventListener('resize', onWindowResize);
    unmountHeader();
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
    shadowSprite = null;
    dirty = true;
    drawLegend();
    if (screen === 'game' && !loop.running) draw();
  });

  function later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      timers = timers.filter((x) => x !== id);
      fn();
    }, ms);
    timers.push(id);
  }

  /**
   * Input and the clock are paused while any modal is up — ours, or the shell's rules / settings sheet.
   * Also self-heals `modalOpen` when one of our modals was dismissed without a button (backdrop tap).
   */
  function paused(): boolean {
    const showing = modalShowing();
    if (modalOpen && !showing) modalOpen = false;
    return modalOpen || showing;
  }

  function teardownGame(): void {
    loop.stop();
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    hud = null;
    screenEl = null;
    for (const id of timers) clearTimeout(id);
    timers = [];
    removeAnims.length = 0;
    particles.length = 0;
    shake = null;
    faceCache.clear();
    shadowSprite = null;
  }

  // Header actions exist only while a board is on screen (the start screen has nothing to undo / restart).
  // On narrow screens 🔀 lives in the HUD (the shuffle counter is a button there) to leave room for the title.
  function mountHeader(): void {
    const n = narrow();
    if (headerOff.length && n === headerNarrow) return;
    unmountHeader();
    headerNarrow = n;
    headerOff = [ctx.addHeaderAction({ icon: '💡', label: t('hintBtn', { n: HINT_PENALTY }), onClick: () => hint() })];
    if (!n) headerOff.push(ctx.addHeaderAction({ icon: '🔀', label: t('shuffleBtn', { n: SHUFFLE_PENALTY }), onClick: () => shuffle() }));
    headerOff.push(
      ctx.addHeaderAction({ icon: '↶', label: t('undo'), onClick: () => undo() }),
      ctx.addHeaderAction({ icon: '↻', label: t('newDeal'), onClick: () => requestRestart() }),
    );
  }

  function unmountHeader(): void {
    for (const off of headerOff) off();
    headerOff = [];
  }

  /** The board the current screen shape gets for `m` (same estimate on the start screen and at deal time). */
  function boardForScreen(m: LayoutId): BoardId {
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;
    const side = sideHud(w, h);
    return boardFor(m, side ? w - BAR_W : w, side ? h : h - BAR_H, BOARD_PAD);
  }

  // ── Start screen ───────────────────────────────────────────────────────
  function showStart(): void {
    teardownGame();
    unmountHeader();
    screen = 'start';
    finished = true;
    modalOpen = false;
    ctx.setStatus('');
    root.innerHTML = '';
    const desc = el('p', { class: 'muted small' });
    const bestLine = el('p', { class: 'muted small' });
    refreshStart = () => {
      const id = boardForScreen(mode);
      desc.textContent = t(BOARD_DESC[id]);
      const b = ctx.storage.getBest(id);
      const clears = ctx.storage.get<Record<string, number>>('clears', {})[id] ?? 0;
      bestLine.textContent = b === null ? t('noBest') : t('bestLine', { time: formatTime(b), n: clears });
    };
    const legendItem = (kind: number, label: string) => {
      const c = el('canvas', { class: 'mj-legend-tile', width: '1', height: '1' });
      legendTiles.push({ c, kind });
      return el('span', { class: 'mj-legend-item' }, c, el('span', { text: label }));
    };
    legendTiles = [];
    root.append(
      el(
        'div',
        { class: 'start-screen mj-start' },
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
            refreshStart?.();
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
        el('div', { class: 'mj-legend' }, legendItem(34, t('legendFlower')), legendItem(38, t('legendSeason'))),
        button(t('play'), () => startGame(), { variant: 'primary', size: 'lg' }),
      ),
    );
    refreshStart();
    drawLegend();
  }

  /** The two little sample tiles (梅 / 春) in the start-screen legend. */
  function drawLegend(): void {
    const W = 26;
    const H = Math.round(W * 1.2);
    const lift = 3;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const { c, kind } of legendTiles) {
      if (!c.isConnected) continue;
      c.width = Math.ceil((W + lift) * dpr);
      c.height = Math.ceil((H + lift) * dpr);
      c.style.width = `${W + lift}px`;
      c.style.height = `${H + lift}px`;
      const g = c.getContext('2d');
      if (!g) continue;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = pal.side;
      roundRect(g, lift, lift, W, H, W * 0.13);
      g.fill();
      drawFace(g, kind, W, H, pal, ctx.lang);
    }
  }

  // ── Game screen ────────────────────────────────────────────────────────
  function startGame(): void {
    teardownGame();
    mountHeader();
    screen = 'game';
    refreshStart = null;
    legendTiles = [];
    boardId = boardForScreen(mode);
    const positions = BOARDS[boardId];
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
    // The shuffle counter doubles as the shuffle button on narrow screens (inert otherwise, see style.css).
    const shuffleValue = el('div', { class: 'mj-stat-value', text: '0' });
    const shuffleStat = el(
      'button',
      { class: 'mj-stat mj-stat-btn', type: 'button', 'aria-label': t('shuffleBtn', { n: SHUFFLE_PENALTY }), onClick: () => narrow() && shuffle() },
      el('div', { class: 'mj-stat-label' }, el('span', { class: 'mj-stat-icon', text: '🔀 ' }), t('shufflesLeft')),
      shuffleValue,
    );
    const bar = el('div', { class: 'mj-bar' }, sTiles.node, sPairs.node, shuffleStat, sTime.node);
    const cls = ['mj-screen'];
    if (sideHud(root.clientWidth, root.clientHeight)) cls.push('mj-side');
    if (narrow()) cls.push('mj-narrow');
    screenEl = el('div', { class: cls.join(' ') }, area, bar);
    root.append(screenEl);
    hud = { tiles: sTiles.value, pairs: sPairs.value, shuffles: shuffleValue, time: sTime.value };

    const bounds = layoutBounds(positions);
    cv = createCanvas(area, (w, h) => {
      metrics = computeMetrics(bounds, w, h, BOARD_PAD);
      faceCache.clear();
      shadowSprite = null;
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
    ctx.setStatus(t(MODE_KEYS[mode].layout));
  }

  function updateHud(): void {
    if (!hud) return;
    hud.tiles.textContent = String(tiles.length);
    hud.pairs.textContent = String(pairs);
    hud.pairs.classList.toggle('mj-warn', pairs <= 1 && tiles.length > 0);
    hud.shuffles.textContent = `${shufflesLeft}/${MAX_SHUFFLES}`;
    hud.shuffles.classList.toggle('mj-spent', shufflesLeft <= 0);
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
    if (screen !== 'game' || finished || !metrics || paused()) return;
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
    if (screen !== 'game' || finished || paused()) return;
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
    if (screen !== 'game' || finished || paused()) return;
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

  /**
   * Re-deal the remaining tiles. `pre` is a re-deal already computed by the no-moves dialog. When no
   * re-deal can help (the remaining positions cannot be cleared in any order) nothing is charged.
   */
  function shuffle(pre?: Board): void {
    if (screen !== 'game' || finished || paused()) return;
    if (shufflesLeft <= 0) {
      ctx.toast(t('noShuffles'));
      ctx.play('error');
      return;
    }
    if (tiles.length < 2) return;
    const res = pre ?? reshuffle(tiles);
    if (!res) {
      ctx.toast(t('shuffleUseless'));
      ctx.play('error');
      ctx.haptic('error');
      return;
    }
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
    if (finished || screen !== 'game' || tiles.length === 0 || pairs > 0) return;
    if (paused()) {
      // another sheet (e.g. the rules) is up: show the dialog once it has been closed
      later(() => showNoMoves(), 400);
      return;
    }
    // Work out up front whether a shuffle can help, so it is never offered (or charged) in vain.
    const redeal = shufflesLeft > 0 ? reshuffle(tiles) : null;
    modalOpen = true;
    ctx.play('lose');
    ctx.haptic('heavy');
    const buttons: ModalButton[] = [];
    if (redeal) {
      buttons.push({
        label: t('shuffleAction', { n: shufflesLeft }),
        primary: true,
        onClick: () => {
          modalOpen = false;
          shuffle(redeal);
        },
      });
    }
    if (history.length) {
      buttons.push({
        label: t('undo'),
        primary: !redeal,
        onClick: () => {
          modalOpen = false;
          undo();
        },
      });
    }
    buttons.push({
      label: t('newDeal'),
      primary: !redeal && !history.length,
      onClick: () => {
        modalOpen = false;
        startGame();
      },
    });
    if (buttons.length < 3) buttons.unshift({ label: t('home'), onClick: () => ctx.exit() });
    const body = redeal
      ? t('noMovesBody', { n: tiles.length, p: SHUFFLE_PENALTY })
      : shufflesLeft > 0
        ? t('noMovesStuck', { n: tiles.length })
        : t('noMovesNoShuffle', { n: tiles.length });
    ctx.showModal({ title: t('noMoves'), body, dismissible: false, buttons });
  }

  /** A ghost "choose another layout" link for modal bodies; closes `getHandle()` and opens the start screen. */
  function changeLayoutLink(getHandle: () => ModalHandle | null): HTMLButtonElement {
    return button(
      t('changeLayout'),
      () => {
        getHandle()?.close();
        modalOpen = false;
        showStart();
      },
      { variant: 'ghost', icon: '🀄', class: 'mj-link' },
    );
  }

  function finishWin(): void {
    finished = true;
    selected = null;
    const total = Math.floor(elapsed + penalty);
    const isBest = ctx.storage.recordBest(boardId, total, 'lower');
    const clears = ctx.storage.get<Record<string, number>>('clears', {});
    clears[boardId] = (clears[boardId] ?? 0) + 1;
    ctx.storage.set('clears', clears);
    updateHud();
    ctx.play('win');
    ctx.haptic('success');
    spawnParticles();
    later(() => {
      modalOpen = true;
      const best = ctx.storage.getBest(boardId);
      let handle: ModalHandle | null = null;
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
        changeLayoutLink(() => handle),
      );
      handle = ctx.showModal({
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

  /** ↻: deal a new board of the same layout (after confirming), or go back to the layout chooser. */
  function requestRestart(): void {
    if (screen !== 'game' || paused()) return;
    if (finished) {
      startGame();
      return;
    }
    const progress = history.length > 0 || hintsUsed > 0 || shufflesUsed > 0;
    let handle: ModalHandle | null = null;
    const body = el('div', { class: 'mj-result' }, el('p', { text: t(progress ? 'restartConfirm' : 'restartFresh') }), changeLayoutLink(() => handle));
    modalOpen = true;
    // Dismissible: tapping the backdrop cancels; `paused()` notices the closed sheet and resumes play.
    handle = ctx.showModal({
      title: t('newDeal'),
      body,
      buttons: [
        {
          label: t('cancel'),
          onClick: () => {
            modalOpen = false;
          },
        },
        {
          label: t('newDeal'),
          primary: true,
          onClick: () => {
            modalOpen = false;
            startGame();
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
    if (!finished && !paused()) {
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
      drawFace(g, kind, metrics.w, metrics.h, pal, ctx.lang);
    }
    faceCache.set(kind, c);
    return c;
  }

  /** Soft drop shadow (pre-blurred once per size / theme) cast by raised tiles onto the layer below. */
  function shadow(): { c: HTMLCanvasElement; pad: number } {
    if (shadowSprite || !metrics || !cv) return shadowSprite ?? { c: document.createElement('canvas'), pad: 0 };
    const m = metrics;
    const dpr = cv.dpr;
    const blur = Math.max(2, m.lift * 1.1);
    const pad = blur * 2;
    const c = document.createElement('canvas');
    c.width = Math.ceil((m.w + pad * 2) * dpr);
    c.height = Math.ceil((m.h + pad * 2) * dpr);
    const g = c.getContext('2d');
    if (g) {
      g.scale(dpr, dpr);
      g.shadowColor = pal.shadow;
      g.shadowBlur = blur * dpr;
      g.fillStyle = pal.shadow;
      roundRect(g, pad, pad, m.w, m.h, m.w * 0.13);
      g.fill();
    }
    shadowSprite = { c, pad };
    return shadowSprite;
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
    // Table panel behind the board, kept inside the canvas so its rounded corners are never clipped.
    const want = Math.max(6, m.w * 0.18);
    const padX = Math.max(1, Math.min(want, m.ox - 1));
    const padY = Math.max(1, Math.min(want, m.oy - 1));
    g.fillStyle = pal.table;
    roundRect(g, m.ox - padX, m.oy - padY, W - 2 * m.ox + 2 * padX, H - 2 * m.oy + 2 * padY, Math.min(padX, padY) * 1.6);
    g.fill();
    const ordered = drawOrder(tiles);
    const alpha = flash > 0 ? 0.2 + 0.8 * (1 - flash / 0.45) : 1;
    const sh = shadow();
    const shOff = m.lift * 1.25;
    g.globalAlpha = alpha;
    for (const tile of ordered) {
      const r = tileRect(tile, m);
      let dx = 0;
      if (shake && shake.tile === tile) dx = Math.sin(shake.t * 55) * 3 * (1 - shake.t / 0.35);
      if (tile.z > 0) g.drawImage(sh.c, r.x + dx + shOff - sh.pad, r.y + shOff - sh.pad, m.w + sh.pad * 2, m.h + sh.pad * 2);
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
      board: () => boardId,
      modalOpen: () => modalOpen,
      shufflesLeft: () => shufflesLeft,
      setTiles: (next: Tile[]) => {
        tiles = next.map((x) => ({ ...x }));
        history = [];
        selected = null;
        recompute();
        updateHud();
        checkState();
      },
    };
    ctx.onDestroy(() => {
      delete w.__mj;
    });
  }

  showStart();
  return {
    destroy() {
      unmountHeader();
      teardownGame();
    },
  };
}

const game: GameModule = { strings, create };
export default game;
