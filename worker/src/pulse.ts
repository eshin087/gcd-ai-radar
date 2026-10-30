/**
 * GET /v1/pulse: how many CVEs NVD published in the last 24 hours and the
 * last seven days, for the home page's counters between site builds (the
 * site's own CVE file, data/stats/cves-recent.json, is refreshed about once
 * a day).
 *
 * Each count is NVD CVE API 2.0's totalResults for a publish-date window,
 * asked with resultsPerPage=1 and the value-less noRejected flag: the query
 * the collector's countPublished sends (collector/stats/nvd.ts), with the
 * same timestamp format (milliseconds and an explicit +00:00 offset), over
 * the rolling windows lib/home.ts counts the CVE file by (published at or
 * after the instant minus 24 hours, or minus seven times that). Two calls per
 * refresh and no API key: NVD allows 5 requests per rolling 30 s without one.
 *
 * Cached in KV (pulse:v1) and isolate memory. A payload is fresh for ten
 * minutes; an older one is served at once while a background refresh,
 * guarded by a 60-second lock (KV pulse:lock plus the isolate), asks NVD
 * again. Only with nothing stored does a visitor wait for NVD, and a failure
 * then answers 503. The last good payload stays in KV for six hours and is
 * marked `stale: true` once it is over an hour old, which, with a refresh
 * started on every request past ten minutes, means NVD has been failing.
 *
 * Nothing here names a Worker global (Env, KVNamespace, ExecutionContext):
 * the root test suite and typecheck run this file under Node, so KV, the
 * context and fetch come in as the small structural types below.
 */

export const PULSE_KEY = "pulse:v1";
export const PULSE_LOCK_KEY = "pulse:lock";
/** Seconds a payload is fresh. */
export const FRESH_S = 600;
/** The HTTP max-age of a served payload. */
export const MAX_AGE_S = 300;
/** Seconds after which a served payload is marked stale. */
export const STALE_S = 3600;
/** Seconds the last good payload stays in KV; nothing older is served. */
export const KEEP_S = 6 * 3600;
/** Seconds a refresh holds the lock; also KV's minimum expirationTtl. A failed refresh keeps it, so NVD is asked at most once a minute. */
export const LOCK_S = 60;
const UPSTREAM_TIMEOUT_MS = 8000;
const DAY_MS = 86_400_000;

export const NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0";
/** The Worker's User-Agent, the one index.ts sends to Radar. */
export const USER_AGENT = "gcd-ai-radar-internet/0.1 (+https://gcd-ai-radar.vercel.app)";
/** As the collector's NVD_SOURCE: NVD's terms ask for the notice in `license` wherever the data is shown. */
export const NVD_SOURCE = {
  name: "NVD",
  url: "https://nvd.nist.gov/developers/vulnerabilities",
  license: "NIST data, public domain. This product uses data from the NVD API but is not endorsed or certified by the NVD.",
} as const;

export interface PulseWindow {
  /** ISO instant 24 hours before `to`. */
  day_from: string;
  /** ISO instant seven times 24 hours before `to`. */
  week_from: string;
  /** ISO instant both windows end at: when NVD was asked. */
  to: string;
}

export interface PulsePayload {
  /** When NVD was asked (ISO 8601); the same instant as window.to. */
  fetched_at: string;
  /** CVEs NVD published in [day_from, to] and [week_from, to], rejected ones left out. */
  nvd: { day: number; week: number };
  window: PulseWindow;
  /** True when the payload is over an hour old because refreshes have failed. */
  stale: boolean;
  source: { name: string; url: string; license: string };
}

/* ---------- pure helpers ---------- */

export function pulseWindow(now: Date): PulseWindow {
  const t = now.getTime();
  return {
    day_from: new Date(t - DAY_MS).toISOString(),
    week_from: new Date(t - 7 * DAY_MS).toISOString(),
    to: new Date(t).toISOString(),
  };
}

