import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRelatedIndex, rankRelated, relatedCandidates, relatedFromIndex } from "@/lib/related";
import type { Incident } from "@/lib/schema";
import { readIncidents } from "@/lib/shards";
import { relatedIncidents } from "@/lib/slim";

/**
 * Reference: the scoring as it was before the bucket index, every record
 * against every other. The index must give the same list whenever the
 * reference's list lies within a year either side; the sample below measures
 * how often the year window changes the answer on the live data.
 */
function referenceRelated(all: Incident[], incident: Incident, limit = 6, yearWindow: number | null = null): Incident[] {
  const date = Date.parse(`${incident.first_reported}T00:00:00Z`);
  const year = Number(incident.first_reported.slice(0, 4));
  return all
    .filter((o) => o.id !== incident.id)
    .filter((o) => yearWindow === null || Math.abs(Number(o.first_reported.slice(0, 4)) - year) <= yearWindow)
    .map((o) => {
      let score = 0;
      for (const c of o.categories) if (incident.categories.includes(c)) score += 2;
      for (const t of o.targets) if (incident.targets.includes(t) && t !== "n/a") score += 1;
      if (o.type === incident.type) score += 0.5;
      const days = Math.abs(Date.parse(`${o.first_reported}T00:00:00Z`) - date) / 86400000;
      if (days <= 30) score += 1;
      else if (days <= 180) score += 0.5;
      for (const p of o.products) if (incident.products.includes(p)) score += 1.5;
      return { o, score };
    })
    .filter((x) => x.score >= 2)
    // the id key is implicit in the old scan (readIncidents sorts by first report, then id, both descending); spelled out so the reference does not depend on input order
    .sort((a, b) => b.score - a.score || b.o.first_reported.localeCompare(a.o.first_reported) || b.o.id.localeCompare(a.o.id))
    .slice(0, limit)
    .map((x) => x.o);
}

function inc(id: string, first_reported: string, partial: Partial<Incident> = {}): Incident {
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
    ...partial,
  };
}

