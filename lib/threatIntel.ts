import type { CompactRow } from "./rows";
import { isRealWorld, latest } from "./stats";
import type { Category, Target } from "./taxonomy";

/** How far back the hero's threat feed looks, by first-report date. */
export const INTEL_DAYS = 90;
/** At most this many categories carry a rising tag. */
const MAX_RISING = 3;

export interface ThreatKind {
  category: Category;
  /** Incidents of this category first reported in the window. */
  count: number;
  /** The same for the window before it. */
  prior: number;
  /** Share of them with confirmed exploitation or loss (severity 3-4). */
  harm: number;
  /** What they hit, most hit first ("n/a" left out). */
  targets: { target: Target; count: number }[];
  /** Among the fastest growers against the window before. */
  rising: boolean;
}

export interface IntelCase {
  date: string;
  category: Category;
  target: Target | null;
  title: string;
  slug: string;
}

/**
 * The hero's threat feed: what was first reported over the last
 * INTEL_DAYS days. Incidents only (disclosed vulnerabilities never count,
 * lib/counting.ts); an incident with two categories counts once in each.
 */
export interface ThreatIntel {
  days: number;
  /** First and last day of the window, inclusive. */
  from: string;
  to: string;
  /** Distinct incidents in the window. */
  total: number;
  /** Share of them at severity 3-4. */
  harm: number;
  /** Categories seen in the window, most frequent first ("other" left out). */
  kinds: ThreatKind[];
  /** The latest real-world incidents (severity 3-4), newest first. */
  latest: IntelCase[];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBefore(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86_400_000);
}

export function buildThreatIntel(rows: readonly CompactRow[], now: Date, latestCount = 8): ThreatIntel {
  const to = isoDay(now);
  const from = isoDay(daysBefore(now, INTEL_DAYS - 1));
  const priorFrom = isoDay(daysBefore(now, 2 * INTEL_DAYS - 1));
  const incidents = rows.filter((r) => !r.disclosed);
  const current = incidents.filter((r) => r.first_reported >= from && r.first_reported <= to);
  const before = incidents.filter((r) => r.first_reported >= priorFrom && r.first_reported < from);

  const tally = new Map<Category, { count: number; harmed: number; prior: number; targets: Map<Target, number> }>();
  const entry = (c: Category) => {
    let e = tally.get(c);
    if (!e) {
      e = { count: 0, harmed: 0, prior: 0, targets: new Map() };
      tally.set(c, e);
    }
    return e;
  };
  for (const r of current) {
    for (const c of new Set(r.categories)) {
      if (c === "other") continue;
      const e = entry(c);
      e.count += 1;
      if (isRealWorld(r)) e.harmed += 1;
      for (const t of new Set(r.targets)) if (t !== "n/a") e.targets.set(t, (e.targets.get(t) ?? 0) + 1);
    }
  }
  for (const r of before) for (const c of new Set(r.categories)) if (c !== "other" && tally.has(c)) entry(c).prior += 1;

  const kinds: ThreatKind[] = [...tally.entries()]
    .map(([category, e]) => ({
      category,
      count: e.count,
      prior: e.prior,
      harm: e.count ? e.harmed / e.count : 0,
      targets: [...e.targets.entries()].map(([target, count]) => ({ target, count })).sort((a, b) => b.count - a.count || a.target.localeCompare(b.target)),
      rising: false,
    }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  // rising: at least three this window and half again as many as before; ranked by the jump measured
  // against the noise a count that size carries, so 9 -> 21 outranks 1 -> 3
  const growth = (k: ThreatKind) => (k.count - k.prior) / Math.sqrt(k.prior + 1);
  kinds
    .filter((k) => k.count >= 3 && k.count >= 1.5 * k.prior)
    .sort((a, b) => growth(b) - growth(a) || b.count - a.count)
    .slice(0, MAX_RISING)
    .forEach((k) => {
      k.rising = true;
    });

  return {
    days: INTEL_DAYS,
    from,
    to,
    total: current.length,
    harm: current.length ? current.filter(isRealWorld).length / current.length : 0,
    kinds,
    latest: latest(current.filter(isRealWorld), latestCount).map((r) => ({
      date: r.first_reported,
      category: r.categories[0] ?? "other",
      target: r.targets.find((t) => t !== "n/a") ?? null,
      title: r.title,
      slug: r.slug,
    })),
  };
}
