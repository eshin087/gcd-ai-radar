"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { isDisclosedSelection, ReportBody, selectionQuery } from "@/components/dashboard/DrillDown";
import type { Basis, CompactRow } from "@/lib/dashboard";
import { monthLabel } from "@/lib/format";
import type { Selection } from "@/lib/selection";
import type { DateField } from "@/lib/stats";

interface Props {
  selection: Selection | null;
  /** The rows behind the selection, or null while their year shards load. */
  rows: CompactRow[] | null;
  error?: string | null;
  windowLabel: string;
  basis: Basis;
  field: DateField;
  onClose: () => void;
  /** Extra classes for the panel (theme surfaces). */
  className?: string;
}

/**
 * The incident report as a right-hand drawer over the page: opening it never
 * changes the page length. A toolbar with the close button stays put while
 * the report scrolls under it, and on phones a second close button sits at
 * the bottom edge, under the thumb. Esc and the scrim dismiss it too; focus
 * moves into the drawer and returns to the clicked number afterwards; the
 * page behind does not scroll while it is open.
 */
export function ReportDrawer({ selection, rows, error, windowLabel, basis, field, onClose, className = "" }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const open = selection !== null;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    const gutter = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (gutter > 0) root.style.paddingRight = `${gutter}px`;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = overflow;
      root.style.paddingRight = "";
      window.removeEventListener("keydown", onKey);
      before?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!selection) return null;
  const scope =
    selection.kind === "range"
      ? selection.from === selection.to
        ? monthLabel(selection.from, true)
        : `${monthLabel(selection.from, true)} to ${monthLabel(selection.to, true)}`
      : windowLabel;
  const kind = isDisclosedSelection(selection) ? "disclosed vulnerabilities · not counted" : `incident report · ${basis === "real" ? "real-world only" : "all incidents"}`;
  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" tabIndex={-1} aria-label="Close report" onClick={onClose} className="drawer-scrim absolute inset-0 cursor-default" />
      <aside className={`drawer-panel absolute inset-y-0 right-0 flex w-full max-w-[660px] flex-col border-l border-line bg-panel shadow-2xl ${className}`}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4 py-2.5 sm:px-7">
          <div className="label min-w-0 truncate">
            {kind} · by {field === "incident_date" ? "incident date" : "first report"} · {scope}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link href={`/incidents?${selectionQuery(selection, basis, field)}`} className="label hidden hover:text-ink sm:inline">
              open in incidents →
            </Link>
            <button ref={closeRef} type="button" onClick={onClose} className="label rounded-[3px] border border-line px-2 py-1 hover:text-ink" aria-label="Close report">
              close ×
            </button>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 sm:p-7">
          <ReportBody key={JSON.stringify(selection)} selection={selection} rows={rows} error={error} windowLabel={windowLabel} basis={basis} field={field} titleId={titleId} />
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-line-soft px-4 pt-3 sm:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <Link href={`/incidents?${selectionQuery(selection, basis, field)}`} className="label whitespace-nowrap hover:text-ink">
            open in incidents →
          </Link>
          <button type="button" onClick={onClose} className="label flex-1 rounded-[3px] border border-line py-2.5 text-center hover:text-ink" aria-label="Close report">
            close ×
          </button>
        </div>
      </aside>
    </div>
  );
}
