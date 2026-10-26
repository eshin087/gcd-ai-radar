import { describe, expect, it } from "vitest";
import { FULL_ROWS, boardsWithAll, buildLive, heatmapMonths, longestQuietRun, rowOf, rowOfSlim } from "@/lib/live";
import { slim } from "@/lib/slim";
import { disclosedCve, incident } from "./fixtures";

const NOW = new Date("2026-10-25T12:00:00Z");

describe("rows", () => {
  it("builds the same row from a full and a slim record, apart from the action line", () => {
    const i = incident({ products: ["Langflow OSS", "IBM Langflow OSS", "vLLM", "Gradio"], cve_ids: ["CVE-2026-4", "CVE-2026-3", "CVE-2026-2", "CVE-2026-1"], action: "Update now.", tags: ["rce", "RCE", "mcp"] });
    const full = rowOf(i);
    expect(full.products).toEqual(["Langflow", "vLLM", "Gradio"]);
    expect(full.cve_ids).toEqual(["CVE-2026-4", "CVE-2026-3", "CVE-2026-2"]);
    expect(full.cve_more).toBe(1);
    expect(full.tags).toEqual(["rce", "mcp"]);
    expect(full.ai).toBe(true);
    const thin = rowOfSlim(slim(i));
    expect({ ...thin, action: full.action }).toEqual(full);
    expect(thin.action).toBe("");
    expect(rowOf(incident({ type: "not_ai", categories: ["general"] })).ai).toBe(false);
  });
});

describe("longestQuietRun", () => {
  it("finds the longest gap between incident days, including the run still open", () => {
    expect(longestQuietRun([], "2026-10-25")).toBeNull();
    expect(longestQuietRun(["2026-10-01", "2026-10-02", "2026-10-20", "2026-10-25"], "2026-10-25")).toEqual({ days: 17, from: "2026-10-03", to: "2026-10-19" });
    expect(longestQuietRun(["2026-10-01", "2026-10-05"], "2026-10-25")).toEqual({ days: 20, from: "2026-10-06", to: "2026-10-25" });
    // days older than a year are left out
    expect(longestQuietRun(["2024-01-01", "2026-10-24"], "2026-10-25")).toEqual({ days: 1, from: "2026-10-25", to: "2026-10-25" });
  });
});

describe("buildLive", () => {
  const records = [
    incident({ lane: "patch", state: "live", patch_status: "unpatched", severity: 4, first_reported: "2026-10-24", incident_date: "2026-10-24" }),
    incident({ lane: "patch", state: "live", patch_status: "patched", severity: 3, first_reported: "2026-10-20", incident_date: "2026-10-20" }),
    incident({ lane: "supply_chain", state: "live", patch_status: "partial", severity: 3, first_reported: "2026-10-22", incident_date: "2026-10-22", type: "not_ai", categories: ["general"] }),
    incident({ lane: "breach", state: "live", patch_status: "no_fix_needed", severity: 4, first_reported: "2026-10-15", incident_date: "2026-10-14", type: "ai_enabled_attack", categories: ["deepfake_fraud"] }),
    incident({ lane: "research", state: "live", severity: 1, first_reported: "2026-10-23", incident_date: "2026-10-23" }),
    incident({ lane: "patch", state: "closed", closed_at: "2026-09-20", severity: 3, first_reported: "2026-09-01", incident_date: "2026-09-01" }),
    disclosedCve({ first_reported: "2026-10-24" }),
  ];
  const live = buildLive(records, NOW, "2026-10-25T06:00:00.000Z");

  it("puts every live record in exactly one lane and sums the action lanes into the counters", () => {
    expect(live.boards.map((b) => b.key)).toEqual(["patch", "breach", "supply_chain", "research"]);
    const tabs = boardsWithAll(live.boards, "2026-10-25");
    expect(tabs.map((b) => b.key)).toEqual(["patch", "breach", "supply_chain", "all", "research"]);
    const byKey = Object.fromEntries(tabs.map((b) => [b.key, b]));
    expect(byKey.patch!.count).toBe(2);
    expect(byKey.breach!.count).toBe(1);
    expect(byKey.supply_chain!.count).toBe(1);
    expect(byKey.research!.count).toBe(1);
    expect(byKey.all!.count).toBe(4);
    expect(byKey.patch!.count + byKey.breach!.count + byKey.supply_chain!.count).toBe(live.counters.live);
    expect(live.counters).toMatchObject({ live: 4, critical: 2, unpatched: 2, ai: 3 });
    expect(live.counters.quiet.days).toBe(1);
    // between the 1 September report and the next action-lane one on 15 October
    expect(live.counters.quiet.longest).toEqual({ days: 43, from: "2026-09-02", to: "2026-10-14" });
    const ids = live.boards.filter((b) => b.key !== "all").flatMap((b) => b.groups.flatMap((g) => g.rows.map((r) => r.id)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
    // never a disclosed CVE, never a closed record
    expect(ids).not.toContain(records[5]!.id);
    expect(ids).not.toContain(records[6]!.id);
  });

  it("groups patch lanes by fix status and the others by recency", () => {
    const patch = live.boards.find((b) => b.key === "patch")!;
    expect(patch.groups.map((g) => [g.key, g.rows.length])).toEqual([
      ["unpatched", 1],
      ["patched", 1],
    ]);
    const breach = live.boards.find((b) => b.key === "breach")!;
    expect(breach.groups.map((g) => g.key)).toEqual(["older"]);
    const all = boardsWithAll(live.boards, "2026-10-25").find((b) => b.key === "all")!;
    expect(all.groups.map((g) => [g.key, g.rows.length])).toEqual([
      ["recent", 3],
      ["older", 1],
    ]);
    expect(all.groups[0]!.rows[0]!.first_reported).toBe("2026-10-24");
    expect(all.ai).toBe(3);
    expect(FULL_ROWS).toBeGreaterThan(0);
  });

  it("weights the heatmap by severity and later updates, and counts only reported incidents for the click", () => {
    expect(heatmapMonths(live)).toHaveLength(12);
    expect(live.heatmap.to).toBe("2026-10-25");
    expect(live.heatmap.cells["2026-10-24"]).toEqual({ reported: 1, activity: 4 });
    expect(live.heatmap.cells["2026-10-15"]).toEqual({ reported: 1, activity: 4 });
    expect(live.heatmap.cells["2026-09-01"]).toEqual({ reported: 1, activity: 3 });
    expect(live.heatmap.max).toBe(4);
    const updated = buildLive(
      [incident({ first_reported: "2026-10-01", incident_date: "2026-10-01", severity: 3, timeline: [{ date: "2026-10-01", title: "Report", added_at: "2026-10-01T00:00:00.000Z" }, { date: "2026-10-03", title: "Patch", added_at: "2026-10-03T00:00:00.000Z" }] })],
      NOW,
    );
    expect(updated.heatmap.cells["2026-10-03"]).toEqual({ reported: 0, activity: 0.5 });
  });

  it("reads the AI lens and the live tags from the same records", () => {
    expect(live.aiLens.live).toBe(3);
    expect(live.aiLens.month).toBe("2026-10");
    expect(live.aiLens.topFamily?.family).toBe("injection");
    expect(live.topTags.map((t) => t.slug)).toEqual(["prompt-injection"]);
    expect(live.scope.total).toBe(6);
    expect(live.lastUpdated).toBe("2026-10-25T06:00:00.000Z");
  });
});
