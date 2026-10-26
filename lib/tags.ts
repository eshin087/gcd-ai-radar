import type { FullIncident } from "./lifecycle";
import { productFamily, productSlug } from "./products";
import { monthRange, shiftMonth, toMonthKey } from "./stats";
import { TARGETS } from "./taxonomy";

/**
 * Tags: the free-text labels the classifier writes, normalised into slugs
 * with their own pages, feeds and groups. The dataset keeps the tags as
 * written (CVE ids among them); this module reads them. The collector gets
 * ATTACK_TAGS as the vocabulary for technique tags, so new records land on
 * existing slugs.
 */

export const TAG_GROUPS = ["attack", "stack", "vendor", "actor", "sector", "standard", "other"] as const;
export type TagGroup = (typeof TAG_GROUPS)[number];

export const TAG_GROUP_META: Record<TagGroup, { label: string; lede: string; order: number }> = {
  attack: { label: "Attack types", lede: "The technique or kind of harm.", order: 0 },
  stack: { label: "Stacks and products", lede: "Languages, frameworks, products and services named in the records.", order: 1 },
  vendor: { label: "Vendors", lede: "The company whose product or service was involved.", order: 2 },
  actor: { label: "Threat actors and campaigns", lede: "Named groups, campaigns and tools.", order: 3 },
  sector: { label: "Sectors and channels", lede: "Where it happened: an industry, a platform, a channel.", order: 4 },
  standard: { label: "Standards and catalogues", lede: "CISA KEV listings and framework references.", order: 5 },
  other: { label: "Other", lede: "Tags that fit no group yet.", order: 6 },
};

/** Spellings folded into one slug. Keys and values are normalised slugs. */
export const ALIASES: Record<string, string> = {
  "denial-of-service": "dos",
  "remote-code-execution": "rce",
  "code-execution": "rce",
  "command-execution": "command-injection",
  "authorization-bypass": "auth-bypass",
  "authentication-bypass": "auth-bypass",
  "deepfake-fraud": "deepfake",
  "directory-traversal": "path-traversal",
  "local-file-read": "arbitrary-file-read",
  "file-read": "arbitrary-file-read",
  "lfi": "arbitrary-file-read",
  "file-write": "arbitrary-file-write",
  "elevation-of-privilege": "privilege-escalation",
  "indirect-prompt-injection": "prompt-injection",
  "credential-leak": "credential-theft",
  "credential-exposure": "credential-theft",
  "credential-harvesting": "credential-theft",
  "credential-disclosure": "credential-theft",
  "api-key-leak": "api-key-exposure",
  "api-keys": "api-key-exposure",
  "token-theft": "credential-theft",
  "data-exposure": "data-leak",
  "data-exfiltration": "data-leak",
  "information-disclosure": "data-leak",
  "investment-fraud": "investment-scam",
  "crypto-fraud": "crypto-scam",
  "identity-fraud": "identity-theft",
  "red-teaming": "red-team",
  "model-context-protocol": "mcp",
  "mcp-server": "mcp",
  "hugging-face": "huggingface",
  "flowiseai": "flowise",
  "lollms-webui": "lollms",
  "nemo": "nvidia-nemo",
  "tensorrt-llm": "nvidia-tensorrt-llm",
  "authorization": "access-control",
  "authentication": "access-control",
  "acl-bypass": "access-control",
  "scam": "fraud",
  "arbitrary-code-execution": "rce",
  "eval-injection": "code-injection",
  "file-disclosure": "arbitrary-file-read",
  "database-exposure": "data-leak",
  "exfiltration": "data-leak",
  "credential-abuse": "credential-theft",
  "credential-stealer": "malware",
  "distillation": "model-extraction",
  "session-management": "session-hijacking",
  "agentic-ai": "agents",
  "ai-agent": "agents",
  "autonomous-agents": "agents",
  "llm-agents": "agents",
  "agentic-threat": "agents",
  "trading-agents": "agents",
  "computer-use": "agents",
  "coding-assistant": "agents",
  "synthetic-media": "deepfake",
  "video-fraud": "deepfake",
  "face-swap": "deepfake",
  "biometric-bypass": "kyc-bypass",
  "broken-access-control": "access-control",
  "missing-authorization": "access-control",
  "unauthorized-access": "access-control",
  "unauthenticated-access": "access-control",
  "unauthenticated": "access-control",
  "bola": "idor",
  "memory-exhaustion": "resource-exhaustion",
  "stored-xss": "xss",
  "heap-overflow": "buffer-overflow",
  "adversarial-attack": "adversarial-evasion",
  "evasion": "adversarial-evasion",
  "adversarial-ml": "adversarial-evasion",
  "safety-bypass": "jailbreak",
  "guardrail-bypass": "jailbreak",
  "malware-development": "ai-generated-malware",
  "infostealer": "malware",
  "ceo-fraud": "bec",
  "pig-butchering": "romance-scam",
  "vishing": "voice-cloning",
  "sextortion": "extortion",
  "blackmail": "extortion",
  "kyc": "kyc-bypass",
  "ai-agents": "agents",
  "autonomous-agent": "agents",
  "multi-agent": "agents",
  "coding-agents": "agents",
  "agent": "agents",
  "crypto": "cryptocurrency",
};

