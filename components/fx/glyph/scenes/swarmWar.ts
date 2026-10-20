import type { Category } from "@/lib/taxonomy";
import type { ThreatIntel } from "@/lib/threatIntel";
import { POINT_STRIDE, projectPoint, type Cam, type GlyphController, type V3 } from "../engine";
import type { FeedEvent } from "../feed";
import { WaveDirector } from "./director";
import { enemySlot, FORMATIONS, GEAR_R, gearRings, honeycombAt, LAYER_TYPES, layerAt, type EnemyShape, type LayerType } from "./formations";
import { AMBER, attackStart, CYAN, Flashes, KIT_GLSL, RED, setCam, swayCam, v3, WHITE, type Emit } from "./kit";

/** the core's radius, and the shield's round it */
const RC = 0.75;
const RS = 1.1;
const MODULES = ["MEM", "TOOLS", "CREDS", "MODEL", "AGENTS", "VECDB"];
const MOD_R = 0.44;
/** the modules inside the core, in the core's own (turning) frame */
const MOD_POS: V3[] = [
  [MOD_R, 0.04, 0],
  [-MOD_R, -0.04, 0],
  [0, MOD_R, 0.04],
  [0, -MOD_R, -0.04],
  [0.04, 0, MOD_R],
  [-0.04, 0, -MOD_R],
];
/** the steps of a takeover, one per module it reaches */
const STAGES = ["RECON", "ENUM", "PRIVESC", "LATERAL", "EXFIL", "PERSIST"];

