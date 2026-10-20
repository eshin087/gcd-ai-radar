import type { ThreatIntel } from "@/lib/threatIntel";
import { POINT_STRIDE, projectPoint, type Cam, type GlyphController, type V3 } from "../engine";
import type { FeedEvent } from "../feed";
import { WaveDirector } from "./director";
import { setCam, type Emit } from "./kit";

const TAU = Math.PI * 2;
/** the station: ring radius, shield bubble radius, the model pods round the ring */
const RR = 3.5;
const RS = 4.8;
const NPOD = 9;
const PS = TAU / NPOD;
const NSEC = 14;
const NFX = 10;
const NHIT = 6;
/** the station's axis leans toward the bridge, and a little to the left */
const PITCH = 0.36;
const ROLL = 0.15;
const CP = Math.cos(PITCH);
const SP = Math.sin(PITCH);
const CR = Math.cos(ROLL);
const SR = Math.sin(ROLL);
/** station frame to world (rows): roll about z after pitch about x */
const M00 = CR;
const M01 = -SR * CP;
const M02 = SR * SP;
const M10 = SR;
const M11 = CR * CP;
const M12 = -CR * SP;
const M20 = 0;
const M21 = SP;
const M22 = CP;
const ST_GLSL = `mat3(${[M00, M10, M20, M01, M11, M21, M02, M12, M22].map((x) => x.toFixed(6)).join(", ")})`;

/**
 * The station's sections, named after the systems the feed's targets stand
 * for (SYSTEM_LABEL): 0 the core, 1 the upper stack, 2 the lower stack,
 * 3 the docking arms, 4 the habitat ring, 5..13 the model pods on the ring.
 */
const SECTIONS = ["the core", "self-hosted LLM", "internal AI apps", "MCP / tools", "employees", "ChatGPT", "Copilot", "Claude", "Gemini", "Bedrock", "Meta AI", "Mistral", "Grok", "Apple AI"];
/** how far red spreads through each section when it is breached (station units) */
const SEC_R = [0.6, 1.3, 1.3, 2.6, 2.4, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8];
/** a breach: red spreads, vents, repair drones arrive at REPAIR0, the red is gone by REPAIR1, the cyan glow by END */
const SPREAD = 1.6;
const DRONES_AT = 1.8;
const REPAIR0 = 2.8;
const REPAIR1 = 6.6;
const END = 8.2;

const CY: V3 = [0.35, 0.85, 1];
const AM: V3 = [1, 0.66, 0.3];
const RD: V3 = [1, 0.22, 0.14];
const WH: V3 = [0.9, 0.95, 1];
const FOE: V3 = [1, 0.36, 0.2];
const MEND: V3 = [0.55, 1, 0.8];
const SPARK_C = [CY, RD, AM, WH, MEND];

/** the lens: on a wide hero the station takes about 60% of the window, leaving room for the battle round it */
const FOV = 50;
const TY0 = Math.tan((FOV * Math.PI) / 360);
const TX0 = TY0 * 1.888;
/** a point of the resting wide view (canvas NDC) as a direction in the sky chart (tan space) */
const skyUV = (nx: number, ny: number) => `vec2(${((nx - 0.4) * TX0).toFixed(4)}, ${(ny * TY0).toFixed(4)})`;

/** the dish's feed horn (station frame), where the amber uplink light sits */
const FEED: V3 = [-0.3 - 0.375 * Math.sin(0.7), 3.3 + 0.375 * Math.cos(0.7), 0];

