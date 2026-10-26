import path from "node:path";
import { describe, expect, it } from "vitest";
import { BASES, DATE_FIELDS, WINDOW_KEYS, buildAggregates, deriveView, shardsFor, type Aggregates, type WindowKey } from "@/lib/aggregates";
import { aiLens } from "@/lib/counting";
import { FAMILIES, familyOf, type Family } from "@/lib/families";
import { withLifecycle } from "@/lib/lifecycle";
import { compactRow, inBasis, type Basis, type CompactRow } from "@/lib/rows";
import { headlinePicks, selectRows, selectionMonths, type Selection } from "@/lib/selection";
import { shardYear } from "@/lib/shard-year";
import { readIncidents } from "@/lib/shards";
import {
  countBy,
  dateOf,
  headline,
  inWindow,
  isRealWorld,
  latest,
  monthlySeries,
  primaryCategory,
  severityDistribution,
  shiftMonth,
  targetDistribution,
  toMonthKey,
  typeDistribution,
  yearRange,
  type DateField,
} from "@/lib/stats";
import { INCIDENT_TYPES, OWASP_LLM_IDS, SEVERITIES, TARGETS, atlasFor, owaspFor } from "@/lib/taxonomy";
import { AGENTIC_SLICES, agenticSlices, isAgentTooling, stackProducts } from "@/lib/watch";

/**
 * The dashboard's contract: every number it shows is the length of the list
 * its drawer opens. The numbers come from build-time aggregates
 * (lib/aggregates.ts deriveView), the drawer from rows filtered by
 * lib/selection.ts, so this test clicks every kind of number for every
 * window, date basis and incident set and compares the two, on the live
 * dataset plus fixtures that cover the awkward dates (year-only and
 * month-only incident dates, disclosed records with year-only dates).
 */

const NOW = new Date("2026-10-18T12:00:00Z");

function row(partial: Partial<CompactRow> & { id: string; incident_date: string; first_reported: string }): CompactRow {
  return {
    slug: partial.id.toLowerCase(),
    title: `Fixture ${partial.id}`,
    incident_date_precision: partial.incident_date.length === 10 ? "day" : partial.incident_date.length === 7 ? "month" : "year",
    type: "attack_on_ai",
    categories: ["prompt_injection"],
    severity: 2,
    targets: ["OpenAI"],
    source_count: 1,
    disclosed: false,
    product: "",
    products: [],
    ...partial,
  };
}

const FIXTURES: CompactRow[] = [
  // year-only incident dates sit in July for the window, in no monthly column
  row({ id: "AIR-2026-9001", incident_date: "2025", first_reported: "2026-03-01", severity: 3, categories: ["agent_hijack"], targets: ["Anthropic", "OpenAI"] }),
  row({ id: "AIR-2026-9002", incident_date: "2024", first_reported: "2026-05-02", severity: 4, type: "ai_enabled_attack", categories: ["deepfake_fraud"], targets: ["individual_victims"] }),
  row({ id: "AIR-2025-9003", incident_date: "2025", first_reported: "2025-11-20", severity: 2, categories: ["infra_vuln"], targets: ["framework_or_tooling"], disclosed: true, product: "Fixture Product" }),
  // month-only dates are in their month
  row({ id: "AIR-2026-9004", incident_date: "2026-02", first_reported: "2026-02-14", severity: 3, categories: ["data_leak", "prompt_injection"], targets: ["Google", "enterprise_deployment"] }),
  // a disclosed record on the same day as another, for the busiest-day tile
  row({ id: "AIR-2026-9005", incident_date: "2026-09-09", first_reported: "2026-09-09", disclosed: true, product: "Fixture Product" }),
  row({ id: "AIR-2026-9006", incident_date: "2026-09-09", first_reported: "2026-09-09", disclosed: true, product: "Other Fixture" }),
  // an incident reported this month, older than the window
  row({ id: "AIR-2026-9007", incident_date: "2019-06-05", first_reported: "2026-10-03", severity: 3, categories: ["supply_chain"], targets: ["open_weight_model"] }),
  // first reported before the incident date (90 live records do this)
  row({ id: "AIR-2024-9008", incident_date: "2025-01-10", first_reported: "2024-12-20", severity: 2, categories: ["jailbreak"], targets: ["Microsoft"] }),
  // an agent hijacked through a poisoned MCP server, on a product family; and the same family named by an AI-enabled attack (not a stack hit)
  row({ id: "AIR-2026-9010", incident_date: "2026-04-11", first_reported: "2026-04-12", severity: 3, categories: ["agent_hijack", "supply_chain", "data_leak"], targets: ["framework_or_tooling"], products: ["MCP servers & tools", "Cursor"] }),
  row({ id: "AIR-2026-9011", incident_date: "2026-06", first_reported: "2026-06-30", severity: 4, type: "ai_enabled_attack", categories: ["ai_assisted_intrusion", "agent_hijack"], targets: ["enterprise_deployment"], products: ["Cursor"] }),
  // a disclosed vulnerability in agent tooling
  row({ id: "AIR-2026-9012", incident_date: "2026-08-02", first_reported: "2026-08-02", disclosed: true, product: "MCP SDKs", categories: ["infra_vuln"], targets: ["framework_or_tooling"] }),
];

