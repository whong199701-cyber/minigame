/**
 * Pooled, preallocated VFX primitives (one draw call each, no per-frame allocation):
 *  - DecalLayer: instanced flat quads on the floor (rings, discs, soft blobs, reticles, arcs, dashed rings) used for
 *    blob shadows, range discs, selection rings, build highlights, shockwaves, acid pools, boss halos.
 *  - SpriteLayer: instanced camera-facing glow billboards (projectile halos, muzzle flashes, core / boss glows).
 *  - Particles: CPU-integrated Points ring buffer (sparks, debris, heat motes, hero trail).
 *  - Bolts: camera-facing jittered ribbons for chain lightning and T-cell tracers.
 *  - Waves: timed decal animations (expanding rings) feeding the decal layers.
 * Coordinates are three.js world (x, up, z) — callers map logic (x, y, h) → (x, h, y).
 */
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
  type Blending,
} from 'three';

function setBlend(m: ShaderMaterial, additive: boolean): void {
  const b: Blending = additive ? AdditiveBlending : NormalBlending;
  if (m.blending !== b) {
    m.blending = b;
    m.needsUpdate = true;
  }
}

// ── Decals ──────────────────────────────────────────────────────────────────

export const Shape = { Ring: 0, Disc: 1, Blob: 2, Reticle: 3, Arc: 4, Dashed: 5 } as const;
export type Shape = (typeof Shape)[keyof typeof Shape];

function markRange(att: InstancedBufferAttribute | Float32BufferAttribute, count: number): void {
  att.clearUpdateRanges();
  att.addUpdateRange(0, count);
  att.needsUpdate = true;
}

