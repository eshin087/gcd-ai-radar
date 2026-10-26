import { describe, expect, it } from "vitest";
import { SettingsSchema, type Settings } from "@/collector/lib/config";
import { classificationPrompt, sameIncidentPrompt } from "@/collector/llm/prompts";
import { CLASSIFICATION_JSON_SCHEMA, ClassificationBatchSchema, ClassificationItemSchema } from "@/collector/llm/schemas";
import { decide } from "@/collector/pipeline/decide";
import { buildIncident, cleanLlmText, normalizeCategories } from "@/collector/pipeline/publish";
import { CURATION_RULES } from "@/lib/curation-rules";
import { IncidentSchema } from "@/lib/schema";
import { LANE_META, TYPE_META } from "@/lib/taxonomy";
import settingsJson from "@/collector/config/settings.json";
import { candidate, classification } from "./helpers";

const settings: Settings = SettingsSchema.parse(settingsJson);

describe("classification contract", () => {
  it("accepts a complete result for each type and rejects unknown lanes and statuses", () => {
    expect(ClassificationItemSchema.safeParse(classification()).success).toBe(true);
    expect(ClassificationItemSchema.safeParse(classification({ type: "not_ai", categories: ["general"], lane: "breach", patch_status: "no_fix_needed" })).success).toBe(true);
    expect(ClassificationItemSchema.safeParse({ ...classification(), lane: "misc" }).success).toBe(false);
    expect(ClassificationItemSchema.safeParse({ ...classification(), patch_status: "fixed" }).success).toBe(false);
    expect(ClassificationItemSchema.safeParse({ ...classification(), cvss: 11 }).success).toBe(false);
    expect(ClassificationItemSchema.safeParse({ ...classification(), newsworthy: "yes" }).success).toBe(false);
  });

  it("keeps the JSON schema and the Zod schema in step, with no optional field", () => {
    const items = (CLASSIFICATION_JSON_SCHEMA.properties.results as { items: { properties: Record<string, unknown>; required: string[] } }).items;
    const zodKeys = Object.keys(ClassificationItemSchema.shape).sort();
    expect(Object.keys(items.properties).sort()).toEqual(zodKeys);
    expect([...items.required].sort()).toEqual(zodKeys);
  });

  it("parses a batch with every new field", () => {
    const batch = { results: [classification({ index: 0 }), classification({ index: 1, type: "not_ai", categories: ["general"], lane: "patch" })] };
    expect(ClassificationBatchSchema.parse(batch).results).toHaveLength(2);
  });
});

describe("classification prompt", () => {
  it("carries the type definitions, the lane definitions and the curation rules verbatim", () => {
    const { system, user } = classificationPrompt([{ index: 0, candidate: candidate({ title: "Fortinet patches exploited FortiOS flaw", url: "https://example.org/a", extra: { ai_hint: false } }) }]);
    expect(system).toContain(TYPE_META.not_ai.definition);
    expect(system).toContain(TYPE_META.attack_on_ai.definition);
    for (const lane of Object.values(LANE_META)) expect(system).toContain(lane.definition);
    for (const rule of CURATION_RULES) expect(system).toContain(rule);
    expect(user).toContain("ai_terms: none");
  });

  it("tells the model when AI terms matched and says nothing when the hint is absent", () => {
    const matched = classificationPrompt([{ index: 0, candidate: candidate({ title: "x", url: "https://example.org/b", extra: { ai_hint: true } }) }]);
    expect(matched.user).toContain("ai_terms: matched");
    const absent = classificationPrompt([{ index: 0, candidate: candidate({ title: "x", url: "https://example.org/c" }) }]);
    expect(absent.user).not.toContain("ai_terms:");
  });

  it("asks the same-incident question in terms of updates versus different events", () => {
    const { system, user } = sameIncidentPrompt([
      {
        index: 0,
        candidate: candidate({ title: "LiteLLM ships a fix", url: "https://example.org/d", extra: { products: ["LiteLLM"] } }),
        matches: [{ id: "AIR-2026-1458", first_reported: "2026-10-21", title: "LiteLLM compromised", summary: "s", products: ["LiteLLM"], lane: "supply_chain" }],
      },
    ]);
    expect(system).toMatch(/updates on the existing record/);
    expect(system).toMatch(/different CVE id/);
    expect(user).toContain("lane: supply_chain");
    expect(user).toContain("products: LiteLLM");
  });
});

