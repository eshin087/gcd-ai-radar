/**
 * Generates data/stub/incidents.json: a synthetic but realistic dataset used
 * only while data/incidents.json is nearly empty (design-options phase).
 *
 * Deterministic (seeded) so re-running produces the same file. Every record
 * is validated against the real schema. Titles are templated, sources point
 * at example.org, and every record is tagged "stub".
 *
 *   npm run stub            # default ~500 records, 2023-01 .. current month
 *   npm run stub -- 300     # different size
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { IncidentsFileSchema, type Incident, type Source } from "../lib/schema";
import {
  CATEGORIES,
  type Category,
  type IncidentType,
  type Severity,
  type Target,
} from "../lib/taxonomy";

// --- seeded PRNG (mulberry32) -------------------------------------------------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261017);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const chance = (p: number) => rand() < p;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
function weighted<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1]![0];
}

// --- vocab --------------------------------------------------------------------
const FRAMEWORKS = [
  "vLLM", "Ollama", "LangChain", "Open WebUI", "MLflow", "Gradio", "Langflow", "LiteLLM",
  "llama.cpp", "PyTorch", "Ray", "ComfyUI", "Hugging Face transformers", "AnythingLLM",
  "Dify", "Flowise", "n8n", "an MCP server", "Triton Inference Server", "Jupyter AI",
];
const VENDOR_TARGETS: Target[] = ["OpenAI", "Anthropic", "Google", "Microsoft", "Meta", "xAI", "Amazon", "Apple", "Mistral"];
const VENDOR_PRODUCTS: Record<string, string[]> = {
  OpenAI: ["ChatGPT", "Codex", "Operator", "GPT Store"],
  Anthropic: ["Claude", "Claude Code", "Claude for Chrome"],
  Google: ["Gemini", "Gemini CLI", "Workspace AI", "NotebookLM"],
  Microsoft: ["Copilot", "GitHub Copilot", "Copilot Studio", "Azure AI Foundry"],
  Meta: ["Meta AI", "Llama API"],
  xAI: ["Grok"],
  Amazon: ["Amazon Q", "Bedrock Agents", "Alexa+"],
  Apple: ["Apple Intelligence", "Siri"],
  Mistral: ["Le Chat", "Mistral Agents"],
};
const OPEN_MODELS = ["Llama 3", "Qwen", "DeepSeek", "Mistral 7B", "Gemma", "Phi"];
const SECTORS = ["a logistics firm", "a regional bank", "a hospital network", "a law firm", "an energy utility", "a university", "a crypto exchange", "a city government", "a retailer", "an insurer"];
const ACTORS = ["a China-nexus group", "a North Korean cluster", "a ransomware affiliate", "an Iranian actor", "a cybercrime crew", "an unattributed actor"];

const PUBLISHERS: Record<string, number> = {
  "The Hacker News": 12, BleepingComputer: 11, "Dark Reading": 8, SecurityWeek: 7,
  "Krebs on Security": 2, "Simon Willison": 5, "Embrace The Red": 6, "Unit 42": 4,
  "Cisco Talos": 3, "Microsoft Security": 3, "Google Threat Intelligence": 3, arXiv: 6,
  NVD: 8, "GitHub Advisory Database": 8, "OWASP GenAI": 2, "Trend Micro Research": 3,
  Wired: 2, "The Register": 3, "Ars Technica": 2, Reuters: 2, "BBC News": 1, "Hacker News": 4,
};

type Tpl = (ctx: Ctx) => string;
interface Ctx { product: string; vendor: string; framework: string; model: string; sector: string; actor: string; cve: string; n: number }

const TITLES: Record<Category, Tpl[]> = {
  prompt_injection: [
    (c) => `Indirect prompt injection in ${c.product} leaks private data through a shared document`,
    (c) => `Researchers hide instructions in web pages to hijack ${c.product} browsing`,
    (c) => `${c.product} follows attacker instructions embedded in calendar invites`,
  ],
  jailbreak: [
    (c) => `New multi-turn jailbreak defeats safety training in ${c.model}`,
    (c) => `"${pick(["Crescendo", "Echo Chamber", "Policy Puppetry", "Skeleton Key", "Bad Likert Judge"])}" technique jailbreaks ${c.product} and ${c.model}`,
    (c) => `Jailbreak prompts for ${c.product} traded on underground forums`,
  ],
  agent_hijack: [
    (c) => `Coding agent in ${c.product} tricked into running malware from a malicious repository`,
    (c) => `${c.product} agent exfiltrates files after reading a poisoned issue comment`,
    (c) => `Zero-click attack turns ${c.product} into an insider via email`,
  ],
  data_leak: [
    (c) => `${c.vendor} chat histories exposed to other users after caching bug`,
    (c) => `System prompt and tool schema of ${c.product} leaked by researchers`,
    (c) => `Misconfigured vector database exposes ${c.sector} customer records used for RAG`,
  ],
  model_theft_extraction: [
    (c) => `Distillation campaign extracts ${c.vendor} model behaviour through ${c.n}00k API queries`,
    (c) => `Weights of a fine-tuned ${c.model} stolen from an exposed storage bucket`,
  ],
  supply_chain: [
    (c) => `Backdoored ${c.model} checkpoints uploaded to a public model hub`,
    (c) => `Malicious PyPI package impersonates ${c.framework} and steals API keys`,
    (c) => `Pickle deserialization in ${c.framework} model loader enables code execution`,
  ],
  data_poisoning: [
    (c) => `Poisoned documents steer a ${c.sector} RAG assistant toward attacker content`,
    (c) => `Study shows a few hundred poisoned samples backdoor ${c.model} fine-tunes`,
  ],
  adversarial_evasion: [
    (c) => `Adversarial perturbations evade AI-based malware detection in ${c.n} products`,
    (c) => `Audio perturbations bypass deepfake detectors used by ${c.sector}`,
  ],
  infra_vuln: [
    (c) => `${c.cve}: remote code execution in ${c.framework}`,
    (c) => `${c.cve}: authentication bypass in ${c.framework} exposes model endpoints`,
    (c) => `${c.cve}: path traversal in ${c.framework} leaks server files`,
    (c) => `${c.cve}: server-side request forgery in ${c.framework} tool integrations`,
    (c) => `${c.cve}: deserialization flaw in ${c.framework} allows arbitrary code`,
  ],
  deepfake_fraud: [
    (c) => `Deepfake video call defrauds ${c.sector} of $${c.n}.${int(1, 9)} million`,
    (c) => `Voice clone of a CEO used to authorise wire transfers at ${c.sector}`,
    (c) => `Deepfake job applicants infiltrate ${c.sector} as remote IT workers`,
  ],
  ai_generated_malware: [
    (c) => `${c.actor} deploys malware that rewrites itself with an LLM at runtime`,
    (c) => `Ransomware builder uses ${c.product} to generate evasive loaders`,
  ],
  ai_phishing_social_engineering: [
    (c) => `${c.actor} runs AI-personalised phishing against ${c.sector} executives`,
    () => `Chatbot-driven romance scams scale to thousands of victims`,
  ],
  ai_assisted_intrusion: [
    (c) => `${c.actor} used ${c.product} for reconnaissance and exploit development`,
    (c) => `AI agent autonomously chains vulnerabilities to breach ${c.sector}`,
    (c) => `${c.vendor} disrupts ${c.actor} abusing its models for intrusion operations`,
  ],
  other: [(c) => `AI-powered security tool at ${c.sector} abused to disable its own alerts`],
};

const SUMMARIES: Record<Category, Tpl[]> = {
  prompt_injection: [
    (c) => `Attacker-controlled text reached ${c.product} through content it was asked to process and overrode its instructions. The vendor shipped mitigations after researchers demonstrated data exfiltration.`,
  ],
  jailbreak: [
    (c) => `A prompting technique reliably bypassed the safety training of ${c.model} and other models in testing. Vendors were notified and several have deployed partial fixes.`,
  ],
  agent_hijack: [
    () => `Content the agent was asked to read contained hidden instructions that it executed with the user's permissions. Researchers showed file exfiltration and unwanted tool calls before the vendor patched the flow.`,
  ],
  data_leak: [
    (c) => `Data belonging to ${c.vendor} users was exposed through a configuration or caching failure. The company says the issue affected a subset of users and has been fixed.`,
  ],
  model_theft_extraction: [
    (c) => `A sustained querying campaign replicated proprietary model behaviour from ${c.vendor} at scale. The provider revoked the accounts involved and described the activity as a terms-of-service violation.`,
  ],
  supply_chain: [
    (c) => `A compromised AI dependency delivered attacker code to developers who installed it alongside ${c.framework}. The artefact was removed after disclosure and downloads were analysed.`,
  ],
  data_poisoning: [
    () => `Manipulated training or retrieval data changed how a deployed model answered. The work shows poisoning is practical at small scale and hard to detect downstream.`,
  ],
  adversarial_evasion: [
    () => `Crafted inputs caused AI-based detection systems to miss malicious samples. The authors report the evasion transfers across several commercial products.`,
  ],
  infra_vuln: [
    (c) => `A vulnerability in ${c.framework} allowed unauthenticated attackers to reach internal functionality on exposed instances. A fixed release is available and internet-facing deployments are advised to upgrade.`,
  ],
  deepfake_fraud: [
    (c) => `Criminals used synthetic audio and video to impersonate executives and authorise fraudulent payments at ${c.sector}. Investigators say the money was moved through several accounts within hours.`,
  ],
  ai_generated_malware: [
    (c) => `Analysts recovered malware that calls a language model to generate or modify its own code during execution. The sample was attributed to ${c.actor}.`,
  ],
  ai_phishing_social_engineering: [
    (c) => `AI-generated, individually tailored lures were used against staff at ${c.sector}. Click-through rates were markedly higher than in comparable campaigns.`,
  ],
  ai_assisted_intrusion: [
    (c) => `Threat intelligence shows ${c.actor} using AI tooling across stages of a real intrusion. The provider terminated the accounts and published indicators.`,
  ],
  other: [(c) => `An AI-related security failure at ${c.sector} did not fit existing categories. It is tracked as other pending taxonomy review.`],
};

const CATEGORY_WEIGHTS: Record<Category, number> = {
  infra_vuln: 34, prompt_injection: 12, jailbreak: 7, agent_hijack: 8, data_leak: 6,
  model_theft_extraction: 2, supply_chain: 6, data_poisoning: 3, adversarial_evasion: 3,
  deepfake_fraud: 7, ai_generated_malware: 3, ai_phishing_social_engineering: 4,
  ai_assisted_intrusion: 4, other: 1,
};
const SEVERITY_BY_CATEGORY: Record<Category, Record<`${Severity}`, number>> = {
  infra_vuln: { "1": 2, "2": 80, "3": 16, "4": 2 },
  prompt_injection: { "1": 50, "2": 25, "3": 20, "4": 5 },
  jailbreak: { "1": 70, "2": 15, "3": 13, "4": 2 },
  agent_hijack: { "1": 45, "2": 30, "3": 20, "4": 5 },
  data_leak: { "1": 10, "2": 20, "3": 40, "4": 30 },
  model_theft_extraction: { "1": 40, "2": 10, "3": 40, "4": 10 },
  supply_chain: { "1": 20, "2": 35, "3": 35, "4": 10 },
  data_poisoning: { "1": 75, "2": 10, "3": 12, "4": 3 },
  adversarial_evasion: { "1": 85, "2": 5, "3": 8, "4": 2 },
  deepfake_fraud: { "1": 2, "2": 3, "3": 35, "4": 60 },
  ai_generated_malware: { "1": 25, "2": 5, "3": 60, "4": 10 },
  ai_phishing_social_engineering: { "1": 10, "2": 5, "3": 65, "4": 20 },
  ai_assisted_intrusion: { "1": 5, "2": 5, "3": 70, "4": 20 },
  other: { "1": 25, "2": 25, "3": 25, "4": 25 },
};
const TYPE_BY_CATEGORY: Record<Category, IncidentType> = {
  prompt_injection: "attack_on_ai", jailbreak: "attack_on_ai", agent_hijack: "attack_on_ai",
  data_leak: "attack_on_ai", model_theft_extraction: "attack_on_ai", supply_chain: "attack_on_ai",
  data_poisoning: "attack_on_ai", adversarial_evasion: "attack_on_ai", infra_vuln: "attack_on_ai",
  deepfake_fraud: "ai_enabled_attack", ai_generated_malware: "ai_enabled_attack",
  ai_phishing_social_engineering: "ai_enabled_attack", ai_assisted_intrusion: "ai_enabled_attack",
  other: "attack_on_ai",
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
}
function hash4(s: string): string {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36).slice(0, 4).padStart(4, "0");
}
function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Expected incidents per month: ~3/mo in 2023 rising to ~22/mo in 2026. */
function monthlyRate(index: number): number {
  const base = 2.5 + index * 0.42;
  const seasonal = 1 + 0.12 * Math.sin((index / 12) * Math.PI * 2);
  return base * seasonal;
}

