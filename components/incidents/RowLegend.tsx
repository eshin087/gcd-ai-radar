import { CvssChip, LaneBadge, PatchBadge } from "@/components/ui/Badge";
import { LANES } from "@/lib/taxonomy";

/**
 * One line that reads the row's colours back: the CVSS bands, the lanes, the
 * fix status glyphs. Shown under the lane tabs on the live board and, later,
 * under the two columns on the home page. Mono 12 px, dim; every colour has
 * its word beside it, so the legend is a reminder and never the only key.
 */
export function RowLegend({ className = "" }: { className?: string }) {
  const sep = <span aria-hidden className="text-faint">·</span>;
  return (
    <p data-row-legend="" className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[12px] leading-none text-dim ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <span className="uppercase tracking-[0.08em]">CVSS</span>
        <CvssChip score={9} label="9+" />
        <CvssChip score={7} label="7+" />
        <CvssChip score={4} label="4+" />
        <CvssChip score={0} label="<4" />
      </span>
      {sep}
      <span className="inline-flex items-center gap-2">
        <span className="uppercase tracking-[0.08em]">lane</span>
        {LANES.map((lane) => (
          <LaneBadge key={lane} lane={lane} short text />
        ))}
      </span>
      {sep}
      <span className="inline-flex items-center gap-2">
        <span className="uppercase tracking-[0.08em]">fix</span>
        <PatchBadge status="unpatched" />
        <PatchBadge status="partial" />
        <PatchBadge status="patched" />
      </span>
    </p>
  );
}
