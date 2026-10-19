"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { SEVERITY_COLORS } from "@/lib/palette";
import { PRODUCT_SORTS, sortProducts, type ProductSort, type ProductStats } from "@/lib/products";
import { SEVERITIES, SEVERITY_META } from "@/lib/taxonomy";

/** What a row needs: the stats without the CVE and name lists, which stay on the product page. */
export type ProductRow = Pick<ProductStats, "label" | "slug" | "records" | "incidents" | "disclosed" | "exploited" | "kev" | "bySeverity" | "latest">;

function parseSort(search: string): ProductSort {
  const s = new URLSearchParams(search).get("sort");
  return s === "recent" || s === "name" ? s : "records";
}
const noop = () => () => {};
const readUrlSort = () => parseSort(window.location.search);
const serverSort = (): ProductSort => "records";

const COLS = "sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_7rem_6rem]";

/**
 * The product index as rows: label, counts, a severity bar and the newest
 * first report. The order is mirrored in the URL (?sort=recent) so a view
 * can be linked; the server renders the default order.
 */
export function ProductTable({ products }: { products: ProductRow[] }) {
  const urlSort = useSyncExternalStore(noop, readUrlSort, serverSort);
  const [picked, setPicked] = useState<ProductSort | null>(null);
  const sort = picked ?? urlSort;
  const rows = useMemo(() => sortProducts(products, sort), [products, sort]);

  const pick = (s: ProductSort) => {
    setPicked(s);
    const p = new URLSearchParams(window.location.search);
    if (s === "records") p.delete("sort");
    else p.set("sort", s);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Sort" value={sort} options={PRODUCT_SORTS} onChange={pick} size="sm" />
        <span className="label">{rows.length} product families</span>
      </div>
      <ol className="divide-y divide-line-soft border-y border-line-soft">
        <li className={`hidden gap-x-4 py-2 label sm:grid ${COLS}`} aria-hidden>
          <span>product</span>
          <span className="text-right">records</span>
          <span className="text-right">disclosed</span>
          <span className="text-right">exploited</span>
          <span>severity 1–4</span>
          <span className="text-right">latest</span>
        </li>
        {rows.map((p) => (
          <li key={p.slug} className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 py-2.5 ${COLS}`}>
            <Link href={`/products/${p.slug}`} className="min-w-0 truncate text-[14.5px] text-ink hover:text-accent">
              {p.label}
              {p.kev > 0 && (
                <span className="label ml-2 text-sev-3" title={`${p.kev} record${p.kev === 1 ? "" : "s"} flagged as listed in CISA KEV`}>
                  kev
                </span>
              )}
            </Link>
            <span className="num text-[12px] text-dim sm:order-last sm:text-right">{p.latest}</span>
            <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] sm:contents">
              <Cell value={p.records} unit="records" strong />
              <Cell value={p.disclosed} unit="disclosed" />
              <Cell value={p.exploited} unit="exploited" />
              <SeverityBar bySeverity={p.bySeverity} total={p.records} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Cell({ value, unit, strong = false }: { value: number; unit: string; strong?: boolean }) {
  return (
    <span className={`num whitespace-nowrap sm:text-right ${strong ? "text-ink" : "text-soft"}`}>
      {value.toLocaleString("en-US")}
      <span className="text-dim sm:hidden"> {unit}</span>
    </span>
  );
}

/** Stacked bar of the four severities; the counts are in the title and the accessible name. */
function SeverityBar({ bySeverity, total }: { bySeverity: ProductRow["bySeverity"]; total: number }) {
  const text = SEVERITIES.filter((s) => bySeverity[s] > 0)
    .map((s) => `${bySeverity[s]} ${SEVERITY_META[s].short.toLowerCase()}`)
    .join(", ");
  return (
    <span role="img" aria-label={`severity: ${text}`} title={text} className="flex h-1.5 w-24 shrink-0 self-center overflow-hidden rounded-[2px] bg-panel-2 sm:w-full">
      {SEVERITIES.map(
        (s) =>
          bySeverity[s] > 0 && <span key={s} style={{ width: `${(bySeverity[s] / Math.max(1, total)) * 100}%`, background: SEVERITY_COLORS[s] }} />,
      )}
    </span>
  );
}
