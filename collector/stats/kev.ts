import { KevStatsSchema, STATS_FILES, type KevStatEntry, type KevStats, type StatsSource } from "../../lib/stats-schema";
import type { KevEntry } from "../sources/kev";
import { addDays } from "../lib/ids";
import { fetchKevCves } from "./nvd";
import type { StatsModule } from "./types";

/**
 * The whole CISA Known Exploited Vulnerabilities catalog, reduced to what
 * the charts need: additions per month, the ransomware share, the next
 * remediation deadline, and (joined from NVD) the days between a CVE's
 * publication and its listing. CC0 1.0, verified 2026-10-26.
 *
 * Read again once the file is 0.9 hours old, so on about every hourly
 * collector run (every other run at a 30-minute cadence): the home page's
 * "Act now" list and its known-exploited-this-week count come from here, and
 * CISA adds entries at any hour. A read that changes nothing writes nothing.
 * The NVD join (about 19 MB) runs only when there is no previous file, when
 * the catalog lists a CVE the previous file lacks, or while an entry listed
 * in the last 30 days still lacks its publish date or score (a failed join,
 * or NVD scoring a CVE days after CISA lists it). Otherwise the previous
 * dates and scores carry over: NVD rescoring an older entry is not picked up.
 */

export const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
export const KEV_SOURCE: StatsSource = {
  name: "CISA Known Exploited Vulnerabilities catalog",
  url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
  license: "CC0 1.0",
};

interface KevCatalog {
  catalogVersion?: string;
  dateReleased?: string;
  count?: number;
  vulnerabilities: KevEntry[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CVE = /^CVE-\d{4}-\d{4,}$/;

/** How long after its listing an entry without a publish date or score keeps asking NVD again. */
export const JOIN_RECENT_DAYS = 30;

/**
 * Whether this read needs NVD's publish dates and scores: no previous file,
 * a CVE the previous file lacks, or an entry listed in the last 30 days that
 * the previous file still holds without a publish date or score.
 */
export function needsNvdJoin(listed: readonly Pick<KevEntry, "cveID" | "dateAdded">[], previous: KevStats | null, now: Date): boolean {
  if (!previous) return true;
  const prev = new Map(previous.entries.map((e) => [e.cve, e]));
  const since = addDays(now.toISOString().slice(0, 10), -JOIN_RECENT_DAYS);
  return listed.some((v) => {
    const p = prev.get(v.cveID);
    return !p || (v.dateAdded >= since && (p.published === null || p.cvss === null));
  });
}

/** One catalog entry reduced; the NVD join fills `published` and `cvss`, the previous file keeps them when NVD is unavailable. */
export function kevStatEntry(v: KevEntry, nvd: { published: string; cvss: number | null } | undefined, previous: KevStatEntry | undefined): KevStatEntry {
  return {
    cve: v.cveID,
    added: v.dateAdded,
    due: v.dueDate && DATE.test(v.dueDate) ? v.dueDate : null,
    vendor: v.vendorProject ?? "",
    product: v.product ?? "",
    name: v.vulnerabilityName ?? "",
    ransomware: v.knownRansomwareCampaignUse === "Known",
    published: nvd?.published ?? previous?.published ?? null,
    cvss: nvd?.cvss ?? previous?.cvss ?? null,
  };
}

export const kevModule: StatsModule<KevStats> = {
  name: "kev",
  file: STATS_FILES.kev,
  schema: KevStatsSchema,
  maxAgeHours: 0.9,
  async fetch(ctx, previous) {
    const catalog = await ctx.http.json<KevCatalog>(KEV_URL, { userAgent: ctx.settings.fetch.user_agent, timeoutMs: 40_000, retries: 2, maxBytes: 10_000_000 });
    const listed = catalog.vulnerabilities.filter((v) => DATE.test(v.dateAdded) && CVE.test(v.cveID));
    let nvd = new Map<string, { published: string; cvss: number | null }>();
    if (needsNvdJoin(listed, previous, ctx.now)) {
      try {
        nvd = await fetchKevCves(ctx);
      } catch (err) {
        ctx.log("stats kev: NVD hasKev lookup failed, keeping the previous publish dates", { error: err instanceof Error ? err.message.slice(0, 160) : String(err) });
      }
    } else {
      ctx.log("stats kev: no new listing, NVD join skipped", { entries: listed.length });
    }
    const prev = new Map((previous?.entries ?? []).map((e) => [e.cve, e]));
    const entries = listed
      .map((v) => kevStatEntry(v, nvd.get(v.cveID), prev.get(v.cveID)))
      .sort((a, b) => b.added.localeCompare(a.added) || a.cve.localeCompare(b.cve));
    ctx.log("stats kev: fetched", { entries: entries.length, with_published: entries.filter((e) => e.published).length, nvd_matched: nvd.size });
    return { fetched_at: ctx.now.toISOString(), source: KEV_SOURCE, catalog_version: catalog.catalogVersion ?? "", entries };
  },
};
