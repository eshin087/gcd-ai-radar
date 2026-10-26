import { isAiRecord, isDisclosedIncident } from "./counting";
import { addDays, daysBetween, type FullIncident } from "./lifecycle";
import { buildLive, type LiveData, type LiveRow } from "./live";
import { monthRange, shiftMonth, toMonthKey } from "./stats";
import type { BreachStat, HomeStats, KevStatEntry, RecentCve, StatsFiles, StatsSource } from "./stats-schema";
import type { Lane } from "./taxonomy";

/**
 * The home page model: the live columns from lib/live.ts plus the statistics
 * the collector's daily stats stage fetched (data/stats, lib/stats-schema.ts),
 * turned into counters, series and the lists their drawers open. Built once
 * at build time; prebuild writes the statistics part as public/stats/home.json
 * and the drawer lists beside it, so scripts/check-home.mjs can compare the
 * page with the files it was built from. Every derived number states its
 * rule here and nowhere else.
 */

export const HOME_ROWS = 5;
export const KEV_MONTHS = 36;
export const BREACH_MONTHS = 36;
export const EPSS_TOP = 10;
export const LIST_CAP = 200;
/** Years with fewer KEV entries than this have no median worth showing. */
export const LAG_MIN_N = 10;
/**
 * The exploitation lag counts a KEV entry only when its CVE was published
 * within this many days before the listing: the catalog's first years listed
 * a backlog of exploited CVEs from a decade earlier, which says nothing about
 * how fast new flaws are exploited.
 */
export const LAG_MAX_DAYS = 365;
/** The day live news collection started; AI counts before it come from seeds and are sparse. */
export const COLLECTION_SINCE = "2026-10-18";
export const AI_CVE_FROM_QUARTER = "2016-Q1";

export interface HomeColumn {
  lane: Lane;
  label: string;
  live: number;
  /** One fact about the lane: records without a fix, or records with real loss. */
  note: string;
  rows: LiveRow[];
  href: string;
}

export interface HomeData {
  now: string;
  today: string;
  lastUpdated: string | null;
  live: LiveData;
  columns: { patch: HomeColumn; breach: HomeColumn; supply_chain: number; research: number };
  stats: HomeStats;
  aiLens: {
    live: number;
    month: string;
    quarter: string;
    attacksOnAiMonth: number;
    aiEnabledMonth: number;
    aiCvesQuarter: number;
    collectionSince: string;
  };
}

/* ---------- small helpers ---------- */

