"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type Ref } from "react";
import { CategoryBadge, SeverityBadge, TypeBadge } from "@/components/ui/Badge";
import type { CompactRow } from "@/lib/dashboard";
import { FAMILY_META, type Family } from "@/lib/families";
import { approxDateLabel, monthLabel } from "@/lib/format";
import type { SlimIncident } from "@/lib/slim";
import type { DateField } from "@/lib/stats";
import { CATEGORY_META, SEVERITY_META, TARGET_META, TYPE_META, type Category, type IncidentType, type Severity, type Target } from "@/lib/taxonomy";

/** What the user clicked on a chart. */
export type Selection =
  | { kind: "month"; month: string }
  | { kind: "month-category"; month: string; category: Category }
  | { kind: "month-type"; month: string; type: IncidentType }
  | { kind: "month-family"; month: string; family: Family }
  | { kind: "family"; family: Family }
  | { kind: "target"; target: Target }
  | { kind: "severity"; severity: Severity }
  | { kind: "category"; category: Category }
  | { kind: "type"; type: IncidentType }
  /** Every incident in the current window and set. */
  | { kind: "window" }
  /** Severity 3-4 incidents in the current window. */
  | { kind: "real" }
  /** An inclusive month range on the date basis, independent of the window (trailing 12 months, year to date). */
  | { kind: "range"; from: string; to: string; label: string; toDate?: string; byYear?: boolean };

export function selectionLabel(sel: Selection): string {
  switch (sel.kind) {
    case "month":
      return monthLabel(sel.month, true);
    case "month-category":
      return `${CATEGORY_META[sel.category].label} · ${monthLabel(sel.month, true)}`;
    case "month-type":
      return `${TYPE_META[sel.type].label} · ${monthLabel(sel.month, true)}`;
    case "month-family":
      return `${FAMILY_META[sel.family].label} · ${monthLabel(sel.month, true)}`;
    case "family":
      return FAMILY_META[sel.family].label;
    case "target":
      return `Target: ${TARGET_META[sel.target].label}`;
    case "severity":
      return `Severity ${sel.severity} · ${SEVERITY_META[sel.severity].label}`;
    case "category":
      return CATEGORY_META[sel.category].label;
    case "type":
      return TYPE_META[sel.type].label;
    case "window":
      return "All incidents in view";
    case "real":
      return "Real-world incidents · severity 3–4";
    case "range":
      return sel.label;
  }
}

/** Query string for the same selection on the Incidents page. */
export function selectionQuery(sel: Selection, basis: "all" | "real", field: DateField): string {
  const p = new URLSearchParams();
  if (basis === "real") p.set("real", "1");
  if (field === "first_reported") p.set("by", "reported");
  switch (sel.kind) {
    case "month":
      p.set("month", sel.month);
      break;
    case "month-category":
      p.set("month", sel.month);
      p.set("category", sel.category);
      break;
    case "month-type":
      p.set("month", sel.month);
      p.set("type", sel.type);
      break;
    case "month-family":
      p.set("month", sel.month);
      p.set("category", FAMILY_META[sel.family].categories.join(","));
      break;
    case "family":
      p.set("category", FAMILY_META[sel.family].categories.join(","));
      break;
    case "target":
      p.set("target", sel.target);
      break;
    case "severity":
      p.set("severity", String(sel.severity));
      break;
    case "category":
      p.set("category", sel.category);
      break;
    case "type":
      p.set("type", sel.type);
      break;
    case "window":
      break;
    case "real":
      p.set("real", "1");
      break;
    case "range":
      p.set("from", sel.from);
      p.set("to", sel.to);
      break;
  }
  return p.toString();
}

let cache: Promise<Map<string, SlimIncident>> | null = null;
function loadSlim(): Promise<Map<string, SlimIncident>> {
  if (!cache) {
    cache = fetch("/data/incidents.min.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows: SlimIncident[]) => new Map(rows.map((r) => [r.id, r])));
  }
  return cache;
}

const PAGE = 40;

interface Props {
  selection: Selection;
  rows: CompactRow[];
  windowLabel: string;
  basis: "all" | "real";
  field: DateField;
  onClose: () => void;
}

/** Inline report panel under the charts (production dashboard). */
export function DrillDown(props: Props) {
  // The parent remounts this panel per selection (key), so its state resets by itself.
  useEffect(() => {
    document.getElementById("drilldown")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  return (
    <section id="drilldown" className="panel p-5 sm:p-6 scroll-mt-20 space-y-4" aria-live="polite">
      <ReportBody {...props} />
    </section>
  );
}

/**
 * The report itself: what was clicked, how many incidents, and each one with
 * its summary, classification, sources and dates. Used by the inline panel and
 * by the design-lab drawer.
 */
export function ReportBody({ selection, rows, windowLabel, basis, field, onClose, titleId, closeRef }: Props & { titleId?: string; closeRef?: Ref<HTMLButtonElement> }) {
  const [details, setDetails] = useState<Map<string, SlimIncident> | null>(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let cancelled = false;
    loadSlim()
      .then((m) => {
        if (!cancelled) setDetails(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(() => [...rows].sort((a, b) => b.first_reported.localeCompare(a.first_reported) || b.id.localeCompare(a.id)), [rows]);
  const sev = useMemo(() => {
    const m: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of rows) m[r.severity] = (m[r.severity] ?? 0) + 1;
    return m;
  }, [rows]);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="label">
            incident report · {basis === "real" ? "real-world only" : "all incidents"} · by {field === "incident_date" ? "incident date" : "first report"} ·{" "}
            {selection.kind === "range" ? (selection.from === selection.to ? monthLabel(selection.from, true) : `${monthLabel(selection.from, true)} to ${monthLabel(selection.to, true)}`) : windowLabel}
          </div>
          <h2 id={titleId} className="mt-1 text-xl font-semibold tracking-tight">
            {selectionLabel(selection)}
          </h2>
          <p className="mt-1 text-[13px] text-dim num">
            {rows.length} incident{rows.length === 1 ? "" : "s"} · severity 1:{sev[1]} 2:{sev[2]} 3:{sev[3]} 4:{sev[4]}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/incidents?${selectionQuery(selection, basis, field)}`} className="label hover:text-ink">
            open in incidents →
          </Link>
          <button ref={closeRef} type="button" onClick={onClose} className="label border border-line rounded-[3px] px-2 py-1 hover:text-ink" aria-label="Close report">
            close ×
          </button>
        </div>
      </header>

      <ol className="divide-y divide-line-soft border-y border-line-soft">
        {sorted.slice(0, shown).map((r) => {
          const d = details?.get(r.id);
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
      {rows.length === 0 && <p className="text-[13px] text-dim">No incidents in this selection.</p>}
    </>
  );
}
