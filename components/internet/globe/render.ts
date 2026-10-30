import type { Stop } from "../tour";
import type { InternetRoute } from "../useInternet";
import { basis, clamp, countryAt, countryName, DEG, dot3, landDots, lonLat, place, plainName, rotate, slerp, subsolar, toLonLat, type Basis, type V3 } from "./geo";

/**
 * Draws one frame of the globe on a 2D canvas: the land as dots lit by the
 * real Sun at this moment (bright where it is day, dim where it is night,
 * the terminator dotted), faint hairlines for the other DDoS routes, and the
 * stop in focus animated by what it is:
 *
 *   ddos    the route draws in from the attacking country, then floods: a
 *           stream of small dots and rings landing one after another
 *   route   the same route with one pulse at a time (an older Worker's data)
 *   hijack  a dashed route from the hijacker to the victim, ripples spreading
 *           from the hijacker as it announces the victim's addresses
 *   waf     darts leaving the origin in every direction, each stopped by a
 *           shield (the WAF names no target, so none is drawn)
 *   outage  the country's dots go dark, flickering as they fall; an outage
 *           that has ended lights up again
 *
 * No glow and no blur: depth and light come from alpha and dot size only.
 * Labels are 12 px.
 */

/** A lifted path over the sphere: Earth-fixed points from its first end to its last. */
export interface Path {
  pts: V3[];
  /** The camera centre that shows the whole path: [lon, lat] in radians. */
  view: [number, number];
  /** Both ends in one country: a small loop over it. */
  self: boolean;
}

export interface Arc extends Path {
  route: InternetRoute;
}

const ARC_N = 64;
/** Camera latitudes stay within this, so a polar place still shows the globe's face. */
const VIEW_LAT = 50;

/** The path from one country to another as a lifted great circle (or a loop over one country), or null when a code has no place on the map. */
export function pathBetween(from: string, to: string): Path | null {
  const a = place(from), b = place(to);
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
    return { pts, view: [vl * DEG, clamp(vp, -VIEW_LAT, VIEW_LAT) * DEG], self: true };
  }
  const lift = 0.04 + 0.12 * (span / Math.PI);
  for (let i = 0; i <= ARC_N; i++) {
    const t = i / ARC_N;
    const p = slerp(a, b, t);
    const h = 1 + lift * Math.sin(Math.PI * t);
    pts.push({ x: p.x * h, y: p.y * h, z: p.z * h });
  }
  const [vl, vp] = toLonLat(slerp(a, b, 0.5));
  return { pts, view: [vl * DEG, clamp(vp, -VIEW_LAT, VIEW_LAT) * DEG], self: false };
}

/** An attack route as a path, or null when a code has no place on the map. */
export function buildArc(route: InternetRoute): Arc | null {
  const p = pathBetween(route.origin, route.target);
  return p ? { ...p, route } : null;
}

type Tone = "ink" | "soft" | "accent" | "hit";

/** One end of a path, or a point, with its label: the marker's colour and the text's. */
interface End {
  text: string;
  marker: Tone;
  color: Tone;
}

/** What the globe draws for one stop. */
export type Visual =
  | { kind: "ddos" | "route" | "hijack"; key: string; path: Path; view: [number, number]; ends: [End, End] }
  | { kind: "waf"; key: string; at: V3; view: [number, number]; end: End }
  | { kind: "outage"; key: string; at: V3; view: [number, number]; end: End; code: string; depth: number; ended: boolean };

const pointView = (p: V3): [number, number] => {
  const [lon, lat] = toLonLat(p);
  return [lon * DEG, clamp(lat, -VIEW_LAT, VIEW_LAT) * DEG];
};

