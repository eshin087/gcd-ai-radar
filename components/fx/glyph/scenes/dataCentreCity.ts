import type { ThreatIntel } from "@/lib/threatIntel";
import { POINT_STRIDE, projectPoint, type Cam, type GlyphController, type V3 } from "../engine";
import type { FeedEvent } from "../feed";
import { WaveDirector } from "./director";
import { setCam, type Emit } from "./kit";

/** cells each side of the centre tower, and their pitch */
const N = 8;
const P = 2.2;
/** floor height and window pitch on the tower faces */
const FH = 0.62;
const CW = 0.42;
const HMAX = 10.5;
const NHOT = 8;
const NDOME = 6;
const NMET = 8;
const NFX = 8;

const FRAG = `
uniform vec3 uEye;
uniform vec3 uTarget;
uniform sampler2D uCity;
uniform vec4 uHot[${NHOT}];
uniform vec4 uHotS[${NHOT}];
uniform vec4 uDome[${NDOME}];
uniform vec4 uDomeS[${NDOME}];
uniform vec4 uMetA[${NMET}];
uniform vec4 uMetB[${NMET}];
uniform vec4 uFx[${NFX}];
uniform vec4 uFxC[${NFX}];
uniform vec4 uRadar;
uniform vec4 uSky;
uniform float uDetail;

const float P = ${P.toFixed(2)};
const int N = ${N};
const float HMAX = ${HMAX.toFixed(1)};
const float FH = ${FH.toFixed(2)};
const float CW = ${CW.toFixed(2)};
const vec3 CY = vec3(.35, .85, 1.);
const vec3 AM = vec3(1., .66, .3);
const vec3 RD = vec3(1., .22, .14);
const vec3 FOG = vec3(.005, .009, .02);

float cover(float d, float w, float fp){ fp = max(fp, 1e-4); return clamp((min(d + fp*.5, w) - max(d - fp*.5, -w))/fp, 0., 1.); }
vec4 towerAt(ivec2 c){ if(abs(c.x) > N || abs(c.y) > N) return vec4(0.); return texelFetch(uCity, c + ivec2(N), 0); }
vec2 slab(vec3 ro, vec3 inv, vec3 bmin, vec3 bmax, out vec3 n){
  vec3 t0 = (bmin - ro)*inv, t1 = (bmax - ro)*inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float a = max(max(tn.x, tn.y), tn.z);
  float b = min(min(tf.x, tf.y), tf.z);
  n = a == tn.x ? vec3(-sign(inv.x), 0., 0.) : a == tn.y ? vec3(0., -sign(inv.y), 0.) : vec3(0., 0., -sign(inv.z));
  return vec2(a, b);
}
/** the radar pulse along the ground, two rings in flight */
float radarAt(vec2 q, float w){
  float d = length(q);
  float r = 0.;
  for(int k = 0; k < 2; k++){
    float rr = k == 0 ? uRadar.x : uRadar.y;
    r += exp(-pow((d - rr)/w, 2.))*smoothstep(0., 2., rr)*(1. - smoothstep(14., 21., rr));
  }
  return r*uRadar.z;
}

vec3 shadeTower(vec3 p, vec3 n, ivec2 c, vec4 T, int part, float t, float pa){
  vec2 cc = vec2(c)*P;
  vec2 lq = p.xz - cc;
  vec2 hs = part == 1 ? T.xy*.66 : T.xy;
  float core = exp(-dot(cc, cc)/70.);
  float fp = t*pa*1.25;
  vec3 L = normalize(vec3(-.5, .7, -.4));
  float dif = max(dot(n, L), 0.);
  bool soc = c.x == 0 && c.y == 0;
  // a takeover in progress: red from redFrom down, repaired up to repairTo
  float red = 0., scan = 0., glitch = 0.;
  for(int i = 0; i < ${NHOT}; i++){
    vec4 h = uHot[i];
    if(uHotS[i].y < .5) continue;
    if(int(h.x) == c.x && int(h.y) == c.y){
      red = step(h.z, p.y + .001)*step(h.w, p.y);
      scan = h.w > .01 ? exp(-pow((p.y - h.w)/.1, 2.)) : 0.;
      glitch = uHotS[i].x;
    }
  }
  vec3 col;
  if(n.y > .5){
    float de = min(hs.x - abs(lq.x), hs.y - abs(lq.y));
    col = vec3(.03, .06, .13)*(.6 + .6*dif);
    col += CY*cover(de, .07, fp)*(.5 + .9*core);
    vec2 g = floor(lq/.42);
    col += vec3(.12, .25, .5)*step(.72, hash12(g + vec2(c)*3.1))*step(.18, de)*(.4 + .6*core);
    float seed = hash12(vec2(c) + 7.3);
    col += AM*step(.55, fract(uTime*.6 + seed))*cover(length(abs(lq) - hs + .14), .07, fp)*2.2;
    if(soc) col += AM*exp(-dot(lq, lq)*4.)*1.4;
    col = mix(col, RD*(.5 + .5*sin(uTime*23.)) + RD*cover(de, .07, fp), red);
  } else {
    bool xf = abs(n.x) > .5;
    float u = xf ? lq.y : lq.x;
    float hw = xf ? hs.y : hs.x;
    float face = xf ? (n.x > 0. ? 0. : 1.) : (n.z > 0. ? 2. : 3.);
    float fl = floor(p.y/FH);
    float fy = fract(p.y/FH);
    // each floor a row of server racks: a lit band of LED segments
    float gx = (u + hw)/CW + red*glitch*(hash12(vec2(fl, floor(uTime*11.))) - .5)*1.6;
    float cl = floor(gx);
    float fx = fract(gx);
    float band = cover(abs(fy - .4)*FH, .1, fp);
    float seg = mix(.75, smoothstep(.06, .16, fx)*smoothstep(.94, .84, fx), clamp(1.6 - fp/CW*1.4, 0., 1.));
    float fh = hash13(vec3(vec2(c)*13. + face*5.1, fl*7.1 + float(part)*3.3));
    float rh = hash13(vec3(vec2(c)*7. + face*3.7, fl*5.3 + cl*1.37));
    float on = step(.15 + .7*(1. - core), rh);
    float blink = rh > .92 ? step(.45, fract(uTime*(.7 + rh*2.) + rh*9.)) : 1.;
    vec3 led = fh > .8 ? AM : fh > .74 ? vec3(.9, .95, 1.) : CY;
    float br = (.6 + .9*fract(rh*13.))*on*blink;
    // the face catches the key light on one side, brighter higher up
    col = vec3(.1, .2, .42)*(.1 + 1.6*dif*dif)*(.45 + .55*smoothstep(0., 5., p.y))*(.12 + .95*core);
    col += led*band*seg*br*(.02 + 2.7*core)*uDetail;
    float de = hw - abs(u);
    col += CY*cover(de, .06, fp)*(.15 + 1.7*core);
    if(soc && part == 1) col += CY*1.6*exp(-pow((p.y - (T.z - .35))/.12, 2.));
    // taken over: the racks burn red and flicker, the face glows
    vec3 rc = RD*(.5 + 4.2*band*seg*(.45 + .55*step(.4, hash12(vec2(cl, fl) + floor(uTime*9.)))));
    col = mix(col, rc, red);
    col += vec3(.5, .95, 1.)*scan*2.6;
  }
  // the radar pulse washes over the tower feet
  col += CY*radarAt(p.xz, .7)*exp(-p.y/1.3)*.55;
  return col;
}

vec3 shadeGround(vec3 p, float t, float pa, float rdy){
  vec2 q = p.xz;
  float fp = t*pa*(.5 + .5/max(-rdy, .12));
  float B = (float(N) + .5)*P;
  float inside = step(max(abs(q.x), abs(q.y)), B);
  float core = exp(-dot(q, q)/140.);
  // distance to the nearest street centreline (the cell boundaries)
  vec2 dc = abs(fract(q/P + .5) - .5)*P;
  vec2 db = P*.5 - dc;
  vec2 lane = floor(q/P + .5);
  vec3 col = vec3(.004, .007, .014);
  // dashed centre lines and moving traffic in two lanes each way
  float sx = hash12(vec2(lane.x, 3.)), sz = hash12(vec2(lane.y, 5.));
  float carX = step(fract(q.y*.18 + uSky.w*(.25 + .2*sx) + sx*9.), .05)*cover(abs(db.x - .16), .06, fp);
  float carX2 = step(fract(q.y*.18 - uSky.w*(.25 + .2*sx) + sx*5.), .05)*cover(abs(db.x + .16), .06, fp);
  float carZ = step(fract(q.x*.18 + uSky.w*(.25 + .2*sz) + sz*9.), .05)*cover(abs(db.y - .16), .06, fp);
  float carZ2 = step(fract(q.x*.18 - uSky.w*(.25 + .2*sz) + sz*5.), .05)*cover(abs(db.y + .16), .06, fp);
  col += (AM*(carX + carZ)*2.2 + vec3(.85, .9, 1.)*(carX2 + carZ2)*1.6)*(.15 + .85*core)*inside*uDetail;
  // beyond the city a fading survey grid runs to the horizon
  vec2 gd = abs(fract(q/(P*2.)) - .5)*P*2.;
  col += vec3(.1, .25, .7)*.18*(cover(gd.x, .03, fp) + cover(gd.y, .03, fp))*(1. - inside)*exp(-t*.03);
  // the radar pulse: a ring along the ground, lighting the streets as it passes
  col += vec3(.3, .7, 1.)*(radarAt(q, .22)*.5 + radarAt(q, 1.4)*.06);
  col += CY*radarAt(q, 1.2)*(cover(db.x, .04, fp) + cover(db.y, .04, fp))*.8;
  return col;
}

vec3 skyCol(vec3 rd){
  float h = rd.y;
  vec3 c = vec3(.003, .005, .013) + vec3(.01, .018, .04)*exp(-max(h, 0.)*10.)*.5;
  c += starfield(.0025)*.4*smoothstep(.03, .3, h);
  vec2 hd = normalize(rd.xz + 1e-5);
  float e = max(dot(hd, uSky.xy), 0.);
  c += RD*pow(e, 16.)*exp(-max(h, 0.)*25.)*uSky.z*.035;
  return c;
}

void main(){
  vec3 ro = uEye;
  vec3 rd = camRay(lookAt(ro, uTarget));
  float pa = 2.*uTan.y/uRes.y;
  vec3 inv = 1./rd;
  float tHit = 1e9;
  vec3 hn = vec3(0.);
  ivec2 hc = ivec2(0);
  vec4 hT = vec4(0.);
  int part = 0;
  // walk the city grid cell by cell (a 2D DDA), testing each cell's tower and its setback
  float Bd = (float(N) + .5)*P;
  vec3 n0;
  vec2 tb = slab(ro, inv, vec3(-Bd, 0., -Bd), vec3(Bd, HMAX, Bd), n0);
  if(tb.x < tb.y && tb.y > 0.){
    float t0 = max(tb.x, 0.) + 1e-3;
    vec3 p0 = ro + rd*t0;
    ivec2 c = ivec2(floor(p0.xz/P + .5));
    vec2 st = vec2(rd.x >= 0. ? 1. : -1., rd.z >= 0. ? 1. : -1.);
    vec2 tNext = ((vec2(c) + .5*st)*P - ro.xz)*inv.xz;
    vec2 tDel = abs(P*inv.xz);
    for(int k = 0; k < 64; k++){
      vec4 T = towerAt(c);
      if(T.z > 0.){
        vec2 cc = vec2(c)*P;
        vec3 nn;
        float h1 = T.w > 0. ? T.w : T.z;
        vec2 r = slab(ro, inv, vec3(cc.x - T.x, 0., cc.y - T.y), vec3(cc.x + T.x, h1, cc.y + T.y), nn);
        if(r.x < r.y && r.x > 0. && r.x < tHit){ tHit = r.x; hn = nn; hc = c; hT = T; part = 0; }
        if(T.w > 0.){
          r = slab(ro, inv, vec3(cc.x - T.x*.66, T.w, cc.y - T.y*.66), vec3(cc.x + T.x*.66, T.z, cc.y + T.y*.66), nn);
          if(r.x < r.y && r.x > 0. && r.x < tHit){ tHit = r.x; hn = nn; hc = c; hT = T; part = 1; }
        }
        if(tHit < 1e8) break;
      }
      if(min(tNext.x, tNext.y) > tb.y) break;
      if(tNext.x < tNext.y){ tNext.x += tDel.x; c.x += int(st.x); }
      else { tNext.y += tDel.y; c.y += int(st.y); }
      if(abs(c.x) > N || abs(c.y) > N) break;
    }
  }
  float tg = rd.y < 0. ? ro.y/-rd.y : 1e9;
  vec3 col;
  if(tHit < tg && tHit < 1e8){
    col = shadeTower(ro + rd*tHit, hn, hc, hT, part, tHit, pa);
    col = mix(col, FOG, 1. - exp(-tHit*.018));
  } else if(tg < 1e8){
    tHit = tg;
    col = shadeGround(ro + rd*tg, tg, pa, rd.y);
    col = mix(col, FOG, 1. - exp(-tg*.03));
  } else {
    col = skyCol(rd);
  }

  // the SOC tower's mast and beacon
  {
    vec4 T = towerAt(ivec2(0));
    float s;
    vec3 a = vec3(0., T.z, 0.), b = vec3(0., T.z + 1.7, 0.);
    float d2 = segDist2(ro, rd, a, b, s);
    float ts = dot(a + (b - a)*s - ro, rd);
    if(ts < tHit + .5) col += vec3(.4, .7, 1.)*exp(-d2/.0012)*.7 + AM*pointGlow(ro, rd, b, .09)*(1.5 + 2.5*step(.6, fract(uTime*.8)));
  }
  // drone shield domes over the towers they protect
  for(int i = 0; i < ${NDOME}; i++){
    vec4 D = uDome[i];
    vec4 S = uDomeS[i];
    if(D.w <= 0.) continue;
    vec2 h = sphIsect(ro, rd, D.xyz, D.w);
    if(h.y < 0.) continue;
    float age = S.w;
    float a = smoothstep(-.4, -.05, age)*exp(-max(age, 0.)*1.9);
    for(int k = 0; k < 2; k++){
      float th = k == 0 ? h.x : h.y;
      if(th <= 0. || th > tHit) continue;
      vec3 p = ro + rd*th;
      if(p.y < D.y) continue;
      vec3 nn = normalize(p - D.xyz);
      float fr = pow(1. - abs(dot(nn, rd)), 2.);
      float lat = asin(clamp(nn.y, -1., 1.));
      float lon = atan(nn.z, nn.x);
      float grid = max(pow(abs(sin(lat*5.)), 24.), pow(abs(sin(lon*6.)), 24.)*step(lat, 1.25));
      float ang = acos(clamp(dot(nn, S.xyz), -1., 1.));
      float rip = exp(-pow((ang - max(age, 0.)*2.4)/.16, 2.))*step(0., age);
      float hit = exp(-ang*ang/.04)*exp(-max(age, 0.)*5.)*step(0., age);
      col += (CY*(fr*1.1 + grid*.55 + .06) + vec3(.8, .95, 1.)*rip*2.2 + vec3(1.)*hit*3.)*a*(k == 0 ? 1. : .5);
    }
  }
  // attacks falling from the sky: red streaks with white-hot heads
  for(int i = 0; i < ${NMET}; i++){
    vec4 A = uMetA[i];
    vec4 B = uMetB[i];
    if(A.w <= 0.) continue;
    float s;
    float d2 = segDist2(ro, rd, A.xyz, B.xyz, s);
    vec3 pc = A.xyz + (B.xyz - A.xyz)*s;
    if(dot(pc - ro, rd) > tHit + .3) continue;
    float w = .0045*length(B.xyz - ro) + .02;
    col += RD*(exp(-d2/(w*w))*pow(s, 1.7)*2.8 + exp(-d2/(w*w*12.))*pow(s, 3.)*.3)*A.w;
    col += vec3(1., .78, .62)*pointGlow(ro, rd, B.xyz, w*1.5)*2.6*A.w;
  }
  // flashes: shells where something was stopped or hit
  for(int i = 0; i < ${NFX}; i++){
    vec4 F = uFx[i];
    if(F.w < 0.) continue;
    vec3 oc = F.xyz - ro;
    float tt = dot(oc, rd);
    if(tt > tHit + 1.5) continue;
    float d = length(oc - rd*tt);
    float sz = uFxC[i].a;
    float R = sz*(1. - exp(-F.w*5.));
    col += uFxC[i].rgb*(exp(-pow((d - R)/(.06*sz + .03), 2.))*exp(-F.w*3.)*1.5 + exp(-d*d/(.04*sz*sz + .01))*exp(-F.w*6.)*3.5);
  }
  outCol(col);
}
`;

