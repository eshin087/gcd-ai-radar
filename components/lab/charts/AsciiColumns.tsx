"use client";

import { useEffect, useRef, useState } from "react";
import { glyphWidth } from "@/components/fx/measure";
import { monthLabel } from "@/lib/format";
import type { TrendPoint } from "@/lib/stats";

const VERT = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const MONTH_INITIAL = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/**
 * A column chart drawn entirely in block characters (terminal draft). Each
 * month is a clickable column; eighth blocks give sub-row precision; the
 * 3-month average is plotted as amber dots; a status line replaces tooltips.
 */
export function AsciiColumns({
  data,
  rows = 16,
  provisionalFrom,
  activeMonth = null,
  onPick,
}: {
  data: TrendPoint[];
  rows?: number;
  provisionalFrom?: string;
  activeMonth?: string | null;
  onPick?: (month: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [colW, setColW] = useState(1);
  const [hover, setHover] = useState<TrendPoint | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      el.style.fontSize = "13px";
      const blockW = glyphWidth(el, "█");
      const axisW = glyphWidth(el, "0") * 6;
      const per = (el.clientWidth - axisW) / blockW / Math.max(1, data.length);
      // a column of width w plus a gap of 0.6em costs about w + 1 blocks
      setColW(Math.max(1, Math.min(5, Math.floor(per - 0.9))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.length]);

  const max = Math.max(1, ...data.map((p) => p.total));
  const step = Math.ceil(max / rows / 5) * 5 || 1;
  const top = step * rows;
  const levels = data.map((p) => (p.total / top) * rows);
  const maRows = data.map((p) => (p.ma === null ? null : (p.ma / top) * rows));
  const gap = colW >= 2 ? 1 : 0;
  const shown = hover ?? data.find((p) => p.month === activeMonth) ?? data[data.length - 1] ?? null;

  return (
    <div ref={wrapRef} className="w-full select-none">
      <div className="flex font-mono text-[13px] leading-[1.05]">
        {/* y axis */}
        <div aria-hidden className="pr-1 text-right text-faint whitespace-pre">
          {Array.from({ length: rows }, (_, i) => {
            const k = rows - i;
            return <div key={i}>{k % 4 === 0 ? `${k * step}`.padStart(4) + "┤" : "    │"}</div>;
          })}
          <div>{"   0└"}</div>
        </div>
        <div className="flex items-end" role="list" aria-label="Incidents per month">
          {data.map((p, ci) => {
            const prov = provisionalFrom ? p.month >= provisionalFrom : false;
            const isActive = p.month === activeMonth;
            return (
              <button
                key={p.month}
                type="button"
                role="listitem"
                aria-label={`${monthLabel(p.month, true)}: ${p.total} incidents`}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(p)}
                onClick={() => onPick?.(p.month)}
                className={`group flex flex-col whitespace-pre text-left ${isActive ? "bg-[var(--color-accent-tint)]" : "hover:bg-panel-2"}`}
                style={{ marginRight: gap ? `${0.6 * gap}em` : 0 }}
              >
                {Array.from({ length: rows }, (_, i) => {
                  const k = rows - 1 - i; // row index from the bottom
                  const lvl = levels[ci]!;
                  const ma = maRows[ci];
                  let ch = " ";
                  if (lvl >= k + 1) ch = "█";
                  else if (lvl > k) ch = VERT[Math.max(1, Math.round((lvl - k) * 8))] ?? " ";
                  const maHere = ma !== null && ma !== undefined && Math.floor(ma) === k && ch !== "█";
                  const cls = maHere ? "text-accent" : isActive ? "text-accent" : prov ? "text-dim" : "text-ink phosphor-glow";
                  return (
                    <span key={i} className={cls}>
                      {(maHere ? "•" : ch).repeat(colW)}
                    </span>
                  );
                })}
                <span className="text-faint border-t border-line">{(MONTH_INITIAL[Number(p.month.slice(5)) - 1] ?? "?").padEnd(colW)}</span>
                <span className="text-faint">
                  {p.month.endsWith("-01") || ci === 0
                    ? (colW >= 3 ? `'${p.month.slice(2, 4)}` : colW === 2 ? p.month.slice(2, 4) : "¦").padEnd(colW)
                    : " ".repeat(colW)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 font-mono text-[13px] text-soft">
        <span className="text-dim">&gt; </span>
        {shown ? (
          <>
            {monthLabel(shown.month, true)} · <span className="text-ink">{shown.total}</span> incidents
            {shown.ma !== null && (
              <>
                {" "}
                · 3-mo avg <span className="text-accent">{shown.ma.toFixed(1)}</span>
              </>
            )}{" "}
            · <span className="text-dim">enter/click for the report</span>
          </>
        ) : (
          "no data"
        )}
        <span className="cursor" aria-hidden />
      </div>
    </div>
  );
}
