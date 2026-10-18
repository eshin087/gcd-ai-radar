"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { TargetBarChart } from "@/components/charts/TargetBarChart";
import { DrillDown } from "@/components/dashboard/DrillDown";
import { Ago, NextSweep } from "@/components/fx/NextSweep";
import { CountUp } from "@/components/fx/CountUp";
import { RadarScope } from "@/components/fx/RadarScope";
import { Scramble } from "@/components/fx/Scramble";
import { SHADE, brailleSpark } from "@/components/fx/text";
import { CompactList } from "@/components/incidents/CompactList";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Wordmark } from "@/components/layout/Wordmark";
import { FamilyStack } from "@/components/lab/charts/FamilyStack";
import { LabTrend } from "@/components/lab/charts/LabTrend";
import { OrdinalSeverity } from "@/components/lab/charts/OrdinalSeverity";
import { TypeSplit } from "@/components/lab/charts/TypeSplit";
import { LabTile } from "@/components/lab/LabTile";
import { useDashboardModel, type WindowKey } from "@/components/lab/useDashboardModel";
import { RadarPanel } from "@/components/panels/RadarPanel";
import { Segmented } from "@/components/ui/Segmented";
import type { CompactRow, DashboardData } from "@/lib/dashboard";
import { FAMILIES, FAMILY_META, familyOf, type Family } from "@/lib/families";
import { formatPct, monthLabel } from "@/lib/format";
import { AMBER as T } from "@/lib/lab/themes";
import { NAV, WINDOW_CHOICES } from "@/lib/site";
import { pctChange } from "@/lib/stats";
import { SEVERITY_META, TYPE_META, type Severity } from "@/lib/taxonomy";
import { LabSwitcher } from "../LabSwitcher";