const FRAG = `
uniform vec3 uEye;
uniform vec3 uTarget;
uniform vec4 uHead;
uniform vec4 uRim;
uniform vec4 uSt;
uniform vec4 uPlanet;
uniform vec3 uSun;
uniform vec3 uFill;
uniform vec3 uSkyR;
uniform vec3 uSkyU;
uniform vec3 uSkyF;
uniform vec4 uBrO[${NSEC}];
uniform vec4 uBrS[${NSEC}];
uniform vec4 uHit[${NHIT}];
uniform vec4 uHitC[${NHIT}];
uniform vec4 uFx[${NFX}];
uniform vec4 uFxC[${NFX}];

const vec3 CY = vec3(.35, .85, 1.);
const vec3 AM = vec3(1., .66, .3);
const vec3 RD = vec3(1., .22, .14);
const float RR = ${RR.toFixed(2)};
const float RS = ${RS.toFixed(2)};
const float PS = ${PS.toFixed(6)};
const mat3 ST = ${ST_GLSL};
const vec3 FEED = vec3(${FEED.map((x) => x.toFixed(4)).join(", ")});

float sdCyl(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.) + length(max(d, 0.)); }
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.); }
float cov(float d, float w){ return clamp(d/max(w, 1e-5) + .5, 0., 1.); }
/** coverage of a box of half size hw centred in a unit cell, filtered over the footprint fw (cell units) */
float boxCov(vec2 f, vec2 hw, vec2 fw){ vec2 d = hw - abs(f - .5); return cov(d.x, fw.x)*cov(d.y, fw.y); }
vec3 ringFrame(vec3 p){ p.xz = rot2(uSt.x)*p.xz; return p; }
vec3 fromRing(vec3 p){ p.xz = rot2(-uSt.x)*p.xz; return p; }

/**
 * The station in its own frame (y up the spindle): material ids 0 the core's
 * cage, 1 the upper stack, 2 the lower stack, 3 the docking arms, 4 the ring,
 * 5..13 the model pods, 14 the core, 15 the spokes, 16 the comms crown.
 * Parts far from a ray are skipped behind a bound, so the march stays cheap.
 */
vec2 mapSt(vec3 p){
  float rxz = length(p.xz);
  vec2 r = vec2(1e5, -1.);
  float d;
  if(rxz < 1.4){
    d = sdCyl(p - vec3(0., 1.8, 0.), .6, .95);
    d = min(d, sdCyl(p - vec3(0., .97, 0.), .78, .08));
    d = min(d, sdCyl(p - vec3(0., 1.85, 0.), .7, .06));
    d = min(d, sdCyl(p - vec3(0., 2.68, 0.), .76, .09));
    r = vec2(d, 1.);
    d = sdCyl(p - vec3(0., 3., 0.), .34, .24);
    d = min(d, sdCyl(p - vec3(0., 3.7, 0.), .035, .5));
    vec3 q = p - vec3(-.3, 3.3, 0.);
    q.xy = rot2(-.7)*q.xy;
    d = min(d, max(abs(length(q - vec3(0., .75, 0.)) - .75) - .025, q.y - .2));
    if(d < r.x) r = vec2(d, 16.);
    d = min(sdCyl(p - vec3(0., .66, 0.), .7, .06), sdCyl(p - vec3(0., -.66, 0.), .7, .06));
    d = min(d, sdCyl(vec3(p.x, abs(p.y) - .78, p.z), .3, .1));
    float a = atan(p.z, p.x);
    float la = a - floor(a/(PI/3.) + .5)*(PI/3.);
    d = min(d, sdBox(vec3(cos(la)*rxz - .64, p.y, sin(la)*rxz), vec3(.04, .66, .04)));
    if(d < r.x) r = vec2(d, 0.);
    d = length(p) - .42;
    if(d < r.x) r = vec2(d, 14.);
    d = sdCyl(p - vec3(0., -1.7, 0.), .7, .95);
    d = min(d, sdCyl(p - vec3(0., -.97, 0.), .92, .09));
    d = min(d, sdCyl(p - vec3(0., -1.75, 0.), 1., .15));
    d = min(d, sdCyl(p - vec3(0., -2.5, 0.), .86, .09));
    d = min(d, sdCyl(p - vec3(0., -2.95, 0.), .42, .3));
    if(d < r.x) r = vec2(d, 2.);
  } else r.x = rxz - 1.05;
  float ya = abs(p.y + 1.75);
  if(ya < 1.){
    d = sdBox(p - vec3(0., -1.75, 0.), vec3(4.15, .09, .12));
    d = min(d, sdBox(vec3(abs(p.x) - 4.3, p.y + 1.75, p.z), vec3(.2, .3, .3)));
    d = min(d, sdBox(vec3(abs(p.x) - 2.4, p.y + 1.75, p.z), vec3(.14, .17, .2)));
    if(d < r.x) r = vec2(d, 3.);
  } else r.x = min(r.x, ya - .45);
  float rb = max(abs(rxz - RR) - .65, abs(p.y) - .45);
  if(rb < .5){
    vec2 td = abs(vec2(rxz - RR, p.y)) - vec2(.2, .23);
    d = length(max(td, 0.)) + min(max(td.x, td.y), 0.);
    if(d < r.x) r = vec2(d, 4.);
    vec3 pr = ringFrame(p);
    float ar = atan(pr.z, pr.x);
    float k = floor(ar/PS + .5);
    float lp = ar - k*PS;
    d = sdBox(vec3(cos(lp)*rxz - RR, pr.y, sin(lp)*rxz), vec3(.3, .34, .46)) - .04;
    if(d < r.x) r = vec2(d, 5. + mod(k + 9., 9.));
  } else r.x = min(r.x, rb);
  if(rxz < RR && abs(p.y) < .5){
    vec3 pr = ringFrame(p);
    float ar = atan(pr.z, pr.x) - PS*.5;
    float ls = ar - floor(ar/(2.*PI/3.) + .5)*(2.*PI/3.);
    vec3 s = vec3(cos(ls)*rxz, pr.y, sin(ls)*rxz);
    s.x -= clamp(s.x, .7, RR - .15);
    d = length(s) - .055;
    if(d < r.x) r = vec2(d, 15.);
  } else r.x = min(r.x, max(rxz - RR, abs(p.y) - .06));
  return r;
}

vec3 normSt(vec3 p){
  const vec2 k = vec2(1., -1.);
  const float e = .008;
  return normalize(k.xyy*mapSt(p + k.xyy*e).x + k.yyx*mapSt(p + k.yyx*e).x + k.yxy*mapSt(p + k.yxy*e).x + k.xxx*mapSt(p + k.xxx*e).x);
}

/** the station's surface: hull lit by the sun and the core, windows, running lights, and a breach where there is one */
vec3 shadeSt(vec3 p, vec3 n, float m, vec3 rd, float t, vec3 L, vec3 F){
  float fpw = t*2.*uTan.y/uRes.y;
  vec3 pr = ringFrame(p);
  float rxz = length(p.xz);
  vec3 rad = vec3(p.x, 0., p.z)/max(rxz, 1e-3);
  float dif = max(dot(n, L), 0.);
  float ndv = max(dot(n, -rd), 0.);
  float rim = pow(1. - ndv, 3.);
  float coreL = max(dot(n, -p/max(length(p), 1e-3)), 0.)*uSt.y/(1. + dot(p, p)*.3);
  float alb = .9;
  vec3 emit = vec3(0.);
  float win = 0.;
  float spec = 0.;
  if(m > 13.5 && m < 14.5){
    // the core: white-hot, cyan at the rim, latitude bands turning
    float fr = pow(1. - ndv, 2.);
    vec3 q = p; q.xz = rot2(uTime*.5)*q.xz;
    float bands = pow(abs(sin(asin(clamp(q.y/.42, -1., 1.))*6. + uTime*1.3)), 14.);
    emit = (mix(vec3(1., .96, .9)*7., CY*3.2, fr) + CY*bands*2.)*uSt.y;
    alb = 0.;
  } else if(m < .5){
    alb = 1.;
  } else if(m < 2.5){
    // the stacks: a drum of windows between panel seams, collars of chasing lights
    float rD = m < 1.5 ? .6 : .7;
    float ang = atan(p.z, p.x);
    if(abs(n.y) < .5 && rxz < rD + .05){
      // rows of windows, whole rows lit or dark, split by mullions; a pulse of activity climbs the stack
      vec2 g = vec2(ang*rD/.19, p.y/.24);
      float row = floor(g.y);
      float lit = step(.3, hash12(vec2(row, m*7.)));
      win = boxCov(fract(g), vec2(.36, .17), vec2(fpw/.19, fpw/.24))*lit;
      float pulse = exp(-pow(fract(p.y*.22 - uTime*.12 + m*.37) - .5, 2.)/.002);
      emit += mix(vec3(.75, .94, 1.), CY, step(.6, hash12(vec2(row, m))))*win*(2. + 3.*pulse);
      float seam = abs(fract(ang*6./PI) - .5);
      alb *= 1. - .8*smoothstep(.5 - .04 - fpw*1.5, .5, seam);
    } else if(abs(n.y) < .5){
      float k = fract(ang/6.2831853 + uTime*(m < 1.5 ? .12 : -.12));
      emit += CY*(1.8 + 3.*exp(-pow((k - .5)/.04, 2.)));
    }
  } else if(m < 3.5){
    float ax = abs(p.x);
    if(ax > 4.08){
      // the berths: reserve agents docked in rows of bays
      vec2 g = vec2(p.z + .3, p.y + 2.05)/.15;
      vec2 c = floor(g);
      if(n.x*sign(p.x) > .5) emit += CY*boxCov(fract(g), vec2(.24), vec2(fpw/.15))*step(.35, hash12(c + sign(p.x)*3.))*2.2;
    } else {
      // amber traffic running out along the beams to the tools
      float k = fract(ax*1.2 - uTime*.8);
      emit += AM*(1. - smoothstep(0., .12 + fpw*1.2, k))*2.6*step(.5, abs(n.z) + max(n.y, 0.));
    }
  } else if(m < 4.5){
    float nr = dot(n, rad);
    float s = atan(pr.z, pr.x)*RR;
    vec2 tq = abs(vec2(rxz - RR, p.y));
    float ed = max(.2 - tq.x, .23 - tq.y);
    emit += CY*(1. - smoothstep(.012, .012 + fpw, ed))*(2.3 - .9*step(p.y, 0.));
    if(nr > .55){
      // the habitat deck: one strip of windows round the outside, in segments
      float g = s/.6;
      win = cov(.07 - abs(p.y - .02), fpw)*cov(.42 - abs(fract(g) - .5), fpw/.6);
      emit += mix(vec3(.75, .94, 1.), CY, step(.5, hash12(vec2(floor(g), 3.))))*win*(2.4 + 1.*hash12(vec2(floor(g), 5.)));
      alb *= .75;
    } else if(nr < -.55){
      float g = s/.45;
      win = cov(.05 - abs(p.y), fpw)*cov(.3 - abs(fract(g) - .5), fpw/.45);
      emit += vec3(.75, .94, 1.)*win*1.6;
    } else if(n.y > .5){
      // the ring's back: radiator panels in rows that catch the sun
      float k = abs(fract(s/.3) - .5);
      alb = .85*(1. - .85*smoothstep(.4 - fpw/.3, .5, k));
      spec = pow(max(dot(reflect(rd, n), L), 0.), 10.)*.8;
    }
  } else if(m < 13.5){
    // a model pod: a rack of blinking LEDs, a glowing waist seam, a strobe on top
    float ar = atan(pr.z, pr.x);
    float kk = floor(ar/PS + .5);
    float lp = ar - kk*PS;
    vec3 pp = vec3(cos(lp)*rxz - RR, pr.y, sin(lp)*rxz);
    vec3 de = vec3(.34, .38, .5) - abs(pp);
    float e2 = max(min(de.x, de.y), min(max(de.x, de.y), de.z));
    emit += CY*(1. - smoothstep(.02, .02 + fpw, e2))*2.3;
    if(dot(n, rad) > .5){
      // a rack of LEDs in a grid, each blinking at its own pace
      vec2 g = vec2(pp.z/.23 + .5, (pp.y + .34)/.17);
      vec2 c = floor(g);
      float h = hash12(c + kk*7.);
      float on = step(.3, fract(uTime*(.3 + h*.9) + h*9.))*step(.5, c.y)*step(c.y, 2.5)*step(-1.5, c.x)*step(c.x, 1.5);
      win = boxCov(fract(g), vec2(.24, .22), vec2(fpw/.23, fpw/.17))*on;
      emit += mix(CY, vec3(.85, .96, 1.), step(.8, h))*win*3.;
      alb *= .8;
    }
    if(abs(n.y) < .5) emit += CY*2.2*(1. - smoothstep(0., .025 + fpw, abs(pp.y)));
    if(n.y > .5){
      vec2 o = pp.xz - vec2(.18, 0.);
      emit += vec3(.9, .96, 1.)*exp(-dot(o, o)/.006)*step(.9, fract(uTime*.45 - mod(kk + 9., 9.)/9.))*3.;
    }
  } else if(m < 15.5){
    // the spokes: data pulses running out to the ring
    float e = fract(rxz*.5 - uTime*.55);
    emit += CY*exp(-pow((e - .5)/.06, 2.))*2.6;
    alb = .7;
  }
  float fil = max(dot(n, F), 0.);
  // dark hull faces, the sun on the tops, and a cool rim on every silhouette: the form is carried by light, not by a fill
  vec3 col = alb*(vec3(.85, .9, 1.)*dif*1.05 + vec3(.3, .45, .7)*fil*.1 + vec3(.012, .016, .03) + vec3(.3, .55, .8)*coreL*2.2 + vec3(.45, .7, 1.)*pow(1. - ndv, 4.)*.6 + vec3(.8, .85, 1.)*spec) + emit;
  // a breach: red spreads through the section from the hole, flickering; repair drones push it back with a bright front; then it glows cyan
  float sec = m < 13.5 ? m : m < 14.5 ? 0. : -1.;
  if(sec > -.5){
    int si = int(sec + .5);
    vec4 O = uBrO[si];
    vec4 S = uBrS[si];
    if(S.x + S.z > 0.){
      vec3 ps = si >= 4 ? pr : p;
      float d = length(ps - O.xyz);
      float red = (1. - smoothstep(O.w - .08, O.w + .08, d))*S.x;
      float fl = .5 + .5*step(.42, hash12(vec2(floor(uTime*13.), sec*3.1 + floor(d*5.))));
      vec3 hot = RD*(.8 + 1.6*fl)*(.6 + .8*dif) + RD*win*4.*fl + vec3(1., .55, .35)*exp(-d*d/.03)*4.*S.x;
      col = mix(col, hot, red);
      col += vec3(.55, 1., .85)*S.y*exp(-pow((d - O.w)/.07, 2.))*3.5;
      col += CY*S.z*(.5 + win*2.5 + rim);
    }
  }
  return col;
}

/** lights that are not surfaces: the core's halo, the mast beacon, the uplink, red glows over breaches */
vec3 glows(vec3 ro, vec3 rd, float tSt){
  vec3 col = vec3(0.);
  float tc = dot(-ro, rd);
  vec3 cc = mix(CY, RD, uBrS[0].x);
  if(tSt < 0. || tSt > tc - .5) col += (vec3(1., .95, .88)*pointGlow(ro, rd, vec3(0.), .45)*1.8 + cc*pointGlow(ro, rd, vec3(0.), .85)*.3)*uSt.y;
  vec3 b = vec3(0., 4.22, 0.);
  if(tSt < 0. || tSt > dot(b - ro, rd) - .1) col += vec3(.85, .95, 1.)*pointGlow(ro, rd, b, .07)*step(.84, fract(uTime*.55))*5.;
  if(tSt < 0. || tSt > dot(FEED - ro, rd) - .1) col += AM*pointGlow(ro, rd, FEED, .06)*(2. + 2.*step(.5, fract(uTime*1.3)));
  for(int i = 0; i < ${NSEC}; i++){
    vec4 S = uBrS[i];
    if(S.x <= 0.) continue;
    vec3 o = uBrO[i].xyz;
    if(i >= 4) o = fromRing(o);
    col += RD*pointGlow(ro, rd, o, .22 + uBrO[i].w*.15)*S.x*1.2*(.7 + .3*sin(uTime*17. + float(i)));
  }
  return col;
}

vec4 hexCell(vec2 p){
  const vec2 s = vec2(1., 1.7320508);
  vec4 hc = floor(vec4(p, p - vec2(.5, 1.))/s.xyxy) + .5;
  vec4 h = vec4(p - hc.xy*s, p - (hc.zw + .5)*s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hc.xy) : vec4(h.zw, hc.zw + .5);
}
/** distance from a point in its hex cell to the cell's edge (0 on the edge, .5 at the centre) */
float hexEdge(vec2 h){ h = abs(h); return .5 - max(dot(h, vec2(.5, .8660254)), h.x); }

/** the shield bubble: all but invisible, until a hit lights a patch of hexes that spreads, ripples and fades */
vec3 shield(vec3 ro, vec3 rd, float tSt){
  vec2 h = sphIsect(ro, rd, vec3(0.), RS);
  if(h.y < 0.) return vec3(0.);
  vec3 col = vec3(0.);
  float pxw = 2.*uTan.y/uRes.y;
  for(int k = 0; k < 2; k++){
    float th = k == 0 ? h.x : h.y;
    if(th <= 0. || (k == 1 && tSt > 0.)) continue;
    vec3 n = (ro + rd*th)/RS;
    float ndr = abs(dot(n, rd));
    vec3 c = vec3(0.);
    for(int i = 0; i < ${NHIT}; i++){
      vec4 H = uHit[i];
      if(H.w < 0.) continue;
      float sz = uHitC[i].w;
      float ca = dot(n, H.xyz);
      if(ca < cos(sz*1.8)) continue;
      float ang = acos(clamp(ca, -1., 1.));
      vec3 t1 = normalize(cross(H.xyz, abs(H.y) > .9 ? vec3(1., 0., 0.) : vec3(0., 1., 0.)));
      vec3 t2 = cross(H.xyz, t1);
      vec4 hx = hexCell(vec2(dot(n, t1), dot(n, t2))*RS/.34);
      float fw = th*pxw/.34/max(ndr, .25);
      float line = 1. - smoothstep(0., fw*1.2 + .02, hexEdge(hx.xy));
      float age = H.w;
      float spread = ang/(sz*1.8);
      float cellH = hash12(hx.zw + float(i)*7.);
      // cells light outward from the hit, each a moment after the last, and burn out from the rim inward
      float lit = step(spread + cellH*.15, age*4.)*exp(-age*(1.4 + 2.2*spread))*(1. - smoothstep(.55, 1., spread));
      c += uHitC[i].rgb*(line*2.8 + .25 + .5*step(.72, cellH))*lit*(.8 + .2*sin(age*40. + cellH*20.));
      c += vec3(1.)*exp(-ang*ang/(sz*sz*.04))*exp(-age*7.)*5.;
    }
    col += c*(k == 0 ? 1. : .5);
  }
  return col;
}

/** explosions: a white-hot ball swelling and cooling to its colour (the sparks carry the rest) */
vec3 fireballs(vec3 ro, vec3 rd, float tSt){
  vec3 col = vec3(0.);
  for(int i = 0; i < ${NFX}; i++){
    vec4 F = uFx[i];
    if(F.w < 0.) continue;
    vec3 oc = F.xyz - ro;
    float tt = dot(oc, rd);
    if(tt < 0. || (tSt > 0. && tt > tSt + .3)) continue;
    float d = length(oc - rd*tt);
    float sz = uFxC[i].w;
    float age = F.w;
    vec3 hot = mix(vec3(1., .95, .85), uFxC[i].rgb, smoothstep(0., .3, age));
    col += hot*exp(-d*d/(sz*sz*.1*(1. + age*3.) + .001))*exp(-age*4.)*5.;
  }
  return col;
}

/** a nebula with structure: a warped band of ridged filaments, cut by dust lanes, warm round its star; empty outside its envelope */
vec3 nebula(vec2 uv){
  vec2 c = uv - ${skyUV(0.74, 0.47)};
  vec2 ax = vec2(.94, -.34);
  float al = dot(c, ax), ac = dot(c, vec2(-ax.y, ax.x));
  float env = exp(-ac*ac/.0045)*(1. - smoothstep(.1, .3, abs(al)));
  if(env < .03) return vec3(0.);
  vec3 p = vec3(uv*vec2(6., 7.), .7);
  vec2 w = vec2(fbm3(p), fbm3(p + vec3(5.2, 1.3, 2.1))) - .5;
  float n = fbm(vec3(uv*vec2(9., 10.) + w*1.6, 1.9));
  float ridge = pow(1. - abs(n*2. - 1.), 6.);
  float dust = smoothstep(.5, .66, fbm3(vec3(uv*14. + w*.8, 4.4)));
  float body = smoothstep(.35, .75, n*env + env*.25);
  vec2 sd = uv - ${skyUV(0.83, 0.5)};
  vec3 col = vec3(.14, .2, .5)*body*.3 + vec3(.25, .55, .85)*ridge*env*1.2;
  col += vec3(.75, .42, .28)*ridge*ridge*exp(-dot(sd, sd)/.003)*.5;
  col *= (1. - dust*.9)*smoothstep(.03, .25, env);
  return max(col - .07, 0.)*2.;
}

vec3 stars(vec2 uv, float sc, float dens, float br){
  vec2 g = uv*sc;
  vec2 c = floor(g);
  float h = hash12(c + sc);
  if(h < 1. - dens) return vec3(0.);
  vec2 o = vec2(hash12(c + 3.1), hash12(c + 5.7))*.6 + .2;
  vec2 dp = (g - c - o)/sc/(2.*uTan/uRes);
  float b = pow(fract(h*91.7), 3.)*br + br*.12;
  float tw = .65 + .35*sin(uTime*(.8 + h*2.) + h*60.);
  return mix(vec3(.7, .8, 1.), vec3(1., .86, .7), hash12(c + 9.2))*b*tw*exp(-dot(dp, dp)*1.1);
}

/** deep space through the window: stars at infinity, the nebula and a distant star with four spikes */
vec3 sky(vec3 rd){
  float z = dot(rd, uSkyF);
  if(z < .1) return vec3(0.);
  vec2 uv = vec2(dot(rd, uSkyR), dot(rd, uSkyU))/z;
  vec3 col = stars(uv, 80., .014, 1.3) + stars(uv, 170., .006, .45);
  col += nebula(uv);
  vec2 d = (uv - ${skyUV(0.83, 0.5)})/(2.*uTan/uRes);
  float r2 = dot(d, d);
  col += vec3(1., .93, .82)*(exp(-r2*.5)*2.2 + exp(-r2/30.)*.12);
  col += vec3(.85, .9, 1.)*(exp(-abs(d.y)*1.8)*exp(-abs(d.x)/14.) + exp(-abs(d.x)*1.8)*exp(-abs(d.y)/7.))*.45;
  return col;
}

/** the planet below: a lit crescent and its atmosphere along the limb, city lights in clusters on the night side */
vec3 planet(vec3 ro, vec3 rd, out float cover){
  cover = 0.;
  vec3 C = uPlanet.xyz;
  float R = uPlanet.w;
  vec3 oc = C - ro;
  float tc = dot(oc, rd);
  if(tc < 0.) return vec3(0.);
  vec3 cl = ro + rd*tc;
  float b = length(cl - C);
  float pxw = 2.*uTan.y/uRes.y*tc;
  vec3 ln = (cl - C)/max(b, 1e-3);
  float sunSide = smoothstep(-.5, .6, dot(ln, uSun));
  float hgt = (b - R)/pxw;
  vec3 col = vec3(.3, .62, 1.)*exp(-max(hgt, 0.)/1.4)*step(-.5, hgt)*(.3 + 2.2*sunSide);
  if(b < R){
    cover = cov(R - b, pxw);
    float tt = tc - sqrt(R*R - b*b);
    vec3 n = normalize(ro + rd*tt - C);
    float mu = dot(n, uSun);
    float day = smoothstep(.02, .35, mu);
    float cl1 = fbm3(n*vec3(9., 14., 9.) + vec3(0., 0., uTime*.004));
    vec3 pc = vec3(.45, .6, .8)*day*smoothstep(.5, .7, cl1)*1.4*exp(-(R - b)/(R*.012));
    float cluster = smoothstep(.6, .72, fbm3(n*16. + 3.));
    pc += AM*step(.8, hash13(floor(n*150.)))*cluster*(1. - day)*1.1;
    col = mix(col, pc + col*.3, cover);
  }
  return col;
}

/** the consoles along the sill: the top of the hull at x, and which console it is (id, left, right, nominal top) */
float consoleTop(float x, out vec4 info){
  bool nar = uHead.z > .5;
  float top = nar ? -.88 : -.8 + .015*x;
  info = vec4(-1., 0., 0., 0.);
  for(int i = 0; i < 3; i++){
    float fi = float(i);
    float c = nar ? (fi - 1.)*.58 : (i == 0 ? .17 : i == 1 ? .47 : .76);
    float hw = nar ? .21 : (i == 1 ? .13 : .1);
    float h = nar ? -.8 : (i == 1 ? -.715 : -.7);
    float e = hw - abs(x - c);
    if(e <= 0.) continue;
    float tp = h - max(0., .03 - e)*1.5;
    if(tp > top){ top = tp; info = vec4(fi, c - hw, c + hw, h); }
  }
  return top;
}

/**
 * The bridge in canvas NDC: the struts either side of the viewport, the top
 * of the window frame (an arch, with corner braces) and the consoles on the
 * sill. Near-black silhouettes: only a rim of the battle's light on every
 * edge, a fainter bevel, a few panel seams and the consoles' tiny readouts.
 * Returns how much of the pixel is hull.
 */
float bridge(vec2 q, out vec3 fc){
  fc = vec3(0.);
  vec2 px = 2./uRes;
  bool nar = uHead.z > .5;
  float yy = q.y*.5 + .5;
  float xL = nar ? -.955 + .03*yy : -.01 + .075*yy;
  float xR = nar ? .955 - .03*yy : .935 - .06*yy;
  float u = (q.x - .46)/.6;
  float yT = nar ? .87 - .05*q.x*q.x : .8 - .08*u*u;
  float dL = (xL - q.x)/px.x;
  float dR = (q.x - xR)/px.x;
  float dT = (q.y - yT)/px.y;
  float dA = -1e3, dB = -1e3;
  if(!nar){
    dA = (1. - (q.x - xL)/.13 - (yT - q.y)/.2)/length(vec2(px.x/.13, px.y/.2));
    dB = (1. - (xR - q.x)/.08 - (yT - q.y)/.13)/length(vec2(px.x/.08, px.y/.13));
  }
  vec4 ci;
  float ct = consoleTop(q.x, ci);
  float dC = (ct - q.y)/px.y;
  float D = max(max(max(dL, dR), max(dT, dC)), max(dA, dB));
  if(D < -1.) return 0.;
  float hull = clamp(D + .5, 0., 1.);
  vec3 rimC = uRim.rgb;
  float w = dL >= D - .01 ? 1. : dR >= D - .01 ? .8 : dT >= D - .01 ? .75 : dC >= D - .01 ? .6 : .7;
  fc = rimC*exp(-pow((D - 1.6)/1.6, 2.))*w;
  if(!nar && dT > 2. && dL < 0. && dR < 0.){
    // a strip of small lights along the frame's header
    vec2 cc = floor(gl_FragCoord.xy*.5);
    float rowY = floor((yT + .06 + 1.)*.25*uRes.y);
    if(cc.y == rowY && mod(cc.x, 9.) < .5) fc += CY*.2;
  }
  if(ci.x > -.5 && dC > 1.5){
    // the consoles' readouts: rows of tiny level meters and status dots, cell sized
    vec2 cc = floor(gl_FragCoord.xy*.5);
    float c0 = floor((ci.y + 1.)*.25*uRes.x) + 2.;
    float c1 = floor((ci.z + 1.)*.25*uRes.x) - 2.;
    float rt = floor((ci.w + 1.)*.25*uRes.y) - 1.;
    float row = rt - cc.y;
    float cx = cc.x - c0;
    if(row >= 0. && row < (nar ? 1. : 2.) && cc.x >= c0 && cc.x <= c1){
      float g = floor(cx/7.), j = mod(cx, 7.);
      float h = hash12(vec2(g + ci.x*13., row + 1.));
      vec3 lc = h > .74 ? AM : CY;
      if(uRim.w > .5 && h > .86) lc = RD;
      float on;
      if(row < .5){
        float len = floor(1.5 + 3.5*(.5 + .5*sin(uTime*(.5 + h*1.4) + h*40.)));
        on = step(j + .5, len)*step(j, 4.5);
      } else on = step(.6, hash12(vec2(cx + ci.x*31., floor(uTime*(.6 + h)))))*step(j, 4.5)*step(.5, mod(cx, 2.));
      fc += lc*on*(.22 + .1*h);
    }
  }
  return hull;
}

void main(){
  vec2 q = ndc();
  vec3 fc;
  float hull = bridge(q + uHead.xy, fc);
  if(hull >= .999){ outCol(fc); return; }
  vec3 ro = uEye;
  vec3 rd = camRay(lookAt(ro, uTarget));
  float pcov;
  vec3 col = planet(ro, rd, pcov);
  if(pcov < .999) col += sky(rd)*(1. - pcov);
  vec3 roL = ro*ST, rdL = rd*ST;
  float tSt = -1., mat = -1.;
  vec2 hb = sphIsect(roL, rdL, vec3(0.), 4.8);
  if(hb.y > 0.){
    float t = max(hb.x, 0.);
    for(int i = 0; i < 100; i++){
      vec2 h = mapSt(roL + rdL*t);
      if(h.x < .0022*t){ tSt = t; mat = h.y; break; }
      t += h.x*.9;
      if(t > hb.y) break;
    }
  }
  if(tSt > 0.){
    vec3 p = roL + rdL*tSt;
    col = shadeSt(p, normSt(p), mat, rdL, tSt, uSun*ST, uFill*ST);
  }
  col += glows(roL, rdL, tSt);
  col += shield(ro, rd, tSt);
  col += fireballs(ro, rd, tSt);
  outCol(mix(col, fc, hull));
}
`;

