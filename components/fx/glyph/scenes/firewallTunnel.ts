import type { ThreatIntel } from "@/lib/threatIntel";
import { POINT_STRIDE, projectPoint, type Cam, type FrameInfo, type GlyphController, type V3 } from "../engine";
import type { FeedEvent } from "../feed";
import { WaveDirector } from "./director";
import { AMBER, CYAN, Flashes, RED, setCam, WHITE, type Emit } from "./kit";

/** gate spacing along the tunnel */
const SP = 2.2;
/** a gate's opening (hexagon apothem; the wall sits at 1) */
const RIN = 0.8;
/** gates whose state the shader sees, from the first one ahead of the camera */
const NG = 16;
/** flight speed */
const VC = 1.5;
/** where packets are born, ahead of the camera (beyond the fog) */
const D0 = 36;
/** how far down the tunnel a takeover floods */
const TK_MAX = 16;
/** how far ahead the counter-formation holds */
const DF_WIDE = 9.5;
const DF_NARROW = 7.5;

const HOT: V3 = [1, 0.36, 0.24];
const ICE: V3 = [0.6, 0.92, 1];

const FRAG = `
uniform vec3 uEye;
uniform vec3 uTarget;
uniform float uCamZ;
uniform float uK0;
uniform vec4 uGate[16];
uniform vec4 uTake;
uniform vec4 uPk[8];
uniform vec4 uBmA[6];
uniform vec4 uBmB[6];
uniform vec4 uFlash[6];
uniform vec4 uFlashC[6];
uniform vec4 uSwA;
uniform vec4 uSwB;
uniform vec4 uPing;
uniform vec2 uHit;

const float SP = ${SP.toFixed(2)};
const float RIN = ${RIN.toFixed(2)};
const float TPI = 6.2831853;
const float SIXTH = 1.0471976;

/** the tunnel's centre line, bending gently (the same curve as in the controller) */
vec2 axisAt(float z){ return vec2(.9*sin(z*.045) + .35*sin(z*.11 + 1.), .45*sin(z*.07 + 2.)); }
/** a hexagon with flat top and bottom: 1 on the wall */
float hexd(vec2 q){ q = abs(q); return max(q.y, q.x*.8660254 + q.y*.5); }
float sqr(float x){ return x*x; }
/** a gate's state: iris closure, block flash, red tear, seal flash */
vec4 gateAt(float k){ float i = k - uK0; if(i < -.5 || i > 15.5) return vec4(0.); return uGate[int(i + .5)]; }
/** how taken over the tunnel is at distance d ahead of the camera */
float infected(float d){ float m = min(uTake.x, uTake.y); return uTake.z*(1. - smoothstep(m - .5, m + .5, d)); }

float map(vec3 p, out float mat){
  vec2 q = p.xy - axisAt(p.z);
  float h = hexd(q);
  float d = 1. - h;
  mat = 0.;
  float k = floor(p.z/SP + .5);
  float zl = p.z - k*SP;
  vec4 g = gateAt(k);
  float dF = max(abs(zl) - .09, RIN - h);
  // a taken-over gate is broken: sectors of its frame drop out and flicker
  float inf = infected(k*SP - uCamZ);
  if(inf > .3){
    float sec = floor((atan(q.y, q.x)/TPI + .5)*12.);
    if(hash12(vec2(k*1.7 + sec, floor(uTime*7.))) < .45*inf) dF = max(dF, .25);
  }
  if(dF < d){ d = dF; mat = 1.; }
  // the iris: six blades turning shut inside the frame
  if(g.x > .002){
    float a = RIN*1.03*(1. - g.x);
    float dI = max(abs(zl) - .02, a - hexd(rot2(g.x*.9)*q));
    if(dI < d){ d = dI; mat = 2.; }
  }
  return d;
}

vec3 nrm(vec3 p){
  vec2 e = vec2(.0035, -.0035);
  float m;
  return normalize(e.xyy*map(p + e.xyy, m) + e.yyx*map(p + e.yyx, m) + e.yxy*map(p + e.yxy, m) + e.xxx*map(p + e.xxx, m));
}

/** radar pings: rings of light running down the walls */
float ping(float d){
  float b = 0.;
  if(uPing.x > 0.) b += exp(-sqr((d - uPing.x)/.32))*sqr(1. - uPing.x/38.);
  if(uPing.y > 0.) b += exp(-sqr((d - uPing.y)/.32))*sqr(1. - uPing.y/38.);
  return b*uPing.z;
}

/** red light from the packets in flight and from the swarm cloud */
vec3 lights(vec3 p, vec3 n){
  vec3 c = vec3(0.);
  for(int i = 0; i < 8; i++){
    vec4 L = uPk[i];
    if(L.w <= 0.) continue;
    vec3 v = L.xyz - p;
    float d2 = dot(v, v);
    c += vec3(1., .2, .1)*L.w*exp(-d2*1.4)*(.3 + .7*max(dot(n, v)*inversesqrt(d2 + 1e-4), 0.));
  }
  if(uSwA.w > 0.){
    vec3 ba = uSwB.xyz - uSwA.xyz;
    float s = clamp(dot(p - uSwA.xyz, ba)/dot(ba, ba), 0., 1.);
    vec3 v = uSwA.xyz + ba*s - p;
    c += vec3(1., .18, .08)*uSwA.w*exp(-dot(v, v)*.9)*.35;
  }
  return c;
}

vec3 wall(vec3 p, vec3 n, vec3 rd, vec2 q, float d){
  float ang = atan(q.y, q.x);
  float U = (ang/TPI + .5)*48.;
  float ci = floor(U);
  float cu = fract(U) - .5;
  float hc = hash12(vec2(ci, 3.1));
  // circuit traces along the tunnel, broken into runs with pads at their ends
  float zz = p.z*.45 + hc*13.;
  float on = step(.45, hc)*step(.3, hash12(vec2(ci, floor(zz))));
  float sz = fract(zz);
  float line = exp(-cu*cu/.01)*on*smoothstep(0., .04, sz)*smoothstep(1., .96, sz);
  float pad = on*exp(-cu*cu/.04)*(exp(-sqr((sz - .05)/.025)) + exp(-sqr((sz - .95)/.025)));
  // amber data pulses running deeper: our outbound traffic
  float s = fract((p.z - uTime*(2.2 + 3.*hash12(vec2(ci, 9.7))))/(8. + 7.*hc) + hc*5.);
  float pulse = on*exp(-cu*cu/.03)*pow(s, 14.)*smoothstep(1., .985, s);
  float da = abs(fract(ang/SIXTH + .5) - .5)*SIXTH;
  float corner = exp(-da*da/.0005);
  float zl = p.z - floor(p.z/SP + .5)*SP;
  float lit = .3 + .7*max(dot(n, -rd), 0.);
  vec3 c = vec3(.006, .014, .036)*lit;
  c += vec3(.1, .32, .7)*line*.32 + vec3(.35, .8, 1.)*pad*.6;
  c += vec3(1., .66, .3)*pulse*1.8;
  c += vec3(.2, .45, .9)*corner*.16;
  c += vec3(.25, .6, 1.)*exp(-zl*zl/.035)*.15;
  c += vec3(1., .68, .36)*ping(d)*.55;
  c += lights(p, n);
  float inf = infected(d);
  if(inf > 0.){
    // takeover: the walls go red, blocks of corrupt glyphs flicker, a scan crawls through
    float l = dot(c, vec3(.33));
    float blk = step(.84, hash12(floor(vec2(U*.5, p.z*3.)) + floor(uTime*9.)*.71));
    float scan = .6 + .4*sin(p.z*14. - uTime*20.);
    vec3 r = vec3(1., .16, .08)*(.006 + min(l, .25)*1.1*scan) + vec3(1., .3, .2)*blk*.55 + vec3(1., .4, .25)*(line*.5 + pad*.9);
    c = mix(c, r, inf);
  }
  return c;
}

vec3 frame(vec3 p, vec3 n, vec3 rd, vec2 q, float k, vec4 g, float d){
  float h = hexd(q);
  vec2 rad = normalize(q + 1e-5);
  float inner = smoothstep(.4, .9, -dot(n.xy, rad));
  float face = smoothstep(.5, .9, abs(n.z));
  vec3 c = vec3(.02, .05, .12)*(.35 + .65*max(dot(n, -rd), 0.));
  c += vec3(.25, .7, 1.)*inner*.65;
  c += vec3(.45, .9, 1.)*exp(-max(h - RIN, 0.)/.03)*face*1.1;
  // status lights at the six inner corners, blinking faster as the threat rises
  float ang = atan(q.y, q.x);
  float am = floor(ang/SIXTH + .5)*SIXTH;
  vec2 dv = q - vec2(cos(am), sin(am))*.97;
  float blink = step(.45, fract(uTime*(.6 + uPing.w*1.4) + k*.37 + am*.5));
  c += vec3(1., .62, .25)*exp(-dot(dv, dv)/.0025)*face*(.6 + 1.8*blink);
  c += vec3(1., .7, .4)*ping(d)*.9;
  c += vec3(.75, .95, 1.)*g.y*2.2 + vec3(.3, .9, 1.)*g.w*3. + vec3(1., .2, .1)*g.z*2.6;
  c += lights(p, n)*.7;
  float inf = infected(d);
  if(inf > 0.){
    float l = dot(c, vec3(.33));
    float fl = .55 + .45*step(.5, hash12(vec2(k, floor(uTime*12.))));
    c = mix(c, vec3(1., .18, .08)*(.06 + min(l, .3)*2.)*fl, inf);
  }
  // frames rushing past the camera stay quiet
  return c*(.25 + .75*smoothstep(.4, 3., d));
}

vec3 iris(vec2 q, vec3 n, vec3 rd, vec4 g, float d){
  vec2 r = rot2(g.x*.9)*q;
  float hq = hexd(r);
  float a = RIN*1.03*(1. - g.x);
  float x = atan(r.y, r.x)/SIXTH + (hq - a)*2.4;
  float fx = fract(x);
  float seam = exp(-sqr(min(fx, 1. - fx)/.07));
  vec3 c = vec3(.05, .11, .22)*(.45 + .55*max(dot(n, -rd), 0.)) + vec3(.3, .75, 1.)*seam*.45;
  c += vec3(.5, .92, 1.)*exp(-max(hq - a, 0.)/.035)*1.5;
  c += vec3(.85, .97, 1.)*g.y*(3.*exp(-hq*2.5) + .5);
  return c*(.3 + .7*smoothstep(.4, 3.5, d));
}

void main(){
  vec2 nd = ndc();
  vec2 sq = nd;
  sq.x -= uShift;
  // takeover glitch: rows of the picture slip sideways
  float gl = uTake.w;
  if(gl > 0.){
    float band = floor(gl_FragCoord.y/4.);
    float fr = floor(uTime*16.);
    if(hash12(vec2(band, fr)) > 1. - .4*gl) sq.x += (hash12(vec2(band*3.1, fr + 5.)) - .5)*.3*gl;
  }
  vec3 ro = uEye;
  vec3 rd = normalize(lookAt(ro, uTarget)*vec3(sq*uTan, 1.));
  float t = .02;
  float mat = -1.;
  for(int i = 0; i < 110; i++){
    vec3 p = ro + rd*t;
    float m;
    float d = map(p, m);
    if(d < .001 + .0012*t){ mat = m; break; }
    t += d*.9;
    if(t > 44.) break;
  }
  vec3 haze = vec3(.004, .008, .022) + vec3(.03, .004, .006)*uPing.w;
  vec3 col;
  float tHit = 60.;
  if(mat < 0.){
    // the far end: a faint glow that warms with the threat level
    col = haze + vec3(.005, .014, .036) + vec3(.025, .004, .002)*uPing.w*(.6 + .4*sin(uTime*3.));
  } else {
    tHit = t;
    vec3 p = ro + rd*t;
    vec3 n = nrm(p);
    vec2 q = p.xy - axisAt(p.z);
    float d = p.z - uCamZ;
    float k = floor(p.z/SP + .5);
    vec4 g = gateAt(k);
    vec3 c = mat < .5 ? wall(p, n, rd, q, d) : mat < 1.5 ? frame(p, n, rd, q, k, g, d) : iris(q, n, rd, g, d);
    col = mix(haze, c, exp(-t*.062));
  }
  // defender beams
  for(int i = 0; i < 6; i++){
    vec4 A = uBmA[i];
    if(A.w <= 0.) continue;
    float s;
    float d2 = segDist2(ro, rd, A.xyz, uBmB[i].xyz, s);
    vec3 cp = A.xyz + (uBmB[i].xyz - A.xyz)*s;
    if(dot(cp - ro, rd) > tHit + .2) continue;
    col += vec3(.45, .92, 1.)*A.w*(exp(-d2/.0012)*1.8 + exp(-d2/.012)*.3);
  }
  // the enemy swarm: a churning red cloud pouring down the tunnel
  if(uSwA.w > 0.){
    float s;
    float d2 = segDist2(ro, rd, uSwA.xyz, uSwB.xyz, s);
    vec3 cp = uSwA.xyz + (uSwB.xyz - uSwA.xyz)*s;
    float tb = dot(cp - ro, rd);
    if(tb < tHit + 1.){
      float nz = fbm3(vec3(cp.xy*2., cp.z*.7 + uTime*1.3) + rd*4.);
      col += vec3(1., .18, .08)*uSwA.w*exp(-d2/(uSwB.w*uSwB.w))*(.08 + .45*nz*nz)*exp(-tb*.05);
    }
  }
  // flashes: expanding shells where something was blocked, zapped or sealed
  for(int i = 0; i < 6; i++){
    vec4 f = uFlash[i];
    if(f.w < 0.) continue;
    vec3 oc = f.xyz - ro;
    float tt = dot(oc, rd);
    if(tt < 0. || tt > tHit + .3) continue;
    float d = length(oc - rd*tt);
    float sz = uFlashC[i].a;
    float r = sz*(1. - exp(-f.w*5.));
    float w = .025 + sz*.08;
    col += uFlashC[i].rgb*(exp(-sqr((d - r)/w))*exp(-f.w*3.)*1.6 + exp(-d*d/(sz*sz*.08))*exp(-f.w*6.)*4.);
  }
  // a breach hits the camera; the reseal wipes outward from the vanishing point
  col += vec3(1., .16, .08)*uHit.x*(.35 + .5*dot(sq, sq));
  if(uHit.y > 0.){
    float rr = length(sq*vec2(uTan.x/uTan.y, 1.));
    col += vec3(.35, .9, 1.)*exp(-sqr((rr - (1. - uHit.y)*2.2)/.12))*uHit.y*1.2;
  }
  // keep the headline side calm on wide layouts
  if(uShift > .01) col *= .32 + .68*smoothstep(-1.05, -.1, nd.x);
  outCol(col);
}
`;

