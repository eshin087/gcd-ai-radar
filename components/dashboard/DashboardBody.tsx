"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CategoryStackChart } from "@/components/charts/CategoryStackChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Legend } from "@/components/charts/Legend";
import { categoryLegend, typeLegend } from "@/components/charts/legends";
import { MonthlyTrendChart } from "@/components/charts/MonthlyTrendChart";
import { SeverityChart } from "@/components/charts/SeverityChart";
import { TargetBarChart } from "@/components/charts/TargetBarChart";
import { TypeAreaChart } from "@/components/charts/TypeAreaChart";
import { CompactList } from "@/components/incidents/CompactList";
import { RadarPanel } from "@/components/panels/RadarPanel";
import { Segmented } from "@/components/ui/Segmented";
import { StatTile } from "@/components/ui/StatTile";
import type { Basis, CompactRow, DashboardData } from "@/lib/dashboard";
import { formatInt, monthLabel } from "@/lib/format";
import { DEFAULT_WINDOW_MONTHS, WINDOW_CHOICES } from "@/lib/site";
import type { Category } from "@/lib/taxonomy";
import {
  addTrend,
  categoryDistribution,
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
  trendSlope,
  windowKey,
  type DateField,
} from "@/lib/stats";
import { DrillDown, type Selection } from "./DrillDown";

type WindowKey = `${(typeof WINDOW_CHOICES)[number]}m` | "all";