// --- small math, without the allocations of the kit's helpers in hot loops

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
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ease = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};
const toWorld = (l: V3): V3 => [M00 * l[0] + M01 * l[1] + M02 * l[2], M10 * l[0] + M11 * l[1] + M12 * l[2], M20 * l[0] + M21 * l[1] + M22 * l[2]];
const toLocal = (w: V3): V3 => [M00 * w[0] + M10 * w[1] + M20 * w[2], M01 * w[0] + M11 * w[1] + M21 * w[2], M02 * w[0] + M12 * w[1] + M22 * w[2]];
/** the ring's own frame turns by `a` (as ringFrame in the shader) */
const toRing = (p: V3, a: number): V3 => [Math.cos(a) * p[0] - Math.sin(a) * p[2], p[1], Math.sin(a) * p[0] + Math.cos(a) * p[2]];
const fromRing = (p: V3, a: number): V3 => [Math.cos(a) * p[0] + Math.sin(a) * p[2], p[1], -Math.sin(a) * p[0] + Math.cos(a) * p[2]];
function basisOf(eye: V3, target: V3) {
  const F = norm(sub(target, eye));
  const rl = Math.hypot(F[2], F[0]) || 1;
  const R: V3 = [-F[2] / rl, 0, F[0] / rl];
  return { R, U: cross(R, F), F };
}

