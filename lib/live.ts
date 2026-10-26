import { isDisclosedIncident, isAiRecord } from "./counting";
import { lastActivity, type FullIncident } from "./lifecycle";
import { productFamily } from "./products";
import type { SlimIncident } from "./slim";
import { tagSlugsOf } from "./tags";
import type { DatePrecision, IncidentType, Lane, PatchStatus, RecordState, Severity } from "./taxonomy";

/**
 * The row: what a list of records shows about each one, on the live page,
 * in the archive, on tag and product pages and in the report drawer. Built
 * from a full record at build time (rowOf) or from a slim record in the
 * browser (rowOfSlim), so every list renders the same component.
 */
export interface LiveRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  lane: Lane;
  type: IncidentType;
  /** True for an AI record (lib/counting.ts aiLens). */
  ai: boolean;
  severity: Severity;
  state: RecordState;
  patch_status: PatchStatus;
  /** Product families named, at most three. */
  products: string[];
  /** CVE ids, at most three, with how many more there are. */
  cve_ids: string[];
  cve_more: number;
  action: string;
  since: string;
  since_precision: DatePrecision;
  first_reported: string;
  last_update: string;
  tags: string[];
  disclosed: boolean;
}

const MAX_PRODUCTS = 3;
const MAX_CVES = 3;

function families(products: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of products) {
    const f = productFamily(p);
    if (f && !out.includes(f)) out.push(f);
    if (out.length === MAX_PRODUCTS) break;
  }
  return out;
}

export function rowOf(i: FullIncident): LiveRow {
  return {
    id: i.id,
    slug: i.slug,
    title: i.title,
    summary: i.summary,
    lane: i.lane,
    type: i.type,
    ai: isAiRecord(i),
    severity: i.severity,
    state: i.state,
    patch_status: i.patch_status,
    products: families(i.products),
    cve_ids: i.cve_ids.slice(0, MAX_CVES),
    cve_more: Math.max(0, i.cve_ids.length - MAX_CVES),
    action: i.action,
    since: i.incident_date,
    since_precision: i.incident_date_precision,
    first_reported: i.first_reported,
    last_update: lastActivity(i),
    tags: tagSlugsOf(i),
    disclosed: isDisclosedIncident(i),
  };
}

/** The same row from a slim record (no action line: the slim record carries none). */
export function rowOfSlim(s: SlimIncident): LiveRow {
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    summary: s.summary,
    lane: s.lane,
    type: s.type,
    ai: isAiRecord(s),
    severity: s.severity,
    state: s.state,
    patch_status: s.patch_status,
    products: families(s.products),
    cve_ids: s.cve_ids.slice(0, MAX_CVES),
    cve_more: Math.max(0, s.cve_ids.length - MAX_CVES),
    action: "",
    since: s.incident_date,
    since_precision: s.incident_date_precision,
    first_reported: s.first_reported,
    last_update: s.last_update,
    tags: s.tags,
    disclosed: s.disclosed,
  };
}
