import { lastUpdated, loadIncidents, loadRadar } from "./data";
import type { Incident, Radar } from "./schema";
import { DEFAULT_START_YEAR } from "./site";
import {
  categoryDistribution,
  headline,
  isRealWorld,
  latest,
  monthlySeries,
  severityDistribution,
  targetDistribution,
  toMonthKey,
  typeDistribution,
  yearRange,
  type CountRow,
  type DateField,
  type Headline,
  type MonthlyPoint,
} from "./stats";
import type { Category, IncidentType, Severity, Target } from "./taxonomy";

/**
 * Everything the dashboard renders, computed once at build time. Two bases
 * (all incidents / real-world only) × two date fields (when it happened /
 * when it was first reported) are precomputed so the toggles are instant.
 */

export type Basis = "all" | "real";
export const BASES: readonly Basis[] = ["all", "real"];
export const DATE_FIELDS: readonly DateField[] = ["incident_date", "first_reported"];

export interface BasisData {
  total: number;
  headline: Record<DateField, Headline>;
  /** Full-window monthly series per date field (slice client-side for the default window). */
  series: Record<DateField, MonthlyPoint[]>;
  categories: CountRow<Category>[];
  targets: CountRow<Target>[];
  severities: CountRow<`${Severity}`>[];
  types: CountRow<IncidentType>[];
  latest: Incident[];
}

export interface DashboardData {
  isStub: boolean;
  now: string;
  lastUpdated: string | null;
  windows: { full: { from: string; to: string }; default: { from: string; to: string } };
  basis: Record<Basis, BasisData>;
  radar: Radar | null;
}

function basisData(incidents: Incident[], now: Date, from: string, to: string): BasisData {
  const per = (field: DateField) => ({ h: headline(incidents, { now, dateField: field }), s: monthlySeries(incidents, { from, to, dateField: field }) });
  const inc = per("incident_date");
  const rep = per("first_reported");
  return {
    total: incidents.length,
    headline: { incident_date: inc.h, first_reported: rep.h },
    series: { incident_date: inc.s, first_reported: rep.s },
    categories: categoryDistribution(incidents),
    targets: targetDistribution(incidents),
    severities: severityDistribution(incidents),
    types: typeDistribution(incidents),
    latest: latest(incidents, 8),
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const [{ incidents, isStub }, radar, updated] = await Promise.all([loadIncidents(), loadRadar(), lastUpdated()]);
  const now = new Date();
  const range = yearRange(incidents);
  const earliest = Math.max(range?.min ?? now.getUTCFullYear(), 2016);
  const to = toMonthKey(now);
  const full = { from: `${earliest}-01`, to };
  const defaultStart = Math.max(earliest, DEFAULT_START_YEAR);
  const def = { from: `${defaultStart}-01`, to };
  const realWorld = incidents.filter(isRealWorld);
  return {
    isStub,
    now: now.toISOString(),
    lastUpdated: updated,
    windows: { full, default: def },
    basis: {
      all: basisData(incidents, now, full.from, full.to),
      real: basisData(realWorld, now, full.from, full.to),
    },
    radar,
  };
}
