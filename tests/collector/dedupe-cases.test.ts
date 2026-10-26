import { describe, expect, it } from "vitest";
import { SettingsSchema, type Settings } from "@/collector/lib/config";
import type { State } from "@/collector/lib/state";
import { entityTokens } from "@/collector/lib/text";
import {
  buildEntityIndex,
  clusterCandidates,
  dedupe,
  pairwiseClusterChecks,
  productKeys,
  productPairChecks,
  productRecordChecks,
  sharedEntities,
  type ProductSubject,
} from "@/collector/pipeline/dedupe";
import type { Incident, Source } from "@/lib/schema";
import settingsJson from "@/collector/config/settings.json";
import { candidate } from "./helpers";

/**
 * The four events that became several records each in October 2026, with
 * their real headlines, and two pairs that must stay apart. Every positive
 * case must at least reach the model (an LlmCheck naming the right record);
 * every negative must never merge deterministically.
 */

const settings: Settings = SettingsSchema.parse(settingsJson);

function src(publisher: string, title: string, published_at: string, url: string): Source {
  return { url, publisher, title, published_at };
}

function record(partial: Partial<Incident> & { id: string; title: string; sources: Source[] }): Incident {
  const first = [...partial.sources].sort((a, b) => a.published_at.localeCompare(b.published_at))[0]!.published_at;
  return {
    slug: partial.id.toLowerCase(),
    summary: "Something happened. The vendor responded.",
    type: "attack_on_ai",
    categories: ["supply_chain"],
    severity: 3,
    targets: ["framework_or_tooling"],
    products: [],
    incident_date: first,
    incident_date_precision: "day",
    first_reported: first,
    source_count: partial.sources.length,
    confidence: 0.9,
    status: "published",
    origin: "news",
    tags: [],
    created_at: `${first}T06:00:00.000Z`,
    updated_at: `${first}T06:00:00.000Z`,
    ...partial,
  };
}

function state(incidents: Incident[]): State {
  return { incidents, review: [], rejected: [], pending: [], seen: {}, runs: [], collector: { sources: {}, cve_lookups: {} } };
}

function subject(c: ReturnType<typeof candidate>, products: string[], lane: ProductSubject["lane"], incident_date: string): ProductSubject {
  return { cluster: { primary: c, members: [c] }, title: c.title, summary: c.hint || "(no description)", products, lane, incident_date };
}

/* ---------- The records as published (titles are the classifier's, sources the outlets') ---------- */

const cairnThn = record({
  id: "AIR-2026-1428",
  title: "Threat Actors Use Autonomous AI Agents to Breach Over 1,200 Websites",
  type: "ai_enabled_attack",
  categories: ["ai_assisted_intrusion"],
  products: ["Cairn"],
  sources: [src("The Hacker News", "Hackers Use Autonomous AI Agents to Breach Company Websites, Target Over 1,200 Sites", "2026-10-20", "https://thehackernews.com/2026/10/hackers-use-autonomous-ai-agents-to.html")],
});
const cairnDr = candidate({ title: "Hackers Abuse AI Pen-Test Tool Cairn to Automate Massive Attack Spree", url: "https://darkreading.com/cyberattacks-data-breaches/hackers-abuse-ai-pen-test-tool-cairn", publisher: "Dark Reading", published_at: "2026-10-20", source_id: "darkreading" });
const cairnSw = candidate({ title: "AI Platform Cairn Abused to Hack Over 100 Organizations", url: "https://securityweek.com/ai-platform-cairn-abused-to-hack-over-100-organizations", publisher: "SecurityWeek", published_at: "2026-10-20", source_id: "securityweek" });

