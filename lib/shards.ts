import { promises as fs } from "node:fs";
import path from "node:path";
import { IncidentsFileSchema, type Incident } from "./schema";
import { shardYear } from "./shard-year";

/**
 * The published dataset lives in year shards, data/incidents/<year>.json,
 * one file per year of first_reported. A collector run touches one or two
 * of them, so a commit rewrites a few hundred kilobytes however large the
 * whole dataset grows (docs/audit-2026-10.md, "What breaks at what size").
 *
 * Before sharding the dataset was one file, data/incidents.json. A checkout
 * that still has only that file (a merge that kept main's copy, an old
 * clone) loads it as it is; the next save writes shards and removes it.
 * Both at once is ambiguous and refused.
 */

export const SHARD_DIR = "incidents";
export const LEGACY_FILE = "incidents.json";

const SHARD_NAME = /^(\d{4})\.json$/;

export type IncidentLayout = "shards" | "legacy" | "empty";

export interface IncidentFiles {
  layout: IncidentLayout;
  /** Paths relative to the data directory, in read order. */
  files: string[];
}

export { shardYear };

/** Relative path of a shard inside the data directory (posix separators, so it reads the same in logs and commits). */
export function shardFile(year: number): string {
  return `${SHARD_DIR}/${year}.json`;
}

/** Newest first, ids descending within a day: the order every incidents file has always used. */
export function byReportedDesc(a: Pick<Incident, "first_reported" | "id">, b: Pick<Incident, "first_reported" | "id">): number {
  return b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id);
}

export function groupByShard<T extends Pick<Incident, "first_reported">>(records: readonly T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const r of records) {
    const y = shardYear(r);
    const list = out.get(y);
    if (list) list.push(r);
    else out.set(y, [r]);
  }
  return new Map([...out.entries()].sort(([a], [b]) => a - b));
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Shard files present on disk, oldest year first. */
export async function listShardFiles(dataDir: string): Promise<{ year: number; file: string }[]> {
  let names: string[];
  try {
    names = await fs.readdir(path.join(dataDir, SHARD_DIR));
  } catch {
    return [];
  }
  return names
    .map((n) => ({ n, m: n.match(SHARD_NAME) }))
    .filter((x): x is { n: string; m: RegExpMatchArray } => x.m !== null)
    .map(({ m }) => ({ year: Number(m[1]), file: shardFile(Number(m[1])) }))
    .sort((a, b) => a.year - b.year);
}

/** Which files hold the dataset in this checkout. Throws when the old single file and shards are both present. */
export async function incidentFiles(dataDir: string): Promise<IncidentFiles> {
  const [shards, legacy] = await Promise.all([listShardFiles(dataDir), exists(path.join(dataDir, LEGACY_FILE))]);
  if (shards.length && legacy) {
    throw new Error(
      `${path.join(dataDir, LEGACY_FILE)} and ${path.join(dataDir, SHARD_DIR)}/ are both present. ` +
        `The dataset is sharded by year now; keep the file that has the records you want and run "npx tsx scripts/shard-incidents.ts" to rebuild the shards from it.`,
    );
  }
  if (shards.length) return { layout: "shards", files: shards.map((s) => s.file) };
  if (legacy) return { layout: "legacy", files: [LEGACY_FILE] };
  return { layout: "empty", files: [] };
}

async function readIncidentsFile(file: string): Promise<Incident[]> {
  const raw = await fs.readFile(file, "utf8");
  const parsed: unknown = raw.trim() ? JSON.parse(raw) : null;
  if (parsed === null) return [];
  return IncidentsFileSchema.parse(parsed);
}

/** Every record in the dataset, validated, newest first. */
export async function readIncidents(dataDir: string, files?: IncidentFiles): Promise<{ incidents: Incident[]; layout: IncidentLayout; files: string[] }> {
  const found = files ?? (await incidentFiles(dataDir));
  const parts = await Promise.all(found.files.map((f) => readIncidentsFile(path.join(dataDir, f))));
  const incidents = parts.flat().sort(byReportedDesc);
  return { incidents, layout: found.layout, files: found.files };
}

/** Serialized shards, keyed by relative path: the exact bytes saveState writes and prebuild mirrors. */
export function serializeShards(incidents: readonly Incident[], indent = 2): Map<string, string> {
  const out = new Map<string, string>();
  for (const [year, records] of groupByShard(incidents)) {
    out.set(shardFile(year), JSON.stringify([...records].sort(byReportedDesc), null, indent) + "\n");
  }
  return out;
}

/** A cheap fingerprint of the dataset files (mtime and size), so build-time loaders can reuse a parse while nothing changed. */
export async function incidentFilesSignature(dataDir: string, files: readonly string[]): Promise<string> {
  const stats = await Promise.all(files.map((f) => fs.stat(path.join(dataDir, f))));
  return files.map((f, i) => `${f}:${stats[i]!.mtimeMs}:${stats[i]!.size}`).join("|");
}
