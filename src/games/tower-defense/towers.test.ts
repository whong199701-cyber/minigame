/**
 * Tower behaviour (§2), damage formulas (§5.1, §5.5), infection (§5.3) and barriers (§2.8, §5.4).
 * Vessel geometry used throughout: path row 1 holds cells (0,1)…(7,1) at dist 1…8; pad (3,0) and pad (3,2) sit
 * one cell above / below the path cell (3,1) (dist 4).
 */
import { describe, expect, it } from 'vitest';
import {
  addMark,
  build,
  canBuild,
  computeBuffs,
  dealDamage,
  growth,
  markMult,
  sell,
  setTargeting,
  towerStats,
  upgrade,
  canTarget,
  enemyVelocity,
  TOWERS,
} from './logic';
import { TOWER_IDS } from './types';
import { arena, memoryWith, ofType, place, run, spawnAt } from './sim/testkit';

const hitsOn = (ev: ReturnType<typeof run>, id: number) => ofType(ev, 'hit').filter((h) => h.enemy === id);

describe('damage pipeline (§5.1)', () => {
  it('armor is a flat reduction with a 20 % floor; ignoresArmor bypasses it', () => {
    const s = arena();
    const e = spawnAt(s, 'encapsulated', 4, { frozen: true, hp: 1000 });
    expect(e.armor).toBe(4);
    expect(dealDamage(s, e, 10, 'projectile', 1, 'antibody', null, false, false)).toBe(6);
    expect(dealDamage(s, e, 3, 'projectile', 1, 'antibody', null, false, false)).toBeCloseTo(0.6);
    expect(dealDamage(s, e, 3, 'projectile', 1, 'antibody', null, true, false)).toBe(3);
    expect(s.stats.dmgByTowerType.antibody).toBeCloseTo(9.6);
  });

  it('marks: +10 % per stack (max 3), strong +35 %, expire after 4 s / 7 s', () => {
    const s = arena();
    const e = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1000 });
    expect(markMult(e, s.time)).toBe(1);
    addMark(s, e, 1, false);
    expect(markMult(e, s.time)).toBeCloseTo(1.1);
    addMark(s, e, 5, false);
    expect(markMult(e, s.time)).toBeCloseTo(1.3);
    expect(e.mark.stacks).toBe(3);
    run(s, 4.05);
    expect(markMult(e, s.time)).toBe(1);
    addMark(s, e, 1, true);
    expect(markMult(e, s.time)).toBeCloseTo(1.35);
    run(s, 6.9);
    expect(markMult(e, s.time)).toBeCloseTo(1.35);
    run(s, 0.2);
    expect(markMult(e, s.time)).toBe(1);
    // Marks apply to every source, DoTs included.
    addMark(s, e, 2, false);
    expect(dealDamage(s, e, 10, 'aura', 1, 'pyrogen', null, true, true)).toBeCloseTo(12);
  });

  it('vaccines multiply damage vs the boss and the family it covers', () => {
    const s = arena({ memory: memoryWith([], { superbug: true }) });
    const spore = spawnAt(s, 'spore', 4, { frozen: true, hp: 1000 });
    const bac = spawnAt(s, 'bacterium', 5, { frozen: true, hp: 1000 });
    expect(dealDamage(s, spore, 10, null, -2, null, null, true, false)).toBeCloseTo(12.5);
    expect(dealDamage(s, bac, 10, null, -2, null, null, true, false)).toBeCloseTo(10);
  });

  it('Superbug capsule: tracer ×0.5, chain ×1.5', () => {
    const s = arena();
    const b = spawnAt(s, 'superbug', 4, { frozen: true });
    expect(dealDamage(s, b, 100, 'tracer', 1, 'tcell', null, true, false)).toBeCloseTo(50);
    expect(dealDamage(s, b, 100, 'chain', 1, 'complement', null, true, false)).toBeCloseTo(150);
    expect(b.boss?.dmgByTowerType.complement).toBeCloseTo(150);
  });
});

