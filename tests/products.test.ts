import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProductIndex,
  cveIds,
  explorerHref,
  isKevMarked,
  monthlyDisclosures,
  productFamily,
  productHref,
  productSlug,
  sortProducts,
} from "../lib/products";
import { isDisclosedIncident } from "../lib/counting";
import type { Incident } from "../lib/schema";
import { readIncidents } from "../lib/shards";

/** Product names as filed in the dataset (data/incidents/<year>.json), by the family they should show under. */
const FAMILIES: Record<string, string[]> = {
  Langflow: ["Langflow", "Langflow OSS", "IBM Langflow OSS", "langflow", "IBM Langflow Desktop", "Langflow Desktop"],
  "Open WebUI": ["Open WebUI", "open-webui"],
  Flowise: ["Flowise", "FlowiseAI", "FlowiseAI Flowise", "Flowise Cloud"],
  vLLM: ["vLLM", "vllm", "vLLM AIBrix", "vLLM Hardware Plugin for Intel Gaudi", "vllm-metal"],
  "MCP SDKs": [
    "mcp",
    "mcp gem",
    "RMCP",
    "MCP Python SDK",
    "Model Context Protocol Python SDK",
    "MCP TypeScript SDK",
    "Model Context Protocol Java SDK",
    "Go MCP SDK",
    "MCP Inspector",
    "@modelcontextprotocol/sdk",
    "Model Context Protocol",
  ],
  "MCP servers & tools": [
    "MCP Atlassian",
    "mcp-atlassian",
    "dbt-mcp",
    "@zereight/mcp-gitlab",
    "mcp-server-git",
    "@modelcontextprotocol/server-filesystem",
    "MKP Model Context Protocol server",
    "Slack Model Context Protocol Server",
    "ToolHive",
    "FrontMCP",
    "MCPVault",
    "Ollama MCP Server",
    "Ollama-mcp",
  ],
  FastMCP: ["FastMCP"],
  "Claude Code + SDKs": ["Claude Code", "Claude Code Action", "Claude SDK for Python", "Claude SDK for TypeScript", "Claude Agent SDK", "@anthropic-ai/claude-code"],
  "Claude Code UI": ["Claude Code UI", "Cloud CLI"],
  LiteLLM: ["LiteLLM", "litellm"],
  "NVIDIA NeMo": ["NVIDIA NeMo Framework", "NVIDIA NeMo", "NeMo Framework", "NVIDIA Nemo Framework", "NVIDIA NeMo Speech", "NVIDIA NeMo Curator", "NVIDIA NeMo Agent Toolkit"],
  "NVIDIA NemoClaw": ["NVIDIA NemoClaw", "NeMoClaw"],
  "NVIDIA TensorRT-LLM": ["TensorRT-LLM", "NVIDIA TensorRT-LLM"],
  Dify: ["Dify", "dify"],
  "Hugging Face libraries": ["transformers", "Transformers", "Hugging Face Transformers", "Diffusers", "diffusers", "sentence-transformers"],
  "LangChain family": [
    "LangChain",
    "langchain",
    "Langchain",
    "langchain-core",
    "langchain-community",
    "@langchain/community",
    "langchain_experimental",
    "LangChain JS",
    "langchainjs",
    "langchain-ai langgraph",
    "LangGraph",
    "LangSmith SDK",
  ],
  "Langchain-Chatchat": ["Langchain-Chatchat", "Langchain Chatchat", "LangChain-ChatChat"],
  LangChain4j: ["LangChain4j", "Quarkus LangChain4j"],
  LlamaIndex: ["LlamaIndex", "llama-index-core", "llama_index", "llama-index"],
  "llama.cpp": ["llama.cpp"],
  Ollama: ["Ollama", "ollama"],
  "ComfyUI + custom nodes": ["ComfyUI", "ComfyUI-Manager", "comfyui_segment_anything", "ComfyUI-Impact-Pack"],
  Gradio: ["Gradio", "gradio"],
  "GitHub Copilot": ["GitHub Copilot", "GitHub Copilot CLI"],
  "Microsoft 365 Copilot": ["Microsoft 365 Copilot", "Microsoft 365 Copilot BizChat", "Microsoft 365 Copilot Business Chat"],
  "Copilot Studio": ["Copilot Studio", "copilot studio", "Microsoft Copilot Studio"],
  AnythingLLM: ["AnythingLLM", "anything-llm"],
  LoLLMs: ["lollms", "lollms-webui", "LoLLMs", "LoLLMS WebUI"],
  "Lobe Chat": ["Lobe Chat", "lobe-chat", "@lobehub/chat", "LobeHub"],
  "OpenAI Codex": ["OpenAI Codex CLI", "Codex CLI"],
};

