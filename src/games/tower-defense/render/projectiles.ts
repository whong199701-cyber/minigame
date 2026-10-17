/**
 * Projectiles from the SoA snapshot buffer: one InstancedMesh per look (antibody bolt, mast histamine granule,
 * generic orb) plus an additive halo sprite each. Allocation-free.
 */
import { DynamicDrawUsage, InstancedMesh, Object3D, type Material } from 'three';
import { TOWER_IDS, type RenderSnapshot } from '../types';
import type { FxLayers } from './effects';
import { createStaticMaterial, type SharedUniforms } from './materials';
import { buildProjectileModel } from './models';
import { TOWER_ACCENT } from './palette';
import { Lin, writeTRS2 } from './util';

const CAP = 256;
const K_ANTIBODY = TOWER_IDS.indexOf('antibody');
const K_MAST = TOWER_IDS.indexOf('mast');

export class ProjectileLayer {
  readonly root = new Object3D();
  private meshes: InstancedMesh[];
  private counts = new Int32Array(3);
  private mat: Material;
  private glow: Lin[];

  constructor(u: SharedUniforms) {
    this.mat = createStaticMaterial(u, { flat: true });
    this.meshes = (['antibody', 'mast', 'generic'] as const).map((k) => {
      const m = new InstancedMesh(buildProjectileModel(k), this.mat, CAP);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      this.root.add(m);
      return m;
    });
    this.glow = TOWER_IDS.map((t) => new Lin(TOWER_ACCENT[t]));
  }

  get live(): number {
    return this.counts[0] + this.counts[1] + this.counts[2];
  }

  update(snap: RenderSnapshot, now: number, fx: FxLayers): void {
    this.counts.fill(0);
    const p = snap.projectiles;
    for (let i = 0; i < p.count; i++) {
      const k = p.kind[i];
      const g = k === K_ANTIBODY ? 0 : k === K_MAST ? 1 : 2;
      const m = this.meshes[g];
      const slot = this.counts[g];
      if (slot >= CAP) continue;
      this.counts[g] = slot + 1;
      const x = p.x[i];
      const z = p.y[i];
      const h = p.h[i];
      const spin = g === 1 ? now * 8 + i : 0;
      writeTRS2(m.instanceMatrix.array as Float32Array, slot * 16, x, h, z, -p.angle[i] + spin, 0, 1, 1, 1);
      const c = this.glow[Math.min(k, this.glow.length - 1)];
      fx.sprites.add(x, h, z, g === 1 ? 0.42 : 0.34, c.r, c.g, c.b, 0.85);
      if (g === 1 && (i + Math.floor(now * 30)) % 3 === 0) fx.sparks.emit(x, h, z, 0, 0.1, 0, 0.3, 0.08, 0.02, c.r, c.g, c.b, 0.6, 0, 1);
    }
    for (let g = 0; g < 3; g++) {
      const m = this.meshes[g];
      const c = this.counts[g];
      m.count = c;
      m.visible = c > 0;
      if (c > 0) {
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, c * 16);
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.mat.dispose();
    this.root.clear();
  }
}
