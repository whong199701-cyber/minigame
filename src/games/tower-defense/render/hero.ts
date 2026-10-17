/**
 * Blanc (小白): a cute white blob with big eyes. Hops while walking (leaving a soft white trail), lunges while
 * attacking, keeps its face turned toward the camera side so the eyes stay readable, fades out on death and pops back
 * in at the core (respawn progress arc). Destination marker, cure aura and selection ring go to the decal layers.
 */
import { Mesh, Object3D, type MeshStandardMaterial } from 'three';
import type { RenderSnapshot } from '../types';
import { Shape, type FxLayers } from './effects';
import { createCellMaterial, type SharedUniforms } from './materials';
import { buildHeroModel } from './models';
import { CURE, type Palette } from './palette';
import { Lin, clamp } from './util';

const FACE_CAMERA = -Math.PI / 2;
/** Blanc is drawn larger than a pathogen so he is easy to find and tap. */
const HERO_SCALE = 1.3;

export class HeroLayer {
  readonly root = new Object3D();
  readonly mesh: Mesh;
  private mat: MeshStandardMaterial;
  private yaw = FACE_CAMERA;
  private trailT = 0;
  private hurtT = 0;
  private wasAlive = true;
  private popT = -10;
  private cure = new Lin(CURE);
  private sel = new Lin(0xffffff);
  private shadow = new Lin(0);
  private shadowA = 0.4;
  /** World position of the body centre (for overlay / VFX). */
  x = 0;
  y = 0;
  h = 0.25;
  visible = false;

  constructor(u: SharedUniforms, shadows: boolean) {
    this.mat = createCellMaterial('hero', u, { flat: false, roughness: 0.5 });
    this.mat.transparent = true;
    this.mesh = new Mesh(buildHeroModel(), this.mat);
    this.mesh.castShadow = shadows;
    this.mesh.renderOrder = 4;
    this.root.add(this.mesh);
  }

  setShadows(on: boolean): void {
    this.mesh.castShadow = on;
  }

  applyPalette(p: Palette): void {
    this.sel.set(p.select);
    this.shadow.set(p.shadow);
    this.shadowA = p.shadowAlpha;
  }

  hurt(): void {
    this.hurtT = 0.25;
  }

  pop(now: number): void {
    this.popT = now;
  }

  update(snap: RenderSnapshot, now: number, dt: number, heightAt: (x: number, y: number) => number, fx: FxLayers, coreX: number, coreY: number): void {
    const hv = snap.hero;
    const alive = hv.alive;
    if (alive && !this.wasAlive) this.popT = now;
    this.wasAlive = alive;
    if (!alive) {
      this.mesh.visible = false;
      this.visible = false;
      // respawn progress arc at his post beside the core (the snapshot reports it as a dead hero's position)
      const c = this.cure;
      const px = Number.isFinite(hv.x) ? hv.x : coreX;
      const py = Number.isFinite(hv.y) ? hv.y : coreY;
      fx.glowDecals.add(px, Math.max(heightAt(px, py), 0) + 0.08, py, 0.62, 0, c.r, c.g, c.b, 0.85, Shape.Arc, 0.14, clamp(hv.respawnFrac, 0, 1));
      return;
    }
    this.visible = true;
    this.mesh.visible = true;
    const ground = Math.max(heightAt(hv.x, hv.y), -0.18);
    const lvlS = HERO_SCALE * (hv.level === 3 ? 1.14 : hv.level === 2 ? 1.07 : 1);
    let sx = lvlS;
    let sy = lvlS;
    let hop = 0;
    let tilt = 0;
    if (hv.moving) {
      const ph = now * 11;
      hop = Math.abs(Math.sin(ph)) * 0.08;
      const land = Math.max(0, Math.cos(ph * 2)) * 0.06;
      sy *= 1 + hop * 0.6 - land;
      sx *= 1 - hop * 0.3 + land * 0.6;
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.035;
        fx.sparks.emit(hv.x, ground + 0.08, hv.y, 0, 0.15, 0, 0.55, 0.11, 0.02, 0.9, 0.95, 1.0, 0.55, 0, 2);
      }
    } else {
      const b = Math.sin(now * 2.4);
      sy *= 1 + 0.03 * b;
      sx *= 1 - 0.02 * b;
    }
    if (hv.attacking) {
      const k = Math.max(0, Math.sin(now * 10));
      tilt = -0.3 * k;
      sx *= 1 + 0.08 * k;
    }
    const pt = (now - this.popT) / 0.4;
    if (pt >= 0 && pt < 1) {
      const e = 1 + 2.70158 * Math.pow(pt - 1, 3) + 1.70158 * Math.pow(pt - 1, 2);
      sx *= Math.max(0.01, e);
      sy *= Math.max(0.01, e);
    }
    // facing: toward the heading but never fully away from the camera
    let want = -hv.angle;
    let rel = Math.atan2(Math.sin(want - FACE_CAMERA), Math.cos(want - FACE_CAMERA));
    rel = clamp(rel, -1.15, 1.15);
    if (!hv.moving && !hv.attacking) rel *= 0.35;
    want = FACE_CAMERA + rel;
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 10);
    const m = this.mesh;
    m.position.set(hv.x, ground + hop, hv.y);
    m.rotation.set(0, this.yaw, tilt, 'YXZ');
    m.scale.set(sx, sy, sx);
    this.x = hv.x;
    this.y = hv.y;
    this.h = ground + hop + 0.24 * sy;
    // hurt flash
    if (this.hurtT > 0) this.hurtT = Math.max(0, this.hurtT - dt);
    const hk = this.hurtT / 0.25;
    this.mat.emissive.setRGB(hk * 0.9, hk * 0.1, hk * 0.15);
    this.mat.opacity = 1;
    // decals
    const sh = this.shadow;
    fx.alphaDecals.add(hv.x, ground + 0.015, hv.y, 0.26 * lvlS * (1 - hop), 0, sh.r, sh.g, sh.b, this.shadowA * 0.9, Shape.Blob);
    if (hv.curing) {
      const c = this.cure;
      fx.glowDecals.add(hv.x, ground + 0.03, hv.y, 0.6 + 0.08 * Math.sin(now * 8), now * 2, c.r, c.g, c.b, 0.8, Shape.Dashed, 0.12, 10);
    }
    if (hv.moving && !Number.isNaN(hv.destX)) {
      const c = this.cure;
      const gy = Math.max(heightAt(hv.destX, hv.destY), -0.15) + 0.03;
      fx.glowDecals.add(hv.destX, gy, hv.destY, 0.32 + 0.05 * Math.sin(now * 6), now, c.r * 0.6 + 0.4, c.g * 0.6 + 0.4, c.b * 0.6 + 0.4, 0.85, Shape.Reticle, 0.12);
    }
    const sel = snap.selection;
    if ((sel && sel.kind === 'hero') || snap.interaction === 'heroMove') {
      const c = this.sel;
      fx.glowDecals.add(hv.x, ground + 0.03, hv.y, 0.5, -now * 1.4, c.r, c.g, c.b, 0.9, Shape.Dashed, 0.14, 8);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.root.clear();
  }
}
