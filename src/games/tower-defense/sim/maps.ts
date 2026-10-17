/**
 * Maps and path geometry (§1). Pure functions; per-map lookup grids are cached by map object identity.
 */
import type { Cell, FlowDir, MapDef, MapId, PathGeom, Point } from '../types';
import { MAPS, VILLI_BONUS, VILLI_BONUS_LONG, VILLI_LONG_RANGE } from './data';

export function findMap(id: MapId): MapDef {
  for (const m of MAPS) if (m.id === id) return m;
  return MAPS[0];
}

export function isMapId(v: unknown): v is MapId {
  return v === 'vessel' || v === 'alveoli' || v === 'gut' || v === 'brain';
}

/** Cells of one waypoint path in travel order (assumes axis-aligned segments). */
export function buildPathCells(waypoints: readonly Cell[]): Cell[] {
  const cells: Cell[] = [];
  if (!waypoints.length) return cells;
  cells.push([waypoints[0][0], waypoints[0][1]]);
  for (let i = 1; i < waypoints.length; i++) {
    const [ac, ar] = waypoints[i - 1];
    const [bc, br] = waypoints[i];
    const dc = Math.sign(bc - ac);
    const dr = Math.sign(br - ar);
    let c = ac;
    let r = ar;
    let guard = 0;
    while ((c !== bc || r !== br) && guard++ < 1000) {
      c += dc;
      r += dr;
      cells.push([c, r]);
    }
  }
  return cells;
}

/** Index of the waypoint segment each path cell belongs to (corner cells belong to the segment entering them). */
function cellSegments(waypoints: readonly Cell[]): number[] {
  const segs: number[] = [0];
  for (let i = 1; i < waypoints.length; i++) {
    const [ac, ar] = waypoints[i - 1];
    const [bc, br] = waypoints[i];
    const n = Math.abs(bc - ac) + Math.abs(br - ar);
    for (let k = 0; k < n; k++) segs.push(i - 1);
  }
  return segs;
}

/**
 * Polyline through the path's cell centres, prefixed by the off-grid entry point (one cell before the spawn).
 * `segFlow[i]` is the flow of the polyline segment points[i] → points[i+1] (the waypoint segment that owns the cell
 * at points[i+1]).
 */
export function pathGeometry(map: MapDef, pathIndex: number): PathGeom {
  const def = map.paths[pathIndex];
  const cells = buildPathCells(def.waypoints);
  const owners = cellSegments(def.waypoints);
  const points: Point[] = cells.map(([c, r]) => ({ x: c + 0.5, y: r + 0.5 }));
  const first = points[0];
  const second = points[1] ?? { x: first.x + 1, y: first.y };
  const dx = Math.sign(second.x - first.x);
  const dy = Math.sign(second.y - first.y);
  points.unshift({ x: first.x - dx, y: first.y - dy });
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const segFlow: FlowDir[] = [];
  for (let i = 0; i < points.length; i++) {
    const owner = owners[Math.min(i, owners.length - 1)] ?? 0;
    segFlow.push((def.flow[owner] ?? 0) as FlowDir);
  }
  return { pathIndex, cells, points, cum, length: cum[cum.length - 1], segFlow };
}

/** Scratch result of `posOnPath` (reused; never retain it). */
export interface PathPos {
  x: number;
  y: number;
  seg: number;
}

/**
 * Allocation-free point lookup: writes the position at `dist` into `out` and returns the segment index.
 * `segHint` speeds up the walk for entities that move a little each step.
 */
export function posOnPath(geom: PathGeom, dist: number, segHint: number, out: PathPos): number {
  const points = geom.points;
  const cum = geom.cum;
  const last = points.length - 1;
  if (dist <= 0) {
    // Behind the entry point (trailing parasite segments): extrapolate along the entry direction.
    const a = points[0];
    const b = points[1];
    const len = cum[1] || 1;
    out.x = a.x + ((b.x - a.x) / len) * dist;
    out.y = a.y + ((b.y - a.y) / len) * dist;
    out.seg = 0;
    return 0;
  }
  if (dist >= geom.length) {
    out.x = points[last].x;
    out.y = points[last].y;
    out.seg = last - 1;
    return last - 1;
  }
  let seg = segHint < 0 ? 0 : segHint > last - 1 ? last - 1 : segHint;
  while (seg > 0 && cum[seg] > dist) seg--;
  while (seg < last - 1 && cum[seg + 1] < dist) seg++;
  const a = points[seg];
  const b = points[seg + 1];
  const segLen = cum[seg + 1] - cum[seg];
  const t = segLen > 0 ? (dist - cum[seg]) / segLen : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.seg = seg;
  return seg;
}

/** Position, segment and (static, un-reversed) flow at `dist` along the path. */
export function pointOnPath(geom: PathGeom, dist: number, segHint = 0): { x: number; y: number; seg: number; flow: FlowDir } {
  const out: PathPos = { x: 0, y: 0, seg: 0 };
  posOnPath(geom, dist, segHint, out);
  return { x: out.x, y: out.y, seg: out.seg, flow: geom.segFlow[out.seg] ?? 0 };
}

