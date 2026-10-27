import type { ZodType } from "zod";
import type { HttpOptions } from "../lib/http";
import type { Settings } from "../lib/config";

/**
 * A stats module fetches one source and returns the whole file it owns.
 * The runner decides whether it is due, keeps the previous file when it
 * fails, validates and writes the result (collector/stats/index.ts).
 */
export interface StatsModule<T> {
  name: string;
  /** File name under data/stats/. */
  file: string;
  schema: ZodType<T>;
  /** Refetch once the previous file is older than this. */
  maxAgeHours: number;
  fetch(ctx: StatsContext, previous: T | null): Promise<T>;
}

/** The HTTP client the modules use; tests inject a recorded one. */
export interface StatsHttp {
  json<T>(url: string, opts?: HttpOptions): Promise<T>;
  sleep(ms: number): Promise<void>;
}

export interface StatsContext {
  settings: Settings;
  now: Date;
  http: StatsHttp;
  /** CVE ids named by our published records, for the EPSS module. */
  recordCveIds: readonly string[];
  /** CVE ids the other modules produced this run (recent CVEs, the KEV catalog), filled by the runner before the EPSS module runs. */
  extraCveIds: readonly string[];
  log: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface StatsResult {
  changed: string[];
  failed: string[];
  skipped: string[];
}
