/**
 * Fixed oblique perspective camera (CAMERA in types.ts: pitch 58°, yaw 8°, FOV 30°). Default framing fits the map
 * width (+0.5-cell margin) and, when the whole map does not fit the visible strip, anchors the core-side edge so at
 * least CAMERA.defaultViewFromCore of the height is visible. Pinch zoom 1×–2× and drag pan are clamped so the map
 * never leaves the viewport. All maths is allocation-free.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { CAMERA } from '../types';
import { clamp } from './util';

const DEG = Math.PI / 180;
/** Extra world margin above the far row (tall far towers, HP bars) and below the near row. */
const FAR_MARGIN = 0.9;
const NEAR_MARGIN = 0.35;
/** Default framing keeps every pad ring (radius ≈ 0.43 cells) this far inside the left / right screen edges. */
const PAD_FIT_RADIUS = 0.45;
const PAD_FIT_MARGIN_PX = 3;
const PAD_Y = 0.12;

export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly target = new Vector3();
  zoom = 1;
  w = 1;
  h = 1;
  insetTop = 0;
  insetBottom = 0;
  shake = 0;
  private baseDist = 20;
  private cols = 9;
  private rows = 13;
  private back = new Vector3();
  private v = new Vector3();
  private p0 = new Vector3();
  private p1 = new Vector3();
  private ext = { l: 0, r: 0, t: 0, b: 0 };
  private extDirty = true;
  private animFrom = new Vector3();
  private animTo = new Vector3();
  private animT = 1;
  private animDur = 0.25;
  private shakeT = 0;
  /** Pad centres (x, z pairs) the default framing keeps on screen (setPads). */
  private padXZ = new Float32Array(0);
  /** Target x of the last default framing: the horizontal clamp always admits it (pads centred, see fit). */
  private fitX = NaN;
  readonly forward = new Vector3();

  constructor() {
    this.camera = new PerspectiveCamera(CAMERA.fovDeg, 1, 0.5, 400);
    const pitch = CAMERA.pitchDeg * DEG;
    const yaw = CAMERA.yawDeg * DEG;
    this.back.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
    this.forward.copy(this.back).negate();
  }

  get dist(): number {
    return this.baseDist / this.zoom;
  }

  get animating(): boolean {
    return this.animT < 1;
  }

  setViewport(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.extDirty = true;
  }

  setInsets(top: number, bottom: number): void {
    this.insetTop = Math.max(0, top);
    this.insetBottom = Math.max(0, bottom);
    this.extDirty = true;
  }

  setMap(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.fitX = NaN;
    this.extDirty = true;
  }

  /**
   * Buildable cells (pads + villi) the default framing must keep fully on screen. With yaw and perspective the near
   * rows are wider than the fitted centre row, so without this the near-left edge pads (Gut (0,12), Brain (0,13))
   * were half outside the viewport at zoom 1, where horizontal pan is clamped.
   */
  setPads(cells: readonly (readonly [number, number])[]): void {
    const a = new Float32Array(cells.length * 2);
    cells.forEach(([c, r], i) => {
      a[i * 2] = c + 0.5;
      a[i * 2 + 1] = r + 0.5;
    });
    this.padXZ = a;
    this.extDirty = true;
  }

  /** Screen-x span (CSS px) of every pad ring at the current pose; false without pads. */
  private padSpan(out: { lo: number; hi: number }): boolean {
    const a = this.padXZ;
    if (!a.length) return false;
    const pt = { x: 0, y: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < a.length; i += 2) {
      this.projectWorld(a[i] - PAD_FIT_RADIUS, PAD_Y, a[i + 1], pt);
      if (pt.x < lo) lo = pt.x;
      this.projectWorld(a[i] + PAD_FIT_RADIUS, PAD_Y, a[i + 1], pt);
      if (pt.x > hi) hi = pt.x;
    }
    out.lo = lo;
    out.hi = hi;
    return true;
  }

  apply(): void {
    const d = this.dist;
    const c = this.camera;
    c.position.copy(this.target).addScaledVector(this.back, d);
    if (this.shake > 0.001) {
      this.shakeT += 1;
      const s = this.shake * 0.12;
      c.position.x += Math.sin(this.shakeT * 2.1) * s;
      c.position.y += Math.cos(this.shakeT * 2.7) * s * 0.5;
      c.position.z += Math.sin(this.shakeT * 1.7 + 1) * s;
    }
    c.lookAt(this.target);
    c.near = Math.max(0.5, d - 30);
    c.far = d + 60;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }

  /** Ray (origin = camera position, direction) through a screen point (CSS px). */
  rayDir(sx: number, sy: number, out: Vector3): Vector3 {
    const ndcX = (sx / this.w) * 2 - 1;
    const ndcY = 1 - (sy / this.h) * 2;
    out.set(ndcX, ndcY, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    return out;
  }

  /** Intersects the screen ray with the horizontal plane y = planeY; out = world point. */
  floorAt(sx: number, sy: number, planeY: number, out: Vector3): boolean {
    this.rayDir(sx, sy, this.v);
    const o = this.camera.position;
    if (Math.abs(this.v.y) < 1e-5) return false;
    const t = (planeY - o.y) / this.v.y;
    if (t <= 0) return false;
    out.copy(o).addScaledVector(this.v, t);
    return true;
  }

  /** Projects world (x, y, z) to CSS px; false when behind the camera or well outside the viewport. */
  projectWorld(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    this.v.set(x, y, z).project(this.camera);
    out.x = (this.v.x + 1) * 0.5 * this.w;
    out.y = (1 - this.v.y) * 0.5 * this.h;
    return this.v.z < 1 && this.v.x > -1.15 && this.v.x < 1.15 && this.v.y > -1.15 && this.v.y < 1.15;
  }

  private stripTop(): number {
    return this.insetTop;
  }
  private stripBottom(): number {
    return this.h - this.insetBottom;
  }

  /** World units per CSS px (vertical, on the floor near the target). */
  private worldPerPx(): number {
    return (2 * this.dist * Math.tan((CAMERA.fovDeg * DEG) / 2)) / this.h;
  }

  private computeExtents(): void {
    this.apply();
    const midY = (this.stripTop() + this.stripBottom()) / 2;
    const t = this.target;
    const e = this.ext;
    e.l = this.floorAt(0, midY, 0, this.p0) ? this.p0.x - t.x : -10;
    e.r = this.floorAt(this.w, midY, 0, this.p0) ? this.p0.x - t.x : 10;
    e.t = this.floorAt(this.w / 2, this.stripTop() + 4, 0, this.p0) ? this.p0.z - t.z : -10;
    e.b = this.floorAt(this.w / 2, this.stripBottom() - 4, 0, this.p0) ? this.p0.z - t.z : 10;
    this.extDirty = false;
  }

  clampTarget(t: Vector3 = this.target): void {
    if (this.extDirty) this.computeExtents();
    const e = this.ext;
    const m = CAMERA.marginCells;
    const ax = -m - e.l;
    const bx = this.cols + m - e.r;
    const fx = Number.isFinite(this.fitX) ? this.fitX : ax;
    t.x = clamp(t.x, Math.min(ax, bx, fx), Math.max(ax, bx, fx));
    const az = -FAR_MARGIN - e.t;
    const bz = this.rows + NEAR_MARGIN - e.b;
    t.z = clamp(t.z, Math.min(az, bz), Math.max(az, bz));
    t.y = 0;
  }

  /** Default framing (see file header). */
  fit(): void {
    const tanH = Math.tan((CAMERA.fovDeg * DEG) / 2);
    const aspect = this.w / this.h;
    const stripH = Math.max(1, this.stripBottom() - this.stripTop());
    const stripFrac = stripH / this.h;
    const needW = this.cols + 2 * CAMERA.marginCells;
    const dW = needW / (2 * tanH * aspect);
    const sinP = Math.sin(CAMERA.pitchDeg * DEG);
    const needH = CAMERA.defaultViewFromCore * this.rows + NEAR_MARGIN;
    const dH = (needH * sinP) / (2 * tanH * stripFrac);
    this.baseDist = Math.max(dW, dH);
    this.zoom = 1;
    this.target.set(this.cols / 2, 0, this.rows / 2);
    this.extDirty = true;
    this.apply();
    const span = { lo: 0, hi: 0 };
    const avail = this.w - 2 * PAD_FIT_MARGIN_PX;
    for (let pass = 0; pass < 4; pass++) {
      this.place(stripH, sinP);
      // widen until every pad ring fits between the screen edges (screen size scales ~ 1 / distance)
      if (!this.padSpan(span) || span.hi - span.lo <= avail + 0.5) break;
      this.baseDist *= (span.hi - span.lo) / avail;
      this.apply();
    }
    // centre the pads horizontally (yaw slants the footprint: the near rows sit further left than the far rows)
    for (let it = 0; it < 3 && this.padSpan(span); it++) {
      this.target.x += ((span.lo + span.hi) / 2 - this.w / 2) * this.worldPerPx();
      this.apply();
    }
    this.fitX = this.target.x;
    this.extDirty = true;
    this.clampTarget();
    this.animT = 1;
    this.apply();
  }

  /** Vertical placement: centre the whole map in the strip when it fits, else anchor the core edge at the bottom. */
  private place(stripH: number, sinP: number): void {
    const pt = { x: 0, y: 0 };
    for (let it = 0; it < 4; it++) {
      this.projectWorld(this.cols / 2, 0, -FAR_MARGIN, pt);
      const top = pt.y;
      this.projectWorld(this.cols / 2, 0, this.rows + NEAR_MARGIN, pt);
      const bot = pt.y;
      let shift: number;
      if (bot - top <= stripH) shift = (top + bot) / 2 - (this.stripTop() + this.stripBottom()) / 2;
      else shift = bot - this.stripBottom();
      this.projectWorld(this.cols / 2, 0, this.rows / 2, pt);
      const sx = pt.x - this.w / 2;
      const k = this.worldPerPx();
      this.target.z += (shift * k) / sinP;
      this.target.x += sx * k;
      this.apply();
    }
  }

  panBy(dx: number, dy: number): void {
    const cx = this.w / 2;
    const cy = this.h / 2;
    if (!this.floorAt(cx, cy, 0, this.p0) || !this.floorAt(cx + dx, cy + dy, 0, this.p1)) return;
    this.target.x -= this.p1.x - this.p0.x;
    this.target.z -= this.p1.z - this.p0.z;
    this.animT = 1;
    this.clampTarget();
    this.apply();
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const z = clamp(this.zoom * factor, CAMERA.minZoom, CAMERA.maxZoom);
    if (z === this.zoom) return;
    const okA = this.floorAt(sx, sy, 0, this.p0);
    this.zoom = z;
    this.extDirty = true;
    this.apply();
    if (okA && this.floorAt(sx, sy, 0, this.p1)) {
      this.target.x += this.p0.x - this.p1.x;
      this.target.z += this.p0.z - this.p1.z;
    }
    this.animT = 1;
    this.clampTarget();
    this.apply();
  }

  /** Animated clamped pan so world (x, y) lands at vertical fraction `fy` of the visible strip. */
  centerOn(x: number, y: number, fy = 0.45, ms: number = CAMERA.panMs): void {
    const sy = this.stripTop() + fy * (this.stripBottom() - this.stripTop());
    if (!this.floorAt(this.w / 2, sy, 0, this.p0)) return;
    this.animFrom.copy(this.target);
    this.animTo.copy(this.target);
    this.animTo.x += x - this.p0.x;
    this.animTo.z += y - this.p0.z;
    this.clampTarget(this.animTo);
    this.animDur = Math.max(0.001, ms / 1000);
    this.animT = 0;
  }

  /** Eases the camera back inside the clamp (after the insets changed) without changing the zoom. */
  settle(ms: number = CAMERA.panMs): void {
    this.extDirty = true;
    this.animFrom.copy(this.target);
    this.animTo.copy(this.target);
    this.clampTarget(this.animTo);
    if (this.animTo.distanceToSquared(this.target) < 1e-6) return;
    this.animDur = Math.max(0.001, ms / 1000);
    this.animT = 0;
  }

  /** Advances the pan animation and shake; returns true while something moves. */
  tick(dt: number): boolean {
    let moving = false;
    if (this.animT < 1) {
      this.animT = Math.min(1, this.animT + dt / this.animDur);
      const e = 1 - Math.pow(1 - this.animT, 3);
      this.target.lerpVectors(this.animFrom, this.animTo, e);
      moving = true;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      moving = true;
    }
    this.apply();
    return moving;
  }
}
