import { familyOf, type Family } from "./families";
import type { CompactRow } from "./rows";
import { isRealWorld } from "./stats";
import type { Severity } from "./taxonomy";

/** How far back the hero's radar scope looks, by first-report date. */
export const SCOPE_DAYS = 120;
/**
 * At most this many blips ship with the page: every real-world incident in the
 * window, then the newest of the rest. Keeps the hero's payload bounded once
 * live collection fills the window with research write-ups.
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
  /** Newest first. */
  blips: ScopeBlip[];
}

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
  return {
    days: SCOPE_DAYS,
    total: inWindow.length,
    blips: inWindow
      .filter((e) => keep.has(e))
      .map(({ r, age }) => ({ slug: r.slug, title: r.title, severity: r.severity, family: familyOf(r.categories[0] ?? "other"), age })),
  };
}
