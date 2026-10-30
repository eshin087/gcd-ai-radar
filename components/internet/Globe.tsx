"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { clamp, DEG, wrap } from "./globe/geo";
import { buildArc, buildVisual, GlobeRenderer, type Arc, type Palette, type Visual } from "./globe/render";
import { stopKey, type Stop } from "./tour";
import type { InternetRoute } from "./useInternet";

/**
 * The band's globe: what Cloudflare Radar reports (DDoS routes, the origins
 * of exploit attempts, route hijacks, outages) on an orthographic sphere
 * whose land is lit by the real Sun (canvas 2D, ./globe/render.ts draws it).
 *
 * A tour visits the stops in turn: the camera glides to one, it draws in,
 * then plays its own animation until the next; `onFocus` tells the caption
 * beside it which stop is on screen, and `controlRef.focus(i)` jumps to one.
 *
 * Drag to turn it: the point under the pointer follows the pointer, and a
 * flick keeps it turning and slows to a stop. The tour waits RESUME_S after
 * the last touch, then glides back. On phones vertical swipes still scroll
 * the page (touch-action: pan-y). Nothing moves without data (idle), off
 * screen or in a hidden tab; reduced motion gets still frames.
 */

/** Seconds each stop stays once the camera has arrived. */
const HOLD_S = 7;
/** Seconds a stop takes to draw in. */
const DRAW_S = 1.1;
/** Seconds after the last touch before the tour takes the camera back. */
const RESUME_S = 4;
const FADE_S = 0.7;
/** A flick's speed falls by a factor e every COAST_TAU seconds. */
const COAST_TAU = 0.8;
const MAX_LAT = 72 * DEG;
/** Before any data: Europe and Africa, tipped a little north. */
const START: [number, number] = [18 * DEG, 20 * DEG];

export interface GlobeControl {
  focus(i: number): void;
}

