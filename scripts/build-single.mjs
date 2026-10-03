// Builds the whole app into ONE self-contained HTML file (all games, styles and icons inlined).
// The file can be opened straight from disk or attached/shared; no server and no network needed.
// Usage: node scripts/build-single.mjs [output.html]   (default: dist-single/brain-arena.html)
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const outDir = path.join(root, 'dist-single');
const target = path.resolve(process.argv[2] ?? path.join(outDir, 'brain-arena.html'));

await build({
  root,
  configFile: false,
  base: './',
  logLevel: 'warn',
  publicDir: false,
  plugins: [
    {
      // The service worker cannot run from a local file, so registration becomes a no-op.
      name: 'stub-pwa-register',
      resolveId: (id) => (id === 'virtual:pwa-register' ? '\0pwa-stub' : null),
      load: (id) => (id === '\0pwa-stub' ? 'export function registerSW() { return () => {}; }' : null),
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: false,
    chunkSizeWarningLimit: 4096,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

let html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
const read = (rel) => fs.readFileSync(path.join(outDir, rel.replace(/^\.\//, '')), 'utf8');

// Inline the stylesheet(s).
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>\n${read(href)}\n</style>`);
// Inline the single JS bundle. Escape "</script" so the code cannot close the tag early.
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const code = read(src).replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${code}\n</script>`;
});
// Inline the icons as data URIs and drop the manifest link (not usable from a local file).
const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(path.join(root, 'public', file)).toString('base64')}`;
html = html
  .replace(/href="[^"]*icon\.svg"/, `href="${dataUri('icon.svg', 'image/svg+xml')}"`)
  .replace(/href="[^"]*apple-touch-icon\.png"/, `href="${dataUri('icons/apple-touch-icon.png', 'image/png')}"`)
  .replace(/<link rel="manifest"[^>]*>/g, '');

if (/<script[^>]+src=|<link rel="stylesheet"/.test(html)) throw new Error('Some assets were not inlined');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, html);
console.log(`Wrote ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
