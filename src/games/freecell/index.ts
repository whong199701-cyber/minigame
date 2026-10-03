import type { GameContext, GameInstance, GameModule, ModalHandle } from '../../app/types';
import { el, button, segmented, toggle, formatTime } from '../../app/ui';
import { createCanvas, roundRect, type CanvasHandle } from '../../app/canvas';
import {
  CASCADES,
  CELL0,
  EMPTY,
  FOUND0,
  RANK_LABELS,
  SUIT_GLYPHS,
  Solver,
  applyMoveInPlace,
  autoplayInPlace,
  cardLabel,
  checkMove,
  cloneState,
  decodeMove,
  encodeMove,
  finishMoves,
  fitsOn,
  flightPlan,
  hasAnyMove,
  initialState,
  isAbandonLoss,
  isCascadeLoc,
  isCellLoc,
  isFoundLoc,
  isRed,
  isTriviallySolvable,
  isValidDeal,
  isWon,
  makeCard,
  maxMoveSize,
  movingCard,
  parseDealNumber,
  randomDeal,
  rankOf,
  replay,
  runLength,
  smartMove,
  suitOf,
  type Move,
  type MoveCheck,
  type State,
} from './logic';
import './style.css';

// ── Configuration ────────────────────────────────────────────────────────

type Mode = 'classic' | 'hard' | 'expert';
const MODES: Mode[] = ['classic', 'hard', 'expert'];
const MODE_CELLS: Record<Mode, number> = { classic: 4, hard: 3, expert: 2 };
const MODE_KEY: Record<Mode, string> = { classic: 'modeClassic', hard: 'modeHard', expert: 'modeExpert' };
/** Foundation slots left → right: ♠ ♥ ♣ ♦ (alternating colours). */
const FOUND_ORDER = [3, 2, 0, 1];
const HINT_PENALTY = 15;
const VERIFY_EXPANSIONS = 24000;
const MANUAL_VERIFY_EXPANSIONS = 60000;
const HINT_EXPANSIONS = 40000;
const MAX_VERIFY_TRIES = 40;
const DRAG_THRESHOLD = 7;

interface Saved {
  v: 1;
  mode: Mode;
  deal: number;
  groups: number[][];
  elapsed: number;
  hints: number;
  counted: boolean;
}

interface ModeStats {
  played: number;
  wins: number;
  streak: number;
  bestStreak: number;
}

/** Everything the win modal shows, captured at the moment of the win (not read back later). */
interface WinInfo {
  deal: number;
  mode: Mode;
  secs: number;
  moves: number;
  hints: number;
  st: ModeStats;
  bestT: boolean;
  bestM: boolean;
}

const strings = {
  zh: {
    rules:
      '目标：把 52 张牌按花色从 A 到 K 收进右上角的四个收牌区。\n牌列中按点数递减、红黑相间接牌（红 7 接黑 8），空列可放任何牌；左上角每个空当暂存 1 张。\n空间够时可整段移动顺序牌：最多 (空当数+1)×2^空列数 张，移入空列时空列数减 1。\n点选一张牌（连同下方顺序牌），再点目标即可移动；再点一次（双击）智能移动。也可以拖动。\n安全的牌自动收走；撤销不限次数；提示给出求解器的下一步（+15 秒）。\n经典 4 空当，微软 1–32000 号牌局（跳过无解的 #11982）；困难 3 个、专家 2 个空当，每局都验证可解。\n用时越短、步数越少越好，各模式分别记录最佳与连胜。',
    desc: '经典单人纸牌：用空当腾挪，把整副牌按花色收齐。',
    modeClassic: '经典',
    modeHard: '困难',
    modeExpert: '专家',
    modeClassicDesc: '4 个空当 · 微软经典 32000 局',
    modeHardDesc: '3 个空当 · 每局经求解器验证可解',
    modeExpertDesc: '2 个空当 · 每局经求解器验证可解',
    statBestTime: '最快',
    statFewest: '最少步',
    statWins: '胜 / 局',
    statStreak: '连胜',
    newDeal: '新牌局',
    continueGame: '继续 #{deal}',
    continueSub: '{mode} · {time} · {moves} 步',
    dealPlaceholder: '牌局号 1–32000',
    playDeal: '指定牌局',
    oneTap: '单击直接智能移动',
    deal: '牌局',
    maxMove: '可移',
    hintBtn: '提示',
    restartDeal: '重新开始本局',
    restartConfirm: '把牌局 #{deal} 恢复到开局状态？计时和步数会清零。',
    abandonNote: '当前牌局尚未完成，开始新牌局会记为一次失败。',
    abandonConfirm: '放弃当前牌局？未完成的牌局会记为一次失败。',
    dealGo: '发牌',
    newDealPrompt: '留空则随机发牌，或输入 1–32000 的牌局号。',
    invalidDeal: '请输入 1–32000 之间的牌局号',
    unsolvableDeal: '#11982 是著名的无解牌局，换一局吧',
    verifying: '正在发牌并用求解器验证…',
    verifyingManual: '正在验证牌局 #{deal} 能否在 {n} 个空当下解开…',
    unsolvableTitle: '此局无解',
    unsolvableBody: '求解器穷举证明：牌局 #{deal} 在 {n} 个空当下无解。换一局，或在经典模式下挑战它。',
    unverifiedTitle: '无法确认可解',
    unverifiedBody: '求解器没能证明牌局 #{deal} 在 {n} 个空当下有解，它可能根本无解。仍要开始吗？',
    playAnyway: '仍然开始',
    verifyFailed: '暂时没找到合适的牌局，请再试一次',
    thinking: '思考中…',
    hintMove: '💡 {card} → {dest} +{n}s',
    destFoundation: '收牌区',
    destCell: '空当',
    destEmpty: '空列',
    hintNone: '没能快速找到解法，试试撤销',
    hintUnwinnable: '当前局面已经无解了，请撤销几步。',
    tooMany: '空位不足，最多移动 {n} 张',
    notSequence: '只能拿起末尾的顺序牌',
    nothingToUndo: '没有可撤销的步骤',
    noMovesTitle: '无路可走',
    noMovesBody: '已经没有可以移动的牌了。撤销几步，或重新开始本局。',
    winBody: '牌局 #{deal} · {mode} 完成！',
    hintsUsed: '使用提示 {n} 次（已计入用时）',
    bestLabel: '最佳 {v}',
    winsLabel: '胜场',
    streakLabel: '连胜 {n}',
    lockedCell: '本模式不可用',
    replayDeal: '重玩本局',
  },
  en: {
    rules:
      'Goal: move all 52 cards to the four foundations (top right), each suit from A up to K.\nCascades build down in alternating colours (red 7 on black 8); any card can fill an empty cascade. Each free cell (top left) holds one card.\nRuns move at once if there is room: up to (free cells + 1) × 2^(empty cascades), one cascade fewer when moving into an empty one.\nTap a card to select it with the run below it, then tap a destination. Tap it again (double-tap) for a smart move. Dragging works too.\nSafe cards auto-play to the foundations. Undo is unlimited; a hint shows the solver\'s next move (+15 s).\nClassic: 4 free cells, Microsoft deals 1–32000 (unsolvable #11982 skipped). Hard: 3 cells, Expert: 2 — every deal verified solvable.\nWin fast in few moves; each mode keeps its own records and streak.',
    desc: 'The classic solitaire: juggle free cells to build every suit home.',
    modeClassic: 'Classic',
    modeHard: 'Hard',
    modeExpert: 'Expert',
    modeClassicDesc: '4 free cells · the classic 32,000 Microsoft deals',
    modeHardDesc: '3 free cells · every deal verified solvable',
    modeExpertDesc: '2 free cells · every deal verified solvable',
    statBestTime: 'Fastest',
    statFewest: 'Fewest',
    statWins: 'Won / played',
    statStreak: 'Streak',
    newDeal: 'New deal',
    continueGame: 'Continue #{deal}',
    continueSub: '{mode} · {time} · {moves} moves',
    dealPlaceholder: 'Deal # 1–32000',
    playDeal: 'Play deal',
    oneTap: 'Single tap makes a smart move',
    deal: 'Deal',
    maxMove: 'Max run',
    hintBtn: 'Hint',
    restartDeal: 'Restart deal',
    restartConfirm: 'Reset deal #{deal} to the start? Time and moves start over.',
    abandonNote: 'This deal is unfinished — starting a new one counts as a loss.',
    abandonConfirm: 'Abandon the current deal? An unfinished deal counts as a loss.',
    dealGo: 'Deal',
    newDealPrompt: 'Leave empty for a random deal, or enter a deal number 1–32000.',
    invalidDeal: 'Enter a deal number between 1 and 32000',
    unsolvableDeal: '#11982 is the famous unsolvable deal — pick another',
    verifying: 'Dealing and verifying with the solver…',
    verifyingManual: 'Checking that deal #{deal} is solvable with {n} free cells…',
    unsolvableTitle: 'No solution',
    unsolvableBody: 'An exhaustive search proves deal #{deal} cannot be won with {n} free cells. Pick another, or play it in Classic.',
    unverifiedTitle: 'Not verified',
    unverifiedBody: 'The solver could not prove deal #{deal} is solvable with {n} free cells — it may have no solution. Play it anyway?',
    playAnyway: 'Play anyway',
    verifyFailed: 'Could not find a suitable deal, please try again',
    thinking: 'Thinking…',
    hintMove: '💡 {card} → {dest} +{n}s',
    destFoundation: 'foundation',
    destCell: 'free cell',
    destEmpty: 'empty cascade',
    hintNone: 'No quick solution — try undoing',
    hintUnwinnable: 'This position can no longer be won — undo a few moves.',
    tooMany: 'Not enough space: max {n} cards',
    notSequence: 'Only ordered runs can move',
    nothingToUndo: 'Nothing to undo',
    noMovesTitle: 'No moves left',
    noMovesBody: 'No card can move any more. Undo a few moves or restart this deal.',
    winBody: 'Deal #{deal} · {mode} solved!',
    hintsUsed: '{n} hint(s) used (included in the time)',
    bestLabel: 'Best {v}',
    winsLabel: 'Wins',
    streakLabel: 'Streak {n}',
    lockedCell: 'Not available in this mode',
    replayDeal: 'Replay',
  },
};

