import { shouldReopen, withLifecycle, type FullIncident } from "../../lib/lifecycle";
import { IncidentSchema, type Incident, type TimelineEntry } from "../../lib/schema";
import type { PatchStatus } from "../../lib/taxonomy";
import type { Settings } from "../lib/config";
import { errorMessage, log } from "../lib/log";
import { truncate } from "../lib/text";
import { updatePrompt, type UpdateItem } from "../llm/prompts";
import type { LlmRouter } from "../llm/router";
import { UPDATE_JSON_SCHEMA, UpdateBatchSchema, type UpdateResult } from "../llm/schemas";
import { NoProviderAvailable } from "../llm/types";
import type { Candidate } from "../sources/types";
import type { Merge } from "./dedupe";
import { cleanLlmText, cleanVersionList } from "./publish";

/**
 * The update pass. A report merged into an existing record (a follow-up, a
 * patch, another outlet) is more than a new source: it is a dated entry on
 * the record's timeline, it may change the fix status, the fixed versions or
 * the action, and it reopens a closed record when it is recent enough
 * (lib/lifecycle.ts shouldReopen). Structured candidates (KEV, GHSA, NVD)
 * are applied without a model; the rest are asked of the model in batches;
 * when no model can answer, the report's title becomes the entry and nothing
 * else changes. Every change is validated and rolled back as a whole on
 * failure. The record is persisted in its complete lifecycle form.
 */

export interface UpdateOutcome {
  /** Records that gained at least one entry or field change. */
  updated: number;
  reopened: number;
  entries: number;
  structured: number;
  byModel: number;
  fallback: number;
  errors: string[];
}

export const KEV_TAG = "cisa-kev";

function today(now: string): string {
  return now.slice(0, 10);
}

/**
 * One entry per source URL. A record without a stored timeline renders one
 * seeded entry per source, titled with the article headline, and the merged
 * source is already among them; the update replaces that wording with what
 * the report actually added. Returns true when an entry was added or rewritten.
 */
function pushEntry(t: FullIncident, entry: TimelineEntry): boolean {
  if (!entry.title) return false;
  const existing = entry.source_url ? t.timeline.find((e) => e.source_url === entry.source_url) : undefined;
  if (existing) {
    if (existing.title === entry.title) return false;
    existing.title = entry.title;
    existing.date = entry.date;
  } else {
    t.timeline.push(entry);
  }
  t.timeline.sort((a, b) => a.date.localeCompare(b.date) || a.added_at.localeCompare(b.added_at));
  return true;
}

function reopenIfRecent(t: FullIncident, articleDate: string, now: string): boolean {
  if (t.state !== "closed") return false;
  if (!shouldReopen(t, articleDate, today(now))) return false;
  t.state = "live";
  t.closed_at = null;
  return true;
}

/** The entry written when no model is available: the report's own title. */
export function fallbackEntry(c: Candidate, now: string): TimelineEntry {
  return { date: c.published_at, title: truncate(c.title, 200), source_url: c.url, added_at: now };
}

function patchStatusFromKev(requiredAction: unknown): PatchStatus {
  const text = typeof requiredAction === "string" ? requiredAction : "";
  if (/apply (updates|patches)/i.test(text)) return "patched";
  if (/mitigation/i.test(text)) return "partial";
  return "unknown";
}

/** Fix status never moves backwards from patched; unknown never overwrites knowledge. */
function raisePatchStatus(current: PatchStatus, next: PatchStatus): PatchStatus {
  if (next === "unknown") return current;
  if (current === "patched" && next !== "patched") return current;
  return next;
}

interface AdvisoryVersion {
  package?: unknown;
  range?: unknown;
  first_patched?: unknown;
}

/**
 * Updates that need no model. Returns null when the candidate is not a
 * structured source. KEV: exploitation confirmed, so severity at least 3, the
 * record leaves the research lane, the fix status follows the required
 * action, and the record is live again when the listing is recent. GHSA:
 * version data and a score when the record has none. NVD: a score.
 */
