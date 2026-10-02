// Renders public/icon.svg to the PNG sizes the PWA manifest needs.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';

const svg = fs.readFileSync('public/icon.svg', 'utf8');
const out = 'public/icons';
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage();
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['apple-touch-icon.png', 180, false],
  ['maskable-512.png', 512, true],
];
for (const [name, size, maskable] of targets) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons need the artwork inside the safe zone: scale down and pad with the brand colour.
  const inner = maskable ? Math.round(size * 0.8) : size;
  const pad = Math.round((size - inner) / 2);
  await page.setContent(
    `<html><body style="margin:0;background:#0f1218;width:${size}px;height:${size}px;overflow:hidden">` +
      `<div style="position:absolute;left:${pad}px;top:${pad}px;width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: path.join(out, name), clip: { x: 0, y: 0, width: size, height: size }, omitBackground: false });
  console.log('wrote', name);
}
await browser.close();
