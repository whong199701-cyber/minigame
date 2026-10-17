/**
 * Procedural low-poly models. Every model is built from primitives, painted per part (albedo + emissive vertex
 * attributes) and merged into ONE BufferGeometry, so a tower variant / enemy type is a single instanced draw.
 * Model space: +x = forward (heading), +y = up, origin on the surface the model stands on. Enemies use unit radius.
 *
 * Towers: 8 silhouettes chosen to read at 25 px — Y-antibody turret, low amoeba, granule mace, flame crown,
 * tall sniper lance, stacked tesla rings, lighthouse orb, platelet plug — growing parts per level, and at level 3 a
 * spec recolour plus a floating emblem (spec A = diamond, spec B = ring) in the separately spinning `spin` part.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { EnemyId, SpecId, TowerId, TowerLevel } from '../types';
import { TOWER_SPECS } from '../types';
import { ENEMY_COLORS, HERO_WHITE, SPEC_COLOR, TOWER_ACCENT, TOWER_BODY } from './palette';
import { Rand, blob, fibSphere, merge, paint, xf, type PaintOpts } from './util';

/** Darker / lighter variants of a hex colour. */
function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}
function mix(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bb = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bb;
}

const UP = new Vector3(0, 1, 0);
const _q = new Quaternion();
const _m = new Matrix4();
const _d = new Vector3();

type G = BufferGeometry;

function rod(ax: number, ay: number, az: number, bx: number, by: number, bz: number, rA: number, rB: number, seg: number, color: number, o?: PaintOpts): G {
  _d.set(bx - ax, by - ay, bz - az);
  const len = _d.length() || 1e-4;
  const g = new CylinderGeometry(rB, rA, len, seg, 1);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(UP, _d.normalize());
  _m.makeRotationFromQuaternion(_q);
  _m.setPosition(ax, ay, az);
  g.applyMatrix4(_m);
  return paint(g, color, o);
}

function ball(x: number, y: number, z: number, r: number, detail: number, color: number, o?: PaintOpts): G {
  return xf(paint(new IcosahedronGeometry(r, detail), color, o), x, y, z);
}

/** Cone pointing from (ax..) toward (bx..). */
function spike(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, seg: number, color: number, o?: PaintOpts): G {
  _d.set(bx - ax, by - ay, bz - az);
  const len = _d.length() || 1e-4;
  const g = new ConeGeometry(r, len, seg, 1);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(UP, _d.normalize());
  _m.makeRotationFromQuaternion(_q);
  _m.setPosition(ax, ay, az);
  g.applyMatrix4(_m);
  return paint(g, color, o);
}

function ring(R: number, r: number, color: number, o?: PaintOpts, tubular = 20): G {
  // torus lying flat (axis = y)
  return xf(paint(new TorusGeometry(R, r, 5, tubular), color, o), 0, 0, 0, Math.PI / 2, 0, 0);
}

function cushion(r: number, h: number, color: number, o?: PaintOpts, seg = 14): G {
  const pts = [
    new Vector2(0, h),
    new Vector2(r * 0.55, h * 0.97),
    new Vector2(r * 0.85, h * 0.8),
    new Vector2(r, h * 0.45),
    new Vector2(r * 0.96, 0),
  ];
  return paint(new LatheGeometry(pts, seg), color, o);
}

function specIndex(type: TowerId, spec: SpecId | null): 0 | 1 | 2 {
  if (!spec) return 0;
  const [a, b] = TOWER_SPECS[type];
  return spec === a ? 1 : spec === b ? 2 : 0;
}

/** 5 variants per tower type: L1, L2, L3 (no spec), L3 spec A, L3 spec B. */
export const VARIANTS_PER_TYPE = 5;
export function variantOf(type: TowerId, level: TowerLevel, spec: SpecId | null): number {
  if (level < 3) return level - 1;
  return 2 + specIndex(type, spec);
}

export interface TowerModel {
  body: G;
  spin: G | null;
  /** Model height (top of the body) for emblems, HP bars and muzzle flashes. */
  height: number;
  /** Muzzle / emitter point in model space (projectiles, beams and chains start here). */
  muzzle: [number, number, number];
}

function emblem(spin: G[], specSlot: 0 | 1 | 2, color: number, y: number): void {
  if (specSlot === 1) spin.push(xf(paint(new OctahedronGeometry(0.075, 0), color, { em: color, ei: 1.3 }), 0, y, 0, 0, 0, 0, 1, 1.35, 1));
  else if (specSlot === 2) spin.push(xf(paint(new TorusGeometry(0.062, 0.022, 5, 14), color, { em: color, ei: 1.3 }), 0, y, 0, 0.35, 0, 0));
}

function accentOf(type: TowerId, slot: 0 | 1 | 2): number {
  if (slot === 0) return TOWER_ACCENT[type];
  return SPEC_COLOR[TOWER_SPECS[type][slot - 1]];
}

// ── Towers ──────────────────────────────────────────────────────────────────

