import type { Incident } from "./schema";
import {
  CATEGORIES,
  INCIDENT_TYPES,
  REAL_WORLD_MIN_SEVERITY,
  SEVERITIES,
  TARGETS,
  type Category,
  type IncidentType,
  type Severity,
  type Target,
} from "./taxonomy";

/**
 * All numbers shown on the site come from here. The functions accept any
 * record carrying the few fields they need (StatRecord), so the dashboard can
 * run them in the browser on a compact row list as well as at build time on
 * full incidents. Dependency-free and unit-tested.
 */

export type DateField = "incident_date" | "first_reported";

export type StatRecord = Pick<Incident, "incident_date" | "first_reported" | "type" | "categories" | "severity" | "targets">;

/** "2024-03-05" | "2024-03" -> "2024-03"; "2024" -> null (cannot be placed in a month). */
export function monthKey(date: string): string | null {
  if (date.length >= 7) return date.slice(0, 7);
  return null;
}

/** Month used for window membership: year-only dates count as mid-year. */
export function windowKey(date: string): string {
  return date.length >= 7 ? date.slice(0, 7) : `${date}-07`;
}

/** Inclusive list of YYYY-MM keys from `from` to `to`. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function toMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function dateOf(r: StatRecord, field: DateField): string {
  return field === "incident_date" ? r.incident_date : r.first_reported;
}

export function isRealWorld(r: Pick<StatRecord, "severity">): boolean {
  return r.severity >= REAL_WORLD_MIN_SEVERITY;
}

export function primaryCategory(r: Pick<StatRecord, "categories">): Category {
  return r.categories[0] ?? "other";
}

/** Records whose date (by `field`) falls inside the month window, inclusive. */
export function inWindow<T extends StatRecord>(records: T[], from: string, to: string, field: DateField): T[] {
  return records.filter((r) => {
    const k = windowKey(dateOf(r, field));
    return k >= from && k <= to;
  });
}

export interface MonthlyPoint {
  month: string;
  total: number;
  byType: Record<IncidentType, number>;
  byCategory: Record<Category, number>;
  bySeverity: Record<Severity, number>;
}

function emptyPoint(month: string): MonthlyPoint {
  return {
    month,
    total: 0,
    byType: Object.fromEntries(INCIDENT_TYPES.map((t) => [t, 0])) as Record<IncidentType, number>,
    byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>,
    bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>,
  };
}

export interface SeriesOptions {
  from: string; // YYYY-MM
  to: string; // YYYY-MM
  dateField?: DateField;
}

/**
 * Monthly counts. Incidents with year-only precision cannot be placed in a
 * month and are excluded when keyed on incident_date (they still count in
 * totals and yearly figures). Each incident is counted once, under its
 * primary category.
 */
export function monthlySeries(records: StatRecord[], opts: SeriesOptions): MonthlyPoint[] {
  const field = opts.dateField ?? "incident_date";
  const months = monthRange(opts.from, opts.to);
  const index = new Map(months.map((m) => [m, emptyPoint(m)]));
  for (const r of records) {
    const key = monthKey(dateOf(r, field));
    if (!key) continue;
    const point = index.get(key);
    if (!point) continue;
    point.total += 1;
    point.byType[r.type] += 1;
    point.byCategory[primaryCategory(r)] += 1;
    point.bySeverity[r.severity] += 1;
  }
  return months.map((m) => index.get(m)!);
}

export interface TrendPoint extends MonthlyPoint {
  /** Centered moving average (null at the edges). */
  ma: number | null;
  /** Least-squares linear fit value for this month. */
  fit: number;
}

export function addTrend(series: MonthlyPoint[], window = 3): TrendPoint[] {
  const n = series.length;
  const half = Math.floor(window / 2);
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  series.forEach((p, i) => {
    sx += i;
    sy += p.total;
    sxx += i * i;
    sxy += i * p.total;
  });
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = n === 0 ? 0 : (sy - slope * sx) / n;
  return series.map((p, i) => {
    let ma: number | null = null;
    if (i - half >= 0 && i + half < n) {
      let sum = 0;
      for (let j = i - half; j <= i + half; j++) sum += series[j]!.total;
      ma = sum / window;
    }
    return { ...p, ma, fit: Math.max(0, intercept + slope * i) };
  });
}

/** Slope of the linear fit expressed as incidents per month. */
export function trendSlope(series: MonthlyPoint[]): number {
  const t = addTrend(series);
  if (t.length < 2) return 0;
  return (t[t.length - 1]!.fit - t[0]!.fit) / (t.length - 1);
}

