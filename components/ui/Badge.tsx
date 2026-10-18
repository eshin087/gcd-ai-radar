import { CATEGORY_COLORS, SEVERITY_COLORS, TYPE_COLORS } from "@/lib/palette";
import { CATEGORY_META, SEVERITY_META, TYPE_META, type Category, type IncidentType, type Severity } from "@/lib/taxonomy";

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

export function TypeBadge({ type, short = false }: { type: IncidentType; short?: boolean }) {
  const meta = TYPE_META[type];
  return (
    <Chip color={`var(--type-${type}, ${TYPE_COLORS[type]})`} title={meta.definition}>
      {short ? meta.short : meta.label}
    </Chip>
  );
}
