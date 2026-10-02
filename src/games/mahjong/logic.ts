/**
 * Pure logic for Mahjong Solitaire: tile set, layouts, free-tile rule, solvable board generation
 * (reverse fill), forward replay solver, hint selection and canvas geometry / hit testing.
 * No DOM access so everything can be unit tested.
 */

export type Suit = 'dot' | 'bam' | 'char' | 'wind' | 'dragon' | 'flower' | 'season';

/** A position in half-tile units. A tile occupies [x, x+2) × [y, y+2) on layer z. */
export interface Pos {
  x: number;
  y: number;
  z: number;
}

export interface Tile extends Pos {
  id: number;
  kind: number;
}

export type LayoutId = 'small' | 'medium' | 'large';

// ── Tile kinds ────────────────────────────────────────────────────────────
// 0-8 dots 1-9 · 9-17 bamboo 1-9 · 18-26 characters 1-9 · 27-30 winds E S W N ·
// 31-33 dragons red/green/white · 34-37 flowers 梅蘭菊竹 · 38-41 seasons 春夏秋冬
export const KIND_COUNT = 42;
export const FLOWER_BASE = 34;
export const SEASON_BASE = 38;
export const FULL_TILE_COUNT = 144;

export function suitOf(kind: number): Suit {
  if (kind < 9) return 'dot';
  if (kind < 18) return 'bam';
  if (kind < 27) return 'char';
  if (kind < 31) return 'wind';
  if (kind < 34) return 'dragon';
  if (kind < 38) return 'flower';
  return 'season';
}

/** 1-9 for suits; 0-based index inside winds / dragons / flowers / seasons. */
export function rankOf(kind: number): number {
  if (kind < 27) return (kind % 9) + 1;
  if (kind < 31) return kind - 27;
  if (kind < 34) return kind - 31;
  if (kind < 38) return kind - FLOWER_BASE;
  return kind - SEASON_BASE;
}

/** Tiles match when their match groups are equal: any flower ↔ any flower, any season ↔ any season. */
export function matchGroup(kind: number): number {
  if (kind >= SEASON_BASE) return SEASON_BASE;
  if (kind >= FLOWER_BASE) return FLOWER_BASE;
  return kind;
}

export function matches(a: number, b: number): boolean {
  return matchGroup(a) === matchGroup(b);
}

function shuffleInPlace<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The full 144-tile set expressed as 72 matching pairs, shuffled. */
export function fullBag(rand: () => number = Math.random): [number, number][] {
  const pairs: [number, number][] = [];
  for (let k = 0; k < FLOWER_BASE; k++) pairs.push([k, k], [k, k]);
  const flowers = shuffleInPlace([34, 35, 36, 37], rand);
  const seasons = shuffleInPlace([38, 39, 40, 41], rand);
  pairs.push([flowers[0], flowers[1]], [flowers[2], flowers[3]]);
  pairs.push([seasons[0], seasons[1]], [seasons[2], seasons[3]]);
  return shuffleInPlace(pairs, rand);
}

/**
 * Group an arbitrary multiset of kinds into matching pairs (used when reshuffling the remaining tiles).
 * Returns null when the multiset cannot be fully paired.
 */
export function pairsFromKinds(kinds: number[], rand: () => number = Math.random): [number, number][] | null {
  const pairs: [number, number][] = [];
  const counts = new Map<number, number>();
  const flowers: number[] = [];
  const seasons: number[] = [];
  for (const k of kinds) {
    if (k >= SEASON_BASE) seasons.push(k);
    else if (k >= FLOWER_BASE) flowers.push(k);
    else counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [k, c] of counts) {
    if (c % 2 !== 0) return null;
    for (let i = 0; i < c / 2; i++) pairs.push([k, k]);
  }
  if (flowers.length % 2 !== 0 || seasons.length % 2 !== 0) return null;
  shuffleInPlace(flowers, rand);
  shuffleInPlace(seasons, rand);
  for (let i = 0; i < flowers.length; i += 2) pairs.push([flowers[i], flowers[i + 1]]);
  for (let i = 0; i < seasons.length; i += 2) pairs.push([seasons[i], seasons[i + 1]]);
  return shuffleInPlace(pairs, rand);
}

// ── Layouts ───────────────────────────────────────────────────────────────

