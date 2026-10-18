import { CATEGORY_COLORS, SEVERITY_COLORS, TYPE_COLORS } from "@/lib/palette";
import { CATEGORY_META, SEVERITY_META, TYPE_META, type Category, type IncidentType, type Severity } from "@/lib/taxonomy";

function Chip({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] whitespace-nowrap"
      style={{ borderColor: `${color}55`, color, background: `${color}14` }}
    >
      {children}
    </span>
  );
}

export function CategoryBadge({ category, short = true }: { category: Category; short?: boolean }) {
  const meta = CATEGORY_META[category];
  return (
    <Chip color={CATEGORY_COLORS[category]} title={meta.definition}>
      {short ? meta.short : meta.label}
    </Chip>
  );
}

export function SeverityBadge({ severity, short = true }: { severity: Severity; short?: boolean }) {
  const meta = SEVERITY_META[severity];
  return (
    <Chip color={SEVERITY_COLORS[severity]} title={meta.definition}>
      <span className="num">{severity}</span> {short ? meta.short : meta.label}
    </Chip>
  );
}

export function TypeBadge({ type, short = false }: { type: IncidentType; short?: boolean }) {
  const meta = TYPE_META[type];
  return (
    <Chip color={TYPE_COLORS[type]} title={meta.definition}>
      {short ? meta.short : meta.label}
    </Chip>
  );
}
