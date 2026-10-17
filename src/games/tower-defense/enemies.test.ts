/**
 * Enemies (§3): boss skills, spore splitting, mutant division, regen / heal, stealth, flying, parasite segments,
 * flow and breathing (§5.2), spawning and leaks.
 */
import { describe, expect, it } from 'vitest';
import { canTarget, castAbility, dealDamage, effectiveArmor, enemyVelocity, expandWave, findMap, startWave, waveScript, growth } from './logic';
import { arena, memoryWith, ofType, place, run, runUntil, spawnAt } from './sim/testkit';
import type { GameEvent } from './types';

const skillEvents = (ev: GameEvent[], skill: string) => ofType(ev, 'bossSkill').filter((b) => b.skill === skill);

describe('Superbug', () => {
  it('sporulation: telegraph at 8 s, spores at 9 s, every 12 s; 2 / 3 / 4 spores by wave band', () => {
    for (const [wave, n] of [
      [5, 2],
      [15, 3],
      [25, 4],
    ] as const) {
      const s = arena({ wave });
      const b = spawnAt(s, 'superbug', 10, { frozen: true });
      const t0 = s.time;
      let ev = run(s, 7.9);
      expect(skillEvents(ev, 'sporulation')).toHaveLength(0);
      ev = run(s, 0.2);
      expect(skillEvents(ev, 'sporulation').map((x) => x.stage)).toEqual(['telegraph']);
      ev = run(s, 1);
      expect(skillEvents(ev, 'sporulation').map((x) => x.stage)).toEqual(['start']);
      const spores = s.enemies.filter((e) => e.type === 'spore');
      expect(spores).toHaveLength(n);
      expect(spores.every((e) => e.spawned && e.pathIndex === b.pathIndex)).toBe(true);
      const next = b.boss?.skills[0].nextAt ?? 0;
      expect(next - t0).toBeCloseTo(20, 1);
    }
  });

  it('shell hardening at ≤ 50 % HP: armor ×2 for 8 s; regen 1 %/s', () => {
    const s = arena({ wave: 5 });
    const b = spawnAt(s, 'superbug', 10, { frozen: true });
    const armor = b.armor;
    b.hp = b.maxHp * 0.5;
    let ev = run(s, 1.05);
    expect(skillEvents(ev, 'shellHardening').map((x) => x.stage)).toEqual(['telegraph', 'start']);
    expect(effectiveArmor(b, s.time)).toBe(armor * 2);
    const hp = b.hp;
    run(s, 1);
    expect(b.hp - hp).toBeCloseTo(b.maxHp * 0.01, 0);
    ev = run(s, 7.5);
    expect(skillEvents(ev, 'shellHardening').map((x) => x.stage)).toEqual(['end']);
    expect(effectiveArmor(b, s.time)).toBe(armor);
  });

  it('hard mode scales firstAt / every / duration by 0.8', () => {
    const s = arena({ wave: 5, difficulty: 'hard' });
    spawnAt(s, 'superbug', 10, { frozen: true });
    const ev = run(s, 6.5);
    expect(skillEvents(ev, 'sporulation').map((x) => x.stage)).toEqual(['telegraph']);
  });
});

