import { formatPct } from "@/lib/format";
import type { Briefing } from "@/lib/schema";

type Delta = Briefing["deltas"]["incidents"];

export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");

function Tile({ n, label, note, tone = "text-ink" }: { n: number; label: string; note: string; tone?: string }) {
  return (
    <div className="min-w-0 border-l border-line-soft pl-3">
      <div className={`num text-[26px] font-medium leading-none ${tone}`}>{n}</div>
      <div className="mt-1.5 text-[13px] font-medium text-soft">{label}</div>
      <div className="num mt-0.5 text-[12px] leading-snug text-dim">{note}</div>
    </div>
  );
}

/**
 * The week's four numbers as tiles: incidents and the real-world ones (severity
 * 3 and 4) with their change on the week before, then the two roles AI played.
 * Shared by the briefing front page's lead and the briefing itself.
 */
export function BriefingNumbers({ b, className = "" }: { b: Briefing; className?: string }) {
  const vs = (d: Delta) => `${signed(d.change)} vs the week before${d.pct !== null ? ` (${formatPct(d.pct)})` : ""}`;
  return (
    <div className={`grid grid-cols-2 gap-x-4 gap-y-5 ${className}`}>
      <Tile n={b.counts.incidents} label="incidents" note={vs(b.deltas.incidents)} />
      <Tile n={b.counts.real_world} label="real-world" note={vs(b.deltas.real_world)} tone={b.counts.real_world ? "text-live" : "text-dim"} />
      <Tile n={b.counts.by_type.attack_on_ai} label="attacks on AI" note="AI was the target" />
      <Tile n={b.counts.by_type.ai_enabled_attack} label="using AI" note="AI was the weapon" />
    </div>
  );
}
