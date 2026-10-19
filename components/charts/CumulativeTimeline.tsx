"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useReducedMotion } from "@/components/fx/useReducedMotion";
import type { CompactRow } from "@/lib/dashboard";
import { monthLabel } from "@/lib/format";
import type { ChartTheme } from "@/lib/theme";
import { niceStep, useShown, useWidth } from "./hooks";
import { monotonePath, type Pt } from "./path";

interface Props {
  months: string[];
  /** Incidents per month, same length as months. */
  totals: number[];
  /** Incidents to pin on the curve, best first; each is placed at its month. */
  notable: CompactRow[];
  /** The month a notable incident belongs to on the current date basis, or null when it has no month. */
  monthOf: (r: CompactRow) => string | null;
  provisionalFrom?: string;
  height?: number;
  theme: ChartTheme;
  onMonth?: (month: string) => void;
  activeMonth?: string | null;
  label: string;
}

const PAD = { l: 44, r: 56, t: 72, b: 30 };
const LANE_H = 20;

/**
 * The running total of incidents over the window, with the most notable
 * ones pinned to the curve as markers that link to their pages: a timeline
 * that reads as a story. Hovering gives the count so far; a click on a
 * month opens its incidents. The line draws in on arrival.
 */
export function CumulativeTimeline({ months, totals, notable, monthOf, provisionalFrom, height = 372, theme, onMonth, activeMonth = null, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const shown = useShown(ref);
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const n = months.length;
  const cum: number[] = [];
  for (let i = 0, s = 0; i < totals.length; i++) {
    s += totals[i]!;
    cum.push(s);
  }
  const max = Math.max(1, cum[n - 1] ?? 1);
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = height - PAD.t - PAD.b;
  const base = PAD.t + plotH;
  const x = (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.t + plotH * (1 - v / max);
  const pts: Pt[] = cum.map((v, i) => [x(i), y(v)]);
  const line = monotonePath(pts);
  const area = pts.length ? `${line}L${x(n - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z` : "";
  const provIdx = provisionalFrom ? months.findIndex((m) => m >= provisionalFrom) : -1;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, plotW / 62)));
  const step = niceStep(max / 4);
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, k) => k * step);

  // markers: each notable incident at its month, labels laid out in lanes above the curve so they never collide
  const markers: { r: CompactRow; i: number; lane: number; w: number; text: string }[] = [];
  const laneRight = [0, 0, 0];
  for (const r of notable) {
    const mo = monthOf(r);
    const i = mo ? months.indexOf(mo) : -1;
    if (i < 0) continue;
    const text = r.title.length > 38 ? `${r.title.slice(0, 36).trimEnd()}…` : r.title;
    const w = text.length * 6.4 + 14;
    const left = Math.max(0, Math.min(width - w, x(i) - w / 2));
    let lane = laneRight.findIndex((edge) => edge <= left);
    if (lane < 0) lane = laneRight.indexOf(Math.min(...laneRight));
    laneRight[lane] = left + w + 8;
    markers.push({ r, i, lane, w, text });
  }

  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover) - 95, 0), width - 190);

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label} className="absolute inset-0 block overflow-visible">
        <defs>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.accent} stopOpacity={0.28} />
            <stop offset="100%" stopColor={theme.accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + plotW} y1={y(v)} y2={y(v)} stroke={theme.grid} />
            <text x={PAD.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill={theme.axis} className="num">
              {v.toLocaleString("en-US")}
            </text>
          </g>
        ))}
        {provIdx >= 0 && (
          <g aria-hidden>
            <rect x={x(provIdx)} y={PAD.t} width={PAD.l + plotW - x(provIdx)} height={plotH} fill={theme.provisional} />
            <text x={PAD.l + plotW} y={base - 6} textAnchor="end" fontSize={10} fill={theme.dim} className="num">
              provisional
            </text>
          </g>
        )}
        <path d={area} fill={`url(#area-${uid})`} style={{ opacity: shown || reduced ? 1 : 0, transition: reduced ? "none" : "opacity 900ms 700ms" }} />
        <path d={line} fill="none" stroke={theme.accent} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={shown || reduced ? 0 : 1} style={{ transition: reduced ? "none" : "stroke-dashoffset 1600ms cubic-bezier(.3,.6,.2,1) 200ms" }} />
        {/* hit areas per month */}
        {months.map((m, i) => (
          <rect
            key={m}
            x={PAD.l + (i - 0.5) * (n > 1 ? plotW / (n - 1) : plotW)}
            y={PAD.t}
            width={n > 1 ? plotW / (n - 1) : plotW}
            height={plotH}
            fill="transparent"
            role={onMonth ? "button" : undefined}
            tabIndex={onMonth ? 0 : -1}
            aria-label={`${monthLabel(m, true)}: ${cum[i]} incidents so far`}
            className={onMonth ? "cursor-pointer outline-none" : undefined}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            onFocus={() => setHover(i)}
            onBlur={() => setHover((h) => (h === i ? null : h))}
            onClick={() => onMonth?.(m)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onMonth?.(m);
              }
            }}
          />
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={base} stroke={theme.ink} strokeOpacity={0.3} />
            <circle cx={x(hover)} cy={y(cum[hover]!)} r={4.5} fill={theme.accent} stroke={theme.surface} strokeWidth={1.5} />
          </g>
        )}
        {activeMonth && months.includes(activeMonth) && <circle cx={x(months.indexOf(activeMonth))} cy={y(cum[months.indexOf(activeMonth)]!)} r={5} fill={theme.ink} pointerEvents="none" />}
        {/* markers */}
        {markers.map((mk) => (
          <g key={mk.r.id} pointerEvents="none" style={{ opacity: shown || reduced ? 1 : 0, transition: `opacity 500ms ${900 + mk.i * 10}ms` }}>
            <line x1={x(mk.i)} x2={x(mk.i)} y1={y(cum[mk.i]!)} y2={8 + mk.lane * LANE_H + LANE_H - 2} stroke={theme.severity[mk.r.severity]} strokeOpacity={0.55} strokeDasharray="2 3" />
            <circle cx={x(mk.i)} cy={y(cum[mk.i]!)} r={4} fill={theme.severity[mk.r.severity]} stroke={theme.surface} strokeWidth={1.5} />
          </g>
        ))}
        {/* end value */}
        {n > 0 && (
          <text x={x(n - 1) + 8} y={y(cum[n - 1]!)} dy="0.32em" fontSize={13} fontWeight={600} fill={theme.ink} className="num" style={{ opacity: shown || reduced ? 1 : 0, transition: "opacity 400ms 1700ms" }}>
            {cum[n - 1]!.toLocaleString("en-US")}
          </text>
        )}
        {months.map((m, i) =>
          (n - 1 - i) % labelEvery === 0 ? (
            <text key={m} x={Math.min(Math.max(x(i), PAD.l + 18), PAD.l + plotW - 18)} y={base + 15} textAnchor="middle" fontSize={11} fill={theme.axis} className="num">
              {monthLabel(m)}
            </text>
          ) : null,
        )}
      </svg>
      {markers.map((mk) => (
        <Link
          key={mk.r.id}
          href={`/incidents/${mk.r.slug}`}
          className="absolute z-10 truncate rounded-[3px] border px-1.5 py-0.5 text-[11px] leading-tight text-soft hover:text-ink"
          style={{
            left: Math.max(0, Math.min(width - mk.w, x(mk.i) - mk.w / 2)),
            top: 8 + mk.lane * LANE_H - 2,
            maxWidth: mk.w,
            borderColor: `color-mix(in oklab, ${theme.severity[mk.r.severity]} 45%, transparent)`,
            background: "color-mix(in oklab, var(--color-panel) 85%, transparent)",
            opacity: shown || reduced ? 1 : 0,
            transition: "opacity 500ms 1000ms",
          }}
          title={`${mk.r.title} · severity ${mk.r.severity} · ${mk.r.source_count} source${mk.r.source_count === 1 ? "" : "s"}`}
        >
          <span className="num mr-1" style={{ color: theme.severity[mk.r.severity] }}>
            ◆
          </span>
          {mk.text}
        </Link>
      ))}
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 z-20 w-[190px] rounded-[4px] border border-line bg-panel/95 p-2.5 text-[12px] shadow-xl backdrop-blur" style={{ left: tipLeft, top: PAD.t - 4 }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-soft">{monthLabel(months[hover]!, true)}</span>
            <span className="num text-[14px] font-semibold text-ink">{cum[hover]}</span>
          </div>
          <div className="mt-1 flex justify-between text-dim">
            <span>so far · this month</span>
            <span className="num text-ink">+{totals[hover]}</span>
          </div>
          {provIdx >= 0 && hover >= provIdx && <div className="mt-1 text-[11px] text-faint">provisional: reporting lag</div>}
          <div className="mt-1 text-[11px] text-faint">click for the month&rsquo;s incidents</div>
        </div>
      )}
    </div>
  );
}
