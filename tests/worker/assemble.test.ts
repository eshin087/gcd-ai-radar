import { describe, expect, it } from "vitest";
import { ATTRIBUTION, assemble, bgpTime, eventCount, lastHourWindow, num, parseHijacks, parseOrigins, parseOutages, parseRoutes, parseSummary, parseTraffic, radarUpdated, regions, topTargets } from "../../worker/src/assemble";
import { botClass, ddosAttacks, emptyAttacks, hijacks, leaks, managedRules, outages, timeseries, topAttacks, wafOrigins } from "./fixtures";

/** The Worker's pure assembly, on the recorded Radar payload shapes (tests/worker/fixtures.ts). */

describe("num", () => {
  it("reads Radar's numeric strings and nothing else", () => {
    expect(num("4.323214")).toBe(4.323214);
    expect(num("10")).toBe(10);
    expect(num(7)).toBe(7);
    expect(num("")).toBeNull();
    expect(num("n/a")).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num(Number.NaN)).toBeNull();
  });
});

describe("parseRoutes", () => {
  it("keeps every well-formed route, largest share first", () => {
    const routes = parseRoutes(topAttacks);
    expect(routes.map((r) => `${r.origin}>${r.target}`)).toEqual(["US>FR", "US>US", "DE>US", "CN>FR", "BR>IN"]);
    expect(routes[0]).toEqual({ origin: "US", origin_name: "United States", target: "FR", target_name: "France", share: 4.323 });
  });

  it("drops rows without two country codes or a readable share", () => {
    const routes = parseRoutes({
      result: {
        top_0: [
          { originCountryAlpha2: "US", targetCountryAlpha2: "FR", value: "1" },
          { originCountryAlpha2: "XX1", targetCountryAlpha2: "FR", value: "1" },
          { originCountryAlpha2: "US", targetCountryAlpha2: "FR", value: "abc" },
          { originCountryAlpha2: "US", value: "2" },
          { originCountryAlpha2: "US", targetCountryAlpha2: "FR", value: "-1" },
        ],
      },
    });
    expect(routes).toHaveLength(1);
    expect(routes[0]?.origin_name).toBe("US");
  });

  it("returns nothing for an empty or malformed payload", () => {
    expect(parseRoutes(emptyAttacks)).toEqual([]);
    expect(parseRoutes({})).toEqual([]);
    expect(parseRoutes({ result: {} })).toEqual([]);
  });
});

describe("topTargets", () => {
  it("sums shares per target and ranks them", () => {
    const targets = topTargets(parseRoutes(topAttacks));
    expect(targets.map((t) => [t.country, t.share])).toEqual([
      ["US", 5.85],
      ["FR", 5.523],
      ["IN", 0.9],
    ]);
    expect(targets[0]?.name).toBe("United States");
  });

  it("honours the limit", () => {
    expect(topTargets(parseRoutes(topAttacks), 2)).toHaveLength(2);
  });
});

describe("parseOrigins and parseSummary", () => {
  it("ranks origins and drops rows without a code or a share", () => {
    expect(parseOrigins(wafOrigins).map((o) => o.country)).toEqual(["US", "CN", "SG"]);
    expect(parseOrigins({ result: { top_0: [{ originCountryAlpha2: "usa", value: "3" }, { originCountryAlpha2: "DE", value: "x" }, { originCountryAlpha2: "FR", value: "2" }] } })).toEqual([{ country: "FR", name: "FR", share: 2 }]);
    expect(parseOrigins({})).toEqual([]);
  });

  it("ranks a summary's named shares, leaves out 'other' and caps the list", () => {
    expect(parseSummary(managedRules)).toEqual([
      { name: "Directory Traversal", share: 44.8 },
      { name: "HTTP Anomaly", share: 17.1 },
      { name: "Broken Authentication", share: 6.9 },
    ]);
    expect(parseSummary(managedRules, 10).map((r) => r.name)).not.toContain("other");
    expect(parseSummary({})).toEqual([]);
  });
});

describe("radarUpdated", () => {
  it("normalises Radar's lastUpdated to ISO and refuses junk", () => {
    expect(radarUpdated(topAttacks)).toBe("2026-10-26T11:45:00.000Z");
    expect(radarUpdated({ result: { meta: { lastUpdated: "yesterday" } } })).toBeNull();
    expect(radarUpdated({})).toBeNull();
  });
});

describe("parseTraffic", () => {
  it("joins the human and bot shares by timestamp", () => {
    const points = parseTraffic(timeseries, botClass);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ t: "2026-10-26T10:45:00Z", value: 88.12, human: 68.2, bot: 31.8 });
    // 11:15 is missing from the bot-class series: the point stays, its shares are null
    expect(points[2]).toEqual({ t: "2026-10-26T11:15:00Z", value: 100, human: null, bot: null });
    expect(points[3]?.bot).toBe(29.9);
  });

  it("drops steps without a value and survives a missing bot-class payload", () => {
    const points = parseTraffic({ result: { serie_0: { timestamps: ["2026-10-26T10:45:00Z", "2026-10-26T11:00:00Z"], values: ["1", ""] } } }, null);
    expect(points).toEqual([{ t: "2026-10-26T10:45:00Z", value: 1, human: null, bot: null }]);
    expect(parseTraffic({}, null)).toEqual([]);
  });
});