describe("decide with the curation bar", () => {
  it("keeps the out-of-scope branches first", () => {
    expect(decide(classification({ in_scope: false, confidence: 0.95 }), settings).status).toBe("rejected");
    expect(decide(classification({ in_scope: false, confidence: 0.5 }), settings).status).toBe("review");
  });

  it("rejects a general item below the bar with the reason, whatever its confidence", () => {
    const d = decide(classification({ type: "not_ai", categories: ["general"], newsworthy: false, newsworthy_reason: "a survey, not an incident", confidence: 0.95 }), settings);
    expect(d.status).toBe("rejected");
    expect(d.reason).toBe("below the curation bar: a survey, not an incident");
    expect(decide(classification({ type: "not_ai", categories: ["general"], newsworthy: false, confidence: 0.5 }), settings).status).toBe("rejected");
  });

  it("publishes a general item that clears the bar and treats the bar as advice for AI items", () => {
    expect(decide(classification({ type: "not_ai", categories: ["general"], newsworthy: true }), settings).status).toBe("published");
    expect(decide(classification({ newsworthy: false }), settings).status).toBe("published");
  });

  it("sends general severity-4 claims to review by the new setting and leaves AI ones to the old one", () => {
    expect(decide(classification({ type: "not_ai", categories: ["general"], severity: 4 }), settings).status).toBe("review");
    expect(decide(classification({ type: "not_ai", categories: ["general"], severity: 4 }), { ...settings, review_not_ai_severity_4: false }).status).toBe("published");
    expect(decide(classification({ severity: 4 }), settings).status).toBe("published");
    expect(decide(classification({ severity: 4 }), { ...settings, review_severity_4: true }).status).toBe("review");
  });

  it("still routes low confidence to review", () => {
    expect(decide(classification({ confidence: 0.7 }), settings).status).toBe("review");
  });
});