describe('antibody launcher', () => {
  it('fires projectiles that mark: damage climbs 7 → 7.7 → 8.4 → 9.1', () => {
    const s = arena();
    place(s, 3, 0, 'antibody');
    const e = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 10000 });
    const ev = run(s, 2);
    expect(ofType(ev, 'shoot').length).toBeGreaterThanOrEqual(5);
    const dmg = hitsOn(ev, e.id).map((h) => Math.round(h.dmg * 10) / 10);
    expect(dmg.slice(0, 5)).toEqual([7, 7.7, 8.4, 9.1, 9.1]);
    expect(ofType(ev, 'mark').map((m) => m.stacks)).toEqual([1, 2, 3]);
  });

  it('Neutralizing applies a strong mark from the first hit', () => {
    const s = arena();
    place(s, 3, 0, 'antibody', 3, 'neutralizing');
    const e = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 10000 });
    const ev = run(s, 1);
    const dmg = hitsOn(ev, e.id).map((h) => h.dmg);
    expect(dmg[0]).toBeCloseTo(18);
    expect(dmg[1]).toBeCloseTo(18 * 1.35);
    expect(e.mark.strong).toBe(true);
  });

  it('Polyvalent hits the target and the 2 nearest enemies within 1.5 cells of it (even out of tower range)', () => {
    const s = arena();
    place(s, 3, 0, 'antibody', 3, 'polyvalent');
    const a = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1000 });
    const b = spawnAt(s, 'bacterium', 5, { frozen: true, hp: 1000 });
    const c = spawnAt(s, 'bacterium', 5.9, { frozen: true, hp: 1000 });
    const d = spawnAt(s, 'bacterium', 7, { frozen: true, hp: 1000 }); // 3.16 from the tower: out of range
    const ev = run(s, 0.3);
    const firstVolley = ofType(ev, 'hit').slice(0, 3).map((h) => h.enemy);
    expect(firstVolley).toEqual([c.id, b.id, d.id]);
    expect(firstVolley).not.toContain(a.id);
    expect(ofType(ev, 'hit')[0].dmg).toBeCloseTo(10);
  });

  it('hits flying enemies', () => {
    const s = arena();
    place(s, 3, 0, 'antibody');
    const t = spawnAt(s, 'toxin', 4, { frozen: true, hp: 1000 });
    expect(hitsOn(run(s, 1), t.id).length).toBeGreaterThan(0);
  });
});

describe('macrophage', () => {
  it('engulfs a small enemy whole: reward, kill, no spore split', () => {
    const s = arena();
    place(s, 3, 2, 'macrophage');
    const spore = spawnAt(s, 'spore', 4, { frozen: true });
    const atp = s.atp;
    const ev = run(s, 0.05);
    expect(ofType(ev, 'engulf')[0]).toMatchObject({ enemy: spore.id, enemyType: 'spore' });
    expect(ofType(ev, 'kill')[0]).toMatchObject({ enemy: spore.id, reward: 6 });
    expect(ofType(ev, 'split')).toHaveLength(0);
    expect(s.enemies.length).toBe(0);
    expect(s.atp).toBe(atp + 6);
  });

  it('threshold = base × g(wave) × 1.5 when marked; cooldown and digestion follow the level', () => {
    const s = arena({ wave: 6 });
    const m = place(s, 3, 2, 'macrophage');
    const thr = 55 * growth(6);
    const e = spawnAt(s, 'bacterium', 4, { frozen: true, hp: thr * 1.4 });
    e.maxHp = 10000; // keep bites from killing it quickly
    run(s, 0.05);
    expect(e.dead).toBe(false); // too big
    addMark(s, e, 1, false);
    const ev = run(s, 0.05);
    expect(ofType(ev, 'engulf')).toHaveLength(1);
    expect(m.engulfReadyAt).toBeCloseTo(s.time - 0.05 + 7, 1);
    expect(m.digestingUntil).toBeCloseTo(s.time - 0.05 + 2.5, 1);
  });

  it('cannot engulf bosses, parasites, mutants or flying enemies; bites them instead', () => {
    const s = arena();
    place(s, 3, 2, 'macrophage');
    const p = spawnAt(s, 'parasite', 4, { frozen: true, hp: 10 });
    const mu = spawnAt(s, 'mutant', 3.5, { frozen: true, hp: 10 });
    const ev = run(s, 2);
    expect(ofType(ev, 'engulf')).toHaveLength(0);
    expect(ofType(ev, 'hit').some((h) => h.kind === 'macrophage')).toBe(true);
    expect(p.dead || mu.dead).toBe(true);
  });

  it('Enzymes: acid splash 35 % of the meal maxHP and a 3 s pool of 10 %/s (armor-ignoring)', () => {
    const s = arena();
    const m = place(s, 3, 2, 'macrophage', 3, 'enzymes');
    const meal = spawnAt(s, 'bacterium', 4, { frozen: true });
    const n = spawnAt(s, 'encapsulated', 4.9, { frozen: true, hp: 1000 });
    n.flying = false;
    const ev = run(s, 1 / 60);
    expect(ofType(ev, 'engulf')[0].enemy).toBe(meal.id);
    expect(ofType(ev, 'splash')[0]).toMatchObject({ kind: 'macrophage', hits: 1 });
    expect(s.pools).toHaveLength(1);
    expect(s.pools[0].dps).toBeCloseTo(4);
    expect(1000 - n.hp).toBeGreaterThanOrEqual(14 - 1e-6);
    sell(s, m.id);
    const hp = n.hp;
    run(s, 3.2);
    expect(hp - n.hp).toBeCloseTo(4 * 3, 0);
    expect(s.pools).toHaveLength(0);
  });
});

