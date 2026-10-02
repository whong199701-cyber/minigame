# hexcells · 六角推理 · Hex Logic

**Category** logic · **Icon** 🔶 · **Best metric** fastest time per difficulty; also "perfect" (0 mistakes) count.

## Mechanics (Hexcells-style)
A hexagonal grid. Every cell is either BLUE (a "mine"/filled) or EMPTY. Revealed empty cells show a number: how
many of their 6 neighbours are blue. Hidden cells are orange. The player marks each hidden cell as empty (reveal)
or blue. A wrong mark counts as a mistake (the cell is then shown correctly). The total remaining blue count is
displayed. Win when all cells are resolved. The puzzle must be solvable by pure logic from the initial clues.

## Difficulty
- easy: ~7 columns × 8 rows (offset/“odd-q” layout), ~25% blue; 
- medium: 9×11; 
- hard: 11×13, ~30% blue.
Optionally randomly carve holes (missing cells) so the shape is irregular.

## Generation (logic.ts)
1. Random blue assignment.
2. Start with all cells hidden; reveal a few random empty cells as starting clues.
3. Run a logic solver repeatedly: for each revealed numbered cell, consider its hidden neighbours and the remaining
   blue count: (a) if remaining==0 → all empty; (b) if remaining==hidden count → all blue; (c) subset rule: for two
   constraints A⊂B, deduce on B\A; (d) global remaining-blue count rule. If stuck, reveal (as a given clue) the
   hidden EMPTY cell that participates in the most constraints (or a random hidden empty cell) and continue.
   Record the solution. Because the solver reached a full solution, the puzzle is solvable by the same rules.
4. Keep the final set of initially-revealed cells as the puzzle's givens.

## UI
- Canvas, flat-top or pointy-top hexes scaled to fit the area with margin; theme-aware colours
  (hidden = warning/orange, blue = accent, empty = surface-2 with number text).
- Two-mode control: a large segmented toggle at the bottom "Reveal / Mark blue" PLUS long-press (≥350 ms) on a
  cell performs the opposite action. Tapping an already-resolved cell does nothing.
- HUD: remaining blue, mistakes, timer. Mistakes flash the cell in danger colour with `ctx.play('error')`.
- Win modal: time, mistakes, new best. Numbers must be legible (≥14px) on hard.

## Tests
Neighbour computation for odd/even columns, solver deductions (unit cases for each rule), generated puzzles
are fully solvable by the solver with no guessing, counts consistent with the solution.
