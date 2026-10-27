import { UI } from "@/lib/palette";

/**
 * The radar's middle column: a target lock drawn in ASCII. Between locks a
 * reticle scans; when the sweep hands over a real-world incident, brackets
 * close in, what was hit is spelled in pixel letters, then its CVE (or its
 * family) and a severity stamp land. Text goes into an AsciiGrid, one
 * character, colour and alpha per cell, drawn with fillText.
 */

/** How long one lock runs, from brackets in to brackets out. */
export const LOCK_SECONDS = 5.4;

const DEEP = "#2a3346";
const SHADOW = "#1f2a3d";
const HOT = "#fff1d6";

/** Cell marked as cleared by AsciiGrid.put. */
const CLEAR = "\u0000";

export class AsciiGrid {
  cols = 0;
  rows = 0;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private cw = 0;
  private ch = 0;
  private ox = 0;
  private oy = 0;
  private chars: string[] = [];
  private colors: string[] = [];
  private alpha = new Float32Array(0);

  constructor(
    private canvas: HTMLCanvasElement,
    private px: number,
    private font: string,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.font = `${this.px}px ${this.font}`;
    this.cw = this.ctx.measureText("M").width || this.px * 0.6;
    this.ch = Math.round(this.px * 1.22);
    this.cols = r.width > 0 ? Math.floor(r.width / this.cw) : 0;
    this.rows = r.height > 0 ? Math.floor(r.height / this.ch) : 0;
    this.ox = (r.width - this.cols * this.cw) / 2;
    this.oy = (r.height - this.rows * this.ch) / 2;
    const n = this.cols * this.rows;
    this.chars = new Array<string>(n).fill(" ");
    this.colors = new Array<string>(n).fill(UI.soft);
    this.alpha = new Float32Array(n);
  }

  clear() {
    this.chars.fill(" ");
  }

  set(x: number, y: number, ch: string, color: string = UI.soft, a = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows || !ch) return;
    const i = y * this.cols + x;
    this.chars[i] = ch;
    this.colors[i] = color;
    this.alpha[i] = a;
  }

  /** Spaces in s leave the cells under them alone. */
  text(x: number, y: number, s: string, color: string, a = 1) {
    for (let i = 0; i < s.length; i++) if (s[i] !== " ") this.set(x + i, y, s[i]!, color, a);
  }

  /** Spaces in s clear the cells under them. */
  put(x: number, y: number, s: string, color: string, a = 1) {
    for (let i = 0; i < s.length; i++) this.set(x + i, y, s[i] === " " ? CLEAR : s[i]!, color, a);
  }

  center(y: number, s: string, color: string, a = 1) {
    this.text(Math.floor((this.cols - s.length) / 2), y, s, color, a);
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.font = `${this.px}px ${this.font}`;
    ctx.textBaseline = "top";
    let lastC = "";
    let lastA = -1;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        const ch = this.chars[i]!;
        if (ch === " " || ch === CLEAR) continue;
        if (this.colors[i] !== lastC) ctx.fillStyle = lastC = this.colors[i]!;
        if (this.alpha[i] !== lastA) ctx.globalAlpha = lastA = this.alpha[i]!;
        ctx.fillText(ch, this.ox + x * this.cw, this.oy + y * this.ch + 1);
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** What one lock shows. */
export interface Lock {
  /** Pixel letters: upper case, A-Z 0-9 . - + / & and spaces, at most 10 (lib/scope.ts lockText). */
  name: string;
  /** The line under the letters: the CVE, else the family. */
  sub: string;
  /** The severity stamp, e.g. "EXPLOITED". */
  stamp: string;
  /** Family and age, last line. */
  meta: string;
  /** The family's colour, for the letters. */
  color: string;
  /** The severity's colour, for the frame and the stamp. */
  tone: string;
}

/** A 3x5 pixel font; letters are doubled when the name is short. */
const FONT: Record<string, readonly string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"], B: ["##.", "#.#", "##.", "#.#", "##."], C: [".##", "#..", "#..", "#..", ".##"], D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"], F: ["###", "#..", "##.", "#..", "#.."], G: [".##", "#..", "#.#", "#.#", ".##"], H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"], J: ["..#", "..#", "..#", "#.#", ".#."], K: ["#.#", "#.#", "##.", "#.#", "#.#"], L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"], N: ["##.", "#.#", "#.#", "#.#", "#.#"], O: [".#.", "#.#", "#.#", "#.#", ".#."], P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"], R: ["##.", "#.#", "##.", "#.#", "#.#"], S: [".##", "#..", ".#.", "..#", "##."], T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"], V: ["#.#", "#.#", "#.#", "#.#", ".#."], W: ["#.#", "#.#", "###", "###", "#.#"], X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."], Z: ["###", "..#", ".#.", "#..", "###"], "0": ["###", "#.#", "#.#", "#.#", "###"], "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"], "3": ["##.", "..#", ".#.", "..#", "##."], "4": ["#.#", "#.#", "###", "..#", "..#"], "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"], "7": ["###", "..#", ".#.", ".#.", ".#."], "8": ["###", "#.#", "###", "#.#", "###"], "9": ["###", "#.#", "###", "..#", "##."],
  ".": ["...", "...", "...", "...", ".#."], "-": ["...", "...", "###", "...", "..."], "+": ["...", ".#.", "###", ".#.", "..."], "/": ["..#", "..#", ".#.", "#..", "#.."],
  "&": [".#.", "#.#", ".#.", "#.#", ".##"], " ": ["...", "...", "...", "...", "..."],
};

