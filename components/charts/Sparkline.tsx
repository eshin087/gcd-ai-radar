import { UI } from "@/lib/palette";

/**
 * Dependency-free inline SVG sparkline (renders at build time, no Recharts).
 * Used inside stat tiles and OG images.
 */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  color = UI.accent,
  fill = true,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  className?: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const stepX = width / (values.length - 1);
  const pts = values.map((v, i) => [i * stepX, height - (v / max) * (height - 2) - 1] as const);
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${d} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      {fill && <path d={area} fill={color} opacity={0.15} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
