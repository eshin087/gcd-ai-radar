import Link from "next/link";
import { AiChip, LaneBadge, PatchBadge, SeverityBadge, StateDot } from "@/components/ui/Badge";
import { approxDateLabel, dateLabel } from "@/lib/format";
import type { LiveRow } from "@/lib/live";
import { SEVERITY_META } from "@/lib/taxonomy";

/**
 * One record as a ruled row: the status column (live dot, patch glyph), the
 * title, a mono meta line (products · since · updated), then the lane and the
 * AI chip. The full variant adds the summary and the "Do:" action line. No
 * hooks, so it renders on the server and in client lists alike. The data
 * attributes are what scripts/check-live.mjs reads.
 */
export function IncidentRow({ row, variant = "compact", showLane = true, showState = true }: { row: LiveRow; variant?: "full" | "compact"; showLane?: boolean; showState?: boolean }) {
  const href = `/incidents/${row.slug}`;
  const meta = [
    row.products.length ? row.products.join(", ") : null,
    `since ${approxDateLabel(row.since, row.since_precision)}`,
    row.last_update !== row.first_reported ? `updated ${dateLabel(row.last_update)}` : null,
  ].filter(Boolean);
  const search = [row.title, ...row.products, ...row.cve_ids, row.id].join(" ").toLowerCase();
  return (
    <li
      data-row=""
      data-id={row.id}
      data-lane={row.lane}
      data-state={row.state}
      data-patch={row.patch_status}
      data-ai={row.ai ? "1" : "0"}
      data-severity={row.severity}
      data-tags={row.tags.join(" ")}
      data-search={search}
      className={`grid gap-x-3 gap-y-1.5 border-t border-line-soft ${variant === "full" ? "py-3.5" : "py-2.5"} grid-cols-[3.25rem_minmax(0,1fr)] sm:grid-cols-[4rem_minmax(0,1fr)_auto]`}
    >
      <div className="flex items-start gap-2 pt-[3px] font-mono text-[12px]">
        {showState && <StateDot state={row.state} className="pt-[3px]" />}
        <span title={`Severity ${row.severity}: ${SEVERITY_META[row.severity].label}`} className="num text-dim">
          {row.severity}
        </span>
        {row.lane !== "breach" && row.lane !== "research" && <PatchBadge status={row.patch_status} glyphOnly />}
      </div>
      <div className="min-w-0">
        <Link href={href} className="text-[15px] font-medium leading-snug text-ink hover:text-accent">
          {row.title}
        </Link>
        <p className="mt-0.5 font-mono text-[12px] leading-relaxed text-dim">
          {meta.join(" · ")}
          {row.cve_ids.length > 0 && (
            <>
              {" · "}
              <span className="text-soft">{row.cve_ids.join(", ")}</span>
              {row.cve_more > 0 && <span className="text-faint"> +{row.cve_more}</span>}
            </>
          )}
        </p>
        {variant === "full" && (
          <>
            <p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-soft">{row.summary}</p>
            {row.action && (
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-soft">
                <span className="mr-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-accent">Do:</span>
                {row.action}
              </p>
            )}
          </>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:hidden">
          {showLane && <LaneBadge lane={row.lane} short />}
          <AiChip type={row.type} />
          {row.disclosed && <SeverityBadge severity={row.severity} />}
        </div>
      </div>
      <div className="hidden flex-col items-end gap-1.5 sm:flex">
        {showLane && <LaneBadge lane={row.lane} />}
        <AiChip type={row.type} />
        {row.disclosed && (
          <span title="A CVE or advisory with no confirmed exploitation: tracked, not counted as an incident" className="font-mono text-[12px] uppercase tracking-[0.06em] text-faint">
            disclosed
          </span>
        )}
      </div>
    </li>
  );
}

/** A month heading inside a list of rows, with its count. */
export function MonthHeading({ month, count }: { month: string; count: number }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-t border-line pt-4 pb-1 font-mono text-[12px] uppercase tracking-[0.1em] text-dim">
      <span>{month}</span>
      <span className="num text-faint">{count.toLocaleString("en-US")}</span>
    </li>
  );
}
