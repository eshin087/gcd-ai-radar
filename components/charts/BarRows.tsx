"use client";

export interface BarRow {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Optional small secondary text after the value (share, note). */
  note?: string;
  /** Optional glyph before the label (secondary encoding). */
  mark?: string;
}

/**
 * Horizontal bars in solid colour with a soft glow: label · bar · value.
 * Every row is a button (the value is the click target the eye goes to), so
 * any count opens its incidents. Bars grow in when the enclosing Reveal
 * arrives (CSS `.grow-x`).
 */
export function BarRows({
  rows,
  onPick,
  active = null,
  labelWidth = "11rem",
  glow = true,
  max,
  className = "",
}: {
  rows: BarRow[];
  onPick?: (key: string) => void;
  active?: string | null;
  labelWidth?: string;
  glow?: boolean;
  max?: number;
  className?: string;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={`space-y-1 ${className}`}>
      {rows.map((r, i) => {
        const on = active === r.key;
        return (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => onPick?.(r.key)}
              aria-label={`${r.label}: ${r.value} incidents`}
              className={`group grid w-full items-center gap-3 rounded-[3px] px-1.5 py-1 text-left transition-colors ${on ? "bg-accent-tint" : "hover:bg-panel-2"} ${onPick ? "" : "cursor-default"}`}
              style={{ gridTemplateColumns: `${labelWidth} minmax(0,1fr) auto` }}
            >
              <span className="truncate text-[13px] text-soft group-hover:text-ink">
                {r.mark && <span className="mr-1.5 text-dim">{r.mark}</span>}
                {r.label}
              </span>
              <span className="relative h-2.5 overflow-hidden rounded-[2px]" style={{ background: `color-mix(in oklab, ${r.color} 13%, transparent)` }}>
                <span
                  className="grow-x absolute inset-y-0 left-0 rounded-[2px]"
                  style={{
                    width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / top) * 100)}%`,
                    background: `linear-gradient(90deg, color-mix(in oklab, ${r.color} 70%, transparent), ${r.color})`,
                    boxShadow: glow ? `0 0 10px color-mix(in oklab, ${r.color} 55%, transparent)` : undefined,
                    animationDelay: `${i * 45}ms`,
                  }}
                />
              </span>
              <span className="num flex items-baseline gap-1.5 text-[13px]">
                <span className="text-ink underline decoration-transparent decoration-dotted underline-offset-4 group-hover:decoration-current">{r.value.toLocaleString("en-US")}</span>
                {r.note && <span className="text-[11.5px] text-dim">{r.note}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
