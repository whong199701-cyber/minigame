/**
 * Hero Blanc (§6) and the global abilities with cooldowns and talent modifiers (§6.1, §10.1).
 */
import { describe, expect, it } from 'vitest';
import { abilityDamage, addMark, castAbility, createGame, createSnapshot, defaultMemory, findMap, growth, heroDamage, mapInfo, moveHero, snapshot, startWave } from './logic';
import { MAP_IDS } from './types';
import { arena, memoryWith, ofType, place, run, spawnAt } from './sim/testkit';

describe('hero post beside the core (§6, QA round 2: Blanc used to spawn hidden inside the Brain core)', () => {
  const POSTS = { vessel: [5.5, 12.5], alveoli: [6.5, 12.5], gut: [6.5, 14.5], brain: [6.5, 14.5] } as const;

  it('every map: the post is a plain terrain cell touching the core, clear of the core mesh, nearest the camera', () => {
    for (const id of MAP_IDS) {
      const map = findMap(id);
      const mi = mapInfo(map);
      expect([mi.heroX, mi.heroY], id).toEqual(POSTS[id]);
      const c = Math.floor(mi.heroX);
      const r = Math.floor(mi.heroY);
      const i = r * map.cols + c;
      expect(mi.padKind[i], id).toBe(0);
      expect(mi.pathMask[i], id).toBe(0);
      expect(map.core.some(([x, y]) => x === c && y === r), id).toBe(false);
      expect(map.core.some(([x, y]) => Math.abs(x - c) <= 1 && Math.abs(y - r) <= 1), id).toBe(true);
      // the core mesh is ≈ 0.46 cells (Brain's two-cell core × 1.3 ≈ 0.6) around its centre
      expect(Math.hypot(mi.heroX - mi.coreX, mi.heroY - mi.coreY), id).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('a new run starts there, and a dead hero is reported at the post (respawn arc) until he reappears there', () => {
    const s = createGame({ mapId: 'brain', difficulty: 'normal', memory: defaultMemory() });
    const mi = mapInfo(s.map);
    expect([s.hero.x, s.hero.y]).toEqual([mi.heroX, mi.heroY]);
    const snap = createSnapshot(s.map);
    s.hero.x = s.hero.px = 2.5;
    s.hero.y = s.hero.py = 6.5;
    snapshot(s, snap, 1);
    expect([snap.hero.x, snap.hero.y]).toEqual([2.5, 6.5]);
    s.hero.alive = false;
    s.hero.respawnAt = s.time + 5;
    snapshot(s, snap, 1);
    expect([snap.hero.x, snap.hero.y]).toEqual([mi.heroX, mi.heroY]);
  });
});

describe('hero movement', () => {
  it('walks in a straight line at 2.6 cells/s, emits heroMove, stops at the destination', () => {
    const s = arena();
    const h = s.hero;
    h.x = h.px = 1.5;
    h.y = h.py = 8.5;
    expect(moveHero(s, 1.5, 11.1)).toBe(true);
    run(s, 0.5);
    expect(h.y).toBeCloseTo(8.5 + 1.3, 5);
    run(s, 1);
    expect(h.y).toBeCloseTo(11.1, 6);
    expect(h.dest).toBeNull();
  });

  it('clamps destinations to the grid; Rapid Response walks 20 % faster; a dead hero cannot move', () => {
    const s = arena({ memory: memoryWith(['toughBlanc', 'sharpBlanc', 'rapidResponse']) });
    moveHero(s, -5, 99);
    expect(s.hero.dest).toEqual({ x: 0.25, y: s.map.rows - 0.25 });
    const h = s.hero;
    h.x = h.px = 4.5;
    h.y = h.py = 6.5;
    moveHero(s, 4.5, 9.5);
    run(s, 0.5);
    expect(h.y - 6.5).toBeCloseTo(2.6 * 1.2 * 0.5, 4);
    h.alive = false;
    h.respawnAt = s.time + 100;
    expect(moveHero(s, 1, 1)).toBe(false);
    expect(ofType(run(s, 1 / 60), 'denied').map((d) => d.reason)).toEqual(['heroDead']);
  });

  it('heroMove is emitted only by a successful move', () => {
    const s = arena();
    moveHero(s, 2, 2);
    const ev = run(s, 1 / 60);
    expect(ofType(ev, 'heroMove')).toEqual([{ type: 'heroMove', x: 2, y: 2 }]);
  });
});

describe('hero combat', () => {
  it('auto-attacks the nearest enemy only while idle, applying marks; damage scales with the wave', () => {
    const s = arena({ wave: 10 });
    const h = s.hero;
    h.x = h.px = 3.5;
    h.y = h.py = 2.5;
    const e = spawnAt(s, 'encapsulated', 4, { frozen: true, hp: 1e4 });
    const far = spawnAt(s, 'bacterium', 7, { frozen: true, hp: 1e4 });
    let ev = run(s, 0.05);
    const atk = ofType(ev, 'heroAttack');
    expect(atk).toHaveLength(1);
    expect(atk[0].enemy).toBe(e.id);
    expect(heroDamage(s)).toBeCloseTo(12 * (1 + 0.08 * 9), 6);
    expect(atk[0].dmg).toBeCloseTo(12 * 1.72 - e.armor, 6);
    expect(e.mark.stacks).toBe(1);
    expect(far.hp).toBe(1e4);
    // Walking: no attacks.
    moveHero(s, 3.5, 2.6);
    ev = run(s, 0.02);
    expect(ofType(ev, 'heroAttack')).toHaveLength(0);
    // 1.5 attacks/s while idle.
    ev = run(s, 2);
    expect(ofType(ev, 'heroAttack').length).toBe(3);
  });

  it('Keen Blanc: 2 mark stacks per hit and +25 % damage', () => {
    const s = arena({ memory: memoryWith(['toughBlanc', 'sharpBlanc']) });
    s.hero.x = s.hero.px = 3.5;
    s.hero.y = s.hero.py = 2.5;
    const e = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1e4 });
    const ev = run(s, 0.05);
    expect(ofType(ev, 'heroAttack')[0].dmg).toBeCloseTo(15, 6);
    expect(e.mark.stacks).toBe(2);
  });

  it('takes 0.25 × attack DPS from touching enemies, regenerates 8 %/s after 3 s, dies and respawns at the core', () => {
    const s = arena({ wave: 10 });
    const h = s.hero;
    h.x = h.px = 3.5;
    h.y = h.py = 1.5;
    const e = spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1e6 });
    const hp0 = h.hp;
    run(s, 1);
    expect(hp0 - h.hp).toBeCloseTo(0.25 * e.attack, 1);
    e.hp = 0;
    run(s, 0.1);
    h.hp = 60;
    h.lastHitAt = s.time;
    run(s, 2.9);
    expect(h.hp).toBe(60);
    run(s, 1.1);
    expect(h.hp).toBeGreaterThan(60 + h.maxHp * 0.08 * 0.9);
    expect(h.hp).toBeLessThan(60 + h.maxHp * 0.08 * 1.2);
    // Death.
    h.hp = 0.01;
    spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1e6 });
    const ev = run(s, 0.1);
    const death = ofType(ev, 'heroDeath');
    expect(death).toHaveLength(1);
    expect(death[0].respawnAt - s.time).toBeCloseTo(15 - 0.1 + 1 / 60, 1);
    expect(h.alive).toBe(false);
    const ev2 = run(s, 15);
    expect(ofType(ev2, 'heroRespawn')).toHaveLength(1);
    const mi = mapInfo(s.map);
    expect([h.x, h.y, h.px, h.py]).toEqual([mi.heroX, mi.heroY, mi.heroX, mi.heroY]);
    expect(h.hp).toBe(h.maxHp);
  });

  it('Rapid Response respawns in 8 s; Tough Blanc has 40 % more HP', () => {
    const s = arena({ memory: memoryWith(['toughBlanc', 'sharpBlanc', 'rapidResponse']) });
    expect(s.hero.maxHp).toBeCloseTo(168);
    s.hero.hp = 0.001;
    s.hero.x = s.hero.px = 3.5;
    s.hero.y = s.hero.py = 1.5;
    spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1e6 });
    const ev = run(s, 0.1);
    expect(ofType(ev, 'heroDeath')[0].respawnAt - s.time).toBeCloseTo(8 - 0.1 + 1 / 60, 1);
  });

  it('XP: +1 per kill, +3 when near or his own kill, +15 for a boss; levels at 40 / 110 heal to the new max', () => {
    const s = arena({ wave: 3 });
    const h = s.hero;
    const kill = (dist: number, type: 'bacterium' | 'superbug' = 'bacterium') => {
      const e = spawnAt(s, type, dist, { frozen: true });
      e.hp = 0;
      return run(s, 1 / 60);
    };
    kill(26); // far from the parked hero
    expect(h.xp).toBe(1);
    h.x = h.px = 3.5;
    h.y = h.py = 2.5;
    kill(4);
    expect(h.xp).toBe(4);
    h.hp = 10;
    const ev = kill(4, 'superbug');
    expect(ofType(ev, 'kill')[0].boss).toBe(true);
    expect(h.xp).toBe(19);
    for (let i = 0; i < 7; i++) kill(4);
    expect(h.xp).toBe(40);
    expect(h.level).toBe(2);
    expect(h.hp).toBe(180);
    for (let i = 0; i < 24; i++) kill(4);
    expect(h.xp).toBe(112);
    expect(h.level).toBe(3);
    expect(h.maxHp).toBe(260);
  });
});

