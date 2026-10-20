import type { ThreatIntel } from "@/lib/threatIntel";
import { POINT_STRIDE, projectPoint, type Cam, type FrameInfo, type GlyphController, type V3 } from "../engine";
import type { FeedEvent } from "../feed";
import { WaveDirector } from "./director";
import { AMBER, CYAN, Flashes, RED, setCam, WHITE, type Emit } from "./kit";

/** the lighthouse (radar tower) on its rock, and its lantern */
const LH: V3 = [1.5, 0, -3.8];
const LAMP_Y = 2.56;
/** the buoy line: an arc round the lighthouse, facing the open sea */
const RB = 6.5;
const PHI0 = -1.0;
const PHI1 = 0.38;
/** patrol boats run just outside the buoys; the counter-swarm holds just inside */
const RBOAT = 8.1;
const RDRONE = 5.2;
/** where the storm front stalls, held at the line */
const RSTALL = RB + 1.6;

/** a low moon out to sea, above the focal point, so its glitter path runs through the buoy line */
const MOON: V3 = (() => {
  const m: V3 = [-0.02, 0.045, -1];
  const l = Math.hypot(m[0], m[1], m[2]);
  return [m[0] / l, m[1] / l, m[2] / l];
})();

const HOT: V3 = [1, 0.42, 0.3];
const ICE: V3 = [0.6, 0.92, 1];
const PALE: V3 = [1, 0.85, 0.62];