function block(x0: number, y0: number, cols: number, rows: number, z: number): Pos[] {
  const out: Pos[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: x0 + c * 2, y: y0 + r * 2, z });
  return out;
}

/** Pyramid · 72 tiles · 3 layers (6 × 8 base). */
function pyramidLayout(): Pos[] {
  return [...block(0, 0, 6, 8, 0), ...block(2, 3, 4, 5, 1), ...block(4, 6, 2, 2, 2)];
}

/** Fortress · 100 tiles · 3 layers: 8 × 9 base, a wall ring on top and a keep in the middle. */
function fortressLayout(): Pos[] {
  return [
    ...block(0, 0, 8, 9, 0),
    ...block(2, 2, 6, 1, 1),
    ...block(2, 14, 6, 1, 1),
    ...block(2, 4, 1, 5, 1),
    ...block(12, 4, 1, 5, 1),
    ...block(6, 7, 2, 2, 1),
    ...block(6, 8, 2, 1, 2),
  ];
}

/**
 * Turtle · 144 tiles · 5 layers: the classic turtle rotated to portrait and compacted for phones —
 * the head / tail tiles are tucked into the wing notches and the top is a two-tile crown, so the
 * bounding box is 8 × 12 tiles instead of 8 × 15 (≈ 25 % larger tiles on a phone).
 */
function turtleLayout(): Pos[] {
  const spans: [number, number][] = [
    [1, 12],
    [3, 10],
    [2, 11],
    [1, 12],
    [1, 12],
    [2, 11],
    [3, 10],
    [1, 12],
  ];
  const out: Pos[] = [];
  spans.forEach(([r0, r1], c) => {
    for (let r = r0; r <= r1; r++) out.push({ x: c * 2, y: r * 2, z: 0 });
  });
  // head / tail tiles in the four wing notches
  out.push({ x: 2, y: 2, z: 0 }, { x: 12, y: 2, z: 0 }, { x: 2, y: 24, z: 0 }, { x: 12, y: 24, z: 0 });
  out.push(...block(2, 8, 6, 6, 1), ...block(4, 10, 4, 4, 2));
  // crown: two tiles side by side, two tiles stacked across them
  out.push({ x: 6, y: 13, z: 3 }, { x: 8, y: 13, z: 3 }, { x: 7, y: 12, z: 4 }, { x: 7, y: 14, z: 4 });
  return out;
}

export const LAYOUTS: Record<LayoutId, Pos[]> = {
  small: pyramidLayout(),
  medium: fortressLayout(),
  large: turtleLayout(),
};

export const LAYOUT_IDS: LayoutId[] = ['small', 'medium', 'large'];

export function overlapsXY(a: Pos, b: Pos): boolean {
  return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
}

/** Returns a list of problems (empty when the layout is valid). */
export function validateLayout(positions: Pos[]): string[] {
  const errors: string[] = [];
  if (positions.length % 2 !== 0) errors.push('odd tile count');
  if (positions.length > FULL_TILE_COUNT) errors.push('more than 144 tiles');
  if (positions.length === 0) errors.push('empty layout');
  for (let i = 0; i < positions.length; i++) {
    const a = positions[i];
    if (!Number.isInteger(a.x) || !Number.isInteger(a.y) || !Number.isInteger(a.z) || a.z < 0) errors.push(`bad coordinates at ${i}`);
    for (let j = i + 1; j < positions.length; j++) {
      const b = positions[j];
      if (a.z === b.z && overlapsXY(a, b)) errors.push(`overlap between ${i} and ${j}`);
    }
    if (a.z > 0 && !positions.some((b) => b.z === a.z - 1 && overlapsXY(a, b))) errors.push(`floating tile at ${i}`);
  }
  return errors;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  maxZ: number;
}

export function layoutBounds(positions: Pos[]): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, maxZ: 0 };
  for (const p of positions) {
    b.minX = Math.min(b.minX, p.x);
    b.maxX = Math.max(b.maxX, p.x + 2);
    b.minY = Math.min(b.minY, p.y);
    b.maxY = Math.max(b.maxY, p.y + 2);
    b.maxZ = Math.max(b.maxZ, p.z);
  }
  if (!positions.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0, maxZ: 0 };
  return b;
}

// ── Free-tile rule ────────────────────────────────────────────────────────

/** Something on the layer above overlaps this tile. */
export function isCovered(t: Pos, tiles: readonly Pos[]): boolean {
  for (const o of tiles) if (o.z === t.z + 1 && overlapsXY(t, o)) return true;
  return false;
}

