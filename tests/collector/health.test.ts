import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../lib/schema";
import { classificationStalled, runSummaryMarkdown } from "../../collector/pipeline/health";

function run(mode: RunRecord["mode"], classified: number, pending: number): RunRecord {
  return {
    id: `run-${mode}-${classified}-${pending}`,
    started_at: "2026-10-18T00:00:00.000Z",
    finished_at: "2026-10-18T00:10:00.000Z",
    mode,
    sources: [],
    counts: { fetched: 10, prefiltered: 5, merged: 0, classified, published: classified, review: 0, rejected: 0, pending },
    llm: { calls: classified ? 1 : 0, prompt_tokens: 0, completion_tokens: 0, by_model: {} },
    errors: [],
  };
}

describe("classificationStalled", () => {
  it("is quiet while runs classify something or nothing is waiting", () => {
    expect(classificationStalled([run("scheduled", 0, 5), run("scheduled", 2, 0), run("scheduled", 0, 5)], 3)).toBe(false);
    expect(classificationStalled([run("scheduled", 0, 0), run("scheduled", 0, 0), run("scheduled", 0, 0)], 3)).toBe(false);
  });

  it("fires after n consecutive scheduled runs with waiting candidates and no classification", () => {
    expect(classificationStalled([run("scheduled", 0, 5), run("scheduled", 0, 6), run("scheduled", 0, 7)], 3)).toBe(true);
  });

  it("needs n scheduled runs, and ignores manual and backfill runs", () => {
    expect(classificationStalled([run("scheduled", 0, 5), run("scheduled", 0, 6)], 3)).toBe(false);
    expect(classificationStalled([run("scheduled", 0, 5), run("backfill", 0, 6), run("scheduled", 0, 6), run("manual", 5, 0), run("scheduled", 0, 7)], 3)).toBe(true);
  });

  it("only looks at the most recent n runs", () => {
    expect(classificationStalled([run("scheduled", 0, 5), run("scheduled", 0, 5), run("scheduled", 0, 5), run("scheduled", 3, 0)], 3)).toBe(false);
  });
});

describe("runSummaryMarkdown", () => {
  it("renders the counts and flags a stall and a backlog", () => {
    const md = runSummaryMarkdown(run("scheduled", 0, 350), { stalled: true, stalledRuns: 3, pendingWarn: 300 });
    expect(md).toContain("| 10 | 5 | 0 | 0 | 0 | 0 | 0 | 350 | 0 | 0 | 0 |");
    expect(md).toContain("350 candidates are waiting");
    expect(md).toContain("Classification has stalled");
  });

  it("prints the lifecycle counts when a run carries them", () => {
    const r = run("scheduled", 2, 0);
    r.counts.updated = 3;
    r.counts.closed = 1;
    r.counts.reopened = 1;
    expect(runSummaryMarkdown(r, { stalled: false, stalledRuns: 3, pendingWarn: 300 })).toContain("| 10 | 5 | 0 | 2 | 2 | 0 | 0 | 0 | 3 | 1 | 1 |");
  });

  it("stays plain for a healthy run", () => {
    const md = runSummaryMarkdown(run("scheduled", 2, 0), { stalled: false, stalledRuns: 3, pendingWarn: 300 });
    expect(md).not.toContain("⚠️");
    expect(md).not.toContain("❌");
  });
});
