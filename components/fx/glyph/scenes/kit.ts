import type { Cam, Setter, V3 } from "../engine";
import { POINT_STRIDE } from "../engine";
import type { FeedEvent } from "../feed";

/** GLSL shared by the agent scenes: attack bolts, flashes and an orchestrator core. */
export const KIT_GLSL = `
uniform vec3 uEye;
uniform vec3 uTarget;
uniform vec4 uAtkT[3];
uniform vec4 uAtkH[3];
uniform vec4 uFlash[6];
uniform vec4 uFlashC[6];

/** emission along a segment; k shapes it towards the far end (b) */
vec3 bolt(vec3 ro, vec3 rd, vec3 a, vec3 b, float w, vec3 c, float k){
  float s;
  float d2 = segDist2(ro, rd, a, b, s);
  return c*exp(-d2/(w*w))*pow(s, k);
}
/** incoming attacks: red bolts with hot heads */
vec3 attacks(vec3 ro, vec3 rd){
  vec3 col = vec3(0.);
  for(int i = 0; i < 3; i++){
    float w = uAtkT[i].w;
    if(w <= 0.) continue;
    col += bolt(ro, rd, uAtkT[i].xyz, uAtkH[i].xyz, .026, vec3(1., .24, .14)*2.2*w, 1.5);
    col += vec3(1., .72, .55)*pointGlow(ro, rd, uAtkH[i].xyz, .045)*3.*w;
  }
  return col;
}
/** expanding shells where something was hit, blocked or purged */
vec3 flashes(vec3 ro, vec3 rd){
  vec3 col = vec3(0.);
  for(int i = 0; i < 6; i++){
    vec4 f = uFlash[i];
    if(f.w < 0.) continue;
    vec3 oc = f.xyz - ro;
    float t = dot(oc, rd);
    float d = length(oc - rd*t);
    float r = uFlashC[i].a*(1. - exp(-f.w*5.));
    col += uFlashC[i].rgb*(exp(-pow((d - r)/.03, 2.))*exp(-f.w*3.)*2. + exp(-d*d/.004)*exp(-f.w*7.)*5.);
  }
  return col;
}
/** the orchestrator: a glassy orb with an amber heart and turning bands; hot > 0 flushes it red */
vec3 core(vec3 ro, vec3 rd, float r, float hot, float pulse){
  vec3 col = vec3(1., .7, .35)*pointGlow(ro, rd, vec3(0.), r*.55)*(.7 + .5*pulse) + vec3(.3, .7, 1.)*pointGlow(ro, rd, vec3(0.), r*1.9)*.1;
  vec2 h = sphIsect(ro, rd, vec3(0.), r);
  if(h.x > 0.){
    vec3 p = ro + rd*h.x;
    vec3 n = normalize(p);
    float fr = pow(1. - abs(dot(n, rd)), 2.);
    vec3 q = n; q.xz = rot2(uTime*.4)*q.xz;
    float bands = pow(abs(sin(asin(clamp(q.y, -1., 1.))*9. + uTime*.8)), 18.);
    float merid = pow(abs(sin(atan(q.z, q.x)*6.)), 30.);
    col += vec3(.3, .75, 1.)*(fr*1.1 + (bands + merid)*.35*(.4 + fr)) + vec3(1., .72, .4)*(1. - fr)*.25*(1. + pulse);
  }
  return mix(col, col.r*vec3(1., .3, .2)*1.6 + vec3(.2, 0., 0.), clamp(hot, 0., 1.));
}
`;

export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  mix: (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u],
};

/** A slow orbit around a target, swaying rather than spinning. */
export function swayCam(t: number, target: V3, dist: number, height: number, base = 0.2, sway = 0.12, speed = 0.05): Cam {
  const a = base + sway * Math.sin(t * speed);
  return { eye: [target[0] + Math.sin(a) * dist, target[1] + height, target[2] + Math.cos(a) * dist], target };
}

