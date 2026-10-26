import { isDisclosedIncident } from "./counting";
import { lastActivity, type FullIncident } from "./lifecycle";
import { buildRelatedIndex, relatedFromIndex, type RelatedIndex } from "./related";
import type { Incident } from "./schema";
import { tagSlugsOf } from "./tags";
import type { Category, DatePrecision, IncidentType, Lane, Origin, PatchStatus, RecordState, Severity, Target } from "./taxonomy";

/** The compact record shipped to the client for the incidents explorer (no sources array). */
export interface SlimIncident {
  id: string;
  slug: string;
  title: string;
  summary: string;
  type: IncidentType;
  categories: Category[];
  severity: Severity;
  targets: Target[];
  products: string[];
  incident_date: string;
  incident_date_precision: DatePrecision;
  first_reported: string;
  source_count: number;
  publishers: string[];
  origin: Origin;
  /** A CVE or advisory with no confirmed exploitation, tracked apart from incidents (lib/counting.ts). */
  disclosed: boolean;
  lane: Lane;
  state: RecordState;
  patch_status: PatchStatus;
  /** The CVE ids the record is about, highest first. */
  cve_ids: string[];
  /** Tag slugs (lib/tags.ts), at most five. */
  tags: string[];
  /** The newest dated activity: a timeline entry, a source or the first report. */
  last_update: string;
}

export function slim(i: FullIncident): SlimIncident {
  return {
    id: i.id,
    slug: i.slug,
    title: i.title,
    summary: i.summary,
    type: i.type,
    categories: i.categories,
    severity: i.severity,
    targets: i.targets,
    products: i.products,
    incident_date: i.incident_date,
    incident_date_precision: i.incident_date_precision,
    first_reported: i.first_reported,
    source_count: i.source_count,
    publishers: [...new Set(i.sources.map((s) => s.publisher))],
    origin: i.origin,
    disclosed: isDisclosedIncident(i),
    lane: i.lane,
    state: i.state,
    patch_status: i.patch_status,
    cve_ids: i.cve_ids,
    tags: tagSlugsOf(i),
    last_update: lastActivity(i),
  };
}

const relatedIndexes = new WeakMap<readonly Incident[], RelatedIndex>();

/**
 * Related incidents: shared categories, targets and products, same type,
 * close in time (lib/related.ts). The bucket index is built once per dataset
 * array and kept for every page rendered from it.
 */
export function relatedIncidents(all: readonly Incident[], incident: Incident, limit = 6): Incident[] {
  let index = relatedIndexes.get(all);
  if (!index) {
    index = buildRelatedIndex(all);
    relatedIndexes.set(all, index);
  }
  return relatedFromIndex(index, incident, limit);
}