const ax = (z: number) => 0.9 * Math.sin(z * 0.045) + 0.35 * Math.sin(z * 0.11 + 1);
const ay = (z: number) => 0.45 * Math.sin(z * 0.07 + 2);
const camZAt = (t: number) => VC * t + 0.6 * Math.sin(t * 0.13);
const hexd = (x: number, y: number) => Math.max(Math.abs(y), Math.abs(x) * 0.8660254 + Math.abs(y) * 0.5);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};
const smooth = (a: number, b: number, x: number) => ease((x - a) / (b - a));
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Point sprites written straight into the buffer (no per-point arrays). */
class Pts {
  data: Float32Array;
  n = 0;
  private max: number;
  constructor(max: number) {
    this.max = max;
    this.data = new Float32Array(max * POINT_STRIDE);
  }
  add(x: number, y: number, z: number, r: number, c: V3, k: number) {
    if (this.n >= this.max || k <= 0.003) return;
    const d = this.data;
    const o = this.n * POINT_STRIDE;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = r;
    d[o + 4] = c[0];
    d[o + 5] = c[1];
    d[o + 6] = c[2];
    d[o + 7] = k;
    this.n += 1;
  }
}

interface Gate {
  close: number;
  open: number;
  hit: number;
  red: number;
  snap: number;
  seal: number;
}

