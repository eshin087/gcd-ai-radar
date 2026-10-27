import { familyOf, type Family } from "./families";
import type { CompactRow } from "./rows";
import { isRealWorld } from "./stats";
import { TARGET_META, type Severity, type Target } from "./taxonomy";

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
  /** What was hit, in reading case, for the middle column's caption: the first named product, else the target. Empty when neither is known. */
  hit: string;
  /**
   * The same for the target lock's pixel letters: upper case, at most
   * LOCK_CHARS characters the pixel font has (A-Z, 0-9, . - + / &). Empty when
   * nothing usable is known; the column then spells the family.
   */
  lock: string;
  /** The first CVE the record names, if any. */
  cve: string | null;
}

/** A compact row, plus the record's first CVE when the caller has it (lib/live.ts does). */
export type ScopeRow = CompactRow & { cve?: string | null };

/** The most pixel letters the 280 px middle column fits. */
export const LOCK_CHARS = 10;

/** Product names the classifier uses for a kind of system rather than a product: they say nothing as a target. */
const GENERIC_PRODUCT = /^(ai (coding )?agents?|llm agents?|llms?|ai models?|open[- ]weight models?|frontier llms?|chatbots?)$/i;
/** Short names for the targets that are not vendors. */
const TARGET_LOCK: Partial<Record<Target, string>> = {
  open_weight_model: "OPEN MODEL",
  framework_or_tooling: "AI TOOLING",
  enterprise_deployment: "ENTERPRISE",
  individual_victims: "PEOPLE",
};

export const lockText = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9.\-+/& ]/g, "")
    .trim()
    .slice(0, LOCK_CHARS)
    .trim();

function hitOf(r: CompactRow): { hit: string; lock: string } {
  const product = (r.products ?? []).find((p) => p && !GENERIC_PRODUCT.test(p.trim()));
  if (product) {
    const lock = lockText(product.split(/\s+/)[0] ?? "");
    if (lock) return { hit: product, lock };
  }
  const target = r.targets.find((t) => t !== "n/a");
  if (target) return { hit: TARGET_META[target].label, lock: TARGET_LOCK[target] ?? lockText(TARGET_META[target].label) };
  return { hit: product ?? "", lock: "" };
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

export function buildScope(rows: readonly ScopeRow[], now: Date): Scope {
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
      .map(({ r, age }) => ({ slug: r.slug, title: r.title, severity: r.severity, family: familyOf(r.categories[0] ?? "other"), age, ...hitOf(r), cve: r.cve ?? null })),
  };
}