describe("productFamily", () => {
  for (const [family, names] of Object.entries(FAMILIES)) {
    it(`groups ${family}`, () => {
      for (const name of names) expect(productFamily(name), name).toBe(family);
    });
  }

  it("keeps third-party tools and look-alike names apart from the product they build on", () => {
    for (const name of [
      "claude-code-router",
      "Claude Code Templates",
      "ClaudeHookBridge",
      "Claude Desktop",
      "Obsidian GitHub Copilot Plugin",
      "CodexBar",
      "gemini-bridge",
      "vllm-orchestrator-gateway",
      "LangChain-ChatGLM-Webui",
      "LangChain4j-AIDeepin",
      "Langchaingo",
      "llama-cpp-python",
      "Weaviate Verba",
      "wandb OpenUI",
      "text-generation-webui",
    ])
      expect(productFamily(name), name).toBe(name);
  });

  it("shows an unmatched name as filed, trimmed", () => {
    expect(productFamily("Qdrant")).toBe("Qdrant");
    expect(productFamily("  obsidian-tc ")).toBe("obsidian-tc");
    expect(productFamily("")).toBe("");
  });

  it("maps every family label to itself", () => {
    for (const family of Object.keys(FAMILIES)) expect(productFamily(family), family).toBe(family);
    for (const names of Object.values(FAMILIES)) for (const name of names) expect(productFamily(productFamily(name)), name).toBe(productFamily(name));
  });
});

/** A valid record with the fields the product index reads; the rest are fixed. */
function rec(p: Partial<Incident> & { id: string; products: string[]; first_reported: string }): Incident {
  const sources = p.sources ?? [{ url: `https://nvd.nist.gov/vuln/detail/${p.id}`, publisher: "NVD", title: p.id, published_at: p.first_reported }];
  return {
    slug: p.id.toLowerCase(),
    title: `Fixture ${p.id}`,
    summary: "A fixture record used by the product index tests.",
    type: "attack_on_ai",
    categories: ["infra_vuln"],
    severity: 2,
    targets: ["framework_or_tooling"],
    incident_date: p.first_reported,
    incident_date_precision: "day",
    confidence: 0.9,
    status: "published",
    origin: "seed_nvd",
    tags: [],
    created_at: "2026-10-18T00:00:00Z",
    updated_at: "2026-10-18T00:00:00Z",
    ...p,
    sources,
    source_count: sources.length,
  };
}

