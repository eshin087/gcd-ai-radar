import { describe, expect, it } from "vitest";
import { basis, DEG, dot3, inSentence, isLand, landDots, lonLat, onMap, place, plainName, subsolar, toLonLat, unproject, wrap } from "@/components/internet/globe/geo";
import { GLOBE_LOOKS } from "@/components/internet/globe/looks";
import { buildArc } from "@/components/internet/globe/render";

const route = (origin: string, target: string, share = 5) => ({ origin, origin_name: origin, target, target_name: target, share });

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

  it("names countries plainly, with 'the' where a sentence needs it", () => {
    expect(plainName("Russian Federation")).toBe("Russia");
    expect(plainName("Germany")).toBe("Germany");
    expect(inSentence("United States")).toBe("the United States");
    expect(inSentence("Netherlands")).toBe("the Netherlands");
    expect(inSentence("Viet Nam")).toBe("Vietnam");
  });

  it("offers four looks with distinct ids", () => {
    expect(new Set(GLOBE_LOOKS.map((l) => l.id)).size).toBe(GLOBE_LOOKS.length);
    expect(GLOBE_LOOKS.length).toBe(4);
  });
});
