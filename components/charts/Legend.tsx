"use client";

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  value?: number | string;
  dashed?: boolean;
}

interface Props {
  items: LegendItem[];
  className?: string;
  compact?: boolean;
  /** When set, items become buttons. */
  onClick?: (key: string) => void;
}

export function Legend({ items, className = "", compact = false, onClick }: Props) {
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1.5 ${className}`} aria-label="Legend">
      {items.map((item) => {
        const body = (
          <>
            {item.dashed ? (
              <span className="inline-block w-3 border-t border-dashed" style={{ borderColor: item.color }} aria-hidden />
            ) : (
              <span className="inline-block size-2.5 rounded-[2px]" style={{ background: item.color }} aria-hidden />
            )}
            <span className={compact ? "text-dim" : ""}>{item.label}</span>
            {item.value !== undefined && <span className="num text-dim">{item.value}</span>}
          </>
        );
        return (
          <li key={item.key} className="text-[12px] text-soft">
            {onClick ? (
              <button type="button" onClick={() => onClick(item.key)} className="flex items-center gap-1.5 hover:text-ink">
                {body}
              </button>
            ) : (
              <span className="flex items-center gap-1.5">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
