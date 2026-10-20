import type { ThreatIntel } from "@/lib/threatIntel";
import { POINT_STRIDE, projectPoint, type Cam, type GlyphController, type V3 } from "../engine";
import type { FeedEvent } from "../feed";
import { WaveDirector } from "./director";
import { AMBER, CYAN, RED, setCam, WHITE, type Emit } from "./kit";

/** the hologram's map plane (world y) and its radius */
const HB = 0.3;
const RM = 2.85;
/** the table: glass radius, rim top outer edge, outer wall, projector ring */
const RG = 3.7;
const RT = 4.15;
const RO = 4.3;
const RE = 3.93;
/** rim top, foot of the bevel, foot of the wall, pedestal radius, floor */
const YT = 0.07;
const YC = -0.03;
const YB = -0.45;
const RP = 2.4;
const YF = -2.6;
/** floor height on the hologram's buildings */
const FH = 0.3;
const NS = 10;
const ND = 4;
const NFX = 8;
/** the defensive line's radius from the core */
const DL = 1.6;

const g3 = (v: number) => v.toFixed(3);

/**
 * One system of the AI estate as a hologram on the map: its parts become
 * GLSL calls (unrolled, so the compiler sees constants), and the scene keeps
 * its footprint, its roof (where attacks land) and its shield's radius.
 */
class Site {
  /** opaque parts (walls and roofs) and the lines and glass drawn over them, as GLSL calls */
  solids: string[] = [];
  lines: string[] = [];
  r = 0;
  top = HB;
  constructor(
    readonly sid: number,
    readonly name: string,
    readonly x: number,
    readonly z: number,
    readonly ang: number,
    /** roof height above the map, where attacks land */
    readonly body: number,
    /** shield dome radius */
    readonly dome: number,
  ) {}
  private at(lx: number, lz: number): [number, number] {
    const c = Math.cos(this.ang);
    const s = Math.sin(this.ang);
    return [this.x + c * lx - s * lz, this.z + s * lx + c * lz];
  }
  private grow(lx: number, lz: number, rr: number, y1: number) {
    this.r = Math.max(this.r, Math.hypot(lx, lz) + rr);
    this.top = Math.max(this.top, HB + y1);
  }
  private seed() {
    return this.sid * 7.31 + (this.solids.length + this.lines.length) * 1.93;
  }
  box(lx: number, lz: number, y0: number, y1: number, hx: number, hz: number, a = 0) {
    const [x, z] = this.at(lx, lz);
    this.solids.push(`sBox(ro, rd, pa, vec2(${g3(x)}, ${g3(z)}), ${g3(this.ang + a)}, vec2(${g3(hx)}, ${g3(hz)}), ${g3(HB + y0)}, ${g3(HB + y1)}, ${this.sid}, ${g3(this.seed())}, tS, cS);`);
    this.grow(lx, lz, Math.hypot(hx, hz), y1);
    return this;
  }
  cyl(lx: number, lz: number, y0: number, y1: number, r: number, m = 12) {
    const [x, z] = this.at(lx, lz);
    this.solids.push(`sCyl(ro, rd, pa, vec2(${g3(x)}, ${g3(z)}), ${g3(r)}, ${g3(HB + y0)}, ${g3(HB + y1)}, ${m.toFixed(1)}, ${this.sid}, ${g3(this.seed())}, tS, cS);`);
    this.grow(lx, lz, r, y1);
    return this;
  }
  sph(lx: number, lz: number, y: number, r: number, core: number, hemi = false) {
    const [x, z] = this.at(lx, lz);
    this.lines.push(`col += hSph(ro, rd, tMax, pa, vec3(${g3(x)}, ${g3(HB + y)}, ${g3(z)}), ${g3(r)}, ${g3(core)}, ${hemi ? "1." : "0."}, ${this.sid});`);
    this.grow(lx, lz, r, y + r);
    return this;
  }
  mast(lx: number, lz: number, y0: number, y1: number) {
    const [x, z] = this.at(lx, lz);
    this.lines.push(`col += hMast(ro, rd, tMax, pa, vec3(${g3(x)}, ${g3(HB + y0)}, ${g3(z)}), ${g3(HB + y1)}, ${this.sid}, ${g3(this.seed() * 0.13)});`);
    this.grow(lx, lz, 0.05, y1);
    return this;
  }
  ring(lx: number, lz: number, y: number, r: number, spin: number) {
    const [x, z] = this.at(lx, lz);
    this.lines.push(`col += hRing(ro, rd, tMax, pa, vec3(${g3(x)}, ${g3(HB + y)}, ${g3(z)}), ${g3(r)}, ${g3(spin)}, ${this.sid});`);
    this.grow(lx, lz, r, y);
    return this;
  }
  spire(lx: number, lz: number, y0: number, y1: number, r: number, n: number) {
    const [x, z] = this.at(lx, lz);
    this.lines.push(`col += hSpire(ro, rd, tMax, pa, vec3(${g3(x)}, ${g3(HB + y0)}, ${g3(z)}), ${g3(HB + y1)}, ${g3(r)}, ${n.toFixed(1)}, ${this.sid});`);
    this.grow(lx, lz, r, y1);
    return this;
  }
}

/** The estate: the core in the middle, the feed's targets round it, each with its own silhouette. */
function buildSites(): Site[] {
  const core = new Site(0, "core", 0.0, 0.0, 0, 1.55, 1.45)
    .cyl(0, 0, 0, 1.2, 0.46, 8)
    .sph(0, 0, 1.55, 0.34, 1)
    .ring(0, 0, 1.55, 0.62, -0.6)
    .spire(0, 0, 1.2, 2.5, 0.42, 6)
    .mast(0, 0, 2.5, 2.9);
  // tools: a hub on a diamond plinth bristling with connectors
  const mcp = new Site(1, "MCP / tools", 1.06, 0.88, 0.785, 0.95, 1.0).box(0, 0, 0, 0.45, 0.32, 0.32).cyl(0, 0, 0.45, 0.95, 0.17, 6);
  for (const [a, b] of [
    [0.22, 0.22],
    [-0.22, 0.22],
    [0.22, -0.22],
    [-0.22, -0.22],
  ] as const)
    mcp.mast(a, b, 0.45, 0.72);
  mcp.sph(0, 0, 1.05, 0.11, 0.6);
  const gpt = new Site(2, "ChatGPT", -0.92, 1.1, 0, 1.0, 1.05).cyl(0, 0, 0, 1.0, 0.3, 8).sph(0, 0, 1.0, 0.21, 0.7, true);
  const claude = new Site(3, "Claude", 0.88, -1.1, 0.3, 1.3, 1.15).box(0, 0, 0, 0.55, 0.29, 0.24).box(0, 0, 0.55, 1.0, 0.22, 0.18).box(0, 0, 1.0, 1.3, 0.13, 0.11).mast(0, 0, 1.3, 1.6);
  const copilot = new Site(4, "Copilot", -1.14, -0.79, -0.45, 0.98, 0.95).box(0, 0, 0, 0.8, 0.32, 0.2).box(0, 0.34, 0, 0.4, 0.15, 0.12).cyl(0, 0, 0.8, 0.98, 0.1, 6).mast(0, 0, 0.98, 1.25);
  // twins and a skybridge
  const gemini = new Site(5, "Gemini", 2.16, -0.26, 0.2, 1.15, 1.0).box(-0.16, 0, 0, 1.15, 0.1, 0.1).box(0.16, 0, 0, 0.95, 0.1, 0.1).box(0, 0, 0.62, 0.7, 0.06, 0.045).mast(-0.16, 0, 1.15, 1.38);
  // rows of racks with their fans, and the weights glowing between them
  const llm = new Site(6, "self-hosted LLM", -1.63, -1.58, 0.7, 0.42, 0.65).box(0, -0.13, 0, 0.42, 0.4, 0.13).box(0, 0.16, 0, 0.32, 0.4, 0.1).sph(0, 0.16, 0.45, 0.1, 0.5);
  const apps = new Site(7, "internal AI apps", 0.48, 2.11, 0.2, 0.8, 0.85).box(-0.13, -0.06, 0, 0.62, 0.11, 0.11, 0.1).box(0.14, -0.09, 0, 0.42, 0.1, 0.1, 0.4).box(0, 0.15, 0, 0.8, 0.09, 0.09, 0.25).mast(0, 0.15, 0.8, 1.02);
  const people = new Site(8, "employees", -1.94, 1.14, -0.3, 0.52, 0.65).box(0, 0, 0, 0.3, 0.42, 0.22).box(0, 0, 0.3, 0.52, 0.22, 0.22).cyl(0, 0, 0.52, 0.62, 0.09, 6);
  // the cloud models: a dome with an uplink
  const cloud = new Site(9, "cloud models", -0.13, -2.24, 0, 0.38, 0.8).sph(0, 0, 0, 0.38, 0.5, true).ring(0, 0, 0.62, 0.2, 1.2).mast(0, 0, 0.38, 1.05);
  return [core, mcp, gpt, claude, copilot, gemini, llm, apps, people, cloud];
}

/** The feed's targets and the site that stands for each. */
const TARGET_SITE: Record<string, number> = {
  "the core": 0,
  "MCP / tools": 1,
  ChatGPT: 2,
  Claude: 3,
  Copilot: 4,
  Gemini: 5,
  "self-hosted LLM": 6,
  "internal AI apps": 7,
  employees: 8,
  Bedrock: 9,
  "Meta AI": 9,
  Mistral: 9,
  Grok: 9,
  "Apple AI": 9,
};

/** data links between sites */
const LINKS: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 5],
  [1, 7],
  [2, 8],
  [4, 6],
  [3, 9],
  [3, 5],
  [2, 7],
];
const NL = LINKS.length;

