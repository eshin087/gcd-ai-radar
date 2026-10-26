/**
 * Pure functions from Cloudflare Radar payloads to the band's response shape.
 * Nothing here touches the network, KV or Worker globals, so the root test
 * suite (tests/worker) runs them under Node with recorded payloads.
 *
 * Radar returns every number as a numeric string ("4.323214"); every parser
 * here tolerates a missing or malformed field by dropping the row rather than
 * throwing, so one odd row never empties the band.
 */

/** A top layer 7 attack route: share is a percentage of all layer 7 attacks in the window. */
export interface Route {
  origin: string;
  origin_name: string;
  target: string;
  target_name: string;
  share: number;
}

export interface TopTarget {
  country: string;
  name: string;
  share: number;
}

/** One 15-minute step of the traffic pulse: value is Radar's normalised request volume, human and bot the share of requests in percent (null when the bot-class series had no step at that time). */
export interface TrafficPoint {
  t: string;
  value: number;
  human: number | null;
  bot: number | null;
}

export interface Outage {
  location: string;
  since: string;
  /** null while the outage is open in Radar's annotation. */
  until: string | null;
  cause: string | null;
  description: string;
  url: string | null;
}

export interface InternetPayload {
  /** When the Worker assembled this payload (ISO 8601). */
  generated_at: string;
  /** Radar's own `lastUpdated` for the attack routes, the timestamp the band shows; never the clock. */
  radar_updated: string | null;
  /** The attack-route window: the last hour, or one day when the hour came back empty. */
  window: "1h" | "1d";
  attacks: { routes: Route[]; top_targets: TopTarget[] };
  traffic: { points: TrafficPoint[] };
  outages: Outage[];
  bgp: { leaks: number; hijacks: number };
  attribution: { name: string; url: string; license: string; license_url: string };
  /** True when Radar could not be reached and this is the last good payload, up to an hour old. */
  stale: boolean;
}

export const ATTRIBUTION = {
  name: "Cloudflare Radar",
  url: "https://radar.cloudflare.com/",
  license: "CC BY-NC 4.0",
  license_url: "https://creativecommons.org/licenses/by-nc/4.0/",
} as const;

/* Radar shapes, as the API reference documents them (read 2026-10-26). Every field is optional here because the parsers must survive a partial payload. */

export interface RadarMeta {
  lastUpdated?: string;
  dateRange?: { startTime?: string; endTime?: string }[];
}

export interface RadarTopAttacks {
  result?: {
    meta?: RadarMeta;
    top_0?: { originCountryAlpha2?: string; originCountryName?: string; targetCountryAlpha2?: string; targetCountryName?: string; value?: string }[];
  };
  success?: boolean;
}

export interface RadarTimeseries {
  result?: { meta?: RadarMeta; serie_0?: { timestamps?: string[]; values?: string[] } };
  success?: boolean;
}

export interface RadarBotClassGroups {
  result?: { meta?: RadarMeta; serie_0?: { timestamps?: string[]; human?: string[]; bot?: string[] } };
  success?: boolean;
}

export interface RadarOutages {
  result?: {
    annotations?: {
      id?: string;
      dataSource?: string;
      locations?: string[];
      asns?: number[];
      startDate?: string;
      endDate?: string | null;
      description?: string;
      linkedUrl?: string | null;
      locationsDetails?: { code?: string; name?: string }[];
      asnsDetails?: { asn?: string; name?: string }[];
      outage?: { outageCause?: string; outageType?: string };
    }[];
  };
  success?: boolean;
}

export interface RadarEvents {
  result?: { events?: unknown[] };
  result_info?: { count?: number; page?: number; per_page?: number; total_count?: number };
  success?: boolean;
}

