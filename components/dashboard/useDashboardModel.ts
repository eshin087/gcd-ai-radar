"use client";

import { useMemo, useState } from "react";
import { useRowShards } from "@/components/dashboard/rowShards";
import { DEFAULT_WINDOW, deriveView, shardsFor, type WindowKey } from "@/lib/aggregates";
import type { Basis, DashboardData } from "@/lib/dashboard";
import { FAMILIES, familyOf, type Family } from "@/lib/families";
import { monthLabel } from "@/lib/format";
import { headlinePicks, selectRows, selectionMonths, type Selection } from "@/lib/selection";
import { addTrend, trendSlope, type DateField, type MonthlyPoint } from "@/lib/stats";

export type { WindowKey };

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

/**
 * Everything the dashboard needs: the three toggles (set, date basis,
 * window), every chart series and count for the current view read from the
 * build-time aggregates, the selections behind the headline numbers, and the
 * incidents behind a clicked mark, fetched by year shard when the drawer
 * opens (lib/aggregates.ts, lib/selection.ts).
 */
export function useDashboardModel(data: DashboardData) {
  const [basis, setBasis] = useState<Basis>("all");
  const [field, setField] = useState<DateField>("incident_date");
  const [win, setWin] = useState<WindowKey>(DEFAULT_WINDOW);
  const [selection, setSelection] = useState<Selection | null>(null);

  const now = useMemo(() => new Date(data.now), [data.now]);
  const view = useMemo(() => deriveView(data.agg, { basis, field, win, span: data.span }), [data.agg, data.span, basis, field, win]);
  const { from, to } = view;
  const windowLabel = win === "all" ? `all time (${monthLabel(from)} onward)` : `last ${win.replace("m", "")} months`;

  const trend = useMemo(() => addTrend(view.series), [view.series]);
  const slope = useMemo(() => trendSlope(view.series), [view.series]);
  const fam = useMemo(() => familySeries(view.series), [view.series]);
  const picks = useMemo(() => headlinePicks(view.h, now), [view.h, now]);

  // The drawer: which year shards can hold the selection, then the rows that are it.
  const neededShards = useMemo(() => {
    if (!selection) return [];
    const r = selectionMonths(selection, from, to);
    return shardsFor(data.agg.shards, field, r.from, r.to);
  }, [selection, from, to, field, data.agg.shards]);
  const shards = useRowShards(neededShards);
  const selected = useMemo(
    () => (selection && shards.rows ? selectRows(shards.rows, selection, basis, field, from, to) : null),
    [selection, shards.rows, basis, field, from, to],
  );

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
    /** Incidents of the basis in the window. */
    count: view.count,
    series: view.series,
    trend,
    slope,
    fam,
    h: view.h,
    targets: view.targets,
    severities: view.severities,
    types: view.types,
    families: view.families,
    famSev: view.famSev,
    typeFam: view.typeFam,
    famTarget: view.famTarget,
    dayCounts: view.dayCounts,
    prior: view.prior,
    priorFamilies: view.priorFamilies,
    notable: view.notable,
    latestRows: view.latestRows,
    realInWindow: view.realInWindow,
    allInWindow: view.allInWindow,
    sourcesInWindow: view.sourcesInWindow,
    priorCount: view.priorCount,
    /** Rows behind the selection, or null while their shards load. */
    selected,
    selectedError: shards.error,
    picks,
    disclosedCount: view.disclosedCount,
    disclosedSeries: view.disclosedSeries,
    disclosedProducts: view.disclosedProducts,
    disclosedBusiest: view.disclosedBusiest,
    fieldLabel: field === "incident_date" ? "incident date" : "first report",
  };
}

export type DashboardModel = ReturnType<typeof useDashboardModel>;
