"use client";

import { useId } from "react";
import { useBoxWidth } from "./hooks";
import { monotonePath, type Pt } from "./path";

interface Props {
  values: number[];
  /** A comparison series on the same scale, drawn dashed (last year). */
  compare?: number[];
  /** Slots on the x axis; defaults to the longest series, so a partial year stops short. */
  slots?: number;
  height?: number;
  color: string;
  /** The end dot: the current period. */
  dot?: string;
  surface?: string;
}

/** Room above the highest point for the glow, and right of the last point for the end dot's pulse. */
const TOP = 10;
const RIGHT = 12;

/**
 * A full-bleed trend for the large stat tiles: it runs from the tile's left
 * edge to just short of its right one and down to the foot, a soft wash under
 * a glowing line, ending in a dot that pulses (still under reduced motion,
 * globals.css .glow-pulse). Decorative: the tile's number is what opens the
 * incidents.
 */
export function GlowArea({ values, compare, slots, height = 56, color, dot, surface = "#070a12" }: Props) {
  const [ref, width] = useBoxWidth<HTMLDivElement>(160);
  const uid = useId().replace(/:/g, "");
  const n = Math.max(2, slots ?? Math.max(values.length, compare?.length ?? 0));
  const max = Math.max(1, ...values, ...(compare ?? []));
  const w = Math.max(20, width);
  const x = (i: number) => (i / (n - 1)) * (w - RIGHT);
  const y = (v: number) => TOP + (1 - v / max) * (height - TOP - 2);
  const pts: Pt[] = values.map((v, i) => [x(i), y(v)]);
  const line = monotonePath(pts);
  const last = pts[pts.length - 1];
  const area = last ? `${line}L${last[0].toFixed(1)},${height}L0,${height}Z` : "";

  return (
    <div ref={ref} className="relative w-full" style={{ height }} aria-hidden>
      <svg width={w} height={height} className="block overflow-visible">
        <defs>
          <linearGradient id={`gw-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.36} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
          <filter id={`gb-${uid}`} x="-5%" y="-60%" width="110%" height="220%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>
        {compare && compare.length > 1 && <path d={monotonePath(compare.map((v, i) => [x(i), y(v)]))} fill="none" stroke="var(--color-dim)" strokeOpacity={0.8} strokeWidth={1.25} strokeDasharray="3 3" />}
        {area && <path d={area} fill={`url(#gw-${uid})`} />}
        <path d={line} fill="none" stroke={color} strokeWidth={4} strokeOpacity={0.55} filter={`url(#gb-${uid})`} className="glow-halo" />
        <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        {last && (
          <>
            <circle cx={last[0]} cy={last[1]} r={3.5} fill={dot ?? color} className="glow-pulse" />
            <circle cx={last[0]} cy={last[1]} r={3.5} fill={dot ?? color} stroke={surface} strokeWidth={1.5} />
          </>
        )}
      </svg>
    </div>
  );
}