export function quarterKey(date: string): string {
  const month = Number(date.slice(5, 7));
  return `${date.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
}

export function quarterRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, q] = from.split("-Q").map(Number) as [number, number];
  const [ty, tq] = to.split("-Q").map(Number) as [number, number];
  while (y < ty || (y === ty && q <= tq)) {
    out.push(`${y}-Q${q}`);
    q += 1;
    if (q > 4) {
      q = 1;
      y += 1;
    }
  }
  return out;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A breach counts when HIBP verified it and it is a real breach: not a spam list, stealer log, malware dump, fabrication or retired entry. */
export function countableBreach(b: BreachStat): boolean {
  return b.verified && !b.spam_list && !b.stealer_log && !b.malware && !b.fabricated && !b.retired;
}

function byScoreDesc(a: RecentCve, b: RecentCve): number {
  return (b.score ?? -1) - (a.score ?? -1) || b.published.localeCompare(a.published) || a.id.localeCompare(b.id);
}

/* ---------- drawer lists ---------- */

/** The CVEs published in the last seven days, highest CVSS first, capped. */
export function weekCvesList(stats: StatsFiles, now: Date): RecentCve[] {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  return (stats.cvesRecent?.cves ?? []).filter((c) => c.published >= since).sort(byScoreDesc).slice(0, LIST_CAP);
}

/** Every CVE published in the last 24 hours, highest CVSS first: a day's list is a few hundred, so it is not capped. */
export function dayCvesList(stats: StatsFiles, now: Date): RecentCve[] {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  return (stats.cvesRecent?.cves ?? []).filter((c) => c.published >= since).sort(byScoreDesc);
}

export function kevMonthList(stats: StatsFiles, month: string): KevStatEntry[] {
  return (stats.kev?.entries ?? []).filter((e) => e.added.startsWith(month)).slice(0, LIST_CAP);
}

export function breachesMonthList(stats: StatsFiles, month: string): BreachStat[] {
  return (stats.hibp?.breaches ?? [])
    .filter((b) => countableBreach(b) && b.added.startsWith(month))
    .sort((a, b) => b.accounts - a.accounts || a.name.localeCompare(b.name))
    .slice(0, LIST_CAP);
}

/* ---------- series ---------- */

export function kevLagByYear(entries: readonly KevStatEntry[]): HomeStats["series"]["kev_lag_by_year"] {
  const byYear = new Map<number, number[]>();
  for (const e of entries) {
    if (!e.published) continue;
    const days = Math.max(0, daysBetween(e.published, e.added));
    if (days > LAG_MAX_DAYS) continue;
    const year = Number(e.added.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), days]);
  }
  return [...byYear.entries()]
    .filter(([, days]) => days.length >= LAG_MIN_N)
    .sort(([a], [b]) => a - b)
    .map(([year, days]) => ({ year, n: days.length, median_days: median(days), within_7d: Math.round((days.filter((d) => d <= 7).length / days.length) * 1000) / 1000 }));
}

export function aiCvesByQuarter(incidents: readonly FullIncident[], toQuarter: string): HomeStats["series"]["ai_cves_by_quarter"] {
  const counts = new Map<string, number>();
  for (const i of incidents) {
    if (!isAiRecord(i) || i.cve_ids.length === 0) continue;
    const q = quarterKey(i.first_reported);
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  return quarterRange(AI_CVE_FROM_QUARTER, toQuarter).map((quarter) => ({ quarter, total: counts.get(quarter) ?? 0, provisional: quarter === toQuarter }));
}

/* ---------- the model ---------- */

function column(live: LiveData, lane: "patch" | "breach"): HomeColumn {
  const board = live.boards.find((b) => b.key === lane)!;
  const rows = board.groups.flatMap((g) => g.rows);
  const note =
    lane === "patch"
      ? `${rows.filter((r) => r.patch_status === "unpatched" || r.patch_status === "partial").length} without a full fix`
      : `${rows.filter((r) => r.severity === 4).length} with confirmed loss`;
  return { lane, label: board.label, live: board.count, note, rows: rows.slice(0, HOME_ROWS), href: `/live?lane=${lane}` };
}

export function buildHome(incidents: readonly FullIncident[], stats: StatsFiles, now: Date, lastUpdated: string | null, site: string): HomeData {
  const live = buildLive(incidents, now, lastUpdated);
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const month = toMonthKey(now);
  const quarter = quarterKey(today);
  const counted = incidents.filter((i) => !isDisclosedIncident(i));
  const currentYear = Number(today.slice(0, 4));

  // counters
  const cves = stats.cvesRecent?.cves ?? null;
  const since24h = new Date(now.getTime() - 86_400_000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const kev = stats.kev?.entries ?? null;
  const kevWeekFrom = addDays(today, -7);
  const breaches = stats.hibp?.breaches.filter(countableBreach) ?? null;
  const breachesMonth = breaches?.filter((b) => b.added.startsWith(month)) ?? null;
  const nextDue = kev?.map((e) => e.due).filter((d): d is string => d !== null && d >= today).sort()[0] ?? null;

  // series
  const months = monthRange(shiftMonth(month, -(KEV_MONTHS - 1)), month);
  const kevByMonth = months.map((m) => {
    const inMonth = kev?.filter((e) => e.added.startsWith(m)) ?? [];
    return { month: m, total: inMonth.length, ransomware: inMonth.filter((e) => e.ransomware).length };
  });
  const breachMonths = monthRange(shiftMonth(month, -(BREACH_MONTHS - 1)), month);
  const breachesByMonth = breachMonths.map((m) => {
    const inMonth = breaches?.filter((b) => b.added.startsWith(m)) ?? [];
    return { month: m, breaches: inMonth.length, accounts: inMonth.reduce((s, b) => s + b.accounts, 0) };
  });

  // the EPSS ten: recently published CVEs most likely to be exploited, with our record when one exists
  const slugByCve = new Map<string, string>();
  for (const i of incidents) for (const id of i.cve_ids) if (!slugByCve.has(id)) slugByCve.set(id, i.slug);
  const epss = stats.epss?.scores ?? {};
  const epssTop = (cves ?? [])
    .filter((c) => epss[c.id])
    .map((c) => ({ cve: c.id, epss: epss[c.id]![0], percentile: epss[c.id]![1], score: c.score, severity: c.severity, published: c.published.slice(0, 10), description: c.description, slug: slugByCve.get(c.id) ?? null }))
    .sort((a, b) => b.epss - a.epss || (b.score ?? -1) - (a.score ?? -1) || a.cve.localeCompare(b.cve))
    .slice(0, EPSS_TOP);

  const sources: StatsSource[] = [];
  for (const s of [stats.nvdCounts?.source ?? stats.cvesRecent?.source, stats.kev?.source, stats.hibp?.source, stats.epss?.source]) {
    if (s && !sources.some((x) => x.name === s.name)) sources.push(s);
  }

  const homeStats: HomeStats = {
    generated_at: nowIso,
    site,
    fetched: {
      nvd: stats.cvesRecent?.fetched_at ?? stats.nvdCounts?.fetched_at ?? null,
      kev: stats.kev?.fetched_at ?? null,
      hibp: stats.hibp?.fetched_at ?? null,
      epss: stats.epss?.fetched_at ?? null,
    },
    sources,
    counters: {
      cves_24h: cves ? cves.filter((c) => c.published >= since24h).length : null,
      cves_7d: cves ? cves.filter((c) => c.published >= since7d).length : null,
      critical_7d: cves ? cves.filter((c) => c.published >= since7d && c.score !== null && c.score >= 9).length : null,
      kev_7d: kev ? kev.filter((e) => e.added > kevWeekFrom).length : null,
      kev_next_due: nextDue,
      breaches_month: breachesMonth ? breachesMonth.length : null,
      breached_accounts_month: breachesMonth ? breachesMonth.reduce((s, b) => s + b.accounts, 0) : null,
      live: live.counters.live,
    },
    series: {
      cves_by_year: (stats.nvdCounts?.years ?? []).map((y) => ({ year: y.year, total: y.total, provisional: y.year === currentYear })),
      ai_cves_by_quarter: aiCvesByQuarter(incidents, quarter),
      kev_by_month: kevByMonth,
      breaches_by_month: breachesByMonth,
      kev_lag_by_year: kevLagByYear(kev ?? []),
    },
    epss_top: epssTop,
    lists: {
      cves_day: { count: dayCvesList(stats, now).length, file: "/stats/cves-day.json" },
      cves_week: { count: weekCvesList(stats, now).length, file: "/stats/cves-week.json" },
      kev_month: { month, count: kevMonthList(stats, month).length, file: `/stats/kev-${month}.json` },
      breaches_month: { month, count: breachesMonthList(stats, month).length, file: `/stats/breaches-${month}.json` },
    },
  };

  const aiMonth = counted.filter((i) => isAiRecord(i) && i.first_reported.startsWith(month));
  return {
    now: nowIso,
    today,
    lastUpdated,
    live,
    columns: {
      patch: column(live, "patch"),
      breach: column(live, "breach"),
      supply_chain: live.boards.find((b) => b.key === "supply_chain")?.count ?? 0,
      research: live.boards.find((b) => b.key === "research")?.count ?? 0,
    },
    stats: homeStats,
    aiLens: {
      live: live.counters.ai,
      month,
      quarter,
      attacksOnAiMonth: aiMonth.filter((i) => i.type === "attack_on_ai").length,
      aiEnabledMonth: aiMonth.filter((i) => i.type === "ai_enabled_attack").length,
      aiCvesQuarter: homeStats.series.ai_cves_by_quarter.find((q) => q.quarter === quarter)?.total ?? 0,
      collectionSince: COLLECTION_SINCE,
    },
  };
}
