import type { ThreatIntel } from "@/lib/threatIntel";
import { projectPoint, type Cam, type GlyphController, type V3 } from "../engine";
import { threatFeed, type FeedEvent } from "../feed";
import { AMBER, CYAN, Flashes, KIT_GLSL, PointBuf, RED, setCam, swayCam, v3, WHITE, type Emit } from "./kit";

const LAYERS = 6;
/** no bolts in this scene: the attacks are tokens */
const NONE = new Float32Array(12);
const GUARD = 3;
const Y0 = -1.3;
const DY = 0.52;
const TOKENS = 8;
const COL = 0.42;
const HALF_X = 1.95;
const HALF_Z = 0.85;

const FRAG =
  KIT_GLSL +
  `
uniform float uGuardHot;
uniform float uOutHot;
const int LAYERS = ${LAYERS};
const int GUARD = ${GUARD};

void main(){
  vec3 ro = uEye;
  vec3 rd = camRay(lookAt(ro, uTarget));
  vec3 col = starfield(.003)*.4;
  // the stack: translucent layers with token columns, the guard layer in amber
  for(int i = 0; i < LAYERS; i++){
    float y = ${Y0.toFixed(2)} + float(i)*${DY.toFixed(2)};
    if(abs(rd.y) < 1e-4) continue;
    float t = (y - ro.y)/rd.y;
    if(t < 0.) continue;
    vec3 p = ro + rd*t;
    vec2 e = vec2(${HALF_X.toFixed(2)} - abs(p.x), ${HALF_Z.toFixed(2)} - abs(p.z));
    if(e.x < 0. || e.y < 0.) continue;
    float border = exp(-min(e.x, e.y)/.03);
    float colLine = exp(-pow((fract(p.x/${COL.toFixed(2)} + .5) - .5)*${COL.toFixed(2)}/.012, 2.));
    float rowLine = exp(-pow((fract(p.z/${COL.toFixed(2)} + .5) - .5)*${COL.toFixed(2)}/.01, 2.));
    bool guard = i == GUARD;
    vec3 c = guard ? vec3(1., .66, .3) : vec3(.25, .6, 1.);
    float k = .07 + colLine*.26 + rowLine*.11 + border*.65;
    if(guard) k *= 1.3 + uGuardHot*1.5;
    if(i == LAYERS - 1) c = mix(c, vec3(1., .25, .15), uOutHot);
    col += c*k*exp(-t*.04);
  }
  col += flashes(ro, rd);
  outCol(col);
}
`;

interface Row {
  t0: number;
  /** stable attention weights for this row */
  seed: number;
  /** index of the injected token, -1 for a clean row */
  bad: number;
  ev?: FeedEvent;
  ejected: number;
  resolved: boolean;
}

const RISE = 7; // seconds from input to output

/**
 * Transformer in flight: rows of tokens rise through a stack of attention
 * layers, attention beams arcing between them at every layer. Attacks from the
 * 90-day feed ride in as an injected token: the amber guard layer flags and
 * ejects most of them, and at the type's real harm rate one slips through and
 * lights the output red.
 */
