/**
 * Level words: how a count compares with its own history. Below the 25th
 * percentile of the history is quiet, up to the 75th normal, up to the 90th
 * busy, above it very busy. With fewer than four earlier values there is no
 * history worth judging by, and the word is normal.
 */

export const LEVEL_WORDS = ["quiet", "normal", "busy", "very busy"] as const;
export type Level = 0 | 1 | 2 | 3;

export interface Band {
  p25: number;
  p75: number;
  p90: number;
}

/** Linear-interpolated quantile, p in [0, 1]. */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

export const MIN_HISTORY = 4;

export function bandOf(history: readonly number[]): Band | null {
  if (history.length < MIN_HISTORY) return null;
  return { p25: quantile(history, 0.25), p75: quantile(history, 0.75), p90: quantile(history, 0.9) };
}

export function levelOf(value: number, band: Band | null): Level {
  if (!band) return 1;
  return value < band.p25 ? 0 : value <= band.p75 ? 1 : value <= band.p90 ? 2 : 3;
}

/** A week's count against a typical week: quiet below three quarters of it, busy above one and a quarter, else normal. */
export function ratioLevel(value: number, typical: number | null): Level {
  if (!typical) return 1;
  return value > typical * 1.25 ? 2 : value < typical * 0.75 ? 0 : 1;
}
