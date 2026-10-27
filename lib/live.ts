import { isDisclosedIncident, isAiRecord } from "./counting";
import { familyOf, type Family } from "./families";
import { cveIdsOf, daysBetween, isActionLane, lastActivity, type FullIncident, type PatchGroup } from "./lifecycle";
import { productFamily } from "./products";
import { compactRow } from "./rows";
import { buildScope, type Scope } from "./scope";
import type { SlimIncident } from "./slim";
import { monthRange, primaryCategory, shiftMonth, toMonthKey } from "./stats";
import { buildTagIndex, tagSlugsOf, topLiveTags, type TagEntry } from "./tags";
import { ACTION_LANES, LANES, PATCH_META, type DatePrecision, type IncidentType, type Lane, type PatchStatus, type RecordState, type Severity } from "./taxonomy";

/**
 * The row: what a list of records shows about each one, on the live page,
 * in the archive, on tag and product pages and in the report drawer. Built
 * from a full record at build time (rowOf) or from a slim record in the
 * browser (rowOfSlim), so every list renders the same component.
 */
export interface LiveRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  lane: Lane;
  type: IncidentType;
  /** True for an AI record (lib/counting.ts aiLens). */
  ai: boolean;
  severity: Severity;
  state: RecordState;
  patch_status: PatchStatus;
  /** Product families named, at most three. */
  products: string[];
  /** CVE ids, at most three, with how many more there are. */
  cve_ids: string[];
  cve_more: number;
  action: string;
  since: string;
  since_precision: DatePrecision;
  first_reported: string;
  last_update: string;
  tags: string[];
  disclosed: boolean;
}

const MAX_PRODUCTS = 3;
const MAX_CVES = 3;

function families(products: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of products) {
    const f = productFamily(p);
    if (f && !out.includes(f)) out.push(f);
    if (out.length === MAX_PRODUCTS) break;
  }
  return out;
}

export function rowOf(i: FullIncident): LiveRow {
  return {
    id: i.id,
    slug: i.slug,
    title: i.title,
    summary: i.summary,
    lane: i.lane,
    type: i.type,
    ai: isAiRecord(i),
    severity: i.severity,
    state: i.state,
    patch_status: i.patch_status,
    products: families(i.products),
    cve_ids: i.cve_ids.slice(0, MAX_CVES),
    cve_more: Math.max(0, i.cve_ids.length - MAX_CVES),
    action: i.action,
    since: i.incident_date,
    since_precision: i.incident_date_precision,
    first_reported: i.first_reported,
    last_update: lastActivity(i),
    tags: tagSlugsOf(i),
    disclosed: isDisclosedIncident(i),
  };
}

/* ---------- The live page ---------- */

export type GroupKey = PatchGroup | "recent" | "older";

export interface LaneGroup {
  key: GroupKey;
  label: string;
  rows: LiveRow[];
}

/** One lane tab: its live rows in groups, and how many are AI records. */
export interface LaneBoard {
  /** A lane, or "all" for the three action lanes together. */
  key: Lane | "all";
  label: string;
  count: number;
  ai: number;
  groups: LaneGroup[];
}

export interface QuietRun {
  days: number;
  from: string;
  to: string;
}

export interface LiveCounters {
  /** Live records in the action lanes (patch, breach, supply chain). */
  live: number;
  /** Live action-lane records at severity 4 (confirmed real-world loss). */
  critical: number;
  /** Live patch and supply-chain records whose fix status is unpatched or partial. */
  unpatched: number;
  /** Live action-lane records that are AI records. */
  ai: number;
  /** Days since the newest action-lane incident was first reported, and the longest run without one in the last 365 days. */
  quiet: { days: number; longest: QuietRun | null };
}

export interface HeatCell {
  /** Incidents first reported that day, any lane. */
  reported: number;
  /** Severity-weighted activity: the sum of severities first reported that day plus half a point per later timeline entry dated that day. */
  activity: number;
}

