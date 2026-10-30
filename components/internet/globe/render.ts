import type { InternetRoute } from "../useInternet";
import { basis, clamp, DEG, dot3, isLand, landDots, lonLat, place, plainName, rotate, slerp, subsolar, toLonLat, type Basis, type V3 } from "./geo";

/**
 * Draws one frame of the globe on a 2D canvas. Four looks share the camera,
 * the arcs and the labels and differ in how the land is drawn:
 *
 *   signal    fine dots shaded by depth, the far side faintly through the sphere
 *   daylight  dots lit by the real Sun at this moment, the terminator dotted
 *   ascii     the land as mono glyphs on a screen grid, shaded by the real Sun
 *   sweep     a radar sweep circling the poles, lighting the land behind it
 *
 * No glow and no blur: depth and light come from alpha and dot size only.
 * Labels are 12 px; the ASCII look's land glyphs are 9 px art on the
 * aria-hidden canvas, not text.
 */

import type { GlobeLook } from "./looks";

export type { GlobeLook } from "./looks";

export interface Arc {
  route: InternetRoute;
  /** Earth-fixed points along the lifted path, origin first. */
  pts: V3[];
  /** The camera centre that shows the whole route: [lon, lat] in radians. */
  view: [number, number];
  /** Attacks from a country on itself: a small loop over it. */
  self: boolean;
}

const ARC_N = 64;

/** The route as a lifted great circle (or a loop for a country on itself), or null when a code has no place on the map. */
export function buildArc(route: InternetRoute): Arc | null {
  const a = place(route.origin), b = place(route.target);
  if (!a || !b) return null;
  const pts: V3[] = [];
  const span = Math.acos(clamp(dot3(a, b), -1, 1));
  if (span < 1e-3) {
    // a ring through the country's label point, about 9° across, leaning north
    const [lon, lat] = toLonLat(a);
    const q = lonLat(lon, Math.min(80, lat + 9));
    const k = slerp(a, q, 0.5);
    for (let i = 0; i <= ARC_N; i++) {
      const t = i / ARC_N;
      const p = rotate(a, k, 2 * Math.PI * t);
      const h = 1 + 0.06 * Math.sin(Math.PI * t);
      pts.push({ x: p.x * h, y: p.y * h, z: p.z * h });
    }
    const [vl, vp] = toLonLat(k);
    return { route, pts, view: [vl * DEG, clamp(vp, -50, 50) * DEG], self: true };
  }
  const lift = 0.04 + 0.12 * (span / Math.PI);
  for (let i = 0; i <= ARC_N; i++) {
    const t = i / ARC_N;
    const p = slerp(a, b, t);
    const h = 1 + lift * Math.sin(Math.PI * t);
    pts.push({ x: p.x * h, y: p.y * h, z: p.z * h });
  }
  const [vl, vp] = toLonLat(slerp(a, b, 0.5));
  return { route, pts, view: [vl * DEG, clamp(vp, -50, 50) * DEG], self: false };
}

export interface Scene {
  /** Camera centre in radians. */
  lon: number;
  lat: number;
  /** Seconds on a continuous clock (the sweep). */
  time: number;
  /** Epoch milliseconds (the Sun). */
  now: number;
  arcs: Arc[];
  /** Index into `arcs` of the route on screen, or -1. */
  focus: number;
  /** How much of the focus route is drawn, 0 to 1. */
  drawn: number;
  /** Seconds since the focus route finished drawing, or -1 before. */
  pulse: number;
  /** The previous focus, fading out, and its remaining alpha. */
  fade: number;
  fadeAlpha: number;
  /** Faint hairlines for the routes not in focus. */
  context: boolean;
}

export interface Palette {
  accent: string;
  ink: string;
  soft: string;
  dim: string;
  faint: string;
  hit: string;
  ground: string;
  mono: string;
}

/** Seconds between pulses along the focus route once it is drawn. */
export const PULSE_S = 1.8;
const TRAVEL_S = 0.9;
const FIRST_PULSE_S = 0.5;
const RING_S = 1.3;
const SWEEP_S = 7;
/** Land glyphs from night to full sun; none of them is a line character, so the routes stay readable over the land. */
const GLYPHS = ".:+*#%";