/** The visual for a stop, or null when a place is missing (the tour only holds stops with places, so this is a guard). */
export function buildVisual(stop: Stop, key: string): Visual | null {
  switch (stop.kind) {
    case "ddos":
    case "route": {
      const path = pathBetween(stop.route.origin, stop.route.target);
      if (!path) return null;
      return {
        kind: stop.kind,
        key,
        path,
        view: path.view,
        ends: [
          { text: plainName(stop.route.origin_name), marker: "accent", color: "soft" },
          { text: plainName(stop.route.target_name), marker: "hit", color: "ink" },
        ],
      };
    }
    case "hijack": {
      const path = pathBetween(stop.hijacker.country, stop.victim.country);
      if (!path) return null;
      return {
        kind: "hijack",
        key,
        path,
        view: path.view,
        ends: [
          { text: plainName(countryName(stop.hijacker.country)), marker: "accent", color: "accent" },
          { text: plainName(countryName(stop.victim.country)), marker: "hit", color: "ink" },
        ],
      };
    }
    case "waf": {
      const at = place(stop.origin.country);
      return at ? { kind: "waf", key, at, view: pointView(at), end: { text: plainName(stop.origin.name), marker: "accent", color: "ink" } } : null;
    }
    case "outage": {
      const at = place(stop.code);
      if (!at) return null;
      return {
        kind: "outage",
        key,
        at,
        view: pointView(at),
        end: { text: plainName(countryName(stop.code)), marker: "hit", color: "hit" },
        code: stop.code,
        // a nationwide outage darkens the whole country; a regional or network one darkens it partly, since the drawing cannot place the region
        depth: stop.event.type === "nationwide" ? 0.88 : 0.6,
        ended: !!stop.event.until,
      };
    }
  }
}

export interface Scene {
  /** Camera centre in radians. */
  lon: number;
  lat: number;
  /** Epoch milliseconds, for the Sun. */
  now: number;
  /** The other DDoS routes, as faint hairlines. */
  context: Arc[];
  focus: Visual | null;
  /** How far the focus has drawn in, 0 to 1. */
  drawn: number;
  /** Seconds since the focus finished drawing in, or -1 before (and always under reduced motion). */
  pulse: number;
  /** The previous focus, fading out, and its remaining alpha. */
  fade: Visual | null;
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

/** Seconds between pulses along a plain route once it is drawn. */
const PULSE_S = 1.8;
const TRAVEL_S = 0.9;
const FIRST_PULSE_S = 0.5;
const RING_S = 1.3;
/** A flood: dots in flight at once, and seconds between landings. */
const FLOOD_N = 30;
const FLOOD_RING_S = 0.55;
/** A hijack's announcement: seconds between ripples. */
const RIPPLE_S = 1.3;
/** Exploit darts: seconds between launches and of flight. */
const DART_S = 0.2;
const DART_FLIGHT_S = 0.45;
const SHIELD_S = 0.55;
/** An outage: seconds the lights take to fall, and when an ended one comes back. */
const DARKEN_S = 1.2;
const RELIGHT: [number, number] = [4.4, 5.8];
/** Degrees around a country too small for the country cells that an outage darkens. */
const SMALL_COUNTRY = 2.5;
/** Degrees between land dots. */
const DOT_STEP = 1.25;

const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const frac = (x: number) => x - Math.floor(x);

/** How dark one country's dots are drawn this frame. */
interface Dim {
  /** 1-based index into the renderer's dot owners, or 0 for a country with no dots of its own. */
  owner: number;
  at: V3;
  level: number;
}

export class GlobeRenderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private R = 0;
  private cx = 0;
  private cy = 0;
  private readonly dots: Float32Array;
  /** Per dot, 1 + the index of its country in `owners`, or 0 at no country. */
  private readonly dotOwner: Uint8Array;
  private readonly owners = new Map<string, number>();

