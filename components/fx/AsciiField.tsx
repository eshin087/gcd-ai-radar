"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./useReducedMotion";

/** Per-cell buffers a scene fills every frame. */
export interface FieldBuffers {
  cols: number;
  rows: number;
  /** cell width and height in CSS px */
  cw: number;
  ch: number;
  /** brightness 0..1 (cells under ~0.03 are not drawn) */
  lum: Float32Array;
  /** palette index */
  tone: Uint8Array;
  /** char code; 0 picks a glyph from the density ramp by brightness */
  glyph: Uint16Array;
}

export interface FieldPointer {
  x: number;
  y: number;
  on: boolean;
}

/** A procedural ASCII scene: build geometry on resize, fill the buffers per frame. */
export interface AsciiScene {
  resize(b: FieldBuffers, width: number, height: number): void;
  frame(b: FieldBuffers, t: number, pointer: FieldPointer): void;
}

const RAMP = " .,:;-=+*oO#%@";
const LEVELS = 8;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

interface Props {
  /** Factory, called once per mount. */
  scene: () => AsciiScene;
  /** Hex colours indexed by `tone`. */
  palette: string[];
  fontSize?: number;
  lineHeight?: number;
  className?: string;
  label: string;
  /** Parent-controlled pause (e.g. the hero has faded out). */
  running?: boolean;
  /** Scene time drawn once under reduced motion. */
  still?: number;
}

/**
 * Canvas renderer for procedural ASCII scenes. Cells are drawn as monospace
 * glyphs, batched by colour and brightness level (one fillStyle per batch).
 * Pauses off screen, in background tabs and when `running` is false; draws a
 * single still frame under prefers-reduced-motion.
 */
export function AsciiField({ scene, palette, fontSize = 12, lineHeight = 1.15, className = "", label, running = true, still = 3.2 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(running);
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    runningRef.current = running;
    kick.current();
  }, [running]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sc = scene();
    const reduced = prefersReducedMotion();
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-plex-mono").trim() || "ui-monospace, monospace";
    const font = `500 ${fontSize}px ${family}`;
    const styles: string[] = [];
    palette.forEach((hex) => {
      for (let l = 0; l < LEVELS; l++) styles.push(rgba(hex, 0.18 + 0.82 * ((l + 1) / LEVELS)));
    });
    const glyphCache = new Map<number, string>();
    const glyphOf = (code: number) => {
      let g = glyphCache.get(code);
      if (g === undefined) {
        g = String.fromCharCode(code);
        glyphCache.set(code, g);
      }
      return g;
    };

    let w = 0;
    let h = 0;
    let ox = 0;
    let oy = 0;
    let b: FieldBuffers | null = null;
    let order = new Int32Array(0);
    const counts = new Int32Array(palette.length * LEVELS + 1);
    const pointer: FieldPointer = { x: 0, y: 0, on: false };

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = host.clientWidth;
      h = host.clientHeight;
      if (w < 2 || h < 2) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = font;
      ctx.textBaseline = "top";
      const cw = ctx.measureText("M").width || fontSize * 0.6;
      const chh = fontSize * lineHeight;
      const cols = Math.max(1, Math.floor(w / cw));
      const rows = Math.max(1, Math.floor(h / chh));
      ox = (w - cols * cw) / 2;
      oy = (h - rows * chh) / 2;
      const n = cols * rows;
      b = { cols, rows, cw, ch: chh, lum: new Float32Array(n), tone: new Uint8Array(n), glyph: new Uint16Array(n) };
      order = new Int32Array(n);
      sc.resize(b, w, h);
    };

    const draw = (t: number) => {
      if (!b) return;
      const { cols, rows, cw, ch, lum, tone, glyph } = b;
      lum.fill(0);
      tone.fill(0);
      glyph.fill(0);
      sc.frame(b, t, pointer);
      ctx.clearRect(0, 0, w, h);
      // counting sort by (tone, level) so each batch sets fillStyle once
      const nb = palette.length * LEVELS;
      counts.fill(0);
      const key = (i: number) => {
        const l = lum[i]!;
        if (l < 0.03) return -1;
        return Math.min(palette.length - 1, tone[i]!) * LEVELS + Math.min(LEVELS - 1, Math.floor(l * LEVELS));
      };
      const n = cols * rows;
      for (let i = 0; i < n; i++) {
        const k = key(i);
        if (k >= 0) counts[k + 1]! += 1;
      }
      for (let k = 1; k <= nb; k++) counts[k]! += counts[k - 1]!;
      const cursor = counts.slice(0, nb);
      for (let i = 0; i < n; i++) {
        const k = key(i);
        if (k >= 0) order[cursor[k]!++] = i;
      }
      let at = 0;
      for (let k = 0; k < nb; k++) {
        const end = counts[k + 1]!;
        if (end === at) continue;
        ctx.fillStyle = styles[k]!;
        for (; at < end; at++) {
          const i = order[at]!;
          const code = glyph[i]!;
          const l = lum[i]!;
          const g = code ? glyphOf(code) : RAMP[1 + Math.min(RAMP.length - 2, Math.floor(l * (RAMP.length - 1)))]!;
          ctx.fillText(g, ox + (i % cols) * cw, oy + Math.floor(i / cols) * ch);
        }
      }
    };

    layout();
    // re-measure once the web font is in (cell width depends on it)
    void document.fonts?.ready.then(() => {
      layout();
      if (reduced) draw(still);
    });
    const t0 = performance.now();
    let raf = 0;
    let visible = true;
    const loop = (now: number) => {
      draw((now - t0) / 1000);
      if (!reduced && visible && runningRef.current && !document.hidden) raf = requestAnimationFrame(loop);
      else raf = 0;
    };
    const start = () => {
      if (reduced) {
        draw(still);
        return;
      }
      if (!raf && visible && runningRef.current && !document.hidden) raf = requestAnimationFrame(loop);
    };
    kick.current = start;
    start();

    const ro = new ResizeObserver(() => {
      layout();
      if (reduced || !raf) draw(reduced ? still : (performance.now() - t0) / 1000);
    });
    ro.observe(host);
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      start();
    });
    io.observe(canvas);
    const onVis = () => start();
    document.addEventListener("visibilitychange", onVis);
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.on = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= r.width && pointer.y <= r.height;
    };
    const onLeave = () => {
      pointer.on = false;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      kick.current = () => undefined;
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
    // the scene factory and palette are fixed per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize, lineHeight, still]);

  return <canvas ref={canvasRef} role="img" aria-label={label} className={`block ${className}`} />;
}
