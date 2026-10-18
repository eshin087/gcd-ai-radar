/**
 * Rebuilds the year shards (data/incidents/<year>.json) from whatever holds
 * the dataset in this checkout: the shards themselves, or the pre-shard
 * data/incidents.json, which is removed afterwards.
 *
 * When both are present (a merge that kept main's incidents.json next to a
 * branch's shards), pass --from-legacy to take incidents.json as the truth
 * and discard the shards, or --from-shards for the opposite. Usage:
 *
 *   npx tsx scripts/shard-incidents.ts [--from-legacy | --from-shards] [--dry-run]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, loadState, saveState } from "../collector/lib/state";
import { LEGACY_FILE, SHARD_DIR, listShardFiles } from "../lib/shards";

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const legacy = path.join(DATA_DIR, LEGACY_FILE);
  const shards = await listShardFiles(DATA_DIR);
  const hasLegacy = await fs
    .access(legacy)
    .then(() => true)
    .catch(() => false);

  if (hasLegacy && shards.length) {
    if (args.has("--from-legacy")) {
      console.log(`taking ${LEGACY_FILE} as the dataset; discarding ${shards.length} shard(s) under ${SHARD_DIR}/`);
      if (!dryRun) for (const s of shards) await fs.rm(path.join(DATA_DIR, s.file));
    } else if (args.has("--from-shards")) {
      console.log(`taking the ${shards.length} shard(s) under ${SHARD_DIR}/ as the dataset; discarding ${LEGACY_FILE}`);
      if (!dryRun) await fs.rm(legacy);
    } else {
      console.error(`both ${LEGACY_FILE} and ${SHARD_DIR}/ exist; pass --from-legacy or --from-shards to say which one holds the records`);
      process.exit(1);
    }
    if (dryRun) {
      console.log("dry run: nothing written");
      return;
    }
  }

  const state = await loadState();
  const years = new Map<number, number>();
  for (const i of state.incidents) years.set(Number(i.first_reported.slice(0, 4)), (years.get(Number(i.first_reported.slice(0, 4))) ?? 0) + 1);
  console.log(`${state.incidents.length} records → ${[...years.entries()].sort(([a], [b]) => a - b).map(([y, n]) => `${y}: ${n}`).join(", ")}`);
  if (dryRun) {
    console.log("dry run: nothing written");
    return;
  }
  const changed = await saveState(state);
  console.log(changed.length ? `wrote ${changed.join(", ")}` : "shards already up to date");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
