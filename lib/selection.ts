import { FAMILY_META, familyOf, type Family } from "./families";
import { dateLabel, monthLabel } from "./format";
import { inBasis, type Basis, type CompactRow } from "./rows";
import { dateOf, isRealWorld, monthKey, primaryCategory, shiftMonth, windowKey, type DateField, type Headline } from "./stats";
import { CATEGORY_META, SEVERITY_META, TARGET_META, TYPE_META, type Category, type IncidentType, type Severity, type Target } from "./taxonomy";

/**
 * What a click on the dashboard selects, and which rows it selects. The same
 * two functions (inPool, matches) decide the drawer's list in the browser and
 * the parity test's expected counts, so a number and its drawer cannot drift
 * apart.
 */

export type Selection =
  | { kind: "month"; month: string }
  | { kind: "month-category"; month: string; category: Category }
  | { kind: "month-type"; month: string; type: IncidentType }
  | { kind: "month-family"; month: string; family: Family }
  | { kind: "family"; family: Family }
  | { kind: "target"; target: Target }
  | { kind: "severity"; severity: Severity }
  | { kind: "category"; category: Category }
  | { kind: "type"; type: IncidentType }
  /** Every incident in the current window and set. */
  | { kind: "window" }
  /** Severity 3-4 incidents in the current window. */
  | { kind: "real" }
  /** An inclusive month range on the date basis, independent of the window (trailing 12 months, year to date). */
  | { kind: "range"; from: string; to: string; label: string; toDate?: string; byYear?: boolean }
  /** Disclosed vulnerabilities (CVEs with no confirmed exploitation), tracked apart from incidents. */
  | { kind: "disclosed" }
  | { kind: "disclosed-month"; month: string }
  | { kind: "disclosed-product"; product: string }
  | { kind: "disclosed-day"; day: string }
  /** Incidents of the basis on one full-dated day (calendar). */
  | { kind: "day"; day: string }
  /** One cell of the family by severity heatmap. */
  | { kind: "family-severity"; family: Family; severity: Severity }
  /** One ribbon of the flow: a type into a family. */
  | { kind: "type-family"; type: IncidentType; family: Family }
  /** One ribbon of the flow or one bubble: a family onto a target. */
  | { kind: "family-target"; family: Family; target: Target }
  /** A family's count in another window (the prior window of the slope and radar charts), independent of the current window. */
  | { kind: "family-range"; family: Family; from: string; to: string; label: string };

export function isDisclosedSelection(sel: Selection): boolean {
  return sel.kind === "disclosed" || sel.kind === "disclosed-month" || sel.kind === "disclosed-product" || sel.kind === "disclosed-day";
}

export function selectionLabel(sel: Selection): string {
  switch (sel.kind) {
    case "month":
      return monthLabel(sel.month, true);
    case "month-category":
      return `${CATEGORY_META[sel.category].label} · ${monthLabel(sel.month, true)}`;
    case "month-type":
      return `${TYPE_META[sel.type].label} · ${monthLabel(sel.month, true)}`;
    case "month-family":
      return `${FAMILY_META[sel.family].label} · ${monthLabel(sel.month, true)}`;
    case "family":
      return FAMILY_META[sel.family].label;
    case "target":
      return `Target: ${TARGET_META[sel.target].label}`;
    case "severity":
      return `Severity ${sel.severity} · ${SEVERITY_META[sel.severity].label}`;
    case "category":
      return CATEGORY_META[sel.category].label;
    case "type":
      return TYPE_META[sel.type].label;
    case "window":
      return "All incidents in view";
    case "real":
      return "Real-world incidents · severity 3–4";
    case "range":
      return sel.label;
    case "disclosed":
      return "Disclosed vulnerabilities";
    case "disclosed-month":
      return `Disclosed vulnerabilities · ${monthLabel(sel.month, true)}`;
    case "disclosed-product":
      return `Disclosed vulnerabilities · ${sel.product}`;
    case "disclosed-day":
      return `Disclosed vulnerabilities · ${sel.day}`;
    case "day":
      return dateLabel(sel.day);
    case "family-severity":
      return `${FAMILY_META[sel.family].label} · severity ${sel.severity}, ${SEVERITY_META[sel.severity].label}`;
    case "type-family":
      return `${TYPE_META[sel.type].label} → ${FAMILY_META[sel.family].label}`;
    case "family-target":
      return `${FAMILY_META[sel.family].label} → ${TARGET_META[sel.target].label}`;
    case "family-range":
      return `${FAMILY_META[sel.family].label} · ${sel.label}`;
  }
}

