/**
 * Start screen (§11.1): organ carousel (mini map, stars for the chosen difficulty, best wave, lock badge), difficulty,
 * Continue / Defend / New run, the 「免疫记忆」 button and the graphics-quality selector.
 */
import type { GameContext } from '../../../app/types';
import { el, button } from '../../../app/ui';
import { MAP_IDS, type Difficulty, type ImmuneMemory, type MapId, type Quality, type RunSave } from '../types';
import { findMap, isHardUnlocked, isMapUnlocked, talentPoints, totalStars } from '../logic';
import { drawMiniMap } from './minimap';
import { MAP_ICON, savedNextWave, starsText, type T } from './format';

export interface StartHost {
  ctx: GameContext;
  t: T;
  memory(): ImmuneMemory;
  setMemory(m: ImmuneMemory): void;
  /** Validated run save (or null). */
  savedRun(): RunSave | null;
  /** True once the lazily loaded 3D module resolved; `onReady` fires when it does. */
  rendererReady(): boolean;
  onRendererReady(cb: () => void): void;
  play(map: MapId, difficulty: Difficulty): void;
  continueRun(): void;
  openMemory(): void;
}

/** Builds the start screen into `root`; returns a cleanup function. */
export function renderStart(root: HTMLElement, host: StartHost): () => void {
  const { t, ctx } = host;
  const cleanups: (() => void)[] = [];
  let mem = host.memory();
  let mapId: MapId = mem.prefs.map;
  let diff: Difficulty = mem.prefs.difficulty;
  if (!isMapUnlocked(mem, mapId)) mapId = 'vessel';

  const wrap = el('div', { class: 'td-start' });
  const head = el(
    'div',
    { class: 'td-start-head' },
    el('div', { class: 'td-start-icon', text: '🦠' }),
    el('p', { class: 'td-start-tag', text: t('tagline') }),
  );

  // ── organ carousel ──
  const track = el('div', { class: 'td-organs', role: 'listbox', 'aria-label': t('chooseOrgan') });
  const dots = el('div', { class: 'td-dots' });
  const cards: { id: MapId; card: HTMLElement; stars: HTMLElement; best: HTMLElement; canvas: HTMLCanvasElement; lock: HTMLElement }[] = [];
  for (const id of MAP_IDS) {
    const canvas = el('canvas', { class: 'td-organ-map', 'aria-hidden': 'true' });
    const stars = el('div', { class: 'td-organ-stars' });
    const best = el('div', { class: 'td-organ-best muted small' });
    const lock = el('div', { class: 'td-organ-lock' });
    const card = el(
      'button',
      { class: 'td-organ', type: 'button', role: 'option', dataset: { map: id } },
      canvas,
      el(
        'div',
        { class: 'td-organ-info' },
        el('div', { class: 'td-organ-name' }, el('span', { class: 'td-organ-emoji', text: MAP_ICON[id] }), el('span', { text: t('map_' + id) })),
        stars,
        best,
        el('p', { class: 'td-organ-desc', text: t('mapDesc_' + id) }),
        lock,
      ),
    );
    card.addEventListener('click', () => {
      if (mapId !== id) {
        ctx.play('tap');
        select(id, true);
      }
    });
    track.append(card);
    cards.push({ id, card, stars, best, canvas, lock });
    dots.append(el('span', { class: 'td-dot', dataset: { map: id } }));
  }

  // ── difficulty ──
  const diffWrap = el('div', { class: 'segmented td-diff', role: 'radiogroup' });
  const diffBtns: Record<Difficulty, HTMLButtonElement> = {
    normal: el('button', { class: 'seg', type: 'button', role: 'radio', text: t('normal') }),
    hard: el('button', { class: 'seg', type: 'button', role: 'radio', text: t('hard') }),
  };
  for (const d of ['normal', 'hard'] as const) {
    diffBtns[d].addEventListener('click', () => {
      if (diffBtns[d].disabled || diff === d) return;
      ctx.play('tap');
      ctx.haptic('light');
      diff = d;
      savePrefs();
      refresh();
    });
    diffWrap.append(diffBtns[d]);
  }
  const diffDesc = el('p', { class: 'muted small td-diff-desc' });

  // ── actions ──
  const savedLine = el('p', { class: 'td-saved small' });
  const primary = button('', () => onPrimary(), { variant: 'primary', size: 'lg', class: 'td-play' });
  const secondary = button(t('newRun'), () => onNewRun(), { variant: 'secondary', size: 'md', class: 'td-newrun' });
  const memBtn = button(t('memoryBtn'), () => host.openMemory(), { variant: 'secondary', size: 'md', icon: '🧬', class: 'td-membtn' });
  const memBadge = el('span', { class: 'td-membadge' });
  memBtn.append(memBadge);

  const qWrap = el('div', { class: 'segmented td-quality', role: 'radiogroup' });
  const qBtns: Record<Quality, HTMLButtonElement> = {
    auto: el('button', { class: 'seg', type: 'button', text: t('qAuto') }),
    high: el('button', { class: 'seg', type: 'button', text: t('qHigh') }),
    low: el('button', { class: 'seg', type: 'button', text: t('qLow') }),
  };
  for (const q of ['auto', 'high', 'low'] as const) {
    qBtns[q].addEventListener('click', () => {
      ctx.play('tap');
      mem = { ...host.memory(), prefs: { ...host.memory().prefs, quality: q } };
      host.setMemory(mem);
      refresh();
    });
    qWrap.append(qBtns[q]);
  }
  const qRow = el('div', { class: 'td-qrow' }, el('span', { class: 'muted small', text: t('quality') }), qWrap);

  wrap.append(
    head,
    track,
    dots,
    el('div', { class: 'td-start-mid' }, diffWrap, diffDesc),
    el('div', { class: 'td-start-actions' }, savedLine, primary, secondary, memBtn, qRow),
  );
  root.append(wrap);

  function savePrefs(): void {
    const cur = host.memory();
    if (cur.prefs.map === mapId && cur.prefs.difficulty === diff) return;
    mem = { ...cur, prefs: { ...cur.prefs, map: mapId, difficulty: diff } };
    host.setMemory(mem);
  }

  function select(id: MapId, scroll: boolean): void {
    mapId = id;
    if (diff === 'hard' && !isHardUnlocked(host.memory(), id)) diff = 'normal';
    if (isMapUnlocked(host.memory(), id)) savePrefs();
    if (scroll) {
      const c = cards.find((x) => x.id === id);
      if (c) track.scrollTo({ left: c.card.offsetLeft - (track.clientWidth - c.card.offsetWidth) / 2, behavior: 'smooth' });
    }
    refresh();
  }

  function onPrimary(): void {
    const save = host.savedRun();
    if (save) {
      host.continueRun();
      return;
    }
    if (!isMapUnlocked(host.memory(), mapId) || !host.rendererReady()) return;
    host.play(mapId, diff);
  }

  function onNewRun(): void {
    const save = host.savedRun();
    if (!isMapUnlocked(host.memory(), mapId) || !host.rendererReady()) return;
    if (!save) {
      host.play(mapId, diff);
      return;
    }
    ctx.showModal({
      title: t('newRun'),
      body: t('newRunConfirm', { map: t('map_' + save.mapId), n: savedNextWave(save) }),
      buttons: [{ label: t('cancel') }, { label: t('confirm'), primary: true, onClick: () => host.play(mapId, diff) }],
    });
  }

  function refresh(): void {
    mem = host.memory();
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    for (const c of cards) {
      const unlocked = isMapUnlocked(mem, c.id);
      c.card.classList.toggle('selected', c.id === mapId);
      c.card.classList.toggle('locked', !unlocked);
      c.card.setAttribute('aria-selected', String(c.id === mapId));
      const st = mem.stars[c.id][diff];
      c.stars.textContent = starsText(st);
      c.stars.classList.toggle('none', st === 0);
      const b = mem.bestEndless[c.id][diff];
      c.best.textContent = b > 0 ? t('bestWave', { n: b }) : t('noBest');
      c.lock.textContent = unlocked ? '' : t('lockedStars', { n: findMap(c.id).unlockStars });
      c.lock.style.display = unlocked ? 'none' : '';
      if (c.canvas.dataset.drawn !== theme + unlocked) {
        drawMiniMap(c.canvas, findMap(c.id), theme, !unlocked);
        c.canvas.dataset.drawn = theme + unlocked;
      }
    }
    dots.querySelectorAll<HTMLElement>('.td-dot').forEach((d) => d.classList.toggle('on', d.dataset.map === mapId));
    const hardOk = isHardUnlocked(mem, mapId);
    diffBtns.hard.disabled = !hardOk;
    diffBtns.hard.classList.toggle('td-disabled', !hardOk);
    for (const d of ['normal', 'hard'] as const) {
      diffBtns[d].classList.toggle('active', d === diff);
      diffBtns[d].setAttribute('aria-checked', String(d === diff));
    }
    diffDesc.textContent = !hardOk && diff === 'normal' ? `${t('normalDesc')} · ${t('hardLocked')}` : t(diff + 'Desc');
    const save = host.savedRun();
    const unlocked = isMapUnlocked(mem, mapId);
    const ready = host.rendererReady();
    savedLine.style.display = save ? '' : 'none';
    if (save) savedLine.textContent = t('savedRun', { map: t('map_' + save.mapId), diff: t(save.difficulty === 'hard' ? 'hard' : 'normal'), n: savedNextWave(save) });
    const label = primary.querySelector('span:last-child') as HTMLElement;
    if (!ready) label.textContent = t('loading');
    else if (save) label.textContent = t('continueRun', { map: t('map_' + save.mapId), n: savedNextWave(save) });
    else if (!unlocked) label.textContent = t('lockedStars', { n: findMap(mapId).unlockStars });
    else label.textContent = `${t('startDefense')} · ${t('map_' + mapId)}`;
    primary.disabled = !ready || (!save && !unlocked);
    primary.classList.toggle('td-loading-btn', !ready);
    secondary.style.display = save ? '' : 'none';
    secondary.disabled = !ready || !unlocked;
    (secondary.querySelector('span:last-child') as HTMLElement).textContent = `${t('newRun')} · ${t('map_' + mapId)} · ${t(diff === 'hard' ? 'hard' : 'normal')}`;
    memBadge.textContent = t('memoryBadge', { stars: totalStars(mem), points: talentPoints(mem) });
    for (const q of ['auto', 'high', 'low'] as const) qBtns[q].classList.toggle('active', mem.prefs.quality === q);
  }

  // Carousel: the card nearest the centre becomes the selection once scrolling settles.
  let scrollTimer = 0;
  const onScroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = cards[0];
      let bd = Infinity;
      for (const c of cards) {
        const d = Math.abs(c.card.offsetLeft + c.card.offsetWidth / 2 - mid);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best.id !== mapId) {
        ctx.haptic('light');
        select(best.id, false);
      }
    }, 90);
  };
  track.addEventListener('scroll', onScroll, { passive: true });
  cleanups.push(() => {
    track.removeEventListener('scroll', onScroll);
    clearTimeout(scrollTimer);
  });

  // Redraw the mini maps when the card size changes (orientation / tablet).
  const ro = new ResizeObserver(() => {
    for (const c of cards) delete c.canvas.dataset.drawn;
    refresh();
  });
  ro.observe(track);
  cleanups.push(() => ro.disconnect());

  refresh();
  requestAnimationFrame(() => {
    const c = cards.find((x) => x.id === mapId);
    if (c && wrap.isConnected) track.scrollLeft = c.card.offsetLeft - (track.clientWidth - c.card.offsetWidth) / 2;
  });
  if (!host.rendererReady()) host.onRendererReady(() => wrap.isConnected && refresh());

  return () => {
    cleanups.forEach((f) => f());
    wrap.remove();
  };
}
