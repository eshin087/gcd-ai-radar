import { describe, expect, it } from "vitest";
import { SettingsSchema, type Settings } from "@/collector/lib/config";
import type { State } from "@/collector/lib/state";
import { clusterCandidates, dedupe, pairwiseClusterChecks } from "@/collector/pipeline/dedupe";
import { decide } from "@/collector/pipeline/decide";
import { buildIncident, mergeSource } from "@/collector/pipeline/publish";
import type { Candidate } from "@/collector/sources/types";
import { ClassificationBatchSchema, extractJson, type ClassificationItem } from "@/collector/llm/schemas";
import { parseRobots, robotsAllows } from "@/collector/pipeline/enrich";
import type { Incident } from "@/lib/schema";
import settingsJson from "@/collector/config/settings.json";

const settings: Settings = SettingsSchema.parse(settingsJson);

function cand(partial: Partial<Candidate> & { title: string; url: string }): Candidate {
  return {
    key: partial.url.replace(/[^a-z0-9]/gi, "").slice(-16).padStart(16, "0"),
    source_id: "hn",
    origin: "news",
    published_at: "2026-10-10",
    publisher: "Example",
    hint: "",
    cve_ids: [],
    discovered_at: "2026-10-10T00:00:00.000Z",
    ...partial,
  };
}

function incident(partial: Partial<Incident> & { id: string; title: string }): Incident {
  return {
    slug: partial.id.toLowerCase(),
    summary: "Something happened to an AI system. The vendor responded.",
    type: "attack_on_ai",
    categories: ["prompt_injection"],
    severity: 3,
    targets: ["OpenAI"],
    products: [],
    incident_date: "2026-10-08",
    incident_date_precision: "day",
    first_reported: "2026-10-09",
    sources: [{ url: `https://example.org/${partial.id}`, publisher: "Example", title: partial.title, published_at: "2026-10-09" }],
    source_count: 1,
    confidence: 0.9,
    status: "published",
    origin: "news",
    tags: [],
    created_at: "2026-10-09T00:00:00.000Z",
    updated_at: "2026-10-09T00:00:00.000Z",
    ...partial,
  };
}

function state(partial: Partial<State> = {}): State {
  return { incidents: [], review: [], rejected: [], pending: [], seen: {}, runs: [], ...partial };
}

describe("dedupe", () => {
  it("skips urls already seen and merges re-discovered sources of known incidents", () => {
    const inc = incident({ id: "AIR-2026-0001", title: "ChatGPT connector leaks Google Drive files via prompt injection" });
    const s = state({
      incidents: [inc],
      seen: { k1: { status: "rejected", at: "2026-10-01T00:00:00.000Z" }, k2: { status: "merged", id: "AIR-2026-0001", at: "2026-10-01T00:00:00.000Z" } },
    });
    const a = cand({ key: "k1", title: "x", url: "https://a.org/1" });
    const b = cand({ key: "k2", title: "y", url: "https://b.org/2" });
    const r = dedupe([a, b], s, settings);
    expect(r.skipped).toHaveLength(1);
    expect(r.merges).toHaveLength(1);
    expect(r.merges[0]!.how).toBe("seen");
  });

  it("merges on shared CVE ids regardless of title", () => {
    const inc = incident({ id: "AIR-2026-0002", title: "Remote code execution in vLLM", tags: ["CVE-2026-11111"] });
    const c = cand({ title: "Patch now: new flaw in inference servers", url: "https://a.org/cve", cve_ids: ["CVE-2026-11111"] });
    const r = dedupe([c], state({ incidents: [inc] }), settings);
    expect(r.merges[0]?.how).toBe("cve");
  });

  it("merges near-identical titles, asks the LLM about reworded ones, and keeps unrelated ones fresh", () => {
    const inc = incident({ id: "AIR-2026-0003", title: "Deepfake video call defrauds Arup of $25 million" });
    const same = cand({ title: "Deepfake video call defrauds Arup of $25 million - Reuters", url: "https://a.org/same" });
    const reworded = cand({ title: "Deepfake video call defrauds Arup of $25M, police say", url: "https://a.org/reworded" });
    const other = cand({ title: "Researchers jailbreak Gemini with ASCII art", url: "https://a.org/other" });
    const r = dedupe([same, reworded, other], state({ incidents: [inc] }), settings);
    expect(r.merges.map((m) => m.candidate.url)).toEqual(["https://a.org/same"]);
    expect(r.llmChecks.map((c) => c.candidate.url)).toEqual(["https://a.org/reworded"]);
    expect(r.llmChecks[0]!.matches[0]!.ref.id).toBe("AIR-2026-0003");
    expect(r.fresh.map((c) => c.url)).toEqual(["https://a.org/other"]);
  });

  it("never merges records that carry different CVE ids", () => {
    const inc = incident({ id: "AIR-2026-0004", title: "Critical vLLM flaw allows remote code execution", tags: ["CVE-2026-10001"] });
    const c = cand({ title: "Critical vLLM flaw allows remote code execution", url: "https://a.org/cve2", cve_ids: ["CVE-2026-20002"] });
    const r = dedupe([c], state({ incidents: [inc] }), settings);
    expect(r.merges).toHaveLength(0);
    expect(r.fresh).toHaveLength(1);
  });

  it("ignores records outside the lookback window", () => {
    const old = incident({ id: "AIR-2025-0001", title: "Deepfake video call defrauds Arup of $25 million", first_reported: "2025-01-01" });
    const c = cand({ title: "Deepfake video call defrauds Arup of $25 million", url: "https://a.org/late" });
    const r = dedupe([c], state({ incidents: [old] }), settings);
    expect(r.fresh).toHaveLength(1);
  });

  it("clusters near-identical candidates and sends reworded same-run pairs to the LLM", () => {
    const a = cand({ title: "Critical vLLM vulnerability lets attackers execute code remotely", url: "https://a.org/1", published_at: "2026-10-10" });
    const copy = cand({ title: "Critical vLLM vulnerability lets attackers execute code remotely | SecurityWeek", url: "https://d.org/4", published_at: "2026-10-10" });
    const b = cand({ title: "Critical vulnerability in vLLM allows remote code execution", url: "https://b.org/2", published_at: "2026-10-11" });
    const c = cand({ title: "Voice clone scam hits regional bank", url: "https://c.org/3", published_at: "2026-10-11" });
    const clusters = clusterCandidates([a, copy, b, c], settings);
    expect(clusters).toHaveLength(3);
    expect(clusters[0]!.members).toHaveLength(2);
    const checks = pairwiseClusterChecks(clusters, settings);
    expect([...checks.keys()]).toEqual([1]);
    expect(checks.get(1)!.matches[0]!.ref.id).toBe("NEW-0");
  });
});