interface Packet {
  ev: FeedEvent;
  /** offset from the tunnel axis */
  x: number;
  y: number;
  ph: number;
  z0: number;
  t0: number;
  v: number;
  /** blocked: the gate (world index) whose iris stops it */
  gate: number;
  /** intercepted: when the drone's beam kills it, where the drone waits, and which drone (-1: a wall turret) */
  ti: number;
  sx: number;
  sy: number;
  sz: number;
  drone: number;
  dead: number;
  lastK: number;
}

interface Swarm {
  ev: FeedEvent;
  t0: number;
  n: number;
  zc0: number;
  r: Float32Array;
  a: Float32Array;
  w: Float32Array;
  zo: Float32Array;
  hz: Float32Array;
  dead: Float32Array;
  lk: Uint8Array;
  leakZ: Float32Array;
  killNext: number;
  leakAt: number;
  over: number;
  breach: boolean;
  gap: number;
}

interface Breach {
  ev: FeedEvent;
  swarm: boolean;
  t0: number;
  /** how deep it floods, and when (seconds after the hit) it is resealed */
  emax: number;
  dur: number;
}

interface Beam {
  a: V3;
  b: V3;
  t0: number;
  dur: number;
}

type P3 = { x: number; y: number; z: number };

/**
 * Firewall tunnel: a first-person flight down an endless hexagonal tunnel of
 * firewall gates, circuit traces on the walls, amber traffic running deeper
 * and radar pings travelling down the walls as rings of light. Attacks from
 * the 90-day feed are red packets streaking up from the dark: an iris in a
 * gate snaps shut on most of them, defender drones flying along the walls
 * zap the rest, and in war an enemy swarm pours down the tunnel into a
 * counter-formation of drones. At the type's real harm rate a packet gets
 * past every gate and hits the camera: the tunnel floods red and glitches,
 * the gates break, and the drones reseal it gate by gate.
 */
