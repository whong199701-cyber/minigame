# bullet-dodge · 弹幕躲避 · Bullet Dodge

**Category** action · **Icon** 💫 · **Best metric** longest survival time per difficulty.

## Mechanics
The player controls a small ship inside a rectangular arena. Bullets stream in patterns; touching one ends the run
(normal/hard) or costs a life (easy: 3 lives with 1.5 s invulnerability flash). Survival time is the score; phases
escalate every 10 s (new patterns, higher density/speed). Occasional power-ups: shield (absorbs one hit), slow-mo
(3 s). The ship has a tiny hitbox (core radius ~4 px) drawn as a bright dot — classic bullet-hell fairness.

## Patterns (logic.ts, spawner driven by phase)
aimed shots from spawners on the edges, radial bursts, rotating spirals, horizontal/vertical bullet walls with a
gap, bouncing bullets (reflect once), slow homing orbs (hard). Each pattern has parameters scaled by phase.

## Controls
Relative drag: touching anywhere and moving moves the ship by the same delta (finger does not need to be on the
ship, so it never hides it). Clamp to the arena. Optional "focus" (slower, more precise movement) when a second
finger is down — document in rules if implemented.

## UI
- Canvas: dark arena with subtle grid; bullets as glowing circles (2 colours by type), ship as a small triangle +
  bright core; particle burst on death; timer big at the top; phase announcements ("Phase 3") flash briefly.
- Sounds: `tick` each phase, `explosion` on death, `coin` on power-up. Pause on hidden with resume overlay.
- Game-over modal: time, phase reached, best, retry.

## Tests
Circle collision with core radius, spawner emits pattern bullets with expected counts/speeds per phase, wall gap
contains a passable opening, bullets culled outside the arena, power-up effects.