function makeFrag(sites: Site[]): string {
  const linkEnds = LINKS.map(([a, b]) => {
    const A = sites[a]!;
    const B = sites[b]!;
    const dx = B.x - A.x;
    const dz = B.z - A.z;
    const l = Math.hypot(dx, dz);
    const ux = dx / l;
    const uz = dz / l;
    const ra = A.r + 0.1;
    const rb = B.r + 0.1;
    return `vec4(${g3(A.x + ux * ra)}, ${g3(A.z + uz * ra)}, ${g3(B.x - ux * rb)}, ${g3(B.z - uz * rb)})`;
  });
  const sitePos = sites.map((s) => `vec4(${g3(s.x)}, ${g3(s.z)}, ${g3(s.r)}, ${g3(s.top)})`);
  const block = (s: Site, parts: string[]) => (parts.length ? `  if(bound(ro, rd, vec2(${g3(s.x)}, ${g3(s.z)}), ${g3(s.r + 0.06)}, ${g3(s.top + 0.08)}, tMax)){\n    ${parts.join("\n    ")}\n  }` : "");
  const solids = sites.map((s) => block(s, s.solids)).join("\n");
  const lines = sites.map((s) => block(s, s.lines)).join("\n");
  return `
uniform vec3 uEye;
uniform vec3 uTarget;
uniform vec4 uS[${NS}];
uniform vec4 uLink[${NL}];
uniform vec4 uDome[${ND}];
uniform vec4 uDomeS[${ND}];
uniform vec4 uFx[${NFX}];
uniform vec4 uFxC[${NFX}];
uniform vec4 uRadar;
uniform vec4 uHolo;
uniform vec4 uAlarm;
uniform float uDetail;

const vec3 CY = vec3(.35, .85, 1.);
const vec3 CYE = vec3(.6, .95, 1.);
const vec3 AM = vec3(1., .66, .3);
const vec3 RD = vec3(1., .22, .14);
const vec3 RDE = vec3(1., .42, .28);
const float HB = ${g3(HB)};
const float RM = ${g3(RM)};
const float RG = ${g3(RG)};
const float RT = ${g3(RT)};
const float RO = ${g3(RO)};
const float RE = ${g3(RE)};
const float YT = ${g3(YT)};
const float YC = ${g3(YC)};
const float YB = ${g3(YB)};
const float RP = ${g3(RP)};
const float YF = ${g3(YF)};
const float FH = ${g3(FH)};
const vec4 LK[${NL}] = vec4[${NL}](${linkEnds.join(", ")});
const vec4 SP[${NS}] = vec4[${NS}](${sitePos.join(", ")});

/** a line of half-width w at distance d, box-filtered over a pixel footprint fp (thin lines dim instead of flickering) */
float cover(float d, float w, float fp){ fp = max(fp, 1e-4); return clamp((min(d + fp*.5, w) - max(d - fp*.5, -w))/fp, 0., 1.); }
/** a line about one scene pixel wide */
float ln(float d, float fp){ return cover(d, fp*.6, fp); }
/** a line's pixel footprint on a horizontal plane, for a line whose in-plane normal is n (foreshortened along the view) */
float fpOn(vec2 n, vec2 vh, float fp, float sy){ float a = dot(n, vh), b = dot(n, vec2(-vh.y, vh.x)); return fp*sqrt(a*a/(sy*sy) + b*b); }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.); return length(pa - ba*h); }
/** distance to the nearest edge of a hexagonal grid with cells one unit across the flats */
float hexEdge(vec2 p){
  const vec2 s = vec2(1., 1.7320508);
  vec4 c = floor(vec4(p, p - vec2(.5, 1.))/s.xyxy) + .5;
  vec4 h = vec4(p - c.xy*s, p - (c.zw + .5)*s);
  vec2 q = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
  q = abs(q);
  return .5 - max(dot(q, s*.5), q.x);
}
/** distance to the lit segments of a seven-segment digit in a box 1 wide and 1.6 tall */
float digit(vec2 p, int d){
  int b = d == 0 ? 63 : d == 1 ? 6 : d == 2 ? 91 : d == 3 ? 79 : d == 4 ? 102 : d == 5 ? 109 : d == 6 ? 125 : d == 7 ? 7 : d == 8 ? 127 : 111;
  float m = 9.;
  if((b & 1) != 0) m = min(m, sdSeg(p, vec2(-.4, .8), vec2(.4, .8)));
  if((b & 2) != 0) m = min(m, sdSeg(p, vec2(.4, .8), vec2(.4, 0.)));
  if((b & 4) != 0) m = min(m, sdSeg(p, vec2(.4, 0.), vec2(.4, -.8)));
  if((b & 8) != 0) m = min(m, sdSeg(p, vec2(-.4, -.8), vec2(.4, -.8)));
  if((b & 16) != 0) m = min(m, sdSeg(p, vec2(-.4, -.8), vec2(-.4, 0.)));
  if((b & 32) != 0) m = min(m, sdSeg(p, vec2(-.4, 0.), vec2(-.4, .8)));
  if((b & 64) != 0) m = min(m, sdSeg(p, vec2(-.4, 0.), vec2(.4, 0.)));
  return m;
}

/** the hologram's own life: interference bands sliding up, a brighter band now and then, the projector's flicker */
float holoMod(float y){
  float b = .7 + .3*smoothstep(-.3, .3, sin((y - uTime*.14)*7.));
  float s = exp(-pow((fract(y*.28 - uTime*.06) - .5)*12., 2.));
  return (b + s*.6)*uHolo.x;
}
/** a site's state at height y: red while taken over (cleared below the restore scan), glitch, the scan's own glow */
vec3 st(int sid, float y){
  vec4 S = uS[sid];
  float red = S.x;
  float scan = 0.;
  if(S.z > -.5){ red *= step(S.z, y); scan = exp(-pow((y - S.z)/.04, 2.)); }
  return vec3(red, S.y*red, scan);
}
float jitter(float y, float seed, float g){ return (hash12(vec2(floor(y*14.), floor(uTime*14.) + seed)) - .5)*g; }
float dropout(float g, float seed){ return 1. - .6*g*step(.5, hash12(vec2(floor(uTime*17.), seed))); }

/** a line about two scene pixels wide (one glyph cell) */
float ln2(float d, float fp){ return cover(d, fp*.9, fp); }
/** the hologram's walls are lit from one side, so each structure shows a bright and a darker face */
float wallShade(vec2 n){ return .8 + .3*dot(n, vec2(-.57, -.82)); }

/**
 * The structures are glowing solids: the nearest face wins, so the far ones
 * never pile up into one mass of glyphs behind the near ones. Walls glow at a
 * middle level (whole glyphs: a dim fill only ever turns into a carpet of
 * dots), roofs brighter and the edges brightest; floor seams stripe the walls
 * and a few windows burn white or amber. ek scales the vertical edges (a box's
 * corners; a cylinder has none).
 */
vec3 wall(vec3 p, float u, float hw, float y0, float y1, float shade, float ek, float fp, int sid, float seed){
  vec3 S = st(sid, p.y);
  vec3 base = mix(CY, RD, S.x), edge = mix(CYE, RDE, S.x);
  float fy = (p.y - y0)/FH;
  float fi = floor(fy);
  float gx = (u + hw)/.12;
  float h = hash12(vec2(floor(gx), fi) + seed);
  float win = step(abs(fract(fy) - .5), .17)*step(.3, fract(gx))*step(fract(gx), .7)*step(.9, h);
  vec3 lc = mix(h > .95 ? AM*2. : vec3(.8, 1., 1.)*1.6, RD*2., S.x);
  float floors = ln2(abs(fract(fy + .5) - .5)*FH, fp)*step(FH*.5, p.y - y0)*step(FH*.4, y1 - p.y);
  return base*(.025*shade + floors*.5*shade) + edge*(ln2(hw - abs(u), fp)*.95*ek + ln2(y1 - p.y, fp)*1.1) + lc*win*uDetail;
}
vec3 roof(float de, float fp, int sid, float y){
  vec3 S = st(sid, y);
  return mix(CY, RD, S.x)*.05 + mix(CYE, RDE, S.x)*ln2(de, fp)*1.1;
}
vec3 finish(vec3 col, float y, int sid, float seed){
  vec3 S = st(sid, y);
  col += vec3(.7, 1., 1.)*S.z*2.5;
  return col*holoMod(y)*dropout(S.y, seed);
}
void sBox(vec3 ro, vec3 rd, float pa, vec2 c, float ang, vec2 hs, float y0, float y1, int sid, float seed, inout float tS, inout vec3 cS){
  mat2 m = rot2(-ang);
  vec3 o = vec3(m*(ro.xz - c), ro.y).xzy;
  vec3 d = vec3(m*rd.xz, rd.y).xzy;
  vec3 inv = 1./d;
  vec3 t0 = (vec3(-hs.x, y0, -hs.y) - o)*inv, t1 = (vec3(hs.x, y1, hs.y) - o)*inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
  if(a >= b || a <= 0. || a >= tS) return;
  tS = a;
  vec3 p = o + d*a;
  float fp = a*pa;
  float jit = jitter(p.y, seed, .12*st(sid, p.y).y);
  if(a == tn.y) cS = roof(min(hs.x - abs(p.x + jit), hs.y - abs(p.z)), fp, sid, p.y);
  else {
    bool xf = a == tn.x;
    vec2 nl = xf ? vec2(-sign(d.x), 0.) : vec2(0., -sign(d.z));
    cS = wall(p, (xf ? p.z : p.x) + jit, xf ? hs.y : hs.x, y0, y1, wallShade(rot2(ang)*nl), 1., fp, sid, seed);
  }
  cS = finish(cS, p.y, sid, seed);
}
void sCyl(vec3 ro, vec3 rd, float pa, vec2 c, float r, float y0, float y1, float nm, int sid, float seed, inout float tS, inout vec3 cS){
  vec2 oc = ro.xz - c;
  float a = dot(rd.xz, rd.xz), b = dot(oc, rd.xz), cc = dot(oc, oc) - r*r;
  float h = b*b - a*cc;
  if(h < 0.) return;
  h = sqrt(h);
  float s0 = (-b - h)/a, s1 = (-b + h)/a;
  float ya = (y0 - ro.y)/rd.y, yb = (y1 - ro.y)/rd.y;
  float c0 = min(ya, yb), c1 = max(ya, yb);
  float tn = max(s0, c0), tf = min(s1, c1);
  if(tn >= tf || tn <= 0. || tn >= tS) return;
  tS = tn;
  vec3 p = ro + rd*tn;
  float fp = tn*pa;
  vec2 q = p.xz - c;
  if(s0 > c0){
    vec2 n = q/r;
    // brighter where the side turns away: a glassy silhouette
    float fr = pow(1. - abs(dot(vec3(n.x, 0., n.y), rd)), 3.);
    float an = atan(q.y, q.x) + jitter(p.y, seed, .5*st(sid, p.y).y);
    float hw = PI*r/nm;
    float u = fract(an*nm/(2.*PI))*2.*hw - hw;
    cS = wall(p, u, hw, y0, y1, wallShade(n), .0, fp, sid, seed) + mix(CYE, RDE, st(sid, p.y).x)*fr*.9;
  } else cS = roof(r - length(q), fp, sid, p.y);
  cS = finish(cS, p.y, sid, seed);
}
/** a glass shell (a dome when hemi) with a data core inside: white-hot with an amber heart */
vec3 hSph(vec3 ro, vec3 rd, float tMax, float pa, vec3 c, float r, float core, float hemi, int sid){
  vec3 S0 = st(sid, c.y);
  vec3 col = vec3(0.);
  vec3 base = mix(CY, RD, S0.x), edge = mix(CYE, RDE, S0.x);
  vec2 h = sphIsect(ro, rd, c, r);
  if(h.y > 0. && h.x < tMax){
    for(int k = 0; k < 2; k++){
      float th = k == 0 ? h.x : h.y;
      if(th <= 0. || th >= tMax) continue;
      vec3 p = ro + rd*th;
      if(hemi > .5 && p.y < c.y) continue;
      vec3 n = (p - c)/r;
      float fr = pow(1. - abs(dot(n, rd)), 2.5);
      float lat = asin(clamp(n.y, -1., 1.)), lon = atan(n.z, n.x) + uTime*.25;
      float fp = th*pa/r;
      float grid = ln(abs(fract(lat*6./PI + .5) - .5)*PI/6., fp)*.35 + ln(abs(fract(lon*4./PI + .5) - .5)*PI/4.*cos(lat), fp)*.3;
      float eq = hemi > .5 ? ln(n.y, fp)*.9 : 0.;
      col += (edge*(pow(fr, 1.6)*.85 + eq*.6) + base*(grid*.3 + .01))*(k == 0 ? 1. : .4)*holoMod(p.y);
    }
  }
  if(core > 0. && dot(c - ro, rd) < tMax){
    float pulse = .8 + .2*sin(uTime*2.3 + c.x*3.);
    float cr = max(r*.22, dot(c - ro, rd)*pa*.8);
    col += mix(vec3(1., .93, .8), vec3(1., .4, .25), S0.x)*pointGlow(ro, rd, c, cr)*2.8*core*pulse + mix(AM, RD, S0.x)*pointGlow(ro, rd, c, r*.6)*.45*core;
  }
  return col;
}
/** an antenna with a blinking tip */
vec3 hMast(vec3 ro, vec3 rd, float tMax, float pa, vec3 a, float y1, int sid, float seed){
  vec3 b = vec3(a.x, y1, a.z);
  float s;
  float d2 = segDist2(ro, rd, a, b, s);
  vec3 pc = a + (b - a)*s;
  float tc = dot(pc - ro, rd);
  if(tc > tMax) return vec3(0.);
  float w = max(.008, tc*pa*.55);
  vec3 S = st(sid, pc.y);
  vec3 col = mix(CYE, RDE, S.x)*exp(-d2/(w*w))*1.3;
  float bl = step(.6, fract(uTime*.7 + seed));
  col += mix(vec3(1., .85, .6), vec3(1., .3, .2), S.x)*pointGlow(ro, rd, b, max(.02, tc*pa*.7))*(.8 + 2.2*bl);
  return col*holoMod(pc.y);
}
/** a horizontal ring, dashed and turning */
vec3 hRing(vec3 ro, vec3 rd, float tMax, float pa, vec3 c, float r, float spin, int sid){
  float t = (c.y - ro.y)/rd.y;
  if(t <= 0. || t >= tMax) return vec3(0.);
  vec2 q = ro.xz + rd.xz*t - c.xz;
  float d = length(q);
  float fp = fpOn(q/max(d, 1e-4), normalize(rd.xz), t*pa, max(abs(rd.y), .15));
  float dr = abs(d - r);
  if(dr > fp*3.) return vec3(0.);
  float an = atan(q.y, q.x) + uTime*spin;
  float dash = .75 + .25*step(.3, fract(an*8./(2.*PI)));
  vec3 S = st(sid, c.y);
  return mix(CYE, RDE, S.x)*ln2(dr, fp)*dash*1.2*holoMod(c.y);
}
/** a wireframe spire: n slanted edges to the apex, and two collars */
vec3 hSpire(vec3 ro, vec3 rd, float tMax, float pa, vec3 b, float y1, float r, float n, int sid){
  vec3 apex = vec3(b.x, y1, b.z);
  vec3 col = vec3(0.);
  for(int k = 0; k < 6; k++){
    if(float(k) >= n) break;
    float a = float(k)*2.*PI/n + .3;
    vec3 p0 = b + vec3(cos(a)*r, 0., sin(a)*r);
    float s;
    float d2 = segDist2(ro, rd, p0, apex, s);
    vec3 pc = p0 + (apex - p0)*s;
    float tc = dot(pc - ro, rd);
    if(tc > tMax) continue;
    float w = max(.008, tc*pa*.55);
    vec3 S = st(sid, pc.y);
    col += (mix(CYE, RDE, S.x)*1.3 + vec3(.7, 1., 1.)*S.z*2.)*exp(-d2/(w*w))*holoMod(pc.y);
  }
  return col;
}
/** does the ray pass through a site's bounding cylinder before tMax */
bool bound(vec3 ro, vec3 rd, vec2 c, float r, float top, float tMax){
  vec2 oc = ro.xz - c;
  float a = dot(rd.xz, rd.xz), b = dot(oc, rd.xz), cc = dot(oc, oc) - r*r;
  float h = b*b - a*cc;
  if(h < 0.) return false;
  h = sqrt(h);
  float ya = (HB - .02 - ro.y)/rd.y, yb = (top - ro.y)/rd.y;
  float tn = max((-b - h)/a, min(ya, yb)), tf = min((-b + h)/a, max(ya, yb));
  return tn < tf && tf > 0. && tn < tMax;
}
/** the structures' solid parts: the nearest face, its colour in cS */
float holoSolids(vec3 ro, vec3 rd, float tMax, float pa, out vec3 cS){
  float tS = tMax;
  cS = vec3(0.);
${solids}
  return tS;
}
/** rings, antennae, spires and glass cores, added on top, hidden behind solids */
vec3 holoLines(vec3 ro, vec3 rd, float tMax, float pa){
  vec3 col = vec3(0.);
${lines}
  return col;
}

/** the physical table: glass, rim top, bevel, outer wall, inner lip, pedestal, floor */
float table(vec3 ro, vec3 rd, out int m, out vec3 n){
  float tb = 1e9;
  m = 0;
  n = vec3(0., 1., 0.);
  if(rd.y < 0.){
    float t = (YT - ro.y)/rd.y;
    float r = length(ro.xz + rd.xz*t);
    if(t > 0. && r >= RG && r <= RT){ tb = t; m = 2; }
    t = -ro.y/rd.y;
    r = length(ro.xz + rd.xz*t);
    if(t > 0. && r < RG && t < tb){ tb = t; m = 1; }
    t = (YF - ro.y)/rd.y;
    if(t > 0. && t < tb){ tb = t; m = 7; }
  }
  float a = dot(rd.xz, rd.xz), b = dot(ro.xz, rd.xz), c0 = dot(ro.xz, ro.xz);
  // the bevel: a cone from the rim top's outer edge down and out to the wall
  {
    float KB = (RO - RT)/(YT - YC), KA = RT + KB*YT;
    float gg = KA - KB*ro.y;
    float ca = a - KB*KB*rd.y*rd.y, cb = b + gg*KB*rd.y, cc = c0 - gg*gg;
    float h = cb*cb - ca*cc;
    if(h > 0.){
      h = sqrt(h);
      float t0 = (-cb - h)/ca, t1 = (-cb + h)/ca;
      float tA = min(t0, t1), tB = max(t0, t1);
      for(int k = 0; k < 2; k++){
        float t = k == 0 ? tA : tB;
        float y = ro.y + rd.y*t;
        if(t > 0. && t < tb && y <= YT && y >= YC){
          tb = t; m = 3;
          vec3 p = ro + rd*t;
          n = normalize(vec3(p.x/length(p.xz), KB, p.z/length(p.xz)));
          break;
        }
      }
    }
  }
  // the outer wall, the inner lip (seen from inside), the pedestal
  float h = b*b - a*(c0 - RO*RO);
  if(h > 0.){
    float t = (-b - sqrt(h))/a;
    float y = ro.y + rd.y*t;
    if(t > 0. && t < tb && y >= YB && y <= YC){ tb = t; m = 4; vec3 p = ro + rd*t; n = vec3(p.x, 0., p.z)/RO; }
  }
  h = b*b - a*(c0 - RG*RG);
  if(h > 0.){
    float t = (-b + sqrt(h))/a;
    float y = ro.y + rd.y*t;
    if(t > 0. && t < tb && y >= 0. && y <= YT){ tb = t; m = 5; vec3 p = ro + rd*t; n = -vec3(p.x, 0., p.z)/RG; }
  }
  h = b*b - a*(c0 - RP*RP);
  if(h > 0.){
    float t = (-b - sqrt(h))/a;
    float y = ro.y + rd.y*t;
    if(t > 0. && t < tb && y >= YF && y <= YB){ tb = t; m = 6; vec3 p = ro + rd*t; n = vec3(p.x, 0., p.z)/RP; }
  }
  return tb;
}

/** the radar pulse: a ring running out across the table, and the soft band behind it */
float radarRing(float r, float w){ return exp(-pow((r - uRadar.x)/w, 2.))*uRadar.y; }

vec3 shadeTable(int m, vec3 p, vec3 n, vec3 rd, float t, float pa){
  float fp = t*pa;
  float r = length(p.xz);
  float an = atan(p.z, p.x);
  float deg = an*180./PI;
  vec2 nr = p.xz/max(r, 1e-4);
  vec2 vh = normalize(rd.xz);
  float sy = max(-rd.y, .12);
  float fpr = fpOn(nr, vh, fp, sy), fpt = fpOn(vec2(-nr.y, nr.x), vh, fp, sy);
  vec3 H = vec3(0., HB + 1., 0.);
  vec3 Lh = normalize(H - p);
  float dh = length(H - p);
  float holoL = 1.3/(1. + dh*dh*.12);
  vec3 col = vec3(0.);
  if(m == 1){
    // the glass: black, the core's white-hot heart mirrored in it, and a fine grid that only shows as the radar ring sweeps it
    vec2 g = abs(fract(p.xz*2.5 + .5) - .5)*.4;
    float band = radarRing(r, .3);
    col = vec3(.002, .004, .008);
    col += vec3(.2, .45, .9)*(ln(g.x, fpOn(vec2(1., 0.), vh, fp, sy)) + ln(g.y, fpOn(vec2(0., 1.), vh, fp, sy)))*.7*band*step(RM + .05, r);
    col += CY*cover(abs(r - uRadar.x), max(.03, fpr*.9), fpr)*uRadar.y*1.2*step(RM, r);
    col += vec3(.8, .95, 1.)*pointGlow(p, reflect(rd, vec3(0., 1., 0.)), vec3(0., HB + 1.55, 0.), .1)*.9;
  } else if(m == 2){
    // the rim top: a band of lit steel with glowing engravings (ticks, bearing numbers) and eight dark projector housings
    col = vec3(.42, .55, .7)*.05;
    float rr0 = r - RG;
    float d30 = abs(fract(deg/30. + .5) - .5)*30.*PI/180.*r;
    float tk = ln2(d30, fpt)*step(.06, rr0)*step(rr0, .26);
    col += vec3(.6, .9, 1.)*tk*1.1;
    col += CYE*ln2(rr0, fpr)*1.2;
    // bearing numbers every 30 degrees
    float k30 = floor(deg/30. + .5);
    float brg = mod(k30*30. + 360., 360.);
    vec2 tp = vec2((deg - k30*30.)*PI/180.*r, rr0 - .35);
    if(abs(tp.x) < .14 && abs(tp.y) < .07 && fpt < .035){
      float ci = clamp(floor(tp.x/.085 + 1.5), 0., 2.);
      float dg = ci < .5 ? floor(brg/100.) : ci < 1.5 ? mod(floor(brg/10.), 10.) : mod(brg, 10.);
      vec2 lp = vec2(tp.x - (ci - 1.)*.085, tp.y)/.06;
      col += vec3(.6, .9, 1.)*ln(digit(lp, int(dg))*.06, min(fpr, fpt))*1.1;
    }
    // the projector housings, eight round the rim
    float ka = floor(an/(PI/4.));
    float ac = (ka + .5)*PI/4.;
    vec2 ep = vec2((an - ac)*r, r - RE);
    float bx = max(abs(ep.x) - .11, abs(ep.y) - .07);
    if(bx < 0.) col = vec3(.004, .006, .01);
  } else if(m == 3){
    // the bevel: polished, it catches the hologram as a bright line round the table
    vec3 rv = reflect(rd, n);
    float spec = pow(max(dot(rv, Lh), 0.), 8.)*holoL;
    col = vec3(.6, .78, .95)*(.85 + min(spec*1.5, .6));
  } else if(m == 4){
    // the outer wall: dark, a light strip with amber traffic running round, status lights
    col = vec3(.01, .014, .02);
    float strip = ln2(abs(p.y + .14), fp);
    float run = fract(an/(2.*PI)*5. - uTime*.04);
    col += CY*strip*1.5*(.8 + .2*sin(an*3. - uTime*.8)) + AM*strip*smoothstep(0., .015, run)*(1. - smoothstep(.015, .06, run))*3.;
    float cell = floor(deg/7.5);
    float hh = hash12(vec2(cell, 3.7));
    float lx = (fract(deg/7.5) - .5)*7.5*PI/180.*RO;
    float led = step(max(abs(lx - .08*(hh - .5)), abs(p.y + .31)*1.2), .035)*step(.55, hh);
    float on = step(.4, fract(uTime*(.15 + hh*.5) + hh*11.));
    col += mix(CY, AM, step(.8, hh))*led*on*2.;
  } else if(m == 5){
    // the inner lip faces the hologram
    col = CY*.55;
  } else if(m == 6){
    col = vec3(.004, .006, .01);
  } else if(m == 7){
    // the floor: near black, with the table's light strip mirrored in it
    col = vec3(.002, .003, .006);
    vec3 rr = vec3(rd.x, -rd.y, rd.z);
    float tt = (-.14 - p.y)/rr.y;
    float dq = abs(length(p.xz + rr.xz*tt) - RO);
    col += CY*cover(dq, max(.03, t*pa*.6), t*pa)*.9*smoothstep(7., 5., length(p.xz));
  }
  return col;
}

/** the hologram's map: its rim, a hex grid, contour lines of a terrain, pads, data links, our units' rings, the radar ring */
vec3 mapPlane(vec3 ro, vec3 rd, float tb, float pa, float hv, float hw){
  if(rd.y >= 0.) return vec3(0.);
  float t = (HB - ro.y)/rd.y;
  if(t <= 0. || t >= tb) return vec3(0.);
  vec2 q = ro.xz + rd.xz*t;
  float r = length(q);
  if(r > RM + .25) return vec3(0.);
  float fp = t*pa;
  float sy = max(-rd.y, .12);
  vec2 vh = normalize(rd.xz);
  vec2 nr = q/max(r, 1e-4);
  float fpr = fpOn(nr, vh, fp, sy);
  float an = atan(q.y, q.x);
  float hm = holoMod(HB);
  vec3 col = vec3(0.);
  // the alarm: the edge burns red where an enemy swarm pours in
  float al = (exp(-pow(1. - dot(nr, uAlarm.xy), 2.)*40.) + exp(-pow(1. - dot(nr, uAlarm.zw), 2.)*40.))*uHolo.y;
  vec3 ec = mix(CYE, RDE, clamp(al, 0., 1.));
  col += ec*cover(abs(r - RM), max(.03, fpr*.9), fpr)*1.1*hm;
  col += RD*al*.06*smoothstep(RM - .9, RM, r)*step(r, RM);
  if(r > RM) return col;
  float fade = smoothstep(RM, RM - .5, r);
  float band = radarRing(r, .35);
  // keep the map's own lines off the pads and the links
  float keep = 1.;
  float pool = 0.;
  vec3 poolC = vec3(0.);
  for(int i = 0; i < ${NS}; i++){
    vec4 P = SP[i];
    vec2 dq = q - P.xy;
    float d = length(dq);
    float red = uS[i].x;
    keep *= smoothstep(P.z - .05, P.z + .12, d);
    poolC += RD*cover(abs(d - P.z - .12), max(.025, fp*(.5 + .5/sy)*.9), fp*(.5 + .5/sy))*red*(1.1 + .5*sin(uTime*9.));
  }
  // data links: a line with amber traffic riding it; red where a takeover spreads, a cyan flash when it is cleared
  for(int i = 0; i < ${NL}; i++){
    vec4 L = LK[i];
    vec2 ba = L.zw - L.xy;
    float bl = length(ba);
    vec2 dir = ba/bl;
    float s = clamp(dot(q - L.xy, dir), 0., bl);
    float d = length(q - L.xy - dir*s);
    keep *= smoothstep(.04, .14, d);
    if(d > .12) continue;
    float fpl = fpOn(vec2(-dir.y, dir.x), vh, fp, sy);
    float mid = cover(d, max(.022, fpl*.9), fpl);
    float ph = fract(s*1.3 - uTime*.45*(mod(float(i), 2.) < .5 ? 1. : -1.) + float(i)*.37);
    float pk = smoothstep(0., .04, ph)*(1. - smoothstep(.04, .2, ph));
    vec4 S = uLink[i];
    float u = s/bl;
    float red = max(step(u, S.x)*step(.001, S.x), step(1. - S.y, u)*step(.001, S.y));
    float rp = fract(s*2.2 - uTime*2.5);
    vec3 c = vec3(.25, .55, 1.)*mid*.7 + AM*mid*pk*3.;
    c = mix(c, RD*mid*(.7 + 2.4*smoothstep(.0, .05, rp)*(1. - smoothstep(.05, .25, rp))), red);
    c += CYE*mid*S.z*2.;
    col += c*hm;
  }
  // a hex grid and the contour lines of a terrain: below sight until the radar ring passes and lights them
  float he = hexEdge(q/.42)*.42;
  col += vec3(.12, .3, .75)*ln(he, fp*(.6 + .4/sy))*.6*band*fade*keep;
  float cd = abs(fract(hv + .5) - .5);
  float cl = 1. - smoothstep(0., hw*1.2 + 1e-3, cd);
  float major = step(mod(floor(hv + .5), 3.), .5);
  col += vec3(.2, .45, .95)*cl*major*.6*band*keep*fade;
  col += poolC*hm;
  col += CY*cover(abs(r - uRadar.x), max(.03, fpr*.9), fpr)*uRadar.y*1.2;
  return col;
}

/** shield domes over the sites they protect: a lattice that flares and ripples from where it is hit */
vec3 domes(vec3 ro, vec3 rd, float tb){
  vec3 col = vec3(0.);
  for(int i = 0; i < ${ND}; i++){
    vec4 D = uDome[i];
    vec4 S = uDomeS[i];
    if(D.w <= 0.) continue;
    vec2 h = sphIsect(ro, rd, D.xyz, D.w);
    if(h.y < 0.) continue;
    float age = S.w;
    float a = smoothstep(-.5, -.05, age)*exp(-max(age, 0.)*1.6);
    for(int k = 0; k < 2; k++){
      float th = k == 0 ? h.x : h.y;
      if(th <= 0. || th > tb) continue;
      vec3 p = ro + rd*th;
      if(p.y < D.y) continue;
      vec3 nn = (p - D.xyz)/D.w;
      float fr = pow(1. - abs(dot(nn, rd)), 2.);
      float lat = asin(clamp(nn.y, -1., 1.)), lon = atan(nn.z, nn.x);
      float grid = max(pow(abs(sin(lat*5.)), 20.), pow(abs(sin(lon*7.)), 20.)*step(lat, 1.25));
      float ang = acos(clamp(dot(nn, S.xyz), -1., 1.));
      float rip = exp(-pow((ang - max(age, 0.)*2.6)/.16, 2.))*step(0., age);
      float hit = exp(-ang*ang/.05)*exp(-max(age, 0.)*4.)*step(0., age);
      float near = exp(-ang*ang/.35)*exp(-max(age, 0.)*1.5)*step(0., age);
      col += (CY*(pow(fr, 3.)*1.3 + grid*near*1.2) + vec3(.8, .95, 1.)*rip*2. + vec3(1.)*hit*3.5)*a*(k == 0 ? 1. : .45);
    }
  }
  return col;
}

/** the projectors: lenses on the rim, faint beams rising to where they meet in the core, and the glow there */
vec3 projectors(vec3 ro, vec3 rd, float tb, float pa){
  vec3 col = vec3(0.);
  vec3 C = vec3(0., HB + 1.55, 0.);
  for(int k = 0; k < 8; k++){
    float a = (float(k) + .5)*PI/4.;
    vec3 L = vec3(cos(a)*RE, YT + .05, sin(a)*RE);
    float fl = .8 + .2*sin(uTime*7.3 + float(k)*2.1);
    float s;
    float d2 = segDist2(ro, rd, L, C, s);
    vec3 pc = L + (C - L)*s;
    float w = max(.012 + .05*s, dot(pc - ro, rd)*pa*.5);
    col += CY*exp(-d2/(w*w))*pow(1. - s, 5.)*1.1*fl*step(dot(pc - ro, rd), tb)*uHolo.x;
    float tl = dot(L - ro, rd);
    if(tl < tb + .06) col += CYE*pointGlow(ro, rd, L, max(.02, tl*pa*.8))*2.2*fl + CY*pointGlow(ro, rd, L, .16)*.07;
  }
  return col;
}

vec3 flashes(vec3 ro, vec3 rd, float tb){
  vec3 col = vec3(0.);
  for(int i = 0; i < ${NFX}; i++){
    vec4 F = uFx[i];
    if(F.w < 0.) continue;
    vec3 oc = F.xyz - ro;
    float tt = dot(oc, rd);
    if(tt > tb + .5) continue;
    float d = length(oc - rd*tt);
    float sz = uFxC[i].a;
    float R = sz*(1. - exp(-F.w*5.));
    col += uFxC[i].rgb*(exp(-pow((d - R)/(.05*sz + .02), 2.))*exp(-F.w*3.)*1.4 + exp(-d*d/(.03*sz*sz + .004))*exp(-F.w*6.)*3.);
  }
  return col;
}

void main(){
  vec3 ro = uEye;
  vec3 rd = camRay(lookAt(ro, uTarget));
  float pa = 2.*uTan.y/uRes.y;
  // the terrain height on the map plane, for every pixel so its derivatives are sound
  float tm = (HB - ro.y)/min(rd.y, -1e-3);
  float hv = fbm3(vec3((ro.xz + rd.xz*tm)*.55, 2.3))*11.;
  float hw = fwidth(hv);
  int m;
  vec3 n;
  float tb = table(ro, rd, m, n);
  vec3 col = m > 0 ? shadeTable(m, ro + rd*tb, n, rd, tb, pa) : vec3(0.);
  float shimmer = .93 + .07*sin(gl_FragCoord.y*2.1 + uTime*23.);
  vec3 cS;
  float tS = holoSolids(ro, rd, tb, pa, cS);
  float tH = min(tb, tS);
  cS *= 1. - .6*uHolo.z;
  vec3 h = mapPlane(ro, rd, tH, pa, hv, hw) + cS + holoLines(ro, rd, tH + .02, pa)*(1. - .5*uHolo.z);
  col = tS < tb ? h*shimmer : col + h*shimmer;
  col += domes(ro, rd, tb);
  col += projectors(ro, rd, tb, pa);
  col += flashes(ro, rd, tb);
  outCol(col);
}
`;
}

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

