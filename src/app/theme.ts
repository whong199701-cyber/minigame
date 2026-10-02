import type { ThemeName } from './types';
import { getSetting, setSetting } from './storage';

export type ThemePref = 'dark' | 'light' | 'system';

const media = window.matchMedia('(prefers-color-scheme: dark)');
let pref: ThemePref = getSetting<ThemePref>('theme', 'system');
const listeners = new Set<(t: ThemeName) => void>();

function resolve(p: ThemePref): ThemeName {
  if (p === 'system') return media.matches ? 'dark' : 'light';
  return p;
}

let current: ThemeName = resolve(pref);

function apply(): void {
  const next = resolve(pref);
  document.documentElement.dataset.theme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#0f1218' : '#f4f6fb');
  if (next !== current) {
    current = next;
    listeners.forEach((fn) => fn(next));
  }
}

export function getTheme(): ThemeName {
  return current;
}

export function getThemePref(): ThemePref {
  return pref;
}

export function setThemePref(p: ThemePref): void {
  pref = p;
  setSetting('theme', p);
  apply();
}

export function onThemeChange(fn: (t: ThemeName) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

media.addEventListener('change', apply);
document.documentElement.dataset.theme = current;
apply();
