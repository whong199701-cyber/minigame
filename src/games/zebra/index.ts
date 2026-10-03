import type { GameContext, GameInstance, GameModule, ModalHandle, Strings } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import {
  CATEGORIES,
  DIFFICULTIES,
  DIFFICULTY_LIST,
  SAVE_VERSION,
  applyPlacement,
  catKey,
  clueParts,
  contentStrings,
  countEmpty,
  countWrong,
  emptyTable,
  generatePuzzle,
  hasProgress,
  itemKey,
  parseSave,
  penaltySeconds,
  phraseKey,
  pickHint,
  solutionToTable,
  type Difficulty,
  type Puzzle,
  type SavedGame,
  type Table,
} from './logic';
import { UI_STRINGS } from './strings';
import './style.css';

const LONG_PRESS_MS = 480;
/** Save the running clock every this many status ticks (seconds); actions and hiding the page save immediately. */
const SAVE_EVERY_TICKS = 5;

const content = contentStrings();
const strings: Strings = {
  zh: { ...content.zh, ...UI_STRINGS.zh },
  en: { ...content.en, ...UI_STRINGS.en },
};

function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === 'string' && (DIFFICULTY_LIST as string[]).includes(v);
}

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const savedMode = ctx.storage.get<string>('mode', 'easy');
  let mode: Difficulty = isDifficulty(savedMode) ? savedMode : 'easy';

  // ── Round state ─────────────────────────────────────────────────────
  let puzzle: Puzzle | null = null;
  let table: Table = [];
  let locked: boolean[][] = [];
  let struck: boolean[] = [];
  let finished = true;
  let hints = 0;
  let failedChecks = 0;
  let elapsedBase = 0; // ms accumulated while paused
  let runningSince = 0;
  let running = false;
  let visible = true;
  let timer = 0;
  let ticks = 0;
  let pressTimer = 0;
  let finishTimer = 0;
  let suppressClick = false;
  let removeNewAction: (() => void) | null = null;

  // DOM refs for the game screen
  let cells: HTMLButtonElement[][] = [];
  let grid: HTMLElement | null = null;
  let filledEl: HTMLElement | null = null;
  let sheetBackdrop: HTMLElement | null = null;

  /** Plural-aware translation: picks `<base>One` or `<base>Many`. */
  const tn = (base: string, n: number): string => t(base + (n === 1 ? 'One' : 'Many'), { n });

  ctx.onVisibility((v) => {
    visible = v;
    if (finished) return;
    if (v) {
      resumeTimer();
    } else {
      pauseTimer();
      persist();
    }
  });

  // ── Persistence (one unfinished puzzle per difficulty) ───────────────
  const saveKey = (d: Difficulty): string => 'save_' + d;
  function loadSave(d: Difficulty): SavedGame | null {
    const save = parseSave(ctx.storage.get<unknown>(saveKey(d), null), d);
    if (!save) ctx.storage.remove(saveKey(d));
    return save;
  }
  function persist(): void {
    if (!puzzle || finished) return;
    const save: SavedGame = { v: SAVE_VERSION, puzzle, table, locked, struck, hints, failedChecks, elapsedMs: elapsedMs() };
    ctx.storage.set(saveKey(puzzle.difficulty), save);
  }

  // ── Timer ───────────────────────────────────────────────────────────
  function elapsedMs(): number {
    return elapsedBase + (running ? Date.now() - runningSince : 0);
  }
  function totalSec(): number {
    return Math.floor(elapsedMs() / 1000) + penaltySeconds(hints, failedChecks);
  }
  function resumeTimer(): void {
    if (running) return;
    running = true;
    runningSince = Date.now();
    clearInterval(timer);
    timer = window.setInterval(onTick, 1000);
    updateStatus();
  }
  function pauseTimer(): void {
    if (!running) return;
    elapsedBase += Date.now() - runningSince;
    running = false;
    clearInterval(timer);
    timer = 0;
  }
  function stopTimer(): void {
    pauseTimer();
    clearInterval(timer);
    timer = 0;
  }
  function onTick(): void {
    updateStatus();
    if (++ticks % SAVE_EVERY_TICKS === 0) persist();
  }
  function updateStatus(): void {
    if (!puzzle) return;
    let s = `${t(puzzle.difficulty)} · ${formatTime(totalSec())}`;
    if (hints > 0) s += ` · 💡${hints}`;
    ctx.setStatus(s);
  }

  // ── Header action (only while a puzzle is on screen) ─────────────────
  function setNewAction(on: boolean): void {
    if (on && !removeNewAction) {
      removeNewAction = ctx.addHeaderAction({ icon: '↻', label: t('newPuzzle'), onClick: () => openNewMenu() });
    } else if (!on && removeNewAction) {
      removeNewAction();
      removeNewAction = null;
    }
  }

  /** In-game ↻: a new puzzle of this difficulty, or back to the difficulty picker (keeping this puzzle saved). */
  function openNewMenu(): void {
    if (!puzzle) return;
    if (finished) {
      startGame();
      return;
    }
    closeSheet(true);
    const progress = hasProgress({ table, hints, failedChecks });
    let handle: ModalHandle | null = null;
    const body = el(
      'div',
      { class: 'zb-menu' },
      progress ? el('p', { class: 'muted small', text: t('newPuzzleWarn') }) : null,
      button(
        t('newPuzzleOf', { d: t(mode) }),
        () => {
          handle?.close();
          startGame();
        },
        { variant: 'primary', size: 'lg' },
      ),
      button(
        t('changeDifficulty'),
        () => {
          handle?.close();
          showStart();
        },
        { variant: 'secondary', size: 'lg' },
      ),
      progress ? el('p', { class: 'muted small', text: t('keptNote') }) : null,
    );
    handle = ctx.showModal({ title: t('newPuzzle'), body, buttons: [{ label: t('cancel') }] });
  }

  // ── Start screen ────────────────────────────────────────────────────
  function showStart(): void {
    stopTimer();
    persist(); // switching difficulty mid-game keeps the current puzzle
    finished = true;
    puzzle = null;
    clearTimeout(pressTimer);
    clearTimeout(finishTimer);
    closeSheet(true);
    setNewAction(false);
    root.innerHTML = '';
    ctx.setStatus('');
    const desc = el('p', { class: 'muted' });
    const bestLine = el('p', { class: 'muted zb-best' });
    const actions = el('div', { class: 'zb-start-actions' });
    const refresh = () => {
      desc.textContent = t(mode + 'Desc');
      const b = ctx.storage.getBest(mode);
      const solved = ctx.storage.get<number>('solved_' + mode, 0);
      const parts: string[] = [b === null ? t('noBest') : '🏆 ' + t('bestTime', { t: formatTime(b) })];
      if (solved > 0) parts.push(t('solvedCount', { n: solved }));
      bestLine.textContent = parts.join(' · ');

      actions.innerHTML = '';
      const save = loadSave(mode);
      if (save) {
        const { n, k } = DIFFICULTIES[mode];
        const shown = Math.floor(save.elapsedMs / 1000) + penaltySeconds(save.hints, save.failedChecks);
        actions.append(
          el('p', { class: 'muted small', text: t('savedNote', { a: n * k - countEmpty(save.table), b: n * k }) }),
          button(t('resumeBtn', { t: formatTime(shown) }), () => resumeGame(save), { variant: 'primary', size: 'lg', icon: '▶' }),
          button(t('newPuzzle'), () => confirmDiscard(save), { variant: 'secondary', size: 'lg' }),
        );
      } else {
        actions.append(button(t('play'), () => startGame(), { variant: 'primary', size: 'lg' }));
      }
    };
    refresh();
    root.append(
      el(
        'div',
        { class: 'start-screen zb-start' },
        el('div', { class: 'big-icon', text: '🦓' }),
        el('p', { class: 'zb-desc', text: t('desc') }),
        el('h2', { text: t('chooseDifficulty') }),
        segmented<Difficulty>(
          DIFFICULTY_LIST.map((d) => ({ value: d, label: t(d) })),
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            refresh();
          },
        ),
        desc,
        bestLine,
        actions,
      ),
    );
  }

  function confirmDiscard(save: SavedGame): void {
    if (!hasProgress(save)) {
      startGame();
      return;
    }
    ctx.showModal({
      title: t('newPuzzle'),
      body: t('discardConfirm', { d: t(mode) }),
      buttons: [{ label: t('cancel') }, { label: t('confirm'), primary: true, onClick: () => startGame() }],
    });
  }

  // ── Game screen ─────────────────────────────────────────────────────
  function startGame(): void {
    const p = generatePuzzle(mode);
    enterGame({
      v: SAVE_VERSION,
      puzzle: p,
      table: emptyTable(p.n, p.k),
      locked: Array.from({ length: p.n }, () => new Array<boolean>(p.k).fill(false)),
      struck: new Array<boolean>(p.clues.length).fill(false),
      hints: 0,
      failedChecks: 0,
      elapsedMs: 0,
    });
    persist(); // replaces any saved puzzle of this difficulty
  }

  function resumeGame(save: SavedGame): void {
    enterGame(save);
  }

  /** Build the play screen for a fresh or restored puzzle. */
  function enterGame(state: SavedGame): void {
    stopTimer();
    clearTimeout(pressTimer);
    clearTimeout(finishTimer);
    closeSheet(true);
    const p = state.puzzle;
    mode = p.difficulty;
    puzzle = p;
    table = state.table;
    locked = state.locked;
    struck = state.struck;
    hints = state.hints;
    failedChecks = state.failedChecks;
    elapsedBase = state.elapsedMs;
    running = false;
    ticks = 0;
    finished = false;
    root.innerHTML = '';
    setNewAction(true);

    // Top bar
    filledEl = el('span', { class: 'zb-filled' });
    const bar = el(
      'div',
      { class: 'zb-bar' },
      el('span', {}, el('b', { text: t('cluesCount', { n: p.clues.length }) }), el('span', { class: 'zb-bar-hint', text: ' · ' + t('cluesHint') })),
      filledEl,
    );

    // Clue list
    const list = el('div', { class: 'game-scroll zb-clues', role: 'list' });
    p.clues.forEach((clue, i) => {
      const textEl = el('span', { class: 'zb-clue-text' });
      for (const part of clueParts(clue, p.n, t, ctx.lang)) {
        if (part.kind === 'text') textEl.append(part.text);
        else textEl.append(el('span', { class: `zb-ref zb-c${part.ref.cat}` }, part.emoji ? part.emoji + ' ' : '', part.text));
      }
      const row = el(
        'button',
        { class: 'zb-clue' + (struck[i] ? ' done' : ''), type: 'button', role: 'listitem' },
        el('span', { class: 'zb-clue-num', text: String(i + 1) }),
        textEl,
      );
      row.addEventListener('click', () => {
        struck[i] = !struck[i];
        row.classList.toggle('done', struck[i]);
        ctx.play('tap');
        ctx.haptic('light');
        persist();
      });
      list.append(row);
    });

    // Grid: columns = houses 1..N left to right (so "left of" / "next to" read spatially), rows = categories
    grid = el('div', { class: 'zb-grid', role: 'grid' });
    grid.style.gridTemplateColumns = `44px repeat(${p.n}, minmax(0, 1fr))`;
    grid.classList.add(`zb-k${p.k}`);
    grid.append(el('div', { class: 'zb-hcell zb-corner', text: '🏠' }));
    for (let h = 0; h < p.n; h++) grid.append(el('div', { class: 'zb-hcell', text: String(h + 1), 'aria-label': t('houseN', { k: h + 1 }) }));
    cells = [];
    for (let c = 0; c < p.k; c++) {
      const cat = CATEGORIES[c];
      grid.append(el('div', { class: `zb-rlabel zb-c${c}` }, el('span', { class: 'e', text: cat.emoji }), el('span', { class: 'l', text: t(catKey(c)) })));
      for (let h = 0; h < p.n; h++) {
        const cell = el('button', { class: 'zb-cell empty', type: 'button', role: 'gridcell' });
        attachCell(cell, h, c);
        (cells[h] ??= [])[c] = cell;
        grid.append(cell);
      }
    }
    grid.addEventListener('contextmenu', (e) => e.preventDefault());
    const gridWrap = el('div', { class: 'zb-grid-wrap' }, grid);

    // Controls
    const controls = el(
      'div',
      { class: 'zb-controls' },
      actionButton(t('hintBtn'), '💡', 'secondary', () => giveHint()),
      actionButton(t('check'), '✓', 'primary', () => check()),
    );

    const side = el('div', { class: 'zb-side' }, gridWrap, controls);
    // Bar + clues form one column so that in landscape the grid side gets the full height.
    root.append(el('div', { class: 'zb-main' }, el('div', { class: 'zb-left' }, bar, list), side));
    renderAll();
    if (visible) resumeTimer();
    else updateStatus();
  }

  /**
   * Button styled like app/ui `button()` but without its built-in tap sound, for actions that play their own
   * feedback sound (so a tap never fires two sounds back to back).
   */
  function actionButton(label: string, icon: string, variant: 'primary' | 'secondary' | 'danger', onClick: () => void, disabled = false): HTMLButtonElement {
    const b = el('button', { class: `btn btn-${variant} btn-md`, type: 'button' }, icon ? el('span', { class: 'btn-icon', text: icon }) : null, el('span', { text: label }));
    b.disabled = disabled;
    b.addEventListener('click', () => {
      if (!b.disabled) onClick();
    });
    return b;
  }

  function attachCell(cell: HTMLButtonElement, h: number, c: number): void {
    const cancelPress = () => {
      clearTimeout(pressTimer);
      pressTimer = 0;
    };
    cell.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancelPress();
      suppressClick = false;
      if (finished || locked[h][c] || table[h][c] === null) return;
      pressTimer = window.setTimeout(() => {
        pressTimer = 0;
        suppressClick = true;
        clearCell(h, c);
      }, LONG_PRESS_MS);
    });
    cell.addEventListener('pointerup', cancelPress);
    cell.addEventListener('pointercancel', cancelPress);
    cell.addEventListener('pointerleave', cancelPress);
    cell.addEventListener('click', () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (finished || !puzzle) return;
      if (locked[h][c]) {
        ctx.toast(t('lockedCell'));
        ctx.haptic('light');
        return;
      }
      ctx.play('tap');
      ctx.haptic('light');
      openSheet(h, c);
    });
  }

  function renderCell(h: number, c: number, pop = false): void {
    const cell = cells[h]?.[c];
    if (!cell || !puzzle) return;
    const v = table[h][c];
    cell.innerHTML = '';
    cell.classList.toggle('empty', v === null);
    cell.classList.toggle('locked', locked[h][c]);
    cell.classList.remove('pop');
    const catName = t(catKey(c));
    if (v === null) {
      cell.setAttribute('aria-label', `${t('houseN', { k: h + 1 })} · ${catName}`);
    } else {
      const it = CATEGORIES[c].items[v];
      const label = t(itemKey(c, v));
      cell.classList.toggle('noemoji', !it.emoji);
      if (it.emoji) cell.append(el('span', { class: 'e', text: it.emoji }));
      cell.append(el('span', { class: 'l', text: label }));
      cell.setAttribute('aria-label', `${t('houseN', { k: h + 1 })} · ${catName}: ${label}`);
      if (pop) {
        // restart the animation
        void cell.offsetWidth;
        cell.classList.add('pop');
      }
    }
  }

  function renderAll(): void {
    if (!puzzle) return;
    for (let h = 0; h < puzzle.n; h++) for (let c = 0; c < puzzle.k; c++) renderCell(h, c);
    updateFilled();
  }

  function updateFilled(): void {
    if (!puzzle || !filledEl) return;
    const total = puzzle.n * puzzle.k;
    filledEl.textContent = t('filled', { a: total - countEmpty(table), b: total });
  }

  function placeItem(h: number, c: number, item: number): void {
    if (!puzzle || finished) return;
    const prev = table[h][c];
    if (prev === item) return;
    const clearedFrom = applyPlacement(table, h, c, item);
    if (clearedFrom >= 0) renderCell(clearedFrom, c);
    renderCell(h, c, true);
    updateFilled();
    persist();
    ctx.play('place');
    ctx.haptic('light');
  }

  function clearCell(h: number, c: number): void {
    if (!puzzle || finished || locked[h][c] || table[h][c] === null) return;
    table[h][c] = null;
    renderCell(h, c);
    updateFilled();
    persist();
    ctx.play('pop');
    ctx.haptic('medium');
  }

  // ── Item picker (bottom sheet) ──────────────────────────────────────
  function openSheet(h: number, c: number): void {
    if (!puzzle) return;
    closeSheet(true);
    const p = puzzle;
    const cat = CATEGORIES[c];
    const current = table[h][c];
    const options = el('div', { class: 'zb-options' });
    for (let i = 0; i < p.n; i++) {
      const it = cat.items[i];
      let elsewhere = -1;
      for (let hh = 0; hh < p.n; hh++) if (hh !== h && table[hh][c] === i) elsewhere = hh;
      const lockedElsewhere = elsewhere >= 0 && locked[elsewhere][c];
      const opt = el(
        'button',
        {
          class: 'zb-opt' + (current === i ? ' current' : '') + (elsewhere >= 0 ? ' elsewhere' : ''),
          type: 'button',
          disabled: lockedElsewhere ? 'true' : undefined,
        },
        it.emoji ? el('span', { class: 'e', text: it.emoji }) : null,
        el('span', { class: 'l', text: t(itemKey(c, i)) }),
        elsewhere >= 0 ? el('span', { class: 'w', text: `${lockedElsewhere ? '🔒' : '↩'} ${t('placedAt', { k: elsewhere + 1 })}` }) : null,
      );
      opt.addEventListener('click', () => {
        if (lockedElsewhere) return;
        placeItem(h, c, i);
        closeSheet();
      });
      options.append(opt);
    }
    const title = el(
      'div',
      { class: 'zb-sheet-title' },
      el('span', {}, el('span', { class: `zb-ref zb-c${c}`, text: `${cat.emoji} ${t(catKey(c))}` }), ' · ' + t('houseN', { k: h + 1 })),
      el('button', { class: 'zb-sheet-close', type: 'button', 'aria-label': t('close'), text: '×', onClick: () => closeSheet() }),
    );
    const actions = el(
      'div',
      { class: 'zb-sheet-actions' },
      actionButton(
        t('clearCell'),
        '',
        'danger',
        () => {
          clearCell(h, c);
          closeSheet();
        },
        current === null,
      ),
    );
    const sheet = el('div', { class: 'zb-sheet', role: 'dialog' }, title, options, actions);
    sheetBackdrop = el('div', { class: 'zb-sheet-backdrop' }, sheet);
    sheetBackdrop.addEventListener('click', (e) => {
      if (e.target === sheetBackdrop) closeSheet();
    });
    root.append(sheetBackdrop);
    requestAnimationFrame(() => sheetBackdrop?.classList.add('open'));
  }

  function closeSheet(immediate = false): void {
    const sb = sheetBackdrop;
    if (!sb) return;
    sheetBackdrop = null;
    if (immediate) {
      sb.remove();
      return;
    }
    sb.classList.remove('open');
    window.setTimeout(() => sb.remove(), 220);
  }

  // ── Hint / check / finish ───────────────────────────────────────────
  function giveHint(): void {
    if (!puzzle || finished) return;
    const pick = pickHint(table, puzzle.solution);
    if (!pick) {
      ctx.play('tap');
      ctx.toast(t('hintNone'));
      return;
    }
    const sol = solutionToTable(puzzle.solution, puzzle.n, puzzle.k);
    const item = sol[pick.house][pick.cat];
    hints++;
    const clearedFrom = applyPlacement(table, pick.house, pick.cat, item);
    locked[pick.house][pick.cat] = true;
    if (clearedFrom >= 0) renderCell(clearedFrom, pick.cat);
    renderCell(pick.house, pick.cat, true);
    updateFilled();
    updateStatus();
    persist();
    ctx.play('coin');
    ctx.haptic('medium');
    ctx.toast(t('hintRevealed', { A: t(phraseKey(pick.cat, item)), k: pick.house + 1 }), 2200);
  }

  function check(): void {
    if (!puzzle || finished) return;
    const empty = countEmpty(table);
    if (empty > 0) {
      ctx.play('error');
      ctx.haptic('light');
      ctx.toast(tn('notFilled', empty));
      return;
    }
    const wrong = countWrong(table, puzzle.solution);
    if (wrong === 0) {
      finish();
      return;
    }
    failedChecks++;
    updateStatus();
    persist();
    ctx.play('error');
    ctx.haptic('error');
    if (grid) {
      grid.classList.remove('shake');
      void grid.offsetWidth;
      grid.classList.add('shake');
    }
    ctx.toast(tn('wrong', wrong), 2200);
  }

  function finish(): void {
    if (!puzzle) return;
    finished = true;
    stopTimer();
    ctx.storage.remove(saveKey(puzzle.difficulty));
    const total = totalSec();
    const penalty = penaltySeconds(hints, failedChecks);
    updateStatus();
    for (let h = 0; h < puzzle.n; h++) for (let c = 0; c < puzzle.k; c++) cells[h][c].classList.add('solved');
    const isBest = ctx.storage.recordBest(mode, total, 'lower');
    ctx.storage.set('solved_' + mode, ctx.storage.get<number>('solved_' + mode, 0) + 1);
    ctx.play('win');
    ctx.haptic('success');
    const body = el('div', {}, el('p', { class: 'zb-result-time', text: '⏱ ' + t('solvedIn', { t: formatTime(total) }) }));
    if (penalty > 0) {
      const parts: string[] = [];
      if (hints > 0) parts.push(tn('hints', hints));
      if (failedChecks > 0) parts.push(tn('checks', failedChecks));
      body.append(el('p', { class: 'muted small', text: t('penaltyNote', { t: formatTime(penalty), parts: parts.join(' · ') }) }));
    } else {
      body.append(el('p', { class: 'muted small', text: '✨ ' + t('cleanRun') }));
    }
    if (isBest) body.append(el('p', { class: 'zb-newbest', text: '🏆 ' + t('newBest') }));
    clearTimeout(finishTimer);
    finishTimer = window.setTimeout(() => {
      ctx.showModal({
        title: t('congratulations'),
        body,
        dismissible: false,
        buttons: [
          { label: t('home'), onClick: () => ctx.exit() },
          { label: t('newPuzzle'), primary: true, onClick: () => startGame() },
        ],
      });
    }, 350);
  }

  showStart();
  return {
    destroy() {
      stopTimer();
      persist();
      clearTimeout(pressTimer);
      clearTimeout(finishTimer);
      closeSheet(true);
      setNewAction(false);
    },
  };
}

const game: GameModule = { strings, create };
export default game;
