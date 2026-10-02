# rush-hour · 停车场逃脱 · Parking Escape

**Category** logic · **Icon** 🚗 · **Best metric** levels solved per difficulty, "perfect" (= optimal) solves.

## Mechanics
6×6 lot. Vehicles are length 2 (cars) or 3 (trucks), horizontal or vertical, and slide only along their axis.
The red car is horizontal on row index 2 and must reach the exit on the right edge. One move = sliding one vehicle
any distance. Show the optimal move count (par) for the level.

## Difficulty (by optimal solution length found by BFS)
easy 5–10 moves · medium 11–18 · hard 19–30 · expert 31+. Levels are numbered; level k of a difficulty is generated
from seed `hash(difficulty, k)` so it is reproducible (use `seededRandom`).

## Generation (logic.ts)
Place the red car at random column (not already at exit), then randomly place 8–13 other vehicles without overlap
(avoid a horizontal vehicle on the red row to the right of the red car unless blocked appropriately — just rely on
BFS). BFS over states (encode vehicles' positions compactly) from the start to find the minimal solution; reject
if unsolvable, trivially solved (par < min) or over the range; retry with the next seed offset. Must generate within
a few hundred ms (BFS on 6×6 with ≤14 vehicles is small). Also store the optimal first move for "hint".

## UI
- Canvas board filling the width, rounded vehicle rectangles with subtle shading, red car distinct, exit gap drawn
  on the right wall of row 2.
- Drag a vehicle along its axis (pointer down on the vehicle, move; clamp to free cells; snap on release). A
  release that changed the position counts as one move. Undo (header action), Reset.
- HUD: level, moves / par, best. Win animation: red car drives out, `win` sound, modal with moves vs par
  (⭐⭐⭐ if == par, ⭐⭐ ≤ par+3, ⭐ otherwise), Next level / Home. Persist the highest level reached per difficulty.

## Tests
BFS solver finds known optimal lengths for a hand-written puzzle, generated levels solvable with par in range,
move validation (blocking, bounds), win detection.
