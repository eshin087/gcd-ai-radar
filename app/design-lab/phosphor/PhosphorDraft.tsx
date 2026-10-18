"use client";

import Link from "next/link";
import { useEffect, useMemo, type ReactNode } from "react";
import { AsciiField } from "@/components/fx/AsciiField";
import { CountUp } from "@/components/fx/CountUp";
import { NextSweep } from "@/components/fx/NextSweep";
import { Reveal } from "@/components/fx/Reveal";
import { neuralCore } from "@/components/fx/scenes/neuralCore";
import { SleekBanner } from "@/components/fx/SleekBanner";
import { SHADE } from "@/components/fx/text";
import { Typewriter, type TypeLine } from "@/components/fx/Typewriter";
import { NeonColumns, type NeonColors } from "@/components/lab/charts/NeonColumns";
import { NeonRows } from "@/components/lab/charts/NeonRows";
import { ReportDrawer } from "@/components/lab/ReportDrawer";
import { useDashboardModel, type WindowKey } from "@/components/lab/useDashboardModel";
import type { Selection } from "@/components/dashboard/DrillDown";
import type { DashboardData } from "@/lib/dashboard";
import { FAMILIES, FAMILY_META, familyOf, type Family } from "@/lib/families";
import { formatPct, monthLabel } from "@/lib/format";
import { AMBER, PHOSPHOR } from "@/lib/lab/themes";
import { NAV, SITE, WINDOW_CHOICES } from "@/lib/site";
import { pctChange } from "@/lib/stats";
import { INCIDENT_TYPES, SEVERITY_META, TARGET_META, TYPE_META, type IncidentType, type Severity, type Target } from "@/lib/taxonomy";
import { LabSwitcher } from "../LabSwitcher";

const WINDOWS: WindowKey[] = [...WINDOW_CHOICES.map((w) => `${w}m` as WindowKey), "all"];

/** Neural-core tones: mesh, near nodes, pings and signals, scan plane, inner core, faint. Decorative, not data. */
const CORE_PALETTE = ["#2f9a58", "#8dfdb0", "#ffb35c", "#5fd4e6", "#9a76d4", "#2a6640"];

/** Chart colours: families and types validated on this surface; severity uses the amber ramp (ordinal check passed on #06120b). */
const SEVERITY = AMBER.severity;
const TARGET_COLOR = "#3a97cf";
const NC: NeonColors = { grid: "rgba(86,244,135,0.12)", axis: "#3fa865", ink: "#8dfdb0", dim: "#3fa865", accent: "#ffb35c", provisional: "rgba(86,244,135,0.06)" };

function Flag({ name, options, value, onChange, hint }: { name: string; options: { key: string; label: string }[]; value: string; onChange: (k: string) => void; hint: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-dim">--{name}</span>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`px-1 ${value === o.key ? "bg-[var(--color-ink)] text-[var(--color-ground)]" : "text-soft hover:text-ink"}`}
        >
          {value === o.key ? `[${o.label}]` : ` ${o.label} `}
        </button>
      ))}
      <span className="text-faint">({hint})</span>
    </div>
  );
}

/** label ........ value  note — the value opens its incidents when it is a count. */
function Readout({ label, value, note, onOpen, highlight = false }: { label: string; value: ReactNode; note?: ReactNode; onOpen?: () => void; highlight?: boolean }) {
  const v = <span className={highlight ? "text-accent" : "text-ink phosphor-glow"}>{value}</span>;
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
      <span className="text-soft">{label}</span>
      <span aria-hidden className="min-w-0 flex-1 overflow-hidden text-faint">
        {".".repeat(120)}
      </span>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:decoration-[color:var(--color-accent)]" aria-label={`${label}: open the incidents`}>
          {v}
        </button>
      ) : (
        v
      )}
      {note && <span className="w-[17ch] shrink-0 text-right text-[12px] text-dim">{note}</span>}
    </div>
  );
}

function Panel({ title, children, className = "" }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`tty min-w-0 ${className}`}>
      <span className="tty-title">┤ {title} ├</span>
      {children}
    </section>
  );
}

