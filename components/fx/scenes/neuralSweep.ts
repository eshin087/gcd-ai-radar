import type { AsciiScene, FieldBuffers } from "../AsciiField";

/** Palette slots used by this scene. */
export const SWEEP_TONES = { structure: 0, lit: 1, hot: 2, faint: 3 } as const;

const TAU = Math.PI * 2;
const c = (s: string) => s.charCodeAt(0);
const G = {
  dot: c("."),
  mid: c("·"),
  dash: c("-"),
  pipe: c("|"),
  slash: c("/"),
  back: c("\\"),
  o: c("o"),
  O: c("O"),
  at: c("@"),
  plus: c("+"),
  star: c("*"),
  lpar: c("("),
  rpar: c(")"),
  under: c("_"),
};

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

interface Node {
  x: number;
  y: number;
  /** bearing from the radar origin */
  th: number;
  links: number[];
}
interface Link {
  a: number;
  b: number;
  len: number;
}

/** Slope glyph for a link direction in screen space (y down). */
function slopeGlyph(dx: number, dy: number): number {
  let a = Math.atan2(dy, dx);
  if (a < 0) a += Math.PI;
  if (a < Math.PI / 8 || a > (7 * Math.PI) / 8) return G.dash;
  if (a < (3 * Math.PI) / 8) return G.back;
  if (a < (5 * Math.PI) / 8) return G.pipe;
  return G.slash;
}

/**
 * "Neural sweep": a constellation of neural-network nodes and links with a
 * radar at its centre. The beam lights nodes as it passes; each lit node fires
 * signals along its links; pulse rings breathe out of the origin as ( ( · ) ).
 * Pointer proximity wakes nearby nodes.
 */
