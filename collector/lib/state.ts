import { promises as fs } from "node:fs";
import path from "node:path";
import { z, type ZodType } from "zod";
import { IncidentsFileSchema, RunsFileSchema, type Incident, type RunRecord } from "../../lib/schema";
import { PendingFileSchema, type Candidate } from "../sources/types";

/**
 * The collector's persistent state is the set of JSON files under /data.
 * Loaded and validated at the start of a run, written back atomically at the
 * end (only files whose content changed are rewritten, so no-op runs leave
 * the tree clean and nothing gets committed).
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

const RejectedFileSchema = z.array(RejectedRecordSchema);
const SeenFileSchema = z.record(z.string(), SeenEntrySchema);

export interface State {
  incidents: Incident[];
  review: Incident[];
  rejected: RejectedRecord[];
  pending: Candidate[];
  seen: Record<string, SeenEntry>;
  runs: RunRecord[];
}

const FILES = {
  incidents: "incidents.json",
  review: "review-queue.json",
  rejected: "rejected.json",
  pending: "pending.json",
  seen: "seen.json",
  runs: "runs.json",
} as const;

async function readJsonFile<T>(file: string, schema: ZodType<T>, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
  } catch {
    return fallback;
  }
  const parsed: unknown = raw.trim() ? JSON.parse(raw) : null;
  if (parsed === null) return fallback;
  return schema.parse(parsed);
}

export async function loadState(): Promise<State> {
  const [incidents, review, rejected, pending, seen, runs] = await Promise.all([
    readJsonFile(FILES.incidents, IncidentsFileSchema, []),
    readJsonFile(FILES.review, IncidentsFileSchema, []),
    readJsonFile(FILES.rejected, RejectedFileSchema, []),
    readJsonFile(FILES.pending, PendingFileSchema, []),
    readJsonFile(FILES.seen, SeenFileSchema, {}),
    readJsonFile(FILES.runs, RunsFileSchema, []),
  ]);
  return { incidents, review, rejected, pending, seen, runs };
}

function byReportedDesc(a: Incident, b: Incident): number {
  return b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id);
}

/** Canonical serialization: stable ordering so diffs stay small. */
export function serialize(state: State): Record<keyof typeof FILES, string> {
  const sortedSeen = Object.fromEntries(Object.entries(state.seen).sort(([a], [b]) => a.localeCompare(b)));
  return {
    incidents: JSON.stringify([...state.incidents].sort(byReportedDesc), null, 2) + "\n",
    review: JSON.stringify([...state.review].sort(byReportedDesc), null, 2) + "\n",
    rejected: JSON.stringify([...state.rejected].sort((a, b) => b.rejected_at.localeCompare(a.rejected_at)), null, 2) + "\n",
    pending: JSON.stringify([...state.pending].sort((a, b) => a.discovered_at.localeCompare(b.discovered_at)), null, 2) + "\n",
    seen: JSON.stringify(sortedSeen, null, 1) + "\n",
    runs: JSON.stringify([...state.runs].sort((a, b) => a.started_at.localeCompare(b.started_at)), null, 2) + "\n",
  };
}

async function writeAtomic(file: string, content: string) {
  const full = path.join(DATA_DIR, file);
  const tmp = `${full}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, full);
}

/** Validates, then writes only the files whose content changed. Returns their names. */
export async function saveState(state: State): Promise<string[]> {
  IncidentsFileSchema.parse(state.incidents);
  IncidentsFileSchema.parse(state.review);
  RejectedFileSchema.parse(state.rejected);
  PendingFileSchema.parse(state.pending);
  SeenFileSchema.parse(state.seen);
  RunsFileSchema.parse(state.runs);

  const out = serialize(state);
  const changed: string[] = [];
  for (const [key, file] of Object.entries(FILES) as [keyof typeof FILES, string][]) {
    const next = out[key];
    let current = "";
    try {
      current = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    } catch {
      current = "";
    }
    if (current !== next) {
      await writeAtomic(file, next);
      changed.push(file);
    }
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
