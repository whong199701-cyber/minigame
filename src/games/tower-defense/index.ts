import type { GameContext, GameInstance, GameModule, ThemeName } from '../../app/types';
import { el, button, segmented } from '../../app/ui';
import { createCanvas, createLoop, onPointer, clamp, roundRect, type CanvasHandle } from '../../app/canvas';
import {
  DIFFICULTY,
  MAPS,
  MAX_LEVEL,
  TOWER_DEFS,
  TOWER_TYPES,
  WAVES_PER_MAP,
  build,
  buildCost,
  buildPath,
  canBuild,
  canStartWave,
  continueEndless,
  createGame,
  earlyBonus,
  findMap,
  sell,
  sellValue,
  setTargeting,
  slowFactor,
  startWave,
  takeEvents,
  tick,
  towerAt,
  towerStats,
  upgrade,
  upgradeCost,
  waveComposition,
  waveHasBoss,
  type Difficulty,
  type Enemy,
  type EnemyType,
  type GameEvent,
  type GameState,
  type MapDef,
  type Tower,
  type TowerType,
} from './logic';
import { strings } from './strings';
import './style.css';

const TOWER_ICON: Record<TowerType, string> = { arrow: '🏹', cannon: '💣', frost: '❄️', sniper: '🎯' };
const TOWER_COLOR: Record<TowerType, string> = { arrow: '#3ddc97', cannon: '#f59e42', frost: '#9be7ff', sniper: '#ff6ad5' };
const ENEMY_COLOR: Record<EnemyType, string> = { normal: '#ff7a59', fast: '#ffd93d', tank: '#b067ff', flying: '#38bdf8', boss: '#ff3b5c' };
const STEP = 1 / 60;
const MAX_SIM_PER_FRAME = 0.12;
const MAX_FLOATS = 30;
const MAX_EFFECTS = 120;

type Screen = 'start' | 'game';
type Speed = 1 | 2;

interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  success: string;
  danger: string;
  warning: string;
  cell: string;
  path: string;
  grid: string;
  towerBase: string;
}

interface Effect {
  kind: 'ring' | 'pulse' | 'burst' | 'tracer' | 'spark';
  x: number;
  y: number;
  x2: number;
  y2: number;
  r: number;
  t: number;
  dur: number;
  color: string;
  parts: { dx: number; dy: number }[];
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  t: number;
  dur: number;
  color: string;
}

interface Layout {
  cell: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;

  // ── Persistent choices ────────────────────────────────────────────────
  let mapId = ctx.storage.get<string>('map', MAPS[0].id);
  if (!MAPS.some((m) => m.id === mapId)) mapId = MAPS[0].id;
  let diff = ctx.storage.get<Difficulty>('diff', 'normal');
  if (diff !== 'normal' && diff !== 'hard') diff = 'normal';
  let speed: Speed = ctx.storage.get<number>('speed', 1) === 2 ? 2 : 1;

  // ── Runtime state ─────────────────────────────────────────────────────
  let screen: Screen = 'start';
  let sim: GameState | null = null;
  let paused = false;
  let finished = false;
  let acc = 0;
  let effects: Effect[] = [];
  let floats: FloatText[] = [];
  let leakFlash = 0;
  let L: Layout = { cell: 40, ox: 0, oy: 0, w: 0, h: 0 };
  let pal = readPalette();
  let selected: { col: number; row: number } | null = null;
  let previewType: TowerType | null = null;
  let sellArmed = false;
  let lastShoot = -1;
  let lastPop = -1;
  let lastBoom = -1;
  let drawTime = 0;

  let cv: CanvasHandle | null = null;
  let loop: ReturnType<typeof createLoop> | null = null;
  let offPointer: (() => void) | null = null;
  let area: HTMLElement | null = null;
  let menu: HTMLElement | null = null;
  let overlay: HTMLElement | null = null;
  let hudWave: HTMLElement | null = null;
  let hudLives: HTMLElement | null = null;
  let hudLivesWrap: HTMLElement | null = null;
  let hudGold: HTMLElement | null = null;
  let speedBtn: HTMLButtonElement | null = null;
  let preview: HTMLElement | null = null;
  let waveBtn: HTMLButtonElement | null = null;
  let lastHud = '';
  let lastWaveBtn = '';
  let lastPreviewKey = '';
  let lastMenuMoney = -1;
  let lastMenuKills = -1;
  let lastTickSec = -1;
  let thumbs: { canvas: HTMLCanvasElement; map: MapDef }[] = [];
  let modalOpen = false;

  function readPalette(): Palette {
    const v = (n: string, fb: string) => ctx.cssVar(n) || fb;
    const surface = v('--surface', '#1a1f2b');
    const surface2 = v('--surface-2', '#232a39');
    const text = v('--text', '#e8ecf3');
    return {
      bg: v('--bg', '#0f1218'),
      surface,
      surface2,
      border: v('--border', '#2d3548'),
      text,
      muted: v('--muted', '#8b94a7'),
      accent: v('--accent', '#5b8cff'),
      success: v('--success', '#3ddc97'),
      danger: v('--danger', '#ff5470'),
      warning: v('--warning', '#ffc857'),
      cell: surface,
      path: mix(surface2, text, 0.13),
      grid: mix(surface, text, 0.09),
      towerBase: mix(surface2, text, 0.05),
    };
  }

  const modeKey = (m: string, d: Difficulty) => `${m}:${d}`;
  const mapName = (id: string) => t('map_' + id);
  const diffName = (d: Difficulty) => (d === 'normal' ? t('normal') : t('hard'));

