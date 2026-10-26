import { describe, expect, it } from "vitest";
import { SettingsSchema, type Settings } from "@/collector/lib/config";
import type { LlmRouter } from "@/collector/llm/router";
import type { Merge } from "@/collector/pipeline/dedupe";
import { closeRecords } from "@/collector/pipeline/close";
import { applyModelUpdate, applyUpdates, fallbackEntry, structuredUpdate } from "@/collector/pipeline/update";
import { kevEntryToCandidate } from "@/collector/sources/kev";
import { withLifecycle } from "@/lib/lifecycle";
import { IncidentSchema, type Incident } from "@/lib/schema";
import settingsJson from "@/collector/config/settings.json";
import { incident, legacyIncident } from "../fixtures";
import { candidate } from "./helpers";

const settings: Settings = SettingsSchema.parse(settingsJson);
const NOW = "2026-10-25T12:00:00.000Z";

/** A router stand-in: answers every update batch with the given results, or is unavailable. */
function fakeRouter(answers: unknown[] | null, calls: { n: number } = { n: 0 }): LlmRouter {
  return {
    get available() {
      return answers !== null;
    },
    async completeJson() {
      calls.n += 1;
      return { parsed: { results: answers ?? [] }, provider: "fake", model: "fake" };
    },
  } as unknown as LlmRouter;
}

function merge(target: Incident, c = candidate({ title: "Vendor ships a fix for the exploited flaw", url: "https://example.org/fix", published_at: "2026-10-24" })): Merge {
  target.sources.push({ url: c.url, publisher: c.publisher, title: c.title, published_at: c.published_at });
  target.source_count = target.sources.length;
  return { candidate: c, target, pool: "incidents", how: "llm" };
}

