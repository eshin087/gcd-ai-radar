import type { ThreatIntel } from "@/lib/threatIntel";
import { POINT_STRIDE, projectPoint, type Cam, type FrameInfo, type GlyphController, type V3 } from "../engine";
import type { FeedEvent } from "../feed";
import { WaveDirector } from "./director";
import { AMBER, CYAN, Flashes, RED, setCam, v3, WHITE, type Emit } from "./kit";

/** tan of the arms' pitch angle (24 degrees: an open grand-design spiral, so it still reads as a spiral at a tilt) */
const PITCH = Math.tan((24 * Math.PI) / 180);
/** radius where the arms leave the ends of the bar */
const REF = 0.19;
/** half-length of the bar (it lies along the galaxy's local x axis, so the arms start at its ends) */
const BAR = 0.17;
const NSYS = 14;
const NSH = 4;
const NATK = 6;
const CORE_SHIELD = 0.2;

/**
 * Where the AI systems sit: on which arm, how far out and how far across the
 * arm. Index 0 is the bulge itself (the core model cluster); the rest are the
 * targets the feed names (SYSTEM_LABEL), strung out along the two arms.
 */
const LAYOUT: { name: string; arm: number; rho: number; off: number; size: number }[] = [
  { name: "the core", arm: 0, rho: 0, off: 0, size: 1 },
  { name: "ChatGPT", arm: 0, rho: 0.36, off: 0.05, size: 1.25 },
  { name: "Copilot", arm: 1, rho: 0.41, off: -0.05, size: 1.25 },
  { name: "Claude", arm: 0, rho: 0.5, off: -0.04, size: 1.15 },
  { name: "Gemini", arm: 1, rho: 0.54, off: 0.05, size: 1.15 },
  { name: "MCP / tools", arm: 0, rho: 0.62, off: 0.06, size: 1.1 },
  { name: "Bedrock", arm: 1, rho: 0.66, off: -0.05, size: 1 },
  { name: "internal AI apps", arm: 0, rho: 0.73, off: -0.05, size: 1 },
  { name: "Meta AI", arm: 1, rho: 0.77, off: 0.05, size: 0.95 },
  { name: "self-hosted LLM", arm: 0, rho: 0.83, off: 0.04, size: 0.95 },
  { name: "Mistral", arm: 1, rho: 0.86, off: -0.04, size: 0.9 },
  { name: "employees", arm: 0, rho: 0.92, off: -0.03, size: 0.9 },
  { name: "Grok", arm: 1, rho: 0.94, off: 0.04, size: 0.85 },
  { name: "Apple AI", arm: 1, rho: 0.3, off: 0.04, size: 0.9 },
];

