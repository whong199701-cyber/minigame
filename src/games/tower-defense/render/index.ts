/**
 * Immune Front — Three.js renderer.
 *
 * `Renderer` implements the `ImmuneRenderer` contract of types.ts (render / handleEvents / pick / project / panBy /
 * zoomAt / fitMap / centerOn / setQuality / setTheme / rebuild / stats / destroy) plus a self-contained mounting API
 * (mount / setMap / update / consumeEvents / showBuildable / onTap / pause / resume / dispose) with built-in pinch /
 * pan / tap gestures. It only ever reads `RenderSnapshot` + `GameEvent` (never `GameState`) and is fully
 * reconstructible from the map and the next snapshot. The default export is `createRenderer: CreateRenderer`.
 */
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import type { Lang, ThemeName } from '../../../app/types';
import {
  CAMERA,
  ENEMY_IDS,
  EnemyViewFlag,
  RENDER_BUDGET,
  TOWER_IDS,
  WORLD,
  type CreateRenderer,
  type GameEvent,
  type ImmuneRenderer,
  type MapDef,
  type PickResult,
  type Point,
  type Quality,
  type RenderQuality,
  type RenderSnapshot,
  type RenderStats,
  type RendererOptions,
  type TapHit,
  type TowerView,
} from '../types';
import { CameraRig } from './camera';
import { Bolts, DecalLayer, Particles, Shape, SpriteLayer, Waves, type FxLayers } from './effects';
import { EnemyLayer, ENEMY_VIS_SCALE } from './enemies';
import { HeroLayer } from './hero';
import { GestureInput } from './input';
import { isPathCell } from './mapgeom';
import { createSharedUniforms, type SharedUniforms } from './materials';
import { Overlay, type OverlayOptions } from './overlay';
import { pickTowerStage, raySphere, towerBase, type TowerPick } from './pick';
import { ATP_GOLD, CURE, ENEMY_COLORS, HIT_COLOR, INFECT, MARK, PALETTES, SPEC_COLOR, TOWER_ACCENT, type Palette } from './palette';
import { ProjectileLayer } from './projectiles';
import { makeTranslator, type Translate } from './strings';
import { Terrain } from './terrain';
import { TowerLayer } from './towers';
import { Lin, Rand, clamp } from './util';

export { renderStrings, NAME_FALLBACK } from './strings';
export type { OverlayOptions } from './overlay';
export type { TapHit } from '../types';

const TD = WORLD.trenchDepth;

export interface MountOptions {
  theme: ThemeName;
  /** 'auto' starts high and drops to low when the 2 s probe (waves 1 and 5, or `probeQuality()`) is below 45 fps. */
  quality: Quality | RenderQuality;
  lang?: Lang;
  /** ctx.t — renderer keys are in `renderStrings`; falls back to built-in zh/en text when a key is missing. */
  t?: Translate;
  onContextLost?: (lost: boolean) => void;
  /** Built-in gestures (pinch / pan / tap). Default true. Set false when the UI routes input via pick/panBy/zoomAt. */
  input?: boolean;
  overlay?: Partial<OverlayOptions>;
}

interface AcidPool {
  active: boolean;
  x: number;
  y: number;
  r: number;
  until: number;
}

const ANTIBIOTIC_RADIUS = 1.5;
const PILL_DELAY = 0.4;
/** How long `rebuild()` waits for `webglcontextrestored` before replacing the canvas and the WebGLRenderer (ms). */
const RESTORE_GRACE_MS = 1500;

export class Renderer implements ImmuneRenderer {
  private container: HTMLElement | null = null;
  private wrap: HTMLDivElement | null = null;
  private gl: WebGLRenderer | null = null;
  /**
   * Fetched right after the context is created: `getExtension` returns null once the context is lost, and three.js
   * only looks the extension up lazily, so `forceContextRestore()` silently does nothing after a real loss.
   */
  private loseExt: WEBGL_lose_context | null = null;
  private restoreTimer = 0;
  private scene = new Scene();
  private rig = new CameraRig();
  private u: SharedUniforms = createSharedUniforms();
  private hemi = new HemisphereLight(0xffffff, 0x330022, 1.2);
  private sun = new DirectionalLight(0xffffff, 1.8);
  private terrain: Terrain | null = null;
  private towers: TowerLayer | null = null;
  private enemies: EnemyLayer | null = null;
  private hero: HeroLayer | null = null;
  private projectiles: ProjectileLayer | null = null;
  private fx: FxLayers | null = null;
  private overlay: Overlay | null = null;
  private input: GestureInput | null = null;
  private ro: ResizeObserver | null = null;
  private map: MapDef | null = null;
  private themeName: ThemeName = 'dark';
  private pal: Palette = PALETTES.dark;
  private qualityPref: Quality = 'auto';
  private q: RenderQuality = 'high';
  private pixelCap = 2;
  private degraded = false;
  private lastSnap: RenderSnapshot | null = null;
  private emptySnap: RenderSnapshot = makeEmptySnapshot();
  private now = 0;
  private paused = false;
  private lost = false;
  private destroyed = false;
  private lastUpdateAt = 0;
  private tapCbs = new Set<(hit: TapHit) => void>();
  private ctxCb: ((lost: boolean) => void) | null = null;
  private tr: Translate = makeTranslator('zh');
  private lang: Lang = 'zh';
  private raf = 0;
  private redrawQueued = false;
  private highlightCells: [number, number][] = [];
  private fitted = false;
  private lastW = 0;
  private lastH = 0;
  private probe = { active: false, t: 0, sum: 0, n: 0 };
  private statsOut: RenderStats = { calls: 0, triangles: 0, frameMs: 0 };
  private cpuMs = 0;
  private cpuAvg = 0;
  private syncAvg = 0;
  private glAvg = 0;
  private overlayAvg = 0;
  private feverK = 0;
  private adrenK = 0;
  private acid: AcidPool[] = [];
  private pill = { active: false, x: 0, y: 0, t0: 0 };
  private rnd = new Rand(0xc0ffee);
  private lk = { x: 0, y: 0, h: 0, r: 0, type: 0 };
  private tk = { x: 0, y: 0, h: 0, type: 0 };
  private deadIds = new Int32Array(64).fill(-1);
  private deadNext = 0;
  private dmgStr: string[] = [];
  private tmpV = new Vector3();
  private tmpO = new Vector3();
  private idle = false;
  private lc: Record<string, Lin> = {};
  private enemyLin: Lin[] = ENEMY_IDS.map((id) => new Lin(ENEMY_COLORS[id].body));
  private hemiBase = new Color();
  private sunBase = new Color();
  private warm = new Color(0xffa060);
  private lastFeverK = -1;
  private towerLin: Lin[] = TOWER_IDS.map((id) => new Lin(TOWER_ACCENT[id]));