export function neuralSweep({ origin = [0.68, 0.52], seed = 7, period = 7 }: { origin?: [number, number]; seed?: number; period?: number } = {}): AsciiScene {
  let OX = 0;
  let OY = 0;
  let R = 0; // outer range ring
  let FAR = 0; // farthest corner
  let nodes: Node[] = [];
  let links: Link[] = [];
  // per-cell geometry
  let theta = new Float32Array(0);
  let radius = new Float32Array(0);
  let linkOf = new Int32Array(0);
  let linkT = new Float32Array(0);
  let linkG = new Uint16Array(0);
  let nodeOf = new Int16Array(0);
  let ring = new Uint8Array(0);
  let dust = new Float32Array(0); // 0 = none, else twinkle phase
  let originCell = -1;

  const omega = TAU / period;
  const speed = 260; // px/s for fired signals

  return {
    resize(b: FieldBuffers, w: number, h: number) {
      OX = w * origin[0];
      OY = h * origin[1];
      R = Math.min(h * 0.92, w * 0.5);
      FAR = Math.max(Math.hypot(OX, OY), Math.hypot(w - OX, OY), Math.hypot(OX, h - OY), Math.hypot(w - OX, h - OY));
      const rnd = mulberry32(seed);

      // nodes: dart throwing, denser near the radar, sparse under the headline (left)
      nodes = [];
      const minD = Math.max(48, Math.min(w, h) * 0.095);
      for (let tries = 0; tries < 2400 && nodes.length < 54; tries++) {
        const x = w * (0.03 + rnd() * 0.94);
        const y = h * (0.07 + rnd() * 0.86);
        const d = Math.hypot(x - OX, y - OY);
        let p = 0.3 + 0.7 * Math.exp(-(d * d) / (2 * (w * 0.32) ** 2));
        if (x < w * 0.42) p *= 0.35;
        if (rnd() > p) continue;
        if (d < 26) continue;
        if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < minD)) continue;
        nodes.push({ x, y, th: Math.atan2(y - OY, x - OX), links: [] });
      }
      // links: two nearest neighbours plus the odd long axon
      links = [];
      const seen = new Set<string>();
      const add = (a: number, bb: number) => {
        const k = a < bb ? `${a}-${bb}` : `${bb}-${a}`;
        if (seen.has(k) || a === bb) return;
        seen.add(k);
        const len = Math.hypot(nodes[a]!.x - nodes[bb]!.x, nodes[a]!.y - nodes[bb]!.y);
        links.push({ a, b: bb, len });
        nodes[a]!.links.push(links.length - 1);
        nodes[bb]!.links.push(links.length - 1);
      };
      nodes.forEach((n, i) => {
        const near = nodes
          .map((m, j) => ({ j, d: Math.hypot(m.x - n.x, m.y - n.y) }))
          .filter((e) => e.j !== i)
          .sort((p, q) => p.d - q.d);
        near.slice(0, 2).forEach((e) => e.d < minD * 3.4 && add(i, e.j));
        if (rnd() < 0.16 && near[3] && near[3].d < minD * 5) add(i, near[3].j);
      });

      // per-cell lookups
      const { cols, rows, cw, ch } = b;
      const nCells = cols * rows;
      theta = new Float32Array(nCells);
      radius = new Float32Array(nCells);
      linkOf = new Int32Array(nCells).fill(-1);
      linkT = new Float32Array(nCells);
      linkG = new Uint16Array(nCells);
      nodeOf = new Int16Array(nCells).fill(-1);
      ring = new Uint8Array(nCells);
      dust = new Float32Array(nCells);
      const ringR = [R * 0.25, R * 0.5, R * 0.75, R];
      for (let i = 0; i < nCells; i++) {
        const cx = (i % cols) * cw + cw / 2 - OX;
        const cy = Math.floor(i / cols) * ch + ch / 2 - OY;
        theta[i] = Math.atan2(cy, cx);
        const r = Math.hypot(cx, cy);
        radius[i] = r;
        for (let k = 0; k < ringR.length; k++) if (Math.abs(r - ringR[k]!) < ch * 0.42) ring[i] = k + 1;
        if (rnd() < 0.035) dust[i] = 0.5 + rnd() * TAU;
      }
      const cellAt = (x: number, y: number) => {
        const cxi = Math.floor(x / cw);
        const cyi = Math.floor(y / ch);
        if (cxi < 0 || cyi < 0 || cxi >= cols || cyi >= rows) return -1;
        return cyi * cols + cxi;
      };
      links.forEach((l, li) => {
        const A = nodes[l.a]!;
        const B = nodes[l.b]!;
        const g = slopeGlyph(B.x - A.x, B.y - A.y);
        const steps = Math.ceil(l.len / (Math.min(cw, ch) * 0.45));
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const idx = cellAt(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t);
          if (idx < 0 || linkOf[idx]! >= 0) continue;
          linkOf[idx] = li;
          linkT[idx] = t;
          linkG[idx] = g;
        }
      });
      nodes.forEach((n, ni) => {
        const idx = cellAt(n.x, n.y);
        if (idx >= 0) nodeOf[idx] = ni;
      });
      originCell = cellAt(OX, OY);
    },

    frame(b, t, ptr) {
      const { lum, tone, glyph, cols, ch } = b;
      const n = lum.length;
      const phi = (t * omega) % TAU;
      // intro: the field opens out of the origin
      const reveal = t < 1.5 ? FAR * (1 - Math.pow(1 - t / 1.5, 3)) : Infinity;
      const since = (th: number) => {
        let d = phi - th;
        d %= TAU;
        return d < 0 ? d + TAU : d;
      };
      const glowOf = (ni: number) => {
        const nd = nodes[ni]!;
        let g = Math.exp(-since(nd.th) / 0.75);
        if (ptr.on) {
          const d = Math.hypot(ptr.x - nd.x, ptr.y - nd.y);
          if (d < 150) g = Math.max(g, 1 - d / 150);
        }
        return g;
      };
      const nodeGlow = new Float32Array(nodes.length);
      for (let i = 0; i < nodes.length; i++) nodeGlow[i] = glowOf(i);
      const pulses = [((t % 3.4) / 3.4) * R];

      for (let i = 0; i < n; i++) {
        const r = radius[i]!;
        if (r > reveal) continue;
        let L = 0;
        let T: number = SWEEP_TONES.faint;
        let Gl = 0;
        const d = since(theta[i]!);
        const wash = d < 1.2 ? Math.exp(-d / 0.3) : 0;

        // background dust and range rings
        const dp = dust[i]!;
        if (dp) {
          L = 0.045 + 0.04 * Math.sin(t * 1.6 + dp);
          Gl = G.dot;
        }
        const rg = ring[i]!;
        if (rg) {
          L = Math.max(L, (rg === 4 ? 0.14 : 0.07) + 0.3 * wash);
          Gl = rg === 4 ? G.mid : G.dot;
          T = wash > 0.35 ? SWEEP_TONES.lit : SWEEP_TONES.faint;
        }
        // sweep wash behind the beam, brighter leading edge
        if (wash > 0.06 && r < FAR) {
          const edge = d < 0.035;
          const wl = (edge ? 0.62 : 0.15 * wash) * (r < R ? 1 : 0.5);
          if (wl > L) {
            L = wl;
            // the leading edge is drawn as a crisp line pointing along the beam
            Gl = edge ? slopeGlyph(Math.cos(theta[i]!), Math.sin(theta[i]!)) : 0;
            T = edge && r < R ? SWEEP_TONES.hot : SWEEP_TONES.lit;
          }
        }
        // pulse rings: ( ( · ) )
        for (const pr of pulses) {
          if (Math.abs(r - pr) < ch * 0.38 && pr > ch) {
            const fade = 1 - pr / R;
            const pl = 0.1 + 0.45 * fade;
            if (pl > L) {
              L = pl;
              T = SWEEP_TONES.lit;
              const ct = Math.cos(theta[i]!);
              Gl = Math.abs(ct) > 0.9 ? (ct < 0 ? G.lpar : G.rpar) : G.mid;
            }
          }
        }
        // links: lit by their nodes, carrying fired signals
        const li = linkOf[i]!;
        if (li >= 0) {
          const l = links[li]!;
          const ga = nodeGlow[l.a]!;
          const gb = nodeGlow[l.b]!;
          let ll = 0.07 + 0.5 * Math.max(ga, gb);
          let lt: number = Math.max(ga, gb) > 0.35 ? SWEEP_TONES.lit : SWEEP_TONES.structure;
          let lg = linkG[i]!;
          // a signal leaves each node when the beam crosses it
          const travel = l.len / speed;
          const fromA = since(nodes[l.a]!.th) / omega; // seconds since A fired
          const fromB = since(nodes[l.b]!.th) / omega;
          const tt = linkT[i]!;
          if (fromA < travel && Math.abs(tt - fromA / travel) < 0.06) {
            ll = 1;
            lt = SWEEP_TONES.hot;
            lg = G.star;
          } else if (fromB < travel && Math.abs(1 - tt - fromB / travel) < 0.06) {
            ll = 1;
            lt = SWEEP_TONES.hot;
            lg = G.star;
          }
          if (ll > L) {
            L = ll;
            T = lt;
            Gl = lg;
          }
        }
        // nodes
        const ni = nodeOf[i]!;
        if (ni >= 0) {
          const g = nodeGlow[ni]!;
          L = 0.32 + 0.68 * g;
          T = g > 0.55 ? SWEEP_TONES.hot : g > 0.22 ? SWEEP_TONES.lit : SWEEP_TONES.structure;
          Gl = g > 0.6 ? G.at : g > 0.25 ? G.O : G.o;
        }
        // the intro front
        if (reveal !== Infinity && Math.abs(r - reveal) < ch * 0.6) {
          L = Math.max(L, 0.55);
          T = SWEEP_TONES.lit;
          Gl = 0;
        }
        if (L > 0) {
          lum[i] = Math.min(1, L);
          tone[i] = T;
          glyph[i] = Gl;
        }
      }
      // radar origin crosshair
      if (originCell >= 0) {
        const blink = 0.7 + 0.3 * Math.sin(t * 5);
        lum[originCell] = blink;
        tone[originCell] = SWEEP_TONES.hot;
        glyph[originCell] = G.plus;
        for (const [di, g] of [
          [-1, G.dash],
          [1, G.dash],
          [-cols, G.pipe],
          [cols, G.pipe],
        ] as const) {
          const k = originCell + di;
          if (k >= 0 && k < n) {
            lum[k] = Math.max(lum[k]!, 0.45);
            tone[k] = SWEEP_TONES.lit;
            glyph[k] = g;
          }
        }
      }
    },
  };
}
