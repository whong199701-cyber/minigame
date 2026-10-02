# killer-sudoku · 杀手数独 · Killer Sudoku

**Category** logic · **Icon** 🧮 · **Best metric** fastest time per difficulty (lower is better), also count of solved puzzles.

## Mechanics
Standard 9×9 sudoku (rows, columns, 3×3 boxes contain 1–9) PLUS cages: irregular groups of 1–5 cells, each with a
printed sum; digits inside a cage cannot repeat. Classic killer has no given digits.

## Difficulty
- easy: cages of size 1–3 (many size-2), plus ~12 given digits; 
- medium: cages size 2–4, ~4 givens;
- hard: cages size 2–5, no givens (pure killer).
Everything must stay solvable by deduction (unique solution is the hard requirement).

## Generation (logic.ts)
1. Generate a full valid grid (backtracking with shuffled candidates).
2. Partition into cages by random region growth with the size limits above; cages never contain duplicate digits
   (guaranteed since they come from the solution — but verify a cage does not contain the same digit twice; if it would, stop growing).
3. Compute sums. Decide givens.
4. Uniqueness check: a solver (backtracking with MRV, candidate elimination, cage sum feasibility pruning using
   min/max possible sums of remaining cage cells) that counts solutions up to 2. If not unique, add a given digit
   from the solution in the cell with most candidates and re-check; cap total time (~1.5 s) — on timeout add more
   givens until unique. Generation must finish quickly on a phone (keep the solver efficient).

## UI
- Start screen: difficulty segmented, best time for that mode, Play. Resume an unfinished puzzle if one is saved
  (persist board state in `ctx.storage` on every change; offer "continue" / "new").
- Board: DOM 9×9 grid (fits width, square cells ~40px). Thick lines for boxes, dashed inner borders delineating
  cages (compute per-cell top/right/bottom/left "same cage" flags), small sum label in the top-left cell of the cage.
- Selected cell highlight; highlight same digits; conflicting digits shown in danger colour.
- Bottom keypad 1–9 (big ≥44px), Notes toggle (pencil marks, 3×3 tiny grid in the cell), Erase, Undo, Hint
  (fills one correct cell, +30 s penalty shown), Check (count errors).
- Cage helper: when a cell is selected show "cage sum X · remaining Y" in `ctx.setStatus` together with the timer.
- Keypad digit greyed out when all 9 placed. Win when grid equals the solution → modal with time, new-best.

## Tests
Grid validity, cage partition covers all 81 cells with correct sums and no repeats, solver finds the unique
solution for a generated puzzle, solver counts 2+ solutions for an under-constrained puzzle.
