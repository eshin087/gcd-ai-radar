import { describe, expect, it } from "vitest";
import { buildSearchIndex, hitIds, hitYears, matchesTerms, queryTerms, searchIndex, searchableText, tokenize, type Searchable } from "@/lib/search";

const RECORDS: Searchable[] = [
  { id: "AIR-2026-0001", title: "CVE-2025-1234: vLLM remote code execution via pickle deserialization", products: ["vLLM"], first_reported: "2026-02-01" },
  { id: "AIR-2026-0002", title: "Prompt injection in Open WebUI leaks chat history", products: ["Open WebUI", "open-webui"], first_reported: "2026-01-15" },
  { id: "AIR-2025-0001", title: "Deepfake CFO call defrauds engineering firm", products: [], first_reported: "2025-06-10" },
  { id: "AIR-2024-0001", title: "GPT-4o jailbreak with (ASCII) art bypasses filters", products: ["ChatGPT"], first_reported: "2024-03-03" },
];

describe("tokenize", () => {
  it("lower-cases, splits on punctuation and keeps hyphenated ids whole", () => {
    expect(tokenize("CVE-2025-1234: vLLM remote code execution via pickle deserialization")).toEqual(["cve-2025-1234", "vllm", "remote", "code", "execution", "via", "pickle", "deserialization"]);
    expect(tokenize("GPT-4o jailbreak with (ASCII) art")).toEqual(["gpt-4o", "jailbreak", "with", "ascii", "art"]);
    expect(tokenize("@modelcontextprotocol/sdk, llama.cpp; C++")).toEqual(["@modelcontextprotocol", "sdk", "llama.cpp", "c++"]);
    expect(tokenize("  ")).toEqual([]);
  });
});

describe("search index", () => {
  const index = buildSearchIndex(RECORDS);

  it("groups ids by shard year, newest first, with offsets", () => {
    expect(index.years).toEqual([2026, 2025, 2024]);
    expect(index.offsets).toEqual([0, 2, 3, 4]);
    expect(index.ids.slice(0, 2).sort()).toEqual(["AIR-2026-0001", "AIR-2026-0002"]);
  });

  it("matches each term as a substring of a token, all terms required", () => {
    const vllm = searchIndex(index, "llm")!;
    expect(hitIds(index, vllm)).toEqual(new Set(["AIR-2026-0001"]));
    const webui = searchIndex(index, "open webui")!;
    expect(hitIds(index, webui)).toEqual(new Set(["AIR-2026-0002"]));
    expect(hitIds(index, searchIndex(index, "CVE-2025")!)).toEqual(new Set(["AIR-2026-0001"]));
    expect(hitIds(index, searchIndex(index, "air-2024")!)).toEqual(new Set(["AIR-2024-0001"]));
    expect(hitIds(index, searchIndex(index, "deepfake vllm")!)).toEqual(new Set());
    expect(searchIndex(index, "   ")).toBeNull();
  });

  it("names the shard years that hold the hits", () => {
    expect(hitYears(index, searchIndex(index, "a")!)).toEqual([2026, 2025, 2024]);
    expect(hitYears(index, searchIndex(index, "gpt")!)).toEqual([2024]);
  });

  it("agrees with the same token test run directly on a record", () => {
    for (const q of ["llm", "open webui", "cve-2025-1234", "jail", "fraud firm", "zzz", "2026"]) {
      const viaIndex = hitIds(index, searchIndex(index, q)!);
      const direct = new Set(RECORDS.filter((r) => matchesTerms(tokenize(searchableText(r)), queryTerms(q))).map((r) => r.id));
      expect(viaIndex).toEqual(direct);
    }
  });
});