describe("applyModelUpdate", () => {
  it("appends the entry, raises the fix status, unions fixed_in, sets the action and reopens a closed record", () => {
    const t = withLifecycle(incident({ first_reported: "2026-09-20", state: "closed", closed_at: "2026-10-04", patch_status: "unpatched", fixed_in: ["Example 1.0"] }), "2026-10-25");
    const c = candidate({ title: "Fix shipped", url: "https://example.org/fix", published_at: "2026-10-24" });
    const r = applyModelUpdate(t, c, { index: 0, add_entry: true, entry: "Vendor ships 1.1 fixing the flaw", patch_status: "patched", fixed_in: ["Example 1.1"], action: "Update to 1.1." }, NOW);
    expect(r).toEqual({ applied: true, reopened: true, entry: true });
    expect(t.timeline.at(-1)).toEqual({ date: "2026-10-24", title: "Vendor ships 1.1 fixing the flaw", source_url: c.url, added_at: NOW });
    expect(t.patch_status).toBe("patched");
    expect(t.fixed_in).toEqual(["Example 1.0", "Example 1.1"]);
    expect(t.action).toBe("Update to 1.1.");
    expect(t.state).toBe("live");
    expect(t.closed_at).toBeNull();
  });

  it("does not reopen on an old report, never moves patched backwards, and ignores the fix status on breach records", () => {
    const t = withLifecycle(incident({ first_reported: "2026-08-01", state: "closed", closed_at: "2026-08-15", patch_status: "patched" }), "2026-10-25");
    const old = candidate({ title: "Late write-up", url: "https://example.org/late", published_at: "2026-09-01" });
    const r = applyModelUpdate(t, old, { index: 0, add_entry: true, entry: "A late write-up", patch_status: "unpatched", fixed_in: [], action: "" }, NOW);
    expect(r.reopened).toBe(false);
    expect(t.state).toBe("closed");
    expect(t.patch_status).toBe("patched");
    const b = withLifecycle(incident({ lane: "breach", patch_status: "no_fix_needed" }), "2026-10-25");
    applyModelUpdate(b, old, { index: 0, add_entry: false, entry: "", patch_status: "patched", fixed_in: [], action: "" }, NOW);
    expect(b.patch_status).toBe("no_fix_needed");
  });

  it("drops entries and actions that carry links or markup and writes nothing when the report repeats what is known", () => {
    const t = withLifecycle(incident({ first_reported: "2026-10-20" }), "2026-10-25");
    const c = candidate({ title: "x", url: "https://example.org/x", published_at: "2026-10-24" });
    const r = applyModelUpdate(t, c, { index: 0, add_entry: true, entry: "See https://evil.example", patch_status: "keep", fixed_in: [], action: "<b>Click</b>" }, NOW);
    expect(r.applied).toBe(false);
    expect(t.timeline).toHaveLength(1);
    expect(applyModelUpdate(t, c, { index: 0, add_entry: false, entry: "", patch_status: "keep", fixed_in: [], action: "" }, NOW).applied).toBe(false);
  });

  it("keeps one entry per source url, rewording a seeded headline entry with what the report added", () => {
    const t = withLifecycle(incident({ first_reported: "2026-10-20" }), "2026-10-25");
    const c = candidate({ title: "x", url: "https://example.org/x", published_at: "2026-10-24" });
    applyModelUpdate(t, c, { index: 0, add_entry: true, entry: "First", patch_status: "keep", fixed_in: [], action: "" }, NOW);
    applyModelUpdate(t, c, { index: 0, add_entry: true, entry: "Second", patch_status: "keep", fixed_in: [], action: "" }, NOW);
    expect(t.timeline.filter((e) => e.source_url === c.url).map((e) => e.title)).toEqual(["Second"]);
    // a legacy record renders the merged source as a seeded entry; the update replaces its headline wording
    const legacy = legacyIncident({ first_reported: "2026-10-20" });
    const m = merge(legacy);
    const full = withLifecycle(legacy, "2026-10-25");
    expect(full.timeline.map((e) => e.title)).toContain(m.candidate.title);
    const r = applyModelUpdate(full, m.candidate, { index: 0, add_entry: true, entry: "Vendor ships a fix", patch_status: "keep", fixed_in: [], action: "" }, NOW);
    expect(r.entry).toBe(true);
    expect(full.timeline).toHaveLength(2);
    expect(full.timeline.at(-1)!.title).toBe("Vendor ships a fix");
  });
});

