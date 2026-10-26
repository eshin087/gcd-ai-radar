import { z } from "zod";
import { CATEGORIES, DATE_PRECISIONS, INCIDENT_TYPES, LANES, PATCH_STATUSES, TARGETS } from "../../lib/taxonomy";

/**
 * Strict output contracts for the LLM tasks. Each has a JSON Schema (sent to
 * the provider as the response format: one object serves Groq's strict mode
 * and Gemini's responseJsonSchema, so no nullable or optional fields) and a
 * Zod schema (used to validate what actually comes back). Out-of-scope
 * results still carry valid placeholder values and are simply ignored.
 */

export const ClassificationItemSchema = z.object({
  index: z.number().int().min(0),
  in_scope: z.boolean(),
  scope_reason: z.string().max(300),
  /** The AI role: the two AI types, or not_ai for a general security incident (categories ["general"]). */
  type: z.enum(INCIDENT_TYPES),
  categories: z.array(z.enum(CATEGORIES)).min(1).max(4),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  targets: z.array(z.enum(TARGETS)).min(1).max(6),
  products: z.array(z.string().max(80)).max(10),
  incident_date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/),
  incident_date_precision: z.enum(DATE_PRECISIONS),
  title: z.string().min(8).max(160),
  summary: z.string().min(20).max(700),
  tags: z.array(z.string().min(1).max(40)).max(8),
  confidence: z.number().min(0).max(1),
  /** The lifecycle contract (lib/lifecycle.ts). */
  lane: z.enum(LANES),
  /** Whether the item clears the curation bar (lib/curation-rules.ts); decides publication for not_ai items. */
  newsworthy: z.boolean(),
  newsworthy_reason: z.string().max(200),
  patch_status: z.enum(PATCH_STATUSES),
  /** "product < version" entries, only when a source states them. */
  affected: z.array(z.string().max(80)).max(10),
  fixed_in: z.array(z.string().max(80)).max(10),
  /** One imperative sentence in our words, or "". */
  action: z.string().max(300),
  /** Why this severity. */
  severity_note: z.string().max(200),
  /** CVSS base score as stated by a source; 0 when none states one. */
  cvss: z.number().min(0).max(10),
});
export type ClassificationItem = z.infer<typeof ClassificationItemSchema>;

export const ClassificationBatchSchema = z.object({ results: z.array(ClassificationItemSchema) });
export type ClassificationBatch = z.infer<typeof ClassificationBatchSchema>;

export const SameIncidentDecisionSchema = z.object({
  index: z.number().int().min(0),
  /** Incident id when the candidate describes the same event, otherwise "". */
  same_as: z.string(),
  confidence: z.number().min(0).max(1),
});
export const SameIncidentBatchSchema = z.object({ decisions: z.array(SameIncidentDecisionSchema) });
export type SameIncidentBatch = z.infer<typeof SameIncidentBatchSchema>;

/** One timeline update: what a new report adds to a record it was merged into (pipeline/update.ts). */
export const UpdateResultSchema = z.object({
  index: z.number().int().min(0),
  /** False when the report adds nothing new (a reprint): no entry is written. */
  add_entry: z.boolean(),
  /** The timeline entry, one neutral clause of what changed. */
  entry: z.string().max(200),
  /** The record's new fix status, or "keep". */
  patch_status: z.enum([...PATCH_STATUSES, "keep"]),
  fixed_in: z.array(z.string().max(80)).max(5),
  /** A new one-sentence action, or "" to keep the current one. */
  action: z.string().max(300),
});
export type UpdateResult = z.infer<typeof UpdateResultSchema>;
export const UpdateBatchSchema = z.object({ results: z.array(UpdateResultSchema) });
export type UpdateBatch = z.infer<typeof UpdateBatchSchema>;

const strictObject = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const CLASSIFICATION_JSON_SCHEMA = strictObject({
  results: {
    type: "array",
    items: strictObject({
      index: { type: "integer" },
      in_scope: { type: "boolean" },
      scope_reason: { type: "string" },
      type: { type: "string", enum: [...INCIDENT_TYPES] },
      categories: { type: "array", items: { type: "string", enum: [...CATEGORIES] } },
      severity: { type: "integer", enum: [1, 2, 3, 4] },
      targets: { type: "array", items: { type: "string", enum: [...TARGETS] } },
      products: { type: "array", items: { type: "string" } },
      incident_date: { type: "string" },
      incident_date_precision: { type: "string", enum: [...DATE_PRECISIONS] },
      title: { type: "string" },
      summary: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
      lane: { type: "string", enum: [...LANES] },
      newsworthy: { type: "boolean" },
      newsworthy_reason: { type: "string" },
      patch_status: { type: "string", enum: [...PATCH_STATUSES] },
      affected: { type: "array", items: { type: "string" } },
      fixed_in: { type: "array", items: { type: "string" } },
      action: { type: "string" },
      severity_note: { type: "string" },
      cvss: { type: "number" },
    }),
  },
});

export const SAME_INCIDENT_JSON_SCHEMA = strictObject({
  decisions: {
    type: "array",
    items: strictObject({
      index: { type: "integer" },
      same_as: { type: "string" },
      confidence: { type: "number" },
    }),
  },
});

export const UPDATE_JSON_SCHEMA = strictObject({
  results: {
    type: "array",
    items: strictObject({
      index: { type: "integer" },
      add_entry: { type: "boolean" },
      entry: { type: "string" },
      patch_status: { type: "string", enum: [...PATCH_STATUSES, "keep"] },
      fixed_in: { type: "array", items: { type: "string" } },
      action: { type: "string" },
    }),
  },
});

/** Strips ```json fences and leading prose some models add despite JSON mode. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]!.trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error(`LLM returned non-JSON: ${body.slice(0, 160)}`);
  }
}

/** The weekly briefing's narrative (collector/briefing.ts). Length, numbers and links are checked separately in collector/lib/narrative.ts. */
export const BriefingNarrativeOutputSchema = z.object({
  headline: z.string().min(10).max(140),
  narrative: z.string().min(200).max(1800),
});
export type BriefingNarrativeOutput = z.infer<typeof BriefingNarrativeOutputSchema>;

export const BRIEFING_NARRATIVE_JSON_SCHEMA = strictObject({
  headline: { type: "string" },
  narrative: { type: "string" },
});
