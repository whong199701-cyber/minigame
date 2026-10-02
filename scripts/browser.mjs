// Shared helpers: start a Vite dev server on a free port and open a mobile-emulated Chromium page.
import { createServer } from 'vite';
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const CHROMIUM = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

export async function startServer() {
  const server = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    logLevel: 'error',
    server: { port: 0, host: '127.0.0.1', strictPort: false },
  });
  await server.listen();
  const addr = server.httpServer.address();
  const url = `http://127.0.0.1:${addr.port}/`;
  return { server, url };
}

export async function launchBrowser() {
  return chromium.launch({ executablePath: CHROMIUM, headless: true });
}

export async function newMobilePage(browser, opts = {}) {
  const device = devices['iPhone 13'];
  const context = await browser.newContext({
    ...device,
    deviceScaleFactor: 2,
    locale: opts.locale ?? 'zh-CN',
    colorScheme: opts.colorScheme ?? 'dark',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
  });
  page.__errors = errors;
  return page;
}

/**
 * Convenience for ad-hoc interaction scripts:
 *   await withGame('water-sort', async (page) => { await page.tap('canvas'); ... });
 */
export async function withGame(id, fn, opts = {}) {
  const { server, url } = await startServer();
  const browser = await launchBrowser();
  try {
    const page = await newMobilePage(browser, opts);
    await page.goto(url + '#/game/' + id);
    await page.waitForSelector('[data-game][data-ready="1"]', { timeout: 15000 });
    // Dismiss the first-run rules modal if present.
    await page.waitForTimeout(300);
    const modalBtn = page.locator('.modal-backdrop.open .modal-actions .btn').first();
    if (await modalBtn.count()) await modalBtn.click();
    await page.waitForTimeout(250);
    return await fn(page);
  } finally {
    await browser.close();
    await server.close();
  }
}
