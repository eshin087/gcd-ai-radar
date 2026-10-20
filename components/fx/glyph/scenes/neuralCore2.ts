import type { ThreatIntel } from "@/lib/threatIntel";
import type { Cam, GlyphController, V3 } from "../engine";
import { threatFeed, type FeedEvent } from "../feed";
import { CYAN, Flashes, KIT_GLSL, PointBuf, RED, setCam, swayCam, v3, type Emit } from "./kit";

const FRAG =
  KIT_GLSL +
  `
uniform vec2 uRot;
uniform vec4 uSig[6];
uniform vec4 uInf[2];
uniform vec4 uImp[3];
uniform vec4 uImpC[3];

const float RSH = 1.5;

vec3 toCore(vec3 p){ p.xz = rot2(uRot.x)*p.xz; p.yz = rot2(uRot.y)*p.yz; return p; }
float sdEllipsoid(vec3 p, vec3 r){ float k0 = length(p/r); float k1 = length(p/(r*r)); return k0*(k0 - 1.)/k1; }
float smin(float a, float b, float k){ float h = clamp(.5 + .5*(b - a)/k, 0., 1.); return mix(b, a, h) - k*h*(1. - h); }
/** two hemispheres with a fissure between them */
float brain(vec3 q){
  float l = sdEllipsoid(q - vec3(-.37, 0., 0.), vec3(.56, .6, .84));
  float r = sdEllipsoid(q - vec3(.37, 0., 0.), vec3(.56, .6, .84));
  return max(smin(l, r, .1), -(abs(q.x) - .03));
}
float gyroid(vec3 p){ return dot(sin(p), cos(p.yzx)); }
float map(vec3 p){
  vec3 q = toCore(p);
  float k = 3.7;
  float g = abs(gyroid(q*k + vec3(0., uTime*.12, 0.)))/k - .04;
  return max(brain(q), g*.8);
}
vec3 normalAt(vec3 p){
  vec2 e = vec2(.004, 0.);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
}

void main(){
  vec3 ro = uEye;
  vec3 rd = camRay(lookAt(ro, uTarget));
  vec3 col = starfield(.003)*.45;
  col += vec3(1., .72, .4)*pointGlow(ro, rd, vec3(0.), .3)*.45 + vec3(.3, .6, 1.)*pointGlow(ro, rd, vec3(0.), 1.)*.08;
  vec2 hb = sphIsect(ro, rd, vec3(0.), 1.);
  float tHit = 1e9;
  if(hb.x > 0.){
    float t = hb.x;
    for(int i = 0; i < 100; i++){
      vec3 p = ro + rd*t;
      float d = map(p);
      if(d < .0015){ tHit = t; break; }
      t += max(d, .004);
      if(t > hb.y) break;
    }
  }
  if(tHit < 1e8){
    vec3 p = ro + rd*tHit;
    vec3 n = normalAt(p);
    vec3 q = toCore(p);
    vec3 L = normalize(vec3(.5, .6, .6));
    float dif = max(dot(n, L), 0.)*.8 + .2;
    float rim = pow(1. - abs(dot(n, rd)), 2.);
    // depth inside the folds is darker, so the tunnels read
    float depth = clamp(-brain(q)*4., 0., 1.);
    vec3 c = vec3(.12, .42, 1.)*(.18 + 1.35*dif)*(1. - .75*depth) + vec3(.4, .85, 1.)*rim*.55*(1. - depth);
    // signals racing through the tunnels
    for(int i = 0; i < 6; i++){
      vec3 d = q - uSig[i].xyz;
      c += vec3(1., .7, .35)*exp(-dot(d, d)/.012)*2.4*uSig[i].w;
    }
    float sp = step(.99, hash13(floor(q*20.) + floor(uTime*3.)));
    c += vec3(1., .85, .6)*sp*1.3;
    // an injection gets through: red spreads, then a cyan sweep cleans it
    for(int i = 0; i < 2; i++){
      vec4 f = uInf[i];
      if(f.w < 0.) continue;
      float ang = acos(clamp(dot(normalize(q), f.xyz), -1., 1.));
      float spread = min(f.w*.34, .9);
      float clean = max(f.w - 3.2, 0.)*.9;
      float bad = (1. - smoothstep(spread - .08, spread, ang))*step(clean, ang);
      c = mix(c, vec3(1., .18, .1)*(1.2 + dif)*(.7 + .3*sin(uTime*14. + ang*40.)), bad*.85);
      c += vec3(.4, .95, 1.)*exp(-pow((ang - clean)/.05, 2.))*step(.01, clean)*step(clean, spread + .1)*1.6;
    }
    col = c;
  }
  vec2 hs = sphIsect(ro, rd, vec3(0.), RSH);
  if(hs.x > 0.){
    vec3 n = normalize(ro + rd*hs.x);
    float fr = pow(1. - abs(dot(n, rd)), 2.6);
    vec3 sc = vec3(.2, .5, 1.)*fr*.45;
    for(int i = 0; i < 3; i++){
      vec4 im = uImp[i];
      if(im.w < 0.) continue;
      float a = acos(clamp(dot(n, im.xyz), -1., 1.));
      sc += uImpC[i].rgb*(exp(-pow((a - im.w*1.4)/.12, 2.))*exp(-im.w*1.8)*1.2 + exp(-a/.18)*exp(-im.w*4.)*2.6);
    }
    col += sc;
  }
  col += flashes(ro, rd);
  outCol(col);
}
`;

const RSH = 1.5;
/** no bolts in this scene: the attacks are tokens */
const NONE = new Float32Array(12);
const STREAMS = 3;
const PER_STREAM = 30;

