"use client";

import { useEffect, useRef } from "react";

/**
 * "3h ago" style relative time, written client-side every half minute; the
 * server renders the absolute UTC time, which stays in the tooltip.
 */
export function Ago({ iso, prefix, className }: { iso: string | null; prefix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !iso) return;
    const tick = () => {
      const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
      const rel = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
      el.textContent = prefix ? `${prefix} ${rel}` : rel;
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [iso, prefix]);
  const absolute = iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "never";
  return (
    <span ref={ref} className={className} title={absolute} suppressHydrationWarning>
      {prefix ? `${prefix} ${absolute}` : absolute}
    </span>
  );
}
