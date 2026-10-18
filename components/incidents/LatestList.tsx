import Link from "next/link";
import type { Incident } from "@/lib/schema";
import { approxDateLabel, dateLabel } from "@/lib/format";
import { SEVERITY_COLORS, TYPE_COLORS } from "@/lib/palette";
import { SEVERITY_META, TARGET_META, TYPE_META } from "@/lib/taxonomy";
import { CategoryBadge, SeverityBadge, TypeBadge } from "@/components/ui/Badge";

interface Props {
  incidents: Incident[];
  variant?: "rows" | "cards" | "table" | "editorial" | "dense";
  limit?: number;
  hrefBase?: string;
}

function href(base: string, i: Incident) {
  return `${base}/${i.slug}`;
}

export function LatestList({ incidents, variant = "rows", limit, hrefBase = "/incidents" }: Props) {
  const items = limit ? incidents.slice(0, limit) : incidents;

  if (variant === "table") {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="label text-left">
              <th className="py-2 pr-4 font-normal">reported</th>
              <th className="py-2 pr-4 font-normal">incident</th>
              <th className="py-2 pr-4 font-normal">type</th>
              <th className="py-2 pr-4 font-normal">sev</th>
              <th className="py-2 pr-4 font-normal">target</th>
              <th className="py-2 font-normal text-right">src</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-line-soft hover:bg-panel-2/60">
                <td className="num py-2 pr-4 text-dim whitespace-nowrap">{i.first_reported}</td>
                <td className="py-2 pr-4">
                  <Link href={href(hrefBase, i)} className="text-ink hover:text-accent">
                    {i.title}
                  </Link>
                </td>
                <td className="py-2 pr-4 whitespace-nowrap" style={{ color: TYPE_COLORS[i.type] }}>
                  {TYPE_META[i.type].short}
                </td>
                <td className="num py-2 pr-4" style={{ color: SEVERITY_COLORS[i.severity] }}>
                  {i.severity}
                </td>
                <td className="py-2 pr-4 text-dim whitespace-nowrap">{TARGET_META[i.targets[0]!].label}</td>
                <td className="num py-2 text-right text-dim">{i.source_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (variant === "dense") {
    return (
      <ul className="divide-y divide-line-soft">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 py-1.5 text-[11.5px]">
            <span className="num text-faint w-20 shrink-0">{i.first_reported}</span>
            <span className="num w-3 shrink-0 text-center" style={{ color: SEVERITY_COLORS[i.severity] }}>
              {i.severity}
            </span>
            <Link href={href(hrefBase, i)} className="truncate text-soft hover:text-accent">
              {i.title}
            </Link>
            <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wider" style={{ color: TYPE_COLORS[i.type] }}>
              {TYPE_META[i.type].short}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (variant === "cards") {
    return (
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <li key={i.id} className="panel p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="num text-[11px] text-dim">{dateLabel(i.first_reported)}</span>
              <SeverityBadge severity={i.severity} />
            </div>
            <Link href={href(hrefBase, i)} className="text-[14px] font-medium leading-snug text-ink hover:text-accent">
              {i.title}
            </Link>
            <p className="text-[12px] text-dim leading-relaxed line-clamp-3">{i.summary}</p>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
              <TypeBadge type={i.type} short />
              {i.categories.slice(0, 2).map((c) => (
                <CategoryBadge key={c} category={c} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (variant === "editorial") {
    return (
      <ol className="divide-y divide-line">
        {items.map((i) => (
          <li key={i.id} className="py-5 grid gap-2 sm:grid-cols-[7rem_1fr]">
            <div className="num text-[12px] text-dim pt-1">
              {dateLabel(i.first_reported)}
              <div className="mt-1 text-[10.5px] text-faint">{approxDateLabel(i.incident_date, i.incident_date_precision)}</div>
            </div>
            <div>
              <Link href={href(hrefBase, i)} className="text-[19px] leading-snug font-medium tracking-tight text-ink hover:text-accent">
                {i.title}
              </Link>
              <p className="mt-2 text-[14px] text-soft leading-relaxed">{i.summary}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <TypeBadge type={i.type} />
                <SeverityBadge severity={i.severity} short={false} />
                {i.categories.map((c) => (
                  <CategoryBadge key={c} category={c} short={false} />
                ))}
                <span className="num text-[11px] text-faint ml-1">
                  {i.source_count} source{i.source_count === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  // rows (default)
  return (
    <ul className="divide-y divide-line-soft">
      {items.map((i) => (
        <li key={i.id} className="py-3 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
          <span className="num text-[11px] text-dim sm:w-24 shrink-0 sm:pt-0.5">{i.first_reported}</span>
          <div className="min-w-0 flex-1">
            <Link href={href(hrefBase, i)} className="text-[13.5px] leading-snug text-ink hover:text-accent">
              {i.title}
            </Link>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <SeverityBadge severity={i.severity} />
              <TypeBadge type={i.type} short />
              {i.categories.slice(0, 2).map((c) => (
                <CategoryBadge key={c} category={c} />
              ))}
              <span className="num text-[10.5px] text-faint self-center" title={SEVERITY_META[i.severity].label}>
                {i.source_count} src
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
