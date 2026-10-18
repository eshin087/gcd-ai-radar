/**
 * One-off repair for incidents ingested from the AI Incident Database before
 * background articles were filtered out: older "reports" dragged
 * first_reported, incident_date and the id year back by years.
 *
 * Deterministic, no LLM calls: re-reads the AIID export, rebuilds each AIID
 * incident's sources with the current rule (aiidSources), restores the
 * incident date to the editor-resolved AIID date (clamped to the earliest
 * kept report, as the pipeline does), reassigns the id when its year changed
 * and keeps seen.json consistent. Usage: npx tsx scripts/repair-aiid-dates.ts [--dry-run]
 */
import { IncidentSchema } from "../lib/schema";
import { urlKey } from "../collector/lib/canonical";
import { loadConfig } from "../collector/lib/config";
import { makeIdAllocator, nowIso } from "../collector/lib/ids";
import { allIds, loadState, saveState } from "../collector/lib/state";
import { aiidSources, loadAiidRecords } from "../collector/sources/aiid";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const config = loadConfig();
  const state = await loadState();
  const source = config.sources.find((s) => s.kind === "aiid");
  if (!source?.url) throw new Error("no aiid source configured");
  const records = await loadAiidRecords(source.url, config.settings.fetch.user_agent);
  const byId = new Map(records.map((r) => [r.id, r]));
  const allocate = makeIdAllocator(allIds(state));
  const now = nowIso();
  const before: Record<string, number> = {};
  const after: Record<string, number> = {};
  let repaired = 0;
  let renumbered = 0;
  let droppedSources = 0;

  for (const inc of [...state.incidents, ...state.review]) {
    if (inc.origin !== "seed_aiid") continue;
    const aiidId = inc.sources.map((s) => s.url.match(/incidentdatabase\.ai\/cite\/(\d+)/)?.[1]).find(Boolean);
    const rec = aiidId ? byId.get(aiidId) : undefined;
    if (!rec) continue;
    before[inc.incident_date.slice(0, 4)] = (before[inc.incident_date.slice(0, 4)] ?? 0) + 1;

    const { sources, published_at } = aiidSources(rec, config.publishers);
    const dropped = inc.sources.filter((o) => !sources.some((s) => s.url === o.url));
    let incident_date = rec.date;
    const first_reported = published_at;
    if (first_reported < incident_date) incident_date = first_reported;

    const oldId = inc.id;
    const year = Number(first_reported.slice(0, 4));
    const id = inc.id.startsWith(`AIR-${year}-`) ? inc.id : allocate(year);

    inc.id = id;
    inc.incident_date = incident_date;
    inc.incident_date_precision = "day";
    inc.first_reported = first_reported;
    inc.sources = sources;
    inc.source_count = sources.length;
    inc.updated_at = now;
    IncidentSchema.parse(inc);

    for (const s of sources) state.seen[urlKey(s.url)] = { status: inc.status === "review" ? "review" : "published", id, at: now };
    for (const d of dropped) delete state.seen[urlKey(d.url)];
    if (oldId !== id) {
      renumbered += 1;
      for (const entry of Object.values(state.seen)) if (entry.id === oldId) entry.id = id;
    }
    droppedSources += dropped.length;
    repaired += 1;
    after[incident_date.slice(0, 4)] = (after[incident_date.slice(0, 4)] ?? 0) + 1;
  }

  console.log(`repaired ${repaired} AIID incidents, renumbered ${renumbered}, dropped ${droppedSources} background sources`);
  console.log("incident years before:", JSON.stringify(before));
  console.log("incident years after: ", JSON.stringify(after));
  if (dryRun) {
    console.log("dry run: nothing written");
    return;
  }
  const changed = await saveState(state);
  console.log(`saved ${changed.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
