"use client";

import { Fragment, useId } from "react";
import { niceStep, useWidth } from "./hooks";

export interface ColumnPeriod {
  key: string;
  /** The full label, for the accessible name and the tooltip ("2024", "2026-Q3", "Oct 2025"). */
  label: string;
  /** The axis label when it differs from the full one ("'24", "Q3", "Oct"). */
  short?: string;
  /** One value per stack, bottom to top. */
  values: number[];
  /** An open period, drawn hatched. */
  provisional?: boolean;
  /** One more line for the tooltip ("3 breaches"). */
  note?: string;
}

interface Props {
  periods: ColumnPeriod[];
  /** One colour per stack. */
  colors: string[];
  /** One name per stack, for the tooltip; omitted for a single stack. */
  stackLabels?: string[];
  /** What a column counts, for the accessible name: "<label>: <n> <unit>". */
  unit: string;
  /** The data-chart name, for the check scripts. */
  name: string;
  onPick?: (key: string) => void;
  active?: string | null;
  height?: number;
  /** A square-root scale keeps a few huge periods from flattening the rest; the axis says so. */
  scale?: "linear" | "sqrt";
  /** Axis number formatting. */
  format?: (n: number) => string;
  /** Draw every n-th axis label; chosen from the width when omitted. */
  labelEvery?: number;
  className?: string;
}

const LEFT = 44;
const RIGHT = 6;
const TOP = 8;
const BOTTOM = 22;

