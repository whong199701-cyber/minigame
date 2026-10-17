/**
 * Picking (spec §11.8) with the real camera rig and tower models — pure three.js maths, no WebGL.
 *
 * QA round 2: the round-1 exception "a ray that reaches the empty path cell behind a tower picks the cell" also fired
 * on the upper half of tall towers (that cell's centre is hidden behind the model), so tapping an L3 tower's rings or
 * emblem opened the barrier strip on 9 of 11 Vessel pads. Now the model's body always wins; the path cell keeps the
 * strips of it that are actually visible beside / above the model.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CameraRig } from './render/camera';
import { buildMapInfo, type MapInfo } from './render/mapgeom';
import { buildTowerModel, variantOf } from './render/models';
import { BODY_PICK_RADIUS, pickTowerStage, rayCapsule, raySphere, towerBase, type TowerPick } from './render/pick';
import { silhouetteHeight } from './render/towers';
import { findMap } from './logic';
import { TOWER_IDS, TOWER_SPECS, WORLD, type MapDef, type SpecId, type TowerId, type TowerLevel, type TowerView } from './types';

/** The QA probe's pads: every Vessel row-2/5/8 pad has a vessel cell right behind it; (4,9) and (2,9) do not. */
const QA_PADS: [number, number][] = [[1, 2], [3, 2], [5, 2], [3, 5], [5, 5], [7, 5], [1, 8], [3, 8], [5, 8], [4, 9], [2, 9]];

function view(id: number, type: TowerId, level: TowerLevel, spec: SpecId | null, col: number, row: number): TowerView {
  return {
    id,
    type: TOWER_IDS.indexOf(type),
    typeId: type,
    level,
    spec,
    x: col + 0.5,
    y: row + 0.5,
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
    range: 3,
  } as TowerView;
}

const silCache = new Map<string, number>();
function silTop(tv: TowerView): number {
  const k = `${tv.typeId}:${tv.level}:${tv.spec}`;
  let h = silCache.get(k);
  if (h === undefined) {
    h = silhouetteHeight(buildTowerModel(tv.typeId, variantOf(tv.typeId, tv.level, tv.spec)));
    silCache.set(k, h);
  }
  return towerBase(tv) + h;
}

/** Mirrors `Renderer.pickAt` without the hero / enemies: tower stage, then pad disc, then path cell, then terrain. */
class Picker {
  readonly rig = new CameraRig();
  readonly info: MapInfo;
  private o = new Vector3();
  private d = new Vector3();
  private tmp = new Vector3();
  private out: TowerPick = { index: -1, path: -1 };
  constructor(
    readonly map: MapDef,
    public towers: TowerView[],
  ) {
    this.info = buildMapInfo(map);
    const rig = this.rig;
    rig.setViewport(390, 664);
    rig.setInsets(44, 121);
    rig.setMap(map.cols, map.rows);
    rig.setPads([...map.pads, ...map.villi]);
    rig.fit();
    rig.apply();
  }
  screen(x: number, h: number, y: number): { x: number; y: number } {
    const p = { x: 0, y: 0 };
    this.rig.projectWorld(x, h, y, p);
    return p;
  }
  pick(sx: number, sy: number): { kind: 'tower'; id: number } | { kind: 'path' | 'pad' | 'terrain'; col: number; row: number } {
    const { rig, info, towers, tmp } = this;
    this.o.copy(rig.camera.position);
    rig.rayDir(sx, sy, this.d);
    const trench = rig.floorAt(sx, sy, -WORLD.trenchDepth * 0.5, tmp) ? { x: tmp.x, z: tmp.z } : null;
    const tp = pickTowerStage(this.o, this.d, trench, info, towers, towers.length, silTop, this.out);
    if (tp.path >= 0) return { kind: 'path', col: tp.path % info.cols, row: Math.floor(tp.path / info.cols) };
    if (tp.index >= 0) return { kind: 'tower', id: towers[tp.index].id };
    if (rig.floorAt(sx, sy, WORLD.padHeight, tmp)) {
      let bd = Infinity;
      let bc = -1;
      let br = -1;
      for (const [c, r] of info.pads) {
        const dd = Math.hypot(tmp.x - c - 0.5, tmp.z - r - 0.5);
        if (dd < bd) [bd, bc, br] = [dd, c, r];
      }
      if (bd <= Math.max(WORLD.pickPadRadius, WORLD.pickSnap)) {
        const tw = towers.find((t) => Math.floor(t.x) === bc && Math.floor(t.y) === br);
        return tw ? { kind: 'tower', id: tw.id } : { kind: 'pad', col: bc, row: br };
      }
    }
    rig.floorAt(sx, sy, -WORLD.trenchDepth * 0.5, tmp);
    const c = Math.floor(tmp.x);
    const r = Math.floor(tmp.z);
    const path = c >= 0 && r >= 0 && c < info.cols && r < info.rows && info.pathMask[r * info.cols + c] !== 0;
    const onPath = path ? towers.find((t) => Math.floor(t.x) === c && Math.floor(t.y) === r) : undefined;
    if (onPath) return { kind: 'tower', id: onPath.id };
    return { kind: path ? 'path' : 'terrain', col: c, row: r };
  }
  /** Fraction of a path cell's floor (sampled n × n, projected) whose screen point picks that cell. */
  pathShare(col: number, row: number, n = 20): number {
    let hit = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p = this.screen(col + (i + 0.5) / n, -WORLD.trenchDepth, row + (j + 0.5) / n);
        const k = this.pick(p.x, p.y);
        if (k.kind === 'path' && k.col === col && k.row === row) hit++;
      }
    }
    return hit / (n * n);
  }
}

