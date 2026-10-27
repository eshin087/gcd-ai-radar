"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { monthLabel } from "@/lib/format";
import type { ClusterData } from "@/lib/home";
import { ClusterView, TILE_H } from "./cluster";

/** The counter whose drawer a tile opens (components/home/HomeCounters.tsx); New CVEs opens the count it shows. */
const CVE_COUNTERS = ["cves_24h", "cves_7d", "critical_7d"] as const;
const KEV_CATALOG = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog";
const nvdUrl = (cve: string) => `https://nvd.nist.gov/vuln/detail/${cve}`;

function openCounter(id: string) {
  document.querySelector<HTMLButtonElement>(`button[data-counter="${id}"]`)?.click();
}

/**
 * The radar's middle column: due, open, new CVEs and breached as a 2x2 of
 * text instruments (./cluster.ts draws them). Each tile is a control over the
 * canvas: Due opens the KEV entry on screen at NVD, Open goes to the live
 * board, New CVEs and Breached open the same drawer as their counter under
 * the hero. Paused off screen; one still frame a second under reduced
 * motion, for the countdown.
 */
export function RadarCluster({ data }: { data: ClusterData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ClusterView | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mono = `${getComputedStyle(canvas).getPropertyValue("--font-plex-mono").trim() || "ui-monospace"}, monospace`;
    const view = new ClusterView(canvas, data, mono, still);
    viewRef.current = view;
    const t0 = performance.now();
    let raf = 0, timer = 0, last = 0, visible = false;
    const draw = () => view.render((performance.now() - t0) / 1000, Date.now());
    const frame = (ms: number) => {
      raf = 0;
      if (ms - last >= 33) {
        last = ms;
        draw();
      }
      if (visible) raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      window.clearInterval(timer);
      timer = 0;
    };
    const kick = () => {
      if (!visible) return stop();
      if (still) {
        draw();
        if (!timer) timer = window.setInterval(draw, 1000);
      } else if (!raf) raf = requestAnimationFrame(frame);
    };
    const layout = () => {
      view.resize();
      draw();
    };
    const ro = new ResizeObserver(layout);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      kick();
    });
    io.observe(canvas);
    // character widths are measured, so measure again once the web font is in
    void document.fonts?.ready.then(layout);
    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      viewRef.current = null;
    };
  }, [data]);

  // the tile under the pointer or focus lights its label on the canvas
  const setHover = (i: number) => {
    if (viewRef.current) viewRef.current.hover = i;
  };
  const off = () => setHover(-1);
  const tile = "block h-full w-full cursor-pointer rounded-sm bg-transparent focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--color-accent)]";
  const k = data.kev?.[0];
  const o = data.open;
  const c = data.cves;
  const b = data.breaches;

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block h-full w-full" />
      {/* the same 2x2 as the canvas: two 16 px-apart columns, two rows of TILE_H, centred */}
      <div className="absolute inset-0 grid grid-cols-2 content-center gap-x-4 gap-y-[38px]" style={{ gridAutoRows: TILE_H }}>
        <a
          href={k ? nvdUrl(k.cve) : KEV_CATALOG}
          target="_blank"
          rel="noopener noreferrer"
          data-tile="due"
          data-value={data.kev?.length ?? ""}
          className={tile}
          // the tile cycles, so the link follows the entry on screen when it is followed
          onClick={(e) => {
            const shown = viewRef.current?.dueShown(Date.now());
            e.currentTarget.href = shown ? nvdUrl(shown.cve) : KEV_CATALOG;
          }}
          aria-label={
            k
              ? `Open CISA KEV deadlines: ${data.kev!.length}, the nearest ${k.vendor} ${k.product} (${k.cve}), due ${k.due}. Opens the CVE on screen at NVD.`
              : "CISA KEV: no open deadline. Opens the catalog."
          }
          onPointerEnter={() => setHover(0)}
          onPointerLeave={off}
          onFocus={() => setHover(0)}
          onBlur={off}
        />
        <Link
          href="/live"
          data-tile="open"
          data-value={o.total}
          className={tile}
          aria-label={`Open records we track, severity 3 and up: ${o.total} (patch ${o.lanes.patch}, breach ${o.lanes.breach}, supply chain ${o.lanes.supply_chain}). Opens the live board.`}
          onPointerEnter={() => setHover(1)}
          onPointerLeave={off}
          onFocus={() => setHover(1)}
          onBlur={off}
        />
        <button
          type="button"
          data-tile="cves"
          data-value={c?.day ?? ""}
          className={tile}
          onClick={() => openCounter(CVE_COUNTERS[viewRef.current?.cvesShown() ?? 0]!)}
          aria-label={c ? `New CVEs: ${c.day} in the last 24 hours, ${c.week} in 7 days, ${c.critical} critical in 7 days. Opens the list on screen.` : "New CVEs: NVD data not loaded."}
          onPointerEnter={() => setHover(2)}
          onPointerLeave={off}
          onFocus={() => setHover(2)}
          onBlur={off}
        />
        <button
          type="button"
          data-tile="breached"
          data-value={b?.accounts ?? ""}
          className={tile}
          onClick={() => openCounter("breached_accounts_month")}
          aria-label={b ? `Accounts in verified breaches added in ${monthLabel(b.month, true)}: ${b.accounts}. Opens the month's breaches.` : "Breached accounts: HIBP data not loaded."}
          onPointerEnter={() => setHover(3)}
          onPointerLeave={off}
          onFocus={() => setHover(3)}
          onBlur={off}
        />
      </div>
    </div>
  );
}
