"use client";

import { CountUp } from "@/components/fx/CountUp";
import { brailleSpark } from "@/components/fx/text";
import { formatPct } from "@/lib/format";

/**
 * Stat tile per the dataviz contract: sentence-case label, value in the body
 * face with proportional figures, signed delta vs a named period, optional
 * 12-point braille sparkline.
 */
export function LabTile({
  label,
  value,
  delta,
  compare,
  spark,
  accent = false,
  className = "",
  size = "md",
}: {
  label: string;
  value: number;
  delta?: number | null;
  compare?: string;
  spark?: number[];
  accent?: boolean;
  className?: string;
  size?: "md" | "lg";
}) {
  const tone = delta === undefined ? "" : delta === null || delta > 0.5 ? "text-sev-3" : delta < -0.5 ? "text-type-by" : "text-dim";
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="text-[12.5px] text-dim">{label}</div>
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <CountUp value={value} className={`${size === "lg" ? "text-5xl" : "text-[34px]"} font-semibold leading-none tracking-tight ${accent ? "text-accent" : "text-ink"}`} />
        {delta !== undefined && <span className={`num text-[13px] ${tone}`}>{formatPct(delta)}</span>}
      </div>
      {(compare || spark) && (
        <div className="flex items-center justify-between gap-3 text-[12px] text-dim">
          {compare && <span>{compare}</span>}
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
