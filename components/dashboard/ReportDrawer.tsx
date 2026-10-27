"use client";

import { useId } from "react";
import { isDisclosedSelection, ReportBody, selectionQuery } from "@/components/dashboard/DrillDown";
import { Drawer } from "@/components/ui/Drawer";
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
 * The incident report in the shared drawer shell (components/ui/Drawer.tsx):
 * the toolbar says what report it is and links to the same list in the
 * archive; the body is ReportBody.
 */
export function ReportDrawer({ selection, rows, error, windowLabel, basis, field, onClose, className = "" }: Props) {
  const titleId = useId();
  if (!selection) return null;
  const scope =
    selection.kind === "range"
      ? selection.from === selection.to
        ? monthLabel(selection.from, true)
        : `${monthLabel(selection.from, true)} to ${monthLabel(selection.to, true)}`
      : windowLabel;
  const kind = isDisclosedSelection(selection) ? "disclosed vulnerabilities · not counted" : `incident report · ${basis === "real" ? "real-world only" : "all incidents"}`;
  return (
    <Drawer
      open
      onClose={onClose}
      titleId={titleId}
      kicker={`${kind} · by ${field === "incident_date" ? "incident date" : "first report"} · ${scope}`}
      footerLink={{ href: `/incidents?${selectionQuery(selection, basis, field)}`, label: "open in incidents →" }}
      className={className}
      closeLabel="Close report"
    >
      <ReportBody key={JSON.stringify(selection)} selection={selection} rows={rows} error={error} windowLabel={windowLabel} basis={basis} field={field} titleId={titleId} />
    </Drawer>
  );
}
