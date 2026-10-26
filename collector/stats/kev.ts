import { KevStatsSchema, STATS_FILES, type KevStatEntry, type KevStats, type StatsSource } from "../../lib/stats-schema";
import type { KevEntry } from "../sources/kev";
import { fetchKevCves } from "./nvd";
import type { StatsModule } from "./types";

/**
 * The whole CISA Known Exploited Vulnerabilities catalog, reduced to what
 * the charts need: additions per month, the ransomware share, the next
 * remediation deadline, and (joined from NVD) the days between a CVE's
 * publication and its listing. CC0 1.0, verified 2026-10-26.
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
  maxAgeHours: 20,
  async fetch(ctx, previous) {
    const catalog = await ctx.http.json<KevCatalog>(KEV_URL, { userAgent: ctx.settings.fetch.user_agent, timeoutMs: 40_000, retries: 2, maxBytes: 10_000_000 });
    let nvd = new Map<string, { published: string; cvss: number | null }>();
    try {
      nvd = await fetchKevCves(ctx);
    } catch (err) {
      ctx.log("stats kev: NVD hasKev lookup failed, keeping the previous publish dates", { error: err instanceof Error ? err.message.slice(0, 160) : String(err) });
    }
    const prev = new Map((previous?.entries ?? []).map((e) => [e.cve, e]));
    const entries = catalog.vulnerabilities
      .filter((v) => DATE.test(v.dateAdded) && /^CVE-\d{4}-\d{4,}$/.test(v.cveID))
      .map((v) => kevStatEntry(v, nvd.get(v.cveID), prev.get(v.cveID)))
      .sort((a, b) => b.added.localeCompare(a.added) || a.cve.localeCompare(b.cve));
    ctx.log("stats kev: fetched", { entries: entries.length, with_published: entries.filter((e) => e.published).length, nvd_matched: nvd.size });
    return { fetched_at: ctx.now.toISOString(), source: KEV_SOURCE, catalog_version: catalog.catalogVersion ?? "", entries };
  },
};