function antibody(lv: number, slot: 0 | 1 | 2, B: G[], S: G[]): TowerModel {
  const acc = accentOf('antibody', slot);
  const body = TOWER_BODY.antibody;
  const R = [0.2, 0.22, 0.24][lv - 1];
  B.push(xf(paint(blob(R, 1, 0.1, 11), body, { top: mix(body, 0xffffff, 0.5), ao: 0.4 }), 0, R * 0.62, 0, 0, 0, 0, 1.1, 0.68, 1.1));
  B.push(xf(ring(R * 1.0, 0.035, 0x0c2a36, { em: acc, ei: 1.4 }), 0, R * 0.5, 0));
  if (lv >= 2) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      B.push(ball(Math.cos(a) * R * 0.95, R * 0.85, Math.sin(a) * R * 0.95, 0.042, 0, 0x163a44, { em: acc, ei: 1.5 }));
    }
  }
  const top = [0.36, 0.48, 0.6][lv - 1];
  B.push(rod(0, R * 0.9, 0, 0, top, 0, 0.075, 0.055, 7, shade(body, 0.82)));
  if (lv === 3) B.push(xf(ring(0.09, 0.024, 0x0c2a36, { em: acc, ei: 1.5 }), 0, top - 0.1, 0));
  B.push(ball(0, top, 0, 0.07, 0, body));
  const armL = [0.24, 0.29, 0.34][lv - 1];
  const armR = slot === 2 ? 0.07 : 0.052;
  const f = 0.3;
  const sides = slot === 1 ? [-0.8, 0, 0.8] : [-0.62, 0.62];
  let maxY = top;
  for (const th of sides) {
    const dx = Math.sin(f);
    const dy = Math.cos(f) * Math.cos(th);
    const dz = Math.cos(f) * Math.sin(th);
    const ex = dx * armL;
    const ey = top + dy * armL;
    const ez = dz * armL;
    B.push(rod(0, top, 0, ex, ey, ez, armR, armR * 0.9, 6, body));
    if (th !== 0) {
      const o = Math.sign(th) * 0.05;
      B.push(rod(ex * 0.3, top + dy * armL * 0.3, ez * 0.3 + o, ex * 0.8, top + dy * armL * 0.8, ez * 0.8 + o * 1.1, 0.03, 0.026, 5, shade(body, 0.85)));
    }
    B.push(ball(ex, ey, ez, slot === 2 ? 0.085 : 0.072, 1, 0xeaffff, { em: acc, ei: 2.0 }));
    maxY = Math.max(maxY, ey);
  }
  if (slot === 2) S.push(xf(paint(new TorusGeometry(0.22, 0.018, 4, 22), acc, { em: acc, ei: 1.5 }), 0.05, top + 0.13, 0, Math.PI / 2 - 0.4, 0, 0));
  emblem(S, slot, acc, maxY + 0.18);
  return { body: merge(B), spin: S.length ? merge(S) : null, height: maxY + 0.07, muzzle: [0.1, top + 0.14, 0] };
}

function macrophage(lv: number, slot: 0 | 1 | 2, B: G[], S: G[]): TowerModel {
  const acc = accentOf('macrophage', slot);
  const body = TOWER_BODY.macrophage;
  const R = [0.27, 0.3, 0.33][lv - 1];
  const cy = R * 0.62;
  B.push(xf(paint(blob(R, 2, 0.13, 21, 1.6), body, { top: mix(body, 0xffffff, 0.45), ao: 0.45 }), 0, cy, 0, 0, 0.4, 0, 1.12, 0.8, 1.0));
  const n = [3, 4, 5][lv - 1];
  const prnd = new Rand(55 + lv);
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2 + Math.PI * 0.62 + prnd.sym(0.35);
    const len = prnd.range(1.5, 2.3);
    const pr = prnd.range(0.085, 0.12);
    const d = R * 0.82 + pr * len * 0.55;
    B.push(xf(paint(blob(pr, 1, 0.14, 31 + i, 1.4), body, { ao: 0.3, top: mix(body, 0xffffff, 0.3) }), Math.cos(a) * d, 0.06, Math.sin(a) * d, 0, -a, prnd.sym(0.2), len, 0.55, 0.95));
    if (slot === 2) B.push(ball(Math.cos(a) * (d + pr * len * 0.9), 0.06, Math.sin(a) * (d + pr * len * 0.9), 0.045, 0, 0xf6ff9a, { em: acc, ei: 1.6 }));
  }
  // nucleus: a darker kidney lobe on top, glowing faintly
  B.push(xf(paint(blob(R * 0.42, 1, 0.12, 27), shade(body, 0.55), { em: acc, ei: 0.35 }), -R * 0.15, cy + R * 0.55, -R * 0.1, 0, 0.6, 0, 1.3, 0.55, 0.85));
  // maw facing forward
  B.push(xf(paint(new SphereGeometry(0.1, 10, 8), 0x2a0820, { em: acc, ei: 0.35 }), R * 1.05, cy * 0.95, 0, 0, 0, 0, 0.5, 0.8, 1.25));
  B.push(xf(paint(new TorusGeometry(0.1, 0.03, 5, 14), mix(body, 0xffffff, 0.3), { em: acc, ei: 0.25 }), R * 1.03, cy * 0.95, 0, 0, Math.PI / 2, 0, 1, 0.8, 1.25));
  const lys = [4, 6, 8][lv - 1];
  const dots = fibSphere(lys, 0.15);
  for (const d of dots) {
    B.push(ball(d.x * R * 1.0, cy + d.y * R * 0.74, d.z * R * 0.98, slot === 1 ? 0.058 : 0.046, 0, 0xeafff4, { em: acc, ei: 1.7 }));
  }
  if (lv >= 2) B.push(xf(ring(R * 1.15, 0.022, 0x0f3a2a, { em: acc, ei: 1.1 }), 0, 0.035, 0));
  const h = cy + R * 0.85;
  emblem(S, slot, acc, h + 0.2);
  return { body: merge(B), spin: S.length ? merge(S) : null, height: h, muzzle: [R * 1.08, cy, 0] };
}

