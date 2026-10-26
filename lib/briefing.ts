import { isDisclosedIncident } from "./counting";
import { FAMILIES, familyOf, type Family } from "./families";
import type { Briefing, BriefingIncident, BriefingNumbers, Incident } from "./schema";
import { isRealWorld, pctChange, primaryCategory } from "./stats";
import { aiLens } from "./counting";
import { AI_TYPES, SEVERITIES, TARGETS, type AiType, type Severity, type Target } from "./taxonomy";

/**
 * The weekly briefing's arithmetic: ISO weeks, which records belong to a
 * week, the counts, the week-over-week deltas and the ranking of notable
 * incidents. Dependency-free and unit-tested; the collector writes the
 * result to data/briefings/<week>.json and the site renders it. The
 * narrative is the collector's business (collector/briefing.ts): nothing
 * here talks to a language model.
 *
 * Weeks are ISO 8601 weeks (Monday to Sunday, UTC), keyed "YYYY-Www". A
 * record belongs to the week of its first_reported date. The same counting
 * rules as everywhere else apply (lib/counting.ts): disclosed CVEs with no
 * confirmed exploitation are reported on their own line, never as incidents.
 */

export const ISO_WEEK_RE = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

const DAY_MS = 86400000;

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday of ISO week 1 of `year`: the Monday on or before 4 January. */
function mondayOfWeekOne(year: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  jan4.setUTCDate(4 - ((jan4.getUTCDay() + 6) % 7));
  return jan4;
}

