import { shardManifest, shardsFor, type ShardInfo } from "./aggregates";
import { isDisclosedIncident } from "./counting";
import { isActionLane, type FullIncident } from "./lifecycle";
import { productFamily } from "./products";
import { compactRow } from "./rows";
import type { SlimIncident } from "./slim";
import type { DateField } from "./stats";
import { normalizeTag } from "./tags";
import {
  INCIDENT_TYPES,
  LANES,
  PATCH_STATUSES,
  RECORD_STATES,
  atlasFor,
  isAiType,
  isAtlasInUse,
  isOwaspInUse,
  owaspFor,
  type Category,
  type IncidentType,
  type Lane,
} from "./taxonomy";

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

export interface LaneFacet {
  records: number;
  incidents: number;
  disclosed: number;
  live: number;
}

export interface ExplorerFacets {
  /** Newest year first. */
  years: YearFacet[];
  /** Publisher name and record count, most frequent first (top 60). */
  publishers: [string, number][];
  /** Records per lane, for the lane tabs. */
  lanes: Record<Lane, LaneFacet>;
  /** Live records across the lanes. */
  live: number;
}

export function explorerFacets(incidents: readonly FullIncident[]): ExplorerFacets {
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
  const lanes = Object.fromEntries(LANES.map((l) => [l, { records: 0, incidents: 0, disclosed: 0, live: 0 }])) as Record<Lane, LaneFacet>;
  let live = 0;
  for (const i of incidents) {
    const l = lanes[i.lane];
    l.records += 1;
    if (isDisclosedIncident(i)) l.disclosed += 1;
    else l.incidents += 1;
    if (i.state === "live") {
      l.live += 1;
      live += 1;
    }
  }
  return { years, publishers, lanes, live };
}

/** The lane facet's count for a records kind ("" incidents, "disclosed", "all"). */
export function laneCount(facet: LaneFacet, kind: string): number {
  return kind === "all" ? facet.records : kind === "disclosed" ? facet.disclosed : facet.incidents;
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
  /** A lane (lib/taxonomy.ts LANES). */
  lane: string;
  /** "live" or "closed". */
  state: string;
  /** A tag slug (lib/tags.ts). */
  tag: string;
  /** One day, YYYY-MM-DD, on the date field `by` selects; set by the heatmaps. */
  day: string;
  /** Patch statuses, comma-separated ("unpatched,partial" is "not fully patched"). */
  patch: string;
  /** One quarter, YYYY-Qn, on the date field `by` selects; set by the home page's AI-CVE chart. */
  quarter: string;
  /** "cve": only records that name at least one CVE id. */
  has: string;
  sort: "reported" | "incident" | "severity";
}

export const EMPTY_FILTERS: ExplorerFilters = {
  q: "", type: "", category: "", severity: "", target: "", year: "", month: "", from: "", to: "", publisher: "", origin: "", real: "", by: "", product: "", kind: "", owasp: "", atlas: "",
  lane: "", state: "", tag: "", day: "", patch: "", quarter: "", has: "", sort: "reported",
};

const QUARTER = /^\d{4}-Q[1-4]$/;

