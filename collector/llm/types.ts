/** Provider-agnostic LLM interface used by the router. */

export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface LlmJsonRequest {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmJsonResult {
  text: string;
  usage: LlmUsage;
  model: string;
}

export interface LlmClient {
  id: string;
  model: string;
  completeJson(req: LlmJsonRequest): Promise<LlmJsonResult>;
}

/** Thrown when a provider cannot serve the call; `retryable` means another call may succeed later. */
export class LlmUnavailable extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public status?: number,
  ) {
    super(message);
    this.name = "LlmUnavailable";
  }
}

export class NoProviderAvailable extends Error {
  constructor(message = "no LLM provider available") {
    super(message);
    this.name = "NoProviderAvailable";
  }
}

export function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { status?: unknown; code?: unknown; statusCode?: unknown };
  for (const v of [e.status, e.statusCode, e.code]) if (typeof v === "number") return v;
  return undefined;
}
