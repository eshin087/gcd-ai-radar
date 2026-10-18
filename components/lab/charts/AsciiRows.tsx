"use client";

import { useEffect, useRef, useState } from "react";
import { glyphWidth } from "@/components/fx/measure";
import { blockBar, brailleSpark, fitSeries } from "@/components/fx/text";

export interface AsciiRow {
  key: string;
  label: string;
  value: number;
  /** Optional monthly values for a braille sparkline. */
  spark?: number[];
  /** Optional glyph prefix (e.g. a severity shade) as secondary encoding. */
  mark?: string;
}

const SPARK_POINTS = 24; // 12 braille characters

/**
 * Label · block bar · value · braille sparkline, one clickable row per item.
 * Rows sit on a fixed grid, so values line up whatever the bar length, and
 * the bar column (minmax(0,1fr)) can never widen the layout. The bar length
 * in characters is measured from that column.
 */
export function AsciiRows({ rows, onPick, active = null, labelWidth = 22 }: { rows: AsciiRow[]; onPick?: (key: string) => void; active?: string | null; labelWidth?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLSpanElement>(null);
  const [barChars, setBarChars] = useState(6);
  const [spark, setSpark] = useState<{ show: boolean; px: number }>({ show: false, px: 0 });
  const hasSpark = rows.some((r) => r.spark);

  useEffect(() => {
    const el = wrapRef.current;
    const ruler = rulerRef.current;
    if (!el || !ruler) return;
    const ro = new ResizeObserver(() => {
      const blockW = glyphWidth(el, "█");
      const show = hasSpark && el.clientWidth >= 520;
      const px = Math.ceil(glyphWidth(el, "⣿") * (SPARK_POINTS / 2) + glyphWidth(el, "0") * 2);
      setSpark((s) => (s.show === show && s.px === px ? s : { show, px }));
      setBarChars(Math.max(3, Math.floor(ruler.clientWidth / blockW) - 1));
    });
    ro.observe(el);
    ro.observe(ruler);
    return () => ro.disconnect();
  }, [hasSpark]);

  const cols = `${labelWidth + 1}ch minmax(0,1fr) 7ch${spark.show ? ` ${spark.px}px` : ""}`;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div ref={wrapRef} className="w-full min-w-0 overflow-hidden font-mono text-[13px] leading-[1.6]" role="list">
      <div aria-hidden className="grid h-0 overflow-hidden" style={{ gridTemplateColumns: cols }}>
        <span />
        <span ref={rulerRef} />
      </div>
      {rows.map((r) => {
        const isActive = active === r.key;
        return (
          <button
            key={r.key}
            type="button"
            role="listitem"
            onClick={() => onPick?.(r.key)}
            aria-label={`${r.label}: ${r.value}`}
            className={`grid w-full items-baseline text-left ${isActive ? "bg-[var(--color-accent-tint)] text-accent" : "hover:bg-panel-2"} ${onPick ? "" : "cursor-default"}`}
            style={{ gridTemplateColumns: cols }}
          >
            <span className="overflow-hidden text-ellipsis whitespace-nowrap pr-[1ch] text-soft">
              {r.mark ? `${r.mark} ` : ""}
              {r.label}
            </span>
            <span className={`overflow-hidden whitespace-pre ${isActive ? "text-accent" : "text-ink phosphor-glow"}`}>{blockBar(r.value, max, barChars)}</span>
            <span className="text-right text-ink">{r.value.toLocaleString("en-US")}</span>
            {spark.show && <span className="whitespace-pre pl-[2ch] text-dim">{r.spark ? brailleSpark(fitSeries(r.spark, SPARK_POINTS)) : ""}</span>}
          </button>
        );
      })}
    </div>
  );
}
