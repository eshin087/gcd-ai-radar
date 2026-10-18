import { describe, expect, it } from "vitest";
import { productFamily } from "../lib/products";

/** Product names as filed in data/incidents.json, by the family they should show under. */
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
