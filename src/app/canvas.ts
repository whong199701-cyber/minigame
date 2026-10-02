/** Helpers for responsive, high-DPI canvases and touch input. */

export interface CanvasHandle {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** CSS pixel size (already accounts for DPR in ctx transform). */
  width: number;
  height: number;
  dpr: number;
  /** Force a re-measure (e.g. after changing container layout). */
  resize(): void;
  destroy(): void;
}

/**
 * Creates a canvas that fills `container` (respecting its CSS size), scales for devicePixelRatio and
 * calls `onResize` whenever the size changes. Draw in CSS pixels; the context is pre-scaled.
 */
export function createCanvas(
  container: HTMLElement,
  onResize?: (w: number, h: number) => void,
  opts: { maxDpr?: number; className?: string } = {},
): CanvasHandle {
  const canvas = document.createElement('canvas');
  canvas.className = opts.className ?? 'game-canvas';
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  const handle: CanvasHandle = {
    canvas,
    ctx,
    width: 0,
    height: 0,
    dpr: 1,
    resize() {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(opts.maxDpr ?? 2, window.devicePixelRatio || 1);
      if (w === handle.width && h === handle.height && dpr === handle.dpr) return;
      handle.width = w;
      handle.height = h;
      handle.dpr = dpr;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      onResize?.(w, h);
    },
    destroy() {
      ro.disconnect();
      canvas.remove();
    },
  };
  const ro = new ResizeObserver(() => handle.resize());
  ro.observe(container);
  handle.resize();
  return handle;
}

/** requestAnimationFrame loop with delta time (seconds, clamped) and pause support. */
export function createLoop(update: (dt: number, now: number) => void): { start(): void; stop(): void; running: boolean } {
  let raf = 0;
  let last = 0;
  const loop = {
    running: false,
    start() {
      if (loop.running) return;
      loop.running = true;
      last = performance.now();
      const frame = (now: number) => {
        if (!loop.running) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        update(dt, now);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    },
    stop() {
      loop.running = false;
      cancelAnimationFrame(raf);
    },
  };
  return loop;
}

export interface PointerInfo {
  x: number;
  y: number;
  id: number;
  /** Original event (for preventDefault etc.). */
  event: PointerEvent;
}

export interface PointerHandlers {
  down?(p: PointerInfo): void;
  move?(p: PointerInfo): void;
  up?(p: PointerInfo): void;
  cancel?(p: PointerInfo): void;
}

/** Unified pointer (touch + mouse) events in element-local CSS pixel coordinates. Returns a remover. */
export function onPointer(target: HTMLElement, handlers: PointerHandlers): () => void {
  const toInfo = (e: PointerEvent): PointerInfo => {
    const r = target.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId, event: e };
  };
  const down = (e: PointerEvent) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    target.setPointerCapture?.(e.pointerId);
    handlers.down?.(toInfo(e));
  };
  const move = (e: PointerEvent) => handlers.move?.(toInfo(e));
  const up = (e: PointerEvent) => handlers.up?.(toInfo(e));
  const cancel = (e: PointerEvent) => (handlers.cancel ?? handlers.up)?.(toInfo(e));
  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', cancel);
  target.style.touchAction = 'none';
  return () => {
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', cancel);
  };
}

export type SwipeDir = 'left' | 'right' | 'up' | 'down';

/** Detect swipes (and taps) on an element. Returns a remover. */
export function onSwipe(
  target: HTMLElement,
  handlers: { swipe?(dir: SwipeDir): void; tap?(x: number, y: number): void },
  threshold = 24,
): () => void {
  let sx = 0;
  let sy = 0;
  let active = false;
  let fired = false;
  return onPointer(target, {
    down(p) {
      sx = p.x;
      sy = p.y;
      active = true;
      fired = false;
    },
    move(p) {
      if (!active || fired) return;
      const dx = p.x - sx;
      const dy = p.y - sy;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      fired = true;
      if (Math.abs(dx) > Math.abs(dy)) handlers.swipe?.(dx > 0 ? 'right' : 'left');
      else handlers.swipe?.(dy > 0 ? 'down' : 'up');
    },
    up(p) {
      if (active && !fired) handlers.tap?.(p.x, p.y);
      active = false;
    },
  });
}

/** Seeded PRNG (mulberry32) for reproducible puzzles / daily seeds. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Draw a rounded rectangle path (caller fills/strokes). */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
