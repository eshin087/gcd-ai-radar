import { DailyStatsSchema, STATS_FILES, type CvesRecent, type DailyStats } from "../../lib/stats-schema";
import { addDays } from "../lib/ids";
import { NVD_SOURCE, cvesRecentModule } from "./nvd";
import type { StatsModule } from "./types";

/**
 * CVEs published per UTC day over the last 120 days, so the home page can
 * tell a quiet day from a busy one. cves-recent.json reaches back only two
 * weeks, so the history accumulates here: every stats run counts the
 * cves-recent file the run just fetched (or kept) by publish day and writes
 * each complete day, one wholly inside that file's window and before the UTC
 * day it was fetched (today is still filling up). A newer count replaces an
 * older one, since NVD backfills late; the newest 120 days are kept.
 * `critical` counts CVEs scored 9.0 or higher. Costs no API calls.
 */

export const DAILY_DAYS = 120;
export const CRITICAL_SCORE = 9;

type Days = DailyStats["days"];

const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * The complete days a cves-recent file covers, zeros included. nvd.ts asks
 * for pubStartDate = (fetched day - window_days) at 00:00 UTC, so the
 * window's first day is whole; the fetched day is not.
 */
export function completeDays(recent: CvesRecent): Days {
  const fetchedDay = utcDay(recent.fetched_at);
  const days: Days = {};
  for (let d = addDays(fetchedDay, -recent.window_days); d < fetchedDay; d = addDays(d, 1)) days[d] = { cves: 0, critical: 0 };
  for (const cve of recent.cves) {
    const day = days[utcDay(cve.published)];
    if (!day) continue;
    day.cves += 1;
    if (cve.score !== null && cve.score >= CRITICAL_SCORE) day.critical += 1;
  }
  return days;
}

/** The previous days with the fresh ones laid over them, the newest `keep`, keys ascending. */
export function mergeDays(previous: Days | undefined, fresh: Days, keep = DAILY_DAYS): Days {
  const merged: Days = { ...previous, ...fresh };
  return Object.fromEntries(
    Object.keys(merged)
      .sort()
      .slice(-keep)
      .map((d) => [d, merged[d]!]),
  );
}

export const dailyModule: StatsModule<DailyStats> = {
  name: "daily",
  file: STATS_FILES.daily,
  schema: DailyStatsSchema,
  maxAgeHours: 0,
  async fetch(ctx, previous) {
    // the runner validated it against CvesRecentSchema when it read or fetched it
    const recent = ctx.produced[cvesRecentModule.name] as CvesRecent | null | undefined;
    if (!recent) return null;
    // a cves-recent file older than the counts already written (its refetch failed) has nothing newer to say
    if (previous && Date.parse(recent.fetched_at) < Date.parse(previous.fetched_at)) return null;
    const days = mergeDays(previous?.days, completeDays(recent));
    return { fetched_at: recent.fetched_at, source: NVD_SOURCE, days };
  },
};
