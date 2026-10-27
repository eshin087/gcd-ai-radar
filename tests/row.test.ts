import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IncidentRow } from "@/components/incidents/IncidentRow";
import { RowLegend } from "@/components/incidents/RowLegend";
import { CvssChip, LaneBadge, SeverityWord } from "@/components/ui/Badge";
import { rowOf, rowOfSlim } from "@/lib/live";
import { LANE_COLORS } from "@/lib/palette";
import { compactRow } from "@/lib/rows";
import { slim } from "@/lib/slim";
import { LANES, SEVERITY_META } from "@/lib/taxonomy";
import { incident } from "./fixtures";

/**
 * The row's hierarchy, rendered to static markup: the CVSS chip appears only
 * for a score and wears its band, the severity is a word and never a digit,
 * the lane carries its colour, and every data attribute scripts/check-live.mjs
 * reads is still there. No record carries a score yet in most shards, so the
 * cases here are fixtures with scores.
 */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("CvssChip", () => {
  it("draws a filled chip per band and nothing for a missing score", () => {
    expect(html(createElement(CvssChip, { score: 9.8 }))).toContain('data-cvss-band="critical"');
    expect(html(createElement(CvssChip, { score: 9.8 }))).toContain(">9.8<");
    expect(html(createElement(CvssChip, { score: 7 }))).toContain('data-cvss-band="high"');
    expect(html(createElement(CvssChip, { score: 7 }))).toContain(">7.0<");
    expect(html(createElement(CvssChip, { score: 5.3 }))).toContain('data-cvss-band="medium"');
    expect(html(createElement(CvssChip, { score: 2.1 }))).toContain('data-cvss-band="low"');
    expect(html(createElement(CvssChip, { score: null }))).toBe("");
    expect(html(createElement(CvssChip, { score: undefined }))).toBe("");
    // the version goes in the tooltip when known; a legend may print a band name instead of the score
    expect(html(createElement(CvssChip, { score: 9.8, version: "3.1" }))).toContain('title="CVSS 3.1 base score 9.8: critical (9.0 and up)"');
    expect(html(createElement(CvssChip, { score: 9, label: "9+" }))).toContain(">9+<");
  });
});

describe("LaneBadge and SeverityWord", () => {
  it("colour the lane through its --color-lane token, with LANE_COLORS as the fallback and the word always present", () => {
    for (const lane of LANES) {
      const chip = html(createElement(LaneBadge, { lane }));
      const text = html(createElement(LaneBadge, { lane, text: true, short: true }));
      expect(chip).toContain(`text-lane-${lane}`);
      expect(text).toContain(`text-lane-${lane}`);
      expect(chip).toContain(`color:${LANE_COLORS[lane]}`);
      expect(text).toContain(`color:${LANE_COLORS[lane]}`);
      expect(chip).toContain("border");
      expect(text).not.toContain("border");
    }
  });

  it("names the severity, never its digit", () => {
    const out = html(createElement(SeverityWord, { severity: 4 }));
    expect(out).toContain(">Real loss<");
    expect(out).toContain("text-sev-4");
    expect(out).not.toMatch(/>\s*4\s*</);
  });
});

describe("IncidentRow", () => {
  const scored = incident({ cvss: 9.8, severity: 3, lane: "patch", patch_status: "unpatched", products: ["Langflow OSS", "vLLM"], cve_ids: ["CVE-2026-9198"], tags: ["rce"] });
  const unscored = incident({ cvss: null, severity: 1, lane: "research", patch_status: "no_fix_needed" });

  it("carries the score through the full, slim and compact rows alike", () => {
    expect(rowOf(scored).cvss).toBe(9.8);
    expect(rowOfSlim(slim(scored)).cvss).toBe(9.8);
    expect(compactRow(scored).cvss).toBe(9.8);
    expect(rowOf(unscored).cvss).toBeNull();
    expect(rowOfSlim(slim(unscored)).cvss).toBeNull();
    expect(compactRow(unscored).cvss).toBeNull();
  });

  it("shows the chip, the product in the accent, the lane and severity as coloured words, and keeps every data attribute", () => {
    const out = html(createElement(IncidentRow, { row: rowOf(scored), variant: "full" }));
    expect(out).toContain('data-cvss="9.8"');
    expect(out).toContain('data-cvss-band="critical"');
    for (const attr of ["data-row", "data-id", "data-lane", "data-state", "data-patch", "data-ai", "data-severity", "data-tags", "data-search"]) expect(out).toContain(attr);
    expect(out).toContain('data-lane="patch"');
    expect(out).toContain('data-severity="3"');
    expect(out).toContain('data-tags="rce"');
    expect(out).toContain('class="text-accent">Langflow </span>');
    expect(out).toContain("text-lane-patch");
    expect(out).toContain(">Patch now<");
    expect(out).toContain(`>${SEVERITY_META[3].short}<`);
    expect(out).toContain("No patch yet");
    expect(out).toContain("CVE-2026-9198");
    expect(out).toContain(scored.summary);
    // the digit is in the data attribute for scripts, never printed for people
    expect(out.replace(/data-[a-z-]+="[^"]*"/g, "")).not.toMatch(/>\s*3\s*</);
  });

  it("draws no chip and no fix status for a research record without a score, and says Research once", () => {
    const out = html(createElement(IncidentRow, { row: rowOf(unscored) }));
    expect(out).toContain('data-cvss=""');
    expect(out).not.toContain("data-cvss-band");
    expect(out.match(/>Research</g)).toHaveLength(1);
    expect(out).not.toContain("No fix needed");
    // without the lane word, the severity word carries it
    expect(html(createElement(IncidentRow, { row: rowOf(unscored), showLane: false })).match(/>Research</g)).toHaveLength(1);
  });

  it("leaves the lane out when a page is about one lane or product", () => {
    const out = html(createElement(IncidentRow, { row: rowOf(scored), showLane: false }));
    expect(out).not.toContain(">Patch now<");
    expect(out).toContain('data-lane="patch"');
  });
});

describe("RowLegend", () => {
  it("reads every colour back with its word: four CVSS bands, four lanes, three fix glyphs", () => {
    const out = html(createElement(RowLegend));
    for (const band of ["critical", "high", "medium", "low"]) expect(out).toContain(`data-cvss-band="${band}"`);
    for (const lane of LANES) expect(out).toContain(`text-lane-${lane}`);
    for (const word of ["No patch yet", "Partly patched", "Patched"]) expect(out).toContain(word);
  });
});
