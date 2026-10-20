import type { ThreatIntel } from "@/lib/threatIntel";
import { POINT_STRIDE, projectPoint, type Cam, type FrameInfo, type GlyphController, type Setter, type V3 } from "../engine";
import type { FeedEvent } from "../feed";
import { WaveDirector } from "./director";
import { AMBER, CYAN, RED, setCam, WHITE, type Emit } from "./kit";

/** a stratum's height and the code line pitch on its face: five lines of code per stratum */
const H = 1.5;
const LP = 0.3;
/** firewall gates: spacing along the canyon, the first one, the beam's height */
const GS = 16;
const G0 = 8;
const GH = 4.5;
/** each gate guards a data-centre outcrop this far on the camera's side of it */
const OD = 6.5;
/** flight speed: the cruise, and the slow hold while the escorts wall off the canyon */
const CRUISE = 2;
const HOLD = 0.6;
/** where the escorts' wall stands, ahead of the camera */
const DW = 10.5;
const FOG_K = 0.044;
/** seconds a breached line of code takes to be rewritten */
const LINE_T = 0.12;
/** how long a packet takes from the gate it slipped through to the system it hits */
const DIVE = 0.9;
const NG = 3;
const NSITE = 3;
const NBR = 3;
const NWORM = 4;
const NPK = 6;
const NBEAM = 6;
const NFX = 8;

const HOT: V3 = [1, 0.36, 0.24];
const ICE: V3 = [0.62, 0.93, 1];
const FOE: V3 = [1, 0.36, 0.2];

