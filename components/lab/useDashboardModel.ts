"use client";

import { useMemo, useState } from "react";
import type { Selection } from "@/components/dashboard/DrillDown";
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
 * Everything a dashboard layout needs, shared by the design-lab drafts: the
 * three toggles (set, date basis, window), every chart series computed for the
 * current view, and the incidents behind a clicked mark.
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

  const basisRows = useMemo(() => (basis === "real" ? data.rows.filter(isRealWorld) : data.rows), [data.rows, basis]);
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
  // A month range (trailing 12 months, year to date) can reach outside the window, so it reads the whole set.
  const selected = useMemo(
    () => (selection ? (selection.kind === "range" ? basisRows : rows).filter((r) => matches(r, selection, field)) : []),
    [selection, rows, basisRows, field],
  );

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
    fieldLabel: field === "incident_date" ? "incident date" : "first report",
  };
}

export type DashboardModel = ReturnType<typeof useDashboardModel>;
