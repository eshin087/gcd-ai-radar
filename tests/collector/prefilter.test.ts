import { describe, expect, it } from "vitest";
import { loadConfig, type SourceConfig } from "@/collector/lib/config";
import { prefilter } from "@/collector/pipeline/prefilter";
import { candidate } from "./helpers";

const config = loadConfig();
const sources = new Map<string, SourceConfig>(config.sources.map((s) => [s.id, s]));

describe("prefilter", () => {
  it("keeps press items with a security term and no AI term, recording the AI hint as false", () => {
    const c = candidate({ source_id: "therecord", title: "Ransomware attack halts production at a car parts maker", url: "https://example.org/1" });
    const r = prefilter([c], config, sources);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]!.extra?.["ai_hint"]).toBe(false);
  });

  it("records the AI hint as true when an AI term matched", () => {
    const c = candidate({ source_id: "thn", title: "Prompt injection flaw in a coding agent leaks secrets", url: "https://example.org/2" });
    const r = prefilter([c], config, sources);
    expect(r.kept[0]!.extra?.["ai_hint"]).toBe(true);
  });

  it("drops press items with no security term and says why", () => {
    const c = candidate({ source_id: "cyberscoop", title: "Agency names new chief information officer", url: "https://example.org/3" });
    const r = prefilter([c], config, sources);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0]!.reason).toBe("no security term");
  });

  it("lets a CVE id stand in for a security term", () => {
    const c = candidate({ source_id: "cisco-psirt", title: "Cisco IOS XE Software Web UI Issue", url: "https://example.org/4", cve_ids: ["CVE-2026-20100"] });
    expect(prefilter([c], config, sources).kept).toHaveLength(1);
  });

  it("drops roundups, podcasts and week-in-review pieces before anything else", () => {
    const items = [
      candidate({ source_id: "helpnetsecurity", title: "Week in review: exploited zero-days and a breach", url: "https://example.org/5" }),
      candidate({ source_id: "thn", title: "Security podcast: the breach that shook retail", url: "https://example.org/6" }),
      candidate({ source_id: "thn", title: "Weekly roundup of vulnerabilities", url: "https://example.org/7" }),
    ];
    const r = prefilter(items, config, sources);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped.every((d) => d.reason === "negative term")).toBe(true);
  });

  it("passes specialist and seed sources through the gate with the hint attached", () => {
    const seed = candidate({ source_id: "hibp", title: "Example Corp data breach exposes 500,000 accounts", url: "https://example.org/8", extra: { hibp: true } });
    const specialist = candidate({ source_id: "embracethered", title: "A note on agents", url: "https://example.org/9" });
    const r = prefilter([seed, specialist], config, sources);
    expect(r.kept).toHaveLength(2);
    expect(r.kept[0]!.extra).toEqual({ hibp: true, ai_hint: false });
    expect(r.kept[1]!.extra?.["ai_hint"]).toBe(true);
  });

  it("reads the general query list for Hacker News", () => {
    expect(config.generalQueries).toContain("data breach");
    expect(config.queries).not.toContain("data breach");
  });
});
