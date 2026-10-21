import type { ThreatIntel } from "@/lib/threatIntel";
import { POINT_STRIDE, projectPoint, type Cam, type FrameInfo, type GlyphController } from "../engine";
import type { FeedEvent } from "../feed";
import { WaveDirector } from "./director";
import { setCam, type Emit } from "./kit";

/** functional blocks and fill macros on the die */
const NB = 12;
/** bus lanes (the ring round the core and the channels between the macros) */
const NSEG = 10;
const NFX = 8;
/** the die is 2 DX by 2 DZ, centred on the origin, its top at y = 0 and DT thick */
const DX = 12;
const DZ = 8;
const DT = 0.3;
/** centrelines of the ring lane just inside the I/O pads */
const RX = 10.38;
const RZ = 6.38;
/** a lane's half-width */
const HW = 0.3;
/** guard ring offset outside a block */
const GR = 0.12;
/** a block edge to the centreline of the lane beside it */
const CHG = 0.48;
const PAD_P = 0.8;
/** bond pad centres, in from the die edge */
const PAD_E = 0.62;
/** offsets across a lane that a packet or a patrol rides */
const LANES = [-0.22, 0, 0.22];
/** a breach infects a band this wide either side of the port it got in by (a big block is not swallowed whole) */
const INF_W = 2.1;
/** centre of the SOC block, where the defenders dock */
const SOCC: [number, number] = [1.35, 0.15];
/** the PLL's big coil, where the clock starts */
const PLLC: [number, number] = [-8.8, 3.58];
/** relief: the plinths (NPU cores, SRAM banks) and the towers on them (processing elements, bit matrices) */
const H1 = 0.07;
const H2 = 0.17;
/** HBM stacks on the package beyond the far edge: x centres, their z centre, half sizes, top */
const HBM_X = [-8.4, -2.8, 2.8, 8.4];
const HBZ = -11.1;
const HBH: [number, number] = [2, 1.7];
const HBT = 2;