function mast(lv: number, slot: 0 | 1 | 2, B: G[], S: G[]): TowerModel {
  const acc = accentOf('mast', slot);
  const MEMBRANE_WARM = TOWER_BODY.mast;
  const stalk = [0.18, 0.3, 0.42][lv - 1];
  const R = [0.21, 0.24, 0.27][lv - 1];
  B.push(xf(paint(blob(0.17, 1, 0.12, 41), MEMBRANE_WARM, { ao: 0.4 }), 0, 0.05, 0, 0, 0, 0, 1, 0.45, 1));
  B.push(rod(0, 0.04, 0, 0, stalk + R * 0.4, 0, 0.1, 0.07, 7, MEMBRANE_WARM));
  const cy = stalk + R * 0.85;
  B.push(xf(paint(blob(R, 1, 0.07, 43), mix(MEMBRANE_WARM, 0xffffff, 0.35), { top: 0xffffff, ao: 0.25 }), 0, cy, 0));
  const n = [12, 18, 24][lv - 1];
  const gr = [0.052, 0.056, 0.06][lv - 1];
  for (const d of fibSphere(n, -0.45)) {
    B.push(ball(d.x * R, cy + d.y * R, d.z * R, gr, 0, 0xffd6ec, { em: acc, ei: 1.05 }));
  }
  if (lv === 3) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      B.push(ball(Math.cos(a) * R * 0.45, cy + R * 0.98, Math.sin(a) * R * 0.45, 0.068, 0, 0xffe0f0, { em: acc, ei: 1.3 }));
    }
  }
  if (slot === 1) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      S.push(xf(paint(blob(0.07, 1, 0.2, 50 + i), 0xffd0f0, { em: acc, ei: 0.8 }), Math.cos(a) * (R + 0.12), cy + 0.05, Math.sin(a) * (R + 0.12)));
    }
  }
  if (slot === 2) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      B.push(spike(Math.cos(a) * 0.06, cy + R * 0.9, Math.sin(a) * 0.06, Math.cos(a) * 0.1, cy + R + 0.2, Math.sin(a) * 0.1, 0.035, 5, 0xffb080, { em: acc, ei: 1.4 }));
    }
  }
  const h = cy + R + (slot === 2 ? 0.2 : 0);
  emblem(S, slot, acc, h + 0.16);
  return { body: merge(B), spin: S.length ? merge(S) : null, height: h, muzzle: [0, cy + R * 0.6, 0] };
}

function pyrogen(lv: number, slot: 0 | 1 | 2, B: G[], S: G[]): TowerModel {
  const acc = accentOf('pyrogen', slot);
  const R = [0.3, 0.33, 0.36][lv - 1];
  const warm = TOWER_BODY.pyrogen;
  B.push(xf(paint(new SphereGeometry(R, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), warm, { top: 0xfff2ea, ao: 0.35 }), 0, 0, 0, 0, 0, 0, 1, 0.55, 1));
  B.push(xf(ring(R * 0.97, 0.03, 0x4a1a08, { em: acc, ei: 0.9 }), 0, 0.05, 0));
  const ped = [0.08, 0.14, 0.2][lv - 1];
  B.push(rod(0, R * 0.4, 0, 0, R * 0.55 + ped, 0, 0.09, 0.07, 7, warm));
  const coreR = [0.11, 0.13, 0.15][lv - 1];
  const coreY = R * 0.55 + ped + coreR * 0.6;
  B.push(ball(0, coreY, 0, coreR, 1, 0xffe0b0, { em: acc, ei: 1.8 }));
  const n = [5, 7, 9][lv - 1];
  const fh = [0.24, 0.3, 0.36][lv - 1] * (slot === 1 ? 1.2 : 1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = R * 0.62;
    const bx = Math.cos(a) * rr;
    const bz = Math.sin(a) * rr;
    const by = R * 0.3;
    S.push(spike(bx, by, bz, bx * 1.35, by + fh, bz * 1.35, 0.06, 5, 0xffc890, { em: acc, ei: 1.25, top: 0xfff0c0 }));
  }
  if (lv === 3) B.push(spike(0, coreY, 0, 0, coreY + 0.36, 0, 0.06, 6, 0xffe0b0, { em: acc, ei: 1.5 }));
  if (slot === 2) B.push(xf(ring(R * 1.22, 0.035, 0x4a2a08, { em: acc, ei: 1.2 }), 0, 0.03, 0));
  const h = Math.max(coreY + coreR + (lv === 3 ? 0.36 : 0), R * 0.3 + fh);
  emblem(S, slot, acc, h + 0.16);
  return { body: merge(B), spin: merge(S), height: h, muzzle: [0, coreY, 0] };
}

