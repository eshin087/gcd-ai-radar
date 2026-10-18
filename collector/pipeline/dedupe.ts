import type { Incident } from "../../lib/schema";
import type { Settings } from "../lib/config";
import { daysBetween } from "../lib/ids";
import type { State } from "../lib/state";
import { advisoryCves, extractCves, titleSimilarity } from "../lib/text";
import type { Candidate } from "../sources/types";

/**
 * Deduplication, deterministic part. One real-world incident covered by many
 * articles must end up as one incident with many sources:
 *
 *   1. canonical URL already seen            → skip (or merge if it maps to an incident)
 *   2. shared CVE id with an existing record → merge (ids the record is
 *      about, see cvesOfIncident; an id it merely cites does not count)
 *   3. title similarity vs. recent records   → merge (≥ merge_similarity),
 *                                              ask the LLM (≥ llm_check_similarity), or new
 *   4. remaining candidates clustered among themselves the same way; middling
 *      pairs inside the run are also sent to the LLM
 *
 * Records that both carry CVE ids but share none are never the same incident.
 * The LLM "same incident?" decisions are applied afterwards by the run.
 */

export type Pool = "incidents" | "review";

/** Minimal description of a possible match, for the LLM prompt. */
export interface MatchRef {
  id: string;
  first_reported: string;
  title: string;
  summary: string;
}

export interface Merge {
  candidate: Candidate;
  target: Incident;
  pool: Pool;
  how: "seen" | "cve" | "title" | "llm";
  similarity?: number;
}

export interface LlmMatch {
  ref: MatchRef;
  similarity: number;
  incident?: Incident;
  pool?: Pool;
  /** For same-run checks: index of the earlier cluster. */
  clusterIndex?: number;
}

export interface LlmCheck {
  candidate: Candidate;
  matches: LlmMatch[];
}

export interface Cluster {
  primary: Candidate;
  members: Candidate[];
}

export interface DedupeResult {
  merges: Merge[];
  llmChecks: LlmCheck[];
  fresh: Candidate[];
  skipped: { candidate: Candidate; reason: string }[];
}

interface Indexed {
  incident: Incident;
  pool: Pool;
  titles: string[];
  cves: Set<string>;
}

/**
 * The CVE ids an incident is about, not every id its sources mention. An
 * advisory source (NVD, GHSA, KEV) counts only for its own id: a GHSA title
 * such as "CVE-2026-54008: … (incomplete-fix sibling of CVE-2026-45401)"
 * cites 45401 but is not about it. Other sources count for the ids in their
 * headlines. The title and tags come from the classifier, whose titles repeat
 * cited ids (AIR-2025-0393) and have carried a neighbouring item's id
 * (AIR-2025-0367), and merges add the merged record's ids to tags, so they
 * count only for records with no advisory source (news, where tags keep ids
 * read from the article text).
 */
export function cvesOfIncident(inc: Incident): Set<string> {
  const set = new Set<string>();
  let advisory = false;
  for (const s of inc.sources) {
    const own = advisoryCves(s);
    if (own) {
      advisory = true;
      for (const c of own) set.add(c);
    } else {
      for (const c of extractCves(s.title)) set.add(c);
    }
  }
  if (!advisory) {
    for (const t of inc.tags) for (const c of extractCves(t)) set.add(c);
    for (const c of extractCves(inc.title)) set.add(c);
  }
  return set;
}

function cveConflict(a: Iterable<string>, b: Iterable<string>): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return false;
  for (const x of sa) if (sb.has(x)) return false;
  return true;
}

function indexState(state: State): Indexed[] {
  const out: Indexed[] = [];
  for (const [pool, list] of [["incidents", state.incidents], ["review", state.review]] as [Pool, Incident[]][]) {
    for (const incident of list) {
      out.push({
        incident,
        pool,
        titles: [incident.title, ...incident.sources.map((s) => s.title)],
        cves: cvesOfIncident(incident),
      });
    }
  }
  return out;
}

function bestSimilarity(title: string, titles: string[]): number {
  let best = 0;
  for (const t of titles) {
    const s = titleSimilarity(title, t);
    if (s > best) best = s;
    if (best >= 0.999) break;
  }
  return best;
}

export function refOf(inc: Incident): MatchRef {
  return { id: inc.id, first_reported: inc.first_reported, title: inc.title, summary: inc.summary };
}

