import pLimit from "p-limit";
import { IncidentSchema, type Incident, type RunRecord } from "../../lib/schema";
import { loadConfig, type SourceConfig } from "../lib/config";
import { HttpError } from "../lib/http";
import { addDays, makeIdAllocator, nowIso, uniqueSlug } from "../lib/ids";
import { errorMessage, log } from "../lib/log";
import { allIds, allSlugs, loadState, saveState, type RejectedRecord, type State } from "../lib/state";
import { callsToday, LlmRouter } from "../llm/router";
import { ADAPTERS } from "../sources/index";
import type { Candidate, SourceContext } from "../sources/types";
import { classifyClusters, resolveSameIncident, type ClassifiedCluster } from "./classify";
import {
  buildEntityIndex,
  clusterCandidates,
  dedupe,
  pairwiseClusterChecks,
  productPairChecks,
  productRecordChecks,
  type Cluster,
  type Merge,
  type ProductSubject,
} from "./dedupe";
import { decide } from "./decide";
import { enrichHints } from "./enrich";
import { prefilter } from "./prefilter";
import { buildIncident, mergeSource } from "./publish";

export interface RunOptions {
  mode: RunRecord["mode"];
  dryRun: boolean;
  /** Restrict to these source ids (ignores schedules). */
  sourceIds?: string[];
  limit?: number;
  since?: string;
  enrich: boolean;
}

export interface RunSummary {
  record: RunRecord;
  changedFiles: string[];
  published: Incident[];
  review: Incident[];
  rejected: RejectedRecord[];
  merged: Merge[];
  pendingCount: number;
}

/** Hours since the last success before a scheduled source is read again (a little under the nominal period so an hourly cron hits it). */
export const DUE_HOURS: Record<SourceConfig["schedule"], number> = { every_run: 0, six_hourly: 5.5, daily: 20, weekly: 6 * 24, monthly: 27 * 24 };

function lastSuccessBySource(state: State): Map<string, string> {
  const out = new Map<string, string>();
  for (const run of state.runs) {
    if (run.mode === "dry-run") continue;
    for (const s of run.sources) if (s.ok && (!out.has(s.id) || out.get(s.id)! < run.finished_at)) out.set(s.id, run.finished_at);
  }
  return out;
}

export function isDue(src: Pick<SourceConfig, "schedule">, last: string | undefined, now: Date): boolean {
  const hours = DUE_HOURS[src.schedule];
  if (!hours || !last) return true;
  return now.getTime() - Date.parse(last) >= hours * 3600 * 1000;
}

/** Collapses duplicates by key, keeping the richer hint. */
function uniqueByKey(cands: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const c of cands) {
    const prev = map.get(c.key);
    if (!prev || c.hint.length > prev.hint.length) map.set(c.key, prev ? { ...c, discovered_at: prev.discovered_at } : c);
  }
  return [...map.values()];
}

function subjectOf(c: ClassifiedCluster): ProductSubject {
  const r = c.result;
  return { cluster: c.cluster, title: r.title, summary: r.summary, products: r.products, lane: r.lane, incident_date: r.incident_date };
}

