"use client";

import { useEffect, useRef } from "react";
import GLOBE from "@/lib/globe-data.json";
import type { InternetRoute } from "./useInternet";

/**
 * The band's globe: Natural Earth's land as a 2° grid of dots on an
 * orthographic sphere, canvas 2D, with the last hour's top layer 7 attack
 * routes from Cloudflare Radar drawn as lifted great-circle arcs, a pulse
 * travelling origin to target along each, and the top three routes labelled.
 * The sphere turns slowly and can be dragged. Everything that moves comes
 * from the timestamped payload: with no routes (idle) the globe stands still.
 * 30 fps cap, paused off screen, a still frame under reduced motion. No glow,
 * no blur, 12 px text.
 *
 * Globe data: scripts/build-globe.ts, "Made with Natural Earth" (public domain).
 */

interface GlobeData {
  step: number;
  rows: number[][];
  labels: Record<string, [number, number, string]>;
}
// the JSON import types the tuples as (string | number)[]; the build script guarantees the shape
const DATA = GLOBE as unknown as GlobeData;

/** Seconds for one full turn when nobody is dragging. */
const TURN_S = 150;
/** Seconds after a drag before the turn resumes. */
const RESUME_S = 3;
/** Seconds a pulse takes from origin to target. */
const PULSE_S = 2.6;
const FRAME_MS = 1000 / 30;
/** Tilt of the view towards the north, in radians. */
const TILT = 0.36;
const LABELLED = 3;

interface V3 {
  x: number;
  y: number;
  z: number;
}

function unit(lon10: number, lat10: number): V3 {
  const lon = (lon10 / 10) * (Math.PI / 180);
  const lat = (lat10 / 10) * (Math.PI / 180);
  const c = Math.cos(lat);
  return { x: c * Math.cos(lon), y: Math.sin(lat), z: c * Math.sin(lon) };
}

/** Spherical interpolation between two unit vectors. */
function slerp(a: V3, b: V3, t: number): V3 {
  const d = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  const ang = Math.acos(d);
  if (ang < 1e-6) return a;
  const s = Math.sin(ang);
  const wa = Math.sin((1 - t) * ang) / s;
  const wb = Math.sin(t * ang) / s;
  return { x: wa * a.x + wb * b.x, y: wa * a.y + wb * b.y, z: wa * a.z + wb * b.z };
}

interface Arc {
  route: InternetRoute;
  /** Points along the lifted great circle, as unit-sphere multiples. */
  pts: V3[];
  /** Pulse phase offset so the arcs do not pulse in step. */
  phase: number;
  width: number;
}

function buildArcs(routes: InternetRoute[]): Arc[] {
  const max = Math.max(...routes.map((r) => r.share), 0.001);
  const arcs: Arc[] = [];
  routes.forEach((route, i) => {
    const a = DATA.labels[route.origin];
    const b = DATA.labels[route.target];
    if (!a || !b) return;
    const va = unit(a[0], a[1]);
    const vb = unit(b[0], b[1]);
    const dot = va.x * vb.x + va.y * vb.y + va.z * vb.z;
    const span = Math.acos(Math.max(-1, Math.min(1, dot)));
    // a route onto itself (US → US) is a small loop lifted over the country
    const self = span < 1e-3;
    const lift = self ? 0.1 : 0.04 + 0.09 * (span / Math.PI);
    const n = 48;
    const pts: V3[] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = self ? va : slerp(va, vb, t);
      const h = 1 + lift * Math.sin(Math.PI * t);
      pts.push(self ? { x: p.x * h + 0.04 * Math.sin(2 * Math.PI * t) * p.y, y: p.y * h, z: p.z * h } : { x: p.x * h, y: p.y * h, z: p.z * h });
    }
    arcs.push({ route, pts, phase: (i * 0.37) % 1, width: 0.8 + 1.2 * (route.share / max) });
  });
  return arcs;
}

export interface GlobeProps {
  routes: InternetRoute[];
  /** False keeps the frame still (no data, tab hidden, band paused). */
  running: boolean;
  className?: string;
}

