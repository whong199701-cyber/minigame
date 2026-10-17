/**
 * Enemies: one InstancedMesh per EnemyId plus one per segmented body (parasite / Giant Parasite segments as
 * instances following the path). Per-instance FX attributes drive hit flash, death dissolve, stealth transparency
 * (dithered), slow / burn / hardened tints and boss glow. Killed / engulfed / leaked enemies stay a moment as dying
 * instances in a fixed pool. Blob shadows, boss halos, telegraph and immunity rings go to the shared decal layers.
 */
import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Object3D, type Material } from 'three';
import { ENEMY_IDS, EnemyViewFlag, TOWER_IDS, WORLD, type EnemyId, type RenderSnapshot } from '../types';
import { Shape, type FxLayers } from './effects';
import { createCellMaterial, type SharedUniforms } from './materials';
import { buildEnemyModel, buildSegmentModel } from './models';
import { ENEMY_COLORS, TOWER_ACCENT, type Palette } from './palette';
import { IdTable, Lin, writeTRS2 } from './util';

const TD = WORLD.trenchDepth;
/** Visual scale over the logic radius (silhouettes read better slightly larger than the hit radius). */
const VIS = 1.18;
const CAP = 208;
const SEG_CAP = 1024;
const DYING = 64;
const FLY_H = 0.62;

/** Channels of the per-frame id table. */
const C_TYPE = 0;
const C_X = 1;
const C_Y = 2;
const C_H = 3;
const C_YAW = 4;
const C_S = 5;
const C_FLASH = 6;
const C_R = 7;
const CH = 8;

const IDX = (id: EnemyId): number => ENEMY_IDS.indexOf(id);
const I_PARASITE = IDX('parasite');
const I_GIANT = IDX('giantParasite');
const I_BIOFILM = IDX('biofilm');
const I_TOXIN = IDX('toxin');

/** Motion style per type index. */
const STYLE = ENEMY_IDS.map((id) => {
  switch (id) {
    case 'virus':
    case 'virusKing':
      return 1; // spin
    case 'spore':
    case 'sporeling':
    case 'prion':
      return 2; // fast spin
    case 'flagellate':
      return 3; // wiggle
    case 'toxin':
      return 4; // float
    case 'mutant':
    case 'biofilm':
      return 5; // pulsate
    default:
      return 0; // squash-walk
  }
});

/** Base height of the model centre over the trench floor, in units of its scale. */
const LIFT = ENEMY_IDS.map((id) => (id === 'biofilm' ? 0.42 : id === 'prion' ? 0.85 : 0.86));

export class EnemyLayer {
  readonly root = new Object3D();
  private meshes: InstancedMesh[] = [];
  private fxA: Float32Array[] = [];
  private fxB: Float32Array[] = [];
  private attA: InstancedBufferAttribute[] = [];
  private attB: InstancedBufferAttribute[] = [];
  private counts: Int32Array;
  private segMeshes: InstancedMesh[] = [];
  private segFxA: Float32Array[] = [];
  private segFxB: Float32Array[] = [];
  private segAttA: InstancedBufferAttribute[] = [];
  private segAttB: InstancedBufferAttribute[] = [];
  private segCounts = new Int32Array(2);
  private mat: Material;
  private cur = new IdTable(1024, CH);
  private prev = new IdTable(1024, CH);
  // dying pool
  private dActive = new Uint8Array(DYING);
  private dType = new Uint8Array(DYING);
  private dMode = new Uint8Array(DYING);
  private dData = new Float32Array(DYING * 10); // x y z yaw s t0 dur tx tz r
  private dNext = 0;
  private glow: Lin[];
  private shadowCol = new Lin(0);
  private shadowA = 0.45;
  private towerLin: Lin[];
  /** Any dying instance in flight (keeps the frame non-idle). */
  dyingLive = 0;