  // ── Header / global wiring ────────────────────────────────────────────
  const removeRestart = ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: onRestart });
  const removePause = ctx.addHeaderAction({ icon: '⏸', label: t('pause'), onClick: togglePause });

  const onKey = (e: KeyboardEvent): void => {
    if (screen !== 'game' || !sim) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (paused) resumeGame();
      else if (waveBtn && !waveBtn.disabled) waveBtn.click();
      e.preventDefault();
    } else if (e.key === 'p' || e.key === 'P') {
      togglePause();
    } else if (e.key === 'Escape') {
      if (menu) closeMenu();
      else togglePause();
    } else if (e.key === 'f' || e.key === 'F') {
      toggleSpeed();
    }
  };
  window.addEventListener('keydown', onKey);

  ctx.onDestroy(() => {
    removeRestart();
    removePause();
    window.removeEventListener('keydown', onKey);
    recordProgress();
    teardownGame();
  });
  ctx.onVisibility((visible) => {
    if (!visible) {
      if (screen === 'game' && !paused && !finished) pauseGame();
      loop?.stop();
    } else if (screen === 'game' && cv) {
      loop?.start();
    }
  });
  ctx.onThemeChange((_name: ThemeName) => {
    pal = readPalette();
    for (const th of thumbs) drawThumb(th.canvas, th.map);
    if (cv) draw();
  });

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    teardownGame();
    screen = 'start';
    root.innerHTML = '';
    ctx.setStatus('');
    thumbs = [];

    const bestLine = el('p', { class: 'muted td-best' });
    const mapDesc = el('p', { class: 'muted small td-start-desc' });
    const mapsRow = el('div', { class: 'td-maps' });
    const diffDesc = el('p', { class: 'muted small td-start-desc' });

    const refresh = () => {
      mapsRow.querySelectorAll<HTMLElement>('.td-map').forEach((card) => {
        const id = card.dataset.map ?? '';
        card.classList.toggle('active', id === mapId);
        const best = ctx.storage.getBest(modeKey(id, diff));
        const bestEl = card.querySelector('.td-map-best');
        if (bestEl) bestEl.textContent = best === null ? '' : `★ ${best}`;
        const clearedEl = card.querySelector<HTMLElement>('.td-map-cleared');
        if (clearedEl) clearedEl.hidden = !ctx.storage.get<boolean>('cleared:' + modeKey(id, diff), false);
      });
      const b = ctx.storage.getBest(modeKey(mapId, diff));
      const clearedNow = ctx.storage.get<boolean>('cleared:' + modeKey(mapId, diff), false);
      bestLine.textContent = (b === null ? t('noRecord') : t('bestWave', { n: b })) + (clearedNow ? ' · ✅ ' + t('cleared') : '');
      mapDesc.textContent = t('mapDesc_' + mapId);
      diffDesc.textContent = diff === 'normal' ? t('normalDesc') : t('hardDesc');
    };

    for (const m of MAPS) {
      const thumb = el('canvas', { class: 'td-map-thumb', width: 108, height: 156 }) as HTMLCanvasElement;
      thumbs.push({ canvas: thumb, map: m });
      drawThumb(thumb, m);
      const card = el(
        'button',
        {
          class: 'td-map',
          type: 'button',
          dataset: { map: m.id },
          onClick: () => {
            if (mapId !== m.id) {
              mapId = m.id;
              ctx.storage.set('map', mapId);
              ctx.play('tap');
              refresh();
            }
          },
        },
        thumb,
        el('span', { class: 'td-map-name', text: mapName(m.id) }),
        el('span', { class: 'td-map-best' }),
        el('span', { class: 'td-map-cleared', text: '✅' }),
      );
      mapsRow.append(card);
    }

    root.append(
      el(
        'div',
        { class: 'start-screen td-start' },
        el('div', { class: 'big-icon', text: '🏰' }),
        el('p', { class: 'muted td-start-desc', text: t('desc') }),
        mapsRow,
        mapDesc,
        segmented<Difficulty>(
          [
            { value: 'normal', label: t('normal') },
            { value: 'hard', label: t('hard') },
          ],
          diff,
          (d) => {
            diff = d;
            ctx.storage.set('diff', d);
            refresh();
          },
        ),
        diffDesc,
        bestLine,
        button(t('play'), () => startGame(), { variant: 'primary', size: 'lg', class: 'td-play' }),
      ),
    );
    refresh();
  }

  function drawThumb(canvas: HTMLCanvasElement, map: MapDef): void {
    const g = canvas.getContext('2d');
    if (!g) return;
    const w = canvas.width;
    const h = canvas.height;
    const cell = Math.min(w / map.cols, h / map.rows);
    const ox = (w - cell * map.cols) / 2;
    const oy = (h - cell * map.rows) / 2;
    g.clearRect(0, 0, w, h);
    g.fillStyle = pal.cell;
    g.fillRect(ox, oy, cell * map.cols, cell * map.rows);
    g.fillStyle = pal.path;
    const cells = buildPath(map);
    for (const [c, r] of cells) g.fillRect(ox + c * cell, oy + r * cell, cell + 0.5, cell + 0.5);
    const [ec, er] = cells[cells.length - 1];
    g.fillStyle = pal.accent;
    g.beginPath();
    g.arc(ox + (ec + 0.5) * cell, oy + (er + 0.5) * cell, cell * 0.42, 0, Math.PI * 2);
    g.fill();
    const [sc, sr] = cells[0];
    g.fillStyle = pal.danger;
    g.beginPath();
    g.arc(ox + (sc + 0.5) * cell, oy + (sr + 0.5) * cell, cell * 0.34, 0, Math.PI * 2);
    g.fill();
  }

  // ── Game screen ───────────────────────────────────────────────────────
  function startGame(): void {
    teardownGame();
    screen = 'game';
    root.innerHTML = '';
    thumbs = [];
    sim = createGame(findMap(mapId), diff);
    paused = false;
    finished = false;
    acc = 0;
    effects = [];
    floats = [];
    leakFlash = 0;
    selected = null;
    previewType = null;
    sellArmed = false;
    lastHud = '';
    lastWaveBtn = '';
    lastPreviewKey = '';
    lastMenuMoney = -1;
    drawTime = 0;

    hudWave = el('span', { class: 'stat-value' });
    hudLives = el('span', { class: 'stat-value' });
    hudGold = el('span', { class: 'stat-value' });
    hudLivesWrap = el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: t('lives') }), hudLives);
    speedBtn = el('button', { class: 'td-hudbtn', type: 'button', 'aria-label': t('speed'), onClick: () => toggleSpeed() }) as HTMLButtonElement;
    const hud = el(
      'div',
      { class: 'game-hud td-hud' },
      el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: t('wave') }), hudWave),
      hudLivesWrap,
      el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: t('gold') }), hudGold),
      el('div', { class: 'td-hud-btns' }, speedBtn),
    );

    area = el('div', { class: 'td-area' });
    preview = el('div', { class: 'td-preview' });
    waveBtn = button('', () => onWaveButton(), { variant: 'primary', size: 'lg', class: 'td-wave-btn' });
    const controls = el('div', { class: 'td-controls' }, preview, waveBtn);
    root.append(hud, area, controls);

    cv = createCanvas(area, (w, h) => {
      layout(w, h);
      if (menu && selected) positionMenu(menu, selected.col, selected.row);
    });
    offPointer = installPointer(cv.canvas);
    loop = createLoop((dt) => frame(dt));
    updateSpeedBtn();
    updateStatus();
    updateHud();
    updateWaveButton();
    updatePreview();
    draw();
    loop.start();
  }

  function teardownGame(): void {
    loop?.stop();
    loop = null;
    offPointer?.();
    offPointer = null;
    cv?.destroy();
    cv = null;
    menu?.remove();
    menu = null;
    overlay?.remove();
    overlay = null;
    area = null;
    preview = null;
    waveBtn = null;
    hudWave = hudLives = hudGold = hudLivesWrap = null;
    speedBtn = null;
    sim = null;
    selected = null;
  }

  function layout(w: number, h: number): void {
    if (!sim) return;
    const cell = Math.max(8, Math.floor(Math.min(w / sim.map.cols, h / sim.map.rows)));
    L = { cell, ox: Math.floor((w - cell * sim.map.cols) / 2), oy: Math.floor((h - cell * sim.map.rows) / 2), w, h };
  }

  function recordProgress(): void {
    if (!sim || sim.wave <= 0) return;
    ctx.storage.recordBest(modeKey(sim.map.id, sim.difficulty), sim.wave, 'higher');
  }

  // ── Frame ─────────────────────────────────────────────────────────────
  function frame(dt: number): void {
    if (!sim || !cv) return;
    const scale = paused || finished ? 0 : speed;
    if (scale > 0) {
      acc = Math.min(acc + dt * scale, MAX_SIM_PER_FRAME);
      while (acc >= STEP) {
        tick(sim, STEP);
        acc -= STEP;
      }
      handleEvents(takeEvents(sim));
    }
    const fx = dt * (scale > 0 ? scale : 1);
    drawTime += fx;
    advanceEffects(fx);
    updateHud();
    updateWaveButton();
    updatePreview();
    if (menu && (sim.money !== lastMenuMoney || sim.kills !== lastMenuKills)) refreshMenuAffordability();
    draw();
  }

  function advanceEffects(dt: number): void {
    if (leakFlash > 0) leakFlash = Math.max(0, leakFlash - dt);
    let prune = false;
    for (const e of effects) {
      e.t += dt;
      if (e.t >= e.dur) prune = true;
    }
    if (prune) effects = effects.filter((e) => e.t < e.dur);
    prune = false;
    for (const f of floats) {
      f.t += dt;
      if (f.t >= f.dur) prune = true;
    }
    if (prune) floats = floats.filter((f) => f.t < f.dur);
  }

  function pushEffect(e: Effect): void {
    effects.push(e);
    if (effects.length > MAX_EFFECTS) effects.splice(0, effects.length - MAX_EFFECTS);
  }

  function pushFloat(f: FloatText): void {
    floats.push(f);
    if (floats.length > MAX_FLOATS) floats.splice(0, floats.length - MAX_FLOATS);
  }

  function handleEvents(events: GameEvent[]): void {
    if (!sim) return;
    const now = drawTime;
    for (const ev of events) {
      switch (ev.type) {
        case 'shoot':
          if (now - lastShoot > 0.2) {
            lastShoot = now;
            ctx.play('shoot');
          }
          break;
        case 'tracer':
          pushEffect({ kind: 'tracer', x: ev.x1, y: ev.y1, x2: ev.x2, y2: ev.y2, r: 0, t: 0, dur: 0.14, color: TOWER_COLOR.sniper, parts: [] });
          break;
        case 'pulse':
          pushEffect({ kind: 'pulse', x: ev.x, y: ev.y, x2: 0, y2: 0, r: ev.range, t: 0, dur: 0.45, color: TOWER_COLOR.frost, parts: [] });
          break;
        case 'hit':
          if (ev.splash > 0) {
            pushEffect({ kind: 'ring', x: ev.x, y: ev.y, x2: 0, y2: 0, r: ev.splash, t: 0, dur: 0.35, color: TOWER_COLOR.cannon, parts: [] });
            if (now - lastBoom > 0.2) {
              lastBoom = now;
              ctx.play('explosion');
            }
          } else {
            pushEffect({ kind: 'spark', x: ev.x, y: ev.y, x2: 0, y2: 0, r: 0.16, t: 0, dur: 0.12, color: TOWER_COLOR[ev.kind], parts: [] });
          }
          break;
        case 'kill': {
          const parts: { dx: number; dy: number }[] = [];
          const n = ev.enemy === 'boss' ? 14 : 6;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
            const sp = 0.6 + Math.random() * 0.8;
            parts.push({ dx: Math.cos(a) * sp, dy: Math.sin(a) * sp });
          }
          pushEffect({ kind: 'burst', x: ev.x, y: ev.y, x2: 0, y2: 0, r: ev.enemy === 'boss' ? 0.5 : 0.25, t: 0, dur: 0.4, color: ENEMY_COLOR[ev.enemy], parts });
          pushFloat({ x: ev.x, y: ev.y - 0.3, text: '+' + ev.reward, t: 0, dur: 0.8, color: pal.warning });
          if (now - lastPop > 0.08) {
            lastPop = now;
            ctx.play(ev.enemy === 'boss' ? 'explosion' : 'pop');
          }
          if (ev.enemy === 'boss') ctx.haptic('heavy');
          break;
        }
        case 'leak':
          leakFlash = 0.5;
          ctx.play('error');
          ctx.haptic(ev.enemy === 'boss' ? 'heavy' : 'medium');
          break;
        case 'spawn':
          break;
        case 'waveStart':
          ctx.play('swoosh');
          updateStatus();
          if (ev.bonus > 0) {
            const p0 = sim.geom.points[1];
            pushFloat({ x: p0.x, y: p0.y - 0.4, text: `+${ev.bonus} 💰`, t: 0, dur: 1.3, color: pal.warning });
            ctx.play('coin');
          }
          if (waveHasBoss(ev.wave)) {
            ctx.toast('👑 ' + t('bossIncoming'));
            ctx.haptic('heavy');
          }
          break;
        case 'waveClear':
          ctx.play('coin');
          ctx.haptic('light');
          {
            const end = sim.geom.points[sim.geom.points.length - 1];
            pushFloat({ x: end.x, y: end.y - 0.6, text: `+${ev.bonus} 💰`, t: 0, dur: 1.4, color: pal.warning });
          }
          break;
        case 'mapCleared':
          onVictory();
          break;
        case 'gameOver':
          onGameOver();
          break;
      }
    }
  }

  // ── HUD / controls ────────────────────────────────────────────────────
  function updateStatus(): void {
    if (!sim) return;
    const w = sim.wave;
    const waveText = sim.endless ? `${t('wave')} ${w} ∞` : `${t('wave')} ${Math.max(w, 1)}/${WAVES_PER_MAP}`;
    ctx.setStatus(`${waveText} · ${mapName(sim.map.id)} · ${diffName(sim.difficulty)}`);
  }

  function updateHud(): void {
    if (!sim || !hudWave || !hudLives || !hudGold || !hudLivesWrap) return;
    const key = `${sim.wave}|${sim.lives}|${sim.money}|${sim.endless}`;
    if (key === lastHud) return;
    lastHud = key;
    hudWave.textContent = sim.endless ? `${sim.wave} ∞` : `${Math.max(sim.wave, 1)}/${WAVES_PER_MAP}`;
    hudLives.textContent = `❤️ ${sim.lives}`;
    hudGold.textContent = `💰 ${sim.money}`;
    hudLivesWrap.classList.toggle('td-lives-low', sim.lives <= Math.ceil(DIFFICULTY[sim.difficulty].lives * 0.25));
  }

  function updateWaveButton(): void {
    if (!sim || !waveBtn) return;
    let label = '';
    let disabled = false;
    if (sim.phase === 'ready') label = t('startWave', { n: 1 });
    else if (sim.phase === 'countdown') {
      const s = Math.ceil(sim.countdown);
      label = t('nextWave', { s, bonus: earlyBonus(sim.wave, sim.countdown, DIFFICULTY[sim.difficulty].rewardMult) });
      if (s <= 3 && s !== lastTickSec && !paused) {
        lastTickSec = s;
        ctx.play('tick');
      }
    } else if (sim.phase === 'wave') {
      label = t('waveInProgress', { n: sim.wave });
      disabled = true;
    } else if (sim.phase === 'cleared') {
      label = t('continueEndless');
    } else {
      label = t('lose');
      disabled = true;
    }
    const key = label + (disabled ? '|d' : '');
    if (key === lastWaveBtn) return;
    lastWaveBtn = key;
    const span = waveBtn.querySelector('span:last-child');
    if (span) span.textContent = label;
    waveBtn.disabled = disabled;
  }

  function updatePreview(): void {
    if (!sim || !preview) return;
    const next = sim.wave + 1;
    const key = `${sim.phase}|${next}`;
    if (key === lastPreviewKey) return;
    lastPreviewKey = key;
    preview.innerHTML = '';
    const groups = waveComposition(next);
    preview.append(el('span', { text: sim.phase === 'ready' ? `${t('wave')} ${next}:` : `${t('nextLabel')} ${next}:` }));
    for (const g of groups) {
      preview.append(
        el(
          'span',
          { class: 'td-preview-item', title: t('enemy_' + g.type) },
          el('i', { class: 'td-dot ' + g.type, style: { background: ENEMY_COLOR[g.type] } }),
          el('span', { text: (g.type === 'boss' ? '👑' : '') + '×' + g.count }),
        ),
      );
    }
  }

  function updateSpeedBtn(): void {
    if (!speedBtn) return;
    speedBtn.textContent = speed === 2 ? '×2' : '×1';
    speedBtn.classList.toggle('active', speed === 2);
  }

  function toggleSpeed(): void {
    speed = speed === 1 ? 2 : 1;
    ctx.storage.set('speed', speed);
    ctx.play('tap');
    updateSpeedBtn();
  }

  function onWaveButton(): void {
    if (!sim || paused || finished) return;
    if (sim.phase === 'cleared') {
      continueEndless(sim);
      updateStatus();
      return;
    }
    if (!canStartWave(sim)) return;
    const early = sim.phase === 'countdown';
    const bonus = startWave(sim, early);
    if (bonus < 0) return;
    closeMenu();
    ctx.haptic('light');
  }

  // ── Pause ─────────────────────────────────────────────────────────────
  function pauseGame(): void {
    if (screen !== 'game' || paused || finished || !area) return;
    paused = true;
    closeMenu();
    overlay?.remove();
    overlay = el(
      'div',
      { class: 'overlay td-pause' },
      el('div', { class: 'td-pause-icon', text: '⏸' }),
      el('h2', { text: t('paused') }),
      el('p', { class: 'muted', text: t('tapToResume') }),
      button(t('resume'), () => resumeGame(), { variant: 'primary', size: 'lg' }),
      button(t('home'), () => confirmQuit(), { variant: 'secondary' }),
    );
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) resumeGame();
    });
    area.append(overlay);
  }

  function resumeGame(): void {
    if (!paused) return;
    paused = false;
    overlay?.remove();
    overlay = null;
    ctx.play('tap');
    loop?.start();
  }

  function togglePause(): void {
    if (screen !== 'game' || finished || modalOpen) return;
    if (paused) resumeGame();
    else pauseGame();
  }

  function confirmQuit(): void {
    modalOpen = true;
    ctx.showModal({
      title: t('quit'),
      body: t('quitConfirm'),
      dismissible: false,
      buttons: [
        { label: t('cancel'), onClick: () => (modalOpen = false) },
        {
          label: t('confirm'),
          primary: true,
          onClick: () => {
            modalOpen = false;
            recordProgress();
            ctx.exit();
          },
        },
      ],
    });
  }

  function onRestart(): void {
    if (screen === 'start' || modalOpen) return;
    if (finished || (sim && sim.wave === 0)) {
      showStart();
      return;
    }
    if (!paused) pauseGame();
    modalOpen = true;
    ctx.showModal({
      title: t('restart'),
      body: t('quitConfirm'),
      dismissible: false,
      buttons: [
        { label: t('cancel'), onClick: () => (modalOpen = false) },
        {
          label: t('confirm'),
          primary: true,
          onClick: () => {
            modalOpen = false;
            recordProgress();
            showStart();
          },
        },
      ],
    });
  }

  // ── End of round ──────────────────────────────────────────────────────
  function onGameOver(): void {
    if (!sim || finished) return;
    finished = true;
    closeMenu();
    const key = modeKey(sim.map.id, sim.difficulty);
    const isBest = ctx.storage.recordBest(key, sim.wave, 'higher');
    ctx.play('lose');
    ctx.haptic('error');
    const body = t('gameOverBody', { map: mapName(sim.map.id), diff: diffName(sim.difficulty), n: sim.wave, k: sim.kills }) + (isBest ? '\n🏆 ' + t('newBest') : '');
    modalOpen = true;
    ctx.showModal({
      title: t('lose'),
      body,
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ((modalOpen = false), ctx.exit()) },
        { label: t('newGame'), onClick: () => ((modalOpen = false), showStart()) },
        { label: t('retry'), primary: true, onClick: () => ((modalOpen = false), startGame()) },
      ],
    });
  }

  function onVictory(): void {
    if (!sim) return;
    closeMenu();
    const key = modeKey(sim.map.id, sim.difficulty);
    const isBest = ctx.storage.recordBest(key, sim.wave, 'higher');
    ctx.storage.set('cleared:' + key, true);
    ctx.play('win');
    ctx.haptic('success');
    const body =
      t('victoryBody', { map: mapName(sim.map.id), diff: diffName(sim.difficulty), lives: sim.lives, k: sim.kills }) + (isBest ? '\n🏆 ' + t('newBest') : '');
    const s = sim;
    modalOpen = true;
    ctx.showModal({
      title: '🏆 ' + t('mapCleared'),
      body,
      dismissible: false,
      buttons: [
        { label: t('home'), onClick: () => ((modalOpen = false), ctx.exit()) },
        { label: t('newGame'), onClick: () => ((modalOpen = false), showStart()) },
        {
          label: t('continueEndless'),
          primary: true,
          onClick: () => {
            modalOpen = false;
            if (sim === s) {
              continueEndless(s);
              updateStatus();
              lastPreviewKey = '';
            }
          },
        },
      ],
    });
  }

  // ── Pointer / selection ───────────────────────────────────────────────
  function installPointer(canvas: HTMLCanvasElement): () => void {
    let sx = 0;
    let sy = 0;
    let active = false;
    let moved = false;
    return onPointer(canvas, {
      down(p) {
        sx = p.x;
        sy = p.y;
        active = true;
        moved = false;
      },
      move(p) {
        if (active && Math.hypot(p.x - sx, p.y - sy) > 12) moved = true;
      },
      up(p) {
        if (active && !moved) onTap(p.x, p.y);
        active = false;
      },
      cancel() {
        active = false;
      },
    });
  }

  function cellAt(x: number, y: number): { col: number; row: number } | null {
    if (!sim) return null;
    const col = Math.floor((x - L.ox) / L.cell);
    const row = Math.floor((y - L.oy) / L.cell);
    if (col < 0 || row < 0 || col >= sim.map.cols || row >= sim.map.rows) return null;
    return { col, row };
  }

  function onTap(x: number, y: number): void {
    if (!sim || paused || finished) return;
    const c = cellAt(x, y);
    if (!c) {
      closeMenu();
      return;
    }
    if (selected && selected.col === c.col && selected.row === c.row) {
      closeMenu();
      return;
    }
    const tower = towerAt(sim, c.col, c.row);
    if (tower) {
      ctx.play('tap');
      openTowerMenu(c.col, c.row, tower);
    } else if (canBuild(sim, c.col, c.row)) {
      ctx.play('tap');
      openBuildMenu(c.col, c.row);
    } else {
      closeMenu();
      ctx.play('error');
    }
  }

  function closeMenu(): void {
    menu?.remove();
    menu = null;
    selected = null;
    previewType = null;
    sellArmed = false;
  }

  function positionMenu(m: HTMLElement, col: number, row: number): void {
    if (!cv) return;
    const cx = L.ox + (col + 0.5) * L.cell;
    const top = L.oy + row * L.cell;
    const bottom = top + L.cell;
    const mw = m.offsetWidth || 236;
    const mh = m.offsetHeight || 180;
    let left = cx - mw / 2;
    left = clamp(left, 6, Math.max(6, L.w - mw - 6));
    let y = bottom + 8;
    if (y + mh > L.h - 6) y = top - mh - 8;
    if (y < 6) y = clamp(L.h - mh - 6, 6, L.h);
    // Taller than the whole area (landscape phones): centre it and let it overflow.
    if (mh > L.h - 12) y = Math.round((L.h - mh) / 2);
    m.style.left = `${Math.round(left)}px`;
    m.style.top = `${Math.round(y)}px`;
  }

  function openBuildMenu(col: number, row: number): void {
    if (!sim || !area) return;
    closeMenu();
    selected = { col, row };
    const s = sim;
    const grid = el('div', { class: 'td-menu-grid' });
    for (const type of TOWER_TYPES) {
      const cost = buildCost(type);
      const b = el(
        'button',
        {
          class: 'td-tbtn',
          type: 'button',
          dataset: { type, cost: String(cost) },
          onPointerdown: () => (previewType = type),
          onClick: () => {
            if (!sim || sim !== s) return;
            if (sim.money < cost) {
              ctx.play('error');
              ctx.toast(t('notEnoughGold'));
              return;
            }
            const tower = build(sim, col, row, type);
            if (!tower) {
              ctx.play('error');
              ctx.toast(t('cannotBuild'));
              return;
            }
            ctx.play('place');
            ctx.haptic('light');
            openTowerMenu(col, row, tower);
          },
        },
        el('span', { class: 'td-tbtn-icon', text: TOWER_ICON[type] }),
        el('span', { class: 'td-tbtn-name', text: t('tower_' + type) }),
        el('span', { class: 'td-tbtn-cost', text: `💰${cost}` }),
        el('span', { class: 'td-tbtn-desc', text: t('towerDesc_' + type) }),
      ) as HTMLButtonElement;
      b.disabled = s.money < cost;
      grid.append(b);
    }
    const money = el('span', { class: 'muted td-menu-money' });
    menu = el('div', { class: 'td-menu' }, el('div', { class: 'td-menu-title' }, el('span', { text: t('build') }), money), grid);
    area.append(menu);
    lastMenuMoney = -1;
    refreshMenuAffordability();
    positionMenu(menu, col, row);
  }

  function openTowerMenu(col: number, row: number, tower: Tower): void {
    if (!sim || !area) return;
    closeMenu();
    selected = { col, row };
    const s = sim;
    const def = TOWER_DEFS[tower.type];
    const lv = towerStats(tower.type, tower.level);
    const next = tower.level < MAX_LEVEL ? towerStats(tower.type, tower.level + 1) : null;
    const stat = (label: string, value: string, delta: string | null) =>
      el('div', {}, el('span', { text: label }), el('b', { text: value }), delta ? el('span', { class: 'up', text: delta }) : el('span', { class: 'up', text: ' ' }));
    const extra =
      tower.type === 'frost'
        ? stat(t('slow'), `${Math.round((lv.slow ?? 0) * 100)}%`, next ? `+${Math.round(((next.slow ?? 0) - (lv.slow ?? 0)) * 100)}%` : null)
        : tower.type === 'cannon'
          ? stat(t('splash'), fmt(lv.splash ?? 0), next ? `+${fmt((next.splash ?? 0) - (lv.splash ?? 0))}` : null)
          : stat(t('kills'), String(tower.kills), null);
    const killsEl = extra.querySelector('b');
    if (killsEl && tower.type !== 'frost' && tower.type !== 'cannon') killsEl.classList.add('td-kills');
    const stats = el(
      'div',
      { class: 'td-stats' },
      stat(t('dmg'), String(lv.dmg), next ? `+${next.dmg - lv.dmg}` : null),
      stat(t('range'), fmt(lv.range), next ? `+${fmt(next.range - lv.range)}` : null),
      stat(t('rate'), `${fmt(lv.rate)}/s`, next && next.rate !== lv.rate ? `+${fmt(next.rate - lv.rate)}` : null),
      extra,
    );
    const cost = upgradeCost(tower);
    const upBtn = button(cost === null ? t('maxLevel') : t('upgradeCost', { n: cost }), () => {
      if (!sim || sim !== s) return;
      const c = upgradeCost(tower);
      if (c === null) return;
      if (sim.money < c) {
        ctx.play('error');
        ctx.toast(t('notEnoughGold'));
        return;
      }
      if (upgrade(sim, tower.id)) {
        ctx.play('success');
        ctx.haptic('medium');
        openTowerMenu(col, row, tower);
      }
    }, { variant: 'primary', class: 'td-up-btn' });
    upBtn.dataset.cost = cost === null ? '' : String(cost);
    if (cost === null) upBtn.disabled = true;
    const sellBtn = button(t('sellValue', { n: sellValue(tower) }), () => {
      if (!sim || sim !== s) return;
      if (!sellArmed) {
        sellArmed = true;
        sellBtn.classList.add('armed');
        const span = sellBtn.querySelector('span:last-child');
        if (span) span.textContent = t('confirmSell');
        return;
      }
      const refund = sell(sim, tower.id);
      ctx.play('pop');
      ctx.haptic('light');
      pushFloat({ x: tower.x, y: tower.y - 0.3, text: `+${refund} 💰`, t: 0, dur: 1.2, color: pal.warning });
      closeMenu();
    }, { variant: 'danger' });
    const rows: HTMLElement[] = [];
    if (!def.aura) {
      const tgt = button(tower.targeting === 'first' ? t('targetFirst') : t('targetStrongest'), () => {
        if (!sim || sim !== s) return;
        setTargeting(sim, tower.id, tower.targeting === 'first' ? 'strongest' : 'first');
        ctx.play('tap');
        openTowerMenu(col, row, tower);
      }, { variant: 'secondary', size: 'sm', class: 'td-target-btn' });
      rows.push(tgt);
    }
    const money = el('span', { class: 'muted td-menu-money' });
    menu = el(
      'div',
      { class: 'td-menu' },
      el(
        'div',
        { class: 'td-menu-title' },
        el('span', { text: `${TOWER_ICON[tower.type]} ${t('tower_' + tower.type)} ${t('lv', { n: tower.level })}` }),
        money,
      ),
      stats,
      ...rows,
      el('div', { class: 'td-menu-row' }, upBtn, sellBtn),
    );
    area.append(menu);
    lastMenuMoney = -1;
    refreshMenuAffordability();
    positionMenu(menu, col, row);
  }

  function refreshMenuAffordability(): void {
    if (!sim || !menu) return;
    lastMenuMoney = sim.money;
    lastMenuKills = sim.kills;
    const money = menu.querySelector('.td-menu-money');
    if (money) money.textContent = `💰 ${sim.money}`;
    menu.querySelectorAll<HTMLButtonElement>('.td-tbtn').forEach((b) => {
      b.disabled = sim!.money < Number(b.dataset.cost ?? 0);
    });
    const up = menu.querySelector<HTMLButtonElement>('.td-up-btn');
    if (up && up.dataset.cost) up.disabled = sim.money < Number(up.dataset.cost);
    const kills = menu.querySelector('.td-kills');
    if (kills && selected) {
      const tw = towerAt(sim, selected.col, selected.row);
      if (tw) kills.textContent = String(tw.kills);
    }
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  function px(v: number): number {
    return L.ox + v * L.cell;
  }
  function py(v: number): number {
    return L.oy + v * L.cell;
  }

  function draw(): void {
    if (!cv || !sim) return;
    const g = cv.ctx;
    const s = sim;
    const { cell } = L;
    g.clearRect(0, 0, L.w, L.h);

    // Board
    g.fillStyle = pal.cell;
    g.fillRect(L.ox, L.oy, cell * s.map.cols, cell * s.map.rows);
    g.strokeStyle = pal.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let c = 1; c < s.map.cols; c++) {
      g.moveTo(L.ox + c * cell + 0.5, L.oy);
      g.lineTo(L.ox + c * cell + 0.5, L.oy + s.map.rows * cell);
    }
    for (let r = 1; r < s.map.rows; r++) {
      g.moveTo(L.ox, L.oy + r * cell + 0.5);
      g.lineTo(L.ox + s.map.cols * cell, L.oy + r * cell + 0.5);
    }
    g.stroke();

    // Path strip
    g.fillStyle = pal.path;
    for (const [c, r] of s.geom.cells) g.fillRect(L.ox + c * cell, L.oy + r * cell, cell, cell);
    // Direction chevrons every few cells
    g.strokeStyle = rgba(pal.text, 0.16);
    g.lineWidth = Math.max(1, cell * 0.06);
    g.lineCap = 'round';
    for (let i = 1; i < s.geom.cells.length - 1; i += 3) {
      const [c, r] = s.geom.cells[i];
      const [nc, nr] = s.geom.cells[i + 1];
      const dx = nc - c;
      const dy = nr - r;
      const cx = px(c + 0.5);
      const cy = py(r + 0.5);
      const a = cell * 0.16;
      g.beginPath();
      g.moveTo(cx - dx * a - dy * a, cy - dy * a + dx * a);
      g.lineTo(cx + dx * a * 0.4, cy + dy * a * 0.4);
      g.lineTo(cx - dx * a + dy * a, cy - dy * a - dx * a);
      g.stroke();
    }
    // Entry marker and castle
    const [sc, sr] = s.geom.cells[0];
    g.fillStyle = rgba(pal.danger, 0.55);
    g.beginPath();
    g.arc(px(sc + 0.5), py(sr + 0.5), cell * 0.12, 0, Math.PI * 2);
    g.fill();
    const [lc, lr] = s.geom.cells[s.geom.cells.length - 1];
    g.font = `${Math.round(cell * 0.72)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = pal.text;
    g.fillText('🏰', px(lc + 0.5), py(lr + 0.54));

    // Selection + range preview
    if (selected) {
      const tower = towerAt(s, selected.col, selected.row);
      const type = tower ? tower.type : previewType;
      if (type) {
        const lv = tower ? towerStats(type, tower.level) : towerStats(type, 1);
        drawRange(g, selected.col + 0.5, selected.row + 0.5, lv.range, TOWER_COLOR[type], false);
        if (tower && tower.level < MAX_LEVEL) {
          drawRange(g, selected.col + 0.5, selected.row + 0.5, towerStats(type, tower.level + 1).range, TOWER_COLOR[type], true);
        }
      }
      g.strokeStyle = pal.accent;
      g.lineWidth = 2;
      g.fillStyle = rgba(pal.accent, 0.18);
      roundRect(g, px(selected.col) + 1.5, py(selected.row) + 1.5, cell - 3, cell - 3, cell * 0.18);
      g.fill();
      g.stroke();
    }

    for (const tw of s.towers) drawTower(g, tw);

    // Ground enemies, projectiles, flyers
    for (const e of s.enemies) if (!e.flying) drawEnemy(g, e);
    for (const p of s.projectiles) {
      if (p.kind === 'cannon') {
        g.fillStyle = '#2b2b33';
        g.strokeStyle = TOWER_COLOR.cannon;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(px(p.x), py(p.y), cell * 0.11, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      } else {
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const len = cell * 0.26;
        g.strokeStyle = TOWER_COLOR[p.kind];
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px(p.x) - (dx / d) * len * 0.5, py(p.y) - (dy / d) * len * 0.5);
        g.lineTo(px(p.x) + (dx / d) * len * 0.5, py(p.y) + (dy / d) * len * 0.5);
        g.stroke();
      }
    }
    drawEffects(g);
    for (const e of s.enemies) if (e.flying) drawEnemy(g, e);

    // Floating text
    g.font = `700 ${Math.round(cell * 0.3)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const f of floats) {
      const k = f.t / f.dur;
      g.globalAlpha = 1 - k * k;
      g.fillStyle = f.color;
      g.fillText(f.text, px(f.x), py(f.y) - k * cell * 0.8);
    }
    g.globalAlpha = 1;

    // Leak flash
    if (leakFlash > 0) {
      const k = leakFlash / 0.5;
      const grad = g.createRadialGradient(L.w / 2, L.h / 2, Math.min(L.w, L.h) * 0.35, L.w / 2, L.h / 2, Math.max(L.w, L.h) * 0.75);
      grad.addColorStop(0, rgba(pal.danger, 0));
      grad.addColorStop(1, rgba(pal.danger, 0.45 * k));
      g.fillStyle = grad;
      g.fillRect(0, 0, L.w, L.h);
    }
  }

  function drawRange(g: CanvasRenderingContext2D, cx: number, cy: number, range: number, color: string, dashed: boolean): void {
    g.save();
    g.beginPath();
    g.arc(px(cx), py(cy), range * L.cell, 0, Math.PI * 2);
    if (dashed) {
      g.setLineDash([4, 5]);
      g.strokeStyle = rgba(color, 0.45);
      g.lineWidth = 1;
      g.stroke();
    } else {
      g.fillStyle = rgba(color, 0.1);
      g.fill();
      g.strokeStyle = rgba(color, 0.7);
      g.lineWidth = 1.5;
      g.stroke();
    }
    g.restore();
  }

  function drawTower(g: CanvasRenderingContext2D, tw: Tower): void {
    const { cell } = L;
    const cx = px(tw.x);
    const cy = py(tw.y);
    const color = TOWER_COLOR[tw.type];
    const base = cell * 0.8;
    // Base plate
    g.fillStyle = pal.towerBase;
    g.strokeStyle = rgba(color, 0.55);
    g.lineWidth = 1.5;
    roundRect(g, cx - base / 2, cy - base / 2, base, base, cell * 0.16);
    g.fill();
    g.stroke();
    // Level pips
    for (let i = 0; i < tw.level; i++) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(cx - cell * 0.14 + i * cell * 0.14, cy + base / 2 - cell * 0.09, cell * 0.035, 0, Math.PI * 2);
      g.fill();
    }
    g.save();
    g.translate(cx, cy - cell * 0.03);
    const r = cell * 0.24;
    const dark = 'rgba(0,0,0,0.35)';
    if (tw.type === 'arrow') {
      g.rotate(tw.angle);
      g.fillStyle = color;
      g.strokeStyle = dark;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      // Bow (arc) + arrow shaft with head and fletching.
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = Math.max(1.2, r * 0.16);
      g.beginPath();
      g.arc(-r * 0.1, 0, r * 0.75, -Math.PI * 0.42, Math.PI * 0.42);
      g.stroke();
      g.beginPath();
      g.moveTo(-r * 0.85, 0);
      g.lineTo(r * 1.05, 0);
      g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.beginPath();
      g.moveTo(r * 1.45, 0);
      g.lineTo(r * 0.85, -r * 0.38);
      g.lineTo(r * 0.85, r * 0.38);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(-r * 0.85, 0);
      g.lineTo(-r * 1.15, -r * 0.3);
      g.moveTo(-r * 0.85, 0);
      g.lineTo(-r * 1.15, r * 0.3);
      g.stroke();
    } else if (tw.type === 'cannon') {
      g.rotate(tw.angle);
      g.fillStyle = color;
      g.strokeStyle = dark;
      g.lineWidth = 1;
      g.fillRect(0, -r * 0.38, r * 1.5, r * 0.76);
      g.strokeRect(0, -r * 0.38, r * 1.5, r * 0.76);
      g.beginPath();
      g.arc(0, 0, r * 0.9, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = dark;
      g.beginPath();
      g.arc(0, 0, r * 0.35, 0, Math.PI * 2);
      g.fill();
    } else if (tw.type === 'frost') {
      g.fillStyle = color;
      g.strokeStyle = dark;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.strokeStyle = 'rgba(20,60,110,0.75)';
      g.lineWidth = 1.5;
      const spin = drawTime * 0.6;
      for (let i = 0; i < 3; i++) {
        const a = spin + (i / 3) * Math.PI;
        g.beginPath();
        g.moveTo(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75);
        g.lineTo(-Math.cos(a) * r * 0.75, -Math.sin(a) * r * 0.75);
        g.stroke();
      }
    } else {
      g.rotate(tw.angle);
      g.fillStyle = color;
      g.strokeStyle = dark;
      g.lineWidth = 1;
      g.fillRect(0, -r * 0.18, r * 1.9, r * 0.36);
      g.strokeRect(0, -r * 0.18, r * 1.9, r * 0.36);
      g.beginPath();
      g.moveTo(r * 0.85, 0);
      g.lineTo(0, r * 0.85);
      g.lineTo(-r * 0.85, 0);
      g.lineTo(0, -r * 0.85);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = dark;
      g.beginPath();
      g.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function drawEnemy(g: CanvasRenderingContext2D, e: Enemy): void {
    const { cell } = L;
    const cx = px(e.x);
    const cy = py(e.y) - (e.flying ? cell * 0.22 : 0);
    const r = e.radius * cell;
    const color = ENEMY_COLOR[e.type];
    const slowed = sim ? slowFactor(e, sim.time) > 0 : false;
    if (e.flying) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath();
      g.ellipse(px(e.x), py(e.y) + cell * 0.12, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = color;
    g.strokeStyle = slowed ? TOWER_COLOR.frost : 'rgba(0,0,0,0.4)';
    g.lineWidth = slowed ? 2.2 : 1.2;
    g.beginPath();
    if (e.flying) {
      const bob = Math.sin(drawTime * 6 + e.id) * cell * 0.03;
      g.moveTo(cx, cy - r * 1.1 + bob);
      g.lineTo(cx + r * 1.1, cy + bob);
      g.lineTo(cx, cy + r * 1.1 + bob);
      g.lineTo(cx - r * 1.1, cy + bob);
      g.closePath();
    } else if (e.type === 'tank') {
      roundRect(g, cx - r, cy - r, r * 2, r * 2, r * 0.45);
    } else {
      g.arc(cx, cy, r, 0, Math.PI * 2);
    }
    g.fill();
    g.stroke();
    if (slowed) {
      g.fillStyle = rgba(TOWER_COLOR.frost, 0.3);
      g.fill();
    }
    if (e.type === 'boss') {
      g.fillStyle = '#ffd93d';
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx - r * 0.55, cy + r * 0.2);
      g.lineTo(cx - r * 0.6, cy - r * 0.45);
      g.lineTo(cx - r * 0.25, cy - r * 0.1);
      g.lineTo(cx, cy - r * 0.6);
      g.lineTo(cx + r * 0.25, cy - r * 0.1);
      g.lineTo(cx + r * 0.6, cy - r * 0.45);
      g.lineTo(cx + r * 0.55, cy + r * 0.2);
      g.closePath();
      g.fill();
      g.stroke();
    } else if (e.type === 'fast') {
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx - r * 0.5, cy - r * 0.25);
      g.lineTo(cx + r * 0.1, cy - r * 0.25);
      g.moveTo(cx - r * 0.5, cy + r * 0.2);
      g.lineTo(cx + r * 0.3, cy + r * 0.2);
      g.stroke();
    } else if (e.type === 'tank') {
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.2;
      g.strokeRect(cx - r * 0.45, cy - r * 0.45, r * 0.9, r * 0.9);
    }
    // HP bar
    if (e.hp < e.maxHp) {
      const bw = Math.max(r * 2.2, cell * 0.42);
      const bh = Math.max(2.5, cell * 0.07);
      const bx = cx - bw / 2;
      const by = cy - r - bh - cell * 0.1;
      const k = clamp(e.hp / e.maxHp, 0, 1);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(bx, by, bw, bh);
      g.fillStyle = k > 0.5 ? pal.success : k > 0.25 ? pal.warning : pal.danger;
      g.fillRect(bx, by, bw * k, bh);
    }
  }

  function drawEffects(g: CanvasRenderingContext2D): void {
    const { cell } = L;
    for (const e of effects) {
      const k = e.t / e.dur;
      if (e.kind === 'ring') {
        g.strokeStyle = rgba(e.color, 1 - k);
        g.lineWidth = 3 * (1 - k) + 1;
        g.beginPath();
        g.arc(px(e.x), py(e.y), e.r * cell * (0.4 + 0.6 * k), 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = rgba(e.color, 0.25 * (1 - k));
        g.fill();
      } else if (e.kind === 'pulse') {
        g.strokeStyle = rgba(e.color, 0.8 * (1 - k));
        g.lineWidth = 2;
        g.beginPath();
        g.arc(px(e.x), py(e.y), e.r * cell * (0.2 + 0.8 * k), 0, Math.PI * 2);
        g.stroke();
      } else if (e.kind === 'tracer') {
        g.strokeStyle = rgba(e.color, 0.9 * (1 - k));
        g.lineWidth = 2.5 * (1 - k) + 0.5;
        g.beginPath();
        g.moveTo(px(e.x), py(e.y));
        g.lineTo(px(e.x2), py(e.y2));
        g.stroke();
      } else if (e.kind === 'spark') {
        g.fillStyle = rgba(e.color, 1 - k);
        g.beginPath();
        g.arc(px(e.x), py(e.y), e.r * cell * (1 - k * 0.5), 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = rgba(e.color, 1 - k);
        for (const p of e.parts) {
          g.beginPath();
          g.arc(px(e.x + p.dx * k * 1.6 * e.r * 2), py(e.y + p.dy * k * 1.6 * e.r * 2), cell * 0.06 * (1 - k * 0.5), 0, Math.PI * 2);
          g.fill();
        }
      }
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