/** Tags that only echo a category, name an outcome, or carry no information; they never get a page. */
export const DROPPED: ReadonlySet<string> = new Set([
  "infra-vuln", "infravuln", "agent-hijack", "ai-assisted-intrusion", "ai-assisted-attack", "ai-assisted-planning", "automated-attacks", "other", "vulnerability",
  "injection", "bypass", "research", "avid", "security", "llm-security", "agent-security", "ai", "llm", "llms", "cybercrime", "financial-loss",
]);

/** Slugs that would collide with the tag directory's own files or pages. */
const RESERVED: ReadonlySet<string> = new Set(["index", "feed", "llms", "changes", "all", "live"]);

const CVE = /^cve-\d{4}-\d+$/;

/** The slug of a tag as written, or null when it is a CVE id or dropped. */
export function normalizeTag(raw: string): string | null {
  let s = raw
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!s || CVE.test(s)) return null;
  s = ALIASES[s] ?? s;
  if (DROPPED.has(s)) return null;
  if (RESERVED.has(s)) s = `${s}-tag`;
  return s;
}

/** The technique and harm vocabulary the classifier is given; every slug is an `attack` tag. */
export const ATTACK_TAGS: readonly string[] = [
  "rce", "ssrf", "xss", "csrf", "dos", "redos", "path-traversal", "arbitrary-file-read", "arbitrary-file-write", "arbitrary-file-upload",
  "command-injection", "code-injection", "sql-injection", "template-injection", "deserialization", "idor", "access-control", "auth-bypass",
  "privilege-escalation", "sandbox-escape", "dns-rebinding", "cors", "mass-assignment", "buffer-overflow", "integer-overflow", "use-after-free",
  "memory-corruption", "race-condition", "toctou", "symlink", "xxe", "ssti", "open-redirect", "session-hijacking", "cache-poisoning",
  "resource-exhaustion", "misconfiguration", "input-validation", "file-upload", "timing-attack", "dependency-confusion", "typosquatting", "backdoor",
  "prompt-injection", "jailbreak", "data-poisoning", "model-extraction", "adversarial-evasion", "data-leak", "api-key-exposure", "credential-theft",
  "account-takeover", "unauthorized-action", "deepfake", "voice-cloning", "impersonation", "phishing", "social-engineering", "fraud", "financial-fraud",
  "romance-scam", "investment-scam", "crypto-scam", "bec", "extortion", "identity-theft", "kyc-bypass", "disinformation", "influence-operation",
  "malware", "ai-generated-malware", "ransomware", "botnet", "spoofing", "clickfix", "supply-chain", "zero-day", "exploited-in-the-wild",
  "api-abuse", "tenant-isolation", "cookie-leak", "trust-remote-code", "cleartext-storage", "confused-deputy", "allowlist-bypass", "data-breach",
  "espionage", "intrusion", "c2", "dga", "cypher-injection", "file-deletion", "search-manipulation", "membership-inference", "camera-hijack", "recursion",
  "privacy", "harassment", "sextortion-campaign", "nudify", "propaganda", "terrorism", "violence", "human-trafficking", "hallucination",
];
const ATTACK = new Set(ATTACK_TAGS);

