import { urlKey } from "../lib/canonical";
import { httpJson } from "../lib/http";
import { nowIso } from "../lib/ids";
import { stripHtml, truncate } from "../lib/text";
import { lookbackStart } from "./rss";
import type { Candidate, SourceAdapter } from "./types";

/**
 * Have I Been Pwned breach catalogue (CC BY 4.0, attribution in the footer).
 * The unauthenticated `/breaches` endpoint lists every breach HIBP has
 * loaded; the ones added inside the lookback window that are verified, not a
 * spam list, stealer log, malware dump or fabrication and large enough become
 * breach-lane candidates. The classifier is told the breach is confirmed and
 * that AI plays no role unless the service itself is an AI product.
 */

export interface HibpBreach {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string;
  AddedDate: string;
  ModifiedDate?: string;
  PwnCount: number;
  Description: string;
  DataClasses: string[];
  IsVerified: boolean;
  IsFabricated: boolean;
  IsSensitive?: boolean;
  IsRetired: boolean;
  IsSpamList: boolean;
  IsMalware: boolean;
  IsSubscriptionFree?: boolean;
  IsStealerLog: boolean;
}

export interface HibpMapOptions {
  /** Breaches added before this YYYY-MM-DD are skipped. */
  since: string;
  minPwnCount: number;
  sourceId: string;
  hintMaxChars: number;
}

const FLAGS_THAT_EXCLUDE: (keyof HibpBreach)[] = ["IsSpamList", "IsStealerLog", "IsFabricated", "IsMalware", "IsRetired"];

/** Pure mapping of one breach record to a candidate, or null when it fails a filter. */
export function breachToCandidate(b: HibpBreach, opts: HibpMapOptions): Candidate | null {
  if (!b.Name || !b.Title || !b.AddedDate) return null;
  if (b.AddedDate.slice(0, 10) < opts.since) return null;
  if (!b.IsVerified) return null;
  if (FLAGS_THAT_EXCLUDE.some((f) => b[f] === true)) return null;
  if (typeof b.PwnCount !== "number" || b.PwnCount < opts.minPwnCount) return null;

  // One page per breach; never a #fragment, which canonicalUrl would strip so every breach shared a key.
  const url = `https://haveibeenpwned.com/Breach/${encodeURIComponent(b.Name)}`;
  const count = b.PwnCount.toLocaleString("en-US");
  const dataClasses = (b.DataClasses ?? []).join(", ");
  const where = b.Domain ? ` (${b.Domain})` : "";
  const classifierHint =
    `Have I Been Pwned lists a confirmed breach of ${b.Title}${where}: ${count} accounts, breach date ${b.BreachDate}` +
    `${dataClasses ? `, data exposed: ${dataClasses}` : ""}. ` +
    "A confirmed breach of a named service; severity 4 when personal data was exposed; AI plays no role unless the service is an AI product.";

  return {
    key: urlKey(url),
    source_id: opts.sourceId,
    origin: "news",
    url,
    title: truncate(`${b.Title} data breach exposes ${count} accounts`, 400),
    published_at: b.AddedDate.slice(0, 10),
    publisher: "Have I Been Pwned",
    hint: truncate(stripHtml(b.Description ?? ""), opts.hintMaxChars),
    cve_ids: [],
    discovered_at: nowIso(),
    extra: {
      classifier_hint: classifierHint,
      hibp: true,
      incident_date: b.BreachDate,
      pwn_count: b.PwnCount,
      data_classes: b.DataClasses ?? [],
      domain: b.Domain,
    },
  };
}

export const hibpAdapter: SourceAdapter = {
  kind: "hibp",
  async fetch(source, ctx) {
    const url = source.url ?? "https://haveibeenpwned.com/api/v3/breaches";
    const breaches = await httpJson<HibpBreach[]>(url, {
      userAgent: ctx.settings.fetch.user_agent,
      timeoutMs: 40000,
      retries: ctx.settings.fetch.retries,
      maxBytes: 5_000_000,
    });
    if (!Array.isArray(breaches)) throw new Error(`${source.id}: expected a JSON array of breaches`);
    const opts: HibpMapOptions = {
      since: lookbackStart(ctx, 30),
      minPwnCount: ctx.settings.hibp.min_pwn_count,
      sourceId: source.id,
      hintMaxChars: ctx.settings.fetch.hint_max_chars,
    };
    const out: Candidate[] = [];
    for (const b of breaches) {
      const c = breachToCandidate(b, opts);
      if (c) out.push(c);
      if (ctx.limit && out.length >= ctx.limit) break;
    }
    return out;
  },
};