/** Heading (radians, atan2(dy, dx)) of the path segment `seg`. */
export function segAngle(geom: PathGeom, seg: number): number {
  const p = geom.points;
  const i = seg < 0 ? 0 : seg >= p.length - 1 ? p.length - 2 : seg;
  return Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x);
}

// ── Per-map lookup grids (cached) ───────────────────────────────────────────

export interface MapInfo {
  map: MapDef;
  geoms: PathGeom[];
  /** 1 = pad, 2 = villi pad, 0 = other (index r * cols + c). */
  padKind: Uint8Array;
  /** Bit mask of the paths a cell belongs to (bit i = path i). */
  pathMask: Uint8Array;
  /** Bit mask of the paths on which a barrier is banned at this cell (first/last `barrierBan` cells, core). */
  banMask: Uint8Array;
  /** For each path, the distance of each cell centre along the path (-1 = not on it). */
  cellDist: Float64Array[];
  coreX: number;
  coreY: number;
  /** The hero's post (§6): where Blanc starts every run and respawns — beside the core, not inside its mesh. */
  heroX: number;
  heroY: number;
}

/**
 * The hero's post (§6): the centre of the plain terrain cell (no path, pad, villi or core) touching the core (8-way)
 * that is nearest the camera — largest row, then closest to the core's centre column, then the right-hand one. At the
 * core centre he was drawn inside the core (hidden on Brain's two-cell core). Falls back to the core centre.
 */
export function heroPost(map: MapDef, padKind: Uint8Array, pathMask: Uint8Array, coreX: number, coreY: number): Point {
  let best: Point | null = null;
  let bestKey = -Infinity;
  const isCore = (c: number, r: number) => map.core.some(([x, y]) => x === c && y === r);
  for (const [kc, kr] of map.core) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = kc + dc;
        const r = kr + dr;
        if (c < 0 || r < 0 || c >= map.cols || r >= map.rows || isCore(c, r)) continue;
        const i = r * map.cols + c;
        if (padKind[i] !== 0 || pathMask[i] !== 0) continue;
        const x = c + 0.5;
        // rows dominate, then horizontal closeness to the core centre, then right over left
        const key = r * 1000 - Math.abs(x - coreX) * 10 + (x > coreX ? 1 : 0);
        if (key > bestKey) {
          bestKey = key;
          best = { x, y: r + 0.5 };
        }
      }
    }
  }
  return best ?? { x: coreX, y: coreY };
}

const infoCache = new WeakMap<MapDef, MapInfo>();

export function mapInfo(map: MapDef): MapInfo {
  const cached = infoCache.get(map);
  if (cached) return cached;
  const n = map.cols * map.rows;
  const padKind = new Uint8Array(n);
  const pathMask = new Uint8Array(n);
  const banMask = new Uint8Array(n);
  const geoms: PathGeom[] = [];
  const cellDist: Float64Array[] = [];
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < map.cols && r < map.rows;
  for (const [c, r] of map.pads) if (inside(c, r)) padKind[r * map.cols + c] = 1;
  for (const [c, r] of map.villi) if (inside(c, r)) padKind[r * map.cols + c] = 2;
  for (let p = 0; p < map.paths.length; p++) {
    const g = pathGeometry(map, p);
    geoms.push(g);
    const d = new Float64Array(n).fill(-1);
    const cells = g.cells;
    for (let k = 0; k < cells.length; k++) {
      const [c, r] = cells[k];
      if (!inside(c, r)) continue;
      const idx = r * map.cols + c;
      pathMask[idx] |= 1 << p;
      d[idx] = g.cum[k + 1];
      if (k < map.barrierBan || k >= cells.length - map.barrierBan) banMask[idx] |= 1 << p;
    }
    cellDist.push(d);
  }
  for (const [c, r] of map.core) if (inside(c, r)) banMask[r * map.cols + c] |= 0xff;
  let cx = 0;
  let cy = 0;
  for (const [c, r] of map.core) {
    cx += c + 0.5;
    cy += r + 0.5;
  }
  const k = Math.max(1, map.core.length);
  const post = heroPost(map, padKind, pathMask, cx / k, cy / k);
  const info: MapInfo = { map, geoms, padKind, pathMask, banMask, cellDist, coreX: cx / k, coreY: cy / k, heroX: post.x, heroY: post.y };
  infoCache.set(map, info);
  return info;
}

/** Range bonus a villi pad gives a tower whose base range is `baseRange` (§1.3). */
export function villiBonus(baseRange: number): number {
  return baseRange >= VILLI_LONG_RANGE ? VILLI_BONUS_LONG : VILLI_BONUS;
}

// ── Validation (§1.5) ───────────────────────────────────────────────────────

