import { describe, expect, it } from "vitest";
import { urlKey } from "@/collector/lib/canonical";
import { breachToCandidate, type HibpBreach, type HibpMapOptions } from "@/collector/sources/hibp";
import { CandidateSchema } from "@/collector/sources/types";

/**
 * Recorded from https://haveibeenpwned.com/api/v3/breaches on 2026-10-25.
 * Gîtes de France and Crunchbase are verified breaches above the threshold;
 * Assurance Retraite is a real verified breach of 70,372 accounts, below it.
 */
const GITES: HibpBreach = {
  Name: "GitesDeFrance",
  Title: "Gîtes de France",
  Domain: "gites-de-france.com",
  BreachDate: "2026-05-16",
  AddedDate: "2026-10-18T04:50:13Z",
  ModifiedDate: "2026-10-18T04:50:13Z",
  PwnCount: 117574,
  Description:
    'In May 2026, the French holiday rental network <a href="https://www.cyberattaque.org/gites-de-france-les-reservations-de-389-000-clients-dans-une-fuite-de-donnees/" target="_blank" rel="noopener">Gîtes de France suffered a data breach</a> affecting some of its departmental branches. The incident exposed hundreds of thousands of customer records, including 118k unique email addresses alongside names, phone numbers, postal addresses and booking details.',
  DataClasses: ["Booking details", "Email addresses", "Names", "Phone numbers", "Physical addresses"],
  IsVerified: true,
  IsFabricated: false,
  IsSensitive: false,
  IsRetired: false,
  IsSpamList: false,
  IsMalware: false,
  IsSubscriptionFree: false,
  IsStealerLog: false,
};

const CRUNCHBASE: HibpBreach = {
  Name: "Crunchbase",
  Title: "Crunchbase",
  Domain: "crunchbase.com",
  BreachDate: "2026-01-22",
  AddedDate: "2026-10-14T06:01:26Z",
  PwnCount: 559908,
  Description:
    'In January 2026, the private company intelligence platform <a href="https://www.securityweek.com/crunchbase-confirms-data-breach-after-hacking-claims/" target="_blank" rel="noopener">Crunchbase was targeted in a ShinyHunters "pay or leak" extortion attempt</a>. Data allegedly obtained from the company was subsequently published publicly and included 560k unique email addresses, largely belonging to leads and business contacts.',
  DataClasses: ["Email addresses", "Employers", "Job titles", "Names", "Phone numbers", "Physical addresses", "Social media profiles"],
  IsVerified: true,
  IsFabricated: false,
  IsRetired: false,
  IsSpamList: false,
  IsMalware: false,
  IsStealerLog: false,
};

const ASSURANCE_RETRAITE: HibpBreach = {
  Name: "AssuranceRetraite",
  Title: "Assurance Retraite",
  Domain: "lassuranceretraite.fr",
  BreachDate: "2024-09-01",
  AddedDate: "2026-10-20T02:29:36Z",
  PwnCount: 70372,
  Description: "In September 2024, the French national pension fund Assurance Retraite suffered a data breach affecting approximately 370k assistance beneficiaries.",
  DataClasses: ["Dates of birth", "Email addresses", "Government issued IDs", "Names"],
  IsVerified: true,
  IsFabricated: false,
  IsRetired: false,
  IsSpamList: false,
  IsMalware: false,
  IsStealerLog: false,
};

/** Crafted: the shape HIBP uses for aggregated spam lists. */
const SPAM_LIST: HibpBreach = {
  ...GITES,
  Name: "ExampleSpamList",
  Title: "Example Spam List",
  Domain: "",
  PwnCount: 25_000_000,
  Description: "A list of 25M email addresses used for spam campaigns.",
  DataClasses: ["Email addresses"],
  IsSpamList: true,
};

const OPTS: HibpMapOptions = { since: "2026-09-25", minPwnCount: 100000, sourceId: "hibp", hintMaxChars: 600 };

