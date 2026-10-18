"use client";

import Link from "next/link";
import { TargetBarChart } from "@/components/charts/TargetBarChart";
import { DrillDown } from "@/components/dashboard/DrillDown";
import { CountUp } from "@/components/fx/CountUp";
import { GlyphImage } from "@/components/fx/GlyphImage";
import { Ago } from "@/components/fx/NextSweep";
import { Reveal } from "@/components/fx/Reveal";
import { Scramble } from "@/components/fx/Scramble";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Wordmark } from "@/components/layout/Wordmark";
import { FamilyMultiples } from "@/components/lab/charts/FamilyMultiples";
import { LabTrend } from "@/components/lab/charts/LabTrend";
import { OrdinalSeverity } from "@/components/lab/charts/OrdinalSeverity";
import { TypeSplit } from "@/components/lab/charts/TypeSplit";
import { LabTile } from "@/components/lab/LabTile";
import { useDashboardModel, type WindowKey } from "@/components/lab/useDashboardModel";
import { RadarPanel } from "@/components/panels/RadarPanel";
import { CategoryBadge, SeverityBadge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import type { DashboardData } from "@/lib/dashboard";
import { formatPct, monthLabel } from "@/lib/format";
import { ICE as T } from "@/lib/lab/themes";
import { NAV, WINDOW_CHOICES } from "@/lib/site";
import { pctChange } from "@/lib/stats";
import { TYPE_META } from "@/lib/taxonomy";
import { LabSwitcher } from "../LabSwitcher";

function Section({ n, kicker, title, lede, children }: { n: string; kicker: string; title: string; lede: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <section className="space-y-5">
        <div className="max-w-3xl space-y-2">
          <div className="divider">
            <span className="text-accent">{n}</span> {kicker}
          </div>
          <Scramble as="h2" text={title} onView className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-[15px] leading-relaxed text-soft">{lede}</p>
        </div>
        {children}
      </section>
    </Reveal>
  );
}

export function ObservatoryDraft({ data }: { data: DashboardData }) {
  const m = useDashboardModel(data);
  const totals = m.series.map((p) => p.total);
  const delta = m.priorCount === null ? undefined : pctChange(m.rows.length, m.priorCount);

  return (
    <div className="lab-root lab-observatory">
      {/* hero: live ASCII render of the dish array with radar pings */}
      <section className="relative">
        <header className="relative z-20 lg:absolute lg:inset-x-0 lg:top-0">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4">
            <Wordmark />
            <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="label hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <div className="relative overflow-hidden">
          <GlyphImage src="/art/array.json" tint="#ffd9a3" tint2="#24324f" minCell={6} mode="ping" center={[0.78, 0.74]} threshold={0.07} gain={2.1} label="ASCII rendering of radio telescope dishes on a ridge under a sweeping arc of light" />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[var(--color-ground)] via-[color-mix(in_oklab,var(--color-ground)_55%,transparent)] to-transparent lg:via-transparent" />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--color-ground)] to-transparent" />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl px-4 lg:absolute lg:inset-0 lg:flex lg:items-center">
          <div className="max-w-xl space-y-6 py-8 lg:py-0">
            <p className="label bracket">observatory · live · <Ago iso={data.lastUpdated} /></p>
            <Scramble as="h1" text="Every AI security incident, counted once." className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl" speed={22} />
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <CountUp value={m.rows.length} className="text-6xl font-semibold leading-none tracking-tight text-accent sm:text-7xl" />
              <span className="text-[15px] text-soft">
                incidents in the {m.windowLabel}
                {delta !== undefined && (
                  <>
                    , <span className={`num ${delta === null || delta > 0 ? "text-sev-3" : "text-type-by"}`}>{formatPct(delta)}</span> on the period before
                  </>
                )}
              </span>
            </div>
            <p className="text-[15px] leading-relaxed text-soft">
              {m.realInWindow.toLocaleString("en-US")} with confirmed exploitation or real-world loss. Attacks on AI systems and attacks powered by AI, deduplicated
              across {data.rows.reduce((s, r) => s + r.source_count, 0).toLocaleString("en-US")} sources and linked to the original reporting.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/incidents" className="glass px-4 py-2 text-[13px] text-ink hover:border-accent">
                Explore incidents →
              </Link>
              <Link href="/methodology" className="px-4 py-2 text-[13px] text-soft hover:text-ink">
                How we count
              </Link>
            </div>
            <a href="#trend" className="scroll-cue hidden font-mono text-[12px] text-dim lg:inline-block" aria-label="Scroll to the data">
              ↓ scroll
            </a>
          </div>
        </div>
      </section>

      {/* glass filter bar */}
      <div className="sticky top-0 z-30 border-y border-line-soft bg-[color-mix(in_oklab,var(--color-ground)_70%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <Segmented
            label="Incident set"
            value={m.basis}
            onChange={m.setBasis}
            options={[
              { key: "all", label: "All incidents" },
              { key: "real", label: "Real-world only" },
            ]}
          />
          <Segmented
            label="Date basis"
            value={m.field}
            onChange={m.setField}
            options={[
              { key: "incident_date", label: "Incident date" },
              { key: "first_reported", label: "First reported" },
            ]}
          />
          <Segmented
            label="Window"
            value={m.win}
            onChange={m.setWin}
            options={[...WINDOW_CHOICES.map((w) => ({ key: `${w}m` as WindowKey, label: `${w}m` })), { key: "all" as WindowKey, label: "All" }]}
          />
          <span className="label text-faint">click any mark for its incidents</span>
        </div>
      </div>

      <main className="stars mx-auto max-w-7xl space-y-20 px-4 py-14">
        <div id="trend" className="scroll-mt-24">
          <Section
            n="01"
            kicker="The trend"
            title={m.basis === "real" ? "Real-world incidents, month by month" : "Incidents, month by month"}
            lede={`By ${m.fieldLabel}, ${monthLabel(m.from, true)} to ${monthLabel(m.to, true)}. The amber line is a three-month average; the dashed line the linear trend (${m.slope >= 0 ? "+" : ""}${m.slope.toFixed(2)} a month). The last two months are provisional.`}
          >
            <div className="glass p-5">
              <LabTrend data={m.trend} theme={T} glow provisionalFrom={m.h.provisionalFrom} height={420} activeMonth={m.selection?.kind === "month" ? m.selection.month : null} onBarClick={(month) => m.setSelection({ kind: "month", month })} />
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <LabTile className="glass p-5" label={`${monthLabel(m.h.thisMonthKey)} so far vs ${monthLabel(m.h.lastMonthKey)}`} value={m.h.thisMonth} delta={m.h.monthDeltaPct} compare={`${m.h.lastMonth} last month`} />
              <LabTile className="glass p-5" label="Trailing 12 months" value={m.h.trailing12} delta={m.h.trailingDeltaPct} compare={`${m.h.prior12} before`} spark={totals.slice(-12)} />
              <LabTile className="glass p-5" label="Year to date" value={m.h.yearToDate} delta={m.h.yoyPct} compare={`${m.h.lastYearSamePeriod} last year`} />
              <LabTile className="glass p-5" label={`Real-world, ${m.windowLabel}`} value={m.realInWindow} compare="severity 3–4" accent />
            </div>
          </Section>
        </div>

        <Section
          n="02"
          kicker="What kind"
          title="Seven families, one scale"
          lede="Each panel is one family of categories on the same vertical scale, so the shapes compare honestly. Click a panel for its incidents, or a column for that month."
        >
          <FamilyMultiples data={m.fam} theme={T} onFamily={(family) => m.setSelection({ kind: "family", family })} onMonth={(month, family) => m.setSelection({ kind: "month-family", month, family })} />
        </Section>

        <Section n="03" kicker="Who and how bad" title="Targets, types and severity" lede="Attacks on AI systems against attacks that used AI, who was hit, and how far each incident went: from a research demonstration to confirmed real-world loss.">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="glass p-5 space-y-3">
              <h3 className="text-[15px] font-medium">On AI vs by AI</h3>
              <TypeSplit data={m.series} theme={T} height={260} onBarClick={(month, type) => m.setSelection({ kind: "month-type", month, type })} />
              <ul className="space-y-1">
                {m.types.map((t) => (
                  <li key={t.key} className="flex items-center justify-between text-[12.5px] text-soft">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block size-2.5 rounded-[2px]" style={{ background: T.types[t.key] }} />
                      {TYPE_META[t.key].label}
                    </span>
                    <span className="num text-ink">{t.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="glass p-5 space-y-3">
              <h3 className="text-[15px] font-medium">Who is hit</h3>
              <TargetBarChart data={m.targets} limit={9} color={T.bar} onBarClick={(target) => m.setSelection({ kind: "target", target })} />
            </div>
            <div className="glass p-5 space-y-3">
              <h3 className="text-[15px] font-medium">How bad</h3>
              <OrdinalSeverity data={m.severities} theme={T} onPick={(severity) => m.setSelection({ kind: "severity", severity })} active={m.selection?.kind === "severity" ? m.selection.severity : null} />
            </div>
          </div>
        </Section>

        {m.selection && (
          <DrillDown key={JSON.stringify(m.selection)} selection={m.selection} rows={m.selected} windowLabel={m.windowLabel} basis={m.basis} field={m.field} onClose={() => m.setSelection(null)} />
        )}

        <Section n="04" kicker="Latest" title="Most recently reported" lede="Each card is one incident; open it for every source, the full classification and related incidents.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {m.latestRows.slice(0, 9).map((r) => (
              <Link key={r.id} href={`/incidents/${r.slug}`} className="glass group flex flex-col gap-3 p-5 transition-colors hover:border-accent">
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[12px] text-dim">{r.first_reported}</span>
                  <SeverityBadge severity={r.severity} />
                </div>
                <Scramble as="p" text={r.title} onView speed={10} className="text-[15px] leading-snug text-ink group-hover:text-accent" />
                <div className="mt-auto flex flex-wrap gap-1.5">
                  {r.categories.slice(0, 2).map((c) => (
                    <CategoryBadge key={c} category={c} />
                  ))}
                  <span className="num self-center text-[11px] text-faint">{r.source_count} src</span>
                </div>
              </Link>
            ))}
          </div>
        </Section>

        {data.radar && (
          <Reveal>
            <div className="max-w-xl">
              <RadarPanel radar={data.radar} className="glass" />
            </div>
          </Reveal>
        )}
      </main>
      <div aria-hidden className="overflow-hidden whitespace-nowrap font-mono text-[12px] leading-none text-faint">
        {"_.-·´¯`·.¸¸.·´¯`·.¸_.-·´¯`·.¸¸.·´¯`·.¸".repeat(12)}
      </div>
      <SiteFooter />
      <LabSwitcher current="observatory" />
    </div>
  );
}
