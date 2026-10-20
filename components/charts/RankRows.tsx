"use client";

import Link from "next/link";
import { pctChange } from "@/lib/stats";
import { DeltaChip } from "./DeltaChip";
import { useBoxWidth } from "./hooks";

export interface RankRow {
  key: string;
  /** A short code in its own mono column ("LLM01", "AML.T0051"), optionally linking to the official entry. */
  code?: string;
  codeHref?: string;
  label: string;
  /** An internal page for the label (a product page). */
  labelHref?: string;
  title?: string;
  count: number;
  onCount?: () => void;
  /** What the count is, for its accessible name: "<countName>: <n> <unit>". */
  countName: string;
  /** What the count counts; "incidents" unless it is disclosed vulnerabilities. */
  unit?: string;
  /** The same count in the window before, for the change chip; null or undefined draws none. */
  prior?: number | null;
  /** A second count in its own column (disclosed CVEs), with its own drawer. */
  extra?: { count: number; onClick?: () => void; name: string };
  /** A row set apart from the ones above it (a total or a different kind of count). */
  divider?: boolean;
  /** False for a row whose count is on another scale than the bars (it draws no bar). */
  bar?: boolean;
}

interface Props {
  rows: RankRow[];
  /** Column headings, in the order the columns appear. */
  head: { label: string; count: string; extra?: string; change?: string };
  /** Width of the code column when the rows have codes. */
  codeWidth?: string;
  color: string;
  /** The data-chart name, for scripts/check-drawers.mjs. */
  chart: string;
  /** Scale for the bars; defaults to the largest count. */
  max?: number;
}

const ROW = "h-9";
const COUNT = "num underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent hover:decoration-[color:var(--color-accent)]";

/**
 * A ranked list on a fixed grid: a heading row, then rows 36 px tall, each
 * with an optional code, a label, a bar on the list's scale, the count (it
 * opens the drawer), an optional second count and the change on the window
 * before. Every panel built from it puts the same things at the same heights,
 * so two lists side by side line up row for row. Labels take up to two
 * lines inside the row. Narrow panels drop the bar.
 */
export function RankRows({ rows, head, codeWidth = "3.75rem", color, chart, max }: Props) {
  const [ref, width] = useBoxWidth<HTMLDivElement>(560);
  const hasCode = rows.some((r) => r.code);
  const hasExtra = rows.some((r) => r.extra) && head.extra !== undefined;
  const hasChange = head.change !== undefined;
  const showBar = width >= 400;
  const top = Math.max(1, max ?? Math.max(...rows.filter((r) => r.bar !== false).map((r) => r.count)));
  const cols = [hasCode ? codeWidth : null, "minmax(0,1fr)", showBar ? "minmax(3rem,0.45fr)" : null, "3rem", hasExtra ? "3.25rem" : null, hasChange ? "4.75rem" : null].filter(Boolean).join(" ");

  return (
    <div ref={ref} data-chart={chart} className="min-w-0">
      <div className="grid h-7 items-end gap-x-3 border-b border-line-soft pb-1.5 text-[12px] text-dim" style={{ gridTemplateColumns: cols }} aria-hidden>
        {hasCode && <span />}
        <span>{head.label}</span>
        {showBar && <span />}
        <span className="text-right">{head.count}</span>
        {hasExtra && <span className="text-right">{head.extra}</span>}
        {hasChange && <span className="text-right">{head.change}</span>}
      </div>
      <ol>
        {rows.map((r, k) => (
          <li key={r.key} className={`grid ${ROW} items-center gap-x-3 ${r.divider ? "border-t border-line" : k > 0 ? "border-t border-line-soft" : ""}`} style={{ gridTemplateColumns: cols }}>
            {hasCode &&
              (r.code && r.codeHref ? (
                <a href={r.codeHref} target="_blank" rel="noreferrer" className="num truncate text-[12px] text-dim hover:text-accent" title={`${r.code} on the official site`}>
                  {r.code}
                </a>
              ) : (
                <span className="num truncate text-[12px] text-dim">{r.code}</span>
              ))}
            {r.labelHref ? (
              <Link href={r.labelHref} className="group/l flex min-w-0 items-center gap-1.5 text-[14px] leading-4 text-ink hover:text-accent" title={r.title ?? r.label}>
                <span className="line-clamp-2">{r.label}</span>
                <span aria-hidden className="shrink-0 text-[12px] text-faint group-hover/l:text-accent">
                  →
                </span>
              </Link>
            ) : (
              // up to two lines, which still fit the 36 px row
              <span className="line-clamp-2 text-[14px] leading-4 text-ink" title={r.title ?? r.label}>
                {r.label}
              </span>
            )}
            {showBar && r.bar === false && <span />}
            {showBar && r.bar !== false && (
              <span className="relative h-1.5 rounded-full bg-[color-mix(in_oklab,var(--color-line)_45%,transparent)]">
                <span
                  className="grow-x absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${r.count > 0 ? Math.max(2, (r.count / top) * 100) : 0}%`, background: color, boxShadow: `0 0 8px color-mix(in oklab, ${color} 45%, transparent)`, animationDelay: `${k * 40}ms` }}
                />
              </span>
            )}
            {r.count > 0 ? (
              <button type="button" onClick={r.onCount} aria-label={`${r.countName}: ${r.count} ${r.unit ?? "incidents"}`} className={`${COUNT} text-right text-[14px] text-ink`}>
                {r.count.toLocaleString("en-US")}
              </button>
            ) : (
              <span className="num text-right text-[14px] text-faint">0</span>
            )}
            {hasExtra &&
              (r.extra && r.extra.count > 0 ? (
                <button type="button" onClick={r.extra.onClick} aria-label={`${r.extra.name}: ${r.extra.count} disclosed vulnerabilities`} className={`${COUNT} text-right text-[13px] text-soft`}>
                  {r.extra.count.toLocaleString("en-US")}
                </button>
              ) : (
                <span className="num text-right text-[13px] text-faint">{r.extra ? "0" : ""}</span>
              ))}
            {hasChange && (
              <span className="flex justify-end">
                {r.prior === null || r.prior === undefined ? (
                  <span className="text-[12px] text-faint">—</span>
                ) : r.count === 0 && r.prior === 0 ? (
                  <span className="text-[12px] text-faint">—</span>
                ) : (
                  <DeltaChip size="md" pct={pctChange(r.count, r.prior)} title={`${r.count} now against ${r.prior} in the window before`} />
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
