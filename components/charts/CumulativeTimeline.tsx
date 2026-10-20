"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useReducedMotion } from "@/components/fx/useReducedMotion";
import type { CompactRow } from "@/lib/dashboard";
import { monthLabel } from "@/lib/format";
import type { ChartTheme } from "@/lib/theme";
import { monthTicks, niceStep, textOn, useShown, useTextWidth, useWidth } from "./hooks";
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

const PAD = { l: 44, r: 56, b: 30 };
const LANE_H = 24;
const LABEL_H = 20;
/** Space between a lane label and the next one in the same lane. */
const GAP = 6;
/** A label always contains its leader, at least this far from either end. */
const EDGE = 12;
/** Below this a label shows its number only. */
const MIN_W = 76;
const CHIP_W = 22;
/** Markers closer than this on the curve are nudged apart. */
const MARK_GAP = 20;

interface Item {
  r: CompactRow;
  i: number;
  num: number;
  /** Anchor x: the marker and the leader. */
  ax: number;
  /** The label's natural width. */
  w0: number;
}
interface Placed extends Item {
  lane: number;
  left: number;
  w: number;
  chip: boolean;
}

/**
 * Lays the labels out for one lane assignment, left to right. A label keeps
 * its own anchor inside it (so its leader is a straight drop), starts after
 * the previous label in its lane, never covers the leader of a label in a
 * lane above (earlier or later), and is centred on its anchor where it can
 * be. Labels that cannot show a few letters show their number only; labels
 * with no room at all are left out (their marker stays on the curve).
 */
function place(items: Item[], lanes: number[], W: number, cap: number): Placed[] {
  const lastRight = new Map<number, number>();
  const out: Placed[] = [];
  items.forEach((it, i) => {
    const lane = lanes[i]!;
    let lo = Math.max(0, (lastRight.get(lane) ?? -Infinity) + GAP);
    let hi = W;
    items.forEach((other, j) => {
      if (lanes[j]! <= lane) return;
      // a leader from a higher lane drops through this one at its anchor
      if (j < i) lo = Math.max(lo, other.ax + 3);
      else hi = Math.min(hi, other.ax - 3);
    });
    if (lo > it.ax - 11 || hi < it.ax + 11) return;
    const want = Math.min(it.w0, cap);
    const w = Math.min(want, hi - lo);
    if (w < MIN_W || lo > it.ax - EDGE || hi < it.ax + EDGE) {
      const left = Math.min(Math.max(lo, it.ax - CHIP_W / 2), hi - CHIP_W);
      out.push({ ...it, lane, left, w: CHIP_W, chip: true });
      lastRight.set(lane, left + CHIP_W);
      return;
    }
    const left = Math.min(Math.max(lo, it.ax - w / 2, it.ax + EDGE - w), hi - w, it.ax - EDGE);
    out.push({ ...it, lane, left, w, chip: false });
    lastRight.set(lane, left + w);
  });
  return out;
}

/** How well a layout reads: every label placed with most of its title, in as few lanes as possible. */
function score(placed: Placed[], count: number): number {
  const quality = placed.reduce((s, p) => s + (p.chip ? 0.15 : Math.min(1, p.w / Math.min(p.w0, 220))), 0);
  const lanes = new Set(placed.map((p) => p.lane)).size;
  return quality - 2 * (count - placed.length) - 0.25 * Math.max(0, lanes - 1) - 0.001 * placed.reduce((s, p) => s + p.lane, 0);
}

/**
 * Packs the labels into up to three lanes above the plot. There are at most
 * six markers, so every lane assignment (3^6 = 729) is laid out and scored
 * and the best one wins; empty lanes are then dropped so the labels sit
 * close to the plot.
 */
function pack(items: Item[], W: number): Placed[] {
  const n = items.length;
  if (n === 0) return [];
  const L = Math.min(3, n);
  let best: { placed: Placed[]; score: number } | null = null;
  const lanes = new Array<number>(n).fill(0);
  for (const cap of [Math.max(110, Math.min(280, (W * L) / n - GAP)), Math.max(96, Math.min(200, (W * 2) / n - GAP))]) {
    for (let code = 0; code < L ** n; code++) {
      for (let i = 0, c = code; i < n; i++, c = Math.floor(c / L)) lanes[i] = c % L;
      const placed = place(items, lanes, W, cap);
      const sc = score(placed, n);
      if (!best || sc > best.score + 1e-9) best = { placed, score: sc };
    }
  }
  const used = [...new Set(best!.placed.map((p) => p.lane))].sort((a, b) => a - b);
  return best!.placed.map((p) => ({ ...p, lane: used.indexOf(p.lane) }));
}