const FRAG = `
uniform vec3 uEye;
uniform vec3 uTarget;
uniform float uSky;
uniform vec4 uSys[${NSYS}];
uniform vec4 uSysC[${NSYS}];
uniform vec4 uSh[${NSH}];
uniform vec4 uShH[${NSH}];
uniform vec4 uAtkA[${NATK}];
uniform vec4 uAtkB[${NATK}];
uniform vec4 uFlash[6];
uniform vec4 uFlashC[6];
uniform vec4 uBr[2];
uniform vec4 uSwarm;
uniform vec4 uSwarmC;
uniform float uCoreRed;

const float TP = ${PITCH.toFixed(5)};
const float REF = ${REF.toFixed(3)};
const float BAR = ${BAR.toFixed(3)};
/** the disk's scale height and its outer edge */
const float H = .014;
const float RMAX = 1.08;
const vec3 YOUNG = vec3(.6, .75, 1.);
const vec3 OLD = vec3(1., .82, .62);
const vec3 WARM = vec3(1., .72, .4);
const vec3 PINK = vec3(1., .34, .62);
const vec3 CY = vec3(.4, .88, 1.);
const vec3 RD = vec3(1., .22, .13);

/** one star per direction cell, a pixel wide: the far background turns with the sky, not with the screen */
vec3 starCell(vec3 d, float sc, float dens, float sd, float pw){
  vec3 c = floor(d*sc);
  if(hash13(c + sd) > dens) return vec3(0.);
  vec3 sp = normalize(c + vec3(hash13(c + sd + 11.3), hash13(c + sd + 27.1), hash13(c + sd + 41.9)));
  vec3 cr = cross(d, sp);
  float f = exp(-dot(cr, cr)/(pw*pw));
  float h = hash13(c + sd + 5.1);
  float mag = .05 + .2*h + 2.4*pow(hash13(c + sd + 63.7), 14.);
  float tw = .75 + .25*sin(uTime*(.7 + 2.*h) + h*50.);
  return mix(vec3(.72, .8, 1.), vec3(1., .85, .68), hash13(c + sd + 87.3))*mag*f*tw;
}
/** faint distant galaxies: tilted ellipses a few pixels long with a brighter nucleus */
vec3 galCell(vec3 d, float sc, float sd, float pw){
  vec3 c = floor(d*sc);
  if(hash13(c + sd) > .09) return vec3(0.);
  vec3 sp = normalize(c + vec3(hash13(c + sd + 1.3), hash13(c + sd + 2.7), hash13(c + sd + 4.1)));
  vec3 off = d - sp;
  vec3 ax = normalize(cross(sp, vec3(hash13(c + sd + 5.) - .5, 1., hash13(c + sd + 6.) - .5)));
  vec3 ay = cross(sp, ax);
  vec2 q = vec2(dot(off, ax), dot(off, ay)/(.3 + .7*hash13(c + sd + 8.)));
  float sz = pw*(.8 + 1.3*hash13(c + sd + 7.));
  float r2 = dot(q, q)/(sz*sz);
  vec3 tint = mix(vec3(1., .8, .58), vec3(.7, .78, 1.), hash13(c + sd + 9.));
  return tint*(exp(-r2*5.)*.3 + exp(-r2*1.2)*.06)*(.4 + hash13(c + sd + 10.));
}
vec3 sky(vec3 d, float pw){
  return starCell(d, 70., .03, 0., pw*.7) + starCell(d, 34., .035, 7., pw*.75)*1.3 + galCell(d, 15., 3., pw) + galCell(d, 26., 9., pw)*.6;
}

/** how red a breach has turned this part of the disk: along its own arm (b.x = log radius, b.y = arm phase), or round the core (b.x < -50) */
float breachK(vec4 b, float rho, float lr, float psi){
  if(b.w <= 0.) return 0.;
  if(b.x < -50.) return b.w*exp(-rho*rho/(b.z*b.z));
  float dl = (lr - b.x)/b.z;
  float dp = mod(psi - b.y + PI, 2.*PI) - PI;
  return b.w*exp(-dl*dl - dp*dp*6.);
}

/**
 * The disk's light (integrated through its thickness) and its dust at a point
 * near the midplane. Two log-spiral arms leave the ends of the bar; they are
 * clumpy with young blue-white stars, bright clusters, pink HII knots and
 * feathery spurs on their outer edge, and a dust lane runs along each inner
 * edge. Between the arms there is almost nothing, so that space stays dark.
 */
vec3 diskAt(vec3 p, out float dust){
  float rho = length(p.xz);
  float lr = log(max(rho, .02)/REF);
  float pa = atan(p.z, p.x);
  float psi = pa + lr/TP;
  // arm phase, with a slow wobble so the arms are not perfect spirals (the JS repeats it to put systems on the crests)
  float ph = 2.*psi + .28*sin(lr*3.3 + 1.9*sin(pa));
  float c = .5 + .5*cos(ph);
  float arm = pow(smoothstep(.64, 1., c), 1.3);
  // the arm's own older stars: a faint envelope a little wider than the young crest
  float env = smoothstep(.5, 1., c)*.07;
  // spurs: short feathers leaving each arm's outer edge at a steeper pitch
  float outer = smoothstep(.8, 1., .5 + .5*cos(ph - 1.)) - arm;
  float spur = pow(.5 + .5*cos((pa + lr/1.1)*11. + lr*2.), 10.)*max(outer, 0.);
  float lane = pow(.5 + .5*cos(ph + .75), 12.);
  float rise = smoothstep(BAR*.9, BAR*1.5, rho);
  float disk = exp(-rho/.42)*smoothstep(1.04, .62, rho);
  float clump = fbm3(p*vec3(16., 40., 16.) + 2.);
  float a2 = (arm*(.18 + 1.8*smoothstep(.36, .76, clump)) + spur*.22 + env)*rise;
  vec3 em = OLD*disk*.004 + YOUNG*disk*a2;
  // the bar, warm, along local x
  em += WARM*exp(-(p.x*p.x/(BAR*BAR*.45) + p.z*p.z/(BAR*BAR*.05)))*.65;
  // HII regions (a small pink accent) and bright young clusters on the arms
  em += PINK*disk*arm*rise*smoothstep(.74, .86, noise(p*vec3(60., 80., 60.) + 5.))*2.;
  em += vec3(.8, .9, 1.)*disk*arm*rise*smoothstep(.76, .9, noise(p*vec3(70., 90., 70.) + 11.))*1.6;
  // dust: lanes on the arms' inner edges, straight lanes on the bar's leading edges, patchy filaments
  float fl = fbm3(p*vec3(34., 60., 34.) + 9.);
  float bl = exp(-pow((sign(p.x)*p.z - BAR*.2)/(BAR*.07), 2.))*smoothstep(BAR*1.25, BAR*.35, abs(p.x));
  dust = (lane*(.4 + 1.4*fl) + smoothstep(.55, .76, fl)*.25)*exp(-rho/.7)*smoothstep(BAR*.6, BAR*1.3, rho) + bl*.9;
  em *= exp(-dust*3.);
  // a breach turns its stretch of arm red, flickering
  float bk = max(breachK(uBr[0], rho, lr, psi), breachK(uBr[1], rho, lr, psi));
  if(bk > .002){
    float fk = .4 + 1.1*noise(vec3(p.xz*22., uTime*7.));
    em = mix(em, RD*1.9*dot(em, vec3(.35, .45, .2))*fk, min(bk, 1.));
  }
  return em;
}

/**
 * The disk seen along a ray: a thin layer, sampled just below, at and just
 * above the midplane (a little parallax, no march noise) and scaled by the
 * slant path through it. T returns what its dust lets through (for the bulge
 * and the sky behind), tMid where the ray crosses the midplane.
 */
vec3 galaxy(vec3 o, vec3 d, out float T, out float tMid){
  T = 1.;
  tMid = 1e9;
  if(abs(d.y) < 1e-4 || o.y*d.y >= 0.) return vec3(0.);
  tMid = -o.y/d.y;
  float sl = 1./abs(d.y);
  vec3 col = vec3(0.);
  float tau = 0.;
  for(int k = -1; k <= 1; k++){
    vec3 p = o + d*(tMid + float(k)*H*1.1*sl);
    if(dot(p.xz, p.xz) > RMAX*RMAX) continue;
    float w = k == 0 ? .5 : .25;
    float du;
    col += diskAt(p, du)*w;
    tau += du*w;
  }
  T = exp(-tau*.8*sl);
  return col*4.*sl;
}

float erfA(float x){ return tanh(1.2*x + .1*x*x*x); }
/** the light of a flattened gaussian star cloud at the centre (scale s) along the ray, split in front of / behind the disk plane */
vec2 cloud(vec3 o, vec3 d, float s, float tMid){
  vec3 q = vec3(1., 1.6, 1.);
  vec3 oo = o*q, dd = d*q;
  float dl = length(dd);
  float tc = -dot(oo, dd)/(dl*dl);
  vec3 cp = oo + dd*tc;
  float tot = 1.7725*s/dl*exp(-dot(cp, cp)/(s*s));
  float fr = tMid > 1e8 ? 1. : .5 + .5*erfA((tMid - tc)*dl/s);
  return vec2(tot*fr, tot*(1. - fr));
}
/** the bulge, the core model cluster: warm old stars round a white-hot core; the half behind the disk is dimmed by its dust */
vec3 bulge(vec3 ro, vec3 rd, float T, float tMid){
  vec2 a = cloud(ro, rd, .08, tMid);
  vec2 b = cloud(ro, rd, .03, tMid);
  vec3 wc = mix(WARM, RD, uCoreRed*.8);
  vec3 col = wc*(a.x + a.y*T)*6.5 + mix(vec3(1., .88, .66), RD*1.2, uCoreRed*.7)*(b.x + b.y*T)*34.;
  col += mix(vec3(1., .96, .9), vec3(1., .35, .25), uCoreRed)*pointGlow(ro, rd, vec3(0.), .014)*4.;
  return col;
}

/**
 * Each AI system's star: a tight glow and a faint halo (index 0, the core, is
 * the bulge itself). Each sits in a small cleared bubble in the arm, the way
 * young clusters blow out their gas, so the system and its agents read
 * against the arm's own glow; clear returns how much of the disk shows.
 */
vec3 systems(vec3 ro, vec3 rd, out float clear){
  vec3 col = vec3(0.);
  clear = 1.;
  for(int i = 1; i < ${NSYS}; i++){
    vec4 s = uSys[i];
    clear *= 1. - .85*pointGlow(ro, rd, s.xyz, s.w*3.4);
    col += uSysC[i].rgb*(pointGlow(ro, rd, s.xyz, s.w)*1.4 + pointGlow(ro, rd, s.xyz, s.w*2.2)*.2)*uSysC[i].a;
  }
  return col;
}

/** shield spheres that flare where an attack hits: a geodesic lattice lit round the impact (w < 0: a failing red shield) */
vec3 shields(vec3 ro, vec3 rd){
  vec3 col = vec3(0.);
  for(int i = 0; i < ${NSH}; i++){
    vec4 s = uSh[i];
    vec4 h = uShH[i];
    float k = abs(h.w);
    if(k < .002) continue;
    vec3 sc = h.w > 0. ? CY : RD;
    vec2 hit = sphIsect(ro, rd, s.xyz, s.w);
    if(hit.x > 0.){
      vec3 n = (ro + rd*hit.x - s.xyz)/s.w;
      vec3 q = n*7.;
      float lat = max(max(pow(abs(sin(q.x + q.y*.5)), 24.), pow(abs(sin(q.y - q.z*.6)), 24.)), pow(abs(sin(q.z + q.x*.4)), 24.));
      float spot = exp(-(1. - dot(n, h.xyz))*3.);
      // faded toward the silhouette, so the shield shows as a lit patch where it was hit, not a drawn circle
      float edge = smoothstep(0., .5, abs(dot(n, rd)));
      col += sc*(lat*spot*2.6 + spot*spot*2.2 + .25)*edge*k;
    }
  }
  return col;
}

/** the dark swarm: a red cloud like a rogue dwarf galaxy round its agents */
vec3 swarmGlow(vec3 ro, vec3 rd){
  if(uSwarmC.x <= 0.) return vec3(0.);
  vec3 oc = uSwarm.xyz - ro;
  float t = dot(oc, rd);
  vec3 pc = oc - rd*t;
  float r2 = dot(pc, pc)/(uSwarm.w*uSwarm.w);
  return vec3(1., .26, .15)*exp(-r2*14.)*.9*uSwarmC.x;
}

/** attack streaks: a thin red line to a hot head */
vec3 attacks(vec3 ro, vec3 rd, float pw){
  vec3 col = vec3(0.);
  for(int i = 0; i < ${NATK}; i++){
    vec4 a = uAtkA[i];
    if(a.w <= 0.) continue;
    float s;
    float d2 = segDist2(ro, rd, uAtkB[i].xyz, a.xyz, s);
    float w = length(a.xyz - ro)*pw*.9;
    col += vec3(1., .2, .1)*exp(-d2/(w*w))*(.25 + .75*s*s)*3.*a.w;
    col += vec3(1., .8, .64)*pointGlow(ro, rd, a.xyz, w*1.6)*3.5*a.w;
  }
  return col;
}

/** bursts: a quick hot flash with a softer bloom (no rings: circles read as clutter) */
vec3 flashes(vec3 ro, vec3 rd){
  vec3 col = vec3(0.);
  for(int i = 0; i < 6; i++){
    vec4 f = uFlash[i];
    if(f.w < 0.) continue;
    vec3 oc = f.xyz - ro;
    float t = dot(oc, rd);
    float d = length(oc - rd*t);
    float sz = uFlashC[i].a;
    col += uFlashC[i].rgb*(exp(-d*d/(sz*sz*.06))*exp(-f.w*5.)*4. + exp(-d*d/(sz*sz*.5))*exp(-f.w*4.)*.5);
  }
  return col;
}

void main(){
  vec3 ro = uEye;
  vec3 rd = camRay(lookAt(ro, uTarget));
  float pw = 2.*uTan.y/uRes.y;
  vec3 sd = rd;
  sd.xz = rot2(uSky)*sd.xz;
  float T, tMid, clear;
  vec3 sys = systems(ro, rd, clear);
  vec3 col = galaxy(ro, rd, T, tMid)*clear;
  col += sky(sd, pw)*T;
  col += bulge(ro, rd, T, tMid);
  col += sys;
  col += shields(ro, rd);
  col += swarmGlow(ro, rd);
  col += attacks(ro, rd, pw);
  col += flashes(ro, rd);
  // on wide screens the headline sits on the left: everything thins out toward it (the point sprites do the same in JS)
  if(uShift > 0.) col *= mix(.25, 1., smoothstep(-.2, .25, ndc().x));
  outCol(col);
}
`;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** the arm wobble the shader adds to the arm phase */
const wob = (lr: number, pa: number) => 0.28 * Math.sin(lr * 3.3 + 1.9 * Math.sin(pa));
/** a point on an arm's crest (local frame, disk in xz): `off` moves it across the arm in arm phase */
function armPoint(arm: number, rho: number, off: number, y: number): V3 {
  const lr = Math.log(rho / REF);
  let pa = arm * Math.PI + off - lr / PITCH;
  for (let k = 0; k < 3; k++) pa = arm * Math.PI + off - wob(lr, pa) / 2 - lr / PITCH;
  return [rho * Math.cos(pa), y, rho * Math.sin(pa)];
}
const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * Point sprites written straight into one buffer (no per-point allocations).
 * Sizes are given in scene pixels and turned into world radii by depth: the
 * engine squashes sprites 1.8x vertically, so anything under ~2.5 px can miss
 * every pixel centre and blink; this keeps every star and agent steady.
 */
