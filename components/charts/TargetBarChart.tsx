"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BAR_COLOR, UI } from "@/lib/palette";
import type { CountRow } from "@/lib/stats";
import { TARGET_META, type Target } from "@/lib/taxonomy";
import { TooltipBox, type RechartsTooltipProps } from "./ChartTooltip";

interface Props {
  data: CountRow<Target>[];
  /** Show only the top N targets. */
  limit?: number;
  height?: number;
  color?: string;
  highlight?: Target[];
  onBarClick?: (target: Target) => void;
}

function TargetTooltip({ active, payload }: RechartsTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as { key: Target; count: number } | undefined;
  if (!row) return null;
  return <TooltipBox title={TARGET_META[row.key].label} rows={[{ label: "incidents", value: row.count }]} />;
}

export function TargetBarChart({ data, limit = 10, height, color = BAR_COLOR, highlight = [], onBarClick }: Props) {
  const rows = data.filter((r) => r.count > 0).slice(0, limit).map((r) => ({ ...r, label: TARGET_META[r.key].label }));
  const h = height ?? Math.max(140, rows.length * 30 + 16);
  return (
    <div style={{ height: h }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap="28%">
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={176} tickLine={false} axisLine={false} interval={0} />
          <Tooltip content={<TargetTooltip />} cursor={{ fill: "rgba(140,160,210,0.08)" }} />
          <Bar
            dataKey="count"
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
            className={onBarClick ? "cursor-pointer" : undefined}
            onClick={(d: { payload?: { key: Target } }) => d?.payload && onBarClick?.(d.payload.key)}
          >
            {rows.map((r) => (
              <Cell key={r.key} fill={highlight.includes(r.key) ? UI.accent : color} />
            ))}
            <LabelList dataKey="count" position="right" className="num" style={{ fill: UI.soft, fontSize: 12 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
