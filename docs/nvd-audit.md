# NVD / GHSA vulnerability record audit

Audit date: 2026-10-18, against `data/incidents.json` at commit `91f304c`. All window figures use the dashboard default: the last 24 months by incident date, 2024-11 to 2026-10 inclusive, published records only.

**Status: applied on 2026-10-18.** The owner approved config change B, with Gradio kept. `scripts/prune-packages.ts` retired 171 incidents (242 source URLs) after `scripts/repair-cve-dedup.ts` ran (see `docs/cve-dedup.md`). That left 1,911 published incidents, 1,595 of them in the window, with 82.8% infrastructure vulnerabilities, as predicted below. The owner then chose option 3 of the counting question at the end: CVEs and advisories with no confirmed exploitation are now "disclosed vulnerabilities", shown as their own series and not counted as incidents (rule in `lib/counting.ts`). After that, the published records split into 402 incidents and 1,509 disclosed vulnerabilities.

## Answer in brief

1. **Keyword noise is small.** Of 1,685 published NVD and GHSA records, 16 are outright false positives: generic apps that have an AI or MCP feature, and classic cloud ML services. Another 155 are real CVEs in pre-LLM ML platforms that fail the allow-list's own "LLM/agent-era" rule: NVIDIA Triton Inference Server, MLflow and Ray. The other ~1,500 are real CVEs in genuine LLM and agent tooling.
2. **Fixing the keywords barely moves the headline.** With every proposed drop applied, infrastructure vulnerabilities fall from 84.0% to 82.8% of incidents in the window (82.5% if Gradio also goes).
3. **The 84% comes from the counting unit, not the allow-list.** In the window, 1,449 of the 1,456 vulnerability records (99.5%) are severity 2: disclosed and patched, with no attack. Their monthly volume grew from about 3 a month to 209 in September 2026. Much of that is vendors and CNAs filing batches: 30 Open WebUI advisories on one day, 29 MCP Atlassian CVEs on one day, and 24 IBM Langflow CVEs on one day. The other 260 incidents in the window run at about 5–23 a month. The default "All incidents" trend line therefore mostly measures CVE issuance for AI tools.
4. **Recommendation.** Apply config change B below. It removes 171 records, 121 of them in the window. Separately, decide whether disclosed-but-unexploited CVEs should count as "incidents" in the headline at all (options at the end). That decision changes the picture far more than any keyword change.

Note: the brief quoted 1,440 of 1,715 and 1,454 for Framework / tooling. The 15:55Z run added one incident since, so today's figures are 1,441 of 1,716 and 1,455.

## Method

- Selected `status = published` records with `origin` of `seed_nvd` (974) or `seed_ghsa` (711).
- **NVD keyword.** The matched keyword is kept on the candidate (`extra.matched_keyword`) but not on the published incident. I recovered it by searching each record's stored title, summary, products and source title for the `nvd_keywords` terms. That matched 947 of 974 records. The other 27 matched only through CVE description text the record does not store, or through spelling variants such as "text-generation-webui". I read all 27. All are AI tools except 1Panel (dropped below); NVIDIA Riva is marked unsure.
- **Product family.** Product strings are not normalised ("Langflow", "Langflow OSS", "IBM Langflow OSS", "IBM Langflow Desktop" and so on), so I grouped them with ordered regexes into 43 families. The scripts (`audit.cjs`, `scenarios.cjs`, `afterb.cjs`, run as `node audit.cjs <repo-root>`) and their JSON output are in the side-session notes folder under `nvd-audit-scripts/`, not in the repo.
- **Before/after counts.** I reimplemented the prune script's `matchesDropped` rule (word-bounded match on products and title). Its totals match the real `prune-packages.ts --dry-run` output exactly for scenarios A, B and C.

## Keyword precision (NVD)

Each count is the number of NVD records whose stored text contains the term. A record can contain more than one term.

