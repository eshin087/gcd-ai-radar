"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "../useReducedMotion";
import { GlyphEngine, type GlyphController } from "./engine";
import "./glyph.css";

/** The page background (body), so the field melts into it. */
const BG: [number, number, number] = [5 / 255, 7 / 255, 13 / 255];
/** Frames are drawn at most this often (ms): 30 a second is plenty for glyphs and halves the GPU's work. */
const FRAME_MS = 1000 / 30 - 2;
/** A frame slower than this (ms, smoothed) grows the cells (fewer glyphs), at most twice; past the last step the field stops on a still frame. */
const SLOW_MS = 48;
const STALL_MS = 80;

interface Props {
  /** Factory, called once per mount; may load the scene's code first (a dynamic import keeps it out of the page's first bundle). */
  scene: () => GlyphController | Promise<GlyphController>;
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
  /** An image of the scene, shown at once and kept when WebGL is missing, fails or the device is too slow. */
  poster?: string;
  /** Where the poster's focus sits when it is cropped (CSS object-position). */
  posterAt?: string;
  /** Overlay drawn above the canvas (HUD). */
  children?: ReactNode;
}

/** Runs fn when the browser is idle (or after at most `timeout` ms), so the page paints and responds first. */
function whenIdle(fn: () => void, timeout: number): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}

/**
 * Mounts a GlyphEngine scene without ever holding up the page: the poster
 * shows at once; the engine starts once the browser is idle and loads the
 * scene's code on demand; its shaders compile in the background (a light
 * variant first, for scenes that have one) and the canvas fades in over the
 * poster at its first frame. It then draws at 30 frames a second, pauses off
 * screen, in background tabs and when `running` is false, grows its cells on
 * a slow device and, if that is still too slow, stops on a still frame. Under
 * prefers-reduced-motion it draws one still frame. Without WebGL2, or if the
 * context is lost, the poster stays. Scene labels are pinned over the canvas
 * without React renders.
 */
