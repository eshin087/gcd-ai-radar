import Link from "next/link";
import { CategoryStackChart } from "@/components/charts/CategoryStackChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Legend } from "@/components/charts/Legend";
import { MonthlyTrendChart } from "@/components/charts/MonthlyTrendChart";
import { SeverityChart } from "@/components/charts/SeverityChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { TargetBarChart } from "@/components/charts/TargetBarChart";
import { TypeAreaChart } from "@/components/charts/TypeAreaChart";
import { categoryLegend, typeLegend } from "@/components/charts/legends";
import { LatestList } from "@/components/incidents/LatestList";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Wordmark } from "@/components/layout/Wordmark";
import { StatTile } from "@/components/ui/StatTile";
import { formatPct, monthLabel, timestampLabel } from "@/lib/format";
import { TYPE_COLORS } from "@/lib/palette";
import { NAV } from "@/lib/site";
import { getDashboardData } from "../data";
import { OptionNote, OptionSwitcher } from "../OptionSwitcher";
import { RADAR_SAMPLE } from "../sample";

export const metadata = { title: "Ledger · design option", robots: { index: false } };

export default async function Ledger() {
  const d = await getDashboardData();
  const h = d.headline;
  const hr = d.headlineReal;
  const r = RADAR_SAMPLE;
  return (
    <div className="lg:grid lg:grid-cols-[13rem_1fr] flex-1">
      <aside className="border-b border-line lg:border-b-0 lg:border-r lg:sticky lg:top-0 lg:h-dvh flex flex-col gap-6 px-5 py-5">
        <Wordmark />
        <nav aria-label="Primary" className="flex flex-wrap gap-x-4 gap-y-2 lg:flex-col">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="label hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden lg:flex mt-auto flex-col gap-4 text-[11px] text-dim">
          <div>
            <div className="label">updated</div>
            <div className="num mt-1 text-soft">{timestampLabel(d.now)}</div>
          </div>
          <div>
            <div className="label">AI traffic · sample</div>
            <div className="num mt-1 text-soft">
              bots {r.bot_share.value.toFixed(1)}% <span className="text-faint">of requests</span>
            </div>
            <div className="num text-soft">
              AI crawlers ≈ {r.derived_ai_share_of_requests?.toFixed(1)}% <span className="text-faint">derived</span>
            </div>
            <div className="text-faint mt-1">Cloudflare Radar · 7d</div>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <OptionNote current="ledger" />
        <main className="px-5 py-6 space-y-8 max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-12">
            <section className="lg:col-span-5 space-y-7">
              <StatTile bare label="AI security incidents tracked" value={h.total} size="xl">
                <Sparkline values={d.spark} width={240} height={40} />
                <div className="text-[11px] text-dim">last 12 months · {monthLabel(d.window.from)} onwards on record</div>
              </StatTile>
              <StatTile
                bare
                label="real-world incidents · severity 3–4"
                value={hr.total}
                size="lg"
                accent
                deltaPct={hr.trailingDeltaPct}
                compare={`${hr.trailing12} in the trailing 12 months vs ${hr.prior12} before`}
              >
                <Sparkline values={d.sparkReal} width={240} height={30} />
              </StatTile>
              <div className="grid grid-cols-3 gap-4 border-t border-line pt-6">
                <StatTile bare size="sm" label={`${monthLabel(h.thisMonthKey)} vs ${monthLabel(h.lastMonthKey)}`} value={h.thisMonth} deltaPct={h.monthDeltaPct} compare={`${h.lastMonth} last month`} />
                <StatTile bare size="sm" label="trailing 12 months" value={h.trailing12} deltaPct={h.trailingDeltaPct} compare={`${h.prior12} prior 12`} />
                <StatTile bare size="sm" label="year to date" value={h.yearToDate} deltaPct={h.yoyPct} compare={`${h.lastYearSamePeriod} same period last year`} />
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-6 text-[12px]">
                <div>
                  <dt className="label">trend</dt>
                  <dd className="num mt-1 text-soft">
                    {d.slopePerMonth >= 0 ? "+" : ""}
                    {d.slopePerMonth.toFixed(2)} incidents / month
                  </dd>
                </div>
                <div>
                  <dt className="label">by type</dt>
                  <dd className="num mt-1 text-soft">
                    {d.types.map((t) => (
                      <span key={t.key} className="mr-3" style={{ color: TYPE_COLORS[t.key] }}>
                        {t.count} {t.key === "attack_on_ai" ? "on AI" : "by AI"}
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="label">sources cited</dt>
                  <dd className="num mt-1 text-soft">{d.incidents.reduce((s, i) => s + i.source_count, 0).toLocaleString("en-US")}</dd>
                </div>
                <div>
                  <dt className="label">real-world share</dt>
                  <dd className="num mt-1 text-soft">{formatPct((h.realWorld / Math.max(1, h.total)) * 100).replace("+", "")} of all incidents</dd>
                </div>
              </dl>
              <p className="text-[12px] text-dim leading-relaxed">
                Counts are per incident, not per article. Research and disclosed vulnerabilities (severity 1–2) are tracked
                separately from confirmed exploitation and real-world loss (3–4). The last two months are provisional because
                reporting lags events.
              </p>
            </section>

            <section className="lg:col-span-7 space-y-4">
              <ChartFrame title="Incidents per month" subtitle="by incident date · amber: 3-month average · dashed: trend">
                <MonthlyTrendChart data={d.trend} provisionalFrom={h.provisionalFrom} height={240} />
              </ChartFrame>
              <ChartFrame title="By category" footer={<Legend items={categoryLegend()} compact />}>
                <CategoryStackChart data={d.trend} height={200} />
              </ChartFrame>
              <div className="grid gap-4 sm:grid-cols-2">
                <ChartFrame title="Targets">
                  <TargetBarChart data={d.targets} limit={8} />
                </ChartFrame>
                <ChartFrame title="Severity">
                  <SeverityChart data={d.severities} variant="strip" />
                </ChartFrame>
              </div>
            </section>
          </div>

          <ChartFrame
            title="Ledger · latest incidents"
            subtitle="most recently reported · click a row for sources and detail"
            aside={
              <Link href="/incidents" className="label hover:text-ink">
                full ledger →
              </Link>
            }
          >
            <LatestList incidents={d.latest} variant="table" limit={12} />
          </ChartFrame>

          <ChartFrame title="Attacks on AI vs AI-enabled attacks" subtitle="monthly" footer={<Legend items={typeLegend} />}>
            <TypeAreaChart data={d.trend} variant="bars" height={200} />
          </ChartFrame>
        </main>
        <SiteFooter />
      </div>
      <OptionSwitcher current="ledger" />
    </div>
  );
}
