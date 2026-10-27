import { lastUpdated, loadBriefings, loadIncidents, loadStats, siteUrl } from "./data";
import { buildHome, type HomeData } from "./home";

export interface HomePayload extends HomeData {
  /** The newest weekly briefing, for the "this week" band; null before the first Monday run. */
  briefing: { week: string; headline: string; start: string; end: string } | null;
}

/** Build-time payload for the home page: the live columns plus the statistics (lib/home.ts). */
export async function getHomeData(): Promise<HomePayload> {
  const [{ incidents }, stats, updated, briefings] = await Promise.all([loadIncidents(), loadStats(), lastUpdated(), loadBriefings()]);
  const latest = briefings[0];
  return {
    ...buildHome(incidents, stats, new Date(), updated, siteUrl()),
    briefing: latest ? { week: latest.week, headline: latest.narrative?.headline ?? latest.week, start: latest.start, end: latest.end } : null,
  };
}