const VENDORS = new Set([
  ...TARGETS.filter((t) => /^[A-Z]/.test(t)).map((t) => t.toLowerCase()),
  "nvidia", "cisco", "fortinet", "palo-alto", "palo-alto-networks", "citrix", "ivanti", "atlassian", "github", "gitlab", "vmware", "broadcom", "oracle", "sap",
  "adobe", "apple", "samsung", "huawei", "zoom", "slack", "salesforce", "okta", "cloudflare", "aws", "azure", "google-cloud", "hugging-face", "huggingface",
  "deepseek", "alibaba", "tencent", "baidu", "ibm", "intel", "amd", "qualcomm", "meta", "mozilla", "canonical", "red-hat", "suse", "debian", "ubuntu", "elon-musk",
]);

const ACTOR = /^(apt|storm|unc|ta|fin|uta|g)-?\d{2,}$|^(lazarus|kimsuky|scattered-spider|lockbit|qilin|clop|alphv|blackcat|ransomhub|akira|play|medusa|inc-ransom|rhysida|blackbasta|black-basta|conti|revil|darkside|hive|royal|lamehug|fraudgpt|wormgpt|xanthorox|salt-typhoon|volt-typhoon|midnight-blizzard|fancy-bear|cozy-bear|sandworm|mustang-panda|charming-kitten|hexstrike|cairn|artex)$/;

const SECTORS = new Set([
  "healthcare", "hospital", "finance", "banking", "fintech", "government", "military", "defense", "education", "university", "retail", "manufacturing",
  "energy", "utilities", "telecom", "media", "crypto-exchange", "cryptocurrency", "gaming", "legal", "insurance", "transport", "aviation", "automotive",
  "elections", "social-media", "youtube", "tiktok", "telegram", "whatsapp", "facebook", "twitter", "instagram", "linkedin", "discord", "reddit", "call-center",
  "mobile-apps", "app-store", "dating-apps", "e-commerce", "logistics", "pharma", "nonprofit", "children", "elderly", "politics", "journalism",
]);

const STACK_WORDS = new Set([
  "python", "node", "nodejs", "npm", "pypi", "docker", "kubernetes", "php", "java", "javascript", "typescript", "go", "golang", "rust", "ruby", "wordpress",
  "linux", "windows", "macos", "android", "ios", "chrome", "firefox", "react", "nextjs", "django", "flask", "spring", "laravel", "rails", "express", "fastapi",
  "pytorch", "tensorflow", "jupyter", "notebook", "rag", "vector-database", "inference-server", "gguf", "safetensors", "pickle", "websocket", "oauth", "jwt",
  "rbac", "sdk", "cli", "browser-extension", "vscode", "cursor", "mcp", "agents", "chatbot", "fine-tuning", "multimodal", "pyodide", "edge-ai",
  "facial-recognition", "malware-detection", "red-team", "persistent-memory", "code-generation", "enterprise-ai", "api-key",
]);

export function groupOf(slug: string, isProduct: (slug: string) => boolean): TagGroup {
  if (slug === "cisa-kev" || /^llm0\d$/.test(slug) || /^cwe-\d+$/.test(slug) || /^aml-t\d/.test(slug)) return "standard";
  if (ACTOR.test(slug)) return "actor";
  if (ATTACK.has(slug)) return "attack";
  if (VENDORS.has(slug)) return "vendor";
  if (SECTORS.has(slug)) return "sector";
  if (STACK_WORDS.has(slug) || isProduct(slug)) return "stack";
  return "other";
}