function compact(n: number): string {
  if (n >= 1e9) return `${Math.round(n / 1e8) / 10}B`;
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

/**
 * Columns by period, lean: one rect per stack per period, a hit rect per
 * period that is a button when the chart opens lists, four gridlines, the
 * provisional period hatched. No gradients, bloom or reflections; about a
 * quarter of the markup of MonthlyColumns, which stays with /trends.
 */
export function Columns({ periods, colors, stackLabels, unit, name, onPick, active, height = 200, scale = "linear", format = compact, labelEvery, className = "" }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const patternId = useId().replace(/:/g, "");
  const totals = periods.map((p) => p.values.reduce((s, v) => s + v, 0));
  const max = Math.max(1, ...totals);
  const plotW = Math.max(40, width - LEFT - RIGHT);
  const plotH = Math.max(40, height - TOP - BOTTOM);
  const n = Math.max(1, periods.length);
  /** One decimal is finer than a pixel and keeps the markup short: full-precision floats cost about a quarter of the chart's bytes. */
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const slot = plotW / n;
  const barW = r1(Math.max(2, Math.min(slot * 0.72, 48)));
  const y = (v: number) => r1((scale === "sqrt" ? Math.sqrt(v / max) : v / max) * plotH);
  /** A gridline's height in the svg (and its label's, `dy` lower), rounded again: the sum brings back float noise ("19.900000000000006"). */
  const gy = (t: number, dy = 0) => r1(TOP + plotH - y(t) + dy);
  const step = niceStep(max / 4);
  const ticks: number[] = [];
  for (let t = step; t <= max * 1.0001 && ticks.length < 8; t += step) ticks.push(t);
  const every = labelEvery ?? Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));
  // each period's stacks, bottom to top: the top edge and the height, empty ones left out
  const cols = periods.map((p, i) => {
    let acc = 0;
    const bars = p.values.flatMap((v, k) => {
      const h0 = y(acc);
      acc += v;
      const h1 = y(acc);
      const hh = r1(Math.max(0, h1 - h0));
      return hh === 0 ? [] : [{ k, top: TOP + plotH - h1, hh }];
    });
    return { p, i, x: r1(LEFT + i * slot + (slot - barW) / 2), total: totals[i]!, bars };
  });
  const stacks = Math.max(0, ...periods.map((p) => p.values.length));

  // What the columns share sits on a group, once per chart rather than once per column (this markup was most of the home
  // page's HTML). Columns never overlap, so drawing a stack at a time paints what drawing a period at a time did.
  return (
    <div ref={ref} data-chart={name} className={`w-full ${className}`}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`${name}: ${periods.length} periods`}
        className="block overflow-visible [&_[role=button]]:cursor-pointer [&_[role=button]]:outline-none [&_[role=button]:focus-visible]:stroke-[var(--color-accent)]"
      >
        <defs>
          <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" />
          </pattern>
        </defs>
        {/* gridlines and the axis */}
        <g stroke="var(--color-line-soft)">
          {ticks.map((t) => (
            <line key={t} x1={LEFT} x2={LEFT + plotW} y1={gy(t)} y2={gy(t)} />
          ))}
        </g>
        <g textAnchor="end" className="num" fontSize="11" fill="var(--color-faint)">
          {ticks.map((t) => (
            <text key={t} x={LEFT - 6} y={gy(t, 4)}>
              {format(t)}
            </text>
          ))}
        </g>
        <line x1={LEFT} x2={LEFT + plotW} y1={TOP + plotH + 0.5} y2={TOP + plotH + 0.5} stroke="var(--color-line)" />
        {scale === "sqrt" && (
          <text x={LEFT + plotW} y={TOP - 1} textAnchor="end" fontSize="10" fill="var(--color-faint)">
            square-root scale
          </text>
        )}
        {/* columns, a stack at a time; fill-opacity is opacity for a plain fill, and the active or open period sets its own */}
        {Array.from({ length: stacks }, (_, k) => (
          <g key={k} fill={colors[k] ?? colors[0]} fillOpacity={0.85}>
            {cols.map(({ p, x, bars }) => {
              const b = bars.find((s) => s.k === k);
              return b && <rect key={p.key} x={x} width={barW} y={b.top} height={b.hh} fillOpacity={p.provisional ? 0.35 : active === p.key ? 1 : undefined} />;
            })}
          </g>
        ))}
        {cols.flatMap(({ p, x, bars }) =>
          p.provisional ? bars.map((b) => <rect key={`${p.key}:${b.k}`} x={x} width={barW} y={b.top} height={b.hh} fill={`url(#${patternId})`} color={colors[b.k] ?? colors[0]} opacity={0.7} />) : [],
        )}
        <g fill="var(--color-line)">
          {cols
            .filter((c) => c.total === 0)
            .map(({ p, x }) => (
              <rect key={p.key} x={x} width={barW} y={TOP + plotH - 1} height={1} />
            ))}
        </g>
        {/* labels and hit rects period by period, as before: the next label still draws over a focused column's outline */}
        <g textAnchor="middle" className="num" fontSize="11" fill="var(--color-dim)">
          {cols.map(({ p, i, x, total }) => {
            const isActive = active === p.key;
            // one string, one text node: two adjacent text children inside an SVG <title> do not hydrate
            const tip = `${stackLabels ? `${p.label}: ${total} ${unit} (${p.values.map((v, k) => `${stackLabels[k] ?? k}: ${v}`).join(", ")})` : `${p.label}: ${total} ${unit}`}${p.note ? ` · ${p.note}` : ""}${p.provisional ? " · so far" : ""}`;
            return (
              <Fragment key={p.key}>
                {(p.short !== undefined ? p.short !== "" : i % every === 0) && (
                  <text x={r1(x + barW / 2)} y={TOP + plotH + 15}>
                    {p.short ?? p.label}
                  </text>
                )}
                {onPick ? (
                  <rect
                    role="button"
                    tabIndex={0}
                    aria-label={`${p.label}: ${total} ${unit}`}
                    aria-pressed={isActive}
                    x={r1(LEFT + i * slot)}
                    width={r1(slot)}
                    y={TOP}
                    height={plotH + BOTTOM}
                    fill="transparent"
                    onClick={() => onPick(p.key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onPick(p.key);
                      }
                    }}
                  >
                    <title>{tip}</title>
                  </rect>
                ) : (
                  <rect x={r1(LEFT + i * slot)} width={r1(slot)} y={TOP} height={plotH + BOTTOM} fill="transparent">
                    <title>{tip}</title>
                  </rect>
                )}
              </Fragment>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
