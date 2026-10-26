import { describe, expect, it } from "vitest";
import {
  briefingNumbers,
  busiestFamily,
  delta,
  isoWeekOf,
  isoWeekRange,
  parseIsoWeek,
  previousIsoWeek,
  rankNotable,
  shiftIsoWeek,
  topTargets,
  weekRecords,
  weeksInYear,
} from "@/lib/briefing";
import { BriefingNumbersSchema, type Incident } from "@/lib/schema";
import { comparisonPhrase } from "@/collector/llm/prompts";
import { allowedNumbers, narrativeProblems, standaloneNumbers } from "@/collector/lib/narrative";
import { targetWeeks } from "@/collector/briefing";

let seq = 0;
function inc(partial: Partial<Incident> & { first_reported: string }): Incident {
  seq += 1;
  return {
    id: `AIR-2026-${String(seq).padStart(4, "0")}`,
    slug: `incident-${seq}`,
    title: "Test incident title",
    summary: "A sufficiently long summary sentence. And a second sentence.",
    type: "attack_on_ai",
    categories: ["prompt_injection"],
    severity: 3,
    targets: ["OpenAI"],
    products: [],
    incident_date: partial.first_reported,
    incident_date_precision: "day",
    sources: [{ url: "https://example.org/a", publisher: "Example", title: "t", published_at: partial.first_reported }],
    source_count: 1,
    confidence: 0.9,
    status: "published",
    origin: "news",
    tags: [],
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...partial,
  };
}

/** An unexploited NVD record: a disclosed vulnerability, never an incident. */
function cve(first_reported: string): Incident {
  return inc({
    first_reported,
    severity: 2,
    origin: "seed_nvd",
    categories: ["infra_vuln"],
    targets: ["framework_or_tooling"],
    sources: [{ url: "https://nvd.nist.gov/vuln/detail/CVE-2026-1", publisher: "NVD", title: "CVE", published_at: first_reported }],
  });
}

