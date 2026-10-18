import { buildAggregates, type Aggregates } from "./aggregates";
import { lastUpdated, loadIncidents, loadRadar } from "./data";
import { compactRow, type Basis, type CompactRow } from "./rows";
import type { Radar } from "./schema";
import { toMonthKey, yearRange } from "./stats";

/**
 * Build-time payload for the dashboard: monthly aggregates for both date
 * bases, the headline numbers, the newest incidents and the shard manifest
 * (lib/aggregates.ts). No rows: the browser fetches public/data/rows/<year>.json
 * when a number is clicked and its drawer needs the list.
 */

export type { Basis, CompactRow };
export { compactRow };

export interface DashboardData {
  now: string;
  lastUpdated: string | null;
  /** Month keys the data spans (for the "all" window). */
  span: { from: string; to: string };
  agg: Aggregates;
  radar: Radar | null;
}

export async function getDashboardData(): Promise<DashboardData> {
  const [{ incidents }, radar, updated] = await Promise.all([loadIncidents(), loadRadar(), lastUpdated()]);
  const now = new Date();
  const range = yearRange(incidents);
  const earliest = Math.max(range?.min ?? now.getUTCFullYear(), 2016);
  const span = { from: `${earliest}-01`, to: toMonthKey(now) };
  return {
    now: now.toISOString(),
    lastUpdated: updated,
    span,
    agg: buildAggregates(incidents.map(compactRow), { now, span }),
    radar,
  };
}
