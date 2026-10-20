import { formatPct } from "@/lib/format";
import { FALL, RISE } from "./hooks";

/**
 * A change as a small chip: an arrow and a signed percentage, warm when the
 * count rose and cool when it fell (more incidents is the bad direction),
 * "new" when there was nothing before. Not a count, so not clickable.
 * `size="md"` is a step larger, for rows and tiles read at a glance.
 */
export function DeltaChip({ pct, title, size = "sm", className = "" }: { pct: number | null; title?: string; size?: "sm" | "md"; className?: string }) {
  const tone = pct === null || pct > 0.5 ? RISE : pct < -0.5 ? FALL : null;
  const arrow = pct === null || pct > 0.5 ? "▲" : pct < -0.5 ? "▼" : "•";
  const box = size === "md" ? "gap-1.5 px-2 py-0.5 text-[12.5px]" : "gap-1 px-1.5 py-px text-[11px]";
  return (
    <span
      title={title}
      className={`num inline-flex shrink-0 items-center rounded-[3px] border leading-[1.35] ${box} ${tone ? "" : "border-line-soft text-dim"} ${className}`}
      style={tone ? { color: tone, borderColor: `color-mix(in oklab, ${tone} 34%, transparent)`, background: `color-mix(in oklab, ${tone} 11%, transparent)` } : undefined}
    >
      <span aria-hidden className={size === "md" ? "text-[9px]" : "text-[8px]"}>
        {arrow}
      </span>
      {formatPct(pct === null ? null : Math.abs(pct)).replace(/^\+/, "")}
      <span className="sr-only">{pct === null ? "" : pct > 0.5 ? " up" : pct < -0.5 ? " down" : " flat"}</span>
    </span>
  );
}
