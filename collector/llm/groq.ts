import Groq from "groq-sdk";
import type { ProviderConfig } from "../lib/config";
import { LlmUnavailable, statusOf, type LlmClient, type LlmJsonRequest, type LlmJsonResult } from "./types";

/** Groq via the official SDK with strict json_schema structured outputs. */
export function groqClient(cfg: ProviderConfig, apiKey: string): LlmClient {
  const client = new Groq({ apiKey, maxRetries: 1 });
  return {
    id: cfg.id,
    model: cfg.model,
    async completeJson(req: LlmJsonRequest): Promise<LlmJsonResult> {
      try {
        const res = await client.chat.completions.create({
          model: cfg.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: true },
          },
          temperature: req.temperature ?? 0.1,
          max_completion_tokens: req.maxOutputTokens ?? 6000,
        });
        const text = res.choices[0]?.message?.content ?? "";
        return {
          text,
          model: cfg.model,
          usage: {
            prompt_tokens: res.usage?.prompt_tokens ?? 0,
            completion_tokens: res.usage?.completion_tokens ?? 0,
          },
        };
      } catch (err) {
        const status = statusOf(err);
        const message = err instanceof Error ? err.message : String(err);
        const retryable = status === undefined || status === 429 || status >= 500;
        throw new LlmUnavailable(`groq ${cfg.model}: ${message.slice(0, 300)}`, retryable, status);
      }
    },
  };
}
