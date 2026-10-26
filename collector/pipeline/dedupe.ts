import { daysBetween as approxDaysBetween, laneOf } from "../../lib/lifecycle";
import { productFamily } from "../../lib/products";
import type { Incident } from "../../lib/schema";
import type { Lane } from "../../lib/taxonomy";
import type { Settings } from "../lib/config";
import { daysBetween } from "../lib/ids";
import type { State } from "../lib/state";
import { advisoryCves, entityTokens, extractCves, titleSimilarity } from "../lib/text";
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
 *   3b. a shared rare title token (an entity: "cairn", "0940") with a record
 *       first reported in the last entity_window_days → ask the LLM
 *   4. remaining candidates clustered among themselves the same way; middling
 *      pairs and shared entities inside the run are also sent to the LLM
 *   5. after classification, a shared product with a record or another cluster
 *      of the run (incident dates within product_window_days) → ask the LLM
 *
 * Headlines about one event from different outlets share few words (0.16 to
 * 0.52 on titleSimilarity), which is why the entity and product triggers
 * exist. A false trigger costs one LLM call and never a merge: every merge
 * below the deterministic thresholds needs the model's answer at confidence
 * 0.6 or more (classify.ts resolveSameIncident). Records that both carry CVE
 * ids but share none are never the same incident.
 */

export type Pool = "incidents" | "review";

/** Minimal description of a possible match, for the LLM prompt. */
export interface MatchRef {
  id: string;
  first_reported: string;
  title: string;
  summary: string;
  products?: string[];
  lane?: Lane;
}

/** How a merge was decided: deterministic (seen, cve, title) or by the model after a title, entity or product trigger. */
export type MergeHow = "seen" | "cve" | "title" | "llm" | "entity" | "product";

export interface Merge {
  candidate: Candidate;
  target: Incident;
  pool: Pool;
  how: MergeHow;
  similarity?: number;
}

export type MatchVia = "title" | "entity" | "product";

export interface LlmMatch {
  ref: MatchRef;
  similarity: number;
  /** What put this match forward. */
  via: MatchVia;
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
  entities: Set<string>;
  productKeys: Set<string>;
}

/** Document frequency of entity tokens over records and this run's candidates. */
export type EntityIndex = Map<string, number>;

/**
 * The CVE ids an incident is about, not every id its sources mention. An
 * advisory source (NVD, GHSA, KEV) counts only for its own id: a GHSA title
 * such as "CVE-2026-54008: … (incomplete-fix sibling of CVE-2026-45401)"
 * cites 45401 but is not about it. Other sources count for the ids in their
 * headlines. The title and tags come from the classifier, whose titles repeat
 * cited ids (AIR-2025-0393) and have carried a neighbouring item's id
 * (AIR-2025-0367), and merges add the merged record's ids to tags, so they
 * count only for records with no advisory source (news, where tags keep ids
 * read from the article text). A breach-lane record is about an event, not a
 * flaw: an id in its title or tags is the flaw the intruders used, which the
 * patch-lane record of that CVE is about, so tags and titles never count there.
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
  if (!advisory && laneOf(inc) !== "breach") {
    for (const t of inc.tags) for (const c of extractCves(t)) set.add(c);
    for (const c of extractCves(inc.title)) set.add(c);
  }
  return set;
}

/** CVE ids that more than one record is about ("CVE-… on A and B"). Dedupe should never leave any. */
export function cveClashes(incidents: Incident[]): string[] {
  const owner = new Map<string, string>();
  const clashes: string[] = [];
  for (const inc of incidents) {
    for (const c of cvesOfIncident(inc)) {
      const prev = owner.get(c);
      if (prev) clashes.push(`${c} on ${prev} and ${inc.id}`);
      else owner.set(c, inc.id);
    }
  }
  return clashes;
}

export function cveConflict(a: Iterable<string>, b: Iterable<string>): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return false;
  for (const x of sa) if (sb.has(x)) return false;
  return true;
}

/* ---------- Entities ---------- */