describe('mast cell', () => {
  it('splash: full damage to every ground enemy inside the radius, nothing outside, never flying', () => {
    const s = arena();
    place(s, 3, 2, 'mast');
    const a = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1000 });
    const b = spawnAt(s, 'bacterium', 5, { frozen: true, hp: 1000 });
    const c = spawnAt(s, 'bacterium', 2.5, { frozen: true, hp: 1000 });
    const fly = spawnAt(s, 'toxin', 4.6, { frozen: true, hp: 1000 });
    const ev = run(s, 1);
    // Target = first in range = b (dist 5); a sits 1.0 away (inside 1.1), c 2.5 away (outside).
    const splash = ofType(ev, 'splash')[0];
    expect(splash).toMatchObject({ kind: 'mast', hits: 2, radius: 1.1 });
    expect(1000 - b.hp).toBeCloseTo(40);
    expect(1000 - a.hp).toBeCloseTo(40);
    expect(c.hp).toBe(1000);
    expect(fly.hp).toBe(1000);
  });

  it('a parasite counts once per splash; the Giant Parasite takes head + up to 3 segments', () => {
    const s = arena();
    place(s, 3, 2, 'mast', 3, 'allergyStorm');
    const gp = spawnAt(s, 'giantParasite', 6, { frozen: true });
    const hp0 = gp.hp;
    run(s, 1.2);
    expect(hp0 - gp.hp).toBeCloseTo(4 * (100 - gp.armor));
    const s2 = arena();
    place(s2, 3, 2, 'mast', 3, 'allergyStorm');
    const p = spawnAt(s2, 'parasite', 6, { frozen: true });
    const hp1 = p.hp;
    run(s2, 1.2);
    expect(hp1 - p.hp).toBeCloseTo(100 - p.armor);
  });

  it('Allergy Storm slows every hit enemy 20 % for 1.5 s', () => {
    const s = arena();
    const t = place(s, 3, 2, 'mast', 3, 'allergyStorm');
    const e = spawnAt(s, 'bacterium', 5, { frozen: true, hp: 1000 });
    run(s, 1);
    expect(e.slows.find((x) => x.src === t.id)?.amount).toBeCloseTo(0.2);
  });

  it('Histamine Burn: 16 × g^0.5 DPS for 4 s, armor-ignoring, max 3 burns from different towers', () => {
    const s = arena({ wave: 10 });
    place(s, 3, 2, 'mast', 3, 'histamineBurn');
    place(s, 3, 0, 'mast', 3, 'histamineBurn');
    place(s, 5, 2, 'mast', 3, 'histamineBurn');
    place(s, 4, 3, 'mast', 3, 'histamineBurn');
    const e = spawnAt(s, 'encapsulated', 4.5, { frozen: true, hp: 1e6 });
    run(s, 0.6);
    expect(e.dots.length).toBe(3);
    expect(e.dots[0].dps).toBeCloseTo(16 * Math.sqrt(growth(10)), 4);
  });
});

