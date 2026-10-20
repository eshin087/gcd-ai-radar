import { describe, expect, it } from "vitest";
import type { CompactRow } from "@/lib/rows";
import { INTEL_DAYS, buildThreatIntel } from "@/lib/threatIntel";

const NOW = new Date("2026-10-19T12:00:00Z");

let seq = 0;
function row(partial: Partial<CompactRow> & { first_reported: string }): CompactRow {
  seq += 1;
  return {
    id: `AIR-2026-${String(seq).padStart(4, "0")}`,
    slug: `fixture-${seq}`,
    title: `Fixture ${seq}`,
    incident_date: partial.first_reported,
    incident_date_precision: "day",
    type: "attack_on_ai",
    categories: ["prompt_injection"],
    severity: 2,
    targets: ["OpenAI"],
    source_count: 1,
    disclosed: false,
    product: "",
    ...partial,
  };
}

describe("buildThreatIntel", () => {
  it("covers the last 90 days by first report, inclusive", () => {
    const intel = buildThreatIntel([], NOW);
    expect(intel.days).toBe(INTEL_DAYS);
    expect(intel.to).toBe("2026-10-19");
    expect(intel.from).toBe("2026-07-22");
  });

  it("counts incidents only, by first report, once per category", () => {
    const intel = buildThreatIntel(
      [
        row({ first_reported: "2026-07-22", categories: ["agent_hijack", "prompt_injection"], severity: 3, targets: ["Microsoft", "n/a"] }),
        row({ first_reported: "2026-10-19", categories: ["agent_hijack"], severity: 1, targets: ["framework_or_tooling", "Microsoft"] }),
        row({ first_reported: "2026-07-21", categories: ["agent_hijack"] }), // a day before the window
        row({ first_reported: "2026-09-01", categories: ["infra_vuln"], disclosed: true }), // disclosed: never counted
        row({ first_reported: "2026-09-02", categories: ["other"], severity: 4 }), // counted in the total, never flies
      ],
      NOW,
    );
    expect(intel.total).toBe(3);
    expect(intel.harm).toBeCloseTo(2 / 3);
    expect(intel.kinds.map((k) => [k.category, k.count])).toEqual([
      ["agent_hijack", 2],
      ["prompt_injection", 1],
    ]);
    const agent = intel.kinds[0]!;
    expect(agent.harm).toBe(0.5);
    expect(agent.targets).toEqual([
      { target: "Microsoft", count: 2 },
      { target: "framework_or_tooling", count: 1 },
    ]);
  });

  it("tags the biggest real jumps as rising", () => {
    const rows: CompactRow[] = [];
    const add = (category: CompactRow["categories"][number], now: number, before: number) => {
      for (let k = 0; k < now; k++) rows.push(row({ first_reported: "2026-09-15", categories: [category] }));
      for (let k = 0; k < before; k++) rows.push(row({ first_reported: "2026-06-15", categories: [category] }));
    };
    add("agent_hijack", 21, 9); // big jump on a big base
    add("supply_chain", 5, 0);
    add("data_poisoning", 3, 0);
    add("data_leak", 6, 2);
    add("deepfake_fraud", 7, 9); // falling
    add("jailbreak", 2, 0); // too few to call
    const rising = buildThreatIntel(rows, NOW).kinds.filter((k) => k.rising).map((k) => k.category);
    expect(rising.sort()).toEqual(["agent_hijack", "data_poisoning", "supply_chain"]);
  });

  it("lists the latest real-world incidents, newest first", () => {
    const intel = buildThreatIntel(
      [
        row({ first_reported: "2026-10-01", severity: 3, title: "older", targets: ["n/a", "Anthropic"] }),
        row({ first_reported: "2026-10-10", severity: 4, title: "newer", categories: ["deepfake_fraud"], targets: ["n/a"] }),
        row({ first_reported: "2026-10-18", severity: 2, title: "not real-world" }),
      ],
      NOW,
    );
    expect(intel.latest.map((c) => [c.title, c.category, c.target])).toEqual([
      ["newer", "deepfake_fraud", null],
      ["older", "prompt_injection", "Anthropic"],
    ]);
  });
});
