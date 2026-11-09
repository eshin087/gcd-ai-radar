import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import vercel from "../vercel.json";
import { INTERNET_API } from "../lib/site";

/**
 * vercel.json, applied the way Vercel applies it: each rule's source compiled
 * with path-to-regexp v6 in strict, case-sensitive mode (as
 * @vercel/routing-utils does), every matching rule's headers added in order.
 * Every path refuses framing twice over (CSP frame-ancestors 'none' and
 * X-Frame-Options DENY); the embed card that once allowed it is withdrawn.
 * The data files and feeds carry no CORS and a noindex, since they are the
 * site's own and not published for others.
 */

const require = createRequire(import.meta.url);
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (source: string, keys: unknown[], opts: { strict: boolean; sensitive: boolean; delimiter: string }) => RegExp;
};

const rules = vercel.headers.map((r) => ({ ...r, re: pathToRegexp(r.source, [], { strict: true, sensitive: true, delimiter: "/" }) }));

function headersFor(path: string): { headers: Map<string, string>; conflicts: string[] } {
  const headers = new Map<string, string>();
  const conflicts: string[] = [];
  for (const r of rules) {
    if (!r.re.test(path)) continue;
    for (const h of r.headers) {
      if (headers.has(h.key)) conflicts.push(`${h.key} set twice for ${path}`);
      headers.set(h.key, h.value);
    }
  }
  return { headers, conflicts };
}

const GLOBAL_CSP = vercel.headers[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;

const OTHER_PATHS = ["/", "/api", "/data", "/incidents", "/incidents/some-slug", "/methodology", "/embed/", "/embed.html", "/embed.txt", "/EMBED", "/embedx", "/embed/x", "/x/embed", "/data/meta.json", "/feed.xml", "/og/default.png", "/trends", "/tags", "/tags/rce", "/lanes", "/changes.json", "/llms.txt"];
const MACHINE_PATHS = ["/changes.json", "/llms.txt", "/feed.json", "/live.json", "/stats/home.json", "/stats/kev-2026-10.json", "/lanes/patch/feed.xml", "/lanes/breach/changes.json", "/lanes/research/llms.txt", "/tags/rce/feed.xml", "/tags/rce/llms.txt", "/tags/rce.json"];

describe("vercel.json headers", () => {
  it("refuses framing everywhere, /embed included", () => {
    for (const path of [...OTHER_PATHS, "/embed"]) {
      const { headers } = headersFor(path);
      expect(headers.get("Content-Security-Policy"), path).toContain("frame-ancestors 'none'");
      expect(headers.get("X-Frame-Options"), path).toBe("DENY");
    }
  });

  it("gives every page the same policy, with the global CSP first in the file", () => {
    for (const path of ["/", "/embed", "/live"]) {
      const { headers } = headersFor(path);
      expect(headers.get("Content-Security-Policy"), path).toBe(GLOBAL_CSP);
      expect(headers.get("X-Content-Type-Options"), path).toBe("nosniff");
      expect(headers.get("Referrer-Policy"), path).toBe("strict-origin-when-cross-origin");
      expect(headers.get("Permissions-Policy"), path).toBeTruthy();
    }
  });

  it("keeps the hour's cache on the data files and the feeds, with no CORS and a noindex", () => {
    for (const path of ["/data/summary.json", "/data/meta.json", "/data/incidents.csv", "/data/years/2026.json", "/feed.xml", "/briefing.xml"]) {
      const { headers } = headersFor(path);
      expect(headers.get("Access-Control-Allow-Origin"), path).toBeUndefined();
      expect(headers.get("X-Robots-Tag"), path).toBe("noindex");
      expect(headers.get("Cache-Control"), path).toBe("public, max-age=3600, stale-while-revalidate=86400");
    }
  });

  it("serves the machine files with a five-minute cache and a noindex, no CORS, and nothing else under /tags", () => {
    for (const path of MACHINE_PATHS) {
      const { headers } = headersFor(path);
      expect(headers.get("Access-Control-Allow-Origin"), path).toBeUndefined();
      expect(headers.get("X-Robots-Tag"), path).toBe("noindex");
      expect(headers.get("Cache-Control"), path).toBe("public, max-age=300, stale-while-revalidate=3600");
    }
    for (const path of ["/tags", "/tags/rce", "/trends", "/lanes", "/og/default.png"]) {
      const { headers } = headersFor(path);
      expect(headers.get("Access-Control-Allow-Origin"), path).toBeUndefined();
      expect(headers.get("X-Robots-Tag"), path).toBeUndefined();
    }
  });

  it("lets the page fetch the hero globe's Worker and nothing else off-site", () => {
    const origin = new URL(INTERNET_API).origin;
    for (const path of ["/", "/embed", "/live"]) {
      const csp = headersFor(path).headers.get("Content-Security-Policy")!;
      const connect = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src"));
      expect(connect, path).toBe(`connect-src 'self' ${origin}`);
    }
  });

  it("never sets one header twice on a path, so rule order cannot decide a value", () => {
    for (const path of [...OTHER_PATHS, "/embed", ...MACHINE_PATHS]) expect(headersFor(path).conflicts).toEqual([]);
  });
});