  constructor(u: SharedUniforms, shadows: boolean) {
    this.mat = createCellMaterial('enemy', u, { flat: true, roughness: 0.42 });
    this.counts = new Int32Array(ENEMY_IDS.length);
    ENEMY_IDS.forEach((id) => {
      const g = buildEnemyModel(id);
      const fa = new Float32Array(CAP * 4);
      const fb = new Float32Array(CAP * 4);
      const aa = new InstancedBufferAttribute(fa, 4).setUsage(DynamicDrawUsage);
      const ab = new InstancedBufferAttribute(fb, 4).setUsage(DynamicDrawUsage);
      g.setAttribute('iFx', aa);
      g.setAttribute('iFx2', ab);
      const m = new InstancedMesh(g, this.mat, CAP);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadows && id !== 'prion';
      this.meshes.push(m);
      this.fxA.push(fa);
      this.fxB.push(fb);
      this.attA.push(aa);
      this.attB.push(ab);
      this.root.add(m);
    });
    (['parasite', 'giantParasite'] as const).forEach((id) => {
      const g = buildSegmentModel(id);
      const cap = id === 'parasite' ? SEG_CAP : 160;
      const fa = new Float32Array(cap * 4);
      const fb = new Float32Array(cap * 4);
      const aa = new InstancedBufferAttribute(fa, 4).setUsage(DynamicDrawUsage);
      const ab = new InstancedBufferAttribute(fb, 4).setUsage(DynamicDrawUsage);
      g.setAttribute('iFx', aa);
      g.setAttribute('iFx2', ab);
      const m = new InstancedMesh(g, this.mat, cap);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadows;
      this.segMeshes.push(m);
      this.segFxA.push(fa);
      this.segFxB.push(fb);
      this.segAttA.push(aa);
      this.segAttB.push(ab);
      this.root.add(m);
    });
    this.glow = ENEMY_IDS.map((id) => new Lin(ENEMY_COLORS[id].glow));
    this.towerLin = TOWER_IDS.map((t) => new Lin(TOWER_ACCENT[t]));
  }

  setShadows(on: boolean): void {
    this.meshes.forEach((m, i) => (m.castShadow = on && ENEMY_IDS[i] !== 'prion'));
    this.segMeshes.forEach((m) => (m.castShadow = on));
  }

  applyPalette(p: Palette): void {
    this.shadowCol.set(p.shadow);
    this.shadowA = p.shadowAlpha;
  }

  // ── event hooks (called before `update` of the frame; `cur` holds the previous frame) ──

  flash(id: number, now: number, dur = 0.12): void {
    const s = this.cur.find(id);
    if (s >= 0) this.cur.vals[s * CH + C_FLASH] = now + dur;
  }

  /** Last known world position of an enemy: [x, h, y] in logic terms; false when unknown. */
  lookup(id: number, out: { x: number; y: number; h: number; r: number; type: number }): boolean {
    const s = this.cur.find(id);
    if (s < 0) return false;
    const v = this.cur.vals;
    const o = s * CH;
    out.type = v[o + C_TYPE];
    out.x = v[o + C_X];
    out.y = v[o + C_Y];
    out.h = v[o + C_H];
    out.r = v[o + C_R];
    return true;
  }

  /** Starts a dying instance. mode 0 dissolve, 1 engulf (pulled toward tx/ty), 2 leak (sinks into the core). */
  die(id: number, now: number, mode: 0 | 1 | 2, tx = 0, ty = 0, fallbackType = -1, fx = 0, fy = 0): boolean {
    const s = this.cur.find(id);
    let type: number;
    let x: number;
    let y: number;
    let h: number;
    let yaw = 0;
    let sc: number;
    let r: number;
    if (s >= 0) {
      const v = this.cur.vals;
      const o = s * CH;
      type = v[o + C_TYPE];
      x = v[o + C_X];
      y = v[o + C_Y];
      h = v[o + C_H];
      yaw = v[o + C_YAW];
      sc = v[o + C_S];
      r = v[o + C_R];
    } else {
      if (fallbackType < 0) return false;
      type = fallbackType;
      x = fx;
      y = fy;
      r = 0.22;
      sc = r * VIS;
      h = -TD + sc * LIFT[type];
    }
    const i = this.dNext;
    this.dNext = (this.dNext + 1) % DYING;
    this.dActive[i] = 1;
    this.dType[i] = type;
    this.dMode[i] = mode;
    const d = this.dData;
    const o = i * 10;
    d[o] = x;
    d[o + 1] = h;
    d[o + 2] = y;
    d[o + 3] = yaw;
    d[o + 4] = sc;
    d[o + 5] = now;
    d[o + 6] = mode === 1 ? 0.42 : mode === 2 ? 0.5 : type === I_GIANT || type === IDX('superbug') || type === IDX('virusKing') ? 0.9 : 0.45;
    d[o + 7] = tx;
    d[o + 8] = ty;
    d[o + 9] = r;
    return true;
  }