describe("related incidents from the bucket index", () => {
  const base = inc("AIR-2026-0001", "2026-06-01", { categories: ["agent_hijack"], targets: ["Anthropic", "enterprise_deployment"], products: ["Claude Code"] });
  const fixtures: Incident[] = [
    base,
    // shares a category: score 2 (+ type 0.5 + time)
    inc("AIR-2026-0002", "2026-06-10", { categories: ["agent_hijack"], targets: ["Google"] }),
    // shares only two targets: score 2 exactly, no category or product in common
    inc("AIR-2026-0003", "2025-12-01", { categories: ["data_leak"], targets: ["Anthropic", "enterprise_deployment"], type: "ai_enabled_attack" }),
    // shares only the product: 1.5 + same type 0.5 = 2
    inc("AIR-2025-0004", "2025-09-01", { categories: ["supply_chain"], targets: ["Microsoft"], products: ["Claude Code"] }),
    // shares a target and the type only, more than 180 days away: 1.5, below the threshold (a candidate, not related)
    inc("AIR-2025-0005", "2025-11-15", { categories: ["jailbreak"], targets: ["Anthropic"] }),
    // "n/a" targets never count
    inc("AIR-2026-0006", "2026-06-03", { categories: ["other"], targets: ["n/a"] }),
    // shares a category and a target but is two years away: the index does not look there while the year window fills the list
    inc("AIR-2024-0007", "2024-05-01", { categories: ["agent_hijack"], targets: ["Anthropic"] }),
    // next year, shares a category
    inc("AIR-2027-0008", "2027-01-15", { categories: ["agent_hijack"], targets: ["Meta"] }),
    // two more near neighbours, so the year window yields the full six
    inc("AIR-2026-0009", "2026-07-01", { categories: ["agent_hijack"], targets: ["Amazon"] }),
    inc("AIR-2026-0010", "2026-08-01", { categories: ["agent_hijack"], targets: ["Apple"] }),
    // a lone record in a sparse year: its own years hold nothing, so the fallback reads the buckets across every year
    inc("AIR-2019-0011", "2019-03-01", { categories: ["agent_hijack"], targets: ["Google"] }),
  ];

  it("files every record under its categories, products and targets for its year", () => {
    const index = buildRelatedIndex(fixtures);
    expect(index.buckets.get("c:agent_hijack:2026")?.map((i) => i.id)).toEqual(["AIR-2026-0001", "AIR-2026-0002", "AIR-2026-0009", "AIR-2026-0010"]);
    expect(index.buckets.get("p:Claude Code:2025")?.map((i) => i.id)).toEqual(["AIR-2025-0004"]);
    expect(index.buckets.get("t:n/a:2026")).toBeUndefined();
  });

  it("scores only candidates that share a bucket within a year either side", () => {
    const index = buildRelatedIndex(fixtures);
    const candidates = relatedCandidates(index, base).map((i) => i.id).sort();
    expect(candidates).toEqual(["AIR-2025-0004", "AIR-2025-0005", "AIR-2026-0002", "AIR-2026-0003", "AIR-2026-0009", "AIR-2026-0010", "AIR-2027-0008"]);
    const related = relatedFromIndex(index, base).map((i) => i.id);
    // 3.5 (category, type, within 30 days) for 0009 and 0002, newest first; 3.0 for 0010; 2.5 for 0008; 2.0 for 0003 (two targets) and 0004 (product, type)
    expect(related).toEqual(["AIR-2026-0009", "AIR-2026-0002", "AIR-2026-0010", "AIR-2027-0008", "AIR-2026-0003", "AIR-2025-0004"]);
    expect(related).toEqual(referenceRelated(fixtures, base, 6, 1).map((i) => i.id));
    // the full scan differs by the records outside the window: 0007 (2024, category + target + type: 3.5) places third and 0011 (2019, category + type: 2.5) sixth
    expect(referenceRelated(fixtures, base).map((i) => i.id)).toEqual(["AIR-2026-0009", "AIR-2026-0002", "AIR-2024-0007", "AIR-2026-0010", "AIR-2027-0008", "AIR-2019-0011"]);
  });

  it("falls back to every year when the year window cannot fill the list", () => {
    const index = buildRelatedIndex(fixtures);
    const lone = fixtures.find((i) => i.id === "AIR-2019-0011")!;
    expect(relatedCandidates(index, lone)).toEqual([]);
    expect(relatedCandidates(index, lone, true).map((i) => i.id).sort()).toEqual(["AIR-2024-0007", "AIR-2026-0001", "AIR-2026-0002", "AIR-2026-0009", "AIR-2026-0010", "AIR-2027-0008"]);
    expect(relatedFromIndex(index, lone).map((i) => i.id)).toEqual(referenceRelated(fixtures, lone).map((i) => i.id));
    expect(relatedFromIndex(index, lone)).toHaveLength(6);
  });

  it("breaks a tie in score and date by id, whatever order the buckets give", () => {
    // AIR-2025-0109 on the live data: 0130 and 0107 tie at 5.5 on the same day; 0107 is found first, through a category 0130 does not share
    const incident = inc("AIR-2025-0109", "2025-04-29", { categories: ["ai_assisted_intrusion", "deepfake_fraud"], targets: ["enterprise_deployment"] });
    const viaIntrusion = inc("AIR-2025-0107", "2025-04-23", { categories: ["ai_assisted_intrusion"], targets: ["enterprise_deployment"] });
    const viaDeepfake = inc("AIR-2025-0130", "2025-04-23", { categories: ["deepfake_fraud"], targets: ["enterprise_deployment"] });
    const records = [incident, viaIntrusion, viaDeepfake];
    const index = buildRelatedIndex(records);
    expect(relatedCandidates(index, incident).map((i) => i.id)).toEqual(["AIR-2025-0107", "AIR-2025-0130"]);
    expect(relatedFromIndex(index, incident, 1).map((i) => i.id)).toEqual(["AIR-2025-0130"]);
    expect(relatedFromIndex(index, incident, 1)).toEqual(referenceRelated(records, incident, 1));
  });

  it("relatedIncidents() reuses one index per dataset array", () => {
    const a = relatedIncidents(fixtures, base).map((i) => i.id);
    const b = relatedIncidents(fixtures, fixtures[1]!).map((i) => i.id);
    expect(a).toEqual(["AIR-2026-0009", "AIR-2026-0002", "AIR-2026-0010", "AIR-2027-0008", "AIR-2026-0003", "AIR-2025-0004"]);
    expect(b).toContain("AIR-2026-0001");
  });
});

describe("parity with the full scan on the live dataset", () => {
  it("matches the reference within a year either side (or everywhere, for a sparse year), and mostly without that limit", async () => {
    const { incidents } = await readIncidents(path.join(process.cwd(), "data"));
    const all = incidents.filter((i) => i.status === "published");
    const index = buildRelatedIndex(all);
    // every 13th record plus the ten newest: about 160 incidents across years, origins and kinds
    const sample = [...all.filter((_, k) => k % 13 === 0), ...all.slice(0, 10)];
    let identical = 0;
    let sameSet = 0;
    for (const inc of sample) {
      const viaIndex = relatedFromIndex(index, inc).map((i) => i.id);
      const nearFills = rankRelated(inc, relatedCandidates(index, inc), 6).length >= 6;
      expect(viaIndex).toEqual(referenceRelated(all, inc, 6, nearFills ? 1 : null).map((i) => i.id));
      const full = referenceRelated(all, inc).map((i) => i.id);
      if (full.join() === viaIndex.join()) identical += 1;
      if ([...full].sort().join() === [...viaIndex].sort().join()) sameSet += 1;
    }
    const share = identical / sample.length;
    // Measured 2026-10-18 over all 1,911 records: 89.2% identical lists; the rest swap a record from two or more
    // years earlier, which the full scan ranked by shared categories, for one from the year window.
    expect(share).toBeGreaterThanOrEqual(0.85);
    expect(sameSet).toBeGreaterThanOrEqual(identical);
    console.log(`related parity: ${identical}/${sample.length} identical lists (${(share * 100).toFixed(1)}%), ${sameSet} same set`);
  });
});
