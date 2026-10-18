"use client";

import { useEffect, useRef, useState } from "react";
import { glyphWidth } from "@/components/fx/measure";
import { blockBar, brailleSpark } from "@/components/fx/text";

export interface AsciiRow {
  key: string;
  label: string;
  value: number;
  /** Optional monthly values for a braille sparkline. */
  spark?: number[];
  /** Optional glyph prefix (e.g. a severity shade) as secondary encoding. */
  mark?: string;
}

/**
 * Label · block bar · value · braille sparkline, one clickable row per item.
 * The bar width in characters follows the container width.
 */
export function AsciiRows({ rows, onPick, active = null, labelWidth = 22 }: { rows: AsciiRow[]; onPick?: (key: string) => void; active?: string | null; labelWidth?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [barChars, setBarChars] = useState(12);
  const hasSpark = rows.some((r) => r.spark);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const textW = glyphWidth(el, "M");
      const blockW = glyphWidth(el, "█");
      const fixedPx = (labelWidth + 8) * textW + (hasSpark && el.clientWidth > 560 ? 15 * textW : 0);
      setBarChars(Math.max(6, Math.floor((el.clientWidth - fixedPx) / blockW)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [labelWidth, hasSpark]);

  const max = Math.max(1, ...rows.map((r) => r.value));
  const showSpark = hasSpark && barChars > 14;
  return (
    <div ref={wrapRef} className="font-mono text-[13px] leading-[1.6]" role="list">
      {rows.map((r) => {
        const label = (r.mark ? `${r.mark} ` : "") + r.label;
        return (
          <button
            key={r.key}
            type="button"
            role="listitem"
            onClick={() => onPick?.(r.key)}
            aria-label={`${r.label}: ${r.value}`}
            className={`flex w-full items-baseline whitespace-pre text-left ${active === r.key ? "bg-[var(--color-accent-tint)] text-accent" : "hover:bg-panel-2"}`}
          >
            <span className="text-soft">{label.length > labelWidth ? label.slice(0, labelWidth - 1) + "…" : label.padEnd(labelWidth)}</span>
            <span className={active === r.key ? "text-accent" : "text-ink phosphor-glow"}>{blockBar(r.value, max, barChars).padEnd(barChars)}</span>
            <span className="text-ink">{` ${r.value.toLocaleString("en-US").padStart(6)}`}</span>
            {showSpark && r.spark && <span className="text-dim">{`  ${brailleSpark(r.spark)}`}</span>}
          </button>
        );
      })}
    </div>
  );
}
