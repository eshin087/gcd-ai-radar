import { CvesRecentSchema, NvdCountsSchema, STATS_FILES, type CvesRecent, type NvdCounts, type RecentCve, type StatsSource } from "../../lib/stats-schema";
import { addDays } from "../lib/ids";
import { truncate } from "../lib/text";
import type { StatsContext, StatsModule } from "./types";

/**
 * NVD CVE API 2.0 for the statistics the home page shows: how many CVEs were
 * published per year since 1999 (totalResults over publish-date windows of
 * at most 120 days, one tiny request per window), every CVE published in the
 * last 30 days (id, CVSS, one line of description), and the publish date and
 * CVSS of every CVE in CISA's KEV catalog (the hasKev query, for kev.ts).
 *
 * Verified against nvd.nist.gov/developers on 2026-10-26: the 120-day
 * maximum, totalResults with resultsPerPage=1, hasKev and noRejected as
 * value-less flags, 5 requests per rolling 30 s without an API key and 50
 * with one. Every NVD call in the process shares one clock so the spacing
 * holds across modules. Required notice on the site: "This product uses data
 * from the NVD API but is not endorsed or certified by the NVD."
 */

export const NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0";
export const NVD_SOURCE: StatsSource = {
  name: "NVD",
  url: "https://nvd.nist.gov/developers/vulnerabilities",
  license: "NIST data, public domain. This product uses data from the NVD API but is not endorsed or certified by the NVD.",
};
/** NVD allows 120 consecutive days per date-range request; windows are [from, from + 119]. */
export const NVD_WINDOW_DAYS = 119;
/**
 * How far back the recent-CVE file reaches. NVD published about 530 CVEs a
 * day in October 2026 (16,015 in 30 days, measured), so the window is two
 * weeks and the description is kept only where a list shows it: the last
 * seven days (the counters' drawers) and anything scored 9.0 or higher.
 */
export const RECENT_DAYS = 14;
export const DESCRIBED_DAYS = 7;
export const FIRST_YEAR = 1999;
/** Closed years older than this many years before the current one are copied from the previous file instead of asked again. */
const REFRESH_YEARS = 1;
/**
 * Records per page. NVD allows 2,000 but serves about 140 KB/s, so a page of
 * 2,000 full records (19 MB for the KEV set, measured 2026-10-26) takes over
 * two minutes; 500 keeps each request under a minute.
 */
const PAGE = 500;
const DESCRIPTION_CHARS = 160;

export function nvdStamp(date: string, end = false): string {
  return `${date}T${end ? "23:59:59.999" : "00:00:00.000"}+00:00`;
}

/** Consecutive windows of at most `days + 1` calendar days covering [from, to]. */
export function windows(from: string, to: string, days = NVD_WINDOW_DAYS): [string, string][] {
  const out: [string, string][] = [];
  for (let start = from; start <= to; start = addDays(start, days + 1)) {
    const end = addDays(start, days) < to ? addDays(start, days) : to;
    out.push([start, end]);
  }
  return out;
}

export function yearWindows(year: number, today: string): [string, string][] {
  const last = `${year}-12-31`;
  return windows(`${year}-01-01`, last < today ? last : today);
}

export interface NvdCve {
  id: string;
  published: string;
  lastModified?: string;
  vulnStatus?: string;
  cisaExploitAdd?: string;
  descriptions?: { lang: string; value: string }[];
  metrics?: Record<string, { cvssData?: { baseScore?: number; baseSeverity?: string; version?: string } }[] | undefined>;
}

export interface NvdResponse {
  totalResults: number;
  resultsPerPage: number;
  startIndex: number;
  vulnerabilities?: { cve: NvdCve }[];
}

/* ---------- one clock for every NVD request in the process ---------- */

let lastCallAt = 0;

/** Resets the shared spacing clock (tests). */
export function resetNvdClock() {
  lastCallAt = 0;
}

export async function nvdGet(ctx: StatsContext, params: Record<string, string>, flags: readonly string[] = ["noRejected"]): Promise<NvdResponse> {
  const apiKey = process.env.NVD_API_KEY;
  const spacing = apiKey ? 700 : 6500;
  const wait = lastCallAt + spacing - Date.now();
  if (wait > 0) await ctx.http.sleep(wait);
  lastCallAt = Date.now();
  const query = new URLSearchParams(params).toString();
  const url = `${NVD_BASE}?${[query, ...flags].filter(Boolean).join("&")}`;
  return ctx.http.json<NvdResponse>(url, {
    userAgent: ctx.settings.fetch.user_agent,
    timeoutMs: 180_000,
    retries: 2,
    backoffMs: 7000,
    headers: apiKey ? { apiKey } : {},
    maxBytes: 20_000_000,
  });
}

/** How many CVEs NVD published in [from, to], without downloading them. */
export async function countPublished(ctx: StatsContext, from: string, to: string): Promise<number> {
  const res = await nvdGet(ctx, { pubStartDate: nvdStamp(from), pubEndDate: nvdStamp(to, true), resultsPerPage: "1" });
  return res.totalResults;
}

