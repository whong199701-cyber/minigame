import type { Category, GameMeta } from './types';

export const categories: { id: Category; labelKey: string }[] = [
  { id: 'logic', labelKey: 'catLogic' },
  { id: 'table', labelKey: 'catTable' },
  { id: 'action', labelKey: 'catAction' },
  { id: 'brain', labelKey: 'catBrain' },
];

export const games: GameMeta[] = [
  // ── Logic ────────────────────────────────────────────────────────────
  {
    id: 'killer-sudoku',
    category: 'logic',
    icon: '🧮',
    name: { zh: '杀手数独', en: 'Killer Sudoku' },
    tagline: { zh: '笼子求和，比普通数独更烧脑', en: 'Cages that sum — sudoku, harder' },
    load: () => import('../games/killer-sudoku/index'),
  },
  {
    id: 'hexcells',
    category: 'logic',
    icon: '🔶',
    name: { zh: '六角推理', en: 'Hex Logic' },
    tagline: { zh: '纯逻辑六边形排雷，无需猜测', en: 'Pure-logic hex minefield, no guessing' },
    load: () => import('../games/hexcells/index'),
  },
  {
    id: 'zebra',
    category: 'logic',
    icon: '🦓',
    name: { zh: '逻辑推理表', en: 'Logic Grid' },
    tagline: { zh: '谁住哪、养什么？线索随机生成', en: 'Who lives where? Random clue sets' },
    load: () => import('../games/zebra/index'),
  },
  {
    id: 'rush-hour',
    category: 'logic',
    icon: '🚗',
    name: { zh: '停车场逃脱', en: 'Parking Escape' },
    tagline: { zh: '滑动车辆，让红车驶出', en: 'Slide the cars, free the red one' },
    load: () => import('../games/rush-hour/index'),
  },
  {
    id: 'water-sort',
    category: 'logic',
    icon: '🧪',
    name: { zh: '倒水排序', en: 'Water Sort' },
    tagline: { zh: '把每种颜色倒进同一个试管', en: 'Sort every colour into its own tube' },
    load: () => import('../games/water-sort/index'),
  },
  {
    id: 'laser-maze',
    category: 'logic',
    icon: '🔦',
    name: { zh: '激光镜面迷宫', en: 'Laser Maze' },
    tagline: { zh: '摆放镜子，让激光命中所有目标', en: 'Place mirrors to hit every target' },
    load: () => import('../games/laser-maze/index'),
  },
  {
    id: 'netwalk',
    category: 'logic',
    icon: '🔌',
    name: { zh: '旋转回路', en: 'Circuit Rotate' },
    tagline: { zh: '转动管道，接通整张网络', en: 'Rotate tiles to power the whole grid' },
    load: () => import('../games/netwalk/index'),
  },
  {
    id: 'hashi',
    category: 'logic',
    icon: '🌉',
    name: { zh: '连桥', en: 'Bridges' },
    tagline: { zh: '按数字在岛屿间架桥', en: 'Connect islands with the right bridges' },
    load: () => import('../games/hashi/index'),
  },
  // ── Table ────────────────────────────────────────────────────────────
  {
    id: 'freecell',
    category: 'table',
    icon: '🃏',
    name: { zh: '空当接龙', en: 'FreeCell' },
    tagline: { zh: '每一局都保证可解', en: 'Every deal is solvable' },
    load: () => import('../games/freecell/index'),
  },
  {
    id: 'set-game',
    category: 'table',
    icon: '🔷',
    name: { zh: '图形集合', en: 'Set Match' },
    tagline: { zh: '找出属性全同或全异的三张牌', en: 'Find three cards all-same or all-different' },
    load: () => import('../games/set-game/index'),
  },
  {
    id: 'mahjong',
    category: 'table',
    icon: '🀄',
    name: { zh: '麻将对对碰', en: 'Mahjong Solitaire' },
    tagline: { zh: '配对拆塔，保证可解', en: 'Pair the tiles, always solvable' },
    load: () => import('../games/mahjong/index'),
  },
  // ── Action ───────────────────────────────────────────────────────────
  {
    id: 'pool',
    category: 'action',
    icon: '🎱',
    name: { zh: '台球清台', en: 'Pool Clear' },
    tagline: { zh: '真实物理，最少杆数清台', en: 'Real physics, clear the table in fewest shots' },
    load: () => import('../games/pool/index'),
  },
  {
    id: 'tower-defense',
    category: 'action',
    icon: '🏰',
    name: { zh: '迷你塔防', en: 'Mini Tower Defense' },
    tagline: { zh: '多地图、多波次、多塔种', en: 'Maps, waves and tower types' },
    load: () => import('../games/tower-defense/index'),
  },
  {
    id: 'hextris',
    category: 'action',
    icon: '⬢',
    name: { zh: '六边形俄罗斯', en: 'Hex Stack' },
    tagline: { zh: '旋转六边形接住方块', en: 'Spin the hexagon, catch the blocks' },
    load: () => import('../games/hextris/index'),
  },
  {
    id: 'lunar-lander',
    category: 'action',
    icon: '🚀',
    name: { zh: '登月着陆', en: 'Lunar Lander' },
    tagline: { zh: '控制推进器，软着陆', en: 'Manage thrust and fuel, land softly' },
    load: () => import('../games/lunar-lander/index'),
  },
  {
    id: 'mini-golf',
    category: 'action',
    icon: '⛳',
    name: { zh: '迷你高尔夫', en: 'Mini Golf' },
    tagline: { zh: '18 洞物理推杆', en: '18 holes of physics putting' },
    load: () => import('../games/mini-golf/index'),
  },
  {
    id: 'bullet-dodge',
    category: 'action',
    icon: '💫',
    name: { zh: '弹幕躲避', en: 'Bullet Dodge' },
    tagline: { zh: '在弹幕中生存多久？', en: 'How long can you survive?' },
    load: () => import('../games/bullet-dodge/index'),
  },
  // ── Brain ────────────────────────────────────────────────────────────
  {
    id: 'nback',
    category: 'brain',
    icon: '🧠',
    name: { zh: '双重 N-back', en: 'Dual N-Back' },
    tagline: { zh: '工作记忆训练，可升级', en: 'Working-memory training that levels up' },
    load: () => import('../games/nback/index'),
  },
  {
    id: 'countdown',
    category: 'brain',
    icon: '🔢',
    name: { zh: '数字倒数', en: 'Number Countdown' },
    tagline: { zh: '6 个数四则运算凑目标', en: 'Six numbers, four operations, one target' },
    load: () => import('../games/countdown/index'),
  },
  {
    id: 'mastermind',
    category: 'brain',
    icon: '🎯',
    name: { zh: '珠玑妙算', en: 'Codebreaker' },
    tagline: { zh: '破译颜色密码，可调位数', en: 'Crack the colour code, adjustable length' },
    load: () => import('../games/mastermind/index'),
  },
];

export function findGame(id: string): GameMeta | undefined {
  return games.find((g) => g.id === id);
}
