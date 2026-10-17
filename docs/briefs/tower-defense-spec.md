# Immune Front · 免疫防线 — numeric design spec (v2, revision 3: bot balance pass)

Companion to `tower-defense.md` (concept, authoritative for *what*). This file is authoritative for *numbers* and
*contracts*: every value a programmer needs is here, and the TypeScript contracts live in
`src/games/tower-defense/types.ts`. Logic, renderer and UI are built against these two files in parallel.
§16 lists what changed in revision 2 and why; §15 is the arithmetic the revision-2 numbers were checked against and
§15.1 the headless bot pass (revision 3) that retuned them — where the two disagree, §15.1 and the tables below win.

Conventions used throughout:

- **Units**: distances in grid cells (cell `(c, r)` has its centre at `(c + 0.5, r + 0.5)`; `x` = column axis,
  `y` = row axis, origin at the grid's top-left corner, row 0 is the far edge from the camera, the core sits on the
  near/bottom edge). Heights `h` are cells above the floor. The renderer maps logic `(x, y, h)` to three.js
  `(x, h, y)` (§11.8, `WORLD`); the logic never uses the letter z. Time in seconds of *simulation* time. Speeds in
  cells/s. Damage per hit, DPS per second. Percentages are written as fractions in code.
- **Fixed step**: `step(state, 1/60)`; the UI accumulates frame time and runs ≤ 8 steps per frame (0.133 s). Game
  speed ×2 simply runs twice the steps. All timers are stored as *absolute* `state.time` values (`until`, `readyAt`,
  `nextAt`), never as countdowns, so pausing and saving are free. Frame-loop contract: §7.10.
- **Multipliers** are combined multiplicatively unless a formula says "additive". Values are rounded only where a
  formula says `round`/`floor`/`ceil`.
- **Wave growth** `g(w)`: `1.22^(w-1)` for `w ≤ 20`; `g(20) · 1.06^(w-20)` for `w > 20` (endless) — `HP_GROWTH` /
  `ENDLESS_GROWTH` in `sim/data.ts`. Reference: g(1)=1.00 · g(2)=1.22 · g(3)=1.49 · g(5)=2.22 · g(10)=5.99 ·
  g(15)=16.18 · g(20)=43.74 · g(25)=58.5 · g(30)=78.3 · g(35)=104.8 (rev. 2 used 1.15 / 1.12; §15.1 explains why).
  Several tower effects scale with `g(w)^0.5` (§2.4, §2.3) or with the target's maxHP (§2.2, §2.8) so they never
  become irrelevant; the UI's DPS lines are computed from those formulas, never from flat numbers.
- **Determinism**: logic.ts never calls `Math.random` (a unit test greps for it); `GameState.rng` is reserved and
  currently unused (§12.1). Every tie-break is "lowest enemy id". Renderer VFX use a renderer-local xorshift.
- **Difficulty** multipliers are in §9; "hard" never changes the *shape* of a wave, only numbers and tempo.
- Ids used in code (also i18n key suffixes) are in §14.

---

## 1. Maps (organs)

All maps are portrait grids. Only cells marked as **pads** (`O`) or **villi pads** (`V`) can hold towers; the
**barrier** is the exception and is built on path cells. Everything else is decorative terrain the hero can walk on.

Common rules:

- A path is an axis-aligned waypoint list, exactly as v1 (`buildPath` / `pathGeometry` / `pointOnPath` are reused).
  The first waypoint is the **spawn** cell on an outer edge; enemies enter from one cell outside the grid. The last
  waypoint is a **core** cell; an enemy whose `dist ≥ geom.length` reaches the core (§7.9).
- Each path segment (between two consecutive waypoints) has a **flow** value: `1` = blood flows *with* enemy travel,
  `-1` = *against*, `0` = still. Corner cells belong to the segment that *enters* them. A cell shared by two paths
  (Alveoli merge, Brain final row) uses the flow of the path the enemy is on (identical where they overlap).
- `maxBarriers = 3` living barriers per map. Barriers cannot be built on the first 3 or last 3 cells of any path
  (counted from the spawn / to the core), nor on the core.
- `hpMult` scales enemy HP per map (path-length balance): Vessel 1.0 · Alveoli **0.9** (all-with-flow, shortest time
  under fire) · Gut **1.0** (47 cells, but only 21 sparse pads + 8 villi) · Brain **0.8** (two 26-cell paths that split
  the defense). Bosses additionally take `BOSS_HP_MULT[map]` (Vessel / Alveoli / Gut 1.0 · **Brain 0.7**): a Brain boss
  walks one of two paths that never merge, so it faces about half the towers (§15.1).
- Map unlock: Vessel, Alveoli, Gut always; **Brain unlocks at 6 total stars** (§10). **Hard** on a map unlocks when
  that map has ≥ 1 star on normal.