describe("decide", () => {
  const base: ClassificationItem = {
    index: 0,
    in_scope: true,
    scope_reason: "attack on an AI product",
    type: "attack_on_ai",
    categories: ["prompt_injection"],
    severity: 3,
    targets: ["OpenAI"],
    products: ["ChatGPT"],
    incident_date: "2026-10-01",
    incident_date_precision: "day",
    title: "Prompt injection in ChatGPT connectors leaks files",
    summary: "A prompt injection exfiltrated files through a connector. OpenAI patched it.",
    tags: ["prompt-injection"],
    confidence: 0.9,
  };
  it("follows the threshold matrix", () => {
    expect(decide(base, settings).status).toBe("published");
    expect(decide({ ...base, confidence: 0.7 }, settings).status).toBe("review");
    expect(decide({ ...base, in_scope: false, confidence: 0.95 }, settings).status).toBe("rejected");
    expect(decide({ ...base, in_scope: false, confidence: 0.5 }, settings).status).toBe("review");
    expect(decide({ ...base, severity: 4 }, { ...settings, review_severity_4: true }).status).toBe("review");
  });
  it("builds a valid incident from a cluster and merges extra sources", () => {
    const a = cand({ title: "A", url: "https://a.org/1", published_at: "2026-10-03", publisher: "A" });
    const b = cand({ title: "B", url: "https://b.org/2", published_at: "2026-10-02", publisher: "B", cve_ids: ["CVE-2026-12345"] });
    const inc = buildIncident({ primary: a, members: [a, b] }, { ...base, incident_date: "2026-10-05" }, "published", "AIR-2026-0009", "slug", "2026-10-10T00:00:00.000Z");
    expect(inc.first_reported).toBe("2026-10-02");
    expect(inc.incident_date).toBe("2026-10-02"); // clamped: cannot be after first report
    expect(inc.source_count).toBe(2);
    expect(inc.tags).toContain("CVE-2026-12345");
    const extra = cand({ title: "C", url: "https://c.org/3", published_at: "2026-10-01", publisher: "C" });
    expect(mergeSource(inc, extra, "2026-10-11T00:00:00.000Z")).toBe(true);
    expect(mergeSource(inc, extra, "2026-10-11T00:00:00.000Z")).toBe(false);
    expect(inc.source_count).toBe(3);
    expect(inc.first_reported).toBe("2026-10-01");
  });
});

describe("llm output parsing", () => {
  it("accepts fenced json and validates the batch schema", () => {
    const text = '```json\n{"results":[{"index":0,"in_scope":false,"scope_reason":"product launch","type":"attack_on_ai","categories":["other"],"severity":1,"targets":["n/a"],"products":[],"incident_date":"2026","incident_date_precision":"year","title":"Vendor launches AI product","summary":"A vendor launched a product. It is not an incident.","tags":[],"confidence":0.9}]}\n```';
    const parsed = ClassificationBatchSchema.parse(extractJson(text));
    expect(parsed.results[0]!.in_scope).toBe(false);
  });
  it("rejects unknown enum values", () => {
    const bad = { results: [{ index: 0, in_scope: true, scope_reason: "", type: "attack_on_ai", categories: ["bias"], severity: 3, targets: ["OpenAI"], products: [], incident_date: "2026-01-01", incident_date_precision: "day", title: "Some title here", summary: "Twenty characters at least here.", tags: [], confidence: 0.8 }] };
    expect(ClassificationBatchSchema.safeParse(bad).success).toBe(false);
  });
});

describe("robots.txt", () => {
  const txt = `User-agent: *\nDisallow: /private/\nAllow: /private/ok\n\nUser-agent: ClaudeBot\nDisallow: /\n`;
  it("applies longest-match with allow winning ties and star fallback", () => {
    const g = parseRobots(txt);
    expect(robotsAllows(g, "gcd-ai-radar", "/news/a")).toBe(true);
    expect(robotsAllows(g, "gcd-ai-radar", "/private/x")).toBe(false);
    expect(robotsAllows(g, "gcd-ai-radar", "/private/ok/y")).toBe(true);
    expect(robotsAllows(g, "ClaudeBot", "/news/a")).toBe(false);
  });
  it("treats a default-deny file as disallowed", () => {
    const g = parseRobots("User-agent: *\nDisallow: /\n");
    expect(robotsAllows(g, "gcd-ai-radar", "/anything")).toBe(false);
  });
});
