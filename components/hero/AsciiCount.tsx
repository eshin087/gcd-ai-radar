"use client";

import { useEffect, useRef } from "react";
import { BUILD_GLYPHS, CELL_STEP_MS, motionOn } from "@/components/fx/ascii";
import { useBuild } from "@/components/home/panel/useBuild";

/**
 * A count drawn as a large dot-matrix numeral: a 5x7 grid of character cells
 * per digit, the lit cells solid squares, the dark ones faint middle dots.
 * When its section builds (and again when the value changes) the lit cells
 * assemble through · : + before they fill, sweeping left to right with a
 * little jitter, in about half a second; then nothing runs until the next
 * change. Without motion it draws the final numeral at once. The canvas is
 * decoration: the number itself is in the text beside it for assistive tech.
 */

/** 5x7 glyphs, rows top to bottom, "1" a lit cell. */
const GLYPHS: Record<string, string[]> = {
  "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ",": ["00000", "00000", "00000", "00000", "00110", "00010", "00100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
};
const ROWS = 7;
/** Milliseconds between one column starting and the next, and the most a cell's start is jittered. */
const COL_MS = 26;
const JITTER_MS = 90;

interface Cell {
  x: number;
  y: number;
  lit: boolean;
  /** Milliseconds after the build starts that this cell begins to assemble. */
  delay: number;
}

/** The cells of `text`, one blank column between characters. */
function layout(text: string): { cells: Cell[]; cols: number } {
  const cells: Cell[] = [];
  let col = 0;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS["-"]!;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < 5; x++) cells.push({ x: col + x, y, lit: g[y]![x] === "1", delay: (col + x) * COL_MS + Math.random() * JITTER_MS });
    col += 6;
  }
  return { cells, cols: Math.max(0, col - 1) };
}

export function AsciiCount({ value, cell = 11, className = "" }: { value: number | null; cell?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const start = useRef<(instant: boolean) => void>(() => {});
  const built = useRef(false);
  const text = value === null ? "-" : value.toLocaleString("en-US");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { cells, cols } = layout(text);
    const css = getComputedStyle(canvas);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const lit = color("--color-accent", "#ffb35c"), dark = color("--color-faint", "#596278");
    const font = `${Math.round(cell * 0.95)}px ${css.getPropertyValue("--font-plex-mono").trim() || "ui-monospace"}, monospace`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cols * cell, h = ROWS * cell;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let raf = 0;

    /** One frame `ms` into the build; returns whether any cell is still assembling. */
    const paint = (ms: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let busy = false;
      for (const c of cells) {
        const cx = c.x * cell + cell / 2, cy = c.y * cell + cell / 2;
        const step = Math.floor((ms - c.delay) / CELL_STEP_MS);
        if (!c.lit || step < 0) {
          // the matrix: a faint dot where nothing is lit (yet)
          ctx.globalAlpha = c.lit ? 0.5 : 0.35;
          ctx.fillStyle = dark;
          ctx.fillText("·", cx, cy);
          if (c.lit) busy = true;
          continue;
        }
        if (step < BUILD_GLYPHS.length) {
          busy = true;
          ctx.globalAlpha = 0.55 + 0.15 * step;
          ctx.fillStyle = lit;
          ctx.fillText(BUILD_GLYPHS[step]!, cx, cy);
          continue;
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = lit;
        const s = cell - 2;
        ctx.fillRect(c.x * cell + 1, c.y * cell + 1, s, s);
      }
      ctx.globalAlpha = 1;
      return busy;
    };

    start.current = (instant: boolean) => {
      cancelAnimationFrame(raf);
      if (instant || !motionOn()) {
        paint(Infinity);
        return;
      }
      let t0 = 0;
      const frame = (t: number) => {
        t0 ||= t;
        if (paint(t - t0)) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };
    // the first draw waits for the section to build; a later value change rebuilds at once
    if (built.current) start.current(false);
    else paint(0);
    return () => cancelAnimationFrame(raf);
  }, [text, cell]);

  useBuild(ref, (instant) => {
    built.current = true;
    start.current(instant);
  });

  return <canvas ref={ref} aria-hidden className={`block ${className}`} />;
}