/** A closed patrol route on the map, sampled densely (a Catmull-Rom loop through waypoints). */
class Route {
  xs: Float32Array;
  zs: Float32Array;
  cum: Float32Array;
  L = 0;
  constructor(way: [number, number][], per = 24) {
    const n = way.length;
    const m = n * per;
    this.xs = new Float32Array(m + 1);
    this.zs = new Float32Array(m + 1);
    this.cum = new Float32Array(m + 1);
    for (let i = 0; i < n; i++) {
      const p0 = way[(i - 1 + n) % n]!;
      const p1 = way[i]!;
      const p2 = way[(i + 1) % n]!;
      const p3 = way[(i + 2) % n]!;
      for (let k = 0; k < per; k++) {
        const u = k / per;
        const u2 = u * u;
        const u3 = u2 * u;
        const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
        this.xs[i * per + k] = cr(p0[0], p1[0], p2[0], p3[0]);
        this.zs[i * per + k] = cr(p0[1], p1[1], p2[1], p3[1]);
      }
    }
    this.xs[m] = this.xs[0]!;
    this.zs[m] = this.zs[0]!;
    for (let i = 1; i <= m; i++) this.cum[i] = this.cum[i - 1]! + Math.hypot(this.xs[i]! - this.xs[i - 1]!, this.zs[i]! - this.zs[i - 1]!);
    this.L = this.cum[m]!;
  }
  /** the point at arc length s (wrapping), into out */
  at(s: number, out: [number, number]) {
    const L = this.L;
    s = ((s % L) + L) % L;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const seg = this.cum[hi]! - this.cum[lo]! || 1;
    const u = (s - this.cum[lo]!) / seg;
    out[0] = this.xs[lo]! + (this.xs[hi]! - this.xs[lo]!) * u;
    out[1] = this.zs[lo]! + (this.zs[hi]! - this.zs[lo]!) * u;
    return out;
  }
}

