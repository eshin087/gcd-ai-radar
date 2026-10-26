"use client";

export interface SegmentedOption<K extends string> {
  key: K;
  label: string;
  title?: string;
}

interface Props<K extends string> {
  label: string;
  value: K;
  options: readonly SegmentedOption<K>[];
  onChange: (key: K) => void;
  size?: "sm" | "md";
}

/** Mono segmented control used for dashboard toggles. */
export function Segmented<K extends string>({ label, value, options, onChange, size = "md" }: Props<K>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex rounded-[2px] border border-line p-0.5 font-mono uppercase tracking-[0.08em] ${size === "sm" ? "text-[12px]" : "text-[12px]"}`}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          title={o.title}
          onClick={() => onChange(o.key)}
          className={`whitespace-nowrap px-2 py-1 rounded-[2px] transition-colors ${value === o.key ? "bg-accent-tint text-accent" : "text-dim hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