describe('Giant Parasite', () => {
  it('charge: telegraph 1.5 s, then ×3 speed for 2 s ignoring slows and flow', () => {
    const s = arena({ wave: 10 });
    const g = spawnAt(s, 'giantParasite', 3);
    g.speed = 0.7;
    let ev = run(s, 8.05);
    expect(skillEvents(ev, 'charge').map((x) => x.stage)).toEqual(['telegraph']);
    ev = run(s, 1.5);
    expect(skillEvents(ev, 'charge').map((x) => x.stage)).toEqual(['start']);
    expect(g.boss?.charging).toBe(true);
    g.slows.push({ src: 99, amount: 0.6, until: s.time + 10 });
    expect(enemyVelocity(s, g)).toBeCloseTo(2.1, 6);
    ev = run(s, 2.05);
    expect(skillEvents(ev, 'charge').map((x) => x.stage)).toEqual(['end']);
    expect(g.boss?.charging).toBe(false);
  });

  it('burrow at ≤ 60 %: untargetable and invulnerable 3 s, projectiles miss, re-emerges 3 cells ahead (hard 4.5)', () => {
    for (const [difficulty, ahead] of [
      ['normal', 3],
      ['hard', 4.5],
    ] as const) {
      const s = arena({ wave: 10, difficulty });
      place(s, 3, 0, 'antibody');
      const g = spawnAt(s, 'giantParasite', 4, { frozen: true });
      g.hp = g.maxHp * 0.59;
      let ev = run(s, 0.55);
      expect(skillEvents(ev, 'burrow').map((x) => x.stage)).toEqual(['telegraph', 'start']);
      expect(canTarget(s, 'tcell', g)).toBe(false);
      expect(dealDamage(s, g, 100, null, -2, null, null, true, false)).toBe(0);
      expect(s.projectiles.length).toBe(0);
      const d = g.dist;
      ev = run(s, (difficulty === 'hard' ? 2.4 : 3) + 0.05);
      const end = skillEvents(ev, 'burrow').filter((x) => x.stage === 'end');
      expect(end).toHaveLength(1);
      expect(g.dist).toBeCloseTo(d + ahead, 6);
      expect(g.px).toBeCloseTo(g.x, 1);
      expect(g.segments[0]).toBeCloseTo(g.dist - 0.5, 6);
    }
  });

  it('has 8 segments 0.5 apart that trail along the path', () => {
    const s = arena({ wave: 10 });
    const g = spawnAt(s, 'giantParasite', 10, { frozen: true });
    expect(g.segments).toHaveLength(8);
    expect(g.segments.map((d) => Math.round(d * 100) / 100)).toEqual([9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6]);
  });
});

