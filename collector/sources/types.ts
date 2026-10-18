import { z } from "zod";
import { ORIGINS } from "../../lib/taxonomy";
import type { Config, Settings, SourceConfig } from "../lib/config";

/**
 * A candidate is one link discovered by one source. Candidates are the only
 * thing adapters produce; everything downstream (pre-filter, dedupe, LLM
 * classification) works on this shape. `hint` is the feed's own description
 * or the page's meta description, used only for classification and never
 * stored in the dataset.
 */
export const CandidateSchema = z.object({
  /** Stable key: hash of the canonical URL. */
  key: z.string().min(8),
  source_id: z.string(),
  origin: z.enum(ORIGINS),
  url: z.url(),
  title: z.string().min(1).max(400),
  /** YYYY-MM-DD */
  published_at: z.iso.date(),
  publisher: z.string().min(1).max(120),
  hint: z.string().max(2000).default(""),
  cve_ids: z.array(z.string()).default([]),
  discovered_at: z.iso.datetime(),
  /** Structured seeds carry pre-known fields here (e.g. severity hints, incident dates). */
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;
export const PendingFileSchema = z.array(CandidateSchema);

export interface SourceContext {
  config: Config;
  settings: Settings;
  now: Date;
  /** Last successful run of this source, or null. Adapters use it to size their lookback. */
  lastSuccessAt: string | null;
  /** Backfill mode: fetch everything since this date instead of a rolling window. */
  since?: string;
  /** Debug cap on items per source. */
  limit?: number;
  /** Candidate keys already processed (seen.json); adapters that must fetch per page use it to skip work. */
  seenKeys?: Set<string>;
}

export interface SourceAdapter {
  kind: SourceConfig["kind"];
  fetch(source: SourceConfig, ctx: SourceContext): Promise<Candidate[]>;
}