const DECAL_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iColor;
attribute vec4 iShape;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vShape;
void main() {
  vUv = position.xy;
  vColor = iColor;
  vShape = iShape;
  float c = cos(iSize.y);
  float s = sin(iSize.y);
  vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSize.x;
  // local +y maps to world -z so the quad keeps a front-facing winding seen from above
  vec4 world = vec4(iPos.x + p.x, iPos.y, iPos.z - p.y, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const DECAL_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vShape;
float band(float r, float th, float soft) {
  return smoothstep(1.0, 1.0 - soft, r) * smoothstep(1.0 - th - soft, 1.0 - th, r);
}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float shape = vShape.x;
  float th = vShape.y;
  float prm = vShape.z;
  float soft = max(vShape.w, 0.015);
  float a = 0.0;
  if (shape < 0.5) {
    a = band(r, th, soft);
  } else if (shape < 1.5) {
    a = max(band(r, th, soft), prm * smoothstep(1.0, 0.94, r) * (0.75 + 0.25 * r));
  } else if (shape < 2.5) {
    float k = 1.0 - r;
    a = k * k * (prm > 0.0 ? prm : 1.0);
  } else if (shape < 3.5) {
    float ringA = band(r, th, soft);
    float ticks = (abs(vUv.x) < 0.035 || abs(vUv.y) < 0.035) && r > 0.35 && r < 0.72 ? 1.0 : 0.0;
    float dotA = smoothstep(0.1, 0.06, r);
    a = max(max(ringA, ticks), dotA) + prm * 0.18;
  } else if (shape < 4.5) {
    float ringA = band(r, th, soft);
    float ang = atan(vUv.y, vUv.x) / 6.2831853 + 0.5;
    a = ringA * (ang < prm ? 1.0 : 0.22);
  } else {
    float ringA = band(r, th, soft);
    float ang = atan(vUv.y, vUv.x);
    a = ringA * smoothstep(-0.2, 0.2, sin(ang * prm));
  }
  a *= vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <colorspace_fragment>
}
`;

export class DecalLayer {
  readonly mesh: Mesh;
  private geo: InstancedBufferGeometry;
  private mat: ShaderMaterial;
  private pos: Float32Array;
  private size: Float32Array;
  private color: Float32Array;
  private shape: Float32Array;
  private aPos: InstancedBufferAttribute;
  private aSize: InstancedBufferAttribute;
  private aColor: InstancedBufferAttribute;
  private aShape: InstancedBufferAttribute;
  n = 0;
  constructor(
    readonly capacity: number,
    additive: boolean,
    renderOrder: number,
  ) {
    const base = new PlaneGeometry(2, 2);
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity * 2);
    this.color = new Float32Array(capacity * 4);
    this.shape = new Float32Array(capacity * 4);
    this.aPos = new InstancedBufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.aSize = new InstancedBufferAttribute(this.size, 2).setUsage(DynamicDrawUsage);
    this.aColor = new InstancedBufferAttribute(this.color, 4).setUsage(DynamicDrawUsage);
    this.aShape = new InstancedBufferAttribute(this.shape, 4).setUsage(DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iSize', this.aSize);
    g.setAttribute('iColor', this.aColor);
    g.setAttribute('iShape', this.aShape);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new ShaderMaterial({
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    setBlend(this.mat, additive);
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    base.dispose();
  }
  setAdditive(a: boolean): void {
    setBlend(this.mat, a);
  }
  begin(): void {
    this.n = 0;
  }
  /** `thick` is a fraction of the radius; `soft` (edge feather, fraction of radius) defaults to ~0.03 world units. */
  add(x: number, y: number, z: number, radius: number, rot: number, r: number, g: number, b: number, a: number, shape: Shape, thick = 0.1, param = 0, soft = -1): void {
    if (this.n >= this.capacity || a <= 0.002 || radius <= 0) return;
    if (soft < 0) soft = Math.min(0.08, Math.max(0.004, 0.035 / radius));
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i * 2] = radius;
    this.size[i * 2 + 1] = rot;
    this.color[i * 4] = r;
    this.color[i * 4 + 1] = g;
    this.color[i * 4 + 2] = b;
    this.color[i * 4 + 3] = a;
    this.shape[i * 4] = shape;
    this.shape[i * 4 + 1] = thick;
    this.shape[i * 4 + 2] = param;
    this.shape[i * 4 + 3] = soft;
  }
  end(): void {
    const n = this.n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    markRange(this.aPos, n * 3);
    markRange(this.aSize, n * 2);
    markRange(this.aColor, n * 4);
    markRange(this.aShape, n * 4);
  }
  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ── Glow sprites ────────────────────────────────────────────────────────────

const SPRITE_VERT = /* glsl */ `
attribute vec3 iPos;
attribute float iSize;
attribute vec4 iColor;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = position.xy * 2.0;
  vColor = iColor;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = iPos + (right * position.x + up * position.y) * iSize;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const SPRITE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float k = 1.0 - r;
  float a = k * k * vColor.a;
  vec3 col = vColor.rgb * (1.0 + smoothstep(0.45, 0.0, r) * 0.8);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export class SpriteLayer {
  readonly mesh: Mesh;
  private geo: InstancedBufferGeometry;
  private mat: ShaderMaterial;
  private pos: Float32Array;
  private size: Float32Array;
  private color: Float32Array;
  private aPos: InstancedBufferAttribute;
  private aSize: InstancedBufferAttribute;
  private aColor: InstancedBufferAttribute;
  n = 0;
  constructor(
    readonly capacity: number,
    additive: boolean,
  ) {
    const base = new PlaneGeometry(1, 1);
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 4);
    this.aPos = new InstancedBufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.aSize = new InstancedBufferAttribute(this.size, 1).setUsage(DynamicDrawUsage);
    this.aColor = new InstancedBufferAttribute(this.color, 4).setUsage(DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iSize', this.aSize);
    g.setAttribute('iColor', this.aColor);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new ShaderMaterial({ vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG, transparent: true, depthWrite: false, toneMapped: false });
    setBlend(this.mat, additive);
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    base.dispose();
  }
  setAdditive(a: boolean): void {
    setBlend(this.mat, a);
  }
  begin(): void {
    this.n = 0;
  }
  add(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number): void {
    if (this.n >= this.capacity || a <= 0.003) return;
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i] = size;
    this.color[i * 4] = r;
    this.color[i * 4 + 1] = g;
    this.color[i * 4 + 2] = b;
    this.color[i * 4 + 3] = a;
  }
  end(): void {
    const n = this.n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    markRange(this.aPos, n * 3);
    markRange(this.aSize, n);
    markRange(this.aColor, n * 4);
  }
  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ── Particles ───────────────────────────────────────────────────────────────

const PART_VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / -mv.z;
}
`;
const PART_FRAG = /* glsl */ `
uniform float uHard;
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = uHard > 0.5 ? smoothstep(1.0, 0.8, d) : smoothstep(1.0, 0.0, d);
  a *= vColor.a;
  if (a < 0.01) discard;
  vec3 col = vColor.rgb;
  if (uHard > 0.5) col *= 0.75 + 0.35 * (1.0 - d);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export class Particles {
  readonly points: Points;
  private mat: ShaderMaterial;
  private geo: BufferGeometry;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private next = 0;
  private live = 0;
  private aPos: Float32BufferAttribute;
  private aCol: Float32BufferAttribute;
  private aSize: Float32BufferAttribute;
  /** Emission budget scale (low quality halves bursts). */
  density = 1;
  constructor(
    readonly capacity: number,
    hard: boolean,
    additive: boolean,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    const g = new BufferGeometry();
    this.aPos = new Float32BufferAttribute(this.pos, 3);
    this.aCol = new Float32BufferAttribute(this.col, 4);
    this.aSize = new Float32BufferAttribute(this.size, 1);
    this.aPos.setUsage(DynamicDrawUsage);
    this.aCol.setUsage(DynamicDrawUsage);
    this.aSize.setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    this.geo = g;
    this.mat = new ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uHard: { value: hard ? 1 : 0 } },
      vertexShader: PART_VERT,
      fragmentShader: PART_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    setBlend(this.mat, additive);
    this.points = new Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = hard ? 5 : 9;
  }
  setAdditive(a: boolean): void {
    setBlend(this.mat, a);
  }
  setScale(s: number): void {
    this.mat.uniforms.uScale.value = s;
  }
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    s0: number,
    s1: number,
    r: number,
    g: number,
    b: number,
    a: number,
    grav = 0,
    drag = 1.5,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (this.life[i] <= 0) this.live++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.a0[i] = a;
    this.col[i * 4 + 3] = a;
    this.size[i] = s0;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }
  get active(): number {
    return this.live;
  }
  update(dt: number): void {
    if (this.live === 0) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    let live = 0;
    for (let i = 0; i < this.capacity; i++) {
      let l = this.life[i];
      if (l <= 0) continue;
      l -= dt;
      if (l <= 0) {
        this.life[i] = 0;
        this.size[i] = 0;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      live++;
      this.life[i] = l;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      const o = i * 3;
      this.vel[o] *= k;
      this.vel[o + 1] = this.vel[o + 1] * k - this.grav[i] * dt;
      this.vel[o + 2] *= k;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] < -0.2 && this.grav[i] > 0) {
        this.pos[o + 1] = -0.2;
        this.vel[o + 1] *= -0.3;
      }
      const t = 1 - l / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4 + 3] = this.a0[i] * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
    }
    this.live = live;
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
    this.live = 0;
    this.aSize.needsUpdate = true;
  }
  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ── Bolts (chain lightning, tracers) ────────────────────────────────────────

