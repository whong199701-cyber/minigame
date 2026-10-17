/**
 * Dev-only renderer harness (served by Vite at /src/games/tower-defense/dev/harness.html; never imported by the app).
 * Mounts the renderer with a hand-made mock RenderSnapshot and animated mock movement along the map's path.
 *
 * Query params: theme=dark|light · scene=gallery|battle · map=vessel|alveoli|gut|brain · quality=high|low|auto ·
 * lang=zh|en · enemies=N (battle) · hud=1 · seed=N · zoom=1..2 · focus=x,y (logic cells) · layout=game|full ·
 * fixed=<dt> (deterministic: every frame advances the mock simulation by exactly dt seconds)
 * window.__td exposes measure(), loseContext(), restoreContext(), tap(), dispose() for scripts.
 */
import { Renderer, type TapHit } from '../render';
import { buildMapInfo, type MapInfo } from '../render/mapgeom';
import {
  ENEMY_IDS,
  EnemyViewFlag,
  SNAPSHOT_CAPACITY,
  TOWER_IDS,
  TOWER_SPECS,
  type Cell,
  type EnemyId,
  type GameEvent,
  type MapDef,
  type RenderSnapshot,
  type SpecId,
  type TowerId,
  type TowerLevel,
  type TowerView,
} from '../types';

// ── maps (spec §1) ──────────────────────────────────────────────────────────

const C = (s: string): Cell[] =>
  s
    .trim()
    .split(/\)\s*\(/)
    .map((p) => p.replace(/[()]/g, '').split(',').map(Number) as unknown as Cell);

