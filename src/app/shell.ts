import type { GameContext, GameInstance, GameMeta, HeaderAction, ThemeName } from './types';
import { games, categories, findGame } from './registry';
import { common, getLang, makeT, onLangChange, setLang, t } from './i18n';
import { getTheme, getThemePref, onThemeChange, setThemePref, cssVar, type ThemePref } from './theme';
import { isSoundEnabled, playSound, setSoundEnabled, unlockAudio } from './audio';
import { isHapticsEnabled, isHapticsSupported, setHapticsEnabled, vibrate } from './haptics';
import { createGameStorage, clearAllData, getPlays, incrementPlays } from './storage';
import { el, button, segmented, toggle, showModal, toast, closeAllModals } from './ui';
import { setIcon } from './icons';

const APP_VERSION = '1.0.0';

let app: HTMLElement;
let current: { meta: GameMeta; instance: GameInstance; cleanups: (() => void)[] } | null = null;

export function startApp(container: HTMLElement): void {
  app = container;
  window.addEventListener('hashchange', route);
  onLangChange(() => route());
  document.addEventListener('visibilitychange', () => {
    if (!current) return;
    const visible = document.visibilityState === 'visible';
    visibilityListeners.forEach((fn) => fn(visible));
  });
  const unlock = () => unlockAudio();
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  route();
}

function route(): void {
  const hash = location.hash.replace(/^#\/?/, '');
  const [section, id] = hash.split('/');
  closeAllModals();
  if (section === 'game' && id) {
    void renderGame(id);
  } else {
    renderHome();
  }
}

function teardown(): void {
  if (!current) return;
  const { instance, cleanups } = current;
  current = null;
  visibilityListeners.clear();
  themeListeners.forEach((off) => off());
  themeListeners.length = 0;
  try {
    instance.destroy();
  } catch (e) {
    console.error(e);
  }
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });
}

const visibilityListeners = new Set<(visible: boolean) => void>();
const themeListeners: (() => void)[] = [];

// ── Home ──────────────────────────────────────────────────────────────────

function renderHome(): void {
  teardown();
  document.title = `${t('appName')} · ${t('appTagline')}`;
  app.innerHTML = '';
  app.className = 'home';

  const header = el(
    'header',
    { class: 'app-header' },
    el('div', { class: 'brand' }, el('span', { class: 'brand-icon', text: '🎮' }), el('div', {}, el('h1', { text: t('appName') }), el('p', { class: 'muted', text: t('appTagline') }))),
    el('button', { class: 'icon-btn', 'aria-label': t('settings'), text: '⚙️', onClick: openSettings }),
  );
  app.append(header);

  const main = el('main', { class: 'home-main' });
  for (const cat of categories) {
    const list = games.filter((g) => g.category === cat.id);
    const section = el('section', { class: 'cat' }, el('h2', { class: 'cat-title', text: t(cat.labelKey) }));
    const grid = el('div', { class: 'grid' });
    for (const g of list) {
      const plays = getPlays(g.id);
      const card = el(
        'a',
        { class: 'card', href: `#/game/${g.id}` },
        el('div', { class: 'card-icon', text: g.icon }),
        el('div', { class: 'card-body' }, el('div', { class: 'card-name', text: g.name[getLang()] }), el('div', { class: 'card-tag', text: g.tagline[getLang()] })),
        plays > 0 ? el('div', { class: 'card-plays', text: `▶ ${plays}` }) : null,
      );
      card.addEventListener('click', () => {
        playSound('tap');
        vibrate('light');
      });
      grid.append(card);
    }
    section.append(grid);
    main.append(section);
  }
  main.append(el('footer', { class: 'home-footer muted', text: `${t('appName')} v${APP_VERSION}` }));
  app.append(main);
}

function openSettings(): void {
  playSound('tap');
  const body = el('div', { class: 'settings' });
  body.append(
    el('div', { class: 'row' }, el('span', { text: t('language') }), segmented<'zh' | 'en'>([{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }], getLang(), (v) => {
      setLang(v);
      handle.close();
      openSettings();
    })),
  );
  body.append(
    el(
      'div',
      { class: 'row' },
      el('span', { text: t('theme') }),
      segmented<ThemePref>(
        [
          { value: 'system', label: t('system') },
          { value: 'dark', label: t('dark') },
          { value: 'light', label: t('light') },
        ],
        getThemePref(),
        (v) => setThemePref(v),
      ),
    ),
  );
  body.append(toggle(t('sound'), isSoundEnabled(), (v) => setSoundEnabled(v)));
  if (isHapticsSupported()) body.append(toggle(t('haptics'), isHapticsEnabled(), (v) => setHapticsEnabled(v)));
  body.append(el('p', { class: 'muted small', text: t('installHint') }));
  body.append(el('p', { class: 'muted small', text: t('aboutText') }));
  body.append(
    button(
      t('resetData'),
      () => {
        showModal({
          title: t('resetData'),
          body: t('resetDataConfirm'),
          buttons: [
            { label: t('cancel') },
            {
              label: t('confirm'),
              primary: true,
              onClick: () => {
                clearAllData();
                toast(t('dataCleared'));
                handle.close();
                renderHome();
              },
            },
          ],
        });
      },
      { variant: 'danger', size: 'sm' },
    ),
  );
  const handle = showModal({ title: t('settings'), body, buttons: [{ label: t('close'), primary: true }] });
}

