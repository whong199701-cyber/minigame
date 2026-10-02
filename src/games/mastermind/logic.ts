/** Pure game logic for Codebreaker (Mastermind-style). No DOM here so it can be unit tested. */

export interface Feedback {
  /** Right colour, right position. */
  exact: number;
  /** Right colour, wrong position. */
  partial: number;
}

export interface Config {
  length: number; // pegs per code
  colors: number; // palette size
  maxAttempts: number;
  allowRepeats: boolean;
}

export function generateCode(cfg: Config, rand: () => number = Math.random): number[] {
  const code: number[] = [];
  const pool = Array.from({ length: cfg.colors }, (_, i) => i);
  for (let i = 0; i < cfg.length; i++) {
    if (cfg.allowRepeats) {
      code.push(Math.floor(rand() * cfg.colors));
    } else {
      const idx = Math.floor(rand() * pool.length);
      code.push(pool.splice(idx, 1)[0]);
    }
  }
  return code;
}

export function scoreGuess(guess: number[], code: number[]): Feedback {
  let exact = 0;
  const codeCounts = new Map<number, number>();
  const guessCounts = new Map<number, number>();
  for (let i = 0; i < code.length; i++) {
    if (guess[i] === code[i]) {
      exact++;
    } else {
      codeCounts.set(code[i], (codeCounts.get(code[i]) ?? 0) + 1);
      guessCounts.set(guess[i], (guessCounts.get(guess[i]) ?? 0) + 1);
    }
  }
  let partial = 0;
  for (const [color, n] of guessCounts) {
    partial += Math.min(n, codeCounts.get(color) ?? 0);
  }
  return { exact, partial };
}

export function isSolved(fb: Feedback, length: number): boolean {
  return fb.exact === length;
}

/** Number of codes still consistent with all feedback so far (used for the hint feature). */
export function countConsistent(cfg: Config, history: { guess: number[]; fb: Feedback }[], limit = 100000): number {
  let count = 0;
  const code = new Array<number>(cfg.length).fill(0);
  const total = Math.pow(cfg.colors, cfg.length);
  if (total > limit) return -1;
  for (let n = 0; n < total; n++) {
    let x = n;
    let valid = true;
    const seen = new Set<number>();
    for (let i = 0; i < cfg.length; i++) {
      code[i] = x % cfg.colors;
      x = Math.floor(x / cfg.colors);
      if (!cfg.allowRepeats) {
        if (seen.has(code[i])) {
          valid = false;
          break;
        }
        seen.add(code[i]);
      }
    }
    if (!valid) continue;
    let ok = true;
    for (const h of history) {
      const fb = scoreGuess(h.guess, code);
      if (fb.exact !== h.fb.exact || fb.partial !== h.fb.partial) {
        ok = false;
        break;
      }
    }
    if (ok) count++;
  }
  return count;
}