/** A random point well outside the scene on the camera's sides, where attacks come from. */
export function attackStart(rnd: () => number, cam: Cam, dist: number): V3 {
  const c = v3.norm(v3.sub(cam.eye, cam.target));
  let r: V3 = [rnd() * 2 - 1, (rnd() * 2 - 1) * 0.6, rnd() * 2 - 1];
  r = v3.norm(v3.sub(r, v3.mul(c, v3.dot(r, c))));
  return v3.add(cam.target, v3.add(v3.mul(r, dist), v3.mul(c, dist * 0.2)));
}

export interface Bolt {
  ev: FeedEvent;
  s: V3;
  /** where it is heading; scenes may move it every frame (a homing attack) */
  e: V3;
  t0: number;
  dur: number;
  /** -1 flying; otherwise the time it arrived */
  hit: number;
  done: boolean;
}

/** Attacks in flight, packed into uAtkT / uAtkH. */
export class Bolts {
  list: Bolt[] = [];
  private T = new Float32Array(12);
  private H = new Float32Array(12);
  add(ev: FeedEvent, s: V3, e: V3, t: number, dur: number) {
    const b: Bolt = { ev, s, e, t0: t, dur, hit: -1, done: false };
    this.list.push(b);
    return b;
  }
  /** fraction of the way (0..1) */
  u(b: Bolt, t: number) {
    return Math.min(1, (t - b.t0) / b.dur);
  }
  head(b: Bolt, t: number): V3 {
    return v3.mix(b.s, b.e, this.u(b, t));
  }
  pack(t: number, set: Setter) {
    this.list = this.list.filter((b) => !b.done);
    this.T.fill(0);
    this.H.fill(0);
    this.list.slice(0, 3).forEach((b, i) => {
      const u = this.u(b, t);
      const head = v3.mix(b.s, b.e, u);
      const tail = v3.mix(b.s, b.e, Math.max(0, u - 0.2));
      this.T.set([...tail, Math.min(1, (t - b.t0) / 0.15)], i * 4);
      this.H.set([...head, 0], i * 4);
    });
    set.v4v("uAtkT", this.T);
    set.v4v("uAtkH", this.H);
  }
}

/** Expanding flashes, packed into uFlash / uFlashC. */
export class Flashes {
  private list: { p: V3; t0: number; c: V3; size: number }[] = [];
  private F = new Float32Array(24);
  private C = new Float32Array(24);
  add(p: V3, t: number, c: V3, size = 0.2) {
    this.list.push({ p, t0: t, c, size });
    if (this.list.length > 6) this.list.shift();
  }
  pack(t: number, set: Setter) {
    this.F.fill(-1);
    this.C.fill(0);
    this.list.forEach((f, i) => {
      if (t - f.t0 > 1.5) return;
      this.F.set([...f.p, t - f.t0], i * 4);
      this.C.set([...f.c, f.size], i * 4);
    });
    set.v4v("uFlash", this.F);
    set.v4v("uFlashC", this.C);
  }
}

/** A growable buffer of point sprites. */
export class PointBuf {
  data: Float32Array;
  n = 0;
  constructor(max: number) {
    this.data = new Float32Array(max * POINT_STRIDE);
  }
  reset() {
    this.n = 0;
  }
  add(p: V3, r: number, c: V3, k: number) {
    if ((this.n + 1) * POINT_STRIDE > this.data.length) return;
    this.data.set([p[0], p[1], p[2], r, c[0], c[1], c[2], k], this.n * POINT_STRIDE);
    this.n += 1;
  }
}

export const CYAN: V3 = [0.35, 0.85, 1];
export const AMBER: V3 = [1, 0.66, 0.3];
export const RED: V3 = [1, 0.22, 0.14];
export const WHITE: V3 = [0.9, 0.95, 1];

export function setCam(set: Setter, cam: Cam) {
  set.v3("uEye", cam.eye[0], cam.eye[1], cam.eye[2]);
  set.v3("uTarget", cam.target[0], cam.target[1], cam.target[2]);
}

export type Emit = (e: FeedEvent, done: boolean, word?: string) => void;
