"use client";

import { useMemo, useState } from "react";
import { useReducedMotion } from "@/components/fx/useReducedMotion";
import { FAMILY_META, type Family } from "@/lib/families";
import {
  TARGET_META,
  TYPE_META,
  type IncidentType,
  type Target,
} from "@/lib/taxonomy";
import type { ChartTheme } from "@/lib/theme";
import { useShown, useWidth } from "./hooks";
import { ribbonPath } from "./path";

interface Props {
  types: { key: IncidentType; count: number }[];
  families: { key: Family; count: number }[];
  targets: { key: Target; count: number }[];
  typeFam: Record<IncidentType, Record<Family, number>>;
  famTarget: Record<Family, Partial<Record<Target, number>>>;
  theme: ChartTheme;
  onType?: (t: IncidentType) => void;
  onFamily?: (f: Family) => void;
  onTarget?: (t: Target) => void;
  onTypeFamily?: (t: IncidentType, f: Family) => void;
  onFamilyTarget?: (f: Family, t: Target) => void;
  label: string;
}

const LABEL_W = 150;
const NODE_W = 10;
const GAP = 7;
const PAD = { t: 8, b: 8 };
const LABEL_GAP = 15;

/** Pushes label centres apart so no two overlap, keeping them inside [top, bottom]. */
function spread(ys: number[], top: number, bottom: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++)
    if (order[k]!.y < order[k - 1]!.y + LABEL_GAP)
      order[k]!.y = order[k - 1]!.y + LABEL_GAP;
  const over = (order[order.length - 1]?.y ?? 0) - bottom;
  if (over > 0) for (const o of order) o.y -= over;
  for (let k = 0; k < order.length; k++)
    if (order[k]!.y < top) order[k]!.y = top + k * LABEL_GAP;
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

interface Node<K extends string> {
  key: K;
  count: number;
  y0: number;
  y1: number;
}

interface Ribbon {
  id: string;
  d: string;
  color: string;
  value: number;
  title: string;
  onClick?: () => void;
}

/** Stacks nodes down a column so the column fills the height, each node's height its share of the column's total. */
function stack<K extends string>(
  items: { key: K; count: number }[],
  height: number,
): Node<K>[] {
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  const free = height - PAD.t - PAD.b - GAP * Math.max(0, items.length - 1);
  let y = PAD.t;
  return items.map((i) => {
    const h = (i.count / total) * free;
    const node = { key: i.key, count: i.count, y0: y, y1: y + h };
    y += h + GAP;
    return node;
  });
}

/**
 * The flow of incidents: attacks on AI or by AI, into their family, onto the
 * targets they hit, as ribbons whose width is their count. Each column is
 * scaled to its own total: the right column counts target mentions, since
 * an incident can name several targets. Every node and ribbon opens its
 * incidents. Ribbons fade in when the chart scrolls into view.
 */
