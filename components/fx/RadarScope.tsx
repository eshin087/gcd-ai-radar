"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CompactRow } from "@/lib/dashboard";
import { FAMILIES, FAMILY_META, familyOf, type Family } from "@/lib/families";
import { SEVERITY_META, type Severity } from "@/lib/taxonomy";
import { prefersReducedMotion } from "./useReducedMotion";

/**
 * A plan-position radar scope whose blips are real incidents.
 *   bearing  = category family (one sector each, labelled on the rim)
 *   distance = age: centre is today, the rim is `days` ago
 *   size     = number of sources; brightness and halo = severity
 * The sweep makes each blip flare as it passes, like a PPI display.
 */

interface Blip {
  row: CompactRow;
  family: Family;
  angle: number;
  r: number;
  size: number;
  sev: Severity;
}

interface Props {
  rows: CompactRow[];
  now: string;
  days?: number;
  accent: string;
  ring: string;
  label: string;
  severity: Record<Severity, string>;
  onSelect?: (row: CompactRow) => void;
  /** Highlight one family's sector (e.g. from a legend hover). */
  focus?: Family | null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const TAU = Math.PI * 2;
const SECTOR = TAU / FAMILIES.length;
/** Sector 0 starts at the top (12 o'clock) and runs clockwise. */
const START = -Math.PI / 2;

export function RadarScope({ rows, now, days = 90, accent, ring, label, severity, onSelect, focus = null }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ blip: Blip; x: number; y: number } | null>(null);