export function transformerFlight({ intel, emit }: { intel: ThreatIntel; emit?: Emit }): GlyphController {
  const feed = threatFeed(intel, 83);
  const rnd = feed.rnd;
  const flashes = new Flashes();
  const pts = new PointBuf(2200);
  let rows: Row[] = [];
  let nextRow = 0;
  let nextAttack = 3;
  let guardHot = -9;
  let outHot = -9;
  let cam: Cam = swayCam(0, [0, 0.1, 0], 6.3, 1.6);
  const layerY = (i: number) => Y0 + i * DY;
  const colX = (j: number) => (j - (TOKENS - 1) / 2) * COL;
  /** a cheap stable hash for attention weights */
  const w = (seed: number, l: number, a: number, b: number) => {
    const x = Math.sin(seed * 12.9898 + l * 78.233 + a * 37.719 + b * 11.131) * 43758.5453;
    return x - Math.floor(x);
  };

  return {
    frag: FRAG,
    fovY: 38,
    // a little left of the other scenes, so the layer labels on the right fit
    shift: 0.3,
    frame(f, set) {
      const t = f.t;
      cam = swayCam(t, [0, 0.1, 0], 6.3, 1.6, 0.45, 0.12, 0.04);
      if (t > nextRow) {
        let bad = -1;
        let ev: FeedEvent | undefined;
        if (t > nextAttack) {
          ev = feed.next();
          bad = Math.floor(rnd() * TOKENS);
          emit?.(ev, false);
          nextAttack = t + 6.5 + rnd() * 2.5;
        }
        rows.push({ t0: t, seed: rnd() * 100, bad, ev, ejected: -1, resolved: false });
        nextRow = t + 2.6;
      }
      rows = rows.filter((r) => t - r.t0 < RISE + 0.6);

      pts.reset();
      for (const r of rows) {
        const age = t - r.t0;
        const y = layerY(0) - 0.45 + (age / RISE) * (layerY(LAYERS - 1) - layerY(0) + 0.9);
        // the guard layer flags the injected token: ejected, or (a real-harm breach) let through
        if (r.ev && !r.resolved && y >= layerY(GUARD)) {
          if (r.ev.fate === "breach") {
            if (y >= layerY(LAYERS - 1)) {
              outHot = t;
              flashes.add([colX(r.bad), layerY(LAYERS - 1), 0], t, [1, 0.3, 0.2], 0.35);
              emit?.(r.ev, true, "BREACH · REACHED OUTPUT");
              r.resolved = true;
            }
          } else if (r.ejected < 0) {
            r.ejected = t;
            guardHot = t;
            flashes.add([colX(r.bad), layerY(GUARD), 0], t, [1, 0.7, 0.35], 0.28);
            emit?.(r.ev, true, "FILTERED AT LAYER 4");
            r.resolved = true;
          }
        }
        const fade = Math.min(1, age / 0.5) * Math.min(1, (RISE + 0.6 - age) / 0.6);
        for (let j = 0; j < TOKENS; j++) {
          let p: V3 = [colX(j), y, 0];
          const isBad = j === r.bad;
          if (isBad && r.ejected >= 0) {
            // thrown out sideways from the guard layer
            const e = t - r.ejected;
            p = [colX(j) + e * 0.25, layerY(GUARD) + e * 0.05, e * 1.4];
            if (e > 1.6) continue;
          }
          const col = isBad ? RED : y > layerY(LAYERS - 1) ? AMBER : CYAN;
          pts.add(p, isBad ? 0.06 : 0.05, col, (isBad ? 4 + Math.sin(t * 16) : 2.3) * fade);
          // a flagged token gets a ring
          if (isBad && r.ejected >= 0 && t - r.ejected < 1.2) {
            for (let k = 0; k < 12; k++) {
              const a = (k / 12) * Math.PI * 2;
              pts.add(v3.add(p, [Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0]), 0.02, AMBER, 2);
            }
          }
        }
        // attention: as the row crosses a layer, each token looks back at the two it weighs most
        for (let l = 0; l < LAYERS; l++) {
          const d = Math.abs(y - layerY(l));
          if (d > 0.22) continue;
          const glow = (1 - d / 0.22) * fade;
          for (let j = 1; j < TOKENS; j++) {
            const ranked = Array.from({ length: j }, (_, k) => ({ k, s: w(r.seed, l, j, k) })).sort((a, b) => b.s - a.s).slice(0, 2);
            for (const { k, s } of ranked) {
              const a: V3 = [colX(j), y, 0];
              const b: V3 = [colX(k), y, 0];
              const h = 0.12 + 0.06 * (j - k);
              const steps = 6 + (j - k) * 3;
              for (let q = 1; q < steps; q++) {
                const u = q / steps;
                const pnt: V3 = [a[0] + (b[0] - a[0]) * u, y + Math.sin(u * Math.PI) * h, 0.0];
                const hot = j === r.bad || k === r.bad;
                pts.add(pnt, 0.018, hot ? RED : WHITE, (0.5 + s * 0.9) * glow);
              }
            }
          }
        }
      }
      setCam(set, cam);
      set.f("uGuardHot", Math.max(0, 1 - (t - guardHot) / 0.8));
      set.f("uOutHot", Math.max(0, 1 - (t - outHot) / 1.6));
      set.v4v("uAtkT", NONE);
      set.v4v("uAtkH", NONE);
      flashes.pack(t, set);
      set.points(pts.data, pts.n, cam);
    },
    labels(f) {
      if (f.narrow) return [];
      const out: { text: string; x: number; y: number; tone?: string; anchor?: "start" | "middle" | "end" }[] = [];
      for (let l = 0; l < LAYERS; l++) {
        // on the right, clear of the headline
        const s = projectPoint([HALF_X + 0.1, layerY(l), HALF_Z], cam, f);
        if (s) out.push({ text: l === GUARD ? "layer 4 · guard" : `layer ${l + 1}`, x: s.x + 6, y: s.y - 7, tone: l === GUARD ? "accent" : "dim", anchor: "start" });
      }
      const inp = projectPoint([0, layerY(0) - 0.6, 0], cam, f);
      if (inp) out.push({ text: "input tokens", x: inp.x, y: inp.y, tone: "dim", anchor: "middle" });
      const outp = projectPoint([0, layerY(LAYERS - 1) + 0.55, 0], cam, f);
      if (outp) out.push({ text: "output", x: outp.x, y: outp.y - 14, tone: "dim", anchor: "middle" });
      return out;
    },
  };
}