/** A tile on the same layer touches / intrudes into the half-tile-wide slot left of `t`. */
export function leftBlocked(t: Pos, tiles: readonly Pos[]): boolean {
  for (const o of tiles) {
    if (o === t || o.z !== t.z) continue;
    if (Math.abs(o.y - t.y) < 2 && o.x < t.x && o.x + 2 > t.x - 2) return true;
  }
  return false;
}

export function rightBlocked(t: Pos, tiles: readonly Pos[]): boolean {
  for (const o of tiles) {
    if (o === t || o.z !== t.z) continue;
    if (Math.abs(o.y - t.y) < 2 && o.x > t.x && o.x < t.x + 4) return true;
  }
  return false;
}

/** FREE = not covered and at least one of the left / right sides completely open. */
export function isFree(t: Pos, tiles: readonly Pos[]): boolean {
  if (isCovered(t, tiles)) return false;
  return !(leftBlocked(t, tiles) && rightBlocked(t, tiles));
}

export function freeTiles(tiles: readonly Tile[]): Tile[] {
  return tiles.filter((t) => isFree(t, tiles));
}

/** All unordered pairs of free, matching tiles. */
export function availablePairs(tiles: readonly Tile[]): [Tile, Tile][] {
  const free = freeTiles(tiles);
  const out: [Tile, Tile][] = [];
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) if (matches(free[i].kind, free[j].kind)) out.push([free[i], free[j]]);
  }
  return out;
}

export function countPairs(tiles: readonly Tile[]): number {
  const free = freeTiles(tiles);
  const counts = new Map<number, number>();
  for (const t of free) {
    const g = matchGroup(t.kind);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let n = 0;
  for (const c of counts.values()) n += (c * (c - 1)) / 2;
  return n;
}

/**
 * Pick a pair to show as a hint. Prefers "safe" groups whose remaining tiles are all free
 * (removing them can never create a dead end), otherwise any available pair.
 */
export function pickHint(tiles: readonly Tile[], rand: () => number = Math.random): [Tile, Tile] | null {
  const pairs = availablePairs(tiles);
  if (!pairs.length) return null;
  const remaining = new Map<number, number>();
  for (const t of tiles) {
    const g = matchGroup(t.kind);
    remaining.set(g, (remaining.get(g) ?? 0) + 1);
  }
  const freeCount = new Map<number, number>();
  for (const t of freeTiles(tiles)) {
    const g = matchGroup(t.kind);
    freeCount.set(g, (freeCount.get(g) ?? 0) + 1);
  }
  const safe = pairs.filter(([a]) => freeCount.get(matchGroup(a.kind)) === remaining.get(matchGroup(a.kind)));
  const pool = safe.length ? safe : pairs;
  return pool[Math.floor(rand() * pool.length)];
}

// ── Solvable generation (reverse fill) ────────────────────────────────────

interface Graph {
  below: number[][];
  leftN: number[][];
  rightN: number[][];
}

function buildGraph(pos: readonly Pos[]): Graph {
  const n = pos.length;
  const below: number[][] = Array.from({ length: n }, () => []);
  const leftN: number[][] = Array.from({ length: n }, () => []);
  const rightN: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const a = pos[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = pos[j];
      if (b.z === a.z - 1 && overlapsXY(a, b)) below[i].push(j);
      if (b.z === a.z && Math.abs(b.y - a.y) < 2) {
        if (b.x < a.x && b.x + 2 > a.x - 2) leftN[i].push(j);
        if (b.x > a.x && b.x < a.x + 4) rightN[i].push(j);
      }
    }
  }
  return { below, leftN, rightN };
}

/**
 * Fill the layout in reverse removal order. Two positions are filled per step; both must be FREE
 * (in the forward sense) once both are placed, and no empty position may ever become unfillable.
 * Returns the placement order as index pairs, or null if this random attempt got stuck.
 */