  const blips = useMemo<Blip[]>(() => {
    const t = Date.parse(now);
    const out: Blip[] = [];
    for (const row of rows) {
      const age = (t - Date.parse(`${row.first_reported}T12:00:00Z`)) / 86400000;
      if (age < 0 || age > days) continue;
      const family = familyOf(row.categories[0] ?? "other");
      const idx = FAMILIES.indexOf(family);
      const jitter = 0.12 + 0.76 * hash(row.id);
      out.push({
        row,
        family,
        angle: START + (idx + jitter) * SECTOR,
        r: 0.07 + 0.88 * (age / days) + (hash(row.slug) - 0.5) * 0.02,
        size: 1.6 + Math.log2(1 + row.source_count) * 1.25,
        sev: row.severity,
      });
    }
    return out.sort((a, b) => a.sev - b.sev);
  }, [rows, now, days]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of blips) m[b.family] = (m[b.family] ?? 0) + 1;
    return m;
  }, [blips]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = prefersReducedMotion();
    let raf = 0;
    let size = 0;
    let dpr = 1;
    let base: HTMLCanvasElement | null = null;
    let visible = true;
    let margin = 34;
    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-plex-mono").trim() || "monospace";

    const drawBase = () => {
      const b = document.createElement("canvas");
      b.width = canvas.width;
      b.height = canvas.height;
      const g = b.getContext("2d")!;
      g.scale(dpr, dpr);
      const c = size / 2;
      const R = size / 2 - margin;
      // faint glyph noise in the background: ASCII texture
      g.font = `500 9px ${fontFamily}`;
      g.fillStyle = rgba(ring, 0.16);
      for (let i = 0; i < 420; i++) {
        const a = hash(`a${i}`) * TAU;
        const rr = Math.sqrt(hash(`r${i}`)) * R;
        g.fillText(hash(`g${i}`) > 0.5 ? "·" : "+", c + Math.cos(a) * rr, c + Math.sin(a) * rr);
      }
      // rings
      g.lineWidth = 1;
      for (let k = 1; k <= 3; k++) {
        g.strokeStyle = rgba(ring, k === 3 ? 0.55 : 0.28);
        g.beginPath();
        g.arc(c, c, (R * k) / 3, 0, TAU);
        g.stroke();
      }
      // sector spokes
      g.strokeStyle = rgba(ring, 0.18);
      for (let i = 0; i < FAMILIES.length; i++) {
        const a = START + i * SECTOR;
        g.beginPath();
        g.moveTo(c + Math.cos(a) * R * 0.07, c + Math.sin(a) * R * 0.07);
        g.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
        g.stroke();
      }
      // bearing ticks
      for (let d = 0; d < 360; d += 5) {
        const a = (d * Math.PI) / 180;
        const len = d % 45 === 0 ? 9 : d % 15 === 0 ? 5 : 2.5;
        g.strokeStyle = rgba(ring, d % 15 === 0 ? 0.6 : 0.3);
        g.beginPath();
        g.moveTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
        g.lineTo(c + Math.cos(a) * (R + len), c + Math.sin(a) * (R + len));
        g.stroke();
      }
      // ring labels
      g.fillStyle = rgba(ring, 0.75);
      g.font = `500 10px ${fontFamily}`;
      g.textAlign = "left";
      for (let k = 1; k <= 3; k++) g.fillText(`${Math.round((days * k) / 3)}d`, c + 4, c - (R * k) / 3 + 12);
      // sector labels on the rim
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `500 ${size < 480 ? 9 : 10.5}px ${fontFamily}`;
      for (let i = 0; i < FAMILIES.length; i++) {
        const f = FAMILIES[i]!;
        const a = START + (i + 0.5) * SECTOR;
        const lx = c + Math.cos(a) * (R + (size < 480 ? 18 : 22));
        const ly = c + Math.sin(a) * (R + (size < 480 ? 14 : 22));
        g.fillStyle = f === focus ? accent : rgba(ring, 0.95);
        g.fillText(FAMILY_META[f].short.toUpperCase(), lx, ly);
      }
      // centre
      g.strokeStyle = rgba(accent, 0.7);
      g.beginPath();
      g.moveTo(c - 6, c);
      g.lineTo(c + 6, c);
      g.moveTo(c, c - 6);
      g.lineTo(c, c + 6);
      g.stroke();
      if (focus) {
        const i = FAMILIES.indexOf(focus);
        g.fillStyle = rgba(accent, 0.06);
        g.beginPath();
        g.moveTo(c, c);
        g.arc(c, c, R, START + i * SECTOR, START + (i + 1) * SECTOR);
        g.closePath();
        g.fill();
      }
      return b;
    };

    const layout = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = Math.min(wrap.clientWidth, 560);
      margin = size < 480 ? 56 : 40;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      base = drawBase();
    };
    layout();

    const t0 = performance.now();
    const period = 6.5;
    const frame = (t: number) => {
      const s = (t - t0) / 1000;
      const sweep = reduced ? START + 0.0001 : START + ((s % period) / period) * TAU;
      const c = size / 2;
      const R = size / 2 - margin;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (base) ctx.drawImage(base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!reduced) {
        // sweep trail
        const trail = 1.1;
        const grad = ctx.createConicGradient(sweep - trail, c, c);
        grad.addColorStop(0, rgba(accent, 0));
        grad.addColorStop(trail / TAU, rgba(accent, 0.22));
        grad.addColorStop(trail / TAU + 0.0001, rgba(accent, 0));
        grad.addColorStop(1, rgba(accent, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, R, sweep - trail, sweep);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgba(accent, 0.85);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(c + Math.cos(sweep) * R, c + Math.sin(sweep) * R);
        ctx.stroke();
      }
      // blips
      for (const b of blips) {
        const since = reduced ? 1 : (((sweep - b.angle) % TAU) + TAU) % TAU;
        const flare = reduced ? 0.75 : 0.28 + 0.72 * Math.exp(-since * 0.9);
        const x = c + Math.cos(b.angle) * b.r * R;
        const y = c + Math.sin(b.angle) * b.r * R;
        const col = severity[b.sev];
        const dim = focus && b.family !== focus ? 0.25 : 1;
        if (b.sev >= 3) {
          ctx.fillStyle = rgba(col, 0.16 * flare * dim);
          ctx.beginPath();
          ctx.arc(x, y, b.size * 2.6, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = rgba(col, Math.min(1, flare * dim));
        ctx.beginPath();
        ctx.arc(x, y, b.size, 0, TAU);
        ctx.fill();
        if (b.sev === 4 && !reduced) {
          const pulse = (s * 0.8 + hash(b.row.id)) % 1;
          ctx.strokeStyle = rgba(col, (1 - pulse) * 0.6 * dim);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, b.size + pulse * 12, 0, TAU);
          ctx.stroke();
        }
      }
      if (!reduced && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const pick = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const c = size / 2;
      const R = size / 2 - margin;
      let best: Blip | null = null;
      let bestD = 14 * 14;
      for (const b of blips) {
        const bx = c + Math.cos(b.angle) * b.r * R;
        const by = c + Math.sin(b.angle) * b.r * R;
        const d = (bx - x) ** 2 + (by - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      if (!best) return null;
      const offset = rect.left - wrap.getBoundingClientRect().left;
      return { blip: best, x: offset + c + Math.cos(best.angle) * best.r * R, y: c + Math.sin(best.angle) * best.r * R };
    };
    const onMove = (e: PointerEvent) => {
      const hit = pick(e.clientX, e.clientY);
      canvas.style.cursor = hit ? "pointer" : "crosshair";
      setHover(hit);
    };
    const onLeave = () => setHover(null);
    const onClick = (e: MouseEvent) => {
      const hit = pick(e.clientX, e.clientY);
      if (hit && onSelect) onSelect(hit.blip.row);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick);
    const ro = new ResizeObserver(() => {
      layout();
      if (reduced) frame(performance.now());
    });
    ro.observe(wrap);
    const io = new IntersectionObserver((entries) => {
      const was = visible;
      visible = entries.some((e) => e.isIntersecting);
      if (visible && !was && !reduced) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      }
    });
    io.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
    };
  }, [blips, accent, ring, severity, days, onSelect, focus]);

  const total = blips.length;
  return (
    <div ref={wrapRef} className="relative w-full flex justify-center">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${label}: ${total} incidents in the last ${days} days. ${FAMILIES.map((f) => `${FAMILY_META[f].label} ${counts[f] ?? 0}`).join(", ")}.`}
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-64 -translate-x-1/2 rounded-[3px] border border-line bg-panel-2/95 px-3 py-2 text-[12px] shadow-xl backdrop-blur"
          style={{ left: hover.x, top: hover.y + 14 }}
        >
          <div className="num text-[11px] text-dim">
            {hover.blip.row.first_reported} · sev {hover.blip.sev} {SEVERITY_META[hover.blip.sev].short} · {FAMILY_META[hover.blip.family].short}
          </div>
          <div className="mt-0.5 text-ink leading-snug">{hover.blip.row.title}</div>
          <div className="num mt-1 text-[10.5px] text-faint">{hover.blip.row.source_count} sources · click to open</div>
        </div>
      )}
    </div>
  );
}