const FRAG =
  KIT_GLSL +
  `
uniform float uOpen;
uniform vec4 uCrack;
uniform float uRed;
uniform float uSpin;
uniform float uWave;
uniform vec4 uMod[6];
uniform vec4 uModC[6];
uniform vec4 uGyro[2];
uniform vec4 uRift[3];
uniform vec4 uRiftU[3];
uniform vec4 uHit[4];
uniform vec4 uHitC[4];
uniform vec4 uInf[3];

const float RC = ${RC.toFixed(2)};
const float RS = ${RS.toFixed(2)};
/** key light from the upper left, a cool fill from the lower right */
const vec3 LDIR = vec3(-.47, .67, .58);
const vec3 FILL = vec3(.72, -.35, .6);

vec3 toCore(vec3 p){ p.xz = rot2(uSpin)*p.xz; return p; }

/** distance to the nearest edge of a 3D Voronoi cell: cracks and the shield's cells */
float cellEdge(vec3 p){
  vec3 i = floor(p), f = fract(p);
  float d1 = 8., d2 = 8.;
  for(int z = -1; z <= 1; z++) for(int y = -1; y <= 1; y++) for(int x = -1; x <= 1; x++){
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash13(i + g), hash13(i + g + 7.1), hash13(i + g + 3.7));
    vec3 r = g + o - f;
    float d = dot(r, r);
    if(d < d1){ d2 = d1; d1 = d; } else if(d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}

/** the rifts the enemy armies pour out of: jagged red tears facing the camera */
vec3 rifts(vec3 ro, vec3 rd){
  vec3 col = vec3(0.);
  for(int i = 0; i < 3; i++){
    float open = uRift[i].w;
    if(open <= 0.) continue;
    vec3 c = uRift[i].xyz;
    float t = dot(c - ro, rd);
    if(t <= 0.) continue;
    vec3 q = ro + rd*t - c;
    vec3 up = uRiftU[i].xyz;
    vec3 side = normalize(cross(up, rd));
    float u = dot(q, up), v = dot(q, side);
    float L = 1.1*open;
    float k = clamp(u/L, -1., 1.);
    float jag = (noise(vec3(u*7., uRiftU[i].w*.9, 1.3)) - .5)*.2*open + sin(u*5.3 + 1.)*.05;
    float wdt = .07*open*(1. - k*k) + .006;
    float x = (v - jag)/wdt;
    float inside = step(abs(u), L);
    float lips = exp(-x*x)*inside;
    float halo = exp(-abs(v - jag)*16.)*exp(-pow(max(abs(u) - L, 0.)*6., 2.))*.35;
    float crackle = pow(noise(vec3(u*22., v*22., uRiftU[i].w*6.)), 6.)*exp(-abs(v - jag)*20.)*inside*2.;
    col += (vec3(1., .2, .1)*(lips*2.4 + halo + crackle) + vec3(1., .82, .7)*pow(lips, 8.)*2.2)*open;
  }
  return col;
}

/** the core's armour at unit normal n, seen along rd: plated bands, a trench at the equator, emitters at the poles */
vec3 shell(vec3 n, vec3 rd){
  vec3 q = toCore(n);
  float lat = asin(clamp(q.y, -1., 1.));
  float lon = atan(q.z, q.x);
  const float BANDS = 11.;
  float bv = (lat/PI + .5)*BANDS;
  float bi = floor(bv), bf = fract(bv);
  float latC = ((bi + .5)/BANDS - .5)*PI;
  float np = max(4., floor(20.*cos(latC) + .5));
  float pv = (lon/(2.*PI) + .5)*np + mod(bi, 2.)*.5;
  float pi0 = floor(pv), pf = fract(pv);
  float id = hash12(vec2(bi, mod(pi0, np)) + 3.7);
  // the plate's centre, for infections that spread plate by plate
  float lonC = ((pi0 + .5 - mod(bi, 2.)*.5)/np - .5)*2.*PI;
  vec3 pc = vec3(cos(latC)*cos(lonC), sin(latC), cos(latC)*sin(lonC));
  float sx = min(pf, 1. - pf), sy = min(bf, 1. - bf);
  float plate = smoothstep(.05, .1, min(sx, sy*1.2));
  float alb = .55 + (id - .5)*.3;
  vec3 emi = vec3(0.);
  float type = fract(id*7.31);
  if(bi == 5.){
    // the equatorial trench: a dark channel between two bright rails, data running along it
    alb = .1;
    plate = 1.;
    emi += vec3(.4, .85, 1.)*exp(-pow((sy - .1)/.05, 2.))*.8;
    emi += vec3(1., .66, .3)*smoothstep(.75, 1., fract(lon*24./(2.*PI) - uTime*.45 + step(.5, bf)*.5))*smoothstep(.22, .4, sy)*1.5;
  } else if(bi < .5 || bi > BANDS - 1.5){
    // polar caps: stepped rings round an emitter
    float rr = (PI*.5 - abs(lat))/(PI/BANDS);
    alb = .4 + .2*step(.5, fract(rr*3.));
    plate = smoothstep(.04, .12, abs(fract(rr*3.) - .5));
    emi += vec3(.45, .9, 1.)*(exp(-rr*rr*28.)*1.8 + exp(-pow((rr - .62)/.05, 2.))*.5*(.5 + .5*sin(lon*6. + uTime*2.)));
  } else if(type < .22){
    // a vent grille
    alb *= .45 + .55*step(.5, fract(bf*3.));
  } else if(type < .4){
    // a circuit plate: glowing traces
    float tr = exp(-pow((bf - .5)/.07, 2.))*step(.15, pf)*step(pf, .85) + exp(-pow((pf - .3 - .4*step(.5, id))/.06, 2.))*step(.5, bf)*step(bf, .88);
    emi += vec3(.35, .85, 1.)*tr*.85*(.7 + .3*sin(uTime*2. + id*20.));
  } else if(type < .52){
    // a lit port, which shows most on the night side
    emi += mix(vec3(1., .7, .35), vec3(.5, .9, 1.), step(.5, fract(id*3.1)))*exp(-(pow((pf - .5)/.2, 2.) + pow((bf - .5)/.24, 2.)))*1.1;
  } else if(type > .9){
    // a recessed plate
    alb *= .55;
  }
  float diff = max(dot(n, LDIR), 0.);
  float fill = max(dot(n, FILL), 0.)*.2;
  vec3 hv = normalize(LDIR - rd);
  float spec = pow(max(dot(n, hv), 0.), 36.);
  float fr = pow(1. - max(dot(n, -rd), 0.), 3.);
  vec3 metal = vec3(.5, .66, .88);
  vec3 col = metal*alb*(diff*2.6 + fill*1.8 + .26)*plate + vec3(.9, .95, 1.)*spec*1.4*plate + emi*(.8 + 1.2*(1. - diff)) + vec3(.35, .8, 1.)*fr*.9;
  // infections: plates inside the spreading (then shrinking) patch go red and glitch; the cleaning edge flashes white
  for(int i = 0; i < 3; i++){
    float R = uInf[i].w;
    if(R <= 0.) continue;
    float ang = acos(clamp(dot(pc, uInf[i].xyz), -1., 1.)) + (id - .5)*.12;
    if(bi == 5. || bi < .5 || bi > BANDS - 1.5) ang = acos(clamp(dot(q, uInf[i].xyz), -1., 1.));
    float inf = step(ang, R);
    float glitch = step(.5, hash12(vec2(id*91., floor(uTime*9.))));
    col = mix(col, vec3(1., .2, .1)*(.9 + 1.4*glitch)*(.4 + .6*plate) + vec3(.4, 0., 0.)*diff, inf);
    col += vec3(.7, .95, 1.)*exp(-pow((ang - R)/.05, 2.))*1.4*plate;
  }
  // the sonar ping: a band of light running pole to pole
  col += vec3(.45, .9, 1.)*exp(-pow((lat - (PI*.5 - uWave*PI))/.07, 2.))*step(uWave, 1.)*.9;
  if(uCrack.w > 0.){
    float a = acos(clamp(dot(q, uCrack.xyz), -1., 1.));
    float e = cellEdge(q*4.5);
    float crack = (1. - smoothstep(0., .06, e))*exp(-a/.8);
    col = mix(col, col*vec3(1., .5, .4), uRed*.35);
    col += vec3(1., .3, .12)*crack*uCrack.w*2.2;
  }
  return col;
}

/** inside the open core: the heart, six modules on spokes, the far wall lit by the heart */
vec3 interior(vec3 ro, vec3 rd, float tOut){
  vec3 o = toCore(ro), d = toCore(rd);
  float tBest = tOut;
  int kind = 0;
  int mi = 0;
  vec3 nb = vec3(0.);
  vec2 hr = sphIsect(o, d, vec3(0.), .2);
  if(hr.x > 0. && hr.x < tBest){ tBest = hr.x; kind = 1; }
  vec3 sd = step(0., d)*2. - 1.;
  vec3 inv = sd/max(abs(d), vec3(1e-5));
  for(int i = 0; i < 6; i++){
    vec3 c = uMod[i].xyz;
    float s = uMod[i].w;
    vec3 ta = (c - s - o)*inv, tb = (c + s - o)*inv;
    vec3 tn = min(ta, tb), tf = max(ta, tb);
    float t0 = max(max(tn.x, tn.y), tn.z), t1 = min(min(tf.x, tf.y), tf.z);
    if(t0 < t1 && t0 > 0. && t0 < tBest){
      tBest = t0;
      kind = 2;
      mi = i;
      nb = -sd*step(tn.yzx, tn.xyz)*step(tn.zxy, tn.xyz);
    }
  }
  vec3 p = o + d*tBest;
  vec3 heart = mix(vec3(1., .78, .45), vec3(1., .25, .12), uRed);
  vec3 col;
  if(kind == 1){
    vec3 n = normalize(p);
    float f = 1. - abs(noise(p*16. + vec3(0., uTime*.8, 0.))*2. - 1.);
    float g = 1. - abs(noise(p*31. - vec3(uTime*.5))*2. - 1.);
    col = heart*(1.2 + 2.2*pow(f, 6.) + 1.2*pow(g, 10.)) + vec3(1.)*pow(max(dot(n, -d), 0.), 3.)*.7;
  } else if(kind == 2){
    vec3 L = normalize(-p);
    float dif = .3 + .7*max(dot(nb, L), 0.);
    // rows of servers
    float rows = step(.35, fract((p.y - uMod[mi].y)*40.));
    vec3 c = uModC[mi].rgb*uModC[mi].a;
    col = c*dif*(.5 + .5*rows) + c*.4*step(.85, fract((p.x + p.z)*28.));
  } else {
    vec3 n = normalize(p);
    float lat = asin(clamp(n.y, -1., 1.));
    float lon = atan(n.z, n.x);
    vec2 g2 = abs(fract(vec2(lon*14./(2.*PI), lat*9./PI)) - .5);
    float seam = smoothstep(.4, .46, max(g2.x, g2.y));
    float lights = step(.92, hash12(floor(vec2(lon*28./(2.*PI), lat*18./PI)) + 1.7));
    col = (vec3(.2, .28, .4)*(.8 - seam*.6) + heart*lights*.9)*.35 + vec3(.1, 0., 0.)*uRed;
  }
  for(int i = 0; i < 6; i++){
    float s;
    float d2 = segDist2(o, d, vec3(0.), uMod[i].xyz, s);
    col += uModC[i].rgb*exp(-d2/.0003)*.7*uModC[i].a;
  }
  col += heart*pointGlow(o, d, vec3(0.), .28)*.9;
  return col;
}

/** an armillary ring: radius R, half-width w, in the plane with normal nrm; colour and coverage, and where the ray met it */
vec4 ring(vec3 ro, vec3 rd, vec3 nrm, float R, float w, float ph, out float tHit){
  tHit = 1e9;
  float dn = dot(rd, nrm);
  if(abs(dn) < 1e-4) return vec4(0.);
  float t = -dot(ro, nrm)/dn;
  if(t <= 0.) return vec4(0.);
  vec3 p = ro + rd*t;
  float r = length(p);
  // a pixel's footprint, grown as the ring turns edge-on so it thins to a line instead of breaking up
  float fp = t*.006/max(abs(dn), .1);
  float cov = clamp(1. - (abs(r - R) - w)/fp, 0., 1.);
  if(cov <= 0.) return vec4(0.);
  tHit = t;
  vec3 e1 = normalize(cross(nrm, abs(nrm.y) < .9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.)));
  vec3 e2 = cross(nrm, e1);
  float ang = atan(dot(p, e2), dot(p, e1)) + ph;
  float lit = .3 + .7*abs(dot(nrm, LDIR));
  float across = abs(r - R)/w;
  float rails = smoothstep(.5, .85, across);
  float tick = step(.84, fract(ang*36./(2.*PI)));
  float bead = exp(-pow(mod(ang*2. - uTime*.9, 2.*PI) - PI, 2.)*18.);
  vec3 c = vec3(.42, .62, .86)*lit*(.5 + .5*rails) + vec3(1., .7, .35)*tick*(1. - rails)*.7 + vec3(.6, .95, 1.)*bead*2.2;
  c = mix(c, c*vec3(1., .45, .35) + vec3(.15, 0., 0.), uRed*.6);
  return vec4(c, cov);
}

vec3 over(vec3 col, vec4 r, float tR, float tS){ return r.a > 0. && tR < tS ? mix(col, r.rgb, r.a) : col; }

void main(){
  vec3 ro = uEye;
  vec3 rd = camRay(lookAt(ro, uTarget));
  vec3 col = rifts(ro, rd);
  float along = dot(-ro, rd);
  float dc = length(ro + rd*along);
  // a thin atmosphere round the core: cool when calm, red in an alarm
  col += mix(vec3(.25, .6, 1.), vec3(1., .2, .1), uRed)*exp(-max(dc - RC, 0.)*9.)*.16*step(0., along);
  vec2 hs = sphIsect(ro, rd, vec3(0.), RC);
  float tS = 1e9;
  if(hs.x > 0.){
    tS = hs.x;
    vec3 n = normalize(ro + rd*hs.x);
    // an iris porthole facing the camera: six blades, the cut edge stepping round them
    vec3 ax = normalize(ro);
    vec3 e1 = normalize(cross(ax, vec3(0., 1., 0.)));
    vec3 e2 = cross(ax, e1);
    float blade = fract(atan(dot(n, e2), dot(n, e1))*6./(2.*PI) + uOpen*.35);
    float edge = 1. - uOpen*.42 + blade*.05*uOpen;
    float ce = dot(n, ax);
    if(uOpen > .01 && ce > edge){
      col = interior(ro, rd, hs.y);
      // the cut face: a dark band of the shell's thickness with a hot lip
      col = mix(col, vec3(.03, .04, .07), smoothstep(edge + .05, edge + .02, ce)*.9);
    } else col = shell(n, rd);
    if(uOpen > .01) col += mix(vec3(.5, .9, 1.), vec3(1., .3, .15), uRed)*exp(-pow((ce - edge)/.016, 2.))*2.;
  }
  float t0, t1;
  vec4 r0 = ring(ro, rd, uGyro[0].xyz, RC*1.2, .03, uGyro[0].w, t0);
  vec4 r1 = ring(ro, rd, uGyro[1].xyz, RC*1.34, .022, uGyro[1].w, t1);
  if(t0 > t1){ col = over(col, r0, t0, tS); col = over(col, r1, t1, tS); }
  else { col = over(col, r1, t1, tS); col = over(col, r0, t0, tS); }
  // the shield: unseen until something hits it, then its cells light round the hit
  float live = max(max(uHit[0].w, uHit[1].w), max(uHit[2].w, uHit[3].w));
  if(live >= 0.){
    vec2 hh = sphIsect(ro, rd, vec3(0.), RS);
    if(hh.x > 0.){
      vec3 N = (ro + rd*hh.x)/RS;
      float lines = 1. - smoothstep(0., .08, cellEdge(N*7.5));
      for(int i = 0; i < 4; i++){
        float age = uHit[i].w;
        if(age < 0.) continue;
        float ang = acos(clamp(dot(N, uHit[i].xyz), -1., 1.));
        float spot = exp(-pow(ang/(.22 + age*1.2), 2.)*2.)*exp(-age*2.6);
        float wave = exp(-pow((ang - age*1.5)/.08, 2.))*exp(-age*2.2);
        col += uHitC[i].rgb*uHitC[i].a*(spot*(.2 + lines*1.6) + wave*lines*1.2 + exp(-ang*ang*70.)*exp(-age*6.)*3.);
      }
    }
  }
  col += flashes(ro, rd);
  outCol(col);
}
`;

