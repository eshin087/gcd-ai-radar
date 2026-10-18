import type { ReactNode } from "react";
import { deltaTone, formatInt, formatPct } from "@/lib/format";

interface StatTileProps {
  label: string;
  value: number | string;
  /** Percentage change vs. the comparison period; null means "new". */
  deltaPct?: number | null;
  compare?: string;
  size?: "sm" | "md" | "lg" | "xl";
  accent?: boolean;
  children?: ReactNode;
  className?: string;
  bare?: boolean;
}

const SIZES = {
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-5xl",
  xl: "text-7xl",
};

export function Delta({ pct, className = "" }: { pct: number | null | undefined; className?: string }) {
  if (pct === undefined) return null;
  const tone = deltaTone(pct);
  const color = tone === "up" ? "text-sev-3" : tone === "down" ? "text-type-by" : "text-dim";
  return <span className={`num text-[12px] ${color} ${className}`}>{formatPct(pct)}</span>;
}

export function StatTile({ label, value, deltaPct, compare, size = "md", accent = false, children, className = "", bare = false }: StatTileProps) {
  return (
    <div className={`${bare ? "" : "panel p-4"} flex flex-col gap-2 ${className}`}>
      <div className="label">{label}</div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className={`num ${SIZES[size]} leading-none tracking-tight ${accent ? "text-accent" : "text-ink"}`}>
          {typeof value === "number" ? formatInt(value) : value}
        </span>
        <Delta pct={deltaPct} />
      </div>
      {compare && <div className="text-[11px] text-dim">{compare}</div>}
      {children}
    </div>
  );
}
