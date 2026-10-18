"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "@/components/fx/useReducedMotion";
import { monthLabel } from "@/lib/format";

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
  provisionalFrom?: string;
  height?: number;
  colors: ColumnColors;
  /** Single-series bars fade from this colour at the top into the stack colour. */
  gradientTop?: string;
  glow?: boolean;
  /** Label the tallest column. */
  peak?: boolean;
  activeMonth?: string | null;
  onMonth?: (month: string) => void;
  onSegment?: (month: string, key: string) => void;
  /** Accessible name for the chart. */
  label: string;
  tooltipClassName?: string;
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

const PAD = { l: 40, r: 14, t: 26, b: 42 };

/**
 * Monthly column chart drawn in SVG: solid stacked segments with a 1.5px gap,
 * rounded data-ends, optional glow, an average line that draws itself in,
 * provisional months bracketed under the axis, hover breakdown and click-through
 * (a segment opens that slice, the column opens the month). Columns grow in
 * the first time the chart scrolls into view.
 */
export function MonthlyColumns({
  months,
  stacks,
  line,
  lineLabel = "3-month average",
  fit,
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
  const [width, setWidth] = useState(720);
  const [shown, setShown] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion();

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
  const barW = Math.max(2, Math.min(24, band * 0.66));
  const y = (v: number) => PAD.t + plotH * (1 - v / ymax);
  const cx = (i: number) => PAD.l + (i + 0.5) * band;
  const peakIdx = totals.reduce((best, v, i) => (v > (totals[best] ?? -1) ? i : best), 0);
  const provIdx = provisionalFrom ? months.findIndex((m) => m >= provisionalFrom) : -1;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, plotW / 62)));
  const single = stacks.length === 1;

  const linePath = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || v === undefined) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${cx(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const tip = hover !== null ? hover : null;
  const tipLeft = tip === null ? 0 : Math.min(Math.max(cx(tip) - 95, 0), width - 190);

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label} className="absolute inset-0 block overflow-visible">
        <defs>
          {single && gradientTop && (
            <linearGradient id={`g-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gradientTop} stopOpacity={0.98} />
              <stop offset="55%" stopColor={stacks[0]!.color} stopOpacity={0.9} />
              <stop offset="100%" stopColor={stacks[0]!.color} stopOpacity={0.4} />
            </linearGradient>
          )}
          <filter id={`glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
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

        {/* provisional band, bracketed under the axis */}
        {provIdx >= 0 && (
          <g aria-hidden>
            <rect x={PAD.l + provIdx * band} y={PAD.t} width={PAD.l + plotW - (PAD.l + provIdx * band)} height={plotH} fill={colors.provisional} />
            <path
              d={`M${PAD.l + provIdx * band + 3},${base + 24}v-4M${PAD.l + provIdx * band + 3},${base + 24}H${PAD.l + plotW - 3}v-4`}
              stroke={colors.dim}
              fill="none"
              strokeWidth={1}
            />
            <text x={(PAD.l + provIdx * band + PAD.l + plotW) / 2} y={base + 37} textAnchor="middle" fontSize={10} fill={colors.dim} className="num">
              provisional
            </text>
          </g>
        )}

        {/* hit areas under the columns: hover highlight, keyboard focus, click per month */}
        {months.map((m, i) => (
          <rect
            key={m}
            x={PAD.l + i * band}
            y={PAD.t}
            width={band}
            height={plotH}
            fill={hover === i || activeMonth === m ? "rgba(160,180,220,0.07)" : "transparent"}
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
        {/* columns */}
        <g filter={glow ? `url(#glow-${uid})` : undefined}>
          {months.map((m, i) => {
            const x = cx(i) - barW / 2;
            const prov = provIdx >= 0 && i >= provIdx;
            const isActive = activeMonth === m;
            const segs: { key: string; color: string; top: number; bottom: number }[] = [];
            let acc = 0;
            for (const st of stacks) {
              const v = st.values[i] ?? 0;
              if (v <= 0) continue;
              const bottom = y(acc);
              acc += v;
              segs.push({ key: st.key, color: st.color, top: y(acc), bottom });
            }
            return (
              <g
                key={m}
                style={{
                  transform: shown ? "scaleY(1)" : "scaleY(0)",
                  transformOrigin: `0px ${base}px`,
                  transition: reduced ? "none" : `transform 760ms cubic-bezier(.2,.7,.2,1) ${i * 22}ms`,
                }}
                opacity={prov ? 0.6 : 1}
                className={onMonth ? "cursor-pointer" : undefined}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onClick={() => onMonth?.(m)}
              >
                {segs.map((s, k) => {
                  const isTop = k === segs.length - 1;
                  const bottom = s.bottom - (k > 0 ? 1.5 : 0);
                  const top = Math.min(s.top, bottom - 1.5);
                  const h = bottom - top;
                  const r = isTop ? Math.min(4, h, barW / 2) : 0;
                  const d = `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${bottom}Z`;
                  return (
                    <path
                      key={s.key}
                      d={d}
                      fill={isActive ? colors.accent : single && gradientTop ? `url(#g-${uid})` : s.color}
                      className={onSegment ? "cursor-pointer" : undefined}
                      onClick={(e) => {
                        if (!onSegment) return;
                        e.stopPropagation();
                        onSegment(m, s.key);
                      }}
                    />
                  );
                })}
              </g>
            );
          })}
        </g>

        {/* average and trend lines */}
        {fit && <path pointerEvents="none" d={linePath(fit)} fill="none" stroke={colors.dim} strokeWidth={1} strokeDasharray="5 4" opacity={0.8} />}
        {line && (
          <path
            pointerEvents="none"
            d={linePath(line)}
            fill="none"
            stroke={colors.accent}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={shown ? 0 : 1}
            style={{ transition: reduced ? "none" : "stroke-dashoffset 1400ms cubic-bezier(.3,.6,.2,1) 300ms" }}
            filter={`url(#glow-${uid})`}
          />
        )}

        {/* peak label */}
        {peak && totals[peakIdx]! > 0 && (
          <text pointerEvents="none" x={Math.min(Math.max(cx(peakIdx), PAD.l + 24), PAD.l + plotW - 24)} y={y(totals[peakIdx]!) - 8} textAnchor="middle" fontSize={11} fill={colors.ink} className="num" style={{ opacity: shown ? 1 : 0, transition: "opacity 400ms 700ms" }}>
            peak {totals[peakIdx]}
          </text>
        )}

        {/* x labels */}
        {months.map((m, i) =>
          (n - 1 - i) % labelEvery === 0 ? (
            <text key={m} x={Math.min(Math.max(cx(i), PAD.l + 18), PAD.l + plotW - 18)} y={base + 15} textAnchor="middle" fontSize={11} fill={colors.axis} className="num">
              {monthLabel(m)}
            </text>
          ) : null,
        )}

      </svg>

      {tip !== null && (
        <div className={`pointer-events-none absolute top-0 z-10 w-[190px] rounded-[4px] border border-line bg-panel/95 p-2.5 text-[12px] shadow-xl backdrop-blur ${tooltipClassName}`} style={{ left: tipLeft }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-soft">{monthLabel(months[tip]!, true)}</span>
            <span className="num text-[14px] font-semibold text-ink">{totals[tip]}</span>
          </div>
          {!single && (
            <ul className="mt-1.5 space-y-0.5">
              {stacks
                .map((s) => ({ s, v: s.values[tip] ?? 0 }))
                .filter((e) => e.v > 0)
                .sort((a, b) => b.v - a.v)
                .slice(0, 7)
                .map(({ s, v }) => (
                  <li key={s.key} className="flex items-center justify-between gap-2 text-dim">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="inline-block size-2 shrink-0 rounded-[2px]" style={{ background: s.color }} />
                      <span className="truncate">{s.label}</span>
                    </span>
                    <span className="num text-ink">{v}</span>
                  </li>
                ))}
            </ul>
          )}
          {line && line[tip] !== null && line[tip] !== undefined && (
            <div className="mt-1.5 flex justify-between text-dim">
              <span>{lineLabel}</span>
              <span className="num text-accent">{line[tip]!.toFixed(1)}</span>
            </div>
          )}
          {provIdx >= 0 && tip >= provIdx && <div className="mt-1 text-[11px] text-faint">provisional: reporting lag</div>}
          <div className="mt-1 text-[11px] text-faint">click for the incidents</div>
        </div>
      )}
    </div>
  );
}