describe("structuredUpdate", () => {
  const kev = kevEntryToCandidate(
    {
      cveID: "CVE-2026-61882",
      vendorProject: "Oracle",
      product: "E-Business Suite",
      vulnerabilityName: "Oracle E-Business Suite Unspecified Vulnerability",
      dateAdded: "2026-10-23",
      shortDescription: "Oracle E-Business Suite contains an unspecified vulnerability.",
      requiredAction: "Apply updates per vendor instructions.",
      dueDate: "2026-11-13",
      knownRansomwareCampaignUse: "Known",
    },
    { sourceId: "kev", hintMaxChars: 600, discoveredAt: NOW },
  );

  it("KEV: raises severity to 3, leaves research, sets the fix status from the required action, tags, enters and reopens", () => {
    const t = withLifecycle(incident({ severity: 2, lane: "research", patch_status: "unknown", first_reported: "2026-09-01", state: "closed", closed_at: "2026-09-15", cve_ids: ["CVE-2026-61882"] }), "2026-10-25");
    const r = structuredUpdate(t, kev, NOW);
    expect(r).toEqual({ applied: true, reopened: true, entry: true });
    expect(t.severity).toBe(3);
    expect(t.lane).toBe("patch");
    expect(t.patch_status).toBe("patched");
    expect(t.tags).toContain("cisa-kev");
    expect(t.timeline.at(-1)!.title).toBe("Added to the CISA KEV catalog (exploitation confirmed)");
    expect(t.timeline.at(-1)!.source_url).toBe(kev.url);
    expect(t.state).toBe("live");
    expect(kev.extra).toMatchObject({ kev: true, required_action: "Apply updates per vendor instructions.", due_date: "2026-11-13", ransomware: true, vendor: "Oracle", product: "E-Business Suite" });
  });

  it("KEV: mitigations mean partial, and patched is never downgraded", () => {
    const partial = { ...kev, extra: { ...kev.extra, required_action: "Apply mitigations per vendor instructions, follow applicable BOD 22-01 guidance for cloud services, or discontinue use of the product if mitigations are unavailable." } };
    const t = withLifecycle(incident({ severity: 3, patch_status: "unknown" }), "2026-10-25");
    structuredUpdate(t, partial, NOW);
    expect(t.patch_status).toBe("partial");
    const p = withLifecycle(incident({ severity: 3, patch_status: "patched" }), "2026-10-25");
    structuredUpdate(p, partial, NOW);
    expect(p.patch_status).toBe("patched");
  });

  it("GHSA: fills versions, the fix status and the score only where the record has none", () => {
    const ghsa = candidate({
      title: "CVE-2026-1: vLLM flaw",
      url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
      publisher: "GitHub Advisory Database",
      origin: "seed_ghsa",
      published_at: "2026-10-22",
      cve_ids: ["CVE-2026-1"],
      extra: { cvss: 8.1, vulnerabilities: [{ package: "vllm", ecosystem: "pip", range: "< 0.9.1", first_patched: "0.9.1" }] },
    });
    const t = withLifecycle(incident({ patch_status: "unknown", cvss: null }), "2026-10-25");
    const r = structuredUpdate(t, ghsa, NOW);
    expect(r?.applied).toBe(true);
    expect(t.affected).toEqual(["vllm < 0.9.1"]);
    expect(t.fixed_in).toEqual(["vllm 0.9.1"]);
    expect(t.patch_status).toBe("patched");
    expect(t.cvss).toBe(8.1);
    expect(t.timeline.at(-1)!.title).toBe("GitHub advisory published");
    const kept = withLifecycle(incident({ patch_status: "partial", cvss: 5, affected: ["x 1"], fixed_in: ["x 2"] }), "2026-10-25");
    structuredUpdate(kept, ghsa, NOW);
    expect(kept.patch_status).toBe("partial");
    expect(kept.cvss).toBe(5);
    expect(kept.affected).toEqual(["x 1"]);
  });

  it("NVD: the score and an entry; a news candidate is not structured", () => {
    const nvd = candidate({ title: "CVE-2026-2: x", url: "https://nvd.nist.gov/vuln/detail/CVE-2026-2", publisher: "NVD", origin: "seed_nvd", published_at: "2026-10-22", cve_ids: ["CVE-2026-2"], extra: { cvss: 7.5, kev: false } });
    const t = withLifecycle(incident({ cvss: null }), "2026-10-25");
    expect(structuredUpdate(t, nvd, NOW)?.applied).toBe(true);
    expect(t.cvss).toBe(7.5);
    expect(t.timeline.at(-1)!.title).toBe("NVD record published");
    expect(structuredUpdate(t, candidate({ title: "news", url: "https://example.org/n" }), NOW)).toBeNull();
  });
});

