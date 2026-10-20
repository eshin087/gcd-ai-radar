"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { dateLabel } from "@/lib/format";
import type { ChartTheme } from "@/lib/theme";
import { heat } from "./hooks";

interface Props {
  /** Incidents per full-dated day, YYYY-MM-DD; zero days left out. */
  dayCounts: Record<string, number>;
  /** First month shown, YYYY-MM. */
  from: string;
  /** Last day shown, YYYY-MM-DD (today). */
  to: string;
  theme: ChartTheme;
  onDay?: (day: string) => void;
  activeDay?: string | null;
  label: string;
}

const CELL = 12;
const STEP = 15;
const LEFT = 30;
const TOP = 18;
const DAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A year of days: one column per week, one row per weekday, each cell
 * shaded by that day's incidents on the accent ramp. Bursts and quiet weeks
 * read at a glance; a cell opens its day. Scrolls sideways on narrow screens
 * and starts scrolled to the newest weeks. The tooltip lives outside the
 * scroller (so it can never widen it and flash a scrollbar), placed from the
 * hovered cell's box and clamped inside the panel.
 */
export function CalendarHeatmap({ dayCounts, from, to, theme, onDay, activeDay = null, label }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  /** The hovered day and its cell's box in the wrapper's coordinates. */
  const [hover, setHover] = useState<{ day: string; cx: number; top: number; bottom: number } | null>(null);

  const { cells, weeks, monthMarks, max } = useMemo(() => {
    const start = new Date(`${from}-01T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    // Monday-first weekday of the first day
    const startDow = (start.getUTCDay() + 6) % 7;
    const cells: { day: string; col: number; row: number; count: number }[] = [];
    const monthMarks: { col: number; label: string }[] = [];
    let max = 1;
    let lastMonth = "";
    for (let d = new Date(start), i = 0; d <= end; d.setUTCDate(d.getUTCDate() + 1), i++) {
      const day = iso(d);
      const col = Math.floor((i + startDow) / 7);
      const row = (i + startDow) % 7;
      const count = dayCounts[day] ?? 0;
      if (count > max) max = count;
      cells.push({ day, col, row, count });
      const m = day.slice(0, 7);
      if (m !== lastMonth) {
        lastMonth = m;
        if (row <= 3 || monthMarks.length === 0) monthMarks.push({ col, label: new Date(`${m}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }) });
        else monthMarks.push({ col: col + 1, label: new Date(`${m}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }) });
      }
    }
    const weeks = (cells[cells.length - 1]?.col ?? 0) + 1;
    return { cells, weeks, monthMarks, max };
  }, [dayCounts, from, to]);

  const width = LEFT + weeks * STEP;
  const height = TOP + 7 * STEP;
  const total = cells.reduce((s, c) => s + c.count, 0);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [width]);

  const point = (day: string) => (e: MouseEvent<SVGRectElement> | FocusEvent<SVGRectElement>) => {
    const box = wrap.current?.getBoundingClientRect();
    const cell = e.currentTarget.getBoundingClientRect();
    if (!box) return;
    setHover({ day, cx: cell.left + cell.width / 2 - box.left, top: cell.top - box.top, bottom: cell.bottom - box.top });
  };

  // clamp the tooltip inside the wrapper once its size is known; flip below the cell when there is no room above
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const box = wrap.current;
    if (!tip || !box || !hover) return;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.style.left = `${Math.max(0, Math.min(box.clientWidth - w, hover.cx - w / 2))}px`;
    tip.style.top = `${hover.top - h - 6 >= 0 ? hover.top - h - 6 : hover.bottom + 6}px`;
    tip.style.visibility = "visible";
  }, [hover]);

  return (
    <div ref={wrap} className="relative space-y-2">
      {/* first child, so the space-y margins between the scroller and the legend stay as they were */}
      {hover && (
        <div ref={tipRef} className="pointer-events-none absolute left-0 top-0 z-10 whitespace-nowrap rounded-[4px] border border-line bg-panel/95 px-2 py-1 text-[11.5px] shadow-xl backdrop-blur" style={{ visibility: "hidden" }}>
          <span className="text-soft">{dateLabel(hover.day)}</span> <span className="num text-ink">{dayCounts[hover.day] ?? 0}</span>
          {(dayCounts[hover.day] ?? 0) > 0 && <span className="ml-1.5 text-faint">click to open</span>}
        </div>
      )}
      <div ref={scroller} className="overflow-x-auto pb-1" onMouseLeave={() => setHover(null)} onScroll={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label={label} className="block">
          {DAYS.map((d, r) =>
            d ? (
              <text key={r} x={LEFT - 6} y={TOP + r * STEP + CELL - 2} textAnchor="end" fontSize={9.5} fill={theme.dim} className="num">
                {d}
              </text>
            ) : null,
          )}
          {monthMarks.map((m) => (
            <text key={`${m.col}-${m.label}`} x={LEFT + m.col * STEP} y={TOP - 7} fontSize={10} fill={theme.axis} className="num">
              {m.label}
            </text>
          ))}
          {cells.map((c) => {
            const style = heat(c.count, max);
            const x = LEFT + c.col * STEP;
            const y = TOP + c.row * STEP;
            const on = activeDay === c.day;
            return (
              <rect
                key={c.day}
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                rx={2}
                style={{ fill: style.background }}
                stroke={on ? theme.accent : hover?.day === c.day ? theme.ink : "none"}
                strokeWidth={on ? 2 : 1}
                role={c.count > 0 && onDay ? "button" : undefined}
                tabIndex={c.count > 0 && onDay ? 0 : -1}
                aria-label={`${dateLabel(c.day)}: ${c.count} incidents`}
                className={c.count > 0 && onDay ? "cursor-pointer outline-none" : undefined}
                onMouseEnter={point(c.day)}
                onFocus={point(c.day)}
                onBlur={() => setHover((h) => (h?.day === c.day ? null : h))}
                onClick={() => c.count > 0 && onDay?.(c.day)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && c.count > 0) {
                    e.preventDefault();
                    onDay?.(c.day);
                  }
                }}
              />
            );
          })}
        </svg>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-dim">
        <span>
          <span className="num text-ink">{total.toLocaleString("en-US")}</span> incidents with a known day, {dateLabel(`${from}-01`)} to {dateLabel(to)}. Incidents dated only to a month or a year are not on the calendar.
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          less
          {[0, 0.12, 0.35, 0.65, 1].map((k) => (
            <span key={k} className="inline-block size-2.5 rounded-[2px]" style={{ background: heat(k * max, max).background }} />
          ))}
          more
        </span>
      </div>
    </div>
  );
}
