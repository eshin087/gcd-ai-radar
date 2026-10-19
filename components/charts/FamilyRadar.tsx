"use client";

import { useReducedMotion } from "@/components/fx/useReducedMotion";
import { FAMILY_META, type Family } from "@/lib/families";
import type { ChartTheme } from "@/lib/theme";
import { useShown, useWidth } from "./hooks";

interface Props {
  families: Family[];
  now: Record<Family, number>;
  /** Null when the window has no equal-length window before it. */
  prior: Record<Family, number> | null;
  theme: ChartTheme;
  nowLabel: string;
  priorLabel?: string;
  /** Largest dial size; it shrinks to the panel. */
  size?: number;
  onNow?: (f: Family) => void;
  onPrior?: (f: Family) => void;
  active?: Family | null;
  label: string;
}

const TAU = Math.PI * 2;

/**
 * A literal radar: one axis per family, the window's counts as a filled
 * polygon and the previous window's as a dashed one, so the shape of the
 * threat and how it moved read at a glance. Axis labels and vertices open
 * their incidents. On arrival a beam sweeps the dial once and the polygon
 * draws in behind it.
 */
export function FamilyRadar({ families, now, prior, theme, nowLabel, priorLabel, size: maxSize = 360, onNow, onPrior, active = null, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(maxSize);
  const shown = useShown(ref, 0.3);
  const reduced = useReducedMotion();
  const on = shown || reduced;
  const size = Math.max(240, Math.min(maxSize, width));
  const c = size / 2;
  const R = c - 66;
  const n = Math.max(3, families.length);
  const max = Math.max(1, ...families.map((f) => Math.max(now[f], prior?.[f] ?? 0)));
  const angle = (i: number) => -Math.PI / 2 + (i / n) * TAU;
  const at = (i: number, v: number): [number, number] => [c + Math.cos(angle(i)) * R * (v / max), c + Math.sin(angle(i)) * R * (v / max)];
  const poly = (vals: number[]) => vals.map((v, i) => at(i, v).map((k) => k.toFixed(1)).join(",")).join(" ");
  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <div ref={ref} className="relative mx-auto w-full select-none" style={{ height: size, maxWidth: maxSize }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="mx-auto block overflow-visible">
        {rings.map((k) => (
          <polygon key={k} points={poly(families.map(() => max * k))} fill="none" stroke={theme.grid} strokeDasharray={k === 1 ? undefined : "2 4"} />
        ))}
        {families.map((_, i) => {
          const [x, y] = at(i, max);
          return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke={theme.grid} />;
        })}
        {rings.map((k) => (
          <text key={k} x={c + 4} y={c - R * k + 3} fontSize={9.5} fill={theme.dim} className="num">
            {Math.round(max * k)}
          </text>
        ))}
        {/* the sweep: one turn on arrival, then gone */}
        {!reduced && (
          <g style={{ transformOrigin: `${c}px ${c}px`, animation: shown ? "radar-sweep 1.8s cubic-bezier(.4,0,.2,1) both" : "none", opacity: shown ? undefined : 0 }}>
            <path d={`M${c},${c}L${c},${c - R}A${R},${R} 0 0 1 ${(c + R * Math.sin(0.6)).toFixed(1)},${(c - R * Math.cos(0.6)).toFixed(1)}Z`} fill={theme.accent} fillOpacity={0.16} />
            <line x1={c} y1={c} x2={c} y2={c - R} stroke={theme.accent} strokeWidth={1.5} />
          </g>
        )}
        {prior && (
          <polygon points={poly(families.map((f) => prior[f]))} fill="none" stroke={theme.dim} strokeWidth={1.2} strokeDasharray="4 3" opacity={on ? 0.9 : 0} style={{ transition: reduced ? "none" : "opacity 600ms 1200ms" }} />
        )}
        <polygon
          points={poly(families.map((f) => now[f]))}
          fill={theme.accent}
          fillOpacity={on ? 0.16 : 0}
          stroke={theme.accent}
          strokeWidth={1.8}
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
              <circle key={`p-${f}`} cx={x} cy={y} r={7} fill="transparent" stroke="none" className={onPrior ? "cursor-pointer" : undefined} onClick={() => onPrior?.(f)}>
                <title>{`${FAMILY_META[f].label} · ${priorLabel}: ${prior[f]}`}</title>
              </circle>
            );
          })}
        {prior &&
          families.map((f, i) => {
            const [x, y] = at(i, prior[f]);
            return <circle key={`pd-${f}`} cx={x} cy={y} r={2.5} fill={theme.dim} pointerEvents="none" />;
          })}
        {families.map((f, i) => {
          const [x, y] = at(i, now[f]);
          return (
            <circle key={f} cx={x} cy={y} r={active === f ? 6 : 4.5} fill={theme.families[f]} stroke={theme.surface} strokeWidth={1.5} className={onNow ? "cursor-pointer" : undefined} onClick={() => onNow?.(f)} style={{ opacity: on ? 1 : 0, transition: "opacity 400ms 1500ms" }}>
              <title>{`${FAMILY_META[f].label} · ${nowLabel}: ${now[f]}`}</title>
            </circle>
          );
        })}
      </svg>
      {families.map((f, i) => {
        const a = angle(i);
        const ox = Math.max(0, (Math.min(width, maxSize) - size) / 2); // the dial is centred in the panel
        const [x, y] = [ox + c + Math.cos(a) * (R + 30), c + Math.sin(a) * (R + 30)];
        const right = Math.cos(a) > 0.2;
        const left = Math.cos(a) < -0.2;
        return (
          <button
            key={f}
            type="button"
            onClick={() => onNow?.(f)}
            aria-label={`${FAMILY_META[f].label}: ${now[f]} incidents`}
            className={`absolute -translate-y-1/2 whitespace-nowrap text-[11px] leading-tight hover:text-ink ${active === f ? "text-accent" : "text-dim"} ${right ? "text-left" : left ? "-translate-x-full text-right" : "-translate-x-1/2 text-center"}`}
            style={{ left: x, top: y }}
          >
            <span className="flex items-center gap-1" style={{ justifyContent: right ? "flex-start" : left ? "flex-end" : "center" }}>
              <span className="inline-block size-1.5 rounded-full" style={{ background: theme.families[f] }} />
              {FAMILY_META[f].short}
            </span>
            <span className="num block text-[12px] text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4">{now[f]}</span>
          </button>
        );
      })}
    </div>
  );
}
