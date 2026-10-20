"use client";

import { FAMILY_META, type Family } from "@/lib/families";
import { TARGET_META, type Target } from "@/lib/taxonomy";
import type { ChartTheme } from "@/lib/theme";

interface Props {
  /** Families in the palette's order (ties between families keep it). */
  families: Family[];
  /** Targets with at least one incident, most hit first. */
  targets: { key: Target; count: number }[];
  counts: Record<Family, Partial<Record<Target, number>>>;
  theme: ChartTheme;
  onTarget?: (t: Target) => void;
  onSegment?: (f: Family, t: Target) => void;
  active?: { family: Family; target: Target } | null;
  /** Rows drawn as bars; the rest are listed on one "also hit" line. */
  rows?: number;
}

const COUNT_LINK = "num underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent";

/**
 * Who is hit, and mostly by what: one plain bar per target, as long as the
 * incidents that name it, then the one or two families that hit it most, in
 * words with their counts. The total (and the bar) opens the target; a
 * family's count opens that family on that target. The smallest targets
 * share one "also hit" line. An incident that names several targets is in
 * each of their bars.
 */
export function TargetBars({ families, targets, counts, theme, onTarget, onSegment, active = null, rows = 10 }: Props) {
  const max = Math.max(1, ...targets.map((t) => t.count));
  const shown = targets.slice(0, rows);
  const rest = targets.slice(rows);
  const top = (t: Target) =>
    families
      .map((f) => ({ f, v: counts[f][t] ?? 0 }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 2);

  return (
    <div data-chart="target-bars" className="@container space-y-2.5">
      {/* a heading row the height of the harm chart's, so the rows of the two panels line up */}
      <div aria-hidden className="flex h-4 items-center justify-between text-[12px] text-dim">
        <span>target</span>
        <span>incidents · hit most by</span>
      </div>
      <ol className="space-y-2">
        {shown.map((t, k) => {
          const label = TARGET_META[t.key].label;
          return (
            // narrow panels put the families on a second line under the bar, and let the name wrap beside both
            <li key={t.key} className="grid h-9 grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)_2.25rem] grid-rows-[18px_16px] items-center gap-x-2.5 gap-y-0.5 @min-[22rem]:grid-cols-[minmax(0,6.75rem)_minmax(0,1fr)_2.25rem] @min-[34rem]:grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_2.5rem_minmax(0,1.15fr)] @min-[34rem]:grid-rows-1">
              <span className="row-span-2 line-clamp-2 self-start text-[13.5px] leading-[17px] text-soft @min-[34rem]:row-span-1 @min-[34rem]:line-clamp-1 @min-[34rem]:self-center" title={`${label}: ${TARGET_META[t.key].definition}`}>
                {label}
              </span>
              <span className="relative h-3">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  onClick={() => onTarget?.(t.key)}
                  title={`${label}: ${t.count}`}
                  className="grow-x absolute inset-y-0 left-0 min-w-[3px] rounded-[3px] transition-[filter] hover:brightness-125"
                  style={{ width: `${(t.count / max) * 100}%`, background: theme.bar, animationDelay: `${k * 40}ms` }}
                />
              </span>
              <button type="button" data-total onClick={() => onTarget?.(t.key)} aria-label={`${label}: ${t.count} incidents`} className={`${COUNT_LINK} text-right text-[13.5px] text-ink`}>
                {t.count.toLocaleString("en-US")}
              </button>
              <span className="col-span-2 col-start-2 flex min-w-0 flex-wrap items-baseline gap-x-2.5 text-[11.5px] text-dim @min-[22rem]:gap-x-3 @min-[22rem]:text-[12.5px] @min-[34rem]:col-span-1 @min-[34rem]:col-start-auto">
                {top(t.key).map(({ f, v }) => {
                  const on = active?.family === f && active.target === t.key;
                  return (
                    <span key={f} className="flex min-w-0 items-baseline gap-1.5">
                      <span className="inline-block size-[7px] shrink-0 self-center rounded-full" style={{ background: theme.families[f] }} />
                      <span className="truncate" title={FAMILY_META[f].label}>
                        {FAMILY_META[f].short}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSegment?.(f, t.key)}
                        aria-label={`${FAMILY_META[f].label} on ${label}: ${v} incidents`}
                        className={`${COUNT_LINK} text-soft ${on ? "text-accent" : ""}`}
                      >
                        {v.toLocaleString("en-US")}
                      </button>
                    </span>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ol>
      {rest.length > 0 && (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line-soft pt-2 text-[13px] text-dim">
          <span className="text-faint">Also hit</span>
          {rest.map((t) => (
            <span key={t.key} className="flex items-baseline gap-1.5">
              <span className="text-soft" title={TARGET_META[t.key].definition}>
                {TARGET_META[t.key].label}
              </span>
              <button type="button" data-total onClick={() => onTarget?.(t.key)} aria-label={`${TARGET_META[t.key].label}: ${t.count} incidents`} className={`${COUNT_LINK} text-ink`}>
                {t.count.toLocaleString("en-US")}
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
