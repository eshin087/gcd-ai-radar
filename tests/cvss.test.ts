import { describe, expect, it } from "vitest";
import { CVSS_BANDS, cvssBand, cvssLabel } from "@/lib/cvss";
import { CVSS_COLORS, LANE_COLORS, SEVERITY_COLORS } from "@/lib/palette";
import { LANES } from "@/lib/taxonomy";

describe("cvssBand", () => {
  it("cuts at 9.0, 7.0 and 4.0, inclusive at the top of each band", () => {
    expect(cvssBand(10)).toBe("critical");
    expect(cvssBand(9)).toBe("critical");
    expect(cvssBand(8.9)).toBe("high");
    expect(cvssBand(7)).toBe("high");
    expect(cvssBand(6.9)).toBe("medium");
    expect(cvssBand(4)).toBe("medium");
    expect(cvssBand(3.9)).toBe("low");
    expect(cvssBand(0)).toBe("low");
  });

  it("prints one decimal, never a bare integer", () => {
    expect(cvssLabel(9)).toBe("9.0");
    expect(cvssLabel(9.8)).toBe("9.8");
    expect(cvssLabel(10)).toBe("10.0");
  });

  it("colours every band from the severity scale, and every lane", () => {
    for (const band of CVSS_BANDS) expect(Object.values(SEVERITY_COLORS)).toContain(CVSS_COLORS[band]);
    expect(CVSS_COLORS.critical).toBe(SEVERITY_COLORS[4]);
    expect(CVSS_COLORS.low).toBe(SEVERITY_COLORS[1]);
    for (const lane of LANES) expect(LANE_COLORS[lane]).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(Object.values(LANE_COLORS)).size).toBe(LANES.length);
  });
});