const MAPS: Record<string, MapDef> = {
  vessel: {
    id: 'vessel',
    cols: 9,
    rows: 13,
    paths: [{ id: 'A', waypoints: C('(0,1) (7,1) (7,4) (1,4) (1,7) (7,7) (7,10) (4,10) (4,12)'), flow: [1, 1, -1, 1, 1, 1, -1, 1] }],
    pads: C('(3,0) (1,2) (3,2) (5,2) (2,3) (4,3) (6,3) (3,5) (5,5) (7,5) (2,6) (4,6) (6,6) (1,8) (3,8) (5,8) (2,9) (4,9) (6,9) (1,11) (3,11) (5,11) (7,11) (2,12) (6,12)'),
    villi: [],
    core: [[4, 12]],
    hpMult: 1,
    unlockStars: 0,
    maxBarriers: 3,
    barrierBan: 3,
  },
  alveoli: {
    id: 'alveoli',
    cols: 10,
    rows: 14,
    paths: [
      { id: 'A', waypoints: C('(0,1) (2,1) (2,4) (4,4) (4,6) (8,6) (8,9) (1,9) (1,12) (5,12) (5,13)'), flow: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
      { id: 'B', waypoints: C('(9,1) (7,1) (7,4) (4,4) (4,6) (8,6) (8,9) (1,9) (1,12) (5,12) (5,13)'), flow: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
    ],
    pads: C('(1,2) (4,2) (8,2) (1,3) (3,3) (5,3) (6,3) (8,3) (2,5) (6,5) (8,5) (1,6) (3,6) (4,7) (6,7) (1,8) (3,8) (5,8) (7,8) (2,10) (4,10) (6,10) (8,10) (3,11) (5,11) (7,11) (4,13) (6,13)'),
    villi: [],
    core: [[5, 13]],
    hpMult: 0.9,
    unlockStars: 0,
    maxBarriers: 3,
    barrierBan: 3,
    breathing: { period: 12, reverseFor: 3, warnFor: 1, push: 1, interrupt: 1 },
  },
  gut: {
    id: 'gut',
    cols: 10,
    rows: 15,
    paths: [{ id: 'A', waypoints: C('(0,1) (8,1) (8,4) (1,4) (1,7) (8,7) (8,10) (1,10) (1,13) (5,13) (5,14)'), flow: [1, 0, -1, 0, 1, 0, -1, 0, 1, 1] }],
    pads: C('(2,0) (6,0) (1,2) (5,2) (3,3) (7,3) (2,5) (6,5) (4,6) (8,6) (1,8) (5,8) (3,9) (7,9) (2,11) (6,11) (4,12) (8,12) (7,13) (3,14) (7,14)'),
    villi: C('(9,2) (9,3) (0,5) (0,6) (9,8) (9,9) (0,11) (0,12)'),
    core: [[5, 14]],
    hpMult: 1.2,
    unlockStars: 0,
    maxBarriers: 3,
    barrierBan: 3,
  },
  brain: {
    id: 'brain',
    cols: 10,
    rows: 15,
    paths: [
      { id: 'L', waypoints: C('(1,0) (1,2) (3,2) (3,5) (1,5) (1,8) (3,8) (3,11) (1,11) (1,13) (4,13) (4,14)'), flow: [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1] },
      { id: 'R', waypoints: C('(8,0) (8,2) (6,2) (6,5) (8,5) (8,8) (6,8) (6,11) (8,11) (8,13) (5,13) (5,14)'), flow: [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1] },
    ],
    pads: C('(4,0) (5,0) (0,1) (9,1) (3,1) (6,1) (4,2) (5,2) (1,3) (8,3) (2,4) (7,4) (4,4) (5,4) (3,6) (6,6) (2,7) (7,7) (4,8) (5,8) (1,9) (8,9) (2,10) (7,10) (4,10) (5,10) (3,12) (6,12) (0,13) (9,13) (2,14) (7,14)'),
    villi: [],
    core: [
      [4, 14],
      [5, 14],
    ],
    hpMult: 1,
    unlockStars: 6,
    maxBarriers: 3,
    barrierBan: 3,
  },
};

// ── params ──────────────────────────────────────────────────────────────────

const q = new URLSearchParams(location.search);
const theme = (q.get('theme') === 'light' ? 'light' : 'dark') as 'dark' | 'light';
const scene = q.get('scene') ?? 'gallery';
const mapId = q.get('map') ?? 'vessel';
const quality = (q.get('quality') ?? 'high') as 'high' | 'low' | 'auto';
const lang = (q.get('lang') === 'en' ? 'en' : 'zh') as 'zh' | 'en';
const nEnemies = Number(q.get('enemies') ?? 60);
const map = MAPS[mapId] ?? MAPS.vessel;
const info: MapInfo = buildMapInfo(map);
document.body.style.background = theme === 'dark' ? '#1a0a18' : '#f6d8d2';
document.body.classList.toggle('light', theme === 'light');
// layout=game (default) mimics the in-game chrome: header + HUD on top, two-row bottom bar; layout=full hides it
const gameLayout = q.get('layout') !== 'full';
if (!gameLayout) document.querySelectorAll<HTMLElement>('.mock-bar').forEach((e) => (e.style.display = 'none'));

// ── path sampling ───────────────────────────────────────────────────────────

interface Geo {
  pts: number[];
  cum: number[];
  len: number;
}
const geos: Geo[] = info.paths.map((p) => {
  const cum = [0];
  for (let i = 2; i < p.pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p.pts[i] - p.pts[i - 2], p.pts[i + 1] - p.pts[i - 1]));
  return { pts: p.pts, cum, len: cum[cum.length - 1] };
});
const pos = { x: 0, y: 0, a: 0 };
function pointAt(pi: number, d: number): typeof pos {
  const g = geos[pi % geos.length];
  const dd = Math.max(0, Math.min(g.len - 1e-3, d));
  let k = 0;
  while (k < g.cum.length - 2 && g.cum[k + 1] < dd) k++;
  const t = (dd - g.cum[k]) / Math.max(1e-6, g.cum[k + 1] - g.cum[k]);
  const x0 = g.pts[k * 2];
  const y0 = g.pts[k * 2 + 1];
  const x1 = g.pts[k * 2 + 2];
  const y1 = g.pts[k * 2 + 3];
  pos.x = x0 + (x1 - x0) * t;
  pos.y = y0 + (y1 - y0) * t;
  pos.a = Math.atan2(y1 - y0, x1 - x0);
  return pos;
}

// ── snapshot buffers (mirrors createSnapshot) ──────────────────────────────

function createSnapshot(): RenderSnapshot {
  const E = SNAPSHOT_CAPACITY.enemies;
  const S = SNAPSHOT_CAPACITY.segments;
  const P = SNAPSHOT_CAPACITY.projectiles;
  const towers: TowerView[] = [];
  for (let i = 0; i < SNAPSHOT_CAPACITY.towers; i++)
    towers.push({ id: 0, type: 0, typeId: 'antibody', level: 1, spec: null, x: 0, y: 0, angle: 0, lastShotAt: -1, infected: false, immune: false, charge: 0, digesting: false, hpFrac: 1, onVilli: false, buffed: false, selected: false, range: 0 });
  return {
    time: 0,
    alpha: 0,
    phase: 'wave',
    wave: 5,
    enemies: {
      capacity: E,
      count: 0,
      id: new Int32Array(E),
      type: new Uint8Array(E),
      x: new Float32Array(E),
      y: new Float32Array(E),
      angle: new Float32Array(E),
      hpFrac: new Float32Array(E),
      radius: new Float32Array(E),
      flags: new Uint16Array(E),
      markStacks: new Uint8Array(E),
      slow: new Float32Array(E),
      immuneTo: new Uint8Array(E),
      telegraph: new Float32Array(E),
      segStart: new Int32Array(E),
      segCount: new Uint8Array(E),
      segCapacity: S,
      segTotal: 0,
      segX: new Float32Array(S),
      segY: new Float32Array(S),
      segAngle: new Float32Array(S),
    },
    towers,
    towerCount: 0,
    projectiles: { capacity: P, count: 0, kind: new Uint8Array(P), x: new Float32Array(P), y: new Float32Array(P), h: new Float32Array(P), angle: new Float32Array(P) },
    hero: { x: 4.5, y: 11.5, angle: 0, hpFrac: 0.8, level: 2, xpFrac: 0.4, alive: true, respawnFrac: 0, moving: false, attacking: false, destX: NaN, destY: NaN, curing: false },
    flow: { breathing: !!map.breathing, reversed: false, warn: false, fever: false, adrenaline: false },
    selection: null,
    interaction: 'none',
    cursorX: NaN,
    cursorY: NaN,
  };
}

const RADIUS: Record<EnemyId, number> = {
  bacterium: 0.22,
  flagellate: 0.18,
  encapsulated: 0.26,
  virus: 0.2,
  spore: 0.22,
  sporeling: 0.13,
  parasite: 0.3,
  biofilm: 0.26,
  prion: 0.2,
  toxin: 0.24,
  mutant: 0.34,
  superbug: 0.45,
  giantParasite: 0.5,
  virusKing: 0.5,
};
const SPEED: Record<EnemyId, number> = {
  bacterium: 1.3,
  flagellate: 2.4,
  encapsulated: 1.0,
  virus: 1.6,
  spore: 1.2,
  sporeling: 1.9,
  parasite: 0.75,
  biofilm: 0.9,
  prion: 1.4,
  toxin: 1.5,
  mutant: 0.7,
  superbug: 0.55,
  giantParasite: 0.7,
  virusKing: 0.6,
};
const BOSS = new Set<EnemyId>(['superbug', 'giantParasite', 'virusKing']);

interface MockEnemy {
  id: number;
  type: EnemyId;
  path: number;
  dist: number;
  speed: number;
  hp: number;
  marks: number;
  slow: number;
  burning: boolean;
  revealed: boolean;
  telegraph: number;
  immuneTo: number;
  hardened: boolean;
  stunned: boolean;
  attacking: boolean;
}

interface MockTower {
  id: number;
  type: TowerId;
  level: TowerLevel;
  spec: SpecId | null;
  col: number;
  row: number;
  angle: number;
  lastShot: number;
  cooldown: number;
  infected: boolean;
  immune: boolean;
  hp: number;
  buffed: boolean;
}

let nextId = 1;
const enemies: MockEnemy[] = [];
const towers: MockTower[] = [];
const RANGE: Record<TowerId, number> = { antibody: 2.8, macrophage: 1.7, mast: 2.4, pyrogen: 2.1, tcell: 4.4, complement: 2.6, beacon: 2.3, barrier: 0 };
const RATE: Record<TowerId, number> = { antibody: 0.4, macrophage: 1.0, mast: 1.5, pyrogen: 99, tcell: 1.8, complement: 1.0, beacon: 99, barrier: 99 };

function addEnemy(type: EnemyId, dist: number, path = 0, extra: Partial<MockEnemy> = {}): MockEnemy {
  const e: MockEnemy = { id: nextId++, type, path, dist, speed: SPEED[type] * 0.6, hp: 1, marks: 0, slow: 0, burning: false, revealed: false, telegraph: 0, immuneTo: 0, hardened: false, stunned: false, attacking: false, ...extra };
  enemies.push(e);
  return e;
}

function addTower(type: TowerId, level: TowerLevel, spec: SpecId | null, col: number, row: number, extra: Partial<MockTower> = {}): MockTower {
  const t: MockTower = { id: nextId++, type, level, spec, col, row, angle: Math.PI / 2, lastShot: -10, cooldown: RATE[type] * (0.8 + Math.random() * 0.4), infected: false, immune: false, hp: 1, buffed: false, ...extra };
  towers.push(t);
  return t;
}

// ── scenes ──────────────────────────────────────────────────────────────────

const pads = [...map.pads, ...map.villi];
const pathCells: Cell[] = [];
for (let r = 0; r < map.rows; r++) for (let c = 0; c < map.cols; c++) if (info.pathMask[r * map.cols + c]) pathCells.push([c, r]);

if (scene === 'gallery') {
  const kinds: TowerId[] = ['antibody', 'macrophage', 'mast', 'pyrogen', 'tcell', 'complement', 'beacon'];
  const extraCells: Cell[] = mapId === 'vessel' ? [[5, 0], [8, 2], [0, 9]] : [];
  const slots = [...pads, ...extraCells];
  let k = 0;
  for (const type of kinds) {
    const [sa, sb] = TOWER_SPECS[type];
    const variants: [TowerLevel, SpecId | null][] = [
      [1, null],
      [2, null],
      [3, sa],
      [3, sb],
    ];
    for (const [lv, sp] of variants) {
      const cell = slots[k++];
      if (!cell) break;
      addTower(type, lv, sp, cell[0], cell[1]);
    }
  }
  // barriers on path cells at different HP
  const bcells: Cell[] = mapId === 'vessel' ? [[5, 1], [4, 4], [4, 7], [6, 10]] : pathCells.filter((_, i) => i % 9 === 4).slice(0, 4);
  const bvar: [TowerLevel, SpecId | null, number][] = [
    [1, null, 1],
    [2, null, 0.7],
    [3, 'fibrin', 0.45],
    [3, 'clotSpikes', 0.22],
  ];
  bcells.forEach((c, i) => addTower('barrier', bvar[i][0], bvar[i][1], c[0], c[1], { hp: bvar[i][2] }));
  towers[4 * 4 + 3].infected = true; // tcell apoptosis infected
  towers[1].infected = true;
  towers[9].immune = true;
  towers[2].buffed = true;
  towers[5].buffed = true;
  // every enemy type spaced along the path
  const L = geos[0].len;
  const order: EnemyId[] = ['bacterium', 'flagellate', 'encapsulated', 'virus', 'spore', 'sporeling', 'parasite', 'biofilm', 'prion', 'prion', 'toxin', 'mutant', 'superbug', 'giantParasite', 'virusKing'];
  order.forEach((t, i) => {
    const e = addEnemy(t, 1.5 + (i * (L - 3)) / order.length, i % info.paths.length);
    e.hp = [1, 0.8, 0.55, 0.3, 0.9, 1, 0.65, 0.4, 1, 0.7, 0.85, 0.5, 0.75, 0.6, 0.9][i];
    e.marks = i % 4;
    if (t === 'prion' && i === 9) e.revealed = true;
    if (t === 'encapsulated') e.slow = 0.5;
    if (t === 'biofilm') e.burning = true;
    if (t === 'superbug') e.hardened = true;
    if (t === 'virusKing') e.immuneTo = TOWER_IDS.indexOf('tcell') + 1;
    if (t === 'giantParasite') e.telegraph = 0.6;
    e.speed *= 0.35;
  });
} else {
  // battle: 20 towers + N enemies
  const mix: [TowerId, TowerLevel, SpecId | null][] = [
    ['antibody', 1, null],
    ['antibody', 2, null],
    ['antibody', 3, 'polyvalent'],
    ['mast', 1, null],
    ['mast', 3, 'allergyStorm'],
    ['macrophage', 2, null],
    ['macrophage', 3, 'enzymes'],
    ['pyrogen', 1, null],
    ['pyrogen', 3, 'highFever'],
    ['tcell', 2, null],
    ['tcell', 3, 'perforin'],
    ['complement', 1, null],
    ['complement', 3, 'longChain'],
    ['beacon', 2, null],
    ['beacon', 3, 'potentiate'],
    ['antibody', 3, 'neutralizing'],
    ['mast', 2, null],
    ['tcell', 1, null],
  ];
  mix.forEach(([t, l, s], i) => {
    const cell = pads[(i * 7) % pads.length];
    if (towers.some((x) => x.col === cell[0] && x.row === cell[1])) {
      const free = pads.find((p) => !towers.some((x) => x.col === p[0] && x.row === p[1]));
      if (free) addTower(t, l, s, free[0], free[1]);
    } else addTower(t, l, s, cell[0], cell[1]);
  });
  const bc = pathCells.filter((_, i) => i % 11 === 6).slice(0, 2);
  bc.forEach((c, i) => addTower('barrier', (i + 2) as TowerLevel, i ? 'fibrin' : null, c[0], c[1], { hp: 0.6 + i * 0.3 }));
  const pool: EnemyId[] = ['bacterium', 'bacterium', 'flagellate', 'encapsulated', 'virus', 'virus', 'spore', 'sporeling', 'parasite', 'biofilm', 'prion', 'toxin', 'mutant', 'bacterium', 'flagellate'];
  for (let i = 0; i < nEnemies - 1; i++) {
    const t = pool[i % pool.length];
    const g = geos[i % geos.length];
    const e = addEnemy(t, (i / nEnemies) * (g.len - 1), i % geos.length);
    e.hp = 0.3 + ((i * 37) % 70) / 100;
    e.marks = i % 5 === 0 ? 2 : 0;
  }
  const boss = addEnemy('superbug', geos[0].len * 0.35, 0);
  boss.hp = 0.7;
}
// pick a hero patrol
let snapInitHero: [number, number] | null = null;
const heroPath: [number, number][] =
  scene === 'gallery' && mapId === 'vessel'
    ? [
        [2.5, 5.5],
        [4.5, 5.6],
        [4.5, 8.4],
      ]
    : [
        [info.coreX, info.coreY - 0.6],
        [info.coreX + 2, info.coreY - 2.5],
        [info.coreX - 2, info.coreY - 3.5],
      ];
if (heroPath.length) {
  snapInitHero = heroPath[0];
}

// ── renderer ────────────────────────────────────────────────────────────────

const stage = document.getElementById('stage')!;
const hud = document.getElementById('hud')!;
const renderer = new Renderer({ lang });
const lostLog: boolean[] = [];
renderer.setMap(map);
renderer.mount(stage, { theme, quality, lang, onContextLost: (l) => lostLog.push(l) });
const taps: TapHit[] = [];
renderer.onTap((h) => taps.push(h));
const snap = createSnapshot();
if (snapInitHero) {
  snap.hero.x = snapInitHero[0];
  snap.hero.y = snapInitHero[1];
}
if (gameLayout) renderer.setInsets(104, 132);
{
  const z = Number(q.get('zoom') ?? 1);
  if (z > 1) renderer.zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, z);
  const f = q.get('focus');
  if (f) {
    const [fx, fy] = f.split(',').map(Number);
    renderer.centerOn(fx, fy, 0.5);
  }
}
if (scene === 'gallery') {
  renderer.showBuildable(mapId === 'vessel' ? [[8, 5], [0, 12]] : pads.slice(0, 3));
}

