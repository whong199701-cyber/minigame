# mini-golf · 迷你高尔夫 · Mini Golf

**Category** action · **Icon** ⛳ · **Best metric** lowest 18-hole total; per-hole best.

## Mechanics
18 hand-designed holes (portrait, each defined in a normalised 10×16 coordinate space): wall polygons (axis-aligned
rectangles and a few diagonals), the start position, the cup, par, optional elements: bumpers (circles that bounce),
sand (high friction zone), water (ball resets to last position, +1 stroke), a moving block (sinusoidal) on later
holes, a ramp/booster arrow (accelerates). Ball stops when speed is tiny. The ball drops into the cup when the
centre passes within the cup radius at moderate speed (fast balls jump over). Max 8 strokes per hole (then +1
penalty and next hole).

## Controls
Drag from the ball backwards (slingshot): a dotted aim line shows direction and a power bar the strength; release
to putt; drag back onto the ball to cancel. Shots disabled while the ball is moving.

## Physics (logic.ts)
Fixed step; circle vs segment collisions with reflection (restitution 0.85) and overlap resolution; circle vs
circle for bumpers; friction per zone; cup capture; water/ramp zone effects.

## UI
- Canvas: green felt with a lighter fringe, walls as thick lines, sand beige, water blue, cup dark with a flag.
- HUD: hole x/18, strokes, par, total vs par. Hole transition with "Birdie/Par/Bogey" label + sound; final
  scorecard modal (18 holes in a grid, total, best). Persist current progress; "Restart round".

## Tests
Segment reflection, cup capture speed rule, zone effects, all 18 hole definitions valid (start & cup not inside
walls, cup reachable in a simple sanity test with straight-line clearance or a BFS over a coarse grid).
