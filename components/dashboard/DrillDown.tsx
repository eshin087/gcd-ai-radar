"use client";

import { useEffect, useMemo, useState } from "react";
import { IncidentRow } from "@/components/incidents/IncidentRow";
import type { CompactRow } from "@/lib/dashboard";
import { monthLabel } from "@/lib/format";
import { rowOfSlim, type LiveRow } from "@/lib/live";
import { productFamily } from "@/lib/products";
import { isDisclosedSelection, selectionLabel, selectionQuery, type Selection } from "@/lib/selection";
import { shardYear } from "@/lib/shard-year";
import type { SlimIncident } from "@/lib/slim";
import type { DateField } from "@/lib/stats";
import { isAiType } from "@/lib/taxonomy";

/** A row from the compact record alone, until its slim record (summary, tags) has loaded. */
function rowOfCompact(r: CompactRow): LiveRow {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: "",
    lane: r.lane ?? "patch",
    type: r.type,
    ai: isAiType(r.type),
    severity: r.severity,
    state: r.state ?? "closed",
    patch_status: r.patch_status ?? "unknown",
    cvss: r.cvss ?? null,
    products: (r.products ?? []).map(productFamily).slice(0, 3),
    cve_ids: [],
    cve_more: 0,
    action: "",
    since: r.incident_date,
    since_precision: r.incident_date_precision,
    first_reported: r.first_reported,
    last_update: r.first_reported,
    tags: [],
    disclosed: r.disclosed,
  };
}

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

      <ol className="border-b border-line-soft">
        {visible.map((r) => {
          const d = details.get(r.id);
          return <IncidentRow key={r.id} row={d ? rowOfSlim(d) : rowOfCompact(r)} variant={d ? "full" : "compact"} />;
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
