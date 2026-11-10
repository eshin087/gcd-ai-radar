import { describe, expect, it } from "vitest";
import { buildAiFlow, pickCase } from "@/lib/panel/ai-flow";
import { attackType, buildAttackTypes, weekIncidents } from "@/lib/panel/attack-types";
import { countdownParts, openFor, timeLeft } from "@/lib/panel/dates";
import { cveWindows, kevWeekHistory } from "@/lib/panel";
import { LEDGER_NEW_AI_KEPT, LEDGER_NEW_KEPT, buildLedger } from "@/lib/panel/ledger";
import { bandOf, levelOf, quantile, ratioLevel } from "@/lib/panel/levels";
import { flagBadge, rowStack, stackHits } from "@/lib/panel/picks";
import { buildStack, kevCatalogHref, parsePicks, stackMatches, tileOf, type StackFile } from "@/lib/panel/stack";
import { buildSurface, techOf } from "@/lib/panel/technology";
import { kevName, recordCves, shortDate, slugKey } from "@/lib/panel/util";
import { patchTuesday, typicalBreachMonth, typicalCriticalWeek, typicalCveWeek } from "@/lib/panel/week";
import type { KevStatEntry } from "@/lib/stats-schema";
import { disclosedCve, incident } from "./fixtures";

const TODAY = "2026-10-29";
const NOW = "2026-10-29T23:30:00.000Z";

function kev(over: Partial<KevStatEntry>): KevStatEntry {
  return { cve: "CVE-2026-0001", added: "2026-10-27", due: "2026-11-17", vendor: "Vendor", product: "Product", name: "Flaw", ransomware: false, published: "2026-10-20", cvss: null, ...over };
}

describe("panel helpers", () => {
  it("names KEV entries without repeating the vendor", () => {
    expect(kevName("PHP Group", "PHP")).toBe("PHP");
    expect(kevName("Plex", "Plex Media Server")).toBe("Plex Media Server");
    expect(kevName("Linux", "Kernel")).toBe("Linux Kernel");
    expect(kevName("Microsoft", "")).toBe("Microsoft");
  });
  it("reads every CVE id a record names, once", () => {
    expect(recordCves({ cve_ids: ["CVE-2026-1"], tags: ["cve-2026-1", "CVE-2026-0002"], title: "Exploited CVE-2026-0003 flaw" }).sort()).toEqual(["CVE-2026-0002", "CVE-2026-0003", "CVE-2026-1"]);
  });
  it("formats short dates and slugs", () => {
    expect(shortDate("2026-10-31")).toBe("31 Oct");
    expect(shortDate("2026-11-03")).toBe("3 Nov");
    expect(slugKey("Palo Alto Networks")).toBe("palo-alto-networks");
    expect(slugKey("Hugging Face libraries")).toBe("hugging-face-libraries");
  });
});

describe("levels", () => {
  it("judges a value against the quartiles of its history", () => {
    const history = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const band = bandOf(history)!;
    expect(quantile(history, 0.25)).toBe(32.5);
    expect(levelOf(30, band)).toBe(0);
    expect(levelOf(50, band)).toBe(1);
    expect(levelOf(85, band)).toBe(2);
    expect(levelOf(200, band)).toBe(3);
  });
  it("says normal without enough history", () => {
    expect(bandOf([1, 2, 3])).toBeNull();
    expect(levelOf(999, null)).toBe(1);
  });
  it("compares a week with a typical week", () => {
    expect(ratioLevel(3232, 2063)).toBe(2);
    expect(ratioLevel(2000, 2063)).toBe(1);
    expect(ratioLevel(1000, 2063)).toBe(0);
    expect(ratioLevel(1000, null)).toBe(1);
  });
  it("counts CVEs in whole 24-hour windows back from the end", () => {
    const end = Date.parse(NOW);
    const at = (h: number) => new Date(end - h * 3_600_000).toISOString();
    const w = cveWindows([at(1), at(23.9), at(24.1), at(47), at(-1), at(24 * 20)], end, 3);
    expect(w).toEqual([0, 2, 2]);
  });
  it("sums KEV additions per 7-day window, today's week apart from the history", () => {
    const k = kevWeekHistory(["2026-10-29", "2026-10-23", "2026-10-22", "2026-10-15"], TODAY, 1);
    expect(k.now).toBe(2); // 23 Oct to 29 Oct
    expect(k.history[0]).toBe(1); // 16 Oct to 22 Oct
    expect(k.history.length).toBeGreaterThan(10);
  });
});

