import type { ClassificationItem } from "@/collector/llm/schemas";
import type { Candidate } from "@/collector/sources/types";

/** A complete classifier result, every field present, for tests that build records or exercise decide(). */
export function classification(overrides: Partial<ClassificationItem> = {}): ClassificationItem {
  return {
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
    lane: "patch",
    newsworthy: true,
    newsworthy_reason: "exploitation confirmed against a named product",
    patch_status: "patched",
    affected: [],
    fixed_in: [],
    action: "",
    severity_note: "",
    cvss: 0,
    ...overrides,
  };
}

/** A news candidate with a stable key derived from its URL. */
export function candidate(partial: Partial<Candidate> & { title: string; url: string }): Candidate {
  return {
    key: partial.url.replace(/[^a-z0-9]/gi, "").slice(-16).padStart(16, "0"),
    source_id: "thn",
    origin: "news",
    published_at: "2026-10-20",
    publisher: "The Hacker News",
    hint: "",
    cve_ids: [],
    discovered_at: "2026-10-20T00:00:00.000Z",
    ...partial,
  };
}
