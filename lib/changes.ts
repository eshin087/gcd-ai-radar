import { timelineOf, type FullIncident } from "./lifecycle";
import type { IncidentType, Lane, PatchStatus, RecordState, Severity } from "./taxonomy";

/**
 * /changes.json: the newest timeline entries across every record, by when
 * the site learned of them (`added_at`), so an agent can poll one small file
 * and see what changed since its last look. Per lane under /lanes/<lane>/.
 */

export interface Change {
  incident: string;
  slug: string;
  title: string;
  lane: Lane;
  type: IncidentType;
  severity: Severity;
  state: RecordState;
  patch_status: PatchStatus;
  /** The day the update is about. */
  date: string;
  /** The update itself. */
  update: string;
  source_url: string | null;
  url: string;
  added_at: string;
}

export interface ChangesFile {
  site: string;
  generated_at: string;
  lane: Lane | null;
  feeds: { rss: string; json: string; llms: string; changes: string };
  /** Newest first by added_at, then date, then record id. */
  changes: Change[];
}

export const CHANGES_LIMIT = 500;

export function feedLinks(site: string, lane: Lane | null): ChangesFile["feeds"] {
  const base = lane ? `${site}/lanes/${lane}` : site;
  return { rss: `${base}/feed.xml`, json: `${base}/feed.json`, llms: `${base}/llms.txt`, changes: `${base}/changes.json` };
}

export function buildChanges(incidents: readonly FullIncident[], opts: { site: string; now: Date; limit?: number; lane?: Lane }): ChangesFile {
  const limit = opts.limit ?? CHANGES_LIMIT;
  const changes: Change[] = [];
  for (const i of incidents) {
    if (opts.lane && i.lane !== opts.lane) continue;
    for (const t of timelineOf(i)) {
      changes.push({
        incident: i.id,
        slug: i.slug,
        title: i.title,
        lane: i.lane,
        type: i.type,
        severity: i.severity,
        state: i.state,
        patch_status: i.patch_status,
        date: t.date,
        update: t.title,
        source_url: t.source_url ?? null,
        url: `${opts.site}/incidents/${i.slug}`,
        added_at: t.added_at,
      });
    }
  }
  changes.sort((a, b) => b.added_at.localeCompare(a.added_at) || b.date.localeCompare(a.date) || b.incident.localeCompare(a.incident));
  return {
    site: opts.site,
    generated_at: opts.now.toISOString(),
    lane: opts.lane ?? null,
    feeds: feedLinks(opts.site, opts.lane ?? null),
    changes: changes.slice(0, limit),
  };
}
