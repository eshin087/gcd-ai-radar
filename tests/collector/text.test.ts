import { describe, expect, it } from "vitest";
import { buildMatcher, dice, entityTokens, extractCves, normalizeTitle, stripHtml, titleSimilarity, tokens, truncate } from "@/collector/lib/text";

describe("entityTokens", () => {
  it("keeps names and identifiers, drops generic security words and short tokens", () => {
    expect(entityTokens("Hackers Abuse AI Pen-Test Tool Cairn to Automate Massive Attack Spree")).toEqual(["cairn"]);
    expect(entityTokens("OpenCode hack exposes API keys amid AI distillation attacks")).toEqual(["opencod", "distill"]);
    expect(entityTokens("Microsoft Links Storm-0940 to ConnectWise Supply Chain Attack")).toEqual(["microsoft", "storm", "0940", "connectwi"]);
  });
  it("drops years and short numbers but keeps other digit tokens", () => {
    expect(entityTokens("2026 breach hits 1,200 sites and 45000 users")).toEqual(["45000"]);
    expect(entityTokens("CVE-2026-61882 exploited")).toEqual(["61882"]);
  });
  it("is empty for a headline made only of generic words", () => {
    expect(entityTokens("Critical vulnerability exploited in the wild, patch now")).toEqual([]);
  });
});

describe("title normalization and similarity", () => {
  it("strips publisher suffixes and punctuation", () => {
    expect(normalizeTitle("Hackers exploit ChatGPT bug - The Register")).toBe("hackers exploit chatgpt bug");
    expect(normalizeTitle("BREAKING: OpenAI patches flaw | SecurityWeek")).toBe("openai patches flaw");
  });
  it("tokenizes without stopwords", () => {
    expect(tokens("The attack on the AI agent is new")).toEqual(["attack", "ai", "agent"]);
  });
  it("scores the same story from different outlets as highly similar", () => {
    const a = "Critical vLLM vulnerability lets attackers execute code remotely";
    const b = "Critical vulnerability in vLLM allows remote code execution - BleepingComputer";
    expect(titleSimilarity(a, b)).toBeGreaterThan(0.55);
    expect(titleSimilarity(a, a)).toBe(1);
  });
  it("scores unrelated stories low", () => {
    const a = "Deepfake CFO call costs Hong Kong firm $25 million";
    const b = "Researchers jailbreak Gemini with ASCII art prompts";
    expect(titleSimilarity(a, b)).toBeLessThan(0.3);
  });
  it("computes dice on token sets", () => {
    expect(dice(["a", "b", "c"], ["b", "c", "d"])).toBeCloseTo(2 / 3);
    expect(dice([], ["a"])).toBe(0);
  });
});

describe("matchers and helpers", () => {
  it("matches whole words and hyphenated prefixes", () => {
    const ai = buildMatcher(["ai", "prompt injection", "cve-"]);
    expect(ai.test("AI-powered scanner")).toBe(true);
    expect(ai.test("Thai food aid")).toBe(false);
    expect(ai.test("Prompt  injection found")).toBe(true);
    expect(ai.test("CVE-2026-1234 published")).toBe(true);
  });
  it("extracts and dedupes CVE ids", () => {
    expect(extractCves("Fixes cve-2026-12345 and CVE-2026-12345, plus CVE-2025-1")).toEqual(["CVE-2026-12345"]);
  });
  it("strips html and decodes entities", () => {
    expect(stripHtml("<p>Tom &amp; Jerry&#8217;s <b>bug</b></p>")).toBe("Tom & Jerry’s bug");
    // script and style blocks go, however the end tag is written
    expect(stripHtml("Hi <script type=x>evil()</script ><b>there</b>")).toBe("Hi there");
    expect(stripHtml("Hi <SCRIPT>evil()</script\t\n bar>there")).toBe("Hi there");
    expect(stripHtml('a <script a=">">evil()</script>b<style>x{}</style\n>c')).toBe("a b c");
    expect(stripHtml("<scripts>keep</scripts> and <stylesheet>this</stylesheet>")).toBe("keep and this");
    expect(stripHtml("start <script>never closed")).toBe("start");
  });
  it("truncates on word boundaries", () => {
    expect(truncate("one two three four", 10)).toBe("one two…");
    expect(truncate("short", 10)).toBe("short");
  });
});
