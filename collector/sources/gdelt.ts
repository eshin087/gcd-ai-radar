import { canonicalUrl, urlKey } from "../lib/canonical";
import { httpFetch, sleep } from "../lib/http";
import { nowIso } from "../lib/ids";
import { errorMessage, log } from "../lib/log";
import { publisherFor } from "../lib/publishers";
import { extractCves, truncate } from "../lib/text";
import type { Candidate, SourceAdapter } from "./types";

/**
 * GDELT DOC 2.0 API: the only compliant, free, query-driven news-discovery
 * API we found. Free and unrestricted with a citation ("Powered by GDELT").
 * Operationally flaky (frequent 429s, errors returned as HTTP 200 text), so
 * queries run strictly one at a time with long gaps and misses are normal:
 * the next run's overlapping window catches up.
 */

interface GdeltArticle {
  url: string;
  url_mobile?: string;
  title: string;
  seendate: string; // 20261017T043000Z
  domain?: string;
  language?: string;
  sourcecountry?: string;
}

/** GDELT tokenizes punctuation ("CVE - 2026 - 95183", "What the Tech : AI"). */
export function cleanGdeltTitle(t: string): string {
  return t
    .replace(/([A-Z0-9])\s+-\s+(\d)/g, "$1-$2")
    .replace(/\s+([,.:;!?%)\]])/g, "$1")
    .replace(/([(\[$])\s+/g, "$1")
    .replace(/\s+'\s*(s|t|re|ve|ll|d)\b/gi, "'$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function seendateToIso(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().slice(0, 10);
}

export const gdeltAdapter: SourceAdapter = {
  kind: "gdelt",
  async fetch(source, ctx) {
    const base = source.url ?? "https://api.gdeltproject.org/api/v2/doc/doc";
    const { spacing_ms, timespan, max_records } = ctx.settings.gdelt;
    const out = new Map<string, Candidate>();
    let first = true;
    let failures = 0;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE = 4;
    for (const q of ctx.config.queries) {
      if (consecutiveFailures >= MAX_CONSECUTIVE) {
        log.warn(`gdelt: ${MAX_CONSECUTIVE} consecutive failures, stopping this run's GDELT pass early (the next run retries)`);
        break;
      }
      if (!first) await sleep(spacing_ms);
      first = false;
      const params = new URLSearchParams({
        query: `"${q}" sourcelang:english`,
        mode: "ArtList",
        format: "json",
        maxrecords: String(max_records),
        sort: "DateDesc",
      });
      if (ctx.since) {
        params.set("startdatetime", `${ctx.since.replace(/-/g, "")}000000`);
        params.set("enddatetime", `${ctx.now.toISOString().slice(0, 10).replace(/-/g, "")}235959`);
      } else {
        params.set("timespan", timespan);
      }
      try {
        const res = await httpFetch(`${base}?${params.toString()}`, {
          userAgent: ctx.settings.fetch.user_agent,
          timeoutMs: 40000,
          retries: 2,
          backoffMs: 10000,
        });
        const body = res.body.trim();
        if (!body.startsWith("{")) {
          failures += 1;
          consecutiveFailures += 1;
          log.debug(`gdelt: non-JSON reply for "${q}"`, { body: body.slice(0, 100) });
          continue;
        }
        consecutiveFailures = 0;
        const data = JSON.parse(body) as { articles?: GdeltArticle[] };
        let added = 0;
        for (const a of data.articles ?? []) {
          if (a.language && a.language.toLowerCase() !== "english") continue;
          const canonical = canonicalUrl(a.url);
          if (!canonical) continue;
          const key = urlKey(canonical);
          if (out.has(key)) continue;
          const title = cleanGdeltTitle(a.title ?? "");
          if (title.length < 12) continue;
          out.set(key, {
            key,
            source_id: source.id,
            origin: "news",
            url: canonical,
            title: truncate(title, 400),
            published_at: seendateToIso(a.seendate),
            publisher: publisherFor(canonical, ctx.config.publishers, a.domain),
            hint: "",
            cve_ids: extractCves(title),
            discovered_at: nowIso(),
            extra: { query: q, gdelt_domain: a.domain },
          });
          added += 1;
        }
        log.debug("gdelt query", { q, articles: data.articles?.length ?? 0, added });
      } catch (err) {
        failures += 1;
        consecutiveFailures += 1;
        log.debug(`gdelt: "${q}" failed`, { error: errorMessage(err).slice(0, 120) });
      }
      if (ctx.limit && out.size >= ctx.limit) break;
    }
    log.info(`gdelt: ${out.size} candidates from ${ctx.config.queries.length} queries (${failures} queries failed or rate-limited)`);
    return [...out.values()];
  },
};
