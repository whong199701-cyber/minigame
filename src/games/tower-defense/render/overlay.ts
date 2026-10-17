/**
 * 2D canvas overlay above the WebGL canvas (full device pixel ratio for crisp text): enemy / boss / barrier / hero
 * HP bars with mark pips, infection and immunity glyphs, floating damage numbers and labels (pooled, capped at
 * RENDER_BUDGET.maxFloatingText), wave-start banners and full-screen ability vignettes. Everything is projected from
 * 3D each frame; strings and fonts are cached so drawing does not allocate.
 */
import { ENEMY_IDS, EnemyViewFlag, RENDER_BUDGET, TOWER_IDS, type RenderSnapshot } from '../types';
import { EnemyLayer, ENEMY_VIS_SCALE } from './enemies';
import type { Translate } from './strings';
import type { TowerLayer } from './towers';
import { TOWER_ACCENT } from './palette';

export interface OverlayOptions {
  hpBars: boolean;
  damageNumbers: boolean;
  banners: boolean;
  labels: boolean;
  vignettes: boolean;
}

type ProjectFn = (x: number, y: number, h: number, out: { x: number; y: number }) => boolean;

interface FloatText {
  active: boolean;
  x: number;
  y: number;
  h: number;
  text: string;
  color: string;
  font: string;
  t0: number;
  life: number;
  rise: number;
  /** ≥ 0: status label of one entity (a tower id) — at most one live label per key. */
  key: number;
}

/** A keyed status label with the same text is not restarted within this many renderer seconds. */
const STATUS_REPEAT_S = 1.2;

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Noto Sans SC', sans-serif";
const fonts: string[] = [];
for (let s = 0; s <= 40; s++) fonts.push(`800 ${s}px ${FONT_STACK}`);
const font = (px: number): string => fonts[Math.max(0, Math.min(40, Math.round(px)))];

const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
/** Wave-start banner duration (renderer seconds). */
const BANNER_S = 2.3;

