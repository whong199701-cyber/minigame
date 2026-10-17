/**
 * Immune memory screen (§10): the 「抗体谱」 talent tree (4 tiers with connector lines, buy / respec) and the three
 * vaccine cards (earned / unearned).
 */
import type { GameContext } from '../../../app/types';
import { el, button } from '../../../app/ui';
import { BOSS_IDS, TALENT_IDS, type BossId, type ImmuneMemory, type TalentId } from '../types';
import { TALENTS, VACCINE_COVERS, buyTalent, respec, talentPoints, talentView, totalStars } from '../logic';
import { BOSS_ICON, ENEMY_ICON, fmtDate, nodes as kids, type T } from './format';

export interface MemoryHost {
  ctx: GameContext;
  t: T;
  memory(): ImmuneMemory;
  setMemory(m: ImmuneMemory): void;
  back(): void;
}

const TALENT_ICON: Record<TalentId, string> = {
  affinity: '🗡️',
  reserve: '🔋',
  platelets: '🧱',
  toughBlanc: '💪',
  maturation: '⚔️',
  metabolism: '♻️',
  cytokines: '⏱️',
  sharpBlanc: '👁️',
  tissueRepair: '❤️‍🩹',
  deepReserve: '🔋',
  rapidResponse: '🏃',
  booster: '💉',
};

