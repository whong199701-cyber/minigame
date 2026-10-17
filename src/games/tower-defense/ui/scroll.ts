/**
 * Horizontal-scroller geometry for the build strip (§11.2), kept free of DOM access so it can be unit-tested.
 */

/**
 * The scrollLeft that brings a card fully into its horizontal scroller with the smallest move ("nearest"): a card cut
 * at the right edge is aligned to the right edge, one cut at the left edge to the left edge, a visible card stays put.
 * The card only ever grows toward the side it was cut on, so the point the finger just tapped stays on that card and a
 * second tap at the same spot hits it again (the "tap → Build ✓ → tap" confirm).
 */
export function revealScrollLeft(scrollLeft: number, boxLeft: number, boxRight: number, cardLeft: number, cardRight: number): number {
  if (!(boxRight > boxLeft) || !(cardRight > cardLeft)) return scrollLeft;
  if (cardRight - cardLeft >= boxRight - boxLeft) return scrollLeft + (cardLeft - boxLeft);
  if (cardLeft < boxLeft) return scrollLeft - (boxLeft - cardLeft);
  if (cardRight > boxRight) return scrollLeft + (cardRight - boxRight);
  return scrollLeft;
}

/** Scrolls `box` (only it — never its ancestors, unlike `scrollIntoView`) so `card` is fully visible. */
export function revealInScroller(box: HTMLElement, card: HTMLElement): void {
  const b = box.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const next = revealScrollLeft(box.scrollLeft, b.left, b.right, c.left, c.right);
  if (Math.abs(next - box.scrollLeft) >= 0.5) box.scrollLeft = next;
}
