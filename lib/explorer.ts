import { shardManifest, shardsFor, type ShardInfo } from "./aggregates";
import { compactRow } from "./rows";
import type { Incident } from "./schema";
import type { DateField } from "./stats";
import { atlasFor, owaspFor, type Category, type IncidentType } from "./taxonomy";

/**
 * What the incidents explorer knows before it has downloaded any record: the
 * years (one shard each, with counts and date ranges) and the publishers, so
 * its selects are complete from the first paint, and a rule for which year
 * shards a set of filters needs.
 */

export interface YearFacet extends ShardInfo {
  incidents: number;
  disclosed: number;
}

export interface ExplorerFacets {
  /** Newest year first. */
  years: YearFacet[];
  /** Publisher name and record count, most frequent first (top 60). */
  publishers: [string, number][];
}

export function explorerFacets(incidents: readonly Incident[]): ExplorerFacets {
  const rows = incidents.map(compactRow);
  const kinds = new Map<number, { incidents: number; disclosed: number }>();
  for (const r of rows) {
    const y = Number(r.first_reported.slice(0, 4));
    const k = kinds.get(y) ?? { incidents: 0, disclosed: 0 };
    if (r.disclosed) k.disclosed += 1;
    else k.incidents += 1;
    kinds.set(y, k);
  }
  const years = shardManifest(rows)
    .map((s) => ({ ...s, ...(kinds.get(s.year) ?? { incidents: 0, disclosed: 0 }) }))
    .sort((a, b) => b.year - a.year);
  const counts = new Map<string, number>();
  for (const i of incidents) for (const p of new Set(i.sources.map((s) => s.publisher))) counts.set(p, (counts.get(p) ?? 0) + 1);
  const publishers = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 60);
  return { years, publishers };
}

export interface ExplorerFilters {
  q: string;
  type: string;
  category: string;
  severity: string;
  target: string;
  year: string;
  /** YYYY-MM, set by dashboard drill-downs. */
  month: string;
  /** Inclusive YYYY-MM range, set by dashboard drill-downs (trailing 12 months, year to date). */
  from: string;
  to: string;
  publisher: string;
  origin: string;
  /** "1" = real-world only (severity 3-4), set by dashboard drill-downs. */
  real: string;
  /** "reported" dates by first report instead of incident date for month/year filters. */
  by: string;
  /** Family of the first product named (lib/products.ts), set by the dashboard's disclosed-vulnerability breakdown. */
  product: string;
  /** Record kind: "" incidents (default), "disclosed" disclosed vulnerabilities only, "all" both. */
  kind: string;
  /** OWASP Top 10 for LLM Applications id (LLM01…), derived from type and categories (lib/taxonomy.ts owaspFor). */
  owasp: string;
  /** MITRE ATLAS technique id (AML.T0051…), derived the same way (lib/taxonomy.ts atlasFor). */
  atlas: string;
  sort: "reported" | "incident" | "severity";
}

export const EMPTY_FILTERS: ExplorerFilters = { q: "", type: "", category: "", severity: "", target: "", year: "", month: "", from: "", to: "", publisher: "", origin: "", real: "", by: "", product: "", kind: "", owasp: "", atlas: "", sort: "reported" };

export function dateFieldOf(f: Pick<ExplorerFilters, "by">): DateField {
  return f.by === "reported" ? "first_reported" : "incident_date";
}

/** Filters that can match a record in any year, so every shard is needed to answer them. */
export function hasCategoricalFilter(f: ExplorerFilters): boolean {
  return Boolean(f.type || f.category || f.severity || f.target || f.publisher || f.origin || f.real || f.product || f.owasp || f.atlas);
}

/** The OWASP and ATLAS filters: computed from the record's type and categories, so the data files need no extra fields. */
export function matchesStandards(i: { type: IncidentType; categories: readonly Category[] }, f: Pick<ExplorerFilters, "owasp" | "atlas">): boolean {
  if (f.owasp && !(owaspFor(i) as string[]).includes(f.owasp)) return false;
  if (f.atlas && !(atlasFor(i) as string[]).includes(f.atlas)) return false;
  return true;
}

function countOfKind(y: YearFacet, kind: string): number {
  return kind === "all" ? y.records : kind === "disclosed" ? y.disclosed : y.incidents;
}

export interface NeededYears {
  years: number[];
  /**
   * "dates": the date filters bound the years; "search": the query's hits do;
   * "all": a filter or sort needs every year; "newest": the default list,
   * newest first, needs only enough years to fill what is shown; "index":
   * waiting for the search index, nothing new to load yet.
   */
  reason: "dates" | "search" | "all" | "newest" | "index";
}

/**
 * The shard years a view needs. Date filters pick years by the shard
 * manifest; a query picks the years of its hits; any other filter, or a sort
 * that is not by first report, needs every year; the default list needs the
 * newest years up to the rows shown.
 */
export function yearsNeeded(f: ExplorerFilters, facets: ExplorerFacets, searchYears: number[] | null, shown: number): NeededYears {
  const all = facets.years.map((y) => y.year);
  const field = dateFieldOf(f);
  let dateYears: number[] | null = null;
  if (f.month) dateYears = shardsFor(facets.years, field, f.month, f.month);
  else if (f.from || f.to) dateYears = shardsFor(facets.years, field, f.from || "0000-00", f.to || "9999-99");
  else if (f.year) {
    // The year filter matches either date, so a shard counts when its first-report year is the one asked or its incident dates reach into it.
    const byIncident = new Set(shardsFor(facets.years, "incident_date", `${f.year}-01`, `${f.year}-12`));
    dateYears = all.filter((y) => y === Number(f.year) || byIncident.has(y));
  }
  if (f.q.trim() && searchYears === null) {
    return { years: dateYears ?? [], reason: "index" };
  }
  if (dateYears !== null || searchYears !== null) {
    const years = all.filter((y) => (dateYears === null || dateYears.includes(y)) && (searchYears === null || searchYears.includes(y)));
    return { years, reason: dateYears !== null && searchYears === null ? "dates" : "search" };
  }
  if (hasCategoricalFilter(f) || f.sort !== "reported") return { years: all, reason: "all" };
  const years: number[] = [];
  let seen = 0;
  for (const y of facets.years) {
    years.push(y.year);
    seen += countOfKind(y, f.kind);
    if (seen >= shown) break;
  }
  return { years, reason: "newest" };
}

/** Records of the kind in the whole dataset. */
export function totalOfKind(facets: ExplorerFacets, kind: string): number {
  return facets.years.reduce((n, y) => n + countOfKind(y, kind), 0);
}
