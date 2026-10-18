/**
 * Retires published vulnerability records whose product is in
 * collector/config/packages.json → dropped_packages (packages removed from the
 * allow-list). The records move to rejected.json with a reason, their source
 * urls are marked rejected in seen.json so no adapter re-creates them, and
 * titles that still start with an advisory id ("GHSA-…: " / "Duplicate
 * Advisory: ") are cleaned. Usage: npx tsx scripts/prune-packages.ts [--dry-run]
 */
import { IncidentSchema, type Incident } from "../lib/schema";
import { urlKey } from "../collector/lib/canonical";
import { CONFIG_DIR } from "../collector/lib/config";
import { nowIso } from "../collector/lib/ids";
import { loadState, saveState, type RejectedRecord } from "../collector/lib/state";
import { readFileSync } from "node:fs";
import path from "node:path";

function matchesDropped(inc: Incident, dropped: string[]): string | null {
  const hay = [...inc.products, inc.title].map((s) => s.toLowerCase());
  for (const name of dropped) {
    const n = name.toLowerCase();
    for (const h of hay) {
      if (h === n || h.startsWith(`${n} `) || h.startsWith(`${n}:`) || new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(h)) return name;
    }
  }
  return null;
}

function cleanTitle(title: string): string {
  return title
    .replace(/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}:\s*/i, "")
    .replace(/^Duplicate Advisory:\s*/i, "")
    .trim();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const packages = JSON.parse(readFileSync(path.join(CONFIG_DIR, "packages.json"), "utf8")) as { dropped_packages?: { names: string[] } };
  const dropped = packages.dropped_packages?.names ?? [];
  if (dropped.length === 0) throw new Error("packages.json has no dropped_packages.names");
  const state = await loadState();
  const now = nowIso();
  const keep: Incident[] = [];
  const retired: RejectedRecord[] = [];
  const byPackage: Record<string, number> = {};
  let cleaned = 0;

  for (const inc of state.incidents) {
    if (inc.origin === "seed_ghsa" || inc.origin === "seed_nvd") {
      const hit = matchesDropped(inc, dropped);
      if (hit) {
        byPackage[hit] = (byPackage[hit] ?? 0) + 1;
        for (const s of inc.sources) {
          retired.push({
            key: urlKey(s.url),
            title: s.title,
            url: s.url,
            publisher: s.publisher,
            source_id: "prune",
            reason: `package "${hit}" removed from the CVE allow-list (classic ML library or generic automation, not an AI system under attack)`,
            confidence: null,
            rejected_at: now,
          });
          state.seen[urlKey(s.url)] = { status: "rejected", at: now };
        }
        continue;
      }
    }
    const t = cleanTitle(inc.title);
    if (t !== inc.title && t.length >= 8) {
      inc.title = t;
      inc.updated_at = now;
      cleaned += 1;
    }
    IncidentSchema.parse(inc);
    keep.push(inc);
  }

  console.log(`retire ${state.incidents.length - keep.length} incidents (${retired.length} source urls) · clean ${cleaned} titles · keep ${keep.length}`);
  console.log("by package:", JSON.stringify(byPackage));
  if (dryRun) {
    console.log("dry run: nothing written");
    return;
  }
  state.incidents = keep;
  state.rejected.push(...retired);
  const changed = await saveState(state);
  console.log(`saved ${changed.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