/** Query string for the same selection on the Incidents page. */
export function selectionQuery(sel: Selection, basis: Basis, field: DateField): string {
  const p = new URLSearchParams();
  if (basis === "real") p.set("real", "1");
  if (field === "first_reported") p.set("by", "reported");
  switch (sel.kind) {
    case "month":
      p.set("month", sel.month);
      break;
    case "month-category":
      p.set("month", sel.month);
      p.set("category", sel.category);
      break;
    case "month-type":
      p.set("month", sel.month);
      p.set("type", sel.type);
      break;
    case "month-family":
      p.set("month", sel.month);
      p.set("category", FAMILY_META[sel.family].categories.join(","));
      break;
    case "family":
      p.set("category", FAMILY_META[sel.family].categories.join(","));
      break;
    case "target":
      p.set("target", sel.target);
      break;
    case "severity":
      p.set("severity", String(sel.severity));
      break;
    case "category":
      p.set("category", sel.category);
      break;
    case "type":
      p.set("type", sel.type);
      break;
    case "window":
      break;
    case "real":
      p.set("real", "1");
      break;
    case "range":
      p.set("from", sel.from);
      p.set("to", sel.to);
      break;
    case "disclosed":
      p.set("kind", "disclosed");
      break;
    case "disclosed-month":
      p.set("kind", "disclosed");
      p.set("month", sel.month);
      break;
    case "disclosed-product":
      p.set("kind", "disclosed");
      p.set("product", sel.product);
      break;
    case "disclosed-day":
      p.set("kind", "disclosed");
      p.set("month", sel.day.slice(0, 7));
      break;
    case "day":
      p.set("month", sel.day.slice(0, 7));
      break;
    case "family-severity":
      p.set("category", FAMILY_META[sel.family].categories.join(","));
      p.set("severity", String(sel.severity));
      break;
    case "type-family":
      p.set("type", sel.type);
      p.set("category", FAMILY_META[sel.family].categories.join(","));
      break;
    case "family-target":
      p.set("category", FAMILY_META[sel.family].categories.join(","));
      p.set("target", sel.target);
      break;
    case "family-range":
      p.set("category", FAMILY_META[sel.family].categories.join(","));
      p.set("from", sel.from);
      p.set("to", sel.to);
      break;
  }
  return p.toString();
}

/** The months a selection draws rows from: its own range for a headline tile, the window for everything else. */
export function selectionMonths(sel: Selection, from: string, to: string): { from: string; to: string } {
  if (sel.kind === "family-range") return { from: sel.from, to: sel.to };
  if (sel.kind !== "range") return { from, to };
  if (sel.byYear) return { from: `${sel.from.slice(0, 4)}-01`, to: `${sel.to.slice(0, 4)}-12` };
  return { from: sel.from, to: sel.to };
}

/**
 * The pool a selection is taken from, before the click's own test: disclosed
 * vulnerabilities in the window for the disclosed panel; otherwise the basis
 * (all incidents, or real-world ones) in the window, except that a headline
 * tile reaches outside the window and reads the whole basis.
 */
export function inPool(r: CompactRow, sel: Selection, basis: Basis, field: DateField, from: string, to: string): boolean {
  if (isDisclosedSelection(sel)) {
    if (!r.disclosed) return false;
  } else {
    if (!inBasis(r, basis)) return false;
    if (sel.kind === "range" || sel.kind === "family-range") return true;
  }
  const k = windowKey(dateOf(r, field));
  return k >= from && k <= to;
}

