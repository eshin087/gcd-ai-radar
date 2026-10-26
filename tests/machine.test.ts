import { describe, expect, it } from "vitest";
import { buildChanges } from "@/lib/changes";
import { escapeXml, jsonFeed, rssXml } from "@/lib/feeds";
import { buildLlmsTxt } from "@/lib/llms";
import { SITE } from "@/lib/site";
import { incident } from "./fixtures";

const BASE = "https://example.test";
const NOW = new Date("2026-10-25T12:00:00Z");

const records = [
  incident({
    slug: "a",
    title: 'Flaw & "quotes" <in> a title',
    lane: "patch",
    state: "live",
    tags: ["rce", "path_traversal"],
    cve_ids: ["CVE-2026-1"],
    timeline: [
      { date: "2026-10-20", title: "First report", source_url: "https://example.org/a", added_at: "2026-10-20T10:00:00.000Z" },
      { date: "2026-10-24", title: "Patch released", added_at: "2026-10-24T10:00:00.000Z" },
    ],
    first_reported: "2026-10-20",
    incident_date: "2026-10-20",
  }),
  incident({ slug: "b", lane: "breach", state: "live", tags: ["ransomware"], first_reported: "2026-10-23", incident_date: "2026-10-23", timeline: [{ date: "2026-10-23", title: "Breach disclosed", added_at: "2026-10-23T10:00:00.000Z" }] }),
  incident({ slug: "c", lane: "patch", state: "closed", closed_at: "2026-09-20", tags: ["rce"], first_reported: "2026-09-01", incident_date: "2026-09-01", timeline: [{ date: "2026-09-01", title: "Old report", added_at: "2026-09-01T10:00:00.000Z" }] }),
];

describe("changes.json", () => {
  it("lists timeline entries newest first by when they were added, per lane when asked", () => {
    const all = buildChanges(records, { site: BASE, now: NOW });
    expect(all.changes.map((c) => c.update)).toEqual(["Patch released", "Breach disclosed", "First report", "Old report"]);
    expect(all.changes[0]).toMatchObject({ slug: "a", lane: "patch", state: "live", date: "2026-10-24", source_url: null, url: `${BASE}/incidents/a` });
    expect(all.changes[2]!.source_url).toBe("https://example.org/a");
    expect(all.feeds.changes).toBe(`${BASE}/changes.json`);
    const breach = buildChanges(records, { site: BASE, now: NOW, lane: "breach" });
    expect(breach.changes.map((c) => c.slug)).toEqual(["b"]);
    expect(breach.feeds.rss).toBe(`${BASE}/lanes/breach/feed.xml`);
    expect(buildChanges(records, { site: BASE, now: NOW, limit: 2 }).changes).toHaveLength(2);
  });
});

describe("feeds", () => {
  const channel = { title: "Test feed", description: "Desc & more", homeUrl: `${BASE}/`, feedUrl: `${BASE}/feed.xml`, updated: "2026-10-25T06:00:00.000Z" };

  it("escapes XML and carries the lane, categories and tags as categories", () => {
    const xml = rssXml(records, BASE, channel);
    expect(xml).toContain("<title>Flaw &amp; &quot;quotes&quot; &lt;in&gt; a title</title>");
    expect(xml).toContain("<description>Desc &amp; more</description>");
    expect(xml).toContain("<category>Patch now</category>");
    expect(xml).toContain("<category>path-traversal</category>");
    expect(xml).toContain(`<guid isPermaLink="false">${records[0]!.id}</guid>`);
    expect(xml).toContain(`<lastBuildDate>${new Date("2026-10-25T06:00:00.000Z").toUTCString()}</lastBuildDate>`);
    expect(xml.match(/<item>/g)).toHaveLength(3);
    expect(escapeXml("a'b")).toBe("a&apos;b");
  });

  it("writes JSON Feed 1.1 with the record's lifecycle in _radar", () => {
    const feed = jsonFeed(records, BASE, channel);
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.items).toHaveLength(3);
    expect(feed.items[0]).toMatchObject({ id: records[0]!.id, url: `${BASE}/incidents/a`, date_published: "2026-10-20T12:00:00Z", date_modified: "2026-10-24T12:00:00Z", tags: ["patch", "attack_on_ai", "rce", "path-traversal"] });
    expect(feed.items[0]!._radar).toEqual({ lane: "patch", type: "attack_on_ai", severity: 3, state: "live", patch_status: "unknown", cve_ids: ["CVE-2026-1"] });
    expect(feed.items[0]!.content_text).toContain("Patch now; Fix status unknown.");
  });
});

describe("llms.txt", () => {
  const tags = [
    { slug: "rce", label: "rce", live: 1, total: 2 },
    { slug: "ransomware", label: "ransomware", live: 1, total: 1 },
  ];

  it("describes the site, its endpoints, lanes, tags and every live record", () => {
    const txt = buildLlmsTxt({ site: BASE, incidents: records, tags, scope: { kind: "site" }, now: NOW });
    expect(txt.startsWith("# GCD")).toBe(true);
    expect(txt).toContain("## Endpoints");
    expect(txt).toContain(`${BASE}/changes.json`);
    expect(txt).toContain("## Lanes");
    expect(txt).toContain("- Patch now (patch): 1 live, 2 on record.");
    expect(txt).toContain("## Tags");
    expect(txt).toContain("rce (1 live, 2)");
    expect(txt).toContain("## Live records (2)");
    expect(txt).toContain(`- [Flaw & "quotes" <in> a title](${BASE}/incidents/a): Patch now · severity 3 Confirmed exploitation · Fix status unknown · first reported 2026-10-20 · CVE-2026-1`);
    expect(txt).not.toContain("/incidents/c)");
    expect(txt).not.toContain("&lt;");
    expect(txt.length).toBeLessThan(60 * 1024);
  });

  it("narrows to a lane or a tag", () => {
    const lane = buildLlmsTxt({ site: BASE, incidents: records, tags, scope: { kind: "lane", lane: "breach" }, now: NOW });
    expect(lane).toContain(`# ${SITE.name} · Breaches & attacks`);
    expect(lane).toContain(`${BASE}/lanes/breach/feed.json`);
    expect(lane).toContain("## Live records (1)");
    expect(lane).toContain("/incidents/b)");
    const tag = buildLlmsTxt({ site: BASE, incidents: records, tags, scope: { kind: "tag", tag: { slug: "rce", label: "rce", group: "attack" } }, now: NOW });
    expect(tag).toContain("tag: rce");
    expect(tag).toContain("## Live records (1)");
    expect(tag).toContain("/incidents/a)");
    expect(tag).not.toContain("## Lanes");
  });
});
