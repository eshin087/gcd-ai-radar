"use client";

import type { ReactNode } from "react";

export interface TooltipRow {
  label: string;
  value: ReactNode;
  color?: string;
}

export function TooltipBox({ title, rows }: { title: ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="rounded-[3px] border border-line bg-panel-2/95 px-3 py-2 shadow-xl backdrop-blur text-[11px] min-w-36">
      <div className="label mb-1.5 text-ink normal-case tracking-normal">{title}</div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-dim">
              {r.color && <span className="inline-block size-2 rounded-[2px]" style={{ background: r.color }} />}
              {r.label}
            </span>
            <span className="num text-ink">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Minimal shape of what Recharts passes to a custom tooltip. */
export interface RechartsTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ dataKey?: string | number; name?: string | number; value?: number | string; color?: string; fill?: string; payload?: Record<string, unknown> }>;
}
