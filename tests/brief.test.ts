import { describe, expect, it } from "vitest";
import { buildBrief } from "@/lib/brief";
import { incident } from "./fixtures";

const SITE = "https://example.test";

describe("buildBrief", () => {
  it("writes every section from the record, in plain Markdown", () => {
    const i = incident({
      slug: "php2shell-rce",
      title: "PHP2Shell: critical unauthenticated RCE in PHP core",
      lane: "patch",
      state: "live",
      severity: 3,
      severity_note: "Exploitation attempts observed before and after the patch.",
      patch_status: "partial",
      cve_ids: ["CVE-2026-109619", "CVE-2026-109618"],
      cvss: 9.2,
      affected: ["PHP < 8.4.9"],
      fixed_in: ["PHP 8.4.9"],
      action: "Update PHP and appliance firmware; check for webshells.",
      timeline: [
        { date: "2026-10-17", title: "Embargo leak", source_url: "https://example.org/leak", added_at: "2026-10-17T00:00:00.000Z" },
        { date: "2026-10-21", title: "Patches shipped", added_at: "2026-10-21T00:00:00.000Z" },
      ],
      first_reported: "2026-10-17",
      incident_date: "2026-10-17",
    });
    const brief = buildBrief(i, SITE);
    expect(brief.startsWith("# PHP2Shell: critical unauthenticated RCE in PHP core\n")).toBe(true);
    expect(brief).toContain(`${SITE}/incidents/php2shell-rce`);
    expect(brief).toContain("- Lane: Patch now");
    expect(brief).toContain("- Severity: 3 (Confirmed exploitation): Exploitation attempts observed before and after the patch.");
    expect(brief).toContain("- Fix status: Partly patched");
    expect(brief).toContain("- CVE ids: CVE-2026-109619, CVE-2026-109618");
    expect(brief).toContain("- CVSS: 9.2");
    expect(brief).toContain("## What to do\n\nUpdate PHP and appliance firmware; check for webshells.");
    expect(brief).toContain("- Affected: PHP < 8.4.9\n- Fixed in: PHP 8.4.9");
    expect(brief).toContain("## Latest updates\n\n- 2026-10-21: Patches shipped\n- 2026-10-17: Embargo leak (https://example.org/leak)");
    expect(brief).toContain("## Sources\n\n- 2026-10-17 Example News:");
    expect(brief.trim().endsWith(`Verify against the vendor's advisory before changing production. Data CC BY-SA 4.0, ${SITE}.`)).toBe(true);
    expect(brief).not.toContain("undefined");
    expect(brief).not.toMatch(/<[a-z]/);
  });

  it("says when nothing is known rather than leaving blanks", () => {
    const brief = buildBrief(incident({ action: "", severity_note: "", affected: [], fixed_in: [], cve_ids: [], cvss: null, state: "closed", closed_at: "2026-10-24" }), SITE);
    expect(brief).toContain("closed 2026-10-24");
    expect(brief).toContain("No action recorded; read the sources below and the vendor's advisory.");
    expect(brief).not.toContain("- CVE ids:");
    expect(brief).not.toContain("- CVSS:");
    expect(brief).not.toContain("## Affected and fixed versions");
    expect(brief).not.toContain("undefined");
  });
});
