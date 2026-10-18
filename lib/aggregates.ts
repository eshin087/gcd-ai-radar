import { FAMILIES, familyOf, type Family } from "./families";
import { inBasis, type Basis, type CompactRow } from "./rows";
import { shardYear } from "./shard-year";
import { DEFAULT_WINDOW_MONTHS, WINDOW_CHOICES } from "./site";
import {
  dateOf,
  headline,
  isRealWorld,
  latest,
  monthKey,
  monthRange,
  primaryCategory,
  shiftMonth,
  windowKey,
  type CountRow,
  type DateField,
  type Headline,
  type MonthlyPoint,
} from "./stats";
import { CATEGORIES, INCIDENT_TYPES, SEVERITIES, TARGETS, type Category, type IncidentType, type Severity, type Target } from "./taxonomy";

/**
 * Build-time aggregates for the dashboard. The home page used to embed a
 * compact row per incident (1 MB of HTML at 1,900 records, 34 MB at the
 * 60,000 target); it now ships monthly tallies, a few kilobytes however large
 * the dataset grows, and fetches rows only when a drawer opens.
 *
 * For each date basis (incident date, first report) and each month: counts
 * by type, category, severity and target for all incidents and for the
 * real-world subset, plus the disclosed-vulnerability series with its
 * product breakdown. Headline numbers (lib/stats.ts headline()) and the
 * newest incidents are precomputed per basis. deriveView() turns the
 * aggregates into exactly the numbers useDashboardModel computed from rows,
 * and tests/aggregates.test.ts checks every one against a row count.
 *
 * Two placements of a date matter. Window totals use windowKey, which puts a
 * year-only incident date in July of its year; monthly columns use monthKey,
 * which cannot place it at all. A cell therefore keeps rows that have a month
 * apart from the year-only ones (yearOnly) that merely fall in the window.
 */

export const DATE_FIELDS: readonly DateField[] = ["incident_date", "first_reported"];
export const BASES: readonly Basis[] = ["all", "real"];

export type WindowKey = `${(typeof WINDOW_CHOICES)[number]}m` | "all";
export const WINDOW_KEYS: readonly WindowKey[] = [...WINDOW_CHOICES.map((w) => `${w}m` as WindowKey), "all"];
export const DEFAULT_WINDOW: WindowKey = `${DEFAULT_WINDOW_MONTHS}m`;

export interface Span {
  from: string;
  to: string;
}

/** Months in a window, or null for the full span. */
export function windowLength(win: WindowKey): number | null {
  return win === "all" ? null : Number(win.replace("m", ""));
}

/** First month of a window ending at span.to. */
export function windowFrom(win: WindowKey, span: Span): string {
  const n = windowLength(win);
  return n === null ? span.from : shiftMonth(span.to, -(n - 1));
}

/** Counts of the incidents in one month of one basis. Zero entries are left out. */
export interface Tally {
  n: number;
  sources: number;
  type: Partial<Record<IncidentType, number>>;
  category: Partial<Record<Category, number>>;
  severity: Partial<Record<`${Severity}`, number>>;
  target: Partial<Record<Target, number>>;
}

/** Disclosed vulnerabilities in one month; products as [index into Aggregates.products, count]. */
export interface DisclosedTally {
  n: number;
  sources: number;
  product: [number, number][];
}

export interface Cell {
  all?: Tally;
  real?: Tally;
  disclosed?: DisclosedTally;
}

export interface MonthCell extends Cell {
  /** Rows whose year-only date lands in this month by windowKey; they are in no monthly column. */
  yearOnly?: Cell;
}

/** What a year shard holds: its row count and the month range its rows span on each date basis (windowKey). */
export interface ShardInfo {
  year: number;
  records: number;
  min: Record<DateField, string>;
  max: Record<DateField, string>;
}

