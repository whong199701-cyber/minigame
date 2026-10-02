# pool · 台球清台 · Pool Clear

**Category** action · **Icon** 🎱 · **Best metric** fewest shots to clear per mode.

## Mechanics
Top-down 2D pool table (portrait: table vertical, 2:1 aspect) with 6 pockets, cushions, cue ball and object balls.
Goal: pocket every object ball in the fewest shots. Scratch (cue ball pocketed) = +1 penalty shot and ball-in-hand
(tap anywhere on the table to place). Modes by ball count: 6 / 9 / 15 balls (rack triangle/diamond). "Aim guide"
(ghost ball + first-collision direction line) on in 6/9-ball, off in 15-ball.

## Physics (logic.ts, deterministic, unit-testable)
Fixed-step simulation (e.g. 120 Hz with substeps) with ball–ball elastic collisions (equal masses, swap normal
velocity components, slight restitution 0.95), cushion reflection (restitution 0.8), rolling friction deceleration
(linear + small quadratic), stop threshold, pocket capture when the centre is within the pocket radius. Resolve
overlaps to avoid tunnelling (sweep or small substeps). Balls settle within a few seconds.

## Controls
Drag anywhere on the table: the cue line rotates to aim through the cue ball toward the drag direction (fine
control: moving the finger far from the ball gives finer angle changes), a power bar fills with pull-back distance
(drag away from the aim direction) — release to shoot. Alternative simpler scheme allowed: drag from the cue ball
backwards (slingshot) with a power meter; the chosen scheme must be explained in `rules`. Shooting disabled while
balls are moving.

## UI
- Canvas; green felt (theme-aware tone), wooden rail, pocket circles, numbered balls (solids 1–7 colour, 8 black,
  stripes 9–15 with a band), subtle shadow/highlight. Cue stick drawn behind the cue ball while aiming.
- HUD: shots, balls left, best. Sounds: `shoot` on strike, `tap`/`place` on ball collision (throttled), `coin` on pocket,
  `error` on scratch. Header: restart.
- End modal: shots, new best (lower), play again.

## Tests
Ball–ball collision conserves momentum and separates overlapping balls, cushion reflection, pocket detection,
balls come to rest, rack positions do not overlap.