export function PhosphorDraft({ data }: { data: DashboardData }) {
  const m = useDashboardModel(data);
  const { setWin, setBasis, setField, setSelection } = m;
  const delta = m.priorCount === null ? undefined : pctChange(m.rows.length, m.priorCount);
  const sources = data.rows.reduce((s, r) => s + r.source_count, 0);
  const open = (s: Selection) => setSelection(s);
  const active = m.selection;

  // keyboard: 1-4 window, r real-world, d date basis (Esc closes the drawer itself)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) setWin(WINDOWS[idx]!);
      else if (e.key === "r") setBasis((b) => (b === "all" ? "real" : "all"));
      else if (e.key === "d") setField((f) => (f === "incident_date" ? "first_reported" : "incident_date"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setWin, setBasis, setField]);

  const boot: TypeLine[] = useMemo(
    () => [
      { text: "$ gcdairadar sweep --window 24m --dedupe", className: "text-soft", pause: 900 },
      { text: `[ ok ] ${data.rows.length.toLocaleString("en-US")} incidents on record from ${sources.toLocaleString("en-US")} sources`, className: "text-ink" },
      { text: `[ ok ] dedupe: one event, many sources → counted once`, className: "text-ink" },
      { text: `[ ok ] last sweep ${data.lastUpdated ? data.lastUpdated.slice(0, 16).replace("T", " ") + "Z" : "pending"} · schedule */6h`, className: "text-ink" },
      { text: "[ !! ] last 60 days provisional (reporting lag)", className: "text-accent" },
    ],
    [data.rows.length, data.lastUpdated, sources],
  );

  const famCount = (f: Family) => m.families.find((x) => x.key === f)?.count ?? 0;
  const familiesShown = FAMILIES.filter((f) => f !== "other" || famCount("other") > 0);

  return (
    <div className="lab-root lab-phosphor crt">
      {/* title bar */}
      <div className="border-b border-line bg-panel">
        <div className="mx-auto flex min-h-9 max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 whitespace-nowrap px-4 py-1.5 text-[12px]">
          <span className="text-accent">●</span>
          <span className="text-soft">gcdairadar — tty1</span>
          <span className="hidden text-dim sm:inline">
            next sweep <NextSweep className="text-ink" />
          </span>
          <nav aria-label="Primary" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 sm:ml-auto sm:w-auto">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-dim hover:text-ink">
                [{n.label.toLowerCase()}]
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8">
        {/* hero: banner + boot log, neural core under radar */}
        <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <SleekBanner text="gcd ai radar" className="max-w-[640px]" label="gcd AI Radar" />
            <p className="text-[12.5px] tracking-[0.18em] text-dim uppercase">
              <span className="text-accent">▍</span>neural threat telemetry · every AI security incident, counted once
            </p>
            <h1 className="sr-only">{SITE.tagline}</h1>
            <Typewriter lines={boot} storageKey="lab-phosphor-boot" cps={120} className="space-y-0.5 text-[13px]" />
          </div>
          <figure className="tty p-0!">
            <figcaption className="tty-title">┤ fig.0 · neural core under radar // live ascii ├</figcaption>
            <div className="h-[340px] w-full overflow-hidden">
              <AsciiField scene={() => neuralCore()} palette={CORE_PALETTE} fontSize={10.5} lineHeight={1.12} label="A rotating sphere of neural nodes scanned by a radar plane" className="h-full w-full" />
            </div>
            <div className="flex flex-wrap justify-between gap-x-4 border-t border-line px-3 py-1.5 text-[11px] text-dim">
              <span>
                <span style={{ color: CORE_PALETTE[3] }}>~</span> scan plane · <span style={{ color: CORE_PALETTE[2] }}>@</span> pinged node · <span style={{ color: CORE_PALETTE[4] }}>o</span> core
              </span>
              <span>move the pointer to steer</span>
            </div>
          </figure>
        </section>

        {/* command flags: the one filter row */}
        <div className="tty z-30 bg-ground/95 text-[13px] backdrop-blur sm:sticky sm:top-0">
          <span className="tty-title">┤ query ├</span>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-dim">$ radar</span>
            <Flag name="set" value={m.basis} onChange={(k) => m.setBasis(k as "all" | "real")} options={[{ key: "all", label: "all" }, { key: "real", label: "real-world" }]} hint="r" />
            <Flag name="by" value={m.field} onChange={(k) => m.setField(k as typeof m.field)} options={[{ key: "incident_date", label: "incident" }, { key: "first_reported", label: "reported" }]} hint="d" />
            <Flag name="window" value={m.win} onChange={(k) => m.setWin(k as WindowKey)} options={WINDOWS.map((w) => ({ key: w, label: w }))} hint="1-4" />
            <span className="hidden text-faint lg:inline">{"// every number opens its incidents"}</span>
          </div>
        </div>

        {/* monthly chart + readout */}
        <Reveal>
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Panel title={`${m.basis === "real" ? "real-world incidents" : "incidents"} / month · by family · by ${m.fieldLabel}`}>
              <NeonColumns
                months={m.fam.map((p) => p.month)}
                stacks={FAMILIES.map((f) => ({ key: f, label: FAMILY_META[f].label, color: PHOSPHOR.families[f], values: m.fam.map((p) => p.values[f]) }))}
                line={m.trend.map((p) => p.ma)}
                provisionalFrom={m.h.provisionalFrom}
                height={330}
                colors={NC}
                glow
                activeMonth={active?.kind === "month" ? active.month : null}
                onMonth={(month) => open({ kind: "month", month })}
                onSegment={(month, key) => open({ kind: "month-family", month, family: key as Family })}
                label="Incidents per month by family"
                tooltipClassName="font-mono"
              />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                {familiesShown.map((f) => (
                  <button key={f} type="button" onClick={() => open({ kind: "family", family: f })} className="group flex items-center gap-1.5 text-dim hover:text-ink">
                    <span className="inline-block size-2.5 rounded-[2px]" style={{ background: PHOSPHOR.families[f], boxShadow: `0 0 6px ${PHOSPHOR.families[f]}` }} />
                    {FAMILY_META[f].short}
                    <span className="text-soft underline decoration-dotted underline-offset-4">{famCount(f)}</span>
                  </button>
                ))}
                <span className="text-dim">
                  <span className="text-accent">━</span> 3-month average
                </span>
              </div>
            </Panel>
            <Panel title={`readout · ${m.windowLabel}`} className="text-[13px]">
              <div className="space-y-2">
                <Readout
                  label={m.basis === "real" ? "REAL-WORLD" : "INCIDENTS"}
                  value={<CountUp value={m.rows.length} />}
                  note={delta !== undefined ? `${formatPct(delta)} vs prior` : undefined}
                  onOpen={() => open({ kind: "window" })}
                />
                <Readout label="REAL-WORLD (SEV 3-4)" value={<CountUp value={m.realInWindow} />} highlight note="confirmed" onOpen={() => open({ kind: "real" })} />
                <Readout
                  label={`${monthLabel(m.h.thisMonthKey).toUpperCase()} SO FAR`}
                  value={<CountUp value={m.h.thisMonth} />}
                  note={`${formatPct(m.h.monthDeltaPct)} vs ${monthLabel(m.h.lastMonthKey)}`}
                  onOpen={() => open(m.picks.thisMonth)}
                />
                <Readout label="TRAILING 12 MO" value={<CountUp value={m.h.trailing12} />} note={`${formatPct(m.h.trailingDeltaPct)} vs prior 12`} onOpen={() => open(m.picks.trailing12)} />
                <Readout label="YEAR TO DATE" value={<CountUp value={m.h.yearToDate} />} note={`${formatPct(m.h.yoyPct)} vs last yr`} onOpen={() => open(m.picks.ytd)} />
                <Readout label="TREND (LINEAR FIT)" value={`${m.slope >= 0 ? "+" : ""}${m.slope.toFixed(2)}/mo`} note="over window" />
              </div>
              <div className="mt-4 border-t border-line pt-3 text-[12px] text-dim">
                <div className="mb-1.5 text-soft">severity</div>
                <NeonRows
                  rows={[...m.severities].reverse().map((s) => {
                    const sv = Number(s.key) as Severity;
                    return { key: s.key, label: `${sv} ${SEVERITY_META[sv].short}`, value: s.count, color: SEVERITY[sv], mark: SHADE[sv] };
                  })}
                  labelWidth="9rem"
                  onPick={(k) => open({ kind: "severity", severity: Number(k) as Severity })}
                  active={active?.kind === "severity" ? String(active.severity) : null}
                />
              </div>
            </Panel>
          </div>
        </Reveal>

        <div className="grid gap-8 lg:grid-cols-3">
          <Reveal>
            <Panel title="by family">
              <NeonRows
                rows={familiesShown.map((f) => ({ key: f, label: FAMILY_META[f].short, value: famCount(f), color: PHOSPHOR.families[f] }))}
                labelWidth="8.5rem"
                onPick={(k) => open({ kind: "family", family: k as Family })}
                active={active?.kind === "family" ? active.family : null}
              />
            </Panel>
          </Reveal>
          <Reveal delay={60}>
            <Panel title="targets">
              <NeonRows
                rows={m.targets
                  .filter((t) => t.count > 0)
                  .slice(0, 8)
                  .map((t) => ({ key: t.key, label: TARGET_META[t.key].label, value: t.count, color: TARGET_COLOR }))}
                labelWidth="9.5rem"
                onPick={(k) => open({ kind: "target", target: k as Target })}
                active={active?.kind === "target" ? active.target : null}
              />
            </Panel>
          </Reveal>
          <Reveal delay={120}>
            <Panel title="on AI · by AI">
              <NeonColumns
                months={m.series.map((p) => p.month)}
                stacks={INCIDENT_TYPES.map((t) => ({ key: t, label: TYPE_META[t].label, color: PHOSPHOR.types[t], values: m.series.map((p) => p.byType[t]) }))}
                provisionalFrom={m.h.provisionalFrom}
                height={170}
                colors={NC}
                peak={false}
                glow
                onMonth={(month) => open({ kind: "month", month })}
                onSegment={(month, key) => open({ kind: "month-type", month, type: key as IncidentType })}
                label="Attacks on AI and AI-enabled attacks per month"
                tooltipClassName="font-mono"
              />
              <NeonRows
                className="mt-2"
                rows={m.types.map((t) => ({ key: t.key, label: TYPE_META[t.key].label, value: t.count, color: PHOSPHOR.types[t.key] }))}
                labelWidth="8.5rem"
                onPick={(k) => open({ kind: "type", type: k as IncidentType })}
                active={active?.kind === "type" ? active.type : null}
              />
            </Panel>
          </Reveal>
        </div>

        {/* the log comes last, short */}
        <Reveal>
          <Panel title="tail -n 8 incidents.log" className="text-[13px]">
            <ol className="space-y-1">
              {m.latestRows.slice(0, 8).map((r) => {
                const fam = familyOf(r.categories[0] ?? "other");
                return (
                  <li key={r.id} className="flex items-center gap-3 whitespace-nowrap">
                    <span className="text-dim">{r.first_reported}</span>
                    <span style={{ color: SEVERITY[r.severity] }} title={`severity ${r.severity}`}>
                      {SHADE[r.severity]}
                    </span>
                    <span className="hidden w-28 items-center gap-1.5 truncate text-dim sm:flex">
                      <span className="inline-block size-2 shrink-0 rounded-[2px]" style={{ background: PHOSPHOR.families[fam] }} />
                      {FAMILY_META[fam].short}
                    </span>
                    <Link href={`/incidents/${r.slug}`} className="truncate text-ink hover:text-accent">
                      {r.title}
                    </Link>
                  </li>
                );
              })}
            </ol>
            <Link href="/incidents" className="mt-3 inline-block text-[12px] text-dim hover:text-ink">
              $ less incidents.log →
            </Link>
          </Panel>
        </Reveal>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap gap-x-5 gap-y-1 px-4 py-6 text-[12px] text-dim">
          <span>[ made by GCD ]</span>
          <a className="hover:text-ink" href={SITE.github}>
            [ code ]
          </a>
          <span>[ data CC BY-SA 4.0 · code MIT ]</span>
          <span>[ powered by GDELT · search by Algolia · thank you to arXiv ]</span>
          <Link href="/methodology" className="hover:text-ink">
            [ methodology ]
          </Link>
          <span className="text-faint">keys: 1-4 window · r real-world · d date basis · esc close</span>
        </div>
      </footer>
      <ReportDrawer selection={m.selection} rows={m.selected} windowLabel={m.windowLabel} basis={m.basis} field={m.field} onClose={() => setSelection(null)} className="font-mono" />
      <LabSwitcher current="phosphor" />
    </div>
  );
}