export interface Aggregates {
  /** Sparse: only months with at least one row, per date basis. */
  months: Record<DateField, Record<string, MonthCell>>;
  headline: Record<Basis, Record<DateField, Headline>>;
  /** The 12 newest incidents by first report, per basis. */
  latest: Record<Basis, CompactRow[]>;
  /** Product labels referenced by DisclosedTally.product. */
  products: string[];
  /** Busiest disclosure day per window and date basis: an argmax, so it does not add up from months. */
  busiest: Record<DateField, Record<WindowKey, { day: string; count: number } | null>>;
  shards: ShardInfo[];
  totals: { records: number; incidents: number; real: number; disclosed: number };
}

function emptyTally(): Tally {
  return { n: 0, sources: 0, type: {}, category: {}, severity: {}, target: {} };
}

function bump<K extends string>(rec: Partial<Record<K, number>>, key: K, by = 1) {
  rec[key] = (rec[key] ?? 0) + by;
}

function addRow(t: Tally, r: CompactRow) {
  t.n += 1;
  t.sources += r.source_count;
  bump(t.type, r.type);
  bump(t.category, primaryCategory(r));
  bump(t.severity, `${r.severity}` as `${Severity}`);
  for (const target of new Set(r.targets)) bump(t.target, target);
}

interface DisclosedBuilder {
  n: number;
  sources: number;
  product: Map<number, number>;
}
interface CellBuilder {
  all?: Tally;
  real?: Tally;
  disclosed?: DisclosedBuilder;
}
interface MonthBuilder extends CellBuilder {
  yearOnly?: CellBuilder;
}

function addToCell(cell: CellBuilder, r: CompactRow, productIndex: (label: string) => number) {
  if (r.disclosed) {
    const d = (cell.disclosed ??= { n: 0, sources: 0, product: new Map() });
    d.n += 1;
    d.sources += r.source_count;
    if (r.product) d.product.set(productIndex(r.product), (d.product.get(productIndex(r.product)) ?? 0) + 1);
    return;
  }
  addRow((cell.all ??= emptyTally()), r);
  if (isRealWorld(r)) addRow((cell.real ??= emptyTally()), r);
}

function finishCell(c: CellBuilder): Cell {
  const out: Cell = {};
  if (c.all) out.all = c.all;
  if (c.real) out.real = c.real;
  if (c.disclosed) out.disclosed = { n: c.disclosed.n, sources: c.disclosed.sources, product: [...c.disclosed.product.entries()].sort((a, b) => a[0] - b[0]) };
  return out;
}

export interface BuildOptions {
  now: Date;
  span: Span;
}

export function buildAggregates(rows: readonly CompactRow[], opts: BuildOptions): Aggregates {
  const products: string[] = [];
  const productIds = new Map<string, number>();
  const productIndex = (label: string) => {
    let i = productIds.get(label);
    if (i === undefined) {
      i = products.length;
      products.push(label);
      productIds.set(label, i);
    }
    return i;
  };

  const months: Record<DateField, Record<string, MonthCell>> = { incident_date: {}, first_reported: {} };
  for (const field of DATE_FIELDS) {
    const builders = new Map<string, MonthBuilder>();
    for (const r of rows) {
      const d = dateOf(r, field);
      const key = windowKey(d);
      let cell = builders.get(key);
      if (!cell) {
        cell = {};
        builders.set(key, cell);
      }
      if (monthKey(d) !== null) addToCell(cell, r, productIndex);
      else addToCell((cell.yearOnly ??= {}), r, productIndex);
    }
    for (const [key, b] of [...builders.entries()].sort(([a], [c]) => a.localeCompare(c))) {
      const cell: MonthCell = finishCell(b);
      if (b.yearOnly) cell.yearOnly = finishCell(b.yearOnly);
      months[field][key] = cell;
    }
  }

  const basisRows: Record<Basis, CompactRow[]> = { all: rows.filter((r) => inBasis(r, "all")), real: rows.filter((r) => inBasis(r, "real")) };
  const headlines = { all: {}, real: {} } as Record<Basis, Record<DateField, Headline>>;
  for (const basis of BASES) for (const field of DATE_FIELDS) headlines[basis][field] = headline(basisRows[basis], { now: opts.now, dateField: field });

  const disclosedRows = rows.filter((r) => r.disclosed);
  const busiest = { incident_date: {}, first_reported: {} } as Aggregates["busiest"];
  for (const field of DATE_FIELDS) {
    for (const win of WINDOW_KEYS) {
      const from = windowFrom(win, opts.span);
      const counts = new Map<string, number>();
      for (const r of disclosedRows) {
        const d = dateOf(r, field);
        const k = windowKey(d);
        if (k < from || k > opts.span.to || d.length !== 10) continue;
        counts.set(d, (counts.get(d) ?? 0) + 1);
      }
      let best: { day: string; count: number } | null = null;
      for (const [day, count] of counts) if (!best || count > best.count) best = { day, count };
      busiest[field][win] = best;
    }
  }

  return {
    months,
    headline: headlines,
    latest: { all: latest(basisRows.all, 12), real: latest(basisRows.real, 12) },
    products,
    busiest,
    shards: shardManifest(rows),
    totals: { records: rows.length, incidents: basisRows.all.length, real: basisRows.real.length, disclosed: disclosedRows.length },
  };
}