| Keyword | Records | Off-target or weak | Verdict |
|---|---:|---|---|
| Langflow | 171 | 0 | keep |
| Model Context Protocol | 130 | 3 (Next.js ×2, OpenPanel), plus 1Panel matched through the full description | keep; drop the 4 products |
| Flowise | 67 | 0 | keep |
| Triton Inference Server | 65 | 0, but the product is pre-LLM | **remove** |
| Dify | 59 | 0 | keep |
| NVIDIA NeMo | 55 | 0 | keep |
| vLLM | 54 | 0 | keep |
| Open WebUI | 48 | 0 | keep |
| llama.cpp | 38 | 0 | keep |
| LangChain | 31 | 0 | keep |
| AnythingLLM, ComfyUI, Ollama, Claude Code, GitHub Copilot | 20–25 each | 1 under Ollama (Wallos, a subscription tracker with an Ollama host setting) | keep; drop Wallos |
| Gradio | 16 | 0, but a generic web UI framework | unsure |
| MLflow | 12 (+69 GHSA) | 0, but the product is pre-LLM | **remove** |
| Azure AI | 8 | 4 (AI Search ×2, Face, Language) | **tighten** to "Azure AI Foundry" and "Azure OpenAI" |
| Vertex AI | 5 | 4 (Workbench, Search for Commerce, Experiments, aiplatform SDK) | **tighten** to "Vertex AI Agent" |
| Microsoft 365 Copilot | 6 | 1 (Kiota plugin generator) | keep; drop Kiota |
| Amazon Bedrock | 4 | 1 (Kibana connector, 2024, outside the window) | keep; drop Kibana |
| LiteLLM | 12 | 1 (Tandoor Recipes) | keep; drop Tandoor |
| Ray Dashboard | 1 | 0, but the product is pre-LLM | **remove** |
| All others | 1–13 each | 0 | keep |

A matching problem in GHSA: the pip package `triton` is OpenAI's Triton GPU compiler, not NVIDIA's server. It has produced 0 records. It belongs with PyTorch, so it is removed in the proposal.

## Largest 20 product families

Columns: **24m** = records in the window · **All** = all time · **N/G** = NVD/GHSA split · **Busiest day** = most records with the same incident date, a sign of batch disclosure. Sample titles are the newest, middle and oldest record in the window.

