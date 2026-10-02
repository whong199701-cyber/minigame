# nback · 双重 N-back · Dual N-Back

**Category** brain · **Icon** 🧠 · **Best metric** highest N reached; best accuracy per N.

## Mechanics
A 3×3 grid. Each trial (every 2.5 s, stimulus visible 1 s) shows a square lighting up in one position AND a letter
(from a set of 8 consonants) displayed in the centre of the lit square (visual dual). The player presses POSITION
if the position matches the one N trials ago, and LETTER if the letter matches N trials ago (both can be true).
Round = 20 + N trials. Feedback per trial: button flashes success/danger; missed matches flagged at the end of the
trial. Accuracy = correct responses / (matches + false alarms). Adaptive: ≥ 80% → N+1 next round, < 50% → N−1
(min 1). N starts at the saved level (default 2). Modes: single (position only), dual, triple (adds colour of the
square: 3 colours, third button).

## Generation (logic.ts)
Sequence generator that guarantees ~30% position matches and ~30% letter matches (and avoids accidental extra
matches beyond a small tolerance) for N-back comparisons.

## UI
- Start screen: mode segmented, current N with +/- adjusters, best N, Play.
- Game: trial counter, progress bar, the 3×3 grid (≥ 90 px cells), bottom: 2–3 huge buttons (≥ 72 px tall) labelled
  "Position (A)" / "Letter (L)" / "Colour". Keyboard A/L/C as bonus. Pause on hidden.
- End modal: hits/misses/false alarms per channel, accuracy, next N decision, Play again.

## Tests
Match computation for N, sequence match ratio within tolerance, scoring and adaptive rule, trial timing state machine
(pure function of elapsed time).