describe('Mutant Virus King', () => {
  it('mass infection at 5 s (+1 s telegraph): towers within 3 cells infected 10 s; immune towers are spared', () => {
    const s = arena({ wave: 20 });
    const near = place(s, 3, 0, 'antibody');
    const shielded = place(s, 5, 2, 'mast');
    const far = place(s, 6, 12, 'antibody');
    shielded.immuneUntil = s.time + 100; // hero-cure immunity
    spawnAt(s, 'virusKing', 4, { frozen: true });
    const ev = run(s, 6.05);
    expect(skillEvents(ev, 'massInfection').map((x) => x.stage)).toEqual(['telegraph', 'start']);
    expect(near.infectedUntil - s.time).toBeCloseTo(10, 0);
    expect(shielded.infectedUntil).toBe(0);
    expect(far.infectedUntil).toBe(0);
  });

  it('mutation: immune to the top damage type since the last pick, for clamp(4 s × share / 0.5, 2, 8)', () => {
    const s = arena({ wave: 20 });
    const k = spawnAt(s, 'virusKing', 26, { frozen: true });
    k.hp = k.maxHp = 1e7;
    const b = k.boss;
    if (!b) throw new Error('boss');
    b.dmgByTowerType.tcell = 800;
    b.dmgByTowerType.complement = 200;
    const ev = run(s, 8.55);
    const m = ofType(ev, 'mutation');
    expect(m).toHaveLength(1);
    expect(m[0].immuneTo).toBe('tcell');
    expect(m[0].until - s.time).toBeCloseTo(6.4 - 0.05, 1);
    expect(b.dmgByTowerType.tcell).toBe(0);
    expect(canTarget(s, 'tcell', k)).toBe(false);
    expect(canTarget(s, 'complement', k)).toBe(true);
    // Damage of the immune type that lands anyway (splash / DoT / in flight) is blocked with an immuneHit.
    expect(dealDamage(s, k, 100, 'tracer', 1, 'tcell', null, true, false)).toBe(0);
    expect(ofType(run(s, 0), 'immuneHit')).toHaveLength(0);
    // Next pick at 20 s is skipped when nothing has damaged it since.
    const ev2 = run(s, 12);
    expect(ofType(ev2, 'mutation')).toHaveLength(0);
    expect(skillEvents(ev2, 'mutation').some((x) => x.stage === 'end')).toBe(true);
    expect(b.immuneTo).toBeNull();
  });

  it('immune-type towers retarget to escorts', () => {
    const s = arena({ wave: 20 });
    place(s, 3, 2, 'tcell');
    const k = spawnAt(s, 'virusKing', 4, { frozen: true });
    const esc = spawnAt(s, 'bacterium', 3, { frozen: true, hp: 1e6 });
    if (k.boss) {
      k.boss.immuneTo = 'tcell';
      k.boss.immuneUntil = s.time + 5;
    }
    const hits = ofType(run(s, 2.5), 'hit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.enemy === esc.id)).toBe(true);
  });

  it('shedding: 2 spawned viruses at 70 %, 40 % and 15 % HP, one threshold at a time', () => {
    const s = arena({ wave: 20 });
    const k = spawnAt(s, 'virusKing', 10, { frozen: true });
    k.hp = k.maxHp * 0.69;
    let ev = run(s, 0.05);
    expect(skillEvents(ev, 'shedding')).toHaveLength(1);
    const v = s.enemies.filter((e) => e.type === 'virus');
    expect(v).toHaveLength(2);
    expect(v.every((e) => e.spawned)).toBe(true);
    k.hp = k.maxHp * 0.1;
    ev = run(s, 0.05);
    ev = ev.concat(run(s, 0.05));
    expect(skillEvents(ev, 'shedding')).toHaveLength(2);
    expect(s.enemies.filter((e) => e.type === 'virus')).toHaveLength(6);
  });
});

describe('bosses vs vitality and vaccines', () => {
  it('a boss kill emits vaccineUnlocked once per type when not yet owned', () => {
    const s = arena({ wave: 5 });
    const a = spawnAt(s, 'superbug', 10, { frozen: true });
    a.hp = 0;
    const ev = run(s, 0.05);
    expect(ofType(ev, 'kill')[0]).toMatchObject({ boss: true, reward: 150 + Math.round(150 * 0.16) });
    expect(ofType(ev, 'vaccineUnlocked')).toEqual([{ type: 'vaccineUnlocked', boss: 'superbug' }]);
    const b = spawnAt(s, 'superbug', 10, { frozen: true });
    b.hp = 0;
    expect(ofType(run(s, 0.05), 'vaccineUnlocked')).toHaveLength(0);
    const s2 = arena({ wave: 5, memory: memoryWith([], { superbug: true }) });
    const c = spawnAt(s2, 'superbug', 10, { frozen: true });
    c.hp = 0;
    expect(ofType(run(s2, 0.05), 'vaccineUnlocked')).toHaveLength(0);
    expect(s.stats.bossKills).toBe(2);
    expect(s.stats.bossTypesKilled).toEqual(['superbug']);
  });
});

describe('splitting', () => {
  it('a spore splits into 3 spawned sporelings at dist −0.2 / 0 / +0.2 on any non-engulf death', () => {
    const s = arena();
    const sp = spawnAt(s, 'spore', 10, { frozen: true });
    sp.hp = 0;
    const ev = run(s, 1 / 60);
    const split = ofType(ev, 'split')[0];
    expect(split).toMatchObject({ parent: sp.id, enemyType: 'spore', reward: 0 });
    expect(ofType(ev, 'kill')[0]).toMatchObject({ enemy: sp.id, reward: 6 });
    const kids = s.enemies.filter((e) => split.children.includes(e.id));
    expect(kids.map((k) => k.type)).toEqual(['sporeling', 'sporeling', 'sporeling']);
    expect(kids.every((k) => k.spawned)).toBe(true);
    const ds = kids.map((k) => k.dist).sort((a, b) => a - b);
    expect(ds[0]).toBeCloseTo(9.8, 1);
    expect(ds[2]).toBeCloseTo(10.2, 1);
  });

  it('children never land beyond a barrier their parent was held by', () => {
    const s = arena();
    place(s, 4, 1, 'barrier'); // stop at 4.55
    const sp = spawnAt(s, 'spore', 4.55, { frozen: true });
    sp.hp = 0;
    run(s, 1 / 60);
    for (const e of s.enemies) expect(e.dist).toBeLessThanOrEqual(4.55 + 1e-9);
  });

  it('mutant divides at ≤ 50 %: no kill, reward via split, two 55 % halves that do not divide again', () => {
    const s = arena({ wave: 13 });
    const m = spawnAt(s, 'mutant', 10, { frozen: true });
    expect(m.maxHp).toBe(4349);
    const atp = s.atp;
    m.hp = m.maxHp * 0.49; // (exactly 50 % would regen 1 %/s back above the threshold first)
    const ev = run(s, 1 / 60);
    expect(ofType(ev, 'kill')).toHaveLength(0);
    const split = ofType(ev, 'split')[0];
    expect(split.reward).toBe(89);
    expect(s.atp).toBe(atp + 89);
    expect(s.stats.kills).toBe(0);
    const halves = s.enemies.filter((e) => split.children.includes(e.id));
    expect(halves.map((h) => h.maxHp)).toEqual([2392, 2392]);
    expect(halves.every((h) => h.divided && h.spawned && h.reward === 37 && h.vit === 2)).toBe(true);
    expect(halves.map((h) => h.dist)).toEqual([9.75, 10.25]);
    halves[0].hp = halves[0].maxHp * 0.4;
    halves[1].hp = 0;
    const ev2 = run(s, 1 / 60);
    expect(ofType(ev2, 'split')).toHaveLength(0);
    expect(ofType(ev2, 'kill')).toHaveLength(1);
    expect(s.stats.kills).toBe(1);
  });
});

describe('regen and healing', () => {
  it('biofilm regenerates 3 %/s and heals one neighbour 2 %/s (one biofilm per target)', () => {
    const s = arena();
    const b1 = spawnAt(s, 'biofilm', 10, { frozen: true });
    const b2 = spawnAt(s, 'biofilm', 10.5, { frozen: true });
    const t = spawnAt(s, 'bacterium', 10.2, { frozen: true });
    t.maxHp = 1000;
    t.hp = 500;
    b1.hp = b1.maxHp * 0.5;
    run(s, 1);
    expect(t.hp).toBeCloseTo(520, 0); // 2 %/s, not 4 %
    expect(b2.hp).toBe(b2.maxHp);
    // b1 regenerates 3 %/s and is healed by b2 (2 %/s).
    expect(b1.hp / b1.maxHp).toBeCloseTo(0.55, 2);
  });

  it('Membrane Attack suppression stops regen and heal for 6 s', () => {
    const s = arena();
    const b = spawnAt(s, 'biofilm', 10, { frozen: true });
    b.hp = b.maxHp * 0.5;
    b.regenSuppressedUntil = s.time + 6;
    run(s, 2);
    expect(b.hp).toBeCloseTo(b.maxHp * 0.5, 6);
  });
});

describe('stealth, flying and segments', () => {
  it('prions are untargetable until revealed (hero 2.0 / beacon); splash still hurts them', () => {
    const s = arena();
    place(s, 3, 2, 'antibody');
    const p = spawnAt(s, 'prion', 4, { frozen: true, hp: 1e4 });
    expect(ofType(run(s, 1), 'hit')).toHaveLength(0);
    s.hero.x = 3.5;
    s.hero.y = 3.4;
    const ev = run(s, 1);
    expect(p.revealed).toBe(true);
    expect(ofType(ev, 'hit').some((h) => h.enemy === p.id && h.kind === 'antibody')).toBe(true);
    // Splash on an unrevealed prion.
    const s2 = arena();
    place(s2, 3, 2, 'mast');
    const pr = spawnAt(s2, 'prion', 4, { frozen: true, hp: 1e4 });
    spawnAt(s2, 'bacterium', 4.3, { frozen: true, hp: 1e4 });
    run(s2, 1);
    expect(pr.revealed).toBe(false);
    expect(pr.hp).toBeLessThan(1e4);
  });

  it('a dead hero reveals nothing; Keen Blanc reveals within 3.0', () => {
    const s = arena({ memory: memoryWith(['toughBlanc', 'sharpBlanc']) });
    const p = spawnAt(s, 'prion', 4, { frozen: true, hp: 1e4 });
    s.hero.x = 3.5;
    s.hero.y = 4.3; // 2.8 away
    run(s, 0.05);
    expect(p.revealed).toBe(true);
    s.hero.alive = false;
    s.hero.respawnAt = s.time + 100;
    run(s, 0.05);
    expect(p.revealed).toBe(false);
  });

  it('toxin clouds fly: ignore flow, barriers and breathing; only antibody / complement / T-cell / hero / abilities hit them', () => {
    const s = arena();
    const t = spawnAt(s, 'toxin', 3);
    expect(enemyVelocity(s, t)).toBeCloseTo(1.5, 6);
    for (const k of ['mast', 'macrophage', 'pyrogen'] as const) expect(canTarget(s, k, t)).toBe(false);
    for (const k of ['antibody', 'complement', 'tcell'] as const) expect(canTarget(s, k, t)).toBe(true);
    castAbility(s, 'fever');
    expect(enemyVelocity(s, t)).toBeCloseTo(0.9, 6);
  });

  it('parasites: 5 segments 0.45 apart; a tower that only reaches a segment can still shoot it', () => {
    const s = arena({ wave: 8 });
    place(s, 3, 0, 'antibody'); // reaches row 1 up to x ≈ 5.9
    const p = spawnAt(s, 'parasite', 7.5, { frozen: true }); // head at (7.0, 1.5): 3.6 away, out of range
    expect(p.segments.map((d) => Math.round(d * 100) / 100)).toEqual([7.05, 6.6, 6.15, 5.7, 5.25]);
    const ev = run(s, 1);
    expect(ofType(ev, 'hit').some((h) => h.enemy === p.id)).toBe(true);
  });
});

describe('flow and breathing (§5.2)', () => {
  it('flow factors: ground 1.3 / 0.8 / 1.0, bosses 1.15 / 0.9 / 1.0', () => {
    const s = arena({ map: 'gut' });
    const w = spawnAt(s, 'bacterium', 4, { frozen: true });
    const a = spawnAt(s, 'bacterium', 15, { frozen: true });
    const still = spawnAt(s, 'bacterium', 10.5, { frozen: true });
    const bw = spawnAt(s, 'superbug', 4, { frozen: true });
    const ba = spawnAt(s, 'superbug', 15, { frozen: true });
    for (const e of [w, a, still]) e.speed = 1;
    bw.speed = ba.speed = 1;
    expect([enemyVelocity(s, w), enemyVelocity(s, a), enemyVelocity(s, still)]).toEqual([1.3, 0.8, 1]);
    expect([enemyVelocity(s, bw), enemyVelocity(s, ba)]).toEqual([1.15, 0.9]);
  });

  it('fever is a separate layer that bypasses the 65 % slow cap (bosses −20 %)', () => {
    const s = arena();
    const e = spawnAt(s, 'bacterium', 4, { frozen: true });
    const b = spawnAt(s, 'superbug', 4.5, { frozen: true });
    e.speed = b.speed = 1;
    e.slows.push({ src: 1, amount: 0.9, until: 1e9 });
    expect(enemyVelocity(s, e)).toBeCloseTo(1.3 * 0.35, 6);
    castAbility(s, 'fever');
    expect(enemyVelocity(s, e)).toBeCloseTo(1.3 * 0.35 * 0.6, 6);
    expect(enemyVelocity(s, b)).toBeCloseTo(1.15 * 0.8, 6);
  });

  it('Alveoli breathes in waves only: warn at 8 s, reverse at 9 s for 3 s, push back 1 cell (bosses 0.5)', () => {
    const s = arena({ map: 'alveoli' });
    const e = spawnAt(s, 'bacterium', 10, { frozen: true });
    const b = spawnAt(s, 'superbug', 12, { frozen: true });
    const f = spawnAt(s, 'toxin', 12, { frozen: true });
    e.speed = 0;
    let ev = run(s, 8.05);
    expect(ofType(ev, 'flowWarn')).toHaveLength(1);
    expect(s.flow.warn).toBe(true);
    ev = run(s, 1);
    expect(ofType(ev, 'flowReverse')).toEqual([{ type: 'flowReverse', reversed: true }]);
    expect(e.dist).toBeCloseTo(9, 6);
    expect(b.dist).toBeCloseTo(11.5, 6);
    expect(f.dist).toBeCloseTo(12, 6);
    expect(e.px).toBeCloseTo(e.x, 6);
    e.speed = 1;
    expect(enemyVelocity(s, e)).toBeCloseTo(0.8, 6);
    ev = run(s, 3);
    expect(ofType(ev, 'flowReverse')).toEqual([{ type: 'flowReverse', reversed: false }]);
    // The timer pauses outside waves.
    s.enemies.length = 0;
    s.waveState.queue = [];
    run(s, 0.05);
    expect(s.phase).toBe('countdown');
    const t = s.flow.cycleT;
    run(s, 3);
    expect(s.flow.cycleT).toBe(t);
  });

  it('a pushed barrier attacker is interrupted for 1 s and walks back', () => {
    const s = arena({ map: 'alveoli' });
    place(s, 2, 2, 'barrier'); // path A cell, dist 4
    const e = spawnAt(s, 'bacterium', 3, { hp: 1e6 });
    run(s, 8.9);
    expect(e.attacking).not.toBeNull();
    run(s, 0.15);
    expect(e.attacking).toBeNull();
    expect(e.attackBlockedUntil).toBeGreaterThan(s.time);
    run(s, 2);
    expect(e.attacking).not.toBeNull();
  });
});

describe('spawning and leaks', () => {
  it('scripted spawns enter one cell outside the grid with ≥ 0.35 cells spacing per path', () => {
    const s = arena();
    s.waveState.queue = [
      { type: 'bacterium', at: 0, pathIndex: 0 },
      { type: 'bacterium', at: 0, pathIndex: 0 },
    ];
    s.waveState.elapsed = 0;
    const ev = run(s, 0.05);
    expect(ofType(ev, 'spawn')).toHaveLength(1);
    expect(ofType(ev, 'spawn')[0]).toMatchObject({ x: -0.5, y: 1.5 });
    run(s, 0.3);
    expect(s.enemies).toHaveLength(2);
    expect(s.enemies[0].dist - s.enemies[1].dist).toBeGreaterThanOrEqual(0.35 - 1e-9);
  });

  it('a whole scripted wave spawns, every enemy is accounted for (killed or leaked) and the wave clears', () => {
    const s = arena({ wave: 7 });
    s.waveState.queue = expandWave(findMap('vessel'), waveScript('vessel', 7), 7);
    s.waveState.elapsed = 0;
    s.vitality = 1000;
    const ev = runUntil(s, () => s.phase !== 'wave', 200);
    const spawned = ofType(ev, 'spawn').length;
    expect(spawned).toBe(20);
    expect(ofType(ev, 'leak').length + ofType(ev, 'kill').length).toBe(spawned);
    expect(s.phase).toBe('countdown');
    expect(s.stats.vitLost).toBe(20);
  });

  it('hard enemies have more HP, speed and armor', () => {
    const n = arena({ wave: 10 });
    const h = arena({ wave: 10, difficulty: 'hard' });
    const a = spawnAt(n, 'encapsulated', 3);
    const b = spawnAt(h, 'encapsulated', 3);
    expect(b.maxHp).toBe(Math.round(90 * growth(10) * 1.25));
    expect(b.speed).toBeCloseTo(a.speed * 1.08, 9);
    expect(b.armor).toBe(a.armor + 1);
    expect(b.reward).toBeLessThan(a.reward);
  });

  it('startWave queues the expanded script and announces the boss', () => {
    const s = arena({ wave: 4 });
    s.waveState.queue = [];
    s.enemies.length = 0;
    run(s, 0.05);
    const bonus = startWave(s, true);
    expect(bonus).toBeGreaterThan(0);
    expect(s.wave).toBe(5);
    expect(s.waveState.total).toBe(7);
    const ev = run(s, 0.05);
    expect(ofType(ev, 'spawn')[0].enemy).toBe('superbug');
  });
});
