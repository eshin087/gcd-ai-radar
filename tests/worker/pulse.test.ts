import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countPublished, NVD_BASE as COLLECTOR_NVD_BASE, NVD_SOURCE as COLLECTOR_NVD_SOURCE, resetNvdClock } from "../../collector/stats/nvd";
import type { StatsContext } from "../../collector/stats/types";
import {
  buildPulse,
  decide,
  FRESH_S,
  isStale,
  KEEP_S,
  LOCK_S,
  NVD_BASE,
  NVD_SOURCE,
  nvdCountUrl,
  nvdStamp,
  parseTotal,
  pulse,
  PULSE_KEY,
  PULSE_LOCK_KEY,
  pulseUrls,
  pulseWindow,
  resetPulseMemory,
  STALE_S,
  USER_AGENT,
  type FetchLike,
  type PulseKV,
  type PulsePayload,
} from "../../worker/src/pulse";

/** The Worker's /v1/pulse: the NVD query against the collector's, and the KV cache with a fake KV, context and fetch. */

const NOW = new Date("2026-10-29T12:34:56.789Z");
const MIN = 60_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

class FakeKV implements PulseKV {
  store = new Map<string, string>();
  ttl = new Map<string, number | undefined>();
  reads: string[] = [];
  async get(key: string): Promise<string | null> {
    this.reads.push(key);
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
    this.ttl.set(key, options?.expirationTtl);
  }
  payload(): PulsePayload | null {
    const raw = this.store.get(PULSE_KEY);
    return raw ? (JSON.parse(raw) as PulsePayload) : null;
  }
}

class FakeCtx {
  pending: Promise<unknown>[] = [];
  waitUntil(p: Promise<unknown>) {
    this.pending.push(p);
  }
  async settle() {
    await Promise.all(this.pending);
    this.pending = [];
  }
}

