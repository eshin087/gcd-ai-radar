import Link from "next/link";
import { CategoryStackChart } from "@/components/charts/CategoryStackChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Legend } from "@/components/charts/Legend";
import { MonthlyTrendChart } from "@/components/charts/MonthlyTrendChart";
import { SeverityChart } from "@/components/charts/SeverityChart";
import { TargetBarChart } from "@/components/charts/TargetBarChart";
import { TypeAreaChart } from "@/components/charts/TypeAreaChart";
import { categoryLegend, typeLegend } from "@/components/charts/legends";
import { LatestList } from "@/components/incidents/LatestList";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { RadarPanel } from "@/components/panels/RadarPanel";
import { DualView } from "@/components/ui/DualView";
import { StatTile } from "@/components/ui/StatTile";
import { monthLabel } from "@/lib/format";
import { getDashboardData } from "../data";
import { OptionNote, OptionSwitcher } from "../OptionSwitcher";
import { RADAR_SAMPLE } from "../sample";

export const metadata = { title: "Observatory · design option", robots: { index: false } };

export default async function Observatory() {
  const d = await getDashboardData();
  const h = d.headline;
  return (
    <>
      <SiteHeader lastUpdated={d.now} />
      <OptionNote current="observatory" />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 space-y-6">
        <ChartFrame
          title="AI security incidents per month"
          subtitle={`${monthLabel(d.window.from, true)} to ${monthLabel(d.window.to, true)} · by incident date · bars: incidents · amber: 3-month average · dashed: linear trend · shaded: provisional (reporting lag)`}
        >
          <DualView
            all={<MonthlyTrendChart data={d.trend} provisionalFrom={h.provisionalFrom} height={340} />}
            real={<MonthlyTrendChart data={d.trendReal} provisionalFrom={h.provisionalFrom} height={340} />}
          />
        </ChartFrame>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatTile label="incidents tracked" value={h.total} />
          <StatTile label="real-world · severity 3–4" value={h.realWorld} accent />
          <StatTile
            label={`${monthLabel(h.thisMonthKey)} so far vs ${monthLabel(h.lastMonthKey)}`}
            value={h.thisMonth}
            deltaPct={h.monthDeltaPct}
            compare={`${h.lastMonth} last month`}
          />
          <StatTile label="trailing 12 months" value={h.trailing12} deltaPct={h.trailingDeltaPct} compare={`${h.prior12} in the prior 12`} />
          <StatTile label="year to date" value={h.yearToDate} deltaPct={h.yoyPct} compare={`${h.lastYearSamePeriod} same period last year`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartFrame title="By category" subtitle="primary category per incident, monthly" footer={<Legend items={categoryLegend()} compact />}>
            <CategoryStackChart data={d.trend} height={240} />
          </ChartFrame>
          <ChartFrame title="Attacks on AI vs AI-enabled attacks" subtitle="monthly, stacked" footer={<Legend items={typeLegend} />}>
            <TypeAreaChart data={d.trend} height={240} />
          </ChartFrame>
          <ChartFrame title="By target" subtitle="an incident can hit several targets">
            <TargetBarChart data={d.targets} limit={10} />
          </ChartFrame>
          <ChartFrame title="Severity" subtitle="1 research · 2 disclosed · 3 exploited · 4 real-world loss">
            <SeverityChart data={d.severities} variant="bars" height={200} />
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
            <LatestList incidents={d.latest} variant="rows" limit={8} />
          </ChartFrame>
          <RadarPanel radar={RADAR_SAMPLE} sample />
        </div>
      </main>
      <SiteFooter />
      <OptionSwitcher current="observatory" />
    </>
  );
}