describe("attack types", () => {
  const base = { summary: "", tags: [], products: [], categories: ["general" as const], type: "not_ai" as const, lane: "breach" as const };
  it("files by the first rule that matches", () => {
    expect(attackType({ ...base, title: "Akira ransomware hits hospital chain" })).toBe("ransomware");
    expect(attackType({ ...base, title: "Malicious npm package steals tokens", lane: "supply_chain" })).toBe("supply");
    expect(attackType({ ...base, title: "China-nexus group exploits edge devices" })).toBe("espionage");
    expect(attackType({ ...base, title: "Deepfake CFO call costs firm $25M" })).toBe("fraud");
    expect(attackType({ ...base, title: "New infostealer spreads through ads" })).toBe("malware");
    expect(attackType({ ...base, title: "Agent tricked into leaking repo", type: "attack_on_ai", categories: ["agent_hijack"] as never })).toBe("ai");
    expect(attackType({ ...base, title: "Retailer confirms customer data stolen" })).toBe("breach");
    expect(attackType({ ...base, title: "Zero-day in VPN appliance exploited", lane: "patch" })).toBe("vuln");
    expect(attackType({ ...base, title: "Odd news", lane: "research" })).toBe("other");
  });
  it("counts the week's incidents, AI separately, disclosed CVEs left out, other last", () => {
    const week = weekIncidents(
      [
        incident({ first_reported: "2026-10-28", title: "Zero-day exploited in gateway", summary: "Attackers use the flaw against exposed appliances in the wild.", lane: "patch", type: "not_ai", categories: ["general"] }),
        incident({ first_reported: "2026-10-27", title: "Prompt injection exploit in assistant", summary: "A crafted page steers the assistant into running tools.", lane: "patch", type: "attack_on_ai", categories: ["prompt_injection"] }),
        incident({ first_reported: "2026-10-27", title: "Quiet item", lane: "research", type: "not_ai", categories: ["general"], tags: [], products: [], summary: "Nothing to match in this summary text at all." }),
        incident({ first_reported: "2026-10-22", title: "Outside the week, exploit", lane: "patch" }),
        disclosedCve({ first_reported: "2026-10-28" }),
      ],
      TODAY,
    );
    expect(week).toHaveLength(3);
    const rows = buildAttackTypes(week);
    expect(rows.map((r) => [r.key, r.n, r.ai])).toEqual([
      ["ai", 1, 1],
      ["vuln", 1, 0],
      ["other", 1, 0],
    ]);
  });
});

describe("attack surface", () => {
  it("sorts real KEV rows into technologies", () => {
    expect(techOf({ vendor: "Langflow", product: "Langflow", name: "Langflow Code Injection Vulnerability" })).toBe("AI stack");
    expect(techOf({ vendor: "Citrix", product: "NetScaler ADC", name: "Citrix NetScaler Memory Overflow" })).toBe("Network edge & VPN");
    expect(techOf({ vendor: "ConnectWise", product: "ScreenConnect", name: "ConnectWise ScreenConnect Path Traversal" })).toBe("Remote access & IT tools");
    expect(techOf({ vendor: "Linux", product: "Kernel", name: "Linux Kernel Missing Initialization" })).toBe("Operating systems");
    expect(techOf({ vendor: "Google", product: "Chromium V8", name: "Google Chromium V8 Type Confusion" })).toBe("Browsers");
    expect(techOf({ vendor: "PHP Group", product: "PHP", name: "PHP Remote Code Execution" })).toBe("Enterprise & web apps");
    expect(techOf({ vendor: "Microsoft", product: "SQL Server", name: "Microsoft SQL Server Remote Code Execution Vulnerability" })).toBe("Enterprise & web apps");
    expect(techOf({ vendor: "BeyondTrust", product: "Remote Support", name: "BeyondTrust Remote Support Authentication Bypass" })).toBe("Remote access & IT tools");
    expect(techOf({ vendor: "Siemens", product: "Software Center", name: "Siemens Software Center DLL Hijacking" })).toBe("OT & IoT");
    expect(techOf({ vendor: "Acme", product: "Widget", name: "Acme Widget Flaw" })).toBe("Other");
  });
  it("counts 90 days, bright for the last 30, Other last", () => {
    const rows = buildSurface(
      [
        kev({ cve: "CVE-1", vendor: "Cisco", product: "IOS XE", added: "2026-10-20" }),
        kev({ cve: "CVE-2", vendor: "Cisco", product: "ASA", added: "2026-09-01" }),
        kev({ cve: "CVE-3", vendor: "Acme", product: "Widget", added: "2026-10-20" }),
        kev({ cve: "CVE-4", vendor: "Linux", product: "Kernel", added: "2026-07-01" }),
      ],
      TODAY,
    );
    expect(rows).toEqual([
      { label: "Network edge & VPN", n: 2, recent: 1 },
      { label: "Other", n: 1, recent: 1 },
    ]);
  });
});

