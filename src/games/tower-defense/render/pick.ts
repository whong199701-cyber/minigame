/**
 * Pure picking maths for `ImmuneRenderer.pick` (§11.8): ray vs sphere / vertical capsule, and the tower stage of the
 * hero > tower > pad > path > terrain resolution, including the tie-break against an empty path cell behind a tower.
 * No three.js objects are created here, so it is unit-tested with the real camera rig (`pick.test.ts`).
 */
import { WORLD, type TowerId, type TowerView } from '../types';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const TD = WORLD.trenchDepth;

/**
 * Radius (cells) of each tower model's main body as the player sees it — thin lances, spikes and emblems excluded,
 * wide low bodies (amoeba macrophage, platelet plug) at the full pick radius. A ray within this distance of the axis,
 * from the base up to the model's silhouette top, is "on the tower" and always picks it.
 */
export const BODY_PICK_RADIUS: Record<TowerId, number> = {
  antibody: 0.32,
  macrophage: WORLD.pickTowerRadius,
  mast: 0.36,
  pyrogen: 0.42,
  tcell: 0.3,
  complement: 0.33,
  beacon: 0.3,
  barrier: WORLD.pickTowerRadius,
};

/** Ray (origin o, unit direction d) vs sphere; returns the entry parameter or -1. */
export function raySphere(o: Vec3, d: Vec3, cx: number, cy: number, cz: number, r: number): number {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

/** Ray vs vertical capsule (axis x = cx, z = cz, y in [y0, y1], radius r); returns the ray parameter of the closest approach or -1. */
export function rayCapsule(o: Vec3, d: Vec3, cx: number, y0: number, y1: number, cz: number, r: number): number {
  // closest points between the ray and the axis segment
  const wx = o.x - cx;
  const wy = o.y - y0;
  const wz = o.z - cz;
  const b = d.y; // d·u with u = (0,1,0)
  const dd = d.x * wx + d.y * wy + d.z * wz;
  const e = wy;
  const denom = 1 - b * b;
  let tc: number;
  let sc: number;
  const len = y1 - y0;
  if (denom < 1e-6) {
    sc = 0;
    tc = e;
  } else {
    sc = (b * e - dd) / denom;
    tc = (e - b * dd) / denom;
  }
  if (tc < 0) tc = 0;
  else if (tc > len) tc = len;
  sc = Math.max(0, tc * b - dd);
  const px = o.x + d.x * sc - cx;
  const py = o.y + d.y * sc - (y0 + tc);
  const pz = o.z + d.z * sc - cz;
  return px * px + py * py + pz * pz <= r * r ? sc : -1;
}

/** World height of a tower's base (barriers stand in the trench). */
export function towerBase(tv: Pick<TowerView, 'typeId'>): number {
  return tv.typeId === 'barrier' ? -TD : WORLD.padHeight;
}

/** Map lookups the tower stage needs (both the renderer's and the logic's MapInfo shapes fit). */
export interface PickGrid {
  cols: number;
  rows: number;
  /** Non-zero where a path covers the cell (index row × cols + col). */
  pathMask: ArrayLike<number>;
}

export interface TowerPick {
  /** Index into the towers array of the picked tower, -1 when no tower proxy is hit. */
  index: number;
  /** Cell index (row × cols + col) of the empty path cell that wins over that tower, else -1. */
  path: number;
}

/**
 * Tower stage of `pick` (§11.8). Every tower has two proxies: the pick capsule (radius `WORLD.pickTowerRadius`, height
 * `WORLD.towerHeight[level]`), which keeps small towers easy to tap, and its *body* — a slimmer capsule
 * (`BODY_PICK_RADIUS`) from the base to the model's silhouette top (`silhouetteTop`, world height), i.e. what the player
 * sees. A body hit always picks that tower (nearest body first). A ray that only grazes a pick capsule picks the
 * tower too — unless it reaches an *empty path cell* other than the tower's own at trench depth (`trench`, the ray's
 * point at h = −trenchDepth/2): under the 58° camera a tower's capsule overhangs the path cell behind it, and the
 * visible strips of that cell beside / above the model belong to the cell (barrier strip). Taps on the model itself
 * — including its upper half, which hides that cell's centre — stay with the tower.
 */
export function pickTowerStage(
  o: Vec3,
  d: Vec3,
  trench: { x: number; z: number } | null,
  grid: PickGrid,
  towers: readonly TowerView[],
  count: number,
  silhouetteTop: (tv: TowerView) => number,
  out: TowerPick,
): TowerPick {
  let bodyT = Infinity;
  let bodyI = -1;
  let capT = Infinity;
  let capI = -1;
  for (let i = 0; i < count; i++) {
    const tv = towers[i];
    const base = towerBase(tv);
    const r = BODY_PICK_RADIUS[tv.typeId];
    const tb = rayCapsule(o, d, tv.x, base, Math.max(base, silhouetteTop(tv) - r), tv.y, r);
    if (tb >= 0 && tb < bodyT) {
      bodyT = tb;
      bodyI = i;
    }
    const tc = rayCapsule(o, d, tv.x, base, base + WORLD.towerHeight[tv.level - 1], tv.y, WORLD.pickTowerRadius);
    if (tc >= 0 && tc < capT) {
      capT = tc;
      capI = i;
    }
  }
  out.path = -1;
  if (bodyI >= 0) {
    out.index = bodyI;
    return out;
  }
  out.index = capI;
  if (capI < 0 || !trench) return out;
  const tv = towers[capI];
  const c = Math.floor(trench.x);
  const r = Math.floor(trench.z);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return out;
  if (c === Math.floor(tv.x) && r === Math.floor(tv.y)) return out;
  if (!grid.pathMask[r * grid.cols + c]) return out;
  for (let i = 0; i < count; i++) {
    const u = towers[i];
    if (Math.floor(u.x) === c && Math.floor(u.y) === r) return out;
  }
  out.path = r * grid.cols + c;
  return out;
}
