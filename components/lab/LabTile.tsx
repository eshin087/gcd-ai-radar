"use client";

import { CountUp } from "@/components/fx/CountUp";
import { brailleSpark } from "@/components/fx/text";
import { formatPct } from "@/lib/format";

/**
 * Stat tile per the dataviz contract: sentence-case label, value in the body
 * face with proportional figures, signed delta vs a named period, optional
 * 12-point braille sparkline. With `onValue` the value opens its incidents;
 * with `compareValue` + `onCompare` the comparison count does too.
 */
export function LabTile({
  label,
  value,
  delta,
  compare,
  compareValue,
  compareText,
  onValue,
  onCompare,
  spark,
  accent = false,
  className = "",
  size = "md",
}: {
  label: string;
  value: number;
  delta?: number | null;
  /** Plain comparison line (not clickable). */
  compare?: string;
  /** Clickable comparison: "<compareValue> <compareText>". */
  compareValue?: number;
  compareText?: string;
  onValue?: () => void;
  onCompare?: () => void;
  spark?: number[];
  accent?: boolean;
  className?: string;
  size?: "md" | "lg";
}) {
  const tone = delta === undefined ? "" : delta === null || delta > 0.5 ? "text-sev-3" : delta < -0.5 ? "text-type-by" : "text-dim";
  const valueClass = `${size === "lg" ? "text-5xl" : "text-[34px]"} font-semibold leading-none tracking-tight ${accent ? "text-accent" : "text-ink"}`;
  return (
    <div className={`flex flex-col justify-between gap-2 ${className}`}>
      <div className="text-[12.5px] text-dim">{label}</div>
      <div className="flex flex-wrap items-baseline gap-2.5">
        {onValue ? (
          <button type="button" onClick={onValue} className="group text-left" aria-label={`${label}: ${value} incidents, open the list`}>
            <CountUp value={value} className={`${valueClass} underline decoration-transparent decoration-dotted underline-offset-[6px] group-hover:decoration-[color:var(--color-accent)]`} />
          </button>
        ) : (
          <CountUp value={value} className={valueClass} />
        )}
        {delta !== undefined && <span className={`num text-[13px] ${tone}`}>{formatPct(delta)}</span>}
      </div>
      {(compare || compareValue !== undefined || spark) && (
        <div className="flex items-center justify-between gap-3 text-[12px] text-dim">
          {compareValue !== undefined ? (
            <button type="button" onClick={onCompare} className="text-left hover:text-ink">
              <span className="num text-soft underline decoration-dotted underline-offset-4">{compareValue.toLocaleString("en-US")}</span> {compareText}
            </button>
          ) : (
            compare && <span>{compare}</span>
          )}
          {spark && (
            <span aria-hidden className="font-mono text-[13px] tracking-tight text-soft">
              {brailleSpark(spark)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
