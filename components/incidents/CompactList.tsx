import Link from "next/link";
import { CategoryBadge, SeverityBadge, TypeBadge } from "@/components/ui/Badge";
import type { CompactRow } from "@/lib/dashboard";

/** Latest-incidents rows from compact dashboard records (no summaries). */
export function CompactList({ rows, limit }: { rows: CompactRow[]; limit?: number }) {
  const items = limit ? rows.slice(0, limit) : rows;
  return (
    <ul className="divide-y divide-line-soft">
      {items.map((i) => (
        <li key={i.id} className="py-3 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
          <span className="num text-[12px] text-dim sm:w-24 shrink-0 sm:pt-0.5">{i.first_reported}</span>
          <div className="min-w-0 flex-1">
            <Link href={`/incidents/${i.slug}`} className="text-[14.5px] leading-snug text-ink hover:text-accent">
              {i.title}
            </Link>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <SeverityBadge severity={i.severity} />
              <TypeBadge type={i.type} short />
              {i.categories.slice(0, 2).map((c) => (
                <CategoryBadge key={c} category={c} />
              ))}
              <span className="num text-[11px] text-faint self-center">{i.source_count} src</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