const PATROL = 0;
const LINE = 1;
const REPAIR = 2;
const DEAD = 3;

interface Unit {
  x: number;
  z: number;
  vx: number;
  vz: number;
  sq: number;
  k: number;
  job: number;
  gx: number;
  gz: number;
  /** respawn time when DEAD */
  back: number;
  fire: number;
  heat: number;
}
interface Squad {
  route: Route;
  v: number;
  s0: number;
  n: number;
}
interface Icp {
  s: V3;
  c: V3;
  t0: number;
  t1: number;
}
interface Attack {
  ev: FeedEvent;
  st: number;
  s: V3;
  c: V3;
  e: V3;
  t0: number;
  dur: number;
  uEnd: number;
  done: boolean;
  icp: Icp | null;
}
interface Dome {
  st: number;
  t1: number;
  dir: V3;
}
interface Breach {
  st: number;
  t0: number;
  nb: { st: number; link: number; fromA: boolean; k: number }[];
  evs: FeedEvent[];
  crew: Unit[];
  done: boolean;
}
interface Foe {
  x: number;
  z: number;
  vx: number;
  vz: number;
  alive: boolean;
  /** group, and its slot in the V behind the leader (back along the way in, lat across it) */
  g: number;
  bk: number;
  lt: number;
  fire: number;
  leak: boolean;
  hop: number;
}
interface Group {
  dx: number;
  dz: number;
  line: Unit[];
}
interface Swarm {
  ev: FeedEvent;
  t0: number;
  groups: Group[];
  foes: Foe[];
  contact: number;
  leakAt: number;
  leakSt: number;
  leaked: boolean;
  pincer: boolean;
}
interface Tracer {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  t0: number;
  dur: number;
  red: boolean;
  foe: Foe | null;
  unit: Unit | null;
}