describe('pyrogen node', () => {
  it('slows (lingering 0.4 s) and burns with an armor-ignoring aura of auraDps × g^0.5', () => {
    const s = arena({ wave: 10 });
    const t = place(s, 3, 2, 'pyrogen');
    const e = spawnAt(s, 'encapsulated', 4, { frozen: true, hp: 1000 });
    run(s, 1);
    expect(1000 - e.hp).toBeCloseTo(4 * Math.sqrt(growth(10)), 1);
    const sl = e.slows.find((x) => x.src === t.id);
    expect(sl?.amount).toBeCloseTo(0.25);
    expect((sl?.until ?? 0) - s.time).toBeCloseTo(0.4, 1);
  });

  it('slowed walk: 25 % slower inside the aura; flying enemies ignore it', () => {
    const s = arena();
    place(s, 3, 2, 'pyrogen');
    const e = spawnAt(s, 'bacterium', 3.2, { hp: 1e6 });
    const f = spawnAt(s, 'toxin', 3.2, { hp: 1e6 });
    const d0 = e.dist;
    const f0 = f.dist;
    run(s, 0.5);
    expect((e.dist - d0) / 0.5).toBeCloseTo(1.3 * 1.3 * 0.75, 1);
    expect((f.dist - f0) / 0.5).toBeCloseTo(1.5, 1);
    expect(f.hp).toBe(1e6);
  });

  it('Low Fever stuns once per enemy per tower (not bosses); High Fever slows 55 %', () => {
    const s = arena();
    place(s, 3, 2, 'pyrogen', 3, 'lowFever');
    const e = spawnAt(s, 'bacterium', 4, { hp: 1e6 });
    const b = spawnAt(s, 'superbug', 4.2);
    const ev = run(s, 2);
    const stuns = ofType(ev, 'stun');
    expect(stuns.map((x) => x.enemy)).toEqual([e.id]);
    expect(b.stunUntil).toBe(0);
    const s2 = arena();
    const hf = place(s2, 3, 2, 'pyrogen', 3, 'highFever');
    const e2 = spawnAt(s2, 'bacterium', 4, { frozen: true, hp: 1e6 });
    run(s2, 0.1);
    expect(e2.slows.find((x) => x.src === hf.id)?.amount).toBeCloseTo(0.55);
  });

  it('tower slows stack per source but cap at 65 % (× slow resist)', () => {
    const s = arena();
    place(s, 3, 2, 'pyrogen', 3, 'highFever');
    place(s, 3, 0, 'pyrogen', 3, 'highFever');
    const e = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1e6 });
    const p = spawnAt(s, 'parasite', 4.2, { frozen: true, hp: 1e6 });
    run(s, 0.1);
    e.speed = 1;
    p.speed = 1;
    expect(enemyVelocity(s, e)).toBeCloseTo(1.3 * 0.35, 4);
    expect(enemyVelocity(s, p)).toBeCloseTo(1.3 * (1 - Math.min(0.65, 1.1 * 0.75)), 4);
  });
});


describe('killer T-cell', () => {
  it('×1.5 marked, ×1.5 boss, ×2 spawned, product capped at ×4; capsule halves tracers', () => {
    const s = arena();
    place(s, 3, 2, 'tcell');
    const plain = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1e4 });
    let ev = run(s, 0.05);
    expect(hitsOn(ev, plain.id)[0].dmg).toBeCloseTo(70);
    plain.hp = 0;
    run(s, 0.05);
    const sp = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1e4, spawned: true });
    addMark(s, sp, 1, false);
    run(s, 2.1);
    ev = run(s, 2);
    expect(hitsOn(ev, sp.id)[0].dmg).toBeCloseTo(70 * 3 * 1.1, 4);
    sp.hp = 0;
    run(s, 2.1);
    const boss = spawnAt(s, 'superbug', 4, { frozen: true, spawned: true });
    addMark(s, boss, 1, false);
    ev = run(s, 2.1);
    // 70 × min(4, 1.5·1.5·2) × mark 1.1 × capsule 0.5 − armor 8
    expect(hitsOn(ev, boss.id)[0].dmg).toBeCloseTo(70 * 4 * 1.1 * 0.5 - 8, 4);
  });

  it('Perforin ignores armor; Apoptosis executes non-bosses below 15 %', () => {
    const s = arena();
    place(s, 3, 2, 'tcell', 3, 'perforin');
    const e = spawnAt(s, 'encapsulated', 4, { frozen: true, hp: 1e4 });
    expect(hitsOn(run(s, 0.05), e.id)[0].dmg).toBeCloseTo(230);
    const s2 = arena();
    place(s2, 3, 2, 'tcell', 3, 'apoptosis');
    const v = spawnAt(s2, 'bacterium', 4, { frozen: true, hp: 1000 });
    v.maxHp = 1500;
    v.hp = 400; // 200 dmg leaves 200 < 15 % of 1500
    const ev = run(s2, 0.05);
    expect(ofType(ev, 'execute')[0]).toMatchObject({ enemy: v.id, by: 'apoptosis' });
    expect(ofType(ev, 'kill')[0].enemy).toBe(v.id);
  });

  it('defaults to the strongest target; flying is fair game', () => {
    const s = arena();
    const t = place(s, 3, 2, 'tcell');
    expect(t.targeting).toBe('strongest');
    spawnAt(s, 'bacterium', 4, { frozen: true, hp: 100 });
    const big = spawnAt(s, 'toxin', 3, { frozen: true, hp: 900 });
    const ev = run(s, 0.05);
    expect(ofType(ev, 'tracer')).toHaveLength(1);
    expect(ofType(ev, 'hit')[0].enemy).toBe(big.id);
  });
});

