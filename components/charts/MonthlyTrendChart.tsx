"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { monthLabel } from "@/lib/format";
import { BAR_COLOR, PROVISIONAL_FILL, TREND_COLOR, UI } from "@/lib/palette";
import type { TrendPoint } from "@/lib/stats";
import { TooltipBox, type RechartsTooltipProps } from "./ChartTooltip";

interface Props {
  data: TrendPoint[];
  /** First month considered provisional (reporting lag). */
  provisionalFrom?: string;
  height?: number;
  /** Hide axes and grid for sparkline-like use. */
  compact?: boolean;
  showFit?: boolean;
  showMa?: boolean;
  barColor?: string;
}

function TrendTooltip({ active, payload, label }: RechartsTooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as TrendPoint | undefined;
  if (!p) return null;
  return (
    <TooltipBox
      title={monthLabel(String(label), true)}
      rows={[
        { label: "incidents", value: p.total, color: BAR_COLOR },
        ...(p.ma !== null ? [{ label: "3-mo average", value: p.ma.toFixed(1), color: TREND_COLOR }] : []),
        { label: "linear trend", value: p.fit.toFixed(1), color: UI.dim },
      ]}
    />
  );
}

export function MonthlyTrendChart({
  data,
  provisionalFrom,
  height = 260,
  compact = false,
  showFit = true,
  showMa = true,
  barColor = BAR_COLOR,
}: Props) {
  const provisionalStart = provisionalFrom ? data.find((d) => d.month >= provisionalFrom)?.month : undefined;
  const last = data[data.length - 1]?.month;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: compact ? 0 : -16 }} barCategoryGap="25%">
          {!compact && <CartesianGrid vertical={false} />}
          <XAxis
            dataKey="month"
            tickFormatter={(v: string) => monthLabel(v)}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            hide={compact}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} hide={compact} />
          {provisionalStart && last && (
            <ReferenceArea x1={provisionalStart} x2={last} fill={PROVISIONAL_FILL} strokeOpacity={0} ifOverflow="extendDomain" />
          )}
          <Tooltip content={<TrendTooltip />} cursor={{ fill: "rgba(140,160,210,0.08)" }} />
          <Bar dataKey="total" fill={barColor} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          {showMa && (
            <Line type="monotone" dataKey="ma" stroke={TREND_COLOR} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          )}
          {showFit && (
            <Line type="linear" dataKey="fit" stroke={UI.dim} strokeDasharray="4 4" strokeWidth={1.2} dot={false} isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