interface Token {
  stream: number;
  s: number;
  ev?: FeedEvent;
  speed: number;
}

/**
 * Neural core 2.0: an AI as a brain-shaped lattice (two hemispheres and a
 * fissure) with signals racing through its tunnels, fed by token streams
 * spiralling in from space. Attacks from the 90-day feed arrive as injected
 * tokens: the shield catches most, and at the type's real harm rate one gets
 * through and spreads red through the lattice until a cyan sweep cleans it.
 */
export function neuralCore2({ intel, emit }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const feed = threatFeed(intel, 61);
  const rnd = feed.rnd;
  const flashes = new Flashes();
  const pts = new PointBuf(400);
  let tokens: Token[] = [];
  for (let st = 0; st < STREAMS; st++) for (let k = 0; k < PER_STREAM; k++) tokens.push({ stream: st, s: k / PER_STREAM, speed: 0.11 });
  const infections: { dir: V3; t0: number }[] = [];
  const impacts: { dir: V3; t0: number; col: V3 }[] = [];
  const sig = new Float32Array(24);
  const inf = new Float32Array(8);
  const imp = new Float32Array(12);
  const impC = new Float32Array(12);
  let next = 2.5;
  let cam: Cam = swayCam(0, [0, 0, 0], 4.3, 0.7);

  /** a token's place on its spiral, from deep space (s = 0) to the shield (s = 1) */
  const at = (k: Token, t: number): V3 => {
    const base = (k.stream / STREAMS) * Math.PI * 2 + 0.6;
    const r = 4.4 - 2.9 * k.s;
    const a = base + k.s * 2.6 + t * 0.03;
    const y = (k.stream - 1) * 1.1 * (1 - k.s);
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  const toCore = (p: V3, a1: number, a2: number): V3 => {
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const x1 = c1 * p[0] - s1 * p[2];
    const z1 = s1 * p[0] + c1 * p[2];
    const c2 = Math.cos(a2);
    const s2 = Math.sin(a2);
    return [x1, c2 * p[1] - s2 * z1, s2 * p[1] + c2 * z1];
  };

  return {
    frag: FRAG,
    fovY: 38,
    shift: 0.42,
    frame(f, set) {
      const t = f.t;
      const dt = Math.min(0.05, f.dt || 1 / 60);
      const a1 = t * 0.1;
      const a2 = 0.25 + 0.1 * Math.sin(t * 0.07);
      cam = swayCam(t, [0, 0, 0], 4.3, 0.7, 0.15, 0.14, 0.04);
      if (t > next) {
        const ev = feed.next();
        tokens.push({ stream: Math.floor(rnd() * STREAMS), s: 0, ev, speed: 0.2 });
        emit?.(ev, false);
        next = t + 5 + rnd() * 2.5;
      }
      for (const k of tokens) k.s += k.speed * dt;
      for (const k of tokens) {
        if (k.s < 1) continue;
        if (k.ev) {
          const dir = v3.norm(at({ ...k, s: 1 }, t));
          if (k.ev.fate === "breach") {
            impacts.push({ dir, t0: t, col: [1, 0.25, 0.15] });
            infections.push({ dir: v3.norm(toCore(dir, a1, a2)), t0: t + 0.3 });
            emit?.(k.ev, true, "BREACH · CLEANED");
          } else {
            impacts.push({ dir, t0: t, col: [0.35, 0.85, 1] });
            flashes.add(v3.mul(dir, RSH), t, [0.6, 0.9, 1], 0.2);
            emit?.(k.ev, true, k.ev.fate === "intercepted" ? "CAUGHT" : "BLOCKED");
          }
          if (impacts.length > 3) impacts.shift();
          if (infections.length > 2) infections.shift();
        }
      }
      // ordinary tokens loop; injected ones are spent
      tokens = tokens.filter((k) => !(k.ev && k.s >= 1));
      for (const k of tokens) if (k.s >= 1) k.s -= 1;

      pts.reset();
      for (const k of tokens) {
        const p = at(k, t);
        const fade = Math.min(1, k.s * 6) * Math.min(1, (1 - k.s) * 8);
        if (k.ev) {
          pts.add(p, 0.06, RED, 4 + Math.sin(t * 16));
          // a short red wake
          for (let j = 1; j <= 4; j++) pts.add(at({ ...k, s: Math.max(0, k.s - j * 0.012) }, t), 0.035, RED, 1.6 - j * 0.3);
        } else pts.add(p, 0.035, CYAN, 1.7 * fade);
      }
      // signals: points wandering inside the brain
      for (let i = 0; i < 6; i++) {
        const ph = i * 1.7;
        sig.set([Math.sin(t * 0.9 + ph) * 0.55, Math.sin(t * 1.3 + ph * 2) * 0.4, Math.cos(t * 0.7 + ph * 1.3) * 0.65, 0.6 + 0.4 * Math.sin(t * 3 + ph)], i * 4);
      }
      inf.fill(-1);
      infections.forEach((x, i) => {
        if (t >= x.t0 && t - x.t0 < 6) inf.set([...x.dir, t - x.t0], i * 4);
      });
      imp.fill(-1);
      impC.fill(0);
      impacts.forEach((m, i) => {
        imp.set([...m.dir, t - m.t0], i * 4);
        impC.set([...m.col, 1], i * 4);
      });
      setCam(set, cam);
      set.v2("uRot", a1, a2);
      set.v4v("uSig", sig);
      set.v4v("uInf", inf);
      set.v4v("uImp", imp);
      set.v4v("uImpC", impC);
      set.v4v("uAtkT", NONE);
      set.v4v("uAtkH", NONE);
      flashes.pack(t, set);
      set.points(pts.data, pts.n, cam);
    },
  };
}