describe('complement cascade', () => {
  it('chains to the nearest unhit enemy within 1.3 cells with −25 % per jump', () => {
    const s = arena();
    place(s, 3, 2, 'complement');
    const e3 = spawnAt(s, 'bacterium', 3, { frozen: true, hp: 1e4 });
    const e4 = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1e4 });
    const e5 = spawnAt(s, 'bacterium', 5, { frozen: true, hp: 1e4 });
    const e6 = spawnAt(s, 'bacterium', 6, { frozen: true, hp: 1e4 });
    const ev = run(s, 0.05);
    const chain = ofType(ev, 'chain')[0];
    expect(chain.points).toHaveLength(4); // tower + 3 targets
    const hits = ofType(ev, 'hit');
    expect(hits.map((h) => h.enemy)).toEqual([e6.id, e5.id, e4.id]);
    expect(hits.map((h) => h.dmg)).toEqual([20, 15, 11.25]);
    expect(e3.hp).toBe(1e4);
  });

  it('jumps 2.4 cells only between two marked enemies; never onto unrevealed stealth', () => {
    const s = arena();
    place(s, 3, 2, 'complement');
    const a = spawnAt(s, 'bacterium', 6, { frozen: true, hp: 1e4 });
    const b = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1e4 });
    let hits = ofType(run(s, 0.05), 'hit');
    expect(hits.map((h) => h.enemy)).toEqual([a.id]);
    addMark(s, a, 1, false);
    addMark(s, b, 1, false);
    s.towers[0].readyAt = s.time;
    hits = ofType(run(s, 0.05), 'hit');
    expect(hits.map((h) => h.enemy)).toEqual([a.id, b.id]);
    const s2 = arena();
    place(s2, 3, 2, 'complement');
    const x = spawnAt(s2, 'bacterium', 5, { frozen: true, hp: 1e4 });
    const pr = spawnAt(s2, 'prion', 4, { frozen: true, hp: 1e4 });
    const h2 = ofType(run(s2, 0.05), 'hit');
    expect(h2.map((h) => h.enemy)).toEqual([x.id]);
    expect(pr.hp).toBe(1e4);
  });

  it('×1.6 vs regen / shield; Membrane Attack ×2.2, suppresses regen and ends Shell Hardening', () => {
    const s = arena();
    place(s, 3, 2, 'complement');
    const bio = spawnAt(s, 'biofilm', 5, { frozen: true, hp: 1e4 });
    expect(ofType(run(s, 0.05), 'hit')[0].dmg).toBeCloseTo(32);
    expect(bio.regenSuppressedUntil).toBe(0);
    const s2 = arena();
    place(s2, 3, 2, 'complement', 3, 'membraneAttack');
    const sb = spawnAt(s2, 'superbug', 5, { frozen: true });
    if (sb.boss) sb.boss.hardenedUntil = s2.time + 8;
    const ev = run(s2, 0.05);
    // 44 × 2.2 × capsule 1.5 − hardened armor (8 × 2) … hardening ends after the hit
    expect(ofType(ev, 'hit')[0].dmg).toBeCloseTo(44 * 2.2 * 1.5 - 16, 4);
    expect(sb.regenSuppressedUntil).toBeCloseTo(s2.time + 6 - 0.05, 1);
    expect(sb.boss?.hardenedUntil).toBeLessThanOrEqual(s2.time);
  });

  it('Long Chain: 6 targets, 1.8 jump, −15 %', () => {
    const s = arena();
    place(s, 3, 2, 'complement', 3, 'longChain');
    for (let d = 1.5; d <= 7; d += 1) spawnAt(s, 'bacterium', d, { frozen: true, hp: 1e4 });
    const hits = ofType(run(s, 0.05), 'hit');
    expect(hits).toHaveLength(6);
    expect(hits[1].dmg / hits[0].dmg).toBeCloseTo(0.85);
  });
});

