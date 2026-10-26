import { z } from "zod";
import { FAMILIES } from "./families";
import {
  AI_TYPES,
  CATEGORIES,
  DATE_PRECISIONS,
  INCIDENT_TYPES,
  LANES,
  ORIGINS,
  PATCH_STATUSES,
  RECORD_STATES,
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

/** Only web URLs: a stored link is rendered as an <a href>, so no other scheme may get in. */
const webUrl = z.url({ protocol: /^https?$/ });

export const SourceSchema = z.object({
  url: webUrl,
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

/** One dated update on a record's timeline: the first reports, then what changed. */
export const TimelineEntrySchema = z.object({
  date: isoDate,
  title: z.string().min(1).max(240),
  source_url: webUrl.optional(),
  /** When the site learned of the entry; what changes.json orders by. */
  added_at: isoDateTime,
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

const cveId = z.string().regex(/^CVE-\d{4}-\d{4,}$/, "CVE-YYYY-NNNN");

/**
 * The day the collector started writing the lifecycle itself. A record
 * created from this day on carries lane, state and patch_status on disk;
 * older records may omit them and get them derived at load until the
 * migration (scripts/migrate-lanes.ts) fills them in. The day after the
 * migration: the old collector's last run (2026-10-26 04:41Z) still wrote
 * records without the keys, which the migration then filled.
 */
export const STAGE_B_CUTOFF = "2026-10-27";

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
    /*
     * The lifecycle (lib/lifecycle.ts). Optional on disk: records that predate
     * lanes carry none of these and get them derived from their other fields
     * at load; a record the collector classified carries them all. The public
     * files always hold the complete form.
     */
    lane: z.enum(LANES).optional(),
    state: z.enum(RECORD_STATES).optional(),
    closed_at: isoDate.nullable().optional(),
    patch_status: z.enum(PATCH_STATUSES).optional(),
    /** The CVE ids the record is about, highest first. */
    cve_ids: z.array(cveId).max(50).optional(),
    affected: z.array(z.string().min(1).max(120)).max(30).optional(),
    fixed_in: z.array(z.string().min(1).max(120)).max(30).optional(),
    timeline: z.array(TimelineEntrySchema).max(200).optional(),
    /** What to do, in our own words; empty when no source says. */
    action: z.string().max(300).optional(),
    /** Why this severity. */
    severity_note: z.string().max(200).optional(),
    cvss: z.number().min(0).max(10).nullable().optional(),
  })
  .refine((i) => i.source_count === i.sources.length, {
    message: "source_count must equal sources.length",
    path: ["source_count"],
  })
  .refine((i) => (i.type === "not_ai" ? i.categories.length === 1 && i.categories[0] === "general" : !i.categories.includes("general")), {
    message: "a record with no AI role carries exactly the category general, and no other record carries it",
    path: ["categories"],
  })
  .refine((i) => (i.state === undefined ? true : i.state === "closed" ? typeof i.closed_at === "string" : (i.closed_at ?? null) === null), {
    message: "closed_at is a date exactly when state is closed",
    path: ["closed_at"],
  })
  .refine((i) => i.created_at.slice(0, 10) < STAGE_B_CUTOFF || (i.lane !== undefined && i.state !== undefined && i.patch_status !== undefined), {
    message: `a record created on or after ${STAGE_B_CUTOFF} carries lane, state and patch_status`,
    path: ["lane"],
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
    /** Records changed by the update pass, closed by the closer and reopened by a new report (runs before the lifecycle lack them). */
    updated: z.number().int().min(0).optional(),
    closed: z.number().int().min(0).optional(),
    reopened: z.number().int().min(0).optional(),
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
    url: webUrl,
    license: z.string(),
  }),
});
export type Radar = z.infer<typeof RadarSchema>;

/**
 * The weekly briefing, data/briefings/<ISO week>.json (lib/briefing.ts
 * computes the numbers, collector/briefing.ts adds the narrative). Every
 * number is reproducible from the incident records; the narrative is a
 * language model's text and is marked as such.
 */
const count = z.number().int().min(0);
const isoWeek = z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, "YYYY-Www");

export const DeltaSchema = z.object({
  now: count,
  before: count,
  change: z.number().int(),
  pct: z.number().nullable(),
});

export const BriefingIncidentSchema = z.object({
  id: z.string().regex(/^AIR-\d{4}-\d{4}$/),
  slug: z.string(),
  title: z.string().min(1).max(160),
  type: z.enum(INCIDENT_TYPES),
  /** Primary category and its family. */
  category: z.enum(CATEGORIES),
  family: z.enum(FAMILIES),
  severity: SeveritySchema,
  targets: z.array(z.enum(TARGETS)).min(1),
  first_reported: isoDate,
  source_count: z.number().int().min(1),
});
export type BriefingIncident = z.infer<typeof BriefingIncidentSchema>;

export const BriefingNumbersSchema = z.object({
  week: isoWeek,
  start: isoDate,
  end: isoDate,
  counts: z.object({
    records: count,
    incidents: count,
    real_world: count,
    disclosed_vulnerabilities: count,
    /** The briefing is the AI week: counts by the two AI types only (lib/counting.ts aiLens). */
    by_type: z.record(z.enum(AI_TYPES), count),
    by_family: z.record(z.enum(FAMILIES), count),
    by_severity: z.record(z.enum(["1", "2", "3", "4"]), count),
  }),
  previous: z.object({ week: isoWeek, incidents: count, real_world: count, disclosed_vulnerabilities: count }),
  deltas: z.object({ incidents: DeltaSchema, real_world: DeltaSchema, disclosed_vulnerabilities: DeltaSchema }),
  busiest_family: z.object({ family: z.enum(FAMILIES), count: count.min(1) }).nullable(),
  top_targets: z.array(z.object({ target: z.enum(TARGETS), count: count.min(1) })).max(3),
  notable: z.array(BriefingIncidentSchema).max(5),
});
export type BriefingNumbers = z.infer<typeof BriefingNumbersSchema>;

export const BriefingNarrativeSchema = z.object({
  headline: z.string().min(1).max(140),
  text: z.string().min(1).max(2000),
  provider: z.string(),
  model: z.string(),
  generated_at: isoDateTime,
});

export const BriefingSchema = BriefingNumbersSchema.extend({
  generated_at: isoDateTime,
  /** Null when no language model was available; `notes` says so. */
  narrative: BriefingNarrativeSchema.nullable(),
  notes: z.array(z.string()),
  /** The dataset the numbers were computed from, for reproducibility. */
  dataset: z.object({ records: count, incidents: count, last_collector_run: isoDateTime.nullable() }),
});
export type Briefing = z.infer<typeof BriefingSchema>;

export const BriefingIndexEntrySchema = z.object({
  week: isoWeek,
  start: isoDate,
  end: isoDate,
  generated_at: isoDateTime,
  incidents: count,
  real_world: count,
  disclosed_vulnerabilities: count,
  headline: z.string().nullable(),
  file: z.string(),
});
export const BriefingIndexSchema = z.object({ generated_at: isoDateTime, briefings: z.array(BriefingIndexEntrySchema) });
export type BriefingIndex = z.infer<typeof BriefingIndexSchema>;