/** Returns null when the map is valid, otherwise a short (developer-facing) error description. */
export function validateMap(map: MapDef): string | null {
  const { cols, rows } = map;
  if (!(cols >= 3 && rows >= 3)) return 'grid too small';
  if (!map.paths.length) return 'no paths';
  if (!map.core.length) return 'no core';
  const inside = (c: number, r: number) => c >= 0 && c < cols && r >= 0 && r < rows;
  const pathCells = new Set<number>();
  const coreKeys = new Set(map.core.map(([c, r]) => r * cols + c));
  for (const [c, r] of map.core) if (!inside(c, r)) return `core (${c},${r}) out of bounds`;
  const lastWaypoints = new Set<number>();
  for (let p = 0; p < map.paths.length; p++) {
    const path = map.paths[p];
    const wp = path.waypoints;
    if (wp.length < 2) return `path ${path.id}: need at least two waypoints`;
    if (path.flow.length !== wp.length - 1) return `path ${path.id}: flow length ${path.flow.length} ≠ ${wp.length - 1}`;
    for (const f of path.flow) if (f !== 1 && f !== 0 && f !== -1) return `path ${path.id}: bad flow value`;
    for (const [c, r] of wp) {
      if (!Number.isInteger(c) || !Number.isInteger(r) || !inside(c, r)) return `path ${path.id}: waypoint (${c},${r}) out of bounds`;
    }
    const [c0, r0] = wp[0];
    if (c0 !== 0 && r0 !== 0 && c0 !== cols - 1 && r0 !== rows - 1) return `path ${path.id}: spawn not on an edge`;
    const seen = new Set<number>();
    for (let i = 1; i < wp.length; i++) {
      const [ac, ar] = wp[i - 1];
      const [bc, br] = wp[i];
      if (ac === bc && ar === br) return `path ${path.id}: duplicate waypoint at index ${i}`;
      if (ac !== bc && ar !== br) return `path ${path.id}: segment ${i} is not axis-aligned`;
      const dc = Math.sign(bc - ac);
      const dr = Math.sign(br - ar);
      if (i === 1) {
        if (inside(ac - dc, ar - dr)) return `path ${path.id}: entry cell inside the grid`;
        seen.add(ar * cols + ac);
      }
      let c = ac;
      let r = ar;
      while (c !== bc || r !== br) {
        c += dc;
        r += dr;
        const key = r * cols + c;
        if (seen.has(key)) return `path ${path.id}: crosses itself at (${c},${r})`;
        seen.add(key);
      }
    }
    for (const key of seen) pathCells.add(key);
    const [lc, lr] = wp[wp.length - 1];
    const lastKey = lr * cols + lc;
    if (!coreKeys.has(lastKey)) return `path ${path.id}: does not end on a core cell`;
    lastWaypoints.add(lastKey);
    // A core cell may only appear as the last cell of the path.
    for (const key of seen) if (coreKeys.has(key) && key !== lastKey) return `path ${path.id}: passes through the core`;
    if (seen.size <= 2 * map.barrierBan) return `path ${path.id}: barrier ban covers the whole path`;
  }
  for (const key of coreKeys) if (!lastWaypoints.has(key)) return 'core cell is not the end of any path';
  const padSeen = new Set<number>();
  for (const [label, list] of [
    ['pad', map.pads],
    ['villi', map.villi],
  ] as const) {
    for (const [c, r] of list) {
      if (!Number.isInteger(c) || !Number.isInteger(r) || !inside(c, r)) return `${label} (${c},${r}) out of bounds`;
      const key = r * cols + c;
      if (pathCells.has(key)) return `${label} (${c},${r}) on a path cell`;
      if (coreKeys.has(key)) return `${label} (${c},${r}) on the core`;
      if (padSeen.has(key)) return `${label} (${c},${r}) duplicated`;
      padSeen.add(key);
    }
  }
  if (!(map.hpMult > 0)) return 'bad hpMult';
  if (!(map.maxBarriers >= 0)) return 'bad maxBarriers';
  return null;
}

const riskCache = new WeakMap<MapDef, Cell[]>();

/**
 * Pads (villi included) a passing virus can infect (§5.3): the pad's cell is within Chebyshev distance 1 of a cell a
 * virus walks through — any path cell or the off-grid entry cell. In map order (pads, then villi), cached per map.
 * The UI marks them with a biohazard glyph while a virus wave is previewed.
 */
export function virusRiskPads(map: MapDef): Cell[] {
  const cached = riskCache.get(map);
  if (cached) return cached;
  const mi = mapInfo(map);
  const walked: number[] = [];
  for (const g of mi.geoms) {
    walked.push(Math.floor(g.points[0].x), Math.floor(g.points[0].y));
    for (const [c, r] of g.cells) walked.push(c, r);
  }
  const out: Cell[] = [];
  const seen = new Set<number>();
  for (const [c, r] of [...map.pads, ...map.villi]) {
    const k = r * map.cols + c;
    if (seen.has(k)) continue;
    seen.add(k);
    for (let i = 0; i < walked.length; i += 2) {
      if (Math.abs(walked[i] - c) <= 1 && Math.abs(walked[i + 1] - r) <= 1) {
        out.push([c, r]);
        break;
      }
    }
  }
  riskCache.set(map, out);
  return out;
}
