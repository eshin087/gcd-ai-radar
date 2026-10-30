import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import vercel from "../vercel.json";
import { INTERNET_API } from "../lib/site";

/**
 * vercel.json, applied the way Vercel applies it: each rule's source compiled
 * with path-to-regexp v6 in strict, case-sensitive mode (as
 * @vercel/routing-utils does), every matching rule's headers added in order.
 * Only /embed may be framed by other sites; every other path refuses framing
 * twice over (CSP frame-ancestors 'none' and X-Frame-Options DENY).
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
  it("refuses framing everywhere except /embed", () => {
    for (const path of OTHER_PATHS) {
      const { headers } = headersFor(path);
      expect(headers.get("Content-Security-Policy"), path).toContain("frame-ancestors 'none'");
      expect(headers.get("X-Frame-Options"), path).toBe("DENY");
    }
  });

  it("lets any site frame /embed, with the rest of the policy unchanged", () => {
    const { headers } = headersFor("/embed");
    expect(headers.get("X-Frame-Options")).toBeUndefined();
    const csp = headers.get("Content-Security-Policy")!;
    expect(csp).toContain("frame-ancestors *");
    expect(csp).toBe(GLOBAL_CSP.replace("frame-ancestors 'none'", "frame-ancestors *"));
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toBeTruthy();
  });

  it("keeps CORS and the hour's cache on the data files and the feed", () => {
    for (const path of ["/data/summary.json", "/data/meta.json", "/data/incidents.csv", "/data/years/2026.json", "/feed.xml"]) {
      const { headers } = headersFor(path);
      expect(headers.get("Access-Control-Allow-Origin"), path).toBe("*");
      expect(headers.get("Cache-Control"), path).toBe("public, max-age=3600, stale-while-revalidate=86400");
    }
  });

  it("serves the machine files with open CORS and a five-minute cache, and nothing else under /tags", () => {
    for (const path of MACHINE_PATHS) {
      const { headers } = headersFor(path);
      expect(headers.get("Access-Control-Allow-Origin"), path).toBe("*");
      expect(headers.get("Cache-Control"), path).toBe("public, max-age=300, stale-while-revalidate=3600");
    }
    for (const path of ["/tags", "/tags/rce", "/trends", "/lanes"]) {
      const { headers } = headersFor(path);
      expect(headers.get("Access-Control-Allow-Origin"), path).toBeUndefined();
      expect(headers.get("Cache-Control"), path).toBeUndefined();
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