describe("the ledger", () => {
  const entries = [
    kev({ cve: "CVE-2026-0010", vendor: "PHP Group", product: "PHP", due: "2026-10-29", cvss: 9.2, added: "2026-10-26" }),
    kev({ cve: "CVE-2026-0011", vendor: "PHP Group", product: "PHP", due: "2026-10-29", cvss: 8.1, added: "2026-10-27", ransomware: true }),
    kev({ cve: "CVE-2026-0012", vendor: "Linux", product: "Kernel", due: "2026-10-31", cvss: 7.8 }),
    kev({ cve: "CVE-2026-0013", vendor: "Adobe", product: "Commerce", due: "2026-11-10" }),
    kev({ cve: "CVE-2026-0014", vendor: "Old", product: "Thing", due: "2026-10-01" }),
  ];
  const recs = [
    incident({ slug: "linux-kernel-record", lane: "patch", severity: 3, patch_status: "unpatched", cve_ids: ["CVE-2026-0012"], first_reported: "2026-10-28", created_at: "2026-10-28T06:00:00.000Z" }),
    incident({ slug: "netscaler", lane: "patch", severity: 3, patch_status: "unpatched", products: ["NetScaler ADC"], first_reported: "2026-10-27", created_at: "2026-10-27T06:00:00.000Z" }),
    incident({ slug: "partial", lane: "patch", severity: 3, patch_status: "partial", first_reported: "2026-10-28", created_at: "2026-10-28T07:00:00.000Z" }),
    incident({ slug: "closed", lane: "patch", severity: 3, patch_status: "unpatched", state: "closed", closed_at: "2026-10-20" }),
    incident({ slug: "loss", lane: "breach", severity: 4, type: "not_ai", categories: ["general"], first_reported: "2026-10-29", created_at: "2026-10-29T01:00:00.000Z" }),
    incident({ slug: "newest", lane: "supply_chain", severity: 3, first_reported: "2026-10-29", created_at: "2026-10-29T08:00:00.000Z" }),
    incident({ slug: "old-news", lane: "breach", severity: 4, first_reported: "2026-10-10", created_at: "2026-10-10T08:00:00.000Z" }),
    disclosedCve({ cve_ids: ["CVE-2026-0099"], state: "live", created_at: "2026-10-29T02:00:00.000Z" }),
  ];
  const stack: StackFile = {
    generated_at: NOW,
    default: ["linux"],
    candidates: [
      {
        key: "linux",
        label: "Linux",
        kind: "vendor",
        n: 1,
        flag: "patch by 31 Oct",
        why: ["CISA deadline 2026-10-31"],
        kev7: [],
        href: kevCatalogHref("Linux"),
        items: [{ kind: "kev", name: "Linux Kernel", cves: ["CVE-2026-0012"], date: "2026-10-27", due: "2026-10-31", cvss: 7.8, open: "due", href: "/incidents/linux-kernel-record", external: false }],
      },
    ],
  };
  const l = buildLedger(recs, entries, stack, TODAY, NOW);

  it("groups this week's deadlines by vendor, product and day, nearest first, later ones apart", () => {
    expect(l.due.map((r) => r.name)).toEqual(["PHP", "Linux Kernel"]);
    expect(l.due[0]).toMatchObject({ cves: ["CVE-2026-0010", "CVE-2026-0011"], cvss: 9.2, ransomware: true, added: "2026-10-27", external: true, stack: [] });
    expect(l.due[1]).toMatchObject({ href: "/incidents/linux-kernel-record", external: false, stack: ["Linux"] });
    expect(l.later.map((r) => r.name)).toEqual(["Adobe Commerce"]);
  });
  it("lists records without a full patch, unpatched first, and folds one whose CVEs are on a deadline row", () => {
    expect(l.patch.map((r) => r.slug)).toEqual(["linux-kernel-record", "netscaler", "partial"]);
    expect(l.patch[0]).toMatchObject({ onDeadlineRow: true, stack: ["Linux"] });
    expect(l.patch[1]).toMatchObject({ name: "NetScaler ADC", patch: "unpatched", onDeadlineRow: false, stack: [] });
    expect(l.noFullPatch).toBe(3);
  });
  it("lists new records loss first, then newest, without the rows already shown or disclosed CVEs", () => {
    expect(l.fresh.map((r) => r.slug)).toEqual(["loss", "newest"]);
    expect(l.fresh[0]).toMatchObject({ lane: "breach", severity: 4, type: "not_ai", stack: [] });
    expect(l.freshTotal).toBe(5);
    expect(l.freshLoss).toBe(1);
    expect(l.freshAi).toBe(4);
    expect(l.exploitedLive).toBe(6);
  });
  it("keeps AI records past the kept rows, so AI only has rows in a week of plain breaches", () => {
    const at = (h: number) => `2026-10-29T${String(h).padStart(2, "0")}:00:00.000Z`;
    const week = [
      ...Array.from({ length: LEDGER_NEW_KEPT + 2 }, (_, k) => incident({ slug: `breach-${k}`, lane: "breach", severity: 4, type: "not_ai", categories: ["general"], first_reported: "2026-10-29", created_at: at(k) })),
      ...Array.from({ length: LEDGER_NEW_AI_KEPT + 2 }, (_, k) => incident({ slug: `ai-${k}`, lane: "supply_chain", severity: 3, first_reported: "2026-10-28", created_at: at(k) })),
    ];
    const rows = buildLedger(week, [], { default: [], candidates: [] }, TODAY, NOW).fresh;
    expect(rows.slice(0, LEDGER_NEW_KEPT).every((r) => r.type === "not_ai" && r.severity === 4)).toBe(true);
    expect(rows.slice(LEDGER_NEW_KEPT).map((r) => r.slug)).toEqual(["ai-5", "ai-4", "ai-3", "ai-2"]);
  });
  it("counts the week's new records per 24-hour window back from the build, the last 24 hours last", () => {
    // NOW is 29 Oct 23:30: "newest" (08:00) and "loss" (01:00) fall in the last 24 hours, the three patch records in the two windows before
    expect(l.freshDays).toHaveLength(7);
    expect(l.freshDays.reduce((n, d) => n + d.n, 0)).toBe(l.freshTotal);
    expect(l.freshDays.reduce((n, d) => n + d.harm, 0)).toBe(l.freshLoss);
    expect(l.freshDays.reduce((n, d) => n + d.ai, 0)).toBe(l.freshAi);
    expect(l.freshDays[6]).toEqual({ n: 2, harm: 1, ai: 1, aiHarm: 0 });
    expect(l.freshDays[5]).toEqual({ n: 2, harm: 0, ai: 2, aiHarm: 0 });
    expect(l.freshDays[4]).toEqual({ n: 1, harm: 0, ai: 1, aiHarm: 0 });
    expect(l.freshDays.slice(0, 4).every((d) => d.n === 0)).toBe(true);
  });
  it("marks rows by the picks' items, for the browser's own picks too", () => {
    const hits = stackHits(stack, ["linux"]);
    expect(rowStack(hits, { cves: ["CVE-2026-0012"] })).toEqual(["Linux"]);
    expect(rowStack(hits, { href: "/incidents/linux-kernel-record" })).toEqual(["Linux"]);
    expect(rowStack(hits, { cves: ["CVE-2026-0010"], href: "/incidents/other" })).toEqual([]);
    expect(rowStack(stackHits(stack, []), { cves: ["CVE-2026-0012"] })).toEqual([]);
  });
});

