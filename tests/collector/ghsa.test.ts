import { describe, expect, it } from "vitest";
import { urlKey } from "../../collector/lib/canonical";
import { advisoryToCandidate, type Advisory } from "../../collector/sources/ghsa";
import { CandidateSchema } from "../../collector/sources/types";

const OPTS = { sourceId: "ghsa", ecosystem: "pip", hintMaxChars: 600, discoveredAt: "2026-10-25T12:00:00.000Z" };

const ADVISORY: Advisory = {
  ghsa_id: "GHSA-xxxx-yyyy-zzzz",
  cve_id: "CVE-2026-12345",
  html_url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
  summary: "Prompt injection via tool descriptions in LangChain agents",
  description: "An attacker controlling a tool description can inject instructions that the agent executes.",
  severity: "high",
  type: "reviewed",
  published_at: "2026-10-20T14:03:11Z",
  cvss: { score: 8.1, vector_string: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H" },
  vulnerabilities: [
    { package: { ecosystem: "pip", name: "langchain" }, vulnerable_version_range: "< 0.3.30", first_patched_version: "0.3.30" },
    { package: { ecosystem: "pip", name: "langchain-core" }, vulnerable_version_range: ">= 0.3.0, < 0.3.80", first_patched_version: "0.3.80" },
    { package: { ecosystem: "npm", name: "langchain" }, vulnerable_version_range: "< 0.3.40", first_patched_version: null },
  ],
};

describe("advisoryToCandidate", () => {
  it("maps the advisory fields and produces a valid Candidate", () => {
    const c = advisoryToCandidate(ADVISORY, OPTS);
    expect(CandidateSchema.safeParse(c).success).toBe(true);
    expect(c.key).toBe(urlKey(ADVISORY.html_url));
    expect(c.source_id).toBe("ghsa");
    expect(c.origin).toBe("seed_ghsa");
    expect(c.url).toBe(ADVISORY.html_url);
    expect(c.title).toBe("CVE-2026-12345: Prompt injection via tool descriptions in LangChain agents");
    expect(c.published_at).toBe("2026-10-20");
    expect(c.publisher).toBe("GitHub Advisory Database");
    expect(c.cve_ids).toEqual(["CVE-2026-12345"]);
    expect(c.discovered_at).toBe(OPTS.discoveredAt);
  });

  it("builds the hint from description, severity and the first affected packages", () => {
    const c = advisoryToCandidate(ADVISORY, OPTS);
    expect(c.hint).toContain("An attacker controlling a tool description");
    expect(c.hint).toContain("Severity high.");
    expect(c.hint).toContain("Affects langchain < 0.3.30; langchain-core >= 0.3.0, < 0.3.80; langchain < 0.3.40.");
    expect(c.hint).not.toContain("Malware advisory");
  });

  it("carries the structured extras: classifier hint, ids, vulnerabilities and CVSS", () => {
    const c = advisoryToCandidate(ADVISORY, OPTS);
    expect(c.extra).toMatchObject({ ghsa_id: "GHSA-xxxx-yyyy-zzzz", severity: "high", ecosystem: "pip", incident_date: "2026-10-20", cvss: 8.1 });
    expect(typeof c.extra?.classifier_hint).toBe("string");
    expect(c.extra?.vulnerabilities).toEqual([
      { package: "langchain", ecosystem: "pip", range: "< 0.3.30", first_patched: "0.3.30" },
      { package: "langchain-core", ecosystem: "pip", range: ">= 0.3.0, < 0.3.80", first_patched: "0.3.80" },
      { package: "langchain", ecosystem: "npm", range: "< 0.3.40", first_patched: null },
    ]);
  });

  it("caps extra.vulnerabilities at 10 while the hint still lists only the first four", () => {
    const many: Advisory = {
      ...ADVISORY,
      vulnerabilities: Array.from({ length: 14 }, (_, i) => ({ package: { ecosystem: "pip", name: `pkg${i}` }, vulnerable_version_range: `< ${i}.0`, first_patched_version: `${i}.0` })),
    };
    const c = advisoryToCandidate(many, OPTS);
    const vulns = c.extra?.vulnerabilities as { package: string }[];
    expect(vulns).toHaveLength(10);
    expect(vulns[0]!.package).toBe("pkg0");
    expect(vulns[9]!.package).toBe("pkg9");
    expect(c.hint).toContain("pkg3 < 3.0.");
    expect(c.hint).not.toContain("pkg4");
  });

  it("falls back to the GHSA id, the summary and the query ecosystem when CVE, description, CVSS and packages are missing", () => {
    const sparse: Advisory = {
      ghsa_id: "GHSA-aaaa-bbbb-cccc",
      cve_id: null,
      html_url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
      summary: "Path traversal in model loader",
      description: null,
      severity: "medium",
      published_at: "2026-09-01T00:00:00Z",
    };
    const c = advisoryToCandidate(sparse, OPTS);
    expect(CandidateSchema.safeParse(c).success).toBe(true);
    expect(c.title).toBe("GHSA-aaaa-bbbb-cccc: Path traversal in model loader");
    expect(c.cve_ids).toEqual([]);
    expect(c.hint).toBe("Path traversal in model loader Severity medium. Affects pip.");
    expect(c.extra).toMatchObject({ cvss: null, vulnerabilities: [] });
    expect(advisoryToCandidate({ ...sparse, cvss: { score: null } }, OPTS).extra?.cvss).toBeNull();
  });

  it("truncates long hints to hintMaxChars and the title's summary to 140 chars", () => {
    const long: Advisory = { ...ADVISORY, summary: "x".repeat(300), description: "y".repeat(2000) };
    const c = advisoryToCandidate(long, { ...OPTS, hintMaxChars: 200 });
    // truncate() cuts at max and appends an ellipsis, so the bound is max + 1
    expect(c.hint.length).toBeLessThanOrEqual(201);
    expect(c.hint.endsWith("…")).toBe(true);
    expect(c.title.length).toBeLessThanOrEqual("CVE-2026-12345: ".length + 141);
    expect(CandidateSchema.safeParse(c).success).toBe(true);
  });
});
