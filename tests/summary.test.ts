import { describe, expect, it } from "vitest";
import { isDisclosedIncident } from "@/lib/counting";
import type { Incident } from "@/lib/schema";
import { headline, isRealWorld, monthRange, monthlySeries, pctChange, shiftMonth, toMonthKey } from "@/lib/stats";
import { SUMMARY_MONTHS, buildSummary } from "@/lib/summary";

/**
 * summary.json is what widgets and newsletters carry, so its arithmetic is
 * checked number by number against lib/stats.ts, the functions the dashboard
 * uses, on fixtures that cover the awkward cases: a disclosed vulnerability
 * (never an incident), a year-only incident date (in totals, in no month), a
 * record in the prior window, and a zero baseline.
 */

const NOW = new Date("2026-10-18T12:00:00Z");

let seq = 0;
function inc(partial: Partial<Incident> & { incident_date: string }): Incident {
  seq += 1;
  const first_reported = partial.first_reported ?? (partial.incident_date.length === 10 ? partial.incident_date : `${partial.incident_date.slice(0, 4)}-12-01`);
  return {
    id: `AIR-2026-${String(seq).padStart(4, "0")}`,
    slug: `fixture-${seq}`,
    title: "Fixture incident title",
    summary: "A sufficiently long summary sentence. And a second sentence.",
    type: "attack_on_ai",
    categories: ["prompt_injection"],
    severity: 2,
    targets: ["OpenAI"],
    products: [],
    incident_date_precision: partial.incident_date.length === 10 ? "day" : partial.incident_date.length === 7 ? "month" : "year",
    first_reported,
    sources: [{ url: "https://example.org/a", publisher: "Example", title: "t", published_at: first_reported }],
    source_count: 1,
    confidence: 0.9,
    status: "published",
    origin: "news",
    tags: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const RECORDS: Incident[] = [
  inc({ incident_date: "2026-10-02" }),
  inc({ incident_date: "2026-10-09", severity: 3 }),
  inc({ incident_date: "2026-09-15", severity: 4 }),
  inc({ incident_date: "2026-08" }), // month precision: counts in its month
  inc({ incident_date: "2026-03-01", severity: 3 }),
  inc({ incident_date: "2025-12-15" }), // trailing 12 (Nov 25..Oct 26)
  inc({ incident_date: "2025-10-20" }), // prior 12
  inc({ incident_date: "2025-02-01", severity: 3 }), // prior 12
  inc({ incident_date: "2024-06-10" }), // prior 24 only
  inc({ incident_date: "2022-01-10" }), // before every window (the prior 24 start in 2022-11)
  inc({ incident_date: "2025" }), // year only: in totals, in no month
  // disclosed vulnerabilities: never incidents, their own monthly column
  inc({ incident_date: "2026-10-05", origin: "seed_nvd", sources: [{ url: "https://nvd.nist.gov/x", publisher: "NVD", title: "CVE", published_at: "2026-10-05" }] }),
  inc({ incident_date: "2026-09-05", origin: "seed_ghsa", sources: [{ url: "https://github.com/advisories/x", publisher: "GitHub Advisory Database", title: "GHSA", published_at: "2026-09-05" }] }),
];

const OPTS = { now: NOW, site: "https://example.test", lastUpdated: "2026-10-18T06:00:00.000Z" };

describe("buildSummary", () => {
  const s = buildSummary(RECORDS, OPTS);
  const counted = RECORDS.filter((r) => !isDisclosedIncident(r));
  const real = counted.filter(isRealWorld);
  const h = headline(counted, { now: NOW });
  const month = toMonthKey(NOW);

  it("keeps disclosed vulnerabilities out of every incident number", () => {
    expect(s.totals.records).toBe(RECORDS.length);
    expect(s.totals.incidents).toBe(counted.length);
    expect(s.totals.disclosed_vulnerabilities).toBe(2);
    expect(s.totals.incidents + s.totals.disclosed_vulnerabilities).toBe(s.totals.records);
    expect(s.totals.real_world).toBe(real.length);
    expect(s.totals.real_world).toBe(h.realWorld);
    expect(s.monthly.find((m) => m.month === "2026-10")?.disclosed_vulnerabilities).toBe(1);
    expect(s.monthly.find((m) => m.month === "2026-09")?.disclosed_vulnerabilities).toBe(1);
  });

  it("matches headline() for this month, year to date and the trailing 12 months", () => {
    const tenth = (p: number | null) => (p === null ? null : Math.round(p * 10) / 10);
    expect(s.this_month).toEqual({ month: h.thisMonthKey, incidents: h.thisMonth, last_month: h.lastMonth, delta_pct: tenth(h.monthDeltaPct) });
    expect(s.this_month.incidents).toBe(2);
    expect(s.year_to_date).toEqual({ year: 2026, incidents: h.yearToDate, last_year_same_period: h.lastYearSamePeriod, delta_pct: tenth(h.yoyPct) });
    // a delta that does not divide evenly is rounded, not truncated
    const uneven = buildSummary([...RECORDS, inc({ incident_date: "2026-09-20" }), inc({ incident_date: "2026-09-21" })], OPTS);
    expect(uneven.this_month.last_month).toBe(3);
    expect(uneven.this_month.delta_pct).toBe(-33.3);
    expect(s.trailing_12.incidents).toBe(h.trailing12);
    expect(s.trailing_12.prior).toBe(h.prior12);
    expect(s.trailing_12.real_world).toBe(headline(real, { now: NOW }).trailing12);
    expect(s.trailing_12.from).toBe(shiftMonth(month, -11));
    expect(s.trailing_12.to).toBe(month);
    expect(s.provisional_from).toBe(h.provisionalFrom);
  });

  it("matches monthlySeries() month by month, and the 24-month window is its sum", () => {
    expect(s.monthly).toHaveLength(SUMMARY_MONTHS);
    const from = shiftMonth(month, -(SUMMARY_MONTHS - 1));
    expect(s.monthly.map((m) => m.month)).toEqual(monthRange(from, month));
    const all = monthlySeries(counted, { from, to: month });
    const realSeries = monthlySeries(real, { from, to: month });
    const disclosed = monthlySeries(RECORDS.filter(isDisclosedIncident), { from, to: month });
    s.monthly.forEach((m, i) => {
      expect(m.incidents).toBe(all[i]!.total);
      expect(m.real_world).toBe(realSeries[i]!.total);
      expect(m.disclosed_vulnerabilities).toBe(disclosed[i]!.total);
      expect(m.provisional).toBe(m.month >= h.provisionalFrom);
    });
    expect(s.trailing_24.incidents).toBe(s.monthly.reduce((a, m) => a + m.incidents, 0));
    expect(s.trailing_24.real_world).toBe(s.monthly.reduce((a, m) => a + m.real_world, 0));
    expect(s.trailing_12.incidents).toBe(s.monthly.slice(-12).reduce((a, m) => a + m.incidents, 0));
    const prior24 = monthlySeries(counted, { from: shiftMonth(from, -24), to: shiftMonth(from, -1) }).reduce((a, p) => a + p.total, 0);
    expect(s.trailing_24.prior).toBe(prior24);
    expect(s.trailing_24.from).toBe(from);
  });

  it("uses the pctChange rule for deltas, rounded to a tenth", () => {
    expect(s.trailing_12.delta_pct).toBe(Math.round(pctChange(s.trailing_12.incidents, s.trailing_12.prior)! * 10) / 10);
    expect(s.trailing_24.delta_pct).toBe(Math.round(pctChange(s.trailing_24.incidents, s.trailing_24.prior)! * 10) / 10);
    expect(s.trailing_12.incidents).toBe(6);
    expect(s.trailing_12.prior).toBe(2);
    expect(s.trailing_12.delta_pct).toBe(200);
    expect(s.trailing_24.incidents).toBe(8);
    expect(s.trailing_24.prior).toBe(1);
  });

  it("leaves a year-only incident in the totals but in no month or window", () => {
    const inMonths = s.monthly.reduce((a, m) => a + m.incidents, 0);
    expect(s.totals.incidents).toBe(inMonths + 2 /* 2024-06 and 2022-01 */ + 1 /* 2025, year only */);
  });

  it("reports a zero baseline honestly", () => {
    const only = buildSummary([inc({ incident_date: "2026-10-01" })], OPTS);
    expect(only.trailing_12.delta_pct).toBeNull();
    expect(only.trailing_24.delta_pct).toBeNull();
    expect(only.this_month.delta_pct).toBeNull();
    const none = buildSummary([], OPTS);
    expect(none.trailing_12.delta_pct).toBe(0);
    expect(none.totals).toEqual({ records: 0, incidents: 0, real_world: 0, disclosed_vulnerabilities: 0 });
    expect(none.monthly).toHaveLength(SUMMARY_MONTHS);
  });

  it("keeps records with no AI role out of every number", () => {
    const general = inc({ incident_date: "2026-10-03", type: "not_ai", categories: ["general"], severity: 4 });
    const lensed = buildSummary([...RECORDS, general, general], OPTS);
    expect(lensed.totals).toEqual(s.totals);
    expect(lensed.this_month).toEqual(s.this_month);
    expect(lensed.trailing_12).toEqual(s.trailing_12);
    expect(lensed.monthly).toEqual(s.monthly);
    expect(lensed.scope).toBe("ai");
    expect(lensed.scope_note).toMatch(/no AI role/);
  });

  it("carries provenance, licence and the counting rule", () => {
    expect(s.version).toBe(1);
    expect(s.scope).toBe("ai");
    expect(s.date_basis).toBe("incident_date");
    expect(s.site).toBe(OPTS.site);
    expect(s.last_collector_run).toBe(OPTS.lastUpdated);
    expect(s.generated_at).toBe(NOW.toISOString());
    expect(s.license).toBe("CC BY-SA 4.0");
    expect(s.counting_rule).toMatch(/disclosed vulnerabilities/);
    expect(s.cite_as).toContain(OPTS.site);
  });
});