const ease = (k: number) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
const typed = (s: string, t: number, cps: number) => s.slice(0, Math.max(0, Math.floor(t * cps)));

/** Idle: a reticle drifting over the column on faint crosshairs. */
function drawScan(g: AsciiGrid, now: number) {
  const W = g.cols, H = g.rows;
  const sx = Math.round(W / 2 + Math.sin(now * 0.7) * (W / 2 - 6));
  const sy = Math.round(H / 2 + Math.sin(now * 1.1 + 1) * (H / 2 - 4));
  for (let x = 0; x < W; x += 2) g.set(x, sy, "-", DEEP);
  for (let y = 0; y < H; y++) g.set(sx, y, "|", DEEP, 0.8);
  g.text(sx - 2, sy, "-( )-", UI.dim);
  g.set(sx, sy, "+", UI.accent);
  g.text(1, 0, `SCANNING${".".repeat(1 + (Math.floor(now * 2) % 3))}`, UI.faint);
}

/**
 * Draws the column for one moment: `lock` with `t` seconds since it began
 * (0..LOCK_SECONDS), or the idle scan when `lock` is null. `now` drives the
 * idle motion.
 */
export function drawLock(g: AsciiGrid, lock: Lock | null, t: number, now: number) {
  if (!g.cols || !g.rows) return;
  if (!lock || t < 0 || t >= LOCK_SECONDS) return drawScan(g, now);
  const W = g.cols, H = g.rows;
  const fx0 = 1, fy0 = 1, fx1 = W - 2, fy1 = H - 2;

  // brackets close in, hold, then fly back out
  const k = ease(t / 0.7) * (1 - (t > 4.7 ? ease((t - 4.7) / 0.6) : 0));
  const inset = (1 - k) * 6;
  const bx0 = Math.round(fx0 - inset), bx1 = Math.round(fx1 + inset), by0 = Math.round(fy0 - inset / 2), by1 = Math.round(fy1 + inset / 2);
  const bc = t < 0.7 ? UI.dim : lock.tone;
  const corner = (x: number, y: number, dx: number, dy: number) => {
    g.set(x, y, "+", bc);
    g.set(x + dx, y, "-", bc);
    g.set(x + 2 * dx, y, "-", bc);
    g.set(x, y + dy, "|", bc);
  };
  corner(bx0, by0, 1, 1);
  corner(bx1, by0, -1, 1);
  corner(bx0, by1, 1, -1);
  corner(bx1, by1, -1, -1);
  if (t < 0.9) {
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    g.text(cx - 3, cy, "-( + )-", Math.floor(t * 10) % 2 ? UI.accent : UI.dim);
    g.center(cy + 2, "ACQUIRING", UI.dim);
    return;
  }
  if (t > 5.0) return;
  const fade = t > 4.6 ? Math.max(0, 1 - (t - 4.6) / 0.4) : 1;

  // the frame's edges draw in, then its label
  const e = ease((t - 0.7) / 0.5);
  for (let x = fx0 + 3; x <= fx0 + 3 + Math.floor(e * (fx1 - fx0 - 6)); x++) {
    g.set(x, fy0, "-", UI.faint, fade);
    g.set(x, fy1, "-", UI.faint, fade);
  }
  const label = " TARGET LOCKED ";
  g.put(Math.floor((W - label.length) / 2), fy0, label, lock.tone, fade);

  // the name as a bitmap, two pixel rows per cell with half blocks, revealed column by column over an offset shadow
  const name = lock.name;
  const s = name.length <= 5 ? 2 : 1;
  const bw = (name.length * 4 - 1) * s, rowsN = Math.ceil((5 * s) / 2);
  const bit = (px: number, py: number) => {
    const i = Math.floor(px / (4 * s)), c = Math.floor(px / s) % 4, r = Math.floor(py / s);
    if (c === 3 || r >= 5 || i >= name.length) return false;
    return (FONT[name[i]!] ?? FONT[" "]!)[r]![c] === "#";
  };
  const nx = Math.floor((W - bw) / 2), ny = fy0 + 3;
  const reveal = Math.floor(((t - 1.1) / 1.0) * bw);
  for (const shadow of [true, false]) {
    for (let cy = 0; cy < rowsN; cy++) {
      for (let cx = 0; cx <= Math.min(reveal, bw - 1); cx++) {
        const top = bit(cx, cy * 2), bot = bit(cx, cy * 2 + 1);
        if (!top && !bot) continue;
        const ch = top && bot ? "█" : top ? "▀" : "▄";
        if (shadow) g.set(nx + cx + 1, ny + cy + 1, ch, SHADOW, fade);
        else g.set(nx + cx, ny + cy, ch, cx === reveal ? HOT : lock.color, fade);
      }
    }
  }

  const below = ny + rowsN + 2;
  if (t > 2.2) g.center(below, typed(lock.sub, t - 2.2, 40).slice(0, W - 4), UI.soft, fade);
  if (t > 2.8) {
    const stamp = `[ ${lock.stamp} ]`;
    const slam = t < 2.95;
    g.center(below + 2, stamp, slam ? HOT : lock.tone, fade);
    if (slam) g.center(below + 3, "~".repeat(stamp.length), lock.tone, 0.6);
  }
  if (t > 3.2 && below + 4 < fy1) g.center(below + 4, lock.meta.slice(0, W - 4), UI.dim, fade);
}