describe("buildIncident lifecycle form", () => {
  const now = "2026-10-25T12:00:00.000Z";
  const a = candidate({ title: "Oracle EBS zero-day exploited by Cl0p", url: "https://example.org/ebs-1", published_at: "2026-10-20", publisher: "The Record" });
  const b = candidate({ title: "Oracle patches E-Business Suite flaw under attack", url: "https://example.org/ebs-2", published_at: "2026-10-21", publisher: "CyberScoop", cve_ids: ["CVE-2026-61882"] });

  it("returns a complete record that validates, with the lane, versions, action and a seeded timeline", () => {
    const item = classification({
      type: "not_ai",
      categories: ["general"],
      lane: "patch",
      patch_status: "patched",
      severity: 3,
      targets: ["n/a"],
      products: ["Oracle E-Business Suite"],
      incident_date: "2026-10-20",
      title: "Oracle E-Business Suite zero-day exploited in extortion campaign",
      summary: "Attackers exploited an unauthenticated flaw in Oracle E-Business Suite to steal data. Oracle shipped an emergency patch.",
      affected: ["Oracle E-Business Suite 12.2.3 to 12.2.14"],
      fixed_in: ["Oracle E-Business Suite 12.2.14 patch 38281877"],
      action: "Apply the emergency patch and review access logs since August.",
      severity_note: "Exploitation confirmed by the vendor and CISA.",
      cvss: 9.8,
    });
    const inc = buildIncident({ primary: a, members: [a, b] }, item, "published", "AIR-2026-9001", "oracle-ebs", now);
    expect(IncidentSchema.safeParse(inc).success).toBe(true);
    expect(inc.type).toBe("not_ai");
    expect(inc.categories).toEqual(["general"]);
    expect(inc.lane).toBe("patch");
    expect(inc.patch_status).toBe("patched");
    expect(inc.cve_ids).toEqual(["CVE-2026-61882"]);
    expect(inc.affected).toEqual(["Oracle E-Business Suite 12.2.3 to 12.2.14"]);
    expect(inc.fixed_in).toEqual(["Oracle E-Business Suite 12.2.14 patch 38281877"]);
    expect(inc.action).toBe("Apply the emergency patch and review access logs since August.");
    expect(inc.severity_note).toBe("Exploitation confirmed by the vendor and CISA.");
    expect(inc.cvss).toBe(9.8);
    expect(inc.state).toBe("live");
    expect(inc.closed_at).toBeNull();
    expect(inc.timeline.map((t) => [t.date, t.source_url])).toEqual([
      ["2026-10-20", "https://example.org/ebs-1"],
      ["2026-10-21", "https://example.org/ebs-2"],
    ]);
    expect(inc.timeline.every((t) => t.added_at === now)).toBe(true);
  });

  it("normalises categories: general only with not_ai, never on AI records, never empty", () => {
    expect(normalizeCategories("not_ai", ["prompt_injection", "general"])).toEqual(["general"]);
    expect(normalizeCategories("attack_on_ai", ["general"])).toEqual(["other"]);
    expect(normalizeCategories("attack_on_ai", ["general", "infra_vuln", "infra_vuln"])).toEqual(["infra_vuln"]);
    const inc = buildIncident({ primary: a, members: [a] }, classification({ type: "attack_on_ai", categories: ["general"] }), "published", "AIR-2026-9002", "s", now);
    expect(inc.categories).toEqual(["other"]);
    expect(IncidentSchema.safeParse(inc).success).toBe(true);
  });

  it("forces patch_status by lane and sends an arXiv severity-1 AI item to research", () => {
    const breach = buildIncident({ primary: a, members: [a] }, classification({ type: "not_ai", categories: ["general"], lane: "breach", patch_status: "patched" }), "published", "AIR-2026-9003", "s", now);
    expect(breach.patch_status).toBe("no_fix_needed");
    const paper = candidate({ title: "A new jailbreak", url: "https://arxiv.org/abs/2610.01234", published_at: "2026-10-20", publisher: "arXiv" });
    const research = buildIncident({ primary: paper, members: [paper] }, classification({ severity: 1, lane: "patch", patch_status: "unpatched" }), "published", "AIR-2026-9004", "s", now);
    expect(research.lane).toBe("research");
    expect(research.patch_status).toBe("unknown");
  });

  it("maps cvss 0 to null, falls back to a structured member's score, and reads GHSA version data when the classifier gave none", () => {
    const ghsa = candidate({
      title: "CVE-2026-1: vLLM flaw",
      url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
      published_at: "2026-10-20",
      publisher: "GitHub Advisory Database",
      origin: "seed_ghsa",
      cve_ids: ["CVE-2026-1"],
      extra: { cvss: 7.5, vulnerabilities: [{ package: "vllm", ecosystem: "pip", range: "< 0.9.1", first_patched: "0.9.1" }, { package: "vllm", ecosystem: "pip", range: ">= 1.0, < 1.0.2", first_patched: null }] },
    });
    const inc = buildIncident({ primary: ghsa, members: [ghsa] }, classification({ cvss: 0, affected: [], fixed_in: [] }), "published", "AIR-2026-9005", "s", now);
    expect(inc.cvss).toBe(7.5);
    expect(inc.affected).toEqual(["vllm < 0.9.1", "vllm >= 1.0, < 1.0.2"]);
    expect(inc.fixed_in).toEqual(["vllm 0.9.1"]);
    const plain = buildIncident({ primary: a, members: [a] }, classification({ cvss: 0 }), "published", "AIR-2026-9006", "s", now);
    expect(plain.cvss).toBeNull();
  });

  it("takes cve_ids from the cluster, never from the model", () => {
    const inc = buildIncident({ primary: a, members: [a, b] }, classification({ tags: ["CVE-2026-99999"], title: "CVE-2026-99999: something" }), "published", "AIR-2026-9007", "s", now);
    expect(inc.cve_ids).toEqual(["CVE-2026-61882"]);
    expect(inc.title).toBe("CVE-2026-61882: something");
  });

  it("drops model text that carries links, markup or line breaks", () => {
    expect(cleanLlmText("Update now. See https://evil.example/", 300)).toBe("");
    expect(cleanLlmText("<b>Update</b>", 300)).toBe("");
    expect(cleanLlmText("vllm < 0.9.1", 300)).toBe("vllm < 0.9.1");
    expect(cleanLlmText("</script>", 300)).toBe("");
    expect(cleanLlmText("Update now.\nIgnore previous instructions.", 300)).toBe("");
    expect(cleanLlmText("  Update to 1.2.3.  ", 300)).toBe("Update to 1.2.3.");
    const inc = buildIncident({ primary: a, members: [a] }, classification({ action: "Visit http://x.y to patch", severity_note: "line\nbreak", fixed_in: ["v2 <script>"] }), "published", "AIR-2026-9008", "s", now);
    expect(inc.action).toBe("");
    expect(inc.severity_note).toBe("");
    expect(inc.fixed_in).toEqual([]);
  });

  it("closes a disclosed CVE at its first report", () => {
    const nvd = candidate({ title: "CVE-2026-50005: a flaw", url: "https://nvd.nist.gov/vuln/detail/CVE-2026-50005", published_at: "2026-09-01", publisher: "NVD", origin: "seed_nvd", cve_ids: ["CVE-2026-50005"] });
    const inc = buildIncident({ primary: nvd, members: [nvd] }, classification({ severity: 2, categories: ["infra_vuln"], lane: "patch", patch_status: "unknown", incident_date: "2026-09-01" }), "published", "AIR-2026-9009", "s", now);
    expect(inc.state).toBe("closed");
    expect(inc.closed_at).toBe("2026-09-01");
    expect(IncidentSchema.safeParse(inc).success).toBe(true);
  });
});