export interface TagEntry {
  slug: string;
  /** The most frequent spelling as written, for display. */
  label: string;
  group: TagGroup;
  total: number;
  live: number;
  /** Newest first report among the records. */
  latest: string;
  /** Records by month of first report over the last twelve months, oldest first. */
  months: number[];
  /** Record ids, newest first report first. */
  ids: string[];
}

export interface TagIndex {
  tags: TagEntry[];
  bySlug: Map<string, TagEntry>;
  /** Tags that get a page: two or more records, or any live one. */
  directory: TagEntry[];
  months: string[];
}

/** The slugs a record carries, deduplicated, at most five. */
export function tagSlugsOf(i: Pick<FullIncident, "tags">): string[] {
  const out: string[] = [];
  for (const t of i.tags) {
    const s = normalizeTag(t);
    if (s && !out.includes(s)) out.push(s);
    if (out.length === 5) break;
  }
  return out;
}

const indexes = new WeakMap<readonly FullIncident[], TagIndex>();

export function buildTagIndex(incidents: readonly FullIncident[], now: Date): TagIndex {
  const cached = indexes.get(incidents);
  if (cached) return cached;
  const month = toMonthKey(now);
  const months = monthRange(shiftMonth(month, -11), month);
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  // a tag that names a product, by its family label or as filed ("langchain" matches the product "LangChain")
  const productSlugs = new Set<string>();
  for (const i of incidents) {
    for (const p of i.products) {
      productSlugs.add(productSlug(productFamily(p)));
      productSlugs.add(productSlug(p));
    }
  }
  const isProduct = (slug: string) => productSlugs.has(slug);

  const acc = new Map<string, { spellings: Map<string, number>; total: number; live: number; latest: string; months: number[]; items: FullIncident[] }>();
  for (const i of incidents) {
    const seen = new Set<string>();
    for (const raw of i.tags) {
      const slug = normalizeTag(raw);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      let a = acc.get(slug);
      if (!a) {
        a = { spellings: new Map(), total: 0, live: 0, latest: "", months: months.map(() => 0), items: [] };
        acc.set(slug, a);
      }
      const spelling = raw.trim();
      a.spellings.set(spelling, (a.spellings.get(spelling) ?? 0) + 1);
      a.total += 1;
      if (i.state === "live") a.live += 1;
      if (i.first_reported > a.latest) a.latest = i.first_reported;
      const mi = monthIndex.get(i.first_reported.slice(0, 7));
      if (mi !== undefined) a.months[mi]! += 1;
      a.items.push(i);
    }
  }
  const tags: TagEntry[] = [...acc.entries()]
    .map(([slug, a]) => {
      const spellings = [...a.spellings.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
      const best = spellings[0]![0];
      // a slug that came through an alias is shown as the slug, so "dos" never reads "denial_of_service"
      const label = normalizeTag(best) === slug && !ALIASES[best.toLowerCase()] ? best.replace(/_/g, "-") : slug;
      return {
        slug,
        label,
        group: groupOf(slug, isProduct),
        total: a.total,
        live: a.live,
        latest: a.latest,
        months: a.months,
        ids: a.items.sort((x, y) => y.first_reported.localeCompare(x.first_reported) || y.id.localeCompare(x.id)).map((i) => i.id),
      };
    })
    .sort((x, y) => y.total - x.total || y.live - x.live || x.slug.localeCompare(y.slug));
  const index: TagIndex = {
    tags,
    bySlug: new Map(tags.map((t) => [t.slug, t])),
    directory: tags.filter((t) => t.total >= 2 || t.live > 0),
    months,
  };
  indexes.set(incidents, index);
  return index;
}

/** The live tags with the most live records, then the most records. */
export function topLiveTags(index: TagIndex, n: number): TagEntry[] {
  return [...index.tags]
    .filter((t) => t.live > 0)
    .sort((a, b) => b.live - a.live || b.total - a.total || a.slug.localeCompare(b.slug))
    .slice(0, n);
}

export function tagHref(slug: string): string {
  return `/tags/${slug}`;
}
