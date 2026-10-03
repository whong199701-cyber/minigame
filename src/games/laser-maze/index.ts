import type { GameContext, GameInstance, GameModule, ThemeName } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import { createCanvas, createLoop, onPointer, roundRect, type CanvasHandle } from '../../app/canvas';
import {
  DIFFICULTIES,
  EMITTER,
  EMPTY,
  TARGET,
  WALL,
  allTargetsLit,
  buildGrid,
  cellIndex,
  generateLevel,
  hintFor,
  isMirror,
  isSplitter,
  nextOrient,
  orientOf,
  traceBeam,
  type Dir,
  type Difficulty,
  type Level,
  type Orient,
  type Placement,
  type TraceResult,
} from './logic';
import './style.css';

const strings = {
  zh: {
    rules:
      '激光从发射器射出，沿直线前进，碰到墙或网格边缘就停止。\n点击空格放一面「/」镜子，再点一次变成「\\」，第三次移除。\n镜子让激光转向 90°；半透明的分光镜会让激光同时直行和转向。\n激光会穿过目标环并点亮它——点亮全部目标即过关。\n镜子数量有限（见底部），每一面都要放在对的位置。\n💡 替你放好一面正确的镜子（不计最佳用时）；↻ 清空已放的镜子。\n关卡无限：越往后网格越大，目标、墙和镜子越多。',
    title: '激光镜面迷宫',
    desc: '摆放镜子，让激光命中所有目标',
    trackEasy: '从 6×6、1 个目标、2 面镜子起步，逐关升级',
    trackMedium: '从 7×7、3 个目标、4 面镜子起步，很快出现分光镜',
    trackHard: '9×9 · 4 个目标 · 5–6 面镜子 · 固定镜与分光镜',
    levelN: '第 {n} 关',
    bestLevel: '最高通关 第 {n} 关',
    noBest: '尚无记录',
    levelBest: '本关最佳 {t}',
    mirrors: '镜子',
    targets: '目标',
    noMirrors: '镜子用完了，先移走一面',
    cantPlace: '这里不能放镜子',
    mirrorsCleared: '已清空镜子',
    hintUsed: '已替你放好一面镜子',
    hintNone: '所有镜子都已就位',
    winBody: '用时 {t} · 镜子 {m}/{k}',
    winHints: '使用提示 {n} 次（不计最佳用时）',
    status: '第 {n} 关 · {t}',
    statusWon: '第 {n} 关 · 完成 {t}',
  },
  en: {
    rules:
      'The laser leaves the emitter in a straight line and stops at walls and the grid edge.\nTap an empty cell to place a "/" mirror, tap again for "\\", a third tap removes it.\nMirrors turn the beam 90°; a translucent splitter lets it go straight AND turn.\nThe beam passes through target rings and lights them — light every target to clear the level.\nYour mirror supply is limited (bottom bar); every one must be in the right spot.\n💡 places one correct mirror for you (no best time); ↻ clears your mirrors.\nLevels are endless: bigger grids, more targets, walls and mirrors as you go.',
    title: 'Laser Maze',
    desc: 'Place mirrors to hit every target',
    trackEasy: 'Starts at 6×6, 1 target, 2 mirrors and grows every level',
    trackMedium: 'Starts at 7×7, 3 targets, 4 mirrors; splitters soon',
    trackHard: '9×9 · 4 targets · 5–6 mirrors · fixed mirrors & splitters',
    levelN: 'Level {n}',
    bestLevel: 'Best: level {n} cleared',
    noBest: 'No record yet',
    levelBest: 'Level best {t}',
    mirrors: 'Mirrors',
    targets: 'Targets',
    noMirrors: 'No mirrors left — remove one first',
    cantPlace: "Can't place a mirror here",
    mirrorsCleared: 'Mirrors cleared',
    hintUsed: 'Placed one correct mirror for you',
    hintNone: 'All mirrors are already in place',
    winBody: 'Time {t} · mirrors {m}/{k}',
    winHints: '{n} hints used (no best time)',
    status: 'Level {n} · {t}',
    statusWon: 'Level {n} · done {t}',
  },
};