  update(snap: RenderSnapshot, now: number, fx: FxLayers): void {
    // swap id tables
    const t = this.prev;
    this.prev = this.cur;
    this.cur = t;
    this.cur.clear();
    this.counts.fill(0);
    this.segCounts.fill(0);
    const e = snap.enemies;
    const n = e.count;
    const sh = this.shadowCol;
    for (let i = 0; i < n; i++) {
      const ti = e.type[i];
      const mesh = this.meshes[ti];
      if (!mesh) continue;
      const slot = this.counts[ti];
      if (slot >= CAP - DYING / 4) continue;
      this.counts[ti] = slot + 1;
      const id = e.id[i];
      const flags = e.flags[i];
      const r = e.radius[i];
      const flying = (flags & EnemyViewFlag.Flying) !== 0;
      const boss = (flags & EnemyViewFlag.Boss) !== 0;
      const burrowed = (flags & EnemyViewFlag.Burrowed) !== 0;
      const stunned = (flags & EnemyViewFlag.Stunned) !== 0;
      const attacking = (flags & EnemyViewFlag.Attacking) !== 0;
      const charging = (flags & EnemyViewFlag.Charging) !== 0;
      const tele = e.telegraph[i];
      let s = r * VIS * (1 + tele * 0.18);
      const phase = id * 1.7;
      const x = e.x[i];
      const y = e.y[i];
      let h = flying ? FLY_H + Math.sin(now * 2.6 + phase) * 0.07 : -TD + s * LIFT[ti];
      let yaw = -e.angle[i];
      let sx = 1;
      let sy = 1;
      let sz = 1;
      let tilt = 0;
      const tm = stunned ? 0 : now;
      switch (STYLE[ti]) {
        case 0: {
          const k = Math.sin(tm * 9 + phase);
          sy = 1 + 0.06 * k;
          sx = 1 - 0.04 * k;
          break;
        }
        case 1:
          yaw = tm * 1.4 + phase;
          break;
        case 2:
          yaw = tm * 2.4 + phase;
          tilt = Math.sin(tm * 1.3 + phase) * 0.3;
          break;
        case 3:
          yaw += Math.sin(tm * 16 + phase) * 0.28;
          break;
        case 4:
          yaw = tm * 0.5 + phase;
          break;
        case 5: {
          const k = Math.sin(tm * 4 + phase);
          sx = sz = 1 + 0.06 * k;
          sy = 1 - 0.05 * k;
          break;
        }
      }
      if (attacking) tilt += Math.max(0, Math.sin(now * 9 + phase)) * 0.35;
      if (charging) {
        tilt -= 0.25;
        sx *= 1.12;
      }
      if (burrowed) h = -TD - s * 0.55;
      if (stunned) tilt += 0.18;
      // id table
      const ts = this.cur.slot(id);
      if (ts >= 0) {
        const v = this.cur.vals;
        const o = ts * CH;
        v[o + C_TYPE] = ti;
        v[o + C_X] = x;
        v[o + C_Y] = y;
        v[o + C_H] = h;
        v[o + C_YAW] = yaw;
        v[o + C_S] = s;
        v[o + C_FLASH] = this.prev.get(id, C_FLASH, 0);
        v[o + C_R] = r;
      }
      const flashUntil = ts >= 0 ? this.cur.vals[ts * CH + C_FLASH] : 0;
      const flash = flashUntil > now ? Math.min(1, (flashUntil - now) / 0.12) : 0;
      writeTRS2(mesh.instanceMatrix.array as Float32Array, slot * 16, x, h, y, yaw, tilt, s * sx, s * sy, s * sz);
      const stealth = (flags & EnemyViewFlag.Stealth) !== 0;
      const revealed = (flags & EnemyViewFlag.Revealed) !== 0;
      const alpha = stealth ? (revealed ? 0.82 : 0.3) : burrowed ? 0.55 : 1;
      const fa = this.fxA[ti];
      const fb = this.fxB[ti];
      const o4 = slot * 4;
      fa[o4] = flash;
      fa[o4 + 1] = 0;
      fa[o4 + 2] = alpha;
      fa[o4 + 3] = e.slow[i];
      fb[o4] = (flags & EnemyViewFlag.Burning) !== 0 ? 1 : 0;
      fb[o4 + 1] = (flags & EnemyViewFlag.Hardened) !== 0 ? 1 : 0;
      fb[o4 + 2] = (boss ? 0.45 + 0.25 * Math.sin(now * 3 + phase) : 0) + tele * 1.2 + (charging ? 1 : 0);
      fb[o4 + 3] = e.immuneTo[i] > 0 ? 1 : 0;
      // shadow
      const shY = flying ? 0.012 : -TD + 0.08;
      if (!burrowed) fx.alphaDecals.add(x, shY, y, s * (flying ? 0.9 : 1.15), 0, sh.r, sh.g, sh.b, this.shadowA * (flying ? 0.55 : 0.75) * alpha, Shape.Blob);
      // boss halo + telegraph + immunity
      if (boss) {
        const gl = this.glow[ti];
        fx.glowDecals.add(x, -TD + 0.09, y, s * 1.9, now * 0.6, gl.r, gl.g, gl.b, 0.55 + 0.2 * Math.sin(now * 4), Shape.Dashed, 0.12, 10);
        fx.sprites.add(x, h, y, s * 3.2, gl.r, gl.g, gl.b, 0.22);
      }
      if (tele > 0) {
        const gl = this.glow[ti];
        fx.glowDecals.add(x, -TD + 0.1, y, s * (1.4 + tele * 1.4), 0, gl.r, gl.g, gl.b, 0.35 + tele * 0.5, Shape.Ring, 0.1);
      }
      if (e.immuneTo[i] > 0) {
        const c = this.towerLin[Math.min(this.towerLin.length - 1, e.immuneTo[i] - 1)];
        fx.glowDecals.add(x, -TD + 0.11, y, s * 1.55, -now * 1.5, c.r, c.g, c.b, 0.85, Shape.Dashed, 0.16, 6);
      }
      if (burrowed) fx.alphaDecals.add(x, -TD + 0.09, y, s * 1.3, 0, 0.25, 0.08, 0.12, 0.5, Shape.Disc, 0.2, 0.6);
      // segments
      const sc = e.segCount[i];
      if (sc > 0 && (ti === I_PARASITE || ti === I_GIANT)) {
        const si = ti === I_PARASITE ? 0 : 1;
        const sm = this.segMeshes[si];
        const arr = sm.instanceMatrix.array as Float32Array;
        const cap = sm.instanceMatrix.count;
        const sfa = this.segFxA[si];
        const sfb = this.segFxB[si];
        const st = e.segStart[i];
        for (let k = 0; k < sc; k++) {
          const q = this.segCounts[si];
          if (q >= cap) break;
          this.segCounts[si] = q + 1;
          const ss = s * (si === 0 ? 0.9 - 0.07 * k : 0.82 - 0.035 * k);
          const sx2 = e.segX[st + k];
          const sy2 = e.segY[st + k];
          const bob = Math.sin(tm * 7 - k * 0.9 + phase) * 0.025;
          const sh2 = burrowed ? -TD - ss * 0.6 : -TD + ss * 0.8 + bob;
          writeTRS2(arr, q * 16, sx2, sh2, sy2, -e.segAngle[st + k], 0, ss, ss * (1 + bob * 2), ss);
          const p4 = q * 4;
          sfa[p4] = flash;
          sfa[p4 + 1] = 0;
          sfa[p4 + 2] = alpha;
          sfa[p4 + 3] = e.slow[i];
          sfb[p4] = fb[o4];
          sfb[p4 + 1] = 0;
          sfb[p4 + 2] = boss ? 0.3 : 0;
          sfb[p4 + 3] = fb[o4 + 3];
          if (!burrowed) fx.alphaDecals.add(sx2, -TD + 0.08, sy2, ss * 1.05, 0, sh.r, sh.g, sh.b, this.shadowA * 0.6, Shape.Blob);
        }
      }
    }
    // dying instances
    let dl = 0;
    const d = this.dData;
    for (let k = 0; k < DYING; k++) {
      if (!this.dActive[k]) continue;
      const o = k * 10;
      const tt = (now - d[o + 5]) / d[o + 6];
      if (tt >= 1 || tt < 0) {
        this.dActive[k] = 0;
        continue;
      }
      dl++;
      const ti = this.dType[k];
      const mesh = this.meshes[ti];
      const slot = this.counts[ti];
      if (slot >= CAP) continue;
      this.counts[ti] = slot + 1;
      let x = d[o];
      let h = d[o + 1];
      let z = d[o + 2];
      let s = d[o + 4];
      let dis = tt;
      const mode = this.dMode[k];
      if (mode === 1) {
        const e2 = tt * tt;
        x += (d[o + 7] - x) * e2;
        z += (d[o + 8] - z) * e2;
        h += Math.sin(tt * Math.PI) * 0.25;
        s *= 1 - tt * 0.85;
        dis = tt * 0.5;
      } else if (mode === 2) {
        h -= tt * 0.5;
        s *= 1 - tt * 0.5;
      } else {
        s *= 1 + tt * 0.25;
        h += tt * 0.1;
      }
      writeTRS2(mesh.instanceMatrix.array as Float32Array, slot * 16, x, h, z, d[o + 3] + tt * 2, 0, s, s * (1 - tt * 0.3), s);
      const fa = this.fxA[ti];
      const fb = this.fxB[ti];
      const o4 = slot * 4;
      fa[o4] = mode === 0 ? Math.max(0, 1 - tt * 4) : 0;
      fa[o4 + 1] = 0.02 + dis * 0.98;
      fa[o4 + 2] = 1;
      fa[o4 + 3] = 0;
      fb[o4] = 0;
      fb[o4 + 1] = 0;
      fb[o4 + 2] = mode === 2 ? 1.5 : 0.8;
      fb[o4 + 3] = 0;
    }
    this.dyingLive = dl;
    // upload
    for (let ti = 0; ti < this.meshes.length; ti++) {
      const m = this.meshes[ti];
      const c = this.counts[ti];
      m.count = c;
      m.visible = c > 0;
      if (c > 0) {
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, c * 16);
        m.instanceMatrix.needsUpdate = true;
        const a = this.attA[ti];
        const b = this.attB[ti];
        a.clearUpdateRanges();
        a.addUpdateRange(0, c * 4);
        a.needsUpdate = true;
        b.clearUpdateRanges();
        b.addUpdateRange(0, c * 4);
        b.needsUpdate = true;
      }
    }
    for (let si = 0; si < 2; si++) {
      const m = this.segMeshes[si];
      const c = this.segCounts[si];
      m.count = c;
      m.visible = c > 0;
      if (c > 0) {
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, c * 16);
        m.instanceMatrix.needsUpdate = true;
        const a = this.segAttA[si];
        const b = this.segAttB[si];
        a.clearUpdateRanges();
        a.addUpdateRange(0, c * 4);
        a.needsUpdate = true;
        b.clearUpdateRanges();
        b.addUpdateRange(0, c * 4);
        b.needsUpdate = true;
      }
    }
  }

  /** Height of the enemy body centre for a type at a scale (used for event VFX without a lookup). */
  static bodyHeight(typeIndex: number, radius: number, flying: boolean): number {
    if (flying || typeIndex === I_TOXIN) return FLY_H;
    const s = radius * VIS;
    return -TD + s * LIFT[typeIndex] + (typeIndex === I_BIOFILM ? 0 : 0);
  }

  clearDying(): void {
    this.dActive.fill(0);
  }

  dispose(): void {
    for (const m of [...this.meshes, ...this.segMeshes]) {
      m.geometry.dispose();
      m.dispose();
    }
    this.mat.dispose();
    this.root.clear();
  }
}

export { VIS as ENEMY_VIS_SCALE };
