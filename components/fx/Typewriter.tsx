"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./useReducedMotion";

export interface TypeLine {
  text: string;
  /** CSS class for the line (e.g. a dim prompt or an ok marker). */
  className?: string;
  /** ms to wait before typing this line */
  pause?: number;
}

/**
 * Terminal boot log: types its lines once per browser session (sessionStorage
 * key), instantly afterwards and under reduced motion. Full text is in the
 * server HTML; the effect blanks and retypes it.
 */
export function Typewriter({ lines, storageKey, cps = 90, className = "" }: { lines: TypeLine[]; storageKey: string; cps?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem(storageKey) === "1";
    } catch {
      // storage unavailable: just type it
    }
    if (seen || prefersReducedMotion()) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-line]"));
    const texts = els.map((el) => el.dataset.line ?? "");
    for (const el of els) el.textContent = "";
    root.dataset.typing = "1";
    let raf = 0;
    let i = 0;
    let ch = 0;
    let wait = performance.now() + (lines[0]?.pause ?? 200);
    let last = performance.now();
    const tick = (t: number) => {
      if (i >= els.length) {
        delete root.dataset.typing;
        // mark as seen only once the log has fully typed
        try {
          sessionStorage.setItem(storageKey, "1");
        } catch {
          // ignore
        }
        return;
      }
      if (t < wait) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const budget = Math.max(1, Math.floor(((t - last) / 1000) * cps));
      last = t;
      const text = texts[i]!;
      ch = Math.min(text.length, ch + budget);
      els[i]!.textContent = text.slice(0, ch);
      if (ch >= text.length) {
        i += 1;
        ch = 0;
        wait = t + (lines[i]?.pause ?? 120);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      // interrupted (re-render, unmount, dev double-run): restore the full text
      cancelAnimationFrame(raf);
      els.forEach((el, k) => (el.textContent = texts[k] ?? ""));
      delete root.dataset.typing;
    };
  }, [lines, storageKey, cps]);

  return (
    <div ref={ref} className={className}>
      {lines.map((l, i) => (
        <div key={i} className={l.className} data-line={l.text}>
          {l.text}
        </div>
      ))}
    </div>
  );
}