function recordEntities(inc: Incident): Set<string> {
  const out = new Set<string>();
  for (const t of entityTokens(inc.title)) out.add(t);
  for (const s of inc.sources) for (const t of entityTokens(s.title)) out.add(t);
  return out;
}

/**
 * Document frequency of every entity token: once per record (over its title
 * and its sources' titles) and once per candidate. Title Case headlines make
 * capitalisation useless, so rarity decides what names an entity.
 */
export function buildEntityIndex(records: readonly Incident[], candidates: readonly Candidate[]): EntityIndex {
  const df: EntityIndex = new Map();
  const bump = (set: Iterable<string>) => {
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  };
  for (const r of records) bump(recordEntities(r));
  for (const c of candidates) bump(new Set(entityTokens(c.title)));
  return df;
}

/** Entity tokens both sides carry whose document frequency is at most `maxDf`. */
export function sharedEntities(a: Iterable<string>, b: Iterable<string>, df: EntityIndex, maxDf: number): string[] {
  const sb = new Set(b);
  const out: string[] = [];
  for (const t of new Set(a)) if (sb.has(t) && (df.get(t) ?? 0) <= maxDf) out.push(t);
  return out;
}

/* ---------- Products ---------- */

/** Vendor names that head many product names and identify none of them. */
const GENERIC_VENDOR_WORDS = new Set([
  "microsoft", "google", "amazon", "apple", "oracle", "cisco", "adobe", "github", "gitlab", "azure", "nvidia", "intel",
  "samsung", "linux", "windows", "android", "apache", "mozilla", "ubuntu", "redhat", "ibm", "atlassian", "openai", "anthropic",
]);

/**
 * Keys under which two product lists are compared: the product family
 * (lib/products.ts, so "OpenCode Console" and "OpenCode" need help) in lower
 * case, plus "~<first token>" when that token has five or more letters and is
 * not a vendor word, so "OpenCode Console" meets "OpenCode" on "~opencode"
 * and "ConnectWise Cloud Backup" meets "ConnectWise" on "~connectwise".
 */
export function productKeys(products: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const p of products) {
    const name = p.trim();
    if (!name) continue;
    out.add(productFamily(name).toLowerCase());
    const first = name.toLowerCase().split(/[^a-z0-9]+/).find(Boolean);
    if (first && /^[a-z]{5,}$/.test(first) && !GENERIC_VENDOR_WORDS.has(first)) out.add(`~${first}`);
  }
  return out;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/* ---------- Index ---------- */