async function liveRows(): Promise<CompactRow[]> {
  const { incidents } = await readIncidents(path.join(process.cwd(), "data"));
  // the dashboard counts AI records only, so the parity check runs on the same lens (lib/dashboard.ts, scripts/prebuild.ts rows)
  return aiLens(incidents.filter((i) => i.status === "published")).map((i) => compactRow(withLifecycle(i, NOW.toISOString().slice(0, 10))));
}

function spanOf(rows: CompactRow[]) {
  const range = yearRange(rows);
  return { from: `${Math.max(range?.min ?? NOW.getUTCFullYear(), 2016)}-01`, to: toMonthKey(NOW) };
}

/** What the drawer lists for a selection, and the shards the browser would fetch for it. */
function drawer(rows: CompactRow[], agg: Aggregates, sel: Selection, basis: Basis, field: DateField, from: string, to: string) {
  const listed = selectRows(rows, sel, basis, field, from, to);
  const months = selectionMonths(sel, from, to);
  const fetched = new Set(shardsFor(agg.shards, field, months.from, months.to));
  const unfetched = listed.filter((r) => !fetched.has(shardYear(r)));
  return { count: listed.length, unfetched };
}

function familyTotals(series: ReturnType<typeof deriveView>["series"]): Record<Family, number>[] {
  return series.map((p) => {
    const v = Object.fromEntries(FAMILIES.map((f) => [f, 0])) as Record<Family, number>;
    for (const [c, n] of Object.entries(p.byCategory)) v[familyOf(c as keyof typeof p.byCategory)] += n;
    return v;
  });
}