/** The quarter a YYYY-MM… date falls in, as YYYY-Qn. */
export function quarterOf(date: string): string {
  const month = Number(date.slice(5, 7));
  return `${date.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/** The first and last month of a quarter, YYYY-MM. */
export function quarterMonths(quarter: string): [string, string] {
  const year = quarter.slice(0, 4);
  const q = Number(quarter.slice(6));
  const first = (q - 1) * 3 + 1;
  return [`${year}-${String(first).padStart(2, "0")}`, `${year}-${String(first + 2).padStart(2, "0")}`];
}

export function dateFieldOf(f: Pick<ExplorerFilters, "by">): DateField {
  return f.by === "reported" ? "first_reported" : "incident_date";
}

/** Filters that can match a record in any year, so every shard is needed to answer them. */
export function hasCategoricalFilter(f: ExplorerFilters): boolean {
  return Boolean(f.type || f.category || f.severity || f.target || f.publisher || f.origin || f.real || f.product || f.owasp || f.atlas || f.lane || f.state || f.tag || f.patch || f.has);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const YEAR = /^\d{4}$/;

/**
 * The URL query string is the explorer's state: every filter is read from it
 * and written back, so a view is a link. Values are checked against the
 * vocabularies so an unknown value selects nothing while the control shows
 * "all".
 */
export function parseFilters(search: string): ExplorerFilters {
  const p = new URLSearchParams(search);
  const get = (k: string) => p.get(k) ?? "";
  const sort = get("sort");
  const type = get("type");
  const owasp = get("owasp");
  const atlas = get("atlas");
  const kind = get("kind");
  const patch = get("patch")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => (PATCH_STATUSES as readonly string[]).includes(s));
  return {
    ...EMPTY_FILTERS,
    q: get("q"),
    type: type === "ai" || (INCIDENT_TYPES as readonly string[]).includes(type) ? type : "",
    category: get("category"),
    severity: /^[1-4]$/.test(get("severity")) ? get("severity") : "",
    target: get("target"),
    year: YEAR.test(get("year")) ? get("year") : "",
    month: MONTH.test(get("month")) ? get("month") : "",
    from: MONTH.test(get("from")) ? get("from") : "",
    to: MONTH.test(get("to")) ? get("to") : "",
    publisher: get("publisher"),
    origin: get("origin"),
    real: get("real") === "1" ? "1" : "",
    by: get("by") === "reported" ? "reported" : "",
    product: get("product"),
    kind: kind === "disclosed" || kind === "all" ? kind : "",
    // only ids the mapping can produce: anything else would select nothing while the select showed "all"
    owasp: isOwaspInUse(owasp) ? owasp : "",
    atlas: isAtlasInUse(atlas) ? atlas : "",
    // "action" is the three action lanes together, what the live counters link to
    lane: (LANES as readonly string[]).includes(get("lane")) || get("lane") === "action" ? get("lane") : "",
    state: (RECORD_STATES as readonly string[]).includes(get("state")) ? get("state") : "",
    tag: normalizeTag(get("tag")) ?? "",
    day: DAY.test(get("day")) ? get("day") : "",
    patch: patch.join(","),
    quarter: QUARTER.test(get("quarter")) ? get("quarter") : "",
    has: get("has") === "cve" ? "cve" : "",
    sort: sort === "incident" || sort === "severity" ? sort : "reported",
  };
}

/** The query string for a set of filters: every non-empty key, the default sort left out. */
export function filtersQuery(f: ExplorerFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v && !(k === "sort" && v === "reported")) p.set(k, v);
  return p.toString();
}

/** The date a record is placed by: first report, or the incident date with a year-only date at mid-year. */
export function recordDate(i: Pick<SlimIncident, "first_reported" | "incident_date">, f: Pick<ExplorerFilters, "by">): string {
  return f.by === "reported" ? i.first_reported : i.incident_date.length === 4 ? `${i.incident_date}-07` : i.incident_date;
}

/** Every filter but the search terms, which the component answers from its index. */
export function matchesRecord(i: SlimIncident, f: ExplorerFilters): boolean {
  if (f.kind === "" && i.disclosed) return false;
  if (f.kind === "disclosed" && !i.disclosed) return false;
  if (f.type === "ai" ? !isAiType(i.type) : f.type && i.type !== f.type) return false;
  if (f.category && !f.category.split(",").some((c) => i.categories.includes(c as Category))) return false;
  if (f.severity && String(i.severity) !== f.severity) return false;
  if (f.real === "1" && i.severity < 3) return false;
  if (f.target && !(i.targets as readonly string[]).includes(f.target)) return false;
  if (f.lane === "action" ? !isActionLane(i.lane) : f.lane && i.lane !== f.lane) return false;
  if (f.state && i.state !== f.state) return false;
  if (f.patch && !f.patch.split(",").includes(i.patch_status)) return false;
  if (f.tag && !i.tags.includes(f.tag)) return false;
  if (f.has === "cve" && i.cve_ids.length === 0) return false;
  const date = recordDate(i, f);
  if (f.day && date !== f.day) return false;
  if (f.month && !date.startsWith(f.month)) return false;
  if (f.quarter && quarterOf(date) !== f.quarter) return false;
  if (f.from && date.slice(0, 7) < f.from) return false;
  if (f.to && date.slice(0, 7) > f.to) return false;
  if (f.year && !f.month && !f.day && !i.first_reported.startsWith(f.year) && !i.incident_date.startsWith(f.year)) return false;
  if (f.publisher && !i.publishers.includes(f.publisher)) return false;
  if (f.origin && i.origin !== f.origin) return false;
  if (f.product && productFamily(i.products[0] ?? "") !== f.product) return false;
  return matchesStandards(i, f);
}

/** The records' order for a sort. */
export function compareRecords(a: SlimIncident, b: SlimIncident, sort: ExplorerFilters["sort"]): number {
  if (sort === "severity") return b.severity - a.severity || b.first_reported.localeCompare(a.first_reported);
  if (sort === "incident") return b.incident_date.localeCompare(a.incident_date) || b.first_reported.localeCompare(a.first_reported);
  return b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id);
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
  if (f.day) dateYears = shardsFor(facets.years, field, f.day.slice(0, 7), f.day.slice(0, 7));
  else if (f.month) dateYears = shardsFor(facets.years, field, f.month, f.month);
  else if (f.quarter) dateYears = shardsFor(facets.years, field, ...quarterMonths(f.quarter));
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
