"use client";

import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TooltipBox, type RechartsTooltipProps } from "@/components/charts/ChartTooltip";
import { monthLabel } from "@/lib/format";
import type { LabTheme } from "@/lib/lab/themes";
import type { TrendPoint } from "@/lib/stats";

interface Props {
  data: TrendPoint[];
  theme: LabTheme;
  provisionalFrom?: string;
  height?: number;
  activeMonth?: string | null;
  /** Gradient bars with a soft glow (cinematic draft). */
  glow?: boolean;
  onBarClick?: (month: string) => void;
}

function TrendTooltip({ active, payload, label, theme }: RechartsTooltipProps & { theme: LabTheme }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as TrendPoint | undefined;
  if (!p) return null;
  return (
    <TooltipBox
      title={`${monthLabel(String(label), true)} · click for incidents`}
      rows={[
        { label: "incidents", value: p.total, color: theme.bar },
        ...(p.ma !== null ? [{ label: "3-month average", value: p.ma.toFixed(1), color: theme.trend }] : []),
        { label: "linear trend", value: p.fit.toFixed(1), color: theme.dim },
      ]}
    />
  );
}

/**
 * Monthly incidents with a 3-month average and linear fit. Dataviz specs:
 * bars capped at 24px with 4px rounded data-ends, solid hairline grid, the
 * peak direct-labelled once, provisional months shaded.
 */
export function LabTrend({ data, theme, provisionalFrom, height = 380, activeMonth = null, glow = false, onBarClick }: Props) {
  const provisionalStart = provisionalFrom ? data.find((d) => d.month >= provisionalFrom)?.month : undefined;
  const last = data[data.length - 1]?.month;
  const peak = data.reduce<TrendPoint | null>((m, p) => (!m || p.total > m.total ? p : m), null);
  const gid = `bar-${theme.name}`;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 22, right: 10, bottom: 0, left: -10 }} barCategoryGap="18%">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.accent} stopOpacity={0.95} />
              <stop offset="55%" stopColor={theme.bar} stopOpacity={0.85} />
              <stop offset="100%" stopColor={theme.bar} stopOpacity={0.35} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={theme.grid} />
          <XAxis dataKey="month" tickFormatter={(v: string) => monthLabel(v)} tickLine={false} axisLine={{ stroke: theme.grid }} minTickGap={28} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
          {provisionalStart && last && (
            <ReferenceArea
              x1={provisionalStart}
              x2={last}
              fill={theme.provisional}
              strokeOpacity={0}
              ifOverflow="extendDomain"
              label={{ value: "provisional", position: "insideTopRight", fill: theme.dim, fontSize: 11 }}
            />
          )}
          <Tooltip content={<TrendTooltip theme={theme} />} cursor={{ fill: "rgba(140,160,210,0.07)" }} />
          <Bar
            dataKey="total"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive
            animationDuration={800}
            animationEasing="ease-out"
            className={onBarClick ? "cursor-pointer" : undefined}
            onClick={(d: { payload?: TrendPoint }) => d?.payload && onBarClick?.(d.payload.month)}
            style={glow ? { filter: `drop-shadow(0 0 6px ${theme.accent}40)` } : undefined}
          >
            {data.map((p) => (
              <Cell key={p.month} fill={p.month === activeMonth ? theme.accent : glow ? `url(#${gid})` : theme.bar} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="ma" stroke={theme.trend} strokeWidth={2} dot={false} connectNulls isAnimationActive animationDuration={1500} />
          <Line type="linear" dataKey="fit" stroke={theme.dim} strokeDasharray="5 4" strokeWidth={1} dot={false} isAnimationActive={false} />
          {peak && peak.total > 0 && (
            <ReferenceDot x={peak.month} y={peak.total} r={0} ifOverflow="extendDomain" label={{ value: `peak ${peak.total}`, position: "top", fill: theme.ink, fontSize: 11 }} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