type Phase = 'start' | 'playing' | 'won';

interface Colors {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  success: string;
  danger: string;
  warning: string;
}

const TAP_SLOP = 12;
const FLASH_DUR = 0.45;
const PULSE_DUR = 0.7;
const SHAKE_DUR = 0.35;
const WIN_DUR = 1.6;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, a: number): string {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  let mode: Difficulty = ctx.storage.get<Difficulty>('mode', 'easy');
  if (!DIFFICULTIES.includes(mode)) mode = 'easy';
  let theme: ThemeName = ctx.theme;
  let colors = readColors();

  // ── Round state ───────────────────────────────────────────────────────
  let phase: Phase = 'start';
  let level = 1;
  let lv: Level | null = null;
  let fixedGrid: Uint8Array = new Uint8Array(0);
  let placed = new Map<number, Orient>();
  let trace: TraceResult | null = null;
  let elapsed = 0;
  let lastStatusSec = -1;
  let hints = 0;

  // ── Animation state ───────────────────────────────────────────────────
  let time = 0;
  let revealD = 0;
  let revealTarget = 0;
  let revealSpeed = 30;
  const flash = new Map<number, number>();
  const pulse = new Map<number, number>();
  let litPrev = new Set<number>();
  let shake: { cell: number; t: number } | null = null;
  let winT = -1;

  // ── Layout / DOM ──────────────────────────────────────────────────────
  let cell = 40;
  let ox = 0;
  let oy = 0;
  let cv: CanvasHandle | null = null;
  let loop: ReturnType<typeof createLoop> | null = null;
  let offPointer: (() => void) | null = null;
  let hudMirrors: HTMLElement | null = null;
  let hudTargets: HTMLElement | null = null;
  let press: { cell: number; x: number; y: number } | null = null;
  let winTimer = 0;
  let modalTimer = 0;
  let hudShakeTimer = 0;
  let removeNext: (() => void) | null = null;

  function readColors(): Colors {
    return {
      bg: ctx.cssVar('--bg') || '#0f1218',
      surface: ctx.cssVar('--surface') || '#1a1f2b',
      surface2: ctx.cssVar('--surface-2') || '#232a39',
      border: ctx.cssVar('--border') || '#2d3548',
      text: ctx.cssVar('--text') || '#e8ecf3',
      muted: ctx.cssVar('--muted') || '#8b94a7',
      accent: ctx.cssVar('--accent') || '#5b8cff',
      accent2: ctx.cssVar('--accent-2') || '#ff7a59',
      success: ctx.cssVar('--success') || '#3ddc97',
      danger: ctx.cssVar('--danger') || '#ff5470',
      warning: ctx.cssVar('--warning') || '#ffc857',
    };
  }

  // ── Storage helpers ───────────────────────────────────────────────────
  const unlocked = (): number => Math.max(1, ctx.storage.get<number>(`unlocked:${mode}`, 1));
  const savedLevel = (): number => clamp(ctx.storage.get<number>(`level:${mode}`, unlocked()), 1, unlocked());
  const times = (): Record<string, number> => ctx.storage.get<Record<string, number>>(`times:${mode}`, {});

  // ── Header actions / lifecycle ────────────────────────────────────────
  const removeHint = ctx.addHeaderAction({ icon: '💡', label: t('hint'), onClick: giveHint });
  const removeRestart = ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: onRestart });
  ctx.onDestroy(() => {
    removeHint();
    removeRestart();
    teardownGame();
  });
  ctx.onVisibility((visible) => {
    if (!loop) return;
    if (visible) loop.start();
    else loop.stop();
  });
  ctx.onThemeChange((th) => {
    theme = th;
    colors = readColors();
  });

  function teardownGame(): void {
    clearTimeout(winTimer);
    clearTimeout(modalTimer);
    clearTimeout(hudShakeTimer);
    loop?.stop();
    loop = null;
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    removeNext?.();
    removeNext = null;
    press = null;
    hudMirrors = null;
    hudTargets = null;
  }

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    teardownGame();
    phase = 'start';
    lv = null;
    trace = null;
    root.innerHTML = '';
    ctx.setStatus('');
    level = savedLevel();

    const trackLine = el('p', { class: 'muted small lm-track' });
    const levelLabel = el('div', { class: 'lm-level-label' });
    const bestLine = el('p', { class: 'muted small' });
    const prev = button('◀', () => stepLevel(-1), { variant: 'secondary', class: 'lm-step' });
    const next = button('▶', () => stepLevel(1), { variant: 'secondary', class: 'lm-step' });
    prev.setAttribute('aria-label', 'previous level');
    next.setAttribute('aria-label', 'next level');

    const refresh = () => {
      trackLine.textContent = t(mode === 'easy' ? 'trackEasy' : mode === 'medium' ? 'trackMedium' : 'trackHard');
      levelLabel.textContent = t('levelN', { n: level });
      prev.disabled = level <= 1;
      next.disabled = level >= unlocked();
      const best = ctx.storage.getBest(mode);
      const lt = times()[String(level)];
      const parts: string[] = [best === null ? t('noBest') : t('bestLevel', { n: best })];
      if (lt !== undefined) parts.push(t('levelBest', { t: formatTime(lt) }));
      bestLine.textContent = parts.join(' · ');
    };
    const stepLevel = (d: number) => {
      const n = clamp(level + d, 1, unlocked());
      if (n === level) return;
      level = n;
      ctx.storage.set(`level:${mode}`, level);
      refresh();
    };
    refresh();

    root.append(
      el(
        'div',
        { class: 'start-screen lm-start' },
        el('div', { class: 'big-icon', text: '🔦' }),
        el('h2', { text: t('title') }),
        el('p', { class: 'muted', text: t('desc') }),
        segmented<Difficulty>(
          [
            { value: 'easy', label: t('easy') },
            { value: 'medium', label: t('medium') },
            { value: 'hard', label: t('hard') },
          ],
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            level = savedLevel();
            refresh();
          },
        ),
        trackLine,
        el('div', { class: 'lm-level-pick' }, prev, levelLabel, next),
        bestLine,
        button(t('play'), () => startLevel(), { variant: 'primary', size: 'lg', class: 'lm-play' }),
      ),
    );
  }

  // ── Game screen ───────────────────────────────────────────────────────
  function startLevel(): void {
    teardownGame();
    lv = generateLevel(mode, level);
    fixedGrid = buildGrid(lv);
    placed = new Map();
    trace = null;
    hints = 0;
    elapsed = 0;
    lastStatusSec = -1;
    phase = 'playing';
    winT = -1;
    flash.clear();
    pulse.clear();
    litPrev = new Set();
    shake = null;
    ctx.storage.set(`level:${mode}`, level);

    root.innerHTML = '';
    const area = el('div', { class: 'game-area lm-area' });
    const levelChip = el(
      'button',
      { class: 'lm-chip', type: 'button', 'aria-label': t('level') },
      el('span', { class: 'lm-chip-icon', text: '☰' }),
      el('span', { text: t('levelN', { n: level }) }),
    );
    levelChip.addEventListener('click', () => {
      ctx.play('tap');
      ctx.haptic('light');
      showStart();
    });
    hudMirrors = el('div', { class: 'lm-mirrors' });
    hudTargets = el('div', { class: 'stat-value lm-targets' });
    const hud = el(
      'div',
      { class: 'game-hud lm-hud' },
      levelChip,
      el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: t('mirrors') }), hudMirrors),
      el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: t('targets') }), hudTargets),
    );
    root.append(area, hud);

    cv = createCanvas(area, (w, h) => relayout(w, h));
    offPointer = onPointer(cv.canvas, {
      down(p) {
        if (phase !== 'playing') return;
        const c = cellAt(p.x, p.y);
        press = c >= 0 ? { cell: c, x: p.x, y: p.y } : null;
      },
      move(p) {
        if (!press) return;
        const dx = p.x - press.x;
        const dy = p.y - press.y;
        if (dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) press = null;
      },
      up(p) {
        if (!press) return;
        const c = cellAt(p.x, p.y);
        const start = press.cell;
        press = null;
        if (c >= 0 && c === start) tapCell(c);
      },
      cancel() {
        press = null;
      },
    });
    loop = createLoop(update);
    loop.start();
    retrace();
    updateHud();
    updateStatus(true);
  }

  function relayout(w: number, h: number): void {
    const n = lv?.size ?? 6;
    const pad = 6;
    cell = Math.max(8, Math.min(64, Math.floor((w - 2 * pad) / n), Math.floor((h - 2 * pad) / n)));
    ox = Math.floor((w - cell * n) / 2);
    oy = Math.floor((h - cell * n) / 2);
  }

  function cellAt(px: number, py: number): number {
    if (!lv) return -1;
    const x = Math.floor((px - ox) / cell);
    const y = Math.floor((py - oy) / cell);
    if (x < 0 || y < 0 || x >= lv.size || y >= lv.size) return -1;
    return cellIndex(lv.size, x, y);
  }

  function placedList(): Placement[] {
    if (!lv) return [];
    const n = lv.size;
    return [...placed.entries()].map(([k, orient]) => ({ x: k % n, y: Math.floor(k / n), orient }));
  }

  // ── Actions ───────────────────────────────────────────────────────────
  function tapCell(c: number): void {
    if (phase !== 'playing' || !lv) return;
    if (fixedGrid[c] !== EMPTY) {
      ctx.play('error');
      ctx.haptic('error');
      shake = { cell: c, t: SHAKE_DUR };
      ctx.toast(t('cantPlace'));
      return;
    }
    const cur = placed.get(c);
    const next = nextOrient(cur);
    if (cur === undefined && placed.size >= lv.mirrors) {
      ctx.play('error');
      ctx.haptic('error');
      shake = { cell: c, t: SHAKE_DUR };
      ctx.toast(t('noMirrors'));
      shakeHud();
      return;
    }
    if (next === null) {
      placed.delete(c);
      ctx.play('pop');
    } else {
      placed.set(c, next);
      ctx.play(cur === undefined ? 'place' : 'move');
    }
    ctx.haptic('light');
    flash.set(c, FLASH_DUR);
    retrace(c);
    updateHud();
  }

  function shakeHud(): void {
    if (!hudMirrors) return;
    hudMirrors.classList.remove('lm-shake');
    void hudMirrors.offsetWidth;
    hudMirrors.classList.add('lm-shake');
    clearTimeout(hudShakeTimer);
    hudShakeTimer = window.setTimeout(() => hudMirrors?.classList.remove('lm-shake'), 450);
  }

  function retrace(changed?: number): void {
    if (!lv) return;
    const g = buildGrid(lv, placedList());
    trace = traceBeam(g, lv.size, lv.emitter);
    let from = 0;
    if (changed !== undefined) {
      from = trace.length;
      for (const v of trace.visits) {
        if (cellIndex(lv.size, v.x, v.y) === changed && v.dist < from) from = v.dist;
      }
    }
    revealD = from;
    revealTarget = trace.length;
    revealSpeed = Math.max(28, (revealTarget - from) / 0.5);
    for (const c of trace.lit) if (!litPrev.has(c)) pulse.set(c, PULSE_DUR);
    litPrev = new Set(trace.lit);
    if (phase === 'playing' && allTargetsLit(trace, lv)) finishLevel();
  }

  function giveHint(): void {
    if (phase !== 'playing' || !lv) return;
    const h = hintFor(lv, placed);
    if (!h) {
      ctx.toast(t('hintNone'));
      return;
    }
    if (h.remove !== undefined) placed.delete(h.remove);
    const k = cellIndex(lv.size, h.place.x, h.place.y);
    placed.set(k, h.place.orient);
    hints++;
    flash.set(k, FLASH_DUR * 2);
    ctx.play('place');
    ctx.haptic('medium');
    ctx.toast(t('hintUsed'));
    retrace(k);
    updateHud();
  }

  function onRestart(): void {
    if (phase === 'playing') {
      if (placed.size === 0) return;
      placed.clear();
      ctx.play('pop');
      ctx.haptic('medium');
      ctx.toast(t('mirrorsCleared'));
      retrace();
      updateHud();
    } else if (phase === 'won') {
      startLevel();
    }
  }

  function nextLevel(): void {
    level = Math.min(level + 1, unlocked());
    startLevel();
  }

  function finishLevel(): void {
    phase = 'won';
    press = null;
    ctx.play('success');
    const remaining = Math.max(0, (revealTarget - revealD) / revealSpeed);
    winTimer = window.setTimeout(() => {
      if (!lv) return;
      ctx.play('win');
      ctx.haptic('success');
      winT = 0;
      if (level + 1 > unlocked()) ctx.storage.set(`unlocked:${mode}`, level + 1);
      const bestLevel = ctx.storage.recordBest(mode, level, 'higher');
      let improvedTime = false;
      if (hints === 0) {
        const tm = times();
        const prev = tm[String(level)];
        if (prev === undefined || elapsed < prev) {
          tm[String(level)] = Math.round(elapsed * 10) / 10;
          ctx.storage.set(`times:${mode}`, tm);
          improvedTime = prev !== undefined;
        }
      }
      ctx.setStatus(t('statusWon', { n: level, t: formatTime(elapsed) }));
      updateHud();
      removeNext?.();
      removeNext = ctx.addHeaderAction({ icon: '▶', label: t('nextLevel'), onClick: nextLevel });
      modalTimer = window.setTimeout(() => showResult(bestLevel || improvedTime), 950);
    }, Math.min(900, remaining * 1000 + 250));
  }

  function showResult(newBest: boolean): void {
    if (!lv) return;
    const body = el(
      'div',
      {},
      el('p', { text: t('winBody', { t: formatTime(elapsed), m: placed.size, k: lv.mirrors }) }),
      hints > 0 ? el('p', { class: 'muted', text: t('winHints', { n: hints }) }) : null,
      newBest ? el('p', { text: '🏆 ' + t('newBest') }) : null,
    );
    ctx.showModal({
      title: t('levelComplete'),
      body,
      dismissible: true,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        { label: t('nextLevel'), primary: true, onClick: () => nextLevel() },
      ],
    });
  }

  // ── HUD / status ──────────────────────────────────────────────────────
  function updateHud(): void {
    if (!lv) return;
    if (hudMirrors) {
      hudMirrors.innerHTML = '';
      const left = lv.mirrors - placed.size;
      for (let i = 0; i < lv.mirrors; i++) hudMirrors.append(el('span', { class: 'lm-mi' + (i < left ? '' : ' used') }));
    }
    if (hudTargets) {
      const lit = trace ? trace.lit.size : 0;
      hudTargets.textContent = `${lit}/${lv.targets.length}`;
      hudTargets.classList.toggle('lm-done', lit >= lv.targets.length);
    }
  }

  function updateStatus(force = false): void {
    if (phase !== 'playing') return;
    const sec = Math.floor(elapsed);
    if (!force && sec === lastStatusSec) return;
    lastStatusSec = sec;
    ctx.setStatus(t('status', { n: level, t: formatTime(elapsed) }));
  }

  // ── Loop ──────────────────────────────────────────────────────────────
  function update(dt: number): void {
    time += dt;
    if (phase === 'playing') {
      elapsed += dt;
      updateStatus();
    }
    if (revealD < revealTarget) revealD = Math.min(revealTarget, revealD + revealSpeed * dt);
    for (const [k, v] of flash) {
      if (v - dt <= 0) flash.delete(k);
      else flash.set(k, v - dt);
    }
    for (const [k, v] of pulse) {
      if (v - dt <= 0) pulse.delete(k);
      else pulse.set(k, v - dt);
    }
    if (shake) {
      shake.t -= dt;
      if (shake.t <= 0) shake = null;
    }
    if (winT >= 0) winT += dt;
    draw();
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function draw(): void {
    if (!cv || !lv) return;
    const g = cv.ctx;
    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);
    const n = lv.size;
    const dark = theme === 'dark';

    // Board panel (inset clamped so the 1px border never leaves the canvas)
    const m = Math.max(0.5, Math.min(7, ox - 0.5, oy - 0.5));
    roundRect(g, ox - m, oy - m, n * cell + 2 * m, n * cell + 2 * m, 16);
    g.fillStyle = colors.surface;
    g.fill();
    g.strokeStyle = colors.border;
    g.lineWidth = 1;
    g.stroke();

    // Cells + walls + flashes
    const r = cell * 0.18;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = cellIndex(n, x, y);
        let px = ox + x * cell;
        const py = oy + y * cell;
        if (shake && shake.cell === i) px += Math.sin(shake.t * 70) * 3 * (shake.t / SHAKE_DUR);
        const code = fixedGrid[i];
        roundRect(g, px + 1.5, py + 1.5, cell - 3, cell - 3, r);
        if (code === WALL) {
          g.fillStyle = dark ? colors.bg : colors.muted;
          g.fill();
          g.strokeStyle = dark ? rgba(colors.muted, 0.45) : rgba(colors.text, 0.25);
          g.lineWidth = 1.5;
          g.stroke();
          // brick texture
          g.save();
          roundRect(g, px + 2.5, py + 2.5, cell - 5, cell - 5, r);
          g.clip();
          g.strokeStyle = dark ? rgba(colors.border, 1) : rgba('#ffffff', 0.28);
          g.lineWidth = 1.5;
          g.beginPath();
          const h3 = (cell - 3) / 3;
          for (let k = 1; k < 3; k++) {
            g.moveTo(px, py + 1.5 + h3 * k);
            g.lineTo(px + cell, py + 1.5 + h3 * k);
          }
          g.moveTo(px + cell / 2, py);
          g.lineTo(px + cell / 2, py + 1.5 + h3);
          g.moveTo(px + cell / 4, py + 1.5 + h3);
          g.lineTo(px + cell / 4, py + 1.5 + h3 * 2);
          g.moveTo(px + (cell * 3) / 4, py + 1.5 + h3);
          g.lineTo(px + (cell * 3) / 4, py + 1.5 + h3 * 2);
          g.moveTo(px + cell / 2, py + 1.5 + h3 * 2);
          g.lineTo(px + cell / 2, py + cell);
          g.stroke();
          g.restore();
        } else {
          g.fillStyle = dark ? colors.surface2 : colors.surface2;
          g.fill();
          if (code === EMPTY && !placed.has(i) && phase === 'playing') {
            // subtle dot marks a placeable cell
            g.fillStyle = rgba(colors.muted, dark ? 0.22 : 0.3);
            g.beginPath();
            g.arc(px + cell / 2, py + cell / 2, Math.max(1, cell * 0.035), 0, Math.PI * 2);
            g.fill();
          }
        }
        const f = flash.get(i);
        if (f !== undefined) {
          roundRect(g, px + 1.5, py + 1.5, cell - 3, cell - 3, r);
          g.fillStyle = rgba(colors.accent, 0.35 * (f / FLASH_DUR));
          g.fill();
        }
      }
    }

    drawBeam(g);

    // Elements on top of the beam
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = cellIndex(n, x, y);
        const code = fixedGrid[i];
        const px = ox + x * cell;
        const py = oy + y * cell;
        if (code === EMITTER) drawEmitter(g, px, py, lv.emitter.dir);
        else if (code === TARGET) drawTarget(g, px, py, trace?.lit.has(i) ?? false, pulse.get(i));
        else if (isMirror(code)) drawMirror(g, px, py, orientOf(code) as Orient, true, trace?.hits.has(i) ?? false);
        else if (isSplitter(code)) drawSplitter(g, px, py, orientOf(code) as Orient, trace?.hits.has(i) ?? false);
        else {
          const o = placed.get(i);
          if (o) drawMirror(g, px, py, o, false, trace?.hits.has(i) ?? false);
        }
      }
    }

    // Win celebration rings
    if (winT >= 0 && winT < WIN_DUR) {
      for (const tg of lv.targets) {
        const cx = ox + tg.x * cell + cell / 2;
        const cy = oy + tg.y * cell + cell / 2;
        for (let k = 0; k < 2; k++) {
          const p = clamp((winT - k * 0.25) / 1.1, 0, 1);
          if (p <= 0 || p >= 1) continue;
          g.beginPath();
          g.arc(cx, cy, cell * (0.3 + p * 1.3), 0, Math.PI * 2);
          g.strokeStyle = rgba(colors.success, (1 - p) * 0.8);
          g.lineWidth = Math.max(1, cell * 0.06 * (1 - p));
          g.stroke();
        }
      }
    }
  }

  function segPoint(ax: number, ay: number): [number, number] {
    return [ox + ax * cell, oy + ay * cell];
  }

  function beamPath(g: CanvasRenderingContext2D, rd: number): { hx: number; hy: number } | null {
    if (!trace) return null;
    let head: { hx: number; hy: number } | null = null;
    g.beginPath();
    for (const s of trace.segments) {
      if (s.d0 >= rd) continue;
      const [ax, ay] = segPoint(s.ax, s.ay);
      let [bx, by] = segPoint(s.bx, s.by);
      if (s.d1 > rd) {
        const k = (rd - s.d0) / (s.d1 - s.d0);
        bx = ax + (bx - ax) * k;
        by = ay + (by - ay) * k;
        head = { hx: bx, hy: by };
      }
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
    }
    return head;
  }

  function drawBeam(g: CanvasRenderingContext2D): void {
    if (!trace || !lv) return;
    const rd = revealD;
    const won = phase === 'won';
    const glow = 0.8 + 0.2 * Math.sin(time * 5) + (won ? 0.3 : 0);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const passes: { w: number; c: string }[] = [
      { w: cell * 0.38, c: rgba(colors.accent, 0.14 * glow) },
      { w: cell * 0.16, c: rgba(colors.accent, 0.45 * glow) },
      { w: cell * 0.07, c: rgba(colors.accent, 0.95) },
      { w: cell * 0.03, c: rgba('#ffffff', 0.9) },
    ];
    let head: { hx: number; hy: number } | null = null;
    for (const p of passes) {
      head = beamPath(g, rd);
      g.strokeStyle = p.c;
      g.lineWidth = p.w;
      g.stroke();
    }
    // Flowing sparks along the beam
    g.save();
    g.setLineDash([cell * 0.18, cell * 0.62]);
    g.lineDashOffset = -((time * cell * 2.2) % (cell * 0.8));
    beamPath(g, rd);
    g.strokeStyle = rgba('#ffffff', 0.55);
    g.lineWidth = cell * 0.055;
    g.stroke();
    g.restore();
    if (head) {
      g.beginPath();
      g.arc(head.hx, head.hy, cell * 0.13, 0, Math.PI * 2);
      g.fillStyle = rgba('#ffffff', 0.95);
      g.shadowColor = colors.accent;
      g.shadowBlur = cell * 0.4;
      g.fill();
      g.shadowBlur = 0;
    }
  }

  function drawEmitter(g: CanvasRenderingContext2D, px: number, py: number, dir: Dir): void {
    const cx = px + cell / 2;
    const cy = py + cell / 2;
    g.save();
    g.translate(cx, cy);
    g.rotate(((dir - 1) * Math.PI) / 2);
    // body
    roundRect(g, -cell * 0.3, -cell * 0.3, cell * 0.6, cell * 0.6, cell * 0.16);
    g.fillStyle = theme === 'dark' ? colors.border : colors.surface;
    g.fill();
    g.strokeStyle = colors.muted;
    g.lineWidth = 1.5;
    g.stroke();
    // barrel
    roundRect(g, 0, -cell * 0.12, cell * 0.47, cell * 0.24, cell * 0.07);
    g.fillStyle = colors.accent2;
    g.fill();
    // muzzle glow
    g.shadowColor = colors.accent;
    g.shadowBlur = cell * 0.35;
    g.beginPath();
    g.arc(cell * 0.44, 0, cell * 0.085, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.shadowBlur = 0;
    // core
    g.beginPath();
    g.arc(0, 0, cell * 0.12, 0, Math.PI * 2);
    g.fillStyle = colors.accent2;
    g.fill();
    g.beginPath();
    g.arc(0, 0, cell * 0.05, 0, Math.PI * 2);
    g.fillStyle = rgba('#ffffff', 0.8);
    g.fill();
    g.restore();
  }

  function drawTarget(g: CanvasRenderingContext2D, px: number, py: number, lit: boolean, p?: number): void {
    const cx = px + cell / 2;
    const cy = py + cell / 2;
    const r = cell * 0.27;
    const lw = cell * 0.085;
    if (lit) {
      const breathe = 1 + 0.05 * Math.sin(time * 4);
      g.shadowColor = colors.success;
      g.shadowBlur = cell * 0.4;
      g.beginPath();
      g.arc(cx, cy, r * breathe, 0, Math.PI * 2);
      g.strokeStyle = colors.success;
      g.lineWidth = lw;
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, cell * 0.11, 0, Math.PI * 2);
      g.fillStyle = colors.success;
      g.fill();
      g.shadowBlur = 0;
      g.beginPath();
      g.arc(cx, cy, cell * 0.05, 0, Math.PI * 2);
      g.fillStyle = '#ffffff';
      g.fill();
    } else {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.strokeStyle = rgba(colors.muted, 0.85);
      g.lineWidth = lw;
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, cell * 0.08, 0, Math.PI * 2);
      g.fillStyle = rgba(colors.muted, 0.4);
      g.fill();
    }
    if (p !== undefined) {
      const k = 1 - p / PULSE_DUR;
      g.beginPath();
      g.arc(cx, cy, r + k * cell * 0.45, 0, Math.PI * 2);
      g.strokeStyle = rgba(colors.success, (1 - k) * 0.9);
      g.lineWidth = Math.max(1, lw * (1 - k));
      g.stroke();
    }
  }

  function drawMirror(g: CanvasRenderingContext2D, px: number, py: number, orient: Orient, fixed: boolean, hit: boolean): void {
    const inset = cell * 0.2;
    const ax = px + inset;
    const bx = px + cell - inset;
    const ay = orient === '/' ? py + cell - inset : py + inset;
    const by = orient === '/' ? py + inset : py + cell - inset;
    g.lineCap = 'round';
    if (fixed) {
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.strokeStyle = rgba(colors.muted, 0.55);
      g.lineWidth = cell * 0.22;
      g.stroke();
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.strokeStyle = colors.text;
      g.lineWidth = cell * 0.1;
      g.stroke();
      // bolts
      g.fillStyle = colors.muted;
      for (const [x, y] of [
        [ax, ay],
        [bx, by],
      ]) {
        g.beginPath();
        g.arc(x, y, cell * 0.055, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      if (hit) {
        g.shadowColor = colors.accent;
        g.shadowBlur = cell * 0.3;
      }
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.strokeStyle = colors.accent;
      g.lineWidth = cell * 0.15;
      g.stroke();
      g.shadowBlur = 0;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.strokeStyle = rgba('#ffffff', hit ? 0.85 : 0.55);
      g.lineWidth = cell * 0.045;
      g.stroke();
    }
  }

  function drawSplitter(g: CanvasRenderingContext2D, px: number, py: number, orient: Orient, hit: boolean): void {
    const cx = px + cell / 2;
    const cy = py + cell / 2;
    const d = cell * 0.36;
    g.beginPath();
    g.moveTo(cx, cy - d);
    g.lineTo(cx + d, cy);
    g.lineTo(cx, cy + d);
    g.lineTo(cx - d, cy);
    g.closePath();
    g.fillStyle = rgba(colors.accent2, hit ? 0.3 : 0.2);
    g.fill();
    g.strokeStyle = rgba(colors.accent2, 0.9);
    g.lineWidth = Math.max(1.5, cell * 0.04);
    g.stroke();
    const inset = cell * 0.3;
    const ax = px + inset;
    const bx = px + cell - inset;
    const ay = orient === '/' ? py + cell - inset : py + inset;
    const by = orient === '/' ? py + inset : py + cell - inset;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.strokeStyle = rgba(colors.accent2, 0.95);
    g.lineWidth = cell * 0.07;
    g.lineCap = 'round';
    g.stroke();
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
