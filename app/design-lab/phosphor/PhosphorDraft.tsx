"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { DrillDown } from "@/components/dashboard/DrillDown";
import { CountUp } from "@/components/fx/CountUp";
import { GlyphImage } from "@/components/fx/GlyphImage";
import { NextSweep } from "@/components/fx/NextSweep";
import { Reveal } from "@/components/fx/Reveal";
import { Typewriter, type TypeLine } from "@/components/fx/Typewriter";
import { Banner } from "@/components/fx/Banner";
import { SHADE, brailleSpark } from "@/components/fx/text";
import { AsciiColumns } from "@/components/lab/charts/AsciiColumns";
import { AsciiRows } from "@/components/lab/charts/AsciiRows";
import { useDashboardModel, type WindowKey } from "@/components/lab/useDashboardModel";
import type { DashboardData } from "@/lib/dashboard";
import { FAMILIES, FAMILY_META, familyOf, type Family } from "@/lib/families";
import { formatPct, monthLabel } from "@/lib/format";
import { NAV, SITE, WINDOW_CHOICES } from "@/lib/site";
import { pctChange } from "@/lib/stats";
import { SEVERITY_META, TARGET_META, TYPE_META, type IncidentType, type Severity, type Target } from "@/lib/taxonomy";
import { LabSwitcher } from "../LabSwitcher";

const WINDOWS: WindowKey[] = [...WINDOW_CHOICES.map((w) => `${w}m` as WindowKey), "all"];

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

function Readout({ label, value, note, spark, highlight = false }: { label: string; value: React.ReactNode; note?: React.ReactNode; spark?: number[]; highlight?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
      <span className="text-soft">{label}</span>
      <span aria-hidden className="min-w-0 flex-1 overflow-hidden text-faint">
        {".".repeat(120)}
      </span>
      <span className={highlight ? "text-accent" : "text-ink phosphor-glow"}>{value}</span>
      {note && <span className="hidden w-28 text-right text-dim sm:inline">{note}</span>}
      {spark && (
        <span aria-hidden className="hidden w-[7.5rem] text-dim lg:inline">
          {brailleSpark(spark)}
        </span>
      )}
    </div>
  );
}

