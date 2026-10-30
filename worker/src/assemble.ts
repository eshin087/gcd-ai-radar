/**
 * Pure functions from Cloudflare Radar payloads to the band's response shape.
 * Nothing here touches the network, KV or Worker globals, so the root test
 * suite (tests/worker) runs them under Node with recorded payloads.
 *
 * Radar returns every number as a numeric string ("4.323214"); every parser
 * here tolerates a missing or malformed field by dropping the row rather than
 * throwing, so one odd row never empties the band.
 */

/** A top layer 7 attack route: share is a percentage of all layer 7 attacks in the window (in `ddos`, of the attacks Cloudflare's DDoS protection stopped). */
export interface Route {
  origin: string;
  origin_name: string;
  target: string;
  target_name: string;
  share: number;
}

/** A window of data: the last hour, or one day when Radar's hour came back empty. */
export type Window = "1h" | "1d";

/** A share of something by name: a WAF managed-rule category ("SQLi") and its percentage. */
export interface Part {
  name: string;
  share: number;
}

/**
 * A country the requests Cloudflare's WAF stopped come from: `share` is its
 * percentage of those requests, `rules` the managed-rule categories that
 * matched requests from there, largest first. Radar ranks origin-target pairs
 * for DDoS only (WAF pairs come back empty), so a WAF stop has an origin and
 * no target.
 */
export interface WafOrigin {
  country: string;
  name: string;
  share: number;
  rules: Part[];
}

export interface Network {
  asn: number;
  /** The operator's name from Radar's `asn_info`, or null when Radar gives none. */
  name: string | null;
  /** Alpha-2 code, or null. */
  country: string | null;
}

