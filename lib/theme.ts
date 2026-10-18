import { FAMILY_COLORS, type Family } from "./families";
import { SEVERITY_COLORS, TYPE_COLORS, UI } from "./palette";
import type { IncidentType, Severity } from "./taxonomy";

/**
 * Chart theme for the dashboard. The categorical sets passed the dataviz
 * validator (validate_palette.js) against the dark surface; the severity ramp
 * passed the ordinal checks (one hue, monotone lightness).
 */
export interface ChartTheme {
  surface: string;
  grid: string;
  axis: string;
  ink: string;
  dim: string;
  accent: string;
  bar: string;
  trend: string;
  provisional: string;
  families: Record<Family, string>;
  types: Record<IncidentType, string>;
  severity: Record<Severity, string>;
}

export const THEME: ChartTheme = {
  surface: "#070a12",
  grid: "rgba(140,160,210,0.12)",
  axis: UI.dim,
  ink: UI.ink,
  dim: UI.dim,
  accent: UI.accent,
  bar: "#3a97cf",
  trend: UI.accent,
  provisional: "rgba(140,160,210,0.07)",
  families: FAMILY_COLORS,
  types: TYPE_COLORS,
  severity: SEVERITY_COLORS,
};
