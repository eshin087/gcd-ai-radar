"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monthLabel } from "@/lib/format";
import { TYPE_COLORS } from "@/lib/palette";
import type { MonthlyPoint } from "@/lib/stats";
import { INCIDENT_TYPES, TYPE_META, type IncidentType } from "@/lib/taxonomy";
import { TooltipBox, type RechartsTooltipProps } from "./ChartTooltip";

interface Props {
  data: MonthlyPoint[];
  height?: number;
  compact?: boolean;
  variant?: "area" | "bars";
  onBarClick?: (month: string, type: IncidentType) => void;
}

function TypeTooltip({ active, payload, label }: RechartsTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <TooltipBox
      title={monthLabel(String(label), true)}
      rows={payload.map((e) => ({
        label: TYPE_META[e.dataKey as keyof typeof TYPE_META]?.label ?? String(e.dataKey),
        value: Number(e.value),
        color: e.color ?? e.fill,
      }))}
    />
  );
}

export function TypeAreaChart({ data, height = 240, compact = false, variant = "area", onBarClick }: Props) {
  const rows = data.map((p) => ({ month: p.month, ...p.byType }));
  const axes = (
    <>
      {!compact && <CartesianGrid vertical={false} />}
      <XAxis dataKey="month" tickFormatter={(v: string) => monthLabel(v)} tickLine={false} axisLine={false} minTickGap={32} hide={compact} />
      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} hide={compact} />
      <Tooltip content={<TypeTooltip />} cursor={{ fill: "rgba(140,160,210,0.08)" }} />
    </>
  );
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {variant === "area" ? (
          <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: compact ? 0 : -12 }}>
            {axes}
            {INCIDENT_TYPES.map((t) => (
              <Area
                key={t}
                type="monotone"
                dataKey={t}
                stackId="type"
                stroke={TYPE_COLORS[t]}
                fill={TYPE_COLORS[t]}
                fillOpacity={0.35}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        ) : (
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: compact ? 0 : -12 }} barCategoryGap="18%">
            {axes}
            {INCIDENT_TYPES.map((t) => (
              <Bar
                key={t}
                dataKey={t}
                stackId="type"
                fill={TYPE_COLORS[t]}
                isAnimationActive={false}
                className={onBarClick ? "cursor-pointer" : undefined}
                onClick={(d: { payload?: { month: string } }) => d?.payload && onBarClick?.(d.payload.month, t)}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
