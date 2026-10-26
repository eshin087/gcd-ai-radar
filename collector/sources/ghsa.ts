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

/** Carried on `extra.vulnerabilities`: at most this many affected packages per advisory. */
const MAX_VULNERABILITIES = 10;

export interface Advisory {
  ghsa_id: string;
  cve_id: string | null;
  html_url: string;
  summary: string;
  description: string | null;
  severity: string;
  type?: string;
  published_at: string;
  cvss?: { score?: number | null; vector_string?: string | null } | null;
  vulnerabilities?: { package?: { ecosystem?: string; name?: string }; vulnerable_version_range?: string | null; first_patched_version?: string | null }[];
}

export interface AdvisoryVulnerability {
  package: string | null;
  ecosystem: string | null;
  range: string | null;
  first_patched: string | null;
}

export interface AdvisoryMapOptions {
  sourceId: string;
  /** Ecosystem the query was made for (the advisory's own packages may span several). */
  ecosystem: string;
  hintMaxChars: number;
  discoveredAt: string;
}

/** Pure mapping of one advisory, as the REST API returns it, to a Candidate. */
export function advisoryToCandidate(adv: Advisory, o: AdvisoryMapOptions): Candidate {
  const key = urlKey(adv.html_url);
  const vulns = adv.vulnerabilities ?? [];
  const affected = vulns
    .map((v) => `${v.package?.name ?? "?"}${v.vulnerable_version_range ? ` ${v.vulnerable_version_range}` : ""}`)
    .slice(0, 4)
    .join("; ");
  const vulnerabilities: AdvisoryVulnerability[] = vulns.slice(0, MAX_VULNERABILITIES).map((v) => ({
    package: v.package?.name ?? null,
    ecosystem: v.package?.ecosystem ?? null,
    range: v.vulnerable_version_range ?? null,
    first_patched: v.first_patched_version ?? null,
  }));
  const cvss = typeof adv.cvss?.score === "number" ? adv.cvss.score : null;
  const published = adv.published_at.slice(0, 10);
  return {
    key,
    source_id: o.sourceId,
    origin: "seed_ghsa",
    url: adv.html_url,
    title: `${adv.cve_id ?? adv.ghsa_id}: ${truncate(adv.summary, 140)}`,
    published_at: published,
    publisher: "GitHub Advisory Database",
    hint: truncate(`${adv.description ?? adv.summary} Severity ${adv.severity}. Affects ${affected || o.ecosystem}.`, o.hintMaxChars),
    cve_ids: adv.cve_id ? [adv.cve_id] : [],
    discovered_at: o.discoveredAt,
    extra: {
      classifier_hint: HINT,
      ghsa_id: adv.ghsa_id,
      severity: adv.severity,
      ecosystem: o.ecosystem,
      incident_date: published,
      vulnerabilities,
      cvss,
    },
  };
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
      // `type=reviewed` is GitHub's default, but stated so the query does not change if the default does.
      let url: string | null =
        `${base}?type=reviewed&ecosystem=${encodeURIComponent(ecosystem)}&affects=${encodeURIComponent(packages.join(","))}` +
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
          const key = urlKey(adv.html_url);
          if (out.has(key)) continue;
          out.set(key, advisoryToCandidate(adv, { sourceId: source.id, ecosystem, hintMaxChars: ctx.settings.fetch.hint_max_chars, discoveredAt: nowIso() }));
        }
        url = nextLink(res.headers.get("link"));
        if (ctx.limit && out.size >= ctx.limit) break;
      }
    }
    log.info(`ghsa: ${out.size} advisory candidates`);
    return [...out.values()];
  },
};
