import { describe, expect, it } from "vitest";
import { BREACH_MONTHS, CLUSTER_DAYS, CLUSTER_ITEMS, EPSS_TOP, HOME_ROWS, KEV_MONTHS, LAG_MIN_N, aiCvesByQuarter, breachesMonthList, buildHome, countableBreach, dayCvesList, kevLagByYear, median, quarterKey, quarterRange, weekCvesList } from "@/lib/home";
import { HomeStatsSchema, emptyStats, type BreachStat, type KevStatEntry, type StatsFiles } from "@/lib/stats-schema";
import { disclosedCve, incident } from "./fixtures";

const NOW = new Date("2026-10-26T12:00:00Z");
const SITE = "https://example.test";
const SRC = { name: "Test source", url: "https://example.test/source", license: "CC0 1.0" };

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function kevEntry(over: Partial<KevStatEntry>): KevStatEntry {
  return { cve: "CVE-2024-0001", added: "2024-03-01", due: "2024-03-22", vendor: "Vendor", product: "Product", name: "Flaw", ransomware: false, published: "2024-02-20", cvss: 9.8, ...over };
}

function breach(over: Partial<BreachStat>): BreachStat {
  return { name: "Acme", title: "Acme", domain: "acme.test", breach_date: "2026-09-01", added: "2026-10-05", accounts: 1000, verified: true, sensitive: false, spam_list: false, stealer_log: false, malware: false, fabricated: false, retired: false, ...over };
}

function stats(): StatsFiles {
  const lagEntries = Array.from({ length: LAG_MIN_N }, (_, n) =>
    kevEntry({ cve: `CVE-2024-10${String(n).padStart(2, "0")}`, added: "2024-06-15", published: `2024-06-${String(15 - (n + 1)).padStart(2, "0")}` }),
  ); // lags 1..10 days
  return {
    nvdCounts: { fetched_at: hoursAgo(2), source: { ...SRC, name: "NVD" }, years: [{ year: 1999, total: 894 }, { year: 2025, total: 40000 }, { year: 2026, total: 35000 }] },
    cvesRecent: {
      fetched_at: hoursAgo(2),
      source: { ...SRC, name: "NVD" },
      window_days: 30,
      cves: [
        { id: "CVE-2026-0001", published: hoursAgo(1), score: 9.8, severity: "CRITICAL", version: "3.1", description: "Fresh critical." },
        { id: "CVE-2026-0002", published: hoursAgo(72), score: 7.5, severity: "HIGH", version: "3.1", description: "Three days old." },
        { id: "CVE-2026-0003", published: hoursAgo(24 * 20), score: null, severity: null, version: null, description: "Unscored, old." },
      ],
    },
    daily: null,
    kev: {
      fetched_at: hoursAgo(3),
      source: { ...SRC, name: "CISA KEV" },
      catalog_version: "2026.10.25",
      entries: [
        kevEntry({ cve: "CVE-2026-0002", added: "2026-10-25", due: "2026-11-15", ransomware: true, published: "2026-10-20" }),
        kevEntry({ cve: "CVE-2026-0100", added: "2026-10-01", due: "2026-10-10", published: "2026-09-01" }),
        ...lagEntries,
      ],
    },
    hibp: {
      fetched_at: hoursAgo(4),
      source: { ...SRC, name: "Have I Been Pwned" },
      breaches: [
        breach({ name: "Acme", added: "2026-10-05", accounts: 1000 }),
        breach({ name: "SpamList", added: "2026-10-06", accounts: 999_999, spam_list: true }),
        breach({ name: "Unverified", added: "2026-10-07", accounts: 5, verified: false }),
        breach({ name: "LastMonth", added: "2026-09-30", accounts: 50 }),
      ],
    },
    epss: { fetched_at: hoursAgo(5), source: { ...SRC, name: "EPSS, FIRST" }, model_date: "2026-10-26", scores: { "CVE-2026-0001": [0.2, 0.9], "CVE-2026-0002": [0.95, 0.999], "CVE-2026-0003": [0.01, 0.3] } },
  };
}

