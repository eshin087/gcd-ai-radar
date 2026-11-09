import { describe, expect, it } from "vitest";
import { epssFor, epssPercentileLabel, epssScoreLabel } from "@/lib/epss";

const stats = {
  model_date: "2026-11-07",
  scores: { "CVE-2026-0001": [0.2, 0.9], "CVE-2026-0002": [0.9739, 0.999], "CVE-2026-0003": [0.001, 0.007] } as Record<string, [number, number]>,
};

describe("epssFor", () => {
  it("returns the highest-scored CVE of the record with its percentile and the model date", () => {
    expect(epssFor(["CVE-2026-0001", "CVE-2026-0002", "CVE-2026-0003"], stats)).toEqual({ cve: "CVE-2026-0002", epss: 0.9739, percentile: 0.999, model_date: "2026-11-07" });
    expect(epssFor(["CVE-2026-0003"], stats)).toMatchObject({ cve: "CVE-2026-0003", epss: 0.001, percentile: 0.007 });
  });

  it("ignores CVEs the file does not know and renders nothing when it knows none", () => {
    expect(epssFor(["CVE-2026-9999", "CVE-2026-0001"], stats)).toMatchObject({ cve: "CVE-2026-0001" });
    expect(epssFor(["CVE-2026-9999"], stats)).toBeNull();
    expect(epssFor([], stats)).toBeNull();
    expect(epssFor(["CVE-2026-0001"], null)).toBeNull();
    expect(epssFor(["CVE-2026-0001"], undefined)).toBeNull();
  });

  it("keeps the record's first CVE on a tie", () => {
    const tied = { model_date: "2026-11-07", scores: { "CVE-2026-0010": [0.5, 0.95], "CVE-2026-0011": [0.5, 0.95] } as Record<string, [number, number]> };
    expect(epssFor(["CVE-2026-0011", "CVE-2026-0010"], tied)?.cve).toBe("CVE-2026-0011");
  });
});

describe("EPSS labels", () => {
  it("prints the score to two decimals and never a zero the model did not give", () => {
    expect(epssScoreLabel(0.9739)).toBe("0.97");
    expect(epssScoreLabel(1)).toBe("1.00");
    expect(epssScoreLabel(0.0492)).toBe("0.05");
    expect(epssScoreLabel(0.001)).toBe("<0.01");
    expect(epssScoreLabel(0)).toBe("<0.01");
  });

  it("turns the percentile into a 'top N%' that always holds", () => {
    expect(epssPercentileLabel(0.99)).toBe("top 1%");
    expect(epssPercentileLabel(0.9)).toBe("top 10%");
    expect(epssPercentileLabel(0.922)).toBe("top 8%"); // 7.8% rounds up, never down
    expect(epssPercentileLabel(0.3)).toBe("top 70%");
    expect(epssPercentileLabel(0.995)).toBe("top 0.5%");
    expect(epssPercentileLabel(0.9935)).toBe("top 0.7%");
    expect(epssPercentileLabel(0.999)).toBe("top 0.1%");
    expect(epssPercentileLabel(1)).toBe("top 0.1%");
  });
});
