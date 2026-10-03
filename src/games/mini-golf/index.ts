import type { GameContext, GameInstance, GameModule, SoundName, ThemeName } from '../../app/types';
import { el, button, segmented } from '../../app/ui';
import { clamp, createCanvas, createLoop, onPointer, seededRandom, type CanvasHandle, type PointerInfo } from '../../app/canvas';
import {
  BALL_R,
  CUP_R,
  DIFF,
  DIFFICULTIES,
  FIELD_H,
  FIELD_W,
  HOLES,
  HOLE_COUNT,
  aimFromDrag,
  formatVsPar,
  holeScore,
  isValidProgress,
  moverRect,
  newSim,
  pointInPoly,
  predictPath,
  scoreTerm,
  shoot,
  stepSim,
  sumScores,
  totalPar,
  vsPar,
  type Aim,
  type DiffConfig,
  type Difficulty,
  type Hole,
  type Progress,
  type Rect,
  type SimState,
  type Vec,
} from './logic';
import './style.css';

const strings = {
  zh: {
    rules:
      '像弹弓一样向后拖动、松手推杆：可按住球拖，也可在球场任意处按下拖动。虚线指方向，球周光环与顶部力度条显示力量；拖回起点即取消。\n球停稳后才能再击球。球心经过球洞且速度适中才会落袋，太快会飞过。\n沙地很慢；落水罚 1 杆并回到上次停球处；黄色箭头带会推球（有的是侧风）；移动挡板要掐时机；橙色弹珠会弹开球。\n每洞最多 8 杆，仍未进洞记 9 杆并进入下一洞。进度自动保存。\n目标：18 洞总杆数越少越好，低于标准杆即为高手。\n休闲：预测首次反弹路线，球洞宽容，沙地较松。\n标准：只显示方向虚线。\n职业：只有短箭头，须轻推入洞，沙地更黏。',
    desc: '18 洞物理推杆：弹弓式拖拽，沙坑、水塘、弹珠、侧风与移动挡板。',
    casual: '休闲',
    standard: '标准',
    pro: '职业',
    casualDesc: '预测反弹路线 · 球洞宽容',
    standardDesc: '方向虚线 · 标准球洞',
    proDesc: '仅短箭头 · 必须轻推入洞',
    continueRound: '继续 · {d} · 第 {n} 洞',
    newRound: '新一轮',
    bestTotal: '最佳：{n} 杆（{d}）',
    bestValue: '{n} 杆（{d}）',
    noBest: '尚无纪录',
    holeLabel: '洞',
    parLabel: '标准杆',
    strokesLabel: '杆数',
    totalLabel: '总计',
    statusLine: '{n}/{total} 洞 · 标准杆 {par}',
    statusBest: ' · 本洞最佳 {b}',
    holeOf: '第 {n} 洞',
    parN: '标准杆 {n}',
    dragHint: '向后拖动瞄准 · 松手推杆',
    waterMsg: '落水！罚 1 杆',
    maxStrokesMsg: '已用满 8 杆，本洞记 9 杆',
    rescued: '球被卡住，已放回原位',
    holeInOne: '一杆进洞！',
    albatross: '信天翁！',
    eagle: '老鹰球！',
    birdie: '小鸟球！',
    parScore: '标准杆',
    bogey: '柏忌',
    doubleBogey: '双柏忌',
    tripleBogey: '三柏忌',
    overPar: '超 {n} 杆',
    strokesN: '{n} 杆',
    scorecard: '记分卡',
    roundDone: '18 洞完成！',
    totalStrokes: '总杆数',
    courseParLabel: '标准杆',
    vsParLabel: '相对标准杆',
    bestRound: '最佳纪录',
    restartConfirm: '放弃当前进度，从第 1 洞重新开始？',
    holeBestNote: '本洞新纪录',
    cellBest: '最佳',
    name1: '开球',
    name2: '狗腿弯',
    name3: '弹珠阵',
    name4: '沙坑',
    name5: '过水',
    name6: '之字形',
    name7: '斜角反弹',
    name8: '侧风带',
    name9: '移动闸门',
    name10: '沙岛',
    name11: '迷宫',
    name12: '弹珠台',
    name13: 'S 弯',
    name14: '回旋加速',
    name15: '双闸',
    name16: '水道',
    name17: '暗巷',
    name18: '终局',
  },
  en: {
    rules:
      'Pull back like a slingshot and let go to putt — from the ball, or press anywhere on the course and drag. The dotted line shows direction; the ring and top bar show power. Drag back to your start point to cancel.\nPutt only when the ball has stopped. It drops if its centre crosses the cup at moderate speed; too fast and it skips over.\nSand is slow; water costs 1 stroke and returns the ball to where it last stopped; yellow arrows push the ball (some sideways); time the moving gates; orange bumpers bounce.\nMax 8 strokes per hole, otherwise it scores 9. Progress is saved.\nGoal: the lowest 18-hole total — beat par.\nCasual: first-bounce path preview, forgiving cup, softer sand.\nStandard: direction line only.\nPro: short arrow only, gentle touch to sink, stickier sand.',
    desc: '18 holes of physics putting: slingshot drag, bunkers, water, bumpers, crosswinds and moving gates.',
    casual: 'Casual',
    standard: 'Standard',
    pro: 'Pro',
    casualDesc: 'Bounce preview · forgiving cup',
    standardDesc: 'Direction line · standard cup',
    proDesc: 'Short arrow only · gentle touch required',
    continueRound: 'Continue · {d} · hole {n}',
    newRound: 'New round',
    bestTotal: 'Best: {n} strokes ({d})',
    bestValue: '{n} strokes ({d})',
    noBest: 'No record yet',
    holeLabel: 'Hole',
    parLabel: 'Par',
    strokesLabel: 'Strokes',
    totalLabel: 'Total',
    statusLine: 'Hole {n}/{total} · Par {par}',
    statusBest: ' · hole best {b}',
    holeOf: 'Hole {n}',
    parN: 'Par {n}',
    dragHint: 'Drag back to aim · release to putt',
    waterMsg: 'Splash! +1 stroke',
    maxStrokesMsg: '8 strokes used: this hole scores 9',
    rescued: 'Ball was stuck — placed back',
    holeInOne: 'Hole in one!',
    albatross: 'Albatross!',
    eagle: 'Eagle!',
    birdie: 'Birdie!',
    parScore: 'Par',
    bogey: 'Bogey',
    doubleBogey: 'Double bogey',
    tripleBogey: 'Triple bogey',
    overPar: '+{n}',
    strokesN: '{n} strokes',
    scorecard: 'Scorecard',
    roundDone: 'Round complete!',
    totalStrokes: 'Total strokes',
    courseParLabel: 'Par',
    vsParLabel: 'Versus par',
    bestRound: 'Best round',
    restartConfirm: 'Abandon this round and start again from hole 1?',
    holeBestNote: 'New hole record',
    cellBest: 'best',
    name1: 'Tee Off',
    name2: 'Dogleg',
    name3: 'Bumper Alley',
    name4: 'Sand Trap',
    name5: 'Water Carry',
    name6: 'Zigzag',
    name7: 'Bank Shot',
    name8: 'Crosswind',
    name9: 'Moving Gate',
    name10: 'Sand Island',
    name11: 'The Maze',
    name12: 'Pinball',
    name13: 'S-Bend',
    name14: 'Slingshot',
    name15: 'Twin Gates',
    name16: 'Waterways',
    name17: 'The Alcove',
    name18: 'Grand Finale',
  },
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
}