export interface LiveData {
  now: string;
  lastUpdated: string | null;
  /** One board per lane, in tab order; the "All" tab (the three action lanes together) is `allBoard(boards, today)`, built where it is shown so no row ships twice. */
  boards: LaneBoard[];
  counters: LiveCounters;
  heatmap: { from: string; to: string; cells: Record<string, HeatCell>; max: number };
  aiLens: { live: number; month: string; topFamily: { family: Family; count: number } | null };
  /** The tags with the most live records (lib/tags.ts topLiveTags), without their record lists. */
  topTags: Pick<TagEntry, "slug" | "label" | "group" | "live" | "total">[];
  /** The hero's radar scope over every lane (lib/scope.ts). */
  scope: Scope;
}

/** Rows shown in full before "show more" takes over, per group. */
export const FULL_ROWS = 8;
const RECENT_DAYS = 7;

const GROUP_LABELS: Record<GroupKey, string> = {
  unpatched: PATCH_META.unpatched.label,
  partial: PATCH_META.partial.label,
  patched: PATCH_META.patched.label,
  other: "Patched or no fix stated",
  recent: "Updated this week",
  older: "Earlier",
};

function byActivity(a: LiveRow, b: LiveRow): number {
  return b.last_update.localeCompare(a.last_update) || b.severity - a.severity || b.first_reported.localeCompare(a.first_reported) || a.id.localeCompare(b.id);
}

function groupRows(rows: LiveRow[], keys: readonly GroupKey[], keyOf: (r: LiveRow) => GroupKey): LaneGroup[] {
  const buckets = new Map<GroupKey, LiveRow[]>(keys.map((k) => [k, []]));
  for (const r of rows) buckets.get(keyOf(r))!.push(r);
  return keys.map((key) => ({ key, label: GROUP_LABELS[key], rows: buckets.get(key)!.sort(byActivity) })).filter((g) => g.rows.length > 0);
}

function board(key: Lane | "all", label: string, rows: LiveRow[], today: string): LaneBoard {
  const byPatch = key === "patch" || key === "supply_chain";
  const groups = byPatch
    ? groupRows(rows, ["unpatched", "partial", "patched", "other"], (r) => (r.patch_status === "unpatched" || r.patch_status === "partial" || r.patch_status === "patched" ? r.patch_status : "other"))
    : groupRows(rows, ["recent", "older"], (r) => (daysBetween(r.last_update, today) <= RECENT_DAYS ? "recent" : "older"));
  return { key, label, count: rows.length, ai: rows.filter((r) => r.ai).length, groups };
}

/** The "All" tab: the three action lanes together, grouped by recency. */
export function allBoard(boards: readonly LaneBoard[], today: string): LaneBoard {
  const rows = boards.filter((b) => b.key !== "all" && b.key !== "research").flatMap((b) => b.groups.flatMap((g) => g.rows));
  return board("all", "All", rows, today);
}

/** The boards in tab order, the "All" tab in its place. */
export function boardsWithAll(boards: readonly LaneBoard[], today: string): LaneBoard[] {
  const out: LaneBoard[] = [];
  for (const b of boards) {
    if (b.key === "research") out.push(allBoard(boards, today));
    out.push(b);
  }
  if (!out.some((b) => b.key === "all")) out.push(allBoard(boards, today));
  return out;
}

/** The longest run of days without an action-lane incident in the last 365 days, counting up to today. */
export function longestQuietRun(days: readonly string[], today: string): QuietRun | null {
  const start = addDaysIso(today, -365);
  const sorted = [...new Set(days.filter((d) => d >= start && d <= today))].sort();
  if (sorted.length === 0) return null;
  const runs: QuietRun[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const n = daysBetween(sorted[i - 1]!, sorted[i]!) - 1;
    if (n > 0) runs.push({ days: n, from: addDaysIso(sorted[i - 1]!, 1), to: addDaysIso(sorted[i]!, -1) });
  }
  // the run that is still going
  const last = sorted[sorted.length - 1]!;
  const open = daysBetween(last, today);
  if (open > 0) runs.push({ days: open, from: addDaysIso(last, 1), to: today });
  return runs.reduce<QuietRun | null>((best, r) => (!best || r.days > best.days ? r : best), null);
}

