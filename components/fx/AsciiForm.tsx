"use client";

import { Fragment, useEffect, useRef, type ElementType } from "react";
import { prefersReducedMotion } from "./useReducedMotion";

/** Glyphs by density, lightest first; a grid cell climbs this ramp as its letter fills in. */
const RAMP = ["·", ":", "+", "*", "#"];
/** Frames each character passes through before it lands as itself. */
const STEPS = 7;
/** Samples per grid cell side when a letter's shape is read off the canvas. */
const SUB = 6;

interface Props {
  text: string;
  as?: "span" | "h1" | "h2" | "h3" | "p" | "div";
  className?: string;
  /** ms before the wave starts */
  delay?: number;
  /** total ms for the whole line */
  duration?: number;
  /** Start when scrolled into view instead of on mount. */
  onView?: boolean;
}

interface Face {
  family: string;
  weight: string;
  px: number;
  ascent: number;
}

/** Letter shapes read off a canvas, keyed by glyph, face and grid. */
const shapes = new Map<string, Float32Array>();
let scratch: HTMLCanvasElement | null = null;

/**
 * Coverage of one letter over a cols × rows grid: the letter is drawn at its
 * real face into a small canvas the size of the grid and each cell keeps the
 * mean alpha under it, so the micro-glyphs follow the letter's own strokes.
 */