- Pads are checkerboarded, so a beacon's buff disc covers **0–7 other pads** depending on map and position — typically
  3–6 on Vessel / Alveoli / Brain and 1–4 on sparse Gut (§2.7 gives the real counts; the tooltip must not say "the 8
  neighbours").

Legend for the ASCII grids: `S` spawn · `C` core · `O` pad · `V` villi pad (range bonus, Gut only) · `M` merge cell ·
`> < ^ v` path cell, arrow = **flow** direction (not travel) · `= |` still path cell (horizontal / vertical) ·
`.` terrain. Enemy travel follows the waypoint table; where an arrow points backwards relative to travel the segment
is *against* the flow.

### 1.1 Vessel · 血管 (9 × 13) — the on-ramp

Single S path with strong flow and two against-flow legs (rows 4 and 10) where enemies are 20 % slower: the map
teaches "build on the slow leg". Path 34 cells; a bacterium walks it in 23.4 s, the Superbug in 57.7 s.

```
     0 1 2 3 4 5 6 7 8
 0   . . . O . . . . .
 1   S > > > > > > > .
 2   . O . O . O . v .
 3   . . O . O . O v .
 4   . > > > > > > v .
 5   . v . O . O . O .
 6   . v O . O . O . .
 7   . v > > > > > > .
 8   . O . O . O . v .
 9   . . O . O . O v .
10   . . . . > > > v .
11   . O . O v O . O .
12   . . O . C . O . .
```

| field | value |
|---|---|
| id | `vessel` · cols 9 · rows 13 · hpMult 1.0 · unlockStars 0 |
| path A waypoints | (0,1) (7,1) (7,4) (1,4) (1,7) (7,7) (7,10) (4,10) (4,12) |
| path A flow | `[1, 1, -1, 1, 1, 1, -1, 1]` |
| spawn / core | (0,1) entering from (−1,1) / core (4,12) |
| path cells | 34 (entry point excluded) |
| pads (25) | (3,0) (1,2) (3,2) (5,2) (2,3) (4,3) (6,3) (3,5) (5,5) (7,5) (2,6) (4,6) (6,6) (1,8) (3,8) (5,8) (2,9) (4,9) (6,9) (1,11) (3,11) (5,11) (7,11) (2,12) (6,12) |

| seg | from → to | travel | flow | cells |
|---|---|---|---|---|
| 1 | (0,1) → (7,1) | east | with | 8 |
| 2 | (7,1) → (7,4) | south | with | 3 |
| 3 | (7,4) → (1,4) | west | **against** | 6 |
| 4 | (1,4) → (1,7) | south | with | 3 |
| 5 | (1,7) → (7,7) | east | with | 6 |
| 6 | (7,7) → (7,10) | south | with | 3 |
| 7 | (7,10) → (4,10) | west | **against** | 3 |
| 8 | (4,10) → (4,12) | south | with | 2 |

### 1.2 Alveoli · 肺泡 (10 × 14) — two spawns, breathing

Two spawns (left `A`, right `B`) merge at `M` (4,4). All flow is *with* travel; the organ **breathes** (§5.2): every
12 s the flow reverses for **3 s** and pushes enemies back **1.0 cell** (bosses 0.5). The 7-cell corridor on row 9 is
the kill zone.

```
     0 1 2 3 4 5 6 7 8 9
 0   . . . . . . . . . .
 1   S > > . . . . < < S
 2   . O v . O . . v O .
 3   . O v O . O O v O .
 4   . . v > M < < v . .
 5   . . O . v . O . O .
 6   . O . O v > > > > .
 7   . . . . O . O . v .
 8   . O . O . O . O v .
 9   . < < < < < < < v .
10   . v O . O . O . O .
11   . v . O . O . O . .
12   . v > > > > . . . .
13   . . . . O C O . . .
```

| field | value |
|---|---|
| id | `alveoli` · cols 10 · rows 14 · hpMult **0.9** · unlockStars 0 |
| path A | (0,1) (2,1) (2,4) (4,4) (4,6) (8,6) (8,9) (1,9) (1,12) (5,12) (5,13) · flow all `1` · 32 cells |
| path B | (9,1) (7,1) (7,4) (4,4) (4,6) (8,6) (8,9) (1,9) (1,12) (5,12) (5,13) · flow all `1` · 33 cells |
| spawns / core | A (0,1) from (−1,1) · B (9,1) from (10,1) / core (5,13) |
| merge | cell (4,4); the shared tail is listed in both paths (cells may belong to several paths) |
| breathing | `period 12 s · reverseFor 3 s (reversed during [9, 12)) · warnFor 1 s (warn during [8, 9)) · push 1.0 cells (bosses 0.5) · interrupt 1 s` |
| pads (28) | (1,2) (4,2) (8,2) (1,3) (3,3) (5,3) (6,3) (8,3) (2,5) (6,5) (8,5) (1,6) (3,6) (4,7) (6,7) (1,8) (3,8) (5,8) (7,8) (2,10) (4,10) (6,10) (8,10) (3,11) (5,11) (7,11) (4,13) (6,13) |

### 1.3 Gut · 肠道 (10 × 15) — long winding path, villi, biofilm

47 path cells; horizontal runs alternate with/against ("peristalsis"), the vertical connectors are still. The 8 villi
pads on the outer edges give **+1.0 to every range stat** of the tower standing on them (attack, aura, beacon buff and
reveal radius), **capped at +0.5 for towers whose base range is ≥ 3.5** (the T-cell), so no tower sees the whole map.

```
     0 1 2 3 4 5 6 7 8 9
 0   . . O . . . O . . .
 1   S > > > > > > > > .
 2   . O . . . O . . | V
 3   . . . O . . . O | V
 4   . > > > > > > > | .
 5   V | O . . . O . . .
 6   V | . . O . . . O .
 7   . | > > > > > > > .
 8   . O . . . O . . | V
 9   . . . O . . . O | V
10   . > > > > > > > | .
11   V | O . . . O . . .
12   V | . . O . . . O .
13   . | > > > > . O . .
14   . . . O . C . O . .
```

| field | value |
|---|---|
| id | `gut` · cols 10 · rows 15 · hpMult **1.0** · unlockStars 0 |
| path A | (0,1) (8,1) (8,4) (1,4) (1,7) (8,7) (8,10) (1,10) (1,13) (5,13) (5,14) |
| path A flow | `[1, 0, -1, 0, 1, 0, -1, 0, 1, 1]` (runs 1/3/5 with, runs 2/4 against, connectors still) |
| spawn / core | (0,1) from (−1,1) / core (5,14) |
| pads (21) | (2,0) (6,0) (1,2) (5,2) (3,3) (7,3) (2,5) (6,5) (4,6) (8,6) (1,8) (5,8) (3,9) (7,9) (2,11) (6,11) (4,12) (8,12) (7,13) (3,14) (7,14) |
| villi (8) | (9,2) (9,3) (0,5) (0,6) (9,8) (9,9) (0,11) (0,12) |

### 1.4 Brain · 脑 (10 × 15) — two parallel paths, prions, beacons

Two mirrored paths (`L`, `R`) that never merge until the last row; the core spans two cells (4,14)+(5,14). Descents are
with-flow, every horizontal jog is against-flow, so enemies "stutter" down. Prions are common: towers only see them
near a beacon or the hero. Centre pads (cols 4–5) cover both paths by design; whether that makes the map play as a
single path is an open question for the bot pass (§16).

```
     0 1 2 3 4 5 6 7 8 9
 0   . S . . O O . . S .
 1   O v . O . . O . v O
 2   . v < < O O > > v .
 3   . O . v . . v . O .
 4   . . O v O O v O . .
 5   . > > v . . v < < .
 6   . v . O . . O . v .
 7   . v O . . . . O v .
 8   . v < < O O > > v .
 9   . O . v . . v . O .
10   . . O v O O v O . .
11   . > > v . . v < < .
12   . v . O . . O . v .
13   O v < < < > > > v O
14   . . O . C C . O . .
```

| field | value |
|---|---|
| id | `brain` · cols 10 · rows 15 · hpMult **0.8** · boss HP ×0.7 (`BOSS_HP_MULT`) · **unlockStars 6** |
| path L | (1,0) (1,2) (3,2) (3,5) (1,5) (1,8) (3,8) (3,11) (1,11) (1,13) (4,13) (4,14) · 26 cells |
| path R | (8,0) (8,2) (6,2) (6,5) (8,5) (8,8) (6,8) (6,11) (8,11) (8,13) (5,13) (5,14) · 26 cells |
| flow (both) | `[1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1]` |
| spawns / core | L (1,0) from (1,−1) · R (8,0) from (8,−1) / core cells (4,14) (5,14), core centre (5.0, 14.5) |
| pads (32) | (4,0) (5,0) (0,1) (9,1) (3,1) (6,1) (4,2) (5,2) (1,3) (8,3) (2,4) (7,4) (4,4) (5,4) (3,6) (6,6) (2,7) (7,7) (4,8) (5,8) (1,9) (8,9) (2,10) (7,10) (4,10) (5,10) (3,12) (6,12) (0,13) (9,13) (2,14) (7,14) |

### 1.5 Map validation (logic unit tests)

`validateMap` must reject: non-axis-aligned segments, a path crossing *itself*, a spawn not on an edge, an entry cell
inside the grid, pads/villi on path cells or duplicated, core cells that are not the last waypoint of some path,
`flow.length ≠ waypoints.length − 1`, barrier-ban zones that cover a whole path. Two different paths *may* share cells.

---

## 2. Towers

Eight types, levels 1–3, one of two **specializations** chosen when buying level 3 (the L3 upgrade button opens the two
cards; the choice is permanent). **Sell** refunds `round(0.7 × invested)` at any time (barriers included).

Common rules:

- Costs: `cost[0]` build, `cost[1]` L2, `cost[2]` L3 (the specialization is included in the L3 price).
- Targeting modes: `first` (smallest *remaining* distance to the core — works across multiple paths), `strongest`
  (highest current HP, tie → first), `marked` (most mark stacks, tie → first; nothing marked → first). The target is
  re-picked for every shot (v1 behaviour). Ties at every stage → lowest enemy id.
- `hitsFlying`: only antibody, complement, T-cell (and the hero / abilities) can hit Toxin Clouds.
- Tower *damage* never scales with waves; the economy and upgrades do. Wave-scaled tower numbers are the macrophage
  engulf threshold (§2.2, `× g(w)`), pyrogen aura DPS and histamine burn (`× g(w)^0.5`), and the enzyme / clot
  effects, which are fractions of the target's maxHP.
- A tower on a **villi pad** gets +1.0 on every range stat (+0.5 when its base range ≥ 3.5). A tower under
  **infection** (§5.3) fires at ×0.5 rate (aura: slow and DPS ×0.5). Beacons and barriers cannot be infected.
- Buffs: fire rate = `base × beaconRate × (adrenaline ? 1.6 : 1) × (infected ? 0.5 : 1)`; damage =
  `base × beaconDmg × talentDmg × vaccine`. Beacon buffs do not stack between beacons (max per stat), except that
  one *Alarm* global buff adds on top of one local buff (§2.7).
- DPS column = single-target, unbuffed, for the UI panel (`dmg × rate`, chain/splash shown as "×N targets"); the panel
  evaluates wave-scaled lines for the wave they will apply to (`phase === 'wave' ? wave : wave + 1`, min 1).

### 2.1 Antibody Launcher · 抗体发射器 (`antibody`) — fast single target, applies marks

cost **60 / 45 / 80** · projectile 10 cells/s · hits flying · default targeting `first`

| level | dmg | rate/s | range | mark | DPS |
|---|---|---|---|---|---|
| 1 | 7 | 2.5 | 2.6 | +1 stack (4 s) | 17.5 |
| 2 | 11 | 2.8 | 2.8 | +1 stack | 30.8 |
| 3 | 16 | 3.1 | 3.0 | +1 stack | 49.6 |
| 3 · **Polyvalent 多价抗体** (`polyvalent`) | 10 ×3 | 3.1 | 3.0 | each shot hits the target + the 2 nearest other enemies within **1.5 cells of the target** (§5.9 f); every hit marks | 31 ×3 = 93 |
| 3 · **Neutralizing 中和抗体** (`neutralizing`) | 18 | 3.1 | 3.0 | *strong* mark: +35 % flat, 7 s, full bonus from the first hit | 55.8 |

Against armor the antibody is a mark source first (w3 encapsulated armor 4 → 7 dmg does 43 %; w16 armor 8 vs 16 dmg).

### 2.2 Macrophage · 巨噬细胞 (`macrophage`) — short range, engulfs small enemies whole

cost **80 / 60 / 100** · melee (instant) · no flying · default targeting `marked`

| level | bite dmg | rate/s | range | engulf cooldown | engulf threshold (base HP) | digest time | DPS |
|---|---|---|---|---|---|---|---|
| 1 | 22 | 0.9 | 1.6 | 7 s | **55** | 2.5 s | 19.8 |
| 2 | 34 | 1.0 | 1.7 | 6 s | **80** | 2.5 s | 34 |
| 3 | 50 | 1.1 | 1.8 | 5 s | **110** | 2.5 s | 55 |
| 3 · **Fast Digestion 吞噬加速** (`fastDigestion`) | 50 | 1.2 | 1.8 | 3 s | **150** | 1.0 s | 60 |
| 3 · **Enzymes 消化酶** (`enzymes`) | 55 | 1.1 | 1.8 | 5 s | 110 | 2.5 s | 60.5 + acid |

Engulf: when the cooldown is ready and not digesting, the macrophage swallows the *first* enemy in range whose current
HP ≤ `threshold × g(wave) × (marked ? 1.5 : 1)`. The enemy dies instantly (reward granted, hero XP granted, **no spore
split / no mutant division**). Cannot engulf: bosses, parasites, mutant cells, flying. While digesting it still bites.
The wave-6 teaching spore (135 HP) is engulfable by a fresh L1 (55 × g(6) = 149).
Enzymes (scales with the meal): on each engulf, acid splash radius 1.2 for **35 % of the engulfed enemy's maxHP**
(armor-ignoring) and an acid pool (radius 1.0, 3 s, **10 % of that maxHP per second**, armor-ignoring) at the spot.

### 2.3 Mast Cell · 肥大细胞 (`mast`) — the swarm specialist (histamine splash)

cost **100 / 80 / 130** · lobbed projectile 6 cells/s (arc height 1.2 cells) · no flying · default `first` · **full
damage inside the splash radius, no falloff**

| level | dmg | rate/s | range | splash r | extra | DPS |
|---|---|---|---|---|---|---|
| 1 | **40** | 0.6 | 2.2 | **1.1** | — | 24 |
| 2 | **65** | 0.65 | 2.4 | **1.3** | — | 42.3 |
| 3 | **100** | 0.7 | 2.6 | **1.5** | — | 70 |
| 3 · **Allergy Storm 过敏风暴** (`allergyStorm`) | 100 | 0.7 | 2.6 | **1.9** | every hit slows 20 % for 1.5 s (counts toward the slow cap) | 70 |
| 3 · **Histamine Burn 组胺灼烧** (`histamineBurn`) | 80 | 0.7 | 2.6 | 1.5 | burn: `16 × g(w)^0.5` DPS (w1 16 · w10 39 · w20 106) for 4 s, armor-ignoring, refreshed by the same tower, up to 3 burns from different towers stack | 56 + burn |

Group spacing inside a wave is ≈ 1.35 cells (0.8 s gap × 1.69 cells/s with flow), so a 1.3+ splash reliably catches
two enemies and a 1.5 splash three. Against the Giant Parasite a splash hits up to 4 body zones (§5.9 m).

### 2.4 Pyrogen Node · 发热节点 (`pyrogen`) — slow + minor DoT aura

cost **75 / 55 / 95** · aura (no projectile, `rate` 0: applied every step × dt) · ground only · no targeting · slow
lingers 0.4 s after leaving

| level | range | slow | aura DPS at w1 (armor-ignoring; applied `× g(w)^0.5`) | extra |
|---|---|---|---|---|
| 1 | 1.9 | 25 % | 4 (w10 9.8 · w20 26) | — |
| 2 | 2.1 | 32 % | 7 (w10 17 · w20 46) | — |
| 3 | 2.3 | 40 % | 11 (w10 27 · w20 73) | — |
| 3 · **High Fever 高热** (`highFever`) | 2.3 | **55 %** | 14 | — |
| 3 · **Low Fever 低烧** (`lowFever`) | **3.2** | 30 % | 9 | 0.5 s stun the first time each enemy enters this tower's aura |

### 2.5 Killer T-Cell · 杀伤T细胞 (`tcell`) — sniper

cost **160 / 120 / 190** · instant tracer · hits flying · default `strongest` (rev. 3: +20 / +20 / +20 so a T-cell-only
build fails by wave 11–17 instead of clearing; §15.1)

| level | dmg | rate/s | range | DPS |
|---|---|---|---|---|
| 1 | 70 | 0.5 | **4.0** | 35 |
| 2 | 120 | 0.55 | **4.4** | 66 |
| 3 | 200 | 0.6 | **4.8** | 120 |
| 3 · **Perforin 穿孔素** (`perforin`) | 230 | 0.6 | 4.8 | **ignores armor** · 138 |
| 3 · **Apoptosis 凋亡诱导** (`apoptosis`) | 200 | 0.6 | 4.8 | non-boss target below 15 % HP dies instantly (`execute` event); vs a boss below 15 % the hit is ×1.5 |

Multipliers (all levels, multiplicative): ×1.5 vs **marked**, **×1.5 vs bosses**, ×2 vs **spawned** enemies (anything
created by another enemy: spores from the Superbug, sporelings, mutant halves, shed viruses). **Product capped at ×4**
(`multCap`). The Superbug's capsule halves tracer damage (§3.1), so the T-cell is the generalist boss tower, not the
answer to every boss.

### 2.6 Complement Cascade · 补体级联 (`complement`) — chain hits

cost **140 / 100 / 165** · instant chain · hits flying · default `first` (rev. 3: +20 / +15 / +25; §15.1)

| level | dmg | rate/s | range | targets | jump range (marked→marked) | falloff per jump | DPS |
|---|---|---|---|---|---|---|---|
| 1 | 20 | 1.0 | 2.4 | 3 | **1.3 (2.4)** | **−25 %** | 20 ×3 |
| 2 | 30 | 1.1 | 2.6 | 4 | 1.3 (2.4) | −25 % | 33 ×4 |
| 3 | 44 | 1.2 | 2.8 | **4** | 1.3 (2.4) | −25 % | 52.8 ×4 |
| 3 · **Long Chain 长链** (`longChain`) | 44 | 1.2 | 2.8 | **6** | **1.8 (3.0)** | −15 % | 52.8 ×6 |
| 3 · **Membrane Attack 膜攻击** (`membraneAttack`) | 44 | 1.2 | 2.8 | 4 | 1.3 (2.4) | −25 % | ×2.2 vs regen/shield; every hit suppresses regen + heal aura 6 s and ends Shell Hardening early |

Chain: hit the target, then repeatedly the nearest not-yet-hit enemy within the jump range of the last one (the longer
range applies when *both* are marked). Jumps may cross ground ↔ flying freely but **never land on an unrevealed
stealth enemy** (§5.9 k, l). Bonus ×1.6 vs enemies that have regen > 0 or a shield (biofilm, mutant cell, Superbug,
hardened Superbug) at levels 1–3 and Long Chain. With the Superbug capsule (chain ×1.5) the complement is the
Superbug's designated counter.

### 2.7 Interferon Beacon · 干扰素信标 (`beacon`) — support

cost **90 / 65 / 110** · no attack · never infected · pulses `cure` on its cadence (clears infection from every tower in
range) · **reveals** prions within `reveal`

| level | buff range | rate buff | dmg buff | cure every | reveal | extra |
|---|---|---|---|---|---|---|
| 1 | **2.0** | +10 % | — | 2.0 s | 2.5 | — |
| 2 | **2.3** | +18 % | — | 1.5 s | 3.0 | — |
| 3 | **2.6** | +25 % | +10 % | 1.0 s | 3.5 | towers in range cannot be infected |
| 3 · **Alarm 警报** (`alarm`) | 2.6 | +12 % local **and +8 % rate / +8 % dmg to every tower on the map** | +8 % global | 1.0 s | 3.5 | immunity in range |
| 3 · **Potentiate 免疫增强** (`potentiate`) | 2.6 | **+40 %** | **+20 %** | 1.0 s | 4.0 | +0.5 range to towers in range; immunity in range |

Real footprint (other pads within the buff disc, computed from §1): Vessel (3,2) L1 **5** / L3 **5**; Vessel (4,6)
L1 4 / L3 6; Alveoli (3,8) L1 4 / L3 6; Brain (4,4) L1 3 / L3 5; Gut (5,8) L1 **0** / L3 3. Over all pads: Vessel 1–5
(L1) / 1–6 (L3), Alveoli 1–4 / 2–6, Brain 0–4 / 1–7, Gut 0–2 / 1–4 (on Gut a beacon is mainly reveal + cure; a villi pad
adds +1.0 to its buff disc). `specDesc_potentiate` says "towers within 2.6 cells", never a pad count.
Stacking: for each tower, `beaconRate = 1 + max(local rate buffs) + (any Alarm on map ? 0.08 : 0)`, same for dmg and
range. Several Alarms count once.

### 2.8 Platelet Barrier · 血小板屏障 (`barrier`) — built on the path

cost **25 / 25 / 40** · path cells only (§1) · max 3 alive · never infected · no attack · flying ignores it (rev. 3:
cheaper and sturdier — at the steeper `g` a flat-HP barrier held too small a share of a group's HP and the rebuild
cost made it a net loss; §15.1)

| level | HP | regen (after 3 s without damage) | extra |
|---|---|---|---|
| 1 | **400** | 6 /s | — |
| 2 | **800** | 10 /s | — |
| 3 | **1300** | 15 /s | — |
| 3 · **Fibrin 纤维蛋白** (`fibrin`) | **2200** | 22 /s | — |
| 3 · **Clot Spikes 凝血刺** (`clotSpikes`) | **1300** | 15 /s | every attack-second on it reflects **4 % of the attacker's maxHP** (armor-ignoring); **2 % of maxHP per second** to every ground enemy within 0.6 cells (bosses ×0.25) |

HP is multiplied by the talent `platelets` (+30 %). Upgrading restores the barrier to full HP. A ground enemy whose
`dist` would pass `barrierDist − 0.45` stops there and attacks (§5.4). Bosses smash it: the barrier is destroyed on
contact (`barrierSmashed`), the boss pauses 1.0 s (a charging Giant Parasite does not pause). At 0 HP the barrier is
removed with no refund (`barrierBroken`).

---

## 3. Enemies

Base values at wave 1 on normal. `HP(w) = round(base × g(w) × map.hpMult × diff.hpMult)`,
`armor(w) = round(base × (1 + 0.06 (w−1))) + diff.armorBonus + max(0, w−20)`,
`attack(w) = base × (1 + 0.08 (w−1))` (DPS against barriers; **×0.25 against the hero**),
`reward(w) = max(1, round(base × (1 + 0.04 (w−1)) × diff.rewardMult))`, `speed = base × diff.speedMult × endlessSpeed`
(`endlessSpeed = min(1.3, 1 + 0.01 (w−20))` for w > 20). `vit` = vitality lost when the enemy reaches the core.

| id | zh / en | family | HP | speed | armor | reward | vit | attack | radius | flags & abilities |
|---|---|---|---|---|---|---|---|---|---|---|
| `bacterium` | 普通细菌 Bacterium | bacteria | 40 | 1.3 | 0 | 5 | 1 | 8 | 0.22 | baseline |
| `flagellate` | 鞭毛菌 Flagellate | bacteria | 24 | 2.4 | 0 | 4 | 1 | 6 | 0.18 | fast |
| `encapsulated` | 荚膜菌 Encapsulated | bacteria | 90 | 1.0 | **4** | 8 | 1 | 10 | 0.26 | armor (flat reduction): w3 4 · w10 6 · w20 9 |
| `virus` | 病毒 Virus | viral | 35 | 1.6 | 0 | 6 | 1 | 5 | 0.20 | **infects** every tower whose cell is within Chebyshev distance 1 of its current cell, once per tower per virus, 8 s |
| `spore` | 孢子 Spore | bacteria | 50 | 1.2 | 0 | 6 | 1 | 4 | 0.22 | on any death except engulf (execute, Booster and abilities included) spawns 3 `sporeling` at `dist − 0.2, dist, dist + 0.2` |
| `sporeling` | 孢子体 Sporeling | bacteria | 12 | 1.9 | 0 | 1 | 1 | 3 | 0.13 | `spawned` |
| `parasite` | 寄生虫 Parasite | parasitic | 320 | 0.75 | 2 | 18 | 2 | 25 | 0.30 | tank; **5 segments** 0.45 cells apart trailing the head along the path (segments are hit zones for the shared HP; a splash counts **once** per parasite, `splashZones 1`); in range of a tower when the head *or any segment* is; cannot be engulfed; slow resist 25 % |
| `biofilm` | 生物膜 Biofilm | bacteria | 110 | 0.9 | 0 | 10 | 1 | 12 | 0.26 | regen 3 % maxHP/s; heals every other enemy within 1.2 cells 2 % of *its* maxHP/s (a target takes healing from at most one biofilm) |
| `prion` | 朊病毒 Prion | viral | 60 | 1.4 | 3 | 9 | 1 | 10 | 0.20 | **stealth**: not targetable (and not a chain-jump target) unless inside a beacon's reveal radius or within the hero's reveal radius; splash / aura / acid that happen to cover it still damage it |
| `toxin` | 毒素云 Toxin Cloud | other | 45 | 1.5 | 0 | 7 | **2** | 0 | 0.24 | **flying** (rev. 3: vit 2 — the counter to ground-only builds, §15.1): ignores barriers, flow, breathing push, aura slow/DoT, splash, acid, clot contact; hit only by antibody, complement, T-cell, hero, abilities; Fever slows it |
| `mutant` | 癌变细胞 Mutant Cell | other | **400** | 0.7 | 4 | **60** | 3 | 30 | 0.34 | **not a boss** (§3.2); regen 1 %/s; **divides once** at ≤ 50 % HP into two `divided` halves (55 % of parent maxHP each, speed 0.9, radius 0.26, reward **25**, vit 2); effective HP 640; cannot be engulfed; slow resist 25 % |
| `superbug` | 超级细菌 Superbug | bacteria | **600** | 0.55 | **8** | 150 | 5 | 60 | 0.45 | **boss** (§3.1), regen **1 %/s**, **capsule**: tracer ×0.5, chain ×1.5 |
| `giantParasite` | 噬菌巨虫 Giant Parasite | parasitic | 1500 | 0.7 | 4 | 200 | 8 | 120 | 0.50 | **boss**, 8 segments 0.5 apart, `splashZones 4` (§3.1) |
| `virusKing` | 变异病毒王 Mutant Virus King | viral | **1200** | 0.6 | 6 | 300 | 10 | 80 | 0.50 | **boss** (§3.1) |

Bosses: slow resist 50 % (Virus King 60 %), immune to stun, engulf, execute and Booster-execute (Booster deals 8 % maxHP
instead), infection-free (n/a); their `vit` damage is unaffected by anything. Reference HP (normal): Superbug w5
**1 329** (hard 1 662), w15 **9 709**; Giant Parasite w10 **8 981**; Virus King w20 **52 483** (hard 65 604; Brain
×0.56 → 29 390). Bacterium: w1 40 · w5 89 · w10 239 · w15 647 · w20 1 749. Mutant: w13 4 349 (halves 2 392) · w17
9 634 · w20 17 494.

### 3.1 Boss skills (timings from the boss's spawn; `firstAt`/`every`/`duration` ×0.8 on hard, mutation exempt)

| boss | skill (`BossSkillId`) | trigger | telegraph | effect |
|---|---|---|---|---|
| Superbug | `sporulation` 孢子爆发 | t = 8 s, then every 12 s | 1.0 s (swells, glows) | spawns **2** `spore` (wave 5) / 3 (wave 15) / 4 (endless) at its position, all `spawned` |
| Superbug | `shellHardening` 荚膜硬化 | once at ≤ 50 % HP | 1.0 s | armor ×2 for 8 s (×2 of the full resolved `armor(w) + diff bonus`, §5.9 g); counts as a shield (Membrane Attack ends it) |
| Superbug | *capsule* (passive) | always | — | damage from `tracer` attacks ×0.5, from `chain` attacks ×1.5 (`dmgTaken`) |
| Giant Parasite | `charge` 冲撞 | t = 8 s, then every 12 s | 1.5 s (rears up) | speed ×3 for 2.0 s, ignores slows and flow, smashes barriers without pausing |
| Giant Parasite | `burrow` 钻入 | once at ≤ 60 %, once at ≤ 30 % HP | 0.5 s | untargetable and motionless 3 s (projectiles in flight miss), then re-emerges `min(len − 1, dist + 3)` (hard +4.5); segments follow; prev positions reset |
| Giant Parasite | *segmented* (passive) | always | — | a splash / acid / aura tick damages the head and up to 3 segments inside the radius (`splashZones 4`), each a full hit on the shared pool — the mast's moment |
| Virus King | `massInfection` 大规模感染 | t = 5 s, then every 15 s (hard 12 s) | 1.0 s (pulse ring) | infects every infectable tower within 3.0 cells for 10 s (hard 8 s) (beacon immunity and hero-cure immunity still protect) |
| Virus King | `mutation` 突变 | t = 8 s, then every 12 s (hard too) | 0.5 s | picks the `TowerId` with the highest damage **since the last mutation** (`dmgByTowerType`, reset after each pick); becomes **immune** to it for `clamp(4 s × share / 0.5, 2, 8)` where `share` = that type's fraction of the damage since the last pick; skipped if nothing has damaged it since; never hero/abilities. Towers of the immune type **retarget** to other enemies for the duration (§5.9 b) |
| Virus King | `shedding` 排毒 | once each at ≤ 70 %, ≤ 40 %, ≤ 15 % HP | — | spawns 2 `virus` (`spawned`) at its position |

Wave 15's Superbug and every endless boss reuse the same skills with the numbers above. On waves where two bosses
appear (endless, §8.5) the second spawns 6 s after the first.

### 3.2 Mutant Cell rules (the "mini-boss" that is not a boss)

`boss: false`. Consequences, all deliberate: T-cell `vsBoss` does not apply (but `vsSpawned` ×2 applies to the halves);
slow resist 25 %; lowFever stun works; Apoptosis executes a half below 15 % and Booster kills a marked half below 30 %;
it attacks barriers like any enemy (30 × scaling DPS) instead of smashing them. **Division** (§5.9 a): at ≤ 50 % HP the
parent is removed *without a `kill`*, a `split` event fires carrying the parent's `reward(w)` (granted, with hero XP
as for a kill), and two `mutant` enemies with `divided = true, spawned = true` appear at `dist − 0.25` and `dist + 0.25`
(clamped to `[0, len − 0.5]`) with `px = x, py = y`. Division is not counted in `stats.kills`; killing the halves is.