describe('interferon beacon', () => {
  it('buffs towers in range (max of local buffs, not the sum); Alarm adds a global +8 %', () => {
    const s = arena();
    const ab = place(s, 4, 3, 'antibody');
    const far = place(s, 6, 12, 'antibody');
    place(s, 3, 2, 'beacon');
    computeBuffs(s);
    expect(ab.buff.rate).toBeCloseTo(1.1);
    place(s, 5, 2, 'beacon', 2);
    computeBuffs(s);
    expect(ab.buff.rate).toBeCloseTo(1.18);
    expect(far.buff.rate).toBe(1);
    place(s, 5, 11, 'beacon', 3, 'alarm');
    computeBuffs(s);
    expect(ab.buff.rate).toBeCloseTo(1.26);
    expect(ab.buff.dmg).toBeCloseTo(1.08);
    expect(far.buff.rate).toBeCloseTo(1 + 0.12 + 0.08);
  });

  it('Potentiate: +40 % rate, +20 % dmg, +0.5 range; L3 makes towers in range immune to infection', () => {
    const s = arena();
    const ab = place(s, 4, 3, 'antibody');
    place(s, 3, 2, 'beacon', 3, 'potentiate');
    computeBuffs(s);
    expect([ab.buff.rate, ab.buff.dmg, ab.buff.range, ab.buff.immune]).toEqual([1.4, 1.2, 0.5, true]);
    expect(towerStats(s, ab).range).toBeCloseTo(3.1);
    spawnAt(s, 'virus', 15, { frozen: true }); // cell (3,4): adjacent to (4,3)
    run(s, 0.1);
    expect(ab.infectedUntil).toBe(0);
  });

  it('cure pulse every cureEvery clears infection in range; reveals prions in its reveal radius', () => {
    const s = arena();
    const ab = place(s, 4, 3, 'antibody');
    place(s, 3, 2, 'beacon');
    ab.infectedUntil = s.time + 8;
    const ev = run(s, 2.1);
    expect(ofType(ev, 'cure')[0]).toMatchObject({ tower: ab.id, by: 'beacon' });
    expect(ab.infectedUntil).toBeLessThanOrEqual(s.time);
    const pr = spawnAt(s, 'prion', 4, { frozen: true, hp: 1e4 });
    const pr2 = spawnAt(s, 'prion', 26, { frozen: true, hp: 1e4 });
    const ev2 = run(s, 0.1);
    expect(pr.revealed).toBe(true);
    expect(pr2.revealed).toBe(false);
    expect(ofType(ev2, 'reveal')[0]).toMatchObject({ enemy: pr.id, revealed: true });
    expect(canTarget(s, 'antibody', pr)).toBe(true);
    expect(canTarget(s, 'antibody', pr2)).toBe(false);
  });
});

describe('infection (§5.3)', () => {
  it('a passing virus infects adjacent towers once for 8 s, halving their fire rate', () => {
    const s = arena();
    const near = place(s, 3, 0, 'antibody');
    const far = place(s, 3, 8, 'antibody');
    const bc = place(s, 5, 2, 'beacon');
    const v = spawnAt(s, 'virus', 1);
    const ev = run(s, 4);
    const inf = ofType(ev, 'infect');
    expect(inf.map((i) => i.tower)).toEqual([near.id]);
    expect(inf[0].until - s.time).toBeGreaterThan(3);
    expect(far.infectedUntil).toBe(0);
    expect(bc.infectedUntil).toBe(0);
    expect(v.infected).toEqual([near.id]);
    // Fire rate: count shots on a frozen target while infected vs clean.
    const s2 = arena();
    const t = place(s2, 3, 0, 'antibody');
    spawnAt(s2, 'bacterium', 4, { frozen: true, hp: 1e6 });
    const clean = ofType(run(s2, 4), 'shoot').length;
    t.infectedUntil = s2.time + 100;
    const sick = ofType(run(s2, 4), 'shoot').length;
    expect(sick / clean).toBeCloseTo(0.5, 1);
  });
});