| # | Family | 24m | All | N/G | Busiest day | Verdict | Sample titles |
|---:|---|---:|---:|---|---|---|---|
| 1 | Langflow (incl. IBM Langflow OSS/Desktop) | 202 | 206 | 171/35 | 2026-10-07 (24) | **keep** | CVE-2026-93675: IBM Langflow OSS dependency confusion vulnerability · CVE-2026-10547: IBM Langflow OSS Ownership Validation Flaw · CVE-2024-48061: Langflow Remote Code Execution Vulnerability |
| 2 | Open WebUI | 182 | 186 | 48/138 | 2026-05-14 (30) | **keep** | CVE-2026-109288: Open WebUI stored XSS vulnerability allows JWT theft · CVE-2026-54015: Open WebUI prompt history IDOR allows cross-prompt read and deletion · CVE-2024-7035: Open WebUI vulnerable to Cross-Site Request Forgery |
| 3 | Flowise | 162 | 172 | 67/105 | 2026-08-04 (26) | **keep** | CVE-2026-73483: Flowise NodeVM sandbox escape via puppeteer configuration · CVE-2025-71331: Flowise cross-site scripting flaw in chat messages and agent functions · CVE-2024-58351: Flowise OverrideConfig security vulnerability |
| 4 | vLLM | 112 | 114 | 54/60 | 2026-10-05 (9) | **keep** | CVE-2026-109311: vLLM audio transcription endpoint heap overflow vulnerability · CVE-2026-15574: vllm-orchestrator-gateway Logs Sensitive Bearer Tokens and Chat Content · CVE-2025-25183: vLLM vulnerable to hash collisions in prefix cache |
| 5 | MCP servers (third-party) | 101 | 101 | 100/1 | 2026-09-22 (29, MCP Atlassian) | **keep** | CVE-2026-77361: obsidian-tc MCP server symlink path traversal vulnerability · CVE-2026-54688: SSRF vulnerability in mcp-searxng MCP server · CVE-2025-47274: Insecure Secret Storage in ToolHive MCP Server Utility |
| 6 | NVIDIA Triton Inference Server | 58 | 65 | 65/0 | 2025-08-06 (17) | **drop** | NVIDIA Triton Inference Server for Linux vulnerable to excessive iteration denial of service · NVIDIA Triton Inference Server Information Disclosure Vulnerability · CVE-2024-53880: Integer overflow in NVIDIA Triton Inference Server |
| 7 | Claude Code / Anthropic SDKs | 51 | 51 | 21/30 | 2026-02-06 (4) | **keep** | CVE-2026-96620: Claude Agent SDK Command Injection Vulnerability · CVE-2026-31862: RCE vulnerability in Cloud CLI Claude Code UI · CVE-2025-52882: Claude Code improper authorization via websocket connections |
| 8 | MLflow | 42 | 80 | 11/69 | 2024-06-04 (9) | **drop** | CVE-2026-96804: MLflow statsmodel Flavor Insecure Deserialization Vulnerability · CVE-2026-33865: MLflow Stored XSS via Malicious MLmodel Artifacts · CVE-2024-27134: MLflow directory permissions lead to local privilege escalation |
| 9 | LiteLLM | 42 | 50 | 11/39 | 2026-06-21 (10) | **keep** | CVE-2026-108575: Improper authorization flaw in BerriAI LiteLLM secret resolution · CVE-2026-12798: BerriAI litellm SSRF via spec_path URL loader · CVE-2024-6825: LiteLLM Vulnerable to Remote Code Execution via Rules |
| 10 | NVIDIA NeMo (Framework, Speech, Curator, Agent Toolkit) | 38 | 41 | 41/0 | 2026-02-18 (10) | **keep** | CVE-2026-65111: NVIDIA NeMo Speech Code Injection Vulnerability · CVE-2025-33246: Command injection vulnerability in NVIDIA NeMo Framework · CVE-2025-23360: NVIDIA Nemo Framework path traversal vulnerability |
| 11 | Dify | 37 | 37 | 37/0 | 2026-04-20 (4) | **keep** | CVE-2026-105762: SSRF vulnerability in Dify remote file upload endpoint · CVE-2026-26023: Cross-site scripting vulnerability in Dify LLM platform · CVE-2025-0185: Pandas query injection vulnerability in Dify Vanna module |
| 12 | MCP official SDKs | 34 | 34 | 21/13 | 2026-07-29 (5) | **keep** | Model Context Protocol Python SDK Unbounded Session Accumulation Flaw · CVE-2026-11624: Model Context Protocol lacks Origin header validation allowing DNS rebinding · CVE-2025-49596: MCP Inspector Authentication Bypass and RCE |
| 13 | Hugging Face libraries (transformers, diffusers, sentence-transformers) | 33 | 37 | 10/27 | 2025-12-23 (8) | **keep** | Hugging Face Transformers Downloads Custom Code Before Consent · CVE-2025-14929: Hugging Face Transformers Deserialization Vulnerability · CVE-2024-11392: Deserialization vulnerability in Hugging Face Transformers |
| 14 | LangChain family (incl. LangGraph, LangChain4j, langchaingo) | 32 | 63 | 19/44 | 2024-10-29 (3) | **keep** | CVE-2026-108748: Memory exhaustion in Quarkus LangChain4j chat-scopes WebSocket · CVE-2026-25750: URL parameter injection in Langchain Helm Charts exposing auth tokens · CVE-2025-21604: File upload conflict vulnerability in LangChain4j-AIDeepin |
| 15 | llama.cpp | 28 | 40 | 39/1 | 2026-08-06 (10) | **keep** | CVE-2026-107183: Use-after-free and double free vulnerability in llama.cpp · CVE-2026-43629: Heap buffer overflow in llama.cpp KV cache state restore · CVE-2025-49847: Buffer overflow in llama.cpp vocabulary loading |
| 16 | Ollama | 28 | 35 | 20/15 | 2025-03-20 (6) | **keep** | CVE-2026-108836: Server-side request forgery in Ollama pull API · CVE-2025-15063: Ollama MCP Server Command Injection RCE Vulnerability · Ollama Server Vulnerable to Denial of Service via Crafted GZIP |
| 17 | ComfyUI (+ custom nodes) | 22 | 22 | 22/0 | 2026-07-31 (5) | **keep** | CVE-2026-108962: Code injection in comfyui_segment_anything · CVE-2026-6591: Path traversal vulnerability in ComfyUI LoadImage node · CVE-2024-21575: Path traversal vulnerability in ComfyUI-Impact-Pack |
| 18 | Gradio | 21 | 57 | 9/48 | 2024-10-10 (13) | **unsure** | Gradio SSRF and Open Redirect Vulnerability CVE-2026-59806 · CVE-2025-0187: Denial of service vulnerability in Gradio file upload feature · CVE-2024-48052: Gradio Server Side Request Forgery Vulnerability |
| 19 | GitHub Copilot | 21 | 21 | 21/0 | 2026-02-10 (5) | **keep** | GitHub Copilot and Visual Studio Code vulnerable to credential disclosure · CVE-2026-23653: Command Injection Flaw in GitHub Copilot and VS Code · CVE-2025-53773: Command Injection Vulnerability in GitHub Copilot and Visual Studio |
| 20 | AnythingLLM | 20 | 25 | 25/0 | 2026-03-16 (6) | **keep** | AnythingLLM Stored Vulnerability in System Preferences · CVE-2026-32628: AnythingLLM SQL Injection in SQL Agent · CVE-2024-13060: Access control flaw in AnythingLLM profile picture access |

