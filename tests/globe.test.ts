import { describe, expect, it } from "vitest";
import { basis, countryAt, countryName, DEG, dot3, inSentence, isLand, landDots, lonLat, onMap, place, plainName, subsolar, toLonLat, unproject, wrap } from "@/components/internet/globe/geo";
import { buildArc, buildVisual } from "@/components/internet/globe/render";
import { ruleName, utcSpan } from "@/components/internet/InternetBand";
import { buildTour, stopKey, TOUR, type Stop } from "@/components/internet/tour";
import { readPayload, type InternetData } from "@/components/internet/useInternet";

const route = (origin: string, target: string, share = 5) => ({ origin, origin_name: origin, target, target_name: target, share });

/** A Worker payload in the 2026-10-30 shape, with the parts a test sets. */
function payload(parts: Partial<{ routes: unknown[]; ddos: unknown[]; waf: unknown[]; hijacks: unknown[]; outages: unknown[] }>): InternetData {
  return readPayload({
    generated_at: "2026-10-30T03:45:00Z",
    radar_updated: "2026-10-30T01:30:00Z",
    window: "1h",
    attacks: { routes: parts.routes ?? [], top_targets: [], ddos: { window: "1h", routes: parts.ddos ?? [] }, waf: { window: "1h", origins: parts.waf ?? [] } },
    traffic: { points: [] },
    outages: parts.outages ?? [],
    bgp: { leaks: 0, hijacks: 0 },
    hijacks: parts.hijacks ?? [],
    attribution: {},
    stale: false,
  })!;
}

const hijack = (id: number, hijacker: string, victims: string[], n = 1) => ({
  id,
  url: `https://radar.cloudflare.com/routing/anomalies/event/hijack-${id}`,
  confidence: 12,
  start: "2026-10-29T04:09:32.815Z",
  end: "2026-10-29T04:45:02.551Z",
  hijacker: { asn: 64511, name: "Example Transit", country: hijacker },
  victims: victims.map((c, i) => ({ asn: 64500 + i, name: null, country: c })),
  prefixes: ["203.0.113.0/24"],
  prefix_count: n,
});

const outage = (codes: string[], until: string | null = "2026-10-27T12:00:00Z", type = "regional") => ({
  location: "Bangladesh",
  codes,
  type,
  region: null,
  since: "2026-10-27T06:30:00Z",
  until,
  cause: "power outage",
  description: "A fault on the national grid caused a drop in Internet traffic.",
  url: "https://x.com/CloudflareRadar/status/2115132538502992056",
});

const waf = (country: string, share: number) => ({ country, name: country === "US" ? "United States" : country, share, rules: [{ name: "Directory Traversal", share: 35.9 }] });

describe("globe geometry", () => {
  it("round-trips longitude and latitude through unit vectors", () => {
    for (const [lon, lat] of [[0, 0], [139.7, 35.7], [-74, 40.7], [-179.5, -45], [12.5, 89]] as const) {
      const [l, p] = toLonLat(lonLat(lon, lat));
      expect(l).toBeCloseTo(lon, 6);
      expect(p).toBeCloseTo(lat, 6);
    }
  });

  it("centres the camera's point and puts east on the right and north up", () => {
    const b = basis(30 * DEG, 20 * DEG);
    const centre = lonLat(30, 20);
    expect(centre.x * b.cx + centre.y * b.cy + centre.z * b.cz).toBeCloseTo(1, 9);
    const east = lonLat(40, 20), north = lonLat(30, 30);
    expect(east.x * b.ex + east.y * b.ey + east.z * b.ez).toBeGreaterThan(0);
    expect(north.x * b.nx + north.y * b.ny + north.z * b.nz).toBeGreaterThan(0);
    // the disc's centre unprojects to the camera's point; off the disc there is nothing
    const c = unproject(b, 0, 0)!;
    expect(dot3(c, centre)).toBeCloseTo(1, 9);
    expect(unproject(b, 0.8, 0.8)).toBeNull();
  });

  it("wraps angles to [-π, π)", () => {
    expect(wrap(3 * Math.PI)).toBeCloseTo(-Math.PI, 9);
    expect(wrap(-0.5)).toBeCloseTo(-0.5, 9);
    expect(wrap(7)).toBeCloseTo(7 - 2 * Math.PI, 9);
  });
});