export function FlowSankey({
  types,
  families,
  targets,
  typeFam,
  famTarget,
  theme,
  onType,
  onFamily,
  onTarget,
  onTypeFamily,
  onFamilyTarget,
  label,
}: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(760);
  const shown = useShown(ref, 0.2);
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const labelW = LABEL_W;
  const height = Math.max(
    360,
    (LABEL_GAP + 4) * Math.max(targets.length, families.length) +
      PAD.t +
      PAD.b +
      40,
  );
  const xL = labelW;
  const xM = width / 2 - NODE_W / 2;
  const xR = width - labelW - NODE_W;

  const { L, M, R, ribbons } = useMemo(() => {
    const L = stack(types, height);
    const M = stack(families, height);
    const R = stack(targets, height);
    const ribbons: Ribbon[] = [];
    // type -> family: left offsets walk down each type node, right offsets down each family node
    const lOff = new Map<string, number>(L.map((n) => [n.key, n.y0]));
    const mIn = new Map<string, number>(M.map((n) => [n.key, n.y0]));
    const mOut = new Map<string, number>(M.map((n) => [n.key, n.y0]));
    const rOff = new Map<string, number>(R.map((n) => [n.key, n.y0]));
    const scaleL = (n: Node<string>) => (n.y1 - n.y0) / Math.max(1, n.count);
    for (const t of L) {
      for (const f of M) {
        const v = typeFam[t.key][f.key];
        if (!v) continue;
        const a0 = lOff.get(t.key)!;
        const a1 = a0 + v * scaleL(t);
        const b0 = mIn.get(f.key)!;
        const b1 = b0 + v * scaleL(f);
        lOff.set(t.key, a1);
        mIn.set(f.key, b1);
        ribbons.push({
          id: `tf-${t.key}-${f.key}`,
          d: ribbonPath(xL + NODE_W, a0, a1, xM, b0, b1),
          color: theme.families[f.key],
          value: v,
          title: `${TYPE_META[t.key].label} → ${FAMILY_META[f.key].label}: ${v}`,
          onClick: onTypeFamily ? () => onTypeFamily(t.key, f.key) : undefined,
        });
      }
    }
    for (const f of M) {
      for (const tg of R) {
        const v = famTarget[f.key][tg.key] ?? 0;
        if (!v) continue;
        const a0 = mOut.get(f.key)!;
        const a1 =
          a0 +
          v *
            ((f.y1 - f.y0) /
              Math.max(
                1,
                targets.reduce((s, x) => s + (famTarget[f.key][x.key] ?? 0), 0),
              ));
        const b0 = rOff.get(tg.key)!;
        const b1 = b0 + v * scaleL(tg);
        mOut.set(f.key, a1);
        rOff.set(tg.key, b1);
        ribbons.push({
          id: `ft-${f.key}-${tg.key}`,
          d: ribbonPath(xM + NODE_W, a0, a1, xR, b0, b1),
          color: theme.families[f.key],
          value: v,
          title: `${FAMILY_META[f.key].label} → ${TARGET_META[tg.key].label}: ${v}`,
          onClick: onFamilyTarget
            ? () => onFamilyTarget(f.key, tg.key)
            : undefined,
        });
      }
    }
    return { L, M, R, ribbons };
  }, [
    types,
    families,
    targets,
    typeFam,
    famTarget,
    height,
    xL,
    xM,
    xR,
    theme,
    onTypeFamily,
    onFamilyTarget,
  ]);

  const mid = (n: Node<string>) => (n.y0 + n.y1) / 2;
  const lY = spread(L.map(mid), PAD.t + 6, height - PAD.b - 6);
  const mY = spread(M.map(mid), PAD.t + 6, height - PAD.b - 6);
  const rY = spread(R.map(mid), PAD.t + 6, height - PAD.b - 6);
  const litKey = hover;
  const related = (id: string) => {
    if (!litKey) return true;
    if (litKey === id) return true;
    // a hovered node lights every ribbon touching it
    if (litKey.startsWith("node-")) return id.includes(litKey.slice(5));
    return false;
  };
  const on = shown || reduced;

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div
        ref={ref}
        className="relative min-w-[640px] select-none"
        style={{ height }}
      >
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          className="absolute inset-0 block overflow-visible"
        >
          <g
            style={{
              opacity: on ? 1 : 0,
              transition: reduced ? "none" : "opacity 900ms 200ms",
            }}
          >
            {ribbons.map((r) => (
              <path
                key={r.id}
                d={r.d}
                fill={r.color}
                fillOpacity={
                  related(r.id)
                    ? litKey === r.id
                      ? 0.78
                      : litKey
                        ? 0.5
                        : 0.36
                    : 0.08
                }
                className={r.onClick ? "cursor-pointer" : undefined}
                style={{ transition: "fill-opacity 160ms" }}
                onMouseEnter={() => setHover(r.id)}
                onMouseLeave={() => setHover(null)}
                onClick={r.onClick}
              >
                <title>{r.title}</title>
              </path>
            ))}
          </g>
          {L.map((n) => (
            <rect
              key={n.key}
              x={xL}
              y={n.y0}
              width={NODE_W}
              height={Math.max(1, n.y1 - n.y0)}
              rx={2}
              fill={theme.types[n.key]}
              onMouseEnter={() => setHover(`node--${n.key}-`)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
          {M.map((n) => (
            <rect
              key={n.key}
              x={xM}
              y={n.y0}
              width={NODE_W}
              height={Math.max(1, n.y1 - n.y0)}
              rx={2}
              fill={theme.families[n.key]}
              onMouseEnter={() => setHover(`node--${n.key}-`)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
          {R.map((n) => (
            <rect
              key={n.key}
              x={xR}
              y={n.y0}
              width={NODE_W}
              height={Math.max(1, n.y1 - n.y0)}
              rx={2}
              fill={theme.bar}
              onMouseEnter={() => setHover(`node--${n.key}`)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        {/* labels as real buttons, positioned beside their nodes */}
        {L.map((n, i) => (
          <button
            key={n.key}
            type="button"
            onClick={() => onType?.(n.key)}
            aria-label={`${TYPE_META[n.key].label}: ${n.count} incidents`}
            className="group absolute -translate-y-1/2 text-right text-[12px] leading-tight text-soft hover:text-ink"
            style={{ left: 0, width: labelW - 10, top: lY[i] }}
          >
            {TYPE_META[n.key].label}
            <span className="num ml-1.5 text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 group-hover:decoration-[color:var(--color-accent)]">
              {n.count}
            </span>
          </button>
        ))}
        {M.map((n, i) => (
          <button
            key={n.key}
            type="button"
            onClick={() => onFamily?.(n.key)}
            aria-label={`${FAMILY_META[n.key].label}: ${n.count} incidents`}
            className="group absolute -translate-y-1/2 whitespace-nowrap rounded-[3px] px-1.5 py-0.5 text-[11.5px] leading-tight text-soft hover:text-ink"
            style={{
              left: xM + NODE_W + 6,
              top: mY[i],
              background:
                "color-mix(in oklab, var(--color-panel) 80%, transparent)",
            }}
          >
            {FAMILY_META[n.key].short}
            <span className="num ml-1.5 text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 group-hover:decoration-[color:var(--color-accent)]">
              {n.count}
            </span>
          </button>
        ))}
        {R.map((n, i) => (
          <button
            key={n.key}
            type="button"
            onClick={() => onTarget?.(n.key)}
            aria-label={`${TARGET_META[n.key].label}: ${n.count} incidents`}
            className="group absolute -translate-y-1/2 truncate text-left text-[12px] leading-tight text-soft hover:text-ink"
            style={{ left: xR + NODE_W + 10, width: labelW - 10, top: rY[i] }}
          >
            <span className="num text-ink underline decoration-dotted decoration-[color:var(--color-faint)] underline-offset-4 group-hover:decoration-[color:var(--color-accent)]">
              {n.count}
            </span>
            <span className="ml-1.5">{TARGET_META[n.key].label}</span>
          </button>
        ))}
        {hover && !hover.startsWith("node-") && (
          <div className="pointer-events-none absolute left-1/2 top-1 z-10 -translate-x-1/2 rounded-[4px] border border-line bg-panel/95 px-2.5 py-1.5 text-[12px] text-ink shadow-xl backdrop-blur">
            {ribbons.find((r) => r.id === hover)?.title}
            <span className="ml-2 text-[11px] text-faint">
              click for the incidents
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