const FRAG = `
uniform vec3 uEye;
uniform vec3 uTarget;
uniform vec4 uBlk[${NB}];
uniform vec4 uBlkS[${NB}];
uniform vec4 uBlkE[${NB}];
uniform vec4 uSeg[${NSEG}];
uniform vec4 uLeak[2];
uniform vec4 uFx[${NFX}];
uniform vec4 uFxC[${NFX}];
uniform vec4 uHeat[3];
uniform vec4 uWave;
uniform vec4 uPeel;
uniform vec4 uSwarm;
uniform vec4 uLine;
uniform vec4 uLineS;
uniform vec4 uMood;
uniform vec4 uView;

const float DX = ${DX.toFixed(1)};
const float DZ = ${DZ.toFixed(1)};
const float DT = ${DT.toFixed(2)};
const float HW = ${HW.toFixed(2)};
const float GR = ${GR.toFixed(2)};
const float CHG = ${CHG.toFixed(2)};
const float PAD_P = ${PAD_P.toFixed(2)};
const float PAD_E = ${PAD_E.toFixed(2)};
const float INF_W = ${INF_W.toFixed(2)};
const vec2 SOCC = vec2(${SOCC[0].toFixed(2)}, ${SOCC[1].toFixed(2)});
const vec2 PLLC = vec2(${PLLC[0].toFixed(2)}, ${PLLC[1].toFixed(2)});
const float H1 = ${H1.toFixed(2)};
const float H2 = ${H2.toFixed(2)};
const float HBZ = ${HBZ.toFixed(2)};
const vec2 HBH = vec2(${HBH[0].toFixed(2)}, ${HBH[1].toFixed(2)});
const float HBT = ${HBT.toFixed(2)};
const vec4 PKG = vec4(-15.5, -14.2, 15.5, 11.6);
const vec3 CY = vec3(.35, .85, 1.);
const vec3 RD = vec3(1., .22, .14);
/** amber and red for light the die gives off: deeper, so they keep their hue at the brightness a glyph needs */
const vec3 AMD = vec3(1., .5, .13);
const vec3 RDD = vec3(1., .12, .06);
const vec3 GOLD = vec3(1., .8, .36);
const vec3 COPPER = vec3(.95, .47, .22);
const vec3 VIO = vec3(.5, .36, .95);
/** the transistor level: silicon fins, poly gates, the first metal */
const vec3 FIN = vec3(.3, .95, .6);
const vec3 GATE = vec3(.8, .6, 1.);
const vec3 M1C = vec3(.35, .55, 1.);
/** toward the raking light, low from the far left: edges facing it catch it */
const vec2 LDIR = vec2(-.55, -.835);
/** the broad lamp the metal reflects, so a sheen drifts over the die as the camera moves */
const vec3 LSH = vec3(-.28, .62, -.73);

/** the die point being shaded, for patterns that run across block borders (the power mesh) */
vec2 gQ;
/** a pixel that lands on a block's own surface is shaded once, after shadeDie, by blockShade with these
    (one call site instead of two halves the shader's compile time on Direct3D) */
int gBi;
vec2 gBq;
vec2 gBf;
float gBface;
float gBgloss;
float gBpw;
/** light the die gives off itself (data, attacks, the defences, heat), kept apart from the metal the lamp lights */
vec3 gEm;
/** transistor-level detail, laid down only when the lens is close enough to resolve it */
vec3 gMicro;
/** the clock edge at this point, and how far the metal stack is peeled away here */
float gClk;
/** 1 once the lens is close enough to resolve the transistors */
float gZoom;

/** what a block's art lays down: logic metal, arrays (or coils), amber activity, an accent, top metal */
struct Art { float m; float arr; float am; float acc; float top; };
Art none(){ return Art(0., 0., 0., 0., 0.); }

/** a line of half-width w at signed offset d, box-filtered over a footprint fp (thin lines dim instead of flickering) */
float cover(float d, float w, float fp){ fp = max(fp, 1e-5); return clamp((min(d + fp*.5, w) - max(d - fp*.5, -w))/fp, 0., 1.); }
float box(vec2 p, vec2 c, vec2 h, vec2 fp){ return cover(p.x - c.x, h.x, fp.x)*cover(p.y - c.y, h.y, fp.y); }
float frame(vec2 p, vec2 c, vec2 h, float w, vec2 fp){ return box(p, c, h, fp) - box(p, c, h - w, fp); }
float frame2(vec2 p, vec2 c, vec2 h, vec2 w, vec2 fp){ return box(p, c, h, fp) - box(p, c, h - w, fp); }
/** a grid of filled tiles of pitch P with dark seams between */
float tiles(vec2 p, vec2 P, vec2 seam, vec2 fp){ return box(mod(p, P), P*.5, P*.5 - seam*.5, fp); }
/** lines of half-width w every P; once they are finer than a glyph they settle to a share (keep) of their mean */
float lines(float x, float P, float w, float fp, float keep){
  float d = abs(fract(x/P + .5) - .5)*P;
  return mix(cover(d, w, fp), 2.*w/P*keep, smoothstep(.3, .9, fp/P));
}
float sdBox2(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
float octa(vec2 p){ vec2 a = abs(p); return max(max(a.x, a.y), (a.x + a.y)*.7071); }

/**
 * Inside a standard cell at gate scale, drawn as big clean shapes so it reads in glyphs: green fins
 * running along the row (two NMOS, two PMOS), violet poly gates crossing them on the contacted pitch,
 * white source and drain contacts between. The clock edge lights the gates as it passes.
 */
vec3 micro(vec2 p, vec2 fp, float seed, float row, float fy, float cm){
  float fin = cover(fy - .055, .009, fp.y) + cover(fy - .085, .009, fp.y) + cover(fy - .155, .009, fp.y) + cover(fy - .185, .009, fp.y);
  float gd = abs(fract(p.x/.034 + .5) - .5)*.034;
  float gate = cover(gd, .0065, fp.x)*cover(fy - .12, .098, fp.y);
  float gx = floor(p.x/.034);
  float hc = hash12(vec2(gx, row*3.7 + seed));
  float con = step(.45, hc)*box(vec2(p.x - (gx + .5)*.034, fy - (hc < .72 ? .07 : .17)), vec2(0.), vec2(.0055, .018), fp);
  return (FIN*fin*.32*(1. - gate) + GATE*gate*(.5 + 1.3*gClk) + vec3(.95)*con*.75)*cm;
}

/**
 * Standard-cell rows, weighted by w: cells of mixed widths between rails, a few flops brighter; faint
 * from afar, the floor the macros stand on. Close up the cells open into their transistors (gMicro).
 */
float cells(vec2 p, vec2 fp, float seed, float w){
  if(w < .001) return 0.;
  const float RP = .24;
  float row = floor(p.y/RP);
  float fy = p.y - row*RP;
  float bx = p.x/.34 + hash12(vec2(row, seed))*17.;
  float bi = floor(bx), bf = fract(bx);
  float cut = .2 + .6*hash12(vec2(bi, row + seed*3.1));
  float ci = bf < cut ? bi*2. : bi*2. + 1.;
  float de = min(min(bf, abs(bf - cut)), 1. - bf)*.34;
  float h = hash12(vec2(ci, row*1.37 + seed));
  float body = (1. - cover(de, .03, fp.x))*cover(fy - RP*.42, RP*.3, fp.y);
  float tone = h < .2 ? 0. : h > .94 ? .5 : .2;
  float res = 1. - smoothstep(.4, 1.1, max(fp.y/RP, fp.x/.17));
  float rail = cover(fy, .018, fp.y) + cover(fy - RP, .018, fp.y);
  float zoom = gZoom;
  if(zoom > 0.){
    // close up, the first metal covers the cells: tracks along the row, cut into segments, vias down to the cells
    float tr = lines(fy - .02, .04, .008, fp.y, .5)*cover(fy - RP*.5, RP*.5 - .025, fp.y);
    float seg = step(.18, fract(p.x/.27 + hash12(vec2(floor(fy/.04), row + seed))*3.));
    float via = step(.8, hash12(vec2(floor(p.x/.068), floor(fy/.04) + row*7.)))*box(vec2(mod(p.x, .068) - .034, mod(fy - .02, .04) - .02), vec2(0.), vec2(.007), fp);
    gMicro += (M1C*tr*seg*.45 + vec3(.9)*via*.6)*w*zoom;
  }
  return w*mix(.02, body*tone*.28*(1. - zoom) + rail*.14*(1. - .6*zoom), res);
}
/** the power mesh: top-metal straps on a fixed pitch over the core, a via stack where they cross (gone where the stack is peeled) */
float power(vec2 fp){
  float v = lines(gQ.x + .31, 1.05, .03, fp.x, .7), h = lines(gQ.y + .27, 1.44, .06, fp.y, .7);
  return (max(v, h)*.75 + v*h*1.2)*(1. - .45*gZoom);
}

/**
 * An SRAM macro from its corner: banks split by gutters, a row-decoder bar down each bank's left and a
 * sense-amp bar along its near side (the plinth), the bit matrix as sub-array tiles (the terrace on top).
 */
float sram(vec2 p, vec2 sz, vec2 fp){
  if(p.x < -.02 || p.y < -.02 || p.x > sz.x + .02 || p.y > sz.y + .02) return 0.;
  vec2 nb = max(vec2(1.), floor(sz/vec2(1.9, 1.3) + .5));
  vec2 bs = sz/nb;
  vec2 bi = clamp(floor(p/bs), vec2(0.), nb - 1.);
  vec2 bp = p - bi*bs;
  const vec2 G = vec2(.06, .1);
  float inB = box(bp, bs*.5, bs*.5 - G, fp);
  float dec = box(bp, vec2(G.x + .1, bs.y*.5), vec2(.1, bs.y*.5 - G.y), fp);
  float sa = box(bp, vec2(bs.x*.5 + .13, bs.y - G.y - .1), vec2(bs.x*.5 - G.x - .13, .1), fp);
  float decT = dec*(.75 + .35*lines(bp.y, .125, .03, fp.y, 1.));
  vec2 mp = bp - vec2(G.x + .25, G.y);
  vec2 mz = bs - vec2(G.x + .25, G.y) - vec2(G.x, G.y + .25);
  float mat = box(mp, mz*.5, mz*.5, fp);
  float sub = tiles(mp, vec2(.3, .36), vec2(.05, .1), fp);
  float bits = .8 + .35*max(lines(mp.x, .05, .008, fp.x, 0.), lines(mp.y, .072, .012, fp.y, 0.));
  return inB*(decT + sa*.75) + mat*sub*.42*bits;
}

/** an octagonal spiral inductor between radii r0 and r1, its turns a glyph thick, with its underpass */
float inductor(vec2 p, float r0, float r1, float turns, vec2 fp){
  float d8 = octa(p);
  float pitch = (r1 - r0)/turns;
  float k = (d8 - r0)/pitch - (atan(p.y, p.x)/6.2832 + .5);
  float fr = max(fp.x, fp.y);
  float on = step(r0 - .02, d8)*step(d8, r1 + .02);
  float tr = cover((fract(k) - .5)*pitch, pitch*.3, fr)*on;
  float under = box(p, vec2(-(r1 + .12)*.5, 0.), vec2((r1 + .12)*.5, .06), fp)*step(r0*.6, d8);
  return mix(.2*on, tr, 1. - smoothstep(.5, 1.1, fr/pitch)) + under*.7;
}

// --- the districts: each block its own material, so the tour changes as it goes ---

/** logic metal */
vec3 dA(int i){
  if(i == 0) return vec3(.6, .85, 1.);
  if(i == 1) return vec3(.62, .34, 1.);
  if(i == 2) return vec3(.2, .8, 1.);
  if(i == 3) return vec3(.36, .72, .8);
  if(i == 4) return vec3(.22, .9, .6);
  if(i == 5) return vec3(.65, .82, 1.);
  if(i == 6) return vec3(.5, .72, .9);
  if(i == 7) return vec3(.38, .5, 1.);
  if(i == 8) return vec3(.3, 1., .55);
  if(i == 9) return COPPER;
  // the sea of gates: muted and calm, the rest between the districts
  return vec3(.16, .48, .55);
}
/** arrays (and the SerDes's coils) */
vec3 dB(int i){
  if(i == 1) return vec3(.82, .58, 1.);
  if(i == 3) return COPPER;
  if(i == 5 || i == 6) return vec3(.45, .62, 1.);
  if(i == 8) return vec3(.7, 1., .8);
  return vec3(.42, .62, .95);
}
/** top metal: violet, the identity enclave's shield emerald */
vec3 dT(int i){ return i == 8 ? vec3(.3, 1., .5) : VIO; }
/** a heat map's warmth, orange to yellow-white */
vec3 heatCol(float h){ return mix(vec3(1., .42, .08), vec3(1., .8, .45), smoothstep(.45, 1., h)); }

/**
 * A district from afar: its big parts (NPU cores, SRAM banks, CPU cores, packet engines) as lit
 * tiles with dark streets between, so the whole package reads as a map of clear forms. The PLL and
 * the sea of gates have none: they stay calm.
 */
float bigForm(int i, vec2 p, vec2 sz, vec2 fp){
  vec2 n;
  if(i == 1) n = vec2(4., 2.);
  else if(i == 5) n = vec2(3., 3.);
  else if(i == 6) n = vec2(2., 3.);
  else if(i == 2) n = vec2(3., 2.);
  else if(i == 7) n = vec2(8., 2.);
  else if(i == 4) n = vec2(2., 3.);
  else if(i == 0) n = vec2(3., 2.);
  else if(i == 3) n = vec2(2., 5.);
  else if(i == 8) n = vec2(2., 2.);
  else return 0.;
  vec2 P = sz/n;
  vec2 tp = p - clamp(floor(p/P), vec2(0.), n - 1.)*P;
  const vec2 g = vec2(.14, .24);
  return box(tp, P*.5, P*.5 - g, fp)*.32 + frame2(tp, P*.5, P*.5 - g, vec2(.12, .2), fp)*.75;
}

/** the SOC: a monitor core inside nested guard rings, a bus out to two rows of docking pads for the reserve defenders */
Art socArt(vec2 p, vec2 sz, vec2 fp){
  Art a = none();
  vec2 d = p - sz*.5;
  float core = box(d, vec2(0.), vec2(.14, .12), fp);
  float rings = frame2(d, vec2(0.), vec2(.34, .3), vec2(.05, .09), fp) + frame2(d, vec2(0.), vec2(.52, .46), vec2(.05, .09), fp)*.7;
  float k = clamp(floor(d.x/.3 + 5.), 0., 9.);
  vec2 dp = vec2(d.x - (k - 4.5)*.3, abs(d.y) - .9);
  float dock = box(dp, vec2(0.), vec2(.11, .12), fp)*(1. - box(dp, vec2(0.), vec2(.05, .05), fp)*.85);
  float bus = box(vec2(d.x, abs(d.y)), vec2(0., .66), vec2(1.45, .05), fp) + box(vec2(d.x, abs(d.y)), vec2(0., .58), vec2(.03, .1), fp);
  float clear = max(0., 1. - box(d, vec2(0.), vec2(.62, .56), fp) - box(vec2(d.x, abs(d.y) - .82), vec2(0.), vec2(1.55, .26), fp));
  a.m = rings*.9 + dock*.7 + bus*.6 + cells(p + 13., fp, 3., clear);
  a.acc = core*1.6 + rings*.25;
  a.top = power(fp)*clear*.6;
  return a;
}

/** the LLM core, an NPU in violet: eight cores, each a systolic grid of processing elements (towers on the core's plinth) fed by weight and activation SRAMs; activations sweep through as amber waves */
Art npuArt(vec2 p, vec2 sz, vec2 fp){
  Art a = none();
  const vec2 nc = vec2(4., 2.);
  vec2 cs = sz/nc;
  vec2 ci = clamp(floor(p/cs), vec2(0.), nc - 1.);
  vec2 cp = p - ci*cs;
  const vec2 G = vec2(.08, .12);
  float edge = frame2(cp, cs*.5, cs*.5 - G, vec2(.05, .09), fp);
  vec2 o = G + vec2(.4, .58);
  a.arr = sram(cp - G - vec2(.06, .06), vec2(cs.x - 2.*G.x - .12, .46), fp) + sram(cp - vec2(G.x + .06, o.y), vec2(.3, cs.y - o.y - G.y - .1), fp);
  vec2 gz = cs - o - G - vec2(.06, .1);
  const vec2 n = vec2(7., 3.);
  vec2 pes = gz/n;
  vec2 gp = cp - o;
  vec2 pi = clamp(floor(gp/pes), vec2(0.), n - 1.);
  vec2 pp = gp - pi*pes;
  float inG = box(gp, gz*.5, gz*.5, fp);
  float pe = box(pp, pes*.5, pes*.5 - vec2(.03, .055), fp);
  float mac = box(pp, pes*.5, vec2(.045, .07), fp);
  float hc = hash12(ci + 3.7);
  float w = fract((pi.x + pi.y*1.3)*.07 - uTime*(.3 + .2*hc) + hc);
  float act = exp(-pow((w - .5)/.07, 2.));
  a.m = inG*(pe*.42 + mac*.5) + edge*.9;
  a.am = inG*mac*act*2.4;
  return a;
}

/** the agent runtime, a CPU cluster in cyan: four cores (L1 caches, a register file, ALUs, logic) round a shared L2; each core's agent thread blinks */
Art cpuArt(vec2 p, vec2 sz, vec2 fp){
  Art a = none();
  const float l2w = 1.1;
  float mx = sz.x*.5;
  if(abs(p.x - mx) < l2w*.5){
    a.arr = sram(p - vec2(mx - l2w*.5 + .06, .08), vec2(l2w - .12, sz.y - .16), fp);
    return a;
  }
  vec2 cz = vec2(mx - l2w*.5, sz.y*.5);
  vec2 cp = vec2(p.x < mx ? p.x : sz.x - p.x, mod(p.y, cz.y));
  float ci = (p.x < mx ? 0. : 2.) + floor(p.y/cz.y);
  float edge = frame2(cp, cz*.5, cz*.5 - vec2(.05, .07), vec2(.05, .09), fp);
  a.arr = sram(cp - vec2(.14, .16), vec2(.52, .44), fp) + sram(cp - vec2(.74, .16), vec2(.52, .44), fp);
  float rf = box(cp, vec2(.68, .76), vec2(.54, .07), fp)*(.45 + .4*lines(cp.x, .1, .025, fp.x, 1.));
  vec2 at = cp - vec2(.14, .92);
  float ak = clamp(floor(at.x/.33), 0., 3.);
  vec2 ap = at - vec2(ak*.33, 0.);
  float alu = box(ap, vec2(.14, .1), vec2(.13, .1), fp)*(1. - .6*box(ap, vec2(.14, .1), vec2(.05, .03), fp));
  float used = clamp(box(cp, vec2(.68, .38), vec2(.6, .26), fp) + box(cp, vec2(.68, .76), vec2(.6, .1), fp) + box(cp, vec2(.68, 1.02), vec2(.6, .14), fp), 0., 1.);
  a.m = rf + alu*.6 + cells(p + vec2(ci*3.1, 0.), fp, 5. + ci, 1. - used) + edge*.85;
  float hb = pow(.5 + .5*sin(uTime*(1.7 + .37*ci) + ci*2.1), 6.);
  a.acc = box(cp, vec2(1.4, .38), vec2(.06, .09), fp)*(.5 + 1.8*hb);
  return a;
}

/** MCP I/O, a SerDes: six lanes of TX/RX fingers toward the die edge, and behind them the lane PLLs' two copper coils */
Art serdesArt(vec2 p, vec2 sz, vec2 fp){
  Art a = none();
  float SP = sz.y/6.;
  float li = clamp(floor(p.y/SP), 0., 5.);
  vec2 lp = vec2(p.x, p.y - li*SP);
  float bar = box(lp, vec2(.95, SP*.5), vec2(.55, SP*.5 - .1), fp);
  float teeth = bar*(.35 + .65*lines(lp.x, .1, .03, fp.x, .8));
  float drv = box(lp, vec2(.22, SP*.5), vec2(.1, SP*.5 - .1), fp);
  a.m = teeth*.8 + drv*.9;
  a.am = bar*exp(-pow(fract(p.x*.5 - uTime*1.1 + li*.37) - .5, 2.)/.006)*1.2;
  vec2 c1 = vec2(2.48, sz.y*.27), c2 = vec2(2.48, sz.y*.73);
  float fr = max(fp.x, fp.y);
  a.arr = (inductor(p - c1, .1, .5, 2.5, fp) + inductor(p - c2, .1, .5, 2.5, fp))*.95;
  a.arr += (cover(octa(p - c1) - .6, .03, fr) + cover(octa(p - c2) - .6, .03, fr))*.45;
  return a;
}

/** tools, in green: six accelerator tiles in a sea of logic, each a grid of units lighting up as it is called */
Art toolsArt(vec2 p, vec2 sz, vec2 fp){
  Art a = none();
  vec2 tp = p - vec2(.16, .18);
  const vec2 ts = vec2(1.08, .74);
  vec2 ti = clamp(floor(tp/ts), vec2(0.), vec2(1., 2.));
  vec2 lp = tp - ti*ts;
  const vec2 tc = vec2(.5, .34), th = vec2(.44, .28);
  float tM = box(lp, tc, th, fp);
  float tf = frame2(lp, tc, th, vec2(.05, .08), fp);
  float units = box(lp, tc, th - vec2(.07, .11), fp)*tiles(lp - tc + th, vec2(.2, .22), vec2(.05, .1), fp);
  float h = hash12(ti + 9.1);
  float act = pow(.5 + .5*sin(uTime*(.9 + h) + h*9.), 10.);
  a.m = tf*.9 + units*.45 + cells(p + 40., fp, 11., 1. - tM);
  a.am = units*act*1.6;
  a.top = power(fp)*(1. - tM);
  return a;
}

/** the vector DB: a terraced cache array in ice blue; a row of tiles lights amber as a lookup reads it */
Art cacheArt(vec2 p, vec2 sz, vec2 fp){
  Art a = none();
  a.arr = sram(p - vec2(.06, .08), sz - vec2(.12, .16), fp);
  float row = floor((p.y - .08)/.36);
  float bank = floor((p.x - .06)/((sz.x - .12)/3.));
  float hit = step(.94, hash12(vec2(row + bank*31., floor(uTime*2.2 + bank*.37))));
  a.am = step(.3, a.arr)*step(a.arr, .6)*hit*1.4;
  return a;
}

/** memory: a DDR PHY down the die-edge side (comb slices, bursts running along it) and terraced SRAM buffers */
Art memArt(vec2 p, vec2 sz, vec2 fp){
  Art a = none();
  const float pw = .62, SP = .4;
  float li = floor(p.y/SP);
  vec2 lp = vec2(p.x, p.y - li*SP);
  float sl = box(lp, vec2(pw*.5 + .03, SP*.5), vec2(pw*.5 - .04, SP*.5 - .1), fp);
  a.m = sl*(.4 + .5*lines(lp.x, .1, .03, fp.x, .8));
  a.am = sl*exp(-pow(fract(li*.09 - uTime*.5) - .5, 2.)/.0015)*1.4;
  a.arr = sram(p - vec2(pw + .1, .08), vec2(sz.x - pw - .16, sz.y - .16), fp);
  return a;
}

/** the gateway, in steel blue: eight packet engines with their FIFOs, a crossbar switch with packets crossing it, logic along the edge */
Art gatewayArt(vec2 p, vec2 sz, vec2 fp){
  Art a = none();
  float ew = sz.x/8.;
  float ei = clamp(floor(p.x/ew), 0., 7.);
  vec2 ep = vec2(p.x - ei*ew, p.y);
  float ef = frame2(ep, vec2(ew*.5, .56), vec2(ew*.5 - .06, .46), vec2(.05, .09), fp);
  a.arr = sram(ep - vec2(.14, .2), vec2(ew - .28, .5), fp);
  float port = box(ep, vec2(ew*.5, .87), vec2(.12, .06), fp);
  a.m = ef*.85 + port*.8;
  vec2 xp = p - vec2(.25, 1.2);
  vec2 xs = vec2(sz.x - .5, 1.62);
  float xM = box(xp, xs*.5, xs*.5, fp);
  float hl = box(vec2(xp.x, mod(xp.y, .27)), vec2(xs.x*.5, .135), vec2(xs.x*.5, .045), fp);
  float vl = box(vec2(mod(xp.x, .2), xp.y), vec2(.1, xs.y*.5), vec2(.022, xs.y*.5), fp);
  a.m += xM*(hl*.55 + vl*.3 + hl*vl*.5) + frame2(xp, xs*.5, xs*.5, vec2(.05, .09), fp)*.8;
  float row = floor(xp.y/.27);
  float pk = step(.4, hash12(vec2(row, 4.)))*exp(-pow((fract(xp.x/xs.x*1.3 - uTime*(.2 + .2*hash12(vec2(row, 5.))) + hash12(vec2(row, 6.))) - .5)/.025, 2.));
  a.am = xM*hl*pk*2.6;
  float lM = box(p, vec2(sz.x*.5, 3.12), vec2(sz.x*.5 - .1, .3), fp);
  a.m += cells(p, fp, 23., lM);
  a.top = power(fp)*lM;
  return a;
}

/** identity, a secure enclave under an emerald shield mesh (top metal), a window on the crypto core, a fuse bank holding the keys */
Art secureArt(vec2 p, vec2 sz, vec2 fp){
  Art a = none();
  vec2 cc = vec2(sz.x*.5, sz.y*.42);
  float win = box(p, cc, vec2(.5, .44), fp);
  float fpd = (fp.x + fp.y)*.7071;
  float fz = box(p, vec2(sz.x*.5, sz.y - .3), vec2(sz.x*.5 - .2, .12), fp);
  float open = max(0., 1. - win - fz);
  a.top = lines((p.x + p.y)*.7071, .17, .035, fpd, .6)*open*1.3;
  a.m = win*box(p, cc, vec2(.42, .36), fp)*tiles(p - cc, vec2(.14, .18), vec2(.05, .09), fp)*.45 + frame2(p, cc, vec2(.5, .44), vec2(.05, .09), fp)*1.1;
  a.m += fz*box(vec2(mod(p.x, .14), p.y), vec2(.07, sz.y - .3), vec2(.025, .1), fp)*1.1;
  a.acc = box(p, cc, vec2(.1, .1), fp)*(.6 + .3*sin(uTime*2.));
  return a;
}

/** a PLL: two big copper coils in their keep-outs and the VCO's capacitor bank (analog, so it looks nothing like the logic); the clock starts here */
Art pllArt(vec2 p, vec2 sz, vec2 fp){
  Art a = none();
  vec2 c1 = vec2(1.1, 1.2), c2 = vec2(2.55, 2.7);
  float fr = max(fp.x, fp.y);
  a.m = inductor(p - c1, .2, .88, 3.5, fp) + inductor(p - c2, .18, .64, 2.5, fp);
  a.m += (cover(octa(p - c1) - 1.02, .03, fr) + cover(octa(p - c2) - .78, .03, fr))*.5;
  vec2 cp = p - vec2(2.68, .62);
  float capM = box(cp, vec2(0.), vec2(.5, .38), fp);
  a.arr = capM*tiles(cp + vec2(.5, .38), vec2(.125, .19), vec2(.05, .09), fp)*.55 + frame2(cp, vec2(0.), vec2(.5, .38), vec2(.04, .08), fp)*.7;
  // each clock edge leaves the big coil with a flash
  a.acc = (cover(octa(p - c1) - 1.02, .05, fr) + inductor(p - c1, .2, .88, 3.5, fp)*.4)*exp(-uWave.x*.7)*uWave.y;
  return a;
}

/** the logic between the macros: standard-cell rows under the power mesh, with two small SRAMs */
Art logicArt(vec2 p, vec2 sz, vec2 fp, float seed){
  Art a = none();
  vec2 o2 = vec2(sz.x - 1.9, sz.y - 1.5);
  a.arr = sram(p - vec2(.25, .35), vec2(1.4, .9), fp) + sram(p - o2, vec2(1.6, 1.1), fp);
  float clear = max(0., 1. - box(p, vec2(.95, .8), vec2(.75, .5), fp) - box(p, o2 + vec2(.8, .55), vec2(.85, .6), fp));
  a.m = cells(p, fp, seed, clear);
  a.top = power(fp)*clear;
  return a;
}

Art art(int i, vec2 p, vec2 sz, vec2 fp){
  if(i == 0) return socArt(p, sz, fp);
  if(i == 1) return npuArt(p, sz, fp);
  if(i == 2) return cpuArt(p, sz, fp);
  if(i == 3) return serdesArt(p, sz, fp);
  if(i == 4) return toolsArt(p, sz, fp);
  if(i == 5) return cacheArt(p, sz, fp);
  if(i == 6) return memArt(p, sz, fp);
  if(i == 7) return gatewayArt(p, sz, fp);
  if(i == 8) return secureArt(p, sz, fp);
  if(i == 9) return pllArt(p, sz, fp);
  return logicArt(p, sz, fp, float(i));
}

/**
 * Relief, as x: 2 a tower (an NPU processing element, an SRAM bit matrix), 1 a plinth (an NPU core, an
 * SRAM bank's decoders), 0 ground; y the block. Matches the geometry npuArt and sram lay down.
 */
vec2 level(vec2 q){
  vec4 B = uBlk[1];
  if(q.x > B.x && q.x < B.z && q.y > B.y && q.y < B.w){
    vec2 cs = (B.zw - B.xy)/vec2(4., 2.);
    vec2 p = q - B.xy;
    vec2 cp = p - clamp(floor(p/cs), vec2(0.), vec2(3., 1.))*cs;
    const vec2 G = vec2(.08, .12);
    if(cp.x < G.x || cp.y < G.y || cp.x > cs.x - G.x || cp.y > cs.y - G.y) return vec2(0., 1.);
    vec2 o = G + vec2(.4, .58);
    vec2 gz = cs - o - G - vec2(.06, .1);
    vec2 gp = cp - o;
    if(gp.x < 0. || gp.y < 0. || gp.x > gz.x || gp.y > gz.y) return vec2(1., 1.);
    vec2 pes = gz/vec2(7., 3.);
    vec2 pp = mod(gp, pes);
    return vec2(pp.x > .03 && pp.x < pes.x - .03 && pp.y > .055 && pp.y < pes.y - .055 ? 2. : 1., 1.);
  }
  for(int k = 0; k < 2; k++){
    int i = k == 0 ? 5 : 6;
    B = uBlk[i];
    if(q.x > B.x && q.x < B.z && q.y > B.y && q.y < B.w){
      vec2 o = k == 0 ? vec2(.06, .08) : vec2(.72, .08);
      vec2 sz = B.zw - B.xy - (k == 0 ? vec2(.12, .16) : vec2(.78, .16));
      vec2 p = q - B.xy - o;
      if(p.x < 0. || p.y < 0. || p.x > sz.x || p.y > sz.y) return vec2(0., float(i));
      vec2 nb = max(vec2(1.), floor(sz/vec2(1.9, 1.3) + .5));
      vec2 bs = sz/nb;
      vec2 bp = p - clamp(floor(p/bs), vec2(0.), nb - 1.)*bs;
      const vec2 G = vec2(.06, .1);
      if(bp.x < G.x || bp.y < G.y || bp.x > bs.x - G.x || bp.y > bs.y - G.y) return vec2(0., float(i));
      return vec2(bp.x > G.x + .25 && bp.y < bs.y - G.y - .25 ? 2. : 1., float(i));
    }
  }
  return vec2(0., -1.);
}

/** the I/O ring: a seal ring at the edge, gold bond pads, ESD clamps and the pad traces in to the ring lane */
vec3 ioRing(vec2 q, vec2 aq, float eD, vec2 fp, vec3 metal, float gloss){
  bool ew = DX - aq.x < DZ - aq.y;
  float al = ew ? q.y : q.x;
  vec2 pf = ew ? fp.yx : fp;
  float fn = pf.y;
  vec3 col = metal*(cover(eD - .07, .03, fn) + cover(eD - .18, .022, fn)*.7)*1.3*gloss;
  if(abs(al) > (ew ? DZ : DX) - 1.25){
    // the corners: an alignment mark
    vec2 cq = vec2(DX, DZ) - aq;
    float mk = frame(cq, vec2(.72), vec2(.26), .05, fp) + box(cq, vec2(.72), vec2(.03, .2), fp) + box(cq, vec2(.72), vec2(.2, .03), fp);
    return col + GOLD*clamp(mk, 0., 1.)*1.1*gloss;
  }
  float pk = floor(al/PAD_P + .5);
  vec2 pp = vec2(al - pk*PAD_P, eD - PAD_E);
  float pad = box(pp, vec2(0.), vec2(.27), pf);
  float open = box(pp, vec2(0.), vec2(.2), pf);
  float probe = step(.6, hash12(vec2(pk, ew ? 1. : 2.)))*box(pp, vec2(.05, .02), vec2(.03, .07), pf);
  // the inner rim of each opening catches the raking light
  float lit = pp.y > 0. ? 1.4 : .75;
  col += GOLD*((pad - open)*lit + open*.45 + probe*.7)*gloss;
  // the gold glints even out of the lamp's pool, so the die's edge shows in the dark
  gEm += GOLD*(pad - open)*.07*(.6 + .4*sin(pk*2.3 + uTime*.4));
  float fing = lines(pp.x + .03, .075, .016, pf.x, .6)*box(pp, vec2(0., .5), vec2(.22, .1), pf);
  float tr = cover(pp.x, .024, pf.x)*cover(eD - 1.105, .215, fn);
  col += metal*(fing*.8 + frame(pp, vec2(0., .5), vec2(.25, .13), .022, pf)*.8)*gloss + GOLD*tr*.8*gloss;
  // the edge an enemy swarm pours in over: its pads burn red
  float edge = ew ? (q.x < 0. ? 2. : 3.) : (q.y < 0. ? 0. : 1.);
  if(uSwarm.y > .01 && abs(edge - uSwarm.x) < .5){
    float fl = .6 + .4*sin(uTime*11. + pk*1.7);
    col *= 1. - uSwarm.y*.85;
    gEm += RD*(pad*1.6 + tr*2.5 + fing*1.2)*fl*uSwarm.y;
  }
  return col;
}

/** a block's surface at q: its art in its district's colours, relief, infection rows, heat; face 0 ground, 1 the top of a raised part, 2 a wall */
vec3 blockShade(int bi, vec2 q, vec2 fp, float face, vec3 rd, float gloss, float pw){
  vec4 B = uBlk[bi];
  vec4 S = uBlkS[bi];
  vec4 E = uBlkE[bi];
  vec2 sz = B.zw - B.xy;
  vec2 p = q - B.xy;
  vec2 h = sz*.5;
  vec2 lc = p - h;
  bool xs = abs(lc.x) - h.x > abs(lc.y) - h.y;
  float bd = sdBox2(lc, h);
  float fn = xs ? fp.x : fp.y;
  float facing = dot(xs ? vec2(sign(lc.x), 0.) : vec2(0., sign(lc.y)), LDIR);
  // rows count from the side the attack came in by, so an infection spreads row by row
  float side = E.x, N = max(E.y, 1.);
  float r = side < .5 ? p.y/sz.y : side < 1.5 ? 1. - p.y/sz.y : side < 2.5 ? p.x/sz.x : 1. - p.x/sz.x;
  float ri = floor(r*N);
  float inf = 0., scrub = 0.;
  float band = side < 1.5 ? abs(lc.x) : abs(lc.y);
  if(S.x > 0. && band < INF_W){
    inf = ri < floor(S.x) ? 1. : (ri < S.x ? step(.45, hash12(vec2(ri, floor(uTime*20.)))) : 0.);
    if(ri < floor(S.y)){ inf = 0.; scrub = exp(-(S.y - ri - 1.)*.8); }
    else if(ri < S.y){ inf *= step(.5, hash12(vec2(ri + 7., floor(uTime*24.)))); scrub = 1.; }
    // infected rows tear sideways
    float jit = (hash12(vec2(ri, floor(uTime*13.))) - .5)*.35*inf*S.w;
    if(side < 1.5) p.x += jit; else p.y += jit*.6;
  }
  float heat = uHeat[bi/4][bi - (bi/4)*4]*(1. - .3*clamp(length(lc/h), 0., 1.));
  vec3 A = dA(bi);
  vec3 col, em;
  float body;
  if(face > 1.5){
    // a wall of a tower or a terrace: flat, in the district's colour, catching the light by which way it faces
    float wf = abs(rd.x) > abs(rd.z) ? -sign(rd.x)*LDIR.x : -sign(rd.z)*LDIR.y;
    col = A*(.12 + .14*max(wf, 0.))*gloss;
    body = .35;
    em = heatCol(heat)*heat*.06;
  } else {
    gMicro = vec3(0.);
#ifdef LITE
    // the light version, shown while the full one compiles: each district as its big parts only
    float big = bigForm(bi, p, sz, fp);
    body = big;
    col = A*big*gloss*1.1;
    em = CY*gClk*body*.1;
#else
    Art m = art(bi, p, sz, fp);
    body = m.m + m.arr;
    col = (A*m.m + dB(bi)*m.arr + dT(bi)*m.top*.6*(1. + 2.5*pw))*gloss*.75*(face > .5 ? 1.35 : 1.) + gMicro*gloss*1.2;
    // from afar a district becomes its big parts, lit tiles with dark streets between
    float far = smoothstep(.035, .1, fp.x);
    col = mix(col, A*bigForm(bi, p, sz, fp)*gloss*1.1, far*.85);
    em = AMD*min(m.am, 1.8)*.4 + (bi == 0 ? uMood.rgb : CY)*m.acc*.6 + dT(bi)*m.top*pw*.3 + CY*gClk*body*.1;
#endif
    // a heat map: a busy or attacked block glows warm through its structure
    em += heatCol(heat)*heat*body*.4;
    if(face < .5){
      float rim = cover(-bd - (xs ? .025 : .05), xs ? .025 : .05, fn);
      col += A*rim*(.25 + 1.2*max(facing, 0.))*gloss;
      col *= 1. - cover(-bd - .12, .1, fn)*max(-facing, 0.)*.6;
    }
  }
  vec3 red = RDD*(body*.8 + .06)*(.75 + .25*sin(uTime*37. + p.y*23.)) + vec3(1., .5, .4)*step(.94, hash12(floor(p*vec2(9., 5.)) + floor(uTime*17.)))*.4;
  col *= 1. - inf;
  em = mix(em, red, inf) + CY*scrub*(body*.9 + .06);
  gEm += em;
  return col;
}

/**
 * The stack peeled at a dive point: nested windows cut down through the layers as the lens comes in
 * (the top metal goes, then the copper routing, then the first metal) until the transistors show.
 */
bool peelArt(vec2 q, vec2 fp, out vec3 col){
  col = vec3(0.);
  if(uPeel.w < .01) return false;
  vec2 d = q - uPeel.xy;
  vec2 h = vec2(uPeel.z, uPeel.z*.7);
  vec2 h1 = h*smoothstep(.02, .4, uPeel.w), h2 = h*.7*smoothstep(.3, .65, uPeel.w), h3 = h*.42*smoothstep(.55, .9, uPeel.w);
  if(abs(d.x) > h1.x || abs(d.y) > h1.y) return false;
  const float RP = .24;
  float row = floor(q.y/RP), fy = q.y - row*RP;
  if(abs(d.x) < h3.x && abs(d.y) < h3.y) col = micro(q, fp, 7., row, fy, 1.)*.75;
  else if(abs(d.x) < h2.x && abs(d.y) < h2.y){
    float tr = lines(fy - .02, .04, .008, fp.y, .5);
    float via = step(.7, hash12(vec2(floor(q.x/.068), floor(fy/.04) + row*7.)))*box(vec2(mod(q.x, .068) - .034, mod(fy - .02, .04) - .02), vec2(0.), vec2(.008), fp);
    col = M1C*tr*.45 + vec3(1.)*via*.7;
  } else col = COPPER*(lines(q.x, .068, .013, fp.x, .5)*.45 + lines(q.y, .1, .016, fp.y, .5)*.25);
  // each window's rim: the cut edge of the layer above it, bright
  col += GOLD*frame(d, vec2(0.), h1, .012, fp)*1.3 + COPPER*frame(d, vec2(0.), h2, .01, fp)*1.3 + M1C*frame(d, vec2(0.), h3, .009, fp)*1.5;
  return true;
}

vec3 shadeDie(vec3 ro, vec3 rd, vec2 q, float tp, vec2 fp){
  vec2 aq = abs(q);
  float eD = min(DX - aq.x, DZ - aq.y);
  vec3 Rf = vec3(rd.x, -rd.y, rd.z);
  float gloss = .45 + 1.3*pow(max(dot(Rf, LSH), 0.), 4.);
  // thin-film interference: the lanes' metal shifts from teal toward blue with position and view angle
  float film = .5 + .5*sin(q.x*.29 - q.y*.41 + Rf.x*2.4 - Rf.z*1.6);
  vec3 metal = mix(vec3(.1, .52, .62), vec3(.22, .6, .88), film*.6);

  // raised districts (the NPU's towers, the SRAM terraces) are met before the ground
  vec2 qs = q, fs = fp;
  float face = 0.;
  int bi = -1;
  if(eD > 1.9){
    float t2 = (H2 - ro.y)/rd.y;
    vec2 q2 = ro.xz + rd.xz*t2;
    vec2 L2 = level(q2);
    if(L2.x > 1.5){ face = 1.; qs = q2; fs = fp*t2/tp; bi = int(L2.y); }
    else {
      float t1 = (H1 - ro.y)/rd.y;
      vec2 q1 = ro.xz + rd.xz*t1;
      vec2 L1 = level(q1);
      if(L1.x > .5){ face = L1.x > 1.5 ? 2. : 1.; qs = q1; fs = fp*t1/tp; bi = int(L1.y); }
      else {
        vec2 L0 = level(q);
        if(L0.x > .5){ face = 2.; bi = int(L0.y); }
      }
    }
  }
  gQ = qs;
  gZoom = 1. - smoothstep(.006, .014, max(fs.x, fs.y));
  // the living chip: a clock edge running out from the PLL along the metal, a power wave sweeping across
  vec2 cq = qs - PLLC;
  gClk = exp(-pow((abs(cq.x) + abs(cq.y) - uWave.x)/.35, 2.))*uWave.y;
  float pw = exp(-pow((qs.x - uWave.z)/1.3, 2.))*uWave.w;
  if(face > .5){
    gBi = bi; gBq = qs; gBf = fs; gBface = face; gBgloss = gloss; gBpw = pw;
    return vec3(0.);
  }
  vec3 pc;
  if(peelArt(q, fp, pc)) return pc*gloss;
  if(eD < 1.32) return ioRing(q, aq, eD, fp, metal, gloss)*smoothstep(-.03, .06, eD);

  // a breached block leaks red along its lanes; the crew cleaning it back is a cyan front
  float leak = 0., front = 0., lph = 0.;
  for(int j = 0; j < 2; j++){
    vec4 L = uLeak[j];
    if(L.z <= 0.) continue;
    float d = abs(q.x - L.x) + abs(q.y - L.y);
    if(d < L.z){ leak = 1.; lph = d; }
    front = max(front, exp(-pow((d - L.z)/.14, 2.))*L.w);
  }
  // the firewall's footing: a cyan line across the lanes
  if(uLineS.x > .01){
    vec2 la = uLine.xy, lb = uLine.zw - uLine.xy;
    float hh = clamp(dot(q - la, lb)/dot(lb, lb), 0., 1.);
    vec2 dl = q - la - lb*hh;
    gEm += CY*uLineS.x*cover(abs(lb.x) > abs(lb.y) ? dl.y : dl.x, abs(lb.x) > abs(lb.y) ? .05 : .03, abs(lb.x) > abs(lb.y) ? fp.y : fp.x)*1.4;
  }
  // a swarm's flood: beyond the firewall line the lanes run red with it
  float flood = 0.;
  if(uSwarm.y > .01){
    float e = uSwarm.x;
    float d = e < .5 ? uLine.y - q.y : e < 1.5 ? q.y - uLine.y : e < 2.5 ? uLine.x - q.x : q.x - uLine.x;
    flood = step(0., d)*uSwarm.y;
    if(leak < .5) lph = -d;
  }
  // red pulses running out from where it got in (or in from the edge, for a flood)
  vec3 redLine = RDD*(.8 + 1.6*smoothstep(.8, 1., fract(lph*.9 - uTime*1.8)))*(.8 + .2*sin(uTime*31.));

  // the bus lanes: shield lines, data comets on three tracks, the clock edge flashing along them
  vec3 col = vec3(0.);
  bool inLane = false;
  for(int i = 0; i < ${NSEG}; i++){
    vec4 S = uSeg[i];
    bool hz = abs(S.w - S.y) < 1e-3;
    float ac = hz ? q.y - S.y : q.x - S.x;
    if(abs(ac) > HW + .03) continue;
    float al = hz ? q.x : q.y;
    float lo = hz ? S.x : S.y, hi = hz ? S.z : S.w;
    if(al < lo - HW - .03 || al > hi + HW + .03) continue;
    inLane = true;
    float fa = hz ? fp.x : fp.y, fn = hz ? fp.y : fp.x;
    float span = cover(al - (lo + hi)*.5, (hi - lo)*.5 + HW, fa);
    float k = hz ? clamp(floor((ac + .3)/.2), 0., 2.) : clamp(floor((ac + HW)/.1), 0., 5.);
    float lc = hz ? -.2 + k*.2 : -HW + .05 + k*.1;
    float ln = hz ? cover(ac, HW - .02, fn) : cover(ac - lc, .022, fn)*step(abs(ac), HW + .02);
    float sh = hz ? cover(abs(ac) - HW + .045, .04, fn) : step(2., abs(k - 2.5))*ln;
    float trk = hz ? cover(ac - lc, .05, fn) : ln*(1. - step(2., abs(k - 2.5)));
    float hk = hash12(vec2(k, float(i)*1.7));
    float dir = mod(k, 2.) < .5 ? 1. : -1.;
    float ph = fract(al*.32 - dir*uMood.w*(.4 + .3*hk) + hk*7.);
    float dash = trk*(smoothstep(0., .012, ph)*exp(-ph*9.) + step(.5, hk)*smoothstep(.5, .512, ph)*exp(-(ph - .5)*14.)*.7);
    vec3 c = metal*((hz ? ln*.1 : ln*.2) + sh*(hz ? .22 : .25))*gloss*(1. - leak);
    vec3 e = mix(AMD*dash*1.15 + CY*gClk*(ln*.5 + sh)*1.1, redLine*ln*.7, max(leak, flood*.8)) + CY*front*(ln + .2)*2.;
    col += c*span;
    gEm += e*span;
  }
  if(inLane) return col;

  // the margin round a block: its guard ring and the bus stub of each port
  float bdist = 1e9;
  for(int i = 0; i < ${NB}; i++){
    vec4 B = uBlk[i];
    float d = sdBox2(q - (B.xy + B.zw)*.5, (B.zw - B.xy)*.5);
    if(d < bdist){ bdist = d; bi = i; }
  }
  if(bdist <= 0.){
    gBi = bi; gBq = q; gBf = fp; gBface = 0.; gBgloss = gloss; gBpw = pw;
    return vec3(0.);
  }
  vec4 B = uBlk[bi];
  vec4 S = uBlkS[bi];
  vec4 E = uBlkE[bi];
  vec2 h = (B.zw - B.xy)*.5;
  vec2 lc = q - (B.xy + B.zw)*.5;
  bool xs = abs(lc.x) - h.x > abs(lc.y) - h.y;
  float fn = xs ? fp.x : fp.y, fa = xs ? fp.y : fp.x;
  col = metal*cover(bdist - GR, .018, fn)*.35*gloss;
  if(E.w < .5) return col;
  float bad = step(.01, S.x)*step(S.y, E.y - .01);
  float g = S.z;
  float heat = uHeat[bi/4][bi - (bi/4)*4];
  vec3 rc = mix(CY*.55, RD*(.8 + .3*sin(uTime*17.)), bad);
  rc = mix(rc, heatCol(heat), heat*.6*(1. - bad)) + CY*gClk*1.2;
  rc += g > 0. ? CY*g*3.5 : RD*(-g)*3.5*(.6 + .4*sin(uTime*40.));
  // a glyph thick, so in the dark each system shows as a clean outline
  gEm += rc*cover(bdist - GR, xs ? .03 : .05, fn)*.42;
  col = vec3(0.);
  float al = xs ? lc.y : lc.x;
  float ln = lines(al - .05, .1, .02, fa, .8)*step(abs(al), HW)*step(bdist, CHG - HW + .02);
  col += metal*gloss*ln*(1. - leak);
  gEm += (redLine*leak*.7 + CY*front*2. + CY*gClk*.8)*ln;
  return col;
}

/** an HBM stack: eight DRAM dies on a base die, seams between them, data climbing the TSVs; its top a grid of banks */
vec3 hbm(vec3 P, vec3 n, float cx, float f){
  vec3 base = vec3(.45, .64, 1.);
  vec3 col;
  if(n.y > .5){
    vec2 u = vec2(P.x - cx, P.z - HBZ) + HBH;
    float inner = box(u, HBH, HBH - vec2(.12), vec2(f));
    float bank = tiles(u - vec2(.12), vec2(.94, 1.6), vec2(.1, .18), vec2(f))*inner;
    float tsv = box(u, vec2(HBH.x, HBH.y), vec2(HBH.x - .2, .12), vec2(f))*lines(u.x, .12, .025, f, .5);
    col = base*(bank*(.3 + .3*lines(u.y, .1, .016, f, .4)) + frame(u, HBH, HBH, .06, vec2(f))*1.2 + tsv*.9);
    gEm += base*frame(u, HBH, HBH, .08, vec2(f))*.15;
    float row = floor(u.y/.1);
    gEm += AMD*bank*step(.93, hash12(vec2(row + cx, floor(uTime*3. + cx))))*.7;
  } else {
    float al = abs(n.x) > .5 ? P.z - HBZ : P.x - cx;
    float half_ = abs(n.x) > .5 ? HBH.y : HBH.x;
    float y = P.y + DT;
    // eight DRAM dies on a base die: each a slab with a dark seam under it and a lip catching the light
    float ph = (HBT + DT)/9.;
    float fy = mod(y, ph);
    float slab = cover(fy - ph*.5, ph*.5 - .03, f);
    float lip = cover(fy - ph + .05, .025, f);
    float tsv = lines(al, .32, .025, f, .5)*slab;
    float edge = cover(abs(al) - half_ + .05, .05, f);
    // faces turned toward the lens side catch more of the lamp
    float wf = n.z > .5 ? .9 : .6 + .3*max(-n.x*LDIR.x, 0.);
    col = base*(slab*.12 + lip*.85 + tsv*.25 + edge*.9)*wf;
    gEm += base*(lip*.12 + edge*.14);
    float cid = floor(al/.32 + .5);
    float up = fract(y*.4 - uMood.w*.45 + hash12(vec2(cid, cx)));
    gEm += AMD*tsv*step(.55, hash12(vec2(cid, cx + 7.)))*exp(-pow(up - .5, 2.)/.003)*1.3;
  }
  return col;
}

/** the die's cut edge: dark silicon, the top edge catching the light */
vec3 dieSide(vec3 P, vec3 n, float f){
  float y = -P.y;
  float al = abs(n.x) > .5 ? P.z : P.x;
  return vec3(.1, .14, .2)*.5 + vec3(.55, .75, .9)*cover(y - .02, .02, f)*.9 + vec3(.2, .3, .4)*lines(al, .4, .012, f, .3)*.3;
}

/** the package round the die: gold bond fingers where the wires land, the interposer bus out to the HBM stacks, the substrate's edge */
vec3 package(vec2 p, vec2 fp){
  vec2 c = (PKG.xy + PKG.zw)*.5, hb = (PKG.zw - PKG.xy)*.5;
  float ed = -sdBox2(p - c, hb);
  if(ed < 0.) return vec3(0.);
  float fr = max(fp.x, fp.y);
  vec3 col = vec3(.3, .42, .55)*cover(ed - .2, .04, fr)*.6;
  vec2 a = abs(p);
  if(p.y > DZ + .6 && a.x < DX - .7){
    float k = floor(p.x/PAD_P + .5);
    float fl = 1.7 + .8*mod(abs(k), 2.);
    col += GOLD*box(vec2(p.x - k*PAD_P, p.y - DZ - fl), vec2(0.), vec2(.12, .22), fp)*.8;
  }
  if(a.x > DX + .6 && a.y < DZ - .7){
    float k = floor(p.y/PAD_P + .5);
    float fl = 1.7 + .8*mod(abs(k), 2.);
    col += GOLD*box(vec2(p.y - k*PAD_P, a.x - DX - fl), vec2(0.), vec2(.12, .22), fp.yx)*.8;
  }
  if(p.y < -DZ && p.y > HBZ + HBH.y - .3 && a.x < 10.6){
    float hx = mod(p.x + 11.2, 5.6) - 2.8;
    if(abs(hx) < HBH.x - .25){
      float k = floor(hx/.16);
      float ln = lines(hx, .16, .028, fp.x, .6);
      float dir = mod(k, 2.) < .5 ? 1. : -1.;
      float ph = fract(p.y*.55 + dir*uMood.w*.6 + hash12(vec2(k, floor(p.x/5.6))));
      col += vec3(.3, .45, .6)*ln*.45;
      gEm += AMD*ln*smoothstep(0., .02, ph)*exp(-ph*10.)*.9;
    }
  }
  return col;
}

void main(){
  vec3 ro = uEye;
  vec3 rd = camRay(lookAt(ro, uTarget));
  float ry = min(rd.y, -1e-4);
  // the die top and the package for every pixel, so their derivatives are taken in uniform control flow
  float tp = ro.y/-ry;
  vec2 q = ro.xz + rd.xz*tp;
  vec2 fp = vec2(abs(dFdx(q.x)) + abs(dFdy(q.x)), abs(dFdx(q.y)) + abs(dFdy(q.y)));
  // a macro lens's shallow depth of field: away from the focal distance fine patterns blur into their (dimmer) mean
  fp *= 1. + 1.6*abs(tp - uView.w)/uView.w;
  // from afar fine patterns settle early, so the whole package reads as clear forms rather than a texture
  fp *= 1. + .7*smoothstep(10., 26., uView.w);
  float tk = (ro.y + DT)/-ry;
  vec2 qk = ro.xz + rd.xz*tk;
  vec2 fk = vec2(abs(dFdx(qk.x)) + abs(dFdy(qk.x)), abs(dFdx(qk.y)) + abs(dFdy(qk.y)));
  // a footprint per unit of distance, for faces without derivatives
  float fpt = 2.4*uTan.y/uRes.y;
  gEm = vec3(0.);
  gMicro = vec3(0.);
  gClk = 0.;
  vec3 col = vec3(0.);
  float tHit = 1e9;
  vec2 hitXZ = vec2(0.);
  bool isH = false;
  vec3 inv = 1./rd;

  // the HBM stacks
  float th = 1e9;
  vec3 hn = vec3(0.);
  float hcx = 0.;
  for(int i = 0; i < 4; i++){
    float cx = ${HBM_X[0]!.toFixed(1)} + ${(HBM_X[1]! - HBM_X[0]!).toFixed(1)}*float(i);
    vec3 t0 = (vec3(cx - HBH.x, -DT, HBZ - HBH.y) - ro)*inv, t1 = (vec3(cx + HBH.x, HBT, HBZ + HBH.y) - ro)*inv;
    vec3 tn = min(t0, t1), tf = max(t0, t1);
    float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
    if(a < b && a > 0. && a < th){
      th = a;
      hcx = cx;
      hn = a == tn.x ? vec3(-sign(rd.x), 0., 0.) : a == tn.y ? vec3(0., -sign(rd.y), 0.) : vec3(0., 0., -sign(rd.z));
    }
  }
  // the die slab's cut edges
  float ts = 1e9;
  vec3 sn = vec3(0.);
  {
    vec3 t0 = (vec3(-DX, -DT, -DZ) - ro)*inv, t1 = (vec3(DX, 0., DZ) - ro)*inv;
    vec3 tn = min(t0, t1), tf = max(t0, t1);
    float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
    if(a < b && a > 0. && a != tn.y){
      ts = a;
      sn = a == tn.x ? vec3(-sign(rd.x), 0., 0.) : vec3(0., 0., -sign(rd.z));
    }
  }
  if(rd.y < 0. && abs(q.x) < DX && abs(q.y) < DZ && tp < th){
    tHit = tp;
    hitXZ = q;
    gBi = -1;
    col = shadeDie(ro, rd, q, tp, fp);
    if(gBi >= 0) col = blockShade(gBi, gBq, gBf, gBface, rd, gBgloss, gBpw);
  } else if(ts < th){
    tHit = ts;
    vec3 P = ro + rd*ts;
    hitXZ = P.xz;
    col = dieSide(P, sn, fpt*ts);
  } else if(th < 1e8){
    tHit = th;
    vec3 P = ro + rd*th;
    hitXZ = P.xz;
    col = hbm(P, hn, hcx, fpt*th);
    isH = true;
  } else if(rd.y < 0.){
    tHit = tk;
    hitXZ = qk;
    col = package(qk, fk);
  }
  vec3 em = gEm;
  if(tHit < 1e8){
    // the lamp's pool round the focus (it widens as the lens pulls back), and the far die falling off into the dark
    vec2 toEye = normalize(ro.xz - uView.xy + 1e-4);
    vec2 pc = hitXZ - uView.xy - toEye*uView.z*.3;
    float pool = .03 + .97*exp(-dot(pc, pc)/(uView.z*uView.z));
    // the HBM stacks stand tall enough to catch the lamp from anywhere
    if(isH) pool = max(pool, .45);
    float fall = exp(-max(tHit/uView.w - .8, 0.)*.65);
    col *= 3.5*pool*fall;
    // posterised like a die photograph's flat layers: a region of one structure keeps one glyph instead of a gradient of them
    float lum = max(dot(col, vec3(.2126, .7152, .0722)), 1e-4);
    float tq = floor((1. - exp(-lum))*7. + .25)/7.;
    col *= -log(max(1. - tq, .02))/lum;
    col += em*2.8*(.35 + .65*fall);
  }
  // an infected block: a low red phosphor over it
  for(int i = 0; i < ${NB}; i++){
    vec4 S = uBlkS[i];
    if(S.x < .01) continue;
    vec4 B = uBlk[i];
    float inf = clamp(S.x/max(uBlkE[i].y, 1.), 0., 1.)*(1. - clamp(S.y/max(uBlkE[i].y, 1.), 0., 1.));
    col += RD*.18*inf*pointGlow(ro, rd, vec3((B.x + B.z)*.5, .2, (B.y + B.w)*.5), min(.3*max(B.z - B.x, B.w - B.y), .8));
  }
  // guard rings flaring as walls of light: cyan when they stop something, red when they fail
  for(int i = 0; i < ${NB}; i++){
    float g = uBlkS[i].z;
    if(abs(g) < .02) continue;
    vec4 B = uBlk[i];
    vec2 c = (B.xy + B.zw)*.5;
    vec2 hb = (B.zw - B.xy)*.5 + GR;
    vec3 cc = g > 0. ? CY*g : RD*(-g)*(.6 + .4*sin(uTime*50.));
    for(int k = 0; k < 4; k++){
      bool xw = k < 2;
      float sg = (k == 0 || k == 2) ? -1. : 1.;
      float pl = xw ? c.x + sg*hb.x : c.y + sg*hb.y;
      float rdc = xw ? rd.x : rd.z;
      if(abs(rdc) < 1e-4) continue;
      float tw = (pl - (xw ? ro.x : ro.z))/rdc;
      if(tw < 0. || tw > tHit) continue;
      vec3 pw = ro + rd*tw;
      float al = xw ? pw.z - c.y : pw.x - c.x;
      if(abs(al) > (xw ? hb.y : hb.x) || pw.y < 0. || pw.y > .55) continue;
      float yy = 1. - pw.y/.55;
      col += cc*yy*yy*(.6 + .4*sin(al*16. + uTime*6.))*1.2;
    }
  }
  // the firewall: a low curtain where the defenders hold the line against a swarm
  if(uLineS.x > .01){
    vec2 a = uLine.xy;
    vec2 dd = uLine.zw - a;
    float ll = length(dd);
    vec2 dir = dd/ll;
    vec2 nn = vec2(-dir.y, dir.x);
    float den = dot(rd.xz, nn);
    if(abs(den) > 1e-4){
      float tw = dot(a - ro.xz, nn)/den;
      if(tw > 0. && tw < tHit){
        vec3 pw = ro + rd*tw;
        float al = dot(pw.xz - a, dir);
        if(al > 0. && al < ll && pw.y < .6){
          float yy = 1. - pw.y/.6;
          col += CY*uLineS.x*(yy*yy*(.55 + .45*sin(al*9. - uTime*5.))*.9 + exp(-pow((pw.y - .5)/.04, 2.))*.6)*smoothstep(0., 1.2, al)*smoothstep(ll, ll - 1.2, al);
        }
      }
    }
  }
  // flashes on the die: a ring where something was stopped or got in
  for(int i = 0; i < ${NFX}; i++){
    vec4 F = uFx[i];
    if(F.z < 0.) continue;
    float R = F.w*(1. - exp(-F.z*4.));
    if(tHit < 1e8){
      float d = length(ro.xz + rd.xz*tHit - F.xy);
      col += uFxC[i].rgb*(exp(-pow((d - R)/.12, 2.))*exp(-F.z*2.6)*1.4)*exp(-tHit*.03);
    }
    col += uFxC[i].rgb*pointGlow(ro, rd, vec3(F.x, .15, F.y), .18 + F.w*.1)*exp(-F.z*5.)*2.2;
  }
  // the SOC core breathes in its status colour
  col += uMood.rgb*pointGlow(ro, rd, vec3(SOCC.x, .12, SOCC.y), .22)*.6;
  // the left of the frame stays calm for the headline
  vec2 nd = ndc();
  if(uShift > .01) col *= .3 + .7*smoothstep(-1.05, -.15, nd.x);
  // a macro lens: the frame darkens away from the scene's centre, so the eye settles there
  col *= .35 + .65*smoothstep(1.35, .25, length((nd - vec2(uShift, -.05))*vec2(.8, 1.)));
  outCol(col);
}
`;

