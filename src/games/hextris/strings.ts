import type { Strings } from '../../app/types';

/** All visible text for Hex Stack. zh and en must have identical key sets (checked by logic.test.ts). */
export const strings: Strings = {
  zh: {
    rules:
      '六边形在屏幕中央，彩色方块从六个方向向内落下，堆在它的边上。\n点击屏幕左半边逆时针旋转、右半边顺时针旋转（左右滑动也可以），让方块落到你想要的那条边。\n3 个及以上同色方块相连即消除（同一边上下相邻，或相邻边的同一层）：n 个方块得 10×n² 分。\n3 秒内连续消除会叠加连击倍率（每次 ×1.5，最高 ×7.6）；消除后上方方块下落，可能引发连锁。\n任意一边的堆叠超出外圈边界，游戏结束。\n速度和出块频率随时间与分数逐渐提高；困难模式有 5 种颜色且更快。',
    desc: '旋转中央六边形接住落下的方块，三个同色相连即消除。速度越来越快，别让任何一边溢出。',
    easyDesc: '4 种颜色 · 节奏舒缓 · 适合热身',
    mediumDesc: '4 种颜色 · 标准速度',
    hardDesc: '5 种颜色 · 更快 · 高手挑战',
    bestLine: '最佳：{n} 分',
    noBest: '尚无纪录',
    controlsHint: '◀ 点左半边逆时针 · 点右半边顺时针 ▶',
    tapToResume: '点击屏幕继续',
    combo: '连击 {n}',
    levelUp: '第 {n} 级',
    finalScore: '得分 {n}',
    reached: '第 {n} 级 · {t}',
    modes: '换难度',
    overflow: '堆叠溢出！',
  },
  en: {
    rules:
      'A hexagon sits in the centre. Coloured blocks fall inward from six directions and stack on its sides.\nTap the LEFT half of the screen to spin counter-clockwise, the RIGHT half to spin clockwise (swipes work too), so each block lands where you want it.\n3 or more same-colour blocks touching clear (stacked on one side, or on neighbouring sides at the same level): n blocks score 10×n².\nClears within 3 s of each other build a combo (×1.5 each, up to ×7.6); blocks above a clear drop down and can trigger chains.\nThe game ends when any side stacks past the outer ring.\nSpeed and spawn rate rise with time and score; Hard uses 5 colours and is faster.',
    desc: 'Spin the hexagon to catch falling blocks; three of a colour touching clear. It only gets faster — never let a side overflow.',
    easyDesc: '4 colours · relaxed pace · warm-up',
    mediumDesc: '4 colours · standard speed',
    hardDesc: '5 colours · faster · expert',
    bestLine: 'Best: {n}',
    noBest: 'No record yet',
    controlsHint: '◀ tap left: counter-clockwise · tap right: clockwise ▶',
    tapToResume: 'Tap to resume',
    combo: 'Combo {n}',
    levelUp: 'Level {n}',
    finalScore: 'Score {n}',
    reached: 'Level {n} · {t}',
    modes: 'Modes',
    overflow: 'Overflow!',
  },
};
