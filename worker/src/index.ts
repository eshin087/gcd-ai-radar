/**
 * GET /v1/internet: the home page's live internet band, assembled from
 * Cloudflare Radar (the last hour's top layer 7 attack routes, overall and
 * for DDoS protection alone; the top origins of what the WAF stopped and
 * their managed-rule mix; the 24-hour request series and its human/bot
 * split; the week's outages; the day's route leaks and high-confidence
 * hijacks) and cached for five minutes in one KV key plus isolate memory.
 *
 * Radar is CC BY-NC 4.0; the payload carries the attribution and the site
 * shows it. The token is the secret CLOUDFLARE_RADAR_TOKEN. When Radar is
 * unreachable, the last good payload (kept in KV for an hour) is served with
 * `stale: true`; with nothing to serve, a 503 lets the page show its idle
 * state.
 *
 * The cron trigger (wrangler.jsonc) is the collector's clock: every 30
 * minutes it starts collect.yml on GitHub (./dispatch.ts).
 */
import {
  assemble,
  lastHourWindow,
  parseOrigins,
  parseRoutes,
  type InternetPayload,
  type RadarBotClassGroups,
  type RadarEvents,
  type RadarHijacks,
  type RadarOutages,
  type RadarParts,
  type RadarSummary,
  type RadarTimeseries,
  type RadarTopAttacks,
  type RadarTopLocations,
  type Window,
} from "./assemble";
import { dispatchCollector } from "./dispatch";

const RADAR = "https://api.cloudflare.com/client/v4/radar";
/** Bumped with the payload's shape, so a deploy never serves a cached payload of the old one as fresh. */
const KEY = "internet:v4";
/** Seconds a payload is fresh; also the HTTP max-age. */
const FRESH_S = 300;
/** Seconds the last good payload stays in KV for stale service. */
const KEEP_S = 3600;
const UPSTREAM_TIMEOUT_MS = 8000;

interface Stored {
  payload: InternetPayload;
  /** Epoch milliseconds until which the payload counts as fresh. */
  fresh_until: number;
}

/** Shared cache for the isolate's lifetime: one payload, never request-scoped data. */
let memory: Stored | null = null;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...CORS, ...extra },
  });
}

class RadarError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function radar<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${RADAR}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "JSON");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "gcd-ai-radar-internet/0.1 (+https://gcd-ai-radar.vercel.app)" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new RadarError(`Radar ${path} answered ${res.status}`, res.status);
  const body = (await res.json()) as T & { success?: boolean };
  if (body.success === false) throw new RadarError(`Radar ${path} reported failure`);
  return body;
}

const ROUTES = { limit: "12", limitPerLocation: "3", limitDirection: "ORIGIN" };
const DDOS_ROUTES = { limit: "6", limitPerLocation: "2", limitDirection: "ORIGIN", mitigationProduct: "DDOS" };
const WAF_ORIGINS = { limit: "5", mitigationProduct: "WAF" };
/** WAF origins whose managed-rule mix is fetched. */
const RULE_ORIGINS = 2;

type Windowed<T> = { window: Window; payload: T };

/** A Radar call for the last hour, or for one day when the hour comes back empty. */
async function hourOrDay<T>(token: string, path: string, hour: Record<string, string>, params: Record<string, string>, empty: (t: T) => boolean): Promise<Windowed<T>> {
  const hourly = await radar<T>(path, { ...hour, ...params }, token);
  if (!empty(hourly)) return { window: "1h", payload: hourly };
  return { window: "1d", payload: await radar<T>(path, { dateRange: "1d", ...params }, token) };
}

const noRoutes = (p: RadarTopAttacks) => parseRoutes(p).length === 0;

/** The WAF's top origins, then the managed-rule mix of the first RULE_ORIGINS of them over the same window (a mix that fails or comes back empty is left out). */
async function wafOrigins(token: string, hour: Record<string, string>): Promise<RadarParts["waf"]> {
  const got = await hourOrDay<RadarTopLocations>(token, "/attacks/layer7/top/locations/origin", hour, WAF_ORIGINS, (p) => parseOrigins(p).length === 0);
  const span = got.window === "1h" ? hour : { dateRange: "1d" };
  const rules = await Promise.all(
    parseOrigins(got.payload)
      .slice(0, RULE_ORIGINS)
      .map(async (o) => [o.country, await radar<RadarSummary>("/attacks/layer7/summary/MANAGED_RULES", { ...span, location: o.country }, token).catch(() => ({}))] as const),
  );
  return { window: got.window, origins: got.payload, rules: Object.fromEntries(rules) };
}

