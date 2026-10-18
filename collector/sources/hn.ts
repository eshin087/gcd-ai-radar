import { canonicalUrl, hostOf, urlKey } from "../lib/canonical";
import { httpJson } from "../lib/http";
import { nowIso } from "../lib/ids";
import { log } from "../lib/log";
import { publisherFor } from "../lib/publishers";
import { extractCves, stripHtml, truncate } from "../lib/text";
import type { Candidate, SourceAdapter } from "./types";

/**
 * Hacker News via the Algolia search API (the sanctioned public channel for
 * HN data). One request per query string; only stories that link out are
 * kept, and the linked article is the source, not the HN thread.
 */

interface HnHit {
  objectID: string;
  title?: string;
  url?: string;
  created_at: string;
  created_at_i: number;
  points?: number;
  num_comments?: number;
  story_text?: string | null;
}

interface HnResponse {
  hits: HnHit[];
  nbHits: number;
  nbPages: number;
  page: number;
}

const DEFAULT_LOOKBACK_MS = 36 * 3600 * 1000;
const OVERLAP_MS = 12 * 3600 * 1000;

export const hnAdapter: SourceAdapter = {
  kind: "hn",
  async fetch(source, ctx) {
    const base = source.url ?? "https://hn.algolia.com/api/v1/search_by_date";
    const sinceMs = ctx.since
      ? Date.parse(`${ctx.since}T00:00:00Z`)
      : ctx.lastSuccessAt
        ? Date.parse(ctx.lastSuccessAt) - OVERLAP_MS
        : ctx.now.getTime() - DEFAULT_LOOKBACK_MS;
    const since = Math.floor(sinceMs / 1000);
    const maxPages = ctx.since ? 10 : 1;
    const out = new Map<string, Candidate>();
    const { user_agent, timeout_ms, hint_max_chars } = ctx.settings.fetch;

    for (const q of ctx.config.queries) {
      for (let page = 0; page < maxPages; page++) {
        const url =
          `${base}?query=${encodeURIComponent(`"${q}"`)}&tags=story` +
          `&numericFilters=${encodeURIComponent(`created_at_i>${since}`)}&hitsPerPage=100&page=${page}`;
        const data = await httpJson<HnResponse>(url, { userAgent: user_agent, timeoutMs: timeout_ms, retries: 2 });
        for (const hit of data.hits) {
          if (!hit.url || !hit.title) continue;
          const canonical = canonicalUrl(hit.url);
          if (!canonical) continue;
          if (hostOf(canonical) === "news.ycombinator.com") continue;
          const key = urlKey(canonical);
          if (out.has(key)) continue;
          out.set(key, {
            key,
            source_id: source.id,
            origin: "news",
            url: canonical,
            title: stripHtml(hit.title).trim(),
            published_at: hit.created_at.slice(0, 10),
            publisher: publisherFor(canonical, ctx.config.publishers),
            hint: hit.story_text ? truncate(stripHtml(hit.story_text), hint_max_chars) : "",
            cve_ids: extractCves(hit.title),
            discovered_at: nowIso(),
            extra: { hn_id: hit.objectID, points: hit.points ?? 0, comments: hit.num_comments ?? 0, query: q },
          });
        }
        log.debug("hn query", { q, page, hits: data.hits.length, total: data.nbHits });
        if (page + 1 >= data.nbPages) break;
      }
      if (ctx.limit && out.size >= ctx.limit) break;
    }
    return [...out.values()];
  },
};