/** Per year shard (year of first report): how many rows, and the month range they span on each date basis. */
export function shardManifest(rows: readonly CompactRow[]): ShardInfo[] {
  const by = new Map<number, ShardInfo>();
  for (const r of rows) {
    const year = shardYear(r);
    let s = by.get(year);
    if (!s) {
      s = { year, records: 0, min: { incident_date: "9999-99", first_reported: "9999-99" }, max: { incident_date: "0000-00", first_reported: "0000-00" } };
      by.set(year, s);
    }
    s.records += 1;
    for (const field of DATE_FIELDS) {
      const k = windowKey(dateOf(r, field));
      if (k < s.min[field]) s.min[field] = k;
      if (k > s.max[field]) s.max[field] = k;
    }
  }
  return [...by.values()].sort((a, b) => a.year - b.year);
}

/** The shards that can hold a row whose date (by `field`) falls in [from, to]. */
export function shardsFor(shards: readonly ShardInfo[], field: DateField, from: string, to: string): number[] {
  return shards.filter((s) => s.min[field] <= to && s.max[field] >= from).map((s) => s.year);
}

// ---------------------------------------------------------------------------
// Reading the aggregates back: the numbers the dashboard shows.

function addTally(acc: Tally, t: Tally | undefined) {
  if (!t) return;
  acc.n += t.n;
  acc.sources += t.sources;
  for (const [k, v] of Object.entries(t.type)) bump(acc.type, k as IncidentType, v);
  for (const [k, v] of Object.entries(t.category)) bump(acc.category, k as Category, v);
  for (const [k, v] of Object.entries(t.severity)) bump(acc.severity, k as `${Severity}`, v);
  for (const [k, v] of Object.entries(t.target)) bump(acc.target, k as Target, v);
}

function toMonthlyPoint(month: string, t: Tally | undefined): MonthlyPoint {
  return {
    month,
    total: t?.n ?? 0,
    byType: Object.fromEntries(INCIDENT_TYPES.map((k) => [k, t?.type[k] ?? 0])) as Record<IncidentType, number>,
    byCategory: Object.fromEntries(CATEGORIES.map((k) => [k, t?.category[k] ?? 0])) as Record<Category, number>,
    bySeverity: Object.fromEntries(SEVERITIES.map((k) => [k, t?.severity[`${k}`] ?? 0])) as Record<Severity, number>,
  };
}

export interface ViewOptions {
  basis: Basis;
  field: DateField;
  win: WindowKey;
  span: Span;
}