function fillOrder(pos: readonly Pos[], g: Graph, rand: () => number): [number, number][] | null {
  const n = pos.length;
  const filled = new Uint8Array(n);

  // "Closed" on a side: that side can never be used to slide the tile in — either a placed tile
  // already blocks it or every neighbour position there is itself closed on the same side.
  const leftClosed = (i: number): boolean => {
    const ns = g.leftN[i];
    for (const j of ns) if (filled[j]) return true;
    for (const j of ns) if (leftClosed(j)) return true;
    return false;
  };
  const rightClosed = (i: number): boolean => {
    const ns = g.rightN[i];
    for (const j of ns) if (filled[j]) return true;
    for (const j of ns) if (rightClosed(j)) return true;
    return false;
  };
  const supported = (i: number): boolean => {
    for (const j of g.below[i]) if (!filled[j]) return false;
    return true;
  };
  const sideOpen = (i: number): boolean => {
    let l = false;
    let r = false;
    for (const j of g.leftN[i]) if (filled[j]) l = true;
    for (const j of g.rightN[i]) if (filled[j]) r = true;
    return !(l && r);
  };
  /** Can `i` be placed now without dooming any neighbouring empty position? */
  const legal = (i: number): boolean => {
    if (filled[i] || !supported(i) || !sideOpen(i)) return false;
    filled[i] = 1;
    let ok = true;
    for (const j of g.leftN[i]) if (!filled[j] && leftClosed(j) && rightClosed(j)) ok = false;
    if (ok) for (const j of g.rightN[i]) if (!filled[j] && leftClosed(j) && rightClosed(j)) ok = false;
    filled[i] = 0;
    return ok;
  };
  const candidates = (): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (legal(i)) out.push(i);
    return out;
  };

  const order: [number, number][] = [];
  let remaining = n;
  while (remaining > 0) {
    const first = shuffleInPlace(candidates(), rand);
    let placed = false;
    for (const a of first) {
      filled[a] = 1;
      // Partner must be legal, must not rest on `a`, and must leave `a` free (both removed together).
      const second = candidates().filter((b) => !g.below[b].includes(a));
      const partners: number[] = [];
      for (const b of second) {
        filled[b] = 1;
        if (sideOpen(a)) partners.push(b);
        filled[b] = 0;
      }
      if (partners.length) {
        const b = partners[Math.floor(rand() * partners.length)];
        filled[b] = 1;
        order.push([a, b]);
        remaining -= 2;
        placed = true;
        break;
      }
      filled[a] = 0;
    }
    if (!placed) return null;
  }
  return order;
}

export interface Board {
  tiles: Tile[];
  /** Pairs of tile ids in an order that clears the board when replayed. */
  solution: [number, number][];
}

/**
 * Assign kinds to positions so that the result is solvable. Positions keep their index as tile id.
 * `pairs` must contain exactly positions.length / 2 matching pairs.
 */
export function buildBoard(positions: readonly Pos[], pairs: readonly [number, number][], rand: () => number = Math.random, attempts = 200): Board | null {
  if (positions.length !== pairs.length * 2) return null;
  const g = buildGraph(positions);
  for (let a = 0; a < attempts; a++) {
    const order = fillOrder(positions, g, rand);
    if (!order) continue;
    const tiles: Tile[] = positions.map((p, i) => ({ id: i, x: p.x, y: p.y, z: p.z, kind: -1 }));
    order.forEach(([i, j], p) => {
      tiles[i].kind = pairs[p][0];
      tiles[j].kind = pairs[p][1];
    });
    const solution: [number, number][] = [];
    for (let p = order.length - 1; p >= 0; p--) solution.push([order[p][0], order[p][1]]);
    if (replaySolver(tiles, solution)) return { tiles, solution };
  }
  return null;
}

/** Generate a fresh, solvable board for a layout from the shuffled 144-tile bag. */
export function generateBoard(positions: readonly Pos[], rand: () => number = Math.random): Board {
  const bag = fullBag(rand).slice(0, positions.length / 2);
  const board = buildBoard(positions, bag, rand);
  if (!board) throw new Error('could not generate a solvable board');
  return board;
}

/**
 * Re-deal the remaining tiles' kinds in place (ids / positions preserved) so that the rest of the
 * game is solvable again. Falls back to a plain permutation if pairing is impossible.
 */
