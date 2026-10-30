import type { InternetRoute } from "../useInternet";
import { basis, clamp, DEG, dot3, landDots, lonLat, place, plainName, rotate, slerp, subsolar, toLonLat, type Basis, type V3 } from "./geo";

/**
 * Draws one frame of the globe on a 2D canvas: the land as dots lit by the
 * real Sun at this moment (bright where it is day, dim where it is night,
 * the terminator dotted), the route in focus drawing in like a comet,
 * ringing where it lands and pulsing, the other routes as faint hairlines,
 * and the two countries named. No glow and no blur: depth and light come
 * from alpha and dot size only. Labels are 12 px.
 */

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
  /** Epoch milliseconds, for the Sun. */
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
}

export interface Palette {
  accent: string;
  ink: string;
  soft: string;
  hit: string;
  ground: string;
  mono: string;
}

/** Seconds between pulses along the focus route once it is drawn. */
const PULSE_S = 1.8;
const TRAVEL_S = 0.9;
const FIRST_PULSE_S = 0.5;
const RING_S = 1.3;
/** Degrees between land dots. */
const DOT_STEP = 1.25;

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
  private readonly dots: Float32Array;

  constructor(
    private canvas: HTMLCanvasElement,
    private pal: Palette,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.dots = landDots(DOT_STEP);
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
  }

  draw(s: Scene) {
    this.ctx.clearRect(0, 0, this.w, this.h);
    const B = basis(s.lon, s.lat);
    this.land(B, s.now);
    s.arcs.forEach((arc, i) => {
      if (i === s.focus || i === s.fade) return;
      this.strokeArc(this.project(arc, B), 0, 1, () => 0.13, 0.8);
    });
    if (s.fade >= 0 && s.fade !== s.focus && s.arcs[s.fade] && s.fadeAlpha > 0) {
      this.strokeArc(this.project(s.arcs[s.fade]!, B), 0, 1, () => 0.5 * s.fadeAlpha, 1.3);
    }
    const arc = s.arcs[s.focus];
    if (!arc || s.drawn <= 0) return;
    const pa = this.project(arc, B);
    if (s.drawn < 1) {
      this.strokeArc(pa, 0, s.drawn, (u) => 0.22 + 0.78 * Math.pow(u / s.drawn, 3), 1.6);
      this.head(pa, s.drawn);
    } else this.strokeArc(pa, 0, 1, () => 0.5, 1.4);
    if (s.pulse >= 0) this.pulses(pa, s.pulse);
    this.labels(arc, pa, s.drawn);
  }

  /* ---------------------------------------------------------------- land */

  private land(B: Basis, now: number) {
    const { ctx, R, cx, cy } = this;
    const d = this.dots;
    const [slon, slat] = subsolar(now);
    const sun = lonLat(slon, slat);
    // the sphere's body, one faint fill
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(150,160,185,0.03)";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    // night first, then twilight and day over it: two fill colours in all
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
    const ul = Math.hypot(sun.y, sun.x) || 1;
    const u = { x: sun.y / ul, y: -sun.x / ul, z: 0 };
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
    // the limb, one hairline
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(160,170,195,0.2)";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
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

  private dot(x: number, y: number, r: number, alpha: number) {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.pal.ink;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private head(pa: Float32Array, u: number) {
    const [x, y, v] = this.at(pa, u);
    if (v) this.dot(x, y, 2.4, v);
  }

  /** Pulses run origin to target every PULSE_S once the route is drawn; each arrival rings at the target. */
  private pulses(pa: Float32Array, t: number) {
    const { ctx } = this;
    // the ring of the draw-in's own arrival, then one per pulse
    const arrivals = [0];
    const k = Math.floor((t - FIRST_PULSE_S - TRAVEL_S) / PULSE_S);
    for (const j of [k - 1, k]) if (j >= 0) arrivals.push(FIRST_PULSE_S + j * PULSE_S + TRAVEL_S);
    const [tx, ty, tv] = this.at(pa, 1);
    if (tv) {
      ctx.strokeStyle = this.pal.hit;
      ctx.lineWidth = 1.2;
      for (const a of arrivals) {
        const e = (t - a) / RING_S;
        if (e < 0 || e > 1) continue;
        ctx.globalAlpha = 0.85 * Math.pow(1 - e, 1.5) * tv;
        ctx.beginPath();
        ctx.arc(tx, ty, 3 + 15 * ease(e), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // the pulse in flight, with a short tail
    const inFlight = t >= FIRST_PULSE_S ? ((t - FIRST_PULSE_S) % PULSE_S) / TRAVEL_S : -1;
    if (inFlight < 0 || inFlight > 1) return;
    const u = ease(inFlight);
    this.strokeArc(pa, Math.max(0, u - 0.14), u, (w) => clamp(1 - (u - w) / 0.14, 0, 1), 2.2);
    const [x, y, v] = this.at(pa, u);
    if (v) this.dot(x, y, 2.2, v);
  }

  /* -------------------------------------------------------------- labels */

  private labels(arc: Arc, pa: Float32Array, drawn: number) {
    const ends: { u: number; text: string; color: string; show: number }[] = arc.self
      ? [{ u: 0, text: plainName(arc.route.origin_name), color: this.pal.ink, show: smooth(0.05, 0.25, drawn) }]
      : [
          { u: 0, text: plainName(arc.route.origin_name), color: this.pal.soft, show: smooth(0.02, 0.2, drawn) },
          { u: 1, text: plainName(arc.route.target_name), color: this.pal.ink, show: smooth(0.85, 1, drawn) },
        ];
    const { ctx } = this;
    ctx.font = `12px ${this.pal.mono}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const placed: { x: number; y: number; w: number }[] = [];
    for (const e of ends) {
      const [x, y, v] = this.at(pa, e.u);
      if (!v || e.show <= 0 || this.R < 80) continue;
      // the end marker: amber where the attacks come from, red where they land
      ctx.globalAlpha = e.show * v;
      ctx.fillStyle = e.u === 0 && !arc.self ? this.pal.accent : this.pal.hit;
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      // the label sits outward from the globe's centre, so it points away from the route
      const dx = x - this.cx, dy = y - this.cy;
      const tw = ctx.measureText(e.text).width;
      let lx = dx >= 0 ? x + 8 : x - 8 - tw;
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
      ctx.fillText(e.text, lx, ly + 0.5);
    }
  }
}