const opencodeBreach = record({
  id: "AIR-2026-1406",
  title: "OpenCode Console Breach Exposes Third-Party AI Provider API Keys",
  categories: ["data_leak"],
  products: ["OpenCode Console"],
  sources: [src("The Hacker News", "OpenCode Console Breach May Have Exposed OpenAI, Anthropic, and Google API Keys", "2026-10-19", "https://thehackernews.com/2026/10/opencode-console-breach-may-have.html")],
});
const opencodeBc = candidate({ title: "OpenCode hack exposes API keys amid AI distillation attacks", url: "https://bleepingcomputer.com/news/security/opencode-hack-exposes-api-keys-amid-ai-distillation-attacks", publisher: "BleepingComputer", published_at: "2026-10-19", source_id: "bleepingcomputer" });
const opencodeMcpFlaw = candidate({ title: "OpenCode Flaw Lets Malicious MCP Servers Execute Code During Sign-In on Windows and WSL", url: "https://thehackernews.com/2026/10/opencode-flaw-lets-malicious-mcp.html", published_at: "2026-10-22" });

const litellm = record({
  id: "AIR-2026-1458",
  title: "LiteLLM Compromised in Supply Chain Attack Delivering Credential Stealer",
  products: ["LiteLLM"],
  sources: [
    src("The Hacker News", "LiteLLM Compromised in Supply Chain Attack Delivering Credential Stealer and Backdoor", "2026-10-21", "https://thehackernews.com/2026/10/litellm-compromised-in-supply-chain.html"),
    src("SecurityWeek", "LiteLLM Compromised in Fresh Supply Chain Attack", "2026-10-23", "https://securityweek.com/litellm-compromised-in-fresh-supply-chain-attack"),
  ],
});
const litellmCve1 = record({
  id: "AIR-2026-0289",
  title: "CVE-2026-108574: Authorization bypass flaw in BerriAI LiteLLM",
  categories: ["infra_vuln"],
  severity: 2,
  origin: "seed_nvd",
  products: ["LiteLLM"],
  tags: ["CVE-2026-108574", "litellm"],
  sources: [src("NVD", "CVE-2026-108574: A flaw has been found in BerriAI LiteLLM up to 1.95.0.", "2026-10-11", "https://nvd.nist.gov/vuln/detail/CVE-2026-108574")],
});
const litellmCve2 = record({
  id: "AIR-2026-0290",
  title: "CVE-2026-108575: Improper authorization flaw in BerriAI LiteLLM secret resolution",
  categories: ["infra_vuln"],
  severity: 2,
  origin: "seed_nvd",
  products: ["LiteLLM"],
  tags: ["CVE-2026-108575", "litellm"],
  sources: [src("NVD", "CVE-2026-108575: A vulnerability has been found in BerriAI LiteLLM up to 1.94.0.", "2026-10-11", "https://nvd.nist.gov/vuln/detail/CVE-2026-108575")],
});
const litellmFollowUps = [
  candidate({ title: "LiteLLM Suspects GitHub Token Leak in AI Gateway Logs Behind Malicious Package Release", url: "https://thehackernews.com/2026/10/litellm-suspects-github-token-leak-in.html", published_at: "2026-10-22" }),
  candidate({ title: "LiteLLM release pipeline hacked to distribute info-stealer malware", url: "https://bleepingcomputer.com/news/security/litellm-release-pipeline-hacked-to-distribute-info-stealer-malware", publisher: "BleepingComputer", published_at: "2026-10-22", source_id: "bleepingcomputer" }),
  candidate({ title: "Inside the LiteLLM 1.107.0 supply chain compromise: Credential theft through Python startup hooks", url: "https://microsoft.com/en-us/security/blog/2026/10/23/inside-the-litellm-1-107-0-supply-chain-compromise", publisher: "Microsoft Security", published_at: "2026-10-23", source_id: "ms-security" }),
  candidate({ title: "Leaked LiteLLM Master Key Let Attackers Steal GitHub Tokens and Hijack Release Pipeline", url: "https://thehackernews.com/2026/10/leaked-litellm-master-key-let-attackers.html", published_at: "2026-10-24" }),
];

