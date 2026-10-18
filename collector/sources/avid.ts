import { canonicalUrl, urlKey } from "../lib/canonical";
import { httpJson } from "../lib/http";
import { nowIso } from "../lib/ids";
import { log } from "../lib/log";
import { publisherFor } from "../lib/publishers";
import { seedCves, truncate } from "../lib/text";
import type { Candidate, SourceAdapter } from "./types";

/**
 * AVID, the AI Vulnerability Database (MIT). Dormant upstream since 2026-03,
 * so this is a one-time backfill seed: the 2022–2023 vulnerability records
 * and the hand-curated reports (the 2026 CVE-derived reports duplicate NVD
 * and are skipped). Runs only with --since (backfill).
 */

const HINT =
  "AVID (AI Vulnerability Database) record. Classify from the description and references; most are research findings (severity 1) or disclosed vulnerabilities (2).";

const DIRS = ["vulnerabilities/2022", "vulnerabilities/2023", "reports/2022", "reports/2023", "reports/2025"];

interface AvidRecord {
  metadata?: { vuln_id?: string; report_id?: string };
  description?: { value?: string };
  references?: { label?: string; url?: string }[];
  affects?: { developer?: string[]; deployer?: string[]; artifacts?: { name?: string }[] };
  published_date?: string;
  reported_date?: string;
  last_modified_date?: string;
  problemtype?: { description?: { value?: string } };
}

export const avidAdapter: SourceAdapter = {
  kind: "avid",
  async fetch(source, ctx) {
    if (!ctx.since) {
      log.info("avid: seed source, only runs with --since (backfill)");
      return [];
    }
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const rawBase = (source.url ?? "https://raw.githubusercontent.com/avidml/avid-db/main/").replace(/\/$/, "");
    const out: Candidate[] = [];
    for (const dir of DIRS) {
      const listing = await httpJson<{ name: string; download_url: string | null }[]>(`https://api.github.com/repos/avidml/avid-db/contents/${dir}`, {
        userAgent: ctx.settings.fetch.user_agent,
        headers,
        retries: 2,
      });
      for (const f of listing) {
        if (!f.name.endsWith(".json")) continue;
        const rec = await httpJson<AvidRecord>(`${rawBase}/${dir}/${f.name}`, { userAgent: ctx.settings.fetch.user_agent, retries: 2 });
        const id = rec.metadata?.vuln_id ?? rec.metadata?.report_id ?? f.name.replace(/\.json$/, "");
        const link = `https://github.com/avidml/avid-db/blob/main/${dir}/${f.name}`;
        const date = (rec.published_date ?? rec.reported_date ?? rec.last_modified_date ?? "2023-01-01").slice(0, 10);
        if (date < ctx.since) continue;
        const desc = rec.description?.value ?? "";
        const products = (rec.affects?.artifacts ?? []).map((a) => a.name).filter(Boolean).join(", ");
        const refs = (rec.references ?? [])
          .map((r) => ({ url: r.url ? canonicalUrl(r.url) : null, label: r.label }))
          .filter((r): r is { url: string; label: string | undefined } => Boolean(r.url))
          .slice(0, 5)
          .map((r) => ({ url: r.url, publisher: publisherFor(r.url, ctx.config.publishers), title: truncate(r.label ?? r.url, 300), published_at: date }));
        out.push({
          key: urlKey(link),
          source_id: source.id,
          origin: "seed_avid",
          url: link,
          title: truncate(`${id}: ${desc.split(/(?<=[.!?])\s/)[0] ?? desc}`, 400),
          published_at: date,
          publisher: "AVID",
          hint: truncate(`${desc}${products ? ` Affects: ${products}.` : ""}${rec.problemtype?.description?.value ? ` Problem: ${rec.problemtype.description.value}` : ""}`, ctx.settings.fetch.hint_max_chars),
          cve_ids: seedCves(refs),
          discovered_at: nowIso(),
          extra: { classifier_hint: HINT, avid_id: id, additional_sources: refs, incident_date: date },
        });
        if (ctx.limit && out.length >= ctx.limit) return out;
      }
    }
    log.info(`avid: ${out.length} records`);
    return out;
  },
};
