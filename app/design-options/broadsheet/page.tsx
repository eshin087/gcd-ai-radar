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
import { Wordmark } from "@/components/layout/Wordmark";
import { RadarPanel } from "@/components/panels/RadarPanel";
import { formatInt, formatPct, monthLabel } from "@/lib/format";
import { NAV, SITE } from "@/lib/site";
import { getDashboardData } from "../data";
import { OptionNote, OptionSwitcher } from "../OptionSwitcher";
import { RADAR_SAMPLE } from "../sample";

export const metadata = { title: "Broadsheet · design option", robots: { index: false } };

function direction(pct: number | null): string {
  if (pct === null) return "appearing for the first time";
  if (pct > 5) return "rising";
  if (pct < -5) return "falling";
  return "flat";
}

function Figure({ n, caption, children }: { n: number; caption: string; children: React.ReactNode }) {
  return (
    <figure className="border-y border-line py-4 my-6">
      {children}
      <figcaption className="mt-3 text-[12px] text-dim">
        <span className="label text-soft mr-2">Figure {n}</span>
        {caption}
      </figcaption>
    </figure>
  );
}

export default async function Broadsheet() {
  const d = await getDashboardData();
  const h = d.headline;
  const hr = d.headlineReal;
  const dateline = new Date(d.now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <header className="mx-auto w-full max-w-6xl px-4 pt-8">
        <div className="flex items-center justify-between text-[11px] text-dim">
          <span className="num">{dateline}</span>
          <span className="num">{formatInt(h.total)} incidents on record · updated {d.now.slice(0, 10)}</span>
        </div>
        <div className="mt-6 flex flex-col items-center gap-3 border-y border-line py-5">
          <Wordmark className="scale-150 origin-center py-2" />
          <p className="text-[13px] text-dim">{SITE.tagline}</p>
        </div>
        <nav aria-label="Primary" className="flex flex-wrap justify-center gap-x-7 gap-y-2 border-b border-line py-3">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="label hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <OptionNote current="broadsheet" />

      <main className="mx-auto w-full max-w-6xl px-4 py-10 text-[15px]">
        <section className="max-w-4xl">
          <p className="label">The trend</p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
            AI security incidents are {direction(h.trailingDeltaPct)}: {formatInt(h.trailing12)} in the last twelve months,{" "}
            {formatPct(h.trailingDeltaPct)} on the twelve before.
          </h1>
          <p className="mt-5 text-lg text-soft leading-relaxed max-w-3xl">
            {formatInt(hr.trailing12)} of them involved confirmed exploitation or real-world loss. {formatInt(h.thisMonth)} have been
            reported so far in {monthLabel(h.thisMonthKey, true)}, against {formatInt(h.lastMonth)} in {monthLabel(h.lastMonthKey, true)}.
            Each count is one incident, however many outlets covered it.
          </p>
        </section>

        <div className="mt-10 grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <Figure n={1} caption={`Incidents per month by incident date, ${monthLabel(d.window.from, true)} to ${monthLabel(d.window.to, true)}. Amber line: three-month average. Dashed: linear trend. The shaded months are provisional because reporting lags events.`}>
              <MonthlyTrendChart data={d.trend} provisionalFrom={h.provisionalFrom} height={300} />
            </Figure>

            <h2 className="label mt-10 mb-2">Latest incidents</h2>
            <LatestList incidents={d.latest} variant="editorial" limit={6} />
            <p className="mt-4">
              <Link href="/incidents" className="link text-[13px]">
                Browse all {formatInt(h.total)} incidents →
              </Link>
            </p>

            <Figure n={2} caption="Incidents per month by primary category. Infrastructure vulnerabilities (CVEs in AI frameworks and tooling) are counted as incidents at severity 2 and dominate volume; the real-world view excludes them.">
              <CategoryStackChart data={d.trend} height={260} />
              <div className="mt-3">
                <Legend items={categoryLegend()} compact />
              </div>
            </Figure>
          </div>

          <aside className="lg:col-span-4 space-y-8 text-[13px]">
            <section>
              <h2 className="label mb-3">By the numbers</h2>
              <dl className="divide-y divide-line-soft">
                {[
                  ["Incidents on record", formatInt(h.total)],
                  ["Real-world (severity 3–4)", formatInt(h.realWorld)],
                  [`${monthLabel(h.thisMonthKey)} so far`, `${formatInt(h.thisMonth)} (${formatPct(h.monthDeltaPct)})`],
                  ["Trailing 12 months", `${formatInt(h.trailing12)} (${formatPct(h.trailingDeltaPct)})`],
                  ["Year to date", `${formatInt(h.yearToDate)} (${formatPct(h.yoyPct)})`],
                  ["Trend", `${d.slopePerMonth >= 0 ? "+" : ""}${d.slopePerMonth.toFixed(2)} per month`],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 py-2">
                    <dt className="text-dim">{k}</dt>
                    <dd className="num text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h2 className="label mb-3">Severity</h2>
              <SeverityChart data={d.severities} variant="strip" />
            </section>
            <section>
              <h2 className="label mb-3">Targets</h2>
              <TargetBarChart data={d.targets} limit={8} />
            </section>
            <section>
              <h2 className="label mb-3">Attacks on AI vs AI-enabled attacks</h2>
              <TypeAreaChart data={d.trend} height={160} compact />
              <div className="mt-2">
                <Legend items={typeLegend} compact />
              </div>
            </section>
            <RadarPanel radar={RADAR_SAMPLE} sample variant="bare" className="border-t border-line pt-6" />
          </aside>
        </div>
      </main>
      <SiteFooter />
      <OptionSwitcher current="broadsheet" />
    </>
  );
}
