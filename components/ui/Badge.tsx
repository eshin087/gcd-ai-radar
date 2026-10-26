import { CVSS_BAND_META, cvssBand, cvssLabel, type CvssBand } from "@/lib/cvss";
import { CATEGORY_COLORS, CVSS_COLORS, LANE_COLORS, SEVERITY_COLORS, TYPE_COLORS } from "@/lib/palette";
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
 * --type-<key>), otherwise from lib/palette.ts. The filled variant is the one
 * exception, reserved for a number (the CVSS score): the colour is the whole
 * chip and the number sits on it in the ground tone.
 */
function Chip({ color, children, title, filled = false, ...rest }: { color: string; children: React.ReactNode; title?: string; filled?: boolean } & Record<`data-${string}`, string | undefined>) {
  if (filled) {
    return (
      <span
        {...rest}
        title={title}
        className="num inline-flex items-center rounded-[3px] px-1.5 py-[3px] text-[12px] font-semibold leading-none whitespace-nowrap text-ground"
        style={{ background: color }}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      {...rest}
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
 * Our severity as a word in its colour on a row's meta line ("Research",
 * "Disclosed", "Exploited", "Real loss"), never a digit: the digit is a
 * database value, the word is what it means. The definition is the tooltip.
 */
const SEVERITY_TEXT: Record<Severity, string> = { 1: "text-sev-1", 2: "text-sev-2", 3: "text-sev-3", 4: "text-sev-4" };

export function SeverityWord({ severity, title }: { severity: Severity; title?: string }) {
  const meta = SEVERITY_META[severity];
  return (
    <span title={title ?? meta.definition} className={`whitespace-nowrap ${SEVERITY_TEXT[severity]}`}>
      {meta.short}
    </span>
  );
}

/**
 * The CVSS base score on a filled chip coloured by band: red 9.0 and up,
 * orange 7.0 to 8.9, blue 4.0 to 6.9, grey below (lib/cvss.ts). Nothing when
 * the record has no score: an absent number is never drawn as a zero. The
 * version goes in the tooltip when a caller knows it; `label` lets a legend
 * print a band name on the chip instead of a score.
 */
const SEVERITY_OF_BAND: Record<CvssBand, Severity> = { critical: 4, high: 3, medium: 2, low: 1 };

export function CvssChip({ score, version, label }: { score: number | null | undefined; version?: string | null; label?: string }) {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  const band = cvssBand(score);
  const meta = CVSS_BAND_META[band];
  return (
    <Chip
      filled
      color={`var(--color-sev-${SEVERITY_OF_BAND[band]}, ${CVSS_COLORS[band]})`}
      title={`CVSS ${version ? `${version} ` : ""}base score ${cvssLabel(score)}: ${meta.label.toLowerCase()} (${meta.range})`}
      data-cvss-band={band}
    >
      {label ?? cvssLabel(score)}
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

/**
 * The lane in its colour (lib/palette.ts LANE_COLORS, --color-lane-<lane> in
 * globals.css): a chip on page headers, plain coloured text on a row's meta
 * line (`text`). A lane is a place, so the colour names it and the word is
 * always there beside it.
 */
/** Written out so Tailwind sees each class and emits the --color-lane-<lane> token (lib/palette.ts LANE_COLORS is the fallback where no stylesheet is loaded, as in OG images). */
const LANE_TEXT: Record<Lane, string> = { patch: "text-lane-patch", breach: "text-lane-breach", supply_chain: "text-lane-supply_chain", research: "text-lane-research" };

export function LaneBadge({ lane, short = false, text = false }: { lane: Lane; short?: boolean; text?: boolean }) {
  const meta = LANE_META[lane];
  const fallback = { color: LANE_COLORS[lane] };
  if (text) {
    return (
      <span title={meta.definition} className={`whitespace-nowrap ${LANE_TEXT[lane]}`} style={fallback}>
        {short ? meta.short : meta.label}
      </span>
    );
  }
  return (
    <span
      title={meta.definition}
      className={`inline-flex items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-[0.06em] whitespace-nowrap ${LANE_TEXT[lane]}`}
      style={{ ...fallback, borderColor: "color-mix(in oklab, currentColor 45%, transparent)" }}
    >
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
