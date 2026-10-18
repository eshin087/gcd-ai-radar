"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SEVERITY_COLORS, UI } from "@/lib/palette";
import type { CountRow } from "@/lib/stats";
import { SEVERITY_META, type Severity } from "@/lib/taxonomy";
import { TooltipBox, type RechartsTooltipProps } from "./ChartTooltip";

interface Props {
  data: CountRow<`${Severity}`>[];
  variant?: "bars" | "strip";
  height?: number;
}

function SevTooltip({ active, payload }: RechartsTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as { key: `${Severity}`; count: number } | undefined;
  if (!row) return null;
  const s = Number(row.key) as Severity;
  return <TooltipBox title={`${s} · ${SEVERITY_META[s].label}`} rows={[{ label: "incidents", value: row.count }]} />;
}

/** Four vertical bars, or a single 100% strip with a legend below. */
export function SeverityChart({ data, variant = "bars", height }: Props) {
  const total = data.reduce((s, r) => s + r.count, 0) || 1;
  if (variant === "strip") {
    return (
      <div className="space-y-3">
        <div className="flex h-3 w-full overflow-hidden rounded-[2px] bg-panel-2" role="img" aria-label="Severity distribution">
          {data.map((r) => (
            <div
              key={r.key}
              style={{ width: `${(r.count / total) * 100}%`, background: SEVERITY_COLORS[Number(r.key) as Severity] }}
              title={`${SEVERITY_META[Number(r.key) as Severity].label}: ${r.count}`}
            />
          ))}
        </div>
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {data.map((r) => {
            const s = Number(r.key) as Severity;
            return (
              <li key={r.key} className="flex items-start gap-2">
                <span className="mt-1 inline-block size-2.5 rounded-[2px]" style={{ background: SEVERITY_COLORS[s] }} />
                <div>
                  <div className="num text-[15px] leading-none text-ink">{r.count}</div>
                  <div className="label mt-1">
                    {s} {SEVERITY_META[s].short}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  const rows = data.map((r) => ({ ...r, label: `${r.key} ${SEVERITY_META[Number(r.key) as Severity].short}` }));
  return (
    <div style={{ height: height ?? 180 }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} />
          <YAxis hide allowDecimals={false} />
          <Tooltip content={<SevTooltip />} cursor={{ fill: "rgba(140,160,210,0.08)" }} />
          <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.key} fill={SEVERITY_COLORS[Number(r.key) as Severity]} />
            ))}
            <LabelList dataKey="count" position="top" style={{ fill: UI.soft, fontSize: 10.5 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
