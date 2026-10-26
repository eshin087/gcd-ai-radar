import { describe, expect, it } from "vitest";
import {
  LANE_RULES,
  LIFECYCLE_KEYS,
  addDays,
  closedAtOf,
  daysBetween,
  deriveLifecycle,
  isLiveByRule,
  laneOf,
  lastActivity,
  patchGroup,
  patchStatusOf,
  shouldReopen,
  stateOf,
  timelineOf,
  withLifecycle,
} from "@/lib/lifecycle";
import { IncidentSchema } from "@/lib/schema";
import { LANES } from "@/lib/taxonomy";
import { disclosedCve, incident, legacyIncident } from "./fixtures";

const NOW = "2026-10-25";

describe("days", () => {
  it("counts whole days and adds them", () => {
    expect(daysBetween("2026-10-10", "2026-10-25")).toBe(15);
    expect(daysBetween("2026-10-25", "2026-10-10")).toBe(-15);
    expect(addDays("2026-10-25", 14)).toBe("2026-11-08");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    // approximate dates land mid-period
    expect(daysBetween("2026-10", "2026-10-15")).toBe(0);
    expect(daysBetween("2026", "2026-07-01")).toBe(0);
  });
});

describe("laneOf", () => {
  it("applies the lane rules in order for records that predate lanes", () => {
    expect(LANE_RULES.map((r) => r.lane)).toEqual(["research", "breach", "supply_chain", "breach", "patch"]);
    expect(LANES).toContain("research");
    expect(laneOf(legacyIncident({ severity: 1 }))).toBe("research");
    expect(laneOf(legacyIncident({ type: "ai_enabled_attack", categories: ["deepfake_fraud"], severity: 4 }))).toBe("breach");
    expect(laneOf(legacyIncident({ categories: ["supply_chain"], severity: 3 }))).toBe("supply_chain");
    expect(laneOf(legacyIncident({ categories: ["data_poisoning", "supply_chain"], severity: 2 }))).toBe("supply_chain");
    expect(laneOf(legacyIncident({ categories: ["data_leak"], severity: 3 }))).toBe("breach");
    expect(laneOf(legacyIncident({ categories: ["data_leak"], severity: 2 }))).toBe("patch");
    expect(laneOf(legacyIncident({ categories: ["prompt_injection"], severity: 3 }))).toBe("patch");
    expect(laneOf(legacyIncident({ categories: ["infra_vuln"], severity: 2 }))).toBe("patch");
    // the research rule comes first: a severity-1 supply-chain paper is research
    expect(laneOf(legacyIncident({ categories: ["supply_chain"], severity: 1 }))).toBe("research");
  });

  it("keeps a stored lane and reads a general record as a flaw", () => {
    expect(laneOf(incident({ lane: "breach", severity: 1 }))).toBe("breach");
    expect(laneOf({ type: "not_ai", categories: ["general"], severity: 3 })).toBe("patch");
  });
});

describe("patch status and groups", () => {
  it("defaults by lane and keeps a stored status", () => {
    expect(patchStatusOf(legacyIncident({ type: "ai_enabled_attack", categories: ["ai_phishing_social_engineering"] }))).toBe("no_fix_needed");
    expect(patchStatusOf(legacyIncident({ categories: ["infra_vuln"] }))).toBe("unknown");
    expect(patchStatusOf(incident({ patch_status: "partial" }))).toBe("partial");
    expect(patchGroup(incident({ patch_status: "partial" }))).toBe("partial");
    expect(patchGroup(incident({ patch_status: "no_fix_needed" }))).toBe("other");
    expect(patchGroup(incident({ patch_status: "unknown" }))).toBe("other");
  });
});

describe("timeline and activity", () => {
  it("seeds a timeline from the sources, oldest first, titles capped at 240 characters", () => {
    const long = "x".repeat(300);
    const i = legacyIncident({
      first_reported: "2026-10-01",
      sources: [
        { url: "https://example.org/b", publisher: "B", title: long, published_at: "2026-10-03" },
        { url: "https://example.org/a", publisher: "A", title: "First report", published_at: "2026-10-01" },
      ],
      created_at: "2026-10-04T00:00:00.000Z",
    });
    const t = timelineOf(i);
    expect(t.map((e) => e.date)).toEqual(["2026-10-01", "2026-10-03"]);
    expect(t[0]).toEqual({ date: "2026-10-01", title: "First report", source_url: "https://example.org/a", added_at: "2026-10-04T00:00:00.000Z" });
    expect(t[1]!.title).toHaveLength(240);
    expect(t[1]!.title.endsWith("…")).toBe(true);
    expect(lastActivity(i)).toBe("2026-10-03");
  });

  it("keeps a stored timeline, sorted, and reads the newest activity from it", () => {
    const i = incident({
      first_reported: "2026-10-01",
      timeline: [
        { date: "2026-10-09", title: "Patch released", added_at: "2026-10-09T10:00:00.000Z" },
        { date: "2026-10-01", title: "First report", added_at: "2026-10-01T10:00:00.000Z" },
      ],
    });
    expect(timelineOf(i).map((e) => e.title)).toEqual(["First report", "Patch released"]);
    expect(lastActivity(i)).toBe("2026-10-09");
    // updated_at never counts
    expect(lastActivity(incident({ first_reported: "2026-09-01", timeline: [], updated_at: "2026-10-24T00:00:00.000Z" }))).toBe("2026-09-01");
  });
});

