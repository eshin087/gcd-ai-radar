"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./useReducedMotion";

interface Props {
  value: number;
  duration?: number;
  className?: string;
  /** Digits after the decimal point. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
}

function fmt(n: number, decimals: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Number that rolls up to its value when it changes. Renders the final value
 * on the server (no-JS and crawlers see real numbers) and animates the DOM
 * text directly, so there are no React re-renders per frame.
 */
export function CountUp({ value, duration = 1100, className, decimals = 0, prefix = "", suffix = "" }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current ?? 0;
    shown.current = value;
    if (prefersReducedMotion() || from === value) {
      el.textContent = `${prefix}${fmt(value, decimals)}${suffix}`;
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(2, -10 * p); // easeOutExpo
      const v = from + (value - from) * (p >= 1 ? 1 : eased);
      el.textContent = `${prefix}${fmt(v, decimals)}${suffix}`;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, decimals, prefix, suffix]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {fmt(value, decimals)}
      {suffix}
    </span>
  );
}
