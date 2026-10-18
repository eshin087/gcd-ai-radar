import type { Radar } from "@/lib/schema";

/** Illustrative Cloudflare Radar values for the design phase only. */
export const RADAR_SAMPLE: Radar = {
  fetched_at: "2026-10-16T06:00:00.000Z",
  range: "7d",
  bot_share: { value: 31.2, previous: 30.4 },
  ai_crawler_share_of_bots: 18.7,
  derived_ai_share_of_requests: 5.8,
  top_ai_bots: [
    { name: "GPTBot", share: 30.1 },
    { name: "ClaudeBot", share: 21.4 },
    { name: "Bytespider", share: 14.9 },
    { name: "Meta-ExternalAgent", share: 9.8 },
    { name: "Amazonbot", share: 7.5 },
  ],
  crawl_purpose: [
    { name: "Training", share: 79 },
    { name: "Search", share: 14 },
    { name: "User action", share: 7 },
  ],
  attribution: {
    source: "Cloudflare Radar",
    url: "https://radar.cloudflare.com/ai-insights",
    license: "CC BY-NC 4.0",
  },
};
