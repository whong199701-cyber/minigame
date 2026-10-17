# tower-defense · 免疫防线 · Immune Front  (v2 — full 3D rebuild)

**Category** action · **Icon** 🦠 · **Best metric** stars per organ (map), highest endless wave.
**Replaces** the flat 2D "Mini Tower Defense" (see tower-defense-v1.md). Keep the game id `tower-defense` so routes work,
but the saved data format changes — read old saves defensively and discard them.

## Why this exists
The player's verdict on v1: "单调" (monotonous) and "跟已有的塔防一样" (same as every TD). v2 must feel like a
different game: real 3D (Three.js), a theme nobody expects, mechanics that only make sense in that theme, and a
lot more to do during a wave. Target audience: adults who want depth, on a phone, portrait, touch only.

## Concept
You are the immune system. Each map is an organ; pathogens travel along blood vessels toward the organ's **vital
core** (生命核心). Towers are immune cells and structures. The hero is a neutrophil (中性粒细胞) called 小白 / "Blanc",
a cute white blob with eyes in the spirit of 《工作细胞》 (Cells at Work). Permanent progression is **immune memory**
(免疫记忆): vaccines earned by beating bosses and an antibody talent tree. Currency is **ATP**. Lives are the core's
**vitality** (生命力).

Art direction: bioluminescent low-poly organic world seen from a fixed oblique camera. Warm dark red/plum floor
with soft undulations, vessels carved as translucent glowing trenches with flowing particles, build pads as raised
membrane discs, cells as blobby faceted shapes with emissive accents (teal/cyan for immune cells, acid green /
violet / sickly yellow for pathogens). Soft rim light, fog, no hard black outlines. Must read clearly at phone size:
silhouettes first, detail second. Both app themes: dark = deep plum interior; light = warm rosy interior; UI chrome
follows the app theme tokens.

## Signature mechanics (what makes it not-another-TD)
1. **Blood flow 血流** — every vessel segment has a flow direction. Enemies moving with the flow get +30% speed,
   against it −20%. Alveoli map "breathes": every 12 s the flow reverses for 2 s and pushes enemies back a little.
   Flow is drawn as streaming particles so the player can read it.
2. **Platelet barrier 血小板屏障** — a tower built ON the vessel. It plugs the path; enemies must chew through it
   (enemy attack logic) while your towers shoot them. Regenerates HP slowly. Bosses smash it in one hit.
3. **Antigen marking 抗原标记** — antibody shots mark enemies; marked enemies take extra damage from everything.
   Several towers interact with marks (T-cell execute, macrophage prefers marked, complement chains between marked).
4. **Infection 感染** — viruses infect towers adjacent to the vessel as they pass: −50% fire rate for 8 s. The hero
   cures by touching; the interferon beacon cures in range. Gives the hero a job during waves.
5. **Vaccines 疫苗 (immune memory)** — defeating a boss type for the first time permanently unlocks its vaccine:
   +25% damage against that boss and the enemies it spawns in every future run. Shown as collectible cards.
6. **Mutation 突变 (final boss)** — the Mutant Virus King becomes immune for 5 s to the tower type that has dealt it
   the most damage, then re-evaluates. Forces mixed defenses.
7. **Realism twists in abilities** — Antibiotic Strike hurts bacteria ×2 but viruses only ×0.5; Fever slows all
   enemies and the rules text explains why. Small teaching moments, but every rule is also a tactical choice.

## Towers (8 types × 3 levels; at level 3 pick one of two specializations, permanent for that tower)
Costs/stats are to be finalized by the design pass (see "Design deliverables") and tuned by bots; roles are fixed:
| # | zh / en | role | spec A | spec B |
|---|---|---|---|---|
| 1 | 抗体发射器 Antibody Launcher | fast single-target, applies **mark** | 多价抗体 Polyvalent: shots split to 3 targets | 中和抗体 Neutralizing: marks +35% dmg taken, longer |
| 2 | 巨噬细胞 Macrophage | short range; **engulfs** small enemies whole on a cooldown, bites big ones | 吞噬加速 Fast digestion | 消化酶 Enzymes: acid splash when it eats |
| 3 | 肥大细胞 Mast Cell | slow splash (histamine burst) | 过敏风暴 Allergy Storm: radius+ | 组胺灼烧 Histamine Burn: DoT |
| 4 | 发热节点 Pyrogen Node | aura: slow + minor DoT | 高热 High Fever: strong slow | 低烧 Low Fever: bigger radius, 0.5 s stun on entry |
| 5 | 杀伤T细胞 Killer T-Cell | sniper: long range, big hits, bonus vs bosses/infected-spawns | 穿孔素 Perforin: ignores armor | 凋亡诱导 Apoptosis: executes enemies < 15% HP |
| 6 | 补体级联 Complement Cascade | chain hits up to N enemies; bonus vs shields/regen | 长链 Long Chain: +targets | 膜攻击 Membrane Attack: breaks regen/shield |
| 7 | 干扰素信标 Interferon Beacon | support: buffs adjacent towers, **cures infection**, reveals stealth | 警报 Alarm: global small buff | 免疫增强 Potentiate: strong local buff |
| 8 | 血小板屏障 Platelet Barrier | built on the path; blocks; HP + regen; cheap | 纤维蛋白 Fibrin: HP++ | 凝血刺 Clot Spikes: damages attackers |
Towers have targeting modes (first / strongest / marked) and sell for 70%.