function checkEveryNumber(rows: CompactRow[]) {
  const span = spanOf(rows);
  const agg = buildAggregates(rows, { now: NOW, span });
  let checks = 0;
  const problems: string[] = [];
  const expect1 = (label: string, shown: number, sel: Selection, basis: Basis, field: DateField, from: string, to: string) => {
    const d = drawer(rows, agg, sel, basis, field, from, to);
    checks += 1;
    if (d.count !== shown) problems.push(`${label} [${basis}/${field} ${from}..${to}]: shows ${shown}, drawer lists ${d.count}`);
    if (d.unfetched.length) problems.push(`${label} [${basis}/${field}]: ${d.unfetched.length} listed rows live in shards the browser would not fetch (${d.unfetched.map((r) => r.id).join(", ")})`);
  };

  for (const field of DATE_FIELDS) {
    for (const basis of BASES) {
      for (const win of WINDOW_KEYS) {
        const v = deriveView(agg, { basis, field, win, span });
        const { from, to } = v;
        const fam = familyTotals(v.series);

        expect1("hero total", v.count, { kind: "window" }, basis, field, from, to);
        expect1("real-world in view", v.realInWindow, { kind: "real" }, basis, field, from, to);
        expect1("disclosed in view", v.disclosedCount, { kind: "disclosed" }, basis, field, from, to);
        for (const f of v.families) expect1(`family ${f.key}`, f.count, { kind: "family", family: f.key }, basis, field, from, to);
        for (const t of v.types) expect1(`type ${t.key}`, t.count, { kind: "type", type: t.key }, basis, field, from, to);
        for (const t of v.targets) expect1(`target ${t.key}`, t.count, { kind: "target", target: t.key }, basis, field, from, to);
        for (const s of v.severities) expect1(`severity ${s.key}`, s.count, { kind: "severity", severity: Number(s.key) as 1 | 2 | 3 | 4 }, basis, field, from, to);
        for (const p of v.disclosedProducts) expect1(`product ${p.key}`, p.count, { kind: "disclosed-product", product: p.key }, basis, field, from, to);
        for (const f of FAMILIES) {
          for (const s of SEVERITIES) expect1(`heatmap ${f} ${s}`, v.famSev[f][s], { kind: "family-severity", family: f, severity: s }, basis, field, from, to);
          for (const t of INCIDENT_TYPES) expect1(`flow ${t} ${f}`, v.typeFam[t][f], { kind: "type-family", type: t, family: f }, basis, field, from, to);
          for (const tg of TARGETS) expect1(`bubble ${f} ${tg}`, v.famTarget[f][tg] ?? 0, { kind: "family-target", family: f, target: tg }, basis, field, from, to);
          if (v.prior && v.priorFamilies) expect1(`prior ${f}`, v.priorFamilies[f], { kind: "family-range", family: f, from: v.prior.from, to: v.prior.to, label: "prior" }, basis, field, from, to);
        }
        for (const [day, count] of Object.entries(v.dayCounts)) expect1(`day ${day}`, count, { kind: "day", day }, basis, field, from, to);
        if (v.disclosedBusiest) expect1("busiest day", v.disclosedBusiest.count, { kind: "disclosed-day", day: v.disclosedBusiest.day }, basis, field, from, to);
        // the standards, stack and agent panels
        for (const o of v.owasp) expect1(`owasp ${o.key}`, o.count, { kind: "owasp", id: o.key }, basis, field, from, to);
        expect1("owasp any", v.owaspAny, { kind: "owasp", id: "any" }, basis, field, from, to);
        for (const a of v.atlas) expect1(`atlas ${a.key}`, a.count, { kind: "atlas", id: a.key }, basis, field, from, to);
        for (const p of v.stack) {
          expect1(`stack ${p.key}`, p.count, { kind: "product", product: p.key }, basis, field, from, to);
          expect1(`stack cves ${p.key}`, p.cves, { kind: "disclosed-product", product: p.key }, basis, field, from, to);
        }
        for (const k of AGENTIC_SLICES) expect1(`agentic ${k}`, v.agentic[k], { kind: "agentic", slice: k }, basis, field, from, to);
        expect1("agent tooling cves", v.disclosedAgent, { kind: "disclosed-agentic" }, basis, field, from, to);
        v.series.forEach((p, i) => {
          expect1(`column ${p.month}`, p.total, { kind: "month", month: p.month }, basis, field, from, to);
          for (const t of INCIDENT_TYPES) expect1(`column ${p.month} ${t}`, p.byType[t], { kind: "month-type", month: p.month, type: t }, basis, field, from, to);
          for (const f of FAMILIES) expect1(`column ${p.month} ${f}`, fam[i]![f], { kind: "month-family", month: p.month, family: f }, basis, field, from, to);
          expect1(`disclosed column ${p.month}`, v.disclosedSeries[i]!.total, { kind: "disclosed-month", month: p.month }, basis, field, from, to);
        });
        const picks = headlinePicks(v.h, NOW);
        expect1("this month", v.h.thisMonth, picks.thisMonth, basis, field, from, to);
        expect1("last month", v.h.lastMonth, picks.lastMonth, basis, field, from, to);
        expect1("trailing 12", v.h.trailing12, picks.trailing12, basis, field, from, to);
        expect1("prior 12", v.h.prior12, picks.prior12, basis, field, from, to);
        expect1("year to date", v.h.yearToDate, picks.ytd, basis, field, from, to);
        expect1("last year same period", v.h.lastYearSamePeriod, picks.lastYtd, basis, field, from, to);
      }
    }
  }
  return { checks, problems, agg };
}