const CYAN: [number, number, number] = [0.35, 0.85, 1];
const AMBER: [number, number, number] = [1, 0.66, 0.3];
const RED: [number, number, number] = [1, 0.22, 0.14];
const WHITE: [number, number, number] = [0.9, 0.95, 1];
/** a fault packet: a deeper red, so it stays red (not pink) at the brightness it needs to stand out */
const FAULT: [number, number, number] = [1, 0.13, 0.07];
/** bond wires */
const WIRE_C: [number, number, number] = [1, 0.74, 0.32];

interface BlockDef {
  name: string;
  tag: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** a system of the AI estate (attacks go for it); the rest is fill */
  fn: boolean;
}

/**
 * The floorplan: macros in the cells between the lanes. Index = the art the shader draws.
 * The SOC sits in the middle, the NPU and the cache arrays along the far edge, I/O on the edges.
 */
const BLOCKS: BlockDef[] = [
  { name: "soc", tag: "SOC", x0: -0.42, z0: -1.12, x1: 3.12, z1: 1.42, fn: true },
  { name: "llm", tag: "LLM CORE", x0: -5.52, z0: -5.9, x1: 3.12, z1: -2.08, fn: true },
  { name: "agent", tag: "AGENT RUNTIME", x0: -5.52, z0: -1.12, x1: -1.38, z1: 1.42, fn: true },
  { name: "mcp", tag: "MCP I/O", x0: -9.9, z0: -1.12, x1: -6.48, z1: 1.42, fn: true },
  { name: "tools", tag: "TOOLS", x0: 4.08, z0: -1.12, x1: 6.52, z1: 1.42, fn: true },
  { name: "vector", tag: "VECTOR DB", x0: 4.08, z0: -5.9, x1: 9.9, z1: -2.08, fn: true },
  { name: "memory", tag: "MEMORY", x0: -9.9, z0: -5.9, x1: -6.48, z1: -2.08, fn: true },
  { name: "gateway", tag: "GATEWAY", x0: -0.42, z0: 2.38, x1: 6.52, z1: 5.9, fn: true },
  { name: "identity", tag: "IDENTITY", x0: 7.48, z0: -1.12, x1: 9.9, z1: 1.42, fn: true },
  { name: "pll", tag: "", x0: -9.9, z0: 2.38, x1: -6.48, z1: 5.9, fn: false },
  { name: "logic", tag: "", x0: -5.52, z0: 2.38, x1: -1.38, z1: 5.9, fn: false },
  { name: "logic2", tag: "", x0: 7.48, z0: 2.38, x1: 9.9, z1: 5.9, fn: false },
];
const SOC = 0;