function tcell(lv: number, slot: 0 | 1 | 2, B: G[], S: G[]): TowerModel {
  const acc = accentOf('tcell', slot);
  const MEMBRANE = TOWER_BODY.tcell;
  const MEMBRANE_2 = shade(MEMBRANE, 0.82);
  const headY = [0.5, 0.68, 0.86][lv - 1];
  B.push(xf(paint(blob(0.2, 1, 0.1, 61), MEMBRANE, { ao: 0.35 }), 0, 0.13, 0, 0, 0, 0, 1.05, 0.62, 1.05));
  B.push(rod(0, 0.18, 0, 0, headY - 0.08, 0, 0.075, 0.05, 7, MEMBRANE_2));
  if (lv >= 2) B.push(xf(ring(0.1, 0.02, 0x2a0a1a, { em: 0x3fe8ff, ei: 0.9 }), 0, (0.18 + headY) / 2, 0));
  B.push(xf(paint(blob(0.14, 1, 0.08, 63), MEMBRANE, { top: 0xffffff }), 0, headY, 0));
  for (const d of fibSphere(8, -0.3)) {
    if (d.x > 0.6) continue;
    const bx = d.x * 0.13;
    const by = headY + d.y * 0.13;
    const bz = d.z * 0.13;
    B.push(rod(bx, by, bz, bx + d.x * 0.07, by + d.y * 0.07, bz + d.z * 0.07, 0.018, 0.014, 4, MEMBRANE));
    B.push(ball(bx + d.x * 0.08, by + d.y * 0.08, bz + d.z * 0.08, 0.026, 0, 0xd8ffff, { em: 0x3fe8ff, ei: 1.2 }));
  }
  const L = [0.4, 0.48, 0.56][lv - 1];
  B.push(spike(0.1, headY, 0, 0.1 + L, headY, 0, 0.042, 6, 0xffd6e6, { em: acc, ei: 1.0 }));
  B.push(xf(paint(new TorusGeometry(0.05, 0.018, 4, 12), 0x2a0a1a, { em: acc, ei: 1.3 }), 0.14, headY, 0, 0, Math.PI / 2, 0));
  if (lv >= 2) B.push(xf(paint(new TorusGeometry(0.19, 0.016, 4, 20), 0x2a0a1a, { em: acc, ei: 0.9 }), 0, headY, 0, 0, Math.PI / 2, 0));
  if (lv === 3) {
    B.push(xf(paint(new BoxGeometry(0.16, 0.12, 0.02), MEMBRANE_2, { em: acc, ei: 0.3 }), -0.14, headY + 0.03, 0.07, 0, 0, 0.4));
    B.push(xf(paint(new BoxGeometry(0.16, 0.12, 0.02), MEMBRANE_2, { em: acc, ei: 0.3 }), -0.14, headY + 0.03, -0.07, 0, 0, 0.4));
  }
  if (slot === 1) {
    for (let i = 1; i <= 3; i++) {
      const x = 0.1 + L * (i / 4);
      const rr = 0.042 * (1 - i / 4) + 0.02;
      B.push(xf(paint(new TorusGeometry(rr, 0.012, 4, 10), acc, { em: acc, ei: 1.4 }), x, headY, 0, 0, Math.PI / 2, 0));
    }
  }
  if (slot === 2) B.push(ball(-0.12, headY + 0.1, 0, 0.06, 1, 0xe8d8ff, { em: acc, ei: 1.5 }));
  const h = headY + 0.15;
  emblem(S, slot, acc, h + 0.16);
  return { body: merge(B), spin: S.length ? merge(S) : null, height: h, muzzle: [0.1 + L, headY, 0] };
}

function complement(lv: number, slot: 0 | 1 | 2, B: G[], S: G[]): TowerModel {
  const acc = accentOf('complement', slot);
  const MEMBRANE = TOWER_BODY.complement;
  const MEMBRANE_2 = shade(MEMBRANE, 0.8);
  B.push(xf(new CylinderGeometry(0.24, 0.29, 0.09, 10, 1), 0, 0.045, 0));
  B[B.length - 1] = paint(B[B.length - 1], MEMBRANE_2, { ao: 0.3 });
  const rodTop = [0.52, 0.72, 0.92][lv - 1] + (slot === 1 ? 0.12 : 0);
  B.push(rod(0, 0.08, 0, 0, rodTop, 0, 0.04, 0.03, 6, MEMBRANE));
  const n = [3, 4, 5][lv - 1];
  const span = [0.32, 0.5, 0.66][lv - 1];
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const y = 0.16 + t * span;
    const R = 0.21 - t * 0.09;
    B.push(xf(ring(R, 0.03, 0x241a4a, { em: acc, ei: 1.0 }), 0, y, 0));
    if (slot === 2 && i === n - 1) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        B.push(spike(Math.cos(a) * R, y, Math.sin(a) * R, Math.cos(a) * (R + 0.11), y + 0.02, Math.sin(a) * (R + 0.11), 0.028, 4, acc, { em: acc, ei: 1.2 }));
      }
    }
  }
  B.push(ball(0, rodTop, 0, 0.08, 1, 0xf0ecff, { em: acc, ei: 1.7 }));
  const orbN = lv >= 2 ? 4 : 3;
  const orbY = 0.16 + span * 0.45;
  for (let i = 0; i < orbN; i++) {
    const a = (i / orbN) * Math.PI * 2;
    S.push(ball(Math.cos(a) * 0.29, orbY + (i % 2) * 0.05, Math.sin(a) * 0.29, 0.042, 0, 0xe8e0ff, { em: acc, ei: 1.4 }));
  }
  const h = rodTop + 0.08;
  emblem(S, slot, acc, h + 0.16);
  return { body: merge(B), spin: merge(S), height: h, muzzle: [0, rodTop, 0] };
}

