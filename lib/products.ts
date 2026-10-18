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