/** deriveView against the lib/stats functions the dashboard used to run on rows in the browser. */
function checkAgainstStats(rows: CompactRow[]) {
  const span = spanOf(rows);
  const agg = buildAggregates(rows, { now: NOW, span });
  for (const field of DATE_FIELDS) {
    for (const basis of BASES) {
      const basisRows = rows.filter((r) => inBasis(r, basis));
      const disclosedBase = rows.filter((r) => r.disclosed);
      for (const win of WINDOW_KEYS) {
        const v = deriveView(agg, { basis, field, win, span });
        const { from, to } = v;
        const inView = inWindow(basisRows, from, to, field);
        expect(v.count).toBe(inView.length);
        expect(v.series).toEqual(monthlySeries(inView, { from, to, dateField: field }));
        expect(v.targets).toEqual(targetDistribution(inView));
        expect(v.severities).toEqual(severityDistribution(inView));
        expect(v.types).toEqual(typeDistribution(inView));
        expect(v.families).toEqual(countBy(inView, (r) => familyOf(primaryCategory(r)), FAMILIES));
        expect(v.h).toEqual(headline(basisRows, { now: NOW, dateField: field }));
        expect(v.latestRows).toEqual(latest(basisRows, 12));
        expect(v.realInWindow).toBe(inView.filter(isRealWorld).length);
        expect(v.allInWindow).toBe(inWindow(rows, from, to, field).length);
        expect(v.sourcesInWindow).toBe(inView.reduce((s, r) => s + r.source_count, 0));
        const disclosedRows = inWindow(disclosedBase, from, to, field);
        expect(v.disclosedCount).toBe(disclosedRows.length);
        expect(v.disclosedSeries).toEqual(monthlySeries(disclosedRows, { from, to, dateField: field }).map((p) => ({ month: p.month, total: p.total })));
        const products = new Map<string, number>();
        for (const r of disclosedRows) if (r.product) products.set(r.product, (products.get(r.product) ?? 0) + 1);
        expect(v.disclosedProducts).toEqual([...products.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, count]) => ({ key, count })));
        const days = new Map<string, number>();
        for (const r of disclosedRows) {
          const d = dateOf(r, field);
          if (d.length === 10) days.set(d, (days.get(d) ?? 0) + 1);
        }
        let best: { day: string; count: number } | null = null;
        for (const [day, count] of days) if (!best || count > best.count) best = { day, count };
        expect(v.disclosedBusiest).toEqual(best);
        if (win !== "all") {
          const n = Number(win.replace("m", ""));
          const before = inWindow(basisRows, shiftMonth(from, -n), shiftMonth(from, -1), field);
          expect(v.priorCount).toBe(before.length);
          expect(v.priorFamilies).toEqual(Object.fromEntries(countBy(before, (r) => familyOf(primaryCategory(r)), FAMILIES).map((c) => [c.key, c.count])));
        } else {
          expect(v.priorCount).toBeNull();
          expect(v.priorFamilies).toBeNull();
        }
        // the standards, stack and agent tallies against the row-level rules
        const count = (rs: CompactRow[], f: (r: CompactRow) => readonly string[]) => {
          const m = new Map<string, number>();
          for (const r of rs) for (const k of new Set(f(r))) m.set(k, (m.get(k) ?? 0) + 1);
          return m;
        };
        const owasp = count(inView, owaspFor);
        expect(v.owasp).toEqual(OWASP_LLM_IDS.map((id) => ({ key: id, count: owasp.get(id) ?? 0 })));
        expect(v.owaspAny).toBe(inView.filter((r) => owaspFor(r).length > 0).length);
        const atlas = count(inView, atlasFor);
        for (const a of v.atlas) expect(a.count).toBe(atlas.get(a.key) ?? 0);
        const stack = count(inView, stackProducts);
        expect(v.stack.map((p) => [p.key, p.count])).toEqual([...stack.entries()].sort((a, b) => b[1] - a[1] || (products.get(b[0]) ?? 0) - (products.get(a[0]) ?? 0) || a[0].localeCompare(b[0])));
        for (const p of v.stack) expect(p.cves).toBe(products.get(p.key) ?? 0);
        const agentic = count(inView, agenticSlices);
        for (const k of AGENTIC_SLICES) expect(v.agentic[k]).toBe(agentic.get(k) ?? 0);
        expect(v.disclosedAgent).toBe(disclosedRows.filter((r) => isAgentTooling(r.product)).length);
        // joint counts add up to the marginals they were cut from
        for (const f of FAMILIES) expect(SEVERITIES.reduce((s, sv) => s + v.famSev[f][sv], 0)).toBe(v.families.find((x) => x.key === f)!.count);
        for (const t of INCIDENT_TYPES) expect(FAMILIES.reduce((s, f) => s + v.typeFam[t][f], 0)).toBe(v.types.find((x) => x.key === t)!.count);
        for (const tg of TARGETS) expect(FAMILIES.reduce((s, f) => s + (v.famTarget[f][tg] ?? 0), 0)).toBe(v.targets.find((x) => x.key === tg)!.count);
        expect(Object.values(v.dayCounts).reduce((s, n) => s + n, 0)).toBe(inView.filter((r) => dateOf(r, field).length === 10).length);
        // notable: in the window, in the basis, best first
        for (const r of v.notable) expect(inView.some((x) => x.id === r.id)).toBe(true);
        for (let i = 1; i < v.notable.length; i++) expect(v.notable[i - 1]!.severity).toBeGreaterThanOrEqual(v.notable[i]!.severity);
      }
    }
  }
}

