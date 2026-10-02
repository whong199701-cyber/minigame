# lunar-lander · 登月着陆 · Lunar Lander

**Category** action · **Icon** 🚀 · **Best metric** highest campaign score; per-level best score.

## Mechanics
Side view. The lander falls under gravity; the player rotates it (left/right) and fires the main thruster (hold)
burning limited fuel. Land on a flat pad with vertical speed < 2.5 m/s, horizontal < 1.5 m/s, tilt < 10°, both legs
on the pad. Pads have multipliers (×1 wide, ×2 medium, ×3 narrow). Score = base 100 × multiplier + fuel left × 2.
Crash = level failed (retry). Campaign: 10 levels with increasing gravity, rougher terrain, narrower/fewer pads,
less fuel, light horizontal wind from level 6. Endless mode after.

## Physics (logic.ts)
Fixed-step integration (dt 1/60), gravity 1.6–3 m/s² scaled to pixels, thrust acceleration, angular velocity from
rotation input, fuel consumption while thrusting. Terrain: polyline generated from seeded midpoint displacement
with flat segments inserted for pads. Collision: legs (two points) vs terrain segments; body vs terrain = crash.

## Controls
Three large buttons across the bottom (≥64 px tall): ◀ rotate left, 🔥 thrust (hold), ▶ rotate right. Also allow
pressing left/right halves of the top area to rotate while holding the thrust button. Keyboard arrows as bonus.

## UI
- Canvas: starfield, terrain polygon in surface-2, pads highlighted with multiplier label, lander drawn with legs
  and flame when thrusting, camera follows the lander with zoom-in when close to terrain (altitude < ~150 px).
- HUD: altitude, vertical speed (turns danger-red when too fast), horizontal speed, fuel bar, tilt. Level indicator.
- Landed: `win` + modal with score breakdown, next level. Crashed: explosion particles + `explosion` sound + modal.

## Tests
Integration under gravity, landing criteria (speed/angle/on-pad), crash detection, terrain generation contains the
requested pads as flat segments, fuel depletion.
