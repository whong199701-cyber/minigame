# Game development guide

Brain Arena is a mobile-first PWA (Vite + TypeScript, no framework). The shell (`src/app/*`) owns routing,
header, settings, i18n, theme, audio, haptics and storage. Each game is an isolated module under
`src/games/<id>/` that the shell lazy-loads.

## File layout for one game

```
src/games/<id>/
  index.ts        default export: GameModule { strings, create(ctx) }   (UI + wiring)
  logic.ts        pure game logic: generation, rules, solver — NO DOM access
  logic.test.ts   vitest unit tests for logic.ts
  style.css       optional; every class MUST be prefixed with a unique game prefix (e.g. `.ws-`)
```

Reference implementation: `src/games/mastermind/` (DOM-based). Canvas snippet below.

## The contract (`src/app/types.ts`)

```ts
const game: GameModule = {
  strings: { zh: { rules: '...', ...}, en: { rules: '...', ... } },  // `rules` is mandatory
  create(ctx: GameContext): GameInstance { ...; return { destroy() {} }; },
};
export default game;
```

`ctx` gives you:

| member | use |
| --- | --- |
| `ctx.root` | your container (flex column, fills the screen under the header, `position: relative`, `overflow: hidden`). Build everything inside it. |
| `ctx.t(key, params?)` | translate: your `strings` first, then the common dictionary (`src/app/i18n.ts` — reuse `play`, `restart`, `easy`, `best`, `win`, `lose`, `nextLevel`, `level`, `score`, `time`, `moves`, …). `{name}` placeholders are interpolated. |
| `ctx.lang` | `'zh' \| 'en'` |
| `ctx.play(name)` | synthesized sounds: `tap move place pop success error win lose tick swoosh explosion coin shoot` |
| `ctx.haptic(kind)` | `light medium heavy success error` |
| `ctx.storage` | `get/set/remove` JSON scoped to the game; `recordBest(mode, value, 'higher'|'lower')` returns true on a new best; `getBest(mode)` |
| `ctx.showModal({title, body, buttons, dismissible})` | results / confirmations. `body` is text (newlines ok) or an element |
| `ctx.toast(msg)` | short notice |
| `ctx.setStatus(text)` | small text under the title in the header (e.g. `Level 3 · 00:42`) |
| `ctx.addHeaderAction({icon,label,onClick})` | header buttons (restart ↻, undo ↶, hint 💡). Returns a remover; call it in `destroy`/`onDestroy`. |
| `ctx.onDestroy(fn)` | register cleanups (timers, listeners, ResizeObservers) |
| `ctx.onVisibility(fn)` | pause loops when the tab is hidden |
| `ctx.onThemeChange(fn)` / `ctx.theme` / `ctx.cssVar('--accent')` | theme-aware canvas colours: read `--bg --surface --surface-2 --border --text --muted --accent --accent-2 --success --danger --warning` |
| `ctx.exit()` | go home |

Helpers:

- `src/app/ui.ts`: `el(tag, attrs, ...children)`, `button(label, onClick, {variant: 'primary'|'secondary'|'ghost'|'danger', size})`, `segmented(options, value, onChange)`, `toggle(label, value, onChange)`, `formatTime(sec)`.
- `src/app/canvas.ts`: `createCanvas(container, onResize)` (DPR-aware, auto-resizes, draw in CSS px), `createLoop(update(dt))`, `onPointer(el, {down,move,up})` (element-local coords, touch+mouse), `onSwipe(el, {swipe(dir), tap(x,y)})`, `seededRandom(seed)`, `shuffle`, `clamp`, `roundRect`.
- CSS classes available globally (see `src/styles/base.css`): `.start-screen .big-icon`, `.game-hud .stat .stat-label .stat-value`, `.game-area`, `.game-controls`, `.game-scroll`, `.overlay`, `.btn…`, `.segmented`, `.muted .small .center`.

## Canvas skeleton

```ts
import { createCanvas, createLoop, onPointer } from '../../app/canvas';

create(ctx) {
  const area = el('div', { class: 'game-area' });
  ctx.root.append(hud, area, controls);
  const cv = createCanvas(area, (w, h) => layout(w, h));
  const loop = createLoop((dt) => { update(dt); draw(cv.ctx, cv.width, cv.height); });
  const offPointer = onPointer(cv.canvas, { down(p) {...}, move(p) {...}, up(p) {...} });
  ctx.onVisibility((v) => (v ? loop.start() : loop.stop()));
  ctx.onThemeChange(() => draw(cv.ctx, cv.width, cv.height));
  loop.start();
  return { destroy() { loop.stop(); offPointer(); cv.destroy(); } };
}
```

## Requirements checklist (every game)

1. **Start screen** with the game icon, a short description line, difficulty/mode selector (persist the choice with `ctx.storage`), the current best for that mode, and a primary Play button. Remember `ctx.storage.get('mode', …)`.
2. **Depth for adults**: real difficulty levels, levels or escalating challenge, scoring, fair but demanding.
3. **Bilingual**: every visible string goes through `ctx.t`. Both `zh` and `en` must have the same keys. `rules` explains how to play and how to win (3–8 short lines, `\n` separated).
4. **Feedback**: `ctx.play` on actions, `win`/`lose` at the end, `ctx.haptic` on important events. Never spam `play` every frame.
5. **End of round**: `ctx.showModal` with result, `newBest` note when `recordBest` returns true, buttons for `newGame`/`retry`/`nextLevel` and `home`.
6. **Header**: `ctx.setStatus` for live info; `addHeaderAction` for restart / undo / hint where relevant.
7. **Mobile fit**: iPhone-size portrait (390×844) with no page scrolling (scroll only inside an intentional `.game-scroll`/list), touch targets ≥ 44 px, no hover-only interactions, no keyboard requirement (keyboard support is a bonus), `touch-action: none` on canvases, works in landscape/tablet widths too (just scale).
8. **Theme**: looks right in dark AND light themes (run the smoke test with `--light`).
9. **Lifecycle**: everything created is cleaned up in `destroy()` / `onDestroy` (intervals, rAF loops, listeners, observers). Pause loops on `onVisibility(false)`.
10. **Pure logic in `logic.ts` with unit tests** (generation validity, win detection, solver / solvability, edge cases).
11. **No new dependencies, no network, no external assets** (draw everything with canvas/CSS/emoji).
12. **No changes outside your folder** (`src/app/*`, `src/games/<other>/*`, `registry.ts`, `package.json` are off-limits).

## Verifying your game

```bash
npx tsc --noEmit 2>&1 | grep "src/games/<id>/"       # must print nothing
npx vitest run src/games/<id>                           # must pass
node scripts/smoke.mjs <id> --out /path/to/dir          # PASS + screenshots: <id>-rules.png, <id>.png
node scripts/smoke.mjs <id> --out /path/to/dir2 --lang en --light
```

Then LOOK at the screenshots (Read the png). For interaction testing write a small script:

```js
// /path/to/play.mjs
import { withGame } from '/home/user/minigame/scripts/browser.mjs';
await withGame('<id>', async (page) => {
  await page.locator('.start-screen .btn-primary').click();
  await page.waitForTimeout(300);
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x + 100, box.y + 100);      // or page.touchscreen.tap(x, y)
  await page.screenshot({ path: '/path/to/play.png' });
  console.log(page.__errors);                            // must be []
});
```

`withGame` starts a dev server on a free port, opens the game in an iPhone-13 emulated Chromium and
dismisses the first-run rules modal. `page.__errors` collects page errors and console.error calls.