// The live-dataset checks load and complete every record; with stored timelines that takes about 5 s on a CI runner.
describe("aggregates: every number opens exactly its rows", { timeout: 30_000 }, () => {
  it("holds on the fixtures with year-only, month-only and disclosed dates", () => {
    const { checks, problems } = checkEveryNumber(FIXTURES);
    expect(problems).toEqual([]);
    expect(checks).toBeGreaterThan(1000);
  });

  it("holds on the live dataset for every window, date basis and incident set", async () => {
    const rows = await liveRows();
    const { checks, problems, agg } = checkEveryNumber(rows);
    expect(problems).toEqual([]);
    expect(checks).toBeGreaterThan(10000);
    expect(agg.totals.records).toBe(rows.length);
    expect(agg.totals.incidents + agg.totals.disclosed).toBe(rows.length);
  });

  it("holds on the live dataset with the fixtures mixed in", async () => {
    const { problems } = checkEveryNumber([...(await liveRows()), ...FIXTURES]);
    expect(problems).toEqual([]);
  });
});

describe("aggregates reproduce the row-based statistics", { timeout: 30_000 }, () => {
  it("on the fixtures", () => {
    checkAgainstStats(FIXTURES);
  });
  it("on the live dataset", async () => {
    checkAgainstStats(await liveRows());
  });
});

describe("aggregate shape", () => {
  it("is sparse, keeps year-only dates apart, and shards by first report", () => {
    const span = spanOf(FIXTURES);
    const agg = buildAggregates(FIXTURES, { now: NOW, span });
    // AIR-2026-9001 has incident_date "2025": in July 2025 for the window, in no column
    const july = agg.months.incident_date["2025-07"]!;
    expect(july.yearOnly?.all?.n).toBe(1);
    expect(july.yearOnly?.real?.n).toBe(1);
    expect(july.yearOnly?.disclosed?.n).toBe(1); // AIR-2025-9003
    expect(july.all).toBeUndefined();
    // zero entries are not written
    expect(Object.keys(agg.months.first_reported["2026-03"]!.all!.category)).toEqual(["agent_hijack"]);
    expect(agg.months.first_reported["2020-01"]).toBeUndefined();
    // shards: year of first report, with the month range of their rows on each basis
    expect(agg.shards.map((s) => s.year)).toEqual([2024, 2025, 2026]);
    const s2026 = agg.shards.find((s) => s.year === 2026)!;
    expect(s2026.records).toBe(9);
    expect(s2026.min.incident_date).toBe("2019-06"); // AIR-2026-9007
    expect(s2026.max.first_reported).toBe("2026-10");
    expect(shardsFor(agg.shards, "incident_date", "2019-01", "2019-12")).toEqual([2026]);
    expect(shardsFor(agg.shards, "first_reported", "2019-01", "2019-12")).toEqual([]);
    // the product table is shared
    expect(agg.products.sort()).toEqual(["Fixture Product", "MCP SDKs", "Other Fixture"]);
    expect(agg.busiest.incident_date["12m" as WindowKey]).toEqual({ day: "2026-09-09", count: 2 });
    for (const s of SEVERITIES) expect(typeof s).toBe("number");
    expect(TARGETS.length).toBeGreaterThan(0);
  });
});
