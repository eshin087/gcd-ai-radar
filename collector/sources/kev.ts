import { urlKey } from "../lib/canonical";
import { httpJson } from "../lib/http";
import { nowIso } from "../lib/ids";
import { truncate } from "../lib/text";
import { lookbackStart } from "./rss";
import type { Candidate, SourceAdapter } from "./types";

/**
 * CISA Known Exploited Vulnerabilities catalog (CC0). Every addition in the
 * window becomes a patch-lane candidate: exploitation in the wild is
 * confirmed, so a CVE already tracked merges by id and gains severity 3 and
 * the KEV entry on its timeline (pipeline/update.ts structuredUpdate); a new
 * one is classified with the exploitation hint, attack_on_ai when the product
 * is an AI system or tool and not_ai otherwise.
 */

const HINT =
  "CISA KEV entry: exploitation in the wild is confirmed, so this is at least severity 3, lane patch, and clears the curation bar (newsworthy). " +
  "attack_on_ai only when the product is an AI system, framework or tool; otherwise not_ai with categories [general]. patch_status from the required action: " +
  "apply updates means patched, mitigations means partial.";

export interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction?: string;
  dueDate?: string;
  knownRansomwareCampaignUse?: string;
  notes?: string;
}

export interface KevMapOptions {
  sourceId: string;
  hintMaxChars: number;
  discoveredAt: string;
}

/** Pure mapping of one catalog entry to a Candidate. */
export function kevEntryToCandidate(v: KevEntry, o: KevMapOptions): Candidate {
  const link = `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?field_cve=${encodeURIComponent(v.cveID)}`;
  const ransomware = v.knownRansomwareCampaignUse === "Known";
  return {
    key: urlKey(link),
    source_id: o.sourceId,
    origin: "seed_nvd",
    url: link,
    title: `${v.cveID}: ${v.vendorProject} ${v.product} — ${v.vulnerabilityName}`.slice(0, 400),
    published_at: v.dateAdded,
    publisher: "CISA",
    hint: truncate(
      `${v.shortDescription} Added to the CISA Known Exploited Vulnerabilities catalog on ${v.dateAdded}: exploitation confirmed.` +
        `${v.requiredAction ? ` Required action: ${v.requiredAction}` : ""}${ransomware ? " Known use in ransomware campaigns." : ""}`,
      o.hintMaxChars,
    ),
    cve_ids: [v.cveID],
    discovered_at: o.discoveredAt,
    extra: {
      classifier_hint: HINT,
      kev: true,
      incident_date: v.dateAdded,
      required_action: v.requiredAction ?? null,
      due_date: v.dueDate ?? null,
      ransomware,
      vendor: v.vendorProject,
      product: v.product,
    },
  };
}

export const kevAdapter: SourceAdapter = {
  kind: "kev",
  async fetch(source, ctx) {
    if (!source.url) throw new Error("kev: no url configured");
    const data = await httpJson<{ vulnerabilities: KevEntry[] }>(source.url, {
      userAgent: ctx.settings.fetch.user_agent,
      timeoutMs: 40000,
      retries: ctx.settings.fetch.retries,
      maxBytes: 10_000_000,
    });
    const since = ctx.since ?? lookbackStart(ctx, 30);
    const out: Candidate[] = [];
    for (const v of data.vulnerabilities) {
      if (v.dateAdded < since) continue;
      out.push(kevEntryToCandidate(v, { sourceId: source.id, hintMaxChars: ctx.settings.fetch.hint_max_chars, discoveredAt: nowIso() }));
      if (ctx.limit && out.length >= ctx.limit) break;
    }
    return out;
  },
};
