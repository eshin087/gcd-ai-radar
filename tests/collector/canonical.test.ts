import { describe, expect, it } from "vitest";
import { canonicalUrl, hostOf, isShortener, urlKey } from "@/collector/lib/canonical";

describe("canonicalUrl", () => {
  it("normalizes scheme, host, tracking params, fragments and trailing slashes", () => {
    const a = canonicalUrl("http://www.Example.com/news/story/?utm_source=x&id=2&fbclid=abc#top");
    const b = canonicalUrl("https://example.com/news/story?id=2");
    expect(a).toBe("https://example.com/news/story?id=2");
    expect(a).toBe(b);
  });
  it("collapses AMP variants", () => {
    expect(canonicalUrl("https://amp.example.com/a/b/amp/")).toBe("https://example.com/a/b");
    expect(canonicalUrl("https://example-com.cdn.ampproject.org/c/s/example.com/a/b")).toBe("https://example.com/a/b");
  });
  it("keeps meaningful query parameters sorted", () => {
    expect(canonicalUrl("https://x.org/p?b=2&a=1")).toBe("https://x.org/p?a=1&b=2");
  });
  it("rejects non-http urls", () => {
    expect(canonicalUrl("mailto:a@b.c")).toBeNull();
    expect(canonicalUrl("not a url")).toBeNull();
  });
  it("produces stable keys and hosts", () => {
    expect(urlKey("https://example.com/a")).toHaveLength(16);
    expect(urlKey("https://example.com/a")).toBe(urlKey("https://example.com/a"));
    expect(hostOf("https://www.theregister.com/x")).toBe("theregister.com");
    expect(isShortener("https://t.co/abc")).toBe(true);
  });
});
