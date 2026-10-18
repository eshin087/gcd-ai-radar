"use client";

import { useState } from "react";
import { FAMILIES, FAMILY_META, type Family } from "@/lib/families";
import { monthLabel } from "@/lib/format";
import type { LabTheme } from "@/lib/lab/themes";
import type { FamilyPoint } from "../useDashboardModel";

function niceMax(v: number): number {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 5 ? 5 : f <= 7.5 ? 7.5 : 10) * p;
}

/**
 * One panel per category family. Each panel has its own vertical scale, with
 * its gridlines labelled, so a family with a few incidents a month reads as
 * clearly as one with a hundred: compare totals by the big numbers, shapes by
 * the bars. The total opens the family's incidents; a column opens that month.
 */
export function FamilyMultiples({
  data,
  theme,
  onFamily,
  onMonth,
  windowTotal,
}: {
  data: FamilyPoint[];
  theme: LabTheme;
  onFamily?: (f: Family) => void;
  onMonth?: (month: string, f: Family) => void;
  /** All incidents in view, for each family's share. */
  windowTotal: number;
}) {
  const n = data.length;
  const families = FAMILIES.filter((f) => f !== "other" || data.some((p) => p.values.other > 0));
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {families.map((f) => (
        <FamilyCard key={f} f={f} data={data} n={n} theme={theme} onFamily={onFamily} onMonth={onMonth} windowTotal={windowTotal} />
      ))}
    </div>
  );
}

function FamilyCard({
  f,
  data,
  n,
  theme,
  onFamily,
  onMonth,
  windowTotal,
}: {
  f: Family;
  data: FamilyPoint[];
  n: number;
  theme: LabTheme;
  onFamily?: (f: Family) => void;
  onMonth?: (month: string, f: Family) => void;
  windowTotal: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = data.map((p) => p.values[f]);
  const total = vals.reduce((a, b) => a + b, 0);
  const top = niceMax(Math.max(1, ...vals));
  const peakAt = vals.indexOf(Math.max(...vals));
  const share = windowTotal > 0 ? (total / windowTotal) * 100 : 0;
  const color = theme.families[f];
  const W = 240;
  const H = 76;
  const bw = W / Math.max(1, n);
  const shown = hover ?? null;
  return (
    <div className="glass flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
          <span className="truncate text-[13px] text-ink">{FAMILY_META[f].label}</span>
        </span>
        <span className="num shrink-0 text-[11.5px] text-dim">{share < 1 && share > 0 ? "<1" : Math.round(share)}% of all</span>
      </div>
      <button
        type="button"
        onClick={() => onFamily?.(f)}
        className="group flex items-baseline gap-2 self-start text-left"
        aria-label={`${FAMILY_META[f].label}: ${total} incidents`}
      >
        <span className="text-[30px] font-semibold leading-none tracking-tight text-ink underline decoration-transparent decoration-dotted underline-offset-[6px] group-hover:decoration-[color:var(--color-accent)]">
          {total.toLocaleString("en-US")}
        </span>
        <span className="text-[12px] text-dim group-hover:text-accent">incidents →</span>
      </button>
      <div className="relative pr-7">
        {/* gridline labels in a right gutter: this panel's own scale */}
        <div aria-hidden className="num pointer-events-none absolute -top-1 right-0 text-[10px] leading-none text-faint">
          {top}
        </div>
        <div aria-hidden className="num pointer-events-none absolute right-0 text-[10px] leading-none text-faint" style={{ top: H / 2 - 5 }}>
          {top / 2}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[76px] w-full" role="img" aria-label={`${FAMILY_META[f].label} per month, own scale up to ${top}`}>
          <line x1={0} x2={W} y1={0.5} y2={0.5} stroke={theme.grid} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke={theme.grid} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke={theme.grid} vectorEffect="non-scaling-stroke" />
          {vals.map((v, i) => {
            const h = v > 0 ? Math.max(3, (v / top) * (H - 2)) : 0;
            const on = hover === i;
            return (
              <g key={i}>
                <rect
                  x={i * bw}
                  y={0}
                  width={bw}
                  height={H}
                  fill={on ? "rgba(160,180,220,0.08)" : "transparent"}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onMonth?.(data[i]!.month, f)}
                />
                {v > 0 ? (
                  <rect
                    x={i * bw + bw * 0.16}
                    y={H - h}
                    width={bw * 0.68}
                    height={h}
                    rx={1.2}
                    fill={color}
                    opacity={on ? 1 : 0.88}
                    pointerEvents="none"
                  />
                ) : (
                  <rect x={i * bw + bw * 0.3} y={H - 1.5} width={bw * 0.4} height={1.5} fill={theme.grid} pointerEvents="none" />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="num flex items-baseline justify-between text-[11px] text-faint">
        <span>{data[0] ? monthLabel(data[0].month) : ""}</span>
        <span className={shown !== null ? "text-ink" : ""}>
          {shown !== null ? `${monthLabel(data[shown]!.month)} · ${vals[shown]}` : vals[peakAt]! > 0 ? `peak ${vals[peakAt]} · ${monthLabel(data[peakAt]!.month)}` : "none in view"}
        </span>
        <span>{data[n - 1] ? monthLabel(data[n - 1]!.month) : ""}</span>
      </div>
    </div>
  );
}
