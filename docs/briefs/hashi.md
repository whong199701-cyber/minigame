# hashi · 连桥 · Bridges

**Category** logic · **Icon** 🌉 · **Best metric** fastest time per size.

## Mechanics
Islands (circles with a number 1–8) on a grid. Connect islands with horizontal or vertical bridges: at most 2
bridges between a pair, bridges cannot cross other bridges or islands, each island's bridge count must equal its
number, and all islands must form one connected group.

## Sizes
easy 7×7 (~10 islands) · medium 10×10 (~20) · hard 13×13 (~35).

## Generation (logic.ts)
Grow a random connected solution: start with one island; repeatedly pick a random existing island and a random
direction, walk 2–5 cells to a free cell whose row/column path is clear (no island, no bridge crossing), create a
new island there and connect with 1 or 2 bridges. After placing all islands, add extra bridges between already
aligned pairs with clear paths (random) to create cycles. Numbers = degrees. Any valid player solution is accepted
(check rules, not equality with the hidden solution).

## UI
- Canvas; islands as circles with the number; satisfied islands tinted success, over-connected tinted danger.
- Interaction: drag from an island toward another aligned island (release anywhere past the midpoint) to add a
  bridge; repeating cycles 1 → 2 → 0. Also support tap-island-then-tap-island. Bridges drawn as 1 or 2 parallel lines.
- Attempting a crossing bridge → `error` sound.
- HUD: islands satisfied x/y, timer; header actions: undo, restart, new puzzle. Automatic win detection.

## Tests
Path-clearance / crossing detection, degree counting, connectivity check, generated solutions satisfy all rules.