describe("the week", () => {
  it("finds the next Patch Tuesday, the second Tuesday of the month", () => {
    expect(patchTuesday("2026-11-09")).toBe("2026-11-10");
    expect(patchTuesday("2026-11-10")).toBe("2026-11-10");
    expect(patchTuesday("2026-11-11")).toBe("2026-12-08");
    expect(patchTuesday("2026-10-13")).toBe("2026-10-13");
    expect(patchTuesday("2026-12-31")).toBe("2027-01-12");
  });
  it("takes a typical week from the year's total over the days elapsed", () => {
    const source = { name: "NVD", url: "https://nvd.nist.gov/", license: "public domain" };
    expect(typicalCveWeek({ fetched_at: "2026-01-14T12:00:00.000Z", source, years: [{ year: 2026, total: 1400 }] })).toBe(700);
    expect(typicalCveWeek({ fetched_at: "2026-01-10T12:00:00.000Z", source, years: [{ year: 2026, total: 1000 }] })).toBeNull();
    expect(typicalCveWeek(null)).toBeNull();
  });
  it("averages the daily file's days before this week for a typical critical week", () => {
    const source = { name: "NVD", url: "https://nvd.nist.gov/", license: "public domain" };
    const days: Record<string, { cves: number; critical: number }> = {};
    for (let k = 0; k < 20; k++) days[`2026-10-${String(k + 1).padStart(2, "0")}`] = { cves: 500, critical: 40 + (k % 2) };
    days["2026-10-27"] = { cves: 900, critical: 300 };
    expect(typicalCriticalWeek({ fetched_at: NOW, source, days }, TODAY)).toBe(284);
    expect(typicalCriticalWeek({ fetched_at: NOW, source, days: { "2026-10-01": { cves: 1, critical: 1 } } }, TODAY)).toBeNull();
    expect(typicalCriticalWeek(null, TODAY)).toBeNull();
  });
  it("takes the median month of breaches over the months before", () => {
    const list = [{ added: "2026-10-01" }, { added: "2026-10-12" }, { added: "2026-10-30" }, { added: "2026-09-03" }, { added: "2026-11-03" }];
    expect(typicalBreachMonth(list, "2026-11", 3)).toBe(1);
    expect(typicalBreachMonth(list, "2026-11", 2)).toBe(2);
    expect(typicalBreachMonth([], "2026-11")).toBeNull();
  });
});

