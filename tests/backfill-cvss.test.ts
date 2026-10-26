import { describe, expect, it } from "vitest";
import { fillRecords, isCandidate, pickScore, roundScore, scoreFromAdvisory, scoreFromNvd, type AdvisoryWithScores, type NvdResponse, type ScoreTable } from "@/scripts/backfill-cvss";
import { incident, legacyIncident } from "./fixtures";

/**
 * Payloads recorded on 2026-10-26 (trimmed to the fields the picker reads):
 * `GET https://api.github.com/advisories?cve_id=CVE-2024-3400&per_page=1`
 * and `GET https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2024-3400`.
 * The two sources disagree on this CVE (GitHub 9.8, NVD 10.0), which is why
 * the picker is tested on both.
 */
const GHSA_2024_3400: AdvisoryWithScores = {
  ghsa_id: "GHSA-v475-xhc9-wfxg",
  cve_id: "CVE-2024-3400",
  html_url: "https://github.com/advisories/GHSA-v475-xhc9-wfxg",
  summary: "Palo Alto Networks PAN-OS command injection",
  description: null,
  severity: "critical",
  type: "unreviewed",
  published_at: "2024-04-12T09:30:50Z",
  cvss: { vector_string: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", score: 9.8 },
  cvss_severities: {
    cvss_v3: { vector_string: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", score: 9.8 },
    cvss_v4: { vector_string: null, score: 0 },
  },
  vulnerabilities: [{ package: { ecosystem: "other", name: "paloaltonetworks/pan-os" }, vulnerable_version_range: ">= 10.2.0, < 10.2.9-h1", first_patched_version: "10.2.9-h1" }],
};

const NVD_2024_3400: NvdResponse = {
  totalResults: 1,
  vulnerabilities: [
    {
      cve: {
        id: "CVE-2024-3400",
        vulnStatus: "Analyzed",
        metrics: {
          cvssMetricV31: [
            { source: "psirt@paloaltonetworks.com", type: "Secondary", cvssData: { version: "3.1", vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", baseScore: 10, baseSeverity: "CRITICAL" } },
            { source: "nvd@nist.gov", type: "Primary", cvssData: { version: "3.1", vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", baseScore: 10, baseSeverity: "CRITICAL" } },
          ],
          ssvcV203: [{ source: "134c704f-9b21-4f2e-91b3-4a467353bcc0" }],
        },
      },
    },
  ],
};

/** `cveId=CVE-2026-103572`, recorded the same day: one vendor (secondary) v3.1 metric, no NVD primary yet. */
const NVD_2026_103572: NvdResponse = {
  totalResults: 1,
  vulnerabilities: [{ cve: { id: "CVE-2026-103572", vulnStatus: "Awaiting Analysis", metrics: { cvssMetricV31: [{ source: "secure@microsoft.com", type: "Secondary", cvssData: { version: "3.1", vectorString: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", baseScore: 8.8 } }] } } }],
};

describe("scoreFromAdvisory", () => {
  it("reads the v3 score and ignores GitHub's empty v4 placeholder (score 0, no vector)", () => {
    expect(scoreFromAdvisory(GHSA_2024_3400)).toBe(9.8);
  });

  it("takes the higher of v3 and v4 when both are scored", () => {
    const adv: AdvisoryWithScores = {
      ...GHSA_2024_3400,
      cvss_severities: {
        cvss_v3: { vector_string: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N", score: 6.5 },
        cvss_v4: { vector_string: "CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N", score: 7.1 },
      },
      cvss: { vector_string: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N", score: 6.5 },
    };
    expect(scoreFromAdvisory(adv)).toBe(7.1);
  });

  it("falls back to the legacy cvss field and reports null when nothing is scored", () => {
    const legacyOnly: AdvisoryWithScores = { ...GHSA_2024_3400, cvss_severities: undefined, cvss: { vector_string: "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N", score: 3.3 } };
    expect(scoreFromAdvisory(legacyOnly)).toBe(3.3);
    const unscored: AdvisoryWithScores = { ...GHSA_2024_3400, cvss_severities: { cvss_v3: { vector_string: null, score: 0 }, cvss_v4: { vector_string: null, score: 0 } }, cvss: { vector_string: null, score: null } };
    expect(scoreFromAdvisory(unscored)).toBeNull();
    expect(scoreFromAdvisory(null)).toBeNull();
  });
});

/** `cveId=CVE-2026-55611`, recorded the same day: the only metric is a genuine 0.0 (no impact at all), which is a score, not an absence. */
const NVD_2026_55611: NvdResponse = {
  totalResults: 1,
  vulnerabilities: [
    {
      cve: {
        id: "CVE-2026-55611",
        vulnStatus: "Deferred",
        metrics: {
          cvssMetricV31: [{ source: "security-advisories@github.com", type: "Secondary", cvssData: { version: "3.1", vectorString: "CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:N/A:N", baseScore: 0, baseSeverity: "NONE" } }],
          ssvcV203: [{ source: "134c704f-9b21-4f2e-91b3-4a467353bcc0" }],
        },
      },
    },
  ],
};

describe("scoreFromNvd", () => {
  it("reads the CVSS 3.1 base score, across primary and secondary metrics", () => {
    expect(scoreFromNvd(NVD_2024_3400)).toBe(10);
    expect(scoreFromNvd(NVD_2026_103572)).toBe(8.8);
  });

  it("keeps a real 0.0 (vector present) and drops a score without a vector string", () => {
    expect(scoreFromNvd(NVD_2026_55611)).toBe(0);
    const placeholder: NvdResponse = { totalResults: 1, vulnerabilities: [{ cve: { id: "CVE-2026-3", metrics: { cvssMetricV31: [{ cvssData: { version: "3.1", baseScore: 0 } }] } } }] };
    expect(scoreFromNvd(placeholder)).toBeNull();
  });

  it("prefers the higher of v4.0 and v3.1 when NVD carries both, and ignores v2 and SSVC", () => {
    const both: NvdResponse = {
      totalResults: 1,
      vulnerabilities: [
        {
          cve: {
            id: "CVE-2026-1",
            metrics: {
              cvssMetricV40: [{ source: "nvd@nist.gov", type: "Primary", cvssData: { version: "4.0", vectorString: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N", baseScore: 9.3 } }],
              cvssMetricV31: [{ source: "nvd@nist.gov", type: "Primary", cvssData: { version: "3.1", vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", baseScore: 9.8 } }],
              cvssMetricV2: [{ source: "nvd@nist.gov", type: "Primary", cvssData: { version: "2.0", vectorString: "AV:N/AC:L/Au:N/C:C/I:C/A:C", baseScore: 10 } }],
            },
          },
        },
      ],
    };
    expect(scoreFromNvd(both)).toBe(9.8);
    const v4Only: NvdResponse = { totalResults: 1, vulnerabilities: [{ cve: { id: "CVE-2026-2", metrics: { cvssMetricV40: [{ cvssData: { version: "4.0", vectorString: "CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N", baseScore: 8.7 } }] } } }] };
    expect(scoreFromNvd(v4Only)).toBe(8.7);
  });

  it("is null for an unknown id, a rejected record without metrics, or no metrics at all", () => {
    expect(scoreFromNvd({ totalResults: 0, vulnerabilities: [] })).toBeNull();
    expect(scoreFromNvd({ totalResults: 1, vulnerabilities: [{ cve: { id: "CVE-2020-1", vulnStatus: "Rejected" } }] })).toBeNull();
    expect(scoreFromNvd({ totalResults: 1, vulnerabilities: [{ cve: { id: "CVE-2020-2", metrics: { ssvcV203: [{ source: "x" }] } } }] })).toBeNull();
    expect(scoreFromNvd(null)).toBeNull();
  });
});

describe("pickScore", () => {
  it("keeps the highest valid score with one decimal and drops nulls and out-of-range values", () => {
    expect(pickScore([7.5, null, undefined, 0, 9.8])).toBe(9.8);
    expect(pickScore([7.55])).toBe(7.6);
    expect(pickScore([0, null])).toBe(0);
    expect(pickScore([11, -1, null])).toBeNull();
    expect(pickScore([])).toBeNull();
    expect(roundScore(9.84)).toBe(9.8);
  });
});

describe("fillRecords", () => {
  it("writes cvss only, takes the highest score across a record's CVEs, and leaves updated_at alone", () => {
    const two = incident({ cve_ids: ["CVE-2026-1000", "CVE-2026-1001"], cvss: null, updated_at: "2026-10-01T00:00:00.000Z" });
    const one = legacyIncident({ tags: [], cve_ids: ["CVE-2026-1002"] } as never);
    const scored = incident({ cve_ids: ["CVE-2026-1000"], cvss: 5.5 });
    const noCve = incident({ cve_ids: [], cvss: null });
    const unknown = incident({ cve_ids: ["CVE-2026-9999"], cvss: null });
    const scores: ScoreTable = new Map([
      ["CVE-2026-1000", { ghsa: 7.5, nvd: null }],
      ["CVE-2026-1001", { ghsa: null, nvd: 9.1 }],
      ["CVE-2026-1002", { ghsa: null, nvd: 4.3 }],
      ["CVE-2026-9999", { ghsa: null, nvd: null }],
    ]);
    const before = JSON.stringify([scored, noCve]);
    const report = fillRecords([two, one, scored, noCve, unknown], scores);
    expect(two.cvss).toBe(9.1);
    expect(two.updated_at).toBe("2026-10-01T00:00:00.000Z");
    expect(one.cvss).toBe(4.3);
    expect(Object.keys(one)).not.toContain("lane"); // a legacy record gains nothing but cvss
    expect(scored.cvss).toBe(5.5);
    expect(unknown.cvss).toBeNull();
    expect(JSON.stringify([scored, noCve])).toBe(before);
    expect(report).toMatchObject({ records: 5, with_cves: 4, candidates: 3, filled: 2, unscored: [unknown.id], by_source: { ghsa: 0, nvd: 1, both: 1 } });
  });

  it("is idempotent: a second pass finds no candidate and changes nothing", () => {
    const r = incident({ cve_ids: ["CVE-2026-1000"], cvss: null });
    const scores: ScoreTable = new Map([["CVE-2026-1000", { ghsa: 7.5, nvd: null }]]);
    fillRecords([r], scores);
    expect(isCandidate(r)).toBe(false);
    const snapshot = JSON.stringify(r);
    const second = fillRecords([r], scores);
    expect(JSON.stringify(r)).toBe(snapshot);
    expect(second).toMatchObject({ candidates: 0, filled: 0, unscored: [] });
  });
});