/** The consoles' top edge (as consoleTop in the shader). */
function consoleTop(x: number, narrow: boolean) {
  let top = narrow ? -0.88 : -0.8 + 0.015 * x;
  for (let i = 0; i < 3; i++) {
    const c = narrow ? (i - 1) * 0.58 : [0.17, 0.47, 0.76][i]!;
    const hw = narrow ? 0.21 : i === 1 ? 0.13 : 0.1;
    const h = narrow ? -0.8 : i === 1 ? -0.715 : -0.7;
    const e = hw - Math.abs(x - c);
    if (e > 0) top = Math.max(top, h - Math.max(0, 0.03 - e) * 1.5);
  }
  return top;
}
/** Whether the bridge's hull hides this canvas point (as bridge() in the shader), so point sprites behind it are dropped. */
function hullAt(x: number, y: number, narrow: boolean) {
  const yy = y * 0.5 + 0.5;
  if (narrow) {
    if (x < -0.955 + 0.03 * yy || x > 0.955 - 0.03 * yy || y > 0.87 - 0.05 * x * x) return true;
    return y < consoleTop(x, true);
  }
  const xL = -0.01 + 0.075 * yy;
  const xR = 0.935 - 0.06 * yy;
  const u = (x - 0.46) / 0.6;
  const yT = 0.8 - 0.08 * u * u;
  if (x < xL || x > xR || y > yT) return true;
  if ((x - xL) / 0.13 + (yT - y) / 0.2 < 1 || (xR - x) / 0.08 + (yT - y) / 0.13 < 1) return true;
  return y < consoleTop(x, false);
}

type Label = { text: string; x: number; y: number; tone?: string; anchor?: "start" | "middle" | "end" };
const TONE_RANK: Record<string, number> = { hot: 3, accent: 2, dim: 1 };
/** Labels that would overlap a more important one are dropped (hot, then dim). */
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

// agent roles
const FORM = 0;
const CHASE = 1;
const SCREEN = 2;
const FIGHT = 3;
const DEAD = 4;
// group kinds
const ESCORT = 0;
const PICKET = 1;
const WING = 2;

type Slot = (i: number, t: number, o: V3) => void;
interface Group {
  kind: number;
  n: number;
  slot: Slot;
  /** busy with an interception until then */
  busy: number;
  members: Agent[];
}
interface Agent {
  id: number;
  p: V3;
  v: V3;
  g: Group;
  i: number;
  role: number;
  /** a scripted attack run: from s, bending through c, to the meeting point, between f0 and f1 */
  s: V3;
  c: V3;
  f0: number;
  f1: number;
  off: V3;
  m: Missile | null;
  foe: Foe | null;
  fire: number;
  /** when a lost agent relaunches from the berths */
  back: number;
}
interface Missile {
  ev: FeedEvent;
  sec: number;
  s: V3;
  c: V3;
  /** the impact point and the way out of the hull there, in the section's frame, and the point in the world this frame */
  eS: V3;
  nS: V3;
  e: V3;
  t0: number;
  dur: number;
  /** where along its path it meets the shield, and where the interceptors meet it */
  uS: number;
  uM: number;
  pm: V3;
  head: V3;
  pierced: boolean;
  done: boolean;
  crew: Agent[];
}
interface Foe {
  p: V3;
  v: V3;
  k: number;
  alive: boolean;
  /** 0 in formation, 1 dogfight, 2 diving at the shield, 3 the one that gets through */
  mode: number;
  wp: V3;
  fire: number;
  leaker: boolean;
  pierced: boolean;
}
interface Swarm {
  ev: FeedEvent;
  shape: number;
  t0: number;
  S: V3;
  E: V3;
  fwd: V3;
  side: V3;
  up: V3;
  foes: Foe[];
  alive: number;
  screen: V3;
  ours: Agent[];
  sec: number;
  eS: V3;
  nS: V3;
}
interface Breach {
  t0: number;
  /** the hole, in the section's frame, and the way out of the hull there */
  o: V3;
  n: V3;
  evs: FeedEvent[];
  drones: boolean;
  home: boolean;
  vent: number;
}
interface Drone {
  p: V3;
  v: V3;
  sec: number;
  k: number;
  home: boolean;
}

const SHAPES = ["wedge", "pincer", "wall"];
/** an enemy formation slot in the group's frame: x across, y up, z along its heading */
function foeSlot(shape: number, k: number, n: number): V3 {
  if (shape === 0) {
    let r = 0;
    let j = k;
    while (j >= 2 * r + 1) {
      j -= 2 * r + 1;
      r++;
    }
    return [(j - r) * 0.5, Math.sin(k * 7.3) * 0.12, -r * 0.55];
  }
  if (shape === 1) {
    const side = k % 2 ? 1 : -1;
    const a = (Math.floor(k / 2) / Math.ceil(n / 2)) * 1.35;
    return [side * (0.7 + Math.sin(a) * 2.4), Math.sin(k * 5.1) * 0.2, 1.2 - Math.cos(a) * 2.4];
  }
  const cols = Math.ceil(Math.sqrt(n * 1.8));
  const rows = Math.ceil(n / cols);
  return [((k % cols) - (cols - 1) / 2) * 0.5, (Math.floor(k / cols) - (rows - 1) / 2) * 0.5, Math.sin(k * 3.7) * 0.1];
}

/** the camera's resting place on the bridge: a little above the station's ring plane, the station ahead and to the right */
const EYE0: V3 = [1.6, 3, 15.8];
const TGT0: V3 = [-0.7, 0.2, 0];

/**
 * Command bridge: first person from the bridge of a capital ship, the view
 * framed by dark struts, the arch of the window frame and a row of consoles
 * with tiny blinking readouts, all near-black with a rim of the battle's
 * light. Outside, the company's AI infrastructure as a raymarched station
 * (a stacked core with a glowing heart, a turning ring of model pods,
 * docking arms for the tools), each section named after a system the feed's
 * targets stand for, inside a shield bubble; a planet's limb below, a nebula
 * and a distant star behind. Our defender agents hold clear formations
 * (escort orbits, picket lines, V wings on patrol loops). Every attack is
 * one director event flying in from deep space at the section its target
 * names: blocked by the shield (a hex patch flares), intercepted by a wing
 * that breaks formation, runs it down with tracers and rejoins, or, only
 * when its fate is a breach, through the shield into the section, which
 * glows red, flickers and vents until repair drones push the red back and
 * it comes back cyan. In the war phase an enemy swarm arrives in formation
 * and our wings meet it in a dogfight, losing agents that relaunch from the
 * berths. The camera drifts gently and shakes a little on a breach.
 */