  constructor(opts?: Partial<MountOptions>) {
    if (opts?.t || opts?.lang) this.setLanguage(opts.lang ?? 'zh', opts.t);
    for (const [k, v] of Object.entries({ ...HIT_COLOR, cure: CURE, infect: INFECT, mark: MARK, atp: ATP_GOLD })) this.lc[k] = new Lin(v);
    for (let i = 0; i < 16; i++) this.acid.push({ active: false, x: 0, y: 0, r: 1, until: 0 });
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /** Creates the WebGL canvas + 2D overlay inside `container` (sized by a ResizeObserver). */
  mount(container: HTMLElement, opts: MountOptions): void {
    if (this.destroyed) throw new Error('renderer disposed');
    if (this.gl) return;
    this.container = container;
    this.ctxCb = opts.onContextLost ?? this.ctxCb;
    this.setLanguage(opts.lang ?? this.lang, opts.t);
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const wrap = document.createElement('div');
    wrap.className = 'tdr-wrap';
    Object.assign(wrap.style, { position: 'absolute', inset: '0', overflow: 'hidden', touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none' });
    container.appendChild(wrap);
    this.wrap = wrap;
    this.gl = this.createGL(wrap);
    this.overlay = new Overlay(wrap);
    this.overlay.setTranslator(this.tr);
    if (opts.overlay) Object.assign(this.overlay.options, opts.overlay);
    if (opts.input !== false) {
      this.input = new GestureInput(wrap, {
        tap: (sx, sy) => this.emitTap(sx, sy),
        pan: (dx, dy) => this.rig.panBy(dx, dy),
        pinch: (sx, sy, f) => this.zoomAt(sx, sy, f),
        locked: () => (this.lastSnap ? this.lastSnap.interaction === 'abilityTarget' : false),
        changed: () => this.requestRedraw(),
      });
    }
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.buildLayers();
    this.setTheme(opts.theme);
    this.setQuality(opts.quality);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    if (this.map) this.setMap(this.map);
  }

  /** Creates the WebGL canvas (first child of `wrap`, under the 2D overlay) and its WebGLRenderer; throws without WebGL. */
  private createGL(wrap: HTMLElement): WebGLRenderer {
    const canvas = document.createElement('canvas');
    canvas.className = 'tdr-gl';
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
    wrap.insertBefore(canvas, wrap.firstChild);
    let gl: WebGLRenderer;
    try {
      gl = new WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' });
    } catch (e) {
      canvas.remove();
      throw e;
    }
    // registered after three.js' own handlers so its GL state is re-initialised before we rebuild
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    gl.toneMapping = ACESFilmicToneMapping;
    gl.outputColorSpace = SRGBColorSpace;
    gl.shadowMap.type = PCFSoftShadowMap;
    // reset manually so the shadow pass is included in stats().calls (three resets after the shadow pass otherwise)
    gl.info.autoReset = false;
    // cache WEBGL_lose_context now (also primes three's own lookup, so forceContextLoss / forceContextRestore work)
    this.loseExt = gl.extensions.has('WEBGL_lose_context') ? (gl.getContext().getExtension('WEBGL_lose_context') as WEBGL_lose_context | null) : null;
    return gl;
  }

  private buildLayers(): void {
    const shadows = this.q === 'high';
    this.fx = {
      alphaDecals: new DecalLayer(640, false, 2),
      glowDecals: new DecalLayer(320, true, 4),
      sprites: new SpriteLayer(400, true),
      sparks: new Particles(1024, false, true),
      debris: new Particles(384, true, false),
      bolts: new Bolts(RENDER_BUDGET.maxChains + 32),
      waves: new Waves(96),
    };
    const fx = this.fx;
    this.scene.add(fx.alphaDecals.mesh, fx.glowDecals.mesh, fx.sprites.mesh, fx.sparks.points, fx.debris.points, fx.bolts.mesh);
    this.towers = new TowerLayer(this.u, shadows);
    this.enemies = new EnemyLayer(this.u, shadows);
    this.hero = new HeroLayer(this.u, shadows);
    this.projectiles = new ProjectileLayer(this.u);
    this.scene.add(this.towers.root, this.enemies.root, this.hero.root, this.projectiles.root);
  }

  /**
   * Removes every layer from the scene. `release` frees their GPU resources; after a context restore it is false:
   * the old GL handles died with the old context, and three.js already forgot them, so the objects are just dropped.
   */
  private disposeLayers(release = true): void {
    const fx = this.fx;
    if (fx) {
      for (const o of [fx.alphaDecals.mesh, fx.glowDecals.mesh, fx.sprites.mesh, fx.sparks.points, fx.debris.points, fx.bolts.mesh]) this.scene.remove(o);
      if (release) {
        fx.alphaDecals.dispose();
        fx.glowDecals.dispose();
        fx.sprites.dispose();
        fx.sparks.dispose();
        fx.debris.dispose();
        fx.bolts.dispose();
      }
    }
    this.fx = null;
    for (const l of [this.towers, this.enemies, this.hero, this.projectiles]) {
      if (!l) continue;
      this.scene.remove(l.root);
      if (release) l.dispose();
    }
    this.towers = null;
    this.enemies = null;
    this.hero = null;
    this.projectiles = null;
    if (this.terrain) {
      this.scene.remove(this.terrain.root);
      if (release) this.terrain.dispose();
      this.terrain = null;
    }
  }

  /** Builds terrain, vessels, flow particles, pads (+ villi) and the core for a map; resets the camera framing. */
  setMap(map: MapDef): void {
    this.map = map;
    if (!this.gl) return;
    if (this.terrain) {
      this.scene.remove(this.terrain.root);
      this.terrain.dispose();
    }
    this.terrain = new Terrain(map, this.u, this.pal, { flowParticles: this.flowCount() });
    this.terrain.setPointScale(this.pointScale());
    this.scene.add(this.terrain.root);
    if (this.towers) {
      this.towers.info = this.terrain.info;
      this.towers.resetAnimations();
    }
    this.rig.setMap(map.cols, map.rows);
    this.rig.setPads(this.terrain.info.pads);
    this.fitted = false;
    this.highlightCells = [];
    this.fx?.waves.clear();
    this.fx?.sparks.clear();
    this.fx?.debris.clear();
    this.fx?.bolts.clear();
    this.enemies?.clearDying();
    for (const a of this.acid) a.active = false;
    this.overlay?.clearAll();
    this.updateShadowCamera();
    this.resize();
    this.requestRedraw();
  }

  /**
   * Disposes every GPU resource and recreates them from the map (+ next snapshot). While the context is lost (the
   * "Reload" overlay) it asks the browser for the context back through the cached `WEBGL_lose_context`; when no
   * `webglcontextrestored` arrives within RESTORE_GRACE_MS (no extension, or the browser keeps the context dead) it
   * replaces the canvas and the WebGLRenderer instead. Either way the context callback reports `false` once the
   * scene is back.
   */
  rebuild(): void {
    if (!this.gl || this.destroyed) return;
    if (this.lost) {
      let asked = false;
      if (this.loseExt) {
        try {
          this.loseExt.restoreContext();
          asked = true;
        } catch {
          /* INVALID_OPERATION: the browser restores on its own, or never */
        }
      }
      window.clearTimeout(this.restoreTimer);
      this.restoreTimer = window.setTimeout(() => {
        this.restoreTimer = 0;
        if (this.lost && !this.destroyed) this.recreateContext();
      }, asked ? RESTORE_GRACE_MS : 0);
      return;
    }
    this.rebuildLayers(true);
  }

  /** Last resort after a context loss: a fresh canvas + WebGLRenderer, every layer rebuilt from the map. */
  private recreateContext(): boolean {
    const old = this.gl;
    const wrap = this.wrap;
    if (!old || !wrap || this.destroyed) return false;
    let gl: WebGLRenderer;
    try {
      gl = this.createGL(wrap);
    } catch (e) {
      console.warn('[tower-defense] WebGL context could not be recreated', e);
      return false;
    }
    const oc = old.domElement;
    oc.removeEventListener('webglcontextlost', this.onLost);
    oc.removeEventListener('webglcontextrestored', this.onRestored);
    try {
      old.dispose();
    } catch {
      /* the old context is gone */
    }
    oc.remove();
    this.gl = gl;
    this.lost = false;
    // GPU objects of the dead context are dropped, not disposed (their handles belong to the old renderer)
    this.sun.shadow.map = null;
    this.rebuildLayers(false);
    this.ctxCb?.(false);
    return true;
  }

  private rebuildLayers(release: boolean): void {
    this.disposeLayers(release);
    this.buildLayers();
    this.applyPalette();
    if (this.map) this.setMap(this.map);
    this.applyQuality(this.q);
    this.requestRedraw();
  }

  /** Releases every geometry / material / texture, the WebGL context, canvases, observers and listeners. */
  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearTimeout(this.restoreTimer);
    this.restoreTimer = 0;
    this.ro?.disconnect();
    this.ro = null;
    this.input?.dispose();
    this.input = null;
    this.disposeLayers();
    this.sun.shadow.dispose();
    this.scene.clear();
    this.overlay?.dispose();
    this.overlay = null;
    if (this.gl) {
      const c = this.gl.domElement;
      c.removeEventListener('webglcontextlost', this.onLost);
      c.removeEventListener('webglcontextrestored', this.onRestored);
      this.gl.renderLists.dispose();
      this.gl.dispose();
      if (!this.lost) {
        try {
          this.gl.forceContextLoss();
        } catch {
          /* already lost */
        }
      }
      c.remove();
      this.gl = null;
    }
    this.wrap?.remove();
    this.wrap = null;
    this.tapCbs.clear();
    this.ctxCb = null;
    this.lastSnap = null;
  }

  destroy(): void {
    this.dispose();
  }

  private onLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.redrawQueued = false;
    this.ctxCb?.(true);
  };

  private onRestored = (): void => {
    this.lost = false;
    window.clearTimeout(this.restoreTimer);
    this.restoreTimer = 0;
    if (this.destroyed || !this.gl) return;
    // the shadow map target belongs to the dead context: drop it (disposing would delete foreign GL handles)
    this.sun.shadow.map = null;
    this.rebuildLayers(false);
    this.ctxCb?.(false);
  };

  /** Registers the context-lost (true) / restored (false) callback. */
  onContextLost(cb: (lost: boolean) => void): void {
    this.ctxCb = cb;
  }

  /** Freezes VFX / idle animations (camera gestures still redraw). */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.lastUpdateAt = 0;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  // ── settings ──────────────────────────────────────────────────────────────

  setLanguage(lang: Lang, t?: Translate): void {
    this.lang = lang;
    this.tr = makeTranslator(lang, t);
    this.overlay?.setTranslator(this.tr);
  }

  setTheme(t: ThemeName): void {
    this.themeName = t;
    this.pal = PALETTES[t];
    this.applyPalette();
    this.requestRedraw();
  }

  get theme(): ThemeName {
    return this.themeName;
  }

  private applyPalette(): void {
    const p = this.pal;
    this.scene.background = new Color(p.bg);
    this.scene.fog = new Fog(p.bg, 30, 80);
    this.hemi.color.setHex(p.hemiSky);
    this.hemiBase.setHex(p.hemiSky);
    this.sunBase.setHex(p.sun);
    this.lastFeverK = -1;
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.sun.color.setHex(p.sun);
    this.sun.intensity = p.sunIntensity;
    if (this.gl) this.gl.toneMappingExposure = p.exposure;
    this.u.uRim.value.setHex(p.rim);
    this.u.uRimStrength.value = p.rimStrength;
    this.u.uSelect.value.setHex(p.select === 0xffffff ? 0xffffff : 0xffffff);
    this.terrain?.applyPalette(p);
    this.towers?.applyPalette(p);
    this.enemies?.applyPalette(p);
    this.hero?.applyPalette(p);
    if (this.fx) {
      this.fx.glowDecals.setAdditive(p.additive);
      this.fx.sprites.setAdditive(p.additive);
      this.fx.sparks.setAdditive(p.additive);
      this.fx.bolts.setAdditive(p.additive);
    }
    if (this.overlay) this.overlay.textStroke = p.textStroke;
    this.updateFog();
  }

  /** 'auto' | 'high' | 'low'. Auto starts high and probes frame time (see `probeQuality`). */
  setQuality(q: Quality | RenderQuality): void {
    this.qualityPref = q;
    this.degraded = false;
    this.applyQuality(q === 'low' ? 'low' : 'high');
  }

  get quality(): RenderQuality {
    return this.q;
  }

  private applyQuality(q: RenderQuality): void {
    this.q = q;
    this.pixelCap = this.degraded ? RENDER_BUDGET.degradedPixelRatio : q === 'high' ? RENDER_BUDGET.maxPixelRatioHigh : RENDER_BUDGET.maxPixelRatioLow;
    const shadows = q === 'high';
    if (this.gl) {
      if (this.gl.shadowMap.enabled !== shadows) {
        this.gl.shadowMap.enabled = shadows;
        this.scene.traverse((o) => {
          const m = (o as Mesh).material as Material | Material[] | undefined;
          if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
          else if (m) m.needsUpdate = true;
        });
      }
    }
    this.sun.castShadow = shadows;
    this.towers?.setShadows(shadows);
    this.enemies?.setShadows(shadows);
    this.hero?.setShadows(shadows);
    this.terrain?.setFlowCount(this.flowCount());
    if (this.fx) {
      this.fx.sparks.density = q === 'high' ? 1 : 0.6;
      this.fx.debris.density = q === 'high' ? 1 : 0.6;
    }
    if (this.overlay) this.overlay.maxDpr = q === 'high' ? 3 : 2;
    this.resize(true);
  }

  private flowCount(): number {
    return this.q === 'high' && !this.idle ? RENDER_BUDGET.flowParticlesHigh : RENDER_BUDGET.flowParticlesLow;
  }

  /** Idle frames (build / countdown, nothing moving) use the low flow-particle count (§11.6). */
  setIdle(idle: boolean): void {
    if (this.idle === idle) return;
    this.idle = idle;
    this.terrain?.setFlowCount(this.flowCount());
  }

  /** Starts a 2 s frame-time probe (auto quality drops to low below 45 fps). Called automatically on waves 1 and 5. */
  probeQuality(): void {
    this.probe.active = true;
    this.probe.t = 0;
    this.probe.sum = 0;
    this.probe.n = 0;
  }

  /** Overlay feature toggles (HP bars, damage numbers, banners, labels, vignettes). */
  setOverlayOptions(o: Partial<OverlayOptions>): void {
    if (this.overlay) Object.assign(this.overlay.options, o);
  }

  /** Enables / disables the built-in gestures. */
  setInputEnabled(on: boolean): void {
    if (this.input) this.input.enabled = on;
  }

  /**
   * Screen insets (CSS px) covered by UI chrome; framing, clamping and `centerOn` use the strip between them.
   * `refit` (default) re-applies the default framing; false keeps zoom / pan and eases the camera back into the clamp
   * (bottom sheets opening and closing).
   */
  setInsets(top: number, bottom: number, refit = true): void {
    if (!refit) {
      this.rig.setInsets(top, bottom);
      if (this.map && this.fitted) this.rig.settle();
      this.requestRedraw();
      return;
    }
    this.rig.setInsets(top, bottom);
    this.fitted = false;
    this.resize(true);
  }

  /** Screen point (container CSS px) → floor point in logic cells; false when the ray misses the floor. */
  floorPoint(sx: number, sy: number, out: Point): boolean {
    if (!this.gl) return false;
    this.rig.apply();
    if (!this.rig.floorAt(sx, sy, 0, this.tmpV2)) return false;
    out.x = this.tmpV2.x;
    out.y = this.tmpV2.z;
    return true;
  }

  /** Overrides the ghost preview's range disc (null = built-in L1 range). */
  setGhostRange(r: number | null): void {
    if (this.towers) this.towers.ghostRange = r;
  }

  /** Pads at risk of infection during a virus-wave preview (§5.3): a biohazard badge on each; null clears. */
  showRisk(cells: readonly (readonly [number, number])[] | null): void {
    this.overlay?.setRisk(cells, WORLD.padHeight);
    this.requestRedraw();
  }

  /** Pads / path cells to highlight as buildable (pulsing rings); null clears. */
  showBuildable(cells: readonly (readonly [number, number])[] | null): void {
    this.highlightCells = cells ? cells.map(([c, r]) => [c, r] as [number, number]) : [];
    this.terrain?.setHighlights(cells);
    this.requestRedraw();
  }

  // ── camera ────────────────────────────────────────────────────────────────

  resize(force = false): void {
    if (!this.gl || !this.container || !this.overlay) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w < 2 || h < 2) return;
    const pr = Math.min(window.devicePixelRatio || 1, this.pixelCap);
    const changed = w !== this.lastW || h !== this.lastH;
    if (!changed && !force && this.fitted) return;
    const reorient = this.lastW > 0 && (w > h) !== (this.lastW > this.lastH);
    this.lastW = w;
    this.lastH = h;
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h, false);
    this.overlay.resize(w, h);
    // keep the point at the strip centre and the zoom across resizes; full refit on first frame / orientation change
    const zoom = this.rig.zoom;
    const hadFit = this.fitted && !reorient;
    let cx = 0;
    let cz = 0;
    if (hadFit && this.rig.floorAt(this.rig.w / 2, (this.rig.insetTop + this.rig.h - this.rig.insetBottom) / 2, 0, this.tmpV)) {
      cx = this.tmpV.x;
      cz = this.tmpV.z;
    }
    this.rig.setViewport(w, h);
    if (this.map) {
      this.rig.fit();
      if (hadFit) {
        this.rig.zoomAt(w / 2, h / 2, zoom);
        this.rig.centerOn(cx, cz, 0.5, 0);
        this.rig.tick(1);
      }
      this.fitted = true;
    }
    this.terrain?.setPointScale(this.pointScale());
    this.fx?.sparks.setScale(this.pointScale());
    this.fx?.debris.setScale(this.pointScale());
    this.updateFog();
    this.requestRedraw();
  }

  private pointScale(): number {
    const pr = this.gl ? this.gl.getPixelRatio() : 1;
    return (this.rig.h * pr) / (2 * Math.tan(((CAMERA.fovDeg * Math.PI) / 180) / 2));
  }

  private updateFog(): void {
    const f = this.scene.fog as Fog | null;
    if (!f) return;
    const d = this.rig.dist;
    f.near = d + 7;
    f.far = d + 30;
  }

  private updateShadowCamera(): void {
    if (!this.map) return;
    const cx = this.map.cols / 2;
    const cz = this.map.rows / 2;
    const s = this.sun;
    s.position.set(cx - 5, 14, cz - 6);
    s.target.position.set(cx, 0, cz);
    const half = Math.max(this.map.cols, this.map.rows) * 0.62;
    const cam = s.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = 40;
    cam.updateProjectionMatrix();
  }

  panBy(dx: number, dy: number): void {
    this.rig.panBy(dx, dy);
    this.requestRedraw();
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.rig.zoomAt(sx, sy, factor);
    this.updateFog();
    this.requestRedraw();
  }

  fitMap(): void {
    this.rig.fit();
    this.updateFog();
    this.requestRedraw();
  }

  centerOn(x: number, y: number, fy = 0.45): void {
    this.rig.centerOn(x, y, fy);
    this.requestRedraw();
  }

  /** Projects logic (x, y, h) to container CSS px. */
  project(x: number, y: number, h: number, out: Point): boolean {
    return this.rig.projectWorld(x, h, y, out);
  }

  /** Current zoom factor (1–2). */
  get zoom(): number {
    return this.rig.zoom;
  }

  // ── picking ───────────────────────────────────────────────────────────────

  /** Registers a tap listener (built-in gestures); returns an unsubscribe function. */
  onTap(cb: (hit: TapHit) => void): () => void {
    this.tapCbs.add(cb);
    return () => this.tapCbs.delete(cb);
  }

  private emitTap(sx: number, sy: number): void {
    if (!this.tapCbs.size) return;
    const hit = this.pickAt(sx, sy);
    if (!hit) return;
    this.tapCbs.forEach((cb) => cb(hit));
  }

  /** Contract pick (hero > tower > pad > path > terrain; enemies are not pickable here). */
  pick(sx: number, sy: number): PickResult {
    const h = this.pickAt(sx, sy, false);
    if (!h) return null;
    switch (h.kind) {
      case 'hero':
        return { kind: 'hero' };
      case 'tower':
        return { kind: 'tower', id: h.id, col: h.col, row: h.row };
      case 'pad':
        return { kind: 'pad', col: h.col, row: h.row };
      case 'path':
        return { kind: 'path', col: h.col, row: h.row };
      default:
        return { kind: 'terrain', x: h.x, y: h.y };
    }
  }

  /** Extended pick including enemies (hero > tower > enemy > pad > path > terrain). */
  pickAt(sx: number, sy: number, enemies = true): TapHit | null {
    if (!this.terrain || !this.map) return null;
    const rig = this.rig;
    rig.apply();
    const dir = rig.rayDir(sx, sy, this.tmpV);
    const o = this.tmpO.copy(rig.camera.position);
    const snap = this.lastSnap;
    const info = this.terrain.info;
    const floor = { x: 0, y: 0, z: 0 };
    const hasFloor = rig.floorAt(sx, sy, 0, this.tmpV2);
    if (hasFloor) {
      floor.x = this.tmpV2.x;
      floor.z = this.tmpV2.z;
    }
    rig.rayDir(sx, sy, dir);
    const mk = (kind: TapHit['kind'], id: number, col: number, row: number): TapHit => ({
      kind,
      id,
      col,
      row,
      x: floor.x,
      y: floor.z,
      sx,
      sy,
      pathCell: isPathCell(info, col, row),
    });
    const cellOf = (x: number, y: number): [number, number] => {
      const c = Math.floor(x);
      const r = Math.floor(y);
      return c >= 0 && r >= 0 && c < info.cols && r < info.rows ? [c, r] : [-1, -1];
    };
    if (snap) {
      // hero
      if (snap.hero.alive && this.hero?.visible) {
        if (raySphere(o, dir, this.hero.x, this.hero.h, this.hero.y, WORLD.pickHeroRadius) >= 0) {
          const [c, r] = cellOf(this.hero.x, this.hero.y);
          return mk('hero', -1, c, r);
        }
      }
      // towers: body (what the player sees) > pick capsule > the empty path cell a capsule overhangs (§11.8)
      const towers = this.towers;
      if (towers && snap.towerCount > 0) {
        const trench = rig.floorAt(sx, sy, -TD * 0.5, this.tmpV2) ? this.tmpXZ : null;
        if (trench) {
          trench.x = this.tmpV2.x;
          trench.z = this.tmpV2.z;
        }
        const tp = pickTowerStage(o, dir, trench, info, snap.towers, snap.towerCount, this.silTop, this.towerPick);
        if (tp.path >= 0) return mk('path', -1, tp.path % info.cols, Math.floor(tp.path / info.cols));
        if (tp.index >= 0) {
          const tv = snap.towers[tp.index];
          const [c, r] = cellOf(tv.x, tv.y);
          return mk('tower', tv.id, c, r);
        }
      }
      if (enemies) {
        const e = snap.enemies;
        let best = Infinity;
        let bestI = -1;
        for (let i = 0; i < e.count; i++) {
          const f = e.flags[i];
          if ((f & EnemyViewFlag.Stealth) !== 0 && (f & EnemyViewFlag.Revealed) === 0) continue;
          const rr = e.radius[i];
          const hh = EnemyLayer.bodyHeight(e.type[i], rr, (f & EnemyViewFlag.Flying) !== 0);
          const t = raySphere(o, dir, e.x[i], hh, e.y[i], Math.max(0.3, rr * ENEMY_VIS_SCALE * 1.25));
          if (t >= 0 && t < best) {
            best = t;
            bestI = i;
          }
        }
        if (bestI >= 0) {
          const [c, r] = cellOf(e.x[bestI], e.y[bestI]);
          return mk('enemy', e.id[bestI], c, r);
        }
      }
    }
    // pads (disc r 0.7 at pad height, snap to nearest centre within 0.75)
    if (rig.floorAt(sx, sy, WORLD.padHeight, this.tmpV2)) {
      const px = this.tmpV2.x;
      const pz = this.tmpV2.z;
      let bd = Infinity;
      let bc = -1;
      let br = -1;
      for (const [c, r] of info.pads) {
        const d = Math.hypot(px - c - 0.5, pz - r - 0.5);
        if (d < bd) {
          bd = d;
          bc = c;
          br = r;
        }
      }
      if (bd <= Math.max(WORLD.pickPadRadius, WORLD.pickSnap)) {
        if (snap) {
          for (let i = 0; i < snap.towerCount; i++) {
            const tv = snap.towers[i];
            if (Math.floor(tv.x) === bc && Math.floor(tv.y) === br) return mk('tower', tv.id, bc, br);
          }
        }
        floor.x = bc + 0.5;
        floor.z = br + 0.5;
        return mk('pad', -1, bc, br);
      }
    }
    if (rig.floorAt(sx, sy, -TD * 0.5, this.tmpV2)) {
      const [c, r] = cellOf(this.tmpV2.x, this.tmpV2.z);
      if (c >= 0 && isPathCell(info, c, r)) {
        if (snap) {
          for (let i = 0; i < snap.towerCount; i++) {
            const tv = snap.towers[i];
            if (tv.typeId === 'barrier' && Math.floor(tv.x) === c && Math.floor(tv.y) === r) return mk('tower', tv.id, c, r);
          }
        }
        return mk('path', -1, c, r);
      }
    }
    if (!hasFloor) return null;
    const [c, r] = cellOf(floor.x, floor.z);
    return mk('terrain', -1, c, r);
  }
  private tmpV2 = new Vector3();
  private tmpXZ = { x: 0, z: 0 };
  private towerPick: TowerPick = { index: -1, path: -1 };
  /** World height of a tower's silhouette top (model + spinning emblem), for the body pick proxy. */
  private silTop = (tv: TowerView): number => (this.towers ? this.towers.silhouetteTop(tv) : towerBase(tv) + WORLD.towerHeight[tv.level - 1]);

  // ── frame ─────────────────────────────────────────────────────────────────

  /** Contract alias of `update(snap)`. */
  render(snap: RenderSnapshot): void {
    this.update(snap);
  }

  /**
   * Syncs every visual with the snapshot and draws one frame. `alpha` is informational (the snapshot is already
   * interpolated); `dt` is the real frame delta in seconds (measured when omitted). Allocation-free.
   */
  update(snap: RenderSnapshot, alpha?: number, dt?: number): void {
    void alpha;
    if (!this.gl || this.lost || this.destroyed || !this.terrain) return;
    const t = performance.now();
    let real = dt;
    if (real === undefined) real = this.lastUpdateAt > 0 ? (t - this.lastUpdateAt) / 1000 : 1 / 60;
    if (this.probe.active && this.lastUpdateAt > 0) {
      const ms = (t - this.lastUpdateAt) || real * 1000;
      if (ms < 250) {
        this.probe.sum += ms;
        this.probe.n++;
        this.probe.t += ms / 1000;
        if (this.probe.t >= RENDER_BUDGET.probeSeconds) this.finishProbe();
      }
    }
    this.lastUpdateAt = t;
    real = clamp(real, 0, 0.1);
    this.lastSnap = snap;
    this.frame(snap, this.paused ? 0 : real, real);
  }

  private finishProbe(): void {
    const p = this.probe;
    p.active = false;
    if (!p.n) return;
    const mean = p.sum / p.n;
    this.statsOut.frameMs = mean;
    if (this.qualityPref !== 'auto') return;
    if (1000 / mean < RENDER_BUDGET.probeMinFps) {
      if (this.q === 'high') this.applyQuality('low');
      else if (!this.degraded) {
        this.degraded = true;
        this.applyQuality('low');
      }
    }
  }

  private requestRedraw(): void {
    if (this.redrawQueued || !this.gl || this.lost || this.destroyed) return;
    this.redrawQueued = true;
    this.raf = requestAnimationFrame(this.redraw);
  }

  private redraw = (): void => {
    this.redrawQueued = false;
    this.raf = 0;
    if (!this.gl || this.lost || this.destroyed || !this.terrain) return;
    // the game loop already drew this frame
    if (performance.now() - this.lastUpdateAt < 30) {
      if (this.rig.animating) this.requestRedraw();
      return;
    }
    const snap = this.lastSnap ?? this.emptySnap;
    this.frame(snap, 0, 1 / 60);
    if (this.rig.animating || this.rig.shake > 0) this.requestRedraw();
  };

  private frame(snap: RenderSnapshot, dt: number, real: number): void {
    const gl = this.gl!;
    const terrain = this.terrain!;
    const fx = this.fx!;
    const c0 = performance.now();
    this.now += dt;
    const now = this.now;
    const u = this.u;
    u.uTime.value = now;
    const flow = snap.flow;
    this.feverK += ((flow.fever ? 1 : 0) - this.feverK) * Math.min(1, real * 4);
    this.adrenK += ((flow.adrenaline ? 1 : 0) - this.adrenK) * Math.min(1, real * 4);
    u.uFever.value = this.feverK;
    u.uAdrenaline.value = this.adrenK;
    // fever: the whole organ warms up (cheap light tint, no post-processing)
    if (Math.abs(this.feverK - this.lastFeverK) > 0.002) {
      this.lastFeverK = this.feverK;
      this.hemi.color.copy(this.hemiBase).lerp(this.warm, 0.38 * this.feverK);
      this.sun.color.copy(this.sunBase).lerp(this.warm, 0.25 * this.feverK);
    }
    const camMoving = this.rig.tick(real);
    if (camMoving) this.updateFog();
    fx.alphaDecals.begin();
    fx.glowDecals.begin();
    fx.sprites.begin();
    terrain.update(now, dt, flow.reversed, flow.warn, flow.fever, this.highlightCells.length > 0);
    this.towers!.update(snap, now, dt, fx);
    this.enemies!.update(snap, now, fx);
    this.hero!.update(snap, now, dt, this.heightAtFn, fx, terrain.info.coreX, terrain.info.coreY);
    this.projectiles!.update(snap, now, fx);
    this.frameDecals(snap, now, dt);
    fx.waves.emit(now, fx.glowDecals, fx.alphaDecals);
    fx.sparks.update(dt);
    fx.debris.update(dt);
    fx.bolts.update(now, this.rig.forward);
    fx.alphaDecals.end();
    fx.glowDecals.end();
    fx.sprites.end();
    const c1 = performance.now();
    gl.info.reset();
    gl.render(this.scene, this.rig.camera);
    const c2 = performance.now();
    this.statsOut.calls = gl.info.render.calls;
    this.statsOut.triangles = gl.info.render.triangles;
    this.overlay!.draw(snap, now, this.projectFn, this.towers!, this.hero!, { fever: this.feverK, adrenaline: this.adrenK }, real);
    const c3 = performance.now();
    this.cpuMs = c3 - c0;
    this.cpuAvg += (this.cpuMs - this.cpuAvg) * 0.05;
    this.syncAvg += (c1 - c0 - this.syncAvg) * 0.05;
    this.glAvg += (c2 - c1 - this.glAvg) * 0.05;
    this.overlayAvg += (c3 - c2 - this.overlayAvg) * 0.05;
  }

  private projectFn = (x: number, y: number, h: number, out: { x: number; y: number }): boolean => this.rig.projectWorld(x, h, y, out);
  private heightAtFn = (x: number, y: number): number => (this.terrain ? this.terrain.heightAt(x, y) : 0);

  private frameDecals(snap: RenderSnapshot, now: number, dt: number): void {
    const fx = this.fx!;
    const terrain = this.terrain!;
    const info = terrain.info;
    const p = this.pal;
    // core glow
    const core = this.lc.core ?? (this.lc.core = new Lin(p.core));
    core.set(p.core);
    fx.sprites.add(info.coreX, terrain.coreWorldY, info.coreY, 1.7 + Math.sin(now * 5.7) * 0.08 + terrain.coreFlash * 0.8, core.r, core.g, core.b, p.additive ? 0.32 : 0.22);
    // spawn portals
    for (let i = 0; i < info.entries.length; i += 2) {
      const ex = info.entries[i];
      const ey = info.entries[i + 1];
      fx.glowDecals.add(ex, -TD + 0.12, ey, 0.55, now * 1.5, 0.75, 0.35, 1.0, 0.75, Shape.Dashed, 0.18, 7);
      fx.glowDecals.add(ex, -TD + 0.11, ey, 0.5, 0, 0.55, 0.2, 0.9, 0.35, Shape.Blob);
    }
    // build highlights
    if (this.highlightCells.length) {
      const b = this.lc.build ?? (this.lc.build = new Lin(p.build));
      b.set(p.build);
      const k = 0.35 + 0.25 * Math.sin(now * 5);
      for (let i = 0; i < this.highlightCells.length; i++) {
        const [c, r] = this.highlightCells[i];
        const path = isPathCell(info, c, r);
        fx.glowDecals.add(c + 0.5, path ? -TD + 0.1 : WORLD.padHeight + 0.01, r + 0.5, path ? 0.42 : 0.48, 0, b.r, b.g, b.b, k, path ? Shape.Ring : Shape.Blob, 0.18);
      }
    }
    // pad selection ring
    const sel = snap.selection;
    if (sel && sel.kind === 'pad') {
      const s = this.lc.select ?? (this.lc.select = new Lin(p.select));
      s.set(p.select);
      const path = isPathCell(info, sel.col, sel.row);
      fx.glowDecals.add(sel.col + 0.5, path ? -TD + 0.11 : WORLD.padHeight + 0.012, sel.row + 0.5, 0.5, -now * 1.2, s.r, s.g, s.b, 0.95, Shape.Dashed, 0.12, 8);
    }
    // ability aim (antibiotic): reticle + targets inside
    if (snap.interaction === 'abilityTarget' && Number.isFinite(snap.cursorX) && Number.isFinite(snap.cursorY)) {
      const cx = snap.cursorX;
      const cy = snap.cursorY;
      fx.alphaDecals.add(cx, 0.07, cy, ANTIBIOTIC_RADIUS, 0, 1, 0.55, 0.2, 0.18, Shape.Disc, 0, 1);
      fx.glowDecals.add(cx, 0.08, cy, ANTIBIOTIC_RADIUS, now * 0.8, 1, 0.75, 0.3, 0.95, Shape.Reticle, 0.06, 0.4);
      const e = snap.enemies;
      for (let i = 0; i < e.count; i++) {
        const dx = e.x[i] - cx;
        const dy = e.y[i] - cy;
        if (dx * dx + dy * dy > ANTIBIOTIC_RADIUS * ANTIBIOTIC_RADIUS) continue;
        fx.glowDecals.add(e.x[i], -TD + 0.1, e.y[i], e.radius[i] * 1.6, 0, 1, 0.8, 0.3, 0.8, Shape.Ring, 0.25);
      }
    }
    // acid pools
    for (let ai = 0; ai < this.acid.length; ai++) {
      const a = this.acid[ai];
      if (!a.active) continue;
      if (snap.time >= a.until) {
        a.active = false;
        continue;
      }
      const left = Math.min(1, (a.until - snap.time) / 0.6);
      fx.alphaDecals.add(a.x, -TD + 0.09, a.y, a.r, 0, 0.75, 0.95, 0.15, 0.45 * left, Shape.Disc, 0.08, 0.9);
      if (this.rnd.next() < dt * 10) {
        const ang = this.rnd.next() * Math.PI * 2;
        const rr = this.rnd.next() * a.r;
        fx.sparks.emit(a.x + Math.cos(ang) * rr, -0.08, a.y + Math.sin(ang) * rr, 0, 0.3, 0, 0.6, 0.06, 0.12, 0.8, 1, 0.2, 0.7, 0, 1);
      }
    }
    // fever heat motes / adrenaline sparks
    if (this.feverK > 0.05 && dt > 0) {
      const n = this.rnd.next() < dt * 40 * this.feverK ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const x = this.rnd.range(0, info.cols);
        const y = this.rnd.range(0, info.rows);
        fx.sparks.emit(x, 0.05, y, this.rnd.sym(0.1), this.rnd.range(0.4, 0.8), this.rnd.sym(0.1), 1.4, 0.1, 0.18, 1.0, 0.45, 0.1, 0.55, -0.1, 0.3);
      }
    }
    if (this.adrenK > 0.05) {
      const beat = now % 0.8;
      const k = Math.exp(-beat * 7) * this.adrenK;
      for (let i = 0; i < snap.towerCount; i++) {
        const tv = snap.towers[i];
        if (tv.typeId === 'barrier') continue;
        fx.glowDecals.add(tv.x, WORLD.padHeight + 0.015, tv.y, 0.42 + beat * 0.45, 0, 1, 0.28, 0.22, 0.85 * k, Shape.Ring, 0.16);
      }
    }
    if (this.adrenK > 0.05 && dt > 0 && snap.towerCount > 0 && this.rnd.next() < dt * 30) {
      const tv = snap.towers[Math.floor(this.rnd.next() * snap.towerCount)];
      if (tv) fx.sparks.emit(tv.x + this.rnd.sym(0.25), 0.3, tv.y + this.rnd.sym(0.25), 0, 0.9, 0, 0.6, 0.08, 0.02, 1.0, 0.25, 0.2, 0.9, 0, 0.5);
    }
    // antibiotic pill
    if (this.pill.active) {
      const t = (now - this.pill.t0) / PILL_DELAY;
      if (t >= 1.15) this.pill.active = false;
      else {
        const k = Math.min(1, t);
        const hgt = 6 * (1 - k * k) + 0.2;
        fx.sprites.add(this.pill.x, hgt, this.pill.y, 0.6, 1, 0.55, 0.2, 0.9);
        fx.sprites.add(this.pill.x, hgt + 0.4, this.pill.y, 0.35, 1, 0.9, 0.7, 0.6);
        if (dt > 0) fx.sparks.emit(this.pill.x, hgt + 0.2, this.pill.y, this.rnd.sym(0.2), 0.5, this.rnd.sym(0.2), 0.35, 0.14, 0.04, 1, 0.7, 0.4, 0.8, 0, 1);
        fx.glowDecals.add(this.pill.x, 0.06, this.pill.y, ANTIBIOTIC_RADIUS * (1.2 - k * 0.2), now * 2, 1, 0.6, 0.25, 0.7, Shape.Reticle, 0.05, 0);
      }
    }
  }

  // ── events ────────────────────────────────────────────────────────────────

  /** Contract alias of `consumeEvents`. */
  handleEvents(events: readonly GameEvent[]): void {
    this.consumeEvents(events);
  }

  private markDead(id: number): boolean {
    for (let i = 0; i < this.deadIds.length; i++) if (this.deadIds[i] === id) return false;
    this.deadIds[this.deadNext] = id;
    this.deadNext = (this.deadNext + 1) % this.deadIds.length;
    return true;
  }

  private num(n: number): string {
    const v = Math.max(0, Math.round(n));
    if (v < 20000) {
      let s = this.dmgStr[v];
      if (s === undefined) s = this.dmgStr[v] = String(v);
      return s;
    }
    return String(v);
  }

  private burst(x: number, h: number, y: number, n: number, speed: number, life: number, size: number, c: Lin, glow = true, grav = 0): void {
    const fx = this.fx!;
    const p = glow ? fx.sparks : fx.debris;
    const cnt = Math.max(1, Math.round(n * p.density));
    for (let i = 0; i < cnt; i++) {
      const a = this.rnd.next() * Math.PI * 2;
      const up = this.rnd.range(0.2, 1);
      const sp = speed * this.rnd.range(0.4, 1);
      p.emit(x, h, y, Math.cos(a) * sp, up * sp, Math.sin(a) * sp, life * this.rnd.range(0.6, 1.2), size, size * 0.3, c.r, c.g, c.b, 0.95, grav, 2.2);
    }
  }

  private enemyAt(x: number, y: number): number {
    const s = this.lastSnap;
    if (!s) return 0.05;
    const e = s.enemies;
    let best = 0.4;
    let h = -TD + 0.22;
    for (let i = 0; i < e.count; i++) {
      const d = Math.abs(e.x[i] - x) + Math.abs(e.y[i] - y);
      if (d < best) {
        best = d;
        h = EnemyLayer.bodyHeight(e.type[i], e.radius[i], (e.flags[i] & EnemyViewFlag.Flying) !== 0);
      }
    }
    return h;
  }

  /** Spawns one-shot VFX / floating text for this frame's drained events (call before `update`). */
  consumeEvents(events: readonly GameEvent[]): void {
    if (!this.fx || !this.enemies || !this.towers || !this.terrain || !this.overlay) return;
    const fx = this.fx;
    const now = this.now;
    const ov = this.overlay;
    const lk = this.lk;
    const tk = this.tk;
    const tr = this.tr;
    let any = false;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      any = true;
      switch (ev.type) {
        case 'spawn':
          fx.waves.add(now, ev.x, -TD + 0.1, ev.y, 0.5, 0.1, 0.6, 0.7, 0.35, 1, 0.8, 0.25);
          break;
        case 'shoot': {
          if (this.towers.muzzle(ev.tower, tk)) {
            const c = this.towerLin[tk.type] ?? this.towerLin[0];
            fx.sparks.emit(tk.x, tk.h, tk.y, 0, 0.05, 0, 0.14, 0.42, 0.15, c.r, c.g, c.b, 0.95, 0, 0);
          }
          break;
        }
        case 'tracer': {
          const c = this.towerLin[TOWER_IDS.indexOf('tcell')];
          let x1 = ev.x1;
          let y1 = ev.y1;
          let h1 = 0.6;
          if (this.towers.muzzle(ev.tower, tk)) {
            x1 = tk.x;
            y1 = tk.y;
            h1 = tk.h;
          }
          const h2 = this.enemyAt(ev.x2, ev.y2);
          const sl = fx.bolts.begin(now, c.r, c.g, c.b, 0.06, 0.2, 0);
          fx.bolts.point(sl, x1, h1, y1);
          fx.bolts.point(sl, ev.x2, h2, ev.y2);
          this.burst(ev.x2, h2, ev.y2, 6, 1.6, 0.3, 0.12, c);
          break;
        }
        case 'chain': {
          const pts = ev.points;
          if (pts.length < 1) break;
          const ids = ev.ids;
          const c = this.towerLin[TOWER_IDS.indexOf('complement')];
          const sl = fx.bolts.begin(now, c.r, c.g, c.b, 0.05, 0.28, 0.16);
          const muzzle = this.towers.muzzle(ev.tower, tk);
          if (muzzle) fx.bolts.point(sl, tk.x, tk.h, tk.y);
          for (let k = 0; k < pts.length; k++) {
            const id = ids && k < ids.length ? ids[k] : 0;
            // points[0] is the tower origin (id −1): the muzzle already started the bolt there
            if (id < 0 && muzzle) continue;
            const hh = id >= 0 && ids && this.enemies.lookup(id, lk) ? lk.h : id < 0 ? 0.6 : this.enemyAt(pts[k].x, pts[k].y);
            fx.bolts.point(sl, pts[k].x, hh, pts[k].y);
            fx.sparks.emit(pts[k].x, hh, pts[k].y, 0, 0.1, 0, 0.18, 0.35, 0.1, c.r, c.g, c.b, 0.9, 0, 0);
          }
          break;
        }
        case 'hit': {
          this.enemies.flash(ev.enemy, now);
          const c = this.lc[ev.kind] ?? this.lc.hero;
          const hh = this.enemies.lookup(ev.enemy, lk) ? lk.h : this.enemyAt(ev.x, ev.y);
          this.burst(ev.x, hh, ev.y, ev.crit ? 7 : 3, 1.4, 0.3, 0.08, c);
          if (ev.dmg >= 10 && ov.options.damageNumbers) {
            ov.addText(ev.x, ev.y, hh + 0.35, this.num(ev.dmg), ev.crit ? '#ffe14d' : '#ffffff', ev.crit ? 17 : 13, now, ev.crit ? 1.0 : 0.8, ev.crit ? 40 : 30);
          }
          break;
        }
        case 'splash': {
          const k = ev.kind === 'ability' ? this.lc.ability : this.lc[ev.kind] ?? this.lc.mast;
          fx.waves.add(now, ev.x, -TD + 0.12, ev.y, 0.45, ev.radius * 0.25, ev.radius, k.r, k.g, k.b, 0.9, 0.14);
          fx.waves.add(now, ev.x, -TD + 0.11, ev.y, 0.35, ev.radius * 0.2, ev.radius * 0.9, k.r, k.g, k.b, 0.35, 1, Shape.Blob);
          this.burst(ev.x, 0.1, ev.y, 14, 2.4, 0.5, 0.11, k);
          this.burst(ev.x, 0.1, ev.y, 6, 1.6, 0.6, 0.07, k, false, 4);
          break;
        }
        case 'pulse': {
          const t = this.towers.muzzle(ev.tower, tk) ? tk.type : 0;
          const c = this.towerLin[t];
          fx.waves.add(now, ev.x, 0.05, ev.y, 0.6, 0.3, ev.range, c.r, c.g, c.b, 0.6, 0.08);
          break;
        }
        case 'immuneHit': {
          const hh = this.enemies.lookup(ev.enemy, lk) ? lk.h : 0.1;
          if (ov.options.labels) ov.addText(ev.x, ev.y, hh + 0.4, tr('fx_immune'), '#c9c2d6', 12, now, 0.7, 20);
          this.burst(ev.x, hh, ev.y, 3, 1, 0.25, 0.08, this.lc.beacon);
          break;
        }
        case 'engulf': {
          let tx = ev.x;
          let ty = ev.y;
          if (this.towers.muzzle(ev.tower, tk)) {
            tx = tk.x;
            ty = tk.y;
          }
          if (this.markDead(ev.enemy)) this.enemies.die(ev.enemy, now, 1, tx, ty, ENEMY_IDS.indexOf(ev.enemyType), ev.x, ev.y);
          this.towers.hitFlash(ev.tower, now);
          this.burst(tx, 0.35, ty, 10, 1.4, 0.5, 0.1, this.lc.macrophage);
          if (ov.options.labels) ov.addText(tx, ty, 0.9, tr('fx_engulfed'), '#7dffc8', 14, now, 1.0, 30);
          break;
        }
        case 'acid': {
          const a = this.acid.find((x) => !x.active) ?? this.acid[0];
          a.active = true;
          a.x = ev.x;
          a.y = ev.y;
          a.r = ev.radius;
          a.until = ev.until;
          this.burst(ev.x, 0.1, ev.y, 12, 1.8, 0.5, 0.1, this.lc.acid ?? (this.lc.acid = new Lin(SPEC_COLOR.enzymes)));
          break;
        }
        case 'mark': {
          if (this.enemies.lookup(ev.enemy, lk)) fx.sparks.emit(lk.x, lk.h + 0.15, lk.y, 0, 0.6, 0, 0.35, 0.16, 0.05, this.lc.mark.r, this.lc.mark.g, this.lc.mark.b, 0.9, 0, 1);
          break;
        }
        case 'execute': {
          const hh = this.enemies.lookup(ev.enemy, lk) ? lk.h : 0.1;
          const c = this.lc.mark;
          fx.waves.add(now, ev.x, -TD + 0.12, ev.y, 0.4, 0.1, 0.9, c.r, c.g, c.b, 1, 0.2);
          const sl = fx.bolts.begin(now, 1, 0.5, 1, 0.07, 0.25, 0);
          fx.bolts.point(sl, ev.x - 0.35, hh + 0.35, ev.y - 0.2);
          fx.bolts.point(sl, ev.x + 0.35, hh - 0.1, ev.y + 0.2);
          if (ov.options.labels) ov.addText(ev.x, ev.y, hh + 0.5, tr('fx_execute'), '#ff7ae0', 15, now, 1.0, 34);
          break;
        }
        case 'stun':
          fx.waves.add(now, ev.x, -TD + 0.12, ev.y, Math.min(0.6, ev.duration + 0.2), 0.2, 0.45, 1, 0.9, 0.3, 0.9, 0.25, Shape.Dashed);
          break;
        case 'kill': {
          const ti = ENEMY_IDS.indexOf(ev.enemyType);
          const c = this.enemyLin[ti] ?? this.enemyLin[0];
          const hh = this.enemies.lookup(ev.enemy, lk) ? lk.h : -TD + 0.2;
          if (this.markDead(ev.enemy)) this.enemies.die(ev.enemy, now, 0, 0, 0, ti, ev.x, ev.y);
          fx.sparks.emit(ev.x, hh, ev.y, 0, 0, 0, ev.boss ? 0.45 : 0.18, ev.boss ? 3.2 : 0.9, 0.2, c.r * 0.5 + 0.5, c.g * 0.5 + 0.5, c.b * 0.5 + 0.5, 0.9, 0, 0);
          this.burst(ev.x, hh, ev.y, ev.boss ? 60 : 10, ev.boss ? 3.5 : 1.8, ev.boss ? 1.0 : 0.5, ev.boss ? 0.2 : 0.11, c);
          this.burst(ev.x, hh, ev.y, ev.boss ? 30 : 5, ev.boss ? 2.5 : 1.4, 0.8, 0.07, c, false, 5);
          if (ev.boss) {
            const g = new Lin(ENEMY_COLORS[ev.enemyType].glow);
            fx.waves.add(now, ev.x, 0.05, ev.y, 1.0, 0.3, 3.2, g.r, g.g, g.b, 1, 0.12);
            fx.waves.add(now, ev.x, 0.05, ev.y, 0.7, 0.2, 2.2, 1, 1, 1, 0.8, 0.08);
            this.rig.shake = Math.max(this.rig.shake, 1);
          } else {
            fx.waves.add(now, ev.x, -TD + 0.1, ev.y, 0.35, 0.1, 0.55, c.r, c.g, c.b, 0.7, 0.2);
          }
          break;
        }
        case 'split': {
          const ti = ENEMY_IDS.indexOf(ev.enemyType);
          if (this.markDead(ev.parent)) this.enemies.die(ev.parent, now, 0, 0, 0, ti, ev.x, ev.y);
          const c = this.enemyLin[ti] ?? this.enemyLin[0];
          this.burst(ev.x, 0.05, ev.y, 12, 2, 0.45, 0.1, c);
          fx.waves.add(now, ev.x, -TD + 0.1, ev.y, 0.4, 0.1, 0.7, c.r, c.g, c.b, 0.8, 0.2);
          break;
        }
        case 'leak': {
          if (this.markDead(ev.enemy)) this.enemies.die(ev.enemy, now, 2, 0, 0, ENEMY_IDS.indexOf(ev.enemyType), this.terrain.info.coreX, this.terrain.info.coreY);
          this.terrain.coreFlash = 1;
          this.terrain.coreShake = 1;
          ov.flashLeak = 1;
          const info = this.terrain.info;
          const c = this.lc.leak ?? (this.lc.leak = new Lin(0xff3355));
          this.burst(info.coreX, 0.5, info.coreY, 18, 2.2, 0.6, 0.12, c);
          fx.waves.add(now, info.coreX, 0.05, info.coreY, 0.6, 0.4, 1.6, c.r, c.g, c.b, 0.9, 0.15);
          this.rig.shake = Math.max(this.rig.shake, 0.5);
          break;
        }
        case 'heal': {
          if (this.rnd.next() < 0.3 && this.enemies.lookup(ev.enemy, lk)) fx.sparks.emit(lk.x + this.rnd.sym(0.15), lk.h + 0.1, lk.y + this.rnd.sym(0.15), 0, 0.5, 0, 0.5, 0.1, 0.04, 0.5, 1, 0.4, 0.9, 0, 1);
          break;
        }
        case 'reveal': {
          if (ev.revealed && this.enemies.lookup(ev.enemy, lk)) fx.waves.add(now, lk.x, -TD + 0.12, lk.y, 0.4, 0.1, 0.5, 0.8, 0.6, 1, 0.8, 0.25);
          break;
        }
        case 'infect': {
          if (this.towers.muzzle(ev.tower, tk)) {
            this.burst(tk.x, tk.h, tk.y, 10, 1.2, 0.6, 0.1, this.lc.infect);
            if (ov.options.labels) ov.addText(tk.x, tk.y, tk.h + 0.45, tr('fx_infected'), '#b6ff3a', 12, now, 0.9, 24, ev.tower);
          }
          break;
        }
        case 'cure': {
          if (this.towers.muzzle(ev.tower, tk)) {
            const c = this.lc.cure;
            fx.waves.add(now, tk.x, WORLD.padHeight + 0.02, tk.y, 0.5, 0.2, 0.7, c.r, c.g, c.b, 0.9, 0.2);
            this.burst(tk.x, tk.h, tk.y, 10, 1.2, 0.6, 0.1, c);
            if (ov.options.labels) ov.addText(tk.x, tk.y, tk.h + 0.85, tr('fx_cured'), '#7dffb0', 13, now, 0.9, 24, ev.tower);
          }
          break;
        }
        case 'barrierHit': {
          if (this.rnd.next() < 0.12) {
            this.towers.hitFlash(ev.tower, now);
            if (this.towers.muzzle(ev.tower, tk)) this.burst(tk.x, -0.02, tk.y, 2, 1.2, 0.5, 0.07, this.lc.barrier, false, 4);
          }
          break;
        }
        case 'barrierBroken':
        case 'barrierSmashed': {
          const c = this.lc.barrier;
          this.burst(ev.x, 0.05, ev.y, 24, 2.6, 0.9, 0.1, c, false, 6);
          this.burst(ev.x, 0.05, ev.y, 10, 2, 0.5, 0.12, c);
          fx.waves.add(now, ev.x, -TD + 0.12, ev.y, 0.5, 0.2, 1.0, c.r, c.g, c.b, 0.9, 0.2);
          if (ov.options.labels) ov.addText(ev.x, ev.y, 0.6, tr(ev.type === 'barrierSmashed' ? 'fx_smashed' : 'fx_broken'), '#ffc080', 14, now, 1.1, 34);
          this.rig.shake = Math.max(this.rig.shake, ev.type === 'barrierSmashed' ? 0.7 : 0.3);
          break;
        }
        case 'build': {
          const c = this.towerLin[TOWER_IDS.indexOf(ev.kind)] ?? this.towerLin[0];
          const base = ev.kind === 'barrier' ? -TD + 0.1 : WORLD.padHeight + 0.01;
          fx.waves.add(now, ev.x, base, ev.y, 0.5, 0.2, 0.8, c.r, c.g, c.b, 1, 0.18);
          this.burst(ev.x, base + 0.2, ev.y, 14, 1.6, 0.6, 0.1, c);
          break;
        }
        case 'upgrade': {
          this.towers.upgradePulse(ev.tower, now);
          if (this.towers.muzzle(ev.tower, tk)) {
            const c = ev.spec ? new Lin(SPEC_COLOR[ev.spec]) : this.lc.atp;
            for (let k = 0; k < 16; k++) fx.sparks.emit(tk.x + this.rnd.sym(0.3), 0.15, tk.y + this.rnd.sym(0.3), 0, this.rnd.range(1, 2.2), 0, 0.8, 0.12, 0.03, c.r, c.g, c.b, 1, 0, 1.2);
            fx.waves.add(now, tk.x, WORLD.padHeight + 0.02, tk.y, 0.6, 0.2, 0.9, c.r, c.g, c.b, 1, 0.15);
          }
          break;
        }
        case 'sell': {
          const c = this.lc.atp;
          this.burst(ev.x, 0.3, ev.y, 14, 1.6, 0.6, 0.1, c);
          fx.waves.add(now, ev.x, WORLD.padHeight + 0.02, ev.y, 0.45, 0.4, 0.1, c.r, c.g, c.b, 0.9, 0.2);
          break;
        }
        case 'heroMove': {
          const c = this.lc.cure;
          fx.waves.add(now, ev.x, 0.05, ev.y, 0.4, 0.5, 0.15, c.r, c.g, c.b, 0.9, 0.2);
          break;
        }
        case 'heroAttack': {
          const hh = this.enemies.lookup(ev.enemy, lk) ? lk.h : 0.1;
          this.burst(ev.x, hh, ev.y, 4, 1.6, 0.25, 0.09, this.lc.hero);
          break;
        }
        case 'heroHurt':
          this.hero?.hurt();
          break;
        case 'heroDeath':
          this.burst(ev.x, 0.25, ev.y, 24, 2, 0.8, 0.12, this.lc.hero);
          fx.waves.add(now, ev.x, 0.05, ev.y, 0.6, 0.2, 1, 1, 1, 1, 0.8, 0.15);
          break;
        case 'heroRespawn': {
          this.hero?.pop(now);
          const c = this.lc.cure;
          fx.waves.add(now, ev.x, 0.05, ev.y, 0.6, 0.2, 1.1, c.r, c.g, c.b, 1, 0.15);
          this.burst(ev.x, 0.3, ev.y, 16, 1.4, 0.7, 0.1, this.lc.hero);
          break;
        }
        case 'heroLevel': {
          const hl = this.hero;
          if (hl) {
            const c = this.lc.atp;
            for (let k = 0; k < 20; k++) fx.sparks.emit(hl.x + this.rnd.sym(0.3), hl.h, hl.y + this.rnd.sym(0.3), this.rnd.sym(0.4), this.rnd.range(1, 2.4), this.rnd.sym(0.4), 0.9, 0.13, 0.03, c.r, c.g, c.b, 1, 0.5, 1);
            if (ov.options.labels) ov.addText(hl.x, hl.y, hl.h + 0.6, tr('fx_levelUp'), '#ffd34d', 15, now, 1.2, 36);
          }
          break;
        }
        case 'abilityCast': {
          const info = this.terrain.info;
          if (ev.ability === 'antibiotic' && ev.x !== undefined && ev.y !== undefined) {
            this.pill.active = true;
            this.pill.x = ev.x;
            this.pill.y = ev.y;
            this.pill.t0 = now;
          } else if (ev.ability === 'fever') {
            fx.waves.add(now, info.coreX, 0.05, info.coreY, 1.2, 0.5, Math.max(info.cols, info.rows) * 1.1, 1, 0.5, 0.15, 0.7, 0.05);
          } else if (ev.ability === 'adrenaline') {
            const s = this.lastSnap;
            if (s) {
              for (let k = 0; k < s.towerCount; k++) {
                const tv = s.towers[k];
                fx.waves.add(now, tv.x, WORLD.padHeight + 0.02, tv.y, 0.5, 0.2, 0.75, 1, 0.3, 0.25, 0.9, 0.18);
              }
            }
          } else if (ev.ability === 'booster') {
            ov.flashBooster = 1;
            const s = this.lastSnap;
            if (s) {
              const e = s.enemies;
              const c = this.lc.mark;
              for (let k = 0; k < e.count; k++) {
                if (e.markStacks[k] === 0) continue;
                fx.waves.add(now, e.x[k], -TD + 0.12, e.y[k], 0.5, 0.6, 0.15, c.r, c.g, c.b, 1, 0.25);
              }
            }
          }
          break;
        }
        case 'abilityImpact': {
          if (ev.ability === 'antibiotic') {
            this.pill.active = false;
            fx.waves.add(now, ev.x, 0.06, ev.y, 0.55, 0.2, ev.radius, 1, 0.85, 0.5, 1, 0.16);
            fx.waves.add(now, ev.x, 0.06, ev.y, 0.8, 0.3, ev.radius * 1.25, 1, 0.5, 0.2, 0.7, 0.08);
            fx.waves.add(now, ev.x, 0.05, ev.y, 0.45, 0.4, ev.radius, 1, 0.95, 0.85, 0.7, 1, Shape.Blob);
            const c = this.lc.ability;
            fx.sparks.emit(ev.x, 0.4, ev.y, 0, 0, 0, 0.35, 4.2, 1.0, 1, 0.85, 0.6, 1, 0, 0);
            fx.waves.add(now, ev.x, 0.07, ev.y, 0.35, 0.3, ev.radius * 0.9, 1, 1, 0.9, 0.9, 1, Shape.Disc);
            this.burst(ev.x, 0.15, ev.y, 36, 3.6, 0.8, 0.14, c);
            this.burst(ev.x, 0.15, ev.y, 14, 2.4, 0.9, 0.08, this.lc.hero, false, 5);
            this.rig.shake = Math.max(this.rig.shake, 0.8);
          } else if (ev.ability === 'booster') {
            const c = this.lc.mark;
            fx.waves.add(now, ev.x, 0.06, ev.y, 0.6, 0.2, Math.max(1, ev.radius), c.r, c.g, c.b, 1, 0.14);
          }
          break;
        }
        case 'bossSkill': {
          const g = new Lin(ENEMY_COLORS[ev.bossType].glow);
          if (ev.stage === 'telegraph') {
            if (ov.options.labels) {
              const hh = this.enemies.lookup(ev.boss, lk) ? lk.h + lk.r * 1.6 : 1;
              ov.addText(ev.x, ev.y, hh + 0.55, tr('skill_' + ev.skill), '#' + ENEMY_COLORS[ev.bossType].glow.toString(16).padStart(6, '0'), 15, now, 1.4, 22);
            }
            fx.waves.add(now, ev.x, -TD + 0.12, ev.y, 0.9, 0.3, 1.4, g.r, g.g, g.b, 0.9, 0.12, Shape.Dashed);
          } else if (ev.stage === 'start') {
            switch (ev.skill) {
              case 'massInfection': {
                const c = this.lc.infect;
                fx.waves.add(now, ev.x, 0.05, ev.y, 0.9, 0.3, 3.0, c.r, c.g, c.b, 1, 0.08);
                fx.waves.add(now, ev.x, 0.05, ev.y, 0.9, 0.3, 3.0, c.r, c.g, c.b, 0.3, 1, Shape.Blob);
                this.burst(ev.x, 0.4, ev.y, 30, 3, 0.9, 0.12, c);
                break;
              }
              case 'charge':
                this.burst(ev.x, 0.05, ev.y, 18, 2, 0.7, 0.12, this.lc.leak ?? (this.lc.leak = new Lin(0xff3355)), false, 3);
                this.rig.shake = Math.max(this.rig.shake, 0.4);
                break;
              case 'burrow':
                this.burst(ev.x, 0, ev.y, 22, 2.2, 0.8, 0.11, this.lc.dirt ?? (this.lc.dirt = new Lin(0x8a4a3a)), false, 6);
                break;
              case 'shellHardening':
                fx.waves.add(now, ev.x, -TD + 0.12, ev.y, 0.7, 0.8, 0.3, 0.8, 0.8, 0.85, 1, 0.25);
                this.burst(ev.x, 0.3, ev.y, 14, 1.4, 0.6, 0.1, this.lc.shell ?? (this.lc.shell = new Lin(0xd8dde8)));
                break;
              default:
                fx.waves.add(now, ev.x, -TD + 0.12, ev.y, 0.7, 0.3, 1.6, g.r, g.g, g.b, 1, 0.14);
                this.burst(ev.x, 0.3, ev.y, 20, 2, 0.7, 0.12, g);
            }
          } else if (ev.skill === 'burrow') {
            this.burst(ev.x, 0, ev.y, 22, 2.2, 0.8, 0.11, this.lc.dirt ?? (this.lc.dirt = new Lin(0x8a4a3a)), false, 6);
            this.rig.shake = Math.max(this.rig.shake, 0.4);
          }
          break;
        }
        case 'mutation': {
          if (this.enemies.lookup(ev.boss, lk)) {
            const c = this.towerLin[TOWER_IDS.indexOf(ev.immuneTo)] ?? this.towerLin[0];
            fx.waves.add(now, lk.x, -TD + 0.12, lk.y, 0.7, 0.3, 1.5, c.r, c.g, c.b, 1, 0.15);
            this.burst(lk.x, lk.h, lk.y, 20, 1.8, 0.7, 0.11, c);
          }
          break;
        }
        case 'flowReverse': {
          if (ev.reversed) {
            ov.flashFlow = 1;
            const info = this.terrain.info;
            if (ov.options.labels) ov.addText(info.cols / 2, info.rows * 0.45, 0.5, tr('fx_flowReverse'), '#9fe6ff', 18, now, 1.6, 20);
          }
          break;
        }
        case 'waveStart': {
          if (ov.options.banners) {
            const title = tr('fx_wave', { n: ev.wave });
            const sub = ev.boss ? tr('fx_bossIncoming', { name: tr('enemy_' + ev.boss) }) : '';
            ov.banner(title, sub, ev.boss ? ENEMY_COLORS[ev.boss].glow : 0xffffff, now);
          }
          if (this.qualityPref === 'auto' && (ev.wave === 1 || ev.wave === 5)) this.probeQuality();
          this.setIdle(false);
          break;
        }
        case 'atp': {
          if (ev.delta > 0 && Number.isFinite(ev.x) && Number.isFinite(ev.y) && ov.options.labels) ov.addText(ev.x, ev.y, 0.55, '+' + this.num(ev.delta), '#ffd34d', 12, now, 0.9, 26);
          break;
        }
        default:
          break;
      }
    }
    if (any) this.requestRedraw();
  }

  // ── diagnostics ───────────────────────────────────────────────────────────

  /** Draw calls / triangles of the last frame and the mean frame time of the last probe window. */
  stats(): RenderStats {
    return this.statsOut;
  }

  /** CPU time of the last `update` (ms), its moving average and the averaged split: scene sync / gl.render submit / 2D overlay. */
  cpuTime(): { last: number; avg: number; sync: number; gl: number; overlay: number } {
    return { last: this.cpuMs, avg: this.cpuAvg, sync: this.syncAvg, gl: this.glAvg, overlay: this.overlayAvg };
  }

  /** Whether VFX are still animating (UI can keep full frame rate until they settle). */
  get busy(): boolean {
    const fx = this.fx;
    if (!fx) return false;
    return fx.sparks.active > 0 || fx.debris.active > 0 || fx.bolts.live > 0 || fx.waves.live > 0 || (this.enemies?.dyingLive ?? 0) > 0 || (this.overlay?.busy ?? false);
  }

  get bannerShowing(): boolean {
    return this.overlay ? this.overlay.bannerActive(this.now) : false;
  }

  get domElement(): HTMLCanvasElement | null {
    return this.gl ? this.gl.domElement : null;
  }

  /** Test hook: the underlying WebGLRenderer (dev harness / smoke tests only). */
  get webgl(): WebGLRenderer | null {
    return this.gl;
  }
}

