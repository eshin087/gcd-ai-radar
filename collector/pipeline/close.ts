import { closedAtOf, stateOf } from "../../lib/lifecycle";
import type { Incident } from "../../lib/schema";

/**
 * The closer. Every live record is judged by the lifecycle rule at the end
 * of a run and, when its window has passed, closed on disk: `state`,
 * `closed_at` and `updated_at` are persisted so the site, the feeds and
 * changes.json see the same answer the build would compute. A record the
 * collector closed stays closed until a new report reopens it (update.ts);
 * the build never reopens one against its file.
 */
export function closeRecords(incidents: Incident[], now: string): { closed: number; ids: string[] } {
  const day = now.slice(0, 10);
  const ids: string[] = [];
  for (const i of incidents) {
    if (i.state === "closed") continue;
    if (stateOf(i, day) !== "closed") continue;
    i.state = "closed";
    i.closed_at = closedAtOf(i, day);
    i.updated_at = now;
    ids.push(i.id);
  }
  return { closed: ids.length, ids };
}
