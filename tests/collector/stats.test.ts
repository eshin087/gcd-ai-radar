import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import settingsJson from "@/collector/config/settings.json";
import { SettingsSchema, type Settings } from "@/collector/lib/config";
import { epssModule, batches } from "@/collector/stats/epss";
import { breachStat } from "@/collector/stats/hibp";
import { isFresh, readAllStats, runStats, serializeStats } from "@/collector/stats/index";
import { kevStatEntry } from "@/collector/stats/kev";
import { cvssOf, nvdTime, resetNvdClock, toRecentCve, windows, yearWindows, type NvdCve } from "@/collector/stats/nvd";
import type { StatsContext, StatsHttp } from "@/collector/stats/types";
import type { HttpOptions } from "@/collector/lib/http";
import { STATS_FILES } from "@/lib/stats-schema";

const settings: Settings = SettingsSchema.parse(settingsJson);
const NOW = new Date("2026-10-26T12:00:00Z");

function ctx(http: StatsHttp, extra: Partial<StatsContext> = {}): StatsContext {
  return { settings, now: NOW, http, recordCveIds: [], extraCveIds: [], log: () => undefined, ...extra };
}

/** A recorded-shape HTTP client answering by URL, counting calls. */
function fakeHttp(answer: (url: string, opts?: HttpOptions) => unknown): StatsHttp & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async json<T>(url: string, opts?: HttpOptions) {
      calls.push(url);
      const out = answer(url, opts);
      if (out instanceof Error) throw out;
      return out as T;
    },
    async sleep() {
      /* no waiting in tests */
    },
  };
}

const nvdCve = (id: string, published: string, metrics?: NvdCve["metrics"], description = "A buffer overflow in Example lets a remote attacker run code. More text follows here."): NvdCve => ({
  id,
  published,
  descriptions: [{ lang: "en", value: description }],
  metrics,
});

