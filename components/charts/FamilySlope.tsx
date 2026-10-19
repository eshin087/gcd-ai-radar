"use client";

import { useReducedMotion } from "@/components/fx/useReducedMotion";
import { FAMILY_META, type Family } from "@/lib/families";
import { formatPct } from "@/lib/format";
import { pctChange } from "@/lib/stats";
import type { ChartTheme } from "@/lib/theme";
import { useShown, useWidth } from "./hooks";

export interface SlopeRow {
  key: Family;
  now: number;
  prior: number;
}

interface Props {
  rows: SlopeRow[];
  theme: ChartTheme;
  /** Axis captions. */
  priorLabel: string;
  nowLabel: string;
  height?: number;
  onNow?: (f: Family) => void;
  onPrior?: (f: Family) => void;
  active?: Family | null;
  label: string;
}

const LABEL_W = 118;
const PAD = { t: 36, b: 18 };
const MIN_GAP = 18;

/** Pushes labels apart vertically so none overlap, keeping them inside [top, bottom]. */
function spread(ys: number[], top: number, bottom: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) if (order[k]!.y < order[k - 1]!.y + MIN_GAP) order[k]!.y = order[k - 1]!.y + MIN_GAP;
  const over = (order[order.length - 1]?.y ?? 0) - bottom;
  if (over > 0) for (const o of order) o.y -= over;
  for (let k = 0; k < order.length; k++) if (order[k]!.y < top) order[k]!.y = top + k * MIN_GAP;
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

/**
 * Slope chart: each family's count in the window before against its count
 * now, joined by a line, so the movers stand out. Both counts open their
 * incidents. Lines draw in when the chart scrolls into view.
 */
export function FamilySlope({ rows, theme, priorLabel, nowLabel, height = 280, onNow, onPrior, active = null, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(420);
  const shown = useShown(ref);
  const reduced = useReducedMotion();
  const labelW = Math.min(LABEL_W, Math.max(88, Math.round(width * 0.3)));
  const xL = labelW;
  const xR = width - labelW;
  const plotH = height - PAD.t - PAD.b;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.now, r.prior)));
  const y = (v: number) => PAD.t + plotH * (1 - v / max);
  const leftY = spread(rows.map((r) => y(r.prior)), PAD.t, PAD.t + plotH);
  const rightY = spread(rows.map((r) => y(r.now)), PAD.t, PAD.t + plotH);
  const on = shown || reduced;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label} className="absolute inset-0 block overflow-visible">
        <line x1={xL} x2={xL} y1={PAD.t - 6} y2={PAD.t + plotH + 6} stroke={theme.grid} />
        <line x1={xR} x2={xR} y1={PAD.t - 6} y2={PAD.t + plotH + 6} stroke={theme.grid} />
        <text x={0} y={PAD.t - 14} textAnchor="start" fontSize={10.5} fill={theme.dim} className="label">
          {priorLabel}
        </text>
        <text x={width} y={PAD.t - 14} textAnchor="end" fontSize={10.5} fill={theme.dim} className="label">
          {nowLabel}
        </text>
        {rows.map((r, i) => {
          const c = theme.families[r.key];
          const dim = active !== null && active !== r.key;
          return (
            <g key={r.key} opacity={dim ? 0.3 : 1} style={{ transition: "opacity 180ms" }}>
              <line
                x1={xL}
                y1={y(r.prior)}
                x2={xR}
                y2={y(r.now)}
                stroke={c}
                strokeWidth={r.now >= r.prior ? 2.2 : 1.6}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={on ? 0 : 1}
                style={{ transition: reduced ? "none" : `stroke-dashoffset 900ms cubic-bezier(.3,.6,.2,1) ${i * 60}ms` }}
              />
              <circle cx={xL} cy={y(r.prior)} r={3.5} fill={theme.surface} stroke={c} strokeWidth={1.6} />
              <circle cx={xR} cy={y(r.now)} r={4.5} fill={c} />
              {/* leader ticks from the dots to the labels when they had to move */}
              <line x1={xL - 8} y1={leftY[i]} x2={xL - 3} y2={y(r.prior)} stroke={theme.grid} />
              <line x1={xR + 8} y1={rightY[i]} x2={xR + 3} y2={y(r.now)} stroke={theme.grid} />
            </g>
          );
        })}
      </svg>
      {rows.map((r, i) => {
        const delta = pctChange(r.now, r.prior);
        return (
          <div key={r.key}>
            <button
              type="button"
              onClick={() => onPrior?.(r.key)}
              aria-label={`${FAMILY_META[r.key].label} in the ${priorLabel}: ${r.prior} incidents`}
              className="num absolute -translate-y-1/2 text-right text-[11.5px] leading-none text-dim hover:text-ink"
              style={{ left: 0, width: labelW - 12, top: leftY[i] }}
            >
              <span className="text-soft underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4">{r.prior.toLocaleString("en-US")}</span>
              <span className="ml-1.5 hidden text-faint sm:inline">{FAMILY_META[r.key].short}</span>
            </button>
            <button
              type="button"
              onClick={() => onNow?.(r.key)}
              aria-label={`${FAMILY_META[r.key].label}: ${r.now} incidents`}
              className={`absolute -translate-y-1/2 whitespace-nowrap text-left text-[11.5px] leading-none hover:text-ink ${active === r.key ? "text-accent" : "text-soft"}`}
              style={{ left: xR + 12, width: labelW - 12, top: rightY[i] }}
            >
              <span className="num text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4">{r.now.toLocaleString("en-US")}</span>
              <span className="ml-1.5 text-dim">{FAMILY_META[r.key].short}</span>
              <span className={`num ml-1.5 text-[11px] ${delta === null || delta > 0.5 ? "text-sev-3" : delta < -0.5 ? "text-type-by" : "text-faint"}`}>{formatPct(delta)}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
