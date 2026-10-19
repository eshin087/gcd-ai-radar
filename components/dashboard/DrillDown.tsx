"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CategoryBadge, SeverityBadge, TypeBadge } from "@/components/ui/Badge";
import type { CompactRow } from "@/lib/dashboard";
import { approxDateLabel, monthLabel } from "@/lib/format";
import { isDisclosedSelection, selectionLabel, selectionQuery, type Selection } from "@/lib/selection";
import { shardYear } from "@/lib/shard-year";
import type { SlimIncident } from "@/lib/slim";
import type { DateField } from "@/lib/stats";
import { TARGET_META } from "@/lib/taxonomy";

export { isDisclosedSelection, selectionLabel, selectionQuery, type Selection };

/** Summaries, products and publishers per year shard (public/data/slim/<year>.json), fetched for the rows on screen. */
const slimCache = new Map<number, Promise<Map<string, SlimIncident>>>();
function loadSlim(year: number): Promise<Map<string, SlimIncident>> {
  let p = slimCache.get(year);
  if (!p) {
    p = fetch(`/data/slim/${year}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows: SlimIncident[]) => new Map(rows.map((r) => [r.id, r])))
      .catch((e: Error) => {
        slimCache.delete(year);
        throw e;
      });
    slimCache.set(year, p);
  }
  return p;
}

const PAGE = 40;

interface Props {
  selection: Selection;
  /** The rows behind the selection, or null while their shards load. */
  rows: CompactRow[] | null;
  error?: string | null;
  windowLabel: string;
  basis: "all" | "real";
  field: DateField;
}

/**
 * The report itself: what was clicked, how many incidents, and each one with
 * its summary, classification, sources and dates. Shown in the dashboard's
 * report drawer.
 */
export function ReportBody({ selection, rows, error, windowLabel, field, titleId }: Props & { titleId?: string }) {
  const [details, setDetails] = useState<Map<string, SlimIncident>>(new Map());
  const [shown, setShown] = useState(PAGE);

  const sorted = useMemo(() => (rows ? [...rows].sort((a, b) => b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id)) : []), [rows]);
  const visible = useMemo(() => sorted.slice(0, shown), [sorted, shown]);
  const yearsOnScreen = useMemo(() => [...new Set(visible.map(shardYear))].join(","), [visible]);

  useEffect(() => {
    if (!yearsOnScreen) return;
    let cancelled = false;
    Promise.all(yearsOnScreen.split(",").map((y) => loadSlim(Number(y))))
      .then((maps) => {
        if (cancelled) return;
        setDetails((prev) => {
          const next = new Map(prev);
          for (const m of maps) for (const [id, s] of m) next.set(id, s);
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [yearsOnScreen]);

  const sev = useMemo(() => {
    const m: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of rows ?? []) m[r.severity] = (m[r.severity] ?? 0) + 1;
    return m;
  }, [rows]);
  const noun = isDisclosedSelection(selection) ? (rows?.length === 1 ? "disclosed vulnerability" : "disclosed vulnerabilities") : rows?.length === 1 ? "incident" : "incidents";

  return (
    <>
      <header>
        <h2 id={titleId} className="text-xl font-semibold tracking-tight">
          {selectionLabel(selection)}
        </h2>
        <p className="mt-1 text-[13px] text-dim num" aria-live="polite">
          {rows ? (
            <>
              {rows.length} {noun} · severity 1:{sev[1]} 2:{sev[2]} 3:{sev[3]} 4:{sev[4]}
              {field === "first_reported" ? " · by first report" : ""}
              {selection.kind === "range" ? ` · ${selection.from === selection.to ? monthLabel(selection.from, true) : `${monthLabel(selection.from, true)} to ${monthLabel(selection.to, true)}`}` : ` · ${windowLabel}`}
            </>
          ) : error ? (
            <span className="text-sev-4">could not load the incidents: {error}</span>
          ) : (
            "loading…"
          )}
        </p>
      </header>

      <ol className="divide-y divide-line-soft border-y border-line-soft">
        {visible.map((r) => {
          const d = details.get(r.id);
          return (
            <li key={r.id} className="py-3.5 grid gap-2 sm:grid-cols-[7rem_1fr_auto] sm:gap-4">
              <div className="num text-[12px] text-dim">
                <div>{r.first_reported}</div>
                <div className="text-faint text-[11px]">{r.id}</div>
              </div>
              <div className="min-w-0">
                <Link href={`/incidents/${r.slug}`} className="text-[15px] leading-snug text-ink hover:text-accent">
                  {r.title}
                </Link>
                {d ? (
                  <p className="mt-1 text-[13px] text-dim leading-relaxed">{d.summary}</p>
                ) : (
                  <p className="mt-1 text-[13px] text-faint">loading summary…</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <SeverityBadge severity={r.severity} />
                  <TypeBadge type={r.type} short />
                  {r.categories.map((c) => (
                    <CategoryBadge key={c} category={c} />
                  ))}
                  <span className="num self-center text-[11.5px] text-faint">
                    {r.targets.map((t) => TARGET_META[t].label).join(", ")}
                    {d?.products.length ? ` · ${d.products.slice(0, 3).join(", ")}` : ""}
                  </span>
                </div>
              </div>
              <div className="num text-[12px] text-dim sm:text-right whitespace-nowrap">
                <div>
                  {r.source_count} source{r.source_count === 1 ? "" : "s"}
                </div>
                <div className="text-faint text-[11px]">{approxDateLabel(r.incident_date, r.incident_date_precision)}</div>
                {d?.publishers.length ? <div className="text-faint text-[11px] max-w-[12rem] truncate">{d.publishers.slice(0, 2).join(", ")}</div> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {sorted.length > shown && (
        <div className="text-center">
          <button type="button" onClick={() => setShown(shown + PAGE)} className="label border border-line rounded-[3px] px-3 py-2 hover:text-ink">
            show {Math.min(PAGE, sorted.length - shown)} more
          </button>
        </div>
      )}
      {rows && rows.length === 0 && <p className="text-[13px] text-dim">Nothing in this selection.</p>}
    </>
  );
}
