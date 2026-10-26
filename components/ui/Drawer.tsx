"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The id of the heading inside, for aria-labelledby. */
  titleId: string;
  /** The toolbar line: what the drawer holds, in a few words. */
  kicker: ReactNode;
  /** A link to the same list as a page, shown in the toolbar and in the phone footer. */
  footerLink?: { href: string; label: string; external?: boolean } | null;
  children: ReactNode;
  /** Extra classes for the panel (theme surfaces). */
  className?: string;
  closeLabel?: string;
}

/**
 * A right-hand drawer over the page: opening it never changes the page
 * length. A toolbar with the close button stays put while the body scrolls
 * under it, and on phones a second close button sits at the bottom edge,
 * under the thumb. Esc and the scrim dismiss it; focus moves into the drawer
 * and returns to the clicked control afterwards; the page behind does not
 * scroll while it is open. The report drawer (components/dashboard) and the
 * list drawer (ListDrawer.tsx) are both this shell with a different body, so
 * one check-script contract (`[role="dialog"]`, a `p.num` that starts with
 * the count, `ol > li` rows) covers every drawer on the site.
 */
export function Drawer({ open, onClose, titleId, kicker, footerLink, children, className = "", closeLabel = "Close" }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

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

  if (!open) return null;
  const link = (extra: string) =>
    footerLink ? (
      footerLink.external ? (
        <a href={footerLink.href} target="_blank" rel="noopener noreferrer" className={`label hover:text-ink ${extra}`}>
          {footerLink.label}
        </a>
      ) : (
        <Link href={footerLink.href} className={`label hover:text-ink ${extra}`}>
          {footerLink.label}
        </Link>
      )
    ) : null;
  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" tabIndex={-1} aria-label={closeLabel} onClick={onClose} className="drawer-scrim absolute inset-0 cursor-default" />
      <aside className={`drawer-panel absolute inset-y-0 right-0 flex w-full max-w-[660px] flex-col border-l border-line bg-panel shadow-2xl ${className}`}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4 py-2.5 sm:px-7">
          <div className="label min-w-0 truncate">{kicker}</div>
          <div className="flex shrink-0 items-center gap-3">
            {link("hidden sm:inline")}
            <button ref={closeRef} type="button" onClick={onClose} className="label rounded-[3px] border border-line px-2 py-1 hover:text-ink" aria-label={closeLabel}>
              close ×
            </button>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 sm:p-7">{children}</div>
        <div className="flex shrink-0 items-center gap-3 border-t border-line-soft px-4 pt-3 sm:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          {link("whitespace-nowrap")}
          <button type="button" onClick={onClose} className="label flex-1 rounded-[3px] border border-line py-2.5 text-center hover:text-ink" aria-label={closeLabel}>
            close ×
          </button>
        </div>
      </aside>
    </div>
  );
}
