import type { RadarBotClassGroups, RadarEvents, RadarOutages, RadarTimeseries, RadarTopAttacks } from "../../worker/src/assemble";

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

export const hijacks: RadarEvents = {
  result: { events: [{ id: 9 }, { id: 10 }] },
  result_info: { count: 2, page: 1, per_page: 5, total_count: 2 },
  success: true,
};
