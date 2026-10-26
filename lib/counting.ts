import type { Incident } from "./schema";
import { isAiType, type IncidentType, type Origin, type Severity } from "./taxonomy";

/**
 * What the headline counts. A CVE or advisory with no confirmed exploitation
 * is a *disclosed vulnerability*: it is kept, shown and downloadable, but as
 * its own series, not as an incident. Vendors file these in batches (30 in a
 * day for one product), so counting them would make the incident trend a
 * CVE-issuance trend. A CVE moves into the incident count once exploitation
 * is confirmed (severity 3, e.g. listed by CISA KEV or confirmed by the vendor).
 *
 * The rule: severity below 3, and the record comes only from vulnerability
 * databases, either by origin (NVD, GitHub Advisory Database backfills) or
 * because every source is one (NVD, GitHub Advisory Database, Microsoft's
 * Security Update Guide). Reported events and research write-ups always count.
 */

const VULN_DB_ORIGINS: ReadonlySet<Origin> = new Set<Origin>(["seed_nvd", "seed_ghsa"]);

/** Publishers that are vulnerability databases rather than reporting. */
export const VULN_DB_PUBLISHERS: ReadonlySet<string> = new Set(["NVD", "GitHub Advisory Database", "MSRC"]);

export type RecordKind = "incident" | "disclosed_vulnerability";

export function isDisclosedVuln(r: { origin: Origin; severity: Severity; publishers: readonly string[] }): boolean {
  if (r.severity >= 3) return false;
  if (VULN_DB_ORIGINS.has(r.origin)) return true;
  return r.publishers.length > 0 && r.publishers.every((p) => VULN_DB_PUBLISHERS.has(p));
}

export function isDisclosedIncident(i: Pick<Incident, "origin" | "severity" | "sources">): boolean {
  return isDisclosedVuln({ origin: i.origin, severity: i.severity, publishers: [...new Set(i.sources.map((s) => s.publisher))] });
}

export function recordKind(i: Pick<Incident, "origin" | "severity" | "sources">): RecordKind {
  return isDisclosedIncident(i) ? "disclosed_vulnerability" : "incident";
}

/**
 * The AI lens. A record is an AI record when its type is attack_on_ai or
 * ai_enabled_attack. Everything that counts AI incidents (the /trends charts
 * and their drawers, the weekly briefing, summary.json, the embed card, the
 * OG images) counts through this lens, so those numbers mean today what they
 * meant when the site tracked AI incidents alone. Records with no AI role
 * (`not_ai`) are in the live lanes, the archive, the feeds and the tag pages
 * only.
 */
export function isAiRecord(r: { type: IncidentType }): boolean {
  return isAiType(r.type);
}

export function aiLens<T extends { type: IncidentType }>(records: readonly T[]): T[] {
  return records.filter(isAiRecord);
}
