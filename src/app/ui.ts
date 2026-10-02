import type { ModalHandle, ModalOptions } from './types';
import { playSound } from './audio';
import { vibrate } from './haptics';

type Child = Node | string | null | undefined | false;

/** Tiny DOM builder: el('div', { class: 'x', onClick: fn }, 'text', otherEl). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v as Record<string, string>);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v as Record<string, string>);
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function button(
  label: string,
  onClick: () => void,
  opts: { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; icon?: string; class?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const b = el(
    'button',
    {
      class: `btn btn-${opts.variant ?? 'secondary'} btn-${opts.size ?? 'md'} ${opts.class ?? ''}`,
      type: 'button',
    },
    opts.icon ? el('span', { class: 'btn-icon', text: opts.icon }) : null,
    el('span', { text: label }),
  );
  if (opts.disabled) b.disabled = true;
  b.addEventListener('click', () => {
    if (b.disabled) return;
    playSound('tap');
    vibrate('light');
    onClick();
  });
  return b;
}

/** Segmented control (e.g. difficulty picker). */
export function segmented<T extends string>(
  options: { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void,
): HTMLElement {
  const wrap = el('div', { class: 'segmented', role: 'radiogroup' });
  const render = (cur: T) => {
    wrap.innerHTML = '';
    for (const o of options) {
      const b = el('button', {
        class: 'seg' + (o.value === cur ? ' active' : ''),
        type: 'button',
        role: 'radio',
        'aria-checked': String(o.value === cur),
        text: o.label,
      });
      b.addEventListener('click', () => {
        if (o.value === cur) return;
        playSound('tap');
        vibrate('light');
        render(o.value);
        onChange(o.value);
      });
      wrap.append(b);
    }
  };
  render(value);
  return wrap;
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox', class: 'switch-input' }) as HTMLInputElement;
  input.checked = value;
  input.addEventListener('change', () => {
    playSound('tap');
    vibrate('light');
    onChange(input.checked);
  });
  return el('label', { class: 'row switch-row' }, el('span', { text: label }), el('span', { class: 'switch' }, input, el('span', { class: 'switch-knob' })));
}

let modalLayer: HTMLElement | null = null;
const openModals: HTMLElement[] = [];

function layer(): HTMLElement {
  if (!modalLayer) {
    modalLayer = el('div', { class: 'modal-layer' });
    document.body.append(modalLayer);
  }
  return modalLayer;
}

export function showModal(opts: ModalOptions): ModalHandle {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const card = el('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' });
  if (opts.title) card.append(el('h2', { class: 'modal-title', text: opts.title }));
  if (opts.body) {
    if (typeof opts.body === 'string') {
      const body = el('div', { class: 'modal-body' });
      opts.body.split('\n').forEach((line) => body.append(el('p', { text: line })));
      card.append(body);
    } else {
      card.append(el('div', { class: 'modal-body' }, opts.body));
    }
  }
  const close = () => {
    if (!backdrop.isConnected) return;
    backdrop.classList.add('closing');
    const i = openModals.indexOf(backdrop);
    if (i >= 0) openModals.splice(i, 1);
    setTimeout(() => backdrop.remove(), 160);
  };
  const buttons = opts.buttons ?? [{ label: 'OK', primary: true }];
  const row = el('div', { class: 'modal-actions' });
  for (const b of buttons) {
    row.append(
      button(
        b.label,
        () => {
          close();
          b.onClick?.();
        },
        { variant: b.primary ? 'primary' : 'secondary', size: 'lg' },
      ),
    );
  }
  card.append(row);
  backdrop.append(card);
  if (opts.dismissible !== false) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
  }
  layer().append(backdrop);
  openModals.push(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  return { close };
}

export function closeAllModals(): void {
  openModals.splice(0).forEach((m) => m.remove());
}

let toastEl: HTMLElement | null = null;
let toastTimer = 0;
export function toast(message: string, ms = 1800): void {
  if (!toastEl) {
    toastEl = el('div', { class: 'toast' });
    document.body.append(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), ms);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}
