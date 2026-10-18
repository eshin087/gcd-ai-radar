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
import { classifyClusters, resolveSameIncident } from "./classify";
import { clusterCandidates, dedupe, pairwiseClusterChecks, type Cluster, type Merge } from "./dedupe";
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

const DUE_HOURS: Record<SourceConfig["schedule"], number> = { every_run: 0, daily: 20, weekly: 6 * 24, monthly: 27 * 24 };

function lastSuccessBySource(state: State): Map<string, string> {
  const out = new Map<string, string>();
  for (const run of state.runs) {
    if (run.mode === "dry-run") continue;
    for (const s of run.sources) if (s.ok && (!out.has(s.id) || out.get(s.id)! < run.finished_at)) out.set(s.id, run.finished_at);
  }
  return out;
}

function isDue(src: SourceConfig, last: string | undefined, now: Date): boolean {
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

  // 3. Hints
  if (opts.enrich && pf.kept.length) {
    const n = await enrichHints(pf.kept, settings);
    log.info(`enriched ${n} hints from page metadata`);
  }

  // 4. Deterministic dedupe
  const dd = dedupe(pf.kept, state, settings);
  log.info(`dedupe: ${dd.merges.length} merges, ${dd.llmChecks.length} LLM checks, ${dd.fresh.length} fresh, ${dd.skipped.length} skipped`);

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
      merges.push({ candidate: check.candidate, target: m.incident, pool: m.pool, how: "llm", similarity: m.similarity });
    } else {
      fresh.push(check.candidate);
    }
  }

  // 7. Apply merges
  const stamp = nowIso();
  for (const m of merges) {
    const added = mergeSource(m.target, m.candidate, stamp);
    state.seen[m.candidate.key] = { status: "merged", id: m.target.id, at: stamp };
    if (added) log.info(`merged into ${m.target.id} (${m.how})`, { title: m.candidate.title, publisher: m.candidate.publisher });
  }
  record.counts.merged = merges.length;

  // 8. Cluster (strict), then let the LLM settle same-run near-duplicates
  const strict = clusterCandidates(fresh, settings);
  const pairChecks = pairwiseClusterChecks(strict, settings);
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
    log.info(`same-run merge into "${strict[t]!.primary.title}"`, { title: cl.primary.title });
  });
  const clusters = strict.filter((_, i) => owner[i] === i && !held.has(i));
  const cls = await classifyClusters(clusters, router);
  cls.pending.push(...heldForNextRun);
  record.errors.push(...cls.errors);
  record.counts.classified = cls.classified.length;

  // 9. Decide + build
  const allocate = makeIdAllocator(allIds(state));
  const slugs = allSlugs(state);
  const published: Incident[] = [];
  const review: Incident[] = [];
  const rejected: RejectedRecord[] = [];
  for (const { cluster, result } of cls.classified) {
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
    log.info(`${status}: ${incident.title}`, { id, severity: incident.severity, sources: incident.source_count, conf: incident.confidence });
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
  return { record, changedFiles, published, review, rejected, merged: merges, pendingCount: pending.length };
}