/**
 * The running total of incidents over the window, with the most notable ones
 * pinned to the curve as numbered markers. Their titles sit in two or three
 * lanes above the plot, packed so they never overlap and joined to their
 * markers by straight leaders; long titles end in an ellipsis and show in
 * full on hover. Hovering the plot gives the count so far; a click on a
 * month opens its incidents; a marker or its label opens the incident. The
 * line draws in on arrival.
 */
export function CumulativeTimeline({ months, totals, notable, monthOf, provisionalFrom, height = 372, theme, onMonth, activeMonth = null, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const shown = useShown(ref);
  const reduced = useReducedMotion();
  const measure = useTextWidth();
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const on = shown || reduced;

  const n = months.length;
  const cum: number[] = [];
  for (let i = 0, s = 0; i < totals.length; i++) {
    s += totals[i]!;
    cum.push(s);
  }
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const x = (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);

  // markers in time order, numbered, nudged apart where months crowd together
  const items: Item[] = [];
  for (const r of notable) {
    const mo = monthOf(r);
    const i = mo ? months.indexOf(mo) : -1;
    if (i < 0) continue;
    items.push({ r, i, num: 0, ax: x(i), w0: measure(r.title, 11) + 38 });
  }
  items.sort((a, b) => a.i - b.i || notable.indexOf(a.r) - notable.indexOf(b.r));
  items.forEach((it, k) => {
    it.num = k + 1;
    if (k > 0) it.ax = Math.max(it.ax, items[k - 1]!.ax + MARK_GAP);
  });
  for (let k = items.length - 1; k >= 0; k--) {
    const limit = k === items.length - 1 ? width - EDGE - 2 : items[k + 1]!.ax - MARK_GAP;
    if (items[k]!.ax > limit) items[k]!.ax = limit;
  }

  // two lanes unless a third reads clearly better (narrow panels)
  const placed = pack(items, width);
  const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
  const padT = lanes * LANE_H + 18;
  const laneTop = (lane: number) => padT - 14 - LABEL_H - lane * LANE_H;

  const max = Math.max(1, cum[n - 1] ?? 1);
  const plotH = height - padT - PAD.b;
  const base = padT + plotH;
  const y = (v: number) => padT + plotH * (1 - v / max);
  const pts: Pt[] = cum.map((v, i) => [x(i), y(v)]);
  const line = monotonePath(pts);
  const area = pts.length ? `${line}L${x(n - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z` : "";
  const provIdx = provisionalFrom ? months.findIndex((m) => m >= provisionalFrom) : -1;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, plotW / 62)));
  const step = niceStep(max / 4);
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, k) => k * step);
  const sev = (r: CompactRow) => theme.severity[r.severity];
  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover) - 95, 0), width - 190);
  const titleOf = (r: CompactRow) => `${r.title} · severity ${r.severity} · ${r.source_count} source${r.source_count === 1 ? "" : "s"}`;

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
            <rect x={x(provIdx)} y={padT} width={PAD.l + plotW - x(provIdx)} height={plotH} fill={theme.provisional} />
            <text x={PAD.l + plotW} y={base - 6} textAnchor="end" fontSize={10} fill={theme.dim} className="num">
              provisional
            </text>
          </g>
        )}
        <path d={area} fill={`url(#area-${uid})`} style={{ opacity: on ? 1 : 0, transition: reduced ? "none" : "opacity 900ms 700ms" }} />
        <path d={line} fill="none" stroke={theme.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={on ? 0 : 1} style={{ transition: reduced ? "none" : "stroke-dashoffset 1600ms cubic-bezier(.3,.6,.2,1) 200ms" }} />
        {/* hit areas per month */}
        {months.map((m, i) => (
          <rect
            key={m}
            x={PAD.l + (i - 0.5) * (n > 1 ? plotW / (n - 1) : plotW)}
            y={padT}
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
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={base} stroke={theme.ink} strokeOpacity={0.3} />
            <circle cx={x(hover)} cy={y(cum[hover]!)} r={4.5} fill={theme.accent} stroke={theme.surface} strokeWidth={2} />
          </g>
        )}
        {activeMonth && months.includes(activeMonth) && <circle cx={x(months.indexOf(activeMonth))} cy={y(cum[months.indexOf(activeMonth)]!)} r={5} fill={theme.ink} pointerEvents="none" />}
        {/* leaders: a straight drop from each label to its marker, then a short stem to the exact month on the curve */}
        <g pointerEvents="none" style={{ opacity: on ? 1 : 0, transition: reduced ? "none" : "opacity 500ms 1100ms" }}>
          {items.map((it) => {
            const cy = y(cum[it.i]!);
            const p = placed.find((q) => q.r.id === it.r.id);
            return (
              <g key={it.r.id}>
                {p && <line x1={p.ax} x2={p.ax} y1={laneTop(p.lane) + LABEL_H} y2={cy - 9} stroke={sev(it.r)} strokeOpacity={lit === it.r.id ? 0.9 : 0.42} />}
                {Math.abs(it.ax - x(it.i)) > 1 && <line x1={x(it.i)} x2={it.ax} y1={cy} y2={cy} stroke={sev(it.r)} strokeOpacity={0.6} />}
                <circle cx={x(it.i)} cy={cy} r={2.5} fill={sev(it.r)} stroke={theme.surface} strokeWidth={1.5} />
              </g>
            );
          })}
        </g>
        {/* end value */}
        {n > 0 && (
          <text x={x(n - 1) + 8} y={y(cum[n - 1]!)} dy="0.32em" fontSize={13} fontWeight={600} fill={theme.ink} className="num" style={{ opacity: on ? 1 : 0, transition: reduced ? "none" : "opacity 400ms 1700ms" }}>
            {cum[n - 1]!.toLocaleString("en-US")}
          </text>
        )}
        {monthTicks(n, labelEvery, x, PAD.l + 18, PAD.l + plotW - 18).map(({ i, at }) => (
          <text key={months[i]} x={at} y={base + 15} textAnchor="middle" fontSize={11} fill={theme.axis} className="num">
            {monthLabel(months[i]!)}
          </text>
        ))}
      </svg>

      {/* numbered markers on the curve (the labels above carry the same links for keyboard and screen readers) */}
      {items.map((p) => (
        <Link
          key={`m-${p.r.id}`}
          href={`/incidents/${p.r.slug}`}
          tabIndex={-1}
          aria-hidden
          title={titleOf(p.r)}
          onMouseEnter={() => setLit(p.r.id)}
          onMouseLeave={() => setLit(null)}
          className="num absolute z-10 grid size-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[10px] font-semibold leading-none transition-transform hover:scale-110"
          style={{
            left: p.ax,
            top: y(cum[p.i]!),
            background: sev(p.r),
            color: textOn(sev(p.r)),
            boxShadow: `0 0 0 2px ${theme.surface}, 0 0 10px color-mix(in oklab, ${sev(p.r)} 60%, transparent)`,
            opacity: on ? 1 : 0,
            transition: reduced ? "none" : `opacity 400ms ${1000 + p.num * 70}ms, transform 150ms`,
          }}
        >
          {p.num}
        </Link>
      ))}
      {/* the labels, in their lanes */}
      {placed.map((p) => (
        <Link
          key={p.r.id}
          href={`/incidents/${p.r.slug}`}
          onMouseEnter={() => setLit(p.r.id)}
          onMouseLeave={() => setLit(null)}
          onFocus={() => setLit(p.r.id)}
          onBlur={() => setLit(null)}
          aria-label={`${p.num}: ${p.r.title}, severity ${p.r.severity}`}
          className={`absolute z-10 flex items-center gap-1.5 rounded-full border pl-[2px] text-[11px] leading-none hover:text-ink ${p.chip ? "justify-center pr-[2px]" : "pr-2"} ${lit === p.r.id ? "text-ink" : "text-soft"}`}
          style={{
            left: p.left,
            top: laneTop(p.lane),
            width: p.w,
            height: LABEL_H,
            borderColor: `color-mix(in oklab, ${sev(p.r)} ${lit === p.r.id ? 80 : 40}%, transparent)`,
            background: "color-mix(in oklab, var(--color-panel) 90%, transparent)",
            opacity: on ? 1 : 0,
            transition: reduced ? "none" : `opacity 500ms ${1000 + p.num * 70}ms, border-color 150ms`,
          }}
          title={titleOf(p.r)}
        >
          <span className="num grid size-4 shrink-0 place-items-center rounded-full text-[9.5px] font-semibold" style={{ background: sev(p.r), color: textOn(sev(p.r)) }}>
            {p.num}
          </span>
          {!p.chip && <span className="min-w-0 truncate">{p.r.title}</span>}
        </Link>
      ))}
      {hover !== null && (
        <div className="pointer-events-none absolute z-20 w-[190px] rounded-[4px] border border-line bg-panel/95 p-2.5 text-[12px] shadow-xl backdrop-blur" style={{ left: tipLeft, top: padT + 4 }}>
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