Why each non-keep verdict:

- **NVIDIA Triton Inference Server: drop.** It is a general-purpose model server from 2018 (formerly TensorRT Inference Server). Its 65 CVEs are almost all memory-safety, DoS and path-traversal bugs in the C++ HTTP/gRPC front end and its backends, and NVIDIA files them in bulletins (17 on 2025-08-06). That is the same reason TensorFlow and ONNX Runtime were dropped. LLM serving through it stays covered by **TensorRT-LLM** (13 records, kept) and by NeMo.
- **MLflow: drop.** It is an MLOps experiment tracker and model registry from 2018, in the same class as BentoML, KServe and Feast, which are already dropped. Most CVEs are path traversal and pickle deserialization in the tracking server. The cost: 7 records cover LLM-era features (AI Gateway ×4, trace API, MLflow Assistant, a LangChain-flavoured loader), and they go too, because the prune works on product names. Note that MLflow was kept in the earlier narrowing, so this reverses that decision if you agree.
- **Gradio: unsure.** It is a Python web UI framework for ML demos from 2019. Its CVEs are generic web bugs (SSRF, path traversal, CORS). The AI link is real, though: Hugging Face Spaces and most self-hosted LLM and diffusion UIs run on it. Dropping it removes 59 records, including 2 LLaVA and F5-TTS records whose titles mention Gradio. I'd keep it, but it is the clearest remaining judgement call.
- **MCP servers (third-party): keep.** These are agent tooling by the taxonomy's own definition of infra_vuln. Many are single-maintainer projects (obsidian-tc, mcp-searxng, x64dbg-MCP), and MCP Atlassian alone has 34 records, 29 of them filed on 2026-09-22.

### Smaller groups flagged

