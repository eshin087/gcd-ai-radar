"use client";

import { useEffect, useRef, type ElementType } from "react";
import { prefersReducedMotion } from "./useReducedMotion";

const GLYPHS = "▓▒░█<>/\\|=+*#%@$&01ABCDEFGHKMNRSTXZ";

interface Props {
  text: string;
  as?: "span" | "h1" | "h2" | "h3" | "p" | "div";
  className?: string;
  /** ms before the first character settles */
  delay?: number;
  /** ms per character settling */
  speed?: number;
  /** Start when scrolled into view instead of on mount. */
  onView?: boolean;
}

/**
 * Text that decodes from random glyphs into its final characters. Server and
 * no-JS render the final text; the effect rewrites the DOM text per frame.
 */
export function Scramble({ text, as = "span", className, delay = 0, speed = 28, onView = false }: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    let raf = 0;
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      const t0 = performance.now() + delay;
      const chars = [...text];
      const tick = (t: number) => {
        const elapsed = t - t0;
        const settled = Math.max(0, Math.floor(elapsed / speed));
        let out = "";
        for (let i = 0; i < chars.length; i++) {
          const ch = chars[i]!;
          if (i < settled || ch === " ") out += ch;
          else out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
        el.textContent = out;
        if (settled < chars.length) raf = requestAnimationFrame(tick);
        else el.textContent = text;
      };
      raf = requestAnimationFrame(tick);
    };
    if (!onView) {
      run();
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          run();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [text, delay, speed, onView]);

  const Tag = as as ElementType;
  return (
    <Tag ref={ref} className={className} aria-label={text}>
      {text}
    </Tag>
  );
}
