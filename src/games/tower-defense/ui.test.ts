/**
 * Pure UI helpers: drag-to-aim cancel geometry (§6.1), badge ink contrast, saved-run wave label, and the renderer's
 * gesture recogniser (pinch → one-finger pan hand-over) driven with synthetic pointer events (no DOM needed).
 */
import { describe, expect, it } from 'vitest';
import { AIM_LIFT, aimTarget, type AimGeometry } from './ui/aim';
import { contrast, readableInk, savedNextWave, specColor, towerColor } from './ui/format';
import { GestureInput, TAP_SLOP } from './render/input';
import { TOWER_IDS, TOWER_SPECS } from './types';

/** 390 × 664 game screen as measured in the browser: HUD to 44 px, bottom bar from 543 px, Antibiotic button row 1. */
const GEO: AimGeometry = {
  bar: { left: 0, top: 543, right: 390, bottom: 664 },
  button: { left: 146, top: 552, right: 216, bottom: 600 },
  stage: { left: 0, top: 0, right: 390, bottom: 664 },
  hudBottom: 44,
};

describe('Antibiotic drag-to-aim (§6.1)', () => {
  const out = { x: NaN, y: NaN };

  it('points the crosshair AIM_LIFT px above a finger that is over the map', () => {
    expect(aimTarget(200, 400, GEO, out)).toBe(true);
    expect(out).toEqual({ x: 200, y: 400 - AIM_LIFT });
    // just above the bar: the lifted crosshair still lands on the map
    expect(aimTarget(180, 540, GEO, out)).toBe(true);
    expect(out.y).toBe(540 - AIM_LIFT);
  });

  it('releasing back on the button cancels, although the lifted point would be on the map', () => {
    // the reviewer's repro: finger resting on the button centre (≈ 576 px) projects to 520 px — on the map
    expect(576 - AIM_LIFT).toBeLessThan(GEO.bar.top);
    expect(aimTarget(181, 576, GEO, out)).toBe(false);
    expect(aimTarget(140, 560, GEO, out)).toBe(false); // within the button slop
  });

  it('releasing anywhere on the bottom bar, outside the stage or with the crosshair under the HUD cancels', () => {
    expect(aimTarget(40, 620, GEO, out)).toBe(false);
    expect(aimTarget(370, 545, GEO, out)).toBe(false);
    expect(aimTarget(-5, 300, GEO, out)).toBe(false);
    expect(aimTarget(200, 90, GEO, out)).toBe(false); // 90 − 56 = 34 < hud bottom
    expect(aimTarget(NaN, 300, GEO, out)).toBe(false);
  });
});

describe('colour coding', () => {
  it('every spec badge gets an ink with ≥ 4.5:1 contrast on its spec colour', () => {
    for (const id of TOWER_IDS.flatMap((t) => TOWER_SPECS[t])) {
      const bg = specColor(id);
      expect(contrast(bg, readableInk(bg)), id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('readableInk picks dark ink on light colours and white on dark ones; tower colours are #rrggbb', () => {
    expect(readableInk('#ffe066')).toBe('#1a0a18');
    expect(readableInk('#20103a')).toBe('#ffffff');
    for (const id of TOWER_IDS) expect(towerColor(id)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('saved run label', () => {
  it('names the wave the run continues with (after clearing 20 and going endless: 21)', () => {
    expect(savedNextWave({ state: { wave: 0 } })).toBe(1);
    expect(savedNextWave({ state: { wave: 5 } })).toBe(6);
    expect(savedNextWave({ state: { wave: 20 } })).toBe(21);
    expect(savedNextWave({ state: { wave: Number.NaN } })).toBe(1);
  });
});

// ── gesture recogniser with synthetic pointer events ────────────────────────

type Handler = (e: unknown) => void;

function fakeElement() {
  const handlers: Record<string, Handler> = {};
  return {
    handlers,
    addEventListener: (type: string, fn: Handler) => {
      handlers[type] = fn;
    },
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 700, width: 400, height: 700 }),
    setPointerCapture: () => {},
  };
}

function ptr(id: number, x: number, y: number) {
  return { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0, preventDefault: () => {} };
}

function setup() {
  const el = fakeElement();
  const log = { taps: 0, pan: [0, 0], pinch: 1 };
  const input = new GestureInput(el as unknown as HTMLElement, {
    tap: () => log.taps++,
    pan: (dx, dy) => {
      log.pan[0] += dx;
      log.pan[1] += dy;
    },
    pinch: (_x, _y, f) => (log.pinch *= f),
    locked: () => false,
    changed: () => {},
  });
  const h = el.handlers;
  return { input, log, down: (id: number, x: number, y: number) => h.pointerdown(ptr(id, x, y)), move: (id: number, x: number, y: number) => h.pointermove(ptr(id, x, y)), up: (id: number, x: number, y: number) => h.pointerup(ptr(id, x, y)) };
}

describe('gesture input', () => {
  it('a tap within the slop is a tap; a longer move pans instead', () => {
    const g = setup();
    g.down(1, 100, 100);
    g.move(1, 100 + TAP_SLOP - 2, 100);
    g.up(1, 100 + TAP_SLOP - 2, 100);
    expect(g.log.taps).toBe(1);
    g.down(2, 100, 100);
    g.move(2, 130, 100);
    g.up(2, 130, 100);
    expect(g.log.taps).toBe(1);
    expect(g.log.pan[0]).toBeCloseTo(30 - 0, 6);
  });

  it('after a pinch, lifting one finger continues as a one-finger pan without a jump (and never taps)', () => {
    const g = setup();
    g.down(1, 100, 300);
    g.down(2, 200, 300);
    g.move(2, 240, 300); // pinch out
    expect(g.log.pinch).toBeGreaterThan(1);
    const panAfterPinch = g.log.pan[0];
    g.up(2, 240, 300);
    g.move(1, 180, 300); // the remaining finger drags 80 px
    expect(g.log.pan[0] - panAfterPinch).toBeCloseTo(80, 6);
    g.up(1, 180, 300);
    expect(g.log.taps).toBe(0);
    // and the next gesture starts clean: a tap is a tap again
    g.down(3, 50, 50);
    g.up(3, 50, 50);
    expect(g.log.taps).toBe(1);
  });
});
