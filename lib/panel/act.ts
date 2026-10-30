import { isDisclosedIncident } from "../counting";
import { addDays, type FullIncident } from "../lifecycle";
import { productFamily } from "../products";
import type { KevStatEntry } from "../stats-schema";
import type { IncidentType, Lane, PatchStatus, Severity } from "../taxonomy";
import { kevName, recordCves } from "./util";

/**
 * Act now and Latest, the two lists of the home page.
 *
 * Act now: what is exploited and still needs doing, at most six rows. First
 * the CISA KEV deadlines within seven days, nearest first (entries folded per
 * vendor, product and deadline, with the group's highest CVSS); then our live
 * patch-lane records of severity 3 or more with no patch yet whose CVEs are
 * not already in a KEV row, newest report first; then the later KEV
 * deadlines. A KEV row links our record when one names its first CVE, else
 * NVD.
 *
 * Latest: the six newest live records of severity 3 or more in every lane, by
 * when they entered the dataset; disclosed CVEs are left out.
 */

export const ACT_ROWS = 6;
export const ACT_SOON_DAYS = 7;
export const LATEST_ROWS = 6;

export type ActRow =
  | { kind: "kev"; name: string; cves: string[]; cvss: number | null; due: string; href: string; external: boolean }
  | { kind: "record"; name: string; title: string; cves: string[]; cvss: number | null; patch: PatchStatus; reported: string; href: string };

export interface ActNow {
  rows: ActRow[];
  /** Live records of severity 3 or more in the three action lanes: the "all N exploited records" link. */
  exploitedLive: number;
  /** Live patch-lane records of severity 3 or more without a full patch (none or partial): the verdict's number. */
  noFullPatch: number;
}

export interface LatestRow {
  slug: string;
  lane: Lane;
  title: string;
  cvss: number | null;
  severity: Severity;
  type: IncidentType;
  created: string;
}

interface KevGroup {
  vendor: string;
  product: string;
  due: string;
  cvss: number | null;
  cves: string[];
}

function kevGroups(entries: readonly KevStatEntry[], today: string): KevGroup[] {
  const groups = new Map<string, KevGroup>();
  for (const e of entries) {
    if (!e.due || e.due < today) continue;
    const k = `${e.vendor}|${e.product}|${e.due}`;
    const g = groups.get(k) ?? { vendor: e.vendor, product: e.product, due: e.due, cvss: null, cves: [] };
    g.cves.push(e.cve);
    if (e.cvss !== null && (g.cvss === null || e.cvss > g.cvss)) g.cvss = e.cvss;
    groups.set(k, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, cves: [...g.cves].sort() }))
    .sort((a, b) => a.due.localeCompare(b.due) || (b.cvss ?? -1) - (a.cvss ?? -1) || a.cves[0]!.localeCompare(b.cves[0]!));
}

const ACTION_LANES: readonly Lane[] = ["patch", "breach", "supply_chain"];

export function buildActNow(incidents: readonly FullIncident[], kev: readonly KevStatEntry[], today: string): ActNow {
  const live = incidents.filter((i) => i.state === "live" && !isDisclosedIncident(i));
  const slugByCve = new Map<string, string>();
  for (const i of incidents) for (const c of recordCves(i)) if (!slugByCve.has(c)) slugByCve.set(c, i.slug);

  const groups = kevGroups(kev, today);
  const kevCves = new Set(groups.flatMap((g) => g.cves));
  const kevRow = (g: KevGroup): ActRow => {
    const slug = slugByCve.get(g.cves[0]!);
    return { kind: "kev", name: kevName(g.vendor, g.product), cves: g.cves, cvss: g.cvss, due: g.due, href: slug ? `/incidents/${slug}` : `https://nvd.nist.gov/vuln/detail/${g.cves[0]}`, external: !slug };
  };
  const soonUntil = addDays(today, ACT_SOON_DAYS);
  const soon = groups.filter((g) => g.due <= soonUntil).map(kevRow);
  const later = groups.filter((g) => g.due > soonUntil).map(kevRow);

  const patchOpen = live.filter((i) => i.lane === "patch" && i.severity >= 3 && (i.patch_status === "unpatched" || i.patch_status === "partial"));
  const records: ActRow[] = patchOpen
    .filter((i) => i.patch_status === "unpatched" && !recordCves(i).some((c) => kevCves.has(c)))
    .sort((a, b) => b.first_reported.localeCompare(a.first_reported) || b.created_at.localeCompare(a.created_at) || a.slug.localeCompare(b.slug))
    .map((i) => ({
      kind: "record",
      name: i.products[0] ? productFamily(i.products[0]) : i.title,
      title: i.title,
      cves: recordCves(i).sort(),
      cvss: i.cvss,
      patch: i.patch_status,
      reported: i.first_reported,
      href: `/incidents/${i.slug}`,
    }));

  return {
    rows: [...soon, ...records, ...later].slice(0, ACT_ROWS),
    exploitedLive: live.filter((i) => i.severity >= 3 && ACTION_LANES.includes(i.lane)).length,
    noFullPatch: patchOpen.length,
  };
}

export function buildLatest(incidents: readonly FullIncident[], nowIso: string): LatestRow[] {
  return incidents
    .filter((i) => i.state === "live" && i.severity >= 3 && !isDisclosedIncident(i) && i.created_at <= nowIso)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.slug.localeCompare(b.slug))
    .slice(0, LATEST_ROWS)
    .map((i) => ({ slug: i.slug, lane: i.lane, title: i.title, cvss: i.cvss, severity: i.severity, type: i.type, created: i.created_at }));
}
