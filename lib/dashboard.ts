import { buildAggregates, type Aggregates } from "./aggregates";
import { aiLens } from "./counting";
import { lastUpdated, loadIncidents, loadRadar } from "./data";
import { compactRow, type Basis, type CompactRow } from "./rows";
import type { Radar } from "./schema";
import { buildScope, type Scope } from "./scope";
import { toMonthKey, yearRange } from "./stats";
import { buildThreatIntel, type ThreatIntel } from "./threatIntel";

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
  /** The last 90 days by first report, for the hero's threat feed. */
  intel: ThreatIntel;
  /** The last 120 days by first report as radar blips, for the hero's scope (lib/scope.ts). */
  scope: Scope;
}

export async function getDashboardData(): Promise<DashboardData> {
  const [{ incidents: all }, radar, updated] = await Promise.all([loadIncidents(), loadRadar(), lastUpdated()]);
  // The dashboard counts AI records only (lib/counting.ts aiLens): records with no AI role never reach its aggregates or drawers.
  const incidents = aiLens(all);
  const now = new Date();
  const range = yearRange(incidents);
  const earliest = Math.max(range?.min ?? now.getUTCFullYear(), 2016);
  const span = { from: `${earliest}-01`, to: toMonthKey(now) };
  const rows = incidents.map(compactRow);
  return {
    now: now.toISOString(),
    lastUpdated: updated,
    span,
    agg: buildAggregates(rows, { now, span }),
    radar,
    intel: buildThreatIntel(rows, now),
    scope: buildScope(rows, now),
  };
}
