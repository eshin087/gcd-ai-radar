import type { ClusterData, ClusterKev, ClusterLane } from "@/lib/home";
import { LANE_COLORS, SEVERITY_COLORS, UI } from "@/lib/palette";
import { LANE_META, PATCH_META } from "@/lib/taxonomy";

/**
 * The radar's middle column drawn in text on a canvas: four tiles (due,
 * open, new CVEs, breached), each a label, one big number, one mark and one
 * line about its current item. On load every tile builds in (lines form out
 * of dots, bars fill cell by cell, numbers spin up from zero); after that one
 * tile at a time moves to its next item, 4 s apart, each every 16 s: Due
 * with a scanline wipe, Open and Breached with a dissolve through % + : .,
 * New CVEs with an odometer roll. The countdown's last digit ticks every
 * second. Monospace text drawn character by character, so every transition
 * works on characters; bar and sparkline cells are drawn as blocks because
 * the font has no block glyphs.
 */

export const TILE_H = 104;
const ROW_GAP = 38;
const COL_GAP = 16;
/** Seconds after the build-in when each tile first moves, and how often after that. */
const FIRST = { due: 6, open: 10, cves: 14, breached: 18 } as const;
const EVERY = 16;

type Key = keyof typeof FIRST;
export const TILE_KEYS: readonly Key[] = ["due", "open", "cves", "breached"];

const PARTIAL = "#f2a83b";
const HOT = "#fff1d6";
const OUT = ["%", "+", ":", "."];
const IN = [".", ":", "+", "%"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LANES: readonly ClusterLane[] = ["patch", "breach", "supply_chain"];
const LANE_WORD: Record<ClusterLane, string> = { patch: "patch", breach: "breach", supply_chain: "supply" };

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (k: number) => 1 - (1 - clamp(k)) ** 3;
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const mod10 = (x: number) => ((Math.floor(x) % 10) + 10) % 10;
const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);
const num = (n: number) => n.toLocaleString("en-US");
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** The end of a KEV due day: CISA's deadlines are whole days. */
export const dueEnd = (k: ClusterKev) => dayMs(k.due) + 86_399_999;

/** A character on its way from `a` to `b`: out through the ramp, a blank, back in through it. */
function dissolve(a: string, b: string, p: number): string {
  if (p <= 0) return a;
  if (p >= 1) return b;
  const s = Math.floor(p * 10);
  if (s === 0) return a;
  if (s <= 4) return a === " " ? " " : OUT[s - 1]!;
  if (s === 5) return " ";
  return b === " " ? " " : IN[s - 6]!;
}

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The four tiles in the column's own pixels, the pair of rows centred vertically. */
export function tileRects(w: number, h: number): TileRect[] {
  const tw = (w - COL_GAP) / 2;
  const oy = Math.max(4, Math.round((h - (2 * TILE_H + ROW_GAP)) / 2));
  return [
    { x: 0, y: oy, w: tw, h: TILE_H },
    { x: tw + COL_GAP, y: oy, w: tw, h: TILE_H },
    { x: 0, y: oy + TILE_H + ROW_GAP, w: tw, h: TILE_H },
    { x: tw + COL_GAP, y: oy + TILE_H + ROW_GAP, w: tw, h: TILE_H },
  ];
}

/** Vendor and product, without the vendor twice ("Collabora Collabora Online") or a long tail. */
function kevName(k: ClusterKev, cols: number): string {
  const product = k.product.split(" – ")[0]!.trim();
  const full = product.toLowerCase().startsWith(k.vendor.toLowerCase()) ? product : `${k.vendor} ${product}`;
  if (full.length <= cols) return full;
  const rest = product.slice(product.toLowerCase().startsWith(k.vendor.toLowerCase()) ? k.vendor.length : 0).trim();
  return fit(`${k.vendor} ${rest.split(" ")[0] ?? ""}`.trim(), cols);
}

interface Slot {
  cur: string;
  prev: string;
  at: number;
}

export class ClusterView {
  /** The tile under the pointer or keyboard focus: its label lights up. */
  hover = -1;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private cw = 7.2;
  private cwBig = 13.2;
  private cols = 18;
  private rects: TileRect[] = [];
  private slots = new Map<string, Slot>();
  private build = 0;
  private next: Record<Key, number> = { ...FIRST };
  private idx: Record<Key, number> = { due: 0, open: 0, cves: 0, breached: 0 };
  private prev: Record<Key, number> = { due: 0, open: 0, cves: 0, breached: 0 };
  private at: Record<Key, number> = { due: -100, open: -100, cves: -100, breached: -100 };

