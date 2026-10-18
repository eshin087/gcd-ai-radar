import type { ProviderConfig } from "../lib/config";
import { LlmUnavailable, type LlmClient, type LlmJsonRequest, type LlmJsonResult } from "./types";

/**
 * Any OpenAI-compatible chat completions endpoint: OpenRouter, Cloudflare
 * Workers AI, a local Ollama or vLLM, or OpenAI itself. Exists so the
 * collector keeps working if both free tiers in settings.json disappear;
 * configure it in collector/config/settings.json and set its env var.
 */
export function openaiCompatibleClient(cfg: ProviderConfig, apiKey: string): LlmClient {
  const base = (cfg.base_url ?? "https://api.openai.com/v1").replace(/\/$/, "");
  return {
    id: cfg.id,
    model: cfg.model,
    async completeJson(req: LlmJsonRequest): Promise<LlmJsonResult> {
      const body = {
        model: cfg.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        temperature: req.temperature ?? 0.1,
        max_tokens: req.maxOutputTokens ?? 6000,
        response_format:
          cfg.json_mode === "json_object"
            ? { type: "json_object" }
            : { type: "json_schema", json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: true } },
      };
      let res: Response;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (err) {
        throw new LlmUnavailable(`${cfg.id}: ${err instanceof Error ? err.message : String(err)}`, true);
      }
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 200);
        throw new LlmUnavailable(`${cfg.id}: HTTP ${res.status} ${text}`, res.status === 429 || res.status >= 500, res.status);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        text: data.choices?.[0]?.message?.content ?? "",
        model: cfg.model,
        usage: { prompt_tokens: data.usage?.prompt_tokens ?? 0, completion_tokens: data.usage?.completion_tokens ?? 0 },
      };
    },
  };
}
