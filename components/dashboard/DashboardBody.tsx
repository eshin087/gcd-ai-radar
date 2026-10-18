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
import { LatestList } from "@/components/incidents/LatestList";
import { RadarPanel } from "@/components/panels/RadarPanel";
import { Segmented } from "@/components/ui/Segmented";
import { StatTile } from "@/components/ui/StatTile";
import type { Basis, DashboardData } from "@/lib/dashboard";
import { formatInt, monthLabel } from "@/lib/format";
import { addTrend, trendSlope, type DateField } from "@/lib/stats";

type Window = "default" | "full";

export function DashboardBody({ data }: { data: DashboardData }) {
  const [basis, setBasis] = useState<Basis>("all");
  const [field, setField] = useState<DateField>("incident_date");
  const [win, setWin] = useState<Window>("default");

  const b = data.basis[basis];
  const h = b.headline[field];
  const window = data.windows[win];
  const series = useMemo(() => b.series[field].filter((p) => p.month >= window.from), [b, field, window.from]);
  const trend = useMemo(() => addTrend(series), [series]);
  const slope = useMemo(() => trendSlope(series), [series]);
  const fullIsDefault = data.windows.full.from === data.windows.default.from;

  return (
    <div className="space-y-6">
      {data.isStub && (
        <div className="border border-accent/40 bg-accent-tint px-4 py-2 text-[12px] text-accent font-mono">
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
        {!fullIsDefault && (
          <Segmented
            label="Window"
            value={win}
            onChange={setWin}
            options={[
              { key: "default", label: `${data.windows.default.from.slice(0, 4)}+` },
              { key: "full", label: "Full range" },
            ]}
          />
        )}
      </div>

      <ChartFrame
        title={basis === "real" ? "Real-world AI security incidents per month" : "AI security incidents per month"}
        subtitle={`${monthLabel(window.from, true)} to ${monthLabel(window.to, true)} · by ${field === "incident_date" ? "incident date" : "first report"} · bars: incidents · amber: 3-month average · dashed: linear trend · shaded: provisional (reporting lag)`}
        footer={
          <span className="num">
            linear trend {slope >= 0 ? "+" : ""}
            {slope.toFixed(2)} incidents per month over this window · {formatInt(b.total)} incidents in this set
            {field === "incident_date" ? " · year-only dates are excluded from the monthly series" : ""}
          </span>
        }
      >
        <MonthlyTrendChart data={trend} provisionalFrom={h.provisionalFrom} height={340} />
      </ChartFrame>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile label={basis === "real" ? "real-world incidents" : "incidents tracked"} value={b.total} accent={basis === "real"} />
        {basis === "all" ? (
          <StatTile label="real-world · severity 3–4" value={data.basis.real.total} accent />
        ) : (
          <StatTile label="all incidents incl. research & CVEs" value={data.basis.all.total} />
        )}
        <StatTile label={`${monthLabel(h.thisMonthKey)} so far vs ${monthLabel(h.lastMonthKey)}`} value={h.thisMonth} deltaPct={h.monthDeltaPct} compare={`${h.lastMonth} last month`} />
        <StatTile label="trailing 12 months" value={h.trailing12} deltaPct={h.trailingDeltaPct} compare={`${h.prior12} in the prior 12`} />
        <StatTile label="year to date" value={h.yearToDate} deltaPct={h.yoyPct} compare={`${h.lastYearSamePeriod} same period last year`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame title="By category" subtitle="primary category per incident, monthly" footer={<Legend items={categoryLegend()} compact />}>
          <CategoryStackChart data={series} height={240} />
        </ChartFrame>
        <ChartFrame title="Attacks on AI vs AI-enabled attacks" subtitle="monthly, stacked" footer={<Legend items={typeLegend} />}>
          <TypeAreaChart data={series} height={240} />
        </ChartFrame>
        <ChartFrame title="By target" subtitle="an incident can hit several targets">
          <TargetBarChart data={b.targets} limit={10} />
        </ChartFrame>
        <ChartFrame title="Severity" subtitle="1 research · 2 disclosed · 3 exploited · 4 real-world loss">
          <SeverityChart data={b.severities} variant="bars" height={200} />
        </ChartFrame>
      </div>

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
          <LatestList incidents={b.latest} variant="rows" limit={8} />
        </ChartFrame>
        {data.radar ? (
          <RadarPanel radar={data.radar} />
        ) : (
          <section className="panel p-4 space-y-3 text-[12px] text-dim">
            <h2 className="text-[13px] font-medium text-ink">About these numbers</h2>
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
