import type { GameContext, GameInstance, GameModule, ModalHandle, ThemeName } from '../../app/types';
import { el, button, segmented } from '../../app/ui';
import { createCanvas, createLoop, onPointer, clamp, roundRect, type CanvasHandle, type PointerInfo } from '../../app/canvas';
import {
  CUSHION,
  EDGE,
  FIRE_MIN,
  H,
  MODES,
  MODE_LIST,
  POCKETS,
  R,
  RAIL,
  W,
  ballsLeft,
  beginAim,
  grabRadiusPx,
  isMode,
  isStripe,
  isTap,
  moveAim,
  nearestObjectAngle,
  newGame,
  placeCueBall,
  predictShot,
  releasePower,
  shoot,
  starsFor,
  stepGame,
  type AimGesture,
  type GameState,
  type Mode,
  type PhysEvent,
} from './logic';
import './style.css';

const strings = {
  zh: {
    rules:
      '目标：用最少的杆数把所有彩球打进袋。\n瞄准：在桌面上绕着白球拖动手指即可旋转瞄准线（离白球越远越精细）；点一下桌面则直接瞄向该点。\n蓄力：手指朝远离白球的方向拉开，右侧力度条随之增长（蓄力时瞄准锁定），松手击球。\n也可以按住白球直接向后拉，瞄准方向保持不变。想取消就滑回起点再松手。\n白球落袋 = 犯规：杆数 +1，并可点击桌面任意位置摆放白球。\n6 球 / 9 球有辅助瞄准线（幽灵球 + 碰撞方向），15 球没有；球未停稳前不能击球。\n杆数越少越好，低于标准杆可获三星评价。',
    desc: '真实物理台球：拖动瞄准、拉开蓄力，用最少的杆数清台。',
    chooseMode: '选择模式',
    mode6: '6 球',
    mode9: '9 球',
    mode15: '15 球',
    modeDesc6: '三角摆放 · 有辅助瞄准线 · 入门',
    modeDesc9: '菱形摆放 · 有辅助瞄准线 · 进阶',
    modeDesc15: '满台 15 球 · 无辅助线 · 高手',
    parN: '标准杆 {n}',
    shots: '杆数',
    left: '剩余',
    bestLine: '最佳：{n} 杆',
    bestLine1: '最佳：{n} 杆',
    noBest: '尚无纪录',
    placeCue: '点击桌面放置白球',
    scratch: '白球落袋！杆数 +1，可自由摆放白球',
    combo: '一杆 {n} 球！',
    dragHint: '绕白球拖动瞄准，向外拉开松手击球',
    clearedIn: '{n} 杆清台！',
    clearedIn1: '{n} 杆清台！',
    parResult: '标准杆 {par} · {diff}',
    scratchCount: '犯规 {n} 次',
    scratchCount1: '犯规 {n} 次',
    restartConfirm: '重新摆球开始新的一局？当前进度将丢失。',
    changeMode: '模式',
    even: '持平',
  },
  en: {
    rules:
      'Goal: pocket every object ball in as few shots as possible.\nAim: drag around the cue ball to rotate the aim line (further away = finer control), or tap a spot to aim straight at it.\nPower: pull your finger away from the cue ball to fill the power bar on the right (the aim locks while charging), then release to shoot.\nOr press on the cue ball and pull straight back: the aim stays fixed. To cancel, slide back to where you started and release.\nScratch (cue ball pocketed) = +1 penalty shot and ball in hand: tap anywhere to place the cue ball.\n6- and 9-ball show an aim guide (ghost ball + directions); 15-ball has none. You cannot shoot while balls are moving.\nFewer shots is better: beat par for three stars.',
    desc: 'Real-physics pool: drag to aim, pull back for power, clear the table in the fewest shots.',
    chooseMode: 'Choose mode',
    mode6: '6 balls',
    mode9: '9 balls',
    mode15: '15 balls',
    modeDesc6: 'Triangle rack · aim guide on · starter',
    modeDesc9: 'Diamond rack · aim guide on · advanced',
    modeDesc15: 'Full 15-ball rack · no guide · expert',
    parN: 'Par {n}',
    shots: 'Shots',
    left: 'Left',
    bestLine: 'Best: {n} shots',
    bestLine1: 'Best: {n} shot',
    noBest: 'No record yet',
    placeCue: 'Tap the table to place the cue ball',
    scratch: 'Scratch! +1 shot, ball in hand',
    combo: '{n} balls in one shot!',
    dragHint: 'Drag around to aim, pull away to shoot',
    clearedIn: 'Cleared in {n} shots!',
    clearedIn1: 'Cleared in {n} shot!',
    parResult: 'Par {par} · {diff}',
    scratchCount: '{n} scratches',
    scratchCount1: '{n} scratch',
    restartConfirm: 'Re-rack and start a new game? Current progress will be lost.',
    changeMode: 'Modes',
    even: 'even',
  },
};