interface Palette {
  bg: string;
  felt: string;
  stripe: string;
  fringe: string;
  tee: string;
  wall: string;
  wallEdge: string;
  wallTop: string;
  sand: string;
  sandDot: string;
  water: string;
  waterLine: string;
  boost: string;
  boostChev: string;
  bumper: string;
  bumperCore: string;
  bumperRing: string;
  cup: string;
  cupRim: string;
  ball: string;
  ballShade: string;
  shadow: string;
  aim: string;
  band: string;
  flag: string;
  pole: string;
  success: string;
  warning: string;
  danger: string;
  accent: string;
}

function makePalette(theme: ThemeName, cssVar: (n: string) => string): Palette {
  const common = {
    bg: cssVar('--bg') || (theme === 'dark' ? '#0f1218' : '#f4f6fb'),
    success: cssVar('--success') || '#3ddc97',
    warning: cssVar('--warning') || '#ffc857',
    danger: cssVar('--danger') || '#ff5470',
    accent: cssVar('--accent') || '#5b8cff',
  };
  if (theme === 'dark') {
    return {
      ...common,
      felt: '#2e7d47',
      stripe: 'rgba(255,255,255,0.045)',
      fringe: '#3c9a59',
      tee: 'rgba(255,255,255,0.10)',
      wall: '#7a5238',
      wallEdge: '#3d2819',
      wallTop: 'rgba(255,214,170,0.28)',
      sand: '#cdb77d',
      sandDot: '#ad9759',
      water: '#2a63c4',
      waterLine: 'rgba(255,255,255,0.35)',
      boost: 'rgba(255,200,80,0.24)',
      boostChev: '#ffd166',
      bumper: '#ff7a59',
      bumperCore: '#ffb59e',
      bumperRing: '#ffd166',
      cup: '#06080c',
      cupRim: '#1c2430',
      ball: '#f8f8f3',
      ballShade: '#b9b9b0',
      shadow: 'rgba(0,0,0,0.4)',
      aim: 'rgba(255,255,255,0.92)',
      band: 'rgba(255,255,255,0.32)',
      flag: '#ff5470',
      pole: '#e8ecf3',
    };
  }
  return {
    ...common,
    felt: '#4fae63',
    stripe: 'rgba(255,255,255,0.09)',
    fringe: '#79cc8b',
    tee: 'rgba(255,255,255,0.22)',
    wall: '#8d5b3b',
    wallEdge: '#5a3822',
    wallTop: 'rgba(255,226,190,0.4)',
    sand: '#ead9a2',
    sandDot: '#c9b273',
    water: '#4b94f2',
    waterLine: 'rgba(255,255,255,0.55)',
    boost: 'rgba(255,170,40,0.28)',
    boostChev: '#ff9f1c',
    bumper: '#ff6a3d',
    bumperCore: '#ffb096',
    bumperRing: '#ffb703',
    cup: '#141b26',
    cupRim: '#3a4759',
    ball: '#ffffff',
    ballShade: '#cfcfcf',
    shadow: 'rgba(0,0,0,0.26)',
    aim: 'rgba(255,255,255,0.98)',
    band: 'rgba(255,255,255,0.5)',
    flag: '#e0304f',
    pole: '#ffffff',
  };
}

