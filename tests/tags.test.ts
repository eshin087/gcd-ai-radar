import { describe, expect, it } from "vitest";
import { ATTACK_TAGS, DROPPED, TAG_GROUPS, buildTagIndex, groupOf, normalizeTag, tagSlugsOf, topLiveTags } from "@/lib/tags";
import { incident } from "./fixtures";

describe("normalizeTag", () => {
  it("lower-cases, turns underscores and spaces into dashes and strips the rest", () => {
    expect(normalizeTag("Path_Traversal")).toBe("path-traversal");
    expect(normalizeTag("open webui")).toBe("open-webui");
    expect(normalizeTag("llama.cpp")).toBe("llama-cpp");
    expect(normalizeTag("  RCE ")).toBe("rce");
    expect(normalizeTag("--")).toBeNull();
  });

  it("folds aliases, drops CVE ids and category echoes, and suffixes reserved names", () => {
    expect(normalizeTag("denial_of_service")).toBe("dos");
    expect(normalizeTag("remote-code-execution")).toBe("rce");
    expect(normalizeTag("authorization_bypass")).toBe("auth-bypass");
    expect(normalizeTag("CVE-2026-12345")).toBeNull();
    expect(normalizeTag("infra_vuln")).toBeNull();
    expect(normalizeTag("agent_hijack")).toBeNull();
    expect(normalizeTag("feed")).toBe("feed-tag");
    expect(normalizeTag("index")).toBe("index-tag");
    for (const d of DROPPED) expect(normalizeTag(d)).toBeNull();
  });

  it("keeps every attack-vocabulary slug as itself", () => {
    for (const t of ATTACK_TAGS) expect(normalizeTag(t)).toBe(t);
  });
});

describe("groupOf", () => {
  const none = () => false;
  it("places standards, actors, attacks, vendors, sectors and stacks", () => {
    expect(groupOf("cisa-kev", none)).toBe("standard");
    expect(groupOf("llm01", none)).toBe("standard");
    expect(groupOf("storm-0940", none)).toBe("actor");
    expect(groupOf("apt28", none)).toBe("actor");
    expect(groupOf("lazarus", none)).toBe("actor");
    expect(groupOf("rce", none)).toBe("attack");
    expect(groupOf("deepfake", none)).toBe("attack");
    expect(groupOf("microsoft", none)).toBe("vendor");
    expect(groupOf("nvidia", none)).toBe("vendor");
    expect(groupOf("healthcare", none)).toBe("sector");
    expect(groupOf("whatsapp", none)).toBe("sector");
    expect(groupOf("python", none)).toBe("stack");
    expect(groupOf("langflow", (s) => s === "langflow")).toBe("stack");
    expect(groupOf("langflow", none)).toBe("other");
    expect(TAG_GROUPS).toContain("other");
  });
});

describe("buildTagIndex", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  const records = [
    incident({ tags: ["path_traversal", "rce"], first_reported: "2026-10-20", state: "live", products: ["Langflow"] }),
    incident({ tags: ["path-traversal", "Langflow"], first_reported: "2026-09-02", state: "closed", closed_at: "2026-09-16", products: ["Langflow OSS"] }),
    incident({ tags: ["CVE-2026-0001", "deepfake", "deepfake"], first_reported: "2025-01-10", state: "closed", closed_at: "2025-01-24" }),
    incident({ tags: ["infra_vuln"], first_reported: "2026-10-01", state: "closed", closed_at: "2026-10-15" }),
  ];
  const index = buildTagIndex(records, now);

  it("merges spellings into one slug and counts live records", () => {
    const pt = index.bySlug.get("path-traversal")!;
    expect(pt.total).toBe(2);
    expect(pt.live).toBe(1);
    expect(pt.latest).toBe("2026-10-20");
    expect(pt.ids).toEqual([records[0]!.id, records[1]!.id]);
    expect(pt.label).toBe("path-traversal");
    expect(pt.group).toBe("attack");
    expect(index.bySlug.has("cve-2026-0001")).toBe(false);
    expect(index.bySlug.has("infra-vuln")).toBe(false);
    expect(index.bySlug.get("deepfake")!.total).toBe(1);
  });

  it("files product tags under stacks and keeps the directory to tags with two records or a live one", () => {
    expect(index.bySlug.get("langflow")!.group).toBe("stack");
    expect(index.directory.map((t) => t.slug)).toEqual(["path-traversal", "rce"]);
    expect(index.tags[0]!.slug).toBe("path-traversal");
  });

  it("counts the last twelve months by first report", () => {
    expect(index.months).toHaveLength(12);
    expect(index.months[11]).toBe("2026-10");
    const pt = index.bySlug.get("path-traversal")!;
    expect(pt.months[11]).toBe(1);
    expect(pt.months[10]).toBe(1);
    expect(index.bySlug.get("deepfake")!.months.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("is memoised per dataset and ranks live tags", () => {
    expect(buildTagIndex(records, now)).toBe(index);
    expect(topLiveTags(index, 5).map((t) => t.slug)).toEqual(["path-traversal", "rce"]);
  });

  it("gives a record at most five distinct slugs", () => {
    const i = incident({ tags: ["a", "b", "b", "CVE-2026-1", "c", "d", "e", "f"] });
    expect(tagSlugsOf(i)).toEqual(["a", "b", "c", "d", "e"]);
  });
});
