import { isDisclosedIncident } from "../counting";
import { addDays, type FullIncident } from "../lifecycle";
import { productFamily } from "../products";
import type { KevStatEntry } from "../stats-schema";
import type { IncidentType, Lane, Severity } from "../taxonomy";
import { rowStack, stackHits, type StackFile } from "./picks";
import { DAY_MS, kevName, recordCves } from "./util";

/**
 * The ledger: what is exploited and still needs doing, in three groups. The
 * page shows the top rows of each; a drawer or the live board holds the rest.
 *
 * Due this week: CISA's deadlines that fall within seven days of today,
 * nearest first. Entries are folded per vendor, product and deadline, with
 * the group's highest CVSS and every CVE id; a row links our record when one
 * names its first CVE, else NVD. Deadlines after the week are `later`, the
 * drawer's list.
 *
 * No patch yet: our live patch-lane records of severity 3 or more with no
 * patch or a partial one, unpatched first, then the newest report first.
 * A record whose CVEs are all on one of this week's deadline rows is that
 * row (`onDeadlineRow`): the drawer lists it, the page does not show it
 * twice.
 *
 * New this week: live records of severity 3 or more that entered the
 * dataset in the last seven times 24 hours, every lane, with the rows the
 * two groups above already show left out; confirmed loss (severity 4)
 * first, then the newest. The file keeps the first LEDGER_NEW_KEPT; the
 * totals count them all.
 *
 * Every row names the stack picks it belongs to: the picks whose items
 * (lib/panel/stack.ts) hold the row's CVE id or record. The build computes
 * that for the default stack; the browser recomputes it for the visitor's
 * picks (lib/panel/picks.ts stackHits).
 */

export { LEDGER_DUE_ROWS, LEDGER_NEW_ROWS, LEDGER_PATCH_ROWS } from "./caps";
export const LEDGER_SOON_DAYS = 7;
export const LEDGER_NEW_KEPT = 12;

const ACTION_LANES: readonly Lane[] = ["patch", "breach", "supply_chain"];

export interface DueRow {
  kind: "due";
  name: string;
  cves: string[];
  cvss: number | null;
  due: string;
  /** The day CISA listed the newest entry of the group. */
  added: string;
  ransomware: boolean;
  href: string;
  external: boolean;
  /** The labels of the stack picks the row belongs to. */
  stack: string[];
}

export interface PatchRow {
  kind: "patch";
  slug: string;
  /** The first product's family, or the title when the record names no product. */
  name: string;
  title: string;
  cves: string[];
  cvss: number | null;
  patch: "unpatched" | "partial";
  reported: string;
  type: IncidentType;
  /** Every CVE of the record is on one of this week's deadline rows: the page shows that row instead. */
  onDeadlineRow: boolean;
  stack: string[];
}

export interface NewRow {
  kind: "new";
  slug: string;
  title: string;
  lane: Lane;
  severity: Severity;
  cvss: number | null;
  type: IncidentType;
  created: string;
  product: string | null;
  cves: string[];
  stack: string[];
}

export interface Ledger {
  due: DueRow[];
  later: DueRow[];
  /** Every live record without a full patch, folded ones included: the drawer's list. */
  patch: PatchRow[];
  fresh: NewRow[];
  freshTotal: number;
  freshLoss: number;
  freshAi: number;
  /** Live records of severity 3 or more in the three action lanes. */
  exploitedLive: number;
  /** Live patch-lane records of severity 3 or more without a full patch: the hero's number. */
  noFullPatch: number;
}

interface KevGroup {
  vendor: string;
  product: string;
  due: string;
  added: string;
  cvss: number | null;
  cves: string[];
  ransomware: boolean;
}

/** CISA's entries with a deadline on or after today, one group per vendor, product and deadline, nearest deadline first. */
export function kevGroups(entries: readonly KevStatEntry[], today: string): KevGroup[] {
  const groups = new Map<string, KevGroup>();
  for (const e of entries) {
    if (!e.due || e.due < today) continue;
    const k = `${e.vendor}|${e.product}|${e.due}`;
    const g = groups.get(k) ?? { vendor: e.vendor, product: e.product, due: e.due, added: e.added, cvss: null, cves: [], ransomware: false };
    g.cves.push(e.cve);
    if (e.added > g.added) g.added = e.added;
    if (e.ransomware) g.ransomware = true;
    if (e.cvss !== null && (g.cvss === null || e.cvss > g.cvss)) g.cvss = e.cvss;
    groups.set(k, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, cves: [...g.cves].sort() }))
    .sort((a, b) => a.due.localeCompare(b.due) || (b.cvss ?? -1) - (a.cvss ?? -1) || a.cves[0]!.localeCompare(b.cves[0]!));
}