describe("breachToCandidate", () => {
  it("maps a verified breach above the threshold to a well-formed candidate", () => {
    const c = breachToCandidate(GITES, OPTS);
    expect(c).not.toBeNull();
    expect(() => CandidateSchema.parse(c)).not.toThrow();
    expect(c!.url).toBe("https://haveibeenpwned.com/Breach/GitesDeFrance");
    expect(c!.url).not.toContain("#");
    expect(c!.key).toBe(urlKey("https://haveibeenpwned.com/Breach/GitesDeFrance"));
    expect(c!.source_id).toBe("hibp");
    expect(c!.origin).toBe("news");
    expect(c!.title).toBe("Gîtes de France data breach exposes 117,574 accounts");
    expect(c!.published_at).toBe("2026-10-18");
    expect(c!.publisher).toBe("Have I Been Pwned");
    expect(c!.cve_ids).toEqual([]);
    expect(c!.hint).not.toContain("<a");
    expect(c!.hint).toMatch(/^In May 2026, the French holiday rental network Gîtes de France suffered a data breach/);
    expect(c!.hint.length).toBeLessThanOrEqual(600);
    expect(c!.extra).toMatchObject({
      hibp: true,
      incident_date: "2026-05-16",
      pwn_count: 117574,
      data_classes: ["Booking details", "Email addresses", "Names", "Phone numbers", "Physical addresses"],
      domain: "gites-de-france.com",
    });
    expect(c!.extra!["classifier_hint"]).toBe(
      "Have I Been Pwned lists a confirmed breach of Gîtes de France (gites-de-france.com): 117,574 accounts, breach date 2026-05-16, data exposed: Booking details, Email addresses, Names, Phone numbers, Physical addresses. A confirmed breach of a named service; severity 4 when personal data was exposed; AI plays no role unless the service is an AI product.",
    );
  });

  it("gives every breach its own key", () => {
    const a = breachToCandidate(GITES, OPTS)!;
    const b = breachToCandidate(CRUNCHBASE, OPTS)!;
    expect(a.key).not.toBe(b.key);
    expect(b.title).toBe("Crunchbase data breach exposes 559,908 accounts");
  });

  it("drops spam lists, stealer logs, malware, fabrications, retired and unverified entries", () => {
    expect(breachToCandidate(SPAM_LIST, OPTS)).toBeNull();
    expect(breachToCandidate({ ...GITES, IsStealerLog: true }, OPTS)).toBeNull();
    expect(breachToCandidate({ ...GITES, IsMalware: true }, OPTS)).toBeNull();
    expect(breachToCandidate({ ...GITES, IsFabricated: true }, OPTS)).toBeNull();
    expect(breachToCandidate({ ...GITES, IsRetired: true }, OPTS)).toBeNull();
    expect(breachToCandidate({ ...GITES, IsVerified: false }, OPTS)).toBeNull();
  });

  it("drops breaches below the account threshold", () => {
    expect(breachToCandidate(ASSURANCE_RETRAITE, OPTS)).toBeNull();
    expect(breachToCandidate(ASSURANCE_RETRAITE, { ...OPTS, minPwnCount: 50000 })).not.toBeNull();
  });

  it("drops breaches added before the lookback start, by AddedDate not BreachDate", () => {
    expect(breachToCandidate(GITES, { ...OPTS, since: "2026-10-19" })).toBeNull();
    // Old breach date, recent addition: still a candidate.
    expect(breachToCandidate(ASSURANCE_RETRAITE, { ...OPTS, minPwnCount: 0 })).not.toBeNull();
  });

  it("truncates long descriptions to the hint limit", () => {
    const c = breachToCandidate(GITES, { ...OPTS, hintMaxChars: 80 })!;
    expect(c.hint.length).toBeLessThanOrEqual(81);
    expect(c.hint.endsWith("…")).toBe(true);
  });
});