export function structuredUpdate(t: FullIncident, c: Candidate, now: string): { applied: boolean; reopened: boolean; entry: boolean } | null {
  const extra = c.extra ?? {};
  if (extra["kev"] === true) {
    let changed = false;
    if (t.severity < 3) {
      t.severity = 3;
      changed = true;
    }
    if (t.lane === "research") {
      t.lane = "patch";
      changed = true;
    }
    if (t.lane === "patch" || t.lane === "supply_chain") {
      const next = raisePatchStatus(t.patch_status, patchStatusFromKev(extra["required_action"]));
      if (next !== t.patch_status) {
        t.patch_status = next;
        changed = true;
      }
    }
    if (!t.tags.includes(KEV_TAG) && t.tags.length < 20) {
      t.tags.push(KEV_TAG);
      changed = true;
    }
    const added = pushEntry(t, { date: c.published_at, title: "Added to the CISA KEV catalog (exploitation confirmed)", source_url: c.url, added_at: now });
    const reopened = reopenIfRecent(t, c.published_at, now);
    return { applied: changed || added || reopened, reopened, entry: added };
  }
  if (c.origin === "seed_ghsa") {
    let changed = false;
    const list = Array.isArray(extra["vulnerabilities"]) ? (extra["vulnerabilities"] as AdvisoryVersion[]) : [];
    const affected: string[] = [];
    const fixed: string[] = [];
    for (const v of list) {
      const pkg = typeof v.package === "string" && v.package ? v.package : null;
      if (!pkg) continue;
      if (typeof v.range === "string" && v.range) affected.push(`${pkg} ${v.range}`);
      if (typeof v.first_patched === "string" && v.first_patched) fixed.push(`${pkg} ${v.first_patched}`);
    }
    if (t.affected.length === 0 && affected.length) {
      t.affected = cleanVersionList(affected);
      changed = true;
    }
    if (t.fixed_in.length === 0 && fixed.length) {
      t.fixed_in = cleanVersionList(fixed);
      changed = true;
    }
    if ((t.lane === "patch" || t.lane === "supply_chain") && t.patch_status === "unknown" && list.length) {
      t.patch_status = fixed.length ? "patched" : "unpatched";
      changed = true;
    }
    if (t.cvss === null && typeof extra["cvss"] === "number") {
      t.cvss = extra["cvss"];
      changed = true;
    }
    const added = pushEntry(t, { date: c.published_at, title: "GitHub advisory published", source_url: c.url, added_at: now });
    const reopened = reopenIfRecent(t, c.published_at, now);
    return { applied: changed || added || reopened, reopened, entry: added };
  }
  if (c.origin === "seed_nvd") {
    let changed = false;
    if (t.cvss === null && typeof extra["cvss"] === "number") {
      t.cvss = extra["cvss"];
      changed = true;
    }
    const added = pushEntry(t, { date: c.published_at, title: "NVD record published", source_url: c.url, added_at: now });
    const reopened = reopenIfRecent(t, c.published_at, now);
    return { applied: changed || added || reopened, reopened, entry: added };
  }
  return null;
}

/** Applies one model answer to a record. */
export function applyModelUpdate(t: FullIncident, c: Candidate, r: UpdateResult, now: string): { applied: boolean; reopened: boolean; entry: boolean } {
  let changed = false;
  let entry = false;
  if (r.add_entry) {
    const title = cleanLlmText(r.entry, 200);
    if (title && pushEntry(t, { date: c.published_at, title, source_url: c.url, added_at: now })) {
      changed = true;
      entry = true;
    }
  }
  if (r.patch_status !== "keep" && (t.lane === "patch" || t.lane === "supply_chain")) {
    const next = raisePatchStatus(t.patch_status, r.patch_status);
    if (next !== t.patch_status) {
      t.patch_status = next;
      changed = true;
    }
  }
  const fixed = cleanVersionList(r.fixed_in);
  if (fixed.length) {
    const union = cleanVersionList([...t.fixed_in, ...fixed]);
    if (union.length !== t.fixed_in.length) {
      t.fixed_in = union;
      changed = true;
    }
  }
  const action = cleanLlmText(r.action, 300);
  if (action && action !== t.action) {
    t.action = action;
    changed = true;
  }
  const reopened = reopenIfRecent(t, c.published_at, now);
  return { applied: changed || reopened, reopened, entry };
}

/** Writes a complete record back into the state object, or restores the snapshot when it does not validate. */
function persist(target: Incident, draft: FullIncident, snapshot: Incident, now: string, errors: string[]): boolean {
  draft.updated_at = now;
  const check = IncidentSchema.safeParse(draft);
  if (!check.success) {
    errors.push(`update ${target.id} rolled back: ${check.error.issues[0]?.path.join(".")}: ${check.error.issues[0]?.message}`);
    for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k];
    Object.assign(target, snapshot);
    return false;
  }
  Object.assign(target, check.data);
  return true;
}