const CYAN: [number, number, number] = [0.35, 0.85, 1];
const AMBER: [number, number, number] = [1, 0.66, 0.3];
const RED: [number, number, number] = [1, 0.22, 0.14];
const WHITE: [number, number, number] = [0.9, 0.95, 1];
const SPARK_C = [CYAN, RED, AMBER, WHITE];

/** The towers that stand for the AI estate (cell, footprint half sizes, height, setback height). */
const NAMED: { name: string; i: number; j: number; hx: number; hz: number; h: number; h2: number }[] = [
  { name: "soc", i: 0, j: 0, hx: 0.95, hz: 0.95, h: 9.6, h2: 6.4 },
  { name: "llm", i: 2, j: -1, hx: 0.85, hz: 0.8, h: 7.2, h2: 5 },
  { name: "agents", i: -2, j: 1, hx: 0.8, hz: 0.85, h: 6.4, h2: 0 },
  { name: "vector db", i: 1, j: 2, hx: 0.9, hz: 0.75, h: 5.6, h2: 3.8 },
  { name: "mcp · tools", i: -1, j: -2, hx: 0.75, hz: 0.8, h: 5.2, h2: 0 },
  { name: "gateway", i: 3, j: 2, hx: 0.85, hz: 0.7, h: 4.6, h2: 0 },
  { name: "ci/cd", i: -3, j: -1, hx: 0.7, hz: 0.75, h: 4.4, h2: 3 },
  { name: "identity", i: 2, j: -3, hx: 0.75, hz: 0.75, h: 5, h2: 0 },
];
const SOC = 0;