function Panel({ n, title, sub, children, className = "", aside }: { n: string; title: string; sub?: string; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <section className={`panel p-5 flex flex-col gap-4 ${className}`}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="divider">
            <span className="text-faint">{n}</span> {title}
          </div>
          {sub && <p className="mt-1.5 text-[12.5px] text-dim">{sub}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function ScopeDraft({ data }: { data: DashboardData }) {
  const m = useDashboardModel(data);
  const router = useRouter();
  const [focus, setFocus] = useState<Family | null>(null);
  const onBlip = useCallback((row: CompactRow) => router.push(`/incidents/${row.slug}`), [router]);
  const totals = m.series.map((p) => p.total);
  const delta = m.priorCount === null ? undefined : pctChange(m.rows.length, m.priorCount);
  const radarCounts = (() => {
    const t = Date.parse(data.now);
    const counts: Record<string, number> = {};
    for (const r of m.basisRows) {
      const age = (t - Date.parse(`${r.first_reported}T12:00:00Z`)) / 86400000;
      if (age >= 0 && age <= 90) {
        const f = familyOf(r.categories[0] ?? "other");
        counts[f] = (counts[f] ?? 0) + 1;
      }
    }
    return counts;
  })();
  const ticker = m.latestRows.slice(0, 12);

  return (
    <div className="lab-root lab-amber">
      {/* status bar */}
      <div className="border-b border-line-soft bg-panel/70 font-mono text-[11.5px]">
        <div className="mx-auto flex h-8 max-w-7xl items-center gap-5 overflow-hidden whitespace-nowrap px-4">
          <span className="flex items-center gap-2 text-ink">
            <span className="live-dot" /> LIVE
          </span>
          <span className="text-dim">
            last sweep <Ago iso={data.lastUpdated} className="text-soft" />
          </span>
          <span className="hidden text-dim sm:inline">
            next sweep in <NextSweep className="text-soft" />
          </span>
          <span className="hidden text-dim md:inline">{data.rows.length.toLocaleString("en-US")} incidents on record</span>
          <span className="ml-auto hidden text-faint lg:inline">bearing = family · range = age · brightness = severity</span>
        </div>
      </div>
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-6 px-4">
          <Wordmark />
          <nav aria-label="Primary" className="hidden items-center gap-5 md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="label hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8">
        {/* hero */}
        <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
          <div className="space-y-6">
            <p className="label bracket">AI security incidents · {m.windowLabel}</p>
            <Scramble as="h1" text="Swept every six hours. Counted once." className="text-3xl font-semibold tracking-tight sm:text-4xl" />
            <div className="flex flex-wrap items-baseline gap-4">
              <CountUp value={m.rows.length} className="text-7xl font-semibold leading-none tracking-tight text-ink sm:text-8xl" />
              {delta !== undefined && (
                <span className="text-[15px] text-dim">
                  <span className={`num ${delta === null || delta > 0 ? "text-sev-3" : "text-type-by"}`}>{formatPct(delta)}</span> vs the {m.win.replace("m", "")} months before
                </span>
              )}
            </div>
            <p className="max-w-xl text-[15px] leading-relaxed text-soft">
              <span className="text-accent">{m.realInWindow.toLocaleString("en-US")}</span> involved confirmed exploitation or real-world loss. The scope shows the
              last 90 days: each blip is one incident, however many outlets covered it. Hover a blip to read it, click to open it.
            </p>
            <div className="font-mono text-[13px] text-dim">
              <span className="text-soft tracking-tight">{brailleSpark(totals)}</span>
              <span className="ml-3">
                {monthLabel(m.from)} → {monthLabel(m.to)} · peak {Math.max(0, ...totals)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[12px] text-dim">
              <span className="label">brightness</span>
              {([1, 2, 3, 4] as Severity[]).map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-full" style={{ background: T.severity[s] }} />
                  {s} {SEVERITY_META[s].short}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <RadarScope rows={m.basisRows} now={data.now} accent={T.accent} ring={T.dim} label="Incident radar" severity={T.severity} onSelect={onBlip} focus={focus} />
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4" aria-label="Radar sectors">
              {FAMILIES.map((f) => (
                <li key={f}>
                  <button
                    type="button"
                    onMouseEnter={() => setFocus(f)}
                    onMouseLeave={() => setFocus(null)}
                    onFocus={() => setFocus(f)}
                    onBlur={() => setFocus(null)}
                    onClick={() => m.setSelection({ kind: "family", family: f })}
                    className="flex w-full items-center justify-between gap-2 py-0.5 text-left text-[12px] text-soft hover:text-ink"
                  >
                    <span className="truncate">{FAMILY_META[f].short}</span>
                    <span className="num text-dim">{radarCounts[f] ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* contact ticker */}
        <div className="overflow-hidden border-y border-line-soft py-2 font-mono text-[12px]" aria-label="Latest incidents">
          <div className="ticker">
            {[0, 1].map((dup) => (
              <div key={dup} className="flex shrink-0" aria-hidden={dup === 1}>
                {ticker.map((r) => (
                  <Link key={`${dup}-${r.id}`} href={`/incidents/${r.slug}`} className="mx-6 whitespace-nowrap text-soft hover:text-accent">
                    <span className="text-accent">{SHADE[r.severity]}</span> <span className="text-dim">{r.first_reported.slice(5)}</span> {r.title}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* one filter row above everything it scopes */}
        <div className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-3 border-b border-line-soft bg-ground/85 px-4 py-3 backdrop-blur">
          <Segmented
            label="Incident set"
            value={m.basis}
            onChange={m.setBasis}
            options={[
              { key: "all", label: "All incidents" },
              { key: "real", label: "Real-world only", title: "Severity 3 and 4" },
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

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line-soft lg:grid-cols-4">
          {[
            { label: `${monthLabel(m.h.thisMonthKey)} so far vs ${monthLabel(m.h.lastMonthKey)}`, value: m.h.thisMonth, delta: m.h.monthDeltaPct, compare: `${m.h.lastMonth} last month` },
            { label: "Trailing 12 months", value: m.h.trailing12, delta: m.h.trailingDeltaPct, compare: `${m.h.prior12} the 12 before`, spark: totals.slice(-12) },
            { label: "Year to date", value: m.h.yearToDate, delta: m.h.yoyPct, compare: `${m.h.lastYearSamePeriod} same period last year` },
            { label: `Real-world, ${m.windowLabel}`, value: m.realInWindow, compare: "severity 3–4", accent: true },
          ].map((t) => (
            <div key={t.label} className="bg-panel p-5">
              <LabTile {...t} />
            </div>
          ))}
        </div>

        <Panel
          n="01"
          title={m.basis === "real" ? "Real-world incidents per month" : "Incidents per month"}
          sub={`${monthLabel(m.from, true)} to ${monthLabel(m.to, true)} · by ${m.fieldLabel} · amber line: 3-month average · dashed: linear trend (${m.slope >= 0 ? "+" : ""}${m.slope.toFixed(2)}/month) · shaded: provisional`}
        >
          <LabTrend data={m.trend} theme={T} provisionalFrom={m.h.provisionalFrom} height={400} activeMonth={m.selection?.kind === "month" ? m.selection.month : null} onBarClick={(month) => m.setSelection({ kind: "month", month })} />
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel n="02" title="By category family" sub="primary category, monthly · 7 families + other">
            <FamilyStack data={m.fam} theme={T} onSegmentClick={(month, family) => m.setSelection({ kind: "month-family", month, family })} />
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {m.families
                .filter((f) => f.count > 0)
                .map((f) => (
                  <li key={f.key}>
                    <button type="button" onClick={() => m.setSelection({ kind: "family", family: f.key })} className="flex items-center gap-1.5 text-[12px] text-soft hover:text-ink">
                      <span className="inline-block size-2.5 rounded-[2px]" style={{ background: T.families[f.key] }} />
                      {FAMILY_META[f.key].short} <span className="num text-dim">{f.count}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </Panel>
          <Panel n="03" title="Attacks on AI vs AI-enabled attacks" sub="monthly, stacked">
            <TypeSplit data={m.series} theme={T} onBarClick={(month, type) => m.setSelection({ kind: "month-type", month, type })} />
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
              {m.types.map((t) => (
                <li key={t.key} className="flex items-center gap-1.5 text-[12px] text-soft">
                  <span className="inline-block size-2.5 rounded-[2px]" style={{ background: T.types[t.key] }} />
                  {TYPE_META[t.key].label} <span className="num text-dim">{t.count}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel n="04" title="Who is hit" sub="an incident can name several targets">
            <TargetBarChart data={m.targets} limit={10} color={T.bar} onBarClick={(target) => m.setSelection({ kind: "target", target })} />
          </Panel>
          <Panel n="05" title="How bad" sub="one severity per incident · brighter = worse">
            <OrdinalSeverity data={m.severities} theme={T} onPick={(severity) => m.setSelection({ kind: "severity", severity })} active={m.selection?.kind === "severity" ? m.selection.severity : null} />
          </Panel>
        </div>

        {m.selection && (
          <DrillDown key={JSON.stringify(m.selection)} selection={m.selection} rows={m.selected} windowLabel={m.windowLabel} basis={m.basis} field={m.field} onClose={() => m.setSelection(null)} />
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            n="06"
            title="Contact log"
            sub="most recently reported"
            className="lg:col-span-2"
            aside={
              <Link href="/incidents" className="label hover:text-ink">
                all incidents →
              </Link>
            }
          >
            <CompactList rows={m.latestRows} limit={8} />
          </Panel>
          {data.radar ? <RadarPanel radar={data.radar} /> : <div className="panel p-5 text-[13px] text-dim">Traffic panel appears once Cloudflare Radar data is fetched.</div>}
        </div>
      </main>
      <SiteFooter />
      <LabSwitcher current="scope" />
    </div>
  );
}