/** Screen-space drag distances (CSS px) — independent of how large the course is drawn. */
const CANCEL_PX = 20;
const GRAB_PX = 40;

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  let diff: Difficulty = ctx.storage.get<Difficulty>('mode', 'standard');
  if (!DIFFICULTIES.includes(diff)) diff = 'standard';
  let cfg: DiffConfig = DIFF[diff];
  let pal = makePalette(ctx.theme, ctx.cssVar);

  // Round state
  let holeIdx = 0;
  let hole: Hole = HOLES[0];
  let scores: number[] = [];
  let sim: SimState | null = null;
  let phase: 'start' | 'play' | 'transition' | 'done' = 'start';
  let shotsThisRound = 0;
  let sinkT = -1; // >= 0 while the ball drops into the cup
  let fadeT = 0; // hole switch fade (1 → 0)

  // Rendering state
  let cv: CanvasHandle | null = null;
  let scale = 30;
  let ox = 0;
  let oy = 0;
  const trail: Vec[] = [];
  const particles: Particle[] = [];
  const bumperHit: number[] = [];
  let sandDots: Vec[] = [];
  let zoneDraw: { sand: Rect[]; water: Rect[]; boost: Rect[] } = { sand: [], water: [], boost: [] };
  let litFaces: { a: Vec; b: Vec }[] = [];
  let clock = 0;

  // Input state
  let dragging = false;
  let activePointer: number | null = null;
  let anchor: Vec = { x: 0, y: 0 };
  let anchorOnBall = true;
  let pointer: Vec = { x: 0, y: 0 };
  let aim: Aim | null = null;
  let guide: Vec[] = [];

  // DOM handles of the round screen
  let hud: { hole: HTMLElement; par: HTMLElement; strokes: HTMLElement; total: HTMLElement } | null = null;
  let powerFill: HTMLElement | null = null;
  let powerBar: HTMLElement | null = null;
  let banner: HTMLElement | null = null;
  let bannerTitle: HTMLElement | null = null;
  let bannerSub: HTMLElement | null = null;
  let hintEl: HTMLElement | null = null;

  // Sound throttling: never more than one of a kind per `gapMs`.
  const lastSfx: Record<string, number> = {};
  const sfx = (name: SoundName, key: string, gapMs: number) => {
    const now = performance.now();
    if (now - (lastSfx[key] ?? -1e9) < gapMs) return;
    lastSfx[key] = now;
    ctx.play(name);
  };

  // Timers
  const timers = new Set<number>();
  const after = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const clearTimers = () => {
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
  };

  const loop = createLoop((dt) => frame(dt));
  let offPointer: (() => void) | null = null;
  let headerRemovers: (() => void)[] = [];
  let bannerTimer = 0;

  ctx.onDestroy(() => teardownRound());
  ctx.onVisibility((v) => {
    if (!v) {
      loop.stop();
      cancelDrag();
    } else if (cv && (phase === 'play' || phase === 'transition')) loop.start();
  });
  ctx.onThemeChange((theme) => {
    pal = makePalette(theme, ctx.cssVar);
    if (cv && sim) draw();
  });

  // ── Persistence ───────────────────────────────────────────────────────
  function loadProgress(): Progress | null {
    const p = ctx.storage.get<unknown>('progress', null);
    return isValidProgress(p) ? p : null;
  }
  function saveProgress(): void {
    if (!sim || phase === 'done' || phase === 'start') return;
    const p: Progress = { diff, hole: holeIdx, scores: scores.slice(), strokes: sim.strokes, ball: { ...sim.lastRest } };
    ctx.storage.set('progress', p);
  }
  function holeBestKey(i: number): string {
    return `${diff}:${i}`;
  }
  function holeBests(): Record<string, number> {
    const m = ctx.storage.get<Record<string, number>>('holeBest', {});
    return m && typeof m === 'object' ? m : {};
  }
  function getHoleBest(i: number): number | null {
    const v = holeBests()[holeBestKey(i)];
    return typeof v === 'number' ? v : null;
  }
  function recordHoleBest(i: number, score: number): boolean {
    const m = holeBests();
    const prev = m[holeBestKey(i)];
    if (typeof prev === 'number' && prev <= score) return false;
    m[holeBestKey(i)] = score;
    ctx.storage.set('holeBest', m);
    return typeof prev === 'number'; // the first time a hole is played is not a "record"
  }

  // ── Screens ───────────────────────────────────────────────────────────
  function teardownRound(): void {
    clearTimers();
    clearTimeout(bannerTimer);
    loop.stop();
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    headerRemovers.forEach((f) => f());
    headerRemovers = [];
    hud = null;
    powerBar = powerFill = banner = bannerTitle = bannerSub = hintEl = null;
    sim = null;
    dragging = false;
    activePointer = null;
  }

  function showStart(): void {
    teardownRound();
    phase = 'start';
    root.innerHTML = '';
    ctx.setStatus('');

    const desc = el('p', { class: 'muted small', text: t(diff + 'Desc') });
    const bestLine = el('p', { class: 'muted small' });
    const updateBest = () => {
      const b = ctx.storage.getBest(diff);
      bestLine.textContent = b === null ? t('noBest') : t('bestTotal', { n: b, d: formatVsPar(b - totalPar()) });
    };
    updateBest();

    const saved = loadProgress();
    const buttons = el('div', { class: 'mg-start-buttons' });
    if (saved) {
      buttons.append(
        button(
          t('continueRound', { n: saved.hole + 1, d: t(saved.diff) }),
          () => {
            diff = saved.diff;
            cfg = DIFF[diff];
            ctx.storage.set('mode', diff);
            startRound(saved);
          },
          { variant: 'primary', size: 'lg' },
        ),
        button(
          t('newRound'),
          () => {
            ctx.storage.remove('progress');
            startRound(null);
          },
          { variant: 'secondary', size: 'md' },
        ),
      );
    } else {
      buttons.append(button(t('play'), () => startRound(null), { variant: 'primary', size: 'lg' }));
    }

    root.append(
      el(
        'div',
        { class: 'start-screen' },
        el('div', { class: 'big-icon', text: '⛳' }),
        el('h2', { text: t('chooseDifficulty') }),
        el('p', { class: 'muted mg-desc', text: t('desc') }),
        el(
          'div',
          { class: 'mg-modes' },
          segmented<Difficulty>(
            DIFFICULTIES.map((d) => ({ value: d, label: t(d) })),
            diff,
            (d) => {
              diff = d;
              cfg = DIFF[d];
              ctx.storage.set('mode', d);
              desc.textContent = t(d + 'Desc');
              updateBest();
            },
          ),
          desc,
          bestLine,
        ),
        buttons,
      ),
    );
  }

  function stat(label: string): { wrap: HTMLElement; value: HTMLElement } {
    const value = el('span', { class: 'stat-value', text: '–' });
    const wrap = el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), value);
    return { wrap, value };
  }

  function startRound(saved: Progress | null): void {
    teardownRound();
    root.innerHTML = '';
    cfg = DIFF[diff];
    scores = saved ? saved.scores.slice() : [];
    shotsThisRound = saved ? 1 : 0;

    const sHole = stat(t('holeLabel'));
    const sPar = stat(t('parLabel'));
    const sStrokes = stat(t('strokesLabel'));
    const sTotal = stat(t('totalLabel'));
    hud = { hole: sHole.value, par: sPar.value, strokes: sStrokes.value, total: sTotal.value };
    const hudEl = el('div', { class: 'game-hud mg-hud', role: 'button', 'aria-label': t('scorecard') }, sHole.wrap, sPar.wrap, sStrokes.wrap, sTotal.wrap);
    hudEl.addEventListener('click', () => showScorecard(false));
    powerFill = el('div', { class: 'mg-power-fill' });
    powerBar = el('div', { class: 'mg-power' }, powerFill);
    const area = el('div', { class: 'game-area mg-area' });
    bannerTitle = el('div', { class: 'mg-banner-title' });
    bannerSub = el('div', { class: 'mg-banner-sub' });
    banner = el('div', { class: 'mg-banner' }, bannerTitle, bannerSub);
    hintEl = el('div', { class: 'mg-hint', text: t('dragHint') });
    root.append(hudEl, powerBar, area);
    cv = createCanvas(area, (w, h) => layout(w, h));
    area.append(banner, hintEl);
    offPointer = onPointer(cv.canvas, {
      down: (p) => onDown(p),
      move: (p) => onMove(p),
      up: (p) => onUp(p),
      cancel: (p) => {
        if (p.id === activePointer) cancelDrag();
      },
    });
    headerRemovers.push(
      ctx.addHeaderAction({ icon: '▤', label: t('scorecard'), onClick: () => showScorecard(false) }),
      ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: () => askRestart() }),
    );

    phase = 'play';
    loadHole(saved ? saved.hole : 0, saved ?? undefined);
    loop.start();
  }

  function askRestart(): void {
    if (phase === 'start' || phase === 'done') return;
    const fresh = holeIdx === 0 && scores.length === 0 && (sim?.strokes ?? 0) === 0;
    const restart = () => {
      ctx.storage.remove('progress');
      startRound(null);
    };
    if (fresh) {
      restart();
      return;
    }
    ctx.showModal({
      title: t('restart'),
      body: t('restartConfirm'),
      buttons: [{ label: t('cancel') }, { label: t('restart'), primary: true, onClick: restart }],
    });
  }

  function layout(w: number, h: number): void {
    const pad = 12;
    scale = Math.max(1, Math.min((w - pad * 2) / FIELD_W, (h - pad * 2) / FIELD_H));
    ox = (w - FIELD_W * scale) / 2;
    oy = (h - FIELD_H * scale) / 2;
    if (sim) draw();
  }

  /** Extend a zone's drawn rectangle under walls / later-drawn zones so its rounded corners never show felt. */
  function drawRect(r: Rect, h: Hole, later: Rect[]): Rect {
    const covered = (x: number, y: number) =>
      !pointInPoly(x, y, h.outline) || h.blocks.some((b) => pointInPoly(x, y, b)) || later.some((z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h);
    const side = (pts: [number, number][]) => pts.every(([x, y]) => covered(x, y));
    const e = 0.08;
    const ext = 0.4;
    const fr = [0.15, 0.5, 0.85];
    const out = { ...r };
    if (side(fr.map((f) => [r.x - e, r.y + r.h * f]))) {
      out.x -= ext;
      out.w += ext;
    }
    if (side(fr.map((f) => [r.x + r.w + e, r.y + r.h * f]))) out.w += ext;
    if (side(fr.map((f) => [r.x + r.w * f, r.y - e]))) {
      out.y -= ext;
      out.h += ext;
    }
    if (side(fr.map((f) => [r.x + r.w * f, r.y + r.h + e]))) out.h += ext;
    return out;
  }

  function loadHole(i: number, saved?: Progress): void {
    holeIdx = i;
    hole = HOLES[i];
    sim = saved ? newSim(hole, saved.ball, saved.strokes) : newSim(hole);
    sinkT = -1;
    fadeT = 1;
    trail.length = 0;
    particles.length = 0;
    bumperHit.length = 0;
    cancelDrag();
    const rnd = seededRandom(1234 + i * 97);
    sandDots = [];
    for (const s of hole.sand) {
      const n = Math.round(s.w * s.h * 2.4);
      for (let k = 0; k < n; k++) sandDots.push({ x: s.x + 0.12 + rnd() * (s.w - 0.24), y: s.y + 0.12 + rnd() * (s.h - 0.24) });
    }
    zoneDraw = {
      sand: hole.sand.map((r) => drawRect(r, hole, [...hole.water, ...hole.boosters])),
      water: hole.water.map((r) => drawRect(r, hole, hole.boosters)),
      boost: hole.boosters.map((r) => drawRect(r, hole, [])),
    };
    litFaces = computeLitFaces(hole);
    phase = 'play';
    updateHud();
    saveProgress();
    showBanner(`${t('holeOf', { n: i + 1 })} · ${t('name' + (i + 1))}`, t('parN', { n: hole.par }), 'mg-intro', 1400);
    if (hintEl) hintEl.classList.toggle('mg-show', shotsThisRound === 0);
    // A save made while the final allowed putt was still rolling: that hole is over.
    if (sim.strokes >= cfg.maxStrokes) {
      phase = 'transition';
      after(700, () => {
        ctx.toast(t('maxStrokesMsg'));
        finishHole(holeScore(cfg.maxStrokes, false, cfg));
      });
    }
  }

  function updateHud(): void {
    if (!sim || !hud) return;
    hud.hole.textContent = `${holeIdx + 1}/${HOLE_COUNT}`;
    hud.par.textContent = String(hole.par);
    hud.strokes.textContent = String(sim.strokes);
    hud.strokes.className = 'stat-value' + (sim.strokes >= cfg.maxStrokes - 1 ? ' mg-over' : '');
    const d = vsPar(scores);
    hud.total.textContent = formatVsPar(d);
    hud.total.className = 'stat-value' + (d < 0 ? ' mg-under' : d > 0 ? ' mg-over' : '');
    const best = getHoleBest(holeIdx);
    ctx.setStatus(t('statusLine', { n: holeIdx + 1, total: HOLE_COUNT, par: hole.par }) + (best !== null ? t('statusBest', { b: best }) : ''));
  }

  function showBanner(title: string, sub: string, kind: '' | 'mg-good' | 'mg-bad' | 'mg-ace' | 'mg-intro', ms: number): void {
    if (!banner || !bannerTitle || !bannerSub) return;
    bannerTitle.textContent = title;
    bannerSub.textContent = sub;
    banner.className = 'mg-banner mg-show ' + kind;
    clearTimeout(bannerTimer);
    const b = banner;
    bannerTimer = window.setTimeout(() => b.classList.remove('mg-show'), ms);
  }

  // ── Input ─────────────────────────────────────────────────────────────
  function toUnits(x: number, y: number): Vec {
    return { x: (x - ox) / scale, y: (y - oy) / scale };
  }

  /** Drag lengths in course units for the current zoom: full power at ~a third of the screen. */
  function dragRange(): { min: number; max: number } {
    const base = cv ? Math.min(cv.width, cv.height) : 360;
    const maxPx = clamp(base * 0.34, 100, 170);
    return { min: CANCEL_PX / scale, max: maxPx / scale };
  }

  function computeAim(): void {
    if (!sim) return;
    const r = dragRange();
    aim = aimFromDrag(anchor, pointer, r.max, r.min);
    if (powerFill) {
      const p = aim.valid ? aim.power : 0;
      powerFill.style.width = `${Math.round(p * 100)}%`;
    }
  }

  function onDown(p: PointerInfo): void {
    if (activePointer !== null) return;
    if (phase !== 'play' || !sim || sim.moving || sim.sunk) return;
    const u = toUnits(p.x, p.y);
    const onBall = Math.hypot(u.x - sim.ball.x, u.y - sim.ball.y) <= Math.max(BALL_R * 3, GRAB_PX / scale);
    anchorOnBall = onBall;
    anchor = onBall ? { x: sim.ball.x, y: sim.ball.y } : u;
    activePointer = p.id;
    dragging = true;
    pointer = u;
    guide = [];
    computeAim();
    ctx.haptic('light');
    powerBar?.classList.add('mg-show');
  }

  function onMove(p: PointerInfo): void {
    if (!dragging || !sim || p.id !== activePointer) return;
    pointer = toUnits(p.x, p.y);
    const wasValid = aim?.valid ?? false;
    computeAim();
    if (aim && aim.valid !== wasValid) ctx.haptic('light');
  }

  function onUp(p: PointerInfo): void {
    if (!dragging || !sim || p.id !== activePointer) return;
    pointer = toUnits(p.x, p.y);
    computeAim();
    const a = aim;
    cancelDrag();
    if (!a || !a.valid || phase !== 'play') return;
    if (shoot(sim, a.dir, a.power)) {
      shotsThisRound++;
      hintEl?.classList.remove('mg-show');
      ctx.play('shoot');
      ctx.haptic('medium');
      trail.length = 0;
      updateHud();
      // Save straight away (ball at the spot it was hit from) so quitting mid-roll cannot undo a stroke.
      saveProgress();
    }
  }

  function cancelDrag(): void {
    dragging = false;
    activePointer = null;
    aim = null;
    guide = [];
    powerBar?.classList.remove('mg-show');
    if (powerFill) powerFill.style.width = '0%';
  }

  // ── Simulation + effects ──────────────────────────────────────────────
  function frame(dt: number): void {
    clock += dt;
    if (fadeT > 0) fadeT = Math.max(0, fadeT - dt * 3);
    if (sim && phase === 'play') {
      const wasMoving = sim.moving;
      const events = stepSim(sim, hole, cfg, dt);
      if (sim.moving) {
        trail.push({ x: sim.ball.x, y: sim.ball.y });
        if (trail.length > 14) trail.shift();
      } else if (trail.length) trail.shift();
      let ended = false;
      for (const ev of events) {
        switch (ev.type) {
          case 'wall':
            if (ev.speed > 1.2) {
              sfx('tap', 'wall', 70);
              if (ev.speed > 6) ctx.haptic('light');
              burst(ev.x, ev.y, 4, pal.ball, 1.5);
            }
            break;
          case 'bumper':
            sfx('pop', 'bumper', 60);
            ctx.haptic('light');
            bumperHit[ev.index] = clock;
            burst(ev.x, ev.y, 6, pal.bumperRing, 2.5);
            break;
          case 'mover':
            sfx('tap', 'mover', 80);
            burst(ev.x, ev.y, 3, pal.ball, 1.2);
            break;
          case 'boost':
            sfx('swoosh', 'boost', 300);
            break;
          case 'skip':
            sfx('tick', 'skip', 200);
            break;
          case 'water':
            ctx.play('error');
            ctx.haptic('heavy');
            ctx.toast(t('waterMsg'));
            splash(ev.x, ev.y);
            trail.length = 0;
            break;
          case 'rescue':
            if (performance.now() - (lastSfx.rescueToast ?? -1e9) > 2500) {
              lastSfx.rescueToast = performance.now();
              ctx.toast(t('rescued'));
            }
            trail.length = 0;
            break;
          case 'sunk':
            onSunk();
            ended = true;
            break;
          case 'stop':
            break;
        }
      }
      // Any way the ball came to rest (normal stop, water reset, rescue) ends the stroke.
      if (!ended && wasMoving && sim && !sim.moving && !sim.sunk && phase === 'play') onStopped();
      if (dragging && cfg.guide === 'bounce' && aim?.valid && sim) guide = predictPath(sim, hole, cfg, aim.dir, aim.power, 1.5, 0.3);
    } else if (sim && phase === 'transition') {
      sim.time += dt;
      if (sinkT >= 0) sinkT += dt;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
    }
    draw();
  }

  function burst(x: number, y: number, n: number, color: string | string[], speed: number, life = 0.35): void {
    if (particles.length > 120) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const c = Array.isArray(color) ? color[i % color.length] : color;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, r: 0.04 + Math.random() * 0.06, color: c });
    }
  }

  function splash(x: number, y: number): void {
    burst(x, y, 14, [pal.waterLine, pal.water], 3, 0.5);
  }

  function onStopped(): void {
    if (!sim) return;
    updateHud();
    if (sim.strokes >= cfg.maxStrokes) {
      ctx.play('lose');
      ctx.haptic('error');
      ctx.toast(t('maxStrokesMsg'));
      finishHole(holeScore(sim.strokes, false, cfg));
      return;
    }
    saveProgress();
  }

  function onSunk(): void {
    if (!sim) return;
    phase = 'transition';
    sinkT = 0;
    trail.length = 0;
    cancelDrag();
    ctx.play('coin');
    ctx.haptic('success');
    const score = holeScore(sim.strokes, true, cfg);
    burst(hole.cup.x, hole.cup.y, 12, pal.warning, 3);
    if (score < hole.par) burst(hole.cup.x, hole.cup.y, 26, [pal.warning, pal.success, pal.accent, pal.flag, '#ffffff'], 5, 0.9);
    updateHud();
    after(420, () => finishHole(score));
  }

  function finishHole(score: number): void {
    if (!sim) return;
    phase = 'transition';
    cancelDrag();
    scores[holeIdx] = score;
    const term = scoreTerm(score, hole.par);
    const diffN = score - hole.par;
    const isBest = recordHoleBest(holeIdx, score);
    const title = term === 'overPar' ? t('overPar', { n: diffN }) : t(term);
    let sub = `${t('strokesN', { n: score })} · ${t('parN', { n: hole.par })} · ${formatVsPar(diffN)}`;
    if (isBest) sub += ` · ${t('holeBestNote')}`;
    const kind = term === 'holeInOne' ? 'mg-ace' : diffN < 0 ? 'mg-good' : diffN > 1 ? 'mg-bad' : '';
    if (term === 'holeInOne') {
      ctx.play('win');
      ctx.haptic('success');
    } else if (diffN < 0) ctx.play('success');
    showBanner(title, sub, kind, 1750);
    updateHud();
    const last = holeIdx + 1 >= HOLE_COUNT;
    if (last) {
      // Commit the result now, so leaving during the banner cannot lose the round.
      ctx.storage.remove('progress');
      const isBestRound = ctx.storage.recordBest(diff, sumScores(scores), 'lower');
      after(1850, () => finishRound(isBestRound));
    } else {
      const next = HOLES[holeIdx + 1];
      ctx.storage.set('progress', { diff, hole: holeIdx + 1, scores: scores.slice(), strokes: 0, ball: { ...next.start } } satisfies Progress);
      after(1850, () => loadHole(holeIdx + 1));
    }
  }

  function finishRound(isBest: boolean): void {
    phase = 'done';
    ctx.play('win');
    ctx.haptic('success');
    showScorecard(true, isBest);
    // Keep the last frame on screen but stop burning frames behind the modal.
    after(400, () => {
      if (phase === 'done') loop.stop();
    });
  }

  // ── Scorecard ─────────────────────────────────────────────────────────
  function scorecardEl(final: boolean, isBest: boolean): HTMLElement {
    const grid = el('div', { class: 'mg-card-grid' });
    const bests = holeBests();
    HOLES.forEach((h, i) => {
      const s = scores[i];
      let cls = 'mg-cell';
      if (s === undefined) cls += i === holeIdx && !final ? ' mg-current' : ' mg-pending';
      else if (s === 1) cls += ' mg-ace';
      else if (s > cfg.maxStrokes) cls += ' mg-max';
      else if (s < h.par) cls += ' mg-under';
      else if (s > h.par) cls += ' mg-over';
      const hb = bests[holeBestKey(i)];
      grid.append(
        el(
          'div',
          { class: cls },
          el('span', { class: 'mg-cell-h', text: String(i + 1) }),
          el('span', { class: 'mg-cell-s', text: s === undefined ? '–' : String(s) }),
          el('span', { class: 'mg-cell-p', text: `P${h.par}` + (typeof hb === 'number' ? ` · ★${hb}` : '') }),
        ),
      );
    });
    const played = scores.filter((s) => s !== undefined).length;
    const total = sumScores(scores);
    const d = vsPar(scores);
    const parSoFar = HOLES.slice(0, played).reduce((a, h) => a + h.par, 0);
    const best = ctx.storage.getBest(diff);
    const row = (label: string, value: string, cls = '') =>
      el('div', { class: 'mg-card-row' }, el('span', { class: 'muted', text: label }), el('strong', { class: cls, text: value }));
    return el(
      'div',
      { class: 'mg-card' },
      grid,
      el('p', { class: 'mg-card-legend muted', text: `★ = ${t('cellBest')}` }),
      row(t('totalStrokes'), String(total)),
      row(t('courseParLabel'), String(parSoFar)),
      row(t('vsParLabel'), formatVsPar(d), d < 0 ? 'mg-under' : d > 0 ? 'mg-over' : ''),
      best !== null ? row(t('bestRound'), t('bestValue', { n: best, d: formatVsPar(best - totalPar()) })) : null,
      isBest ? el('p', { class: 'mg-newbest', text: '🏆 ' + t('newBest') }) : null,
    );
  }

  function showScorecard(final: boolean, isBest = false): void {
    if (phase === 'start') return;
    if (final) {
      ctx.showModal({
        title: `${t('roundDone')} · ${t(diff)}`,
        body: scorecardEl(true, isBest),
        dismissible: false,
        buttons: [
          { label: t('home'), onClick: () => ctx.exit() },
          { label: t('newGame'), primary: true, onClick: () => showStart() },
        ],
      });
    } else {
      cancelDrag();
      ctx.showModal({ title: `${t('scorecard')} · ${t(diff)}`, body: scorecardEl(false, false), buttons: [{ label: t('close'), primary: true }] });
    }
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function tracePoly(g: CanvasRenderingContext2D, p: Vec[]): void {
    g.beginPath();
    g.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; i++) g.lineTo(p[i].x, p[i].y);
    g.closePath();
  }

  /** Wooden rails: dark rim, solid body, and a lit inner edge (clipped to the playable area). */
  function strokeWalls(g: CanvasRenderingContext2D): void {
    const polys = [hole.outline, ...hole.blocks];
    const pass = (color: string, w: number) => {
      g.strokeStyle = color;
      g.lineWidth = w;
      for (const p of polys) {
        tracePoly(g, p);
        g.stroke();
      }
    };
    pass(pal.wallEdge, 0.36);
    g.fillStyle = pal.wall;
    for (const b of hole.blocks) {
      tracePoly(g, b);
      g.fill();
    }
    pass(pal.wall, 0.24);
    // Light from the top-left: highlight only the rail faces that look towards it.
    g.strokeStyle = pal.wallTop;
    g.lineWidth = 0.07;
    g.lineCap = 'butt';
    g.beginPath();
    for (const f of litFaces) {
      g.moveTo(f.a.x, f.a.y);
      g.lineTo(f.b.x, f.b.y);
    }
    g.stroke();
    g.lineCap = 'round';
  }

  /** Wall edges facing the light, shifted onto the face side of the rail (computed once per hole). */
  function computeLitFaces(h: Hole): { a: Vec; b: Vec }[] {
    const out: { a: Vec; b: Vec }[] = [];
    const lx = -0.45;
    const ly = -0.9;
    const polys: { p: Vec[]; faceInside: boolean }[] = [{ p: h.outline, faceInside: true }, ...h.blocks.map((p) => ({ p, faceInside: false }))];
    for (const { p, faceInside } of polys) {
      for (let i = 0; i < p.length; i++) {
        const a = p[i];
        const b = p[(i + 1) % p.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-6) continue;
        let nx = (b.y - a.y) / len;
        let ny = -(b.x - a.x) / len;
        const inside = pointInPoly((a.x + b.x) / 2 + nx * 0.05, (a.y + b.y) / 2 + ny * 0.05, p);
        // Face normal points towards the playing surface.
        if (inside !== faceInside) {
          nx = -nx;
          ny = -ny;
        }
        if (nx * lx + ny * ly < 0.3) continue;
        // Skip faces that do not border open play (e.g. a block edge lying on the outer rail).
        const mx = (a.x + b.x) / 2 + nx * 0.25;
        const my = (a.y + b.y) / 2 + ny * 0.25;
        if (!pointInPoly(mx, my, h.outline) || h.blocks.some((q) => q !== p && pointInPoly(mx, my, q))) continue;
        const o = 0.09;
        const inset = Math.min(0.2, len * 0.3);
        const tx = ((b.x - a.x) / len) * inset;
        const ty = ((b.y - a.y) / len) * inset;
        out.push({ a: { x: a.x + nx * o + tx, y: a.y + ny * o + ty }, b: { x: b.x + nx * o - tx, y: b.y + ny * o - ty } });
      }
    }
    return out;
  }

  function draw(): void {
    if (!cv || !sim) return;
    const g = cv.ctx;
    const W = cv.width;
    const H = cv.height;
    g.setTransform(cv.dpr, 0, 0, cv.dpr, 0, 0);
    g.fillStyle = pal.bg;
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(ox, oy);
    g.scale(scale, scale);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // Drop shadow under the course.
    g.save();
    g.translate(0.12, 0.18);
    g.fillStyle = pal.shadow;
    tracePoly(g, hole.outline);
    g.fill();
    g.restore();

    // Felt + inner details (clipped to the outline).
    g.save();
    tracePoly(g, hole.outline);
    g.clip();
    g.fillStyle = pal.felt;
    g.fillRect(-1, -1, FIELD_W + 2, FIELD_H + 2);
    g.fillStyle = pal.stripe;
    for (let y = 0; y < FIELD_H; y += 2) g.fillRect(-1, y, FIELD_W + 2, 1);
    tracePoly(g, hole.outline);
    g.strokeStyle = pal.fringe;
    g.lineWidth = 1.1;
    g.stroke();

    // Tee mat with its tee spot.
    g.fillStyle = pal.tee;
    g.beginPath();
    g.roundRect(hole.start.x - 0.55, hole.start.y - 0.38, 1.1, 0.76, 0.16);
    g.fill();
    g.fillStyle = pal.stripe;
    g.beginPath();
    g.arc(hole.start.x, hole.start.y, 0.09, 0, Math.PI * 2);
    g.fill();

    // Sand
    g.fillStyle = pal.sand;
    for (const s of zoneDraw.sand) {
      g.beginPath();
      g.roundRect(s.x, s.y, s.w, s.h, 0.3);
      g.fill();
    }
    g.fillStyle = pal.sandDot;
    g.beginPath();
    for (const d of sandDots) {
      g.moveTo(d.x + 0.035, d.y);
      g.arc(d.x, d.y, 0.035, 0, Math.PI * 2);
    }
    g.fill();
    // Water
    for (const w of zoneDraw.water) {
      g.save();
      g.beginPath();
      g.roundRect(w.x, w.y, w.w, w.h, 0.25);
      g.clip();
      g.fillStyle = pal.water;
      g.fillRect(w.x, w.y, w.w, w.h);
      g.strokeStyle = pal.waterLine;
      g.lineWidth = 0.05;
      const lines = Math.max(1, Math.round(w.h / 0.7));
      for (let k = 0; k < lines; k++) {
        const yy = w.y + (w.h * (k + 0.5)) / lines;
        g.beginPath();
        for (let x = w.x; x <= w.x + w.w + 0.01; x += 0.15) {
          const y = yy + 0.07 * Math.sin(x * 4 + clock * 2.2 + k * 1.7);
          if (x === w.x) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.restore();
    }
    // Boosters (animated chevrons along the push direction).
    hole.boosters.forEach((b, i) => {
      const d = zoneDraw.boost[i] ?? b;
      g.save();
      g.beginPath();
      g.roundRect(d.x, d.y, d.w, d.h, 0.22);
      g.clip();
      g.fillStyle = pal.boost;
      g.fillRect(d.x, d.y, d.w, d.h);
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      g.translate(cx, cy);
      g.rotate(Math.atan2(b.dir.y, b.dir.x) + Math.PI / 2); // push direction → local "up"
      const horizontal = Math.abs(b.dir.x) > 0.5;
      const len = horizontal ? b.w : b.h;
      const wid = horizontal ? b.h : b.w;
      const spacing = 0.8;
      const speed = 2.4 * (b.power ?? 1);
      const off = (clock * speed) % spacing;
      g.strokeStyle = pal.boostChev;
      g.lineWidth = 0.12;
      g.globalAlpha = 0.9;
      const half = Math.min(wid * 0.3, 0.9);
      for (let yy = len / 2 + spacing - off; yy > -len / 2 - spacing; yy -= spacing) {
        g.beginPath();
        g.moveTo(-half, yy + 0.24);
        g.lineTo(0, yy - 0.08);
        g.lineTo(half, yy + 0.24);
        g.stroke();
      }
      g.restore();
    });
    g.restore();

    strokeWalls(g);

    // Movers
    for (const m of hole.movers) {
      const r = moverRect(m, sim.time);
      g.fillStyle = pal.shadow;
      g.fillRect(r.x + 0.08, r.y + 0.1, r.w, r.h);
      g.save();
      g.fillStyle = pal.wall;
      g.fillRect(r.x, r.y, r.w, r.h);
      g.beginPath();
      g.rect(r.x, r.y, r.w, r.h);
      g.clip();
      g.strokeStyle = pal.warning;
      g.globalAlpha = 0.55;
      g.lineWidth = 0.13;
      for (let x = r.x - r.h; x < r.x + r.w + r.h; x += 0.45) {
        g.beginPath();
        g.moveTo(x, r.y + r.h);
        g.lineTo(x + r.h, r.y);
        g.stroke();
      }
      g.restore();
      g.strokeStyle = pal.wallEdge;
      g.lineWidth = 0.08;
      g.strokeRect(r.x, r.y, r.w, r.h);
    }

    // Bumpers
    hole.bumpers.forEach((b, i) => {
      g.fillStyle = pal.shadow;
      g.beginPath();
      g.arc(b.x + 0.06, b.y + 0.08, b.r, 0, Math.PI * 2);
      g.fill();
      const age = clock - (bumperHit[i] ?? -10);
      const pulse = age < 0.15 ? 1 + 0.12 * (1 - age / 0.15) : 1;
      const rr = b.r * pulse;
      const grad = g.createRadialGradient(b.x - rr * 0.3, b.y - rr * 0.3, rr * 0.1, b.x, b.y, rr);
      grad.addColorStop(0, pal.bumperCore);
      grad.addColorStop(1, pal.bumper);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(b.x, b.y, rr, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = pal.bumperRing;
      g.lineWidth = 0.09;
      g.stroke();
      if (age < 0.35) {
        g.globalAlpha = 1 - age / 0.35;
        g.lineWidth = 0.1;
        g.beginPath();
        g.arc(b.x, b.y, b.r + age * 1.6, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    });

    // Cup
    const cx = hole.cup.x;
    const cy = hole.cup.y;
    g.fillStyle = pal.cupRim;
    g.beginPath();
    g.arc(cx, cy, CUP_R + 0.06, 0, Math.PI * 2);
    g.fill();
    const cg = g.createRadialGradient(cx + 0.06, cy + 0.08, CUP_R * 0.1, cx, cy, CUP_R);
    cg.addColorStop(0, pal.cup);
    cg.addColorStop(1, pal.cupRim);
    g.fillStyle = cg;
    g.beginPath();
    g.arc(cx, cy, CUP_R, 0, Math.PI * 2);
    g.fill();

    // Trail
    const n = trail.length;
    g.fillStyle = pal.ball;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / (n + 1);
      g.globalAlpha = 0.22 * k;
      g.beginPath();
      g.arc(trail[i].x, trail[i].y, BALL_R * (0.3 + 0.6 * k), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // Ready indicator: a soft pulsing ring when a putt is possible.
    const ready = phase === 'play' && !sim.moving && !sim.sunk && !dragging;
    if (ready) {
      g.strokeStyle = pal.aim;
      g.globalAlpha = 0.35 + 0.2 * Math.sin(clock * 4);
      g.lineWidth = 0.05;
      g.beginPath();
      g.arc(sim.ball.x, sim.ball.y, BALL_R + 0.2 + 0.05 * Math.sin(clock * 4), 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }

    // Ball
    if (!(sim.sunk && sinkT > 0.4)) {
      let bx = sim.ball.x;
      let by = sim.ball.y;
      let s = 1;
      if (sim.sunk && sinkT >= 0) {
        const k = Math.min(1, sinkT / 0.4);
        bx = sim.ball.x + (cx - sim.ball.x) * k;
        by = sim.ball.y + (cy - sim.ball.y) * k;
        s = 1 - k * 0.85;
      }
      if (!sim.sunk) {
        g.fillStyle = pal.shadow;
        g.beginPath();
        g.ellipse(bx + 0.06, by + 0.08, BALL_R * 1.05, BALL_R * 0.9, 0, 0, Math.PI * 2);
        g.fill();
      }
      const grad = g.createRadialGradient(bx - BALL_R * 0.35 * s, by - BALL_R * 0.35 * s, BALL_R * 0.1 * s, bx, by, BALL_R * s);
      grad.addColorStop(0, pal.ball);
      grad.addColorStop(1, pal.ballShade);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(bx, by, BALL_R * s, 0, Math.PI * 2);
      g.fill();
    }

    // Flag (drawn above the ball so it reads as standing up).
    const wave = Math.sin(clock * 3) * 0.06;
    g.lineWidth = 0.07;
    g.strokeStyle = pal.pole;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx, cy - 1.45);
    g.stroke();
    g.fillStyle = pal.flag;
    g.beginPath();
    g.moveTo(cx, cy - 1.45);
    g.lineTo(cx + 0.78 + wave, cy - 1.2 + wave * 0.5);
    g.lineTo(cx, cy - 0.95);
    g.closePath();
    g.fill();

    // Particles
    for (const p of particles) {
      g.globalAlpha = Math.max(0, p.life / p.max);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    if (dragging && aim) drawAim(g, aim);

    g.restore();

    // Hole-switch fade.
    if (fadeT > 0) {
      g.globalAlpha = fadeT;
      g.fillStyle = pal.bg;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  function drawAim(g: CanvasRenderingContext2D, a: Aim): void {
    if (!sim) return;
    const b = sim.ball;
    const range = dragRange();
    // Rubber band from the anchor to the finger.
    g.strokeStyle = pal.band;
    g.lineWidth = 0.06;
    g.beginPath();
    g.moveTo(anchor.x, anchor.y);
    g.lineTo(pointer.x, pointer.y);
    g.stroke();
    g.fillStyle = pal.band;
    g.beginPath();
    g.arc(pointer.x, pointer.y, 0.26, 0, Math.PI * 2);
    g.fill();
    if (!anchorOnBall) {
      // Where the drag started (also the cancel zone).
      g.lineWidth = 0.05;
      g.setLineDash([0.1, 0.12]);
      g.beginPath();
      g.arc(anchor.x, anchor.y, range.min, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }

    if (!a.valid) {
      // Inside the cancel zone.
      g.strokeStyle = pal.band;
      g.lineWidth = 0.08;
      g.beginPath();
      g.arc(b.x, b.y, 0.58, 0, Math.PI * 2);
      g.stroke();
      return;
    }

    g.strokeStyle = pal.aim;
    g.lineWidth = 0.09;
    if (cfg.guide === 'bounce' && guide.length > 1) {
      g.setLineDash([0.12, 0.2]);
      g.beginPath();
      g.moveTo(guide[0].x, guide[0].y);
      for (let i = 1; i < guide.length; i++) g.lineTo(guide[i].x, guide[i].y);
      g.stroke();
      g.setLineDash([]);
      const end = guide[guide.length - 1];
      g.fillStyle = pal.aim;
      g.beginPath();
      g.arc(end.x, end.y, 0.09, 0, Math.PI * 2);
      g.fill();
    } else if (cfg.guide !== 'short') {
      const len = 1 + 5 * a.power;
      g.save();
      tracePoly(g, hole.outline);
      g.clip();
      g.setLineDash([0.12, 0.2]);
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x + a.dir.x * len, b.y + a.dir.y * len);
      g.stroke();
      g.setLineDash([]);
      g.restore();
    } else {
      const len = 1.1;
      const tx = b.x + a.dir.x * len;
      const ty = b.y + a.dir.y * len;
      g.beginPath();
      g.moveTo(b.x + a.dir.x * BALL_R * 1.4, b.y + a.dir.y * BALL_R * 1.4);
      g.lineTo(tx, ty);
      g.stroke();
      const px = -a.dir.y;
      const py = a.dir.x;
      g.fillStyle = pal.aim;
      g.beginPath();
      g.moveTo(tx + a.dir.x * 0.22, ty + a.dir.y * 0.22);
      g.lineTo(tx + px * 0.16, ty + py * 0.16);
      g.lineTo(tx - px * 0.16, ty - py * 0.16);
      g.closePath();
      g.fill();
    }
    // Power ring around the ball.
    const rr = 0.58;
    g.lineWidth = 0.13;
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.arc(b.x, b.y, rr, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = a.power < 0.5 ? pal.success : a.power < 0.8 ? pal.warning : pal.danger;
    g.beginPath();
    g.arc(b.x, b.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a.power);
    g.stroke();
  }

  showStart();
  return {
    destroy() {
      teardownRound();
    },
  };
}

const game: GameModule = { strings, create };
export default game;