const KIND_TOWERS: Record<string, string[]> = {
  "PROMPT INJECTION": ["llm", "agents", "mcp · tools"],
  JAILBREAK: ["llm"],
  "INFRA EXPLOIT": ["gateway", "mcp · tools"],
  "DATA LEAK": ["vector db"],
  "MODEL THEFT": ["llm"],
  "AGENT HIJACK": ["agents", "mcp · tools"],
  "SUPPLY CHAIN": ["ci/cd", "mcp · tools"],
  "DATA POISONING": ["vector db"],
  EVASION: ["gateway", "llm"],
  "DEEPFAKE FRAUD": ["identity"],
  "AI PHISHING": ["identity"],
  "AI MALWARE": ["ci/cd", "gateway"],
  "AI INTRUSION": ["gateway", "agents"],
};
const TARGET_TOWERS: Record<string, string[]> = {
  "MCP / tools": ["mcp · tools"],
  "self-hosted LLM": ["llm"],
  employees: ["identity"],
  "the core": ["soc"],
};

const clamp01 = (v: number) => Math.min(0.95, Math.max(0.2, v));

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Point sprites written straight into the buffer (no per-point arrays). */
class Pts {
  data: Float32Array;
  n = 0;
  constructor(private max: number) {
    this.data = new Float32Array(max * POINT_STRIDE);
  }
  add(x: number, y: number, z: number, r: number, c: readonly number[], k: number) {
    if (this.n >= this.max || k <= 0.01) return;
    const o = this.n * POINT_STRIDE;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = r;
    d[o + 4] = c[0]!;
    d[o + 5] = c[1]!;
    d[o + 6] = c[2]!;
    d[o + 7] = k;
    this.n++;
  }
}

interface Tower {
  i: number;
  j: number;
  x: number;
  z: number;
  hx: number;
  hz: number;
  h: number;
  h2: number;
  name: string;
}

interface Drone {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 0 street patrol, 1 reserve docked in the SOC tower */
  home: number;
  /** 0 idle, 1 shield dome, 2 intercept, 3 repair crew, 4 dogfight */
  job: number;
  wi: number;
  wj: number;
  pi: number;
  pj: number;
  alt: number;
  k: number;
  met: Meteor | null;
  rep: Repair | null;
  foe: Foe | null;
  fire: number;
  /** a scripted flight: from (sx sy sz) at t0 to the meeting point by t1 */
  sx: number;
  sy: number;
  sz: number;
  f0: number;
  f1: number;
}

interface Meteor {
  ev: FeedEvent | null;
  sw: EnemySwarm | null;
  tower: number;
  s: V3;
  e: V3;
  t0: number;
  dur: number;
  /** where along the way it ends (dome surface, interception point, roof) */
  uEnd: number;
  done: boolean;
  dome: number;
  crew: Drone[];
}

interface Repair {
  tower: number;
  evs: FeedEvent[];
  sw: EnemySwarm | null;
  t0: number;
  crew: Drone[];
  done: boolean;
}

interface Foe {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** flock offset and its own orbit once over the city */
  ox: number;
  oy: number;
  oz: number;
  r: number;
  w: number;
  a0: number;
  alt: number;
  tk: number;
  alive: boolean;
  leaker: boolean;
  fire: number;
}

interface EnemySwarm {
  ev: FeedEvent;
  t0: number;
  dx: number;
  dz: number;
  foes: Foe[];
  ours: Drone[];
  alive: number;
  cleared: number;
  leakMet: Meteor | null;
  repair: Repair | null;
}

type Label = { text: string; x: number; y: number; tone?: string; anchor?: "start" | "middle" | "end" };
const TONE_RANK: Record<string, number> = { hot: 3, accent: 2, dim: 1 };