describe('hero cures (§5.3)', () => {
  it('cures by touch (also while walking) and grants 3 s of infection immunity', () => {
    const s = arena();
    const t = place(s, 3, 0, 'antibody');
    t.infectedUntil = s.time + 8;
    moveHero(s, 3.5, 0.5);
    s.hero.x = s.hero.px = 3.5;
    s.hero.y = s.hero.py = 2.5;
    const ev = run(s, 1);
    const cure = ofType(ev, 'cure');
    expect(cure).toHaveLength(1);
    expect(cure[0].by).toBe('hero');
    expect(t.infectedUntil).toBeLessThanOrEqual(s.time);
    expect(t.immuneUntil - s.time).toBeGreaterThan(2);
    // A virus right next to it cannot re-infect during the immunity window.
    spawnAt(s, 'virus', 4, { frozen: true });
    run(s, 0.1);
    expect(t.infectedUntil).toBeLessThanOrEqual(s.time);
    expect(s.stats.cures).toBe(1);
  });

  it('Rapid Response: cure radius 1.5 and 5 s immunity', () => {
    const s = arena({ memory: memoryWith(['toughBlanc', 'sharpBlanc', 'rapidResponse']) });
    const t = place(s, 3, 0, 'antibody');
    t.infectedUntil = s.time + 8;
    s.hero.x = s.hero.px = 3.5;
    s.hero.y = s.hero.py = 1.9;
    run(s, 1 / 60);
    expect(t.immuneUntil - s.time).toBeCloseTo(5, 1);
  });
});

