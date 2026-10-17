/**
 * Small 2D map preview for the organ cards on the start screen: vessels (with flow chevrons), pads, villi, core.
 */
import type { MapDef } from '../types';
import { buildPathCells } from '../sim/maps';

export function drawMiniMap(canvas: HTMLCanvasElement, map: MapDef, theme: 'dark' | 'light', locked: boolean): void {
  const cssW = canvas.clientWidth || 120;
  const cssH = canvas.clientHeight || 150;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const pad = 6;
  const cell = Math.min((cssW - pad * 2) / map.cols, (cssH - pad * 2) / map.rows);
  const ox = (cssW - cell * map.cols) / 2;
  const oy = (cssH - cell * map.rows) / 2;
  const dark = theme === 'dark';
  // tissue
  const g = ctx.createLinearGradient(0, oy, 0, oy + cell * map.rows);
  g.addColorStop(0, dark ? '#4a1434' : '#f2c7cf');
  g.addColorStop(1, dark ? '#6b1f46' : '#f7d9dc');
  ctx.fillStyle = g;
  roundRect(ctx, ox - 3, oy - 3, cell * map.cols + 6, cell * map.rows + 6, 8);
  ctx.fill();
  // vessels
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const path of map.paths) {
    const cells = buildPathCells(path.waypoints);
    ctx.strokeStyle = dark ? '#2a0617' : '#b8566c';
    ctx.lineWidth = cell * 0.78;
    strokeCells(ctx, cells, ox, oy, cell);
    ctx.strokeStyle = dark ? '#d91e48' : '#e2405f';
    ctx.lineWidth = cell * 0.48;
    strokeCells(ctx, cells, ox, oy, cell);
    // flow chevrons per segment
    ctx.fillStyle = dark ? 'rgba(255,200,210,0.9)' : 'rgba(255,255,255,0.95)';
    for (let i = 0; i < path.waypoints.length - 1; i++) {
      const f = path.flow[i];
      if (f === 0) continue;
      const [c0, r0] = path.waypoints[i];
      const [c1, r1] = path.waypoints[i + 1];
      let dx = Math.sign(c1 - c0);
      let dy = Math.sign(r1 - r0);
      if (f < 0) {
        dx = -dx;
        dy = -dy;
      }
      const mx = ox + ((c0 + c1) / 2 + 0.5) * cell;
      const my = oy + ((r0 + r1) / 2 + 0.5) * cell;
      chevron(ctx, mx, my, dx, dy, cell * 0.22);
    }
    // spawn marker
    const [sc, sr] = path.waypoints[0];
    ctx.fillStyle = '#b8ff5a';
    ctx.beginPath();
    ctx.arc(ox + (sc + 0.5) * cell, oy + (sr + 0.5) * cell, cell * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  // pads
  for (const [c, r] of map.pads) {
    ctx.fillStyle = dark ? '#f6d2df' : '#ffffff';
    ctx.beginPath();
    ctx.arc(ox + (c + 0.5) * cell, oy + (r + 0.5) * cell, cell * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1fae9f';
    ctx.lineWidth = Math.max(1, cell * 0.08);
    ctx.stroke();
  }
  for (const [c, r] of map.villi) {
    ctx.fillStyle = '#ffc94d';
    ctx.beginPath();
    ctx.arc(ox + (c + 0.5) * cell, oy + (r + 0.5) * cell, cell * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
  // core
  for (const [c, r] of map.core) {
    const x = ox + (c + 0.5) * cell;
    const y = oy + (r + 0.5) * cell;
    const gl = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.9);
    gl.addColorStop(0, 'rgba(255,92,134,0.95)');
    gl.addColorStop(1, 'rgba(255,92,134,0)');
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff5c86';
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }
  if (locked) {
    ctx.fillStyle = dark ? 'rgba(15,18,24,0.55)' : 'rgba(255,255,255,0.55)';
    ctx.fillRect(0, 0, cssW, cssH);
  }
}

function strokeCells(ctx: CanvasRenderingContext2D, cells: readonly (readonly [number, number])[], ox: number, oy: number, cell: number): void {
  ctx.beginPath();
  cells.forEach(([c, r], i) => {
    const x = ox + (c + 0.5) * cell;
    const y = oy + (r + 0.5) * cell;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, s: number): void {
  const px = -dy;
  const py = dx;
  ctx.beginPath();
  ctx.moveTo(x + dx * s, y + dy * s);
  ctx.lineTo(x - dx * s + px * s, y - dy * s + py * s);
  ctx.lineTo(x - dx * s * 0.3, y - dy * s * 0.3);
  ctx.lineTo(x - dx * s - px * s, y - dy * s - py * s);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