/** The lanes, x0 z0 x1 z1 (axis-aligned). The first four are the ring, in edge order: north, south, west, east. */
const SEGS: [number, number, number, number][] = [
  [-RX, -RZ, RX, -RZ],
  [-RX, RZ, RX, RZ],
  [-RX, -RZ, -RX, RZ],
  [RX, -RZ, RX, RZ],
  [-6, -RZ, -6, RZ],
  [-0.9, -1.6, -0.9, RZ],
  [3.6, -RZ, 3.6, 1.9],
  [7, -1.6, 7, RZ],
  [-RX, -1.6, RX, -1.6],
  [-RX, 1.9, RX, 1.9],
];

/** Which system each attack type goes for (the feed's target overrides when it names one). */
const KIND_BLOCKS: Record<string, string[]> = {
  "PROMPT INJECTION": ["llm", "agent", "mcp"],
  JAILBREAK: ["llm"],
  "INFRA EXPLOIT": ["gateway", "mcp", "tools"],
  "DATA LEAK": ["memory", "vector"],
  "MODEL THEFT": ["llm"],
  "AGENT HIJACK": ["agent", "mcp", "tools"],
  "SUPPLY CHAIN": ["tools", "mcp"],
  "DATA POISONING": ["vector", "memory"],
  EVASION: ["gateway", "llm"],
  "DEEPFAKE FRAUD": ["identity"],
  "AI PHISHING": ["identity"],
  "AI MALWARE": ["gateway", "agent"],
  "AI INTRUSION": ["gateway", "agent"],
};
const TARGET_BLOCKS: Record<string, string[]> = {
  "MCP / tools": ["mcp", "tools"],
  "self-hosted LLM": ["llm"],
  "internal AI apps": ["agent", "tools"],
  employees: ["identity"],
  "the core": ["soc"],
};

