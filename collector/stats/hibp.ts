import { HibpStatsSchema, STATS_FILES, type BreachStat, type HibpStats, type StatsSource } from "../../lib/stats-schema";
import type { HibpBreach } from "../sources/hibp";
import type { StatsModule } from "./types";

/**
 * Every breach Have I Been Pwned lists, reduced to dates, size and flags,
 * so the home page can count breaches and accounts exposed per month. The
 * breach-lane adapter (collector/sources/hibp.ts) reads the same endpoint
 * for new candidates; this file keeps the whole history. CC BY 4.0 with
 * attribution, already credited in the footer.
 */

export const HIBP_URL = "https://haveibeenpwned.com/api/v3/breaches";
export const HIBP_SOURCE: StatsSource = { name: "Have I Been Pwned", url: "https://haveibeenpwned.com/", license: "CC BY 4.0" };

const DATE = /^\d{4}-\d{2}-\d{2}/;

export function breachStat(b: HibpBreach): BreachStat | null {
  if (!b.Name || !b.Title || !b.AddedDate || !DATE.test(b.AddedDate)) return null;
  return {
    name: b.Name,
    title: b.Title,
    domain: b.Domain ?? "",
    breach_date: b.BreachDate && DATE.test(b.BreachDate) ? b.BreachDate.slice(0, 10) : null,
    added: b.AddedDate.slice(0, 10),
    accounts: typeof b.PwnCount === "number" && b.PwnCount >= 0 ? Math.round(b.PwnCount) : 0,
    verified: b.IsVerified === true,
    sensitive: b.IsSensitive === true,
    spam_list: b.IsSpamList === true,
    stealer_log: b.IsStealerLog === true,
    malware: b.IsMalware === true,
    fabricated: b.IsFabricated === true,
    retired: b.IsRetired === true,
  };
}

export const hibpModule: StatsModule<HibpStats> = {
  name: "hibp",
  file: STATS_FILES.hibp,
  schema: HibpStatsSchema,
  maxAgeHours: 20,
  async fetch(ctx) {
    const list = await ctx.http.json<HibpBreach[]>(HIBP_URL, { userAgent: ctx.settings.fetch.user_agent, timeoutMs: 40_000, retries: 2, maxBytes: 8_000_000 });
    const breaches = list
      .map(breachStat)
      .filter((b): b is BreachStat => b !== null)
      .sort((a, b) => b.added.localeCompare(a.added) || a.name.localeCompare(b.name));
    ctx.log("stats hibp: fetched", { breaches: breaches.length, verified: breaches.filter((b) => b.verified).length });
    return { fetched_at: ctx.now.toISOString(), source: HIBP_SOURCE, breaches };
  },
};
