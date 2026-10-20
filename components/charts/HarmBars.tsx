"use client";

import { FAMILY_META, type Family } from "@/lib/families";
import { SEVERITIES, SEVERITY_META, type Severity } from "@/lib/taxonomy";
import type { ChartTheme } from "@/lib/theme";
import { textOn, useBoxWidth } from "./hooks";

interface Props {
  families: Family[];
  counts: Record<Family, Record<Severity, number>>;
  theme: ChartTheme;
  onSegment?: (f: Family, s: Severity) => void;
  onFamily?: (f: Family) => void;
  onSeverity?: (s: Severity) => void;
  active?: { family: Family; severity: Severity } | null;
}

/** The severity scale in plain words, lowest first. */
export const HARM_WORDS: Record<Severity, string> = { 1: "research", 2: "disclosed", 3: "exploited", 4: "real loss" };

/**
 * Two greys for not yet harmful, a coral and a red for harmful: darker grey
 * and deeper red at the outer ends, so the bar reads severity 1 to 4 left to
 * right and the two sides never share a hue.
 */
export const HARM_COLORS: Record<Severity, string> = { 1: "#414a63", 2: "#6e7894", 3: "#f07f4f", 4: "#e8323f" };

/** Left of the centre line, outward: disclosed, then research. Right of it, outward: exploited, then real loss. */
const LEFT: Severity[] = [1, 2];
const RIGHT: Severity[] = [3, 4];

/**
 * A side's scale: the largest bar, unless one bar is more than 2.5 times the
 * next, in which case the scale stops at 1.5 times the next and that bar is
 * drawn cut, with a break mark, so one outlier cannot shrink every other
 * family to slivers.
 */
function sideScale(values: number[]): { extent: number; cap: number | null } {
  const v = values.filter((x) => x > 0).sort((a, b) => b - a);
  if (v.length >= 2 && v[0]! > 2.5 * v[1]!) return { extent: 1.5 * v[1]!, cap: 1.5 * v[1]! };
  return { extent: v[0] ?? 0, cap: null };
}

/**
 * How bad, per family, as diverging bars on one count scale: to the left of
 * the centre line what has not (yet) done harm (research, disclosed), to the
 * right what has (exploited, real loss). Bar length is the count, so volume
 * and harm read together; families run largest first and each row ends with
 * its share that did harm. Every segment opens that family at that severity,
 * the family's count opens the family, the legend's totals each severity.
 */
