import { z } from "zod";

/**
 * The statistics files the collector's stats stage writes under
 * data/stats/ (collector/stats/*), and the public shape prebuild derives
 * from them for the home page (lib/home.ts). Each data file carries when it
 * was fetched and where it came from, so every number on the page can name
 * its source and its age. A file that is missing or fails its schema hides
 * its panel; it never fails a build (lib/data.ts loadStats).
 */

const isoDateTime = z.iso.datetime();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const cveId = z.string().regex(/^CVE-\d{4}-\d{4,}$/);
const count = z.number().int().min(0);

export const StatsSourceSchema = z.object({
  name: z.string().min(1),
  url: z.url(),
  license: z.string().min(1),
});
export type StatsSource = z.infer<typeof StatsSourceSchema>;

/** CVEs published per year, from NVD's totalResults over publish-date windows. */
export const NvdCountsSchema = z.object({
  fetched_at: isoDateTime,
  source: StatsSourceSchema,
  years: z.array(z.object({ year: z.number().int().min(1999), total: count })),
});
export type NvdCounts = z.infer<typeof NvdCountsSchema>;

export const RecentCveSchema = z.object({
  id: cveId,
  /** Publish time in UTC. */
  published: isoDateTime,
  /** CVSS base score, the newest version NVD scored (4.0, then 3.1, then 3.0); null when unscored. */
  score: z.number().min(0).max(10).nullable(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).nullable(),
  version: z.enum(["4.0", "3.1", "3.0"]).nullable(),
  description: z.string().max(200),
});
export type RecentCve = z.infer<typeof RecentCveSchema>;

/** Every CVE published in the last `window_days`, from NVD. */
export const CvesRecentSchema = z.object({
  fetched_at: isoDateTime,
  source: StatsSourceSchema,
  window_days: z.number().int().positive(),
  cves: z.array(RecentCveSchema),
});
export type CvesRecent = z.infer<typeof CvesRecentSchema>;

/**
 * CVEs published per UTC day (and those scored 9.0 or higher), the newest
 * 120 complete days, counted from cves-recent on every stats run
 * (collector/stats/daily.ts).
 */
export const DailyStatsSchema = z.object({
  fetched_at: isoDateTime,
  source: StatsSourceSchema,
  days: z.record(isoDate, z.object({ cves: count, critical: count })),
});
export type DailyStats = z.infer<typeof DailyStatsSchema>;

export const KevStatEntrySchema = z.object({
  cve: cveId,
  added: isoDate,
  due: isoDate.nullable(),
  vendor: z.string(),
  product: z.string(),
  name: z.string(),
  ransomware: z.boolean(),
  /** NVD publish date, joined through the API's hasKev query; null until known. */
  published: isoDate.nullable(),
  cvss: z.number().min(0).max(10).nullable(),
});
export type KevStatEntry = z.infer<typeof KevStatEntrySchema>;

/** The whole CISA KEV catalog, reduced. */
export const KevStatsSchema = z.object({
  fetched_at: isoDateTime,
  source: StatsSourceSchema,
  catalog_version: z.string(),
  entries: z.array(KevStatEntrySchema),
});
export type KevStats = z.infer<typeof KevStatsSchema>;

export const BreachStatSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  domain: z.string(),
  breach_date: isoDate.nullable(),
  added: isoDate,
  accounts: count,
  verified: z.boolean(),
  sensitive: z.boolean(),
  spam_list: z.boolean(),
  stealer_log: z.boolean(),
  malware: z.boolean(),
  fabricated: z.boolean(),
  retired: z.boolean(),
});
export type BreachStat = z.infer<typeof BreachStatSchema>;

/** Every breach Have I Been Pwned lists, reduced. */
export const HibpStatsSchema = z.object({
  fetched_at: isoDateTime,
  source: StatsSourceSchema,
  breaches: z.array(BreachStatSchema),
});
export type HibpStats = z.infer<typeof HibpStatsSchema>;

/** EPSS scores for the CVE ids the site shows: [probability, percentile]. */
export const EpssStatsSchema = z.object({
  fetched_at: isoDateTime,
  source: StatsSourceSchema,
  model_date: isoDate,
  scores: z.record(cveId, z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])),
});
export type EpssStats = z.infer<typeof EpssStatsSchema>;

/** The six files, each null when absent or invalid. */
export interface StatsFiles {
  nvdCounts: NvdCounts | null;
  cvesRecent: CvesRecent | null;
  daily: DailyStats | null;
  kev: KevStats | null;
  hibp: HibpStats | null;
  epss: EpssStats | null;
}

export const STATS_FILES = {
  nvdCounts: "nvd-counts.json",
  cvesRecent: "cves-recent.json",
  daily: "daily.json",
  kev: "kev.json",
  hibp: "hibp.json",
  epss: "epss.json",
} as const;

export const STATS_SCHEMAS = {
  nvdCounts: NvdCountsSchema,
  cvesRecent: CvesRecentSchema,
  daily: DailyStatsSchema,
  kev: KevStatsSchema,
  hibp: HibpStatsSchema,
  epss: EpssStatsSchema,
} as const;

export function emptyStats(): StatsFiles {
  return { nvdCounts: null, cvesRecent: null, daily: null, kev: null, hibp: null, epss: null };
}

/* ---------- public/stats/home.json ---------- */

export const HomeStatsSchema = z.object({
  generated_at: isoDateTime,
  site: z.url(),
  /** When each source was last fetched; null when its file is absent. */
  fetched: z.object({
    nvd: isoDateTime.nullable(),
    kev: isoDateTime.nullable(),
    hibp: isoDateTime.nullable(),
    epss: isoDateTime.nullable(),
  }),
  sources: z.array(StatsSourceSchema),
  counters: z.object({
    cves_24h: count.nullable(),
    cves_7d: count.nullable(),
    critical_7d: count.nullable(),
    kev_7d: count.nullable(),
    /** The nearest federal remediation deadline on or after today, YYYY-MM-DD. */
    kev_next_due: isoDate.nullable(),
    breaches_month: count.nullable(),
    breached_accounts_month: count.nullable(),
    live: count,
  }),
  series: z.object({
    cves_by_year: z.array(z.object({ year: z.number().int(), total: count, provisional: z.boolean() })),
    ai_cves_by_quarter: z.array(z.object({ quarter: z.string(), total: count, provisional: z.boolean() })),
    kev_by_month: z.array(z.object({ month: z.string(), total: count, ransomware: count })),
    breaches_by_month: z.array(z.object({ month: z.string(), breaches: count, accounts: count })),
    kev_lag_by_year: z.array(z.object({ year: z.number().int(), n: count, median_days: z.number().min(0), within_7d: z.number().min(0).max(1) })),
  }),
  epss_top: z.array(
    z.object({
      cve: cveId,
      epss: z.number().min(0).max(1),
      percentile: z.number().min(0).max(1),
      score: z.number().nullable(),
      severity: z.string().nullable(),
      published: isoDate,
      description: z.string(),
      /** Our record about this CVE, when one exists. */
      slug: z.string().nullable(),
    }),
  ),
  lists: z.object({
    cves_day: z.object({ count: count, file: z.string() }),
    cves_week: z.object({ count: count, file: z.string() }),
    kev_month: z.object({ month: z.string(), count: count, file: z.string() }),
    breaches_month: z.object({ month: z.string(), count: count, file: z.string() }),
  }),
});
export type HomeStats = z.infer<typeof HomeStatsSchema>;