/** Pads per half edge (north, south, west, east), counted out from the middle. */
const PADS_K = [13, 13, 8, 8];
/** The four swarm edges: outward normal and how far in the firewall line stands. */
const EDGES = [
  { nx: 0, nz: -1, dLine: 3.0 },
  { nx: 0, nz: 1, dLine: 3.6 },
  { nx: -1, nz: 0, dLine: 8.2 },
  { nx: 1, nz: 0, dLine: 8.2 },
];

/** The camera's journey: the whole package, then down to a district, into the gates, out again. */
const WIDE = 0;
const DISTRICT = 1;
const DIVE = 2;
const WEAVE = 3;
interface Shot {
  kind: number;
  /** focus on the die, distance, pitch, yaw */
  x: number;
  z: number;
  d: number;
  p: number;
  y: number;
  /** seconds held once there, seconds to get there */
  hold: number;
  move: number;
  /** drift of the focus and the yaw over the hold */
  dx?: number;
  dz?: number;
  dy?: number;
}
const SHOTS: Shot[] = [
  // the whole package: the die, its gold wires, the HBM stacks behind
  { kind: WIDE, x: 1.0, z: -2.6, d: 27, p: 1.0, y: 0.25, hold: 1.5, move: 4.5, dx: 0.6, dy: -0.08 },
  // low over the NPU's violet city, the HBM skyline behind it
  { kind: DISTRICT, x: -0.8, z: -4.1, d: 6.2, p: 0.52, y: -0.2, hold: 3, move: 4.5, dx: 0.8, dy: 0.08 },
  // down into the sea of gates; the metal stack peels back to the transistors
  { kind: DIVE, x: -4.02, z: 4.08, d: 0.85, p: 1.0, y: 0.05, hold: 3.5, move: 5, dy: 0.22 },
  // the SRAM terraces of the vector DB
  { kind: DISTRICT, x: 6.6, z: -3.6, d: 5.6, p: 0.6, y: 0.32, hold: 3, move: 5, dx: -0.6 },
  // round behind the HBM stacks and in through the gap between two of them, the die ahead
  { kind: WEAVE, x: 0.3, z: -5, d: 9, p: 0.13, y: 3.19, hold: 3.5, move: 5.5, dz: 2.4 },
  // the copper coils of the PLL and the SerDes
  { kind: DISTRICT, x: -7.8, z: 2.4, d: 5.8, p: 0.78, y: 0.22, hold: 2.5, move: 5.5, dz: -0.6 },
  // a second dive, into the logic by the identity enclave
  { kind: DIVE, x: 8.69, z: 4.01, d: 0.9, p: 1.0, y: -0.06, hold: 3, move: 5, dy: -0.2 },
];
/** in war the lens stands back over the east edge, where the flood comes in */
const WAR_SHOT = { x: 8.6, z: 0.2, d: 9.5, p: 0.85, y: 0 };

interface GNode {
  x: number;
  z: number;
  nb: number[];
  w: number[];
}

interface Port {
  blk: number;
  /** 0 north, 1 south, 2 west, 3 east */
  side: number;
  /** where a packet meets the guard ring */
  gx: number;
  gz: number;
  /** where the port's stub joins its lane */
  tx: number;
  tz: number;
  tap: number;
  dist: Float64Array;
  prev: Int32Array;
}

interface Path {
  x: Float32Array;
  z: Float32Array;
  cum: Float32Array;
  n: number;
  len: number;
}

/** a bond wire from a pad on the die out to its finger on the package */
interface Wire {
  px: number;
  pz: number;
  fx: number;
  fz: number;
  h: number;
}

interface Def {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 0 patrols the lanes, 1 reserve docked in the SOC */
  home: number;
  slot: number;
  /** 0 idle, 1 chase, 2 crew, 3 firewall line */
  job: number;
  virus: Virus | null;
  breach: Breach | null;
  k: number;
  lunge: number;
  lx: number;
  lz: number;
  /** patrol: from node a to node b, s along, at speed sp on lane offset off */
  a: number;
  b: number;
  s: number;
  sp: number;
  off: number;
}

interface Virus {
  ev: FeedEvent | null;
  sw: Swarm | null;
  path: Path;
  s: number;
  speed: number;
  blk: number;
  port: Port;
  t0: number;
  alive: boolean;
  chaser: Def | null;
  leaker: boolean;
  /** the bond wire it comes down (-1 none) and how far down it is */
  wire: number;
  wu: number;
  x: number;
  y: number;
  z: number;
}

interface Breach {
  blk: number;
  port: Port;
  rows: number;
  evs: FeedEvent[];
  sw: Swarm | null;
  t0: number;
  /** 0 spreading, 1 the crew cleaning the lanes back, 2 scrubbing the rows */
  phase: number;
  pt: number;
  inf: number;
  scrub: number;
  R: number;
  crew: Def[];
  /** where the crew stands on the lanes while it pushes the leak back, x z pairs */
  front: number[];
}

interface Swarm {
  ev: FeedEvent;
  e: number;
  t0: number;
  nx: number;
  nz: number;
  dLine: number;
  /** firewall slots along the line, x z pairs */
  slots: number[];
  vs: Virus[];
  defs: Def[];
  leaker: Virus | null;
  breach: Breach | null;
  lastSpawn: number;
  cleared: number;
  alive: number;
}

type CamP = { x: number; z: number; d: number; p: number; y: number };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, x: number) => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

function mkPath(pts: number[]): Path {
  const n = pts.length / 2;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const cum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = pts[i * 2]!;
    z[i] = pts[i * 2 + 1]!;
    if (i) cum[i] = cum[i - 1]! + Math.abs(x[i]! - x[i - 1]!) + Math.abs(z[i]! - z[i - 1]!);
  }
  return { x, z, cum, n, len: cum[n - 1]! };
}

function pathAt(p: Path, s: number, out: Float32Array) {
  const r = clamp(s, 0, p.len);
  let i = 1;
  while (i < p.n - 1 && p.cum[i]! < r) i++;
  const l = p.cum[i]! - p.cum[i - 1]!;
  const u = l > 1e-5 ? (r - p.cum[i - 1]!) / l : 1;
  out[0] = p.x[i - 1]! + (p.x[i]! - p.x[i - 1]!) * u;
  out[1] = p.z[i - 1]! + (p.z[i]! - p.z[i - 1]!) * u;
}

/** A point along a bond wire (s 0 at the pad, 1 at the finger): it rises steeply off the ball bond and slopes down to the stitch. */
function wireAt(w: Wire, s: number, out: Float32Array) {
  out[0] = w.px + (w.fx - w.px) * s;
  out[1] = -DT * s + w.h * Math.sin(Math.PI * Math.pow(s, 0.65));
  out[2] = w.pz + (w.fz - w.pz) * s;
}

/** The lanes as a graph: a node at every end, crossing and port tap, an edge along each lane between neighbours. */
function buildGraph(taps: [number, number][]) {
  const nodes: GNode[] = [];
  const find = (x: number, z: number, make = true) => {
    for (let i = 0; i < nodes.length; i++) if (Math.abs(nodes[i]!.x - x) < 1e-3 && Math.abs(nodes[i]!.z - z) < 1e-3) return i;
    if (!make) return -1;
    nodes.push({ x, z, nb: [], w: [] });
    return nodes.length - 1;
  };
  for (const s of SEGS) {
    find(s[0], s[1]);
    find(s[2], s[3]);
  }
  for (const h of SEGS) {
    if (h[1] !== h[3]) continue;
    for (const v of SEGS) {
      if (v[0] !== v[2]) continue;
      if (v[0] >= h[0] - 1e-3 && v[0] <= h[2] + 1e-3 && h[1] >= v[1] - 1e-3 && h[1] <= v[3] + 1e-3) find(v[0], h[1]);
    }
  }
  for (const [x, z] of taps) find(x, z);
  const onSeg = SEGS.map((s) => {
    const hz = s[1] === s[3];
    const ids: number[] = [];
    nodes.forEach((n, i) => {
      const on = hz ? Math.abs(n.z - s[1]) < 1e-3 && n.x >= s[0] - 1e-3 && n.x <= s[2] + 1e-3 : Math.abs(n.x - s[0]) < 1e-3 && n.z >= s[1] - 1e-3 && n.z <= s[3] + 1e-3;
      if (on) ids.push(i);
    });
    ids.sort((a, b) => (hz ? nodes[a]!.x - nodes[b]!.x : nodes[a]!.z - nodes[b]!.z));
    for (let k = 1; k < ids.length; k++) {
      const ia = ids[k - 1]!;
      const ib = ids[k]!;
      const a = nodes[ia]!;
      const b = nodes[ib]!;
      const w = Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
      a.nb.push(ib);
      a.w.push(w);
      b.nb.push(ia);
      b.w.push(w);
    }
    return ids;
  });
  return { nodes, onSeg, find };
}

