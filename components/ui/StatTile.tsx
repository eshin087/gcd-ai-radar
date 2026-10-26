"use client";

import type { ReactNode } from "react";
import { DeltaChip } from "@/components/charts/DeltaChip";
import { Sparkline } from "@/components/charts/Sparkline";

interface Props {
  label: string;
  value: number;
  delta?: number | null;
  /** What the delta compares against, for its tooltip. */
  deltaTitle?: string;
  /** Plain context line (not clickable). */
  compare?: ReactNode;
  /** Clickable comparison: "<compareValue> <compareText>". */
  compareValue?: number;
  compareText?: string;
  onValue?: () => void;
  onCompare?: () => void;
  /** Trend behind the value; the last point is the current period. */
  spark?: number[];
  /** Comparison series on the same scale (faint, or dashed on a large tile). */
  sparkCompare?: number[];
  sparkSlots?: number;
  sparkColor?: string;
  /** What the trend shows, in a word or two ("monthly"). */
  sparkNote?: ReactNode;
  /** A short note after the comparison ("day 19 of 31"). */
  context?: string;
  /** Large tile: one short line under the value ("day 19 of 31"). */
  unit?: ReactNode;
  /** Large tile: the trend's first and last period, printed at its foot. */
  axis?: [string, string];
  accent?: boolean;
  className?: string;
  size?: "md" | "lg";
}

/**
 * Stat tile per the dataviz contract: sentence-case label, value in the body
 * face with proportional figures, the change as a coloured chip, an optional
 * sparkline with an end dot (the current period), and one line of context.
 * With `onValue` the value opens its incidents; with `compareValue` +
 * `onCompare` the comparison count does too.
 *
 * `size="lg"` (the trend's four tiles) is a fixed layout, so every tile puts
 * the same thing in the same place: the label, the value with its change
 * chip at the right, a unit line, the trend, and a foot row naming the
 * trend's span. The whole tile opens the value's incidents.
 */
export function StatTile(props: Props) {
  return props.size === "lg" ? <LargeTile {...props} /> : <SmallTile {...props} />;
}

function LargeTile({ label, value, delta, deltaTitle, onValue, spark, sparkCompare, sparkSlots, sparkColor = "#3a97cf", sparkNote, unit, axis, accent = false, className = "" }: Props) {
  const valueClass = `num text-[36px] font-semibold leading-none tracking-tight sm:text-[40px] ${accent ? "text-accent" : "text-ink"}`;
  return (
    <div className={`relative flex flex-col overflow-hidden transition-colors hover:border-accent/40 has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-accent ${className}`}>
      <div className="px-4 pt-3.5">
        <div className="truncate text-[13.5px] leading-5 text-soft">{label}</div>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {onValue ? (
            // stretched: its ::after covers the tile, so the whole tile opens the list
            <button type="button" onClick={onValue} className="group text-left after:absolute after:inset-0 after:content-['']" aria-label={`${label}: ${value}, open the list`}>
              <span className={`${valueClass} underline decoration-transparent decoration-dotted underline-offset-[6px] group-hover:decoration-[color:var(--color-accent)]`}>{value.toLocaleString("en-US")}</span>
            </button>
          ) : (
            <span className={valueClass}>{value.toLocaleString("en-US")}</span>
          )}
          {delta !== undefined && <DeltaChip pct={delta} title={deltaTitle} size="md" className="relative z-10" />}
        </div>
        {unit && <div className="mt-1.5 truncate text-[12.5px] leading-5 text-dim">{unit}</div>}
      </div>
      {spark && spark.length > 1 && (
        <div className="pointer-events-none mt-auto px-4 pt-3">
          <Sparkline values={spark} compare={sparkCompare} slots={sparkSlots} color={sparkColor} dot={accent ? sparkColor : "var(--color-accent)"} height={40} />
        </div>
      )}
      {axis && (
        <div className="@container flex items-center justify-between gap-2 border-t border-line-soft px-4 py-2 font-mono text-[12px] uppercase leading-4 text-dim">
          <span className="shrink-0">{axis[0]}</span>
          {sparkNote && <span className="hidden min-w-0 items-center gap-1.5 truncate text-faint @min-[9.75rem]:flex">{sparkNote}</span>}
          <span className="shrink-0">{axis[1]}</span>
        </div>
      )}
    </div>
  );
}

function SmallTile({ label, value, delta, deltaTitle, compare, compareValue, compareText, onValue, onCompare, spark, sparkCompare, sparkSlots, sparkColor = "#3a97cf", sparkNote, context, accent = false, className = "" }: Props) {
  const valueClass = `num text-[32px] font-semibold leading-none tracking-tight ${accent ? "text-accent" : "text-ink"}`;
  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      <div className="text-[12.5px] text-dim">{label}</div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {onValue ? (
          <button type="button" onClick={onValue} className="group text-left" aria-label={`${label}: ${value}, open the list`}>
            <span className={`${valueClass} underline decoration-transparent decoration-dotted underline-offset-[6px] group-hover:decoration-[color:var(--color-accent)]`}>{value.toLocaleString("en-US")}</span>
          </button>
        ) : (
          <span className={valueClass}>{value.toLocaleString("en-US")}</span>
        )}
        {delta !== undefined && <DeltaChip pct={delta} title={deltaTitle} />}
      </div>
      {spark && spark.length > 1 && (
        <div>
          <Sparkline values={spark} compare={sparkCompare} slots={sparkSlots} color={sparkColor} dot={accent ? sparkColor : "var(--color-accent)"} height={30} />
          {sparkNote && <div className="mt-1 text-right text-[12px] leading-none text-dim">{sparkNote}</div>}
        </div>
      )}
      {(compare || compareValue !== undefined) && (
        <div className="mt-auto text-[12px] leading-snug text-dim">
          {compareValue !== undefined ? (
            <button type="button" onClick={onCompare} className="text-left hover:text-ink">
              <span className="num text-soft underline decoration-dotted underline-offset-4">{compareValue.toLocaleString("en-US")}</span> {compareText}
            </button>
          ) : (
            compare
          )}
          {context && <span className="whitespace-nowrap text-faint"> · {context}</span>}
        </div>
      )}
    </div>
  );
}
