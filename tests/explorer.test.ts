import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, totalOfKind, yearsNeeded, type ExplorerFacets, type ExplorerFilters } from "@/lib/explorer";

const facets: ExplorerFacets = {
  years: [
    { year: 2026, records: 1143, incidents: 150, disclosed: 993, min: { incident_date: "2019-06", first_reported: "2026-01" }, max: { incident_date: "2026-10", first_reported: "2026-10" } },
    { year: 2025, records: 442, incidents: 180, disclosed: 262, min: { incident_date: "2022-03", first_reported: "2025-01" }, max: { incident_date: "2026-01", first_reported: "2025-12" } },
    { year: 2024, records: 228, incidents: 60, disclosed: 168, min: { incident_date: "2024-01", first_reported: "2024-01" }, max: { incident_date: "2025-01", first_reported: "2024-12" } },
    { year: 2023, records: 63, incidents: 12, disclosed: 51, min: { incident_date: "2018-04", first_reported: "2023-01" }, max: { incident_date: "2023-12", first_reported: "2023-12" } },
  ],
  publishers: [["NVD", 1200], ["GitHub Advisory Database", 900]],
};

const f = (patch: Partial<ExplorerFilters>): ExplorerFilters => ({ ...EMPTY_FILTERS, ...patch });

describe("yearsNeeded", () => {
  it("fills the default list from the newest years only", () => {
    expect(yearsNeeded(f({}), facets, null, 50)).toEqual({ years: [2026], reason: "newest" });
    expect(yearsNeeded(f({}), facets, null, 200)).toEqual({ years: [2026, 2025], reason: "newest" });
    expect(yearsNeeded(f({ kind: "disclosed" }), facets, null, 200)).toEqual({ years: [2026], reason: "newest" });
    expect(yearsNeeded(f({ kind: "all" }), facets, null, 1200)).toEqual({ years: [2026, 2025], reason: "newest" });
    expect(yearsNeeded(f({}), facets, null, 10000)).toEqual({ years: [2026, 2025, 2024, 2023], reason: "newest" });
  });

  it("picks the shards whose dates reach a month, a range or a year", () => {
    expect(yearsNeeded(f({ month: "2025-06" }), facets, null, 50)).toEqual({ years: [2026, 2025], reason: "dates" });
    expect(yearsNeeded(f({ month: "2025-06", by: "reported" }), facets, null, 50)).toEqual({ years: [2025], reason: "dates" });
    expect(yearsNeeded(f({ from: "2024-11", to: "2024-12", by: "reported" }), facets, null, 50)).toEqual({ years: [2024], reason: "dates" });
    expect(yearsNeeded(f({ from: "2026-02" }), facets, null, 50)).toEqual({ years: [2026], reason: "dates" });
    // a year filter matches either date: 2024 by first report, plus shards whose incident dates reach into 2024
    expect(yearsNeeded(f({ year: "2024" }), facets, null, 50)).toEqual({ years: [2026, 2025, 2024], reason: "dates" });
    // the 2025 shard holds incident dates back to 2022-03, so it may hold a 2023 incident reported in 2025
    expect(yearsNeeded(f({ year: "2023" }), facets, null, 50)).toEqual({ years: [2026, 2025, 2023], reason: "dates" });
  });

  it("needs every year for a categorical filter or a sort that is not by first report", () => {
    const all = [2026, 2025, 2024, 2023];
    expect(yearsNeeded(f({ type: "attack_on_ai" }), facets, null, 50)).toEqual({ years: all, reason: "all" });
    expect(yearsNeeded(f({ real: "1" }), facets, null, 50)).toEqual({ years: all, reason: "all" });
    expect(yearsNeeded(f({ product: "vLLM" }), facets, null, 50)).toEqual({ years: all, reason: "all" });
    expect(yearsNeeded(f({ sort: "severity" }), facets, null, 50)).toEqual({ years: all, reason: "all" });
    // unless dates bound it first
    expect(yearsNeeded(f({ type: "attack_on_ai", month: "2024-05", by: "reported" }), facets, null, 50)).toEqual({ years: [2024], reason: "dates" });
  });

  it("waits for the search index, then follows the hits", () => {
    expect(yearsNeeded(f({ q: "vllm" }), facets, null, 50)).toEqual({ years: [], reason: "index" });
    expect(yearsNeeded(f({ q: "vllm", month: "2025-06", by: "reported" }), facets, null, 50)).toEqual({ years: [2025], reason: "index" });
    expect(yearsNeeded(f({ q: "vllm" }), facets, [2025, 2023], 50)).toEqual({ years: [2025, 2023], reason: "search" });
    expect(yearsNeeded(f({ q: "vllm", year: "2023" }), facets, [2025, 2023], 50)).toEqual({ years: [2025, 2023], reason: "search" });
    expect(yearsNeeded(f({ q: "vllm", year: "2024" }), facets, [2023], 50)).toEqual({ years: [], reason: "search" });
    expect(yearsNeeded(f({ q: "zzz" }), facets, [], 50)).toEqual({ years: [], reason: "search" });
  });

  it("counts records of a kind", () => {
    expect(totalOfKind(facets, "")).toBe(402);
    expect(totalOfKind(facets, "disclosed")).toBe(1474);
    expect(totalOfKind(facets, "all")).toBe(1876);
  });
});
