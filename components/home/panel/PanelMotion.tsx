"use client";

import { useEffect } from "react";
import { BAR_GAP_MS, BUILD_EVENT, BUILD_GLYPHS, CELL_GAP_MS, CELL_STEP_MS, UNIT_GAP_MS, UNIT_ROW_GAP_MS, UNIT_STEP_MS, motionOn, type BuildDetail } from "@/components/fx/ascii";

/**
 * The panel's director, mounted once on the home page. Each instrument
 * (`[data-build]`) builds once, when its top passes 85% of the viewport: its
 * cells and unit squares assemble through · : + left to right, then it fires
 * BUILD_EVENT so its numbers (Num), the newest wire row (TypeIn), the AI flow's
 * ribbons and the sieve's rain start. Without html.motion every instrument
 * builds at once, final and still. It also runs the pulse: html.pulse-0..3
 * once a second, which the red items' ::before glyph follows (globals.css).
 */

declare global {
  interface Window {
    __panelMotion?: boolean;
  }
}

export function PanelMotion() {
  useEffect(() => {
    window.__panelMotion = true;
    const root = document.documentElement;
    const motion = motionOn();
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    const assemble = (marks: HTMLElement[], stepMs: number, gapMs: number, rowGapMs: number) => {
      marks.forEach((mark, j) => {
        [...mark.children].forEach((cell, n) => {
          const t = j * rowGapMs + n * gapMs;
          BUILD_GLYPHS.forEach((g, k) => later(() => (cell.textContent = g), t + k * stepMs));
          later(() => {
            cell.textContent = "";
            cell.classList.remove("b");
          }, t + BUILD_GLYPHS.length * stepMs);
        });
      });
    };

    const build = (sec: HTMLElement, instant: boolean) => {
      if (sec.dataset.built) return;
      const cells = [...sec.querySelectorAll<HTMLElement>(".ascii-cells")];
      const units = [...sec.querySelectorAll<HTMLElement>(".ascii-units")];
      if (!instant) for (const m of [...cells, ...units]) for (const c of m.children) c.classList.add("b");
      sec.dataset.built = "1";
      if (!instant) {
        assemble(cells, CELL_STEP_MS, CELL_GAP_MS, BAR_GAP_MS);
        assemble(units, UNIT_STEP_MS, UNIT_GAP_MS, UNIT_ROW_GAP_MS);
      }
      sec.dispatchEvent(new CustomEvent<BuildDetail>(BUILD_EVENT, { detail: { instant } }));
    };

    const sections = [...document.querySelectorAll<HTMLElement>("[data-build]")];
    let io: IntersectionObserver | null = null;
    if (!motion || !("IntersectionObserver" in window)) {
      sections.forEach((s) => build(s, true));
    } else {
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            build(e.target as HTMLElement, false);
            io?.unobserve(e.target);
          }
        },
        { rootMargin: "0px 0px -15% 0px" },
      );
      sections.forEach((s) => io!.observe(s));
    }

    let pulse = 2;
    root.classList.add(`pulse-${pulse}`);
    const tick = motion
      ? window.setInterval(() => {
          root.classList.remove(`pulse-${pulse}`);
          pulse = (pulse + 1) % 4;
          root.classList.add(`pulse-${pulse}`);
        }, 1000)
      : 0;

    return () => {
      io?.disconnect();
      window.clearInterval(tick);
      timers.forEach((id) => window.clearTimeout(id));
      root.classList.remove("pulse-0", "pulse-1", "pulse-2", "pulse-3");
    };
  }, []);
  return null;
}