/** Everything the dashboard draws for one choice of basis, date field and window. */
export interface DashboardView {
  from: string;
  to: string;
  months: string[];
  /** Incidents of the basis in the window (windowKey membership, so year-only dates count). */
  count: number;
  realInWindow: number;
  /** Incidents and disclosed vulnerabilities together, in the window. */
  allInWindow: number;
  sourcesInWindow: number;
  /** Monthly columns: rows that can be placed in a month. */
  series: MonthlyPoint[];
  families: CountRow<Family>[];
  types: CountRow<IncidentType>[];
  targets: CountRow<Target>[];
  severities: CountRow<`${Severity}`>[];
  h: Headline;
  /** Incidents of the basis in the equal-length window before this one; null for the full span. */
  priorCount: number | null;
  disclosedCount: number;
  disclosedSeries: { month: string; total: number }[];
  disclosedProducts: CountRow[];
  disclosedBusiest: { day: string; count: number } | null;
  latestRows: CompactRow[];
}

function cellsBetween(agg: Aggregates, field: DateField, from: string, to: string): [string, MonthCell | undefined][] {
  const table = agg.months[field];
  return monthRange(from, to).map((m) => [m, table[m]]);
}

function basisCount(cells: [string, MonthCell | undefined][], basis: Basis): number {
  let n = 0;
  for (const [, c] of cells) n += (c?.[basis]?.n ?? 0) + (c?.yearOnly?.[basis]?.n ?? 0);
  return n;
}

export function deriveView(agg: Aggregates, opts: ViewOptions): DashboardView {
  const { basis, field, win, span } = opts;
  const to = span.to;
  const from = windowFrom(win, span);
  const cells = cellsBetween(agg, field, from, to);

  const inWindow = emptyTally();
  for (const [, c] of cells) {
    addTally(inWindow, c?.[basis]);
    addTally(inWindow, c?.yearOnly?.[basis]);
  }
  const series = cells.map(([m, c]) => toMonthlyPoint(m, c?.[basis]));

  const famCounts = Object.fromEntries(FAMILIES.map((f) => [f, 0])) as Record<Family, number>;
  for (const [cat, n] of Object.entries(inWindow.category)) famCounts[familyOf(cat as Category)] += n ?? 0;

  let disclosedCount = 0;
  const productCounts = new Map<number, number>();
  const disclosedSeries: { month: string; total: number }[] = [];
  for (const [m, c] of cells) {
    disclosedSeries.push({ month: m, total: c?.disclosed?.n ?? 0 });
    for (const d of [c?.disclosed, c?.yearOnly?.disclosed]) {
      if (!d) continue;
      disclosedCount += d.n;
      for (const [i, n] of d.product) productCounts.set(i, (productCounts.get(i) ?? 0) + n);
    }
  }

  let realInWindow = 0;
  let allInWindow = 0;
  for (const [, c] of cells) {
    realInWindow += (c?.real?.n ?? 0) + (c?.yearOnly?.real?.n ?? 0);
    allInWindow += (c?.all?.n ?? 0) + (c?.yearOnly?.all?.n ?? 0) + (c?.disclosed?.n ?? 0) + (c?.yearOnly?.disclosed?.n ?? 0);
  }

  const n = windowLength(win);
  const priorCount = n === null ? null : basisCount(cellsBetween(agg, field, shiftMonth(from, -n), shiftMonth(from, -1)), basis);

  return {
    from,
    to,
    months: cells.map(([m]) => m),
    count: inWindow.n,
    realInWindow,
    allInWindow,
    sourcesInWindow: inWindow.sources,
    series,
    families: FAMILIES.map((f) => ({ key: f, count: famCounts[f] })),
    types: INCIDENT_TYPES.map((t) => ({ key: t, count: inWindow.type[t] ?? 0 })),
    targets: TARGETS.map((t) => ({ key: t, count: inWindow.target[t] ?? 0 })).sort((a, b) => b.count - a.count),
    severities: SEVERITIES.map((s) => ({ key: `${s}` as `${Severity}`, count: inWindow.severity[`${s}`] ?? 0 })),
    h: agg.headline[basis][field],
    priorCount,
    disclosedCount,
    disclosedSeries,
    disclosedProducts: [...productCounts.entries()]
      .map(([i, count]) => ({ key: agg.products[i]!, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    disclosedBusiest: agg.busiest[field][win],
    latestRows: agg.latest[basis],
  };
}