function records() {
  return [
    incident({ id: "AIR-2026-0001", slug: "a", type: "attack_on_ai", lane: "patch", state: "live", patch_status: "unpatched", severity: 3, cve_ids: ["CVE-2026-0002"], first_reported: "2026-10-20", incident_date: "2026-10-20" }),
    incident({ id: "AIR-2026-0002", slug: "b", type: "ai_enabled_attack", lane: "breach", state: "live", severity: 4, first_reported: "2026-10-22", incident_date: "2026-10-21" }),
    incident({ id: "AIR-2026-0003", slug: "c", type: "not_ai", categories: ["general"], lane: "breach", state: "live", severity: 3, first_reported: "2026-10-23", incident_date: "2026-10-23" }),
    incident({ id: "AIR-2026-0004", slug: "d", type: "attack_on_ai", lane: "patch", state: "closed", closed_at: "2026-09-01", severity: 3, cve_ids: ["CVE-2025-0001"], first_reported: "2025-08-01", incident_date: "2025-08-01" }),
    disclosedCve({ id: "AIR-2026-0005", slug: "e", cve_ids: ["CVE-2026-0300"], first_reported: "2026-10-10", incident_date: "2026-10-10" }),
  ];
}

describe("home helpers", () => {
  it("quarters and medians", () => {
    expect(quarterKey("2026-10-26")).toBe("2026-Q4");
    expect(quarterKey("2026-01-01")).toBe("2026-Q1");
    expect(quarterRange("2025-Q3", "2026-Q1")).toEqual(["2025-Q3", "2025-Q4", "2026-Q1"]);
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("counts only verified real breaches", () => {
    expect(countableBreach(breach({}))).toBe(true);
    for (const flag of ["spam_list", "stealer_log", "malware", "fabricated", "retired"] as const) expect(countableBreach(breach({ [flag]: true }))).toBe(false);
    expect(countableBreach(breach({ verified: false }))).toBe(false);
  });

  it("KEV lag by year needs enough entries, skips the backlog, and reports the median and the week share", () => {
    const entries = stats().kev!.entries;
    const rows = kevLagByYear(entries);
    expect(rows.map((r) => r.year)).toEqual([2024]);
    expect(rows[0]).toMatchObject({ n: LAG_MIN_N, median_days: 5.5, within_7d: 0.7 });
    // a CVE from a decade earlier listed in 2024 says nothing about speed and is left out
    const withBacklog = [...entries, kevEntry({ cve: "CVE-2014-0001", added: "2024-06-20", published: "2014-01-01" })];
    expect(kevLagByYear(withBacklog)[0]).toMatchObject({ n: LAG_MIN_N, median_days: 5.5 });
  });

  it("AI CVEs per quarter run from 2016-Q1 to the current quarter, the last one provisional", () => {
    const rows = aiCvesByQuarter(records(), "2026-Q4");
    expect(rows[0]!.quarter).toBe("2016-Q1");
    // the live patch record and the disclosed AI CVE both count: a CVE in AI software is a CVE in AI software, exploited or not
    expect(rows[rows.length - 1]).toEqual({ quarter: "2026-Q4", total: 2, provisional: true });
    expect(rows.find((r) => r.quarter === "2025-Q3")!.total).toBe(1);
    expect(rows.filter((r) => r.provisional)).toHaveLength(1);
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(3);
  });
});

describe("buildHome", () => {
  const home = buildHome(records(), stats(), NOW, "2026-10-26T11:00:00Z", SITE);

  it("counters follow their rules", () => {
    expect(home.stats.counters).toEqual({
      cves_24h: 1,
      cves_7d: 2,
      critical_7d: 1,
      kev_7d: 1,
      kev_next_due: "2026-11-15",
      breaches_month: 1,
      breached_accounts_month: 1000,
      live: home.live.counters.live,
    });
    expect(home.live.counters.live).toBe(3);
  });

  it("series span their windows and flag the open period", () => {
    const s = home.stats.series;
    expect(s.kev_by_month).toHaveLength(KEV_MONTHS);
    expect(s.kev_by_month[KEV_MONTHS - 1]).toEqual({ month: "2026-10", total: 2, ransomware: 1 });
    expect(s.breaches_by_month).toHaveLength(BREACH_MONTHS);
    expect(s.breaches_by_month[BREACH_MONTHS - 1]).toEqual({ month: "2026-10", breaches: 1, accounts: 1000 });
    expect(s.breaches_by_month[BREACH_MONTHS - 2]).toEqual({ month: "2026-09", breaches: 1, accounts: 50 });
    expect(s.cves_by_year.filter((y) => y.provisional).map((y) => y.year)).toEqual([2026]);
    expect(s.kev_lag_by_year).toHaveLength(1);
  });

  it("ranks the EPSS ten and links our record", () => {
    expect(home.stats.epss_top.map((e) => e.cve)).toEqual(["CVE-2026-0002", "CVE-2026-0001", "CVE-2026-0003"]);
    expect(home.stats.epss_top[0]).toMatchObject({ slug: "a", score: 7.5, epss: 0.95 });
    expect(home.stats.epss_top[1]!.slug).toBeNull();
    expect(home.stats.epss_top.length).toBeLessThanOrEqual(EPSS_TOP);
  });

  it("names the drawer lists and their counts", () => {
    expect(home.stats.lists).toEqual({
      cves_day: { count: 1, file: "/stats/cves-day.json" },
      cves_week: { count: 2, file: "/stats/cves-week.json" },
      kev_month: { month: "2026-10", count: 2, file: "/stats/kev-2026-10.json" },
      breaches_month: { month: "2026-10", count: 1, file: "/stats/breaches-2026-10.json" },
    });
    expect(weekCvesList(stats(), NOW).map((c) => c.id)).toEqual(["CVE-2026-0001", "CVE-2026-0002"]);
    expect(dayCvesList(stats(), NOW).map((c) => c.id)).toEqual(["CVE-2026-0001"]);
    // the day's list holds exactly what the 24-hour counter counts
    expect(dayCvesList(stats(), NOW)).toHaveLength(home.stats.counters.cves_24h!);
    expect(breachesMonthList(stats(), "2026-10").map((b) => b.name)).toEqual(["Acme"]);
  });

  it("fills the columns from the live boards", () => {
    expect(home.columns.patch.rows.length).toBeLessThanOrEqual(HOME_ROWS);
    expect(home.columns.patch).toMatchObject({ live: 1, note: "1 without a full fix", href: "/live?lane=patch" });
    expect(home.columns.breach).toMatchObject({ live: 2, note: "1 with confirmed loss" });
    expect(home.columns.supply_chain).toBe(0);
  });

  it("the AI lens counts this month and this quarter", () => {
    expect(home.aiLens).toMatchObject({ month: "2026-10", quarter: "2026-Q4", attacksOnAiMonth: 1, aiEnabledMonth: 1, aiCvesQuarter: 2, live: 2 });
  });

  it("the public shape validates and carries every source once", () => {
    expect(() => HomeStatsSchema.parse(home.stats)).not.toThrow();
    expect(home.stats.sources.map((s) => s.name)).toEqual(["NVD", "CISA KEV", "Have I Been Pwned", "EPSS, FIRST"]);
    expect(home.stats.fetched.kev).toBe(stats().kev!.fetched_at);
  });

  it("survives missing statistics files", () => {
    const bare = buildHome(records(), emptyStats(), NOW, null, SITE);
    expect(bare.stats.counters).toMatchObject({ cves_24h: null, cves_7d: null, critical_7d: null, kev_7d: null, kev_next_due: null, breaches_month: null, breached_accounts_month: null, live: 3 });
    expect(bare.stats.series.cves_by_year).toEqual([]);
    expect(bare.stats.series.kev_by_month).toHaveLength(KEV_MONTHS);
    expect(bare.stats.series.kev_lag_by_year).toEqual([]);
    expect(bare.stats.epss_top).toEqual([]);
    expect(bare.stats.fetched).toEqual({ nvd: null, kev: null, hibp: null, epss: null });
    expect(() => HomeStatsSchema.parse(bare.stats)).not.toThrow();
  });
});

describe("the hero cluster", () => {
  function clusterStats(): StatsFiles {
    const s = stats();
    s.kev!.entries = [
      kevEntry({ cve: "CVE-2026-1001", vendor: "Plex", product: "Media Server", added: "2026-10-24", due: "2026-11-03", cvss: 7.0 }),
      kevEntry({ cve: "CVE-2026-1002", vendor: "Plex", product: "Media Server", added: "2026-10-24", due: "2026-11-03", cvss: 9.1 }),
      kevEntry({ cve: "CVE-2026-1003", vendor: "Arista", product: "VeloCloud", added: "2026-10-23", due: "2026-10-26", cvss: 8.0 }),
      kevEntry({ cve: "CVE-2026-1004", vendor: "EG", product: "SiteGuard", added: "2026-10-22", due: "2026-10-25" }), // past its deadline
      kevEntry({ cve: "CVE-2026-1005", vendor: "Older", product: "Thing", added: "2026-10-12", due: "2026-11-09", cvss: null }), // added two weeks ago, still open
    ];
    s.cvesRecent!.cves.push({ id: "CVE-2026-0004", published: hoursAgo(24), score: 9.0, severity: "CRITICAL", version: "3.1", description: "Exactly a day old." });
    return s;
  }
  const home = buildHome(records(), clusterStats(), NOW, null, SITE);
  const c = home.cluster;

  it("lists every KEV deadline still ahead, folded and nearest first", () => {
    expect(c.kev).toEqual([
      { cve: "CVE-2026-1003", vendor: "Arista", product: "VeloCloud", added: "2026-10-23", due: "2026-10-26", cvss: 8.0, n: 1 },
      { cve: "CVE-2026-1001", vendor: "Plex", product: "Media Server", added: "2026-10-24", due: "2026-11-03", cvss: 9.1, n: 2 },
      { cve: "CVE-2026-1005", vendor: "Older", product: "Thing", added: "2026-10-12", due: "2026-11-09", cvss: null, n: 1 },
    ]);
    // the first deadline is the one the counters name
    expect(c.kev![0]!.due).toBe(home.stats.counters.kev_next_due);
  });

  it("windows the CVEs so the sparkline adds up to the counters", () => {
    const v = c.cves!;
    expect(v.perDay).toHaveLength(CLUSTER_DAYS);
    expect({ day: v.day, week: v.week, critical: v.critical }).toEqual({ day: home.stats.counters.cves_24h, week: home.stats.counters.cves_7d, critical: home.stats.counters.critical_7d });
    expect(v.day).toBe(2); // the CVE exactly 24 hours old counts, as in the counter
    expect(v.perDay[CLUSTER_DAYS - 1]).toBe(v.day);
    expect(v.perDay.slice(-7).reduce((a, b) => a + b, 0)).toBe(v.week);
    expect(v.criticalPerDay.slice(-7).reduce((a, b) => a + b, 0)).toBe(v.critical);
  });

  it("counts open severity 3+ records per action lane, newest first", () => {
    expect(c.open.lanes).toEqual({ patch: 1, breach: 2, supply_chain: 0 });
    expect(c.open.total).toBe(3);
    // records c, b and a, newest first
    expect(c.open.rows.map((r) => [r.lane, r.reported])).toEqual([
      ["breach", "2026-10-23"],
      ["breach", "2026-10-22"],
      ["patch", "2026-10-20"],
    ]);
    expect(c.open.rows.length).toBeLessThanOrEqual(CLUSTER_ITEMS);
  });

  it("carries the month's countable breaches and the accounts counter", () => {
    expect(c.breaches).toEqual({ month: "2026-10", accounts: home.stats.counters.breached_accounts_month, rows: [{ title: "Acme", accounts: 1000, added: "2026-10-05" }] });
  });

  it("leaves out what a missing file cannot back", () => {
    const bare = buildHome(records(), emptyStats(), NOW, null, SITE).cluster;
    expect(bare).toMatchObject({ kev: null, cves: null, breaches: null });
    expect(bare.open.total).toBe(3);
  });
});