  constructor(
    private canvas: HTMLCanvasElement,
    private pal: Palette,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.dots = landDots(DOT_STEP);
    this.dotOwner = new Uint8Array(this.dots.length / 4);
    for (let i = 0; i < this.dots.length; i += 4) {
      const code = countryAt(this.dots[i + 3]!, Math.asin(clamp(this.dots[i + 2]!, -1, 1)) / DEG);
      if (!code) continue;
      if (!this.owners.has(code)) this.owners.set(code, this.owners.size + 1);
      this.dotOwner[i / 4] = this.owners.get(code)!;
    }
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
    this.land(B, s.now, this.dimming(s));
    const routeOf = (v: Visual | null) => (v && (v.kind === "ddos" || v.kind === "route") ? v.key.slice(v.key.indexOf(":") + 1) : "");
    const skip = new Set([routeOf(s.focus), routeOf(s.fade)]);
    for (const arc of s.context) {
      if (skip.has(`${arc.route.origin}>${arc.route.target}`)) continue;
      this.strokeArc(this.project(arc.pts, B), 0, 1, () => 0.13, 0.8);
    }
    if (s.fade && s.fade !== s.focus && s.fadeAlpha > 0 && "path" in s.fade) {
      this.strokeArc(this.project(s.fade.path.pts, B), 0, 1, () => 0.5 * s.fadeAlpha, 1.3, s.fade.kind === "hijack");
    }
    const v = s.focus;
    if (!v || s.drawn <= 0) return;
    if (v.kind === "waf") return this.exploits(v, B, s.drawn, s.pulse);
    if (v.kind === "outage") return this.outage(v, B, s.drawn, s.pulse);
    const pa = this.project(v.path.pts, B);
    const dashed = v.kind === "hijack";
    if (s.drawn < 1) {
      this.strokeArc(pa, 0, s.drawn, (u) => 0.22 + 0.78 * Math.pow(u / s.drawn, 3), 1.6, dashed);
      this.head(pa, s.drawn);
    } else this.strokeArc(pa, 0, 1, () => (v.kind === "ddos" ? 0.42 : 0.5), 1.4, dashed);
    if (s.pulse >= 0) {
      if (v.kind === "ddos") this.flood(pa, s.pulse);
      else if (v.kind === "hijack") this.announce(pa, s.pulse);
      else this.pulses(pa, s.pulse);
    } else if (s.drawn >= 1 && v.kind === "hijack") this.announce(pa, RIPPLE_S * 0.5, true);
    const [a, b] = v.ends;
    const ends = v.path.self ? [{ u: 0, end: { ...b, marker: v.kind === "hijack" ? ("accent" as const) : b.marker }, show: smooth(0.05, 0.25, s.drawn) }] : [
      { u: 0, end: a, show: smooth(0.02, 0.2, s.drawn) },
      { u: 1, end: b, show: smooth(0.85, 1, s.drawn) },
    ];
    this.labels(ends.map(({ u, end, show }) => ({ at: this.at(pa, u), end, show })));
  }

  /* ---------------------------------------------------------------- land */

  /** The outage on screen (or fading out) as a darkened country, or null. */
  private dimming(s: Scene): Dim | null {
    const v = s.focus?.kind === "outage" ? s.focus : s.fade?.kind === "outage" ? s.fade : null;
    if (!v) return null;
    let k: number;
    if (v === s.focus) {
      if (s.pulse < 0) k = s.drawn >= 1 ? 1 : 0.3 * s.drawn;
      else {
        k = clamp(0.3 + s.pulse / DARKEN_S, 0, 1);
        // the lights stutter as they go
        if (k < 1) k *= Math.sin(s.now / 26) > 0 ? 1 : 0.7;
        if (v.ended) k *= 1 - smooth(RELIGHT[0], RELIGHT[1], s.pulse);
      }
    } else k = v.ended ? 0 : s.fadeAlpha;
    return k > 0 ? { owner: this.owners.get(v.code) ?? 0, at: v.at, level: v.depth * k } : null;
  }

  private land(B: Basis, now: number, dim: Dim | null) {
    const { ctx, R, cx, cy } = this;
    const d = this.dots;
    const [slon, slat] = subsolar(now);
    const sun = lonLat(slon, slat);
    const near = Math.cos(SMALL_COUNTRY * DEG);
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
        let a = pass ? day : 1 - day;
        if (dim && (dim.owner ? this.dotOwner[i / 4] === dim.owner : x * dim.at.x + y * dim.at.y + z * dim.at.z > near)) a *= 1 - dim.level;
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
  private project(pts: V3[], B: Basis): Float32Array {
    const { R, cx, cy } = this;
    const out = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => {
      const x = p.x * B.ex + p.y * B.ey + p.z * B.ez;
      const y = p.x * B.nx + p.y * B.ny + p.z * B.nz;
      const z = p.x * B.cx + p.y * B.cy + p.z * B.cz;
      out[3 * i] = cx + R * x;
      out[3 * i + 1] = cy - R * y;
      out[3 * i + 2] = z >= 0 ? 0.55 + 0.45 * Math.min(1, z / 0.3) : x * x + y * y >= 1 ? 0.45 : 0;
    });
    return out;
  }

