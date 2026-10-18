import type { Category, IncidentType, Severity } from "./taxonomy";

/**
 * The one palette. Every chart, legend and badge imports from here so the
 * same category is always the same colour everywhere on the site and in the
 * OG images. Values mirror the CSS variables in app/globals.css.
 */

export const UI = {
  ground: "#04050a",
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

export const TYPE_COLORS: Record<IncidentType, string> = {
  attack_on_ai: "#ffb35c",
  ai_enabled_attack: "#7fdcff",
};

export const SEVERITY_COLORS: Record<Severity, string> = {
  1: "#4b556e",
  2: "#7b9dff",
  3: "#ff9b6b",
  4: "#ff6b6b",
};

export const CATEGORY_COLORS: Record<Category, string> = {
  prompt_injection: "#ffd166",
  jailbreak: "#ff9b6b",
  agent_hijack: "#b4e35f",
  data_leak: "#ff86c8",
  model_theft_extraction: "#6fc6ff",
  supply_chain: "#d48cff",
  data_poisoning: "#a59cff",
  adversarial_evasion: "#7b9dff",
  infra_vuln: "#ff6b6b",
  deepfake_fraud: "#7fe8a8",
  ai_generated_malware: "#3fd6c6",
  ai_phishing_social_engineering: "#ffb35c",
  ai_assisted_intrusion: "#c3cbe0",
  other: "#4b556e",
};

/** Sequential ramp for single-series bars (targets, publishers). */
export const BAR_COLOR = "#7b9dff";
export const TREND_COLOR = UI.accent;
export const PROVISIONAL_FILL = "rgba(140,160,210,0.07)";
