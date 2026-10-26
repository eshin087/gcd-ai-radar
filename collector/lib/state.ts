import { promises as fs } from "node:fs";
import path from "node:path";
import { z, type ZodType } from "zod";
import { IncidentsFileSchema, RunsFileSchema, type Incident, type RunRecord } from "../../lib/schema";
import { LEGACY_FILE, listShardFiles, readIncidents, serializeShards } from "../../lib/shards";
import { PendingFileSchema, type Candidate } from "../sources/types";

/**
 * The collector's persistent state is the set of JSON files under /data.
 * Loaded and validated at the start of a run, written back atomically at the
 * end: only files whose content changed are rewritten, so no-op runs leave
 * the tree clean and nothing gets committed.
 *
 * Published incidents are sharded by year of first_reported
 * (data/incidents/<year>.json, lib/shards.ts); a run that publishes into the
 * current year rewrites that one shard. The review queue and the other
 * bookkeeping files stay single files. collector-state.json remembers what
 * the run ledger (runs.json, trimmed to retention.runs_keep) cannot: when
 * each source last succeeded, so a monthly source is still due on time, and
 * which CVE ids were already looked up in the GitHub Advisory Database.
 */

export const DATA_DIR = path.join(process.cwd(), "data");

export const RejectedRecordSchema = z.object({
  key: z.string(),
  title: z.string(),
  url: z.string(),
  publisher: z.string(),
  source_id: z.string(),
  reason: z.string(),
  confidence: z.number().nullable(),
  rejected_at: z.iso.datetime(),
});
export type RejectedRecord = z.infer<typeof RejectedRecordSchema>;

export const SeenEntrySchema = z.object({
  status: z.enum(["published", "review", "rejected", "merged"]),
  id: z.string().optional(),
  at: z.iso.datetime(),
});
export type SeenEntry = z.infer<typeof SeenEntrySchema>;

export const CollectorStateSchema = z.object({
  /** Last successful fetch per source id. */
  sources: z.record(z.string(), z.object({ last_success_at: z.iso.datetime() })),
  /** GitHub Advisory Database lookups by CVE id: when, and whether an advisory existed. */
  cve_lookups: z.record(z.string(), z.object({ at: z.iso.datetime(), found: z.boolean() })),
});
export type CollectorState = z.infer<typeof CollectorStateSchema>;

/** Lookups older than this are forgotten; a CVE is asked again if it still matters. */
export const CVE_LOOKUP_KEEP_DAYS = 60;

export function emptyCollectorState(): CollectorState {
  return { sources: {}, cve_lookups: {} };
}

const RejectedFileSchema = z.array(RejectedRecordSchema);
const SeenFileSchema = z.record(z.string(), SeenEntrySchema);

export interface State {
  incidents: Incident[];
  review: Incident[];
  rejected: RejectedRecord[];
  pending: Candidate[];
  seen: Record<string, SeenEntry>;
  runs: RunRecord[];
  collector: CollectorState;
}

/** The single-file parts of the state (incidents are sharded, see lib/shards.ts). */
export const FILES = {
  review: "review-queue.json",
  rejected: "rejected.json",
  pending: "pending.json",
  seen: "seen.json",
  runs: "runs.json",
  collector: "collector-state.json",
} as const;

/** Files whose change alone does not change the site: a commit touching only these carries the [no site change] marker. */
export const BOOKKEEPING_FILES: ReadonlySet<string> = new Set([FILES.runs, FILES.seen, FILES.pending, FILES.rejected, FILES.collector]);

async function readJsonFile<T>(dataDir: string, file: string, schema: ZodType<T>, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dataDir, file), "utf8");
  } catch {
    return fallback;
  }
  const parsed: unknown = raw.trim() ? JSON.parse(raw) : null;
  if (parsed === null) return fallback;
  return schema.parse(parsed);
}