const FRAG = `
uniform vec3 uEye;
uniform vec3 uTarget;
uniform float uRoll;
uniform vec3 uFar;
/** threat level, war (0..1) */
uniform vec4 uMood;
uniform vec4 uGate[${NG}];
uniform vec4 uGateH[${NG}];
uniform vec4 uSite[${NSITE}];
uniform vec4 uBr[${NBR}];
uniform vec4 uBr2[${NBR}];
uniform vec4 uWorm[${NWORM}];
uniform vec4 uWorm2[${NWORM}];
uniform vec4 uPk[${NPK}];
uniform vec4 uBmA[${NBEAM}];
uniform vec4 uBmB[${NBEAM}];
uniform vec4 uFx[${NFX}];
uniform vec4 uFxC[${NFX}];

const float H = ${H.toFixed(2)};
const float LP = ${LP.toFixed(2)};
const float GS = ${GS.toFixed(2)};
const float G0 = ${G0.toFixed(2)};
const float OD = ${OD.toFixed(2)};
const float GH = ${GH.toFixed(2)};
const float FOGK = ${FOG_K};
/** a character's width and a page's width on the cliff faces */
const float CH = .12;
const float PW = 9.6;
const vec3 CY = vec3(.35, .85, 1.);
const vec3 AM = vec3(1., .66, .3);
const vec3 RD = vec3(1., .22, .14);
const vec3 FOG = vec3(.004, .008, .019);
/** a cool sky light from high behind the left rim, so the right wall's terraces and the far bends catch it and the left wall stays in shadow */
const vec3 LDIR = vec3(.5171, .7756, -.362);
const vec3 SUNC = vec3(.5, .66, 1.);
const vec3 SKYC = vec3(.16, .26, .5);

/* ---- the canyon (the same curves as in the controller) ---- */
float cxAt(float z){ return 3.75*sin(z*.0344) + 1.6*sin(z*.0856 + 1.3); }
/** where the face of stratum k stands, right and left of the centre line: each stratum set back from the one below */
float wRb(float k, float z){ return 2.7 + .35*sin(z*.049 + 1.) + .55*k + .17*sin(z*.032 + k*2.7) + .1*sin(z*.074 + k*5.1); }
float wLb(float k, float z){ return 2.05 + .35*sin(z*.042 + .4) + .2*k + .06*sin(z*.038 + k*3.3) + .035*sin(z*.088 + k*1.9); }
float rimR(float z){ return 6.4 + 2.*sin(z*.023 + 2.) + .7*sin(z*.066); }
float rimL(float z){ return 10.8 + 1.4*sin(z*.026 + .7); }
float rivC(float z){ return .3 + .2*sin(z*.056); }
float rivW(float z){ return 1.55 + .15*sin(z*.072 + 2.); }
float n1(float x, float k){ float i = floor(x), f = fract(x); f = f*f*(3. - 2.*f); return mix(hash12(vec2(i, k)), hash12(vec2(i + 1., k)), f); }
/** erosion along each stratum's face: gullies and buttresses */
float gully(float z, float k, float sd){ return .11*(n1(z*1.28, k*13.1 + sd) - .5) + .14*(n1(z*.34, k*5.3 + sd + 40.) - .5); }
float wallW(float side, float k, float z){ return side > 0. ? wRb(k, z) + gully(z, k, 0.) : wLb(k, z) + gully(z, k, 7.); }
float siteLayer(float ko, float zo){ float kb = mod(ko, 2.) < .5 ? 1. : 3.; return max(1., min(kb, floor(rimR(zo)/H) - 2.)); }
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.); }
float cover1(float x, float a, float b, float w){ w = max(w, 1e-4); return clamp((min(x + w*.5, b) - max(x - w*.5, a))/w, 0., 1.); }
float stripeI(float x, float a, float b){ return floor(x)*(b - a) + clamp(fract(x), a, b) - a; }
/** a periodic stripe [a, b] of each unit, box-filtered over the footprint w (so far walls average instead of aliasing) */
float stripe(float x, float a, float b, float w){ w = max(w, 1e-3); return (stripeI(x + w*.5, a, b) - stripeI(x - w*.5, a, b))/w; }

/** distance to one wall: a staircase of strata, each a slab reaching out from its face (q is the distance from the centre line toward it) */
float stairs(float side, float q, float y, float z, float rim){
  float kt = ceil(rim/H) - 1.;
  float j = clamp(floor(y/H), 0., kt);
  float wj = wallW(side, j, z);
  float topj = min((j + 1.)*H, rim);
  float d = y < topj ? wj - q : length(vec2(max(wj - q, 0.), y - topj));
  if(j > .5) d = min(d, length(vec2(max(wallW(side, j - 1., z) - q, 0.), y - j*H)));
  if(j > 1.5) d = min(d, length(vec2(max(wallW(side, j - 2., z) - q, 0.), y - (j - 1.)*H)));
  return d;
}

/** mat: 0 wall, 1 floor, 2 gate pylon, 3 gate beam, 4 data-centre outcrop */
float map(vec3 p, out float mat){
  float lat = cxAt(p.z) - p.x;
  // only the wall on this side of the centre line can be nearer than the floor of the canyon is wide
  float d = lat > 0. ? min(stairs(1., lat, p.y, p.z, rimR(p.z)), lat + 1.45) : min(stairs(-1., -lat, p.y, p.z, rimL(p.z)), 1.9 - lat);
  mat = 0.;
  float rl = abs(lat - rivC(p.z));
  float fl = p.y - (.09*smoothstep(rivW(p.z) - .05, rivW(p.z) + .3, rl) - .04);
  if(fl < d){ d = fl; mat = 1.; }
  float kg = floor((p.z - G0)/GS + .5);
  float zl = p.z - (G0 + kg*GS);
  if(abs(zl) < 1.8){
    float zg = G0 + kg*GS;
    float wr = wRb(0., zg), wl = wLb(0., zg);
    float hy = (GH + .75)*.5;
    float dp = min(sdBox(vec3(lat - wr, p.y - hy, zl), vec3(.3, hy, .2)), sdBox(vec3(-lat - wl, p.y - hy, zl), vec3(.3, hy, .2)));
    if(dp < d){ d = dp; mat = 2.; }
    float db = sdBox(vec3(lat - (wr - wl)*.5, p.y - GH - .1, zl), vec3((wr + wl)*.5, .065, .06));
    if(db < d){ d = db; mat = 3.; }
  }
  if(lat > 1.3){
    float ko = floor((p.z - G0 + OD)/GS + .5);
    float zo = G0 - OD + ko*GS;
    float zlo = p.z - zo;
    if(abs(zlo) < 2.6){
      float kb = siteLayer(ko, zo);
      float wf = wRb(kb, zo);
      float y0 = kb*H;
      float dO = min(sdBox(vec3(lat - wf - .37, p.y - y0 - 1.2, zlo), vec3(1.25, 1.2, 1.75)), sdBox(vec3(lat - wf - .75, p.y - y0 - 2.775, zlo), vec3(1.25, .375, 1.1)));
      if(dO < d){ d = dO; mat = 4.; }
    }
  }
  return d;
}

vec3 nrm(vec3 p){
  vec2 e = vec2(.004, -.004);
  float m;
  return normalize(e.xyy*map(p + e.xyy, m) + e.yyx*map(p + e.yyx, m) + e.yxy*map(p + e.yxy, m) + e.xxx*map(p + e.xxx, m));
}
float shadow(vec3 p){
  float res = 1., t = .06, m;
  for(int i = 0; i < 22; i++){
    float h = map(p + LDIR*t, m);
    res = min(res, 9.*h/t);
    t += clamp(h, .1, .9);
    if(res < .02 || t > 13.) break;
  }
  return clamp(res, 0., 1.);
}
float occ(vec3 p, vec3 n){ float m; float a = map(p + n*.12, m), b = map(p + n*.36, m); return clamp(.3 + (a/.12)*.3 + (b/.36)*.4, 0., 1.); }

vec4 gateOf(float k, out vec4 hit){
  for(int i = 0; i < ${NG}; i++) if(abs(uGate[i].x - k) < .5){ hit = uGateH[i]; return uGate[i]; }
  hit = vec4(0.);
  return vec4(k, 0., 0., -1.);
}
vec4 siteOf(float k){
  for(int i = 0; i < ${NSITE}; i++) if(abs(uSite[i].x - k) < .5) return uSite[i];
  return vec4(k, 0., 0., 0.);
}

/**
 * Source code on a cliff face, like an editor's minimap: lines with indented
 * blocks, words separated by spaces, keywords in cyan and strings in amber.
 * Some strata are data instead (hex dumps). Far away it zooms out the way a
 * minimap does: lines merge into one bar per block of three, then into a
 * band per stratum, so distant walls keep their structure instead of
 * aliasing into a haze. fs is the footprint along the lines, cell the height
 * of one glyph cell on the wall; returns the ink's colour and coverage.
 */
vec4 codeAt(float s, float y, float k, float side, float fs, float cell){
  float sd = side*31.7 + k*3.1;
  bool dump = hash12(vec2(k*7.3 + side, 2.9)) > .82;
  float gl = floor(y/LP);
  float px = s + k*2.9 + side*1.3;
  float pg = floor(px/PW);
  float xs = px - pg*PW;
  float lpc = LP/max(cell, 1e-4);
  float lodB = smoothstep(2.4, 1.5, lpc);
  float lodF = smoothstep(1.1, .6, lpc);
  float hl = hash12(vec2(gl*1.37 + pg*7.1, sd));
  float blk = floor(gl/3.);
  float ind = floor(hash12(vec2(blk + pg*3.3, sd + 2.))*3.);
  float x0 = .4 + (ind + step(.5, mod(gl, 3.)))*.48;
  float len = (.22 + .68*pow(hash12(vec2(gl + pg*11., sd + 5.)), .7))*(PW - 1. - x0)*step(.13, hl);
  float sw = 5.;
  if(dump){ x0 = .4; len = (PW - 1.2)*step(.3, hl); sw = 3.; }
  float c = (xs - x0)/CH;
  float slot = floor(c/sw);
  float tl = dump ? 2. : 2. + floor(hash12(vec2(slot + gl*17.3, pg + sd))*5.);
  float tok = mix(cover1(c - slot*sw, 0., tl, fs/CH), dump ? .66 : .74, smoothstep(.6, 2.5, fs/(CH*sw)));
  float chv = mix(.72 + .5*hash12(vec2(floor(c), gl + sd)), 1., smoothstep(.5, 1.5, fs/CH));
  float line = stripe(y/LP, .24, .76, cell*.6/LP)*cover1(xs, x0, x0 + len, fs)*tok*chv;
  // a block of three lines as one bar
  float bx0 = dump ? .4 : .4 + ind*.48;
  float blen = dump ? PW - 1.2 : (.35 + .5*hash12(vec2(blk + pg*5.7, sd + 8.)))*(PW - 1. - bx0);
  float bar = smoothstep(.25, .6, stripe(y/(3.*LP), .12, .88, cell*.6/(3.*LP))*cover1(xs, bx0, bx0 + blen, fs))*.5;
  // near, ink is either there or not (a dim half-covered stroke would only add a haze of dots); far, the bars and bands keep their tone
  float cov = mix(smoothstep(.3, .7, line), bar, lodB);
  // beyond that the code is gone (a stratum-wide tone would only be a haze of dots): the strata's lips carry the far walls
  cov *= 1. - lodF;
  float ty = hash12(vec2(slot*3.1 + gl, pg*1.7 + sd + 9.));
  vec3 ink = vec3(.5, .62, .88);
  if(dump) ink = mix(vec3(.55, .62, .8), AM, step(.7, ty));
  else if(slot < .5 && hl > .5) ink = CY*1.25;
  else if(ty > .86) ink = AM*1.1;
  else if(ty > .78) ink = vec3(.85, .92, 1.);
  ink = mix(ink, dump ? vec3(.72, .64, .58) : vec3(.55, .66, .92), lodB*.8);
  // each stratum its own brightness, so the walls read as layered rock
  return vec4(ink*(.6 + .8*hash12(vec2(k*3.7 + side, 8.1))), cov*(1. - .5*lodB));
}

/** red light thrown on the rock by attacks in flight */
vec3 atkLight(vec3 p, vec3 n){
  vec3 c = vec3(0.);
  for(int i = 0; i < ${NPK}; i++){
    vec4 L = uPk[i];
    if(L.w <= 0.) continue;
    vec3 v = L.xyz - p;
    float d2 = dot(v, v);
    c += RD*L.w*exp(-d2*.8)*(.25 + .75*max(dot(n, v)*inversesqrt(d2 + 1e-4), 0.));
  }
  return c;
}

vec3 shadeWall(vec3 p, vec3 n, vec3 rd, float t, float lat, float sh, float ao){
  float side = lat > 0. ? 1. : -1.;
  // one glyph cell's height on the wall here, and a filter footprint along the lines
  float fv = t*4.*uTan.y/uRes.y;
  float fs = .6*t*4.*uTan.x/uRes.x/max(abs(dot(n, rd)), .07);
  float dif = max(dot(n, LDIR), 0.)*sh;
  // the river's warm light, from below
  vec3 tr = vec3(cxAt(p.z) - rivC(p.z), -.2, p.z) - p;
  float riv = exp(-p.y*.55)*exp(-max(length(tr.xy) - 1.8, 0.)*.3)*max(dot(n, normalize(tr)), 0.);
  // a cool fill from the right keeps the shadowed (left) wall's faces from going flat
  vec3 lit = SUNC*dif*1.6 + SKYC*(.5 + .5*n.y)*.25*ao + SKYC*max(dot(n, vec3(-.77, .45, -.45)), 0.)*.5*ao + AM*riv*1.6;
  if(n.y > .6){
    // a ledge: stone dust lit by the sky
    float k = floor((p.y - .03)/H);
    float grit = .7 + .6*hash12(floor(vec2(p.z*9., lat*9.)) + k);
    return vec3(.16, .21, .32)*(lit + .12)*grit*ao;
  }
  float k = floor(p.y/H);
  vec4 c = codeAt(p.z, p.y, k, side, fs, fv);
  // the left wall is the dark near wall under the headline: only the river's glow brings out its lowest code
  if(side < 0.) c.a *= clamp(riv*2.5 - .6, 0., 1.);
  // the rock takes the key light (so lit faces read as masses; shadowed rock stays black, as a dim fill would only be a haze of dots); the code glows on top
  // near code glows on its own; further off only lit code shows, so shadowed walls go dark instead of dotted
  float glow = .32*smoothstep(1.4, 2.6, LP/fv);
  vec3 col = (vec3(.1, .14, .24)*SUNC*dif*1.6 + vec3(.1, .07, .04)*riv*1.2)*ao + c.rgb*c.a*(lit*1.3 + glow);
  // the top of each stratum: a lip that catches the light, drawn at least a pixel thick so far strata stay lines
  float v = p.y - k*H;
  col += (SUNC*dif*1.5 + AM*riv*.8 + (SKYC*.8 + .12)*(side > 0. ? 1. : .4))*cover1(v, H - max(.08, fv*.6), H + .01, fv*.6)*2.6;
  // the rim against the sky
  float rim = side > 0. ? rimR(p.z) : rimL(p.z);
  col += (SUNC*dif + SKYC*1.2 + .15)*cover1(p.y, rim - max(.1, fv*.5), rim + .01, fv*.6)*1.4;
  // the firewall's seam: each gate's plane runs up the walls to the rim
  float kg = floor((p.z - G0)/GS + .5);
  vec4 gh;
  vec4 g = gateOf(kg, gh);
  float seam = cover1(p.z - G0 - kg*GS, -.045, .045, fs);
  col += (CY*(.22 + 2.4*g.y) + RD*g.z*2.)*seam;
  if(side > 0.){
    col += vec3(.7, .95, 1.)*gh.z*exp(-pow((p.y - gh.w)/.75, 2.))*(seam*3. + cover1(p.z - G0 - kg*GS, -.5, .5, fs)*.6);
    // data conduits from the river up to the outcrop above
    float ko = floor((p.z - G0 + OD)/GS + .5);
    float zo = G0 - OD + ko*GS;
    float kb = siteLayer(ko, zo);
    vec4 S = siteOf(ko);
    float cz = abs(p.z - zo);
    float cond = cover1(cz, .34, .42, fs)*step(p.y, kb*H);
    float pulse = pow(fract(p.y*.5 - uTime*1.1 + ko*.37 + step(p.z, zo)*.5), 8.);
    col += mix(AM, RD, S.y)*cond*(.3 + 2.2*pulse);
    float gl = floor(p.y/LP);
    float st = stripe(p.y/LP, .15, .85, fv*.6/LP);
    // injected code worms crawling down the strata
    for(int i = 0; i < ${NWORM}; i++){
      vec4 W = uWorm[i];
      if(W.w < 0.) continue;
      vec4 W2 = uWorm2[i];
      float lam = W.x - p.z;
      float age = W.w - lam;
      if(lam < 0. || age < -.06 || age > W2.y) continue;
      if(abs(gl - (W.y - floor(lam/W.z))) > .5) continue;
      float cc = p.z/CH;
      float tk = mix(cover1(fract(cc/4.)*4., 0., 3., fs/CH), .75, smoothstep(.5, 2., fs/(CH*4.)));
      float body = 1. - smoothstep(W2.x*.6, W2.x, age);
      float trail = (1. - body)*exp(-(age - W2.x)*.45)*(.6 + .4*step(.5, hash12(vec2(floor(cc), floor(uTime*8.)))));
      float head = exp(-age*age/.02);
      vec3 wc = RD*(body*2.6 + trail*.7) + vec3(1., .78, .62)*head*3.;
      wc = mix(wc, vec3(.7, .95, 1.)*(2.8*body + trail), W2.w);
      col = mix(col, wc*max(tk, .35), clamp(st*(body + trail*1.4), 0., 1.)*W2.z);
    }
    // breaches: corrupted code spreading along the strata, then rewritten line by line
    for(int i = 0; i < ${NBR}; i++){
      vec4 B = uBr[i];
      vec4 B2 = uBr2[i];
      if(B2.x < .5) continue;
      float ry = .3 + 1.5*B.z;
      float dy = (gl + .5)*LP - B.y;
      if(abs(dy) > ry) continue;
      float hr = hash12(vec2(gl, float(i)*7. + floor(B.x)));
      float ex = (1.6 + 2.8*hr)*B.z*sqrt(1. - dy*dy/(ry*ry)) + .4*B.z;
      float fr = floor(uTime*13.);
      float slip = step(.8, hash12(vec2(gl, fr)))*(hash12(vec2(gl*3., fr)) - .5)*.5*(1. - step(B.w + .5, gl));
      float ds = p.z - B.x + slip;
      if(abs(ds) > ex + .1) continue;
      float inside = smoothstep(ex + .1, ex - .2, abs(ds));
      if(gl > B.w + .5){
        // rewritten: clean code with a fading cyan wash
        col += CY*st*.55*exp(-(gl - B.w)*.4)*inside;
        continue;
      }
      float cur = B.x - ex + 2.*ex*B2.y;
      bool now = abs(gl - B.w) < .5;
      if(now && p.z < cur){
        col += CY*st*1.4*inside;
        continue;
      }
      float cg = floor(p.z/CH + slip*11.);
      float g1 = step(.32, hash12(vec2(cg, gl + floor(uTime*9.)*.37)));
      float fl = .6 + .4*step(.5, hash12(vec2(gl, floor(uTime*17.))));
      vec3 rc = RD*(.35 + 3.4*g1*st)*fl + vec3(1., .55, .45)*step(.95, hash12(vec2(cg*1.7, gl + floor(uTime*6.))))*st*3.;
      col = mix(col, rc, inside);
      if(now) col += vec3(.75, 1., 1.)*exp(-pow((p.z - cur)/.07, 2.))*3.5*st + CY*st*.35*inside;
    }
  }
  return col;
}

vec3 shadeFloor(vec3 p, vec3 n, vec3 rd, float t, float lat, float sh){
  float rw = rivW(p.z);
  float rl = lat - rivC(p.z);
  float ar = abs(rl);
  float fa = 1.5*t*2.*uTan.y/uRes.y/max(-rd.y, .015);
  float fx = 1.5*t*2.*uTan.x/uRes.x;
  vec3 col;
  if(ar < rw){
    // the river of data: lanes of amber packets streaming down the canyon
    float u = (rl + rw)/(2.*rw)*7.;
    float li = floor(u);
    float hl = hash12(vec2(li, 4.1));
    float per = 2.2 + 3.*hl;
    float q = (p.z - uTime*(2.6 + 2.4*hl))/per + hl*7.;
    float dl = .25 + .4*hash12(vec2(li, floor(q)));
    float fq = fract(q);
    float dash = cover1(fq, 0., dl, fa/per);
    float head = mix(pow(clamp(fq/dl, 0., 1.), 2.), .4, smoothstep(.3, 1., fa/per));
    float lane = cover1(fract(u), .36, .64, fx*7./(2.*rw));
    float flow = dash*lane;
    float fibre = cover1(fract(u), .46, .54, fx*7./(2.*rw));
    col = AM*fibre*.4 + AM*flow*(.5 + 2.4*head) + vec3(1., .9, .7)*flow*head*.8;
  } else {
    col = vec3(.008, .012, .022)*(1. + 2.*max(dot(n, LDIR), 0.)*sh) + AM*.06*exp(-(ar - rw)*2.2);
  }
  col += AM*cover1(abs(ar - rw), -.035, .035, fx)*1.3;
  float kg = floor((p.z - G0)/GS + .5);
  vec4 gh;
  vec4 g = gateOf(kg, gh);
  col += (CY*(.35 + 2.*g.y) + RD*g.z*1.5)*cover1(p.z - G0 - kg*GS, -.05, .05, fa);
  return col;
}

vec3 shadeGate(vec3 p, vec3 n, float t, float lat, float mat, float sh){
  float kg = floor((p.z - G0)/GS + .5);
  float zg = G0 + kg*GS;
  float zl = p.z - zg;
  vec4 gh;
  vec4 g = gateOf(kg, gh);
  float fp = 1.5*t*2.*uTan.y/uRes.y;
  float dif = max(dot(n, LDIR), 0.)*sh;
  vec3 col = vec3(.01, .02, .042)*(.3 + 1.5*dif);
  if(mat < 2.5){
    float lp = lat > 0. ? lat - wRb(0., zg) : -lat - wLb(0., zg);
    float ez = step(.5, abs(n.z));
    // the pylon's corners run up as lines of light
    float e = ez > .5 ? min(abs(lp + .3), abs(lp - .3)) : abs(abs(zl) - .2);
    col += CY*cover1(e, -.03, .03, fp)*1.1;
    // the canyon-side face holds the curtain: an emitter strip
    col += CY*(1. - ez)*step(lp, -.26)*(.3 + .25*sin(p.y*7. - uTime*4.));
    // amber status lights, blinking faster as the threat rises
    float li = floor(p.y/.75);
    float blink = step(.45, fract(uTime*(.5 + 1.2*uMood.x) + li*.23 + kg*.41));
    col += AM*ez*cover1(fract(p.y/.75), .42, .58, fp/.75)*cover1(lp, -.08, .08, fp)*(.4 + 2.*blink);
    col += CY*cover1(p.y, GH + .66, GH + .75, fp)*1.3;
  } else {
    col += CY*.1 + CY*cover1(abs(p.y - GH - .1), .04, .07, fp)*.7;
    col += AM*step(.88, fract(lat*.9 - uTime*.7))*.9;
  }
  // gates rushing past stay quiet
  return col*(.35 + .65*smoothstep(4., 12., t)) + vec3(.75, .95, 1.)*g.y*1.8 + RD*g.z*1.6;
}

vec3 shadeSite(vec3 p, vec3 n, float t, float lat, float sh){
  float ko = floor((p.z - G0 + OD)/GS + .5);
  float zo = G0 - OD + ko*GS;
  float kb = siteLayer(ko, zo);
  float wf = wRb(kb, zo);
  float y0 = kb*H;
  vec4 S = siteOf(ko);
  float fp = 1.5*t*2.*uTan.y/uRes.y;
  float dif = max(dot(n, LDIR), 0.)*sh;
  bool upper = p.y > y0 + 2.42;
  vec3 hb = upper ? vec3(1.25, .375, 1.1) : vec3(1.25, 1.2, 1.75);
  vec3 lc = vec3(lat - wf - (upper ? .75 : .37), p.y - y0 - (upper ? 2.775 : 1.2), p.z - zo);
  float fz = step(.6, abs(n.z)), fy = step(.6, n.y);
  vec2 uv = fy > .5 ? lc.xz : fz > .5 ? lc.xy : lc.zy;
  vec2 hs = fy > .5 ? hb.xz : fz > .5 ? hb.xy : hb.zy;
  float e = min(hs.x - abs(uv.x), hs.y - abs(uv.y));
  vec3 col = vec3(.012, .024, .05)*(.35 + 1.8*dif);
  // server bays: rows of lit racks
  vec2 gg = (uv + hs)/vec2(.2, .24);
  vec2 id = floor(gg), f = fract(gg);
  float win = cover1(f.x, .18, .82, fp/.2)*cover1(f.y, .3, .72, fp/.24)*step(.12, e);
  float h = hash12(id + ko*7.1 + fz*31.);
  vec3 wc = h > .9 ? AM : h > .85 ? vec3(.9, .96, 1.) : CY;
  float blink = h > .95 ? step(.5, fract(uTime*1.4 + h*9.)) : 1.;
  vec3 good = wc*win*step(.3, h)*blink*(1. - fy*.7)*2.2;
  vec3 bad = RD*(win*(.6 + 1.6*step(.4, hash12(id + floor(uTime*9.))))*(1. - fy*.6) + .08)*1.4;
  col += mix(good, bad, S.y);
  col += mix(CY, RD, S.y)*cover1(e, -.03, .03, fp)*1.2;
  return col + CY*S.w*.9;
}

/** distance to the nearest edge of a hexagonal lattice (cell units) */
float hexEdge(vec2 p){
  const vec2 s = vec2(1., 1.7320508);
  vec4 hc = floor(vec4(p, p - vec2(.5, 1.))/s.xyxy) + .5;
  vec4 h = vec4(p - hc.xy*s, p - (hc.zw + .5)*s);
  vec2 q = abs(dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw);
  return .5 - max(dot(q, s*.5), q.x);
}

vec3 sky(vec3 rd){
  vec3 c = vec3(.002, .004, .01) + vec3(.004, .008, .018)*exp(-max(rd.y, 0.)*6.);
  // a thin line of light low over the canyon's far end, so the far rims stand against it
  vec2 fh = normalize(uFar.xz);
  vec2 rh = normalize(rd.xz + 1e-5);
  // (in the war it burns red down there)
  c += mix(vec3(.1, .2, .4), vec3(.45, .08, .05), uMood.y)*pow(max(dot(rh, fh), 0.), 30.)*exp(-pow(rd.y/.012, 2.));
  // stars fixed in the sky, not on the screen
  vec3 g = floor(rd*130.);
  float h = hash13(g);
  if(h > .9955) c += mix(vec3(.75, .82, 1.), vec3(1., .86, .7), fract(h*31.))*(.55 + .45*sin(uTime*(.7 + h*2.) + h*50.))*(.25 + 1.2*pow(fract(h*97.), 4.))*smoothstep(.04, .2, rd.y);
  return c;
}

void main(){
  vec2 nd = ndc();
  vec2 q = nd;
  q.x -= uShift;
  // the camera banks with the canyon's bends
  q = rot2(uRoll)*(q*uTan);
  vec3 ro = uEye;
  vec3 rd = normalize(lookAt(ro, uTarget)*vec3(q, 1.));
  float t = .05;
  float mat = -1.;
  for(int i = 0; i < 128; i++){
    vec3 p = ro + rd*t;
    float m;
    float d = map(p, m);
    if(d < .0015 + .0016*t){ mat = m; break; }
    t += d*.8;
    if(t > 90. || (p.y > 14. && rd.y > 0.)) break;
  }
  vec3 col;
  float tHit = 1e3;
  if(mat < 0.){
    col = mix(FOG, sky(rd), smoothstep(-.02, .08, rd.y));
  } else {
    tHit = t;
    vec3 p = ro + rd*t;
    vec3 n = nrm(p);
    float lat = cxAt(p.z) - p.x;
    float sh = shadow(p + n*.03);
    if(mat < .5) col = shadeWall(p, n, rd, t, lat, sh, occ(p, n));
    else if(mat < 1.5) col = shadeFloor(p, n, rd, t, lat, sh);
    else if(mat < 3.5) col = shadeGate(p, n, t, lat, mat, sh);
    else col = shadeSite(p, n, t, lat, sh);
    col += atkLight(p, n);
    col = mix(FOG, col, exp(-t*FOGK));
  }
  // the firewall curtains: a faint lattice held between each gate's pylons, flaring where it stops something
  for(int i = 0; i < ${NG}; i++){
    vec4 G = uGate[i];
    float zg = G0 + G.x*GS;
    if(rd.z <= .05) continue;
    float tc = (zg - ro.z)/rd.z;
    if(tc < 1. || tc > tHit) continue;
    vec3 pc = ro + rd*tc;
    float la = cxAt(zg) - pc.x;
    float wr = wRb(0., zg) - .3, wl = wLb(0., zg) - .3;
    if(la > wr || la < -wl || pc.y > GH || pc.y < 0.) continue;
    float fp = 1.5*tc*2.*uTan.y/uRes.y;
    float hx = (1. - smoothstep(0., .03 + fp*1.2, hexEdge(vec2(la, pc.y)/.8)))*(1. - smoothstep(.08, .2, fp));
    float hitR = length(vec2(la - uGateH[i].x, pc.y - uGateH[i].y));
    float ring = G.w >= 0. ? exp(-pow((hitR - G.w*4.)/.16, 2.))*exp(-G.w*2.) : 0.;
    float burst = G.y*exp(-hitR*1.1);
    float scan = exp(-pow((pc.y - GH*(1. - fract(uTime*.19 + G.x*.37)))/.035, 2.))*.13;
    vec3 c = CY*(scan + hx*(.025 + burst*1.8 + ring*1.3)) + vec3(.8, .97, 1.)*(ring*.8 + burst*.5) + RD*G.z*(hx*.9 + .12);
    col += c*smoothstep(2.5, 6.5, tc)*exp(-tc*FOGK);
  }
  // beams: escorts firing
  for(int i = 0; i < ${NBEAM}; i++){
    vec4 A = uBmA[i];
    if(A.w <= 0.) continue;
    float s;
    float d2 = segDist2(ro, rd, A.xyz, uBmB[i].xyz, s);
    vec3 cp = A.xyz + (uBmB[i].xyz - A.xyz)*s;
    float tb = dot(cp - ro, rd);
    if(tb > tHit + .2) continue;
    float w = .0035*tb + .006;
    col += vec3(.45, .92, 1.)*A.w*(exp(-d2/(w*w))*1.8 + exp(-d2/(w*w*10.))*.25)*exp(-tb*FOGK*.6);
  }
  // flashes: shells where something was blocked, caught or hit
  for(int i = 0; i < ${NFX}; i++){
    vec4 F = uFx[i];
    if(F.w < 0.) continue;
    vec3 oc = F.xyz - ro;
    float tt = dot(oc, rd);
    if(tt < 0. || tt > tHit + .4) continue;
    float d = length(oc - rd*tt);
    float sz = uFxC[i].a;
    float r = sz*(1. - exp(-F.w*5.));
    float w = .02 + sz*.08;
    col += uFxC[i].rgb*(exp(-pow((d - r)/w, 2.))*exp(-F.w*3.)*1.5 + exp(-d*d/(sz*sz*.06))*exp(-F.w*6.)*3.5)*exp(-tt*FOGK*.5);
  }
  // keep the headline side calm on wide layouts
  if(uShift > .01) col *= .12 + .88*smoothstep(-.75, .1, nd.x);
  outCol(col);
}
`;

