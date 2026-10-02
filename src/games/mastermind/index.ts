import type { GameContext, GameInstance, GameModule } from '../../app/types';
import { el, button, segmented, formatTime } from '../../app/ui';
import { generateCode, scoreGuess, isSolved, countConsistent, type Config, type Feedback } from './logic';
import './style.css';

const PALETTE = ['#ff5470', '#ff9f43', '#ffd93d', '#3ddc97', '#5b8cff', '#b067ff', '#ff6ad5', '#4dd2ff'];

type Mode = 'easy' | 'medium' | 'hard';
const MODES: Record<Mode, Config> = {
  easy: { length: 4, colors: 6, maxAttempts: 10, allowRepeats: false },
  medium: { length: 5, colors: 7, maxAttempts: 10, allowRepeats: true },
  hard: { length: 6, colors: 8, maxAttempts: 12, allowRepeats: true },
};

const strings = {
  zh: {
    rules:
      '电脑随机生成一组颜色密码，你需要在限定次数内破译。\n每次猜测后会得到反馈：\n● 实心点：颜色和位置都正确\n○ 空心点：颜色正确但位置错误\n反馈不按位置排列，需要自己推理。\n\n简单：4 位 · 6 色 · 不重复\n中等：5 位 · 7 色 · 可重复\n困难：6 位 · 8 色 · 可重复\n\n点击颜色填入当前行，点击已填的格子可修改，填满后提交。',
    attempts: '第 {n} / {max} 次',
    submit: '提交',
    clear: '清空',
    hint: '可能性',
    hintText: '与目前所有反馈一致的密码还有 {n} 种。',
    hintTooMany: '组合太多，暂无法统计。',
    solvedIn: '用了 {n} 次猜中，耗时 {t}',
    failed: '次数用完了。密码是：',
    easyDesc: '4 位 · 6 色 · 不重复',
    mediumDesc: '5 位 · 7 色 · 可重复',
    hardDesc: '6 位 · 8 色 · 可重复',
    bestAttempts: '最少 {n} 次',
  },
  en: {
    rules:
      'The computer picks a secret colour code. Crack it within the attempt limit.\nAfter each guess you get feedback:\n● filled dot: right colour in the right place\n○ hollow dot: right colour in the wrong place\nFeedback dots are not ordered — the deduction is up to you.\n\nEasy: 4 pegs · 6 colours · no repeats\nMedium: 5 pegs · 7 colours · repeats allowed\nHard: 6 pegs · 8 colours · repeats allowed\n\nTap a colour to fill the current row, tap a filled peg to change it, then submit.',
    attempts: 'Attempt {n} / {max}',
    submit: 'Submit',
    clear: 'Clear',
    hint: 'Possibilities',
    hintText: '{n} codes are still consistent with all feedback so far.',
    hintTooMany: 'Too many combinations to count.',
    solvedIn: 'Cracked in {n} attempts, {t}',
    failed: 'Out of attempts. The code was:',
    easyDesc: '4 pegs · 6 colours · no repeats',
    mediumDesc: '5 pegs · 7 colours · repeats',
    hardDesc: '6 pegs · 8 colours · repeats',
    bestAttempts: 'Best: {n} attempts',
  },
};