  constructor(
    private canvas: HTMLCanvasElement,
    private data: ClusterData,
    private mono: string,
    private still: boolean,
  ) {
    this.ctx = canvas.getContext("2d")!;
    if (still) this.build = -100;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.font = `12px ${this.mono}`;
    this.cw = this.ctx.measureText("M").width || 7.2;
    this.ctx.font = `22px ${this.mono}`;
    this.cwBig = this.ctx.measureText("M").width || 13.2;
    this.rects = tileRects(r.width, r.height);
    this.cols = Math.max(8, Math.floor((this.rects[0]?.w ?? 0) / this.cw));
  }

  /** KEV entries whose deadline is still ahead of the viewer's clock. */
  private due(now: number) {
    return (this.data.kev ?? []).filter((k) => dueEnd(k) > now);
  }

  private count(k: Key, now: number): number {
    if (k === "due") return this.due(now).length;
    if (k === "open") return this.data.open.rows.length;
    if (k === "cves") return this.data.cves ? 3 : 0;
    return this.data.breaches?.rows.length ?? 0;
  }

  /** Which CVE count the tile shows: 0 the last 24 h, 1 the last 7 days, 2 the critical ones of the last 7 days. */
  cvesShown(): number {
    return this.idx.cves;
  }

  /** The KEV entry the Due tile shows (or is wiping to). */
  dueShown(now: number): ClusterKev | undefined {
    const due = this.due(now);
    return due[this.idx.due % Math.max(1, due.length)];
  }

  private step(t: number, now: number) {
    if (this.still) return;
    for (const k of TILE_KEYS) {
      if (t < this.next[k]) continue;
      this.next[k] = t + EVERY;
      const n = this.count(k, now);
      if (n < 2) continue;
      this.prev[k] = this.idx[k] % n;
      this.idx[k] = (this.prev[k] + 1) % n;
      this.at[k] = t;
    }
  }

  /* ---------- primitives, in the column's pixels; y is a text line's middle ---------- */

  private chars(x: number, y: number, s: string, color: string, a = 1) {
    const ctx = this.ctx;
    ctx.font = `12px ${this.mono}`;
    ctx.fillStyle = color;
    ctx.globalAlpha = a;
    for (let i = 0; i < s.length; i++) if (s[i] !== " ") ctx.fillText(s[i]!, x + i * this.cw, y);
    ctx.globalAlpha = 1;
  }

