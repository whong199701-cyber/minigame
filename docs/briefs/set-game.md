# set-game · 图形集合 · Set Match

**Category** table · **Icon** 🔷 · **Best metric** classic: fastest full-deck clear; blitz: most sets in 2 min.

## Mechanics
81 cards: 4 attributes × 3 values — count (1/2/3), shape (diamond / pill / wave), colour (3 theme-safe colours),
fill (solid / striped / outline). A SET is 3 cards where, for each attribute, the values are all the same or all
different. 12 cards are dealt; the player selects 3; a correct set is removed and replaced. If the layout has no set,
3 extra cards are added automatically (up to 15/18). Game ends when the deck is empty and no sets remain.

## Modes
- classic: whole deck, timed; hint button (highlights one card of a set; +20 s penalty); best = time.
- blitz: 120 s, as many sets as possible; wrong selection −1; best = sets.
- (optional) puzzle: a fixed 12-card layout with exactly N sets, find them all.

## UI
- Cards as inline SVG in a DOM grid (3 columns × 4–6 rows fits portrait). Draw the three shapes with the three
  fills (striped = pattern of lines, clip to shape). Selected card: accent border; correct set flashes success and
  slides out; wrong set shakes with `error`.
- HUD: sets found, cards left in deck, timer; "No set?" button (if truly none → deal 3 more, else penalty +10 s).
- Win/end modal with time or sets, new best.

## Tests
Deck has 81 unique cards, isSet on known triples, findAllSets, auto-deal when no set exists, blitz scoring.
