import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";
import type { ZodType } from "zod";
import {
  IncidentsFileSchema,
  RadarSchema,
  RunsFileSchema,
  type Incident,
  type Radar,
  type RunRecord,
} from "./schema";

/**
 * Build-time data access. Everything the site renders comes from /data/*.json
 * in the repo, parsed and validated here. There is no runtime data fetching.
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

export const loadIncidents = cache(async (): Promise<IncidentData> => {
  const real = (await readJson(path.join(DATA_DIR, "incidents.json"), IncidentsFileSchema)) ?? [];
  return { incidents: real.filter((i) => i.status === "published") };
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

export function incidentBySlug(incidents: Incident[], slug: string): Incident | undefined {
  return incidents.find((i) => i.slug === slug);
}
