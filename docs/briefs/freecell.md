# freecell · 空当接龙 · FreeCell

**Category** table · **Icon** 🃏 · **Best metric** fastest win time; wins / win streak; fewest moves.

## Mechanics
Standard FreeCell: 52 cards, 8 cascades (7,7,7,7,6,6,6,6), 4 free cells, 4 foundations (A→K by suit). Cascades
build down in alternating colours. Only one card moves at a time officially; moving a sequence is allowed when
`(freeCells + 1) * 2^(emptyCascades)` is large enough (halve the exponent if the destination is an empty cascade).

## Deals
Implement the Microsoft deal algorithm (LCG: seed = seed * 214013 + 2531011, card index = (seed >> 16) & 0x7fff
mod remaining) so deal numbers 1–32000 match the well-known layouts; all are solvable except #11982 (skip it).
Deal #1's first row must be JD 2D 9H JC 5D 7H 7C 5H (use in a unit test). Show the deal number; "New deal" uses a
random number; a small input lets the player enter a specific deal number.

## UI
- DOM cards (CSS), 8 columns fit 390px (card ~44×62px, rank+suit in the corner, red/black suits, face-down not needed).
  Top row: 4 free cells + 4 foundations. Cascades below with vertical overlap (~22px), the column area scrolls
  vertically if needed.
- Interaction: tap a card to select it (and the valid sequence below it); tap a destination (cascade/free cell/
  foundation) to move. Tapping a selected card again does a *smart move* (foundation if possible, else best
  cascade, else free cell). Double-tap also sends to foundation. Invalid → `error`.
- Auto-play: after each move, automatically move cards to foundations when safe (standard rule: a card is safe when
  both opposite-colour cards one rank lower are already on foundations).
- Header actions: undo (unlimited), new deal, restart deal. HUD: moves, time, deal #. Win modal: time, moves, best.
- Persist the in-progress game (deal, move list) so leaving and returning restores it.

## Tests
MS deal #1 layout, move legality (cascade build rule, supermove capacity), auto-play safety rule, win detection,
undo restores state.
