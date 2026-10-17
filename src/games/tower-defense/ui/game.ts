/**
 * Game screen (§7.10, §11.2): owns the fixed-step loop, the lazily created Three.js renderer and every DOM overlay —
 * HUD, bottom bar (hero portrait, abilities with radial cooldowns, speed, pause, wave button), build strip, tower
 * panel + specialization cards, hero move mode, drag-to-aim Antibiotic Strike, tips / tutorial toasts, pause and
 * context-loss overlays, end-of-run modals, sounds and haptics mapped from GameEvents, run / memory persistence.
 */
import type { GameContext, HapticName, SoundName, ThemeName } from '../../../app/types';
import { el, button } from '../../../app/ui';
import {
  ABILITY_IDS,
  MAX_STEPS_PER_FRAME,
  SIM_STEP,
  TARGETING_MODES,
  TOWER_IDS,
  TOWER_SPECS,
  WAVES_PER_MAP,
  WORLD,
  type AbilityId,
  type BossId,
  type CreateRenderer,
  type Difficulty,
  type GameEvent,
  type GameState,
  type ImmuneMemory,
  type ImmuneRenderer,
  type InteractionMode,
  type MapId,
  type Point,
  type Quality,
  type RenderSnapshot,
  type Selection,
  type SpecId,
  type TapHit,
  type Tower,
  type TowerId,
  type TowerLevel,
  type TutorialId,
  type WavePreview,
} from '../types';
import {
  ABILITIES,
  TOWERS,
  abilityDamage,
  build,
  canBuild,
  castAbility,
  continueEndless,
  createSnapshot,
  earlyBonus,
  findEnemy,
  findTower,
  grantVaccine,
  isPad,
  isPathCell,
  levelStats,
  mapInfo,
  moveHero,
  noteRecorded,
  recordRun,
  sell,
  setTargeting,
  snapshot,
  startWave,
  step,
  takeEvents,
  towerAt,
  towerStats,
  upgrade,
  upgradeCost,
  villiBonus,
  virusRiskPads,
  wavePreview,
} from '../logic';
import { aimTarget, type AimGeometry } from './aim';
import { revealInScroller } from './scroll';
import { ABILITY_ICON, BOSS_ICON, ENEMY_ICON, TOWER_ICON, fmtNum, fmtStat, nodes, readableInk, specColor, towerColor, type T } from './format';

export interface GameHost {
  ctx: GameContext;
  t: T;
  memory(): ImmuneMemory;
  setMemory(m: ImmuneMemory): void;
  loadRenderer(): Promise<CreateRenderer>;
  /** Persists the run (null deletes the save). */
  writeRun(s: GameState | null): void;
  toStart(): void;
  /** Starts a fresh run on a map (retry / restart). */
  newRun(map: MapId, diff: Difficulty): void;
}

/** Window hook for Playwright reviewers (dev builds only). */
export interface TdDevHooks {
  state(): GameState;
  screen(): string;
  cellToScreen(col: number, row: number): { x: number; y: number } | null;
  worldToScreen(x: number, y: number, h?: number): { x: number; y: number } | null;
  heroScreen(): { x: number; y: number } | null;
  towerScreen(id: number): { x: number; y: number } | null;
  enemyScreen(id: number): { x: number; y: number } | null;
  towers(): { id: number; type: TowerId; col: number; row: number; level: number; spec: SpecId | null; sx: number; sy: number }[];
  enemies(): { id: number; type: string; x: number; y: number; hp: number; maxHp: number; boss: boolean; sx: number; sy: number }[];
  pads(): { col: number; row: number; free: boolean; villi: boolean }[];
  pathCells(): { col: number; row: number }[];
  addAtp(n: number): void;
  skipToWave(n: number, start?: boolean): void;
  killAll(): void;
  setSpeed(x: number): void;
  advance(seconds: number): void;
  stats(): { calls: number; triangles: number; frameMs: number } | null;
}

/**
 * Sets CSS custom properties on an element. `el(..., { style: { '--x': v } })` cannot do it: the shell helper copies
 * styles with `Object.assign(node.style, …)`, which silently drops custom properties (they need `setProperty`).
 */
function copyBox(out: { left: number; top: number; right: number; bottom: number }, r: { left: number; top: number; right: number; bottom: number }): void {
  out.left = r.left;
  out.top = r.top;
  out.right = r.right;
  out.bottom = r.bottom;
}

function cssVars<E extends HTMLElement>(node: E, vars: Record<string, string>): E {
  for (const k in vars) node.style.setProperty(k, vars[k]);
  return node;
}

type Tip = { kind: 'boss' | 'tut' | 'info'; text: string; title?: string; icon?: string; ms: number; id?: TutorialId };
/** One card of the build strip (updated in place by `updateBuildStrip`). */
type BuildCard = { type: TowerId; btn: HTMLElement; name: HTMLElement; cost: HTMLElement };

const LONG_PRESS_MS = 550;
const TIP_MS = 6500;
const SELL_ARM_MS = 400;
/** The boss toast waits at least this long (real s) and then until the renderer's wave banner is gone. */
const BANNER_MIN_S = 0.4;
const SELL_WINDOW_MS = 2600;
const DEV = import.meta.env.DEV;

/** Minimum gap (ms) between two plays of the same sound; frequent combat sounds are throttled harder. */
const SOUND_GAP: Partial<Record<SoundName, number>> = {
  shoot: 140,
  pop: 90,
  tick: 250,
  coin: 140,
  swoosh: 200,
  explosion: 220,
  error: 280,
  success: 220,
  place: 80,
  move: 120,
  tap: 60,
};

export class GameScreen {
  s: GameState;
  private readonly ctx: GameContext;
  private readonly t: T;
  private r: ImmuneRenderer | null = null;
  private snap: RenderSnapshot;
  private destroyed = false;
  private discard = false;
  private raf = 0;
  private lastTs = 0;
  private acc = 0;
  private frameNo = 0;
  private speed: number;
  private paused = false;
  private lost = false;
  private fast = false;
  private sel: Selection = null;
  private interaction: InteractionMode = 'none';
  private cursor: Point = { x: NaN, y: NaN };
  private buildAt: { col: number; row: number; kind: 'pad' | 'path'; preview: TowerId | null } | null = null;
  /** The open build strip's DOM (see `renderBuild`); null when no strip is open. */
  private strip: { root: HTMLElement; cards: HTMLElement; detail: HTMLElement; items: BuildCard[]; villi: boolean; detailKey: string } | null = null;
  private panelTower: number | null = null;
  private specOpen = false;
  private extrasOpen = false;
  private sellArmedAt = 0;
  private aim: { mode: 'drag' | 'tap'; pid: number; x0: number; y0: number; moved: boolean; btn: HTMLElement | null } | null = null;
  private aimGeo: AimGeometry = { bar: { left: 0, top: 0, right: 0, bottom: 0 }, button: { left: 0, top: 0, right: 0, bottom: 0 }, stage: { left: 0, top: 0, right: 0, bottom: 0 }, hudBottom: 0 };
  private aimPt = { x: 0, y: 0 };
  private heroDrag: { pid: number; x0: number; y0: number; moved: boolean } | null = null;
  private longPress = 0;
  private longPressFired = false;
  private tipQueue: Tip[] = [];
  private tipCur: { tip: Tip; el: HTMLElement; timer: number; at: number } | null = null;
  private lastSound: Partial<Record<SoundName, number>> = {};
  private lastHaptic = 0;
  private lastPanelRefresh = 0;
  private lastStatus = '';
  /** Last values shown by the HUD / bottom bar (updateHud compares these before formatting anything). */
  private hudSig = { wave: -1, endless: -1, vit: -1, maxVit: -1, atp: -1, speed: -1 };
  private chipsSig = { wave: -2, inWave: false };
  private waveSig = { phase: '', wave: -1, next: -1, cd: -1, bonus: -1, left: -1, modal: false };
  private abSig = { frac: new Int16Array(ABILITY_IDS.length).fill(-1), secs: new Int32Array(ABILITY_IDS.length), flags: new Int8Array(ABILITY_IDS.length) };
  private portraitSig = { key: -1, level: -1 };
  /** Real (unpaused) seconds the loop has run; the boss toast waits for the banner on this clock, not sim time. */
  private realTime = 0;
  private lastCountdownTick = -1;
  private hudCache: Record<string, string> = {};
  private bestAtStart: number;
  private overflowWarned = false;
  private unTap: (() => void) | null = null;
  private cleanups: (() => void)[] = [];
  private noteTimers = new Set<number>();
  private seenSpawn = new Set<string>();
  private modalOpen = false;
  private previewOpen = false;
  /** wavePreview re-parses the wave script: cached per (map, wave) instead of being rebuilt every frame. */
  private pvCache: { map: MapId; wave: number; pv: WavePreview } | null = null;
  /** Boss toast waits for the renderer's wave banner (`bannerShowing`) so the two are never on screen together. */
  private pendingBoss: { boss: BossId; wave: number; at: number } | null = null;

  // DOM
  private gameEl!: HTMLElement;
  private stage!: HTMLElement;
  private hud!: HTMLElement;
  private hudWaveText!: HTMLElement;
  private hudNext!: HTMLElement;
  private hudChips!: HTMLElement;
  private hudVit!: HTMLElement;
  private hudVitVal!: HTMLElement;
  private hudAtpVal!: HTMLElement;
  private previewEl!: HTMLElement;
  private tipsEl!: HTMLElement;
  private notesEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private hintText!: HTMLElement;
  private hintConfirm!: HTMLButtonElement;
  private hintCancel!: HTMLButtonElement;
  private sheetEl!: HTMLElement;
  private bar!: HTMLElement;
  private heroBtn!: HTMLElement;
  private heroHp!: HTMLElement;
  private heroLv!: HTMLElement;
  private heroResp!: HTMLElement;
  private abBtns: Partial<Record<AbilityId, { btn: HTMLElement; cd: HTMLElement }>> = {};
  private speedBtn!: HTMLButtonElement;
  private pauseBtn!: HTMLButtonElement;
  private waveBtn!: HTMLButtonElement;
  private waveMain!: HTMLElement;
  private waveSub!: HTMLElement;
  private waveGlyphs!: HTMLElement;
  private overlayEl: HTMLElement | null = null;
  private loadingEl: HTMLElement | null = null;
  private lostEl: HTMLElement | null = null;