describe("ISO weeks", () => {
  it("numbers weeks by ISO 8601, including year boundaries", () => {
    expect(isoWeekOf("2026-10-12")).toBe("2026-W42"); // Monday
    expect(isoWeekOf("2026-10-18")).toBe("2026-W42"); // Sunday
    expect(isoWeekOf("2026-10-19")).toBe("2026-W43");
    expect(isoWeekOf("2024-12-30")).toBe("2025-W01"); // Monday in December, ISO year 2025
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53"); // Friday in January, ISO year 2026
    expect(isoWeekOf("2021-01-03")).toBe("2020-W53");
  });

  it("knows which years have 53 weeks", () => {
    expect(weeksInYear(2026)).toBe(53);
    expect(weeksInYear(2025)).toBe(52);
    expect(weeksInYear(2020)).toBe(53);
  });

  it("parses keys and refuses weeks that do not exist", () => {
    expect(parseIsoWeek("2026-W42")).toEqual({ year: 2026, week: 42 });
    expect(parseIsoWeek("2026-W53")).toEqual({ year: 2026, week: 53 });
    expect(parseIsoWeek("2025-W53")).toBeNull();
    expect(parseIsoWeek("2026-W00")).toBeNull();
    expect(parseIsoWeek("2026-42")).toBeNull();
    expect(() => isoWeekRange("2025-W53")).toThrow(/not an ISO week/);
  });

  it("gives Monday to Sunday ranges", () => {
    expect(isoWeekRange("2026-W42")).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(isoWeekRange("2025-W01")).toEqual({ start: "2024-12-30", end: "2025-01-05" });
    expect(isoWeekRange("2026-W53")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });

  it("shifts across year boundaries", () => {
    expect(shiftIsoWeek("2026-W42", -1)).toBe("2026-W41");
    expect(shiftIsoWeek("2027-W01", -1)).toBe("2026-W53");
    expect(shiftIsoWeek("2025-W52", 1)).toBe("2026-W01");
    expect(shiftIsoWeek("2026-W42", -7)).toBe("2026-W35");
  });

  it("picks the week that ended on Sunday when run on Monday morning", () => {
    expect(previousIsoWeek(new Date("2026-10-19T06:17:00Z"))).toBe("2026-W42");
    // Late on Sunday the current week has not ended: it still briefs the one before.
    expect(previousIsoWeek(new Date("2026-10-18T23:59:00Z"))).toBe("2026-W41");
    expect(previousIsoWeek(new Date("2027-01-04T06:17:00Z"))).toBe("2026-W53");
  });

  it("lists the backfill weeks oldest first", () => {
    expect(targetWeeks({ week: "2026-W42", weeks: 3 }, new Date())).toEqual(["2026-W40", "2026-W41", "2026-W42"]);
    expect(targetWeeks({}, new Date("2026-10-19T06:17:00Z"))).toEqual(["2026-W42"]);
    expect(() => targetWeeks({ week: "2026-42" }, new Date())).toThrow(/not an ISO week/);
  });
});

describe("week selection", () => {
  const records = [
    inc({ first_reported: "2026-10-11" }), // Sunday of W41
    inc({ first_reported: "2026-10-12" }), // Monday of W42
    inc({ first_reported: "2026-10-18" }), // Sunday of W42
    inc({ first_reported: "2026-10-19" }), // Monday of W43
  ];
  it("includes both ends of the week and nothing outside it", () => {
    expect(weekRecords(records, "2026-W42").map((r) => r.first_reported)).toEqual(["2026-10-12", "2026-10-18"]);
    expect(weekRecords(records, "2026-W41")).toHaveLength(1);
    expect(weekRecords(records, "2026-W40")).toHaveLength(0);
  });
});

describe("delta arithmetic", () => {
  it("computes change and percentage, with null for a new count", () => {
    expect(delta(12, 1)).toEqual({ now: 12, before: 1, change: 11, pct: 1100 });
    expect(delta(1, 2)).toEqual({ now: 1, before: 2, change: -1, pct: -50 });
    expect(delta(3, 3)).toEqual({ now: 3, before: 3, change: 0, pct: 0 });
    expect(delta(4, 0)).toEqual({ now: 4, before: 0, change: 4, pct: null });
    expect(delta(0, 0)).toEqual({ now: 0, before: 0, change: 0, pct: 0 });
  });

  it("words the comparison the model is told to use", () => {
    expect(comparisonPhrase(delta(12, 1))).toBe("up 11 from 1");
    expect(comparisonPhrase(delta(1, 2))).toBe("down 1 from 2");
    expect(comparisonPhrase(delta(2, 2))).toBe("unchanged at 2");
  });
});

describe("briefingNumbers", () => {
  const records = [
    // W41: 2 incidents (1 real-world), 1 disclosed CVE
    inc({ first_reported: "2026-10-06", severity: 3 }),
    inc({ first_reported: "2026-10-07", severity: 1 }),
    cve("2026-10-08"),
    // W42: 4 incidents (3 real-world), 2 disclosed CVEs
    inc({ first_reported: "2026-10-12", severity: 4, source_count: 1, title: "Loss with one source", categories: ["deepfake_fraud"], type: "ai_enabled_attack", targets: ["individual_victims"] }),
    inc({
      first_reported: "2026-10-13",
      severity: 4,
      title: "Loss with three sources",
      categories: ["deepfake_fraud"],
      type: "ai_enabled_attack",
      targets: ["individual_victims", "n/a"],
      sources: ["a", "b", "c"].map((s) => ({ url: `https://example.org/${s}`, publisher: s, title: s, published_at: "2026-10-13" })),
      source_count: 3,
    }),
    inc({ first_reported: "2026-10-14", severity: 3, title: "Exploited agent", categories: ["agent_hijack"], targets: ["OpenAI", "enterprise_deployment"] }),
    inc({ first_reported: "2026-10-15", severity: 1, title: "Research only", targets: ["OpenAI"] }),
    cve("2026-10-16"),
    cve("2026-10-17"),
    // W43: outside
    inc({ first_reported: "2026-10-19", severity: 4 }),
  ];
  const n = briefingNumbers(records, "2026-W42");

  it("keeps disclosed CVEs out of the incident counts and reports them on their own line", () => {
    expect(n.counts).toMatchObject({ records: 6, incidents: 4, real_world: 3, disclosed_vulnerabilities: 2 });
    expect(n.counts.by_type).toEqual({ attack_on_ai: 2, ai_enabled_attack: 2 });
    expect(n.counts.by_severity).toEqual({ "1": 1, "2": 0, "3": 1, "4": 2 });
    expect(n.notable.some((i) => i.category === "infra_vuln")).toBe(false);
  });

  it("keeps records with no AI role out of the week entirely", () => {
    const general = inc({ first_reported: "2026-10-14", type: "not_ai", categories: ["general"], severity: 4, title: "General breach" });
    const lensed = briefingNumbers([...records, general], "2026-W42");
    expect(lensed.counts).toEqual(n.counts);
    expect(lensed.notable).toEqual(n.notable);
    expect(lensed.deltas).toEqual(n.deltas);
    expect(() => BriefingNumbersSchema.parse(lensed)).not.toThrow();
  });

  it("compares with the week before, counted from the same records", () => {
    expect(n.previous).toEqual({ week: "2026-W41", incidents: 2, real_world: 1, disclosed_vulnerabilities: 1 });
    expect(n.deltas.incidents).toEqual({ now: 4, before: 2, change: 2, pct: 100 });
    expect(n.deltas.real_world).toEqual({ now: 3, before: 1, change: 2, pct: 200 });
    expect(n.deltas.disclosed_vulnerabilities).toEqual({ now: 2, before: 1, change: 1, pct: 100 });
  });

  it("ranks notable incidents by severity, then sources", () => {
    expect(n.notable.map((i) => i.title)).toEqual(["Loss with three sources", "Loss with one source", "Exploited agent", "Research only"]);
  });

  it("finds the busiest family and the top targets without n/a", () => {
    expect(n.busiest_family).toEqual({ family: "social", count: 2 });
    expect(n.top_targets).toEqual([
      { target: "OpenAI", count: 2 },
      { target: "individual_victims", count: 2 },
      { target: "enterprise_deployment", count: 1 },
    ]);
  });

  it("matches the stored schema", () => {
    expect(BriefingNumbersSchema.safeParse(n).success).toBe(true);
  });

  it("handles an empty week", () => {
    const empty = briefingNumbers(records, "2026-W30");
    expect(empty.counts.incidents).toBe(0);
    expect(empty.busiest_family).toBeNull();
    expect(empty.top_targets).toEqual([]);
    expect(empty.notable).toEqual([]);
    expect(BriefingNumbersSchema.safeParse(empty).success).toBe(true);
  });
});

describe("ranking helpers", () => {
  it("breaks ties by recency, then id, so the order is reproducible", () => {
    const a = inc({ first_reported: "2026-10-12", id: "AIR-2026-0900" });
    const b = inc({ first_reported: "2026-10-14", id: "AIR-2026-0901" });
    const c = inc({ first_reported: "2026-10-14", id: "AIR-2026-0899" });
    expect(rankNotable([a, b, c]).map((i) => i.id)).toEqual(["AIR-2026-0899", "AIR-2026-0901", "AIR-2026-0900"]);
  });
  it("gives a family tie to the earlier family", () => {
    expect(busiestFamily([{ categories: ["agent_hijack"] }, { categories: ["jailbreak"] }])).toEqual({ family: "injection", count: 1 });
  });
  it("counts a target once per incident", () => {
    expect(topTargets([{ targets: ["OpenAI", "OpenAI"] }])).toEqual([{ target: "OpenAI", count: 1 }]);
  });
});

describe("narrative checks", () => {
  const records = [inc({ first_reported: "2026-10-13", summary: "A victim lost £250,000 to a deepfake scam. Police were informed." }), cve("2026-10-14")];
  const numbers = briefingNumbers(records, "2026-W42");
  const allowed = allowedNumbers(numbers, records);
  const filler = "Words fill the narrative to a sensible length so that the length check is satisfied here. ".repeat(5);

  it("ignores identifiers and years when reading numbers", () => {
    expect(standaloneNumbers("CVE-2026-1234 in GPT-4o and v0.6.3 on 2026-10-12, in 2026, hit 12 firms and 1,500 users")).toEqual([12, 1500]);
  });

  it("accepts numbers from the counts and the records", () => {
    expect(narrativeProblems(`The week had 1 incident and 1 disclosed vulnerability; a victim lost £250,000. ${filler}`, allowed, numbers)).toEqual([]);
  });

  it("rejects a number that is not in the data", () => {
    expect(narrativeProblems(`The week had 17 incidents. ${filler}`, allowed, numbers).join()).toMatch(/not in the data: 17/);
  });

  it("rejects calling a count unchanged when every count changed", () => {
    expect(narrativeProblems(`Real-world incidents were unchanged. ${filler}`, allowed, numbers).join()).toMatch(/stayed the same/);
  });

  it("allows unchanged when a count did not change", () => {
    const flat = briefingNumbers([inc({ first_reported: "2026-10-06" }), inc({ first_reported: "2026-10-13" })], "2026-W42");
    expect(narrativeProblems(`Incidents were unchanged at 1. ${filler}`, allowedNumbers(flat, []), flat)).toEqual([]);
  });

  it("rejects a narrative that names the site", () => {
    expect(narrativeProblems(`During the week, gcd AI Radar recorded 1 incident. ${filler}`, allowed, numbers).join()).toMatch(/names the site/);
    expect(narrativeProblems(`During the week, GCD RADAR recorded 1 incident. ${filler}`, allowed, numbers).join()).toMatch(/names the site/);
    expect(narrativeProblems(`The observatory recorded 1 incident. ${filler}`, allowed, numbers).join()).toMatch(/names the site/);
  });

  it("rejects wrong plurals, links, markdown and texts that are too short", () => {
    expect(narrativeProblems(`There were 1 incidents. ${filler}`, allowed, numbers).join()).toMatch(/should be singular/);
    expect(narrativeProblems(`See https://example.org for more. ${filler}`, allowed, numbers).join()).toMatch(/link/);
    expect(narrativeProblems(`**Bold** text. ${filler}`, allowed, numbers).join()).toMatch(/markdown/);
    expect(narrativeProblems("Too short.", allowed, numbers).join()).toMatch(/at least/);
  });
});
