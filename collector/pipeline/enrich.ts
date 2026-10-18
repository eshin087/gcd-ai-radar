import pLimit from "p-limit";
import type { Settings } from "../lib/config";
import { hostOf } from "../lib/canonical";
import { httpFetch } from "../lib/http";
import { log } from "../lib/log";
import { decodeEntities, truncate } from "../lib/text";
import type { Candidate } from "../sources/types";

/**
 * Gives the classifier something beyond a bare title: the page's own meta
 * description (og:description / description), fetched once per candidate
 * and only when the host's robots.txt allows us. The text is used as a hint
 * for classification and is never stored in the dataset.
 */

export interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow") current.allow.push(value);
    else if (field === "disallow") current.disallow.push(value);
  }
  return groups;
}

function ruleMatches(rule: string, path: string): boolean {
  if (!rule) return false;
  let re = "^";
  for (const ch of rule) {
    if (ch === "*") re += ".*";
    else if (ch === "$") re += "$";
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(re).test(path);
}

/** Longest-match semantics; Allow wins ties; no matching group means allowed. */
export function robotsAllows(groups: RobotsGroup[], userAgentToken: string, path: string): boolean {
  const token = userAgentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const star = groups.filter((g) => g.agents.includes("*"));
  const applicable = specific.length ? specific : star;
  if (applicable.length === 0) return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const g of applicable) {
    for (const r of g.allow) if (ruleMatches(r, path) && (!best || r.length > best.len || (r.length === best.len && !best.allow))) best = { allow: true, len: r.length };
    for (const r of g.disallow) if (ruleMatches(r, path) && (!best || r.length > best.len)) best = { allow: false, len: r.length };
  }
  return best ? best.allow : true;
}

const robotsCache = new Map<string, Promise<RobotsGroup[] | null>>();

async function robotsFor(host: string, settings: Settings): Promise<RobotsGroup[] | null> {
  let p = robotsCache.get(host);
  if (!p) {
    p = httpFetch(`https://${host}/robots.txt`, {
      userAgent: settings.fetch.user_agent,
      timeoutMs: 8000,
      retries: 0,
      maxBytes: 200_000,
      noRetryStatuses: [404, 403, 401, 410],
    })
      .then((r) => (r.status === 200 && /text\/plain|text\/html|octet/i.test(r.contentType) ? parseRobots(r.body) : []))
      .catch(() => [] as RobotsGroup[]);
    robotsCache.set(host, p);
  }
  return p;
}

function metaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<meta\s+([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs: Record<string, string> = {};
    const attrRe = /([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[1]!))) attrs[a[1]!.toLowerCase()] = a[3] ?? a[4] ?? a[5] ?? "";
    const key = (attrs["property"] ?? attrs["name"] ?? "").toLowerCase();
    if (key && attrs["content"] !== undefined && !(key in out)) out[key] = decodeEntities(attrs["content"]);
  }
  return out;
}

export interface PageMeta {
  title?: string;
  description?: string;
}

export async function fetchPageMeta(url: string, settings: Settings): Promise<PageMeta | null> {
  const host = hostOf(url);
  if (!host) return null;
  const groups = await robotsFor(host, settings);
  const path = new URL(url).pathname + new URL(url).search;
  if (groups && !robotsAllows(groups, "gcd-ai-radar", path)) {
    log.debug("robots disallows page fetch", { host, path });
    return null;
  }
  try {
    const res = await httpFetch(url, {
      userAgent: settings.fetch.user_agent,
      timeoutMs: 12000,
      retries: 0,
      maxBytes: 400_000,
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
      noRetryStatuses: [401, 403, 404, 410, 429],
    });
    if (!/html/i.test(res.contentType)) return null;
    const tags = metaTags(res.body);
    const description = tags["og:description"] ?? tags["description"] ?? tags["twitter:description"];
    const titleMatch = res.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = tags["og:title"] ?? (titleMatch ? decodeEntities(titleMatch[1]!).replace(/\s+/g, " ").trim() : undefined);
    return { title, description: description?.replace(/\s+/g, " ").trim() };
  } catch (err) {
    log.debug("page meta fetch failed", { url, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Fills empty or very short hints from page metadata, a few hosts at a time. */
export async function enrichHints(candidates: Candidate[], settings: Settings, minHintChars = 80): Promise<number> {
  const limit = pLimit(4);
  let enriched = 0;
  await Promise.all(
    candidates
      .filter((c) => c.hint.length < minHintChars)
      .map((c) =>
        limit(async () => {
          const meta = await fetchPageMeta(c.url, settings);
          if (meta?.description && meta.description.length > c.hint.length) {
            c.hint = truncate(meta.description, settings.fetch.hint_max_chars);
            enriched += 1;
          }
        }),
      ),
  );
  return enriched;
}
