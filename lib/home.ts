import { isAiRecord, isDisclosedIncident } from "./counting";
import { addDays, daysBetween, type FullIncident } from "./lifecycle";
import { buildLive, type LiveData, type LiveRow } from "./live";
import { buildPanel, type PanelData } from "./panel";
import type { StackFile } from "./panel/stack";
import { monthRange, shiftMonth, toMonthKey } from "./stats";
import type { BreachStat, HomeStats, KevStatEntry, RecentCve, StatsFiles, StatsSource } from "./stats-schema";
import type { Lane, PatchStatus } from "./taxonomy";

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
/** Days of CVE volume the hero cluster's sparkline shows. */
export const CLUSTER_DAYS = 14;
/** Items each hero cluster tile cycles through. */
export const CLUSTER_ITEMS = 6;
export const CLUSTER_BREACHES = 8;

export interface ClusterKev {
  /** The group's first CVE. */
  cve: string;
  vendor: string;
  product: string;
  added: string;
  due: string;
  /** The group's highest CVSS, null when none is scored. */
  cvss: number | null;
  /** Entries folded into this one: the same vendor, product and deadline. */
  n: number;
}

export type ClusterLane = "patch" | "breach" | "supply_chain";

/** What the Open tile draws of a record; the tile links the live board, so no slug ships with it. */
export interface ClusterOpen {
  /** The first product family named, else the title. */
  name: string;
  lane: ClusterLane;
  patch: PatchStatus;
  reported: string;
}

/**
 * The hero's middle column, four instruments in a 2x2 (components/hero/
 * RadarCluster.tsx), from the same files and rules as the counters: every
 * number it shows is a counter on the page or a count behind one. The browser
 * only drops KEV entries whose deadline passed after the build and runs the
 * clocks.
 */
export interface ClusterData {
  /** KEV entries whose deadline is on or after the build day (the kev_next_due rule), nearest deadline first. Null without the KEV file. */
  kev: ClusterKev[] | null;
  /** Live severity 3+ records in the three action lanes, per lane, and the newest of them. */
  open: { lanes: Record<ClusterLane, number>; total: number; rows: ClusterOpen[] };
  /**
   * The three CVE counters, and CVEs per rolling 24 hours over CLUSTER_DAYS,
   * oldest first: the last window holds the 24 h count and the last seven add
   * up to the 7 d one. Null without the recent-CVE file.
   */
  cves: { day: number; week: number; critical: number; perDay: number[]; criticalPerDay: number[] } | null;
  /** The month's breached-accounts counter and its countable breaches, newest first. Null without the HIBP file. */
  breaches: { month: string; accounts: number; rows: { title: string; accounts: number; added: string }[] } | null;
}

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
  cluster: ClusterData;
  /** The instrument panel below the hero (lib/panel). */
  panel: PanelData;
  /** Every stack candidate, for public/stats/stack.json; the page never ships it inline. */
  stackFile: StackFile;
  /** CVEs CISA listed in the last 90 days with a known publish date, and how many were listed the day they were published or within a week (the lag chart on /trends). */
  kevLagRecent: { n: number; sameDay: number; week: number };
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

/**
 * Where the CVE windows end: when NVD was fetched (or the newest CVE in the
 * file, if later), never after `now`. The stats stage fetches NVD about once
 * a day while the site rebuilds every hour, so windows counted back from the
 * build time would hold only the hours the file covers; counted back from the
 * fetch, "24 hours" is always a whole 24 hours. The page's live layer brings
 * the counts up to the minute.
 */
export function cveEnd(stats: StatsFiles, now: Date): number {
  const r = stats.cvesRecent;
  if (!r) return now.getTime();
  const newest = r.cves.reduce((m, c) => Math.max(m, Date.parse(c.published)), 0);
  return Math.min(now.getTime(), Math.max(Date.parse(r.fetched_at), newest));
}

function cvesSince(stats: StatsFiles, now: Date, ms: number): RecentCve[] {
  const end = cveEnd(stats, now);
  const since = new Date(end - ms).toISOString();
  const until = new Date(end).toISOString();
  return (stats.cvesRecent?.cves ?? []).filter((c) => c.published >= since && c.published <= until);
}

/** The CVEs published in the seven days before the fetch, highest CVSS first, capped. */
export function weekCvesList(stats: StatsFiles, now: Date): RecentCve[] {
  return cvesSince(stats, now, 7 * 86_400_000).sort(byScoreDesc).slice(0, LIST_CAP);
}

