import type { Category, Target } from "@/lib/taxonomy";
import type { ThreatIntel } from "@/lib/threatIntel";

/** An attack's type, as the HUD names it. */
export const KIND_LABEL: Record<Category, string> = {
  prompt_injection: "PROMPT INJECTION",
  jailbreak: "JAILBREAK",
  infra_vuln: "INFRA EXPLOIT",
  data_leak: "DATA LEAK",
  model_theft_extraction: "MODEL THEFT",
  agent_hijack: "AGENT HIJACK",
  supply_chain: "SUPPLY CHAIN",
  data_poisoning: "DATA POISONING",
  adversarial_evasion: "EVASION",
  deepfake_fraud: "DEEPFAKE FRAUD",
  ai_phishing_social_engineering: "AI PHISHING",
  ai_generated_malware: "AI MALWARE",
  ai_assisted_intrusion: "AI INTRUSION",
  other: "UNKNOWN",
  general: "GENERAL",
};

/** The system in a company's AI estate that stands for each target the dataset tracks. */
export const SYSTEM_LABEL: Record<Target, string> = {
  Microsoft: "Copilot",
  OpenAI: "ChatGPT",
  Anthropic: "Claude",
  Google: "Gemini",
  Amazon: "Bedrock",
  Meta: "Meta AI",
  Mistral: "Mistral",
  xAI: "Grok",
  Apple: "Apple AI",
  open_weight_model: "self-hosted LLM",
  framework_or_tooling: "MCP / tools",
  enterprise_deployment: "internal AI apps",
  individual_victims: "employees",
  "n/a": "the core",
};

export type Fate = "blocked" | "intercepted" | "breach";

/**
 * How attacks of each type are typically carried out, after the OWASP Top 10
 * for LLM Applications and MITRE ATLAS. These name a kind of technique, not a
 * reported case: the simulated lines draw one at random so the log does not
 * repeat itself.
 */
export const TECHNIQUES: Record<Category, string[]> = {
  prompt_injection: ["hidden text in a web page", "instructions in a shared doc", "poisoned email to the assistant", "payload in a PDF", "prompt inside an image", "tool output injection", "calendar invite payload"],
  jailbreak: ["role-play persona", "many-shot prompt", "base64-encoded ask", "multi-turn crescendo", "policy-puppetry prompt"],
  infra_vuln: ["RCE in the inference server", "unauthenticated model API", "SSRF via the fetch tool", "path traversal in the vector store", "exposed notebook server"],
  data_leak: ["chat history exposed", "PII in model output", "over-permissioned RAG index", "secrets pasted into prompts", "training data regurgitated"],
  model_theft_extraction: ["query-based extraction", "weights in an open bucket", "distillation through the API", "endpoint side channel"],
  agent_hijack: ["MCP tool poisoning", "OAuth token stolen from the agent", "confused-deputy tool call", "malicious plugin update", "goal hijack mid-task"],
  supply_chain: ["typosquatted package", "trojaned model on a hub", "poisoned dataset dependency", "compromised CI token"],
  data_poisoning: ["poisoned fine-tune set", "backdoor trigger in training data", "RAG corpus seeded with lies"],
  adversarial_evasion: ["perturbed input past the filter", "obfuscated payload past the classifier"],
  deepfake_fraud: ["cloned executive voice", "deepfake video meeting", "synthetic ID past KYC"],
  ai_phishing_social_engineering: ["LLM-written spear-phish", "chatbot posing as IT support", "AI lure behind a QR code"],
  ai_generated_malware: ["LLM-written loader", "polymorphic payload", "AI-tuned ransomware"],
  ai_assisted_intrusion: ["AI-driven recon of the estate", "automated credential stuffing", "agentic lateral movement"],
  other: ["unclassified technique"],
  general: ["unclassified technique"],
};

/** What stopped an attack, or what the response to a breach was, for the simulated lines. */
export const RESPONSES: Record<Fate, string[]> = {
  blocked: ["prompt shield", "egress filter", "policy engine", "input sanitiser", "allow-list", "rate limiter", "content filter", "signature check"],
  intercepted: ["interceptor wing", "agent quarantined", "token revoked", "session killed", "sandbox reset", "tool call denied"],
  breach: ["repair agents purging", "contained, patching", "keys rotating", "rolled back", "host isolated"],
};

export interface FeedEvent {
  id: number;
  category: Category;
  kind: string;
  target: string;
  fate: Fate;
  rising: boolean;
  /** one of the type's typical techniques (see TECHNIQUES) */
  tech: string;
  /** one of the fate's responses (see RESPONSES) */
  response: string;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Attacks drawn from the last 90 days of incidents: the type in proportion to
 * how often it was reported, the target from what that type really hit, and
 * a breach at that type's real share of severity 3-4 (confirmed exploitation
 * or loss). The rest are split between the shield and the interceptors.
 */
export function threatFeed(intel: ThreatIntel, seed = 7) {
  const rnd = mulberry32(seed);
  const kinds = intel.kinds.length ? intel.kinds : [{ category: "prompt_injection" as Category, count: 1, prior: 0, harm: 0.3, targets: [], rising: false }];
  let ids = 0;
  const pick = <T,>(items: readonly T[], w: (x: T) => number): T | undefined => {
    let total = 0;
    for (const it of items) total += w(it);
    if (total <= 0) return items[Math.floor(rnd() * items.length)];
    let x = rnd() * total;
    for (const it of items) {
      x -= w(it);
      if (x <= 0) return it;
    }
    return items[items.length - 1];
  };
  return {
    rnd,
    next(): FeedEvent {
      const k = pick(kinds, (x) => x.count)!;
      const t = pick(k.targets, (x) => x.count);
      const fate: Fate = rnd() < k.harm ? "breach" : rnd() < 0.55 ? "intercepted" : "blocked";
      const techs = TECHNIQUES[k.category];
      const tech = techs[Math.floor(rnd() * techs.length)]!;
      const response = RESPONSES[fate][Math.floor(rnd() * RESPONSES[fate].length)]!;
      return { id: ++ids, category: k.category, kind: KIND_LABEL[k.category], target: t ? SYSTEM_LABEL[t.target] : "the core", fate, rising: k.rising, tech, response };
    },
  };
}

export const FATE_WORD: Record<Fate, string> = { blocked: "BLOCKED", intercepted: "INTERCEPTED", breach: "BREACH" };