export function DashboardBody({ data }: { data: DashboardData }) {
  const [basis, setBasis] = useState<Basis>("all");
  const [field, setField] = useState<DateField>("incident_date");
  const [win, setWin] = useState<WindowKey>(`${DEFAULT_WINDOW_MONTHS}m`);
  const [selection, setSelection] = useState<Selection | null>(null);

  const now = useMemo(() => new Date(data.now), [data.now]);
  const to = data.span.to;
  const from = win === "all" ? data.span.from : shiftMonth(to, -(Number(win.replace("m", "")) - 1));
  const windowLabel = win === "all" ? `all time (${monthLabel(from)} onward)` : `last ${win.replace("m", "")} months`;

  const basisRows = useMemo(() => (basis === "real" ? data.rows.filter(isRealWorld) : data.rows), [data.rows, basis]);
  const rows = useMemo(() => inWindow(basisRows, from, to, field), [basisRows, from, to, field]);
  const series = useMemo(() => monthlySeries(rows, { from, to, dateField: field }), [rows, from, to, field]);
  const trend = useMemo(() => addTrend(series), [series]);
  const slope = useMemo(() => trendSlope(series), [series]);
  const h = useMemo(() => headline(basisRows, { now, dateField: field }), [basisRows, now, field]);
  const targets = useMemo(() => targetDistribution(rows), [rows]);
  const severities = useMemo(() => severityDistribution(rows), [rows]);
  const categories = useMemo(() => categoryDistribution(rows), [rows]);
  const categoryCounts = useMemo(() => Object.fromEntries(categories.map((c) => [c.key, c.count])), [categories]);
  const latestRows = useMemo(() => latest(basisRows, 8), [basisRows]);
  const realInWindow = useMemo(() => rows.filter(isRealWorld).length, [rows]);

  const selected = useMemo<CompactRow[]>(() => {
    if (!selection) return [];
    const s = selection;
    return rows.filter((r) => {
      const m = windowKey(dateOf(r, field));
      switch (s.kind) {
        case "month":
          return m === s.month;
        case "month-category":
          return m === s.month && primaryCategory(r) === s.category;
        case "month-type":
          return m === s.month && r.type === s.type;
        case "target":
          return r.targets.includes(s.target);
        case "severity":
          return r.severity === s.severity;
        case "category":
          return primaryCategory(r) === s.category;
      }
    });
  }, [selection, rows, field]);

  const fieldLabel = field === "incident_date" ? "incident date" : "first report";

  return (
    <div className="space-y-6">
      {data.isStub && (
        <div className="border border-accent/40 bg-accent-tint px-4 py-2 text-[13px] text-accent font-mono">
          Synthetic stub dataset: the collector has not published real incidents yet. Numbers and titles are illustrative.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Incident set"
          value={basis}
          onChange={setBasis}
          options={[
            { key: "all", label: "All incidents", title: "Research, disclosed vulnerabilities, exploitation and real-world loss" },
            { key: "real", label: "Real-world only", title: "Severity 3 and 4: confirmed exploitation or real-world loss" },
          ]}
        />
        <Segmented
          label="Date basis"
          value={field}
          onChange={setField}
          options={[
            { key: "incident_date", label: "Incident date", title: "When it happened (approximate dates allowed)" },
            { key: "first_reported", label: "First reported", title: "Earliest source date" },
          ]}
        />
        <Segmented
          label="Window"
          value={win}
          onChange={setWin}
          options={[...WINDOW_CHOICES.map((m) => ({ key: `${m}m` as WindowKey, label: `${m}m`, title: `Last ${m} months` })), { key: "all", label: "All", title: "Everything on record" }]}
        />
        <span className="label text-faint">click any bar for the incidents behind it</span>
      </div>

      <ChartFrame
        title={basis === "real" ? "Real-world AI security incidents per month" : "AI security incidents per month"}
        subtitle={`${monthLabel(from, true)} to ${monthLabel(to, true)} · by ${fieldLabel} · bars: incidents · amber: 3-month average · dashed: linear trend · shaded: provisional (reporting lag)`}
        footer={
          <span className="num">
            linear trend {slope >= 0 ? "+" : ""}
            {slope.toFixed(2)} incidents per month over this window · {formatInt(rows.length)} incidents in view
            {field === "incident_date" ? " · year-only dates are excluded from the monthly series" : ""}
          </span>
        }
      >
        <MonthlyTrendChart data={trend} provisionalFrom={h.provisionalFrom} height={420} onBarClick={(month) => setSelection({ kind: "month", month })} />
      </ChartFrame>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile label={`${basis === "real" ? "real-world incidents" : "incidents"} · ${windowLabel}`} value={rows.length} accent={basis === "real"} compare={`${formatInt(basisRows.length)} all time`} />
        {basis === "all" ? (
          <StatTile label={`real-world · severity 3–4 · ${windowLabel}`} value={realInWindow} accent compare={`${formatInt(data.rows.filter(isRealWorld).length)} all time`} />
        ) : (
          <StatTile label={`all incidents incl. research & CVEs · ${windowLabel}`} value={inWindow(data.rows, from, to, field).length} compare={`${formatInt(data.rows.length)} all time`} />
        )}
        <StatTile label={`${monthLabel(h.thisMonthKey)} so far vs ${monthLabel(h.lastMonthKey)}`} value={h.thisMonth} deltaPct={h.monthDeltaPct} compare={`${h.lastMonth} last month`} />
        <StatTile label="trailing 12 months" value={h.trailing12} deltaPct={h.trailingDeltaPct} compare={`${h.prior12} in the prior 12`} />
        <StatTile label="year to date" value={h.yearToDate} deltaPct={h.yoyPct} compare={`${h.lastYearSamePeriod} same period last year`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame title="By category" subtitle={`primary category per incident, monthly · ${windowLabel}`} footer={<Legend items={categoryLegend(undefined, categoryCounts)} compact onClick={(key) => setSelection({ kind: "category", category: key as Category })} />}>
          <CategoryStackChart data={series} height={300} onSegmentClick={(month, category) => setSelection({ kind: "month-category", month, category })} />
        </ChartFrame>
        <ChartFrame title="Attacks on AI vs AI-enabled attacks" subtitle={`monthly · ${windowLabel}`} footer={<Legend items={typeLegend} />}>
          <TypeAreaChart data={series} height={300} variant="bars" onBarClick={(month, type) => setSelection({ kind: "month-type", month, type })} />
        </ChartFrame>
        <ChartFrame title="By target" subtitle={`an incident can hit several targets · ${windowLabel}`}>
          <TargetBarChart data={targets} limit={10} onBarClick={(target) => setSelection({ kind: "target", target })} />
        </ChartFrame>
        <ChartFrame title="Severity" subtitle={`1 research · 2 disclosed · 3 exploited · 4 real-world loss · ${windowLabel}`}>
          <SeverityChart data={severities} variant="bars" height={260} onBarClick={(severity) => setSelection({ kind: "severity", severity })} />
        </ChartFrame>
      </div>

      {selection && (
        <DrillDown key={JSON.stringify(selection)} selection={selection} rows={selected} windowLabel={windowLabel} basis={basis} field={field} onClose={() => setSelection(null)} />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartFrame
          title="Latest incidents"
          subtitle="most recently reported"
          className="lg:col-span-2"
          aside={
            <Link href="/incidents" className="label hover:text-ink">
              all incidents →
            </Link>
          }
        >
          <CompactList rows={latestRows} limit={8} />
        </ChartFrame>
        {data.radar ? (
          <RadarPanel radar={data.radar} />
        ) : (
          <section className="panel p-4 space-y-3 text-[13px] text-dim">
            <h2 className="text-[14px] font-medium text-ink">About these numbers</h2>
            <p>One real-world event is one incident, however many outlets covered it. Every incident links to its sources.</p>
            <p>Research findings and disclosed vulnerabilities (severity 1–2) are tracked separately from confirmed exploitation and real-world loss (3–4).</p>
            <p>The last two months are provisional: reporting lags events.</p>
            <p>
              <Link href="/methodology" className="link">Methodology</Link> · <Link href="/data" className="link">Download the data</Link>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
