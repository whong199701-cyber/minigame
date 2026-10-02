# water-sort · 倒水排序 · Water Sort

**Category** logic · **Icon** 🧪 · **Best metric** highest level reached; fewest moves per level.

## Mechanics
Tubes hold up to 4 units of coloured liquid. Pour from one tube to another when the destination is empty or its
top colour matches; pour moves all consecutive top units of that colour that fit. Win when every tube is either
empty or full of one colour.

## Levels
Endless numbered levels generated from `seededRandom(level)`. Colour count grows: L1–3: 3 colours, 4–8: 4,
9–15: 5, 16–25: 6, 26–40: 7, 41–60: 8, 61–90: 9, 91+: 10–12 colours. Empty tubes: 2 (1 empty on every 10th level
as a "challenge"). Guarantee solvability: generate the mixed state and verify with a solver (DFS/BFS with
state hashing and pruning, iterative deepening on moves) within a time cap; if unsolvable or trivial, retry the
seed with an offset. Store the solver's move count as "par". Also provide a hint (next move from the solver).

## UI
- DOM or canvas; tubes arranged in up to 2–3 rows to fit 390px width (tube width ~44px, height ~150px). Tap a tube
  to lift/select (animate up), tap target to pour (animate the liquid, ~200 ms), tap the same tube to deselect.
  Invalid pour → `error` sound + shake.
- HUD: level, moves / par, best. Header actions: undo (unlimited), restart, hint (limited 3 per level).
- Win modal: moves vs par, stars, Next level. Persist current level, and allow jumping back to earlier levels
  from a small level picker on the start screen (unlocked levels only).

## Tests
Pour rules (amounts, matching), win detection, solver solves a known level and detects an unsolvable one,
generated levels are solvable.
