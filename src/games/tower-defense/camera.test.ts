/**
 * Camera maths (spec §11.8), pure three.js math — no WebGL. At phone width (390 px), zoom 1 and the default framing:
 * the farthest visible pad row's pick disc projects to ≥ CAMERA.minFarPadPx, and every pad ring is fully on screen
 * (yaw + perspective used to push the near-left edge pads of Gut / Brain half off-screen, where horizontal pan is
 * clamped). Zoom and pan stay clamped.
 */
import { describe, expect, it } from 'vitest';
import { CameraRig } from './render/camera';
import { findMap } from './logic';
import { CAMERA, MAP_IDS, WORLD, type MapDef } from './types';

/** Typical game-screen layouts: iPhone portrait (two stage heights), landscape phone, tablet. */
const LAYOUTS = [
  { w: 390, h: 664, top: 44, bottom: 121, name: 'phone 390×664' },
  { w: 390, h: 760, top: 44, bottom: 121, name: 'phone 390×760' },
  { w: 820, h: 1130, top: 44, bottom: 121, name: 'tablet 820×1130' },
];

function rigFor(map: MapDef, w: number, h: number, top: number, bottom: number): CameraRig {
  const rig = new CameraRig();
  rig.setViewport(w, h);
  rig.setInsets(top, bottom);
  rig.setMap(map.cols, map.rows);
  rig.setPads([...map.pads, ...map.villi]);
  rig.fit();
  return rig;
}

function pads(map: MapDef): (readonly [number, number])[] {
  return [...map.pads, ...map.villi];
}

describe('camera framing (§11.8)', () => {
  for (const L of LAYOUTS.slice(0, 2)) {
    it(`${L.name}: the farthest visible pad row's pick disc is ≥ ${CAMERA.minFarPadPx} px wide on every map`, () => {
      for (const id of MAP_IDS) {
        const map = findMap(id);
        const rig = rigFor(map, L.w, L.h, L.top, L.bottom);
        const pt = { x: 0, y: 0 };
        let far = Infinity;
        for (const [c, r] of pads(map)) {
          rig.projectWorld(c + 0.5, WORLD.padHeight, r + 0.5, pt);
          if (pt.y >= L.top && pt.y <= L.h - L.bottom) far = Math.min(far, r);
        }
        expect(Number.isFinite(far), id).toBe(true);
        for (const [c, r] of pads(map)) {
          if (r !== far) continue;
          rig.projectWorld(c + 0.5 - WORLD.pickPadRadius, WORLD.padHeight, r + 0.5, pt);
          const l = pt.x;
          rig.projectWorld(c + 0.5 + WORLD.pickPadRadius, WORLD.padHeight, r + 0.5, pt);
          expect(pt.x - l, `${id} pad (${c},${r})`).toBeGreaterThanOrEqual(CAMERA.minFarPadPx);
        }
      }
    });
  }

  for (const L of LAYOUTS) {
    it(`${L.name}: every pad ring is fully on screen horizontally at zoom 1 (edge pads Gut (0,12), Brain (0,13) included)`, () => {
      for (const id of MAP_IDS) {
        const map = findMap(id);
        const rig = rigFor(map, L.w, L.h, L.top, L.bottom);
        const pt = { x: 0, y: 0 };
        for (const [c, r] of pads(map)) {
          rig.projectWorld(c + 0.5 - 0.43, WORLD.padHeight, r + 0.5, pt);
          expect(pt.x, `${id} pad (${c},${r}) left rim`).toBeGreaterThanOrEqual(0);
          rig.projectWorld(c + 0.5 + 0.43, WORLD.padHeight, r + 0.5, pt);
          expect(pt.x, `${id} pad (${c},${r}) right rim`).toBeLessThanOrEqual(L.w);
        }
      }
    });
  }

  it('the default framing survives the clamp, and zoom stays within [minZoom, maxZoom]', () => {
    for (const id of MAP_IDS) {
      const map = findMap(id);
      const rig = rigFor(map, 390, 664, 44, 121);
      const x = rig.target.x;
      const z = rig.target.z;
      rig.clampTarget();
      expect(rig.target.x, id).toBeCloseTo(x, 6);
      expect(rig.target.z, id).toBeCloseTo(z, 6);
      rig.zoomAt(195, 300, 10);
      expect(rig.zoom).toBe(CAMERA.maxZoom);
      rig.zoomAt(195, 300, 0.01);
      expect(rig.zoom).toBe(CAMERA.minZoom);
      // a huge pan never drags the map out of view: the target stays near the map
      rig.panBy(5000, 5000);
      expect(rig.target.x).toBeGreaterThan(-2);
      expect(rig.target.x).toBeLessThan(map.cols + 2);
      rig.panBy(-5000, -5000);
      expect(rig.target.z).toBeGreaterThan(-3);
      expect(rig.target.z).toBeLessThan(map.rows + 3);
    }
  });
});
