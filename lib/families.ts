import type { Category } from "./taxonomy";

/**
 * Category families: the 14 categories grouped into 7 readable families plus
 * "other" for charts that stack or compare categories. Badges, filters and
 * the dataset keep the full 14; charts use families so a stacked view never
 * needs more than 7 hues (the 14-hue palette failed CVD and lightness checks).
 *
 * Order is the stacking order and the order the palettes were validated in.
 */
export const FAMILIES = ["injection", "infra", "exposure", "agent", "supply", "social", "offense", "other"] as const;
export type Family = (typeof FAMILIES)[number];

export const FAMILY_META: Record<Family, { label: string; short: string; categories: Category[] }> = {
  injection: { label: "Prompt injection & jailbreaks", short: "Injection", categories: ["prompt_injection", "jailbreak"] },
  infra: { label: "Infrastructure vulnerabilities", short: "Infra vulns", categories: ["infra_vuln"] },
  exposure: { label: "Data & model exposure", short: "Exposure", categories: ["data_leak", "model_theft_extraction"] },
  agent: { label: "Agent hijacking", short: "Agent hijack", categories: ["agent_hijack"] },
  supply: { label: "Supply chain & poisoning", short: "Supply chain", categories: ["supply_chain", "data_poisoning", "adversarial_evasion"] },
  social: { label: "Deepfakes & social engineering", short: "Deepfake/social", categories: ["deepfake_fraud", "ai_phishing_social_engineering"] },
  offense: { label: "AI-powered offense", short: "AI offense", categories: ["ai_generated_malware", "ai_assisted_intrusion"] },
  // `general` (no AI role) files here too: the family charts only ever see AI records (lib/counting.ts aiLens).
  other: { label: "Other", short: "Other", categories: ["other", "general"] },
};

const BY_CATEGORY = new Map<Category, Family>();
for (const f of FAMILIES) for (const c of FAMILY_META[f].categories) BY_CATEGORY.set(c, f);

export function familyOf(category: Category): Family {
  return BY_CATEGORY.get(category) ?? "other";
}

/** Validated with the dataviz palette checks on #090c15 (dark): band, chroma, CVD, normal vision, contrast all pass. */
export const FAMILY_COLORS: Record<Family, string> = {
  injection: "#b48500",
  infra: "#3a97cf",
  exposure: "#cd639e",
  agent: "#779d24",
  supply: "#887ede",
  social: "#d86844",
  offense: "#00a697",
  other: "#5b6478",
};
