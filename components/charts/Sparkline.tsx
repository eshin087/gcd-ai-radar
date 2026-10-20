"use client";

import { useId, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useBoxWidth } from "./hooks";
import { monotonePath, type Pt } from "./path";

interface Props {
  values: number[];
  /** A faint comparison series drawn on the same scale (last year, the window before). */
  compare?: number[];
  /** Slots on the x axis; defaults to the longest series, so a partial year can stop short. */
  slots?: number;
  height?: number;
  color: string;
  /** The end dot: the current period. */
  dot?: string;
  surface?: string;
  className?: string;
  /**
   * Interactive sparklines name the hovered point and open it on click. Points
   * with a zero count do not open (there is nothing to list).
   */
  onPick?: (i: number) => void;
  /** Accessible name and tooltip text for point i ("Mar 2026: 12 incidents"). */
  describe?: (i: number) => string;
  /** Prefix of the accessible name ("Injection by month"). */
  label?: string;
}

const PAD = 3;

/**
 * A small trend line with a soft area wash and an end dot, sized to its box.
 * Monotone between points so it never dips below zero. Decorative unless it
 * gets `onPick`: then hovering (or arrow keys on focus) reads a month and a
 * click opens it.
 */
export function Sparkline({ values, compare, slots, height = 30, color, dot, surface = "#070a12", className = "", onPick, describe, label }: Props) {
  const [ref, width] = useBoxWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  const n = Math.max(2, slots ?? Math.max(values.length, compare?.length ?? 0));
  const max = Math.max(1, ...values, ...(compare ?? []));
  const w = Math.max(10, width);
  const x = (i: number) => PAD + (i / (n - 1)) * (w - PAD * 2);
  const y = (v: number) => PAD + (1 - v / max) * (height - PAD * 2);
  const pts: Pt[] = values.map((v, i) => [x(i), y(v)]);
  const line = monotonePath(pts);
  const area = pts.length > 1 ? `${line}L${pts[pts.length - 1]![0].toFixed(1)},${height}L${pts[0]![0].toFixed(1)},${height}Z` : "";
  const last = values.length - 1;
  const at = hover ?? last;
  const interactive = Boolean(onPick);

  const indexAt = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(last, Math.round(((e.clientX - r.left - PAD) / Math.max(1, r.width - PAD * 2)) * (n - 1))));
  };
  const pick = (i: number) => {
    if ((values[i] ?? 0) > 0) onPick?.(i);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setHover((h) => Math.max(0, Math.min(last, (h ?? last) + (e.key === "ArrowLeft" ? -1 : 1))));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(at);
    }
  };

  return (
    <div ref={ref} className={`relative w-full ${className}`} style={{ height }}>
      <svg
        width={w}
        height={height}
        className={`block overflow-visible ${interactive ? "cursor-pointer outline-none" : ""}`}
        aria-hidden={interactive ? undefined : true}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive && describe ? `${label ? `${label}, ` : ""}${describe(at)}` : undefined}
        onMouseMove={interactive ? (e) => setHover(indexAt(e)) : undefined}
        onMouseLeave={interactive ? () => setHover(null) : undefined}
        onBlur={interactive ? () => setHover(null) : undefined}
        onClick={interactive ? (e) => pick(indexAt(e)) : undefined}
        onKeyDown={interactive ? onKey : undefined}
      >
        <defs>
          <linearGradient id={`sa-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.26} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {compare && compare.length > 1 && <path d={monotonePath(compare.map((v, i) => [x(i), y(v)]))} fill="none" stroke="var(--color-dim)" strokeOpacity={0.55} strokeWidth={1} strokeLinejoin="round" />}
        {area && <path d={area} fill={`url(#sa-${uid})`} />}
        <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--color-ink)" strokeOpacity={0.3} />}
        {last >= 0 && <circle cx={x(at)} cy={y(values[at] ?? 0)} r={hover !== null ? 3 : 2.75} fill={hover !== null ? color : (dot ?? color)} stroke={surface} strokeWidth={1.5} />}
      </svg>
      {interactive && hover !== null && describe && (
        <div
          className="pointer-events-none absolute bottom-full z-20 mb-1 whitespace-nowrap rounded-[3px] border border-line bg-panel/95 px-1.5 py-0.5 text-[11px] text-soft shadow-lg backdrop-blur"
          // slides from left-aligned at the first point to right-aligned at the last, so it never leaves the box
          style={{ left: x(hover), transform: `translateX(-${((hover / (n - 1)) * 100).toFixed(1)}%)` }}
        >
          {describe(hover)}
        </div>
      )}
    </div>
  );
}
