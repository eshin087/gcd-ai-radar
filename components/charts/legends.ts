import { CATEGORY_COLORS, SEVERITY_COLORS, TYPE_COLORS } from "@/lib/palette";
import { CATEGORIES, CATEGORY_META, INCIDENT_TYPES, SEVERITIES, SEVERITY_META, TYPE_META, type Category } from "@/lib/taxonomy";
import type { LegendItem } from "./Legend";

/** Legend item builders. Plain module (no "use client") so server pages can call them. */

export function categoryLegend(categories: readonly Category[] = CATEGORIES, counts?: Partial<Record<Category, number>>): LegendItem[] {
  return categories.map((c) => ({
    key: c,
    label: CATEGORY_META[c].short,
    color: CATEGORY_COLORS[c],
    value: counts?.[c],
  }));
}

export const typeLegend: LegendItem[] = INCIDENT_TYPES.map((t) => ({
  key: t,
  label: TYPE_META[t].label,
  color: TYPE_COLORS[t],
}));

export const severityLegend: LegendItem[] = SEVERITIES.map((s) => ({
  key: String(s),
  label: `${s} ${SEVERITY_META[s].short}`,
  color: SEVERITY_COLORS[s],
}));