export function commandBridge({ intel }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const director = new WaveDirector(intel, 211);
  // the scene's own dice, so the feed's sequence never depends on frame timing
  const rnd = mulberry(90210);

  // the sky and the planet are placed once, from the resting view on a wide screen
  const B0 = basisOf(EYE0, TGT0);
  const TX = TX0;
  const TY = TY0;
  const viewDir = (nx: number, ny: number) => norm(add(add(mul(B0.R, (nx - 0.4) * TX), mul(B0.U, ny * TY)), B0.F));
  /** a world point placed by where it sits in the resting wide view (canvas NDC) and how deep, and back */
  const VP = (nx: number, ny: number, z: number): V3 => add(EYE0, add(mul(B0.F, z), add(mul(B0.R, (nx - 0.4) * TX * z), mul(B0.U, ny * TY * z))));
  const viewOf = (p: V3): V3 => {
    const v = sub(p, EYE0);
    const z = Math.max(0.5, dot(v, B0.F));
    return [dot(v, B0.R) / (z * TX) + 0.4, dot(v, B0.U) / (z * TY), z];
  };
  const pDir = viewDir(0.9, -5);
  const limb = viewDir(0.05, -0.7);
  const PD = 160;
  const PC = add(EYE0, mul(pDir, PD));
  const PR = PD * Math.sin(Math.acos(Math.min(1, dot(pDir, limb))));
  // the sun is behind the planet and above, so the limb is a thin crescent and the station is rim lit; a cool fill comes from the bridge's side
  const SUN = norm(add(add(mul(B0.R, -0.35), mul(B0.U, 0.6)), mul(B0.F, 0.75)));
  const FILL = norm(add(add(mul(B0.R, 0.45), mul(B0.U, 0.3)), mul(B0.F, -0.85)));

  let narrow = false;
  const groups: Group[] = [];
  const agents: Agent[] = [];
  let missiles: Missile[] = [];
  let swarm: Swarm | null = null;
  const breaches: (Breach | null)[] = new Array<Breach | null>(NSEC).fill(null);
  let drones: Drone[] = [];
  const fx: { p: V3; t0: number; c: V3; size: number }[] = [];
  const hits: { d: V3; t0: number; c: V3; size: number }[] = [];
  let shake = 0;
  let spin = 0;
  let cam: Cam = { eye: [...EYE0], target: [...TGT0] };
  let hx = 0;
  let hy = 0;
  const tmp: V3 = [0, 0, 0];
  const tmp2: V3 = [0, 0, 0];

  // sparks and vents: x y z vx vy vz life life0 colour drag
  const NSP = 900;
  const sp = new Float32Array(NSP * 10);
  let nsp = 0;
  // tracers: x y z vx vy vz life red
  const NTR = 240;
  const tr = new Float32Array(NTR * 8);
  let ntr = 0;
  // points
  const MAXP = 3600;
  const pts = new Float32Array(MAXP * POINT_STRIDE);
  let np = 0;

  // shader data
  const uBrO = new Float32Array(NSEC * 4);
  const uBrS = new Float32Array(NSEC * 4);
  const uHit = new Float32Array(NHIT * 4);
  const uHitC = new Float32Array(NHIT * 4);
  const uFx = new Float32Array(NFX * 4);
  const uFxC = new Float32Array(NFX * 4);

  const flash = (p: V3, t: number, c: V3, size: number) => {
    fx.push({ p: [...p], t0: t, c, size });
    if (fx.length > NFX) fx.shift();
  };
  const shieldHit = (p: V3, t: number, c: V3, size: number) => {
    hits.push({ d: norm(p), t0: t, c, size });
    if (hits.length > NHIT) hits.shift();
  };
  const spark = (p: V3, n: number, cols: V3[], speed: number, life = 0.7, drag = 2.2, dir: V3 | null = null, cone = 1) => {
    for (let k = 0; k < n; k++) {
      if (nsp >= NSP) return;
      let d: V3 = norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
      if (dir) d = norm(add(dir, mul(d, cone)));
      const s = speed * (0.35 + rnd() * 0.9);
      const o = nsp * 10;
      const c = cols[k % cols.length]!;
      sp.set([p[0], p[1], p[2], d[0] * s, d[1] * s, d[2] * s, life * (0.6 + rnd() * 0.7), life, SPARK_C.indexOf(c), drag], o);
      nsp++;
    }
  };
  const tracer = (a: V3, b: V3, red: boolean, speed = 16) => {
    if (ntr >= NTR) return;
    const d = sub(b, a);
    const l = len(d) || 1;
    tr.set([a[0], a[1], a[2], (d[0] / l) * speed, (d[1] / l) * speed, (d[2] / l) * speed, Math.min(0.6, l / speed + 0.05), red ? 1 : 0], ntr * 8);
    ntr++;
  };

  // --- the station's sections: where an attack lands, and where that is in the world now
  const secOf = (target: string) => Math.max(0, SECTIONS.indexOf(target));
  const isRing = (sec: number) => sec >= 4;
  const secWorld = (sec: number, pS: V3, a: number): V3 => toWorld(isRing(sec) ? fromRing(pS, a) : pS);
  const secDirWorld = (sec: number, nS: V3, a: number): V3 => toWorld(isRing(sec) ? fromRing(nS, a) : nS);
  /** a point on the section's hull, on the side facing `from` (world); returns it and the way out of the hull, in the section's frame */
  const impactPoint = (sec: number, from: V3): { o: V3; n: V3 } => {
    const f = toLocal(from);
    const fl = Math.hypot(f[0], f[2]) || 1;
    const rx = f[0] / fl;
    const rz = f[2] / fl;
    if (sec === 0) {
      const n = norm(f);
      return { o: mul(n, 0.44), n };
    }
    if (sec === 1 || sec === 2) {
      const r = sec === 1 ? 0.62 : 0.72;
      const y = sec === 1 ? 1.25 + rnd() * 1.1 : -1.15 - rnd() * 1.1;
      return { o: [rx * r, y, rz * r], n: [rx, 0, rz] };
    }
    if (sec === 3) {
      const side = f[0] >= 0 ? 1 : -1;
      const up = f[1] > -1.75 ? 1 : -1;
      return { o: [side * (1.4 + rnd() * 2.4), -1.75 + 0.1 * up, 0.13 * (f[2] >= 0 ? 1 : -1)], n: norm([0, up, f[2] >= 0 ? 0.6 : -0.6]) };
    }
    if (sec === 4) {
      const a = Math.atan2(rz, rx) + (rnd() - 0.5) * 0.6;
      const n: V3 = [Math.cos(a), 0, Math.sin(a)];
      return { o: toRing(add(mul(n, RR + 0.2), [0, (rnd() - 0.5) * 0.2, 0]), spin), n: toRing(n, spin) };
    }
    const a = (sec - 5) * PS;
    const c: V3 = [Math.cos(a) * RR, 0, Math.sin(a) * RR];
    const n = norm(sub(toRing(f, spin), c));
    return { o: add(c, mul(n, 0.42)), n };
  };

  // --- our fleet: escort orbits, picket lines and V wings on patrol loops
  const addGroup = (kind: number, n: number, slot: Slot) => {
    const g: Group = { kind, n, slot, busy: -1, members: [] };
    for (let i = 0; i < n; i++) {
      slot(i, 0, tmp);
      const a: Agent = { id: agents.length, p: [...tmp], v: [0, 0, 0], g, i, role: FORM, s: [0, 0, 0], c: [0, 0, 0], f0: 0, f1: 0, off: [0, 0, 0], m: null, foe: null, fire: 0, back: 0 };
      g.members.push(a);
      agents.push(a);
    }
    groups.push(g);
  };
  /** an escort orbit: flights of five in file round the station, a gap between flights, so the orbit reads as a dashed line */
  const orbit = (r: number, nrm: V3, w: number, flights: number, a0: number): Slot => {
    const nn = norm(nrm);
    const e1 = norm(cross(nn, Math.abs(nn[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const e2 = cross(nn, e1);
    const step = TAU / flights;
    return (i, t, o) => {
      const j = Math.floor(i / 5);
      const m = i % 5;
      const a = a0 + j * step + w * t - m * step * 0.13 * Math.sign(w);
      const rr = r + 0.06 * Math.sin(m * 2.1 + j);
      const c = Math.cos(a) * rr;
      const s = Math.sin(a) * rr;
      const bob = 0.07 * Math.sin(t * 0.7 + j);
      o[0] = e1[0] * c + e2[0] * s + nn[0] * bob;
      o[1] = e1[1] * c + e2[1] * s + nn[1] * bob;
      o[2] = e1[2] * c + e2[2] * s + nn[2] * bob;
    };
  };
  /** a picket line held across an approach, drifting slowly along itself */
  const picket = (A: V3, B: V3, n: number, ph: number): Slot => {
    const d = sub(B, A);
    const perp = norm(cross(d, [0, 1, 0]));
    return (i, t, o) => {
      const u = (i + 0.5) / n + 0.035 * Math.sin(t * 0.13 + ph);
      const wob = 0.07 * Math.sin(t * 0.8 + i * 1.3);
      o[0] = A[0] + d[0] * u + perp[0] * wob;
      o[1] = A[1] + d[1] * u + 0.05 * Math.sin(t * 0.6 + i);
      o[2] = A[2] + d[2] * u + perp[2] * wob;
    };
  };
  /** a wing: a leader on a patrol loop and the others in a V behind it */
  const wing = (C: V3, ex: V3, ey: V3, ez: V3, w: number, ph: number): Slot => {
    const lead = (t: number, o: V3) => {
      const a = ph + w * t;
      for (let k = 0; k < 3; k++) o[k] = C[k]! + ex[k]! * Math.cos(a) + ey[k]! * Math.sin(a) + ez[k]! * Math.sin(2 * a);
    };
    const a1: V3 = [0, 0, 0];
    const a2: V3 = [0, 0, 0];
    return (i, t, o) => {
      lead(t, a1);
      lead(t + 0.2, a2);
      const f = norm(sub(a2, a1));
      const r = norm(cross(f, [0, 1, 0]));
      const k = Math.ceil(i / 2);
      const side = i % 2 ? 1 : -1;
      for (let q = 0; q < 3; q++) o[q] = a1[q]! + r[q]! * side * k * 0.42 - f[q]! * k * 0.42;
      o[1] += 0.04 * k;
    };
  };
  const build = () => {
    const axis = toWorld([0, 1, 0]);
    addGroup(ESCORT, (narrow ? 18 : 30) * 5, orbit(6.2, axis, 0.07, narrow ? 18 : 30, 0));
    addGroup(ESCORT, (narrow ? 14 : 22) * 5, orbit(7.5, toWorld(norm([0.55, 1, -0.35])), -0.05, narrow ? 14 : 22, 1));
    const pn = narrow ? 10 : 13;
    // picket lines across the approaches: out on the right, high behind the station, low in front of it
    addGroup(PICKET, pn, picket(VP(0.86, 0.48, 23), VP(0.82, -0.28, 21), pn, 0));
    addGroup(PICKET, pn, picket(VP(0.22, 0.62, 25), VP(0.64, 0.67, 27), pn, 2));
    if (!narrow) addGroup(PICKET, pn, picket(VP(0.55, -0.5, 10), VP(0.85, -0.38, 10.5), pn, 4));
    // wings on patrol loops: round the station, one sweeping close past the bridge, two out in deep space
    const loops: [V3, V3, V3, V3, number, number][] = [
      [[0, 0.5, 0], [9, 0, 1.5], [0, 1.2, 7.5], [0, 0.8, 0], 0.1, 0],
      [[0, -0.6, 0], [-8, 0, -2], [1, -1.5, 8.5], [0, 0.6, 0], 0.085, 2.2],
      [[4.5, 1.2, 5], [4, 0.5, 0], [0, 0, 5], [0, 0.7, 0], 0.16, 1],
      [[1, 5, -2], [6.5, 0, 0], [0, 0.8, 4.5], [0, 0.4, 0], -0.12, 4],
      [[2, -4.3, 1], [7, 0, 1], [0, -0.5, 5], [0, 0.5, 0], 0.11, 5.5],
      [[7, 1, -7], [3, 2, 0], [0, 0, 4], [0.5, 0.4, 0], 0.2, 3],
      [[-2, 1, -9], [6, 0, 0], [0, 3, 2], [0, 0, 0.6], -0.14, 0.7],
      [[4, 2.5, -11], [5, 0, 2], [0, 2, 3], [0, 0.4, 0], 0.17, 2.9],
    ];
    loops.slice(0, narrow ? 6 : 8).forEach(([C, ex, ey, ez, w, ph]) => addGroup(WING, 7, wing(C, ex, ey, ez, w, ph)));
  };

  const bez = (m: Missile, u: number, out: V3) => {
    const w = 1 - u;
    for (let k = 0; k < 3; k++) out[k] = w * w * m.s[k]! + 2 * w * u * m.c[k]! + u * u * m.e[k]!;
    return out;
  };
  /** where a world point lands on the canvas (NDC x, y and depth into out); false behind the camera */
  let basis = basisOf(cam.eye, cam.target);
  let tanX = TX;
  let tanY = TY;
  let shift = 0.4;
  const ndcOf = (x: number, y: number, z: number, out: V3) => {
    const vx = x - cam.eye[0];
    const vy = y - cam.eye[1];
    const vz = z - cam.eye[2];
    const zz = vx * basis.F[0] + vy * basis.F[1] + vz * basis.F[2];
    if (zz < 0.3) return false;
    out[0] = (vx * basis.R[0] + vy * basis.R[1] + vz * basis.R[2]) / (zz * tanX) + shift;
    out[1] = (vx * basis.U[0] + vy * basis.U[1] + vz * basis.U[2]) / (zz * tanY);
    out[2] = zz;
    return true;
  };
  const inView = (p: V3) => ndcOf(p[0], p[1], p[2], tmp2) && Math.abs(tmp2[0]) < 0.98 && Math.abs(tmp2[1]) < 0.95 && !hullAt(tmp2[0], tmp2[1], narrow) && (narrow || tmp2[0] > 0.12);

  // --- attacks
  const launch = (ev: FeedEvent, t: number) => {
    if (missiles.length >= 10) return;
    const sec = secOf(ev.target);
    // out of deep space: mostly from the right, some from above, a few from below the planet's limb
    const side = rnd();
    let s: V3;
    if (side < 0.55) s = VP(1.2 + rnd() * 0.4, -0.3 + rnd() * 0.9, 18 + rnd() * 10);
    else if (side < 0.9) s = VP(0.25 + rnd() * 0.65, 0.95 + rnd() * 0.35, 22 + rnd() * 8);
    else s = VP(0.2 + rnd() * 0.6, -1.25 - rnd() * 0.2, 16 + rnd() * 6);
    const ip = impactPoint(sec, s);
    const e = secWorld(sec, ip.o, spin);
    // the path bends through the open window, so the flight is seen rather than hidden behind a strut
    const sv = viewOf(s);
    const tv = viewOf(e);
    const c = VP((sv[0] + tv[0]) * 0.3 + 0.56 * 0.4 + (rnd() - 0.5) * 0.2, (sv[1] + tv[1]) * 0.3 + 0.12 * 0.4 + (rnd() - 0.5) * 0.3, (sv[2] + tv[2]) * 0.5 - 2 - rnd() * 3);
    const war = director.phase(t) === "war";
    const m: Missile = { ev, sec, s, c, eS: ip.o, nS: ip.n, e, t0: t, dur: (war ? 2.8 : 3.6) + rnd(), uS: 1, uM: -1, pm: [0, 0, 0], head: [...s], pierced: false, done: false, crew: [] };
    for (let k = 1; k <= 60; k++) {
      if (len(bez(m, k / 60, tmp)) < RS) {
        m.uS = k / 60;
        break;
      }
    }
    if (ev.fate === "intercepted") intercept(m, t);
    missiles.push(m);
  };
  /** the nearest free wing breaks formation to meet the attack well before the shield (in view if it can); else three from a picket */
  const intercept = (m: Missile, t: number) => {
    // where the wing meets it: the point on its path nearest the middle of the window, at least a second and a half
    // away so the wing has time to run it down, and well clear of the shield
    const uMin = Math.min(m.uS * 0.85, 1.5 / m.dur);
    let uM = Math.max(uMin, m.uS * 0.72);
    let best0 = Infinity;
    for (let k = 0; k <= 8; k++) {
      const u = uMin + ((m.uS * 0.88 - uMin) * k) / 8;
      if (!inView(bez(m, u, tmp))) continue;
      const d = Math.hypot(tmp2[0] - 0.55, tmp2[1] - 0.15);
      if (d < best0) {
        best0 = d;
        uM = u;
      }
    }
    m.uM = uM;
    bez(m, uM, m.pm);
    const tM = m.t0 + m.dur * uM;
    const left = Math.max(0.5, tM - t);
    let best: Group | null = null;
    let bd = Infinity;
    for (const g of groups) {
      if (g.kind !== WING || g.busy > t) continue;
      const lead = g.members[0];
      if (!lead || lead.role !== FORM) continue;
      const d = dist(lead.p, m.pm);
      if (d / left < 9 && d < bd) {
        bd = d;
        best = g;
      }
    }
    let crew: Agent[];
    if (best) {
      crew = best.members.filter((a) => a.role === FORM);
      best.busy = tM + 3;
    } else {
      crew = agents
        .filter((a) => a.role === FORM && a.g.kind !== WING)
        .map((a) => ({ a, d: dist(a.p, m.pm) }))
        .sort((x, y) => x.d - y.d)
        .slice(0, 3)
        .map((x) => x.a);
    }
    crew.forEach((a, k) => {
      a.role = CHASE;
      a.m = m;
      a.s = [...a.p];
      a.c = add(a.p, mul(a.v, 1.2));
      a.f0 = t;
      a.f1 = tM - 0.06 * k;
      a.off = [(rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.7];
      a.fire = tM - 0.9 + rnd() * 0.2;
    });
    m.crew = crew;
  };
  const rejoin = (list: Agent[]) => {
    for (const a of list) {
      if (a.role === DEAD) continue;
      a.role = FORM;
      a.m = null;
      a.foe = null;
    }
  };
  const breach = (sec: number, o: V3, n: V3, ev: FeedEvent, t: number) => {
    const old = breaches[sec];
    if (old) {
      // hit again while it is still breached: the same repair takes it, a little longer
      old.evs.push(ev);
      old.t0 = Math.max(old.t0, t - 1.2);
      return;
    }
    breaches[sec] = { t0: t, o, n, evs: [ev], drones: false, home: false, vent: 0 };
    shake = Math.min(1.4, shake + 1);
  };

  /** somewhere for the dogfight to go next: in the right half of the view, outside the shield */
  const fightPoint = (): V3 => {
    let p = VP(0.56 + rnd() * 0.34, -0.42 + rnd() * 0.72, 11 + rnd() * 11);
    if (len(p) < RS + 0.8) p = mul(norm(p), RS + 0.8 + rnd());
    return p;
  };

  // --- the enemy swarm of the war phase
  const spawnSwarm = (ev: FeedEvent, size: number, t: number) => {
    const n = Math.min(size, narrow ? 34 : 70);
    // in formation from one side of deep space, to a point in the upper right of the view
    const right = rnd() < 0.7;
    const S: V3 = right ? VP(1.75, -0.1 + rnd() * 0.3, 27) : VP(0.3, 1.7, 36);
    const E: V3 = right ? VP(0.78, -0.05 + rnd() * 0.15, 20) : VP(0.3, 0.45, 23);
    const fwd = norm(sub(E, S));
    const side = norm(cross(fwd, [0, 1, 0]));
    const up = cross(side, fwd);
    const shape = Math.floor(rnd() * SHAPES.length);
    const sec = secOf(ev.target);
    const sw: Swarm = { ev, shape, t0: t, S, E, fwd, side, up, foes: [], alive: n, screen: mix(E, [0, 0, 0], 0.42), ours: [], sec, eS: [0, 0, 0], nS: [0, 1, 0] };
    for (let k = 0; k < n; k++) {
      const o = foeSlot(shape, k, n);
      const p = add(S, add(add(mul(side, o[0]), mul(up, o[1])), mul(fwd, o[2])));
      sw.foes.push({ p, v: mul(fwd, 3), k, alive: true, mode: 0, wp: [0, 0, 0], fire: t + 6 + rnd() * 2, leaker: false, pierced: false });
    }
    if (ev.fate === "breach") sw.foes[0]!.leaker = true;
    // every wing and a picket line meet it: first a screen between it and the station, then the dogfight
    sw.ours = agents.filter((a) => a.role === FORM && (a.g.kind === WING || a.g === groups.find((g) => g.kind === PICKET)));
    sw.ours.forEach((a) => {
      a.role = SCREEN;
      a.foe = null;
    });
    swarm = sw;
  };

  /** spring an agent toward a point that is itself moving at vel */
  const steer = (a: { p: V3; v: V3 }, goal: V3, vel: V3, dt: number, k: number, vmax: number) => {
    let dx = vel[0] + (goal[0] - a.p[0]) * k;
    let dy = vel[1] + (goal[1] - a.p[1]) * k;
    let dz = vel[2] + (goal[2] - a.p[2]) * k;
    const l = Math.hypot(dx, dy, dz);
    if (l > vmax) {
      dx *= vmax / l;
      dy *= vmax / l;
      dz *= vmax / l;
    }
    const s = Math.min(1, dt * 4);
    a.v[0] += (dx - a.v[0]) * s;
    a.v[1] += (dy - a.v[1]) * s;
    a.v[2] += (dz - a.v[2]) * s;
  };
  const ZERO: V3 = [0, 0, 0];
  const berth = (p: V3): V3 => toWorld([(p[0] >= 0 ? 1 : -1) * 4.55, -1.75, 0]);

  /** a sprite, unless the bridge's hull or the station hides it */
  const eL: V3 = [0, 0, 0];
  let zSt = 16;
  const occluded = (x: number, y: number, z: number) => {
    const pL = toLocal([x, y, z]);
    const dx = pL[0] - eL[0];
    const dy = pL[1] - eL[1];
    const dz = pL[2] - eL[2];
    // the spindle
    const a = dx * dx + dz * dz;
    const b = 2 * (eL[0] * dx + eL[2] * dz);
    const c = eL[0] * eL[0] + eL[2] * eL[2] - 0.78 * 0.78;
    const disc = b * b - 4 * a * c;
    if (disc > 0 && a > 1e-9) {
      const s = (-b - Math.sqrt(disc)) / (2 * a);
      if (s > 0 && s < 1) {
        const yy = eL[1] + s * dy;
        if (yy > -3.1 && yy < 3.25) return true;
      }
    }
    // the ring
    if (Math.abs(dy) > 1e-6) {
      const s = -eL[1] / dy;
      if (s > 0 && s < 1) {
        const r = Math.hypot(eL[0] + s * dx, eL[2] + s * dz);
        if (Math.abs(r - RR) < 0.34) return true;
      }
    }
    return false;
  };
  /** scene pixels across the canvas, for a sprite's minimum size */
  let resX = 414;
  const put = (x: number, y: number, z: number, r: number, c: V3, k: number, minPx = 1.5) => {
    if (np >= MAXP || k <= 0.02) return;
    if (!ndcOf(x, y, z, tmp2)) return;
    r = Math.max(r, (minPx * tmp2[2] * tanX) / resX);
    if (Math.abs(tmp2[0]) > 1.04 || Math.abs(tmp2[1]) > 1.04) return;
    if (hullAt(tmp2[0] + hx, tmp2[1] + hy, narrow)) return;
    if (tmp2[2] > zSt - 4.8 && occluded(x, y, z)) return;
    const o = np * POINT_STRIDE;
    pts[o] = x;
    pts[o + 1] = y;
    pts[o + 2] = z;
    pts[o + 3] = r;
    pts[o + 4] = c[0];
    pts[o + 5] = c[1];
    pts[o + 6] = c[2];
    pts[o + 7] = k;
    np++;
  };
  /** a craft: a bright head and a short fading trail behind it */
  const craft = (p: V3, v: V3, r: number, c: V3, k: number, tail: number, minPx = 1.5) => {
    put(p[0], p[1], p[2], r, c, k, minPx);
    put(p[0] - v[0] * tail, p[1] - v[1] * tail, p[2] - v[2] * tail, r * 0.75, c, k * 0.42);
    put(p[0] - v[0] * tail * 2, p[1] - v[1] * tail * 2, p[2] - v[2] * tail * 2, r * 0.6, c, k * 0.18);
  };

  const step = (t: number, dt: number) => {
    // --- the director's waves
    const wave = director.tick(t);
    for (const ev of wave.attacks) launch(ev, t);
    if (wave.swarm && !swarm) spawnSwarm(wave.swarm.ev, wave.swarm.size, t);

    // --- attacks in flight
    for (const m of missiles) {
      const u = (t - m.t0) / m.dur;
      m.e = secWorld(m.sec, m.eS, spin);
      bez(m, Math.min(1, u), m.head);
      const fate = m.ev.fate;
      if (fate === "intercepted") {
        for (const a of m.crew) {
          if (a.role === CHASE && t > a.fire && t < m.t0 + m.dur * m.uM) {
            a.fire = t + 0.1 + rnd() * 0.05;
            tracer(a.p, bez(m, Math.min(1, u + 0.05), tmp), false, 18);
          }
        }
        if (u >= m.uM) {
          flash(m.head, t, AM, 0.75);
          spark(m.head, 26, [AM, RD, WH, CY], 2.6);
          m.done = true;
          m.crew.forEach((a) => {
            a.m = null;
          });
        }
      } else if (fate === "blocked") {
        if (u >= m.uS) {
          shieldHit(m.head, t, CY, 0.17);
          flash(m.head, t, CY, 0.35);
          spark(m.head, 14, [RD, CY, WH], 2.2);
          m.done = true;
        }
      } else {
        if (!m.pierced && u >= m.uS) {
          m.pierced = true;
          shieldHit(m.head, t, RD, 0.14);
        }
        if (u >= 1) {
          flash(m.e, t, RD, 1.1);
          spark(m.e, 34, [RD, AM, WH], 2.4);
          breach(m.sec, m.eS, m.nS, m.ev, t);
          m.done = true;
        }
      }
    }
    missiles = missiles.filter((m) => !m.done);

    // --- the swarm
    if (swarm) {
      const sw = swarm;
      const age = t - sw.t0;
      const APPROACH = 6;
      const center = mix(sw.S, sw.E, ease(age / APPROACH));
      let alive = 0;
      for (const fo of sw.foes) {
        if (!fo.alive) continue;
        alive++;
        if (fo.mode === 0 && age > APPROACH + fo.k * 0.03) {
          fo.mode = 1;
          fo.wp = fightPoint();
        }
        if (fo.mode === 1 && fo.leaker && age > APPROACH + 4) {
          fo.mode = 3;
          const ip = impactPoint(sw.sec, fo.p);
          sw.eS = ip.o;
          sw.nS = ip.n;
        }
        if (fo.mode === 1 && age > APPROACH + 13) fo.mode = 2;
        if (fo.mode === 0) {
          const o = foeSlot(sw.shape, fo.k, sw.foes.length);
          const goal = add(center, add(add(mul(sw.side, o[0]), mul(sw.up, o[1])), mul(sw.fwd, o[2])));
          steer(fo, goal, mul(sw.fwd, age < APPROACH ? 3.2 : 0.5), dt, 3, 8);
        } else if (fo.mode === 1) {
          if (dist(fo.p, fo.wp) < 1.2) fo.wp = fightPoint();
          const d = norm(sub(fo.wp, fo.p));
          const j = Math.sin(t * 3.1 + fo.k) * 1.6;
          const side = norm(cross(d, [0, 1, 0]));
          steer(fo, fo.p, add(mul(d, 4.2), mul(side, j)), dt, 0, 5);
          if (t > fo.fire) {
            fo.fire = t + 0.9 + rnd() * 1.4;
            const tgt = sw.ours[Math.floor(rnd() * sw.ours.length)];
            if (tgt && tgt.role !== DEAD && dist(tgt.p, fo.p) < 3) tracer(fo.p, tgt.p, true, 14);
            else if (len(fo.p) < 9) tracer(fo.p, mul(norm(fo.p), RS), true, 14);
          }
        } else {
          const goal = fo.mode === 3 ? secWorld(sw.sec, sw.eS, spin) : ZERO;
          steer(fo, goal, ZERO, dt, 2, fo.mode === 3 ? 5.5 : 5);
          const r = len(fo.p);
          if (fo.mode === 2 && r < RS) {
            fo.alive = false;
            shieldHit(fo.p, t, CY, 0.14);
            spark(fo.p, 8, [RD, CY, WH], 2);
          } else if (fo.mode === 3) {
            if (!fo.pierced && r < RS) {
              fo.pierced = true;
              shieldHit(fo.p, t, RD, 0.14);
            }
            if (dist(fo.p, goal) < 0.25) {
              fo.alive = false;
              flash(goal, t, RD, 1.1);
              spark(goal, 34, [RD, AM, WH], 2.4);
              breach(sw.sec, sw.eS, sw.nS, sw.ev, t);
            }
          }
        }
        fo.p[0] += fo.v[0] * dt;
        fo.p[1] += fo.v[1] * dt;
        fo.p[2] += fo.v[2] * dt;
      }
      sw.alive = alive;
      if (!alive) {
        rejoin(sw.ours);
        swarm = null;
      }
    }

    // --- breaches: vents while it burns, repair drones from the core, then cyan again
    for (let s = 0; s < NSEC; s++) {
      const b = breaches[s];
      if (!b) continue;
      const tb = t - b.t0;
      if (tb < 4.4) {
        b.vent += dt * 34 * (1 - tb / 4.4);
        if (b.vent >= 1) {
          const k = Math.floor(b.vent);
          b.vent -= k;
          spark(secWorld(s, b.o, spin), k, [RD, AM, RD, WH], 1.5, 1.1, 1.4, secDirWorld(s, b.n, spin), 0.55);
        }
      }
      if (!b.drones && tb > DRONES_AT) {
        b.drones = true;
        const n = narrow ? 8 : 14;
        for (let k = 0; k < n; k++) drones.push({ p: add(toWorld([0, (rnd() - 0.5) * 0.6, 0]), mul(norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]), 0.5)), v: [0, 0, 0], sec: s, k, home: false });
      }
      if (!b.home && tb > REPAIR1) {
        b.home = true;
        const p = secWorld(s, b.o, spin);
        flash(p, t, CY, 0.6);
        spark(p, 16, [CY, WH, MEND], 1.6);
        for (const d of drones) if (d.sec === s) d.home = true;
      }
      if (tb > END) breaches[s] = null;
    }
    for (const d of drones) {
      const b = breaches[d.sec];
      if (d.home || !b) {
        steer(d, ZERO, ZERO, dt, 3, 4.5);
      } else {
        const c = add(secWorld(d.sec, b.o, spin), mul(secDirWorld(d.sec, b.n, spin), 0.25));
        const n = secDirWorld(d.sec, b.n, spin);
        const e1 = norm(cross(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
        const e2 = cross(n, e1);
        const a = d.k * 2.39996 + t * 2.4 * (d.k % 2 ? 1 : -1);
        const r = 0.45 + (d.k % 4) * 0.12;
        const goal = add(c, add(mul(e1, Math.cos(a) * r), add(mul(e2, Math.sin(a) * r), mul(n, Math.sin(t * 3 + d.k) * 0.15))));
        steer(d, goal, ZERO, dt, 5, 5);
      }
      d.p = add(d.p, mul(d.v, dt));
    }
    drones = drones.filter((d) => !(d.home && len(d.p) < 0.6));

    // --- our agents
    const fightOn = swarm ? t - swarm.t0 > 5.5 : false;
    for (const a of agents) {
      if (a.role === DEAD) {
        if (t < a.back) continue;
        // a replacement launches from the berth nearest its slot
        a.g.slot(a.i, t, tmp);
        a.p = berth(tmp);
        a.v = mul(norm(sub(tmp, a.p)), 3);
        a.role = FORM;
        flash(a.p, t, CY, 0.2);
      }
      if (a.role === CHASE) {
        const m = a.m;
        const u = Math.min(1, (t - a.f0) / Math.max(0.1, a.f1 - a.f0));
        if (!m || u >= 1) {
          a.role = FORM;
          a.m = null;
        } else {
          const goal = add(m.pm, a.off);
          const w = 1 - u;
          const nx = w * w * a.s[0] + 2 * w * u * a.c[0] + u * u * goal[0];
          const ny = w * w * a.s[1] + 2 * w * u * a.c[1] + u * u * goal[1];
          const nz = w * w * a.s[2] + 2 * w * u * a.c[2] + u * u * goal[2];
          a.v = [(nx - a.p[0]) / Math.max(dt, 1e-3), (ny - a.p[1]) / Math.max(dt, 1e-3), (nz - a.p[2]) / Math.max(dt, 1e-3)];
          a.p = [nx, ny, nz];
          continue;
        }
      }
      if (a.role === SCREEN && swarm) {
        if (fightOn) {
          a.role = FIGHT;
          const live = swarm.foes.filter((fo) => fo.alive);
          a.foe = live.length ? live[(a.i * 7 + a.g.n) % live.length]! : null;
        } else {
          const k = a.id % 97;
          const ph = k * 2.39996;
          const r = 0.5 + Math.sqrt(k / 97) * 2.8;
          const goal = add(swarm.screen, add(mul(swarm.side, Math.cos(ph) * r), mul(swarm.up, Math.sin(ph) * r * 0.7)));
          steer(a, goal, ZERO, dt, 1.6, 7);
        }
      }
      if (a.role === FIGHT) {
        let fo = a.foe;
        if (!fo || !fo.alive) {
          const live = swarm ? swarm.foes.filter((x) => x.alive) : [];
          fo = a.foe = live.length ? live[(a.i * 5 + Math.floor(t)) % live.length]! : null;
        }
        if (!fo) a.role = FORM;
        else {
          const lead = add(fo.p, mul(fo.v, 0.35));
          const d = norm(sub(lead, a.p));
          const weave = norm(cross(d, [0, 1, 0]));
          steer(a, a.p, add(mul(d, 5.2), mul(weave, Math.sin(t * 2.3 + a.i) * 1.2)), dt * 0.65, 0, 6);
          const dd = dist(fo.p, a.p);
          const vl = len(a.v) || 1;
          if (t > a.fire && dd < 1.9 && dot(a.v, sub(fo.p, a.p)) / (vl * dd) > 0.6) {
            a.fire = t + 1.4 + rnd() * 1.4;
            tracer(a.p, lead, false, 18);
            tracer(add(a.p, mul(a.v, 0.04)), lead, false, 18);
            const roll = rnd();
            if (roll < 0.17) {
              fo.alive = false;
              flash(fo.p, t, AM, 0.35);
              spark(fo.p, 12, [AM, RD, WH], 2.4);
            } else if (roll < 0.22) {
              // ours is the one shot down: it relaunches from the berths a few seconds later
              flash(a.p, t, CY, 0.4);
              spark(a.p, 10, [CY, WH], 2);
              a.role = DEAD;
              a.back = t + 3 + rnd() * 2;
              a.foe = null;
              continue;
            }
          }
        }
      }
      if (a.role === FORM) {
        a.g.slot(a.i, t, tmp);
        a.g.slot(a.i, t + 0.1, tmp2);
        const vel: V3 = [(tmp2[0] - tmp[0]) * 10, (tmp2[1] - tmp[1]) * 10, (tmp2[2] - tmp[2]) * 10];
        steer(a, tmp, vel, dt, 1.8, 6.5);
      }
      a.p[0] += a.v[0] * dt;
      a.p[1] += a.v[1] * dt;
      a.p[2] += a.v[2] * dt;
    }

    // --- sparks and tracers
    for (let i = 0; i < nsp; i++) {
      const o = i * 10;
      sp[o + 6]! -= dt;
      if (sp[o + 6]! <= 0) {
        const last = (nsp - 1) * 10;
        sp.copyWithin(o, last, last + 10);
        nsp--;
        i--;
        continue;
      }
      const dr = Math.exp(-dt * sp[o + 9]!);
      sp[o + 3]! *= dr;
      sp[o + 4]! *= dr;
      sp[o + 5]! *= dr;
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
  };

  /** one step of the world: the bridge's drift and sway (a shudder after a breach), then the battle */
  const advance = (t: number, dt: number) => {
    spin = t * 0.055;
    shake *= Math.exp(-dt * 3.2);
    // on a phone the band is the viewport alone: a little closer, the station centred
    const near = narrow ? 3.2 : 0;
    const tx0 = narrow ? 0.1 : TGT0[0];
    cam = {
      eye: [EYE0[0] * (narrow ? 0.6 : 1) + 1.1 * Math.sin(t * 0.045), EYE0[1] - near * 0.15 + 0.45 * Math.sin(t * 0.033 + 1), EYE0[2] - near + 0.7 * Math.sin(t * 0.027 + 2)],
      target: [tx0 + 0.3 * Math.sin(t * 0.06 + 0.5) + shake * 0.05 * Math.sin(t * 43), TGT0[1] + 0.12 * Math.sin(t * 0.05 + 1.7) + shake * 0.04 * Math.sin(t * 37 + 1), TGT0[2]],
    };
    hx = 0.0025 * Math.sin(t * 0.29) + shake * 0.004 * Math.sin(t * 51);
    hy = 0.002 * Math.sin(t * 0.21 + 1) + shake * 0.004 * Math.sin(t * 47 + 2);
    basis = basisOf(cam.eye, cam.target);
    const eLoc = toLocal(cam.eye);
    eL[0] = eLoc[0];
    eL[1] = eLoc[1];
    eL[2] = eLoc[2];
    zSt = -dot(cam.eye, basis.F);
    step(t, dt);
  };

  return {
    frag: FRAG,
    fovY: FOV,
    shift: 0.4,
    frame(f, set) {
      const t = f.t;
      const dt = Math.min(0.05, Math.max(0, f.dt));
      narrow = f.narrow;
      tanX = f.tan[0];
      tanY = f.tan[1];
      shift = f.shift;
      resX = Math.max(1, Math.floor(f.width / 6) * 2);
      if (!agents.length) {
        build();
        // a first frame late in the clock (the reduced-motion still at 6 s): play the seconds before it, so the battle is under way
        for (let w = Math.max(0, t - 4.5); w < t - 1e-3; w += 1 / 30) advance(w, 1 / 30);
      }
      advance(t, dt);
      const level = director.level(t);

      // --- sprites
      np = 0;
      const big = narrow ? 1.7 : 1;
      for (const a of agents) {
        if (a.role === DEAD) continue;
        const busy = a.role !== FORM;
        const esc = a.g.kind === ESCORT;
        craft(a.p, a.v, (esc ? 0.062 : 0.07) * big, busy ? WH : CY, esc ? 3 : busy ? 3.8 : 3.4, 0.045);
      }
      if (swarm)
        for (const fo of swarm.foes) {
          if (!fo.alive) continue;
          craft(fo.p, fo.v, 0.09 * big, FOE, 3.4 + 0.6 * Math.sin(t * 19 + fo.k * 7), 0.06, 2.2);
        }
      for (const m of missiles) {
        const u = Math.min(1, (t - m.t0) / m.dur);
        put(m.head[0], m.head[1], m.head[2], 0.095 * big, [1, 0.55, 0.42], 5, 3);
        for (let j = 1; j <= 18; j++) {
          bez(m, Math.max(0, u - j * 0.011), tmp);
          put(tmp[0], tmp[1], tmp[2], (0.075 - j * 0.0025) * big, RD, 3.4 - j * 0.17, 2.4 - j * 0.06);
        }
      }
      for (let i = 0; i < ntr; i++) {
        const o = i * 8;
        const c = tr[o + 7]! > 0.5 ? RD : AM;
        for (let k = 0; k < 3; k++) put(tr[o]! - tr[o + 3]! * 0.012 * k, tr[o + 1]! - tr[o + 4]! * 0.012 * k, tr[o + 2]! - tr[o + 5]! * 0.012 * k, 0.035 * big, k ? c : WH, 2.4 - k * 0.7);
      }
      for (let i = 0; i < nsp; i++) {
        const o = i * 10;
        put(sp[o]!, sp[o + 1]!, sp[o + 2]!, 0.04 * big, SPARK_C[sp[o + 8]!] ?? RD, 2.6 * Math.min(1, (sp[o + 6]! / sp[o + 7]!) * 1.6));
      }
      for (const d of drones) craft(d.p, d.v, 0.045 * big, MEND, 2.4, 0.04);
      // amber traffic: shuttles running the tool lanes out from the berths and the uplink
      for (let k = 0; k < 9; k++) {
        const lane = k % 3;
        const a = lane === 0 ? toWorld([4.55, -1.75, 0]) : lane === 1 ? toWorld([-4.55, -1.75, 0]) : toWorld(FEED);
        const b: V3 = lane === 0 ? [26, -7, 9] : lane === 1 ? [-16, -8, -22] : [9, 30, -40];
        let u = (k / 9 + t * 0.035 * (1 + (k % 2) * 0.4)) % 1;
        if (k % 2) u = 1 - u;
        const p = mix(a, b, u * u);
        const v = mul(sub(b, a), (k % 2 ? -1 : 1) * 0.05);
        craft(p, v, 0.05 * big, AM, 1.9 * Math.min(1, u * 8), 0.06);
      }

      // --- the station's state
      uBrO.fill(0);
      uBrS.fill(0);
      let alarm = 0;
      for (let s = 0; s < NSEC; s++) {
        const b = breaches[s];
        if (!b) continue;
        const tb = t - b.t0;
        const R = SEC_R[s]!;
        let rr = 0;
        let front = 0;
        let alpha = 1;
        let restored = 0;
        if (tb < REPAIR0) rr = Math.min(R, 0.12 + (tb / SPREAD) * R);
        else if (tb < REPAIR1) {
          rr = R * (1 - (tb - REPAIR0) / (REPAIR1 - REPAIR0));
          front = 1;
        } else {
          alpha = 0;
          restored = Math.max(0, 1 - (tb - REPAIR1) / (END - REPAIR1));
        }
        if (alpha > 0) alarm = 1;
        uBrO.set([b.o[0], b.o[1], b.o[2], rr], s * 4);
        uBrS.set([alpha, front, restored, 0], s * 4);
      }
      uHit.fill(-1);
      uHitC.fill(0);
      hits.forEach((h, i) => {
        const age = t - h.t0;
        if (age > 2) return;
        uHit.set([h.d[0], h.d[1], h.d[2], age], i * 4);
        uHitC.set([h.c[0], h.c[1], h.c[2], h.size], i * 4);
      });
      uFx.fill(-1);
      uFxC.fill(0);
      // the battle's light on the bridge: the station's cool glow, every explosion, red while something burns
      let rr = 0.09;
      let rg = 0.17;
      let rb = 0.27;
      fx.forEach((e, i) => {
        const age = t - e.t0;
        if (age > 1.6) return;
        uFx.set([e.p[0], e.p[1], e.p[2], age], i * 4);
        uFxC.set([e.c[0], e.c[1], e.c[2], e.size], i * 4);
        const k = e.size * Math.exp(-age * 2.8) * 0.3;
        rr += e.c[0] * k;
        rg += e.c[1] * k;
        rb += e.c[2] * k;
      });
      if (alarm) rr += 0.05 + 0.03 * Math.sin(t * 6);
      if (director.phase(t) === "war") alarm = 1;

      setCam(set, cam);
      set.v4("uHead", hx, hy, narrow ? 1 : 0, level);
      set.v4("uRim", Math.min(rr, 0.55), Math.min(rg, 0.55), Math.min(rb, 0.55), alarm);
      set.v4("uSt", spin, 1 + 0.12 * Math.sin(t * 1.7), level, 0);
      set.v4("uPlanet", PC[0], PC[1], PC[2], PR);
      set.v3("uSun", SUN[0], SUN[1], SUN[2]);
      set.v3("uFill", FILL[0], FILL[1], FILL[2]);
      set.v3("uSkyR", B0.R[0], B0.R[1], B0.R[2]);
      set.v3("uSkyU", B0.U[0], B0.U[1], B0.U[2]);
      set.v3("uSkyF", B0.F[0], B0.F[1], B0.F[2]);
      set.v4v("uBrO", uBrO);
      set.v4v("uBrS", uBrS);
      set.v4v("uHit", uHit);
      set.v4v("uHitC", uHitC);
      set.v4v("uFx", uFx);
      set.v4v("uFxC", uFxC);
      set.points(pts, np, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      const t = f.t;
      const out: Label[] = [];
      const place = (p: V3, text: string, tone: string, dy = -18) => {
        const s = projectPoint(p, cam, f);
        if (!s) return;
        const nx = (s.x / f.width) * 2 - 1;
        const ny = 1 - (s.y / f.height) * 2;
        if (s.x < f.width * 0.47 || s.x > f.width - 40 || s.y < 30 || s.y > f.height * 0.8 || hullAt(nx + hx, ny + hy, false)) return;
        out.push({ text, x: s.x, y: s.y + dy, tone, anchor: "middle" });
      };
      for (let s = 0; s < NSEC; s++) {
        const b = breaches[s];
        if (!b) continue;
        const tb = t - b.t0;
        if (tb < REPAIR1) place(secWorld(s, b.o, spin), `[ ${SECTIONS[s]} · ${tb < REPAIR0 ? "breach" : "repair"} ]`, tb < REPAIR0 ? "hot" : "dim");
      }
      // the section an attack is closing on, and its kind riding it for a moment
      const named = new Set<number>();
      for (const m of missiles) {
        const u = (t - m.t0) / m.dur;
        if (u > 0.45 && !named.has(m.sec) && !breaches[m.sec]) {
          named.add(m.sec);
          place(m.e, `[ ${SECTIONS[m.sec]} ]`, "dim");
        }
      }
      const newest = missiles[missiles.length - 1];
      if (newest) {
        const u = (t - newest.t0) / newest.dur;
        if (u > 0.12 && u < 0.5) place(newest.head, newest.ev.kind.toLowerCase(), "hot", -20);
      }
      if (swarm && t - swarm.t0 < 6.5) {
        let c: V3 = [0, 0, 0];
        let n = 0;
        for (const fo of swarm.foes)
          if (fo.alive) {
            c = add(c, fo.p);
            n++;
          }
        if (n) place(mul(c, 1 / n), `[ hostile ${SHAPES[swarm.shape]} · ${n} ]`, "hot", -26);
      }
      const kept = declutter(out, f.width).slice(0, 3);
      kept.push({ text: "sim · attack mix and breach odds from the last 90 days", x: f.width - 16, y: f.height - 16, tone: "dim", anchor: "end" });
      return kept;
    },
  };
}