/** Every CVE published in the 24 hours before the fetch, highest CVSS first: a day's list is a few hundred, so it is not capped. */
export function dayCvesList(stats: StatsFiles, now: Date): RecentCve[] {
  return cvesSince(stats, now, 86_400_000).sort(byScoreDesc);
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

/* ---------- the hero cluster ---------- */

/** A CVE's 24-hour window counted back from `now`: 0 holds what the 24 h counter counts (published >= now - 24 h). */
function windowFromEnd(published: string, nowMs: number): number {
  return Math.max(0, Math.ceil((nowMs - Date.parse(published)) / 86_400_000) - 1);
}

export function buildCluster(live: LiveData, stats: StatsFiles, home: HomeStats, now: Date): ClusterData {
  const today = now.toISOString().slice(0, 10);
  const c = home.counters;

  // KEV: every deadline still ahead, folded per product and deadline. Not only the week's additions: CISA sets some deadlines three days out, so the week's can all be past while older ones are still open.
  let kev: ClusterKev[] | null = null;
  if (stats.kev) {
    const groups: ClusterKev[] = [];
    for (const e of stats.kev.entries) {
      if (!e.due || e.due < today) continue;
      const g = groups.find((x) => x.vendor === e.vendor && x.product === e.product && x.due === e.due);
      if (!g) groups.push({ cve: e.cve, vendor: e.vendor, product: e.product, added: e.added, due: e.due, cvss: e.cvss, n: 1 });
      else {
        g.n += 1;
        if (e.cvss !== null && (g.cvss === null || e.cvss > g.cvss)) g.cvss = e.cvss;
      }
    }
    kev = groups.sort((a, b) => a.due.localeCompare(b.due) || (b.cvss ?? -1) - (a.cvss ?? -1) || a.cve.localeCompare(b.cve)).slice(0, CLUSTER_ITEMS);
  }

  // open: our live records of severity 3 and up in the action lanes
  const lanes: Record<ClusterLane, number> = { patch: 0, breach: 0, supply_chain: 0 };
  const open: (ClusterOpen & { slug: string; update: string })[] = [];
  for (const b of live.boards) {
    if (b.key !== "patch" && b.key !== "breach" && b.key !== "supply_chain") continue;
    for (const r of b.groups.flatMap((g) => g.rows)) {
      if (r.severity < 3) continue;
      lanes[b.key] += 1;
      open.push({ slug: r.slug, name: r.products[0] ?? r.title, lane: b.key, patch: r.patch_status, reported: r.first_reported, update: r.last_update });
    }
  }
  open.sort((a, b) => b.reported.localeCompare(a.reported) || b.update.localeCompare(a.update) || a.slug.localeCompare(b.slug));

  // CVEs: the counters, and the rolling windows behind them
  let cves: ClusterData["cves"] = null;
  const recent = stats.cvesRecent?.cves;
  if (recent && c.cves_24h !== null && c.cves_7d !== null && c.critical_7d !== null) {
    const end = cveEnd(stats, now);
    const perDay = new Array<number>(CLUSTER_DAYS).fill(0);
    const criticalPerDay = new Array<number>(CLUSTER_DAYS).fill(0);
    for (const v of recent) {
      if (Date.parse(v.published) > end) continue;
      const k = windowFromEnd(v.published, end);
      if (k >= CLUSTER_DAYS) continue;
      perDay[CLUSTER_DAYS - 1 - k]! += 1;
      if (v.score !== null && v.score >= 9) criticalPerDay[CLUSTER_DAYS - 1 - k]! += 1;
    }
    cves = { day: c.cves_24h, week: c.cves_7d, critical: c.critical_7d, perDay, criticalPerDay };
  }

  // breaches: the month's countable breaches, newest first
  let breaches: ClusterData["breaches"] = null;
  const month = home.lists.breaches_month.month;
  if (stats.hibp && c.breached_accounts_month !== null) {
    const rows = stats.hibp.breaches
      .filter((b) => countableBreach(b) && b.added.startsWith(month))
      .sort((a, b) => b.added.localeCompare(a.added) || b.accounts - a.accounts || a.name.localeCompare(b.name))
      .slice(0, CLUSTER_BREACHES)
      .map((b) => ({ title: b.title, accounts: b.accounts, added: b.added }));
    breaches = { month, accounts: c.breached_accounts_month, rows };
  }

  return {
    kev,
    open: {
      lanes,
      total: lanes.patch + lanes.breach + lanes.supply_chain,
      rows: open.slice(0, CLUSTER_ITEMS).map((r) => ({ name: r.name, lane: r.lane, patch: r.patch, reported: r.reported })),
    },
    cves,
    breaches,
  };
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
  const cves = stats.cvesRecent ? cvesSince(stats, now, 7 * 86_400_000) : null;
  const since24h = new Date(cveEnd(stats, now) - 86_400_000).toISOString();
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
  // over the whole recent file (two weeks), not only the 7 days the counters use
  const epssTop = (stats.cvesRecent?.cves ?? [])
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
      cves_7d: cves ? cves.length : null,
      critical_7d: cves ? cves.filter((c) => c.score !== null && c.score >= 9).length : null,
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
  const { panel, stackFile } = buildPanel(incidents, stats, homeStats, now);
  const lagFrom = addDays(today, -90);
  const lags = (kev ?? []).filter((e) => e.added > lagFrom && e.published).map((e) => Math.max(0, daysBetween(e.published!, e.added)));
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
    cluster: buildCluster(live, stats, homeStats, now),
    panel,
    stackFile,
    kevLagRecent: { n: lags.length, sameDay: lags.filter((d) => d === 0).length, week: lags.filter((d) => d <= 7).length },
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