describe("parseOutages", () => {
  it("reads places, open-endedness, cause and link, newest first", () => {
    const rows = parseOutages(outages);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "outage-1",
      location: "Tonga",
      codes: ["TO"],
      type: "nationwide",
      region: null,
      since: "2026-10-26T06:10:00Z",
      until: null,
      cause: "cable cut",
      description: "Nationwide internet outage in Tonga after a submarine cable cut.",
      url: "https://radar.cloudflare.com/outage-center",
    });
    // no place: the network's name stands in, with no code to put on the map; a closed outage keeps its end
    expect(rows[1]?.location).toBe("Example Networks");
    expect(rows[1]?.codes).toEqual([]);
    expect(rows[1]?.type).toBe("network");
    expect(rows[1]?.until).toBe("2026-10-26T01:30:00Z");
    expect(rows[1]?.url).toBeNull();
  });

  it("keeps Radar's finer scope and drops malformed codes", () => {
    const [o] = parseOutages({ result: { annotations: [{ startDate: "2026-10-26T06:10:00Z", scope: " Colima, Michoacán, México ", locations: ["MX", "mex"], locationsDetails: [{ code: "MX", name: "Mexico" }], outage: { outageType: "REGIONAL", outageCause: "POWER_OUTAGE" } }] } });
    expect(o).toMatchObject({ codes: ["MX"], region: "Colima, Michoacán, México", type: "regional", cause: "power outage" });
  });

  it("places a network or regional outage by its network's or entity's country", () => {
    const [net, reg] = parseOutages({
      result: {
        annotations: [
          { startDate: "2026-10-27T17:15:00Z", asnsDetails: [{ asn: "27653", name: "Digicel Haiti", location: { code: "HT", name: "Haiti" } }], outage: { outageType: "NETWORK" } },
          { startDate: "2026-10-22T10:15:00Z", entities: [{ entityType: "GEOLOCATION", entityName: "Zhytomyr Oblast, Ukraine", entityLocation: "UA" }], outage: { outageType: "REGIONAL" } },
        ],
      },
    });
    expect(net?.codes).toEqual(["HT"]);
    expect(net?.location).toBe("Digicel Haiti");
    expect(reg?.codes).toEqual(["UA"]);
    expect(reg?.location).toBe("Zhytomyr Oblast, Ukraine");
  });

  it("joins region names that share a country", () => {
    expect(regions(["Sevastopol City, Ukraine", "Crimea, Ukraine"])).toBe("Sevastopol City and Crimea, Ukraine");
    expect(regions(["A, X", "B, X", "C, X", "A, X"])).toBe("A, B and C, X");
    expect(regions(["A, X", "B, Y"])).toBe("A, X; B, Y");
    expect(regions(["Somewhere"])).toBe("Somewhere");
    expect(regions([])).toBe("");
  });

  it("skips annotations without a start date and caps the list", () => {
    const many = { result: { annotations: Array.from({ length: 12 }, (_, i) => ({ startDate: `2026-10-26T0${i % 10}:00:00Z`, description: `o${i}` })) } };
    expect(parseOutages(many).length).toBe(10);
    expect(parseOutages({ result: { annotations: [{ description: "no date" }] } })).toEqual([]);
    expect(parseOutages({})).toEqual([]);
  });
});

describe("bgpTime", () => {
  it("reads Radar's BGP timestamps as UTC with or without a zone", () => {
    expect(bgpTime("2026-10-26T09:12:40")).toBe("2026-10-26T09:12:40.000Z");
    expect(bgpTime("2026-10-26T09:12:40Z")).toBe("2026-10-26T09:12:40.000Z");
    expect(bgpTime("2026-10-26T11:12:40+02:00")).toBe("2026-10-26T09:12:40.000Z");
    expect(bgpTime("")).toBeNull();
    expect(bgpTime("soon")).toBeNull();
    expect(bgpTime(undefined)).toBeNull();
  });
});