const FORM = 0;
const LAYER = 1;
const WING = 2;
const REPAIR = 3;
/** in a task force during a mass assault: `job` is the force, `aux` its place in it */
const TASK = 4;
/** hijacked by an agent-hijack breach: red, until a repair cage purges it */
const DEFECT = 5;
const GEAR = 0;
const WALL = 1;
const PINCER = 2;
const SPEAR = 3;
const FORCE_NAME = ["gear rings", "shield wall", "pincer · encircling", "spearhead"];
const FORCE_COL: V3[] = [
  [0.45, 0.9, 1],
  [0.7, 0.95, 1],
  [0.35, 0.85, 1],
  [0.88, 0.97, 1],
];
/** share of the free agents each force takes (the gear rings get the rest) */
const FORCE_SHARE = [0, 0.22, 0.24, 0.2];
const NONE = new Float32Array(12);
type Fx = "patch" | "spiral" | "defect" | "exfil";
const FX_LABEL: Record<Fx, string> = { patch: "breach", spiral: "injection", defect: "agents hijacked", exfil: "exfiltration" };

/** how a breach of each attack type shows: injected prompts spiral in, hijacks turn our own agents, leaks stream data out, the rest infect the armour */
function fxOf(c: Category): Fx {
  if (c === "prompt_injection" || c === "jailbreak" || c === "adversarial_evasion") return "spiral";
  if (c === "agent_hijack" || c === "ai_phishing_social_engineering" || c === "deepfake_fraud") return "defect";
  if (c === "data_leak" || c === "model_theft_extraction") return "exfil";
  return "patch";
}