export interface Headline {
  total: number;
  realWorld: number;
  thisMonth: number;
  lastMonth: number;
  thisMonthKey: string;
  lastMonthKey: string;
  monthDeltaPct: number | null;
  trailing12: number;
  prior12: number;
  trailingDeltaPct: number | null;
  yearToDate: number;
  lastYearSamePeriod: number;
  yoyPct: number | null;
  /** First month that is still considered provisional (reporting lag). */
  provisionalFrom: string;
}

export function pctChange(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return ((now - before) / before) * 100;
}

export interface HeadlineOptions {
  now: Date;
  dateField?: DateField;
  provisionalDays?: number;
}

export function headline(records: StatRecord[], opts: HeadlineOptions): Headline {
  const field = opts.dateField ?? "incident_date";
  const now = opts.now;
  const thisMonthKey = toMonthKey(now);
  const lastMonthKey = shiftMonth(thisMonthKey, -1);
  const trailingStart = shiftMonth(thisMonthKey, -11);
  const priorStart = shiftMonth(thisMonthKey, -23);
  const priorEnd = shiftMonth(thisMonthKey, -12);
  const todayIso = now.toISOString().slice(0, 10);
  const year = now.getUTCFullYear();
  const lastYearCutoff = `${year - 1}${todayIso.slice(4)}`;

  let thisMonth = 0,
    lastMonth = 0,
    trailing12 = 0,
    prior12 = 0,
    yearToDate = 0,
    lastYearSamePeriod = 0,
    realWorld = 0;

  for (const r of records) {
    if (isRealWorld(r)) realWorld += 1;
    const d = dateOf(r, field);
    const key = monthKey(d);
    const y = d.slice(0, 4);
    if (y === String(year)) yearToDate += 1;
    if (y === String(year - 1) && d <= lastYearCutoff) lastYearSamePeriod += 1;
    if (!key) continue;
    if (key === thisMonthKey) thisMonth += 1;
    if (key === lastMonthKey) lastMonth += 1;
    if (key >= trailingStart && key <= thisMonthKey) trailing12 += 1;
    if (key >= priorStart && key <= priorEnd) prior12 += 1;
  }

  const provisional = new Date(now.getTime() - (opts.provisionalDays ?? 60) * 86400000);

  return {
    total: records.length,
    realWorld,
    thisMonth,
    lastMonth,
    thisMonthKey,
    lastMonthKey,
    monthDeltaPct: pctChange(thisMonth, lastMonth),
    trailing12,
    prior12,
    trailingDeltaPct: pctChange(trailing12, prior12),
    yearToDate,
    lastYearSamePeriod,
    yoyPct: pctChange(yearToDate, lastYearSamePeriod),
    provisionalFrom: toMonthKey(provisional),
  };
}

export interface CountRow<K extends string = string> {
  key: K;
  count: number;
}

export function countBy<K extends string, T>(records: T[], pick: (r: T) => K | K[], order?: readonly K[]): CountRow<K>[] {
  const counts = new Map<K, number>();
  for (const r of records) {
    const v = pick(r);
    const keys = Array.isArray(v) ? v : [v];
    for (const k of new Set(keys)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (order) {
    return order.map((k) => ({ key: k, count: counts.get(k) ?? 0 }));
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

export function severityDistribution(records: Pick<StatRecord, "severity">[]): CountRow<`${Severity}`>[] {
  return countBy(records, (r) => `${r.severity}` as `${Severity}`, ["1", "2", "3", "4"]);
}

/** Counts every target an incident lists (an incident can hit several). */
export function targetDistribution(records: Pick<StatRecord, "targets">[]): CountRow<Target>[] {
  return countBy(records, (r) => r.targets, TARGETS).sort((a, b) => b.count - a.count);
}

/** Primary-category counts, in taxonomy order. */
export function categoryDistribution(records: Pick<StatRecord, "categories">[]): CountRow<Category>[] {
  return countBy(records, primaryCategory, CATEGORIES);
}

export function typeDistribution(records: Pick<StatRecord, "type">[]): CountRow<IncidentType>[] {
  return countBy(records, (r) => r.type, INCIDENT_TYPES);
}

export function publisherDistribution(incidents: Incident[]): CountRow[] {
  return countBy(incidents, (i) => i.sources.map((s) => s.publisher));
}

export function latest<T extends { first_reported: string }>(records: T[], n: number): T[] {
  return [...records]
    .sort((a, b) => (a.first_reported < b.first_reported ? 1 : a.first_reported > b.first_reported ? -1 : 0))
    .slice(0, n);
}

export function yearRange(records: Pick<StatRecord, "incident_date">[]): { min: number; max: number } | null {
  if (records.length === 0) return null;
  let min = 9999,
    max = 0;
  for (const r of records) {
    const y = Number(r.incident_date.slice(0, 4));
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { min, max };
}