export async function runCollector(opts: RunOptions): Promise<RunSummary> {
  const config = loadConfig();
  const { settings } = config;
  const state = await loadState();
  const now = new Date();
  const startedAt = now.toISOString();
  const runId = `run-${startedAt.replace(/[-:.]/g, "").slice(0, 15)}`;
  const sourcesById = new Map(config.sources.map((s) => [s.id, s]));
  const lastSuccess = lastSuccessBySource(state);
  const record: RunRecord = {
    id: runId,
    started_at: startedAt,
    finished_at: startedAt,
    mode: opts.mode,
    sources: [],
    counts: { fetched: 0, prefiltered: 0, merged: 0, classified: 0, published: 0, review: 0, rejected: 0, pending: 0 },
    llm: { calls: 0, prompt_tokens: 0, completion_tokens: 0, by_model: {} },
    errors: [],
  };

  // 1. Fetch
  const selected = config.sources.filter((s) => (opts.sourceIds ? opts.sourceIds.includes(s.id) : s.enabled));
  const fetched: Candidate[] = [];
  const limit = pLimit(4);
  await Promise.all(
    selected.map((src) =>
      limit(async () => {
        const adapter = ADAPTERS[src.kind];
        if (!adapter) {
          log.warn(`no adapter for kind "${src.kind}" (${src.id}); skipping`);
          return;
        }
        if (!opts.sourceIds && !opts.since && !isDue(src, lastSuccess.get(src.id), now)) {
          log.debug("not due", { source: src.id, schedule: src.schedule });
          return;
        }
        const ctx: SourceContext = {
          config,
          settings,
          now,
          lastSuccessAt: lastSuccess.get(src.id) ?? null,
          since: opts.since,
          limit: opts.limit,
          seenKeys: new Set(Object.keys(state.seen)),
        };
        const t0 = Date.now();
        try {
          const items = await adapter.fetch(src, ctx);
          fetched.push(...items);
          record.sources.push({ id: src.id, ok: true, items: items.length, duration_ms: Date.now() - t0 });
          log.info(`${src.id}: ${items.length} candidates`);
        } catch (err) {
          record.sources.push({
            id: src.id,
            ok: false,
            items: 0,
            status: err instanceof HttpError ? err.status : undefined,
            error: errorMessage(err).slice(0, 300),
            duration_ms: Date.now() - t0,
          });
          record.errors.push(`${src.id}: ${errorMessage(err).slice(0, 300)}`);
          log.error(`${src.id} failed`, { error: errorMessage(err) });
        }
      }),
    ),
  );
  record.counts.fetched = fetched.length;

  // 2. Pre-filter (pending candidates from earlier runs go first)
  const all = uniqueByKey([...state.pending, ...fetched]);
  const pf = prefilter(all, config, sourcesById);
  record.counts.prefiltered = pf.kept.length;
  log.info(`prefilter: kept ${pf.kept.length} of ${all.length}`, { dropped: pf.dropped.length });
  for (const d of pf.dropped.slice(0, 20)) log.debug("dropped", { reason: d.reason, title: d.candidate.title });

  // 3. Deterministic dedupe, with the shared-entity trigger (rarity over records and this run's candidates)
  const entityIndex = buildEntityIndex([...state.incidents, ...state.review], pf.kept);
  const dd = dedupe(pf.kept, state, settings, entityIndex);
  const viaEntity = dd.llmChecks.filter((c) => c.matches.every((m) => m.via === "entity")).length;
  log.info(`dedupe: ${dd.merges.length} merges, ${dd.llmChecks.length} LLM checks (${viaEntity} by shared entity), ${dd.fresh.length} fresh, ${dd.skipped.length} skipped`);
  for (const c of dd.llmChecks) log.debug("same-incident check", { title: c.candidate.title, matches: c.matches.map((m) => `${m.ref.id} ${m.via} ${m.similarity.toFixed(2)}`) });

  // 4. Hints: only for candidates that still need the LLM (fresh + same-incident checks).
  // Runs after dedupe so already-seen or deterministically merged links are not re-fetched every run.
  const toEnrich = [...dd.fresh, ...dd.llmChecks.map((c) => c.candidate)];
  if (opts.enrich && toEnrich.length) {
    const n = await enrichHints(toEnrich, settings);
    log.info(`enriched ${n} hints from page metadata`);
  }

  // 5. LLM router
  const router = new LlmRouter(settings.providers, callsToday(state.runs, settings.providers, now));
  for (const line of router.describe()) log.info(`llm: ${line}`);

  // 6. Same-incident checks
  const same = await resolveSameIncident(dd.llmChecks, router);
  record.errors.push(...same.errors);
  const merges: Merge[] = [...dd.merges];
  const fresh: Candidate[] = [...dd.fresh];
  for (const check of dd.llmChecks) {
    const decision = same.decisions.get(check.candidate.key);
    if (decision === undefined) continue; // unresolved → pending below
    const m = decision ? check.matches.find((x) => x.ref.id === decision) : undefined;
    if (m?.incident && m.pool) {
      merges.push({ candidate: check.candidate, target: m.incident, pool: m.pool, how: m.via === "entity" ? "entity" : "llm", similarity: m.similarity });
    } else {
      fresh.push(check.candidate);
    }
  }

  // 7. Apply merges. The ones that added a source (not a re-seen link) feed the update pass.
  const stamp = nowIso();
  const addedMerges: Merge[] = [];
  const applyMerge = (m: Merge) => {
    const added = mergeSource(m.target, m.candidate, stamp);
    state.seen[m.candidate.key] = { status: "merged", id: m.target.id, at: stamp };
    if (added) {
      if (m.how !== "seen") addedMerges.push(m);
      log.info(`merged into ${m.target.id} (${m.how})`, { title: m.candidate.title, publisher: m.candidate.publisher });
    }
  };
  for (const m of merges) applyMerge(m);

  // 8. Cluster (strict), then let the LLM settle same-run near-duplicates and shared entities
  const strict = clusterCandidates(fresh, settings);
  const pairChecks = pairwiseClusterChecks(strict, settings, entityIndex);
  const pairDecisions = await resolveSameIncident([...pairChecks.values()], router);
  record.errors.push(...pairDecisions.errors);
  const unresolvedKeys = new Set(pairDecisions.unresolved.map((c) => c.candidate.key));
  const owner = strict.map((_, i) => i); // cluster index → index of the cluster it was merged into
  const held = new Set<number>(); // same-run checks the LLM could not answer: wait for the next run
  const heldForNextRun: Cluster[] = [];
  strict.forEach((cl, i) => {
    const check = pairChecks.get(i);
    if (!check) return;
    if (unresolvedKeys.has(cl.primary.key)) {
      held.add(i);
      heldForNextRun.push(cl);
      return;
    }
    const decision = pairDecisions.decisions.get(cl.primary.key);
    const match = decision ? check.matches.find((m) => m.ref.id === decision) : undefined;
    if (match?.clusterIndex === undefined) return;
    let t = match.clusterIndex;
    while (owner[t] !== t) t = owner[t]!;
    if (held.has(t)) {
      held.add(i);
      heldForNextRun.push(cl);
      return;
    }
    strict[t]!.members.push(...cl.members);
    owner[i] = t;
    log.info(`same-run merge into "${strict[t]!.primary.title}" (${match.via})`, { title: cl.primary.title });
  });
  const settled = strict.filter((_, i) => owner[i] === i && !held.has(i));
  // The fuse: at most classify.max_per_run clusters per run (oldest first, so pending items never starve); the rest wait.
  const clusters = settled.slice(0, settings.classify.max_per_run);
  if (settled.length > clusters.length) log.warn(`classification fuse: ${settled.length - clusters.length} cluster(s) wait for the next run (max_per_run ${settings.classify.max_per_run})`);
  heldForNextRun.push(...settled.slice(clusters.length));
  const cls = await classifyClusters(clusters, router);
  cls.pending.push(...heldForNextRun);
  record.errors.push(...cls.errors);
  record.counts.classified = cls.classified.length;
  for (const { cluster, result } of cls.classified) {
    log.debug("classified", { title: result.title, type: result.type, lane: result.lane, severity: result.severity, newsworthy: result.newsworthy, why: result.newsworthy_reason, conf: result.confidence, sources: cluster.members.length });
  }

  // 8b. Product pass: now that the model has named products, clusters of this run that name the same product
  // (Cairn's three outlets) are checked against each other, then every cluster against recent records (LiteLLM's follow-ups).
  const subjects = cls.classified.map(subjectOf);
  const productPairs = productPairChecks(subjects, settings);
  const productPairDecisions = await resolveSameIncident([...productPairs.values()], router);
  record.errors.push(...productPairDecisions.errors);
  const productUnresolved = new Set(productPairDecisions.unresolved.map((c) => c.candidate.key));
  const pOwner = subjects.map((_, i) => i);
  const pHeld = new Set<number>();
  subjects.forEach((s, i) => {
    const check = productPairs.get(i);
    if (!check) return;
    if (productUnresolved.has(check.candidate.key)) {
      pHeld.add(i);
      return;
    }
    const decision = productPairDecisions.decisions.get(check.candidate.key);
    const match = decision ? check.matches.find((m) => m.ref.id === decision) : undefined;
    if (match?.clusterIndex === undefined) return;
    let t = match.clusterIndex;
    while (pOwner[t] !== t) t = pOwner[t]!;
    if (pHeld.has(t)) {
      pHeld.add(i);
      return;
    }
    subjects[t]!.cluster.members.push(...s.cluster.members);
    pOwner[i] = t;
    log.info(`product merge into "${subjects[t]!.title}"`, { title: s.title, products: s.products });
  });
  let classified = cls.classified.filter((_, i) => pOwner[i] === i && !pHeld.has(i));
  for (const [i, c] of cls.classified.entries()) if (pHeld.has(i)) cls.pending.push(c.cluster);

  const recordChecks = productRecordChecks(classified.map(subjectOf), state, settings);
  const recordDecisions = await resolveSameIncident(
    recordChecks.map((c) => c.check),
    router,
  );
  record.errors.push(...recordDecisions.errors);
  const recordUnresolved = new Set(recordDecisions.unresolved.map((c) => c.candidate.key));
  const settledByProduct = new Set<Cluster>();
  for (const { subject, check } of recordChecks) {
    const key = check.candidate.key;
    if (recordUnresolved.has(key)) {
      cls.pending.push(subject.cluster);
      settledByProduct.add(subject.cluster);
      continue;
    }
    const decision = recordDecisions.decisions.get(key);
    const m = decision ? check.matches.find((x) => x.ref.id === decision) : undefined;
    if (!m?.incident || !m.pool) continue;
    for (const member of subject.cluster.members) {
      const merge: Merge = { candidate: member, target: m.incident, pool: m.pool, how: "product", similarity: m.similarity };
      merges.push(merge);
      applyMerge(merge);
    }
    settledByProduct.add(subject.cluster);
  }
  classified = classified.filter((c) => !settledByProduct.has(c.cluster));
  record.counts.merged = merges.length;
  if (productPairs.size || recordChecks.length) {
    log.info(`product pass: ${productPairs.size} same-run check(s), ${recordChecks.length} record check(s), ${settledByProduct.size - [...recordUnresolved].length} merged into records`);
  }

  // 9. Decide + build
  const allocate = makeIdAllocator(allIds(state));
  const slugs = allSlugs(state);
  const published: Incident[] = [];
  const review: Incident[] = [];
  const rejected: RejectedRecord[] = [];
  for (const { cluster, result } of classified) {
    const { status, reason } = decide(result, settings);
    if (status === "rejected") {
      for (const m of cluster.members) {
        rejected.push({
          key: m.key,
          title: m.title,
          url: m.url,
          publisher: m.publisher,
          source_id: m.source_id,
          reason,
          confidence: result.confidence,
          rejected_at: stamp,
        });
        state.seen[m.key] = { status: "rejected", at: stamp };
      }
      log.info(`rejected: ${cluster.primary.title}`, { reason: reason.slice(0, 120) });
      continue;
    }
    const year = Number(cluster.members.map((m) => m.published_at).sort()[0]!.slice(0, 4));
    const id = allocate(year);
    const slug = uniqueSlug(result.title, slugs, id);
    slugs.add(slug);
    const incident = buildIncident(cluster, result, status, id, slug, stamp);
    const valid = IncidentSchema.safeParse(incident);
    if (!valid.success) {
      record.errors.push(`${id} failed schema validation: ${valid.error.issues[0]?.message}`);
      cls.pending.push(cluster);
      continue;
    }
    (status === "published" ? published : review).push(valid.data);
    for (const m of cluster.members) state.seen[m.key] = { status, id, at: stamp };
    log.info(`${status}: ${incident.title}`, { id, lane: incident.lane, type: incident.type, severity: incident.severity, sources: incident.source_count, conf: incident.confidence });
  }
  state.incidents.push(...published);
  state.review.push(...review);
  state.rejected.push(...rejected);
  record.counts.published = published.length;
  record.counts.review = review.length;
  record.counts.rejected = rejected.length;

  // 10. Pending: unresolved same-incident checks + unclassified clusters
  const pending = uniqueByKey([...same.unresolved.map((c) => c.candidate), ...cls.pending.flatMap((cl) => cl.members)]);
  state.pending = pending;
  record.counts.pending = pending.length;
  if (pending.length) log.warn(`${pending.length} candidate(s) left pending for the next run`);

  // 11. Retention
  const cutoff = addDays(stamp.slice(0, 10), -settings.retention.rejected_days);
  state.rejected = state.rejected.filter((r) => r.rejected_at.slice(0, 10) >= cutoff);

  // 12. Run record
  record.finished_at = nowIso();
  record.llm.by_model = router.usage;
  for (const u of Object.values(router.usage)) {
    record.llm.calls += u.calls;
    record.llm.prompt_tokens += u.prompt_tokens;
    record.llm.completion_tokens += u.completion_tokens;
  }
  state.runs.push(record);
  if (state.runs.length > settings.retention.runs_keep) state.runs = state.runs.slice(-settings.retention.runs_keep);

  let changedFiles: string[] = [];
  if (!opts.dryRun) {
    changedFiles = await saveState(state);
    log.info(`saved ${changedFiles.length ? changedFiles.join(", ") : "nothing (no changes)"}`);
  } else {
    log.info("dry run: nothing written");
  }
  void addedMerges; // consumed by the update pass (B4)
  return { record, changedFiles, published, review, rejected, merged: merges, pendingCount: pending.length };
}
