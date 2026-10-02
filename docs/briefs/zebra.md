# zebra · 逻辑推理表 · Logic Grid

**Category** logic · **Icon** 🦓 · **Best metric** fastest time per difficulty; solved count.

## Mechanics
N houses in a row (positions 1..N). K categories (e.g. colour, owner name, pet, drink, hobby), each with N distinct
items. Exactly one item of each category per house. A list of clues determines a unique assignment. The player
fills a table (rows = houses, columns = categories) and checks it.

## Difficulty
- easy: N=4, K=3;  medium: N=5, K=4;  hard: N=5, K=5 (fewer "direct" clues, more relational ones).

## Content (bilingual, define both zh and en labels for every item)
Categories/items (use the first N of each): colour (red, blue, green, yellow, white), name (Alex, Ben, Carl, Dana, Eve /
中文名 小明, 小红, 小刚, 小丽, 小强), pet (dog, cat, fish, bird, rabbit), drink (tea, coffee, milk, juice, water),
hobby (chess, painting, hiking, music, cooking). Use neutral content; no nationalities.

## Clue types (templated text in both languages)
1. "{A} lives in house {k}."  2. "{A} is in the same house as {B}."  3. "{A} is directly left of {B}."
4. "{A} is next to {B}."  5. "{A} is somewhere to the left of {B}."  6. "{A} is not in house {k}."
7. "{A} is not in the same house as {B}."  8. "{A} is at one of the ends."
Clue items reference items of any category (e.g. "The tea drinker is next to the red house").

## Generation (logic.ts)
1. Random solution: a random permutation per category.
2. Generate a large pool of true clues (all types), shuffle, then add clues one by one until the solver reports a
   unique solution; then try removing each clue (keep the puzzle unique) to minimise. Prefer relational clues on hard.
3. Solver: backtracking over houses assigning items with constraint checks + propagation; must count up to 2
   solutions quickly for N=5, K=5 (prune aggressively; evaluate each clue as a predicate over partial assignments).
   Cap generation time; retry with a fresh solution if too slow.

## UI
- Start screen with difficulty, best, Play.
- Top: scrollable clue list (`.game-scroll`, ~40% height); tap a clue to strike it through (player's own bookkeeping).
- Bottom: table, rows = house 1..N, columns = categories. Tap a cell → bottom sheet/modal listing that category's
  items (items already placed elsewhere are dimmed but selectable); selecting places the item (and clears it from
  the other house if it was there). Long-press/“×” clears.
- "Check" button: if all filled and correct → win modal (time, new best). If wrong → `error` sound and show the
  number of wrong cells (not which).  "Hint" reveals one correct cell (+30 s penalty).
- Timer in `setStatus`.

## Tests
Solver uniqueness on a hand-written puzzle, generated puzzles are unique and the solver's solution equals the
hidden one, each clue predicate agrees with the solution, bilingual templates contain all placeholders.
