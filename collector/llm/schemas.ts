import { z } from "zod";
import { AI_CATEGORIES, AI_TYPES, DATE_PRECISIONS, TARGETS } from "../../lib/taxonomy";

/**
 * Strict output contracts for the two LLM tasks. Each has a JSON Schema (sent
 * to the provider as the response format) and a Zod schema (used to validate
 * what actually comes back). No nullable fields: out-of-scope results still
 * carry valid placeholder values and are simply ignored.
 */

export const ClassificationItemSchema = z.object({
  index: z.number().int().min(0),
  in_scope: z.boolean(),
  scope_reason: z.string().max(300),
  // The classifier still answers for AI records only; the general lanes (type not_ai, category general) arrive with the lane contract.
  type: z.enum(AI_TYPES),
  categories: z.array(z.enum(AI_CATEGORIES)).min(1).max(4),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  targets: z.array(z.enum(TARGETS)).min(1).max(6),
  products: z.array(z.string().max(80)).max(10),
  incident_date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/),
  incident_date_precision: z.enum(DATE_PRECISIONS),
  title: z.string().min(8).max(160),
  summary: z.string().min(20).max(700),
  tags: z.array(z.string().min(1).max(40)).max(8),
  confidence: z.number().min(0).max(1),
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
      type: { type: "string", enum: [...AI_TYPES] },
      categories: { type: "array", items: { type: "string", enum: [...AI_CATEGORIES] } },
      severity: { type: "integer", enum: [1, 2, 3, 4] },
      targets: { type: "array", items: { type: "string", enum: [...TARGETS] } },
      products: { type: "array", items: { type: "string" } },
      incident_date: { type: "string" },
      incident_date_precision: { type: "string", enum: [...DATE_PRECISIONS] },
      title: { type: "string" },
      summary: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
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
