"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monthLabel } from "@/lib/format";
import { CATEGORY_COLORS } from "@/lib/palette";
import type { MonthlyPoint } from "@/lib/stats";
import { CATEGORIES, CATEGORY_META, type Category } from "@/lib/taxonomy";
import { TooltipBox, type RechartsTooltipProps } from "./ChartTooltip";

interface Props {
  data: MonthlyPoint[];
  /** Subset and order of categories to stack; defaults to all, in taxonomy order. */
  categories?: readonly Category[];
  height?: number;
  compact?: boolean;
  /** Show shares (0-100%) instead of counts. */
  percent?: boolean;
  onSegmentClick?: (month: string, category: Category) => void;
}

function flatten(data: MonthlyPoint[], categories: readonly Category[], percent: boolean) {
  return data.map((p) => {
    const row: Record<string, number | string> = { month: p.month, total: p.total };
    for (const c of categories) {
      const v = p.byCategory[c];
      row[c] = percent ? (p.total ? (v / p.total) * 100 : 0) : v;
    }
    return row;
  });
}

function StackTooltip({ active, payload, label }: RechartsTooltipProps) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((e) => Number(e.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value))
    .map((e) => ({
      label: CATEGORY_META[e.dataKey as Category]?.label ?? String(e.dataKey),
      value: Number(e.value) % 1 === 0 ? Number(e.value) : `${Number(e.value).toFixed(0)}%`,
      color: e.fill ?? e.color,
    }));
  const total = payload[0]?.payload?.total;
  return <TooltipBox title={`${monthLabel(String(label), true)} · ${total ?? ""}`} rows={rows} />;
}

export function CategoryStackChart({ data, categories = CATEGORIES, height = 260, compact = false, percent = false, onSegmentClick }: Props) {
  const rows = flatten(data, categories, percent);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: compact ? 0 : -12 }} barCategoryGap="18%">
          {!compact && <CartesianGrid vertical={false} />}
          <XAxis dataKey="month" tickFormatter={(v: string) => monthLabel(v)} tickLine={false} axisLine={false} minTickGap={32} hide={compact} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} hide={compact} domain={percent ? [0, 100] : undefined} tickFormatter={(v: number) => (percent ? `${v}%` : String(v))} />
          <Tooltip content={<StackTooltip />} cursor={{ fill: "rgba(140,160,210,0.08)" }} />
          {categories.map((c) => (
            <Bar
              key={c}
              dataKey={c}
              stackId="cat"
              fill={CATEGORY_COLORS[c]}
              isAnimationActive={false}
              className={onSegmentClick ? "cursor-pointer" : undefined}
              onClick={(d: { payload?: { month: string } }) => d?.payload && onSegmentClick?.(d.payload.month, c)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
