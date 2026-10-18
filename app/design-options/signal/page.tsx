import Link from "next/link";
import { CategoryStackChart } from "@/components/charts/CategoryStackChart";
import { Legend } from "@/components/charts/Legend";
import { MonthlyTrendChart } from "@/components/charts/MonthlyTrendChart";
import { SeverityChart } from "@/components/charts/SeverityChart";
import { TargetBarChart } from "@/components/charts/TargetBarChart";
import { TypeAreaChart } from "@/components/charts/TypeAreaChart";
import { categoryLegend, typeLegend } from "@/components/charts/legends";
import { LatestList } from "@/components/incidents/LatestList";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { RadarGlyph } from "@/components/layout/Wordmark";
import { RadarPanel } from "@/components/panels/RadarPanel";
import { StatTile } from "@/components/ui/StatTile";
import { formatInt, formatPct, monthLabel } from "@/lib/format";
import { NAV, SITE } from "@/lib/site";
import { getDashboardData } from "../data";
import { OptionNote, OptionSwitcher } from "../OptionSwitcher";
import { RADAR_SAMPLE } from "../sample";

export const metadata = { title: "Signal · design option", robots: { index: false } };

function Section({ id, kicker, lede, children }: { id: string; kicker: string; lede: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t border-line-soft py-14 grid gap-8 lg:grid-cols-[14rem_1fr]">
      <div>
        <h2 className="label">{kicker}</h2>
        <p className="mt-3 text-[14px] text-soft leading-relaxed">{lede}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default async function Signal() {
  const d = await getDashboardData();
  const h = d.headline;
  const hr = d.headlineReal;
  return (
    <div className="lg:grid lg:grid-cols-[10rem_1fr] flex-1">
      <aside className="border-b border-line lg:border-b-0 lg:border-r lg:sticky lg:top-0 lg:h-dvh px-5 py-6 flex lg:flex-col items-center lg:items-start gap-6">
        <Link href="/" className="flex items-center gap-2" aria-label={`${SITE.name} home`}>
          <RadarGlyph size={22} className="text-accent" />
          <span className="font-display text-[15px] tracking-[0.08em] lg:hidden">{SITE.wordmark}</span>
        </Link>
        <nav aria-label="Primary" className="flex lg:flex-col gap-x-4 gap-y-3 flex-wrap">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="label hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden lg:block mt-auto font-display text-[13px] tracking-[0.08em] text-dim [writing-mode:vertical-rl] rotate-180">
          {SITE.wordmark}
        </div>
      </aside>

      <div className="min-w-0">
        <OptionNote current="signal" />
        <main className="mx-auto w-full max-w-5xl px-6">
          <section className="pt-20 pb-12">
            <p className="label">real-world AI security incidents · severity 3–4 · since {monthLabel(d.window.from, true)}</p>
            <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-6">
              <div className="num text-7xl sm:text-8xl leading-none tracking-tight text-accent">{formatInt(hr.total)}</div>
              <p className="max-w-xl text-lg text-soft leading-relaxed pb-2">
                {formatInt(hr.trailing12)} in the last twelve months, {formatPct(hr.trailingDeltaPct)} on the twelve before. Including
                research and disclosed vulnerabilities, the record holds {formatInt(h.total)} incidents.
              </p>
            </div>
            <div className="mt-10">
              <MonthlyTrendChart data={d.trendReal} provisionalFrom={hr.provisionalFrom} height={120} compact showFit={false} />
              <div className="mt-2 flex justify-between num text-[10.5px] text-faint">
                <span>{monthLabel(d.window.from)}</span>
                <span>real-world incidents per month · 3-month average in amber</span>
                <span>{monthLabel(d.window.to)}</span>
              </div>
            </div>
            <div className="mt-10 grid grid-cols-3 gap-6 max-w-2xl">
              <StatTile bare size="sm" label={`${monthLabel(hr.thisMonthKey)} so far`} value={hr.thisMonth} deltaPct={hr.monthDeltaPct} compare={`${hr.lastMonth} last month`} />
              <StatTile bare size="sm" label="trailing 12 months" value={hr.trailing12} deltaPct={hr.trailingDeltaPct} compare={`${hr.prior12} prior 12`} />
              <StatTile bare size="sm" label="year to date" value={hr.yearToDate} deltaPct={hr.yoyPct} compare={`${hr.lastYearSamePeriod} last year`} />
            </div>
          </section>

          <Section id="over-time" kicker="Over time" lede="Every incident on record, including research findings and disclosed vulnerabilities, by the month it happened. The last two months are provisional.">
            <MonthlyTrendChart data={d.trend} provisionalFrom={h.provisionalFrom} height={320} />
          </Section>

          <Section id="what-kind" kicker="What kind" lede="Each incident is counted once under its primary category. Infrastructure vulnerabilities dominate volume; prompt injection and agent hijacking dominate the real-world set.">
            <CategoryStackChart data={d.trend} height={280} />
            <div className="mt-4">
              <Legend items={categoryLegend()} />
            </div>
          </Section>

          <Section id="on-ai-by-ai" kicker="On AI, by AI" lede="Attacks on AI systems against attacks that used AI as a meaningful part of the operation.">
            <TypeAreaChart data={d.trend} height={240} />
            <div className="mt-4">
              <Legend items={typeLegend} />
            </div>
          </Section>

          <Section id="who" kicker="Who is hit" lede="Targets are normalised to a short controlled list; an incident can name more than one.">
            <TargetBarChart data={d.targets} limit={10} />
          </Section>

          <Section id="how-bad" kicker="How bad" lede="One severity per incident, from research demonstration to confirmed real-world loss.">
            <SeverityChart data={d.severities} variant="strip" />
          </Section>

          <Section id="latest" kicker="Latest" lede="The most recently reported incidents. Each links to its sources.">
            <LatestList incidents={d.latest} variant="cards" limit={6} />
            <p className="mt-6">
              <Link href="/incidents" className="link text-[13px]">
                All incidents →
              </Link>
            </p>
          </Section>

          <Section id="traffic" kicker="AI traffic" lede="Context from Cloudflare Radar on how much of the web's traffic is bots and AI crawlers. Not part of the incident count.">
            <RadarPanel radar={RADAR_SAMPLE} sample variant="bare" className="max-w-md" />
          </Section>
        </main>
        <SiteFooter />
      </div>
      <OptionSwitcher current="signal" />
    </div>
  );
}
