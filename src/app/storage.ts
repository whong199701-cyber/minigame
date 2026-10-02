import type { GameStorage } from './types';

const PREFIX = 'ba:';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota or private mode: ignore */
  }
}

function del(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export interface Settings {
  lang?: 'zh' | 'en';
  theme?: 'dark' | 'light' | 'system';
  sound?: boolean;
  haptics?: boolean;
}

export function getSetting<T>(key: keyof Settings, fallback: T): T {
  const s = read<Settings>('settings', {});
  const v = s[key];
  return (v === undefined ? fallback : (v as unknown as T));
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const s = read<Settings>('settings', {});
  s[key] = value;
  write('settings', s);
}

interface GameRecord {
  data: Record<string, unknown>;
  best: Record<string, number>;
  plays: number;
}

function readGame(id: string): GameRecord {
  const r = read<Partial<GameRecord>>('game:' + id, {});
  return { data: r.data ?? {}, best: r.best ?? {}, plays: r.plays ?? 0 };
}

function writeGame(id: string, rec: GameRecord): void {
  write('game:' + id, rec);
}

export function incrementPlays(id: string): void {
  const rec = readGame(id);
  rec.plays += 1;
  writeGame(id, rec);
}

export function getPlays(id: string): number {
  return readGame(id).plays;
}

export function getAllBest(id: string): Record<string, number> {
  return readGame(id).best;
}

export function createGameStorage(id: string): GameStorage {
  return {
    get<T>(key: string, fallback: T): T {
      const rec = readGame(id);
      return key in rec.data ? (rec.data[key] as T) : fallback;
    },
    set<T>(key: string, value: T): void {
      const rec = readGame(id);
      rec.data[key] = value;
      writeGame(id, rec);
    },
    remove(key: string): void {
      const rec = readGame(id);
      delete rec.data[key];
      writeGame(id, rec);
    },
    recordBest(mode: string, value: number, better: 'higher' | 'lower' = 'higher'): boolean {
      if (!Number.isFinite(value)) return false;
      const rec = readGame(id);
      const prev = rec.best[mode];
      const isBest = prev === undefined || (better === 'higher' ? value > prev : value < prev);
      if (isBest) {
        rec.best[mode] = value;
        writeGame(id, rec);
      }
      return isBest;
    },
    getBest(mode: string): number | null {
      const rec = readGame(id);
      return mode in rec.best ? rec.best[mode] : null;
    },
  };
}

export function clearAllData(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export { del as removeKey };
