// Smoke test: open every game (or the ids given) in a mobile-emulated browser, check for runtime
// errors and take screenshots.  Usage: node scripts/smoke.mjs [id ...] [--out DIR] [--lang en] [--light]
import fs from 'node:fs';
import path from 'node:path';
import { startServer, launchBrowser, newMobilePage } from './browser.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(process.cwd(), '.smoke');
const langIdx = args.indexOf('--lang');
const lang = langIdx >= 0 ? args[langIdx + 1] : 'zh';
const light = args.includes('--light');
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--lang');

fs.mkdirSync(outDir, { recursive: true });

const { server, url } = await startServer();
const browser = await launchBrowser();
let failed = 0;
try {
  const page = await newMobilePage(browser, { locale: lang === 'zh' ? 'zh-CN' : 'en-US', colorScheme: light ? 'light' : 'dark' });
  await page.goto(url);
  await page.evaluate((l) => localStorage.setItem('ba:settings', JSON.stringify({ lang: l })), lang);
  await page.reload();
  const all = await page.evaluate(() => window.__ba.games.map((g) => g.id));
  const list = ids.length ? ids : all;
  // Home screenshot
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'home.png') });
  for (const id of list) {
    page.__errors.length = 0;
    await page.goto(url + '#/game/' + id);
    let ready = true;
    try {
      await page.waitForSelector(`[data-game="${id}"][data-ready="1"]`, { timeout: 15000 });
    } catch {
      ready = false;
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(outDir, `${id}-rules.png`) });
    // Close first-run rules modal, then capture the actual game screen.
    const btn = page.locator('.modal-backdrop.open .modal-actions .btn').first();
    if (await btn.count()) await btn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, `${id}.png`) });
    const errs = page.__errors.slice();
    const ok = ready && errs.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${ready ? '' : ' (not ready)'}`);
    for (const e of errs) console.log('   ' + e.split('\n')[0]);
  }
  console.log(`\n${list.length - failed}/${list.length} games passed. Screenshots in ${outDir}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