export async function loadState(dataDir = DATA_DIR): Promise<State> {
  const [{ incidents }, review, rejected, pending, seen, runs, collector] = await Promise.all([
    readIncidents(dataDir),
    readJsonFile(dataDir, FILES.review, IncidentsFileSchema, []),
    readJsonFile(dataDir, FILES.rejected, RejectedFileSchema, []),
    readJsonFile(dataDir, FILES.pending, PendingFileSchema, []),
    readJsonFile(dataDir, FILES.seen, SeenFileSchema, {}),
    readJsonFile(dataDir, FILES.runs, RunsFileSchema, []),
    readJsonFile(dataDir, FILES.collector, CollectorStateSchema, emptyCollectorState()),
  ]);
  return { incidents, review, rejected, pending, seen, runs, collector };
}

function byReportedDesc(a: Incident, b: Incident): number {
  return b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id);
}

function sortedRecord<T>(rec: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(rec).sort(([a], [b]) => a.localeCompare(b)));
}

/** Drops CVE lookups older than CVE_LOOKUP_KEEP_DAYS. */
export function pruneCollectorState(c: CollectorState, now: string): CollectorState {
  const cutoff = Date.parse(now) - CVE_LOOKUP_KEEP_DAYS * 86_400_000;
  const cve_lookups: CollectorState["cve_lookups"] = {};
  for (const [cve, v] of Object.entries(c.cve_lookups)) if (Date.parse(v.at) >= cutoff) cve_lookups[cve] = v;
  return { sources: c.sources, cve_lookups };
}

/**
 * Canonical serialization, keyed by path relative to the data directory:
 * stable ordering so diffs stay small. Incident shards come first, oldest
 * year first.
 */
export function serialize(state: State): Map<string, string> {
  const sortedSeen = sortedRecord(state.seen);
  const out = serializeShards(state.incidents);
  out.set(FILES.review, JSON.stringify([...state.review].sort(byReportedDesc), null, 2) + "\n");
  out.set(FILES.rejected, JSON.stringify([...state.rejected].sort((a, b) => b.rejected_at.localeCompare(a.rejected_at)), null, 2) + "\n");
  out.set(FILES.pending, JSON.stringify([...state.pending].sort((a, b) => a.discovered_at.localeCompare(b.discovered_at)), null, 2) + "\n");
  out.set(FILES.seen, JSON.stringify(sortedSeen, null, 1) + "\n");
  out.set(FILES.runs, JSON.stringify([...state.runs].sort((a, b) => a.started_at.localeCompare(b.started_at)), null, 2) + "\n");
  out.set(FILES.collector, JSON.stringify({ sources: sortedRecord(state.collector.sources), cve_lookups: sortedRecord(state.collector.cve_lookups) }, null, 1) + "\n");
  return out;
}

async function writeAtomic(dataDir: string, file: string, content: string) {
  const full = path.join(dataDir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, full);
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Validates, then writes only the files whose content changed and removes
 * shards that no longer hold any record (a year emptied by a repair) and the
 * pre-shard incidents.json. Returns the relative paths it touched; a removal
 * is reported as "<path> (removed)".
 */
export async function saveState(state: State, dataDir = DATA_DIR): Promise<string[]> {
  IncidentsFileSchema.parse(state.incidents);
  IncidentsFileSchema.parse(state.review);
  RejectedFileSchema.parse(state.rejected);
  PendingFileSchema.parse(state.pending);
  SeenFileSchema.parse(state.seen);
  RunsFileSchema.parse(state.runs);
  CollectorStateSchema.parse(state.collector);

  const out = serialize(state);
  const changed: string[] = [];
  for (const [file, next] of out) {
    const current = await readIfPresent(path.join(dataDir, file));
    if (current !== next) {
      await writeAtomic(dataDir, file, next);
      changed.push(file);
    }
  }
  const stale = (await listShardFiles(dataDir)).map((s) => s.file).filter((f) => !out.has(f));
  if ((await readIfPresent(path.join(dataDir, LEGACY_FILE))) !== null) stale.push(LEGACY_FILE);
  for (const file of stale) {
    await fs.rm(path.join(dataDir, file), { force: true });
    changed.push(`${file} (removed)`);
  }
  return changed;
}

/** Every id in use, across published and review items. */
export function allIds(state: State): string[] {
  return [...state.incidents, ...state.review].map((i) => i.id);
}

export function allSlugs(state: State): Set<string> {
  return new Set([...state.incidents, ...state.review].map((i) => i.slug));
}
