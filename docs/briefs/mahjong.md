# mahjong · 麻将对对碰 · Mahjong Solitaire

**Category** table · **Icon** 🀄 · **Best metric** fastest clear per layout; clears count.

## Mechanics
Mahjong solitaire: tiles stacked in layers; a tile is FREE if no tile covers it (overlap in the layer above) and at
least one of its left or right sides is completely free. Tap two free matching tiles to remove them. Flowers match
any flower, seasons any season; other tiles must be identical. Win when all tiles are removed. If no moves remain,
offer a limited shuffle (counts against the score) or restart.

## Tile set (144 tiles)
Dots 1–9 ×4, Bamboo 1–9 ×4, Characters 1–9 ×4, Winds 東南西北 ×4, Dragons 中發白 ×4, Flowers 梅蘭菊竹 ×1,
Seasons 春夏秋冬 ×1. DRAW tiles on canvas (no emoji dependency): dots = circles arranged in patterns; bamboo =
small green sticks; characters = Chinese numeral + 萬 (text); winds/dragons/flowers/seasons as a large coloured
character. Theme-aware tile face (surface) with a darker side for depth.

## Layouts (define as arrays of {x, y, z} in half-tile units)
- small (72 tiles) e.g. a 3-layer pyramid; medium (100) "fortress"; large (144) the classic turtle. Validate that
  tile counts are even and ≤ 144.

## Generation (solvable guarantee)
Fill the layout in reverse: start empty; repeatedly choose two positions that are currently "placeable" (all
positions they rest on are filled; and would be free in the forward direction given the tiles placed so far —
i.e. simulate removal order backwards), assign them the same tile kind (draw kinds from the shuffled 144-tile
bag in pairs). Verify with a forward greedy solver that replays the recorded pair order (must clear everything).

## UI
- Canvas with 2.5D offset per layer (shadow, side faces), scaled to fit; selected tile highlighted; non-free tiles
  slightly dimmed (option toggle "dim blocked tiles"). Tap handling must pick the TOPMOST tile under the finger.
- HUD: tiles left, pairs available (count of currently free matching pairs), timer. Header: hint (flash a pair,
  +15 s), shuffle (max 2), undo, restart.
- Win modal with time, new best; "no moves" modal with shuffle/restart.

## Tests
Free-tile rule (covered, left/right blocked), matching rule (flowers/seasons), generation yields solvable boards
(replay solver), layout tile counts, topmost-tile hit testing.
