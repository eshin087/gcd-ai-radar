import { isDisclosedIncident } from "./counting";
import type { Incident } from "./schema";
import { monthRange, shiftMonth } from "./stats";
import { REAL_WORLD_MIN_SEVERITY, type Severity } from "./taxonomy";

/**
 * Product families for the disclosed-vulnerability breakdown. Records keep the
 * product name as the advisory gave it, so one product shows up under several
 * names ("Langflow", "Langflow OSS", "IBM Langflow OSS"). productFamily() maps
 * those variants to one label for display only; the dataset is not changed.
 *
 * Started from the NVD audit's families (docs/nvd-audit.md), narrowed to
 * variants of one product or one vendor's product line: a third-party tool
 * built on a product keeps its own name (claude-code-router is not Claude
 * Code), and so does any name no rule matches.
 *
 * Ordered: the first match wins, tested against the trimmed, lowercased name.
 */
const RULES: readonly (readonly [RegExp, string])[] = [
  // MCP first, so an MCP server for a product counts as an MCP server, not as that product.
  [/^fastmcp\b/, "FastMCP"],
  // Official SDKs and tooling; "mcp" is the Python SDK's package name.
  [/^(mcp|mcp gem|rmcp|go mcp sdk|mcp inspector|model context protocol|@modelcontextprotocol\/(sdk|inspector)|(mcp|model context protocol) (python|typescript|java|kotlin|ruby|php|go|rust|c#|swift) sdk)$/, "MCP SDKs"],
  [/mcp|model ?context ?protocol|^toolhive\b/, "MCP servers & tools"],

  [/langflow/, "Langflow"],
  [/open[- ]?webui/, "Open WebUI"],
  [/^flowise/, "Flowise"],
  // vllm-orchestrator-gateway is a TrustyAI gateway in front of vLLM, not part of the vLLM project.
  [/^vllm(?!-orchestrator)/, "vLLM"],
  [/^gradio$/, "Gradio"],
  [/^litellm\b/, "LiteLLM"],
  [/^llama\.cpp$/, "llama.cpp"],
  [/^dify\b/, "Dify"],
  [/^ollama\b/, "Ollama"],
  [/^anything-?llm\b/, "AnythingLLM"],
  [/^lollms\b/, "LoLLMs"],

  [/^(claude code( action)?|claude (agent )?sdk\b.*|anthropic\b.*|@anthropic-ai\/.+)$/, "Claude Code + SDKs"],
  // Claude Code UI (siteboon) renamed itself CloudCLI.
  [/^(claude code ui|cloud ?cli)$/, "Claude Code UI"],

  [/nemoclaw/, "NVIDIA NemoClaw"],
  [/\bnemo\b/, "NVIDIA NeMo"],
  [/tensorrt-llm/, "NVIDIA TensorRT-LLM"],
  [/triton inference server/, "NVIDIA Triton"],

  [/^(hugging ?face\b|huggingface[-_]hub$)|^(transformers|diffusers|sentence-transformers|safetensors|smolagents|text-generation-inference)$/, "Hugging Face libraries"],

  // Langchain-Chatchat, LangChain4j and langchaingo are separate projects that borrowed the name.
  [/chatchat/, "Langchain-Chatchat"],
  [/^(quarkus )?langchain4j$/, "LangChain4j"],
  [/^(@langchain\/|langchain(?!4j|go|-chatglm)|langgraph|langsmith)/, "LangChain family"],
  [/^llama[-_ ]?index/, "LlamaIndex"],

  [/^github copilot\b|^copilot cli$/, "GitHub Copilot"],
  [/^(microsoft |m)365 copilot/, "Microsoft 365 Copilot"],
  [/^(microsoft )?copilot studio/, "Copilot Studio"],
  [/^(openai )?codex( cli)?$/, "OpenAI Codex"],
  [/^windsurf\b/, "Windsurf"],

  [/^comfyui/, "ComfyUI + custom nodes"],
  [/^(lobe[- ]?chat|lobehub$|@lobehub\/)/, "Lobe Chat"],
  [/^weaviate( oss)?$/, "Weaviate"],
  [/^5ire\b/, "5ire"],
  [/bedrock agentcore/, "Amazon Bedrock AgentCore"],
  [/^browser[- ]use\b/, "Browser Use"],
  [/^stable[- ]diffusion[- ]webui$/, "Stable Diffusion WebUI"],
  [/^chuanhu ?chatgpt$/, "ChuanhuChatGPT"],
  [/^guardrails[- ]ai$/, "Guardrails AI"],
  [/^gpt[-_ ]academic$/, "GPT Academic"],
  [/^agno$/, "Agno"],
];

const LABELS = new Map(RULES.map(([, label]) => [label.toLowerCase(), label]));

/** The display label for a product name: its family, or the name itself. A family label maps to itself. */
export function productFamily(name: string): string {
  const n = name.trim();
  const key = n.toLowerCase();
  const label = LABELS.get(key);
  if (label) return label;
  for (const [re, family] of RULES) if (re.test(key)) return family;
  return n;
}

/* ---------- Product index: the per-product watch pages ---------- */

/**
 * The CISA KEV marker. The collector learns about KEV listings in two ways,
 * the NVD feed's cisaExploitAdd date and the CISA KEV feed itself, and tells
 * the classifier so the record gets severity 3. No record field stores that
 * fact: what survives into the dataset is the "cisa-kev" tag the classifier
 * writes, and, for a record the KEV feed filed, a source on the catalog.
 * Both are read here. A listing CISA added after the collector last saw a
 * CVE leaves no trace, so the flag can be missing, never wrong.
 */
export const KEV_TAG = "cisa-kev";
const KEV_CATALOG = /^https?:\/\/(?:www\.)?cisa\.gov\/known-exploited-vulnerabilities-catalog\b/i;

export function isKevMarked(i: Pick<Incident, "tags" | "sources">): boolean {
  return i.tags.some((t) => t.toLowerCase() === KEV_TAG) || i.sources.some((s) => KEV_CATALOG.test(s.url));
}

const CVE_IN_TEXT = /\bCVE-\d{4}-\d{4,}\b/gi;
const CVE_TAG = /^CVE-\d{4}-\d{4,}$/i;

/** CVE ids a record carries in its tags or title: upper-cased, unique, highest id first. */
export function cveIds(i: Pick<Incident, "tags" | "title">): string[] {
  const out = new Set<string>();
  for (const t of i.tags) if (CVE_TAG.test(t)) out.add(t.toUpperCase());
  for (const m of i.title.matchAll(CVE_IN_TEXT)) out.add(m[0].toUpperCase());
  return sortCves([...out]);
}

function sortCves(ids: string[]): string[] {
  return ids.sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
}

/** URL slug of a family label: "Claude Code + SDKs" -> "claude-code-sdks". Names differing only in case or punctuation share a slug. */
export function productSlug(label: string): string {
  return label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface ProductStats {
  /** Family label (productFamily), or the most frequent spelling of an unmatched name. */
  label: string;
  slug: string;
  /** The product names as filed that map here, most frequent first. */
  names: string[];
  /** Every record naming the product, in any position. */
  records: number;
  /** Records counted as incidents (lib/counting.ts). */
  incidents: number;
  /** CVEs and advisories with no confirmed exploitation. */
  disclosed: number;
  /** Severity 3-4: confirmed exploitation or real-world loss. */
  exploited: number;
  /** Records carrying the CISA KEV marker (isKevMarked). */
  kev: number;
  bySeverity: Record<Severity, number>;
  /** Newest first report among the records. */
  latest: string;
  /** Unique CVE ids across the records, highest first. */
  cves: string[];
}

export interface ProductGroup extends ProductStats {
  /** The records, newest first by first report, then id. */
  items: Incident[];
}

function newestFirst(a: Incident, b: Incident): number {
  return b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id);
}

function mostFrequent(counts: Map<string, number>): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

function statsOf(label: string, slug: string, names: string[], items: Incident[]): ProductStats {
  const bySeverity: Record<Severity, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let disclosed = 0;
  let exploited = 0;
  let kev = 0;
  let latest = "";
  const cves = new Set<string>();
  for (const i of items) {
    bySeverity[i.severity] += 1;
    if (isDisclosedIncident(i)) disclosed += 1;
    if (i.severity >= REAL_WORLD_MIN_SEVERITY) exploited += 1;
    if (isKevMarked(i)) kev += 1;
    if (i.first_reported > latest) latest = i.first_reported;
    for (const id of cveIds(i)) cves.add(id);
  }
  return { label, slug, names, records: items.length, incidents: items.length - disclosed, disclosed, exploited, kev, bySeverity, latest, cves: sortCves([...cves]) };
}

/**
 * One group per product family that has records. A record is filed under
 * every family its products map to, once per family; families whose labels
 * differ only in case or punctuation (unmatched names as filed: "Agno" and
 * "agno") share a slug and a page, labelled by the most frequent spelling.
 * Sorted by most records, then most recent, then label.
 */
export function buildProductIndex(incidents: readonly Incident[]): ProductGroup[] {
  const groups = new Map<string, { labels: Map<string, number>; names: Map<string, number>; items: Incident[]; seen: Set<string> }>();
  for (const i of incidents) {
    for (const raw of i.products) {
      const label = productFamily(raw);
      const slug = productSlug(label);
      if (!slug) continue;
      let g = groups.get(slug);
      if (!g) {
        g = { labels: new Map(), names: new Map(), items: [], seen: new Set() };
        groups.set(slug, g);
      }
      g.labels.set(label, (g.labels.get(label) ?? 0) + 1);
      const name = raw.trim();
      g.names.set(name, (g.names.get(name) ?? 0) + 1);
      if (g.seen.has(i.id)) continue;
      g.seen.add(i.id);
      g.items.push(i);
    }
  }
  const out: ProductGroup[] = [];
  for (const [slug, g] of groups) {
    const items = g.items.sort(newestFirst);
    const label = mostFrequent(g.labels)[0] ?? slug;
    out.push({ ...statsOf(label, slug, mostFrequent(g.names), items), items });
  }
  return sortProducts(out, "records");
}

export type ProductSort = "records" | "recent" | "name";

export const PRODUCT_SORTS: readonly { key: ProductSort; label: string; title: string }[] = [
  { key: "records", label: "most records", title: "Most records first" },
  { key: "recent", label: "most recent", title: "Newest first report first" },
  { key: "name", label: "a–z", title: "Alphabetical" },
];

/** A sorted copy. Ties break towards more records, then the newer family, then the label. */
export function sortProducts<T extends Pick<ProductStats, "label" | "records" | "latest">>(list: readonly T[], by: ProductSort): T[] {
  const copy = [...list];
  const byLabel = (a: T, b: T) => a.label.localeCompare(b.label, "en", { sensitivity: "base" });
  if (by === "recent") return copy.sort((a, b) => b.latest.localeCompare(a.latest) || b.records - a.records || byLabel(a, b));
  if (by === "name") return copy.sort((a, b) => byLabel(a, b) || b.records - a.records);
  return copy.sort((a, b) => b.records - a.records || b.latest.localeCompare(a.latest) || byLabel(a, b));
}

/** Disclosed vulnerabilities per month of first report: the `months` months ending at `to` (YYYY-MM), oldest first. */
export function monthlyDisclosures(items: readonly Incident[], to: string, months = 24): { month: string; count: number }[] {
  const keys = monthRange(shiftMonth(to, -(months - 1)), to);
  const counts = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const i of items) {
    if (!isDisclosedIncident(i)) continue;
    const k = i.first_reported.slice(0, 7);
    const n = counts.get(k);
    if (n !== undefined) counts.set(k, n + 1);
  }
  return keys.map((month) => ({ month, count: counts.get(month) ?? 0 }));
}

/** The incidents explorer filtered to the family. Its product filter reads the first product a record names, so it can show fewer records than the product page. */
export function explorerHref(label: string): string {
  return `/incidents?kind=all&product=${encodeURIComponent(label)}`;
}

/** Page href of the product a record names, as filed; null for a blank name. */
export function productHref(name: string): string | null {
  const slug = productSlug(productFamily(name));
  return slug ? `/products/${slug}` : null;
}

/** The index, built once per dataset array (every product page and its metadata ask for it). */
const indexes = new WeakMap<readonly Incident[], ProductGroup[]>();

export function productIndex(incidents: readonly Incident[]): ProductGroup[] {
  let index = indexes.get(incidents);
  if (!index) {
    index = buildProductIndex(incidents);
    indexes.set(incidents, index);
  }
  return index;
}

export function productBySlug(incidents: readonly Incident[], slug: string): ProductGroup | undefined {
  return productIndex(incidents).find((p) => p.slug === slug);
}
