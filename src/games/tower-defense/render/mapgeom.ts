/**
 * Renderer-side map analysis: path polylines (entry point + waypoint centres, like the logic's pathGeometry),
 * deduplicated straight vessel segments (shared tails drawn once), per-cell lookup masks and the distance-to-vessel
 * field the terrain carves trenches with. Pure maths, built once per `setMap`.
 */
import type { Cell, FlowDir, MapDef } from '../types';

/** Extra off-grid vessel length drawn before every spawn entry so vessels emerge from the surrounding tissue. */
export const ENTRY_EXTENSION = 6;

export interface VesselSeg {
  /** Endpoints (logic x, y). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Unit travel direction and length. */
  dx: number;
  dy: number;
  len: number;
  flow: FlowDir;
  pathIndex: number;
}

export interface PathPoly {
  /** x, y pairs: off-grid entry, then waypoint centres. */
  pts: number[];
  flow: FlowDir[];
}

export interface MapInfo {
  map: MapDef;
  cols: number;
  rows: number;
  paths: PathPoly[];
  /** Unique straight segments (visual: the first one of each path starts ENTRY_EXTENSION cells further out). */
  segs: VesselSeg[];
  /** Bit i set when path i covers the cell (cols × rows). */
  pathMask: Uint8Array;
  /** Pad index or -1 (cols × rows). */
  padAt: Int16Array;
  villi: Uint8Array;
  /** Travel direction of the first path covering the cell (for barrier orientation), 2 floats per cell. */
  cellDir: Float32Array;
  coreX: number;
  coreY: number;
  coreCells: number;
  pads: readonly Cell[];
  /** Spawn entry points (logic x, y) per path. */
  entries: number[];
}

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function buildMapInfo(map: MapDef): MapInfo {
  const { cols, rows } = map;
  const pathMask = new Uint8Array(cols * rows);
  const padAt = new Int16Array(cols * rows).fill(-1);
  const villi = new Uint8Array(cols * rows);
  const cellDir = new Float32Array(cols * rows * 2);
  const inGrid = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < cols && r < rows;
  map.pads.forEach(([c, r], i) => {
    if (inGrid(c, r)) padAt[r * cols + c] = i;
  });
  for (const [c, r] of map.villi) {
    if (inGrid(c, r)) villi[r * cols + c] = 1;
    if (inGrid(c, r) && padAt[r * cols + c] < 0) padAt[r * cols + c] = 1000 + r * cols + c;
  }
  const paths: PathPoly[] = [];
  const segs: VesselSeg[] = [];
  const seen = new Set<string>();
  const entries: number[] = [];
  map.paths.forEach((p, pi) => {
    const wp = p.waypoints;
    if (wp.length < 2) return;
    const dx0 = sign(wp[1][0] - wp[0][0]);
    const dy0 = sign(wp[1][1] - wp[0][1]);
    const ex = wp[0][0] - dx0 + 0.5;
    const ey = wp[0][1] - dy0 + 0.5;
    entries.push(ex, ey);
    const pts = [ex, ey];
    for (const [c, r] of wp) pts.push(c + 0.5, r + 0.5);
    const flow: FlowDir[] = [p.flow[0] ?? 1, ...p.flow];
    paths.push({ pts, flow });
    // cells
    for (let k = 0; k < wp.length - 1; k++) {
      const [c0, r0] = wp[k];
      const [c1, r1] = wp[k + 1];
      const sx = sign(c1 - c0);
      const sy = sign(r1 - r0);
      let c = c0;
      let r = r0;
      for (;;) {
        if (inGrid(c, r)) {
          const i = r * cols + c;
          if (!pathMask[i]) {
            cellDir[i * 2] = sx;
            cellDir[i * 2 + 1] = sy;
          }
          pathMask[i] |= 1 << pi;
        }
        if (c === c1 && r === r1) break;
        c += sx;
        r += sy;
      }
    }
    // spawn cell direction
    {
      const [c, r] = wp[0];
      if (inGrid(c, r)) {
        const i = r * cols + c;
        if (cellDir[i * 2] === 0 && cellDir[i * 2 + 1] === 0) {
          cellDir[i * 2] = dx0;
          cellDir[i * 2 + 1] = dy0;
        }
      }
    }
    // segments (entry → spawn merged with the first leg, extended off-grid)
    for (let k = 0; k < pts.length / 2 - 1; k++) {
      let x0 = pts[k * 2];
      let y0 = pts[k * 2 + 1];
      const x1 = pts[k * 2 + 2];
      const y1 = pts[k * 2 + 3];
      const len0 = Math.hypot(x1 - x0, y1 - y0);
      if (len0 < 1e-6) continue;
      const dx = (x1 - x0) / len0;
      const dy = (y1 - y0) / len0;
      if (k === 0) {
        x0 -= dx * ENTRY_EXTENSION;
        y0 -= dy * ENTRY_EXTENSION;
      }
      const key = [x0, y0, x1, y1].map((v) => v.toFixed(2)).join(',');
      const rkey = [x1, y1, x0, y0].map((v) => v.toFixed(2)).join(',');
      if (seen.has(key) || seen.has(rkey)) continue;
      seen.add(key);
      segs.push({ x0, y0, x1, y1, dx, dy, len: Math.hypot(x1 - x0, y1 - y0), flow: flow[k], pathIndex: pi });
    }
  });
  let cx = 0;
  let cy = 0;
  for (const [c, r] of map.core) {
    cx += c + 0.5;
    cy += r + 0.5;
  }
  const n = Math.max(1, map.core.length);
  return {
    map,
    cols,
    rows,
    paths,
    segs,
    pathMask,
    padAt,
    villi,
    cellDir,
    coreX: cx / n,
    coreY: cy / n,
    coreCells: map.core.length,
    pads: [...map.pads, ...map.villi.filter(([c, r]) => !map.pads.some(([pc, pr]) => pc === c && pr === r))],
    entries,
  };
}

/** Distance from (x, y) to the nearest vessel segment (logic units). */
export function distToVessel(info: MapInfo, x: number, y: number): number {
  let best = Infinity;
  const segs = info.segs;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const px = x - s.x0;
    const py = y - s.y0;
    let t = px * s.dx + py * s.dy;
    if (t < 0) t = 0;
    else if (t > s.len) t = s.len;
    const qx = px - s.dx * t;
    const qy = py - s.dy * t;
    const d = qx * qx + qy * qy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function isPathCell(info: MapInfo, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < info.cols && r < info.rows && info.pathMask[r * info.cols + c] !== 0;
}

export function isPadCell(info: MapInfo, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < info.cols && r < info.rows && info.padAt[r * info.cols + c] >= 0;
}
