/**
 * The deadline arithmetic the ledger's rules (lib/panel/ledger.ts) and the
 * browser share, so the page judges a deadline by the visitor's clock with
 * the same rule the build used. No imports, so the page's script stays
 * small.
 */

const DAY_MS = 86_400_000;

/** A deadline is "this week" through the seventh calendar day after today. */
export const LEDGER_SOON_DAYS = 7;

/** The moment a CISA deadline passes: the end of its UTC day. */
export function dueEnd(due: string): number {
  return Date.parse(`${due}T00:00:00Z`) + DAY_MS;
}

/**
 * A record without a full patch is folded into a deadline row, and not
 * listed a second time, when every one of its CVEs is on a deadline row.
 * `dueCves` holds the CVE ids of the rows that count: this week's at build
 * time, and in the browser only those still ahead, so a record whose
 * deadline has passed while the page stayed open is listed again.
 */
export function foldedOnDeadline(cves: readonly string[], dueCves: ReadonlySet<string>): boolean {
  return cves.length > 0 && cves.every((c) => dueCves.has(c));
}

/**
 * How far the runway's axis reaches each side of now, in milliseconds. The
 * ledger keeps deadlines through the seventh calendar day after today and a
 * deadline passes at the end of its UTC day, so the axis runs to the end of
 * that seventh day, and an eighth of a day further so a marker on the last
 * midnight sits inside the edge: between seven and a little over eight
 * days. The same on both sides, so NOW stays in the middle.
 */
export function runwaySpan(now: number): number {
  return (Math.floor(now / DAY_MS) + LEDGER_SOON_DAYS + 1) * DAY_MS - now + DAY_MS / 8;
}