/** An instant in the form the collector's nvdStamp sends ("2026-10-29T00:00:00.000+00:00"), at any time of day. */
export function nvdStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/Z$/, "+00:00");
}

/** The collector's countPublished query for [from, to]: URLSearchParams encoding, then the noRejected flag. */
export function nvdCountUrl(from: string, to: string): string {
  const query = new URLSearchParams({ pubStartDate: nvdStamp(from), pubEndDate: nvdStamp(to), resultsPerPage: "1" }).toString();
  return `${NVD_BASE}?${query}&noRejected`;
}

export function pulseUrls(w: PulseWindow): { day: string; week: string } {
  return { day: nvdCountUrl(w.day_from, w.to), week: nvdCountUrl(w.week_from, w.to) };
}

/** NVD's totalResults, or null for anything but a non-negative integer. */
export function parseTotal(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const n = (body as { totalResults?: unknown }).totalResults;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

export function buildPulse(day: number, week: number, w: PulseWindow): PulsePayload {
  return { fetched_at: w.to, nvd: { day, week }, window: { ...w }, stale: false, source: { ...NVD_SOURCE } };
}

export function isPulsePayload(v: unknown): v is PulsePayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Partial<PulsePayload>;
  return (
    typeof p.fetched_at === "string" &&
    Number.isFinite(Date.parse(p.fetched_at)) &&
    typeof p.nvd?.day === "number" &&
    typeof p.nvd.week === "number" &&
    typeof p.window?.day_from === "string" &&
    typeof p.window.week_from === "string" &&
    typeof p.window.to === "string" &&
    typeof p.source?.name === "string"
  );
}

export function ageMs(p: PulsePayload, nowMs: number): number {
  return nowMs - Date.parse(p.fetched_at);
}

export type PulseAction = "serve" | "serve-and-refresh" | "fetch";

/** What a request does with the newest payload it can find: serve it, serve it and refresh in the background, or (nothing, or nothing younger than KEEP_S) ask NVD while the visitor waits. */
export function decide(stored: PulsePayload | null, nowMs: number): PulseAction {
  if (!stored) return "fetch";
  const age = ageMs(stored, nowMs);
  if (age >= KEEP_S * 1000) return "fetch";
  return age < FRESH_S * 1000 ? "serve" : "serve-and-refresh";
}

export function isStale(p: PulsePayload, nowMs: number): boolean {
  return ageMs(p, nowMs) > STALE_S * 1000;
}

/** The later of two payloads by fetched_at (KV can lag the isolate's own refresh). */
export function newer(a: PulsePayload | null, b: PulsePayload | null): PulsePayload | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.fetched_at) > Date.parse(a.fetched_at) ? b : a;
}

/* ---------- NVD ---------- */

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

class NvdError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function nvdCount(doFetch: FetchLike, url: string): Promise<number> {
  const res = await doFetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new NvdError(`NVD answered ${res.status}`, res.status);
  const total = parseTotal(await res.json());
  if (total === null) throw new NvdError("NVD sent no totalResults");
  return total;
}

/** Both counts, asked together (two requests, inside NVD's five per 30 s); either failing fails the refresh. */
export async function fetchPulse(doFetch: FetchLike, now: Date): Promise<PulsePayload> {
  const w = pulseWindow(now);
  const urls = pulseUrls(w);
  const [day, week] = await Promise.all([nvdCount(doFetch, urls.day), nvdCount(doFetch, urls.week)]);
  if (day > week) throw new NvdError(`NVD counted ${day} for the day but ${week} for the week`);
  return buildPulse(day, week, w);
}

/* ---------- cache and route ---------- */

/** The slice of KVNamespace this route uses. */
export interface PulseKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** The slice of ExecutionContext this route uses. */
export interface PulseContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface PulseOptions {
  now?: Date;
  fetch?: FetchLike;
}

/** Shared for the isolate's lifetime: the last good payload and the isolate's half of the refresh lock (epoch ms), never request-scoped data. */
let memory: PulsePayload | null = null;
let lockedUntil = 0;