export function dedupe(candidates: Candidate[], state: State, settings: Settings): DedupeResult {
  const { lookback_days, merge_similarity, llm_check_similarity } = settings.dedupe;
  const index = indexState(state);
  const byId = new Map<string, Indexed>(index.map((i) => [i.incident.id, i]));
  const result: DedupeResult = { merges: [], llmChecks: [], fresh: [], skipped: [] };

  for (const c of candidates) {
    // 1. seen before
    const seen = state.seen[c.key];
    if (seen) {
      if (seen.status !== "rejected" && seen.id && byId.has(seen.id)) {
        const target = byId.get(seen.id)!;
        if (!target.incident.sources.some((s) => s.url === c.url)) {
          result.merges.push({ candidate: c, target: target.incident, pool: target.pool, how: "seen" });
        } else {
          result.skipped.push({ candidate: c, reason: `already a source of ${seen.id}` });
        }
      } else {
        result.skipped.push({ candidate: c, reason: `seen: ${seen.status}` });
      }
      continue;
    }

    // 2. shared CVE id
    if (c.cve_ids.length) {
      const hit = index.find((i) => c.cve_ids.some((cve) => i.cves.has(cve)));
      if (hit) {
        result.merges.push({ candidate: c, target: hit.incident, pool: hit.pool, how: "cve" });
        continue;
      }
    }

    // 3. title similarity against records in the date window
    const scored: { idx: Indexed; sim: number }[] = [];
    for (const idx of index) {
      if (daysBetween(idx.incident.first_reported, c.published_at) > lookback_days) continue;
      if (cveConflict(c.cve_ids, idx.cves)) continue;
      const sim = bestSimilarity(c.title, idx.titles);
      if (sim >= llm_check_similarity) scored.push({ idx, sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    const top = scored[0];
    if (top && top.sim >= merge_similarity) {
      result.merges.push({ candidate: c, target: top.idx.incident, pool: top.idx.pool, how: "title", similarity: top.sim });
    } else if (top) {
      result.llmChecks.push({
        candidate: c,
        matches: scored.slice(0, 3).map((s) => ({ ref: refOf(s.idx.incident), similarity: s.sim, incident: s.idx.incident, pool: s.idx.pool })),
      });
    } else {
      result.fresh.push(c);
    }
  }
  return result;
}

/** Groups fresh candidates that clearly describe the same event (first member is primary). */
export function clusterCandidates(candidates: Candidate[], settings: Settings): Cluster[] {
  const { merge_similarity, date_window_days } = settings.dedupe;
  const clusters: Cluster[] = [];
  const ordered = [...candidates].sort((a, b) => a.published_at.localeCompare(b.published_at) || b.hint.length - a.hint.length);
  for (const c of ordered) {
    let joined = false;
    for (const cl of clusters) {
      const clusterCves = cl.members.flatMap((m) => m.cve_ids);
      const sharesCve = c.cve_ids.length > 0 && clusterCves.some((x) => c.cve_ids.includes(x));
      if (!sharesCve && cveConflict(c.cve_ids, clusterCves)) continue;
      const inWindow = daysBetween(cl.primary.published_at, c.published_at) <= date_window_days;
      const sim = inWindow ? Math.max(...cl.members.map((m) => titleSimilarity(c.title, m.title))) : 0;
      if (sharesCve || sim >= merge_similarity) {
        cl.members.push(c);
        joined = true;
        break;
      }
    }
    if (!joined) clusters.push({ primary: c, members: [c] });
  }
  return clusters;
}

export function clusterRef(cl: Cluster, index: number): MatchRef {
  return { id: `NEW-${index}`, first_reported: cl.primary.published_at, title: cl.primary.title, summary: cl.primary.hint || "(no description)" };
}

/** Same-run pairs that are similar but not clearly the same: ask the LLM before creating two incidents. */
export function pairwiseClusterChecks(clusters: Cluster[], settings: Settings): Map<number, LlmCheck> {
  const { merge_similarity, llm_check_similarity, date_window_days } = settings.dedupe;
  const checks = new Map<number, LlmCheck>();
  clusters.forEach((cl, i) => {
    const matches: LlmMatch[] = [];
    for (let j = 0; j < i; j++) {
      const other = clusters[j]!;
      if (daysBetween(other.primary.published_at, cl.primary.published_at) > date_window_days) continue;
      const cves = cl.members.flatMap((m) => m.cve_ids);
      if (cveConflict(cves, other.members.flatMap((m) => m.cve_ids))) continue;
      const sim = Math.max(...other.members.map((m) => titleSimilarity(cl.primary.title, m.title)));
      if (sim >= llm_check_similarity && sim < merge_similarity) matches.push({ ref: clusterRef(other, j), similarity: sim, clusterIndex: j });
    }
    if (matches.length) {
      matches.sort((a, b) => b.similarity - a.similarity);
      checks.set(i, { candidate: cl.primary, matches: matches.slice(0, 3) });
    }
  });
  return checks;
}
