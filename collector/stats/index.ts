import { promises as fs } from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";
import { readIncidents } from "../../lib/shards";
import { STATS_FILES, STATS_SCHEMAS, type StatsFiles } from "../../lib/stats-schema";
import type { Settings } from "../lib/config";
import { httpJson, sleep } from "../lib/http";
import { errorMessage, log } from "../lib/log";
import { DATA_DIR, writeAtomic } from "../lib/state";
import { epssModule } from "./epss";
import { hibpModule } from "./hibp";
import { kevModule } from "./kev";
import { cvesRecentModule, nvdCountsModule } from "./nvd";
import type { StatsContext, StatsHttp, StatsModule, StatsResult } from "./types";

/**
 * The daily stats stage: five files under data/stats/, each owned by one
 * module (nvd.ts, kev.ts, hibp.ts, epss.ts). Like the Radar sidebar data,
 * each file carries its own fetched_at and is due again once it is older
 * than the module's maxAgeHours; a failed fetch keeps the previous file and
 * logs a warning; a changed file is a site change, so the run deploys.
 * `npm run stats` runs it by hand (--dry-run, --force, --only=<name>).
 */

export const STATS_SUBDIR = "stats";
export const STATS_DIR = path.join(DATA_DIR, STATS_SUBDIR);

/** In dependency order: EPSS needs the ids the earlier modules produced. */
export const STATS_MODULES: readonly StatsModule<unknown>[] = [nvdCountsModule, cvesRecentModule, kevModule, hibpModule, epssModule] as readonly StatsModule<unknown>[];

export interface RunStatsOptions {
  dryRun?: boolean;
  force?: boolean;
  /** Module names to run; the rest are left alone. */
  only?: readonly string[];
  now?: Date;
  http?: StatsHttp;
  dataDir?: string;
  recordCveIds?: readonly string[];
}

export function isFresh(previous: { fetched_at: string } | null, maxAgeHours: number, now: Date): boolean {
  return Boolean(previous && now.getTime() - Date.parse(previous.fetched_at) < maxAgeHours * 3600 * 1000);
}

export async function readStatsFile<T>(dataDir: string, file: string, schema: ZodType<T>): Promise<T | null> {
  try {
    const raw = await fs.readFile(path.join(dataDir, STATS_SUBDIR, file), "utf8");
    return schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Every stats file, each null when absent or invalid (the site's loader uses the same rule). */
export async function readAllStats(dataDir = DATA_DIR): Promise<StatsFiles> {
  const [nvdCounts, cvesRecent, kev, hibp, epss] = await Promise.all([
    readStatsFile(dataDir, STATS_FILES.nvdCounts, STATS_SCHEMAS.nvdCounts),
    readStatsFile(dataDir, STATS_FILES.cvesRecent, STATS_SCHEMAS.cvesRecent),
    readStatsFile(dataDir, STATS_FILES.kev, STATS_SCHEMAS.kev),
    readStatsFile(dataDir, STATS_FILES.hibp, STATS_SCHEMAS.hibp),
    readStatsFile(dataDir, STATS_FILES.epss, STATS_SCHEMAS.epss),
  ]);
  return { nvdCounts, cvesRecent, kev, hibp, epss };
}

/**
 * Stable JSON with one array element (or one `scores` entry) per line, so a
 * daily refresh diffs as the lines that changed rather than a rewritten file.
 */
export function serializeStats(obj: Record<string, unknown>): string {
  const parts = Object.entries(obj).map(([key, value]) => {
    const k = JSON.stringify(key);
    if (Array.isArray(value)) return value.length === 0 ? `${k}: []` : `${k}: [\n${value.map((x) => `  ${JSON.stringify(x)}`).join(",\n")}\n ]`;
    if (key === "scores" && value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
      return entries.length === 0 ? `${k}: {}` : `${k}: {\n${entries.map(([a, b]) => `  ${JSON.stringify(a)}: ${JSON.stringify(b)}`).join(",\n")}\n }`;
    }
    return `${k}: ${JSON.stringify(value)}`;
  });
  return `{\n ${parts.join(",\n ")}\n}\n`;
}

function idsFrom(name: string, value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (name === "cves-recent") return ((value as { cves?: { id: string }[] }).cves ?? []).map((c) => c.id);
  if (name === "kev") return ((value as { entries?: { cve: string }[] }).entries ?? []).map((e) => e.cve);
  return [];
}

async function recordCveIdsFromDisk(dataDir: string): Promise<string[]> {
  try {
    const { incidents } = await readIncidents(dataDir);
    return [...new Set(incidents.filter((i) => i.status === "published").flatMap((i) => i.cve_ids ?? []))];
  } catch (err) {
    log.warn("stats: could not read the records' CVE ids", { error: errorMessage(err).slice(0, 160) });
    return [];
  }
}

export async function runStats(settings: Settings, opts: RunStatsOptions = {}): Promise<StatsResult> {
  const now = opts.now ?? new Date();
  const dataDir = opts.dataDir ?? DATA_DIR;
  const http: StatsHttp = opts.http ?? { json: (url, o) => httpJson(url, o), sleep };
  const recordCveIds = opts.recordCveIds ?? (await recordCveIdsFromDisk(dataDir));
  const result: StatsResult = { changed: [], failed: [], skipped: [] };
  const extraCveIds: string[] = [];
  const ctx: StatsContext = { settings, now, http, recordCveIds, extraCveIds, log: (msg, meta) => log.info(msg, meta) };

  for (const mod of STATS_MODULES) {
    const previous = await readStatsFile(dataDir, mod.file, mod.schema);
    if (opts.only && !opts.only.includes(mod.name)) {
      extraCveIds.push(...idsFrom(mod.name, previous));
      continue;
    }
    if (!opts.force && isFresh(previous as { fetched_at: string } | null, mod.maxAgeHours, now)) {
      result.skipped.push(mod.name);
      extraCveIds.push(...idsFrom(mod.name, previous));
      log.debug(`stats ${mod.name}: fresh, skipping`);
      continue;
    }
    try {
      const next = mod.schema.parse(await mod.fetch(ctx, previous));
      extraCveIds.push(...idsFrom(mod.name, next));
      const content = serializeStats(next as Record<string, unknown>);
      const file = path.join(STATS_SUBDIR, mod.file);
      let current: string | null = null;
      try {
        current = await fs.readFile(path.join(dataDir, file), "utf8");
      } catch {
        current = null;
      }
      // fetched_at always differs; compare the rest so an unchanged day writes nothing
      const same = current !== null && stripFetchedAt(current) === stripFetchedAt(content);
      if (same) {
        result.skipped.push(mod.name);
        continue;
      }
      if (!opts.dryRun) await writeAtomic(dataDir, file, content);
      result.changed.push(file.replace(/\\/g, "/"));
    } catch (err) {
      result.failed.push(mod.name);
      extraCveIds.push(...idsFrom(mod.name, previous));
      log.warn(`stats ${mod.name}: fetch failed, keeping the previous file`, { error: errorMessage(err).slice(0, 200) });
    }
  }
  log.info("stats: done", { changed: result.changed, failed: result.failed, skipped: result.skipped, dry_run: Boolean(opts.dryRun) });
  return result;
}

function stripFetchedAt(s: string): string {
  return s.replace(/"fetched_at": "[^"]*"/, '"fetched_at": ""');
}