function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function buildLive(incidents: readonly FullIncident[], now: Date, lastUpdated: string | null = null): LiveData {
  const today = now.toISOString().slice(0, 10);
  const counted = incidents.filter((i) => !isDisclosedIncident(i));
  const live = counted.filter((i) => i.state === "live");
  const rowsByLane = Object.fromEntries(LANES.map((l) => [l, [] as LiveRow[]])) as Record<Lane, LiveRow[]>;
  for (const i of live) rowsByLane[i.lane].push(rowOf(i));
  const actionRows = ACTION_LANES.flatMap((l) => rowsByLane[l]);

  const boards: LaneBoard[] = [
    board("patch", "Patch now", rowsByLane.patch, today),
    board("breach", "Breaches & attacks", rowsByLane.breach, today),
    board("supply_chain", "Supply chain", rowsByLane.supply_chain, today),
    board("research", "Research", rowsByLane.research, today),
  ];

  const actionDays = counted.filter((i) => isActionLane(i.lane)).map((i) => i.first_reported);
  const newest = actionDays.reduce((a, b) => (b > a ? b : a), "");
  const counters: LiveCounters = {
    live: actionRows.length,
    critical: actionRows.filter((r) => r.severity === 4).length,
    unpatched: actionRows.filter((r) => (r.lane === "patch" || r.lane === "supply_chain") && (r.patch_status === "unpatched" || r.patch_status === "partial")).length,
    ai: actionRows.filter((r) => r.ai).length,
    quiet: { days: newest ? Math.max(0, daysBetween(newest, today)) : 0, longest: longestQuietRun(actionDays, today) },
  };

  // the heatmap: twelve months of days by first report, weighted by severity, plus later timeline entries
  const month = toMonthKey(now);
  const from = shiftMonth(month, -11);
  const fromDay = `${from}-01`;
  const cells: Record<string, HeatCell> = {};
  const cell = (day: string) => (cells[day] ??= { reported: 0, activity: 0 });
  for (const i of counted) {
    if (i.first_reported >= fromDay && i.first_reported <= today) {
      const c = cell(i.first_reported);
      c.reported += 1;
      c.activity += i.severity;
    }
    for (const t of i.timeline) {
      if (t.date === i.first_reported || t.date < fromDay || t.date > today || t.date.length !== 10) continue;
      cell(t.date).activity += 0.5;
    }
  }
  const max = Object.values(cells).reduce((m, c) => Math.max(m, c.activity), 0);

  // the AI lens: live AI records in the action lanes, and the busiest AI family among this month's reports
  const famCounts = new Map<Family, number>();
  for (const i of counted) if (isAiRecord(i) && i.first_reported.startsWith(month)) famCounts.set(familyOf(primaryCategory(i)), (famCounts.get(familyOf(primaryCategory(i))) ?? 0) + 1);
  let topFamily: { family: Family; count: number } | null = null;
  for (const [family, count] of famCounts) if (!topFamily || count > topFamily.count) topFamily = { family, count };

  return {
    now: now.toISOString(),
    lastUpdated,
    boards,
    counters,
    heatmap: { from, to: today, cells, max },
    aiLens: { live: counters.ai, month, topFamily },
    topTags: topLiveTags(buildTagIndex(incidents, now), 12).map(({ slug, label, group, live, total }) => ({ slug, label, group, live, total })),
    scope: buildScope(incidents.map((i) => ({ ...compactRow(i), cve: cveIdsOf(i)[0] ?? null })), now),
  };
}

/** The months the heatmap spans, for tests and the footnote. */
export function heatmapMonths(data: Pick<LiveData, "heatmap">): string[] {
  return monthRange(data.heatmap.from, data.heatmap.to.slice(0, 7));
}

/** The same row from a slim record (no action line: the slim record carries none). */
export function rowOfSlim(s: SlimIncident): LiveRow {
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    summary: s.summary,
    lane: s.lane,
    type: s.type,
    ai: isAiRecord(s),
    severity: s.severity,
    state: s.state,
    patch_status: s.patch_status,
    products: families(s.products),
    cve_ids: s.cve_ids.slice(0, MAX_CVES),
    cve_more: Math.max(0, s.cve_ids.length - MAX_CVES),
    action: "",
    since: s.incident_date,
    since_precision: s.incident_date_precision,
    first_reported: s.first_reported,
    last_update: s.last_update,
    tags: s.tags,
    disclosed: s.disclosed,
  };
}