/** Labels that would overlap a more important one, or run off the right edge, are dropped (hot, then accent, then dim). */
function declutter(items: Label[], width: number): Label[] {
  const sorted = [...items].sort((a, b) => (TONE_RANK[b.tone ?? ""] ?? 0) - (TONE_RANK[a.tone ?? ""] ?? 0));
  const boxes: [number, number, number, number][] = [];
  return sorted.filter((it) => {
    const w = it.text.length * 7.1 + 6;
    const x0 = it.anchor === "middle" ? it.x - w / 2 : it.anchor === "end" ? it.x - w : it.x;
    const box: [number, number, number, number] = [x0, it.y - 1, x0 + w, it.y + 15];
    if (box[2] > width - 6) return false;
    if (boxes.some((o) => o[0] < box[2] && box[0] < o[2] && o[1] < box[3] && box[1] < o[3])) return false;
    boxes.push(box);
    return true;
  });
}

const NDRONE = 76;
const PATROL = 40;
const NSPARK = 500;
const NTRACER = 120;

/**
 * Data-centre city: a raymarched city of server towers (a grid walked cell
 * by cell, hashed heights, setbacks, fog to the horizon) whose faces carry
 * blinking window and LED grids, seen from a slow oblique orbit. Cyan patrol
 * drones weave between the towers, traffic and data run along the streets,
 * and the SOC tower's radar sends a pulse ring along the ground. Attacks from
 * the 90-day feed, paced by the wave director, fall from the sky as red
 * streaks onto the tower their type goes for: a drone shield dome flashes
 * over the tower and stops it, or drones meet it in the air, or at the
 * type's real harm rate it hits: the tower's windows go red floor by floor,
 * glitching, until a ring of drones climbs it and rebuilds it floor by floor.
 * In each war phase a red drone swarm sweeps in from the horizon and our
 * drones dogfight it over the city, with tracers and falling wrecks.
 */
