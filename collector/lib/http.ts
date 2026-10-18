import pRetry, { AbortError } from "p-retry";
import { log } from "./log";
import { BlockedUrlError, assertFetchable } from "./netguard";

/**
 * One HTTP client for every source: timeout, retries with backoff, descriptive
 * User-Agent, gzip, a hard body-size cap and conditional requests. A single
 * dead source must never take the run down, so callers catch and record.
 *
 * Every destination, including each redirect hop, must pass the network
 * guard (netguard.ts): http(s) to a public address only. Credentials never
 * follow a redirect to another host.
 */

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  method?: "GET" | "HEAD" | "POST";
  body?: string;
  userAgent?: string;
  etag?: string;
  lastModified?: string;
  /** Do not retry on these statuses (default: 4xx except 429). */
  noRetryStatuses?: number[];
  /** Initial backoff between retries (doubles each attempt). */
  backoffMs?: number;
}

export interface HttpResult {
  url: string;
  status: number;
  ok: boolean;
  body: string;
  headers: Headers;
  truncated: boolean;
  notModified: boolean;
  contentType: string;
}

const DEFAULTS = {
  timeoutMs: 20000,
  retries: 3,
  maxBytes: 3_000_000,
  userAgent: "gcd-ai-radar/0.1 (+https://github.com/eshin087/gcd-ai-radar)",
};

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Request headers that must not travel to a different host on redirect. */
const CREDENTIAL_HEADERS = ["authorization", "apikey", "x-api-key", "cookie", "proxy-authorization"];

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  if (!res.body) return { body: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      if (received >= maxBytes) {
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { body: new TextDecoder("utf-8", { fatal: false }).decode(merged), truncated };
}

function retryAfterMs(headers: Headers): number | null {
  const ra = headers.get("retry-after");
  if (!ra) return null;
  const secs = Number(ra);
  if (!Number.isNaN(secs)) return Math.min(secs * 1000, 90_000);
  const date = Date.parse(ra);
  if (!Number.isNaN(date)) return Math.max(0, Math.min(date - Date.now(), 90_000));
  return null;
}

/** Runs the guard; a blocked destination is final (no retries). */
async function guard(url: string): Promise<URL> {
  try {
    return await assertFetchable(url);
  } catch (err) {
    if (err instanceof BlockedUrlError) throw new AbortError(err);
    throw err;
  }
}

export async function httpFetch(url: string, opts: HttpOptions = {}): Promise<HttpResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
  const baseHeaders: Record<string, string> = {
    "user-agent": opts.userAgent ?? DEFAULTS.userAgent,
    accept: "application/json, application/xml, text/xml, application/rss+xml, application/atom+xml, text/html;q=0.8, */*;q=0.5",
    "accept-encoding": "gzip, br, deflate",
    ...opts.headers,
  };
  if (opts.etag) baseHeaders["if-none-match"] = opts.etag;
  if (opts.lastModified) baseHeaders["if-modified-since"] = opts.lastModified;

  return pRetry(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let current = await guard(url);
        let method = opts.method ?? "GET";
        let body = opts.body;
        let headers = { ...baseHeaders };
        for (let hop = 0; ; hop++) {
          const res = await fetch(current, { method, headers, body, redirect: "manual", signal: controller.signal });
          if (REDIRECT_STATUSES.has(res.status)) {
            await res.body?.cancel().catch(() => undefined);
            const location = res.headers.get("location");
            if (!location || hop >= MAX_REDIRECTS) {
              throw new AbortError(new HttpError(`${location ? "too many redirects" : "redirect without location"} for ${url}`, res.status, url));
            }
            const next = await guard(new URL(location, current).toString());
            if (next.host !== current.host) {
              headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.includes(k.toLowerCase())));
            }
            if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
              method = "GET";
              body = undefined;
            }
            current = next;
            continue;
          }
          if (res.status === 304) {
            return { url: current.toString(), status: 304, ok: true, body: "", headers: res.headers, truncated: false, notModified: true, contentType: "" };
          }
          if (!res.ok) {
            await res.body?.cancel().catch(() => undefined);
            const retryable = res.status === 429 || res.status >= 500;
            const err = new HttpError(`HTTP ${res.status} for ${url}`, res.status, url);
            if (!retryable || opts.noRetryStatuses?.includes(res.status)) throw new AbortError(err);
            const wait = retryAfterMs(res.headers);
            if (wait) await new Promise((r) => setTimeout(r, wait));
            throw err;
          }
          const { body: text, truncated } = method === "HEAD" ? { body: "", truncated: false } : await readCapped(res, maxBytes);
          if (truncated) log.debug("body truncated", { url, maxBytes });
          return {
            url: current.toString(),
            status: res.status,
            ok: true,
            body: text,
            headers: res.headers,
            truncated,
            notModified: false,
            contentType: res.headers.get("content-type") ?? "",
          };
        }
      } finally {
        clearTimeout(timer);
      }
    },
    {
      retries: opts.retries ?? DEFAULTS.retries,
      factor: 2,
      minTimeout: opts.backoffMs ?? 1500,
      maxTimeout: Math.max(20000, (opts.backoffMs ?? 1500) * 4),
      randomize: true,
      onFailedAttempt: ({ error, attemptNumber, retriesLeft }) => {
        log.debug("retrying", { url, attempt: attemptNumber, left: retriesLeft, error: error.message });
      },
    },
  );
}

export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await httpFetch(url, { ...opts, headers: { accept: "application/json", ...opts.headers } });
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new HttpError(`Non-JSON body (${res.contentType || "unknown type"}) from ${url}: ${res.body.slice(0, 120)}`, res.status, url);
  }
}

/**
 * Binary download with the same guard, timeout and a hard size cap, for the
 * few sources that are not text (the AI Incident Database's Excel export).
 */
export async function httpBytes(url: string, opts: { userAgent?: string; timeoutMs?: number; maxBytes: number }): Promise<Buffer> {
  const target = await guard(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(target, { headers: { "user-agent": opts.userAgent ?? DEFAULTS.userAgent }, redirect: "manual", signal: controller.signal });
    if (REDIRECT_STATUSES.has(res.status)) throw new HttpError(`unexpected redirect downloading ${url}`, res.status, url);
    if (!res.ok) throw new HttpError(`HTTP ${res.status} for ${url}`, res.status, url);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > opts.maxBytes) throw new HttpError(`body larger than ${opts.maxBytes} bytes for ${url}`, res.status, url);
    if (!res.body) return Buffer.alloc(0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > opts.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(`body larger than ${opts.maxBytes} bytes for ${url}`, res.status, url);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
