/** Shared contracts between the shell and every game module. */

export type Lang = 'zh' | 'en';
export type ThemeName = 'dark' | 'light';
export type Category = 'logic' | 'table' | 'action' | 'brain';

export type SoundName =
  | 'tap' // light UI click
  | 'move' // piece / tile moved
  | 'place' // something placed / locked in
  | 'pop' // something removed / cleared
  | 'success' // small positive feedback
  | 'error' // invalid action
  | 'win' // level / game won fanfare
  | 'lose' // game over
  | 'tick' // timer tick / countdown
  | 'swoosh' // fast movement
  | 'explosion' // destruction
  | 'coin' // reward
  | 'shoot'; // projectile

export type HapticName = 'light' | 'medium' | 'heavy' | 'success' | 'error';

export type Dict = Record<string, string>;
export interface Strings {
  zh: Dict;
  en: Dict;
}

export interface GameStorage {
  /** Read a JSON value scoped to this game. */
  get<T>(key: string, fallback: T): T;
  /** Write a JSON value scoped to this game. */
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  /**
   * Record a result for a mode (e.g. 'easy', 'classic'). Returns true when it beats the stored best.
   * `better` decides direction: 'higher' for scores, 'lower' for times / move counts.
   */
  recordBest(mode: string, value: number, better?: 'higher' | 'lower'): boolean;
  getBest(mode: string): number | null;
}

export interface ModalButton {
  label: string;
  primary?: boolean;
  onClick?: () => void;
}

export interface ModalOptions {
  title?: string;
  /** Plain text (newlines allowed) or a DOM element. */
  body?: string | HTMLElement;
  buttons?: ModalButton[];
  /** Tap outside / back closes it. Default true. */
  dismissible?: boolean;
}

export interface ModalHandle {
  close(): void;
}

export interface HeaderAction {
  /** Short glyph / emoji shown in the header button. */
  icon: string;
  /** Accessible label. */
  label: string;
  onClick: () => void;
}

export interface GameContext {
  /** The game area. Fills the viewport under the header; flex column; position: relative. */
  readonly root: HTMLElement;
  readonly lang: Lang;
  /** Current theme at creation time; subscribe with onThemeChange for updates. */
  readonly theme: ThemeName;
  /** Translate a key from the game's own strings, falling back to the common dictionary. */
  t(key: string, params?: Record<string, string | number>): string;
  /** Play a synthesized sound (respects the user's sound setting). */
  play(sound: SoundName): void;
  /** Vibrate (respects the user's haptics setting; no-op where unsupported). */
  haptic(kind?: HapticName): void;
  storage: GameStorage;
  showModal(opts: ModalOptions): ModalHandle;
  toast(message: string, ms?: number): void;
  /** Register cleanup to run when the game is destroyed (timers, listeners, observers). */
  onDestroy(fn: () => void): void;
  /** Subscribe to theme changes (redraw canvases). */
  onThemeChange(fn: (theme: ThemeName) => void): void;
  /** Called by the shell when the page is hidden / shown. Games with loops should pause. */
  onVisibility(fn: (visible: boolean) => void): void;
  /** Short status text shown in the header under the title (e.g. "Level 3 · 00:42"). */
  setStatus(text: string): void;
  /** Add a header button (e.g. restart, undo). Returns a function that removes it. */
  addHeaderAction(action: HeaderAction): () => void;
  /** Read a CSS custom property from the current theme, e.g. cssVar('--accent'). */
  cssVar(name: string): string;
  /** Navigate back to the home screen. */
  exit(): void;
}

export interface GameInstance {
  destroy(): void;
}

export interface GameModule {
  /** Must include at least `rules` (multi-line text shown in the rules modal). */
  strings: Strings;
  create(ctx: GameContext): GameInstance;
}

export interface GameMeta {
  id: string;
  category: Category;
  /** Emoji used as the card icon. */
  icon: string;
  name: { zh: string; en: string };
  tagline: { zh: string; en: string };
  load: () => Promise<{ default: GameModule }>;
}
