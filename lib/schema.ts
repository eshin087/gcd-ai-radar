import { z } from "zod";
import {
  CATEGORIES,
  DATE_PRECISIONS,
  INCIDENT_TYPES,
  ORIGINS,
  STATUSES,
  TARGETS,
} from "./taxonomy";

/**
 * Zod schemas shared by the collector (validating LLM output and data files)
 * and the site (typed loaders). If a record does not pass these schemas it is
 * not published, full stop.
 */

const isoDate = z.iso.date(); // YYYY-MM-DD
const isoDateTime = z.iso.datetime(); // RFC 3339 timestamp
/** Allows approximate dates: YYYY, YYYY-MM or YYYY-MM-DD. */
const approxDate = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, "YYYY, YYYY-MM or YYYY-MM-DD");

export const SourceSchema = z.object({
  url: z.url(),
  publisher: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
  published_at: isoDate,
});
export type Source = z.infer<typeof SourceSchema>;

export const SeveritySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const IncidentSchema = z
  .object({
    id: z.string().regex(/^AIR-\d{4}-\d{4}$/, "AIR-YYYY-NNNN"),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(8).max(160),
    /** Two sentences in our own words. Never quoted article text. */
    summary: z.string().min(20).max(700),
    type: z.enum(INCIDENT_TYPES),
    /** Ordered by relevance; categories[0] is the primary category. */
    categories: z.array(z.enum(CATEGORIES)).min(1).max(4),
    severity: SeveritySchema,
    targets: z.array(z.enum(TARGETS)).min(1).max(6),
    products: z.array(z.string().min(1).max(80)).max(10),
    incident_date: approxDate,
    incident_date_precision: z.enum(DATE_PRECISIONS),
    /** Earliest source date. Always a full date. */
    first_reported: isoDate,
    sources: z.array(SourceSchema).min(1),
    source_count: z.number().int().min(1),
    confidence: z.number().min(0).max(1),
    status: z.enum(STATUSES),
    origin: z.enum(ORIGINS),
    tags: z.array(z.string().min(1).max(40)).max(20),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .refine((i) => i.source_count === i.sources.length, {
    message: "source_count must equal sources.length",
    path: ["source_count"],
  })
  .refine(
    (i) =>
      (i.incident_date_precision === "day" && i.incident_date.length === 10) ||
      (i.incident_date_precision === "month" && i.incident_date.length === 7) ||
      (i.incident_date_precision === "year" && i.incident_date.length === 4),
    { message: "incident_date must match incident_date_precision", path: ["incident_date"] },
  );
export type Incident = z.infer<typeof IncidentSchema>;

export const IncidentsFileSchema = z.array(IncidentSchema);

/** A record of one collector run, appended to data/runs.json. */
export const SourceRunSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  items: z.number().int().min(0),
  status: z.number().int().optional(),
  error: z.string().optional(),
  duration_ms: z.number().int().min(0),
});

export const RunRecordSchema = z.object({
  id: z.string(),
  started_at: isoDateTime,
  finished_at: isoDateTime,
  mode: z.enum(["scheduled", "manual", "backfill", "dry-run"]),
  sources: z.array(SourceRunSchema),
  counts: z.object({
    fetched: z.number().int().min(0),
    prefiltered: z.number().int().min(0),
    merged: z.number().int().min(0),
    classified: z.number().int().min(0),
    published: z.number().int().min(0),
    review: z.number().int().min(0),
    rejected: z.number().int().min(0),
    pending: z.number().int().min(0),
  }),
  llm: z.object({
    calls: z.number().int().min(0),
    prompt_tokens: z.number().int().min(0),
    completion_tokens: z.number().int().min(0),
    by_model: z.record(
      z.string(),
      z.object({
        calls: z.number().int().min(0),
        prompt_tokens: z.number().int().min(0),
        completion_tokens: z.number().int().min(0),
      }),
    ),
  }),
  errors: z.array(z.string()),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;
export const RunsFileSchema = z.array(RunRecordSchema);

/** Cloudflare Radar sidebar data, data/radar.json. */
export const RadarSchema = z.object({
  fetched_at: isoDateTime,
  range: z.string(),
  bot_share: z.object({ value: z.number(), previous: z.number().nullable() }),
  ai_crawler_share_of_bots: z.number().nullable(),
  derived_ai_share_of_requests: z.number().nullable(),
  top_ai_bots: z.array(z.object({ name: z.string(), share: z.number() })),
  crawl_purpose: z.array(z.object({ name: z.string(), share: z.number() })),
  attribution: z.object({
    source: z.string(),
    url: z.url(),
    license: z.string(),
  }),
});
export type Radar = z.infer<typeof RadarSchema>;