| Group | 24m | All | Verdict | Records |
|---|---:|---:|---|---|
| Generic apps with an AI or MCP feature | 7 | 8 | **drop** | Tandoor Recipes (AI provider SSRF), Wallos (AI endpoint SSRF), OpenPanel (MCP token in logs), 1Panel (MCP server cert check), Next.js ×2 (dev-server MCP endpoint), Kiota (Copilot plugin generator), Kibana (Bedrock connector, 2024) |
| Azure AI classic services | 3 | 4 | **drop** | Azure AI Search ×2, Azure AI Face Service, Azure AI Language. Keep Azure AI Foundry (4). |
| Vertex AI classic services | 4 | 4 | **drop** | Vertex AI Workbench (managed Jupyter, consistent with the Jupyter drop), Search for Commerce, Experiments, google-cloud-aiplatform SDK. Keep GitLab AI Gateway, which matched "Vertex AI". |
| Ray | 7 | 10 | **drop** | General distributed compute. The real-world ShadowRay campaign stays as the separate MITRE ATLAS incident AIR-2025-0049 (severity 3), which is the right home for it. |
| NVIDIA Riva | 2 | 2 | unsure | Speech AI SDK, 2025-03. Left in. |
| TensorRT-LLM, NemoClaw, generative-media UIs (SD WebUI, GPT-SoVITS, F5-TTS) | 13 / 14 / 6 | | keep | LLM or generative-AI tooling. |

## Proposed config change (applied in this branch)

```diff
--- a/collector/config/packages.json
+++ b/collector/config/packages.json
@@ -1,13 +1,13 @@
 {
-  "_comment": "... Deliberately excludes classic deep-learning libraries (TensorFlow, Keras, PyTorch, ONNX) whose memory-safety CVEs are about the library, not about AI systems being attacked, and generic automation tools (n8n). ...",
+  "_comment": "... Deliberately excludes classic deep-learning libraries (TensorFlow, Keras, PyTorch, ONNX) whose memory-safety CVEs are about the library, not about AI systems being attacked, pre-LLM ML platforms (MLflow, NVIDIA Triton Inference Server, Ray), classic cloud ML services (Azure AI Search/Face/Language, Vertex AI Workbench) and generic tools (n8n). ...",
   "ghsa": {
     "pip": [
       "langchain", "langchain-core", "langchain-community", "langchain-experimental", "langgraph",
-      "llama-index", "llama-index-core", "vllm", "open-webui", "mlflow", "gradio", "langflow",
-      "litellm", "transformers", "ray", "anything-llm", "dify", "lollms", "haystack-ai",
+      "llama-index", "llama-index-core", "vllm", "open-webui", "gradio", "langflow",
+      "litellm", "transformers", "anything-llm", "dify", "lollms", "haystack-ai",
       "autogen", "crewai", "semantic-kernel", "mcp", "fastmcp", "ollama", "llama-cpp-python",
       "chromadb", "qdrant-client", "weaviate-client", "sentence-transformers", "diffusers",
-      "peft", "trl", "huggingface-hub", "triton", "nvidia-nemo", "comfyui", "openai", "anthropic",
+      "peft", "trl", "huggingface-hub", "nvidia-nemo", "comfyui", "openai", "anthropic",
@@ -23,16 +23,16 @@
   "nvd_keywords": [
-    "vLLM", "Ollama", "LangChain", "LlamaIndex", "Open WebUI", "MLflow", "Gradio", "Langflow",
+    "vLLM", "Ollama", "LangChain", "LlamaIndex", "Open WebUI", "Gradio", "Langflow",
     "LiteLLM", "llama.cpp", "llama-cpp-python", "Model Context Protocol", "AnythingLLM", "Dify",
-    "Flowise", "ComfyUI", "Ray Dashboard", "Triton Inference Server", "Hugging Face transformers",
+    "Flowise", "ComfyUI", "Hugging Face transformers",
     "Lollms", "LocalAI", "Text Generation WebUI", "ChromaDB", "Qdrant", "Weaviate",
-    "Copilot Studio", "Microsoft 365 Copilot", "GitHub Copilot", "Azure AI", "Amazon Bedrock",
-    "Vertex AI", "Gemini CLI", "Claude Code", "Codex CLI", "Cursor IDE", "Windsurf", "Lovable",
+    "Copilot Studio", "Microsoft 365 Copilot", "GitHub Copilot", "Azure AI Foundry", "Azure OpenAI", "Amazon Bedrock",
+    "Vertex AI Agent", "Gemini CLI", "Claude Code", "Codex CLI", "Cursor IDE", "Windsurf", "Lovable",
     "NVIDIA NeMo", "TensorRT-LLM", "SGLang", "Text Generation Inference"
   ],
   "dropped_packages": {
-    "_comment": "Packages removed from the allow-list on 2026-10-18; ...",
-    "names": [..., "bentoml", "datasets", "accelerate"]
+    "_comment": "Packages removed from the allow-list on 2026-10-18 (second batch from docs/nvd-audit.md: tandoor recipes onward); ...",
+    "names": [..., "bentoml", "datasets", "accelerate", "tandoor recipes", "wallos", "openpanel", "1panel", "next.js", "kiota", "kibana", "azure ai face service", "azure ai search", "azure ai language", "vertex ai workbench", "vertex ai search for commerce", "vertex ai experiments", "google-cloud-aiplatform", "triton inference server", "nvidia triton", "mlflow", "ray", "ray dashboard"]
   }
 }
```