describe("NVD helpers", () => {
  it("cuts a year into windows of at most 120 days that cover it without gaps", () => {
    const w = windows("2024-01-01", "2024-12-31");
    expect(w).toHaveLength(4);
    expect(w[0]).toEqual(["2024-01-01", "2024-04-29"]);
    expect(w[w.length - 1]![1]).toBe("2024-12-31");
    for (let i = 1; i < w.length; i++) expect(Date.parse(w[i]![0]) - Date.parse(w[i - 1]![1])).toBe(86_400_000);
    for (const [from, to] of w) expect((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1).toBeLessThanOrEqual(120);
    expect(yearWindows(2026, "2026-10-26")[yearWindows(2026, "2026-10-26").length - 1]![1]).toBe("2026-10-26");
    expect(yearWindows(2020, "2026-10-26")).toHaveLength(4);
  });

  it("normalises NVD's zone-less timestamps to UTC", () => {
    expect(nvdTime("2024-01-01T08:15:36.087")).toBe("2024-01-01T08:15:36.087Z");
    expect(nvdTime("2024-01-01T08:15:36.087+00:00")).toBe("2024-01-01T08:15:36.087Z");
  });

  it("prefers the newest CVSS version NVD scored", () => {
    expect(cvssOf({ metrics: { cvssMetricV31: [{ cvssData: { baseScore: 7.5, baseSeverity: "HIGH" } }], cvssMetricV40: [{ cvssData: { baseScore: 8.7, baseSeverity: "High" } }] } })).toEqual({ score: 8.7, severity: "HIGH", version: "4.0" });
    expect(cvssOf({ metrics: { cvssMetricV30: [{ cvssData: { baseScore: 5.3, baseSeverity: "MEDIUM" } }] } })).toEqual({ score: 5.3, severity: "MEDIUM", version: "3.0" });
    expect(cvssOf({})).toEqual({ score: null, severity: null, version: null });
  });

  it("maps a CVE to one line with the first sentence", () => {
    const r = toRecentCve(nvdCve("CVE-2026-1234", "2026-10-25T10:00:00.000", { cvssMetricV31: [{ cvssData: { baseScore: 9.8, baseSeverity: "CRITICAL" } }] }));
    expect(r).toMatchObject({ id: "CVE-2026-1234", published: "2026-10-25T10:00:00.000Z", score: 9.8, severity: "CRITICAL", version: "3.1" });
    expect(r.description).toBe("A buffer overflow in Example lets a remote attacker run code.");
    expect(toRecentCve(nvdCve("CVE-2026-1", "2026-10-25T10:00:00.000", undefined, "x".repeat(400))).description.length).toBeLessThanOrEqual(160);
  });
});

describe("KEV, HIBP and EPSS mapping", () => {
  const entry = { cveID: "CVE-2026-1", vendorProject: "V", product: "P", vulnerabilityName: "N", dateAdded: "2026-10-20", shortDescription: "", dueDate: "2026-11-10", knownRansomwareCampaignUse: "Known" };

  it("joins NVD publish dates and falls back to the previous file", () => {
    expect(kevStatEntry(entry, { published: "2026-10-01", cvss: 9.1 }, undefined)).toMatchObject({ cve: "CVE-2026-1", added: "2026-10-20", due: "2026-11-10", ransomware: true, published: "2026-10-01", cvss: 9.1 });
    const prev = kevStatEntry(entry, { published: "2026-10-02", cvss: 8 }, undefined);
    expect(kevStatEntry({ ...entry, dueDate: "soon", knownRansomwareCampaignUse: "Unknown" }, undefined, prev)).toMatchObject({ due: null, ransomware: false, published: "2026-10-02", cvss: 8 });
    expect(kevStatEntry(entry, undefined, undefined)).toMatchObject({ published: null, cvss: null });
  });

  it("reduces a breach and drops malformed ones", () => {
    const b = breachStat({ Name: "Acme", Title: "Acme Corp", Domain: "acme.test", BreachDate: "2026-09-01", AddedDate: "2026-10-05T10:00:00Z", PwnCount: 1234, Description: "", DataClasses: [], IsVerified: true, IsFabricated: false, IsRetired: false, IsSpamList: false, IsMalware: true, IsStealerLog: false });
    expect(b).toMatchObject({ name: "Acme", added: "2026-10-05", breach_date: "2026-09-01", accounts: 1234, verified: true, malware: true, spam_list: false });
    expect(breachStat({ Name: "", Title: "x", Domain: "", BreachDate: "", AddedDate: "2026-10-05", PwnCount: 1, Description: "", DataClasses: [], IsVerified: true, IsFabricated: false, IsRetired: false, IsSpamList: false, IsMalware: false, IsStealerLog: false })).toBeNull();
  });

  it("fetches EPSS in batches, keeps yesterday's score when a batch fails, and tracks the model date", async () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    const ids = Array.from({ length: 150 }, (_, n) => `CVE-2026-${String(1000 + n)}`);
    const http = fakeHttp((url) => {
      if (url.includes("CVE-2026-1100")) return new Error("rate limited");
      const list = url.split("cve=")[1]!.split(",");
      return { status: "OK", data: list.map((cve) => ({ cve, epss: "0.123456", percentile: "0.5", date: "2026-10-26" })) };
    });
    const previous = { fetched_at: "2026-10-25T12:00:00Z", source: { name: "x", url: "https://x.test", license: "y" }, model_date: "2026-10-25", scores: { "CVE-2026-1100": [0.9, 0.99] as [number, number], "CVE-2000-0001": [0.1, 0.1] as [number, number] } };
    const out = await epssModule.fetch(ctx(http, { recordCveIds: ids }), previous);
    expect(http.calls).toHaveLength(2);
    expect(out.scores["CVE-2026-1000"]).toEqual([0.1235, 0.5]);
    expect(out.scores["CVE-2026-1100"]).toEqual([0.9, 0.99]); // the failed batch kept the previous score
    expect(out.scores["CVE-2000-0001"]).toBeUndefined(); // no longer wanted
    expect(out.model_date).toBe("2026-10-26");
  });
});

