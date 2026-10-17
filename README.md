# Brain Arena · 脑力竞技场

一个为手机设计的 PWA 网页应用，内含 20 个面向成人的烧脑小游戏。纯本地运行、可离线、无广告，
支持中英双语切换、深色 / 浅色主题、合成音效和震动反馈。

A mobile-first PWA with 20 challenging mini games for adults. Fully offline, bilingual (中文 / English),
dark & light themes, synthesized sound effects and haptic feedback.

## 游戏清单 · Games

| 类别 | 游戏 | 亮点 |
| --- | --- | --- |
| 逻辑推理 | 杀手数独 Killer Sudoku | 笼子求和，三档难度，唯一解生成，笔记模式 |
| 逻辑推理 | 六角推理 Hex Logic | Hexcells 风格，纯逻辑无需猜测 |
| 逻辑推理 | 逻辑推理表 Logic Grid | 斑马谜题，线索随机生成且唯一解 |
| 逻辑推理 | 停车场逃脱 Parking Escape | Rush Hour 滑车，按最少步数分级 |
| 逻辑推理 | 倒水排序 Water Sort | 无限关卡，求解器保证可解 |
| 逻辑推理 | 激光镜面迷宫 Laser Maze | 摆镜子让激光命中所有目标，含分光镜 |
| 逻辑推理 | 旋转回路 Circuit Rotate | 转动管道接通全网，专家档边界环绕 |
| 逻辑推理 | 连桥 Bridges | Hashi 架桥谜题 |
| 牌桌游戏 | 空当接龙 FreeCell | 微软经典发牌算法，牌局编号可选 |
| 牌桌游戏 | 图形集合 Set Match | 经典 / 限时两种模式 |
| 牌桌游戏 | 麻将对对碰 Mahjong Solitaire | 三种布局，保证可解 |
| 动作物理 | 台球清台 Pool Clear | 真实物理，最少杆数清台 |
| 动作物理 | 免疫防线 Immune Front | 真 3D 免疫细胞塔防：8 种塔、英雄小白、4 个技能、4 张器官地图、疫苗记忆与天赋树 |
| 动作物理 | 六边形俄罗斯 Hex Stack | 旋转六边形接方块、三消连击 |
| 动作物理 | 登月着陆 Lunar Lander | 推进器与燃料物理，战役 + 无尽模式 |
| 动作物理 | 迷你高尔夫 Mini Golf | 18 洞物理推杆 |
| 动作物理 | 弹幕躲避 Bullet Dodge | 生存计时，阶段递进的弹幕 |
| 脑力训练 | 双重 N-back Dual N-Back | 工作记忆训练，自适应升级 |
| 脑力训练 | 数字倒数 Number Countdown | 6 个数四则运算凑目标，附最优解 |
| 脑力训练 | 珠玑妙算 Codebreaker | 破译颜色密码，可调位数 |

## 在手机上玩 · Play on a phone

用手机浏览器打开 https://whong199701-cyber.github.io/minigame/ ，在菜单里选择「添加到主屏幕」，即可像 App 一样
全屏运行，首次打开后可离线使用。

## 单文件版 · Single-file build

`npm run build:single` 会把整个应用打成一个独立的 HTML 文件（`dist-single/brain-arena.html`，约 720 KB），
所有游戏、样式和图标都内联在里面，不需要服务器和网络，直接用浏览器打开即可玩。单文件版没有离线缓存和
「添加到主屏幕」功能，这两项需要通过网址访问的 PWA 版本。

## 开发 · Develop

```bash
npm install
npm run dev        # http://localhost:5173 (also reachable from a phone on the same Wi-Fi)
npm run check      # typecheck + unit tests + production build
npm run smoke      # open every game in a mobile-emulated Chromium, check for errors, screenshots in .smoke/
```

See `docs/GAME_DEV_GUIDE.md` for how a game module is structured and `docs/briefs/` for each game's design brief.

## 部署 · Deploy

Pushing to the default branch runs `.github/workflows/deploy.yml`, which builds with `BASE_PATH=/<repo>/` and
publishes to GitHub Pages at https://whong199701-cyber.github.io/minigame/ . Pages must be enabled once in the
repository settings (Settings → Pages → Source: GitHub Actions).