class Pts {
  data: Float32Array;
  n = 0;
  private max: number;
  private e: V3 = [0, 0, 0];
  private F: V3 = [0, 0, 1];
  private R: V3 = [1, 0, 0];
  private k = 0.001;
  private tanX = 1;
  private shift = 0;
  constructor(max: number) {
    this.max = max;
    this.data = new Float32Array(max * POINT_STRIDE);
  }
  /** the camera and frame these sprites are seen through */
  view(cam: Cam, f: FrameInfo) {
    this.e = cam.eye;
    this.F = v3.norm(v3.sub(cam.target, cam.eye));
    this.R = v3.norm([-this.F[2], 0, this.F[0]]);
    this.tanX = f.tan[0];
    this.shift = f.shift;
    // the scene is rendered at two pixels per 6 px glyph cell
    this.k = f.tan[0] / Math.max(1, f.width / 3);
    this.n = 0;
  }
  put(x: number, y: number, z: number, px: number, cr: number, cg: number, cb: number, k: number) {
    if (this.n >= this.max || k <= 0.002) return;
    const depth = (x - this.e[0]) * this.F[0] + (y - this.e[1]) * this.F[1] + (z - this.e[2]) * this.F[2];
    if (depth <= 0.05) return;
    if (this.shift > 0) {
      // thin out toward the headline on the left, as the scene shader does
      const nx = ((x - this.e[0]) * this.R[0] + (z - this.e[2]) * this.R[2]) / (depth * this.tanX) + this.shift;
      const u = Math.min(1, Math.max(0, (nx + 0.2) / 0.45));
      k *= 0.25 + 0.75 * u * u * (3 - 2 * u);
    }
    const o = this.n * POINT_STRIDE;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = px * depth * this.k;
    d[o + 4] = cr;
    d[o + 5] = cg;
    d[o + 6] = cb;
    d[o + 7] = k;
    this.n += 1;
  }
  p(p: V3, px: number, c: V3, k: number) {
    this.put(p[0], p[1], p[2], px, c[0], c[1], c[2], k);
  }
}

const PATROL = 0;
const INTERCEPT = 1;
const FORM = 2;
const REPAIR = 3;

interface Sys {
  name: string;
  p: V3;
  lr: number;
  psi: number;
  size: number;
  shield: number;
  /** orbit plane of its agents */
  ou: V3;
  ow: V3;
  spin: number;
}
interface Def {
  p: V3;
  v: V3;
  role: number;
  job: number;
  arm: number;
  ph: number;
  w: number;
  lrMid: number;
  lrAmp: number;
  cross: number;
  h: number;
  cool: number;
}
interface Attack {
  id: number;
  ev: FeedEvent;
  sys: number;
  s: V3;
  c: V3;
  e: V3;
  t0: number;
  dur: number;
  /** where along the path the interceptors catch it (intercepted only) */
  catchU: number;
  squad: number[];
  drafted: boolean;
  tag: boolean;
  done: boolean;
}
interface Shield {
  sys: number;
  dir: V3;
  tHit: number;
  red: boolean;
}
interface Breach {
  sys: number;
  ev: FeedEvent;
  t0: number;
  squad: number[];
  healed: boolean;
  word: string;
}
interface Enemy {
  off: V3;
  p: V3;
  v: V3;
  alive: boolean;
  leak: boolean;
}
interface Swarm {
  ev: FeedEvent;
  sys: number;
  s0: V3;
  meet: V3;
  ring: V3;
  axA: V3;
  axB: V3;
  t0: number;
  centre: V3;
  en: Enemy[];
  clashAt: number;
  leakAt: number;
  breached: boolean;
  members: number[];
  size: number;
  /** from the meeting point back up its path */
  back: V3;
}
interface Spark {
  p: V3;
  v: V3;
  t0: number;
  life: number;
  c: V3;
}
interface Tracer {
  d: number;
  e: number;
  t0: number;
}

const bez = (a: V3, c: V3, b: V3, u: number): V3 => {
  const w = 1 - u;
  return [w * w * a[0] + 2 * w * u * c[0] + u * u * b[0], w * w * a[1] + 2 * w * u * c[1] + u * u * b[1], w * w * a[2] + 2 * w * u * c[2] + u * u * b[2]];
};
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** move v toward a speed-limited pull to the goal (smooth, never snapping) */
function seek(p: V3, v: V3, goal: V3, gain: number, vmax: number, rate: number, dt: number): V3 {
  let w = v3.mul(v3.sub(goal, p), gain);
  const l = v3.len(w);
  if (l > vmax) w = v3.mul(w, vmax / l);
  return v3.add(v, v3.mul(v3.sub(w, v), Math.min(1, rate * dt)));
}