/* ---- the same canyon in JS: for agents, attacks, occlusion and labels ---- */
const cxAt = (z: number) => 3.75 * Math.sin(z * 0.0344) + 1.6 * Math.sin(z * 0.0856 + 1.3);
/** the centre line's curvature, for the bank */
const cxCurve = (z: number) => -3.75 * 0.0344 * 0.0344 * Math.sin(z * 0.0344) - 1.6 * 0.0856 * 0.0856 * Math.sin(z * 0.0856 + 1.3);
const wRb = (k: number, z: number) => 2.7 + 0.35 * Math.sin(z * 0.049 + 1) + 0.55 * k + 0.17 * Math.sin(z * 0.032 + k * 2.7) + 0.1 * Math.sin(z * 0.074 + k * 5.1);
const wLb = (k: number, z: number) => 2.05 + 0.35 * Math.sin(z * 0.042 + 0.4) + 0.2 * k + 0.06 * Math.sin(z * 0.038 + k * 3.3) + 0.035 * Math.sin(z * 0.088 + k * 1.9);
const rimR = (z: number) => 6.4 + 2 * Math.sin(z * 0.023 + 2) + 0.7 * Math.sin(z * 0.066);
const rimL = (z: number) => 10.8 + 1.4 * Math.sin(z * 0.026 + 0.7);
const rivC = (z: number) => 0.3 + 0.2 * Math.sin(z * 0.056);
const gateZ = (k: number) => G0 + k * GS;
const siteZ = (k: number) => G0 - OD + k * GS;
const siteLayer = (k: number) => {
  const kb = ((k % 2) + 2) % 2 === 0 ? 1 : 3;
  return Math.max(1, Math.min(kb, Math.floor(rimR(siteZ(k)) / H) - 2));
};
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