  /** The path from u0 to u1 (fractions of its length) as segments, each alpha(u) times its visibility; dashed draws every other segment. */
  private strokeArc(pa: Float32Array, u0: number, u1: number, alpha: (u: number) => number, width: number, dashed = false) {
    const { ctx } = this;
    const n = pa.length / 3 - 1;
    const f1 = u1 * n;
    ctx.strokeStyle = this.pal.accent;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    for (let k = Math.max(1, Math.floor(u0 * n) + 1); k <= Math.ceil(f1); k++) {
      if (dashed && k % 2) continue;
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

  /** A point on the sphere on screen: [x, y, visibility], 0 when it faces away. */
  private point(p: V3, B: Basis): [number, number, number] {
    const z = p.x * B.cx + p.y * B.cy + p.z * B.cz;
    return [this.cx + this.R * (p.x * B.ex + p.y * B.ey + p.z * B.ez), this.cy - this.R * (p.x * B.nx + p.y * B.ny + p.z * B.nz), z > 0 ? 0.55 + 0.45 * Math.min(1, z / 0.3) : 0];
  }

  private dot(x: number, y: number, r: number, alpha: number, color = this.pal.ink) {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private ring(x: number, y: number, r: number, alpha: number, color: string, width = 1.2) {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.stroke();
  }

  private head(pa: Float32Array, u: number) {
    const [x, y, v] = this.at(pa, u);
    if (v) this.dot(x, y, 2.4, v);
  }

  /** A plain route: pulses run origin to target every PULSE_S once it is drawn; each arrival rings at the target. */
  private pulses(pa: Float32Array, t: number) {
    // the ring of the draw-in's own arrival, then one per pulse
    const arrivals = [0];
    const k = Math.floor((t - FIRST_PULSE_S - TRAVEL_S) / PULSE_S);
    for (const j of [k - 1, k]) if (j >= 0) arrivals.push(FIRST_PULSE_S + j * PULSE_S + TRAVEL_S);
    const [tx, ty, tv] = this.at(pa, 1);
    if (tv) {
      for (const a of arrivals) {
        const e = (t - a) / RING_S;
        if (e >= 0 && e <= 1) this.ring(tx, ty, 3 + 15 * ease(e), 0.85 * Math.pow(1 - e, 1.5) * tv, this.pal.hit);
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

  /** A DDoS flood: many small dots streaming at slightly different speeds, and rings landing close together at the target. */
  private flood(pa: Float32Array, t: number) {
    const { ctx } = this;
    const fadeIn = clamp(t / 0.8, 0, 1);
    ctx.fillStyle = this.pal.hit;
    for (let i = 0; i < FLOOD_N; i++) {
      const speed = 0.42 + 0.3 * frac(i * 0.618034);
      const u = frac(t * speed + frac(i * 0.381966 + 0.13));
      const [x, y, v] = this.at(pa, u);
      if (!v) continue;
      ctx.globalAlpha = fadeIn * (0.22 + 0.68 * u) * v;
      ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
    }
    const [tx, ty, tv] = this.at(pa, 1);
    if (!tv) return;
    const k = Math.floor(t / FLOOD_RING_S);
    for (let j = Math.max(1, k - 2); j <= k; j++) {
      const e = (t - j * FLOOD_RING_S) / (FLOOD_RING_S * 2);
      if (e >= 0 && e <= 1) this.ring(tx, ty, 3 + 12 * ease(e), 0.7 * Math.pow(1 - e, 1.5) * tv * fadeIn, this.pal.hit);
    }
  }

  /** A hijack: ripples spread from the hijacker as it announces, a dash runs to the victim, and the victim rings as it lands. */
  private announce(pa: Float32Array, t: number, still = false) {
    const [hx, hy, hv] = this.at(pa, 0);
    if (hv) {
      const k = Math.floor(t / RIPPLE_S);
      for (let j = Math.max(0, k - 1); j <= k; j++) {
        const e = (t - j * RIPPLE_S) / (RIPPLE_S * 1.25);
        if (e >= 0 && e <= 1) this.ring(hx, hy, 4 + 26 * easeOut(e), 0.6 * Math.pow(1 - e, 1.4) * hv, this.pal.accent);
      }
    }
    if (still) return;
    const inFlight = (t % RIPPLE_S) / (RIPPLE_S * 0.7);
    if (inFlight <= 1) {
      const u = ease(inFlight);
      this.strokeArc(pa, Math.max(0, u - 0.12), u, (w) => clamp(1 - (u - w) / 0.12, 0, 1), 2);
    }
    const [vx, vy, vv] = this.at(pa, 1);
    const e = ((t % RIPPLE_S) - RIPPLE_S * 0.7) / (RIPPLE_S * 0.8);
    if (vv && e >= 0 && e <= 1) this.ring(vx, vy, 3 + 11 * ease(e), 0.8 * Math.pow(1 - e, 1.5) * vv, this.pal.hit);
  }

  /** Exploit attempts from one country: darts leave in turn, each stopped by a shield; under reduced motion, the shields alone. */
  private exploits(v: Extract<Visual, { kind: "waf" }>, B: Basis, drawn: number, t: number) {
    const [x, y, vis] = this.point(v.at, B);
    if (!vis) return;
    const { ctx } = this;
    const R0 = clamp(this.R * 0.24, 20, 34);
    const show = smooth(0, 1, drawn) * vis;
    ctx.lineCap = "round";
    if (t < 0) {
      for (let j = 0; j < 7; j++) this.shield(x, y, R0, (j * 2 * Math.PI) / 7, 0.45 * show);
    } else {
      const k = Math.floor(t / DART_S);
      for (let j = Math.max(0, k - 6); j <= k; j++) {
        const age = t - j * DART_S;
        const th = j * 2.39996;
        if (age < DART_FLIGHT_S) {
          const r = 4 + (R0 - 6) * easeOut(age / DART_FLIGHT_S);
          ctx.globalAlpha = 0.9 * show;
          ctx.strokeStyle = this.pal.ink;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(th) * Math.max(3, r - 7), y + Math.sin(th) * Math.max(3, r - 7));
          ctx.lineTo(x + Math.cos(th) * r, y + Math.sin(th) * r);
          ctx.stroke();
        } else if (age < DART_FLIGHT_S + SHIELD_S) this.shield(x, y, R0, th, 0.9 * (1 - (age - DART_FLIGHT_S) / SHIELD_S) * show);
      }
    }
    ctx.globalAlpha = show;
    ctx.fillStyle = this.pal.accent;
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    this.labels([{ at: [x, y, vis], end: v.end, show: smooth(0.1, 0.4, drawn), offset: R0 }]);
  }

  private shield(x: number, y: number, r: number, th: number, alpha: number) {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this.pal.accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, r, th - 0.32, th + 0.32);
    ctx.stroke();
  }

  /** An outage: the country darkens (see `dimming`); slow rings go out from it. */
  private outage(v: Extract<Visual, { kind: "outage" }>, B: Basis, drawn: number, t: number) {
    const [x, y, vis] = this.point(v.at, B);
    if (!vis) return;
    const show = smooth(0, 1, drawn) * vis;
    if (t >= 0) {
      const k = Math.floor(t / 2);
      for (let j = Math.max(0, k - 1); j <= k; j++) {
        const e = (t - j * 2) / 2.6;
        if (e >= 0 && e <= 1) this.ring(x, y, 6 + 24 * easeOut(e), 0.5 * Math.pow(1 - e, 1.4) * show, this.pal.hit);
      }
    }
    this.ctx.globalAlpha = show;
    this.ctx.fillStyle = this.pal.hit;
    this.ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    this.labels([{ at: [x, y, vis], end: v.end, show: smooth(0.1, 0.4, drawn), offset: 10 }]);
  }

  /* -------------------------------------------------------------- labels */

  private tone(t: Tone) {
    return t === "ink" ? this.pal.ink : t === "soft" ? this.pal.soft : t === "accent" ? this.pal.accent : this.pal.hit;
  }

  /** End markers and their labels, set outward from the globe's centre so they point away from the route, the second moved off the first when they would touch. */
  private labels(items: { at: [number, number, number]; end: End; show: number; offset?: number }[]) {
    const { ctx } = this;
    ctx.font = `12px ${this.pal.mono}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const placed: { x: number; y: number; w: number }[] = [];
    for (const { at: [x, y, v], end, show, offset = 0 } of items) {
      if (!v || show <= 0 || this.R < 80) continue;
      ctx.globalAlpha = show * v;
      ctx.fillStyle = this.tone(end.marker);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      const dx = x - this.cx, dy = y - this.cy;
      const tw = ctx.measureText(end.text).width;
      let lx = dx >= 0 ? x + 8 + offset : x - 8 - offset - tw;
      let ly = y + (Math.abs(dy) > this.R * 0.55 ? Math.sign(dy) * 12 : 0);
      lx = clamp(lx, 2, this.w - tw - 2);
      ly = clamp(ly, 8, this.h - 8);
      for (const p of placed) if (Math.abs(p.y - ly) < 15 && lx < p.x + p.w + 6 && lx + tw + 6 > p.x) ly = p.y + (ly >= p.y ? 16 : -16);
      placed.push({ x: lx, y: ly, w: tw });
      ctx.globalAlpha = 0.86 * show * Math.min(1, v + 0.2);
      ctx.fillStyle = this.pal.ground;
      ctx.fillRect(lx - 3, ly - 8, tw + 6, 16);
      ctx.globalAlpha = show * Math.min(1, v + 0.2);
      ctx.fillStyle = this.tone(end.color);
      ctx.fillText(end.text, lx, ly + 0.5);
    }
  }
}