function shapeOf(ch: string, face: Face, boxW: number, boxH: number, cols: number, rows: number): Float32Array {
  const key = `${ch}|${face.family}|${face.weight}|${Math.round(boxW)}x${Math.round(boxH)}|${cols}x${rows}`;
  const hit = shapes.get(key);
  if (hit) return hit;
  const out = new Float32Array(cols * rows);
  const W = cols * SUB;
  const H = rows * SUB;
  scratch ??= document.createElement("canvas");
  scratch.width = W;
  scratch.height = H;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return out;
  ctx.setTransform(W / boxW, 0, 0, H / boxH, 0, 0);
  ctx.clearRect(0, 0, boxW, boxH);
  ctx.font = `${face.weight} ${face.px}px ${face.family}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  ctx.fillText(ch, 0, face.ascent);
  const data = ctx.getImageData(0, 0, W, H).data;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let y = 0; y < SUB; y++) for (let x = 0; x < SUB; x++) sum += data[((r * SUB + y) * W + c * SUB + x) * 4 + 3]!;
      out[r * cols + c] = sum / (SUB * SUB * 255);
    }
  }
  shapes.set(key, out);
  return out;
}

/** Deterministic 0..1 per grid cell, so the dust around a letter is the same on every run. */
function hash(r: number, c: number): number {
  let h = (r * 73856093) ^ (c * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * The frame of one letter at a given step: inside the strokes the glyphs climb
 * the density ramp as the letter fills in; a sparse dust of dots around it
 * thins out until only the letter is left.
 */
function frameOf(shape: Float32Array, cols: number, rows: number, step: number): string {
  const p = (step + 1) / STEPS;
  let s = "";
  for (let r = 0; r < rows; r++) {
    if (r) s += "\n";
    for (let c = 0; c < cols; c++) {
      const v = shape[r * cols + c]!;
      if (v >= 0.1) s += RAMP[Math.min(RAMP.length - 1, Math.floor(Math.min(0.999, v * p) * RAMP.length))]!;
      else if (v < 0.04 && hash(r, c) < 0.3 * (1 - p)) s += "·";
      else s += " ";
    }
  }
  return s;
}

/**
 * Text that forms out of tiny ASCII characters: every letter is first drawn
 * as a small raster of mono glyphs shaped like the letter itself, the glyphs
 * climb · : + * # as the letter fills in, then the real character lands with
 * a short accent glow. The wave runs left to right across the line. The real
 * characters keep their layout the whole time (the glyphs are drawn over
 * them), so nothing shifts. Runs once; instant under reduced motion. Server
 * HTML carries the final text.
 */
export function AsciiForm({ text, as = "span", className = "", delay = 0, duration = 1500, onView = false }: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const finish = () => {
      delete el.dataset.forming;
      delete el.dataset.pending;
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    const cells = Array.from(el.querySelectorAll<HTMLElement>("[data-c]"));
    const n = cells.length || 1;
    const wave = duration * 0.5; // spread of start times across the line
    const climb = duration * 0.5; // time each character spends forming
    const starts = cells.map((_, i) => (i / n) * wave + (((i * 7919) % 13) / 13) * 60);
    const step = new Int8Array(cells.length).fill(-1);
    const frames: string[][] = [];
    let raf = 0;
    let started = false;
    let cancelled = false;

    /** Reads the face and each cell's box once, and builds every frame up front. */
    const prepare = () => {
      const cs = getComputedStyle(el);
      const px = parseFloat(cs.fontSize) || 16;
      const face: Face = { family: cs.fontFamily, weight: cs.fontWeight, px, ascent: px * 0.8 };
      scratch ??= document.createElement("canvas");
      const ctx = scratch.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.font = `${face.weight} ${px}px ${face.family}`;
        const m = ctx.measureText("Hg");
        if (m.fontBoundingBoxAscent) face.ascent = m.fontBoundingBoxAscent;
      }
      const micro = Math.min(13, Math.max(5, px * 0.17));
      el.style.setProperty("--ascii-mf", `${micro.toFixed(2)}px`);
      cells.forEach((cell, i) => {
        const r = cell.getBoundingClientRect();
        const cols = Math.min(10, Math.max(1, Math.round(r.width / (micro * 0.6))));
        const rows = Math.min(12, Math.max(2, Math.round(r.height / micro)));
        const shape = shapeOf(cell.textContent ?? "", face, Math.max(1, r.width), Math.max(1, r.height), cols, rows);
        frames[i] = Array.from({ length: STEPS }, (_, s) => frameOf(shape, cols, rows, s));
      });
    };

    const run = () => {
      if (started || cancelled) return;
      started = true;
      prepare();
      el.dataset.forming = "1";
      delete el.dataset.pending;
      const t0 = performance.now() + delay;
      const tick = (now: number) => {
        const t = now - t0;
        let done = 0;
        for (let i = 0; i < cells.length; i++) {
          const local = (t - starts[i]!) / climb;
          const s = local < 0 ? -1 : local >= 1 ? STEPS : Math.floor(local * STEPS);
          if (s === step[i]) {
            if (s === STEPS) done++;
            continue;
          }
          step[i] = s;
          const cell = cells[i]!;
          if (s >= STEPS) {
            delete cell.dataset.g;
            cell.dataset.done = "1";
            done++;
          } else if (s >= 0) cell.dataset.g = frames[i]![s]!;
        }
        if (done < cells.length) raf = requestAnimationFrame(tick);
        else {
          finish();
          for (const cell of cells) delete cell.dataset.done;
        }
      };
      raf = requestAnimationFrame(tick);
    };

    const reset = () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      finish();
      for (const cell of cells) {
        delete cell.dataset.g;
        delete cell.dataset.done;
      }
    };
    // The letter shapes are read off the real face, so wait briefly for the web font.
    const whenFonts = (go: () => void) => {
      let fired = false;
      const once = () => {
        if (!fired) {
          fired = true;
          go();
        }
      };
      const ready = document.fonts?.ready;
      if (ready) void ready.then(once);
      window.setTimeout(once, 700);
    };
    if (!onView) {
      whenFonts(run);
      return reset;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          whenFonts(run);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      reset();
    };
  }, [text, delay, duration, onView]);

  const Tag = as as ElementType;
  const words = text.split(" ");
  return (
    // data-pending hides the characters from first paint until the wave runs (app/page.tsx shows them without JS)
    <Tag ref={ref} className={`ascii-form ${className}`} aria-label={text} data-pending="1">
      {words.map((w, wi) => (
        <Fragment key={wi}>
          {wi > 0 && " "}
          <span aria-hidden className="whitespace-nowrap">
            {[...w].map((ch, ci) => (
              <span key={ci} data-c="">
                {ch}
              </span>
            ))}
          </span>
        </Fragment>
      ))}
    </Tag>
  );
}
