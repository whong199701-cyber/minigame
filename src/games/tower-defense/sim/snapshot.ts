/**
 * Render snapshot (§11.5): preallocated struct-of-arrays filled once per frame, allocation-free.
 */
import type { Enemy, EnemyId, GameState, MapDef, RenderSnapshot, Tower, TowerId, TowerView } from '../types';
import { ENEMY_IDS, EnemyViewFlag, SNAPSHOT_CAPACITY, TOWER_IDS, TOWER_SPECS } from '../types';
import { BOSS_SKILLS, ENEMIES, HERO_LEVELS, SLOW_CAP, TOWERS } from './data';
import { posOnPath, segAngle, type PathPos } from './maps';
import { info, isMarked } from './state';
import { levelStats } from './towers';

const enemyIndex = new Map<EnemyId, number>(ENEMY_IDS.map((id, i) => [id, i]));
/**
 * Doubles read in the per-enemy loop live in module-local storage: a megamorphic load of a double field
 * (`ENEMIES[e.type].slowResist`, every EnemyDef has its own shape) or an imported binding that a module loader turns
 * into a property read (vitest's SSR transform) makes V8 box a fresh HeapNumber per read — per slowed enemy per frame
 * (perf.test.ts).
 */
const slowResist = Float64Array.from(ENEMY_IDS, (id) => ENEMIES[id].slowResist);
const SLOW_MAX: number = SLOW_CAP;
/** Tower stat rows (TowerLevelStats literals, many shapes) flattened per (type, level / spec): index = type × 5 + row. */
const STAT_ROWS = 5;
const statRange = new Float64Array(TOWER_IDS.length * STAT_ROWS);
const statEngulfCd = new Float64Array(TOWER_IDS.length * STAT_ROWS);
const statCureEvery = new Float64Array(TOWER_IDS.length * STAT_ROWS);
TOWER_IDS.forEach((type, ti) => {
  const rows = [levelStats(type, 1, null), levelStats(type, 2, null), levelStats(type, 3, null), ...TOWER_SPECS[type].map((sp) => levelStats(type, 3, sp))];
  rows.forEach((st, r) => {
    statRange[ti * STAT_ROWS + r] = st.range;
    statEngulfCd[ti * STAT_ROWS + r] = st.engulfCooldown ?? 7;
    statCureEvery[ti * STAT_ROWS + r] = st.cureEvery ?? 2;
  });
});

function statRow(typeIndex: number, t: Tower): number {
  let r = t.level - 1;
  if (t.level === 3 && t.spec !== null) {
    const k = TOWER_SPECS[t.type].indexOf(t.spec);
    if (k >= 0) r = 3 + k;
  }
  return typeIndex * STAT_ROWS + r;
}
const towerIndex = new Map<TowerId, number>(TOWER_IDS.map((id, i) => [id, i]));

function newTowerView(): TowerView {
  return {
    id: 0,
    type: 0,
    typeId: 'antibody',
    level: 1,
    spec: null,
    x: 0,
    y: 0,
    angle: 0,
    lastShotAt: -1,
    infected: false,
    immune: false,
    charge: 0,
    digesting: false,
    hpFrac: 1,
    onVilli: false,
    buffed: false,
    selected: false,
    range: 0,
  };
}

/**
 * Allocates a snapshot (SNAPSHOT_CAPACITY unless overridden). The parameter is wider than the `ImmuneLogic`
 * signature (`Partial<typeof SNAPSHOT_CAPACITY>` only admits the literal defaults) so tests can shrink it.
 */
export function createSnapshot(map: MapDef, capacity?: Partial<Record<keyof typeof SNAPSHOT_CAPACITY, number>>): RenderSnapshot {
  void map;
  const ec = capacity?.enemies ?? SNAPSHOT_CAPACITY.enemies;
  const sc = capacity?.segments ?? SNAPSHOT_CAPACITY.segments;
  const pc = capacity?.projectiles ?? SNAPSHOT_CAPACITY.projectiles;
  const tc = capacity?.towers ?? SNAPSHOT_CAPACITY.towers;
  const towers: TowerView[] = [];
  for (let i = 0; i < tc; i++) towers.push(newTowerView());
  return {
    time: 0,
    alpha: 0,
    phase: 'build',
    wave: 0,
    enemies: {
      capacity: ec,
      count: 0,
      id: new Int32Array(ec),
      type: new Uint8Array(ec),
      x: new Float32Array(ec),
      y: new Float32Array(ec),
      angle: new Float32Array(ec),
      hpFrac: new Float32Array(ec),
      radius: new Float32Array(ec),
      flags: new Uint16Array(ec),
      markStacks: new Uint8Array(ec),
      slow: new Float32Array(ec),
      immuneTo: new Uint8Array(ec),
      telegraph: new Float32Array(ec),
      segStart: new Int32Array(ec),
      segCount: new Uint8Array(ec),
      segCapacity: sc,
      segTotal: 0,
      segX: new Float32Array(sc),
      segY: new Float32Array(sc),
      segAngle: new Float32Array(sc),
    },
    towers,
    towerCount: 0,
    projectiles: {
      capacity: pc,
      count: 0,
      kind: new Uint8Array(pc),
      x: new Float32Array(pc),
      y: new Float32Array(pc),
      h: new Float32Array(pc),
      angle: new Float32Array(pc),
    },
    hero: {
      x: 0,
      y: 0,
      angle: 0,
      hpFrac: 1,
      level: 1,
      xpFrac: 0,
      alive: true,
      respawnFrac: 0,
      moving: false,
      attacking: false,
      destX: NaN,
      destY: NaN,
      curing: false,
    },
    flow: { breathing: false, reversed: false, warn: false, fever: false, adrenaline: false },
    selection: null,
    interaction: 'none',
    cursorX: NaN,
    cursorY: NaN,
  };
}

