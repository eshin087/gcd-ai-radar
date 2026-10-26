import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, explorerFacets, filtersQuery, laneCount, matchesRecord, parseFilters, totalOfKind, yearsNeeded, type ExplorerFacets, type ExplorerFilters } from "@/lib/explorer";
import { slim } from "@/lib/slim";
import { disclosedCve, incident } from "./fixtures";

const lane = { records: 0, incidents: 0, disclosed: 0, live: 0 };
const facets: ExplorerFacets = {
  years: [
    { year: 2026, records: 1143, incidents: 150, disclosed: 993, min: { incident_date: "2019-06", first_reported: "2026-01" }, max: { incident_date: "2026-10", first_reported: "2026-10" } },
    { year: 2025, records: 442, incidents: 180, disclosed: 262, min: { incident_date: "2022-03", first_reported: "2025-01" }, max: { incident_date: "2026-01", first_reported: "2025-12" } },
    { year: 2024, records: 228, incidents: 60, disclosed: 168, min: { incident_date: "2024-01", first_reported: "2024-01" }, max: { incident_date: "2025-01", first_reported: "2024-12" } },
    { year: 2023, records: 63, incidents: 12, disclosed: 51, min: { incident_date: "2018-04", first_reported: "2023-01" }, max: { incident_date: "2023-12", first_reported: "2023-12" } },
  ],
  publishers: [["NVD", 1200], ["GitHub Advisory Database", 900]],
  lanes: { patch: lane, breach: lane, supply_chain: lane, research: lane },
  live: 0,
};

const f = (patch: Partial<ExplorerFilters>): ExplorerFilters => ({ ...EMPTY_FILTERS, ...patch });

describe("parseFilters and filtersQuery", () => {
  it("round-trip every filter and drop the default sort", () => {
    const filters = f({ q: "vllm", lane: "breach", state: "live", tag: "rce", day: "2026-10-20", patch: "unpatched,partial", type: "ai", severity: "4", year: "2026", by: "reported", kind: "all", sort: "severity" });
    const qs = filtersQuery(filters);
    expect(parseFilters(`?${qs}`)).toEqual(filters);
    expect(filtersQuery(f({}))).toBe("");
    expect(filtersQuery(f({ sort: "reported", lane: "patch" }))).toBe("lane=patch");
  });

  it("ignore values outside the vocabularies and normalise tags", () => {
    const p = parseFilters("?lane=nope&state=open&tag=Path_Traversal&day=2026-13&patch=patched,bogus&type=robot&severity=9&owasp=LLM99&kind=some");
    expect(p).toEqual(f({ tag: "path-traversal", patch: "patched" }));
    expect(parseFilters("?type=not_ai").type).toBe("not_ai");
    expect(parseFilters("?tag=CVE-2026-1").tag).toBe("");
  });
});

describe("matchesRecord", () => {
  const live = slim(incident({ lane: "breach", state: "live", tags: ["rce", "cisa-kev"], first_reported: "2026-10-20", incident_date: "2026-10-18", severity: 4, patch_status: "no_fix_needed" }));
  const closed = slim(incident({ lane: "patch", state: "closed", closed_at: "2026-09-20", tags: ["ssrf"], first_reported: "2026-09-01", incident_date: "2026-09-01", patch_status: "patched" }));
  const general = slim(incident({ type: "not_ai", categories: ["general"], lane: "patch", state: "live", patch_status: "unpatched", first_reported: "2026-10-21", incident_date: "2026-10-21" }));
  const cve = slim(disclosedCve({ first_reported: "2026-10-05" }));

  it("filters by lane, state, tag, fix status and the AI lens", () => {
    expect([live, closed, general].filter((i) => matchesRecord(i, f({ lane: "breach" }))).map((i) => i.id)).toEqual([live.id]);
    expect([live, closed, general].filter((i) => matchesRecord(i, f({ state: "live" }))).map((i) => i.id)).toEqual([live.id, general.id]);
    expect([live, closed, general].filter((i) => matchesRecord(i, f({ tag: "ssrf" }))).map((i) => i.id)).toEqual([closed.id]);
    expect([live, closed, general].filter((i) => matchesRecord(i, f({ patch: "unpatched,partial" }))).map((i) => i.id)).toEqual([general.id]);
    expect([live, closed, general].filter((i) => matchesRecord(i, f({ type: "ai" }))).map((i) => i.id)).toEqual([live.id, closed.id]);
    expect([live, closed, general].filter((i) => matchesRecord(i, f({ type: "not_ai" }))).map((i) => i.id)).toEqual([general.id]);
  });

  it("matches a day on the chosen date field and keeps disclosed CVEs behind the records kind", () => {
    expect(matchesRecord(live, f({ day: "2026-10-18" }))).toBe(true);
    expect(matchesRecord(live, f({ day: "2026-10-20" }))).toBe(false);
    expect(matchesRecord(live, f({ day: "2026-10-20", by: "reported" }))).toBe(true);
    expect(matchesRecord(cve, f({}))).toBe(false);
    expect(matchesRecord(cve, f({ kind: "disclosed" }))).toBe(true);
    expect(matchesRecord(cve, f({ kind: "all" }))).toBe(true);
    expect(matchesRecord(live, f({ kind: "disclosed" }))).toBe(false);
  });
});

describe("explorerFacets", () => {
  it("counts records, incidents, disclosed CVEs and live records per lane", () => {
    const records = [
      incident({ lane: "breach", state: "live" }),
      incident({ lane: "patch", state: "closed", closed_at: "2026-10-01" }),
      disclosedCve({ lane: "patch" }),
      incident({ lane: "research", state: "live", severity: 1 }),
    ];
    const facets = explorerFacets(records);
    expect(facets.lanes.breach).toEqual({ records: 1, incidents: 1, disclosed: 0, live: 1 });
    expect(facets.lanes.patch).toEqual({ records: 2, incidents: 1, disclosed: 1, live: 0 });
    expect(facets.lanes.research).toEqual({ records: 1, incidents: 1, disclosed: 0, live: 1 });
    expect(facets.live).toBe(2);
    expect(laneCount(facets.lanes.patch, "")).toBe(1);
    expect(laneCount(facets.lanes.patch, "disclosed")).toBe(1);
    expect(laneCount(facets.lanes.patch, "all")).toBe(2);
  });
});

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
    expect(yearsNeeded(f({ day: "2025-06-15" }), facets, null, 50)).toEqual({ years: [2026, 2025], reason: "dates" });
    expect(yearsNeeded(f({ day: "2025-06-15", by: "reported" }), facets, null, 50)).toEqual({ years: [2025], reason: "dates" });
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