function beacon(lv: number, slot: 0 | 1 | 2, B: G[], S: G[]): TowerModel {
  const acc = accentOf('beacon', slot);
  const MEMBRANE = TOWER_BODY.beacon;
  const MEMBRANE_2 = shade(MEMBRANE, 0.82);
  B.push(cushion(0.25, 0.1, MEMBRANE, { ao: 0.3 }));
  const orbY = [0.48, 0.66, 0.84][lv - 1];
  B.push(rod(0, 0.08, 0, 0, orbY - 0.07, 0, 0.075, 0.042, 7, MEMBRANE_2));
  for (let i = 0; i < lv; i++) {
    B.push(xf(ring(0.06 - i * 0.006, 0.016, 0x3a2a08, { em: acc, ei: 1.0 }), 0, 0.18 + i * 0.16, 0));
  }
  const orbR = slot === 2 ? 0.15 : [0.1, 0.115, 0.13][lv - 1];
  B.push(ball(0, orbY, 0, orbR, 1, 0xfff4cc, { em: acc, ei: 1.7 }));
  for (let i = 0; i < lv; i++) {
    const R = orbR + 0.07 + i * 0.045;
    S.push(xf(paint(new TorusGeometry(R, 0.014, 4, 24), acc, { em: acc, ei: 1.3 }), 0, orbY, 0, Math.PI / 2 + 0.45 * (i % 2 ? -1 : 1), 0, 0.35 * i));
  }
  if (lv === 3) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      S.push(ball(Math.cos(a) * 0.3, orbY - 0.1, Math.sin(a) * 0.3, 0.035, 0, 0xfff4cc, { em: acc, ei: 1.4 }));
    }
  }
  const h = orbY + orbR;
  emblem(S, slot, acc, h + 0.2);
  return { body: merge(B), spin: merge(S), height: h, muzzle: [0, orbY, 0] };
}

function barrier(lv: number, slot: 0 | 1 | 2, B: G[], S: G[]): TowerModel {
  const acc = accentOf('barrier', slot);
  const rnd = new Rand(1234 + lv * 17 + slot);
  const plate = slot === 1 ? 0xfff0cf : TOWER_BODY.barrier;
  const clot = slot === 2 ? 0xd8485e : 0xc85a5a;
  const H = [0.3, 0.38, 0.46][lv - 1];
  // the clot core: a squashed mass spanning the trench (model z = across the vessel)
  B.push(xf(paint(blob(0.3, 1, 0.18, 70 + lv), clot, { top: mix(clot, 0xffd0c0, 0.4), ao: 0.4, em: 0x400010, ei: 0.3 }), 0, H * 0.42, 0, 0, 0, 0, 0.9, H / 0.6, 1.45));
  // platelets stuck all over it (flattened lenses), more per level
  const n = [7, 11, 15][lv - 1];
  for (let i = 0; i < n; i++) {
    const a = rnd.next() * Math.PI * 2;
    const yy = rnd.range(0.12, 0.95) * H;
    const zz = Math.sin(a) * rnd.range(0.2, 0.42);
    const xx = Math.cos(a) * rnd.range(0.12, 0.24);
    const r = 0.1 + rnd.range(0, 0.035);
    const g = paint(blob(r, 1, 0.08, 80 + i), plate, { em: acc, ei: 0.15, top: 0xffffff, ao: 0.2 });
    B.push(xf(g, xx, yy, zz, rnd.sym(0.9), rnd.sym(1.5), rnd.sym(0.9), 1, 0.42, 1));
  }
  // fibrin strands lashing across the vessel
  const strands = slot === 1 ? 9 : [3, 4, 6][lv - 1];
  const sr = slot === 1 ? 0.028 : 0.018;
  const sc = slot === 1 ? 0xfff1c1 : 0xff8a96;
  for (let i = 0; i < strands; i++) {
    const y0 = rnd.range(0.05, H);
    const y1 = rnd.range(0.05, H);
    B.push(rod(rnd.sym(0.18), y0, -0.46, rnd.sym(0.18), y1, 0.46, sr, sr, 4, sc, { em: sc, ei: 0.45 }));
  }
  if (slot === 2) {
    for (let i = 0; i < 10; i++) {
      const z = -0.34 + (i % 5) * 0.17;
      const y = 0.1 + Math.floor(i / 5) * 0.16 + (lv - 1) * 0.03;
      const dir = i % 2 ? 1 : -1;
      B.push(spike(dir * 0.12, y, z, dir * 0.4, y + 0.05, z, 0.045, 5, 0xffa0aa, { em: acc, ei: 1.2 }));
    }
  }
  emblem(S, slot, acc, H + 0.24);
  return { body: merge(B), spin: S.length ? merge(S) : null, height: H, muzzle: [0, H, 0] };
}

const TOWER_BUILDERS: Record<TowerId, (lv: number, slot: 0 | 1 | 2, B: G[], S: G[]) => TowerModel> = {
  antibody,
  macrophage,
  mast,
  pyrogen,
  tcell,
  complement,
  beacon,
  barrier,
};

