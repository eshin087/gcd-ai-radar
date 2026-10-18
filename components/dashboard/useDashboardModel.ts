"use client";

import { useMemo, useState } from "react";
import { isDisclosedSelection, type Selection } from "@/components/dashboard/DrillDown";
import type { Basis, CompactRow, DashboardData } from "@/lib/dashboard";
import { FAMILIES, familyOf, type Family } from "@/lib/families";
import { monthLabel } from "@/lib/format";
import { DEFAULT_WINDOW_MONTHS, WINDOW_CHOICES } from "@/lib/site";
import {
  addTrend,
  countBy,
  dateOf,
  headline,
  inWindow,
  isRealWorld,
  latest,
  monthKey,
  monthlySeries,
  primaryCategory,
  severityDistribution,
  shiftMonth,
  targetDistribution,
  trendSlope,
  typeDistribution,
  windowKey,
  type DateField,
  type MonthlyPoint,
} from "@/lib/stats";

export type WindowKey = `${(typeof WINDOW_CHOICES)[number]}m` | "all";

export interface FamilyPoint {
  month: string;
  total: number;
  values: Record<Family, number>;
}

/** Monthly totals per family, derived from the per-category series. */
export function familySeries(series: MonthlyPoint[]): FamilyPoint[] {
  return series.map((p) => {
    const values = Object.fromEntries(FAMILIES.map((f) => [f, 0])) as Record<Family, number>;
    for (const [cat, n] of Object.entries(p.byCategory)) values[familyOf(cat as keyof MonthlyPoint["byCategory"])] += n;
    return { month: p.month, total: p.total, values };
  });
}

function matches(r: CompactRow, s: Selection, field: DateField): boolean {
  const m = windowKey(dateOf(r, field));
  switch (s.kind) {
    case "month":
      return m === s.month;
    case "month-category":
      return m === s.month && primaryCategory(r) === s.category;
    case "month-type":
      return m === s.month && r.type === s.type;
    case "month-family":
      return m === s.month && familyOf(primaryCategory(r)) === s.family;
    case "family":
      return familyOf(primaryCategory(r)) === s.family;
    case "target":
      return r.targets.includes(s.target);
    case "severity":
      return r.severity === s.severity;
    case "category":
      return primaryCategory(r) === s.category;
    case "type":
      return r.type === s.type;
    case "window":
      return true;
    case "real":
      return isRealWorld(r);
    case "disclosed":
      return true;
    case "disclosed-month":
      return m === s.month;
    case "disclosed-product":
      return r.product === s.product;
    case "disclosed-day":
      return dateOf(r, field) === s.day;
    case "range": {
      // Mirrors headline(): month tiles skip year-only dates, year tiles keep them; toDate caps "same period last year".
      const d = dateOf(r, field);
      if (s.byYear) return d.slice(0, 4) >= s.from.slice(0, 4) && d.slice(0, 4) <= s.to.slice(0, 4) && (!s.toDate || d <= s.toDate);
      const k = monthKey(d);
      return k !== null && k >= s.from && k <= s.to;
    }
  }
}

/**
 * Everything the dashboard needs: the three toggles (set, date basis,
 * window), every chart series computed for the current view, the selections
 * behind the headline numbers, and the incidents behind a clicked mark.
 */