/** Forgets the isolate cache and lock (tests). */
export function resetPulseMemory(): void {
  memory = null;
  lockedUntil = 0;
}

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

async function readStored(kv: PulseKV): Promise<PulsePayload | null> {
  try {
    const raw = await kv.get(PULSE_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return isPulsePayload(v) ? v : null;
  } catch (e) {
    console.warn(JSON.stringify({ event: "kv_read_failed", key: PULSE_KEY, error: String(e) }));
    return null;
  }
}

async function writeStored(kv: PulseKV, payload: PulsePayload): Promise<void> {
  try {
    await kv.put(PULSE_KEY, JSON.stringify(payload), { expirationTtl: KEEP_S });
  } catch (e) {
    console.warn(JSON.stringify({ event: "kv_write_failed", key: PULSE_KEY, error: String(e) }));
  }
}

/** Takes the lock unless this isolate or KV already holds it; a KV error counts as free so a broken KV cannot silence the route. */
async function takeLock(kv: PulseKV, now: Date): Promise<boolean> {
  const t = now.getTime();
  if (lockedUntil > t) return false;
  try {
    if (await kv.get(PULSE_LOCK_KEY)) return false;
  } catch (e) {
    console.warn(JSON.stringify({ event: "kv_read_failed", key: PULSE_LOCK_KEY, error: String(e) }));
  }
  lockedUntil = t + LOCK_S * 1000;
  try {
    await kv.put(PULSE_LOCK_KEY, now.toISOString(), { expirationTtl: LOCK_S });
  } catch (e) {
    console.warn(JSON.stringify({ event: "kv_write_failed", key: PULSE_LOCK_KEY, error: String(e) }));
  }
  return true;
}

/** One refresh under the lock: the new payload, or null when the lock was held or NVD failed. */
async function refresh(kv: PulseKV, now: Date, doFetch: FetchLike): Promise<PulsePayload | null> {
  if (!(await takeLock(kv, now))) return null;
  try {
    const payload = await fetchPulse(doFetch, now);
    memory = payload;
    await writeStored(kv, payload);
    return payload;
  } catch (e) {
    console.error(JSON.stringify({ event: "nvd_failed", error: String(e), status: e instanceof NvdError ? e.status : undefined }));
    return null;
  }
}

async function resolvePulse(kv: PulseKV, ctx: PulseContext, now: Date, doFetch: FetchLike): Promise<PulsePayload | null> {
  const t = now.getTime();
  if (memory && decide(memory, t) === "serve") return memory;
  const last = newer(await readStored(kv), memory);
  const action = decide(last, t);
  if (last && action !== "fetch") {
    memory = last;
    if (action === "serve") return last;
    ctx.waitUntil(refresh(kv, now, doFetch));
    return { ...last, stale: isStale(last, t) };
  }
  return refresh(kv, now, doFetch);
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/** GET and HEAD /v1/pulse; index.ts answers OPTIONS and other methods before routing here. */
export async function pulse(request: Request, kv: PulseKV, ctx: PulseContext, opts: PulseOptions = {}): Promise<Response> {
  const now = opts.now ?? new Date();
  let res: Response;
  try {
    const got = await resolvePulse(kv, ctx, now, opts.fetch ?? defaultFetch);
    if (!got) res = json({ error: "NVD unavailable" }, 503, { "Cache-Control": "no-store", "Retry-After": "60" });
    else {
      const age = Math.max(0, Math.floor(ageMs(got, now.getTime()) / 1000));
      res = json(got, 200, { "Cache-Control": `public, max-age=${MAX_AGE_S}`, Age: String(age) });
    }
  } catch (e) {
    console.error(JSON.stringify({ event: "unhandled", route: "/v1/pulse", error: String(e) }));
    res = json({ error: "internal error" }, 500, { "Cache-Control": "no-store" });
  }
  return request.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
