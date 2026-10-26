import { describe, expect, it } from "vitest";
import type { Incident } from "@/lib/schema";
import {
  addTrend,
  categoryDistribution,
  emptyByType,
  headline,
  monthRange,
  monthlySeries,
  pctChange,
  shiftMonth,
  targetDistribution,
} from "@/lib/stats";

function inc(partial: Partial<Incident> & { incident_date: string; first_reported: string }): Incident {
  return {
    id: "AIR-2026-0001",
    slug: "test-incident",
    title: "Test incident title",
    summary: "A sufficiently long summary sentence. And a second sentence.",
    type: "attack_on_ai",
    categories: ["prompt_injection"],
    severity: 2,
    targets: ["OpenAI"],
    products: [],
    incident_date_precision: partial.incident_date.length === 10 ? "day" : partial.incident_date.length === 7 ? "month" : "year",
    sources: [{ url: "https://example.org/a", publisher: "Example", title: "t", published_at: partial.first_reported }],
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

describe("month helpers", () => {
  it("builds inclusive ranges across year boundaries", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("shifts months", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-01", -12)).toBe("2025-01");
    expect(shiftMonth("2026-10", 3)).toBe("2027-01");
  });
});

describe("monthlySeries", () => {
  const incidents = [
    inc({ incident_date: "2026-01-05", first_reported: "2026-01-06" }),
    inc({ incident_date: "2026-01-20", first_reported: "2026-02-01", type: "ai_enabled_attack", categories: ["deepfake_fraud"], severity: 4 }),
    inc({ incident_date: "2026-02", first_reported: "2026-02-10" }),
    inc({ incident_date: "2025", first_reported: "2026-03-01" }), // year precision: excluded from monthly by incident_date
  ];
  it("buckets by incident_date and excludes year-only dates", () => {
    const s = monthlySeries(incidents, { from: "2026-01", to: "2026-03" });
    expect(s.map((p) => p.total)).toEqual([2, 1, 0]);
    expect(s[0]!.byType.ai_enabled_attack).toBe(1);
    expect(s[0]!.byCategory.deepfake_fraud).toBe(1);
    expect(s[0]!.bySeverity[4]).toBe(1);
  });
  it("buckets by first_reported when asked", () => {
    const s = monthlySeries(incidents, { from: "2026-01", to: "2026-03", dateField: "first_reported" });
    expect(s.map((p) => p.total)).toEqual([1, 2, 1]);
  });
});

describe("addTrend", () => {
  it("computes a centered moving average and a linear fit", () => {
    const series = monthRange("2026-01", "2026-05").map((month, i) => ({
      month,
      total: i + 1,
      byType: emptyByType(),
      byCategory: {} as never,
      bySeverity: {} as never,
    }));
    const t = addTrend(series);
    expect(t[0]!.ma).toBeNull();
    expect(t[1]!.ma).toBe(2);
    expect(t[2]!.ma).toBe(3);
    expect(t[4]!.ma).toBeNull();
    expect(t[0]!.fit).toBeCloseTo(1);
    expect(t[4]!.fit).toBeCloseTo(5);
  });
});

describe("headline", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const incidents = [
    inc({ incident_date: "2026-10-02", first_reported: "2026-10-03" }),
    inc({ incident_date: "2026-10-09", first_reported: "2026-10-10", severity: 3 }),
    inc({ incident_date: "2026-09-15", first_reported: "2026-09-16" }),
    inc({ incident_date: "2025-12-15", first_reported: "2025-12-16" }), // trailing 12 (Nov 25..Oct 26)
    inc({ incident_date: "2025-10-01", first_reported: "2025-10-02" }), // prior 12 window & last-year same period
    inc({ incident_date: "2025-10-20", first_reported: "2025-10-21", severity: 4 }), // after Oct 17 last year: not in YoY same period
  ];
  it("computes month, trailing and year-over-year comparisons", () => {
    const h = headline(incidents, { now });
    expect(h.total).toBe(6);
    expect(h.realWorld).toBe(2);
    expect(h.thisMonth).toBe(2);
    expect(h.lastMonth).toBe(1);
    expect(h.monthDeltaPct).toBe(100);
    expect(h.trailing12).toBe(4);
    expect(h.prior12).toBe(2);
    expect(h.yearToDate).toBe(3);
    expect(h.lastYearSamePeriod).toBe(1);
    expect(h.yoyPct).toBe(200);
    expect(h.provisionalFrom).toBe("2026-08");
  });
});

describe("distributions and pct", () => {
  it("counts every target an incident lists and primary categories only", () => {
    const incidents = [
      inc({ incident_date: "2026-01-01", first_reported: "2026-01-01", targets: ["OpenAI", "Google"], categories: ["agent_hijack", "prompt_injection"] }),
      inc({ incident_date: "2026-01-02", first_reported: "2026-01-02", targets: ["Google"] }),
    ];
    const t = targetDistribution(incidents);
    expect(t[0]).toEqual({ key: "Google", count: 2 });
    const c = categoryDistribution(incidents);
    expect(c.find((r) => r.key === "agent_hijack")?.count).toBe(1);
    expect(c.find((r) => r.key === "prompt_injection")?.count).toBe(1);
  });
  it("handles zero baselines", () => {
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(5, 10)).toBe(-50);
  });
});
