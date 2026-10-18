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
