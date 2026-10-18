export interface LegendItem {
  key: string;
  label: string;
  color: string;
  value?: number | string;
  dashed?: boolean;
}

export function Legend({ items, className = "", compact = false }: { items: LegendItem[]; className?: string; compact?: boolean }) {
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1.5 ${className}`} aria-label="Legend">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5 text-[11px] text-soft">
          {item.dashed ? (
            <span className="inline-block w-3 border-t border-dashed" style={{ borderColor: item.color }} aria-hidden />
          ) : (
            <span className="inline-block size-2.5 rounded-[2px]" style={{ background: item.color }} aria-hidden />
          )}
          <span className={compact ? "text-dim" : ""}>{item.label}</span>
          {item.value !== undefined && <span className="num text-dim">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}
