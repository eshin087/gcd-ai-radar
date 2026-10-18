import { SourceSchema, type Incident, type Source } from "../../lib/schema";
import type { Status } from "../../lib/taxonomy";
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
 * The classifier titles advisories "CVE-…: summary" and has copied a
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
  if (c.cve_ids.length) target.tags = normalizeTags([...target.tags, ...c.cve_ids]);
  target.updated_at = now;
  return true;
}

export function buildIncident(
  cluster: Cluster,
  item: ClassificationItem,
  status: Status,
  id: string,
  slug: string,
  now: string,
): Incident {
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

  const cves = [...new Set(cluster.members.flatMap((m) => m.cve_ids))];
  return {
    id,
    slug,
    title: truncate(fixLeadingCve(item.title.trim().replace(/[.\s]+$/, ""), cves), 160),
    summary: truncate(item.summary.trim(), 700),
    type: item.type,
    categories: [...new Set(item.categories)].slice(0, 4),
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
  };
}
