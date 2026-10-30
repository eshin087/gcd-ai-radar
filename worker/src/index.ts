/**
 * GET /v1/internet: the home page's live internet band, assembled from six
 * Cloudflare Radar calls (the last hour's top layer 7 attack routes, the
 * 24-hour request series and its human/bot split, outages, route leaks and
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
import { assemble, lastHourWindow, parseRoutes, type InternetPayload, type RadarBotClassGroups, type RadarEvents, type RadarOutages, type RadarTimeseries, type RadarTopAttacks } from "./assemble";
import { dispatchCollector } from "./dispatch";

const RADAR = "https://api.cloudflare.com/client/v4/radar";
const KEY = "internet:v1";
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

/** The six (at most seven) upstream calls, in parallel; any failure fails the refresh so stale data is served instead of a half-empty band. */
async function fetchFresh(token: string, now: Date): Promise<InternetPayload> {
  const hour = lastHourWindow(now);
  const [attacksHour, traffic, botClass, outages, leaks, hijacks] = await Promise.all([
    radar<RadarTopAttacks>("/attacks/layer7/top/attacks", { ...hour, limit: "12", limitPerLocation: "3", limitDirection: "ORIGIN" }, token),
    radar<RadarTimeseries>("/http/timeseries", { dateRange: "1d", aggInterval: "15m" }, token),
    radar<RadarBotClassGroups>("/http/timeseries_groups/BOT_CLASS", { dateRange: "1d", aggInterval: "15m" }, token),
    radar<RadarOutages>("/annotations/outages", { dateRange: "1d", limit: "10" }, token),
    radar<RadarEvents>("/bgp/leaks/events", { dateRange: "1d", per_page: "5" }, token),
    radar<RadarEvents>("/bgp/hijacks/events", { dateRange: "1d", minConfidence: "8", per_page: "5" }, token),
  ]);
  let attacks = attacksHour;
  let window: "1h" | "1d" = "1h";
  if (parseRoutes(attacksHour).length === 0) {
    attacks = await radar<RadarTopAttacks>("/attacks/layer7/top/attacks", { dateRange: "1d", limit: "12", limitPerLocation: "3", limitDirection: "ORIGIN" }, token);
    window = "1d";
  }
  return assemble({ attacks, window, traffic, botClass, outages, leaks, hijacks }, now);
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
