"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "../useReducedMotion";
import { GlyphEngine, type GlyphController } from "./engine";
import "./glyph.css";

/** The page background (body), so the field melts into it. */
const BG: [number, number, number] = [5 / 255, 7 / 255, 13 / 255];
/** Frame time (ms, smoothed) above which the cells grow, at most twice. */
const SLOW_MS = 40;

interface Props {
  /** Factory, called once per mount. */
  scene: () => GlyphController;
  className?: string;
  label: string;
  /** Parent-controlled pause (e.g. the hero has scrolled away). */
  running?: boolean;
  /** Scene time drawn once under reduced motion. */
  still?: number;
  /** CSS px per glyph cell (width). */
  cell?: number;
  glow?: number;
  exposure?: number;
  /** Overlay drawn above the canvas (HUD). */
  children?: ReactNode;
}

/**
 * Mounts a GlyphEngine scene: sizes it to its box, pauses it off screen, in
 * background tabs and when `running` is false, draws one still frame under
 * prefers-reduced-motion, grows the cells on slow devices, and keeps any
 * scene labels pinned over the canvas without React renders.
 */
export function GlyphField({ scene, className = "", label, running = true, still = 6, cell = 6, glow = 0.2, exposure = 1, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(running);
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    runningRef.current = running;
    kick.current();
  }, [running]);

  useEffect(() => {
    const host = hostRef.current;
    const slot = canvasRef.current;
    if (!host || !slot) return;
    // a fresh canvas per mount: its WebGL context is released on unmount and cannot be reused
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.className = "block h-full w-full";
    slot.appendChild(canvas);
    const ctl = scene();
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-plex-mono").trim() || "ui-monospace, monospace";
    let eng: GlyphEngine;
    try {
      eng = new GlyphEngine(canvas, ctl, { cell, bg: BG, glow, exposure, font: family });
    } catch (e) {
      // no WebGL2: the hero simply has no animation
      console.warn(e);
      canvas.remove();
      return;
    }
    const reduced = prefersReducedMotion();
    if (process.env.NODE_ENV !== "production") ((window as unknown as { __glyph?: GlyphEngine[] }).__glyph ??= []).push(eng);
    const pointer = { x: 0, y: 0, on: false };
    let size = cell;
    let clock = 0;
    let last = 0;
    let raf = 0;
    let visible = true;
    let ema = 16;
    let slowSince = 0;

    const placeLabels = () => {
      const box = labelsRef.current;
      if (!box || !ctl.labels || !eng.last) return;
      const items = ctl.labels(eng.last);
      while (box.children.length < items.length) {
        const s = document.createElement("span");
        s.className = "glyph-label";
        box.appendChild(s);
      }
      Array.from(box.children).forEach((el, i) => {
        const node = el as HTMLSpanElement;
        const it = items[i];
        if (!it) {
          node.style.display = "none";
          return;
        }
        node.style.display = "";
        if (node.textContent !== it.text) node.textContent = it.text;
        node.dataset.tone = it.tone ?? "";
        const shift = it.anchor === "end" ? " translateX(-100%)" : it.anchor === "middle" ? " translateX(-50%)" : "";
        node.style.transform = `translate3d(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px, 0)${shift}`;
      });
    };
    const draw = (t: number, dt: number) => {
      eng.render(t, dt, pointer);
      placeLabels();
    };
    if (process.env.NODE_ENV !== "production") {
      // development probe: play this scene ahead by `sec` seconds at 30 fps, then draw (for checks in a throttled tab)
      const w = window as unknown as { __glyphAdvance?: ((sec: number) => void)[] };
      (w.__glyphAdvance ??= []).push((sec: number) => {
        for (let k = 0; k < Math.round(sec * 30); k++) {
          clock += 1 / 30;
          eng.render(clock, 1 / 30, pointer);
        }
        placeLabels();
      });
    }
    const layout = () => {
      eng.resize(host.clientWidth, host.clientHeight);
      if (reduced || !raf) draw(reduced ? still : clock, 0);
    };
    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      if (last) {
        ema = ema * 0.94 + (now - last) * 0.06;
        // a slow device: bigger cells (fewer glyphs), at most twice
        if (ema > SLOW_MS && size < cell + 3) {
          if (!slowSince) slowSince = now;
          else if (now - slowSince > 3000) {
            size += 1.5;
            eng.setCell(size);
            slowSince = 0;
            ema = 16;
          }
        } else slowSince = 0;
      }
      last = now;
      clock += dt;
      draw(clock, dt);
      if (visible && runningRef.current && !document.hidden) raf = requestAnimationFrame(loop);
      else {
        raf = 0;
        last = 0;
      }
    };
    const start = () => {
      if (reduced) return;
      if (!raf && visible && runningRef.current && !document.hidden) raf = requestAnimationFrame(loop);
    };
    kick.current = start;
    layout();
    void document.fonts?.ready.then(() => {
      eng.buildAtlas();
      if (reduced || !raf) draw(reduced ? still : clock, 0);
    });
    start();

    const ro = new ResizeObserver(layout);
    ro.observe(host);
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      start();
    });
    io.observe(host);
    const onVis = () => start();
    document.addEventListener("visibilitychange", onVis);
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = 1 - ((e.clientY - r.top) / r.height) * 2;
      pointer.on = Math.abs(pointer.x) <= 1 && Math.abs(pointer.y) <= 1;
    };
    const onLeave = () => {
      pointer.on = false;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      raf = 0;
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => {
      cancelAnimationFrame(raf);
      kick.current = () => undefined;
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onLost);
      eng.dispose();
      canvas.remove();
    };
    // the scene factory is fixed per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, glow, exposure, still]);

  return (
    <div ref={hostRef} role="img" aria-label={label} className={`relative overflow-hidden ${className}`}>
      <div ref={canvasRef} aria-hidden className="absolute inset-0" />
      <div ref={labelsRef} aria-hidden className="pointer-events-none absolute inset-0" />
      {children}
    </div>
  );
}
