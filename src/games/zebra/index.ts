import type { GameContext, GameInstance, GameModule, Strings } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import {
  CATEGORIES,
  DIFFICULTY_LIST,
  applyPlacement,
  catKey,
  clueParts,
  contentStrings,
  countEmpty,
  countWrong,
  emptyTable,
  generatePuzzle,
  itemKey,
  pickHint,
  solutionToTable,
  type Difficulty,
  type Puzzle,
  type Table,
} from './logic';
import './style.css';

const HINT_PENALTY = 30;
const CHECK_PENALTY = 15;
const LONG_PRESS_MS = 480;

const ui = {
  zh: {
    rules:
      '一排房子，每间房在每个类别（门色、住户、宠物……）里各有唯一一项，线索决定了唯一答案。\n上方是线索列表，点一条线索可以划掉（只是你自己的记号）。\n下方表格：列是 1～N 号房（1 号在最左边），行是类别。点格子选择项目，长按清空。\n「左边」指门牌号更小；「相邻」指门牌号相差 1；「紧挨在左边」指门牌号正好小 1。\n全部填满后点「检查」：全对即获胜；有错会告诉你错了几格（不说哪几格），并罚时 15 秒。\n「提示」会揭示并锁定一个正确格子，罚时 30 秒。\n用时越短越好，每个难度分别记录最快时间。',
    desc: '根据线索推理谁住在哪、养什么、喝什么',
    easyDesc: '4 间房 · 3 个类别',
    mediumDesc: '5 间房 · 4 个类别',
    hardDesc: '5 间房 · 5 个类别 · 线索更隐晦',
    bestTime: '最快 {t}',
    solvedCount: '已解 {n} 题',
    noBest: '尚无纪录',
    cluesCount: '{n} 条线索',
    filled: '已填 {a}/{b}',
    check: '检查',
    hintBtn: '提示 +30s',
    houseN: '{k} 号房',
    pickTitle: '{k} 号房 · {c}',
    clearCell: '清空此格',
    placedAt: '已在 {k} 号',
    lockedTag: '已锁定',
    lockedCell: '这一格是提示揭示的，已锁定',
    notFilled: '还有 {n} 格没填',
    wrongCells: '错了 {n} 格 · 罚时 15 秒',
    hintRevealed: '已揭示 {k} 号房的{c} · 罚时 30 秒',
    hintNone: '所有格子都已正确',
    solvedIn: '用时 {t}',
    cleanRun: '无提示、一次通过！',
    penaltyNote: '含罚时 {t}（提示 {h} 次 · 检查失败 {c} 次）',
    newPuzzle: '再来一题',
    cluesHint: '点线索可划掉',
  },
  en: {
    rules:
      'A row of houses: each house has exactly one item of every category (door colour, resident, pet…). The clues pin down a unique answer.\nTop: the clue list. Tap a clue to strike it out (your own bookkeeping only).\nBottom: the grid. Columns are houses 1…N (house 1 is leftmost), rows are categories. Tap a cell to pick an item; long-press to clear it.\n"Left" means a smaller house number; "next to" means the numbers differ by 1; "directly left" means exactly one less.\nWhen every cell is filled, tap Check: all correct wins; otherwise you learn how many cells are wrong (not which) and take a 15 s penalty.\nHint reveals and locks one correct cell for a 30 s penalty.\nFastest time wins; the best time is kept per difficulty.',
    desc: 'Deduce who lives where, with which pet and drink',
    easyDesc: '4 houses · 3 categories',
    mediumDesc: '5 houses · 4 categories',
    hardDesc: '5 houses · 5 categories · indirect clues',
    bestTime: 'Best {t}',
    solvedCount: 'Solved {n}',
    noBest: 'No record yet',
    cluesCount: '{n} clues',
    filled: 'Filled {a}/{b}',
    check: 'Check',
    hintBtn: 'Hint +30s',
    houseN: 'House {k}',
    pickTitle: 'House {k} · {c}',
    clearCell: 'Clear cell',
    placedAt: 'in house {k}',
    lockedTag: 'locked',
    lockedCell: 'This cell was revealed by a hint and is locked',
    notFilled: '{n} cells still empty',
    wrongCells: '{n} wrong · +15 s penalty',
    hintRevealed: 'Revealed house {k} {c} · +30 s',
    hintNone: 'Every cell is already correct',
    solvedIn: 'Time {t}',
    cleanRun: 'No hints, first check — flawless!',
    penaltyNote: 'includes {t} of penalties ({h} hints · {c} failed checks)',
    newPuzzle: 'New puzzle',
    cluesHint: 'tap a clue to strike it',
  },
};