/** Shortest routes to one node over the lane graph (it is small, so the plain O(n^2) version). */
function dijkstra(nodes: GNode[], src: number) {
  const n = nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[src] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++)
      if (!done[i] && dist[i]! < best) {
        best = dist[i]!;
        u = i;
      }
    if (u < 0) break;
    done[u] = 1;
    const nd = nodes[u]!;
    for (let k = 0; k < nd.nb.length; k++) {
      const v = nd.nb[k]!;
      const d = best + nd.w[k]!;
      if (d < dist[v]!) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  return { dist, prev };
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

type Label = { text: string; x: number; y: number; tone?: string; anchor?: "start" | "middle" | "end" };
const TONE_RANK: Record<string, number> = { hot: 3, accent: 2, cyan: 2, "": 1, dim: 1 };

/** Labels that would overlap a more important one (or a reserved box), or run off the right edge, are dropped. */
function declutter(items: Label[], width: number, reserved: [number, number, number, number][]): Label[] {
  const sorted = [...items].sort((a, b) => (TONE_RANK[b.tone ?? ""] ?? 0) - (TONE_RANK[a.tone ?? ""] ?? 0));
  const boxes = [...reserved];
  return sorted.filter((it) => {
    // plated labels: about 7.6 px a character at 12.5 px, plus their padding
    const w = it.text.length * 7.6 + 14;
    const x0 = it.anchor === "middle" ? it.x - w / 2 : it.anchor === "end" ? it.x - w : it.x;
    const box: [number, number, number, number] = [x0, it.y - 2, x0 + w, it.y + 19];
    if (box[2] > width - 6) return false;
    if (boxes.some((o) => o[0] < box[2] && box[0] < o[2] && o[1] < box[3] && box[1] < o[3])) return false;
    boxes.push(box);
    return true;
  });
}

/** how far along its lanes a breached block leaks red before the crew pushes it back */
const LEAK_R = 2.8;

const NPATROL = 36;
const NDOCK = 20;
const LINE_SLOTS = 28;
const NSPARK = 420;
/** sprites along each bond wire */
const WIRE_PTS = 14;
const DISCLOSURE = "sim · attack mix and breach odds from the last 90 days";

/**
 * Circuit world, as a journey over a living chip package: the company's AI
 * estate is a die whose blocks are its systems, each a district with its own
 * material (a violet NPU grid city for the LLM core, ice-blue SRAM terraces for
 * the vector DB and memory, copper coils for the PLL and the MCP SerDes, a cyan
 * CPU cluster for the agent runtime, a green tools block, a steel gateway, an
 * emerald-shielded identity enclave, a calm sea of gates between), ringed in
 * gold bond pads whose wires arc out to the package, with HBM stacks rising
 * beyond the far edge. The lens travels on one continuous path: the whole
 * package, down low over a district, into the sea of gates where the metal
 * stack peels up to show the fins and gates, back out and along the HBM
 * stacks. A clock edge runs out from the PLL every few seconds, a power wave
 * sweeps the mesh and busy or attacked blocks glow warm. Attacks from the
 * 90-day feed, paced by the wave director, slide down a bond wire as red fault
 * packets and run the lanes to the block their type goes for: cyan defenders
 * leave their patrol to catch some (intercepted), a guard ring flares and
 * stops others (blocked), and at the type's real harm rate one gets in: the
 * block goes red row by row, red leaks out along its lanes, and a crew cleans
 * the lanes back and scrubs the rows to cyan. In each war phase a flood pours
 * down the east wires onto a firewall line of defenders across the lanes.
 */
export function circuitWorld(o: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const director = new WaveDirector(o.intel, 97);
  // the scene's own dice, so the feed's sequence never depends on frame timing
  const rnd = mulberry(4097);
  const pts = new Pts(3600);
  const byName = new Map(BLOCKS.map((b, i) => [b.name, i]));

  // ports at the middle of each side of the systems, and the lane graph through their taps
  const ports: Port[][] = BLOCKS.map(() => []);
  const taps: [number, number][] = [];
  BLOCKS.forEach((b, i) => {
    if (!b.fn) return;
    const mx = (b.x0 + b.x1) / 2;
    const mz = (b.z0 + b.z1) / 2;
    const sides: [number, number, number, number][] = [
      [mx, b.z0 - GR, mx, b.z0 - CHG],
      [mx, b.z1 + GR, mx, b.z1 + CHG],
      [b.x0 - GR, mz, b.x0 - CHG, mz],
      [b.x1 + GR, mz, b.x1 + CHG, mz],
    ];
    sides.forEach(([gx, gz, tx, tz], side) => {
      taps.push([tx, tz]);
      ports[i]!.push({ blk: i, side, gx, gz, tx, tz, tap: -1, dist: new Float64Array(0), prev: new Int32Array(0) });
    });
  });
  const G = buildGraph(taps);
  for (const list of ports)
    for (const p of list) {
      p.tap = G.find(p.tx, p.tz, false);
      const r = dijkstra(G.nodes, Math.max(0, p.tap));
      p.dist = r.dist;
      p.prev = r.prev;
    }
  const rows = BLOCKS.map((b) => [b.z1 - b.z0, b.x1 - b.x0].map((l) => clamp(Math.round(l / 0.3), 8, 26)));

  const padAt = (e: number, k: number): [number, number] => (e < 2 ? [k * PAD_P, (e === 0 ? -1 : 1) * (DZ - PAD_E)] : [(e === 2 ? -1 : 1) * (DX - PAD_E), k * PAD_P]);
  const dockAt = (slot: number): [number, number] => [SOCC[0] + ((slot % 10) - 4.5) * 0.3, SOCC[1] + (slot < 10 ? -0.9 : 0.9)];

  // bond wires off the south, west and east pads (the north edge feeds the HBM stacks through the interposer)
  const wires: Wire[] = [];
  const wireOf: number[][] = [[], [], [], []];
  for (const e of [1, 2, 3]) {
    const K = PADS_K[e]!;
    const [nx, nz] = e === 1 ? [0, 1] : e === 2 ? [-1, 0] : [1, 0];
    for (let k = -K; k <= K; k++) {
      const [px, pz] = padAt(e, k);
      const far = Math.abs(k) % 2;
      const out = PAD_E + 1.7 + 0.8 * far;
      wireOf[e]![k + K] = wires.length;
      wires.push({ px, pz, fx: px + nx * out, fz: pz + nz * out, h: 0.5 + 0.25 * far + 0.05 * Math.sin(k * 1.7) });
    }
  }

  // shader data
  const uBlk = new Float32Array(NB * 4);
  const uBlkS = new Float32Array(NB * 4);
  const uBlkE = new Float32Array(NB * 4);
  const uSeg = new Float32Array(NSEG * 4);
  const uLeak = new Float32Array(8);
  const uFx = new Float32Array(NFX * 4);
  const uFxC = new Float32Array(NFX * 4);
  const uHeat = new Float32Array(12);
  BLOCKS.forEach((b, i) => {
    uBlk.set([b.x0, b.z0, b.x1, b.z1], i * 4);
    uBlkE.set([0, rows[i]![0]!, 0, b.fn ? 1 : 0], i * 4);
  });
  SEGS.forEach((s, i) => uSeg.set(s, i * 4));

  const fx: { x: number; z: number; t0: number; size: number; c: readonly number[] }[] = [];
  const flash = (x: number, z: number, t: number, c: readonly number[], size: number) => {
    fx.push({ x, z, t0: t, size, c });
    if (fx.length > NFX) fx.shift();
  };
  const guardT = new Float32Array(NB).fill(-9);
  const failT = new Float32Array(NB).fill(-9);
  const heat = new Float32Array(NB);
  const tmp = new Float32Array(2);
  const tmp3 = new Float32Array(3);

  // the defenders: a patrol riding the lanes, and a reserve docked in the SOC
  const defs: Def[] = [];
  for (let i = 0; i < NPATROL + NDOCK; i++) {
    const home = i < NPATROL ? 0 : 1;
    const d: Def = { x: 0, y: 0.14, z: 0, vx: 0, vy: 0, vz: 0, home, slot: home ? i - NPATROL : i, job: 0, virus: null, breach: null, k: 0, lunge: -9, lx: 0, lz: 0, a: 0, b: 0, s: 0, sp: 0.9 + rnd() * 0.7, off: LANES[Math.floor(rnd() * LANES.length)]! };
    if (home === 0) {
      d.a = Math.floor(rnd() * G.nodes.length);
      const nb = G.nodes[d.a]!.nb;
      d.b = nb[Math.floor(rnd() * nb.length)] ?? d.a;
      d.s = rnd() * 2;
    } else {
      const [x, z] = dockAt(d.slot);
      d.x = x;
      d.z = z;
      d.y = 0.08;
    }
    defs.push(d);
  }
  const patrolPos = (d: Def, out: Float32Array) => {
    const a = G.nodes[d.a]!;
    const b = G.nodes[d.b]!;
    const L = Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
    const u = L > 1e-4 ? clamp(d.s / L, 0, 1) : 0;
    out[0] = a.x + (b.x - a.x) * u + d.off;
    out[1] = a.z + (b.z - a.z) * u + d.off;
  };
  const advancePatrol = (d: Def, dt: number) => {
    d.s += d.sp * dt;
    for (let guard = 0; guard < 4; guard++) {
      const a = G.nodes[d.a]!;
      const b = G.nodes[d.b]!;
      const L = Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
      if (d.s < L) break;
      d.s -= L;
      // on to a random neighbour, not straight back unless it is a dead end
      let next = d.a;
      for (let k = 0; k < 4; k++) {
        const c = b.nb[Math.floor(rnd() * b.nb.length)];
        if (c !== undefined && (c !== d.a || b.nb.length === 1)) {
          next = c;
          break;
        }
      }
      d.a = d.b;
      d.b = next;
    }
  };
  for (const d of defs)
    if (d.home === 0) {
      patrolPos(d, tmp);
      d.x = tmp[0]!;
      d.z = tmp[1]!;
    }

  let viruses: Virus[] = [];
  const breachOf: (Breach | null)[] = BLOCKS.map(() => null);
  let swarms: Swarm[] = [];
  const sp = new Float32Array(NSPARK * 8);
  let nsp = 0;
  const spark = (x: number, y: number, z: number, n: number, c: readonly number[], speed: number) => {
    for (let k = 0; k < n; k++) {
      if (nsp >= NSPARK) return;
      const a = rnd() * Math.PI * 2;
      const v = speed * (0.4 + rnd() * 0.8);
      const o = nsp * 8;
      sp[o] = x;
      sp[o + 1] = y;
      sp[o + 2] = z;
      sp[o + 3] = Math.cos(a) * v;
      sp[o + 4] = 0.8 + rnd() * 1.8;
      sp[o + 5] = Math.sin(a) * v;
      sp[o + 6] = 0.4 + rnd() * 0.45;
      sp[o + 7] = c === RED ? 1 : c === AMBER ? 2 : c === WHITE ? 3 : 0;
      nsp++;
    }
  };
  const SPARK_C = [CYAN, RED, AMBER, WHITE];

  let cam: Cam = { eye: [0, 20, 22], target: [0, 0, 0] };
  /** the journey: the shot being flown to (or held), when its move began, where it began from */
  let shotI = 0;
  let shotT0 = -SHOTS[0]!.move;
  let from: CamP = { ...SHOTS[0]! };
  let to: CamP = { ...SHOTS[0]! };
  let warW = 0;
  /** the camera as it stands this frame: focus, distance */
  const view = { x: 0, z: 0, d: 30 };
  /** where the metal stack peels, and how far open */
  const peel = { x: 0, z: 0, open: 0 };
  let flow = 0;
  let simT = -1;
  let narrow = false;
  /** the newest single attack, whose type rides it for a moment */
  let newest: Virus | null = null;

  const blockFor = (ev: FeedEvent) => {
    const names = TARGET_BLOCKS[ev.target] ?? KIND_BLOCKS[ev.kind];
    if (!names) return 1 + Math.floor(rnd() * 8);
    return byName.get(names[Math.floor(rnd() * names.length)]!) ?? 1;
  };

  /** the cheapest way from a pad to a port: its cost and the ring node to leave the pad's tap by */
  const entry = (e: number, k: number, port: Port) => {
    const [px, pz] = padAt(e, k);
    const hz = e < 2;
    const tv = hz ? px : pz;
    const ids = G.onSeg[e]!;
    let a = ids[0]!;
    let b = ids[ids.length - 1]!;
    for (const i of ids) if ((hz ? G.nodes[i]!.x : G.nodes[i]!.z) <= tv + 1e-6) a = i;
    for (let j = ids.length - 1; j >= 0; j--) if ((hz ? G.nodes[ids[j]!]!.x : G.nodes[ids[j]!]!.z) >= tv - 1e-6) b = ids[j]!;
    const ca = Math.abs(tv - (hz ? G.nodes[a]!.x : G.nodes[a]!.z)) + port.dist[a]!;
    const cb = Math.abs(tv - (hz ? G.nodes[b]!.x : G.nodes[b]!.z)) + port.dist[b]!;
    return ca <= cb ? { node: a, cost: ca } : { node: b, cost: cb };
  };

  /** pad -> its trace -> the ring lane -> lanes to the port's tap -> the stub to the guard ring, all on one lane line */
  const buildPath = (e: number, k: number, port: Port, node: number, off: number): Path => {
    const [px, pz] = padAt(e, k);
    const out = [px, pz];
    if (e < 2) out.push(px, (e === 0 ? -RZ : RZ) + off);
    else out.push((e === 2 ? -RX : RX) + off, pz);
    let n = node;
    for (let guard = 0; guard < 80 && n >= 0; guard++) {
      out.push(G.nodes[n]!.x + off, G.nodes[n]!.z + off);
      if (n === port.tap) break;
      n = port.prev[n]!;
    }
    if (port.side < 2) out.push(port.gx + off, port.gz);
    else out.push(port.gx, port.gz + off);
    return mkPath(out);
  };

  const inView = (x: number, z: number, f: FrameInfo) => {
    const p = projectPoint([x, 0, z], cam, f);
    if (!p) return false;
    return f.narrow ? p.x > 10 && p.x < f.width - 10 && p.y > 10 && p.y < f.height - 10 : p.x > f.width * 0.47 && p.x < f.width - 12 && p.y > 12 && p.y < f.height - 12;
  };

  /** idle defenders nearest a point, from the given homes in order of preference */
  const take = (n: number, x: number, z: number, homes: number[]) => {
    const out: Def[] = [];
    for (const h of homes) {
      if (out.length >= n) break;
      const free = defs.filter((d) => d.job === 0 && d.home === h).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
      for (const d of free) {
        if (out.length >= n) break;
        out.push(d);
      }
    }
    return out;
  };
  const release = (d: Def) => {
    d.job = 0;
    d.virus = null;
    d.breach = null;
  };

  const startBreach = (blk: number, port: Port, ev: FeedEvent | null, sw: Swarm | null, t: number) => {
    const old = breachOf[blk];
    if (old) {
      // hit again while it is still infected: the hit joins the same clean-up
      if (ev) old.evs.push(ev);
      return old;
    }
    const n = rows[blk]![port.side < 2 ? 0 : 1]!;
    const b: Breach = { blk, port, rows: n, evs: ev ? [ev] : [], sw, t0: t, phase: 0, pt: t, inf: 0, scrub: 0, R: 0, crew: [], front: [] };
    breachOf[blk] = b;
    uBlkE[blk * 4] = port.side;
    uBlkE[blk * 4 + 1] = n;
    return b;
  };

  const spawnAttack = (ev: FeedEvent, t: number) => {
    // while a swarm holds the stage, two blocks are being cleaned or the lanes are busy, single attacks are
    // left out (all of them, whatever their fate, so the share of breaches on screen stays the real one)
    if (swarms.some((s) => s.cleared < 0) || breachOf.filter(Boolean).length >= 2 || viruses.filter((v) => !v.sw).length >= 6) return;
    const blk = blockFor(ev);
    // in down a bond wire (south, west or east), among the pads with short routes to the block
    const cands: { e: number; k: number; port: Port; node: number; cost: number }[] = [];
    let best = Infinity;
    for (let e = 1; e < 4; e++)
      for (let k = -PADS_K[e]!; k <= PADS_K[e]!; k++) {
        let c: (typeof cands)[number] | null = null;
        for (const port of ports[blk]!) {
          const r = entry(e, k, port);
          if (!c || r.cost < c.cost) c = { e, k, port, node: r.node, cost: r.cost };
        }
        if (c && Number.isFinite(c.cost)) {
          cands.push(c);
          best = Math.min(best, c.cost);
        }
      }
    // of the pads with reasonable routes, the ones whose route runs closest under the lens (the target stays the feed's)
    const off = LANES[Math.floor(rnd() * LANES.length)]!;
    const near = cands
      .filter((c) => c.cost < best + 9)
      .map((c) => {
        const path = buildPath(c.e, c.k, c.port, c.node, off);
        let dmin = Infinity;
        for (let s = 0; s <= path.len; s += 0.5) {
          pathAt(path, s, tmp);
          dmin = Math.min(dmin, Math.hypot(tmp[0]! - view.x - 0.4, tmp[1]! - view.z));
        }
        return { c, path, d: dmin + rnd() * 0.8 };
      })
      .sort((a, b) => a.d - b.d);
    const pick = near[Math.floor(rnd() * Math.min(3, near.length))];
    if (!pick) return;
    const path = pick.path;
    const wire = wireOf[pick.c.e]![pick.c.k + PADS_K[pick.c.e]!] ?? -1;
    const v: Virus = { ev, sw: null, path, s: 0, speed: 1.7 + rnd() * 0.6, blk, port: pick.c.port, t0: t, alive: true, chaser: null, leaker: false, wire, wu: 0, x: path.x[0]!, y: 0.06, z: path.z[0]! };
    viruses.push(v);
    newest = v;
  };

  const spawnSwarm = (ev: FeedEvent, size: number, t: number, f: FrameInfo) => {
    // the edge whose firewall line the camera sees best, and that is nearest where it is looking
    let e = 0;
    let bestS = -Infinity;
    EDGES.forEach((E, i) => {
      const hz = E.nx === 0;
      let s = 0;
      for (let k = 0; k <= 6; k++) {
        const al = -1 + k / 3;
        const x = hz ? al * RX : E.nx * E.dLine;
        const z = hz ? E.nz * E.dLine : al * RZ;
        if (inView(x, z, f)) s += 2;
      }
      s -= 0.25 * Math.hypot(E.nx * E.dLine - view.x, E.nz * E.dLine - view.z);
      // the east edge reads best: the flood pours down its wires and in from the right of the frame along the
      // lanes, onto a line running into depth; the near edge is behind the lens and the west one under the headline
      s += E.nx > 0 ? 8 : E.nz < 0 ? 2 : -8;
      if (s > bestS) {
        bestS = s;
        e = i;
      }
    });
    const E = EDGES[e]!;
    const hz = E.nx === 0;
    // the line's slots: four on every lane that crosses it, the rest spread between
    const slots: number[] = [];
    const lanesX: number[] = [];
    for (const s of SEGS) {
      if (hz && s[0] === s[2] && s[1] <= E.nz * E.dLine && s[3] >= E.nz * E.dLine) lanesX.push(s[0]);
      if (!hz && s[1] === s[3] && s[0] <= E.nx * E.dLine && s[2] >= E.nx * E.dLine) lanesX.push(s[1]);
    }
    const at = (al: number) => (hz ? slots.push(al, E.nz * E.dLine) : slots.push(E.nx * E.dLine, al));
    for (const l of lanesX) for (const off of [-0.2, -0.07, 0.07, 0.2]) at(l + off);
    const span = hz ? RX : RZ;
    const rest = Math.max(0, LINE_SLOTS - slots.length / 2);
    for (let k = 0; k < rest; k++) at(-span + 0.8 + ((k + 0.5) / rest) * (2 * span - 1.6));
    const sw: Swarm = { ev, e, t0: t, nx: E.nx, nz: E.nz, dLine: E.dLine, slots, vs: [], defs: [], leaker: null, breach: null, lastSpawn: t, cleared: -1, alive: 0 };
    // targets: the systems it can only reach through the line, likelier the nearer they are
    const allowed = ports.map((list) => list.filter((p) => p.gx * E.nx + p.gz * E.nz < E.dLine - 0.3));
    const targets = BLOCKS.map((b, i) => i).filter((i) => allowed[i]!.length > 0 && i !== SOC);
    const n = Math.min(size, narrow ? 45 : 90);
    for (let k = 0; k < n; k++) {
      let blk = targets[Math.floor(rnd() * targets.length)]!;
      const alt = targets[Math.floor(rnd() * targets.length)]!;
      const dot = (i: number) => ((BLOCKS[i]!.x0 + BLOCKS[i]!.x1) / 2) * E.nx + ((BLOCKS[i]!.z0 + BLOCKS[i]!.z1) / 2) * E.nz;
      if (dot(alt) > dot(blk)) blk = alt;
      const pk = Math.floor((rnd() * 2 - 1) * PADS_K[e]!);
      let c: { port: Port; node: number; cost: number } | null = null;
      for (const port of allowed[blk]!) {
        const r = entry(e, pk, port);
        if (!c || r.cost < c.cost) c = { port, node: r.node, cost: r.cost };
      }
      if (!c || !Number.isFinite(c.cost)) continue;
      const path = buildPath(e, pk, c.port, c.node, LANES[Math.floor(rnd() * LANES.length)]!);
      const t0 = t + 0.5 + (k / n) * 3.4 + rnd() * 0.3;
      const wire = wireOf[e]![pk + PADS_K[e]!] ?? -1;
      const v: Virus = { ev: null, sw, path, s: 0, speed: 1.5 + rnd() * 0.6, blk, port: c.port, t0, alive: true, chaser: null, leaker: false, wire, wu: 0, x: path.x[0]!, y: 0.06, z: path.z[0]! };
      sw.vs.push(v);
      viruses.push(v);
      sw.lastSpawn = Math.max(sw.lastSpawn, t0);
    }
    // at the type's real harm rate one gets through the line
    if (ev.fate === "breach" && sw.vs.length) {
      const v = sw.vs[sw.vs.length - 1]!;
      v.leaker = true;
      v.t0 = t + 4.2;
      v.speed = 2.1;
      sw.leaker = v;
    }
    sw.alive = sw.vs.length - (sw.leaker ? 1 : 0);
    sw.defs = take(slots.length / 2, (E.nx * E.dLine + SOCC[0]) / 2, (E.nz * E.dLine + SOCC[1]) / 2, [1, 0]);
    sw.defs.forEach((d, k) => {
      d.job = 3;
      d.k = k;
    });
    swarms.push(sw);
  };

  const steer = (d: Def, x: number, y: number, z: number, vmax: number, dt: number) => {
    const dx = x - d.x;
    const dy = y - d.y;
    const dz = z - d.z;
    const dist = Math.hypot(dx, dy, dz);
    const s = dist > 1e-4 ? Math.min(vmax, dist * 4.5) / dist : 0;
    const k = Math.min(1, dt * 6);
    d.vx += (dx * s - d.vx) * k;
    d.vy += (dy * s - d.vy) * k;
    d.vz += (dz * s - d.vz) * k;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.z += d.vz * dt;
  };

  const killVirus = (v: Virus, t: number, c: readonly number[]) => {
    v.alive = false;
    spark(v.x, 0.08, v.z, 10, c, 1.8);
    spark(v.x, 0.08, v.z, 5, RED, 1.3);
    if (v.chaser) {
      release(v.chaser);
      v.chaser = null;
    }
    if (v.sw) v.sw.alive--;
    else flash(v.x, v.z, t, c, 0.7);
  };

  /** points on the lanes at lane distance R from a port's tap: where the crew stands to push a leak back */
  const frontPts = (x: number, z: number, R: number, out: number[]) => {
    out.length = 0;
    for (const s of SEGS) {
      const hz = s[1] === s[3];
      const across = hz ? Math.abs(s[1] - z) : Math.abs(s[0] - x);
      const left = R - across;
      if (left < 0) continue;
      for (let sg = -1; sg <= 1; sg += 2) {
        const al = (hz ? x : z) + sg * left;
        if (al < (hz ? s[0] : s[1]) || al > (hz ? s[2] : s[3])) continue;
        out.push(hz ? al : s[0], hz ? s[1] : al);
        if (left < 1e-3) break;
      }
    }
  };

  /** where a shot points once arrived: a district shot goes to a breached block if there is one */
  const resolve = (s: Shot): CamP => {
    const out: CamP = { x: s.x, z: s.z, d: s.d, p: s.p, y: s.y };
    if (s.kind === DISTRICT) {
      let b: Breach | null = null;
      for (const x of breachOf) if (x && (!b || x.t0 > b.t0)) b = x;
      if (b) {
        const bl = BLOCKS[b.blk]!;
        out.x = (bl.x0 + bl.x1) / 2;
        out.z = (bl.z0 + bl.z1) / 2;
      }
    }
    return out;
  };
  /** a shot as it stands u (0..1) through its hold: drifting slowly */
  const held = (s: Shot, p: CamP, u: number): CamP => {
    const e = smooth(0, 1, u);
    return { x: p.x + (s.dx ?? 0) * e, z: p.z + (s.dz ?? 0) * e, d: p.d, p: p.p, y: p.y + (s.dy ?? 0) * e };
  };

  const updateCamera = (t: number, dt: number) => {
    let s = SHOTS[shotI]!;
    if (t - shotT0 > s.move + s.hold) {
      // on to the next shot, from where the last one's hold left the lens
      from = held(s, to, 1);
      shotI = (shotI + 1) % SHOTS.length;
      s = SHOTS[shotI]!;
      to = resolve(s);
      shotT0 = t;
    }
    const prev = SHOTS[(shotI + SHOTS.length - 1) % SHOTS.length]!;
    const u = (t - shotT0) / s.move;
    let j: CamP;
    if (u >= 1) j = held(s, to, (t - shotT0 - s.move) / s.hold);
    else {
      // going in, the lens travels first and drops late; going out, it lifts first; a long move climbs on the way
      const goingIn = to.d < from.d;
      const ef = goingIn ? smooth(0, 0.7, u) : smooth(0.3, 1, u);
      const ed = goingIn ? smooth(0.3, 1, u) : smooth(0, 0.7, u);
      const ea = smooth(0, 1, u);
      const travel = Math.hypot(to.x - from.x, to.z - from.z);
      const bump = 0.55 * clamp(travel / (2.2 * Math.min(from.d, to.d)), 0, 1.3);
      j = {
        x: from.x + (to.x - from.x) * ef,
        z: from.z + (to.z - from.z) * ef,
        d: Math.exp(Math.log(from.d) + (Math.log(to.d) - Math.log(from.d)) * ed + bump * Math.sin(Math.PI * u)),
        // the lens arcs up and over on the way, clear of the stacks
        p: from.p + (to.p - from.p) * ea + 0.35 * Math.sin(Math.PI * u),
        y: from.y + (to.y - from.y) * ea,
      };
    }
    // a war takes the lens over the edge the flood comes in by
    const war = swarms.some((x) => x.cleared < 0);
    warW += ((war ? 1 : 0) - warW) * (1 - Math.exp(-dt / 1.2));
    const w = smooth(0, 1, warW);
    const W = WAR_SHOT;
    const x = j.x + (W.x - j.x) * w;
    const z = j.z + (W.z - j.z) * w;
    let d = Math.exp(Math.log(j.d) + (Math.log(W.d) - Math.log(j.d)) * w);
    const pitch = j.p + (W.p - j.p) * w;
    const yaw = j.y + (W.y - j.y) * w;
    // a phone's band is short: the lens stands further off
    if (narrow) d *= 1.3;
    view.x = x;
    view.z = z;
    view.d = d;
    const c = Math.cos(pitch) * d;
    cam = { eye: [x + Math.sin(yaw) * c, Math.max(0.25, Math.sin(pitch) * d), z + Math.cos(yaw) * c], target: [x, 0, z] };
    // the stack peels open as the lens comes down on a dive point
    const dive = s.kind === DIVE ? s : prev.kind === DIVE ? prev : null;
    if (dive) {
      peel.x = dive.x;
      peel.z = dive.z;
    }
    peel.open = dive ? smooth(2.4, 1.15, d) * (1 - w) : 0;
  };

  /** one step of the world: camera, attacks, breaches, swarms, defenders, heat, sparks */
  const step = (t: number, dt: number, f: FrameInfo) => {
    const level = director.level(t);
    updateCamera(t, dt);
    const wave = director.tick(t);
    for (const ev of wave.attacks) spawnAttack(ev, t);
    if (wave.swarm) spawnSwarm(wave.swarm.ev, wave.swarm.size, t, f);
    flow += dt * (1 + 0.8 * level);

    // packets
    for (const v of viruses) {
      if (!v.alive || t < v.t0) continue;
      if (v.wire >= 0 && v.wu < 1) {
        // down the bond wire onto its pad
        v.wu = Math.min(1, v.wu + dt / (v.sw ? 0.7 : 0.9));
        wireAt(wires[v.wire]!, 1 - v.wu, tmp3);
        v.x = tmp3[0]!;
        v.y = tmp3[1]! + 0.04;
        v.z = tmp3[2]!;
        continue;
      }
      v.y = 0.06;
      v.s += v.speed * dt;
      pathAt(v.path, v.s, tmp);
      v.x = tmp[0]!;
      v.z = tmp[1]!;
      const u = v.s / v.path.len;
      if (v.ev && v.ev.fate === "intercepted") {
        // a patrol leaves the lanes to hunt the ones the feed says were intercepted
        if (!v.chaser && u > 0.15) {
          const d = take(1, v.x, v.z, [0, 1])[0];
          if (d) {
            d.job = 1;
            d.virus = v;
            v.chaser = d;
          }
        }
        if (v.chaser && (Math.hypot(v.chaser.x - v.x, v.chaser.z - v.z) < 0.22 || u > 0.94)) {
          killVirus(v, t, CYAN);
          continue;
        }
      }
      if (v.sw && !v.leaker && v.x * v.sw.nx + v.z * v.sw.nz < v.sw.dLine) {
        // the firewall line: the nearest defender lunges and it is gone
        const sw = v.sw;
        let bk = 0;
        let bd = Infinity;
        for (let k = 0; k < sw.defs.length; k++) {
          const dd = Math.abs(sw.slots[k * 2]! - v.x) + Math.abs(sw.slots[k * 2 + 1]! - v.z);
          if (dd < bd) {
            bd = dd;
            bk = k;
          }
        }
        const d = sw.defs[bk];
        if (d) {
          d.lunge = t;
          d.lx = v.x;
          d.lz = v.z;
        }
        killVirus(v, t, CYAN);
        continue;
      }
      if (u >= 1) {
        v.alive = false;
        if (v.sw && !v.leaker) {
          v.sw.alive--;
          guardT[v.blk] = t;
          continue;
        }
        if (v.ev && v.ev.fate !== "breach") {
          guardT[v.blk] = t;
          flash(v.x, v.z, t, CYAN, 0.9);
          spark(v.x, 0.12, v.z, 12, WHITE, 2);
          if (v.chaser) release(v.chaser);
        } else {
          failT[v.blk] = t;
          flash(v.x, v.z, t, RED, 1.1);
          spark(v.x, 0.15, v.z, 16, RED, 2.2);
          const b = startBreach(v.blk, v.port, v.ev, v.sw, t);
          if (v.sw) v.sw.breach = b;
        }
      }
    }
    viruses = viruses.filter((v) => v.alive);

    // breaches: spread row by row and out along the lanes, the lanes cleaned back, the rows scrubbed
    for (let bi = 0; bi < NB; bi++) {
      const b = breachOf[bi];
      if (!b) continue;
      const bl = BLOCKS[bi]!;
      const cx = (bl.x0 + bl.x1) / 2;
      const cz = (bl.z0 + bl.z1) / 2;
      const tb = t - b.t0;
      b.inf = Math.min(b.rows, b.inf + (dt * b.rows) / 1.9);
      if (b.crew.length === 0 && tb > 0.5) {
        b.crew = take(8, cx, cz, [1, 0]);
        b.crew.forEach((d, k) => {
          d.job = 2;
          d.breach = b;
          d.k = k;
        });
      }
      if (b.phase === 0) {
        if (tb > 0.4) b.R = Math.min(LEAK_R, b.R + 1.8 * dt);
        if (tb > 3.0) {
          b.phase = 1;
          b.pt = t;
        }
      } else if (b.phase === 1) {
        const u = (t - b.pt) / 1.5;
        b.R = LEAK_R * Math.max(0, 1 - u);
        frontPts(b.port.tx, b.port.tz, b.R, b.front);
        if (u >= 1) {
          b.R = 0;
          b.phase = 2;
          b.pt = t;
        }
      } else {
        b.scrub = Math.min(b.rows, b.scrub + (dt * b.rows) / 2.2);
        if (b.scrub >= b.rows) {
          flash(cx, cz, t, CYAN, 2);
          spark(cx, 0.3, cz, 18, CYAN, 2.2);
          for (const d of b.crew) release(d);
          breachOf[bi] = null;
        }
      }
    }

    // swarms
    for (const sw of swarms) {
      if (sw.cleared < 0 && sw.alive <= 0 && t > sw.lastSpawn) sw.cleared = t;
      if (sw.cleared > 0 && t - sw.cleared > 1.4 && sw.defs.length) {
        for (const d of sw.defs) release(d);
        sw.defs = [];
      }
    }
    swarms = swarms.filter((sw) => {
      const leakDone = !sw.leaker || (!sw.leaker.alive && (!sw.breach || breachOf[sw.breach.blk] !== sw.breach));
      return !(sw.cleared > 0 && leakDone && sw.defs.length === 0);
    });

    // heat: the NPU, the agents and the caches run hot in bursts of work; an attack inbound warms its target, a breach burns
    const burst = (w: number, ph: number, k: number) => Math.pow(0.5 + 0.5 * Math.sin(t * w + ph), k);
    for (let i = 0; i < NB; i++) {
      let target = 0.06;
      if (i === 1) target = 0.2 + 0.65 * burst(0.42, 0, 5);
      else if (i === 2) target = 0.15 + 0.45 * burst(0.61, 1.3, 6);
      else if (i === 5) target = 0.1 + 0.5 * burst(0.33, 2.1, 7);
      else if (i === 7) target = 0.1 + 0.35 * burst(0.5, 4, 6);
      else if (i === 4) target = 0.08 + 0.35 * burst(0.71, 5, 6);
      const b = breachOf[i];
      if (b) target = b.phase < 2 ? 1 : 0.6;
      heat[i] = target;
    }
    for (const v of viruses) if (v.alive && !v.sw && t >= v.t0) heat[v.blk] = Math.min(1, heat[v.blk]! + 0.25);
    for (let i = 0; i < NB; i++) uHeat[i] = uHeat[i]! + (heat[i]! - uHeat[i]!) * (1 - Math.exp(-dt / 0.9));

    // defenders
    for (const d of defs) {
      if (d.job === 1 && d.virus) {
        const v = d.virus;
        steer(d, v.x, 0.1, v.z, 6.5, dt);
      } else if (d.job === 2 && d.breach) {
        const b = d.breach;
        const bl = BLOCKS[b.blk]!;
        const n = Math.max(1, b.crew.length);
        if (b.phase === 1) {
          const m = b.front.length / 2;
          if (m) {
            const j = d.k % m;
            steer(d, b.front[j * 2]! + (d.k >= m ? 0.12 : 0), 0.16, b.front[j * 2 + 1]! + (d.k >= m ? 0.12 : 0), 7, dt);
          }
        } else if (b.phase === 2) {
          // a line across the infected band at the scrub front, moving row by row
          const fr = b.scrub / b.rows;
          const side = b.port.side;
          const al = (d.k + 0.5) / n;
          const ax0 = Math.max(bl.x0, (bl.x0 + bl.x1) / 2 - INF_W);
          const ax1 = Math.min(bl.x1, (bl.x0 + bl.x1) / 2 + INF_W);
          const az0 = Math.max(bl.z0, (bl.z0 + bl.z1) / 2 - INF_W);
          const az1 = Math.min(bl.z1, (bl.z0 + bl.z1) / 2 + INF_W);
          const x = side < 2 ? ax0 + al * (ax1 - ax0) : side === 2 ? bl.x0 + fr * (bl.x1 - bl.x0) : bl.x1 - fr * (bl.x1 - bl.x0);
          const z = side < 2 ? (side === 0 ? bl.z0 + fr * (bl.z1 - bl.z0) : bl.z1 - fr * (bl.z1 - bl.z0)) : az0 + al * (az1 - az0);
          steer(d, x, 0.25, z, 7, dt);
        } else {
          const a = t * 1.5 + (d.k / n) * Math.PI * 2;
          const rx = (bl.x1 - bl.x0) / 2 + 0.5;
          const rz = (bl.z1 - bl.z0) / 2 + 0.5;
          steer(d, (bl.x0 + bl.x1) / 2 + Math.cos(a) * rx, 0.45 + 0.08 * Math.sin(t * 3 + d.k), (bl.z0 + bl.z1) / 2 + Math.sin(a) * rz, 7, dt);
        }
      } else if (d.job === 3) {
        const sw = swarms.find((s) => s.defs.includes(d));
        if (sw) {
          let x = sw.slots[d.k * 2]!;
          let z = sw.slots[d.k * 2 + 1]!;
          let y = 0.22 + 0.05 * Math.sin(t * 4 + d.k);
          if (t - d.lunge < 0.2) {
            x = d.lx;
            z = d.lz;
            y = 0.08;
          }
          steer(d, x, y, z, 9, dt);
        } else release(d);
      } else {
        if (d.job !== 0) release(d);
        if (d.home === 0) {
          advancePatrol(d, dt * (1 + 0.3 * level));
          patrolPos(d, tmp);
          steer(d, tmp[0]!, 0.13 + 0.03 * Math.sin(t * 2 + d.slot), tmp[1]!, 4.5, dt);
        } else {
          const [x, z] = dockAt(d.slot);
          steer(d, x, 0.08, z, 5, dt);
        }
      }
    }

    // sparks
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
      if (sp[o + 1]! < 0.02) {
        sp[o + 1] = 0.02;
        sp[o + 4] = -sp[o + 4]! * 0.35;
        sp[o + 3]! *= 0.6;
        sp[o + 5]! *= 0.6;
      }
    }
  };

  return {
    frag: FRAG,
    fovY: 34,
    // its full shader takes seconds to compile on Direct3D: a light variant (no fine district art) shows first
    lite: true,
    shift: 0.4,
    frame(f, set) {
      const t = f.t;
      narrow = f.narrow;
      if (simT < 0) {
        // the first frame catches the world up to the start time, so a still frame shows it mid-flow
        simT = 0;
        updateCamera(0, 0);
        while (simT + 1 / 30 < t) {
          simT += 1 / 30;
          step(simT, 1 / 30, f);
        }
      }
      step(t, Math.min(0.05, Math.max(0, f.dt)), f);
      simT = t;
      const level = director.level(t);

      // points: sprites scale with the view, so the swarm and the defenders stay legible from the whole package down to the gates
      pts.n = 0;
      const big = (f.narrow ? 1.6 : 1) * clamp(view.d / 7, 0.35, 2.4);
      for (const w of wires)
        for (let k = 0; k < WIRE_PTS; k++) {
          wireAt(w, (k + 0.5) / WIRE_PTS, tmp3);
          pts.add(tmp3[0]!, tmp3[1]!, tmp3[2]!, 0.022 * big, WIRE_C, 0.9);
        }
      for (const d of defs) {
        const docked = d.home === 1 && d.job === 0;
        // docked ones rest dim; the firewall line is many abreast, so each is a little softer
        const k = docked ? 0.55 : d.job === 3 ? 0.7 : 1;
        pts.add(d.x, d.y, d.z, 0.085 * big, CYAN, 4.5 * k);
        if (docked) continue;
        pts.add(d.x - d.vx * 0.03, d.y - d.vy * 0.03, d.z - d.vz * 0.03, 0.04 * big, CYAN, 1.1);
        pts.add(d.x - d.vx * 0.06, d.y - d.vy * 0.06, d.z - d.vz * 0.06, 0.033 * big, CYAN, 0.5);
      }
      for (const v of viruses) {
        if (t < v.t0) continue;
        pts.add(v.x, v.y, v.z, 0.11 * big, FAULT, 4.4 + 0.8 * Math.sin(t * 23 + v.s * 7));
        const trail = v.sw ? 5 : 10;
        if (v.wire >= 0 && v.wu < 1) {
          for (let k = 1; k <= trail; k++) {
            const s = 1 - v.wu + k * 0.045;
            if (s > 1) break;
            wireAt(wires[v.wire]!, s, tmp3);
            pts.add(tmp3[0]!, tmp3[1]! + 0.04, tmp3[2]!, 0.055 * big, FAULT, 2.2 * (1 - k / (trail + 1)));
          }
          continue;
        }
        for (let k = 1; k <= trail; k++) {
          const s = v.s - k * 0.11;
          if (s < 0) break;
          pathAt(v.path, s, tmp);
          pts.add(tmp[0]!, 0.04, tmp[1]!, 0.055 * big, FAULT, 2.2 * (1 - k / (trail + 1)));
        }
      }
      for (let i = 0; i < nsp; i++) {
        const o = i * 8;
        pts.add(sp[o]!, sp[o + 1]!, sp[o + 2]!, 0.03 * big, SPARK_C[sp[o + 7]!]!, 3 * Math.min(1, sp[o + 6]! * 2.5));
      }

      // uniforms
      uLeak.fill(0);
      let nl = 0;
      for (let i = 0; i < NB; i++) {
        const b = breachOf[i];
        const g = Math.max(0, 1 - (t - guardT[i]!) / 0.8);
        const r = Math.max(0, 1 - (t - failT[i]!) / 1.2);
        uBlkS[i * 4] = b ? Math.max(0.001, b.phase === 0 ? b.inf : b.rows) : 0;
        uBlkS[i * 4 + 1] = b ? b.scrub : 0;
        uBlkS[i * 4 + 2] = r > g ? -r : g;
        uBlkS[i * 4 + 3] = b ? (b.phase === 2 ? 0.5 : 1) : 0;
        if (b && b.R > 0.01 && nl < 2) {
          uLeak.set([b.port.tx, b.port.tz, b.R, b.phase === 1 ? 1 : 0], nl * 4);
          nl++;
        }
      }
      uFx.fill(-1);
      uFxC.fill(0);
      fx.forEach((e, i) => {
        const age = t - e.t0;
        if (age > 1.8) return;
        uFx.set([e.x, e.z, age, e.size], i * 4);
        uFxC.set([e.c[0]!, e.c[1]!, e.c[2]!, 0], i * 4);
      });
      let swarmGlow = 0;
      let swarmEdge = 0;
      let lineS = 0;
      let line: [number, number, number, number] = [0, 0, 0, 0];
      for (const sw of swarms) {
        swarmGlow = Math.max(swarmGlow, Math.min(1, (t - sw.t0) / 0.6) * (t < sw.lastSpawn + 0.8 ? 1 : Math.max(0, 1 - (t - sw.lastSpawn - 0.8) / 1.5)));
        swarmEdge = sw.e;
        let ready = 0;
        sw.defs.forEach((d, k) => {
          if (Math.hypot(d.x - sw.slots[k * 2]!, d.z - sw.slots[k * 2 + 1]!) < 0.6) ready++;
        });
        const fade = sw.cleared > 0 ? Math.max(0, 1 - (t - sw.cleared) / 1.4) : 1;
        lineS = Math.max(lineS, (sw.defs.length ? ready / sw.defs.length : 0) * fade);
        const hz = sw.nx === 0;
        line = hz ? [-RX, sw.nz * sw.dLine, RX, sw.nz * sw.dLine] : [sw.nx * sw.dLine, -RZ, sw.nx * sw.dLine, RZ];
      }
      // the SOC's status light: cyan when calm, amber at war (red stays for attacks)
      const hm = Math.min(0.5, level * 1.15);
      const soc: [number, number, number] = [0.35 + 1.3 * hm, 0.85 - 0.38 * hm, 1 - 1.4 * hm];
      // the clock edge leaves the PLL every few seconds and runs out across the die; a power wave sweeps it now and then
      const clk = (t % 2.8) / 2.8;
      const pwr = (t % 11) / 6.5;

      setCam(set, cam);
      set.v4v("uBlk", uBlk);
      set.v4v("uBlkS", uBlkS);
      set.v4v("uBlkE", uBlkE);
      set.v4v("uSeg", uSeg);
      set.v4v("uLeak", uLeak);
      set.v4v("uFx", uFx);
      set.v4v("uFxC", uFxC);
      set.v4v("uHeat", uHeat);
      set.v4("uWave", clk * 32, 0.9, -14 + 28 * Math.min(pwr, 1), pwr < 1 ? 1 : 0);
      set.v4("uPeel", peel.x, peel.z, 0.42, peel.open);
      set.v4("uSwarm", swarmEdge, swarmGlow, 0, 0);
      set.v4("uLine", line[0], line[1], line[2], line[3]);
      set.v4("uLineS", lineS, 0, 0, 0);
      set.v4("uMood", soc[0], soc[1], soc[2], flow);
      set.v4("uView", view.x, view.z, 0.42 * view.d + 0.3, Math.hypot(cam.eye[0] - cam.target[0], cam.eye[1], cam.eye[2] - cam.target[2]));
      set.points(pts.data, pts.n, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      const out: Label[] = [];
      // the system names on the blocks in the lamp's light, while the lens is at district or package scale
      if (view.d > 2.5) {
        const tags: (Label & { z: number })[] = [];
        const reach = Math.max(4.2, 0.45 * view.d);
        BLOCKS.forEach((b, i) => {
          if (!b.fn) return;
          const p = projectPoint([(b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2], cam, f);
          if (!p || p.x < f.width * 0.56 || p.x > f.width - 40 || p.y < 24 || p.y > f.height - 44) return;
          if (Math.hypot((b.x0 + b.x1) / 2 - view.x, (b.z0 + b.z1) / 2 - view.z) > reach) return;
          const br = breachOf[i];
          // the names sit on a dark plate in bright cyan (red while the block is breached), so they read over the die
          tags.push({ text: br && br.phase === 0 ? `${b.tag} · BREACH` : b.tag, x: p.x, y: p.y - 9, tone: br && br.phase === 0 ? "hot" : "cyan", anchor: "middle", z: p.z });
        });
        tags.sort((a, b) => a.z - b.z);
        out.push(...tags.slice(0, 4));
        // the type of an attack rides it for a moment (all the way in when the feed says it gets through)
        for (const v of viruses) {
          if (!v.ev || f.t < v.t0) continue;
          const bad = v.ev.fate === "breach";
          if (!bad && (v !== newest || f.t - v.t0 > 2.4)) continue;
          const p = projectPoint([v.x, v.y, v.z], cam, f);
          if (p && p.x > f.width * 0.5 && p.y > 20 && p.y < f.height - 44) out.push({ text: v.ev.kind, x: p.x, y: p.y - 24, tone: bad ? "hot" : "", anchor: "middle" });
        }
      }
      const x0 = f.width - 16 - DISCLOSURE.length * 7.1 - 6;
      const kept = declutter(out, f.width, [[x0, f.height - 17, f.width, f.height]]);
      kept.push({ text: DISCLOSURE, x: f.width - 16, y: f.height - 16, tone: "dim", anchor: "end" });
      return kept;
    },
  };
}