const FRAG = `
uniform vec3 uEye;
uniform vec3 uTarget;
uniform vec4 uSt[8];
uniform vec4 uStB[8];
uniform vec4 uFront;
uniform vec4 uBuoy[8];
uniform vec4 uBuoyC[8];
uniform vec4 uRing;
uniform vec4 uRingK;
uniform vec4 uTake;
uniform vec4 uLamp;
uniform vec4 uBmA[6];
uniform vec4 uBmB[6];
uniform vec4 uFlash[6];
uniform vec4 uFlashC[6];
uniform vec3 uMoon;

const vec3 LH = vec3(${LH[0].toFixed(2)}, 0., ${LH[2].toFixed(2)});
const vec3 LAMP = vec3(${LH[0].toFixed(2)}, ${LAMP_Y.toFixed(2)}, ${LH[2].toFixed(2)});

float sqr(float x){ return x*x; }
/** a swell with peaked crests and flat troughs (zero mean) */
float swell(float x){ float s = .5 + .5*sin(x); return 2.*s*s - .75; }
/** travelling swells rolling in towards the shore (the same sum as in the controller) */
float waves(vec2 p){
  return .2*swell(dot(p, vec2(.12, .993))*.898 - uTime*1.35)
    + .11*swell(dot(p, vec2(-.349, .937))*1.46 - uTime*1.75 + 1.3)
    + .06*swell(dot(p, vec2(.552, .834))*2.42 - uTime*2.3 + 4.1)
    + .035*swell(dot(p, vec2(-.8, .6))*3.7 - uTime*2.96 + 2.2);
}
float chop(vec2 p){ return (fbm3(vec3(p*1.7, uTime*.45)) - .5)*.1; }

/** the sea: swells twisted by whirlpools, raised by surges and by the storm front */
float H(vec2 p){
  vec2 q = p;
  float hs = 0.;
  for(int i = 0; i < 8; i++){
    vec4 s = uSt[i];
    if(s.w <= 0.) continue;
    vec2 d = p - s.xy;
    float r2 = dot(d, d)/(s.z*s.z);
    if(r2 > 7.) continue;
    vec4 b = uStB[i];
    if(b.z < 1.5){
      float sw = exp(-r2*1.2);
      q = s.xy + rot2(s.w*b.w*(b.z > .5 ? 1.3 : 2.6)*sw)*(q - s.xy);
      hs += s.w*(-.55*exp(-r2*5.) + .12*exp(-sqr(sqrt(r2) - .55)*10.));
    } else {
      float al = dot(d, b.xy)/s.z;
      float ac = dot(d, vec2(-b.y, b.x))/s.z;
      hs += s.w*.7*exp(-al*al*4. - ac*ac*.6);
    }
  }
  float h = waves(q) + hs;
  if(uFront.y > 0.){
    vec2 dl = p - LH.xz;
    float x = (length(dl) - uFront.x)/1.3;
    float sector = smoothstep(1.55, 1.15, abs(atan(dl.x, -dl.y) + .3));
    h += uFront.y*sector*(exp(-x*x)*(.8 + .2*sin(p.x*1.7 + uTime*2.3)) + .25*smoothstep(-.5, 2., x));
  }
  return h;
}
vec3 wnrm(vec2 p, float t){
  float e = .03 + t*.0025;
  vec2 ex = vec2(e, 0.), ez = vec2(0., e);
  float hx = H(p + ex) + chop(p + ex) - H(p - ex) - chop(p - ex);
  float hz = H(p + ez) + chop(p + ez) - H(p - ez) - chop(p - ez);
  return normalize(vec3(-hx, 2.*e, -hz));
}

/** the lighthouse: rock, banded tower, gallery, lantern, roof and mast */
float sdLH(vec3 q, out float m){
  // a taken-over tower glitches: slices of it slip sideways
  if(uTake.z > 0. && q.y > uTake.y && q.y < uTake.x){
    float h = hash12(vec2(floor(q.y*14.), floor(uTime*15.)));
    q.x += step(.6, h)*(h - .8)*.35*uTake.z;
  }
  float rad = mix(.32, .21, clamp((q.y - .2)/2.15, 0., 1.));
  float tower = max(length(q.xz) - rad, abs(q.y - 1.28) - 1.08);
  float gal = max(length(q.xz) - .37, abs(q.y - 2.37) - .04);
  float lan = max(length(q.xz) - .18, abs(q.y - 2.55) - .15);
  float roof = max(length(q.xz) - .24*clamp(1. - (q.y - 2.7)/.25, 0., 1.), abs(q.y - 2.83) - .13);
  float mast = max(length(q.xz) - .016, abs(q.y - 3.1) - .17);
  vec3 rq = q - vec3(0., -.12, 0.);
  float rock = (length(rq/vec3(1.1, .45, .95)) - 1.)*.4 + (noise(q*4.5) - .5)*.1;
  float d = rock;
  m = 0.;
  if(tower < d){ d = tower; m = 1.; }
  if(gal < d){ d = gal; m = 2.; }
  if(lan < d){ d = lan; m = 3.; }
  if(roof < d){ d = roof; m = 4.; }
  if(mast < d){ d = mast; m = 4.; }
  return d;
}
vec3 lhNrm(vec3 q){
  vec2 e = vec2(.003, -.003);
  float m;
  return normalize(e.xyy*sdLH(q + e.xyy, m) + e.yyx*sdLH(q + e.yyx, m) + e.yxy*sdLH(q + e.yxy, m) + e.xxx*sdLH(q + e.xxx, m));
}

vec3 lampCol(){ return mix(vec3(1., .68, .34), vec3(1., .16, .08), uLamp.w); }

vec3 skyCol(vec3 d){
  vec3 c = mix(vec3(.008, .014, .032), vec3(.002, .004, .011), smoothstep(0., .3, d.y));
  // a thin line of haze on the horizon
  c += vec3(.03, .06, .11)*exp(-sqr(d.y/.012))*exp(-sqr((d.x + .02)/.6))*.8;
  // a low moon out to sea, in a soft halo
  float md = dot(d, uMoon);
  c += vec3(.8, .88, 1.)*(smoothstep(.99988, .99994, md)*.55 + exp((md - 1.)*1500.)*.018);
  // the storm front's clouds, lit red from below, and its lightning
  if(uFront.w > 0.){
    float cl = fbm3(vec3(d.x*5., d.y*13. - uTime*.06, uTime*.08));
    float band = smoothstep(.22, .03, d.y)*smoothstep(-.01, .03, d.y)*smoothstep(.75, .25, abs(d.x + .08));
    c += vec3(.7, .12, .07)*smoothstep(.45, .8, cl)*band*uFront.w*(.2 + 1.6*uFront.z) + vec3(.7, .55, .7)*band*uFront.z*cl*.3;
  }
  return c;
}

vec3 shadeLH(vec3 p, vec3 n, vec3 rd, float m){
  vec3 q = p - LH;
  vec3 L = normalize(vec3(-.6, .45, .65));
  float dif = max(dot(n, L), 0.);
  float rim = pow(1. - max(dot(n, -rd), 0.), 3.);
  vec3 c;
  if(m < .5){
    c = vec3(.03, .05, .09)*(.35 + 1.2*dif) + vec3(.2, .45, .8)*rim*.25 + vec3(.5, .8, 1.)*smoothstep(.2, 0., q.y)*noise(vec3(q.xz*6., uTime*2.))*.3;
    // spray-wet rock catches the radar pulses
    for(int i = 0; i < 4; i++){ float r = uRing[i]; if(r > 0. && r < 1.5) c += lampCol()*exp(-r*2.)*.6; }
  } else if(m < 1.5){
    float band = step(.5, fract(q.y*1.15 + .2));
    c = mix(vec3(.08, .2, .42), vec3(.45, .7, 1.), band*.6)*(.3 + 1.1*dif) + vec3(.35, .75, 1.)*rim*.5;
    float ang = atan(q.z, q.x);
    float win = step(abs(fract(q.y*1.15 + .45) - .5), .06)*step(abs(ang - 1.79), .16)*step(.5, q.y)*step(q.y, 2.2);
    c += vec3(1., .7, .35)*win*1.2;
  } else if(m < 2.5){
    c = vec3(.3, .6, .9)*(.2 + dif) + vec3(.5, .9, 1.)*rim*.5;
  } else if(m < 3.5){
    float mull = step(.86, fract(atan(q.z, q.x)*.9549297));
    c = lampCol()*uLamp.x*(1.7 - mull*1.3);
  } else {
    c = vec3(.05, .1, .2)*(.3 + dif) + vec3(.3, .7, 1.)*rim*.3;
  }
  // takeover: red from the base up, glitching; a cyan cleaning line climbs and leaves it clean
  float inRed = smoothstep(uTake.y - .02, uTake.y + .02, q.y)*(1. - smoothstep(uTake.x - .05, uTake.x + .05, q.y));
  if(inRed > 0. && m < 3.5){
    float l = dot(c, vec3(.33));
    float blk = step(.8, hash12(floor(vec2(atan(q.z, q.x)*3., q.y*10.)) + floor(uTime*10.)*.37));
    float fl = .6 + .4*step(.5, hash12(vec2(floor(uTime*13.), 2.)));
    c = mix(c, vec3(1., .16, .08)*(.12 + l*2.6)*fl + vec3(1., .35, .2)*blk*.6, inRed);
  }
  if(uTake.y > .02 && uTake.y < uTake.x) c += vec3(.4, .92, 1.)*exp(-sqr((q.y - uTake.y)/.05))*2.;
  return c;
}

vec3 stormGlow(vec2 xz){
  vec3 c = vec3(0.);
  for(int i = 0; i < 8; i++){
    vec4 s = uSt[i];
    if(s.w <= 0.) continue;
    vec4 b = uStB[i];
    vec2 d = xz - s.xy;
    if(b.z > 1.5){
      float al = dot(d, b.xy)/s.z;
      float ac = dot(d, vec2(-b.y, b.x))/s.z;
      c += vec3(1., .25, .12)*s.w*(exp(-al*al*5. - ac*ac*.5)*1.6 + exp(-ac*ac*.8)*exp(al*1.2)*step(al, 0.)*.5);
      continue;
    }
    float r = length(d)/s.z;
    if(r > 3.5) continue;
    float ang = atan(d.y, d.x);
    float arm = .5 + .5*sin(2.*ang - b.w*(6.*log(r + .06) - uTime*4.));
    c += vec3(1., .22, .1)*s.w*(arm*arm*arm*exp(-r*r*1.1)*2.2 + exp(-r*r*7.)*2.2 + exp(-r*r*.8)*.12);
    if(b.z > .5){
      // a squall drags a wake of red foam
      float al = dot(d, b.xy)/s.z;
      float ac = dot(d, vec2(-b.y, b.x))/s.z;
      c += vec3(1., .3, .15)*s.w*exp(-ac*ac*3.)*step(al, 0.)*exp(al*.5)*(.5 + .5*noise(vec3(xz*3., uTime*2.)))*.9;
    }
  }
  return c;
}

void main(){
  vec2 nd = ndc();
  vec3 ro = uEye;
  vec3 rd = camRay(lookAt(ro, uTarget));
  vec3 col = skyCol(rd) + starfield(.0025)*.4*smoothstep(.06, .3, rd.y);
  float tHit = 200.;

  // the sea
  float tw = -1.;
  if(rd.y < -.002){
    float t = max(0., (ro.y - uLamp.z)/(-rd.y));
    float tmax = min(110., (ro.y + .9)/(-rd.y));
    float tp = t;
    float dp = ro.y + rd.y*t - H((ro + rd*t).xz);
    for(int i = 0; i < 100; i++){
      t += clamp(dp*.55/(-rd.y), .02 + t*.004, .5 + t*.06);
      vec3 p = ro + rd*t;
      float d = p.y - H(p.xz);
      if(d < 0.){ tw = tp + (t - tp)*dp/(dp - d); break; }
      tp = t;
      dp = d;
      if(t > tmax) break;
    }
  }
  // the lighthouse, inside its bounding cylinder
  float tL = 1e9;
  float mL = 0.;
  {
    vec2 oc = ro.xz - LH.xz;
    float a = dot(rd.xz, rd.xz);
    float b = dot(oc, rd.xz);
    float h = b*b - a*(dot(oc, oc) - 1.);
    if(h > 0.){
      h = sqrt(h);
      float t1 = (-b + h)/a;
      float t = max((-b - h)/a, 0.);
      for(int i = 0; i < 64; i++){
        vec3 p = ro + rd*t;
        float m;
        float d = sdLH(p - LH, m);
        if(d < .0015*t){ tL = t; mL = m; break; }
        t += d*.8;
        if(t > t1 || p.y > 3.5) break;
      }
    }
  }
  if(tL < 1e8 && (tw < 0. || tL < tw)){
    tHit = tL;
    vec3 p = ro + rd*tL;
    col = mix(skyCol(rd), shadeLH(p, lhNrm(p - LH), rd, mL), exp(-tL*.02));
  } else if(tw > 0.){
    tHit = tw;
    vec3 p = ro + rd*tw;
    vec3 n = wnrm(p.xz, tw);
    vec3 rf = reflect(rd, n);
    float fres = .04 + .96*pow(1. - max(dot(n, -rd), 0.), 5.);
    float ht = p.y;
    // dark water; the swells' crest lines catch the light
    vec3 c = vec3(.002, .006, .016) + skyCol(rf)*fres*.25;
    float s1 = .5 + .5*sin(dot(p.xz, vec2(.12, .993))*.898 - uTime*1.35);
    float s2 = .5 + .5*sin(dot(p.xz, vec2(-.349, .937))*1.46 - uTime*1.75 + 1.3);
    float crest = (pow(s1, 16.) + .45*pow(s2, 16.))*smoothstep(.3, .75, noise(vec3(p.xz*.7, uTime*.25)));
    c += vec3(.07, .24, .5)*crest*smoothstep(30., 8., tw)*1.5;
    // the moon's glitter path
    c += vec3(.75, .86, 1.)*pow(max(dot(rf, uMoon), 0.), 60.)*1.4*(.4 + .6*noise(vec3(p.xz*4., uTime)));
    // foam on the sharpest crests
    float foam = smoothstep(.17, .4, ht + chop(p.xz)*.8)*(.45 + .55*noise(vec3(p.xz*3.2, uTime*.6)))*smoothstep(32., 10., tw);
    c += vec3(.55, .82, 1.)*foam*.42;
    // the lantern's glitter path, and the buoy lights in the swell
    vec3 Ld = LAMP - p;
    float dl = length(Ld);
    c += lampCol()*pow(max(dot(rf, Ld/dl), 0.), 160.)*uLamp.x*1.3*smoothstep(1.5, 4., dl);
    for(int i = 0; i < 8; i++){
      vec4 B = uBuoy[i];
      if(B.w <= 0.) continue;
      c += uBuoyC[i].rgb*pow(max(dot(rf, normalize(B.xyz - p)), 0.), 160.)*B.w*1.6;
    }
    // radar pulses: rings of light running out over the water from the tower
    float dr = length(p.xz - LH.xz);
    float face = (.35 + .65*max(dot(n, normalize(vec3(LH.x - p.x, 1.2, LH.z - p.z))), 0.))*smoothstep(1., -1.5, p.z - LH.z);
    for(int i = 0; i < 4; i++){
      float r = uRing[i];
      if(r <= 0.) continue;
      float band = exp(-sqr((dr - r)/(.08 + r*.006)))*sqr(1. - r/46.);
      c += mix(vec3(1., .7, .38), vec3(1., .18, .1), uRingK[i])*band*face*1.4;
    }
    c += stormGlow(p.xz);
    // the storm front: a wall of dark water with a red crest, darker sea behind it
    if(uFront.y > 0.){
      vec2 dl2 = p.xz - LH.xz;
      float x = (length(dl2) - uFront.x)/1.3;
      float sector = smoothstep(1.55, 1.15, abs(atan(dl2.x, -dl2.y) + .3));
      float ridge = exp(-x*x)*sector*uFront.y;
      c *= 1. - .55*smoothstep(0., 2., x)*sector*min(uFront.y, 1.);
      c += vec3(1., .2, .1)*ridge*smoothstep(.2, .75, ht)*(.6 + .4*noise(vec3(p.xz*2.5, uTime*1.5)))*3.;
    }
    // a taken-over tower bleeds red into the water round its rock
    c += vec3(1., .15, .08)*exp(-sqr(dr/1.8))*min(uTake.x, 1.)*(1. - smoothstep(.5, 2.5, uTake.y))*(.01 + 1.5*crest + foam);
    col = mix(skyCol(rd), c, exp(-tw*.028));
  }

  // the lantern's light
  col += lampCol()*(pointGlow(ro, rd, LAMP, .1)*1.5 + pointGlow(ro, rd, LAMP, .45)*.011)*uLamp.x;
  // buoy lights and the fence of light strung between them
  for(int i = 0; i < 8; i++){
    vec4 B = uBuoy[i];
    if(B.w <= 0.) continue;
    if(dot(B.xyz - ro, rd) > tHit + .5) continue;
    col += uBuoyC[i].rgb*(pointGlow(ro, rd, B.xyz, .085)*2.4 + pointGlow(ro, rd, B.xyz, .3)*.012)*B.w;
    if(i < 7){
      vec4 B2 = uBuoy[i + 1];
      if(B2.w <= 0.) continue;
      float s;
      vec3 a = B.xyz - vec3(0., .14, 0.);
      vec3 b = B2.xyz - vec3(0., .14, 0.);
      float d2 = segDist2(ro, rd, a, b, s);
      float st = max(uBuoyC[i].a, uBuoyC[i + 1].a);
      float red = clamp(-min(uBuoyC[i].a, uBuoyC[i + 1].a), 0., 1.);
      float dash = red > 0. ? step(.45, fract(s*9. + uTime*3.)) : .65 + .35*sin(s*40. - uTime*5.);
      vec3 fc = mix(vec3(.3, .8, 1.), vec3(1., .2, .1), red);
      col += fc*(exp(-d2/.008)*.55 + exp(-d2/.05)*.015)*(.5 + max(st, 0.)*2. + red*.8)*dash;
    }
  }
  // red haze over each storm
  for(int i = 0; i < 8; i++){
    vec4 s = uSt[i];
    if(s.w <= 0.) continue;
    vec3 c = vec3(s.x, .6, s.y);
    if(dot(c - ro, rd) > tHit + 2.) continue;
    col += vec3(1., .2, .1)*pointGlow(ro, rd, c, s.z*.75)*s.w*.32;
  }
  // defender beams
  for(int i = 0; i < 6; i++){
    vec4 A = uBmA[i];
    if(A.w <= 0.) continue;
    float s;
    float d2 = segDist2(ro, rd, A.xyz, uBmB[i].xyz, s);
    vec3 cp = A.xyz + (uBmB[i].xyz - A.xyz)*s;
    if(dot(cp - ro, rd) > tHit + .3) continue;
    col += vec3(.45, .92, 1.)*A.w*(exp(-d2/.0015)*1.8 + exp(-d2/.015)*.3);
  }
  // flashes
  for(int i = 0; i < 6; i++){
    vec4 f = uFlash[i];
    if(f.w < 0.) continue;
    vec3 oc = f.xyz - ro;
    float tt = dot(oc, rd);
    if(tt < 0. || tt > tHit + .5) continue;
    float d = length(oc - rd*tt);
    float sz = uFlashC[i].a;
    float r = sz*(1. - exp(-f.w*5.));
    float w = .03 + sz*.08;
    col += uFlashC[i].rgb*(exp(-sqr((d - r)/w))*exp(-f.w*3.)*1.6 + exp(-d*d/(sz*sz*.08))*exp(-f.w*6.)*4.);
  }
  // keep the headline side calm on wide layouts
  if(uShift > .01) col *= .32 + .68*smoothstep(-1.05, -.1, nd.x);
  outCol(col);
}
`;