/** Nine upstream calls in parallel and two after (at most fourteen with the one-day fallbacks); any failure of the nine fails the refresh so stale data is served instead of a half-empty band. */
async function fetchFresh(token: string, now: Date): Promise<InternetPayload> {
  const hour = lastHourWindow(now);
  const [all, ddos, waf, traffic, botClass, outages, leaks, hijacks] = await Promise.all([
    hourOrDay<RadarTopAttacks>(token, "/attacks/layer7/top/attacks", hour, ROUTES, noRoutes),
    // Radar ranks origin-target pairs for DDoS protection only; the WAF gets its origins and their rule mix
    hourOrDay<RadarTopAttacks>(token, "/attacks/layer7/top/attacks", hour, DDOS_ROUTES, noRoutes),
    wafOrigins(token, hour),
    radar<RadarTimeseries>("/http/timeseries", { dateRange: "1d", aggInterval: "15m" }, token),
    radar<RadarBotClassGroups>("/http/timeseries_groups/BOT_CLASS", { dateRange: "1d", aggInterval: "15m" }, token),
    // a week of outages: Radar annotates a few a week, so one day is often empty
    radar<RadarOutages>("/annotations/outages", { dateRange: "7d", limit: "10" }, token),
    radar<RadarEvents>("/bgp/leaks/events", { dateRange: "1d", per_page: "5" }, token),
    radar<RadarHijacks>("/bgp/hijacks/events", { dateRange: "1d", minConfidence: "8", sortBy: "CONFIDENCE", sortOrder: "DESC", per_page: "25" }, token),
  ]);
  return assemble({ attacks: all.payload, window: all.window, ddos, waf, traffic, botClass, outages, leaks, hijacks }, now);
}

async function readStored(env: Env): Promise<Stored | null> {
  try {
    const stored = await env.CACHE.get<Stored>(KEY, "json");
    return stored && typeof stored.fresh_until === "number" && stored.payload ? stored : null;
  } catch (e) {
    console.warn(JSON.stringify({ event: "kv_read_failed", error: String(e) }));
    return null;
  }
}

async function writeStored(env: Env, stored: Stored): Promise<void> {
  try {
    await env.CACHE.put(KEY, JSON.stringify(stored), { expirationTtl: KEEP_S });
  } catch (e) {
    console.warn(JSON.stringify({ event: "kv_write_failed", error: String(e) }));
  }
}

/** The payload to serve and whether it is fresh; null when nothing can be served. */
async function resolve(env: Env, ctx: ExecutionContext, now: Date): Promise<{ payload: InternetPayload; fresh: boolean } | null> {
  const t = now.getTime();
  if (memory && memory.fresh_until > t) return { payload: memory.payload, fresh: true };
  const stored = await readStored(env);
  if (stored && stored.fresh_until > t) {
    memory = stored;
    return { payload: stored.payload, fresh: true };
  }
  const token = env.CLOUDFLARE_RADAR_TOKEN;
  if (!token) {
    console.error(JSON.stringify({ event: "no_token" }));
  } else {
    try {
      const payload = await fetchFresh(token, now);
      const next: Stored = { payload, fresh_until: t + FRESH_S * 1000 };
      memory = next;
      ctx.waitUntil(writeStored(env, next));
      return { payload, fresh: true };
    } catch (e) {
      console.error(JSON.stringify({ event: "radar_failed", error: String(e), status: e instanceof RadarError ? e.status : undefined }));
    }
  }
  const last = stored ?? memory;
  if (last) return { payload: { ...last.payload, stale: true }, fresh: false };
  return null;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method not allowed" }, 405, { Allow: "GET, HEAD, OPTIONS" });
    if (url.pathname !== "/v1/internet") return json({ error: "not found", routes: ["/v1/internet"] }, 404, { "Cache-Control": "public, max-age=60" });

    const now = new Date();
    let res: Response;
    try {
      const got = await resolve(env, ctx, now);
      if (!got) res = json({ error: "Cloudflare Radar unavailable" }, 503, { "Cache-Control": "no-store", "Retry-After": "60" });
      else {
        const age = Math.max(0, Math.floor((now.getTime() - Date.parse(got.payload.generated_at)) / 1000));
        res = json(got.payload, 200, {
          "Cache-Control": got.fresh ? `public, max-age=${FRESH_S}` : "public, max-age=60",
          Age: String(age),
        });
      }
    } catch (e) {
      console.error(JSON.stringify({ event: "unhandled", error: String(e) }));
      res = json({ error: "internal error" }, 500, { "Cache-Control": "no-store" });
    }
    return request.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
  },

  async scheduled(controller, env): Promise<void> {
    const token = env.GITHUB_DISPATCH_TOKEN;
    if (!token) {
      console.error(JSON.stringify({ event: "dispatch_no_token" }));
      return;
    }
    try {
      const result = await dispatchCollector(token);
      console.log(JSON.stringify({ event: "dispatch", result, cron: controller.cron }));
    } catch (e) {
      console.error(JSON.stringify({ event: "dispatch_failed", error: String(e) }));
    }
  },
} satisfies ExportedHandler<Env>;