describe("applyUpdates", () => {
  it("persists the complete lifecycle form on a legacy record through the model answer", async () => {
    const target = legacyIncident({ first_reported: "2026-10-20" });
    const m = merge(target);
    const calls = { n: 0 };
    const router = fakeRouter([{ index: 0, add_entry: true, entry: "Vendor ships a fix", patch_status: "patched", fixed_in: ["Example 2.0"], action: "Update to 2.0." }], calls);
    const out = await applyUpdates([m], router, settings, NOW);
    expect(calls.n).toBe(1);
    expect(out).toMatchObject({ updated: 1, reopened: 0, entries: 1, byModel: 1, fallback: 0, structured: 0, errors: [] });
    expect(target.lane).toBe("patch");
    expect(target.state).toBe("live");
    expect(target.patch_status).toBe("patched");
    expect(target.fixed_in).toEqual(["Example 2.0"]);
    expect(target.timeline).toHaveLength(2);
    expect(target.updated_at).toBe(NOW);
    expect(IncidentSchema.safeParse(target).success).toBe(true);
  });

  it("falls back to the report title when no model is available and still reopens", async () => {
    const target = incident({ first_reported: "2026-09-20", state: "closed", closed_at: "2026-10-04" });
    const m = merge(target);
    const out = await applyUpdates([m], fakeRouter(null), settings, NOW);
    expect(out).toMatchObject({ updated: 1, reopened: 1, fallback: 1, byModel: 0 });
    expect(target.timeline.at(-1)!.title).toBe("Vendor ships a fix for the exploited flaw");
    expect(target.state).toBe("live");
    expect(target.patch_status).toBe("unknown"); // no field changes without the model
    expect(fallbackEntry(m.candidate, NOW).source_url).toBe(m.candidate.url);
  });

  it("rolls the record back when the result would not validate", async () => {
    const target = incident();
    const before = structuredClone(target);
    const m = merge(target);
    const tooMany = Array.from({ length: 200 }, (_, i) => ({ date: "2026-10-01", title: `e${i}`, added_at: NOW }));
    target.timeline = tooMany; // one more entry breaks the 200 cap
    const out = await applyUpdates([m], fakeRouter([{ index: 0, add_entry: true, entry: "Entry 201", patch_status: "keep", fixed_in: [], action: "" }]), settings, NOW);
    expect(out.updated).toBe(0);
    expect(out.errors[0]).toMatch(/rolled back/);
    expect(target.timeline).toHaveLength(200);
    expect(target.title).toBe(before.title);
  });

  it("applies structured merges without the model and batches the rest", async () => {
    const a = incident({ cvss: null, first_reported: "2026-10-20" });
    const nvd = candidate({ title: "CVE-2026-3: x", url: "https://nvd.nist.gov/vuln/detail/CVE-2026-3", publisher: "NVD", origin: "seed_nvd", published_at: "2026-10-22", cve_ids: ["CVE-2026-3"], extra: { cvss: 6.5 } });
    const b = incident({ first_reported: "2026-10-20" });
    const calls = { n: 0 };
    const router = fakeRouter([{ index: 0, add_entry: false, entry: "", patch_status: "keep", fixed_in: [], action: "" }], calls);
    const out = await applyUpdates([merge(a, nvd), merge(b)], router, settings, NOW);
    expect(calls.n).toBe(1);
    expect(out.structured).toBe(1);
    expect(out.updated).toBe(1);
    expect(a.cvss).toBe(6.5);
    expect(b.timeline).toHaveLength(1); // nothing to say, nothing written
    expect(b.updated_at).not.toBe(NOW);
  });
});

describe("closeRecords", () => {
  it("closes live records past their window, leaves live ones and already-closed ones alone, and persists the date", () => {
    const stale = incident({ first_reported: "2026-09-01", state: "live", closed_at: null, patch_status: "patched" });
    const fresh = incident({ first_reported: "2026-10-20", state: "live", closed_at: null });
    const unpatched = incident({ first_reported: "2026-09-01", state: "live", closed_at: null, patch_status: "unpatched" });
    const done = incident({ first_reported: "2026-09-01", state: "closed", closed_at: "2026-09-15" });
    const legacy = legacyIncident({ first_reported: "2026-06-01" });
    const r = closeRecords([stale, fresh, unpatched, done, legacy], NOW);
    expect(r.ids.sort()).toEqual([legacy.id, stale.id].sort());
    expect(stale.state).toBe("closed");
    expect(stale.closed_at).toBe("2026-09-15");
    expect(stale.updated_at).toBe(NOW);
    expect(fresh.state).toBe("live");
    expect(unpatched.state).toBe("live"); // 60-day window while unpatched
    expect(done.updated_at).not.toBe(NOW);
    expect(IncidentSchema.safeParse(legacy).success).toBe(true);
  });
});