describe('ray proxies', () => {
  const o = { x: 0, y: 10, z: 0 };
  const down = { x: 0, y: -1, z: 0 };
  it('raySphere returns the entry distance or -1', () => {
    expect(raySphere(o, down, 0, 0, 0, 1)).toBeCloseTo(9);
    expect(raySphere(o, down, 2, 0, 0, 1)).toBe(-1);
  });
  it('rayCapsule hits within the radius of the axis segment only', () => {
    const side = { x: 1, y: 0, z: 0 };
    expect(rayCapsule({ x: -5, y: 0.5, z: 0.3 }, side, 0, 0, 1, 0, 0.45)).toBeGreaterThan(0);
    expect(rayCapsule({ x: -5, y: 0.5, z: 0.5 }, side, 0, 0, 1, 0, 0.45)).toBe(-1);
    // above the segment: only the hemispherical cap counts
    expect(rayCapsule({ x: -5, y: 1.4, z: 0 }, side, 0, 0, 1, 0, 0.45)).toBeGreaterThan(0);
    expect(rayCapsule({ x: -5, y: 1.5, z: 0 }, side, 0, 0, 1, 0, 0.45)).toBe(-1);
  });
  it('body radii never exceed the pick capsule', () => {
    for (const id of TOWER_IDS) expect(BODY_PICK_RADIUS[id]).toBeLessThanOrEqual(WORLD.pickTowerRadius);
  });
});

describe('tower picking vs the path cell behind (§11.8, QA round 2)', () => {
  const vessel = findMap('vessel');

  it('a tap anywhere on an L3 Perforin T-cell — base to emblem, on its axis or beside it — opens that tower on all 11 pads', () => {
    const towers = QA_PADS.map(([c, r], i) => view(i + 1, 'tcell', 3, 'perforin', c, r));
    const P = new Picker(vessel, towers);
    for (const tv of towers) {
      const top = silTop(tv);
      expect(top).toBeGreaterThan(1.4); // the floating spec emblem is part of the silhouette
      const hs: number[] = [];
      for (let h = 0.2; h <= top + 1e-6; h += 0.1) hs.push(h);
      for (const h of hs) {
        for (const dx of [0, -0.15, 0.15]) {
          const p = P.screen(tv.x + dx, h, tv.y);
          expect(P.pick(p.x, p.y), `(${tv.x - 0.5},${tv.y - 0.5}) h ${h.toFixed(1)} dx ${dx}`).toEqual({ kind: 'tower', id: tv.id });
        }
      }
    }
  });

  it('every tower type and level: the projected axis from 0.2 to the silhouette top picks the tower (pad (3,2), vessel behind)', () => {
    for (const type of TOWER_IDS) {
      if (type === 'barrier') continue;
      for (const [level, spec] of [[1, null], [2, null], [3, null], [3, 'a'], [3, 'b']] as const) {
        const sp: SpecId | null = spec === null ? null : TOWER_SPECS[type][spec === 'a' ? 0 : 1];
        const tv = view(1, type, level, sp, 3, 2);
        const P = new Picker(vessel, [tv]);
        for (let h = 0.2; h <= silTop(tv); h += 0.1) {
          const p = P.screen(tv.x, h, tv.y);
          expect(P.pick(p.x, p.y), `${type} L${level} ${sp} h ${h.toFixed(1)}`).toEqual({ kind: 'tower', id: 1 });
        }
      }
    }
  });

  it('the path cell behind a tall tower stays pickable on its visible strips (≥ 10 % of its screen area)', () => {
    for (const [type, spec] of [['tcell', 'perforin'], ['complement', 'longChain'], ['pyrogen', 'lowFever'], ['beacon', 'alarm']] as const) {
      const towers = QA_PADS.map(([c, r], i) => view(i + 1, type, 3, spec, c, r));
      const P = new Picker(vessel, towers);
      for (const [c, r] of QA_PADS) {
        if (!P.info.pathMask[(r - 1) * P.info.cols + c]) continue;
        expect(P.pathShare(c, r - 1), `${type} (${c},${r}) → path (${c},${r - 1})`).toBeGreaterThanOrEqual(0.1);
      }
    }
  });

  it('a short L1 tower in front leaves most of the path cell behind it pickable (it is drawn above the model)', () => {
    const towers = QA_PADS.map(([c, r], i) => view(i + 1, 'antibody', 1, null, c, r));
    const P = new Picker(vessel, towers);
    for (const [c, r] of QA_PADS) {
      if (!P.info.pathMask[(r - 1) * P.info.cols + c]) continue;
      expect(P.pathShare(c, r - 1), `(${c},${r - 1})`).toBeGreaterThanOrEqual(0.55);
      // the far half of the cell is above the model on screen
      const p = P.screen(c + 0.5, -WORLD.trenchDepth, r - 0.75);
      expect(P.pick(p.x, p.y), `(${c},${r - 1}) far half`).toEqual({ kind: 'path', col: c, row: r - 1 });
    }
  });

  it('pads without a vessel behind them are fully pickable, and an occupied path cell never steals the tap', () => {
    const t1 = view(1, 'tcell', 3, 'apoptosis', 4, 9);
    const t2 = view(2, 'tcell', 3, 'apoptosis', 3, 2);
    const barrier = view(3, 'barrier', 1, null, 3, 1);
    const P = new Picker(vessel, [t1, t2, barrier]);
    for (const tv of [t1, t2]) {
      for (let h = 0.2; h <= silTop(tv); h += 0.1) {
        const p = P.screen(tv.x, h, tv.y);
        expect(P.pick(p.x, p.y)).toEqual({ kind: 'tower', id: tv.id });
      }
    }
    // with a barrier on (3,1) no sample of that cell opens a build strip
    expect(P.pathShare(3, 1)).toBe(0);
  });
});