/**
 * Whether a row is what was clicked. Monthly columns count rows that can be
 * placed in a month (monthKey), so a year-only incident date is in no column
 * and in no column's drawer; it is still in the window totals (windowKey).
 */
export function matches(r: CompactRow, s: Selection, field: DateField): boolean {
  const d = dateOf(r, field);
  const m = monthKey(d);
  switch (s.kind) {
    case "month":
      return m === s.month;
    case "month-category":
      return m === s.month && primaryCategory(r) === s.category;
    case "month-type":
      return m === s.month && r.type === s.type;
    case "month-family":
      return m === s.month && familyOf(primaryCategory(r)) === s.family;
    case "family":
      return familyOf(primaryCategory(r)) === s.family;
    case "target":
      return r.targets.includes(s.target);
    case "severity":
      return r.severity === s.severity;
    case "category":
      return primaryCategory(r) === s.category;
    case "type":
      return r.type === s.type;
    case "window":
      return true;
    case "real":
      return isRealWorld(r);
    case "disclosed":
      return true;
    case "disclosed-month":
      return m === s.month;
    case "disclosed-product":
      return r.product === s.product;
    case "disclosed-day":
      return d === s.day;
    case "day":
      return d === s.day;
    case "family-severity":
      return familyOf(primaryCategory(r)) === s.family && r.severity === s.severity;
    case "type-family":
      return r.type === s.type && familyOf(primaryCategory(r)) === s.family;
    case "family-target":
      return familyOf(primaryCategory(r)) === s.family && r.targets.includes(s.target);
    case "family-range": {
      // Window membership, like the family totals: a year-only date sits in July of its year.
      const k = windowKey(d);
      return familyOf(primaryCategory(r)) === s.family && k >= s.from && k <= s.to;
    }
    case "range": {
      // Mirrors headline(): month tiles skip year-only dates, year tiles keep them; toDate caps "same period last year".
      if (s.byYear) return d.slice(0, 4) >= s.from.slice(0, 4) && d.slice(0, 4) <= s.to.slice(0, 4) && (!s.toDate || d <= s.toDate);
      return m !== null && m >= s.from && m <= s.to;
    }
  }
}

/** The rows behind a clicked number. */
export function selectRows(rows: readonly CompactRow[], sel: Selection, basis: Basis, field: DateField, from: string, to: string): CompactRow[] {
  return rows.filter((r) => inPool(r, sel, basis, field, from, to) && matches(r, sel, field));
}

export type HeadlinePicks = Record<"thisMonth" | "lastMonth" | "trailing12" | "prior12" | "ytd" | "lastYtd", Selection>;

/** Selections behind every headline number, so each one opens its incidents. */
export function headlinePicks(h: Pick<Headline, "thisMonthKey" | "lastMonthKey">, now: Date): HeadlinePicks {
  const year = now.getUTCFullYear();
  const today = now.toISOString().slice(0, 10);
  const range = (from: string, to: string, label: string, extra: Partial<Extract<Selection, { kind: "range" }>> = {}): Selection => ({ kind: "range", from, to, label, ...extra });
  return {
    thisMonth: range(h.thisMonthKey, h.thisMonthKey, `${monthLabel(h.thisMonthKey, true)} so far`),
    lastMonth: range(h.lastMonthKey, h.lastMonthKey, monthLabel(h.lastMonthKey, true)),
    trailing12: range(shiftMonth(h.thisMonthKey, -11), h.thisMonthKey, "Trailing 12 months"),
    prior12: range(shiftMonth(h.thisMonthKey, -23), shiftMonth(h.thisMonthKey, -12), "The 12 months before that"),
    ytd: range(`${year}-01`, h.thisMonthKey, `${year} to date`, { byYear: true }),
    lastYtd: range(`${year - 1}-01`, `${year - 1}-12`, `${year - 1}, same period`, { byYear: true, toDate: `${year - 1}${today.slice(4)}` }),
  };
}
