import { describe, expect, it } from "vitest";
import { ROW_FIELDS, SLIM_NOTES, SUMMARY_FIELDS, incidentFields, slimFields } from "@/lib/api-docs";
import { compactRow } from "@/lib/rows";
import type { Incident } from "@/lib/schema";
import { slim } from "@/lib/slim";
import { buildSummary } from "@/lib/summary";

/**
 * The API page promises field lists. The typecheck already fails when a typed
 * field goes undocumented; these tests check the documented keys against what
 * the code really writes, which a type alone cannot.
 */

const record: Incident = {
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
  sources: [{ url: "https://example.org/report", publisher: "Example News", title: "Report", published_at: "2026-03-05" }],
  source_count: 1,
  confidence: 0.91,
  status: "published",
  origin: "news",
  tags: ["mcp"],
  created_at: "2026-03-05T06:17:00.000Z",
  updated_at: "2026-03-05T06:17:00.000Z",
};

describe("API field documentation", () => {
  it("documents every field of a full record, with types from the schema", () => {
    const docs = incidentFields();
    const top = docs.filter((f) => !f.name.includes("."));
    expect(top.map((f) => f.name).sort()).toEqual(Object.keys(record).sort());
    expect(docs.find((f) => f.name === "severity")?.type).toBe("1 | 2 | 3 | 4");
    expect(docs.find((f) => f.name === "first_reported")?.type).toBe("string (YYYY-MM-DD)");
    expect(docs.find((f) => f.name === "categories")?.values).toContain("prompt_injection");
    expect(docs.filter((f) => f.name.startsWith("sources[]."))).toHaveLength(4);
  });

  it("documents exactly the keys slim() writes", () => {
    expect(Object.keys(SLIM_NOTES).sort()).toEqual(Object.keys(slim(record)).sort());
    expect(slimFields().find((f) => f.name === "disclosed")?.type).toBe("boolean");
  });

  it("lists exactly the keys compactRow() writes", () => {
    expect([...ROW_FIELDS].sort()).toEqual(Object.keys(compactRow(record)).sort());
  });

  it("documents exactly the keys summary.json has", () => {
    const s = buildSummary([record], { now: new Date("2026-10-18T12:00:00Z"), site: "https://example.test", lastUpdated: null });
    expect(Object.keys(SUMMARY_FIELDS).sort()).toEqual(Object.keys(s).sort());
  });
});