function indexState(state: State): Indexed[] {
  const out: Indexed[] = [];
  for (const [pool, list] of [["incidents", state.incidents], ["review", state.review]] as [Pool, Incident[]][]) {
    for (const incident of list) {
      out.push({
        incident,
        pool,
        titles: [incident.title, ...incident.sources.map((s) => s.title)],
        cves: cvesOfIncident(incident),
        entities: recordEntities(incident),
        productKeys: productKeys(incident.products),
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
  return { id: inc.id, first_reported: inc.first_reported, title: inc.title, summary: inc.summary, products: inc.products, lane: laneOf(inc) };
}

const MAX_MATCHES = 3;

export function dedupe(candidates: Candidate[], state: State, settings: Settings, df?: EntityIndex): DedupeResult {
  const { lookback_days, merge_similarity, llm_check_similarity, entity_max_df, entity_window_days } = settings.dedupe;
  const index = indexState(state);
  const byId = new Map<string, Indexed>(index.map((i) => [i.incident.id, i]));
  const entityIndex = df ?? buildEntityIndex([...state.incidents, ...state.review], candidates);
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
    const scored: { idx: Indexed; sim: number; via: MatchVia }[] = [];
    for (const idx of index) {
      if (daysBetween(idx.incident.first_reported, c.published_at) > lookback_days) continue;
      if (cveConflict(c.cve_ids, idx.cves)) continue;
      const sim = bestSimilarity(c.title, idx.titles);
      if (sim >= llm_check_similarity) scored.push({ idx, sim, via: "title" });
    }
    scored.sort((a, b) => b.sim - a.sim);
    const top = scored[0];
    if (top && top.sim >= merge_similarity) {
      result.merges.push({ candidate: c, target: top.idx.incident, pool: top.idx.pool, how: "title", similarity: top.sim });
      continue;
    }

    // 3b. a shared entity with a recent record
    const cEntities = entityTokens(c.title);
    if (cEntities.length) {
      const already = new Set(scored.map((s) => s.idx.incident.id));
      const viaEntity: { idx: Indexed; sim: number; via: MatchVia }[] = [];
      for (const idx of index) {
        if (already.has(idx.incident.id)) continue;
        if (daysBetween(idx.incident.first_reported, c.published_at) > entity_window_days) continue;
        if (cveConflict(c.cve_ids, idx.cves)) continue;
        if (sharedEntities(cEntities, idx.entities, entityIndex, entity_max_df).length === 0) continue;
        viaEntity.push({ idx, sim: bestSimilarity(c.title, idx.titles), via: "entity" });
      }
      viaEntity.sort((a, b) => b.sim - a.sim);
      scored.push(...viaEntity);
    }

    if (scored.length) {
      result.llmChecks.push({
        candidate: c,
        matches: scored.slice(0, MAX_MATCHES).map((s) => ({ ref: refOf(s.idx.incident), similarity: s.sim, via: s.via, incident: s.idx.incident, pool: s.idx.pool })),
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

function clusterEntities(cl: Cluster): Set<string> {
  const out = new Set<string>();
  for (const m of cl.members) for (const t of entityTokens(m.title)) out.add(t);
  return out;
}

/**
 * Same-run pairs that are similar but not clearly the same, or that share an
 * entity: ask the LLM before creating two incidents.
 */
export function pairwiseClusterChecks(clusters: Cluster[], settings: Settings, df?: EntityIndex): Map<number, LlmCheck> {
  const { merge_similarity, llm_check_similarity, date_window_days, entity_max_df } = settings.dedupe;
  const entityIndex = df ?? buildEntityIndex([], clusters.flatMap((cl) => cl.members));
  const entities = clusters.map(clusterEntities);
  const checks = new Map<number, LlmCheck>();
  clusters.forEach((cl, i) => {
    const matches: LlmMatch[] = [];
    for (let j = 0; j < i; j++) {
      const other = clusters[j]!;
      if (daysBetween(other.primary.published_at, cl.primary.published_at) > date_window_days) continue;
      const cves = cl.members.flatMap((m) => m.cve_ids);
      if (cveConflict(cves, other.members.flatMap((m) => m.cve_ids))) continue;
      const sim = Math.max(...other.members.map((m) => titleSimilarity(cl.primary.title, m.title)));
      if (sim >= merge_similarity) continue; // clusterCandidates would have joined them; a date-window miss
      if (sim >= llm_check_similarity) matches.push({ ref: clusterRef(other, j), similarity: sim, via: "title", clusterIndex: j });
      else if (sharedEntities(entities[i]!, entities[j]!, entityIndex, entity_max_df).length) matches.push({ ref: clusterRef(other, j), similarity: sim, via: "entity", clusterIndex: j });
    }
    if (matches.length) {
      matches.sort((a, b) => b.similarity - a.similarity);
      checks.set(i, { candidate: cl.primary, matches: matches.slice(0, MAX_MATCHES) });
    }
  });
  return checks;
}

/* ---------- The product pass (after classification) ---------- */

/** A classified cluster as the product pass sees it: what the model said about it, plus the cluster. */
export interface ProductSubject {
  cluster: Cluster;
  title: string;
  summary: string;
  products: string[];
  lane: Lane;
  incident_date: string;
}

function subjectCves(s: ProductSubject): string[] {
  return s.cluster.members.flatMap((m) => m.cve_ids);
}

function subjectRef(s: ProductSubject, index: number): MatchRef {
  return { id: `NEW-${index}`, first_reported: s.cluster.primary.published_at, title: s.title, summary: s.summary, products: s.products, lane: s.lane };
}

/** The candidate the same-incident prompt describes for a cluster: its primary, with the classified products attached. */
export function subjectCandidate(s: ProductSubject): Candidate {
  return { ...s.cluster.primary, extra: { ...s.cluster.primary.extra, products: s.products } };
}

/** Whether two incident dates (full, month or year precision) lie within `days` of each other. */
function datesClose(a: string, b: string, days: number): boolean {
  return Math.abs(approxDaysBetween(a, b)) <= days;
}

/**
 * Same-run clusters that name the same product, carry no conflicting CVE ids
 * and sit within product_window_days of each other: ask the LLM before two
 * records are created (Cairn's three outlets, LiteLLM's follow-ups).
 */
export function productPairChecks(subjects: ProductSubject[], settings: Settings): Map<number, LlmCheck> {
  const { product_window_days } = settings.dedupe;
  const keys = subjects.map((s) => productKeys(s.products));
  const checks = new Map<number, LlmCheck>();
  subjects.forEach((s, i) => {
    if (keys[i]!.size === 0) return;
    const matches: LlmMatch[] = [];
    for (let j = 0; j < i; j++) {
      const other = subjects[j]!;
      if (!intersects(keys[i]!, keys[j]!)) continue;
      if (cveConflict(subjectCves(s), subjectCves(other))) continue;
      if (!datesClose(s.incident_date, other.incident_date, product_window_days) && !datesClose(s.cluster.primary.published_at, other.cluster.primary.published_at, product_window_days)) continue;
      matches.push({ ref: subjectRef(other, j), similarity: titleSimilarity(s.title, other.title), via: "product", clusterIndex: j });
    }
    if (matches.length) {
      // lane equality ranks, it does not filter
      matches.sort((a, b) => Number(b.ref.lane === s.lane) - Number(a.ref.lane === s.lane) || b.similarity - a.similarity);
      checks.set(i, { candidate: subjectCandidate(s), matches: matches.slice(0, MAX_MATCHES) });
    }
  });
  return checks;
}

/**
 * Classified clusters that name the same product as a recent record: ask the
 * LLM whether the new report is a follow-up (then it merges as an update) or a
 * new event. CVE-less records rank first for CVE-less candidates, so a
 * product's CVE records cannot crowd out its supply-chain incident.
 */
export function productRecordChecks(subjects: ProductSubject[], state: State, settings: Settings): { subject: ProductSubject; check: LlmCheck }[] {
  const { date_window_days, product_window_days } = settings.dedupe;
  const index = indexState(state).filter((i) => i.productKeys.size > 0);
  const out: { subject: ProductSubject; check: LlmCheck }[] = [];
  for (const s of subjects) {
    const keys = productKeys(s.products);
    if (keys.size === 0) continue;
    const cves = subjectCves(s);
    const scored: { idx: Indexed; sim: number }[] = [];
    for (const idx of index) {
      const inc = idx.incident;
      if (!intersects(keys, idx.productKeys)) continue;
      if (daysBetween(inc.first_reported, s.cluster.primary.published_at) > date_window_days) continue;
      if (cveConflict(cves, idx.cves)) continue;
      const incidentDatesClose = datesClose(s.incident_date, inc.incident_date, product_window_days);
      const reportClose = daysBetween(inc.first_reported, s.cluster.primary.published_at) <= 3;
      if (!incidentDatesClose && !reportClose) continue;
      scored.push({ idx, sim: bestSimilarity(s.title, idx.titles) });
    }
    if (!scored.length) continue;
    const candidateHasCves = cves.length > 0;
    scored.sort((a, b) => {
      if (!candidateHasCves) {
        const cveLess = Number(b.idx.cves.size === 0) - Number(a.idx.cves.size === 0);
        if (cveLess) return cveLess;
      }
      const lane = Number(laneOf(b.idx.incident) === s.lane) - Number(laneOf(a.idx.incident) === s.lane);
      return lane || b.sim - a.sim;
    });
    out.push({
      subject: s,
      check: {
        candidate: subjectCandidate(s),
        matches: scored.slice(0, MAX_MATCHES).map((x) => ({ ref: refOf(x.idx.incident), similarity: x.sim, via: "product" as const, incident: x.idx.incident, pool: x.idx.pool })),
      },
    });
  }
  return out;
}
