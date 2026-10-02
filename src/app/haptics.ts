import type { HapticName } from './types';
import { getSetting, setSetting } from './storage';

let enabled = getSetting<boolean>('haptics', true);

export function isHapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(v: boolean): void {
  enabled = v;
  setSetting('haptics', v);
  if (v) vibrate('light');
}

export function isHapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

const patterns: Record<HapticName, number | number[]> = {
  light: 10,
  medium: 25,
  heavy: 50,
  success: [15, 40, 25],
  error: [40, 50, 40],
};

export function vibrate(kind: HapticName = 'light'): void {
  if (!enabled || !isHapticsSupported()) return;
  try {
    navigator.vibrate(patterns[kind]);
  } catch {
    /* ignore */
  }
}
