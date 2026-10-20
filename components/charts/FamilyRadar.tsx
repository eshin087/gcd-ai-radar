"use client";

import { useState } from "react";
import { useReducedMotion } from "@/components/fx/useReducedMotion";
import { FAMILY_META, type Family } from "@/lib/families";
import type { ChartTheme } from "@/lib/theme";
import { useShown, useTextWidth, useWidth } from "./hooks";

interface Props {
  families: Family[];
  now: Record<Family, number>;
  /** Null when the window has no equal-length window before it. */
  prior: Record<Family, number> | null;
  theme: ChartTheme;
  nowLabel: string;
  priorLabel?: string;
  /** Largest dial radius; the dial shrinks to fit its labels in the panel. */
  maxRadius?: number;
  onNow?: (f: Family) => void;
  onPrior?: (f: Family) => void;
  active?: Family | null;
  label: string;
}

const TAU = Math.PI * 2;
/** Gap between the rim and a label, the panel's inner margin, and a label's rows (name, its second line, count). */
const GAP = 14;
const EDGE = 4;
const ROW1 = 17;
const ROW1B = 16;
const ROW2 = 20;
/** Guide rings at a quarter, half, three quarters and all of the radius, outermost first; unlabelled, they give the eye a scale. */
const RINGS = [1, 0.75, 0.5, 0.25];
/** The scope's bands, outside in: light, dark, light, dark, so the rings read as a radar screen. */
const BAND = ["rgba(140,160,210,0.075)", "rgba(5,7,13,0.55)", "rgba(140,160,210,0.07)", "rgba(5,7,13,0.55)"];

/** A long family name on two lines (after its "/" or first space), so the labels stay narrow and the dial can grow. */
function nameLines(name: string): [string, string | null] {
  if (name.length <= 10) return [name, null];
  const slash = name.indexOf("/");
  if (slash > 0) return [name.slice(0, slash + 1), name.slice(slash + 1)];
  const space = name.indexOf(" ");
  return space > 0 ? [name.slice(0, space), name.slice(space + 1)] : [name, null];
}

type AnchorX = "start" | "middle" | "end";
type AnchorY = "above" | "center" | "below";

interface LabelBox {
  f: Family;
  a: number;
  ax: AnchorX;
  ay: AnchorY;
  w: number;
  h: number;
}

/** A label's box relative to the dial's centre at radius R: it sits outside the rim, on the side its axis points to. */
function boxAt(b: LabelBox, R: number): { x0: number; x1: number; y0: number; y1: number } {
  const px = Math.cos(b.a) * (R + GAP);
  const py = Math.sin(b.a) * (R + GAP);
  const x0 = b.ax === "start" ? px : b.ax === "end" ? px - b.w : px - b.w / 2;
  const y0 = b.ay === "below" ? py : b.ay === "above" ? py - b.h : py - b.h / 2;
  return { x0, x1: x0 + b.w, y0, y1: y0 + b.h };
}

/** The bounding box of the dial and all its labels at radius R. */
function extent(boxes: LabelBox[], R: number) {
  let x0 = -R,
    x1 = R,
    y0 = -R,
    y1 = R;
  for (const b of boxes) {
    const e = boxAt(b, R);
    x0 = Math.min(x0, e.x0);
    x1 = Math.max(x1, e.x1);
    y0 = Math.min(y0, e.y0);
    y1 = Math.max(y1, e.y1);
  }
  return { x0, x1, y0, y1 };
}

/**
 * A literal radar: one axis per family, the first straight up, the window's
 * counts as a filled polygon and the previous window's as a thin dashed one.
 * The radius is the square root of the count, so one dominant family does
 * not flatten the others into a spike. The grid is four unlabelled rings
 * in alternating bands, like a radar screen; each family's name (on two lines
 * when long) and count sit outside the rim, anchored by their angle, and the
 * dial takes the largest radius at which every label fits in the panel. Labels, vertices and the earlier window's vertices open their
 * incidents. On arrival a beam sweeps the dial once and the polygon draws in
 * behind it.
 */