export function buildLedger(incidents: readonly FullIncident[], kev: readonly KevStatEntry[], stackFile: Pick<StackFile, "default" | "candidates">, today: string, nowIso: string): Ledger {
  const live = incidents.filter((i) => i.state === "live" && !isDisclosedIncident(i));
  const slugByCve = new Map<string, string>();
  for (const i of incidents) for (const c of recordCves(i)) if (!slugByCve.has(c)) slugByCve.set(c, i.slug);
  const hits = stackHits(stackFile, stackFile.default);

  const dueRows: DueRow[] = kevGroups(kev, today).map((g) => {
    const slug = slugByCve.get(g.cves[0]!);
    const href = slug ? `/incidents/${slug}` : `https://nvd.nist.gov/vuln/detail/${g.cves[0]}`;
    return { kind: "due", name: kevName(g.vendor, g.product), cves: g.cves, cvss: g.cvss, due: g.due, added: g.added, ransomware: g.ransomware, href, external: !slug, stack: rowStack(hits, { cves: g.cves, href }) };
  });
  const soonUntil = addDays(today, LEDGER_SOON_DAYS);
  const due = dueRows.filter((r) => r.due <= soonUntil);
  const later = dueRows.filter((r) => r.due > soonUntil);
  const dueCves = new Set(due.flatMap((r) => r.cves));

  const patch: PatchRow[] = live
    .filter((i) => i.lane === "patch" && i.severity >= 3 && (i.patch_status === "unpatched" || i.patch_status === "partial"))
    .sort((a, b) => (a.patch_status === b.patch_status ? 0 : a.patch_status === "unpatched" ? -1 : 1) || b.first_reported.localeCompare(a.first_reported) || b.created_at.localeCompare(a.created_at) || a.slug.localeCompare(b.slug))
    .map((i) => {
      const cves = recordCves(i).sort();
      const href = `/incidents/${i.slug}`;
      return {
        kind: "patch",
        slug: i.slug,
        name: i.products[0] ? productFamily(i.products[0]) : i.title,
        title: i.title,
        cves,
        cvss: i.cvss,
        patch: i.patch_status as "unpatched" | "partial",
        reported: i.first_reported,
        type: i.type,
        onDeadlineRow: cves.length > 0 && cves.every((c) => dueCves.has(c)),
        stack: rowStack(hits, { cves, href }),
      };
    });

  const shown = new Set([...dueRows.map((r) => r.href), ...patch.filter((r) => !r.onDeadlineRow).map((r) => `/incidents/${r.slug}`)]);
  const weekFrom = Date.parse(nowIso) - LEDGER_SOON_DAYS * DAY_MS;
  const freshAll = live
    .filter((i) => i.severity >= 3 && i.created_at <= nowIso && Date.parse(i.created_at) > weekFrom)
    .sort((a, b) => b.severity - a.severity || b.created_at.localeCompare(a.created_at) || a.slug.localeCompare(b.slug));
  const fresh: NewRow[] = freshAll
    .filter((i) => !shown.has(`/incidents/${i.slug}`))
    .slice(0, LEDGER_NEW_KEPT)
    .map((i) => {
      const cves = recordCves(i).sort();
      return {
        kind: "new" as const,
        slug: i.slug,
        title: i.title,
        lane: i.lane,
        severity: i.severity,
        cvss: i.cvss,
        type: i.type,
        created: i.created_at,
        product: i.products[0] ? productFamily(i.products[0]) : null,
        cves,
        stack: rowStack(hits, { cves, href: `/incidents/${i.slug}` }),
      };
    });

  return {
    due,
    later,
    patch,
    fresh,
    freshTotal: freshAll.length,
    freshLoss: freshAll.filter((i) => i.severity >= 4).length,
    freshAi: freshAll.filter((i) => i.type !== "not_ai").length,
    exploitedLive: live.filter((i) => i.severity >= 3 && ACTION_LANES.includes(i.lane)).length,
    noFullPatch: patch.length,
  };
}
