import { CATEGORY_COLORS, SEVERITY_COLORS, TYPE_COLORS } from "@/lib/palette";
import {
  ATLAS_TECHNIQUES,
  CATEGORY_META,
  LANE_META,
  OWASP_LLM_META,
  PATCH_META,
  SEVERITY_META,
  TYPE_META,
  isAiType,
  owaspLabel,
  type AtlasTechniqueId,
  type Category,
  type IncidentType,
  type Lane,
  type OwaspLlmId,
  type PatchStatus,
  type RecordState,
  type Severity,
} from "@/lib/taxonomy";

/**
 * Chips carry identity in a colored swatch; the text stays in ink tokens so it
 * is always legible (dataviz rule: text never wears the data color). Colors
 * come from CSS variables when a theme defines them (--sev-N, --cat-<key>,
 * --type-<key>), otherwise from lib/palette.ts.
 */
function Chip({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] whitespace-nowrap text-soft"
      style={{ borderColor: `color-mix(in oklab, ${color} 38%, transparent)`, background: `color-mix(in oklab, ${color} 9%, transparent)` }}
    >
      <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

export function CategoryBadge({ category, short = true }: { category: Category; short?: boolean }) {
  const meta = CATEGORY_META[category];
  return (
    <Chip color={`var(--cat-${category}, ${CATEGORY_COLORS[category]})`} title={meta.definition}>
      {short ? meta.short : meta.label}
    </Chip>
  );
}

export function SeverityBadge({ severity, short = true }: { severity: Severity; short?: boolean }) {
  const meta = SEVERITY_META[severity];
  return (
    <Chip color={`var(--sev-${severity}, ${SEVERITY_COLORS[severity]})`} title={meta.definition}>
      <span className="num">{severity}</span> {short ? meta.short : meta.label}
    </Chip>
  );
}

/**
 * OWASP LLM Top 10 and MITRE ATLAS ids: neutral chips with no swatch, since
 * they restate the categories in another vocabulary rather than add a new
 * dimension to colour. The full name is in the tooltip.
 */
export function StandardBadge({ standard, id }: { standard: "owasp"; id: OwaspLlmId } | { standard: "atlas"; id: AtlasTechniqueId }) {
  const title = standard === "owasp" ? `OWASP ${owaspLabel(id)} ${OWASP_LLM_META[id].name}` : `MITRE ATLAS ${id} ${ATLAS_TECHNIQUES[id]}`;
  return (
    <span title={title} className="inline-flex items-center rounded-[3px] border border-line-soft px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.04em] whitespace-nowrap text-dim">
      {id}
    </span>
  );
}

export function TypeBadge({ type, short = false }: { type: IncidentType; short?: boolean }) {
  const meta = TYPE_META[type];
  return (
    <Chip color={`var(--type-${type}, ${TYPE_COLORS[type]})`} title={meta.definition}>
      {short ? meta.short : meta.label}
    </Chip>
  );
}

/** The lane, as a plain text chip: a lane is a place, not a data colour. */
export function LaneBadge({ lane, short = false }: { lane: Lane; short?: boolean }) {
  const meta = LANE_META[lane];
  return (
    <span title={meta.definition} className="inline-flex items-center rounded-[2px] border border-line px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-[0.06em] whitespace-nowrap text-dim">
      {short ? meta.short : meta.label}
    </span>
  );
}

const TONE: Record<PatchStatus, string> = {
  unpatched: "text-live",
  partial: "text-partial",
  patched: "text-patched",
  no_fix_needed: "text-dim",
  unknown: "text-dim",
};

/** The patch status: its glyph in the status colour, its label in text, never colour alone. */
export function PatchBadge({ status, glyphOnly = false }: { status: PatchStatus; glyphOnly?: boolean }) {
  const meta = PATCH_META[status];
  return (
    <span title={meta.definition} className={`inline-flex items-center gap-1.5 font-mono text-[12px] whitespace-nowrap ${TONE[status]}`}>
      <span aria-hidden className="w-3 text-center leading-none">
        {meta.glyph}
      </span>
      <span className={glyphOnly ? "sr-only" : undefined}>{meta.label}</span>
    </span>
  );
}

/** Live or closed: a dot in the live colour (pulsing while live, still under reduced motion) with the word for screen readers and tooltips. */
export function StateDot({ state, className = "" }: { state: RecordState; className?: string }) {
  const live = state === "live";
  return (
    <span title={live ? "Live: updated or unpatched within the lane's window" : "Closed: no activity within the lane's window"} className={`inline-flex items-center ${className}`}>
      <span aria-hidden className={`inline-block size-2 rounded-full ${live ? "bg-live live-dot" : "bg-closed"}`} />
      <span className="sr-only">{live ? "live" : "closed"}</span>
    </span>
  );
}

/** The AI lens on a row: shown only for AI records, with the type in the tooltip. */
export function AiChip({ type }: { type: IncidentType }) {
  if (!isAiType(type)) return null;
  return (
    <span
      title={`${TYPE_META[type].label}: ${TYPE_META[type].definition}`}
      className="inline-flex items-center rounded-[2px] border border-accent/40 bg-accent-tint px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-[0.06em] text-accent"
    >
      AI
    </span>
  );
}
