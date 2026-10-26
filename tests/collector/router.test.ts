import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "../../collector/lib/config";
import { LlmRouter, usageKey } from "../../collector/llm/router";
import { LlmUnavailable, NoProviderAvailable, type LlmClient, type LlmJsonRequest, type LlmJsonResult } from "../../collector/llm/types";

function provider(id: string, over: Partial<ProviderConfig> = {}): ProviderConfig {
  return { id, kind: "groq", model: `model-${id}`, env: `KEY_${id.toUpperCase()}`, json_mode: "json_schema", rpm: 60, daily_calls: 100, batch_size: 1, reset_tz: "UTC", ...over };
}

const env = (keys: Record<string, string>): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...keys });
const ENV = env({ KEY_A: "a-key", KEY_B: "b-key" });
const REQ: LlmJsonRequest = { system: "s", user: "u", schemaName: "t", jsonSchema: { type: "object" } };

/** Fake client: each call pops the next scripted reply (a result, or an error to throw). */
function fake(id: string, replies: (LlmJsonResult | Error)[]): LlmClient & { calls: number } {
  return {
    id,
    model: `model-${id}`,
    calls: 0,
    async completeJson() {
      this.calls += 1;
      const next = replies.shift();
      if (!next) throw new Error(`${id}: no scripted reply left`);
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const ok = (text: string, prompt = 10, completion = 5): LlmJsonResult => ({ text, usage: { prompt_tokens: prompt, completion_tokens: completion }, model: "m" });

function build(clients: Record<string, LlmClient>, usedToday: Record<string, number> = {}, providers = [provider("a"), provider("b")]) {
  return new LlmRouter(providers, usedToday, ENV, (cfg) => clients[cfg.id]!);
}

const A = usageKey(provider("a"));
const B = usageKey(provider("b"));

describe("LlmRouter.completeJson", () => {
  it("parses JSON (fenced or bare) and tallies one call with its tokens", async () => {
    const a = fake("a", [ok('```json\n{"x":1}\n```', 7, 3)]);
    const router = build({ a, b: fake("b", []) });
    const res = await router.completeJson(REQ);
    expect(res).toEqual({ parsed: { x: 1 }, provider: "a", model: "m" });
    expect(router.usage[A]).toEqual({ calls: 1, prompt_tokens: 7, completion_tokens: 3 });
    expect(router.usage[B]).toBeUndefined();
  });

  it("counts a non-JSON reply exactly once and rethrows it to the caller", async () => {
    const a = fake("a", [ok("Sorry, I cannot help with that.", 12, 9)]);
    const b = fake("b", [ok('{"x":1}')]);
    const router = build({ a, b });
    await expect(router.completeJson(REQ)).rejects.toThrow(/non-JSON/);
    expect(router.usage[A]).toEqual({ calls: 1, prompt_tokens: 12, completion_tokens: 9 });
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(0); // a malformed reply is the caller's retry, not a provider outage
    expect(router.describe()[0]).toContain("1/100 calls today");
    expect(router.describe()[0]).not.toContain("unavailable");
  });

  it("falls through to the next provider on LlmUnavailable and marks a non-retryable one dead", async () => {
    const a = fake("a", [new LlmUnavailable("invalid api key", false, 401)]);
    const b = fake("b", [ok('{"ok":true}', 4, 2)]);
    const router = build({ a, b });
    const res = await router.completeJson(REQ);
    expect(res.provider).toBe("b");
    expect(res.parsed).toEqual({ ok: true });
    // the failed call still counts against a's quota, with zero tokens
    expect(router.usage[A]).toEqual({ calls: 1, prompt_tokens: 0, completion_tokens: 0 });
    expect(router.usage[B]).toEqual({ calls: 1, prompt_tokens: 4, completion_tokens: 2 });
    expect(router.describe()[0]).toContain("unavailable: invalid api key");
    expect(router.available).toBe(true);
  });

  it("keeps a provider after one retryable failure, resets on success, and retires it on 429", async () => {
    const a = fake("a", [new LlmUnavailable("upstream 503", true, 503), ok('{"n":1}'), new LlmUnavailable("upstream 503", true, 503)]);
    const b = fake("b", [ok('{"n":2}'), ok('{"n":3}')]);
    const router = build({ a, b });
    expect((await router.completeJson(REQ)).provider).toBe("b"); // a failed once, still alive
    expect(router.describe()[0]).not.toContain("unavailable");
    expect((await router.completeJson(REQ)).provider).toBe("a"); // success resets its failure count
    expect((await router.completeJson(REQ)).provider).toBe("b"); // failure #1 again, a stays alive
    expect(router.describe()[0]).not.toContain("unavailable");
    expect(router.usage[A]).toEqual({ calls: 3, prompt_tokens: 10, completion_tokens: 5 });

    const c = fake("c", [new LlmUnavailable("rate limited", true, 429)]);
    const d = fake("d", [ok("{}")]);
    const r2 = new LlmRouter([provider("c"), provider("d")], {}, env({ KEY_C: "x", KEY_D: "y" }), (cfg) => ({ c, d })[cfg.id]!);
    expect((await r2.completeJson(REQ)).provider).toBe("d");
    expect(r2.describe()[0]).toContain("unavailable: rate limited"); // 429 retires immediately
  });

  it("retires a provider after two consecutive retryable failures", async () => {
    const a = fake("a", [new LlmUnavailable("503", true, 503), new LlmUnavailable("503 again", true, 503)]);
    const b = fake("b", [new LlmUnavailable("b down", true, 503), ok('{"n":1}'), ok('{"n":2}')]);
    const router = build({ a, b });
    await expect(router.completeJson(REQ)).rejects.toThrow(NoProviderAvailable); // a fails #1, b fails #1
    expect((await router.completeJson(REQ)).provider).toBe("b"); // a fails #2 and is retired, b answers
    expect(router.describe()[0]).toContain("unavailable: 503 again");
    expect((await router.completeJson(REQ)).provider).toBe("b");
    expect(a.calls).toBe(2);
  });

  it("skips a provider that has reached its daily cap and reports NoProviderAvailable when all have", async () => {
    const a = fake("a", [ok('{"from":"a"}')]);
    const b = fake("b", [ok('{"from":"b"}')]);
    const router = build({ a, b }, { [A]: 100 });
    expect(router.batchSize).toBe(1);
    expect((await router.completeJson(REQ)).provider).toBe("b");
    expect(a.calls).toBe(0);
    expect(router.describe()[0]).toContain("100/100 calls today");

    const capped = build({ a, b }, { [A]: 100, [B]: 100 });
    expect(capped.configured).toBe(true);
    expect(capped.available).toBe(false);
    await expect(capped.completeJson(REQ)).rejects.toThrow(NoProviderAvailable);
  });

  it("counts the call that reaches the cap, so the next call moves on", async () => {
    const a = fake("a", [ok('{"n":1}'), ok('{"n":2}')]);
    const b = fake("b", [ok('{"n":3}')]);
    const router = build({ a, b }, {}, [provider("a", { daily_calls: 1 }), provider("b")]);
    expect((await router.completeJson(REQ)).provider).toBe("a");
    expect((await router.completeJson(REQ)).provider).toBe("b");
    expect(a.calls).toBe(1);
    expect(router.usage[A]!.calls).toBe(1);
  });

  it("skips providers whose API key is not set", () => {
    const router = new LlmRouter([provider("a"), provider("b")], {}, env({ KEY_B: "only-b" }), (cfg) => fake(cfg.id, []));
    expect(router.describe()).toHaveLength(1);
    expect(router.describe()[0]).toContain("b (model-b)");
  });
});
