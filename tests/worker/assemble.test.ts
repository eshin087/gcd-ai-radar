import { describe, expect, it } from "vitest";
import { ATTRIBUTION, assemble, eventCount, lastHourWindow, num, parseOutages, parseRoutes, parseTraffic, radarUpdated, topTargets } from "../../worker/src/assemble";
import { botClass, emptyAttacks, hijacks, leaks, outages, timeseries, topAttacks } from "./fixtures";

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
      location: "Tonga",
      since: "2026-10-26T06:10:00Z",
      until: null,
      cause: "cable cut",
      description: "Nationwide internet outage in Tonga after a submarine cable cut.",
      url: "https://radar.cloudflare.com/outage-center",
    });
    // no place: the network's name stands in; a closed outage keeps its end
    expect(rows[1]?.location).toBe("Example Networks");
    expect(rows[1]?.until).toBe("2026-10-26T01:30:00Z");
    expect(rows[1]?.url).toBeNull();
  });

  it("skips annotations without a start date and caps the list", () => {
    const many = { result: { annotations: Array.from({ length: 12 }, (_, i) => ({ startDate: `2026-10-26T0${i % 10}:00:00Z`, description: `o${i}` })) } };
    expect(parseOutages(many).length).toBe(10);
    expect(parseOutages({ result: { annotations: [{ description: "no date" }] } })).toEqual([]);
    expect(parseOutages({})).toEqual([]);
  });
});

describe("eventCount", () => {
  it("prefers result_info.total_count over the page length", () => {
    expect(eventCount(leaks)).toBe(17);
    expect(eventCount(hijacks)).toBe(2);
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
  const parts = { attacks: topAttacks, window: "1h" as const, traffic: timeseries, botClass, outages, leaks, hijacks };

  it("builds the band's payload with Radar's timestamp, never the clock", () => {
    const p = assemble(parts, now);
    expect(p.generated_at).toBe("2026-10-26T12:00:00.000Z");
    expect(p.radar_updated).toBe("2026-10-26T11:45:00.000Z");
    expect(p.window).toBe("1h");
    expect(p.attacks.routes).toHaveLength(5);
    expect(p.attacks.top_targets[0]?.country).toBe("US");
    expect(p.traffic.points).toHaveLength(4);
    expect(p.outages[0]?.location).toBe("Tonga");
    expect(p.bgp).toEqual({ leaks: 17, hijacks: 2 });
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
    const p = assemble({ attacks: {}, window: "1d", traffic: {}, botClass: null, outages: {}, leaks: {}, hijacks: {} }, now);
    expect(p.radar_updated).toBeNull();
    expect(p.attacks.routes).toEqual([]);
    expect(p.traffic.points).toEqual([]);
    expect(p.outages).toEqual([]);
    expect(p.bgp).toEqual({ leaks: 0, hijacks: 0 });
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});
