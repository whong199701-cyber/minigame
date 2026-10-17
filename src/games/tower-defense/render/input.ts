/**
 * Touch / mouse gestures on the renderer's top canvas: a tap (no move beyond 8 px slop) is reported as a tap, one
 * finger drags pan, two fingers pinch-zoom around their midpoint (and pan with it), the mouse wheel zooms. Pointer
 * slots are preallocated; coordinates are CSS px relative to the element.
 */
export interface GestureHandlers {
  tap(sx: number, sy: number): void;
  pan(dx: number, dy: number): void;
  pinch(sx: number, sy: number, factor: number): void;
  /** Pan / zoom disabled (e.g. ability aiming); taps still fire. */
  locked(): boolean;
  /** Something visual changed (request a redraw). */
  changed(): void;
}

export const TAP_SLOP = 8;

export class GestureInput {
  private ids = [-1, -1];
  private x = [0, 0];
  private y = [0, 0];
  private sx = 0;
  private sy = 0;
  private dragging = false;
  private multi = false;
  private pinchDist = 0;
  private midX = 0;
  private midY = 0;
  private rectL = 0;
  private rectT = 0;
  enabled = true;

  constructor(
    private el: HTMLElement,
    private h: GestureHandlers,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('lostpointercapture', this.onCancel);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContext);
  }

  private count(): number {
    return (this.ids[0] >= 0 ? 1 : 0) + (this.ids[1] >= 0 ? 1 : 0);
  }

  private local(e: PointerEvent | WheelEvent, i: number): void {
    this.x[i] = e.clientX - this.rectL;
    this.y[i] = e.clientY - this.rectT;
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const slot = this.ids[0] < 0 ? 0 : this.ids[1] < 0 ? 1 : -1;
    if (slot < 0) return;
    if (this.count() === 0) {
      const r = this.el.getBoundingClientRect();
      this.rectL = r.left;
      this.rectT = r.top;
    }
    this.ids[slot] = e.pointerId;
    this.local(e, slot);
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    if (this.count() === 1) {
      this.sx = this.x[slot];
      this.sy = this.y[slot];
      this.dragging = false;
      this.multi = false;
    } else {
      this.multi = true;
      this.pinchDist = Math.hypot(this.x[0] - this.x[1], this.y[0] - this.y[1]);
      this.midX = (this.x[0] + this.x[1]) / 2;
      this.midY = (this.y[0] + this.y[1]) / 2;
    }
    e.preventDefault();
  };

  private onMove = (e: PointerEvent): void => {
    const slot = this.ids[0] === e.pointerId ? 0 : this.ids[1] === e.pointerId ? 1 : -1;
    if (slot < 0) return;
    const px = this.x[slot];
    const py = this.y[slot];
    this.local(e, slot);
    const locked = this.h.locked();
    if (this.count() === 2) {
      const d = Math.hypot(this.x[0] - this.x[1], this.y[0] - this.y[1]);
      const mx = (this.x[0] + this.x[1]) / 2;
      const my = (this.y[0] + this.y[1]) / 2;
      if (!locked) {
        if (this.pinchDist > 10 && d > 10) this.h.pinch(mx, my, d / this.pinchDist);
        this.h.pan(mx - this.midX, my - this.midY);
        this.h.changed();
      }
      this.pinchDist = d;
      this.midX = mx;
      this.midY = my;
      return;
    }
    if (!this.dragging && Math.hypot(this.x[slot] - this.sx, this.y[slot] - this.sy) > TAP_SLOP) this.dragging = true;
    if (this.dragging && !this.multi && !locked) {
      this.h.pan(this.x[slot] - px, this.y[slot] - py);
      this.h.changed();
    }
  };

  private release(e: PointerEvent, cancelled: boolean): void {
    const slot = this.ids[0] === e.pointerId ? 0 : this.ids[1] === e.pointerId ? 1 : -1;
    if (slot < 0) return;
    const wasSingle = this.count() === 1 && !this.multi;
    this.local(e, slot);
    this.ids[slot] = -1;
    if (!cancelled && wasSingle && !this.dragging) this.h.tap(this.x[slot], this.y[slot]);
    if (this.count() === 1) {
      // continue as a one-finger drag from the remaining pointer without a jump (never a tap: it already moved)
      const other = slot === 0 ? 1 : 0;
      this.sx = this.x[other];
      this.sy = this.y[other];
      this.dragging = true;
      this.multi = false;
    } else if (this.count() === 0) {
      this.dragging = false;
      this.multi = false;
    }
  }

  private onUp = (e: PointerEvent): void => this.release(e, false);
  private onCancel = (e: PointerEvent): void => this.release(e, true);

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled || this.h.locked()) return;
    e.preventDefault();
    const r = this.el.getBoundingClientRect();
    this.h.pinch(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    this.h.changed();
  };

  private onContext = (e: Event): void => e.preventDefault();

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('lostpointercapture', this.onCancel);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContext);
  }
}