  constructor(
    private host: GameHost,
    private root: HTMLElement,
    state: GameState,
  ) {
    this.ctx = host.ctx;
    this.t = host.t;
    this.s = state;
    this.snap = createSnapshot(state.map);
    const mem = host.memory();
    this.speed = mem.prefs.speed;
    this.bestAtStart = mem.bestEndless[state.mapId][state.difficulty];
    this.buildDom();
    this.addHeaderActions();
    this.loadRenderer();
    const onHide = () => this.saveIfAllowed();
    window.addEventListener('pagehide', onHide);
    this.cleanups.push(() => window.removeEventListener('pagehide', onHide));
    this.updateStatus();
    this.updateHud(true);
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  private buildDom(): void {
    const t = this.t;
    this.gameEl = el('div', { class: 'td-game' });
    this.stage = el('div', { class: 'td-stage' });
    // HUD
    this.hudWaveText = el('span', { class: 'td-hud-wavetext' });
    this.hudNext = el('span', { class: 'td-hud-next', title: t('hudNext'), text: '›' });
    this.hudChips = el('span', { class: 'td-chips' });
    const waveBox = el('button', { class: 'td-hud-wave', type: 'button', 'aria-label': t('previewTitle', { n: this.s.wave + 1 }) }, this.hudWaveText, this.hudNext, this.hudChips);
    waveBox.addEventListener('click', () => this.togglePreview());
    this.hudVitVal = el('span', { class: 'td-hud-val' });
    this.hudVit = el('div', { class: 'td-hud-stat td-hud-vit', title: t('vitality') }, el('span', { class: 'td-hud-ico', text: '♥' }), this.hudVitVal);
    this.hudAtpVal = el('span', { class: 'td-hud-val' });
    const atp = el('div', { class: 'td-hud-stat td-hud-atp', title: t('atp') }, el('span', { class: 'td-hud-ico', text: '⚡' }), this.hudAtpVal);
    this.hud = el('div', { class: 'td-hud' }, waveBox, el('div', { class: 'td-hud-right' }, this.hudVit, atp));
    this.previewEl = el('div', { class: 'td-preview', hidden: true });
    this.tipsEl = el('div', { class: 'td-tips' });
    this.notesEl = el('div', { class: 'td-notes' });
    // hint (move / aim)
    this.hintText = el('span', { class: 'td-hint-text' });
    this.hintConfirm = button(t('confirm'), () => this.confirmAim(), { variant: 'primary', size: 'sm' });
    this.hintCancel = button(t('cancel'), () => this.cancelModes(), { variant: 'secondary', size: 'sm' });
    this.hintEl = el('div', { class: 'td-hint', hidden: true }, this.hintText, this.hintConfirm, this.hintCancel);
    this.sheetEl = el('div', { class: 'td-sheet', hidden: true });
    // bottom bar
    this.heroHp = el('span', { class: 'td-hero-hpfill' });
    this.heroLv = el('span', { class: 'td-hero-lv' });
    this.heroResp = el('span', { class: 'td-hero-resp' });
    this.heroBtn = el(
      'button',
      { class: 'td-hero', type: 'button', 'aria-label': t('hero_blanc') },
      el('span', { class: 'td-hero-face' }, el('span', { class: 'td-eye l' }), el('span', { class: 'td-eye r' })),
      el('span', { class: 'td-hero-hp' }, this.heroHp),
      this.heroLv,
      this.heroResp,
    );
    this.bindHeroButton();
    const row1 = el('div', { class: 'td-row td-row1' }, this.heroBtn);
    for (const id of ABILITY_IDS) {
      const cd = el('span', { class: 'td-ab-cd' });
      const btn = el(
        'button',
        { class: 'td-ab', type: 'button', dataset: { ability: id }, 'aria-label': t('ability_' + id) },
        el('span', { class: 'td-ab-icon', text: ABILITY_ICON[id] }),
        el('span', { class: 'td-ab-name', text: t('abilityShort_' + id) }),
        cd,
      );
      this.bindAbilityButton(id, btn);
      if (!this.s.abilities[id].unlocked) btn.hidden = true;
      this.abBtns[id] = { btn, cd };
      row1.append(btn);
    }
    this.speedBtn = el('button', { class: 'td-sq td-speed', type: 'button', 'aria-label': t('speedLabel'), title: t('speedLabel') });
    this.speedBtn.addEventListener('click', () => this.toggleSpeed());
    this.pauseBtn = el('button', { class: 'td-sq td-pausebtn', type: 'button', 'aria-label': t('pause'), title: t('pause') }, el('span', { class: 'td-pausebars' }));
    this.pauseBtn.addEventListener('click', () => {
      this.ctx.play('tap');
      this.pause('user');
    });
    this.waveMain = el('span', { class: 'td-wave-main' });
    this.waveSub = el('span', { class: 'td-wave-sub' });
    this.waveGlyphs = el('span', { class: 'td-wave-glyphs' });
    this.waveBtn = el('button', { class: 'td-wavebtn', type: 'button' }, el('span', { class: 'td-wave-text' }, this.waveMain, this.waveSub), this.waveGlyphs);
    this.waveBtn.addEventListener('click', () => this.onWaveButton());
    const row2 = el('div', { class: 'td-row td-row2' }, this.speedBtn, this.pauseBtn, this.waveBtn);
    this.bar = el('div', { class: 'td-bar' }, row1, row2);
    this.gameEl.append(this.stage, this.hud, this.previewEl, this.tipsEl, this.notesEl, this.hintEl, this.sheetEl, this.bar);
    this.root.append(this.gameEl);
    // chrome sizes → renderer insets + CSS vars
    const ro = new ResizeObserver(() => this.updateInsets(false));
    ro.observe(this.gameEl);
    ro.observe(this.hud);
    ro.observe(this.bar);
    ro.observe(this.sheetEl);
    ro.observe(this.hintEl);
    this.cleanups.push(() => ro.disconnect());
    this.showLoading(this.t('loadingScene'));
  }

  private addHeaderActions(): void {
    const t = this.t;
    const offRestart = this.ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: () => this.confirmRestart() });
    const offMenu = this.ctx.addHeaderAction({ icon: '☰', label: t('menuLabel'), onClick: () => this.pause('user') });
    this.cleanups.push(offRestart, offMenu);
  }

  /**
   * Loading overlay; on failure `retry` adds Retry + Home, `home` alone shows only Home (nothing to retry: a device
   * without WebGL cannot play, so "Retry" would only have gone home too).
   */
  private showLoading(text: string, opts: { retry?: () => void; home?: boolean } = {}): void {
    this.loadingEl?.remove();
    const failed = !!opts.retry || !!opts.home;
    const box = el('div', { class: 'overlay td-loading' }, el('div', { class: 'td-spinner', hidden: failed }), el('p', { text }));
    if (opts.retry) box.append(button(this.t('retry'), opts.retry, { variant: 'primary' }));
    if (failed) box.append(button(this.t('home'), () => this.ctx.exit(), { variant: opts.retry ? 'secondary' : 'primary' }));
    this.loadingEl = box;
    this.gameEl.append(box);
  }

  private loadRenderer(): void {
    this.host
      .loadRenderer()
      .then((create) => {
        if (this.destroyed) return;
        this.mountRenderer(create);
      })
      .catch((e: unknown) => {
        if (this.destroyed) return;
        console.warn('[tower-defense] renderer chunk failed to load', e);
        this.showLoading(this.t('loadFailed'), {
          retry: () => {
            this.showLoading(this.t('loadingScene'));
            this.loadRenderer();
          },
        });
      });
  }

  private mountRenderer(create: CreateRenderer): void {
    const mem = this.host.memory();
    try {
      this.r = create(this.stage, this.s.map, {
        quality: mem.prefs.quality,
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : this.ctx.theme,
        lang: this.ctx.lang,
        t: this.t,
        onContextLost: (lost) => this.onContextLost(lost),
      });
    } catch (e) {
      console.warn('[tower-defense] WebGL unavailable', e);
      // this device cannot play: leaving must not write a run save (the start screen would offer "Continue")
      this.discard = true;
      this.showLoading(this.t('noWebgl'), { home: true });
      return;
    }
    this.loadingEl?.remove();
    this.loadingEl = null;
    this.unTap = this.r.onTap((hit) => this.onTap(hit));
    this.updateInsets(true);
    this.updateBuildable();
    if (this.s.phase === 'build') this.tutorial('tut_build');
    this.startLoop();
  }

  // ── loop (§7.10) ──────────────────────────────────────────────────────────

  private startLoop(): void {
    if (this.raf || this.destroyed || this.paused || this.lost || !this.r) return;
    this.lastTs = 0;
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.acc = 0;
  }

  private frame = (ts: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const r = this.r;
    if (!r) return;
    let dtMs = this.lastTs ? ts - this.lastTs : 1000 / 60;
    this.lastTs = ts;
    if (dtMs > 250) dtMs = 250;
    if (dtMs < 0) dtMs = 0;
    this.realTime += dtMs / 1000;
    this.acc += (dtMs / 1000) * this.speed;
    const s = this.s;
    const idle = this.isIdle();
    r.setIdle(idle);
    this.frameNo++;
    // idle frames render at IDLE_FPS (every other RAF); the accumulator keeps the time
    if (idle && (this.frameNo & 1) === 1) return;
    const maxSteps = MAX_STEPS_PER_FRAME * Math.max(1, Math.ceil(this.speed / 2));
    let steps = 0;
    while (this.acc >= SIM_STEP && steps < maxSteps) {
      step(s, SIM_STEP);
      this.acc -= SIM_STEP;
      steps++;
    }
    if (steps === maxSteps) this.acc = 0;
    const evs = takeEvents(s);
    r.handleEvents(evs);
    this.handleEvents(evs);
    if (this.destroyed || this.s !== s || !this.r) return;
    this.draw();
    this.updateHud(false);
  };

  private isIdle(): boolean {
    const s = this.s;
    const r = this.r;
    return (
      s.phase !== 'wave' &&
      s.enemies.length === 0 &&
      s.projectiles.length === 0 &&
      s.hero.dest === null &&
      s.hero.alive &&
      this.interaction === 'none' &&
      !!r &&
      !r.busy
    );
  }

  /** Fills the snapshot (+ UI-owned fields) and renders one frame. */
  private draw(): void {
    const r = this.r;
    if (!r) return;
    const snap = this.snap;
    const alpha = Math.max(0, Math.min(1, this.acc / SIM_STEP));
    snapshot(this.s, snap, alpha);
    snap.selection = this.sel;
    snap.interaction = this.interaction;
    snap.cursorX = this.cursor.x;
    snap.cursorY = this.cursor.y;
    if (DEV && !this.overflowWarned && this.s.enemies.length > snap.enemies.capacity) {
      this.overflowWarned = true;
      console.warn(`[tower-defense] ${this.s.enemies.length} enemies exceed the snapshot capacity (${snap.enemies.capacity}); extra ones are simulated but not drawn`);
    }
    r.update(snap, alpha);
  }

  /** Renders a single frame while the loop is stopped (UI changes under the pause / modal). */
  private drawOnce(): void {
    if (!this.raf && this.r && !this.lost) this.draw();
  }

  // ── events → UI / sound / haptics ─────────────────────────────────────────

  private handleEvents(evs: readonly GameEvent[]): void {
    const s = this.s;
    const t = this.t;
    let panelDirty = false;
    let buildable = false;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      switch (ev.type) {
        case 'build':
          this.sound('place');
          this.haptic('light');
          buildable = true;
          panelDirty = true;
          break;
        case 'upgrade':
          this.sound('success');
          this.haptic('medium');
          panelDirty = true;
          break;
        case 'sell':
          this.sound('coin');
          if (this.panelTower === ev.tower) this.closeSheet();
          buildable = true;
          break;
        case 'denied':
          this.note(t('denied_' + ev.reason), 'warn');
          this.sound('error');
          this.haptic('error');
          break;
        case 'shoot':
        case 'tracer':
          this.sound('shoot');
          break;
        case 'chain':
          this.sound('swoosh', 260);
          break;
        case 'engulf':
        case 'execute':
          this.sound('pop');
          break;
        case 'kill':
          if (ev.boss) {
            this.sound('explosion', 0);
            this.haptic('heavy', true);
          } else this.sound('pop');
          break;
        case 'split':
          this.sound('pop');
          break;
        case 'leak':
          this.sound('error', 400);
          this.haptic('medium');
          this.flash(this.hudVit, 'td-flash');
          break;
        case 'spawn':
          if (!this.seenSpawn.has(ev.enemy)) {
            this.seenSpawn.add(ev.enemy);
            if (ev.enemy === 'virus') this.tutorial('tut_infect');
            if (ev.enemy === 'parasite' || ev.enemy === 'giantParasite') this.tutorial('tut_barrier');
          }
          break;
        case 'waveStart':
          this.onWaveStart(ev.wave, ev.boss);
          buildable = true;
          break;
        case 'waveClear': {
          buildable = true;
          this.sound('success', 0);
          let txt = t('waveClearNote', { n: ev.wave, bonus: ev.bonus });
          if (ev.interest > 0) txt += ' · ' + t('interestNote', { n: ev.interest });
          if (ev.vitRestored > 0) txt += ' · ' + t('repairNote', { n: ev.vitRestored });
          this.note(txt, 'good');
          // persist after every wave (phase is countdown here; a cleared map deletes the save in finishRun)
          if (s.phase === 'countdown') this.host.writeRun(s);
          break;
        }
        case 'earlyBonus':
          this.sound('coin', 0);
          this.note(t('earlyNote', { n: ev.bonus }), 'good');
          break;
        case 'mapCleared':
          this.finishRun('cleared');
          break;
        case 'gameOver':
          this.finishRun('over');
          break;
        case 'vaccineUnlocked': {
          this.host.setMemory(grantVaccine(this.host.memory(), ev.boss, Date.now()));
          this.sound('win', 0);
          this.haptic('success', true);
          this.showTip({ kind: 'info', icon: '💉', title: t('vaccine_' + ev.boss), text: t('vaccineToast', { name: t('vaccine_' + ev.boss) }), ms: TIP_MS });
          break;
        }
        case 'infect':
          this.sound('tick', 600);
          if (this.panelTower === ev.tower) panelDirty = true;
          break;
        case 'cure':
          this.sound('success', 450);
          if (this.panelTower === ev.tower) panelDirty = true;
          break;
        case 'heroDeath':
          this.sound('explosion', 0);
          this.haptic('heavy', true);
          this.note(t('heroDown', { s: Math.round(ev.respawnAt - s.time) }), 'warn');
          if (this.interaction === 'heroMove') this.cancelModes();
          break;
        case 'heroRespawn':
          this.note(t('heroUp'), 'good');
          break;
        case 'heroLevel':
          this.sound('success', 0);
          this.haptic('success');
          this.note(t('heroLevelUp', { n: ev.level }), 'good');
          break;
        case 'heroHurt':
          this.flash(this.heroBtn, 'td-hurt');
          break;
        case 'heroMove':
          this.sound('move');
          break;
        case 'abilityCast':
          this.sound('swoosh', 0);
          this.haptic('medium');
          break;
        case 'abilityImpact':
          if (ev.ability === 'antibiotic') {
            this.sound('explosion', 0);
            this.haptic('heavy');
          }
          break;
        case 'barrierBroken':
        case 'barrierSmashed':
          this.sound('explosion');
          this.haptic('medium');
          if (this.panelTower === ev.tower) this.closeSheet();
          buildable = true;
          break;
        case 'bossSkill':
          if (ev.stage === 'telegraph') this.sound('tick', 300);
          break;
        case 'flowReverse':
          if (ev.reversed) this.sound('swoosh', 0);
          break;
        case 'flowWarn':
          this.sound('tick', 400);
          break;
        default:
          break;
      }
    }
    if (panelDirty) this.refreshSheet(true);
    if (buildable || panelDirty) this.updateBuildable();
  }

  private onWaveStart(wave: number, boss: BossId | null): void {
    const s = this.s;
    this.updateStatus();
    if (boss) {
      this.sound('explosion', 0);
      this.haptic('heavy', true);
      // the toast waits for the renderer's wave banner to finish (its own clock, whatever the game speed / frame rate)
      this.pendingBoss = { boss, wave, at: this.realTime + BANNER_MIN_S };
      if (this.fast) this.flushBossTip();
    } else this.sound('swoosh', 0);
    // best wave reached (bestEndless = highest wave started, §7.4) — written as soon as it improves
    const m = this.host.memory();
    if (wave > m.bestEndless[s.mapId][s.difficulty]) {
      this.host.setMemory({
        ...m,
        bestEndless: { ...m.bestEndless, [s.mapId]: { ...m.bestEndless[s.mapId], [s.difficulty]: wave } },
      });
    }
    if (this.previewOpen) this.renderPreview();
  }

  private flushBossTip(): void {
    const p = this.pendingBoss;
    if (!p) return;
    this.pendingBoss = null;
    const t = this.t;
    this.showTip({ kind: 'boss', icon: BOSS_ICON[p.boss], title: t('bossIncoming', { name: t('enemy_' + p.boss) }), text: t('bossTip_' + p.boss), ms: TIP_MS });
    this.tutorial('tut_boss');
    if (p.boss === 'virusKing' || (p.wave === WAVES_PER_MAP && !this.s.endless)) this.tutorial('tut_mutation');
  }

  private finishRun(kind: 'cleared' | 'over'): void {
    const s = this.s;
    const t = this.t;
    const ctx = this.ctx;
    this.cancelModes();
    this.closeSheet();
    this.host.writeRun(null);
    // endless after a clear is the same run: recordRun subtracts what the clear recorded (kept in the run save)
    const res = recordRun(this.host.memory(), s);
    noteRecorded(s);
    this.host.setMemory(res.memory);
    const mapName = t('map_' + s.mapId);
    const diffName = t(s.difficulty === 'hard' ? 'hard' : 'normal');
    this.modalOpen = true;
    if (kind === 'cleared') {
      ctx.play('win');
      this.haptic('success', true);
      const stars = el('div', { class: 'td-endstars' });
      for (let i = 0; i < 3; i++) stars.append(el('span', { class: 'td-endstar' + (i < s.stars ? ' on' : ''), style: { animationDelay: `${0.15 + i * 0.25}s` }, text: i < s.stars ? '★' : '☆' }));
      const body = el(
        'div',
        { class: 'td-endbody' },
        stars,
        el('p', { text: t('clearedBody', { map: mapName, diff: diffName }) }),
        el('p', { class: 'muted', text: `${t('vitLost', { n: s.stats.vitLost })} · ${t('kills', { n: s.stats.kills })}` }),
        res.newStars ? el('p', { class: 'td-newbest', text: t('newStars') }) : null,
        el('p', { class: 'muted small', text: t('endlessHint') }),
      );
      ctx.showModal({
        title: t('clearedTitle', { map: mapName }),
        body,
        dismissible: false,
        buttons: [
          { label: t('home'), onClick: () => this.leave(() => ctx.exit()) },
          { label: t('newGameBtn'), onClick: () => this.leave(() => this.host.toStart()) },
          {
            label: t('continueEndless'),
            primary: true,
            onClick: () => {
              this.modalOpen = false;
              continueEndless(this.s);
              this.updateStatus();
              this.updateHud(true);
              this.updateBuildable();
              this.saveIfAllowed();
            },
          },
        ],
      });
    } else {
      ctx.play('lose');
      this.haptic('error', true);
      const newEndless = s.wave > this.bestAtStart;
      const body = el(
        'div',
        { class: 'td-endbody' },
        el('p', { text: t('overBody', { map: mapName, diff: diffName, n: s.wave }) }),
        el('p', { class: 'muted', text: `${t('vitLost', { n: s.stats.vitLost })} · ${t('kills', { n: s.stats.kills })}` }),
        newEndless ? el('p', { class: 'td-newbest', text: t('newEndless', { n: s.wave }) }) : null,
      );
      ctx.showModal({
        title: t('overTitle'),
        body,
        dismissible: false,
        buttons: [
          { label: t('home'), onClick: () => this.leave(() => ctx.exit()) },
          { label: t('newGameBtn'), onClick: () => this.leave(() => this.host.toStart()) },
          { label: t('retry'), primary: true, onClick: () => this.leave(() => this.host.newRun(s.mapId, s.difficulty)) },
        ],
      });
    }
    this.updateHud(true);
  }

  /** Leaves the screen without saving this run again (it ended or is being abandoned). */
  private leave(fn: () => void): void {
    this.discard = true;
    this.modalOpen = false;
    fn();
  }

  // ── sound / haptics / notes / tips ────────────────────────────────────────

  private sound(name: SoundName, gap?: number): void {
    if (this.fast) return;
    const now = performance.now();
    const g = gap ?? SOUND_GAP[name] ?? 120;
    const last = this.lastSound[name] ?? -1e9;
    if (now - last < g) return;
    this.lastSound[name] = now;
    this.ctx.play(name);
  }

  private haptic(kind: HapticName, force = false): void {
    if (this.fast) return;
    const now = performance.now();
    if (!force && now - this.lastHaptic < 250) return;
    this.lastHaptic = now;
    this.ctx.haptic(kind);
  }

  private flash(elm: HTMLElement, cls: string): void {
    elm.classList.remove(cls);
    void elm.offsetWidth;
    elm.classList.add(cls);
  }

  /** Short pill notice (wave clear, denied reasons, hero status). */
  private note(text: string, tone: 'good' | 'warn' | 'info' = 'info'): void {
    if (this.fast) return;
    const last = this.notesEl.lastElementChild as HTMLElement | null;
    if (last && last.textContent === text) {
      last.classList.remove('td-note-in');
      void last.offsetWidth;
      last.classList.add('td-note-in');
      return;
    }
    const n = el('div', { class: `td-note td-note-in ${tone}`, text });
    this.notesEl.append(n);
    while (this.notesEl.children.length > 3) this.notesEl.firstElementChild?.remove();
    // live timers only (cleared in destroy): one entry per visible note, not one cleanup per note for the whole run
    const timer = window.setTimeout(() => {
      this.noteTimers.delete(timer);
      n.classList.add('td-note-out');
      const t2 = window.setTimeout(() => {
        this.noteTimers.delete(t2);
        n.remove();
      }, 260);
      this.noteTimers.add(t2);
    }, 2200);
    this.noteTimers.add(timer);
  }

  private tutorial(id: TutorialId): void {
    const m = this.host.memory();
    if (m.tutorialSeen.includes(id)) return;
    if (this.tipQueue.some((x) => x.id === id) || this.tipCur?.tip.id === id) return;
    this.showTip({ kind: 'tut', id, icon: '💡', text: this.t(id), ms: TIP_MS });
  }

  private showTip(tip: Tip): void {
    if (this.fast && tip.kind !== 'boss') {
      if (tip.kind === 'tut' && tip.id) this.markTutorial(tip.id);
      return;
    }
    const cur = this.tipCur;
    if (tip.kind === 'boss') {
      this.tipQueue.unshift(tip);
      if (cur && cur.tip.kind !== 'boss') {
        // a tutorial interrupted early comes back after the boss toast
        if (cur.tip.kind === 'tut' && performance.now() - cur.at < 2000) this.tipQueue.splice(1, 0, cur.tip);
        this.dismissTip(true);
      }
    } else if (tip.kind === 'info') {
      if (cur && cur.tip.kind === 'info') this.dismissTip(true);
      this.tipQueue.unshift(tip);
    } else this.tipQueue.push(tip);
    this.pumpTips();
  }

  private pumpTips(): void {
    if (this.tipCur || this.destroyed) return;
    const tip = this.tipQueue.shift();
    if (!tip) return;
    // The card lets taps through to the map (it may cover pads the tip talks about); its ✕ dismisses it.
    const x = el('button', { class: 'td-tip-x', type: 'button', text: '✕', 'aria-label': this.t('tapToDismiss') });
    x.addEventListener('click', () => this.dismissTip());
    const card = el(
      'div',
      { class: `td-tip ${tip.kind}`, role: 'status' },
      tip.icon ? el('span', { class: 'td-tip-icon', text: tip.icon }) : null,
      el('div', { class: 'td-tip-body' }, tip.title ? el('div', { class: 'td-tip-title', text: tip.title }) : null, el('div', { class: 'td-tip-text', text: tip.text })),
      x,
    );
    this.tipsEl.append(card);
    if (tip.kind === 'tut' && tip.id) this.markTutorial(tip.id);
    const timer = window.setTimeout(() => this.dismissTip(), tip.ms);
    this.tipCur = { tip, el: card, timer, at: performance.now() };
  }

  private markTutorial(id: TutorialId): void {
    const m = this.host.memory();
    if (!m.tutorialSeen.includes(id)) this.host.setMemory({ ...m, tutorialSeen: [...m.tutorialSeen, id] });
  }

  private dismissTip(silent = false): void {
    const cur = this.tipCur;
    if (!cur) return;
    clearTimeout(cur.timer);
    this.tipCur = null;
    const elm = cur.el;
    elm.classList.add('out');
    window.setTimeout(() => elm.remove(), 220);
    if (!silent) window.setTimeout(() => this.pumpTips(), 240);
  }

  // ── HUD / bottom bar ──────────────────────────────────────────────────────

  private preview(wave: number): WavePreview {
    const c = this.pvCache;
    if (c && c.wave === wave && c.map === this.s.mapId) return c.pv;
    const pv = wavePreview(this.s.mapId, wave);
    this.pvCache = { map: this.s.mapId, wave, pv };
    return pv;
  }

  private nextWave(): number | null {
    const s = this.s;
    if (s.phase === 'over') return null;
    if (!s.endless && s.wave >= WAVES_PER_MAP) return null;
    return s.wave + 1;
  }

  private updateStatus(): void {
    const s = this.s;
    const t = this.t;
    const w = Math.max(1, s.wave);
    const waveTxt = s.endless || s.wave > WAVES_PER_MAP ? t('hudWaveEndless', { n: w }) : t('hudWave', { n: w, max: WAVES_PER_MAP });
    const txt = `${t('map_' + s.mapId)} · ${t(s.difficulty === 'hard' ? 'hard' : 'normal')} · ${waveTxt}`;
    if (txt !== this.lastStatus) {
      this.lastStatus = txt;
      this.ctx.setStatus(txt);
    }
  }

  /**
   * Per-frame HUD / bottom-bar refresh. Every element compares plain numbers first and only formats a string (and
   * touches the DOM) when what it shows changed, so a steady frame allocates nothing here.
   */
  private updateHud(force: boolean): void {
    const hs = this.hudSig;
    if (force) {
      hs.wave = hs.endless = hs.vit = hs.maxVit = hs.atp = hs.speed = -1;
      this.chipsSig.wave = -2;
      this.waveSig.phase = '';
      this.abSig.frac.fill(-1);
      this.portraitSig.key = -1;
      this.hudCache = {};
    }
    const s = this.s;
    const t = this.t;
    const w = Math.max(1, s.wave);
    const endless = s.endless || s.wave > WAVES_PER_MAP ? 1 : 0;
    if (w !== hs.wave || endless !== hs.endless) {
      hs.wave = w;
      hs.endless = endless;
      this.hudWaveText.textContent = endless ? t('hudWaveEndless', { n: w }) : t('hudWave', { n: w, max: WAVES_PER_MAP });
    }
    const vit = Math.max(0, Math.ceil(s.vitality));
    if (vit !== hs.vit || s.maxVitality !== hs.maxVit) {
      hs.vit = vit;
      hs.maxVit = s.maxVitality;
      this.hudVitVal.textContent = `${vit}/${s.maxVitality}`;
      this.hudVit.classList.toggle('low', s.vitality <= s.maxVitality * 0.3);
    }
    const atp = Math.floor(s.atp);
    if (atp !== hs.atp) {
      hs.atp = atp;
      this.hudAtpVal.textContent = String(atp);
    }
    this.renderChips();
    this.updateWaveButton();
    this.updateAbilities();
    this.updatePortrait();
    if (this.speed !== hs.speed) {
      hs.speed = this.speed;
      this.speedBtn.textContent = t('speedX', { n: this.speed });
      this.speedBtn.classList.toggle('on', this.speed !== 1);
    }
    if (this.pendingBoss && this.realTime >= this.pendingBoss.at && !this.r?.bannerShowing) this.flushBossTip();
    // live panel refresh (affordability, infection timers) at ~4 Hz
    const now = performance.now();
    if (now - this.lastPanelRefresh > 250) {
      this.lastPanelRefresh = now;
      this.refreshSheet(false);
      if (this.aim) this.updateAimHint();
      // countdown ticks for the last 3 seconds
      if (s.phase === 'countdown') {
        const c = Math.ceil(s.countdown);
        if (c <= 3 && c >= 1 && c !== this.lastCountdownTick) {
          this.lastCountdownTick = c;
          this.sound('tick', 0);
        }
      } else this.lastCountdownTick = -1;
    }
  }

  private renderChips(): void {
    const s = this.s;
    const nw = this.nextWave();
    const inWave = s.phase === 'wave';
    const cs = this.chipsSig;
    if ((nw ?? -1) === cs.wave && inWave === cs.inWave) return;
    cs.wave = nw ?? -1;
    cs.inWave = inWave;
    this.hudChips.innerHTML = '';
    this.hudNext.hidden = nw === null;
    if (nw === null) return;
    const pv = this.preview(nw);
    if (pv.boss) this.hudChips.append(el('span', { class: 'td-chip boss', title: this.t('enemy_' + pv.boss) }, BOSS_ICON[pv.boss]));
    const groups = pv.groups;
    const shown = groups.slice(0, pv.boss ? 3 : 4);
    for (const g of shown) this.hudChips.append(el('span', { class: 'td-chip', title: this.t('enemy_' + g.type) }, ENEMY_ICON[g.type], el('b', { text: String(g.count) })));
    if (groups.length > shown.length) this.hudChips.append(el('span', { class: 'td-chip more', text: `+${groups.length - shown.length}` }));
  }

  private updateWaveButton(): void {
    const s = this.s;
    const t = this.t;
    const nw = this.nextWave();
    // cheap numeric signature first: the strings below are only built when something visible changed
    const ws = this.waveSig;
    const cd = s.phase === 'countdown' ? Math.ceil(s.countdown) : 0;
    const bonus = s.phase === 'countdown' ? earlyBonus(s.wave + 1, s.countdown, s.difficulty) : 0;
    const left = s.phase === 'wave' ? s.waveState.queue.length + s.enemies.length : 0;
    if (ws.phase === s.phase && ws.wave === s.wave && ws.next === (nw ?? -1) && ws.cd === cd && ws.bonus === bonus && ws.left === left && ws.modal === this.modalOpen) return;
    ws.phase = s.phase;
    ws.wave = s.wave;
    ws.next = nw ?? -1;
    ws.cd = cd;
    ws.bonus = bonus;
    ws.left = left;
    ws.modal = this.modalOpen;
    let main = '';
    let sub = '';
    let glyphs = '';
    let disabled = false;
    let mode = s.phase as string;
    const pv = nw !== null && (s.phase === 'build' || s.phase === 'countdown') ? this.preview(nw) : null;
    let glyphTitle = '';
    if (pv) {
      const g: [boolean, string, string][] = [
        [pv.boss !== null, '☠️', 'gBoss'],
        [pv.flying, '☁️', 'gFlying'],
        [pv.stealth, '👻', 'gStealth'],
        [pv.virus, '☣️', 'gVirus'],
      ];
      for (const [on, glyph, key] of g) {
        if (!on) continue;
        glyphs += glyph;
        glyphTitle += (glyphTitle ? ' · ' : '') + t(key);
      }
    }
    switch (s.phase) {
      case 'build':
        main = '▶ ' + t('startWave', { n: s.wave + 1 });
        break;
      case 'countdown':
        main = '⏩ ' + t('callEarly', { bonus });
        sub = t('countdownSec', { s: cd });
        break;
      case 'wave':
        main = t('waveInProgress', { n: s.wave, left });
        disabled = true;
        break;
      case 'cleared':
        main = '∞ ' + t('continueEndless');
        disabled = this.modalOpen;
        break;
      case 'over':
        main = t('runOver');
        disabled = true;
        mode = 'over';
        break;
    }
    this.waveMain.textContent = main;
    this.waveSub.textContent = sub;
    this.waveSub.hidden = !sub;
    this.waveGlyphs.textContent = glyphs;
    this.waveGlyphs.title = glyphTitle;
    this.waveBtn.setAttribute('aria-label', glyphTitle ? `${main} · ${glyphTitle}` : main);
    this.waveBtn.disabled = disabled;
    this.waveBtn.dataset.mode = mode;
  }

  private updateAbilities(): void {
    const s = this.s;
    const now = s.time;
    const usable = s.phase === 'build' || s.phase === 'countdown' || s.phase === 'wave';
    const sig = this.abSig;
    for (let i = 0; i < ABILITY_IDS.length; i++) {
      const id = ABILITY_IDS[i];
      const ref = this.abBtns[id];
      if (!ref) continue;
      const a = s.abilities[id];
      if (ref.btn.hidden === a.unlocked) ref.btn.hidden = !a.unlocked;
      if (!a.unlocked) continue;
      const rem = Math.max(0, a.readyAt - now);
      const frac = a.cooldown > 0 ? Math.min(1, rem / a.cooldown) : 0;
      const fq = Math.round(frac * 200);
      const active = a.activeUntil > now;
      const secs = Math.ceil(rem);
      const aiming = this.aim !== null && id === 'antibiotic';
      if (sig.frac[i] === fq && sig.secs[i] === secs && sig.flags[i] === (active ? 1 : 0) + (usable ? 2 : 0) + (aiming ? 4 : 0)) continue;
      const wasCooling = sig.frac[i] > 0;
      sig.frac[i] = fq;
      sig.secs[i] = secs;
      sig.flags[i] = (active ? 1 : 0) + (usable ? 2 : 0) + (aiming ? 4 : 0);
      ref.btn.style.setProperty('--cd', (fq / 200).toFixed(3));
      ref.cd.textContent = rem > 0 ? String(secs) : '';
      ref.btn.classList.toggle('cooling', rem > 0);
      ref.btn.classList.toggle('active', active);
      ref.btn.classList.toggle('unusable', !usable);
      ref.btn.classList.toggle('aiming', aiming);
      if (rem === 0 && wasCooling) this.flash(ref.btn, 'td-ready');
    }
  }

  private updatePortrait(): void {
    const h = this.s.hero;
    const frac = h.maxHp > 0 ? Math.max(0, Math.min(1, h.hp / h.maxHp)) : 0;
    const resp = h.alive ? 0 : Math.max(0, Math.ceil(h.respawnAt - this.s.time));
    const moving = this.interaction === 'heroMove';
    // one integer: hp (0..50) · level · alive · respawn seconds · move mode
    const key = Math.round(frac * 50) + 64 * (h.level + 4 * ((h.alive ? 1 : 0) + 2 * ((moving ? 1 : 0) + 2 * resp)));
    const ps = this.portraitSig;
    if (ps.key === key) return;
    ps.key = key;
    this.heroHp.style.width = `${Math.round(frac * 100)}%`;
    this.heroHp.classList.toggle('low', frac < 0.35);
    if (ps.level !== h.level) {
      ps.level = h.level;
      this.heroLv.textContent = this.t('heroLv', { n: h.level });
    }
    this.heroBtn.classList.toggle('dead', !h.alive);
    this.heroBtn.classList.toggle('moving', moving);
    this.heroResp.textContent = h.alive ? '' : String(resp);
  }

  private onWaveButton(): void {
    const s = this.s;
    this.cancelModes();
    if (s.phase === 'build') {
      startWave(s, false);
      this.ctx.play('tap');
    } else if (s.phase === 'countdown') {
      startWave(s, true);
    } else if (s.phase === 'cleared' && !this.modalOpen) {
      continueEndless(s);
      this.updateStatus();
      this.updateBuildable();
    }
    this.updateHud(false);
    this.drawOnce();
  }

  private toggleSpeed(): void {
    this.cancelModes();
    this.speed = this.speed === 1 ? 2 : 1;
    this.ctx.play('tap');
    const m = this.host.memory();
    this.host.setMemory({ ...m, prefs: { ...m.prefs, speed: this.speed === 2 ? 2 : 1 } });
    this.updateHud(false);
  }

  // ── wave preview popover ──────────────────────────────────────────────────

  private togglePreview(): void {
    this.ctx.play('tap');
    this.previewOpen = !this.previewOpen;
    if (this.previewOpen) this.renderPreview();
    this.previewEl.hidden = !this.previewOpen;
  }

  private renderPreview(): void {
    const t = this.t;
    const nw = this.nextWave();
    const pe = this.previewEl;
    pe.innerHTML = '';
    if (nw === null) {
      this.previewOpen = false;
      pe.hidden = true;
      return;
    }
    const pv = this.preview(nw);
    pe.append(el('div', { class: 'td-preview-title' }, el('span', { text: t('previewTitle', { n: nw }) }), el('span', { class: 'td-preview-x', text: '✕' })));
    const list = el('div', { class: 'td-preview-list' });
    const bosses = [pv.boss, pv.boss2].filter((b): b is BossId => !!b);
    for (const b of bosses) {
      list.append(
        el(
          'div',
          { class: 'td-preview-row boss' },
          el('span', { class: 'td-preview-ico', text: BOSS_ICON[b] }),
          el('div', {}, el('div', { class: 'td-preview-name', text: `${t('enemy_' + b)} · ${t('previewBoss')}` }), el('div', { class: 'td-preview-desc', text: t('enemyDesc_' + b) })),
        ),
      );
    }
    for (const g of pv.groups) {
      list.append(
        el(
          'div',
          { class: 'td-preview-row' },
          el('span', { class: 'td-preview-ico', text: ENEMY_ICON[g.type] }),
          el('div', {}, el('div', { class: 'td-preview-name', text: `${t('enemy_' + g.type)} ×${g.count}` }), el('div', { class: 'td-preview-desc', text: t('enemyDesc_' + g.type) })),
        ),
      );
    }
    pe.append(list);
    pe.onclick = () => {
      this.previewOpen = false;
      pe.hidden = true;
    };
  }

  // ── renderer insets / buildable highlights ────────────────────────────────

  private sideSheet(): boolean {
    return window.matchMedia('(orientation: landscape) and (max-height: 560px)').matches;
  }

  private updateInsets(refit: boolean): void {
    if (this.destroyed) return;
    const st = this.stage.getBoundingClientRect();
    if (st.height < 2) return;
    const hud = this.hud.getBoundingClientRect();
    const bar = this.bar.getBoundingClientRect();
    const top = Math.max(0, Math.round(hud.bottom - st.top));
    const bottom = Math.max(0, Math.round(st.bottom - bar.top));
    this.gameEl.style.setProperty('--td-hud-h', `${top}px`);
    this.gameEl.style.setProperty('--td-bar-h', `${bottom}px`);
    let sheet = 0;
    if (!this.sheetEl.hidden && !this.sideSheet()) sheet = Math.round(this.sheetEl.getBoundingClientRect().height) + 6;
    this.updateDock(sheet);
    this.r?.setInsets(top, bottom + sheet, refit);
  }

  /** Height of what is docked above the bottom bar (sheet or move / aim hint): tips sit just above it. */
  private updateDock(sheet = -1): void {
    let h = sheet;
    if (h < 0) h = !this.sheetEl.hidden && !this.sideSheet() ? Math.round(this.sheetEl.getBoundingClientRect().height) + 6 : 0;
    if (!this.hintEl.hidden) h = Math.max(h, Math.round(this.hintEl.getBoundingClientRect().height) + 8);
    this.gameEl.style.setProperty('--td-dock-h', `${h}px`);
  }

  private updateBuildable(): void {
    const r = this.r;
    if (!r) return;
    const s = this.s;
    if (s.phase === 'build' && s.towers.length === 0) {
      const cells: [number, number][] = [];
      for (const [c, rr] of s.map.pads) cells.push([c, rr]);
      for (const [c, rr] of s.map.villi) cells.push([c, rr]);
      r.showBuildable(cells);
    } else r.showBuildable(null);
    this.updateRisk();
  }

  /**
   * §5.3: while a virus wave is previewed (build / countdown), pads next to the vessel get a biohazard glyph — empty
   * ones and those holding a tower that can still be infected (not beacon-immune).
   */
  private updateRisk(): void {
    const r = this.r;
    if (!r) return;
    const s = this.s;
    const nw = this.nextWave();
    const pv = nw !== null && (s.phase === 'build' || s.phase === 'countdown') ? this.preview(nw) : null;
    if (!pv || !pv.virus) {
      r.showRisk(null);
      return;
    }
    const cells = virusRiskPads(s.map).filter(([c, rr]) => {
      const tw = towerAt(s, c, rr);
      return !tw || (TOWERS[tw.type].canBeInfected && !tw.buff.immune);
    });
    r.showRisk(cells);
  }

  // ── tap routing (§11.2) ───────────────────────────────────────────────────

  private onTap(hit: TapHit): void {
    if (this.destroyed || this.paused || this.lost || !this.r) return;
    if (this.previewOpen) {
      this.previewOpen = false;
      this.previewEl.hidden = true;
    }
    if (this.interaction === 'abilityTarget') {
      if (this.aim && this.aim.mode === 'tap') {
        const p = { x: NaN, y: NaN };
        if (this.r.floorPoint(hit.sx, hit.sy, p)) {
          this.cursor.x = p.x;
          this.cursor.y = p.y;
          this.ctx.play('tap');
          this.updateAimHint();
        }
      }
      return;
    }
    if (this.interaction === 'heroMove') {
      this.moveHeroTo(hit);
      return;
    }
    const s = this.s;
    switch (hit.kind) {
      case 'hero':
        this.closeSheet();
        this.enterMove();
        break;
      case 'tower':
        if (this.panelTower === hit.id && !this.specOpen) this.closeSheet();
        else this.openTower(hit.id);
        break;
      case 'pad': {
        const tw = towerAt(s, hit.col, hit.row);
        if (tw) this.openTower(tw.id);
        else if (this.buildAt && this.buildAt.col === hit.col && this.buildAt.row === hit.row) this.closeSheet();
        else this.openBuild(hit.col, hit.row, 'pad');
        break;
      }
      case 'path': {
        const tw = towerAt(s, hit.col, hit.row);
        if (tw) this.openTower(tw.id);
        else this.openBuild(hit.col, hit.row, 'path');
        break;
      }
      case 'enemy':
        if (hit.pathCell && hit.col >= 0) {
          const tw = towerAt(s, hit.col, hit.row);
          if (tw) this.openTower(tw.id);
          else this.openBuild(hit.col, hit.row, 'path');
        } else this.showEnemyInfo(hit.id);
        break;
      default:
        this.closeSheet();
        break;
    }
  }

  private showEnemyInfo(id: number): void {
    const e = findEnemy(this.s, id);
    if (!e) return;
    const t = this.t;
    let title = `${t('enemy_' + e.type)} · ${Math.ceil(e.hp)}/${Math.ceil(e.maxHp)}`;
    if (e.boss && e.boss.immuneTo && e.boss.immuneUntil > this.s.time) title += ` · ${t('immune')}: ${t('tower_' + e.boss.immuneTo)}`;
    this.showTip({ kind: 'info', icon: ENEMY_ICON[e.type], title, text: t('enemyDesc_' + e.type), ms: 3500 });
  }

  // ── hero move mode (§6) ───────────────────────────────────────────────────

  private enterMove(): void {
    if (!this.s.hero.alive) {
      this.note(this.t('denied_heroDead'), 'warn');
      this.sound('error');
      return;
    }
    this.cancelAim();
    this.interaction = 'heroMove';
    this.sel = { kind: 'hero' };
    this.showHint(this.t('moveHint'), false);
    this.ctx.play('tap');
    this.ctx.haptic('light');
    this.updatePortrait();
    this.drawOnce();
  }

  private exitMove(): void {
    if (this.interaction !== 'heroMove') return;
    this.interaction = 'none';
    if (this.sel && this.sel.kind === 'hero') this.sel = null;
    this.hideHint();
    this.updatePortrait();
  }

  private moveHeroTo(hit: TapHit): void {
    const s = this.s;
    let x = hit.x;
    let y = hit.y;
    if (hit.kind === 'hero') {
      this.exitMove();
      return;
    }
    if (hit.kind === 'tower') {
      const tw = findTower(s, hit.id);
      if (tw) {
        x = tw.x;
        y = tw.y;
      }
    } else if (hit.kind === 'pad' || hit.kind === 'path') {
      x = hit.col + 0.5;
      y = hit.row + 0.5;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    moveHero(s, x, y);
    this.exitMove();
  }

  private bindHeroButton(): void {
    const btn = this.heroBtn;
    btn.addEventListener('pointerdown', (e) => {
      if (this.paused) return;
      this.heroDrag = { pid: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic */
      }
    });
    btn.addEventListener('pointermove', (e) => {
      const d = this.heroDrag;
      if (!d || d.pid !== e.pointerId) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 12) {
        d.moved = true;
        if (this.s.hero.alive) {
          this.cancelAim();
          this.interaction = 'heroMove';
          this.sel = { kind: 'hero' };
          this.showHint(this.t('moveHint'), false);
        }
      }
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      const d = this.heroDrag;
      if (!d || d.pid !== e.pointerId) return;
      this.heroDrag = null;
      if (cancelled) return;
      if (!d.moved) {
        // tap: toggle move mode (canonical entry, §6)
        if (this.interaction === 'heroMove') {
          this.exitMove();
          this.ctx.play('tap');
        } else {
          this.closeSheet();
          this.enterMove();
        }
        return;
      }
      // drag from the portrait onto the map = one-gesture move
      const p = this.screenToFloor(e.clientX, e.clientY);
      if (p && this.interaction === 'heroMove') moveHero(this.s, p.x, p.y);
      this.exitMove();
    };
    btn.addEventListener('pointerup', (e) => end(e, false));
    btn.addEventListener('pointercancel', (e) => end(e, true));
  }

  /** Client point → floor point when it lies over the visible map strip (not over the HUD / bar). */
  private screenToFloor(clientX: number, clientY: number): Point | null {
    const r = this.r;
    if (!r) return null;
    const st = this.stage.getBoundingClientRect();
    const hud = this.hud.getBoundingClientRect();
    const bar = this.bar.getBoundingClientRect();
    if (clientY >= bar.top || clientY <= hud.bottom || clientX < st.left || clientX > st.right) return null;
    const p = { x: NaN, y: NaN };
    if (!r.floorPoint(clientX - st.left, clientY - st.top, p)) return null;
    const m = this.s.map;
    if (p.x < -0.5 || p.y < -0.5 || p.x > m.cols + 0.5 || p.y > m.rows + 0.5) return null;
    return p;
  }

  // ── abilities (§6.1) ──────────────────────────────────────────────────────

  private bindAbilityButton(id: AbilityId, btn: HTMLElement): void {
    btn.addEventListener('pointerdown', (e) => {
      if (this.paused) return;
      this.longPressFired = false;
      clearTimeout(this.longPress);
      this.longPress = window.setTimeout(() => {
        this.longPressFired = true;
        if (this.aim && !this.aim.moved) this.cancelAim();
        this.showAbilityInfo(id);
      }, LONG_PRESS_MS);
      if (this.interaction === 'heroMove') this.exitMove();
      if (id === 'antibiotic') {
        if (this.aim && this.aim.mode === 'tap') {
          // second press while tap-aiming cancels
          this.cancelAim();
          this.longPressFired = true;
          return;
        }
        this.startAim(e, btn);
      }
    });
    btn.addEventListener('pointermove', (e) => {
      const a = this.aim;
      if (id !== 'antibiotic' || !a || a.mode !== 'drag' || a.pid !== e.pointerId) return;
      if (!a.moved && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) > 10) {
        a.moved = true;
        clearTimeout(this.longPress);
      }
      if (a.moved) this.aimAt(e.clientX, e.clientY);
    });
    btn.addEventListener('pointerup', (e) => {
      clearTimeout(this.longPress);
      if (this.longPressFired) return;
      if (id === 'antibiotic') {
        const a = this.aim;
        if (!a || a.pid !== e.pointerId || a.mode !== 'drag') return;
        if (!a.moved) {
          // tap fallback: tap the map, then Confirm
          a.mode = 'tap';
          this.showHint(this.t('aimTapHint'), true);
          this.updateAimHint();
          return;
        }
        // decided from the raw finger point: released back on the button / the bar, or off the map → cancel (§6.1)
        this.aimAt(e.clientX, e.clientY);
        if (Number.isFinite(this.cursor.x)) this.confirmAim();
        else this.cancelAim();
        return;
      }
      this.cast(id);
    });
    btn.addEventListener('pointercancel', () => {
      clearTimeout(this.longPress);
      if (id === 'antibiotic' && this.aim && this.aim.mode === 'drag') this.cancelAim();
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    // keyboard activation (Enter / Space fire a click with detail 0): cast, or tap-aim for the Antibiotic
    btn.addEventListener('click', (e) => {
      if (e.detail !== 0 || this.paused) return;
      if (id !== 'antibiotic') {
        this.cast(id);
        return;
      }
      if (this.aim) {
        this.cancelAim();
        return;
      }
      const a = this.s.abilities.antibiotic;
      if (a.readyAt > this.s.time + 1e-9) {
        castAbility(this.s, 'antibiotic');
        return;
      }
      this.closeSheet();
      this.aim = { mode: 'tap', pid: -1, x0: 0, y0: 0, moved: false, btn: null };
      this.interaction = 'abilityTarget';
      this.showHint(this.t('aimTapHint'), true);
      this.updateAimHint();
    });
  }

  private cast(id: AbilityId): void {
    const res = castAbility(this.s, id);
    if (!res.ok) return;
    this.updateAbilities();
  }

  private showAbilityInfo(id: AbilityId): void {
    const t = this.t;
    const dmg = Math.round(abilityDamage(id, Math.max(1, this.s.wave)));
    const cd = Math.round(this.s.abilities[id].cooldown);
    this.showTip({ kind: 'info', icon: ABILITY_ICON[id], title: `${t('ability_' + id)} · ${cd}s`, text: t('abilityDesc_' + id, { dmg }), ms: 5000 });
    this.haptic('light');
  }

  private startAim(e: PointerEvent, btn: HTMLElement): void {
    const s = this.s;
    const a = s.abilities.antibiotic;
    if (!a.unlocked || a.readyAt > s.time + 1e-9 || (s.phase !== 'build' && s.phase !== 'countdown' && s.phase !== 'wave')) {
      castAbility(s, 'antibiotic'); // emits the matching `denied` (cooldown / phase / locked)
      this.longPressFired = true;
      clearTimeout(this.longPress);
      return;
    }
    this.closeSheet();
    this.aim = { mode: 'drag', pid: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, btn };
    this.interaction = 'abilityTarget';
    this.cursor.x = NaN;
    this.cursor.y = NaN;
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic */
    }
    this.showHint(this.t('aimHint'), false);
    this.updateAimHint();
    this.updateAbilities();
  }

  /** Moves the drag-aim crosshair for a finger at (clientX, clientY): lifted AIM_LIFT px, NaN when a release cancels. */
  private aimAt(clientX: number, clientY: number): void {
    const g = this.aimGeo;
    copyBox(g.bar, this.bar.getBoundingClientRect());
    copyBox(g.stage, this.stage.getBoundingClientRect());
    g.hudBottom = this.hud.getBoundingClientRect().bottom;
    const btn = this.aim?.btn ?? this.abBtns.antibiotic?.btn ?? null;
    if (btn) copyBox(g.button, btn.getBoundingClientRect());
    else copyBox(g.button, { left: NaN, top: NaN, right: NaN, bottom: NaN });
    const p = aimTarget(clientX, clientY, g, this.aimPt) ? this.screenToFloor(this.aimPt.x, this.aimPt.y) : null;
    if (p) {
      this.cursor.x = Math.max(0, Math.min(this.s.map.cols, p.x));
      this.cursor.y = Math.max(0, Math.min(this.s.map.rows, p.y));
    } else {
      this.cursor.x = NaN;
      this.cursor.y = NaN;
    }
    this.updateAimHint();
  }

  private updateAimHint(): void {
    if (!this.aim) return;
    const t = this.t;
    const r = ABILITIES.antibiotic.radius ?? 1.5;
    let n = 0;
    const cx = this.cursor.x;
    const cy = this.cursor.y;
    if (Number.isFinite(cx)) {
      for (const e of this.s.enemies) {
        if (e.dead || e.leaked) continue;
        const dx = e.x - cx;
        const dy = e.y - cy;
        if (dx * dx + dy * dy <= r * r) n++;
      }
    }
    const dmg = Math.round(abilityDamage('antibiotic', Math.max(1, this.s.wave)));
    const base = this.aim.mode === 'tap' ? t('aimTapHint') : this.aim.moved ? t('aimCancelHint') : t('aimHint');
    this.hintText.textContent = Number.isFinite(cx) ? t('aimInfo', { dmg, inside: t('inside', { n }) }) : `${base} · 💊 ${dmg}`;
    this.hintConfirm.disabled = !Number.isFinite(cx);
  }

  private confirmAim(): void {
    if (!this.aim || !Number.isFinite(this.cursor.x)) return;
    const p = { x: this.cursor.x, y: this.cursor.y };
    this.cancelAim();
    castAbility(this.s, 'antibiotic', p);
    this.updateAbilities();
  }

  private cancelAim(): void {
    if (!this.aim && this.interaction !== 'abilityTarget') return;
    this.aim = null;
    if (this.interaction === 'abilityTarget') this.interaction = 'none';
    this.cursor.x = NaN;
    this.cursor.y = NaN;
    this.hideHint();
    this.updateAbilities();
  }

  /** Cancels move / aim modes (bottom-bar buttons, hint Cancel). */
  private cancelModes(): void {
    this.cancelAim();
    this.exitMove();
  }

  private showHint(text: string, confirm: boolean): void {
    this.hintText.textContent = text;
    this.hintConfirm.hidden = !confirm;
    (this.hintCancel.querySelector('span:last-child') as HTMLElement).textContent = this.t(this.interaction === 'heroMove' ? 'cancelMove' : 'cancel');
    const was = this.hintEl.hidden;
    this.hintEl.hidden = false;
    if (was) this.updateDock();
  }

  private hideHint(): void {
    if (this.hintEl.hidden) return;
    this.hintEl.hidden = true;
    this.updateDock();
  }

  // ── bottom sheet: build strip, tower panel, specialization cards ─────────

  private showSheet(content: HTMLElement): void {
    this.sheetEl.replaceChildren(content);
    this.sheetEl.hidden = false;
    this.updateInsets(false);
  }

  private closeSheet(): void {
    const wasOpen = !this.sheetEl.hidden;
    this.buildAt = null;
    this.strip = null;
    this.panelTower = null;
    this.specOpen = false;
    this.sellArmedAt = 0;
    if (this.sel && (this.sel.kind === 'pad' || this.sel.kind === 'tower')) this.sel = null;
    this.r?.setGhostRange(null);
    this.sheetEl.hidden = true;
    this.sheetEl.replaceChildren();
    if (wasOpen) this.updateInsets(false);
    this.drawOnce();
  }

  private focusCell(x: number, y: number): void {
    // after the sheet's height is applied to the insets, pan so the cell sits in the visible strip
    this.r?.centerOn(x, y, 0.5);
  }

  private openBuild(col: number, row: number, kind: 'pad' | 'path'): void {
    this.cancelModes();
    this.buildAt = { col, row, kind, preview: null };
    this.panelTower = null;
    this.specOpen = false;
    this.sel = { kind: 'pad', col, row, previewType: null };
    this.r?.setGhostRange(null);
    this.ctx.play('tap');
    this.showSheet(this.renderBuild());
    this.focusCell(col + 0.5, row + 0.5);
    this.drawOnce();
  }

  /**
   * Builds the strip DOM once per `openBuild`. Previews, blocked taps and ATP changes then update the cards in place
   * (`updateBuildStrip`): rebuilding them reset the horizontal scroller to 0 and pulled a swiped-to card (T-cell /
   * Complement / Beacon at 390 px) off-screen, so the second tap of "tap → Build ✓" landed on another card.
   */
  private renderBuild(): HTMLElement {
    const t = this.t;
    const s = this.s;
    const b = this.buildAt!;
    const villi = b.kind === 'pad' && mapInfo(s.map).padKind[b.row * s.map.cols + b.col] === 2;
    const types: TowerId[] = b.kind === 'path' ? ['barrier'] : TOWER_IDS.filter((x) => x !== 'barrier');
    const title = b.kind === 'path' ? t('buildPath') : villi ? t('buildVilli') : t('buildPad');
    const close = el('button', { class: 'td-x', type: 'button', 'aria-label': t('close'), text: '✕' });
    close.addEventListener('click', () => this.closeSheet());
    const cards = el('div', { class: 'td-cards' });
    const detail = el('div', { class: 'td-strip-detail' });
    const items: BuildCard[] = [];
    for (const type of types) {
      const name = el('span', { class: 'td-card-name' });
      const cost = el('span', { class: 'td-card-cost' });
      const card = cssVars(el('button', { class: 'td-card', type: 'button', dataset: { type } }, el('span', { class: 'td-card-icon', text: TOWER_ICON[type] }), name, cost), {
        '--tc': towerColor(type),
      });
      card.addEventListener('click', () => this.onBuildCard(type));
      cards.append(card);
      items.push({ type, btn: card, name, cost });
    }
    const root = el('div', { class: 'td-strip' }, el('div', { class: 'td-sheet-head' }, el('span', { class: 'td-sheet-title', text: title }), close), cards, detail);
    this.strip = { root, cards, detail, items, villi, detailKey: '' };
    this.updateBuildStrip(false);
    return root;
  }

  /** Refreshes the open build strip in place (classes, labels, costs, detail line); `reveal` scrolls the previewed card fully into the strip. */
  private updateBuildStrip(reveal: boolean): void {
    const st = this.strip;
    const b = this.buildAt;
    if (!st || !b) return;
    const t = this.t;
    const s = this.s;
    let previewCard: HTMLElement | null = null;
    for (const it of st.items) {
      const check = canBuild(s, b.col, b.row, it.type);
      const blocked = !check.ok && check.reason !== 'noAtp';
      const poor = check.reason === 'noAtp';
      const preview = b.preview === it.type;
      if (preview) previewCard = it.btn;
      const cls = `td-card${preview ? ' preview' : ''}${poor ? ' poor' : ''}${blocked ? ' blocked' : ''}`;
      if (it.btn.className !== cls) it.btn.className = cls;
      const name = preview ? t('buildConfirm') : t('tower_' + it.type);
      if (it.name.textContent !== name) it.name.textContent = name;
      const cost = t('costAtp', { n: check.cost });
      if (it.cost.textContent !== cost) it.cost.textContent = cost;
    }
    const sel = b.preview ?? (st.items.length === 1 ? st.items[0].type : null);
    const check = sel ? canBuild(s, b.col, b.row, sel) : null;
    const key = sel && check ? `${sel}|${check.reason ?? ''}` : '';
    if (key !== st.detailKey) {
      st.detailKey = key;
      const detail = st.detail;
      if (sel && check) {
        const blockedReason = !check.ok && check.reason !== 'noAtp' ? check.reason : null;
        const ghost = this.ghostStats(sel, st.villi);
        detail.replaceChildren(
          ...nodes(
            el('b', { text: t('tower_' + sel) + ' · ' }),
            el('span', { text: t('towerDesc_' + sel) }),
            ghost ? el('span', { class: 'muted', text: ' · ' + ghost }) : null,
            blockedReason ? el('div', { class: 'td-warn', text: t('denied_' + blockedReason) }) : null,
            check.reason === 'noAtp' ? el('div', { class: 'td-warn', text: t('notEnough') }) : null,
          ),
        );
      } else detail.replaceChildren(el('span', { class: 'muted', text: t('tut_build') }));
    }
    if (reveal && previewCard) revealInScroller(st.cards, previewCard);
  }

  private ghostTower(type: TowerId, villi: boolean, level: TowerLevel = 1): Tower {
    const st = levelStats(type, level, null);
    return {
      id: -1,
      type,
      col: 0,
      row: 0,
      x: 0,
      y: 0,
      level,
      spec: null,
      targeting: TOWERS[type].defaultTargeting,
      readyAt: 0,
      lastShotAt: -1,
      targetId: null,
      angle: 0,
      invested: st.cost,
      kills: 0,
      damageDealt: 0,
      infectedUntil: 0,
      immuneUntil: 0,
      onVilli: villi,
      buff: { rate: 1, dmg: 1, range: villi ? villiBonus(st.range) : 0, immune: false },
      engulfReadyAt: 0,
      digestingUntil: 0,
      cureAt: 0,
      hp: 0,
      maxHp: 0,
      regenAt: 0,
      pathDist: [],
    };
  }

  private ghostStats(type: TowerId, villi: boolean): string {
    const t = this.t;
    const st = towerStats(this.s, this.ghostTower(type, villi));
    const parts: string[] = [];
    if (st.dps > 0) parts.push(`${t('stat_dps')} ${fmtNum(st.dps)}`);
    if (st.range > 0) parts.push(`${t('stat_range')} ${fmtNum(st.range)}`);
    for (const x of st.extras) if (x.key === 'hp' || x.key === 'buffRate' || x.key === 'slow') parts.push(`${t('stat_' + x.key)} ${fmtStat(x.key, x.value, t)}`);
    return parts.join(' · ');
  }

  private onBuildCard(type: TowerId): void {
    const b = this.buildAt;
    if (!b) return;
    const s = this.s;
    const check = canBuild(s, b.col, b.row, type);
    if (!check.ok && check.reason !== 'noAtp') {
      this.note(this.t('denied_' + check.reason), 'warn');
      this.sound('error');
      this.haptic('error');
      b.preview = type;
      this.updateBuildStrip(true);
      return;
    }
    if (b.preview === type) {
      // second tap builds (§11.2: no immediate build)
      const tw = build(s, b.col, b.row, type);
      if (tw) {
        this.closeSheet();
        this.updateHud(false);
      }
      return;
    }
    b.preview = type;
    this.ctx.play('tap');
    this.sel = { kind: 'pad', col: b.col, row: b.row, previewType: type };
    const villi = b.kind === 'pad' && mapInfo(s.map).padKind[b.row * s.map.cols + b.col] === 2;
    const base = levelStats(type, 1, null).range;
    this.r?.setGhostRange(TOWERS[type].onPath || base <= 0 ? null : base + (villi ? villiBonus(base) : 0));
    this.updateBuildStrip(true);
    this.drawOnce();
  }

  private openTower(id: number): void {
    const tw = findTower(this.s, id);
    if (!tw) return;
    this.cancelModes();
    this.buildAt = null;
    this.strip = null;
    this.panelTower = id;
    this.specOpen = false;
    this.sellArmedAt = 0;
    this.sel = { kind: 'tower', id };
    this.r?.setGhostRange(null);
    this.ctx.play('tap');
    this.showSheet(this.renderTowerPanel(tw));
    this.focusCell(tw.x, tw.y);
    this.drawOnce();
  }

  /** Rebuilds (full) or refreshes the open sheet; `full` after level / spec / status changes. */
  private refreshSheet(full: boolean): void {
    if (this.sheetEl.hidden) return;
    if (this.panelTower !== null) {
      const tw = findTower(this.s, this.panelTower);
      if (!tw) {
        this.closeSheet();
        return;
      }
      if (this.specOpen) {
        if (full || tw.level !== 2) {
          if (tw.level !== 2) this.specOpen = false;
          this.sheetEl.replaceChildren(this.specOpen ? this.renderSpecs(tw) : this.renderTowerPanel(tw));
        } else this.refreshSpecAfford(tw);
        return;
      }
      if (full) this.sheetEl.replaceChildren(this.renderTowerPanel(tw));
      else this.refreshTowerDynamic(tw);
    } else if (this.buildAt) {
      // affordability changes with ATP
      const key = this.buildAffordKey();
      if (full || key !== this.hudCache.buildAfford) {
        this.hudCache.buildAfford = key;
        this.updateBuildStrip(false);
      }
    }
  }

  private buildAffordKey(): string {
    const b = this.buildAt;
    if (!b) return '';
    let k = `${b.col},${b.row},${b.preview}`;
    for (const type of TOWER_IDS) k += canBuild(this.s, b.col, b.row, type).ok ? '1' : '0';
    return k;
  }

  private renderTowerPanel(tw: Tower): HTMLElement {
    const t = this.t;
    const s = this.s;
    const def = TOWERS[tw.type];
    const st = towerStats(s, tw);
    const close = el('button', { class: 'td-x', type: 'button', 'aria-label': t('close'), text: '✕' });
    close.addEventListener('click', () => this.closeSheet());
    const pips = el('span', { class: 'td-pips' });
    for (let i = 1; i <= 3; i++) pips.append(el('span', { class: 'td-pip' + (i <= tw.level ? ' on' : '') }));
    const head = el(
      'div',
      { class: 'td-sheet-head' },
      cssVars(el('span', { class: 'td-tp-icon', text: TOWER_ICON[tw.type] }), { '--tc': towerColor(tw.type) }),
      el(
        'div',
        { class: 'td-tp-name' },
        el('div', { class: 'td-sheet-title' }, el('span', { text: t('tower_' + tw.type) }), pips),
        tw.spec
          ? cssVars(el('span', { class: 'td-specbadge', text: t('spec_' + tw.spec) }), { '--sc': specColor(tw.spec), '--sc-ink': readableInk(specColor(tw.spec)) })
          : el('span', { class: 'td-tp-role muted', text: t('towerDesc_' + tw.type) }),
      ),
      close,
    );
    // stats line
    const statsRow = el('div', { class: 'td-stats' });
    const chip = (label: string, val: string) => el('span', { class: 'td-stat' }, el('small', { text: label }), el('b', { text: val }));
    if (tw.type === 'barrier') {
      statsRow.append(chip(t('stat_hp'), `${Math.ceil(tw.hp)}/${Math.ceil(tw.maxHp)}`));
      const regen = st.extras.find((x) => x.key === 'regen');
      if (regen) statsRow.append(chip(t('stat_regen'), fmtNum(regen.value)));
    } else if (tw.type === 'beacon') {
      for (const x of st.extras.slice(0, 3)) statsRow.append(chip(t('stat_' + x.key), fmtStat(x.key, x.value, t)));
      statsRow.append(chip(t('stat_range'), fmtNum(st.range)));
    } else {
      if (tw.type !== 'pyrogen') {
        statsRow.append(chip(t('stat_dmg'), fmtNum(st.dmg)));
        statsRow.append(chip(t('stat_rate'), `${fmtNum(st.rate)}/s`));
      } else {
        const slow = st.extras.find((x) => x.key === 'slow');
        if (slow) statsRow.append(chip(t('stat_slow'), fmtStat('slow', slow.value, t)));
      }
      statsRow.append(chip(t('stat_range'), fmtNum(st.range)));
      const targets = st.extras.find((x) => x.key === 'targets' || x.key === 'extraTargets');
      const mult = targets ? (targets.key === 'targets' ? targets.value : targets.value + 1) : 0;
      statsRow.append(chip(t('stat_dps'), fmtNum(st.dps) + (mult > 1 ? ` ×${mult}` : '')));
    }
    const info = el('button', { class: 'td-info' + (this.extrasOpen ? ' on' : ''), type: 'button', 'aria-label': t('infoLabel'), 'aria-expanded': String(this.extrasOpen), text: 'ⓘ' });
    info.addEventListener('click', () => {
      this.extrasOpen = !this.extrasOpen;
      this.ctx.play('tap');
      this.refreshSheet(true);
    });
    statsRow.append(info);
    const parts: (HTMLElement | null)[] = [head, statsRow];
    if (this.extrasOpen) {
      const ex = el('div', { class: 'td-extras' });
      for (const x of st.extras) ex.append(el('span', { class: 'td-extra' }, el('small', { text: t('stat_' + x.key) }), el('b', { text: fmtStat(x.key, x.value, t) })));
      parts.push(ex);
    }
    parts.push(el('div', { class: 'td-tp-status' }));
    // actions
    const actions = el('div', { class: 'td-tp-actions' });
    if (def.hasTargeting) {
      const tb = button(t('targetLabel', { mode: t('target_' + tw.targeting) }), () => {
        const i = TARGETING_MODES.indexOf(tw.targeting);
        setTargeting(s, tw.id, TARGETING_MODES[(i + 1) % TARGETING_MODES.length]);
        this.refreshSheet(true);
      }, { variant: 'secondary', size: 'sm', class: 'td-target' });
      actions.append(tb);
    }
    const cost = upgradeCost(tw);
    const up = el('button', { class: 'btn btn-primary btn-sm td-upgrade', type: 'button' });
    if (cost === null) {
      up.textContent = t('maxed');
      up.disabled = true;
    } else {
      const main = el('span', { class: 'td-up-main', text: tw.level === 2 ? t('chooseSpecBtn', { n: cost }) : t('upgradeFor', { n: cost }) });
      up.append(main);
      if (st.nextLevel && tw.level === 1) {
        const nl = st.nextLevel;
        const delta = tw.type === 'barrier' ? '' : nl.dps !== undefined && st.dps > 0 ? `${t('stat_dps')} ${fmtNum(st.dps)}→${fmtNum(nl.dps)}` : nl.range !== undefined ? `${t('stat_range')} ${fmtNum(st.range)}→${fmtNum(nl.range)}` : '';
        if (delta) up.append(el('span', { class: 'td-up-sub', text: delta }));
      }
      up.addEventListener('click', () => this.onUpgrade());
    }
    const sellBtn = el('button', { class: 'btn btn-danger btn-sm td-sell', type: 'button' }, el('span', { class: 'td-sell-label' }));
    sellBtn.addEventListener('click', () => this.onSell());
    actions.append(up, sellBtn);
    parts.push(actions);
    const panel = el('div', { class: 'td-tp', dataset: { tower: String(tw.id) } }, ...parts);
    // dynamic bits are filled by refreshTowerDynamic
    queueMicrotask(() => this.refreshTowerDynamic(tw));
    return panel;
  }

  private refreshTowerDynamic(tw: Tower): void {
    const t = this.t;
    const s = this.s;
    const panel = this.sheetEl.querySelector('.td-tp');
    if (!panel) return;
    const status = panel.querySelector('.td-tp-status') as HTMLElement | null;
    if (status) {
      const bits: string[] = [];
      if (tw.infectedUntil > s.time) bits.push(t('infectedFor', { s: Math.ceil(tw.infectedUntil - s.time) }));
      if (tw.immuneUntil > s.time) bits.push(t('immuneFor', { s: Math.ceil(tw.immuneUntil - s.time) }));
      if (tw.buff.rate > 1.0001 || tw.buff.dmg > 1.0001) bits.push(t('buffed'));
      if (tw.type !== 'barrier' && tw.type !== 'beacon') bits.push(t('killsN', { n: tw.kills }));
      const key = bits.join('|') + (tw.type === 'barrier' ? `|${Math.ceil(tw.hp)}` : '');
      if (status.dataset.key !== key) {
        status.dataset.key = key;
        status.innerHTML = '';
        if (tw.type === 'barrier') {
          const f = tw.maxHp > 0 ? Math.max(0, Math.min(1, tw.hp / tw.maxHp)) : 0;
          status.append(
            el('span', { class: 'td-hpbar' }, el('span', { class: 'td-hpbar-fill', style: { width: `${Math.round(f * 100)}%` } })),
            el('span', { class: 'small', text: t('barrierHp', { hp: Math.ceil(tw.hp), max: Math.ceil(tw.maxHp) }) }),
          );
        }
        for (const b of bits) status.append(el('span', { class: 'td-badge' + (b.startsWith('☣') ? ' infected' : b.startsWith('🛡') ? ' immune' : ''), text: b }));
      }
    }
    const up = panel.querySelector('.td-upgrade') as HTMLButtonElement | null;
    const cost = upgradeCost(tw);
    if (up && cost !== null) up.classList.toggle('poor', s.atp < cost);
    const sellBtn = panel.querySelector('.td-sell') as HTMLButtonElement | null;
    if (sellBtn) {
      const armed = this.sellArmedAt > 0 && performance.now() - this.sellArmedAt < SELL_WINDOW_MS;
      if (!armed) this.sellArmedAt = 0;
      const v = Math.round(0.7 * tw.invested);
      const label = armed ? t('sellConfirm', { n: v }) : t('sellFor', { n: v });
      const span = sellBtn.querySelector('.td-sell-label') as HTMLElement;
      if (span.textContent !== label) span.textContent = label;
      sellBtn.classList.toggle('armed', armed);
    }
  }

  private onUpgrade(): void {
    const id = this.panelTower;
    if (id === null) return;
    const tw = findTower(this.s, id);
    if (!tw) return;
    if (tw.level === 2) {
      this.specOpen = true;
      this.ctx.play('tap');
      this.sheetEl.replaceChildren(this.renderSpecs(tw));
      this.updateInsets(false);
      return;
    }
    if (upgrade(this.s, id)) this.refreshSheet(true);
  }

  private onSell(): void {
    const id = this.panelTower;
    if (id === null) return;
    const now = performance.now();
    if (this.sellArmedAt === 0 || now - this.sellArmedAt > SELL_WINDOW_MS) {
      this.sellArmedAt = now;
      this.ctx.play('tap');
      this.ctx.haptic('light');
      const tw = findTower(this.s, id);
      if (tw) this.refreshTowerDynamic(tw);
      return;
    }
    if (now - this.sellArmedAt < SELL_ARM_MS) return; // arm-then-confirm: ignore the double-tap
    this.sellArmedAt = 0;
    if (sell(this.s, id) > 0) this.closeSheet();
  }

  private renderSpecs(tw: Tower): HTMLElement {
    const t = this.t;
    const s = this.s;
    const cost = upgradeCost(tw) ?? 0;
    const back = el('button', { class: 'td-x', type: 'button', 'aria-label': t('back'), text: '✕' });
    back.addEventListener('click', () => {
      this.specOpen = false;
      this.ctx.play('tap');
      this.sheetEl.replaceChildren(this.renderTowerPanel(tw));
      this.updateInsets(false);
    });
    const cur = towerStats(s, tw);
    const cards = el('div', { class: 'td-spec-cards' });
    TOWER_SPECS[tw.type].forEach((spec, i) => {
      const st = towerStats(s, tw, 3, spec);
      const lines: string[] = [];
      if (tw.type === 'barrier') {
        const hp = st.extras.find((x) => x.key === 'hp');
        if (hp) lines.push(`${t('stat_hp')} ${fmtNum(hp.value)}`);
      } else if (tw.type === 'beacon') {
        const r = st.extras.find((x) => x.key === 'buffRate');
        if (r) lines.push(`${t('stat_buffRate')} ${fmtStat('buffRate', r.value, t)}`);
      } else if (st.dps > 0) {
        const targets = st.extras.find((x) => x.key === 'targets' || x.key === 'extraTargets');
        const mult = targets ? (targets.key === 'targets' ? targets.value : targets.value + 1) : 0;
        lines.push(`${t('stat_dps')} ${fmtNum(cur.dps)} → ${fmtNum(st.dps)}${mult > 1 ? ` ×${mult}` : ''}`);
      }
      if (st.range > 0 && Math.abs(st.range - cur.range) > 0.01) lines.push(`${t('stat_range')} ${fmtNum(cur.range)} → ${fmtNum(st.range)}`);
      const pick = el('button', { class: 'btn btn-primary btn-sm td-spec-pick' + (s.atp < cost ? ' poor' : ''), type: 'button', dataset: { spec } }, el('span', { text: t('specPick', { n: cost }) }));
      pick.addEventListener('click', (e) => {
        e.stopPropagation();
        if (upgrade(this.s, tw.id, spec)) {
          this.specOpen = false;
          this.sheetEl.replaceChildren(this.renderTowerPanel(tw));
          this.updateInsets(false);
        }
      });
      cards.append(
        cssVars(
          el(
            'div',
            { class: 'td-spec', dataset: { spec } },
            el('div', { class: 'td-spec-head' }, el('span', { class: 'td-spec-emblem', text: i === 0 ? '◆' : '◎' }), el('b', { text: t('spec_' + spec) })),
            el('p', { class: 'td-spec-desc', text: t('specDesc_' + spec) }),
            ...lines.map((l) => el('div', { class: 'td-spec-line', text: l })),
            pick,
          ),
          { '--sc': specColor(spec) },
        ),
      );
    });
    return el('div', { class: 'td-specs' }, el('div', { class: 'td-sheet-head' }, cssVars(el('span', { class: 'td-tp-icon', text: TOWER_ICON[tw.type] }), { '--tc': towerColor(tw.type) }), el('span', { class: 'td-sheet-title', text: t('specTitle') }), back), cards);
  }

  private refreshSpecAfford(tw: Tower): void {
    const cost = upgradeCost(tw) ?? 0;
    this.sheetEl.querySelectorAll<HTMLElement>('.td-spec-pick').forEach((b) => b.classList.toggle('poor', this.s.atp < cost));
  }

  // ── pause / visibility / context loss ─────────────────────────────────────

  /** Pauses the sim (stop RAF, acc = 0, write the run save when allowed) and shows the pause overlay. */
  pause(_reason: 'user' | 'auto'): void {
    if (this.destroyed) return;
    this.cancelModes();
    this.saveIfAllowed();
    if (this.paused) return;
    this.paused = true;
    this.stopLoop();
    this.r?.pause();
    this.showPauseOverlay();
  }

  resume(): void {
    if (this.destroyed || !this.paused) return;
    this.paused = false;
    this.overlayEl?.remove();
    this.overlayEl = null;
    this.r?.resume();
    this.updateHud(true);
    this.startLoop();
  }

  private showPauseOverlay(): void {
    const t = this.t;
    this.overlayEl?.remove();
    const mem = this.host.memory();
    const q = el('div', { class: 'segmented td-quality' });
    for (const v of ['auto', 'high', 'low'] as const) {
      const b = el('button', { class: 'seg' + (mem.prefs.quality === v ? ' active' : ''), type: 'button', text: t('q' + v[0].toUpperCase() + v.slice(1)) });
      b.addEventListener('click', () => this.setQuality(v));
      q.append(b);
    }
    const box = el(
      'div',
      { class: 'overlay td-pause' },
      el('h2', { text: t('pausedTitle') }),
      el('p', { class: 'muted small', text: this.lastStatus }),
      button(t('resume'), () => this.resume(), { variant: 'primary', size: 'lg', class: 'td-resume' }),
      button(t('rulesBtn'), () => this.ctx.showModal({ title: t('rulesBtn'), body: t('rules'), buttons: [{ label: t('ok'), primary: true }] }), { variant: 'secondary' }),
      button(t('restart'), () => this.confirmRestart(), { variant: 'secondary' }),
      button(t('toMenu'), () => {
        this.saveIfAllowed();
        this.host.toStart();
      }, { variant: 'secondary' }),
      el('div', { class: 'td-qrow' }, el('span', { class: 'muted small', text: t('quality') }), q),
    );
    this.overlayEl = box;
    this.gameEl.append(box);
  }

  private setQuality(q: Quality): void {
    const m = this.host.memory();
    this.host.setMemory({ ...m, prefs: { ...m.prefs, quality: q } });
    this.r?.setQuality(q);
    this.ctx.play('tap');
    if (this.paused) this.showPauseOverlay();
  }

  private confirmRestart(): void {
    const s = this.s;
    this.ctx.showModal({
      title: this.t('restart'),
      body: this.t('restartConfirm'),
      buttons: [
        { label: this.t('cancel') },
        {
          label: this.t('confirm'),
          primary: true,
          onClick: () => {
            this.host.writeRun(null);
            this.leave(() => this.host.newRun(s.mapId, s.difficulty));
          },
        },
      ],
    });
  }

  /** Shell visibility (tab hidden / rules sheet): pause and keep the overlay until the player resumes. */
  setVisible(visible: boolean): void {
    if (!visible) this.pause('auto');
  }

  setTheme(theme: ThemeName): void {
    this.r?.setTheme(theme);
  }

  private onContextLost(lost: boolean): void {
    if (this.destroyed) return;
    if (lost) {
      this.lost = true;
      this.stopLoop();
      this.saveIfAllowed();
      this.lostEl?.remove();
      const reload = button(
        this.t('reload'),
        () => {
          // the renderer restores the context (or replaces the canvas) and calls back with lost = false
          reload.disabled = true;
          this.r?.rebuild();
          window.setTimeout(() => {
            if (reload.isConnected) reload.disabled = false;
          }, 2500);
        },
        { variant: 'primary', size: 'lg' },
      );
      const box = el('div', { class: 'overlay td-lost' }, el('div', { class: 'td-start-icon', text: '🫥' }), el('p', { text: this.t('contextLost') }), reload);
      this.lostEl = box;
      this.gameEl.append(box);
    } else {
      this.lost = false;
      this.lostEl?.remove();
      this.lostEl = null;
      this.updateInsets(true);
      if (!this.paused) this.startLoop();
    }
  }

  private saveIfAllowed(): void {
    if (this.discard) return;
    const s = this.s;
    if (s.phase === 'build' || s.phase === 'countdown') this.host.writeRun(s);
  }

  // ── dev hooks (window.__td) ───────────────────────────────────────────────

  private toPage(x: number, y: number, h: number): { x: number; y: number } | null {
    const r = this.r;
    if (!r) return null;
    const out = { x: 0, y: 0 };
    if (!r.project(x, y, h, out)) return null;
    const st = this.stage.getBoundingClientRect();
    return { x: Math.round((st.left + out.x) * 10) / 10, y: Math.round((st.top + out.y) * 10) / 10 };
  }

  devHooks(): TdDevHooks {
    const s = () => this.s;
    return {
      state: () => this.s,
      screen: () => 'game',
      cellToScreen: (col, row) => {
        const st = s();
        const h = isPad(st, col, row) ? WORLD.padHeight : isPathCell(st, col, row) ? -WORLD.trenchDepth : 0;
        return this.toPage(col + 0.5, row + 0.5, h);
      },
      worldToScreen: (x, y, h = 0) => this.toPage(x, y, h),
      heroScreen: () => this.toPage(s().hero.x, s().hero.y, WORLD.heroHeight * 0.6),
      towerScreen: (id) => {
        const tw = findTower(s(), id);
        if (!tw) return null;
        const base = tw.type === 'barrier' ? -WORLD.trenchDepth : WORLD.padHeight;
        return this.toPage(tw.x, tw.y, base + WORLD.towerHeight[tw.level - 1] * 0.5);
      },
      enemyScreen: (id) => {
        const e = findEnemy(s(), id);
        return e ? this.toPage(e.x, e.y, e.flying ? 0.6 : 0.1) : null;
      },
      towers: () =>
        s().towers.map((tw) => {
          const p = this.toPage(tw.x, tw.y, WORLD.padHeight + 0.3);
          return { id: tw.id, type: tw.type, col: tw.col, row: tw.row, level: tw.level, spec: tw.spec, sx: p?.x ?? NaN, sy: p?.y ?? NaN };
        }),
      enemies: () =>
        s()
          .enemies.filter((e) => !e.dead && !e.leaked)
          .map((e) => {
            const p = this.toPage(e.x, e.y, 0.1);
            return { id: e.id, type: e.type, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, boss: e.boss !== null, sx: p?.x ?? NaN, sy: p?.y ?? NaN };
          }),
      pads: () => {
        const st = s();
        const out: { col: number; row: number; free: boolean; villi: boolean }[] = [];
        for (const [c, r] of st.map.pads) out.push({ col: c, row: r, free: !towerAt(st, c, r), villi: false });
        for (const [c, r] of st.map.villi) out.push({ col: c, row: r, free: !towerAt(st, c, r), villi: true });
        return out;
      },
      pathCells: () => {
        const st = s();
        const out: { col: number; row: number }[] = [];
        for (let r = 0; r < st.map.rows; r++) for (let c = 0; c < st.map.cols; c++) if (isPathCell(st, c, r)) out.push({ col: c, row: r });
        return out;
      },
      addAtp: (n) => {
        s().atp += n;
        this.updateHud(false);
        this.refreshSheet(true);
      },
      skipToWave: (n, start = false) => {
        const st = s();
        if (st.phase === 'over') return;
        st.enemies.length = 0;
        st.projectiles.length = 0;
        st.pools.length = 0;
        st.waveState.queue = [];
        st.wave = Math.max(0, Math.floor(n) - 1);
        st.endless = n > WAVES_PER_MAP;
        st.phase = 'build';
        st.countdown = 0;
        this.updateStatus();
        this.updateHud(true);
        if (start) startWave(st, false);
        this.updateBuildable();
      },
      killAll: () => {
        for (const e of s().enemies) if (!e.dead && !e.leaked) e.hp = 0;
      },
      setSpeed: (x) => {
        this.speed = Math.max(0.25, Math.min(32, x));
        this.updateHud(false);
      },
      advance: (seconds) => {
        const st = s();
        const n = Math.round(Math.max(0, seconds) / SIM_STEP);
        this.fast = true;
        try {
          for (let i = 0; i < n && this.s === st; i++) {
            step(st, SIM_STEP);
            if (i % 60 === 59 || i === n - 1) this.handleEvents(takeEvents(st));
          }
        } finally {
          this.fast = false;
        }
        this.updateHud(true);
      },
      stats: () => {
        const r = this.r;
        return r ? { ...r.stats() } : null;
      },
    };
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.destroyed) return;
    this.stopLoop();
    this.saveIfAllowed();
    this.destroyed = true;
    clearTimeout(this.longPress);
    if (this.tipCur) clearTimeout(this.tipCur.timer);
    this.tipCur = null;
    this.tipQueue.length = 0;
    this.unTap?.();
    this.unTap = null;
    this.cleanups.forEach((f) => {
      try {
        f();
      } catch (e) {
        console.warn(e);
      }
    });
    this.cleanups.length = 0;
    this.noteTimers.forEach((id) => clearTimeout(id));
    this.noteTimers.clear();
    try {
      this.r?.destroy();
    } catch (e) {
      console.warn(e);
    }
    this.r = null;
    this.gameEl.remove();
    this.ctx.setStatus('');
  }
}

