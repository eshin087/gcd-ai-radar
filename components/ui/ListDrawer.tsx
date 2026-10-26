"use client";

import { useId, type ReactNode } from "react";
import { Drawer } from "@/components/ui/Drawer";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The toolbar line. */
  kicker: ReactNode;
  title: string;
  /** How many items the list stands for (the rows may be capped below it). */
  count: number;
  /** What is counted, in the plural: "CVEs", "breaches". */
  unit: string;
  /** After the count: the source and its licence, or the rule behind the list. */
  note?: ReactNode;
  /** The same list on its source's site. */
  outbound?: { href: string; label: string } | null;
  loading?: boolean;
  error?: string | null;
  /** The rows, as `li` elements. */
  children: ReactNode;
  /** Shown when the rows are capped: "the 200 highest-scored of …". */
  capNote?: ReactNode;
}

/**
 * A list that is not made of incident records (the week's CVEs, a month's
 * KEV additions, a month's breaches) in the shared drawer shell. The count
 * line starts with plain digits, which scripts/check-home.mjs reads.
 */
export function ListDrawer({ open, onClose, kicker, title, count, unit, note, outbound, loading, error, children, capNote }: Props) {
  const titleId = useId();
  return (
    <Drawer open={open} onClose={onClose} titleId={titleId} kicker={kicker} footerLink={outbound ? { ...outbound, external: true } : null} closeLabel="Close list">
      <header className="space-y-1">
        <h2 id={titleId} className="text-[18px] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h2>
        <p className="num text-[13px] text-dim">
          {String(count)} {unit}
          {note && <> · {note}</>}
        </p>
        {capNote && <p className="text-[12px] text-faint">{capNote}</p>}
      </header>
      {error ? (
        <p className="text-[13px] text-live">{error}</p>
      ) : loading ? (
        <p className="text-[13px] text-dim">Loading…</p>
      ) : (
        <ol className="border-y border-line-soft">{children}</ol>
      )}
    </Drawer>
  );
}