describe('platelet barrier (§2.8, §5.4)', () => {
  it('only on legal path cells: not on pads, ban zones, occupied cells; max 3', () => {
    const s = arena();
    expect(canBuild(s, 3, 0, 'barrier').reason).toBe('notPath');
    expect(canBuild(s, 1, 1, 'barrier').reason).toBe('barrierZone');
    expect(canBuild(s, 3, 1, 'antibody').reason).toBe('notPad');
    place(s, 3, 1, 'barrier');
    expect(canBuild(s, 3, 1, 'barrier').reason).toBe('occupied');
    place(s, 7, 2, 'barrier');
    place(s, 3, 4, 'barrier');
    expect(canBuild(s, 3, 7, 'barrier').reason).toBe('barrierLimit');
    s.atp = 10;
    expect(canBuild(s, 3, 0, 'antibody').reason).toBe('noAtp');
  });

  it('blocks ground enemies at barrierDist − 0.45, which chew through it; flying pass', () => {
    const s = arena();
    const b = place(s, 4, 1, 'barrier'); // dist 5
    const e = spawnAt(s, 'bacterium', 2, { hp: 1e6 });
    const f = spawnAt(s, 'toxin', 2, { hp: 1e6 });
    run(s, 3);
    expect(e.dist).toBeCloseTo(5 - 0.45, 6);
    expect(e.attacking).toBe(b.id);
    expect(f.dist).toBeGreaterThan(5);
    const hp = b.hp;
    run(s, 1);
    expect(hp - b.hp).toBeCloseTo(8, 1);
    // Breaks, releases the attacker.
    b.hp = 5;
    const ev = run(s, 1);
    expect(ofType(ev, 'barrierBroken')[0].tower).toBe(b.id);
    expect(s.towers.includes(b)).toBe(false);
    expect(e.dist).toBeGreaterThan(5);
  });

  it('regenerates after 3 s without damage; upgrade restores full HP; platelets talent ×1.3; Fibrin 2200', () => {
    const s = arena({ memory: memoryWith(['platelets']) });
    const b = place(s, 4, 1, 'barrier');
    expect(b.maxHp).toBeCloseTo(400 * 1.3);
    b.hp = 100;
    b.regenAt = s.time + 3;
    run(s, 2);
    expect(b.hp).toBe(100);
    run(s, 2);
    expect(b.hp).toBeCloseTo(100 + 6, 0);
    upgrade(s, b.id);
    expect(b.hp).toBeCloseTo(800 * 1.3);
    upgrade(s, b.id, 'fibrin');
    expect(b.maxHp).toBeCloseTo(2200 * 1.3);
  });

  it('Clot Spikes reflect 4 % of the attacker maxHP per attack-second and burn contacts 2 %/s', () => {
    const s = arena();
    place(s, 4, 1, 'barrier', 3, 'clotSpikes');
    const e = spawnAt(s, 'bacterium', 4.4, { hp: 1000 });
    e.maxHp = 1000;
    run(s, 1);
    // Attacking (4 %/s reflect) and within 0.6 of the barrier centre (2 %/s contact).
    expect(1000 - e.hp).toBeCloseTo(60, -1);
  });

  it('bosses smash a barrier on contact and pause 1 s; a charging Giant Parasite does not pause', () => {
    const s = arena();
    const b = place(s, 4, 1, 'barrier');
    const boss = spawnAt(s, 'superbug', 4.5);
    const ev = run(s, 0.2);
    expect(ofType(ev, 'barrierSmashed')[0]).toMatchObject({ tower: b.id, by: boss.id });
    expect(s.towers.includes(b)).toBe(false);
    const d = boss.dist;
    run(s, 0.7);
    expect(boss.dist).toBeCloseTo(d, 6);
    run(s, 0.5);
    expect(boss.dist).toBeGreaterThan(d);
    const s2 = arena();
    place(s2, 4, 1, 'barrier');
    const gp = spawnAt(s2, 'giantParasite', 4.4);
    if (gp.boss) gp.boss.charging = true;
    const d2 = gp.dist;
    run(s2, 0.3);
    expect(gp.dist - d2).toBeCloseTo(0.7 * 3 * 0.3, 1);
  });

  it('enemies already past the stop point when it is built are unaffected', () => {
    const s = arena();
    const e = spawnAt(s, 'bacterium', 4.7, { hp: 1e6 });
    place(s, 4, 1, 'barrier');
    run(s, 0.5);
    expect(e.dist).toBeGreaterThan(5);
    expect(e.attacking).toBeNull();
  });
});

