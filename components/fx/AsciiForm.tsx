"use client";

import { Fragment, useEffect, useRef, type ElementType } from "react";
import { prefersReducedMotion } from "./useReducedMotion";

/** Density build-up each character passes through before it lands. */
const RAMP = ["·", ":", "+", "*", "#"];

interface Props {
  text: string;
  as?: "span" | "h1" | "h2" | "h3" | "p" | "div";
  className?: string;
  /** ms before the wave starts */
  delay?: number;
  /** total ms for the whole line */
  duration?: number;
  /** Start when scrolled into view instead of on mount. */
  onView?: boolean;
}

/**
 * Text that forms out of ASCII density glyphs: a quick left-to-right wave
 * where every character climbs · : + * # and lands as itself with a short
 * accent glow. The real characters keep their layout the whole time (the
 * glyphs are drawn over them), so nothing shifts. Runs once; instant under
 * reduced motion. Server HTML carries the final text.
 */
export function AsciiForm({ text, as = "span", className = "", delay = 0, duration = 640, onView = false }: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const finish = () => {
      delete el.dataset.forming;
      delete el.dataset.pending;
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    const cells = Array.from(el.querySelectorAll<HTMLElement>("[data-c]"));
    const n = cells.length || 1;
    const wave = duration * 0.55; // spread of start times across the line
    const climb = duration * 0.45; // time each character spends in the ramp
    const starts = cells.map((_, i) => (i / n) * wave + (((i * 7919) % 13) / 13) * 40);
    const step = new Int8Array(cells.length).fill(-1);
    let raf = 0;
    let started = false;

    const run = () => {
      if (started) return;
      started = true;
      el.dataset.forming = "1";
      delete el.dataset.pending;
      const t0 = performance.now() + delay;
      const tick = (now: number) => {
        const t = now - t0;
        let done = 0;
        for (let i = 0; i < cells.length; i++) {
          const local = (t - starts[i]!) / climb;
          const s = local < 0 ? -1 : local >= 1 ? RAMP.length : Math.floor(local * RAMP.length);
          if (s === step[i]) {
            if (s === RAMP.length) done++;
            continue;
          }
          step[i] = s;
          const cell = cells[i]!;
          if (s >= RAMP.length) {
            delete cell.dataset.g;
            cell.dataset.done = "1";
            done++;
          } else if (s >= 0) cell.dataset.g = RAMP[s]!;
        }
        if (done < cells.length) raf = requestAnimationFrame(tick);
        else {
          finish();
          for (const cell of cells) delete cell.dataset.done;
        }
      };
      raf = requestAnimationFrame(tick);
    };

    const reset = () => {
      cancelAnimationFrame(raf);
      finish();
      for (const cell of cells) {
        delete cell.dataset.g;
        delete cell.dataset.done;
      }
    };
    if (!onView) {
      run();
      return reset;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          run();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      reset();
    };
  }, [text, delay, duration, onView]);

  const Tag = as as ElementType;
  const words = text.split(" ");
  return (
    // data-pending hides the characters from first paint (html.js only, see lab.css) until the wave runs
    <Tag ref={ref} className={`ascii-form ${className}`} aria-label={text} data-pending="1">
      {words.map((w, wi) => (
        <Fragment key={wi}>
          {wi > 0 && " "}
          <span aria-hidden className="whitespace-nowrap">
            {[...w].map((ch, ci) => (
              <span key={ci} data-c="">
                {ch}
              </span>
            ))}
          </span>
        </Fragment>
      ))}
    </Tag>
  );
}