/** Builds variant `v` (see `variantOf`) of a tower type. */
export function buildTowerModel(type: TowerId, v: number): TowerModel {
  const lv = v < 2 ? v + 1 : 3;
  const slot = (v < 3 ? 0 : v - 2) as 0 | 1 | 2;
  return TOWER_BUILDERS[type](lv, slot, [], []);
}

// ── Enemies (unit radius, +x forward) ───────────────────────────────────────

function enemyParts(type: EnemyId): G[] {
  const c = ENEMY_COLORS[type];
  const P: G[] = [];
  const rnd = new Rand(777 + type.length * 31);
  switch (type) {
    case 'bacterium': {
      P.push(xf(paint(new CapsuleGeometry(0.55, 0.85, 3, 8), c.body, { top: c.accent, ao: 0.3 }), 0, 0, 0, 0, 0, Math.PI / 2));
      for (let i = 0; i < 9; i++) {
        const a = rnd.next() * Math.PI * 2;
        const x = rnd.sym(0.8);
        const y0 = Math.cos(a) * 0.53;
        const z0 = Math.sin(a) * 0.53;
        P.push(rod(x, y0, z0, x + rnd.sym(0.1), y0 * 1.5, z0 * 1.5, 0.035, 0.025, 3, c.accent, { em: c.glow, ei: 0.4 }));
      }
      P.push(xf(paint(new SphereGeometry(0.2, 8, 6), 0xf4ffd0, { em: c.glow, ei: 0.7 }), 0.15, 0.32, 0, 0, 0, 0, 1.6, 0.6, 1));
      break;
    }
    case 'flagellate': {
      P.push(xf(paint(new IcosahedronGeometry(0.85, 1), c.body, { top: c.accent, ao: 0.3 }), 0.2, 0, 0, 0, 0, 0, 1.05, 0.66, 0.66));
      let px = -0.55;
      let pz = 0;
      for (let i = 0; i < 4; i++) {
        const nx = px - 0.32;
        const nz = (i % 2 ? -1 : 1) * 0.22;
        P.push(rod(px, 0, pz, nx, 0.02, nz, 0.07 - i * 0.012, 0.06 - i * 0.012, 4, c.accent, { em: c.glow, ei: 0.5 }));
        px = nx;
        pz = nz;
      }
      P.push(ball(0.75, 0.2, 0.2, 0.1, 0, 0x202010, { em: c.glow, ei: 0.2 }));
      P.push(ball(0.75, 0.2, -0.2, 0.1, 0, 0x202010, { em: c.glow, ei: 0.2 }));
      break;
    }
    case 'encapsulated': {
      P.push(paint(new DodecahedronGeometry(1, 0), c.body, { top: c.accent, ao: 0.35 }));
      P.push(xf(paint(new DodecahedronGeometry(0.93, 0), c.accent, { ao: 0.3 }), 0, 0, 0, 0.5, 0.6, 0.3));
      for (const d of fibSphere(6, 0)) P.push(ball(d.x * 0.98, d.y * 0.98, d.z * 0.98, 0.12, 0, 0x2e4a18, { em: c.glow, ei: 0.6 }));
      break;
    }
    case 'virus':
    case 'virusKing': {
      const king = type === 'virusKing';
      P.push(paint(new IcosahedronGeometry(0.72, 1), c.body, { top: king ? 0xb48cff : 0xc4a0ff, ao: 0.3 }));
      const ico = new IcosahedronGeometry(1, 0);
      const pos = ico.getAttribute('position');
      const seen: string[] = [];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const k = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
        if (seen.includes(k)) continue;
        seen.push(k);
        const l = Math.hypot(x, y, z);
        const dx = x / l;
        const dy = y / l;
        const dz = z / l;
        P.push(rod(dx * 0.68, dy * 0.68, dz * 0.68, dx * 1.0, dy * 1.0, dz * 1.0, 0.055, 0.04, 4, king ? 0xffe6a0 : c.accent));
        P.push(ball(dx * 1.05, dy * 1.05, dz * 1.05, king ? 0.14 : 0.13, 0, king ? c.accent : c.accent, { em: king ? 0xffb020 : c.glow, ei: 0.9 }));
      }
      ico.dispose();
      if (king) {
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          P.push(spike(Math.cos(a) * 0.42, 0.6, Math.sin(a) * 0.42, Math.cos(a) * 0.55, 1.25, Math.sin(a) * 0.55, 0.11, 4, c.accent, { em: 0xffb020, ei: 1.0 }));
        }
        P.push(xf(ring(0.5, 0.06, c.accent, { em: 0xffb020, ei: 0.9 }), 0, 0.62, 0));
      }
      break;
    }
    case 'spore':
    case 'sporeling': {
      const small = type === 'sporeling';
      P.push(paint(new IcosahedronGeometry(small ? 0.8 : 0.72, small ? 0 : 1), c.body, { top: c.accent, ao: 0.3 }));
      const dirs = small ? fibSphere(6) : fibSphere(18);
      for (const d of dirs) {
        P.push(spike(d.x * 0.62, d.y * 0.62, d.z * 0.62, d.x * 1.12, d.y * 1.12, d.z * 1.12, small ? 0.16 : 0.11, 4, c.accent, { em: c.glow, ei: 0.45 }));
      }
      break;
    }
    case 'parasite':
    case 'giantParasite': {
      const giant = type === 'giantParasite';
      P.push(xf(paint(blob(0.85, 1, 0.12, giant ? 5 : 3), c.body, { top: 0xf0d8ff, ao: 0.35 }), 0, 0, 0, 0, 0, 0, 1.35, 0.82, 0.92));
      const mand = giant ? 4 : 2;
      for (let i = 0; i < mand; i++) {
        const side = i % 2 ? -1 : 1;
        const up = giant && i >= 2 ? 0.28 : -0.12;
        P.push(spike(0.95, up, side * 0.3, 1.55, up + 0.05, side * 0.12, giant ? 0.14 : 0.12, 4, c.accent, { em: c.glow, ei: 0.25 }));
      }
      P.push(ball(0.85, 0.32, 0.26, 0.11, 0, 0x2a0a30, { em: c.glow, ei: 1.3 }));
      P.push(ball(0.85, 0.32, -0.26, 0.11, 0, 0x2a0a30, { em: c.glow, ei: 1.3 }));
      if (giant) {
        for (let i = 0; i < 6; i++) {
          const z = -0.45 + (i % 3) * 0.45;
          const x = -0.3 + Math.floor(i / 3) * 0.5;
          P.push(spike(x, 0.55, z * 0.8, x - 0.2, 1.05, z, 0.12, 4, c.accent, { em: c.glow, ei: 0.5 }));
        }
      }
      break;
    }
    case 'biofilm': {
      P.push(xf(paint(blob(1.0, 2, 0.24, 9), c.body, { top: 0x9ae07a, ao: 0.3 }), 0, -0.2, 0, 0, 0, 0, 1.2, 0.48, 1.1));
      for (let i = 0; i < 7; i++) {
        const a = rnd.next() * Math.PI * 2;
        const r = rnd.range(0.1, 0.75);
        P.push(ball(Math.cos(a) * r, 0.18 + rnd.range(0, 0.08), Math.sin(a) * r, rnd.range(0.1, 0.19), 1, 0xeaffb0, { em: c.glow, ei: 0.8 }));
      }
      break;
    }
    case 'prion': {
      P.push(paint(new TorusKnotGeometry(0.55, 0.2, 40, 5, 2, 3), c.body, { em: c.glow, ei: 0.45, top: c.accent }));
      break;
    }
    case 'toxin': {
      const puffs: [number, number, number, number][] = [
        [0, 0, 0, 0.66],
        [0.52, 0.06, 0.22, 0.5],
        [-0.48, 0.02, -0.15, 0.54],
        [0.08, 0.36, -0.34, 0.46],
        [-0.1, 0.3, 0.4, 0.42],
        [0.3, -0.2, -0.35, 0.4],
      ];
      puffs.forEach(([x, y, z, r], i) => P.push(xf(paint(blob(r, 1, 0.12, 90 + i), c.body, { em: c.glow, ei: 0.35, top: 0xf2ffb0 }), x, y, z)));
      P.push(ball(0.6, 0.12, 0.18, 0.1, 0, 0x30380a, { em: 0x000000, ei: 0 }));
      P.push(ball(0.6, 0.12, -0.12, 0.1, 0, 0x30380a, { em: 0x000000, ei: 0 }));
      break;
    }
    case 'mutant': {
      P.push(paint(blob(1.0, 2, 0.26, 13), c.body, { top: 0xff8fb0, ao: 0.35 }));
      const nuc = fibSphere(4, -0.2);
      for (const d of nuc) P.push(ball(d.x * 0.82, d.y * 0.82, d.z * 0.82, 0.3, 1, c.accent, { em: 0x400010, ei: 0.4 }));
      for (const d of fibSphere(7, -0.4)) P.push(ball(d.x * 0.98, d.y * 0.98, d.z * 0.98, 0.1, 0, 0xffd0e0, { em: c.glow, ei: 1.1 }));
      break;
    }
    case 'superbug': {
      P.push(xf(paint(new CapsuleGeometry(0.6, 0.85, 3, 9), c.body, { top: 0x9af08a, ao: 0.35 }), 0, 0, 0, 0, 0, Math.PI / 2));
      for (let i = 0; i < 3; i++) {
        const x = -0.45 + i * 0.45;
        P.push(xf(paint(new TorusGeometry(0.6, 0.07, 4, 16), c.accent, { em: c.glow, ei: 0.9 }), x, 0, 0, 0, Math.PI / 2, 0));
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 6) * Math.PI * 2 + (i >= 6 ? 0.5 : 0);
        const x = i >= 6 ? 0.45 : -0.2;
        const y = Math.cos(a) * 0.58;
        const z = Math.sin(a) * 0.58;
        P.push(spike(x, y, z, x - 0.08, y * 1.7, z * 1.7, 0.11, 4, c.accent, { em: c.glow, ei: 0.3 }));
      }
      P.push(ball(1.02, 0.18, 0.2, 0.09, 0, 0x102010, { em: c.glow, ei: 1.5 }));
      P.push(ball(1.02, 0.18, -0.2, 0.09, 0, 0x102010, { em: c.glow, ei: 1.5 }));
      break;
    }
  }
  return P;
}

