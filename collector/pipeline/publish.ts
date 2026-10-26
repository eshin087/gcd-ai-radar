import { closedAtOf, stateOf, timelineOf, type FullIncident } from "../../lib/lifecycle";
import { SourceSchema, type Incident, type Source } from "../../lib/schema";
import { isAiType, type Category, type Lane, type PatchStatus, type Status } from "../../lib/taxonomy";
import { extractCves, truncate } from "../lib/text";
import type { ClassificationItem } from "../llm/schemas";
import type { Candidate } from "../sources/types";
import type { Cluster } from "./dedupe";

/** Turns classified clusters into incident records and merges new sources into existing ones. */

export function sourceFromCandidate(c: Candidate): Source {
  return { url: c.url, publisher: c.publisher, title: truncate(c.title, 300), published_at: c.published_at };
}

function normalizeTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    const cves = extractCves(trimmed);
    if (cves.length) for (const c of cves) out.add(c);
    else out.add(trimmed.toLowerCase().slice(0, 40));
  }
  return [...out].slice(0, 20);
}

/**
 * The classifier titles advisories "CVE-...: summary" and has copied a
 * neighbouring batch item's id into that slot. The leading id must be one the
 * cluster carries: swap in the cluster's id when it has exactly one, else drop it.
 */
export function fixLeadingCve(title: string, cves: string[]): string {
  const m = title.match(/^(CVE-\d{4}-\d{4,7})\s*:\s*/i);
  if (!m || cves.includes(m[1]!.toUpperCase())) return title;
  const rest = title.slice(m[0].length);
  return cves.length === 1 ? `${cves[0]}: ${rest}` : rest;
}

/** Adds a candidate as a source; returns false if the URL is already there. */
export function mergeSource(target: Incident, c: Candidate, now: string): boolean {
  if (target.sources.some((s) => s.url === c.url)) return false;
  target.sources.push(sourceFromCandidate(c));
  target.sources.sort((a, b) => a.published_at.localeCompare(b.published_at));
  target.source_count = target.sources.length;
  if (c.published_at < target.first_reported) target.first_reported = c.published_at;
  if (c.cve_ids.length) {
    target.tags = normalizeTags([...target.tags, ...c.cve_ids]);
    if (target.cve_ids) target.cve_ids = sortCves([...new Set([...target.cve_ids, ...c.cve_ids.map((x) => x.toUpperCase())])]);
  }
  target.updated_at = now;
  return true;
}

/** Highest id first, the order lib/products.ts cveIds uses. */
export function sortCves(ids: string[]): string[] {
  return [...ids].sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
}

/**
 * Free text the model wrote for a record field (action, severity_note, a
 * timeline entry, a version entry). Links, markup and line breaks have no
 * place in those fields and are the usual shape of injected text, so such a
 * value is dropped to "" rather than trimmed. A bare "<" is a version range
 * ("vllm < 0.9.1"); "<" followed by a tag name, "/" or "!" is markup.
 */
export function cleanLlmText(text: string, max: number): string {
  const t = text.trim();
  if (!t || /https?:|www\.|<\s*[a-z!/?]|[\r\n]/i.test(t)) return "";
  return truncate(t, max);
}

/** Version entries ("product < version") the model or an advisory gave: trimmed, unique, bounded, no markup. */
export function cleanVersionList(items: readonly string[], max = 30): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const v = cleanLlmText(raw, 120);
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** not_ai carries exactly ["general"]; AI records never carry it, and never end up with no category. */
export function normalizeCategories(type: Incident["type"], categories: readonly Category[]): Category[] {
  if (type === "not_ai") return ["general"];
  const out = [...new Set(categories)].filter((c) => c !== "general").slice(0, 4);
  return out.length ? out : ["other"];
}

const ARXIV_HOST = /(^|\.)arxiv\.org$/i;

function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

interface AdvisoryVersion {
  package?: unknown;
  range?: unknown;
  first_patched?: unknown;
}

/** Version data from GitHub advisory members (extra.vulnerabilities), used when the classifier gave none. */
function advisoryVersions(cluster: Cluster): { affected: string[]; fixed_in: string[] } {
  const affected: string[] = [];
  const fixed_in: string[] = [];
  for (const m of cluster.members) {
    const list = m.extra?.["vulnerabilities"];
    if (!Array.isArray(list)) continue;
    for (const raw of list as AdvisoryVersion[]) {
      const pkg = typeof raw.package === "string" && raw.package ? raw.package : null;
      if (!pkg) continue;
      if (typeof raw.range === "string" && raw.range) affected.push(`${pkg} ${raw.range}`);
      if (typeof raw.first_patched === "string" && raw.first_patched) fixed_in.push(`${pkg} ${raw.first_patched}`);
    }
  }
  return { affected: cleanVersionList(affected), fixed_in: cleanVersionList(fixed_in) };
}

