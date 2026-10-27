import { describe, expect, it } from "vitest";
import type { CompactRow } from "@/lib/rows";
import { LOCK_CHARS, MAX_BLIPS, SCOPE_DAYS, buildScope, lockText } from "@/lib/scope";

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

  it("names what was hit: the first real product, else the target, with the record's CVE", () => {
    const scope = buildScope(
      [
        { ...row({ first_reported: "2026-10-25", products: ["AI coding agents", "llama.cpp"], severity: 3 }), cve: "CVE-2026-116096" },
        row({ first_reported: "2026-10-24", products: ["Claude Code + SDKs"] }),
        row({ first_reported: "2026-10-23", products: ["open-weight models"], targets: ["n/a", "framework_or_tooling"] }),
        row({ first_reported: "2026-10-22", targets: ["n/a"] }),
      ],
      NOW,
    );
    expect(scope.blips.map((b) => [b.hit, b.lock, b.cve])).toEqual([
      ["llama.cpp", "LLAMA.CPP", "CVE-2026-116096"],
      ["Claude Code + SDKs", "CLAUDE", null],
      ["Framework / tooling", "AI TOOLING", null],
      ["", "", null],
    ]);
  });

  it("keeps lock text to what the pixel font can draw", () => {
    expect(lockText("Hugging_Face")).toBe("HUGGINGFAC");
    expect(lockText("Microsoft 365 Copilot")).toBe("MICROSOFT"); // cut at LOCK_CHARS, then trimmed
    expect(lockText("ABCDEFGHIJKLMN")).toHaveLength(LOCK_CHARS);
    expect(lockText("Öffi")).toBe("FFI");
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