export function dataCentreCity({ intel, emit }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const director = new WaveDirector(intel, 113);
  // the scene's own dice, so the feed's sequence never depends on frame timing
  const rnd = mulberry(4113);
  const pts = new Pts(2500);

  // the city: named towers at fixed cells, the rest hashed, tall downtown and low outskirts
  const lr = mulberry(20261019);
  const SIDE = 2 * N + 1;
  const city = new Float32Array(SIDE * SIDE * 4);
  const towers: Tower[] = [];
  const grid = new Map<string, Tower>();
  for (let j = -N; j <= N; j++)
    for (let i = -N; i <= N; i++) {
      const named = NAMED.find((n) => n.i === i && n.j === j);
      const a = lr();
      const b = lr();
      const c = lr();
      const d = lr();
      const e = lr();
      let tw: Tower | null = null;
      if (named) tw = { i, j, x: i * P, z: j * P, hx: named.hx, hz: named.hz, h: named.h, h2: named.h2, name: named.name };
      else if (a > 0.11) {
        const r = Math.hypot(i, j) * P;
        const core = Math.exp(-(r * r) / (2 * 8.5 * 8.5));
        const h = 0.7 + (0.7 + 5.4 * c * c) * (0.22 + 0.78 * core);
        const h2 = h > 3.4 && d < 0.55 ? h * (0.55 + 0.2 * e) : 0;
        tw = { i, j, x: i * P, z: j * P, hx: 0.6 + 0.26 * b, hz: 0.6 + 0.26 * lr(), h: Math.min(h, NAMED[0]!.h - 1.5), h2, name: "" };
      }
      if (!tw) continue;
      towers.push(tw);
      grid.set(`${i},${j}`, tw);
      city.set([tw.hx, tw.hz, tw.h, tw.h2], ((j + N) * SIDE + (i + N)) * 4);
    }
  const named = NAMED.map((n) => grid.get(`${n.i},${n.j}`)!);
  const byName = new Map(NAMED.map((n, k) => [n.name, k]));
  let tex: WebGLTexture | null = null;

  // shader data
  const uHot = new Float32Array(NHOT * 4);
  const uHotS = new Float32Array(NHOT * 4);
  const uDome = new Float32Array(NDOME * 4);
  const uDomeS = new Float32Array(NDOME * 4);
  const uMetA = new Float32Array(NMET * 4);
  const uMetB = new Float32Array(NMET * 4);
  const uFx = new Float32Array(NFX * 4);
  const uFxC = new Float32Array(NFX * 4);

  const fx: { x: number; y: number; z: number; t0: number; size: number; c: readonly number[] }[] = [];
  const flash = (x: number, y: number, z: number, t: number, c: readonly number[], size: number) => {
    fx.push({ x, y, z, t0: t, size, c });
    if (fx.length > NFX) fx.shift();
  };
  const domes: { tower: number; t1: number; dir: V3 }[] = [];

  const drones: Drone[] = [];
  for (let k = 0; k < NDRONE; k++) {
    const home = k < PATROL ? 0 : 1;
    const wi = Math.floor(lr() * 10) - 5;
    const wj = Math.floor(lr() * 10) - 5;
    const alt = 1.1 + lr() * 3.2;
    drones.push({ x: (wi + 0.5) * P, y: home ? 0 : alt, z: (wj + 0.5) * P, vx: 0, vy: 0, vz: 0, home, job: 0, wi, wj, pi: wi, pj: wj, alt, k, met: null, rep: null, foe: null, fire: 0, sx: 0, sy: 0, sz: 0, f0: 0, f1: 0 });
  }
  const socTop = named[SOC]!.h;
  for (const d of drones) if (d.home === 1) [d.x, d.y, d.z] = [0, socTop - 0.4, 0];

  let meteors: Meteor[] = [];
  const repairOf: (Repair | null)[] = named.map(() => null);
  let swarms: EnemySwarm[] = [];
  const sp = new Float32Array(NSPARK * 8);
  let nsp = 0;
  const spark = (x: number, y: number, z: number, n: number, c: readonly number[], speed: number, up = 1) => {
    for (let k = 0; k < n; k++) {
      if (nsp >= NSPARK) return;
      const a = rnd() * Math.PI * 2;
      const el = (rnd() - 0.3) * 1.4;
      const v = speed * (0.4 + rnd() * 0.8);
      const o = nsp * 8;
      sp[o] = x;
      sp[o + 1] = y;
      sp[o + 2] = z;
      sp[o + 3] = Math.cos(a) * Math.cos(el) * v;
      sp[o + 4] = Math.sin(el) * v * up + 0.8;
      sp[o + 5] = Math.sin(a) * Math.cos(el) * v;
      sp[o + 6] = 0.45 + rnd() * 0.6;
      sp[o + 7] = c === RED ? 1 : c === AMBER ? 2 : c === WHITE ? 3 : 0;
      nsp++;
    }
  };
  // tracers: x y z vx vy vz life colour
  const tr = new Float32Array(NTRACER * 8);
  let ntr = 0;
  const tracer = (x: number, y: number, z: number, tx: number, ty: number, tz: number, red: boolean) => {
    if (ntr >= NTRACER) return;
    const dx = tx - x;
    const dy = ty - y;
    const dz = tz - z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const v = 16;
    const o = ntr * 8;
    tr[o] = x;
    tr[o + 1] = y;
    tr[o + 2] = z;
    tr[o + 3] = (dx / l) * v;
    tr[o + 4] = (dy / l) * v;
    tr[o + 5] = (dz / l) * v;
    tr[o + 6] = Math.min(0.5, l / v);
    tr[o + 7] = red ? 1 : 0;
    ntr++;
  };
  // falling wrecks: x y z vx vy vz life -
  const wr = new Float32Array(40 * 8);
  let nwr = 0;

  let cam: Cam = { eye: [0, 10, 27], target: [0, 3.5, 0] };
  let radarPh = 0;
  let flow = 0;
  const tmp: V3 = [0, 0, 0];
  const label = new Map<number, number>();

  const towerFor = (ev: FeedEvent) => {
    const names = TARGET_TOWERS[ev.target] ?? KIND_TOWERS[ev.kind];
    if (!names) return 1 + Math.floor(rnd() * (named.length - 1));
    return byName.get(names[Math.floor(rnd() * names.length)]!) ?? 1;
  };
  const take = (n: number, x: number, y: number, z: number, homes: number[]) => {
    const out: Drone[] = [];
    for (const h of homes) {
      if (out.length >= n) break;
      const free = drones.filter((d) => d.job === 0 && d.home === h).sort((a, b) => Math.hypot(a.x - x, a.y - y, a.z - z) - Math.hypot(b.x - x, b.y - y, b.z - z));
      for (const d of free) {
        if (out.length >= n) break;
        out.push(d);
      }
    }
    return out;
  };
  const release = (d: Drone) => {
    d.job = 0;
    d.met = null;
    d.rep = null;
    d.foe = null;
  };
  const metAt = (m: Meteor, u: number, out: V3) => {
    out[0] = m.s[0] + (m.e[0] - m.s[0]) * u;
    out[1] = m.s[1] + (m.e[1] - m.s[1]) * u;
    out[2] = m.s[2] + (m.e[2] - m.s[2]) * u;
    return out;
  };

  const startRepair = (tower: number, ev: FeedEvent | null, sw: EnemySwarm | null, t: number) => {
    const old = repairOf[tower];
    if (old) {
      // hit again while it is still taken over: the hit joins the same rebuild
      if (ev) old.evs.push(ev);
      return old;
    }
    const r: Repair = { tower, evs: ev ? [ev] : [], sw, t0: t, crew: [], done: false };
    repairOf[tower] = r;
    return r;
  };

  /** a red streak from high in the sky onto a tower's roof */
  const launch = (ev: FeedEvent | null, sw: EnemySwarm | null, tower: number, t: number, from?: V3) => {
    const tw = named[tower]!;
    const e: V3 = [tw.x, tw.h + 0.02, tw.z];
    let s: V3;
    if (from) s = [from[0], from[1], from[2]];
    else {
      // from the far side of the sky, so it falls toward the camera's side of the tower
      const ca = Math.atan2(cam.eye[0] - tw.x, cam.eye[2] - tw.z) + Math.PI + (rnd() - 0.5) * 2.2;
      const len = 11 + rnd() * 3.5;
      const el = 0.85 + rnd() * 0.3;
      s = [e[0] + Math.sin(ca) * Math.cos(el) * len, e[1] + Math.sin(el) * len, e[2] + Math.cos(ca) * Math.cos(el) * len];
    }
    const dist = Math.hypot(s[0] - e[0], s[1] - e[1], s[2] - e[2]);
    const m: Meteor = { ev, sw, tower, s, e, t0: t, dur: dist / (from ? 7 : 6.5 + rnd() * 2), uEnd: 1, done: false, dome: -1, crew: [] };
    const fate = ev ? ev.fate : "breach";
    if (fate === "blocked") {
      // the dome over the roof: the streak ends where it meets the shell
      const r = Math.max(tw.hx, tw.hz) * 1.55;
      const dx = s[0] - e[0];
      const dy = s[1] - e[1];
      const dz = s[2] - e[2];
      m.uEnd = 1 - r / Math.hypot(dx, dy, dz);
      m.crew = take(6, e[0], e[1], e[2], [0, 1]);
      m.crew.forEach((d, k) => {
        d.job = 1;
        d.met = m;
        d.k = k;
      });
    } else if (fate === "intercepted") {
      // met in the air a few floors above the roof, low enough to be in the frame
      const yI = Math.min(9.4, tw.h + 2.2 + rnd() * 1.6);
      m.uEnd = clamp01((s[1] - yI) / Math.max(0.1, s[1] - e[1]));
      metAt(m, m.uEnd, tmp);
      const t1 = t + m.dur * m.uEnd;
      m.crew = take(2, tmp[0], tmp[1], tmp[2], [0, 1]);
      m.crew.forEach((d, k) => {
        d.job = 2;
        d.met = m;
        d.k = k;
        d.sx = d.x;
        d.sy = d.y;
        d.sz = d.z;
        d.f0 = t;
        d.f1 = t1 - 0.05 * k;
      });
    }
    meteors.push(m);
    return m;
  };

  const spawnSwarm = (ev: FeedEvent, size: number, t: number) => {
    // in from the horizon beyond the city, a little to screen right
    const ca = Math.atan2(cam.eye[0], cam.eye[2]) + Math.PI + 0.45;
    const dx = Math.sin(ca);
    const dz = Math.cos(ca);
    const sw: EnemySwarm = { ev, t0: t, dx, dz, foes: [], ours: [], alive: 0, cleared: -1, leakMet: null, repair: null };
    for (let k = 0; k < size; k++) {
      const r = 3.5 + rnd() * 9;
      sw.foes.push({
        x: dx * 46,
        y: 9,
        z: dz * 46,
        vx: 0,
        vy: 0,
        vz: 0,
        ox: (rnd() - 0.5) * 12,
        oy: (rnd() - 0.5) * 4,
        oz: (rnd() - 0.5) * 10,
        r,
        w: (rnd() < 0.5 ? -1 : 1) * (0.25 + rnd() * 0.3),
        a0: rnd() * Math.PI * 2,
        alt: 2.5 + rnd() * 6,
        tk: t + 5.5 + rnd() * 9,
        alive: true,
        leaker: false,
        fire: t + rnd(),
      });
    }
    if (ev.fate === "breach" && sw.foes.length) {
      const f = sw.foes[0]!;
      f.leaker = true;
      f.tk = t + 7.5;
    }
    sw.alive = sw.foes.length;
    sw.ours = take(44, dx * 8, 6, dz * 8, [1, 0]);
    sw.ours.forEach((d, k) => {
      d.job = 4;
      d.k = k;
      d.foe = sw.foes[k % sw.foes.length]!;
    });
    swarms.push(sw);
    emit?.(ev, false);
  };

  const steer = (d: { x: number; y: number; z: number; vx: number; vy: number; vz: number }, x: number, y: number, z: number, vmax: number, dt: number, k = 5) => {
    const dx = x - d.x;
    const dy = y - d.y;
    const dz = z - d.z;
    const dist = Math.hypot(dx, dy, dz);
    const s = dist > 1e-4 ? Math.min(vmax, dist * 3.5) / dist : 0;
    const a = Math.min(1, dt * k);
    d.vx += (dx * s - d.vx) * a;
    d.vy += (dy * s - d.vy) * a;
    d.vz += (dz * s - d.vz) * a;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.z += d.vz * dt;
  };
  const inCity = (i: number, j: number) => Math.abs(i) <= 5 && Math.abs(j) <= 5;

  return {
    frag: FRAG,
    fovY: 36,
    shift: 0.4,
    init(gl) {
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, SIDE, SIDE, 0, gl.RGBA, gl.FLOAT, city);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },
    frame(f, set) {
      const t = f.t;
      const dt = Math.min(0.05, Math.max(0, f.dt));
      const level = director.level(t);

      // a slow oblique orbit round the downtown
      const ang = 0.5 + t * 0.022;
      if (f.narrow) {
        const R = 24;
        cam = { eye: [Math.sin(ang) * R, 7.5, Math.cos(ang) * R], target: [0, 4.4, 0] };
      } else {
        const R = 20.5 + 1.2 * Math.sin(t * 0.04);
        cam = { eye: [Math.sin(ang) * R, 7.2 + 0.6 * Math.sin(t * 0.031 + 1), Math.cos(ang) * R], target: [0, 4, 0] };
      }

      const wave = director.tick(t);
      for (const ev of wave.attacks) {
        const tower = towerFor(ev);
        launch(ev, null, tower, t);
        label.set(tower, t + 3);
        emit?.(ev, false);
      }
      if (wave.swarm) spawnSwarm(wave.swarm.ev, wave.swarm.size, t);

      radarPh += dt / (5.2 - 2.4 * level);
      flow += dt * (1 + 0.6 * level);

      // meteors
      for (const m of meteors) {
        if (m.done) continue;
        const u = (t - m.t0) / m.dur;
        const tw = named[m.tower]!;
        if (u >= m.uEnd) {
          m.done = true;
          metAt(m, m.uEnd, tmp);
          const fate = m.ev ? m.ev.fate : "breach";
          if (fate === "blocked") {
            domes.push({ tower: m.tower, t1: t, dir: [tmp[0] - tw.x, tmp[1] - tw.h, tmp[2] - tw.z] });
            if (domes.length > NDOME) domes.shift();
            spark(tmp[0], tmp[1], tmp[2], 14, WHITE, 3);
            spark(tmp[0], tmp[1], tmp[2], 8, RED, 2.4);
            emit?.(m.ev!, true, "BLOCKED · DRONE SHIELD");
            for (const d of m.crew) release(d);
          } else if (fate === "intercepted") {
            flash(tmp[0], tmp[1], tmp[2], t, CYAN, 1.7);
            spark(tmp[0], tmp[1], tmp[2], 26, AMBER, 4);
            spark(tmp[0], tmp[1], tmp[2], 14, RED, 3);
            spark(tmp[0], tmp[1], tmp[2], 10, CYAN, 3.4);
            emit?.(m.ev!, true, "INTERCEPTED IN THE AIR");
            for (const d of m.crew) release(d);
          } else {
            flash(tw.x, tw.h + 0.3, tw.z, t, RED, 1.6);
            spark(tw.x, tw.h + 0.1, tw.z, 22, RED, 3);
            const r = startRepair(m.tower, m.ev, m.sw, t);
            if (m.sw) m.sw.repair = r;
            label.set(m.tower, t + 1);
          }
        }
      }
      meteors = meteors.filter((m) => !m.done);

      // takeovers and rebuilds
      const war = 1 + 0.25 * level;
      for (let k = 0; k < named.length; k++) {
        const r = repairOf[k];
        if (!r) continue;
        const tw = named[k]!;
        const tb = (t - r.t0) * war;
        if (r.crew.length === 0 && tb > 0.8) {
          r.crew = take(10, tw.x, tw.h * 0.5, tw.z, [0, 1]);
          r.crew.forEach((d, i) => {
            d.job = 3;
            d.rep = r;
            d.k = i;
          });
        }
        if (tb > 7.4) {
          flash(tw.x, tw.h + 0.4, tw.z, t, CYAN, 2);
          spark(tw.x, tw.h + 0.2, tw.z, 20, CYAN, 2.6);
          for (const ev of r.evs) emit?.(ev, true, "BREACH · TOWER REBUILT");
          for (const d of r.crew) release(d);
          r.done = true;
          repairOf[k] = null;
        }
      }

      // enemy swarms: in from the horizon, then a dogfight over the city
      for (const sw of swarms) {
        const age = t - sw.t0;
        for (const fo of sw.foes) {
          if (!fo.alive) continue;
          let x: number;
          let y: number;
          let z: number;
          if (age < 6) {
            const u = age / 6;
            const e = u * u * (3 - 2 * u);
            const cx = sw.dx * (46 - 36 * e);
            const cz = sw.dz * (46 - 36 * e);
            x = cx + fo.ox * (0.6 + 0.4 * e) + sw.dz * fo.ox * 0.2;
            y = 9 + fo.oy - 1.5 * e;
            z = cz + fo.oz * (0.6 + 0.4 * e) - sw.dx * fo.ox * 0.2;
          } else {
            const a = fo.a0 + fo.w * (age - 6) + Math.atan2(sw.dx, sw.dz);
            const blend = Math.min(1, (age - 6) / 2.5);
            const ox = Math.sin(a) * fo.r;
            const oz = Math.cos(a) * fo.r;
            x = sw.dx * 10 * (1 - blend) + ox * blend + fo.ox * 0.3 * (1 - blend);
            y = (9 + fo.oy - 1.5) * (1 - blend) + (fo.alt + Math.sin(t * 1.3 + fo.a0) * 0.8) * blend;
            z = sw.dz * 10 * (1 - blend) + oz * blend + fo.oz * 0.3 * (1 - blend);
          }
          x += Math.sin(t * 2.1 + fo.a0 * 3) * 0.3;
          y += Math.sin(t * 2.7 + fo.a0 * 5) * 0.2;
          fo.vx = (x - fo.x) / Math.max(dt, 1e-3);
          fo.vy = (y - fo.y) / Math.max(dt, 1e-3);
          fo.vz = (z - fo.z) / Math.max(dt, 1e-3);
          fo.x = x;
          fo.y = y;
          fo.z = z;
          if (age > 5 && t > fo.fire) {
            fo.fire = t + 0.6 + rnd() * 1.4;
            const tgt = sw.ours[Math.floor(rnd() * sw.ours.length)];
            if (tgt) tracer(fo.x, fo.y, fo.z, tgt.x, tgt.y, tgt.z, true);
          }
          if (t > fo.tk) {
            if (fo.leaker) {
              // at the type's real harm rate one gets through: it dives onto a tower
              fo.alive = false;
              sw.alive--;
              const tower = 1 + Math.floor(rnd() * (named.length - 1));
              sw.leakMet = launch(null, sw, tower, t, [fo.x, fo.y, fo.z]);
              label.set(tower, t + 3);
              continue;
            }
            // it goes down to the nearest of our drones, once one is close enough to be the shooter
            let hunter: Drone | null = null;
            let best = 7;
            for (const d of sw.ours) {
              const dd = Math.hypot(d.x - fo.x, d.y - fo.y, d.z - fo.z);
              if (dd < best) {
                best = dd;
                hunter = d;
              }
            }
            if (!hunter && age < 20) {
              fo.tk = t + 0.4;
              continue;
            }
            fo.alive = false;
            sw.alive--;
            if (hunter) tracer(hunter.x, hunter.y, hunter.z, fo.x, fo.y, fo.z, false);
            flash(fo.x, fo.y, fo.z, t, AMBER, 0.6);
            spark(fo.x, fo.y, fo.z, 10, AMBER, 3);
            spark(fo.x, fo.y, fo.z, 6, RED, 2);
            if (nwr < 40) {
              const o = nwr * 8;
              wr.set([fo.x, fo.y, fo.z, fo.vx * 0.3, 1, fo.vz * 0.3, 2.2, 0], o);
              nwr++;
            }
          }
        }
        // our drones re-target as their foes fall
        for (const d of sw.ours) {
          if (!d.foe || !d.foe.alive) {
            const live = sw.foes.filter((fo) => fo.alive);
            d.foe = live.length ? live[(d.k * 7) % live.length]! : null;
          }
        }
        if (sw.cleared < 0 && sw.alive <= 0) {
          sw.cleared = t;
          for (const d of sw.ours) release(d);
          sw.ours = [];
        }
      }
      swarms = swarms.filter((sw) => {
        const leakDone = !sw.leakMet || (sw.leakMet.done && (!sw.repair || sw.repair.done));
        if (sw.cleared > 0 && leakDone) {
          emit?.(sw.ev, true, sw.leakMet ? "SWARM DOWNED · TOWER REBUILT" : "SWARM DOWNED OVER THE CITY");
          return false;
        }
        return true;
      });

      // drones
      const pace = 1 + 0.3 * level;
      for (const d of drones) {
        if (d.job === 1 && d.met) {
          // shield emitters: a ring over the roof
          const tw = named[d.met.tower]!;
          const a = (d.k / 6) * Math.PI * 2 + t * 1.5;
          const r = Math.max(tw.hx, tw.hz) * 1.45;
          steer(d, tw.x + Math.cos(a) * r, tw.h + 0.35, tw.z + Math.sin(a) * r, 11, dt, 7);
        } else if (d.job === 2 && d.met) {
          // a scripted climb to the meeting point, firing as it closes
          const m = d.met;
          const u = Math.min(1, (t - d.f0) / Math.max(0.1, d.f1 - d.f0));
          const e = u * u * (3 - 2 * u);
          metAt(m, m.uEnd, tmp);
          const cx = (d.sx + tmp[0]) / 2;
          const cy = Math.max(d.sy, tmp[1]) + 1.5;
          const cz = (d.sz + tmp[2]) / 2;
          const w = 1 - e;
          const nx = w * w * d.sx + 2 * w * e * cx + e * e * tmp[0] + (d.k - 0.5) * 0.4 * w;
          const ny = w * w * d.sy + 2 * w * e * cy + e * e * tmp[1];
          const nz = w * w * d.sz + 2 * w * e * cz + e * e * tmp[2];
          d.vx = (nx - d.x) / Math.max(dt, 1e-3);
          d.vy = (ny - d.y) / Math.max(dt, 1e-3);
          d.vz = (nz - d.z) / Math.max(dt, 1e-3);
          d.x = nx;
          d.y = ny;
          d.z = nz;
          if (u > 0.45 && t > d.fire) {
            d.fire = t + 0.12;
            metAt(m, Math.min(m.uEnd, (t - m.t0) / m.dur + 0.04), tmp);
            tracer(d.x, d.y, d.z, tmp[0], tmp[1], tmp[2], false);
          }
        } else if (d.job === 3 && d.rep) {
          // the repair crew circles the tower at the floor it is rebuilding
          const r = d.rep;
          const tw = named[r.tower]!;
          const tb = (t - r.t0) * war;
          const rep = tb < 3.2 ? 0.25 : Math.min(tw.h, ((tb - 3.2) / 3.8) * tw.h);
          const a = (d.k / Math.max(1, r.crew.length)) * Math.PI * 2 + t * 2.1;
          const rr = Math.max(tw.hx, tw.hz) + 0.55;
          steer(d, tw.x + Math.cos(a) * rr, rep + 0.15, tw.z + Math.sin(a) * rr, 9, dt, 6);
        } else if (d.job === 4) {
          const fo = d.foe;
          if (fo) {
            const side = (d.k % 2 ? 1 : -1) * 0.8;
            steer(d, fo.x - fo.vx * 0.25 + side * Math.cos(t * 2 + d.k), fo.y + 0.4 * Math.sin(t * 3 + d.k), fo.z - fo.vz * 0.25 + side * Math.sin(t * 2 + d.k), 13, dt, 4);
            if (t > d.fire && Math.hypot(fo.x - d.x, fo.y - d.y, fo.z - d.z) < 6) {
              d.fire = t + 0.35 + rnd() * 0.5;
              tracer(d.x, d.y, d.z, fo.x, fo.y, fo.z, false);
            }
          } else steer(d, 0, socTop + 2, 0, 9, dt);
        } else {
          if (d.job !== 0) release(d);
          if (d.home === 1) {
            // reserves go home into the SOC tower's crown
            steer(d, 0, socTop - 0.4, 0, 9, dt);
          } else {
            const wx = (d.wi + 0.5) * P;
            const wz = (d.wj + 0.5) * P;
            if (Math.hypot(d.x - wx, d.z - wz) < 0.7) {
              // next street corner: straight on or turn, never back
              const opts: [number, number][] = [];
              for (const [di, dj] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ] as const) {
                const ni = d.wi + di;
                const nj = d.wj + dj;
                if (ni === d.pi && nj === d.pj) continue;
                if (inCity(ni, nj)) opts.push([ni, nj]);
              }
              const pick = opts[Math.floor(rnd() * opts.length)] ?? [d.pi, d.pj];
              d.pi = d.wi;
              d.pj = d.wj;
              d.wi = pick[0];
              d.wj = pick[1];
            }
            steer(d, wx, d.alt + 0.25 * Math.sin(t * 1.3 + d.k), wz, 3.2 * pace, dt, 2.2);
          }
        }
      }

      // sparks, tracers, wrecks
      for (let i = 0; i < nsp; i++) {
        const o = i * 8;
        sp[o + 6]! -= dt;
        if (sp[o + 6]! <= 0) {
          const last = (nsp - 1) * 8;
          sp.copyWithin(o, last, last + 8);
          nsp--;
          i--;
          continue;
        }
        sp[o + 4]! -= 6 * dt;
        sp[o]! += sp[o + 3]! * dt;
        sp[o + 1]! += sp[o + 4]! * dt;
        sp[o + 2]! += sp[o + 5]! * dt;
      }
      for (let i = 0; i < ntr; i++) {
        const o = i * 8;
        tr[o + 6]! -= dt;
        if (tr[o + 6]! <= 0) {
          const last = (ntr - 1) * 8;
          tr.copyWithin(o, last, last + 8);
          ntr--;
          i--;
          continue;
        }
        tr[o]! += tr[o + 3]! * dt;
        tr[o + 1]! += tr[o + 4]! * dt;
        tr[o + 2]! += tr[o + 5]! * dt;
      }
      for (let i = 0; i < nwr; i++) {
        const o = i * 8;
        wr[o + 6]! -= dt;
        if (wr[o + 6]! <= 0 || wr[o + 1]! < 0) {
          if (wr[o + 1]! < 0.3) spark(wr[o]!, 0.1, wr[o + 2]!, 6, AMBER, 1.6);
          const last = (nwr - 1) * 8;
          wr.copyWithin(o, last, last + 8);
          nwr--;
          i--;
          continue;
        }
        wr[o + 4]! -= 7 * dt;
        wr[o]! += wr[o + 3]! * dt;
        wr[o + 1]! += wr[o + 4]! * dt;
        wr[o + 2]! += wr[o + 5]! * dt;
      }

      // points
      pts.n = 0;
      const big = f.narrow ? 1.6 : 1;
      for (const d of drones) {
        if (d.home === 1 && d.job === 0 && Math.hypot(d.x, d.y - (socTop - 0.4), d.z) < 0.8) continue;
        pts.add(d.x, d.y, d.z, 0.13 * big, CYAN, 2.8);
        pts.add(d.x - d.vx * 0.035, d.y - d.vy * 0.035, d.z - d.vz * 0.035, 0.09 * big, CYAN, 1.3);
        pts.add(d.x - d.vx * 0.07, d.y - d.vy * 0.07, d.z - d.vz * 0.07, 0.07 * big, CYAN, 0.6);
      }
      for (const sw of swarms)
        for (const fo of sw.foes) {
          if (!fo.alive) continue;
          pts.add(fo.x, fo.y, fo.z, 0.12 * big, RED, 2.8 + Math.sin(t * 19 + fo.a0 * 7));
          pts.add(fo.x - fo.vx * 0.04, fo.y - fo.vy * 0.04, fo.z - fo.vz * 0.04, 0.08 * big, RED, 1.3);
          pts.add(fo.x - fo.vx * 0.08, fo.y - fo.vy * 0.08, fo.z - fo.vz * 0.08, 0.07 * big, RED, 0.6);
        }
      for (let i = 0; i < ntr; i++) {
        const o = i * 8;
        const c = tr[o + 7]! > 0.5 ? RED : CYAN;
        for (let k = 0; k < 3; k++) pts.add(tr[o]! - tr[o + 3]! * 0.012 * k, tr[o + 1]! - tr[o + 4]! * 0.012 * k, tr[o + 2]! - tr[o + 5]! * 0.012 * k, 0.05 * big, c, 2.6 - k * 0.7);
      }
      for (let i = 0; i < nwr; i++) {
        const o = i * 8;
        pts.add(wr[o]!, wr[o + 1]!, wr[o + 2]!, 0.09 * big, AMBER, 2.4);
        for (let k = 1; k < 5; k++) pts.add(wr[o]! - wr[o + 3]! * 0.05 * k, wr[o + 1]! - wr[o + 4]! * 0.05 * k, wr[o + 2]! - wr[o + 5]! * 0.05 * k, 0.07 * big, RED, 1.4 - k * 0.25);
      }
      for (let i = 0; i < nsp; i++) {
        const o = i * 8;
        pts.add(sp[o]!, sp[o + 1]!, sp[o + 2]!, 0.05 * big, SPARK_C[sp[o + 7]!]!, 3 * Math.min(1, sp[o + 6]! * 2.5));
      }

      // uniforms: takeovers, domes, streaks, flashes
      uHot.fill(0);
      uHotS.fill(0);
      let hi = 0;
      for (let k = 0; k < named.length && hi < NHOT; k++) {
        const r = repairOf[k];
        if (!r) continue;
        const tw = named[k]!;
        const tb = (t - r.t0) * war;
        const floors = Math.ceil(tw.h / FH);
        // red floor by floor from the roof down, then rebuilt floor by floor from the street up
        const down = Math.floor(Math.min(1, tb / 2.4) * floors);
        const up = tb < 3.2 ? 0 : Math.floor(Math.min(1, (tb - 3.2) / 3.8) * floors);
        uHot.set([tw.i, tw.j, tw.h - down * FH, up * FH], hi * 4);
        uHotS.set([tb < 3.2 ? 1 : 0.6, 1, 0, 0], hi * 4);
        hi++;
      }
      uDome.fill(0);
      uDomeS.fill(0);
      let di = 0;
      for (const m of meteors) {
        if (m.ev?.fate !== "blocked" || di >= NDOME) continue;
        const tw = named[m.tower]!;
        const age = t - (m.t0 + m.dur * m.uEnd);
        if (age < -0.45) continue;
        uDome.set([tw.x, tw.h, tw.z, Math.max(tw.hx, tw.hz) * 1.55], di * 4);
        uDomeS.set([0, 1, 0, age], di * 4);
        di++;
      }
      for (const dm of domes) {
        if (di >= NDOME) break;
        const age = t - dm.t1;
        if (age > 1.6) continue;
        const tw = named[dm.tower]!;
        const l = Math.hypot(dm.dir[0], dm.dir[1], dm.dir[2]) || 1;
        uDome.set([tw.x, tw.h, tw.z, Math.max(tw.hx, tw.hz) * 1.55], di * 4);
        uDomeS.set([dm.dir[0] / l, dm.dir[1] / l, dm.dir[2] / l, age], di * 4);
        di++;
      }
      uMetA.fill(0);
      uMetB.fill(0);
      let mi = 0;
      for (const m of meteors) {
        const u = Math.min(m.uEnd, (t - m.t0) / m.dur);
        if (u < 0) continue;
        metAt(m, u, tmp);
        const hx = tmp[0];
        const hy = tmp[1];
        const hz = tmp[2];
        metAt(m, Math.max(0, u - 0.28), tmp);
        if (mi < NMET) {
          uMetA.set([tmp[0], tmp[1], tmp[2], Math.min(1, (t - m.t0) / 0.2)], mi * 4);
          uMetB.set([hx, hy, hz, 0], mi * 4);
          mi++;
        } else {
          // more in flight than the shader takes: the rest as point streaks
          for (let k = 0; k < 10; k++) {
            const u2 = Math.max(0, u - k * 0.025);
            metAt(m, u2, tmp);
            pts.add(tmp[0], tmp[1], tmp[2], 0.08 * big, k ? RED : WHITE, 3 - k * 0.25);
          }
        }
      }
      uFx.fill(-1);
      uFxC.fill(0);
      fx.forEach((e, i) => {
        const age = t - e.t0;
        if (age > 1.6) return;
        uFx.set([e.x, e.y, e.z, age], i * 4);
        uFxC.set([e.c[0]!, e.c[1]!, e.c[2]!, e.size], i * 4);
      });
      let skyGlow = 0;
      let sdx = 0;
      let sdz = 1;
      for (const sw of swarms) {
        const age = t - sw.t0;
        skyGlow = Math.max(skyGlow, Math.min(1, age / 1) * Math.max(0, 1 - Math.max(0, age - 6) / 3));
        sdx = sw.dx;
        sdz = sw.dz;
      }

      setCam(set, cam);
      if (tex) set.tex("uCity", 3, tex);
      set.v4v("uHot", uHot);
      set.v4v("uHotS", uHotS);
      set.v4v("uDome", uDome);
      set.v4v("uDomeS", uDomeS);
      set.v4v("uMetA", uMetA);
      set.v4v("uMetB", uMetB);
      set.v4v("uFx", uFx);
      set.v4v("uFxC", uFxC);
      set.v4("uRadar", (radarPh % 1) * 22, ((radarPh + 0.5) % 1) * 22, 1, level);
      set.v4("uSky", sdx, sdz, skyGlow, flow);
      set.f("uDetail", f.narrow ? 0.7 : 1);
      set.points(pts.data, pts.n, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      const out: Label[] = [];
      const t = f.t;
      named.forEach((tw, k) => {
        const r = repairOf[k];
        const shown = k === SOC || r || (label.get(k) ?? -1) > t;
        if (!shown) return;
        const p = projectPoint([tw.x, tw.h + (k === SOC ? 2.1 : 0.5), tw.z], cam, f);
        if (!p || p.x < f.width * 0.42 || p.x > f.width - 40 || p.y < 14 || p.y > f.height - 12) return;
        const tb = r ? (t - r.t0) * (1 + 0.25 * director.level(t)) : 0;
        const text = r ? `[ ${tw.name} · ${tb < 3.2 ? "taken over" : "rebuilding"} ]` : `[ ${tw.name} ]`;
        out.push({ text, x: p.x, y: p.y - 20, tone: r ? (tb < 3.2 ? "hot" : "accent") : k === SOC ? "accent" : "dim", anchor: "middle" });
      });
      for (const sw of swarms) {
        if (sw.cleared > 0) continue;
        let x = 0;
        let y = 0;
        let z = 0;
        let n = 0;
        for (const fo of sw.foes)
          if (fo.alive) {
            x += fo.x;
            y += fo.y;
            z += fo.z;
            n++;
          }
        if (!n) continue;
        const p = projectPoint([x / n, y / n + 1.5, z / n], cam, f);
        if (p && p.x > f.width * 0.42 && p.x < f.width - 50 && p.y > 14 && p.y < f.height - 12) out.push({ text: `[ hostile swarm · ${n} ]`, x: p.x, y: p.y - 16, tone: "hot", anchor: "middle" });
      }
      return declutter(out, f.width);
    },
    dispose(gl) {
      if (tex) gl.deleteTexture(tex);
    },
  };
}