export function GlyphField({ scene, className = "", label, running = true, still = 6, cell = 6, glow = 0.2, exposure = 1, poster, posterAt = "50% 50%", children }: Props) {
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
    let dead = false;
    let teardown: (() => void) | null = null;
    const cancelIdle = whenIdle(() => {
      void (async () => {
        let ctl: GlyphController;
        try {
          ctl = await scene();
        } catch (e) {
          console.warn(e);
          return;
        }
        if (!dead) teardown = mount(ctl);
      })();
    }, 1500);

    const mount = (ctl: GlyphController): (() => void) | null => {
      // a fresh canvas per mount: its WebGL context is released on unmount and cannot be reused
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      canvas.className = "glyph-canvas block h-full w-full";
      slot.appendChild(canvas);
      const family = getComputedStyle(document.documentElement).getPropertyValue("--font-plex-mono").trim() || "ui-monospace, monospace";
      let eng: GlyphEngine;
      try {
        eng = new GlyphEngine(canvas, ctl, { cell, bg: BG, glow, exposure, font: family });
      } catch (e) {
        // no WebGL2: the poster stays
        console.warn(e);
        canvas.remove();
        return null;
      }
      const reduced = prefersReducedMotion();
      if (process.env.NODE_ENV !== "production") ((window as unknown as { __glyph?: GlyphEngine[] }).__glyph ??= []).push(eng);
      const pointer = { x: 0, y: 0, on: false };
      let size = cell;
      let clock = 0;
      let last = 0;
      let lastDraw = 0;
      let raf = 0;
      let visible = true;
      let ema = 0;
      let slowSince = 0;
      let readyAt = 0;
      let shown = false;
      let stopped = false;
      let failed = false;
      let pollTimer = 0;
      let askedFull = false;

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
        if (!eng.render(t, dt, pointer)) return;
        if (!shown) {
          shown = true;
          canvas.classList.add("is-live");
        }
        placeLabels();
      };
      const fail = (e: unknown) => {
        // the poster takes over: nothing more is drawn
        console.warn(e);
        failed = true;
        cancelAnimationFrame(raf);
        raf = 0;
        canvas.remove();
        labelsRef.current?.replaceChildren();
      };
      /** whether a scene program is ready; compiles never block the page (see GlyphEngine.poll) */
      const ready = () => {
        try {
          const ok = eng.poll();
          if (ok && !readyAt) readyAt = performance.now();
          return ok;
        } catch (e) {
          fail(e);
          return false;
        }
      };
      if (process.env.NODE_ENV !== "production") {
        // development probe: play this scene ahead by `sec` seconds at 30 fps, then draw (for checks in a throttled tab)
        const w = window as unknown as { __glyphAdvance?: ((sec: number) => void)[] };
        (w.__glyphAdvance ??= []).push((sec: number) => {
          if (!ready()) return;
          for (let k = 0; k < Math.round(sec * 30); k++) {
            clock += 1 / 30;
            eng.render(clock, 1 / 30, pointer);
          }
          placeLabels();
        });
      }
      const layout = () => {
        eng.resize(host.clientWidth, host.clientHeight);
        if (reduced || stopped || !raf) draw(reduced ? still : clock, 0);
      };
      const loop = (now: number) => {
        raf = 0;
        if (failed) return;
        if (!ready()) {
          // still compiling: look again shortly, without spinning every frame
          pollTimer = window.setTimeout(start, 120);
          return;
        }
        if (!eng.complete && !askedFull && now - readyAt > 8000) {
          // a driver that cannot say when the full shader is done: ask once, when the page is idle (it may wait)
          askedFull = true;
          whenIdle(() => {
            try {
              eng.poll(true);
            } catch (e) {
              fail(e);
            }
          }, 4000);
        }
        if (reduced) {
          // one still frame (redrawn once the full shader replaces the light one)
          draw(still, 0);
          if (!eng.complete) pollTimer = window.setTimeout(start, 250);
          return;
        }
        if (now - lastDraw >= FRAME_MS || !lastDraw) {
          const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 30;
          // judge speed only once the full shader runs and has had a second to settle
          if (last && eng.complete && now - readyAt > 1000) {
            const gap = now - last;
            ema = ema ? ema * 0.9 + gap * 0.1 : gap;
            if (ema > SLOW_MS) {
              if (!slowSince) slowSince = now;
              else if (now - slowSince > 2500) {
                if (size < cell + 3) {
                  // a slow device: bigger cells, fewer glyphs to draw
                  size += 1.5;
                  eng.setCell(size);
                  ema = 0;
                } else if (ema > STALL_MS) {
                  // still too slow at the coarsest cells: stop here, on the frame just drawn
                  stopped = true;
                }
                slowSince = 0;
              }
            } else slowSince = 0;
          }
          last = now;
          lastDraw = now;
          clock += dt;
          draw(clock, dt);
        }
        if (!stopped && visible && runningRef.current && !document.hidden) raf = requestAnimationFrame(loop);
        else last = 0;
      };
      const start = () => {
        window.clearTimeout(pollTimer);
        if (failed || stopped) return;
        if (reduced && shown && eng.complete) return;
        if (!raf && visible && runningRef.current && !document.hidden) raf = requestAnimationFrame(loop);
      };
      kick.current = start;
      eng.resize(host.clientWidth, host.clientHeight);
      void document.fonts?.ready.then(() => {
        if (failed) return;
        eng.buildAtlas();
        if ((reduced || stopped || !raf) && shown) draw(reduced ? still : clock, 0);
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
        fail("glyph field: WebGL context lost");
      };
      canvas.addEventListener("webglcontextlost", onLost);
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(pollTimer);
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
    };

    return () => {
      dead = true;
      cancelIdle();
      teardown?.();
    };
    // the scene factory is fixed per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, glow, exposure, still]);

  return (
    <div ref={hostRef} role="img" aria-label={label} className={`relative overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a decorative still behind the canvas; next/image is not available in the static export */}
      {poster && <img src={poster} alt="" aria-hidden decoding="async" className="glyph-poster absolute inset-0 h-full w-full object-cover" style={{ objectPosition: posterAt }} />}
      <div ref={canvasRef} aria-hidden className="absolute inset-0" />
      <div ref={labelsRef} aria-hidden className="pointer-events-none absolute inset-0" />
      {children}
    </div>
  );
}