export function Globe({ routes, running, className = "" }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(running);
  const kickRef = useRef<() => void>(() => {});
  const arcsRef = useRef<Arc[]>([]);
  const faceRef = useRef<(lon10: number) => void>(() => {});
  const facedRef = useRef(false);
  const routesKey = routes.map((r) => `${r.origin}>${r.target}:${r.share}`).join("|");

  useEffect(() => {
    runningRef.current = running;
    kickRef.current();
  }, [running]);

  useEffect(() => {
    arcsRef.current = buildArcs(routes);
    // the first routes turn the globe to face the country most attacked, so the arcs land in view; later refreshes never jump it
    if (routes.length && !facedRef.current) {
      const sums = new Map<string, number>();
      for (const r of routes) sums.set(r.target, (sums.get(r.target) ?? 0) + r.share);
      const top = [...sums.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const at = top ? DATA.labels[top] : undefined;
      if (at) {
        facedRef.current = true;
        faceRef.current(at[0]);
      }
    }
    kickRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(canvas);
    const mono = `${css.getPropertyValue("--font-plex-mono").trim() || "ui-monospace"}, monospace`;
    const accent = css.getPropertyValue("--color-accent").trim() || "#ffb35c";
    const ink = css.getPropertyValue("--color-ink").trim() || "#e8ebf2";
    const dim = css.getPropertyValue("--color-dim").trim() || "#8a93a6";

    // the land dots, once, as unit vectors
    const dots: V3[] = [];
    for (const row of DATA.rows) {
      const lat10 = row[0] ?? 0;
      for (let i = 1; i < row.length; i++) dots.push(unit(row[i] ?? 0, lat10));
    }

    let w = 0, h = 0, R = 0, cx = 0, cy = 0;
    let spin = 0.9; // view rotation in radians (centre longitude = 90° - spin): idle frames face Europe and Africa
    let tilt = TILT;
    let raf = 0, visible = false, lastFrame = 0, lastTick = 0, dragEnd = -99;
    let drag: { x: number; y: number; spin: number; tilt: number } | null = null;

    const layout = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      R = Math.max(20, Math.min(w, h) / 2 - 10);
      cx = w / 2;
      cy = h / 2;
    };

    /** View rotation: spin about the pole, then tilt towards the viewer. Returns view-space coordinates (z towards the viewer). */
    const view = (p: V3, cs: number, sn: number, ct: number, st: number): V3 => {
      const x = p.x * cs - p.z * sn;
      const z = p.x * sn + p.z * cs;
      return { x, y: p.y * ct - z * st, z: p.y * st + z * ct };
    };
    /** Anything on the far half is hidden, lifted or not: arcs wrap out of sight behind the sphere instead of looping outside the limb. */
    const hidden = (v: V3) => v.z < 0;

    const draw = (time: number) => {
      ctx.clearRect(0, 0, w, h);
      const cs = Math.cos(spin), sn = Math.sin(spin), ct = Math.cos(tilt), st = Math.sin(tilt);

      // the limb: one hairline
      ctx.strokeStyle = "rgba(160,170,195,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      // land dots, fading towards the limb
      const size = R > 150 ? 1.6 : 1.3;
      for (const d of dots) {
        const v = view(d, cs, sn, ct, st);
        if (v.z <= 0) continue;
        ctx.globalAlpha = 0.22 + 0.5 * v.z;
        ctx.fillStyle = "#c0c6d4";
        ctx.fillRect(cx + R * v.x - size / 2, cy - R * v.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;

      // arcs, then pulses, then labels. Each segment's alpha rises with its depth, so an arc
      // coming round from the far side fades in at the horizon instead of appearing as a ray.
      const arcs = arcsRef.current;
      const labelled: { route: InternetRoute; at: V3 }[] = [];
      const depth = (z: number) => Math.min(1, Math.max(0, z / 0.3));
      arcs.forEach((arc, i) => {
        const base = i < LABELLED ? 0.6 : 0.32;
        const vs = arc.pts.map((p) => view(p, cs, sn, ct, st));
        ctx.strokeStyle = accent;
        ctx.lineWidth = arc.width;
        for (let k = 1; k < vs.length; k++) {
          const a = vs[k - 1]!, b = vs[k]!;
          if (hidden(a) || hidden(b)) continue;
          ctx.globalAlpha = base * depth(Math.min(a.z, b.z));
          ctx.beginPath();
          ctx.moveTo(cx + R * a.x, cy - R * a.y);
          ctx.lineTo(cx + R * b.x, cy - R * b.y);
          ctx.stroke();
        }
        // end markers
        for (const v of [vs[0], vs[vs.length - 1]]) {
          if (!v || hidden(v)) continue;
          ctx.globalAlpha = depth(v.z);
          ctx.fillStyle = accent;
          ctx.fillRect(cx + R * v.x - 1.5, cy - R * v.y - 1.5, 3, 3);
        }
        if (!still) {
          const t = ((time / PULSE_S + arc.phase) % 1 + 1) % 1;
          const k = t * (arc.pts.length - 1);
          const k0 = Math.floor(k), k1 = Math.min(arc.pts.length - 1, k0 + 1), f = k - k0;
          const a = vs[k0], b = vs[k1];
          if (a && b) {
            const v = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
            if (!hidden(v)) {
              ctx.globalAlpha = depth(v.z);
              ctx.fillStyle = ink;
              ctx.beginPath();
              ctx.arc(cx + R * v.x, cy - R * v.y, 2.2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        // the top routes are labelled at their target, or at their origin when the target already carries a label
        if (i < LABELLED) {
          const end = vs[vs.length - 1], start = vs[0];
          const at = [end, start].find((v) => v && !hidden(v) && !labelled.some((l) => Math.abs(l.at.x - v.x) * R < 90 && Math.abs(l.at.y - v.y) * R < 14));
          if (at) labelled.push({ route: arc.route, at });
        }
      });
      ctx.globalAlpha = 1;

      if (R >= 90) {
        ctx.font = `12px ${mono}`;
        ctx.textBaseline = "middle";
        for (const { route, at } of labelled) {
          const x = cx + R * at.x, y = cy - R * at.y;
          const right = at.x < 0.35;
          ctx.textAlign = right ? "left" : "right";
          const label = `${route.origin} → ${route.target}`;
          const lx = right ? x + 7 : x - 7;
          ctx.fillStyle = "rgba(7,9,14,0.85)";
          const tw = ctx.measureText(label).width;
          ctx.fillRect(right ? lx - 2 : lx - tw - 2, y - 7, tw + 4, 14);
          ctx.fillStyle = ink;
          ctx.fillText(label, lx, y);
        }
        ctx.fillStyle = dim;
      }
    };

    const frame = (ms: number) => {
      raf = 0;
      if (ms - lastFrame >= FRAME_MS - 1) {
        const dt = lastTick ? Math.min(0.1, (ms - lastTick) / 1000) : 0;
        lastTick = ms;
        lastFrame = ms;
        if (!drag && ms / 1000 - dragEnd > RESUME_S) spin += ((Math.PI * 2) / TURN_S) * dt;
        draw(ms / 1000);
      }
      if (runningRef.current && visible && !still) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (still || !runningRef.current) draw(0);
      else if (!raf && visible) raf = requestAnimationFrame(frame);
    };
    kickRef.current = kick;
    // the view centre sits at longitude 90° - spin (see `view`); offset a little west so the arcs' origins share the frame
    faceRef.current = (lon10) => {
      spin = Math.PI / 2 - (lon10 / 10) * (Math.PI / 180) - 0.35;
      draw(performance.now() / 1000);
    };

    const ro = new ResizeObserver(() => {
      layout();
      draw(performance.now() / 1000);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      kick();
    });
    io.observe(canvas);

    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, spin, tilt };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      spin = drag.spin + (e.clientX - drag.x) / R;
      tilt = Math.max(-1.1, Math.min(1.1, drag.tilt + (e.clientY - drag.y) / R));
      if (still || !runningRef.current) draw(0);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      drag = null;
      dragEnd = performance.now() / 1000;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = "grab";
    };
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      kickRef.current = () => {};
      faceRef.current = () => {};
    };
  }, []);

  return (
    <figure className={`relative m-0 ${className}`}>
      <figcaption className="sr-only">
        Globe of the top layer 7 attack routes in the last hour, from Cloudflare Radar: each arc runs from the attacking country to the attacked one.
      </figcaption>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block h-full w-full touch-none select-none" />
      <span className="pointer-events-none absolute right-0 bottom-0 font-mono text-[12px] text-faint">Made with Natural Earth</span>
    </figure>
  );
}
