import type { GameContext, GameInstance, GameModule } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import {
  ALL,
  BORDER_BOTTOM,
  BORDER_LEFT,
  BORDER_RIGHT,
  BORDER_TOP,
  CELLS,
  DIFFICULTIES,
  bit,
  boxOf,
  cageBorderFlags,
  cageCombos,
  cageIndex,
  cageStatus,
  colOf,
  digitCounts,
  findConflicts,
  generatePuzzle,
  hintTarget,
  isSolved,
  isValidPuzzle,
  peersOf,
  rowOf,
  wrongCells,
  type Difficulty,
  type Puzzle,
} from './logic';
import './style.css';

type Mode = Difficulty;

const HINT_PENALTY = 30;
const SAVE_KEY = 'save';
const MAX_HISTORY = 300;
const MAX_CHIPS = 9;

interface HistoryEntry {
  i: number;
  prevVal: number;
  nextVal: number;
  prevNotes: number;
  nextNotes: number;
  /** Pencil marks removed from peers when a digit was placed: [cell, previous notes]. */
  peerNotes: [number, number][];
}

interface Saved {
  v: 1;
  mode: Mode;
  puzzle: Puzzle;
  values: number[];
  notes: number[];
  /** Seconds, hint penalties included. */
  elapsed: number;
  hints: number;
  history: HistoryEntry[];
}

