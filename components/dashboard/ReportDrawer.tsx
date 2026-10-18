"use client";

import { useEffect, useId, useRef } from "react";
import { ReportBody } from "@/components/dashboard/DrillDown";
import type { Basis, CompactRow } from "@/lib/dashboard";
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
 * changes the page length. Esc, the scrim or the close button dismiss it;
 * focus moves into the drawer and returns to the clicked number afterwards;
 * the page behind does not scroll while it is open.
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
  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" tabIndex={-1} aria-label="Close report" onClick={onClose} className="drawer-scrim absolute inset-0 cursor-default" />
      <aside className={`drawer-panel absolute inset-y-0 right-0 flex w-full max-w-[660px] flex-col border-l border-line bg-panel shadow-2xl ${className}`}>
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 sm:p-7">
          <ReportBody key={JSON.stringify(selection)} selection={selection} rows={rows} error={error} windowLabel={windowLabel} basis={basis} field={field} onClose={onClose} titleId={titleId} closeRef={closeRef} />
        </div>
      </aside>
    </div>
  );
}
