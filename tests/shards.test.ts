import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState, saveState, type State } from "@/collector/lib/state";
import type { Incident } from "@/lib/schema";
import { groupByShard, incidentFiles, readIncidents, serializeShards, shardFile, shardYear } from "@/lib/shards";

function incident(id: string, first_reported: string, extra: Partial<Incident> = {}): Incident {
  return {
    id,
    slug: id.toLowerCase(),
    title: `Incident ${id} with a long enough title`,
    summary: "Something happened to an AI system in this fixture. The vendor responded with a patch.",
    type: "attack_on_ai",
    categories: ["prompt_injection"],
    severity: 3,
    targets: ["OpenAI"],
    products: [],
    incident_date: first_reported,
    incident_date_precision: "day",
    first_reported,
    sources: [{ url: `https://example.org/${id}`, publisher: "Example", title: `Report on ${id}`, published_at: first_reported }],
    source_count: 1,
    confidence: 0.9,
    status: "published",
    origin: "news",
    tags: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function state(incidents: Incident[]): State {
  return { incidents, review: [], rejected: [], pending: [], seen: {}, runs: [], collector: { sources: {}, cve_lookups: {} } };
}

const FIXTURE = [
  incident("AIR-2024-0001", "2024-03-01"),
  incident("AIR-2025-0001", "2025-02-10"),
  incident("AIR-2025-0002", "2025-09-30"),
  incident("AIR-2026-0001", "2026-01-15"),
  incident("AIR-2026-0002", "2026-10-01"),
];

async function snapshot(dir: string): Promise<Map<string, { content: string; mtimeMs: number }>> {
  const out = new Map<string, { content: string; mtimeMs: number }>();
  const walk = async (rel: string) => {
    for (const name of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${name.name}` : name.name;
      if (name.isDirectory()) await walk(p);
      else out.set(p, { content: await readFile(path.join(dir, p), "utf8"), mtimeMs: (await stat(path.join(dir, p))).mtimeMs });
    }
  };
  await walk("");
  return out;
}

describe("shard helpers", () => {
  it("shards by the year first reported and serializes newest first", () => {
    expect(shardYear({ first_reported: "2025-09-30" })).toBe(2025);
    expect(shardFile(2025)).toBe("incidents/2025.json");
    const groups = groupByShard(FIXTURE);
    expect([...groups.keys()]).toEqual([2024, 2025, 2026]);
    const files = serializeShards(FIXTURE);
    expect([...files.keys()]).toEqual(["incidents/2024.json", "incidents/2025.json", "incidents/2026.json"]);
    const y2026 = JSON.parse(files.get("incidents/2026.json")!) as Incident[];
    expect(y2026.map((i) => i.id)).toEqual(["AIR-2026-0002", "AIR-2026-0001"]);
    expect(files.get("incidents/2026.json")!.startsWith("[\n  {\n    \"id\"")).toBe(true);
  });
});

describe("state shards", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "radar-shards-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes one file per year and reads them back in order", async () => {
    const changed = await saveState(state(FIXTURE), dir);
    expect(changed).toEqual(["incidents/2024.json", "incidents/2025.json", "incidents/2026.json", "review-queue.json", "rejected.json", "pending.json", "seen.json", "runs.json", "collector-state.json"]);
    const loaded = await loadState(dir);
    expect(loaded.incidents.map((i) => i.id)).toEqual(["AIR-2026-0002", "AIR-2026-0001", "AIR-2025-0002", "AIR-2025-0001", "AIR-2024-0001"]);
    expect(await incidentFiles(dir)).toEqual({ layout: "shards", files: ["incidents/2024.json", "incidents/2025.json", "incidents/2026.json"] });
  });

  it("rewrites only the shards whose content changed", async () => {
    await saveState(state(FIXTURE), dir);
    const before = await snapshot(dir);
    // let the clock move so an unwanted rewrite would show in mtime as well as in the returned list
    await new Promise((r) => setTimeout(r, 20));

    const edited = structuredClone(FIXTURE);
    edited[4]!.title = "Incident AIR-2026-0002, retitled by review";
    edited.push(incident("AIR-2026-0003", "2026-10-02"));
    const changed = await saveState(state(edited), dir);
    expect(changed).toEqual(["incidents/2026.json"]);

    const after = await snapshot(dir);
    for (const [file, prev] of before) {
      if (file === "incidents/2026.json") {
        expect(after.get(file)!.content).not.toBe(prev.content);
        continue;
      }
      expect(after.get(file)!.content).toBe(prev.content);
      expect(after.get(file)!.mtimeMs).toBe(prev.mtimeMs);
    }
    expect(JSON.parse(after.get("incidents/2026.json")!.content)).toHaveLength(3);
  });

  it("is a no-op when nothing changed", async () => {
    await saveState(state(FIXTURE), dir);
    expect(await saveState(state(structuredClone(FIXTURE)), dir)).toEqual([]);
  });

  it("moves a record between shards when its first report changes, and removes a shard left empty", async () => {
    await saveState(state(FIXTURE), dir);
    const moved = structuredClone(FIXTURE);
    moved[0]!.first_reported = "2025-01-05"; // the only 2024 record now belongs to 2025
    moved[0]!.incident_date = "2025-01-05";
    const changed = await saveState(state(moved), dir);
    expect(changed).toEqual(["incidents/2025.json", "incidents/2024.json (removed)"]);
    expect(await incidentFiles(dir)).toEqual({ layout: "shards", files: ["incidents/2025.json", "incidents/2026.json"] });
    const { incidents } = await readIncidents(dir);
    expect(incidents).toHaveLength(5);
  });

  it("reads the pre-shard incidents.json and replaces it with shards on save", async () => {
    await writeFile(path.join(dir, "incidents.json"), JSON.stringify(FIXTURE, null, 2) + "\n");
    expect(await incidentFiles(dir)).toEqual({ layout: "legacy", files: ["incidents.json"] });
    const loaded = await loadState(dir);
    expect(loaded.incidents).toHaveLength(5);
    const changed = await saveState(loaded, dir);
    expect(changed).toContain("incidents/2026.json");
    expect(changed).toContain("incidents.json (removed)");
    expect(await incidentFiles(dir)).toEqual({ layout: "shards", files: ["incidents/2024.json", "incidents/2025.json", "incidents/2026.json"] });
  });

  it("refuses a checkout that has both layouts", async () => {
    await saveState(state(FIXTURE), dir);
    await writeFile(path.join(dir, "incidents.json"), "[]\n");
    await expect(loadState(dir)).rejects.toThrow(/both present/);
  });

  it("starts empty when there is no dataset yet", async () => {
    expect(await incidentFiles(dir)).toEqual({ layout: "empty", files: [] });
    const loaded = await loadState(dir);
    expect(loaded.incidents).toEqual([]);
  });
});