describe("land mask", () => {
  it("knows land from sea at well-known places", () => {
    for (const [lon, lat] of [[10, 22], [-100, 40], [100, 60], [135, -25], [-60, -10], [78, 22]] as const) expect(isLand(lon, lat), `${lon},${lat}`).toBe(true);
    for (const [lon, lat] of [[-30, 0], [-150, 20], [80, -30], [0, 0], [170, -50]] as const) expect(isLand(lon, lat), `${lon},${lat}`).toBe(false);
  });

  it("samples dots on land only, denser for a finer step", () => {
    const coarse = landDots(2), fine = landDots(1.25);
    expect(coarse.length % 4).toBe(0);
    const n = coarse.length / 4;
    // about 29 % of the sphere is land: 41,253 square degrees / 4 per dot * 0.29 ≈ 3,000
    expect(n).toBeGreaterThan(2400);
    expect(n).toBeLessThan(3600);
    expect(fine.length / 4).toBeGreaterThan(n * 2.2);
    // stored as 32-bit floats, and rows sit on whole degrees (cell edges), so round before asking the mask again
    for (let i = 0; i < coarse.length; i += 4 * 97) {
      const [lon, lat] = toLonLat({ x: coarse[i]!, y: coarse[i + 1]!, z: coarse[i + 2]! });
      expect(lon).toBeCloseTo(coarse[i + 3]!, 3);
      expect(isLand(coarse[i + 3]!, Math.round(lat * 1e4) / 1e4)).toBe(true);
    }
  });
});

describe("country cells", () => {
  it("says whose land a point is, and nobody's at sea", () => {
    for (const [lon, lat, code] of [[90.4, 23.8, "BD"], [-72.3, 18.9, "HT"], [30.5, 50.4, "UA"], [2.3, 46.5, "FR"], [-100, 40, "US"], [134, -25, "AU"]] as const) expect(countryAt(lon, lat), code).toBe(code);
    expect(countryAt(-30, 0)).toBeNull();
    expect(countryAt(-150, 20)).toBeNull();
  });

  it("names countries from the globe file", () => {
    expect(countryName("BD")).toBe("Bangladesh");
    expect(countryName("ZZ")).toBe("ZZ");
  });
});

describe("subsolar point", () => {
  it("sits over the equator near Greenwich at the March equinox's noon", () => {
    const [lon, lat] = subsolar(Date.UTC(2026, 2, 20, 12));
    expect(Math.abs(lat)).toBeLessThan(0.6);
    // the equation of time is about -7.5 minutes then, so the Sun stands about 1.9° east
    expect(lon).toBeGreaterThan(0.5);
    expect(lon).toBeLessThan(3);
  });

  it("reaches the Tropic of Cancer at the June solstice and moves west 15° an hour", () => {
    const [, lat] = subsolar(Date.UTC(2026, 5, 21, 12));
    expect(lat).toBeGreaterThan(23.2);
    expect(lat).toBeLessThan(23.6);
    const [a] = subsolar(Date.UTC(2026, 5, 21, 12)), [b] = subsolar(Date.UTC(2026, 5, 21, 13));
    expect(wrap((a - b) * DEG) / DEG).toBeCloseTo(15, 1);
  });
});

describe("routes", () => {
  it("draws only routes whose two countries have a place", () => {
    expect(onMap(route("US", "CN"))).toBe(true);
    expect(onMap(route("US", "XX"))).toBe(false);
    expect(buildArc(route("US", "XX"))).toBeNull();
  });

  it("lifts a route off the sphere between its two countries and frames its middle", () => {
    const arc = buildArc(route("ID", "CY"))!;
    expect(arc.self).toBe(false);
    expect(arc.pts).toHaveLength(65);
    const a = place("ID")!, b = place("CY")!;
    const first = arc.pts[0]!, last = arc.pts[arc.pts.length - 1]!;
    expect(dot3(first, a)).toBeCloseTo(1, 6);
    expect(dot3(last, b)).toBeCloseTo(1, 6);
    const mid = arc.pts[32]!;
    expect(Math.hypot(mid.x, mid.y, mid.z)).toBeGreaterThan(1.05);
    expect(Math.abs(arc.view[1])).toBeLessThanOrEqual(50 * DEG + 1e-9);
  });

  it("draws a country attacking itself as a closed loop over it", () => {
    const arc = buildArc(route("US", "US"))!;
    expect(arc.self).toBe(true);
    const a = place("US")!, first = arc.pts[0]!, last = arc.pts[arc.pts.length - 1]!;
    expect(dot3(first, a)).toBeCloseTo(1, 6);
    expect(Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z)).toBeLessThan(1e-6);
  });

  it("builds a visual for every kind of stop", () => {
    const d = payload({ ddos: [route("ID", "CY")], waf: [waf("US", 29)], hijacks: [hijack(1, "BR", ["PY"])], outages: [outage(["BD"], null, "nationwide")] });
    const visuals = buildTour(d).map((s) => buildVisual(s, stopKey(s)));
    expect(visuals.map((v) => v?.kind)).toEqual(["ddos", "hijack", "waf", "outage"]);
    const [ddos, hij, w, out] = visuals;
    expect(ddos && "path" in ddos && ddos.path.self).toBe(false);
    // a hijack runs from the hijacker to the victim
    expect(hij && "path" in hij && dot3(hij.path.pts[0]!, place("BR")!)).toBeCloseTo(1, 6);
    expect(w?.kind === "waf" && dot3(w.at, place("US")!)).toBeCloseTo(1, 6);
    expect(out?.kind === "outage" && [out.code, out.ended, out.depth]).toEqual(["BD", false, 0.88]);
  });

  it("names countries plainly, with 'the' where a sentence needs it", () => {
    expect(plainName("Russian Federation")).toBe("Russia");
    expect(plainName("Germany")).toBe("Germany");
    expect(inSentence("United States")).toBe("the United States");
    expect(inSentence("Netherlands")).toBe("the Netherlands");
    expect(inSentence("Viet Nam")).toBe("Vietnam");
  });
});

