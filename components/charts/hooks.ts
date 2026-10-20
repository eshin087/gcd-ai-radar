"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

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

/**
 * Which months get an x-axis label: every `every`-th counting back from the
 * newest, each clamped inside [lo, hi], skipping any that would land closer
 * than `gap` px to the label after it (the clamp can push the last two together).
 */
export function monthTicks(n: number, every: number, x: (i: number) => number, lo: number, hi: number, gap = 56): { i: number; at: number }[] {
  const out: { i: number; at: number }[] = [];
  for (let i = n - 1; i >= 0; i -= every) {
    const at = Math.min(Math.max(x(i), lo), hi);
    if (out.length === 0 || out[out.length - 1]!.at - at >= gap) out.push({ i, at });
  }
  return out.reverse();
}

/** The width of a small element (sparklines, bar tracks), with no floor, tracked with a ResizeObserver. */
export function useBoxWidth<T extends HTMLElement>(initial = 120): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const noop = () => () => {};
function subscribeFonts(cb: () => void) {
  document.fonts?.addEventListener("loadingdone", cb);
  return () => document.fonts?.removeEventListener("loadingdone", cb);
}

let canvas: CanvasRenderingContext2D | null | undefined;
let sansFamily = "";
let monoFamily = "";

/**
 * Measures text the way the page renders it (the loaded Inter and Plex Mono,
 * on a canvas) so label layouts can pack without collisions. The server and
 * the hydrating render use the same estimate; real measurements take over
 * after hydration and again once the web fonts finish loading.
 */
export function useTextWidth(): (text: string, size: number, opts?: { mono?: boolean; weight?: number }) => number {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const fonts = useSyncExternalStore(subscribeFonts, () => document.fonts?.status ?? "loaded", () => "loading");
  return useCallback(
    (text, size, opts = {}) => {
      const estimate = text.length * size * (opts.mono ? 0.6 : 0.56);
      if (!hydrated) return estimate;
      if (canvas === undefined) {
        canvas = document.createElement("canvas").getContext("2d");
        const css = getComputedStyle(document.body);
        sansFamily = css.fontFamily;
        monoFamily = css.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace";
      }
      if (!canvas) return estimate;
      canvas.font = `${opts.weight ?? 400} ${size}px ${opts.mono ? monoFamily : sansFamily}`;
      return canvas.measureText(text).width;
    },
    // fonts is a dependency on purpose: widths change once the web fonts land
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, fonts],
  );
}

/** Ink or surface text, whichever reads better inside a fill of this colour (WCAG relative luminance). */
export function textOn(hex: string, ink = "#e2e8f5", surface = "#070a12"): string {
  const c = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  // contrast against near-white ink (L ≈ 0.79) and the near-black surface (L ≈ 0.003)
  return (0.79 + 0.05) / (L + 0.05) >= (L + 0.05) / (0.003 + 0.05) ? ink : surface;
}

/** The direction tones used for change: rising counts read warm, falling ones cool (the site's --color-sev-3 and --color-type-by). */
export const RISE = "#ff9b6b";
export const FALL = "#7fdcff";
