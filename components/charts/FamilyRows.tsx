"use client";

import type { FamilyPoint } from "@/components/dashboard/useDashboardModel";
import { FAMILY_META, type Family } from "@/lib/families";
import { monthLabel } from "@/lib/format";
import { pctChange } from "@/lib/stats";
import type { ChartTheme } from "@/lib/theme";
import { DeltaChip } from "./DeltaChip";
import { Sparkline } from "./Sparkline";

interface Props {
  families: Family[];
  /** Each family's count in the window. */
  totals: Record<Family, number>;
  /** Each family's count in the window before; null for the full span. */
  prior: Record<Family, number> | null;
  /** The window's months, split by family. */
  series: FamilyPoint[];
  theme: ChartTheme;
  priorLabel?: string;
  onFamily?: (f: Family) => void;
  onMonth?: (month: string, f: Family) => void;
  active?: Family | null;
}

/**
 * The families as a leaderboard, largest first: colour dot and name, its
 * share of the window as a bar, its months as a sparkline (each on its own
 * scale, for shape), the count and the change on the window before. The
 * count and the share bar open the family; a sparkline month opens that
 * family's incidents of that month. An empty "other" is left out.
 */
export function FamilyRows({ families, totals, prior, series, theme, priorLabel = "the window before", onFamily, onMonth, active = null }: Props) {
  const all = families.reduce((s, f) => s + totals[f], 0);
  const rows = families.filter((f) => f !== "other" || totals.other > 0).sort((a, b) => totals[b] - totals[a] || families.indexOf(a) - families.indexOf(b));
  const grid = "@xl:grid-cols-[1.5rem_minmax(0,2.5fr)_minmax(0,0.75fr)_minmax(0,1fr)_3.25rem_5rem]";

  return (
    <div data-chart="family-rows" className="@container">
      <div className={`hidden h-8 items-end gap-x-3 border-b border-line-soft pb-2 text-[12px] text-dim @xl:grid ${grid}`} aria-hidden>
        <span>#</span>
        <span>family</span>
        <span>share</span>
        <span>by month</span>
        <span className="text-right">count</span>
        <span className="text-right">vs before</span>
      </div>
      <ol className="divide-y divide-line-soft">
        {rows.map((f, k) => {
          const n = totals[f];
          const share = all > 0 ? n / all : 0;
          const was = prior?.[f];
          const on = active === f;
          return (
            <li key={f} className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 py-2.5 transition-colors @xl:h-11 @xl:py-0 ${grid} ${on ? "bg-accent-tint" : ""}`}>
              <span className="num hidden text-[12px] text-dim @xl:block">{String(k + 1).padStart(2, "0")}</span>
              <span className="flex min-w-0 items-center gap-2.5 text-[15px] text-ink" title={FAMILY_META[f].label}>
                <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: theme.families[f], boxShadow: `0 0 8px color-mix(in oklab, ${theme.families[f]} 70%, transparent)` }} />
                <span className="truncate">
                  <span className="@xl:hidden">{FAMILY_META[f].short}</span>
                  <span className="hidden @xl:inline">{FAMILY_META[f].label}</span>
                </span>
              </span>
              {/* on narrow panels the share bar and the sparkline share a second line */}
              <div className="order-last col-span-3 grid grid-cols-2 items-center gap-3 @xl:order-none @xl:col-span-1 @xl:contents">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  disabled={n === 0}
                  onClick={() => onFamily?.(f)}
                  title={`${FAMILY_META[f].label}: ${Math.round(share * 100)}% of the window`}
                  className="group flex min-w-0 items-center gap-2"
                >
                  <span className="relative h-1.5 min-w-0 flex-1 rounded-full bg-[color-mix(in_oklab,var(--color-line)_55%,transparent)]">
                    <span
                      className="grow-x absolute inset-y-0 left-0 rounded-full group-hover:brightness-125"
                      style={{ width: `${Math.max(n > 0 ? 1.5 : 0, share * 100)}%`, background: theme.families[f], boxShadow: `0 0 8px color-mix(in oklab, ${theme.families[f]} 50%, transparent)`, animationDelay: `${k * 50}ms` }}
                    />
                  </span>
                  <span className="num w-9 shrink-0 text-right text-[12.5px] text-soft">{Math.round(share * 100)}%</span>
                </button>
                <Sparkline
                  values={series.map((p) => p.values[f])}
                  color={theme.families[f]}
                  surface={theme.surface}
                  height={28}
                  label={`${FAMILY_META[f].label} by month`}
                  describe={(i) => `${monthLabel(series[i]!.month, true)}: ${series[i]!.values[f]} incidents`}
                  onPick={onMonth ? (i) => onMonth(series[i]!.month, f) : undefined}
                />
              </div>
              {n > 0 ? (
                <button
                  type="button"
                  onClick={() => onFamily?.(f)}
                  aria-label={`${FAMILY_META[f].label}: ${n} incidents`}
                  className={`num text-right text-[16px] font-medium underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent hover:decoration-[color:var(--color-accent)] ${on ? "text-accent" : "text-ink"}`}
                >
                  {n.toLocaleString("en-US")}
                </button>
              ) : (
                <span className="num text-right text-[16px] text-faint">0</span>
              )}
              <span className="flex justify-end">
                {was === undefined ? <span className="text-[12px] text-faint">—</span> : <DeltaChip size="md" pct={pctChange(n, was)} title={`${n} now against ${was} in ${priorLabel}`} />}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
