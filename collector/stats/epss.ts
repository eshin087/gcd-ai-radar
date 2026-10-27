import { EpssStatsSchema, STATS_FILES, type EpssStats, type StatsSource } from "../../lib/stats-schema";
import type { StatsModule } from "./types";

/**
 * EPSS by FIRST: the probability that a CVE is exploited in the next 30
 * days, with its percentile, for the CVE ids the site shows (our records,
 * the recent CVEs, the KEV catalog). Read through the API in batches of
 * comma-separated ids, verified 2026-10-26: "EPSS scores are published
 * freely via CSV download and API with no registration required" and
 * "Attribution is requested when EPSS data is used in publications or
 * products" (first.org/epss/faq).
 */

export const EPSS_URL = "https://api.first.org/data/v1/epss";
export const EPSS_SOURCE: StatsSource = { name: "EPSS, FIRST", url: "https://www.first.org/epss/", license: "Free to use; attribution requested by FIRST" };
export const EPSS_BATCH = 100;
const SPACING_MS = 1000;
const CVE = /^CVE-\d{4}-\d{4,}$/;

export interface EpssResponse {
  status?: string;
  total?: number;
  data?: { cve: string; epss: string | number; percentile: string | number; date: string }[];
}

/** Rounded so the small daily drift of a score does not rewrite its line: four decimals for the probability, three for the percentile. */
function num(v: string | number, decimals = 4): number | null {
  const n = typeof v === "number" ? v : Number(v);
  const f = 10 ** decimals;
  return Number.isFinite(n) ? Math.round(n * f) / f : null;
}

export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const epssModule: StatsModule<EpssStats> = {
  name: "epss",
  file: STATS_FILES.epss,
  schema: EpssStatsSchema,
  maxAgeHours: 20,
  async fetch(ctx, previous) {
    const ids = [...new Set([...ctx.recordCveIds, ...ctx.extraCveIds].filter((id) => CVE.test(id)))].sort();
    const wanted = new Set(ids);
    // Start from yesterday's scores for the ids still wanted, so a failed batch leaves a stale score rather than none.
    const scores: EpssStats["scores"] = {};
    for (const [cve, pair] of Object.entries(previous?.scores ?? {})) if (wanted.has(cve)) scores[cve] = pair;
    let modelDate = previous?.model_date ?? ctx.now.toISOString().slice(0, 10);
    let failed = 0;
    let calls = 0;
    for (const batch of batches(ids, EPSS_BATCH)) {
      if (calls > 0) await ctx.http.sleep(SPACING_MS);
      calls += 1;
      try {
        const res = await ctx.http.json<EpssResponse>(`${EPSS_URL}?cve=${batch.join(",")}`, { userAgent: ctx.settings.fetch.user_agent, timeoutMs: 30_000, retries: 2, maxBytes: 2_000_000 });
        for (const row of res.data ?? []) {
          const epss = num(row.epss, 4);
          const percentile = num(row.percentile, 3);
          if (!CVE.test(row.cve) || epss === null || percentile === null) continue;
          scores[row.cve] = [Math.min(1, Math.max(0, epss)), Math.min(1, Math.max(0, percentile))];
          if (row.date && row.date > modelDate) modelDate = row.date.slice(0, 10);
        }
      } catch (err) {
        failed += 1;
        ctx.log("stats epss: batch failed", { error: err instanceof Error ? err.message.slice(0, 160) : String(err) });
      }
    }
    if (calls > 0 && failed > calls / 2) throw new Error(`epss: ${failed} of ${calls} batches failed`);
    ctx.log("stats epss: fetched", { ids: ids.length, scored: Object.keys(scores).length, calls, failed, model_date: modelDate });
    return { fetched_at: ctx.now.toISOString(), source: EPSS_SOURCE, model_date: modelDate, scores };
  },
};
