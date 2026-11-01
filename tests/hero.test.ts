import { describe, expect, it } from "vitest";
import { dueLabel, productName } from "@/components/hero/ExploitedWeek";

describe("the hero's exploited rows", () => {
  it("names a KEV product the way people say it", () => {
    expect(productName({ vendor: "PHP Group", product: "PHP" })).toBe("PHP");
    expect(productName({ vendor: "GitLab", product: "GitLab" })).toBe("GitLab");
    expect(productName({ vendor: "Ivanti", product: "Connect Secure" })).toBe("Ivanti Connect Secure");
    expect(productName({ vendor: "Cisco", product: "Secure Firewall ASA" })).toBe("Cisco Secure Firewall ASA");
    expect(productName({ vendor: "", product: "Exim" })).toBe("Exim");
    expect(productName({ vendor: "Zimbra", product: "" })).toBe("Zimbra");
  });

  it("reads CISA's deadline against the build day", () => {
    expect(dueLabel("2026-11-01", "2026-11-01")).toBe("due today");
    expect(dueLabel("2026-11-13", "2026-11-01")).toBe("due Nov 13");
    expect(dueLabel("2026-10-30", "2026-11-01")).toBe("past due");
    expect(dueLabel(null, "2026-11-01")).toBe("");
  });
});
