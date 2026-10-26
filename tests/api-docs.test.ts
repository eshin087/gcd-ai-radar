import { describe, expect, it } from "vitest";
import { ROW_FIELDS, SLIM_NOTES, SUMMARY_FIELDS, incidentFields, slimFields } from "@/lib/api-docs";
import { compactRow } from "@/lib/rows";
import { slim } from "@/lib/slim";
import { buildSummary } from "@/lib/summary";
import { incident } from "./fixtures";

/**
 * The API page promises field lists. The typecheck already fails when a typed
 * field goes undocumented; these tests check the documented keys against what
 * the code really writes, which a type alone cannot.
 */

const record = incident({
  id: "AIR-2026-0042",
  slug: "prompt-injection-in-example-assistant",
  title: "Prompt injection in Example Assistant leaks calendar data",
  categories: ["prompt_injection", "data_leak"],
  incident_date: "2026-03-04",
  first_reported: "2026-03-05",
  confidence: 0.91,
  tags: ["mcp"],
});

describe("API field documentation", () => {
  it("documents every field of a full record, with types from the schema", () => {
    const docs = incidentFields();
    const top = docs.filter((f) => !f.name.includes("."));
    expect(top.map((f) => f.name).sort()).toEqual(Object.keys(record).sort());
    expect(docs.find((f) => f.name === "severity")?.type).toBe("1 | 2 | 3 | 4");
    expect(docs.find((f) => f.name === "first_reported")?.type).toBe("string (YYYY-MM-DD)");
    expect(docs.find((f) => f.name === "categories")?.values).toContain("prompt_injection");
    expect(docs.filter((f) => f.name.startsWith("sources[]."))).toHaveLength(4);
    expect(docs.filter((f) => f.name.startsWith("timeline[]."))).toHaveLength(4);
    expect(docs.find((f) => f.name === "lane")?.values).toContain("research");
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