describe("how AI shows up", () => {
  it("splits the week by AI role and names techniques, targets and a case", () => {
    const week = [
      incident({ type: "attack_on_ai", categories: ["agent_hijack", "infra_vuln"], targets: ["framework_or_tooling"], severity: 3, source_count: 1 }),
      incident({ type: "attack_on_ai", categories: ["agent_hijack"], targets: ["framework_or_tooling", "n/a"], severity: 4, title: "The worst one" }),
      incident({ type: "attack_on_ai", categories: ["prompt_injection"], targets: ["open_weight_model"], severity: 3 }),
      incident({ type: "ai_enabled_attack", categories: ["ai_assisted_intrusion"], targets: ["individual_victims"] }),
      incident({ type: "not_ai", categories: ["general"], targets: ["n/a"] }),
    ];
    const all = [...week.map((i) => ({ ...i, first_reported: "2026-10-28" })), disclosedCve({ first_reported: "2026-10-28", type: "attack_on_ai", cve_ids: ["CVE-2026-0100"] })];
    const f = buildAiFlow(week, all, [kev({ vendor: "Langflow", product: "Langflow", added: "2026-03-01" }), kev({ vendor: "Langflow", product: "Langflow", added: "2025-12-01" })], TODAY);
    expect([f.total, f.target.n, f.weapon.n, f.none]).toEqual([5, 3, 1, 1]);
    expect(f.target.techniques.map((t) => `${t.n} ${t.label}`)).toEqual(["2 agent hijack", "1 prompt injection"]);
    expect(f.weapon.techniques[0]!.label).toBe("AI intrusion");
    expect(f.target.targets.map((t) => t.key)).toEqual(["framework_or_tooling", "open_weight_model"]);
    expect(f.target.case?.title).toBe("The worst one");
    expect(f.weak).toMatchObject({ cves: 1, exploited: 0, kevYear: 1, kevProducts: ["Langflow"] });
  });
  it("picks the case by severity, then sources, then the newest", () => {
    const a = incident({ severity: 3, first_reported: "2026-10-28", title: "a" });
    const b = incident({ severity: 3, first_reported: "2026-10-29", title: "b" });
    expect(pickCase([a, b])?.title).toBe("b");
    expect(pickCase([])).toBeNull();
  });
});