export function firewallTunnel({ intel, emit }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const director = new WaveDirector(intel, 113);
  const rnd = director.rnd;
  const flashes = new Flashes();
  const pts = new Pts(2400);
  const gates = new Map<number, Gate>();
  let packets: Packet[] = [];
  const jobs: (Packet | null)[] = [];
  let beams: Beam[] = [];
  let swarm: Swarm | null = null;
  let breaches: Breach[] = [];
  /** how far ahead the tunnel is taken over, the gate its sealed edge sits on, the reseal squad, the glitch */
  let edge = 0;
  let edgeK = -1;
  let squadD = 30;
  let glitch = 0;
  let ready = false;
  let narrow = false;
  let NP = 14;
  let NT = 28;
  let rings = 3;
  let DF = DF_WIDE;
  const slotX: number[] = [];
  const slotY: number[] = [];
  let hitT = -99;
  let wipeT = -99;
  let pingA = -99;
  let pingB = -99;
  let nextPing = 0.8;
  let lastBlock: { k: number; n: number; t: number } | null = null;
  let camZ = 0;
  let cam: Cam = { eye: [0, 0, 0], target: [0, 0, 1] };
  const P: P3 = { x: 0, y: 0, z: 0 };
  const Q: P3 = { x: 0, y: 0, z: 0 };

  // sparks: a ring buffer of x y z vx vy vz t0 life
  const SPK = 420;
  const spk = new Float32Array(SPK * 8);
  const spkC = new Uint8Array(SPK);
  for (let i = 0; i < SPK; i++) spk[i * 8 + 6] = -99;
  let spkAt = 0;
  const SPK_COL: V3[] = [RED, HOT, ICE, AMBER, CYAN];

  // uniforms
  const gateU = new Float32Array(NG * 4);
  const pkU = new Float32Array(32);
  const bmA = new Float32Array(24);
  const bmB = new Float32Array(24);

  // the camera's view, for fog and calm on the point sprites
  const view = { ex: 0, ey: 0, ez: 0, fx: 0, fy: 0, fz: 1, rx: 1, rz: 0, tanX: 1, shift: 0, calm: false };
  const setView = (c: Cam, f: FrameInfo) => {
    let fx = c.target[0] - c.eye[0];
    let fy = c.target[1] - c.eye[1];
    let fz = c.target[2] - c.eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    const rl = Math.hypot(fz, fx) || 1;
    view.ex = c.eye[0];
    view.ey = c.eye[1];
    view.ez = c.eye[2];
    view.fx = fx;
    view.fy = fy;
    view.fz = fz;
    view.rx = -fz / rl;
    view.rz = fx / rl;
    view.tanX = f.tan[0];
    view.shift = f.shift;
    view.calm = !f.narrow && f.shift > 0.01;
  };
  /** fog, near fade and the calm left side, for a point at world x y z */
  const vis = (x: number, y: number, z: number) => {
    const vx = x - view.ex;
    const vy = y - view.ey;
    const vz = z - view.ez;
    const d = vx * view.fx + vy * view.fy + vz * view.fz;
    if (d < 0.1) return 0;
    let k = Math.exp(-d * 0.06) * smooth(0.25, 1.6, d);
    if (view.calm) {
      const nx = (vx * view.rx + vz * view.rz) / (d * view.tanX) + view.shift;
      k *= 0.32 + 0.68 * smooth(-1.05, -0.1, nx);
    }
    return k;
  };
  /** a point in tunnel coordinates (offset from the axis, world z) */
  const put = (p: P3, r: number, c: V3, k: number) => {
    const wx = ax(p.z) + p.x;
    const wy = ay(p.z) + p.y;
    pts.add(wx, wy, p.z, r, c, k * vis(wx, wy, p.z));
  };

  const gate = (k: number) => {
    let g = gates.get(k);
    if (!g) {
      g = { close: -1, open: -1, hit: -1, red: -1, snap: -1, seal: -1 };
      gates.set(k, g);
    }
    return g;
  };
  const closure = (g: Gate, t: number) => {
    let c = 0;
    if (g.close >= 0) {
      c = clamp01((t - g.close) / 0.32);
      if (g.open >= 0) c *= 1 - clamp01((t - g.open) / 0.8);
    }
    // too late: the iris snaps half shut behind a packet that tore through
    if (g.snap >= 0 && t - g.snap < 0.9) c = Math.max(c, 0.55 * Math.sin(Math.PI * clamp01((t - g.snap) / 0.9)));
    return c;
  };

  const spark = (x: number, y: number, z: number, vx: number, vy: number, vz: number, t: number, life: number, col: number) => {
    const o = spkAt * 8;
    spk[o] = x;
    spk[o + 1] = y;
    spk[o + 2] = z;
    spk[o + 3] = vx;
    spk[o + 4] = vy;
    spk[o + 5] = vz;
    spk[o + 6] = t;
    spk[o + 7] = life;
    spkC[spkAt] = col;
    spkAt = (spkAt + 1) % SPK;
  };
  /** a burst at world x y z; vz biases it along the tunnel */
  const burst = (x: number, y: number, z: number, n: number, speed: number, vz: number, t: number, cols: number[]) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const e = rnd() * 2 - 1;
      const s = speed * (0.4 + rnd() * 0.8);
      const c = Math.sqrt(1 - e * e);
      spark(x, y, z, Math.cos(a) * c * s, Math.sin(a) * c * s, e * s + vz, t, 0.5 + rnd() * 0.5, cols[i % cols.length]!);
    }
  };

  const pkAt = (pk: Packet, t: number, out: P3) => {
    out.x = pk.x + 0.06 * Math.sin(t * 2.3 + pk.ph);
    out.y = pk.y + 0.05 * Math.cos(t * 1.9 + pk.ph);
    out.z = pk.z0 - pk.v * (t - pk.t0);
  };

  /** a patrolling drone: along the walls, outpacing the camera, wrapping round behind it */
  const patrol = (i: number, t: number, out: P3) => {
    const a = (i / NP) * Math.PI * 2 + 0.25 + 0.3 * Math.sin(t * 0.21 + i * 1.3);
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    const s = 0.84 / hexd(cx, cy);
    out.x = cx * s;
    out.y = cy * s;
    out.z = camZAt(t) + ((i * 7.31 + t * (1.4 + 0.9 * hash(i))) % 30) - 3;
  };
  /** where drone i is now (patrolling or out on an interception); returns its brightness */
  const droneAt = (i: number, t: number, out: P3) => {
    const pk = jobs[i];
    if (pk) {
      const ts = Math.max(pk.t0, pk.ti - 1.1);
      if (t >= ts && t < pk.ti + 1.3) {
        if (t < pk.ti - 0.2) {
          patrol(i, ts, Q);
          const u = ease((t - ts) / Math.max(0.1, pk.ti - 0.2 - ts));
          out.x = Q.x + (pk.sx - Q.x) * u;
          out.y = Q.y + (pk.sy - Q.y) * u;
          out.z = Q.z + (pk.sz - Q.z) * u;
          return 1.5;
        }
        if (t < pk.ti + 0.15) {
          out.x = pk.sx;
          out.y = pk.sy;
          out.z = pk.sz;
          return 2.2;
        }
        patrol(i, t, Q);
        const u = ease((t - pk.ti - 0.15) / 1.15);
        out.x = pk.sx + (Q.x - pk.sx) * u;
        out.y = pk.sy + (Q.y - pk.sy) * u;
        out.z = pk.sz + (Q.z - pk.sz) * u;
        // the patrol lane may have wrapped behind the camera meanwhile
        return Math.abs(Q.z - pk.sz) > 12 ? 1 - u : 1.3;
      }
      if (t >= pk.ti + 1.3) jobs[i] = null;
    }
    patrol(i, t, out);
    return 1;
  };

  /**
   * A breach hits the camera: the tunnel floods red ahead of it and the
   * drones reseal it on the breach's own clock. Breaches are frequent (the
   * real harm share), so overlapping ones merge: the flood reaches as deep
   * as the deepest of them, and each resolves in the log on its own.
   */
  const hitBreach = (ev: FeedEvent, isSwarm: boolean, t: number) => {
    breaches.push({ ev, swarm: isSwarm, t0: t, emax: isSwarm ? TK_MAX : Math.min(12, 6.5 + 2 * breaches.length), dur: isSwarm ? 4 : 2.5 });
    hitT = t;
  };

  const launch = (ev: FeedEvent, t: number) => {
    const v = 4.4 + rnd() * 2.4;
    const a = rnd() * Math.PI * 2;
    const r = 0.1 + rnd() * 0.42;
    const z0 = camZ + D0;
    const pk: Packet = { ev, x: Math.cos(a) * r * 1.15, y: Math.sin(a) * r * 0.85, ph: rnd() * 6.28, z0, t0: t, v, gate: -1, ti: -1, sx: 0, sy: 0, sz: 0, drone: -1, dead: -1, lastK: Math.floor(z0 / SP) };
    if (ev.fate === "blocked") {
      // a gate it will meet in plain view, beyond anything taken over
      const lo = Math.max(narrow ? 5 : 6, edge + 3);
      const hi = Math.min(D0 - 5, Math.max(lo + 3, narrow ? 15 : 22));
      const d = lo + rnd() * (hi - lo);
      const tau = (D0 - d) / (v + VC);
      pk.gate = Math.min(Math.round((camZAt(t + tau) + d) / SP), Math.floor((z0 - 1) / SP));
    } else if (ev.fate === "intercepted") {
      const dI = (narrow ? 5 : 7) + rnd() * (narrow ? 7 : 10);
      pk.ti = t + (D0 - dI) / (v + VC);
      // the drone waits beside the packet's line, towards the wall, a little nearer the camera
      pkAt(pk, pk.ti, P);
      let dx = P.x;
      let dy = P.y;
      const l = Math.hypot(dx, dy);
      if (l < 0.08) {
        dx = Math.cos(pk.ph);
        dy = Math.sin(pk.ph);
      } else {
        dx /= l;
        dy /= l;
      }
      const hs = 0.66 / hexd(dx, dy);
      pk.sx = dx * hs;
      pk.sy = dy * hs;
      pk.sz = P.z - 0.7;
      const ts = Math.max(t, pk.ti - 1.1);
      let best = -1;
      let bd = 1e9;
      for (let i = 0; i < NP; i++) {
        const j = jobs[i];
        if (j && j.ti + 1.3 > ts) continue;
        patrol(i, ts, Q);
        const dd = Math.hypot(Q.x - pk.sx, Q.y - pk.sy, (Q.z - pk.sz) * 0.5);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
      pk.drone = best;
      if (best >= 0) jobs[best] = pk;
    }
    packets.push(pk);
    emit?.(ev, false);
  };

  const formAt = (sw: Swarm, i: number, t: number, out: P3) => {
    const ts = sw.t0 + 0.15 + i * 0.035;
    if (t < ts) return 0;
    const fr = t * 0.3;
    const c = Math.cos(fr);
    const s = Math.sin(fr);
    const sx = slotX[i]! * c - slotY[i]! * s;
    const sy = slotX[i]! * s + slotY[i]! * c;
    const u = ease((t - ts) / 1.9);
    const z0 = camZAt(ts) - 2.5;
    const fz = camZ + DF + 0.12 * Math.sin(t * 2 + i);
    out.x = sx * (1.5 - 0.5 * u);
    out.y = sy * (1.5 - 0.5 * u);
    out.z = z0 + (fz - z0) * u;
    if (sw.over >= 0) {
      const v = ease((t - sw.over) / 2.2);
      out.z += 16 * v;
      return 1 - v;
    }
    return 1;
  };
  const swarmPos = (sw: Swarm, j: number, t: number, zc: number, fz: number, out: P3) => {
    const ang = sw.a[j]! + sw.w[j]! * t;
    const rr = sw.r[j]! * (0.88 + 0.12 * Math.sin(t * 2.7 + j));
    out.x = Math.cos(ang) * rr * 1.1;
    out.y = Math.sin(ang) * rr * 0.85;
    if (sw.lk[j]) {
      out.z = sw.leakZ[j]! - 8 * (t - sw.leakAt);
      out.x *= 0.6;
      out.y *= 0.6;
    } else out.z = Math.max(zc + sw.zo[j]!, fz + 0.8 + sw.hz[j]! * 1.2);
  };
  const startSwarm = (ev: FeedEvent, size: number, t: number) => {
    const old = swarm;
    if (old && old.over < 0) {
      old.dead.fill(t);
      old.over = t;
      if (old.breach) hitBreach(old.ev, true, t);
      else emit?.(old.ev, true, "SWARM REPELLED");
    }
    const n = Math.min(size, narrow ? 48 : 110);
    const sw: Swarm = {
      ev,
      t0: t,
      n,
      zc0: camZ + 44,
      r: new Float32Array(n),
      a: new Float32Array(n),
      w: new Float32Array(n),
      zo: new Float32Array(n),
      hz: new Float32Array(n),
      dead: new Float32Array(n).fill(-1),
      lk: new Uint8Array(n),
      leakZ: new Float32Array(n),
      killNext: 0,
      leakAt: -1,
      over: -1,
      breach: ev.fate === "breach",
      gap: 4.4 / n,
    };
    for (let j = 0; j < n; j++) {
      sw.r[j] = 0.12 + 0.6 * Math.sqrt(rnd());
      sw.a[j] = rnd() * Math.PI * 2;
      sw.w[j] = (0.6 + rnd() * 1.4) * (rnd() < 0.5 ? -1 : 1);
      sw.zo[j] = (rnd() * 2 - 1) * 4.5;
      sw.hz[j] = rnd();
    }
    swarm = sw;
    emit?.(ev, false);
  };

  const init = (f: FrameInfo) => {
    narrow = f.narrow;
    NP = narrow ? 8 : 14;
    NT = narrow ? 14 : 28;
    rings = narrow ? 2 : 3;
    DF = narrow ? DF_NARROW : DF_WIDE;
    // the counter-formation: a hexagonal lattice filling the tunnel
    slotX.push(0);
    slotY.push(0);
    const rr = rings === 3 ? 0.235 : 0.33;
    for (let m = 1; m <= rings; m++) {
      for (let s = 0; s < 6; s++) {
        const a0 = (s * Math.PI) / 3;
        const a1 = ((s + 1) * Math.PI) / 3;
        for (let j = 0; j < m; j++) {
          const u = j / m;
          slotX.push(m * rr * (Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * u) * 1.1);
          slotY.push(m * rr * (Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * u) * 0.9);
        }
      }
    }
    for (let i = 0; i < NP; i++) jobs.push(null);
    ready = true;
  };

  return {
    frag: FRAG,
    fovY: 36,
    shift: 0.4,
    frame(f, set) {
      const t = f.t;
      const dt = Math.min(0.05, f.dt || 1 / 60);
      if (!ready) init(f);
      camZ = camZAt(t);
      const level = director.level(t);
      const wave = director.tick(t);
      for (const ev of wave.attacks) launch(ev, t);
      if (wave.swarm) startSwarm(wave.swarm.ev, wave.swarm.size, t);

      // radar pings, quicker as the threat rises
      if (t >= nextPing) {
        pingB = pingA;
        pingA = t;
        nextPing = t + 3.4 - 1.5 * level;
      }
      const pa = (t - pingA) * 10;
      const pb = (t - pingB) * 10;

      // packets: the gate shuts on them, a drone zaps them, or (a real breach) they get through
      for (const pk of packets) {
        if (pk.dead >= 0) continue;
        pkAt(pk, t, P);
        const k = Math.floor(P.z / SP);
        if (pk.gate >= 0) {
          const gz = pk.gate * SP;
          const g = gate(pk.gate);
          if ((P.z - gz) / pk.v < 0.42 && (g.close < 0 || g.open >= 0)) {
            // shut (or shut again from wherever a reopening iris has got to)
            g.close = t - closure(g, t) * 0.32;
            g.open = -1;
          }
          if (P.z <= gz + 0.06) {
            pk.dead = t;
            g.hit = t;
            g.open = t + 0.55;
            const wx = ax(gz) + P.x;
            const wy = ay(gz) + P.y;
            flashes.add([wx, wy, gz - 0.05], t, [0.6, 0.92, 1], 0.55);
            burst(wx, wy, gz - 0.08, 12, 1.6, -2.6, t, [1, 2, 1, 0]);
            const n = Math.max(1, Math.round((gz - camZ) / SP));
            lastBlock = { k: pk.gate, n, t };
            emit?.(pk.ev, true, `BLOCKED AT GATE ${n}`);
          }
        } else if (pk.ti >= 0) {
          if (t >= pk.ti) {
            pk.dead = t;
            const wx = ax(P.z) + P.x;
            const wy = ay(P.z) + P.y;
            flashes.add([wx, wy, P.z], t, [0.5, 0.9, 1], 0.42);
            burst(wx, wy, P.z, 14, 1.4, -1.2, t, [0, 1, 3, 2]);
            emit?.(pk.ev, true, "INTERCEPTED");
          }
        } else {
          // a breach tears through every gate on its way in
          if (k < pk.lastK) {
            const g = gate(pk.lastK);
            g.red = t;
            g.snap = t;
            const gz = pk.lastK * SP;
            burst(ax(gz) + P.x, ay(gz) + P.y, gz, 5, 1.2, -1, t, [0, 1]);
          }
          if (P.z - camZ < 0.45) {
            pk.dead = t;
            hitBreach(pk.ev, false, t);
          }
        }
        pk.lastK = k;
      }
      packets = packets.filter((p) => p.dead < 0);

      // the swarm and the counter-formation
      const sw = swarm;
      let swAlive = 0;
      let zc = 0;
      const fz = camZ + DF;
      if (sw) {
        zc = sw.zc0 - 2.4 * (t - sw.t0);
        let near = -1;
        let nearZ = 1e9;
        for (let j = 0; j < sw.n; j++) {
          if (sw.dead[j]! >= 0) continue;
          swarmPos(sw, j, t, zc, fz, P);
          if (sw.lk[j]) {
            if (P.z - camZ < 0.5) {
              // the leak reaches the camera: a takeover
              for (let i = 0; i < sw.n; i++) if (sw.lk[i]) sw.dead[i] = t;
              hitBreach(sw.ev, true, t);
              sw.over = t;
              break;
            }
            continue;
          }
          swAlive++;
          if (P.z < nearZ) {
            nearZ = P.z;
            near = j;
          }
        }
        const engaged = t > sw.t0 + 2.4 && nearZ - fz < 9;
        if (sw.breach && sw.leakAt < 0 && engaged && swAlive <= 4 && swAlive > 0) {
          // at the type's real harm rate a few slip through the formation
          sw.leakAt = t;
          for (let j = 0; j < sw.n; j++) {
            if (sw.dead[j]! >= 0) continue;
            swarmPos(sw, j, t, zc, fz, P);
            sw.lk[j] = 1;
            sw.leakZ[j] = P.z;
          }
          swAlive = 0;
          near = -1;
        }
        let kills = 0;
        while (engaged && near >= 0 && t >= sw.killNext && kills < 3 && sw.over < 0) {
          swarmPos(sw, near, t, zc, fz, P);
          sw.dead[near] = t;
          swAlive--;
          kills++;
          const fi = Math.floor(rnd() * slotX.length);
          formAt(sw, fi, t, Q);
          const bx = ax(P.z) + P.x;
          const by = ay(P.z) + P.y;
          beams.push({ a: [ax(Q.z) + Q.x, ay(Q.z) + Q.y, Q.z], b: [bx, by, P.z], t0: t, dur: 0.15 });
          burst(bx, by, P.z, 3, 1.1, 0, t, [0, 1, 2]);
          if (swAlive % 9 === 0) flashes.add([bx, by, P.z], t, [1, 0.45, 0.3], 0.3);
          sw.killNext = Math.max(sw.killNext, t - 0.1) + sw.gap;
          near = -1;
          nearZ = 1e9;
          for (let j = 0; j < sw.n; j++) {
            if (sw.dead[j]! >= 0 || sw.lk[j]) continue;
            swarmPos(sw, j, t, zc, fz, P);
            if (P.z < nearZ) {
              nearZ = P.z;
              near = j;
            }
          }
        }
        if (swAlive <= 0 && sw.over < 0 && sw.leakAt < 0) {
          sw.over = t;
          emit?.(sw.ev, true, "SWARM REPELLED");
        }
        if (sw.over >= 0 && t - sw.over > 3) swarm = null;
      }

      // the takeover: a flood, a glitch, then the drones reseal it gate by gate from the far end in
      let flood = 0;
      let sealC = 0;
      glitch = 0;
      for (const b of breaches) {
        const tau = t - b.t0;
        if (tau < 1.0) {
          flood = Math.max(flood, b.emax * ease(tau / 0.5));
          glitch = Math.max(glitch, tau < 0.7 ? 1 - tau : 0.3);
        } else {
          sealC = Math.max(sealC, b.emax * (1 - (tau - 1.0) / (b.dur - 1.0)));
          glitch = Math.max(glitch, 0.12);
        }
      }
      // the sealed edge sits on a gate: beyond the last gate sealed the tunnel is clean
      let sealE = 0;
      if (sealC > 0.6) {
        const k = Math.ceil((camZ + sealC) / SP);
        sealE = k * SP - camZ - 0.3;
        if (edgeK >= 0 && k < edgeK) {
          const gz = k * SP;
          gate(k).seal = t;
          flashes.add([ax(gz), ay(gz), gz], t, [0.35, 0.9, 1], 0.75);
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            const s = 0.78 / hexd(Math.cos(a), Math.sin(a));
            spark(ax(gz) + Math.cos(a) * s, ay(gz) + Math.sin(a) * s, gz, Math.cos(a) * 0.5, Math.sin(a) * 0.5, -0.6, t, 0.6, 2);
          }
        }
        edgeK = k;
      } else edgeK = -1;
      edge = Math.max(flood, sealE);
      if (breaches.length) {
        for (const b of breaches) if (t - b.t0 >= b.dur) emit?.(b.ev, true, b.swarm ? "SWARM BREACH · RESEALED" : "BREACH · RESEALED");
        breaches = breaches.filter((b) => t - b.t0 < b.dur);
        if (!breaches.length) {
          wipeT = t;
          edge = 0;
        }
      }

      // gates: finished cycles reset, passed gates forgotten
      for (const [k, g] of gates) {
        if (k * SP < camZ - 3) gates.delete(k);
        else if (g.open >= 0 && t - g.open > 0.85) {
          g.close = -1;
          g.open = -1;
        }
      }

      // the camera: down the axis, swaying a little; a breach shakes it
      const hitK = Math.exp(-(t - hitT) * 3.2);
      const sh = hitK * 0.07;
      const tz = camZ + 7;
      cam = {
        eye: [ax(camZ) + 0.12 * Math.sin(t * 0.5) + Math.sin(t * 91.7) * sh, ay(camZ) + 0.08 * Math.sin(t * 0.37 + 1) + Math.sin(t * 73.1) * sh, camZ],
        target: [ax(tz) + 0.05 * Math.sin(t * 0.3), ay(tz) - 0.03, tz],
      };
      setView(cam, f);

      // point sprites
      pts.n = 0;
      const pr = narrow ? 0.1 : 0.08;
      let li = 0;
      pkU.fill(0);
      for (const pk of packets) {
        pkAt(pk, t, P);
        const dist = P.z - camZ;
        // a radar ping passing a packet lights it up: detected
        const seen = Math.exp(-(((dist - pa) / 0.8) ** 2)) + Math.exp(-(((dist - pb) / 0.8) ** 2));
        // packets cut through the fog more than the walls do, so they read from deep in the tunnel
        const lift = Math.exp(Math.min(dist, 30) * 0.035);
        put(P, pr, HOT, (5 + seen * 3) * lift);
        const z = P.z;
        for (let j = 1; j <= 10; j++) {
          P.z = z + j * 0.26 * (pk.v / 5.5);
          put(P, pr * (0.8 - j * 0.03), RED, 2.8 * (1 - j / 11) * lift);
        }
        if (li < 8 && dist < 30) {
          pkU[li * 4] = ax(z) + P.x;
          pkU[li * 4 + 1] = ay(z) + P.y;
          pkU[li * 4 + 2] = z;
          pkU[li * 4 + 3] = 0.5;
          li++;
        }
      }
      // defender drones
      for (let i = 0; i < NP; i++) {
        const m = droneAt(i, t, P);
        const fade = 1 - smooth(21, 27, P.z - camZ);
        put(P, narrow ? 0.055 : 0.045, CYAN, 2.3 * m * fade);
        const z = P.z;
        for (let j = 1; j <= 3; j++) {
          P.z = z - j * 0.14;
          put(P, 0.03, CYAN, 0.9 * (1 - j / 4) * m * fade);
        }
      }
      // a wall turret takes an interception when every drone is busy
      for (const pk of packets) {
        if (pk.ti < 0 || pk.drone >= 0 || t < pk.ti - 0.6) continue;
        P.x = pk.sx;
        P.y = pk.sy;
        P.z = pk.sz;
        put(P, narrow ? 0.06 : 0.05, ICE, 2.6);
      }
      // outbound traffic: small amber packets running deeper
      for (let j = 0; j < NT; j++) {
        const a = hash(j + 40) * Math.PI * 2;
        const r = 0.3 + 0.32 * hash(j + 80);
        const dz = ((hash(j + 120) * 32 + t * (2.2 + 1.6 * hash(j + 160))) % 32) - 2;
        P.x = Math.cos(a) * r * 1.1;
        P.y = Math.sin(a) * r * 0.85;
        P.z = camZ + dz;
        const fade = 1 - smooth(22, 30, dz);
        put(P, 0.032, AMBER, 1.5 * fade);
        P.z -= 0.2;
        put(P, 0.024, AMBER, 0.6 * fade);
      }
      // the swarm and its counter-formation
      if (sw && swarm === sw) {
        for (let j = 0; j < sw.n; j++) {
          const dd = sw.dead[j]!;
          if (dd >= 0 && t - dd > 0.15) continue;
          swarmPos(sw, j, t, zc, fz, P);
          if (dd >= 0) {
            put(P, 0.09, WHITE, 3 * (1 - (t - dd) / 0.15));
            continue;
          }
          const fl = 2.4 + Math.sin(t * 17 + j * 1.7) * 0.8;
          put(P, narrow ? 0.07 : 0.055, RED, fl * smooth(0, 1.2, t - sw.t0));
          P.z += 0.25;
          put(P, 0.04, RED, 0.9);
        }
        for (let i = 0; i < slotX.length; i++) {
          const m = formAt(sw, i, t, P);
          if (m <= 0) continue;
          put(P, narrow ? 0.06 : 0.05, CYAN, 1.9 * m);
          const z = P.z;
          P.z = z - 0.16;
          put(P, 0.035, CYAN, 1 * m);
          P.z = z - 0.32;
          put(P, 0.03, CYAN, 0.45 * m);
        }
      }
      // the reseal squad rides the sealed edge in, gate by gate
      squadD += ((edgeK >= 0 ? edge + 0.3 : 30) - squadD) * Math.min(1, dt * 8);
      if (edgeK >= 0) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + t * 1.6;
          const s = 0.7 / hexd(Math.cos(a), Math.sin(a));
          P.x = Math.cos(a) * s;
          P.y = Math.sin(a) * s;
          P.z = camZ + squadD;
          put(P, 0.055, ICE, 3.2);
          P.z += 0.18;
          put(P, 0.035, CYAN, 1.2);
        }
      }
      // sparks
      for (let i = 0; i < SPK; i++) {
        const o = i * 8;
        const age = t - spk[o + 6]!;
        const life = spk[o + 7]!;
        if (age < 0 || age > life) continue;
        spk[o] = spk[o]! + spk[o + 3]! * dt;
        spk[o + 1] = spk[o + 1]! + spk[o + 4]! * dt;
        spk[o + 2] = spk[o + 2]! + spk[o + 5]! * dt;
        const drag = 1 - Math.min(0.5, 1.8 * dt);
        spk[o + 3] = spk[o + 3]! * drag;
        spk[o + 4] = spk[o + 4]! * drag;
        spk[o + 5] = spk[o + 5]! * drag;
        const x = spk[o]!;
        const y = spk[o + 1]!;
        const z = spk[o + 2]!;
        const u = 1 - age / life;
        pts.add(x, y, z, 0.03, SPK_COL[spkC[i]!]!, 2.4 * u * u * vis(x, y, z));
      }

      // beams: interceptions (drone to packet) and the formation's kills
      bmA.fill(0);
      bmB.fill(0);
      let bi = 0;
      for (const pk of packets) {
        if (bi >= 6 || pk.ti < 0 || t < pk.ti - 0.28) continue;
        if (pk.drone >= 0) droneAt(pk.drone, t, Q);
        else {
          Q.x = pk.sx;
          Q.y = pk.sy;
          Q.z = pk.sz;
        }
        pkAt(pk, t, P);
        bmA.set([ax(Q.z) + Q.x, ay(Q.z) + Q.y, Q.z, 1.2], bi * 4);
        bmB.set([ax(P.z) + P.x, ay(P.z) + P.y, P.z, 0], bi * 4);
        bi++;
      }
      beams = beams.filter((b) => t - b.t0 < b.dur);
      for (let i = beams.length - 1; i >= 0 && bi < 6; i--) {
        const b = beams[i]!;
        bmA.set([b.a[0], b.a[1], b.a[2], 1 - (t - b.t0) / b.dur], bi * 4);
        bmB.set([b.b[0], b.b[1], b.b[2], 0], bi * 4);
        bi++;
      }

      // gates the shader sees
      const k0 = Math.ceil(camZ / SP);
      for (let i = 0; i < NG; i++) {
        const g = gates.get(k0 + i);
        const o = i * 4;
        if (!g) {
          gateU[o] = gateU[o + 1] = gateU[o + 2] = gateU[o + 3] = 0;
          continue;
        }
        gateU[o] = closure(g, t);
        gateU[o + 1] = g.hit >= 0 ? Math.exp(-(t - g.hit) * 4) : 0;
        gateU[o + 2] = g.red >= 0 ? Math.max(0, 1 - (t - g.red) / 0.6) : 0;
        gateU[o + 3] = g.seal >= 0 ? Math.max(0, 1 - (t - g.seal) / 0.8) : 0;
      }

      setCam(set, cam);
      set.f("uCamZ", camZ);
      set.f("uK0", k0);
      set.v4v("uGate", gateU);
      set.v4v("uPk", pkU);
      set.v4v("uBmA", bmA);
      set.v4v("uBmB", bmB);
      if (sw && swarm === sw && swAlive > 0) {
        const zA = Math.max(zc - 4.5, fz + 0.6);
        const zB = Math.max(zc + 4.5, zA + 1);
        set.v4("uSwA", ax(zA), ay(zA), zA, 0.9 * smooth(0, 1.5, t - sw.t0) * Math.max(0.15, swAlive / sw.n));
        set.v4("uSwB", ax(zB), ay(zB), zB, 0.75);
      } else {
        set.v4("uSwA", 0, 0, 0, 0);
        set.v4("uSwB", 0, 0, 1, 1);
      }
      set.v4("uTake", edge, edge, breaches.length ? 1 : 0, glitch);
      set.v4("uPing", pa < 38 ? pa : -9, pb < 38 ? pb : -9, breaches.length ? 0.5 : 1, level);
      set.v2("uHit", t - hitT < 2 ? hitK : 0, Math.max(0, 1 - (t - wipeT) / 0.9));
      flashes.pack(t, set);
      set.points(pts.data, pts.n, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      const t = f.t;
      const out: { text: string; x: number; y: number; tone?: string; anchor?: "start" | "middle" | "end" }[] = [];
      const at = (z: number, ox: number, oy: number) => projectPoint([ax(z) + ox, ay(z) + oy, z], cam, f);
      const deep = at(camZ + 30, 0, 0.5);
      const taken = breaches.length > 0;
      if (deep && !taken) out.push({ text: "inbound", x: deep.x, y: deep.y - 6, tone: "dim", anchor: "middle" });
      if (lastBlock && t - lastBlock.t < 1.6 && !taken) {
        const s = at(lastBlock.k * SP, 0.62, 0.86);
        if (s) out.push({ text: `[ gate ${lastBlock.n} ]`, x: s.x + 4, y: s.y - 8, tone: "accent", anchor: "start" });
      }
      if (taken) {
        if (edgeK >= 0) {
          const s = at(edgeK * SP, 0.62, 0.86);
          const n = Math.max(1, Math.round((edgeK * SP - camZ) / SP));
          if (s) out.push({ text: `resealing · gate ${n}`, x: s.x + 4, y: s.y - 8, tone: "accent", anchor: "start" });
        } else {
          const s = at(camZ + 10, 0, 0.75);
          if (s) out.push({ text: "[ takeover ]", x: s.x, y: s.y - 6, tone: "hot", anchor: "middle" });
        }
      }
      const sw = swarm;
      if (sw && sw.over < 0) {
        const zc = Math.max(sw.zc0 - 2.4 * (t - sw.t0), camZ + DF + 3);
        let alive = 0;
        for (let j = 0; j < sw.n; j++) if (sw.dead[j]! < 0) alive++;
        const s = at(zc, 0, -0.72);
        if (s && zc - camZ < 36) out.push({ text: `[ swarm · ${alive} ]`, x: s.x, y: s.y + 6, tone: "hot", anchor: "middle" });
      }
      return out;
    },
  };
}