describe("the live rule", () => {
  it("keeps patch and supply-chain records live 14 days, or 60 while unpatched or partial", () => {
    expect(isLiveByRule("patch", "patched", "2026-10-11", "2026-10-01", NOW)).toBe(true); // 14 days
    expect(isLiveByRule("patch", "patched", "2026-10-10", "2026-10-01", NOW)).toBe(false); // 15 days
    expect(isLiveByRule("patch", "unknown", "2026-10-10", "2026-10-01", NOW)).toBe(false);
    expect(isLiveByRule("patch", "unpatched", "2026-08-27", "2026-08-01", NOW)).toBe(true); // 59 days
    expect(isLiveByRule("supply_chain", "partial", "2026-08-26", "2026-08-01", NOW)).toBe(true); // 60 days
    expect(isLiveByRule("patch", "unpatched", "2026-08-25", "2026-08-01", NOW)).toBe(false); // 61 days
  });

  it("keeps breaches live 14 days after their latest activity and research 14 days after the first report", () => {
    expect(isLiveByRule("breach", "no_fix_needed", "2026-10-12", "2026-09-01", NOW)).toBe(true);
    expect(isLiveByRule("breach", "no_fix_needed", "2026-10-10", "2026-09-01", NOW)).toBe(false);
    expect(isLiveByRule("research", "unknown", "2026-10-24", "2026-10-11", NOW)).toBe(true);
    expect(isLiveByRule("research", "unknown", "2026-10-24", "2026-10-10", NOW)).toBe(false); // activity does not extend it
  });

  it("decides state from the rule, except that disclosed and stored-closed records stay closed", () => {
    expect(stateOf(legacyIncident({ first_reported: "2026-10-20" }), NOW)).toBe("live");
    expect(stateOf(legacyIncident({ first_reported: "2026-09-01" }), NOW)).toBe("closed");
    expect(stateOf(disclosedCve({ first_reported: "2026-10-24", state: undefined, closed_at: undefined }), NOW)).toBe("closed");
    expect(stateOf(incident({ first_reported: "2026-10-24", state: "closed", closed_at: "2026-10-24" }), NOW)).toBe("closed");
    // a stored "live" is judged again at build time: a build can close, never reopen
    expect(stateOf(incident({ first_reported: "2026-09-01", state: "live", closed_at: null }), NOW)).toBe("closed");
    expect(stateOf(incident({ first_reported: "2026-10-20", state: "live", closed_at: null }), NOW)).toBe("live");
  });

  it("dates a closure at the end of the live window, or as stored", () => {
    expect(closedAtOf(legacyIncident({ first_reported: "2026-10-20" }), NOW)).toBeNull();
    expect(closedAtOf(legacyIncident({ first_reported: "2026-09-01" }), NOW)).toBe("2026-09-15");
    expect(closedAtOf(legacyIncident({ first_reported: "2026-09-01", severity: 1 }), NOW)).toBe("2026-09-15");
    expect(closedAtOf(incident({ first_reported: "2026-08-01", patch_status: "unpatched", timeline: [] }), NOW)).toBe("2026-09-30");
    expect(closedAtOf(incident({ first_reported: "2026-09-01", state: "closed", closed_at: "2026-09-03" }), NOW)).toBe("2026-09-03");
    expect(closedAtOf(disclosedCve({ first_reported: "2026-10-24", state: undefined, closed_at: undefined }), NOW)).toBe("2026-10-24");
  });

  it("reopens patch and breach records for a report within 14 days, never research", () => {
    expect(shouldReopen(incident({ lane: "patch" }), "2026-10-12", NOW)).toBe(true);
    expect(shouldReopen(incident({ lane: "breach" }), "2026-10-10", NOW)).toBe(false);
    expect(shouldReopen(incident({ lane: "research" }), "2026-10-25", NOW)).toBe(false);
  });
});

describe("deriveLifecycle and withLifecycle", () => {
  it("fills every lifecycle key on a record that predates lanes", () => {
    const legacy = legacyIncident({ first_reported: "2026-10-20", tags: ["CVE-2026-0001", "mcp"], title: "Flaw CVE-2026-0002 in a tool" });
    for (const k of LIFECYCLE_KEYS) expect(k in legacy).toBe(false);
    const full = withLifecycle(legacy, NOW);
    for (const k of LIFECYCLE_KEYS) expect(k in full).toBe(true);
    expect(full).toMatchObject({ lane: "patch", state: "live", closed_at: null, patch_status: "unknown", action: "", severity_note: "", cvss: null, affected: [], fixed_in: [] });
    expect(full.cve_ids).toEqual(["CVE-2026-0002", "CVE-2026-0001"]);
    expect(full.timeline).toHaveLength(1);
    expect(IncidentSchema.safeParse(full).success).toBe(true);
  });

  it("keeps stored values and is idempotent for one build day", () => {
    const stored = incident({ lane: "breach", patch_status: "no_fix_needed", cve_ids: ["CVE-2026-9999"], action: "Rotate your keys.", cvss: 9.8, affected: ["Example 1.0"] });
    const once = withLifecycle(stored, NOW);
    expect(once).toMatchObject({ lane: "breach", patch_status: "no_fix_needed", cve_ids: ["CVE-2026-9999"], action: "Rotate your keys.", cvss: 9.8, affected: ["Example 1.0"] });
    expect(withLifecycle(once, NOW)).toEqual(once);
    expect(deriveLifecycle(once, NOW)).toEqual(deriveLifecycle(stored, NOW));
  });
});
