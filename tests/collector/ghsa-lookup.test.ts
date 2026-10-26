import { describe, expect, it } from "vitest";
import { SettingsSchema, type Settings } from "@/collector/lib/config";
import { emptyCollectorState } from "@/collector/lib/state";
import { applyAdvisoryVersions, enrichVersions, lookupCandidates } from "@/collector/pipeline/ghsa-lookup";
import type { Advisory } from "@/collector/sources/ghsa";
import { IncidentSchema } from "@/lib/schema";
import settingsJson from "@/collector/config/settings.json";
import { incident, legacyIncident } from "../fixtures";

const settings: Settings = SettingsSchema.parse(settingsJson);
const NOW = "2026-10-25T12:00:00.000Z";

const advisory: Advisory = {
  ghsa_id: "GHSA-aaaa-bbbb-cccc",
  cve_id: "CVE-2026-61882",
  html_url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  summary: "Oracle EBS flaw",
  description: null,
  severity: "critical",
  published_at: "2026-10-20T00:00:00Z",
  cvss: { score: 9.8 },
  vulnerabilities: [{ package: { ecosystem: "other", name: "oracle-ebs" }, vulnerable_version_range: ">= 12.2.3, < 12.2.14", first_patched_version: "12.2.14" }],
};

describe("lookupCandidates", () => {
  it("picks live patch and supply-chain records with a CVE and no fixed version, within the per-run cap", () => {
    const wants = incident({ lane: "patch", cve_ids: ["CVE-2026-1001"], fixed_in: [], first_reported: "2026-10-20" });
    const hasFix = incident({ lane: "patch", cve_ids: ["CVE-2026-1002"], fixed_in: ["x 1"], first_reported: "2026-10-20" });
    const breach = incident({ lane: "breach", cve_ids: ["CVE-2026-1003"], first_reported: "2026-10-20" });
    const closed = incident({ lane: "patch", cve_ids: ["CVE-2026-1004"], first_reported: "2026-09-01", state: "closed", closed_at: "2026-09-15" });
    const noCve = incident({ lane: "supply_chain", cve_ids: [], first_reported: "2026-10-20" });
    const legacy = legacyIncident({ first_reported: "2026-10-20", tags: ["CVE-2026-1005"] }); // cve read from tags
    const out = lookupCandidates([wants, hasFix, breach, closed, noCve, legacy], emptyCollectorState(), settings, NOW);
    expect(out.map((x) => [x.record.id, x.cve])).toEqual([
      [wants.id, "CVE-2026-1001"],
      [legacy.id, "CVE-2026-1005"],
    ]);
    const capped = lookupCandidates([wants, legacy], emptyCollectorState(), { ...settings, ghsa_lookup: { per_run: 1, recheck_days: 7 } }, NOW);
    expect(capped).toHaveLength(1);
  });

  it("asks a negative again only after recheck_days and never asks a positive again", () => {
    const r = incident({ lane: "patch", cve_ids: ["CVE-2026-1001"], fixed_in: [], first_reported: "2026-10-20" });
    const cache = emptyCollectorState();
    cache.cve_lookups["CVE-2026-1001"] = { at: "2026-10-22T00:00:00.000Z", found: false };
    expect(lookupCandidates([r], cache, settings, NOW)).toHaveLength(0);
    cache.cve_lookups["CVE-2026-1001"] = { at: "2026-10-10T00:00:00.000Z", found: false };
    expect(lookupCandidates([r], cache, settings, NOW)).toHaveLength(1);
    cache.cve_lookups["CVE-2026-1001"] = { at: "2026-09-01T00:00:00.000Z", found: true };
    expect(lookupCandidates([r], cache, settings, NOW)).toHaveLength(0);
  });
});

describe("applyAdvisoryVersions", () => {
  it("fills versions, the fix status and the score where the record has none, in the complete form", () => {
    const r = legacyIncident({ first_reported: "2026-10-20", tags: ["CVE-2026-61882"] });
    expect(applyAdvisoryVersions(r, advisory, NOW)).toBe(true);
    expect(r.affected).toEqual(["oracle-ebs >= 12.2.3, < 12.2.14"]);
    expect(r.fixed_in).toEqual(["oracle-ebs 12.2.14"]);
    expect(r.patch_status).toBe("patched");
    expect(r.cvss).toBe(9.8);
    expect(r.lane).toBe("patch");
    expect(r.updated_at).toBe(NOW);
    expect(IncidentSchema.safeParse(r).success).toBe(true);
    const kept = incident({ affected: ["a 1"], fixed_in: ["a 2"], patch_status: "partial", cvss: 5 });
    expect(applyAdvisoryVersions(kept, advisory, NOW)).toBe(false);
    expect(kept.patch_status).toBe("partial");
  });
});

describe("enrichVersions", () => {
  it("looks up, remembers, applies, and stops at the first fetch error", async () => {
    const a = incident({ lane: "patch", cve_ids: ["CVE-2026-61882"], fixed_in: [], first_reported: "2026-10-20", patch_status: "unknown", cvss: null });
    const b = incident({ lane: "patch", cve_ids: ["CVE-2026-9"], fixed_in: [], first_reported: "2026-10-20" });
    const c = incident({ lane: "patch", cve_ids: ["CVE-2026-10"], fixed_in: [], first_reported: "2026-10-20" });
    const cache = emptyCollectorState();
    const asked: string[] = [];
    const out = await enrichVersions([a, b, c], cache, settings, NOW, async (cve) => {
      asked.push(cve);
      if (cve === "CVE-2026-61882") return advisory;
      if (cve === "CVE-2026-9") return null;
      throw new Error("rate limited");
    });
    expect(asked).toEqual(["CVE-2026-61882", "CVE-2026-9", "CVE-2026-10"]);
    expect(out.looked_up).toBe(3);
    expect(out.enriched).toEqual([a.id]);
    expect(out.errors).toHaveLength(1);
    expect(cache.cve_lookups["CVE-2026-61882"]).toEqual({ at: NOW, found: true });
    expect(cache.cve_lookups["CVE-2026-9"]).toEqual({ at: NOW, found: false });
    expect(cache.cve_lookups["CVE-2026-10"]).toBeUndefined(); // the failed one is asked again next run
    expect(a.fixed_in).toEqual(["oracle-ebs 12.2.14"]);
  });

  it("does nothing when the per-run budget is zero", async () => {
    const a = incident({ lane: "patch", cve_ids: ["CVE-2026-61882"], fixed_in: [], first_reported: "2026-10-20" });
    const out = await enrichVersions([a], emptyCollectorState(), { ...settings, ghsa_lookup: { per_run: 0, recheck_days: 7 } }, NOW, async () => advisory);
    expect(out.looked_up).toBe(0);
  });
});
