/**
 * The organ: a heightfield floor with vessels carved as trenches (smooth organic undulations, raised tissue walls
 * around the board), a translucent glowing blood ribbon in every trench whose bands stream with the flow, flow
 * particles (one Points draw animated in the vertex shader), drifting red blood cells, membrane build pads with
 * glowing rings (build highlights), villi fronds, the vital core and bioluminescent specks.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  Points,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type Material,
} from 'three';
import { WORLD } from '../types';
import { buildMapInfo, distToVessel, type MapInfo } from './mapgeom';
import { createStaticMaterial, type SharedUniforms } from './materials';
import type { Palette } from './palette';
import { Lin, Rand, blob, clamp, merge, noise3, paint, smoothstep, writeTRS, xf } from './util';
import type { MapDef } from '../types';

const TD = WORLD.trenchDepth;
const RES = 5; // heightfield samples per cell over the map (+ FINE_PAD around it)
const MX = 6; // side margin (cells)
const MZF = 8; // far margin
const MZN = 6; // near margin
/**
 * The heightfield is fine (1 / RES) only over the map plus this many cells around it — what the camera can show —
 * and about one sample per cell in the rest of the margin (the rising organ wall, mostly off-screen or fogged). That
 * halves the floor's triangles (Brain 31.9k → 15.8k) without touching the trenches.
 */
const FINE_PAD_X = 1.6;
const FINE_PAD_FAR = 2.0;
const FINE_PAD_NEAR = 1.6;

/** Sample coordinates along one axis: coarse (≈ 1 cell) in [lo, fineLo], 1 / RES in [fineLo, fineHi], coarse to hi. */
function axisSamples(lo: number, fineLo: number, fineHi: number, hi: number): Float32Array {
  const out: number[] = [];
  const nA = Math.max(1, Math.ceil(fineLo - lo));
  for (let i = 0; i < nA; i++) out.push(lo + ((fineLo - lo) * i) / nA);
  const nF = Math.round((fineHi - fineLo) * RES);
  for (let i = 0; i < nF; i++) out.push(fineLo + i / RES);
  const nB = Math.max(1, Math.ceil(hi - fineHi));
  for (let i = 0; i <= nB; i++) out.push(fineHi + ((hi - fineHi) * i) / nB);
  return Float32Array.from(out);
}

/** Index i with a[i] ≤ v < a[i + 1] (clamped) and the fraction between them. */
function locate(a: Float32Array, v: number, out: { i: number; t: number }): void {
  const n = a.length;
  if (v <= a[0]) {
    out.i = 0;
    out.t = 0;
    return;
  }
  if (v >= a[n - 1]) {
    out.i = n - 2;
    out.t = 1;
    return;
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (a[m] <= v) lo = m;
    else hi = m;
  }
  out.i = lo;
  out.t = (v - a[lo]) / (a[lo + 1] - a[lo]);
}
const LIQUID_Y = -0.105;

export interface TerrainOpts {
  flowParticles: number;
}

const FLOW_VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aDir;
attribute vec4 aData; // len, flow, phase, size
uniform float uTime;
uniform float uDir;
uniform float uSpeed;
uniform float uScale;
varying float vAlpha;
void main() {
  float len = aData.x;
  float f = aData.y * uDir;
  float s;
  if (aData.y == 0.0) {
    s = aData.z * len + sin(uTime * 0.9 + aData.z * 40.0) * 0.12;
  } else {
    s = mod(aData.z * len + uTime * uSpeed * f, len);
  }
  vec3 p = aStart + aDir * s;
  p.y += sin(uTime * 2.3 + aData.z * 60.0) * 0.015;
  vAlpha = smoothstep(0.0, 0.45, s) * smoothstep(len, len - 0.45, s);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aData.w * uScale / -mv.z;
}
`;

const FLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.15, d) * vAlpha * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * (0.75 + 0.5 * (1.0 - d)), a);
  #include <colorspace_fragment>
}
`;