describe("parseHijacks", () => {
  it("names the networks, links the event and keeps Radar's order", () => {
    const rows = parseHijacks(hijacks);
    expect(rows.map((h) => h.id)).toEqual([169730, 169731]);
    expect(rows[0]).toEqual({
      id: 169730,
      url: "https://radar.cloudflare.com/routing/anomalies/event/hijack-169730",
      confidence: 9,
      start: "2026-10-26T09:12:40.000Z",
      end: "2026-10-26T11:02:05.000Z",
      hijacker: { asn: 64511, name: "Example Transit", country: "NG" },
      // one victim country for two networks: it applies to both
      victims: [
        { asn: 64500, name: "Example Bank", country: "BR" },
        { asn: 64501, name: "Example Cloud", country: "BR" },
      ],
      prefixes: ["203.0.113.0/24", "198.51.100.0/24", "192.0.2.0/24"],
      prefix_count: 4,
    });
  });

  it("fills what Radar leaves out from asn_info or null, and drops rows without an id", () => {
    const rows = parseHijacks(hijacks);
    expect(rows[1]).toMatchObject({ hijacker: { asn: 64502, name: null, country: null }, victims: [], end: null, prefix_count: 0 });
    expect(parseHijacks({})).toEqual([]);
    expect(parseHijacks(hijacks, 1)).toHaveLength(1);
  });

  it("ranks equal confidence by address blocks, then by recency", () => {
    const ev = (id: number, n: number, start: string) => ({ id, confidence_score: 12, hijacker_asn: 64500 + id, prefixes: Array.from({ length: n }, (_, i) => `192.0.2.${i}/32`), min_hijack_ts: start });
    const rows = parseHijacks({ result: { events: [ev(1, 1, "2026-10-26T10:00:00Z"), ev(2, 201, "2026-10-26T08:00:00Z"), ev(3, 1, "2026-10-26T11:00:00Z")] } });
    expect(rows.map((h) => h.id)).toEqual([2, 3, 1]);
  });
});

describe("eventCount", () => {
  it("prefers result_info.total_count over the page length", () => {
    expect(eventCount(leaks)).toBe(17);
    expect(eventCount(hijacks)).toBe(7);
    expect(eventCount({ result: { events: [{}, {}, {}] } })).toBe(3);
    expect(eventCount({})).toBe(0);
  });
});

describe("lastHourWindow", () => {
  it("floors to Radar's 15-minute grid and spans one hour", () => {
    expect(lastHourWindow(new Date("2026-10-26T12:07:33Z"))).toEqual({ dateStart: "2026-10-26T11:00:00.000Z", dateEnd: "2026-10-26T12:00:00.000Z" });
    expect(lastHourWindow(new Date("2026-10-26T12:59:59Z"))).toEqual({ dateStart: "2026-10-26T11:45:00.000Z", dateEnd: "2026-10-26T12:45:00.000Z" });
  });
});

describe("assemble", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const parts = {
    attacks: topAttacks,
    window: "1h" as const,
    ddos: { window: "1h" as const, payload: ddosAttacks },
    waf: { window: "1d" as const, origins: wafOrigins, rules: { US: managedRules } },
    traffic: timeseries,
    botClass,
    outages,
    leaks,
    hijacks,
  };

  it("builds the band's payload with Radar's timestamp, never the clock", () => {
    const p = assemble(parts, now);
    expect(p.generated_at).toBe("2026-10-26T12:00:00.000Z");
    expect(p.radar_updated).toBe("2026-10-26T11:45:00.000Z");
    expect(p.window).toBe("1h");
    expect(p.attacks.routes).toHaveLength(5);
    expect(p.attacks.top_targets[0]?.country).toBe("US");
    // DDoS routes and WAF origins carry their own windows; an origin without a rule mix has an empty one
    expect(p.attacks.ddos.window).toBe("1h");
    expect(p.attacks.ddos.routes.map((r) => `${r.origin}>${r.target}:${r.share}`)).toEqual(["ID>CY:18.4", "US>US:9.25"]);
    expect(p.attacks.waf.window).toBe("1d");
    expect(p.attacks.waf.origins.map((o) => [o.country, o.share, o.rules.length])).toEqual([
      ["US", 25.609, 3],
      ["CN", 6.519, 0],
      ["SG", 6.431, 0],
    ]);
    expect(p.attacks.waf.origins[0]?.rules[0]).toEqual({ name: "Directory Traversal", share: 44.8 });
    expect(p.traffic.points).toHaveLength(4);
    expect(p.outages[0]?.location).toBe("Tonga");
    expect(p.bgp).toEqual({ leaks: 17, hijacks: 7 });
    expect(p.hijacks.map((h) => h.id)).toEqual([169730, 169731]);
    expect(p.attribution).toEqual(ATTRIBUTION);
    expect(p.attribution.license).toBe("CC BY-NC 4.0");
    expect(p.stale).toBe(false);
  });

  it("falls back to the traffic series' timestamp when the attack payload has none", () => {
    const p = assemble({ ...parts, attacks: { result: { top_0: [] } }, window: "1d" }, now);
    expect(p.radar_updated).toBe("2026-10-26T11:30:00.000Z");
    expect(p.window).toBe("1d");
    expect(p.attacks.routes).toEqual([]);
  });

  it("survives empty payloads everywhere", () => {
    const p = assemble({ attacks: {}, window: "1d", ddos: { window: "1d", payload: {} }, waf: { window: "1d", origins: {}, rules: {} }, traffic: {}, botClass: null, outages: {}, leaks: {}, hijacks: {} }, now);
    expect(p.radar_updated).toBeNull();
    expect(p.attacks.routes).toEqual([]);
    expect(p.attacks.ddos).toEqual({ window: "1d", routes: [] });
    expect(p.attacks.waf).toEqual({ window: "1d", origins: [] });
    expect(p.traffic.points).toEqual([]);
    expect(p.outages).toEqual([]);
    expect(p.bgp).toEqual({ leaks: 0, hijacks: 0 });
    expect(p.hijacks).toEqual([]);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});
