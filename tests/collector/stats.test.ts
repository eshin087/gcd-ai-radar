import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import settingsJson from "@/collector/config/settings.json";
import { SettingsSchema, type Settings } from "@/collector/lib/config";
import { addDays } from "@/collector/lib/ids";
import { DAILY_DAYS, completeDays, dailyModule, mergeDays } from "@/collector/stats/daily";
import { epssModule, batches } from "@/collector/stats/epss";
import { breachStat } from "@/collector/stats/hibp";
import { isFresh, readAllStats, runStats, serializeStats } from "@/collector/stats/index";
import { KEV_SOURCE, kevModule, kevStatEntry } from "@/collector/stats/kev";
import { NVD_SOURCE, RECENT_DAYS, cvssOf, nvdTime, resetNvdClock, toRecentCve, windows, yearWindows, type NvdCve } from "@/collector/stats/nvd";
import type { StatsContext, StatsHttp } from "@/collector/stats/types";
import type { HttpOptions } from "@/collector/lib/http";
import { STATS_FILES, type CvesRecent } from "@/lib/stats-schema";

const settings: Settings = SettingsSchema.parse(settingsJson);
const NOW = new Date("2026-10-26T12:00:00Z");

function ctx(http: StatsHttp, extra: Partial<StatsContext> = {}): StatsContext {
  return { settings, now: NOW, http, recordCveIds: [], extraCveIds: [], produced: {}, log: () => undefined, ...extra };
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

  it("runs the NVD join only for a new listing, a recent entry still unscored, or no previous file", async () => {
    const listing = (dateAdded = "2026-10-20") => ({ ...entry, cveID: "CVE-2026-0001", dateAdded });
    const http = (vulnerabilities: (typeof entry)[]) =>
      fakeHttp((url) => {
        if (url.startsWith("https://www.cisa.gov/")) return { catalogVersion: "2026.10.26", vulnerabilities };
        if (url.includes("hasKev")) return { totalResults: 1, resultsPerPage: 500, startIndex: 0, vulnerabilities: [{ cve: nvdCve("CVE-2026-0001", "2026-10-02T00:00:00.000", { cvssMetricV31: [{ cvssData: { baseScore: 7.5, baseSeverity: "HIGH" } }] }) }] };
        return new Error(`unexpected ${url}`);
      });
    const nvdCalls = (h: { calls: string[] }) => h.calls.filter((u) => u.includes("hasKev")).length;
    const previous = (l: typeof entry, nvd: { published: string; cvss: number | null }, fetched_at = "2026-10-26T10:00:00.000Z") => ({ fetched_at, source: KEV_SOURCE, catalog_version: "2026.10.25", entries: [kevStatEntry(l, nvd, undefined)] });
    const scored = { published: "2026-10-01", cvss: 9.1 };

    // a quiet refresh, even from a file written on an earlier UTC day: no join, the previous date and score carry over
    const lines: string[] = [];
    const quiet = http([listing()]);
    const kept = (await kevModule.fetch(ctx(quiet, { log: (msg) => lines.push(msg) }), previous(listing(), scored, "2026-10-24T23:30:00.000Z")))!;
    expect(nvdCalls(quiet)).toBe(0);
    expect(kept.entries[0]).toMatchObject({ cve: "CVE-2026-0001", published: "2026-10-01", cvss: 9.1 });
    expect(lines).toContain("stats kev: no new listing, NVD join skipped");

    // a CVE the previous file lacks: joined, and the join's answers win
    const listed = http([listing(), { ...entry, cveID: "CVE-2026-0002", dateAdded: "2026-10-26" }]);
    const joined = (await kevModule.fetch(ctx(listed), previous(listing(), scored)))!;
    expect(nvdCalls(listed)).toBe(1);
    expect(joined.entries.find((e) => e.cve === "CVE-2026-0001")).toMatchObject({ published: "2026-10-02", cvss: 7.5 });

    // listed 10 days ago and still unscored: joined until NVD scores it
    const recent = http([listing("2026-10-16")]);
    await kevModule.fetch(ctx(recent), previous(listing("2026-10-16"), { published: "2026-10-01", cvss: null }));
    expect(nvdCalls(recent)).toBe(1);

    // listed 40 days ago and still unscored: left alone
    const old = http([listing("2026-09-16")]);
    await kevModule.fetch(ctx(old), previous(listing("2026-09-16"), { published: "2026-09-01", cvss: null }));
    expect(nvdCalls(old)).toBe(0);

    // no previous file: joined
    const first = http([listing()]);
    await kevModule.fetch(ctx(first), null);
    expect(nvdCalls(first)).toBe(1);
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
    const out = (await epssModule.fetch(ctx(http, { recordCveIds: ids }), previous))!;
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
    expect(second.skipped).toHaveLength(6);

    // a day later with the same answers: due again, but only fetched_at would differ, so nothing is written
    // except daily.json, which gains the day that has closed since (2026-10-26, no CVEs)
    const later = new Date(NOW.getTime() + 25 * 3_600_000);
    const same = await runStats(settings, { dataDir: dir, http, now: later, recordCveIds: ["CVE-2026-0009"] });
    expect(same.changed).toEqual(["stats/daily.json"]);
    expect(same.skipped).toHaveLength(5);
    expect((await readAllStats(dir)).daily!.days["2026-10-26"]).toEqual({ cves: 0, critical: 0 });

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

  it("builds daily.json from the cves-recent window this run fetched, with no request of its own, and skips it without one", async () => {
    // no cves-recent file: nothing to count, so skipped (not failed) and nothing written
    const none = await runStats(settings, { dataDir: dir, http: fakeHttp(() => new Error("no calls")), now: NOW, recordCveIds: [], only: ["daily"] });
    expect(none).toEqual({ changed: [], failed: [], skipped: ["daily"] });
    expect((await readAllStats(dir)).daily).toBeNull();

    const http = liveLike();
    const r = await runStats(settings, { dataDir: dir, http, now: NOW, recordCveIds: [], only: ["cves-recent", "daily"] });
    expect(r.changed).toEqual(["stats/cves-recent.json", "stats/daily.json"]);
    expect(http.calls).toHaveLength(1); // the cves-recent page; daily asked nothing
    // the window opens at 00:00 UTC, so its first day is whole: completeDays relies on this
    expect(http.calls[0]).toContain(`pubStartDate=${encodeURIComponent(`${addDays("2026-10-26", -RECENT_DAYS)}T00:00:00.000+00:00`)}`);
    const daily = (await readAllStats(dir)).daily!;
    expect(daily.fetched_at).toBe(NOW.toISOString());
    expect(Object.keys(daily.days)).toEqual(Array.from({ length: RECENT_DAYS }, (_, n) => addDays("2026-10-12", n)));
    expect(daily.days["2026-10-25"]).toEqual({ cves: 1, critical: 0 });
    // one day per line
    const raw = await readFile(path.join(dir, "stats", STATS_FILES.daily), "utf8");
    expect(raw.split("\n").filter((l) => l.startsWith('  "2026-'))).toHaveLength(RECENT_DAYS);
  });

  it("reads the KEV catalog on every hourly run (every other one at 30 minutes) and counts daily.json on every run", () => {
    const ago = (minutes: number) => ({ fetched_at: new Date(NOW.getTime() - minutes * 60_000).toISOString() });
    expect(isFresh(ago(60), kevModule.maxAgeHours, NOW)).toBe(false);
    expect(isFresh(ago(30), kevModule.maxAgeHours, NOW)).toBe(true);
    expect(isFresh(ago(0), dailyModule.maxAgeHours, NOW)).toBe(false);
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

describe("daily.json", () => {
  const SRC = { name: "NVD", url: "https://nvd.test", license: "public domain" };
  const cve = (id: string, published: string, score: number | null): CvesRecent["cves"][number] => ({ id, published, score, severity: null, version: null, description: "" });
  const recent = (fetched_at: string, cves: CvesRecent["cves"], window_days = 4): CvesRecent => ({ fetched_at, source: SRC, window_days, cves });

  it("counts complete days only: inside the window and before the UTC day it was fetched, zeros included, critical from 9.0", () => {
    const days = completeDays(
      recent("2026-10-26T12:00:00.000Z", [
        cve("CVE-2026-0001", "2026-10-21T23:59:59.999Z", 9.8), // before the window
        cve("CVE-2026-0002", "2026-10-23T00:00:00.000Z", 9.0),
        cve("CVE-2026-0003", "2026-10-23T12:00:00.000Z", 8.9),
        cve("CVE-2026-0004", "2026-10-24T05:00:00.000Z", null),
        cve("CVE-2026-0005", "2026-10-25T23:59:59.999Z", 10),
        cve("CVE-2026-0006", "2026-10-26T01:00:00.000Z", 9.8), // today, still filling up
      ]),
    );
    expect(days).toEqual({
      "2026-10-22": { cves: 0, critical: 0 },
      "2026-10-23": { cves: 2, critical: 1 },
      "2026-10-24": { cves: 1, critical: 0 },
      "2026-10-25": { cves: 1, critical: 1 },
    });
  });

  it("lets a newer count replace an older one and keeps the newest 120 days, keys ascending", () => {
    const merged = mergeDays({ "2026-10-23": { cves: 1, critical: 0 }, "2026-10-20": { cves: 5, critical: 1 } }, { "2026-10-23": { cves: 3, critical: 1 } });
    expect(merged).toEqual({ "2026-10-20": { cves: 5, critical: 1 }, "2026-10-23": { cves: 3, critical: 1 } });
    expect(Object.keys(merged)).toEqual(["2026-10-20", "2026-10-23"]);

    const start = "2026-06-01";
    const long: Record<string, { cves: number; critical: number }> = {};
    for (let n = 0; n < 125; n++) long[addDays(start, n)] = { cves: n, critical: 0 };
    const keys = Object.keys(mergeDays(long, { [addDays(start, 125)]: { cves: 125, critical: 0 } }));
    expect(DAILY_DAYS).toBe(120);
    expect(keys).toHaveLength(DAILY_DAYS);
    expect(keys[0]).toBe(addDays(start, 6));
    expect(keys[keys.length - 1]).toBe(addDays(start, 125));
    expect([...keys].sort()).toEqual(keys);
  });

  it("returns nothing without cves-recent, or with one older than its counts, and otherwise merges and stamps the cves-recent fetch", async () => {
    const http = fakeHttp(() => new Error("no calls"));
    expect(await dailyModule.fetch(ctx(http), null)).toBeNull();
    expect(await dailyModule.fetch(ctx(http, { produced: { "cves-recent": null } }), null)).toBeNull();

    const r = recent("2026-10-26T06:00:00.000Z", [cve("CVE-2026-0002", "2026-10-25T10:00:00.000Z", 9.1)]);
    const previous = { fetched_at: "2026-10-25T06:00:00.000Z", source: NVD_SOURCE, days: { "2026-10-01": { cves: 7, critical: 2 }, "2026-10-25": { cves: 0, critical: 0 } } };
    expect(await dailyModule.fetch(ctx(http, { produced: { "cves-recent": r } }), previous)).toEqual({
      fetched_at: r.fetched_at,
      source: NVD_SOURCE,
      days: {
        "2026-10-01": { cves: 7, critical: 2 },
        "2026-10-22": { cves: 0, critical: 0 },
        "2026-10-23": { cves: 0, critical: 0 },
        "2026-10-24": { cves: 0, critical: 0 },
        "2026-10-25": { cves: 1, critical: 1 },
      },
    });
    expect(await dailyModule.fetch(ctx(http, { produced: { "cves-recent": r } }), { ...previous, fetched_at: "2026-10-26T07:00:00.000Z" })).toBeNull();
    expect(http.calls).toEqual([]);
  });
});