export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 1;
  private h = 1;
  private texts: FloatText[] = [];
  private nextText = 0;
  private pt = { x: 0, y: 0 };
  private bannerText = '';
  private bannerSub = '';
  private bannerSubColor = '#ff6b8b';
  private bannerT0 = -10;
  private bannerW = 0;
  private bannerSubW = 0;
  private immuneLabels: string[] = [];
  private immuneColors: string[] = TOWER_IDS.map((id) => hex(TOWER_ACCENT[id]));
  private enemyNames: string[] = [];
  private vign: Record<string, CanvasGradient | null> = { fever: null, adrenaline: null, leak: null, booster: null, flow: null };
  /** Biohazard badges on pads a previewed virus wave can infect: x, y pairs (cell centres), `riskN` used. */
  private risk = new Float32Array(128);
  private riskN = 0;
  private riskH = 0.12;
  flashLeak = 0;
  flashBooster = 0;
  flashFlow = 0;
  options: OverlayOptions = { hpBars: true, damageNumbers: true, banners: true, labels: true, vignettes: true };
  textStroke = 'rgba(20,4,16,0.9)';

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tdr-overlay';
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', display: 'block' });
    parent.appendChild(this.canvas);
    const c = this.canvas.getContext('2d');
    if (!c) throw new Error('2d context unavailable');
    this.ctx = c;
    for (let i = 0; i < RENDER_BUDGET.maxFloatingText + 10; i++) {
      this.texts.push({ active: false, x: 0, y: 0, h: 0, text: '', color: '#fff', font: fonts[12], t0: 0, life: 1, rise: 30, key: -1 });
    }
  }

  setTranslator(tr: Translate): void {
    this.immuneLabels = TOWER_IDS.map((id) => tr('fx_immuneTo', { name: tr('tower_' + id) }));
    this.enemyNames = ENEMY_IDS.map((id) => tr('enemy_' + id));
  }

  /** Max overlay pixel ratio (crisp text; 3 on high, 2 on low quality). */
  maxDpr = 3;

  resize(w: number, h: number): void {
    this.dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    const ctx = this.ctx;
    const mk = (r: number, g: number, b: number): CanvasGradient => {
      const gr = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) * 0.58);
      gr.addColorStop(0, `rgba(${r},${g},${b},0)`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0.85)`);
      return gr;
    };
    this.vign.fever = mk(255, 120, 30);
    this.vign.adrenaline = mk(255, 40, 60);
    this.vign.leak = mk(255, 20, 50);
    this.vign.booster = mk(190, 90, 255);
    this.vign.flow = mk(120, 200, 255);
  }

  /**
   * Floating text at a world point. `key` ≥ 0 makes it the status label of one entity (a tower's "infected!" /
   * "cured"): it replaces that key's live label in place instead of stacking a new one on the same anchor (mass
   * infection with beacons curing every 1–2 s piled them into an unreadable cluster), and the same text is not
   * restarted within STATUS_REPEAT_S.
   */
  addText(x: number, y: number, h: number, text: string, color: string, px: number, now: number, life = 0.9, rise = 34, key = -1): void {
    let slot = -1;
    const cap = RENDER_BUDGET.maxFloatingText;
    if (key >= 0) {
      for (let i = 0; i < cap; i++) {
        const g = this.texts[i];
        if (g.active && g.key === key && now - g.t0 < g.life) {
          if (g.text === text && now - g.t0 < STATUS_REPEAT_S) return;
          slot = i;
          break;
        }
      }
    }
    if (slot < 0) {
      for (let i = 0; i < cap; i++) {
        const k = (this.nextText + i) % cap;
        if (!this.texts[k].active) {
          slot = k;
          break;
        }
      }
      if (slot < 0) slot = this.nextText % cap;
      this.nextText = (slot + 1) % cap;
    }
    const f = this.texts[slot];
    f.key = key;
    f.active = true;
    f.x = x;
    f.y = y;
    f.h = h;
    f.text = text;
    f.color = color;
    f.font = font(px);
    f.t0 = now;
    f.life = life;
    f.rise = rise;
  }

  /** Live floating texts at renderer time `now` (optionally only those showing `text`) — diagnostics and tests. */
  liveTexts(now: number, text?: string): number {
    let n = 0;
    for (const f of this.texts) if (f.active && now - f.t0 < f.life && (text === undefined || f.text === text)) n++;
    return n;
  }

  banner(text: string, sub: string, subColor: number, now: number): void {
    this.bannerText = text;
    this.bannerSub = sub;
    this.bannerSubColor = hex(subColor);
    this.bannerT0 = now;
    const ctx = this.ctx;
    ctx.font = font(30);
    this.bannerW = ctx.measureText(text).width;
    ctx.font = font(16);
    this.bannerSubW = sub ? ctx.measureText(sub).width : 0;
  }

  setRisk(cells: readonly (readonly [number, number])[] | null, padHeight: number): void {
    const n = cells ? cells.length : 0;
    if (this.risk.length < n * 2) this.risk = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      this.risk[i * 2] = cells![i][0] + 0.5;
      this.risk[i * 2 + 1] = cells![i][1] + 0.5;
    }
    this.riskN = n;
    this.riskH = padHeight;
  }

  /** Small static biohazard badge (pads at risk of infection). */
  private riskGlyph(x: number, y: number, r: number, alpha: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(16,24,0,0.78)';
    ctx.beginPath();
    ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d4ff3a';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = '#d4ff3a';
    ctx.font = fonts[Math.round(r * 2)];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('☣', x, y + 0.5);
    ctx.globalAlpha = 1;
  }

  /** Whether the wave banner is still visible at renderer time `now`. */
  bannerActive(now: number): boolean {
    const t = now - this.bannerT0;
    return this.options.banners && t >= 0 && t < BANNER_S;
  }

  get busy(): boolean {
    for (let i = 0; i < this.texts.length; i++) if (this.texts[i].active) return true;
    return this.flashLeak > 0 || this.flashBooster > 0 || this.flashFlow > 0;
  }

  clearAll(): void {
    for (const t of this.texts) t.active = false;
    this.bannerT0 = -10;
    this.flashLeak = this.flashBooster = this.flashFlow = 0;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private bar(cx: number, cy: number, w: number, hgt: number, frac: number, fill: string): void {
    const ctx = this.ctx;
    const x = Math.round(cx - w / 2);
    const y = Math.round(cy);
    ctx.fillStyle = 'rgba(12,2,10,0.72)';
    ctx.fillRect(x - 1, y - 1, w + 2, hgt + 2);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, Math.max(0, Math.round(w * frac)), hgt);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x, y, Math.max(0, Math.round(w * frac)), 1);
  }

  private virusGlyph(x: number, y: number, r: number, now: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(now * 1.5);
    ctx.fillStyle = 'rgba(16,24,0,0.75)';
    ctx.beginPath();
    ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b6ff3a';
    ctx.fillStyle = '#b6ff3a';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
      ctx.lineTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private shieldGlyph(x: number, y: number, r: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,20,30,0.7)';
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7fe8ff';
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.85, y - r * 0.55);
    ctx.quadraticCurveTo(x + r * 0.75, y + r * 0.6, x, y + r);
    ctx.quadraticCurveTo(x - r * 0.75, y + r * 0.6, x - r * 0.85, y - r * 0.55);
    ctx.closePath();
    ctx.fill();
  }

  draw(snap: RenderSnapshot | null, now: number, project: ProjectFn, towers: TowerLayer, hero: { visible: boolean; x: number; y: number; h: number }, vig: { fever: number; adrenaline: number }, dt: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const o = this.options;
    const pt = this.pt;
    // vignettes
    if (o.vignettes) {
      const v = this.vign;
      if (vig.fever > 0 && v.fever) {
        ctx.globalAlpha = vig.fever * (0.42 + 0.12 * Math.sin(now * 3));
        ctx.fillStyle = v.fever;
        ctx.fillRect(0, 0, this.w, this.h);
      }
      if (vig.adrenaline > 0 && v.adrenaline) {
        const beat = now % 0.8;
        ctx.globalAlpha = vig.adrenaline * (0.16 + 0.4 * Math.exp(-beat * 8));
        ctx.fillStyle = v.adrenaline;
        ctx.fillRect(0, 0, this.w, this.h);
      }
      if (this.flashLeak > 0 && v.leak) {
        ctx.globalAlpha = Math.min(1, this.flashLeak) * 0.6;
        ctx.fillStyle = v.leak;
        ctx.fillRect(0, 0, this.w, this.h);
      }
      if (this.flashBooster > 0 && v.booster) {
        ctx.globalAlpha = Math.min(1, this.flashBooster) * 0.7;
        ctx.fillStyle = v.booster;
        ctx.fillRect(0, 0, this.w, this.h);
      }
      if (this.flashFlow > 0 && v.flow) {
        ctx.globalAlpha = Math.min(1, this.flashFlow) * 0.45;
        ctx.fillStyle = v.flow;
        ctx.fillRect(0, 0, this.w, this.h);
      }
      ctx.globalAlpha = 1;
    }
    this.flashLeak = Math.max(0, this.flashLeak - dt * 1.6);
    this.flashBooster = Math.max(0, this.flashBooster - dt * 1.8);
    this.flashFlow = Math.max(0, this.flashFlow - dt * 1.4);

    // pads a previewed virus wave can infect: badge at the near rim of the pad, gently pulsing
    if (this.riskN > 0 && o.hpBars) {
      const a = 0.72 + 0.28 * Math.sin(now * 3.2);
      for (let i = 0; i < this.riskN; i++) {
        if (!project(this.risk[i * 2], this.risk[i * 2 + 1] + 0.32, this.riskH + 0.02, pt)) continue;
        this.riskGlyph(pt.x, pt.y, 6.5, a);
      }
    }
    if (snap && o.hpBars) {
      // towers: barrier HP, infection, immunity
      for (let i = 0; i < snap.towerCount; i++) {
        const tv = snap.towers[i];
        const top = towers.topOf(tv);
        const needBar = tv.typeId === 'barrier' && tv.hpFrac < 0.999;
        if (!needBar && !tv.infected && !tv.immune) continue;
        if (!project(tv.x, tv.y, top + 0.12, pt)) continue;
        let y = pt.y - 6;
        if (needBar) {
          const f = tv.hpFrac;
          this.bar(pt.x, y, 30, 5, f, f > 0.5 ? '#ffd27a' : f > 0.25 ? '#ff9a4a' : '#ff4d5e');
          y -= 12;
        }
        if (tv.infected) this.virusGlyph(pt.x, y - 4, 5, now);
        else if (tv.immune) this.shieldGlyph(pt.x, y - 4, 5.5);
      }
      // enemies
      const e = snap.enemies;
      for (let i = 0; i < e.count; i++) {
        const flags = e.flags[i];
        const boss = (flags & EnemyViewFlag.Boss) !== 0;
        const hp = e.hpFrac[i];
        const marks = e.markStacks[i];
        const immune = e.immuneTo[i];
        if (!boss && hp >= 0.999 && marks === 0) continue;
        if ((flags & EnemyViewFlag.Stealth) !== 0 && (flags & EnemyViewFlag.Revealed) === 0) continue;
        if ((flags & EnemyViewFlag.Burrowed) !== 0 && !boss) continue;
        const r = e.radius[i];
        const flying = (flags & EnemyViewFlag.Flying) !== 0;
        const top = EnemyLayer.bodyHeight(e.type[i], r, flying) + r * ENEMY_VIS_SCALE * 1.05 + 0.08;
        if (!project(e.x[i], e.y[i], top, pt)) continue;
        const w = boss ? 62 : Math.max(18, Math.min(36, r * 90));
        const bh = boss ? 6 : 4;
        const y = pt.y - bh - 3;
        if (hp < 0.999 || boss) this.bar(pt.x, y, w, bh, hp, hp > 0.6 ? '#62f58e' : hp > 0.3 ? '#ffd34d' : '#ff4d5e');
        if (marks > 0) {
          // Neutralizing (strong) marks: bigger hot-pink pips so +35 % reads apart from 3 normal stacks
          const strong = (flags & EnemyViewFlag.StrongMark) !== 0;
          ctx.fillStyle = strong ? '#ff5ad8' : '#d58bff';
          const pr = strong ? 2.6 : 2;
          for (let k = 0; k < marks; k++) {
            ctx.beginPath();
            ctx.arc(Math.round(pt.x - w / 2 - 5), Math.round(y + bh - k * (strong ? 6 : 5) - 1), pr, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (boss && o.labels) {
          ctx.font = fonts[12];
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.lineWidth = 3;
          ctx.strokeStyle = this.textStroke;
          let ly = y - 3;
          if (immune > 0) {
            const ti = immune - 1;
            const label = this.immuneLabels[ti] ?? '';
            ctx.fillStyle = this.immuneColors[ti] ?? '#ffffff';
            ctx.strokeText(label, pt.x, ly);
            ctx.fillText(label, pt.x, ly);
            ly -= 13;
          }
          const name = this.enemyNames[e.type[i]] ?? '';
          ctx.fillStyle = '#ffffff';
          ctx.strokeText(name, pt.x, ly);
          ctx.fillText(name, pt.x, ly);
        }
      }
      // hero
      if (hero.visible && snap.hero.alive && project(hero.x, hero.y, hero.h + 0.42, pt)) {
        const hv = snap.hero;
        if (hv.hpFrac < 0.999) this.bar(pt.x, pt.y - 8, 30, 4, hv.hpFrac, '#7dfff0');
        ctx.fillStyle = '#ffd34d';
        for (let k = 0; k < hv.level; k++) {
          ctx.beginPath();
          ctx.arc(Math.round(pt.x - (hv.level - 1) * 3.5 + k * 7), Math.round(pt.y - 13), 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // floating text
    if (o.damageNumbers || o.labels) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = this.textStroke;
      for (let i = 0; i < this.texts.length; i++) {
        const f = this.texts[i];
        if (!f.active) continue;
        const t = (now - f.t0) / f.life;
        if (t >= 1 || t < 0) {
          f.active = false;
          continue;
        }
        if (!project(f.x, f.y, f.h, pt)) continue;
        const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.55 : t < 0.25 ? 1.15 - ((t - 0.15) / 0.1) * 0.15 : 1;
        ctx.globalAlpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
        ctx.font = f.font;
        const yy = pt.y - t * f.rise;
        if (pop !== 1) {
          ctx.save();
          ctx.translate(pt.x, yy);
          ctx.scale(pop, pop);
          ctx.strokeText(f.text, 0, 0);
          ctx.fillStyle = f.color;
          ctx.fillText(f.text, 0, 0);
          ctx.restore();
        } else {
          ctx.strokeText(f.text, pt.x, yy);
          ctx.fillStyle = f.color;
          ctx.fillText(f.text, pt.x, yy);
        }
      }
      ctx.globalAlpha = 1;
    }
    // banner
    if (o.banners) {
      const t = now - this.bannerT0;
      const dur = BANNER_S;
      if (t >= 0 && t < dur) {
        const a = t < 0.25 ? t / 0.25 : t > dur - 0.45 ? (dur - t) / 0.45 : 1;
        const s = t < 0.25 ? 0.85 + 0.15 * (t / 0.25) : 1;
        const cy = this.h * 0.3;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(this.w / 2, cy);
        ctx.scale(s, s);
        const pw = Math.max(this.bannerW, this.bannerSubW) + 44;
        const ph = this.bannerSub ? 70 : 48;
        ctx.fillStyle = 'rgba(18,4,16,0.62)';
        ctx.beginPath();
        ctx.roundRect(-pw / 2, -24, pw, ph, 18);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = fonts[30];
        ctx.fillStyle = '#ffffff';
        ctx.fillText(this.bannerText, 0, 0);
        if (this.bannerSub) {
          ctx.font = fonts[16];
          ctx.fillStyle = this.bannerSubColor;
          ctx.fillText(this.bannerSub, 0, 30);
        }
        ctx.restore();
      }
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}
