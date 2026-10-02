# tower-defense · 迷你塔防 · Mini Tower Defense

**Category** action · **Icon** 🏰 · **Best metric** highest wave reached per map; "map cleared" flags.

## Mechanics
Grid maps (e.g. 9 columns × 13 rows in portrait) with a fixed enemy path (list of waypoints along grid cells).
Build towers on non-path cells; enemies walk the path; reaching the end costs a life (start with 20). Money from
kills; 20 waves per map then an endless mode with scaling HP. Speed toggle ×1/×2. "Send next wave early" grants a
small bonus.

## Towers (cost / damage / range / rate), 2 upgrade levels each (+dmg, +range), sell for 70%
- Arrow: cheap, fast single-target.  - Cannon: slow, splash damage.  - Frost: slows enemies in range (stacking cap).
- Sniper: long range, high damage, slow rate, bonus vs bosses.
Targeting: first enemy along the path in range (also "strongest" for sniper).

## Enemies
normal, fast (low HP), tank (high HP, slow), flying (ignores frost? or only hit by arrow/sniper — pick one, document
it in rules), boss every 10th wave. Wave composition scripted by wave number; HP scales ~×1.15 per wave.

## Maps
3 maps with different path shapes (S-curve, spiral, double-back). Define as grid + waypoint lists; validate paths
are contiguous.

## UI
- Canvas; cells drawn with theme colours; path as a lighter strip; towers as simple geometric shapes with range ring
  when selected; enemies as circles with HP bars; projectiles and splash rings; frost tint.
- Tap empty buildable cell → small build menu (4 towers with cost; disabled if unaffordable) anchored near the cell
  (keep inside screen). Tap a tower → upgrade / sell menu. Tap elsewhere closes.
- HUD: wave x/20, lives, money, speed toggle, "next wave" button with countdown. Game over modal with wave reached,
  new best; victory modal at wave 20 with "continue endless".
- Pause when `onVisibility(false)`; a pause overlay with resume.

## Tests
Enemy path progression & end-of-path, targeting choice, damage/kill/money, frost slow stacking cap, wave
composition generation, map validation.