/** The first CVSS score a structured member (NVD, GHSA) carries. */
function memberCvss(cluster: Cluster): number | null {
  for (const m of cluster.members) {
    const v = m.extra?.["cvss"];
    if (typeof v === "number" && v >= 0 && v <= 10) return v;
  }
  return null;
}

export function buildIncident(
  cluster: Cluster,
  item: ClassificationItem,
  status: Status,
  id: string,
  slug: string,
  now: string,
): FullIncident {
  const byUrl = new Map<string, Source>();
  for (const m of cluster.members) if (!byUrl.has(m.url)) byUrl.set(m.url, sourceFromCandidate(m));
  // Structured seeds (ATLAS, AIID, AVID) carry the original reports they cite.
  for (const m of cluster.members) {
    const extra = m.extra?.["additional_sources"];
    if (!Array.isArray(extra)) continue;
    for (const raw of extra) {
      const parsed = SourceSchema.safeParse(raw);
      if (parsed.success && !byUrl.has(parsed.data.url) && byUrl.size < 15) byUrl.set(parsed.data.url, parsed.data);
    }
  }
  const sources = [...byUrl.values()].sort((a, b) => a.published_at.localeCompare(b.published_at));
  const first_reported = sources[0]!.published_at;

  let incident_date = item.incident_date;
  let precision = item.incident_date_precision;
  const expectedLen = precision === "day" ? 10 : precision === "month" ? 7 : 4;
  if (incident_date.length !== expectedLen) {
    // Trust the string, fix the precision label.
    precision = incident_date.length === 10 ? "day" : incident_date.length === 7 ? "month" : "year";
  }
  if (incident_date > first_reported.slice(0, incident_date.length)) {
    incident_date = first_reported;
    precision = "day";
  }

  const cves = sortCves([...new Set(cluster.members.flatMap((m) => m.cve_ids.map((c) => c.toUpperCase())))]);
  const type = item.type;
  const categories = normalizeCategories(type, item.categories);

  // Lane: the classifier's, with one guardrail: an AI paper from arXiv at severity 1 is research whatever it said.
  let lane: Lane = item.lane;
  if (isAiType(type) && item.severity === 1 && cluster.members.some((m) => ARXIV_HOST.test(hostOfUrl(m.url)))) lane = "research";

  let patch_status: PatchStatus = item.patch_status;
  if (lane === "breach") patch_status = "no_fix_needed";
  else if (lane === "research") patch_status = "unknown";

  const fromClassifier = { affected: cleanVersionList(item.affected), fixed_in: cleanVersionList(item.fixed_in) };
  const fromAdvisory = fromClassifier.affected.length || fromClassifier.fixed_in.length ? null : advisoryVersions(cluster);
  const affected = fromAdvisory ? fromAdvisory.affected : fromClassifier.affected;
  const fixed_in = fromAdvisory ? fromAdvisory.fixed_in : fromClassifier.fixed_in;

  const cvss = item.cvss > 0 ? Math.round(item.cvss * 10) / 10 : memberCvss(cluster);

  const base: Incident = {
    id,
    slug,
    title: truncate(fixLeadingCve(item.title.trim().replace(/[.\s]+$/, ""), cves), 160),
    summary: truncate(item.summary.trim(), 700),
    type,
    categories,
    severity: item.severity,
    targets: [...new Set(item.targets)].slice(0, 6),
    products: [...new Set(item.products.map((p) => p.trim()).filter(Boolean))].slice(0, 10),
    incident_date,
    incident_date_precision: precision,
    first_reported,
    sources,
    source_count: sources.length,
    confidence: Math.round(item.confidence * 100) / 100,
    status,
    origin: cluster.primary.origin,
    tags: normalizeTags([...item.tags, ...cves]),
    created_at: now,
    updated_at: now,
    lane,
    patch_status,
    cve_ids: cves,
    affected,
    fixed_in,
    timeline: timelineOf({ sources, created_at: now, timeline: undefined }),
    action: cleanLlmText(item.action, 300),
    severity_note: cleanLlmText(item.severity_note, 200),
    cvss,
  };
  const today = now.slice(0, 10);
  const state = stateOf(base, today);
  return { ...base, state, closed_at: state === "closed" ? closedAtOf(base, today) : null } as FullIncident;
}
