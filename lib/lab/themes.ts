import { FAMILY_COLORS, type Family } from "../families";
import type { IncidentType, Severity } from "../taxonomy";

/**
 * Chart palettes for the design-lab drafts. Every categorical set passed the
 * dataviz validator (scripts/validate_palette.js) against its own surface;
 * severity ramps passed the ordinal checks (one hue, monotone lightness).
 */
export interface LabTheme {
  name: string;
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

export const AMBER: LabTheme = {
  name: "amber",
  surface: "#090c15",
  grid: "rgba(140,160,210,0.12)",
  axis: "#8491ae",
  ink: "#e2e8f5",
  dim: "#8491ae",
  accent: "#ffb35c",
  bar: "#3a97cf",
  trend: "#ffb35c",
  provisional: "rgba(140,160,210,0.07)",
  families: FAMILY_COLORS,
  types: { attack_on_ai: "#c48225", ai_enabled_attack: "#32a0c5" },
  severity: { 1: "#5f482e", 2: "#a06f30", 3: "#e29936", 4: "#ffc858" },
};

export const PHOSPHOR: LabTheme = {
  name: "phosphor",
  surface: "#06120b",
  grid: "rgba(86,244,135,0.12)",
  axis: "#3fa865",
  ink: "#8dfdb0",
  dim: "#3fa865",
  accent: "#ffb35c",
  bar: "#43b966",
  trend: "#ffb35c",
  provisional: "rgba(86,244,135,0.06)",
  families: FAMILY_COLORS,
  types: { attack_on_ai: "#36a558", ai_enabled_attack: "#9a76d4" },
  severity: { 1: "#295233", 2: "#3b834e", 3: "#43b966", 4: "#56f487" },
};

export const ICE: LabTheme = {
  ...AMBER,
  name: "ice",
  surface: "#070a12",
  bar: "#3a97cf",
  trend: "#ffb35c",
};