describe("the tour", () => {
  it("mixes the kinds: flood, hijack, exploits, outage, then a flood across a border", () => {
    const d = payload({
      ddos: [route("US", "US", 12.4), route("ID", "CY", 6), route("ID", "US", 3.9)],
      waf: [waf("US", 29), waf("CN", 6.2)],
      hijacks: [hijack(1, "BR", ["PY", "BR"], 201)],
      outages: [outage(["HT"]), outage(["BD"])],
    });
    const tour = buildTour(d);
    expect(tour).toHaveLength(TOUR);
    expect(tour.map(stopKey)).toEqual(["ddos:US>US", "hijack:1", "waf:US", "outage:2026-10-27T06:30:00Z:HT", "ddos:ID>CY"]);
  });

  it("picks a victim in another country, and skips events with no place on the map", () => {
    const d = payload({ ddos: [route("ID", "CY")], hijacks: [hijack(1, "XX", ["BR"]), hijack(2, "RO", ["RO", "AM"])], outages: [outage([]), outage(["ZZ", "BD"])] });
    const tour = buildTour(d);
    const h = tour.find((s): s is Extract<Stop, { kind: "hijack" }> => s.kind === "hijack");
    expect(h?.event.id).toBe(2);
    expect(h?.victim.country).toBe("AM");
    const o = tour.find((s): s is Extract<Stop, { kind: "outage" }> => s.kind === "outage");
    expect(o?.code).toBe("BD");
  });

  it("fills missing events with more routes and origins, without repeats", () => {
    const tour = buildTour(payload({ ddos: [route("ID", "CY"), route("US", "US")], waf: [waf("US", 29), waf("CN", 6)] }));
    expect(tour.map(stopKey)).toEqual(["ddos:ID>CY", "waf:US", "ddos:US>US", "waf:CN"]);
  });

  it("falls back to the plain routes of an older Worker", () => {
    const old = readPayload({ generated_at: "2026-10-29T03:00:00Z", window: "1h", attacks: { routes: [route("US", "US"), route("ID", "CY"), route("ID", "XX")] }, outages: [{ location: "Tonga", since: "2026-10-26T06:10:00Z" }] })!;
    expect(old.attacks.ddos.routes).toEqual([]);
    expect(old.hijacks).toEqual([]);
    expect(old.outages[0]?.codes).toEqual([]);
    expect(buildTour(old).map(stopKey)).toEqual(["route:US>US", "route:ID>CY"]);
  });

  it("drops malformed hijacks and outages when reading a payload", () => {
    const d = payload({ hijacks: [{ id: 1 }, { ...hijack(2, "BR", ["PY"]), url: "javascript:alert(1)" }, hijack(3, "BR", ["PY"])], outages: [{ since: "x" }, outage(["BD"])] });
    expect(d.hijacks.map((h) => h.id)).toEqual([3]);
    expect(d.outages).toHaveLength(1);
  });
});

describe("caption words", () => {
  it("writes an outage's time span in UTC", () => {
    expect(utcSpan("2026-10-27T06:30:00Z", "2026-10-27T12:00:00Z")).toBe("Oct 27, 06:30–12:00 UTC");
    expect(utcSpan("2026-10-23T21:45:00Z", "2026-10-25T04:30:00Z")).toBe("Oct 23, 21:45 – Oct 25, 04:30 UTC");
    expect(utcSpan("2026-10-27T06:30:00Z", null)).toBe("since Oct 27, 06:30 UTC");
  });

  it("names Radar's rule categories in plain words", () => {
    expect(ruleName("SQLi")).toBe("SQL injection");
    expect(ruleName("XSS")).toBe("cross-site scripting");
    expect(ruleName("Directory Traversal")).toBe("directory traversal");
    expect(ruleName("Command Injection")).toBe("command injection");
    expect(ruleName("RCE")).toBe("RCE");
  });
});
