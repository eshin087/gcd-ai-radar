import { XMLParser } from "fast-xml-parser";
import { stripDoctype } from "../lib/feed";
import { canonicalUrl, urlKey } from "../lib/canonical";
import { toIsoDate } from "../lib/feed";
import { httpFetch } from "../lib/http";
import { nowIso } from "../lib/ids";
import { log } from "../lib/log";
import { publisherFor } from "../lib/publishers";
import { fetchPageMeta } from "../pipeline/enrich";
import { truncate } from "../lib/text";
import { lookbackStart } from "./rss";
import type { Candidate, SourceAdapter, SourceContext } from "./types";

/**
 * Sitemap-diff adapter for sites without a feed (Anthropic, HiddenLayer…).
 * New dated URLs matching the source's url_filter are fetched once, politely
 * (robots.txt honoured), for their title and meta description.
 */

interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

const parser = new XMLParser({ ignoreAttributes: true, isArray: (name) => ["url", "sitemap"].includes(name), parseTagValue: false, trimValues: true });

async function loadSitemap(url: string, ctx: SourceContext, depth: number): Promise<SitemapEntry[]> {
  const res = await httpFetch(url, { userAgent: ctx.settings.fetch.user_agent, timeoutMs: ctx.settings.fetch.timeout_ms, retries: 1, maxBytes: 6_000_000 });
  const doc = parser.parse(stripDoctype(res.body)) as Record<string, unknown>;
  const index = doc["sitemapindex"] as { sitemap?: { loc?: string }[] } | undefined;
  if (index?.sitemap && depth < 1) {
    const children = index.sitemap.map((s) => s.loc).filter((l): l is string => Boolean(l)).slice(0, 6);
    const nested = await Promise.all(children.map((c) => loadSitemap(c, ctx, depth + 1).catch(() => [] as SitemapEntry[])));
    return nested.flat();
  }
  const set = doc["urlset"] as { url?: { loc?: string; lastmod?: string }[] } | undefined;
  return (set?.url ?? [])
    .filter((u) => u.loc)
    .map((u) => ({ loc: u.loc!, lastmod: toIsoDate(u.lastmod) }));
}

function humanize(url: string): string {
  const seg = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  const words = seg.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : url;
}

export const sitemapAdapter: SourceAdapter = {
  kind: "sitemap",
  async fetch(source, ctx) {
    if (!source.url) throw new Error(`${source.id}: no url configured`);
    const since = lookbackStart(ctx, 14);
    const urlFilter = source.url_filter ? new RegExp(source.url_filter, "i") : null;
    const entries = await loadSitemap(source.url, ctx, 0);
    const dated = entries.some((e) => e.lastmod);
    const fresh = entries
      .filter((e) => (!urlFilter || urlFilter.test(e.loc)) && (!dated || (e.lastmod && e.lastmod >= since)))
      .sort((a, b) => (b.lastmod ?? "").localeCompare(a.lastmod ?? ""));
    const cap = ctx.limit ?? 20;
    const out: Candidate[] = [];
    for (const e of fresh) {
      if (out.length >= cap) break;
      const canonical = canonicalUrl(e.loc);
      if (!canonical) continue;
      const key = urlKey(canonical);
      if (ctx.seenKeys?.has(key)) continue;
      const meta = await fetchPageMeta(canonical, ctx.settings);
      if (meta === null) {
        log.debug(`${source.id}: page not fetchable`, { url: canonical });
        continue;
      }
      out.push({
        key,
        source_id: source.id,
        origin: "news",
        url: canonical,
        title: truncate((meta.title || humanize(canonical)).replace(/\s*[|·–-]\s*(Anthropic|HiddenLayer)\s*$/i, ""), 400),
        published_at: e.lastmod ?? ctx.now.toISOString().slice(0, 10),
        publisher: source.publisher ?? publisherFor(canonical, ctx.config.publishers),
        hint: truncate(meta.description ?? "", ctx.settings.fetch.hint_max_chars),
        cve_ids: [],
        discovered_at: nowIso(),
      });
    }
    log.debug(`${source.id}: ${entries.length} sitemap urls, ${fresh.length} fresh, ${out.length} fetched`);
    return out;
  },
};
