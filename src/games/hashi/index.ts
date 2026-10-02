import type { GameModule } from '../../app/types';
import { el } from '../../app/ui';

/** PLACEHOLDER — replaced by the real implementation of "hashi". */
const game: GameModule = {
  strings: {
    zh: { rules: '该游戏正在开发中。' },
    en: { rules: 'This game is under construction.' },
  },
  create(ctx) {
    ctx.root.append(el('div', { class: 'center muted', text: '🚧 ' + ctx.t('loading') }));
    return { destroy() {} };
  },
};

export default game;
