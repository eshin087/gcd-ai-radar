"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Adds `data-in` to its wrapper when it scrolls into view; CSS in lab.css
 * animates `.reveal` children from that attribute (and does nothing under
 * prefers-reduced-motion). Content is visible without JS.
 */
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.dataset.armed = "1";
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.style.transitionDelay = `${delay}ms`;
            el.dataset.in = "1";
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return (
    <div ref={ref} className={`reveal ${className}`}>
      {children}
    </div>
  );
}