const strings = {
  zh: {
    rules:
      '每行、每列、每个 3×3 宫都要填入 1–9，不能重复。\n虚线框住的是“笼子”：左上角的小数字是笼内数字之和，笼内数字同样不能重复。\n点击格子选中，再点下方数字填入；“笔记”模式记录候选数，填入数字时会自动清掉同行列宫的对应笔记。\n选中格子后，棋盘下方显示该笼的目标和、剩余和与可能的数字组合。\n提示会填入一个正确数字但计时 +30 秒；检查会标出填错的格子；进度自动保存，可随时继续。\n填满整个盘面且全部正确即获胜，用时越短越好。\n简单：笼子 1–3 格并给出 12 个数字；中等：2–4 格、4 个数字；困难：2–5 格且没有任何给定数字（纯杀手数独）。',
    desc: '笼子求和 × 数独：靠加法与逻辑推理出整个盘面',
    easyDesc: '笼子 1–3 格 · 12 个提示数 · 入门',
    mediumDesc: '笼子 2–4 格 · 4 个提示数 · 需要 45 法则',
    hardDesc: '笼子 2–5 格 · 没有提示数 · 纯杀手数独',
    continueGame: '继续 · {mode} · {time}',
    newPuzzle: '新题目',
    abandonTitle: '放弃当前进度？',
    abandonBody: '未完成的题目会被删除，并开始一道新题。',
    generating: '正在生成题目…',
    notes: '笔记',
    erase: '擦除',
    check: '检查',
    progress: '进度',
    tapCell: '点击格子查看笼子信息',
    selectFirst: '先选中一个格子',
    cageInfo: '笼 {sum} · {size} 格',
    cageLeft: '剩 {sum}（{n} 格）',
    cageDone: '笼子完成 ✓',
    cageBad: '笼子有误',
    statusCage: 'Σ{sum} 余{rem}',
    hintPenalty: '已填入一格，计时 +{s} 秒',
    noHintNeeded: '盘面已经填好了',
    noErrors: '目前没有错误',
    errorsFound: '有 {n} 个格子填错了',
    fullButWrong: '盘面已填满，但还有错误',
    solvedIn: '用时 {t}',
    withPenalty: '（含 {n} 次提示 +{s} 秒）',
    solvedCount: '已解 {n} 题',
    bestTime: '最佳 {t}',
    givenCell: '这是题目给定的数字',
  },
  en: {
    rules:
      'Every row, column and 3×3 box must contain the digits 1–9 without repeats.\nDashed outlines are "cages": the small number in the top-left corner is the sum of the digits inside, and digits cannot repeat within a cage.\nTap a cell, then tap a digit below. "Notes" records pencil marks; placing a digit clears that mark from the row, column, box and cage.\nWith a cell selected, the bar under the board shows the cage target, what is left and the possible digit combinations.\nHint fills one correct cell but adds 30 s to the clock; Check marks wrong cells; progress is saved automatically so you can resume later.\nFill the whole grid correctly to win — the faster the better.\nEasy: cages of 1–3 cells plus 12 given digits. Medium: 2–4 cells, 4 givens, expect to use the 45 rule. Hard: 2–5 cells and no givens at all (pure killer).',
    desc: 'Cage sums × sudoku: deduce the whole grid from arithmetic and logic',
    easyDesc: 'Cages of 1–3 · 12 givens · gentle start',
    mediumDesc: 'Cages of 2–4 · 4 givens · needs the 45 rule',
    hardDesc: 'Cages of 2–5 · no givens · pure killer',
    continueGame: 'Continue · {mode} · {time}',
    newPuzzle: 'New puzzle',
    abandonTitle: 'Abandon current puzzle?',
    abandonBody: 'The unfinished puzzle will be deleted and a new one generated.',
    generating: 'Generating puzzle…',
    notes: 'Notes',
    erase: 'Erase',
    check: 'Check',
    progress: 'Filled',
    tapCell: 'Tap a cell to see its cage',
    selectFirst: 'Select a cell first',
    cageInfo: 'Cage {sum} · {size} cells',
    cageLeft: '{sum} left in {n}',
    cageDone: 'Cage complete ✓',
    cageBad: 'Cage broken',
    statusCage: 'Σ{sum} left {rem}',
    hintPenalty: 'One cell filled, +{s} s on the clock',
    noHintNeeded: 'The grid is already complete',
    noErrors: 'No mistakes so far',
    errorsFound: '{n} wrong cells',
    fullButWrong: 'Grid is full but has mistakes',
    solvedIn: 'Time {t}',
    withPenalty: '(incl. {n} hints, +{s} s)',
    solvedCount: '{n} solved',
    bestTime: 'Best {t}',
    givenCell: 'That digit is part of the puzzle',
  },
};

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  let mode: Mode = ctx.storage.get<Mode>('mode', 'easy');
  if (!(mode in DIFFICULTIES)) mode = 'easy';

  // ── Runtime state ─────────────────────────────────────────────────────
  let puzzle: Puzzle | null = null;
  let playMode: Mode = mode;
  let values: number[] = [];
  let notes: number[] = [];
  let history: HistoryEntry[] = [];
  let selected = -1;
  let notesMode = false;
  let elapsed = 0;
  let runningSince = 0;
  let timer = 0;
  let hints = 0;
  let finished = false;
  let inGame = false;
  let cageOf: Int16Array = new Int16Array(0);
  let flags: Uint8Array = new Uint8Array(0);
  const timeouts = new Set<number>();
  let ro: ResizeObserver | null = null;
  let removeHeader: (() => void)[] = [];

  // ── DOM refs ──────────────────────────────────────────────────────────
  let boardEl: HTMLElement | null = null;
  let boardWrap: HTMLElement | null = null;
  let cellEls: HTMLElement[] = [];
  let valEls: HTMLElement[] = [];
  let noteEls: HTMLElement[][] = [];
  let sumEls: (HTMLElement | null)[] = [];
  let digitBtns: HTMLButtonElement[] = [];
  let digitCountEls: HTMLElement[] = [];
  let padEl: HTMLElement | null = null;
  let undoBtn: HTMLButtonElement | null = null;
  let notesBtn: HTMLButtonElement | null = null;
  let hintBtn: HTMLButtonElement | null = null;
  let checkBtn: HTMLButtonElement | null = null;
  let hudTime: HTMLElement | null = null;
  let hudProgress: HTMLElement | null = null;
  let hudHints: HTMLElement | null = null;
  let helperMain: HTMLElement | null = null;
  let helperChips: HTMLElement | null = null;

  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      fn();
    }, ms);
    timeouts.add(id);
  };

  // ── Persistence ───────────────────────────────────────────────────────
  function save(): void {
    if (!puzzle || finished || !inGame) return;
    if (runningSince) {
      const now = Date.now();
      elapsed += (now - runningSince) / 1000;
      runningSince = now;
    }
    const data: Saved = { v: 1, mode: playMode, puzzle, values, notes, elapsed, hints, history: history.slice(-MAX_HISTORY) };
    ctx.storage.set(SAVE_KEY, data);
  }

  function loadSave(): Saved | null {
    const s = ctx.storage.get<Saved | null>(SAVE_KEY, null);
    if (!s || typeof s !== 'object' || s.v !== 1) return null;
    if (!(s.mode in DIFFICULTIES) || !isValidPuzzle(s.puzzle)) return null;
    if (!Array.isArray(s.values) || s.values.length !== CELLS || !Array.isArray(s.notes) || s.notes.length !== CELLS) return null;
    if (!s.values.every((v) => Number.isInteger(v) && v >= 0 && v <= 9)) return null;
    return s;
  }

  // ── Timer ─────────────────────────────────────────────────────────────
  function totalElapsed(): number {
    return elapsed + (runningSince ? (Date.now() - runningSince) / 1000 : 0);
  }
  function startTimer(): void {
    if (finished || !inGame) return;
    runningSince = Date.now();
    clearInterval(timer);
    timer = window.setInterval(tick, 1000);
    tick();
  }
  function pauseTimer(): void {
    if (runningSince) {
      elapsed += (Date.now() - runningSince) / 1000;
      runningSince = 0;
    }
    clearInterval(timer);
    timer = 0;
  }
  function statusText(time: string): string {
    let s = `${t(playMode)} · ${time}`;
    if (selected >= 0 && puzzle && !finished) {
      const st = cageStatus(values, puzzle.cages[cageOf[selected]]);
      s += ` · ${t('statusCage', { sum: st.sum, rem: st.remSum })}`;
    }
    return s;
  }
  function tick(): void {
    const txt = formatTime(totalElapsed());
    if (hudTime) hudTime.textContent = txt;
    ctx.setStatus(statusText(txt));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────
  function cleanupGame(): void {
    clearInterval(timer);
    timer = 0;
    timeouts.forEach((id) => clearTimeout(id));
    timeouts.clear();
    ro?.disconnect();
    ro = null;
    removeHeader.forEach((fn) => fn());
    removeHeader = [];
    inGame = false;
    boardEl = null;
    boardWrap = null;
    padEl = null;
    cellEls = [];
    valEls = [];
    noteEls = [];
    sumEls = [];
    digitBtns = [];
    digitCountEls = [];
    hudTime = hudProgress = hudHints = helperMain = helperChips = null;
    undoBtn = notesBtn = hintBtn = checkBtn = null;
  }

  ctx.onVisibility((visible) => {
    if (!inGame || finished) return;
    if (visible) startTimer();
    else {
      pauseTimer();
      save();
    }
  });

  const onKey = (e: KeyboardEvent): void => {
    if (!inGame || finished || !puzzle) return;
    if (e.metaKey || e.ctrlKey) {
      if (e.key === 'z') {
        undo();
        e.preventDefault();
      }
      return;
    }
    if (e.key >= '1' && e.key <= '9') {
      inputDigit(Number(e.key));
      e.preventDefault();
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      erase();
      e.preventDefault();
    } else if (e.key === 'n' || e.key === 'N') {
      toggleNotes();
    } else if (e.key === 'u' || e.key === 'U') {
      undo();
    } else if (e.key.startsWith('Arrow')) {
      const cur = selected < 0 ? 0 : selected;
      let r = rowOf(cur);
      let c = colOf(cur);
      if (e.key === 'ArrowUp') r = (r + 8) % 9;
      else if (e.key === 'ArrowDown') r = (r + 1) % 9;
      else if (e.key === 'ArrowLeft') c = (c + 8) % 9;
      else if (e.key === 'ArrowRight') c = (c + 1) % 9;
      selectCell(r * 9 + c);
      e.preventDefault();
    }
  };
  window.addEventListener('keydown', onKey);

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    if (inGame && !finished) {
      pauseTimer();
      save();
    }
    cleanupGame();
    root.innerHTML = '';
    ctx.setStatus('');
    const saved = loadSave();
    const desc = el('p', { class: 'muted ks-desc', text: t(mode + 'Desc') });
    const bestLine = el('p', { class: 'muted small' });
    const updateBest = (): void => {
      const b = ctx.storage.getBest(mode);
      const solved = ctx.storage.get<Record<string, number>>('solved', {})[mode] ?? 0;
      const parts: string[] = [];
      if (b !== null) parts.push('🏆 ' + t('bestTime', { t: formatTime(b) }));
      parts.push(t('solvedCount', { n: solved }));
      bestLine.textContent = parts.join(' · ');
    };
    updateBest();
    const actions = el('div', { class: 'ks-start-actions' });
    if (saved) {
      actions.append(
        button(t('continueGame', { mode: t(saved.mode), time: formatTime(saved.elapsed) }), () => resumeGame(saved), { variant: 'primary', size: 'lg' }),
        button(t('newPuzzle'), () => confirmNew(), { variant: 'secondary', size: 'lg' }),
      );
    } else {
      actions.append(button(t('play'), () => startNew(), { variant: 'primary', size: 'lg' }));
    }
    root.append(
      el(
        'div',
        { class: 'start-screen' },
        el('div', { class: 'big-icon', text: '🧮' }),
        el('h2', { text: t('chooseDifficulty') }),
        el('p', { class: 'muted small ks-desc', text: t('desc') }),
        segmented<Mode>(
          [
            { value: 'easy', label: t('easy') },
            { value: 'medium', label: t('medium') },
            { value: 'hard', label: t('hard') },
          ],
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
        actions,
      ),
    );
  }

  function confirmNew(): void {
    ctx.showModal({
      title: t('abandonTitle'),
      body: t('abandonBody'),
      buttons: [{ label: t('cancel') }, { label: t('confirm'), primary: true, onClick: () => startNew() }],
    });
  }

  function startNew(): void {
    cleanupGame();
    root.innerHTML = '';
    ctx.setStatus('');
    ctx.storage.remove(SAVE_KEY);
    root.append(el('div', { class: 'overlay ks-gen' }, el('div', { class: 'ks-gen-icon', text: '🧮' }), el('p', { class: 'muted', text: t('generating') })));
    const m = mode;
    later(() => {
      const { puzzle: p } = generatePuzzle(m);
      initState(p, m);
      buildGame();
      save();
    }, 60);
  }

  function initState(p: Puzzle, m: Mode): void {
    puzzle = p;
    playMode = m;
    values = p.givens.slice();
    notes = new Array<number>(CELLS).fill(0);
    history = [];
    selected = -1;
    notesMode = false;
    elapsed = 0;
    runningSince = 0;
    hints = 0;
    finished = false;
    cageOf = cageIndex(p.cages);
    flags = cageBorderFlags(p.cages);
  }

  function resumeGame(saved: Saved): void {
    cleanupGame();
    initState(saved.puzzle, saved.mode);
    values = saved.values.slice();
    notes = saved.notes.map((n) => (Number.isInteger(n) ? n & ALL : 0));
    const okEntry = (h: HistoryEntry): boolean =>
      !!h && Number.isInteger(h.i) && h.i >= 0 && h.i < CELLS && Number.isInteger(h.prevVal) && Number.isInteger(h.prevNotes) && Array.isArray(h.peerNotes);
    history = Array.isArray(saved.history) ? saved.history.filter(okEntry).slice(-MAX_HISTORY) : [];
    elapsed = Number.isFinite(saved.elapsed) ? saved.elapsed : 0;
    hints = Number.isFinite(saved.hints) ? saved.hints : 0;
    buildGame();
  }

  // ── Game screen ───────────────────────────────────────────────────────
  function stat(label: string, value: HTMLElement): HTMLElement {
    return el('div', { class: 'ks-stat' }, el('div', { class: 'ks-stat-label', text: label }), value);
  }

  function tool(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    return el('button', { class: 'ks-tool', type: 'button', 'aria-label': label, onClick }, el('span', { class: 'ks-tool-icon', text: icon }), el('span', { text: label }));
  }

  function buildGame(): void {
    if (!puzzle) return;
    root.innerHTML = '';
    inGame = true;
    const game = el('div', { class: 'ks-game' });

    hudTime = el('div', { class: 'ks-stat-value', text: formatTime(elapsed) });
    hudProgress = el('div', { class: 'ks-stat-value', text: '0/81' });
    hudHints = el('div', { class: 'ks-stat-value', text: '0' });
    const hud = el('div', { class: 'ks-hud' }, stat(t('time'), hudTime), stat(t('progress'), hudProgress), stat(t('hint'), hudHints));

    boardWrap = el('div', { class: 'ks-board-wrap' });
    boardEl = el('div', { class: 'ks-board', role: 'grid' });
    cellEls = [];
    valEls = [];
    noteEls = [];
    sumEls = [];
    const labelCell = new Map<number, number>();
    puzzle.cages.forEach((cg) => labelCell.set(cg.cells[0], cg.sum));
    for (let i = 0; i < CELLS; i++) {
      const r = rowOf(i);
      const c = colOf(i);
      const f = flags[i];
      const cls = ['ks-cell'];
      if (c % 3 === 2 && c < 8) cls.push('ks-br');
      if (r % 3 === 2 && r < 8) cls.push('ks-bb');
      if (f & BORDER_TOP) cls.push('ks-ct');
      if (f & BORDER_RIGHT) cls.push('ks-cr');
      if (f & BORDER_BOTTOM) cls.push('ks-cb');
      if (f & BORDER_LEFT) cls.push('ks-cl');
      const val = el('div', { class: 'ks-val' });
      const notesGrid = el('div', { class: 'ks-notes' });
      const ns: HTMLElement[] = [];
      for (let d = 1; d <= 9; d++) {
        const n = el('span', { class: 'ks-note', text: String(d) });
        ns.push(n);
        notesGrid.append(n);
      }
      const cell = el('div', { class: cls.join(' '), dataset: { i: String(i) }, role: 'gridcell' }, el('div', { class: 'ks-cage' }), val, notesGrid);
      const sum = labelCell.get(i);
      if (sum !== undefined) {
        const label = el('div', { class: 'ks-sum', text: String(sum) });
        cell.append(label);
        sumEls.push(label);
      } else {
        sumEls.push(null);
      }
      cellEls.push(cell);
      valEls.push(val);
      noteEls.push(ns);
      boardEl.append(cell);
    }
    boardEl.addEventListener('pointerdown', (e) => {
      const cell = (e.target as HTMLElement).closest('.ks-cell') as HTMLElement | null;
      if (!cell || cell.dataset.i === undefined) return;
      selectCell(Number(cell.dataset.i));
    });
    boardEl.addEventListener('animationend', (e) => {
      (e.target as HTMLElement).closest('.ks-cell')?.classList.remove('ks-pop');
    });
    boardWrap.append(boardEl);

    helperMain = el('div', { class: 'ks-helper-main muted', text: t('tapCell') });
    helperChips = el('div', { class: 'ks-chips' });
    const helper = el('div', { class: 'ks-helper' }, helperMain, helperChips);

    padEl = el('div', { class: 'ks-pad' });
    const digits = el('div', { class: 'ks-digits' });
    digitBtns = [];
    digitCountEls = [];
    for (let d = 1; d <= 9; d++) {
      const cnt = el('span', { class: 'ks-key-c', text: '9' });
      const b = el('button', { class: 'ks-key', type: 'button', 'aria-label': String(d), onClick: () => inputDigit(d) }, el('span', { class: 'ks-key-d', text: String(d) }), cnt);
      digitBtns.push(b);
      digitCountEls.push(cnt);
      digits.append(b);
    }
    digits.append(
      el('button', { class: 'ks-key ks-erase', type: 'button', 'aria-label': t('erase'), onClick: () => erase() }, el('span', { class: 'ks-key-d', text: '⌫' }), el('span', { class: 'ks-key-c', text: t('erase') })),
    );
    undoBtn = tool('↶', t('undo'), () => undo());
    notesBtn = tool('✎', t('notes'), () => toggleNotes());
    hintBtn = tool('💡', t('hint'), () => hint());
    checkBtn = tool('✓', t('check'), () => check());
    padEl.append(digits, el('div', { class: 'ks-tools' }, undoBtn, notesBtn, hintBtn, checkBtn));

    game.append(hud, boardWrap, helper, padEl);
    root.append(game);

    removeHeader.push(ctx.addHeaderAction({ icon: '↻', label: t('newGame'), onClick: () => showStart() }));
    removeHeader.push(ctx.addHeaderAction({ icon: '↶', label: t('undo'), onClick: () => undo() }));

    ro = new ResizeObserver(() => fitBoard());
    ro.observe(boardWrap);
    fitBoard();
    renderAll();
    startTimer();
  }

  function fitBoard(): void {
    if (!boardWrap || !boardEl) return;
    const rect = boardWrap.getBoundingClientRect();
    const avail = Math.min(rect.width, rect.height) - 8;
    const size = Math.max(90, Math.floor(avail / 9) * 9);
    boardEl.style.setProperty('--ks-size', `${size}px`);
  }

  // ── Rendering ─────────────────────────────────────────────────────────
  function renderAll(): void {
    if (!puzzle || !boardEl || !padEl) return;
    const conflicts = findConflicts(values, puzzle.cages);
    const selVal = selected >= 0 ? values[selected] : 0;
    const selCage = selected >= 0 ? cageOf[selected] : -1;
    const sr = selected >= 0 ? rowOf(selected) : -1;
    const sc = selected >= 0 ? colOf(selected) : -1;
    const sb = selected >= 0 ? boxOf(selected) : -1;
    const cageOk: boolean[] = [];
    const cageBad: boolean[] = [];
    puzzle.cages.forEach((cg, k) => {
      const st = cageStatus(values, cg);
      cageOk[k] = st.complete && st.feasible;
      cageBad[k] = !st.feasible;
    });
    let filled = 0;
    for (let i = 0; i < CELLS; i++) {
      const cell = cellEls[i];
      const v = values[i];
      if (v) filled++;
      valEls[i].textContent = v ? String(v) : '';
      const cl = cell.classList;
      cl.toggle('ks-given', puzzle.givens[i] !== 0);
      if (!v || v === puzzle.solution[i]) cl.remove('ks-wrong');
      cl.toggle('ks-conflict', conflicts[i]);
      cl.toggle('ks-sel', i === selected);
      cl.toggle('ks-same', selVal !== 0 && v === selVal && i !== selected);
      cl.toggle('ks-cage-hl', selCage >= 0 && cageOf[i] === selCage && i !== selected);
      cl.toggle('ks-peer', selected >= 0 && i !== selected && cageOf[i] !== selCage && (rowOf(i) === sr || colOf(i) === sc || boxOf(i) === sb));
      const n = v ? 0 : notes[i];
      const ns = noteEls[i];
      for (let d = 1; d <= 9; d++) ns[d - 1].classList.toggle('on', (n & bit(d)) !== 0);
      const sum = sumEls[i];
      if (sum) {
        sum.classList.toggle('ks-sum-ok', cageOk[cageOf[i]]);
        sum.classList.toggle('ks-sum-bad', cageBad[cageOf[i]]);
      }
    }
    const counts = digitCounts(values);
    for (let d = 1; d <= 9; d++) {
      const left = 9 - counts[d];
      digitCountEls[d - 1].textContent = left > 0 ? String(left) : '✓';
      digitBtns[d - 1].classList.toggle('ks-done', left <= 0);
      digitBtns[d - 1].disabled = left <= 0 || finished;
    }
    padEl.classList.toggle('ks-notes-mode', notesMode);
    if (notesBtn) notesBtn.classList.toggle('active', notesMode);
    if (undoBtn) undoBtn.disabled = history.length === 0 || finished;
    if (hintBtn) hintBtn.disabled = finished;
    if (checkBtn) checkBtn.disabled = finished;
    if (hudProgress) hudProgress.textContent = `${filled}/81`;
    if (hudHints) hudHints.textContent = hints ? `${hints} · +${hints * HINT_PENALTY}s` : '0';
    renderHelper();
    tick();
  }

  function renderHelper(): void {
    if (!puzzle || !helperMain || !helperChips) return;
    helperChips.innerHTML = '';
    if (selected < 0 || finished) {
      helperMain.textContent = t('tapCell');
      helperMain.classList.add('muted');
      return;
    }
    helperMain.classList.remove('muted');
    const cage = puzzle.cages[cageOf[selected]];
    const st = cageStatus(values, cage);
    const state = st.complete ? (st.feasible ? t('cageDone') : t('cageBad')) : st.feasible ? t('cageLeft', { sum: st.remSum, n: st.remCount }) : t('cageBad');
    helperMain.textContent = `${t('cageInfo', { sum: st.sum, size: st.size })} · ${state}`;
    if (!st.complete && st.feasible) {
      const combos = cageCombos(st.remCount, st.remSum, ALL & ~st.usedMask);
      combos.slice(0, MAX_CHIPS).forEach((c) => helperChips?.append(el('span', { class: 'ks-chip', text: c.join('') })));
      if (combos.length > MAX_CHIPS) helperChips.append(el('span', { class: 'ks-chip ks-chip-more', text: `+${combos.length - MAX_CHIPS}` }));
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────
  function selectCell(i: number): void {
    if (!inGame || finished || i < 0 || i >= CELLS) return;
    if (i === selected) return;
    selected = i;
    ctx.play('tap');
    renderAll();
  }

  function pushHistory(h: HistoryEntry): void {
    history.push(h);
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  }

  function reject(msg?: string): void {
    ctx.play('error');
    ctx.haptic('error');
    if (msg) ctx.toast(msg);
  }

  function inputDigit(d: number): void {
    if (!puzzle || finished || !inGame) return;
    if (selected < 0) return reject(t('selectFirst'));
    const i = selected;
    if (puzzle.givens[i]) return reject(t('givenCell'));
    if (notesMode) {
      if (values[i]) return reject();
      const prevNotes = notes[i];
      const nextNotes = prevNotes ^ bit(d);
      pushHistory({ i, prevVal: 0, nextVal: 0, prevNotes, nextNotes, peerNotes: [] });
      notes[i] = nextNotes;
      ctx.play('tap');
      ctx.haptic('light');
      renderAll();
      save();
      return;
    }
    if (values[i] === d) return;
    placeValue(i, d, 'place');
  }

  function placeValue(i: number, d: number, sound: 'place' | 'coin'): void {
    if (!puzzle) return;
    const prevVal = values[i];
    const prevNotes = notes[i];
    const peerNotes: [number, number][] = [];
    for (const p of peersOf(i, cageOf, puzzle.cages)) {
      if (!values[p] && notes[p] & bit(d)) {
        peerNotes.push([p, notes[p]]);
        notes[p] &= ~bit(d);
      }
    }
    values[i] = d;
    notes[i] = 0;
    pushHistory({ i, prevVal, nextVal: d, prevNotes, nextNotes: 0, peerNotes });
    const cell = cellEls[i];
    cell.classList.remove('ks-pop');
    requestAnimationFrame(() => cell.classList.add('ks-pop'));
    const conflicts = findConflicts(values, puzzle.cages);
    if (conflicts[i]) {
      ctx.play('error');
      ctx.haptic('error');
    } else {
      const st = cageStatus(values, puzzle.cages[cageOf[i]]);
      if (st.complete && st.feasible) {
        ctx.play('success');
        ctx.haptic('medium');
      } else {
        ctx.play(sound);
        ctx.haptic('light');
      }
    }
    renderAll();
    save();
    checkWin();
  }

  function erase(): void {
    if (!puzzle || finished || !inGame) return;
    if (selected < 0) return reject(t('selectFirst'));
    const i = selected;
    if (puzzle.givens[i]) return reject(t('givenCell'));
    if (!values[i] && !notes[i]) return;
    pushHistory({ i, prevVal: values[i], nextVal: 0, prevNotes: notes[i], nextNotes: 0, peerNotes: [] });
    values[i] = 0;
    notes[i] = 0;
    ctx.play('pop');
    ctx.haptic('light');
    renderAll();
    save();
  }

  function undo(): void {
    if (!puzzle || finished || !inGame) return;
    const h = history.pop();
    if (!h) return;
    values[h.i] = h.prevVal;
    notes[h.i] = h.prevNotes;
    for (const [p, n] of h.peerNotes) notes[p] = n;
    selected = h.i;
    ctx.play('move');
    ctx.haptic('light');
    renderAll();
    save();
  }

  function toggleNotes(): void {
    if (!inGame || finished) return;
    notesMode = !notesMode;
    ctx.play('tap');
    ctx.haptic('light');
    renderAll();
  }

  function hint(): void {
    if (!puzzle || finished || !inGame) return;
    const target = hintTarget(values, puzzle.solution, puzzle.cages);
    if (target < 0) {
      ctx.toast(t('noHintNeeded'));
      return;
    }
    hints++;
    elapsed += HINT_PENALTY;
    selected = target;
    ctx.toast(t('hintPenalty', { s: HINT_PENALTY }));
    placeValue(target, puzzle.solution[target], 'coin');
  }

  function check(): void {
    if (!puzzle || finished || !inGame) return;
    const wrong = wrongCells(values, puzzle.solution);
    if (!wrong.length) {
      ctx.toast(t('noErrors'));
      ctx.play('success');
      ctx.haptic('success');
      return;
    }
    ctx.toast(t('errorsFound', { n: wrong.length }));
    ctx.play('error');
    ctx.haptic('error');
    const marked = wrong.map((i) => cellEls[i]);
    marked.forEach((c) => c.classList.add('ks-wrong'));
    later(() => marked.forEach((c) => c.classList.remove('ks-wrong')), 1800);
  }

  function checkWin(): void {
    if (!puzzle || finished) return;
    if (values.some((v) => !v)) return;
    if (!isSolved(values, puzzle.solution)) {
      ctx.toast(t('fullButWrong'));
      return;
    }
    finished = true;
    pauseTimer();
    const total = Math.round(totalElapsed());
    const isBest = ctx.storage.recordBest(playMode, total, 'lower');
    const solved = ctx.storage.get<Record<string, number>>('solved', {});
    solved[playMode] = (solved[playMode] ?? 0) + 1;
    ctx.storage.set('solved', solved);
    ctx.storage.remove(SAVE_KEY);
    selected = -1;
    renderAll();
    ctx.setStatus(`${t(playMode)} · ${formatTime(total)}`);
    if (boardEl) {
      boardEl.classList.add('ks-won');
      cellEls.forEach((c, i) => (c.style.animationDelay = `${(rowOf(i) + colOf(i)) * 45}ms`));
    }
    ctx.play('win');
    ctx.haptic('success');
    later(() => {
      const body = el(
        'div',
        {},
        el('p', { text: '⏱ ' + t('solvedIn', { t: formatTime(total) }) + (hints ? ' ' + t('withPenalty', { n: hints, s: hints * HINT_PENALTY }) : '') }),
        isBest ? el('p', { class: 'ks-newbest', text: '🏆 ' + t('newBest') }) : null,
        el('p', { class: 'muted small', text: `${t(playMode)} · ${t('solvedCount', { n: solved[playMode] })}` }),
      );
      ctx.showModal({
        title: t('congratulations'),
        body,
        dismissible: false,
        buttons: [
          { label: t('home'), onClick: () => ctx.exit() },
          {
            label: t('newGame'),
            primary: true,
            onClick: () => {
              mode = playMode;
              startNew();
            },
          },
        ],
      });
    }, 1100);
  }

  showStart();
  return {
    destroy() {
      if (inGame && !finished) {
        pauseTimer();
        save();
      }
      cleanupGame();
      window.removeEventListener('keydown', onKey);
    },
  };
}

const game: GameModule = { strings, create };
export default game;