describe('abilities', () => {
  it('all ready at run start; usable in build / countdown / wave only', () => {
    const s = createGame({ mapId: 'vessel', difficulty: 'normal', memory: defaultMemory(), seed: 1 });
    expect(s.abilities.fever.readyAt).toBe(0);
    expect(castAbility(s, 'fever').ok).toBe(true);
    s.phase = 'over';
    expect(castAbility(s, 'adrenaline')).toEqual({ ok: false, reason: 'phase' });
    s.phase = 'build';
    expect(startWave(s)).toBe(0);
    expect(castAbility(s, 'adrenaline').ok).toBe(true);
  });

  it('fever: 6 s, cooldown 30 s (Cytokines 25.5 s), denied while cooling down', () => {
    const s = arena({ memory: memoryWith(['platelets', 'cytokines']) });
    expect(castAbility(s, 'fever').ok).toBe(true);
    expect(castAbility(s, 'fever')).toEqual({ ok: false, reason: 'cooldown' });
    expect(s.abilities.fever.readyAt - s.time).toBeCloseTo(25.5, 6);
    const ev = run(s, 6.05);
    expect(ofType(ev, 'abilityEnd')).toEqual([{ type: 'abilityEnd', ability: 'fever' }]);
    expect(ofType(ev, 'denied').map((d) => d.reason)).toEqual(['cooldown']); // the second cast above
    run(s, 19.5);
    expect(castAbility(s, 'fever').ok).toBe(true);
  });

  it('antibiotic strike: needs a target, lands after 0.4 s, 60 × g(w) armor-ignoring, ×2 bacteria / ×0.5 viral and other, hits flying and stealth', () => {
    const s = arena({ wave: 10 });
    expect(castAbility(s, 'antibiotic')).toEqual({ ok: false, reason: 'needTarget' });
    const bac = spawnAt(s, 'encapsulated', 4, { frozen: true, hp: 1e5 });
    const vir = spawnAt(s, 'prion', 4.5, { frozen: true, hp: 1e5 });
    const tox = spawnAt(s, 'toxin', 3.5, { frozen: true, hp: 1e5 });
    const out = spawnAt(s, 'bacterium', 8, { frozen: true, hp: 1e5 });
    expect(castAbility(s, 'antibiotic', { x: 3.5, y: 1.5 }).ok).toBe(true);
    let ev = run(s, 0.35);
    expect(ofType(ev, 'abilityImpact')).toHaveLength(0);
    ev = run(s, 0.1);
    const base = 60 * growth(10);
    expect(abilityDamage('antibiotic', 10)).toBeCloseTo(base, 6);
    expect(ofType(ev, 'abilityImpact')[0]).toMatchObject({ ability: 'antibiotic', hits: 3, radius: 1.5 });
    expect(1e5 - bac.hp).toBeCloseTo(base * 2, 4);
    expect(1e5 - vir.hp).toBeCloseTo(base * 0.5, 4);
    expect(1e5 - tox.hp).toBeCloseTo(base * 0.5, 4); // toxin clouds are family `other`
    expect(out.hp).toBe(1e5);
    expect(s.abilities.antibiotic.readyAt - s.time).toBeCloseTo(25 - 0.45, 1);
  });

  it('adrenaline: +60 % fire rate for 8 s', () => {
    const s = arena();
    place(s, 3, 0, 'antibody');
    spawnAt(s, 'bacterium', 4, { frozen: true, hp: 1e6 });
    const gap = (seconds: number) => {
      const times: number[] = [];
      for (let i = 0; i < Math.round(seconds * 60); i++) if (run(s, 1 / 60).some((x) => x.type === 'shoot')) times.push(s.time);
      return (times[times.length - 1] - times[0]) / (times.length - 1);
    };
    expect(gap(4)).toBeCloseTo(0.4, 2);
    castAbility(s, 'adrenaline');
    expect(gap(7)).toBeCloseTo(0.25, 2);
    run(s, 2);
    expect(gap(4)).toBeCloseTo(0.4, 2);
  });

  it('booster: locked without the talent; executes marked non-bosses below 30 %, takes 8 % from marked bosses', () => {
    const s0 = arena();
    expect(castAbility(s0, 'booster')).toEqual({ ok: false, reason: 'locked' });
    const all = ['affinity', 'reserve', 'platelets', 'toughBlanc', 'cytokines', 'maturation', 'booster'] as const;
    const s = arena({ wave: 5, memory: memoryWith([...all]) });
    expect(s.abilities.booster.unlocked).toBe(true);
    expect(s.abilities.booster.cooldown).toBeCloseTo(45 * 0.85);
    const weak = spawnAt(s, 'spore', 4, { frozen: true });
    weak.hp = weak.maxHp * 0.2;
    addMark(s, weak, 1, false);
    const unmarked = spawnAt(s, 'bacterium', 5, { frozen: true });
    unmarked.hp = unmarked.maxHp * 0.1;
    const healthy = spawnAt(s, 'bacterium', 6, { frozen: true });
    addMark(s, healthy, 1, false);
    const boss = spawnAt(s, 'superbug', 10, { frozen: true });
    addMark(s, boss, 1, false);
    const bossHp = boss.hp;
    expect(castAbility(s, 'booster').ok).toBe(true);
    // a flat 8 % of maxHP: the mark that makes the boss eligible does not multiply it
    expect(bossHp - boss.hp).toBeCloseTo(boss.maxHp * 0.08, 6);
    const ev = run(s, 1 / 60);
    expect(ofType(ev, 'execute').map((x) => [x.enemy, x.by])).toEqual([[weak.id, 'booster']]);
    expect(ofType(ev, 'split')).toHaveLength(1); // the executed spore still splits
    expect(unmarked.dead).toBe(false);
    expect(healthy.dead).toBe(false);
  });

  it('booster vs bosses stays a flat 8 % of maxHP with a strong mark and the vaccine', () => {
    const all = ['affinity', 'reserve', 'platelets', 'toughBlanc', 'cytokines', 'maturation', 'booster'] as const;
    const s = arena({ wave: 15, memory: memoryWith([...all], { superbug: true, virusKing: true }) });
    const sup = spawnAt(s, 'superbug', 10, { frozen: true });
    addMark(s, sup, 3, true);
    const king = spawnAt(s, 'virusKing', 14, { frozen: true });
    addMark(s, king, 3, false);
    const a = sup.hp;
    const b = king.hp;
    expect(castAbility(s, 'booster').ok).toBe(true);
    expect(a - sup.hp).toBeCloseTo(sup.maxHp * 0.08, 6);
    expect(b - king.hp).toBeCloseTo(king.maxHp * 0.08, 6);
    const hits = ofType(run(s, 1 / 60), 'hit').filter((h) => h.kind === 'ability');
    expect(hits.map((h) => Math.round(h.dmg))).toEqual([Math.round(sup.maxHp * 0.08), Math.round(king.maxHp * 0.08)]);
  });
});