export function buildEnemyModel(type: EnemyId): G {
  return merge(enemyParts(type));
}

/** Trailing body segment for parasites (unit radius). */
export function buildSegmentModel(type: 'parasite' | 'giantParasite'): G {
  const c = ENEMY_COLORS[type];
  const P: G[] = [];
  P.push(xf(paint(blob(0.85, 1, 0.1, type === 'giantParasite' ? 8 : 4), c.body, { top: 0xe8d0f8, ao: 0.35 }), 0, 0, 0, 0, 0, 0, 0.92, 0.78, 0.98));
  P.push(xf(paint(new TorusGeometry(0.62, 0.08, 4, 14), c.accent, { em: c.glow, ei: 0.35 }), 0, 0, 0, 0, Math.PI / 2, 0, 1, 0.9, 1.05));
  if (type === 'giantParasite') {
    P.push(spike(0, 0.55, 0, -0.15, 1.0, 0, 0.13, 4, c.accent, { em: c.glow, ei: 0.5 }));
  }
  return merge(P);
}

// ── Hero: Blanc, a cute white neutrophil blob ───────────────────────────────

export function buildHeroModel(): G {
  const P: G[] = [];
  P.push(xf(paint(new SphereGeometry(0.25, 28, 20), HERO_WHITE, { em: 0xffffff, ei: 0.12, ao: 0.18 }), 0, 0.235, 0, 0, 0, 0, 1, 0.93, 1));
  // little cap
  P.push(xf(paint(new SphereGeometry(0.17, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, { em: 0xffffff, ei: 0.15 }), -0.02, 0.4, 0, 0, 0, 0.2, 1, 0.55, 1));
  P.push(xf(paint(new TorusGeometry(0.15, 0.025, 6, 22), 0xf0f4ff, { em: 0xffffff, ei: 0.1 }), -0.02, 0.405, 0, Math.PI / 2, 0, 0.2));
  // eyes (front = +x)
  for (const s of [-1, 1]) {
    const ex = Math.cos(0.38) * Math.cos(0.3) * 0.25;
    const ey = 0.235 + Math.sin(0.3) * 0.25 * 0.93;
    const ez = Math.sin(0.38) * Math.cos(0.3) * 0.25 * s;
    P.push(xf(paint(new SphereGeometry(0.07, 12, 10), 0x1a1020), ex - 0.012, ey, ez, 0, -0.38 * s, 0, 0.55, 1.2, 0.85));
    P.push(xf(paint(new SphereGeometry(0.024, 8, 6), 0xffffff, { em: 0xffffff, ei: 0.9 }), ex + 0.022, ey + 0.03, ez + 0.008 * s));
    // blush
    const bx = Math.cos(0.75) * Math.cos(0.02) * 0.245;
    const bz = Math.sin(0.75) * 0.245 * s;
    P.push(xf(paint(new SphereGeometry(0.045, 10, 6), 0xff9ab8, { em: 0xff6a90, ei: 0.25 }), bx, 0.2, bz, 0, 0, 0, 0.35, 0.6, 1));
    // feet
    P.push(xf(paint(new SphereGeometry(0.07, 10, 8), 0xf2f2fa), 0.03, 0.035, 0.12 * s, 0, 0, 0, 1.2, 0.6, 1));
  }
  // smile
  P.push(xf(paint(new TorusGeometry(0.035, 0.009, 4, 10, Math.PI), 0x2a1020), 0.245, 0.2, 0, 0, Math.PI / 2, Math.PI));
  return merge(P);
}

// ── Projectiles ─────────────────────────────────────────────────────────────

export function buildProjectileModel(kind: 'antibody' | 'mast' | 'generic'): G {
  if (kind === 'antibody') {
    const P: G[] = [];
    P.push(xf(paint(new CapsuleGeometry(0.045, 0.12, 2, 6), 0xe8ffff, { em: TOWER_ACCENT.antibody, ei: 2.2 }), 0, 0, 0, 0, 0, Math.PI / 2));
    P.push(rod(0.1, 0, 0, 0.17, 0.04, 0.04, 0.02, 0.02, 3, 0xe8ffff, { em: TOWER_ACCENT.antibody, ei: 2 }));
    P.push(rod(0.1, 0, 0, 0.17, 0.04, -0.04, 0.02, 0.02, 3, 0xe8ffff, { em: TOWER_ACCENT.antibody, ei: 2 }));
    return merge(P);
  }
  if (kind === 'mast') return merge([paint(new IcosahedronGeometry(0.09, 1), 0xffd6ec, { em: TOWER_ACCENT.mast, ei: 1.8 })]);
  return merge([paint(new IcosahedronGeometry(0.065, 1), 0xffffff, { em: 0xffffff, ei: 1.4 })]);
}

/** Antibiotic Strike pill (falls from the sky). */
export function buildPillModel(): G {
  const P: G[] = [];
  const a = new CapsuleGeometry(0.12, 0.2, 3, 10);
  // split colour by y: paint the whole then recolour the upper half
  const g = paint(a, 0xffffff, { em: 0xffffff, ei: 0.3 });
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) col.setXYZ(i, 1.0, 0.33, 0.08);
  }
  P.push(xf(g, 0, 0, 0, 0, 0, 0.5));
  return merge(P);
}
