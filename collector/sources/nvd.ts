import { urlKey } from "../lib/canonical";
import { httpJson, sleep } from "../lib/http";
import { addDays, nowIso } from "../lib/ids";
import { errorMessage, log } from "../lib/log";
import { truncate } from "../lib/text";
import { lookbackStart } from "./rss";
import type { Candidate, SourceAdapter } from "./types";

/**
 * NVD CVE API 2.0, keyword searches for allow-listed AI products
 * (collector/config/packages.json → nvd_keywords). Incremental via
 * lastModStartDate/lastModEndDate in windows of at most 120 days. Without an
 * API key: 5 requests per rolling 30 s (we space 6.5 s); with NVD_API_KEY:
 * 50 per 30 s. Required notice on the site: "This product uses the NVD API
 * but is not endorsed or certified by the NVD."
 */

const WINDOW_DAYS = 119;
const HINT =
  "NVD CVE record matched by an allow-listed AI product keyword. In scope as attack_on_ai / infra_vuln when the affected software is an AI framework, model server, agent tool or AI product; out of scope if the keyword is a false positive. Severity 2 (disclosed vulnerability) unless exploitation is confirmed (CISA KEV or vendor statement → 3). incident_date is the published date.";

interface NvdCve {
  id: string;
  published: string;
  lastModified: string;
  vulnStatus?: string;
  cisaExploitAdd?: string;
  descriptions?: { lang: string; value: string }[];
  metrics?: Record<string, { cvssData?: { baseScore?: number; baseSeverity?: string } }[] | undefined>;
}

interface NvdResponse {
  totalResults: number;
  resultsPerPage: number;
  startIndex: number;
  vulnerabilities?: { cve: NvdCve }[];
}

function nvdStamp(date: string, end = false): string {
  return `${date}T${end ? "23:59:59.999" : "00:00:00.000"}+00:00`;
}

function firstSentence(s: string, max: number): string {
  const m = s.match(/^(.{20,}?[.!?])\s/);
  return truncate(m ? m[1]! : s, max);
}

export const nvdAdapter: SourceAdapter = {
  kind: "nvd",
  async fetch(source, ctx) {
    const base = source.url ?? "https://services.nvd.nist.gov/rest/json/cves/2.0";
    const apiKey = process.env.NVD_API_KEY;
    const spacing = apiKey ? 700 : 6500;
    const headers: Record<string, string> = apiKey ? { apiKey } : {};
    const start = ctx.since ?? lookbackStart(ctx, 30);
    const end = ctx.now.toISOString().slice(0, 10);

    const windows: [string, string][] = [];
    for (let from = start; from <= end; from = addDays(from, WINDOW_DAYS + 1)) {
      const to = addDays(from, WINDOW_DAYS) < end ? addDays(from, WINDOW_DAYS) : end;
      windows.push([from, to]);
    }

    const out = new Map<string, Candidate>();
    let requests = 0;
    for (const kw of ctx.config.packages.nvd_keywords) {
      for (const [from, to] of windows) {
        let startIndex = 0;
        for (let page = 0; page < 5; page++) {
          if (requests > 0) await sleep(spacing);
          requests += 1;
          const params = new URLSearchParams({
            keywordSearch: kw,
            lastModStartDate: nvdStamp(from),
            lastModEndDate: nvdStamp(to, true),
            resultsPerPage: "200",
            startIndex: String(startIndex),
          });
          const url = `${base}?${params.toString()}&keywordExactMatch`;
          let data: NvdResponse;
          try {
            data = await httpJson<NvdResponse>(url, { userAgent: ctx.settings.fetch.user_agent, timeoutMs: 40000, retries: 2, backoffMs: 7000, headers, maxBytes: 20_000_000 });
          } catch (err) {
            log.warn(`nvd: "${kw}" ${from}..${to} failed`, { error: errorMessage(err).slice(0, 160) });
            break;
          }
          for (const v of data.vulnerabilities ?? []) {
            const cve = v.cve;
            if (cve.vulnStatus === "Rejected") continue;
            const link = `https://nvd.nist.gov/vuln/detail/${cve.id}`;
            const key = urlKey(link);
            if (out.has(key)) continue;
            const desc = cve.descriptions?.find((d) => d.lang === "en")?.value ?? "";
            const metric = cve.metrics?.["cvssMetricV40"]?.[0]?.cvssData ?? cve.metrics?.["cvssMetricV31"]?.[0]?.cvssData ?? cve.metrics?.["cvssMetricV30"]?.[0]?.cvssData;
            const kev = Boolean(cve.cisaExploitAdd);
            const published = cve.published.slice(0, 10);
            out.set(key, {
              key,
              source_id: source.id,
              origin: "seed_nvd",
              url: link,
              title: `${cve.id}: ${firstSentence(desc, 130)}`,
              published_at: published,
              publisher: "NVD",
              hint: truncate(
                `${desc} CVSS ${metric?.baseScore ?? "n/a"}${metric?.baseSeverity ? ` ${metric.baseSeverity}` : ""}. Published ${published}.${kev ? ` Listed in CISA KEV on ${cve.cisaExploitAdd} (exploitation confirmed).` : ""}`,
                ctx.settings.fetch.hint_max_chars,
              ),
              cve_ids: [cve.id],
              discovered_at: nowIso(),
              extra: { classifier_hint: HINT, cvss: metric?.baseScore ?? null, kev, matched_keyword: kw, incident_date: published },
            });
          }
          const got = data.startIndex + (data.vulnerabilities?.length ?? 0);
          if (got >= data.totalResults || (data.vulnerabilities?.length ?? 0) === 0) break;
          startIndex = got;
        }
        if (ctx.limit && out.size >= ctx.limit) break;
      }
      if (ctx.limit && out.size >= ctx.limit) break;
    }
    log.info(`nvd: ${out.size} CVE candidates in ${requests} requests`);
    return [...out.values()];
  },
};