// ── Small helpers ────────────────────────────────────────────────────────

interface Anim {
  fx: number;
  fy: number;
  t0: number;
  dur: number;
}

interface CardView {
  card: number;
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  a: Anim | null;
}

interface Geo {
  W: number;
  H: number;
  cw: number;
  ch: number;
  gap: number;
  left: number;
  topY: number;
  casY: number;
  rowGap: number;
  bottomPad: number;
  ideal: number;
  minOv: number;
}

type Hit =
  | { kind: 'cascade'; col: number; idx: number }
  | { kind: 'cell'; i: number }
  | { kind: 'found'; slot: number }
  | { kind: 'none' };

interface Src {
  from: number;
  n: number;
}

interface Job {
  cancel(): void;
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function exactKey(s: State): string {
  return s.cascades.map((c) => c.join(',')).join('|') + '/' + s.cells.join(',') + '/' + s.found.join(',');
}

function isMode(x: unknown): x is Mode {
  return x === 'classic' || x === 'hard' || x === 'expert';
}

// ── Game ─────────────────────────────────────────────────────────────────

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  const storedMode = ctx.storage.get<string>('mode', 'classic');
  let mode: Mode = isMode(storedMode) ? storedMode : 'classic';
  let oneTap = ctx.storage.get<boolean>('oneTap', false) === true;
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Game state
  let gameMode: Mode = mode;
  let deal = 1;
  let initial: State = initialState(1, 4);
  let state: State = initial;
  let snapshots: State[] = [];
  let groups: Move[][] = [];
  let hints = 0;
  let counted = false;
  let playing = false;
  let finished = false;
  let destroyed = false;
  let visible = true;

  // Timer
  let elapsedBase = 0;
  let runStart = 0;
  let lastShownSec = -1;
  let lastSaveAt = 0;
  const tickId = window.setInterval(tick, 250);

  // UI
  let board: HTMLDivElement | null = null;
  let spacer: HTMLDivElement | null = null;
  let hudDeal: HTMLElement | null = null;
  let hudMoves: HTMLElement | null = null;
  let hudTime: HTMLElement | null = null;
  let hudCap: HTMLElement | null = null;
  let hintBtn: HTMLButtonElement | null = null;
  let views: CardView[] = [];
  let cellSlots: HTMLDivElement[] = [];
  let foundSlots: HTMLDivElement[] = [];
  let colSlots: HTMLDivElement[] = [];
  let geo: Geo | null = null;
  let colOv: number[] = new Array<number>(CASCADES).fill(20);
  let ro: ResizeObserver | null = null;
  let raf = 0;
  let sel: Src | null = null;
  let marked: Element[] = [];
  let hoverEl: Element | null = null;
  let headerOffs: (() => void)[] = [];
  let job: Job | null = null;
  let hintJob: Job | null = null;
  let busyOverlay: HTMLElement | null = null;
  let hintCache: { keys: string[]; moves: Move[] } | null = null;
  let win: { cv: CanvasHandle; layer: HTMLElement; raf: number } | null = null;
  let timeouts: number[] = [];
  let modal: ModalHandle | null = null;
  let edgeRaf = 0;
  let press: {
    id: number;
    x0: number;
    y0: number;
    /** Viewport coordinates of the press and of the latest move (scrolling changes local ones). */
    cx0: number;
    cy0: number;
    cx: number;
    cy: number;
    scroll0: number;
    hit: Hit;
    src: Src | null;
    dragging: boolean;
    panning: boolean;
    offX: number;
    offY: number;
    cards: CardView[];
    step: number;
  } | null = null;

  /**
   * Game "epoch": bumped whenever the board is rebuilt or the deal restarts. Delayed effects that belong to
   * a particular game (the win celebration and modal, the dead-end modal, auto-play sounds) are scheduled
   * with `later` and silently dropped once the epoch has moved on, so they can never leak into the next game.
   */
  let epoch = 0;
  const later = (fn: () => void, ms: number, scoped = true): void => {
    const e = epoch;
    const id = window.setTimeout(() => {
      timeouts = timeouts.filter((x) => x !== id);
      if (destroyed || (scoped && e !== epoch)) return;
      fn();
    }, ms);
    timeouts.push(id);
  };
  function newEpoch(): void {
    epoch++;
  }

  // ── Storage ───────────────────────────────────────────────────────────

  function loadStats(): Record<Mode, ModeStats> {
    const raw = ctx.storage.get<Partial<Record<Mode, Partial<ModeStats>>>>('stats', {});
    const out = {} as Record<Mode, ModeStats>;
    for (const m of MODES) {
      const r = raw && typeof raw === 'object' ? raw[m] ?? {} : {};
      out[m] = {
        played: Number(r.played) || 0,
        wins: Number(r.wins) || 0,
        streak: Number(r.streak) || 0,
        bestStreak: Number(r.bestStreak) || 0,
      };
    }
    return out;
  }

  function updateStats(m: Mode, fn: (s: ModeStats) => void): ModeStats {
    const all = loadStats();
    fn(all[m]);
    ctx.storage.set('stats', all);
    return all[m];
  }

  function loadSaved(): { saved: Saved; states: State[]; groups: Move[][] } | null {
    const s = ctx.storage.get<Saved | null>('saved', null);
    if (!s || s.v !== 1 || !isMode(s.mode) || !isValidDeal(s.deal) || !Array.isArray(s.groups)) return null;
    try {
      const gs = s.groups.map((g) => (Array.isArray(g) ? g.map((x) => decodeMove(Number(x))) : []));
      const states = replay(s.deal, MODE_CELLS[s.mode], gs);
      if (!states) return null;
      return { saved: s, states, groups: gs };
    } catch {
      return null;
    }
  }

  function save(): void {
    if (!playing || finished) return;
    lastSaveAt = performance.now();
    const data: Saved = {
      v: 1,
      mode: gameMode,
      deal,
      groups: groups.map((g) => g.map(encodeMove)),
      elapsed: Math.floor(elapsedSec()),
      hints,
      counted,
    };
    ctx.storage.set('saved', data);
  }

  /** Record a loss for an unfinished saved deal that the player is abandoning. */
  function abandonSaved(): void {
    const s = ctx.storage.get<Saved | null>('saved', null);
    if (s && isMode(s.mode) && isAbandonLoss(s)) {
      updateStats(s.mode, (st) => {
        st.streak = 0;
      });
    }
    ctx.storage.remove('saved');
  }

  /** True when leaving the current/saved deal would cost the streak (it was played, even if restarted). */
  function hasUnfinished(): boolean {
    if (playing && !finished) return isAbandonLoss({ counted });
    const s = ctx.storage.get<Saved | null>('saved', null);
    return !!s && isMode(s.mode) && isAbandonLoss(s);
  }

  // ── Timer ─────────────────────────────────────────────────────────────

  function elapsedSec(): number {
    return elapsedBase + (runStart ? (performance.now() - runStart) / 1000 : 0);
  }
  function pauseTimer(): void {
    if (runStart) {
      elapsedBase += (performance.now() - runStart) / 1000;
      runStart = 0;
    }
  }
  function resumeTimer(): void {
    if (!runStart && playing && !finished && visible) runStart = performance.now();
  }
  function tick(): void {
    if (!playing || !hudTime) return;
    const sec = Math.floor(elapsedSec());
    if (sec !== lastShownSec) {
      lastShownSec = sec;
      hudTime.textContent = formatTime(sec);
    }
    if (!finished && performance.now() - lastSaveAt > 10000) save();
  }

  // ── Header ────────────────────────────────────────────────────────────

  function addHeader(): void {
    removeHeader();
    headerOffs = [
      ctx.addHeaderAction({ icon: '↶', label: t('undo'), onClick: () => undo() }),
      ctx.addHeaderAction({ icon: '↻', label: t('restartDeal'), onClick: () => askRestart() }),
      ctx.addHeaderAction({ icon: '🎲', label: t('newDeal'), onClick: () => openNewDealModal() }),
    ];
  }
  function removeHeader(): void {
    headerOffs.forEach((off) => off());
    headerOffs = [];
  }

  // ── Start screen ──────────────────────────────────────────────────────

