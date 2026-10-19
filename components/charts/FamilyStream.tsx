"use client";

import { useState } from "react";
import type { FamilyPoint } from "@/components/dashboard/useDashboardModel";
import { useReducedMotion } from "@/components/fx/useReducedMotion";
import { FAMILIES, FAMILY_META, type Family } from "@/lib/families";
import { monthLabel } from "@/lib/format";
import type { ChartTheme } from "@/lib/theme";
import { useShown, useWidth } from "./hooks";
import { bandPath, type Pt } from "./path";

interface Props {
  data: FamilyPoint[];
  /** Each family's count in the window, for the legend. */
  totals: Record<Family, number>;
  theme: ChartTheme;
  provisionalFrom?: string;
  height?: number;
  onFamily?: (f: Family) => void;
  onMonth?: (month: string, f: Family) => void;
  activeFamily?: Family | null;
  label: string;
}

const PAD = { l: 6, r: 6, t: 14, b: 26 };

/**
 * Streamgraph of the families month by month: one band per family, stacked
 * around a centred baseline so the whole stream shows the volume while the
 * bands show the mix. Hovering a band names its family and month; a click
 * opens that family's incidents of that month; the legend's counts open the
 * family in the window. Draws in from the left when it scrolls into view.
 */
export function FamilyStream({ data, totals, theme, provisionalFrom, height = 300, onFamily, onMonth, activeFamily = null, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const shown = useShown(ref);
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<{ i: number; f: Family | null } | null>(null);
  const [legendHover, setLegendHover] = useState<Family | null>(null);

  const n = data.length;
  const families = FAMILIES.filter((f) => f !== "other" || totals.other > 0 || data.some((p) => p.values.other > 0));
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = height - PAD.t - PAD.b;
  const maxTotal = Math.max(1, ...data.map((p) => p.total));
  const scale = plotH / maxTotal;
  const x = (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.t + plotH - v * scale;

  // stacked offsets per month: bottom of the stack sits at (max - total) / 2 so the stream is centred
  const layers = new Map<Family, { top: Pt[]; bottom: Pt[] }>();
  const acc = data.map((p) => (maxTotal - p.total) / 2);
  for (const f of families) {
    const bottom: Pt[] = [];
    const top: Pt[] = [];
    for (let i = 0; i < data.length; i++) {
      const b = acc[i]!;
      const t = b + data[i]!.values[f];
      bottom.push([x(i), y(b)]);
      top.push([x(i), y(t)]);
      acc[i] = t;
    }
    layers.set(f, { top, bottom });
  }

  const provIdx = provisionalFrom ? data.findIndex((p) => p.month >= provisionalFrom) : -1;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, plotW / 62)));
  const lit = legendHover ?? hover?.f ?? activeFamily;

  const locate = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / Math.max(1, plotW)) * (n - 1))));
    let f: Family | null = null;
    for (const fam of families) {
      const l = layers.get(fam)!;
      if (py <= l.bottom[i]![1] && py >= l.top[i]![1] && data[i]!.values[fam] > 0) {
        f = fam;
        break;
      }
    }
    return { i, f };
  };

  const tip = hover ? data[hover.i]! : null;
  const tipLeft = hover ? Math.min(Math.max(x(hover.i) - 95, 0), width - 190) : 0;

  return (
    <div className="space-y-3">
      <div ref={ref} className="relative w-full select-none" style={{ height }}>
        <svg width={width} height={height} role="img" aria-label={label} className="absolute inset-0 block overflow-visible" onMouseMove={(e) => setHover(locate(e))} onMouseLeave={() => setHover(null)} onClick={(e) => {
          const at = locate(e);
          if (at.f) onMonth?.(data[at.i]!.month, at.f);
        }}>
          <defs>
            <clipPath id="stream-clip" clipPathUnits="userSpaceOnUse">
              <rect x={0} y={0} width={width} height={height} style={{ transform: shown || reduced ? "scaleX(1)" : "scaleX(0)", transformOrigin: "0 0", transition: reduced ? "none" : "transform 1500ms cubic-bezier(.3,.6,.2,1)" }} />
            </clipPath>
          </defs>
          {/* centre line and provisional band */}
          <line x1={PAD.l} x2={PAD.l + plotW} y1={PAD.t + plotH / 2} y2={PAD.t + plotH / 2} stroke={theme.grid} strokeDasharray="2 4" />
          {provIdx >= 0 && (
            <g aria-hidden>
              <rect x={x(provIdx) - (n > 1 ? plotW / (n - 1) / 2 : 0)} y={PAD.t} width={PAD.l + plotW - x(provIdx) + (n > 1 ? plotW / (n - 1) / 2 : 0)} height={plotH} fill={theme.provisional} />
              <text x={PAD.l + plotW - 2} y={PAD.t + 10} textAnchor="end" fontSize={10} fill={theme.dim} className="num">
                provisional
              </text>
            </g>
          )}
          <g clipPath="url(#stream-clip)">
            {families.map((f) => {
              const l = layers.get(f)!;
              const dimmed = lit !== null && lit !== f;
              return (
                <path
                  key={f}
                  d={bandPath(l.top, l.bottom)}
                  fill={theme.families[f]}
                  fillOpacity={dimmed ? 0.22 : 0.86}
                  stroke={theme.surface}
                  strokeWidth={0.8}
                  className={onMonth ? "cursor-pointer" : undefined}
                  style={{ transition: "fill-opacity 180ms" }}
                />
              );
            })}
          </g>
          {/* hover guide */}
          {hover && <line x1={x(hover.i)} x2={x(hover.i)} y1={PAD.t} y2={PAD.t + plotH} stroke={theme.ink} strokeOpacity={0.35} pointerEvents="none" />}
          {/* x labels */}
          {data.map((p, i) =>
            (n - 1 - i) % labelEvery === 0 ? (
              <text key={p.month} x={Math.min(Math.max(x(i), PAD.l + 18), PAD.l + plotW - 18)} y={height - 8} textAnchor="middle" fontSize={11} fill={theme.axis} className="num">
                {monthLabel(p.month)}
              </text>
            ) : null,
          )}
        </svg>
        {tip && (
          <div className="pointer-events-none absolute top-0 z-10 w-[190px] rounded-[4px] border border-line bg-panel/95 p-2.5 text-[12px] shadow-xl backdrop-blur" style={{ left: tipLeft }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-soft">{monthLabel(tip.month, true)}</span>
              <span className="num text-[14px] font-semibold text-ink">{tip.total}</span>
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {families
                .map((f) => ({ f, v: tip.values[f] }))
                .filter((e) => e.v > 0)
                .sort((a, b) => b.v - a.v)
                .map(({ f, v }) => (
                  <li key={f} className={`flex items-center justify-between gap-2 ${hover?.f === f ? "text-ink" : "text-dim"}`}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="inline-block size-2 shrink-0 rounded-[2px]" style={{ background: theme.families[f] }} />
                      <span className="truncate">{FAMILY_META[f].short}</span>
                    </span>
                    <span className="num text-ink">{v}</span>
                  </li>
                ))}
            </ul>
            <div className="mt-1 text-[11px] text-faint">{hover?.f ? "click for the incidents" : "hover a band"}</div>
          </div>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {families.map((f) => (
          <li key={f}>
            <button
              type="button"
              onClick={() => onFamily?.(f)}
              onMouseEnter={() => setLegendHover(f)}
              onMouseLeave={() => setLegendHover(null)}
              aria-label={`${FAMILY_META[f].label}: ${totals[f]} incidents`}
              className={`group flex items-center gap-1.5 text-[12.5px] ${activeFamily === f ? "text-accent" : "text-dim hover:text-ink"}`}
            >
              <span className="inline-block size-2.5 rounded-[2px]" style={{ background: theme.families[f], boxShadow: `0 0 6px ${theme.families[f]}` }} />
              {FAMILY_META[f].short}
              <span className="num text-soft underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 group-hover:decoration-[color:var(--color-accent)]">{totals[f].toLocaleString("en-US")}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