const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class GlobeRenderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private R = 0;
  private cx = 0;
  private cy = 0;
  private dots: Float32Array | null = null;
  /** The ASCII look's grid: glyphs at 9 px (art on an aria-hidden canvas, not text; labels stay 12 px), cell width measured. */
  private readonly glyphPx = 9;
  private cw = 5.4;
  private readonly rowH = 10;

  constructor(
    private canvas: HTMLCanvasElement,
    private look: GlobeLook,
    private pal: Palette,
  ) {
    this.ctx = canvas.getContext("2d")!;
    const step = look === "sweep" ? 1.5 : look === "ascii" ? 0 : 1.25;
    if (step) this.dots = landDots(step);
  }

  get radius() {
    return this.R;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.R = Math.max(30, Math.min(this.w, this.h) / 2 - 18);
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    this.ctx.font = `${this.glyphPx}px ${this.pal.mono}`;
    this.cw = this.ctx.measureText("M").width || 5.4;
  }

  draw(s: Scene) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    const B = basis(s.lon, s.lat);
    if (this.look === "signal") this.landSignal(B);
    else if (this.look === "daylight") this.landDaylight(B, s.now);
    else if (this.look === "ascii") this.landAscii(B, s.now);
    else this.landSweep(B, s.time);

    const ascii = this.look === "ascii";
    if (s.context && !ascii) {
      s.arcs.forEach((arc, i) => {
        if (i === s.focus || i === s.fade) return;
        this.strokeArc(this.project(arc, B), 0, 1, () => 0.13, 0.8);
      });
    }
    if (s.fade >= 0 && s.fade !== s.focus && s.arcs[s.fade] && s.fadeAlpha > 0) {
      const pa = this.project(s.arcs[s.fade]!, B);
      if (ascii) this.glyphArc(pa, 1, s.fadeAlpha * 0.6, false);
      else this.strokeArc(pa, 0, 1, () => 0.5 * s.fadeAlpha, 1.3);
    }
    const arc = s.arcs[s.focus];
    if (!arc || s.drawn <= 0) return;
    const pa = this.project(arc, B);
    if (ascii) this.glyphArc(pa, s.drawn, 1, s.drawn < 1);
    else if (s.drawn < 1) this.strokeArc(pa, 0, s.drawn, (u) => 0.22 + 0.78 * Math.pow(u / s.drawn, 3), 1.6);
    else this.strokeArc(pa, 0, 1, () => 0.5, 1.4);
    if (s.drawn < 1) this.head(pa, s.drawn, ascii);
    if (s.pulse >= 0) this.pulses(pa, s.pulse, ascii);
    this.labels(arc, pa, s.drawn, ascii);
  }

  /* ---------------------------------------------------------------- land */

  private disc(alpha: number) {
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(150,160,185,${alpha})`;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.R, 0, Math.PI * 2);
    ctx.fill();
  }

  private limb(alpha: number) {
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(160,170,195,${alpha})`;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.R, 0, Math.PI * 2);
    ctx.stroke();
  }

  private landSignal(B: Basis) {
    const { ctx, R, cx, cy } = this;
    const d = this.dots!;
    this.disc(0.035);
    ctx.fillStyle = this.pal.soft;
    // the far side, faint, as if the sphere were glass
    ctx.globalAlpha = 0.07;
    for (let i = 0; i < d.length; i += 4) {
      const x = d[i]!, y = d[i + 1]!, z = d[i + 2]!;
      if (x * B.cx + y * B.cy + z * B.cz >= 0) continue;
      ctx.fillRect(cx + R * (x * B.ex + y * B.ey + z * B.ez) - 0.5, cy - R * (x * B.nx + y * B.ny + z * B.nz) - 0.5, 1, 1);
    }
    for (let i = 0; i < d.length; i += 4) {
      const x = d[i]!, y = d[i + 1]!, z = d[i + 2]!;
      const vz = x * B.cx + y * B.cy + z * B.cz;
      if (vz < 0) continue;
      const size = 0.7 + 1.2 * vz;
      ctx.globalAlpha = 0.16 + 0.66 * Math.pow(vz, 0.8);
      ctx.fillRect(cx + R * (x * B.ex + y * B.ey + z * B.ez) - size / 2, cy - R * (x * B.nx + y * B.ny + z * B.nz) - size / 2, size, size);
    }
    this.limb(0.22);
  }

  private landDaylight(B: Basis, now: number) {
    const { ctx, R, cx, cy } = this;
    const d = this.dots!;
    const [slon, slat] = subsolar(now);
    const sun = lonLat(slon, slat);
    this.disc(0.03);
    // night first, then twilight and day over it, two fill colours in all
    for (const pass of [0, 1]) {
      ctx.fillStyle = pass ? "#e1e5ee" : "#5d6884";
      for (let i = 0; i < d.length; i += 4) {
        const x = d[i]!, y = d[i + 1]!, z = d[i + 2]!;
        const vz = x * B.cx + y * B.cy + z * B.cz;
        if (vz < 0) continue;
        const day = smooth(-0.12, 0.18, x * sun.x + y * sun.y + z * sun.z);
        const a = pass ? day : 1 - day;
        if (a < 0.02) continue;
        const size = 0.7 + 1.2 * vz;
        ctx.globalAlpha = a * (pass ? 0.22 + 0.7 * vz : 0.2 + 0.42 * vz);
        ctx.fillRect(cx + R * (x * B.ex + y * B.ey + z * B.ez) - size / 2, cy - R * (x * B.nx + y * B.ny + z * B.nz) - size / 2, size, size);
      }
    }
    // the terminator: the great circle a quarter turn from the subsolar point, dotted
    const north = { x: 0, y: 0, z: 1 };
    const u0 = { x: sun.y * north.z - sun.z * north.y, y: sun.z * north.x - sun.x * north.z, z: sun.x * north.y - sun.y * north.x };
    const ul = Math.hypot(u0.x, u0.y, u0.z) || 1;
    const u = { x: u0.x / ul, y: u0.y / ul, z: u0.z / ul };
    const v = { x: sun.y * u.z - sun.z * u.y, y: sun.z * u.x - sun.x * u.z, z: sun.x * u.y - sun.y * u.x };
    ctx.fillStyle = this.pal.accent;
    for (let a = 0; a < 360; a += 2.5) {
      const c = Math.cos(a * DEG), sn = Math.sin(a * DEG);
      const px = c * u.x + sn * v.x, py = c * u.y + sn * v.y, pz = c * u.z + sn * v.z;
      const vz = px * B.cx + py * B.cy + pz * B.cz;
      if (vz < 0) continue;
      ctx.globalAlpha = 0.18 + 0.4 * vz;
      ctx.fillRect(cx + R * (px * B.ex + py * B.ey + pz * B.ez) - 0.75, cy - R * (px * B.nx + py * B.ny + pz * B.nz) - 0.75, 1.5, 1.5);
    }
    this.limb(0.2);
  }

  /** The glyph grid's top-left cell centre and size, shared by the land and the arcs so both snap to the same cells. */
  private grid() {
    const cols = Math.floor((2 * this.R) / this.cw);
    const rows = Math.floor((2 * this.R) / this.rowH);
    return { cols, rows, x0: this.cx - (cols * this.cw) / 2, y0: this.cy - (rows * this.rowH) / 2 };
  }

  private landAscii(B: Basis, now: number) {
    const { ctx, R, cx, cy, cw, rowH } = this;
    const [slon, slat] = subsolar(now);
    const sun = lonLat(slon, slat);
    const g = this.grid();
    ctx.font = `${this.glyphPx}px ${this.pal.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.pal.soft;
    for (let j = 0; j < g.rows; j++) {
      const py = g.y0 + (j + 0.5) * rowH;
      const ny = -(py - cy) / R;
      for (let i = 0; i < g.cols; i++) {
        const px = g.x0 + (i + 0.5) * cw;
        const nx = (px - cx) / R;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const vz = Math.sqrt(1 - d2);
        const p = { x: nx * B.ex + ny * B.nx + vz * B.cx, y: nx * B.ey + ny * B.ny + vz * B.cy, z: nx * B.ez + ny * B.nz + vz * B.cz };
        const lon = Math.atan2(p.y, p.x) / DEG, lat = Math.asin(clamp(p.z, -1, 1)) / DEG;
        if (isLand(lon, lat)) {
          const light = clamp(0.3 * vz + 0.75 * smooth(-0.15, 0.6, dot3(p, sun)), 0, 0.999);
          ctx.globalAlpha = 0.3 + 0.62 * vz * (0.45 + 0.55 * light);
          ctx.fillText(GLYPHS[Math.floor(light * GLYPHS.length)]!, px, py);
        } else if (d2 > 0.9) {
          ctx.globalAlpha = 0.22;
          ctx.fillText("·", px, py);
        }
      }
    }
  }

  private landSweep(B: Basis, time: number) {
    const { ctx, R, cx, cy } = this;
    const d = this.dots!;
    // the graticule, every 30°, as dotted lines
    ctx.fillStyle = this.pal.soft;
    const dot = (p: V3, a: number) => {
      const vz = p.x * B.cx + p.y * B.cy + p.z * B.cz;
      if (vz < 0) return;
      ctx.globalAlpha = a * (0.35 + 0.65 * vz);
      ctx.fillRect(cx + R * (p.x * B.ex + p.y * B.ey + p.z * B.ez) - 0.5, cy - R * (p.x * B.nx + p.y * B.ny + p.z * B.nz) - 0.5, 1, 1);
    };
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -84; lat <= 84; lat += 3) dot(lonLat(lon, lat), 0.16);
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 3) dot(lonLat(lon, lat), 0.16);
    // the sweep heads east; land lights as it passes and fades over the next ~100°
    const sweep = ((time * 360) / SWEEP_S) % 360;
    const lit = new Float32Array(d.length / 4);
    for (let i = 0, k = 0; i < d.length; i += 4, k++) {
      const behind = (((sweep - (d[i + 3]! + 180)) % 360) + 360) % 360;
      lit[k] = behind < 140 ? Math.exp(-behind / 30) : 0;
    }
    for (const pass of [0, 1]) {
      ctx.fillStyle = pass ? this.pal.accent : this.pal.soft;
      for (let i = 0, k = 0; i < d.length; i += 4, k++) {
        const x = d[i]!, y = d[i + 1]!, z = d[i + 2]!;
        const vz = x * B.cx + y * B.cy + z * B.cz;
        if (vz < 0) continue;
        const l = lit[k]!;
        if (pass && l < 0.3) continue;
        const size = 0.7 + 1.1 * vz;
        ctx.globalAlpha = pass ? 0.75 * l * (0.4 + 0.6 * vz) : (0.12 + 0.22 * vz) + 0.5 * l * (0.4 + 0.6 * vz);
        ctx.fillRect(cx + R * (x * B.ex + y * B.ey + z * B.ez) - size / 2, cy - R * (x * B.nx + y * B.ny + z * B.nz) - size / 2, size, size);
      }
    }
    // the sweep line itself, pole to pole
    ctx.strokeStyle = this.pal.accent;
    ctx.lineWidth = 1.2;
    let prev: { x: number; y: number } | null = null;
    for (let lat = -90; lat <= 90; lat += 2) {
      const p = lonLat(sweep - 180, lat);
      const vz = p.x * B.cx + p.y * B.cy + p.z * B.cz;
      const q = { x: cx + R * (p.x * B.ex + p.y * B.ey + p.z * B.ez), y: cy - R * (p.x * B.nx + p.y * B.ny + p.z * B.nz) };
      if (vz < 0) {
        prev = null;
        continue;
      }
      if (prev) {
        ctx.globalAlpha = 0.25 + 0.5 * vz;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
      prev = q;
    }
    this.limb(0.22);
  }

  /* ---------------------------------------------------------------- arcs */

  /** Screen x, y and visibility (0 hidden, up to 1) per point. A lifted point behind the sphere stays visible while it clears the limb. */
  private project(arc: Arc, B: Basis): Float32Array {
    const { R, cx, cy } = this;
    const out = new Float32Array(arc.pts.length * 3);
    arc.pts.forEach((p, i) => {
      const x = p.x * B.ex + p.y * B.ey + p.z * B.ez;
      const y = p.x * B.nx + p.y * B.ny + p.z * B.nz;
      const z = p.x * B.cx + p.y * B.cy + p.z * B.cz;
      out[3 * i] = cx + R * x;
      out[3 * i + 1] = cy - R * y;
      out[3 * i + 2] = z >= 0 ? 0.55 + 0.45 * Math.min(1, z / 0.3) : x * x + y * y >= 1 ? 0.45 : 0;
    });
    return out;
  }

  /** The path from u0 to u1 (fractions of its length) as segments, each alpha(u) times its visibility. */
  private strokeArc(pa: Float32Array, u0: number, u1: number, alpha: (u: number) => number, width: number) {
    const { ctx } = this;
    const n = pa.length / 3 - 1;
    const f1 = u1 * n;
    ctx.strokeStyle = this.pal.accent;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    for (let k = Math.max(1, Math.floor(u0 * n) + 1); k <= Math.ceil(f1); k++) {
      const va = pa[3 * (k - 1) + 2]!, vb = pa[3 * k + 2]!;
      if (!va || !vb) continue;
      const f = Math.min(1, f1 - (k - 1));
      const ax = pa[3 * (k - 1)]!, ay = pa[3 * (k - 1) + 1]!;
      ctx.globalAlpha = alpha(k / n) * Math.min(va, vb);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + (pa[3 * k]! - ax) * f, ay + (pa[3 * k + 1]! - ay) * f);
      ctx.stroke();
    }
  }

  /** The point at fraction u along the path: [x, y, visibility]. */
  private at(pa: Float32Array, u: number): [number, number, number] {
    const n = pa.length / 3 - 1;
    const f = clamp(u, 0, 1) * n;
    const k = Math.min(n - 1, Math.floor(f)), t = f - k;
    const v = Math.min(pa[3 * k + 2]!, pa[3 * (k + 1) + 2]!);
    return [pa[3 * k]! + (pa[3 * (k + 1)]! - pa[3 * k]!) * t, pa[3 * k + 1]! + (pa[3 * (k + 1) + 1]! - pa[3 * k + 1]!) * t, v];
  }

  private head(pa: Float32Array, u: number, ascii: boolean) {
    const [x, y, v] = this.at(pa, u);
    if (!v) return;
    const { ctx } = this;
    ctx.globalAlpha = v;
    if (ascii) {
      this.glyph("@", x, y, this.pal.accent, v);
      return;
    }
    ctx.fillStyle = this.pal.ink;
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Pulses run origin to target every PULSE_S once the route is drawn; each arrival rings at the target. */
  private pulses(pa: Float32Array, t: number, ascii: boolean) {
    const { ctx } = this;
    // the ring of the draw-in's own arrival, then one per pulse
    const arrivals = [0];
    const k = Math.floor((t - FIRST_PULSE_S - TRAVEL_S) / PULSE_S);
    for (const j of [k - 1, k]) if (j >= 0) arrivals.push(FIRST_PULSE_S + j * PULSE_S + TRAVEL_S);
    const [tx, ty, tv] = this.at(pa, 1);
    if (tv) {
      for (const a of arrivals) {
        const e = (t - a) / RING_S;
        if (e < 0 || e > 1) continue;
        const r = 3 + 15 * ease(e);
        if (ascii) this.glyphRing(tx, ty, r, 0.9 * (1 - e));
        else {
          ctx.globalAlpha = 0.85 * Math.pow(1 - e, 1.5) * tv;
          ctx.strokeStyle = this.pal.hit;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(tx, ty, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    // the pulse in flight
    const inFlight = t >= FIRST_PULSE_S ? ((t - FIRST_PULSE_S) % PULSE_S) / TRAVEL_S : -1;
    if (inFlight >= 0 && inFlight <= 1) {
      const u = ease(inFlight);
      if (ascii) {
        const [x, y, v] = this.at(pa, u);
        if (v) this.glyph("*", x, y, this.pal.ink, v);
        return;
      }
      this.strokeArc(pa, Math.max(0, u - 0.14), u, (w) => clamp(1 - (u - w) / 0.14, 0, 1), 2.2);
      const [x, y, v] = this.at(pa, u);
      if (v) {
        ctx.globalAlpha = v;
        ctx.fillStyle = this.pal.ink;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private glyph(ch: string, x: number, y: number, color: string, alpha: number) {
    const { ctx } = this;
    const g = this.grid();
    const i = Math.round((x - g.x0) / this.cw - 0.5), j = Math.round((y - g.y0) / this.rowH - 0.5);
    const gx = g.x0 + (i + 0.5) * this.cw, gy = g.y0 + (j + 0.5) * this.rowH;
    ctx.font = `${this.glyphPx + 2}px ${this.pal.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // knock out the land glyph under it so the two never overprint
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.pal.ground;
    ctx.fillRect(gx - this.cw / 2, gy - this.rowH / 2, this.cw, this.rowH);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillText(ch, gx, gy);
  }

  private glyphRing(x: number, y: number, r: number, alpha: number) {
    const seen = new Set<string>();
    const g = this.grid();
    for (let a = 0; a < 360; a += 15) {
      const px = x + r * Math.cos(a * DEG), py = y + r * Math.sin(a * DEG) * 0.8;
      const key = `${Math.round((px - g.x0) / this.cw)}:${Math.round((py - g.y0) / this.rowH)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.glyph("·", px, py, this.pal.hit, alpha);
    }
  }

  /** The route in line characters snapped to the land's grid: - / | \ by the local direction, brighter towards the head. */
  private glyphArc(pa: Float32Array, upto: number, alpha: number, drawing: boolean) {
    const g = this.grid();
    const n = pa.length / 3 - 1;
    const last = Math.floor(clamp(upto, 0, 1) * n);
    let prevKey = "";
    let px = pa[0]!, py = pa[1]!;
    for (let k = 1; k <= last; k++) {
      const v = pa[3 * k + 2]!;
      const x = pa[3 * k]!, y = pa[3 * k + 1]!;
      if (!v) {
        px = x;
        py = y;
        continue;
      }
      const key = `${Math.round((x - g.x0) / this.cw - 0.5)}:${Math.round((y - g.y0) / this.rowH - 0.5)}`;
      if (key === prevKey) continue;
      prevKey = key;
      const ang = Math.atan2(-(y - py), x - px) / DEG;
      const a = ((ang % 180) + 180) % 180;
      const ch = a < 22.5 || a >= 157.5 ? "-" : a < 67.5 ? "/" : a < 112.5 ? "|" : "\\";
      const u = k / Math.max(1, last);
      this.glyph(ch, x, y, this.pal.accent, alpha * v * (drawing ? 0.35 + 0.65 * u * u : 0.8));
      px = x;
      py = y;
    }
  }

  /* -------------------------------------------------------------- labels */

  private labels(arc: Arc, pa: Float32Array, drawn: number, ascii: boolean) {
    const ends: { u: number; text: string; color: string; show: number }[] = arc.self
      ? [{ u: 0, text: plainName(arc.route.origin_name), color: this.pal.ink, show: smooth(0.05, 0.25, drawn) }]
      : [
          { u: 0, text: plainName(arc.route.origin_name), color: this.pal.soft, show: smooth(0.02, 0.2, drawn) },
          { u: 1, text: plainName(arc.route.target_name), color: this.pal.ink, show: smooth(0.85, 1, drawn) },
        ];
    const { ctx } = this;
    ctx.font = `12px ${this.pal.mono}`;
    ctx.textBaseline = "middle";
    const placed: { x: number; y: number; w: number }[] = [];
    for (const e of ends) {
      const [x, y, v] = this.at(pa, e.u);
      if (!v || e.show <= 0 || this.R < 80) continue;
      // the end marker
      ctx.globalAlpha = e.show * v;
      if (!ascii) {
        ctx.fillStyle = e.u === 0 && !arc.self ? this.pal.accent : this.pal.hit;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      // the label sits outward from the globe's centre, so it points away from the route
      const dx = x - this.cx, dy = y - this.cy;
      const right = dx >= 0;
      const text = ascii ? `[${e.text}]` : e.text;
      const tw = ctx.measureText(text).width;
      let lx = right ? x + 8 : x - 8 - tw;
      let ly = y + (Math.abs(dy) > this.R * 0.55 ? Math.sign(dy) * 12 : 0);
      lx = clamp(lx, 2, this.w - tw - 2);
      ly = clamp(ly, 8, this.h - 8);
      // the second label moves off the first when they would touch
      for (const p of placed) if (Math.abs(p.y - ly) < 15 && lx < p.x + p.w + 6 && lx + tw + 6 > p.x) ly = p.y + (ly >= p.y ? 16 : -16);
      placed.push({ x: lx, y: ly, w: tw });
      ctx.globalAlpha = 0.86 * e.show * Math.min(1, v + 0.2);
      ctx.fillStyle = this.pal.ground;
      ctx.fillRect(lx - 3, ly - 8, tw + 6, 16);
      ctx.globalAlpha = e.show * Math.min(1, v + 0.2);
      ctx.fillStyle = e.color;
      ctx.textAlign = "left";
      ctx.fillText(text, lx, ly + 0.5);
    }
  }
}
