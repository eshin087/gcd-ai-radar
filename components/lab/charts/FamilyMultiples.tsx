"use client";

import { brailleSpark } from "@/components/fx/text";
import { FAMILIES, FAMILY_META, type Family } from "@/lib/families";
import { monthLabel } from "@/lib/format";
import type { LabTheme } from "@/lib/lab/themes";
import type { FamilyPoint } from "../useDashboardModel";

/**
 * Small multiples: one mini column chart per family on a shared y-scale, so
 * shapes compare honestly. Card click opens the family's incidents; a column
 * click opens that family's month.
 */
export function FamilyMultiples({
  data,
  theme,
  onFamily,
  onMonth,
}: {
  data: FamilyPoint[];
  theme: LabTheme;
  onFamily?: (f: Family) => void;
  onMonth?: (month: string, f: Family) => void;
}) {
  const sharedMax = Math.max(1, ...data.flatMap((p) => FAMILIES.map((f) => p.values[f])));
  const n = data.length;
  const half = Math.max(1, Math.floor(n / 2));
  const families = FAMILIES.filter((f) => f !== "other" || data.some((p) => p.values.other > 0));
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {families.map((f) => {
        const vals = data.map((p) => p.values[f]);
        const total = vals.reduce((a, b) => a + b, 0);
        const recent = vals.slice(-half).reduce((a, b) => a + b, 0);
        const before = vals.slice(0, n - half).reduce((a, b) => a + b, 0);
        const delta = before === 0 ? null : ((recent - before) / before) * 100;
        const W = 220;
        const H = 64;
        const bw = W / n;
        return (
          <div key={f} className="glass p-4 flex flex-col gap-2">
            <button type="button" onClick={() => onFamily?.(f)} className="text-left">
              <div className="flex items-center gap-2">
                <span className="inline-block size-2 rounded-full" style={{ background: theme.families[f] }} />
                <span className="text-[13px] text-ink">{FAMILY_META[f].label}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight text-ink">{total.toLocaleString("en-US")}</span>
                <span className={`num text-[12px] ${delta === null ? "text-dim" : delta > 5 ? "text-sev-3" : delta < -5 ? "text-type-by" : "text-dim"}`}>
                  {delta === null ? "new" : `${delta > 0 ? "+" : "−"}${Math.abs(Math.round(delta))}%`}
                </span>
                <span className="text-[11px] text-dim">second half vs first</span>
              </div>
            </button>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none" role="img" aria-label={`${FAMILY_META[f].label} per month`}>
              {vals.map((v, i) => {
                const h = (v / sharedMax) * (H - 2);
                return (
                  <rect
                    key={i}
                    x={i * bw + bw * 0.14}
                    y={H - h}
                    width={bw * 0.72}
                    height={Math.max(v > 0 ? 1.5 : 0, h)}
                    rx={1}
                    fill={theme.families[f]}
                    className="cursor-pointer hover:opacity-80"
                    onClick={() => onMonth?.(data[i]!.month, f)}
                  >
                    <title>{`${monthLabel(data[i]!.month, true)}: ${v}`}</title>
                  </rect>
                );
              })}
            </svg>
            <div className="num text-[11px] text-faint flex justify-between">
              <span>{data[0] ? monthLabel(data[0].month) : ""}</span>
              <span aria-hidden className="tracking-tight">{brailleSpark(vals)}</span>
              <span>{data[n - 1] ? monthLabel(data[n - 1]!.month) : ""}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
