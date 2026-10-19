"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AsciiField } from "@/components/fx/AsciiField";
import { AsciiForm } from "@/components/fx/AsciiForm";
import { CountUp } from "@/components/fx/CountUp";
import { Ago, NextSweep } from "@/components/fx/NextSweep";
import { Reveal } from "@/components/fx/Reveal";
import { agentSwarm } from "@/components/fx/scenes/agentSwarm";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Wordmark } from "@/components/layout/Wordmark";
import { BarRows } from "@/components/charts/BarRows";
import { CalendarHeatmap } from "@/components/charts/CalendarHeatmap";
import { CumulativeTimeline } from "@/components/charts/CumulativeTimeline";
import { FamilyRadar } from "@/components/charts/FamilyRadar";
import { FamilySlope } from "@/components/charts/FamilySlope";
import { FamilyStream } from "@/components/charts/FamilyStream";
import { FlowSankey } from "@/components/charts/FlowSankey";
import { MonthlyColumns, type ColumnColors } from "@/components/charts/MonthlyColumns";
import { SeverityHeatmap } from "@/components/charts/SeverityHeatmap";
import { TargetBubbles } from "@/components/charts/TargetBubbles";
import { RadarPanel } from "@/components/panels/RadarPanel";
import { CategoryBadge, SeverityBadge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { StatTile } from "@/components/ui/StatTile";
import type { CompactRow, DashboardData } from "@/lib/dashboard";
import { FAMILIES, type Family } from "@/lib/families";
import { formatPct, monthLabel } from "@/lib/format";
import { NAV, WINDOW_CHOICES } from "@/lib/site";
import { dateOf, monthKey, pctChange, shiftMonth } from "@/lib/stats";
import type { IncidentType, Severity, Target } from "@/lib/taxonomy";
import { THEME as T } from "@/lib/theme";
import { ReportDrawer } from "./ReportDrawer";
import { useDashboardModel, type WindowKey } from "./useDashboardModel";

/** Agent-swarm tones: structure, beam-lit, hot (packets, pinged agents), faint (rings, dust), agents. Decorative, not data. */
const SWARM_PALETTE = ["#4d6ca3", "#ffb35c", "#fff1db", "#56607a", "#7fdcff"];
/** Disclosed vulnerabilities: a neutral slate, apart from the incident blue (single series, contrast 4.9:1 on the surface). */
const DISCLOSED_COLOR = "#6b7fa8";
const NC: ColumnColors = { grid: T.grid, axis: T.axis, ink: T.ink, dim: T.dim, accent: T.accent, provisional: T.provisional };
/** The trend panel's three views of the same months. */
type TrendView = "columns" | "timeline" | "calendar";

/** A readout line in the hero's terminal panel: [ ok ] label ........ value  note. A count opens its incidents. */
function Readout({ tag, label, value, note, onOpen, ariaLabel }: { tag: "ok" | "--"; label: string; value: number | ReactNode; note?: ReactNode; onOpen?: () => void; ariaLabel?: string }) {
  const shown = typeof value === "number" ? <CountUp value={value} /> : value;
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
      <span className={tag === "ok" ? "text-accent" : "text-faint"}>[ {tag} ]</span>
      <span className="text-soft">{label}</span>
      <span aria-hidden className="leader">{".".repeat(96)}</span>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={ariaLabel ?? `${label}: open the list`} className="num text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent hover:decoration-[color:var(--color-accent)]">
          {shown}
        </button>
      ) : (
        <span className="num text-ink">{shown}</span>
      )}
      {note && <span className="hidden text-[12px] text-dim sm:inline">{note}</span>}
    </div>
  );
}

