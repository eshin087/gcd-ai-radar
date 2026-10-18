"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AsciiField } from "@/components/fx/AsciiField";
import { AsciiForm } from "@/components/fx/AsciiForm";
import { CountUp } from "@/components/fx/CountUp";
import { Ago } from "@/components/fx/NextSweep";
import { Reveal } from "@/components/fx/Reveal";
import { neuralSweep } from "@/components/fx/scenes/neuralSweep";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Wordmark } from "@/components/layout/Wordmark";
import { BarRows } from "@/components/charts/BarRows";
import { FamilyMultiples } from "@/components/charts/FamilyMultiples";
import { MonthlyColumns, type ColumnColors } from "@/components/charts/MonthlyColumns";
import { SeverityMeters } from "@/components/charts/SeverityMeters";
import { RadarPanel } from "@/components/panels/RadarPanel";
import { CategoryBadge, SeverityBadge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { StatTile } from "@/components/ui/StatTile";
import type { DashboardData } from "@/lib/dashboard";
import { formatPct, monthLabel } from "@/lib/format";
import { NAV, WINDOW_CHOICES } from "@/lib/site";
import { pctChange } from "@/lib/stats";
import { INCIDENT_TYPES, TARGET_META, TYPE_META, type IncidentType, type Target } from "@/lib/taxonomy";
import { THEME as T } from "@/lib/theme";
import { ReportDrawer } from "./ReportDrawer";
import { useDashboardModel, type WindowKey } from "./useDashboardModel";

/** Neural-sweep tones: structure, beam-lit, hot (signals, crossed nodes), faint (rings, dust). Decorative, not data. */
const SWEEP_PALETTE = ["#4d6ca3", "#ffb35c", "#fff1db", "#56607a"];
const NC: ColumnColors = { grid: T.grid, axis: T.axis, ink: T.ink, dim: T.dim, accent: T.accent, provisional: T.provisional };

/** A number that opens its incidents. */
function Num({ children, onClick, className = "", label }: { children: ReactNode; onClick: () => void; className?: string; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={`num underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent hover:decoration-[color:var(--color-accent)] ${className}`}>
      {children}
    </button>
  );
}

function Section({ id, n, kicker, title, lede, children }: { id?: string; n: string; kicker: string; title: string; lede?: string; children: ReactNode }) {
  return (
    <Reveal>
      <section id={id} className="scroll-mt-20 space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-2">
          <div className="min-w-0 space-y-1.5">
            <div className="divider">
              <span className="text-accent">{n}</span> {kicker}
            </div>
            <AsciiForm as="h2" text={title} onView className="text-2xl font-semibold tracking-tight sm:text-[28px]" />
          </div>
          {lede && <p className="max-w-xl text-[14px] leading-relaxed text-soft">{lede}</p>}
        </header>
        {children}
      </section>
    </Reveal>
  );
}

/** Scroll progress over the hero: drives its fade (CSS --p) and pauses its animation once covered. */
function useHeroFade(ref: RefObject<HTMLDivElement | null>) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let last = false;
    const update = () => {
      raf = 0;
      const p = Math.min(1, Math.max(0, window.scrollY / Math.max(1, el.offsetHeight * 0.8)));
      el.style.setProperty("--p", p.toFixed(3));
      const g = p >= 0.999;
      if (g !== last) {
        last = g;
        setGone(g);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [ref]);
  return gone;
}

/**
 * The dashboard: a neural-sweep ASCII hero that fades as the content slides
 * over it, then the trend, families, targets/types/severity, radar context and
 * the latest log. Every count and bar opens its incidents in a side drawer.
 */
export function Dashboard({ data }: { data: DashboardData }) {
  const m = useDashboardModel(data);
  const heroRef = useRef<HTMLDivElement>(null);
  const heroGone = useHeroFade(heroRef);
  const delta = m.priorCount === null ? undefined : pctChange(m.rows.length, m.priorCount);
  const sourcesInView = m.rows.reduce((s, r) => s + r.source_count, 0);
  const sel = m.selection;
  const typeSeries = (t: IncidentType) => m.series.map((p) => p.byType[t]);

  return (
    <div className="min-h-dvh">
      {/* hero: sticky, fades and recedes as the content slides over it */}
      <div ref={heroRef} className="hero-fade sticky top-0 z-0">
        <header className="relative z-20">
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
        <div className="relative mx-auto max-w-7xl px-4">
          <div aria-hidden className="hero-field relative h-64 lg:absolute lg:inset-y-0 lg:left-4 lg:right-4 lg:h-auto">
            <AsciiField scene={() => neuralSweep({ origin: [0.7, 0.5] })} palette={SWEEP_PALETTE} fontSize={12} running={!heroGone} label="A radar beam sweeping a network of neural nodes" className="h-full w-full" />
          </div>
          <div className="relative z-10 flex items-center pb-20 pt-2 lg:min-h-[min(540px,calc(100svh-4rem))]">
            <div className="max-w-xl space-y-5">
              <p className="label bracket">
                observatory · live · <Ago iso={data.lastUpdated} />
              </p>
              <AsciiForm as="h1" text="Every AI security incident, counted once." duration={760} className="text-4xl font-semibold leading-[1.06] tracking-tight sm:text-5xl lg:text-[54px]" />
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
                <button type="button" onClick={() => m.setSelection({ kind: "window" })} className="group" aria-label={`${m.rows.length} incidents in the ${m.windowLabel}, open the list`}>
                  <CountUp value={m.rows.length} className="text-6xl font-semibold leading-none tracking-tight text-accent underline decoration-transparent decoration-dotted underline-offset-8 group-hover:decoration-current sm:text-7xl" />
                </button>
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
                <Num onClick={() => m.setSelection({ kind: "real" })} label={`${m.realInWindow} real-world incidents`} className="text-ink">
                  {m.realInWindow.toLocaleString("en-US")}
                </Num>{" "}
                with confirmed exploitation or real-world loss. Attacks on AI systems and attacks powered by AI, deduplicated across{" "}
                <Num onClick={() => m.setSelection({ kind: "window" })} label="all incidents in view" className="text-ink">
                  {sourcesInView.toLocaleString("en-US")}
                </Num>{" "}
                sources and linked to the original reporting.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/incidents" className="glass px-4 py-2 text-[13px] text-ink hover:border-accent">
                  Explore incidents →
                </Link>
                <Link href="/methodology" className="px-4 py-2 text-[13px] text-soft hover:text-ink">
                  How we count
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* content slides up over the hero */}
      <div className="hero-cover relative z-10 -mt-14 bg-ground">
        <div className="z-30 border-y border-line-soft sm:sticky sm:top-0 bg-[color-mix(in_oklab,var(--color-ground)_78%,transparent)] backdrop-blur-md">
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
            <span className="label hidden text-faint md:inline">every number and bar opens its incidents</span>
          </div>
        </div>

        <main className="stars mx-auto max-w-7xl space-y-16 px-4 py-12">
          <Section
            id="trend"
            n="01"
            kicker="The trend"
            title={m.basis === "real" ? "Real-world incidents, month by month" : "Incidents, month by month"}
            lede={`By ${m.fieldLabel}, ${monthLabel(m.from, true)} to ${monthLabel(m.to, true)}. Amber: three-month average. Dashed: linear trend (${m.slope >= 0 ? "+" : ""}${m.slope.toFixed(2)} a month). The bracketed months are provisional.`}
          >
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_352px]">
              <div className="glass min-w-0 p-4 sm:p-5">
                <MonthlyColumns
                  months={m.trend.map((p) => p.month)}
                  stacks={[{ key: "total", label: "Incidents", color: T.bar, values: m.trend.map((p) => p.total) }]}
                  line={m.trend.map((p) => p.ma)}
                  fit={m.trend.map((p) => p.fit)}
                  provisionalFrom={m.h.provisionalFrom}
                  height={372}
                  colors={NC}
                  gradientTop={T.accent}
                  glow
                  activeMonth={sel?.kind === "month" ? sel.month : null}
                  onMonth={(month) => m.setSelection({ kind: "month", month })}
                  label="Incidents per month"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatTile
                  className="glass p-4"
                  label={`${monthLabel(m.h.thisMonthKey)} so far`}
                  value={m.h.thisMonth}
                  delta={m.h.monthDeltaPct}
                  onValue={() => m.setSelection(m.picks.thisMonth)}
                  compareValue={m.h.lastMonth}
                  compareText={`in ${monthLabel(m.h.lastMonthKey)}`}
                  onCompare={() => m.setSelection(m.picks.lastMonth)}
                />
                <StatTile
                  className="glass p-4"
                  label="Trailing 12 months"
                  value={m.h.trailing12}
                  delta={m.h.trailingDeltaPct}
                  onValue={() => m.setSelection(m.picks.trailing12)}
                  compareValue={m.h.prior12}
                  compareText="the 12 before"
                  onCompare={() => m.setSelection(m.picks.prior12)}
                />
                <StatTile
                  className="glass p-4"
                  label="Year to date"
                  value={m.h.yearToDate}
                  delta={m.h.yoyPct}
                  onValue={() => m.setSelection(m.picks.ytd)}
                  compareValue={m.h.lastYearSamePeriod}
                  compareText="same point last year"
                  onCompare={() => m.setSelection(m.picks.lastYtd)}
                />
                <StatTile className="glass p-4" label="Real-world in view" value={m.realInWindow} accent onValue={() => m.setSelection({ kind: "real" })} compare="severity 3–4" />
              </div>
            </div>
          </Section>

          <Section
            n="02"
            kicker="What kind"
            title="Seven families of incident"
            lede="Each panel has its own scale, labelled on the right, so small families stay readable. Compare sizes by the totals. A total opens the family, a column opens that month."
          >
            <FamilyMultiples
              data={m.fam}
              theme={T}
              windowTotal={m.rows.length}
              onFamily={(family) => m.setSelection({ kind: "family", family })}
              onMonth={(month, family) => m.setSelection({ kind: "month-family", month, family })}
            />
          </Section>

          <Section n="03" kicker="Who and how bad" title="Targets, types and severity" lede="Attacks on AI systems against attacks that used AI, who was hit, and how far each incident went, from a research demonstration to confirmed real-world loss.">
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="glass min-w-0 space-y-3 p-5">
                <h3 className="text-[15px] font-medium">On AI vs by AI</h3>
                <MonthlyColumns
                  months={m.series.map((p) => p.month)}
                  stacks={INCIDENT_TYPES.map((t) => ({ key: t, label: TYPE_META[t].label, color: T.types[t], values: typeSeries(t) }))}
                  provisionalFrom={m.h.provisionalFrom}
                  height={210}
                  colors={NC}
                  peak={false}
                  activeMonth={sel?.kind === "month" ? sel.month : null}
                  onMonth={(month) => m.setSelection({ kind: "month", month })}
                  onSegment={(month, key) => m.setSelection({ kind: "month-type", month, type: key as IncidentType })}
                  label="Attacks on AI and AI-enabled attacks per month"
                />
                <BarRows
                  rows={m.types.map((t) => ({ key: t.key, label: TYPE_META[t.key].label, value: t.count, color: T.types[t.key], note: `${Math.round((t.count / Math.max(1, m.rows.length)) * 100)}%` }))}
                  labelWidth="8.5rem"
                  onPick={(k) => m.setSelection({ kind: "type", type: k as IncidentType })}
                  active={sel?.kind === "type" ? sel.type : null}
                />
              </div>
              <div className="glass space-y-3 p-5">
                <h3 className="text-[15px] font-medium">Who is hit</h3>
                <BarRows
                  rows={m.targets
                    .filter((t) => t.count > 0)
                    .slice(0, 10)
                    .map((t) => ({ key: t.key, label: TARGET_META[t.key].label, value: t.count, color: T.bar }))}
                  labelWidth="9.5rem"
                  onPick={(k) => m.setSelection({ kind: "target", target: k as Target })}
                  active={sel?.kind === "target" ? sel.target : null}
                />
                <p className="text-[12px] text-dim">An incident can name several targets.</p>
              </div>
              <div className="glass space-y-3 p-5">
                <h3 className="text-[15px] font-medium">How bad</h3>
                <SeverityMeters data={m.severities} theme={T} onPick={(severity) => m.setSelection({ kind: "severity", severity })} active={sel?.kind === "severity" ? sel.severity : null} />
              </div>
            </div>
          </Section>

          {data.radar && (
            <Reveal>
              <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                <div className="max-w-xl space-y-2">
                  <div className="divider">
                    <span className="text-accent">04</span> Context
                  </div>
                  <AsciiForm as="h2" text="The bots on the wire" onView className="text-2xl font-semibold tracking-tight sm:text-[28px]" />
                  <p className="text-[14px] leading-relaxed text-soft">
                    Not incidents: a weekly reading of how much web traffic is automated and which AI crawlers send it, from Cloudflare Radar. Background for the counts above, never added to them.
                  </p>
                </div>
                <RadarPanel radar={data.radar} className="glass" />
              </section>
            </Reveal>
          )}

          <Section n="05" kicker="Latest" title="Just reported" lede="The six newest incidents. Each one opens with every source, its classification and related incidents.">
            <ol className="glass divide-y divide-line-soft">
              {m.latestRows.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Link href={`/incidents/${r.slug}`} className="group grid items-center gap-x-4 gap-y-1.5 px-4 py-2.5 transition-colors hover:bg-panel-2 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]">
                    <span className="num text-[12px] text-dim">{r.first_reported}</span>
                    <span className="truncate text-[14px] text-ink group-hover:text-accent">{r.title}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <SeverityBadge severity={r.severity} />
                      {r.categories[0] && <CategoryBadge category={r.categories[0]} />}
                      <span className="num text-[11px] text-faint">{r.source_count} src</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
            <Link href="/incidents" className="label inline-block hover:text-ink">
              all incidents →
            </Link>
          </Section>
        </main>
        <div aria-hidden className="overflow-hidden whitespace-nowrap font-mono text-[12px] leading-none text-faint">
          {"_.-·´¯`·.¸¸.·´¯`·.¸_.-·´¯`·.¸¸.·´¯`·.¸".repeat(12)}
        </div>
        <SiteFooter />
      </div>

      <ReportDrawer selection={m.selection} rows={m.selected} windowLabel={m.windowLabel} basis={m.basis} field={m.field} onClose={() => m.setSelection(null)} />
    </div>
  );
}
