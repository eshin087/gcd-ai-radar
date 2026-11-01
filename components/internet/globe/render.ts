import type { Stop } from "../tour";
import type { InternetRoute } from "../useInternet";
import { basis, clamp, countryAt, countryName, DEG, dot3, landDots, lonLat, place, plainName, rotate, slerp, subsolar, toLonLat, type Basis, type V3 } from "./geo";
import { examplePayloads } from "./payloads";

/**
 * Draws one frame of the globe on a 2D canvas: the land as dots lit by the
 * real Sun at this moment (bright where it is day, dim where it is night,
 * the terminator dotted), faint hairlines for the other DDoS routes, and the
 * stop in focus played like a war room:
 *
 *   ddos    volleys of glowing projectiles fly from points across the
 *           attacking country to points across the target, each landing in a
 *           flash, a shockwave and sparks; the target country flashes red as
 *           it is hit, and the volleys grow with the route's real share
 *   route   one pulse at a time along the route (an older Worker's data)
 *   hijack  shockwaves roll out from the hijacker as it announces the
 *           victim's addresses; a glowing tether runs to the victim and
 *           traffic streams off the victim's country into the hijacker's
 *   waf     probes fire out of the origin country in every direction and
 *           shatter on shields; example requests of the categories Radar
 *           reports type out beside it and get stamped BLOCKED
 *   outage  a flash at the country's heart, then a blackout wave runs out to
 *           its borders, dots flickering at the front; an outage that has
 *           ended lights up again
 *
 * Only the attack effects glow (additive sprites and trails); the globe, the
 * land and the labels stay flat. Labels are 12 px.
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

/** A lifted great circle from a to b, its height `scale` times the usual for its length. */
function lifted(a: V3, b: V3, scale = 1, n = ARC_N): V3[] {
  const span = Math.acos(clamp(dot3(a, b), -1, 1));
  const lift = Math.max(0.02, (0.04 + 0.12 * (span / Math.PI)) * scale);
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = slerp(a, b, t);
    const h = 1 + lift * Math.sin(Math.PI * t);
    pts.push({ x: p.x * h, y: p.y * h, z: p.z * h });
  }
  return pts;
}