/** "2026-10-18" -> "2026-W42". Year boundaries follow ISO 8601 ("2024-12-30" -> "2025-W01"). */
export function isoWeekOf(isoDate: string): string {
  const d = utcDate(isoDate);
  // Thursday of the same week decides the ISO year.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const year = d.getUTCFullYear();
  const week = Math.round((d.getTime() - mondayOfWeekOne(year).getTime()) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** 52 or 53. */
export function weeksInYear(year: number): number {
  return Number(isoWeekOf(`${year}-12-28`).slice(6));
}

/** Parses "YYYY-Www"; null when malformed or the week does not exist in that year. */
export function parseIsoWeek(key: string): { year: number; week: number } | null {
  const m = key.match(ISO_WEEK_RE);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week > weeksInYear(year)) return null;
  return { year, week };
}

/** Monday and Sunday (inclusive) of a week. Throws on an invalid key. */
export function isoWeekRange(key: string): { start: string; end: string } {
  const parsed = parseIsoWeek(key);
  if (!parsed) throw new Error(`not an ISO week: "${key}" (expected YYYY-Www, e.g. 2026-W42)`);
  const start = mondayOfWeekOne(parsed.year);
  start.setUTCDate(start.getUTCDate() + (parsed.week - 1) * 7);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return { start: isoDay(start), end: isoDay(end) };
}

export function shiftIsoWeek(key: string, delta: number): string {
  const { start } = isoWeekRange(key);
  const d = utcDate(start);
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return isoWeekOf(isoDay(d));
}

/** The week before the one that contains `now` (UTC): on a Monday morning, the week that ended on Sunday. */
export function previousIsoWeek(now: Date): string {
  return shiftIsoWeek(isoWeekOf(isoDay(now)), -1);
}

/** "2026-W42" -> "Week 42 of 2026". */
export function isoWeekLabel(key: string): string {
  const parsed = parseIsoWeek(key);
  return parsed ? `Week ${parsed.week} of ${parsed.year}` : key;
}

/** Records whose first_reported falls inside the week (inclusive). */
export function weekRecords<T extends Pick<Incident, "first_reported">>(records: readonly T[], key: string): T[] {
  const { start, end } = isoWeekRange(key);
  return records.filter((r) => r.first_reported >= start && r.first_reported <= end);
}

export interface WeekCounts {
  records: number;
  incidents: number;
  real_world: number;
  disclosed_vulnerabilities: number;
}

type Counted = Pick<Incident, "origin" | "severity" | "sources">;

export function splitWeek<T extends Counted>(records: readonly T[]): { incidents: T[]; disclosed: T[] } {
  const incidents: T[] = [];
  const disclosed: T[] = [];
  for (const r of records) (isDisclosedIncident(r) ? disclosed : incidents).push(r);
  return { incidents, disclosed };
}

export function countWeek(records: readonly Counted[]): WeekCounts {
  const { incidents, disclosed } = splitWeek(records);
  return {
    records: records.length,
    incidents: incidents.length,
    real_world: incidents.filter(isRealWorld).length,
    disclosed_vulnerabilities: disclosed.length,
  };
}

export interface Delta {
  now: number;
  before: number;
  /** now − before */
  change: number;
  /** Percentage change; null when the week before had none and this one has some ("new"). */
  pct: number | null;
}

export function delta(now: number, before: number): Delta {
  return { now, before, change: now - before, pct: pctChange(now, before) };
}

/**
 * Most notable first: highest severity, then most sources, then most recently
 * reported, then by id so the order is total and reproducible.
 */
export function rankNotable<T extends Pick<Incident, "severity" | "source_count" | "first_reported" | "id">>(incidents: readonly T[]): T[] {
  return [...incidents].sort(
    (a, b) => b.severity - a.severity || b.source_count - a.source_count || b.first_reported.localeCompare(a.first_reported) || a.id.localeCompare(b.id),
  );
}

export function familyCounts(incidents: readonly Pick<Incident, "categories">[]): Record<Family, number> {
  const out = Object.fromEntries(FAMILIES.map((f) => [f, 0])) as Record<Family, number>;
  for (const i of incidents) out[familyOf(primaryCategory(i))] += 1;
  return out;
}

/** The family (of the primary category) with the most incidents; ties go to the earlier family in FAMILIES. Null for an empty week. */
export function busiestFamily(incidents: readonly Pick<Incident, "categories">[]): { family: Family; count: number } | null {
  const counts = familyCounts(incidents);
  let best: { family: Family; count: number } | null = null;
  for (const f of FAMILIES) if (counts[f] > 0 && (!best || counts[f] > best.count)) best = { family: f, count: counts[f] };
  return best;
}

/** Targets listed most often, "n/a" left out; ties follow the taxonomy order. */
export function topTargets(incidents: readonly Pick<Incident, "targets">[], n = 3): { target: Target; count: number }[] {
  const counts = new Map<Target, number>();
  for (const i of incidents) for (const t of new Set(i.targets)) if (t !== "n/a") counts.set(t, (counts.get(t) ?? 0) + 1);
  return TARGETS.filter((t) => counts.has(t))
    .map((target) => ({ target, count: counts.get(target)! }))
    .sort((a, b) => b.count - a.count || TARGETS.indexOf(a.target) - TARGETS.indexOf(b.target))
    .slice(0, n);
}

export function briefingIncident(i: Incident): BriefingIncident {
  return {
    id: i.id,
    slug: i.slug,
    title: i.title,
    type: i.type,
    category: primaryCategory(i),
    family: familyOf(primaryCategory(i)),
    severity: i.severity,
    targets: i.targets,
    first_reported: i.first_reported,
    source_count: i.source_count,
  };
}

export const NOTABLE_COUNT = 5;

/**
 * Everything in a briefing that comes from the data. `all` is the published
 * dataset; the week before is counted from the same records, so a delta never
 * depends on an earlier briefing file.
 */
export function briefingNumbers(all: readonly Incident[], week: string): BriefingNumbers {
  const { start, end } = isoWeekRange(week);
  const previousWeek = shiftIsoWeek(week, -1);
  // The briefing is the AI week: records with no AI role never enter its counts (lib/counting.ts aiLens).
  const ai = aiLens(all);
  const thisWeek = weekRecords(ai, week);
  const { incidents, disclosed } = splitWeek(thisWeek);
  const now = countWeek(thisWeek);
  const before = countWeek(weekRecords(ai, previousWeek));
  return {
    week,
    start,
    end,
    counts: {
      records: now.records,
      incidents: now.incidents,
      real_world: now.real_world,
      disclosed_vulnerabilities: disclosed.length,
      by_type: Object.fromEntries(AI_TYPES.map((t) => [t, incidents.filter((i) => i.type === t).length])) as Record<AiType, number>,
      by_family: familyCounts(incidents),
      by_severity: Object.fromEntries(SEVERITIES.map((s) => [String(s), incidents.filter((i) => i.severity === s).length])) as Record<`${Severity}`, number>,
    },
    previous: { week: previousWeek, incidents: before.incidents, real_world: before.real_world, disclosed_vulnerabilities: before.disclosed_vulnerabilities },
    deltas: {
      incidents: delta(now.incidents, before.incidents),
      real_world: delta(now.real_world, before.real_world),
      disclosed_vulnerabilities: delta(now.disclosed_vulnerabilities, before.disclosed_vulnerabilities),
    },
    busiest_family: busiestFamily(incidents),
    top_targets: topTargets(incidents),
    notable: rankNotable(incidents).slice(0, NOTABLE_COUNT).map(briefingIncident),
  };
}

/** The records a briefing describes: the AI records first reported in the week, the same set briefingNumbers counts. */
export function briefingRecords(all: readonly Incident[], week: string): Incident[] {
  return weekRecords(aiLens(all), week);
}

/** One line of numbers, the same everywhere the briefing is summarised (list page, RSS, job summary). */
export function briefingSummaryLine(b: Pick<Briefing, "counts" | "deltas">): string {
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    `${plural(b.counts.incidents, "incident")} (${sign(b.deltas.incidents.change)} vs the week before)`,
    `${b.counts.real_world} real-world`,
    `${plural(b.counts.disclosed_vulnerabilities, "disclosed CVE")} (${sign(b.deltas.disclosed_vulnerabilities.change)})`,
  ].join(" · ");
}