const swl = (x: number) => {
  const s = 0.5 + 0.5 * Math.sin(x);
  return 2 * s * s - 0.75;
};
/** the swells, as in the shader (without whirlpools or chop) */
const waves = (x: number, z: number, t: number) =>
  0.2 * swl((x * 0.12 + z * 0.993) * 0.898 - t * 1.35) +
  0.11 * swl((x * -0.349 + z * 0.937) * 1.46 - t * 1.75 + 1.3) +
  0.06 * swl((x * 0.552 + z * 0.834) * 2.42 - t * 2.3 + 4.1) +
  0.035 * swl((x * -0.8 + z * 0.6) * 3.7 - t * 2.96 + 2.2);
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
/** a point on a circle round the lighthouse; phi is measured from straight out to sea */
const arcX = (phi: number, r: number) => LH[0] + Math.sin(phi) * r;
const arcZ = (phi: number, r: number) => LH[2] - Math.cos(phi) * r;

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

interface Storm {
  ev: FeedEvent;
  /** 0 whirlpool, 1 squall, 2 surge */
  type: number;
  sx: number;
  sz: number;
  bx: number;
  bz: number;
  buoy: number;
  t0: number;
  v: number;
  R: number;
  spin: number;
  /** intercepted: when the boat pins it, which boat (-1: none free) */
  ti: number;
  boat: number;
  /** when it began to break up (held or intercepted), or began its surge (breach) */
  tEnd: number;
  surge: number;
  done: boolean;
  x: number;
  z: number;
  S: number;
}