describe("runStats", () => {
  const dirs: string[] = [];
  let dir: string;
  beforeEach(async () => {
    resetNvdClock();
    dir = await mkdtemp(path.join(tmpdir(), "radar-stats-"));
    dirs.push(dir);
  });
  afterAll(async () => {
    // only the directories this file created, never their parent
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => undefined);
  });

  const catalog = { catalogVersion: "2026.10.25", vulnerabilities: [{ cveID: "CVE-2026-0007", vendorProject: "V", product: "P", vulnerabilityName: "N", dateAdded: "2026-10-20", shortDescription: "", dueDate: "2026-11-10", knownRansomwareCampaignUse: "Unknown" }] };
  const breaches = [{ Name: "Acme", Title: "Acme", Domain: "", BreachDate: "2026-09-01", AddedDate: "2026-10-05", PwnCount: 10, Description: "", DataClasses: [], IsVerified: true, IsFabricated: false, IsRetired: false, IsSpamList: false, IsMalware: false, IsStealerLog: false }];

  function liveLike(breakKev = false, catalogVersion = "2026.10.25") {
    return fakeHttp((url) => {
      if (url.startsWith("https://www.cisa.gov/")) return breakKev ? new Error("503") : { ...catalog, catalogVersion };
      if (url.startsWith("https://haveibeenpwned.com/")) return breaches;
      if (url.startsWith("https://api.first.org/")) {
        const list = url.split("cve=")[1]!.split(",");
        return { data: list.map((cve) => ({ cve, epss: "0.5", percentile: "0.5", date: "2026-10-26" })) };
      }
      if (url.startsWith("https://services.nvd.nist.gov/")) {
        if (url.includes("hasKev")) return { totalResults: 1, resultsPerPage: 2000, startIndex: 0, vulnerabilities: [{ cve: nvdCve("CVE-2026-0007", "2026-10-01T00:00:00.000", { cvssMetricV31: [{ cvssData: { baseScore: 9.8, baseSeverity: "CRITICAL" } }] }) }] };
        if (url.includes("resultsPerPage=1&")) return { totalResults: 5, resultsPerPage: 1, startIndex: 0 };
        return { totalResults: 1, resultsPerPage: 2000, startIndex: 0, vulnerabilities: [{ cve: nvdCve("CVE-2026-0008", "2026-10-25T10:00:00.000") }] };
      }
      return new Error(`unexpected ${url}`);
    });
  }

  it("writes the five files, skips them while fresh, and leaves a dry run clean", async () => {
    const http = liveLike();
    const first = await runStats(settings, { dataDir: dir, http, now: NOW, recordCveIds: ["CVE-2026-0009"] });
    expect(first.failed).toEqual([]);
    expect(first.changed.sort()).toEqual(Object.values(STATS_FILES).map((f) => `stats/${f}`).sort());
    const files = await readdir(path.join(dir, "stats"));
    expect(files.sort()).toEqual(Object.values(STATS_FILES).sort());
    const all = await readAllStats(dir);
    expect(all.nvdCounts!.years.map((y) => y.year)).toContain(1999);
    expect(all.nvdCounts!.years.every((y) => y.total > 0)).toBe(true);
    expect(all.kev!.entries[0]).toMatchObject({ cve: "CVE-2026-0007", published: "2026-10-01", cvss: 9.8 });
    expect(Object.keys(all.epss!.scores).sort()).toEqual(["CVE-2026-0007", "CVE-2026-0008", "CVE-2026-0009"]);
    // the files diff by line: one array element per line
    const raw = await readFile(path.join(dir, "stats", STATS_FILES.kev), "utf8");
    expect(raw.split("\n").filter((l) => l.startsWith("  {"))).toHaveLength(1);

    const second = await runStats(settings, { dataDir: dir, http, now: new Date(NOW.getTime() + 3_600_000), recordCveIds: [] });
    expect(second.changed).toEqual([]);
    expect(second.skipped).toHaveLength(5);

    // a day later with the same answers: due again, but only fetched_at would differ, so nothing is written
    const later = new Date(NOW.getTime() + 25 * 3_600_000);
    const same = await runStats(settings, { dataDir: dir, http, now: later, recordCveIds: ["CVE-2026-0009"] });
    expect(same.changed).toEqual([]);
    expect(same.skipped).toHaveLength(5);

    // a changed catalog in a dry run: reported as changed, written nowhere
    const dry = await runStats(settings, { dataDir: dir, http: liveLike(false, "2026.10.27"), now: later, recordCveIds: ["CVE-2026-0009"], dryRun: true, only: ["kev"] });
    expect(dry.changed).toEqual(["stats/kev.json"]);
    const after = await readAllStats(dir);
    expect(after.kev!.catalog_version).toBe("2026.10.25");
    expect(after.kev!.fetched_at).toBe(all.kev!.fetched_at);
  });

  it("keeps the previous file when a source fails", async () => {
    await runStats(settings, { dataDir: dir, http: liveLike(), now: NOW, recordCveIds: [] });
    const before = await readAllStats(dir);
    const r = await runStats(settings, { dataDir: dir, http: liveLike(true), now: new Date(NOW.getTime() + 25 * 3_600_000), recordCveIds: [], only: ["kev"] });
    expect(r.failed).toEqual(["kev"]);
    expect(r.changed).toEqual([]);
    expect((await readAllStats(dir)).kev).toEqual(before.kev);
  });

  it("freshness and serialization", () => {
    expect(isFresh({ fetched_at: "2026-10-26T00:00:00Z" }, 20, NOW)).toBe(true);
    expect(isFresh({ fetched_at: "2026-10-25T00:00:00Z" }, 20, NOW)).toBe(false);
    expect(isFresh(null, 20, NOW)).toBe(false);
    const s = serializeStats({ fetched_at: "x", years: [{ year: 1 }, { year: 2 }], scores: { b: [1, 1], a: [0, 0] }, none: [] });
    expect(JSON.parse(s)).toEqual({ fetched_at: "x", years: [{ year: 1 }, { year: 2 }], scores: { a: [0, 0], b: [1, 1] }, none: [] });
    expect(s.split("\n").filter((l) => l.startsWith("  {"))).toHaveLength(2);
  });
});