---

## 4. Vaccines · 疫苗 (immune memory)

Defeating a boss type for the first time (`kill` event, any map/difficulty) permanently grants its vaccine. In every
later run damage from towers, hero and abilities is ×1.25 against the family listed. Shown as 3 collectible cards.
The UI calls `grantVaccine` and **writes `memory` synchronously** when it sees `vaccineUnlocked` (§12.2).

| vaccine id | boss | also covers |
|---|---|---|
| `superbug` | Superbug | `spore`, `sporeling` |
| `giantParasite` | Giant Parasite | `parasite` |
| `virusKing` | Mutant Virus King | `virus` |

---

## 5. Formulas

### 5.1 Damage pipeline (one hit)

```
raw   = baseDmg × beaconDmg × talentDmg × (vaccineApplies ? 1.25 : 1) × min(towerDef.multCap, specialMults)
          specialMults: T-cell marked ×1.5 · boss ×1.5 · spawned ×2 ; complement regen/shield ×1.6 (membraneAttack ×2.2)
                        antibiotic: bacteria ×2 · viral ×0.5 ; apoptosis vs boss <15 % ×1.5 ; hero ×1
raw   = raw × markMult                      // §5.5 — applies to every damage source, DoTs included
raw   = raw × (enemy.def.dmgTaken?.[attackKind] ?? 1)   // Superbug capsule: tracer 0.5, chain 1.5
if (enemy.boss && enemy.immuneTo === sourceTowerType && now < immuneUntil) final = 0  (event `immuneHit`)
else if (ignoresArmor) final = raw          // perforin, aura DoT, burn, acid, clot spikes, antibiotic strike
else final = max(raw × 0.2, raw − armor)
hp -= final ; lastHitBy = source ; boss.dmgByTowerType[type] += final (bosses only, towers only)
```

Damage to a parasite segment goes to the parasite's single HP pool. Burrowed / dead / leaked enemies take nothing.
Hero damage = `heroLevel.dmg × (1 + 0.08 (wave − 1)) × talentHeroDmg × vaccine` (§6).

### 5.2 Movement and flow

```
flowFactor  = flow === 1 ? 1.3 : flow === -1 ? 0.8 : 1.0        (bosses: 1.15 / 0.9 / 1.0 ; flying: 1.0)
towerSlow   = min(0.65, Σ active slows × (1 − slowResist))        (pyrogen auras, allergy storm, each source once)
feverFactor = feverActive ? (boss ? 0.8 : 0.6) : 1
v = base × diff.speedMult × endlessSpeed × flowFactor × (1 − towerSlow) × feverFactor
if stunned or burrowed or attacking a barrier: v = 0 ;  if charging: v = base × 3 (nothing else applies)
dist += v × dt
```

**Discontinuity rule** (renderer interpolation): whenever logic sets a position in a jump — spawn, breathing push,
burrow re-emerge, division, hero respawn, barrier-smash teleport-free pauses excluded — it also sets `px = x, py = y`
(and `pdist = dist` for parasites); `spawn` creates enemies with prev = cur. Unit test: after any `step`, every enemy's
`|cur − prev| ≤ speed × 3 × dt × 1.5` unless that step emitted `spawn` / `split` / `flowReverse` / `bossSkill(burrow,
end)` / `heroRespawn` for that entity.

Alveoli breathing (`FlowState`): the timer runs only during the `wave` phase. Cycle length 12 s; `reversed` during
`[9, 12)`; `warn` during `[8, 9)`. On the reversal **onset** every ground enemy gets `dist = max(0, dist − 1.0)`
(bosses 0.5) and the `flowReverse` event fires; an enemy attacking a barrier is pushed too, gets
`attackBlockedUntil = now + 1`, and walks back to it. While reversed, segment flow `1 ↔ -1` (still stays still).

### 5.3 Infection