export function FamilyRadar({ families, now, prior, theme, nowLabel, priorLabel, maxRadius = 190, onNow, onPrior, active = null, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(360);
  const shown = useShown(ref, 0.3);
  const reduced = useReducedMotion();
  const measure = useTextWidth();
  const [hot, setHot] = useState<Family | null>(null);
  const on = shown || reduced;
  const n = Math.max(3, families.length);
  const max = Math.max(1, ...families.map((f) => Math.max(now[f], prior?.[f] ?? 0)));

  // labels at the axes' angles, first axis straight up; the dial takes the largest radius that fits them
  const offset = 0;
  const boxes: LabelBox[] = families.map((f, i) => {
    const a = -Math.PI / 2 + (i / n) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const [l1, l2] = nameLines(FAMILY_META[f].short);
    const w = Math.max(7 + 6 + measure(l1, 12.5), l2 ? 13 + measure(l2, 12.5) : 0, measure(now[f].toLocaleString("en-US"), 13.5, { mono: true })) + 4;
    return { f, a, ax: c > 0.28 ? "start" : c < -0.28 ? "end" : "middle", ay: s < -0.35 ? "above" : s > 0.35 ? "below" : "center", w, h: ROW1 + (l2 ? ROW1B : 0) + ROW2 };
  });
  const fits = (r: number) => {
    const ext = extent(boxes, r);
    return ext.x1 - ext.x0 <= width - EDGE * 2;
  };
  let lo = 40;
  let hi = maxRadius;
  if (!fits(lo)) hi = lo;
  for (let k = 0; k < 18 && hi - lo > 0.5; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const R = Math.floor(lo);
  const e = extent(boxes, R);
  const cx = EDGE - e.x0 + (width - EDGE * 2 - (e.x1 - e.x0)) / 2;
  const cy = EDGE - e.y0;
  const height = Math.ceil(e.y1 - e.y0 + EDGE * 2);

  const angle = (i: number) => -Math.PI / 2 + offset + (i / n) * TAU;
  const at = (i: number, v: number): [number, number] => {
    const r = R * Math.sqrt(Math.max(0, v) / max);
    return [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];
  };
  const ring = (k: number) => families.map((_, i) => [cx + Math.cos(angle(i)) * R * k, cy + Math.sin(angle(i)) * R * k].map((v) => v.toFixed(1)).join(",")).join(" ");
  const poly = (vals: number[]) => vals.map((v, i) => at(i, v).map((k) => k.toFixed(1)).join(",")).join(" ");
  const lit = hot ?? active;

  return (
    <div ref={ref} data-chart="radar" className="relative w-full select-none" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
        {RINGS.map((k, i) => (
          <polygon key={k} points={ring(k)} fill={BAND[i]} stroke="rgb(150,170,220)" strokeOpacity={k === 1 ? 0.5 : 0.3} strokeWidth={k === 1 ? 1.25 : 1} />
        ))}
        {families.map((f, i) => {
          const [x, y] = [cx + Math.cos(angle(i)) * R, cy + Math.sin(angle(i)) * R];
          return <line key={f} x1={cx} y1={cy} x2={x} y2={y} stroke={lit === f ? theme.families[f] : "rgb(150,170,220)"} strokeOpacity={lit === f ? 0.85 : 0.28} />;
        })}
        <circle cx={cx} cy={cy} r={2} fill="rgb(150,170,220)" fillOpacity={0.6} />
        {/* the sweep: one turn on arrival, then gone */}
        {!reduced && (
          <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: shown ? "radar-sweep 1.8s cubic-bezier(.4,0,.2,1) both" : "none", opacity: shown ? undefined : 0 }}>
            <path d={`M${cx},${cy}L${cx},${cy - R}A${R},${R} 0 0 1 ${(cx + R * Math.sin(0.6)).toFixed(1)},${(cy - R * Math.cos(0.6)).toFixed(1)}Z`} fill={theme.accent} fillOpacity={0.16} />
            <line x1={cx} y1={cy} x2={cx} y2={cy - R} stroke={theme.accent} strokeWidth={1.5} />
          </g>
        )}
        {prior && (
          <polygon points={poly(families.map((f) => prior[f]))} fill="none" stroke={theme.ink} strokeOpacity={0.6} strokeWidth={1.1} strokeDasharray="3 3" opacity={on ? 1 : 0} style={{ transition: reduced ? "none" : "opacity 600ms 1200ms" }} />
        )}
        <polygon
          points={poly(families.map((f) => now[f]))}
          fill={theme.accent}
          fillOpacity={on ? 0.2 : 0}
          stroke={theme.accent}
          strokeWidth={2}
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={on ? 0 : 1}
          style={{ transition: reduced ? "none" : "stroke-dashoffset 1700ms cubic-bezier(.4,0,.2,1) 150ms, fill-opacity 500ms 1400ms" }}
        />
        {prior &&
          families.map((f, i) => {
            const [x, y] = at(i, prior[f]);
            return (
              <g key={`p-${f}`}>
                <circle cx={x} cy={y} r={2.25} fill={theme.ink} fillOpacity={0.7} pointerEvents="none" />
                <circle cx={x} cy={y} r={8} fill="transparent" className={onPrior ? "cursor-pointer" : undefined} onClick={() => onPrior?.(f)}>
                  <title>{`${FAMILY_META[f].label} · ${priorLabel}: ${prior[f]}`}</title>
                </circle>
              </g>
            );
          })}
        {families.map((f, i) => {
          const [x, y] = at(i, now[f]);
          return (
            <circle
              key={f}
              cx={x}
              cy={y}
              r={lit === f ? 5.5 : 4}
              fill={theme.families[f]}
              stroke={theme.surface}
              strokeWidth={1.5}
              className={onNow ? "cursor-pointer" : undefined}
              onClick={() => onNow?.(f)}
              onMouseEnter={() => setHot(f)}
              onMouseLeave={() => setHot(null)}
              style={{ opacity: on ? 1 : 0, transition: reduced ? "none" : "opacity 400ms 1500ms, r 150ms" }}
            >
              <title>{`${FAMILY_META[f].label} · ${nowLabel}: ${now[f]}`}</title>
            </circle>
          );
        })}
      </svg>
      {boxes.map((b) => {
        const box = boxAt(b, R);
        const align = b.ax === "start" ? "items-start text-left" : b.ax === "end" ? "items-end text-right" : "items-center text-center";
        const [l1, l2] = nameLines(FAMILY_META[b.f].short);
        return (
          <button
            key={b.f}
            type="button"
            onClick={() => onNow?.(b.f)}
            onMouseEnter={() => setHot(b.f)}
            onMouseLeave={() => setHot(null)}
            onFocus={() => setHot(b.f)}
            onBlur={() => setHot(null)}
            aria-label={`${FAMILY_META[b.f].label}: ${now[b.f]} incidents`}
            title={FAMILY_META[b.f].label}
            className={`group absolute flex flex-col whitespace-nowrap ${align}`}
            style={{ left: cx + box.x0, top: cy + box.y0, width: b.w, height: b.h }}
          >
            <span className={`flex h-[17px] items-center gap-1.5 text-[12.5px] leading-none ${lit === b.f ? "text-ink" : "text-soft"} group-hover:text-ink`}>
              <span className="inline-block size-[7px] shrink-0 rounded-full" style={{ background: theme.families[b.f], boxShadow: `0 0 6px ${theme.families[b.f]}` }} />
              {l1}
            </span>
            {l2 && <span className={`block h-[16px] text-[12.5px] leading-none ${b.ax === "start" ? "pl-[13px]" : ""} ${lit === b.f ? "text-ink" : "text-soft"} group-hover:text-ink`}>{l2}</span>}
            <span className={`num block h-[20px] pt-1 text-[13.5px] leading-none underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 group-hover:decoration-[color:var(--color-accent)] ${active === b.f ? "text-accent" : "text-ink"}`}>{now[b.f].toLocaleString("en-US")}</span>
          </button>
        );
      })}
    </div>
  );
}
