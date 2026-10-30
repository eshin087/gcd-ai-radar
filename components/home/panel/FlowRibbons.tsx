"use client";

import { useEffect, useRef, useState } from "react";
import { useBuild } from "@/components/home/panel/useBuild";

/**
 * The AI flow's middle: one dotted line per two incidents, bundled on the
 * left and fanning out to the role nodes on the right (dots for the target,
 * dashes for the weapon, dim dots for no AI role). The lines are cubic curves
 * drawn from the nodes' measured centres, clamped so a whole ribbon stays in
 * the box, and redrawn when the layout changes. On build they reveal left to
 * right in 1.1 s; under motion they drift along their curves (globals.css).
 * Hidden on phones, where the nodes stack under the total.
 */

const SPACING = 3.4;
const REVEAL_MS = 1100;

interface Ribbon {
  cls: "t" | "w" | "z";
  d: string;
  delay: string;
}

export function FlowRibbons({ counts }: { counts: { cls: "t" | "w" | "z"; n: number }[] }) {
  const box = useRef<HTMLDivElement>(null);
  const clip = useRef<SVGRectElement>(null);
  const [geo, setGeo] = useState<{ w: number; h: number; ribbons: Ribbon[] } | null>(null);
  const clipId = `flow-clip-${counts.map((c) => c.n).join("-")}`;

  useEffect(() => {
    const el = box.current;
    const flow = el?.closest<HTMLElement>("[data-flow]");
    if (!el || !flow) return;
    const draw = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return setGeo(null);
      const top = el.getBoundingClientRect().top;
      const nodes = [...flow.querySelectorAll<HTMLElement>("[data-node]")];
      const ks = counts.map((c) => Math.max(1, Math.ceil(c.n / 2)));
      let y0 = (h - ks.reduce((a, b) => a + b, 0) * SPACING) / 2;
      const ribbons: Ribbon[] = [];
      counts.forEach((c, bi) => {
        const k = ks[bi]!;
        const r = nodes[bi]?.getBoundingClientRect();
        const half = (k * SPACING) / 2 + 1;
        const centre = r ? r.top + r.height / 2 - top : h / 2;
        const cy = Math.min(Math.max(centre, half), h - half);
        for (let i = 0; i < k; i++) {
          const ya = (y0 + i * SPACING).toFixed(1);
          const yb = (cy + (i - (k - 1) / 2) * SPACING).toFixed(1);
          ribbons.push({ cls: c.cls, d: `M0 ${ya} C ${(w * 0.42).toFixed(0)} ${ya}, ${(w * 0.58).toFixed(0)} ${yb}, ${w} ${yb}`, delay: `${(-(i * 0.37) - bi).toFixed(2)}s` });
        }
        y0 += k * SPACING;
      });
      setGeo({ w, h, ribbons });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(flow);
    return () => ro.disconnect();
  }, [counts]);

  useBuild(box, (instant) => {
    const r = clip.current;
    const w = box.current?.clientWidth ?? 0;
    if (instant || !r || !w) return;
    const t0 = performance.now();
    r.setAttribute("width", "0");
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / REVEAL_MS);
      r.setAttribute("width", String(w * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
      else r.setAttribute("width", "100%");
    };
    requestAnimationFrame(step);
  });

  return (
    <div ref={box} aria-hidden className="relative hidden min-h-[240px] sm:block">
      <svg className="flow-ribbons absolute inset-0 h-full w-full overflow-visible" viewBox={geo ? `0 0 ${geo.w} ${geo.h}` : undefined} data-paths={geo?.ribbons.length ?? 0}>
        <defs>
          <clipPath id={clipId}>
            <rect ref={clip} x="0" y="0" width="100%" height="100%" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {geo?.ribbons.map((r, i) => (
            <path key={i} className={r.cls} d={r.d} style={{ animationDelay: r.delay }} />
          ))}
        </g>
      </svg>
    </div>
  );
}
