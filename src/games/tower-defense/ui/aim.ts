/**
 * Drag-to-aim geometry for the Antibiotic Strike (§6.1), kept free of DOM access so it can be unit-tested.
 *
 * The crosshair is drawn AIM_LIFT px above the fingertip so the finger never hides the target. Whether a release
 * cancels is decided from the raw finger point, never from the lifted crosshair: a finger resting back on its button
 * (or anywhere on the bottom bar) would otherwise project onto the map 56 px higher and cast.
 */

export const AIM_LIFT = 56;
/** Extra slop (px) around the ability button that still counts as "back on the button". */
export const AIM_BUTTON_SLOP = 8;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AimGeometry {
  /** The bottom bar (ability buttons, wave button). */
  bar: Box;
  /** The ability button the drag started on. */
  button: Box;
  /** The map stage (canvas container). */
  stage: Box;
  /** Bottom edge of the HUD: a crosshair under it is not on the visible map. */
  hudBottom: number;
}

function inside(b: Box, x: number, y: number, slop = 0): boolean {
  return x >= b.left - slop && x <= b.right + slop && y >= b.top - slop && y <= b.bottom + slop;
}

/**
 * Screen point (client px) the lifted crosshair points at for a finger at (fx, fy), written into `out`; returns false
 * when releasing the finger there cancels the cast: the finger is back on the button, on the bottom bar, outside the
 * stage, or the lifted point would sit under the HUD.
 */
export function aimTarget(fx: number, fy: number, g: AimGeometry, out: { x: number; y: number }, lift = AIM_LIFT): boolean {
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return false;
  if (inside(g.button, fx, fy, AIM_BUTTON_SLOP)) return false;
  if (fy >= g.bar.top && fx >= g.bar.left && fx <= g.bar.right) return false;
  if (!inside(g.stage, fx, fy)) return false;
  const y = fy - lift;
  if (y <= g.hudBottom || y < g.stage.top) return false;
  out.x = fx;
  out.y = y;
  return true;
}