let simT = 0;
let last = performance.now();
const frameTimes: number[] = [];
const cpuTimes: number[] = [];
let events: GameEvent[] = [];
let evClock = 0;
let paused = false;
let feverOn = false;
let adrenOn = false;
const rnd = (() => {
  let s = Number(q.get('seed') ?? 7) | 0 || 7;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
})();

interface MockProj {
  kind: number;
  x0: number;
  y0: number;
  target: MockEnemy;
  t: number;
  dur: number;
  arc: number;
  src: MockTower;
}
const projs: MockProj[] = [];

function enemyPos(e: MockEnemy): typeof pos {
  return pointAt(e.path, e.dist);
}

function nearestEnemy(x: number, y: number, range: number): MockEnemy | null {
  let best: MockEnemy | null = null;
  let bd = range;
  for (const e of enemies) {
    if (e.type === 'prion' && !e.revealed) continue;
    const p = enemyPos(e);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

function step(dt: number): void {
  simT += dt;
  evClock += dt;
  // enemies
  for (const e of enemies) {
    if (e.stunned) continue;
    e.dist += e.speed * (1 - e.slow * 0.5) * dt * (feverOn ? 0.6 : 1);
    const g = geos[e.path];
    if (e.dist > g.len - 0.3) {
      e.dist = 0.2;
      const p = enemyPos(e);
      events.push({ type: 'spawn', id: e.id, enemy: e.type, pathIndex: e.path, x: p.x, y: p.y });
    }
  }
  // towers fire
  for (const t of towers) {
    if (t.type === 'barrier' || t.type === 'beacon' || t.type === 'pyrogen') continue;
    const tx = t.col + 0.5;
    const ty = t.row + 0.5;
    const target = nearestEnemy(tx, ty, RANGE[t.type] + 0.5);
    if (target) {
      const p = enemyPos(target);
      t.angle = Math.atan2(p.y - ty, p.x - tx);
    }
    if (simT - t.lastShot < t.cooldown * (t.infected ? 2 : 1) * (adrenOn ? 0.6 : 1) || !target) continue;
    t.lastShot = simT;
    const p = enemyPos(target);
    if (t.type === 'antibody' || t.type === 'mast') {
      projs.push({ kind: TOWER_IDS.indexOf(t.type), x0: tx, y0: ty, target, t: 0, dur: t.type === 'mast' ? 0.6 : 0.25, arc: t.type === 'mast' ? 1.2 : 0, src: t });
      events.push({ type: 'shoot', tower: t.id, kind: t.type, x: tx, y: ty, angle: t.angle });
    } else if (t.type === 'tcell') {
      events.push({ type: 'tracer', tower: t.id, x1: tx, y1: ty, x2: p.x, y2: p.y });
      hit(target, 70 + Math.round(rnd() * 140), 'tcell', rnd() < 0.3);
    } else if (t.type === 'complement') {
      const pts = [{ x: p.x, y: p.y }];
      const hitList = [target];
      for (let k = 0; k < 3; k++) {
        const last = pts[pts.length - 1];
        let nb: MockEnemy | null = null;
        let bd = 1.6;
        for (const e of enemies) {
          if (hitList.includes(e)) continue;
          const q2 = enemyPos(e);
          const d = Math.hypot(q2.x - last.x, q2.y - last.y);
          if (d < bd) {
            bd = d;
            nb = e;
          }
        }
        if (!nb) break;
        hitList.push(nb);
        const q3 = enemyPos(nb);
        pts.push({ x: q3.x, y: q3.y });
      }
      events.push({ type: 'chain', tower: t.id, points: pts, ids: hitList.map((e) => e.id) });
      for (const e of hitList) hit(e, 30 + Math.round(rnd() * 20), 'complement', false);
    } else if (t.type === 'macrophage') {
      hit(target, 34, 'macrophage', false);
    }
  }
  // projectiles
  for (let i = projs.length - 1; i >= 0; i--) {
    const pr = projs[i];
    pr.t += dt / pr.dur;
    if (pr.t >= 1) {
      projs.splice(i, 1);
      const p = enemyPos(pr.target);
      if (pr.kind === TOWER_IDS.indexOf('mast')) {
        events.push({ type: 'splash', kind: 'mast', x: p.x, y: p.y, radius: 1.3, hits: 2 });
        hit(pr.target, 65, 'mast', false);
      } else {
        hit(pr.target, 11 + Math.round(rnd() * 6), 'antibody', false);
        events.push({ type: 'mark', enemy: pr.target.id, stacks: 1, strong: false });
        pr.target.marks = Math.min(3, pr.target.marks + 1);
      }
    }
  }
  // scripted events (looping every 12 s)
  const cyc = simT % 12;
  const prevCyc = (simT - dt) % 12;
  const at = (s: number): boolean => prevCyc < s && cyc >= s;
  if (at(0.3)) events.push({ type: 'waveStart', wave: 5, bonus: 0, boss: scene === 'gallery' ? 'superbug' : null });
  if (at(2)) {
    const t = towers.find((x) => x.type === 'mast') ?? towers[0];
    t.infected = true;
    events.push({ type: 'infect', tower: t.id, by: enemies[0].id, until: simT + 8 });
  }
  if (at(5)) {
    const t = towers.find((x) => x.infected && x.type === 'mast');
    if (t) {
      t.infected = false;
      events.push({ type: 'cure', tower: t.id, by: 'hero', immuneUntil: simT + 3 });
    }
  }
  if (at(3)) {
    const cx = info.cols / 2;
    const cy = info.rows * 0.4;
    events.push({ type: 'abilityCast', ability: 'antibiotic', x: cx, y: cy });
  }
  if (at(3.4)) events.push({ type: 'abilityImpact', ability: 'antibiotic', x: info.cols / 2, y: info.rows * 0.4, radius: 1.5, hits: 3 });
  if (at(6)) {
    feverOn = true;
    events.push({ type: 'abilityCast', ability: 'fever' });
  }
  if (at(8.5)) feverOn = false;
  if (at(8.6)) {
    adrenOn = true;
    events.push({ type: 'abilityCast', ability: 'adrenaline' });
  }
  if (at(11.5)) adrenOn = false;
  if (at(4)) {
    const mac = towers.find((x) => x.type === 'macrophage');
    const victim = enemies.find((e) => e.type === 'bacterium' || e.type === 'sporeling');
    if (mac && victim) {
      const p = enemyPos(victim);
      events.push({ type: 'engulf', tower: mac.id, enemy: victim.id, enemyType: victim.type, x: p.x, y: p.y });
      events.push({ type: 'kill', enemy: victim.id, enemyType: victim.type, x: p.x, y: p.y, reward: 5, by: mac.id, boss: false });
      victim.dist = 0.2;
    }
  }
  if (at(7)) {
    const boss = enemies.find((e) => BOSS.has(e.type));
    if (boss) {
      const p = enemyPos(boss);
      events.push({ type: 'bossSkill', boss: boss.id, bossType: boss.type as 'superbug', skill: 'sporulation', stage: 'telegraph', x: p.x, y: p.y });
    }
  }
  if (at(9)) {
    const b = towers.find((x) => x.type === 'barrier');
    if (b) events.push({ type: 'barrierHit', tower: b.id, enemy: 0, hp: 100, maxHp: 300 });
    const t = towers[3];
    if (t) events.push({ type: 'upgrade', tower: t.id, kind: t.type, level: t.level, spec: t.spec, cost: 50 });
  }
  if (at(10)) {
    const e = enemies[Math.floor(rnd() * enemies.length)];
    const p = enemyPos(e);
    events.push({ type: 'execute', enemy: e.id, enemyType: e.type, x: p.x, y: p.y, by: 'apoptosis' });
  }
  // hero patrol
  const hv = snap.hero;
  const leg = Math.floor(simT / 3) % heroPath.length;
  const [dx, dy] = heroPath[leg];
  const ddx = dx - hv.x;
  const ddy = dy - hv.y;
  const dd = Math.hypot(ddx, ddy);
  if (dd > 0.05) {
    hv.x += (ddx / dd) * Math.min(dd, 1.6 * dt);
    hv.y += (ddy / dd) * Math.min(dd, 1.6 * dt);
    hv.angle = Math.atan2(ddy, ddx);
    hv.moving = true;
    hv.destX = dx;
    hv.destY = dy;
    hv.attacking = false;
  } else {
    hv.moving = false;
    hv.destX = NaN;
    hv.destY = NaN;
    hv.attacking = true;
  }
  hv.curing = cyc > 4.6 && cyc < 5.4;
  // breathing (alveoli)
  if (map.breathing) {
    const c = simT % 12;
    snap.flow.warn = c >= 8 && c < 9;
    const rev = c >= 9;
    if (rev !== snap.flow.reversed) events.push({ type: 'flowReverse', reversed: rev });
    snap.flow.reversed = rev;
  }
}

function hit(e: MockEnemy, dmg: number, kind: TowerId | 'hero' | 'ability', crit: boolean): void {
  const p = enemyPos(e);
  events.push({ type: 'hit', kind, enemy: e.id, x: p.x, y: p.y, dmg, crit });
  e.hp -= dmg / (BOSS.has(e.type) ? 3000 : 400);
  if (e.hp <= 0) {
    events.push({ type: 'kill', enemy: e.id, enemyType: e.type, x: p.x, y: p.y, reward: 6, by: 0, boss: BOSS.has(e.type) });
    events.push({ type: 'atp', delta: 6, x: p.x, y: p.y });
    e.hp = 1;
    e.dist = 0.2;
    e.id = nextId++;
  }
}

function fill(): void {
  snap.time = simT;
  const E = snap.enemies;
  let n = 0;
  let segN = 0;
  for (const e of enemies) {
    if (n >= E.capacity) break;
    const p = enemyPos(e);
    const t = ENEMY_IDS.indexOf(e.type);
    E.id[n] = e.id;
    E.type[n] = t;
    E.x[n] = p.x;
    E.y[n] = p.y;
    E.angle[n] = p.a;
    E.hpFrac[n] = Math.max(0.02, e.hp);
    E.radius[n] = RADIUS[e.type];
    let f = 0;
    if (e.type === 'toxin') f |= EnemyViewFlag.Flying;
    if (e.type === 'prion') f |= EnemyViewFlag.Stealth | (e.revealed ? EnemyViewFlag.Revealed : 0);
    if (BOSS.has(e.type)) f |= EnemyViewFlag.Boss;
    if (e.burning) f |= EnemyViewFlag.Burning;
    if (e.hardened) f |= EnemyViewFlag.Hardened;
    if (e.marks) f |= EnemyViewFlag.Marked;
    E.flags[n] = f;
    E.markStacks[n] = e.marks;
    E.slow[n] = e.slow;
    E.immuneTo[n] = e.immuneTo;
    E.telegraph[n] = e.telegraph > 0 ? (Math.sin(simT * 2) * 0.5 + 0.5) * e.telegraph : 0;
    const segs = e.type === 'parasite' ? 5 : e.type === 'giantParasite' ? 8 : 0;
    const sp = e.type === 'parasite' ? 0.45 : 0.5;
    E.segStart[n] = segN;
    E.segCount[n] = 0;
    for (let k = 1; k <= segs && segN < E.segCapacity; k++) {
      const q2 = pointAt(e.path, e.dist - k * sp);
      E.segX[segN] = q2.x;
      E.segY[segN] = q2.y;
      E.segAngle[segN] = q2.a;
      segN++;
      E.segCount[n]++;
    }
    n++;
  }
  E.count = n;
  E.segTotal = segN;
  let tc = 0;
  for (const t of towers) {
    const v = snap.towers[tc++];
    v.id = t.id;
    v.type = TOWER_IDS.indexOf(t.type);
    v.typeId = t.type;
    v.level = t.level;
    v.spec = t.spec;
    v.x = t.col + 0.5;
    v.y = t.row + 0.5;
    v.angle = t.angle;
    v.lastShotAt = t.lastShot;
    v.infected = t.infected;
    v.immune = t.immune;
    v.charge = t.type === 'macrophage' ? (simT % 5) / 5 : 0;
    v.digesting = t.type === 'macrophage' && simT % 6 < 2.5;
    v.hpFrac = t.type === 'barrier' ? t.hp : 1;
    v.onVilli = false;
    v.buffed = t.buffed;
    v.selected = false;
    v.range = RANGE[t.type] + (t.level - 1) * 0.2;
  }
  snap.towerCount = tc;
  const P = snap.projectiles;
  let pn = 0;
  for (const pr of projs) {
    if (pn >= P.capacity) break;
    const p = enemyPos(pr.target);
    const t = Math.min(1, pr.t);
    P.kind[pn] = pr.kind;
    P.x[pn] = pr.x0 + (p.x - pr.x0) * t;
    P.y[pn] = pr.y0 + (p.y - pr.y0) * t;
    P.h[pn] = pr.arc > 0 ? 4 * pr.arc * t * (1 - t) + 0.3 : 0.4;
    P.angle[pn] = Math.atan2(p.y - pr.y0, p.x - pr.x0);
    pn++;
  }
  P.count = pn;
  snap.flow.fever = feverOn;
  snap.flow.adrenaline = adrenOn;
  // UI-owned fields
  if (scene === 'gallery') {
    const tcell = towers.find((t) => t.type === 'tcell' && t.level === 3);
    const cyc = simT % 12;
    if (cyc < 6 && tcell) snap.selection = { kind: 'tower', id: tcell.id };
    else snap.selection = { kind: 'pad', col: mapId === 'vessel' ? 8 : pads[0][0], row: mapId === 'vessel' ? 5 : pads[0][1], previewType: 'mast' };
    if (cyc > 9) {
      snap.interaction = 'abilityTarget';
      snap.cursorX = info.cols * 0.35;
      snap.cursorY = info.rows * 0.62;
    } else {
      snap.interaction = 'none';
      snap.cursorX = NaN;
      snap.cursorY = NaN;
    }
  }
}

const fixedStep = Number(q.get('fixed') ?? 0);
function frame(): void {
  if (destroyed) return;
  if ((window as unknown as { __stopRaf?: boolean }).__stopRaf) {
    raf = requestAnimationFrame(frame);
    return;
  }
  const now = performance.now();
  const dt = fixedStep > 0 ? fixedStep : Math.min(0.1, (now - last) / 1000);
  frameTimes.push(now - last);
  if (frameTimes.length > 600) frameTimes.shift();
  last = now;
  if (!paused) step(dt);
  fill();
  const c0 = performance.now();
  renderer.consumeEvents(events);
  events = [];
  renderer.update(snap, 1, dt);
  cpuTimes.push(performance.now() - c0);
  if (cpuTimes.length > 600) cpuTimes.shift();
  if (q.get('hud') === '1') {
    const st = renderer.stats();
    hud.textContent = `calls ${st.calls} tris ${st.triangles} cpu ${renderer.cpuTime().avg.toFixed(2)}ms enemies ${snap.enemies.count} towers ${snap.towerCount}`;
  }
  raf = requestAnimationFrame(frame);
}
let destroyed = false;
let raf = requestAnimationFrame(frame);

let loseExt: WEBGL_lose_context | null = null;
const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const pct = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};

(window as unknown as { __td: unknown }).__td = {
  ready: true,
  get simT() {
    return simT;
  },
  renderer,
  snap,
  taps,
  lostLog,
  /** Measures frame interval and renderer CPU time over `ms`. */
  async measure(ms = 4000) {
    frameTimes.length = 0;
    cpuTimes.length = 0;
    await new Promise((r) => setTimeout(r, ms));
    const st = renderer.stats();
    return {
      frames: frameTimes.length,
      meanFrameMs: mean(frameTimes),
      p95FrameMs: pct(frameTimes, 0.95),
      fps: 1000 / mean(frameTimes),
      meanUpdateMs: mean(cpuTimes),
      p95UpdateMs: pct(cpuTimes, 0.95),
      split: renderer.cpuTime(),
      calls: st.calls,
      triangles: st.triangles,
      enemies: snap.enemies.count,
      segments: snap.enemies.segTotal,
      towers: snap.towerCount,
      projectiles: snap.projectiles.count,
      quality: renderer.quality,
      pixelRatio: renderer.webgl?.getPixelRatio(),
    };
  },
  loseContext() {
    const gl = renderer.webgl?.getContext();
    loseExt = gl?.getExtension('WEBGL_lose_context') ?? null;
    loseExt?.loseContext();
  },
  restoreContext() {
    loseExt?.restoreContext();
  },
  project(x: number, y: number, h: number) {
    const o = { x: 0, y: 0 };
    const ok = renderer.project(x, y, h, o);
    return { ok, ...o };
  },
  pick(sx: number, sy: number) {
    return renderer.pickAt(sx, sy);
  },
  setPaused(p: boolean) {
    paused = p;
    if (p) renderer.pause();
    else renderer.resume();
  },
  setTheme(t: 'dark' | 'light') {
    renderer.setTheme(t);
    document.body.style.background = t === 'dark' ? '#1a0a18' : '#f6d8d2';
  },
  dispose() {
    destroyed = true;
    cancelAnimationFrame(raf);
    renderer.dispose();
    return document.querySelectorAll('canvas').length;
  },
};
