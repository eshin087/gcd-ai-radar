"use client";

import { useRef } from "react";
import { useReducedMotion } from "@/components/fx/useReducedMotion";
import { FAMILY_META, type Family } from "@/lib/families";
import { pctChange } from "@/lib/stats";
import type { ChartTheme } from "@/lib/theme";
import { DeltaChip } from "./DeltaChip";
import { FALL, RISE, niceStep, useShown } from "./hooks";

export interface DumbbellRow {
  key: Family;
  now: number;
  prior: number;
}

interface Props {
  rows: DumbbellRow[];
  theme: ChartTheme;
  /** "24 months before", "last 24 months". */
  priorLabel: string;
  nowLabel: string;
  onNow?: (f: Family) => void;
  onPrior?: (f: Family) => void;
  active?: Family | null;
  label: string;
}

/** Room kept clear at both ends of a track for the end labels, so no count ever leaves the panel. */
const END = "2.9rem";

/**
 * Dumbbells: per family a hollow dot at the window before and a filled dot
 * at this window, joined by a bar warm when the count rose and cool when it
 * fell, largest change first. Counts sit outside both ends, the change at
 * the right; a light axis underneath. The earlier count opens that window's
 * incidents of the family, the current count (or the bar) this window's.
 * Narrow panels put the name above the track.
 */
export function FamilyDumbbell({ rows, theme, priorLabel, nowLabel, onNow, onPrior, active = null, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useShown(ref, 0.2);
  const reduced = useReducedMotion();
  const on = shown || reduced;
  const sorted = [...rows].filter((r) => r.now > 0 || r.prior > 0).sort((a, b) => Math.abs(b.now - b.prior) - Math.abs(a.now - a.prior) || b.now - a.now);
  const maxVal = Math.max(1, ...sorted.map((r) => Math.max(r.now, r.prior)));
  const step = niceStep(maxVal / 4);
  const max = step * Math.ceil(maxVal / step);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, k) => k * step);
  const pct = (v: number) => `${(v / max) * 100}%`;
  const grid = "grid-cols-[minmax(0,1fr)_auto] @md:grid-cols-[minmax(0,8.75rem)_minmax(0,1fr)_5rem]";

  const gridlines = (
    <span aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: END, right: END }}>
      {ticks.map((t) => (
        <span key={t} className="absolute inset-y-0 w-px bg-line-soft" style={{ left: pct(t) }} />
      ))}
    </span>
  );

  return (
    <div ref={ref} data-chart="dumbbell" className="@container" role="group" aria-label={label}>
      {/* a heading row the height of the families list's, so the rows of the two panels line up */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft pb-2 text-[12px] text-dim @md:h-8 @md:items-end">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-full border-[1.5px] border-dim" /> {priorLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-full bg-soft" /> {nowLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: RISE }} /> rose
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: FALL }} /> fell
        </span>
      </div>
      <ul>
        {sorted.map((r, k) => {
          const up = r.now > r.prior;
          const flat = r.now === r.prior;
          const tone = flat ? theme.dim : up ? RISE : FALL;
          const lo = Math.min(r.now, r.prior);
          const hi = Math.max(r.now, r.prior);
          // counts outside the ends: the lower value's label to its left, the higher one's to its right
          const nowLeft = r.now < r.prior;
          const isOn = active === r.key;
          const delay = `${120 + k * 70}ms`;
          return (
            <li key={r.key} className={`group/row grid items-center gap-x-3 rounded-[3px] border-t border-line-soft px-1 transition-colors first:border-t-0 hover:bg-panel-2/60 @md:h-11 ${grid} ${isOn ? "bg-accent-tint" : ""}`}>
              <span className="flex min-w-0 items-center gap-2 pt-2 text-[14.5px] text-ink @md:pt-0" title={FAMILY_META[r.key].label}>
                <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: theme.families[r.key] }} />
                <span className="truncate">{FAMILY_META[r.key].short}</span>
              </span>
              <span className="flex justify-end pt-2 @md:order-last @md:pt-0">
                <DeltaChip size="md" pct={pctChange(r.now, r.prior)} title={`${r.now} in the ${nowLabel} against ${r.prior} in the ${priorLabel}`} />
              </span>
              <div className="relative col-span-2 h-10 @md:col-span-1">
                {gridlines}
                <div className="absolute inset-y-0" style={{ left: END, right: END }}>
                  {/* the bar: a button too, since every bar opens what it shows */}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    onClick={() => onNow?.(r.key)}
                    className="absolute top-1/2 h-3 -translate-y-1/2 cursor-pointer"
                    style={{ left: pct(lo), width: `calc(${pct(hi - lo)} + 1px)` }}
                  >
                    <span
                      className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
                      style={{
                        background: flat ? tone : `linear-gradient(${up ? "90deg" : "270deg"}, color-mix(in oklab, ${tone} 25%, transparent), ${tone})`,
                        boxShadow: flat ? undefined : `0 0 10px color-mix(in oklab, ${tone} 45%, transparent)`,
                        transform: on ? "scaleX(1)" : "scaleX(0)",
                        transformOrigin: up ? "left" : "right",
                        transition: reduced ? "none" : `transform 800ms cubic-bezier(.16,1,.3,1) ${delay}`,
                      }}
                    />
                  </button>
                  {/* before: hollow */}
                  <span aria-hidden className="pointer-events-none absolute top-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-dim" style={{ left: pct(r.prior), background: theme.surface }} />
                  {/* now: filled, ringed in the surface so it reads over the bar */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 size-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      left: on ? pct(r.now) : pct(r.prior),
                      background: tone,
                      boxShadow: `0 0 0 2px ${theme.surface}, 0 0 10px color-mix(in oklab, ${tone} 55%, transparent)`,
                      transition: reduced ? "none" : `left 800ms cubic-bezier(.16,1,.3,1) ${delay}`,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => onPrior?.(r.key)}
                    aria-label={`${FAMILY_META[r.key].label} in the ${priorLabel}: ${r.prior} incidents`}
                    title={`${FAMILY_META[r.key].label}, ${priorLabel}`}
                    className="num absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[13px] text-soft underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-ink"
                    style={nowLeft ? { left: `calc(${pct(r.prior)} + 11px)` } : { right: `calc(${pct(max - r.prior)} + 11px)` }}
                  >
                    {r.prior.toLocaleString("en-US")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onNow?.(r.key)}
                    aria-label={`${FAMILY_META[r.key].label}: ${r.now} incidents`}
                    title={`${FAMILY_META[r.key].label}, ${nowLabel}`}
                    className={`num absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[14.5px] font-medium underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent ${isOn ? "text-accent" : "text-ink"}`}
                    style={nowLeft ? { right: `calc(${pct(max - r.now)} + 12px)` } : { left: `calc(${pct(r.now)} + 12px)` }}
                  >
                    {r.now.toLocaleString("en-US")}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {/* the axis, under the tracks */}
      <div aria-hidden className={`mt-1 grid gap-x-3 px-1 ${grid}`}>
        <span className="hidden @md:block" />
        <div className="relative col-span-2 h-6 border-t border-line @md:col-span-1">
          <div className="absolute inset-y-0" style={{ left: END, right: END }}>
            {ticks.map((t) => (
              <span key={t} className="num absolute top-1 -translate-x-1/2 text-[12px] text-dim" style={{ left: pct(t) }}>
                {t.toLocaleString("en-US")}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