function create(ctx: GameContext): GameInstance {
  const { root, t } = ctx;
  let mode: Mode = ctx.storage.get<Mode>('mode', 'easy');
  let cfg = MODES[mode];
  let code: number[] = [];
  let history: { guess: number[]; fb: Feedback }[] = [];
  let current: (number | null)[] = [];
  let selected = 0;
  let startedAt = 0;
  let finished = false;
  let timer = 0;

  const removeRestart = ctx.addHeaderAction({ icon: '↻', label: t('restart'), onClick: () => showStart() });
  ctx.onDestroy(() => {
    removeRestart();
    clearInterval(timer);
  });

  // ── Start screen ──────────────────────────────────────────────────────
  function showStart(): void {
    clearInterval(timer);
    finished = true;
    root.innerHTML = '';
    ctx.setStatus('');
    const bestLine = el('p', { class: 'muted' });
    const updateBest = () => {
      const b = ctx.storage.getBest(mode);
      bestLine.textContent = b === null ? '' : t('bestAttempts', { n: b });
    };
    updateBest();
    const desc = el('p', { class: 'muted', text: t(mode + 'Desc') });
    root.append(
      el(
        'div',
        { class: 'start-screen' },
        el('div', { class: 'big-icon', text: '🎯' }),
        el('h2', { text: t('chooseDifficulty') }),
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
        button(t('play'), () => startGame(), { variant: 'primary', size: 'lg' }),
      ),
    );
  }

  // ── Game ──────────────────────────────────────────────────────────────
  let board: HTMLElement;
  let submitBtn: HTMLButtonElement;

  function startGame(): void {
    cfg = MODES[mode];
    code = generateCode(cfg);
    history = [];
    current = new Array(cfg.length).fill(null);
    selected = 0;
    finished = false;
    startedAt = Date.now();
    root.innerHTML = '';
    board = el('div', { class: 'mm-board' });
    const palette = el('div', { class: 'mm-palette' });
    for (let c = 0; c < cfg.colors; c++) {
      palette.append(
        el('button', {
          class: 'mm-color',
          type: 'button',
          style: { background: PALETTE[c] },
          text: String(c + 1),
          'aria-label': 'color ' + (c + 1),
          onClick: () => pick(c),
        }),
      );
    }
    submitBtn = button(t('submit'), submit, { variant: 'primary' });
    const actions = el(
      'div',
      { class: 'mm-actions' },
      button(t('clear'), clearRow, { variant: 'secondary' }),
      button(t('hint'), showHint, { variant: 'secondary' }),
      submitBtn,
    );
    root.append(board, palette, actions);
    clearInterval(timer);
    timer = window.setInterval(updateStatus, 1000);
    render();
  }

  function updateStatus(): void {
    if (finished) return;
    const elapsed = (Date.now() - startedAt) / 1000;
    ctx.setStatus(`${t('attempts', { n: history.length + 1, max: cfg.maxAttempts })} · ${formatTime(elapsed)}`);
  }

  function pegEl(color: number | null, extra = ''): HTMLElement {
    const p = el('div', { class: 'mm-peg ' + (color === null ? '' : 'filled ') + extra });
    if (color !== null) {
      p.style.background = PALETTE[color];
      p.textContent = String(color + 1);
    }
    return p;
  }

  function feedbackEl(fb: Feedback): HTMLElement {
    const wrap = el('div', { class: 'mm-feedback' });
    for (let i = 0; i < cfg.length; i++) {
      const cls = i < fb.exact ? 'exact' : i < fb.exact + fb.partial ? 'partial' : '';
      wrap.append(el('div', { class: 'mm-fb ' + cls }));
    }
    return wrap;
  }

  function render(): void {
    board.innerHTML = '';
    history.forEach((h, i) => {
      const pegs = el('div', { class: 'mm-pegs' }, ...h.guess.map((c) => pegEl(c)));
      board.append(el('div', { class: 'mm-row' }, el('div', { class: 'mm-index', text: String(i + 1) }), pegs, feedbackEl(h.fb)));
    });
    if (!finished) {
      const pegs = el('div', { class: 'mm-pegs' });
      current.forEach((c, i) => {
        const p = pegEl(c, i === selected ? 'selected' : '');
        p.addEventListener('click', () => {
          selected = i;
          ctx.play('tap');
          render();
        });
        pegs.append(p);
      });
      board.append(el('div', { class: 'mm-row current' }, el('div', { class: 'mm-index', text: String(history.length + 1) }), pegs, el('div', { class: 'mm-feedback' })));
      submitBtn.disabled = current.some((c) => c === null);
    }
    board.scrollTop = board.scrollHeight;
    updateStatus();
  }

  function pick(color: number): void {
    if (finished) return;
    if (!cfg.allowRepeats && current.includes(color) && current[selected] !== color) {
      ctx.play('error');
      ctx.haptic('error');
      return;
    }
    current[selected] = color;
    ctx.play('place');
    ctx.haptic('light');
    const nextEmpty = current.findIndex((c, i) => c === null && i > selected);
    selected = nextEmpty >= 0 ? nextEmpty : current.findIndex((c) => c === null) >= 0 ? current.findIndex((c) => c === null) : Math.min(selected + 1, cfg.length - 1);
    render();
  }

  function clearRow(): void {
    if (finished) return;
    current = new Array(cfg.length).fill(null);
    selected = 0;
    render();
  }

  function showHint(): void {
    const n = countConsistent(cfg, history);
    ctx.showModal({ title: t('hint'), body: n < 0 ? t('hintTooMany') : t('hintText', { n }) });
  }

  function submit(): void {
    if (finished || current.some((c) => c === null)) return;
    const guess = current.map((c) => c as number);
    const fb = scoreGuess(guess, code);
    history.push({ guess, fb });
    current = new Array(cfg.length).fill(null);
    selected = 0;
    if (isSolved(fb, cfg.length)) {
      finish(true);
    } else if (history.length >= cfg.maxAttempts) {
      finish(false);
    } else {
      ctx.play(fb.exact > 0 ? 'success' : 'move');
      ctx.haptic('light');
      render();
    }
  }

  function finish(won: boolean): void {
    finished = true;
    clearInterval(timer);
    render();
    const elapsed = (Date.now() - startedAt) / 1000;
    const secret = el('div', { class: 'mm-secret' }, ...code.map((c) => pegEl(c)));
    if (won) {
      const isBest = ctx.storage.recordBest(mode, history.length, 'lower');
      ctx.play('win');
      ctx.haptic('success');
      const body = el('div', {}, el('p', { text: t('solvedIn', { n: history.length, t: formatTime(elapsed) }) }), isBest ? el('p', { text: '🏆 ' + t('newBest') }) : null, secret);
      ctx.showModal({
        title: t('congratulations'),
        body,
        dismissible: false,
        buttons: [
          { label: t('home'), onClick: () => ctx.exit() },
          { label: t('newGame'), primary: true, onClick: () => showStart() },
        ],
      });
    } else {
      ctx.play('lose');
      ctx.haptic('error');
      const body = el('div', {}, el('p', { text: t('failed') }), secret);
      ctx.showModal({
        title: t('lose'),
        body,
        dismissible: false,
        buttons: [
          { label: t('home'), onClick: () => ctx.exit() },
          { label: t('retry'), primary: true, onClick: () => showStart() },
        ],
      });
    }
  }

  showStart();
  return {
    destroy() {
      clearInterval(timer);
    },
  };
}

const game: GameModule = { strings, create };
export default game;
