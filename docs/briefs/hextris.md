# hextris · 六边形俄罗斯 · Hex Stack

**Category** action · **Icon** ⬢ · **Best metric** highest score.

## Mechanics
A hexagon sits in the centre. Coloured bars (blocks) fall inward from the 6 directions and stack on the hexagon's
sides. The player rotates the hexagon (tap LEFT half of the screen = rotate counter-clockwise, RIGHT half =
clockwise; swipes also work) so blocks land where they want. When 3 or more same-colour blocks are connected
(adjacent on the same side's stack or neighbouring sides at the same height level), they clear and give points
(combo multiplier for chain clears). Game over when any side's stack grows past the outer boundary. Speed and
spawn rate increase with time/score. 4 colours (theme-safe); hard mode uses 5 colours and faster speed.

## Model (logic.ts)
6 lanes × height levels; falling blocks with lane, radial position and colour; landing when reaching the stack
top; group detection via flood fill over (lane, level) with lane adjacency wrapping 5↔0; clearing + gravity
(blocks drop down within a lane); scoring: 10 × n per cleared block, combo ×1.5 per consecutive clear.

## UI
- Canvas: central hexagon rotates with easing (60°/step); stacked blocks drawn as trapezoids along each side;
  falling blocks as trapezoids moving inward; subtle outer boundary ring; score at top; small "next" preview optional.
- Sounds: `move` on rotate, `pop` on clear, `lose` on game over. Start overlay (tap to start), pause on hidden.
- Game-over modal: score, best, retry.

## Tests
Lane adjacency with wrap, group detection & clearing, gravity after clear, game-over detection, speed curve
monotonic, scoring/combos.
