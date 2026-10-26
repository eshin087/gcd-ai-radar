import { describe, expect, it } from "vitest";
import { runCommitMessage, siteUnchanged, validateLifecycle } from "@/collector/cli";
import { NO_SITE_CHANGE } from "@/collector/git";
import { CollectorStateSchema, emptyCollectorState, pruneCollectorState, serialize, type State } from "@/collector/lib/state";
import { DUE_HOURS, isDue, lastSuccessBySource } from "@/collector/pipeline/run";
import type { RunRecord } from "@/lib/schema";
import { migrateRecords } from "@/scripts/migrate-lanes";
import { incident, legacyIncident } from "../fixtures";

function run(id: string, finished_at: string, sources: { id: string; ok: boolean }[], mode: RunRecord["mode"] = "scheduled"): RunRecord {
  return {
    id,
    started_at: finished_at,
    finished_at,
    mode,
    sources: sources.map((s) => ({ ...s, items: 1, duration_ms: 1 })),
    counts: { fetched: 1, prefiltered: 1, merged: 0, classified: 0, published: 0, review: 0, rejected: 0, pending: 0 },
    llm: { calls: 0, prompt_tokens: 0, completion_tokens: 0, by_model: {} },
    errors: [],
  };
}

describe("collector-state.json", () => {
  it("round-trips through serialize with sorted keys and validates", () => {
    const state: State = {
      incidents: [],
      review: [],
      rejected: [],
      pending: [],
      seen: {},
      runs: [],
      collector: { sources: { kev: { last_success_at: "2026-10-25T10:00:00.000Z" }, atlas: { last_success_at: "2026-10-01T10:00:00.000Z" } }, cve_lookups: { "CVE-2026-2": { at: "2026-10-25T10:00:00.000Z", found: false }, "CVE-2026-1": { at: "2026-10-20T10:00:00.000Z", found: true } } },
    };
    const text = serialize(state).get("collector-state.json")!;
    const parsed = CollectorStateSchema.parse(JSON.parse(text));
    expect(Object.keys(parsed.sources)).toEqual(["atlas", "kev"]);
    expect(Object.keys(parsed.cve_lookups)).toEqual(["CVE-2026-1", "CVE-2026-2"]);
    expect(parsed).toEqual(state.collector);
  });

  it("forgets CVE lookups older than sixty days and keeps the sources", () => {
    const c = emptyCollectorState();
    c.sources["kev"] = { last_success_at: "2026-01-01T00:00:00.000Z" };
    c.cve_lookups["CVE-2026-1"] = { at: "2026-08-01T00:00:00.000Z", found: false };
    c.cve_lookups["CVE-2026-2"] = { at: "2026-10-01T00:00:00.000Z", found: false };
    const pruned = pruneCollectorState(c, "2026-10-25T00:00:00.000Z");
    expect(Object.keys(pruned.cve_lookups)).toEqual(["CVE-2026-2"]);
    expect(pruned.sources["kev"]).toBeDefined();
  });

  it("remembers a monthly source past the run ledger, with the ledger as a one-time fallback", () => {
    const runs = [run("r1", "2026-10-20T00:00:00.000Z", [{ id: "thn", ok: true }, { id: "atlas", ok: false }]), run("r2", "2026-10-21T00:00:00.000Z", [{ id: "thn", ok: true }], "dry-run")];
    const collector = emptyCollectorState();
    collector.sources["atlas"] = { last_success_at: "2026-10-01T00:00:00.000Z" };
    const last = lastSuccessBySource({ runs, collector });
    expect(last.get("thn")).toBe("2026-10-20T00:00:00.000Z"); // the dry run does not count
    expect(last.get("atlas")).toBe("2026-10-01T00:00:00.000Z"); // only the state file knows
    collector.sources["thn"] = { last_success_at: "2026-10-22T00:00:00.000Z" };
    expect(lastSuccessBySource({ runs, collector }).get("thn")).toBe("2026-10-22T00:00:00.000Z"); // the newer answer wins
  });
});

