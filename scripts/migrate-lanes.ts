/**
 * Writes the lifecycle keys into every published record, exactly as the site
 * derives them at load (lib/lifecycle.ts withLifecycle): lane, state,
 * closed_at, patch_status, cve_ids, affected, fixed_in, the seeded timeline,
 * action, severity_note and cvss. Deterministic, no model, idempotent: a
 * second run changes nothing. After it, `npm run validate` must pass and the
 * site must render every record as before.
 *
 *   npx tsx scripts/migrate-lanes.ts --dry-run     counts only, nothing written
 *   npx tsx scripts/migrate-lanes.ts               writes data/incidents/<year>.json (and nothing else)
 *   npx tsx scripts/migrate-lanes.ts --day=YYYY-MM-DD   judge live/closed as of that UTC day (default: today)
 *
 * Procedure (docs/operations.md): pause the cron (gh workflow disable
 * collect.yml), run, validate, commit the shards on the Stage B branch, merge,
 * re-enable the cron the same day.
 */
import { LANES, RECORD_STATES } from "../lib/taxonomy";
import { deriveLifecycle } from "../lib/lifecycle";
import { IncidentSchema, type Incident } from "../lib/schema";
import { loadState, saveState } from "../collector/lib/state";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

export interface MigrationReport {
  records: number;
  changed: number;
  byLane: Record<string, number>;
  byState: Record<string, number>;
  liveByLane: Record<string, number>;
  bytesBefore: number;
  bytesAfter: number;
}

/** Fills the lifecycle keys in place; returns how many records changed. */
export function migrateRecords(incidents: Incident[], day: string): MigrationReport {
  const byLane: Record<string, number> = Object.fromEntries(LANES.map((l) => [l, 0]));
  const byState: Record<string, number> = Object.fromEntries(RECORD_STATES.map((s) => [s, 0]));
  const liveByLane: Record<string, number> = Object.fromEntries(LANES.map((l) => [l, 0]));
  let changed = 0;
  const bytesBefore = JSON.stringify(incidents).length;
  for (const i of incidents) {
    const before = JSON.stringify(i);
    const life = deriveLifecycle(i, day);
    Object.assign(i, life);
    const check = IncidentSchema.safeParse(i);
    if (!check.success) throw new Error(`${i.id} does not validate after migration: ${check.error.issues[0]?.path.join(".")}: ${check.error.issues[0]?.message}`);
    if (JSON.stringify(i) !== before) changed += 1;
    byLane[life.lane] = (byLane[life.lane] ?? 0) + 1;
    byState[life.state] = (byState[life.state] ?? 0) + 1;
    if (life.state === "live") liveByLane[life.lane] = (liveByLane[life.lane] ?? 0) + 1;
  }
  return { records: incidents.length, changed, byLane, byState, liveByLane, bytesBefore, bytesAfter: JSON.stringify(incidents).length };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const day = arg("day") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("--day needs YYYY-MM-DD");
  const state = await loadState();
  const report = migrateRecords(state.incidents, day);
  const fmt = (r: Record<string, number>) =>
    Object.entries(r)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
  console.log(`as of ${day}: ${report.records} records, ${report.changed} change`);
  console.log(`  by lane:   ${fmt(report.byLane)}`);
  console.log(`  by state:  ${fmt(report.byState)}`);
  console.log(`  live:      ${fmt(report.liveByLane)}`);
  console.log(`  size:      ${(report.bytesBefore / 1e6).toFixed(2)} MB → ${(report.bytesAfter / 1e6).toFixed(2)} MB (+${((report.bytesAfter - report.bytesBefore) / 1e6).toFixed(2)} MB)`);
  if (dryRun) {
    console.log("dry run: nothing written");
    return;
  }
  const changed = await saveState(state);
  const unexpected = changed.filter((f) => !f.startsWith("incidents/"));
  console.log(changed.length ? `wrote ${changed.join(", ")}` : "nothing to write");
  if (unexpected.length) console.warn(`note: files other than the shards changed too: ${unexpected.join(", ")} (the migration commit should hold the shards only)`);
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/migrate-lanes.ts");
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
