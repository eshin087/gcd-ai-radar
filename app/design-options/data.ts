import { loadIncidents } from "@/lib/data";
import type { Incident } from "@/lib/schema";
import {
  addTrend,
  categoryDistribution,
  headline,
  isRealWorld,
  latest,
  monthlySeries,
  severityDistribution,
  targetDistribution,
  toMonthKey,
  trendSlope,
  typeDistribution,
  yearRange,
  type Headline,
  type TrendPoint,
} from "@/lib/stats";

/**
 * Everything a homepage layout needs, computed once at build time from the
 * dataset. The real dashboard will reuse this shape (moved to lib/dashboard.ts
 * once a layout is chosen).
 */
export interface DashboardData {
  incidents: Incident[];
  realWorld: Incident[];
  isStub: boolean;
  now: string;
  window: { from: string; to: string };
  headline: Headline;
  headlineReal: Headline;
  trend: TrendPoint[];
  trendReal: TrendPoint[];
  slopePerMonth: number;
  categories: ReturnType<typeof categoryDistribution>;
  targets: ReturnType<typeof targetDistribution>;
  severities: ReturnType<typeof severityDistribution>;
  types: ReturnType<typeof typeDistribution>;
  latest: Incident[];
  /** Last 12 months of totals, oldest first, for sparklines. */
  spark: number[];
  sparkReal: number[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const { incidents, isStub } = await loadIncidents();
  const now = new Date();
  const range = yearRange(incidents);
  const from = `${Math.max(range?.min ?? now.getUTCFullYear(), 2016)}-01`;
  const to = toMonthKey(now);
  const realWorld = incidents.filter(isRealWorld);

  const series = monthlySeries(incidents, { from, to });
  const seriesReal = monthlySeries(realWorld, { from, to });
  const trend = addTrend(series);
  const trendReal = addTrend(seriesReal);

  return {
    incidents,
    realWorld,
    isStub,
    now: now.toISOString(),
    window: { from, to },
    headline: headline(incidents, { now }),
    headlineReal: headline(realWorld, { now }),
    trend,
    trendReal,
    slopePerMonth: trendSlope(series),
    categories: categoryDistribution(incidents),
    targets: targetDistribution(incidents),
    severities: severityDistribution(incidents),
    types: typeDistribution(incidents),
    latest: latest(incidents, 12),
    spark: series.slice(-12).map((p) => p.total),
    sparkReal: seriesReal.slice(-12).map((p) => p.total),
  };
}
