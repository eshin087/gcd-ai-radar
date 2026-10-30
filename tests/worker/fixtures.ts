import type { RadarBotClassGroups, RadarEvents, RadarHijacks, RadarOutages, RadarSummary, RadarTimeseries, RadarTopAttacks, RadarTopLocations } from "../../worker/src/assemble";

/**
 * Recorded Radar payload shapes, after the API reference examples read on
 * 2026-10-26 (api.cloudflare.com/client/v4/radar): numbers come as strings,
 * `meta.lastUpdated` carries Radar's own timestamp, series are parallel
 * arrays under `serie_0`, events pages carry `result_info.total_count`.
 */

export const topAttacks: RadarTopAttacks = {
  result: {
    meta: {
      dateRange: [{ startTime: "2026-10-26T11:00:00Z", endTime: "2026-10-26T12:00:00Z" }],
      lastUpdated: "2026-10-26T11:45:00Z",
    },
    top_0: [
      { originCountryAlpha2: "US", originCountryName: "United States", targetCountryAlpha2: "FR", targetCountryName: "France", value: "4.323214" },
      { originCountryAlpha2: "US", originCountryName: "United States", targetCountryAlpha2: "US", targetCountryName: "United States", value: "3.1" },
      { originCountryAlpha2: "DE", originCountryName: "Germany", targetCountryAlpha2: "US", targetCountryName: "United States", value: "2.75" },
      { originCountryAlpha2: "CN", originCountryName: "China", targetCountryAlpha2: "FR", targetCountryName: "France", value: "1.2" },
      { originCountryAlpha2: "BR", originCountryName: "Brazil", targetCountryAlpha2: "IN", targetCountryName: "India", value: "0.9" },
    ],
  },
  success: true,
};

export const emptyAttacks: RadarTopAttacks = {
  result: { meta: { lastUpdated: "2026-10-26T11:45:00Z" }, top_0: [] },
  success: true,
};

export const timeseries: RadarTimeseries = {
  result: {
    meta: { lastUpdated: "2026-10-26T11:30:00Z", dateRange: [{ startTime: "2026-10-25T11:30:00Z", endTime: "2026-10-26T11:30:00Z" }] },
    serie_0: {
      timestamps: ["2026-10-26T10:45:00Z", "2026-10-26T11:00:00Z", "2026-10-26T11:15:00Z", "2026-10-26T11:30:00Z"],
      values: ["88.12", "91.4", "100", "97.333"],
    },
  },
  success: true,
};

export const botClass: RadarBotClassGroups = {
  result: {
    meta: { lastUpdated: "2026-10-26T11:30:00Z" },
    serie_0: {
      timestamps: ["2026-10-26T10:45:00Z", "2026-10-26T11:00:00Z", "2026-10-26T11:30:00Z"],
      human: ["68.2", "67.9", "70.1"],
      bot: ["31.8", "32.1", "29.9"],
    },
  },
  success: true,
};

export const outages: RadarOutages = {
  result: {
    annotations: [
      {
        id: "outage-1",
        dataSource: "ALL",
        description: "Nationwide internet outage in Tonga after a submarine cable cut.",
        startDate: "2026-10-26T06:10:00Z",
        endDate: null,
        locations: ["TO"],
        locationsDetails: [{ code: "TO", name: "Tonga" }],
        scope: null,
        asns: [],
        asnsDetails: [],
        outage: { outageCause: "CABLE_CUT", outageType: "NATIONWIDE" },
        linkedUrl: "https://radar.cloudflare.com/outage-center",
      },
      {
        id: "outage-2",
        description: "Power outage affects a regional network.",
        startDate: "2026-10-25T22:00:00Z",
        endDate: "2026-10-26T01:30:00Z",
        locationsDetails: [],
        asnsDetails: [{ asn: "189", name: "Example Networks" }],
        outage: { outageCause: "POWER_OUTAGE", outageType: "NETWORK" },
        linkedUrl: null,
      },
    ],
  },
  success: true,
};

export const leaks: RadarEvents = {
  result: { events: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] },
  result_info: { count: 5, page: 1, per_page: 5, total_count: 17 },
  success: true,
};

/** The top routes of DDoS protection alone: shares are of the attacks it stopped. */
export const ddosAttacks: RadarTopAttacks = {
  result: {
    meta: { lastUpdated: "2026-10-26T11:45:00Z" },
    top_0: [
      { originCountryAlpha2: "ID", originCountryName: "Indonesia", targetCountryAlpha2: "CY", targetCountryName: "Cyprus", value: "18.4" },
      { originCountryAlpha2: "US", originCountryName: "United States", targetCountryAlpha2: "US", targetCountryName: "United States", value: "9.25" },
    ],
  },
  success: true,
};

/** GET /radar/attacks/layer7/top/locations/origin?mitigationProduct=WAF, values as read through the Worker on 2026-10-30. */
export const wafOrigins: RadarTopLocations = {
  result: {
    top_0: [
      { originCountryAlpha2: "US", originCountryName: "United States", value: "25.609267" },
      { originCountryAlpha2: "CN", originCountryName: "China", value: "6.519063" },
      { originCountryAlpha2: "SG", originCountryName: "Singapore", value: "6.431367" },
    ],
  },
  success: true,
};

/** GET /radar/attacks/layer7/summary/MANAGED_RULES, values as read through the Worker on 2026-10-30. */
export const managedRules: RadarSummary = {
  result: {
    summary_0: {
      "Directory Traversal": "44.823332",
      "HTTP Anomaly": "17.106832",
      "Broken Authentication": "6.885497",
      SQLi: "6.806872",
      other: "50",
      XSS: "5.717299",
    },
  },
  success: true,
};

/** Shaped after the OpenAPI schema of GET /radar/bgp/hijacks/events (cloudflare/api-schemas, read 2026-10-30); the networks are documentation numbers. */
export const hijacks: RadarHijacks = {
  result: {
    asn_info: [
      { asn: 64511, country_code: "NG", org_name: "Example Transit" },
      { asn: 64500, country_code: "BR", org_name: "Example Bank" },
      { asn: 64501, country_code: "BR", org_name: "Example Cloud" },
    ],
    events: [
      {
        id: 169730,
        confidence_score: 9,
        hijacker_asn: 64511,
        hijacker_country: "NG",
        victim_asns: [64500, 64501],
        victim_countries: ["BR"],
        prefixes: ["203.0.113.0/24", "198.51.100.0/24", "192.0.2.0/24", "2001:db8::/32"],
        min_hijack_ts: "2026-10-26T09:12:40",
        max_hijack_ts: "2026-10-26T11:02:05",
        on_going_count: 2,
      },
      { id: 169731, confidence_score: 8, hijacker_asn: 64502, victim_asns: [], prefixes: [], min_hijack_ts: "2026-10-26T10:00:00Z", max_hijack_ts: "", on_going_count: 0 },
      { confidence_score: 10, hijacker_asn: 64503, min_hijack_ts: "2026-10-26T10:00:00Z" },
    ],
  },
  result_info: { count: 3, page: 1, per_page: 10, total_count: 7 },
  success: true,
};
