import { lastUpdated, loadIncidents } from "./data";
import { buildLive, type LiveData } from "./live";

/** Build-time payload for the home page (lib/live.ts over the published records). */
export async function getLiveData(): Promise<LiveData> {
  const [{ incidents }, updated] = await Promise.all([loadIncidents(), lastUpdated()]);
  return buildLive(incidents, new Date(), updated);
}
