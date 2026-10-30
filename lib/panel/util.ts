import { cveIds } from "../products";
import type { FullIncident } from "../lifecycle";

export { shortDate } from "./dates";

/**
 * Small rules the home page's instruments share (lib/panel/*). Dates are UTC
 * days ("YYYY-MM-DD"); a window of N days ending today is every day after
 * today minus N, so "7 days" is today and the six days before it, the same
 * rule as the KEV counter in lib/home.ts.
 */

export const DAY_MS = 86_400_000;

/** Every CVE id a record names: its lifecycle list, its tags and its title; upper-cased and unique. */
export function recordCves(i: Pick<FullIncident, "cve_ids" | "tags" | "title">): string[] {
  return [...new Set([...i.cve_ids.map((c) => c.toUpperCase()), ...cveIds(i)])];
}

/**
 * The name a KEV entry goes by: the product alone when the vendor's name
 * already holds it ("PHP Group" + "PHP" -> "PHP") or the product starts with
 * the vendor ("Plex" + "Plex Media Server"), else vendor then product.
 */
export function kevName(vendor: string, product: string): string {
  const v = vendor.trim();
  const p = product.trim();
  if (!p) return v;
  if (!v) return p;
  const vl = v.toLowerCase();
  const pl = p.toLowerCase();
  return vl.includes(pl) || pl.startsWith(vl) ? p : `${v} ${p}`;
}

/** Lower-case words a record is matched on: title, products and tags (not the summary, where a vendor is often only mentioned in passing). */
export function recordText(i: Pick<FullIncident, "title" | "products" | "tags">): string {
  return [i.title, ...i.products, ...i.tags].join(" ").toLowerCase();
}

/** Lower-case slug of a label, the key a stack pick travels under in a URL: "Palo Alto Networks" -> "palo-alto-networks". */
export function slugKey(label: string): string {
  return label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
