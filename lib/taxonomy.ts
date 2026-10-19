/**
 * Controlled vocabularies for gcd AI Radar.
 *
 * This file is the single source of truth for the incident taxonomy. It is
 * imported by the Zod schema (validation), the collector prompts (so the
 * classifier sees the same definitions humans read), the charts (ordering and
 * labels) and the Methodology page (definitions rendered verbatim).
 */

export const INCIDENT_TYPES = ["attack_on_ai", "ai_enabled_attack"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const TYPE_META: Record<
  IncidentType,
  { label: string; short: string; definition: string }
> = {
  attack_on_ai: {
    label: "Attack on AI",
    short: "on AI",
    definition:
      "An AI model, agent or AI-powered product was the thing exploited, abused or leaked.",
  },
  ai_enabled_attack: {
    label: "AI-enabled attack",
    short: "by AI",
    definition:
      "Attackers used AI as a meaningful part of a cyberattack against someone else.",
  },
};

export const CATEGORIES = [
  "prompt_injection",
  "jailbreak",
  "agent_hijack",
  "data_leak",
  "model_theft_extraction",
  "supply_chain",
  "data_poisoning",
  "adversarial_evasion",
  "infra_vuln",
  "deepfake_fraud",
  "ai_generated_malware",
  "ai_phishing_social_engineering",
  "ai_assisted_intrusion",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_META: Record<
  Category,
  { label: string; short: string; definition: string }
> = {
  prompt_injection: {
    label: "Prompt injection",
    short: "Prompt inj.",
    definition:
      "Untrusted content (web pages, documents, emails, tool output) steers a model into ignoring its instructions.",
  },
  jailbreak: {
    label: "Jailbreak",
    short: "Jailbreak",
    definition:
      "A user deliberately bypasses a model's safety or policy controls through crafted prompts.",
  },
  agent_hijack: {
    label: "Agent hijack",
    short: "Agent hijack",
    definition:
      "An AI agent is tricked into unauthorized actions: tool misuse, data exfiltration through the agent, or acting against its principal.",
  },
  data_leak: {
    label: "Data leak",
    short: "Data leak",
    definition:
      "Training data, chat logs, system prompts, model weights or other AI-system data exposed.",
  },
  model_theft_extraction: {
    label: "Model theft / extraction",
    short: "Model theft",
    definition:
      "Weights stolen, or model behaviour replicated through extraction or distillation attacks.",
  },
  supply_chain: {
    label: "Supply chain",
    short: "Supply chain",
    definition:
      "Malicious or backdoored models, poisoned packages, unsafe deserialization and other compromised AI dependencies.",
  },
  data_poisoning: {
    label: "Data poisoning",
    short: "Poisoning",
    definition:
      "Training or retrieval data manipulated to change model behaviour.",
  },
  adversarial_evasion: {
    label: "Adversarial evasion",
    short: "Evasion",
    definition:
      "Inputs crafted to make a model misclassify or miss detections (perturbations, evasion of AI-based defences).",
  },
  infra_vuln: {
    label: "Infrastructure vulnerability",
    short: "Infra vuln",
    definition:
      "CVEs and advisories in AI frameworks, inference servers, MCP servers, AI developer tools and hosting stacks.",
  },
  deepfake_fraud: {
    label: "Deepfake fraud",
    short: "Deepfake",
    definition:
      "Synthetic voice, video or images used to impersonate people for fraud, extortion or access.",
  },
  ai_generated_malware: {
    label: "AI-generated malware",
    short: "AI malware",
    definition:
      "Malware written, adapted or operated with meaningful help from AI models.",
  },
  ai_phishing_social_engineering: {
    label: "AI phishing / social engineering",
    short: "AI phishing",
    definition:
      "Phishing, lures and social engineering produced or personalised at scale with AI.",
  },
  ai_assisted_intrusion: {
    label: "AI-assisted intrusion",
    short: "AI intrusion",
    definition:
      "Threat actors using AI tooling in reconnaissance, exploitation, lateral movement or operations.",
  },
  other: {
    label: "Other",
    short: "Other",
    definition:
      "In scope, but none of the categories above fits. Reviewed periodically for new categories.",
  },
};

export const SEVERITIES = [1, 2, 3, 4] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_META: Record<
  Severity,
  { label: string; short: string; definition: string }
> = {
  1: {
    label: "Research / proof of concept",
    short: "Research",
    definition:
      "Demonstrated by researchers; no known real-world exploitation.",
  },
  2: {
    label: "Disclosed vulnerability",
    short: "Disclosed",
    definition:
      "CVE or vendor advisory, patched or patchable, no confirmed exploitation.",
  },
  3: {
    label: "Confirmed exploitation",
    short: "Exploited",
    definition:
      "Used against real targets; limited or unclear impact.",
  },
  4: {
    label: "Confirmed real-world loss",
    short: "Real loss",
    definition:
      "Financial loss, PHI/PII breach, safety impact or regulatory action.",
  },
};

/** Severity at or above this value counts as a real-world incident. */
export const REAL_WORLD_MIN_SEVERITY: Severity = 3;

export const TARGETS = [
  "OpenAI",
  "Anthropic",
  "Google",
  "Microsoft",
  "Meta",
  "Mistral",
  "xAI",
  "Amazon",
  "Apple",
  "open_weight_model",
  "framework_or_tooling",
  "enterprise_deployment",
  "individual_victims",
  "n/a",
] as const;
export type Target = (typeof TARGETS)[number];

export const TARGET_META: Record<Target, { label: string; definition: string }> = {
  OpenAI: { label: "OpenAI", definition: "OpenAI models, APIs or products (ChatGPT, Codex, Operator)." },
  Anthropic: { label: "Anthropic", definition: "Anthropic models or products (Claude, Claude Code)." },
  Google: { label: "Google", definition: "Google or DeepMind models and products (Gemini, Workspace AI)." },
  Microsoft: { label: "Microsoft", definition: "Microsoft AI products (Copilot, Azure AI, Bing Chat)." },
  Meta: { label: "Meta", definition: "Meta AI models and products (Llama as a service, Meta AI)." },
  Mistral: { label: "Mistral", definition: "Mistral models or products." },
  xAI: { label: "xAI", definition: "xAI models or products (Grok)." },
  Amazon: { label: "Amazon", definition: "Amazon AI products (Bedrock, Q, Alexa+)." },
  Apple: { label: "Apple", definition: "Apple Intelligence and related products." },
  open_weight_model: {
    label: "Open-weight model",
    definition: "A self-hosted or open-weight model family (Llama, Qwen, DeepSeek, Mistral weights…) as the target.",
  },
  framework_or_tooling: {
    label: "Framework / tooling",
    definition: "LangChain, vLLM, Ollama, MCP servers, Open WebUI, Langflow, Hugging Face libraries and similar.",
  },
  enterprise_deployment: {
    label: "Enterprise deployment",
    definition: "A company's own AI deployment (internal copilot, customer chatbot, RAG system).",
  },
  individual_victims: {
    label: "Individuals",
    definition: "People targeted directly, typically by AI-enabled fraud or harassment.",
  },
  "n/a": { label: "Not applicable", definition: "No identifiable target vendor or product." },
};

export const STATUSES = ["published", "review", "rejected"] as const;
export type Status = (typeof STATUSES)[number];

export const ORIGINS = [
  "seed_aiid",
  "seed_atlas",
  "seed_avid",
  "seed_nvd",
  "seed_ghsa",
  "news",
  "manual",
] as const;
export type Origin = (typeof ORIGINS)[number];

export const ORIGIN_META: Record<Origin, { label: string }> = {
  seed_aiid: { label: "AI Incident Database" },
  seed_atlas: { label: "MITRE ATLAS" },
  seed_avid: { label: "AVID" },
  seed_nvd: { label: "NVD" },
  seed_ghsa: { label: "GitHub Advisory Database" },
  news: { label: "News & research feeds" },
  manual: { label: "Manual" },
};

export const DATE_PRECISIONS = ["day", "month", "year"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/*
 * Standards mapping: OWASP Top 10 for LLM Applications and MITRE ATLAS.
 *
 * Each incident is also expressed in two public vocabularies so teams can
 * filter and cite in their own terms. The mapping is derived from a record's
 * type and categories through the table below. It is never classified per
 * record, so every record with the same type and categories gets the same
 * answer and nothing needs re-classifying when the table changes.
 *
 * The rule for a row: an entry is listed only when the category, as defined
 * in CATEGORY_META, falls within what the entry itself describes. A category
 * that straddles several entries, or fits none, maps to nothing rather than
 * to a guess, and the row says why. The Methodology page renders this table.
 *
 * Verified 2026-10-18 against genai.owasp.org/llm-top-10 (2025 edition,
 * CC BY-SA 4.0, OWASP Foundation) and ATLAS data release 2026.09
 * (github.com/mitre-atlas/atlas-data, Apache 2.0, © 2021-2026 The MITRE Corporation).
 */

export const OWASP_LLM_EDITION = "2025";
export const OWASP_LLM_IDS = ["LLM01", "LLM02", "LLM03", "LLM04", "LLM05", "LLM06", "LLM07", "LLM08", "LLM09", "LLM10"] as const;
export type OwaspLlmId = (typeof OWASP_LLM_IDS)[number];

/** Names and official entry pages as published for the 2025 edition (the slugs are OWASP's own, including LLM01's shorter one). */
export const OWASP_LLM_META: Record<OwaspLlmId, { name: string; url: string }> = {
  LLM01: { name: "Prompt Injection", url: "https://genai.owasp.org/llmrisk/llm01-prompt-injection/" },
  LLM02: { name: "Sensitive Information Disclosure", url: "https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/" },
  LLM03: { name: "Supply Chain", url: "https://genai.owasp.org/llmrisk/llm032025-supply-chain/" },
  LLM04: { name: "Data and Model Poisoning", url: "https://genai.owasp.org/llmrisk/llm042025-data-and-model-poisoning/" },
  LLM05: { name: "Improper Output Handling", url: "https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/" },
  LLM06: { name: "Excessive Agency", url: "https://genai.owasp.org/llmrisk/llm062025-excessive-agency/" },
  LLM07: { name: "System Prompt Leakage", url: "https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/" },
  LLM08: { name: "Vector and Embedding Weaknesses", url: "https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/" },
  LLM09: { name: "Misinformation", url: "https://genai.owasp.org/llmrisk/llm092025-misinformation/" },
  LLM10: { name: "Unbounded Consumption", url: "https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/" },
};

/** The full citation form, as OWASP writes it: "LLM01:2025". */
export function owaspLabel(id: OwaspLlmId): string {
  return `${id}:${OWASP_LLM_EDITION}`;
}

export const ATLAS_RELEASE = "2026.09";

/**
 * The ATLAS techniques the table uses, with their names in that release.
 * Sub-techniques carry their parent's name first, as atlas.mitre.org titles them.
 */
export const ATLAS_TECHNIQUES = {
  "AML.T0010": "AI Supply Chain Compromise",
  "AML.T0015": "Evade AI Model",
  "AML.T0016.002": "Obtain Capabilities: Generative AI",
  "AML.T0043": "Craft Adversarial Data",
  "AML.T0048.004": "External Harms: AI Intellectual Property Theft",
  "AML.T0051": "LLM Prompt Injection",
  "AML.T0052": "Phishing",
  "AML.T0053": "AI Agent Tool Invocation",
  "AML.T0054": "LLM Jailbreak",
  "AML.T0073": "Impersonation",
  "AML.T0088": "Generate Deepfakes",
} as const;
export type AtlasTechniqueId = keyof typeof ATLAS_TECHNIQUES;
export const ATLAS_TECHNIQUE_IDS = (Object.keys(ATLAS_TECHNIQUES) as AtlasTechniqueId[]).sort();

export function atlasUrl(id: AtlasTechniqueId): string {
  return `https://atlas.mitre.org/techniques/${id}`;
}

export interface StandardsRow {
  owasp: readonly OwaspLlmId[];
  atlas: readonly AtlasTechniqueId[];
  /** One or two sentences: why these entries, or why none. Rendered on the Methodology page. */
  why: string;
}

export const STANDARDS_BY_CATEGORY: Record<Category, StandardsRow> = {
  prompt_injection: {
    owasp: ["LLM01"],
    atlas: ["AML.T0051"],
    why: "The same concept in both frameworks, direct and indirect.",
  },
  jailbreak: {
    owasp: ["LLM01"],
    atlas: ["AML.T0054"],
    why: "OWASP treats jailbreaking as a form of prompt injection; ATLAS gives it its own technique.",
  },
  agent_hijack: {
    owasp: ["LLM06"],
    atlas: ["AML.T0053"],
    why: "Excessive Agency is the weakness that lets manipulated or malfunctioning model output cause damaging actions, and AI Agent Tool Invocation is the act. Prompt injection is a common trigger but not the only one, so LLM01 is not added.",
  },
  data_leak: {
    owasp: ["LLM02"],
    atlas: [],
    why: "Sensitive Information Disclosure is the closest OWASP entry; OWASP describes it mostly through model output, while some records here are storage misconfigurations. No ATLAS technique: the category mixes misconfigured storage, application bugs and prompt-induced leakage, and LLM Data Leakage (AML.T0057) covers only the last.",
  },
  model_theft_extraction: {
    owasp: ["LLM10"],
    atlas: ["AML.T0048.004"],
    why: "The 2025 list folded model theft into Unbounded Consumption (model extraction through the API, functional replication). ATLAS AI Intellectual Property Theft covers stolen and extracted models alike; Extract AI Model (AML.T0024.002) is not added because some records are stolen weights.",
  },
  supply_chain: {
    owasp: ["LLM03"],
    atlas: ["AML.T0010"],
    why: "The same concept in both frameworks: compromised models, packages and other AI dependencies.",
  },
  data_poisoning: {
    owasp: ["LLM04"],
    atlas: [],
    why: "LLM04 covers pre-training, fine-tuning and embedding data. ATLAS separates training-data poisoning (AML.T0020) from RAG poisoning (AML.T0070) and the records do not say which, so neither is derived.",
  },
  adversarial_evasion: {
    owasp: [],
    atlas: ["AML.T0015", "AML.T0043"],
    why: "Inputs crafted to make a model misclassify are Craft Adversarial Data used to Evade AI Model. The OWASP LLM list has no entry for classifier evasion; that lives in OWASP's separate Machine Learning Security Top 10.",
  },
  infra_vuln: {
    owasp: ["LLM03"],
    atlas: [],
    why: "LLM03 names vulnerable third-party packages as its first example, and a CVE in an AI framework, inference server or MCP server is that risk for the teams who deploy it. No ATLAS technique: ATLAS describes what attackers do, and a vulnerability record does not say how the flaw was or would be exploited.",
  },
  deepfake_fraud: {
    owasp: [],
    atlas: ["AML.T0088", "AML.T0073"],
    why: "Generate Deepfakes, used for Impersonation. No OWASP entry: no LLM application is the vulnerable party.",
  },
  ai_generated_malware: {
    owasp: [],
    atlas: ["AML.T0016.002"],
    why: "ATLAS lists obtaining generative AI to write malware under Obtain Capabilities. No OWASP entry: the AI is the attacker's tool, not the vulnerable system.",
  },
  ai_phishing_social_engineering: {
    owasp: [],
    atlas: ["AML.T0052"],
    why: "ATLAS Phishing, whose description covers generative AI scaling phishing campaigns. No OWASP entry: the AI is the attacker's tool, not the vulnerable system.",
  },
  ai_assisted_intrusion: {
    owasp: [],
    atlas: [],
    why: "ATLAS has techniques for single steps (autonomous reconnaissance, autonomous exploit development, generating malicious commands), but the category does not record which step AI helped with, so none is derived. No OWASP entry: the AI is the attacker's tool.",
  },
  other: {
    owasp: [],
    atlas: [],
    why: "No defined scope, so nothing to map.",
  },
};

/** Rows that differ when the type changes what a category means. A pair listed here replaces the category's row. */
export const STANDARDS_BY_TYPE_CATEGORY: Partial<Record<`${IncidentType}:${Category}`, StandardsRow>> = {
  "ai_enabled_attack:supply_chain": {
    owasp: [],
    atlas: [],
    why: "When AI is the weapon, the supply chain attacked is ordinary software (npm and PyPI packages), so the AI supply-chain entries (LLM03, AML.T0010) do not follow.",
  },
};

export function standardsRow(type: IncidentType, category: Category): StandardsRow {
  return STANDARDS_BY_TYPE_CATEGORY[`${type}:${category}`] ?? STANDARDS_BY_CATEGORY[category];
}

type Classified = { type: IncidentType; categories: readonly Category[] };

/** OWASP LLM Top 10 entries for a record: the union over its categories, in list order. */
export function owaspFor(i: Classified): OwaspLlmId[] {
  const ids = new Set(i.categories.flatMap((c) => standardsRow(i.type, c).owasp));
  return OWASP_LLM_IDS.filter((id) => ids.has(id));
}

/** ATLAS techniques for a record: the union over its categories, in id order. */
export function atlasFor(i: Classified): AtlasTechniqueId[] {
  const ids = new Set(i.categories.flatMap((c) => standardsRow(i.type, c).atlas));
  return ATLAS_TECHNIQUE_IDS.filter((id) => ids.has(id));
}

const ALL_ROWS: StandardsRow[] = [...Object.values(STANDARDS_BY_CATEGORY), ...Object.values(STANDARDS_BY_TYPE_CATEGORY)];

/** Entries some row can produce, in list order: what the explorer offers as filter values. */
export const OWASP_IN_USE: OwaspLlmId[] = OWASP_LLM_IDS.filter((id) => ALL_ROWS.some((r) => r.owasp.includes(id)));
/** OWASP entries no row produces; the Methodology page lists them. */
export const OWASP_NOT_DERIVED: OwaspLlmId[] = OWASP_LLM_IDS.filter((id) => !OWASP_IN_USE.includes(id));
export const ATLAS_IN_USE: AtlasTechniqueId[] = ATLAS_TECHNIQUE_IDS.filter((id) => ALL_ROWS.some((r) => r.atlas.includes(id)));

export function isOwaspInUse(v: string): v is OwaspLlmId {
  return (OWASP_IN_USE as string[]).includes(v);
}
export function isAtlasInUse(v: string): v is AtlasTechniqueId {
  return (ATLAS_IN_USE as string[]).includes(v);
}
