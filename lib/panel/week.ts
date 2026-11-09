import { addDays } from "../lifecycle";
import { shiftMonth } from "../stats";
import type { DailyStats, NvdCounts } from "../stats-schema";
import type { AiFlow, FlowCount } from "./ai-flow";
import type { Band, Level } from "./levels";
import { DAY_MS } from "./util";

/**
 * The week against a typical one: six readouts, each a number, a level word
 * and the typical mark its bar is drawn against.
 *
 * Patch Tuesday: the second Tuesday of the month, UTC, the next one on or
 * after today; from the calendar alone.
 *
 * Published: CVEs NVD published in the 7 days before its fetch, against a
 * typical week this year (the year's total over the days elapsed when it
 * was counted, times seven; busy above 1.25 of it, quiet below 0.75).
 *
 * Critical: of them, CVSS 9 or higher, against the average week of the
 * daily file's days before this week (at least seven of them, else no
 * typical).
 *
 * Exploited: KEV additions in the 7 days, against every 7-day window of the
 * 36 months before (the middle half is the usual range, the 90th percentile
 * where busy starts), with last week's count beside it.
 *
 * Breaches: verified HIBP breaches added this month and their accounts,
 * against the median of the previous 36 months; no level word, since the
 * month is in progress.
 *
 * AI: this week's incidents by the role AI played (lib/panel/ai-flow.ts),
 * the top technique of each role, and the CVEs in AI software.
 */

export interface Week {
  patchTuesday: string;
  published: { n: number | null; typical: number | null; level: Level };
  critical: { n: number | null; typical: number | null; level: Level };
  exploited: { n: number | null; band: Band | null; level: Level; lastWeek: number | null };
  breaches: { month: string; n: number | null; accounts: number | null; typicalMonth: number | null };
  ai: { total: number; onAi: number; usingAi: number; cves: number; exploited: number; topTarget: FlowCount | null; topWeapon: FlowCount | null };
}

export const TYPICAL_MONTHS = 36;
export const TYPICAL_MIN_DAYS = 7;

function secondTuesday(year: number, month: number): string {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (2 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + 7)).toISOString().slice(0, 10);
}

/** The next Patch Tuesday on or after `today` (UTC days). */
export function patchTuesday(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const thisMonth = secondTuesday(year, month);
  return thisMonth >= today ? thisMonth : secondTuesday(year, month + 1);
}

/** A typical week this year: the year's NVD total over the days elapsed when it was counted, times seven; null before two weeks of the year. */
export function typicalCveWeek(nvd: NvdCounts | null): number | null {
  if (!nvd) return null;
  const fetched = nvd.fetched_at.slice(0, 10);
  const year = Number(fetched.slice(0, 4));
  const total = nvd.years.find((y) => y.year === year)?.total;
  const elapsed = (Date.parse(`${fetched}T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / DAY_MS + 1;
  return total && elapsed >= 14 ? Math.round((total / elapsed) * 7) : null;
}

/** The daily file's days before this week, averaged and times seven; null with fewer than TYPICAL_MIN_DAYS of them. */
export function typicalCriticalWeek(daily: DailyStats | null, today: string): number | null {
  if (!daily) return null;
  const from = addDays(today, -7);
  const days = Object.entries(daily.days).filter(([d]) => d < from);
  if (days.length < TYPICAL_MIN_DAYS) return null;
  return Math.round((days.reduce((s, [, v]) => s + v.critical, 0) / days.length) * 7);
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The median count per month over the `months` full months before `month`; null without breaches at all. */
export function typicalBreachMonth(breaches: readonly { added: string }[], month: string, months = TYPICAL_MONTHS): number | null {
  if (breaches.length === 0) return null;
  const perMonth = new Map<string, number>();
  for (const b of breaches) perMonth.set(b.added.slice(0, 7), (perMonth.get(b.added.slice(0, 7)) ?? 0) + 1);
  const keys: string[] = [];
  for (let k = 1; k <= months; k++) keys.push(shiftMonth(month, -k));
  return median(keys.map((k) => perMonth.get(k) ?? 0));
}

export function buildWeek(input: {
  today: string;
  published: { n: number | null; typical: number | null; level: Level };
  critical: { n: number | null; typical: number | null; level: Level };
  exploited: { n: number | null; band: Band | null; level: Level; lastWeek: number | null };
  breaches: { month: string; n: number | null; accounts: number | null; typicalMonth: number | null };
  ai: AiFlow;
}): Week {
  const { ai } = input;
  return {
    patchTuesday: patchTuesday(input.today),
    published: input.published,
    critical: input.critical,
    exploited: input.exploited,
    breaches: input.breaches,
    ai: { total: ai.total, onAi: ai.target.n, usingAi: ai.weapon.n, cves: ai.weak.cves, exploited: ai.weak.exploited, topTarget: ai.target.techniques[0] ?? null, topWeapon: ai.weapon.techniques[0] ?? null },
  };
}
