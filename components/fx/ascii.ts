/**
 * The home page's ASCII motion vocabulary. Marks assemble through · : + before
 * they fill; numbers dissolve into place through % + : ·, settling left to
 * right; the pulse breathes · • ● •. Nothing here draws a glyph outside these
 * and digits, so a fallback font can never shift a row.
 */

export const BUILD_GLYPHS = ["·", ":", "+"] as const;
export const DISSOLVE_GLYPHS = ["%", "+", ":", "·"] as const;

/** Milliseconds per glyph step while a cell builds, the gap between cells, and between bars of one instrument. */
export const CELL_STEP_MS = 45;
export const CELL_GAP_MS = 16;
export const BAR_GAP_MS = 70;
export const UNIT_STEP_MS = 40;
export const UNIT_GAP_MS = 22;
export const UNIT_ROW_GAP_MS = 90;
/** A number's dissolve on build, and on a live change. */
export const DISSOLVE_MS = 520;
export const CHANGE_MS = 700;

/** Characters that stay put while a number dissolves: separators keep the number's shape. */
const KEEP = new Set([",", ".", " ", "-", "/"]);

/** One frame of a dissolve: the first `k` share of characters settled, the rest random glyphs. */
export function dissolveFrame(text: string, k: number, rand: () => number = Math.random): string {
  const settle = Math.floor(Math.max(0, Math.min(1, k)) * text.length);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    out += i < settle || KEEP.has(c) ? c : DISSOLVE_GLYPHS[Math.floor(rand() * DISSOLVE_GLYPHS.length)]!;
  }
  return out;
}

/** True when the page runs its motion (html.motion, set before first paint by app/layout.tsx). */
export function motionOn(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("motion");
}

/** The event an instrument's section fires when it builds; `instant` when it builds with no motion. */
export const BUILD_EVENT = "panel:build";
export type BuildDetail = { instant: boolean };