/** A BGP hijack Radar detected: the hijacker announced address blocks (`prefixes`) that belong to the victims. */
export interface Hijack {
  id: number;
  /** The event's page on radar.cloudflare.com. */
  url: string;
  /** Radar's confidence score: 8 and up is "high" (the schema gives no upper bound; 12 has been seen). */
  confidence: number;
  /** First and last hijacking announcement seen (ISO 8601). */
  start: string;
  end: string | null;
  hijacker: Network;
  victims: Network[];
  /** Up to three of the announced prefixes; `prefix_count` has the total. */
  prefixes: string[];
  prefix_count: number;
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
  /** Radar's annotation id, or null. */
  id: string | null;
  location: string;
  /** The alpha-2 codes of the places affected, in Radar's order. */
  codes: string[];
  /** Radar's outage type in lower case: "nationwide", "regional", "network" or "platform"; null when absent. */
  type: string | null;
  /** Radar's finer scope where it gives one ("Colima, Michoacán, México"), else null. */
  region: string | null;
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
  /**
   * `ddos`: the top routes of the attacks Cloudflare's DDoS protection stopped, each share a percentage of those;
   * `waf`: the top origins of the requests its WAF stopped, with their managed-rule mix.
   */
  attacks: { routes: Route[]; top_targets: TopTarget[]; ddos: { window: Window; routes: Route[] }; waf: { window: Window; origins: WafOrigin[] } };
  traffic: { points: TrafficPoint[] };
  /** Outages Radar annotated in the last seven days, newest first. */
  outages: Outage[];
  bgp: { leaks: number; hijacks: number };
  /** High-confidence hijacks of the last 24 hours: most confident first, then the most address blocks, then the newest (at most five). */
  hijacks: Hijack[];
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

export interface RadarTopLocations {
  result?: { meta?: RadarMeta; top_0?: { originCountryAlpha2?: string; originCountryName?: string; value?: string }[] };
  success?: boolean;
}

/** `summary/{dimension}`: one percentage per key, as numeric strings. */
export interface RadarSummary {
  result?: { meta?: RadarMeta; summary_0?: Record<string, string> };
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
      scope?: string | null;
      locationsDetails?: { code?: string; name?: string }[];
      asnsDetails?: { asn?: string; name?: string; location?: { code?: string; name?: string } }[];
      entities?: { entityType?: string; entityName?: string; entityLocation?: string }[];
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

/** `GET /radar/bgp/hijacks/events`, as the OpenAPI schema (cloudflare/api-schemas, read 2026-10-30) lists it. */
export interface RadarHijacks {
  result?: {
    asn_info?: { asn?: number; country_code?: string; org_name?: string }[];
    events?: {
      id?: number;
      confidence_score?: number;
      hijacker_asn?: number;
      hijacker_country?: string;
      victim_asns?: number[];
      victim_countries?: string[];
      prefixes?: string[];
      min_hijack_ts?: string;
      max_hijack_ts?: string;
      on_going_count?: number;
    }[];
  };
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

/** Top origin countries in Radar's order, skipping rows without a code or a readable share. */
export function parseOrigins(payload: RadarTopLocations): { country: string; name: string; share: number }[] {
  const out: { country: string; name: string; share: number }[] = [];
  for (const row of payload.result?.top_0 ?? []) {
    const country = alpha2(row.originCountryAlpha2), share = num(row.value);
    if (!country || share === null || share < 0) continue;
    out.push({ country, name: row.originCountryName?.trim() || country, share: round(share, 3) });
  }
  return out.sort((a, b) => b.share - a.share);
}

/** A summary's named shares, largest first, without Radar's catch-all "other", at most `limit`. */
export function parseSummary(payload: RadarSummary, limit = 3): Part[] {
  const out: Part[] = [];
  for (const [name, v] of Object.entries(payload.result?.summary_0 ?? {})) {
    const share = num(v);
    if (!name.trim() || name.trim().toLowerCase() === "other" || share === null || share <= 0) continue;
    out.push({ name: name.trim(), share: round(share, 1) });
  }
  return out.sort((a, b) => b.share - a.share).slice(0, limit);
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

/** Region names as one place: ["Sevastopol City, Ukraine", "Crimea, Ukraine"] reads "Sevastopol City and Crimea, Ukraine"; "" for none. */
export function regions(names: string[]): string {
  const list = [...new Set(names.filter(Boolean))];
  if (list.length < 2) return list[0] ?? "";
  const tail = list[0]!.slice(list[0]!.lastIndexOf(",") + 1).trim();
  const shared = list.every((n) => n.includes(",") && n.slice(n.lastIndexOf(",") + 1).trim() === tail);
  if (!shared) return list.join("; ");
  const heads = list.map((n) => n.slice(0, n.lastIndexOf(",")).trim());
  return `${heads.slice(0, -1).join(", ")} and ${heads[heads.length - 1]}, ${tail}`;
}

/** Radar's enum words in plain lower case: "CABLE_CUT" to "cable cut". */
const words = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().toLowerCase().replace(/_/g, " ") : null);

/** Outage annotations as the band reads them: the places first, then the networks; `until` null while open. */
export function parseOutages(payload: RadarOutages, limit = 10): Outage[] {
  const rows = payload.result?.annotations ?? [];
  const out: Outage[] = [];
  for (const a of rows) {
    if (typeof a.startDate !== "string" || !Number.isFinite(Date.parse(a.startDate))) continue;
    const places = (a.locationsDetails ?? []).map((l) => l.name?.trim()).filter((n): n is string => !!n);
    const networks = (a.asnsDetails ?? []).map((n) => n.name?.trim()).filter((n): n is string => !!n);
    // a regional outage may name its regions only as GEOLOCATION entities ("Zhytomyr Oblast, Ukraine")
    const areas = regions((a.entities ?? []).filter((e) => e.entityType === "GEOLOCATION").map((e) => e.entityName?.trim() ?? ""));
    const location = places.length ? places.join(", ") : networks.length ? networks.join(", ") : areas || "Unknown location";
    // the places Radar names, else the countries of the networks or entities it names (a network outage carries only those)
    const codes = [
      ...new Set(
        [...(a.locationsDetails ?? []).map((l) => l.code), ...(a.locations ?? []), ...(a.asnsDetails ?? []).map((n) => n.location?.code), ...(a.entities ?? []).map((e) => e.entityLocation)]
          .map(alpha2)
          .filter((c): c is string => !!c),
      ),
    ];
    const until = typeof a.endDate === "string" && Number.isFinite(Date.parse(a.endDate)) ? a.endDate : null;
    out.push({
      id: typeof a.id === "string" && a.id ? a.id : null,
      location,
      codes,
      type: words(a.outage?.outageType),
      region: typeof a.scope === "string" && a.scope.trim() ? a.scope.trim() : null,
      since: a.startDate,
      until,
      cause: words(a.outage?.outageCause),
      description: a.description?.trim() || `${location} outage`,
      url: typeof a.linkedUrl === "string" && /^https?:\/\//.test(a.linkedUrl) ? a.linkedUrl : null,
    });
    if (out.length >= limit) break;
  }
  return out.sort((x, y) => Date.parse(y.since) - Date.parse(x.since));
}

/** Radar's BGP timestamps, with or without a zone designator (UTC either way), to ISO 8601; null when unreadable. */
export function bgpTime(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  const ms = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The public page of one hijack on radar.cloudflare.com. */
export const hijackUrl = (id: number) => `https://radar.cloudflare.com/routing/anomalies/event/hijack-${id}`;

/**
 * Hijack events, most confident first, then the most address blocks, then the
 * newest, each with its networks named from `asn_info`. Rows without an id, a
 * confidence, a hijacker or a start time are dropped.
 */
export function parseHijacks(payload: RadarHijacks, limit = 5): Hijack[] {
  const info = new Map<number, { name: string | null; country: string | null }>();
  for (const a of payload.result?.asn_info ?? []) {
    if (typeof a.asn === "number") info.set(a.asn, { name: a.org_name?.trim() || null, country: alpha2(a.country_code) });
  }
  const network = (asn: number, country?: unknown): Network => ({ asn, name: info.get(asn)?.name ?? null, country: alpha2(country) ?? info.get(asn)?.country ?? null });
  const out: Hijack[] = [];
  for (const e of payload.result?.events ?? []) {
    const id = e.id, confidence = num(e.confidence_score), start = bgpTime(e.min_hijack_ts);
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || confidence === null || typeof e.hijacker_asn !== "number" || !start) continue;
    const victimAsns = (e.victim_asns ?? []).filter((n): n is number => typeof n === "number");
    const prefixes = (e.prefixes ?? []).filter((p): p is string => typeof p === "string" && !!p.trim());
    // victim_countries is read beside victim_asns only when the two line up (or there is one country); asn_info covers the rest
    const vc = e.victim_countries ?? [];
    const victimCountry = (i: number) => (vc.length === victimAsns.length ? vc[i] : vc.length === 1 ? vc[0] : undefined);
    out.push({
      id,
      url: hijackUrl(id),
      confidence,
      start,
      end: bgpTime(e.max_hijack_ts),
      hijacker: network(e.hijacker_asn, e.hijacker_country),
      victims: victimAsns.slice(0, 3).map((asn, i) => network(asn, victimCountry(i))),
      prefixes: prefixes.slice(0, 3),
      prefix_count: prefixes.length,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence || b.prefix_count - a.prefix_count || Date.parse(b.start) - Date.parse(a.start)).slice(0, limit);
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
  window: Window;
  /** The top routes again, DDoS protection only, with the window they cover. */
  ddos: { window: Window; payload: RadarTopAttacks };
  /** The WAF's top origins, and the managed-rule summary for some of them, keyed by country code. */
  waf: { window: Window; origins: RadarTopLocations; rules: Record<string, RadarSummary> };
  traffic: RadarTimeseries;
  botClass: RadarBotClassGroups | null;
  outages: RadarOutages;
  leaks: RadarEvents;
  hijacks: RadarHijacks;
}

/** The response body from the Radar payloads. */
export function assemble(parts: RadarParts, now: Date): InternetPayload {
  const routes = parseRoutes(parts.attacks);
  const origins = parseOrigins(parts.waf.origins).slice(0, 5).map((o) => ({ ...o, rules: parseSummary(parts.waf.rules[o.country] ?? {}) }));
  return {
    generated_at: now.toISOString(),
    radar_updated: radarUpdated(parts.attacks) ?? radarUpdated(parts.traffic),
    window: parts.window,
    attacks: {
      routes,
      top_targets: topTargets(routes),
      ddos: { window: parts.ddos.window, routes: parseRoutes(parts.ddos.payload) },
      waf: { window: parts.waf.window, origins },
    },
    traffic: { points: parseTraffic(parts.traffic, parts.botClass) },
    outages: parseOutages(parts.outages),
    bgp: { leaks: eventCount(parts.leaks), hijacks: eventCount(parts.hijacks) },
    hijacks: parseHijacks(parts.hijacks),
    attribution: { ...ATTRIBUTION },
    stale: false,
  };
}