/** The path from one country to another as a lifted great circle (or a loop over one country), or null when a code has no place on the map. */
export function pathBetween(from: string, to: string): Path | null {
  const a = place(from), b = place(to);
  if (!a || !b) return null;
  const span = Math.acos(clamp(dot3(a, b), -1, 1));
  if (span < 1e-3) {
    // a ring through the country's label point, about 9° across, leaning north
    const [lon, lat] = toLonLat(a);
    const q = lonLat(lon, Math.min(80, lat + 9));
    const k = slerp(a, q, 0.5);
    const pts: V3[] = [];
    for (let i = 0; i <= ARC_N; i++) {
      const t = i / ARC_N;
      const p = rotate(a, k, 2 * Math.PI * t);
      const h = 1 + 0.06 * Math.sin(Math.PI * t);
      pts.push({ x: p.x * h, y: p.y * h, z: p.z * h });
    }
    const [vl, vp] = toLonLat(k);
    return { pts, view: [vl * DEG, clamp(vp, -VIEW_LAT, VIEW_LAT) * DEG], self: true };
  }
  const [vl, vp] = toLonLat(slerp(a, b, 0.5));
  return { pts: lifted(a, b), view: [vl * DEG, clamp(vp, -VIEW_LAT, VIEW_LAT) * DEG], self: false };
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

interface PathVisual {
  key: string;
  path: Path;
  view: [number, number];
  ends: [End, End];
}

/** What the globe draws for one stop. */
export type Visual =
  | (PathVisual & { kind: "route" })
  | (PathVisual & { kind: "ddos"; from: string; to: string; share: number })
  | (PathVisual & { kind: "hijack"; from: string; to: string })
  | { kind: "waf"; key: string; at: V3; view: [number, number]; end: End; code: string; payloads: string[] }
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
      const ends: [End, End] = [
        { text: plainName(stop.route.origin_name), marker: "accent", color: "soft" },
        { text: plainName(stop.route.target_name), marker: "hit", color: "ink" },
      ];
      return stop.kind === "ddos"
        ? { kind: "ddos", key, path, view: path.view, ends, from: stop.route.origin, to: stop.route.target, share: stop.route.share }
        : { kind: "route", key, path, view: path.view, ends };
    }
    case "hijack": {
      const path = pathBetween(stop.hijacker.country, stop.victim.country);
      if (!path) return null;
      return {
        kind: "hijack",
        key,
        path,
        view: path.view,
        from: stop.hijacker.country,
        to: stop.victim.country,
        ends: [
          { text: plainName(countryName(stop.hijacker.country)), marker: "accent", color: "accent" },
          { text: plainName(countryName(stop.victim.country)), marker: "hit", color: "ink" },
        ],
      };
    }
    case "waf": {
      const at = place(stop.origin.country);
      if (!at) return null;
      return {
        kind: "waf",
        key,
        at,
        view: pointView(at),
        end: { text: plainName(stop.origin.name), marker: "accent", color: "ink" },
        code: stop.origin.country,
        payloads: examplePayloads(stop.origin.rules.map((r) => r.name)),
      };
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
        depth: stop.event.type === "nationwide" ? 0.9 : 0.62,
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
/** DDoS: paths per salvo, and the seconds an impact's flash, shockwave and sparks last. */
const SALVO_PATHS = 12;
const IMPACT_S = 1;
/** Web exploits: probe paths, seconds between probes, of a probe's flight, of its break-up, and of one example request on screen. */
const PROBE_PATHS = 14;
const PROBE_S = 0.15;
const PROBE_FLIGHT_S = 0.55;
const BLOCK_S = 0.6;
const PAYLOAD_S = 2.6;
/** Hijack: seconds between shockwaves and between siphoned packets. */
const WAVE_S = 1.5;
const PACKET_S = 0.11;
/** Outage: seconds the blackout takes to reach the borders, and when an ended one lights up again. */
const BLACKOUT_S = 1.6;
const RELIGHT: [number, number] = [4.4, 5.8];
/** Degrees around a country's label point that its shots start from and land in. */
const CORE = 13;
/** Degrees around a country too small for the country cells that an outage darkens. */
const SMALL_COUNTRY = 2.5;
/** Degrees between land dots. */
const DOT_STEP = 1.25;
/** The moment a still frame (reduced motion) shows of a stop's animation. */
const STILL_T = 2.6;

const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const glide = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

/** A repeatable pseudo-random number in [0, 1) for a pair of integers (and an optional salt). */
function rand(a: number, b: number, salt = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(salt + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return `rgba(255,255,255,${a})`;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${a})`;
}

/** How one country's dots are drawn this frame: darkened (an outage) or tinted (a hit). */
interface Dim {
  /** 1-based index into the renderer's dot owners, or 0 for a country with no dots of its own. */
  owner: number;
  at: V3;
  level: number;
  /** Radians from `at` the blackout has reached, and the flickering band behind it. */
  front: number;
  band: number;
}

interface Tint {
  owner: number;
  at: V3;
  color: string;
  level: number;
}

/** Precomputed geometry for one stop, built the first time it is drawn. */
interface Staged {
  /** DDoS: lifted paths from points in the attacking country to points in the target. Web exploits: short hops out of the origin. */
  paths: V3[][];
  /** Owners (see Dim) of the stop's countries: target or victim first, then origin or hijacker. */
  owners: [number, number];
  /** Outage: radians from the label point to the country's farthest dot. */
  extent: number;
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
  /** Dot indices per owner, built on first use. */
  private readonly ownerDots = new Map<number, number[]>();
  private readonly staged = new Map<string, Staged>();
  private readonly glowHit: HTMLCanvasElement;
  private readonly glowAccent: HTMLCanvasElement;
  private readonly glowWhite: HTMLCanvasElement;

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
    this.glowHit = this.sprite(pal.hit);
    this.glowAccent = this.sprite(pal.accent);
    this.glowWhite = this.sprite("#fff1dc");
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
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    const B = basis(s.lon, s.lat);
    const v = s.focus;
    // a still frame (reduced motion) shows one moment of the animation
    const t = s.pulse >= 0 ? s.pulse : s.drawn >= 1 ? STILL_T : -1;
    const st = v ? this.stage(v) : null;
    this.land(B, s.now, this.dimming(s, st, t), v && st ? this.tints(v, st, t) : []);
    const routeOf = (x: Visual | null) => (x && (x.kind === "ddos" || x.kind === "route") ? x.key.slice(x.key.indexOf(":") + 1) : "");
    const skip = new Set([routeOf(v), routeOf(s.fade)]);
    for (const arc of s.context) {
      if (skip.has(`${arc.route.origin}>${arc.route.target}`)) continue;
      this.strokeArc(this.project(arc.pts, B), 0, 1, () => 0.13, 0.8);
    }
    if (s.fade && s.fade !== v && s.fadeAlpha > 0 && "path" in s.fade) this.strokeArc(this.project(s.fade.path.pts, B), 0, 1, () => 0.4 * s.fadeAlpha, 1.2);
    if (!v || !st || s.drawn <= 0) return;
    switch (v.kind) {
      case "waf":
        return this.probes(v, st, B, s.drawn, t);
      case "outage":
        return this.blackout(v, B, s.drawn, t);
    }
    const pa = this.project(v.path.pts, B);
    if (s.drawn < 1) {
      this.strokeArc(pa, 0, s.drawn, (u) => 0.22 + 0.78 * Math.pow(u / s.drawn, 3), 1.6);
      this.head(pa, s.drawn);
    } else this.strokeArc(pa, 0, 1, () => (v.kind === "route" ? 0.5 : 0.16), v.kind === "route" ? 1.4 : 1);
    if (t >= 0) {
      if (v.kind === "ddos") this.barrage(v, st, B, t);
      else if (v.kind === "hijack") this.siphon(pa, t);
      else this.pulses(pa, t);
    }
    const [a, b] = v.ends;
    const ends = v.path.self
      ? [{ u: 0, end: { ...b, marker: v.kind === "hijack" ? ("accent" as const) : b.marker }, show: smooth(0.05, 0.25, s.drawn) }]
      : [
          { u: 0, end: a, show: smooth(0.02, 0.2, s.drawn) },
          { u: 1, end: b, show: smooth(0.85, 1, s.drawn) },
        ];
    this.labels(ends.map(({ u, end, show }) => ({ at: this.at(pa, u), end, show })));
  }

  /* --------------------------------------------------------------- stage */

  private ownerOf(code: string) {
    return this.owners.get(code) ?? 0;
  }

  private dotsOf(owner: number): number[] {
    let list = this.ownerDots.get(owner);
    if (!list) {
      list = [];
      if (owner) for (let i = 0; i < this.dotOwner.length; i++) if (this.dotOwner[i] === owner) list.push(i);
      this.ownerDots.set(owner, list);
    }
    return list;
  }

  /** A country's land dots within CORE degrees of its label point, so shots land on its main body (contiguous US, not Alaska). */
  private coreDots(code: string): number[] {
    const key = -1 - this.ownerOf(code);
    let list = this.ownerDots.get(key);
    if (!list) {
      const p = place(code);
      const near = Math.cos(CORE * DEG);
      list = p ? this.dotsOf(this.ownerOf(code)).filter((i) => this.dots[i * 4]! * p.x + this.dots[i * 4 + 1]! * p.y + this.dots[i * 4 + 2]! * p.z > near) : [];
      this.ownerDots.set(key, list);
    }
    return list;
  }

  /** A point of a country: one of its land dots near its label point, or a point near the label itself when it has too few. */
  private pointIn(code: string, r: number): V3 {
    const list = this.coreDots(code);
    if (list.length >= 4) {
      const i = list[Math.floor(r * list.length)]! * 4;
      return { x: this.dots[i]!, y: this.dots[i + 1]!, z: this.dots[i + 2]! };
    }
    const p = place(code)!;
    const [lon, lat] = toLonLat(p);
    return lonLat(lon + (r - 0.5) * 1.6, lat + (rand(Math.floor(r * 1e6), 7) - 0.5) * 1.6);
  }

  private stage(v: Visual): Staged {
    const got = this.staged.get(v.key);
    if (got) return got;
    if (this.staged.size > 24) this.staged.clear();
    const seed = hashKey(v.key);
    const st: Staged = { paths: [], owners: [0, 0], extent: 0 };
    if (v.kind === "ddos") {
      st.owners = [this.ownerOf(v.to), this.ownerOf(v.from)];
      for (let j = 0; j < SALVO_PATHS; j++) {
        const a = this.pointIn(v.from, rand(seed, j, 1)), b = this.pointIn(v.to, rand(seed, j, 2));
        st.paths.push(lifted(a, b, 0.75 + 0.6 * rand(seed, j, 3), 40));
      }
    } else if (v.kind === "hijack") {
      st.owners = [this.ownerOf(v.to), this.ownerOf(v.from)];
    } else if (v.kind === "waf") {
      st.owners = [0, this.ownerOf(v.code)];
      for (let j = 0; j < PROBE_PATHS; j++) {
        const a = this.pointIn(v.code, rand(seed, j, 4));
        // a hop of 9° to 22° in a random bearing: turn `a` towards a random direction tangent to the sphere
        const n = lonLat(rand(seed, j, 5) * 360 - 180, rand(seed, j, 6) * 180 - 90);
        const k = dot3(n, a);
        let tx = n.x - k * a.x, ty = n.y - k * a.y, tz = n.z - k * a.z;
        const m = Math.hypot(tx, ty, tz) || 1;
        tx /= m;
        ty /= m;
        tz /= m;
        const ang = (9 + 13 * rand(seed, j, 7)) * DEG;
        const b = { x: a.x * Math.cos(ang) + tx * Math.sin(ang), y: a.y * Math.cos(ang) + ty * Math.sin(ang), z: a.z * Math.cos(ang) + tz * Math.sin(ang) };
        st.paths.push(lifted(a, b, 0.9, 24));
      }
    } else if (v.kind === "outage") {
      const owner = this.ownerOf(v.code);
      st.owners = [owner, 0];
      let far = SMALL_COUNTRY * DEG;
      for (const i of this.dotsOf(owner)) {
        const d = Math.acos(clamp(this.dots[i * 4]! * v.at.x + this.dots[i * 4 + 1]! * v.at.y + this.dots[i * 4 + 2]! * v.at.z, -1, 1));
        if (d > far) far = d;
      }
      st.extent = far;
    }
    this.staged.set(v.key, st);
    return st;
  }

  /* ---------------------------------------------------------------- land */

  /** The outage on screen as a blackout spreading from its heart (or fading out with the stop), or null. */
  private dimming(s: Scene, st: Staged | null, t: number): Dim | null {
    const v = s.focus;
    if (v?.kind === "outage" && st) {
      if (t < 0) return null;
      let front = st.extent * easeOut(clamp(t / BLACKOUT_S, 0, 1));
      if (v.ended) front *= 1 - smooth(RELIGHT[0], RELIGHT[1], t);
      return front > 0 ? { owner: st.owners[0], at: v.at, level: v.depth, front, band: 0.12 * st.extent + 0.6 * DEG } : null;
    }
    const f = s.fade;
    if (f?.kind === "outage" && !f.ended && s.fadeAlpha > 0) {
      const fs = this.staged.get(f.key);
      if (fs) return { owner: fs.owners[0], at: f.at, level: f.depth * s.fadeAlpha, front: fs.extent, band: 0 };
    }
    return null;
  }

  /** Countries lit up by the attack: a DDoS target flashing with each hit, a hijack's victim pulsing red and its hijacker amber, an exploit origin glowing amber. */
  private tints(v: Visual, st: Staged, t: number): Tint[] {
    if (t < 0) return [];
    if (v.kind === "ddos") {
      let heat = 0;
      this.salvo(v, st, t, (_p, _u, launch, flight) => {
        const age = t - (launch + flight);
        if (age >= 0 && age < 1.5) heat += Math.exp(-age * 3.2);
      });
      const b = place(v.to)!;
      return [{ owner: st.owners[0], at: b, color: this.pal.hit, level: clamp(0.18 + heat * 0.32, 0, 0.85) }];
    }
    if (v.kind === "hijack") {
      return [
        { owner: st.owners[0], at: place(v.to)!, color: this.pal.hit, level: 0.32 + 0.22 * Math.sin(t * 5.2) },
        ...(st.owners[1] !== st.owners[0] ? [{ owner: st.owners[1], at: place(v.from)!, color: this.pal.accent, level: 0.3 }] : []),
      ];
    }
    if (v.kind === "waf") return [{ owner: st.owners[1], at: v.at, color: this.pal.accent, level: 0.22 + 0.1 * Math.sin(t * 3) }];
    return [];
  }

  private land(B: Basis, now: number, dim: Dim | null, tints: Tint[]) {
    const { ctx, R, cx, cy } = this;
    const d = this.dots;
    const [slon, slat] = subsolar(now);
    const sun = lonLat(slon, slat);
    const near = Math.cos(SMALL_COUNTRY * DEG);
    const flick = Math.floor(now / 70);
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
        if (dim) {
          const cos = x * dim.at.x + y * dim.at.y + z * dim.at.z;
          if (dim.owner ? this.dotOwner[i / 4] === dim.owner : cos > near) {
            const r = Math.acos(clamp(cos, -1, 1));
            // dark inside the front; in the band behind it the lights stutter
            if (r < dim.front - dim.band) a *= 1 - dim.level;
            else if (r < dim.front && rand(i, flick) < 0.6) a *= 1 - dim.level;
          }
        }
        if (a < 0.02) continue;
        const size = 0.7 + 1.2 * vz;
        ctx.globalAlpha = a * (pass ? 0.22 + 0.7 * vz : 0.2 + 0.42 * vz);
        ctx.fillRect(cx + R * (x * B.ex + y * B.ey + z * B.ez) - size / 2, cy - R * (x * B.nx + y * B.ny + z * B.nz) - size / 2, size, size);
      }
    }
    // a hit country's dots take the attack's colour over the light
    for (const tint of tints) {
      if (tint.level <= 0.02) continue;
      ctx.fillStyle = tint.color;
      const list = tint.owner ? this.dotsOf(tint.owner) : [];
      const draw = (i: number) => {
        const x = d[i * 4]!, y = d[i * 4 + 1]!, z = d[i * 4 + 2]!;
        const vz = x * B.cx + y * B.cy + z * B.cz;
        if (vz < 0) return;
        const size = 0.9 + 1.3 * vz;
        ctx.globalAlpha = tint.level * (0.35 + 0.65 * vz);
        ctx.fillRect(cx + R * (x * B.ex + y * B.ey + z * B.ez) - size / 2, cy - R * (x * B.nx + y * B.ny + z * B.nz) - size / 2, size, size);
      };
      if (list.length) list.forEach(draw);
      else for (let i = 0; i < d.length / 4; i++) if (d[i * 4]! * tint.at.x + d[i * 4 + 1]! * tint.at.y + d[i * 4 + 2]! * tint.at.z > near) draw(i);
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

  /** The path from u0 to u1 (fractions of its length) as segments, each alpha(u) times its visibility, in `color` (default the accent), widths running w0 to w1. */
  private strokeArc(pa: Float32Array, u0: number, u1: number, alpha: (u: number) => number, w0: number, w1 = w0, color = this.pal.accent) {
    const { ctx } = this;
    const n = pa.length / 3 - 1;
    const f0 = Math.max(0, u0) * n, f1 = Math.min(1, u1) * n;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    for (let k = Math.max(1, Math.floor(f0) + 1); k <= Math.ceil(f1); k++) {
      const va = pa[3 * (k - 1) + 2]!, vb = pa[3 * k + 2]!;
      if (!va || !vb) continue;
      const s0 = Math.max(0, f0 - (k - 1)), s1 = Math.min(1, f1 - (k - 1));
      const ax = pa[3 * (k - 1)]!, ay = pa[3 * (k - 1) + 1]!, bx = pa[3 * k]!, by = pa[3 * k + 1]!;
      const q = (k - 0.5) / n;
      ctx.globalAlpha = alpha(q) * Math.min(va, vb);
      ctx.lineWidth = w0 + (w1 - w0) * clamp((q * n - f0) / Math.max(1e-6, f1 - f0), 0, 1);
      ctx.beginPath();
      ctx.moveTo(ax + (bx - ax) * s0, ay + (by - ay) * s0);
      ctx.lineTo(ax + (bx - ax) * s1, ay + (by - ay) * s1);
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

  /* ---------------------------------------------------------------- glow */

  /** A soft round light: white at the heart, `color` around it, fading out; drawn additively. */
  private sprite(color: string): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.16, rgba(color, 0.95));
    grd.addColorStop(0.45, rgba(color, 0.32));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  /** Runs `draw` with additive blending, the effects' glow. */
  private additive(draw: () => void) {
    const { ctx } = this;
    ctx.globalCompositeOperation = "lighter";
    try {
      draw();
    } finally {
      ctx.globalCompositeOperation = "source-over";
    }
  }

  private glow(x: number, y: number, size: number, alpha: number, sprite: HTMLCanvasElement) {
    if (alpha <= 0.01 || size <= 0.5) return;
    this.ctx.globalAlpha = Math.min(1, alpha);
    this.ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  /** Sparks thrown out from (x, y): `n` of them, `e` from 0 to 1 through their life, aimed around `dir` within `spread` radians (a full circle by default). */
  private sparks(x: number, y: number, e: number, n: number, seed: number, reach: number, color: string, dir = 0, spread = Math.PI) {
    const { ctx } = this;
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const th = dir + (rand(seed, i, 11) * 2 - 1) * spread;
      const r = 3 + reach * (0.5 + 0.5 * rand(seed, i, 12)) * easeOut(e);
      ctx.globalAlpha = (1 - e) * (0.6 + 0.4 * rand(seed, i, 13));
      const s = 1.6 * (1 - e) + 0.6;
      ctx.fillRect(x + Math.cos(th) * r - s / 2, y + Math.sin(th) * r - s / 2, s, s);
    }
  }

  /* ------------------------------------------------------------- attacks */

  /** A plain route: pulses run origin to target every PULSE_S once it is drawn; each arrival rings at the target. */
  private pulses(pa: Float32Array, t: number) {
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
    const inFlight = t >= FIRST_PULSE_S ? ((t - FIRST_PULSE_S) % PULSE_S) / TRAVEL_S : -1;
    if (inFlight < 0 || inFlight > 1) return;
    const u = ease(inFlight);
    this.strokeArc(pa, Math.max(0, u - 0.14), u, (w) => clamp(1 - (u - w) / 0.14, 0, 1), 2.2);
    const [x, y, v] = this.at(pa, u);
    if (v) this.dot(x, y, 2.2, v);
  }

  /**
   * The volleys of a DDoS stop: calls `each` for every projectile launched so
   * far that can still be in flight or landing, with its path, progress,
   * launch time and flight time. Bigger shares fire larger, faster volleys.
   */
  private salvo(v: Extract<Visual, { kind: "ddos" }>, st: Staged, t: number, each: (path: number, u: number, launch: number, flight: number, id: number) => void) {
    const every = clamp(1.3 - v.share * 0.05, 0.5, 1.3);
    const per = clamp(3 + Math.round(v.share / 2.5), 3, 8);
    const a = place(v.from), b = place(v.to);
    const span = a && b ? Math.acos(clamp(dot3(a, b), -1, 1)) : 0;
    const base = 0.85 + 0.5 * (span / Math.PI);
    const last = Math.floor(t / every);
    for (let k = Math.max(0, last - Math.ceil((base * 1.2 + IMPACT_S) / every) - 1); k <= last; k++) {
      for (let j = 0; j < per; j++) {
        const id = k * 16 + j;
        const launch = k * every + j * 0.07 + 0.05 * rand(k, j, 21);
        if (launch > t) continue;
        const flight = base * (0.88 + 0.24 * rand(k, j, 22));
        each((k * 5 + j * 7) % st.paths.length, glide((t - launch) / flight), launch, flight, id);
      }
    }
  }

  /** DDoS: glowing projectiles with tapering trails, muzzle flashes at launch, and a flash, a shockwave and sparks at every landing. */
  private barrage(v: Extract<Visual, { kind: "ddos" }>, st: Staged, B: Basis, t: number) {
    const projected = new Map<number, Float32Array>();
    const pa = (p: number) => {
      let got = projected.get(p);
      if (!got) projected.set(p, (got = this.project(st.paths[p]!, B)));
      return got;
    };
    this.additive(() => {
      this.salvo(v, st, t, (p, u, launch, flight, id) => {
        const path = pa(p);
        const age = t - launch;
        if (age < 0.28) {
          const [ox, oy, ov] = this.at(path, 0);
          if (ov) this.glow(ox, oy, 16 * (1 - age / 0.28) + 4, 0.8 * ov * (1 - age / 0.28), this.glowAccent);
        }
        if (age < flight) {
          this.strokeArc(path, Math.max(0, u - 0.24), u, (w) => Math.pow(clamp(1 - (u - w) / 0.24, 0, 1), 1.6) * 0.95, 0.4, 2.4, this.pal.hit);
          const [x, y, vis] = this.at(path, u);
          if (vis) {
            this.glow(x, y, 15, 0.95 * vis, this.glowHit);
            this.glow(x, y, 6, vis, this.glowWhite);
          }
          return;
        }
        const e = (age - flight) / IMPACT_S;
        if (e > 1) return;
        const [x, y, vis] = this.at(path, 1);
        if (!vis) return;
        this.glow(x, y, 28 * (1 - e) + 4, 0.75 * (1 - e) * (1 - e) * vis, this.glowWhite);
        this.glow(x, y, 24 * (0.6 + e), 0.45 * (1 - e) * vis, this.glowHit);
        this.ring(x, y, 3 + 20 * easeOut(e), 0.8 * Math.pow(1 - e, 1.4) * vis, this.pal.hit, 1.5);
        if (e < 0.7) this.ring(x, y, 2 + 10 * easeOut(e / 0.7), 0.5 * (1 - e / 0.7) * vis, this.pal.accent, 1);
        this.sparks(x, y, e, 7, id, 15, this.pal.accent);
      });
    });
  }

  /** A hijack: shockwaves out of the hijacker, a tether to the victim with light running along it, and packets streaming from the victim into the hijacker. */
  private siphon(pa: Float32Array, t: number) {
    const [hx, hy, hv] = this.at(pa, 0);
    this.additive(() => {
      // the tether: dashes that run from the victim towards the hijacker
      const n = pa.length / 3 - 1;
      const shift = Math.floor(t * 14);
      for (let k = 1; k <= n; k++) {
        if ((k + shift) % 5 > 1) continue;
        this.strokeArc(pa, (k - 1) / n, k / n, () => 0.55, 1.6, 1.6, this.pal.accent);
      }
      if (hv) {
        const k = Math.floor(t / WAVE_S);
        for (let j = Math.max(0, k - 2); j <= k; j++) {
          const e = (t - j * WAVE_S) / (WAVE_S * 2);
          if (e >= 0 && e <= 1) this.ring(hx, hy, 5 + 44 * easeOut(e), 0.75 * Math.pow(1 - e, 1.3) * hv, this.pal.accent, 1.8 * (1 - e) + 0.6);
        }
        this.glow(hx, hy, 22 + 6 * Math.sin(t * 6), 0.7 * hv, this.glowAccent);
      }
      // the stolen traffic
      const last = Math.floor(t / PACKET_S);
      for (let j = Math.max(0, last - 12); j <= last; j++) {
        const p = (t - j * PACKET_S) / 1.1;
        if (p < 0 || p > 1) continue;
        const u = 1 - glide(p);
        this.strokeArc(pa, u, Math.min(1, u + 0.07), (w) => clamp(1 - (w - u) / 0.07, 0, 1) * 0.9, 1.8, 0.3, this.pal.hit);
        const [x, y, vis] = this.at(pa, u);
        if (vis) {
          this.glow(x, y, 10, 0.9 * vis, this.glowHit);
          this.glow(x, y, 4, vis, this.glowWhite);
        }
      }
      // each packet that reaches the hijacker
      if (hv && (t % PACKET_S) / PACKET_S < 0.5) this.glow(hx, hy, 9, 0.5 * hv, this.glowWhite);
    });
  }

  /** Web exploits: probes leave the origin country in all directions and shatter on shields; example requests type out beside it and get stamped BLOCKED. */
  private probes(v: Extract<Visual, { kind: "waf" }>, st: Staged, B: Basis, drawn: number, t: number) {
    const [x, y, vis] = this.point(v.at, B);
    const show = smooth(0, 1, drawn);
    if (t >= 0) {
      this.additive(() => {
        const last = Math.floor(t / PROBE_S);
        for (let j = Math.max(0, last - Math.ceil((PROBE_FLIGHT_S + BLOCK_S) / PROBE_S) - 1); j <= last; j++) {
          const age = t - j * PROBE_S;
          if (age < 0) continue;
          const pa = this.project(st.paths[(j * 5) % st.paths.length]!, B);
          const stop = 0.82;
          if (age < PROBE_FLIGHT_S) {
            const u = stop * easeOut(age / PROBE_FLIGHT_S);
            this.strokeArc(pa, Math.max(0, u - 0.3), u, (w) => clamp(1 - (u - w) / 0.3, 0, 1) * 0.9, 0.3, 1.6, this.pal.accent);
            const [px, py, pv] = this.at(pa, u);
            if (pv) {
              this.glow(px, py, 11, 0.9 * pv * show, this.glowAccent);
              this.glow(px, py, 4, pv * show, this.glowWhite);
            }
            continue;
          }
          const e = (age - PROBE_FLIGHT_S) / BLOCK_S;
          if (e > 1) continue;
          const [bx, by, bv] = this.at(pa, stop);
          if (!bv) continue;
          const [ax, ay] = this.at(pa, stop - 0.06);
          const dir = Math.atan2(by - ay, bx - ax);
          // the shield: a bright arc square to the probe's path, just ahead of where it broke
          this.ctx.globalAlpha = 0.95 * (1 - e) * bv * show;
          this.ctx.strokeStyle = this.pal.accent;
          this.ctx.lineWidth = 2.2 * (1 - e) + 0.8;
          this.ctx.beginPath();
          this.ctx.arc(bx - Math.cos(dir) * 6, by - Math.sin(dir) * 6, 11, dir - 0.9, dir + 0.9);
          this.ctx.stroke();
          this.glow(bx, by, 26 * (1 - e) + 4, (1 - e) * (1 - e) * bv * show, this.glowAccent);
          this.glow(bx, by, 10 * (1 - e), (1 - e) * bv * show, this.glowWhite);
          this.sparks(bx, by, e, 6, j, 12, this.pal.accent, dir + Math.PI, 1.1);
        }
        if (vis) this.glow(x, y, 26 + 5 * Math.sin(t * 4), 0.55 * vis * show, this.glowAccent);
      });
    }
    if (!vis) return;
    this.ctx.globalAlpha = show * vis;
    this.ctx.fillStyle = this.pal.accent;
    this.ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    const label = { at: [x, y, vis] as [number, number, number], end: v.end, show: smooth(0.1, 0.4, drawn), offset: 14 };
    this.labels([label]);
    if (t >= 0 && v.payloads.length && this.R >= 80) this.payload(v, x, y, t);
  }

  /** One example request at a time beside the origin: typed out, held, stamped BLOCKED, faded. */
  private payload(v: Extract<Visual, { kind: "waf" }>, x: number, y: number, t: number) {
    const { ctx } = this;
    const k = Math.floor(t / PAYLOAD_S), age = t - k * PAYLOAD_S;
    const text = v.payloads[k % v.payloads.length]!;
    const shown = text.slice(0, Math.ceil(text.length * clamp(age / 0.7, 0, 1)));
    const fade = 1 - smooth(PAYLOAD_S - 0.45, PAYLOAD_S, age);
    ctx.font = `12px ${this.pal.mono}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const tw = ctx.measureText(text).width;
    const right = x - this.cx >= 0;
    let lx = right ? x + 22 : x - 22 - tw;
    lx = clamp(lx, 2, this.w - tw - 2);
    const ly = clamp(y + 20, 8, this.h - 24);
    ctx.globalAlpha = 0.88 * fade;
    ctx.fillStyle = this.pal.ground;
    ctx.fillRect(lx - 3, ly - 8, tw + 6, 16);
    ctx.globalAlpha = fade;
    ctx.fillStyle = this.pal.accent;
    ctx.fillText(shown + (age < 0.7 && Math.floor(t * 8) % 2 ? "_" : ""), lx, ly + 0.5);
    if (age > 1.15) {
      const e = clamp((age - 1.15) / 0.25, 0, 1);
      const stamp = "BLOCKED";
      const sw = ctx.measureText(stamp).width;
      const sx = clamp(right ? lx : lx + tw - sw, 2, this.w - sw - 2);
      const sy = ly + 17;
      // the text struck through, then the stamp
      ctx.globalAlpha = fade * e;
      ctx.strokeStyle = this.pal.hit;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(lx - 1, ly + 0.5);
      ctx.lineTo(lx - 1 + (tw + 2) * e, ly + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 0.9 * fade * e;
      ctx.fillStyle = this.pal.ground;
      ctx.fillRect(sx - 3, sy - 8, sw + 6, 16);
      ctx.globalAlpha = fade * e;
      ctx.fillStyle = this.pal.hit;
      ctx.fillText(stamp, sx, sy + 0.5);
      this.additive(() => this.glow(sx + sw / 2, sy, sw * 1.4 * (1.3 - 0.3 * e), 0.35 * fade * (1 - 0.6 * e), this.glowHit));
    }
  }

  /** An outage: a flash at the country's heart as the blackout starts (see `dimming`), then slow shockwaves and embers while it lasts. */
  private blackout(v: Extract<Visual, { kind: "outage" }>, B: Basis, drawn: number, t: number) {
    const [x, y, vis] = this.point(v.at, B);
    if (!vis) return;
    const show = smooth(0, 1, drawn);
    if (t >= 0) {
      this.additive(() => {
        const e0 = clamp(t / 0.7, 0, 1);
        if (e0 < 1) {
          this.glow(x, y, 70 * (1 - e0) + 10, (1 - e0) * vis, this.glowWhite);
          this.glow(x, y, 50 * (0.5 + e0), 0.8 * (1 - e0) * vis, this.glowHit);
          this.sparks(x, y, e0, 12, 99, 26, this.pal.hit);
        }
        const k = Math.floor(t / 2.2);
        for (let j = Math.max(0, k - 1); j <= k; j++) {
          const e = (t - j * 2.2) / 3;
          if (e >= 0 && e <= 1) this.ring(x, y, 6 + 40 * easeOut(e), 0.6 * Math.pow(1 - e, 1.3) * vis, this.pal.hit, 1.6 * (1 - e) + 0.5);
        }
        const lit = v.ended ? 1 - smooth(RELIGHT[0], RELIGHT[1], t) : 1;
        this.glow(x, y, 18 + 4 * Math.sin(t * 7), 0.45 * vis * lit, this.glowHit);
      });
    }
    this.ctx.globalAlpha = show * vis;
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