const BOLT_VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aAcross;
varying vec4 vColor;
varying float vAcross;
void main() {
  vColor = aColor;
  vAcross = aAcross;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BOLT_FRAG = /* glsl */ `
varying vec4 vColor;
varying float vAcross;
void main() {
  float k = 1.0 - vAcross * vAcross;
  float a = k * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <colorspace_fragment>
}
`;

const MAX_PTS = 10;
const SUB = 4;

export class Bolts {
  readonly mesh: Mesh;
  private geo: BufferGeometry;
  private mat: ShaderMaterial;
  private pos: Float32Array;
  private col: Float32Array;
  private across: Float32Array;
  private aPos: Float32BufferAttribute;
  private aCol: Float32BufferAttribute;
  private aAcross: Float32BufferAttribute;
  private maxVerts: number;
  // line pool
  private active: Uint8Array;
  private npts: Uint8Array;
  private pts: Float32Array;
  private rgb: Float32Array;
  private width: Float32Array;
  private t0: Float32Array;
  private dur: Float32Array;
  private jitter: Float32Array;
  private seed: Uint32Array;
  private nextLine = 0;
  private liveCount = 0;
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private tmpS = new Vector3();
  private sub = new Float32Array((MAX_PTS * SUB + 1) * 3);
  constructor(readonly lines: number) {
    this.maxVerts = lines * (MAX_PTS - 1) * SUB * 2 * 6;
    this.pos = new Float32Array(this.maxVerts * 3);
    this.col = new Float32Array(this.maxVerts * 4);
    this.across = new Float32Array(this.maxVerts);
    const g = new BufferGeometry();
    this.aPos = new Float32BufferAttribute(this.pos, 3);
    this.aCol = new Float32BufferAttribute(this.col, 4);
    this.aAcross = new Float32BufferAttribute(this.across, 1);
    this.aPos.setUsage(DynamicDrawUsage);
    this.aCol.setUsage(DynamicDrawUsage);
    this.aAcross.setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aAcross', this.aAcross);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new ShaderMaterial({ vertexShader: BOLT_VERT, fragmentShader: BOLT_FRAG, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide });
    setBlend(this.mat, true);
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.active = new Uint8Array(lines);
    this.npts = new Uint8Array(lines);
    this.pts = new Float32Array(lines * MAX_PTS * 3);
    this.rgb = new Float32Array(lines * 3);
    this.width = new Float32Array(lines);
    this.t0 = new Float32Array(lines);
    this.dur = new Float32Array(lines);
    this.jitter = new Float32Array(lines);
    this.seed = new Uint32Array(lines);
  }
  setAdditive(a: boolean): void {
    setBlend(this.mat, a);
  }
  /** Starts a new line; returns its slot for `point` calls. */
  begin(now: number, r: number, g: number, b: number, width: number, dur: number, jitter: number): number {
    const i = this.nextLine;
    this.nextLine = (this.nextLine + 1) % this.lines;
    this.active[i] = 1;
    this.npts[i] = 0;
    this.rgb[i * 3] = r;
    this.rgb[i * 3 + 1] = g;
    this.rgb[i * 3 + 2] = b;
    this.width[i] = width;
    this.t0[i] = now;
    this.dur[i] = dur;
    this.jitter[i] = jitter;
    this.seed[i] = (Math.imul(i + 1, 2654435761) ^ Math.floor(now * 1000)) >>> 0;
    return i;
  }
  point(slot: number, x: number, y: number, z: number): void {
    const n = this.npts[slot];
    if (n >= MAX_PTS) return;
    const o = (slot * MAX_PTS + n) * 3;
    this.pts[o] = x;
    this.pts[o + 1] = y;
    this.pts[o + 2] = z;
    this.npts[slot] = n + 1;
  }
  get live(): number {
    return this.liveCount;
  }
  private rnd(seed: number): number {
    let h = seed | 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295 - 0.5;
  }
  update(now: number, camFwd: Vector3): void {
    let v = 0;
    let live = 0;
    const tick = Math.floor(now * 30);
    for (let i = 0; i < this.lines; i++) {
      if (!this.active[i]) continue;
      const age = now - this.t0[i];
      if (age >= this.dur[i] || age < 0) {
        this.active[i] = 0;
        continue;
      }
      live++;
      const n = this.npts[i];
      if (n < 2) continue;
      const fadeK = 1 - age / this.dur[i];
      const alpha = fadeK * fadeK;
      const jit = this.jitter[i];
      // build jittered polyline
      let m = 0;
      for (let p = 0; p < n - 1; p++) {
        const o = (i * MAX_PTS + p) * 3;
        const ax = this.pts[o];
        const ay = this.pts[o + 1];
        const az = this.pts[o + 2];
        const bx = this.pts[o + 3];
        const by = this.pts[o + 4];
        const bz = this.pts[o + 5];
        for (let s = 0; s < SUB; s++) {
          const t = s / SUB;
          const env = Math.sin(t * Math.PI);
          const sd = this.seed[i] + p * 131 + s * 17 + tick * 7919;
          this.sub[m * 3] = ax + (bx - ax) * t + this.rnd(sd) * jit * env;
          this.sub[m * 3 + 1] = ay + (by - ay) * t + this.rnd(sd + 3) * jit * env * 0.6;
          this.sub[m * 3 + 2] = az + (bz - az) * t + this.rnd(sd + 5) * jit * env;
          m++;
        }
        if (p === n - 2) {
          this.sub[m * 3] = bx;
          this.sub[m * 3 + 1] = by;
          this.sub[m * 3 + 2] = bz;
          m++;
        }
      }
      const r = this.rgb[i * 3];
      const g = this.rgb[i * 3 + 1];
      const b = this.rgb[i * 3 + 2];
      for (let layer = 0; layer < 2; layer++) {
        const w = layer === 0 ? this.width[i] * 2.6 : this.width[i] * 0.7;
        const cr = layer === 0 ? r : 0.6 + r * 0.4;
        const cg = layer === 0 ? g : 0.6 + g * 0.4;
        const cb = layer === 0 ? b : 0.6 + b * 0.4;
        const ca = layer === 0 ? alpha * 0.45 : alpha;
        for (let k = 0; k < m - 1; k++) {
          if (v + 6 > this.maxVerts) break;
          const A = this.tmpA.set(this.sub[k * 3], this.sub[k * 3 + 1], this.sub[k * 3 + 2]);
          const B = this.tmpB.set(this.sub[k * 3 + 3], this.sub[k * 3 + 4], this.sub[k * 3 + 5]);
          const S = this.tmpS.subVectors(B, A).cross(camFwd);
          const L = S.length() || 1;
          S.multiplyScalar(w / (2 * L));
          v = this.quad(v, A, B, S, cr, cg, cb, ca);
        }
      }
    }
    this.liveCount = live;
    this.geo.setDrawRange(0, v);
    this.mesh.visible = v > 0;
    if (v > 0) {
      markRange(this.aPos, v * 3);
      markRange(this.aCol, v * 4);
      markRange(this.aAcross, v);
    }
  }
  private vert(v: number, x: number, y: number, z: number, side: number, r: number, g: number, b: number, a: number): void {
    const P = this.pos;
    const C = this.col;
    P[v * 3] = x;
    P[v * 3 + 1] = y;
    P[v * 3 + 2] = z;
    C[v * 4] = r;
    C[v * 4 + 1] = g;
    C[v * 4 + 2] = b;
    C[v * 4 + 3] = a;
    this.across[v] = side;
  }
  private quad(v: number, A: Vector3, B: Vector3, S: Vector3, r: number, g: number, b: number, a: number): number {
    this.vert(v, A.x + S.x, A.y + S.y, A.z + S.z, 1, r, g, b, a);
    this.vert(v + 1, A.x - S.x, A.y - S.y, A.z - S.z, -1, r, g, b, a);
    this.vert(v + 2, B.x + S.x, B.y + S.y, B.z + S.z, 1, r, g, b, a);
    this.vert(v + 3, B.x + S.x, B.y + S.y, B.z + S.z, 1, r, g, b, a);
    this.vert(v + 4, A.x - S.x, A.y - S.y, A.z - S.z, -1, r, g, b, a);
    this.vert(v + 5, B.x - S.x, B.y - S.y, B.z - S.z, -1, r, g, b, a);
    return v + 6;
  }
  clear(): void {
    this.active.fill(0);
    this.liveCount = 0;
  }
  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ── Timed decal animations ─────────────────────────────────────────────────

export class Waves {
  private active: Uint8Array;
  private data: Float32Array; // x y z t0 dur r0 r1 r g b a thick
  private shape: Uint8Array;
  private additive: Uint8Array;
  private next = 0;
  private static K = 12;
  live = 0;
  constructor(readonly capacity: number) {
    this.active = new Uint8Array(capacity);
    this.data = new Float32Array(capacity * Waves.K);
    this.shape = new Uint8Array(capacity);
    this.additive = new Uint8Array(capacity);
  }
  add(now: number, x: number, y: number, z: number, dur: number, r0: number, r1: number, r: number, g: number, b: number, a: number, thick: number, shape: Shape = Shape.Ring, additive = true): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.active[i] = 1;
    const o = i * Waves.K;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = now;
    d[o + 4] = dur;
    d[o + 5] = r0;
    d[o + 6] = r1;
    d[o + 7] = r;
    d[o + 8] = g;
    d[o + 9] = b;
    d[o + 10] = a;
    d[o + 11] = thick;
    this.shape[i] = shape;
    this.additive[i] = additive ? 1 : 0;
  }
  emit(now: number, add: DecalLayer, alpha: DecalLayer): void {
    let live = 0;
    const d = this.data;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue;
      const o = i * Waves.K;
      const t = (now - d[o + 3]) / d[o + 4];
      if (t >= 1 || t < 0) {
        this.active[i] = 0;
        continue;
      }
      live++;
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      const rad = d[o + 5] + (d[o + 6] - d[o + 5]) * e;
      const a = d[o + 10] * (1 - t) * (t < 0.1 ? t / 0.1 : 1);
      const layer = this.additive[i] ? add : alpha;
      const shape = this.shape[i] as Shape;
      const param = shape === Shape.Blob ? 1 : shape === Shape.Dashed ? 10 : shape === Shape.Reticle ? 0 : 0.35;
      layer.add(d[o], d[o + 1], d[o + 2], rad, shape === Shape.Dashed ? now * 1.5 : 0, d[o + 7], d[o + 8], d[o + 9], a, shape, d[o + 11], param);
    }
    this.live = live;
  }
  clear(): void {
    this.active.fill(0);
    this.live = 0;
  }
}

/** The shared VFX layers passed to entity layers each frame. */
export interface FxLayers {
  /** Normal-blended floor decals (blob shadows, range fills). */
  alphaDecals: DecalLayer;
  /** Glow floor decals (rings, halos, highlights). */
  glowDecals: DecalLayer;
  sprites: SpriteLayer;
  sparks: Particles;
  debris: Particles;
  bolts: Bolts;
  waves: Waves;
}
