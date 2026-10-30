"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useJson } from "@/components/home/useJson";
import { FAMILY_COLORS, FAMILY_META } from "@/lib/families";
import { SEVERITY_COLORS } from "@/lib/palette";
import type { ScopeBlip, ScopeHead } from "@/lib/scope";
import { SEVERITY_META, type Severity } from "@/lib/taxonomy";
import { THEME as T } from "@/lib/theme";

/** The palette's darkest severity step vanishes at blip size, so research blips take a muted tone of the same ramp. */
const BLIP_COLORS: Record<Severity, string> = { ...SEVERITY_COLORS, 1: "#857158" };
const BLIP_R: Record<Severity, number> = { 1: 1.8, 2: 2.3, 3: 3.2, 4: 4.3 };
/** Seconds for one pass of the sector scan, left to right or back. */
const PASS = 4.6;
/** Labelled rings inside the outer one (days since first report). */
const RINGS = [1, 7, 30];
/** Below this width the wedge labels give way to the scope alone. */
const NARROW = 520;

const ago = (a: number) => (a <= 0 ? "today" : a === 1 ? "1 day ago" : `${a} days ago`);
/** Until fetched blips arrive: one array, so the drawing effect does not run again for nothing. */
const NO_BLIPS: ScopeBlip[] = [];

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

interface Placed {
  b: ScopeBlip;
  ang: number;
  x: number;
  y: number;
  r: number;
  /** Time the sweep last crossed it, in seconds. */
  lit: number;
}

interface Tip {
  b: ScopeBlip;
  /**
   * Placement inside the figure: above the pointer (the scope sits on the
   * hero's bottom edge, where the page covers anything lower), below it near
   * the top, and flipped to its left near the right edge.
   */
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  pinned: boolean;
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-1 font-mono text-[12px] leading-none whitespace-nowrap"
      style={{ color: `color-mix(in oklab, ${color} 72%, white)`, background: `color-mix(in oklab, ${color} 16%, transparent)`, border: `1px solid color-mix(in oklab, ${color} 50%, transparent)` }}
    >
      {label}
    </span>
  );
}

/**
 * The hero's radar: a sector scope of every incident first reported in the
 * last 120 days (lib/scope.ts). A blip's wedge is its attack family, its
 * distance from the centre is its age on a square-root scale (where it sits
 * inside its wedge is spread for legibility and means nothing). The sweep
 * lights blips as it passes. Hover shows a blip, a click opens its incident.
 * `side` fills a 280 px column on the left once the figure is 600 px wide
 * (the home page puts the hero cluster there, ./RadarCluster.tsx); the scope
 * takes the rest. Canvas 2D, paused off screen, when `running` is false, and
 * still under reduced motion. A page that does not carry the blips passes
 * `src` (the home page, lib/scope.ts SCOPE_FILE): the frame draws at once,
 * the blips when they arrive.
 */