  function showStart(): void {
    teardownBoard();
    playing = false;
    removeHeader();
    root.innerHTML = '';
    ctx.setStatus('');
    const restored = loadSaved();
    if (!restored) ctx.storage.remove('saved');

    const modeDesc = el('p', { class: 'muted fc-mode-desc' });
    const statsBox = el('div', { class: 'fc-stats' });
    const refresh = () => {
      modeDesc.textContent = t(MODE_KEY[mode] + 'Desc');
      const st = loadStats()[mode];
      const bt = ctx.storage.getBest(mode);
      const bm = ctx.storage.getBest(mode + '-moves');
      statsBox.innerHTML = '';
      const tile = (v: string, l: string) => el('div', { class: 'fc-stat' }, el('div', { class: 'fc-stat-v', text: v }), el('div', { class: 'fc-stat-l', text: l }));
      statsBox.append(
        tile(bt === null ? '—' : formatTime(bt), t('statBestTime')),
        tile(bm === null ? '—' : String(bm), t('statFewest')),
        tile(`${st.wins}/${st.played}`, t('statWins')),
        tile(st.bestStreak > st.streak ? `${st.streak} · ${st.bestStreak}` : String(st.streak), t('statStreak')),
      );
    };
    refresh();

    const actions = el('div', { class: 'fc-actions' });
    if (restored) {
      const s = restored.saved;
      const contBtn = button(
        t('continueGame', { deal: s.deal }),
        () => continueSaved(),
        { variant: 'primary', size: 'lg' },
      );
      contBtn.append(
        el('span', {
          class: 'fc-continue-sub',
          text: t('continueSub', { mode: t(MODE_KEY[s.mode]), time: formatTime(s.elapsed), moves: restored.groups.length }),
        }),
      );
      actions.append(contBtn);
    }
    actions.append(
      button(t('newDeal'), () => confirmAbandon(() => startDeal(mode, null)), {
        variant: restored ? 'secondary' : 'primary',
        size: 'lg',
      }),
    );

    const input = el('input', {
      class: 'fc-input',
      type: 'text',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      maxlength: '5',
      placeholder: t('dealPlaceholder'),
      'aria-label': t('dealPlaceholder'),
      enterkeyhint: 'go',
    }) as HTMLInputElement;
    const playTyped = () => {
      const r = parseDealNumber(input.value);
      if (!r.ok) {
        ctx.toast(dealError(r.reason));
        ctx.play('error');
        ctx.haptic('error');
        shakeInput(input);
        return;
      }
      confirmAbandon(() => startDeal(mode, r.deal));
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
        playTyped();
      }
    });
    const dealRow = el('div', { class: 'fc-dealrow' }, input, button(t('playDeal'), playTyped, { variant: 'secondary' }));

    const tg = toggle(t('oneTap'), oneTap, (v) => {
      oneTap = v;
      ctx.storage.set('oneTap', v);
    });
    tg.classList.add('fc-toggle');

    root.append(
      el(
        'div',
        { class: 'start-screen fc-start' },
        el('div', { class: 'big-icon', text: '🃏' }),
        el('p', { class: 'muted fc-desc', text: t('desc') }),
        segmented<Mode>(
          MODES.map((m) => ({ value: m, label: t(MODE_KEY[m]) })),
          mode,
          (m) => {
            mode = m;
            ctx.storage.set('mode', m);
            refresh();
          },
        ),
        modeDesc,
        statsBox,
        actions,
        dealRow,
        tg,
      ),
    );
  }

  function dealError(reason: 'invalid' | 'unsolvable'): string {
    return t(reason === 'unsolvable' ? 'unsolvableDeal' : 'invalidDeal');
  }

  function shakeInput(input: HTMLInputElement): void {
    input.classList.remove('fc-input-bad');
    void input.offsetWidth;
    input.classList.add('fc-input-bad');
  }

  function confirmAbandon(go: () => void): void {
    if (!hasUnfinished()) {
      go();
      return;
    }
    modal = ctx.showModal({
      title: t('newDeal'),
      body: t('abandonConfirm'),
      buttons: [{ label: t('cancel') }, { label: t('confirm'), primary: true, onClick: go }],
    });
  }

  function continueSaved(): void {
    const r = loadSaved();
    if (!r) {
      ctx.storage.remove('saved');
      showStart();
      return;
    }
    const s = r.saved;
    gameMode = s.mode;
    deal = s.deal;
    initial = r.states[0];
    state = r.states[r.states.length - 1];
    snapshots = r.states.slice(0, -1);
    groups = r.groups;
    elapsedBase = Math.max(0, Number(s.elapsed) || 0);
    hints = Math.max(0, Number(s.hints) || 0);
    counted = !!s.counted;
    hintCache = null;
    enterGame();
  }

  // ── Starting deals (with solver verification for reduced free cells) ──

  function startDeal(m: Mode, requested: number | null): void {
    cancelJob();
    const cells = MODE_CELLS[m];
    if (cells >= 4) {
      beginNew(m, requested ?? randomDeal(), null);
      return;
    }
    const tried: number[] = [];
    let d = requested ?? randomDeal(Math.random, tried);
    let solver = new Solver(initialState(d, cells), {
      maxExpansions: requested !== null ? MANUAL_VERIFY_EXPANSIONS : VERIFY_EXPANSIONS,
    });
    showBusy(requested !== null ? t('verifyingManual', { deal: d, n: cells }) : t('verifying'));
    job = runJob(() => {
      const st = solver.step(9);
      if (st === 'running') return true;
      if (st === 'solved') {
        hideBusy();
        beginNew(m, d, solver.solution);
        return false;
      }
      if (requested !== null && st === 'unsolvable') {
        hideBusy();
        ctx.play('error');
        modal = ctx.showModal({ title: t('unsolvableTitle'), body: t('unsolvableBody', { deal: d, n: cells }), buttons: [{ label: t('ok'), primary: true }] });
        return false;
      }
      if (requested !== null) {
        hideBusy();
        modal = ctx.showModal({
          title: t('unverifiedTitle'),
          body: t('unverifiedBody', { deal: d, n: cells }),
          buttons: [{ label: t('cancel') }, { label: t('playAnyway'), primary: true, onClick: () => beginNew(m, requested, null) }],
        });
        return false;
      }
      tried.push(d);
      if (tried.length >= MAX_VERIFY_TRIES) {
        hideBusy();
        ctx.toast(t('verifyFailed'));
        return false;
      }
      d = randomDeal(Math.random, tried);
      solver = new Solver(initialState(d, cells), { maxExpansions: VERIFY_EXPANSIONS });
      return true;
    });
  }

  function beginNew(m: Mode, d: number, solution: Move[] | null): void {
    // The live game is always persisted, so this also records the loss of an abandoned live deal.
    if (playing && !finished) save();
    abandonSaved();
    gameMode = m;
    deal = d;
    initial = initialState(d, MODE_CELLS[m]);
    state = cloneState(initial);
    snapshots = [];
    groups = [];
    elapsedBase = 0;
    hints = 0;
    counted = false;
    hintCache = null;
    if (solution && solution.length) storeHintCache(initial, solution);
    enterGame();
  }

  function enterGame(): void {
    removeWin();
    playing = true;
    finished = false;
    sel = null;
    runStart = 0;
    lastShownSec = -1;
    buildGameScreen();
    ctx.setStatus(`${t(MODE_KEY[gameMode])} · #${deal}`);
    addHeader();
    dealIn();
    resumeTimer();
    updateHud();
    save();
    ctx.play('swoosh');
  }

  // ── Board construction & layout ───────────────────────────────────────

  function buildGameScreen(): void {
    teardownBoard();
    root.innerHTML = '';
    hudDeal = el('div', { class: 'stat-value', text: '#' + deal });
    hudMoves = el('div', { class: 'stat-value', text: '0' });
    hudTime = el('div', { class: 'stat-value', text: '00:00' });
    hudCap = el('div', { class: 'stat-value', text: '5' });
    const stat = (label: string, v: HTMLElement) => el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: label }), v);
    hintBtn = button(t('hintBtn'), () => hint(), { variant: 'secondary', size: 'sm', icon: '💡', class: 'fc-hint-btn' });
    const hud = el(
      'div',
      { class: 'game-hud fc-hud' },
      stat(t('deal'), hudDeal),
      stat(t('moves'), hudMoves),
      stat(t('time'), hudTime),
      stat(t('maxMove'), hudCap),
      hintBtn,
    );
    board = el('div', { class: 'fc-board' }) as HTMLDivElement;
    spacer = el('div', { class: 'fc-spacer' }) as HTMLDivElement;
    board.append(spacer);

    const cells = MODE_CELLS[gameMode];
    cellSlots = [];
    for (let i = 0; i < 4; i++) {
      const s = el('div', { class: i < cells ? 'fc-slot fc-cell' : 'fc-slot fc-locked', text: i < cells ? '' : '🔒' }) as HTMLDivElement;
      if (i >= cells) s.title = t('lockedCell');
      cellSlots.push(s);
      board.append(s);
    }
    foundSlots = FOUND_ORDER.map((suit) => {
      const s = el('div', { class: 'fc-slot fc-found', text: SUIT_GLYPHS[suit] }) as HTMLDivElement;
      board?.append(s);
      return s;
    });
    colSlots = [];
    for (let i = 0; i < CASCADES; i++) {
      const s = el('div', { class: 'fc-slot fc-colbase' }) as HTMLDivElement;
      colSlots.push(s);
      board.append(s);
    }
    views = [];
    for (let card = 0; card < 52; card++) {
      const r = rankOf(card);
      const s = suitOf(card);
      const glyph = SUIT_GLYPHS[s];
      const inner = el(
        'div',
        { class: 'fc-in' },
        el('div', { class: 'fc-idx' }, el('span', { text: RANK_LABELS[r] }), el('span', { class: 'fc-s', text: glyph })),
        r >= 10
          ? el('div', { class: 'fc-face' }, el('span', { text: RANK_LABELS[r] }), el('span', { class: 'fc-s', text: glyph }))
          : el('div', { class: 'fc-pip', text: glyph }),
      );
      const node = el(
        'div',
        { class: `fc-card${isRed(card) ? ' fc-red' : ''}${r >= 10 ? ' fc-court' : ''}`, 'aria-label': cardLabel(card) },
        inner,
      ) as HTMLDivElement;
      board.append(node);
      views.push({ card, el: node, x: 0, y: 0, z: 0, tx: NaN, ty: NaN, tz: 0, a: null });
    }
    root.append(el('div', { class: 'fc-root-game' }, hud, board));

    board.addEventListener('pointerdown', onDown);
    board.addEventListener('pointermove', onMove);
    board.addEventListener('pointerup', onUp);
    board.addEventListener('pointercancel', onCancel);
    board.addEventListener('lostpointercapture', onLostCapture);
    board.addEventListener('contextmenu', preventDefault);

    computeGeo();
    ro = new ResizeObserver(() => {
      if (!board) return;
      const old = geo;
      computeGeo();
      if (!old || !geo || old.W !== geo.W || old.H !== geo.H) {
        cancelDrag(false);
        placeAll(false);
      }
    });
    ro.observe(board);
  }

  function preventDefault(e: Event): void {
    e.preventDefault();
  }

  function teardownBoard(): void {
    newEpoch();
    cancelDrag(false);
    stopEdgeScroll();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    ro?.disconnect();
    ro = null;
    removeWin();
    cancelHint();
    board = null;
    views = [];
    marked = [];
    hoverEl = null;
    hudTime = hudMoves = hudDeal = hudCap = null;
    hintBtn = null;
  }

  function computeGeo(): void {
    if (!board) return;
    const W = board.clientWidth;
    const H = board.clientHeight;
    if (W < 10 || H < 10) return;
    const narrow = W < 520;
    const padX = narrow ? 4 : 12;
    const gap = narrow ? 3 : Math.min(14, Math.max(5, Math.round(W * 0.012)));
    let cw = Math.min(104, (W - padX * 2 - gap * 7) / 8);
    const topPad = narrow ? 6 : 10;
    const bottomPad = 10;
    const rowGapFor = (w: number) => Math.max(8, Math.round(w * 0.2));
    // Keep two card heights plus a dozen visible overlaps on screen (landscape phones).
    const maxCh = (H - topPad - rowGapFor(cw) - bottomPad) / (2 + 11 * 0.24);
    if (cw * 1.4 > maxCh) cw = maxCh / 1.4;
    cw = Math.max(26, Math.floor(cw));
    const ch = Math.round(cw * 1.4);
    const rowGap = rowGapFor(cw);
    const left = Math.round((W - (cw * 8 + gap * 7)) / 2);
    geo = {
      W,
      H,
      cw,
      ch,
      gap,
      left,
      topY: topPad,
      casY: topPad + ch + rowGap,
      rowGap,
      bottomPad,
      ideal: Math.round(ch * 0.4),
      minOv: Math.max(9, Math.round(ch * 0.2)),
    };
    board.style.setProperty('--cw', cw + 'px');
    board.style.setProperty('--ch', ch + 'px');
    for (let i = 0; i < 4; i++) setPos(cellSlots[i], colX(i), geo.topY);
    foundSlots.forEach((s, i) => setPos(s, colX(4 + i), geo!.topY));
    colSlots.forEach((s, i) => setPos(s, colX(i), geo!.casY));
  }

  function setPos(node: HTMLElement, x: number, y: number): void {
    node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function colX(i: number): number {
    return geo ? geo.left + i * (geo.cw + geo.gap) : 0;
  }

  function updateOverlaps(): void {
    if (!geo || !board) return;
    const avail = geo.H - geo.casY - geo.bottomPad;
    let contentH = geo.H;
    for (let c = 0; c < CASCADES; c++) {
      const n = state.cascades[c].length;
      let ov = geo.ideal;
      if (n > 1 && geo.ch + (n - 1) * ov > avail) ov = Math.max(geo.minOv, Math.floor((avail - geo.ch) / (n - 1)));
      colOv[c] = ov;
      contentH = Math.max(contentH, geo.casY + geo.ch + Math.max(0, n - 1) * ov + geo.bottomPad);
    }
    const scroll = contentH > geo.H + 1;
    board.classList.toggle('fc-scrolly', scroll);
    if (spacer) spacer.style.height = (scroll ? contentH : 0) + 'px';
  }

  function cardY(col: number, idx: number): number {
    return geo ? geo.casY + idx * colOv[col] : 0;
  }

  function foundSlotOf(suit: number): number {
    return FOUND_ORDER.indexOf(suit);
  }

  function targets(): { x: number; y: number; z: number; buried?: boolean }[] {
    const out: { x: number; y: number; z: number; buried?: boolean }[] = new Array(52);
    if (!geo) return out;
    for (let c = 0; c < CASCADES; c++) {
      const col = state.cascades[c];
      for (let i = 0; i < col.length; i++) out[col[i]] = { x: colX(c), y: cardY(c, i), z: 100 + i };
    }
    state.cells.forEach((card, i) => {
      if (card !== EMPTY) out[card] = { x: colX(i), y: geo!.topY, z: 100 };
    });
    for (let suit = 0; suit < 4; suit++) {
      for (let r = 0; r < state.found[suit]; r++) {
        out[makeCard(r, suit)] = { x: colX(4 + foundSlotOf(suit)), y: geo.topY, z: 100 + r, buried: r < state.found[suit] - 2 };
      }
    }
    return out;
  }

  // ── Animation ─────────────────────────────────────────────────────────

  function applyView(v: CardView): void {
    v.el.style.transform = `translate3d(${v.x.toFixed(1)}px, ${v.y.toFixed(1)}px, 0)`;
  }
  function setZ(v: CardView, z: number): void {
    if (v.z !== z) {
      v.z = z;
      v.el.style.zIndex = String(z);
    }
  }

  /**
   * Move every card view towards its position in `state`. `delays` (ms per card) sequence auto-play flights.
   */
  function placeAll(animate: boolean, delays?: Map<number, number>, durScale = 1): void {
    if (!geo) return;
    updateOverlaps();
    const pos = targets();
    const now = performance.now();
    let any = false;
    for (const v of views) {
      const p = pos[v.card];
      if (!p) continue;
      v.el.classList.toggle('fc-buried', !!p.buried);
      const moved = p.x !== v.tx || p.y !== v.ty || p.x !== v.x || p.y !== v.y;
      v.tx = p.x;
      v.ty = p.y;
      v.tz = p.z;
      if (moved || v.a) {
        const dist = Math.hypot(p.x - v.x, p.y - v.y);
        if (animate && visible && !reducedMotion && dist > 0.5) {
          const delay = delays?.get(v.card) ?? 0;
          v.a = { fx: v.x, fy: v.y, t0: now + delay, dur: (150 + Math.min(170, dist * 0.45)) * durScale };
          setZ(v, (dist > 24 ? 1000 : 500) + p.z);
          if (dist > 24) v.el.classList.add('fc-fly');
          any = true;
        } else {
          v.a = null;
          v.x = p.x;
          v.y = p.y;
          applyView(v);
          setZ(v, p.z);
          v.el.classList.remove('fc-fly', 'fc-wait');
        }
      } else {
        setZ(v, p.z);
      }
    }
    if (any) startAnim();
  }

  function startAnim(): void {
    if (!raf && visible) raf = requestAnimationFrame(frame);
  }

  function frame(now: number): void {
    raf = 0;
    let active = false;
    for (const v of views) {
      const a = v.a;
      if (!a) continue;
      const k = (now - a.t0) / a.dur;
      if (k <= 0) {
        active = true;
        continue;
      }
      if (v.el.classList.contains('fc-wait')) v.el.classList.remove('fc-wait');
      if (k >= 1) {
        v.a = null;
        v.x = v.tx;
        v.y = v.ty;
        applyView(v);
        setZ(v, v.tz);
        v.el.classList.remove('fc-fly');
        continue;
      }
      const e = a.dur > 260 ? easeInOut(k) : easeOut(k);
      v.x = a.fx + (v.tx - a.fx) * e;
      v.y = a.fy + (v.ty - a.fy) * e;
      applyView(v);
      active = true;
    }
    if (active) raf = requestAnimationFrame(frame);
  }

  function finishAnims(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    for (const v of views) {
      v.el.classList.remove('fc-wait');
      if (!v.a) continue;
      v.a = null;
      v.x = v.tx;
      v.y = v.ty;
      applyView(v);
      setZ(v, v.tz);
      v.el.classList.remove('fc-fly');
    }
  }

  /** Cards fly from a deck at the bottom centre into their places, in deal order. */
  function dealIn(): void {
    if (!geo) return;
    const deckX = geo.W / 2 - geo.cw / 2;
    const deckY = (board?.scrollTop ?? 0) + geo.H - geo.ch - 8;
    const order = new Map<number, number>();
    let i = 0;
    for (let row = 0; row < 20; row++) {
      for (let c = 0; c < CASCADES; c++) {
        const col = state.cascades[c];
        if (row < col.length) order.set(col[row], i++);
      }
    }
    for (const card of state.cells) if (card !== EMPTY) order.set(card, i++);
    for (let suit = 0; suit < 4; suit++) for (let r = 0; r < state.found[suit]; r++) order.set(makeCard(r, suit), i++);
    const delays = new Map<number, number>();
    for (const v of views) {
      v.x = deckX;
      v.y = deckY;
      v.tx = NaN;
      v.a = null;
      v.el.classList.add('fc-wait');
      applyView(v);
      delays.set(v.card, (order.get(v.card) ?? 0) * 13);
    }
    placeAll(true, delays, 1.15);
  }

  // ── HUD & marks ───────────────────────────────────────────────────────

  function updateHud(): void {
    if (hudMoves) hudMoves.textContent = String(groups.length);
    if (hudDeal) hudDeal.textContent = '#' + deal;
    if (hudCap) hudCap.textContent = String(Math.min(13, maxMoveSize(state, false)));
    tick();
  }

  function clearMarks(): void {
    for (const m of marked) m.classList.remove('fc-sel', 'fc-tgt', 'fc-hint', 'fc-hint-dest');
    marked = [];
    setHover(null);
  }

  function mark(node: Element | null | undefined, cls: string): void {
    if (!node) return;
    node.classList.add(cls);
    marked.push(node);
  }

  function setHover(node: Element | null): void {
    if (hoverEl === node) return;
    hoverEl?.classList.remove('fc-hover');
    hoverEl = node;
    hoverEl?.classList.add('fc-hover');
  }

  function viewOf(card: number): CardView | undefined {
    return views[card];
  }

  function groupCards(src: Src): number[] {
    if (isCascadeLoc(src.from)) {
      const col = state.cascades[src.from];
      return col.slice(col.length - src.n);
    }
    if (isCellLoc(src.from)) {
      const c = state.cells[src.from - CELL0];
      return c === EMPTY ? [] : [c];
    }
    return [];
  }

  /** The element that represents a destination: the top card of a pile, or the empty slot. */
  function destElement(to: number): Element | null {
    if (isCascadeLoc(to)) {
      const col = state.cascades[to];
      return col.length ? viewOf(col[col.length - 1])?.el ?? null : colSlots[to];
    }
    if (isCellLoc(to)) return cellSlots[to - CELL0];
    if (isFoundLoc(to)) {
      const suit = to - FOUND0;
      const n = state.found[suit];
      return n ? viewOf(makeCard(n - 1, suit))?.el ?? null : foundSlots[foundSlotOf(suit)];
    }
    return null;
  }

  function select(src: Src): void {
    clearMarks();
    sel = src;
    for (const c of groupCards(src)) mark(viewOf(c)?.el, 'fc-sel');
    // Show where it can go.
    for (let d = 0; d < CASCADES; d++) {
      if (d === src.from) continue;
      const m = resolveMove(src, d);
      if (checkMove(state, m) === 'ok') mark(destElement(d), 'fc-tgt');
    }
    const fm = resolveMove(src, FOUND0);
    if (checkMove(state, fm) === 'ok') mark(destElement(fm.to), 'fc-tgt');
    if (!isCellLoc(src.from) && src.n === 1) {
      for (let i = 0; i < state.cells.length; i++) if (state.cells[i] === EMPTY) mark(cellSlots[i], 'fc-tgt');
    }
  }

  function deselect(): void {
    sel = null;
    clearMarks();
  }

  function shake(cards: number[]): void {
    for (const c of cards) {
      const v = viewOf(c);
      if (!v) continue;
      v.el.classList.remove('fc-shake');
      void v.el.offsetWidth;
      v.el.classList.add('fc-shake');
      later(() => v.el.classList.remove('fc-shake'), 360, false); // pure cosmetics: always clean up
    }
  }

  function fail(cards: number[], reason?: string): void {
    ctx.play('error');
    ctx.haptic('error');
    shake(cards);
    if (reason) ctx.toast(reason);
  }

  // ── Hit testing ───────────────────────────────────────────────────────

  /** Board-content coordinates (including the board's own scroll offset) of a viewport point. */
  function localAt(clientX: number, clientY: number): { x: number; y: number } {
    const r = (board as HTMLDivElement).getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top + (board?.scrollTop ?? 0) };
  }
  function local(e: PointerEvent): { x: number; y: number } {
    return localAt(e.clientX, e.clientY);
  }
  function canScroll(): boolean {
    return !!board && board.scrollHeight > board.clientHeight + 1;
  }

  function colAt(x: number, clampToBoard: boolean): number {
    if (!geo) return -1;
    const span = geo.cw + geo.gap;
    const i = Math.floor((x - geo.left + geo.gap / 2) / span);
    if (clampToBoard) return Math.max(0, Math.min(CASCADES - 1, i));
    return i >= 0 && i < CASCADES ? i : -1;
  }

  function hitTest(x: number, y: number): Hit {
    if (!geo) return { kind: 'none' };
    const col = colAt(x, false);
    if (col < 0) return { kind: 'none' };
    if (y < geo.casY - geo.rowGap / 2) {
      if (col < 4) return col < state.cells.length ? { kind: 'cell', i: col } : { kind: 'none' };
      return { kind: 'found', slot: col - 4 };
    }
    const cards = state.cascades[col];
    for (let i = cards.length - 1; i >= 0; i--) {
      const top = cardY(col, i);
      const bottom = i === cards.length - 1 ? top + geo.ch : top + colOv[col];
      if (y >= top && y < bottom) return { kind: 'cascade', col, idx: i };
    }
    return { kind: 'cascade', col, idx: -1 };
  }

  function sourceFor(hit: Hit): Src | null {
    if (hit.kind === 'cascade' && hit.idx >= 0) {
      const col = state.cascades[hit.col];
      const n = col.length - hit.idx;
      return n <= runLength(col) ? { from: hit.col, n } : null;
    }
    if (hit.kind === 'cell' && state.cells[hit.i] !== EMPTY) return { from: CELL0 + hit.i, n: 1 };
    return null;
  }

  function destFor(hit: Hit): number | null {
    if (hit.kind === 'cascade') return hit.col;
    if (hit.kind === 'cell') return CELL0 + hit.i;
    if (hit.kind === 'found') return FOUND0 + FOUND_ORDER[hit.slot];
    return null;
  }

  /** Turn "selection → destination" into a concrete move (picking the sub-run that fits a cascade). */
  function resolveMove(src: Src, to: number): Move {
    if (isFoundLoc(to)) {
      const card = movingCard(state, src.from, 1);
      return { from: src.from, to: card === EMPTY ? to : FOUND0 + suitOf(card), n: 1 };
    }
    if (isCellLoc(to)) return { from: src.from, to, n: 1 };
    const dest = state.cascades[to];
    if (dest.length && isCascadeLoc(src.from)) {
      const col = state.cascades[src.from];
      const top = dest[dest.length - 1];
      const k = rankOf(top) - rankOf(col[col.length - 1]);
      if (k >= 1 && k <= src.n && fitsOn(col[col.length - k], top)) return { from: src.from, to, n: k };
    }
    return { from: src.from, to, n: src.n };
  }

  // ── Pointer input ─────────────────────────────────────────────────────

  function onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (press) {
      // A second finger is ignored; a new press of the *same* pointer means the old one never saw its
      // pointerup (released outside the window, etc.) — drop the stale press instead of swallowing this one.
      if (press.id !== e.pointerId) return;
      cancelDrag(false);
    }
    if (!playing || finished || !board || busyOverlay) return;
    const p = local(e);
    const hit = hitTest(p.x, p.y);
    const src = sourceFor(hit);
    press = {
      id: e.pointerId,
      x0: p.x,
      y0: p.y,
      cx0: e.clientX,
      cy0: e.clientY,
      cx: e.clientX,
      cy: e.clientY,
      scroll0: board.scrollTop,
      hit,
      src,
      dragging: false,
      panning: false,
      offX: 0,
      offY: 0,
      cards: [],
      step: 0,
    };
    // Always capture, so the release is seen even off the board (cards: drag; felt: pan / tap).
    try {
      board.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onMove(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id || !geo || !board) return;
    press.cx = e.clientX;
    press.cy = e.clientY;
    if (!press.dragging && !press.panning) {
      if (Math.hypot(e.clientX - press.cx0, e.clientY - press.cy0) < DRAG_THRESHOLD) return;
      if (press.src) beginDrag(local(e));
      else if (canScroll()) press.panning = true;
      else return;
    }
    if (press.panning) {
      // The board uses touch-action: none (so card drags are never stolen by native panning); a drag on the
      // felt or on buried cards scrolls a tall board by hand instead.
      board.scrollTop = press.scroll0 - (e.clientY - press.cy0);
      return;
    }
    dragTo(local(e));
    updateEdgeScroll();
  }

  function onUp(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return;
    const pr = press;
    if (pr.dragging) {
      endDrag(local(e));
      return;
    }
    press = null;
    if (pr.panning) return;
    if (Math.hypot(e.clientX - pr.cx0, e.clientY - pr.cy0) > 24) return; // a swipe, not a tap
    onTap(pr.hit);
  }

  function onCancel(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return;
    cancelDrag(true);
  }

  function onLostCapture(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return;
    if (press.dragging) cancelDrag(true);
    else press = null;
  }

  /** While a card is dragged near the top/bottom edge of a scrollable board, scroll it. */
  function edgeSpeed(): number {
    if (!press || !press.dragging || !board || !canScroll()) return 0;
    const r = board.getBoundingClientRect();
    const zone = Math.min(48, r.height * 0.15);
    const up = press.cy - r.top;
    const down = r.bottom - press.cy;
    if (up < zone && board.scrollTop > 0) return -Math.ceil(14 * (1 - Math.max(0, up) / zone)) - 1;
    if (down < zone && board.scrollTop < board.scrollHeight - board.clientHeight) return Math.ceil(14 * (1 - Math.max(0, down) / zone)) + 1;
    return 0;
  }

  function updateEdgeScroll(): void {
    if (edgeRaf || !edgeSpeed()) return;
    const stepScroll = () => {
      edgeRaf = 0;
      const v = edgeSpeed();
      if (!v || !board || !press) return;
      board.scrollTop += v;
      dragTo(localAt(press.cx, press.cy));
      edgeRaf = requestAnimationFrame(stepScroll);
    };
    edgeRaf = requestAnimationFrame(stepScroll);
  }

  function stopEdgeScroll(): void {
    if (edgeRaf) cancelAnimationFrame(edgeRaf);
    edgeRaf = 0;
  }

  function beginDrag(p: { x: number; y: number }): void {
    if (!press || !press.src || !geo) return;
    cancelHint();
    deselect();
    const src = press.src;
    const cards = groupCards(src);
    press.cards = cards.map((c) => viewOf(c)).filter((v): v is CardView => !!v);
    press.step = isCascadeLoc(src.from) ? colOv[src.from] : geo.ideal;
    const first = press.cards[0];
    if (!first) return;
    // Settle any in-flight animation of the grabbed cards.
    for (const v of press.cards) {
      if (v.a) {
        v.a = null;
      }
    }
    press.offX = p.x - first.x;
    press.offY = p.y - first.y;
    press.dragging = true;
    press.cards.forEach((v, k) => {
      setZ(v, 3000 + k);
      v.el.classList.add('fc-drag');
    });
    ctx.haptic('light');
  }

  function dragTo(p: { x: number; y: number }): void {
    if (!press || !press.dragging || !geo) return;
    const x = p.x - press.offX;
    const y = p.y - press.offY;
    press.cards.forEach((v, k) => {
      v.x = x;
      v.y = y + k * press!.step;
      applyView(v);
    });
    const m = dropMove(x, y);
    setHover(m && checkMove(state, m) === 'ok' ? destElement(m.to) : null);
  }

  /** Exact move of the grabbed group to `to` (drags never split the group). */
  function exactMove(src: Src, to: number): Move {
    if (isFoundLoc(to)) {
      const card = movingCard(state, src.from, src.n);
      return { from: src.from, to: card === EMPTY ? to : FOUND0 + suitOf(card), n: src.n };
    }
    return { from: src.from, to, n: src.n };
  }

  function dropLoc(col: number, topRow: boolean): number {
    if (!topRow) return col;
    if (col < 4) return col < state.cells.length ? CELL0 + col : -1;
    return FOUND0 + FOUND_ORDER[col - 4];
  }

  /**
   * The move a drop with the dragged card at (x, y) would make. Considers the column under the card's
   * centre and the neighbour it overlaps most; returns null for "dropped back where it came from".
   */
  function dropMove(x: number, y: number): Move | null {
    if (!press || !press.src || !geo) return null;
    const src = press.src;
    const cx = x + geo.cw / 2;
    const cy = y + geo.ch * 0.4;
    const topRow = cy < geo.casY - geo.rowGap / 2;
    const primary = colAt(cx, true);
    const center = colX(primary) + geo.cw / 2;
    const secondary = Math.max(0, Math.min(CASCADES - 1, cx > center ? primary + 1 : primary - 1));
    const overlap = geo.cw - Math.abs(cx - (colX(secondary) + geo.cw / 2));
    const pTo = dropLoc(primary, topRow);
    const sTo = secondary !== primary && overlap > geo.cw * 0.3 ? dropLoc(secondary, topRow) : -1;
    const pMove = pTo >= 0 && pTo !== src.from ? exactMove(src, pTo) : null;
    const sMove = sTo >= 0 && sTo !== src.from ? exactMove(src, sTo) : null;
    if (pMove && checkMove(state, pMove) === 'ok') return pMove;
    if (sMove && checkMove(state, sMove) === 'ok') return sMove;
    return pMove;
  }

  function endDrag(p: { x: number; y: number }): void {
    if (!press) return;
    stopEdgeScroll();
    const pr = press;
    const m = dropMove(p.x - pr.offX, p.y - pr.offY);
    press = null;
    pr.cards.forEach((v) => v.el.classList.remove('fc-drag'));
    setHover(null);
    if (!m) {
      placeAll(true);
      return;
    }
    const chk = checkMove(state, m);
    if (chk === 'ok') {
      commit(m);
      return;
    }
    placeAll(true);
    failMove(chk, m, pr.cards.map((v) => v.card));
  }

  function cancelDrag(animateBack: boolean): void {
    stopEdgeScroll();
    if (!press) return;
    const pr = press;
    press = null;
    if (!pr.dragging) return;
    pr.cards.forEach((v) => v.el.classList.remove('fc-drag'));
    setHover(null);
    placeAll(animateBack);
  }

  function failMove(chk: MoveCheck, m: Move, cards: number[]): void {
    if (chk === 'capacity') {
      const cap = maxMoveSize(state, isCascadeLoc(m.to) && state.cascades[m.to].length === 0);
      fail(cards, t('tooMany', { n: cap }));
    } else fail(cards);
  }

  // ── Taps ──────────────────────────────────────────────────────────────

  function onTap(hit: Hit): void {
    if (!playing || finished || busyOverlay) return;
    cancelHintMarksOnly();
    const src = sourceFor(hit);
    const buried = hit.kind === 'cascade' && hit.idx >= 0 && !src;
    if (oneTap) {
      deselect();
      if (src) smartFrom(src);
      else if (buried) fail([state.cascades[hit.col][hit.idx]], t('notSequence'));
      return;
    }
    if (!sel) {
      if (src) {
        select(src);
        ctx.play('tap');
        ctx.haptic('light');
      } else if (buried) fail([state.cascades[hit.col][hit.idx]], t('notSequence'));
      return;
    }
    const cur = sel;
    // Tapping the selected card again → smart move (also covers double-tap).
    if (src && src.from === cur.from && src.n === cur.n) {
      deselect();
      smartFrom(cur);
      return;
    }
    const dest = destFor(hit);
    if (dest === null) {
      deselect();
      return;
    }
    if (dest === cur.from) {
      // Another card of the same run: adjust how much of it is selected.
      if (src) {
        select(src);
        ctx.play('tap');
      } else deselect();
      return;
    }
    const m = resolveMove(cur, dest);
    const chk = checkMove(state, m);
    if (chk === 'ok') {
      deselect();
      commit(m);
      return;
    }
    // Invalid destination (a card it doesn't fit on, an occupied free cell, a wrong foundation…): signal the
    // error on the selected cards and drop the selection, like classic FreeCell.
    const moving = groupCards(cur);
    deselect();
    failMove(chk, m, moving);
  }

  function smartFrom(src: Src): void {
    const m = smartMove(state, src.from, src.n);
    if (m) {
      commit(m);
      return;
    }
    const cards = groupCards(src);
    if (src.n > 1) {
      for (let d = 0; d < CASCADES; d++) {
        if (d === src.from) continue;
        const mm = { from: src.from, to: d, n: src.n };
        if (checkMove(state, mm) === 'capacity') {
          failMove('capacity', mm, cards);
          return;
        }
      }
    }
    fail(cards);
  }

  // ── Moves, undo, restart ──────────────────────────────────────────────

  function commit(m: Move): void {
    cancelHint();
    clearMarks();
    sel = null;
    const before = state;
    const s = cloneState(state);
    const userCards = groupCards({ from: m.from, n: m.n });
    applyMoveInPlace(s, m);
    const afterUser = cloneState(s);
    const autos = autoplayInPlace(s);
    let fin: Move[] = [];
    if (!isWon(s) && isTriviallySolvable(s)) {
      fin = finishMoves(s);
      for (const f of fin) applyMoveInPlace(s, f);
    }
    // Which card did each automatic move carry? (for sequencing the flights)
    const autoCards: number[] = [];
    for (const am of [...autos, ...fin]) {
      autoCards.push(movingCard(afterUser, am.from, 1));
      applyMoveInPlace(afterUser, am);
    }
    snapshots.push(before);
    groups.push([m, ...autos, ...fin]);
    state = s;
    if (!counted) {
      counted = true;
      updateStats(gameMode, (st) => {
        st.played++;
      });
    }
    const plan = flightPlan(userCards.length, autos.length, fin.length, animating());
    const delays = new Map<number, number>();
    userCards.forEach((c, k) => delays.set(c, plan.user[k]));
    autoCards.forEach((c, j) => delays.set(c, plan.auto[j]));
    placeAll(true, delays);
    ctx.play(isFoundLoc(m.to) ? 'place' : 'move');
    ctx.haptic('light');
    if (plan.popAt >= 0) later(() => ctx.play('pop'), plan.popAt);
    if (plan.swooshAt >= 0) later(() => ctx.play('swoosh'), plan.swooshAt);
    updateHud();
    save();
    if (isWon(state)) {
      onWin(plan.settle);
    } else if (!hasAnyMove(state)) {
      later(() => {
        if (finished || busyOverlay || hasAnyMove(state)) return;
        ctx.play('lose');
        ctx.haptic('error');
        modal = ctx.showModal({
          title: t('noMovesTitle'),
          body: t('noMovesBody'),
          buttons: [
            { label: t('restartDeal'), onClick: () => doRestart() },
            { label: t('undo'), primary: true, onClick: () => undo() },
          ],
        });
      }, plan.settle);
    }
  }

  /** Whether card moves are animated right now (placeAll skips flights under reduced motion / when hidden). */
  function animating(): boolean {
    return visible && !reducedMotion;
  }

  function undo(): void {
    if (!playing || finished || busyOverlay) return;
    cancelDrag(false);
    if (!groups.length) {
      ctx.toast(t('nothingToUndo'));
      ctx.play('error');
      return;
    }
    cancelHint();
    deselect();
    state = snapshots.pop() as State;
    groups.pop();
    placeAll(true);
    ctx.play('swoosh');
    ctx.haptic('light');
    updateHud();
    save();
  }

  function askRestart(): void {
    if (!playing || busyOverlay) return;
    if (finished) {
      replaySolved();
      return;
    }
    if (!groups.length) return;
    modal = ctx.showModal({
      title: t('restartDeal'),
      body: t('restartConfirm', { deal }),
      buttons: [{ label: t('cancel') }, { label: t('restart'), primary: true, onClick: () => doRestart() }],
    });
  }

  /** Play a solved deal again from the start, as a fresh game. */
  function replaySolved(): void {
    if (!playing || !finished) return;
    counted = false;
    doRestart();
  }

  function doRestart(): void {
    if (!playing || busyOverlay) return;
    newEpoch(); // drop the pending win celebration / modal, dead-end modal and auto-play sounds
    cancelDrag(false);
    cancelHint();
    deselect();
    removeWin();
    finished = false;
    state = cloneState(initial);
    snapshots = [];
    groups = [];
    elapsedBase = 0;
    runStart = 0;
    hints = 0;
    resumeTimer();
    dealIn();
    ctx.play('swoosh');
    updateHud();
    save();
  }

  function openNewDealModal(): void {
    if (!playing || busyOverlay) return;
    cancelDrag(false);
    // The player chose to move on: a still-pending win / dead-end modal must not pop up over this one.
    newEpoch();
    let pending: Mode = gameMode;
    const input = el('input', {
      class: 'fc-input',
      type: 'text',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      maxlength: '5',
      placeholder: t('dealPlaceholder'),
      'aria-label': t('dealPlaceholder'),
      enterkeyhint: 'go',
    }) as HTMLInputElement;
    const err = el('p', { class: 'fc-input-err', role: 'alert' });
    let handle: ModalHandle | null = null;
    const go = () => {
      const raw = input.value.trim();
      let d: number | null = null;
      if (raw) {
        const r = parseDealNumber(raw);
        if (!r.ok) {
          // Keep the dialog (mode + typed text) open and explain inline.
          err.textContent = dealError(r.reason);
          ctx.play('error');
          ctx.haptic('error');
          shakeInput(input);
          input.focus();
          input.select();
          return;
        }
        d = r.deal;
      }
      handle?.close();
      mode = pending;
      ctx.storage.set('mode', pending);
      startDeal(pending, d);
    };
    input.addEventListener('input', () => {
      err.textContent = '';
      input.classList.remove('fc-input-bad');
    });
    const desc = el('p', { class: 'fc-note', text: t(MODE_KEY[pending] + 'Desc') });
    const body = el(
      'div',
      { class: 'fc-modal-body' },
      segmented<Mode>(
        MODES.map((m) => ({ value: m, label: t(MODE_KEY[m]) })),
        pending,
        (m) => {
          pending = m;
          desc.textContent = t(MODE_KEY[m] + 'Desc');
        },
      ),
    );
    body.classList.add('fc-newdeal');
    body.append(desc, el('p', { class: 'fc-note', text: t('newDealPrompt') }), input, err);
    if (hasUnfinished()) body.append(el('p', { class: 'fc-note', text: '⚠️ ' + t('abandonNote') }));
    // The shell's modal buttons always close the dialog first, so this one brings its own action row and
    // only closes once the input is valid.
    body.append(
      el(
        'div',
        { class: 'modal-actions fc-modal-actions' },
        button(t('cancel'), () => handle?.close(), { variant: 'secondary', size: 'lg' }),
        button(t('dealGo'), go, { variant: 'primary', size: 'lg' }),
      ),
    );
    handle = ctx.showModal({ title: t('newDeal'), body, buttons: [] });
    modal = handle;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    });
  }

  // ── Hints (solver, time-sliced) ───────────────────────────────────────

  function runJob(step: () => boolean): Job {
    let id = 0;
    let alive = true;
    const loop = () => {
      id = 0;
      if (!alive || destroyed) return;
      let more = false;
      try {
        more = step();
      } catch (e) {
        console.warn(e);
        more = false;
      }
      if (more && alive) id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return {
      cancel() {
        alive = false;
        if (id) cancelAnimationFrame(id);
      },
    };
  }

  function cancelJob(): void {
    job?.cancel();
    job = null;
    hideBusy();
  }

  function showBusy(text: string): void {
    hideBusy();
    busyOverlay = el(
      'div',
      { class: 'overlay fc-busy-overlay' },
      el('div', { class: 'fc-spinner' }),
      el('p', { class: 'fc-busy-text', text }),
      button(t('cancel'), () => cancelJob(), { variant: 'secondary' }),
    );
    root.append(busyOverlay);
    pauseTimer();
  }

  function hideBusy(): void {
    if (!busyOverlay) return;
    busyOverlay.remove();
    busyOverlay = null;
    resumeTimer();
  }

  function storeHintCache(from: State, moves: Move[]): void {
    const keys: string[] = [];
    const s = cloneState(from);
    for (const m of moves) {
      keys.push(exactKey(s));
      if (checkMove(s, m) !== 'ok') break;
      applyMoveInPlace(s, m);
      autoplayInPlace(s);
    }
    hintCache = { keys, moves: moves.slice(0, keys.length) };
  }

  function cachedHint(): Move | null {
    if (!hintCache) return null;
    const i = hintCache.keys.indexOf(exactKey(state));
    if (i < 0) return null;
    const m = hintCache.moves[i];
    return m && checkMove(state, m) === 'ok' ? m : null;
  }

  function setHintBusy(b: boolean): void {
    if (!hintBtn) return;
    hintBtn.classList.toggle('fc-busy', b);
    const label = hintBtn.querySelector('span:last-child');
    if (label) label.textContent = b ? t('thinking') : t('hintBtn');
  }

  function cancelHint(): void {
    hintJob?.cancel();
    hintJob = null;
    setHintBusy(false);
  }

  function cancelHintMarksOnly(): void {
    for (const m of marked) m.classList.remove('fc-hint', 'fc-hint-dest');
  }

  function hint(): void {
    if (!playing || finished || hintJob || busyOverlay) return;
    cancelDrag(false);
    const cached = cachedHint();
    if (cached) {
      showHint(cached);
      return;
    }
    const startKey = exactKey(state);
    const solver = new Solver(state, { maxExpansions: HINT_EXPANSIONS });
    setHintBusy(true);
    hintJob = runJob(() => {
      const st = solver.step(9);
      if (st === 'running') return true;
      hintJob = null;
      setHintBusy(false);
      if (exactKey(state) !== startKey || finished) return false;
      if (st === 'solved' && solver.solution.length) {
        storeHintCache(state, solver.solution);
        const m = cachedHint();
        if (m) showHint(m);
      } else if (st === 'unsolvable') {
        ctx.play('error');
        ctx.haptic('error');
        modal = ctx.showModal({
          title: t('hintBtn'),
          body: t('hintUnwinnable'),
          buttons: [{ label: t('ok') }, { label: t('undo'), primary: true, onClick: () => undo() }],
        });
      } else {
        ctx.play('error');
        ctx.toast(t('hintNone'), 2600);
      }
      return false;
    });
  }

  function destName(m: Move): string {
    if (isFoundLoc(m.to)) return t('destFoundation');
    if (isCellLoc(m.to)) return t('destCell');
    const col = state.cascades[m.to];
    return col.length ? cardLabel(col[col.length - 1]) : t('destEmpty');
  }

  function showHint(m: Move): void {
    hints++;
    elapsedBase += HINT_PENALTY;
    const src: Src = { from: m.from, n: m.n };
    const cards = groupCards(src);
    if (!oneTap) select(src);
    else clearMarks();
    for (const c of cards) mark(viewOf(c)?.el, 'fc-hint');
    mark(destElement(m.to), 'fc-hint-dest');
    ctx.play('success');
    ctx.haptic('light');
    ctx.toast(t('hintMove', { card: cardLabel(cards[0]), dest: destName(m), n: HINT_PENALTY }), 2600);
    updateHud();
    save();
  }

  // ── Winning ───────────────────────────────────────────────────────────

  function onWin(delay: number): void {
    finished = true;
    pauseTimer();
    const secs = Math.max(1, Math.round(elapsedSec()));
    const moves = groups.length;
    ctx.storage.remove('saved');
    const st = updateStats(gameMode, (s) => {
      s.wins++;
      s.streak++;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
    });
    const info: WinInfo = {
      deal,
      mode: gameMode,
      secs,
      moves,
      hints,
      st,
      bestT: ctx.storage.recordBest(gameMode, secs, 'lower'),
      bestM: ctx.storage.recordBest(gameMode + '-moves', moves, 'lower'),
    };
    updateHud();
    if (hudTime) hudTime.textContent = formatTime(secs);
    // Both are epoch-scoped: a restart / new deal before they fire cancels them.
    later(() => {
      ctx.play('win');
      ctx.haptic('success');
      celebrate();
    }, Math.max(0, delay - 250));
    later(() => showWinModal(info), delay + (animating() ? 1700 : 300));
  }

  function showWinModal(w: WinInfo): void {
    if (!finished || w.deal !== deal || w.mode !== gameMode) return;
    const { secs, moves, st, bestT, bestM } = w;
    const bt = ctx.storage.getBest(w.mode);
    const bm = ctx.storage.getBest(w.mode + '-moves');
    const tile = (v: string, l: string, sub: string, isNew: boolean) =>
      el(
        'div',
        { class: 'fc-stat' },
        el('div', { class: 'fc-stat-v', text: v }),
        el('div', { class: 'fc-stat-l', text: l }),
        el('div', { class: isNew ? 'fc-badge' : 'fc-stat-l', text: isNew ? '🏆 ' + t('newBest') : sub }),
      );
    const body = el(
      'div',
      { class: 'fc-modal-body' },
      el('p', { text: t('winBody', { deal: w.deal, mode: t(MODE_KEY[w.mode]) }) }),
      el(
        'div',
        { class: 'fc-win-grid' },
        tile(formatTime(secs), t('time'), t('bestLabel', { v: bt === null ? '—' : formatTime(bt) }), bestT),
        tile(String(moves), t('moves'), t('bestLabel', { v: bm === null ? '—' : String(bm) }), bestM),
        tile(`${st.wins}/${st.played}`, t('winsLabel'), t('streakLabel', { n: st.streak }), false),
      ),
      w.hints ? el('p', { class: 'fc-note', text: t('hintsUsed', { n: w.hints }) }) : null,
    );
    modal = ctx.showModal({
      title: t('congratulations'),
      body,
      buttons: [
        { label: t('home'), onClick: () => ctx.exit() },
        { label: t('replayDeal'), onClick: () => replaySolved() },
        { label: t('newDeal'), primary: true, onClick: () => startDeal(w.mode, null) },
      ],
    });
  }

  /** The classic bouncing-cards cascade, drawn on a canvas over the board. */
  function celebrate(): void {
    if (reducedMotion || !board || !geo || win) return;
    const layer = el('div', { class: 'fc-win-layer' });
    const scrollY0 = board.scrollTop;
    layer.style.top = scrollY0 + 'px';
    layer.style.height = geo.H + 'px';
    layer.style.bottom = 'auto';
    board.append(layer);
    const cv = createCanvas(layer);
    const g = geo;
    const cs = getComputedStyle(board);
    const face = cs.getPropertyValue('--fc-face').trim() || '#fff';
    const red = cs.getPropertyValue('--fc-red').trim() || '#d1243f';
    const black = cs.getPropertyValue('--fc-black').trim() || '#1a1f2c';
    const edge = 'rgba(0,0,0,0.35)';
    const order: number[] = [];
    for (let r = 12; r >= 0; r--) for (const s of FOUND_ORDER) order.push(makeCard(r, s));
    interface P {
      card: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      bounce: number;
      dead: boolean;
    }
    const parts: P[] = [];
    let launched = 0;
    let acc = 0;
    let last = performance.now();
    const startT = last;
    const scale = g.cw / 45;
    const draw = (c2: CanvasRenderingContext2D, p: P) => {
      roundRect(c2, p.x, p.y, g.cw, g.ch, g.cw * 0.13);
      c2.fillStyle = face;
      c2.fill();
      c2.strokeStyle = edge;
      c2.lineWidth = 1;
      c2.stroke();
      c2.fillStyle = isRed(p.card) ? red : black;
      c2.textBaseline = 'top';
      c2.textAlign = 'left';
      c2.font = `800 ${Math.round(g.cw * 0.33)}px -apple-system, Segoe UI, Roboto, sans-serif`;
      c2.fillText(RANK_LABELS[rankOf(p.card)] + SUIT_GLYPHS[suitOf(p.card)], p.x + g.cw * 0.07, p.y + 2);
      c2.textAlign = 'center';
      c2.font = `${Math.round(g.cw * 0.62)}px -apple-system, Segoe UI, Roboto, sans-serif`;
      c2.fillText(SUIT_GLYPHS[suitOf(p.card)], p.x + g.cw / 2, p.y + g.ch * 0.42);
    };
    const step = (now: number) => {
      if (!win || destroyed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += dt;
      while (launched < order.length && acc >= 0.085) {
        acc -= 0.085;
        const card = order[launched++];
        const v = viewOf(card);
        v?.el.classList.add('fc-gone');
        const slot = foundSlotOf(suitOf(card));
        const dir = slot < 2 ? (Math.random() < 0.7 ? -1 : 1) : Math.random() < 0.7 ? 1 : -1;
        parts.push({
          card,
          x: colX(4 + slot),
          y: g.topY - scrollY0,
          vx: dir * (90 + Math.random() * 190) * scale,
          vy: -(Math.random() * 320) * scale,
          bounce: 0.68 + Math.random() * 0.17,
          dead: false,
        });
      }
      const c2 = cv.ctx;
      const H = cv.height;
      const W = cv.width;
      let alive = false;
      for (const p of parts) {
        if (p.dead) continue;
        p.vy += 1500 * scale * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > H - g.ch) {
          p.y = H - g.ch;
          p.vy = -Math.abs(p.vy) * p.bounce;
        }
        if (p.x < -g.cw || p.x > W) {
          p.dead = true;
          continue;
        }
        alive = true;
        draw(c2, p);
      }
      if ((alive || launched < order.length) && now - startT < 12000) win.raf = requestAnimationFrame(step);
      else win.raf = 0;
    };
    win = { cv, layer, raf: requestAnimationFrame(step) };
    layer.addEventListener('pointerdown', () => removeWin());
  }

  function removeWin(): void {
    if (!win) return;
    if (win.raf) cancelAnimationFrame(win.raf);
    win.cv.destroy();
    win.layer.remove();
    win = null;
    for (const v of views) v.el.classList.remove('fc-gone');
  }

  // ── Keyboard (bonus) ──────────────────────────────────────────────────

  function onKey(e: KeyboardEvent): void {
    if (!playing || finished || busyOverlay) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (document.querySelector('.modal-backdrop.open')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'u' || k === 'backspace') {
      e.preventDefault();
      undo();
    } else if (k === 'h') {
      hint();
    } else if (k === 'escape') {
      deselect();
    }
  }
  window.addEventListener('keydown', onKey);

  // ── Lifecycle ─────────────────────────────────────────────────────────

  ctx.onVisibility((v) => {
    visible = v;
    if (!v) {
      cancelDrag(false);
      pauseTimer();
      finishAnims();
      save();
    } else if (!busyOverlay) {
      resumeTimer();
    }
  });
  ctx.onThemeChange(() => {
    /* Everything is CSS-variable driven; nothing to redraw. */
  });

  showStart();

  return {
    destroy() {
      if (destroyed) return;
      if (playing && !finished) {
        pauseTimer();
        save();
      }
      destroyed = true;
      window.removeEventListener('keydown', onKey);
      window.clearInterval(tickId);
      timeouts.forEach((id) => window.clearTimeout(id));
      timeouts = [];
      job?.cancel();
      job = null;
      hintJob?.cancel();
      hintJob = null;
      modal?.close();
      modal = null;
      teardownBoard();
      removeHeader();
    },
  };
}

const game: GameModule = { strings, create };
export default game;