function Section({ id, n, kicker, title, lede, children }: { id?: string; n: string; kicker: string; title: string; lede?: string; children: ReactNode }) {
  return (
    <Reveal>
      <section id={id} className="scroll-mt-20 space-y-4">
        <header className="space-y-2">
          <div className="divider">
            <span className="text-accent">{n}</span> {kicker}
          </div>
          <AsciiForm as="h2" text={title} onView className="text-2xl font-semibold tracking-tight sm:text-[28px]" />
          {lede && <p className="max-w-3xl text-[15px] leading-relaxed text-soft">{lede}</p>}
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
  const [trendView, setTrendView] = useState<TrendView>("columns");
  const delta = m.priorCount === null ? undefined : pctChange(m.count, m.priorCount);
  const sel = m.selection;
  const famTotals = Object.fromEntries(m.families.map((f) => [f.key, f.count])) as Record<Family, number>;
  const famShown = FAMILIES.filter((f) => f !== "other" || famTotals.other > 0 || (m.priorFamilies?.other ?? 0) > 0);
  const priorLabel = m.prior ? `${m.win.replace("m", "")} months before` : "";
  const nowLabel = m.win === "all" ? "all time" : `last ${m.win.replace("m", "")} months`;
  const monthOf = (r: CompactRow) => monthKey(dateOf(r, m.field));
  const today = data.now.slice(0, 10);
  const calendarFrom = shiftMonth(m.to, -11);

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
            <AsciiField scene={() => agentSwarm({ origin: [0.7, 0.5] })} palette={SWARM_PALETTE} fontSize={12} running={!heroGone} label="A radar beam sweeping a swarm of AI agents calling tools and reporting back" className="h-full w-full" />
          </div>
          <div className="relative z-10 flex items-center pb-20 pt-2 lg:min-h-[min(540px,calc(100svh-4rem))]">
            <div className="min-w-0 max-w-xl space-y-5">
              <AsciiForm as="h1" text="Every AI security incident, counted once." duration={2600} className="text-4xl font-semibold leading-[1.06] tracking-tight sm:text-5xl lg:text-[54px]" />
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
                <button type="button" onClick={() => m.setSelection({ kind: "window" })} className="group" aria-label={`${m.count} incidents in the ${m.windowLabel}, open the list`}>
                  <CountUp value={m.count} className="text-6xl font-semibold leading-none tracking-tight text-accent underline decoration-transparent decoration-dotted underline-offset-8 group-hover:decoration-current sm:text-7xl" />
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
              {/* the readout: the hero's numbers as a terminal log, every count opening its incidents */}
              <div className="tty font-mono text-[13px] sm:text-[13.5px]">
                <span className="tty-title">┤ observatory · live ├</span>
                <div className="space-y-1.5">
                  <div className="truncate text-dim">
                    <span className="text-accent">$</span> radar --set {m.basis} --by {m.field === "incident_date" ? "incident-date" : "first-reported"} --window {m.win}
                  </div>
                  <Readout tag="ok" label="real-world" value={m.realInWindow} note="severity 3–4 · confirmed exploitation or loss" onOpen={() => m.setSelection({ kind: "real" })} ariaLabel={`${m.realInWindow} real-world incidents`} />
                  <Readout tag="ok" label="sources" value={m.sourcesInWindow} note="deduplicated · one event, counted once" onOpen={() => m.setSelection({ kind: "window" })} ariaLabel="all incidents in view" />
                  <Readout tag="--" label="disclosed CVEs" value={m.disclosedCount} note="no confirmed exploitation · tracked apart" onOpen={() => m.setSelection({ kind: "disclosed" })} ariaLabel={`${m.disclosedCount} disclosed vulnerabilities`} />
                  <Readout
                    tag="ok"
                    label="last sweep"
                    value={<Ago iso={data.lastUpdated} />}
                    note={
                      <>
                        next in <NextSweep className="text-soft" />
                      </>
                    }
                  />
                </div>
              </div>
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
              <div className="glass min-w-0 space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Segmented
                    label="Trend view"
                    size="sm"
                    value={trendView}
                    onChange={setTrendView}
                    options={[
                      { key: "columns", label: "Per month", title: "Incidents per month with the three-month average and the linear trend" },
                      { key: "timeline", label: "Running total", title: "The running total, with the most notable incidents pinned on the curve" },
                      { key: "calendar", label: "Calendar", title: "The last twelve months day by day" },
                    ]}
                  />
                  <span className="text-[11.5px] text-faint">
                    {trendView === "columns" ? "amber: three-month average · dashed: linear trend" : trendView === "timeline" ? "markers: the biggest incidents in the window, by severity and sources" : "one cell per day, darker is busier"}
                  </span>
                </div>
                {trendView === "columns" && (
                  <MonthlyColumns
                    months={m.trend.map((p) => p.month)}
                    stacks={[{ key: "total", label: "Incidents", color: T.bar, values: m.trend.map((p) => p.total) }]}
                    line={m.trend.map((p) => p.ma)}
                    fit={m.trend.map((p) => p.fit)}
                    provisionalFrom={m.h.provisionalFrom}
                    height={340}
                    colors={NC}
                    gradientTop={T.accent}
                    glow
                    activeMonth={sel?.kind === "month" ? sel.month : null}
                    onMonth={(month) => m.setSelection({ kind: "month", month })}
                    label="Incidents per month"
                  />
                )}
                {trendView === "timeline" && (
                  <CumulativeTimeline
                    months={m.series.map((p) => p.month)}
                    totals={m.series.map((p) => p.total)}
                    notable={m.notable}
                    monthOf={monthOf}
                    provisionalFrom={m.h.provisionalFrom}
                    height={340}
                    theme={T}
                    activeMonth={sel?.kind === "month" ? sel.month : null}
                    onMonth={(month) => m.setSelection({ kind: "month", month })}
                    label="Running total of incidents, with the most notable ones marked"
                  />
                )}
                {trendView === "calendar" && (
                  <div className="flex min-h-[340px] flex-col justify-center">
                    <CalendarHeatmap dayCounts={m.dayCounts} from={calendarFrom} to={today} theme={T} activeDay={sel?.kind === "day" ? sel.day : null} onDay={(day) => m.setSelection({ kind: "day", day })} label="Incidents per day over the last twelve months" />
                  </div>
                )}
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
            lede="The stream is the same months as above, split into families: its height is the volume, its bands are the mix. Beside it, each family now against the window before. Hover a band for the month, click it for the incidents; the legend counts open each family."
          >
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
              <div className="glass min-w-0 p-4 sm:p-5">
                <FamilyStream
                  data={m.fam}
                  totals={famTotals}
                  theme={T}
                  provisionalFrom={m.h.provisionalFrom}
                  height={300}
                  activeFamily={sel?.kind === "family" ? sel.family : sel?.kind === "month-family" ? sel.family : null}
                  onFamily={(family) => m.setSelection({ kind: "family", family })}
                  onMonth={(month, family) => m.setSelection({ kind: "month-family", month, family })}
                  label="Incidents per month by family, as a stream"
                />
              </div>
              <div className="glass min-w-0 space-y-2 p-4 sm:p-5">
                <h3 className="text-[15px] font-medium">Movers</h3>
                {m.prior && m.priorFamilies ? (
                  <FamilySlope
                    rows={famShown.map((f) => ({ key: f, now: famTotals[f], prior: m.priorFamilies![f] }))}
                    theme={T}
                    priorLabel={priorLabel}
                    nowLabel={nowLabel}
                    height={300}
                    active={sel?.kind === "family" ? sel.family : null}
                    onNow={(family) => m.setSelection({ kind: "family", family })}
                    onPrior={(family) => m.setSelection({ kind: "family-range", family, from: m.prior!.from, to: m.prior!.to, label: priorLabel })}
                    label="Each family's count in the window before against now"
                  />
                ) : (
                  <p className="text-[13px] leading-relaxed text-dim">Pick a 12, 24 or 36 month window to compare each family with the window before it.</p>
                )}
              </div>
            </div>
          </Section>

          <Section n="03" kicker="Who and how bad" title="Shape, severity, targets" lede="The radar is the window's shape against the window before. The heatmap is where each family lands on the severity scale, from research demonstrations to confirmed real-world loss. The bubbles are who is hit by what, and the flow below follows every incident from attack on AI or by AI, through its family, onto its targets.">
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="glass min-w-0 space-y-2 p-5">
                <h3 className="text-[15px] font-medium">The shape of the threat</h3>
                <FamilyRadar
                  families={famShown}
                  now={famTotals}
                  prior={m.priorFamilies}
                  theme={T}
                  nowLabel={nowLabel}
                  priorLabel={priorLabel}
                  active={sel?.kind === "family" ? sel.family : null}
                  onNow={(family) => m.setSelection({ kind: "family", family })}
                  onPrior={(family) => m.prior && m.setSelection({ kind: "family-range", family, from: m.prior.from, to: m.prior.to, label: priorLabel })}
                  label="Families on a radar chart, this window against the window before"
                />
                <p className="text-[12px] text-dim">{m.prior ? `Solid: ${nowLabel}. Dashed: the ${priorLabel}.` : "Solid: all time. Pick a shorter window to compare it with the one before."}</p>
              </div>
              <div className="glass min-w-0 space-y-3 p-5">
                <h3 className="text-[15px] font-medium">How bad, by family</h3>
                <SeverityHeatmap
                  families={famShown}
                  counts={m.famSev}
                  theme={T}
                  active={sel?.kind === "family-severity" ? { family: sel.family, severity: sel.severity } : null}
                  onCell={(family, severity) => m.setSelection({ kind: "family-severity", family, severity })}
                  onFamily={(family) => m.setSelection({ kind: "family", family })}
                  onSeverity={(severity: Severity) => m.setSelection({ kind: "severity", severity })}
                />
                <p className="text-[12px] text-dim">Severity 2 here means a flaw that was reported as news. CVEs with no confirmed exploitation are tracked separately below.</p>
              </div>
              <div className="glass min-w-0 space-y-3 p-5">
                <h3 className="text-[15px] font-medium">Who is hit, by what</h3>
                <TargetBubbles
                  families={famShown}
                  targets={m.targets.filter((t) => t.count > 0).slice(0, 10)}
                  counts={m.famTarget}
                  familyTotals={famTotals}
                  theme={T}
                  active={sel?.kind === "family-target" ? { family: sel.family, target: sel.target } : null}
                  onCell={(family, target) => m.setSelection({ kind: "family-target", family, target })}
                  onTarget={(target: Target) => m.setSelection({ kind: "target", target })}
                  onFamily={(family) => m.setSelection({ kind: "family", family })}
                />
                <p className="text-[12px] text-dim">An incident can name several targets.</p>
              </div>
            </div>
            <div className="glass min-w-0 space-y-2 p-4 sm:p-5">
              <h3 className="text-[15px] font-medium">The flow: on AI or by AI, into a family, onto its targets</h3>
              <FlowSankey
                types={m.types}
                families={famShown.map((f) => ({ key: f, count: famTotals[f] }))}
                targets={m.targets.filter((t) => t.count > 0)}
                typeFam={m.typeFam}
                famTarget={m.famTarget}
                theme={T}
                onType={(type: IncidentType) => m.setSelection({ kind: "type", type })}
                onFamily={(family) => m.setSelection({ kind: "family", family })}
                onTarget={(target) => m.setSelection({ kind: "target", target })}
                onTypeFamily={(type, family) => m.setSelection({ kind: "type-family", type, family })}
                onFamilyTarget={(family, target) => m.setSelection({ kind: "family-target", family, target })}
                label="Flow of incidents from type to family to target"
              />
              <p className="text-[12px] text-dim">Ribbon width is the count. The right column counts target mentions, so an incident naming two targets appears in both.</p>
            </div>
          </Section>

          <Section
            id="disclosed"
            n="04"
            kicker="Disclosed, not exploited"
            title="Vulnerabilities, tracked separately"
            lede="CVEs and advisories for AI frameworks and tools with no confirmed exploitation. They show how much attack surface is being found and patched, not attacks, so none of them are in the counts above. A CVE joins the incidents once CISA or the vendor confirms exploitation."
          >
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_352px]">
              <div className="glass min-w-0 p-4 sm:p-5">
                <MonthlyColumns
                  months={m.disclosedSeries.map((p) => p.month)}
                  stacks={[{ key: "disclosed", label: "Disclosed vulnerabilities", color: DISCLOSED_COLOR, values: m.disclosedSeries.map((p) => p.total) }]}
                  provisionalFrom={m.h.provisionalFrom}
                  height={300}
                  colors={NC}
                  activeMonth={sel?.kind === "disclosed-month" ? sel.month : null}
                  onMonth={(month) => m.setSelection({ kind: "disclosed-month", month })}
                  label="Disclosed vulnerabilities per month"
                />
              </div>
              <div className="glass min-w-0 space-y-4 p-5">
                <div className="grid grid-cols-2 gap-4">
                  <StatTile label="Disclosed in view" value={m.disclosedCount} onValue={() => m.setSelection({ kind: "disclosed" })} compare={`${m.count.toLocaleString("en-US")} incidents`} />
                  {m.disclosedBusiest && (
                    <StatTile
                      label="Busiest day"
                      value={m.disclosedBusiest.count}
                      onValue={() => m.setSelection({ kind: "disclosed-day", day: m.disclosedBusiest!.day })}
                      compare={`on ${m.disclosedBusiest.day}`}
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <h3 className="text-[12.5px] text-dim">Most disclosures, by product</h3>
                  <BarRows
                    rows={m.disclosedProducts.slice(0, 8).map((p) => ({ key: p.key, label: p.key, value: p.count, color: DISCLOSED_COLOR }))}
                    labelWidth="9rem"
                    glow={false}
                    onPick={(k) => m.setSelection({ kind: "disclosed-product", product: k })}
                    active={sel?.kind === "disclosed-product" ? sel.product : null}
                  />
                </div>
              </div>
            </div>
          </Section>

          {data.radar && (
            <Reveal>
              <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                <div className="max-w-xl space-y-3">
                  <div className="divider">
                    <span className="text-accent">05</span> Context
                  </div>
                  <AsciiForm as="h2" text="The bots on the wire" onView className="text-2xl font-semibold tracking-tight sm:text-[28px]" />
                  <p className="text-[15.5px] leading-relaxed text-soft">
                    Not incidents: a weekly reading of how much web traffic is automated and which AI crawlers send it, from Cloudflare Radar. Background for the counts above, never added to them.
                  </p>
                  <ul className="space-y-2 text-[14px] leading-relaxed text-dim">
                    <li>
                      <span className="text-soft">Bot share</span> is the part of all HTTP requests Cloudflare classifies as automated, over the last seven days.
                    </li>
                    <li>
                      <span className="text-soft">AI crawlers</span> are the slice of that bot traffic sent by known AI user agents; their share of all requests is derived from the two, not measured.
                    </li>
                    <li>
                      <span className="text-soft">Crawl purpose</span> is what those crawlers declare they fetch pages for: model training, search, or acting on a user&rsquo;s request.
                    </li>
                  </ul>
                </div>
                <RadarPanel radar={data.radar} className="glass" />
              </section>
            </Reveal>
          )}

          <Section n="06" kicker="Latest" title="Just reported" lede="The six newest incidents. Each one opens with every source, its classification and related incidents.">
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

      <ReportDrawer selection={m.selection} rows={m.selected} error={m.selectedError} windowLabel={m.windowLabel} basis={m.basis} field={m.field} onClose={() => m.setSelection(null)} />
    </div>
  );
}
