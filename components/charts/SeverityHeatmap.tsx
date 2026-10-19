"use client";

import { FAMILY_META, type Family } from "@/lib/families";
import { SEVERITIES, SEVERITY_META, type Severity } from "@/lib/taxonomy";
import type { ChartTheme } from "@/lib/theme";
import { heat } from "./hooks";

interface Props {
  families: Family[];
  counts: Record<Family, Record<Severity, number>>;
  theme: ChartTheme;
  onCell?: (f: Family, s: Severity) => void;
  onFamily?: (f: Family) => void;
  onSeverity?: (s: Severity) => void;
  active?: { family: Family; severity: Severity } | null;
}

/**
 * Family by severity as a heatmap: every cell is a count on a sequential
 * accent ramp, so the eye finds where confirmed loss concentrates. Cells,
 * row totals and column totals all open their incidents.
 */
export function SeverityHeatmap({ families, counts, theme, onCell, onFamily, onSeverity, active = null }: Props) {
  const max = Math.max(1, ...families.flatMap((f) => SEVERITIES.map((s) => counts[f][s])));
  const rowTotal = (f: Family) => SEVERITIES.reduce((a, s) => a + counts[f][s], 0);
  const colTotal = (s: Severity) => families.reduce((a, f) => a + counts[f][s], 0);
  const cols = `minmax(6rem,1.6fr) repeat(${SEVERITIES.length}, minmax(2rem,1fr)) 2.4rem`;
  return (
    <div className="min-w-0 space-y-1 overflow-x-auto" role="table" aria-label="Incidents by family and severity">
      <div className="grid items-end gap-1 px-1 text-[10.5px] text-dim" style={{ gridTemplateColumns: cols }} role="row">
        <span />
        {SEVERITIES.map((s) => (
          <span key={s} className="num text-center text-[12px] leading-tight text-ink" role="columnheader" title={`${s} · ${SEVERITY_META[s].label}: ${SEVERITY_META[s].definition}`}>
            {s}
          </span>
        ))}
        <span className="text-right" role="columnheader">
          all
        </span>
      </div>
      {families.map((f) => (
        <div key={f} className="grid items-center gap-1" style={{ gridTemplateColumns: cols }} role="row">
          <button type="button" onClick={() => onFamily?.(f)} className="flex min-w-0 items-center gap-1.5 text-left text-[12px] text-soft hover:text-ink" aria-label={`${FAMILY_META[f].label}: ${rowTotal(f)} incidents`}>
            <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: theme.families[f] }} />
            <span className="truncate">{FAMILY_META[f].short}</span>
          </button>
          {SEVERITIES.map((s) => {
            const v = counts[f][s];
            const style = heat(v, max);
            const on = active?.family === f && active.severity === s;
            return (
              <button
                key={s}
                type="button"
                disabled={v === 0}
                onClick={() => onCell?.(f, s)}
                aria-label={`${FAMILY_META[f].label}, severity ${s}: ${v} incidents`}
                className={`num h-8 rounded-[3px] text-[12.5px] transition-transform ${v > 0 ? "hover:scale-[1.04]" : "cursor-default"} ${on ? "ring-2 ring-accent" : ""}`}
                style={style}
                role="cell"
              >
                {v > 0 ? v : ""}
              </button>
            );
          })}
          <button type="button" onClick={() => onFamily?.(f)} className="num text-right text-[12.5px] text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent" aria-label={`${FAMILY_META[f].label}: ${rowTotal(f)} incidents`} role="cell">
            {rowTotal(f)}
          </button>
        </div>
      ))}
      <div className="grid items-center gap-1 border-t border-line-soft pt-1" style={{ gridTemplateColumns: cols }} role="row">
        <span className="text-[11px] text-dim">all</span>
        {SEVERITIES.map((s) => (
          <button key={s} type="button" onClick={() => onSeverity?.(s)} className="num text-center text-[12.5px] text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent" aria-label={`Severity ${s}: ${colTotal(s)} incidents`} role="cell">
            {colTotal(s)}
          </button>
        ))}
        <span className="num text-right text-[12.5px] text-dim">{families.reduce((a, f) => a + rowTotal(f), 0)}</span>
      </div>
      <p className="num pt-1 text-[10.5px] text-faint">{SEVERITIES.map((s) => `${s} ${SEVERITY_META[s].short.toLowerCase()}`).join(" · ")}</p>
    </div>
  );
}