export function reshuffle(tiles: readonly Tile[], rand: () => number = Math.random): Board {
  if (!tiles.length) return { tiles: [], solution: [] };
  const positions = tiles.map((t) => ({ x: t.x, y: t.y, z: t.z }));
  const pairs = pairsFromKinds(
    tiles.map((t) => t.kind),
    rand,
  );
  const board = pairs ? buildBoard(positions, pairs, rand) : null;
  if (board) {
    // map back to original ids
    const mapped = board.tiles.map((t, i) => ({ ...t, id: tiles[i].id }));
    const solution = board.solution.map(([a, b]) => [tiles[a].id, tiles[b].id] as [number, number]);
    return { tiles: mapped, solution };
  }
  const kinds = shuffleInPlace(
    tiles.map((t) => t.kind),
    rand,
  );
  return { tiles: tiles.map((t, i) => ({ ...t, kind: kinds[i] })), solution: [] };
}

/** Replays a recorded pair order; true when every pair was free + matching and the board ends empty. */
export function replaySolver(tiles: readonly Tile[], solution: readonly [number, number][]): boolean {
  const byId = new Map<number, Tile>();
  for (const t of tiles) byId.set(t.id, t);
  let present: Tile[] = tiles.slice();
  for (const [a, b] of solution) {
    const ta = byId.get(a);
    const tb = byId.get(b);
    if (!ta || !tb || ta === tb) return false;
    if (!present.includes(ta) || !present.includes(tb)) return false;
    if (!matches(ta.kind, tb.kind)) return false;
    if (!isFree(ta, present) || !isFree(tb, present)) return false;
    present = present.filter((t) => t !== ta && t !== tb);
  }
  return present.length === 0;
}

// ── Geometry / hit testing ────────────────────────────────────────────────

export interface Metrics {
  /** Board origin (CSS px) inside the canvas. */
  ox: number;
  oy: number;
  /** Tile face size. */
  w: number;
  h: number;
  /** Half-unit size. */
  hw: number;
  hh: number;
  /** Per-layer 2.5D shift and visible side thickness. */
  lift: number;
  minX: number;
  minY: number;
  maxZ: number;
}

export const TILE_ASPECT = 1.2;
export const LIFT_RATIO = 0.09;

/** Fit the layout into the available area (CSS px), centred. */
export function computeMetrics(b: Bounds, availW: number, availH: number, pad = 8, maxTileW = 84): Metrics {
  const cols = (b.maxX - b.minX) / 2;
  const rows = (b.maxY - b.minY) / 2;
  const layers = b.maxZ + 1;
  const fromW = (availW - pad * 2) / (cols + layers * LIFT_RATIO);
  const fromH = (availH - pad * 2) / (rows * TILE_ASPECT + layers * LIFT_RATIO);
  const w = Math.max(6, Math.min(maxTileW, fromW, fromH));
  const h = w * TILE_ASPECT;
  const lift = Math.max(2, w * LIFT_RATIO);
  const boardW = cols * w + layers * lift;
  const boardH = rows * h + layers * lift;
  return {
    ox: (availW - boardW) / 2,
    oy: (availH - boardH) / 2,
    w,
    h,
    hw: w / 2,
    hh: h / 2,
    lift,
    minX: b.minX,
    minY: b.minY,
    maxZ: b.maxZ,
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Screen rect of the tile face (its right / bottom sides extend `lift` px further). */
export function tileRect(t: Pos, m: Metrics): Rect {
  return {
    x: m.ox + (t.x - m.minX) * m.hw + (m.maxZ - t.z) * m.lift,
    y: m.oy + (t.y - m.minY) * m.hh + (m.maxZ - t.z) * m.lift,
    w: m.w,
    h: m.h,
  };
}

/** Painter's order: lower layers first, then top-to-bottom, left-to-right. */
export function drawOrder<T extends Pos>(tiles: readonly T[]): T[] {
  return tiles.slice().sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}

/** The topmost tile whose body (face + visible sides) contains the point, or null. */
export function hitTest<T extends Pos>(tiles: readonly T[], px: number, py: number, m: Metrics): T | null {
  const ordered = drawOrder(tiles);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const t = ordered[i];
    const r = tileRect(t, m);
    if (px >= r.x && px < r.x + r.w + m.lift && py >= r.y && py < r.y + r.h + m.lift) return t;
  }
  return null;
}

/** Like hitTest but tolerant: falls back to the nearest free tile within `slop` px of the point. */
export function hitTestTolerant(tiles: readonly Tile[], px: number, py: number, m: Metrics, slop = 6): Tile | null {
  const exact = hitTest(tiles, px, py, m);
  if (exact) return exact;
  let best: Tile | null = null;
  let bestD = slop;
  for (const t of freeTiles(tiles)) {
    const r = tileRect(t, m);
    const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}