type Label = { text: string; x: number; y: number; tone?: string; anchor?: "start" | "middle" | "end" };
const TONE_RANK: Record<string, number> = { hot: 3, accent: 2, dim: 1 };

/** Labels that would overlap a more important one, or run off the right edge, are dropped (hot first). */
function declutter(items: Label[], width: number): Label[] {
  const sorted = [...items].sort((a, b) => (TONE_RANK[b.tone ?? ""] ?? 0) - (TONE_RANK[a.tone ?? ""] ?? 0));
  const boxes: [number, number, number, number][] = [];
  return sorted.filter((it) => {
    const w = it.text.length * 8.2 + 10;
    const x0 = it.anchor === "middle" ? it.x - w / 2 : it.anchor === "end" ? it.x - w : it.x;
    const box: [number, number, number, number] = [x0, it.y - 5, x0 + w, it.y + 19];
    if (box[2] > width - 6) return false;
    if (boxes.some((o) => o[0] < box[2] && box[0] < o[2] && o[1] < box[3] && box[1] < o[3])) return false;
    boxes.push(box);
    return true;
  });
}

const SPARK_C = [CYAN, RED, AMBER, WHITE];
const HOT: V3 = [1, 0.8, 0.62];
const FOE_C: V3 = [1, 0.32, 0.18];
const NSPARK = 420;
/** breach timeline (s after the hit): the spread starts, a link takes this long, our units come, the restore begins, the end */
const SPREAD0 = 0.5;
const SPREAD_DT = 1.0;
const CREW_AT = 0.7;
const R0 = 3.7;
const B_END = R0 + 2.3;

/**
 * Holographic war table: a dark command room round a heavy table with a
 * bevelled, engraved rim and a glass top, its eight projectors casting faint
 * beams that meet in a hologram of the company's AI estate. On the map stand
 * the systems the feed's attacks go for (Copilot, ChatGPT, Claude, Gemini,
 * MCP / tools, the self-hosted LLM and the rest) as cyan structures of
 * projected light (dark glass, bright edges and floors) linked by data lines
 * with amber traffic, and our defender units patrol between them in file. Attacks from the 90-day feed arc in from the rim onto
 * their target: a shield dome flares over it (blocked), or a unit fires an
 * interceptor that meets it in the air, or at the type's real harm rate it
 * lands: the structure turns red and glitches, the red runs down its links
 * to a neighbour or two, our units converge and a scan restores them. In each
 * war phase a red swarm pours in from the edge in a wedge or a pincer against
 * a defensive line, and the camera leans in over the table while it lasts.
 * A radar ring crosses the table now and then, lighting the glass's grid and
 * the map's terrain lines as it passes.
 */