/** NVD answering `day` for the 24-hour window and `week` for the 7-day one; "down" answers 503. */
function nvd(day: number | "down", week: number | "down" = day) {
  const urls: string[] = [];
  const inits: Parameters<FetchLike>[1][] = [];
  const fetch: FetchLike = async (url, init) => {
    urls.push(url);
    inits.push(init);
    const params = new URL(url).searchParams;
    const start = Date.parse(params.get("pubStartDate") ?? "");
    const end = Date.parse(params.get("pubEndDate") ?? "");
    const n = end - start <= 86_400_000 ? day : week;
    if (n === "down") return new Response("Service Unavailable", { status: 503 });
    return new Response(JSON.stringify({ resultsPerPage: 1, startIndex: 0, totalResults: n, format: "NVD_CVE", version: "2.0", vulnerabilities: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch, urls, inits };
}

function stored(fetchedAt: Date, day = 400, week = 3000): PulsePayload {
  return buildPulse(day, week, pulseWindow(fetchedAt));
}

const get = (method = "GET") => new Request("https://gcd-ai-radar-internet.example.workers.dev/v1/pulse", { method });

beforeEach(() => {
  resetPulseMemory();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pulseWindow", () => {
  it("ends at the instant and reaches back 24 hours and 7 × 24 hours", () => {
    expect(pulseWindow(NOW)).toEqual({
      day_from: "2026-10-28T12:34:56.789Z",
      week_from: "2026-10-22T12:34:56.789Z",
      to: "2026-10-29T12:34:56.789Z",
    });
  });
});

describe("the NVD query", () => {
  it("stamps instants as the collector does: milliseconds and +00:00", () => {
    expect(nvdStamp("2026-10-29T12:34:56.789Z")).toBe("2026-10-29T12:34:56.789+00:00");
    expect(nvdStamp("2026-10-29T00:00:00.000Z")).toBe("2026-10-29T00:00:00.000+00:00");
  });

  it("builds the two count URLs for a fixed now", () => {
    expect(pulseUrls(pulseWindow(NOW))).toEqual({
      day: "https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=2026-10-28T12%3A34%3A56.789%2B00%3A00&pubEndDate=2026-10-29T12%3A34%3A56.789%2B00%3A00&resultsPerPage=1&noRejected",
      week: "https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=2026-10-22T12%3A34%3A56.789%2B00%3A00&pubEndDate=2026-10-29T12%3A34%3A56.789%2B00%3A00&resultsPerPage=1&noRejected",
    });
  });

  it("is byte for byte the collector's countPublished query for the same instants", async () => {
    resetNvdClock();
    const asked: string[] = [];
    const ctx = {
      settings: { fetch: { user_agent: "test" } },
      now: NOW,
      http: {
        json: async (url: string) => {
          asked.push(url);
          return { totalResults: 7, resultsPerPage: 1, startIndex: 0 };
        },
        sleep: async () => {},
      },
      log: () => {},
    } as unknown as StatsContext;
    expect(await countPublished(ctx, "2026-10-22", "2026-10-29")).toBe(7);
    expect(asked).toEqual([nvdCountUrl("2026-10-22T00:00:00.000Z", "2026-10-29T23:59:59.999Z")]);
    expect(NVD_BASE).toBe(COLLECTOR_NVD_BASE);
    expect(NVD_SOURCE).toEqual(COLLECTOR_NVD_SOURCE);
  });
});

describe("parseTotal", () => {
  it("reads totalResults and refuses anything but a non-negative integer", () => {
    expect(parseTotal({ totalResults: 512, resultsPerPage: 1 })).toBe(512);
    expect(parseTotal({ totalResults: 0 })).toBe(0);
    expect(parseTotal({ totalResults: "512" })).toBeNull();
    expect(parseTotal({ totalResults: -1 })).toBeNull();
    expect(parseTotal({ totalResults: 1.5 })).toBeNull();
    expect(parseTotal({ message: "rate limited" })).toBeNull();
    expect(parseTotal(null)).toBeNull();
    expect(parseTotal("<html>")).toBeNull();
  });
});

describe("decide and isStale", () => {
  const p = stored(NOW);
  it("serves for ten minutes, then serves and refreshes, and asks again past six hours", () => {
    expect(decide(null, NOW.getTime())).toBe("fetch");
    expect(decide(p, NOW.getTime())).toBe("serve");
    expect(decide(p, NOW.getTime() + FRESH_S * 1000 - 1)).toBe("serve");
    expect(decide(p, NOW.getTime() + FRESH_S * 1000)).toBe("serve-and-refresh");
    expect(decide(p, NOW.getTime() + KEEP_S * 1000 - 1)).toBe("serve-and-refresh");
    expect(decide(p, NOW.getTime() + KEEP_S * 1000)).toBe("fetch");
  });

  it("marks a payload stale only past an hour", () => {
    expect(isStale(p, NOW.getTime() + STALE_S * 1000)).toBe(false);
    expect(isStale(p, NOW.getTime() + STALE_S * 1000 + 1)).toBe(true);
  });
});

describe("GET /v1/pulse", () => {
  it("asks NVD while the visitor waits when nothing is stored, and stores the payload for six hours", async () => {
    const kv = new FakeKV();
    const ctx = new FakeCtx();
    const up = nvd(512, 3650);
    const res = await pulse(get(), kv, ctx, { now: NOW, fetch: up.fetch });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PulsePayload;
    expect(body).toEqual({
      fetched_at: "2026-10-29T12:34:56.789Z",
      nvd: { day: 512, week: 3650 },
      window: { day_from: "2026-10-28T12:34:56.789Z", week_from: "2026-10-22T12:34:56.789Z", to: "2026-10-29T12:34:56.789Z" },
      stale: false,
      source: {
        name: "NVD",
        url: "https://nvd.nist.gov/developers/vulnerabilities",
        license: "NIST data, public domain. This product uses data from the NVD API but is not endorsed or certified by the NVD.",
      },
    });
    expect(Object.keys(body)).toEqual(["fetched_at", "nvd", "window", "stale", "source"]);
    expect(up.urls.sort()).toEqual([pulseUrls(pulseWindow(NOW)).day, pulseUrls(pulseWindow(NOW)).week].sort());
    expect(up.inits[0]?.headers["User-Agent"]).toBe(USER_AGENT);
    expect(kv.payload()).toEqual(body);
    expect(kv.ttl.get(PULSE_KEY)).toBe(KEEP_S);
    expect(kv.ttl.get(PULSE_LOCK_KEY)).toBe(LOCK_S);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  });

  it("serves a fresh payload from KV without asking NVD", async () => {
    const kv = new FakeKV();
    await kv.put(PULSE_KEY, JSON.stringify(stored(at(-5 * MIN), 401, 3001)));
    const ctx = new FakeCtx();
    const up = nvd(999);
    const res = await pulse(get(), kv, ctx, { now: NOW, fetch: up.fetch });
    const body = (await res.json()) as PulsePayload;
    expect(body.nvd).toEqual({ day: 401, week: 3001 });
    expect(body.stale).toBe(false);
    expect(res.headers.get("Age")).toBe("300");
    expect(up.urls).toEqual([]);
    expect(ctx.pending).toEqual([]);
  });

  it("serves a fresh payload from isolate memory without reading KV", async () => {
    const kv = new FakeKV();
    const up = nvd(512, 3650);
    await pulse(get(), kv, new FakeCtx(), { now: NOW, fetch: up.fetch });
    kv.reads = [];
    const res = await pulse(get(), kv, new FakeCtx(), { now: at(2 * MIN), fetch: up.fetch });
    expect(((await res.json()) as PulsePayload).nvd.day).toBe(512);
    expect(kv.reads).toEqual([]);
    expect(up.urls).toHaveLength(2);
  });

  it("serves a payload past ten minutes at once and refreshes it in the background", async () => {
    const kv = new FakeKV();
    await kv.put(PULSE_KEY, JSON.stringify(stored(at(-15 * MIN), 401, 3001)));
    const ctx = new FakeCtx();
    const up = nvd(520, 3700);
    const res = await pulse(get(), kv, ctx, { now: NOW, fetch: up.fetch });
    const body = (await res.json()) as PulsePayload;
    expect(body.nvd).toEqual({ day: 401, week: 3001 });
    expect(body.stale).toBe(false);
    expect(ctx.pending).toHaveLength(1);
    await ctx.settle();
    expect(up.urls).toHaveLength(2);
    expect(kv.payload()?.nvd).toEqual({ day: 520, week: 3700 });
    expect(kv.payload()?.fetched_at).toBe(NOW.toISOString());

    const next = await pulse(get(), kv, new FakeCtx(), { now: at(MIN), fetch: up.fetch });
    expect(((await next.json()) as PulsePayload).nvd).toEqual({ day: 520, week: 3700 });
    expect(up.urls).toHaveLength(2);
  });

  it("skips the background refresh while another request holds the KV lock", async () => {
    const kv = new FakeKV();
    await kv.put(PULSE_KEY, JSON.stringify(stored(at(-15 * MIN))));
    await kv.put(PULSE_LOCK_KEY, at(-10_000).toISOString());
    const ctx = new FakeCtx();
    const up = nvd(520, 3700);
    const res = await pulse(get(), kv, ctx, { now: NOW, fetch: up.fetch });
    expect(res.status).toBe(200);
    await ctx.settle();
    expect(up.urls).toEqual([]);
    expect(kv.payload()?.nvd.day).toBe(400);
  });

  it("keeps the isolate's own lock for a minute after a failed refresh", async () => {
    const kv = new FakeKV();
    await kv.put(PULSE_KEY, JSON.stringify(stored(at(-15 * MIN))));
    const down = nvd("down");
    const ctx = new FakeCtx();
    await pulse(get(), kv, ctx, { now: NOW, fetch: down.fetch });
    await ctx.settle();
    expect(down.urls).toHaveLength(2);
    expect(kv.store.get(PULSE_LOCK_KEY)).toBe(NOW.toISOString());

    kv.store.delete(PULSE_LOCK_KEY); // as if KV had not shown this isolate's lock
    await pulse(get(), kv, ctx, { now: at(30_000), fetch: down.fetch });
    await ctx.settle();
    expect(down.urls).toHaveLength(2);
    expect(kv.payload()?.nvd.day).toBe(400);

    const up = nvd(520, 3700);
    await pulse(get(), kv, ctx, { now: at(LOCK_S * 1000 + 1000), fetch: up.fetch });
    await ctx.settle();
    expect(up.urls).toHaveLength(2);
    expect(kv.payload()?.nvd.day).toBe(520);
  });

  it("marks the last good payload stale once it is over an hour old and NVD keeps failing", async () => {
    const kv = new FakeKV();
    await kv.put(PULSE_KEY, JSON.stringify(stored(at(-61 * MIN), 401, 3001)));
    const ctx = new FakeCtx();
    const down = nvd("down");
    const res = await pulse(get(), kv, ctx, { now: NOW, fetch: down.fetch });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PulsePayload;
    expect(body.stale).toBe(true);
    expect(body.nvd).toEqual({ day: 401, week: 3001 });
    expect(res.headers.get("Age")).toBe(String(61 * 60));
    await ctx.settle();
    expect(down.urls).toHaveLength(2);
    expect(kv.payload()?.stale).toBe(false);
    expect(kv.payload()?.nvd.day).toBe(401);
  });

  it("does not mark a payload under an hour old stale", async () => {
    const kv = new FakeKV();
    await kv.put(PULSE_KEY, JSON.stringify(stored(at(-59 * MIN))));
    const res = await pulse(get(), kv, new FakeCtx(), { now: NOW, fetch: nvd("down").fetch });
    expect(((await res.json()) as PulsePayload).stale).toBe(false);
  });

  it("answers 503 when nothing is stored and NVD fails", async () => {
    const kv = new FakeKV();
    const down = nvd("down");
    const res = await pulse(get(), kv, new FakeCtx(), { now: NOW, fetch: down.fetch });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "NVD unavailable" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(kv.payload()).toBeNull();
  });

  it("answers 503 when NVD sends no count or a day larger than its week", async () => {
    const garbled: FetchLike = async () => new Response(JSON.stringify({ message: "maintenance" }), { status: 200 });
    expect((await pulse(get(), new FakeKV(), new FakeCtx(), { now: NOW, fetch: garbled })).status).toBe(503);
    resetPulseMemory();
    expect((await pulse(get(), new FakeKV(), new FakeCtx(), { now: NOW, fetch: nvd(900, 800).fetch })).status).toBe(503);
  });

  it("answers 503 at once when nothing is stored and the lock is held", async () => {
    const kv = new FakeKV();
    await kv.put(PULSE_LOCK_KEY, NOW.toISOString());
    const up = nvd(512, 3650);
    const res = await pulse(get(), kv, new FakeCtx(), { now: NOW, fetch: up.fetch });
    expect(res.status).toBe(503);
    expect(up.urls).toEqual([]);
  });

  it("asks NVD again rather than serve a payload past six hours", async () => {
    const kv = new FakeKV();
    await kv.put(PULSE_KEY, JSON.stringify(stored(at(-(KEEP_S * 1000 + MIN)))));
    const res = await pulse(get(), kv, new FakeCtx(), { now: NOW, fetch: nvd("down").fetch });
    expect(res.status).toBe(503);
  });

  it("ignores a malformed KV value", async () => {
    const kv = new FakeKV();
    await kv.put(PULSE_KEY, JSON.stringify({ nvd: { day: "lots" } }));
    const res = await pulse(get(), kv, new FakeCtx(), { now: NOW, fetch: nvd(512, 3650).fetch });
    expect(((await res.json()) as PulsePayload).nvd).toEqual({ day: 512, week: 3650 });
  });

  it("sends the CORS headers, and HEAD carries the headers without a body", async () => {
    const kv = new FakeKV();
    await kv.put(PULSE_KEY, JSON.stringify(stored(NOW)));
    const res = await pulse(get(), kv, new FakeCtx(), { now: NOW, fetch: nvd(1).fetch });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const head = await pulse(get("HEAD"), kv, new FakeCtx(), { now: NOW, fetch: nvd(1).fetch });
    expect(head.status).toBe(200);
    expect(head.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(head.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await head.text()).toBe("");
  });
});
