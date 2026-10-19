import type { Incident } from "./schema";
import { shardYear } from "./shard-year";

/**
 * Related incidents without the quadratic scan. The score is unchanged
 * (shared categories, targets and products, same type, close in time), but a
 * record can only reach the threshold of 2 by sharing a category, a product
 * or a target with the incident, so those are the buckets: every record is
 * filed under each of its categories, products and targets for its year of
 * first report, and an incident is scored only against the records in its
 * own buckets for that year and the years either side. The index is built
 * once per dataset and reused by every incident page in a build worker.
 *
 * Related incidents more than a year away in first report are the one thing
 * the buckets give up (tests/related.test.ts measures how often that shows).
 */

const DAY = 86400000;

export function relatedScore(incident: Incident, incidentTime: number, o: Incident): number {
  let score = 0;
  for (const c of o.categories) if (incident.categories.includes(c)) score += 2;
  for (const t of o.targets) if (incident.targets.includes(t) && t !== "n/a") score += 1;
  if (o.type === incident.type) score += 0.5;
  const days = Math.abs(Date.parse(`${o.first_reported}T00:00:00Z`) - incidentTime) / DAY;
  if (days <= 30) score += 1;
  else if (days <= 180) score += 0.5;
  for (const p of o.products) if (incident.products.includes(p)) score += 1.5;
  return score;
}

/** The minimum score a record needs to be listed. */
export const RELATED_MIN_SCORE = 2;

/** Years either side of an incident's first report that are scored. Measured 2026-10-18: 1 keeps 89% of lists identical to a full scan. */
export const RELATED_YEAR_WINDOW = 1;

function bucketKeys(i: Incident): string[] {
  const keys: string[] = [];
  for (const c of new Set(i.categories)) keys.push(`c:${c}`);
  for (const p of new Set(i.products)) keys.push(`p:${p}`);
  for (const t of new Set(i.targets)) if (t !== "n/a") keys.push(`t:${t}`);
  return keys;
}

export interface RelatedIndex {
  /** `${key}:${year}` -> records filed there. */
  buckets: Map<string, Incident[]>;
  /** The same buckets across every year, for incidents whose own years are too sparse to fill the list. */
  allYears: Map<string, Incident[]>;
}

export function buildRelatedIndex(all: readonly Incident[]): RelatedIndex {
  const buckets = new Map<string, Incident[]>();
  const allYears = new Map<string, Incident[]>();
  const file = (map: Map<string, Incident[]>, key: string, i: Incident) => {
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  };
  for (const i of all) {
    const year = shardYear(i);
    for (const k of bucketKeys(i)) {
      file(buckets, `${k}:${year}`, i);
      file(allYears, k, i);
    }
  }
  return { buckets, allYears };
}

/**
 * The records that share a bucket with the incident within a year either
 * side; never the incident itself. With `everyYear`, the same buckets over
 * the whole dataset.
 */
export function relatedCandidates(index: RelatedIndex, incident: Incident, everyYear = false): Incident[] {
  const year = shardYear(incident);
  const seen = new Set<string>([incident.id]);
  const out: Incident[] = [];
  const take = (list: Incident[] | undefined) => {
    for (const o of list ?? []) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      out.push(o);
    }
  };
  for (const k of bucketKeys(incident)) {
    if (everyYear) take(index.allYears.get(k));
    else for (let y = year - RELATED_YEAR_WINDOW; y <= year + RELATED_YEAR_WINDOW; y++) take(index.buckets.get(`${k}:${y}`));
  }
  return out;
}

/**
 * Ranks candidates by score, newest first among equals, then by id
 * descending: the dataset's own order (byReportedDesc in lib/shards.ts), so
 * the ranking never depends on the order the buckets hand candidates over.
 */
export function rankRelated(incident: Incident, candidates: readonly Incident[], limit: number): Incident[] {
  const time = Date.parse(`${incident.first_reported}T00:00:00Z`);
  return candidates
    .map((o) => ({ o, score: relatedScore(incident, time, o) }))
    .filter((x) => x.score >= RELATED_MIN_SCORE)
    .sort((a, b) => b.score - a.score || b.o.first_reported.localeCompare(a.o.first_reported) || b.o.id.localeCompare(a.o.id))
    .slice(0, limit)
    .map((x) => x.o);
}

/**
 * Related incidents: the year window first; when it cannot fill the list
 * (an incident from a sparse year), the same buckets across every year. The
 * dense years, where the cost matters, never take the second path.
 */
export function relatedFromIndex(index: RelatedIndex, incident: Incident, limit = 6): Incident[] {
  const near = rankRelated(incident, relatedCandidates(index, incident), limit);
  if (near.length >= limit) return near;
  return rankRelated(incident, relatedCandidates(index, incident, true), limit);
}
