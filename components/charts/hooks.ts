"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** The element's current width, tracked with a ResizeObserver. */
export function useWidth<T extends HTMLElement>(initial = 640): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** True once the element has scrolled into view; stays true. Drives the one-time draw-in of a chart. */
export function useShown(ref: RefObject<HTMLElement | null>, threshold = 0.25): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);
  return shown;
}

/** Sequential fill for a count on the dark surface: the accent mixed into the panel, square-root scaled so small counts stay visible. */
export function heat(count: number, max: number): { background: string; color: string } {
  if (count <= 0) return { background: "color-mix(in oklab, var(--color-panel-2) 60%, transparent)", color: "var(--color-faint)" };
  const pct = Math.round(10 + 90 * Math.sqrt(count / Math.max(1, max)));
  return { background: `color-mix(in oklab, var(--color-accent) ${pct}%, var(--color-panel-2))`, color: pct > 55 ? "var(--color-ground)" : "var(--color-ink)" };
}

/** A round step (1, 2, 2.5, 5 × a power of ten) at least as large as `raw`. */
export function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
