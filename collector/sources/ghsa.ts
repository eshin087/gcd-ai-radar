import { urlKey } from "../lib/canonical";
import { httpFetch } from "../lib/http";
import { nowIso } from "../lib/ids";
import { errorMessage, log } from "../lib/log";
import { truncate } from "../lib/text";
import { lookbackStart } from "./rss";
import type { Candidate, SourceAdapter } from "./types";

/**
 * GitHub Advisory Database (CC BY 4.0, attribution by linking). Reviewed
 * advisories for the allow-listed packages per ecosystem, incremental by
 * `modified`. 60 requests/hour unauthenticated, 5,000 with GITHUB_TOKEN.
 */

const HINT =
  "GitHub Security Advisory for an allow-listed AI package. In scope as attack_on_ai / infra_vuln (or supply_chain for malicious packages); severity 2 unless exploitation is confirmed (3). incident_date is the published date.";

interface Advisory {
  ghsa_id: string;
  cve_id: string | null;
  html_url: string;
  summary: string;
  description: string | null;
  severity: string;
  type?: string;
  published_at: string;
  vulnerabilities?: { package?: { ecosystem?: string; name?: string }; vulnerable_version_range?: string | null; first_patched_version?: string | null }[];
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1]! : null;
}

export const ghsaAdapter: SourceAdapter = {
  kind: "ghsa",
  async fetch(source, ctx) {
    const base = source.url ?? "https://api.github.com/advisories";
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
    const since = ctx.since ?? lookbackStart(ctx, 30);
    const out = new Map<string, Candidate>();

    for (const [ecosystem, packages] of Object.entries(ctx.config.packages.ghsa)) {
      if (packages.length === 0) continue;
      let url: string | null =
        `${base}?ecosystem=${encodeURIComponent(ecosystem)}&affects=${encodeURIComponent(packages.join(","))}` +
        `&modified=${encodeURIComponent(`>=${since}`)}&per_page=100&sort=updated&direction=desc`;
      for (let page = 0; url && page < 10; page++) {
        let res;
        try {
          res = await httpFetch(url, { userAgent: ctx.settings.fetch.user_agent, timeoutMs: ctx.settings.fetch.timeout_ms, retries: 2, headers });
        } catch (err) {
          log.warn(`ghsa: ${ecosystem} failed`, { error: errorMessage(err).slice(0, 160) });
          break;
        }
        const advisories = JSON.parse(res.body) as Advisory[];
        for (const adv of advisories) {
          if (adv.type && adv.type !== "reviewed" && adv.type !== "malware") continue;
          const key = urlKey(adv.html_url);
          if (out.has(key)) continue;
          const affected = (adv.vulnerabilities ?? [])
            .map((v) => `${v.package?.name ?? "?"}${v.vulnerable_version_range ? ` ${v.vulnerable_version_range}` : ""}`)
            .slice(0, 4)
            .join("; ");
          const published = adv.published_at.slice(0, 10);
          out.set(key, {
            key,
            source_id: source.id,
            origin: "seed_ghsa",
            url: adv.html_url,
            title: `${adv.cve_id ?? adv.ghsa_id}: ${truncate(adv.summary, 140)}`,
            published_at: published,
            publisher: "GitHub Advisory Database",
            hint: truncate(`${adv.description ?? adv.summary} Severity ${adv.severity}. Affects ${affected || ecosystem}.${adv.type === "malware" ? " Malware advisory." : ""}`, ctx.settings.fetch.hint_max_chars),
            cve_ids: adv.cve_id ? [adv.cve_id] : [],
            discovered_at: nowIso(),
            extra: { classifier_hint: HINT, ghsa_id: adv.ghsa_id, severity: adv.severity, ecosystem, incident_date: published },
          });
        }
        url = nextLink(res.headers.get("link"));
        if (ctx.limit && out.size >= ctx.limit) break;
      }
    }
    log.info(`ghsa: ${out.size} advisory candidates`);
    return [...out.values()];
  },
};
