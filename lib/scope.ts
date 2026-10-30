import { FAMILIES, familyOf, type Family } from "./families";
import type { CompactRow } from "./rows";
import { isRealWorld } from "./stats";
import type { Severity } from "./taxonomy";

/** How far back the hero's radar scope looks, by first-report date. */
export const SCOPE_DAYS = 120;
/** Where prebuild writes the scope for the home page, which fetches its blips instead of carrying them. */
export const SCOPE_FILE = "/stats/scope.json";
/**
 * At most this many blips: every real-world incident in the window, then the
 * newest of the rest. Keeps SCOPE_FILE bounded once live collection fills the
 * window with research write-ups.
 */
export const MAX_BLIPS = 360;

export interface ScopeBlip {
  slug: string;
  title: string;
  severity: Severity;
  /** Family of the first category (lib/families.ts): the wedge the blip sits in. */
  family: Family;
  /** Whole days from first report to the build day: the distance from the centre. */
  age: number;
}

/**
 * The hero's radar scope: every incident first reported in the last
 * SCOPE_DAYS days, as a blip placed by attack family and age. Incidents only
 * (disclosed vulnerabilities never count, lib/counting.ts). Independent of the
 * dashboard's window and toggles, like the threat feed it replaced.
 */
export interface Scope {
  days: number;
  /** Incidents first reported in the window, before the blip cap. */
  total: number;
  /** The wedges in order: the seven families always, "other" only when a blip needs it. */
  wedges: Family[];
  /** Newest first. */
  blips: ScopeBlip[];
}

/**
 * The scope without its blips, for a page that fetches them from SCOPE_FILE:
 * the caption's numbers and the wedges, so the frame draws at once and
 * nothing moves when the blips arrive.
 */
export type ScopeHead = Omit<Scope, "blips">;

const DAY_MS = 86_400_000;

export function buildScope(rows: readonly CompactRow[], now: Date): Scope {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const inWindow = rows
    .filter((r) => !r.disclosed)
    .map((r) => ({ r, age: Math.round((today - Date.parse(`${r.first_reported.slice(0, 10)}T00:00:00Z`)) / DAY_MS) }))
    .filter(({ age }) => age >= 0 && age < SCOPE_DAYS)
    .sort((a, b) => a.age - b.age || b.r.severity - a.r.severity || a.r.slug.localeCompare(b.r.slug));
  const real = inWindow.filter(({ r }) => isRealWorld(r)).slice(0, MAX_BLIPS);
  const keep = new Set([...real, ...inWindow.filter(({ r }) => !isRealWorld(r)).slice(0, MAX_BLIPS - real.length)]);
  const blips = inWindow
    .filter((e) => keep.has(e))
    .map(({ r, age }) => ({ slug: r.slug, title: r.title, severity: r.severity, family: familyOf(r.categories[0] ?? "other"), age }));
  return {
    days: SCOPE_DAYS,
    total: inWindow.length,
    wedges: FAMILIES.filter((f) => f !== "other" || blips.some((b) => b.family === "other")),
    blips,
  };
}
