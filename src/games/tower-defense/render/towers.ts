/**
 * Towers: one InstancedMesh per (type, variant) for the merged body and one for the spinning part (orbiting orbs,
 * halo rings, flame crown, spec emblem). Per-instance FX: fire flash / recoil squash, infection tint + wobble, beacon
 * buff rim, selection rim, macrophage charge / digestion, barrier damage. Build pop-in and upgrade pulse are
 * renderer-side animations keyed by tower id. Also draws auras (pyrogen heat disc, beacon buff ring), the selection
 * ring + range disc and the translucent ghost of a previewed build.
 */
import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, type Material } from 'three';
import { TOWER_IDS, WORLD, type RenderSnapshot, type TowerId, type TowerView } from '../types';
import { Shape, type FxLayers } from './effects';
import type { MapInfo } from './mapgeom';
import { createCellMaterial, type SharedUniforms } from './materials';
import { VARIANTS_PER_TYPE, buildTowerModel, variantOf, type TowerModel } from './models';
import { TOWER_ACCENT, type Palette } from './palette';
import { IdTable, Lin, writeTRS2 } from './util';

const CAP = 40;
/** Global model scale on top of the per-level growth (silhouettes read better slightly larger than the pad). */
const TS = 1.15;
const PAD_Y = WORLD.padHeight;
const TD = WORLD.trenchDepth;

const C_X = 0;
const C_Y = 1;
const C_YAW = 2;
const C_VAR = 3;
const C_BUILD = 4;
const C_UPG = 5;
const C_FLASH = 6;
const C_BASE = 7;
const C_TYPE = 8;
const CH = 9;

/** Base L1 ranges (spec §2) used only for the ghost preview disc when the UI does not pass one. */
export const GHOST_RANGE: Record<TowerId, number> = {
  antibody: 2.6,
  macrophage: 1.6,
  mast: 2.2,
  pyrogen: 1.9,
  tcell: 4.0,
  complement: 2.4,
  beacon: 2.0,
  barrier: 0,
};

const FACES: Record<TowerId, boolean> = {
  antibody: true,
  macrophage: true,
  mast: false,
  pyrogen: false,
  tcell: true,
  complement: false,
  beacon: false,
  barrier: false,
};

const SPIN_SPEED: Record<TowerId, number> = {
  antibody: 1.4,
  macrophage: 1.2,
  mast: 0.9,
  pyrogen: 0.55,
  tcell: 1.4,
  complement: 1.8,
  beacon: 1.1,
  barrier: 1.2,
};