describe("my stack", () => {
  const entries = [
    kev({ cve: "CVE-2026-1001", vendor: "Microsoft", product: "Windows", added: "2026-10-01", due: "2026-10-22" }),
    kev({ cve: "CVE-2026-1002", vendor: "Microsoft", product: "SharePoint", added: "2026-09-10", due: "2026-10-01" }),
    kev({ cve: "CVE-2026-1003", vendor: "Linux", product: "Kernel", added: "2026-10-28", due: "2026-10-31" }),
    kev({ cve: "CVE-2026-1004", vendor: "Cisco", product: "IOS XE", added: "2026-10-05", due: "2026-10-26" }),
    kev({ cve: "CVE-2026-1005", vendor: "Langflow", product: "Langflow", added: "2026-10-10", due: "2026-10-31" }),
    kev({ cve: "CVE-2026-1006", vendor: "Old", product: "Thing", added: "2026-01-01", due: "2026-01-22" }),
  ];
  const recs = [
    // the same CVE as a KEV entry: counted once
    incident({ title: "Windows flaw exploited", products: ["Windows"], cve_ids: ["CVE-2026-1001"], severity: 3, first_reported: "2026-10-02", state: "closed", closed_at: "2026-10-20", lane: "patch" }),
    // a new exploited record without a CVE: counted, and red while unpatched
    incident({ title: "Citrix gateway attacks", products: ["NetScaler ADC"], severity: 3, first_reported: "2026-10-27", lane: "patch", patch_status: "unpatched", type: "not_ai", categories: ["general"] }),
    incident({ title: "LiteLLM key theft", products: ["LiteLLM"], severity: 3, first_reported: "2026-10-20", type: "attack_on_ai", lane: "supply_chain" }),
    incident({ title: "LiteLLM proxy hijack", products: ["LiteLLM"], severity: 3, first_reported: "2026-10-21", type: "attack_on_ai", lane: "patch", patch_status: "patched" }),
    // a passing mention in the summary does not make a record Microsoft's
    incident({ title: "Retailer breach", summary: "The attackers used a Microsoft Teams lure to reach staff before the breach.", products: ["Retail POS"], severity: 4, lane: "breach", first_reported: "2026-10-28" }),
  ];
  const file = buildStack(recs, entries, TODAY, NOW);
  const tile = (key: string) => file.candidates.find((c) => c.key === key)!;

  it("counts KEV entries and exploited records once per CVE", () => {
    expect(tile("microsoft").n).toBe(2);
    expect(tile("citrix").n).toBe(1);
    expect(tile("litellm").n).toBe(2);
  });
  it("lists exactly what it counts, open items first, a KEV entry linking the record that names it", () => {
    for (const c of file.candidates) expect(c.items).toHaveLength(c.n);
    const ms = tile("microsoft").items!;
    expect(ms.map((x) => x.cves[0])).toEqual(["CVE-2026-1001", "CVE-2026-1002"]);
    expect(ms[0]).toMatchObject({ kind: "kev", name: "Microsoft Windows", date: "2026-10-01", due: "2026-10-22", open: null, external: false });
    expect(ms[0]!.href).toMatch(/^\/incidents\/fixture-incident-\d+$/);
    expect(ms[1]).toMatchObject({ kind: "kev", href: "https://nvd.nist.gov/vuln/detail/CVE-2026-1002", external: true });
    expect(tile("linux").items![0]).toMatchObject({ kind: "kev", open: "due", due: "2026-10-31" });
    expect(tile("citrix").items).toMatchObject([{ kind: "record", name: "Citrix gateway attacks", cves: [], open: "unpatched", external: false }]);
    expect(tile("litellm").items!.map((x) => x.name)).toEqual(["LiteLLM proxy hijack", "LiteLLM key theft"]);
    expect(tile("litellm").items!.every((x) => x.open === null)).toBe(true);
  });
  it("points a vendor at CISA's catalog and a family at its product page; the page's tiles carry no list", () => {
    expect(tile("microsoft").href).toBe(kevCatalogHref("Microsoft"));
    expect(tile("microsoft").href).toBe("https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=Microsoft");
    expect(tile("litellm").href).toBe("/products/litellm");
    expect("items" in tileOf(tile("microsoft"))).toBe(false);
    expect(tileOf(tile("microsoft"))).toMatchObject({ key: "microsoft", n: 2 });
  });
  it("is red only while exploited and open", () => {
    expect(tile("microsoft").flag).toBeNull();
    expect(tile("linux")).toMatchObject({ flag: "patch by 31 Oct", why: ["CISA deadline 2026-10-31"] });
    expect(tile("citrix")).toMatchObject({ flag: "no patch yet" });
    expect(tile("litellm").flag).toBeNull();
    expect(tile("cisco").flag).toBeNull();
  });
  it("defaults to the top KEV vendors and AI families with at least two", () => {
    expect(file.default.slice(0, 3)).toEqual(["microsoft", "cisco", "langflow"].filter((k) => file.default.includes(k)).length ? file.default.slice(0, 3) : []);
    expect(file.default).toContain("microsoft");
    expect(file.default).toContain("litellm");
    expect(file.default).not.toContain("old");
    expect(file.candidates.some((c) => c.key === "old")).toBe(false);
  });
  it("matches the week's KEV additions to the picks, for the sieve", () => {
    expect(stackMatches(file, ["linux", "microsoft"]).map((m) => m.cve)).toEqual(["CVE-2026-1003"]);
    expect(stackMatches(file, ["microsoft"])).toEqual([]);
    expect(stackMatches(file, ["linux", "linux"])).toHaveLength(1);
  });
  it("reads picks from a URL: known keys only, no repeats", () => {
    const known = new Set(file.candidates.map((c) => c.key));
    expect(parsePicks("Linux, microsoft,nope,linux", known)).toEqual(["linux", "microsoft"]);
    expect(parsePicks("", known)).toEqual([]);
    expect(parsePicks(null, known)).toEqual([]);
  });
  it("turns every flag into a short badge with its tone", () => {
    expect(flagBadge("patch by 31 Oct")).toEqual({ word: "due 31 Oct", tone: "due" });
    expect(flagBadge("harm confirmed")).toEqual({ word: "harm", tone: "harm" });
    expect(flagBadge("no patch yet")).toEqual({ word: "no patch", tone: "open" });
    expect(flagBadge("partly patched")).toEqual({ word: "partial", tone: "partial" });
    for (const c of file.candidates) if (c.flag) expect(["due", "harm", "open", "partial"]).toContain(flagBadge(c.flag).tone);
  });
});

