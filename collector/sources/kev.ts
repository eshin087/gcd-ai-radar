import { urlKey } from "../lib/canonical";
import { httpJson } from "../lib/http";
import { nowIso } from "../lib/ids";
import { buildMatcher, truncate } from "../lib/text";
import { lookbackStart } from "./rss";
import type { Candidate, SourceAdapter } from "./types";

/**
 * CISA Known Exploited Vulnerabilities catalog (CC0). Entries for AI-stack
 * products become candidates; a CVE already tracked merges by id and the
 * classifier is told exploitation is confirmed (severity ≥ 3).
 */

const HINT =
  "CISA KEV entry: exploitation in the wild is confirmed, so if the product is an AI system or tool this is at least severity 3 (attack_on_ai / infra_vuln). Out of scope if the product has no AI role.";

interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  knownRansomwareCampaignUse?: string;
  notes?: string;
}

const EXTRA_TERMS = ["LLM", "large language model", "AI model", "machine learning", "chatbot", "copilot", "langflow", "litellm", "mlflow", "ray", "n8n", "ollama", "vllm", "open webui", "anythingllm", "dify", "flowise", "comfyui", "gradio", "jupyter", "mcp", "model context protocol"];

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
    const packageNames = Object.values(ctx.config.packages.ghsa)
      .flat()
      .map((p) => p.split("/").pop()!.replace(/[-_]+/g, " "))
      .filter((p) => p.length >= 4);
    const matcher = buildMatcher([...ctx.config.packages.nvd_keywords, ...packageNames, ...EXTRA_TERMS]);
    const out: Candidate[] = [];
    for (const v of data.vulnerabilities) {
      if (v.dateAdded < since) continue;
      const text = `${v.vendorProject} ${v.product} ${v.vulnerabilityName} ${v.shortDescription}`;
      if (!matcher.test(text)) continue;
      const link = `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?field_cve=${encodeURIComponent(v.cveID)}`;
      out.push({
        key: urlKey(link),
        source_id: source.id,
        origin: "seed_nvd",
        url: link,
        title: `${v.cveID}: ${v.vendorProject} ${v.product} — ${v.vulnerabilityName}`.slice(0, 400),
        published_at: v.dateAdded,
        publisher: "CISA",
        hint: truncate(
          `${v.shortDescription} Added to the CISA Known Exploited Vulnerabilities catalog on ${v.dateAdded}: exploitation confirmed.${v.knownRansomwareCampaignUse === "Known" ? " Known use in ransomware campaigns." : ""}`,
          ctx.settings.fetch.hint_max_chars,
        ),
        cve_ids: [v.cveID],
        discovered_at: nowIso(),
        extra: { classifier_hint: HINT, kev: true, incident_date: v.dateAdded },
      });
      if (ctx.limit && out.length >= ctx.limit) break;
    }
    return out;
  },
};