## Enemies (11 + bosses)
普通细菌 Bacterium (baseline) · 鞭毛菌 Flagellate (fast) · 荚膜菌 Encapsulated (armor: flat reduction) ·
病毒 Virus (infects towers) · 孢子 Spore (splits into 3 on death) · 寄生虫 Parasite (tank, segmented body drawn as a
chain following the path) · 生物膜 Biofilm (regen, heals neighbours) · 朊病毒 Prion (stealth: only targetable near a
beacon or the hero) · 毒素云 Toxin Cloud (flying: ignores barriers and flow; only antibody, complement and T-cell hit
it) · 癌变细胞 Mutant Cell (mini-boss: divides once below 50%) · **Bosses**: 超级细菌 Superbug (armor + regen, spawns
spores) · 噬菌巨虫 Giant Parasite (charges, smashes barriers) · 变异病毒王 Mutant Virus King (mass infection, mutation
immunity). Bosses on waves 5/10/15/20; endless after 20 recycles bosses with scaling.

## Hero 小白 (Neutrophil) + abilities
Tap hero, tap a cell → walks there (any cell, path included), auto-attacks nearest enemy at short range, cures
infected towers by touching, gains XP from kills in the run (3 levels: +HP/+dmg). At 0 HP it respawns at the core
after 15 s. Global abilities with cooldowns, shown as big buttons with radial sweeps: 发热 Fever (all enemies −40%
speed, 6 s), 抗生素打击 Antibiotic Strike (tap target: AoE, ×2 vs bacteria, ×0.5 vs viruses), 肾上腺素 Adrenaline
(+60% fire rate, 8 s). A 4th (疫苗加强针 Booster: instantly kill marked enemies below 30%) unlocks in the talent tree.

## Maps (organs), 20 waves each + endless, portrait grids ~9×13 to 10×15
1. 血管 Vessel — single S path, strong flow. The on-ramp map.
2. 肺泡 Alveoli — two spawn points merging; breathing flow reversal.
3. 肠道 Gut — long winding path; raised villi pads give +1 range; biofilm-heavy waves.
4. 脑 Brain — two full parallel paths to one core, prions common, beacons essential. Unlocks at 6 stars.
Stars: cleared = 1, vitality ≥ 50% = 2, ≥ 90% = 3. Difficulty: normal / hard (more HP, less ATP).

## Immune memory (persistent)
Talent tree 「抗体谱」 ~12 nodes bought with stars (max 12): tower dmg +5/+10%, start ATP, ability cooldown −15%,
hero HP/dmg, barrier HP, interest (+3% ATP per wave on unspent), +1 vitality per cleared wave, unlock Booster.
Vaccines: one per boss type, auto-granted. All persisted via ctx.storage; respec allowed (refund stars).

## Rendering requirements (Three.js, lazy-loaded chunk)
- Fixed oblique camera (pitch ~55°, yaw ~25°), perspective FOV ~35; pinch zoom (clamped) and one-finger drag pan
  (clamped to the map); the whole map fits portrait by default. Tap vs drag discrimination (slop 8 px).
- Lighting: hemisphere + one directional; shadows only on "high" quality (auto: measure frame time 2 s, drop
  quality if < 45 fps). Renderer pixel ratio capped at 1.5 (2 on high). ACES tone mapping, fog.
- All models from primitives / procedural geometry (no asset files): distinct silhouettes per tower type, growing
  parts per level, recolor/emblem per specialization. Enemies via InstancedMesh per type; parasite segments as
  instances following the path; bosses bigger with glow.
- Effects: projectiles (instanced), chain lightning (jittered line segments), engulf animation, histamine burst
  (expanding ring + particles), fever shimmer, ability VFX, flow particles, selection ring, range disc, build-pad
  highlights, hit flashes, death dissolves. Floating damage numbers and HP bars on a 2D canvas overlay projected
  from 3D positions (crisp text, cheap).
- Target 60 fps on a mid-range phone with 60 enemies + 20 towers; never allocate per frame in hot paths.
- Resize/orientation safe; WebGL context loss handled (show "重新加载" overlay); destroy() disposes everything.

## UI (DOM over the canvas, theme tokens)
HUD top: wave x/20 with next-wave preview icons, vitality ♥, ATP ⚡. Bottom: hero portrait (HP, level), ability
buttons with cooldown sweeps, speed ×1/×2, pause, "start wave / next wave early (+ATP bonus)". Tap a pad → build
sheet (8 towers, icons, cost, 1-line role, greyed if unaffordable; barrier only on path cells); tap a tower →
panel (stats, DPS, upgrade cost, at L3 the two specialization cards, targeting toggle, sell); tap hero → move mode
hint. Start screen: organ carousel with stars and best endless wave, difficulty, 「免疫记忆」 button (talent tree +
vaccine cards), continue run if saved. First-run tutorial as 4 contextual toasts. Pause on hidden / rules sheet.

## Design deliverables (phase 1 agent)
`docs/briefs/tower-defense-spec.md`: full numeric spec — tower stat tables per level and spec, enemy tables, armor /
mark / infection formulas, wave scripts per map (20 waves × 4 maps + endless rule), map grids (cells, path cells,
pads, villi, spawn/core), flow rules, hero stats, ability numbers, talent tree nodes/costs, star rules, economy
(start ATP, rewards, early bonus, interest), save-data schema, and the shared TypeScript contracts in
`src/games/tower-defense/types.ts` (GameState, Tower, Enemy, Hero, events, render snapshot API) that logic, renderer
and UI are built against.
