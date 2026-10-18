import { describe, expect, it } from "vitest";
import { parseFeed, stripBoilerplate, stripDoctype, toIsoDate } from "@/collector/lib/feed";
import { cleanGdeltTitle } from "@/collector/sources/gdelt";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Example</title>
<item>
  <title><![CDATA[Critical flaw in vLLM &amp; friends]]></title>
  <link>https://example.org/a?utm_source=rss</link>
  <guid isPermaLink="false">123</guid>
  <pubDate>Fri, 17 Oct 2026 10:00:00 +0000</pubDate>
  <dc:creator>Someone</dc:creator>
  <category>Security</category><category>AI</category>
  <description><![CDATA[<p>Short <b>teaser</b> text.</p> The post Critical flaw appeared first on Example.]]></description>
  <content:encoded><![CDATA[<p>Full text that must not be stored.</p>]]></content:encoded>
</item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Blog</title>
  <entry>
    <title>Prompt injection in Example Agent</title>
    <link rel="alternate" type="text/html" href="https://example.org/post"/>
    <link rel="self" href="https://example.org/post.atom"/>
    <id>tag:example.org,2026:post</id>
    <published>2026-10-16T08:30:00Z</published>
    <updated>2026-10-17T08:30:00Z</updated>
    <summary type="html">&lt;p&gt;An agent followed hidden instructions.&lt;/p&gt;</summary>
    <category term="security"/>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("parses RSS items with CDATA, categories and dates", () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(1);
    const it0 = items[0]!;
    expect(it0.title).toBe("Critical flaw in vLLM & friends");
    expect(it0.link).toBe("https://example.org/a?utm_source=rss");
    expect(it0.date).toBe("2026-10-17");
    expect(it0.categories).toEqual(["Security", "AI"]);
    expect(stripBoilerplate(it0.summary)).toBe("Short teaser text.");
  });
  it("parses Atom entries and picks the alternate link", () => {
    const items = parseFeed(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0]!.link).toBe("https://example.org/post");
    expect(items[0]!.date).toBe("2026-10-16");
    expect(items[0]!.summary).toBe("An agent followed hidden instructions.");
    expect(items[0]!.categories).toEqual(["security"]);
  });
  it("normalizes dates", () => {
    expect(toIsoDate("Sat, 17 Oct 2026 04:00:06 +0000")).toBe("2026-10-17");
    expect(toIsoDate("2026-10-17")).toBe("2026-10-17");
    expect(toIsoDate("garbage")).toBeUndefined();
  });
});

describe("cleanGdeltTitle", () => {
  it("repairs tokenized punctuation", () => {
    expect(cleanGdeltTitle("CVE - 2026 - 95183 : What the Tech ?")).toBe("CVE-2026-95183: What the Tech?");
    expect(cleanGdeltTitle("Hidden  Prompt - Injection  Text , explained")).toBe("Hidden Prompt - Injection Text, explained");
    expect(cleanGdeltTitle("OpenAI ' s agent")).toBe("OpenAI's agent");
  });
});

describe("stripDoctype", () => {
  it("removes a DOCTYPE with entity declarations so they cannot expand", () => {
    const bomb = `<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<rss version="2.0"><channel><title>x</title><item><title>&lol3;</title><link>https://example.org/a</link></item></channel></rss>`;
    const stripped = stripDoctype(bomb);
    expect(stripped).not.toContain("<!DOCTYPE");
    expect(stripped).not.toContain("<!ENTITY");
    const items = parseFeed(bomb);
    expect(items).toHaveLength(1);
    expect(items[0]!.title.length).toBeLessThan(20);
  });

  it("leaves documents without a DOCTYPE alone", () => {
    expect(stripDoctype(RSS)).toBe(RSS);
    expect(stripDoctype(`<!DOCTYPE html><rss/>`)).toBe(`<rss/>`);
  });
});
