import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/** Typed access to collector/config/*.json. Every file is validated on load. */

export const CONFIG_DIR = path.join(process.cwd(), "collector", "config");

export const SOURCE_KINDS = [
  "hn",
  "gdelt",
  "bluesky",
  "rss",
  "sitemap",
  "arxiv",
  "nvd",
  "ghsa",
  "kev",
  "aiid",
  "atlas",
  "avid",
  "msrc",
  "hibp",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** How often a source is read. The collector runs hourly; every_run sources are read each time, the others when they are due (pipeline/run.ts DUE_HOURS). */
export const SCHEDULES = ["every_run", "six_hourly", "daily", "weekly", "monthly"] as const;
export type Schedule = (typeof SCHEDULES)[number];

export const SourceConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  kind: z.enum(SOURCE_KINDS),
  url: z.string().optional(),
  publisher: z.string().optional(),
  /** press/vendor need keyword matches; specialist/seed bypass the pre-filter; social is press-like. */
  tier: z.enum(["press", "vendor", "specialist", "seed", "social"]),
  schedule: z.enum(SCHEDULES).default("every_run"),
  enabled: z.boolean().default(true),
  /** Regex (case-insensitive) a title must match to be considered. */
  title_filter: z.string().optional(),
  /** Regex (case-insensitive) matched over the title and summary together (rss sources); items that miss are dropped. */
  text_filter: z.string().optional(),
  /** Regex (case-insensitive) a URL must match (sitemap sources). */
  url_filter: z.string().optional(),
  max_bytes: z.number().int().positive().optional(),
  notes: z.string().optional(),
});
export type SourceConfig = z.infer<typeof SourceConfigSchema>;

const ProviderSchema = z.object({
  id: z.string(),
  /** openai_compatible covers OpenRouter, Cloudflare Workers AI, Ollama, vLLM and any /v1/chat/completions endpoint. */
  kind: z.enum(["gemini", "groq", "openai_compatible"]),
  model: z.string(),
  env: z.string(),
  /** openai_compatible only: API base ending in /v1 (default https://api.openai.com/v1). */
  base_url: z.string().url().optional(),
  /** openai_compatible only: json_schema (strict) or json_object for endpoints without schema support. */
  json_mode: z.enum(["json_schema", "json_object"]).default("json_schema"),
  rpm: z.number().int().positive(),
  daily_calls: z.number().int().positive(),
  batch_size: z.number().int().positive(),
  /** IANA zone in which the daily quota resets (Gemini: America/Los_Angeles). */
  reset_tz: z.string().default("UTC"),
});
export type ProviderConfig = z.infer<typeof ProviderSchema>;

export const SettingsSchema = z.object({
  confidence_threshold: z.number().min(0).max(1),
  review_severity_4: z.boolean(),
  /** Severity-4 claims with no AI role (HIBP breaches, say) go to review first. settings.json turns it off: an untended queue hid the biggest breaches. */
  review_not_ai_severity_4: z.boolean().default(true),
  dedupe: z.object({
    lookback_days: z.number().int().positive(),
    merge_similarity: z.number().min(0).max(1),
    llm_check_similarity: z.number().min(0).max(1),
    date_window_days: z.number().int().positive(),
    /** A title token names an entity when at most this many records or candidates carry it. */
    entity_max_df: z.number().int().positive().default(5),
    /** A shared entity triggers an LLM check only against records first reported this recently. */
    entity_window_days: z.number().int().positive().default(14),
    /** The product pass compares records whose incident dates lie within this many days. */
    product_window_days: z.number().int().positive().default(7),
  }),
  classify: z
    .object({
      /** The fuse: clusters beyond this wait for the next run, whatever the providers' budgets say. */
      max_per_run: z.number().int().positive(),
    })
    .default({ max_per_run: 40 }),
  update: z
    .object({
      /** Timeline updates asked of the model per call. */
      batch_size: z.number().int().positive(),
    })
    .default({ batch_size: 5 }),
  ghsa_lookup: z
    .object({
      /** GitHub advisory lookups (one per CVE) per run, for version data on live records. */
      per_run: z.number().int().min(0),
      /** A CVE with no advisory is asked again after this many days. */
      recheck_days: z.number().int().positive(),
    })
    .default({ per_run: 20, recheck_days: 7 }),
  fetch: z.object({
    timeout_ms: z.number().int().positive(),
    retries: z.number().int().min(0),
    max_body_bytes: z.number().int().positive(),
    user_agent: z.string(),
    hint_max_chars: z.number().int().positive(),
  }),
  gdelt: z.object({
    spacing_ms: z.number().int().positive(),
    timespan: z.string(),
    max_records: z.number().int().positive(),
  }),
  /** Have I Been Pwned breach API: breaches below this account count are left to the press feeds. */
  hibp: z
    .object({
      min_pwn_count: z.number().int().min(0),
    })
    .default({ min_pwn_count: 100000 }),
  providers: z.array(ProviderSchema).min(1),
  retention: z.object({
    rejected_days: z.number().int().positive(),
    runs_keep: z.number().int().positive(),
  }),
  /** When the unattended run should raise its hand (collector/pipeline/health.ts). */
  alerts: z
    .object({
      /** Fail the job after this many consecutive scheduled runs that classified nothing while candidates waited. */
      stalled_runs: z.number().int().min(1),
      /** Warn in the job summary when this many candidates are waiting for classification. */
      pending_warn: z.number().int().min(0),
    })
    .default({ stalled_runs: 3, pending_warn: 300 }),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** `queries` drive every query source (AI terms); `general` is the whole-web list only Hacker News reads (GDELT returns hundreds of long-tail articles for it). */
const QueriesSchema = z.object({ queries: z.array(z.string().min(2)), general: z.array(z.string().min(2)).default([]) });
const KeywordsSchema = z.object({
  ai_terms: z.array(z.string()),
  security_terms: z.array(z.string()),
  negative_terms: z.array(z.string()),
});
const PackagesSchema = z.object({
  ghsa: z.record(z.string(), z.array(z.string())),
  nvd_keywords: z.array(z.string()),
});
const PublishersSchema = z.record(z.string(), z.string());
const SourcesFileSchema = z.object({ sources: z.array(SourceConfigSchema) });

export interface Config {
  settings: Settings;
  sources: SourceConfig[];
  queries: string[];
  /** Whole-web query phrases (Hacker News only). */
  generalQueries: string[];
  keywords: z.infer<typeof KeywordsSchema>;
  packages: z.infer<typeof PackagesSchema>;
  publishers: Record<string, string>;
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(CONFIG_DIR, name), "utf8"));
}

export function loadConfig(): Config {
  const queries = QueriesSchema.parse(readJson("queries.json"));
  return {
    settings: SettingsSchema.parse(readJson("settings.json")),
    sources: SourcesFileSchema.parse(readJson("sources.json")).sources,
    queries: queries.queries,
    generalQueries: queries.general,
    keywords: KeywordsSchema.parse(readJson("keywords.json")),
    packages: PackagesSchema.parse(readJson("packages.json")),
    publishers: PublishersSchema.parse(readJson("publishers.json")),
  };
}
