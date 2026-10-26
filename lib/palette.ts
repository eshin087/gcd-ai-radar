import { FAMILY_COLORS, familyOf } from "./families";
import { CATEGORIES, type Category, type IncidentType, type Severity } from "./taxonomy";

/**
 * The one palette. Every chart, legend and badge imports from here so the
 * same category is always the same colour everywhere on the site and in the
 * OG images. Values mirror the CSS variables in app/globals.css.
 */

export const UI = {
  ground: "#05070d",
  panel: "rgba(5,7,14,0.66)",
  line: "rgba(140,160,210,0.22)",
  ink: "#e2e8f5",
  soft: "#c3cbe0",
  dim: "#8491ae",
  faint: "#4b556e",
  accent: "#ffb35c",
  accentTint: "rgba(255,179,92,0.13)",
  grid: "rgba(140,160,210,0.10)",
} as const;

/** Validated pair on the dark surface (dataviz checks). */
export const TYPE_COLORS: Record<IncidentType, string> = {
  attack_on_ai: "#c48225",
  ai_enabled_attack: "#32a0c5",
  // No AI role: a neutral slate; it never appears in a chart (the AI lens keeps it out), only on badges.
  not_ai: "#6b7389",
};

/** Severity as a status: research and disclosed records in quiet tones, exploitation and real-world loss in the live reds (mirrors --color-sev-* in globals.css). */
export const SEVERITY_COLORS: Record<Severity, string> = {
  1: "#6b7389",
  2: "#7b9dff",
  3: "#ff9b3d",
  4: "#ff5c5c",
};

/** Each category wears its family's colour (lib/families.ts): 7 validated hues instead of 14 that failed CVD checks. */
export const CATEGORY_COLORS = Object.fromEntries(CATEGORIES.map((c) => [c, FAMILY_COLORS[familyOf(c)]])) as Record<Category, string>;

/** Single-series bars (targets, publishers). */
export const BAR_COLOR = "#3a97cf";
export const TREND_COLOR = UI.accent;
export const PROVISIONAL_FILL = "rgba(140,160,210,0.07)";
