# countdown · 数字倒数 · Number Countdown

**Category** brain · **Icon** 🔢 · **Best metric** best 10-round total score; exact-solution streak.

## Mechanics (Countdown numbers round)
Six numbers are drawn: the player chooses how many "large" numbers (0–4 from 25, 50, 75, 100), the rest "small"
(1–10, each available twice). A random target 101–999. Within the timer (60 s normal, 30 s hard, 90 s relaxed) build
the target using +, −, ×, ÷ ; each number can be used at most once; intermediate results must be positive integers
(no fractions, no negatives). Scoring per round: exact 10, within 1–5: 7, within 6–10: 5, else 0. A game is 10 rounds.
Hard mode: target is chosen so that an exact solution exists only ~80% of the time (the solver reports the best
achievable).

## Solver (logic.ts)
Recursive search over pairs (a op b) replacing them with the result; prune invalid ops; find exact or the closest
value and return the expression steps; must run in < 100 ms for 6 numbers (memoise by sorted multiset).

## UI
- Round start: pick large count (0–4) with a segmented control, then the numbers appear with the target big at top.
- Work area: tap a number tile, tap an operator (+ − × ÷), tap another tile → the two tiles merge into a result tile
  (the operation is appended to a visible steps list); invalid op (non-integer/negative) → `error`. Undo last step,
  reset numbers. Submit when a tile equals the target (auto-detect) or when the timer ends (closest tile counts).
- After each round: show the solver's solution (steps) and points. Timer in setStatus with `tick` in the last 5 s.
- End modal: total over 10 rounds, new best.

## Tests
Solver finds exact solutions for known cases, returns closest when impossible, operator validity rules, scoring
bands, number drawing respects pools.