export function useDashboardModel(data: DashboardData) {
  const [basis, setBasis] = useState<Basis>("all");
  const [field, setField] = useState<DateField>("incident_date");
  const [win, setWin] = useState<WindowKey>(`${DEFAULT_WINDOW_MONTHS}m`);
  const [selection, setSelection] = useState<Selection | null>(null);

  const now = useMemo(() => new Date(data.now), [data.now]);
  const to = data.span.to;
  const from = win === "all" ? data.span.from : shiftMonth(to, -(Number(win.replace("m", "")) - 1));
  const windowLabel = win === "all" ? `all time (${monthLabel(from)} onward)` : `last ${win.replace("m", "")} months`;

  // Disclosed vulnerabilities never enter the incident views; they are their own series below.
  const basisRows = useMemo(() => (basis === "real" ? data.rows.filter(isRealWorld) : data.rows.filter((r) => !r.disclosed)), [data.rows, basis]);
  const disclosedBase = useMemo(() => data.rows.filter((r) => r.disclosed), [data.rows]);
  const rows = useMemo(() => inWindow(basisRows, from, to, field), [basisRows, from, to, field]);
  const series = useMemo(() => monthlySeries(rows, { from, to, dateField: field }), [rows, from, to, field]);
  const trend = useMemo(() => addTrend(series), [series]);
  const slope = useMemo(() => trendSlope(series), [series]);
  const fam = useMemo(() => familySeries(series), [series]);
  const h = useMemo(() => headline(basisRows, { now, dateField: field }), [basisRows, now, field]);
  const targets = useMemo(() => targetDistribution(rows), [rows]);
  const severities = useMemo(() => severityDistribution(rows), [rows]);
  const types = useMemo(() => typeDistribution(rows), [rows]);
  const families = useMemo(() => countBy(rows, (r) => familyOf(primaryCategory(r)), FAMILIES), [rows]);
  const latestRows = useMemo(() => latest(basisRows, 12), [basisRows]);
  const realInWindow = useMemo(() => rows.filter(isRealWorld).length, [rows]);
  const allInWindow = useMemo(() => inWindow(data.rows, from, to, field).length, [data.rows, from, to, field]);
  // Disclosed vulnerabilities in view, and what they look like.
  const disclosedRows = useMemo(() => inWindow(disclosedBase, from, to, field), [disclosedBase, from, to, field]);
  const disclosedSeries = useMemo(() => monthlySeries(disclosedRows, { from, to, dateField: field }), [disclosedRows, from, to, field]);
  const disclosedProducts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of disclosedRows) if (r.product) counts.set(r.product, (counts.get(r.product) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, count]) => ({ key, count }));
  }, [disclosedRows]);
  /** The day with the most disclosures in view: vendors file CVEs in batches. */
  const disclosedBusiest = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of disclosedRows) {
      const d = dateOf(r, field);
      if (d.length === 10) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    let best: { day: string; count: number } | null = null;
    for (const [day, count] of counts) if (!best || count > best.count) best = { day, count };
    return best;
  }, [disclosedRows, field]);

  // A month range (trailing 12 months, year to date) can reach outside the window, so it reads the whole set.
  const selected = useMemo(() => {
    if (!selection) return [];
    const pool = isDisclosedSelection(selection) ? disclosedRows : selection.kind === "range" ? basisRows : rows;
    return pool.filter((r) => matches(r, selection, field));
  }, [selection, rows, basisRows, disclosedRows, field]);

  /** Selections behind every headline number, so each one opens its incidents. */
  const picks = useMemo(() => {
    const year = now.getUTCFullYear();
    const today = now.toISOString().slice(0, 10);
    const range = (from: string, to: string, label: string, extra: Partial<Extract<Selection, { kind: "range" }>> = {}): Selection => ({ kind: "range", from, to, label, ...extra });
    return {
      thisMonth: range(h.thisMonthKey, h.thisMonthKey, `${monthLabel(h.thisMonthKey, true)} so far`),
      lastMonth: range(h.lastMonthKey, h.lastMonthKey, monthLabel(h.lastMonthKey, true)),
      trailing12: range(shiftMonth(h.thisMonthKey, -11), h.thisMonthKey, "Trailing 12 months"),
      prior12: range(shiftMonth(h.thisMonthKey, -23), shiftMonth(h.thisMonthKey, -12), "The 12 months before that"),
      ytd: range(`${year}-01`, h.thisMonthKey, `${year} to date`, { byYear: true }),
      lastYtd: range(`${year - 1}-01`, `${year - 1}-12`, `${year - 1}, same period`, { byYear: true, toDate: `${year - 1}${today.slice(4)}` }),
    } satisfies Record<string, Selection>;
  }, [now, h.thisMonthKey, h.lastMonthKey]);

  /** Previous equal-length window, for "vs prior" deltas on window totals. */
  const priorCount = useMemo(() => {
    if (win === "all") return null;
    const n = Number(win.replace("m", ""));
    return inWindow(basisRows, shiftMonth(from, -n), shiftMonth(from, -1), field).length;
  }, [basisRows, from, win, field]);

  return {
    data,
    now,
    basis,
    setBasis,
    field,
    setField,
    win,
    setWin,
    selection,
    setSelection,
    from,
    to,
    windowLabel,
    basisRows,
    rows,
    series,
    trend,
    slope,
    fam,
    h,
    targets,
    severities,
    types,
    families,
    latestRows,
    realInWindow,
    allInWindow,
    priorCount,
    selected,
    picks,
    disclosedRows,
    disclosedSeries,
    disclosedProducts,
    disclosedBusiest,
    fieldLabel: field === "incident_date" ? "incident date" : "first report",
  };
}

export type DashboardModel = ReturnType<typeof useDashboardModel>;