// ── Game page ─────────────────────────────────────────────────────────────

async function renderGame(id: string): Promise<void> {
  teardown();
  const meta = findGame(id);
  app.innerHTML = '';
  app.className = 'game-page';
  if (!meta) {
    app.append(el('div', { class: 'center muted', text: t('gameNotFound') }), button(t('home'), () => (location.hash = '#/'), { variant: 'primary' }));
    return;
  }
  const lang = getLang();
  document.title = `${meta.name[lang]} · ${t('appName')}`;

  const status = el('div', { class: 'game-status muted' });
  const actions = el('div', { class: 'header-actions' });
  const rulesBtn = el('button', { class: 'icon-btn rules-btn', 'aria-label': t('rules'), text: '?' });
  const backBtn = el('button', { class: 'icon-btn back', 'aria-label': t('back'), onClick: () => (location.hash = '#/') });
  setIcon(backBtn, 'back');
  const header = el(
    'header',
    { class: 'app-header game-header' },
    backBtn,
    el('div', { class: 'game-title' }, el('h1', { text: meta.name[lang] }), status),
    actions,
    rulesBtn,
  );
  const root = el('div', { class: 'game-root', dataset: { game: id } });
  app.append(header, root);
  root.append(el('div', { class: 'center muted', text: t('loading') }));

  let mod: Awaited<ReturnType<GameMeta['load']>>;
  try {
    mod = await meta.load();
  } catch (e) {
    console.error(e);
    root.innerHTML = '';
    root.append(el('div', { class: 'center muted', text: String(e) }));
    return;
  }
  // Route may have changed while loading.
  if (location.hash !== `#/game/${id}`) return;
  root.innerHTML = '';

  const gameT = makeT(mod.default.strings);
  const storage = createGameStorage(id);
  const cleanups: (() => void)[] = [];

  const ctx: GameContext = {
    root,
    lang,
    theme: getTheme(),
    t: gameT,
    play: playSound,
    haptic: vibrate,
    storage,
    showModal,
    toast,
    onDestroy: (fn) => cleanups.push(fn),
    onThemeChange: (fn: (theme: ThemeName) => void) => {
      themeListeners.push(onThemeChange(fn));
    },
    onVisibility: (fn) => {
      visibilityListeners.add(fn);
    },
    setStatus: (text) => {
      status.textContent = text;
    },
    addHeaderAction: (action: HeaderAction) => {
      const b = el('button', { class: 'icon-btn', 'aria-label': action.label, title: action.label });
      setIcon(b, action.icon);
      b.addEventListener('click', () => {
        playSound('tap');
        vibrate('light');
        action.onClick();
      });
      actions.append(b);
      return () => b.remove();
    },
    cssVar,
    exit: () => {
      location.hash = '#/';
    },
  };

  const showRules = (onClose?: () => void) => {
    showModal({ title: `${meta.name[lang]} · ${t('howToPlay')}`, body: gameT('rules'), buttons: [{ label: t('ok'), primary: true }], onClose });
  };
  rulesBtn.addEventListener('click', () => {
    playSound('tap');
    // Real-time games pause when they are told they are hidden. Signal that before the rules sheet opens so a
    // game's own pause UI ends up underneath the rules, and signal visible again once the sheet closes.
    const active = current;
    if (active) visibilityListeners.forEach((fn) => fn(false));
    showRules(() => {
      if (active && current === active && document.visibilityState === 'visible') visibilityListeners.forEach((fn) => fn(true));
    });
  });

  let instance: GameInstance;
  try {
    instance = mod.default.create(ctx);
  } catch (e) {
    console.error(e);
    root.append(el('div', { class: 'center muted', text: String(e) }));
    return;
  }
  current = { meta, instance, cleanups };
  incrementPlays(id);
  root.dataset.ready = '1';

  if (!storage.get('seenRules', false)) {
    storage.set('seenRules', true);
    showRules();
  }
}

// Expose for debugging in dev tools.
(window as unknown as { __ba?: unknown }).__ba = { games, common };