const pos: PathPos = { x: 0, y: 0, seg: 0 };

/**
 * Fills `out` from the state; `alpha` ∈ [0, 1] lerps prev → cur positions. Never writes the UI-owned fields
 * (`selection`, `interaction`, `cursorX/Y`); `TowerView.selected` is derived from the current `out.selection`.
 */
export function snapshot(s: GameState, out: RenderSnapshot, alpha: number): void {
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  const now = s.time;
  out.time = now;
  out.alpha = a;
  out.phase = s.phase;
  out.wave = s.wave;
  // Enemies.
  const ev = out.enemies;
  const list = s.enemies;
  let n = 0;
  let segTotal = 0;
  for (let i = 0; i < list.length && n < ev.capacity; i++) {
    const e = list[i];
    if (e.dead || e.leaked) continue;
    const g = s.geoms[e.pathIndex];
    ev.id[n] = e.id;
    const ti = enemyIndex.get(e.type) ?? 0;
    ev.type[n] = ti;
    ev.x[n] = e.px + (e.x - e.px) * a;
    ev.y[n] = e.py + (e.y - e.py) * a;
    ev.angle[n] = segAngle(g, e.seg);
    ev.hpFrac[n] = e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 0;
    ev.radius[n] = e.radius;
    const b = e.boss;
    let f = 0;
    if (e.flying) f |= EnemyViewFlag.Flying;
    if (e.stealth) f |= EnemyViewFlag.Stealth;
    if (e.revealed) f |= EnemyViewFlag.Revealed;
    if (b !== null) f |= EnemyViewFlag.Boss;
    if (e.spawned) f |= EnemyViewFlag.Spawned;
    if (e.stunUntil > now) f |= EnemyViewFlag.Stunned;
    if (b !== null && b.burrowedUntil > now) f |= EnemyViewFlag.Burrowed;
    if (b !== null && b.charging) f |= EnemyViewFlag.Charging;
    if (e.attacking !== null) f |= EnemyViewFlag.Attacking;
    if (b !== null && b.hardenedUntil > now) f |= EnemyViewFlag.Hardened;
    if (e.dots.length) f |= EnemyViewFlag.Burning;
    if (isMarked(e, now)) {
      f |= EnemyViewFlag.Marked;
      if (e.mark.strong) f |= EnemyViewFlag.StrongMark;
    }
    if (e.divided) f |= EnemyViewFlag.Divided;
    ev.flags[n] = f;
    ev.markStacks[n] = e.mark.until > now ? e.mark.stacks : 0;
    writeSlow(e, ti, now, ev.slow, n);
    ev.immuneTo[n] = b !== null && b.immuneTo !== null && b.immuneUntil > now ? (towerIndex.get(b.immuneTo) ?? 0) + 1 : 0;
    let tele = 0;
    if (b !== null) {
      const defs = BOSS_SKILLS[e.type as 'superbug'];
      for (let k = 0; k < b.skills.length; k++) {
        const ks = b.skills[k];
        if (ks.telegraphUntil > now) {
          const len = defs?.[k]?.telegraph ?? 1;
          tele = Math.max(tele, len > 0 ? 1 - (ks.telegraphUntil - now) / len : 1);
        }
      }
    }
    ev.telegraph[n] = tele;
    // Parasite segments (rigid body: every segment moved by the same delta as the tail).
    const segs = e.segments;
    ev.segStart[n] = segTotal;
    let sc = 0;
    if (segs.length) {
      const delta = segs[segs.length - 1] - e.pdist;
      let hint = e.seg;
      for (let k = 0; k < segs.length && segTotal < ev.segCapacity; k++) {
        const d = segs[k] - delta * (1 - a);
        hint = posOnPath(g, d, hint, pos);
        ev.segX[segTotal] = pos.x;
        ev.segY[segTotal] = pos.y;
        ev.segAngle[segTotal] = segAngle(g, hint);
        segTotal++;
        sc++;
      }
    }
    ev.segCount[n] = sc;
    n++;
  }
  ev.count = n;
  ev.segTotal = segTotal;
  // Towers.
  const tl = s.towers;
  let tn = 0;
  const sel = out.selection;
  const fever = s.abilities.fever.activeUntil > now;
  const adren = s.abilities.adrenaline.activeUntil > now;
  for (let i = 0; i < tl.length && tn < out.towers.length; i++) {
    const t = tl[i];
    const v = out.towers[tn++];
    const tix = towerIndex.get(t.type) ?? 0;
    const row = statRow(tix, t);
    v.id = t.id;
    v.type = tix;
    v.typeId = t.type;
    v.level = t.level;
    v.spec = t.spec;
    v.x = t.x;
    v.y = t.y;
    v.angle = t.angle;
    v.lastShotAt = t.lastShotAt;
    v.infected = t.infectedUntil > now;
    v.immune = t.immuneUntil > now; // hero-cure immunity (shield glyph); beacon immunity is implied by the beacon
    let charge = 1;
    if (t.type === 'macrophage') {
      const cd = statEngulfCd[row];
      charge = cd > 0 ? Math.max(0, Math.min(1, 1 - (t.engulfReadyAt - now) / cd)) : 1;
    } else if (t.type === 'beacon') {
      const cd = statCureEvery[row];
      charge = cd > 0 ? Math.max(0, Math.min(1, 1 - (t.cureAt - now) / cd)) : 1;
    }
    v.charge = charge;
    v.digesting = t.digestingUntil > now;
    v.hpFrac = t.type === 'barrier' && t.maxHp > 0 ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : 1;
    v.onVilli = t.onVilli;
    v.buffed = t.buff.rate > 1.0001 || t.buff.dmg > 1.0001;
    v.selected = sel !== null && sel.kind === 'tower' && sel.id === t.id;
    v.range = TOWERS[t.type].onPath ? 0 : statRange[row] + t.buff.range;
  }
  out.towerCount = tn;
  // Projectiles.
  const pv = out.projectiles;
  const pl = s.projectiles;
  let pn = 0;
  for (let i = 0; i < pl.length && pn < pv.capacity; i++) {
    const p = pl[i];
    if (p.done) continue;
    pv.kind[pn] = towerIndex.get(p.kind) ?? 0;
    pv.x[pn] = p.px + (p.x - p.px) * a;
    pv.y[pn] = p.py + (p.y - p.py) * a;
    pv.h[pn] = p.arc ? 4 * p.arcHeight * p.t * (1 - p.t) : 0.35;
    pv.angle[pn] = Math.atan2(p.ty - p.y, p.tx - p.x);
    pn++;
  }
  pv.count = pn;
  // Hero.
  const h = s.hero;
  const hv = out.hero;
  if (h.alive) {
    hv.x = h.px + (h.x - h.px) * a;
    hv.y = h.py + (h.y - h.py) * a;
  } else {
    // a dead hero is drawn as the respawn arc at his post (§6), where he will reappear
    const mi = info(s);
    hv.x = mi.heroX;
    hv.y = mi.heroY;
  }
  hv.angle = h.angle;
  hv.hpFrac = h.maxHp > 0 ? Math.max(0, Math.min(1, h.hp / h.maxHp)) : 0;
  hv.level = h.level;
  const lo = h.level > 1 ? (HERO_LEVELS[h.level - 2].xpToNext ?? 0) : 0;
  const hi = HERO_LEVELS[h.level - 1].xpToNext;
  hv.xpFrac = hi === undefined ? 1 : Math.max(0, Math.min(1, (h.xp - lo) / (hi - lo)));
  hv.alive = h.alive;
  const resp = s.memory.heroRespawn;
  hv.respawnFrac = h.alive ? 0 : resp > 0 ? Math.max(0, Math.min(1, 1 - (h.respawnAt - now) / resp)) : 1;
  hv.moving = h.dest !== null;
  hv.attacking = h.targetId !== null;
  hv.destX = h.dest !== null ? h.dest.x : NaN;
  hv.destY = h.dest !== null ? h.dest.y : NaN;
  let curing = false;
  if (h.alive) {
    const r = s.memory.heroCureRadius;
    for (let i = 0; i < tl.length && !curing; i++) {
      const t = tl[i];
      const dx = t.x - h.x;
      const dy = t.y - h.y;
      if (t.immuneUntil > now && dx * dx + dy * dy <= r * r) curing = true;
    }
  }
  hv.curing = curing;
  // Flow.
  const fv = out.flow;
  fv.breathing = s.flow.breathing;
  fv.reversed = s.flow.reversed;
  fv.warn = s.flow.warn;
  fv.fever = fever;
  fv.adrenaline = adren;
}

/** Read-only tower slow fraction (same formula as the simulation, without pruning the state), into `outArr[n]`. */
function writeSlow(e: Enemy, typeIndex: number, now: number, outArr: Float32Array, n: number): void {
  const list = e.slows;
  if (!list.length) {
    outArr[n] = 0;
    return;
  }
  let total = 0;
  for (let i = 0; i < list.length; i++) if (list[i].until > now) total += list[i].amount;
  total *= 1 - slowResist[typeIndex];
  outArr[n] = total < SLOW_MAX ? total : SLOW_MAX;
}
