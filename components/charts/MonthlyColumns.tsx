"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useReducedMotion } from "@/components/fx/useReducedMotion";
import { monthLabel } from "@/lib/format";
import { monthTicks, niceStep } from "./hooks";

export interface ColumnStack {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export interface ColumnColors {
  grid: string;
  axis: string;
  ink: string;
  dim: string;
  accent: string;
  provisional: string;
  /** The panel surface, for gaps, rings and the provisional hatch. */
  surface?: string;
}

interface Props {
  months: string[];
  /** Bottom to top. One stack draws a single series. */
  stacks: ColumnStack[];
  /** Optional overlay line (3-month average), same length as months. */
  line?: (number | null)[];
  lineLabel?: string;
  /** Optional dashed linear trend. */
  fit?: (number | null)[];
  /** Tooltip-only split of each month (families), shown as a stacked mini bar and the largest parts. */
  breakdown?: ColumnStack[];
  provisionalFrom?: string;
  height?: number;
  colors: ColumnColors;
  /** Single-series bars fade from this colour at the top into the stack colour. */
  gradientTop?: string;
  /** A soft bloom under the bars. */
  glow?: boolean;
  /** Mark the tallest column. */
  peak?: boolean;
  activeMonth?: string | null;
  onMonth?: (month: string) => void;
  onSegment?: (month: string, key: string) => void;
  /** Accessible name for the chart. */
  label: string;
  tooltipClassName?: string;
}

const PAD = { l: 40, r: 14, t: 30, b: 52 };
const TIP_W = 214;
const LINE_MS = 1500;
const LINE_DELAY = 520;

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** The point a fraction `t` of the way along a polyline (by length). */
function along(pts: [number, number][], t: number): [number, number] {
  if (pts.length === 0) return [0, 0];
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    lens.push(l);
    total += l;
  }
  let d = t * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]! || i === lens.length - 1) {
      const k = lens[i]! === 0 ? 0 : Math.min(1, d / lens[i]!);
      return [pts[i]![0] + (pts[i + 1]![0] - pts[i]![0]) * k, pts[i]![1] + (pts[i + 1]![1] - pts[i]![1]) * k];
    }
    d -= lens[i]!;
  }
  return pts[pts.length - 1]!;
}

/**
 * Monthly columns in SVG. On arrival the columns rise one after another on an
 * eased curve, the average line draws itself with a glowing head riding its
 * tip, and the peak marker starts a slow pulse. The bars wear a luminous
 * gradient over a soft bloom and a faint floor reflection; provisional months
 * carry a slowly drifting hatch. Hovering a month dims the others, drops a
 * crosshair and shows its count with the family mix; a click (or Enter on a
 * focused month) opens the month. Under reduced motion everything is drawn
 * in place and nothing moves.
 */
