import { GoogleGenAI } from "@google/genai";
import type { ProviderConfig } from "../lib/config";
import { LlmUnavailable, statusOf, type LlmClient, type LlmJsonRequest, type LlmJsonResult } from "./types";

/** Gemini via the official @google/genai SDK, JSON output constrained by a JSON Schema. */
export function geminiClient(cfg: ProviderConfig, apiKey: string): LlmClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    id: cfg.id,
    model: cfg.model,
    async completeJson(req: LlmJsonRequest): Promise<LlmJsonResult> {
      try {
        const res = await ai.models.generateContent({
          model: cfg.model,
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: req.jsonSchema,
            temperature: req.temperature ?? 0.1,
            maxOutputTokens: req.maxOutputTokens ?? 8192,
          },
        });
        const text = res.text ?? "";
        const u = res.usageMetadata as
          | { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
          | undefined;
        return {
          text,
          model: cfg.model,
          usage: {
            prompt_tokens: u?.promptTokenCount ?? 0,
            completion_tokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
          },
        };
      } catch (err) {
        const status = statusOf(err);
        const message = err instanceof Error ? err.message : String(err);
        const retryable = status === undefined || status === 429 || status >= 500;
        throw new LlmUnavailable(`gemini ${cfg.model}: ${message.slice(0, 300)}`, retryable, status);
      }
    },
  };
}