export function PhosphorDraft({ data }: { data: DashboardData }) {
  const m = useDashboardModel(data);
  const { setWin, setBasis, setField, setSelection } = m;
  const totals = m.series.map((p) => p.total);
  const delta = m.priorCount === null ? undefined : pctChange(m.rows.length, m.priorCount);
  const sources = data.rows.reduce((s, r) => s + r.source_count, 0);

  // keyboard: 1-4 window, r real-world, d date basis, esc close report
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) setWin(WINDOWS[idx]!);
      else if (e.key === "r") setBasis((b) => (b === "all" ? "real" : "all"));
      else if (e.key === "d") setField((f) => (f === "incident_date" ? "first_reported" : "incident_date"));
      else if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setWin, setBasis, setField, setSelection]);

  const boot: TypeLine[] = useMemo(
    () => [
      { text: "$ gcdairadar sweep --window 24m --dedupe", className: "text-soft", pause: 300 },
      { text: `[ ok ] ${data.rows.length.toLocaleString("en-US")} incidents on record from ${sources.toLocaleString("en-US")} sources`, className: "text-ink" },
      { text: `[ ok ] dedupe: one event, many sources → counted once`, className: "text-ink" },
      { text: `[ ok ] last sweep ${data.lastUpdated ? data.lastUpdated.slice(0, 16).replace("T", " ") + "Z" : "pending"} · schedule */6h`, className: "text-ink" },
      { text: "[ !! ] last 60 days provisional (reporting lag)", className: "text-accent" },
    ],
    [data.rows.length, data.lastUpdated, sources],
  );

  const familySpark = (f: Family) => m.fam.map((p) => p.values[f]);
  const typeSpark = (t: IncidentType) => m.series.map((p) => p.byType[t]);
  const active = m.selection;

  return (
    <div className="lab-root lab-phosphor crt">
      {/* title bar */}
      <div className="border-b border-line bg-panel">
        <div className="mx-auto flex h-9 max-w-7xl items-center gap-4 overflow-hidden whitespace-nowrap px-4 text-[12px]">
          <span className="text-accent">●</span>
          <span className="text-soft">gcdairadar — tty1</span>
          <span className="hidden text-dim sm:inline">
            next sweep <NextSweep className="text-ink" />
          </span>
          <nav aria-label="Primary" className="ml-auto flex items-center gap-3">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-dim hover:text-ink">
                [{n.label.toLowerCase()}]
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-10 px-4 py-8">
        <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            <div className="overflow-hidden" style={{ fontSize: "clamp(5px, 0.98vw, 11.5px)" }}>
              <Banner text="gcd ai radar" className="phosphor-glow text-ink" />
            </div>
            <h1 className="sr-only">{SITE.tagline}</h1>
            <Typewriter lines={boot} storageKey="lab-phosphor-boot" cps={110} className="space-y-0.5 text-[13px]" />
            <div className="text-[13px]">
              <span className="text-dim">$ </span>
              <span className="text-soft">_</span>
              <span className="cursor" aria-hidden />
            </div>
          </div>
          <figure className="tty">
            <figcaption className="tty-title">┤ fig.0 · deep-space dish // live ascii ├</figcaption>
            <GlyphImage src="/art/dish.json" tint="#9dffbf" tint2="#0b2a16" minCell={5} mode="x" threshold={0.07} gain={1.6} label="ASCII rendering of a radar dish at night" />
          </figure>
        </section>

        {/* command flags: the one filter row */}
        <div className="tty sticky top-0 z-30 bg-ground/95 text-[13px] backdrop-blur">
          <span className="tty-title">┤ query ├</span>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-dim">$ radar</span>
            <Flag name="set" value={m.basis} onChange={(k) => m.setBasis(k as "all" | "real")} options={[{ key: "all", label: "all" }, { key: "real", label: "real-world" }]} hint="r" />
            <Flag name="by" value={m.field} onChange={(k) => m.setField(k as typeof m.field)} options={[{ key: "incident_date", label: "incident" }, { key: "first_reported", label: "reported" }]} hint="d" />
            <Flag name="window" value={m.win} onChange={(k) => m.setWin(k as WindowKey)} options={WINDOWS.map((w) => ({ key: w, label: w }))} hint="1-4" />
          </div>
        </div>

        <Reveal>
          <section className="tty text-[13px]">
            <span className="tty-title">┤ readout · {m.windowLabel} ├</span>
            <div className="grid grid-cols-1 gap-x-10 gap-y-1.5 lg:grid-cols-2">
              <Readout
                label={m.basis === "real" ? "REAL-WORLD INCIDENTS" : "INCIDENTS"}
                value={<CountUp value={m.rows.length} />}
                note={delta !== undefined ? `${formatPct(delta)} vs prior` : undefined}
                spark={totals}
              />
              <Readout label="REAL-WORLD (SEV 3-4)" value={<CountUp value={m.realInWindow} />} highlight note="confirmed" />
              <Readout label={`${monthLabel(m.h.thisMonthKey).toUpperCase()} SO FAR`} value={<CountUp value={m.h.thisMonth} />} note={`${formatPct(m.h.monthDeltaPct)} vs ${monthLabel(m.h.lastMonthKey)}`} />
              <Readout label="TRAILING 12 MONTHS" value={<CountUp value={m.h.trailing12} />} note={`${formatPct(m.h.trailingDeltaPct)} vs prior 12`} spark={totals.slice(-12)} />
              <Readout label="YEAR TO DATE" value={<CountUp value={m.h.yearToDate} />} note={`${formatPct(m.h.yoyPct)} vs last yr`} />
              <Readout label="TREND (LINEAR FIT)" value={`${m.slope >= 0 ? "+" : ""}${m.slope.toFixed(2)}/mo`} note="over window" />
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section className="tty">
            <span className="tty-title">┤ {m.basis === "real" ? "real-world incidents" : "incidents"} / month · by {m.fieldLabel} ├</span>
            <AsciiColumns data={m.trend} provisionalFrom={m.h.provisionalFrom} activeMonth={active?.kind === "month" ? active.month : null} onPick={(month) => m.setSelection({ kind: "month", month })} />
            <p className="mt-2 text-[12px] text-dim">
              █ incidents · <span className="text-accent">•</span> 3-month average · dim columns are provisional · each column is clickable
            </p>
          </section>
        </Reveal>

        <div className="grid gap-8 lg:grid-cols-2">
          <Reveal>
            <section className="tty">
              <span className="tty-title">┤ by family ├</span>
              <AsciiRows
                rows={FAMILIES.map((f) => ({ key: f, label: FAMILY_META[f].short, value: m.families.find((x) => x.key === f)?.count ?? 0, spark: familySpark(f) })).filter((r) => r.value > 0 || r.key !== "other")}
                active={active?.kind === "family" ? active.family : null}
                onPick={(k) => m.setSelection({ kind: "family", family: k as Family })}
                labelWidth={16}
              />
            </section>
          </Reveal>
          <Reveal delay={80}>
            <section className="tty">
              <span className="tty-title">┤ targets ├</span>
              <AsciiRows
                rows={m.targets
                  .filter((t) => t.count > 0)
                  .slice(0, 8)
                  .map((t) => ({ key: t.key, label: TARGET_META[t.key].label, value: t.count }))}
                active={active?.kind === "target" ? active.target : null}
                onPick={(k) => m.setSelection({ kind: "target", target: k as Target })}
                labelWidth={22}
              />
            </section>
          </Reveal>
          <Reveal>
            <section className="tty">
              <span className="tty-title">┤ on AI · by AI ├</span>
              <AsciiRows
                rows={m.types.map((t) => ({ key: t.key, label: TYPE_META[t.key].label, value: t.count, spark: typeSpark(t.key) }))}
                labelWidth={20}
              />
              <p className="mt-2 text-[12px] text-dim">attacks on AI systems vs attacks that used AI</p>
            </section>
          </Reveal>
          <Reveal delay={80}>
            <section className="tty">
              <span className="tty-title">┤ severity ├</span>
              <AsciiRows
                rows={[...m.severities].reverse().map((s) => ({ key: s.key, mark: SHADE[Number(s.key) as Severity], label: `${s.key} ${SEVERITY_META[Number(s.key) as Severity].short}`, value: s.count }))}
                active={active?.kind === "severity" ? String(active.severity) : null}
                onPick={(k) => m.setSelection({ kind: "severity", severity: Number(k) as Severity })}
                labelWidth={14}
              />
              <p className="mt-2 text-[12px] text-dim">░ research · ▒ disclosed · ▓ exploited · █ real-world loss</p>
            </section>
          </Reveal>
        </div>

        {m.selection && (
          <DrillDown key={JSON.stringify(m.selection)} selection={m.selection} rows={m.selected} windowLabel={m.windowLabel} basis={m.basis} field={m.field} onClose={() => m.setSelection(null)} />
        )}

        <Reveal>
          <section className="tty text-[13px]">
            <span className="tty-title">┤ tail -f incidents.log ├</span>
            <ol className="space-y-1">
              {[...m.latestRows].reverse().map((r) => (
                <li key={r.id} className="flex gap-3 whitespace-nowrap">
                  <span className="text-dim">{r.first_reported}</span>
                  <span className="text-accent">{SHADE[r.severity]}</span>
                  <span className="hidden w-28 truncate text-dim sm:inline">{FAMILY_META[familyOf(r.categories[0] ?? "other")].short}</span>
                  <Link href={`/incidents/${r.slug}`} className="truncate text-ink hover:text-accent">
                    {r.title}
                  </Link>
                </li>
              ))}
              <li>
                <span className="text-dim">$ </span>
                <span className="cursor" aria-hidden />
              </li>
            </ol>
          </section>
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
      <LabSwitcher current="phosphor" />
    </div>
  );
}