A virus (`virus`, Virus King mass infection, shed viruses) infects a tower when the tower's cell is within Chebyshev
distance 1 of the virus's cell, `virus.infected` does not yet contain that tower id, and `tower.immuneUntil ≤ now`.
Effect: `infectedUntil = max(infectedUntil, now + 8)` (mass infection: 10 s). Infected towers fire at ×0.5 rate;
infected pyrogens apply ×0.5 slow and DPS. Beacons, barriers never infect; towers inside an L3/spec beacon's buff
range are immune. Cures: hero centre within `heroCureRadius` (0.6; talent 1.5) of the tower centre — instant, `cure`
event, and the tower gets **`immuneUntil = now + heroCureImmunity`** (3 s; talent 5 s) so a passing virus stream cannot
undo the cure before the next step; beacon pulse (every `cureEvery` s, all towers in buff range, no immunity). Towers
within 1.0 cell of the vessel are the only ones at risk: UI shows a biohazard glyph on pads in that zone when a virus
wave is previewed. Zone = `virusRiskPads(map)`: pads and villi within Chebyshev distance 1 of any cell a virus walks
(every path cell plus the off-grid entry cell). The glyph (overlay badge at the pad's near rim) is shown in `build` /
`countdown` while the next wave's preview has `virus`, on empty pads and on pads whose tower can still be infected (not
a beacon, not inside an L3 beacon's immunity), and hidden during the wave.

### 5.4 Barriers and enemy attacks

Enemies (non-flying, non-boss) stop at `barrierDist − 0.45` (the nearest barrier ahead of them on their path) and deal
`attack(w)` DPS to the barrier continuously; Clot Spikes reflects `0.04 × attacker.maxHP` per 1 s of attacking per
enemy (tick every 1 s, armor-ignoring). The barrier's regen starts 3 s after the last damage. An enemy also damages
the **hero** at `0.25 × attack(w)` DPS while the hero is within `0.5 + radius` of it (only enemies that close count,
so a group of ten does not all hit him). Bosses on contact: `barrierSmashed`, boss stops 1.0 s. When a barrier dies
every enemy queued behind it resumes.

### 5.5 Marks

`mark = { stacks 0..3, until, strong }`. An antibody hit adds 1 stack (max 3) and sets `until = now + 4`; a hero melee
hit adds `heroMarkStacks` (1; talent 2) the same way; a Neutralizing hit sets `strong = true`, `until = now + 7`,
stacks = 3. `markMult = strong ? 1.35 : 1 + 0.10 × stacks`. Expired marks reset to 0. Interactions: T-cell ×1.5,
macrophage prefers marked and gets +50 % engulf threshold, complement jumps 2.4 (3.0 Long Chain) between two marked
enemies, Booster kills marked non-boss enemies below 30 %. Moving the hero onto a boss therefore feeds the T-cells.

### 5.6 Regen, heal, DoT

Per second (applied per tick ×dt): regen `+maxHP × regen` (biofilm 0.03, mutant 0.01, Superbug 0.01), heal aura from
one biofilm `+maxHP × 0.02`; both suppressed while `regenSuppressedUntil > now` (Membrane Attack). Burns/acid/aura DoT
are armor-ignoring and subject to `markMult`. Max 3 burn instances per enemy (oldest replaced).

### 5.7 Hero XP and levels

Every kill (any source) while the hero is alive: +1 XP; +3 instead if the hero dealt the killing blow *or* the kill was
within 2.5 cells of the hero; boss kill +15; mutant division counts as a kill here. Level 2 at **40** XP, level 3 at
**110** XP (cumulative). Level-up heals to the new max HP and fires `heroLevel`.

### 5.8 Stars

On `mapCleared` (wave 20 cleared, not endless): `stars = 1 + (vitLost ≤ floor(0.5 × maxVit) ? 1 : 0) +
(vitLost ≤ floor(0.1 × maxVit) ? 1 : 0)` where `stats.vitLost` is the **total vitality lost to leaks over the run**
(normal: 2★ ≤ 10 lost, 3★ ≤ 2 lost; hard: ≤ 7 / ≤ 1). Healing (`tissueRepair`) keeps you alive but never improves
stars; the talent text says so. Stored as the max per `(map, difficulty)`. `totalStars = Σ maps (normal + hard)` (max 24).

### 5.9 Edge rules (decisions a programmer must not have to invent; mirrored as comments in `types.ts`)

| # | question | rule |
|---|---|---|
| a | Mutant division: reward, XP, placement, stats | §3.2: parent removed without `kill`; `split` event carries and grants `reward(w)` + hero XP; halves at `dist ∓ 0.25` with prev = cur; not a `stats.kills` entry |
| b | Tower vs mutation-immune boss | Towers of the immune type exclude the boss from target selection (it is untargetable *for them*) and shoot escorts; with nothing else in range they idle. `immuneHit` fires only for projectiles already in flight, splashes and DoT ticks that land during immunity. The boss still loses that type's DPS (that is the mechanic); escorts just die faster |
| c | Is the mutant a boss? | No (`boss: false`), §3.2 |
| d | Aura `rate` | `rate = 0` for pyrogen, beacon, barrier rows; pyrogen slow / DPS and clot contact are applied every step × dt; beacon cure uses `cureEvery` |
| e | Parasite range test | in range when the head or any segment is within range; the hit lands on the nearest hit zone; damage goes to the shared pool |
| f | Polyvalent extra targets | the 2 nearest other *targetable* enemies within 1.5 cells of the primary target (not the tower's range) |
| g | Shell hardening | armor ×2 of the fully resolved armor (`armor(w) + diff.armorBonus + endless`), for 8 s; Membrane Attack ends it |
| h | Hero attacks while walking? | No: the hero attacks only while `dest === null`; cures happen while walking (pass-through) |
| i | Barrier on an occupied path cell | allowed on any legal path cell at any time; enemies with `dist ≥ barrierDist − 0.45` at build time are past it and unaffected; the rest stop at the front when they reach it |
| j | Spore killed by execute / Booster / antibiotic | splits (only engulf prevents the split); the halves of a Booster-executed mutant are normal kills |
| k | Chain ground ↔ flying | allowed in both directions (complement hits flying) |
| l | Chain / polyvalent vs unrevealed stealth | never selected as a target or a jump; splash/aura/acid still damage it |
| m | Splash vs segmented bodies | regular parasite: one hit per splash (`splashZones 1`); Giant Parasite: head + up to 3 segments inside the radius (`splashZones 4`) |
| n | Several barriers on one path | an enemy stops at the first barrier ahead of it; the next one only after that dies |
| o | Burrowed boss | untargetable, takes nothing, projectiles in flight expire (`done`), DoTs pause |
| p | Tie-breaks | lowest enemy id everywhere (targeting, chain, polyvalent, engulf) |
| q | Spawned flag | spores from a Superbug, their sporelings, shed viruses and mutant halves are `spawned` (T-cell ×2); scripted spores' sporelings too |
| r | Hero death vs marks / reveal | a dead hero reveals nothing and marks nothing; respawn at his post beside the core (§6, `MapInfo.heroX/heroY`) with prev = cur |
| s | Sell while infected / digesting | allowed; refund unchanged |
| t | Early call during a boss telegraph | not applicable (bosses only exist in `wave`); early call is only possible in `countdown` |

---

## 6. Hero · 小白 Blanc (neutrophil)

| level | HP | dmg (w1; `× (1 + 0.08 (w−1))`) | rate/s | attack range | move speed | XP to next |
|---|---|---|---|---|---|---|
| 1 | 120 | 12 (w5 15.8 · w10 20.6) | 1.5 | 1.2 | 2.6 | 40 |
| 2 | 180 | 18 (w10 31 · w15 38) | 1.6 | 1.3 | 2.6 | 110 (cumulative) |
| 3 | 260 | 26 (w15 55 · w20 65.5) | 1.8 | 1.4 | 2.6 | — |

- Talents (§10.1): `toughBlanc` HP ×1.4 · `sharpBlanc` dmg ×1.25, melee applies **2** mark stacks, reveal radius
  2.0 → **3.0** · `rapidResponse` respawn 15 → 8 s, move ×1.2, cure radius 0.6 → **1.5**, cure immunity 3 → **5 s**.
- Movement: the bottom-bar portrait (≥ 48 px) is the canonical entry to "move mode" (`interaction = 'heroMove'`);
  tapping the hero model also works. In move mode the next map tap sends the hero to that point (terrain, pads and
  path are all walkable; a tap on a tower sends him to that tower's cell — the cure gesture; the hero never blocks
  enemies) and **exits move mode**. Tapping the portrait again, any bottom-bar button, the back gesture or a tap
  outside the map cancels. Dragging from the portrait onto the map and releasing is the same move in one gesture.
  A new destination replaces the old one. `heroMove` is emitted only by a successful `moveHero`; the renderer draws the
  destination marker from `HeroView.destX/destY`.
- Attack: instant melee on the nearest enemy within range, only while idle (§5.9 h); hits flying; **each hit applies
  `heroMarkStacks` mark stacks** (§5.5). Prions within `heroRevealRadius` of the living hero are revealed to everyone.
- Cure: any infected tower whose centre is within `heroCureRadius` of the hero is cured instantly and gets
  `heroCureImmunity` seconds of infection immunity (§5.3).
- Damage taken: §5.4 (×0.25 of enemy attack). Out of combat (3 s without damage) regen **8 % maxHP/s**. At 0 HP:
  `heroDeath`, body fades, respawns at his **post** after 15 s (talent 8 s) with full HP (`heroRespawn`). Dead hero
  reveals nothing.
- Starts each run at his **post**, level 1, 0 XP. Hero level/XP are per run (not persistent). The post
  (`heroPost`, `MapInfo.heroX/heroY`) is the centre of the plain terrain cell (no path, pad, villi or core) touching the
  core (8-way) nearest the camera — largest row, then closest to the core's centre column, then the right-hand one:
  Vessel (5.5, 12.5) · Alveoli (6.5, 12.5) · Gut (6.5, 14.5) · Brain (6.5, 14.5). At the core centre he was drawn inside
  the core mesh (invisible on Brain's two-cell core; QA round 2). While dead the snapshot reports the post as his
  position, so the respawn arc is drawn where he reappears.
- Sanity: at w10 a bacterium does 3.4 DPS to him and at most 3–4 can touch him (≈ 12 DPS vs 180 HP); the Virus King does
  50 DPS, so boss-tanking lasts ~5 s — his boss job is marking, not tanking.

### 6.1 Abilities (global, big buttons with radial cooldown sweeps; all ready at run start; usable in `build`, `countdown`, `wave`)

| id | zh / en | effect | cooldown | notes |
|---|---|---|---|---|
| `fever` | 发热 Fever | every enemy −40 % speed (bosses −20 %) for 6 s | 30 s | separate multiplicative layer, bypasses the 0.65 tower-slow cap; affects flying |
| `antibiotic` | 抗生素打击 Antibiotic Strike | aim a point on the map: after 0.4 s, radius 1.5, dmg **`60 × g(wave)`** (w1 60 · w5 133 · w10 359 · w15 971 · w20 2 624), armor-ignoring, hits flying & stealth; **×2 vs bacteria family, ×0.5 vs viral and `other` (toxin clouds, mutant cells; rev. 3)** | 25 s | **drag-to-aim** (§11.2): pointerdown on the button enters `abilityTarget`, dragging onto the map moves a crosshair drawn 56 px above the fingertip with the blast ring and a live count of enemies inside, release casts; release back on the button or outside the map cancels — decided from the **raw finger point**, never
the lifted crosshair (a finger on the button or anywhere on the bottom bar, off the stage, or a crosshair under the HUD
= cancel; the hint then reads "release here cancels"); pan/zoom are disabled meanwhile. Fallback: tap the button, tap the map (same lifted crosshair), tap "确认 / Confirm" |
| `adrenaline` | 肾上腺素 Adrenaline | all towers +60 % fire rate (aura DPS too) for 8 s | 40 s | multiplies with beacon buffs |
| `booster` | 疫苗加强针 Booster | every marked non-boss enemy below 30 % HP dies instantly (`execute`); every marked boss takes a flat 8 % maxHP (armor-ignoring; neither its mark nor a vaccine multiplies it) | 45 s | unlocked by the `booster` talent; hidden (not greyed) when locked |

Cooldowns ×0.85 with the `cytokines` talent. The ability button's tooltip shows `abilityDamage(id, wave)`. Rules text
explains the realism: antibiotics do nothing against viruses, fever slows pathogen replication. At w20 one strike kills
three bacteria (1 749 HP each vs 2 × 2 624) — useful all game, never a boss killer; it no longer erases toxin clouds
(×0.5 since rev. 3), so ground-only builds cannot lean on it against flyers.

---

## 7. Run flow, phases and timing

| phase | meaning |
|---|---|
| `build` | before wave 1 (and after loading a save): unlimited time, "start wave 1" button |
| `wave` | spawning / enemies alive |
| `countdown` | wave cleared, next wave auto-starts after the countdown (12 s normal / **8 s hard**); "next wave early" grants §9.2 |
| `cleared` | wave 20 cleared; victory modal; `continueEndless` → `countdown` with `endless = true` |
| `over` | vitality 0 |

7.1 `startWave`: `wave++`, queue = expanded script (§8), `waveStart` event, boss toast if the wave has a boss.
7.2 Spawning: identical to v1 `expandWave` (per-group gap × tempo, 1.5 s between sequential groups, `parallel` groups
start together with the previous group). Tempo `max(0.6, 1 − 0.015 (w−1))`. Two-spawn maps: `spawn: 'A' | 'B' | 'alt'`
(`alt` alternates per enemy starting with A). Each spawn keeps 0.35 cells minimum spacing: if the previous enemy on
that path is still within 0.35 cells of the entry, the spawn is delayed to the next tick. No randomness anywhere.
7.3 A wave is cleared when the queue is empty and no enemy is alive (burrowed bosses count as alive).
7.4 Wave 20 cleared → `cleared` (stars computed from `vitLost`, memory updated and written, run save deleted). Endless
waves never end the run except by death; `bestEndless` = highest wave *started*.
7.5 Vitality 0 → `over` (projectiles cleared, `gameOver`), run save deleted.
7.6 Pause: UI-only (no steps); see §7.10 for the exact visibility / context-loss behaviour.
7.7 Run save is written at every `waveClear`, on pause/hide/`pagehide`/destroy when `phase ∈ build|countdown`, never
mid-wave; a mid-wave exit loses that wave's progress (the save from the previous clear remains).
7.8 Speed ×1 / ×2 persists in `prefs`.
7.9 Reaching the core: `vitality -= vit`, `stats.vitLost += vit`, `leak` event, enemy removed; a boss leaking is
still "alive" for stars purposes only in that it did not grant a vaccine.
7.10 **Frame loop contract** (UI owns it):

```
loop(frameMs):  acc += min(frameMs, 250) / 1000 × speed
                steps = 0; while (acc ≥ SIM_STEP && steps < MAX_STEPS_PER_FRAME) { step(state, SIM_STEP); acc -= SIM_STEP; steps++ }
                if (steps === MAX_STEPS_PER_FRAME) acc = 0            // never carry a burst over
                const ev = takeEvents(state)                          // exactly once per frame
                renderer.handleEvents(ev); ui.handleEvents(ev)        // same array, in this order
                if (!idleFrame) { snapshot(state, snap, acc / SIM_STEP); ui.fillOwnedFields(snap); renderer.render(snap); overlay.draw(snap) }
```

- `idleFrame`: in `build` / `countdown` with no enemies alive, no projectiles and no pending VFX the loop renders at
  `IDLE_FPS` (every other RAF) and the renderer uses the low particle count; `waveStart` returns to full rate.
- `onVisibility(false)`, `pagehide` (iOS tab kill fires it without `visibilitychange`) and the pause button: stop RAF,
  `acc = 0`, `paused = true`, write the run save when `phase ∈ build|countdown`. Resume: `acc = 0`, restart RAF (never
  an 8-step burst on return).
- `webglcontextlost`: `preventDefault()`, `paused = true`, show the "重新加载 / Reload" overlay; the sim never steps
  under it. `webglcontextrestored` or tapping the overlay button → `renderer.rebuild()` (the renderer is fully
  reconstructible from `map` + the next snapshot), then resume. While lost, `rebuild()` calls `restoreContext()` on the
  `WEBGL_lose_context` extension cached when the context was created (`getExtension` returns null on a lost context,
  so a lazy lookup — three's `forceContextRestore` — silently does nothing); when no `webglcontextrestored` arrives within
  1.5 s (no extension, or the browser keeps the context dead) it replaces the canvas and the `WebGLRenderer` and
  rebuilds every layer. The button is disabled for 2.5 s after a tap.
- `destroy()` (the shell calls it *before* the `onDestroy` callbacks): stop RAF, write the run save when allowed,
  `renderer.destroy()`, remove listeners. `onDestroy` registrations are a safety net only.

---

## 8. Wave scripts

Notation: `type×count` (short ids: bac bacterium · fla flagellate · enc encapsulated · vir virus · spo spore · par
parasite · bio biofilm · pri prion · tox toxin · mut mutant · SUP superbug · GPA giantParasite · VKG virusKing);
`;` = next group starts 1.5 s after the previous group *ends*; `+` prefix = group starts together with the previous
group (parallel); `@A`/`@B`/`@L`/`@R`/`@alt` = spawn on two-spawn maps (default `alt`; single-path maps ignore it).
Default intra-group gaps (s): bac 0.8 · fla 0.5 · enc 1.2 · vir 0.8 · spo 1.0 · par 2.0 · bio 1.2 · pri 0.9 · tox 0.7 ·
mut 3.0 · bosses 0. Boss waves: 5 / 10 / 15 / 20 on every map. The "teaches" column drives the tutorial toasts (§11.7).

**Smoothness rule** (unit test, all maps): from wave 3 on, every non-boss wave's total *effective* HP (spores counted
with their sporelings, mutants at 640 base) is ≤ 1.3 × `g(w)/g(w−1)` × the previous wave's total (≤ 1.59× at the 1.22
growth; rev. 2's "≤ 1.5×" was the same 1.3 composition step at 1.15); boss waves may exceed it. Measured max 1.29
(Gut w18). A single
mutant appears at most once per non-boss wave; the `mut×2` pairs of the first revision were a hidden second final boss
and are gone.

### 8.1 Vessel (on-ramp: one new mechanic per early wave)

| w | script | teaches |
|---|---|---|
| 1 | bac×8 | build an antibody launcher |
| 2 | bac×10; fla×6 | speed, flow arrows (slow legs) |
| 3 | enc×3; bac×6; enc×2 | armor → mast / T-cell |
| 4 | vir×6; bac×10; +fla×4 | infection → hero cures |
| 5 | **SUP**; bac×6 | boss → vaccine; complement vs the capsule |
| 6 | spo×5; bac×8; +fla×4 | splitting → macrophage engulf |
| 7 | fla×10; enc×4; vir×6 | mixing |
| 8 | par×2; bac×8 | tank → barrier + splash |
| 9 | tox×8; bac×10; enc×3 | flying → antibody / complement / T-cell |
| 10 | **GPA**; fla×8 | charge + burrow; splash vs segments |
| 11 | bio×4; enc×4; bac×10 | regen → complement |
| 12 | pri×8; vir×8; +bac×8 | stealth → beacon |
| 13 | mut×1; bac×10; fla×8 | mini-boss divides |
| 14 | spo×8; +tox×6; enc×4 | — |
| 15 | **SUP**; +bio×4; vir×8 | regen boss + healers |
| 16 | par×3; +enc×5; fla×10 | — |
| 17 | tox×10; +pri×6; bac×12; mut×1 | — |
| 18 | bio×6; +vir×10; par×3; enc×4 | — |
| 19 | bac×20; +fla×12; enc×6; +spo×4; par×2 | everything |
| 20 | **VKG**; +vir×12; pri×4; +tox×4; mut×1 | mutation immunity → mixed defense |

### 8.2 Alveoli (two spawns, breathing)

| w | script |
|---|---|
| 1 | bac×6@A; bac×6@B |
| 2 | fla×8; bac×8 |
| 3 | enc×3@A; +bac×8@B |
| 4 | vir×8; spo×3 |
| 5 | **SUP**@A; +bac×8@B |
| 6 | tox×6; fla×8; +bac×8 |
| 7 | par×2; bac×6 |
| 8 | bio×4; enc×6 |
| 9 | pri×4@A; +vir×8@B |
| 10 | **GPA**@B; +fla×10@A |
| 11 | spo×8; +tox×8 |
| 12 | mut×1@A; bac×12@B; fla×8 |
| 13 | enc×8; +vir×10; bac×8 |
| 14 | par×3; bio×4; +tox×8 |
| 15 | **SUP**@B; +pri×6@A; vir×8 |
| 16 | fla×16; +spo×8; enc×4 |
| 17 | mut×1; +enc×8; bac×10 |
| 18 | tox×14; pri×8; par×3 |
| 19 | bio×8; +par×3; bac×12; +fla×10 |
| 20 | **VKG**@A; +vir×14@B; mut×1@B; +tox×6 |

### 8.3 Gut (long path, biofilm-heavy, villi)

| w | script |
|---|---|
| 1 | bac×10 |
| 2 | bac×8; bio×1 |
| 3 | fla×10; enc×3 |
| 4 | bio×4; +vir×6 |
| 5 | **SUP**; bio×3 |
| 6 | spo×6; bio×3 |
| 7 | par×2; +bio×2; bac×5 |
| 8 | tox×8; enc×5 |
| 9 | bio×6; +fla×12 |
| 10 | **GPA**; +bio×4 |
| 11 | pri×6; +bio×4; vir×8 |
| 12 | mut×1; bio×5 |
| 13 | enc×6; +bio×4; spo×6 |
| 14 | tox×10; +par×3 |
| 15 | **SUP**; +bio×6; enc×6 |
| 16 | bio×10; +fla×16 |
| 17 | mut×1; +pri×8; bio×6 |
| 18 | par×4; +bio×6; tox×8 |
| 19 | bac×20; +bio×8; enc×8; +spo×6 |
| 20 | **VKG**; +bio×8; vir×12; +mut×1 |

### 8.4 Brain (two parallel paths, prions common)

| w | script |
|---|---|
| 1 | bac×6@L; bac×6@R |
| 2 | pri×4; bac×8 |
| 3 | fla×8; +enc×4 |
| 4 | vir×8; +pri×4 |
| 5 | **SUP**@L; +pri×6@R |
| 6 | tox×8; pri×6; +bac×4 |
| 7 | par×2; +bac×8 |
| 8 | bio×4; +pri×8 |
| 9 | spo×8; +vir×8 |
| 10 | **GPA**@R; +pri×8@L |
| 11 | mut×1; +enc×8 |
| 12 | pri×12; +tox×8; bac×8 |
| 13 | par×3; +bio×6 |
| 14 | fla×18; +pri×8 |
| 15 | **SUP**@R; +vir×12@L; pri×6 |
| 16 | mut×1; +tox×10; pri×6 |
| 17 | enc×8; +pri×8; spo×6 |
| 18 | par×3; +bio×6; pri×8 |
| 19 | bac×20; +fla×14; pri×12; +mut×1 |
| 20 | **VKG**@L; +pri×10@R; vir×12; +tox×8 |

### 8.5 Endless (w > 20), deterministic

Let `k = w − 20`, `i = k − 1` (0-based).

- Bosses when `w % 5 === 0`: `n = min(3, floor((w − 20) / 15) + 1)` bosses from the cycle
  `[superbug, giantParasite, virusKing]` starting at index `(w / 5 − 5) mod 3`, 6 s apart, each spawned `@alt`.
  Superbug sporulation spawns 4.
- Filler, four groups, sequential: `main×(10 + k)`, `second×(6 + k)`, `+third×(4 + floor(k/2))`,
  `special×(2 + floor(k/3))` where the four types come from the map's rotation lists indexed by `i mod length`:

| map | main | second | third | special |
|---|---|---|---|---|
| vessel | bac, fla, enc, vir | enc, spo, bio, tox | fla, vir, pri, spo | par, mut, tox, bio |
| alveoli | bac, fla, vir, enc | tox, spo, enc, bio | fla, tox, vir, pri | par, mut, bio, par |
| gut | bio, bac, enc, bio | bio, spo, fla, enc | vir, bio, tox, pri | par, mut, par, bio |
| brain | pri, bac, vir, fla | pri, enc, tox, spo | vir, pri, bio, fla | mut, par, pri, mut |

- Scaling: HP `g(w)` as defined (×1.06 per endless wave); speed `min(1.3, 1 + 0.01 k)`; armor `+k` for everything; rewards use the normal
  formula; `vit` unchanged. Wave bonus formula unchanged.
- Capacity: wave 50 can exceed `SNAPSHOT_CAPACITY.enemies` (160). Enemies and projectiles beyond capacity are simulated
  normally but not drawn (`count = min(n, capacity)`); the UI logs one `console.warn` per session in dev builds.

### 8.6 Wave preview

`wavePreview(mapId, wave)` returns `{ groups: {type, count}[], boss: BossId | null, flying: boolean, stealth: boolean,
virus: boolean }` for the HUD icons and the pad warnings. Every script above must satisfy the unit tests "all 80
scripted waves expand to ≥ 1 enemy; boss waves 5/10/15/20 contain exactly the listed boss; smoothness rule (§8)".

---

## 9. Economy

### 9.1 Difficulty

| | normal | hard |
|---|---|---|
| vitality (max) | 20 | 15 |
| start ATP | 220 | 180 |
| enemy HP | ×1.0 | **×1.25** (rev. 3; ×1.3 at the new `g` left 1 of 12 hard runs clearable for the best bot) |
| enemy speed | ×1.0 | ×1.08 |
| enemy armor | +0 | **+1** |
| rewards (kills, wave bonus) | ×1.0 | ×0.85 |
| early-call bonus | ×1.0 | ×0.85 **× 1.5** (hard rewards tempo: the one shape-free lever that changes how it plays) |
| boss skill `firstAt` / `every` / `duration` | ×1.0 | ×0.8 (mass infection 12 s / 8 s; **mutation exempt**, so the top tower's uptime ratio is unchanged) |
| countdown between waves | 12 s | **8 s** |

Talents add: `reserve` +40 ATP, `deepReserve` +80 ATP (start ATP), `tissueRepair` +1 vitality per cleared wave (cap max;
never affects stars). Bot acceptance for hard: waves 18–20 time-to-kill ≤ 2 × normal's with the same build order.

### 9.2 Income

- Kill reward: §3 formula (`reward(w)`), granted on kill (engulf and execute included; leaks grant nothing); mutant
  division grants the parent's reward (§3.2).
- Wave clear bonus: `round((25 + 6 × wave) × diff.rewardMult)` — wave 1: 31, wave 10: 85, wave 20: 145 (normal).
- Interest (talent `metabolism`): at wave clear `floor(min(60, 0.03 × unspent ATP))`, after the wave bonus.
- Early-call bonus: `ceil(remaining × (1 + 0.25 × wave) × diff.rewardMult × diff.earlyBonusMult)` where `remaining` is
  the countdown left (max 12 s). Wave 5 with 12 s left: 27; wave 15: 57 (hard, 8 s left: 49).
- Sell: `round(0.7 × invested)`.
- Reference total on Vessel normal with a clean run and the early call used at half the countdown on average:
  **ATP available before wave 1 / 5 / 10 / 15 / 20 = 220 / 727 / 1 880 / 3 707 / 6 373; ≈ 7 520 after wave 20**
  (kills ≈ 5 100, wave bonuses 1 760, early ≈ 440). That buys ≈ 21 towers mostly at L3 across 25 pads (§15). Hard
  yields ≈ 6 500.

### 9.3 Tower cost summary (build / L2 / L3 / total)

antibody 60/45/80/185 · macrophage 80/60/100/240 · mast 100/80/130/310 · pyrogen 75/55/95/225 · tcell 160/120/190/470 ·
complement 140/100/165/405 · beacon 90/65/110/265 · barrier 25/25/40/90.

---

## 10. Immune memory · 免疫记忆 (persistent)

### 10.1 Talent tree 「抗体谱」 — 12 nodes, paid with stars, total **28** (24 obtainable → a full tree needs trade-offs)

| id | zh / en | tier | cost | requires | effect |
|---|---|---|---|---|---|
| `affinity` | 抗体亲和 Affinity | 1 | 1 | — | tower damage +5 % |
| `reserve` | 能量储备 ATP Reserve | 1 | 1 | — | start ATP +40 |
| `platelets` | 血小板增殖 Platelet Boost | 1 | 1 | — | barrier HP +30 % |
| `toughBlanc` | 强韧小白 Tough Blanc | 1 | 1 | — | hero HP +40 % |
| `maturation` | 亲和成熟 Affinity Maturation | 2 | 2 | affinity | tower damage +10 % (total +15 %) |
| `metabolism` | 新陈代谢 Metabolism | 2 | 2 | reserve | interest: +3 % of unspent ATP per cleared wave (cap 60) |
| `cytokines` | 细胞因子 Cytokines | 2 | 2 | platelets or toughBlanc | ability cooldowns −15 % |
| `sharpBlanc` | 敏锐小白 Keen Blanc | 2 | 2 | toughBlanc | hero melee applies 2 mark stacks, reveal radius 3.0, hero damage +25 % |
| `tissueRepair` | 组织修复 Tissue Repair | 3 | **4** | platelets or metabolism | +1 vitality per cleared wave (cap max) — survival only, stars still count every leak |
| `deepReserve` | 深层储备 Deep Reserve | 3 | **4** | metabolism | start ATP +80 (total +120) |
| `rapidResponse` | 快速响应 Rapid Response | 3 | **4** | sharpBlanc | hero respawn 15 → 8 s, move speed +20 %, cure radius 1.5, cured towers immune 5 s |
| `booster` | 加强针 Booster | 4 | **4** | cytokines and ≥ 6 nodes bought | unlocks the Booster ability |

Available points = `totalStars − Σ cost of bought nodes`. **Respec**: one button refunds every node (points return;
no cost); nodes whose prerequisites are lost are refunded automatically. The tree is drawn as 4 rows with connector
lines; a node is `bought`, `available` (affordable and prerequisites met), `locked` or `unaffordable`.

### 10.2 Vaccine cards — §4; the card shows boss art, name, "+25 % vs …" and the date/wave of the first kill.

---

## 11. UI flows

### 11.1 Start screen (`screen = 'start'`)

Big icon 🦠, title, one-line description; **organ carousel** (horizontal snap scroll, one card ≈ 78 % width): organ
name, star row `★★☆` for the selected difficulty, best endless wave, 1-line description, lock badge ("6 ★ to unlock")
for Brain; **difficulty** segmented control (hard greyed with "clear on normal first" until unlocked); 「免疫记忆」
button (opens the memory sheet: tabs *talents* / *vaccines*, available points, respec button with confirm);
**Continue run** primary button when a valid run save exists for *any* map (card shows "next: wave N", N = the wave the
run continues with = `state.wave + 1`; after clearing wave 20 and choosing endless that is 21), else **Play**.
The renderer chunk is prefetched with an idle-time `import()` on the start screen; until it resolves the Play button
shows a progress state (`loading` key) instead of stalling (§11.10). Quality selector (auto / high / low) lives in the
rules sheet footer. Selected map/difficulty persist in `prefs`.

### 11.2 Game screen

- Canvas (Three.js) fills the area under a compact HUD; DOM overlays on top; `touch-action: none`.
- **HUD top**: `wave x/20` (endless: `wave x ∞`) + next-wave preview: **at most 4 type icons with counts plus a
  `+n` chip**; the boss / flying / stealth / virus glyphs live **inside the wave button**, not the HUD; `♥ vitality/max`;
  `⚡ ATP`. The HUD may wrap to two 28-px rows at 390 px in English. Header status (`ctx.setStatus`):
  `organ · difficulty · wave x`.
- **Bottom bar**: two rows of fixed **48 px** buttons with 8 px gaps above the safe area: row 1 hero portrait (HP bar,
  level pips, respawn countdown when dead; tapping enters move mode, §6) + 3–4 ability buttons with radial cooldown
  sweeps; row 2 speed ×1/×2 toggle, pause, and the wave button: `start wave N` (build), `next wave early · +bonus` with
  the countdown (countdown), `wave N in progress` disabled (wave), carrying the preview glyphs.
- **Tap routing** (slop 8 px distinguishes tap from drag/pinch): `renderer.pick(sx, sy)` resolves hero → tower → pad →
  path cell → terrain against pick proxies (§11.8). `interaction` modes: `none` (default routing), `heroMove` (§6),
  `abilityTarget` (§6.1; pan/zoom disabled). The UI copies `interaction`, `selection` and the cursor into the snapshot
  every frame so the renderer dims / draws rings consistently.
- **Build strip** (tap an empty pad or a legal path cell): a **single-row horizontal strip (~96 px)** docked above the
  bottom bar with 7 cards (barrier card alone for a path cell): icon, name, cost; greyed when unaffordable; the
  highlighted card's role line appears on one detail line under the strip. Opening it calls `renderer.centerOn(pad)`
  (clamped, 250 ms) so the pad sits in the visible strip above the sheet. **Tap a card → ghost model + range disc on the
  pad (`selection.previewType`) and the card turns into `建造 ✓ / Build ✓`; second tap builds.** Tap elsewhere closes
  without buying. (No immediate build: with a 70 % sell every mis-tap would cost 30 %.) At 390 px only ≈ 4.3 of the 7
  cards fit, so the strip is a horizontal scroller: its cards are built **once** per opened pad and every later change
  (preview, a blocked tap's reason, ATP crossing a cost mid-wave) updates them **in place** — rebuilding reset the
  scroller to 0 and threw the swiped-to `Build ✓` card off-screen (QA round 2). A previewed card cut at an edge is
  scrolled just fully into view toward that edge (`ui/scroll.ts`), so the spot just tapped stays on it.
- **Tower panel** (tap a tower): docked at the bottom, camera auto-panned so the tower stays visible above it; compact
  two-row header (name / level pips / spec badge; `dmg · rate · range · DPS` computed by `towerStats` for the relevant
  wave), extras collapsed behind an ⓘ toggle, kills, upgrade button with cost (at L2 → L3 it opens the two
  **specialization cards** as a half-height sheet with 2-line deltas; tap-elsewhere closes without buying), targeting
  toggle (cycles first / strongest / marked; hidden for pyrogen, beacon, barrier), sell button with a 400 ms
  arm-then-confirm (v1 pattern), infection badge with remaining seconds, immunity shield glyph, barrier HP bar.
- **Hero**: §6 (portrait is the canonical entry; tap-on-tower-in-move-mode = cure gesture).
- **Floating text** on the 2D overlay (projected with `renderer.project`): damage numbers (≥ 10, throttled to 30 at
  once), `+ATP`, `cured`, `engulfed`, `execute`, boss skill names at telegraph. A tower's status labels (`infected!` /
  `cured`) are keyed by tower id: one live label per tower, a new one replaces it in place and the same text is not
  restarted within 1.2 s (mass infection with beacons curing every 1–2 s used to pile them into unreadable clusters).
- **Pause**: header ⏸ / ▶; overlay with resume, restart (confirm), rules, quality, home (writes run save when allowed);
  its buttons (and the start screen's secondary buttons) are ≥ 44 px tall (the shell's `btn-md` is 43 px).
- **No WebGL**: the loading overlay says so and offers only **Home** (nothing to retry), and the run is discarded — no run
  save is written, so the start screen never offers "Continue" on a device that cannot play.
- Boss toasts at wave start (`bossIncoming`), vaccine unlock toast + card flash. Tutorial toasts: ≥ 6 s, tap to dismiss,
  never shown while a boss toast is up. Toasts dock at the **bottom** of the map strip, just above the bar and whatever
  is docked on it (sheet / move-aim hint), so spawns, the first legs and the pads a tutorial talks about stay visible;
  the card lets taps through to the map and only its 44 px ✕ dismisses it. The boss toast waits until the renderer's
  wave banner is gone (`renderer.bannerShowing`, renderer clock — independent of game speed and frame rate).
- Text ≥ 12 px everywhere in the game chrome and overlay labels; touch targets ≥ 44 px (sheet ✕ as a 44 px hit box
  drawn 36 px, HUD wave button 44 px tall with no vertical HUD padding).

### 11.3 End of run

- `cleared`: modal — organ, difficulty, stars earned (animated ★), vitality lost, kills, `newBest` note when
  `recordRun(...).newStars` is true, buttons: continue endless (primary), home, new game. Memory updated and written
  before the modal opens.
- `over`: modal — wave reached, kills, best endless note (`newEndless`), buttons: retry (primary), new game, home.

### 11.4 Persistence keys (`ctx.storage`)

| key | value |
|---|---|
| `memory` | `ImmuneMemory` (§12.2) — **single source of truth** |
| `run` | `RunSave` (§12.1) or absent |
| best modes | `recordBest('stars:<map>:<diff>', stars)`, `recordBest('endless:<map>:<diff>', wave)` — write-only mirrors for the shell's home cards, re-derived from `memory` on load, never read back by the game |

Legacy v1 keys (`map`, `diff`, `speed`, `cleared:*`, bests like `scurve:normal`) are ignored; `map`/`diff`/`speed`
are removed on first load. `memory` goes through `parseMemory` (lenient, §12.2); `run` is strict (§12.1).

### 11.5 Rendering hand-off

The renderer never reads `GameState`: once per frame the UI calls `snapshot(state, snap, alpha)` (struct-of-arrays,
preallocated by `createSnapshot`; `SNAPSHOT_CAPACITY` = 160 enemies, 1 024 segments, 256 projectiles, 40 towers; the
40 `TowerView` objects are reused) and the renderer draws `snap`. `takeEvents(state)` is a **swap of two preallocated
arrays** (double buffer): the UI drains it exactly once per frame, passes the same array to `renderer.handleEvents`
and then to its own sound/haptics/toast handlers; the array is valid until the next call. Positions carry `prev` and
`cur` per entity; the renderer lerps with `alpha = accumulator / STEP` (discontinuity rule §5.2). `Projectile.t` is the
flight progress and `arcHeight` the arc peak; the snapshot exposes `h = 4 · arcHeight · t · (1 − t)`.

### 11.6 Quality and battery

`auto` (default): start high; measure the mean frame time over the first 2 s of wave 1 **and again over the first 2 s
of wave 5** (wave 1 is the lightest); if < 45 fps drop to low (no shadows, pixel ratio 1, 500 flow particles instead of
1 200) and remember for the session. `high`/`low` force it. Idle frames (§7.10) run at 30 fps with the low particle
count regardless of quality.

### 11.7 First-run tutorial — 5 contextual toasts (each shown once; ids stored in `memory.tutorialSeen`)

| id | when | zh / en |
|---|---|---|
| `tut_build` | first `build` phase | 点亮的膜垫可以建造免疫细胞；血流箭头方向的敌人更快，逆流更慢 / Glowing pads hold immune cells; enemies with the flow are faster, against it slower |
| `tut_infect` | first virus spawned | 病毒会感染相邻的塔。点小白头像，再点那座塔，让它去治疗 / Viruses infect towers next to the vessel. Tap Blanc's portrait, then the tower, to cure it |
| `tut_barrier` | first parasite spawned | 血小板屏障可以建在血管上，把敌人堵住给塔打 / A platelet barrier on the vessel holds enemies under fire |
| `tut_boss` | first boss wave starts | 击败首领可获得疫苗：以后每局都对它多造成 25 % 伤害 / Beat a boss to earn its vaccine: +25 % damage against it in every future run |
| `tut_mutation` | first wave-20 start | 病毒王会对伤害最高的塔种免疫几秒，混合不同的塔 / The Virus King goes immune to whichever tower type hurts it most — mix your towers |

### 11.8 Renderer contract (`ImmuneRenderer`, `CreateRenderer`, `WORLD`, `CAMERA` in `types.ts`)

- **World mapping**: `WORLD.cellSize = 1`; logic `(x, y, h)` → three.js `(x, h, y)`; floor at `y = 0`; the grid's
  top-left corner is the origin; the camera looks along +z (toward the core). Pads are discs raised `padHeight` 0.12,
  vessels are trenches `trenchDepth` 0.18 below the floor.
- **Camera**: perspective **FOV 30°, pitch 58°**, **yaw 8°** (more yaw rotates the footprint and shrinks far-row
  pads). Default framing: the row at the vertical centre of the viewport spans the **map width** (+0.5-cell margin per
  side) and the core-side 55 % of the map height (≈ 8 rows) is visible; vertical pan is allowed, pinch zoom 1×–2×, both
  clamped so the map never leaves the viewport. Yaw and perspective make the near rows wider than the fitted centre row
  (Gut (0,12) and Brain (0,13) were half off-screen), so the framing then widens until **every pad ring** (r 0.45) fits
  the viewport width (3 px margin) and shifts horizontally to centre the pads; the horizontal clamp always admits that
  pose (`setPads`). Measured at 390 × 664 / 760: pad rings span 4–386 px on Gut / Brain, far discs ≥ 42 px. `centerOn(x, y, fy)` pans (250 ms) so a world point lands at a screen
  fraction of the visible strip (used by the build strip and the tower panel).
  Why these angles: with 8 visible rows the far/near scale ratio of the strip is `(D + 4 cos 58°) / (D − 4 cos 58°)`
  = 1.40 (D = 12.7 cells for a 30° FOV); at 390 px a 10-column map gives 35.5 px/cell at the centre row and 25.4 at
  the far row, so a 0.7-cell pick disc (1.4 cells) is 42.5 px there (46.8 px on 9-column Vessel). The brief's 55°/35°
  would give a 1.57 ratio and a 35 px far disc with a 0.6 disc — below target.
  **Unit test** (pure camera maths, no WebGL): at 390 px width, zoom 1, default framing, the farthest *visible* pad
  row's pick disc projects to ≥ `CAMERA.minFarPadPx` (40) CSS px on every map — the 44 px touch target is met through
  the proxies, not the pad mesh. Adjacent pads (Alveoli (1,2)/(1,3), Brain (4,0)/(5,0)) overlap discs; the nearest
  centre wins, so each keeps a ≥ 0.5-cell-wide exclusive zone. `camera.test.ts` also asserts every pad ring is fully
  on screen at 390 × 664, 390 × 760 and 820 × 1130.
- **Picking** (`pick(sx, sy)`): raycast against invisible proxies, never the floor plane (under a 58° camera a floor hit
  on a tall tower lands half a cell behind it): a disc of radius 0.7 on every pad (at pad height), a capsule of radius
  0.45 and the level's `towerHeight` per built tower, a sphere of radius 0.5 around the hero, a flat quad per path
  cell, the floor last. Resolve by priority hero > tower > pad > path > terrain; when a pad wins, snap to the nearest
  pad centre within 0.75 cells. The UI routes the result (§11.2).
  **Tower vs the path cell behind it** (`render/pick.ts`, `pick.test.ts`): each tower has a second, slimmer proxy — its
  *body*: a capsule of the type's `BODY_PICK_RADIUS` (0.3 T-cell / beacon … 0.45 macrophage / barrier; thin lances and
  emblems excluded) from the base to the model's **silhouette top** (body + floating spec emblem, ≈ 1.6 at L3). A body
  hit always picks that tower (nearest body first, so a tower's body seen through another's capsule margin wins too).
  A ray that only grazes a pick capsule picks the tower as well, unless at trench depth it lands in an *empty path cell*
  other than the tower's own — under the 58° camera a tower's capsule overhangs the cell behind it, and the strips of
  that cell visible beside / above the model belong to the cell (barrier strip). The cell's centre behind a tall tower
  is *drawn behind the model*, so it picks the tower: round 1's "the inner ±0.32 of the path cell wins" opened the
  barrier strip from the upper half of L3 towers on 9 of 11 Vessel row-2/5/8 pads (QA round 2). Measured at 390 × 664
  (Vessel, zoom 1): every tap on the projected axis from 0.2 to the silhouette top (±0.15 beside it) picks the tower;
  the path cell behind keeps 26–51 % of its screen area (240–630 px²) behind an L3 T-cell / beacon / Long Chain, 16–36 %
  behind a Low Fever pyrogen, ≥ 55 % (its far half included) behind an L1 tower; pinch zoom (2×) quadruples those strips.
- **Projection** (`project(x, y, h, out)`): returns false when off-screen; used for HP bars, floating text and the
  ability crosshair's enemy count.
- **Events**: `handleEvents` receives the frame's drained array (§11.5). **State**: `render(snap)` draws only what the
  snapshot and the renderer's own VFX lists contain; `rebuild()` recreates every GPU resource from `map` + the next
  snapshot (context restore). `setQuality`, `setTheme` (dark = deep plum, light = warm rosy; UI chrome follows the app
  tokens), `resize` (orientation / sheet open), `stats()` for the smoke test, `destroy()` disposes everything.
- **Module**: `renderer.ts` default-exports `createRenderer: CreateRenderer`; it is the only file that imports
  `three`, with **named imports only** (tree-shakes to ~350–450 KB; the single-file build grows by that much, which the
  build script output documents). `logic.ts` never imports it, so vitest stays in the node environment.

### 11.9 Rendering budget (`RENDER_BUDGET`; smoke test asserts `stats().calls ≤ 150` with 60 enemies + 20 towers)

- Towers: per (type, level, spec) the primitive parts are merged into one `BufferGeometry`
  (`BufferGeometryUtils.mergeGeometries`) with vertex colours and an emissive-mask attribute → 1–2 draw calls per tower,
  or one `InstancedMesh` per (type, level) with per-instance colour for the spec. Infection / immunity / selection are
  per-instance attributes, never material swaps.
- Enemies: one `InstancedMesh` per `EnemyId` (parasite segments as instances); hit flash and death dissolve are
  per-instance attributes (`dissolve` progress kept in a renderer-side list fed by `kill`/`split`/`engulf` events).
- Flow particles: a single `Points` geometry with per-particle (segment, phase) attributes animated in the vertex
  shader from a time uniform; breathing reversal negates a direction uniform; fever scales the speed uniform.
- Chain lightning: one preallocated `LineSegments` buffer (64 chains × 8 segments) updated in place; tracers reuse it.
- Projectiles: one `InstancedMesh` per kind from the SoA buffer; floating text and HP bars on the 2D overlay.
- Lighting: hemisphere + one directional; shadows only on high; pixel ratio ≤ 1.5 (2 on high) ; ACES, fog.
- No per-frame allocation in `render`, `snapshot`, `step` or `takeEvents` (a test wraps a wave at ×2 and asserts the
  heap delta is bounded). `perf.test.ts` (V8 `gc()`): 20 000 `snapshot` + `takeEvents` calls on a crowded wave-19
  state grow the heap < 200 KB (one boxed double per call would be 320 KB — megamorphic double loads such as
  `ENEMIES[e.type].slowResist` or `levelStats(...).range` box, so the snapshot reads them from flat typed tables), and a
  whole wave at ×2 through the frame-loop contract retains < 1 MB. Events are objects by design (`emit`).
- Terrain: the floor heightfield is fine (5 samples / cell) only over the map ±1.6–2 cells and ≈ 1 sample / cell in
  the rest of the margin: Vessel idle 49.6k → 34.6k triangles (11 → 14 fps in SwiftShader at DPR 2 — an *empty* map).
- SwiftShader (headless Chromium's CPU rasteriser) is **fill-bound** and not representative of a phone GPU; QA round 2
  measured 4.7–5.2 fps for 20 L3 towers + ≈ 30 enemies at DPR 2 on high (JS < 0.1 ms / frame, 33–46 draw calls), the
  auto probe dropping the canvas 780 → 585 → 390 px wide as specified. Per-layer cost of that scene (layer hidden, same
  frame, rAF counted over 3 s; ±0.3 fps noise): the full-screen floor is the only large item (5.1 → 7.3 fps hidden;
  an unlit floor material 4.3 → 5.6, so most of it is per-pixel Lambert lighting over ≈ 1 M px), shadows / flow particles
  / towers / overlay canvas ≤ the noise each, an empty scene 20.5 fps (clear + compositing). DPR 2 → 1.5 ≈ +40 %. No
  change made: a baked-lighting floor for the low tier is the next lever if a real mid-range phone misses 45 fps with
  the auto tier (probe on hardware first).

### 11.10 Bundle and first load

`three@0.182` is lazy-loaded with the game chunk (`registry.load`), prefetched on the start screen during idle time,
and the Play button shows progress until the module resolves. `build:single` inlines it (documented growth). No other
new dependency.

---

## 12. Save schema (exact TypeScript shapes in `types.ts`)

### 12.1 Run save (`run`) — `RUN_VERSION = 2`, strict

`RunSave { v: 2; savedAt: number (ms epoch); mapId; difficulty; state: SerializedGameState }` where
`SerializedGameState = Omit<GameState, 'map' | 'geoms' | 'events'>`. Loading rebuilds `map`/`geoms` from `mapId`, sets
`events = []`, re-applies the current `ImmuneMemory` modifiers (so new talents count), validates `phase ∈ build |
countdown`, every tower on a legal cell and `nextId` above every id; otherwise the save is dropped. Any `v ≠
RUN_VERSION` is dropped (losing a mid-run save is cheap). `rng` is stored but currently unused (conventions).
`stats.recorded` (what `recordRun` already added to the memory at the wave-20 clear, set by `noteRecorded`) travels with
an endless run so a later game over — even after a reload — counts neither the run nor its cleared part twice; it is
read leniently (absent → null, values clamped to the run's own counters).
Determinism test: same seed + same scripted command list → identical `serialize()` output after 20 waves and after a
save/load round trip at wave 10.

### 12.2 Immune memory (`memory`) — `MEMORY_VERSION = 2`, lenient

```
ImmuneMemory {
  v: 2
  stars:       { vessel: {normal, hard}, alveoli: …, gut: …, brain: … }   // 0..3 each
  bestEndless: { vessel: {normal, hard}, … }                              // highest wave started, 0 = never
  vaccines:    { superbug: boolean, giantParasite: boolean, virusKing: boolean }
  vaccineDates:{ superbug?: number, … }                                  // ms epoch of first kill (card footer)
  talents:     TalentId[]                                                 // bought nodes
  tutorialSeen: TutorialId[]
  prefs:       { map: MapId, difficulty, speed: 1|2, quality: 'auto'|'high'|'low' }
  stats:       { runs, kills, bossKills, wavesCleared, playtime (s) }
}
```

`parseMemory(raw)`: accepts any object whose `v` is a number `≤ MEMORY_VERSION`; runs `migrateMemory(raw)` (a chain
of per-version steps, empty today; a v1-era blob has no `v` and is discarded), fills every missing field from
`defaultMemory()`, clamps stars to 0..3 and endless bests to ≥ 0, drops unknown talent / tutorial ids and talents whose
prerequisites are missing, and returns the result. It returns null **only** when `v` is missing, non-numeric or newer
than the build. Permanent progression is therefore never lost to a schema bump; only run saves are strict.
`memory` is written: at `vaccineUnlocked` (synchronously, via `grantVaccine`), at `mapCleared` / `gameOver` (via
`recordRun`, before the modal), on talent purchase / respec, on tutorial toast shown, and on pref changes. `totalStars`
and `pointsAvailable` are derived, never stored.

---

## 13. Fun checklist (what the bots and the reviewer verify)

1. Waves 1–6 on Vessel each introduce one mechanic (§8.1) and are clearable with ≤ 3 tower types.
2. A single-type defense fails on every map (bot pass: waves 6–17, average 9.6–14.8, §15.1): armor (enc, Superbug) breaks antibody spam; toxin clouds
   break mast/pyrogen/macrophage spam; prions break everything without a beacon (chains no longer leak onto them);
   biofilm healing breaks low DPS. Re-run the single-type bot per tower type after every number change.
3. Boss waves need a plan, and the plan differs per boss: Superbug wants complement (capsule ×1.5, regen suppression)
   + macrophage (spores); Giant Parasite wants mast (4 zones per splash) and slows before the charge, no barrier in
   its first 8 s; Virus King wants ≥ 3 damage types (mutation share) and beacons near the core. A T-cell-only boss plan
   is at most ~1.6× faster than a diversified one at equal spend (§15), never 3×.
4. Hard: the hero-centric bot clears ~60 % of fresh hard runs with 1–2 ★ (Brain 0 %), every bot without the active
   hero, marks and smart abilities clears ≤ 8 % (§15.1); waves 18–20 ≤ 2× normal's time-to-kill; 3 stars on hard Brain
   is the end goal.
5. The hero always has something to do: cure (virus waves, with immunity so it sticks), reveal (prion waves), mark
   bosses for the T-cells, finish marked stragglers near the core.
6. Stars are earned, not healed: 3★ means ≤ 2 leaks all run on normal.
7. Tuning knobs, in order of preference: `g` growth base (1.22), start ATP, boss base HP, tower costs. Never tune
   by changing wave *shapes*; keep the smoothness rule green. Re-run the §15.1 bot pass after every change.

---

## 14. Canonical ids and display names (i18n keys use these suffixes; zh and en key sets must be identical)

Key patterns: `map_<MapId>`, `mapDesc_<MapId>`, `tower_<TowerId>`, `towerDesc_<TowerId>`, `spec_<SpecId>`,
`specDesc_<SpecId>`, `enemy_<EnemyId>`, `ability_<AbilityId>`, `abilityDesc_<AbilityId>`, `talent_<TalentId>`,
`talentDesc_<TalentId>`, `skill_<BossSkillId>`, `vaccine_<BossId>`, `tut_<id>`, plus the generic UI keys the UI builder
defines (`rules` mandatory; this revision also needs `buildConfirm` 建造 ✓ / Build ✓, `confirm`, `loading`,
`reload` 重新加载 / Reload, `aimHint` 拖到目标上松手 / Drag onto the target and release, `moveHint`, `cancelMove`,
`inside` {n} 个敌人 / {n} enemies, `immune` 免疫 / Immune, `vitLost`). Common dictionary keys (`play`, `restart`,
`pause`, `resume`, `best`, `wave`, `lives`, `difficulty`, `hard`, `win`, `lose`, `newBest`, `home`, `retry`, `newGame`,
`continue`, `confirm`, `cancel`) are reused. Every user-visible string goes through `ctx.t`.

| group | id | zh | en |
|---|---|---|---|
| map | vessel | 血管 | Vessel |
| map | alveoli | 肺泡 | Alveoli |
| map | gut | 肠道 | Gut |
| map | brain | 脑 | Brain |
| tower | antibody | 抗体发射器 | Antibody Launcher |
| tower | macrophage | 巨噬细胞 | Macrophage |
| tower | mast | 肥大细胞 | Mast Cell |
| tower | pyrogen | 发热节点 | Pyrogen Node |
| tower | tcell | 杀伤T细胞 | Killer T-Cell |
| tower | complement | 补体级联 | Complement Cascade |
| tower | beacon | 干扰素信标 | Interferon Beacon |
| tower | barrier | 血小板屏障 | Platelet Barrier |
| spec | polyvalent / neutralizing | 多价抗体 / 中和抗体 | Polyvalent / Neutralizing |
| spec | fastDigestion / enzymes | 吞噬加速 / 消化酶 | Fast Digestion / Enzymes |
| spec | allergyStorm / histamineBurn | 过敏风暴 / 组胺灼烧 | Allergy Storm / Histamine Burn |
| spec | highFever / lowFever | 高热 / 低烧 | High Fever / Low Fever |
| spec | perforin / apoptosis | 穿孔素 / 凋亡诱导 | Perforin / Apoptosis |
| spec | longChain / membraneAttack | 长链 / 膜攻击 | Long Chain / Membrane Attack |
| spec | alarm / potentiate | 警报 / 免疫增强 | Alarm / Potentiate |
| spec | fibrin / clotSpikes | 纤维蛋白 / 凝血刺 | Fibrin / Clot Spikes |
| enemy | see §3 | 普通细菌 鞭毛菌 荚膜菌 病毒 孢子 孢子体 寄生虫 生物膜 朊病毒 毒素云 癌变细胞 超级细菌 噬菌巨虫 变异病毒王 | Bacterium Flagellate Encapsulated Virus Spore Sporeling Parasite Biofilm Prion Toxin Cloud Mutant Cell Superbug Giant Parasite Mutant Virus King |
| ability | fever / antibiotic / adrenaline / booster | 发热 / 抗生素打击 / 肾上腺素 / 疫苗加强针 | Fever / Antibiotic Strike / Adrenaline / Booster |
| talent | see §10.1 (sharpBlanc is now 敏锐小白 / Keen Blanc) | | |
| skill | sporulation / shellHardening / charge / burrow / massInfection / mutation / shedding | 孢子爆发 / 荚膜硬化 / 冲撞 / 钻入 / 大规模感染 / 突变 / 排毒 | Sporulation / Shell Hardening / Charge / Burrow / Mass Infection / Mutation / Shedding |
| hero | blanc | 小白 | Blanc |
| currency / lives | atp / vitality | ATP / 生命力 | ATP / Vitality |

---

## 15. Balance sanity check (Vessel · normal · the arithmetic behind the numbers)

Revision-2 numbers (g = 1.15, old costs); kept for the method — §15.1 supersedes the conclusions.
Method: pure arithmetic over this spec (script kept with the design notes, no game code). Time under fire per tower =
∫ over the path of `ds / v(s)` inside its range using §5.2 flow factors; "lone-enemy budget" = Σ tower DPS × that time
(what one enemy walking alone would absorb); "filler window" = spawn span + 60 % of the walk. Boss DPS counts the
multipliers of §2 and the boss traits of §3.1 with one mark stack ("basic") and, in the second figure, three stacks +
beacons + Adrenaline uptime ("buffed"). ATP available = start + every reward and bonus of earlier waves with the early
call used at half the countdown. The diversified build spends 76–87 % of what is available at each checkpoint.

| wave | ATP avail. | build (spend) | main enemy HP / armor | Σ DPS | lone-enemy budget | filler HP vs DPS×window | boss HP / armor / regen | boss avg DPS basic → buffed | time to kill (% of walk) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 220 | 2× antibody L1 (120) | bacterium 40 / 0 | 35 | 231 (5.8× HP) | 320 vs 716 (×2.2) | — | — | — |
| 5 | 727 | antibody L2+L1, macrophage, complement, T-cell, mast, barrier (635) | bacterium 70 / 0 | 147 | 1 047 (15×) | 420 vs 2 733 (×6.5) | Superbug 1 049 / 10 / 10 ·s⁻¹ | 35 → 53 | 43 s (73 %) → 25 s (42 %) of a 60 s walk |
| 10 | 1 880 | 11 towers: + T-cell L2, mast L3, pyrogen, beacon, 2nd T-cell (1 475) | flagellate 84 / 0 | 325 | 1 510 (18×) | 675 vs 4 271 (×6.3) | Giant Parasite 5 277 / 6 / — | 218 → 332 | 24 s (47 %) → 16 s (31 %) of a 51 s walk incl. burrows |
| 15 | 3 707 | 17 towers, most L3 (2 820) | virus 248 / 0 | 579 | 4 122 (17×) | 5 095 vs 11 005 (×2.2) | Superbug 4 245 / 15 / 42 ·s⁻¹ | 211 → 322 | 25 s (42 %) → 15 s (25 %) |
| 20 | 6 373 | 21 towers, 3.5 T-cells (5 165) | virus 498 / 0 | 1 084 | 7 409 (15×) | 24 052 vs 25 417 (×1.06, splash/chain/engulf not counted) | Virus King 22 771 / 13 / — | 319 → 485 after the first mutation (T-cell share 83 % → 6.6 s immune of 12 s) | 71 s (130 %) → 43 s (79 %); converged share after rotation (T-cell ≈ 50 %, 3.9 s immune) ≈ 480 → 720 DPS → 44 s (80 %) → 26 s (47 %), one Booster cast removes 8 % |
| 10 rush | 1 880 | 2× T-cell L3 + antibody L2 + macrophage + barrier (1 040) | flagellate | 291 | 2 337 | ×5.7 | Giant Parasite | 346 → 526 | 15 s (30 %) → 10 s (20 %) |
| 15 rush | 3 707 | 4× T-cell L3 + 2 antibody + macrophage + barrier (2 105) | virus | 594 | 6 273 | ×2.2 | Superbug (capsule ×0.5) | 313 → 476 | 16 s (26 %) → 10 s (16 %) |

Readings:

- Filler is comfortable through wave 15 (×2–6 with no splash counted) and tight at 19–20 (×1.06 before splash,
  chains, engulfs and marks), which is where the game should bite.
- Bosses die at 25–47 % of their walk for the diversified build with buffs, 42–73 % without; the final boss at ~50–80 %.
  The T-cell rush is 1.6–1.7× faster on bosses at equal or lower spend but spends 55 % of its ATP on four towers that
  only shoot 0.6/s each, so wave 19's 44 enemies (56 with sporelings) are its problem; the capsule (×0.5) and
  per-segment splash make
  complement / mast the per-ATP winners against the Superbug / Giant Parasite (complement L3 vs Superbug w15: 121 DPS
  for 345 ATP; T-cell L3: 126 DPS for 410).
- Vessel total HP per wave (effective, incl. children): 320 · 626 · 913 · 1 074 · 1 469 B · 1 702 · 1 874 · 2 554 ·
  3 151 · 5 952 B · 4 855 · 5 025 · 6 592 · 8 109 · 9 340 B · 13 426 · 18 060 · 25 074 · 32 325 · 46 823 B; HP ÷ ATP
  available rises 1.5 → 2.0 (w5) → 3.2 (w10) → 2.5 (w15) → 5.6 (w19) → 7.3 (w20, boss 3.6 of it). Every non-boss
  step from wave 3 on is ≤ 1.46× on all four maps (Alveoli max 1.46, Gut 1.49, Brain 1.41); wave 2 is the only
  exception (1.96, two towers → four).
- Flat-number fixes hold: Antibiotic at w20 kills three bacteria (854 × 2 vs 569 HP); pyrogen L3 aura 41 DPS at w20;
  enzyme acid on a w15 biofilm (778 HP) = 272 splash + 78/s pool; Clot Spikes vs a w18 parasite (3 440 HP) reflects
  138 per attack-second.
- Mutant at w13: 2 140 HP → two 1 177 halves (`spawned`, T-cell ×2) for 89 + 2 × 37 ATP; at w20 5 693 HP (9 108
  effective with the halves), 19 % of the final wave.

What this check does **not** cover (bot pass): group overlap (several enemies sharing a tower's attention), barrier
hold times, hero contribution, hard mode (×1.3 HP, armor +1, 8 s countdown) and Gut's ×1.2 on a 47-cell path.

---

### 15.1 Bot pass (revision 3) — the numbers in this spec were retuned against these runs

**Method.** A headless harness (kept with the design notes, outside the repo; the cheap regression subset lives in
`bot.test.ts`, whose in-repo `GreedyBot` (sim/bot.ts) now also takes the seed as described below, walks the hero to
meet the most advanced unrevealed prion past 40 % of its path, and keeps building past its curve once every tower is
maxed — single-type runs keep the fixed curve and the guard hero; it clears normal on all four maps for seeds 1–3
(Brain 3★ / 2★ / 3★, Gut 3★ / 1★ / 3★), loses every fresh hard map (waves 5–18) and gets further with a veteran memory
(Vessel cleared)) plays complete runs with scripted bots that use only the public commands (`build` / `upgrade` /
`setTargeting` / `castAbility` / `moveHero` / `startWave`), on all 4 maps × normal / hard × 3 seeds. The simulation is
deterministic, so the seed varies the bot: ±6 % noise on pad scores, a 0.20–0.35 s decision interval and ±1 tower on the
build curve. Every run logs per wave: vitality, banked ATP, towers and Σ levels, leaks by enemy type, wave duration,
each boss's outcome (killed / leaked, time to kill, fraction of its walk); mixed bots continue into endless until death.
Hard is also run with a **veteran** memory (all 3 vaccines + 8 talent points: affinity, maturation, reserve,
toughBlanc, sharpBlanc, platelets), which is what anyone who has unlocked hard (≥ 1 ★ on that map; Brain needs 6 ★)
actually brings. Placement for every bot: the free pad with the most time-weighted, not-yet-covered path in range
(later path counts more; beacons score buffed towers + reveal coverage; barriers go on the legal path cell covered by
the most tower levels).

| bot | what it does |
|---|---|
| `cheap` | cheapest damage towers (antibody → pyrogen → macrophage) round-robin on every pad, upgrades only when the pads are full, 3 L1 barriers, guard hero, basic abilities |
| `only-<type>` (× 8) | one tower type only, 2 + 0.9 w towers, upgrades lowest level first, guard hero (cures the nearest infected tower, otherwise stands at 80 % of the busiest path), basic abilities (Fever / Adrenaline when ≥ 6 enemies or a boss is up, Antibiotic on the densest cluster of ≥ 3) |
| `balanced` | adaptive mix (weights antibody 2 · mast 2 · complement 2 · T-cell 2 · macrophage 1 · pyrogen 1 · beacon 1, boosted from the next wave's preview: armor/tanks → T-cell, biofilm → complement, spores → mast, Superbug → complement, Giant Parasite → mast, Virus King → beacon; a beacon before stealth waves, anti-air before flying waves), **marks synergy** (antibodies on `strongest` once T-cells exist, Neutralizing / Polyvalent alternated), 2 + 0.85 w towers, 2 barriers (L2) from wave 4 rebuilt between waves, active hero, smart abilities |
| `barrier` | balanced mix with extra mast / pyrogen weight, **3 barriers to L3** (Fibrin / Clot Spikes) from wave 2, guard hero, smart abilities |
| `hero` | hero-centric: 2 + 0.7 w towers (fewer, more upgraded), antibody-heavy mix for marks, 1 barrier from wave 6, **active hero** (cures by tower value, reveals prions past 45 % of their path, stands 1.08 cells beside the path just ahead of a boss so he marks it without being touched, finishes the leading enemy near the core, retreats below 35 % HP), **smart abilities** (Fever when ≥ 3 enemies are in the last 35 % or the boss is past 40 %; Adrenaline on a boss or a crowd; Antibiotic weighted by family and progress) |
| `nohero` | `balanced` with the hero parked in the far corner all run |
| `plain` | the balanced weights without adaptation, marks or barriers; guard hero, basic abilities |

**Results** (fresh memory; `3★(0)` = cleared with 3 stars and 0 vitality lost, `L12` = lost at wave 12):

| bot | diff | vessel | alveoli | gut | brain | clear | mean ★ (cleared) | lost at (min–avg–max) | endless reached |
|---|---|---|---|---|---|---|---|---|---|
| cheap | normal | L15 1★(16) L20 | L20 L20 L14 | L20 L17 L20 | L19 L15 L11 | 1/12 | 1.00 | 11–17.4–20 | — |
| cheap | hard | L10 L10 L10 | L11 L10 L10 | L10 L10 L10 | L5 L6 L5 | 0/12 | — | 5–8.9–11 | — |
| only-antibody | normal | L15 L13 L13 | L15 L15 L15 | L12 L12 L15 | L10 L10 L10 | 0/12 | — | 10–12.9–15 | — |
| only-antibody | hard | L10 L10 L10 | L12 L10 L10 | L10 L10 L10 | L5 L5 L5 | 0/12 | — | 5–8.9–12 | — |
| only-macrophage | normal | L13 L10 L10 | L11 L10 L11 | L10 L12 L10 | L6 L6 L6 | 0/12 | — | 6–9.6–13 | — |
| only-macrophage | hard | L9 L9 L9 | L6 L6 L6 | L8 L8 L8 | L5 L6 L6 | 0/12 | — | 5–7.2–9 | — |
| only-mast | normal | L14 L14 L14 | L14 L14 L11 | L14 L14 L14 | L12 L12 L12 | 0/12 | — | 11–13.3–14 | — |
| only-mast | hard | L9 L9 L9 | L11 L11 L11 | L8 L8 L8 | L6 L6 L6 | 0/12 | — | 6–8.5–11 | — |
| only-pyrogen | normal | L14 L14 L17 | L14 L14 L14 | L8 L14 L8 | L12 L12 L12 | 0/12 | — | 8–12.8–17 | — |
| only-pyrogen | hard | L9 L9 L9 | L6 L6 L6 | L8 L8 L8 | L4 L4 L4 | 0/12 | — | 4–6.8–9 | — |
| only-tcell | normal | L15 L15 L15 | L15 L15 L15 | L17 L11 L15 | L15 L14 L15 | 0/12 | — | 11–14.8–17 | — |
| only-tcell | hard | L10 L10 L5 | L10 L11 L11 | L10 L5 L5 | L5 L5 L6 | 0/12 | — | 5–7.8–11 | — |
| only-complement | normal | L15 L15 L15 | L15 L15 L15 | L15 L15 L15 | L10 L10 L10 | 0/12 | — | 10–13.8–15 | — |
| only-complement | hard | L12 L12 L12 | L11 L12 L11 | L5 L10 L10 | L5 L5 L5 | 0/12 | — | 5–9.2–12 | — |
| only-beacon | normal | L4 L4 L3 | L4 L4 L4 | L5 L5 L5 | L3 L3 L3 | 0/12 | — | 3–3.9–5 | — |
| only-beacon | hard | L2 L2 L2 | L2 L2 L2 | L4 L4 L4 | L2 L2 L2 | 0/12 | — | 2–2.5–4 | — |
| only-barrier | normal | L8 L8 L8 | L5 L5 L5 | L5 L5 L5 | L5 L5 L5 | 0/12 | — | 5–5.8–8 | — |
| only-barrier | hard | L5 L5 L5 | L5 L5 L5 | L5 L5 L5 | L5 L5 L4 | 0/12 | — | 4–4.9–5 | — |
| balanced | normal | 3★(0) 3★(0) 3★(0) | 3★(0) 3★(0) 3★(0) | 3★(0) 3★(0) 3★(0) | 3★(2) 3★(0) 3★(0) | 12/12 | 3.00 | — | 32.1 (29–35) |
| balanced | hard | 1★(14) L15 L20 | L15 L18 L20 | L18 L15 L15 | L6 L6 L9 | 1/12 | 1.00 | 6–14.3–20 | 28.0 (28–28) |
| barrier | normal | 3★(0) 3★(0) 3★(0) | 3★(0) 3★(0) 3★(0) | 3★(0) 3★(1) 3★(0) | 3★(1) 1★(12) 1★(11) | 12/12 | 2.67 | — | 31.4 (28–35) |
| barrier | hard | L15 1★(8) L15 | L15 L20 L15 | L12 L5 L10 | L9 L6 L8 | 1/12 | 1.00 | 5–11.8–20 | 28.0 (28–28) |
| hero | normal | 3★(0) 3★(0) 3★(0) | 3★(0) 3★(0) 3★(0) | 3★(0) 3★(0) 3★(0) | 3★(2) 3★(0) 3★(2) | 12/12 | 3.00 | — | 30.8 (28–34) |
| hero | hard | 3★(0) 1★(8) 1★(10) | 2★(2) 1★(10) 1★(12) | L11 1★(12) L15 | L6 L5 L10 | 7/12 | 1.43 | 5–9.4–15 | 26.0 (23–30) |
| nohero | normal | 3★(1) 3★(0) 3★(0) | 3★(0) 3★(0) 3★(0) | 3★(0) 2★(10) 2★(10) | 1★(12) 2★(9) 1★(11) | 12/12 | 2.42 | — | 30.5 (25–35) |
| nohero | hard | L10 L10 L20 | L14 L14 L14 | L5 L5 L5 | L4 L5 L5 | 0/12 | — | 4–9.3–20 | — |
| plain | normal | 3★(0) 3★(0) 3★(0) | 3★(0) 3★(0) 3★(0) | 3★(0) 3★(0) 2★(6) | 2★(8) 2★(7) 2★(5) | 12/12 | 2.67 | — | 30.3 (28–34) |
| plain | hard | L15 L15 L20 | L15 L20 L20 | L15 L10 L10 | L10 L5 L10 | 0/12 | — | 5–13.8–20 | — |

**Bosses** (mixed bots; fraction of the boss's path walked when it died, mean time to kill):

| bot | diff | w5 Superbug | w10 Giant Parasite | w15 Superbug | w20 Virus King |
|---|---|---|---|---|---|
| balanced | normal | 12/12 killed @ 41 % of walk, 25 s | 12/12 killed @ 64 % of walk, 25 s | 12/12 killed @ 41 % of walk, 27 s | 12/12 killed @ 69 % of walk, 46 s |
| balanced | hard | 12/12 killed @ 54 % of walk, 31 s | 8/9 killed @ 88 % of walk, 31 s | 6/9 killed @ 78 % of walk, 52 s | 0/3 killed |
| barrier | normal | 12/12 killed @ 67 % of walk, 44 s | 12/12 killed @ 75 % of walk, 30 s | 12/12 killed @ 47 % of walk, 34 s | 12/12 killed @ 71 % of walk, 52 s |
| barrier | hard | 8/12 killed @ 84 % of walk, 46 s | 6/8 killed @ 92 % of walk, 30 s | 2/6 killed @ 82 % of walk, 51 s | 1/2 killed @ 92 % of walk, 56 s |
| hero | normal | 12/12 killed @ 43 % of walk, 26 s | 12/12 killed @ 65 % of walk, 25 s | 12/12 killed @ 36 % of walk, 23 s | 12/12 killed @ 75 % of walk, 46 s |
| hero | hard | 11/12 killed @ 55 % of walk, 33 s | 7/10 killed @ 92 % of walk, 31 s | 8/8 killed @ 61 % of walk, 39 s | 3/7 killed @ 94 % of walk, 51 s |
| nohero | normal | 12/12 killed @ 66 % of walk, 43 s | 12/12 killed @ 74 % of walk, 29 s | 12/12 killed @ 52 % of walk, 35 s | 10/12 killed @ 72 % of walk, 43 s |
| nohero | hard | 5/11 killed @ 86 % of walk, 48 s | 2/6 killed @ 89 % of walk, 27 s | 1/1 killed @ 71 % of walk, 40 s | 0/1 killed |
| plain | normal | 11/12 killed @ 64 % of walk, 39 s | 12/12 killed @ 72 % of walk, 27 s | 12/12 killed @ 47 % of walk, 31 s | 12/12 killed @ 77 % of walk, 50 s |
| plain | hard | 9/12 killed @ 87 % of walk, 49 s | 6/11 killed @ 87 % of walk, 28 s | 3/7 killed @ 74 % of walk, 43 s | 0/3 killed |

**Waves 1–3** (forgiveness):

| bot | diff | leaks in waves 1–3 (avg per run) |
|---|---|---|
| cheap | normal | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 2.3 |
| cheap | hard | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 2.7 |
| only-antibody | normal | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 1.7 |
| only-antibody | hard | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 3.7 |
| only-macrophage | normal | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 1.3 |
| only-macrophage | hard | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 1.0 |
| only-mast | normal | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 1.7 |
| only-mast | hard | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 1.7 |
| only-pyrogen | normal | vessel 0.0 · alveoli 0.0 · gut 0.7 · brain 0.7 |
| only-pyrogen | hard | vessel 0.0 · alveoli 0.0 · gut 1.0 · brain 12.0 |
| only-tcell | normal | vessel 1.7 · alveoli 0.0 · gut 0.0 · brain 1.7 |
| only-tcell | hard | vessel 4.7 · alveoli 0.3 · gut 0.0 · brain 4.3 |
| only-complement | normal | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 2.0 |
| only-complement | hard | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 4.3 |
| only-beacon | normal | vessel 19.0 · alveoli 14.3 · gut 11.3 · brain 20.0 |
| only-beacon | hard | vessel 15.0 · alveoli 15.0 · gut 14.0 · brain 15.0 |
| only-barrier | normal | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 3.3 |
| only-barrier | hard | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 5.7 |
| balanced | normal | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 0.0 |
| balanced | hard | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 0.7 |
| barrier | normal | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 1.0 |
| barrier | hard | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 1.3 |
| hero | normal | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 0.0 |
| hero | hard | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 0.7 |
| nohero | normal | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 2.0 |
| nohero | hard | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 4.0 |
| plain | normal | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 2.0 |
| plain | hard | vessel 0.0 · alveoli 0.0 · gut 0.0 · brain 2.0 |

**Hard: veteran memory and what the good bot needs** (ablations of `hero` on fresh hard):

| bot (hard) | memory | clear | mean ★ | vessel | alveoli | gut | brain |
|---|---|---|---|---|---|---|---|
| balanced | veteran | 6/12 | 2.33 | 3★ 2★ 2★ | 2★ 2★ L20 | L18 3★ L15 | L14 L16 L10 |
| barrier | veteran | 6/12 | 2.50 | 3★ 3★ 2★ | L20 3★ 3★ | L15 1★ L20 | L12 L6 L12 |
| hero | veteran | 10/12 | 2.40 | 3★ 3★ 3★ | 3★ 1★ 3★ | 2★ 3★ 2★ | 1★ L20 L16 |
| hero | fresh | 7/12 | 1.43 | 3★ 1★ 1★ | 2★ 1★ 1★ | L11 1★ L15 | L6 L5 L10 |
| nohero | veteran | 2/12 | 1.00 | 1★ L17 L20 | L20 1★ L20 | L20 L15 L15 | L5 L5 L5 |
| plain | veteran | 6/12 | 2.67 | 3★ 3★ 3★ | 2★ 2★ 3★ | L20 L15 L15 | L10 L10 L20 |
| hero+marks=false | fresh | 4/12 | 3.00 | 3★ 3★ 3★ | L15 3★ L15 | L11 L15 L15 | L6 L5 L16 |
| hero+abilities=basic | fresh | 5/12 | 2.40 | 3★ 3★ 3★ | 1★ 2★ L20 | L15 L11 L15 | L6 L5 L6 |
| hero+abilities=none | fresh | 0/12 | — | L15 L15 L14 | L14 L11 L11 | L10 L10 L11 | L5 L5 L5 |
| hero+barriers=0 | fresh | 5/12 | 2.00 | 3★ 1★ 3★ | 2★ L14 L20 | L11 1★ L11 | L6 L5 L9 |
| hero+hero=guard | fresh | 1/12 | 2.00 | 2★ L15 L20 | L15 L10 L14 | L10 L10 L5 | L5 L5 L5 |
| hero+hero=none | fresh | 0/12 | — | L10 L15 L10 | L15 L20 L14 | L5 L5 L5 | L4 L5 L5 |

**Per-wave trace** of the reference `hero` bot, seed 1 (vitality · ATP banked after the clear · non-barrier towers (Σ levels)):

| wave | Vessel normal: vit · ATP · towers (Σlv) · boss | Vessel hard: vit · ATP · towers (Σlv) · boss | Gut normal: vit · ATP · towers (Σlv) · boss |
|---|---|---|---|
| 1 | 20 · 51 · 3 (3) | 15 · 78 · 2 (2) | 20 · 61 · 3 (3) |
| 2 | 20 · 120 · 4 (4) | 15 · 49 · 4 (4) | 20 · 106 · 4 (4) |
| 3 | 20 · 99 · 5 (5) | 15 · 169 · 4 (4) | 20 · 77 · 5 (5) |
| 4 | 20 · 150 · 6 (6) | 15 · 194 · 5 (5) | 20 · 96 · 6 (6) |
| 5 | 20 · 322 · 7 (7) SUP ✓ 36 % | 15 · 73 · 7 (8) SUP ✓ 61 % | 20 · 302 · 7 (7) SUP ✓ 48 % |
| 6 | 20 · 100 · 7 (11) | 15 · 141 · 7 (9) | 20 · 164 · 7 (10) |
| 7 | 20 · 172 · 8 (12) | 15 · 174 · 8 (10) | 20 · 202 · 8 (11) |
| 8 | 20 · 120 · 9 (15) | 15 · 137 · 9 (12) | 20 · 98 · 9 (14) |
| 9 | 20 · 218 · 9 (18) | 15 · 119 · 9 (15) | 20 · 139 · 9 (18) |
| 10 | 20 · 477 · 10 (20) GPA ✓ 61 % | 15 · 317 · 10 (17) GPA ✓ 98 % | 20 · 439 · 10 (20) GPA ✓ 66 % |
| 11 | 20 · 143 · 11 (25) | 15 · 230 · 11 (22) | 20 · 213 · 11 (24) |
| 12 | 20 · 200 · 11 (27) | 15 · 140 · 11 (24) | 20 · 161 · 11 (27) |
| 13 | 20 · 165 · 12 (30) | 15 · 143 · 12 (28) | 20 · 163 · 12 (31) |
| 14 | 20 · 252 · 13 (33) | 15 · 177 · 13 (30) | 20 · 237 · 13 (33) |
| 15 | 20 · 473 · 14 (36) SUP ✓ 41 % | 15 · 304 · 14 (33) SUP ✓ 61 % | 20 · 179 · 14 (39) SUP ✓ 49 % |
| 16 | 20 · 191 · 15 (43) | 15 · 139 · 14 (36) | 20 · 196 · 15 (43) |
| 17 | 20 · 182 · 17 (49) | 15 · 181 · 15 (43) | 20 · 202 · 17 (50) |
| 18 | 20 · 325 · 18 (53) | 15 · 131 · 16 (47) | 20 · 234 · 18 (54) |
| 19 | 20 · 181 · 21 (61) | 15 · 278 · 17 (51) | 20 · 179 · 20 (60) |
| 20 | 20 · 765 · 23 (67) VKG ✓ 73 % | 15 · 594 · 20 (58) VKG ✓ 93 % | 20 · 710 · 23 (67) VKG ✓ 76 % |
| endless | reached w30 | reached w25 | reached w34 |

**Readings.**

- *Normal is clearable with 2–3 ★ by a thoughtful mix*: `balanced` and `hero` clear 12/12 at 3 ★; `plain` (no adaptation,
  marks or barriers) and `barrier` 12/12 at 2.67 ★; `nohero` 12/12 at 2.42 ★. The economy binds: the reference bot banks
  100–300 ATP after most waves and reaches 20–23 towers / ~65 levels by wave 20 (25–32 pads).
- *No single type carries*: every single damage type loses on every map (antibody 10–15, macrophage 6–13, mast 11–14,
  pyrogen 8–17, T-cell 11–17, complement 10–15; average 9.6–14.8). Each dies to its designed counter: armor
  (antibody), toxin clouds (mast / pyrogen / macrophage — 2 vit each, Antibiotic only ×0.5), prions and fast swarms
  (T-cell), armor + stealth + bosses (complement). The two support types die at waves 3–8 by design. Brain's earlier
  failures (w6–15) come from its stealth-heavy scripts, which is that map's lesson.
- *Cheap spam fails* (1/12 clears at 1 ★, losses at 11–20): L1 spam has no answer to waves 10–19.
- *Hard requires marks, barriers, the hero and the abilities*: on fresh hard only the hero-centric bot clears regularly
  (7/12, 1.43 ★: Vessel 1.7, Alveoli 1.3, Gut 1.0, Brain 0); removing marks (4/12), smart abilities (5/12; none: 0/12),
  its barrier (5/12) or the active hero (guard 1/12, parked 0/12) all cost clears; `plain` and `nohero` never clear. With
  a veteran memory the hero bot clears 10/12 at 2.4 ★ and `nohero` 2/12 — 3 ★ on hard Brain stays the end goal.
- *Bosses are decisive, not walls*: on normal the good bots kill the w5 Superbug at ~40 % of its walk, the Giant Parasite
  at ~65 %, the w15 Superbug at ~40 % and the Virus King at 70–75 % (46 s); weaker builds take them at 65–90 %. On hard
  the Giant Parasite and Virus King are killed at 88–94 % or leak — that is where hard runs are won or lost.
- *The first 3 waves are forgiving*: no mixed bot leaks on Vessel / Alveoli / Gut in waves 1–3, and the single-type bots
  only leak there when their first tower cannot cover the path (T-cell-only on Vessel, first tower 160 ATP: 1.7 per
  run; pyrogen-only on Gut: 0.7); Brain wave 2 brings 4 prions, so builds with neither a beacon nor
  the active hero leak 1–2 there.
- *Endless*: every mixed build fills every pad at L3 by waves 21–23 and then banks ATP it cannot spend; strong builds
  reach waves 28–35 (mean 30–32 on normal, 26–28 on hard), ending on the 2-vit toxin groups (`second ×(6 + k)`), the
  w30 Giant Parasite or the w35 Virus King + Superbug pair. Endless growth 1.04–1.08 all land in 28–35 because the
  composition (+k enemies, +k armor) dominates; 1.06 keeps HP growth meaningful.

**Revision 3 changes** (old → new, why):

| what | old → new | why (evidence above) |
|---|---|---|
| `g(w)` growth ≤ 20 | 1.15 → **1.22** | at 1.15 every mixed bot (even `plain`) went 3 ★ with 0 leaks and first leaked in endless w30–35 (~4–5× headroom at w19); T-cell-only cleared 3 maps, complement-only 2, mast-only Gut. 1.22 moves the economy check to waves 10–19 and changes waves 1–3 by +22 % / +13 % only |
| endless growth | 1.12 → **1.06** | g(20) is 3.1× larger now; at 1.12 strong builds stopped at 28–30, at 1.06 they reach 28–35 |
| Virus King base HP | 1 600 → **1 200** | at 1.22 the final boss leaked for every bot on Gut / Brain (a wall); at 1 200 the good bots kill it at 70–75 % of its walk on normal |
| toxin `vit` | 1 → **2** | the flying counter was too weak: mast / pyrogen / macrophage-only reached w18–20 because the hero and Antibiotic cleaned up 1-vit toxins |
| Antibiotic vs `other` | ×1 → **×0.5** | it one-shot toxin clusters, which let ground-only builds ignore flyers (mast-only still cleared Gut); also matches the rule text (antibiotics only kill bacteria) |
| T-cell cost | 140/100/170 → **160/120/190** | T-cell-only lost at w15–19 with 0–7 vit lost on 3 maps (range nerfs did not help); now loses at 11–17 |
| complement cost | 120/85/140 → **140/100/165** | complement-only lost at w16–19; now 10–15 (damage nerfs did not move it — economy binds) |
| mast cost | 95/70/115 → **100/80/130** | mast is the most cost-efficient tower vs ground; together with toxin vit 2 mast-only now loses at 11–14 |
| barrier cost / HP | 35/30/50, 300/550/900 (Fibrin 1 600, Spikes 900) → **25/25/40, 400/800/1300 (2 200, 1 300)** | at the steeper `g` barriers were a net loss (the balanced bot did better with none on hard; rebuild cost ~65 ATP per break); now the barrier-heavy bot clears 12/12 normal and barriers add clears on hard |
| Gut `hpMult` | 1.2 → **1.0** | Gut's sparse pads already cost coverage; at 1.2 every boss on Gut leaked at the new growth |
| Brain `hpMult` / boss HP | 1.0 → **0.8**, new `BOSS_HP_MULT.brain` **0.7** | two separate 26-cell paths split the defense; bosses walk one of them, so the w10 Giant Parasite and the Virus King were walls on Brain |
| hard enemy HP | ×1.3 → **×1.25** | at ×1.3 the best bot cleared 1/12 fresh hard runs; at ×1.25 7/12 with 1.43 ★ |
| smoothness rule | ratio ≤ 1.5 → **≤ 1.3 × g(w)/g(w−1)** | same 1.3 composition step as before; the raw ratio grows with `g` (max 1.29 composition, Gut w18) |
| unchanged after testing | prion armor 3 (2 made no difference), hard burrow distance 4.5 (3.5 made no difference), T-cell range, mast damage, complement damage, boss skill timings | the sweeps showed these were not the binding constraint |

---

## 16. Review resolution log (revision 2)

| finding | resolution |
|---|---|
| Bosses vs T-cell (blocker) | vsBoss ×1.5, product cap ×4 (§2.5); Superbug capsule tracer ×0.5 / chain ×1.5, regen 1 %, HP 600, armor 8; Giant Parasite `splashZones 4`; Virus King HP 1 600, mutation picks by damage since the last mutation with duration `clamp(4 s × share/0.5, 2, 8)` and immune-type towers retarget; T-cell range 4.0/4.4/4.8; villi +0.5 cap for base range ≥ 3.5. The reviewer's HP suggestions (1 100 / 2 400 / 2 600 + 2.5 % regen) were checked and rejected: a diversified w5 build could not out-damage the regen (§15) |
| Mast vs complement (major) | Mast 40/65/100, splash 1.1/1.3/1.5 no falloff, Allergy Storm 1.9; complement falloff −25 %, L3 4 targets, Long Chain 6, jump 1.3 (2.4), no jumps onto unrevealed stealth |
| Mutant / wave 18 (major) | Mutant HP 400 (eff. 640), reward 60 + 2 × 25, `boss: false` with explicit consequences (§3.2); `mut×2` pairs removed; smoothness rule ≤ 1.5× enforced by unit test on all maps; scripts rebalanced (§8) |
| Flat numbers (major) | Antibiotic 60 × g(w); acid 35 % / 10 %·s of the meal's maxHP; clot 4 % / 2 % maxHP; pyrogen aura and histamine burn × g(w)^0.5; macrophage thresholds 55/80/110/150; UI DPS from formulas |
| tissueRepair vs stars (major) | stars from `stats.vitLost` (§5.8); talent text says survival only |
| Hero relevance (major) | melee marks, cure immunity 3 s, damage taken ×0.25, regen 8 %/s, dmg × (1 + 0.08 (w−1)); sharpBlanc → Keen Blanc (2 stacks, reveal 3.0, +25 %), rapidResponse adds cure radius 1.5 / immunity 5 s |
| Hard mode (major) | ×0.8 on period and duration, mutation exempt; HP ×1.3, armor +1, countdown 8 s, early bonus ×1.5; bot acceptance ≤ 2× TTK |
| Unclear numbers (major) | §5.9 edge-rule table (a–t), mirrored in `types.ts` comments |
| Beacon footprint, macrophage teaching wave, breathing, Alveoli hpMult, talent economy, encapsulated armor (minor) | buff 2.0/2.3/2.6 with real pad counts; thresholds 55/80; reverseFor 3 s, push 1.0, interrupt 1 s; hpMult 0.9; talent total 28; armor 4 |
| Renderer contract (blocker), cell→world & picking, touch targets (major) | `ImmuneRenderer`, `CreateRenderer`, `PickResult`, `RendererOptions`, `WORLD`, `CAMERA`, `RENDER_BUDGET` in `types.ts`; §11.8. The reviewer's camera test could not pass at 55°/35° with a 0.6 disc (35 px far disc); pitch 58°, FOV 30°, 8 visible rows and a 0.7 disc pass it (42.5 px) |
| Build sheet, antibiotic targeting, hero move mode (major) | §11.2 strip + confirm tap, §6.1 drag-to-aim, §6 portrait-first move mode; `InteractionMode` in the snapshot |
| Save versioning (major) | `MEMORY_VERSION` / `RUN_VERSION`, lenient `parseMemory`, memory written at `vaccineUnlocked`; `recordRun` returns `newStars`/`newEndless`; `recordBest` mirrors derived from memory |
| Draw-call budget, pause/visibility/context loss (major) | §11.9, §7.10 |
| Event delivery, interpolation, RNG, snapshot gaps, HUD/text load, bundle, battery, duplicate truth (minor) | §11.5 double buffer; discontinuity rule + test; rng reserved + grep test; `towers` capacity 40, `Tower.lastShotAt`, `Projectile.t/arcHeight`, overflow rule; HUD cap 4 + chip, glyphs in the wave button, toasts ≥ 6 s; named three imports + prefetch; idle 30 fps + wave-5 probe; memory single source of truth |
| Brain centre pads (minor) | left as designed; open question for the bot pass (does Brain play as one path?) |

## 17. QA round 1 resolution log

| finding | resolution |
|---|---|
| CSS custom properties dropped (spec badge unreadable, tower / spec colours lost) | `cssVars()` sets them with `style.setProperty` (the shell's `el()` copies styles with `Object.assign`); the badge ink is chosen per spec colour (≥ 4.5:1, unit test), light theme darkens pale spec borders / emblems |
| Context-loss Reload did nothing | §7.10: cached `WEBGL_lose_context`, canvas + renderer replaced when no restore arrives within 1.5 s |
| Antibiotic cast when released on its button | §6.1: cancel decided from the raw finger point (`ui/aim.ts`, unit-tested) |
| Booster > 8 % vs marked bosses | §6.1: flat 8 % maxHP (`dealDamage(..., flat)`), unit test with strong mark + vaccine |
| Biohazard glyph missing | §5.3 `virusRiskPads` + overlay badges |
| Edge pads off-screen | §11.8 pad-aware framing + `camera.test.ts` |
| Path cell behind a tower unpickable | §11.8 picking exception |
| Pinch → one-finger pan | `GestureInput.release` clears `multi` (unit test with synthetic pointers) |
| Toasts cover the top rows / boss toast over the banner | §11.2 bottom-docked tap-through toasts, banner-driven boss toast |
| Endless save label and double-counted stats | §11.1 next-wave label; `RunStats.recorded` (serialized) + `noteRecorded`, `recordRun` subtracts it |
| Per-frame UI allocations | wave preview cached per (map, wave); HUD / ability / portrait updates compare numbers before formatting; note timers tracked in a set |
| Text < 12 px, targets < 44 px, rules too long, English aria-labels | §11.2 sizes; rules 8 lines with the missing mechanics (strings test); `speedLabel` / `infoLabel` keys |
| Test gaps | seeded bot, Brain / hard / veteran guards, camera and heap tests (§11.8, §11.9, §15.1) |


## 18. QA round 2 resolution log

| finding | resolution |
|---|---|
| Build strip scroll reset on preview / ATP change / blocked tap (major) | §11.2: cards built once per pad and updated in place (`updateBuildStrip`), previewed card revealed toward its cut edge (`ui/scroll.ts`); `strip.test.ts` (jsdom, fake renderer) keeps the scroller, its cards and scrollLeft 230 across preview, ATP 0 / +500 and a blocked barrier tap, then builds on the second tap |
| Upper half of tall towers opened the barrier strip (major, round-1 regression) | §11.8: body proxy (silhouette top, `BODY_PICK_RADIUS`) always wins; only capsule-margin rays reaching an empty path cell pick it; `pick.test.ts` (real camera + models): axis 0.2 → top on all 11 QA pads and every type / level / spec picks the tower, the cell behind keeps ≥ 10 % of its area (≥ 55 % behind L1), an occupied cell never wins |
| SwiftShader < 30 fps (minor) | measured per layer, documented in §11.9; no change (floor lighting is the only large item, GPU-cheap) |
| Pause overlay buttons 43 px (minor) | `.td-pause / .td-loading / .td-lost .btn` and the start screen's secondary buttons `min-height: 44px` |
| No-WebGL "Retry" went home, save written (minor) | §11.2: Home only, run discarded (no save on leave / pagehide); `strip.test.ts` |
| Blanc hidden inside the Brain core (minor) | §6: hero post beside the core (`heroPost`), respawn arc drawn there; `hero.test.ts` checks the four posts |
| Status labels stacked (minor) | §11.2: `infected!` / `cured` keyed per tower (one live label, 1.2 s repeat guard); `strip.test.ts` |
