import { isDisclosedIncident } from "./counting";
import { productFamily } from "./products";
import type { Incident } from "./schema";

/**
 * The compact row: the few fields the dashboard needs to count an incident
 * and to list it in the report drawer. Rows are written per year shard to
 * public/data/rows/<year>.json at build time and fetched only when a drawer
 * opens; the page itself ships aggregates (lib/aggregates.ts).
 */

export type Basis = "all" | "real";

export interface CompactRow {
  id: string;
  slug: string;
  title: string;
  incident_date: string;
  incident_date_precision: Incident["incident_date_precision"];
  first_reported: string;
  type: Incident["type"];
  categories: Incident["categories"];
  severity: Incident["severity"];
  targets: Incident["targets"];
  source_count: number;
  /** A CVE or advisory with no confirmed exploitation: its own series, not an incident (lib/counting.ts). */
  disclosed: boolean;
  /** Family of the first product named (lib/products.ts), for the disclosed-vulnerability breakdown (empty for incidents). */
  product: string;
  /**
   * Families of every product an incident names, once each, for the stack and
   * agent panels (lib/watch.ts); empty for disclosed vulnerabilities. Optional
   * so rows built elsewhere (test fixtures) need not spell it out.
   */
  products?: string[];
}

export function compactRow(i: Incident): CompactRow {
  const disclosed = isDisclosedIncident(i);
  return {
    id: i.id,
    slug: i.slug,
    title: i.title,
    incident_date: i.incident_date,
    incident_date_precision: i.incident_date_precision,
    first_reported: i.first_reported,
    type: i.type,
    categories: i.categories,
    severity: i.severity,
    targets: i.targets,
    source_count: i.source_count,
    disclosed,
    product: disclosed ? productFamily(i.products[0] ?? "") : "",
    products: disclosed ? [] : [...new Set(i.products.map(productFamily).filter(Boolean))],
  };
}

/** Rows a basis counts: incidents only, or the real-world subset (severity 3-4). Disclosed vulnerabilities are never in a basis. */
export function inBasis(r: Pick<CompactRow, "disclosed" | "severity">, basis: Basis): boolean {
  if (r.disclosed) return false;
  return basis === "all" || r.severity >= 3;
}