const TAU = Math.PI * 2;
const SINK_TIME = 0.38;
const STRIKE_TIME = 0.1;
/** CSS px reserved to the right of the table for the power gauge (so it never covers the rail or a pocket). */
const BAR_GUTTER = 16;
const BAR_W = 7;
const BAR_GAP = 5;

const BALL_COLORS = ['#f4c80c', '#1e55c9', '#d8302a', '#6d2fb5', '#f07c1a', '#15873d', '#8c1f2d', '#141414'];
const IVORY = '#f4efe2';

interface Palette {
  felt: string;
  feltEdge: string;
  cushion: string;
  cushionHi: string;
  rail: string;
  railHi: string;
  railLo: string;
  pocket: string;
  leather: string;
  diamond: string;
}

const PALETTES: Record<ThemeName, Palette> = {
  dark: {
    felt: '#1f6f43',
    feltEdge: '#154d2f',
    cushion: '#1a5a36',
    cushionHi: '#2c7f50',
    rail: '#4a2d19',
    railHi: '#6b4427',
    railLo: '#2b180c',
    pocket: '#04070a',
    leather: '#1d120a',
    diamond: '#dccaa0',
  },
  light: {
    felt: '#2f9c5c',
    feltEdge: '#247d48',
    cushion: '#288c52',
    cushionHi: '#3fb06c',
    rail: '#915b33',
    railHi: '#b67c4c',
    railLo: '#5c381c',
    pocket: '#0b1015',
    leather: '#3a2414',
    diamond: '#f5e9cc',
  },
};

function ballColor(id: number): string {
  return BALL_COLORS[(id - 1) % 8];
}

interface Sink {
  id: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  t: number;
}

/** One active pointer at a time (`pid`); other fingers are ignored until it lifts. */
type Drag = { kind: 'place'; pid: number } | { kind: 'aim'; pid: number; t0: number; g: AimGesture };

interface UiColors {
  accent: string;
  success: string;
  warning: string;
  danger: string;
  muted: string;
  border: string;
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const savedMode = ctx.storage.get<string>('mode', '9');
  let mode: Mode = isMode(savedMode) ? savedMode : '9';
  let theme: ThemeName = ctx.theme;

  // ── Live game state ───────────────────────────────────────────────────
  let game: GameState | null = null;
  let cv: CanvasHandle | null = null;
  let loop: ReturnType<typeof createLoop> | null = null;
  let offPointer: (() => void) | null = null;
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let aimAngle = -Math.PI / 2;
  let power = 0;
  let drag: Drag | null = null;
  let strikeT = 0;
  let strikePower = 0;
  let pulse = 0;
  let dirty = true;
  const sinks: Sink[] = [];
  let lastHitSound = 0;
  let lastCushionSound = 0;
  let hudShots: HTMLElement | null = null;
  let hudLeft: HTMLElement | null = null;
  let hudBest: HTMLElement | null = null;

  let removeRestart: (() => void) | null = null;
  /** Bumped on every new rack / teardown so a stale confirmation can never act on a later game. */
  let gameSerial = 0;
  let confirmModal: ModalHandle | null = null;
  let endModal: ModalHandle | null = null;
  let colors = readColors();

  function readColors(): UiColors {
    const v = (name: string, fallback: string) => ctx.cssVar(name) || fallback;
    return {
      accent: v('--accent', '#5b8cff'),
      success: v('--success', '#3ddc97'),
      warning: v('--warning', '#ffc857'),
      danger: v('--danger', '#ff5470'),
      muted: v('--muted', '#8a93a6'),
      border: v('--border', 'rgba(127,127,127,0.35)'),
    };
  }

  function closeModals(): void {
    confirmModal?.close();
    confirmModal = null;
    endModal?.close();
    endModal = null;
  }

