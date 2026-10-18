import Link from "next/link";
import { CategoryStackChart } from "@/components/charts/CategoryStackChart";
import { Legend } from "@/components/charts/Legend";
import { MonthlyTrendChart } from "@/components/charts/MonthlyTrendChart";
import { SeverityChart } from "@/components/charts/SeverityChart";
import { TargetBarChart } from "@/components/charts/TargetBarChart";
import { TypeAreaChart } from "@/components/charts/TypeAreaChart";
import { categoryLegend, typeLegend } from "@/components/charts/legends";
import { LatestList } from "@/components/incidents/LatestList";
import { RadarGlyph } from "@/components/layout/Wordmark";
import { RadarPanel } from "@/components/panels/RadarPanel";
import { DualView } from "@/components/ui/DualView";
import { Delta } from "@/components/ui/StatTile";
import { formatInt, monthLabel, timestampLabel } from "@/lib/format";
import { NAV, SITE } from "@/lib/site";
import { getDashboardData } from "../data";
import { OptionNote, OptionSwitcher } from "../OptionSwitcher";
import { RADAR_SAMPLE } from "../sample";

export const metadata = { title: "Console · design option", robots: { index: false } };

function Panel({ title, children, className = "", aside }: { title: string; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <section className={`border border-line bg-panel/50 p-2.5 flex flex-col gap-2 min-w-0 ${className}`}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="label text-soft">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Mini({ label, value, delta, note }: { label: string; value: number | string; delta?: number | null; note?: string }) {
  return (
    <div className="border border-line bg-panel/50 p-2.5 min-w-0">
      <div className="label truncate">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="num text-[22px] leading-none">{typeof value === "number" ? formatInt(value) : value}</span>
        <Delta pct={delta} />
      </div>
      {note && <div className="num mt-1 text-[10.5px] text-faint truncate">{note}</div>}
    </div>
  );
}

export default async function Console() {
  const d = await getDashboardData();
  const h = d.headline;
  const hr = d.headlineReal;
  return (
    <>
      <div className="sticky top-0 z-30 h-9 border-b border-line bg-ground/95 backdrop-blur flex items-center gap-5 px-3 font-mono text-[10.5px] uppercase tracking-[0.1em] overflow-x-auto whitespace-nowrap">
        <Link href="/" className="flex items-center gap-1.5 text-ink">
          <RadarGlyph size={14} className="text-accent" />
          <span className="font-display tracking-[0.08em] text-[13px] normal-case">{SITE.wordmark}</span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-4">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-dim hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-dim">
          <span>
            upd <span className="text-soft">{timestampLabel(d.now)}</span>
          </span>
          <span>
            inc <span className="text-soft">{formatInt(h.total)}</span>
          </span>
          <span>
            real <span className="text-accent">{formatInt(h.realWorld)}</span>
          </span>
          {d.isStub && <span className="text-accent">stub data</span>}
        </div>
      </div>
      <OptionNote current="console" />

      <main className="p-2 grid grid-cols-12 gap-2 text-[11.5px]">
        <div className="col-span-12 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <Mini label="total incidents" value={h.total} note={`${monthLabel(d.window.from)} → ${monthLabel(d.window.to)}`} />
          <Mini label="real-world · sev 3–4" value={h.realWorld} delta={hr.trailingDeltaPct} note="trailing 12 vs prior 12" />
          <Mini label={`${monthLabel(h.thisMonthKey)} so far`} value={h.thisMonth} delta={h.monthDeltaPct} note={`${h.lastMonth} in ${monthLabel(h.lastMonthKey)}`} />
          <Mini label="trailing 12 months" value={h.trailing12} delta={h.trailingDeltaPct} note={`${h.prior12} prior 12`} />
          <Mini label="year to date" value={h.yearToDate} delta={h.yoyPct} note={`${h.lastYearSamePeriod} same period last year`} />
          <Mini label="trend" value={`${d.slopePerMonth >= 0 ? "+" : ""}${d.slopePerMonth.toFixed(2)}/mo`} note="linear fit, incidents per month" />
        </div>

        <Panel title="incidents per month" className="col-span-12 xl:col-span-8">
          <DualView
            size="sm"
            labels={["all", "real-world"]}
            all={<MonthlyTrendChart data={d.trend} provisionalFrom={h.provisionalFrom} height={210} />}
            real={<MonthlyTrendChart data={d.trendReal} provisionalFrom={h.provisionalFrom} height={210} />}
          />
        </Panel>
        <Panel title="severity" className="col-span-12 md:col-span-6 xl:col-span-4">
          <SeverityChart data={d.severities} variant="bars" height={180} />
        </Panel>

        <Panel title="by category" className="col-span-12 md:col-span-6 xl:col-span-6">
          <CategoryStackChart data={d.trend} height={170} />
          <Legend items={categoryLegend()} compact />
        </Panel>
        <Panel title="on AI vs by AI" className="col-span-12 md:col-span-6 xl:col-span-6" aside={<Legend items={typeLegend} compact />}>
          <TypeAreaChart data={d.trend} height={170} variant="bars" />
        </Panel>

        <Panel title="targets" className="col-span-12 md:col-span-4">
          <TargetBarChart data={d.targets} limit={12} />
        </Panel>
        <Panel
          title="latest"
          className="col-span-12 md:col-span-8"
          aside={
            <Link href="/incidents" className="label hover:text-ink">
              all →
            </Link>
          }
        >
          <LatestList incidents={d.latest} variant="dense" limit={12} />
        </Panel>

        <div className="col-span-12 border border-line bg-panel/50 px-2.5 py-2">
          <RadarPanel radar={RADAR_SAMPLE} sample variant="strip" />
        </div>
      </main>

      <footer className="px-3 py-3 border-t border-line font-mono text-[10.5px] text-dim flex flex-wrap gap-x-5 gap-y-1">
        <span>made by GCD</span>
        <a className="hover:text-ink" href={SITE.github}>code on GitHub</a>
        <span>data CC BY-SA 4.0 · code MIT</span>
        <span>powered by GDELT · search by Algolia · thank you to arXiv</span>
        <Link href="/methodology" className="hover:text-ink">methodology</Link>
      </footer>
      <OptionSwitcher current="console" />
    </>
  );
}