function makeEmptySnapshot(): RenderSnapshot {
  const cap = 1;
  return {
    time: 0,
    alpha: 0,
    phase: 'build',
    wave: 0,
    enemies: {
      capacity: cap,
      count: 0,
      id: new Int32Array(cap),
      type: new Uint8Array(cap),
      x: new Float32Array(cap),
      y: new Float32Array(cap),
      angle: new Float32Array(cap),
      hpFrac: new Float32Array(cap),
      radius: new Float32Array(cap),
      flags: new Uint16Array(cap),
      markStacks: new Uint8Array(cap),
      slow: new Float32Array(cap),
      immuneTo: new Uint8Array(cap),
      telegraph: new Float32Array(cap),
      segStart: new Int32Array(cap),
      segCount: new Uint8Array(cap),
      segCapacity: cap,
      segTotal: 0,
      segX: new Float32Array(cap),
      segY: new Float32Array(cap),
      segAngle: new Float32Array(cap),
    },
    towers: [],
    towerCount: 0,
    projectiles: { capacity: cap, count: 0, kind: new Uint8Array(cap), x: new Float32Array(cap), y: new Float32Array(cap), h: new Float32Array(cap), angle: new Float32Array(cap) },
    hero: { x: 0, y: 0, angle: 0, hpFrac: 1, level: 1, xpFrac: 0, alive: false, respawnFrac: 0, moving: false, attacking: false, destX: NaN, destY: NaN, curing: false },
    flow: { breathing: false, reversed: false, warn: false, fever: false, adrenaline: false },
    selection: null,
    interaction: 'none',
    cursorX: NaN,
    cursorY: NaN,
  };
}

/** `CreateRenderer` (types.ts §11.8): mounts a renderer for `map` inside `container`. */
const createRenderer: CreateRenderer = (container, map, opts: RendererOptions) => {
  const r = new Renderer({ lang: opts.lang, t: opts.t });
  r.setMap(map);
  r.mount(container, { theme: opts.theme, quality: opts.quality, lang: opts.lang, t: opts.t, onContextLost: opts.onContextLost });
  return r;
};

export default createRenderer;
export { createRenderer };
