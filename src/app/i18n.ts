import type { Dict, Lang, Strings } from './types';
import { getSetting, setSetting } from './storage';

export const common: Strings = {
  zh: {
    appName: '脑力竞技场',
    appTagline: '20 个烧脑小游戏',
    back: '返回',
    rules: '规则',
    howToPlay: '玩法说明',
    close: '关闭',
    ok: '好的',
    newGame: '新游戏',
    restart: '重新开始',
    continue: '继续',
    retry: '再试一次',
    play: '开始',
    pause: '暂停',
    resume: '继续',
    paused: '已暂停',
    undo: '撤销',
    hint: '提示',
    next: '下一关',
    nextLevel: '下一关',
    home: '首页',
    confirm: '确认',
    cancel: '取消',
    best: '最佳',
    score: '分数',
    time: '时间',
    moves: '步数',
    level: '关卡',
    round: '回合',
    lives: '生命',
    wave: '波次',
    difficulty: '难度',
    easy: '简单',
    medium: '中等',
    hard: '困难',
    expert: '专家',
    win: '你赢了！',
    lose: '游戏结束',
    draw: '平局',
    levelComplete: '过关！',
    newBest: '新纪录！',
    settings: '设置',
    language: '语言',
    theme: '主题',
    dark: '深色',
    light: '浅色',
    system: '跟随系统',
    sound: '音效',
    haptics: '震动反馈',
    on: '开',
    off: '关',
    resetData: '清除所有记录',
    resetDataConfirm: '确定要清除所有游戏记录和设置吗？此操作不可撤销。',
    dataCleared: '已清除',
    catLogic: '逻辑推理',
    catTable: '牌桌游戏',
    catAction: '动作物理',
    catBrain: '脑力训练',
    played: '已玩',
    times: '次',
    seconds: '秒',
    tapToStart: '点击开始',
    swipeHint: '滑动操作',
    loading: '加载中…',
    gameNotFound: '未找到该游戏',
    about: '关于',
    aboutText: '脑力竞技场：20 个为成人设计的烧脑小游戏。纯本地运行，无广告，无需联网。',
    version: '版本',
    install: '添加到主屏幕',
    installHint: '在浏览器菜单中选择「添加到主屏幕」即可像 App 一样全屏运行。',
    yourScore: '本局',
    bestScore: '最佳',
    chooseDifficulty: '选择难度',
    congratulations: '恭喜！',
    tryAgain: '再接再厉',
    stats: '统计',
    quit: '退出',
    quitConfirm: '当前进度将丢失，确定退出？',
    yes: '是',
    no: '否',
  },
  en: {
    appName: 'Brain Arena',
    appTagline: '20 challenging mini games',
    back: 'Back',
    rules: 'Rules',
    howToPlay: 'How to play',
    close: 'Close',
    ok: 'OK',
    newGame: 'New game',
    restart: 'Restart',
    continue: 'Continue',
    retry: 'Try again',
    play: 'Play',
    pause: 'Pause',
    resume: 'Resume',
    paused: 'Paused',
    undo: 'Undo',
    hint: 'Hint',
    next: 'Next',
    nextLevel: 'Next level',
    home: 'Home',
    confirm: 'Confirm',
    cancel: 'Cancel',
    best: 'Best',
    score: 'Score',
    time: 'Time',
    moves: 'Moves',
    level: 'Level',
    round: 'Round',
    lives: 'Lives',
    wave: 'Wave',
    difficulty: 'Difficulty',
    easy: 'Easy',
    medium: 'Medium',
    hard: 'Hard',
    expert: 'Expert',
    win: 'You win!',
    lose: 'Game over',
    draw: 'Draw',
    levelComplete: 'Level complete!',
    newBest: 'New best!',
    settings: 'Settings',
    language: 'Language',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light',
    system: 'System',
    sound: 'Sound',
    haptics: 'Vibration',
    on: 'On',
    off: 'Off',
    resetData: 'Clear all data',
    resetDataConfirm: 'Clear all game records and settings? This cannot be undone.',
    dataCleared: 'Cleared',
    catLogic: 'Logic',
    catTable: 'Table games',
    catAction: 'Action & physics',
    catBrain: 'Brain training',
    played: 'Played',
    times: 'x',
    seconds: 's',
    tapToStart: 'Tap to start',
    swipeHint: 'Swipe to play',
    loading: 'Loading…',
    gameNotFound: 'Game not found',
    about: 'About',
    aboutText: 'Brain Arena: 20 challenging mini games designed for adults. Runs fully offline, no ads, no account.',
    version: 'Version',
    install: 'Add to home screen',
    installHint: 'Use your browser menu → "Add to Home Screen" to run it full-screen like an app.',
    yourScore: 'This round',
    bestScore: 'Best',
    chooseDifficulty: 'Choose difficulty',
    congratulations: 'Congratulations!',
    tryAgain: 'Keep going',
    stats: 'Stats',
    quit: 'Quit',
    quitConfirm: 'Current progress will be lost. Quit?',
    yes: 'Yes',
    no: 'No',
  },
};

let currentLang: Lang = detectLang();
const listeners = new Set<(l: Lang) => void>();

function detectLang(): Lang {
  const saved = getSetting<Lang | null>('lang', null);
  if (saved === 'zh' || saved === 'en') return saved;
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('zh') ? 'zh' : 'en';
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  setSetting('lang', lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  listeners.forEach((fn) => fn(lang));
}

export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Build a translator that checks `extra` first, then the common dictionary. */
export function makeT(extra?: Strings): (key: string, params?: Record<string, string | number>) => string {
  return (key, params) => {
    const lang = currentLang;
    const dict: Dict | undefined = extra?.[lang];
    const text = dict?.[key] ?? common[lang][key] ?? extra?.en?.[key] ?? common.en[key] ?? key;
    return interpolate(text, params);
  };
}

export const t = makeT();

document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