describe("open for", () => {
  it("counts whole UTC days since the first report", () => {
    const at = (iso: string) => Date.parse(iso);
    expect(openFor("2026-11-06", at("2026-11-09T10:00:00Z"))).toBe("open 3 days");
    expect(openFor("2026-11-08", at("2026-11-09T00:30:00Z"))).toBe("open 1 day");
    expect(openFor("2026-11-09", at("2026-11-09T23:59:00Z"))).toBe("open today");
    expect(openFor("2026-11-10", at("2026-11-09T12:00:00Z"))).toBe("open today");
  });
});

describe("time left", () => {
  it("reads in the coarsest unit that still says something, never a ticking clock", () => {
    const H = 3_600_000;
    expect(timeLeft(3 * 24 * H + 5 * H)).toBe("3 days");
    expect(timeLeft(47 * H)).toBe("1 day"); // floored: at least a day
    expect(timeLeft(24 * H)).toBe("1 day");
    expect(timeLeft(16 * H + 59 * 60_000 + 59_000)).toBe("16 h");
    expect(timeLeft(H)).toBe("1 h");
    expect(timeLeft(32 * 60_000)).toBe("32 min");
    expect(timeLeft(30_000)).toBe("1 min"); // the last minute rounds up, the countdown says "past due" at zero itself
  });
  it("splits the runway's countdown into two figures: hours and minutes, days and hours from two days out", () => {
    const H = 3_600_000;
    expect(countdownParts(21 * H + 32 * 60_000 + 46_000)).toEqual({ a: "21", au: "h", b: "32", bu: "m" });
    expect(countdownParts(47 * H + 59 * 60_000)).toEqual({ a: "47", au: "h", b: "59", bu: "m" });
    expect(countdownParts(48 * H)).toEqual({ a: "2", au: "d", b: "0", bu: "h" });
    expect(countdownParts(2 * 24 * H + 21 * H + 59 * 60_000)).toEqual({ a: "2", au: "d", b: "21", bu: "h" });
    expect(countdownParts(5 * 60_000)).toEqual({ a: "0", au: "h", b: "05", bu: "m" });
    expect(countdownParts(-1)).toEqual({ a: "0", au: "h", b: "00", bu: "m" });
  });
});
