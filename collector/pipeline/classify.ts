import { z } from "zod";
import { log, errorMessage } from "../lib/log";
import { truncate } from "../lib/text";
import { classificationPrompt, sameIncidentPrompt, type BatchItem, type SameIncidentItem } from "../llm/prompts";
import type { LlmRouter } from "../llm/router";
import {
  CLASSIFICATION_JSON_SCHEMA,
  ClassificationBatchSchema,
  SAME_INCIDENT_JSON_SCHEMA,
  SameIncidentBatchSchema,
  type ClassificationItem,
} from "../llm/schemas";
import { NoProviderAvailable } from "../llm/types";
import type { Candidate } from "../sources/types";
import type { Cluster, LlmCheck } from "./dedupe";

/**
 * LLM stages. Both are batched, validated with Zod, retried once with the
 * validation error as feedback, and degrade to "pending" (never to a guess)
 * when no provider can serve the call.
 */

export interface ClassifiedCluster {
  cluster: Cluster;
  result: ClassificationItem;
  provider: string;
  model: string;
}

export interface ClassifyOutcome {
  classified: ClassifiedCluster[];
  pending: Cluster[];
  errors: string[];
}

/** One candidate view per cluster: the primary plus the other outlets' titles as extra context. */
export function clusterView(cl: Cluster, maxHint = 900): Candidate {
  const others = cl.members
    .filter((m) => m !== cl.primary)
    .slice(0, 4)
    .map((m) => `Also covered as "${m.title}" (${m.publisher}, ${m.published_at}).`);
  const hint = [cl.primary.hint, ...others].filter(Boolean).join(" ");
  return { ...cl.primary, hint: truncate(hint, maxHint), cve_ids: [...new Set(cl.members.flatMap((m) => m.cve_ids))] };
}

function indexResults<T extends { index: number }>(items: T[]): Map<number, T> {
  const map = new Map<number, T>();
  for (const it of items) if (!map.has(it.index)) map.set(it.index, it);
  return map;
}

async function classifyBatch(items: BatchItem[], router: LlmRouter, errors: string[]): Promise<Map<number, ClassificationItem> | null> {
  const prompt = classificationPrompt(items);
  const wanted = new Set(items.map((i) => i.index));
  const collected = new Map<number, ClassificationItem>();
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { parsed, provider, model } = await router.completeJson({
        system: prompt.system,
        user: feedback ? `${prompt.user}\n\n${feedback}` : prompt.user,
        schemaName: "classification_batch",
        jsonSchema: CLASSIFICATION_JSON_SCHEMA,
      });
      const check = ClassificationBatchSchema.safeParse(parsed);
      if (check.success) {
        for (const r of check.data.results) if (wanted.has(r.index) && !collected.has(r.index)) collected.set(r.index, r);
        log.debug("classified batch", { provider, model, items: items.length, valid: collected.size });
      } else {
        // Salvage valid entries, ask again for the rest.
        const raw = (parsed as { results?: unknown[] })?.results ?? [];
        for (const entry of raw) {
          const one = z.object({ index: z.number() }).safeParse(entry);
          if (!one.success) continue;
          const item = ClassificationBatchSchema.shape.results.element.safeParse(entry);
          if (item.success && wanted.has(item.data.index)) collected.set(item.data.index, item.data);
        }
        feedback = `Your previous response failed validation: ${check.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}. Return the full JSON again, following the schema exactly.`;
      }
      const missing = [...wanted].filter((i) => !collected.has(i));
      if (missing.length === 0) return collected;
      feedback = feedback || `Your previous response was missing results for item(s) ${missing.join(", ")}. Return results for every item.`;
    } catch (err) {
      if (err instanceof NoProviderAvailable) {
        errors.push(`classification: ${err.message}`);
        return collected.size ? collected : null;
      }
      feedback = `Your previous response was not valid JSON (${errorMessage(err).slice(0, 120)}). Return only the JSON object.`;
      errors.push(`classification batch attempt ${attempt + 1}: ${errorMessage(err).slice(0, 200)}`);
    }
  }
  return collected;
}

export async function classifyClusters(clusters: Cluster[], router: LlmRouter): Promise<ClassifyOutcome> {
  const out: ClassifyOutcome = { classified: [], pending: [], errors: [] };
  let i = 0;
  while (i < clusters.length) {
    if (!router.available) {
      out.pending.push(...clusters.slice(i));
      break;
    }
    const batch = clusters.slice(i, i + router.batchSize);
    i += batch.length;
    const items: BatchItem[] = batch.map((cl, idx) => ({ index: idx, candidate: clusterView(cl) }));
    const results = await classifyBatch(items, router, out.errors);
    batch.forEach((cl, idx) => {
      const r = results?.get(idx);
      if (r) out.classified.push({ cluster: cl, result: r, provider: "", model: "" });
      else out.pending.push(cl);
    });
    if (results === null && !router.available) {
      out.pending.push(...clusters.slice(i));
      break;
    }
  }
  return out;
}

export interface SameIncidentOutcome {
  /** candidate key → incident id ("" when the LLM said it is a new incident) */
  decisions: Map<string, string>;
  unresolved: LlmCheck[];
  errors: string[];
}

export async function resolveSameIncident(checks: LlmCheck[], router: LlmRouter, batchSize = 8): Promise<SameIncidentOutcome> {
  const out: SameIncidentOutcome = { decisions: new Map(), unresolved: [], errors: [] };
  for (let i = 0; i < checks.length; i += batchSize) {
    const batch = checks.slice(i, i + batchSize);
    if (!router.available) {
      out.unresolved.push(...batch);
      continue;
    }
    const items: SameIncidentItem[] = batch.map((c, idx) => ({ index: idx, candidate: c.candidate, matches: c.matches.map((m) => m.ref) }));
    const prompt = sameIncidentPrompt(items);
    try {
      const { parsed } = await router.completeJson({
        system: prompt.system,
        user: prompt.user,
        schemaName: "same_incident_batch",
        jsonSchema: SAME_INCIDENT_JSON_SCHEMA,
      });
      const check = SameIncidentBatchSchema.safeParse(parsed);
      if (!check.success) throw new Error(`invalid same-incident response: ${check.error.issues[0]?.message}`);
      const byIndex = indexResults(check.data.decisions);
      batch.forEach((c, idx) => {
        const d = byIndex.get(idx);
        if (!d) {
          out.unresolved.push(c);
          return;
        }
        const allowed = new Set(c.matches.map((m) => m.ref.id));
        out.decisions.set(c.candidate.key, d.same_as && allowed.has(d.same_as) && d.confidence >= 0.6 ? d.same_as : "");
      });
    } catch (err) {
      out.errors.push(`same-incident: ${errorMessage(err).slice(0, 200)}`);
      out.unresolved.push(...batch);
    }
  }
  return out;
}
