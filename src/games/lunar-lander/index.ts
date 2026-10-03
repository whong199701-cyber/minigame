import type { GameContext, GameInstance, GameModule, ThemeName } from '../../app/types';
import { el, button, segmented } from '../../app/ui';
import { createCanvas, createLoop, onPointer, type CanvasHandle } from '../../app/canvas';
import {
  CAMPAIGN_LEVELS,
  DT,
  FOOT_Y,
  MAX_TILT,
  MAX_VX,
  MAX_VY,
  READY_TIME,
  WORLD_W,
  altitudeAbove,
  clamp,
  createLevel,
  currentWind,
  normalizeAngle,
  rng,
  stepLevel,
  zoomFor,
  type CrashReason,
  type Input,
  type Level,
  type Pad,
} from './logic';
import './style.css';

const strings = {
  zh: {
    rules:
      '侧视登月：登月舱在重力下坠落，你要让它稳稳落在着陆台上。\n◀ ▶ 旋转姿态，按住 🔥 点火推进（燃料有限）；也可以按住画面左 / 右半区来旋转。\n安全着陆条件：垂直速度 < 2.5 m/s，水平速度 < 1.5 m/s，倾角 < 10°，两条腿都落在同一个着陆台上。\n着陆台倍率：宽 ×1、中 ×2、窄 ×3。本关得分 = 100 × 倍率 + 剩余燃料% × 2。\n撞到地形、速度过快或倾斜过大都会坠毁，可以重试本关。\n战役共 10 关：重力越来越大、地形更崎岖、着陆台更少更窄、燃料更紧，第 6 关起有侧风；通关后进入无尽模式。\n练习模式可以自由选择已解锁的关卡。',
    desc: '控制推进器与姿态，在燃料耗尽前把登月舱轻轻放在着陆台上。',
    modeCampaign: '战役',
    modePractice: '练习',
    campaignInfo: '10 关战役，通关后进入无尽模式',
    practiceInfo: '自由练习已解锁的关卡',
    bestCampaign: '战役最佳：{n} 分',
    bestLevel: '本关最佳：{n} 分',
    noBest: '尚无纪录',
    levelN: '第 {n} 关',
    unlockedN: '已解锁 {n} 关',
    alt: '高度',
    vspeed: '垂直',
    hspeed: '水平',
    tilt: '倾角',
    fuel: '燃料',
    rotateLeft: '左转',
    rotateRight: '右转',
    thrust: '推进',
    gravityLabel: '重力 {g} m/s²',
    windLabel: '侧风 {dir} {w} m/s²',
    noWind: '无风',
    wind: '风',
    landedTitle: '着陆成功！',
    crashedTitle: '坠毁了',
    padBonus: '着陆台 ×{m}',
    fuelBonus: '剩余燃料 {f}%',
    levelScore: '本关得分',
    campaignTotal: '战役总分',
    campaignComplete: '战役完成！',
    campaignCompleteBody: '全部 10 关通关！接下来是无尽模式：重力更大、风更强、燃料更紧。',
    continueEndless: '无尽模式',
    reasonTerrain: '落在了崎岖的地面上',
    reasonOffPad: '有一条腿没有踩在着陆台上',
    reasonVspeed: '垂直速度过快：{v} m/s（上限 2.5）',
    reasonHspeed: '水平速度过快：{v} m/s（上限 1.5）',
    reasonTilt: '倾角过大：{a}°（上限 10°）',
    reasonHull: '机身撞上了地形',
    reasonLost: '飞出了着陆区',
    outOfFuel: '燃料耗尽！',
    lowFuel: '燃料不足 20%！',
    controlsHint: '◀ ▶ 旋转 · 按住 🔥 推进\n按住画面左 / 右半区也可以旋转',
    scoreSoFar: '战役累计 {n} 分',
    limits: '安全着陆：↓ < 2.5 m/s · ↔ < 1.5 m/s · 倾角 < 10°',
    newLevelBest: '本关新纪录！',
    statusCampaign: '第 {n} 关 · {s} 分',
    statusPractice: '练习 · 第 {n} 关',
    landedBanner: '着陆 ×{m}',
    endless: '无尽',
    pauseLabel: '暂停',
  },
  en: {
    rules:
      'Side-view moon landing: the lander falls under gravity and you must set it down softly on a landing pad.\n◀ ▶ rotate, hold 🔥 to fire the main engine (fuel is limited). You can also hold the left / right half of the screen to rotate.\nSafe landing: vertical speed < 2.5 m/s, horizontal speed < 1.5 m/s, tilt < 10°, and both legs on the same pad.\nPad multipliers: wide ×1, medium ×2, narrow ×3. Level score = 100 × multiplier + fuel left % × 2.\nHitting terrain, coming in too fast or too tilted is a crash — retry the level.\nCampaign: 10 levels with rising gravity, rougher terrain, fewer and narrower pads, tighter fuel and crosswind from level 6; then endless mode.\nPractice mode lets you replay any unlocked level.',
    desc: 'Manage thrust and attitude to set the lander down gently on a pad before the fuel runs out.',
    modeCampaign: 'Campaign',
    modePractice: 'Practice',
    campaignInfo: '10 levels, then endless mode',
    practiceInfo: 'Replay any unlocked level',
    bestCampaign: 'Best campaign: {n} pts',
    bestLevel: 'Level best: {n} pts',
    noBest: 'No record yet',
    levelN: 'Level {n}',
    unlockedN: '{n} levels unlocked',
    alt: 'Alt',
    vspeed: 'V-speed',
    hspeed: 'H-speed',
    tilt: 'Tilt',
    fuel: 'Fuel',
    rotateLeft: 'Rotate left',
    rotateRight: 'Rotate right',
    thrust: 'Thrust',
    gravityLabel: 'Gravity {g} m/s²',
    windLabel: 'Wind {dir} {w} m/s²',
    noWind: 'No wind',
    wind: 'Wind',
    landedTitle: 'Touchdown!',
    crashedTitle: 'Crashed',
    padBonus: 'Pad ×{m}',
    fuelBonus: 'Fuel left {f}%',
    levelScore: 'Level score',
    campaignTotal: 'Campaign total',
    campaignComplete: 'Campaign complete!',
    campaignCompleteBody: 'All 10 levels done! Endless mode is next: heavier gravity, stronger wind, tighter fuel.',
    continueEndless: 'Endless mode',
    reasonTerrain: 'Landed on rough ground',
    reasonOffPad: 'One leg missed the pad',
    reasonVspeed: 'Too fast vertically: {v} m/s (limit 2.5)',
    reasonHspeed: 'Too fast horizontally: {v} m/s (limit 1.5)',
    reasonTilt: 'Too tilted: {a}° (limit 10°)',
    reasonHull: 'The hull struck the terrain',
    reasonLost: 'Drifted out of the landing zone',
    outOfFuel: 'Out of fuel!',
    lowFuel: 'Fuel below 20%!',
    controlsHint: '◀ ▶ rotate · hold 🔥 to thrust\nor hold the left / right half of the screen',
    scoreSoFar: 'Campaign so far: {n} pts',
    limits: 'Safe landing: ↓ < 2.5 m/s · ↔ < 1.5 m/s · tilt < 10°',
    newLevelBest: 'New level best!',
    statusCampaign: 'Level {n} · {s} pts',
    statusPractice: 'Practice · Level {n}',
    landedBanner: 'Landed ×{m}',
    endless: 'Endless',
    pauseLabel: 'Pause',
  },
};

