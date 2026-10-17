/**
 * Small allocation-free helpers shared by the renderer modules: deterministic noise, geometry painting / merging,
 * an int-keyed table for per-entity VFX state and a renderer-local xorshift (VFX randomness never touches logic).
 */
import { BufferGeometry, Color, Euler, Float32BufferAttribute, IcosahedronGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ── Deterministic noise ────────────────────────────────────────────────────

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(iz | 0, 1274126177) ^ Math.imul(seed | 0, 974634291);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const fade = (t: number): number => t * t * (3 - 2 * t);

/** Smooth value noise in [-1, 1]. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return (y0 + (y1 - y0) * fz) * 2 - 1;
}

/** Renderer-local xorshift32 in [0, 1). */
export class Rand {
  private s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed | 0 || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x;
    return (x >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Symmetric [-a, a]. */
  sym(a: number): number {
    return (this.next() * 2 - 1) * a;
  }
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ── Geometry helpers ───────────────────────────────────────────────────────

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _c2 = new Color();
const _c3 = new Color();

/** Applies translate · rotate (XYZ euler) · scale to a geometry in place. */
export function xf(g: BufferGeometry, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): BufferGeometry {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(px, py, pz);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

export interface PaintOpts {
  /** Emissive colour (hex) and its intensity multiplier. */
  em?: number;
  ei?: number;
  /** Optional vertical gradient: colour at the top of the part. */
  top?: number;
  /** Darken the underside (0..1) for a soft ambient-occlusion look. */
  ao?: number;
}

/**
 * Converts to non-indexed (flat facets merge cleanly), strips uvs and adds `color` and `aEmissive` vertex attributes so
 * every part of a merged model can carry its own albedo and glow.
 */
export function paint(g: BufferGeometry, color: number, o: PaintOpts = {}): BufferGeometry {
  let geo = g;
  if (geo.index) {
    geo = g.toNonIndexed();
    g.dispose();
  }
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  }
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const em = new Float32Array(n * 3);
  _c.setHex(color);
  if (o.top !== undefined) _c3.setHex(o.top);
  const ei = o.ei ?? 0;
  if (o.em !== undefined) _c2.setHex(o.em).multiplyScalar(ei);
  else _c2.setRGB(0, 0, 0);
  let y0 = Infinity;
  let y1 = -Infinity;
  if (o.top !== undefined || o.ao) {
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i);
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const span = Math.max(1e-6, y1 - y0);
  for (let i = 0; i < n; i++) {
    let r = _c.r;
    let gg = _c.g;
    let b = _c.b;
    if (o.top !== undefined || o.ao) {
      const t = (pos.getY(i) - y0) / span;
      if (o.top !== undefined) {
        r = r + (_c3.r - r) * t;
        gg = gg + (_c3.g - gg) * t;
        b = b + (_c3.b - b) * t;
      }
      if (o.ao) {
        const k = 1 - o.ao * (1 - smoothstep(0, 0.55, t));
        r *= k;
        gg *= k;
        b *= k;
      }
    }
    col[i * 3] = r;
    col[i * 3 + 1] = gg;
    col[i * 3 + 2] = b;
    em[i * 3] = _c2.r;
    em[i * 3 + 1] = _c2.g;
    em[i * 3 + 2] = _c2.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setAttribute('aEmissive', new Float32BufferAttribute(em, 3));
  return geo;
}

/** Merges painted parts into one geometry (disposes the parts). */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const out = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!out) throw new Error('merge failed');
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Faceted organic blob: icosphere displaced by smooth noise. */
export function blob(radius: number, detail: number, amp: number, seed: number, freq = 1.7): BufferGeometry {
  const g = new IcosahedronGeometry(radius, detail);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const d = 1 + amp * noise3(nx * freq + seed * 3.17, ny * freq + seed * 1.31, nz * freq - seed * 2.07, seed);
    pos.setXYZ(i, nx * radius * d, ny * radius * d, nz * radius * d);
  }
  g.computeVertexNormals();
  return g;
}

/** Points evenly spread on a unit sphere (Fibonacci), optionally only above `minY`. */
export function fibSphere(count: number, minY = -1): Vector3[] {
  const out: Vector3[] = [];
  const total = Math.ceil(count / Math.max(0.05, (1 - minY) / 2));
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < total && out.length < count; i++) {
    const y = 1 - (i / Math.max(1, total - 1)) * 2;
    if (y < minY) continue;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * i;
    out.push(new Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  return out;
}

// ── Int-keyed table (no per-frame allocation) ──────────────────────────────

/**
 * Open-addressing table from a non-negative int id to `channels` float values. No deletion: callers rebuild it
 * (clear + re-insert) every frame, which also drops entries of entities that disappeared.
 */
export class IdTable {
  readonly keys: Int32Array;
  readonly vals: Float32Array;
  readonly mask: number;
  size = 0;
  constructor(
    capacityPow2: number,
    readonly channels: number,
  ) {
    this.keys = new Int32Array(capacityPow2).fill(-1);
    this.vals = new Float32Array(capacityPow2 * channels);
    this.mask = capacityPow2 - 1;
  }
  clear(): void {
    if (this.size === 0) return;
    this.keys.fill(-1);
    this.size = 0;
  }
  /** Slot of `id`, or -1. */
  find(id: number): number {
    let i = Math.imul(id, 0x9e3779b1) >>> 0;
    i &= this.mask;
    for (let n = 0; n <= this.mask; n++) {
      const k = this.keys[i];
      if (k === id) return i;
      if (k === -1) return -1;
      i = (i + 1) & this.mask;
    }
    return -1;
  }
  /** Slot of `id`, inserting (values zeroed) when missing; -1 when full. */
  slot(id: number): number {
    let i = Math.imul(id, 0x9e3779b1) >>> 0;
    i &= this.mask;
    for (let n = 0; n <= this.mask; n++) {
      const k = this.keys[i];
      if (k === id) return i;
      if (k === -1) {
        if (this.size >= (this.mask * 3) >> 2) return -1;
        this.keys[i] = id;
        this.size++;
        const o = i * this.channels;
        for (let c = 0; c < this.channels; c++) this.vals[o + c] = 0;
        return i;
      }
      i = (i + 1) & this.mask;
    }
    return -1;
  }
  get(id: number, ch: number, fallback = 0): number {
    const s = this.find(id);
    return s < 0 ? fallback : this.vals[s * this.channels + ch];
  }
  set(id: number, ch: number, v: number): void {
    const s = this.slot(id);
    if (s >= 0) this.vals[s * this.channels + ch] = v;
  }
}

/** Writes T · Ry(yaw) · S(sx, sy, sz) into a column-major mat4 array at `o` (allocation-free instance matrices). */
export function writeTRS(a: Float32Array | number[], o: number, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  a[o] = c * sx;
  a[o + 1] = 0;
  a[o + 2] = -s * sx;
  a[o + 3] = 0;
  a[o + 4] = 0;
  a[o + 5] = sy;
  a[o + 6] = 0;
  a[o + 7] = 0;
  a[o + 8] = s * sz;
  a[o + 9] = 0;
  a[o + 10] = c * sz;
  a[o + 11] = 0;
  a[o + 12] = x;
  a[o + 13] = y;
  a[o + 14] = z;
  a[o + 15] = 1;
}

/** Writes T · Ry(yaw) · Rz(tilt) · S into a column-major mat4 (tilt leans the model forward/back along its +x). */
export function writeTRS2(
  a: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  tilt: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  const cy = Math.cos(yaw);
  const sy_ = Math.sin(yaw);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  // Rz(tilt): x' = ct x - st y ; y' = st x + ct y
  // Ry(yaw):  x'' = cy x' + sy z ; z'' = -sy x' + cy z
  // column 0 = R * (sx,0,0)
  a[o] = cy * ct * sx;
  a[o + 1] = st * sx;
  a[o + 2] = -sy_ * ct * sx;
  a[o + 3] = 0;
  a[o + 4] = -cy * st * sy;
  a[o + 5] = ct * sy;
  a[o + 6] = sy_ * st * sy;
  a[o + 7] = 0;
  a[o + 8] = sy_ * sz;
  a[o + 9] = 0;
  a[o + 10] = cy * sz;
  a[o + 11] = 0;
  a[o + 12] = x;
  a[o + 13] = y;
  a[o + 14] = z;
  a[o + 15] = 1;
}

/** Linear RGB of a hex colour into `out` at `o` (sets 3 floats). */
export function hexToLinear(hex: number, out: Float32Array | number[], o: number, k = 1): void {
  _c.setHex(hex);
  out[o] = _c.r * k;
  out[o + 1] = _c.g * k;
  out[o + 2] = _c.b * k;
}

/** Linear colour cache: avoids Color allocations in hot paths. */
export class Lin {
  r = 0;
  g = 0;
  b = 0;
  constructor(hex = 0xffffff) {
    this.set(hex);
  }
  set(hex: number): this {
    _c.setHex(hex);
    this.r = _c.r;
    this.g = _c.g;
    this.b = _c.b;
    return this;
  }
}
