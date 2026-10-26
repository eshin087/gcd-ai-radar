import { describe, expect, it } from "vitest";
import type { CompactRow } from "@/lib/rows";
import { MAX_BLIPS, SCOPE_DAYS, buildScope } from "@/lib/scope";

const NOW = new Date("2026-10-25T18:30:00Z");

let seq = 0;
function row(partial: Partial<CompactRow> & { first_reported: string }): CompactRow {
  seq += 1;
  return {
    id: `AIR-2026-${String(seq).padStart(4, "0")}`,
    slug: `fixture-${String(seq).padStart(4, "0")}`,
    title: `Fixture ${seq}`,
    incident_date: partial.first_reported,
    incident_date_precision: "day",
    type: "attack_on_ai",
    categories: ["prompt_injection"],
    severity: 1,
    targets: ["OpenAI"],
    source_count: 1,
    disclosed: false,
    product: "",
    ...partial,
  };
}

describe("buildScope", () => {
  it("keeps incidents first reported in the last 120 days, newest first, aged in whole days", () => {
    const scope = buildScope(
      [
        row({ first_reported: "2026-06-28" }), // 119 days ago: the oldest day in the window
        row({ first_reported: "2026-06-27" }), // 120 days ago: outside
        row({ first_reported: "2026-10-25", categories: ["agent_hijack", "prompt_injection"], severity: 3 }),
        row({ first_reported: "2026-10-26" }), // dated after the build day: never shown
        row({ first_reported: "2026-09-01", disclosed: true }), // a disclosed CVE is not an incident
      ],
      NOW,
    );
    expect(scope.days).toBe(SCOPE_DAYS);
    expect(scope.total).toBe(2);
    expect(scope.blips.map((b) => [b.age, b.family, b.severity])).toEqual([
      [0, "agent", 3],
      [119, "injection", 1],
    ]);
  });

  it("caps the blips but always keeps the real-world incidents", () => {
    const research = Array.from({ length: MAX_BLIPS + 40 }, () => row({ first_reported: "2026-10-20" }));
    const real = [row({ first_reported: "2026-07-01", severity: 4 }), row({ first_reported: "2026-08-01", severity: 3 })];
    const scope = buildScope([...research, ...real], NOW);
    expect(scope.total).toBe(MAX_BLIPS + 42);
    expect(scope.blips).toHaveLength(MAX_BLIPS);
    expect(scope.blips.filter((b) => b.severity >= 3)).toHaveLength(2);
    expect(scope.blips.at(-1)?.severity).toBe(4); // the oldest real-world one survives the cap
  });
});