  /** A line that forms out of dots from `t0` (from "" on the build-in) or dissolves from its previous text. */
  private line(x: number, y: number, from: string, to: string, t0: number, t: number, color: string) {
    const ctx = this.ctx;
    ctx.font = `12px ${this.mono}`;
    ctx.fillStyle = color;
    const n = Math.max(from.length, to.length);
    for (let i = 0; i < n; i++) {
      const p = (t - t0 - i * 0.022) / 0.5;
      const c = dissolve(from[i] ?? " ", to[i] ?? " ", p);
      if (c === " ") continue;
      ctx.globalAlpha = p > 0 && p < 1 ? 0.75 : 1;
      ctx.fillText(c, x + i * this.cw, y);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Big digits on wheels: they spin up from zero from `spinAt`, and roll a
   * step when a digit changes; `dir` -1 drops the new digit in from above, as
   * a countdown does. `silent` takes a new value without rolling (inside a wipe).
   */
  private roll(key: string, x: number, y: number, str: string, t: number, color: string, dir: 1 | -1, spinAt: number, silent = false) {
    silent ||= this.still; // under reduced motion a new value just replaces the old
    let s = this.slots.get(key);
    if (!s) this.slots.set(key, (s = { cur: str, prev: str, at: -100 }));
    if (s.cur !== str) {
      s.prev = silent ? str : s.cur;
      s.cur = str;
      s.at = silent ? -100 : t;
    }
    const ctx = this.ctx, cw = this.cwBig, lh = 27, n = str.length;
    const prev = s.prev.padStart(n, " ").slice(-n);
    ctx.font = `22px ${this.mono}`;
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const b = str[i]!, a = prev[i]!, cx = x + i * cw;
      const spin = (t - spinAt - (n - 1 - i) * 0.04) / 1.3;
      if (spin < 0 && t - spinAt < 3) continue; // not formed yet
      let wheel: number | null = null;
      let slide: number | null = null;
      if (spin < 1 && isDigit(b)) {
        const k = 1 + (i % 4);
        wheel = -10 * k + (Number(b) + 10 * k) * ease(spin);
      } else if (a !== b && t - s.at < 0.32) {
        const p = ease((t - s.at) / 0.32);
        if (dir > 0 && isDigit(a) && isDigit(b)) wheel = Number(a) + ((Number(b) - Number(a) + 10) % 10) * p;
        else slide = p;
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - 1, y - lh / 2, cw + 2, lh);
      ctx.clip();
      if (wheel !== null) {
        const f = wheel - Math.floor(wheel);
        ctx.fillText(String(mod10(wheel)), cx, y - f * lh);
        ctx.fillText(String(mod10(wheel + 1)), cx, y + (1 - f) * lh);
      } else if (slide !== null) {
        if (a !== " ") {
          ctx.globalAlpha = 1 - slide;
          ctx.fillText(a, cx, y - dir * slide * lh * 0.6);
        }
        if (b !== " ") {
          ctx.globalAlpha = slide;
          ctx.fillText(b, cx, y + dir * (1 - slide) * lh * 0.6);
        }
        ctx.globalAlpha = 1;
      } else if (b !== " ") ctx.fillText(b, cx, y);
      ctx.restore();
    }
  }

  /** A row of cells: the dotted track forms first, then the fill runs cell by cell from `t0`. */
  private bar(x: number, y: number, cells: number, frac: number, t0: number, t: number, color: string) {
    const ctx = this.ctx, cw = this.cw;
    const fill = frac > 0 ? Math.max(1, Math.round(frac * cells)) : 0;
    ctx.font = `12px ${this.mono}`;
    for (let i = 0; i < cells; i++) {
      if (t - t0 - i * 0.012 <= 0) continue;
      const on = i < fill && t - t0 - 0.2 - i * 0.035 > 0;
      if (on) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = color;
        ctx.fillRect(x + i * cw + 0.5, y - 6, cw - 1.5, 12);
      } else {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = UI.faint;
        ctx.fillText("·", x + i * cw, y);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** One cell per 24 hours in eighths; the last `lit` cells (what the number counts) in the accent. */
  private spark(x: number, y: number, series: readonly number[], lit: number, t0: number, t: number) {
    const ctx = this.ctx, cw = this.cw, top = Math.max(...series.map(Math.sqrt), 1e-9), CH = 14;
    ctx.font = `12px ${this.mono}`;
    series.forEach((v, i) => {
      const start = t - t0 - i * 0.05;
      if (start <= 0) return;
      const target = v > 0 ? Math.max(1, Math.round((Math.sqrt(v) / top) * 8)) : 0;
      const level = Math.round(target * clamp(start / 0.16));
      if (level <= 0) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = UI.faint;
        ctx.fillText("·", x + i * cw, y);
        return;
      }
      const on = i >= series.length - lit;
      ctx.globalAlpha = on ? 0.95 : 0.55;
      ctx.fillStyle = on ? UI.accent : UI.dim;
      const hp = (level / 8) * CH;
      ctx.fillRect(x + i * cw + 0.5, y + CH / 2 - hp, cw - 1.5, hp);
    });
    ctx.globalAlpha = 1;
  }

  private label(r: TileRect, i: number, left: string, right: string, b0: number, t: number) {
    this.line(r.x, r.y + 7, "", left, b0, t, this.hover === i ? UI.ink : UI.dim);
    this.line(r.x + (this.cols - right.length) * this.cw, r.y + 7, "", right, b0 + 0.1, t, UI.faint);
  }

  /* ---------- the tiles ---------- */

  private drawDue(r: TileRect, k: ClusterKev | undefined, pos: string, t: number, now: number, b0: number, inWipe: boolean) {
    const C = this.cols;
    this.label(r, 0, "DUE", pos, b0, t);
    if (!k) {
      this.line(r.x, r.y + 34, "", "--:--:--", b0 + 0.1, t, UI.faint);
      this.line(r.x, r.y + 80, "", this.data.kev ? "No deadline ahead" : "KEV not loaded", b0 + 0.35, t, UI.soft);
      this.line(r.x, r.y + 96, "", "CISA KEV", b0 + 0.45, t, UI.dim);
      return;
    }
    const left = Math.max(0, Math.floor((dueEnd(k) - now) / 1000));
    const d = Math.floor(left / 86400), hh = Math.floor(left / 3600) % 24, mm = Math.floor(left / 60) % 60, ss = left % 60;
    const p2 = (x: number) => String(x).padStart(2, "0");
    const clock = d ? `${d}d ${p2(hh)}:${p2(mm)}` : `${p2(hh)}:${p2(mm)}:${p2(ss)}`;
    this.roll(`due:${k.cve}`, r.x, r.y + 34, clock, t, UI.accent, -1, b0 + 0.1, inWipe);
    const today = new Date(now).toISOString().slice(0, 10);
    const soon = dayMs(k.due) - dayMs(today) <= 86_400_000;
    const gone = clamp((now - dayMs(k.added)) / (dueEnd(k) - dayMs(k.added)));
    this.bar(r.x, r.y + 60, C, gone, b0 + 0.2, t, soon ? SEVERITY_COLORS[3] : PARTIAL);
    const when = k.due === today ? "today" : dayLabel(k.due);
    this.line(r.x, r.y + 80, "", kevName(k, C), b0 + 0.35, t, UI.ink);
    this.line(r.x, r.y + 96, "", fit(`${k.n > 1 ? `${k.n} CVEs` : k.cvss !== null ? `CVSS ${k.cvss}` : "unscored"} · ${when}`, C), b0 + 0.45, t, UI.dim);
  }

  private openMeta(i: number, now: number): string {
    const o = this.data.open.rows[i];
    if (!o) return "";
    const days = Math.max(0, Math.round((dayMs(new Date(now).toISOString().slice(0, 10)) - dayMs(o.reported)) / 86_400_000));
    const state = o.lane === "breach" ? LANE_META.breach.short.toLowerCase() : PATCH_META[o.patch].label.toLowerCase();
    // the fix state in the site's words comes first; the age goes when both do not fit ("no patch yet · today" is 20)
    const full = `${state} · ${days === 0 ? "today" : `${days} d ago`}`;
    return full.length <= this.cols ? full : state;
  }

  private drawOpen(r: TileRect, t: number, now: number, b0: number) {
    const C = this.cols, o = this.data.open, i = this.idx.open, p = this.prev.open, at = this.at.open;
    const swapped = at > b0;
    const cur = o.rows[i];
    this.label(r, 1, "OPEN", `${o.total} · sev 3+`, b0, t);
    const max = Math.max(1, ...LANES.map((l) => o.lanes[l]));
    LANES.forEach((l, n) => {
      const y = r.y + 28 + n * 16, on = cur?.lane === l;
      this.line(r.x, y, "", LANE_WORD[l], b0 + 0.1 + n * 0.05, t, on ? UI.ink : UI.dim);
      this.bar(r.x + 7 * this.cw, y, C - 10, o.lanes[l] / max, b0 + 0.15 + n * 0.05, t, LANE_COLORS[l]);
      this.line(r.x + (C - 3) * this.cw, y, "", String(o.lanes[l]).padStart(3), b0 + 0.25 + n * 0.05, t, on ? UI.ink : UI.soft);
    });
    const t0 = swapped ? at : b0 + 0.35;
    const name = (k: number) => fit(o.rows[k]?.name ?? "", C);
    this.line(r.x, r.y + 80, swapped ? name(p) : "", cur ? name(i) : "Nothing open", t0, t, cur ? LANE_COLORS[cur.lane] : UI.soft);
    this.line(r.x, r.y + 96, swapped ? fit(this.openMeta(p, now), C) : "", fit(this.openMeta(i, now), C), t0 + 0.08, t, UI.dim);
  }

  private drawCves(r: TileRect, t: number, b0: number) {
    const v = this.data.cves;
    this.label(r, 2, "NEW CVEs", "NVD", b0, t);
    if (!v) {
      this.line(r.x, r.y + 34, "", "--", b0 + 0.1, t, UI.faint);
      this.line(r.x, r.y + 80, "", "NVD not loaded", b0 + 0.35, t, UI.soft);
      return;
    }
    const views = [
      { n: v.day, line: "in the last 24 h", meta: "published to NVD", series: v.perDay, lit: 1 },
      { n: v.week, line: "in the last 7 days", meta: "published to NVD", series: v.perDay, lit: 7 },
      { n: v.critical, line: "critical, 7 days", meta: "CVSS 9.0 or higher", series: v.criticalPerDay, lit: 7 },
    ];
    const at = this.at.cves, swapped = at > b0, cur = views[this.idx.cves]!, prev = views[this.prev.cves]!;
    this.roll("cves", r.x, r.y + 34, num(cur.n), t, UI.ink, 1, b0 + 0.1);
    this.spark(r.x, r.y + 60, cur.series, cur.lit, swapped && prev.series !== cur.series ? at : b0 + 0.2, t);
    const t0 = swapped ? at : b0 + 0.35;
    this.line(r.x, r.y + 80, swapped ? prev.line : "", cur.line, t0, t, UI.ink);
    this.line(r.x, r.y + 96, swapped ? prev.meta : "", cur.meta, t0 + 0.08, t, UI.dim);
  }

  private drawBreached(r: TileRect, t: number, b0: number) {
    const C = this.cols, b = this.data.breaches;
    this.label(r, 3, "BREACHED", b ? `HIBP ${MON[Number(b.month.slice(5, 7)) - 1]}` : "HIBP", b0, t);
    if (!b) {
      this.line(r.x, r.y + 34, "", "--", b0 + 0.1, t, UI.faint);
      this.line(r.x, r.y + 80, "", "HIBP not loaded", b0 + 0.35, t, UI.soft);
      return;
    }
    this.roll("breached", r.x, r.y + 34, num(b.accounts), t, UI.ink, 1, b0 + 0.1);
    const at = this.at.breached, swapped = at > b0, cur = b.rows[this.idx.breached], prev = b.rows[this.prev.breached];
    if (!cur) {
      this.line(r.x, r.y + 80, "", "None yet this month", b0 + 0.35, t, UI.soft);
      return;
    }
    const pct = (x: typeof cur | undefined) => (x && b.accounts ? `${Math.max(1, Math.round((x.accounts / b.accounts) * 100))}%`.padStart(4) : "");
    const meta = (x: typeof cur | undefined) => (x ? fit(`${short(x.accounts)} · ${dayLabel(x.added)}`, C) : "");
    const t0 = swapped ? at : b0 + 0.35;
    this.bar(r.x, r.y + 60, C - 5, b.accounts ? cur.accounts / b.accounts : 0, swapped ? at : b0 + 0.2, t, LANE_COLORS.breach);
    this.line(r.x + (C - 4) * this.cw, r.y + 60, swapped ? pct(prev) : "", pct(cur), t0, t, UI.soft);
    this.line(r.x, r.y + 80, swapped ? fit(prev?.title ?? "", C) : "", fit(cur.title, C), t0, t, UI.ink);
    this.line(r.x, r.y + 96, swapped ? meta(prev) : "", meta(cur), t0 + 0.08, t, UI.dim);
  }

  /** Draws the column at `t` seconds since it started, with the viewer's clock at `now`. */
  render(t: number, now: number) {
    if (!this.w || !this.h || this.rects.length < 4) return;
    this.step(t, now);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const [d, o, c, b] = this.rects as [TileRect, TileRect, TileRect, TileRect];
    const b0 = this.build;
    const due = this.due(now);
    const pos = (i: number) => (due.length ? `KEV ${(i % due.length) + 1}/${due.length}` : "KEV");

    // due, with the scanline wipe when it moves on
    const at = this.at.due;
    if (t - at < 0.9 && due.length > 1) {
      const p = ease((t - at) / 0.9), sx = d.x - 6 + p * (d.w + 12);
      ctx.save();
      ctx.beginPath();
      ctx.rect(d.x - 8, d.y - 6, sx - d.x + 8, d.h + 8);
      ctx.clip();
      this.drawDue(d, due[this.idx.due % due.length], pos(this.idx.due), t, now, b0, true);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, d.y - 6, d.w + 16, d.h + 8);
      ctx.clip();
      this.drawDue(d, due[this.prev.due % due.length], pos(this.prev.due), t, now, b0, true);
      ctx.restore();
      ctx.font = `12px ${this.mono}`;
      ctx.textAlign = "center";
      for (let y = d.y - 2; y <= d.y + d.h - 2; y += 8) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = HOT;
        ctx.fillText("|", sx, y);
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = UI.accent;
        ctx.fillText(":", sx - 6, y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    } else this.drawDue(d, due[this.idx.due % Math.max(1, due.length)], pos(this.idx.due), t, now, b0, false);

    this.drawOpen(o, t, now, b0 + 0.15);
    this.drawCves(c, t, b0 + 0.3);
    this.drawBreached(b, t, b0 + 0.45);
    // the one ornament: a faint cross where the four tiles meet
    this.chars(this.w / 2 - this.cw / 2, (d.y + d.h + c.y) / 2, "+", UI.faint, t - b0 > 0.6 ? 0.8 : 0);
  }
}