async function* pages(ctx: StatsContext, params: Record<string, string>, flags: readonly string[]): AsyncGenerator<NvdCve> {
  let startIndex = 0;
  for (let page = 0; page < 50; page++) {
    const res = await nvdGet(ctx, { ...params, resultsPerPage: String(PAGE), startIndex: String(startIndex) }, flags);
    const batch = res.vulnerabilities ?? [];
    for (const v of batch) yield v.cve;
    const got = res.startIndex + batch.length;
    if (batch.length === 0 || got >= res.totalResults) return;
    startIndex = got;
  }
}

/* ---------- mapping ---------- */

/** NVD timestamps carry no zone and are UTC; the site stores them as ISO with Z. */
export function nvdTime(s: string): string {
  return /[zZ]$|[+-]\d{2}:\d{2}$/.test(s) ? new Date(s).toISOString() : new Date(`${s}Z`).toISOString();
}

const METRIC_KEYS: [string, RecentCve["version"]][] = [
  ["cvssMetricV40", "4.0"],
  ["cvssMetricV31", "3.1"],
  ["cvssMetricV30", "3.0"],
];

/** The newest CVSS NVD scored: score, qualitative severity and version, or nulls. */
export function cvssOf(cve: Pick<NvdCve, "metrics">): Pick<RecentCve, "score" | "severity" | "version"> {
  for (const [key, version] of METRIC_KEYS) {
    const data = cve.metrics?.[key]?.[0]?.cvssData;
    if (data && typeof data.baseScore === "number") {
      const sev = data.baseSeverity?.toUpperCase();
      const severity = sev === "LOW" || sev === "MEDIUM" || sev === "HIGH" || sev === "CRITICAL" ? sev : null;
      return { score: Math.round(data.baseScore * 10) / 10, severity, version };
    }
  }
  return { score: null, severity: null, version: null };
}

function firstSentence(s: string, max: number): string {
  const m = s.match(/^(.{20,}?[.!?])\s/);
  // truncate appends an ellipsis past `max`, so leave it room
  return truncate((m ? m[1]! : s).replace(/\s+/g, " ").trim(), max - 1);
}

/** `describedSince`: an ISO instant; CVEs published before it keep their description only when scored 9.0 or higher. */
export function toRecentCve(cve: NvdCve, describedSince = ""): RecentCve {
  const desc = cve.descriptions?.find((d) => d.lang === "en")?.value ?? "";
  const published = nvdTime(cve.published);
  const cvss = cvssOf(cve);
  const described = published >= describedSince || (cvss.score !== null && cvss.score >= 9);
  return { id: cve.id, published, ...cvss, description: described ? firstSentence(desc, DESCRIPTION_CHARS) : "" };
}

/* ---------- modules ---------- */

export const nvdCountsModule: StatsModule<NvdCounts> = {
  name: "nvd-counts",
  file: STATS_FILES.nvdCounts,
  schema: NvdCountsSchema,
  maxAgeHours: 20,
  async fetch(ctx, previous) {
    const today = ctx.now.toISOString().slice(0, 10);
    const currentYear = Number(today.slice(0, 4));
    const known = new Map((previous?.years ?? []).map((y) => [y.year, y.total]));
    const years: NvdCounts["years"] = [];
    let calls = 0;
    for (let year = FIRST_YEAR; year <= currentYear; year++) {
      const closed = year < currentYear - REFRESH_YEARS;
      const kept = known.get(year);
      if (closed && kept !== undefined) {
        years.push({ year, total: kept });
        continue;
      }
      let total = 0;
      for (const [from, to] of yearWindows(year, today)) {
        total += await countPublished(ctx, from, to);
        calls += 1;
      }
      years.push({ year, total });
    }
    ctx.log("stats nvd-counts: fetched", { calls, years: years.length, current: years[years.length - 1]?.total });
    return { fetched_at: ctx.now.toISOString(), source: NVD_SOURCE, years };
  },
};

export const cvesRecentModule: StatsModule<CvesRecent> = {
  name: "cves-recent",
  file: STATS_FILES.cvesRecent,
  schema: CvesRecentSchema,
  maxAgeHours: 20,
  async fetch(ctx) {
    const today = ctx.now.toISOString().slice(0, 10);
    const from = addDays(today, -RECENT_DAYS);
    const describedSince = new Date(ctx.now.getTime() - DESCRIBED_DAYS * 86_400_000).toISOString();
    const cves: RecentCve[] = [];
    const seen = new Set<string>();
    for await (const cve of pages(ctx, { pubStartDate: nvdStamp(from), pubEndDate: nvdStamp(today, true) }, ["noRejected"])) {
      if (seen.has(cve.id) || cve.vulnStatus === "Rejected") continue;
      seen.add(cve.id);
      cves.push(toRecentCve(cve, describedSince));
    }
    cves.sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id));
    ctx.log("stats cves-recent: fetched", { window_days: RECENT_DAYS, cves: cves.length, scored: cves.filter((c) => c.score !== null).length });
    return { fetched_at: ctx.now.toISOString(), source: NVD_SOURCE, window_days: RECENT_DAYS, cves };
  },
};

/** Publish date and CVSS of every CVE in the KEV catalog, by CVE id, through NVD's hasKev query. */
export async function fetchKevCves(ctx: StatsContext): Promise<Map<string, { published: string; cvss: number | null }>> {
  const out = new Map<string, { published: string; cvss: number | null }>();
  for await (const cve of pages(ctx, {}, ["hasKev"])) {
    out.set(cve.id, { published: nvdTime(cve.published).slice(0, 10), cvss: cvssOf(cve).score });
  }
  return out;
}
