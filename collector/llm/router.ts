import type { RunRecord } from "../../lib/schema";
import type { ProviderConfig } from "../lib/config";
import { sleep } from "../lib/http";
import { log } from "../lib/log";
import { geminiClient } from "./gemini";
import { groqClient } from "./groq";
import { openaiCompatibleClient } from "./openai-compatible";
import { extractJson } from "./schemas";
import { LlmUnavailable, NoProviderAvailable, type LlmClient, type LlmJsonRequest, type LlmUsage } from "./types";

/**
 * Orders providers (Gemini, then Gemini Flash-Lite, then Groq), keeps each
 * within its per-minute and per-day budgets, falls through on errors and
 * reports NoProviderAvailable when nothing is left. Every call's token usage
 * is tallied for the run record so free-tier headroom stays visible.
 */

export interface ModelUsage {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
}
export type UsageByModel = Record<string, ModelUsage>;

export function usageKey(cfg: ProviderConfig): string {
  return `${cfg.id}/${cfg.model}`;
}

/** YYYY-MM-DD of `d` in an IANA time zone (daily quotas reset on local midnight). */
export function dayIn(tz: string, d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Calls already made today per provider key, derived from past run records. */
export function callsToday(runs: RunRecord[], providers: ProviderConfig[], now: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cfg of providers) {
    const key = usageKey(cfg);
    const today = dayIn(cfg.reset_tz, now);
    let sum = 0;
    for (const run of runs) {
      if (dayIn(cfg.reset_tz, new Date(run.started_at)) !== today) continue;
      sum += run.llm.by_model[key]?.calls ?? 0;
    }
    out[key] = sum;
  }
  return out;
}

interface Slot {
  cfg: ProviderConfig;
  client: LlmClient;
  usedToday: number;
  dead: boolean;
  deadReason?: string;
  failures: number;
  recent: number[];
}

/** Builds the client for a provider; tests inject a fake through the router's last constructor argument. */
export type ClientFactory = (cfg: ProviderConfig, apiKey: string) => LlmClient;

export const defaultClientFactory: ClientFactory = (cfg, apiKey) =>
  cfg.kind === "gemini" ? geminiClient(cfg, apiKey) : cfg.kind === "groq" ? groqClient(cfg, apiKey) : openaiCompatibleClient(cfg, apiKey);

export class LlmRouter {
  private slots: Slot[] = [];
  readonly usage: UsageByModel = {};

  constructor(
    providers: ProviderConfig[],
    usedToday: Record<string, number>,
    env: NodeJS.ProcessEnv = process.env,
    makeClient: ClientFactory = defaultClientFactory,
  ) {
    for (const cfg of providers) {
      const apiKey = env[cfg.env];
      if (!apiKey) {
        log.warn(`provider ${cfg.id}: ${cfg.env} is not set, skipping`);
        continue;
      }
      const client = makeClient(cfg, apiKey);
      this.slots.push({ cfg, client, usedToday: usedToday[usageKey(cfg)] ?? 0, dead: false, failures: 0, recent: [] });
    }
  }

  get configured(): boolean {
    return this.slots.length > 0;
  }

  get available(): boolean {
    return this.slots.some((s) => this.canUse(s));
  }

  /** Batch size of the provider that will take the next call. */
  get batchSize(): number {
    return this.slots.find((s) => this.canUse(s))?.cfg.batch_size ?? 1;
  }

  describe(): string[] {
    return this.slots.map(
      (s) => `${s.cfg.id} (${s.cfg.model}): ${s.usedToday}/${s.cfg.daily_calls} calls today${s.dead ? `, unavailable: ${s.deadReason}` : ""}`,
    );
  }

  private canUse(s: Slot): boolean {
    return !s.dead && s.usedToday < s.cfg.daily_calls;
  }

  private async throttle(s: Slot) {
    const now = Date.now();
    s.recent = s.recent.filter((t) => now - t < 60_000);
    if (s.recent.length >= s.cfg.rpm) {
      const wait = 60_000 - (now - s.recent[0]!) + 250;
      log.debug("rpm throttle", { provider: s.cfg.id, wait_ms: wait });
      await sleep(wait);
    }
    s.recent.push(Date.now());
  }

  private record(s: Slot, usage: LlmUsage) {
    const key = usageKey(s.cfg);
    const u = (this.usage[key] ??= { calls: 0, prompt_tokens: 0, completion_tokens: 0 });
    u.calls += 1;
    u.prompt_tokens += usage.prompt_tokens;
    u.completion_tokens += usage.completion_tokens;
  }

  /**
   * Runs the request on the first usable provider. Provider outages fall
   * through; malformed JSON is thrown to the caller (who retries with
   * feedback); NoProviderAvailable means the caller should queue the work.
   */
  async completeJson(req: LlmJsonRequest): Promise<{ parsed: unknown; provider: string; model: string }> {
    const errors: string[] = [];
    for (const s of this.slots) {
      if (!this.canUse(s)) continue;
      await this.throttle(s);
      s.usedToday += 1;
      let res;
      try {
        res = await s.client.completeJson(req);
      } catch (err) {
        // A failed call still counts against the daily quota (zero tokens).
        this.record(s, { prompt_tokens: 0, completion_tokens: 0 });
        if (err instanceof LlmUnavailable) {
          s.failures += 1;
          if (!err.retryable || err.status === 429 || s.failures >= 2) {
            s.dead = true;
            s.deadReason = err.message;
          }
          errors.push(err.message);
          log.warn(`provider ${s.cfg.id} failed`, { status: err.status, error: err.message });
          continue;
        }
        throw err;
      }
      // One call, one tally: the parse runs outside the try so a non-JSON reply is not counted a second time.
      this.record(s, res.usage);
      s.failures = 0;
      return { parsed: extractJson(res.text), provider: s.cfg.id, model: res.model };
    }
    throw new NoProviderAvailable(errors.length ? errors.join(" | ") : "no LLM provider configured");
  }
}
