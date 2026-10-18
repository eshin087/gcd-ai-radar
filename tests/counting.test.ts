import { describe, expect, it } from "vitest";
import { isDisclosedVuln } from "../lib/counting";

describe("isDisclosedVuln", () => {
  it("treats an unexploited NVD or GHSA record as a disclosed vulnerability", () => {
    expect(isDisclosedVuln({ origin: "seed_nvd", severity: 2, publishers: ["NVD"] })).toBe(true);
    expect(isDisclosedVuln({ origin: "seed_ghsa", severity: 2, publishers: ["GitHub Advisory Database", "NVD"] })).toBe(true);
  });

  it("counts an exploited CVE as an incident", () => {
    expect(isDisclosedVuln({ origin: "seed_nvd", severity: 3, publishers: ["NVD"] })).toBe(false);
    expect(isDisclosedVuln({ origin: "seed_ghsa", severity: 4, publishers: ["GitHub Advisory Database"] })).toBe(false);
  });

  it("treats a news record sourced only from vulnerability databases as disclosed", () => {
    expect(isDisclosedVuln({ origin: "news", severity: 2, publishers: ["MSRC"] })).toBe(true);
  });

  it("keeps reported events and research as incidents", () => {
    expect(isDisclosedVuln({ origin: "news", severity: 2, publishers: ["Embrace The Red"] })).toBe(false);
    expect(isDisclosedVuln({ origin: "news", severity: 2, publishers: ["MSRC", "Dark Reading"] })).toBe(false);
    expect(isDisclosedVuln({ origin: "seed_aiid", severity: 2, publishers: ["AI Incident Database"] })).toBe(false);
    expect(isDisclosedVuln({ origin: "seed_atlas", severity: 1, publishers: ["MITRE ATLAS"] })).toBe(false);
  });

  it("does not treat a record with no sources as disclosed", () => {
    expect(isDisclosedVuln({ origin: "news", severity: 2, publishers: [] })).toBe(false);
  });
});