const storm = record({
  id: "AIR-2026-1460",
  title: "Storm-0940 Uses ARTEX Agentic AI in ConnectWise Supply Chain Campaign",
  type: "ai_enabled_attack",
  categories: ["ai_assisted_intrusion"],
  products: ["Microsoft 365", "ConnectWise", "ARTEX"],
  sources: [src("Microsoft Security", "AI-driven, large-scale nation-state campaign using ARTEX enables supply chain compromise", "2026-10-21", "https://microsoft.com/en-us/security/blog/2026/10/21/storm-0940-uses-artex-agentic-ai-connectwise-supply-chain-compromise")],
});
const stormThn = candidate({ title: "China-Linked Hackers Use ARTEX AI Agents in ConnectWise Supply Chain Attack", url: "https://thehackernews.com/2026/10/china-linked-hackers-use-artex-ai.html", published_at: "2026-10-22" });
const stormDr = candidate({ title: "Microsoft Links Storm-0940 to ConnectWise Supply Chain Attack", url: "https://darkreading.com/cyberattacks-data-breaches/microsoft-storm-0940-connectwise-supply-chain-attack", publisher: "Dark Reading", published_at: "2026-10-22", source_id: "darkreading" });

const everything = [cairnThn, opencodeBreach, litellm, litellmCve1, litellmCve2, storm];

describe("Cairn: three outlets, no shared headline words", () => {
  it("sends the Dark Reading and SecurityWeek pieces of one run to the model through the shared entity", () => {
    const clusters = clusterCandidates([cairnDr, cairnSw], settings);
    expect(clusters).toHaveLength(2);
    const df = buildEntityIndex([], [cairnDr, cairnSw]);
    expect(sharedEntities(entityTokens(cairnDr.title), entityTokens(cairnSw.title), df, settings.dedupe.entity_max_df)).toEqual(["cairn"]);
    const checks = pairwiseClusterChecks(clusters, settings, df);
    expect([...checks.keys()]).toEqual([1]);
    expect(checks.get(1)!.matches[0]).toMatchObject({ via: "entity", clusterIndex: 0 });
  });

  it("finds the Hacker News record for the Dark Reading piece through the product pass", () => {
    const s = state(everything);
    const dd = dedupe([cairnDr], s, settings);
    expect(dd.merges).toHaveLength(0);
    expect(dd.fresh.map((c) => c.url)).toEqual([cairnDr.url]); // no title words, no shared entity: nothing before classification
    const checks = productRecordChecks([subject(cairnDr, ["Cairn"], "breach", "2026-10-20")], s, settings);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.check.matches.map((m) => [m.ref.id, m.via])).toEqual([["AIR-2026-1428", "product"]]);
  });

  it("matches products by family or first token, not by exact spelling", () => {
    expect([...productKeys(["OpenCode Console"])]).toEqual(expect.arrayContaining(["~opencode"]));
    expect([...productKeys(["ConnectWise Cloud Backup"])]).toContain("~connectwise");
    expect([...productKeys(["Microsoft 365"])]).toEqual(["microsoft 365"]);
    expect([...productKeys(["LiteLLM", "litellm proxy"])]).toContain("litellm");
  });
});

describe("OpenCode: two outlets across runs", () => {
  it("asks the model about the BleepingComputer piece with the Hacker News record as the match", () => {
    const dd = dedupe([opencodeBc], state(everything), settings);
    expect(dd.merges).toHaveLength(0);
    expect(dd.llmChecks).toHaveLength(1);
    expect(dd.llmChecks[0]!.matches[0]!.ref.id).toBe("AIR-2026-1406");
    expect(dd.llmChecks[0]!.matches[0]!.ref.products).toEqual(["OpenCode Console"]);
    expect(dd.llmChecks[0]!.matches[0]!.ref.lane).toBe("breach");
  });

  it("never merges the later OpenCode MCP flaw into the breach without the model", () => {
    const s = state(everything);
    const dd = dedupe([opencodeMcpFlaw], s, settings);
    expect(dd.merges).toHaveLength(0);
    const checks = productRecordChecks([subject(opencodeMcpFlaw, ["OpenCode"], "patch", "2026-10-22")], s, settings);
    for (const c of checks) for (const m of c.check.matches) expect(m.via).toBe("product"); // a question, never an answer
  });
});

