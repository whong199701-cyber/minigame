import type { GameContext, GameInstance, GameModule, SoundName, ThemeName } from '../../app/types';
import { el, button, segmented } from '../../app/ui';
import { createCanvas, createLoop, onPointer, seededRandom, type CanvasHandle } from '../../app/canvas';
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
  moverRect,
  newSim,
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
  type SimState,
  type Vec,
} from './logic';
import './style.css';

const strings = {
  zh: {
    rules:
      '从球的后方拖动，像弹弓一样拉开：虚线显示方向，光环与力度条显示力量，松手推杆；拖回球上可取消。\n球停稳后才能再次击球。球速适中时经过球洞才会落袋，太快会直接飞过。\n沙地阻力很大；落水则球回到上一停点并罚 1 杆；加速带会推动球；移动挡板需要掐准时机。\n每洞最多 8 杆，用完则罚 1 杆并进入下一洞。进度会自动保存。\n目标：18 洞总杆数尽量少，低于标准杆最佳。\n休闲：显示到首次反弹的预测路线，球洞更宽容；标准：只显示方向虚线；职业：仅短箭头，必须轻推入洞，沙地更黏。',
    desc: '18 洞物理推杆：弹弓式拖拽，沙坑、水塘、弹珠与移动挡板。',
    casual: '休闲',
    standard: '标准',
    pro: '职业',
    casualDesc: '预测反弹路线 · 球洞宽容',
    standardDesc: '方向虚线 · 标准球洞',
    proDesc: '仅短箭头 · 必须轻推入洞',
    continueRound: '继续 · 第 {n} 洞',
    newRound: '新一轮',
    bestTotal: '最佳：{n} 杆（{d}）',
    noBest: '尚无纪录',
    holeLabel: '洞',
    parLabel: '标准杆',
    strokesLabel: '杆数',
    totalLabel: '总计',
    statusLine: '{n}/{total} 洞 · 标准杆 {par}',
    statusBest: ' · 最佳 {b}',
    holeOf: '第 {n} 洞',
    parN: '标准杆 {n}',
    dragHint: '从球向后拖动瞄准 · 松手推杆',
    waterMsg: '落水！罚 1 杆',
    maxStrokesMsg: '已达 8 杆上限，罚 1 杆',
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
    courseParLabel: '球场标准杆',
    vsParLabel: '相对标准杆',
    bestRound: '最佳纪录',
    restartConfirm: '放弃当前进度并重新开始这一轮？',
    holeBestNote: '本洞新纪录',
    name1: '开球',
    name2: '狗腿弯',
    name3: '弹珠阵',
    name4: '沙坑',
    name5: '过水',
    name6: '之字形',
    name7: '斜角反弹',
    name8: '加速带',
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
      'Drag back from the ball like a slingshot: the dotted line shows direction, the ring and bar show power; release to putt. Drag back onto the ball to cancel.\nYou can only putt once the ball has stopped. The ball drops only when it crosses the cup at moderate speed — too fast and it skips over.\nSand is slow; water returns the ball to its last stop with a 1-stroke penalty; boosters push the ball; moving gates need timing.\nMax 8 strokes per hole — after that you take a 1-stroke penalty and move on. Progress is saved automatically.\nGoal: the lowest 18-hole total. Beat par!\nCasual: predicted path up to the first bounce and a forgiving cup. Standard: direction line only. Pro: short arrow only, the cup needs a gentle touch and sand is stickier.',
    desc: '18 holes of physics putting: slingshot drag, bunkers, water, bumpers and moving gates.',
    casual: 'Casual',
    standard: 'Standard',
    pro: 'Pro',
    casualDesc: 'Bounce preview · forgiving cup',
    standardDesc: 'Direction line · standard cup',
    proDesc: 'Short arrow only · gentle touch required',
    continueRound: 'Continue · hole {n}',
    newRound: 'New round',
    bestTotal: 'Best: {n} strokes ({d})',
    noBest: 'No record yet',
    holeLabel: 'Hole',
    parLabel: 'Par',
    strokesLabel: 'Strokes',
    totalLabel: 'Total',
    statusLine: 'Hole {n}/{total} · Par {par}',
    statusBest: ' · best {b}',
    holeOf: 'Hole {n}',
    parN: 'Par {n}',
    dragHint: 'Drag back from the ball to aim · release to putt',
    waterMsg: 'Splash! +1 stroke',
    maxStrokesMsg: 'Stroke limit reached: +1 penalty',
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
    courseParLabel: 'Course par',
    vsParLabel: 'Versus par',
    bestRound: 'Best round',
    restartConfirm: 'Abandon the current round and start over?',
    holeBestNote: 'New hole record',
    name1: 'Tee Off',
    name2: 'Dogleg',
    name3: 'Bumper Alley',
    name4: 'Sand Trap',
    name5: 'Water Carry',
    name6: 'Zigzag',
    name7: 'Bank Shot',
    name8: 'Booster',
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

interface Progress {
  diff: Difficulty;
  hole: number;
  scores: number[];
  strokes: number;
  ball: Vec;
}

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
  wall: string;
  wallEdge: string;
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
      wall: '#7a5238',
      wallEdge: '#3d2819',
      sand: '#cdb77d',
      sandDot: '#ad9759',
      water: '#2a63c4',
      waterLine: 'rgba(255,255,255,0.35)',
      boost: 'rgba(255,200,80,0.28)',
      boostChev: '#ffd166',
      bumper: '#ff7a59',
      bumperCore: '#ffb59e',
      bumperRing: '#ffd166',
      cup: '#0a0d12',
      cupRim: '#1c2430',
      ball: '#f8f8f3',
      ballShade: '#b9b9b0',
      shadow: 'rgba(0,0,0,0.4)',
      aim: 'rgba(255,255,255,0.92)',
      flag: '#ff5470',
      pole: '#e8ecf3',
    };
  }
  return {
    ...common,
    felt: '#56b56a',
    stripe: 'rgba(255,255,255,0.09)',
    fringe: '#7fd090',
    wall: '#8d5b3b',
    wallEdge: '#5a3822',
    sand: '#ead9a2',
    sandDot: '#c9b273',
    water: '#4b94f2',
    waterLine: 'rgba(255,255,255,0.55)',
    boost: 'rgba(255,170,40,0.3)',
    boostChev: '#ff9f1c',
    bumper: '#ff6a3d',
    bumperCore: '#ffb096',
    bumperRing: '#ffb703',
    cup: '#1a2230',
    cupRim: '#3a4759',
    ball: '#ffffff',
    ballShade: '#cfcfcf',
    shadow: 'rgba(0,0,0,0.28)',
    aim: 'rgba(255,255,255,0.98)',
    flag: '#e0304f',
    pole: '#ffffff',
  };
}

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
  let clock = 0;

  // Input state
  let dragging = false;
  let pointer: Vec = { x: 0, y: 0 };
  let aim: Aim | null = null;
  let guide: Vec[] = [];
  let hintShown = false;

  // Sound throttling
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
  let removeCard: (() => void) | null = null;

  const removeRestart = ctx.addHeaderAction({
    icon: '↻',
    label: t('restart'),
    onClick: () => {
      if (phase === 'start') return;
      if (phase === 'done' || (holeIdx === 0 && scores.length === 0 && (sim?.strokes ?? 0) === 0)) {
        showStart();
        return;
      }
      ctx.showModal({
        title: t('restart'),
        body: t('restartConfirm'),
        buttons: [
          { label: t('cancel') },
          {
            label: t('restart'),
            primary: true,
            onClick: () => {
              ctx.storage.remove('progress');
              showStart();
            },
          },
        ],
      });
    },
  });

  ctx.onDestroy(() => {
    removeRestart();
    removeCard?.();
    clearTimers();
    loop.stop();
    offPointer?.();
    cv?.destroy();
  });
  ctx.onVisibility((v) => {
    if (!v) {
      loop.stop();
      dragging = false;
      aim = null;
    } else if (phase === 'play' || phase === 'transition') loop.start();
  });
  ctx.onThemeChange((theme) => {
    pal = makePalette(theme, ctx.cssVar);
    if (cv && (phase === 'play' || phase === 'transition')) draw();
  });

  // ── Persistence ───────────────────────────────────────────────────────
  function loadProgress(): Progress | null {
    const p = ctx.storage.get<Progress | null>('progress', null);
    if (!p || !DIFFICULTIES.includes(p.diff) || !Array.isArray(p.scores)) return null;
    if (p.hole < 0 || p.hole >= HOLE_COUNT || p.scores.length !== p.hole) return null;
    return p;
  }
  function saveProgress(): void {
    if (!sim || phase === 'done') return;
    const p: Progress = { diff, hole: holeIdx, scores: scores.slice(), strokes: sim.strokes, ball: { ...sim.lastRest } };
    ctx.storage.set('progress', p);
  }
  function holeBestKey(i: number): string {
    return `${diff}:${i}`;
  }
  function getHoleBest(i: number): number | null {
    const m = ctx.storage.get<Record<string, number>>('holeBest', {});
    const v = m[holeBestKey(i)];
    return typeof v === 'number' ? v : null;
  }
  function recordHoleBest(i: number, score: number): boolean {
    const m = ctx.storage.get<Record<string, number>>('holeBest', {});
    const prev = m[holeBestKey(i)];
    if (typeof prev === 'number' && prev <= score) return false;
    m[holeBestKey(i)] = score;
    ctx.storage.set('holeBest', m);
    return true;
  }

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    phase = 'start';
    clearTimers();
    loop.stop();
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    removeCard?.();
    removeCard = null;
    sim = null;
    dragging = false;
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
          t('continueRound', { n: saved.hole + 1 }),
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

  // ── Game screen ───────────────────────────────────────────────────────
  let hud: { hole: HTMLElement; par: HTMLElement; strokes: HTMLElement; total: HTMLElement };
  let powerBar: HTMLElement;
  let powerFill: HTMLElement;
  let banner: HTMLElement;
  let bannerTitle: HTMLElement;
  let bannerSub: HTMLElement;
  let hintEl: HTMLElement;

  function stat(label: string): { wrap: HTMLElement; value: HTMLElement } {
    const value = el('span', { class: 'stat-value', text: '–' });
    const wrap = el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), value);
    return { wrap, value };
  }

  function startRound(saved: Progress | null): void {
    root.innerHTML = '';
    clearTimers();
    scores = saved ? saved.scores.slice() : [];
    shotsThisRound = saved ? 1 : 0;
    hintShown = false;

    const sHole = stat(t('holeLabel'));
    const sPar = stat(t('parLabel'));
    const sStrokes = stat(t('strokesLabel'));
    const sTotal = stat(t('totalLabel'));
    hud = { hole: sHole.value, par: sPar.value, strokes: sStrokes.value, total: sTotal.value };
    const hudEl = el('div', { class: 'game-hud mg-hud' }, sHole.wrap, sPar.wrap, sStrokes.wrap, sTotal.wrap);
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
      down: (p) => onDown(p.x, p.y),
      move: (p) => onMove(p.x, p.y),
      up: (p) => onUp(p.x, p.y),
      cancel: () => cancelDrag(),
    });
    removeCard?.();
    removeCard = ctx.addHeaderAction({ icon: '▤', label: t('scorecard'), onClick: () => showScorecard(false) });

    phase = 'play';
    loadHole(saved ? saved.hole : 0, saved ?? undefined);
    loop.start();
  }

  function layout(w: number, h: number): void {
    const pad = 14;
    scale = Math.max(1, Math.min((w - pad * 2) / FIELD_W, (h - pad * 2) / FIELD_H));
    ox = (w - FIELD_W * scale) / 2;
    oy = (h - FIELD_H * scale) / 2;
  }

  function loadHole(i: number, saved?: Progress): void {
    holeIdx = i;
    hole = HOLES[i];
    sim = saved ? newSim(hole, saved.ball, saved.strokes) : newSim(hole);
    if (saved && !pointInField(saved.ball)) sim = newSim(hole, hole.start, saved.strokes);
    sinkT = -1;
    fadeT = 1;
    trail.length = 0;
    particles.length = 0;
    bumperHit.length = 0;
    dragging = false;
    aim = null;
    guide = [];
    const rnd = seededRandom(1234 + i * 97);
    sandDots = [];
    for (const s of hole.sand) {
      const n = Math.round(s.w * s.h * 2.2);
      for (let k = 0; k < n; k++) sandDots.push({ x: s.x + 0.1 + rnd() * (s.w - 0.2), y: s.y + 0.1 + rnd() * (s.h - 0.2) });
    }
    phase = 'play';
    updateHud();
    saveProgress();
    showBanner(`${t('holeOf', { n: i + 1 })} · ${t('name' + (i + 1))}`, t('parN', { n: hole.par }), 'mg-intro', 1300);
    if (shotsThisRound === 0 && !hintShown) {
      hintShown = true;
      hintEl.classList.add('mg-show');
    }
  }

  function pointInField(p: Vec): boolean {
    return p.x > 0 && p.x < FIELD_W && p.y > 0 && p.y < FIELD_H;
  }

  function updateHud(): void {
    if (!sim) return;
    hud.hole.textContent = `${holeIdx + 1}/${HOLE_COUNT}`;
    hud.par.textContent = String(hole.par);
    hud.strokes.textContent = String(sim.strokes);
    const d = vsPar(scores);
    hud.total.textContent = formatVsPar(d);
    hud.total.className = 'stat-value' + (d < 0 ? ' mg-under' : d > 0 ? ' mg-over' : '');
    const best = getHoleBest(holeIdx);
    ctx.setStatus(t('statusLine', { n: holeIdx + 1, total: HOLE_COUNT, par: hole.par }) + (best !== null ? t('statusBest', { b: best }) : ''));
  }

  function showBanner(title: string, sub: string, kind: '' | 'mg-good' | 'mg-bad' | 'mg-ace' | 'mg-intro', ms: number): void {
    bannerTitle.textContent = title;
    bannerSub.textContent = sub;
    banner.className = 'mg-banner mg-show ' + kind;
    after(ms, () => banner.classList.remove('mg-show'));
  }

  // ── Input ─────────────────────────────────────────────────────────────
  function toUnits(x: number, y: number): Vec {
    return { x: (x - ox) / scale, y: (y - oy) / scale };
  }

  function onDown(x: number, y: number): void {
    if (phase !== 'play' || !sim || sim.moving || sim.sunk) return;
    const p = toUnits(x, y);
    const grab = Math.max(1.7, 52 / scale);
    if (Math.hypot(p.x - sim.ball.x, p.y - sim.ball.y) > grab) return;
    dragging = true;
    pointer = p;
    aim = aimFromDrag(sim.ball, p);
    guide = [];
    ctx.haptic('light');
    powerBar.classList.add('mg-show');
  }

  function onMove(x: number, y: number): void {
    if (!dragging || !sim) return;
    pointer = toUnits(x, y);
    aim = aimFromDrag(sim.ball, pointer);
    if (cfg.guide === 'bounce' && aim.valid) guide = predictPath(sim, hole, cfg, aim.dir, aim.power, 1.5, 0.3);
    else guide = [];
    powerFill.style.width = `${Math.round((aim.valid ? aim.power : 0) * 100)}%`;
  }

  function onUp(x: number, y: number): void {
    if (!dragging || !sim) return;
    pointer = toUnits(x, y);
    aim = aimFromDrag(sim.ball, pointer);
    const a = aim;
    cancelDrag();
    if (!a.valid || phase !== 'play') return;
    if (shoot(sim, a.dir, a.power)) {
      shotsThisRound++;
      hintEl.classList.remove('mg-show');
      ctx.play('shoot');
      ctx.haptic('medium');
      trail.length = 0;
      updateHud();
    }
  }

  function cancelDrag(): void {
    dragging = false;
    aim = null;
    guide = [];
    powerBar.classList.remove('mg-show');
    powerFill.style.width = '0%';
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
      for (const ev of events) {
        switch (ev.type) {
          case 'wall':
            if (ev.speed > 1.2) {
              sfx('tap', 'wall', 70);
              if (ev.speed > 5) ctx.haptic('light');
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
            burst(ev.x, ev.y, 12, pal.waterLine, 3);
            updateHud();
            saveProgress();
            break;
          case 'rescue':
            ctx.toast(t('rescued'));
            break;
          case 'sunk':
            onSunk();
            break;
          case 'stop':
            if (wasMoving) onStopped();
            break;
        }
      }
    } else if (sim && phase === 'transition') {
      sim.time += dt;
      if (sinkT >= 0) sinkT += dt;
    }
    // Particles
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

  function burst(x: number, y: number, n: number, color: string, speed: number): void {
    if (particles.length > 80) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35, max: 0.35, r: 0.04 + Math.random() * 0.05, color });
    }
  }

  function onStopped(): void {
    if (!sim) return;
    updateHud();
    if (sim.strokes >= cfg.maxStrokes) {
      const score = holeScore(sim.strokes, false, cfg);
      ctx.play('lose');
      ctx.haptic('error');
      ctx.toast(t('maxStrokesMsg'));
      finishHole(score);
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
    burst(hole.cup.x, hole.cup.y, 14, pal.warning, 3);
    const score = holeScore(sim.strokes, true, cfg);
    updateHud();
    after(380, () => finishHole(score));
  }

  function finishHole(score: number): void {
    if (!sim) return;
    phase = 'transition';
    scores[holeIdx] = score;
    const term = scoreTerm(score, hole.par);
    const diffN = score - hole.par;
    const isBest = recordHoleBest(holeIdx, score);
    const title = term === 'overPar' ? t('overPar', { n: diffN }) : t(term);
    let sub = `${t('strokesN', { n: score })} · ${t('parN', { n: hole.par })} · ${formatVsPar(diffN)}`;
    if (isBest) sub += ` · ${t('holeBestNote')}`;
    const kind = term === 'holeInOne' ? 'mg-ace' : diffN < 0 ? 'mg-good' : diffN > 1 ? 'mg-bad' : '';
    if (diffN < 0) ctx.play('success');
    showBanner(title, sub, kind, 1700);
    updateHud();
    if (holeIdx + 1 >= HOLE_COUNT) {
      ctx.storage.remove('progress');
      after(1750, () => finishRound());
    } else {
      ctx.storage.set('progress', { diff, hole: holeIdx + 1, scores: scores.slice(), strokes: 0, ball: HOLES[holeIdx + 1].start } satisfies Progress);
      after(1750, () => loadHole(holeIdx + 1));
    }
  }

  function finishRound(): void {
    phase = 'done';
    loop.stop();
    const total = sumScores(scores);
    const isBest = ctx.storage.recordBest(diff, total, 'lower');
    ctx.play('win');
    ctx.haptic('success');
    showScorecard(true, isBest);
  }

  // ── Scorecard ─────────────────────────────────────────────────────────
  function scorecardEl(final: boolean, isBest: boolean): HTMLElement {
    const grid = el('div', { class: 'mg-card-grid' });
    HOLES.forEach((h, i) => {
      const s = scores[i];
      let cls = 'mg-cell';
      if (s === undefined) cls += i === holeIdx && !final ? ' mg-current' : ' mg-pending';
      else if (s === 1) cls += ' mg-ace';
      else if (s > cfg.maxStrokes) cls += ' mg-max';
      else if (s < h.par) cls += ' mg-under';
      else if (s > h.par) cls += ' mg-over';
      grid.append(
        el(
          'div',
          { class: cls },
          el('span', { class: 'mg-cell-h', text: String(i + 1) }),
          el('span', { class: 'mg-cell-s', text: s === undefined ? '–' : String(s) }),
          el('span', { class: 'mg-cell-p', text: `P${h.par}` }),
        ),
      );
    });
    const total = sumScores(scores);
    const d = vsPar(scores);
    const played = scores.filter((s) => s !== undefined).length;
    const parSoFar = final ? totalPar() : HOLES.slice(0, played).reduce((a, h) => a + h.par, 0);
    const best = ctx.storage.getBest(diff);
    const row = (label: string, value: string, cls = '') => el('div', { class: 'mg-card-row' }, el('span', { class: 'muted', text: label }), el('strong', { class: cls, text: value }));
    const wrap = el(
      'div',
      { class: 'mg-card' },
      grid,
      row(t('totalStrokes'), String(total)),
      row(t('courseParLabel'), String(parSoFar)),
      row(t('vsParLabel'), formatVsPar(d), d < 0 ? 'mg-under' : d > 0 ? 'mg-over' : ''),
      best !== null ? row(t('bestRound'), t('bestTotal', { n: best, d: formatVsPar(best - totalPar()) })) : null,
      isBest ? el('p', { class: 'mg-newbest', text: '🏆 ' + t('newBest') }) : null,
    );
    return wrap;
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

    // Sand
    for (const s of hole.sand) {
      g.fillStyle = pal.sand;
      g.beginPath();
      g.roundRect(s.x, s.y, s.w, s.h, 0.25);
      g.fill();
    }
    g.fillStyle = pal.sandDot;
    for (const d of sandDots) {
      g.beginPath();
      g.arc(d.x, d.y, 0.035, 0, Math.PI * 2);
      g.fill();
    }
    // Water
    for (const w of hole.water) {
      g.save();
      g.beginPath();
      g.roundRect(w.x, w.y, w.w, w.h, 0.2);
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
    // Boosters
    for (const b of hole.boosters) {
      g.save();
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, 0.2);
      g.clip();
      g.fillStyle = pal.boost;
      g.fillRect(b.x, b.y, b.w, b.h);
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const ang = Math.atan2(b.dir.y, b.dir.x) + Math.PI / 2; // dir → local "up"
      g.translate(cx, cy);
      g.rotate(ang);
      const len = Math.abs(b.dir.x) > 0.5 ? b.w : b.h;
      const wid = Math.abs(b.dir.x) > 0.5 ? b.h : b.w;
      const spacing = 0.8;
      const off = (clock * 2.4) % spacing;
      g.strokeStyle = pal.boostChev;
      g.lineWidth = 0.12;
      g.globalAlpha = 0.9;
      for (let yy = len / 2 - off; yy > -len / 2 - spacing; yy -= spacing) {
        g.beginPath();
        g.moveTo(-wid * 0.3, yy + 0.22);
        g.lineTo(0, yy - 0.08);
        g.lineTo(wid * 0.3, yy + 0.22);
        g.stroke();
      }
      g.restore();
    }
    // Blocks fill (inside clip so nothing leaks outside the course)
    for (const b of hole.blocks) {
      g.fillStyle = pal.wall;
      tracePoly(g, b);
      g.fill();
    }
    g.restore();

    // Walls as thick lines.
    g.strokeStyle = pal.wall;
    g.lineWidth = 0.3;
    tracePoly(g, hole.outline);
    g.stroke();
    for (const b of hole.blocks) {
      tracePoly(g, b);
      g.stroke();
    }
    g.strokeStyle = pal.wallEdge;
    g.lineWidth = 0.08;
    tracePoly(g, hole.outline);
    g.stroke();
    for (const b of hole.blocks) {
      tracePoly(g, b);
      g.stroke();
    }

    // Movers
    for (const m of hole.movers) {
      const r = moverRect(m, sim.time);
      g.save();
      g.fillStyle = pal.shadow;
      g.fillRect(r.x + 0.08, r.y + 0.1, r.w, r.h);
      g.fillStyle = pal.wall;
      g.fillRect(r.x, r.y, r.w, r.h);
      g.beginPath();
      g.rect(r.x, r.y, r.w, r.h);
      g.clip();
      g.strokeStyle = pal.wallEdge;
      g.globalAlpha = 0.45;
      g.lineWidth = 0.12;
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
      const grad = g.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1, b.x, b.y, b.r);
      grad.addColorStop(0, pal.bumperCore);
      grad.addColorStop(1, pal.bumper);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = pal.bumperRing;
      g.lineWidth = 0.09;
      g.stroke();
      const age = clock - (bumperHit[i] ?? -10);
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
    g.fillStyle = pal.shadow;
    g.beginPath();
    g.ellipse(hole.cup.x + 0.04, hole.cup.y + 0.06, CUP_R + 0.06, CUP_R + 0.02, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = pal.cupRim;
    g.beginPath();
    g.arc(hole.cup.x, hole.cup.y, CUP_R + 0.05, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = pal.cup;
    g.beginPath();
    g.arc(hole.cup.x, hole.cup.y, CUP_R, 0, Math.PI * 2);
    g.fill();

    // Trail
    const n = trail.length;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / (n + 1);
      g.globalAlpha = 0.22 * k;
      g.fillStyle = pal.ball;
      g.beginPath();
      g.arc(trail[i].x, trail[i].y, BALL_R * (0.3 + 0.6 * k), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // Ball
    if (!(sim.sunk && sinkT > 0.4)) {
      let bx = sim.ball.x;
      let by = sim.ball.y;
      let s = 1;
      if (sim.sunk && sinkT >= 0) {
        const k = Math.min(1, sinkT / 0.4);
        bx = sim.ball.x + (hole.cup.x - sim.ball.x) * k;
        by = sim.ball.y + (hole.cup.y - sim.ball.y) * k;
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
    g.strokeStyle = pal.pole;
    g.lineWidth = 0.07;
    g.beginPath();
    g.moveTo(hole.cup.x, hole.cup.y);
    g.lineTo(hole.cup.x, hole.cup.y - 1.45);
    g.stroke();
    g.fillStyle = pal.flag;
    g.beginPath();
    g.moveTo(hole.cup.x, hole.cup.y - 1.45);
    g.lineTo(hole.cup.x + 0.78 + wave, hole.cup.y - 1.2 + wave * 0.5);
    g.lineTo(hole.cup.x, hole.cup.y - 0.95);
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

    // Aim overlay
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
    // Rubber band to the finger.
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.lineWidth = 0.06;
    g.beginPath();
    g.moveTo(b.x, b.y);
    g.lineTo(pointer.x, pointer.y);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.arc(pointer.x, pointer.y, 0.28, 0, Math.PI * 2);
    g.fill();

    if (a.valid) {
      g.strokeStyle = pal.aim;
      g.lineWidth = 0.09;
      if (cfg.guide === 'bounce' && guide.length > 1) {
        g.setLineDash([0.12, 0.2]);
        g.beginPath();
        g.moveTo(guide[0].x, guide[0].y);
        for (let i = 1; i < guide.length; i++) g.lineTo(guide[i].x, guide[i].y);
        g.stroke();
        g.setLineDash([]);
      } else if (cfg.guide === 'line' || cfg.guide === 'bounce') {
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
    } else {
      // Inside the cancel zone: show a faint "x" ring.
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 0.08;
      g.beginPath();
      g.arc(b.x, b.y, 0.58, 0, Math.PI * 2);
      g.stroke();
    }
  }

  showStart();
  return {
    destroy() {
      clearTimers();
      loop.stop();
      offPointer?.();
      cv?.destroy();
    },
  };
}

const game: GameModule = { strings, create };
export default game;
