# netwalk · 旋转回路 · Circuit Rotate

**Category** logic · **Icon** 🔌 · **Best metric** fastest time per size; fewest rotations.

## Mechanics
A grid of tiles, each with 1–4 connectors (straight, corner, T, end, cross). One tile is the power source (centre).
Tap a tile to rotate it 90° clockwise. Tiles connected to the source light up. Win when every tile is powered and
no connector points at nothing (every connection is mutual).

## Sizes / difficulty
easy 5×5 · medium 7×7 · hard 9×9 · expert 11×11 with wrap-around edges (connections wrap across borders).

## Generation (logic.ts)
Random spanning tree over the grid (randomised Prim or DFS) rooted at the source; connectors derive from tree
edges; then randomly rotate every tile (ensure at least ~60% of tiles are not already correct). Store the original
orientation to compute the minimal rotations ("par" = sum over tiles of minimal cw rotations, accounting for
symmetric tiles: straight has period 2, cross period 1).

## UI
- Canvas; tiles drawn as pipes/wires; powered wires in accent colour with glow, unpowered in muted; source tile
  highlighted; end tiles drawn as small "computers" that light up when powered.
- Tap rotates with a quick 90° animation; `move` sound; recompute power via BFS from the source each change.
- Lock feature: long-press toggles a lock on a tile (greyed, cannot rotate) — a standard quality-of-life feature.
- HUD: rotations / par, powered x/y, timer. Win modal with time, rotations vs par, new best. Restart & new puzzle.

## Tests
Spanning tree covers all tiles, tile connector derivation, rotation math, BFS powering, win detection, par
computation respects symmetry, wrap mode adjacency.
