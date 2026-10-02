# laser-maze · 激光镜面迷宫 · Laser Maze

**Category** logic · **Icon** 🔦 · **Best metric** levels completed; solve time.

## Mechanics
Square grid (6×6 → 9×9). Fixed elements: one laser emitter on a border cell (direction into the grid), 1–4
targets (must all be lit), walls (block), fixed mirrors, optional beam splitters (beam continues straight AND
turns, on medium+). The player places a limited number of mirrors ('/' or '\') on empty cells: tap an empty cell
to place '/', tap again to rotate to '\', tap again to remove. The beam is traced live. Win when all targets are
lit (beam enters the target from any side).

## Levels
Numbered, seeded. Difficulty curve: grid size, targets, walls, mirror budget (2–6), splitters from level 8.
Generation: place emitter, random walls, then random hidden mirrors (k) and simulate the beam; place targets on
cells the beam passes through (prefer far-away cells, after at least one reflection each). Reject if the beam
without the hidden mirrors already lights every target, or if the solution needs < 2 reflections. The player gets
exactly k mirrors (any valid configuration wins).

## UI
- Canvas grid; emitter drawn as a small cannon, targets as rings that glow when lit, walls as dark blocks, mirrors as
  diagonal bars, beam as a bright accent line with glow; splitters as semi-transparent diamonds.
- Bottom HUD: mirrors left (icons), targets lit x/y, level; header actions: reset, next (when won).
- Beam trace must handle loops (cap steps ~500) and splitter branching.

## Tests
Reflection direction tables for both mirrors and all 4 directions, splitter behaviour, beam termination at walls/
borders/loop cap, generated levels: hidden solution lights all targets and the empty board does not.
