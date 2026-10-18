import type { AsciiScene, FieldBuffers } from "../AsciiField";

/** Palette slots used by this scene. */
export const CORE_TONES = { mesh: 0, near: 1, ping: 2, scan: 3, core: 4, faint: 5 } as const;

const TAU = Math.PI * 2;
const c = (s: string) => s.charCodeAt(0);
const G = {
  dot: c("."),
  dash: c("-"),
  pipe: c("|"),
  slash: c("/"),
  back: c("\\"),
  o: c("o"),
  O: c("O"),
  at: c("@"),
  hash: c("#"),
  star: c("*"),
  tilde: c("~"),
  colon: c(":"),
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

function slopeGlyph(dx: number, dy: number): number {
  let a = Math.atan2(dy, dx);
  if (a < 0) a += Math.PI;
  if (a < Math.PI / 8 || a > (7 * Math.PI) / 8) return G.dash;
  if (a < (3 * Math.PI) / 8) return G.back;
  if (a < (5 * Math.PI) / 8) return G.pipe;
  return G.slash;
}

type V3 = [number, number, number];

/**
 * "Neural core": a rotating sphere of neural-network nodes (a mesh on the
 * surface, a violet core inside) under radar. A horizontal scan plane rises
 * and falls through it, pinging the nodes it crosses; signals run along the
 * links; range rings pulse out across the floor from the emitter below.
 * Rendered with depth-shaded ASCII. Pointer position steers the rotation.
 */
export function neuralCore({ seed = 11, surface = 84, inner = 14 }: { seed?: number; surface?: number; inner?: number } = {}): AsciiScene {
  let W = 0;
  let CX = 0;
  let CY = 0;
  let RP = 0; // sphere radius in px
  let cw = 7;
  let ch = 13;
  let cols = 1;
  let rows = 1;
  const pts: V3[] = [];
  const isCore: boolean[] = [];
  const edges: [number, number, number][] = []; // a, b, signal phase (or -1)
  let yawSmooth = 0;

  const rnd = mulberry32(seed);
  // Fibonacci sphere for the surface mesh
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < surface; i++) {
    const y = 1 - (i / (surface - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    isCore.push(false);
  }
  for (let i = 0; i < inner; i++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * TAU;
    const rr = 0.32 + rnd() * 0.28;
    const s = Math.sqrt(1 - u * u);
    pts.push([Math.cos(th) * s * rr, u * rr, Math.sin(th) * s * rr]);
    isCore.push(true);
  }
  const seen = new Set<string>();
  const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  pts.forEach((p, i) => {
    const near = pts
      .map((q, j) => ({ j, d: dist(p, q) }))
      .filter((e) => e.j !== i && (isCore[i] ? true : !isCore[e.j] || rnd() < 0.12))
      .sort((x, y) => x.d - y.d)
      .slice(0, isCore[i] ? 3 : 3);
    for (const e of near) {
      const k = i < e.j ? `${i}-${e.j}` : `${e.j}-${i}`;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push([i, e.j, rnd() < 0.22 ? rnd() : -1]);
    }
  });

  return {
    resize(b: FieldBuffers, w: number, h: number) {
      W = w;
      cw = b.cw;
      ch = b.ch;
      cols = b.cols;
      rows = b.rows;
      CX = w / 2;
      CY = h * 0.41;
      RP = Math.min(w * 0.32, h * 0.36);
    },

    frame(b, t, ptr) {
      const { lum, tone, glyph } = b;
      const plot = (x: number, y: number, L: number, T: number, g: number) => {
        const cx = Math.floor(x / cw);
        const cy = Math.floor(y / ch);
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
        const i = cy * cols + cx;
        if (L <= lum[i]!) return;
        lum[i] = Math.min(1, L);
        tone[i] = T;
        glyph[i] = g;
      };

      // boot: the sphere inflates out of a point
      const boot = t < 1.3 ? 1 - Math.pow(1 - t / 1.3, 3) : 1;
      const target = ptr.on ? (ptr.x / Math.max(1, W) - 0.5) * 1.2 : 0;
      yawSmooth += (target - yawSmooth) * 0.05;
      const yaw = t * 0.3 + yawSmooth;
      const pitch = -0.36;
      const cyw = Math.cos(yaw);
      const syw = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const camera = 3.4;
      const F = RP * camera;

      // world -> view: yaw about y, then pitch about x
      const rotate = (p: V3, withYaw = true): V3 => {
        const x0 = withYaw ? p[0] * cyw - p[2] * syw : p[0];
        const z0 = withYaw ? p[0] * syw + p[2] * cyw : p[2];
        const y1 = p[1] * cp - z0 * sp;
        const z1 = p[1] * sp + z0 * cp;
        return [x0, y1, z1];
      };
      const project = (v: V3) => {
        const s = (F / (camera - v[2])) * boot;
        return [CX + v[0] * s, CY - v[1] * s] as const;
      };

      // floor emitter and range rings
      const floorY = -1.42;
      for (let k = 0; k < 3; k++) {
        const rho = ((t * 0.42 + k / 3) % 1) * 1.7;
        const fade = 1 - rho / 1.7;
        const steps = 90;
        for (let s = 0; s < steps; s++) {
          const a = (s / steps) * TAU;
          const v = rotate([Math.cos(a) * rho, floorY, Math.sin(a) * rho], false);
          const [x, y] = project(v);
          plot(x, y, 0.12 + 0.42 * fade, CORE_TONES.scan, v[2] > 0 ? G.dash : G.dot);
        }
      }
      // emitter beam up to the sphere
      for (let yv = floorY; yv < -1.02; yv += 0.06) {
        const [x, y] = project(rotate([0, yv, 0], false));
        plot(x, y, 0.3 + 0.2 * Math.sin(t * 6 + yv * 9), CORE_TONES.scan, G.colon);
      }
      {
        const [x, y] = project(rotate([0, floorY, 0], false));
        plot(x, y, 0.95, CORE_TONES.ping, G.at);
        plot(x - cw, y, 0.6, CORE_TONES.scan, c("("));
        plot(x + cw, y, 0.6, CORE_TONES.scan, c(")"));
      }

      // scan plane height (world y) and its ring
      const scanY = Math.sin(t * 0.85) * 1.02;
      const ringR = Math.sqrt(Math.max(0, 1.08 - scanY * scanY));
      for (let s = 0; s < 120; s++) {
        const a = (s / 120) * TAU;
        const v = rotate([Math.cos(a) * ringR, scanY, Math.sin(a) * ringR], false);
        const [x, y] = project(v);
        plot(x, y, v[2] > 0 ? 0.62 : 0.24, CORE_TONES.scan, v[2] > 0 ? G.tilde : G.dash);
      }

      // nodes in view space
      const view = pts.map((p) => rotate(p));
      const scr = view.map((v) => project(v));
      const depth = view.map((v) => (v[2] + 1) / 2); // 1 = nearest

      // links, with travelling signals
      edges.forEach(([a, bb, phase]) => {
        const [ax, ay] = scr[a]!;
        const [bx, by] = scr[bb]!;
        const g = slopeGlyph(bx - ax, by - ay);
        const len = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(2, Math.ceil(len / (Math.min(cw, ch) * 0.5)));
        const core = isCore[a] || isCore[bb];
        const sig = phase >= 0 ? (t * 0.55 + phase) % 1 : -1;
        for (let s = 1; s < steps; s++) {
          const u = s / steps;
          const dz = depth[a]! + (depth[bb]! - depth[a]!) * u;
          const x = ax + (bx - ax) * u;
          const y = ay + (by - ay) * u;
          if (sig >= 0 && Math.abs(u - sig) < 0.5 / steps + 0.02) plot(x, y, 0.95, CORE_TONES.ping, G.star);
          else plot(x, y, 0.08 + 0.3 * dz, core ? CORE_TONES.core : CORE_TONES.mesh, g);
        }
      });

      // nodes: depth-shaded, pinged by the scan plane
      view.forEach((v, i) => {
        const [x, y] = scr[i]!;
        const dz = depth[i]!;
        // yaw keeps height, and the scan ring shares the pitch, so compare raw heights
        const ping = Math.exp(-Math.abs(pts[i]![1] - scanY) / 0.07);
        if (ping > 0.45) {
          plot(x, y, 1, CORE_TONES.ping, ping > 0.8 ? G.at : G.hash);
          return;
        }
        if (isCore[i]) {
          plot(x, y, 0.45 + 0.5 * dz, CORE_TONES.core, dz > 0.55 ? G.O : G.o);
          return;
        }
        const g = dz > 0.78 ? G.at : dz > 0.52 ? G.O : dz > 0.28 ? G.o : G.dot;
        plot(x, y, 0.22 + 0.72 * dz, dz > 0.6 ? CORE_TONES.near : CORE_TONES.mesh, g);
      });
    },
  };
}