describe('targeting modes', () => {
  it('first / strongest / marked with lowest-id tie-breaks', () => {
    const s = arena();
    const t = place(s, 3, 2, 'tcell');
    const a = spawnAt(s, 'bacterium', 3, { frozen: true, hp: 500 });
    const b = spawnAt(s, 'bacterium', 5, { frozen: true, hp: 300 });
    const c = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 500 });
    const first = () => ofType(run(s, 2), 'hit')[0].enemy;
    setTargeting(s, t.id, 'first');
    expect(first()).toBe(b.id);
    setTargeting(s, t.id, 'strongest');
    a.hp = c.hp = 500;
    expect(first()).toBe(c.id); // tie on HP → the one further along
    setTargeting(s, t.id, 'marked');
    addMark(s, a, 3, false);
    expect(first()).toBe(a.id);
  });
});

describe('commands', () => {
  it('build / upgrade / sell bookkeeping and denials', () => {
    const s = arena();
    s.atp = 500;
    const t = build(s, 3, 0, 'antibody');
    expect(t?.invested).toBe(60);
    expect(s.atp).toBe(440);
    expect(build(s, 3, 0, 'mast')).toBeNull();
    expect(upgrade(s, t?.id ?? 0)).toBe(true);
    expect(upgrade(s, t?.id ?? 0)).toBe(false); // L3 needs a spec
    expect(upgrade(s, t?.id ?? 0, 'fibrin')).toBe(false);
    expect(upgrade(s, t?.id ?? 0, 'polyvalent')).toBe(true);
    expect(upgrade(s, t?.id ?? 0, 'polyvalent')).toBe(false);
    expect(t?.invested).toBe(185);
    expect(sell(s, t?.id ?? 0)).toBe(130);
    expect(s.towers.length).toBe(0);
    expect(s.atp).toBe(500 - 185 + 130);
  });

  it('denied events carry the reason', () => {
    const s = arena();
    s.atp = 0;
    build(s, 3, 0, 'antibody');
    build(s, 0, 0, 'antibody');
    const ev = ofType(run(s, 1 / 60), 'denied').map((d) => d.reason);
    expect(ev).toEqual(['noAtp', 'notPad']);
  });

  it('towerStats: L1 DPS lines match the spec table', () => {
    const s = arena();
    const dps: Record<string, number> = { antibody: 17.5, macrophage: 19.8, mast: 24, tcell: 35, complement: 20 };
    let col = 0;
    for (const id of TOWER_IDS) {
      if (id === 'barrier') continue;
      const pads = s.map.pads;
      const t = place(s, pads[col][0], pads[col][1], id);
      col++;
      computeBuffs(s);
      const st = towerStats(s, t);
      if (dps[id] !== undefined) expect(st.dps, id).toBeCloseTo(dps[id], 1);
      expect(st.upgradeCost).toBe(TOWERS[id].levels[1].cost);
      expect(st.sellValue).toBe(Math.round(0.7 * t.invested));
      expect(st.nextLevel?.range).toBeGreaterThanOrEqual(st.range);
    }
  });

  it('villi pads add +1 range (+0.5 for base range ≥ 3.5)', () => {
    const s = arena({ map: 'gut' });
    const a = place(s, 9, 2, 'antibody');
    const t = place(s, 9, 3, 'tcell');
    computeBuffs(s);
    expect(a.onVilli).toBe(true);
    expect(towerStats(s, a).range).toBeCloseTo(3.6);
    expect(towerStats(s, t).range).toBeCloseTo(4.5);
  });
});

