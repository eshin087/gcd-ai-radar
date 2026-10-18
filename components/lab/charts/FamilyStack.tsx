"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TooltipBox, type RechartsTooltipProps } from "@/components/charts/ChartTooltip";
import { FAMILIES, FAMILY_META, type Family } from "@/lib/families";
import { monthLabel } from "@/lib/format";
import type { LabTheme } from "@/lib/lab/themes";
import type { FamilyPoint } from "../useDashboardModel";

function FamTooltip({ active, payload, label, theme }: RechartsTooltipProps & { theme: LabTheme }) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((e) => Number(e.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value))
    .map((e) => ({ label: FAMILY_META[e.dataKey as Family]?.label ?? String(e.dataKey), value: Number(e.value), color: theme.families[e.dataKey as Family] }));
  const total = payload[0]?.payload?.total as number | undefined;
  return <TooltipBox title={`${monthLabel(String(label), true)} · ${total ?? 0}`} rows={rows} />;
}

/** Monthly incidents stacked by family (7 validated hues + Other), 2px surface gap between segments. */
export function FamilyStack({ data, theme, height = 300, onSegmentClick }: { data: FamilyPoint[]; theme: LabTheme; height?: number; onSegmentClick?: (month: string, family: Family) => void }) {
  const rows = data.map((p) => ({ month: p.month, total: p.total, ...p.values }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 22, bottom: 0, left: -10 }} barCategoryGap="16%">
          <CartesianGrid vertical={false} stroke={theme.grid} />
          <XAxis dataKey="month" tickFormatter={(v: string) => monthLabel(v)} tickLine={false} axisLine={{ stroke: theme.grid }} minTickGap={28} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<FamTooltip theme={theme} />} cursor={{ fill: "rgba(140,160,210,0.07)" }} />
          {FAMILIES.map((f) => (
            <Bar
              key={f}
              dataKey={f}
              stackId="fam"
              maxBarSize={24}
              fill={theme.families[f]}
              stroke={theme.surface}
              strokeWidth={1}
              isAnimationActive
              animationDuration={700}
              className={onSegmentClick ? "cursor-pointer" : undefined}
              onClick={(d: { payload?: { month: string } }) => d?.payload && onSegmentClick?.(d.payload.month, f)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