export function renderMemory(root: HTMLElement, host: MemoryHost, tab: 'talents' | 'vaccines' = 'talents'): () => void {
  const { t, ctx } = host;
  let current = tab;
  let selected: TalentId | null = null;
  const wrap = el('div', { class: 'td-mem' });
  const starsEl = el('span', { class: 'td-mem-stars' });
  const head = el(
    'div',
    { class: 'td-mem-head' },
    button(t('back'), () => host.back(), { variant: 'ghost', size: 'sm', icon: '‹', class: 'td-mem-back' }),
    el('h2', { text: t('memoryTitle') }),
    starsEl,
  );
  const tabT = el('button', { class: 'seg', type: 'button', text: t('tabTalents') });
  const tabV = el('button', { class: 'seg', type: 'button', text: t('tabVaccines') });
  const tabs = el('div', { class: 'segmented td-mem-tabs' }, tabT, tabV);
  const body = el('div', { class: 'td-mem-body' });
  wrap.append(head, tabs, body);
  root.append(wrap);

  tabT.addEventListener('click', () => switchTab('talents'));
  tabV.addEventListener('click', () => switchTab('vaccines'));

  let ro: ResizeObserver | null = null;

  function switchTab(next: 'talents' | 'vaccines'): void {
    if (next === current) return;
    ctx.play('tap');
    current = next;
    render();
  }

  function render(): void {
    const mem = host.memory();
    starsEl.textContent = t('starsTotal', { n: totalStars(mem) });
    tabT.classList.toggle('active', current === 'talents');
    tabV.classList.toggle('active', current === 'vaccines');
    ro?.disconnect();
    ro = null;
    body.innerHTML = '';
    if (current === 'talents') renderTalents(mem);
    else renderVaccines(mem);
  }

  function renderTalents(mem: ImmuneMemory): void {
    const pts = talentPoints(mem);
    const respecBtn = button(t('respec'), () => {
      ctx.showModal({
        title: t('respec'),
        body: t('respecConfirm'),
        buttons: [
          { label: t('cancel') },
          {
            label: t('confirm'),
            primary: true,
            onClick: () => {
              host.setMemory(respec(host.memory()));
              ctx.toast(t('respecDone'));
              selected = null;
              render();
            },
          },
        ],
      });
    }, { variant: 'secondary', size: 'sm', class: 'td-respec' });
    respecBtn.disabled = mem.talents.length === 0;
    body.append(el('div', { class: 'td-points' }, el('span', { class: 'td-points-n', text: t('pointsAvail', { n: pts }) }), respecBtn));
    const tree = el('div', { class: 'td-tree' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'td-tree-lines');
    tree.append(svg);
    const views = talentView(mem);
    const nodes = new Map<TalentId, HTMLElement>();
    for (let tier = 1; tier <= 4; tier++) {
      const row = el('div', { class: 'td-tier' }, el('div', { class: 'td-tier-label', text: t('tierN', { n: tier }) }));
      const list = el('div', { class: 'td-tier-nodes' });
      for (const v of views.filter((x) => x.def.tier === tier)) {
        const node = el(
          'button',
          { class: `td-node ${v.state}${selected === v.id ? ' sel' : ''}`, type: 'button', dataset: { talent: v.id } },
          el('span', { class: 'td-node-icon', text: TALENT_ICON[v.id] }),
          el('span', { class: 'td-node-name', text: t('talent_' + v.id) }),
          el('span', { class: 'td-node-cost', text: v.state === 'bought' ? '✓' : `★${v.def.cost}` }),
        );
        node.addEventListener('click', () => {
          ctx.play('tap');
          selected = v.id;
          render();
        });
        nodes.set(v.id, node);
        list.append(node);
      }
      row.append(list);
      tree.append(row);
    }
    body.append(tree);
    // detail
    const detail = el('div', { class: 'td-node-detail' });
    if (selected) {
      const v = views.find((x) => x.id === selected)!;
      const def = TALENTS[v.id];
      const req: string[] = [];
      if (def.requiresAny.length) req.push(t('requiresAny', { list: def.requiresAny.map((r) => t('talent_' + r)).join(t('orWord')) }));
      if (def.requiresCount) req.push(t('requiresCount', { n: def.requiresCount }));
      const buy = button(
        v.state === 'bought' ? t('stateBought') : t('buyFor', { n: def.cost }),
        () => {
          const next = buyTalent(host.memory(), v.id);
          if (!next) {
            ctx.play('error');
            ctx.haptic('error');
            return;
          }
          host.setMemory(next);
          ctx.play('success');
          ctx.haptic('success');
          ctx.toast(t('talentBought', { name: t('talent_' + v.id) }));
          render();
        },
        { variant: v.state === 'available' ? 'primary' : 'secondary', size: 'md' },
      );
      buy.disabled = v.state !== 'available';
      detail.append(
        ...kids(
          el('div', { class: 'td-node-title' }, el('span', { text: TALENT_ICON[v.id] + ' ' + t('talent_' + v.id) }), el('span', { class: 'muted small', text: `★${def.cost}` })),
          el('p', { text: t('talentDesc_' + v.id) }),
          req.length ? el('p', { class: 'muted small', text: req.join(' ') }) : null,
          v.state === 'locked' ? el('p', { class: 'small td-warn', text: t('stateLocked') }) : null,
          v.state === 'unaffordable' ? el('p', { class: 'small td-warn', text: t('stateUnaffordable') }) : null,
          buy,
        ),
      );
    } else {
      detail.append(el('p', { class: 'muted small', text: t('tapNodeHint') }));
    }
    body.append(detail);
    // connector lines (prerequisite → dependent), redrawn on resize
    const draw = () => {
      if (!tree.isConnected) return;
      const box = tree.getBoundingClientRect();
      svg.setAttribute('width', String(box.width));
      svg.setAttribute('height', String(box.height));
      svg.innerHTML = '';
      for (const id of TALENT_IDS) {
        const to = nodes.get(id);
        if (!to) continue;
        for (const pre of TALENTS[id].requiresAny) {
          const from = nodes.get(pre);
          if (!from) continue;
          const a = from.getBoundingClientRect();
          const b = to.getBoundingClientRect();
          const x1 = a.left + a.width / 2 - box.left;
          const y1 = a.bottom - box.top;
          const x2 = b.left + b.width / 2 - box.left;
          const y2 = b.top - box.top;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const my = (y1 + y2) / 2;
          path.setAttribute('d', `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`);
          const on = mem.talents.includes(pre);
          path.setAttribute('class', on ? 'on' : '');
          svg.append(path);
        }
      }
    };
    ro = new ResizeObserver(draw);
    ro.observe(tree);
    requestAnimationFrame(draw);
  }

  function renderVaccines(mem: ImmuneMemory): void {
    body.append(el('p', { class: 'muted small td-vac-hint', text: t('vaccineHint') }));
    const grid = el('div', { class: 'td-vacs' });
    for (const b of BOSS_IDS) grid.append(vaccineCard(mem, b));
    body.append(grid);
  }

  function vaccineCard(mem: ImmuneMemory, b: BossId): HTMLElement {
    const has = mem.vaccines[b];
    const date = mem.vaccineDates[b];
    const covers = VACCINE_COVERS[b].map((e) => `${ENEMY_ICON[e]} ${t('enemy_' + e)}`).join('、');
    return el(
      'div',
      { class: `td-vac${has ? ' earned' : ''}`, dataset: { boss: b } },
      el('div', { class: 'td-vac-art', text: BOSS_ICON[b] }),
      el(
        'div',
        { class: 'td-vac-info' },
        el('div', { class: 'td-vac-name', text: t('vaccine_' + b) }),
        el('div', { class: 'small', text: t('vaccineCovers', { list: covers }) }),
        el('div', { class: 'small td-vac-state', text: has ? t('vaccineEarned', { date: date ? fmtDate(date, ctx.lang) : '' }) : t('vaccineMissing', { boss: t('enemy_' + b) }) }),
      ),
    );
  }

  render();
  return () => {
    ro?.disconnect();
    wrap.remove();
  };
}
