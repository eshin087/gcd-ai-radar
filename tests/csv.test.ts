import { describe, expect, it } from "vitest";
import { csvCell } from "../lib/csv";

describe("csvCell", () => {
  it("passes plain values through", () => {
    expect(csvCell("Prompt injection in Example Assistant")).toBe("Prompt injection in Example Assistant");
    expect(csvCell(3)).toBe("3");
    expect(csvCell(null)).toBe("");
  });

  it("joins lists and quotes commas, quotes and newlines", () => {
    expect(csvCell(["a", "b"])).toBe("a; b");
    expect(csvCell('say "hi", now')).toBe('"say ""hi"", now"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("defuses spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1 2")).toBe("'+1 2");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
  });
});