const RIBBON_VERT = /* glsl */ `
attribute vec2 aFlow;   // travel direction (x, z) times flow sign
attribute vec2 aInfo;   // x: still (1) / flowing (0), y: lateral -1..1
varying vec2 vFlow;
varying vec2 vInfo;
varying vec2 vWorld;
void main() {
  vFlow = aFlow;
  vInfo = aInfo;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const RIBBON_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDir;
uniform float uSpeed;
uniform float uWarn;
uniform vec3 uBlood;
uniform vec3 uBloodHi;
uniform float uOpacity;
varying vec2 vFlow;
varying vec2 vInfo;
varying vec2 vWorld;
void main() {
  float along = dot(vWorld, vFlow);
  float phase;
  if (vInfo.x > 0.5) phase = dot(vWorld, vec2(0.7, 0.7)) * 1.3 + sin(uTime * 0.8) * 0.3;
  // chevrons: bands lag at the edges so each band points downstream (readable flow even in a still frame)
  else phase = along * 1.35 + abs(vInfo.y) * 0.42 - uTime * uSpeed * uDir * 1.35;
  float band = smoothstep(0.55, 1.0, sin(phase * 6.2831853) * 0.5 + 0.5);
  float band2 = smoothstep(0.7, 1.0, sin(phase * 3.1415926 + 1.7 + vInfo.y * 2.0) * 0.5 + 0.5);
  float edge = 1.0 - pow(abs(vInfo.y), 2.4);
  vec3 col = mix(uBlood, uBloodHi, band * 0.7 + band2 * 0.25);
  float blink = uWarn * (0.5 + 0.5 * sin(uTime * 18.0));
  col = mix(col, vec3(0.75, 0.9, 1.0), blink * 0.55);
  float a = uOpacity * edge * (0.62 + 0.3 * band);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

const SPECK_VERT = /* glsl */ `
attribute vec4 aData; // size, phase, speed, unused
uniform float uTime;
uniform float uScale;
varying float vA;
void main() {
  vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * aData.z + aData.y * 6.2831));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aData.x * uScale / -mv.z;
}
`;
const SPECK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d) * vA * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

interface RbcState {
  seg: number;
  phase: number;
  lat: number;
  spin: number;
  size: number;
}

export class Terrain {
  readonly root = new Object3D();
  info: MapInfo;
  /** Heightfield (logic x/y grid) for height queries. */
  private hf: Float32Array;
  private hfW: number;
  private hfH: number;
  /** Sample x (columns) / z (rows) of the non-uniform heightfield. */
  private gx: Float32Array;
  private gz: Float32Array;
  private loc = { i: 0, t: 0 };
  private floorGeo: BufferGeometry;
  private floorMat: MeshLambertMaterial;
  private floor: Mesh;
  private hfDist: Float32Array;
  private hfOut: Float32Array;
  private hfNoise: Float32Array;
  private ribbonMat: ShaderMaterial;
  private ribbon: Mesh;
  private flowMat: ShaderMaterial;
  private flow: Points;
  private flowCount: number;
  private speckMat: ShaderMaterial;
  private specks: Points;
  private rbc: InstancedMesh;
  private rbcState: RbcState[] = [];
  private pads: InstancedMesh;
  private padRings: InstancedMesh;
  private padRingMat: MeshBasicMaterial;
  private padMat: MeshLambertMaterial;
  private villiMesh: Mesh | null = null;
  private coreGroup = new Object3D();
  private coreHeart: Mesh;
  private coreShell: Mesh;
  private coreBase: Mesh;
  private coreMat: MeshLambertMaterial;
  private coreShellMat: MeshStandardMaterial;
  private deco: InstancedMesh;
  private decoMat: MeshLambertMaterial;
  private highlighted: Uint8Array;
  private padCount: number;
  private ringBase = new Lin();
  private ringHi = new Lin();
  private ringVilli = new Lin();
  private disposables: { dispose(): void }[] = [];
  coreFlash = 0;
  coreShake = 0;

  constructor(
    map: MapDef,
    u: SharedUniforms,
    private pal: Palette,
    opts: TerrainOpts,
  ) {
    const info = buildMapInfo(map);
    this.info = info;
    const { cols, rows } = info;
    // ── heightfield ──
    this.gx = axisSamples(-MX, -FINE_PAD_X, cols + FINE_PAD_X, cols + MX);
    this.gz = axisSamples(-MZF, -FINE_PAD_FAR, rows + FINE_PAD_NEAR, rows + MZN);
    this.hfW = this.gx.length;
    this.hfH = this.gz.length;
    const N = this.hfW * this.hfH;
    this.hf = new Float32Array(N);
    this.hfDist = new Float32Array(N);
    this.hfOut = new Float32Array(N);
    this.hfNoise = new Float32Array(N);
    const padD = (x: number, y: number): number => {
      let best = 9;
      const c0 = Math.floor(x);
      const r0 = Math.floor(y);
      for (let r = r0 - 1; r <= r0 + 1; r++)
        for (let c = c0 - 1; c <= c0 + 1; c++) {
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          if (info.padAt[r * cols + c] < 0) continue;
          const d = Math.hypot(x - c - 0.5, y - r - 0.5);
          if (d < best) best = d;
        }
      return best;
    };
    const coreD = (x: number, y: number): number => Math.hypot(x - info.coreX, y - info.coreY);
    for (let j = 0; j < this.hfH; j++) {
      for (let i = 0; i < this.hfW; i++) {
        const x = this.gx[i];
        const y = this.gz[j];
        const k = j * this.hfW + i;
        const ox = Math.max(0, -0.3 - x, x - cols - 0.3);
        const oy = Math.max(0, -0.3 - y, y - rows - 0.3);
        const out = Math.hypot(ox, oy);
        const n1 = noise3(x * 0.55, y * 0.55, 1.3);
        const n2 = noise3(x * 1.7 + 4, y * 1.7, 7.1);
        let base = 0.045 * n1 + 0.02 * n2;
        base *= smoothstep(0.32, 0.8, padD(x, y));
        base += smoothstep(0.0, 3.5, out) * (0.55 + 0.35 * noise3(x * 0.35, y * 0.35, 9.0)) + smoothstep(2.5, 7, out) * 0.6;
        const cd = coreD(x, y);
        base -= 0.05 * (1 - smoothstep(0.5, 1.2, cd));
        const d = distToVessel(info, x, y);
        let hh: number;
        if (d < 0.47) hh = base + (-TD - base) * (1 - smoothstep(0.27, 0.47, d));
        else hh = base + 0.04 * (1 - smoothstep(0.47, 0.78, d));
        this.hf[k] = hh;
        this.hfDist[k] = d;
        this.hfOut[k] = out;
        this.hfNoise[k] = n1 * 0.6 + n2 * 0.4;
      }
    }
    const pos = new Float32Array(N * 3);
    for (let j = 0; j < this.hfH; j++)
      for (let i = 0; i < this.hfW; i++) {
        const k = j * this.hfW + i;
        pos[k * 3] = this.gx[i];
        pos[k * 3 + 1] = this.hf[k];
        pos[k * 3 + 2] = this.gz[j];
      }
    const idx = new Uint32Array((this.hfW - 1) * (this.hfH - 1) * 6);
    let q = 0;
    for (let j = 0; j < this.hfH - 1; j++)
      for (let i = 0; i < this.hfW - 1; i++) {
        const a = j * this.hfW + i;
        const b = a + 1;
        const c = a + this.hfW;
        const d = c + 1;
        // alternate diagonals for a less directional facet pattern
        if ((i + j) % 2) {
          idx[q++] = a;
          idx[q++] = c;
          idx[q++] = b;
          idx[q++] = b;
          idx[q++] = c;
          idx[q++] = d;
        } else {
          idx[q++] = a;
          idx[q++] = c;
          idx[q++] = d;
          idx[q++] = a;
          idx[q++] = d;
          idx[q++] = b;
        }
      }
    const fg = new BufferGeometry();
    fg.setAttribute('position', new BufferAttribute(pos, 3));
    fg.setIndex(new BufferAttribute(idx, 1));
    fg.setAttribute('color', new Float32BufferAttribute(new Float32Array(N * 3), 3));
    fg.setAttribute('aEmissive', new Float32BufferAttribute(new Float32Array(N * 3), 3));
    fg.computeVertexNormals();
    this.floorGeo = fg;
    this.floorMat = createStaticMaterial(u, { flat: false });
    this.floor = new Mesh(fg, this.floorMat);
    this.floor.receiveShadow = true;
    this.root.add(this.floor);

    // ── blood ribbon ──
    this.ribbonMat = new ShaderMaterial({
      uniforms: {
        uTime: u.uTime,
        uDir: { value: 1 },
        uSpeed: { value: 0.75 },
        uWarn: { value: 0 },
        uBlood: { value: new Color() },
        uBloodHi: { value: new Color() },
        uOpacity: { value: 0.8 },
      },
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.ribbon = new Mesh(this.buildRibbon(info), this.ribbonMat);
    this.ribbon.renderOrder = 1;
    this.root.add(this.ribbon);

    // ── flow particles ──
    this.flowCount = opts.flowParticles;
    this.flowMat = new ShaderMaterial({
      uniforms: {
        uTime: u.uTime,
        uDir: { value: 1 },
        uSpeed: { value: 1.25 },
        uScale: { value: 400 },
        uColor: { value: new Color() },
        uOpacity: { value: 0.9 },
      },
      vertexShader: FLOW_VERT,
      fragmentShader: FLOW_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.flow = new Points(this.buildFlow(info, 1200), this.flowMat);
    this.flow.frustumCulled = false;
    this.flow.renderOrder = 3;
    this.flow.geometry.setDrawRange(0, this.flowCount);
    this.root.add(this.flow);

    // ── specks (bioluminescence) ──
    this.speckMat = new ShaderMaterial({
      uniforms: { uTime: u.uTime, uScale: { value: 400 }, uColor: { value: new Color() }, uOpacity: { value: 0.8 } },
      vertexShader: SPECK_VERT,
      fragmentShader: SPECK_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.specks = new Points(this.buildSpecks(info), this.speckMat);
    this.specks.frustumCulled = false;
    this.specks.renderOrder = 3;
    this.root.add(this.specks);

    // ── red blood cells drifting in the vessels ──
    const rbcGeo = merge([
      paint(
        new LatheGeometry([new Vector2(0, 0.03), new Vector2(0.06, 0.045), new Vector2(0.11, 0.055), new Vector2(0.14, 0.035), new Vector2(0.15, 0), new Vector2(0.14, -0.035), new Vector2(0.11, -0.055), new Vector2(0.06, -0.045), new Vector2(0, -0.03)], 9),
        0xffffff,
        { em: 0xff3050, ei: 0.25 },
      ),
    ]);
    const rbcMat = createStaticMaterial(u, { flat: true });
    const rnd = new Rand(4242);
    let total = 0;
    for (const s of info.segs) total += s.len;
    const nRbc = Math.min(48, Math.max(8, Math.round(total / 2.2)));
    for (let i = 0; i < nRbc; i++) {
      let pick = rnd.next() * total;
      let seg = 0;
      for (; seg < info.segs.length - 1; seg++) {
        if (pick < info.segs[seg].len) break;
        pick -= info.segs[seg].len;
      }
      this.rbcState.push({ seg, phase: rnd.next(), lat: rnd.sym(0.18), spin: rnd.range(0.6, 2.2) * (rnd.next() < 0.5 ? -1 : 1), size: rnd.range(0.8, 1.15) });
    }
    this.rbc = new InstancedMesh(rbcGeo, rbcMat, nRbc);
    this.rbc.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rbc.frustumCulled = false;
    this.rbc.renderOrder = 2;
    this.root.add(this.rbc);

    // ── pads ──
    const padPts = [new Vector2(0, 0.125), new Vector2(0.18, 0.123), new Vector2(0.29, 0.113), new Vector2(0.36, 0.095), new Vector2(0.4, 0.062), new Vector2(0.415, 0.025), new Vector2(0.405, -0.02)];
    const padGeo = merge([paint(new LatheGeometry(padPts, 16), 0xffffff, { top: 0xffffff })]);
    this.padMat = createStaticMaterial(u, { flat: false });
    this.padMat.emissive = new Color();
    this.padCount = info.pads.length;
    this.pads = new InstancedMesh(padGeo, this.padMat, Math.max(1, this.padCount));
    this.pads.receiveShadow = true;
    this.padRingMat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const ringGeo = new TorusGeometry(0.4, 0.028, 3, 28);
    ringGeo.rotateX(Math.PI / 2);
    this.padRings = new InstancedMesh(ringGeo, this.padRingMat, Math.max(1, this.padCount));
    this.padRings.instanceColor = new InstancedBufferAttribute(new Float32Array(Math.max(1, this.padCount) * 3), 3);
    this.padRings.instanceColor.setUsage(DynamicDrawUsage);
    this.highlighted = new Uint8Array(Math.max(1, this.padCount));
    const m = this.pads.instanceMatrix.array as Float32Array;
    const mr = this.padRings.instanceMatrix.array as Float32Array;
    info.pads.forEach(([c, r], i) => {
      const y = this.heightAt(c + 0.5, r + 0.5) - 0.0;
      writeTRS(m, i * 16, c + 0.5, Math.max(0, y) - 0.005, r + 0.5, 0, 1, 1, 1);
      writeTRS(mr, i * 16, c + 0.5, Math.max(0, y) + 0.062, r + 0.5, 0, 1, 1, 1);
    });
    this.pads.count = this.padCount;
    this.padRings.count = this.padCount;
    this.root.add(this.pads, this.padRings);

    // ── villi fronds ──
    if (map.villi.length) {
      const parts: BufferGeometry[] = [];
      const vr = new Rand(99);
      for (const [c, r] of map.villi) {
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + vr.sym(0.3);
          const rr = 0.47 + vr.range(0, 0.06);
          const x = c + 0.5 + Math.cos(a) * rr;
          const z = r + 0.5 + Math.sin(a) * rr;
          const hgt = vr.range(0.16, 0.3);
          const g = paint(blob(0.055, 1, 0.15, k + c * 7 + r), 0xffffff, { top: 0xffffff });
          xf(g, x, hgt * 0.5, z, vr.sym(0.25), 0, vr.sym(0.25), 1, hgt / 0.11, 1);
          parts.push(g);
          parts.push(xf(paint(new IcosahedronGeometry(0.045, 0), 0xffffff, { em: 0xffffff, ei: 0.6 }), x, hgt + 0.02, z));
        }
      }
      this.villiMesh = new Mesh(merge(parts), createStaticMaterial(u, { flat: true }));
      this.root.add(this.villiMesh);
    }

    // ── core ──
    const cs = info.coreCells > 1 ? 1.3 : 1;
    this.coreMat = createStaticMaterial(u, { flat: true });
    this.coreHeart = new Mesh(merge([paint(blob(0.3, 2, 0.14, 5), 0xffffff, { em: 0xffffff, ei: 1 })]), this.coreMat);
    this.coreShellMat = new MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, roughness: 0.2, depthWrite: false });
    this.coreShell = new Mesh(new SphereGeometry(0.46, 24, 16), this.coreShellMat);
    this.coreBase = new Mesh(
      merge([paint(new LatheGeometry([new Vector2(0, 0.1), new Vector2(0.3, 0.1), new Vector2(0.5, 0.06), new Vector2(0.62, 0.0), new Vector2(0.66, -0.06)], 24), 0xffffff, { top: 0xffffff })]),
      this.coreMat,
    );
    this.coreHeart.position.y = 0.5;
    this.coreShell.position.y = 0.5;
    this.coreGroup.add(this.coreBase, this.coreHeart, this.coreShell);
    this.coreGroup.position.set(info.coreX, Math.max(-0.02, this.heightAt(info.coreX, info.coreY)), info.coreY);
    this.coreGroup.scale.setScalar(cs);
    this.root.add(this.coreGroup);

    // ── decorative tissue cells ──
    const decoGeo = merge([paint(blob(1, 1, 0.22, 17), 0xffffff, { top: 0xffffff, ao: 0.3 })]);
    this.decoMat = createStaticMaterial(u, { flat: true });
    this.decoMat.vertexColors = false;
    this.decoMat.color = new Color();
    const dr = new Rand(31337);
    const decoPts: number[] = [];
    for (let tries = 0; tries < 600 && decoPts.length < 34 * 4; tries++) {
      const x = dr.range(-MX + 0.5, cols + MX - 0.5);
      const y = dr.range(-MZF + 1, rows + MZN - 0.5);
      const c = Math.floor(x);
      const r = Math.floor(y);
      const inGrid = c >= 0 && r >= 0 && c < cols && r < rows;
      if (inGrid && (info.pathMask[r * cols + c] || info.padAt[r * cols + c] >= 0)) continue;
      if (distToVessel(info, x, y) < 0.75) continue;
      if (Math.hypot(x - info.coreX, y - info.coreY) < 1.1) continue;
      const s = inGrid ? dr.range(0.05, 0.08) : dr.range(0.08, 0.2);
      decoPts.push(x, y, s, dr.next() * 6.28);
    }
    const nDeco = decoPts.length / 4;
    this.deco = new InstancedMesh(decoGeo, this.decoMat, Math.max(1, nDeco));
    const dm = this.deco.instanceMatrix.array as Float32Array;
    for (let i = 0; i < nDeco; i++) {
      const x = decoPts[i * 4];
      const y = decoPts[i * 4 + 1];
      const s = decoPts[i * 4 + 2];
      writeTRS(dm, i * 16, x, this.heightAt(x, y) + s * 0.12, y, decoPts[i * 4 + 3], s, s * 0.38, s);
    }
    this.deco.count = nDeco;
    this.deco.receiveShadow = true;
    this.root.add(this.deco);

    this.disposables.push(rbcGeo, rbcMat, padGeo, ringGeo, decoGeo);
    this.applyPalette(pal);
  }

  private buildRibbon(info: MapInfo): BufferGeometry {
    const W = 0.36;
    const pos: number[] = [];
    const flow: number[] = [];
    const inf: number[] = [];
    for (const s of info.segs) {
      const nx = -s.dy;
      const nz = s.dx;
      const ext = 0.36; // overlap into corners so turns stay filled
      const ax = s.x0 - s.dx * (s === info.segs[0] ? 0 : 0);
      const ay = s.y0;
      const bx = s.x1 + s.dx * ext;
      const by = s.y1 + s.dy * ext;
      const still = s.flow === 0 ? 1 : 0;
      const fx = s.dx * s.flow;
      const fz = s.dy * s.flow;
      const quads = Math.max(1, Math.ceil(s.len + ext));
      for (let qd = 0; qd < quads; qd++) {
        const t0 = qd / quads;
        const t1 = (qd + 1) / quads;
        const x0 = ax + (bx - ax) * t0;
        const z0 = ay + (by - ay) * t0;
        const x1 = ax + (bx - ax) * t1;
        const z1 = ay + (by - ay) * t1;
        const v = [
          [x0 + nx * W, z0 + nz * W, 1],
          [x0 - nx * W, z0 - nz * W, -1],
          [x1 + nx * W, z1 + nz * W, 1],
          [x1 - nx * W, z1 - nz * W, -1],
        ];
        for (const k of [0, 1, 2, 2, 1, 3]) {
          pos.push(v[k][0], LIQUID_Y, v[k][1]);
          flow.push(fx, fz);
          inf.push(still, v[k][2]);
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aFlow', new Float32BufferAttribute(flow, 2));
    g.setAttribute('aInfo', new Float32BufferAttribute(inf, 2));
    return g;
  }

  private buildFlow(info: MapInfo, n: number): BufferGeometry {
    const rnd = new Rand(777);
    const start = new Float32Array(n * 3);
    const dir = new Float32Array(n * 3);
    const data = new Float32Array(n * 4);
    let total = 0;
    for (const s of info.segs) total += s.len;
    for (let i = 0; i < n; i++) {
      let pick = rnd.next() * total;
      let k = 0;
      for (; k < info.segs.length - 1; k++) {
        if (pick < info.segs[k].len) break;
        pick -= info.segs[k].len;
      }
      const s = info.segs[k];
      const lat = rnd.sym(0.26);
      start[i * 3] = s.x0 - s.dy * lat;
      start[i * 3 + 1] = LIQUID_Y + 0.02 + rnd.range(0, 0.05);
      start[i * 3 + 2] = s.y0 + s.dx * lat;
      dir[i * 3] = s.dx;
      dir[i * 3 + 1] = 0;
      dir[i * 3 + 2] = s.dy;
      data[i * 4] = s.len;
      data[i * 4 + 1] = s.flow;
      data[i * 4 + 2] = rnd.next();
      data[i * 4 + 3] = rnd.range(0.05, 0.11);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aStart', new Float32BufferAttribute(start, 3));
    g.setAttribute('aDir', new Float32BufferAttribute(dir, 3));
    g.setAttribute('aData', new Float32BufferAttribute(data, 4));
    return g;
  }

  private buildSpecks(info: MapInfo): BufferGeometry {
    const rnd = new Rand(2024);
    const pos: number[] = [];
    const data: number[] = [];
    for (let i = 0; i < 160; i++) {
      const x = rnd.range(-MX + 0.5, info.cols + MX - 0.5);
      const y = rnd.range(-MZF + 0.5, info.rows + MZN - 0.5);
      if (distToVessel(info, x, y) < 0.5) continue;
      pos.push(x, this.heightAt(x, y) + 0.03, y);
      data.push(rnd.range(0.035, 0.08), rnd.next(), rnd.range(0.8, 2.4), 0);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aData', new Float32BufferAttribute(data, 4));
    return g;
  }

  applyPalette(pal: Palette): void {
    this.pal = pal;
    const col = this.floorGeo.getAttribute('color') as BufferAttribute;
    const em = this.floorGeo.getAttribute('aEmissive') as BufferAttribute;
    const low = new Lin(pal.floorLow);
    const base = new Lin(pal.floorBase);
    const high = new Lin(pal.floorHigh);
    const edge = new Lin(pal.floorEdge);
    const tr = new Lin(pal.trench);
    const wall = new Lin(pal.trenchWall);
    const rim = new Lin(pal.trenchRim);
    const glow = new Lin(pal.trenchGlow);
    const ca = col.array as Float32Array;
    const ea = em.array as Float32Array;
    for (let k = 0; k < this.hf.length; k++) {
      const d = this.hfDist[k];
      const n = this.hfNoise[k];
      const out = this.hfOut[k];
      const t = clamp(n * 0.9 + 0.5, 0, 1);
      let r = t < 0.5 ? low.r + (base.r - low.r) * t * 2 : base.r + (high.r - base.r) * (t - 0.5) * 2;
      let g = t < 0.5 ? low.g + (base.g - low.g) * t * 2 : base.g + (high.g - base.g) * (t - 0.5) * 2;
      let b = t < 0.5 ? low.b + (base.b - low.b) * t * 2 : base.b + (high.b - base.b) * (t - 0.5) * 2;
      const e = smoothstep(0.5, 5, out);
      r += (edge.r - r) * e;
      g += (edge.g - g) * e;
      b += (edge.b - b) * e;
      // vessel: rim highlight → wall → deep floor
      const rimT = (1 - smoothstep(0.47, 0.72, d)) * smoothstep(0.36, 0.5, d);
      r += (rim.r - r) * rimT * 0.75;
      g += (rim.g - g) * rimT * 0.75;
      b += (rim.b - b) * rimT * 0.75;
      const wallT = 1 - smoothstep(0.3, 0.47, d);
      r += (wall.r - r) * wallT;
      g += (wall.g - g) * wallT;
      b += (wall.b - b) * wallT;
      const deepT = 1 - smoothstep(0.18, 0.32, d);
      r += (tr.r - r) * deepT;
      g += (tr.g - g) * deepT;
      b += (tr.b - b) * deepT;
      ca[k * 3] = r;
      ca[k * 3 + 1] = g;
      ca[k * 3 + 2] = b;
      const ge = (1 - smoothstep(0.15, 0.45, d)) * (pal.additive ? 0.35 : 0.12);
      ea[k * 3] = glow.r * ge;
      ea[k * 3 + 1] = glow.g * ge;
      ea[k * 3 + 2] = glow.b * ge;
    }
    col.needsUpdate = true;
    em.needsUpdate = true;
    const rm = this.ribbonMat.uniforms;
    (rm.uBlood.value as Color).setHex(pal.blood);
    (rm.uBloodHi.value as Color).setHex(pal.bloodHi);
    rm.uOpacity.value = pal.additive ? 0.78 : 0.72;
    (this.flowMat.uniforms.uColor.value as Color).setHex(pal.flow);
    this.flowMat.blending = pal.additive ? AdditiveBlending : NormalBlending;
    this.flowMat.uniforms.uOpacity.value = pal.additive ? 0.85 : 0.75;
    (this.speckMat.uniforms.uColor.value as Color).setHex(pal.glowDot);
    this.speckMat.blending = pal.additive ? AdditiveBlending : NormalBlending;
    this.speckMat.uniforms.uOpacity.value = pal.additive ? 0.7 : 0.55;
    this.flowMat.needsUpdate = true;
    this.speckMat.needsUpdate = true;
    {
      const g = this.pads.geometry;
      const c = g.getAttribute('color') as BufferAttribute;
      const pos = g.getAttribute('position') as BufferAttribute;
      const a = new Lin(pal.pad);
      const b = new Lin(pal.padEdge);
      for (let i = 0; i < c.count; i++) {
        const t = smoothstep(0.18, 0.41, Math.hypot(pos.getX(i), pos.getZ(i)));
        c.setXYZ(i, a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
      }
      c.needsUpdate = true;
    }
    this.padMat.emissive.setHex(pal.additive ? 0x2a0c22 : 0x000000);
    this.ringBase.set(pal.padRing);
    this.ringHi.set(pal.padRingHi);
    this.ringVilli.set(pal.villiRing);
    this.decoMat.color.setHex(pal.deco);
    {
      const g = this.rbc.geometry;
      const c = g.getAttribute('color') as BufferAttribute;
      const e = g.getAttribute('aEmissive') as BufferAttribute;
      const pos = g.getAttribute('position') as BufferAttribute;
      const rb = new Lin(pal.rbc);
      for (let i = 0; i < c.count; i++) {
        const rr = Math.hypot(pos.getX(i), pos.getZ(i)) / 0.15;
        const k = 0.6 + 0.4 * Math.min(1, rr * rr);
        c.setXYZ(i, rb.r * k, rb.g * k, rb.b * k);
        e.setXYZ(i, rb.r * 0.25, rb.g * 0.25, rb.b * 0.25);
      }
      c.needsUpdate = true;
      e.needsUpdate = true;
    }
    if (this.villiMesh) {
      const g = this.villiMesh.geometry;
      const c = g.getAttribute('color') as BufferAttribute;
      const v = new Lin(pal.villi);
      for (let i = 0; i < c.count; i++) c.setXYZ(i, v.r, v.g, v.b);
      c.needsUpdate = true;
    }
    this.recolorCore();
    this.refreshRings(0);
  }

  private recolorCore(): void {
    const g = this.coreHeart.geometry;
    const c = g.getAttribute('color') as BufferAttribute;
    const e = g.getAttribute('aEmissive') as BufferAttribute;
    const core = new Lin(this.pal.core);
    for (let i = 0; i < c.count; i++) {
      c.setXYZ(i, core.r, core.g, core.b);
      e.setXYZ(i, core.r * 0.9, core.g * 0.9, core.b * 0.9);
    }
    c.needsUpdate = true;
    e.needsUpdate = true;
    const bg = this.coreBase.geometry;
    const bc = bg.getAttribute('color') as BufferAttribute;
    const pad = new Lin(this.pal.pad);
    for (let i = 0; i < bc.count; i++) bc.setXYZ(i, pad.r * 0.95, pad.g * 0.8, pad.b * 0.85);
    bc.needsUpdate = true;
    this.coreShellMat.color.setHex(this.pal.coreGlow);
    this.coreShellMat.emissive.setHex(this.pal.core);
    this.coreShellMat.emissiveIntensity = 0.35;
  }

  /** Marks pads (by cell) as buildable highlights; null clears. */
  setHighlights(cells: readonly (readonly [number, number])[] | null): void {
    this.highlighted.fill(0);
    if (!cells) return;
    const pads = this.info.pads;
    for (const [c, r] of cells) {
      for (let i = 0; i < pads.length; i++) if (pads[i][0] === c && pads[i][1] === r) this.highlighted[i] = 1;
    }
  }

  private refreshRings(time: number): void {
    const arr = this.padRings.instanceColor!.array as Float32Array;
    const pads = this.info.pads;
    const cols = this.info.cols;
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    for (let i = 0; i < this.padCount; i++) {
      const [c, r] = pads[i];
      const isV = this.info.villi[r * cols + c] === 1;
      const base = isV ? this.ringVilli : this.ringBase;
      let k = this.pal.additive ? 0.55 : 0.8;
      let rr = base.r * k;
      let gg = base.g * k;
      let bb = base.b * k;
      if (this.highlighted[i]) {
        k = 0.9 + pulse * 0.9;
        rr = this.ringHi.r * k;
        gg = this.ringHi.g * k;
        bb = this.ringHi.b * k;
      }
      arr[i * 3] = rr;
      arr[i * 3 + 1] = gg;
      arr[i * 3 + 2] = bb;
    }
    this.padRings.instanceColor!.needsUpdate = true;
  }

  /** Height of the visible surface at logic (x, y). */
  heightAt(x: number, y: number): number {
    const l = this.loc;
    locate(this.gx, x, l);
    const i = l.i;
    const tx = l.t;
    locate(this.gz, y, l);
    const j = l.i;
    const tz = l.t;
    const k = j * this.hfW + i;
    const a = this.hf[k];
    const b = this.hf[k + 1];
    const c = this.hf[k + this.hfW];
    const d = this.hf[k + this.hfW + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  setFlowCount(n: number): void {
    this.flowCount = Math.min(1200, n);
    this.flow.geometry.setDrawRange(0, this.flowCount);
  }

  setPointScale(s: number): void {
    this.flowMat.uniforms.uScale.value = s;
    this.speckMat.uniforms.uScale.value = s;
  }

  /** Per-frame animation (allocation-free). */
  update(time: number, dt: number, reversed: boolean, warn: boolean, fever: boolean, anyHighlight: boolean): void {
    const dir = reversed ? -1 : 1;
    const speed = fever ? 0.45 : 1;
    this.flowMat.uniforms.uDir.value = dir;
    this.flowMat.uniforms.uSpeed.value = 1.25 * speed;
    this.ribbonMat.uniforms.uDir.value = dir;
    this.ribbonMat.uniforms.uSpeed.value = 0.75 * speed;
    this.ribbonMat.uniforms.uWarn.value = warn ? 1 : 0;
    // RBCs
    const m = this.rbc.instanceMatrix.array as Float32Array;
    const segs = this.info.segs;
    for (let i = 0; i < this.rbcState.length; i++) {
      const st = this.rbcState[i];
      const s = segs[st.seg];
      const f = s.flow * dir;
      const v = (f === 0 ? 0 : 0.95 * speed * f) / s.len;
      st.phase += v * dt;
      if (f === 0) st.phase += Math.sin(time * 0.7 + i) * 0.0008;
      st.phase -= Math.floor(st.phase);
      const d = st.phase * s.len;
      const fadeK = Math.min(1, d / 0.5, (s.len - d) / 0.5);
      const x = s.x0 + s.dx * d - s.dy * st.lat;
      const z = s.y0 + s.dy * d + s.dx * st.lat;
      const sc = st.size * Math.max(0, fadeK);
      writeTRS(m, i * 16, x, LIQUID_Y + 0.035 + Math.sin(time * 2 + i) * 0.01, z, time * st.spin, sc, sc * (0.8 + 0.2 * Math.sin(time * st.spin + i)), sc);
    }
    this.rbc.instanceMatrix.needsUpdate = true;
    // core heartbeat (lub-dub)
    const beat = time % 1.1;
    const pulse = Math.exp(-beat * 9) * 0.12 + Math.exp(-Math.max(0, beat - 0.22) * 10) * (beat > 0.22 ? 0.08 : 0);
    const flash = this.coreFlash;
    this.coreHeart.scale.setScalar(1 + pulse + flash * 0.25);
    this.coreHeart.rotation.y = time * 0.4;
    this.coreShell.scale.setScalar(1 + pulse * 0.5 + flash * 0.1);
    this.coreShellMat.emissiveIntensity = 0.35 + pulse * 2 + flash * 1.5;
    const shake = this.coreShake;
    this.coreHeart.position.x = shake > 0 ? Math.sin(time * 60) * shake * 0.06 : 0;
    this.coreFlash = Math.max(0, flash - dt * 2.5);
    this.coreShake = Math.max(0, shake - dt * 2.5);
    if (anyHighlight || time - this.lastRingT > 0.5) {
      this.refreshRings(time);
      this.lastRingT = time;
    }
  }
  private lastRingT = -1;

  get coreWorldY(): number {
    return this.coreGroup.position.y + 0.5 * this.coreGroup.scale.y;
  }

  get materials(): Material[] {
    return [this.floorMat, this.ribbonMat, this.flowMat, this.speckMat, this.padMat, this.padRingMat, this.coreMat, this.coreShellMat, this.decoMat];
  }

  dispose(): void {
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.root.clear();
  }
}