/** a point in canyon coordinates: along the canyon, across it (positive to the screen's right), height */
interface P {
  s: number;
  lat: number;
  y: number;
}
const P0 = (): P => ({ s: 0, lat: 0, y: 0 });

/** Point sprites written straight into the buffer (no per-point arrays). */
class Pts {
  data: Float32Array;
  n = 0;
  constructor(private max: number) {
    this.data = new Float32Array(max * POINT_STRIDE);
  }
  add(x: number, y: number, z: number, r: number, c: V3, k: number) {
    if (this.n >= this.max || k <= 0.004) return;
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

type Goal = (t: number, out: P) => void;
/** a flight from where an agent was (relative to the convoy) to a goal that may itself move */
interface Leg {
  t0: number;
  dur: number;
  from: P;
  goal: Goal;
  arc: number;
  side: number;
}
const FREE = 0;
const CHASE = 1;
const REPAIR = 2;
const WALL = 3;
const LEAVE = 4;
interface Agent {
  leg: Leg;
  job: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  init: boolean;
  /** reinforcements fade in and out */
  born: number;
  gone: number;
}

interface Gate {
  flare: number;
  lat: number;
  y: number;
  slip: number;
  wall: number;
  wallY: number;
}
interface Breach {
  k: number;
  zc: number;
  yc: number;
  t0: number;
  scanT: number;
  top: number;
  bot: number;
  end: number;
  crew: number[];
  evs: FeedEvent[];
}
interface Site {
  name: string;
  active: number;
  linger: number;
  br: Breach | null;
}
interface Attack {
  ev: FeedEvent;
  worm: boolean;
  /** the gate it meets; the system it is aimed at stands just this side of it */
  k: number;
  t0: number;
  /** a river packet: where it starts, its speed, its lane and height */
  s0: number;
  v: number;
  lat: number;
  y: number;
  ph: number;
  /** a worm: its first line, how far it crawls before dropping a line, its speed, where its path ends */
  L0: number;
  seg: number;
  vs: number;
  lamEnd: number;
  lamDead: number;
  passed: boolean;
  crewT: number;
  killT: number;
  crew: number[];
  dive: { t0: number; a: P; c: P; b: P } | null;
  dead: number;
  how: number;
  tag: boolean;
  head: P;
}
interface Swarm {
  ev: FeedEvent;
  t0: number;
  n: number;
  ds: Float32Array;
  dl: Float32Array;
  dy: Float32Array;
  dead: Float32Array;
  pos: P[];
  prev: P[];
  front0: number;
  vs: number;
  engaged: number;
  killNext: number;
  gap: number;
  squad: number[];
  site: number;
  diveT: number;
  diveFrom: P[];
  over: number;
}
interface Fx {
  p: V3;
  t0: number;
  c: V3;
  size: number;
}
interface Beam {
  a: V3;
  b: V3;
  t0: number;
  dur: number;
}

/**
 * Code canyon: an endless low flight down a winding canyon whose walls are
 * strata of source code (indented lines, keywords in cyan, strings in
 * amber, data strata as hex dumps), cut into terraces under a cool sky light
 * and warmed from below by a river of amber data traffic. A V of defender
 * agents flies escort, firewall gates span the canyon and every gate guards
 * a data-centre outcrop that stands for a system of the AI estate. Attacks
 * from the 90-day feed are red packets racing up the river or injected-code
 * worms crawling down the strata toward the system the feed names: a gate's
 * curtain flares and shatters most (blocked), escorts peel off and burst the
 * rest (intercepted), and at the type's real harm rate one gets through: the
 * wall around the system turns to corrupt red code that spreads along the
 * strata until a cyan rewrite runs down it line by line. In war a red swarm
 * floods down the canyon and the escorts, reinforced, wall it off.
 */
export function codeCanyon({ intel, emit }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const director = new WaveDirector(intel, 131);
  const rnd = director.rnd;
  const pts = new Pts(3800);
  let ready = false;
  let narrow = false;
  let NE = 11;
  let NR = 30;
  let simT = 0;
  let camS = 0;
  let speed = CRUISE;
  let cam: Cam = { eye: [0, 2, 0], target: [0, 1.5, 10] };
  let roll = 0;
  const escorts: Agent[] = [];
  let reinf: Agent[] = [];
  const formGoal: Goal[] = [];
  const wallGoal: Goal[] = [];
  let attacks: Attack[] = [];
  let swarm: Swarm | null = null;
  let breaches: Breach[] = [];
  const gates = new Map<number, Gate>();
  const sites = new Map<number, Site>();
  let fxs: Fx[] = [];
  let beams: Beam[] = [];
  // the wall across the canyon: rows, columns, and the slots ordered from its middle out
  let rowY: number[] = [];
  let rowN: number[] = [];
  const slotRow: number[] = [];
  const slotCol: number[] = [];
  let slotOrder: number[] = [];
  /** which wall slot each agent holds (escorts first, then reinforcements) */
  let wallOf: Agent[] = [];
  const tmp = P0();
  const tmp2 = P0();

  // sparks: a ring buffer of x y z vx vy vz t0 life
  const SPK = 520;
  const spk = new Float32Array(SPK * 8);
  const spkC = new Uint8Array(SPK);
  for (let i = 0; i < SPK; i++) spk[i * 8 + 6] = -99;
  let spkAt = 0;
  const SPK_COL: V3[] = [RED, HOT, ICE, AMBER, CYAN, WHITE];

  // uniforms
  const gateU = new Float32Array(NG * 4);
  const gateH = new Float32Array(NG * 4);
  const siteU = new Float32Array(NSITE * 4);
  const brU = new Float32Array(NBR * 4);
  const brU2 = new Float32Array(NBR * 4);
  const wormU = new Float32Array(NWORM * 4);
  const wormU2 = new Float32Array(NWORM * 4);
  const pkU = new Float32Array(NPK * 4);
  const bmA = new Float32Array(NBEAM * 4);
  const bmB = new Float32Array(NBEAM * 4);
  const fxU = new Float32Array(NFX * 4);
  const fxC = new Float32Array(NFX * 4);

  /* ---- the view: sprites are rolled with the camera, fogged, kept quiet on the headline side ---- */
  const view = { ex: 0, ey: 0, ez: 0, r: [1, 0, 0] as V3, u: [0, 1, 0] as V3, f: [0, 0, 1] as V3, c: 1, s: 0, tanX: 1, shift: 0, calm: false };
  const setView = (c: Cam, f: FrameInfo) => {
    let fx = c.target[0] - c.eye[0];
    let fy = c.target[1] - c.eye[1];
    let fz = c.target[2] - c.eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    const rl = Math.hypot(fz, fx) || 1;
    const R: V3 = [-fz / rl, 0, fx / rl];
    view.ex = c.eye[0];
    view.ey = c.eye[1];
    view.ez = c.eye[2];
    view.f = [fx, fy, fz];
    view.r = R;
    view.u = [R[1] * fz - R[2] * fy, R[2] * fx - R[0] * fz, R[0] * fy - R[1] * fx];
    view.c = Math.cos(roll);
    view.s = Math.sin(roll);
    view.tanX = f.tan[0];
    view.shift = f.shift;
    view.calm = !f.narrow && f.shift > 0.01;
  };
  /** the world point a sprite must be drawn at so it lands where the rolled camera sees x y z */
  const rolled = (x: number, y: number, z: number, out: V3) => {
    const vx = x - view.ex;
    const vy = y - view.ey;
    const vz = z - view.ez;
    const { r, u, f } = view;
    const a = vx * r[0] + vy * r[1] + vz * r[2];
    const b = vx * u[0] + vy * u[1] + vz * u[2];
    const d = vx * f[0] + vy * f[1] + vz * f[2];
    const a2 = view.c * a + view.s * b;
    const b2 = -view.s * a + view.c * b;
    out[0] = view.ex + r[0] * a2 + u[0] * b2 + f[0] * d;
    out[1] = view.ey + r[1] * a2 + u[1] * b2 + f[1] * d;
    out[2] = view.ez + r[2] * a2 + u[2] * b2 + f[2] * d;
    return { d, nx: a2 / (Math.max(d, 0.01) * view.tanX) + view.shift };
  };
  const RP: V3 = [0, 0, 0];
  const putW = (x: number, y: number, z: number, r: number, c: V3, k: number, fogK = FOG_K) => {
    const { d, nx } = rolled(x, y, z, RP);
    if (d < 0.12) return;
    let kk = k * Math.exp(-d * fogK) * smooth(0.3, 1.4, d);
    if (view.calm) kk *= 0.12 + 0.88 * smooth(-0.75, 0.1, nx);
    pts.add(RP[0], RP[1], RP[2], r, c, kk);
  };
  const put = (p: P, r: number, c: V3, k: number, fogK = FOG_K) => putW(cxAt(p.s) - p.lat, p.y, p.s, r, c, k, fogK);
  /** is the line of sight from the camera to x y z clear of rock (sprites have no depth test of their own) */
  const solid = (x: number, y: number, z: number) => {
    if (y < 0) return true;
    const lat = cxAt(z) - x;
    const k = Math.floor(y / H);
    if (lat > 0) return y < rimR(z) && lat > wRb(k, z) - 0.04;
    return y < rimL(z) && -lat > wLb(k, z) - 0.04;
  };
  const SEE = [0.12, 0.26, 0.4, 0.54, 0.67, 0.79, 0.9];
  const seen = (x: number, y: number, z: number) => {
    const ex = cam.eye[0];
    const ey = cam.eye[1];
    const ez = cam.eye[2];
    for (const u of SEE) if (solid(ex + (x - ex) * u, ey + (y - ey) * u, ez + (z - ez) * u)) return 0;
    return 1;
  };
  const seenP = (p: P) => seen(cxAt(p.s) - p.lat, p.y, p.s);

  /* ---- effects ---- */
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
  /** a burst at a canyon point; vs biases it along the canyon */
  const burst = (p: P, n: number, sp: number, vs: number, t: number, cols: number[]) => {
    const x = cxAt(p.s) - p.lat;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const e = rnd() * 2 - 1;
      const s = sp * (0.4 + rnd() * 0.8);
      const c = Math.sqrt(1 - e * e);
      spark(x, p.y, p.s, Math.cos(a) * c * s, e * s, Math.sin(a) * c * s + vs, t, 0.45 + rnd() * 0.5, cols[i % cols.length]!);
    }
  };
  const flash = (p: P, t: number, c: V3, size: number) => {
    fxs.push({ p: [cxAt(p.s) - p.lat, p.y, p.s], t0: t, c, size });
    if (fxs.length > NFX) fxs.shift();
  };
  const gate = (k: number) => {
    let g = gates.get(k);
    if (!g) {
      g = { flare: -99, lat: 0, y: 1, slip: -99, wall: -99, wallY: 0 };
      gates.set(k, g);
    }
    return g;
  };
  const site = (k: number) => {
    let s = sites.get(k);
    if (!s) {
      s = { name: "", active: 0, linger: -99, br: null };
      sites.set(k, s);
    }
    return s;
  };

  /* ---- agents ---- */
  const legPos = (L: Leg, t: number, out: P) => {
    L.goal(t, out);
    const u = L.dur > 0 ? (t - L.t0) / L.dur : 1;
    if (u >= 1) return;
    const e = ease(u);
    const fs = L.from.s + camS;
    out.s = fs + (out.s - fs) * e;
    out.lat = L.from.lat + (out.lat - L.from.lat) * e;
    out.y = L.from.y + (out.y - L.from.y) * e;
    const bump = Math.sin(Math.PI * e);
    out.lat += L.arc * L.side * bump;
    out.y += L.arc * 0.45 * bump;
  };
  /** send an agent somewhere, from wherever it is now (smoothly, while the convoy flies on) */
  const setLeg = (a: Agent, goal: Goal, t: number, dur: number, arc = 0, side = 1) => {
    legPos(a.leg, t, tmp2);
    a.leg = { t0: t, dur, from: { s: tmp2.s - camS, lat: tmp2.lat, y: tmp2.y }, goal, arc, side };
  };
  const agentAt = (a: Agent, out: P) => {
    out.s = a.z;
    out.lat = cxAt(a.z) - a.x;
    out.y = a.y;
  };
  /** the escorts' V: a leader and wingmen trailing back and lower on both sides, so it reads as an arrowhead flying into the canyon */
  const fslot = (i: number, t: number, out: P) => {
    const j = Math.ceil(i / 2);
    const sg = i === 0 ? 0 : i % 2 ? -1 : 1;
    out.s = camS + (narrow ? 7.5 : 8.5) - 0.62 * j;
    out.lat = (narrow ? 0.15 : 0.55) + sg * (narrow ? 0.19 : 0.2) * j + 0.03 * Math.sin(t * 0.9 + i * 2.1);
    out.y = 2.95 - 0.14 * j + 0.04 * Math.sin(t * 1.3 + i * 1.7);
  };
  const newAgent = (goal: Goal, t: number): Agent => {
    goal(t, tmp);
    const a: Agent = { leg: { t0: t, dur: 0, from: P0(), goal, arc: 0, side: 1 }, job: FREE, x: cxAt(tmp.s) - tmp.lat, y: tmp.y, z: tmp.s, vx: 0, vy: 0, vz: 0, init: false, born: -99, gone: -1 };
    return a;
  };
  /** back into the V, or into the wall while the war is on */
  const goHome = (i: number, t: number, dur = 1.8) => {
    const a = escorts[i];
    if (!a) return;
    const war = swarm !== null && swarm.over < 0;
    a.job = war ? WALL : FREE;
    setLeg(a, war ? wallGoal[i]! : formGoal[i]!, t, dur, 0.3, i % 2 ? -1 : 1);
  };
  /** the escorts nearest a point that can be spared (they leave the V, or the wall, for a job) */
  const draft = (n: number, near: P, job: number): number[] => {
    const free: { i: number; d: number }[] = [];
    escorts.forEach((a, i) => {
      if (a.job !== FREE && a.job !== WALL) return;
      agentAt(a, tmp2);
      free.push({ i, d: Math.hypot(tmp2.s - near.s, (tmp2.lat - near.lat) * 2, tmp2.y - near.y) + (i === 0 ? 50 : 0) + (a.job === WALL ? 20 : 0) });
    });
    free.sort((p, q) => p.d - q.d);
    const out = free.slice(0, n).map((x) => x.i);
    for (const i of out) escorts[i]!.job = job;
    return out;
  };

  /* ---- the wall across the canyon ---- */
  const wslot = (j: number, t: number, out: P) => {
    const r = slotRow[j]!;
    const c = slotCol[j]!;
    const n = rowN[r]!;
    const y = rowY[r]! + 0.05 * Math.sin(t * 1.7 + j * 1.3);
    const s = camS + DW + (c % 2) * 0.45 + r * 0.15;
    const k = Math.floor(y / H);
    const lo = -wLb(k, s) + 0.5;
    const hi = wRb(k, s) - 0.5;
    out.s = s;
    out.lat = lo + ((hi - lo) * (c + 0.5)) / n + 0.04 * Math.sin(t * 1.1 + j);
    out.y = y;
  };

  /* ---- attacks ---- */
  const wormHead = (a: Attack, lam: number, out: P) => {
    out.s = a.s0 - lam;
    const L = a.L0 - Math.floor(lam / a.seg);
    out.y = (L + 0.5) * LP;
    out.lat = wRb(Math.floor(out.y / H), out.s) - 0.05;
  };
  const headOf = (a: Attack, t: number, out: P) => {
    if (a.worm) {
      wormHead(a, a.dead >= 0 ? a.lamDead : Math.min(a.vs * (t - a.t0), a.lamEnd), out);
      return;
    }
    const dv = a.dive;
    if (dv) {
      const u = clamp01((t - dv.t0) / DIVE);
      const w = 1 - u;
      out.s = w * w * dv.a.s + 2 * w * u * dv.c.s + u * u * dv.b.s;
      out.lat = w * w * dv.a.lat + 2 * w * u * dv.c.lat + u * u * dv.b.lat;
      out.y = w * w * dv.a.y + 2 * w * u * dv.c.y + u * u * dv.b.y;
      return;
    }
    const tt = a.dead >= 0 ? a.dead : t;
    out.s = a.s0 - a.v * (tt - a.t0);
    out.lat = a.lat + 0.07 * Math.sin(tt * 2.3 + a.ph);
    out.y = a.y + 0.05 * Math.sin(tt * 3.1 + a.ph);
  };
  const siteFront = (k: number, out: P) => {
    const kb = siteLayer(k);
    const zo = siteZ(k);
    out.s = zo + 0.4;
    out.lat = wRb(kb, zo) - 1;
    out.y = kb * H + 1.2;
  };

  const launch = (ev: FeedEvent, t: number) => {
    let live = 0;
    for (const a of attacks) if (a.dead < 0) live++;
    if (live >= 12) return;
    const worm = rnd() < 0.36;
    // how far ahead the gate it meets should be when it gets there, so its end plays out in view;
    // take the gate nearest that, about four seconds of flight away
    const dhT = worm ? (ev.fate === "breach" ? 27 : 14) : ev.fate === "breach" ? 25 : ev.fate === "intercepted" ? 21 : 13;
    const sp = Math.max(speed, 0.6);
    const ideal = dhT + sp * 4.5;
    let k = Math.round((camS + ideal - G0) / GS);
    if (gateZ(k) - camS < dhT * 0.6 + sp * 3.4) k++;
    // the system it aims at is named for the feed's target: if this one stands for another system under attack, take the next when it is near enough
    const busy = (kk: number) => {
      const s2 = sites.get(kk);
      return !!s2 && (s2.active > 0 || !!s2.br) && s2.name !== ev.target;
    };
    if (busy(k) && !busy(k + 1) && gateZ(k + 1) - camS < ideal + 14) k++;
    const st = site(k);
    st.name = ev.target;
    st.active++;
    const zg = gateZ(k);
    // seconds until it meets the gate
    const tau = Math.max(3.4, Math.min(6.5, (zg - camS - dhT) / sp)) * (0.9 + rnd() * 0.2);
    const a: Attack = { ev, worm, k, t0: t, s0: 0, v: 0, lat: 0, y: 0, ph: rnd() * 6.28, L0: 0, seg: 1, vs: 1, lamEnd: 0, lamDead: 0, passed: false, crewT: -1, killT: -1, crew: [], dive: null, dead: -1, how: 0, tag: false, head: P0() };
    if (worm) {
      a.s0 = zg + 6.5 + rnd() * 3.5;
      a.L0 = Math.floor(Math.min(rimR(a.s0) - 0.45, 8) / LP);
      const L1 = Math.floor((siteLayer(k) * H + 1.2) / LP);
      a.lamEnd = a.s0 - siteZ(k) - 1.75;
      a.seg = a.lamEnd / Math.max(1, a.L0 - L1 + 0.5);
      a.vs = (a.s0 - zg) / tau;
      if (ev.fate === "intercepted") {
        a.killT = t + (a.s0 - zg - 2.2) / a.vs;
        a.crewT = Math.max(t + 0.2, a.killT - 1.4);
      }
    } else {
      a.v = 5.5 + rnd() * 2;
      a.s0 = zg + a.v * tau;
      a.lat = rivC(zg) + (rnd() - 0.5) * 2.2;
      a.y = 0.38 + rnd() * 0.35;
    }
    let tagged = 0;
    for (const b of attacks) if (b.tag && b.dead < 0) tagged++;
    a.tag = tagged < 2 && rnd() < 0.6;
    headOf(a, t, a.head);
    attacks.push(a);
    emit?.(ev, false);
  };

  const end = (a: Attack, t: number, how: number, word: string) => {
    if (a.worm) a.lamDead = Math.min(a.vs * (t - a.t0), a.lamEnd);
    a.dead = t;
    a.how = how;
    for (const i of a.crew) goHome(i, t);
    const st = site(a.k);
    st.active--;
    st.linger = Math.max(st.linger, t + 2.5);
    emit?.(a.ev, true, word);
  };
  /** escorts peel off to catch an attack by `killT` */
  const sendCrew = (a: Attack, t: number) => {
    const n = a.worm ? 2 : 3;
    headOf(a, a.killT, tmp);
    a.crew = draft(n, tmp, CHASE);
    a.crew.forEach((i, m) => {
      const goal: Goal = (tt, o) => {
        headOf(a, Math.min(tt, a.killT), o);
        if (a.worm) o.lat -= 0.45;
        o.s += 0.22 + 0.28 * m;
        o.lat += (m - (n - 1) / 2) * 0.3;
        o.y += 0.15;
      };
      setLeg(escorts[i]!, goal, t, Math.max(0.4, a.killT - t), 0.55, m % 2 ? 1 : -1);
    });
  };

  const startBreach = (k: number, ev: FeedEvent, t: number) => {
    const st = site(k);
    st.linger = Math.max(st.linger, t + 3);
    siteFront(k, tmp);
    flash(tmp, t, [1, 0.3, 0.16], 0.7);
    burst(tmp, 26, 1.6, 0.4, t, [0, 1, 3, 5]);
    const br = st.br;
    if (br && t < br.end) {
      // another one while it is still corrupt: the rewrite starts over
      br.evs.push(ev);
      br.scanT = Math.max(br.scanT, t + 1.6);
      br.end = br.scanT + (br.top - br.bot + 1) * LINE_T + 0.9;
      return;
    }
    const yc = siteLayer(k) * H + 1.25;
    const top = Math.floor((yc + 1.8) / LP);
    const bot = Math.floor((yc - 1.8) / LP);
    const scanT = t + 2.4;
    const nb: Breach = { k, zc: siteZ(k), yc, t0: t, scanT, top, bot, end: scanT + (top - bot + 1) * LINE_T + 0.9, crew: [], evs: [ev] };
    st.br = nb;
    breaches.push(nb);
  };
  const scanLine = (br: Breach, t: number) => (t < br.scanT ? 9999 : br.top - Math.floor((t - br.scanT) / LINE_T));

  const updPacket = (a: Attack, t: number) => {
    headOf(a, t, a.head);
    const zg = gateZ(a.k);
    if (!a.passed && a.head.s <= zg) {
      const g = gate(a.k);
      if (a.ev.fate === "blocked") {
        g.flare = t;
        g.lat = a.head.lat;
        g.y = a.head.y;
        tmp.s = zg - 0.05;
        tmp.lat = a.head.lat;
        tmp.y = a.head.y;
        flash(tmp, t, [0.6, 0.92, 1], 0.55);
        burst(tmp, 16, 1.7, -2.2, t, [0, 1, 2, 5]);
        end(a, t, 0, "BLOCKED");
        return;
      }
      a.passed = true;
      g.slip = t;
      burst(a.head, 5, 1, -1, t, [0, 1]);
      if (a.ev.fate === "intercepted") {
        // the escorts meet it about halfway to the camera
        const d = a.head.s - camS;
        a.killT = t + Math.max(0.7, (d - Math.max(6, d * 0.5)) / (a.v + speed));
        sendCrew(a, t);
      } else {
        const b = P0();
        siteFront(a.k, b);
        const s = { ...a.head };
        a.dive = { t0: t, a: s, c: { s: (s.s + b.s) / 2, lat: (s.lat + b.lat) / 2 + 0.3, y: Math.max(s.y, b.y) + 0.9 }, b };
      }
    }
    if (a.killT > 0 && t >= a.killT) {
      flash(a.head, t, [0.5, 0.92, 1], 0.45);
      burst(a.head, 18, 1.5, -0.8, t, [4, 2, 0, 5]);
      end(a, t, 1, "INTERCEPTED");
      return;
    }
    if (a.dive && t >= a.dive.t0 + DIVE) {
      end(a, t, 2, "BREACH · REWRITTEN");
      startBreach(a.k, a.ev, t);
      return;
    }
    if (a.head.s < camS + 0.8) end(a, t, 0, "BLOCKED");
  };
  const updWorm = (a: Attack, t: number) => {
    const lam = Math.min(a.vs * (t - a.t0), a.lamEnd);
    wormHead(a, lam, a.head);
    const zg = gateZ(a.k);
    if (a.crewT >= 0 && t >= a.crewT && !a.crew.length) sendCrew(a, t);
    if (a.killT >= 0 && t >= a.killT) {
      tmp.s = a.head.s;
      tmp.lat = a.head.lat - 0.1;
      tmp.y = a.head.y;
      flash(tmp, t, [0.5, 0.92, 1], 0.4);
      burst(tmp, 16, 1.3, 0, t, [4, 2, 0, 5]);
      end(a, t, 1, "INTERCEPTED");
      return;
    }
    if (!a.passed && a.head.s <= zg + 0.06) {
      const g = gate(a.k);
      if (a.ev.fate === "blocked") {
        g.wall = t;
        g.wallY = a.head.y;
        g.flare = t;
        g.lat = a.head.lat - 0.4;
        g.y = Math.min(a.head.y, GH - 0.2);
        tmp.s = zg;
        tmp.lat = a.head.lat - 0.08;
        tmp.y = a.head.y;
        flash(tmp, t, [0.6, 0.92, 1], 0.42);
        burst(tmp, 14, 1.3, 0, t, [0, 2, 1, 5]);
        end(a, t, 0, "BLOCKED");
        return;
      }
      a.passed = true;
      g.slip = t;
    }
    if (lam >= a.lamEnd) {
      end(a, t, 2, "BREACH · REWRITTEN");
      startBreach(a.k, a.ev, t);
    }
  };

  /* ---- the war: a swarm floods down the canyon, the escorts wall it off ---- */
  const startSwarm = (ev: FeedEvent, size: number, t: number) => {
    if (swarm && swarm.over < 0) return;
    const n = Math.min(size, narrow ? 44 : 90);
    const sw: Swarm = { ev, t0: t, n, ds: new Float32Array(n), dl: new Float32Array(n), dy: new Float32Array(n), dead: new Float32Array(n).fill(-1), pos: [], prev: [], front0: camS + 58, vs: 5, engaged: -1, killNext: 0, gap: 0.05, squad: [], site: -1, diveT: -1, diveFrom: [], over: -1 };
    // an arrowhead pointing at the camera: ranks widening behind its tip
    let j = 0;
    for (let r = 0; j < n; r++) {
      const m = 2 * r + 1;
      for (let i = 0; i < m && j < n; i++, j++) {
        sw.ds[j] = r * 0.7 + (rnd() - 0.5) * 0.15;
        sw.dl[j] = (i - r) * (narrow ? 0.37 : 0.31);
        sw.dy[j] = 0.5 * Math.sin(i * 1.9 + r * 0.7) + (r % 2) * 0.25 - 0.12;
      }
    }
    for (let i = 0; i < n; i++) {
      sw.pos.push(P0());
      sw.prev.push(P0());
    }
    if (ev.fate === "breach") {
      // part of it dives at a system on its way in, before the wall can stop it
      const k = Math.ceil((camS + 16 - (G0 - OD)) / GS);
      sw.site = k;
      const st = site(k);
      st.name = ev.target;
      st.active++;
      const idx = Array.from({ length: n }, (_, i) => i).sort((p, q) => sw.dl[q]! - sw.dl[p]!);
      sw.squad = idx.slice(0, 5);
    }
    swarm = sw;
    // the escorts and their reinforcements take up the wall
    wallOf = [];
    slotOrder.forEach((slot, m) => {
      const goal: Goal = (tt, o) => wslot(slot, tt, o);
      if (m < NE) {
        // escorts on a job join when it is done (goHome sends them here)
        const a = escorts[m]!;
        wallGoal[m] = goal;
        if (a.job === FREE) {
          a.job = WALL;
          setLeg(a, goal, t, 1.8 + m * 0.05, 0.2, m % 2 ? -1 : 1);
        }
        wallOf.push(a);
      } else if (m - NE < NR) {
        const lat = -1.8 + rnd() * 4.5;
        const y = 1 + rnd() * 4;
        const s = camS - 2 - rnd() * 5;
        const a = newAgent((_, o) => {
          o.s = s;
          o.lat = lat;
          o.y = y;
        }, t);
        a.job = WALL;
        a.born = t;
        setLeg(a, goal, t, 2.2 + (m - NE) * 0.045, 0.3, lat > 0.3 ? 1 : -1);
        reinf.push(a);
        wallOf.push(a);
      }
    });
    emit?.(ev, false);
  };
  const enemyPos = (sw: Swarm, j: number, t: number, out: P) => {
    if (sw.diveT >= 0 && sw.squad.includes(j)) {
      const k = sw.squad.indexOf(j);
      const a = sw.diveFrom[k]!;
      siteFront(sw.site, tmp2);
      const u = clamp01((t - sw.diveT - k * 0.08) / 1.1);
      const w = 1 - u;
      const cl = (a.lat + tmp2.lat) / 2 + 0.6;
      const cy = Math.max(a.y, tmp2.y) + 1;
      const cs = (a.s + tmp2.s) / 2;
      out.s = w * w * a.s + 2 * w * u * cs + u * u * (tmp2.s + (k - 2) * 0.3);
      out.lat = w * w * a.lat + 2 * w * u * cl + u * u * tmp2.lat;
      out.y = w * w * a.y + 2 * w * u * cy + u * u * (tmp2.y + (k - 2) * 0.15);
      return;
    }
    const front = sw.front0 - sw.vs * (t - sw.t0);
    let s = front + sw.ds[j]!;
    const minS = camS + DW + 1.1 + sw.ds[j]! * 0.22;
    // pressed against the wall they mill and jink
    if (s < minS) s = minS + 0.18 * Math.sin(t * 3.1 + j);
    out.s = s;
    out.lat = 0.45 + sw.dl[j]! + 0.08 * Math.sin(t * 2.3 + j * 1.7);
    out.y = 2.6 + sw.dy[j]! + 0.07 * Math.sin(t * 2.9 + j * 0.9);
  };
  const updSwarm = (t: number) => {
    const sw = swarm;
    if (!sw) return;
    let alive = 0;
    let near = -1;
    let nearS = 1e9;
    for (let j = 0; j < sw.n; j++) {
      const p = sw.pos[j]!;
      sw.prev[j]!.s = p.s;
      sw.prev[j]!.lat = p.lat;
      sw.prev[j]!.y = p.y;
      if (sw.dead[j]! >= 0) continue;
      enemyPos(sw, j, t, p);
      alive++;
      if (!sw.squad.includes(j) && p.s < nearS) {
        nearS = p.s;
        near = j;
      }
    }
    const wallS = camS + DW;
    // the breach squad peels off as the swarm passes over its system
    if (sw.site >= 0 && sw.diveT < 0 && nearS < siteZ(sw.site) + 3) {
      sw.diveT = t;
      sw.diveFrom = sw.squad.map((j) => ({ ...sw.pos[j]! }));
    }
    if (sw.diveT >= 0 && sw.site >= 0) {
      let landed = 0;
      sw.squad.forEach((j, k) => {
        if (sw.dead[j]! >= 0) {
          landed++;
          return;
        }
        if (t - sw.diveT - k * 0.08 >= 1.1) {
          sw.dead[j] = t;
          landed++;
          if (k === 0) startBreach(sw.site, sw.ev, t);
          else burst(sw.pos[j]!, 6, 1, 0, t, [0, 1]);
        }
      });
      if (landed === sw.squad.length) {
        const st = site(sw.site);
        st.active--;
        st.linger = Math.max(st.linger, t + 2.5);
        sw.site = -1;
      }
    }
    if (sw.engaged < 0 && sw.over < 0 && nearS - wallS < 3.2) {
      sw.engaged = t;
      sw.killNext = t + 0.15;
      sw.gap = 3.4 / Math.max(1, alive);
    }
    // the wall fires: one enemy after another, the nearest first
    let kills = 0;
    while (sw.engaged >= 0 && near >= 0 && t >= sw.killNext && kills < 3) {
      const p = sw.pos[near]!;
      sw.dead[near] = t;
      kills++;
      let best: Agent | null = null;
      let bd = 1e9;
      for (const a of wallOf) {
        agentAt(a, tmp2);
        const d = Math.hypot(tmp2.lat - p.lat, tmp2.y - p.y) + rnd() * 0.6;
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      if (best) beams.push({ a: [best.x, best.y, best.z], b: [cxAt(p.s) - p.lat, p.y, p.s], t0: t, dur: 0.24 });
      burst(p, 4, 1.1, 0.3, t, [0, 1, 5]);
      if (kills === 1 && rnd() < 0.18) flash(p, t, [1, 0.45, 0.3], 0.3);
      sw.killNext = Math.max(sw.killNext, t - 0.1) + sw.gap;
      near = -1;
      nearS = 1e9;
      for (let j = 0; j < sw.n; j++) {
        if (sw.dead[j]! >= 0 || sw.squad.includes(j)) continue;
        if (sw.pos[j]!.s < nearS) {
          nearS = sw.pos[j]!.s;
          near = j;
        }
      }
    }
    let left = 0;
    for (let j = 0; j < sw.n; j++) if (sw.dead[j]! < 0) left++;
    if (sw.over < 0 && left === 0) {
      sw.over = t;
      emit?.(sw.ev, true, sw.ev.fate === "breach" ? "SWARM · BREACH · REWRITTEN" : "SWARM REPELLED");
      // the wall stands down: escorts back into the V, reinforcements climb away
      escorts.forEach((a, i) => {
        if (a.job === WALL) goHome(i, t + i * 0.04, 2.2);
      });
      for (const a of reinf) {
        agentAt(a, tmp);
        const s = tmp.s + 2 + rnd() * 2;
        const lat = tmp.lat * 1.3;
        const y = tmp.y + 3.5 + rnd() * 2;
        a.job = LEAVE;
        a.gone = t;
        setLeg(a, (_, o) => {
          o.s = s;
          o.lat = lat;
          o.y = y;
        }, t, 2.6, 0.2);
      }
    }
    if (sw.over >= 0 && t - sw.over > 2.8) {
      swarm = null;
      reinf = [];
      wallOf = [];
    }
  };

  const updBreaches = (t: number) => {
    for (const br of breaches) {
      if (!br.crew.length && t >= br.t0 + 0.5) {
        // two escorts fly in and ride the rewrite down the wall
        tmp.s = br.zc;
        tmp.lat = wRb(siteLayer(br.k), br.zc) - 1.4;
        tmp.y = br.yc;
        br.crew = draft(2, tmp, REPAIR);
        br.crew.forEach((i, m) => {
          const goal: Goal = (tt, o) => {
            const sl = Math.min(br.top, Math.max(br.bot, scanLine(br, tt)));
            o.s = br.zc + (m ? 1.1 : -1.1) + 0.15 * Math.sin(tt * 2.1 + m * 2);
            o.lat = wRb(siteLayer(br.k), br.zc) - 1.55 + 0.1 * Math.sin(tt * 1.7 + m);
            o.y = (sl + 0.5) * LP + 0.18;
          };
          setLeg(escorts[i]!, goal, t, 1.6, 0.4, m ? 1 : -1);
        });
      }
      if (t >= br.end) {
        for (const i of br.crew) goHome(i, t);
        const st = site(br.k);
        if (st.br === br) st.br = null;
        st.linger = Math.max(st.linger, t + 2);
      }
    }
    breaches = breaches.filter((b) => t < b.end);
  };

  const moveAgent = (a: Agent, t: number, dt: number) => {
    legPos(a.leg, t, tmp);
    const x = cxAt(tmp.s) - tmp.lat;
    if (a.init && dt > 0) {
      const k = Math.min(1, dt * 10);
      a.vx += ((x - a.x) / dt - a.vx) * k;
      a.vy += ((tmp.y - a.y) / dt - a.vy) * k;
      a.vz += ((tmp.s - a.z) / dt - a.vz) * k;
    } else {
      a.vz = speed;
    }
    a.x = x;
    a.y = tmp.y;
    a.z = tmp.s;
    a.init = true;
  };

  const init = (f: FrameInfo) => {
    narrow = f.narrow;
    NE = narrow ? 7 : 11;
    NR = narrow ? 14 : 30;
    rowY = narrow ? [1.25, 2.5, 3.75] : [1.2, 2.4, 3.6, 4.8];
    rowN = narrow ? [6, 7, 8] : [9, 10, 11, 11];
    const centre: { j: number; d: number }[] = [];
    rowN.forEach((n, r) => {
      for (let c = 0; c < n; c++) {
        centre.push({ j: slotRow.length, d: Math.abs((c + 0.5) / n - 0.55) * 2 + Math.abs(r - (rowN.length - 1) / 2) * 0.35 });
        slotRow.push(r);
        slotCol.push(c);
      }
    });
    slotOrder = centre.sort((p, q) => p.d - q.d).map((x) => x.j);
    for (let i = 0; i < NE; i++) {
      const g: Goal = (t, o) => fslot(i, t, o);
      formGoal.push(g);
      escorts.push(newAgent(g, 0));
    }
    ready = true;
  };

  const sim = (t: number, dt: number) => {
    const want = swarm && swarm.over < 0 ? HOLD : breaches.length ? CRUISE * 0.72 : CRUISE;
    speed += (want - speed) * Math.min(1, dt * 0.8);
    camS += speed * dt;
    const wave = director.tick(t);
    for (const ev of wave.attacks) launch(ev, t);
    if (wave.swarm) startSwarm(wave.swarm.ev, wave.swarm.size, t);
    for (const a of attacks) {
      if (a.dead >= 0) continue;
      if (a.worm) updWorm(a, t);
      else updPacket(a, t);
    }
    attacks = attacks.filter((a) => a.dead < 0 || t - a.dead < 1);
    updSwarm(t);
    updBreaches(t);
    for (const a of escorts) moveAgent(a, t, dt);
    for (const a of reinf) moveAgent(a, t, dt);
    // sparks
    const drag = 1 - Math.min(0.5, 1.8 * dt);
    for (let i = 0; i < SPK; i++) {
      const o = i * 8;
      if (t - spk[o + 6]! > spk[o + 7]!) continue;
      spk[o] = spk[o]! + spk[o + 3]! * dt;
      spk[o + 1] = spk[o + 1]! + spk[o + 4]! * dt;
      spk[o + 2] = spk[o + 2]! + spk[o + 5]! * dt;
      spk[o + 3] = spk[o + 3]! * drag;
      spk[o + 4] = spk[o + 4]! * drag - 0.6 * dt;
      spk[o + 5] = spk[o + 5]! * drag;
    }
    fxs = fxs.filter((x) => t - x.t0 < 1.6);
    beams = beams.filter((b) => t - b.t0 < b.dur);
    for (const k of gates.keys()) if (gateZ(k) < camS - 4) gates.delete(k);
    for (const [k, st] of sites) if (siteZ(k) < camS - 6 && !st.br && st.active <= 0) sites.delete(k);
  };

  /** a defender: a bright core, a nose, two wingtips and an engine trail along its flight */
  const drawAgent = (a: Agent, col: V3, k: number, r: number) => {
    if (k <= 0.01) return;
    const vl = Math.hypot(a.vx, a.vy, a.vz);
    let fx = 0;
    let fy = 0;
    let fz = 1;
    if (vl > 0.2) {
      fx = a.vx / vl;
      fy = a.vy / vl;
      fz = a.vz / vl;
    }
    const sl = Math.hypot(fx, fz) || 1;
    const sx = -fz / sl;
    const sz = fx / sl;
    // the model is drawn at the size of its core
    const g = r / 0.05;
    putW(a.x, a.y, a.z, r, col, 5 * k);
    putW(a.x, a.y, a.z, r * 2.8, col, 0.45 * k);
    putW(a.x + fx * 0.15 * g, a.y + fy * 0.15 * g, a.z + fz * 0.15 * g, r * 0.7, WHITE, 2.6 * k);
    // a delta wing swept back to each tip
    for (const w of [-1, 1]) {
      for (let m = 1; m <= 3; m++) {
        const b = m * 0.065 * g;
        const sp = m * 0.085 * g;
        putW(a.x - fx * b + sx * sp * w, a.y - fy * b - 0.014 * m * g, a.z - fz * b + sz * sp * w, r * (0.75 - m * 0.08), col, (2.4 - m * 0.3) * k);
      }
    }
    const tv = Math.max(vl, 0.8);
    for (let j = 1; j <= 8; j++) {
      const q = j * 0.06 * Math.sqrt(g);
      putW(a.x - fx * tv * q, a.y - fy * tv * q, a.z - fz * tv * q, r * (0.8 - j * 0.05), col, 1.5 * k * (1 - j / 9));
    }
  };

  const draw = (f: FrameInfo, set: Setter) => {
    const t = f.t;
    const level = director.level(t);
    // low over the river, nearer the left wall, looking down the canyon
    const latCam = narrow ? 0.1 : -0.55 + 0.18 * Math.sin(t * 0.071);
    const look = 12;
    cam = {
      eye: [cxAt(camS) - latCam, 3.2 + 0.15 * Math.sin(t * 0.13 + 0.5), camS],
      target: [cxAt(camS + look) - (narrow ? 0.12 : 0.35), 2.05, camS + look],
    };
    roll = Math.max(-0.075, Math.min(0.075, 4 * cxCurve(camS + 8)));
    setView(cam, f);
    pts.n = 0;

    // traffic in the river: amber packets streaming down the canyon ahead of us
    const NT = narrow ? 20 : 36;
    for (let j = 0; j < NT; j++) {
      const ds = ((hash(j + 120) * 70 + t * (3 + 2.5 * hash(j + 160))) % 70) - 4;
      tmp.s = camS + ds;
      tmp.lat = rivC(tmp.s) + (hash(j + 40) - 0.5) * 2.8;
      tmp.y = 0.12;
      if (ds > 10 && !seenP(tmp)) continue;
      const fade = 1 - smooth(58, 66, ds);
      put(tmp, 0.04, AMBER, 1.5 * fade);
      tmp.s -= 0.22;
      put(tmp, 0.03, AMBER, 0.6 * fade);
    }
    // escorts and reinforcements
    const er = narrow ? 0.085 : 0.065;
    for (const a of escorts) drawAgent(a, CYAN, 1, er);
    // the V drawn as a V: faint links from each wingman to the one ahead of it, while both hold the formation
    for (let i = 1; i < NE; i++) {
      const a = escorts[i]!;
      const b = escorts[i <= 2 ? 0 : i - 2]!;
      if (a.job !== FREE || b.job !== FREE) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d > 1.4) continue;
      for (let q = 1; q <= 5; q++) {
        const u = q / 6;
        putW(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u, er * 0.35, CYAN, 1.1);
      }
    }
    for (const a of reinf) {
      const k = smooth(0, 0.5, t - a.born) * (a.gone >= 0 ? 1 - smooth(0.6, 2.6, t - a.gone) : 1);
      if (a.z - camS > 8 && !seen(a.x, a.y, a.z)) continue;
      drawAgent(a, ICE, k, er);
    }
    // the wall's lattice: faint links between neighbours once it has formed
    const sw = swarm;
    if (sw && t - sw.t0 > 2.6) {
      const k = sw.over < 0 ? smooth(2.6, 3.4, t - sw.t0) : 1 - smooth(0, 0.8, t - sw.over);
      for (let m = 0; m < wallOf.length; m++) {
        const slot = slotOrder[m]!;
        // the neighbour to the right in the same row
        const nb = slotOrder.findIndex((s2) => slotRow[s2] === slotRow[slot] && slotCol[s2] === slotCol[slot]! + 1);
        const b = nb >= 0 ? wallOf[nb] : undefined;
        const a = wallOf[m]!;
        if (!b) continue;
        for (let q = 1; q <= 3; q++) {
          const u = q / 4;
          putW(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u, 0.018, CYAN, 0.42 * k);
        }
      }
    }
    // the swarm
    let pki = 0;
    pkU.fill(0);
    if (sw) {
      const er2 = narrow ? 0.11 : 0.085;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let cn = 0;
      for (let j = 0; j < sw.n; j++) {
        const dd = sw.dead[j]!;
        if (dd >= 0 && t - dd > 0.15) continue;
        const p = sw.pos[j]!;
        const x = cxAt(p.s) - p.lat;
        if (p.s - camS > 9 && !seen(x, p.y, p.s)) continue;
        if (dd >= 0) {
          putW(x, p.y, p.s, 0.09, WHITE, 3 * (1 - (t - dd) / 0.15));
          continue;
        }
        const pv = sw.prev[j]!;
        // red reads darker than cyan in the glyph ramp, so the attackers burn hotter than our agents, and far ones keep a minimum size
        const fl = 9 + Math.sin(t * 17 + j * 1.7) * 2;
        const appear = smooth(0, 1.2, t - sw.t0);
        const r2 = Math.max(er2, (p.s - camS) * 0.004);
        putW(x, p.y, p.s, r2, FOE, fl * appear, 0.015);
        putW(x, p.y, p.s, r2 * 0.5, [1, 0.75, 0.62], 3 * appear, 0.015);
        putW(x, p.y, p.s, r2 * 2.6, RED, 0.5 * appear, 0.015);
        // a short tail back along its flight
        const tx = cxAt(pv.s) - pv.lat - x;
        const ty = pv.y - p.y;
        const tz = pv.s - p.s;
        const tl = Math.hypot(tx, ty, tz);
        const kx = tl > 1e-4 ? tx / tl : 0;
        const ky = tl > 1e-4 ? ty / tl : 0;
        const kz = tl > 1e-4 ? tz / tl : 1;
        putW(x + kx * 0.15, p.y + ky * 0.15, p.s + kz * 0.15, er2 * 0.7, RED, 3 * appear, 0.03);
        putW(x + kx * 0.3, p.y + ky * 0.3, p.s + kz * 0.3, er2 * 0.5, RED, 1.6 * appear, 0.03);
        cx += x;
        cy += p.y;
        cz += p.s;
        cn++;
      }
      if (cn && pki < NPK) {
        pkU.set([cx / cn, cy / cn, cz / cn, 0.9 * Math.min(1, cn / 20)], pki * 4);
        pki++;
      }
    }
    // attacks in flight: red packets up the river, worm heads on the walls
    const pr = narrow ? 0.13 : 0.1;
    for (const a of attacks) {
      if (a.dead >= 0) continue;
      const p = a.head;
      const x = cxAt(p.s) - p.lat;
      const dist = p.s - camS;
      if (dist > 8 && !seen(x, p.y, p.s)) continue;
      // far attacks keep a minimum size on screen, so a red spark shows deep in the canyon
      const ar = Math.max(pr, dist * 0.0045);
      if (a.worm) {
        put(p, ar * 1.1, HOT, 8, 0.02);
        put(p, ar * 0.5, [1, 0.8, 0.7], 2.5, 0.02);
        put(p, ar * 3, RED, 0.7, 0.02);
      } else {
        const appear = smooth(0, 0.6, t - a.t0);
        put(p, ar, HOT, 10 * appear, 0.015);
        put(p, ar * 0.5, [1, 0.8, 0.7], 3 * appear, 0.015);
        put(p, ar * 3, RED, 0.8 * appear, 0.015);
        for (let j = 1; j <= 12; j++) {
          tmp.s = p.s + j * 0.3 * (a.dive ? -0.5 : a.v / 6) * (ar / pr);
          tmp.lat = p.lat - (a.dive ? 0 : 0.07 * j * 0.3 * Math.cos(t * 2.3 + a.ph) * 2.3 * 0.1);
          tmp.y = p.y + (a.dive ? -j * 0.06 : 0);
          put(tmp, ar * (0.85 - j * 0.04), RED, 5 * (1 - j / 13) * appear, 0.015);
        }
      }
      if (pki < NPK && dist < 30) {
        pkU.set([x, p.y, p.s, a.worm ? 0.35 : 0.55], pki * 4);
        pki++;
      }
    }
    // sparks
    for (let i = 0; i < SPK; i++) {
      const o = i * 8;
      const age = t - spk[o + 6]!;
      const life = spk[o + 7]!;
      if (age < 0 || age > life) continue;
      const u = 1 - age / life;
      putW(spk[o]!, spk[o + 1]!, spk[o + 2]!, 0.028, SPK_COL[spkC[i]!]!, 2.4 * u * u);
    }

    // beams: interceptions in their last moments, and the wall's fire
    bmA.fill(0);
    bmB.fill(0);
    let bi = 0;
    for (const a of attacks) {
      if (a.dead >= 0 || a.killT < 0 || t < a.killT - 0.35) continue;
      const hx = cxAt(a.head.s) - a.head.lat;
      for (const i of a.crew) {
        const e = escorts[i];
        if (!e || bi >= NBEAM) continue;
        bmA.set([e.x, e.y, e.z, 1.3], bi * 4);
        bmB.set([hx, a.head.y, a.head.s, 0], bi * 4);
        bi++;
      }
    }
    for (let i = beams.length - 1; i >= 0 && bi < NBEAM; i--) {
      const b = beams[i]!;
      bmA.set([b.a[0], b.a[1], b.a[2], 1.2 * (1 - (t - b.t0) / b.dur)], bi * 4);
      bmB.set([b.b[0], b.b[1], b.b[2], 0], bi * 4);
      bi++;
    }

    // gates the shader is told about
    const k0 = Math.ceil((camS - 0.6 - G0) / GS);
    for (let i = 0; i < NG; i++) {
      const k = k0 + i;
      const g = gates.get(k);
      const o = i * 4;
      gateU[o] = k;
      gateU[o + 1] = g && t - g.flare < 2 ? Math.exp(-(t - g.flare) * 3.2) : 0;
      gateU[o + 2] = g ? Math.max(0, 1 - (t - g.slip) / 0.8) * (0.55 + 0.45 * Math.sin(t * 41)) : 0;
      gateU[o + 3] = g && t - g.flare < 2 ? t - g.flare : -1;
      gateH[o] = g ? g.lat : 0;
      gateH[o + 1] = g ? g.y : 0;
      gateH[o + 2] = g && t - g.wall < 1.5 ? Math.exp(-(t - g.wall) * 3) : 0;
      gateH[o + 3] = g ? g.wallY : 0;
    }
    // systems, breaches and worms
    const ks = Math.ceil((camS - 2 - (G0 - OD)) / GS);
    for (let i = 0; i < NSITE; i++) {
      const k = ks + i;
      const br = sites.get(k)?.br;
      const o = i * 4;
      siteU[o] = k;
      siteU[o + 1] = 0;
      siteU[o + 2] = 0;
      siteU[o + 3] = 0;
      if (br) {
        const siteLine = Math.floor(br.yc / LP);
        const sl = scanLine(br, t);
        const grow = ease((t - br.t0) / 0.8);
        if (sl > siteLine) siteU[o + 1] = grow;
        else {
          const passT = br.scanT + (br.top - siteLine) * LINE_T;
          siteU[o + 3] = Math.exp(-(t - passT) * 2.2);
        }
        siteU[o + 2] = 1 - clamp01((t - br.t0) / 2);
      }
    }
    brU.fill(0);
    brU2.fill(0);
    breaches.slice(0, NBR).forEach((br, i) => {
      const sl = scanLine(br, t);
      brU.set([br.zc, br.yc, ease((t - br.t0) / 1.6), sl], i * 4);
      brU2.set([1, sl < 9000 ? ((t - br.scanT) / LINE_T) % 1 : 0, 0, 0], i * 4);
    });
    wormU.fill(-1);
    wormU2.fill(0);
    let wi = 0;
    for (const a of attacks) {
      if (!a.worm || wi >= NWORM) continue;
      if (a.dead >= 0 && t - a.dead > 0.8) continue;
      const lam = a.dead >= 0 ? a.lamDead : Math.min(a.vs * (t - a.t0), a.lamEnd);
      wormU.set([a.s0, a.L0, a.seg, lam], wi * 4);
      const alpha = a.dead >= 0 ? 1 - clamp01((t - a.dead) / 0.8) : smooth(0, 0.5, t - a.t0);
      wormU2.set([0.9, 7.5, alpha, a.dead >= 0 && a.how !== 2 ? 1 : 0], wi * 4);
      wi++;
    }
    fxU.fill(-1);
    fxC.fill(0);
    fxs.forEach((x, i) => {
      if (i >= NFX) return;
      fxU.set([x.p[0], x.p[1], x.p[2], t - x.t0], i * 4);
      fxC.set([x.c[0], x.c[1], x.c[2], x.size], i * 4);
    });

    setCam(set, cam);
    set.f("uRoll", roll);
    set.v3("uFar", cxAt(camS + 40) - cam.eye[0], 0, 40);
    set.v4("uMood", level, sw && sw.over < 0 ? 1 : 0, 0, 0);
    set.v4v("uGate", gateU);
    set.v4v("uGateH", gateH);
    set.v4v("uSite", siteU);
    set.v4v("uBr", brU);
    set.v4v("uBr2", brU2);
    set.v4v("uWorm", wormU);
    set.v4v("uWorm2", wormU2);
    set.v4v("uPk", pkU);
    set.v4v("uBmA", bmA);
    set.v4v("uBmB", bmB);
    set.v4v("uFx", fxU);
    set.v4v("uFxC", fxC);
    set.points(pts.data, pts.n, cam);
  };

  /** where a canyon point lands on screen, through the rolled camera */
  const proj = (p: P, f: FrameInfo) => {
    const RQ: V3 = [0, 0, 0];
    rolled(cxAt(p.s) - p.lat, p.y, p.s, RQ);
    return projectPoint(RQ, cam, f);
  };

  return {
    frag: FRAG,
    fovY: 34,
    shift: 0.4,
    frame(f, set) {
      const t = f.t;
      if (!ready) {
        init(f);
        // a late first frame (the reduced-motion still) plays the flight up to now, so it shows a scene in progress
        for (let tt = 1 / 30; tt < t; tt += 1 / 30) sim(tt, 1 / 30);
        simT = t;
      }
      const dt = Math.min(0.05, Math.max(0, t - simT));
      if (dt > 0) sim(t, dt);
      simT = t;
      draw(f, set);
    },
    labels(f) {
      if (f.narrow) return [];
      const t = f.t;
      const out: { text: string; x: number; y: number; tone?: string; anchor?: "start" | "middle" | "end" }[] = [];
      const minX = f.width * 0.47;
      /** a tag goes up only on screen, right of the headline, and clear of the tags already placed */
      const place = (text: string, s: { x: number; y: number } | null, tone: string) => {
        if (!s || s.x < minX || s.x > f.width - 40 || s.y < 16 || s.y > f.height - 44) return false;
        const w = text.length * 3.6 + 8;
        if (out.some((o) => Math.abs(o.x - s.x) < w + o.text.length * 3.6 && Math.abs(o.y - s.y) < 16)) return false;
        out.push({ text, x: s.x, y: s.y, tone, anchor: "middle" });
        return true;
      };
      // the swarm, riding it
      const sw = swarm;
      if (sw && sw.over < 0) {
        let alive = 0;
        let ss = 0;
        let sl = 0;
        let sy = 0;
        for (let j = 0; j < sw.n; j++) {
          if (sw.dead[j]! >= 0) continue;
          alive++;
          ss += sw.pos[j]!.s;
          sl += sw.pos[j]!.lat;
          sy += sw.pos[j]!.y;
        }
        if (alive) {
          tmp.s = ss / alive;
          tmp.lat = sl / alive;
          tmp.y = sy / alive + 1.4;
          if (tmp.s - camS < 12 || seenP(tmp)) place(`${sw.ev.kind.toLowerCase()} swarm · ${alive}`, proj(tmp, f), "hot");
        }
      }
      // the systems under attack, named for the feed's targets (a breached one first)
      const named: { k: number; st: Site }[] = [];
      for (const [k, st] of sites) if (st.name && (st.active > 0 || st.br || t < st.linger)) named.push({ k, st });
      named.sort((p, q) => (q.st.br ? 1 : 0) - (p.st.br ? 1 : 0) || siteZ(p.k) - siteZ(q.k));
      let ns = 0;
      for (const { k, st } of named) {
        if (ns >= 2) break;
        const kb = siteLayer(k);
        const zo = siteZ(k);
        tmp.s = zo;
        tmp.lat = wRb(kb, zo) - 0.55;
        tmp.y = kb * H + 3.4;
        if (zo - camS < 5 || zo - camS > 34 || !seenP(tmp)) continue;
        if (out.some((o) => o.text === st.name)) continue;
        const s = proj(tmp, f);
        // a system tall enough to run off the top keeps its name at the edge
        if (s && place(st.name, { x: s.x, y: Math.max(22, s.y - 6) }, st.br ? "hot" : "dim")) ns++;
      }
      // the kind of a few attacks, riding them
      let nk = 0;
      for (const a of attacks) {
        if (nk >= 2) break;
        if (!a.tag || a.dead >= 0 || t - a.t0 < 0.5 || a.head.s - camS > 26) continue;
        if (a.head.s - camS > 8 && !seenP(a.head)) continue;
        const s = proj(a.head, f);
        if (s && place(a.ev.kind.toLowerCase(), { x: s.x, y: s.y - 14 }, "hot")) nk++;
      }
      out.push({ text: "sim · attack mix and breach odds from the last 90 days", x: f.width - 16, y: f.height - 16, tone: "dim", anchor: "end" });
      return out;
    },
  };
}