export function ThreatScope({ scope, src, running, side, className = "" }: { scope: ScopeHead & { blips?: ScopeBlip[] }; src?: string; running: boolean; side?: ReactNode; className?: string }) {
  const router = useRouter();
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<Tip | null>(null);
  const runningRef = useRef(running);
  const kickRef = useRef<() => void>(() => {});
  const fetched = useJson<{ blips: ScopeBlip[] }>(scope.blips || !src ? null : src);
  const blips = scope.blips ?? fetched.data?.blips ?? NO_BLIPS;
  const { days, wedges } = scope;

  useEffect(() => {
    runningRef.current = running;
    kickRef.current();
  }, [running]);
  useEffect(() => {
    tipRef.current = tip;
  }, [tip]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!root || !canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(canvas);
    const sans = `${css.getPropertyValue("--font-inter").trim() || "ui-sans-serif"}, system-ui, sans-serif`;
    const mono = `${css.getPropertyValue("--font-plex-mono").trim() || "ui-monospace"}, monospace`;
    const ageR = (a: number) => Math.sqrt((Math.max(0, a) + 0.7) / (days + 0.7));
    const sw = Math.PI / wedges.length;

    let w = 0, h = 0, R = 0, cx = 0, cy = 0, narrow = false;
    let placed: Placed[] = [];
    let prev: number | null = null;
    let hover: ScopeBlip | null = null;
    let raf = 0, visible = false;
    const t0 = performance.now();

    const layout = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      narrow = w < NARROW;
      // the side column, when it shows (CSS decides), holds the left; the scope and its wedge labels the rest
      const sideW = sideRef.current?.offsetWidth ?? 0;
      const side = sideW ? sideW + 18 : 0;
      R = Math.max(40, Math.min(h - (narrow ? 30 : 52), (w - side - (narrow ? 24 : 150)) / 2));
      cx = side + (w - side) / 2;
      cy = h - (narrow ? 20 : 26);
      placed = blips
        .map((b) => {
          const ang = Math.PI + (Math.max(0, wedges.indexOf(b.family)) + 0.13 + 0.74 * hash01(b.slug)) * sw;
          const rr = R * Math.min(0.985, ageR(b.age + (hash01(`${b.slug}r`) - 0.5) * 0.9));
          return { b, ang, x: cx + rr * Math.cos(ang), y: cy + rr * Math.sin(ang), r: BLIP_R[b.severity], lit: -99 };
        })
        .sort((p, q) => p.b.severity - q.b.severity);
    };

    const ring = (x: number, y: number, r: number, color: string, alpha: number, width = 1) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, w, h);
      const p = (time / PASS) % 2;
      const ang = still ? Math.PI * 1.62 : Math.PI + Math.PI * (p < 1 ? p : 2 - p);
      const from = prev ?? ang;
      const dir = ang >= from ? 1 : -1;
      if (!still && Math.abs(ang - from) < 0.6) {
        const lo = Math.min(from, ang), hi = Math.max(from, ang);
        for (const bl of placed) if (bl.ang >= lo && bl.ang <= hi) bl.lit = time;
      }
      prev = ang;

      // rings at 1, 7, 30 days and the window's edge, labelled along the left baseline
      ctx.font = `12px ${mono}`;
      ctx.textBaseline = "top";
      for (const a of [...RINGS, days]) {
        const rr = R * ageR(a);
        const edge = a === days;
        ctx.strokeStyle = edge ? "rgba(140,160,210,.34)" : "rgba(140,160,210,.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, Math.PI, Math.PI * 2);
        ctx.stroke();
        if (a === 1 && rr <= 34) continue; // "1 d" only where it clears "now"
        ctx.fillStyle = T.dim;
        ctx.textAlign = edge && narrow ? "left" : "center";
        ctx.fillText(`${a} d`, edge && narrow ? Math.max(0, cx - rr - 4) : cx - rr, cy + 7);
      }
      ctx.strokeStyle = "rgba(140,160,210,.34)";
      ctx.beginPath();
      ctx.moveTo(cx - R, cy + 0.5);
      ctx.lineTo(cx + R, cy + 0.5);
      ctx.stroke();

      // family wedges and their labels
      ctx.strokeStyle = "rgba(140,160,210,.11)";
      for (let i = 1; i < wedges.length; i++) {
        const a = Math.PI + i * sw;
        ctx.beginPath();
        ctx.moveTo(cx + R * 0.08 * Math.cos(a), cy + R * 0.08 * Math.sin(a));
        ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
        ctx.stroke();
      }
      if (!narrow) {
        ctx.font = `500 12px ${sans}`;
        wedges.forEach((f, i) => {
          const a = Math.PI + (i + 0.5) * sw;
          const c = Math.cos(a), s = Math.sin(a);
          // only a label straight up is centred: with an even number of wedges the two beside the top would overlap
          ctx.textAlign = c < -0.05 ? "right" : c > 0.05 ? "left" : "center";
          ctx.textBaseline = s < -0.9 ? "bottom" : "middle";
          ctx.fillStyle = FAMILY_COLORS[f];
          ctx.fillText(FAMILY_META[f].short, cx + (R + 9) * c, cy + (R + 9) * s);
        });
      }

      // the sweep with its fading wedge
      if (!still) {
        const trail = 0.46, steps = 16;
        for (let k = 0; k < steps; k++) {
          const a0 = ang - dir * trail * (k / steps), a1 = ang - dir * trail * ((k + 1) / steps);
          const lo = Math.max(Math.PI, Math.min(a0, a1)), hi = Math.min(Math.PI * 2, Math.max(a0, a1));
          if (hi <= lo) continue;
          ctx.fillStyle = `rgba(255,179,92,${(0.12 * (1 - k / steps)).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, R, lo, hi);
          ctx.closePath();
          ctx.fill();
        }
        ctx.strokeStyle = "rgba(255,179,92,.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + R * Math.cos(ang), cy + R * Math.sin(ang));
        ctx.stroke();
      }

      // blips: brighter when freshly swept, a ping ring for exploited or worse
      for (const bl of placed) {
        const since = time - bl.lit;
        const glow = !still && since >= 0 && since < 8 ? Math.exp(-since / 1.7) : 0;
        ctx.globalAlpha = Math.min(1, (bl.b.severity >= 3 ? 0.7 : 0.5) + 0.5 * glow);
        ctx.fillStyle = BLIP_COLORS[bl.b.severity];
        ctx.beginPath();
        ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI * 2);
        ctx.fill();
        if (!still && bl.b.severity >= 3 && since >= 0 && since < 1.8) ring(bl.x, bl.y, bl.r + 2 + (since / 1.8) * 10, BLIP_COLORS[bl.b.severity], (1 - since / 1.8) * 0.75);
      }
      ctx.globalAlpha = 1;
      const shown = tipRef.current?.b ?? hover;
      if (shown) {
        const bl = placed.find((x) => x.b === shown);
        if (bl) ring(bl.x, bl.y, bl.r + 4, T.ink, 1, 1.5);
      }
      ctx.fillStyle = T.accent;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `12px ${mono}`;
      ctx.fillStyle = "#c3cbe0";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("now", cx, cy + 7);
    };

    const frame = (ms: number) => {
      raf = 0;
      draw((ms - t0) / 1000);
      if (runningRef.current && visible && !still) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (still) draw(0);
      else if (!raf && runningRef.current && visible) raf = requestAnimationFrame(frame);
    };
    kickRef.current = kick;

    const ro = new ResizeObserver(() => {
      layout();
      draw((performance.now() - t0) / 1000);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      kick();
    });
    io.observe(canvas);

    const pick = (x: number, y: number) => {
      let best: ScopeBlip | null = null;
      let bd = 81;
      for (const bl of placed) {
        const d = (bl.x - x) ** 2 + (bl.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = bl.b;
        }
      }
      return best;
    };
    const local = (e: PointerEvent | MouseEvent) => {
      const c = canvas.getBoundingClientRect(), r = root.getBoundingClientRect();
      return { x: e.clientX - c.left, y: e.clientY - c.top, rx: e.clientX - r.left, ry: e.clientY - r.top, rw: r.width, rh: r.height };
    };
    const tipAt = (b: ScopeBlip, p: ReturnType<typeof local>, pinned: boolean): Tip => ({
      b,
      pinned,
      ...(p.rx > p.rw - 300 ? { right: Math.max(4, p.rw - p.rx + 14) } : { left: p.rx + 14 }),
      ...(p.ry > 130 ? { bottom: p.rh - p.ry + 14 } : { top: p.ry + 16 }),
    });
    let pointerType = "mouse";
    const onDown = (e: PointerEvent) => {
      pointerType = e.pointerType;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const p = local(e);
      const b = pick(p.x, p.y);
      hover = b;
      canvas.style.cursor = b ? "pointer" : "";
      if (tipRef.current?.pinned) return;
      setTip(b ? tipAt(b, p, false) : null);
      if (still) draw(0);
    };
    const onLeave = () => {
      hover = null;
      if (!tipRef.current?.pinned) setTip(null);
      if (still) draw(0);
    };
    const onClick = (e: MouseEvent) => {
      const p = local(e);
      const b = pick(p.x, p.y);
      if (b && pointerType === "mouse") router.push(`/incidents/${b.slug}`);
      else setTip(b ? tipAt(b, p, true) : null);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      kickRef.current = () => {};
    };
  }, [days, wedges, blips, router]);

  // a pinned tip (touch) closes on a tap anywhere else
  useEffect(() => {
    if (!tip?.pinned) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setTip(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [tip]);

  return (
    <figure ref={rootRef} className={`@container relative m-0 ${className}`}>
      <figcaption className="sr-only">
        Radar scope of the {scope.total} incidents first reported in the last {scope.days} days: each blip sits in the wedge of its attack family, closer to the centre the more recent it is.
      </figcaption>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block h-full w-full touch-manipulation" />
      {side && (
        <div ref={sideRef} className="absolute inset-y-0 left-0 hidden w-[280px] @min-[600px]:block">
          {side}
        </div>
      )}
      {tip && (
        <div
          role="tooltip"
          className={`absolute z-20 w-max max-w-[min(320px,88%)] rounded-lg border bg-[#0d1220] px-3 py-2.5 text-[13px] leading-snug shadow-[0_14px_34px_-12px_rgba(0,0,0,0.85)] ${tip.pinned ? "border-[color:var(--color-accent)]" : "pointer-events-none border-line"}`}
          style={{ left: tip.left, right: tip.right, top: tip.top, bottom: tip.bottom }}
        >
          <span className="mb-1.5 flex flex-wrap gap-1.5">
            <Chip label={SEVERITY_META[tip.b.severity].short} color={BLIP_COLORS[tip.b.severity]} />
            <Chip label={FAMILY_META[tip.b.family].short} color={FAMILY_COLORS[tip.b.family]} />
          </span>
          <span className="block text-ink">{tip.b.title}</span>
          <span className="mt-1.5 block font-mono text-[12px] text-dim">first reported {ago(tip.b.age)}</span>
          {tip.pinned && (
            <Link href={`/incidents/${tip.b.slug}`} className="mt-2 inline-block text-accent hover:underline">
              Open incident →
            </Link>
          )}
        </div>
      )}
    </figure>
  );
}