export function HarmBars({ families, counts, theme, onSegment, onFamily, onSeverity, active = null }: Props) {
  const [ref, width] = useBoxWidth<HTMLDivElement>(320);
  const sum = (f: Family, ss: readonly Severity[]) => ss.reduce((a, s) => a + counts[f][s], 0);
  const total = (f: Family) => sum(f, SEVERITIES);
  const harm = (f: Family) => (total(f) > 0 ? sum(f, RIGHT) / total(f) : 0);
  const rows = families.filter((f) => total(f) > 0).sort((a, b) => total(b) - total(a) || harm(b) - harm(a));
  const colTotal = (s: Severity) => families.reduce((a, f) => a + counts[f][s], 0);

  const left = sideScale(rows.map((f) => sum(f, LEFT)));
  const right = sideScale(rows.map((f) => sum(f, RIGHT)));
  // the centre sits where both sides share one scale; a side with data keeps room for its heading, a side without takes none
  const span = Math.max(1, left.extent + right.extent);
  const minLeft = left.extent > 0 ? Math.min(0.45, 112 / Math.max(1, width)) : 0;
  const minRight = right.extent > 0 ? Math.min(0.45, 84 / Math.max(1, width)) : 0;
  const leftFrac = Math.min(1 - minRight, Math.max(minLeft, left.extent / span));
  const unit = width / Math.max(left.extent > 0 ? left.extent / leftFrac : 0, right.extent > 0 ? right.extent / (1 - leftFrac) : 0, 1);
  const x0 = width * leftFrac;
  const cut = rows.some((f) => (left.cap !== null && sum(f, LEFT) > left.cap) || (right.cap !== null && sum(f, RIGHT) > right.cap));

  /** One side of a row: its two severities, outward from the centre. */
  const side = (f: Family, order: readonly Severity[], scale: { cap: number | null }, dir: "left" | "right", k: number) => {
    const n = sum(f, order);
    if (n === 0) return null;
    const broken = scale.cap !== null && n > scale.cap;
    const len = (broken ? scale.cap! : n) * unit;
    const outward = dir === "left" ? [...order].reverse() : order;
    const segs = outward.filter((s) => counts[f][s] > 0);
    const gaps = (segs.length - 1) * 2;
    return (
      <div
        className="grow-x absolute inset-y-0 flex gap-[2px]"
        style={{
          ...(dir === "left" ? { right: width - x0 + 1 } : { left: x0 + 1 }),
          width: Math.max(len - 1, segs.length * 3 + gaps),
          flexDirection: dir === "left" ? "row-reverse" : "row",
          transformOrigin: dir === "left" ? "right" : "left",
          animationDelay: `${k * 45}ms`,
        }}
      >
        {segs.map((s, j) => {
          const v = counts[f][s];
          const px = ((len - gaps) * v) / n;
          const fits = px >= String(v).length * 6.8 + 8;
          const on = active?.family === f && active.severity === s;
          const color = HARM_COLORS[s];
          const outer = j === segs.length - 1;
          const round = dir === "left" ? (outer ? "rounded-l-[3px]" : "") : outer ? "rounded-r-[3px]" : "";
          return (
            <button
              key={s}
              type="button"
              onClick={() => onSegment?.(f, s)}
              aria-label={`${FAMILY_META[f].label}, severity ${s} (${HARM_WORDS[s]}): ${v} incidents`}
              title={`${FAMILY_META[f].short} · ${HARM_WORDS[s]}: ${v} of ${total(f)}${broken ? " (bar cut to fit, not to scale)" : ""}`}
              className={`num flex min-w-[3px] items-center justify-center text-[11px] font-medium leading-none transition-[filter] hover:brightness-125 ${round} ${on ? "outline outline-2 outline-offset-1 outline-accent" : ""}`}
              style={{ flexGrow: v, flexBasis: 0, background: color, color: textOn(color) }}
            >
              {fits ? v : ""}
            </button>
          );
        })}
        {broken && (
          // the break: a gap cut across the bar near its outer end
          <span aria-hidden className="pointer-events-none absolute -inset-y-[3px] w-[5px] -skew-x-[18deg] border-x border-[color:var(--color-dim)] bg-[#0a0e19]" style={dir === "left" ? { left: Math.min(26, len * 0.18) } : { right: Math.min(26, len * 0.18) }} />
        )}
      </div>
    );
  };

  return (
    <div data-chart="harm-bars" className="space-y-2.5">
      <div className="relative h-4 text-[12px] text-dim" aria-hidden>
        {left.extent > 0 && (
          <span className="absolute top-0 whitespace-nowrap" style={{ right: width - x0 + 8 }}>
            ← not yet harmful
          </span>
        )}
        {right.extent > 0 && (
          <span className="absolute top-0 whitespace-nowrap text-[#ff8f75]" style={{ left: x0 + 8 }}>
            harmful →
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {rows.map((f, k) => {
          const n = total(f);
          return (
            <li key={f} className="flex h-9 flex-col justify-between">
              <div className="flex h-[18px] items-baseline justify-between gap-3 text-[13.5px] leading-[18px]">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="inline-block size-2 shrink-0 self-center rounded-full" style={{ background: theme.families[f] }} />
                  <span className="truncate text-soft" title={FAMILY_META[f].label}>
                    {FAMILY_META[f].short}
                  </span>
                  <button
                    type="button"
                    onClick={() => onFamily?.(f)}
                    aria-label={`${FAMILY_META[f].label}: ${n} incidents`}
                    className="num shrink-0 text-[13.5px] text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 hover:text-accent"
                  >
                    {n.toLocaleString("en-US")}
                  </button>
                </span>
                <span className="shrink-0 text-[12px] text-dim">
                  <span className="num text-[12.5px] text-soft">{Math.round(harm(f) * 100)}%</span> harmful
                </span>
              </div>
              <div ref={k === 0 ? ref : undefined} className="relative h-3.5">
                {/* the centre line, a tick through each bar row */}
                <span aria-hidden className="absolute -inset-y-1 w-px bg-[color:var(--color-dim)] opacity-70" style={{ left: x0 - 0.5 }} />
                {side(f, LEFT, left, "left", k)}
                {side(f, RIGHT, right, "right", k)}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-soft pt-2.5 text-[12px] text-dim">
        {SEVERITIES.map((s) => (
          <button key={s} type="button" onClick={() => onSeverity?.(s)} aria-label={`Severity ${s}: ${colTotal(s)} incidents`} title={`${SEVERITY_META[s].label}: ${SEVERITY_META[s].definition}`} className={`group flex items-center gap-1.5 hover:text-ink ${s === 3 ? "border-l border-line pl-3" : ""}`}>
            <span className="inline-block size-2.5 rounded-[2px]" style={{ background: HARM_COLORS[s] }} />
            {HARM_WORDS[s]}
            <span className="num text-soft underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 group-hover:decoration-[color:var(--color-accent)]">{colTotal(s)}</span>
          </button>
        ))}
        {cut && (
          <span className="ml-auto text-[11.5px] text-dim" title="A bar with a break is cut to fit; its count is on the row.">
            {"// bar cut to fit"}
          </span>
        )}
      </div>
    </div>
  );
}