export interface GlobeProps {
  /** The tour, in order (see ./tour.ts: every stop has a place on the map). */
  stops: Stop[];
  /** Routes drawn as faint hairlines behind the tour. */
  context: InternetRoute[];
  /** False keeps the globe still: no data, an error, or loading. */
  running: boolean;
  /** The index of the stop the tour turns to, when it starts turning. */
  onFocus?: (i: number) => void;
  controlRef?: Ref<GlobeControl>;
  className?: string;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function Globe({ stops, context, running, onFocus, controlRef, className = "" }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(running);
  const dataRef = useRef({ stops, context });
  const onFocusRef = useRef(onFocus);
  const apiRef = useRef<{ setData(): void; kick(): void; focus(i: number): void } | null>(null);
  // what the drawing depends on: each stop's identity (and an outage's end and type), and the hairlines
  const dataKey = [...stops.map((s) => (s.kind === "outage" ? `${stopKey(s)}:${s.event.until ?? ""}:${s.event.type ?? ""}` : stopKey(s))), "|", ...context.map((r) => `${r.origin}>${r.target}`)].join(",");

  useImperativeHandle(controlRef, () => ({ focus: (i: number) => apiRef.current?.focus(i) }), []);

  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  useEffect(() => {
    runningRef.current = running;
    apiRef.current?.kick();
  }, [running]);

  useEffect(() => {
    dataRef.current = { stops, context };
    apiRef.current?.setData();
    // dataKey stands for the stops' and routes' content; new arrays with the same content change nothing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(canvas);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const pal: Palette = {
      accent: v("--color-accent", "#ffb35c"),
      ink: v("--color-ink", "#e8ebf2"),
      soft: v("--color-soft", "#c0c6d4"),
      hit: v("--color-live", "#ff5c5c"),
      ground: v("--color-ground", "#07090e"),
      mono: `${v("--font-plex-mono", "ui-monospace")}, monospace`,
    };
    const r = new GlobeRenderer(canvas, pal);

    let visuals: Visual[] = [];
    let context: Arc[] = [];
    let lon = START[0], lat = START[1];
    let vLon = 0, vLat = 0;
    let drag: { id: number; x: number; y: number; lon: number; lat: number; samples: [number, number, number][] } | null = null;
    let coasting = false;
    let lastTouch = -Infinity;
    let resume = false;
    let glide: { fl: number; fp: number; tl: number; tp: number; t0: number; dur: number } | null = null;
    let focus = -1, eventT = 0, drawnLatch = 0, pulseT = -1;
    let fade = -1, fadeT0 = -Infinity;
    let raf = 0, visible = false, lastMs = 0;

    const secs = () => performance.now() / 1000;
    const tourN = () => (runningRef.current ? visuals.length : 0);

    const startGlide = (t: number, to: [number, number]) => {
      const dl = wrap(to[0] - lon), dp = to[1] - lat;
      const dist = Math.hypot(dl * Math.cos(lat), dp);
      if (still || dist < 0.005) {
        lon = to[0];
        lat = to[1];
        glide = null;
        return;
      }
      glide = { fl: lon, fp: lat, tl: lon + dl, tp: to[1], t0: t, dur: 0.75 + 1.1 * Math.min(1, dist / Math.PI) };
    };

    const startEvent = (i: number, t: number) => {
      if (focus >= 0 && focus !== i) {
        fade = focus;
        fadeT0 = t;
      }
      focus = i;
      eventT = 0;
      drawnLatch = still ? 1 : 0;
      pulseT = -1;
      startGlide(t, visuals[i]!.view);
      onFocusRef.current?.(i);
    };

    const tick = (t: number, dt: number) => {
      if (drag) {
        // the pointer sets the camera
      } else if (coasting) {
        lon += vLon * dt;
        lat = clamp(lat + vLat * dt, -MAX_LAT, MAX_LAT);
        vLon *= Math.exp(-dt / COAST_TAU);
        vLat *= Math.exp(-dt / (COAST_TAU / 2));
        if (Math.hypot(vLon * Math.cos(lat), vLat) < 0.05) {
          coasting = false;
          lastTouch = t;
          resume = true;
        }
      } else if (tourN() > 0 && t - lastTouch >= RESUME_S) {
        if (focus < 0) startEvent(0, t);
        else if (resume) startGlide(t, visuals[focus]!.view);
        resume = false;
        if (glide) {
          const e = clamp((t - glide.t0) / glide.dur, 0, 1), q = easeInOut(e);
          lon = glide.fl + (glide.tl - glide.fl) * q;
          lat = glide.fp + (glide.tp - glide.fp) * q;
          if (e >= 1) glide = null;
        } else {
          eventT += dt;
          if (eventT >= DRAW_S + HOLD_S && tourN() > 1) startEvent((focus + 1) % tourN(), t);
        }
      }
      if (focus >= 0 && !glide) drawnLatch = Math.max(drawnLatch, clamp(eventT / DRAW_S, 0, 1));
      if (drawnLatch >= 1) pulseT = pulseT < 0 ? 0 : pulseT + dt;
    };

    const render = (t: number) => {
      const on = tourN() > 0;
      r.draw({
        lon,
        lat,
        now: Date.now(),
        context: on ? context : [],
        focus: on ? (visuals[focus] ?? null) : null,
        drawn: on && focus >= 0 ? drawnLatch : 0,
        pulse: on && !still ? pulseT : -1,
        fade: on ? (visuals[fade] ?? null) : null,
        fadeAlpha: clamp(1 - (t - fadeT0) / FADE_S, 0, 1),
      });
    };

    const wantLoop = () => visible && !document.hidden && !still && (!!drag || coasting || tourN() > 0);
    const loop = (ms: number) => {
      raf = 0;
      const brisk = !!drag || coasting || !!glide;
      if (!lastMs || ms - lastMs >= (brisk ? 1000 / 60 : 1000 / 30) - 1) {
        const dt = lastMs ? Math.min(0.1, (ms - lastMs) / 1000) : 0;
        lastMs = ms;
        tick(ms / 1000, dt);
        render(ms / 1000);
      }
      if (wantLoop()) raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (wantLoop()) {
        if (!raf) {
          lastMs = 0;
          raf = requestAnimationFrame(loop);
        }
        return;
      }
      cancelAnimationFrame(raf);
      raf = 0;
      // a still frame: reduced motion shows the first route drawn, at rest
      if (still && tourN() > 0 && focus < 0) startEvent(0, secs());
      render(secs());
    };

    const setData = () => {
      const shown = visuals[focus]?.key ?? "";
      visuals = dataRef.current.stops.map((s) => buildVisual(s, stopKey(s))).filter((v): v is Visual => !!v);
      context = dataRef.current.context.map(buildArc).filter((a): a is Arc => !!a);
      fade = -1;
      // a refresh keeps the stop on screen when it is still toured (at its new place in the order);
      // otherwise the tour starts again from the first
      const at = shown ? visuals.findIndex((v) => v.key === shown) : -1;
      if (at >= 0 && at < tourN()) {
        focus = at;
        onFocusRef.current?.(at);
      } else focus = -1;
      kick();
    };
    const focusOn = (i: number) => {
      if (i < 0 || i >= tourN()) return;
      drag = null;
      coasting = false;
      lastTouch = -Infinity;
      resume = false;
      startEvent(i, secs());
      kick();
    };
    apiRef.current = { setData, kick, focus: focusOn };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lon, lat, samples: [[performance.now(), e.clientX, e.clientY]] };
      coasting = false;
      glide = null;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      kick();
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const R = r.radius;
      // grab: the point under the pointer moves with it, right drags turn the surface right
      lon = drag.lon - (e.clientX - drag.x) / R;
      lat = clamp(drag.lat + (e.clientY - drag.y) / R, -MAX_LAT, MAX_LAT);
      const ms = performance.now();
      drag.samples.push([ms, e.clientX, e.clientY]);
      while (drag.samples.length > 2 && ms - drag.samples[0]![0] > 100) drag.samples.shift();
      if (still) render(secs());
    };
    const onEnd = (e: PointerEvent, fling: boolean) => {
      if (!drag || e.pointerId !== drag.id) return;
      const s = drag.samples, a = s[0]!, b = s[s.length - 1]!;
      const span = (b[0] - a[0]) / 1000;
      const R = r.radius;
      // let go while moving: keep turning at the release speed and slow down
      if (fling && !still && span > 0.008 && performance.now() - b[0] < 80) {
        const dx = b[1] - a[1], dy = b[2] - a[2];
        vLon = clamp(-dx / span / R, -6, 6);
        // a flick spins the globe on its axis; only a mostly vertical flick tips it, and gently
        vLat = Math.abs(dy) > 1.5 * Math.abs(dx) ? clamp(dy / span / R, -1.5, 1.5) : 0;
        coasting = Math.hypot(vLon, vLat) > 0.2;
      }
      drag = null;
      lastTouch = secs();
      resume = true;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = "grab";
      kick();
    };
    const onUp = (e: PointerEvent) => onEnd(e, true);
    const onCancel = (e: PointerEvent) => onEnd(e, false);

    const layout = () => {
      r.resize();
      render(secs());
    };
    const ro = new ResizeObserver(layout);
    ro.observe(canvas);
    const io = new IntersectionObserver(([en]) => {
      visible = !!en?.isIntersecting;
      kick();
    });
    io.observe(canvas);
    const onVis = () => kick();
    document.addEventListener("visibilitychange", onVis);
    // glyph widths are measured, so measure again once the web font is in
    void document.fonts?.ready.then(() => {
      if (apiRef.current) layout();
    });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    setData();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      apiRef.current = null;
    };
  }, []);

  return (
    <figure className={`relative m-0 ${className}`}>
      <figcaption className="sr-only">
        A globe of what Cloudflare Radar reports: the largest DDoS attack routes, where blocked exploit attempts come from, a route hijack and a recent outage, turning to each in turn. The text beside it describes the one on screen.
      </figcaption>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block h-full w-full cursor-grab select-none" style={{ touchAction: "pan-y" }} />
    </figure>
  );
}