const content = contentStrings();
const strings: Strings = {
  zh: { ...content.zh, ...ui.zh },
  en: { ...content.en, ...ui.en },
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
  let penaltySec = 0;
  let elapsedBase = 0; // ms accumulated while paused
  let runningSince = 0;
  let running = false;
  let visible = true;
  let timer = 0;
  let pressTimer = 0;
  let finishTimer = 0;
  let suppressClick = false;

  // DOM refs for the game screen
  let cells: HTMLButtonElement[][] = [];
  let grid: HTMLElement | null = null;
  let filledEl: HTMLElement | null = null;
  let sheetBackdrop: HTMLElement | null = null;

  const removeRestart = ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: () => confirmRestart() });

  ctx.onDestroy(() => {
    removeRestart();
    stopTimer();
    clearTimeout(pressTimer);
    clearTimeout(finishTimer);
  });
  ctx.onVisibility((v) => {
    visible = v;
    if (finished) return;
    if (v) resumeTimer();
    else pauseTimer();
  });

  // ── Timer ───────────────────────────────────────────────────────────
  function elapsedSec(): number {
    const ms = elapsedBase + (running ? Date.now() - runningSince : 0);
    return Math.floor(ms / 1000);
  }
  function totalSec(): number {
    return elapsedSec() + penaltySec;
  }
  function resumeTimer(): void {
    if (running) return;
    running = true;
    runningSince = Date.now();
    clearInterval(timer);
    timer = window.setInterval(updateStatus, 1000);
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
  function updateStatus(): void {
    if (!puzzle) return;
    let s = `${t(mode)} · ${formatTime(totalSec())}`;
    if (hints > 0) s += ` · 💡${hints}`;
    ctx.setStatus(s);
  }

  // ── Start screen ────────────────────────────────────────────────────
  function showStart(): void {
    stopTimer();
    finished = true;
    puzzle = null;
    closeSheet(true);
    root.innerHTML = '';
    ctx.setStatus('');
    const bestLine = el('p', { class: 'muted zb-best' });
    const updateBest = () => {
      const b = ctx.storage.getBest(mode);
      const solved = ctx.storage.get<number>('solved_' + mode, 0);
      const parts: string[] = [];
      parts.push(b === null ? t('noBest') : '🏆 ' + t('bestTime', { t: formatTime(b) }));
      if (solved > 0) parts.push(t('solvedCount', { n: solved }));
      bestLine.textContent = parts.join(' · ');
    };
    updateBest();
    const desc = el('p', { class: 'muted', text: t(mode + 'Desc') });
    root.append(
      el(
        'div',
        { class: 'start-screen' },
        el('div', { class: 'big-icon', text: '🦓' }),
        el('p', { class: 'zb-desc', text: t('desc') }),
        el('h2', { text: t('chooseDifficulty') }),
        segmented<Difficulty>(
          DIFFICULTY_LIST.map((d) => ({ value: d, label: t(d) })),
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            desc.textContent = t(m + 'Desc');
            updateBest();
          },
        ),
        desc,
        bestLine,
        button(t('play'), () => startGame(), { variant: 'primary', size: 'lg' }),
      ),
    );
  }

  function confirmRestart(): void {
    if (finished || !puzzle || countEmpty(table) === puzzle.n * puzzle.k) {
      showStart();
      return;
    }
    ctx.showModal({
      title: t('restart'),
      body: t('quitConfirm'),
      buttons: [
        { label: t('cancel') },
        { label: t('confirm'), primary: true, onClick: () => showStart() },
      ],
    });
  }

  // ── Game screen ─────────────────────────────────────────────────────
  function startGame(): void {
    const p = generatePuzzle(mode);
    puzzle = p;
    table = emptyTable(p.n, p.k);
    locked = Array.from({ length: p.n }, () => new Array<boolean>(p.k).fill(false));
    struck = new Array<boolean>(p.clues.length).fill(false);
    hints = 0;
    failedChecks = 0;
    penaltySec = 0;
    elapsedBase = 0;
    running = false;
    finished = false;
    root.innerHTML = '';
    closeSheet(true);

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
      const row = el('button', { class: 'zb-clue', type: 'button', role: 'listitem' }, el('span', { class: 'zb-clue-num', text: String(i + 1) }), textEl);
      row.addEventListener('click', () => {
        struck[i] = !struck[i];
        row.classList.toggle('done', struck[i]);
        ctx.play('tap');
        ctx.haptic('light');
      });
      list.append(row);
    });

    // Grid: columns = houses, rows = categories
    grid = el('div', { class: 'zb-grid', role: 'grid' });
    grid.style.gridTemplateColumns = `44px repeat(${p.n}, minmax(0, 1fr))`;
    grid.style.setProperty('--zb-ch', p.k >= 5 ? '46px' : p.k === 4 ? '52px' : '58px');
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
      button(t('hintBtn'), () => giveHint(), { variant: 'secondary', icon: '💡' }),
      button(t('check'), () => check(), { variant: 'primary', icon: '✓' }),
    );

    const side = el('div', { class: 'zb-side' }, gridWrap, controls);
    root.append(bar, el('div', { class: 'zb-main' }, list, side));
    renderAll();
    if (visible) resumeTimer();
    else updateStatus();
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
    ctx.play('place');
    ctx.haptic('light');
  }

  function clearCell(h: number, c: number): void {
    if (!puzzle || finished || locked[h][c] || table[h][c] === null) return;
    table[h][c] = null;
    renderCell(h, c);
    updateFilled();
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
        elsewhere >= 0 ? el('span', { class: 'w', text: lockedElsewhere ? `🔒 ${t('placedAt', { k: elsewhere + 1 })}` : `↩ ${t('placedAt', { k: elsewhere + 1 })}` }) : null,
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
      button(
        t('clearCell'),
        () => {
          clearCell(h, c);
          closeSheet();
        },
        { variant: 'danger', disabled: current === null },
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
      ctx.toast(t('hintNone'));
      return;
    }
    const sol = solutionToTable(puzzle.solution, puzzle.n, puzzle.k);
    const item = sol[pick.house][pick.cat];
    hints++;
    penaltySec += HINT_PENALTY;
    const clearedFrom = applyPlacement(table, pick.house, pick.cat, item);
    locked[pick.house][pick.cat] = true;
    if (clearedFrom >= 0) renderCell(clearedFrom, pick.cat);
    renderCell(pick.house, pick.cat, true);
    updateFilled();
    updateStatus();
    ctx.play('coin');
    ctx.haptic('medium');
    ctx.toast(t('hintRevealed', { k: pick.house + 1, c: t(catKey(pick.cat)) }));
  }

  function check(): void {
    if (!puzzle || finished) return;
    const empty = countEmpty(table);
    if (empty > 0) {
      ctx.play('error');
      ctx.toast(t('notFilled', { n: empty }));
      return;
    }
    const wrong = countWrong(table, puzzle.solution);
    if (wrong === 0) {
      finish();
      return;
    }
    failedChecks++;
    penaltySec += CHECK_PENALTY;
    updateStatus();
    ctx.play('error');
    ctx.haptic('error');
    if (grid) {
      grid.classList.remove('shake');
      void grid.offsetWidth;
      grid.classList.add('shake');
    }
    ctx.toast(t('wrongCells', { n: wrong }), 2200);
  }

  function finish(): void {
    if (!puzzle) return;
    finished = true;
    stopTimer();
    const total = totalSec();
    updateStatus();
    for (let h = 0; h < puzzle.n; h++) for (let c = 0; c < puzzle.k; c++) cells[h][c].classList.add('solved');
    const isBest = ctx.storage.recordBest(mode, total, 'lower');
    ctx.storage.set('solved_' + mode, ctx.storage.get<number>('solved_' + mode, 0) + 1);
    ctx.play('win');
    ctx.haptic('success');
    const body = el('div', {}, el('p', { class: 'zb-result-time', text: '⏱ ' + t('solvedIn', { t: formatTime(total) }) }));
    if (penaltySec > 0) body.append(el('p', { class: 'muted small', text: t('penaltyNote', { t: formatTime(penaltySec), h: hints, c: failedChecks }) }));
    else body.append(el('p', { class: 'muted small', text: '✨ ' + t('cleanRun') }));
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
      clearTimeout(pressTimer);
      clearTimeout(finishTimer);
      closeSheet(true);
    },
  };
}

const game: GameModule = { strings, create };
export default game;