/**
 * Runs the update pass over the merges of this run that added a source,
 * grouped by target so a record with several new reports is updated once per
 * report in order.
 */
export async function applyUpdates(merges: Merge[], router: LlmRouter | null, settings: Settings, now: string): Promise<UpdateOutcome> {
  const out: UpdateOutcome = { updated: 0, reopened: 0, entries: 0, structured: 0, byModel: 0, fallback: 0, errors: [] };
  const day = today(now);
  const touched = new Set<Incident>();
  const needModel: { target: Incident; candidate: Candidate }[] = [];

  // Structured sources first: no model, and their facts (KEV) should not wait behind a batch.
  for (const m of merges) {
    const snapshot = structuredClone(m.target);
    const draft = withLifecycle(m.target, day);
    const res = structuredUpdate(draft, m.candidate, now);
    if (res === null) {
      needModel.push({ target: m.target, candidate: m.candidate });
      continue;
    }
    if (!res.applied) continue;
    if (persist(m.target, draft, snapshot, now, out.errors)) {
      out.structured += 1;
      if (res.entry) out.entries += 1;
      if (res.reopened) out.reopened += 1;
      touched.add(m.target);
      log.info(`updated ${m.target.id} from ${m.candidate.publisher}`, { how: "structured", reopened: res.reopened });
    }
  }

  const applyFallback = (target: Incident, c: Candidate) => {
    const snapshot = structuredClone(target);
    const draft = withLifecycle(target, day);
    const added = pushEntry(draft, fallbackEntry(c, now));
    const reopened = reopenIfRecent(draft, c.published_at, now);
    if (!added && !reopened) return;
    if (persist(target, draft, snapshot, now, out.errors)) {
      out.fallback += 1;
      if (added) out.entries += 1;
      if (reopened) out.reopened += 1;
      touched.add(target);
      log.info(`updated ${target.id} from ${c.publisher}`, { how: "fallback", reopened });
    }
  };

  const batchSize = Math.max(1, settings.update.batch_size);
  for (let i = 0; i < needModel.length; i += batchSize) {
    const batch = needModel.slice(i, i + batchSize);
    if (!router || !router.available) {
      for (const b of batch) applyFallback(b.target, b.candidate);
      continue;
    }
    const items: UpdateItem[] = batch.map((b, idx) => ({ index: idx, target: withLifecycle(b.target, day), candidate: b.candidate }));
    const prompt = updatePrompt(items);
    let results: Map<number, UpdateResult> | null = null;
    try {
      const { parsed } = await router.completeJson({ system: prompt.system, user: prompt.user, schemaName: "update_batch", jsonSchema: UPDATE_JSON_SCHEMA });
      const check = UpdateBatchSchema.safeParse(parsed);
      if (!check.success) throw new Error(`invalid update response: ${check.error.issues[0]?.message}`);
      results = new Map();
      for (const r of check.data.results) if (!results.has(r.index)) results.set(r.index, r);
    } catch (err) {
      out.errors.push(`update: ${errorMessage(err).slice(0, 200)}`);
      if (!(err instanceof NoProviderAvailable)) log.warn("update pass: model answer unusable, writing the reports' titles", { error: errorMessage(err).slice(0, 120) });
    }
    batch.forEach((b, idx) => {
      const r = results?.get(idx);
      if (!r) {
        applyFallback(b.target, b.candidate);
        return;
      }
      const snapshot = structuredClone(b.target);
      const draft = withLifecycle(b.target, day);
      const res = applyModelUpdate(draft, b.candidate, r, now);
      if (!res.applied) return;
      if (persist(b.target, draft, snapshot, now, out.errors)) {
        out.byModel += 1;
        if (res.entry) out.entries += 1;
        if (res.reopened) out.reopened += 1;
        touched.add(b.target);
        log.info(`updated ${b.target.id} from ${b.candidate.publisher}`, { how: "model", entry: r.add_entry ? r.entry.slice(0, 80) : "(none)", patch_status: r.patch_status, reopened: res.reopened });
      }
    });
  }
  out.updated = touched.size;
  return out;
}