  /** Header ↻: re-rack in the same mode (the end modal's "Modes" button is the way back to the selector). */
  function onRestart(): void {
    if (!game) return;
    if (game.phase === 'done' || game.shots === 0) {
      startGame();
      return;
    }
    const serial = gameSerial;
    confirmModal?.close();
    confirmModal = ctx.showModal({
      title: t('restart'),
      body: t('restartConfirm'),
      buttons: [
        { label: t('cancel'), onClick: () => (confirmModal = null) },
        {
          label: t('confirm'),
          primary: true,
          onClick: () => {
            confirmModal = null;
            if (serial === gameSerial && game) startGame();
          },
        },
      ],
    });
  }

  ctx.onDestroy(() => teardownGame());
  ctx.onVisibility((visible) => {
    if (!loop) return;
    if (visible) loop.start();
    else loop.stop();
  });
  ctx.onThemeChange((th) => {
    theme = th;
    colors = readColors();
    dirty = true;
  });

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    teardownGame();
    root.innerHTML = '';
    ctx.setStatus('');
    const desc = el('p', { class: 'muted pc-mode-desc' });
    const parLine = el('p', { class: 'pc-par' });
    const bestLine = el('p', { class: 'muted small' });
    const refresh = () => {
      desc.textContent = t('modeDesc' + mode);
      parLine.textContent = `${t('parN', { n: MODES[mode].par })}`;
      const b = ctx.storage.getBest(mode);
      bestLine.textContent = b === null ? t('noBest') : t(b === 1 ? 'bestLine1' : 'bestLine', { n: b });
    };
    refresh();
    root.append(
      el(
        'div',
        { class: 'start-screen pc-start' },
        el('div', { class: 'big-icon', text: '🎱' }),
        el('p', { class: 'muted pc-desc', text: t('desc') }),
        el('h2', { text: t('chooseMode') }),
        segmented<Mode>(
          MODE_LIST.map((m) => ({ value: m, label: t('mode' + m) })),
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            refresh();
          },
        ),
        desc,
        parLine,
        bestLine,
        button(t('play'), () => startGame(), { variant: 'primary', size: 'lg' }),
      ),
    );
  }

  // ── Game setup / teardown ─────────────────────────────────────────────
  function teardownGame(): void {
    gameSerial++;
    closeModals();
    removeRestart?.();
    removeRestart = null;
    loop?.stop();
    loop = null;
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    game = null;
    drag = null;
    sinks.length = 0;
    power = 0;
    strikeT = 0;
    hudShots = hudLeft = hudBest = null;
  }

  function startGame(): void {
    teardownGame();
    root.innerHTML = '';
    game = newGame(mode);
    aimAngle = nearestObjectAngle(game.balls);
    colors = readColors();
    removeRestart = ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: onRestart });

    hudShots = el('div', { class: 'stat-value', text: '0' });
    hudLeft = el('div', { class: 'stat-value', text: String(ballsLeft(game.balls)) });
    hudBest = el('div', { class: 'stat-value', text: '–' });
    const hud = el(
      'div',
      { class: 'game-hud pc-hud' },
      el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: t('shots') }), hudShots),
      el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: t('left') }), hudLeft),
      el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: t('best') }), hudBest),
    );
    const area = el('div', { class: 'game-area pc-area' });
    root.append(hud, area);
    updateHud();
    updateStatus();

    cv = createCanvas(area, (w, h) => layout(w, h));
    offPointer = onPointer(cv.canvas, { down: onDown, move: onMove, up: onUp, cancel: onCancel });
    loop = createLoop((dt) => frame(dt));
    loop.start();
    dirty = true;

    if (!ctx.storage.get('hinted', false)) {
      ctx.storage.set('hinted', true);
      ctx.toast(t('dragHint'), 3200);
    }
  }

  function layout(w: number, h: number): void {
    const tw = W + EDGE * 2;
    const th = H + EDGE * 2;
    scale = Math.min((w - 8 - BAR_GUTTER) / tw, (h - 8) / th);
    ox = (w - BAR_GUTTER - tw * scale) / 2 + EDGE * scale;
    oy = (h - th * scale) / 2 + EDGE * scale;
    dirty = true;
  }

  function updateHud(): void {
    if (!game) return;
    if (hudShots) hudShots.textContent = String(game.shots);
    if (hudLeft) hudLeft.textContent = String(ballsLeft(game.balls));
    if (hudBest) {
      const b = ctx.storage.getBest(mode);
      hudBest.textContent = b === null ? '–' : String(b);
    }
  }

  function updateStatus(): void {
    if (!game) return;
    if (game.phase === 'inhand') ctx.setStatus(t('placeCue'));
    else ctx.setStatus(`${t('mode' + mode)} · ${t('parN', { n: MODES[mode].par })}`);
  }

  // ── Input ─────────────────────────────────────────────────────────────
  function toTable(px: number, py: number): { x: number; y: number } {
    return { x: (px - ox) / scale, y: (py - oy) / scale };
  }

  function cuePx(): { x: number; y: number } {
    const c = game!.balls[0];
    return { x: ox + c.x * scale, y: oy + c.y * scale };
  }

  function onDown(p: PointerInfo): void {
    if (!game) return;
    // One finger at a time: a second finger never hijacks the gesture in progress. A gesture whose pointer has
    // gone (no longer captured, e.g. an up that never arrived) is stale and is simply replaced.
    if (drag && drag.pid !== p.id && cv?.canvas.hasPointerCapture?.(drag.pid)) return;
    drag = null;
    if (game.phase === 'inhand') {
      drag = { kind: 'place', pid: p.id };
      followPlacement(p.x, p.y);
      return;
    }
    if (game.phase !== 'aim') return;
    const c = cuePx();
    drag = { kind: 'aim', pid: p.id, t0: performance.now(), g: beginAim(c.x, c.y, p.x, p.y, aimAngle, grabRadiusPx(scale)) };
    power = 0;
    dirty = true;
  }

  function onMove(p: PointerInfo): void {
    if (!game || !drag || p.id !== drag.pid) return;
    if (drag.kind === 'place') {
      followPlacement(p.x, p.y);
      return;
    }
    if (game.phase !== 'aim') return;
    const c = cuePx();
    moveAim(drag.g, c.x, c.y, p.x, p.y);
    aimAngle = drag.g.aim;
    power = drag.g.power;
    dirty = true;
  }

  function onUp(p: PointerInfo): void {
    if (!game || !drag || p.id !== drag.pid) return;
    const d = drag;
    drag = null;
    dirty = true;
    if (d.kind === 'place') {
      const tp = toTable(p.x, p.y);
      if (placeCueBall(game, tp.x, tp.y)) {
        ctx.play('place');
        ctx.haptic('light');
        aimAngle = nearestObjectAngle(game.balls, aimAngle);
        updateStatus();
      }
      return;
    }
    power = 0;
    if (game.phase !== 'aim') return;
    const c = cuePx();
    moveAim(d.g, c.x, c.y, p.x, p.y);
    aimAngle = d.g.aim;
    if (isTap(d.g, performance.now() - d.t0)) {
      // Tap: aim straight at the tapped point.
      const tp = toTable(p.x, p.y);
      const cue = game.balls[0];
      if (Math.hypot(tp.x - cue.x, tp.y - cue.y) > R * 1.5) {
        aimAngle = Math.atan2(tp.y - cue.y, tp.x - cue.x);
        ctx.play('tap');
        ctx.haptic('light');
      }
      return;
    }
    const shot = releasePower(d.g);
    if (shot !== null) fire(shot, d.g.power);
  }

  function onCancel(p: PointerInfo): void {
    if (!drag || p.id !== drag.pid) return;
    drag = null;
    power = 0;
    dirty = true;
  }

  function followPlacement(px: number, py: number): void {
    if (!game) return;
    const tp = toTable(px, py);
    // Preview: move the cue ball with the finger (the final legal spot is resolved on release).
    const cue = game.balls[0];
    cue.x = clamp(tp.x, R, W - R);
    cue.y = clamp(tp.y, R, H - R);
    dirty = true;
  }

  /** `shot`: mapped shot power (0 = softest legal shot); `charge`: the raw gauge level, for the cue animation. */
  function fire(shot: number, charge: number): void {
    if (!game) return;
    if (!shoot(game, aimAngle, shot)) return;
    strikeT = STRIKE_TIME;
    strikePower = charge;
    ctx.play('shoot');
    ctx.haptic('medium');
    updateHud();
  }

  // ── Simulation + events ───────────────────────────────────────────────
  function frame(dt: number): void {
    if (!game || !cv) return;
    pulse += dt;
    let animating = false;
    if (game.phase === 'moving') {
      handleEvents(stepGame(game, dt));
      animating = true;
    }
    if (strikeT > 0) {
      strikeT -= dt;
      animating = true;
    }
    for (let i = sinks.length - 1; i >= 0; i--) {
      sinks[i].t += dt;
      if (sinks[i].t >= SINK_TIME) sinks.splice(i, 1);
    }
    if (sinks.length) animating = true;
    if (game.phase === 'inhand' || drag) animating = true;
    if (animating || dirty) {
      dirty = false;
      draw();
    }
  }

  function handleEvents(events: PhysEvent[]): void {
    if (!game) return;
    const now = performance.now();
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          if (e.speed > 6 && now - lastHitSound > 55) {
            lastHitSound = now;
            ctx.play(e.speed > 70 ? 'place' : 'tap');
          }
          break;
        case 'cushion':
          if (e.speed > 14 && now - lastCushionSound > 90) {
            lastCushionSound = now;
            ctx.play('tap');
          }
          break;
        case 'pocket': {
          const p = POCKETS[e.pocket];
          sinks.push({ id: e.id, x: e.x, y: e.y, tx: p.x, ty: p.y, t: 0 });
          if (e.id !== 0) {
            ctx.play('coin');
            ctx.haptic('success');
            updateHud(); // keep "Left" in step with the tray of pocketed balls
          }
          break;
        }
        case 'settle':
          onSettle(e);
          break;
      }
    }
  }

  function onSettle(e: Extract<PhysEvent, { type: 'settle' }>): void {
    if (!game) return;
    updateHud();
    dirty = true;
    const objects = e.pocketed.filter((id) => id !== 0).length;
    if (e.scratch) {
      ctx.play('error');
      ctx.haptic('error');
      ctx.toast(t('scratch'), 2200);
    } else if (objects >= 2) {
      ctx.toast(t('combo', { n: objects }), 1600);
    }
    if (e.done) {
      finish();
      return;
    }
    if (game.phase === 'aim') aimAngle = nearestObjectAngle(game.balls, aimAngle);
    updateStatus();
  }

  function finish(): void {
    if (!game) return;
    // A restart confirmation left open while the last ball rolled in no longer applies.
    confirmModal?.close();
    confirmModal = null;
    const shots = game.shots;
    const scratches = game.scratches;
    const isBest = ctx.storage.recordBest(mode, shots, 'lower');
    updateHud();
    ctx.setStatus(t(shots === 1 ? 'clearedIn1' : 'clearedIn', { n: shots }));
    ctx.play('win');
    ctx.haptic('success');
    const par = MODES[mode].par;
    const diff = shots - par;
    const stars = starsFor(mode, shots);
    const best = ctx.storage.getBest(mode);
    const body = el(
      'div',
      { class: 'pc-result' },
      el('p', { class: 'pc-stars', text: '★'.repeat(stars) + '☆'.repeat(3 - stars) }),
      el('p', { class: 'pc-result-main', text: t(shots === 1 ? 'clearedIn1' : 'clearedIn', { n: shots }) }),
      el('p', { class: 'muted', text: t('parResult', { par, diff: diff > 0 ? `+${diff}` : diff < 0 ? String(diff) : t('even') }) }),
      scratches > 0 ? el('p', { class: 'muted', text: t(scratches === 1 ? 'scratchCount1' : 'scratchCount', { n: scratches }) }) : null,
      isBest ? el('p', { class: 'pc-newbest', text: '🏆 ' + t('newBest') }) : el('p', { class: 'muted', text: best === null ? '' : t(best === 1 ? 'bestLine1' : 'bestLine', { n: best }) }),
    );
    endModal?.close();
    endModal = ctx.showModal({
      title: t('congratulations'),
      body,
      dismissible: false,
      buttons: [
        {
          label: t('home'),
          onClick: () => {
            endModal = null;
            ctx.exit();
          },
        },
        {
          label: t('changeMode'),
          onClick: () => {
            endModal = null;
            showStart();
          },
        },
        {
          label: t('newGame'),
          primary: true,
          onClick: () => {
            endModal = null;
            startGame();
          },
        },
      ],
    });
  }

  // ── Rendering ─────────────────────────────────────────────────────────
  function draw(): void {
    if (!game || !cv) return;
    const g = cv.ctx;
    const w = cv.width;
    const h = cv.height;
    g.clearRect(0, 0, w, h);
    g.save();
    g.translate(ox, oy);
    g.scale(scale, scale);
    drawTable(g);
    drawTray(g);
    if (game.phase === 'aim') drawGuide(g);
    drawBalls(g);
    if (game.phase === 'aim' && drag?.kind === 'aim' && drag.g.grab) drawGrabRing(g);
    for (const s of sinks) {
      const p = Math.min(1, s.t / SINK_TIME);
      const k = p * p;
      drawBall(g, s.x + (s.tx - s.x) * k, s.y + (s.ty - s.y) * k, s.id, R * (1 - 0.75 * p), 1 - p * 0.9);
    }
    if (game.phase === 'aim') drawCue(g, R + 1.2 + power * 16);
    else if (game.phase === 'moving' && strikeT > 0) drawCue(g, R + 1.2 + (strikeT / STRIKE_TIME) * strikePower * 16);
    if (game.phase === 'inhand') drawPlacementHint(g);
    g.restore();
    if (game.phase === 'aim') drawPowerBar(g);
  }

  function drawTable(g: CanvasRenderingContext2D): void {
    const pal = PALETTES[theme];
    // Wooden rail.
    const rg = g.createLinearGradient(-EDGE, -EDGE, W + EDGE, H + EDGE);
    rg.addColorStop(0, pal.railHi);
    rg.addColorStop(0.5, pal.rail);
    rg.addColorStop(1, pal.railLo);
    roundRect(g, -EDGE, -EDGE, W + EDGE * 2, H + EDGE * 2, 5);
    g.fillStyle = rg;
    g.fill();
    g.lineWidth = 0.6;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.stroke();
    // Rail sights (diamonds).
    g.fillStyle = pal.diamond;
    const dm = 0.9;
    const diamond = (x: number, y: number) => {
      g.beginPath();
      g.moveTo(x, y - dm);
      g.lineTo(x + dm * 0.65, y);
      g.lineTo(x, y + dm);
      g.lineTo(x - dm * 0.65, y);
      g.closePath();
      g.fill();
    };
    const mid = CUSHION + RAIL * 0.5;
    for (let i = 1; i <= 7; i++) {
      if (i === 4) continue;
      diamond(-mid, (H * i) / 8);
      diamond(W + mid, (H * i) / 8);
    }
    for (let i = 1; i <= 3; i++) {
      diamond((W * i) / 4, -mid);
      diamond((W * i) / 4, H + mid);
    }
    // Cushion frame.
    g.fillStyle = pal.cushion;
    g.fillRect(-CUSHION, -CUSHION, W + CUSHION * 2, H + CUSHION * 2);
    // Felt with a soft vignette.
    g.fillStyle = pal.felt;
    g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.62);
    vg.addColorStop(0, 'rgba(255,255,255,0.05)');
    vg.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    // Cushion nose highlight (inner edge).
    g.strokeStyle = pal.cushionHi;
    g.lineWidth = 0.7;
    g.strokeRect(0.35, 0.35, W - 0.7, H - 0.7);
    // Head string + foot spot.
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = 0.4;
    g.beginPath();
    g.moveTo(0, H * 0.75);
    g.lineTo(W, H * 0.75);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.arc(W / 2, H * 0.25, 0.7, 0, TAU);
    g.fill();
    // Pockets.
    for (const p of POCKETS) {
      g.fillStyle = pal.leather;
      g.beginPath();
      g.arc(p.x, p.y, p.r + 1.3, 0, TAU);
      g.fill();
      const pg = g.createRadialGradient(p.x, p.y, p.r * 0.2, p.x, p.y, p.r);
      pg.addColorStop(0, pal.pocket);
      pg.addColorStop(0.75, pal.pocket);
      pg.addColorStop(1, '#1a1f26');
      g.fillStyle = pg;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, TAU);
      g.fill();
    }
  }

  /** Pocketed balls lined up on the bottom rail. */
  function drawTray(g: CanvasRenderingContext2D): void {
    if (!game) return;
    const order = game.pocketedOrder;
    if (!order.length) return;
    const r = 2.1;
    const gap = r * 2 + 0.5;
    const y = H + CUSHION + RAIL * 0.5;
    const x0 = W / 2 - ((order.length - 1) * gap) / 2;
    order.forEach((id, i) => drawBall(g, x0 + i * gap, y, id, r, 1, true));
  }

  function drawBalls(g: CanvasRenderingContext2D): void {
    if (!game) return;
    const inhand = game.phase === 'inhand';
    for (let i = game.balls.length - 1; i >= 0; i--) {
      const b = game.balls[i];
      if (b.pocketed) continue;
      if (i === 0 && inhand) {
        drawBall(g, b.x, b.y, 0, R, 0.8);
        const ring = R + 1.6 + Math.sin(pulse * 5) * 0.6;
        g.strokeStyle = colors.accent;
        g.lineWidth = 0.6;
        g.beginPath();
        g.arc(b.x, b.y, ring, 0, TAU);
        g.stroke();
        continue;
      }
      drawBall(g, b.x, b.y, b.id, R, 1);
    }
  }

  function drawBall(g: CanvasRenderingContext2D, x: number, y: number, id: number, r: number, alpha: number, flat = false): void {
    g.save();
    g.globalAlpha = alpha;
    if (!flat) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(x + r * 0.16, y + r * 0.3, r * 1.02, r * 0.96, 0, 0, TAU);
      g.fill();
    }
    const stripe = id > 0 && isStripe(id);
    g.fillStyle = id === 0 || stripe ? IVORY : ballColor(id);
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    if (stripe) {
      g.save();
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.clip();
      g.fillStyle = ballColor(id);
      g.fillRect(x - r, y - r * 0.56, r * 2, r * 1.12);
      g.restore();
    }
    if (id > 0 && !flat) {
      g.fillStyle = '#faf7ef';
      g.beginPath();
      g.arc(x, y, r * 0.52, 0, TAU);
      g.fill();
      g.fillStyle = '#15171c';
      g.font = `bold ${(r * (id >= 10 ? 0.66 : 0.74)).toFixed(2)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(id), x, y + r * 0.05);
    }
    const sg = g.createRadialGradient(x - r * 0.42, y - r * 0.45, r * 0.05, x, y, r * 1.05);
    sg.addColorStop(0, 'rgba(255,255,255,0.6)');
    sg.addColorStop(0.3, 'rgba(255,255,255,0.1)');
    sg.addColorStop(0.75, 'rgba(0,0,0,0.1)');
    sg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = sg;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.restore();
  }

  function drawGuide(g: CanvasRenderingContext2D): void {
    if (!game) return;
    const cue = game.balls[0];
    const dx = Math.cos(aimAngle);
    const dy = Math.sin(aimAngle);
    g.save();
    g.lineCap = 'round';
    if (MODES[mode].guide) {
      const guide = predictShot(game.balls, aimAngle);
      g.strokeStyle = 'rgba(255,255,255,0.78)';
      g.lineWidth = 0.55;
      g.setLineDash([1.4, 2.2]);
      g.beginPath();
      g.moveTo(cue.x + dx * (R + 0.3), cue.y + dy * (R + 0.3));
      g.lineTo(guide.hit.x, guide.hit.y);
      g.stroke();
      g.setLineDash([]);
      // Ghost ball.
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 0.45;
      g.beginPath();
      g.arc(guide.hit.x, guide.hit.y, R, 0, TAU);
      g.stroke();
      if (guide.target >= 0 && guide.objectDir) {
        const tb = game.balls[guide.target];
        const len = 5 + 16 * guide.cut;
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(tb.x + guide.objectDir.x * (R + 0.4), tb.y + guide.objectDir.y * (R + 0.4));
        g.lineTo(tb.x + guide.objectDir.x * (R + len), tb.y + guide.objectDir.y * (R + len));
        g.stroke();
        if (guide.cueDir) {
          const cl = 3 + 10 * Math.sqrt(Math.max(0, 1 - guide.cut * guide.cut));
          g.strokeStyle = 'rgba(255,255,255,0.5)';
          g.lineWidth = 0.5;
          g.beginPath();
          g.moveTo(guide.hit.x + guide.cueDir.x * (R + 0.4), guide.hit.y + guide.cueDir.y * (R + 0.4));
          g.lineTo(guide.hit.x + guide.cueDir.x * (R + cl), guide.hit.y + guide.cueDir.y * (R + cl));
          g.stroke();
        }
      }
    } else {
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 0.55;
      g.beginPath();
      g.moveTo(cue.x + dx * (R + 0.4), cue.y + dy * (R + 0.4));
      g.lineTo(cue.x + dx * (R + 9), cue.y + dy * (R + 9));
      g.stroke();
    }
    g.restore();
  }

  function drawCue(g: CanvasRenderingContext2D, back: number): void {
    if (!game) return;
    const cue = game.balls[0];
    const len = 62;
    const tipX = cue.x - Math.cos(aimAngle) * back;
    const tipY = cue.y - Math.sin(aimAngle) * back;
    g.save();
    g.translate(tipX, tipY);
    g.rotate(aimAngle + Math.PI);
    // Shadow.
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.moveTo(0.4, 0.2);
    g.lineTo(len + 0.4, -0.9);
    g.lineTo(len + 0.4, 2.1);
    g.lineTo(0.4, 1.4);
    g.closePath();
    g.fill();
    // Shaft: ferrule → light wood → dark butt.
    const sg = g.createLinearGradient(0, 0, len, 0);
    sg.addColorStop(0, '#efeadb');
    sg.addColorStop(0.045, '#efeadb');
    sg.addColorStop(0.05, '#e0bf86');
    sg.addColorStop(0.58, '#c89b64');
    sg.addColorStop(0.62, '#4f3018');
    sg.addColorStop(0.9, '#3a2211');
    sg.addColorStop(1, '#1f130a');
    g.fillStyle = sg;
    g.beginPath();
    g.moveTo(0, -0.75);
    g.lineTo(len, -1.45);
    g.lineTo(len, 1.45);
    g.lineTo(0, 0.75);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.moveTo(0, -0.75);
    g.lineTo(len, -1.45);
    g.lineTo(len, -0.5);
    g.lineTo(0, -0.25);
    g.closePath();
    g.fill();
    // Chalked tip.
    g.fillStyle = '#3d74c4';
    g.fillRect(-0.9, -0.72, 0.9, 1.44);
    g.restore();
  }

  function drawPlacementHint(g: CanvasRenderingContext2D): void {
    g.save();
    g.font = `bold 4.3px -apple-system, "Segoe UI", Roboto, "PingFang SC", "Noto Sans SC", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const msg = t('placeCue');
    // Mid-table, well clear of the shell toast that shows at the bottom of the screen after a scratch.
    const y = H * 0.6;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    const tw = g.measureText(msg).width + 8;
    roundRect(g, W / 2 - tw / 2, y - 4, tw, 8, 4);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fillText(msg, W / 2, y + 0.2);
    g.restore();
  }

  /** Faint ring around the cue ball while it is grabbed (slingshot pull: the aim is fixed). */
  function drawGrabRing(g: CanvasRenderingContext2D): void {
    if (!game) return;
    const cue = game.balls[0];
    g.save();
    g.globalAlpha = 0.75;
    g.strokeStyle = colors.accent;
    g.lineWidth = 0.6;
    g.beginPath();
    g.arc(cue.x, cue.y, R + 1.4, 0, TAU);
    g.stroke();
    g.restore();
  }

  /** Vertical power gauge in the gutter right of the table (never over the rail sights or the side pocket). */
  function drawPowerBar(g: CanvasRenderingContext2D): void {
    const x = ox + (W + EDGE) * scale + BAR_GAP;
    const top = oy + 14 * scale;
    const bottom = oy + (H - 14) * scale;
    const bh = bottom - top;
    g.save();
    roundRect(g, x, top, BAR_W, bh, BAR_W / 2);
    g.fillStyle = colors.border;
    g.fill();
    if (power > 0) {
      const fh = Math.max(BAR_W, bh * power);
      if (power < FIRE_MIN) {
        g.fillStyle = colors.muted; // not enough pull to shoot yet
      } else {
        const fg = g.createLinearGradient(0, bottom, 0, top);
        fg.addColorStop(0, colors.success);
        fg.addColorStop(0.55, colors.warning);
        fg.addColorStop(1, colors.danger);
        g.fillStyle = fg;
      }
      roundRect(g, x + 1, bottom - fh, BAR_W - 2, fh, (BAR_W - 2) / 2);
      g.fill();
    }
    // Firing threshold tick.
    g.fillStyle = colors.muted;
    g.fillRect(x - 2, bottom - bh * FIRE_MIN - 0.5, BAR_W + 4, 1);
    g.restore();
  }

  showStart();

  // Dev-only hook for automated play scripts (stripped from production builds).
  const win = window as unknown as { __poolDebug?: unknown };
  if (import.meta.env.DEV) {
    win.__poolDebug = {
      game: () => game,
      view: () => ({ scale, ox, oy, aim: aimAngle, power, grab: drag?.kind === 'aim' ? drag.g.grab : null }),
      refresh: () => {
        dirty = true;
        updateHud();
        updateStatus();
      },
    };
  }

  return {
    destroy() {
      teardownGame();
      if (win.__poolDebug) delete win.__poolDebug;
    },
  };
}

const game: GameModule = { strings, create };
export default game;