const FIXTURES: Incident[] = [
  rec({ id: "AIR-2026-0001", products: ["Langflow"], first_reported: "2026-09-02", tags: ["CVE-2026-1000", "rce"] }),
  rec({ id: "AIR-2026-0002", products: ["Langflow OSS", "LiteLLM"], first_reported: "2026-10-01", title: "CVE-2026-2000: chained flaw", tags: ["cve-2026-2000"] }),
  rec({ id: "AIR-2025-0003", products: ["IBM Langflow OSS"], first_reported: "2025-05-06", severity: 3, tags: ["CVE-2025-3248", "cisa-kev"] }),
  rec({
    id: "AIR-2026-0004",
    products: ["Langflow"],
    first_reported: "2026-08-15",
    severity: 3,
    origin: "news",
    sources: [{ url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog?field_cve=CVE-2026-9999", publisher: "CISA", title: "KEV", published_at: "2026-08-15" }],
  }),
  rec({ id: "AIR-2026-0005", products: ["qdrant"], first_reported: "2026-07-01" }),
  rec({ id: "AIR-2026-0006", products: ["Qdrant"], first_reported: "2026-06-01" }),
  rec({ id: "AIR-2026-0007", products: ["Qdrant"], first_reported: "2026-06-02" }),
  rec({ id: "AIR-2024-0008", products: ["Claude Code"], first_reported: "2024-01-10", severity: 1, origin: "news", sources: [{ url: "https://example.com/research", publisher: "Embrace The Red", title: "write-up", published_at: "2024-01-10" }] }),
  rec({ id: "AIR-2026-0009", products: ["Langflow", "langflow"], first_reported: "2026-09-02" }),
  rec({ id: "AIR-2026-0010", products: [], first_reported: "2026-09-03", severity: 4, origin: "news" }),
];

describe("product slugs and links", () => {
  it("makes URL-safe slugs that merge case and punctuation variants", () => {
    expect(productSlug("Claude Code + SDKs")).toBe("claude-code-sdks");
    expect(productSlug("llama.cpp")).toBe("llama-cpp");
    expect(productSlug("@zereight/mcp-gitlab")).toBe("zereight-mcp-gitlab");
    expect(productSlug("Qdrant")).toBe(productSlug("qdrant"));
    expect(productSlug("  ")).toBe("");
  });

  it("links a filed name to its family's page and the explorer to the family filter", () => {
    expect(productHref("IBM Langflow OSS")).toBe("/products/langflow");
    expect(productHref("")).toBeNull();
    expect(explorerHref("MCP servers & tools")).toBe("/incidents?kind=all&product=MCP%20servers%20%26%20tools");
  });
});

describe("cveIds and isKevMarked", () => {
  it("collects CVE ids from tags and titles, upper-cased and unique, highest first", () => {
    expect(cveIds({ tags: ["cve-2026-2000", "rce"], title: "CVE-2026-2000 and CVE-2026-10001 in one" })).toEqual(["CVE-2026-10001", "CVE-2026-2000"]);
    expect(cveIds({ tags: ["CVE-2026-1"], title: "no ids here" })).toEqual([]);
  });

  it("reads the classifier's cisa-kev tag and a source on the KEV catalog, nothing else", () => {
    expect(isKevMarked(FIXTURES[2]!)).toBe(true);
    expect(isKevMarked(FIXTURES[3]!)).toBe(true);
    expect(isKevMarked(FIXTURES[0]!)).toBe(false);
    expect(isKevMarked({ tags: ["kev-adjacent"], sources: [{ url: "https://example.com/known-exploited-vulnerabilities-catalog", publisher: "x", title: "x", published_at: "2026-01-01" }] })).toBe(false);
  });
});

describe("buildProductIndex", () => {
  const index = buildProductIndex(FIXTURES);
  const by = (slug: string) => index.find((p) => p.slug === slug)!;

  it("groups every name of a family, counts a record once per family and files multi-product records under each", () => {
    const lf = by("langflow");
    expect(lf.label).toBe("Langflow");
    expect(lf.items.map((i) => i.id)).toEqual(["AIR-2026-0002", "AIR-2026-0009", "AIR-2026-0001", "AIR-2026-0004", "AIR-2025-0003"]);
    expect(lf.names).toEqual(["Langflow", "IBM Langflow OSS", "langflow", "Langflow OSS"]);
    expect(by("litellm").items.map((i) => i.id)).toEqual(["AIR-2026-0002"]);
  });

  it("counts incidents, disclosed CVEs, exploitation, KEV flags and severities", () => {
    const lf = by("langflow");
    expect(lf).toMatchObject({ records: 5, disclosed: 3, incidents: 2, exploited: 2, kev: 2, latest: "2026-10-01" });
    expect(lf.bySeverity).toEqual({ 1: 0, 2: 3, 3: 2, 4: 0 });
    expect(lf.cves).toEqual(["CVE-2026-2000", "CVE-2026-1000", "CVE-2025-3248"]);
    expect(by("claude-code-sdks")).toMatchObject({ records: 1, incidents: 1, disclosed: 0, exploited: 0, kev: 0 });
  });

  it("merges unmatched names that differ only in case under the most frequent spelling", () => {
    expect(productFamily("qdrant")).toBe("qdrant");
    expect(index.filter((p) => p.slug === "qdrant")).toHaveLength(1);
    expect(by("qdrant")).toMatchObject({ label: "Qdrant", records: 3, names: ["Qdrant", "qdrant"] });
  });

  it("leaves records that name no product out of every page", () => {
    expect(index.some((p) => p.items.some((i) => i.id === "AIR-2026-0010"))).toBe(false);
  });

  it("sorts by records, by most recent and by name", () => {
    expect(index.map((p) => p.slug)).toEqual(["langflow", "qdrant", "litellm", "claude-code-sdks"]);
    expect(sortProducts(index, "recent").map((p) => p.slug)).toEqual(["langflow", "litellm", "qdrant", "claude-code-sdks"]);
    expect(sortProducts(index, "name").map((p) => p.slug)).toEqual(["claude-code-sdks", "langflow", "litellm", "qdrant"]);
  });
});

describe("monthlyDisclosures", () => {
  it("counts disclosed records per month of first report in a fixed window ending at the given month", () => {
    const lf = buildProductIndex(FIXTURES).find((p) => p.slug === "langflow")!;
    const series = monthlyDisclosures(lf.items, "2026-10", 3);
    expect(series).toEqual([
      { month: "2026-08", count: 0 },
      { month: "2026-09", count: 2 },
      { month: "2026-10", count: 1 },
    ]);
    expect(monthlyDisclosures(lf.items, "2026-10")).toHaveLength(24);
  });
});

const live = (await readIncidents(path.join(process.cwd(), "data"))).incidents.filter((i) => i.status === "published");

describe("product index on the live dataset", () => {
  const published = live;
  const index = buildProductIndex(published);

  it("gives every family a unique, non-empty slug", () => {
    const slugs = index.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("files every record that names a product, and only those", () => {
    const filed = new Set(index.flatMap((p) => p.items.map((i) => i.id)));
    const named = published.filter((i) => i.products.some((n) => productSlug(productFamily(n))));
    expect(filed.size).toBe(named.length);
  });

  it("keeps each page's counts consistent with its records", () => {
    for (const p of index) {
      expect(p.records, p.slug).toBe(p.items.length);
      expect(p.incidents + p.disclosed, p.slug).toBe(p.records);
      expect(p.disclosed, p.slug).toBe(p.items.filter(isDisclosedIncident).length);
      expect(Object.values(p.bySeverity).reduce((a, b) => a + b, 0), p.slug).toBe(p.records);
      expect(p.latest, p.slug).toBe(p.items[0]!.first_reported);
    }
  });
});