function makeIncident(year: number, month: number, seq: Map<number, number>, usedSlugs: Set<string>): Incident {
  const category = weighted(CATEGORY_WEIGHTS);
  const secondary = chance(0.3) ? pick(CATEGORIES.filter((c) => c !== category && c !== "other")) : null;
  const severity = Number(weighted(SEVERITY_BY_CATEGORY[category])) as Severity;
  const type = TYPE_BY_CATEGORY[category];
  const vendor = pick(VENDOR_TARGETS);
  const ctx: Ctx = {
    vendor,
    product: pick(VENDOR_PRODUCTS[vendor]!),
    framework: pick(FRAMEWORKS),
    model: pick(OPEN_MODELS),
    sector: pick(SECTORS),
    actor: pick(ACTORS),
    cve: `CVE-${year}-${int(1000, 69999)}`,
    n: int(1, 9),
  };
  const title = pick(TITLES[category])(ctx);
  const summary = pick(SUMMARIES[category])(ctx);

  let targets: Target[];
  let products: string[];
  switch (category) {
    case "infra_vuln":
    case "supply_chain":
      targets = ["framework_or_tooling"];
      products = [ctx.framework];
      break;
    case "deepfake_fraud":
    case "ai_phishing_social_engineering":
      targets = chance(0.6) ? ["enterprise_deployment"] : ["individual_victims"];
      products = [];
      break;
    case "ai_generated_malware":
    case "ai_assisted_intrusion":
      targets = chance(0.5) ? ["n/a"] : [vendor];
      products = chance(0.5) ? [ctx.product] : [];
      break;
    case "jailbreak":
    case "model_theft_extraction":
      targets = chance(0.5) ? [vendor] : ["open_weight_model"];
      products = targets[0] === vendor ? [ctx.product] : [ctx.model];
      break;
    default:
      targets = chance(0.65) ? [vendor] : ["enterprise_deployment"];
      products = targets[0] === vendor ? [ctx.product] : [];
  }
  if (chance(0.15)) targets.push(pick(VENDOR_TARGETS.filter((v) => !targets.includes(v))));

  const precision = category === "infra_vuln" ? "day" : chance(0.08) ? "month" : chance(0.02) ? "year" : "day";
  const today = new Date().toISOString().slice(0, 10);
  const isCurrentMonth = today.slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`;
  const day = int(1, isCurrentMonth ? Math.max(1, Number(today.slice(8, 10))) : 28);
  const fullDate = isoDay(year, month, day);
  const incident_date = precision === "day" ? fullDate : precision === "month" ? fullDate.slice(0, 7) : fullDate.slice(0, 4);
  const lag = category === "infra_vuln" ? int(0, 3) : severity >= 3 ? int(0, 25) : int(0, 10);
  const reported = addDays(fullDate, lag);
  const first_reported = reported > today ? today : reported;

  const idYear = Number(first_reported.slice(0, 4));
  const n = (seq.get(idYear) ?? 0) + 1;
  seq.set(idYear, n);
  const id = `AIR-${idYear}-${String(n).padStart(4, "0")}`;

  let slug = slugify(title);
  if (usedSlugs.has(slug)) {
    slug = `${slug.slice(0, 55).replace(/-+$/, "")}-${hash4(id)}`;
  }
  usedSlugs.add(slug);

  const sourceCount = severity >= 3 ? int(1, 8) : category === "infra_vuln" ? int(1, 2) : int(1, 4);
  const sources: Source[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < sourceCount; i++) {
    let publisher = weighted(PUBLISHERS);
    if (category === "infra_vuln" && i === 0) publisher = chance(0.5) ? "NVD" : "GitHub Advisory Database";
    if (seen.has(publisher)) continue;
    seen.add(publisher);
    sources.push({
      url: `https://example.org/stub/${slug}/${slugify(publisher)}`,
      publisher,
      title: i === 0 ? title : `${title} — ${publisher} coverage`,
      published_at: addDays(first_reported, i === 0 ? 0 : int(0, 6)),
    });
  }
  sources.sort((a, b) => a.published_at.localeCompare(b.published_at));

  const created = `${first_reported}T${String(int(0, 23)).padStart(2, "0")}:17:00.000Z`;
  return {
    id,
    slug,
    title,
    summary,
    type,
    categories: secondary ? [category, secondary] : [category],
    severity,
    targets,
    products,
    incident_date,
    incident_date_precision: precision,
    first_reported,
    sources,
    source_count: sources.length,
    confidence: Math.round((0.8 + rand() * 0.19) * 100) / 100,
    status: "published",
    origin: category === "infra_vuln" ? (chance(0.5) ? "seed_nvd" : "seed_ghsa") : "news",
    tags: ["stub"],
    created_at: created,
    updated_at: created,
  };
}