describe("schedules", () => {
  it("reads a six-hourly source a little under six hours after its last success, and daily ones after twenty", () => {
    const now = new Date("2026-10-25T12:00:00.000Z");
    expect(DUE_HOURS.six_hourly).toBe(5.5);
    expect(isDue({ schedule: "six_hourly" }, "2026-10-25T07:00:00.000Z", now)).toBe(false);
    expect(isDue({ schedule: "six_hourly" }, "2026-10-25T06:00:00.000Z", now)).toBe(true);
    expect(isDue({ schedule: "daily" }, "2026-10-24T20:00:00.000Z", now)).toBe(false);
    expect(isDue({ schedule: "daily" }, "2026-10-24T14:00:00.000Z", now)).toBe(true);
    expect(isDue({ schedule: "every_run" }, "2026-10-25T11:59:00.000Z", now)).toBe(true);
    expect(isDue({ schedule: "monthly" }, undefined, now)).toBe(true);
  });
});

describe("the data commit", () => {
  const record = run("run-x", "2026-10-25T13:17:00.000Z", []);
  record.counts.published = 1;
  record.counts.updated = 2;
  record.counts.closed = 3;

  it("marks a bookkeeping-only commit and skips the marker when the site changes", () => {
    expect(siteUnchanged(["runs.json", "seen.json"], false)).toBe(true);
    expect(siteUnchanged(["runs.json", "collector-state.json", "pending.json", "rejected.json"], false)).toBe(true);
    expect(siteUnchanged(["runs.json", "incidents/2026.json"], false)).toBe(false);
    expect(siteUnchanged(["runs.json", "review-queue.json"], false)).toBe(false);
    expect(siteUnchanged(["runs.json"], true)).toBe(false);
    expect(siteUnchanged([], false)).toBe(false);
    expect(runCommitMessage(record, ["runs.json"], false)).toBe(`data: run 2026-10-25T13:17Z (+1 published, +0 review, 0 merged, 2 updated, 3 closed) ${NO_SITE_CHANGE}`);
    expect(runCommitMessage(record, ["runs.json", "incidents/2026.json"], false)).not.toContain(NO_SITE_CHANGE);
  });

  it("is what the Vercel ignore command tests for", () => {
    const re = /\[no site change\]/;
    expect(re.test(runCommitMessage(record, ["runs.json"], false))).toBe(true);
    expect(re.test(runCommitMessage(record, ["incidents/2026.json"], false))).toBe(false);
  });
});

describe("validate", () => {
  it("reports unsorted timelines and state/closed_at disagreement, and nothing for sound records", () => {
    expect(validateLifecycle([incident(), legacyIncident()])).toEqual([]);
    const unsorted = incident({ timeline: [{ date: "2026-10-12", title: "b", added_at: "2026-10-12T00:00:00.000Z" }, { date: "2026-10-10", title: "a", added_at: "2026-10-10T00:00:00.000Z" }] });
    expect(validateLifecycle([unsorted])).toEqual([`${unsorted.id}: timeline is not sorted at entry 1`]);
    const odd = { ...incident(), state: "closed" as const, closed_at: null };
    expect(validateLifecycle([odd])[0]).toMatch(/closed without closed_at/);
  });
});

describe("migrate-lanes", () => {
  it("fills every lifecycle key as withLifecycle would, counts per lane and state, and is idempotent", () => {
    const a = legacyIncident({ first_reported: "2026-10-20" }); // live patch record
    const b = legacyIncident({ first_reported: "2026-06-01", severity: 1 }); // research, long closed
    const c = legacyIncident({ first_reported: "2026-10-22", type: "ai_enabled_attack", categories: ["ai_assisted_intrusion"] }); // breach
    const report = migrateRecords([a, b, c], "2026-10-25");
    expect(report.changed).toBe(3);
    expect(report.byLane).toEqual({ patch: 1, breach: 1, supply_chain: 0, research: 1 });
    expect(report.byState).toEqual({ live: 2, closed: 1 });
    expect(report.liveByLane).toEqual({ patch: 1, breach: 1, supply_chain: 0, research: 0 });
    expect(a.lane).toBe("patch");
    expect(a.state).toBe("live");
    expect(a.timeline).toHaveLength(1);
    expect(a.timeline![0]!.added_at).toBe(a.created_at);
    expect(b.state).toBe("closed");
    expect(b.closed_at).toBe("2026-06-15");
    expect(c.patch_status).toBe("no_fix_needed");
    const again = migrateRecords([a, b, c], "2026-10-25");
    expect(again.changed).toBe(0);
    expect(again.bytesAfter).toBe(report.bytesAfter);
  });
});