export function MonthlyColumns({
  months,
  stacks,
  line,
  lineLabel = "3-month average",
  fit,
  breakdown,
  provisionalFrom,
  height = 340,
  colors,
  gradientTop,
  glow = false,
  peak = true,
  activeMonth = null,
  onMonth,
  onSegment,
  label,
  tooltipClassName = "",
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const runRef = useRef<SVGGElement>(null);
  const linePtsRef = useRef<[number, number][]>([]);
  const [width, setWidth] = useState(720);
  const [shown, setShown] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const on = shown || reduced;
  const lineDone = drawn || reduced;
  const surface = colors.surface ?? "#070a12";

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)));
    ro.observe(el);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  const n = months.length;
  const totals = months.map((_, i) => stacks.reduce((s, st) => s + (st.values[i] ?? 0), 0));
  const maxVal = Math.max(1, ...totals, ...(line ?? []).map((v) => v ?? 0));
  const step = niceStep(maxVal / 4);
  const ymax = step * Math.max(1, Math.ceil(maxVal / step));
  const ticks = Array.from({ length: Math.round(ymax / step) + 1 }, (_, k) => k * step);
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = height - PAD.t - PAD.b;
  const base = PAD.t + plotH;
  const band = plotW / Math.max(1, n);
  const barW = Math.max(2, Math.min(24, band * 0.64));
  const y = (v: number) => PAD.t + plotH * (1 - v / ymax);
  const cx = (i: number) => PAD.l + (i + 0.5) * band;
  const peakIdx = totals.reduce((best, v, i) => (v > (totals[best] ?? -1) ? i : best), 0);
  const provIdx = provisionalFrom ? months.findIndex((m) => m >= provisionalFrom) : -1;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, plotW / 62)));
  const single = stacks.length === 1;
  const barColor = stacks[0]?.color ?? colors.accent;
  const stagger = Math.min(34, 680 / Math.max(1, n));

  // the average line as a polyline; its last point carries the glowing head
  const linePts: [number, number][] = [];
  (line ?? []).forEach((v, i) => {
    if (v !== null && v !== undefined) linePts.push([cx(i), y(v)]);
  });
  const lineD = linePts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const lineEnd = linePts[linePts.length - 1];
  useEffect(() => {
    linePtsRef.current = linePts;
  });

  // draw the average in: dash offset and the travelling head move together, one frame loop, no re-renders
  useEffect(() => {
    const path = lineRef.current;
    const run = runRef.current;
    if (!shown || reduced || drawn || !path || !run) return;
    let raf = 0;
    const t0 = performance.now() + LINE_DELAY;
    const tick = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / LINE_MS));
      const e = easeInOut(k);
      path.style.strokeDashoffset = String(1 - e);
      const [px, py] = along(linePtsRef.current, e);
      run.setAttribute("transform", `translate(${px.toFixed(1)},${py.toFixed(1)})`);
      run.style.opacity = k > 0 && k < 1 ? "1" : "0";
      if (k < 1) raf = requestAnimationFrame(tick);
      else setDrawn(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, reduced, drawn]);

  /** Column i as stacked segments, each a path with a rounded data end on top. */
  const segmentsOf = (i: number) => {
    const x = cx(i) - barW / 2;
    const segs: { key: string; color: string; d: string; top: number }[] = [];
    let acc = 0;
    const visible = stacks.filter((st) => (st.values[i] ?? 0) > 0);
    visible.forEach((st, k) => {
      const v = st.values[i] ?? 0;
      const bottom = y(acc) - (k > 0 ? 2 : 0);
      acc += v;
      const top = Math.min(y(acc), bottom - 1.5);
      const isTop = k === visible.length - 1;
      const r = isTop ? Math.min(4, bottom - top, barW / 2) : 0;
      segs.push({ key: st.key, color: st.color, top, d: `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${bottom}Z` });
    });
    return segs;
  };
  const rise = (i: number, origin = base): CSSProperties => ({
    transform: on ? "scaleY(1)" : "scaleY(0)",
    transformOrigin: `0px ${origin}px`,
    transition: reduced ? "none" : `transform 980ms cubic-bezier(.16,1,.3,1) ${Math.round(80 + i * stagger)}ms, opacity 220ms`,
  });
  const dimmed = (i: number) => hover !== null && hover !== i;

  const tip = hover;
  const tipRight = tip !== null && cx(tip) + barW / 2 + 12 + TIP_W <= width;
  const tipLeft = tip === null ? 0 : tipRight ? cx(tip) + barW / 2 + 12 : Math.max(0, cx(tip) - barW / 2 - 12 - TIP_W);
  const parts = tip !== null && breakdown ? breakdown.map((b) => ({ b, v: b.values[tip] ?? 0 })).filter((p) => p.v > 0) : [];
  const partsTotal = parts.reduce((s, p) => s + p.v, 0);
  const topParts = [...parts].sort((a, b) => b.v - a.v).slice(0, 4);

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label} className="absolute inset-0 block overflow-visible">
        <defs>
          <linearGradient id={`g-${uid}`} x1="0" y1="0" x2="0" y2="1">
            {single && gradientTop ? (
              <>
                <stop offset="0%" stopColor={gradientTop} stopOpacity={1} />
                <stop offset="16%" stopColor={gradientTop} stopOpacity={0.9} />
                <stop offset="52%" stopColor={barColor} stopOpacity={0.95} />
                <stop offset="100%" stopColor={barColor} stopOpacity={0.32} />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor={barColor} stopOpacity={1} />
                <stop offset="100%" stopColor={barColor} stopOpacity={0.45} />
              </>
            )}
          </linearGradient>
          <linearGradient id={`r-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={barColor} stopOpacity={0.3} />
            <stop offset="100%" stopColor={barColor} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`f-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={barColor} stopOpacity={0} />
            <stop offset="18%" stopColor={barColor} stopOpacity={0.55} />
            <stop offset="82%" stopColor={barColor} stopOpacity={0.55} />
            <stop offset="100%" stopColor={barColor} stopOpacity={0} />
          </linearGradient>
          <filter id={`bloom-${uid}`} x="-60%" y="-20%" width="220%" height="140%">
            <feGaussianBlur stdDeviation="5.5" />
          </filter>
          <filter id={`glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* provisional hatch: dark stripes over a bar, faint ones over the band; both drift slowly */}
          <pattern id={`hb-${uid}`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={1.8} height={5} fill={surface} fillOpacity={0.5} />
            {!reduced && <animateTransform attributeName="patternTransform" type="translate" additive="sum" from="0 0" to="5 0" dur="4s" repeatCount="indefinite" />}
          </pattern>
          <pattern id={`hp-${uid}`} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={1} height={7} fill={colors.ink} fillOpacity={0.07} />
            {!reduced && <animateTransform attributeName="patternTransform" type="translate" additive="sum" from="0 0" to="7 0" dur="7s" repeatCount="indefinite" />}
          </pattern>
        </defs>

        {/* grid and y labels */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + plotW} y1={y(v)} y2={y(v)} stroke={colors.grid} strokeWidth={1} />
            <text x={PAD.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill={colors.axis} className="num">
              {v.toLocaleString("en-US")}
            </text>
          </g>
        ))}

        {/* provisional band, hatched and bracketed under the axis */}
        {provIdx >= 0 && (
          <g aria-hidden>
            <rect x={PAD.l + provIdx * band} y={PAD.t} width={PAD.l + plotW - (PAD.l + provIdx * band)} height={plotH} fill={colors.provisional} />
            <rect x={PAD.l + provIdx * band} y={PAD.t} width={PAD.l + plotW - (PAD.l + provIdx * band)} height={plotH} fill={`url(#hp-${uid})`} />
            <path d={`M${PAD.l + provIdx * band + 3},${base + 32}v-4M${PAD.l + provIdx * band + 3},${base + 32}H${PAD.l + plotW - 3}v-4`} stroke={colors.dim} fill="none" strokeWidth={1} />
            <text x={(PAD.l + provIdx * band + PAD.l + plotW) / 2} y={base + 45} textAnchor="middle" fontSize={10} fill={colors.dim} className="num">
              provisional
            </text>
          </g>
        )}

        {/* floor: a lit baseline and the bars' faint reflections under it */}
        <g aria-hidden pointerEvents="none">
          <rect x={PAD.l} y={base} width={plotW} height={1} fill={`url(#f-${uid})`} opacity={on ? 1 : 0} style={{ transition: reduced ? "none" : "opacity 900ms 200ms" }} />
          {months.map((m, i) => {
            const h = base - y(totals[i] ?? 0);
            if (h <= 0) return null;
            const rh = Math.min(14, h * 0.28);
            return <rect key={m} x={cx(i) - barW / 2} y={base + 2} width={barW} height={rh} rx={1} fill={`url(#r-${uid})`} opacity={dimmed(i) ? 0.3 : 1} style={rise(i, base + 2)} />;
          })}
        </g>

        {/* hover column and crosshair */}
        {hover !== null && (
          <g pointerEvents="none" aria-hidden>
            <rect x={PAD.l + hover * band} y={PAD.t} width={band} height={plotH} fill={colors.ink} fillOpacity={0.035} />
            <line x1={cx(hover)} x2={cx(hover)} y1={PAD.t - 6} y2={base} stroke={colors.ink} strokeOpacity={0.28} strokeWidth={1} />
          </g>
        )}

        {/* hit areas under the columns: hover, keyboard focus, click per month */}
        {months.map((m, i) => (
          <rect
            key={m}
            x={PAD.l + i * band}
            y={PAD.t}
            width={band}
            height={plotH}
            fill={activeMonth === m ? "rgba(255,179,92,0.06)" : "transparent"}
            tabIndex={onMonth ? 0 : -1}
            role={onMonth ? "button" : undefined}
            aria-label={`${monthLabel(m, true)}: ${totals[i]} incidents`}
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
            style={{ pointerEvents: "all" }}
          />
        ))}

        {/* bloom: a blurred copy of the bars behind them */}
        {glow && (
          <g aria-hidden pointerEvents="none" filter={`url(#bloom-${uid})`} opacity={0.5}>
            {months.map((m, i) => (
              <g key={m} opacity={dimmed(i) ? 0.15 : 1} style={rise(i)}>
                {segmentsOf(i).map((s) => (
                  <path key={s.key} d={s.d} fill={activeMonth === m ? colors.accent : single && gradientTop ? `url(#g-${uid})` : s.color} />
                ))}
              </g>
            ))}
          </g>
        )}

        {/* columns */}
        <g>
          {months.map((m, i) => {
            const prov = provIdx >= 0 && i >= provIdx;
            const isActive = activeMonth === m;
            const segs = segmentsOf(i);
            const top = segs[segs.length - 1];
            return (
              <g
                key={m}
                style={rise(i)}
                opacity={dimmed(i) ? 0.32 : prov ? 0.88 : 1}
                className={onMonth ? "cursor-pointer" : undefined}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onClick={() => onMonth?.(m)}
              >
                {segs.map((s) => (
                  <path
                    key={s.key}
                    d={s.d}
                    fill={isActive ? colors.accent : single ? `url(#g-${uid})` : s.color}
                    className={onSegment ? "cursor-pointer" : undefined}
                    onClick={(e) => {
                      if (!onSegment) return;
                      e.stopPropagation();
                      onSegment(m, s.key);
                    }}
                  />
                ))}
                {prov && segs.map((s) => <path key={`h-${s.key}`} d={s.d} fill={`url(#hb-${uid})`} pointerEvents="none" />)}
                {/* the lit data end */}
                {top && barW >= 4 && (
                  <rect x={cx(i) - barW / 2 + 2} y={top.top + 0.5} width={barW - 4} height={1.2} rx={0.6} fill="#fff" fillOpacity={hover === i ? 0.85 : 0.5} pointerEvents="none" />
                )}
              </g>
            );
          })}
        </g>

        {/* trend and average lines */}
        {fit && <path pointerEvents="none" d={fit.map((v, i) => (v === null || v === undefined ? "" : `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(v).toFixed(1)}`)).join("")} fill="none" stroke={colors.dim} strokeWidth={1} strokeDasharray="5 4" opacity={0.75} />}
        {line && lineD && (
          <g pointerEvents="none">
            <path
              ref={lineRef}
              d={lineD}
              fill="none"
              stroke={colors.accent}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              filter={`url(#glow-${uid})`}
              pathLength={lineDone ? undefined : 1}
              strokeDasharray={lineDone ? undefined : 1}
              strokeDashoffset={lineDone ? undefined : 1}
            />
            {/* the head riding the tip while the line draws (moved by the frame loop) */}
            {!lineDone && (
              <g ref={runRef} opacity={0}>
                <circle r={8} fill={colors.accent} fillOpacity={0.22} filter={`url(#glow-${uid})`} />
                <circle r={3.2} fill="#ffe6c4" stroke={colors.accent} strokeWidth={1.5} />
              </g>
            )}
            {lineDone && lineEnd && (
              <g transform={`translate(${lineEnd[0].toFixed(1)},${lineEnd[1].toFixed(1)})`}>
                <circle r={6} fill={colors.accent} fillOpacity={0.35} />
                <circle r={3.2} fill="#ffe6c4" stroke={colors.accent} strokeWidth={1.5} filter={`url(#glow-${uid})`} />
              </g>
            )}
          </g>
        )}

        {/* peak marker */}
        {peak && totals[peakIdx]! > 0 && (
          <g pointerEvents="none" style={{ opacity: on ? 1 : 0, transition: reduced ? "none" : "opacity 500ms 900ms" }}>
            <circle cx={cx(peakIdx)} cy={y(totals[peakIdx]!) - 8} r={4.5} fill="none" stroke={colors.ink} strokeOpacity={0.6} />
            <circle cx={cx(peakIdx)} cy={y(totals[peakIdx]!) - 8} r={2} fill={colors.ink} />
            <text x={Math.min(Math.max(cx(peakIdx), PAD.l + 24), PAD.l + plotW - 24)} y={y(totals[peakIdx]!) - 17} textAnchor="middle" fontSize={11} fill={colors.ink} className="num">
              peak {totals[peakIdx]}
            </text>
          </g>
        )}

        {/* x labels */}
        {monthTicks(n, labelEvery, cx, PAD.l + 18, PAD.l + plotW - 18).map(({ i, at }) => (
          <text key={months[i]} x={at} y={base + 24} textAnchor="middle" fontSize={11} fill={hover === i ? colors.ink : colors.axis} className="num">
            {monthLabel(months[i]!)}
          </text>
        ))}
      </svg>

      {tip !== null && (
        <div
          className={`pointer-events-none absolute z-10 rounded-[5px] border border-line bg-[color-mix(in_oklab,var(--color-panel)_94%,transparent)] p-3 text-[12px] shadow-[0_14px_40px_rgba(0,0,0,0.55)] backdrop-blur ${tooltipClassName}`}
          style={{ left: tipLeft, top: PAD.t - 6, width: TIP_W }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-soft">{monthLabel(months[tip]!, true)}</span>
            <span className="num text-[18px] font-semibold leading-none text-ink">{totals[tip]}</span>
          </div>
          {!single && (
            <ul className="mt-2 space-y-1">
              {stacks
                .map((s) => ({ s, v: s.values[tip] ?? 0 }))
                .filter((e) => e.v > 0)
                .sort((a, b) => b.v - a.v)
                .slice(0, 7)
                .map(({ s, v }) => (
                  <li key={s.key} className="flex items-center justify-between gap-2 text-dim">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="inline-block h-[2px] w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="truncate">{s.label}</span>
                    </span>
                    <span className="num text-ink">{v}</span>
                  </li>
                ))}
            </ul>
          )}
          {partsTotal > 0 && (
            <>
              <div className="mt-2.5 flex h-1.5 gap-[2px]" aria-hidden>
                {parts.map(({ b, v }, k) => (
                  <span key={b.key} className={`${k === 0 ? "rounded-l-full" : ""} ${k === parts.length - 1 ? "rounded-r-full" : ""}`} style={{ flexGrow: v, flexBasis: 0, minWidth: 2, background: b.color }} />
                ))}
              </div>
              <ul className="mt-2 space-y-1">
                {topParts.map(({ b, v }) => (
                  <li key={b.key} className="flex items-center justify-between gap-2 text-dim">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="inline-block h-[2px] w-2.5 shrink-0 rounded-full" style={{ background: b.color }} />
                      <span className="truncate">{b.label}</span>
                    </span>
                    <span className="num text-ink">{v}</span>
                  </li>
                ))}
              </ul>
              {parts.length > topParts.length && <div className="mt-1 text-[11px] text-faint">and {parts.length - topParts.length} more</div>}
            </>
          )}
          {line && line[tip] !== null && line[tip] !== undefined && (
            <div className="mt-2 flex items-center justify-between gap-2 text-dim">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-[2px] w-2.5 rounded-full bg-accent" />
                {lineLabel}
              </span>
              <span className="num text-soft">{line[tip]!.toFixed(1)}</span>
            </div>
          )}
          {provIdx >= 0 && tip >= provIdx && <div className="mt-1.5 text-[11px] text-faint">provisional: reports still arriving</div>}
          {onMonth && <div className="mt-2 border-t border-line-soft pt-1.5 text-[11px] text-faint">click for the incidents</div>}
        </div>
      )}
    </div>
  );
}