describe("LiteLLM: four follow-ups and two sibling CVEs", () => {
  it("routes every follow-up to the supply-chain record, ahead of the product's CVE records", () => {
    const s = state(everything);
    for (const c of litellmFollowUps) {
      const dd = dedupe([c], s, settings);
      expect(dd.merges).toHaveLength(0);
      const viaTitle = dd.llmChecks[0];
      if (viaTitle) {
        expect(viaTitle.matches[0]!.ref.id).toBe("AIR-2026-1458");
        continue;
      }
      const checks = productRecordChecks([subject(c, ["LiteLLM"], "supply_chain", "2026-10-21")], s, settings);
      expect(checks, c.title).toHaveLength(1);
      expect(checks[0]!.check.matches[0]!.ref.id, c.title).toBe("AIR-2026-1458");
      expect(checks[0]!.check.matches.map((m) => m.ref.id)).not.toContain("AIR-2026-0289");
    }
  });

  it("does not treat the product name as an entity when many records carry it", () => {
    const df = buildEntityIndex(everything, [...litellmFollowUps, cairnDr, cairnSw]);
    expect(df.get("litellm")).toBeGreaterThan(settings.dedupe.entity_max_df);
    expect(df.get("cairn")).toBe(2); // the Hacker News record never names the tool, so only the two candidates carry it
  });

  it("keeps two LiteLLM CVEs apart: conflicting ids, no check, no merge", () => {
    const nvd = candidate({
      title: "CVE-2026-108575: A vulnerability has been found in BerriAI LiteLLM up to 1.94.0.",
      url: "https://nvd.nist.gov/vuln/detail/CVE-2026-108575",
      publisher: "NVD",
      origin: "seed_nvd",
      published_at: "2026-10-11",
      cve_ids: ["CVE-2026-108575"],
      source_id: "nvd",
    });
    const without = everything.filter((r) => r.id !== "AIR-2026-0290"); // the record about this very CVE would (rightly) take it
    const s = state(without);
    // the real dataset carries "litellm" in 56 records, so it is no entity; the fixture says so through the index
    const df = buildEntityIndex(everything, [nvd, ...litellmFollowUps]);
    const dd = dedupe([nvd], s, settings, df);
    expect(dd.merges).toHaveLength(0);
    for (const c of dd.llmChecks) expect(c.matches.map((m) => m.ref.id)).not.toContain("AIR-2026-0289");
    const checks = productRecordChecks([{ cluster: { primary: nvd, members: [nvd] }, title: nvd.title, summary: "s", products: ["LiteLLM"], lane: "patch", incident_date: "2026-10-11" }], s, settings);
    expect(checks).toHaveLength(0);
  });

  it("checks two same-run clusters that name the same product", () => {
    const a = subject(litellmFollowUps[0]!, ["LiteLLM"], "supply_chain", "2026-10-21");
    const b = subject(litellmFollowUps[1]!, ["LiteLLM"], "supply_chain", "2026-10-22");
    const checks = productPairChecks([a, b], settings);
    expect([...checks.keys()]).toEqual([1]);
    expect(checks.get(1)!.matches[0]).toMatchObject({ via: "product", clusterIndex: 0 });
    expect(checks.get(1)!.candidate.extra?.["products"]).toEqual(["LiteLLM"]);
  });
});

describe("Storm-0940: two outlets a day after the vendor", () => {
  it("asks the model about both pieces with the Microsoft record as the match", () => {
    for (const c of [stormThn, stormDr]) {
      const dd = dedupe([c], state(everything), settings);
      expect(dd.merges, c.title).toHaveLength(0);
      expect(dd.llmChecks, c.title).toHaveLength(1);
      expect(dd.llmChecks[0]!.matches[0]!.ref.id, c.title).toBe("AIR-2026-1460");
    }
  });

  it("names the actor and the victim product as entities", () => {
    expect(entityTokens(stormDr.title)).toEqual(expect.arrayContaining(["0940", "connectwi"]));
    expect(entityTokens(stormThn.title)).toEqual(expect.arrayContaining(["artex", "connectwi"]));
  });
});

describe("thresholds", () => {
  it("still leaves an unrelated headline fresh at the lower LLM-check threshold", () => {
    const other = candidate({ title: "Researchers jailbreak Gemini with ASCII art", url: "https://example.org/other", published_at: "2026-10-21" });
    const dd = dedupe([other], state(everything), settings);
    expect(dd.fresh).toHaveLength(1);
    expect(dd.llmChecks).toHaveLength(0);
  });
});
