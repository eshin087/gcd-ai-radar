import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IncidentSchema, IncidentsFileSchema } from "@/lib/schema";

const valid = {
  id: "AIR-2026-0042",
  slug: "prompt-injection-in-example-assistant",
  title: "Prompt injection in Example Assistant leaks calendar data",
  summary: "Attacker text in a shared document steered the assistant into exfiltrating data. The vendor patched the flow after disclosure.",
  type: "attack_on_ai",
  categories: ["prompt_injection", "data_leak"],
  severity: 3,
  targets: ["enterprise_deployment"],
  products: ["Example Assistant"],
  incident_date: "2026-03-04",
  incident_date_precision: "day",
  first_reported: "2026-03-05",
  sources: [
    { url: "https://example.org/report", publisher: "Example News", title: "Report", published_at: "2026-03-05" },
  ],
  source_count: 1,
  confidence: 0.91,
  status: "published",
  origin: "news",
  tags: ["mcp"],
  created_at: "2026-03-05T06:17:00.000Z",
  updated_at: "2026-03-05T06:17:00.000Z",
};

describe("IncidentSchema", () => {
  it("accepts a valid incident", () => {
    expect(IncidentSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a source_count that disagrees with sources", () => {
    expect(IncidentSchema.safeParse({ ...valid, source_count: 2 }).success).toBe(false);
  });
  it("rejects an incident_date that disagrees with its precision", () => {
    expect(IncidentSchema.safeParse({ ...valid, incident_date: "2026-03" }).success).toBe(false);
    expect(IncidentSchema.safeParse({ ...valid, incident_date: "2026-03", incident_date_precision: "month" }).success).toBe(true);
  });
  it("rejects unknown categories, bad ids and non-https sources", () => {
    expect(IncidentSchema.safeParse({ ...valid, categories: ["bias"] }).success).toBe(false);
    expect(IncidentSchema.safeParse({ ...valid, id: "AIR-26-1" }).success).toBe(false);
    expect(IncidentSchema.safeParse({ ...valid, sources: [{ ...valid.sources[0], url: "not a url" }] }).success).toBe(false);
  });
  it("requires at least one category, target and source", () => {
    expect(IncidentSchema.safeParse({ ...valid, categories: [] }).success).toBe(false);
    expect(IncidentSchema.safeParse({ ...valid, targets: [] }).success).toBe(false);
    expect(IncidentSchema.safeParse({ ...valid, sources: [], source_count: 0 }).success).toBe(false);
  });
});

describe("data files", () => {
  it("live incidents file validates and has unique ids and slugs", () => {
    const raw = JSON.parse(readFileSync(new URL("../data/incidents.json", import.meta.url), "utf8"));
    const parsed = IncidentsFileSchema.parse(raw);
    expect(new Set(parsed.map((i) => i.id)).size).toBe(parsed.length);
    expect(new Set(parsed.map((i) => i.slug)).size).toBe(parsed.length);
  });
});
