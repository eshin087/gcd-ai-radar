import Link from "next/link";
import { AiChip, CvssChip, LaneBadge, PatchBadge, SeverityWord, StateDot } from "@/components/ui/Badge";
import { approxDateLabel, dateLabel } from "@/lib/format";
import type { LiveRow } from "@/lib/live";
import { SEVERITY_META } from "@/lib/taxonomy";

/**
 * One record as a ruled row, in three tones and colour for meaning only.
 * Left column (4.5 rem): the state dot and the CVSS chip when the record has
 * a score. Title line: the first product in the accent, the title in ink.
 * Meta line (mono 12 px): the lane in its colour, our severity as a word in
 * its colour (never a digit), the fix status glyph and word, the since and
 * updated dates dim, the CVE ids soft. Right column: the AI chip only. The
 * full variant adds the summary and the "Do:" action line. No hooks, so it
 * renders on the server and in client lists alike. The data attributes are
 * what scripts/check-live.mjs reads.
 */
export function IncidentRow({ row, variant = "compact", showLane = true, showState = true }: { row: LiveRow; variant?: "full" | "compact"; showLane?: boolean; showState?: boolean }) {
  const href = `/incidents/${row.slug}`;
  const product = row.products[0] ?? null;
  const showPatch = (row.lane === "patch" || row.lane === "supply_chain") && row.patch_status !== "unknown";
  // a research record at severity 1 would print "Research · Research": the lane word already says it
  const showSeverity = !(showLane && row.lane === "research" && row.severity === 1);
  const search = [row.title, ...row.products, ...row.cve_ids, row.id].join(" ").toLowerCase();
  const sep = <span className="text-faint"> · </span>;
  return (
    <li
      data-row=""
      data-id={row.id}
      data-lane={row.lane}
      data-state={row.state}
      data-patch={row.patch_status}
      data-ai={row.ai ? "1" : "0"}
      data-severity={row.severity}
      data-cvss={row.cvss ?? ""}
      data-tags={row.tags.join(" ")}
      data-search={search}
      className={`grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 border-t border-line-soft ${variant === "full" ? "py-3.5" : "py-2.5"}`}
    >
      <div className="flex items-center gap-2 self-start pt-[3px]">
        {showState && <StateDot state={row.state} />}
        <CvssChip score={row.cvss} />
      </div>
      <div className="min-w-0">
        <Link href={href} className="text-[15px] font-medium leading-snug text-ink hover:text-accent">
          {product && <span className="text-accent">{product} </span>}
          {row.title}
        </Link>
        <p className="mt-0.5 font-mono text-[12px] leading-relaxed text-dim">
          {showLane && <LaneBadge lane={row.lane} text />}
          {showSeverity && (
            <>
              {showLane && sep}
              <SeverityWord severity={row.severity} title={row.disclosed ? "A CVE or advisory with no confirmed exploitation: tracked, not counted as an incident" : SEVERITY_META[row.severity].definition} />
            </>
          )}
          {showPatch && (
            <>
              {sep}
              <PatchBadge status={row.patch_status} />
            </>
          )}
          {sep}
          <span className="whitespace-nowrap">since {approxDateLabel(row.since, row.since_precision)}</span>
          {row.last_update !== row.first_reported && (
            <>
              {sep}
              <span className="whitespace-nowrap">updated {dateLabel(row.last_update)}</span>
            </>
          )}
          {row.cve_ids.length > 0 && (
            <>
              {sep}
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
      </div>
      <div className="flex items-start justify-end pt-[2px]">
        <AiChip type={row.type} />
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
