"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { AsciiForm } from "@/components/fx/AsciiForm";
import { CountUp } from "@/components/fx/CountUp";
import { Ago, NextSweep } from "@/components/fx/NextSweep";
import { Reveal } from "@/components/fx/Reveal";
import { FeedTerminal } from "@/components/fx/glyph/FeedTerminal";
import { GlyphField } from "@/components/fx/glyph/GlyphField";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Wordmark } from "@/components/layout/Wordmark";
import { BarRows } from "@/components/charts/BarRows";
import { CalendarHeatmap } from "@/components/charts/CalendarHeatmap";
import { CumulativeTimeline } from "@/components/charts/CumulativeTimeline";
import { FamilyDumbbell } from "@/components/charts/FamilyDumbbell";
import { FamilyRadar } from "@/components/charts/FamilyRadar";
import { FamilyRows } from "@/components/charts/FamilyRows";
import { FlowSankey } from "@/components/charts/FlowSankey";
import { HarmBars } from "@/components/charts/HarmBars";
import { MonthlyColumns, type ColumnColors } from "@/components/charts/MonthlyColumns";
import { RankRows } from "@/components/charts/RankRows";
import { TargetBars } from "@/components/charts/TargetBars";
import { RadarPanel } from "@/components/panels/RadarPanel";
import { CategoryBadge, SeverityBadge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { StatTile } from "@/components/ui/StatTile";
import type { Basis, CompactRow, DashboardData } from "@/lib/dashboard";
import { FAMILIES, FAMILY_META, type Family } from "@/lib/families";
import { productSlug } from "@/lib/products";
import { formatPct, monthLabel } from "@/lib/format";
import { NAV, WINDOW_CHOICES } from "@/lib/site";
import { dateOf, monthKey, monthRange, pctChange, shiftMonth } from "@/lib/stats";
import { ATLAS_RELEASE, ATLAS_TECHNIQUES, OWASP_LLM_EDITION, OWASP_LLM_META, atlasUrl, type IncidentType, type Severity, type Target } from "@/lib/taxonomy";
import { AGENTIC_META, AGENTIC_SLICES } from "@/lib/watch";
import { THEME as T } from "@/lib/theme";
import { ReportDrawer } from "./ReportDrawer";
import { useDashboardModel, type WindowKey } from "./useDashboardModel";

/** Disclosed vulnerabilities: a neutral slate, apart from the incident blue (single series, contrast 4.9:1 on the surface). */
const DISCLOSED_COLOR = "#6b7fa8";
const NC: ColumnColors = { grid: T.grid, axis: T.axis, ink: T.ink, dim: T.dim, accent: T.accent, provisional: T.provisional, surface: T.surface };
/** The trend panel's three views of the same months. */
type TrendView = "columns" | "timeline" | "calendar";

/** A count in the hero's line under its headline number: a dotted underline, opening its incidents. */
function HeroCount({ value, onOpen, ariaLabel }: { value: number; onOpen: () => void; ariaLabel: string }) {
  return (
    <button type="button" onClick={onOpen} aria-label={ariaLabel} className="num text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent hover:decoration-[color:var(--color-accent)]">
      <CountUp value={value} />
    </button>
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
          {lede && <p className="max-w-5xl text-[15px] leading-relaxed text-soft">{lede}</p>}
        </header>
        {children}
      </section>
    </Reveal>
  );
}

/**
 * A chart panel's heading: the title, then one line on how to read the chart.
 * The line keeps a two-line height from md up, so panels side by side start
 * their charts level; `short` panels, whose notes all fit one line, keep one.
 */
function PanelHead({ title, note, aside, short = false }: { title: string; note?: ReactNode; aside?: ReactNode; short?: boolean }) {
  return (
    <header className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[16px] font-medium leading-snug text-ink">{title}</h3>
        {aside}
      </div>
      {note && <p className={`text-[13px] leading-snug text-dim ${short ? "" : "md:min-h-[2lh]"}`}>{note}</p>}
    </header>
  );
}

/** A line sample for a legend in running text: solid (this window) or dashed (the window before). */
function LineSwatch({ dashed = false }: { dashed?: boolean }) {
  return <span aria-hidden className={`mx-1 inline-block w-4 -translate-y-[3px] border-t-2 ${dashed ? "border-dashed border-dim" : "border-accent"}`} />;
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
 * The dashboard: a hero (the circuit-world banner, an armoured chip of the
 * company's AI systems under attack, with the threat-feed terminal) that
 * fades as the content slides over it, then the trend, families,
 * targets/types/severity, the standards and agentic panels and the latest log.
 * Every count and bar opens its incidents in a side drawer.
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
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();

  // the stat tiles' sparklines, from the monthly aggregates (month-placed incidents, as the headline month counts are)
  const { agg } = data;
  const { field, basis, series, prior } = m;
  const thisMonthKey = m.h.thisMonthKey;
  const tiles = useMemo(() => {
    const cells = agg.months[field];
    const count = (k: string, b: Basis = basis) => cells[k]?.[b]?.n ?? 0;
    const running = (ks: string[]) => {
      let s = 0;
      return ks.map((k) => (s += count(k)));
    };
    const last12 = monthRange(shiftMonth(thisMonthKey, -11), thisMonthKey);
    const year = Number(thisMonthKey.slice(0, 4));
    return {
      monthly: last12.map((k) => count(k)),
      /** Each month's trailing-12 total, ending at the tile's value. */
      rolling: last12.map((k) => monthRange(shiftMonth(k, -11), k).reduce((s, j) => s + count(j), 0)),
      ytd: running(monthRange(`${year}-01`, thisMonthKey)),
      lastYear: running(monthRange(`${year - 1}-01`, `${year - 1}-12`)),
      real: series.map((p) => cells[p.month]?.real?.n ?? 0),
      /** Real-world incidents in the window before (window membership, year-only dates included, like realInWindow). */
      priorReal: prior ? monthRange(prior.from, prior.to).reduce((s, k) => s + (cells[k]?.real?.n ?? 0) + (cells[k]?.yearOnly?.real?.n ?? 0), 0) : null,
    };
  }, [agg, field, basis, thisMonthKey, series, prior]);

  return (
    <div className="min-h-dvh">
      {/* hero: on desktop sticky, fading and receding as the content slides over it; below lg it scrolls away normally */}
      <div ref={heroRef} className="hero-fade relative z-0 lg:sticky lg:top-0">
        <header className="relative z-20">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4">
            <Wordmark />
            <nav aria-label="Primary" className="hidden items-center gap-4 lg:flex xl:gap-6">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="label hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <nav aria-label="Primary mobile" className="overflow-x-auto border-b border-line-soft lg:hidden">
            <div className="flex h-10 items-center gap-5 whitespace-nowrap px-4">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="label hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        <div className="relative mx-auto max-w-7xl px-4">
          {/* the banner: a band above the text on phones, behind it on wide screens */}
          <div aria-hidden className="hero-field relative h-72 lg:absolute lg:inset-y-0 lg:left-4 lg:right-4 lg:h-auto">
            <GlyphField
              // the scene's code loads on demand, after the page; the poster shows until its first frame
              scene={() => import("@/components/fx/glyph/scenes/circuitWorld").then((s) => s.circuitWorld({ intel: data.intel }))}
              poster="/hero/circuit-poster.webp"
              posterAt="72% 50%"
              running={!heroGone}
              label="A camera journey over a chip package whose districts are AI systems, where defender agents catch red fault packets from the last 90 days of attacks and scrub infected blocks clean"
              className="h-full w-full"
            />
          </div>
          <div className="relative z-10 flex items-center pb-20 pt-2 lg:min-h-[min(640px,calc(100svh-4rem))]">
            <div className="min-w-0 max-w-xl space-y-5">
              <AsciiForm as="h1" text="Threat intelligence for the AI era." duration={2600} className="text-4xl font-semibold leading-[1.06] tracking-tight sm:text-5xl lg:text-[54px]" />
              <p className="max-w-xl text-[15px] leading-relaxed text-soft">
                The live, source-verified record of attacks on and with AI, from prompt injection and agent hijacking to model theft and deepfake fraud. Every incident counted once, so security teams can see what is hitting now and what is rising next.
              </p>
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
              {/* the counts behind the headline number, each opening its incidents */}
              <div className="space-y-1">
                <p className="text-[14px] leading-relaxed text-soft">
                  <HeroCount value={m.realInWindow} onOpen={() => m.setSelection({ kind: "real" })} ariaLabel={`${m.realInWindow} real-world incidents`} /> real-world (severity 3–4) ·{" "}
                  <HeroCount value={m.disclosedCount} onOpen={() => m.setSelection({ kind: "disclosed" })} ariaLabel={`${m.disclosedCount} disclosed vulnerabilities`} /> disclosed CVEs, tracked apart
                </p>
                <p className="font-mono text-[12px] text-dim">
                  last sweep <Ago iso={data.lastUpdated} className="text-soft" /> · next in <NextSweep className="text-soft" />
                </p>
              </div>
              <FeedTerminal intel={data.intel} className="w-full max-w-[480px]" />
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
      <div className="hero-cover relative z-10 bg-ground lg:-mt-14">
        <div className="z-30 border-y border-line-soft bg-ground sm:sticky sm:top-0 lg:bg-[color-mix(in_oklab,var(--color-ground)_94%,transparent)]">
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
            lede={`By ${m.fieldLabel}, ${monthLabel(m.from, true)} to ${monthLabel(m.to, true)}, a trend of ${m.slope >= 0 ? "+" : "−"}${Math.abs(m.slope).toFixed(2)} a month. The bracketed months are provisional.`}
          >
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
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
                    breakdown={famShown.map((f) => ({ key: f, label: FAMILY_META[f].short, color: T.families[f], values: m.fam.map((p) => p.values[f]) }))}
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
                {/* large tiles, one fixed layout: label, value and change, unit, the trend to the edges, its span at the foot; the comparisons live in the chips' tooltips */}
                <StatTile
                  className="glass"
                  size="lg"
                  label={`${monthLabel(m.h.thisMonthKey)} so far`}
                  value={m.h.thisMonth}
                  unit={`day ${dayOfMonth} of ${daysInMonth}`}
                  delta={m.h.monthDeltaPct}
                  deltaTitle={`against all of ${monthLabel(m.h.lastMonthKey, true)} (${m.h.lastMonth})`}
                  onValue={() => m.setSelection(m.picks.thisMonth)}
                  spark={tiles.monthly}
                  sparkNote="monthly"
                  axis={[monthLabel(shiftMonth(thisMonthKey, -11)), monthLabel(thisMonthKey)]}
                />
                <StatTile
                  className="glass"
                  size="lg"
                  label="Trailing 12 months"
                  value={m.h.trailing12}
                  unit="sum of 12 months"
                  delta={m.h.trailingDeltaPct}
                  deltaTitle={`against the 12 months before (${m.h.prior12})`}
                  onValue={() => m.setSelection(m.picks.trailing12)}
                  spark={tiles.rolling}
                  sparkNote="rolling"
                  axis={[monthLabel(shiftMonth(thisMonthKey, -11)), monthLabel(thisMonthKey)]}
                />
                <StatTile
                  className="glass"
                  size="lg"
                  label="Year to date"
                  value={m.h.yearToDate}
                  unit={
                    <>
                      against <span aria-hidden className="mx-0.5 inline-block w-4 -translate-y-[3px] border-t-[1.5px] border-dashed border-dim" /> {Number(thisMonthKey.slice(0, 4)) - 1}
                    </>
                  }
                  delta={m.h.yoyPct}
                  deltaTitle={`against the same point last year (${m.h.lastYearSamePeriod})`}
                  onValue={() => m.setSelection(m.picks.ytd)}
                  spark={tiles.ytd}
                  sparkCompare={tiles.lastYear}
                  sparkSlots={12}
                  sparkNote="running"
                  axis={[monthLabel(`${thisMonthKey.slice(0, 4)}-01`), monthLabel(`${thisMonthKey.slice(0, 4)}-12`)]}
                />
                <StatTile
                  className="glass"
                  size="lg"
                  label="Real-world in view"
                  value={m.realInWindow}
                  unit="severity 3–4"
                  accent
                  delta={tiles.priorReal === null ? undefined : pctChange(m.realInWindow, tiles.priorReal)}
                  deltaTitle={`against the ${priorLabel} (${tiles.priorReal ?? 0}); ${m.count > 0 ? Math.round((m.realInWindow / m.count) * 100) : 0}% of the view`}
                  onValue={() => m.setSelection({ kind: "real" })}
                  spark={tiles.real}
                  sparkColor={T.severity[3]}
                  sparkNote="monthly"
                  axis={[monthLabel(m.from), monthLabel(m.to)]}
                />
              </div>
            </div>
          </Section>

          <Section n="02" kicker="Latest" title="Just reported" lede="The six newest incidents. Each opens with every source, its classification and related incidents.">
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

          <Section
            n="03"
            kicker="What kind"
            title="Seven families of incident"
            lede="Each family's share, month-by-month shape and change against the window before. Every count and month opens its incidents."
          >
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="glass min-w-0 space-y-4 p-4 sm:p-5">
                <PanelHead
                  title="The families, largest first"
                  note={m.prior ? `Share of the window, the months on each family's own scale, the count and its change on the ${priorLabel}.` : "Share of the window, the months on each family's own scale and the count. Pick 12, 24 or 36 months to see the change."}
                />
                <FamilyRows
                  families={famShown}
                  totals={famTotals}
                  prior={m.priorFamilies}
                  series={m.fam}
                  theme={T}
                  priorLabel={`the ${priorLabel}`}
                  active={sel?.kind === "family" ? sel.family : sel?.kind === "month-family" ? sel.family : null}
                  onFamily={(family) => m.setSelection({ kind: "family", family })}
                  onMonth={(month, family) => m.setSelection({ kind: "month-family", month, family })}
                />
              </div>
              <div className="glass min-w-0 space-y-4 p-4 sm:p-5">
                <PanelHead title="Movers" note={m.prior ? `Largest change first: where each family stood in the ${priorLabel}, and where it stands now.` : undefined} />
                {m.prior && m.priorFamilies ? (
                  <FamilyDumbbell
                    rows={famShown.map((f) => ({ key: f, now: famTotals[f], prior: m.priorFamilies![f] }))}
                    theme={T}
                    priorLabel={priorLabel}
                    nowLabel={nowLabel}
                    active={sel?.kind === "family" ? sel.family : null}
                    onNow={(family) => m.setSelection({ kind: "family", family })}
                    onPrior={(family) => m.setSelection({ kind: "family-range", family, from: m.prior!.from, to: m.prior!.to, label: priorLabel })}
                    label="Each family's count in the window before against now"
                  />
                ) : (
                  <p className="text-[14px] leading-relaxed text-dim">Pick a 12, 24 or 36 month window to compare each family with the window before it.</p>
                )}
              </div>
            </div>
          </Section>

          <Section
            n="04"
            kicker="Who and how bad"
            title="Shape, severity, targets"
            lede="Which families dominate, how much harm each has done and who they hit. Every count and bar opens its incidents."
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="glass flex min-w-0 flex-col gap-4 p-4 sm:p-5">
                <PanelHead
                  title="The shape of the threat"
                  note={
                    m.prior ? (
                      <>
                        <LineSwatch />
                        {nowLabel} <LineSwatch dashed />
                        {priorLabel}. Square-root scale, so the small families still show.
                      </>
                    ) : (
                      <>
                        <LineSwatch />
                        all time. Square-root scale, so the small families still show.
                      </>
                    )
                  }
                />
                <div className="flex flex-1 items-center">
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
                    label="Families on a radar chart, this window against the window before, on a square-root scale"
                  />
                </div>
              </div>
              <div className="glass flex min-w-0 flex-col gap-4 p-4 sm:p-5">
                <PanelHead title="How bad, by family" note="Bar length is the count; the % did harm (severity 3–4). Disclosed: a flaw reported as news." />
                <HarmBars
                  families={famShown}
                  counts={m.famSev}
                  theme={T}
                  active={sel?.kind === "family-severity" ? { family: sel.family, severity: sel.severity } : null}
                  onSegment={(family, severity) => m.setSelection({ kind: "family-severity", family, severity })}
                  onFamily={(family) => m.setSelection({ kind: "family", family })}
                  onSeverity={(severity: Severity) => m.setSelection({ kind: "severity", severity })}
                />
              </div>
              <div className="glass flex min-w-0 flex-col gap-4 p-4 sm:p-5 md:col-span-2 xl:col-span-1">
                <PanelHead title="Who is hit, by what" note="Incidents naming each target (one can name several), and the families that hit it most." />
                <TargetBars
                  families={famShown}
                  targets={m.targets.filter((t) => t.count > 0)}
                  counts={m.famTarget}
                  theme={T}
                  active={sel?.kind === "family-target" ? { family: sel.family, target: sel.target } : null}
                  onTarget={(target: Target) => m.setSelection({ kind: "target", target })}
                  onSegment={(family, target) => m.setSelection({ kind: "family-target", family, target })}
                  rows={8}
                />
              </div>
            </div>
          </Section>

          <Section
            n="05"
            kicker="Your stack"
            title="Products, agents and the standards"
            lede="The AI products attacks named, the incidents involving AI agents, and the window in OWASP and MITRE ATLAS terms."
          >
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="glass min-w-0 space-y-4 p-4 sm:p-5">
                <PanelHead
                  short
                  title="Is my stack hit?"
                  note="Attacks on AI systems that name the product, and its CVEs in the window."
                  aside={
                    <Link href="/products" className="label hover:text-ink">
                      every product →
                    </Link>
                  }
                />
                {m.stack.length > 0 ? (
                  <RankRows
                    chart="stack"
                    color={T.bar}
                    head={{ label: "product", count: "attacks", extra: "CVEs" }}
                    rows={m.stack.slice(0, 8).map((p) => ({
                      key: p.key,
                      label: p.key,
                      labelHref: `/products/${productSlug(p.key)}`,
                      count: p.count,
                      countName: `${p.key}, attacks on it`,
                      onCount: () => m.setSelection({ kind: "product", product: p.key }),
                      extra: { count: p.cves, name: `${p.key}, CVEs`, onClick: () => m.setSelection({ kind: "disclosed-product", product: p.key }) },
                    }))}
                  />
                ) : (
                  <p className="text-[14px] text-dim">No attack on an AI system named a product in this window.</p>
                )}
              </div>
              <div className="glass min-w-0 space-y-4 p-4 sm:p-5">
                <PanelHead short title="Agentic AI watch" note="Agents or their tools turned on their users; one incident can sit in several rows." />
                <RankRows
                  chart="agentic"
                  color={T.families.agent}
                  max={m.agentic.all}
                  head={{ label: "incidents involving agents", count: "count", change: m.prior ? "vs before" : undefined }}
                  rows={[
                    ...AGENTIC_SLICES.map((k) => ({
                      key: k,
                      label: AGENTIC_META[k].label,
                      title: AGENTIC_META[k].title,
                      count: m.agentic[k],
                      countName: AGENTIC_META[k].label,
                      onCount: () => m.setSelection({ kind: "agentic", slice: k }),
                      prior: m.priorAgentic ? m.priorAgentic[k] : null,
                    })),
                    {
                      key: "cves",
                      label: "CVEs disclosed in agent tooling",
                      title: "Disclosed vulnerabilities in MCP servers and SDKs, coding agents and agent platforms (lib/watch.ts)",
                      bar: false,
                      count: m.disclosedAgent,
                      countName: "CVEs disclosed in agent tooling",
                      unit: "disclosed vulnerabilities",
                      onCount: () => m.setSelection({ kind: "disclosed-agentic" }),
                      divider: true,
                    },
                  ]}
                />
              </div>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="glass min-w-0 space-y-4 p-4 sm:p-5">
                <PanelHead short title="OWASP Top 10 for LLM Applications" note={`The ${OWASP_LLM_EDITION} list in its own order; a code opens the entry on owasp.org.`} />
                <RankRows
                  chart="owasp"
                  color={T.accent}
                  head={{ label: "entry", count: "incidents", change: m.prior ? "vs before" : undefined }}
                  rows={m.owasp.map((o) => ({
                    key: o.key,
                    code: o.key,
                    codeHref: OWASP_LLM_META[o.key].url,
                    label: OWASP_LLM_META[o.key].name,
                    count: o.count,
                    countName: `OWASP ${o.key} ${OWASP_LLM_META[o.key].name}`,
                    onCount: () => m.setSelection({ kind: "owasp", id: o.key }),
                    prior: m.priorOwasp ? m.priorOwasp[o.key] : null,
                  }))}
                />
                <p className="text-[13px] leading-snug text-dim">
                  <button type="button" onClick={() => m.setSelection({ kind: "owasp", id: "any" })} aria-label={`Mapped to the OWASP list: ${m.owaspAny} incidents`} className="num text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent">
                    {m.owaspAny.toLocaleString("en-US")}
                  </button>{" "}
                  of{" "}
                  <button type="button" onClick={() => m.setSelection({ kind: "window" })} aria-label={`All incidents in view: ${m.count} incidents`} className="num text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent">
                    {m.count.toLocaleString("en-US")}
                  </button>{" "}
                  incidents map to an entry; deepfakes and AI-as-weapon attacks map to none.
                </p>
              </div>
              <div className="glass min-w-0 space-y-4 p-4 sm:p-5">
                <PanelHead short title="MITRE ATLAS techniques" note={`Release ${ATLAS_RELEASE}, most incidents first; an id opens the technique on atlas.mitre.org.`} />
                <RankRows
                  chart="atlas"
                  color="#7fdcff"
                  codeWidth="7.25rem"
                  head={{ label: "technique", count: "incidents", change: m.prior ? "vs before" : undefined }}
                  rows={m.atlas.slice(0, 10).map((a) => ({
                    key: a.key,
                    code: a.key,
                    codeHref: atlasUrl(a.key),
                    label: ATLAS_TECHNIQUES[a.key],
                    count: a.count,
                    countName: `ATLAS ${a.key} ${ATLAS_TECHNIQUES[a.key]}`,
                    onCount: () => m.setSelection({ kind: "atlas", id: a.key }),
                    prior: m.priorAtlas ? m.priorAtlas[a.key] : null,
                  }))}
                />
                {m.atlas.slice(10).some((a) => a.count > 0) && (
                  <p className="flex flex-wrap gap-x-3 text-[13px] text-dim">
                    <span className="text-faint">Also</span>
                    {m.atlas
                      .slice(10)
                      .filter((a) => a.count > 0)
                      .map((a) => (
                        <span key={a.key}>
                          {ATLAS_TECHNIQUES[a.key]}{" "}
                          <button type="button" onClick={() => m.setSelection({ kind: "atlas", id: a.key })} aria-label={`ATLAS ${a.key} ${ATLAS_TECHNIQUES[a.key]}: ${a.count} incidents`} className="num text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent">
                            {a.count}
                          </button>
                        </span>
                      ))}
                  </p>
                )}
              </div>
            </div>
          </Section>

          <Section
            id="disclosed"
            n="06"
            kicker="Disclosed, not exploited"
            title="Vulnerabilities, tracked separately"
            lede="CVEs for AI tools with no confirmed exploitation: attack surface, not attacks. None counts above until it is exploited."
          >
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_352px]">
              <div className="glass min-w-0 p-4 sm:p-5">
                <MonthlyColumns
                  months={m.disclosedSeries.map((p) => p.month)}
                  stacks={[{ key: "disclosed", label: "Disclosed vulnerabilities", color: DISCLOSED_COLOR, values: m.disclosedSeries.map((p) => p.total) }]}
                  provisionalFrom={m.h.provisionalFrom}
                  height={240}
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
                    rows={m.disclosedProducts.slice(0, 5).map((p) => ({ key: p.key, label: p.key, value: p.count, color: DISCLOSED_COLOR }))}
                    labelWidth="9rem"
                    glow={false}
                    onPick={(k) => m.setSelection({ kind: "disclosed-product", product: k })}
                    active={sel?.kind === "disclosed-product" ? sel.product : null}
                  />
                </div>
              </div>
            </div>
          </Section>



          {/* the fold: background that most visits skip, kept one click away so the page stays short */}
          <details className="group/more">
            <summary className="glass flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 transition-colors hover:border-accent [&::-webkit-details-marker]:hidden">
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="label text-accent">more</span>
                <span className="text-[15px] text-ink">The incident flow, from attack to target{data.radar ? ", and AI bot traffic on the web" : ""}</span>
              </span>
              <span aria-hidden className="text-[14px] text-dim transition-transform group-open/more:rotate-180">
                ▾
              </span>
            </summary>
            <div className="mt-12 space-y-16">
              <Section n="07" kicker="Flow" title="On AI or by AI, into a family, onto its targets" lede="Every incident in the window from its type through its family onto the targets it names.">
                <div className="glass min-w-0 space-y-4 p-4 sm:p-5">
                  <PanelHead title="The flow" note="Ribbon width is the count. The right column counts target mentions, so an incident naming two targets is in both." />
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
                </div>
              </Section>
              {data.radar && (
                <Section n="08" kicker="Context" title="The bots on the wire" lede="Not incidents: Cloudflare Radar's weekly reading of automated web traffic and the AI crawlers behind it, as background for the counts above.">
                  <RadarPanel radar={data.radar} variant="bare" className="glass" />
                </Section>
              )}
            </div>
          </details>
        </main>
        <SiteFooter />
      </div>

      <ReportDrawer selection={m.selection} rows={m.selected} error={m.selectedError} windowLabel={m.windowLabel} basis={m.basis} field={m.field} onClose={() => m.setSelection(null)} />
    </div>
  );
}