interface Front {
  ev: FeedEvent;
  t0: number;
  n: number;
  phi: Float32Array;
  dr: Float32Array;
  hy: Float32Array;
  dead: Float32Array;
  lk: Uint8Array;
  lx: Float32Array;
  ly: Float32Array;
  lz: Float32Array;
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
 * Packet ocean: a rolling glyph sea at night, swells running in with foam on
 * their crests and amber packets of traffic riding them, a lighthouse radar
 * tower on its rock whose light pulses out over the water as rings, and a
 * line of defence buoys strung with light in the mid-distance. Attacks from
 * the 90-day feed are storms: red whirlpools and squalls racing in from the
 * horizon. Most are held at the buoy line (the buoys flare and the storm
 * breaks up) or broken up by a patrol boat; in war a red storm front rolls
 * in and a swarm of drones rises from the tower to meet it. At the type's
 * real harm rate a storm gets through: a red surge hits the rock, the tower
 * turns red and glitches, and a cleaning sweep restores it and its light.
 */
export function packetOcean({ intel, emit }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const director = new WaveDirector(intel, 131);
  const rnd = director.rnd;
  const flashes = new Flashes();
  const pts = new Pts(2400);
  let storms: Storm[] = [];
  let breaches: Breach[] = [];
  let beams: Beam[] = [];
  let front: Front | null = null;
  let ready = false;
  let narrow = false;
  let NB = 8;
  let NBOAT = 4;
  let NS = 26;
  const boatJob: (Storm | null)[] = [];
  const buoyFlare = new Float32Array(8).fill(-99);
  const buoyRed = new Float32Array(8).fill(-99);
  const ringT = new Float32Array(4).fill(-99);
  const ringRed = new Float32Array(4);
  let ringAt = 0;
  let nextRing = 0.6;
  let lastHeld: { b: number; t: number } | null = null;
  let relightT = -99;
  let take = { top: 0, clean: 0, glitch: 0, lampRed: 0 };
  let cam: Cam = { eye: [0, 2.3, 3], target: [0.35, 0, -18] };
  const P: P3 = { x: 0, y: 0, z: 0 };
  const Q: P3 = { x: 0, y: 0, z: 0 };

  // sparks (spray): a ring buffer of x y z vx vy vz t0 life, with gravity
  const SPK = 420;
  const spk = new Float32Array(SPK * 8);
  const spkC = new Uint8Array(SPK);
  for (let i = 0; i < SPK; i++) spk[i * 8 + 6] = -99;
  let spkAt = 0;
  const SPK_COL: V3[] = [RED, HOT, ICE, WHITE, CYAN];

  // uniforms
  const stU = new Float32Array(32);
  const stB = new Float32Array(32);
  const buoyU = new Float32Array(32);
  const buoyC = new Float32Array(32);
  const bmA = new Float32Array(24);
  const bmB = new Float32Array(24);
  const slot: { x: number; z: number; R: number; S: number; dx: number; dz: number; type: number; spin: number; pri: number }[] = [];
  for (let i = 0; i < 16; i++) slot.push({ x: 0, z: 0, R: 1, S: 0, dx: 0, dz: 1, type: 0, spin: 1, pri: 0 });

  const view = { ex: 0, ey: 0, ez: 0, fx: 0, fy: 0, fz: -1, rx: 1, rz: 0, tanX: 1, shift: 0, calm: false };
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
  /** fog and the calm left side, for a point at world x y z */
  const vis = (x: number, y: number, z: number) => {
    const vx = x - view.ex;
    const vy = y - view.ey;
    const vz = z - view.ez;
    const d = vx * view.fx + vy * view.fy + vz * view.fz;
    if (d < 0.2) return 0;
    let k = Math.exp(-d * 0.028);
    if (view.calm) {
      const nx = (vx * view.rx + vz * view.rz) / (d * view.tanX) + view.shift;
      k *= 0.32 + 0.68 * smooth(-1.05, -0.1, nx);
    }
    return k;
  };
  const put = (x: number, y: number, z: number, r: number, c: V3, k: number) => pts.add(x, y, z, r, c, k * vis(x, y, z));

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
  /** spray thrown up from x y z */
  const spray = (x: number, y: number, z: number, n: number, speed: number, up: number, t: number, cols: number[]) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const s = speed * (0.3 + rnd() * 0.9);
      spark(x, y, z, Math.cos(a) * s, up * (0.5 + rnd() * 0.8), Math.sin(a) * s, t, 0.7 + rnd() * 0.6, cols[i % cols.length]!);
    }
  };

  const buoyPhi = (i: number) => PHI0 + ((PHI1 - PHI0) * i) / (NB - 1);
  const buoyY = (i: number, t: number) => waves(arcX(buoyPhi(i), RB), arcZ(buoyPhi(i), RB), t) * 0.8 + 0.32;

  /** a patrol boat, running back and forth just outside the buoys */
  const patrol = (i: number, t: number, out: P3) => {
    const c = PHI0 + 0.1 + ((PHI1 - PHI0 - 0.2) * (i + 0.5)) / NBOAT;
    const phi = c + 0.33 * Math.sin(t * 0.16 + i * 2.1);
    out.x = arcX(phi, RBOAT);
    out.z = arcZ(phi, RBOAT);
    out.y = waves(out.x, out.z, t) + 0.06;
  };
  /** where boat i is (patrolling, racing out, circling a storm, coming back); returns its brightness */
  const boatAt = (i: number, t: number, out: P3) => {
    const st = boatJob[i];
    if (st) {
      const ts = Math.max(st.t0, st.ti - 1.6);
      if (t >= ts && t < st.ti + 3) {
        // the circle round the pinned storm
        const cx = st.x;
        const cz = st.z;
        const rr = st.R + 0.35;
        if (t < st.ti) {
          patrol(i, ts, Q);
          const u = ease((t - ts) / Math.max(0.2, st.ti - ts));
          const a0 = Math.atan2(LH[2] - cz, LH[0] - cx);
          out.x = Q.x + (cx + Math.cos(a0) * rr - Q.x) * u;
          out.z = Q.z + (cz + Math.sin(a0) * rr - Q.z) * u;
        } else if (t < st.ti + 1.4) {
          const a0 = Math.atan2(LH[2] - cz, LH[0] - cx);
          const a = a0 + (t - st.ti) * 4.5;
          out.x = cx + Math.cos(a) * rr;
          out.z = cz + Math.sin(a) * rr;
        } else {
          const a = Math.atan2(LH[2] - cz, LH[0] - cx) + 1.4 * 4.5;
          const sx = cx + Math.cos(a) * rr;
          const sz = cz + Math.sin(a) * rr;
          patrol(i, t, Q);
          const u = ease((t - st.ti - 1.4) / 1.6);
          out.x = sx + (Q.x - sx) * u;
          out.z = sz + (Q.z - sz) * u;
        }
        out.y = waves(out.x, out.z, t) + 0.06;
        return 1.6;
      }
      if (t >= st.ti + 3) boatJob[i] = null;
    }
    patrol(i, t, out);
    return 1;
  };

  /** when every boat is busy, a drone from the tower breaks the storm up instead: out from the lantern, then circling it */
  const airAt = (s: Storm, t: number, out: P3) => {
    if (t < s.ti) {
      const u = ease((t - (s.ti - 1.2)) / 1.2);
      out.x = LH[0] + (s.x - LH[0]) * u;
      out.z = LH[2] + (s.z - LH[2]) * u;
      out.y = LAMP_Y + (0.9 - LAMP_Y) * u + Math.sin(Math.PI * u) * 0.8;
    } else {
      const a = (t - s.ti) * 4.5;
      out.x = s.x + Math.cos(a) * s.R * 0.8;
      out.z = s.z + Math.sin(a) * s.R * 0.8;
      out.y = 0.9;
    }
  };
  /** where a storm is now, and how strong */
  const stormAt = (s: Storm, t: number) => {
    const L = Math.hypot(s.bx - s.sx, s.bz - s.sz) || 1;
    let u = ((t - s.t0) * s.v) / L;
    if (s.ti >= 0) u = Math.min(u, ((s.ti - s.t0) * s.v) / L);
    if (s.surge >= 0) {
      const d = Math.hypot(LH[0] - s.bx, LH[2] - s.bz) || 1;
      const w = Math.min(1, ((t - s.surge) * 6) / d);
      s.x = s.bx + (LH[0] - s.bx) * w;
      s.z = s.bz + (LH[2] - s.bz) * w;
    } else {
      const uu = Math.min(1, u);
      s.x = s.sx + (s.bx - s.sx) * uu;
      s.z = s.sz + (s.bz - s.sz) * uu;
    }
    let S = smooth(0, 1, t - s.t0);
    if (s.tEnd >= 0 && s.surge < 0) S *= 1 - clamp01((t - s.tEnd) / (s.ti >= 0 ? 1.4 : 1));
    s.S = S;
    return Math.min(1, u);
  };

  const hitBreach = (ev: FeedEvent, isSwarm: boolean, t: number) => {
    breaches.push({ ev, swarm: isSwarm, t0: t, dur: isSwarm ? 3.6 : 2.4 });
    const s = 0.5 + rnd();
    spray(LH[0], 0.3, LH[2], 26, 1.6 * s, 3.2, t, [0, 1, 0, 3]);
    flashes.add([LH[0], 0.6, LH[2]], t, [1, 0.3, 0.2], 1.1);
  };

  const launch = (ev: FeedEvent, t: number) => {
    const type = rnd() < 0.4 ? 1 : 0;
    const b = Math.floor(rnd() * NB);
    const phi = buoyPhi(b);
    const bx = arcX(phi, RB);
    const bz = arcZ(phi, RB);
    const out = phi + (rnd() - 0.5) * 0.7;
    const dist = type ? 15 + rnd() * 6 : 10 + rnd() * 6;
    const R = type ? 0.85 + rnd() * 0.2 : 1.3 + rnd() * 0.4;
    const s: Storm = {
      ev,
      type,
      sx: bx + Math.sin(out) * dist,
      sz: bz - Math.cos(out) * dist,
      bx,
      bz,
      buoy: b,
      t0: t,
      v: type ? 5.5 + rnd() * 1.5 : 3.2 + rnd() * 0.8,
      R,
      spin: rnd() < 0.5 ? -1 : 1,
      ti: -1,
      boat: -1,
      tEnd: -1,
      surge: -1,
      done: false,
      x: 0,
      z: 0,
      S: 0,
    };
    if (ev.fate === "intercepted") {
      // pinned and broken up a little way out, before it reaches the buoys
      const L = Math.hypot(s.bx - s.sx, s.bz - s.sz);
      const before = 3.5 + rnd() * 3;
      s.ti = t + Math.max(1.2, (L - before) / s.v);
      // stop the storm short: the target becomes the pin point
      const w = Math.max(0, (L - before) / L);
      s.bx = s.sx + (s.bx - s.sx) * w;
      s.bz = s.sz + (s.bz - s.sz) * w;
      const ts = Math.max(t, s.ti - 1.6);
      let best = -1;
      let bd = 1e9;
      for (let i = 0; i < NBOAT; i++) {
        const j = boatJob[i];
        if (j && j.ti + 3 > ts) continue;
        patrol(i, ts, Q);
        const d = Math.hypot(Q.x - s.bx, Q.z - s.bz);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      s.boat = best;
      if (best >= 0) boatJob[best] = s;
      s.ti = Math.max(s.ti, t + 0.5);
    }
    storms.push(s);
    emit?.(ev, false);
  };

  const droneAt = (fr: Front, i: number, t: number, out: P3) => {
    const tl = fr.t0 + 0.6 + i * 0.06;
    if (t < tl) return 0;
    const phi = PHI0 + 0.05 + ((PHI1 - PHI0 - 0.1) * (i + 0.5)) / NS;
    const sx = arcX(phi, RDRONE);
    const sz = arcZ(phi, RDRONE);
    const sy = 0.75 + 0.45 * hash(i + 7) + 0.08 * Math.sin(t * 2.3 + i);
    const u = ease((t - tl) / 1.8);
    out.x = LH[0] + (sx - LH[0]) * u;
    out.z = LH[2] + (sz - LH[2]) * u;
    out.y = LAMP_Y + (sy - LAMP_Y) * u + Math.sin(Math.PI * u) * 1.1;
    if (fr.over >= 0) {
      const v = ease((t - fr.over) / 2);
      out.x += (LH[0] - out.x) * v;
      out.z += (LH[2] - out.z) * v;
      out.y += (LAMP_Y - out.y) * v;
      return 1 - v * 0.9;
    }
    return 1;
  };
  const frontR = (fr: Front, t: number) => Math.max(RSTALL, 30 - 4 * (t - fr.t0));
  const cellAt = (fr: Front, j: number, t: number, Rf: number, out: P3) => {
    if (fr.lk[j]) {
      const u = ease((t - fr.leakAt) / 1.3);
      out.x = fr.lx[j]! + (LH[0] - fr.lx[j]!) * u;
      out.y = fr.ly[j]! + (1.2 - fr.ly[j]!) * u;
      out.z = fr.lz[j]! + (LH[2] - fr.lz[j]!) * u;
      return;
    }
    const phi = fr.phi[j]! + 0.04 * Math.sin(t * 0.7 + j);
    const r = Rf + fr.dr[j]! + 0.2 * Math.sin(t * 1.3 + j * 2.1);
    out.x = arcX(phi, r);
    out.z = arcZ(phi, r);
    out.y = fr.hy[j]! + 0.15 * Math.sin(t * 2.1 + j);
  };
  const startFront = (ev: FeedEvent, size: number, t: number) => {
    const old = front;
    if (old && old.over < 0) {
      old.dead.fill(t);
      old.over = t;
      if (old.breach) hitBreach(old.ev, true, t);
      else emit?.(old.ev, true, "STORM FRONT BROKEN");
    }
    const n = Math.min(size, narrow ? 45 : 100);
    const fr: Front = {
      ev,
      t0: t,
      n,
      phi: new Float32Array(n),
      dr: new Float32Array(n),
      hy: new Float32Array(n),
      dead: new Float32Array(n).fill(-1),
      lk: new Uint8Array(n),
      lx: new Float32Array(n),
      ly: new Float32Array(n),
      lz: new Float32Array(n),
      killNext: 0,
      leakAt: -1,
      over: -1,
      breach: ev.fate === "breach",
      gap: 4.6 / n,
    };
    for (let j = 0; j < n; j++) {
      fr.phi[j] = PHI0 - 0.1 + (PHI1 - PHI0 + 0.2) * rnd();
      fr.dr[j] = -0.4 + rnd() * 2.2;
      fr.hy[j] = 0.35 + rnd() * 1.3;
    }
    front = fr;
    emit?.(ev, false);
  };

  return {
    frag: FRAG,
    fovY: 36,
    shift: 0.4,
    frame(f, set) {
      const t = f.t;
      const dt = Math.min(0.05, f.dt || 1 / 60);
      if (!ready) {
        narrow = f.narrow;
        NB = narrow ? 6 : 8;
        NBOAT = narrow ? 3 : 4;
        NS = narrow ? 14 : 26;
        for (let i = 0; i < NBOAT; i++) boatJob.push(null);
        ready = true;
      }
      const level = director.level(t);
      const wave = director.tick(t);
      for (const ev of wave.attacks) launch(ev, t);
      if (wave.swarm) startFront(wave.swarm.ev, wave.swarm.size, t);

      // radar rings from the lantern, quicker as the threat rises
      if (t >= nextRing) {
        ringT[ringAt] = t;
        ringRed[ringAt] = take.lampRed;
        ringAt = (ringAt + 1) % 4;
        nextRing = t + (take.lampRed ? 1.1 : 2.8 - 1.1 * level);
      }

      // storms: held at the buoys, broken up by a boat, or (a real breach) a surge to the tower
      for (const s of storms) {
        if (s.done) continue;
        const u = stormAt(s, t);
        if (s.ti >= 0) {
          if (t >= s.ti && s.tEnd < 0) s.tEnd = s.ti;
          if (s.tEnd >= 0 && t - s.tEnd > 1.4) {
            s.done = true;
            spray(s.x, 0.2, s.z, 14, 1.4, 2, t, [2, 3, 1]);
            flashes.add([s.x, 0.3, s.z], t, [0.5, 0.9, 1], 0.7);
            emit?.(s.ev, true, "INTERCEPTED BY PATROL");
          }
        } else if (s.surge >= 0) {
          if (Math.hypot(s.x - LH[0], s.z - LH[2]) < 1.1) {
            s.done = true;
            hitBreach(s.ev, false, t);
          }
        } else if (u >= 1 && s.tEnd < 0) {
          if (s.ev.fate === "breach") {
            // it breaks the line: the buoy goes red, a surge runs for the tower
            buoyRed[s.buoy] = t;
            s.surge = t;
            s.type = 2;
            flashes.add([s.bx, 0.35, s.bz], t, [1, 0.3, 0.2], 0.5);
          } else {
            s.tEnd = t;
            buoyFlare[s.buoy] = t;
            lastHeld = { b: s.buoy, t };
            spray(s.bx, 0.3, s.bz, 16, 1.2, 2.4, t, [3, 2, 2, 1]);
            flashes.add([s.bx, 0.35, s.bz], t, [0.6, 0.92, 1], 0.8);
          }
        } else if (s.tEnd >= 0 && t - s.tEnd > 1) {
          s.done = true;
          emit?.(s.ev, true, "HELD AT THE BUOY LINE");
        }
      }
      storms = storms.filter((s) => !s.done);

      // the storm front and the drones that rise to meet it
      const fr = front;
      let Rf = 0;
      let alive = 0;
      if (fr) {
        Rf = frontR(fr, t);
        let near = -1;
        let nearR = 1e9;
        for (let j = 0; j < fr.n; j++) {
          if (fr.dead[j]! >= 0) continue;
          if (fr.lk[j]) {
            if (t - fr.leakAt > 1.3) {
              for (let i = 0; i < fr.n; i++) if (fr.lk[i]) fr.dead[i] = t;
              hitBreach(fr.ev, true, t);
              fr.over = t;
              break;
            }
            continue;
          }
          alive++;
          const r = Rf + fr.dr[j]!;
          if (r < nearR) {
            nearR = r;
            near = j;
          }
        }
        const engaged = t > fr.t0 + 2.6 && Rf - RDRONE < 7.5;
        if (fr.breach && fr.leakAt < 0 && engaged && alive <= 3 && alive > 0) {
          // at the type's real harm rate a few cells break through the line
          fr.leakAt = t;
          for (let j = 0; j < fr.n; j++) {
            if (fr.dead[j]! >= 0) continue;
            cellAt(fr, j, t, Rf, P);
            fr.lk[j] = 1;
            fr.lx[j] = P.x;
            fr.ly[j] = P.y;
            fr.lz[j] = P.z;
            const b = Math.round(((fr.phi[j]! - PHI0) / (PHI1 - PHI0)) * (NB - 1));
            if (b >= 0 && b < NB) buoyRed[b] = t;
          }
          alive = 0;
          near = -1;
        }
        let kills = 0;
        while (engaged && near >= 0 && t >= fr.killNext && kills < 3 && fr.over < 0) {
          cellAt(fr, near, t, Rf, P);
          fr.dead[near] = t;
          alive--;
          kills++;
          const di = Math.floor(rnd() * NS);
          droneAt(fr, di, t, Q);
          beams.push({ a: [Q.x, Q.y, Q.z], b: [P.x, P.y, P.z], t0: t, dur: 0.15 });
          spray(P.x, P.y, P.z, 3, 0.9, 0.6, t, [0, 1, 3]);
          if (alive % 10 === 0) flashes.add([P.x, P.y, P.z], t, [1, 0.45, 0.3], 0.35);
          fr.killNext = Math.max(fr.killNext, t - 0.1) + fr.gap;
          near = -1;
          nearR = 1e9;
          for (let j = 0; j < fr.n; j++) {
            if (fr.dead[j]! >= 0 || fr.lk[j]) continue;
            const r = Rf + fr.dr[j]!;
            if (r < nearR) {
              nearR = r;
              near = j;
            }
          }
        }
        if (alive <= 0 && fr.over < 0 && fr.leakAt < 0) {
          fr.over = t;
          emit?.(fr.ev, true, "STORM FRONT BROKEN");
          for (let i = 0; i < NB; i++) buoyFlare[i] = t + i * 0.05;
        }
        if (fr.over >= 0 && t - fr.over > 3) front = null;
      }

      // breaches: red climbs the tower, it glitches, a cleaning line climbs after it and the light returns
      let top = 0;
      let clean = 9;
      let glitch = 0;
      for (const b of breaches) {
        const tau = t - b.t0;
        top = Math.max(top, 3.4 * ease(tau / 0.3));
        clean = Math.min(clean, tau < 0.8 ? 0 : 3.4 * ease((tau - 0.8) / (b.dur - 1.0)));
        glitch = Math.max(glitch, tau < 0.8 ? 1 - tau * 0.8 : 0.3);
      }
      if (!breaches.length) clean = 0;
      if (breaches.length) {
        for (const b of breaches) if (t - b.t0 >= b.dur) emit?.(b.ev, true, b.swarm ? "STORM FRONT BREACH · RESTORED" : "BREACH · RESTORED");
        const before = breaches.length;
        breaches = breaches.filter((b) => t - b.t0 < b.dur);
        if (before && !breaches.length) relightT = t;
      }
      take = { top, clean, glitch, lampRed: top > 2.4 && clean < 2.45 ? 1 : 0 };

      // the camera: high on the shore, bobbing a little
      cam = {
        eye: [0.2 * Math.sin(t * 0.05), 2.3 + 0.05 * Math.sin(t * 0.5), 3],
        target: [0.35 + 0.22 * Math.sin(t * 0.04), narrow ? -0.6 : 0, -18],
      };
      setView(cam, f);

      // point sprites
      pts.n = 0;
      const big = narrow ? 1.3 : 1;
      // traffic: amber packets riding the swell in and out of the tower
      const lanes = narrow ? 3 : 4;
      const per = narrow ? 6 : 9;
      for (let l = 0; l < lanes; l++) {
        const phi = -0.85 + l * (narrow ? 0.45 : 0.38);
        const inbound = l % 2 === 0;
        for (let j = 0; j < per; j++) {
          let u = (j / per + t * 0.075 + hash(l) * 0.5) % 1;
          if (inbound) u = 1 - u;
          const r = 1.3 + u * 32;
          const ph = phi + 0.08 * Math.sin(u * 7 + l);
          const x = arcX(ph, r);
          const z = arcZ(ph, r);
          const h = waves(x, z, t);
          const crest = clamp01(h / 0.22);
          const fade = smooth(0, 0.08, u) * smooth(1, 0.8, u);
          put(x, h + 0.07, z, 0.06 * big, inbound ? AMBER : PALE, (1.3 + 2.8 * crest) * fade);
        }
      }
      // buoys: lights blinking, flaring when the radar ring passes them, flaring hard when they hold a storm
      buoyU.fill(0);
      buoyC.fill(0);
      for (let i = 0; i < NB; i++) {
        const phi = buoyPhi(i);
        const x = arcX(phi, RB);
        const z = arcZ(phi, RB);
        const y = buoyY(i, t);
        let ring = 0;
        for (let k = 0; k < 4; k++) {
          const r = (t - ringT[k]!) * 4.2;
          if (r > 0 && r < 46) ring += Math.exp(-(((r - RB) / 0.6) ** 2));
        }
        const blink = Math.sin(t * 2.2 + i * 0.9) > 0.55 ? 1 : 0;
        const fl = Math.max(0, 1 - (t - buoyFlare[i]!) / 1.2);
        const red = t - buoyRed[i]! < 2.6 ? 1 : 0;
        const k = 0.5 + 0.8 * blink + 1.6 * ring + 3 * fl;
        const col: V3 = red ? (Math.sin(t * 30 + i) > 0 ? RED : HOT) : fl > 0.05 ? ICE : AMBER;
        buoyU.set([x, y, z, k], i * 4);
        buoyC.set([col[0], col[1], col[2], red ? -1 : fl], i * 4);
        put(x, y, z, 0.09 * big, col, 1.6 * k);
      }
      // patrol boats and their wakes
      for (let i = 0; i < NBOAT; i++) {
        const m = boatAt(i, t, P);
        boatAt(i, t - 0.12, Q);
        let hx = P.x - Q.x;
        let hz = P.z - Q.z;
        const hl = Math.hypot(hx, hz) || 1;
        hx /= hl;
        hz /= hl;
        put(P.x, P.y + 0.04, P.z, 0.075 * big, CYAN, 3 * m);
        for (let j = 1; j <= 6; j++) {
          for (let side = -1; side <= 1; side += 2) {
            const x = P.x - hx * j * 0.14 + -hz * side * j * 0.045;
            const z = P.z - hz * j * 0.14 + hx * side * j * 0.045;
            put(x, waves(x, z, t) + 0.04, z, 0.04, ICE, 1.3 * (1 - j / 7) * m);
          }
        }
      }
      // tower drones out on interceptions no boat could take
      for (const s of storms) {
        if (s.ti < 0 || s.boat >= 0 || t < s.ti - 1.2 || t > s.ti + 1.4) continue;
        airAt(s, t, P);
        put(P.x, P.y, P.z, 0.07 * big, CYAN, 3);
        put(P.x, P.y - 0.1, P.z, 0.04, ICE, 1);
      }
      // storms: red spirals of storm cells; squalls trail spray; surges throw a crest of it
      for (const s of storms) {
        const n = s.type === 1 ? 11 : 16;
        const dr = Math.hypot(s.x - LH[0], s.z - LH[2]);
        let ring = 0;
        for (let k = 0; k < 4; k++) {
          const r = (t - ringT[k]!) * 4.2;
          if (r > 0 && r < 46) ring += Math.exp(-(((r - dr) / 0.8) ** 2));
        }
        for (let j = 0; j < n; j++) {
          const rr = s.R * (0.2 + (0.85 * j) / n);
          const a = j * 2.4 + s.spin * t * (1.2 + 1.6 / (rr + 0.3));
          const x = s.x + Math.cos(a) * rr;
          const z = s.z + Math.sin(a) * rr;
          put(x, waves(x, z, t) + 0.12 + 0.3 * (1 - rr / s.R), z, 0.065 * big, j % 3 ? RED : HOT, (2.2 + 1.5 * ring) * s.S);
        }
        if (s.type === 1 && s.tEnd < 0) {
          const L = Math.hypot(s.bx - s.sx, s.bz - s.sz) || 1;
          const dx = (s.bx - s.sx) / L;
          const dz = (s.bz - s.sz) / L;
          for (let j = 1; j <= 8; j++) {
            const x = s.x - dx * j * 0.3 + Math.sin(t * 9 + j) * 0.08;
            const z = s.z - dz * j * 0.3;
            put(x, waves(x, z, t) + 0.1, z, 0.04, RED, 1.4 * (1 - j / 9) * s.S);
          }
        }
        if (s.surge >= 0) {
          const dx = LH[0] - s.bx;
          const dz = LH[2] - s.bz;
          const L = Math.hypot(dx, dz) || 1;
          for (let j = -5; j <= 5; j++) {
            const x = s.x + (-dz / L) * j * 0.22;
            const z = s.z + (dx / L) * j * 0.22;
            put(x, 0.45 + 0.15 * Math.sin(t * 20 + j), z, 0.05 * big, j % 2 ? RED : HOT, 2.6 * (1 - Math.abs(j) / 6));
          }
        }
      }
      // the storm front's cells and the counter-swarm
      if (fr && front === fr) {
        for (let j = 0; j < fr.n; j++) {
          const dd = fr.dead[j]!;
          if (dd >= 0 && t - dd > 0.15) continue;
          cellAt(fr, j, t, Rf, P);
          if (dd >= 0) {
            put(P.x, P.y, P.z, 0.1, WHITE, 3 * (1 - (t - dd) / 0.15));
            continue;
          }
          put(P.x, P.y, P.z, 0.07 * big, RED, (2.6 + 0.8 * Math.sin(t * 15 + j * 1.3)) * smooth(0, 1.5, t - fr.t0));
        }
        for (let i = 0; i < NS; i++) {
          const m = droneAt(fr, i, t, P);
          if (m <= 0) continue;
          put(P.x, P.y, P.z, 0.05 * big, CYAN, 2.5 * m);
          put(P.x, P.y - 0.12, P.z, 0.03, ICE, 0.8 * m);
        }
      }
      // spray
      for (let i = 0; i < SPK; i++) {
        const o = i * 8;
        const age = t - spk[o + 6]!;
        const life = spk[o + 7]!;
        if (age < 0 || age > life) continue;
        spk[o + 4] = spk[o + 4]! - 5 * dt;
        spk[o] = spk[o]! + spk[o + 3]! * dt;
        spk[o + 1] = Math.max(-0.1, spk[o + 1]! + spk[o + 4]! * dt);
        spk[o + 2] = spk[o + 2]! + spk[o + 5]! * dt;
        const u = 1 - age / life;
        put(spk[o]!, spk[o + 1]!, spk[o + 2]!, 0.035, SPK_COL[spkC[i]!]!, 2.4 * u * u);
      }

      // storm slots for the shader: the front's whirlpools first, then the strongest storms
      let ns = 0;
      if (fr && front === fr) {
        const amp = 0.85 * smooth(0, 2.5, t - fr.t0) * (0.4 + (0.6 * Math.max(0, alive)) / fr.n) * (fr.over >= 0 ? 1 - smooth(0, 2, t - fr.over) : 1);
        for (let k = 0; k < 4 && amp > 0.02; k++) {
          const phi = PHI0 + ((PHI1 - PHI0) * (k + 0.5)) / 4 + 0.05 * Math.sin(t * 0.5 + k);
          const sl = slot[ns++]!;
          sl.x = arcX(phi, Rf + 0.7);
          sl.z = arcZ(phi, Rf + 0.7);
          sl.R = 1.3;
          sl.S = amp / 0.85;
          sl.dx = 0;
          sl.dz = 1;
          sl.type = 0;
          sl.spin = k % 2 ? 1 : -1;
          sl.pri = 9;
        }
      }
      const first = ns;
      for (const s of storms) {
        if (ns >= 16) break;
        const sl = slot[ns++]!;
        sl.x = s.x;
        sl.z = s.z;
        sl.R = s.type === 2 ? 1.2 : s.R;
        sl.S = s.type === 2 ? 1 : s.S;
        if (s.type === 2) {
          const L = Math.hypot(LH[0] - s.bx, LH[2] - s.bz) || 1;
          sl.dx = (LH[0] - s.bx) / L;
          sl.dz = (LH[2] - s.bz) / L;
        } else {
          const L = Math.hypot(s.bx - s.sx, s.bz - s.sz) || 1;
          sl.dx = (s.bx - s.sx) / L;
          sl.dz = (s.bz - s.sz) / L;
        }
        sl.type = s.type;
        sl.spin = s.spin;
        // nearer the tower and the camera first
        sl.pri = s.S * (s.type === 2 ? 3 : 1) / (1 + Math.hypot(s.x - LH[0], s.z - LH[2]) * 0.05);
      }
      // keep the best of the storms (insertion sort, at most 16)
      for (let i = first + 1; i < ns; i++) {
        for (let j = i; j > first && slot[j]!.pri > slot[j - 1]!.pri; j--) {
          const tmp = slot[j]!;
          slot[j] = slot[j - 1]!;
          slot[j - 1] = tmp;
        }
      }
      stU.fill(0);
      stB.fill(0);
      let hmax = 0.55;
      for (let i = 0; i < Math.min(8, ns); i++) {
        const sl = slot[i]!;
        stU.set([sl.x, sl.z, sl.R, sl.S], i * 4);
        stB.set([sl.dx, sl.dz, sl.type, sl.spin], i * 4);
        if (sl.type === 2) hmax = Math.max(hmax, 0.55 + 0.7 * sl.S);
      }

      // beams: boats zapping a pinned storm, drones picking off the front's cells
      bmA.fill(0);
      bmB.fill(0);
      let bi = 0;
      for (const s of storms) {
        if (bi >= 6 || s.ti < 0 || t < s.ti || t > s.ti + 1.4) continue;
        if ((t - s.ti) % 0.22 > 0.12) continue;
        if (s.boat >= 0) boatAt(s.boat, t, Q);
        else airAt(s, t, Q);
        bmA.set([Q.x, Q.y + 0.08, Q.z, 1.2], bi * 4);
        bmB.set([s.x, 0.15, s.z, 0], bi * 4);
        bi++;
      }
      beams = beams.filter((b) => t - b.t0 < b.dur);
      for (let i = beams.length - 1; i >= 0 && bi < 6; i--) {
        const b = beams[i]!;
        bmA.set([b.a[0], b.a[1], b.a[2], 1 - (t - b.t0) / b.dur], bi * 4);
        bmB.set([b.b[0], b.b[1], b.b[2], 0], bi * 4);
        bi++;
      }

      // rings: radii and their colour; a taken-over light pulses red and unsteady
      const rr = [-1, -1, -1, -1];
      const rk = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const r = (t - ringT[k]!) * 4.2;
        if (r > 0 && r < 46) {
          rr[k] = r + (ringRed[k] ? Math.sin(t * 40 + k) * 0.25 : 0);
          rk[k] = ringRed[k]!;
        }
      }
      let lastRing = -99;
      for (let k = 0; k < 4; k++) lastRing = Math.max(lastRing, ringT[k]!);
      const flicker = take.lampRed ? (Math.sin(t * 37) > 0 ? 1 : 0.35) : 1;
      const lamp = (0.9 + 1.6 * Math.exp(-(t - lastRing) * 4) + 3 * Math.max(0, 1 - (t - relightT) / 0.8)) * flicker;

      // the front's sky: clouds while it is up, lightning now and then
      const frontOn = fr && front === fr ? smooth(0, 2.5, t - fr.t0) * (fr.over >= 0 ? 1 - smooth(0, 2.5, t - fr.over) : 1) : 0;
      const bolt = frontOn > 0 && hash(Math.floor(t * 3)) > 0.82 ? Math.exp(-((t * 3) % 1) * 4) : 0;
      const famp = fr && front === fr ? 0.85 * smooth(0, 2.5, t - fr.t0) * (0.4 + (0.6 * Math.max(0, alive)) / fr.n) * (fr.over >= 0 ? 1 - smooth(0, 2, t - fr.over) : 1) : 0;
      if (famp > 0) hmax = Math.max(hmax, 0.55 + famp * 1.35);

      setCam(set, cam);
      set.v3("uMoon", MOON[0], MOON[1], MOON[2]);
      set.v4v("uSt", stU);
      set.v4v("uStB", stB);
      set.v4("uFront", Rf, famp, bolt, frontOn);
      set.v4v("uBuoy", buoyU);
      set.v4v("uBuoyC", buoyC);
      set.v4("uRing", rr[0]!, rr[1]!, rr[2]!, rr[3]!);
      set.v4("uRingK", rk[0]!, rk[1]!, rk[2]!, rk[3]!);
      set.v4("uTake", take.top, take.clean, take.glitch, 0);
      set.v4("uLamp", lamp, level, hmax, take.lampRed);
      set.v4v("uBmA", bmA);
      set.v4v("uBmB", bmB);
      flashes.pack(t, set);
      set.points(pts.data, pts.n, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      const t = f.t;
      const out: { text: string; x: number; y: number; tone?: string; anchor?: "start" | "middle" | "end" }[] = [];
      const lamp = projectPoint([LH[0], LAMP_Y, LH[2]], cam, f);
      if (lamp) {
        if (breaches.length) {
          const cleaning = take.clean > 0.05;
          out.push({ text: cleaning ? "restoring" : "[ takeover ]", x: lamp.x - 22, y: lamp.y - 6, tone: cleaning ? "accent" : "hot", anchor: "end" });
        } else out.push({ text: "radar tower", x: lamp.x - 22, y: lamp.y - 6, tone: "dim", anchor: "end" });
      }
      const mid = Math.floor(NB * 0.62);
      const bp = projectPoint([arcX(buoyPhi(mid), RB), 0.3, arcZ(buoyPhi(mid), RB)], cam, f);
      if (lastHeld && t - lastHeld.t < 1.5) {
        const h = projectPoint([arcX(buoyPhi(lastHeld.b), RB), 0.6, arcZ(buoyPhi(lastHeld.b), RB)], cam, f);
        if (h) out.push({ text: "held", x: h.x, y: h.y - 16, tone: "accent", anchor: "middle" });
      } else if (bp) out.push({ text: "[ buoy line ]", x: bp.x, y: bp.y + 10, tone: "dim", anchor: "middle" });
      const fr = front;
      if (fr && fr.over < 0) {
        const Rf = frontR(fr, t);
        const s = projectPoint([arcX(-0.35, Rf + 1), 1.9, arcZ(-0.35, Rf + 1)], cam, f);
        let alive = 0;
        for (let j = 0; j < fr.n; j++) if (fr.dead[j]! < 0) alive++;
        if (s) out.push({ text: `[ storm front · ${alive} ]`, x: s.x, y: s.y - 6, tone: "hot", anchor: "middle" });
      }
      return out;
    },
  };
}
