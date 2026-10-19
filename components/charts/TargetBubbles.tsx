"use client";

import { FAMILY_META, type Family } from "@/lib/families";
import { TARGET_META, type Target } from "@/lib/taxonomy";
import type { ChartTheme } from "@/lib/theme";

interface Props {
  families: Family[];
  /** Targets to show, most hit first. */
  targets: { key: Target; count: number }[];
  counts: Record<Family, Partial<Record<Target, number>>>;
  familyTotals: Record<Family, number>;
  theme: ChartTheme;
  onCell?: (f: Family, t: Target) => void;
  onTarget?: (t: Target) => void;
  onFamily?: (f: Family) => void;
  active?: { family: Family; target: Target } | null;
}

const CELL = 30;
const MAX_R = 13.5;

/**
 * Targets against families as a bubble matrix: a bubble's area is its
 * count, its colour its family, so each vendor's exposure reads as a row and
 * each family's reach as a column. Every bubble and every total opens its
 * incidents. An incident that names several targets sits in each of its rows.
 */
export function TargetBubbles({ families, targets, counts, familyTotals, theme, onCell, onTarget, onFamily, active = null }: Props) {
  const max = Math.max(1, ...families.flatMap((f) => targets.map((t) => counts[f][t.key] ?? 0)));
  const cols = `minmax(8.5rem,1fr) repeat(${families.length}, ${CELL}px)`;
  return (
    <div className="-mx-1 space-y-0.5 overflow-x-auto px-1" role="table" aria-label="Incidents by target and family">
      <div className="grid items-end gap-x-0.5 pb-1" style={{ gridTemplateColumns: cols }} role="row">
        <span className="text-[10.5px] text-dim" role="columnheader">
          target · incidents
        </span>
        {families.map((f) => (
          <button key={f} type="button" onClick={() => onFamily?.(f)} aria-label={`${FAMILY_META[f].label}: ${familyTotals[f]} incidents`} className="group flex flex-col items-center gap-1" role="columnheader" title={FAMILY_META[f].label}>
            <span className="inline-block size-2.5 rounded-full" style={{ background: theme.families[f], boxShadow: `0 0 6px ${theme.families[f]}` }} />
            <span className="num text-[10.5px] text-dim group-hover:text-ink">{familyTotals[f]}</span>
          </button>
        ))}
      </div>
      <ul className="space-y-0.5">
        {targets.map((t) => (
          <li key={t.key} className="grid items-center gap-x-0.5" style={{ gridTemplateColumns: cols }} role="row">
            <button type="button" onClick={() => onTarget?.(t.key)} aria-label={`${TARGET_META[t.key].label}: ${t.count} incidents`} className="group flex min-w-0 items-baseline gap-1.5 text-left text-[12px] text-soft hover:text-ink" role="rowheader">
              <span className="truncate">{TARGET_META[t.key].label}</span>
              <span className="num shrink-0 text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 group-hover:decoration-[color:var(--color-accent)]">{t.count}</span>
            </button>
            {families.map((f) => {
              const v = counts[f][t.key] ?? 0;
              const r = v > 0 ? Math.max(3.5, Math.sqrt(v / max) * MAX_R) : 0;
              const on = active?.family === f && active.target === t.key;
              return (
                <button
                  key={f}
                  type="button"
                  disabled={v === 0}
                  onClick={() => onCell?.(f, t.key)}
                  aria-label={`${FAMILY_META[f].label} on ${TARGET_META[t.key].label}: ${v} incidents`}
                  title={v > 0 ? `${FAMILY_META[f].label} on ${TARGET_META[t.key].label}: ${v}` : undefined}
                  className={`relative flex items-center justify-center rounded-[3px] ${v > 0 ? "hover:bg-panel-2" : "cursor-default"} ${on ? "bg-accent-tint" : ""}`}
                  style={{ height: CELL }}
                  role="cell"
                >
                  {v > 0 ? (
                    <svg width={CELL} height={CELL} viewBox={`0 0 ${CELL} ${CELL}`} aria-hidden className="block">
                      <circle cx={CELL / 2} cy={CELL / 2} r={r} fill={theme.families[f]} fillOpacity={0.9} />
                      {r >= 8 && (
                        <text x={CELL / 2} y={CELL / 2} dy="0.35em" textAnchor="middle" fontSize={10} fill={theme.surface} className="num" fontWeight={600}>
                          {v}
                        </text>
                      )}
                    </svg>
                  ) : (
                    <span className="size-1 rounded-full" style={{ background: theme.grid }} />
                  )}
                </button>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
