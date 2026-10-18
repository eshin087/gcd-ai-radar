import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";
import type { ZodType } from "zod";
import { RadarSchema, RunsFileSchema, type Incident, type Radar, type RunRecord } from "./schema";
import { incidentFiles, incidentFilesSignature, readIncidents } from "./shards";

/**
 * Build-time data access. Everything the site renders comes from /data in
 * the repo, parsed and validated here. There is no runtime data fetching.
 *
 * The dataset is read from its year shards (lib/shards.ts). A static build
 * renders one page per incident, each asking for the dataset again, so the
 * parse is kept for as long as the files on disk are unchanged: one parse per
 * build worker instead of one per page.
 */

export const DATA_DIR = path.join(process.cwd(), "data");

async function readJson<T>(file: string, schema: ZodType<T>): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null) return null;
  return schema.parse(parsed);
}

export interface IncidentData {
  incidents: Incident[];
}

let memo: { signature: string; data: IncidentData } | null = null;
let inflight: Promise<IncidentData> | null = null;

async function loadIncidentsFresh(): Promise<IncidentData> {
  const files = await incidentFiles(DATA_DIR);
  const signature = await incidentFilesSignature(DATA_DIR, files.files);
  if (memo && memo.signature === signature) return memo.data;
  const { incidents } = await readIncidents(DATA_DIR, files);
  const data: IncidentData = { incidents: incidents.filter((i) => i.status === "published") };
  memo = { signature, data };
  return data;
}

export const loadIncidents = cache(async (): Promise<IncidentData> => {
  if (!inflight) {
    inflight = loadIncidentsFresh().finally(() => {
      inflight = null;
    });
  }
  return inflight;
});

export const loadRuns = cache(async (): Promise<RunRecord[]> => {
  return (await readJson(path.join(DATA_DIR, "runs.json"), RunsFileSchema)) ?? [];
});

export const loadRadar = cache(async (): Promise<Radar | null> => {
  try {
    return await readJson(path.join(DATA_DIR, "radar.json"), RadarSchema);
  } catch {
    // A radar.json that no longer matches the schema hides the panel instead of failing the build.
    return null;
  }
});

/** Most recent successful run, or null when the collector has never run. */
export async function lastUpdated(): Promise<string | null> {
  const runs = await loadRuns();
  if (runs.length === 0) return null;
  return runs.reduce((a, b) => (a.finished_at > b.finished_at ? a : b)).finished_at;
}

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/** Slug lookup in constant time: the map is built once per dataset array (every incident page asks). */
const slugMaps = new WeakMap<Incident[], Map<string, Incident>>();

export function incidentBySlug(incidents: Incident[], slug: string): Incident | undefined {
  let map = slugMaps.get(incidents);
  if (!map) {
    map = new Map(incidents.map((i) => [i.slug, i]));
    slugMaps.set(incidents, map);
  }
  return map.get(slug);
}
