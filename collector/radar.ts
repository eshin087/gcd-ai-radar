import { promises as fs } from "node:fs";
import path from "node:path";
import { RadarSchema, type Radar } from "../lib/schema";
import type { Settings } from "./lib/config";
import { httpJson } from "./lib/http";
import { errorMessage, log } from "./lib/log";
import { DATA_DIR } from "./lib/state";

/**
 * Cloudflare Radar sidebar signal (data CC BY-NC 4.0, attribution required).
 * Needs an API token with Account › Radar › Read. Any failure leaves the
 * previous radar.json untouched; without a token nothing happens and the
 * site hides the panel.
 */

const BASE = "https://api.cloudflare.com/client/v4/radar";
const RADAR_FILE = path.join(DATA_DIR, "radar.json");
const MAX_AGE_HOURS = 6 * 24;

interface Summary {
  success?: boolean;
  result?: Record<string, unknown>;
  errors?: { code: number; message: string }[];
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function summaryMap(res: Summary, key = "summary_0"): Record<string, number> {
  const raw = (res.result?.[key] ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = num(v);
    if (n !== null) out[k] = n;
  }
  return out;
}

export async function readRadar(): Promise<Radar | null> {
  try {
    const raw = JSON.parse(await fs.readFile(RADAR_FILE, "utf8"));
    return raw ? RadarSchema.parse(raw) : null;
  } catch {
    return null;
  }
}

export function radarIsFresh(radar: Radar | null, now: Date): boolean {
  return Boolean(radar && now.getTime() - Date.parse(radar.fetched_at) < MAX_AGE_HOURS * 3600 * 1000);
}

export async function fetchRadar(settings: Settings): Promise<Radar | null> {
  const token = process.env.CLOUDFLARE_RADAR_TOKEN;
  if (!token) {
    log.info("radar: CLOUDFLARE_RADAR_TOKEN not set, panel stays hidden");
    return null;
  }
  const get = (p: string) =>
    httpJson<Summary>(`${BASE}${p}`, {
      headers: { authorization: `Bearer ${token}` },
      userAgent: settings.fetch.user_agent,
      timeoutMs: 20000,
      retries: 2,
    });

  const botClass = await get("/http/summary/BOT_CLASS?dateRange=7d&dateRange=7dcontrol&format=json");
  if (!botClass.success) throw new Error(`radar: ${botClass.errors?.map((e) => `${e.code} ${e.message}`).join("; ") ?? "request failed"}`);
  const current = summaryMap(botClass, "summary_0");
  const previous = summaryMap(botClass, "summary_1");
  const botShare = current["bot"] ?? null;
  if (botShare === null) throw new Error("radar: BOT_CLASS summary has no bot share");

  const settle = async <T>(p: Promise<T>): Promise<T | null> => {
    try {
      return await p;
    } catch (err) {
      log.warn("radar: optional endpoint failed", { error: errorMessage(err).slice(0, 160) });
      return null;
    }
  };
  const [agents, categories, purpose] = await Promise.all([
    settle(get("/ai/bots/summary/USER_AGENT?dateRange=7d&limitPerGroup=5&format=json")),
    settle(get("/bots/summary/BOT_CATEGORY?dateRange=7d&format=json")),
    settle(get("/ai/bots/summary/CRAWL_PURPOSE?dateRange=7d&format=json")),
  ]);

  const topBots = agents ? Object.entries(summaryMap(agents)).filter(([k]) => k.toLowerCase() !== "other").sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
  const aiCrawlerShare = categories ? (summaryMap(categories)["AI_CRAWLER"] ?? summaryMap(categories)["ai_crawler"] ?? null) : null;
  const crawlPurpose = purpose ? Object.entries(summaryMap(purpose)).sort((a, b) => b[1] - a[1]) : [];

  const radar: Radar = {
    fetched_at: new Date().toISOString(),
    range: "7d",
    bot_share: { value: botShare, previous: previous["bot"] ?? null },
    ai_crawler_share_of_bots: aiCrawlerShare,
    derived_ai_share_of_requests: aiCrawlerShare !== null ? Math.round(((botShare * aiCrawlerShare) / 100) * 100) / 100 : null,
    top_ai_bots: topBots.map(([name, share]) => ({ name, share })),
    crawl_purpose: crawlPurpose.map(([name, share]) => ({ name, share })),
    attribution: { source: "Cloudflare Radar", url: "https://radar.cloudflare.com/ai-insights", license: "CC BY-NC 4.0" },
  };
  return RadarSchema.parse(radar);
}

/** Refreshes data/radar.json when it is older than six days. Returns true if the file changed. */
export async function maybeUpdateRadar(settings: Settings, opts: { dryRun: boolean; force?: boolean }): Promise<boolean> {
  const now = new Date();
  const existing = await readRadar();
  if (!opts.force && radarIsFresh(existing, now)) {
    log.debug("radar: fresh, skipping");
    return false;
  }
  try {
    const radar = await fetchRadar(settings);
    if (!radar) return false;
    log.info("radar: fetched", { bot_share: radar.bot_share.value, ai_crawlers: radar.derived_ai_share_of_requests });
    if (opts.dryRun) return false;
    await fs.writeFile(RADAR_FILE, JSON.stringify(radar, null, 2) + "\n");
    return true;
  } catch (err) {
    log.warn("radar: fetch failed, keeping the previous file", { error: errorMessage(err).slice(0, 200) });
    return false;
  }
}