/** Radar's numeric strings to numbers; anything else to null. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A two-letter country code or null. */
function alpha2(v: unknown): string | null {
  return typeof v === "string" && /^[A-Z]{2}$/.test(v) ? v : null;
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/** Routes in Radar's order (largest share first), skipping rows without both codes or a readable share; same-country rows stay since they are real routes. */
export function parseRoutes(payload: RadarTopAttacks): Route[] {
  const rows = payload.result?.top_0 ?? [];
  const out: Route[] = [];
  for (const row of rows) {
    const origin = alpha2(row.originCountryAlpha2);
    const target = alpha2(row.targetCountryAlpha2);
    const share = num(row.value);
    if (!origin || !target || share === null || share < 0) continue;
    out.push({ origin, origin_name: row.originCountryName?.trim() || origin, target, target_name: row.targetCountryName?.trim() || target, share: round(share, 3) });
  }
  return out.sort((a, b) => b.share - a.share);
}

/** Targets summed over the routes, largest first, at most `limit`. */
export function topTargets(routes: Route[], limit = 5): TopTarget[] {
  const sums = new Map<string, TopTarget>();
  for (const r of routes) {
    const t = sums.get(r.target);
    if (t) t.share = round(t.share + r.share, 3);
    else sums.set(r.target, { country: r.target, name: r.target_name, share: r.share });
  }
  return [...sums.values()].sort((a, b) => b.share - a.share).slice(0, limit);
}

/** Radar's `lastUpdated` when it parses as a date, else null. */
export function radarUpdated(payload: { result?: { meta?: RadarMeta } }): string | null {
  const v = payload.result?.meta?.lastUpdated;
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * The traffic pulse: one point per timestamp of the request series, with the
 * human and bot shares joined by timestamp from the bot-class series. Steps
 * missing from the bot-class series carry null shares; steps missing a value
 * are dropped.
 */
export function parseTraffic(series: RadarTimeseries, groups: RadarBotClassGroups | null): TrafficPoint[] {
  const ts = series.result?.serie_0?.timestamps ?? [];
  const values = series.result?.serie_0?.values ?? [];
  const shares = new Map<string, { human: number | null; bot: number | null }>();
  const g = groups?.result?.serie_0;
  if (g?.timestamps) {
    g.timestamps.forEach((t, i) => {
      if (typeof t === "string") shares.set(t, { human: num(g.human?.[i]), bot: num(g.bot?.[i]) });
    });
  }
  const out: TrafficPoint[] = [];
  ts.forEach((t, i) => {
    const value = num(values[i]);
    if (typeof t !== "string" || value === null) return;
    const s = shares.get(t);
    out.push({ t, value: round(value, 3), human: s?.human ?? null, bot: s?.bot ?? null });
  });
  return out;
}

/** Outage annotations as the band reads them: the places first, then the networks; `until` null while open. */
export function parseOutages(payload: RadarOutages, limit = 10): Outage[] {
  const rows = payload.result?.annotations ?? [];
  const out: Outage[] = [];
  for (const a of rows) {
    if (typeof a.startDate !== "string" || !Number.isFinite(Date.parse(a.startDate))) continue;
    const places = (a.locationsDetails ?? []).map((l) => l.name?.trim()).filter((n): n is string => !!n);
    const networks = (a.asnsDetails ?? []).map((n) => n.name?.trim()).filter((n): n is string => !!n);
    const location = places.length ? places.join(", ") : networks.length ? networks.join(", ") : "Unknown location";
    const until = typeof a.endDate === "string" && Number.isFinite(Date.parse(a.endDate)) ? a.endDate : null;
    const cause = typeof a.outage?.outageCause === "string" && a.outage.outageCause ? a.outage.outageCause.toLowerCase().replace(/_/g, " ") : null;
    out.push({
      location,
      since: a.startDate,
      until,
      cause,
      description: a.description?.trim() || `${location} outage`,
      url: typeof a.linkedUrl === "string" && /^https?:\/\//.test(a.linkedUrl) ? a.linkedUrl : null,
    });
    if (out.length >= limit) break;
  }
  return out.sort((x, y) => Date.parse(y.since) - Date.parse(x.since));
}

/** The number of events in the window: `result_info.total_count`, falling back to the page's length. */
export function eventCount(payload: RadarEvents): number {
  const total = payload.result_info?.total_count;
  if (typeof total === "number" && Number.isFinite(total) && total >= 0) return Math.floor(total);
  return payload.result?.events?.length ?? 0;
}

/** The last hour, floored to Radar's 15-minute grid, as `dateStart`/`dateEnd` query values. */
export function lastHourWindow(now: Date): { dateStart: string; dateEnd: string } {
  const step = 15 * 60 * 1000;
  const end = Math.floor(now.getTime() / step) * step;
  return { dateStart: new Date(end - 60 * 60 * 1000).toISOString(), dateEnd: new Date(end).toISOString() };
}

export interface RadarParts {
  attacks: RadarTopAttacks;
  window: "1h" | "1d";
  traffic: RadarTimeseries;
  botClass: RadarBotClassGroups | null;
  outages: RadarOutages;
  leaks: RadarEvents;
  hijacks: RadarEvents;
}

/** The response body from the six Radar payloads. */
export function assemble(parts: RadarParts, now: Date): InternetPayload {
  const routes = parseRoutes(parts.attacks);
  return {
    generated_at: now.toISOString(),
    radar_updated: radarUpdated(parts.attacks) ?? radarUpdated(parts.traffic),
    window: parts.window,
    attacks: { routes, top_targets: topTargets(routes) },
    traffic: { points: parseTraffic(parts.traffic, parts.botClass) },
    outages: parseOutages(parts.outages),
    bgp: { leaks: eventCount(parts.leaks), hijacks: eventCount(parts.hijacks) },
    attribution: { ...ATTRIBUTION },
    stale: false,
  };
}