interface Agent {
  p: V3;
  v: V3;
  role: number;
  /** what the role works on: a layer, an attack id, a force, a breach */
  job: number;
  /** its place in a task force */
  aux: number;
  heat: number;
  /** its slot in the current formation and the one before (it switches over after `delay`) */
  slot: number;
  prevSlot: number;
  delay: number;
  /** one in ten burns brighter, so the swarm sparkles */
  lead: boolean;
}
interface Layer {
  type: LayerType;
  dir: V3;
  members: number[];
  until: number;
}
/** an interceptor wing: a leader chasing the attack, the rest in a V behind it */
interface Wing {
  ids: number[];
  lead: V3;
  v: V3;
}
interface Attack {
  id: number;
  ev: FeedEvent;
  s: V3;
  c: V3;
  e: V3;
  t0: number;
  dur: number;
  layer: Layer | null;
  wing: Wing | null;
  head: V3;
  done: boolean;
}
interface Enemy {
  p: V3;
  v: V3;
  alive: boolean;
  born: number;
  k: number;
  /** on a breach, a handful slip through every line */
  slip: boolean;
  /** when it breaks off to dive at the core */
  dive: number;
}
interface Army {
  task: number;
  shape: EnemyShape;
  rift: V3;
  riftUp: V3;
  dir: V3;
  side: V3;
  up: V3;
  start: V3;
  center: V3;
  /** how close to the core its formation comes before it stops, and when it starts to advance */
  stop: number;
  go: number;
  enemies: Enemy[];
}
interface Assault {
  ev: FeedEvent;
  t0: number;
  armies: Army[];
  forces: number[][];
  breached: boolean;
  /** the plane the gear rings turn in (facing the camera) */
  gear: V3;
  /** the spearhead's start, its line of attack and the way it turns */
  p0: V3;
  aim: V3;
  turn: V3;
}
interface Spark {
  p: V3;
  v: V3;
  t0: number;
  life: number;
  c: V3;
}
interface Packet {
  a: number;
  t0: number;
  dur: number;
  back: boolean;
}
interface Infection {
  ev: FeedEvent;
  /** where it hit, in the core's own frame */
  dir: V3;
  t0: number;
  cleanAt: number;
  end: number;
  squad: number[];
}
/** a breach's own effect (injection spiral, hijacked agents, exfiltration stream) */
interface Effect {
  fx: Fx;
  ev: FeedEvent;
  /** where it hit, in world space */
  dir: V3;
  t0: number;
  ids: number[];
  cage: number[];
  stage: number;
}
interface Takeover {
  t0: number;
  order: number[];
  infectAt: number[];
  cleanAt: number[];
  end: number;
  closeAt: number;
  repairersAt: number;
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** a point on a circle of radius r in the plane with normal nrm */
const onCircle = (nrm: V3, r: number, a: number): V3 => {
  const e1 = v3.norm(cross(nrm, Math.abs(nrm[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const e2 = cross(nrm, e1);
  return v3.add(v3.mul(e1, Math.cos(a) * r), v3.mul(e2, Math.sin(a) * r));
};
const rotYv = (p: V3, a: number): V3 => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
const rotXv = (p: V3, a: number): V3 => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
const rotZv = (p: V3, a: number): V3 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];
/** distance from p to the segment a-b */
const segDist = (p: V3, a: V3, b: V3) => {
  const ab = v3.sub(b, a);
  const u = Math.min(1, Math.max(0, v3.dot(v3.sub(p, a), ab) / (v3.dot(ab, ab) || 1)));
  return v3.len(v3.sub(p, v3.add(a, v3.mul(ab, u))));
};
/** row and place of slot k in a filled arrowhead (row r holds 2r + 1) */
const arrow = (k: number): [number, number] => {
  let r = 0;
  let j = k;
  while (j >= 2 * r + 1) {
    j -= 2 * r + 1;
    r++;
  }
  return [r, j - r];
};

/**
 * Agent swarm, at war, on black. An armoured AI core (plated bands, a data
 * trench, two armillary rings, a shield that lights only where it is hit)
 * held by a swarm that moves through clear formations built round it (rings,
 * cages, battalions, a squadron carousel, a honeycomb shield), suited to the
 * moment, while the core keeps sending work out to its agents. Single
 * attacks from the 90-day feed are met in formation: a defence layer snaps
 * into the path of a blocked one, a V of interceptors runs down another. In
 * each war three enemy armies tear out of rifts in formation and charge the
 * core, and the defence answers with four maneuvers at once: a honeycomb
 * shield wall that the first army breaks on, a pincer whose wings sweep round
 * the second and close a ring that crushes it, a spearhead that punches
 * through the third and wheels back for a second pass, and gear rings round
 * the core that shred whatever is left. At each type's real harm rate an
 * attack (or, from an assault, a handful of survivors) gets through, and the
 * breach shows its kind: an injection spirals in, a hijack turns some of our
 * agents red until a repair cage purges them, a leak streams data out until
 * a plate cuts it, anything else infects a patch of armour; a second live
 * breach opens the core and the takeover runs module by module. Attack
 * volume is dramatised; the mix and the odds are the real ones.
 */
export function swarmWar({ intel }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const director = new WaveDirector(intel, 97);
  /** the director runs fourteen seconds ahead, so the first assault comes about eleven seconds in */
  const LEAD = 14;
  const rnd = director.rnd;
  const flashes = new Flashes();
  const MAXP = 6400;
  const pdata = new Float32Array(MAXP * POINT_STRIDE);
  let np = 0;
  let N = 0;
  let narrow = false;
  let agents: Agent[] = [];
  let attacks: Attack[] = [];
  let layers: Layer[] = [];
  let assault: Assault | null = null;
  let queued: { ev: FeedEvent; at: number } | null = null;
  let sparks: Spark[] = [];
  let packets: Packet[] = [];
  let effects: Effect[] = [];
  let infections: Infection[] = [];
  let takeover: Takeover | null = null;
  let lastTakeover = -99;
  const hits: { d: V3; t0: number; c: V3; k: number }[] = [];
  let scarAt = -99;
  let crackDir: V3 = [1, 0, 0];
  let attackIds = 0;
  let layerSeq = 0;
  let nextPacket = 0;
  let pulseAt = 1.2;
  let form = FORMATIONS.findIndex((x) => x.name === "SATURN RINGS");
  let prev = form;
  let formAt = 0;
  let formDur = 7;
  let cam: Cam = swayCam(0, [0, 0, 0], 5.8, 1.1);
  let camPull = 0;
  let open = 0;
  const mods = new Float32Array(24);
  const modC = new Float32Array(24);
  const gyro = new Float32Array(8);
  const hitU = new Float32Array(16);
  const hitC = new Float32Array(16);
  const infU = new Float32Array(12);
  const riftU = new Float32Array(12);
  const riftV = new Float32Array(12);

  const put = (p: V3, r: number, c: V3, k: number) => {
    if (np >= MAXP) return;
    const o = np * POINT_STRIDE;
    pdata[o] = p[0];
    pdata[o + 1] = p[1];
    pdata[o + 2] = p[2];
    pdata[o + 3] = r;
    pdata[o + 4] = c[0];
    pdata[o + 5] = c[1];
    pdata[o + 6] = c[2];
    pdata[o + 7] = k;
    np += 1;
  };
  /** 1 when a point sits in front of the core's disc (drawn dimmer, so the armour reads through), else 0 */
  let overCore = 0;
  /** whether the core hides a point from the camera (inside the core counts as seen while it is open); sets overCore */
  const hidden = (p: V3) => {
    overCore = 0;
    const e = cam.eye;
    const dx = p[0] - e[0];
    const dy = p[1] - e[1];
    const dz = p[2] - e[2];
    const L = Math.hypot(dx, dy, dz);
    const b = (e[0] * dx + e[1] * dy + e[2] * dz) / L;
    const h = b * b - (e[0] * e[0] + e[1] * e[1] + e[2] * e[2] - RC * RC);
    if (h < 0) return false;
    const tHit = -b - Math.sqrt(h);
    if (!(tHit > 0 && tHit < L - 0.02)) {
      overCore = 1;
      return false;
    }
    return !(open > 0.3 && v3.len(p) < RC);
  };
  const spark = (p: V3, t: number, n: number, cols: V3[], speed = 1) => {
    for (let k = 0; k < n; k++) {
      const d = v3.norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
      sparks.push({ p, v: v3.mul(d, (0.5 + rnd() * 1.5) * speed), t0: t, life: 0.45 + rnd() * 0.55, c: cols[k % cols.length]! });
    }
    if (sparks.length > 1100) sparks = sparks.slice(-1100);
  };
  /** an enemy destroyed: a burst of red and white, with a hot flash in the middle */
  const kill = (en: Enemy, t: number, n = 7) => {
    en.alive = false;
    spark(en.p, t, n, [RED, AMBER, WHITE], 1.1);
    sparks.push({ p: en.p, v: [0, 0, 0], t0: t, life: 0.3, c: WHITE });
  };
  const shieldHit = (d: V3, t: number, c: V3, k: number) => {
    hits.push({ d: v3.norm(d), t0: t, c, k });
    if (hits.length > 4) hits.shift();
  };
  /** the k nearest agents in formation to a point leave it for a job */
  const draft = (p: V3, k: number, role: number, job: number) => {
    const free: { i: number; d: number }[] = [];
    agents.forEach((a, i) => {
      if (a.role === FORM) free.push({ i, d: v3.len(v3.sub(a.p, p)) });
    });
    free.sort((a, b) => a.d - b.d);
    const out = free.slice(0, k).map((x) => x.i);
    for (const i of out) {
      agents[i]!.role = role;
      agents[i]!.job = job;
    }
    return out;
  };
  const release = (ids: number[]) => {
    for (const i of ids) {
      const a = agents[i];
      if (a) {
        a.role = FORM;
        a.job = -1;
      }
    }
  };
  const coreSpin = (t: number) => t * 0.12;
  const fromCore = (p: V3, s: number): V3 => [Math.cos(s) * p[0] + Math.sin(s) * p[2], p[1], -Math.sin(s) * p[0] + Math.cos(s) * p[2]];
  const toCore = (p: V3, s: number): V3 => [Math.cos(s) * p[0] - Math.sin(s) * p[2], p[1], Math.sin(s) * p[0] + Math.cos(s) * p[2]];
  const place = (f: number, s: number, t: number): V3 => FORMATIONS[f]!.at(s, N, t);

  /** Moves the swarm to a new formation: agents are paired with slots in order round the core (so no one cuts through it), and switch over in a wave that sweeps round. */
  const switchTo = (next: number, t: number) => {
    const key = (p: V3) => Math.floor((p[1] / (v3.len(p) || 1) + 1) * 1.5) * 10 + Math.atan2(p[2], p[0]);
    const slots = Array.from({ length: N }, (_, s) => ({ s, k: key(place(next, s, t + 1.5)) })).sort((a, b) => a.k - b.k);
    const order = agents.map((a, i) => ({ i, k: key(a.p) })).sort((a, b) => a.k - b.k);
    order.forEach((o, r) => {
      const a = agents[o.i]!;
      a.prevSlot = a.slot;
      a.slot = slots[r]!.s;
      a.delay = ((Math.atan2(a.p[2], a.p[0]) + Math.PI) / (2 * Math.PI)) * 1.4;
    });
    prev = form;
    form = next;
    formAt = t;
    formDur = 8 + rnd() * 3;
  };
  const pickForm = (t: number) => {
    const mood = director.phase(t + LEAD);
    const all = FORMATIONS.map((f, i) => ({ f, i })).filter((x) => x.i !== form);
    const fit = all.filter((x) => x.f.moods.includes(mood));
    const list = fit.length ? fit : all;
    return list[Math.floor(rnd() * list.length)]!.i;
  };

  const startTakeover = (t: number, dir: V3) => {
    lastTakeover = t;
    flashes.add(v3.mul(dir, RC), t, [1, 0.3, 0.15], 0.5);
    spark(v3.mul(dir, RC), t, 30, [RED, AMBER, WHITE], 1.4);
    crackDir = toCore(dir, coreSpin(t));
    const n = 3 + Math.floor(rnd() * 3);
    const order = [0, 1, 2, 3, 4, 5].sort(() => rnd() - 0.5).slice(0, n);
    const infectAt = order.map((_, k) => t + 0.5 + k * 0.7);
    const cleanAt = order.map((_, k) => t + 3 + n * 0.6 + k * 0.75);
    takeover = { t0: t, order, infectAt, cleanAt, end: cleanAt[n - 1]! + 1.4, closeAt: cleanAt[n - 1]! + 0.5, repairersAt: t + 1 };
  };
  const infect = (t: number, dir: V3, ev: FeedEvent) => {
    const local = toCore(dir, coreSpin(t));
    const squad = draft(v3.mul(dir, RC + 0.3), narrow ? 6 : 12, REPAIR, -1);
    infections.push({ ev, dir: local, t0: t, cleanAt: t + 3, end: t + 5.4, squad });
    if (infections.length > 3) {
      release(infections[0]!.squad);
      infections.shift();
    }
  };
  /** a breach lands: its own effect by the attack's kind; a second one while another is live opens the core */
  const breach = (t: number, dir: V3, ev: FeedEvent) => {
    if ((infections.length || effects.length) && !takeover && t - lastTakeover > 25) {
      startTakeover(t, dir);
      return;
    }
    flashes.add(v3.mul(dir, RC), t, [1, 0.3, 0.15], 0.3);
    spark(v3.mul(dir, RC), t, 20, [RED, AMBER, WHITE], 1.2);
    crackDir = toCore(dir, coreSpin(t));
    scarAt = t;
    const fx = fxOf(ev.category);
    if (fx === "patch") infect(t, dir, ev);
    else {
      const ids = fx === "defect" ? draft(v3.mul(dir, 1.55), narrow ? 6 : 12, FORM, -1) : [];
      for (const i of ids) agents[i]!.role = DEFECT;
      effects.push({ fx, ev, dir, t0: t, ids, cage: [], stage: 0 });
    }
  };

  /** where an army's formation centre is at time t */
  const armyCenter = (a: Army, t: number) => {
    const adv = Math.max(0, t - a.go) * 0.5;
    return v3.add(a.start, v3.mul(a.dir, Math.min(adv, Math.max(0, v3.len(a.start) - a.stop))));
  };
  /** Three armies tear out of three rifts, each in its own formation, each met by its own maneuver. */
  const startAssault = (ev: FeedEvent, t: number) => {
    const F = v3.norm(v3.sub(cam.target, cam.eye));
    const R = v3.norm(cross(F, [0, 1, 0]));
    const U = cross(R, F);
    const specs: { task: number; shape: EnemyShape; at: V3; size: number; stop: number }[] = [
      { task: WALL, shape: "BLOCK", at: [2.3, 1.9, 1.2], size: narrow ? 48 : 128, stop: 1.2 },
      { task: PINCER, shape: "HIVE", at: [2.5, -1.7, 0.8], size: narrow ? 40 : 100, stop: 2.25 },
      { task: SPEAR, shape: "CHEVRON", at: [-1.3, 2.6, 2.4], size: narrow ? 40 : 110, stop: 2.4 },
    ];
    const armies = specs.map((sp, i): Army => {
      const rift = v3.add(v3.add(v3.mul(R, sp.at[0]), v3.mul(U, sp.at[1])), v3.mul(F, sp.at[2]));
      const dir = v3.norm(v3.mul(rift, -1));
      const side = v3.norm(cross(dir, [0, 1, 0]));
      const up = cross(side, dir);
      const start = v3.add(rift, v3.mul(dir, 0.7));
      const enemies = Array.from({ length: sp.size }, (_, k): Enemy => ({ p: rift, v: [0, 0, 0], alive: true, born: t + 0.5 + i * 0.45 + k * 0.012, k, slip: false, dive: Infinity }));
      return { task: sp.task, shape: sp.shape, rift, riftUp: v3.norm(v3.add(up, v3.mul(side, 0.18))), dir, side, up, start, center: start, stop: sp.stop, go: t + 2.8 + i * 0.5, enemies };
    });
    // on a breach, the last few of the third army slip through every line
    if (ev.fate === "breach") armies[2]!.enemies.slice(-4).forEach((en) => (en.slip = true));
    const C = armies[2]!;
    const p0 = v3.mul(C.dir, -1.45);
    const aim = v3.norm(v3.sub(armyCenter(C, t + 5.6), p0));
    const turn = v3.norm(v3.sub(U, v3.mul(aim, v3.dot(U, aim))));
    assault = { ev, t0: t, armies, forces: [], breached: false, gear: v3.norm(v3.add(v3.mul(F, -1), [0, 0.35, 0])), p0, aim, turn };
    // the stage is cleared: layers, wings and patrol all join the forces
    for (const a of attacks) a.done = true;
    for (const l of layers) release(l.members);
    layers = [];
    for (const a of agents) if (a.role === LAYER || a.role === WING) a.role = FORM;
  };
  /** the spearhead's tip and heading at assault time u */
  const spearTip = (as: Assault, u: number): [V3, V3] => {
    const { p0, aim, turn } = as;
    if (u < 4.8) return [p0, aim];
    // the charge: two units at 2.4 a second, then a tight U-turn, then back
    const turnAt = 4.8 + 2 / 2.4;
    if (u < turnAt) return [v3.add(p0, v3.mul(aim, (u - 4.8) * 2.4)), aim];
    const S = v3.add(p0, v3.mul(aim, 2));
    if (u < turnAt + 1.2) {
      const b = ((u - turnAt) / 1.2) * Math.PI;
      const Q = v3.add(S, v3.mul(turn, 0.35));
      return [v3.add(Q, v3.add(v3.mul(turn, -0.35 * Math.cos(b)), v3.mul(aim, 0.35 * Math.sin(b)))), v3.norm(v3.add(v3.mul(turn, Math.sin(b)), v3.mul(aim, Math.cos(b))))];
    }
    // the second pass runs straight back at the core, through what is left of the army, and holds off the shield
    const back = v3.add(S, v3.mul(turn, 0.7));
    const home = v3.norm(v3.mul(back, -1));
    // it stops where its line comes within 1.9 of the core (never past it)
    const stopAt = Math.max(0, v3.len(back) - 1.9);
    return [v3.add(back, v3.mul(home, Math.min(stopAt, (u - turnAt - 1.2) * 2.2))), home];
  };
  /** the pincer's ring at assault time u: its radius and how far round each wing has swept */
  const pincerRing = (u: number): [number, number] => {
    const phi = u < 3.4 ? 0.3 : Math.min(Math.PI, 0.3 + ((u - 3.4) / 2.6) * (Math.PI - 0.3));
    const R = u < 6.6 ? 0.9 : Math.max(0.14, 0.9 - ((u - 6.6) / 3.2) * 0.76);
    return [R, phi];
  };
  /** where a task-force agent should be */
  const forceGoal = (as: Assault, f: number, k: number, m: number, t: number): V3 => {
    const u = t - as.t0;
    if (f === GEAR) return gearRings(k, m, t, as.gear);
    if (f === WALL) {
      const A = as.armies[0]!;
      return honeycombAt(k, m, v3.mul(A.dir, -1), 2.05, 0.18, 7);
    }
    if (f === PINCER) {
      const B = as.armies[1]!;
      const [R, phi] = pincerRing(u);
      const half = Math.ceil(m / 2);
      const wing = k < half ? -1 : 1;
      const j = k < half ? k : k - half;
      const th = wing * phi * ((j + 0.5) / half) + (u > 6 ? (u - 6) * 0.9 : 0);
      return v3.add(B.center, v3.add(v3.add(v3.mul(B.up, Math.cos(th) * R), v3.mul(B.side, Math.sin(th) * R)), v3.mul(B.dir, j % 2 ? 0.08 : -0.08)));
    }
    const [tip, tan] = spearTip(as, u);
    // the arrowhead lies flat to the camera, so it reads as a triangle
    const side = v3.norm(cross(tan, v3.sub(cam.eye, tip)));
    const [r, x] = arrow(k);
    return v3.add(tip, v3.add(v3.mul(tan, -r * 0.065), v3.mul(side, x * 0.055)));
  };
  /** splits the free agents into the four forces, each taking the agents nearest its station, ordered so they fan out without crossing */
  const formForces = (as: Assault, t: number) => {
    const free = agents.map((a, i) => i).filter((i) => agents[i]!.role === FORM);
    const n = free.length;
    const A = as.armies[0]!;
    const B = as.armies[1]!;
    const stations: V3[] = [[0, 0, 0], v3.mul(A.dir, -2.05), v3.add(B.center, v3.mul(B.dir, -1)), as.p0];
    const forces: number[][] = [[], [], [], []];
    const taken = new Set<number>();
    for (const f of [WALL, PINCER, SPEAR]) {
      const want = Math.round(n * FORCE_SHARE[f]!);
      const near = free.filter((i) => !taken.has(i)).sort((a, b) => v3.len(v3.sub(agents[a]!.p, stations[f]!)) - v3.len(v3.sub(agents[b]!.p, stations[f]!)));
      forces[f] = near.slice(0, want);
      for (const i of forces[f]!) taken.add(i);
    }
    forces[GEAR] = free.filter((i) => !taken.has(i));
    forces.forEach((ids, f) => {
      // pair agents with places by their order along a line across the force, so they fan out without crossing
      const m = ids.length;
      const axis: V3 = f === GEAR ? [1, 0, 0] : f === WALL ? A.side : f === PINCER ? B.side : v3.norm(cross(as.aim, as.turn));
      const places = Array.from({ length: m }, (_, k) => ({ k, d: v3.dot(forceGoal(as, f, k, m, t + 2), axis) })).sort((a, b) => a.d - b.d);
      const order = [...ids].sort((a, b) => v3.dot(agents[a]!.p, axis) - v3.dot(agents[b]!.p, axis));
      order.forEach((i, r) => {
        const a = agents[i]!;
        a.role = TASK;
        a.job = f;
        a.aux = places[r]!.k;
      });
    });
    as.forces = forces;
  };
  const endAssault = (t: number) => {
    if (!assault) return;
    for (const a of agents) if (a.role === TASK) a.role = FORM;
    assault = null;
    switchTo(pickForm(t), t);
  };

  return {
    frag: FRAG,
    fovY: 38,
    shift: 0.42,
    frame(f, set) {
      const t = f.t;
      const dt = Math.min(0.05, f.dt || 1 / 60);
      if (!N) {
        N = f.narrow ? 300 : 760;
        narrow = f.narrow;
        agents = Array.from({ length: N }, (_, i) => ({ p: place(form, i, t), v: [0, 0, 0] as V3, role: FORM, job: -1, aux: 0, heat: 0, slot: i, prevSlot: i, delay: 0, lead: i % 10 === 0 }));
      }
      // the camera pulls back a little while an assault is on, so the armies and the maneuvers fit
      camPull += ((assault && t - assault.t0 < 12.5 ? 1 : 0) - camPull) * Math.min(1, dt * 1.2);
      cam = swayCam(t, [0, 0, 0], (narrow ? 5 : 5.8) + camPull * 0.5, 1.1 + camPull * 0.2, 0.22, 0.15, 0.035);
      const sp = coreSpin(t);
      const dirT = t + LEAD;

      // --- patrol formations: a new one every eight to eleven seconds, suited to the phase
      if (!assault && t - formAt > formDur) switchTo(pickForm(t), t);

      // --- the director's waves
      const wave = director.tick(dirT);
      for (const ev of wave.attacks) {
        // while an assault or a takeover holds the stage, single attacks are left out (all of them,
        // whatever their fate, so the share of breaches on screen stays the real one)
        if (attacks.length > 8 || takeover || assault || queued) break;
        const s = attackStart(rnd, cam, 6.4 + rnd() * 1.2);
        const dir = v3.norm(s);
        let layer: Layer | null = null;
        let e: V3 = v3.mul(dir, RS);
        if (ev.fate === "blocked" && layers.length < 3) {
          const type = LAYER_TYPES[layerSeq++ % LAYER_TYPES.length]!;
          layer = { type, dir, members: [], until: Infinity };
          const m = 28;
          let c: V3 = [0, 0, 0];
          for (let k = 0; k < m; k++) c = v3.add(c, layerAt(type, dir, k, m, t));
          c = v3.mul(c, 1 / m);
          layer.members = draft(c, m, LAYER, layers.length);
          layers.push(layer);
          e = c;
        } else if (ev.fate === "breach") e = v3.mul(dir, RC * 0.98);
        const mid = v3.mix(s, e, 0.5);
        const side = v3.norm([-dir[2], (rnd() - 0.5) * 0.6, dir[0]]);
        const a: Attack = { id: ++attackIds, ev, s, c: v3.add(mid, v3.mul(side, (rnd() - 0.5) * 2.4)), e, t0: t, dur: 2.3 + rnd() * 0.9, layer, wing: null, head: s, done: false };
        if (ev.fate === "intercepted") {
          const ids = draft(v3.mul(dir, 1.75), 7, WING, a.id);
          if (ids.length) {
            const lead = v3.mul(ids.reduce((acc, i) => v3.add(acc, agents[i]!.p), [0, 0, 0] as V3), 1 / ids.length);
            a.wing = { ids, lead, v: [0, 0, 0] };
          }
        }
        attacks.push(a);
      }
      // the war's mass assault waits (a few seconds at most) for a running takeover to finish
      if (wave.swarm && !assault) queued = { ev: wave.swarm.ev, at: t };
      if (queued && t - queued.at > 8) queued = null;
      if (queued && !assault && !takeover) {
        startAssault(queued.ev, t);
        queued = null;
      }

      // --- single attacks in flight; interceptor wings chase them in a V
      for (const a of attacks) {
        if (a.done) continue;
        const u = Math.min(1, (t - a.t0) / a.dur);
        const w = 1 - u;
        a.head = [w * w * a.s[0] + 2 * w * u * a.c[0] + u * u * a.e[0], w * w * a.s[1] + 2 * w * u * a.c[1] + u * u * a.e[1], w * w * a.s[2] + 2 * w * u * a.c[2] + u * u * a.e[2]];
        if (a.wing) {
          const wg = a.wing;
          const want = v3.mul(v3.norm(v3.sub(a.head, wg.lead)), 3.1);
          wg.v = v3.add(wg.v, v3.mul(v3.sub(want, wg.v), Math.min(1, 5 * dt)));
          wg.lead = v3.add(wg.lead, v3.mul(wg.v, dt));
          if (u > 0.25 && v3.len(v3.sub(wg.lead, a.head)) < 0.15) {
            spark(a.head, t, 20, [RED, AMBER, WHITE], 1.2);
            flashes.add(a.head, t, [0.6, 0.9, 1], 0.18);
            release(wg.ids);
            a.done = true;
            continue;
          }
        }
        if (u < 1) continue;
        a.done = true;
        if (a.wing) release(a.wing.ids);
        if (a.ev.fate === "breach") breach(t, v3.norm(a.e), a.ev);
        else if (a.layer) {
          flashes.add(a.e, t, [0.45, 0.85, 1], 0.4);
          spark(a.e, t, 14, [RED, CYAN, WHITE]);
          a.layer.until = t + 1.2;
        } else {
          shieldHit(a.e, t, [0.5, 0.9, 1], 1);
          spark(a.e, t, 10, [RED, CYAN, WHITE]);
        }
      }
      attacks = attacks.filter((a) => !a.done);
      layers = layers.filter((l) => {
        if (t < l.until) return true;
        release(l.members);
        return false;
      });
      layers.forEach((l, k) => l.members.forEach((i) => (agents[i]!.job = k)));

      // --- the mass assault
      if (assault) {
        const as = assault;
        const u = t - as.t0;
        if (!as.forces.length && u > 1) formForces(as, t);
        const [pinR] = pincerRing(u);
        const [tip, tan] = spearTip(as, u);
        for (const army of as.armies) {
          army.center = armyCenter(army, t);
          const A = army;
          for (const en of A.enemies) {
            if (!en.alive || t < en.born) continue;
            if (en.v[0] === 0 && en.v[1] === 0 && en.v[2] === 0) {
              // out of the tear, sprayed along its length
              en.p = v3.add(A.rift, v3.mul(A.riftUp, (rnd() - 0.5) * 1.8));
              en.v = v3.add(v3.mul(A.dir, 0.6), v3.mul(v3.norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]), 0.8));
              if (en.k % 8 === 0) spark(en.p, t, 2, [RED, AMBER]);
            }
            // the third army's survivors break off after the spearhead's first pass; the slippers go last
            if (A.task === SPEAR && en.dive === Infinity && u > (en.slip ? 8.4 + (en.k % 4) * 0.25 : 7.4 + (en.k % 40) * 0.03)) en.dive = t;
            let goal: V3;
            let top = 1.6;
            if (t >= en.dive) {
              goal = v3.add(v3.mul(v3.norm(en.p), RC * 0.6), v3.mul(A.side, Math.sin(t * 3 + en.k) * 0.2));
              top = 1.5;
            } else {
              let o = v3.mul(enemySlot(A.shape, en.k, A.enemies.length, t), A.task === PINCER ? 1.2 : 1.55);
              if (A.task === PINCER && u > 6.6) o = v3.mul(o, Math.max(0.1, Math.min(1, (pinR - 0.1) / 0.6)));
              goal = v3.add(A.center, v3.add(v3.add(v3.mul(A.side, o[0]), v3.mul(A.up, o[1])), v3.mul(A.dir, o[2])));
            }
            const d = v3.sub(goal, en.p);
            const want = v3.mul(v3.norm(d), Math.min(top, v3.len(d) * 2.6 + 0.15));
            en.v = v3.add(en.v, v3.mul(v3.sub(want, en.v), Math.min(1, 4 * dt)));
            en.p = v3.add(en.p, v3.mul(en.v, dt));
            const r = v3.len(en.p);
            // the shield wall: the first army breaks on it
            if (A.task === WALL && as.forces.length) {
              const wd = v3.mul(A.dir, -1);
              if (v3.dot(en.p, wd) < 2.12 && Math.acos(Math.min(1, v3.dot(v3.mul(en.p, 1 / r), wd))) < 0.6) {
                kill(en, t, 6);
                continue;
              }
            }
            // the pincer's ring closes and crushes the second from the outside in
            if (A.task === PINCER && u > 6.6) {
              const o = v3.sub(en.p, A.center);
              const ax = v3.dot(o, A.dir);
              if (v3.len(v3.sub(o, v3.mul(A.dir, ax))) > pinR - 0.05 || u > 9.9) {
                kill(en, t, 5);
                continue;
              }
            }
            // the spearhead cuts through the third
            if (A.task === SPEAR && !en.slip && u > 4.8 && u < 10.5 && segDist(en.p, v3.add(tip, v3.mul(tan, -0.65)), v3.add(tip, v3.mul(tan, 0.12))) < 0.22) {
              kill(en, t, 6);
              continue;
            }
            // the gear rings shred anything that reaches them; the slippers get through and the first one breaches
            if (r < GEAR_R[2]! + 0.1 && !en.slip) {
              kill(en, t, 8);
              continue;
            }
            if (r < RS) {
              en.alive = false;
              if (!as.breached) {
                as.breached = true;
                breach(t, v3.norm(en.p), as.ev);
              } else {
                shieldHit(en.p, t, [0.5, 0.9, 1], 0.8);
                spark(en.p, t, 8, [RED, AMBER, WHITE]);
              }
            }
          }
        }
        if (u > 9.9 && u < 10) flashes.add(as.armies[1]!.center, t, [0.6, 0.9, 1], 0.5);
        const left = as.armies.some((a) => a.enemies.some((e) => e.alive));
        if (u > 13 || (u > 11 && !left)) endAssault(t);
      }

      // --- breach effects run their course
      for (const ef of effects) {
        const age = t - ef.t0;
        if (ef.fx === "spiral" && ef.stage === 0 && age > 1.3) {
          ef.stage = 1;
          infect(t, ef.dir, ef.ev);
        }
        if (ef.fx === "defect") {
          if (ef.stage === 0 && age > 1.8) {
            // a repair cage closes round the hijacked agents
            ef.stage = 1;
            ef.cage = draft(v3.mul(ef.dir, 1.55), narrow ? 10 : 18, REPAIR, -2);
          }
          if (ef.stage === 1 && age > 4.2) {
            ef.stage = 2;
            for (const i of ef.ids) {
              agents[i]!.role = FORM;
              agents[i]!.heat = 1;
            }
            flashes.add(v3.mul(ef.dir, 1.55), t, [0.6, 0.95, 1], 0.3);
          }
        }
        if (ef.fx === "exfil" && ef.stage === 0 && age > 0.9) {
          // a plate snaps across the stream and cuts it
          ef.stage = 1;
          const layer: Layer = { type: "AEGIS WALL", dir: ef.dir, members: [], until: ef.t0 + 3.8 };
          layer.members = draft(v3.mul(ef.dir, 1.8), 28, LAYER, layers.length);
          layers.push(layer);
        }
      }
      effects = effects.filter((ef) => {
        if (t - ef.t0 < (ef.fx === "defect" ? 4.7 : ef.fx === "exfil" ? 4 : 1.4)) return true;
        release(ef.cage);
        return false;
      });

      // --- the takeover: modules fall one by one, repair agents purge them, the core closes
      if (takeover) {
        const tk = takeover;
        if (tk.repairersAt > 0 && t >= tk.repairersAt) {
          tk.repairersAt = -1;
          draft(v3.mul(v3.norm(cam.eye), RC), narrow ? 18 : 40, REPAIR, 0);
        }
        if (t >= tk.end) {
          for (const a of agents)
            if (a.role === REPAIR && a.job === 0) {
              a.role = FORM;
              a.job = -1;
            }
          takeover = null;
          scarAt = t;
        }
      }

      // --- the sonar ping: a band of light over the core, then a wave through the swarm
      if (t > pulseAt + 4.2) pulseAt = t;
      const pulseR = (t - pulseAt - 0.9) * 1.6;

      // --- work packets between the core and its agents, while there is peace enough
      if (!assault && t > nextPacket && packets.length < 26) {
        nextPacket = t + 0.08;
        const i = Math.floor(rnd() * N);
        if (agents[i]!.role === FORM) packets.push({ a: i, t0: t, dur: 0.55 + rnd() * 0.3, back: rnd() < 0.4 });
      }

      // --- move the agents
      const forceSize = assault ? assault.forces.map((ids) => ids.length) : [];
      for (let i = 0; i < N; i++) {
        const a = agents[i]!;
        let goal: V3;
        let k = 6;
        let c = 3.6;
        if (a.role === LAYER && layers[a.job]) {
          const l = layers[a.job]!;
          goal = layerAt(l.type, l.dir, l.members.indexOf(i), l.members.length, t);
          k = 12;
          c = 5.5;
        } else if (a.role === WING && attacks.some((x) => x.id === a.job && x.wing)) {
          // a V behind the leader, along its heading
          const wg = attacks.find((x) => x.id === a.job)!.wing!;
          const j = wg.ids.indexOf(i);
          const fwd = v3.norm(v3.len(wg.v) > 0.1 ? wg.v : v3.mul(wg.lead, -1));
          const side = v3.norm(cross(fwd, [0, 1, 0]));
          const n = Math.ceil(j / 2);
          goal = v3.add(wg.lead, v3.add(v3.mul(fwd, -n * 0.08), v3.mul(side, (j % 2 ? 1 : -1) * n * 0.075)));
          k = 26;
          c = 9;
        } else if (a.role === TASK && assault) {
          goal = forceGoal(assault, a.job, a.aux, forceSize[a.job] || 1, t);
          k = a.job === SPEAR ? 30 : 10;
          c = a.job === SPEAR ? 10 : 5;
        } else if (a.role === DEFECT) {
          // hijacked: swirling in a red knot off the core
          const ef = effects.find((x) => x.ids.includes(i));
          if (!ef) {
            a.role = FORM;
            goal = a.p;
          } else {
            const K = v3.mul(ef.dir, 1.55);
            goal = v3.add(K, onCircle(v3.norm([Math.sin(i * 1.7), Math.cos(i * 2.3), Math.sin(i * 0.9)]), 0.16, t * 3.2 + i));
            k = 10;
            c = 4;
          }
        } else if (a.role === REPAIR && a.job === -2) {
          // the cage round a hijacked knot, a ring facing the camera, closing
          const ef = effects.find((x) => x.cage.includes(i));
          if (!ef) {
            a.role = FORM;
            goal = a.p;
          } else {
            const K = v3.mul(ef.dir, 1.55);
            const r = 0.42 - Math.min(1, Math.max(0, (t - ef.t0 - 1.8) / 2.4)) * 0.2;
            goal = v3.add(K, onCircle(v3.norm(v3.sub(cam.eye, K)), r, (ef.cage.indexOf(i) / ef.cage.length) * Math.PI * 2 + t * 1.5));
            k = 14;
            c = 6;
          }
        } else if (a.role === REPAIR && a.job === -1 && infections.some((x) => x.squad.includes(i))) {
          const inf = infections.find((x) => x.squad.includes(i))!;
          const w = fromCore(inf.dir, sp);
          const ang = t * 2.4 + i * 1.7;
          const side = v3.norm(cross(w, [0, 1, 0]));
          const up = cross(side, w);
          const rr = 0.12 + 0.1 * Math.sin(i * 3.1);
          goal = v3.add(v3.mul(w, RC + 0.07), v3.add(v3.mul(side, Math.cos(ang) * rr), v3.mul(up, Math.sin(ang) * rr)));
          k = 12;
          c = 5.5;
        } else if (a.role === REPAIR && a.job === 0 && takeover) {
          const order = takeover.order;
          const m = order[i % order.length] ?? 0;
          const base = fromCore(MOD_POS[m]!, sp);
          const ang = t * 3 + i;
          goal = v3.add(base, [Math.cos(ang) * 0.14, Math.sin(ang * 1.3) * 0.09, Math.sin(ang) * 0.14]);
          k = 12;
          c = 5.5;
        } else {
          if (a.role !== FORM) {
            a.role = FORM;
            a.job = -1;
          }
          // the switch-over sweeps round the core, each agent curving across to its new slot
          const useNew = t >= formAt + a.delay;
          const p = useNew ? place(form, a.slot, t) : place(prev, a.prevSlot, t);
          const prog = Math.min(1, Math.max(0, (t - formAt - a.delay) / 1.8));
          const curl = Math.sin(prog * Math.PI) * 0.3;
          goal = v3.add(p, [-p[2] * curl, 0, p[0] * curl]);
        }
        a.v = v3.add(a.v, v3.mul(v3.sub(v3.mul(v3.sub(goal, a.p), k), v3.mul(a.v, c)), dt));
        a.p = v3.add(a.p, v3.mul(a.v, dt));
        if (pulseR > 0 && Math.abs(v3.len(a.p) - pulseR) < 0.1) a.heat = 1;
        a.heat *= Math.exp(-dt * 3);
      }
      const drag = Math.exp(-dt * 2.5);
      for (const s of sparks) {
        s.v = v3.mul(s.v, drag);
        s.p = v3.add(s.p, v3.mul(s.v, dt));
      }
      sparks = sparks.filter((s) => t - s.t0 < s.life);

      // --- the core's state
      open = 0;
      let red = 0;
      MOD_POS.forEach((p, m) => {
        mods.set([p[0], p[1], p[2], 0.075], m * 4);
        modC.set([...(m % 2 ? CYAN : AMBER), 1.1], m * 4);
      });
      if (takeover) {
        const tk = takeover;
        open = Math.min(1, (t - tk.t0) / 0.7) * Math.min(1, Math.max(0, 1 - (t - tk.closeAt) / 0.8));
        tk.order.forEach((m, k) => {
          const inf = t >= tk.infectAt[k]! && t < tk.cleanAt[k]!;
          const wipe = t >= tk.cleanAt[k]! && t < tk.cleanAt[k]! + 0.45;
          if (inf) {
            red = 1;
            modC.set([...RED, 1.4 + (Math.sin(t * 23 + m * 5) > 0.3 ? 0.9 : 0)], m * 4);
          } else if (wipe) modC.set([...WHITE, 2.2], m * 4);
        });
      }
      infections = infections.filter((x) => {
        if (t < x.end) return true;
        release(x.squad);
        return false;
      });
      infU.fill(0);
      infections.forEach((x, k) => {
        const grow = Math.min(1, (t - x.t0) / 1.4);
        const shrink = Math.min(1, Math.max(0, (x.end - t) / (x.end - x.cleanAt)));
        infU.set([x.dir[0], x.dir[1], x.dir[2], 0.62 * grow * (1 - Math.pow(1 - shrink, 1.5))], k * 4);
        if (t < x.cleanAt) red = Math.max(red, 0.5);
      });
      const crack = takeover ? 1 : Math.max(0, 1 - (t - scarAt) / 6);

      // --- draw the points
      np = 0;
      for (const a of agents) {
        if (hidden(a.p)) continue;
        let col: V3 = a.lead ? WHITE : CYAN;
        let k = a.lead ? 2.4 : 1.5;
        if (a.role === TASK) {
          col = FORCE_COL[a.job]!;
          k = 2.4;
        } else if (a.role === LAYER) {
          col = [0.6, 0.95, 1];
          k = 2.2;
        } else if (a.role === WING) {
          col = WHITE;
          k = 2.6;
        } else if (a.role === REPAIR) {
          col = [0.55, 1, 0.8];
          k = 2.2;
        } else if (a.role === DEFECT) {
          col = RED;
          k = 2.6 + Math.sin(t * 20 + a.slot) * 0.6;
        }
        k = (k + a.heat * 1.8) * (overCore && a.role === FORM ? 0.45 : 1);
        put(a.p, 0.033, col, k);
        // a short wake when it moves fast
        const s = v3.len(a.v);
        if (s > 0.55) put(v3.sub(a.p, v3.mul(a.v, 0.05)), 0.026, col, k * Math.min(0.6, s * 0.3));
      }
      for (const pk of packets) {
        const a = agents[pk.a]!;
        const u = Math.min(1, (t - pk.t0) / pk.dur);
        const base = v3.mul(v3.norm(a.p), RC * 1.03);
        const from = pk.back ? a.p : base;
        const to = pk.back ? base : a.p;
        const head = v3.mix(from, to, u);
        if (!hidden(head)) {
          put(head, 0.024, pk.back ? CYAN : AMBER, 2.2);
          put(v3.mix(from, to, Math.max(0, u - 0.08)), 0.02, pk.back ? CYAN : AMBER, 1);
        }
        if (u >= 1 && !pk.back) a.heat = Math.max(a.heat, 0.7);
      }
      packets = packets.filter((pk) => t - pk.t0 < pk.dur);
      if (assault)
        for (const army of assault.armies)
          for (const en of army.enemies) {
            if (!en.alive || t < en.born || hidden(en.p)) continue;
            // a dart: a hot head and a red wake along its heading
            put(en.p, 0.04, [1, 0.5, 0.28], 3);
            const s = Math.max(0.3, v3.len(en.v));
            for (let q = 1; q <= 2; q++) put(v3.sub(en.p, v3.mul(en.v, (0.04 * q) / s)), 0.03, RED, 2 - q * 0.6);
          }
      for (const ef of effects) {
        const age = t - ef.t0;
        const e1 = v3.norm(cross(ef.dir, [0, 1, 0]));
        const e2 = cross(ef.dir, e1);
        if (ef.fx === "spiral") {
          // the injected prompt corkscrews down through the shield into the armour
          const pr = Math.min(1, age / 1.3);
          for (let q = 0; q < 26; q++) {
            const s = pr - q * 0.014;
            if (s < 0) break;
            const a = s * Math.PI * 6;
            const p = v3.add(v3.mul(ef.dir, RS + 0.4 - (RS + 0.4 - RC) * s), v3.add(v3.mul(e1, Math.cos(a) * 0.32 * (1 - s)), v3.mul(e2, Math.sin(a) * 0.32 * (1 - s))));
            if (!hidden(p)) put(p, 0.03, q ? RED : [1, 0.6, 0.4], q ? 2.2 - q * 0.07 : 3.4);
          }
        } else if (ef.fx === "exfil") {
          // data streaming out of the core, until the plate cuts it
          for (let j = 0; j < 120; j++) {
            const te = ef.t0 + j * 0.025;
            if (te > t || te > ef.t0 + 3) break;
            const r = RC + (t - te) * 1.3;
            if ((t > ef.t0 + 1.4 && r > 1.72) || r > 3.6) continue;
            const p = v3.add(v3.mul(ef.dir, r), v3.add(v3.mul(e1, Math.sin(j * 2.3) * 0.05), v3.mul(e2, Math.cos(j * 1.7) * 0.05)));
            if (!hidden(p)) put(p, 0.026, j % 3 ? AMBER : RED, 2);
          }
        }
      }
      for (const a of attacks) {
        put(a.head, 0.06, [1, 0.45, 0.3], 4.4);
        const u = Math.min(1, (t - a.t0) / a.dur);
        for (let j = 1; j <= 10; j++) {
          const uu = Math.max(0, u - j * 0.02);
          const w = 1 - uu;
          put([w * w * a.s[0] + 2 * w * uu * a.c[0] + uu * uu * a.e[0], w * w * a.s[1] + 2 * w * uu * a.c[1] + uu * uu * a.e[1], w * w * a.s[2] + 2 * w * uu * a.c[2] + uu * uu * a.e[2]], 0.034, RED, 2.3 - j * 0.2);
        }
      }
      for (const s of sparks) if (!hidden(s.p)) put(s.p, s.life < 0.35 ? 0.05 : 0.024, s.c, (s.life < 0.35 ? 4 : 2.6) * (1 - (t - s.t0) / s.life));

      // --- uniforms
      setCam(set, cam);
      set.f("uOpen", open);
      set.v4("uCrack", crackDir[0], crackDir[1], crackDir[2], crack);
      set.f("uRed", red);
      set.f("uSpin", sp);
      set.f("uWave", Math.min(1.01, Math.max(0, (t - pulseAt) / 0.9)));
      set.v4v("uMod", mods);
      set.v4v("uModC", modC);
      const g0 = rotYv(rotXv([0, 1, 0], 0.42), t * 0.21);
      const g1 = rotYv(rotZv([0, 1, 0], 1.08), -t * 0.16);
      gyro.set([g0[0], g0[1], g0[2], t * 0.3, g1[0], g1[1], g1[2], -t * 0.25]);
      set.v4v("uGyro", gyro);
      riftU.fill(0);
      riftV.fill(0);
      if (assault) {
        const as = assault;
        as.armies.forEach((A, i) => {
          const born = A.enemies[0]!.born;
          const out = A.enemies[A.enemies.length - 1]!.born;
          const o = Math.min(1, Math.max(0, (t - born + 0.4) / 0.8)) * Math.min(1, Math.max(0, 1 - (t - out - 0.8) / 1.2));
          riftU.set([A.rift[0], A.rift[1], A.rift[2], o], i * 4);
          riftV.set([A.riftUp[0], A.riftUp[1], A.riftUp[2], t - as.t0 + i * 3.1], i * 4);
        });
      }
      set.v4v("uRift", riftU);
      set.v4v("uRiftU", riftV);
      hitU.fill(-1);
      hitC.fill(0);
      hits.forEach((h, k) => {
        if (t - h.t0 > 1.4) return;
        hitU.set([h.d[0], h.d[1], h.d[2], t - h.t0], k * 4);
        hitC.set([h.c[0], h.c[1], h.c[2], h.k], k * 4);
      });
      set.v4v("uHit", hitU);
      set.v4v("uHitC", hitC);
      set.v4v("uInf", infU);
      set.v4v("uAtkT", NONE);
      set.v4v("uAtkH", NONE);
      flashes.pack(t, set);
      set.points(pdata, np, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      const t = f.t;
      const out: { text: string; x: number; y: number; tone?: string; anchor?: "start" | "middle" | "end" }[] = [];
      const clear = (s: { x: number; y: number } | null) => s && s.x > f.width * 0.48 && s.x < f.width - 40 && s.y > 16 && s.y < f.height - 36;
      out.push({ text: "sim · attack mix and breach odds from the last 90 days", x: f.width - 16, y: f.height - 16, tone: "dim", anchor: "end" });
      const sp = coreSpin(t);
      if (assault) {
        const as = assault;
        const u = t - as.t0;
        if (u > 0.8 && u < 4.6) {
          // the assault's tag rides above its armies
          const live = as.armies.flatMap((A) => A.enemies.filter((e) => e.alive && t >= e.born));
          if (live.length > 6) {
            const mid = v3.mul(live.reduce((acc, e) => v3.add(acc, e.p), [0, 0, 0] as V3), 1 / live.length);
            const s = projectPoint(mid, cam, f);
            if (clear(s)) out.push({ text: `${as.ev.kind} · mass assault · ${live.length}`, x: s!.x, y: s!.y - 40, tone: "hot", anchor: "middle" });
          }
        }
        if (u > 2.4 && u < 10.5 && as.forces.length) {
          // each maneuver named where it is happening
          const A = as.armies[0]!;
          const B = as.armies[1]!;
          const [R] = pincerRing(u);
          const [tip] = spearTip(as, u);
          const spots: [number, V3][] = [
            [GEAR, [0, GEAR_R[2]! + 0.2, 0]],
            [WALL, v3.add(v3.mul(A.dir, -2.05), v3.mul(A.up, 0.75))],
            [PINCER, v3.add(B.center, v3.mul(B.up, R + 0.2))],
            [SPEAR, v3.add(tip, [0, 0.25, 0])],
          ];
          for (const [force, p] of spots) {
            if (force === PINCER && u > 9.8) continue;
            const s = projectPoint(p, cam, f);
            if (clear(s)) out.push({ text: FORCE_NAME[force]!, x: s!.x, y: s!.y - 10, tone: "cyan", anchor: "middle" });
          }
        }
      }
      // the kind of each single attack rides it for most of its flight (two at most)
      let tags = 0;
      for (const a of attacks) {
        if (tags >= 2 || (t - a.t0) / a.dur > 0.8) continue;
        const s = projectPoint(a.head, cam, f);
        if (!clear(s)) continue;
        out.push({ text: a.ev.kind, x: s!.x, y: s!.y - 18, tone: "hot", anchor: "middle" });
        tags++;
      }
      if (takeover && t - takeover.t0 > 0.6 && t < takeover.closeAt) {
        // the takeover's latest step, on its module
        const tk = takeover;
        let k = -1;
        tk.order.forEach((_, j) => {
          if (t >= tk.infectAt[j]! && t < tk.cleanAt[j]!) k = j;
        });
        const m = tk.order[k];
        const s = m === undefined ? null : projectPoint(fromCore(MOD_POS[m]!, sp), cam, f);
        if (s && m !== undefined) out.push({ text: `takeover · ${STAGES[Math.min(k, STAGES.length - 1)]} · ${MODULES[m]}`, x: s.x, y: s.y - 16, tone: "hot", anchor: "middle" });
      } else {
        // the latest breach, by its kind and the technique behind it
        const ef = effects[effects.length - 1];
        const inf = infections[infections.length - 1];
        const pick = ef && (!inf || ef.t0 >= inf.t0) ? { fx: ef.fx, ev: ef.ev, p: v3.mul(ef.dir, 1.75), t0: ef.t0 } : inf ? { fx: "breach" as const, ev: inf.ev, p: v3.mul(fromCore(inf.dir, sp), RC + 0.25), t0: inf.t0 } : null;
        if (pick && t - pick.t0 < 3.6) {
          const s = projectPoint(pick.p, cam, f);
          const word = pick.fx === "breach" ? "breach" : FX_LABEL[pick.fx];
          if (clear(s)) out.push({ text: `${word} · ${pick.ev.tech} · ${pick.ev.target}`, x: s!.x, y: s!.y - 14, tone: "hot", anchor: "middle" });
        }
      }
      // middle-anchored labels are kept inside the frame (about 7.6 px a character at 12.5 px)
      for (const l of out)
        if (l.anchor === "middle") {
          const half = l.text.length * 3.8 + 8;
          l.x = Math.min(Math.max(l.x, half + 8), f.width - half - 8);
        }
      return out;
    },
  };
}
