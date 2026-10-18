"use client";

import type { ChartTheme } from "@/lib/theme";
import type { CountRow } from "@/lib/stats";
import { SEVERITY_META, type Severity } from "@/lib/taxonomy";

/**
 * Severity as an ordered set of meters: one hue, darker-to-brighter with
 * severity (validated ordinal ramp), label and value in ink, share in dim.
 */
export function SeverityMeters({ data, theme, onPick, active = null }: { data: CountRow<`${Severity}`>[]; theme: ChartTheme; onPick?: (s: Severity) => void; active?: Severity | null }) {
  const total = data.reduce((s, r) => s + r.count, 0) || 1;
  const max = Math.max(1, ...data.map((r) => r.count));
  return (
    <ul className="space-y-3">
      {[...data].reverse().map((r) => {
        const s = Number(r.key) as Severity;
        return (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => onPick?.(s)}
              className={`group w-full text-left rounded-[3px] px-2 py-1.5 -mx-2 transition-colors ${active === s ? "bg-accent-tint" : "hover:bg-panel-2"}`}
            >
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-soft">
                  <span className="num text-ink">{s}</span> · {SEVERITY_META[s].label}
                </span>
                <span className="num text-ink">
                  {r.count.toLocaleString("en-US")} <span className="text-dim">{Math.round((r.count / total) * 100)}%</span>
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full rounded-[2px]" style={{ background: `color-mix(in oklab, ${theme.severity[s]} 18%, transparent)` }}>
                <div className="grow-in h-2 rounded-[2px]" style={{ width: `${(r.count / max) * 100}%`, background: theme.severity[s] }} />
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