/**
 * Glyph galaxy: the company's AI estate as a barred spiral galaxy at a 3/4
 * tilt, turning slowly. The bulge is the core model cluster; the AI systems
 * are bright star systems strung along the arms, each with orbiting agents;
 * amber data streams flow along the arms to the core, and cyan defender
 * comets patrol them. Attacks from the 90-day feed dive in from
 * intergalactic space as red streaks: a shield sphere flares (blocked),
 * defenders leave the arm and catch them (intercepted), or at the real harm
 * rate one lands: the system and its stretch of arm turn red and flicker
 * until defenders converge and heal it. In the war phase a dark swarm, a red
 * cloud like a rogue dwarf galaxy, falls toward the disk and the defenders
 * sweep out into a ring to meet it.
 */
export function glyphGalaxy({ intel, emit }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const director = new WaveDirector(intel, 131);
  const rnd = director.rnd;
  const flashes = new Flashes();
  const pts = new Pts(4300);

  // --- the AI systems, fixed in the galaxy's frame (the camera turns, not the galaxy)
  const srnd = mulberry32(4242);
  const gauss = () => {
    let u = 0;
    while (!u) u = srnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831853 * srnd());
  };
  const randDir = (): V3 => {
    const z = srnd() * 2 - 1;
    const a = srnd() * 6.2831853;
    const r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), z, r * Math.sin(a)];
  };
  const systems: Sys[] = LAYOUT.map((L, i) => {
    const p: V3 = i === 0 ? [0, 0, 0] : armPoint(L.arm, L.rho, L.off, 0.012);
    const rho = Math.hypot(p[0], p[2]);
    const lr = i === 0 ? -99 : Math.log(rho / REF);
    const psi = i === 0 ? 0 : Math.atan2(p[2], p[0]) + lr / PITCH;
    const n = v3.norm([gauss() * 0.5, 1, gauss() * 0.5]);
    const ou = v3.norm(cross3(n, [0.3, 0.1, 1]));
    return { name: L.name, p, lr, psi, size: L.size, shield: i === 0 ? CORE_SHIELD : 0.075 * L.size, ou, ow: cross3(n, ou), spin: (srnd() < 0.5 ? -1 : 1) * (1.1 + srnd() * 0.9) };
  });
  const sysIndex = new Map(systems.map((s, i) => [s.name, i]));

  // --- stars: x y z radius r g b intensity, then log radius, arm phase and a twinkle phase
  const SS = 11;
  let stars = new Float32Array(0);
  let nStars = 0;
  const makeStars = (n: number) => {
    const out = new Float32Array(n * SS);
    let k = 0;
    const put = (p: V3, c: V3, inten: number) => {
      const o = k * SS;
      const rho = Math.hypot(p[0], p[2]);
      const lr = Math.log(Math.max(rho, 0.02) / REF);
      out.set([p[0], p[1], p[2], inten > 1.2 ? 3.1 : 2.6, c[0], c[1], c[2], inten, lr, Math.atan2(p[2], p[0]) + lr / PITCH, srnd() * 6.283], o);
      k += 1;
    };
    // young clusters strung along the arms
    const nCl = Math.round(n * 0.013);
    for (let c = 0; c < nCl && k < n; c++) {
      const ctr = armPoint(c % 2, 0.24 + 0.7 * Math.pow(srnd(), 0.8), gauss() * 0.1, 0);
      const m = 6 + Math.floor(srnd() * 6);
      for (let j = 0; j < m && k < n; j++) put([ctr[0] + gauss() * 0.008, gauss() * 0.003, ctr[2] + gauss() * 0.008], j % 5 === 4 ? [1, 0.5, 0.75] : [0.72, 0.86, 1], 0.6 + 0.6 * srnd());
    }
    let guard = 0;
    while (k < n && guard++ < n * 30) {
      const u = srnd();
      const q = srnd();
      if (u < 0.6) {
        // young stars on the arms, blue-white
        const rho = 0.19 + 0.8 * Math.pow(srnd(), 0.85);
        if (srnd() > Math.exp(-(rho - 0.19) / 0.42)) continue;
        const p = armPoint(srnd() < 0.5 ? 0 : 1, rho, gauss() * 0.065, gauss() * 0.005);
        const bright = srnd() < 0.05;
        // the outer arms thin out, so the near side of the disk does not turn into a carpet of dots
        const fade = smooth(0.98, 0.7, rho);
        put(p, srnd() < 0.035 ? [1, 0.45, 0.7] : [0.58 + 0.25 * q, 0.72 + 0.18 * q, 1], (bright ? 1.4 + srnd() * 1.2 : 0.35 + srnd() * 0.5) * fade);
      } else if (u < 0.7) {
        // the old disk between the arms: warm and faint
        const rho = 0.1 - 0.3 * Math.log(1 - srnd() * 0.95);
        if (rho > 1.04) continue;
        const pa = srnd() * 6.2831853;
        put([rho * Math.cos(pa), gauss() * 0.012, rho * Math.sin(pa)], [1, 0.8 + 0.1 * q, 0.6 + 0.15 * q], 0.08 + 0.16 * srnd());
      } else if (u < 0.75) {
        // the bar
        put([gauss() * BAR * 0.32, gauss() * 0.01, gauss() * BAR * 0.09], [1, 0.76 + 0.1 * q, 0.5 + 0.15 * q], 0.3 + 0.3 * srnd());
      } else {
        // the bulge: old gold-white stars
        const d = randDir();
        const r = -0.035 * Math.log(1 - srnd() * 0.97);
        put([d[0] * r, d[1] * r * 0.62, d[2] * r], [1, 0.78 + 0.14 * q, 0.52 + 0.2 * q], 0.3 + 0.45 * srnd());
      }
    }
    nStars = k;
    return out;
  };

  // --- data lanes: inbound traffic along each arm's dark inner lane, outbound along its outer edge, and down the bar into the core
  const LANES = [
    { arm: 0, off: -0.4, dir: -1 },
    { arm: 0, off: 0.38, dir: 1 },
    { arm: 1, off: -0.4, dir: -1 },
    { arm: 1, off: 0.38, dir: 1 },
  ];
  const LR0 = Math.log(0.22 / REF);
  const LR1 = Math.log(0.98 / REF);

  let N = 0;
  let narrow = false;
  let defs: Def[] = [];
  let attacks: Attack[] = [];
  let shieldEv: Shield[] = [];
  let breaches: Breach[] = [];
  let swarm: Swarm | null = null;
  let sparks: Spark[] = [];
  let tracers: Tracer[] = [];
  let ids = 0;
  let tagNext = true;
  let cam: Cam = { eye: [0, 1, 2.4], target: [0, 0, 0] };
  let focus: V3 = [0, 0, 0];
  let zoom = 1;
  const U = {
    sys: new Float32Array(NSYS * 4),
    sysC: new Float32Array(NSYS * 4),
    sh: new Float32Array(NSH * 4),
    shH: new Float32Array(NSH * 4),
    atkA: new Float32Array(NATK * 4),
    atkB: new Float32Array(NATK * 4),
    br: new Float32Array(8),
  };

  const patrolAt = (d: Def, t: number): V3 => {
    const th = d.ph + d.w * t;
    const lr = d.lrMid + d.lrAmp * Math.sin(th);
    return armPoint(d.arm, REF * Math.exp(lr), d.cross * Math.cos(th), d.h + 0.012 * Math.sin(th * 2 + d.ph));
  };
  const spark = (p: V3, t: number, n: number, cols: V3[], speed = 1) => {
    for (let k = 0; k < n; k++) {
      const d = v3.norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
      sparks.push({ p, v: v3.mul(d, (0.15 + rnd() * 0.45) * speed), t0: t, life: 0.45 + rnd() * 0.55, c: cols[k % cols.length]! });
    }
    if (sparks.length > 420) sparks = sparks.slice(-420);
  };
  /** the k nearest free defenders (patrolling, or in the roles given) to a point leave for a job */
  const draft = (p: V3, k: number, role: number, job: number, from: number[] = [PATROL]) => {
    const free = defs.map((d, i) => ({ i, d: from.includes(d.role) ? v3.len(v3.sub(d.p, p)) : Infinity })).filter((x) => x.d < Infinity);
    free.sort((a, b) => a.d - b.d);
    const out = free.slice(0, k).map((x) => x.i);
    for (const i of out) {
      defs[i]!.role = role;
      defs[i]!.job = job;
    }
    return out;
  };
  /** back to patrol, unless another job has taken them since */
  const release = (ids2: number[], role: number, job: number) => {
    for (const i of ids2) {
      const d = defs[i];
      if (d && d.role === role && d.job === job) {
        d.role = PATROL;
        d.job = -1;
      }
    }
  };
  const camBasis = (c: Cam) => {
    const F = v3.norm(v3.sub(c.target, c.eye));
    const R = v3.norm([-F[2], 0, F[0]]);
    return { F, R, U: cross3(R, F) };
  };
  const addShield = (sys: number, dir: V3, tHit: number, red: boolean) => {
    shieldEv.push({ sys, dir, tHit, red });
    if (shieldEv.length > NSH) shieldEv.shift();
  };

  const startBreach = (t: number, sys: number, ev: FeedEvent, word: string) => {
    const s = systems[sys]!;
    flashes.add(s.p, t, [1, 0.3, 0.15], s.shield * 1.6);
    spark(s.p, t, 26, [RED, AMBER, WHITE], 1.3);
    const same = breaches.find((b) => b.sys === sys);
    if (same) {
      // struck again while still red: the cleanup starts over
      same.t0 = t - 0.4;
      return;
    }
    if (breaches.length >= 2) {
      const old = breaches.shift()!;
      release(old.squad, REPAIR, old.sys);
      emit?.(old.ev, true, old.word);
    }
    breaches.push({ sys, ev, t0: t, squad: [], healed: false, word });
  };

  return {
    frag: FRAG,
    fovY: 36,
    shift: 0.4,
    frame(f: FrameInfo, set) {
      const t = f.t;
      const dt = Math.min(0.05, f.dt);
      if (!N) {
        narrow = f.narrow;
        N = narrow ? 13 : 24;
        stars = makeStars(narrow ? 1300 : 2400);
        defs = Array.from({ length: N }, (_, i) => {
          const d: Def = { p: [0, 0, 0], v: [0, 0, 0], role: PATROL, job: -1, arm: i % 2, ph: srnd() * 6.283, w: (srnd() < 0.5 ? -1 : 1) * (0.22 + srnd() * 0.12), lrMid: 0.65 + srnd() * 0.45, lrAmp: 0.25 + srnd() * 0.22, cross: 0.16 + srnd() * 0.14, h: 0.06 + srnd() * 0.05, cool: 0 };
          d.p = patrolAt(d, t);
          return d;
        });
      }

      // --- the director's waves
      const wave = director.tick(t);
      const { R } = camBasis(cam);
      for (const ev of wave.attacks) {
        if (attacks.length > 8) break;
        const sys = sysIndex.get(ev.target) ?? 0;
        const sp = systems[sys]!.p;
        // from intergalactic space: mostly from above the disk, sometimes from beside it, always from the screen's right (the headline is on the left)
        const above = rnd() < 0.68;
        const side = 0.15 + rnd() * 1.1;
        const s: V3 = above ? v3.add(sp, v3.add([0, 0.9 + rnd() * 0.5, 0], v3.mul(R, side))) : v3.add(sp, v3.add([0, 0.1 + rnd() * 0.3, 0], v3.mul(R, 1.1 + rnd() * 0.5)));
        const dir = v3.norm(v3.sub(s, sp));
        const e = v3.add(sp, v3.mul(dir, systems[sys]!.shield * (ev.fate === "breach" ? 0.3 : 1)));
        const c = v3.add(v3.mix(s, e, 0.5), v3.add([0, 0.12, 0], v3.mul(R, (rnd() - 0.5) * 0.5)));
        const war = director.phase(t) === "war";
        const a: Attack = { id: ++ids, ev, sys, s, c, e, t0: t, dur: (war ? 1.9 : 2.5) + rnd() * 0.9, catchU: 0.62 + rnd() * 0.18, squad: [], drafted: false, tag: tagNext, done: false };
        tagNext = !tagNext;
        if (ev.fate === "blocked") addShield(sys, dir, t + a.dur, false);
        attacks.push(a);
        emit?.(ev, false);
      }
      if (wave.swarm && !swarm) {
        const ev = wave.swarm.ev;
        const sys = sysIndex.get(ev.target) ?? 0;
        const sp = systems[sys]!.p;
        // the defenders meet it at a point picked on screen (upper right, above the disk), so the whole fight is in frame;
        // it falls in from further out along the same line
        const { F, U: Ub } = camBasis(cam);
        const nx = (narrow ? 0.15 : 0.45) + rnd() * 0.3;
        const ny = (narrow ? -0.05 : 0.05) + rnd() * 0.25;
        const zs = Math.max(0.8, v3.dot(v3.sub(sp, cam.eye), F) * 0.92);
        const meet = v3.add(cam.eye, v3.mul(v3.add(F, v3.add(v3.mul(R, (nx - f.shift) * f.tan[0]), v3.mul(Ub, ny * f.tan[1]))), zs));
        meet[1] = Math.max(meet[1], 0.2);
        const s0 = v3.add(meet, v3.mul(v3.norm(v3.add(v3.sub(meet, sp), [0, 0.5, 0])), 1.1));
        // the ring faces the swarm's path, turned partly toward the camera so it reads as a ring, not a line
        const axis = v3.norm(v3.add(v3.norm(v3.sub(sp, meet)), v3.mul(F, 0.9)));
        const axA = v3.norm(cross3(axis, [0, 1, 0.001]));
        const axB = cross3(axis, axA);
        const size = Math.min(wave.swarm.size, narrow ? 50 : 110);
        const tilt = v3.norm([gauss() * 0.4, 1, gauss() * 0.4]);
        const ta = v3.norm(cross3(tilt, [1, 0, 0.2]));
        const tb = cross3(tilt, ta);
        const back = v3.norm(v3.sub(s0, meet));
        const en: Enemy[] = [];
        for (let k = 0; k < size; k++) {
          // like a rogue dwarf galaxy: a dense core, a looser envelope and a tidal tail streaming behind it
          const u = k / size;
          const sg = u < 0.4 ? 0.026 : 0.055;
          let off = v3.add(v3.add(v3.mul(ta, gauss() * sg), v3.mul(tb, gauss() * sg)), v3.mul(tilt, gauss() * sg * 0.75));
          if (u > 0.86) off = v3.add(v3.mul(back, 0.07 + srnd() * 0.2), v3.mul(off, 0.4));
          en.push({ off, p: v3.add(s0, off), v: [0, 0, 0], alive: true, leak: false });
        }
        swarm = { ev, sys, s0, meet, ring: v3.mix(meet, sp, 0.16), axA, axB, t0: t, centre: s0, en, clashAt: Infinity, leakAt: Infinity, breached: false, members: [], size, back };
        // the war comes first: repair crews are pulled into the line too
        swarm.members = draft(swarm.ring, narrow ? 10 : 16, FORM, 0, [PATROL, REPAIR]);
        emit?.(ev, false);
      }

      // --- attacks in flight
      for (const a of attacks) {
        const u = Math.min(1, (t - a.t0) / a.dur);
        if (a.ev.fate === "intercepted" && !a.drafted && u > 0.2) {
          a.drafted = true;
          a.squad = draft(bez(a.s, a.c, a.e, a.catchU), narrow ? 2 : 3, INTERCEPT, a.id);
        }
        if (a.ev.fate === "intercepted" && u >= a.catchU) {
          const p = bez(a.s, a.c, a.e, a.catchU);
          spark(p, t, 18, [RED, AMBER, WHITE, CYAN]);
          flashes.add(p, t, [0.6, 0.92, 1], 0.1);
          emit?.(a.ev, true, "INTERCEPTED");
          release(a.squad, INTERCEPT, a.id);
          a.done = true;
          continue;
        }
        if (u < 1) continue;
        a.done = true;
        release(a.squad, INTERCEPT, a.id);
        if (a.ev.fate === "breach") {
          addShield(a.sys, v3.norm(v3.sub(a.s, systems[a.sys]!.p)), t, true);
          startBreach(t, a.sys, a.ev, "BREACH · HEALED");
        } else {
          flashes.add(a.e, t, [0.5, 0.88, 1], 0.1);
          spark(a.e, t, 12, [RED, CYAN, WHITE], 0.8);
          emit?.(a.ev, true, "BLOCKED · SHIELD");
        }
      }
      attacks = attacks.filter((a) => !a.done);
      shieldEv = shieldEv.filter((s) => t < s.tHit + 1.6);

      // --- breaches: red spreads along the arm, defenders converge, it heals
      for (const b of breaches) {
        const tau = t - b.t0;
        if (tau > 0.9 && !b.squad.length && !b.healed) b.squad = draft(systems[b.sys]!.p, narrow ? 3 : 5, REPAIR, b.sys);
        if (tau > 4.2 && !b.healed) {
          b.healed = true;
          const p = systems[b.sys]!.p;
          flashes.add(p, t, [0.55, 0.95, 1], systems[b.sys]!.shield * 1.8);
          spark(p, t, 16, [CYAN, WHITE], 0.9);
        }
        if (tau > 6.8) {
          release(b.squad, REPAIR, b.sys);
          emit?.(b.ev, true, b.word);
        }
      }
      breaches = breaches.filter((b) => t - b.t0 <= 6.8);

      // --- the dark swarm: falls in, meets the defenders' ring, is broken up (or a few break through)
      if (swarm) {
        const sw = swarm;
        const tau = t - sw.t0;
        const APP = 6;
        const sp = systems[sw.sys]!.p;
        if (tau < APP) {
          const u = tau / APP;
          sw.centre = v3.mix(sw.s0, sw.meet, u * u * (3 - 2 * u));
        } else {
          if (sw.clashAt === Infinity) {
            sw.clashAt = t;
            if (sw.ev.fate === "breach") sw.leakAt = t + 3.2;
          }
          sw.centre = v3.add(sw.centre, v3.mul(v3.sub(sw.ring, sw.centre), Math.min(1, 0.12 * dt)));
        }
        const clash = t >= sw.clashAt;
        const rot = tau * 0.5;
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        if (t >= sw.leakAt) {
          sw.leakAt = Infinity;
          let k = narrow ? 3 : 5;
          for (const en of sw.en) if (en.alive && k > 0) {
            en.leak = true;
            k--;
          }
        }
        sw.en.forEach((en, k) => {
          if (!en.alive) return;
          let goal: V3;
          if (en.leak) {
            goal = sp;
            en.v = seek(en.p, en.v, goal, 3, 0.75, 4, dt);
          } else {
            // the cloud turns slowly about its path (so the tidal tail stays behind); in the clash it swells and its agents jink
            const o = en.off;
            const b = sw.back;
            const sc = clash ? 1.6 : 1;
            const bo = cross3(b, o);
            const bd = v3.dot(b, o) * (1 - cr);
            const ro: V3 = [o[0] * cr + bo[0] * sr + b[0] * bd, o[1] * cr + bo[1] * sr + b[1] * bd, o[2] * cr + bo[2] * sr + b[2] * bd];
            goal = v3.add(sw.centre, v3.mul(ro, sc));
            if (clash) goal = v3.add(goal, [Math.sin(t * 3.1 + k) * 0.03, Math.cos(t * 2.3 + k * 1.7) * 0.03, Math.sin(t * 2.7 + k * 0.7) * 0.03]);
            en.v = seek(en.p, en.v, goal, 5, 1.2, 6, dt);
          }
          en.p = v3.add(en.p, v3.mul(en.v, dt));
          if (en.leak && v3.len(v3.sub(en.p, sp)) < systems[sw.sys]!.shield) {
            en.alive = false;
            if (!sw.breached) {
              sw.breached = true;
              addShield(sw.sys, v3.norm(v3.sub(sw.s0, sp)), t, true);
              startBreach(t, sw.sys, sw.ev, `SWARM ×${sw.size} · BREACH · HEALED`);
            } else spark(en.p, t, 6, [RED, AMBER]);
          }
        });
        // a clash that drags on: the rest of the cloud scatters and burns out
        if (clash && t - sw.clashAt > 9) {
          for (const en of sw.en) if (en.alive && !en.leak && rnd() < dt * 5) {
            en.alive = false;
            spark(en.p, t, 4, [RED, AMBER]);
          }
        }
        if (!sw.en.some((e) => e.alive)) {
          if (!sw.breached) emit?.(sw.ev, true, `SWARM ×${sw.size} REPELLED`);
          release(sw.members, FORM, 0);
          swarm = null;
        }
      }

      // --- defenders
      const sw = swarm;
      const m = sw ? sw.members.length : 0;
      defs.forEach((d, i) => {
        if (d.role === INTERCEPT) {
          const a = attacks.find((x) => x.id === d.job);
          if (!a) {
            d.role = PATROL;
          } else {
            // fly to the catch point so as to arrive with the attack
            const goal = bez(a.s, a.c, a.e, a.catchU);
            const rem = Math.max(0.12, a.t0 + a.catchU * a.dur - t);
            let want = v3.mul(v3.sub(goal, d.p), 1 / rem);
            const l = v3.len(want);
            if (l > 2.4) want = v3.mul(want, 2.4 / l);
            d.v = v3.add(d.v, v3.mul(v3.sub(want, d.v), Math.min(1, 6 * dt)));
          }
        } else if (d.role === FORM && sw) {
          const j = sw.members.indexOf(i);
          const ang = (j / Math.max(1, m)) * 6.2831853 + t * 0.35;
          const rr = narrow ? 0.17 : 0.22;
          let goal = v3.add(sw.ring, v3.add(v3.mul(sw.axA, Math.cos(ang) * rr), v3.mul(sw.axB, Math.sin(ang) * rr)));
          if (t >= sw.clashAt) {
            // in the clash each one lunges at the nearest enemy and fires
            let best: Enemy | null = null;
            let bd = 0.4;
            let bi = -1;
            sw.en.forEach((en, k) => {
              if (!en.alive || en.leak) return;
              const dd = v3.len(v3.sub(en.p, d.p));
              if (dd < bd) {
                bd = dd;
                best = en;
                bi = k;
              }
            });
            const tgt = best as Enemy | null;
            if (tgt) {
              goal = v3.mix(goal, tgt.p, 0.22);
              if (t > d.cool) {
                d.cool = t + 0.7 + rnd() * 0.5;
                tracers.push({ d: i, e: bi, t0: t });
                if (rnd() < 0.5) {
                  tgt.alive = false;
                  spark(tgt.p, t, 9, [RED, AMBER, WHITE], 1.1);
                  if (rnd() < 0.3) flashes.add(tgt.p, t, [1, 0.6, 0.35], 0.08);
                }
              }
            }
          }
          d.v = seek(d.p, d.v, goal, 2.4, 0.9, 4, dt);
        } else if (d.role === REPAIR && breaches.some((b) => b.sys === d.job)) {
          const s = systems[d.job]!;
          const ang = t * 2.4 + i * 1.7;
          const rr = s.shield * 1.2;
          const goal = v3.add(s.p, v3.add(v3.mul(s.ou, Math.cos(ang) * rr), v3.mul(s.ow, Math.sin(ang) * rr)));
          d.v = seek(d.p, d.v, goal, 6, 1.2, 6, dt);
        } else {
          if (d.role !== PATROL) {
            d.role = PATROL;
            d.job = -1;
          }
          d.v = seek(d.p, d.v, patrolAt(d, t), 3, 0.7, 4, dt);
        }
        d.p = v3.add(d.p, v3.mul(d.v, dt));
      });
      tracers = tracers.filter((x) => t - x.t0 < 0.18);
      const drag = Math.exp(-dt * 2.2);
      for (const s of sparks) {
        s.v = v3.mul(s.v, drag);
        s.p = v3.add(s.p, v3.mul(s.v, dt));
      }
      sparks = sparks.filter((s) => t - s.t0 < s.life);

      // --- camera: a slow orbit and tilt; it leans toward a breach and pulls back a little for the war, then eases back
      let want: V3 = [0, 0, 0];
      let wz = 1;
      if (sw) {
        wz = 1.02;
      } else if (breaches.length) {
        // lean toward the struck system, but never slide the galaxy left over the headline:
        // only the part of the move that goes left, nearer or further is kept
        const p = systems[breaches[breaches.length - 1]!.sys]!.p;
        const { R: Rc, F: Fc } = camBasis(cam);
        const Fh = v3.norm([Fc[0], 0, Fc[2]]);
        want = v3.add(v3.mul(Rc, Math.min(0, v3.dot(p, Rc)) * 0.45), v3.mul(Fh, v3.dot(p, Fh) * 0.35));
        wz = 0.93;
      }
      const ke = 1 - Math.exp(-dt / 2.6);
      focus = v3.add(focus, v3.mul(v3.sub(want, focus), ke));
      zoom += (wz - zoom) * ke;
      const az = 0.9 - 0.03 * t + 0.12 * Math.sin(t * 0.021);
      const el = 0.58 + 0.06 * Math.sin(t * 0.037 + 0.8);
      const dist = (narrow ? 2.05 : 2.4) * zoom;
      // aim a little below the centre so the near side of the disk is not cut off
      const aim = v3.add(focus, [0, -0.07, 0]);
      cam = { eye: v3.add(aim, [Math.cos(el) * Math.cos(az) * dist, Math.sin(el) * dist, Math.cos(el) * Math.sin(az) * dist]), target: aim };

      // --- draw: stars first
      pts.view(cam, f);
      const brs = breaches.map((b) => {
        const tau = t - b.t0;
        const amt = smooth(0, 0.4, tau) * (1 - smooth(4.2, 6.6, tau));
        // how far the red has run along the arm (world units, as log radius for the shader); round the core it is a radius
        const run = (0.04 + 0.13 * smooth(0, 2.6, tau)) * (1 - 0.6 * smooth(4.2, 6.6, tau));
        const spread = b.sys === 0 ? run * 1.4 : run / Math.hypot(systems[b.sys]!.p[0], systems[b.sys]!.p[2]);
        return { s: systems[b.sys]!, amt, spread, core: b.sys === 0 };
      });
      for (let i = 0; i < nStars; i++) {
        const o = i * SS;
        let k = stars[o + 7]!;
        let cr = stars[o + 4]!;
        let cg = stars[o + 5]!;
        let cb = stars[o + 6]!;
        if (k > 1.2) k *= 0.7 + 0.3 * Math.sin(t * 1.9 + stars[o + 10]!);
        for (const b of brs) {
          if (b.amt <= 0) continue;
          let red: number;
          if (b.core) {
            const rho = Math.hypot(stars[o]!, stars[o + 2]!);
            red = Math.exp(-(rho * rho) / (b.spread * b.spread));
          } else {
            const dl = (stars[o + 8]! - b.s.lr) / b.spread;
            let dp = (stars[o + 9]! - b.s.psi) % 6.2831853;
            if (dp > Math.PI) dp -= 6.2831853;
            if (dp < -Math.PI) dp += 6.2831853;
            red = Math.exp(-dl * dl - dp * dp * 6);
          }
          red *= b.amt;
          if (red > 0.02) {
            const fl = 0.5 + 0.5 * Math.sin(t * 23 + stars[o + 10]! * 7);
            cr += (1 - cr) * red;
            cg += (0.2 - cg) * red;
            cb += (0.12 - cb) * red;
            k *= 1 + red * (fl - 0.3);
          }
        }
        pts.put(stars[o]!, stars[o + 1]!, stars[o + 2]!, stars[o + 3]!, cr, cg, cb, k);
      }

      // --- systems: a crisp star and its orbiting agents; red while breached
      U.sysC.fill(0);
      systems.forEach((s, i) => {
        const b = brs.find((x) => x.s === s);
        const red = b ? b.amt : 0;
        const fl = 0.75 + 0.25 * Math.sin(t * 15 + i);
        const col: V3 = v3.mix([0.3, 0.85, 1], [1, 0.22, 0.13], red);
        U.sys.set([s.p[0], s.p[1], s.p[2], 0.021 * s.size], i * 4);
        U.sysC.set([col[0], col[1], col[2], (1.3 + 0.2 * Math.sin(t * 0.8 + i)) * (red ? fl * 1.4 : 1)], i * 4);
        if (i === 0) {
          // the core model cluster: two tilted rings of agents round the bulge
          const nA = narrow ? 10 : 18;
          for (let k = 0; k < nA; k++) {
            const ring = k % 2;
            const ang = (k / nA) * 6.2831853 + t * (ring ? -0.22 : 0.3);
            const rr = ring ? 0.25 : 0.2;
            const tl = ring ? 0.32 : -0.22;
            const p: V3 = [Math.cos(ang) * rr, Math.sin(ang) * rr * Math.sin(tl) + 0.01, Math.sin(ang) * rr * Math.cos(tl)];
            const ac = v3.mix(CYAN, [1, 0.25, 0.15], red);
            pts.p(p, 2.8, ac, 1.3);
          }
          return;
        }
        pts.p(s.p, 4.2, v3.mix([0.85, 0.97, 1], [1, 0.45, 0.35], red), 5 * s.size);
        const nA = narrow ? 3 : 5;
        for (let k = 0; k < nA; k++) {
          const ang = (k / nA) * 6.2831853 + t * s.spin;
          const rr = 0.045 * s.size * (k % 2 ? 1.35 : 1);
          const p = v3.add(s.p, v3.add(v3.mul(s.ou, Math.cos(ang) * rr), v3.mul(s.ow, Math.sin(ang) * rr)));
          pts.p(p, 2.8, v3.mix(CYAN, RED, red), 1.7);
        }
      });

      // --- data streams: amber packets along the arms (in toward the core, out to the systems) and down the bar
      const nPk = narrow ? 7 : 12;
      for (const L of LANES) {
        for (let k = 0; k < nPk; k++) {
          const span = LR1 - LR0;
          const ph = (k / nPk + (L.dir * t * 0.045) / span + L.arm * 0.37) % 1;
          const u = ph < 0 ? ph + 1 : ph;
          const lr = LR0 + u * span;
          const fade = smooth(0, 0.08, u) * smooth(1, 0.9, u);
          for (let j = 0; j < 5; j++) {
            const p = armPoint(L.arm, REF * Math.exp(lr - L.dir * j * 0.011), L.off, 0.007);
            pts.p(p, 2.8, AMBER, (3.2 - j * 0.5) * fade);
          }
        }
      }
      for (let k = 0; k < 6; k++) {
        const u = (k / 6 + t * 0.12) % 1;
        const sgn = k % 2 ? 1 : -1;
        for (let j = 0; j < 3; j++) pts.put(sgn * BAR * 1.1 * (1 - u + j * 0.02), 0.012, 0, 2.8, AMBER[0], AMBER[1], AMBER[2], (2.4 - j * 0.6) * smooth(1, 0.7, u));
      }

      // --- defenders: cyan comets with short tails
      for (const d of defs) {
        const sp = v3.len(d.v);
        const back = sp > 1e-4 ? v3.mul(d.v, -1 / sp) : ([0, 0, 0] as V3);
        const step = 0.009 + 0.025 * Math.min(sp, 1.5);
        const hot = d.role === PATROL ? 0 : 1.2;
        pts.p(d.p, 3.6, [0.75, 0.97, 1], 3.6 + hot);
        for (let j = 1; j <= 6; j++) pts.p(v3.add(d.p, v3.mul(back, step * j)), 3, CYAN, (2 + hot * 0.4) * (1 - j / 7.5));
      }

      // --- attacks: red streaks along their curve
      U.atkA.fill(0);
      U.atkB.fill(0);
      let ai = 0;
      for (const a of attacks) {
        const u = Math.min(1, (t - a.t0) / a.dur);
        const fadeIn = Math.min(1, (t - a.t0) / 0.3);
        const head = bez(a.s, a.c, a.e, u);
        pts.p(head, 4, [1, 0.55, 0.4], 3 * fadeIn);
        for (let j = 1; j <= 22; j++) {
          const uu = u - j * 0.012;
          if (uu < 0) break;
          pts.p(bez(a.s, a.c, a.e, uu), 2.8, RED, (2.1 - j * 0.085) * fadeIn);
        }
        if (ai < NATK) {
          const tail = bez(a.s, a.c, a.e, Math.max(0, u - 0.06));
          U.atkA.set([head[0], head[1], head[2], fadeIn], ai * 4);
          U.atkB.set([tail[0], tail[1], tail[2], 0], ai * 4);
          ai++;
        }
      }

      // --- the swarm, its tracer fire, and sparks
      let swarmK = 0;
      if (sw) {
        let alive = 0;
        for (const en of sw.en) {
          if (!en.alive) continue;
          alive++;
          pts.p(en.p, 3.6, en.leak ? [1, 0.5, 0.3] : [1, 0.26, 0.16], en.leak ? 3 : 2.4);
        }
        swarmK = Math.min(1, (t - sw.t0) / 1.5) * (alive / sw.en.length);
        for (const tr of tracers) {
          const d = defs[tr.d];
          const en = sw.en[tr.e];
          if (!d || !en) continue;
          for (let q = 1; q <= 4; q++) pts.p(v3.mix(d.p, en.p, q / 5), 2.4, AMBER, 1.2);
        }
      }
      for (const s of sparks) pts.p(s.p, 2.6, s.c, 1.8 * (1 - (t - s.t0) / s.life));

      // --- uniforms
      U.sh.fill(0);
      U.shH.fill(0);
      shieldEv.forEach((s, k) => {
        const sy = systems[s.sys]!;
        const amt = t < s.tHit ? 0.3 * smooth(s.tHit - 0.6, s.tHit, t) : Math.exp(-(t - s.tHit) * 2.4);
        U.sh.set([sy.p[0], sy.p[1], sy.p[2], sy.shield], k * 4);
        U.shH.set([s.dir[0], s.dir[1], s.dir[2], amt * (s.red ? -1 : 1)], k * 4);
      });
      U.br.fill(0);
      let coreRed = 0;
      brs.slice(-2).forEach((b, k) => {
        U.br.set([b.core ? -99 : b.s.lr, b.s.psi, b.spread, b.amt], k * 4);
        if (b.core) coreRed = Math.max(coreRed, b.amt * (0.75 + 0.25 * Math.sin(t * 13)));
      });
      setCam(set, cam);
      set.f("uSky", t * 0.006);
      set.v4v("uSys", U.sys);
      set.v4v("uSysC", U.sysC);
      set.v4v("uSh", U.sh);
      set.v4v("uShH", U.shH);
      set.v4v("uAtkA", U.atkA);
      set.v4v("uAtkB", U.atkB);
      set.v4v("uBr", U.br);
      set.f("uCoreRed", coreRed);
      if (sw) set.v4("uSwarm", sw.centre[0], sw.centre[1], sw.centre[2], t >= sw.clashAt ? 0.15 : 0.11);
      else set.v4("uSwarm", 0, 0, 0, 1);
      set.v4("uSwarmC", swarmK, 0, 0, 0);
      flashes.pack(t, set);
      set.points(pts.data, pts.n, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      const out: { text: string; x: number; y: number; tone?: string; anchor?: "start" | "middle" | "end" }[] = [];
      const t = f.t;
      const minX = f.width * 0.55;
      // labels are centred on their point: keep the whole text clear of the left side and of each other
      const ok = (x: number, y: number, text: string) => {
        const half = text.length * 3.4 + 6;
        return x - half > minX && x + half < f.width - 12 && y > 14 && y < f.height - 36 && !out.some((o) => Math.abs(o.x - x) < half + o.text.length * 3.4 + 8 && Math.abs(o.y - y) < 16);
      };
      const tagSys = (i: number, tone: string) => {
        const s = systems[i]!;
        const p = projectPoint(i === 0 ? [0, 0.06, 0] : s.p, cam, f);
        if (!p) return;
        // a label's box hangs from its y, so lift it clear of the system's own glyphs
        const y = p.y - (i === 0 ? 44 : 30);
        const text = i === 0 ? "core models" : s.name;
        if (ok(p.x, y, text)) out.push({ text, x: p.x, y, tone, anchor: "middle" });
      };
      // systems in trouble first: breached (hot), then under attack (dim)
      for (const b of breaches) tagSys(b.sys, "hot");
      for (const a of attacks) if (out.length < 3) tagSys(a.sys, "dim");
      if (swarm && out.length < 3) tagSys(swarm.sys, "dim");
      // the kind of a few attacks rides with them for a moment
      let kinds = 0;
      for (const a of attacks) {
        const u = (t - a.t0) / a.dur;
        if (!a.tag || u < 0.08 || u > 0.7 || kinds >= 2) continue;
        const p = projectPoint(bez(a.s, a.c, a.e, u), cam, f);
        const text = a.ev.kind.toLowerCase();
        if (p && ok(p.x, p.y - 28, text)) {
          out.push({ text, x: p.x, y: p.y - 28, tone: "hot", anchor: "middle" });
          kinds++;
        }
      }
      if (swarm && t - swarm.t0 < 6) {
        const p = projectPoint(swarm.centre, cam, f);
        const text = `${swarm.ev.kind.toLowerCase()} swarm`;
        if (p && ok(p.x, p.y - 44, text)) out.push({ text, x: p.x, y: p.y - 44, tone: "hot", anchor: "middle" });
      }
      // in quiet moments, name the nearest couple of systems so the galaxy reads as the AI estate
      if (out.length < 2) {
        const order = systems
          .map((s, i) => ({ i, p: projectPoint(s.p, cam, f) }))
          .filter((x) => x.i > 0 && x.p && x.p.x > minX)
          .sort((a, b) => a.p!.z - b.p!.z);
        for (const x of order) {
          if (out.length >= 2) break;
          tagSys(x.i, "dim");
        }
      }
      out.push({ text: "sim · attack mix and breach odds from the last 90 days", x: f.width - 16, y: f.height - 16, tone: "dim", anchor: "end" });
      return out;
    },
  };
}
