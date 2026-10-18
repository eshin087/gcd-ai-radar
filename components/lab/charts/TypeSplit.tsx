"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TooltipBox, type RechartsTooltipProps } from "@/components/charts/ChartTooltip";
import { monthLabel } from "@/lib/format";
import type { LabTheme } from "@/lib/lab/themes";
import type { MonthlyPoint } from "@/lib/stats";
import { INCIDENT_TYPES, TYPE_META, type IncidentType } from "@/lib/taxonomy";

function TypeTooltip({ active, payload, label, theme }: RechartsTooltipProps & { theme: LabTheme }) {
  if (!active || !payload?.length) return null;
  return (
    <TooltipBox
      title={monthLabel(String(label), true)}
      rows={payload.map((e) => ({ label: TYPE_META[e.dataKey as IncidentType].label, value: Number(e.value), color: theme.types[e.dataKey as IncidentType] }))}
    />
  );
}

/** Attacks on AI vs AI-enabled attacks per month, stacked with a surface gap. */
export function TypeSplit({ data, theme, height = 300, onBarClick }: { data: MonthlyPoint[]; theme: LabTheme; height?: number; onBarClick?: (month: string, type: IncidentType) => void }) {
  const rows = data.map((p) => ({ month: p.month, ...p.byType }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -10 }} barCategoryGap="16%">
          <CartesianGrid vertical={false} stroke={theme.grid} />
          <XAxis dataKey="month" tickFormatter={(v: string) => monthLabel(v)} tickLine={false} axisLine={{ stroke: theme.grid }} minTickGap={28} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<TypeTooltip theme={theme} />} cursor={{ fill: "rgba(140,160,210,0.07)" }} />
          {INCIDENT_TYPES.map((t, i) => (
            <Bar
              key={t}
              dataKey={t}
              stackId="type"
              maxBarSize={24}
              fill={theme.types[t]}
              stroke={theme.surface}
              strokeWidth={1}
              radius={i === INCIDENT_TYPES.length - 1 ? [4, 4, 0, 0] : undefined}
              isAnimationActive
              animationDuration={700}
              className={onBarClick ? "cursor-pointer" : undefined}
              onClick={(d: { payload?: { month: string } }) => d?.payload && onBarClick?.(d.payload.month, t)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