/** Height (world cells above the tower's base) of a model's silhouette top: body and spinning part (spec emblem). */
export function silhouetteHeight(model: TowerModel): number {
  model.body.computeBoundingBox();
  let y = model.body.boundingBox ? model.body.boundingBox.max.y : 0;
  if (model.spin) {
    model.spin.computeBoundingBox();
    if (model.spin.boundingBox) y = Math.max(y, model.spin.boundingBox.max.y);
  }
  return y * TS;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export class TowerLayer {
  readonly root = new Object3D();
  private models: TowerModel[] = [];
  /** `silhouetteHeight` per model (index type × VARIANTS_PER_TYPE + variant). */
  private silH: number[] = [];
  private bodies: InstancedMesh[] = [];
  private spins: (InstancedMesh | null)[] = [];
  private fxA: Float32Array[] = [];
  private fxB: Float32Array[] = [];
  private attA: InstancedBufferAttribute[] = [];
  private attB: InstancedBufferAttribute[] = [];
  private sfxA: (Float32Array | null)[] = [];
  private sfxB: (Float32Array | null)[] = [];
  private sattA: (InstancedBufferAttribute | null)[] = [];
  private sattB: (InstancedBufferAttribute | null)[] = [];
  private counts: Int32Array;
  private mat: Material;
  private ghostMat: MeshBasicMaterial;
  private ghost: Mesh;
  private cur = new IdTable(128, CH);
  private prev = new IdTable(128, CH);
  private accent: Lin[];
  private rangeFill = new Lin();
  private rangeEdge = new Lin();
  private selectCol = new Lin();
  private firstFrame = true;
  ghostRange: number | null = null;
  info: MapInfo | null = null;

  constructor(u: SharedUniforms, shadows: boolean) {
    this.mat = createCellMaterial('tower', u, { flat: true, roughness: 0.48 });
    const total = TOWER_IDS.length * VARIANTS_PER_TYPE;
    this.counts = new Int32Array(total);
    for (let t = 0; t < TOWER_IDS.length; t++) {
      for (let v = 0; v < VARIANTS_PER_TYPE; v++) {
        const model = buildTowerModel(TOWER_IDS[t], v);
        this.models.push(model);
        this.silH.push(silhouetteHeight(model));
        const mk = (g: typeof model.body): [InstancedMesh, Float32Array, Float32Array, InstancedBufferAttribute, InstancedBufferAttribute] => {
          const fa = new Float32Array(CAP * 4);
          const fb = new Float32Array(CAP * 4);
          const aa = new InstancedBufferAttribute(fa, 4).setUsage(DynamicDrawUsage);
          const ab = new InstancedBufferAttribute(fb, 4).setUsage(DynamicDrawUsage);
          g.setAttribute('iFx', aa);
          g.setAttribute('iFx2', ab);
          const m = new InstancedMesh(g, this.mat, CAP);
          m.instanceMatrix.setUsage(DynamicDrawUsage);
          m.count = 0;
          m.visible = false;
          m.frustumCulled = false;
          m.castShadow = shadows;
          m.receiveShadow = false;
          this.root.add(m);
          return [m, fa, fb, aa, ab];
        };
        const [bm, fa, fb, aa, ab] = mk(model.body);
        this.bodies.push(bm);
        this.fxA.push(fa);
        this.fxB.push(fb);
        this.attA.push(aa);
        this.attB.push(ab);
        if (model.spin) {
          const [sm, sa, sb, saa, sab] = mk(model.spin);
          sm.castShadow = false;
          this.spins.push(sm);
          this.sfxA.push(sa);
          this.sfxB.push(sb);
          this.sattA.push(saa);
          this.sattB.push(sab);
        } else {
          this.spins.push(null);
          this.sfxA.push(null);
          this.sfxB.push(null);
          this.sattA.push(null);
          this.sattB.push(null);
        }
      }
    }
    this.ghostMat = new MeshBasicMaterial({ color: 0x7dfff0, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false });
    this.ghost = new Mesh(this.models[0].body, this.ghostMat);
    this.ghost.visible = false;
    this.ghost.renderOrder = 6;
    this.root.add(this.ghost);
    this.accent = TOWER_IDS.map((t) => new Lin(TOWER_ACCENT[t]));
  }

  setShadows(on: boolean): void {
    for (const m of this.bodies) m.castShadow = on;
  }

  applyPalette(p: Palette): void {
    this.rangeFill.set(p.rangeFill);
    this.rangeEdge.set(p.rangeEdge);
    this.selectCol.set(p.select);
    this.ghostMat.color.setHex(p.build);
  }

  resetAnimations(): void {
    this.firstFrame = true;
  }

  // ── event hooks ──
  upgradePulse(id: number, now: number): void {
    const s = this.cur.find(id);
    if (s >= 0) this.cur.vals[s * CH + C_UPG] = now;
  }
  hitFlash(id: number, now: number): void {
    const s = this.cur.find(id);
    if (s >= 0) this.cur.vals[s * CH + C_FLASH] = now + 0.15;
  }
  /** World position of a tower's muzzle (x, height, y in logic terms). */
  muzzle(id: number, out: { x: number; y: number; h: number; type: number }): boolean {
    const s = this.cur.find(id);
    if (s < 0) return false;
    const v = this.cur.vals;
    const o = s * CH;
    const model = this.models[v[o + C_VAR]];
    const yaw = v[o + C_YAW];
    const mx = model.muzzle[0] * TS;
    const mz = model.muzzle[2] * TS;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    out.x = v[o + C_X] + c * mx + sn * mz;
    out.y = v[o + C_Y] - sn * mx + c * mz;
    out.h = v[o + C_BASE] + model.muzzle[1] * TS;
    out.type = v[o + C_TYPE];
    return true;
  }
  /** Top of a tower model (HP bars / glyphs), or -1. */
  topOf(view: TowerView): number {
    const v = variantOf(view.typeId, view.level, view.spec);
    const model = this.models[view.type * VARIANTS_PER_TYPE + v];
    return (view.typeId === 'barrier' ? -TD : PAD_Y) + (model ? model.height * TS : 0.6);
  }

  /** World height of a tower's silhouette top (model + floating spec emblem): the body pick proxy's top (§11.8). */
  silhouetteTop(view: TowerView): number {
    const i = view.type * VARIANTS_PER_TYPE + variantOf(view.typeId, view.level, view.spec);
    return (view.typeId === 'barrier' ? -TD : PAD_Y) + (this.silH[i] ?? 0.6);
  }

  update(snap: RenderSnapshot, now: number, dt: number, fx: FxLayers): void {
    const t = this.prev;
    this.prev = this.cur;
    this.cur = t;
    this.cur.clear();
    this.counts.fill(0);
    const sel = snap.selection;
    const n = Math.min(snap.towerCount, snap.towers.length);
    const info = this.info;
    for (let i = 0; i < n; i++) {
      const tv = snap.towers[i];
      const type = tv.type;
      const vi = type * VARIANTS_PER_TYPE + variantOf(tv.typeId, tv.level, tv.spec);
      const body = this.bodies[vi];
      if (!body) continue;
      const slot = this.counts[vi];
      if (slot >= CAP) continue;
      this.counts[vi] = slot + 1;
      const isBarrier = tv.typeId === 'barrier';
      const baseY = isBarrier ? -TD : PAD_Y;
      // persistent per-id animation state
      const ps = this.prev.find(tv.id);
      let yaw: number;
      let buildT0: number;
      let upgT0: number;
      let flashU: number;
      if (ps >= 0) {
        const pv = this.prev.vals;
        yaw = pv[ps * CH + C_YAW];
        buildT0 = pv[ps * CH + C_BUILD];
        upgT0 = pv[ps * CH + C_UPG];
        flashU = pv[ps * CH + C_FLASH];
        if (pv[ps * CH + C_VAR] !== vi && pv[ps * CH + C_VAR] >= 0 && upgT0 < now - 0.05) upgT0 = now;
      } else {
        yaw = FACES[tv.typeId] ? -tv.angle : -Math.PI / 2;
        buildT0 = this.firstFrame ? -10 : now;
        upgT0 = -10;
        flashU = 0;
      }
      let targetYaw = yaw;
      if (FACES[tv.typeId]) targetYaw = -tv.angle;
      else if (isBarrier && info) {
        const c = Math.floor(tv.x);
        const r = Math.floor(tv.y);
        if (c >= 0 && r >= 0 && c < info.cols && r < info.rows) {
          const k = (r * info.cols + c) * 2;
          targetYaw = -Math.atan2(info.cellDir[k + 1], info.cellDir[k]);
        }
        yaw = targetYaw;
      }
      let dy = targetYaw - yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const step = 14 * dt;
      yaw += Math.abs(dy) <= step ? dy : Math.sign(dy) * step;
      const s = this.cur.slot(tv.id);
      if (s >= 0) {
        const v = this.cur.vals;
        const o = s * CH;
        v[o + C_X] = tv.x;
        v[o + C_Y] = tv.y;
        v[o + C_YAW] = yaw;
        v[o + C_VAR] = vi;
        v[o + C_BUILD] = buildT0;
        v[o + C_UPG] = upgT0;
        v[o + C_FLASH] = flashU;
        v[o + C_BASE] = baseY;
        v[o + C_TYPE] = type;
      }
      // scale animation
      let sc = TS * (1 + 0.015 * Math.sin(now * 2.2 + tv.id));
      const bt = (now - buildT0) / 0.38;
      if (bt < 1) sc *= Math.max(0.01, easeOutBack(Math.max(0, bt)));
      const ut = (now - upgT0) / 0.45;
      if (ut >= 0 && ut < 1) sc *= 1 + 0.22 * Math.sin(ut * Math.PI);
      let sx = sc;
      let sy = sc;
      let sz = sc;
      let tilt = 0;
      let flash = 0;
      const since = snap.time - tv.lastShotAt;
      if (tv.lastShotAt >= 0 && since >= 0 && since < 0.25) {
        const k = (1 - since / 0.25) * (1 - since / 0.25);
        flash = k;
        if (tv.typeId === 'macrophage') tilt = -0.35 * k;
        else {
          sy *= 1 - 0.13 * k;
          sx *= 1 + 0.06 * k;
          sz *= 1 + 0.06 * k;
        }
      }
      if (flashU > now) flash = Math.max(flash, (flashU - now) / 0.15);
      if (tv.digesting) {
        const w = Math.sin(now * 7 + tv.id) * 0.06;
        sx *= 1 + w;
        sz *= 1 - w;
        sy *= 1 + w * 0.5;
      }
      let damage = 0;
      if (isBarrier) {
        const hp = Math.max(0, Math.min(1, tv.hpFrac));
        damage = 1 - hp;
        sy *= 0.5 + 0.5 * hp;
        sx *= 0.82 + 0.18 * hp;
        sz *= 0.92 + 0.08 * hp;
        if (flashU > now) tilt += Math.sin(now * 70) * 0.05;
      }
      writeTRS2(body.instanceMatrix.array as Float32Array, slot * 16, tv.x, baseY, tv.y, yaw, tilt, sx, sy, sz);
      const selected = tv.selected || (sel !== null && sel.kind === 'tower' && sel.id === tv.id);
      const fa = this.fxA[vi];
      const fb = this.fxB[vi];
      const o4 = slot * 4;
      fa[o4] = flash;
      fa[o4 + 1] = tv.infected ? 1 : 0;
      fa[o4 + 2] = tv.buffed ? 0.6 + 0.4 * Math.sin(now * 3 + tv.id) : 0;
      fa[o4 + 3] = selected ? 1 : 0;
      fb[o4] = tv.charge >= 0.999 && (tv.typeId === 'macrophage' || tv.typeId === 'beacon') ? 0.8 + 0.4 * Math.sin(now * 6) : tv.charge * 0.3;
      fb[o4 + 1] = tv.digesting ? 1 : 0;
      fb[o4 + 2] = damage;
      fb[o4 + 3] = tv.immune ? 1 : 0;
      const spin = this.spins[vi];
      if (spin) {
        const sa = this.sfxA[vi]!;
        const sb = this.sfxB[vi]!;
        const spinYaw = yaw + now * SPIN_SPEED[tv.typeId] * (tv.infected ? 0.4 : 1) + tv.id;
        writeTRS2(spin.instanceMatrix.array as Float32Array, slot * 16, tv.x, baseY, tv.y, spinYaw, 0, sc, sc, sc);
        sa[o4] = fa[o4];
        sa[o4 + 1] = fa[o4 + 1];
        sa[o4 + 2] = fa[o4 + 2];
        sa[o4 + 3] = fa[o4 + 3];
        sb[o4] = fb[o4];
        sb[o4 + 1] = fb[o4 + 1];
        sb[o4 + 2] = 0;
        sb[o4 + 3] = fb[o4 + 3];
      }
      // auras
      const acc = this.accent[type];
      if (tv.typeId === 'pyrogen' && tv.range > 0) {
        const k = tv.infected ? 0.5 : 1;
        fx.glowDecals.add(tv.x, 0.03, tv.y, tv.range, 0, acc.r, acc.g * 0.8, acc.b * 0.6, 0.07 * k, Shape.Disc, 0.025, 0.5);
        const ph = (now * 0.45 + tv.id * 0.37) % 1;
        const rr = tv.range * (0.3 + 0.7 * ph);
        fx.glowDecals.add(tv.x, 0.035, tv.y, rr, 0, acc.r, acc.g * 0.7, acc.b * 0.4, 0.3 * (1 - ph) * k, Shape.Ring, 0.06 / rr);
      } else if (tv.typeId === 'beacon' && tv.range > 0) {
        fx.glowDecals.add(tv.x, 0.03, tv.y, tv.range, now * 0.12, acc.r, acc.g, acc.b * 0.7, 0.2, Shape.Dashed, 0.035 / tv.range, Math.round(tv.range * 7));
      }
      fx.alphaDecals.add(tv.x, isBarrier ? -TD + 0.06 : PAD_Y + 0.004, tv.y, isBarrier ? 0.45 : 0.36, 0, 0.05, 0.0, 0.03, 0.25, Shape.Blob);
      if (selected) {
        const rf = this.rangeFill;
        const re = this.rangeEdge;
        if (tv.range > 0) {
          fx.glowDecals.add(tv.x, 0.06, tv.y, tv.range, 0, rf.r, rf.g, rf.b, 0.13, Shape.Disc, 0.0, 1);
          fx.glowDecals.add(tv.x, 0.065, tv.y, tv.range, now * 0.15, re.r, re.g, re.b, 0.85, Shape.Dashed, 0.045 / tv.range, Math.round(tv.range * 9));
        }
        const sc2 = this.selectCol;
        fx.glowDecals.add(tv.x, isBarrier ? -TD + 0.1 : PAD_Y + 0.01, tv.y, 0.52, -now * 1.2, sc2.r, sc2.g, sc2.b, 0.9, Shape.Dashed, 0.12, 8);
      }
    }
    this.firstFrame = false;
    for (let vi = 0; vi < this.bodies.length; vi++) {
      const c = this.counts[vi];
      const m = this.bodies[vi];
      m.count = c;
      m.visible = c > 0;
      const sp = this.spins[vi];
      if (sp) {
        sp.count = c;
        sp.visible = c > 0;
      }
      if (c === 0) continue;
      m.instanceMatrix.needsUpdate = true;
      this.attA[vi].needsUpdate = true;
      this.attB[vi].needsUpdate = true;
      if (sp) {
        sp.instanceMatrix.needsUpdate = true;
        this.sattA[vi]!.needsUpdate = true;
        this.sattB[vi]!.needsUpdate = true;
      }
    }
    // ghost preview
    if (sel && sel.kind === 'pad' && sel.previewType) {
      const ti = TOWER_IDS.indexOf(sel.previewType);
      const model = this.models[ti * VARIANTS_PER_TYPE];
      const isBarrier = sel.previewType === 'barrier';
      this.ghost.geometry = model.body;
      this.ghost.visible = true;
      const x = sel.col + 0.5;
      const y = sel.row + 0.5;
      let yaw = -Math.PI / 2;
      if (isBarrier && info && sel.col >= 0 && sel.row >= 0 && sel.col < info.cols && sel.row < info.rows) {
        const k = (sel.row * info.cols + sel.col) * 2;
        yaw = -Math.atan2(info.cellDir[k + 1], info.cellDir[k]);
      }
      const bob = 0.03 * Math.sin(now * 4);
      this.ghost.position.set(x, (isBarrier ? -TD : PAD_Y) + 0.04 + bob, y);
      this.ghost.scale.setScalar(TS);
      this.ghost.rotation.set(0, yaw, 0);
      this.ghostMat.opacity = 0.38 + 0.12 * Math.sin(now * 5);
      const range = this.ghostRange ?? GHOST_RANGE[sel.previewType];
      const rf = this.rangeFill;
      const re = this.rangeEdge;
      if (range > 0) {
        fx.glowDecals.add(x, 0.06, y, range, 0, rf.r, rf.g, rf.b, 0.12, Shape.Disc, 0, 1);
        fx.glowDecals.add(x, 0.065, y, range, now * 0.15, re.r, re.g, re.b, 0.8, Shape.Dashed, 0.045 / range, Math.round(range * 9));
      }
    } else {
      this.ghost.visible = false;
    }
  }

  dispose(): void {
    for (const m of this.bodies) {
      m.geometry.dispose();
      m.dispose();
    }
    for (const m of this.spins) {
      if (!m) continue;
      m.geometry.dispose();
      m.dispose();
    }
    this.mat.dispose();
    this.ghostMat.dispose();
    this.root.clear();
  }
}
