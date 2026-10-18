import { isDisclosedIncident } from "./counting";
import { lastUpdated, loadIncidents, loadRadar } from "./data";
import type { Incident, Radar } from "./schema";
import { toMonthKey, yearRange } from "./stats";

/**
 * Build-time payload for the dashboard. Charts, tiles and drill-downs are
 * computed in the browser from a compact row per incident, so the window,
 * basis and date-field toggles never need precomputed variants.
 */

export type Basis = "all" | "real";

export interface CompactRow {
  id: string;
  slug: string;
  title: string;
  incident_date: string;
  incident_date_precision: Incident["incident_date_precision"];
  first_reported: string;
  type: Incident["type"];
  categories: Incident["categories"];
  severity: Incident["severity"];
  targets: Incident["targets"];
  source_count: number;
  /** A CVE or advisory with no confirmed exploitation: its own series, not an incident (lib/counting.ts). */
  disclosed: boolean;
  /** First product named, for the disclosed-vulnerability breakdown (empty for incidents). */
  product: string;
}

export interface DashboardData {
  isStub: boolean;
  now: string;
  lastUpdated: string | null;
  /** Month keys the data spans (for the "all" window). */
  span: { from: string; to: string };
  rows: CompactRow[];
  radar: Radar | null;
}

export function compactRow(i: Incident): CompactRow {
  return {
    id: i.id,
    slug: i.slug,
    title: i.title,
    incident_date: i.incident_date,
    incident_date_precision: i.incident_date_precision,
    first_reported: i.first_reported,
    type: i.type,
    categories: i.categories,
    severity: i.severity,
    targets: i.targets,
    source_count: i.source_count,
    disclosed: isDisclosedIncident(i),
    product: isDisclosedIncident(i) ? (i.products[0] ?? "") : "",
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const [{ incidents, isStub }, radar, updated] = await Promise.all([loadIncidents(), loadRadar(), lastUpdated()]);
  const now = new Date();
  const range = yearRange(incidents);
  const earliest = Math.max(range?.min ?? now.getUTCFullYear(), 2016);
  return {
    isStub,
    now: now.toISOString(),
    lastUpdated: updated,
    span: { from: `${earliest}-01`, to: toMonthKey(now) },
    rows: incidents.map(compactRow),
    radar,
  };
}