For scenario C, also add `"gradio", "nvidia riva"` to `names`, and remove `"gradio"` from `ghsa.pip` and `"Gradio"` from `nvd_keywords`.

## Before and after (24-month window, by incident date)

Scenario A is false positives only (generic apps and classic cloud ML services). **B is recommended: A plus Triton, MLflow and Ray**, and it is what this branch's config contains. C is B plus Gradio and Riva. The retire counts come from `npx tsx scripts/prune-packages.ts --dry-run` with each config.

| | Before | A | **B** | C |
|---|---:|---:|---:|---:|
| Incidents in window | 1,716 | 1,702 | **1,595** | 1,570 |
| Infrastructure vulnerability (primary category) | 1,441 (84.0%) | 1,427 (83.8%) | **1,320 (82.8%)** | 1,295 (82.5%) |
| Framework / tooling target | 1,455 | 1,446 | **1,339** | 1,314 |
| NVD + GHSA records in window | 1,456 | 1,442 | **1,335** | 1,310 |
| Published, all time | 2,083 | 2,067 | **1,912** | 1,851 |
| Retired by prune (all time) | – | 16 | **171** | 232 |
| Source URLs marked rejected | – | 16 | **242** | 349 |

Every retired record is infra_vuln and severity 2; none are severity 3 or 4. All other categories are unchanged in every scenario:

| Category (primary, 24m) | Count |
|---|---:|
| Deepfake fraud | 130 |
| Prompt injection | 34 |
| AI-assisted intrusion | 30 |
| AI phishing / social engineering | 22 |
| Data leak | 16 |
| Agent hijack | 15 |
| Supply chain | 15 |
| Jailbreak | 5 |
| Other | 3 |
| AI-generated malware | 3 |
| Model theft / extraction | 2 |

## Should CVEs count as incidents? (Decided 2026-10-18: option 3)

**Decision.** The owner chose option 3 on 2026-10-18 and it is live. A record is a disclosed vulnerability when its severity is below 3 and it comes from the NVD or GHSA backfills, or every source is a vulnerability database (NVD, GitHub Advisory Database, MSRC). Those records stay in the dataset, have their own dashboard section and explorer filter, and carry `record_kind` in the CSV and `disclosed` in the compact JSON, but the headline, charts, tiles, RSS feed and share images count incidents only. Exploited CVEs (severity 3 and above) still count. The analysis that led to the decision follows.

Keyword cleanup cannot fix the 84% share. These figures show why:

- **No attack happened in 99.5% of them.** In the window, 1,449 of 1,456 vulnerability records are severity 2. Only 7 are severity 3: Langflow ×4, vLLM, Flowise, and the LiteLLM PyPI malware release.
- **Volume tracks CVE issuance.** Vulnerability records per month in the window: 2024-11: 11 · 2025-01: 3 · 2025-06: 15 · 2025-12: 38 · 2026-03: 68 · 2026-05: 144 · 2026-08: 163 · 2026-09: 209. Non-CVE incidents over the same period: 3–23 per month, with no upward trend.
- **Batches.** Vendors and CNAs file many CVEs on one day: Open WebUI 30 (2026-05-14), MCP Atlassian 29 (2026-09-22), Flowise 26 (2026-08-04), IBM Langflow 24 (2026-10-07), Triton 17 (2025-08-06), NemoClaw 12 (2026-08-25), TensorRT-LLM 12 (2026-07-14).

Options, with window figures after config B:

| Option | Incidents in window | Infra share | Notes |
|---|---:|---:|---|
| 1. Config B only (status quo method) | 1,595 | 82.8% | The headline trend stays a CVE-issuance trend. |
| 2. Collapse disclosure batches: one incident per product per disclosure day | 864 (604 batches + 260 others) | 70.7% | Still CVE-dominated, and it merges CVEs that are separate bugs. Not recommended. |
| 3. **Treat severity-2 CVEs as a separate "Disclosed vulnerabilities" series, out of the incident headline**; exploited CVEs (severity 3+) still count | 267 (+1,328 disclosed CVEs shown separately) | 4.9% | Matches the taxonomy's own wording: severity 2 means "no confirmed exploitation". It sits between today's "All incidents" and "Real-world only" views. Deepfake fraud (130) becomes the largest category. |

My recommendation is option 3. Keep collecting CVEs, since they are useful, but show them as their own series rather than as incidents. It is a site and methodology change (dashboard basis, stat tiles, Methodology "Vulnerability records" section), not a data change.

## Caveats and side findings

- **Prune matches titles as well as products.** `next.js` and `ray` in `dropped_packages` would retire any future NVD or GHSA record whose title contains those words as whole words (for example, an AI SDK CVE that mentions Next.js, or "Ray-Ban Meta"). Today's dry run shows no collateral beyond the intended products. In scenario C, `gradio` also takes the LLaVA and F5-TTS records.
- **Exploited CVEs still get in.** The KEV adapter (`collector/sources/kev.ts`) matches `EXTRA_TERMS`, which include `mlflow` and `ray`, and uses the CISA catalogue URL rather than the NVD URL. So if CISA lists a retired Triton, MLflow or Ray CVE as exploited, it returns as a severity-3 incident. That is the intended behaviour.
- **Site copy is stale.** If B is approved, update the Methodology page "Vulnerability records" paragraph (`app/(site)/methodology/page.tsx:164`) to name MLflow, Triton and Ray among the exclusions. Separately, `lib/taxonomy.ts:209` still lists PyTorch as an example of Framework / tooling, which has been stale since the first prune.
- **CVE ids on two incidents (resolved).** The scan found 15 CVE ids that each appear on two published incidents. A follow-up investigation (`docs/cve-dedup.md`) showed that most are citations rather than duplicates: a later advisory names the CVE it only partly fixed, or bypassed. Only two pairs were one event. The real fault ran the other way: the merge step had attached 7 NVD/GHSA sources to the incident that cites a CVE instead of the one about it, and CVE-2025-62164 had lost its own record. The collector fix (PR #1) and the data repair (PR #2) dealt with both. The same scan now reports 11 ids, all of them citations.
- **The matcher is fine; the classifier is permissive.** The NVD adapter's keyword match is a plain description search. False positives come from the LLM classifier accepting generic apps whose CVE only touches an AI feature, even though the hint says "out of scope if the keyword is a false positive". A stricter guard (for example, requiring the keyword in the CPE product or the first sentence of the description) would stop these at source.

## Applying it (after approval)

1. Merge this branch's `collector/config/packages.json` change.
2. On `main`, between cron runs, run `npx tsx scripts/prune-packages.ts --dry-run`. Confirm it reports "retire 171 incidents (242 source urls)", or slightly more if new matching records arrived. Then run it without `--dry-run` and commit the data change.
3. Update the Methodology copy as above.
