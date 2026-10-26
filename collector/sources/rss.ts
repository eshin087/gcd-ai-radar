import { canonicalUrl, urlKey } from "../lib/canonical";
import { parseFeed, stripBoilerplate, type FeedItem } from "../lib/feed";
import { httpFetch } from "../lib/http";
import { nowIso } from "../lib/ids";
import { log } from "../lib/log";
import { publisherFor } from "../lib/publishers";
import { extractCves, truncate } from "../lib/text";
import type { Candidate, SourceAdapter, SourceContext } from "./types";
import type { SourceConfig } from "../lib/config";

/**
 * Generic RSS/Atom adapter for press, vendor and research feeds. Keeps items
 * newer than the lookback window, applies the source's optional title and
 * text filters and stores only title, link, date and a hint for the classifier.
 */

const FIRST_RUN_DAYS = 7;
const OVERLAP_MS = 24 * 3600 * 1000;

export function lookbackStart(ctx: SourceContext, firstRunDays = FIRST_RUN_DAYS): string {
  if (ctx.since) return ctx.since;
  const ms = ctx.lastSuccessAt ? Date.parse(ctx.lastSuccessAt) - OVERLAP_MS : ctx.now.getTime() - firstRunDays * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function fetchFeedItems(source: SourceConfig, ctx: SourceContext): Promise<FeedItem[]> {
  if (!source.url) throw new Error(`${source.id}: no url configured`);
  const res = await httpFetch(source.url, {
    userAgent: ctx.settings.fetch.user_agent,
    timeoutMs: ctx.settings.fetch.timeout_ms,
    retries: ctx.settings.fetch.retries,
    maxBytes: source.max_bytes ?? ctx.settings.fetch.max_body_bytes,
  });
  if (res.truncated) log.warn(`${source.id}: feed body truncated at ${source.max_bytes ?? ctx.settings.fetch.max_body_bytes} bytes`);
  const items = parseFeed(res.body);
  if (items.length === 0) log.debug(`${source.id}: feed parsed to 0 items`, { contentType: res.contentType, bytes: res.body.length });
  return items;
}

export function itemToCandidate(
  item: FeedItem,
  source: SourceConfig,
  ctx: SourceContext,
  overrides: Partial<Candidate> = {},
): Candidate | null {
  const canonical = canonicalUrl(item.link);
  if (!canonical || !item.title) return null;
  const hint = truncate(stripBoilerplate(item.summary), ctx.settings.fetch.hint_max_chars);
  return {
    key: urlKey(canonical),
    source_id: source.id,
    origin: "news",
    url: canonical,
    title: truncate(item.title, 400),
    published_at: item.date ?? ctx.now.toISOString().slice(0, 10),
    publisher: source.publisher ?? publisherFor(canonical, ctx.config.publishers),
    hint,
    cve_ids: extractCves(`${item.title} ${hint}`),
    discovered_at: nowIso(),
    ...overrides,
  };
}

export interface FeedFilters {
  /** Must match the title. */
  title: RegExp | null;
  /** Must match the title and summary joined by a newline. */
  text: RegExp | null;
}

/** Compiles a source's optional `title_filter` and `text_filter` (both case-insensitive). */
export function feedFilters(source: Pick<SourceConfig, "title_filter" | "text_filter">): FeedFilters {
  return {
    title: source.title_filter ? new RegExp(source.title_filter, "i") : null,
    text: source.text_filter ? new RegExp(source.text_filter, "i") : null,
  };
}

/** True when the item passes every configured filter. */
export function passesFilters(item: Pick<FeedItem, "title" | "summary">, filters: FeedFilters): boolean {
  if (filters.title && !filters.title.test(item.title)) return false;
  if (filters.text && !filters.text.test(`${item.title}\n${item.summary ?? ""}`)) return false;
  return true;
}

export const rssAdapter: SourceAdapter = {
  kind: "rss",
  async fetch(source, ctx) {
    const items = await fetchFeedItems(source, ctx);
    const since = lookbackStart(ctx);
    const filters = feedFilters(source);
    const out: Candidate[] = [];
    for (const item of items) {
      if (item.date && item.date < since) continue;
      if (!passesFilters(item, filters)) continue;
      const c = itemToCandidate(item, source, ctx);
      if (c) out.push(c);
      if (ctx.limit && out.length >= ctx.limit) break;
    }
    return out;
  },
};