export function warTable(o: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const director = new WaveDirector(o.intel, 131);
  // the scene's own dice, so the feed's sequence never depends on frame timing
  const rnd = mulberry(7131);
  const sites = buildSites();
  const frag = makeFrag(sites);
  const pts = new Pts(2600);

  // patrol routes: round the core, loops through the sites in threes and fours, the map's edge
  const loop = (ids: number[]): [number, number][] => {
    let cx = 0;
    let cz = 0;
    for (const i of ids) {
      cx += sites[i]!.x / ids.length;
      cz += sites[i]!.z / ids.length;
    }
    return ids.map((i) => {
      const s = sites[i]!;
      const dx = s.x - cx;
      const dz = s.z - cz;
      const l = Math.hypot(dx, dz) || 1;
      const off = s.r + 0.3;
      return [s.x + (dx / l) * off, s.z + (dz / l) * off];
    });
  };
  const circle = (r: number, n: number): [number, number][] => Array.from({ length: n }, (_, k) => [Math.cos((k / n) * Math.PI * 2) * r, Math.sin((k / n) * Math.PI * 2) * r]);
  const SQUADS: { way: [number, number][]; n: number; v: number }[] = [
    { way: circle(0.8, 12), n: 6, v: 0.15 },
    { way: loop([1, 5, 3]), n: 5, v: 0.19 },
    { way: loop([2, 7, 1]), n: 5, v: -0.19 },
    { way: loop([4, 8, 2]), n: 5, v: 0.18 },
    { way: loop([3, 9, 6, 4]), n: 5, v: -0.2 },
    { way: circle(2.55, 18), n: 6, v: -0.23 },
  ];
  let squads: Squad[] = [];
  let units: Unit[] = [];

  let attacks: Attack[] = [];
  let domes: Dome[] = [];
  let breaches: Breach[] = [];
  let swarm: Swarm | null = null;
  let tracers: Tracer[] = [];
  const fx: { x: number; y: number; z: number; t0: number; size: number; c: readonly number[] }[] = [];
  const flash = (x: number, y: number, z: number, t: number, c: readonly number[], size: number) => {
    fx.push({ x, y, z, t0: t, size, c });
    if (fx.length > NFX) fx.shift();
  };
  // sparks: x y z vx vy vz life colour
  const sp = new Float32Array(NSPARK * 8);
  let nsp = 0;
  const spark = (x: number, y: number, z: number, n: number, c: V3, speed: number) => {
    const ci = SPARK_C.indexOf(c);
    for (let k = 0; k < n; k++) {
      if (nsp >= NSPARK) return;
      const a = rnd() * Math.PI * 2;
      const el = (rnd() - 0.2) * 1.3;
      const v = speed * (0.35 + rnd() * 0.75);
      const o = nsp * 8;
      sp[o] = x;
      sp[o + 1] = y;
      sp[o + 2] = z;
      sp[o + 3] = Math.cos(a) * Math.cos(el) * v;
      sp[o + 4] = Math.sin(el) * v + 0.3;
      sp[o + 5] = Math.sin(a) * Math.cos(el) * v;
      sp[o + 6] = 0.4 + rnd() * 0.55;
      sp[o + 7] = ci < 0 ? 0 : ci;
      nsp++;
    }
  };
  const pulses: number[] = [];
  let nextPulse = 4.4;
  /** 0..1: the hologram dims to a tactical view while a swarm is on the table */
  let tact = 0;
  let cam: Cam = { eye: [0, 6, 10], target: [0, 0.8, 0] };
  /** screen right and away from the camera, flattened onto the table */
  const camR: [number, number] = [1, 0];
  const camF: [number, number] = [0, -1];
  const tagUntil = new Float32Array(NS);
  const tagName: string[] = sites.map((s) => s.name);
  const tmp: V3 = [0, 0, 0];
  const p2: [number, number] = [0, 0];

  // shader data
  const uS = new Float32Array(NS * 4);
  const uLink = new Float32Array(NL * 4);
  const uDome = new Float32Array(ND * 4);
  const uDomeS = new Float32Array(ND * 4);
  const uFx = new Float32Array(NFX * 4);
  const uFxC = new Float32Array(NFX * 4);

  const bez = (s: V3, c: V3, e: V3, u: number, out: V3) => {
    const w = 1 - u;
    out[0] = w * w * s[0] + 2 * w * u * c[0] + u * u * e[0];
    out[1] = w * w * s[1] + 2 * w * u * c[1] + u * u * e[1];
    out[2] = w * w * s[2] + 2 * w * u * c[2] + u * u * e[2];
    return out;
  };
  const slotOf = (u: Unit, t: number, out: [number, number]) => {
    const q = squads[u.sq]!;
    return q.route.at(q.s0 + q.v * t - u.k * 0.15 * Math.sign(q.v), out);
  };
  const initUnits = (narrow: boolean, t: number) => {
    squads = SQUADS.map((q, i) => ({ route: new Route(q.way), v: q.v, s0: i * 1.7, n: narrow ? Math.max(3, Math.round(q.n * 0.65)) : q.n }));
    units = [];
    squads.forEach((q, sq) => {
      for (let k = 0; k < q.n; k++) {
        const u: Unit = { x: 0, z: 0, vx: 0, vz: 0, sq, k, job: PATROL, gx: 0, gz: 0, back: 0, fire: 0, heat: 0 };
        slotOf(u, t, p2);
        u.x = p2[0];
        u.z = p2[1];
        units.push(u);
      }
    });
  };
  /** the nearest free patrol units to a point, taken off patrol for a job */
  const draft = (x: number, z: number, n: number, job: number) => {
    const free = units.filter((u) => u.job === PATROL).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    const out = free.slice(0, n);
    for (const u of out) u.job = job;
    return out;
  };
  const release = (list: Unit[]) => {
    for (const u of list) if (u.job !== DEAD) u.job = PATROL;
  };
  const kill = (u: Unit, t: number) => {
    spark(u.x, HB + 0.06, u.z, 8, CYAN, 1.1);
    u.job = DEAD;
    u.back = t + 5 + rnd() * 2;
  };

  /** where along an arc it first meets a site's shield dome (bisection) */
  const domeCut = (a: Attack, site: Site) => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      bez(a.s, a.c, a.e, mid, tmp);
      if (Math.hypot(tmp[0] - site.x, tmp[1] - HB, tmp[2] - site.z) > site.dome) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  const launch = (ev: FeedEvent, t: number, war: boolean) => {
    if (attacks.length >= 10) return;
    const st = TARGET_SITE[ev.target] ?? 0;
    const site = sites[st]!;
    // from the rim, on the far half or the right of the table as the camera sees it
    const b = -0.45 + rnd() * 2.6;
    const dx = camR[0] * Math.cos(b) + camF[0] * Math.sin(b);
    const dz = camR[1] * Math.cos(b) + camF[1] * Math.sin(b);
    const s: V3 = [dx * RE, YT + 0.08, dz * RE];
    const e: V3 = [site.x, HB + site.body, site.z];
    const dist = Math.hypot(e[0] - s[0], e[2] - s[2]);
    const flat = rnd() < 0.3;
    const lift = flat ? 0.5 + dist * 0.1 : 1.0 + dist * 0.22;
    const c: V3 = [(s[0] + e[0]) / 2, Math.max(s[1], e[1]) + lift, (s[2] + e[2]) / 2];
    const dur = ((flat ? 1.3 : 1.9) + rnd() * 0.6 + dist * 0.1) * (war ? 0.85 : 1);
    const a: Attack = { ev, st, s, c, e, t0: t, dur, uEnd: 1, done: false, icp: null };
    if (ev.fate === "blocked") a.uEnd = domeCut(a, site);
    else if (ev.fate === "intercepted") a.uEnd = 0.5 + rnd() * 0.2;
    attacks.push(a);
    tagUntil[st] = Math.max(tagUntil[st]!, t + dur + 1);
    if (st === 9) tagName[9] = ev.target;
  };

  const startBreach = (st: number, ev: FeedEvent, t: number) => {
    const old = breaches.find((b) => b.st === st && !b.done);
    if (old) {
      old.evs.push(ev);
      return;
    }
    const links = LINKS.map((l, i) => ({ l, i }))
      .filter(({ l }) => l[0] === st || l[1] === st)
      .sort(() => rnd() - 0.5)
      .slice(0, rnd() < 0.5 ? 1 : 2);
    const nb = links.map(({ l, i }, k) => ({ st: l[0] === st ? l[1] : l[0], link: i, fromA: l[0] === st, k }));
    breaches.push({ st, t0: t, nb, evs: [ev], crew: [], done: false });
    const s = sites[st]!;
    flash(s.x, HB + s.body, s.z, t, RED, 0.9);
    spark(s.x, HB + s.body, s.z, 22, RED, 1.6);
    spark(s.x, HB + s.body, s.z, 8, AMBER, 1.2);
    tagUntil[st] = Math.max(tagUntil[st]!, t + B_END);
  };

  const spawnSwarm = (ev: FeedEvent, size: number, t: number, narrow: boolean) => {
    const n = Math.min(size, narrow ? 28 : 48);
    const pincer = rnd() < 0.45;
    const b = 0.1 + rnd() * 0.5;
    const bearings = pincer ? [b - 0.65, b + 0.65] : [b];
    const sw: Swarm = { ev, t0: t, groups: [], foes: [], contact: -1, leakAt: -1, leakSt: TARGET_SITE[ev.target] ?? 0, leaked: false, pincer };
    const freeN = units.filter((u) => u.job === PATROL).length;
    const lineN = Math.max(0, Math.min(narrow ? 14 : 22, freeN - 5));
    bearings.forEach((bb, gi) => {
      const dx = camR[0] * Math.cos(bb) + camF[0] * Math.sin(bb);
      const dz = camR[1] * Math.cos(bb) + camF[1] * Math.sin(bb);
      // a V: the leader, then two arms of two ranks each
      const m = Math.round(n / bearings.length);
      for (let k = 0; k < m; k++) {
        const j = k - 1;
        const side = j % 2 ? 1 : -1;
        const i = 1 + Math.floor(Math.floor(j / 2) / 2);
        const rank = Math.floor(j / 2) % 2;
        const bk = k ? i * 0.095 + rank * 0.055 : 0;
        const lt = k ? side * (i * 0.065 - rank * 0.025) : 0;
        sw.foes.push({ x: dx * 4.6, z: dz * 4.6, vx: 0, vz: 0, alive: true, g: gi, bk, lt, fire: t + 5 + rnd() * 2, leak: false, hop: 0 });
      }
      const line = draft(dx * DL, dz * DL, Math.round(lineN / bearings.length), LINE);
      // line slots in order across the front
      const th = Math.atan2(dz, dx);
      line.sort((a, c) => Math.atan2(a.z, a.x) - Math.atan2(c.z, c.x));
      line.forEach((u, k) => {
        const ang = th + (k - (line.length - 1) / 2) * (0.13 / DL);
        u.gx = Math.cos(ang) * DL;
        u.gz = Math.sin(ang) * DL;
      });
      sw.groups.push({ dx, dz, line });
    });
    swarm = sw;
    pulses.push(t);
  };

  /** the leader's distance from the core: in from beyond the rim to just short of our line */
  const leaderR = (sw: Swarm, t: number) => Math.max(DL + 0.3, 3.6 - 0.32 * (t - sw.t0));
  const foeSlot = (sw: Swarm, fo: Foe, t: number, out: [number, number]) => {
    const g = sw.groups[fo.g]!;
    const push = sw.contact > 0 ? Math.min(0.35, (t - sw.contact) * 0.03) : 0;
    const lr = leaderR(sw, t) - push;
    const fx0 = -g.dx;
    const fz0 = -g.dz;
    const lx = -g.dz;
    const lz = g.dx;
    out[0] = g.dx * lr - fx0 * fo.bk + lx * fo.lt;
    out[1] = g.dz * lr - fz0 * fo.bk + lz * fo.lt;
    return out;
  };
  const steer = (u: { x: number; z: number; vx: number; vz: number }, gx: number, gz: number, vmax: number, dt: number, k = 4) => {
    const dx = gx - u.x;
    const dz = gz - u.z;
    const d = Math.hypot(dx, dz);
    const s = d > 1e-4 ? Math.min(vmax, d * 3) / d : 0;
    const a = Math.min(1, dt * k);
    u.vx += (dx * s - u.vx) * a;
    u.vz += (dz * s - u.vz) * a;
    u.x += u.vx * dt;
    u.z += u.vz * dt;
  };
  const shoot = (x: number, z: number, tx: number, tz: number, t: number, red: boolean, foe: Foe | null, unit: Unit | null) => {
    if (tracers.length > 140) return;
    const d = Math.hypot(tx - x, tz - z);
    tracers.push({ x, y: HB + 0.07, z, tx, ty: HB + 0.07, tz, t0: t, dur: Math.max(0.08, d / 4.5), red, foe, unit });
  };

  return {
    frag,
    fovY: 36,
    shift: 0.4,
    frame(f, set) {
      const t = f.t;
      const dt = Math.min(0.05, Math.max(0, f.dt));
      const phase = director.phase(t);
      const level = director.level(t);
      const big = f.narrow ? 1.5 : 1;

      // a slow orbit round the table, from a three-quarter height
      const az = 0.55 + t * 0.026;
      // while a swarm is on the table the camera leans in over it, so the formations read
      tact += ((swarm ? 1 : 0) - tact) * Math.min(1, dt * 0.8);
      const lean = tact * tact * (3 - 2 * tact);
      const D = (f.narrow ? 12.4 : 10.4) - lean * 0.9;
      const h = (f.narrow ? 6.9 : 5.7) + lean * 1.8 + 0.25 * Math.sin(t * 0.045);
      cam = { eye: [Math.sin(az) * D, h, Math.cos(az) * D], target: [0, (f.narrow ? 0.9 : 0.6) - lean * 0.15, 0] };
      camR[0] = Math.cos(az);
      camR[1] = -Math.sin(az);
      camF[0] = -Math.sin(az);
      camF[1] = -Math.cos(az);
      if (!units.length) initUnits(f.narrow, t);

      // the director's waves
      const wave = director.tick(t);
      for (const ev of wave.attacks) launch(ev, t, phase === "war");
      if (wave.swarm && !swarm) spawnSwarm(wave.swarm.ev, wave.swarm.size, t, f.narrow);

      // attacks in flight
      for (const a of attacks) {
        const u = (t - a.t0) / a.dur;
        if (a.ev.fate === "intercepted" && !a.icp) {
          const tMeet = a.t0 + a.dur * a.uEnd;
          if (t >= tMeet - 0.9) {
            const m: V3 = [0, 0, 0];
            bez(a.s, a.c, a.e, a.uEnd, m);
            let best: Unit | null = null;
            let bd = Infinity;
            for (const un of units) {
              if (un.job === DEAD || un.job === REPAIR) continue;
              const dd = Math.hypot(un.x - m[0], un.z - m[2]);
              if (dd < bd) {
                bd = dd;
                best = un;
              }
            }
            const site = sites[a.st]!;
            const s: V3 = best ? [best.x, HB + 0.05, best.z] : [site.x, HB + site.body, site.z];
            if (best) best.heat = 1;
            const c: V3 = [s[0] * 0.75 + m[0] * 0.25, Math.max(s[1], m[1]) + 0.5, s[2] * 0.75 + m[2] * 0.25];
            a.icp = { s, c, t0: t, t1: Math.max(t + 0.3, tMeet) };
          }
        }
        if (u < a.uEnd) continue;
        a.done = true;
        bez(a.s, a.c, a.e, a.uEnd, tmp);
        const site = sites[a.st]!;
        if (a.ev.fate === "blocked") {
          const dir = [tmp[0] - site.x, tmp[1] - HB, tmp[2] - site.z];
          const l = Math.hypot(dir[0]!, dir[1]!, dir[2]!) || 1;
          domes.push({ st: a.st, t1: t, dir: [dir[0]! / l, dir[1]! / l, dir[2]! / l] });
          if (domes.length > 6) domes.shift();
          spark(tmp[0], tmp[1], tmp[2], 14, WHITE, 1.4);
          spark(tmp[0], tmp[1], tmp[2], 8, RED, 1.1);
        } else if (a.ev.fate === "intercepted") {
          flash(tmp[0], tmp[1], tmp[2], t, CYAN, 0.55);
          spark(tmp[0], tmp[1], tmp[2], 16, AMBER, 1.6);
          spark(tmp[0], tmp[1], tmp[2], 10, RED, 1.3);
          spark(tmp[0], tmp[1], tmp[2], 8, CYAN, 1.4);
        } else startBreach(a.st, a.ev, t);
      }
      attacks = attacks.filter((a) => !a.done);
      domes = domes.filter((d) => t - d.t1 < 1.8);

      // takeovers: the crew comes, the red spreads, then the restore
      for (const b of breaches) {
        const tb = t - b.t0;
        if (!b.crew.length && tb >= CREW_AT) {
          const s = sites[b.st]!;
          b.crew = draft(s.x, s.z, f.narrow ? 4 : 6, REPAIR);
          for (const n of b.nb) {
            const ns = sites[n.st]!;
            b.crew.push(...draft(ns.x, ns.z, 2, REPAIR));
          }
        }
        if (tb > B_END) {
          b.done = true;
          release(b.crew);
          const s = sites[b.st]!;
          flash(s.x, HB + s.body * 0.6, s.z, t, CYAN, 0.8);
          spark(s.x, HB + s.body, s.z, 14, CYAN, 1.2);
        }
      }
      breaches = breaches.filter((b) => !b.done);

      // the enemy swarm: a wedge (or two) pours in, our line holds, the fight, maybe a leak
      if (swarm) {
        const sw = swarm;
        if (sw.contact < 0 && leaderR(sw, t) <= DL + 0.3 + 1e-3) {
          sw.contact = t;
          if (sw.ev.fate === "breach") sw.leakAt = t + 3;
        }
        const fight = sw.contact > 0 ? t - sw.contact : -1;
        if (sw.leakAt > 0 && t >= sw.leakAt && !sw.leaked) {
          sw.leaked = true;
          // a few from the wedge's flank slip round the end of the line
          const flank = sw.foes.filter((fo) => fo.alive && fo.g === 0).sort((a, b) => Math.abs(b.lt) - Math.abs(a.lt));
          for (const fo of flank.slice(0, 3)) fo.leak = true;
          tagUntil[sw.leakSt] = Math.max(tagUntil[sw.leakSt]!, t + 6);
        }
        let alive = 0;
        for (const fo of sw.foes) {
          if (!fo.alive) continue;
          alive++;
          if (fo.leak) {
            const g = sw.groups[fo.g]!;
            const target = sites[sw.leakSt]!;
            const th = Math.atan2(g.dz, g.dx) + (fo.lt > 0 ? 1 : -1) * (g.line.length * 0.07 + 0.25) / DL;
            const gx = fo.hop === 0 ? Math.cos(th) * (DL + 0.05) : target.x;
            const gz = fo.hop === 0 ? Math.sin(th) * (DL + 0.05) : target.z;
            steer(fo, gx, gz, 0.75, dt, 3);
            if (fo.hop === 0 && Math.hypot(fo.x - gx, fo.z - gz) < 0.15) fo.hop = 1;
            if (fo.hop === 1 && Math.hypot(fo.x - target.x, fo.z - target.z) < target.r + 0.05) {
              fo.alive = false;
              if (!breaches.some((b) => b.st === sw.leakSt)) startBreach(sw.leakSt, sw.ev, t);
            }
            continue;
          }
          foeSlot(sw, fo, t, p2);
          const jit = fight > 0 ? 0.05 : 0.01;
          steer(fo, p2[0] + Math.sin(t * 2.3 + fo.bk * 17 + fo.lt * 9) * jit, p2[1] + Math.cos(t * 2.9 + fo.lt * 21) * jit, 0.9, dt, 5);
          if (fight > 0 && t > fo.fire) {
            fo.fire = t + 0.7 + rnd() * 1.1;
            let best: Unit | null = null;
            let bd = 1.1;
            for (const u of sw.groups[fo.g]!.line) {
              if (u.job !== LINE) continue;
              const dd = Math.hypot(u.x - fo.x, u.z - fo.z);
              if (dd < bd) {
                bd = dd;
                best = u;
              }
            }
            if (best) shoot(fo.x, fo.z, best.x, best.z, t, true, null, rnd() < 0.05 ? best : null);
          }
          if (fight > 15) {
            fo.alive = false;
            spark(fo.x, HB + 0.06, fo.z, 6, AMBER, 1);
          }
        }
        // our line: hold the arc, fire at the nearest of them
        for (const g of sw.groups)
          for (const u of g.line) {
            if (u.job !== LINE || fight < 0 || t < u.fire) continue;
            u.fire = t + 0.4 + rnd() * 0.45;
            let best: Foe | null = null;
            let bd = 1.3;
            for (const fo of sw.foes) {
              if (!fo.alive || fo.leak) continue;
              const dd = Math.hypot(fo.x - u.x, fo.z - u.z);
              if (dd < bd) {
                bd = dd;
                best = fo;
              }
            }
            if (best) shoot(u.x, u.z, best.x, best.z, t, false, rnd() < Math.min(0.9, 0.26 + fight * 0.05) ? best : null, null);
          }
        const leakOpen = sw.foes.some((fo) => fo.alive && fo.leak);
        if (!alive || (sw.contact > 0 && fight > 16 && !leakOpen)) {
          for (const g of sw.groups) release(g.line);
          swarm = null;
        }
      }

      // tracers land: a kill when it was a hit
      for (const tr of tracers) {
        if (t - tr.t0 < tr.dur) continue;
        if (tr.foe && tr.foe.alive) {
          tr.foe.alive = false;
          spark(tr.foe.x, HB + 0.07, tr.foe.z, 7, AMBER, 1.1);
          spark(tr.foe.x, HB + 0.07, tr.foe.z, 4, RED, 0.9);
        }
        if (tr.unit && tr.unit.job === LINE) kill(tr.unit, t);
      }
      tracers = tracers.filter((tr) => t - tr.t0 < tr.dur);

      // our units: patrols in file, the line, repair crews circling, the fallen coming back from the core
      for (const u of units) {
        u.heat *= Math.exp(-dt * 2.5);
        if (u.job === DEAD) {
          if (t < u.back) continue;
          u.job = PATROL;
          u.x = 0;
          u.z = 0;
          u.vx = 0;
          u.vz = 0;
        }
        if (u.job === LINE) {
          const jit = swarm && swarm.contact > 0 ? 0.03 : 0;
          steer(u, u.gx + Math.sin(t * 3.1 + u.k * 2.3) * jit, u.gz + Math.cos(t * 2.7 + u.k) * jit, 0.9, dt, 5);
          continue;
        }
        if (u.job === REPAIR) {
          const b = breaches.find((x) => x.crew.includes(u));
          if (!b) {
            u.job = PATROL;
          } else {
            const i = b.crew.indexOf(u);
            const main = f.narrow ? 4 : 6;
            const st = i < main ? b.st : (b.nb[Math.floor((i - main) / 2)]?.st ?? b.st);
            const s = sites[st]!;
            const nIn = i < main ? main : 2;
            const kk = i < main ? i : (i - main) % 2;
            const ang = (kk / nIn) * Math.PI * 2 + t * 0.9;
            const rr = s.r + 0.2;
            steer(u, s.x + Math.cos(ang) * rr, s.z + Math.sin(ang) * rr, 1.0, dt, 4);
            continue;
          }
        }
        slotOf(u, t, p2);
        steer(u, p2[0], p2[1], 0.6, dt, 3);
      }

      // radar pulses now and then (one rings out when a swarm is sighted)
      if (t > nextPulse) {
        pulses.push(t);
        nextPulse = t + 9 + rnd() * 4;
      }
      while (pulses.length > 2) pulses.shift();
      let ringR = -1;
      let ringK = 0;
      for (const p0 of pulses) {
        const r = (t - p0) * 1.7;
        if (r < RO + 0.2 && r >= 0) {
          ringR = r;
          ringK = Math.max(0, 1 - r / (RO + 0.3)) * 0.9;
        }
      }

      // sparks
      for (let i = 0; i < nsp; i++) {
        const o2 = i * 8;
        sp[o2 + 6]! -= dt;
        if (sp[o2 + 6]! <= 0) {
          const last = (nsp - 1) * 8;
          sp.copyWithin(o2, last, last + 8);
          nsp--;
          i--;
          continue;
        }
        const drag = Math.exp(-dt * 2);
        sp[o2 + 3]! *= drag;
        sp[o2 + 4]! = sp[o2 + 4]! * drag - 1.2 * dt;
        sp[o2 + 5]! *= drag;
        sp[o2]! += sp[o2 + 3]! * dt;
        sp[o2 + 1]! += sp[o2 + 4]! * dt;
        sp[o2 + 2]! += sp[o2 + 5]! * dt;
      }

      // --- points
      pts.n = 0;
      for (const u of units) {
        if (u.job === DEAD) continue;
        const k = u.job === PATROL ? 2.2 : 2.8;
        const y = HB + 0.05 + Math.sin(t * 2 + u.k + u.sq) * 0.008;
        // a pawn: a base on the map and a brighter head above it
        const c: V3 = u.job === REPAIR ? [0.55, 1, 0.85] : [0.5, 0.92, 1];
        pts.add(u.x, y, u.z, 0.05 * big, c, k + u.heat * 2);
        pts.add(u.x, y + 0.11, u.z, 0.045 * big, c, k + 1.2 + u.heat * 2);
        pts.add(u.x - u.vx * 0.15, y, u.z - u.vz * 0.15, 0.035 * big, CYAN, 0.7);
      }
      if (swarm)
        for (const fo of swarm.foes) {
          if (!fo.alive) continue;
          const r = Math.hypot(fo.x, fo.z);
          const k = 2.6 * Math.min(1, Math.max(0, (3.95 - r) / 0.5));
          pts.add(fo.x, HB + 0.05, fo.z, 0.055 * big, FOE_C, k * 1.3);
          pts.add(fo.x - fo.vx * 0.15, HB + 0.05, fo.z - fo.vz * 0.15, 0.04 * big, RED, k * 0.5);
        }
      for (const tr of tracers) {
        const u = (t - tr.t0) / tr.dur;
        for (let k = 0; k < 3; k++) {
          const uu = Math.max(0, u - k * 0.12);
          pts.add(tr.x + (tr.tx - tr.x) * uu, tr.y + 0.05 * Math.sin(uu * Math.PI), tr.z + (tr.tz - tr.z) * uu, 0.022 * big, tr.red ? RED : AMBER, 2.2 - k * 0.6);
        }
      }
      for (const a of attacks) {
        const u = Math.min(a.uEnd, (t - a.t0) / a.dur);
        if (u < 0) continue;
        bez(a.s, a.c, a.e, u, tmp);
        pts.add(tmp[0], tmp[1], tmp[2], 0.07 * big, HOT, 5);
        for (let j = 1; j <= 20; j++) {
          const uu = u - j * 0.016;
          if (uu < 0) break;
          bez(a.s, a.c, a.e, uu, tmp);
          pts.add(tmp[0], tmp[1], tmp[2], 0.05 * big, RED, 3.2 - j * 0.14);
        }
        if (a.icp) {
          const ic = a.icp;
          bez(a.s, a.c, a.e, a.uEnd, tmp);
          const m: V3 = [tmp[0], tmp[1], tmp[2]];
          const ui = Math.min(1, (t - ic.t0) / Math.max(0.05, ic.t1 - ic.t0));
          for (let j = 0; j <= 12; j++) {
            const uu = ui - j * 0.035;
            if (uu < 0) break;
            bez(ic.s, ic.c, m, uu, tmp);
            pts.add(tmp[0], tmp[1], tmp[2], (j ? 0.035 : 0.05) * big, j ? CYAN : WHITE, j ? 2.2 - j * 0.15 : 3.6);
          }
        }
      }
      for (let i = 0; i < nsp; i++) {
        const o2 = i * 8;
        pts.add(sp[o2]!, sp[o2 + 1]!, sp[o2 + 2]!, 0.03 * big, SPARK_C[sp[o2 + 7]!]!, 2.6 * Math.min(1, sp[o2 + 6]! * 2.5));
      }

      // --- uniforms: the sites' and links' state
      uS.fill(0);
      for (let i = 0; i < NS; i++) uS[i * 4 + 2] = -1;
      uLink.fill(0);
      const setSite = (i: number, red: number, glitch: number, scanY: number) => {
        if (red < uS[i * 4]!) return;
        uS[i * 4] = red;
        uS[i * 4 + 1] = glitch;
        uS[i * 4 + 2] = scanY;
      };
      for (const b of breaches) {
        const tb = t - b.t0;
        const s = sites[b.st]!;
        const restoring = tb > R0 + 0.8;
        const scanY = restoring ? HB + ((tb - R0 - 0.8) / 1.5) * (s.top - HB + 0.05) : -1;
        setSite(b.st, Math.min(1, tb / 0.25), restoring ? 0.3 : 1, scanY);
        for (const n of b.nb) {
          const s0 = SPREAD0 + n.k * 0.5;
          const p = Math.min(1, Math.max(0, (tb - s0) / SPREAD_DT));
          const o2 = n.link * 4;
          if (tb < R0) {
            if (n.fromA) uLink[o2] = Math.max(uLink[o2]!, p);
            else uLink[o2 + 1] = Math.max(uLink[o2 + 1]!, p);
          } else uLink[o2 + 2] = Math.max(uLink[o2 + 2]!, Math.max(0, 1 - (tb - R0) / 0.8));
          if (tb >= s0 + SPREAD_DT) {
            const ns = sites[n.st]!;
            const rs = tb > R0 ? HB + ((tb - R0) / 1.1) * (ns.top - HB + 0.05) : -1;
            setSite(n.st, Math.min(1, (tb - s0 - SPREAD_DT) / 0.3), tb > R0 ? 0.3 : 0.8, rs);
          }
        }
      }
      uDome.fill(0);
      uDomeS.fill(0);
      let di = 0;
      for (const a of attacks) {
        if (a.ev.fate !== "blocked" || di >= ND) continue;
        const age = t - (a.t0 + a.dur * a.uEnd);
        if (age < -0.55) continue;
        const s = sites[a.st]!;
        uDome.set([s.x, HB, s.z, s.dome], di * 4);
        uDomeS.set([0, 1, 0, age], di * 4);
        di++;
      }
      for (const d of domes) {
        if (di >= ND) break;
        const s = sites[d.st]!;
        uDome.set([s.x, HB, s.z, s.dome], di * 4);
        uDomeS.set([d.dir[0], d.dir[1], d.dir[2], t - d.t1], di * 4);
        di++;
      }
      uFx.fill(-1);
      uFxC.fill(0);
      fx.forEach((e, i) => {
        const age = t - e.t0;
        if (age > 1.6) return;
        uFx.set([e.x, e.y, e.z, age], i * 4);
        uFxC.set([e.c[0]!, e.c[1]!, e.c[2]!, e.size], i * 4);
      });
      // the projector's flicker: a steady hum with a rare dip
      const dip = Math.sin(t * 0.7) * Math.sin(t * 2.3) > 0.93 ? 0.82 : 1;
      const hum = (0.95 + 0.04 * Math.sin(t * 13.7) * Math.sin(t * 3.1)) * dip;
      let alarm = 0;
      const al = [0, 0, 0, 0];
      if (swarm) {
        const age = t - swarm.t0;
        alarm = Math.min(1, age / 0.8) * (swarm.contact > 0 ? Math.max(0.25, 1 - (t - swarm.contact) / 4) : 1);
        swarm.groups.forEach((g, i) => {
          al[i * 2] = g.dx;
          al[i * 2 + 1] = g.dz;
        });
        if (swarm.groups.length < 2) {
          al[2] = al[0]!;
          al[3] = al[1]!;
        }
      }

      setCam(set, cam);
      set.v4v("uS", uS);
      set.v4v("uLink", uLink);
      set.v4v("uDome", uDome);
      set.v4v("uDomeS", uDomeS);
      set.v4v("uFx", uFx);
      set.v4v("uFxC", uFxC);
      set.v4("uRadar", ringR, ringR < 0 ? 0 : ringK, 0, level);
      set.v4("uHolo", hum, alarm * (swarm && swarm.groups.length < 2 ? 0.5 : 1), tact, 0);
      set.v4("uAlarm", al[0]!, al[1]!, al[2]!, al[3]!);
      set.f("uDetail", f.narrow ? 0.7 : 1);
      set.points(pts.data, pts.n, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      const t = f.t;
      const out: Label[] = [{ text: "sim · attack mix and breach odds from the last 90 days", x: f.width - 16, y: f.height - 16, tone: "dim", anchor: "end" }];
      const ok = (p: { x: number; y: number } | null): p is { x: number; y: number } => !!p && p.x > f.width * 0.47 && p.x < f.width - 30 && p.y > 14 && p.y < f.height - 40;
      // the targeted systems, named while they are under fire (red while taken over): three at most, the hottest and newest
      const named = sites
        .map((s, i) => ({ s, i, hot: uS[i * 4]! > 0.5, until: tagUntil[i]! }))
        .filter((x) => x.hot || (!swarm && x.until > t))
        .sort((a, b) => Number(b.hot) - Number(a.hot) || b.until - a.until)
        .slice(0, 3);
      for (const { s, i, hot } of named) {
        const p = projectPoint([s.x, s.top + 0.12, s.z], cam, f);
        if (!ok(p)) continue;
        out.push({ text: tagName[i]!, x: p.x, y: p.y - 18, tone: hot ? "hot" : "dim", anchor: "middle" });
      }
      // the kind of attack riding the newest one
      let n = 0;
      for (let i = attacks.length - 1; i >= 0 && n < 1; i--) {
        const a = attacks[i]!;
        const u = Math.min(a.uEnd, (t - a.t0) / a.dur);
        if (u < 0.08) continue;
        bez(a.s, a.c, a.e, u, tmp);
        const p = projectPoint(tmp, cam, f);
        if (!ok(p)) continue;
        out.push({ text: a.ev.kind.toLowerCase(), x: p.x + 10, y: p.y - 20, tone: "hot", anchor: "start" });
        n++;
      }
      if (swarm) {
        let x = 0;
        let z = 0;
        let c = 0;
        for (const fo of swarm.foes)
          if (fo.alive && !fo.leak) {
            x += fo.x;
            z += fo.z;
            c++;
          }
        if (c) {
          const p = projectPoint([x / c, HB + 0.3, z / c], cam, f);
          if (ok(p)) out.push({ text: `${swarm.ev.kind.toLowerCase()} · swarm ${c}`, x: p.x, y: p.y - 24, tone: "hot", anchor: "middle" });
        }
      }
      return declutter(out, f.width);
    },
  };
}