async function main() {
  const target = Number(process.argv[2] ?? 0);
  const now = new Date();
  const startYear = 2023;
  const months: [number, number][] = [];
  for (let y = startYear; y <= now.getUTCFullYear(); y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === now.getUTCFullYear() && m > now.getUTCMonth() + 1) break;
      months.push([y, m]);
    }
  }
  const seq = new Map<number, number>();
  const usedSlugs = new Set<string>();
  const incidents: Incident[] = [];
  months.forEach(([y, m], i) => {
    const isCurrent = i === months.length - 1;
    let rate = monthlyRate(i);
    if (isCurrent) rate *= now.getUTCDate() / 30; // partial current month
    // Poisson-ish via sum of uniforms
    const count = Math.max(0, Math.round(rate + (rand() + rand() + rand() - 1.5) * Math.sqrt(rate)));
    for (let k = 0; k < count; k++) incidents.push(makeIncident(y, m, seq, usedSlugs));
  });
  const final = target > 0 ? incidents.slice(0, target) : incidents;
  final.sort((a, b) => a.first_reported.localeCompare(b.first_reported));

  const validated = IncidentsFileSchema.parse(final);
  const out = path.join(process.cwd(), "data", "stub", "incidents.json");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(validated, null, 2) + "\n");
  const bySev = [1, 2, 3, 4].map((s) => `${s}:${validated.filter((i) => i.severity === s).length}`).join(" ");
  console.log(`wrote ${validated.length} stub incidents to ${path.relative(process.cwd(), out)} (severity ${bySev})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