type Mode = 'campaign' | 'practice';

interface Palette {
  skyTop: string;
  skyBottom: string;
  star: string;
  ground: string;
  groundDeep: string;
  groundEdge: string;
  pad: string;
  hull: string;
  hullDark: string;
  gold: string;
  goldDark: string;
  leg: string;
  nozzle: string;
  text: string;
  muted: string;
  accent: string;
  danger: string;
  warning: string;
  success: string;
}

interface Particle {
  kind: 'debris' | 'smoke' | 'dust' | 'flash';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  angle: number;
  spin: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
  ph: number;
}

const TAU = Math.PI * 2;
const FLAME_COLORS = ['#ff6a1f', '#ffb020', '#fff1a8'];
const DEBRIS_COLORS = ['#dfe4ee', '#9aa3b5', '#d9a62a', '#ff6a1f', '#6b7384'];

function palette(theme: ThemeName, cssVar: (n: string) => string): Palette {
  const dark = theme === 'dark';
  return {
    skyTop: dark ? '#05070d' : '#d6deed',
    skyBottom: dark ? '#0b0f19' : '#eef2f9',
    star: dark ? '#ffffff' : '#6b7690',
    ground: dark ? '#343d54' : '#b9c3d6',
    groundDeep: dark ? '#1b2131' : '#8d99b1',
    groundEdge: dark ? '#5a6684' : '#5f6b84',
    pad: cssVar('--success') || (dark ? '#3ddc97' : '#1fa86b'),
    hull: dark ? '#e3e8f1' : '#f8fafc',
    hullDark: dark ? '#8e97a9' : '#6d7789',
    gold: '#d9a62a',
    goldDark: '#9c741a',
    leg: dark ? '#b4bccb' : '#5a6372',
    nozzle: dark ? '#6b7384' : '#4a5363',
    text: cssVar('--text') || (dark ? '#e8ecf3' : '#171a21'),
    muted: cssVar('--muted') || '#8b94a7',
    accent: cssVar('--accent') || '#5b8cff',
    danger: cssVar('--danger') || '#ff5470',
    warning: cssVar('--warning') || '#ffc857',
    success: cssVar('--success') || '#3ddc97',
  };
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const savedMode = ctx.storage.get<string>('mode', 'campaign');
  let mode: Mode = savedMode === 'practice' ? 'practice' : 'campaign';
  let unlocked = Math.max(1, ctx.storage.get<number>('unlocked', 1));
  let practiceLevel = clamp(ctx.storage.get<number>('practiceLevel', 1), 1, unlocked);
  let pal = palette(ctx.theme, ctx.cssVar);

  // ── Live state ────────────────────────────────────────────────────────
  let lv: Level | null = null;
  let cv: CanvasHandle | null = null;
  let loop: ReturnType<typeof createLoop> | null = null;
  let offPointer: (() => void) | null = null;
  let campaignSeed = 0;
  let campaignScore = 0;
  let crashes = 0;
  let paused = false;
  let acc = 0;
  let endTimer = 0;
  let clock = 0;
  let zoom = 3;
  let camX = WORLD_W / 2;
  let camY = 60;
  let camSnap = true;
  let shake = 0;
  let wasThrust = false;
  let lastThrustSound = 0;
  let lowFuelWarned = false;
  let landedAt = 0;
  let showHint = false;
  const particles: Particle[] = [];
  let stars: Star[] = [];

  // inputs
  let btnLeft = false;
  let btnRight = false;
  let btnThrust = false;
  let keyLeft = false;
  let keyRight = false;
  let keyThrust = false;
  const canvasPointers = new Map<number, number>();

  // HUD elements
  let hudAlt: HTMLElement | null = null;
  let hudV: HTMLElement | null = null;
  let hudH: HTMLElement | null = null;
  let hudTilt: HTMLElement | null = null;
  let fuelFill: HTMLElement | null = null;
  let fuelPct: HTMLElement | null = null;
  let hudCache = '';

  // ── Header actions / global listeners ─────────────────────────────────
  const removePause = ctx.addHeaderAction({ icon: '⏸', label: t('pauseLabel'), onClick: () => pauseGame() });
  const removeRestart = ctx.addHeaderAction({
    icon: '↻',
    label: t('restart'),
    onClick: () => {
      if (lv && lv.phase === 'flying' && lv.time > READY_TIME + 1) {
        paused = true;
        ctx.showModal({
          title: t('restart'),
          body: t('quitConfirm'),
          buttons: [
            { label: t('cancel'), onClick: () => (paused = false) },
            { label: t('confirm'), primary: true, onClick: () => showStart() },
          ],
        });
      } else {
        showStart();
      }
    },
  });

  const onKey = (e: KeyboardEvent): void => {
    const down = e.type === 'keydown';
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        keyLeft = down;
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        keyRight = down;
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
      case ' ':
        keyThrust = down;
        break;
      default:
        return;
    }
    if (lv) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  // Dev-only hook so browser play scripts can inspect the live level state (stripped in production).
  const dbg = window as unknown as { __llState?: () => Level | null };
  if (import.meta.env.DEV) dbg.__llState = () => lv;

  ctx.onDestroy(() => {
    if (dbg.__llState) delete dbg.__llState;
    removePause();
    removeRestart();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    teardown();
  });
  ctx.onVisibility((visible) => {
    if (visible) {
      if (lv && cv) loop?.start();
    } else {
      releaseInputs();
      if (lv && lv.phase === 'flying' && !paused) pauseGame();
      loop?.stop();
    }
  });
  ctx.onThemeChange((th) => {
    pal = palette(th, ctx.cssVar);
    if (lv && cv && !loop?.running) draw();
  });

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    teardown();
    root.innerHTML = '';
    ctx.setStatus('');
    const panel = el('div', { class: 'll-panel' });
    const renderPanel = (): void => {
      panel.innerHTML = '';
      if (mode === 'campaign') {
        const b = ctx.storage.getBest('campaign');
        panel.append(
          el('p', { class: 'muted ll-info', text: t('campaignInfo') }),
          el('p', { class: 'll-best' + (b === null ? ' ll-none' : ''), text: b === null ? t('noBest') : t('bestCampaign', { n: b }) }),
        );
      } else {
        const label = el('div', { class: 'll-step-label' });
        const best = el('p', { class: 'll-best' });
        const prev = button('‹', () => {
          practiceLevel = Math.max(1, practiceLevel - 1);
          ctx.storage.set('practiceLevel', practiceLevel);
          refresh();
        }, { variant: 'secondary', class: 'll-step-btn' });
        const next = button('›', () => {
          practiceLevel = Math.min(unlocked, practiceLevel + 1);
          ctx.storage.set('practiceLevel', practiceLevel);
          refresh();
        }, { variant: 'secondary', class: 'll-step-btn' });
        const refresh = (): void => {
          label.textContent = t('levelN', { n: practiceLevel });
          const b = ctx.storage.getBest('level-' + practiceLevel);
          best.textContent = b === null ? t('noBest') : t('bestLevel', { n: b });
          best.className = 'll-best' + (b === null ? ' ll-none' : '');
          prev.disabled = practiceLevel <= 1;
          next.disabled = practiceLevel >= unlocked;
        };
        refresh();
        panel.append(
          el('div', { class: 'll-stepper' }, prev, label, next),
          best,
          el('p', { class: 'muted small', text: t('unlockedN', { n: unlocked }) }),
        );
      }
    };
    renderPanel();
    root.append(
      el(
        'div',
        { class: 'start-screen ll-start' },
        el('div', { class: 'big-icon', text: '🚀' }),
        el('p', { class: 'muted ll-desc', text: t('desc') }),
        segmented<Mode>(
          [
            { value: 'campaign', label: t('modeCampaign') },
            { value: 'practice', label: t('modePractice') },
          ],
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            renderPanel();
          },
        ),
        panel,
        button(t('play'), () => startRun(), { variant: 'primary', size: 'lg' }),
        el('p', { class: 'muted small ll-limits', text: t('limits') }),
      ),
    );
  }

  function startRun(): void {
    campaignSeed = (Math.random() * 0x7fffffff) >>> 0;
    campaignScore = 0;
    crashes = 0;
    const level = mode === 'campaign' ? 1 : practiceLevel;
    showHint = !ctx.storage.get('hinted', false);
    if (showHint) ctx.storage.set('hinted', true);
    startLevel(level, seedFor(level));
  }

  function seedFor(level: number): number {
    return (campaignSeed + level * 7919 + 17) >>> 0;
  }

  // ── Level setup / teardown ────────────────────────────────────────────
  function teardown(): void {
    loop?.stop();
    loop = null;
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    lv = null;
    clearTimeout(endTimer);
    endTimer = 0;
    particles.length = 0;
    paused = false;
    releaseInputs();
    hudAlt = hudV = hudH = hudTilt = fuelFill = fuelPct = null;
    hudCache = '';
  }

  function releaseInputs(): void {
    btnLeft = btnRight = btnThrust = false;
    keyLeft = keyRight = keyThrust = false;
    canvasPointers.clear();
    wasThrust = false;
    root.querySelectorAll('.ll-btn.ll-active').forEach((b) => b.classList.remove('ll-active'));
  }

  function startLevel(level: number, seed: number): void {
    teardown();
    root.innerHTML = '';
    lv = createLevel(level, seed);
    acc = 0;
    clock = 0;
    shake = 0;
    camSnap = true;
    lowFuelWarned = false;
    landedAt = 0;
    const srand = rng(seed ^ 0x9e3779b9);
    stars = Array.from({ length: 110 }, () => ({
      x: srand(),
      y: srand(),
      r: 0.8 + srand() * 1.4,
      a: 0.35 + srand() * 0.65,
      tw: 1 + srand() * 3,
      ph: srand() * TAU,
    }));

    // HUD
    hudAlt = el('div', { class: 'stat-value', text: '–' });
    hudV = el('div', { class: 'stat-value', text: '–' });
    hudH = el('div', { class: 'stat-value', text: '–' });
    hudTilt = el('div', { class: 'stat-value', text: '–' });
    const hud = el(
      'div',
      { class: 'game-hud ll-hud' },
      stat(t('alt'), hudAlt),
      stat(t('vspeed'), hudV),
      stat(t('hspeed'), hudH),
      stat(t('tilt'), hudTilt),
    );
    fuelFill = el('div', { class: 'll-fuel-fill' });
    fuelPct = el('div', { class: 'll-fuel-pct', text: '100%' });
    const fuelRow = el('div', { class: 'll-fuel' }, el('span', { text: t('fuel') }), el('div', { class: 'll-fuel-bar' }, fuelFill), fuelPct);
    const area = el('div', { class: 'game-area ll-area' });

    // Controls
    const left = holdButton(el('button', { class: 'll-btn', type: 'button', 'aria-label': t('rotateLeft'), text: '◀' }), (d) => (btnLeft = d));
    const thrustBtn = holdButton(
      el('button', { class: 'll-btn ll-thrust', type: 'button', 'aria-label': t('thrust') }, el('span', { text: '🔥' }), el('span', { class: 'll-btn-text', text: t('thrust') })),
      (d) => (btnThrust = d),
    );
    const right = holdButton(el('button', { class: 'll-btn', type: 'button', 'aria-label': t('rotateRight'), text: '▶' }), (d) => (btnRight = d));
    const controls = el('div', { class: 'll-controls' }, left, thrustBtn, right);

    root.append(hud, fuelRow, area, controls);
    updateStatus();

    cv = createCanvas(area, () => {
      camSnap = true;
      if (lv && cv && !loop?.running) draw();
    });
    offPointer = onPointer(cv.canvas, {
      down(p) {
        if (!cv) return;
        canvasPointers.set(p.id, p.x < cv.width / 2 ? -1 : 1);
      },
      move(p) {
        if (!cv || !canvasPointers.has(p.id)) return;
        canvasPointers.set(p.id, p.x < cv.width / 2 ? -1 : 1);
      },
      up(p) {
        canvasPointers.delete(p.id);
      },
    });
    loop = createLoop((dt) => frame(dt));
    loop.start();
    ctx.play('tick');
  }

  function stat(label: string, value: HTMLElement): HTMLElement {
    return el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: label }), value);
  }

  function holdButton(b: HTMLButtonElement, set: (down: boolean) => void): HTMLButtonElement {
    const active = new Set<number>();
    const down = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      active.add(e.pointerId);
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      b.classList.add('ll-active');
      set(true);
    };
    const up = (e: PointerEvent): void => {
      if (!active.delete(e.pointerId)) return;
      if (active.size === 0) {
        b.classList.remove('ll-active');
        set(false);
      }
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  function updateStatus(): void {
    if (!lv) return;
    let s = mode === 'campaign' ? t('statusCampaign', { n: lv.level, s: campaignScore }) : t('statusPractice', { n: lv.level });
    if (lv.level > CAMPAIGN_LEVELS) s = `${t('endless')} · ${s}`;
    if (lv.cfg.wind > 0) s += ` · ${t('wind')} ${lv.windDir > 0 ? '→' : '←'}`;
    ctx.setStatus(s);
  }

  // ── Pause ─────────────────────────────────────────────────────────────
  function pauseGame(): void {
    if (!lv || paused || (lv.phase !== 'flying' && lv.phase !== 'ready')) return;
    paused = true;
    releaseInputs();
    ctx.showModal({
      title: t('paused'),
      body: t('levelN', { n: lv.level }),
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        {
          label: t('resume'),
          primary: true,
          onClick: () => {
            paused = false;
            acc = 0;
          },
        },
      ],
    });
  }

  // ── Frame ─────────────────────────────────────────────────────────────
  function currentInput(): Input {
    let rot = (btnLeft ? -1 : 0) + (btnRight ? 1 : 0) + (keyLeft ? -1 : 0) + (keyRight ? 1 : 0);
    for (const s of canvasPointers.values()) rot += s;
    return { thrust: btnThrust || keyThrust, rot: clamp(rot, -1, 1) };
  }

  function frame(dt: number): void {
    if (!lv || !cv) return;
    clock += dt;
    if (!paused && (lv.phase === 'ready' || lv.phase === 'flying')) {
      const input = currentInput();
      if (lv.phase === 'flying') {
        if (input.thrust && !wasThrust && lv.lander.fuel > 0 && clock - lastThrustSound > 0.25) {
          ctx.play('swoosh');
          lastThrustSound = clock;
        }
        wasThrust = input.thrust;
      }
      acc += dt;
      let steps = 0;
      while (acc >= DT && steps < 6) {
        const r = stepLevel(lv, input);
        acc -= DT;
        steps++;
        if (r) {
          onOutcome(r);
          break;
        }
      }
      if (steps >= 6) acc = 0;
      if (lv.phase === 'flying' && !lowFuelWarned && lv.lander.fuel < 20) {
        lowFuelWarned = true;
        ctx.play('tick');
        ctx.haptic('medium');
        ctx.toast(t('lowFuel'), 1600);
      }
    }
    updateParticles(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 2.2);
    updateCamera(dt);
    draw();
    updateHud();
    // Nothing left to animate once the flight is over and the debris has settled.
    if ((lv.phase === 'landed' || lv.phase === 'crashed') && particles.length === 0 && shake === 0 && clock - landedAt > 2.5) {
      loop?.stop();
    }
  }

  function onOutcome(r: 'landed' | 'crashed'): void {
    if (!lv) return;
    releaseInputs();
    landedAt = clock;
    const l = lv.lander;
    if (r === 'landed') {
      ctx.play('win');
      ctx.haptic('success');
      spawnDust(l.x, l.y + FOOT_Y);
      endTimer = window.setTimeout(showLanded, 900);
    } else {
      ctx.play('explosion');
      ctx.haptic('heavy');
      spawnExplosion(l.x, l.y);
      shake = 1;
      crashes++;
      endTimer = window.setTimeout(showCrashed, 1300);
    }
  }

  // ── Results ───────────────────────────────────────────────────────────
  function row(label: string, value: string, cls = ''): HTMLElement {
    return el('div', { class: 'll-row ' + cls }, el('span', { text: label }), el('span', { class: 'll-val', text: value }));
  }

  function showLanded(): void {
    if (!lv || lv.outcome?.kind !== 'landed') return;
    const level = lv.level;
    const { pad, score } = lv.outcome;
    const fuel = Math.round(lv.lander.fuel);
    const levelBest = ctx.storage.recordBest('level-' + level, score.total, 'higher');
    if (level + 1 > unlocked) {
      unlocked = level + 1;
      ctx.storage.set('unlocked', unlocked);
    }
    let campaignBest = false;
    if (mode === 'campaign') {
      campaignScore += score.total;
      campaignBest = ctx.storage.recordBest('campaign', campaignScore, 'higher');
      updateStatus();
    }
    const finishedCampaign = mode === 'campaign' && level === CAMPAIGN_LEVELS;
    const body = el(
      'div',
      { class: 'll-result' },
      row(t('padBonus', { m: pad.mult }), '+' + score.padPts),
      row(t('fuelBonus', { f: fuel }), '+' + score.fuelPts),
      row(t('levelScore'), String(score.total), 'll-total'),
      mode === 'campaign' ? row(t('campaignTotal'), String(campaignScore), 'll-total') : null,
      campaignBest ? el('div', { class: 'll-row ll-newbest', text: '🏆 ' + t('newBest') }) : null,
      levelBest && !campaignBest ? el('div', { class: 'll-row ll-newbest', text: '🏆 ' + t('newLevelBest') }) : null,
      finishedCampaign ? el('p', { class: 'll-note', text: t('campaignCompleteBody') }) : null,
    );
    const nextLevel = level + 1;
    ctx.showModal({
      title: finishedCampaign ? t('campaignComplete') : t('landedTitle'),
      body,
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        {
          label: finishedCampaign ? t('continueEndless') : t('nextLevel'),
          primary: true,
          onClick: () => {
            if (mode === 'practice') {
              practiceLevel = Math.min(unlocked, nextLevel);
              ctx.storage.set('practiceLevel', practiceLevel);
            }
            startLevel(nextLevel, seedFor(nextLevel));
          },
        },
      ],
    });
  }

  function reasonText(r: CrashReason): string {
    if (!lv) return '';
    const l = lv.lander;
    switch (r) {
      case 'vspeed':
        return t('reasonVspeed', { v: Math.abs(l.vy).toFixed(1) });
      case 'hspeed':
        return t('reasonHspeed', { v: Math.abs(l.vx).toFixed(1) });
      case 'tilt':
        return t('reasonTilt', { a: Math.round(Math.abs((normalizeAngle(l.angle) * 180) / Math.PI)) });
      case 'offPad':
        return t('reasonOffPad');
      case 'terrain':
        return t('reasonTerrain');
      case 'hull':
        return t('reasonHull');
      case 'lost':
        return t('reasonLost');
    }
  }

  function showCrashed(): void {
    if (!lv || lv.outcome?.kind !== 'crashed') return;
    const level = lv.level;
    const seed = lv.seed;
    const { reasons, outOfFuel } = lv.outcome;
    const body = el(
      'div',
      {},
      el('div', { class: 'll-reasons' }, ...reasons.map((r) => el('div', { class: 'll-reason', text: '• ' + reasonText(r) })), outOfFuel ? el('div', { class: 'll-reason', text: '⛽ ' + t('outOfFuel') }) : null),
      el('p', { class: 'muted small', text: t('limits') }),
      mode === 'campaign' ? el('p', { class: 'll-note', text: t('scoreSoFar', { n: campaignScore }) }) : null,
    );
    ctx.showModal({
      title: t('crashedTitle'),
      body,
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        { label: t('retry'), primary: true, onClick: () => startLevel(level, seed) },
      ],
    });
  }

  // ── Particles ─────────────────────────────────────────────────────────
  function spawnExplosion(x: number, y: number): void {
    if (!lv) return;
    particles.push({ kind: 'flash', x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: 9, color: '#fff1a8', angle: 0, spin: 0 });
    for (let i = 0; i < 42; i++) {
      const a = Math.random() * TAU;
      const sp = 3 + Math.random() * 16;
      particles.push({
        kind: 'debris',
        x: x + (Math.random() - 0.5) * 2,
        y: y + (Math.random() - 0.5) * 2,
        vx: Math.cos(a) * sp,
        vy: Math.abs(Math.sin(a)) * sp + 2,
        life: 1.2 + Math.random() * 1.3,
        max: 2.5,
        size: 0.3 + Math.random() * 0.8,
        color: DEBRIS_COLORS[i % DEBRIS_COLORS.length],
        angle: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 12,
      });
    }
    for (let i = 0; i < 14; i++) {
      particles.push({
        kind: 'smoke',
        x: x + (Math.random() - 0.5) * 3,
        y: y + (Math.random() - 0.5) * 3,
        vx: (Math.random() - 0.5) * 4,
        vy: 1 + Math.random() * 4,
        life: 1.4 + Math.random() * 0.8,
        max: 2.2,
        size: 1.5 + Math.random() * 2,
        color: '#6b7384',
        angle: 0,
        spin: 0,
      });
    }
  }

  function spawnDust(x: number, y: number): void {
    for (let i = 0; i < 16; i++) {
      const dir = i % 2 === 0 ? -1 : 1;
      particles.push({
        kind: 'dust',
        x: x + dir * (1 + Math.random() * 2),
        y: y + 0.2,
        vx: dir * (2 + Math.random() * 5),
        vy: 0.5 + Math.random() * 1.5,
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        size: 0.4 + Math.random() * 0.6,
        color: '#aeb6c6',
        angle: 0,
        spin: 0,
      });
    }
  }

  function updateParticles(dt: number): void {
    if (!lv || particles.length === 0) return;
    const g = lv.cfg.gravity;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      if (p.kind === 'flash') continue;
      const grav = p.kind === 'smoke' ? -0.6 : p.kind === 'dust' ? g * 0.5 : g;
      p.vy -= grav * dt;
      p.vx *= 1 - 0.4 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      if (p.kind !== 'smoke') {
        const ground = groundAt(p.x);
        if (p.y < ground) {
          p.y = ground;
          p.vy = Math.abs(p.vy) * 0.3;
          p.vx *= 0.6;
          p.spin *= 0.5;
        }
      }
    }
  }

  function groundAt(x: number): number {
    if (!lv) return 0;
    const pts = lv.terrain.points;
    if (x <= pts[0].x) return pts[0].y;
    if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].x <= x) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }

  // ── Camera ────────────────────────────────────────────────────────────
  function updateCamera(dt: number): void {
    if (!lv || !cv) return;
    const l = lv.lander;
    const far = cv.width / WORLD_W;
    const near = Math.max(7, far * 1.6);
    const alt = altitudeAbove(l, lv.terrain);
    const tz = zoomFor(alt, near, far);
    const kz = camSnap ? 1 : 1 - Math.exp(-dt * 2.5);
    zoom += (tz - zoom) * kz;
    const viewW = cv.width / zoom;
    const viewH = cv.height / zoom;
    let cx = l.x;
    let cy = l.y - viewH * 0.12;
    cx = viewW >= WORLD_W ? WORLD_W / 2 : clamp(cx, viewW / 2, WORLD_W - viewW / 2);
    cy = Math.max(cy, -6 + viewH / 2);
    const k = camSnap ? 1 : 1 - Math.exp(-dt * 5);
    camX += (cx - camX) * k;
    camY += (cy - camY) * k;
    camSnap = false;
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function draw(): void {
    if (!lv || !cv) return;
    const g = cv.ctx;
    const W = cv.width;
    const H = cv.height;
    const l = lv.lander;
    const sx = (x: number): number => (x - camX) * zoom + W / 2;
    const sy = (y: number): number => H / 2 - (y - camY) * zoom;

    // Sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, pal.skyTop);
    sky.addColorStop(1, pal.skyBottom);
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Stars (screen space, gentle parallax + twinkle)
    g.fillStyle = pal.star;
    const px = camX * 1.4;
    const py = camY * 1.4;
    for (const s of stars) {
      const x = (((s.x * W - px) % W) + W) % W;
      const y = (((s.y * H + py) % H) + H) % H;
      g.globalAlpha = s.a * (0.65 + 0.35 * Math.sin(clock * s.tw + s.ph));
      g.fillRect(x, y, s.r, s.r);
    }
    g.globalAlpha = 1;

    g.save();
    if (shake > 0) {
      const amp = 10 * shake * shake;
      g.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }

    // Terrain
    const pts = lv.terrain.points;
    g.beginPath();
    g.moveTo(sx(pts[0].x), sy(pts[0].y));
    for (let i = 1; i < pts.length; i++) g.lineTo(sx(pts[i].x), sy(pts[i].y));
    g.lineTo(sx(WORLD_W), H + 40);
    g.lineTo(sx(0), H + 40);
    g.closePath();
    const gy0 = sy(70);
    const gy1 = sy(-5);
    const groundGrad = g.createLinearGradient(0, gy0, 0, gy1);
    groundGrad.addColorStop(0, pal.ground);
    groundGrad.addColorStop(1, pal.groundDeep);
    g.fillStyle = groundGrad;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = pal.groundEdge;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(sx(pts[0].x), sy(pts[0].y));
    for (let i = 1; i < pts.length; i++) g.lineTo(sx(pts[i].x), sy(pts[i].y));
    g.stroke();

    // Pads
    const padW = clamp(zoom * 0.9, 4, 9);
    const fontPx = clamp(zoom * 2.4, 11, 20);
    for (const p of lv.terrain.pads) {
      const x0 = sx(p.x0);
      const x1 = sx(p.x1);
      const y = sy(p.y);
      if (x1 < -40 || x0 > W + 40) continue;
      g.lineCap = 'round';
      g.strokeStyle = pal.pad;
      g.globalAlpha = 0.3;
      g.lineWidth = padW + 8;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.globalAlpha = 1;
      g.lineWidth = padW;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      // stripes
      g.strokeStyle = pal.skyTop;
      g.globalAlpha = 0.35;
      g.lineWidth = Math.max(1, padW * 0.35);
      g.lineCap = 'butt';
      const n = Math.max(2, Math.round((x1 - x0) / 14));
      for (let i = 1; i < n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        g.beginPath();
        g.moveTo(x, y - padW / 2);
        g.lineTo(x, y + padW / 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.font = `700 ${fontPx}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillStyle = pal.pad;
      g.fillText('×' + p.mult, (x0 + x1) / 2, y - padW / 2 - 3);
    }

    // Off-screen pad indicators
    for (const p of lv.terrain.pads) {
      if (sx(p.x1) >= 0 && sx(p.x0) <= W) continue;
      drawPadIndicator(g, p, sx(p.x1) < 0, clamp(sy(p.y), 40, H - 40), W);
    }

    // Lander
    if (lv.phase !== 'crashed') {
      const input = currentInput();
      drawLander(g, sx(l.x), sy(l.y), l.angle, Math.max(zoom, 3.4), l.thrusting && lv.phase === 'flying', lv.phase === 'flying' ? input.rot : 0);
    }

    // Particles
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      const x = sx(p.x);
      const y = sy(p.y);
      if (p.kind === 'flash') {
        const r = (1 - a) * p.size * zoom + 4;
        g.globalAlpha = a;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      } else if (p.kind === 'smoke') {
        g.globalAlpha = a * 0.35;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(x, y, (p.size + (1 - a) * 2) * zoom, 0, TAU);
        g.fill();
      } else {
        g.globalAlpha = Math.min(1, a * 1.5);
        g.fillStyle = p.color;
        g.save();
        g.translate(x, y);
        g.rotate(p.angle);
        const s = Math.max(2, p.size * zoom);
        g.fillRect(-s / 2, -s / 2, s, s * 0.6);
        g.restore();
      }
    }
    g.globalAlpha = 1;

    // Landed badge
    if (lv.phase === 'landed' && lv.outcome?.kind === 'landed') {
      const a = clamp((clock - landedAt) * 3, 0, 1);
      g.globalAlpha = a;
      g.font = `800 ${Math.round(clamp(zoom * 2.6, 16, 24))}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillStyle = pal.success;
      g.fillText('✓ ' + t('landedBanner', { m: lv.outcome.pad.mult }), sx(l.x), sy(l.y) - Math.max(zoom, 3.4) * 4 - 6 - (1 - a) * 10);
      g.globalAlpha = 1;
    }
    g.restore();

    // Live wind gauge (levels with crosswind)
    if (lv.cfg.wind > 0) {
      const w = currentWind(lv);
      const len = clamp((Math.abs(w) / 0.6) * 44, 8, 44);
      const dir = w > 0 ? 1 : -1;
      const gx = W - 14;
      const gy = 16;
      g.strokeStyle = pal.warning;
      g.fillStyle = pal.warning;
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      const x0 = dir > 0 ? gx - 56 : gx;
      g.beginPath();
      g.moveTo(x0, gy);
      g.lineTo(x0 + dir * len, gy);
      g.stroke();
      g.beginPath();
      g.moveTo(x0 + dir * (len + 6), gy);
      g.lineTo(x0 + dir * len, gy - 5);
      g.lineTo(x0 + dir * len, gy + 5);
      g.closePath();
      g.fill();
      g.font = `700 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
      g.textAlign = 'right';
      g.textBaseline = 'top';
      g.fillStyle = pal.muted;
      g.fillText(`${t('wind')} ${Math.abs(w).toFixed(2)}`, gx, gy + 9);
    }

    // Ready banner
    if (lv.phase === 'ready' || (lv.phase === 'flying' && lv.time < READY_TIME + 0.6)) {
      const fade = lv.phase === 'ready' ? 1 : 1 - (lv.time - READY_TIME) / 0.6;
      g.globalAlpha = clamp(fade, 0, 1);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = pal.text;
      g.font = `800 30px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
      const title = lv.level > CAMPAIGN_LEVELS ? `${t('endless')} · ${t('levelN', { n: lv.level })}` : t('levelN', { n: lv.level });
      g.fillText(title, W / 2, H * 0.16);
      g.font = `600 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
      g.fillStyle = pal.muted;
      const windTxt = lv.cfg.wind > 0 ? t('windLabel', { dir: lv.windDir > 0 ? '→' : '←', w: lv.cfg.wind.toFixed(1) }) : t('noWind');
      g.fillText(`${t('gravityLabel', { g: lv.cfg.gravity.toFixed(1) })} · ${windTxt}`, W / 2, H * 0.16 + 28);
      g.globalAlpha = 1;
    }

    // First-run controls hint (drawn on the canvas so it never covers the buttons)
    if (showHint && lv.level === 1 && lv.time < 9 && lv.phase !== 'crashed' && lv.phase !== 'landed') {
      const fade = clamp((9 - lv.time) / 0.8, 0, 1);
      const lines = t('controlsHint').split('\n');
      g.globalAlpha = fade;
      g.font = `600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const lh = 18;
      const boxH = lines.length * lh + 14;
      const boxW = Math.min(W - 24, Math.max(...lines.map((ln) => g.measureText(ln).width)) + 28);
      const by = H - boxH - 10;
      g.fillStyle = pal.skyTop;
      g.globalAlpha = fade * 0.75;
      roundedRect(g, (W - boxW) / 2, by, boxW, boxH, 12);
      g.fill();
      g.globalAlpha = fade;
      g.fillStyle = pal.text;
      lines.forEach((ln, i) => g.fillText(ln, W / 2, by + 7 + lh * i + lh / 2));
      g.globalAlpha = 1;
    }
  }

  function roundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawPadIndicator(g: CanvasRenderingContext2D, p: Pad, leftSide: boolean, y: number, W: number): void {
    const x = leftSide ? 16 : W - 16;
    const dir = leftSide ? -1 : 1;
    g.fillStyle = pal.pad;
    g.beginPath();
    g.moveTo(x + dir * 8, y);
    g.lineTo(x - dir * 4, y - 7);
    g.lineTo(x - dir * 4, y + 7);
    g.closePath();
    g.fill();
    g.font = `700 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
    g.textAlign = leftSide ? 'left' : 'right';
    g.textBaseline = 'middle';
    g.fillText('×' + p.mult, x - dir * 10, y);
  }

  function drawLander(g: CanvasRenderingContext2D, x: number, y: number, angle: number, z: number, flame: boolean, rot: number): void {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.scale(z, -z);
    const lw = (px: number): number => Math.max(px / z, 0.08);

    // Flame + glow
    if (flame) {
      const flick = 0.75 + 0.25 * Math.sin(clock * 41) + Math.random() * 0.25;
      const len = 2.4 * flick + 0.6;
      const glow = g.createRadialGradient(0, -3, 0.2, 0, -3, 3.2);
      glow.addColorStop(0, 'rgba(255, 176, 32, 0.45)');
      glow.addColorStop(1, 'rgba(255, 106, 31, 0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(0, -3, 3.2, 0, TAU);
      g.fill();
      g.fillStyle = FLAME_COLORS[0];
      g.beginPath();
      g.moveTo(-0.85, -2.3);
      g.lineTo(0.85, -2.3);
      g.lineTo(0.15 * Math.sin(clock * 23), -2.3 - len);
      g.closePath();
      g.fill();
      g.fillStyle = FLAME_COLORS[1];
      g.beginPath();
      g.moveTo(-0.55, -2.3);
      g.lineTo(0.55, -2.3);
      g.lineTo(0, -2.3 - len * 0.65);
      g.closePath();
      g.fill();
      g.fillStyle = FLAME_COLORS[2];
      g.beginPath();
      g.moveTo(-0.28, -2.3);
      g.lineTo(0.28, -2.3);
      g.lineTo(0, -2.3 - len * 0.35);
      g.closePath();
      g.fill();
    }
    // RCS puffs while rotating
    if (rot !== 0) {
      const side = rot > 0 ? -1 : 1;
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath();
      g.moveTo(side * 1.5, 1.5);
      g.lineTo(side * (2.3 + Math.random() * 0.4), 1.9);
      g.lineTo(side * (2.3 + Math.random() * 0.4), 1.1);
      g.closePath();
      g.fill();
    }

    // Legs
    g.strokeStyle = pal.leg;
    g.lineCap = 'round';
    g.lineWidth = lw(2.2);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(s * 2.0, -0.6);
      g.lineTo(s * 3.0, -2.6);
      g.moveTo(s * 2.0, -1.4);
      g.lineTo(s * 2.75, -2.1);
      g.stroke();
      g.lineWidth = lw(2.6);
      g.beginPath();
      g.moveTo(s * 2.45, -2.6);
      g.lineTo(s * 3.55, -2.6);
      g.stroke();
      g.lineWidth = lw(2.2);
    }

    // Descent stage (gold foil)
    g.fillStyle = pal.gold;
    g.fillRect(-2.0, -1.5, 4.0, 1.2);
    g.fillStyle = pal.goldDark;
    g.fillRect(-2.0, -1.5, 4.0, 0.35);
    g.strokeStyle = pal.goldDark;
    g.lineWidth = lw(1);
    g.strokeRect(-2.0, -1.5, 4.0, 1.2);

    // Nozzle
    g.fillStyle = pal.nozzle;
    g.beginPath();
    g.moveTo(-0.6, -1.5);
    g.lineTo(0.6, -1.5);
    g.lineTo(1.0, -2.3);
    g.lineTo(-1.0, -2.3);
    g.closePath();
    g.fill();

    // Ascent stage
    g.fillStyle = pal.hull;
    g.beginPath();
    g.moveTo(-1.4, -0.3);
    g.lineTo(1.4, -0.3);
    g.lineTo(1.5, 1.4);
    g.lineTo(0.8, 2.2);
    g.lineTo(-0.8, 2.2);
    g.lineTo(-1.5, 1.4);
    g.closePath();
    g.fill();
    g.strokeStyle = pal.hullDark;
    g.lineWidth = lw(1);
    g.stroke();
    // Window
    g.fillStyle = pal.accent;
    g.beginPath();
    g.arc(0.55, 0.95, 0.38, 0, TAU);
    g.fill();
    // Hatch line
    g.strokeStyle = pal.hullDark;
    g.beginPath();
    g.moveTo(-1.1, 0.3);
    g.lineTo(-0.2, 0.3);
    g.stroke();
    // Antenna
    g.strokeStyle = pal.leg;
    g.lineWidth = lw(1.2);
    g.beginPath();
    g.moveTo(-0.9, 2.2);
    g.lineTo(-0.9, 3.0);
    g.moveTo(-1.3, 3.0);
    g.lineTo(-0.5, 3.0);
    g.stroke();
    g.restore();
  }

  // ── HUD ───────────────────────────────────────────────────────────────
  function updateHud(): void {
    if (!lv || !hudAlt || !hudV || !hudH || !hudTilt || !fuelFill || !fuelPct) return;
    const l = lv.lander;
    const alt = Math.round(altitudeAbove(l, lv.terrain));
    const vy = l.vy;
    const vx = l.vx;
    const tiltDeg = Math.round((normalizeAngle(l.angle) * 180) / Math.PI);
    const fuel = Math.round(l.fuel);
    const key = `${alt}|${vy.toFixed(1)}|${vx.toFixed(1)}|${tiltDeg}|${fuel}`;
    if (key === hudCache) return;
    hudCache = key;
    hudAlt.textContent = alt + ' m';
    hudV.textContent = (vy >= 0 ? '↑ ' : '↓ ') + Math.abs(vy).toFixed(1);
    hudV.classList.toggle('ll-danger', -vy > MAX_VY);
    hudH.textContent = (vx >= 0 ? '→ ' : '← ') + Math.abs(vx).toFixed(1);
    hudH.classList.toggle('ll-danger', Math.abs(vx) > MAX_VX);
    hudTilt.textContent = tiltDeg + '°';
    hudTilt.classList.toggle('ll-danger', Math.abs(normalizeAngle(l.angle)) > MAX_TILT);
    fuelFill.style.width = fuel + '%';
    fuelFill.classList.toggle('ll-warn', fuel < 35 && fuel >= 15);
    fuelFill.classList.toggle('ll-danger', fuel < 15);
    fuelPct.textContent = fuel + '%';
  }

  showStart();
  return {
    destroy() {
      teardown();
    },
  };
}

const game: GameModule = { strings, create };
export default game;
