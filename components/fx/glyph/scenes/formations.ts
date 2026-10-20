import type { V3 } from "../engine";
import type { Phase } from "./director";

/**
 * The swarm's formation library. Every shape is built around the core at the
 * origin (radius about 0.75, armillary rings to 1.0, the shield at 1.1), so
 * the agents frame it in shells, rings and squadrons between 1.25 and 2 units
 * out, and each one moves (rings turn, squadrons fly their orbits) instead of
 * standing still. Each shape names the moods it suits, so calm phases get the
 * patrol shapes and skirmishes the guard shapes. Also here: the defence
 * layers raised toward a threat, the counter-shell held in a war, and the
 * enemy swarm's own formations.
 */

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const h1 = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** an even spread of n points over a sphere of radius r */
export const fib = (i: number, n: number, r: number): V3 => {
  const y = 1 - (2 * (i + 0.5)) / n;
  const rr = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * GOLDEN;
  return [Math.cos(a) * rr * r, y * r, Math.sin(a) * rr * r];
};
export const rotX = (p: V3, a: number): V3 => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
export const rotY = (p: V3, a: number): V3 => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
export const rotZ = (p: V3, a: number): V3 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/** Shares n slots between groups in proportion to their weights: which group slot i is in, and its index within the group. */
function share(i: number, n: number, weights: number[]): [number, number, number] {
  const total = weights.reduce((s, w) => s + w, 0);
  let start = 0;
  for (let g = 0; g < weights.length; g++) {
    const count = g === weights.length - 1 ? n - start : Math.round((n * weights[g]!) / total);
    if (i < start + count) return [g, i - start, Math.max(1, count)];
    start += count;
  }
  return [weights.length - 1, 0, 1];
}

/** A point on a circle of radius r in the plane with normal nrm, at angle a. */
function onCircle(nrm: V3, r: number, a: number): V3 {
  const e1 = norm(cross(nrm, Math.abs(nrm[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const e2 = cross(nrm, e1);
  return add(mul(e1, Math.cos(a) * r), mul(e2, Math.sin(a) * r));
}

const PHI = (1 + Math.sqrt(5)) / 2;
const IP = 1 / PHI;
const DODECA: V3[] = [
  ...[-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as V3))),
  ...[-1, 1].flatMap((a) => [-1, 1].map((b) => [0, a * IP, b * PHI] as V3)),
  ...[-1, 1].flatMap((a) => [-1, 1].map((b) => [a * IP, b * PHI, 0] as V3)),
  ...[-1, 1].flatMap((a) => [-1, 1].map((b) => [a * PHI, 0, b * IP] as V3)),
].map(norm);
const DODECA_EDGES: [number, number][] = [];
DODECA.forEach((a, i) =>
  DODECA.forEach((b, j) => {
    if (j > i && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.75) DODECA_EDGES.push([i, j]);
  }),
);

/** The edges of a honeycomb of hexagons (rings 2: 19 cells; rings 1: 7), as 2D segments about the origin, each shared edge once. */
function honeycomb(rings: number): [[number, number], [number, number]][] {
  const out: [[number, number], [number, number]][] = [];
  const seen = new Set<string>();
  for (let q = -rings; q <= rings; q++)
    for (let r = -rings; r <= rings; r++) {
      if (Math.abs(q + r) > rings) continue;
      const cx = 1.5 * q;
      const cy = Math.sqrt(3) * (r + q / 2);
      for (let k = 0; k < 6; k++) {
        const a0 = (k / 6) * TAU;
        const a1 = ((k + 1) / 6) * TAU;
        const p0: [number, number] = [cx + Math.cos(a0), cy + Math.sin(a0)];
        const p1: [number, number] = [cx + Math.cos(a1), cy + Math.sin(a1)];
        const key = `${((p0[0] + p1[0]) * 50).toFixed(0)},${((p0[1] + p1[1]) * 50).toFixed(0)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([p0, p1]);
      }
    }
  return out;
}
const HONEYCOMB = honeycomb(2);
const HONEYCOMB7 = honeycomb(1);

export interface Formation {
  name: string;
  /** the director phases this shape suits */
  moods: Phase[];
  /** slot i of n at time t, around the core at the origin */
  at: (i: number, n: number, t: number) => V3;
}

export const FORMATIONS: Formation[] = [
  {
    // a dodecahedron cage, its thirty edges drawn as arcs of agents, turning slowly
    name: "DODECA CAGE",
    moods: ["calm", "aftermath"],
    at: (i, n, t) => {
      const e = DODECA_EDGES[i % DODECA_EDGES.length]!;
      const per = Math.ceil(n / DODECA_EDGES.length);
      const u = (Math.floor(i / DODECA_EDGES.length) + 0.5) / per;
      const a = DODECA[e[0]]!;
      const b = DODECA[e[1]]!;
      return rotX(rotY(mul(norm(add(mul(a, 1 - u), mul(b, u))), 1.66), t * 0.11), 0.3);
    },
  },
  {
    // three flat rings in one tilted plane, inner ones orbiting faster
    name: "SATURN RINGS",
    moods: ["calm", "aftermath"],
    at: (i, n, t) => {
      const [g, k, m] = share(i, n, [1.3, 1.6, 1.9]);
      const r = [1.32, 1.6, 1.9][g]! + (h1(i) - 0.5) * 0.05;
      const a = (k / m) * TAU + t * (0.62 / Math.pow(r, 1.5));
      return rotZ(rotX([Math.cos(a) * r, (h1(i + 7) - 0.5) * 0.03, Math.sin(a) * r], 0.36), 0.1);
    },
  },
  {
    // five latitude rings on a sphere, turning in alternate directions
    name: "LATITUDE CAGE",
    moods: ["calm", "aftermath"],
    at: (i, n, t) => {
      const lats = [-0.98, -0.5, 0, 0.5, 0.98];
      const [g, k, m] = share(i, n, lats.map((l) => Math.cos(l)));
      const lat = lats[g]!;
      const a = (k / m) * TAU + t * 0.28 * (g % 2 ? 1 : -1);
      const R = 1.6;
      return rotX([Math.cos(lat) * Math.cos(a) * R, Math.sin(lat) * R, Math.cos(lat) * Math.sin(a) * R], 0.18);
    },
  },
  {
    // six great circles through the poles, agents running along them
    name: "MERIDIAN CAGE",
    moods: ["calm"],
    at: (i, n, t) => {
      const [g, k, m] = share(i, n, [1, 1, 1, 1, 1, 1]);
      const lon = (g / 6) * Math.PI + t * 0.1;
      const a = (k / m) * TAU + t * 0.35;
      return rotZ(onCircle([Math.cos(lon), 0, Math.sin(lon)], 1.6, a), 0.2);
    },
  },
  {
    // three orbital rings at 60 degrees, like an atom's shells, precessing
    name: "ORBITAL SHELLS",
    moods: ["probe", "skirmish"],
    at: (i, n, t) => {
      const [g, k, m] = share(i, n, [1, 1, 1]);
      const tilt = (g / 3) * Math.PI + t * 0.06;
      const nrm: V3 = [Math.sin(tilt) * 0.8, 0.6, Math.cos(tilt) * 0.8];
      return onCircle(norm(nrm), 1.55 + g * 0.08, (k / m) * TAU + t * (0.55 + g * 0.1));
    },
  },
  {
    // six square battalions on a hexagon round the core, each facing out, the hexagon turning slowly
    name: "BATTALIONS",
    moods: ["probe", "skirmish"],
    at: (i, n, t) => {
      const b = i % 6;
      const k = Math.floor(i / 6);
      const side = Math.ceil(Math.sqrt(Math.ceil(n / 6)));
      const a = (b / 6) * TAU + t * 0.09;
      const out: V3 = [Math.cos(a), 0, Math.sin(a)];
      const tan: V3 = [-Math.sin(a), 0, Math.cos(a)];
      const x = ((k % side) / (side - 1) - 0.5) * 0.62;
      const y = (Math.floor(k / side) / (side - 1) - 0.5) * 0.62;
      return rotZ(rotX(add(mul(out, 1.78), add(mul(tan, x), [0, y, 0])), 0.32), 0.08);
    },
  },
  {
    // eight arrowhead squadrons flying nose to tail round one ring, like a carousel
    name: "SQUADRON CAROUSEL",
    moods: ["probe", "skirmish"],
    at: (i, n, t) => {
      const sq = i % 8;
      const k = Math.floor(i / 8);
      const nrm = norm([0.12, 1, 0.38]);
      const a = (sq / 8) * TAU + t * 0.36;
      const pos = onCircle(nrm, 1.78, a);
      const fwd = norm(onCircle(nrm, 1, a + Math.PI / 2));
      const side = norm(cross(fwd, nrm));
      // a filled arrowhead: row r holds 2r + 1 agents
      let r = 0;
      let j = k;
      while (j >= 2 * r + 1) {
        j -= 2 * r + 1;
        r++;
      }
      return add(pos, add(mul(fwd, -r * 0.06), add(mul(side, (j - r) * 0.05), mul(nrm, (h1(i) - 0.5) * 0.015))));
    },
  },
  {
    // two dense rings in crossed planes, counter-rotating
    name: "TWIN GYRO",
    moods: ["skirmish", "war"],
    at: (i, n, t) => {
      const g = i % 2;
      const k = Math.floor(i / 2);
      const m = Math.ceil(n / 2);
      const nrm: V3 = g ? norm([0.95, 0.3, 0.1]) : norm([0.1, 1, 0.35]);
      return onCircle(nrm, g ? 1.5 : 1.82, (k / m) * TAU + t * (g ? 0.55 : -0.45));
    },
  },
  {
    // a honeycomb shield: nineteen hexagon cells drawn by agents on a dome in front of the core, swinging slowly
    name: "HONEYCOMB SHIELD",
    moods: ["skirmish", "war"],
    at: (i, n, t) => {
      const e = HONEYCOMB[i % HONEYCOMB.length]!;
      const per = Math.ceil(n / HONEYCOMB.length);
      const u = (Math.floor(i / HONEYCOMB.length) + 0.5) / per;
      const x = e[0][0] + (e[1][0] - e[0][0]) * u;
      const y = e[0][1] + (e[1][1] - e[0][1]) * u;
      // the flat honeycomb wrapped onto a cap of the sphere (about 50 degrees across its widest cells)
      const th = Math.hypot(x, y) * 0.19;
      const ph = Math.atan2(y, x);
      const p: V3 = [Math.sin(th) * Math.cos(ph) * 1.72, Math.sin(th) * Math.sin(ph) * 1.72, Math.cos(th) * 1.72];
      return rotX(rotY(p, 0.25 + Math.sin(t * 0.16) * 0.55), -0.1 + Math.sin(t * 0.11) * 0.15);
    },
  },
];

/**
 * The gear rings: the core's last line in a mass assault. Three concentric
 * rings in one plane (facing the camera, so they read as a turbine round the
 * core), turning fast in alternate directions, a tooth on every fifth agent,
 * so anything trying to cross is shredded.
 */
export const GEAR_R = [1.3, 1.5, 1.7];
export function gearRings(i: number, n: number, t: number, nrm: V3): V3 {
  const [g, k, m] = share(i, n, GEAR_R);
  const tooth = k % 5 === 0 ? 0.09 : 0;
  return onCircle(norm(nrm), GEAR_R[g]! + tooth * (g === 1 ? -1 : 1), (k / m) * TAU + t * (g === 1 ? -0.9 : 0.75));
}

/** A point on the honeycomb (nineteen hex cells) wrapped onto a cap of a sphere of radius R facing direction d, for slot i of n. */
export function honeycombAt(i: number, n: number, d: V3, R: number, spread = 0.19, cells: 7 | 19 = 19): V3 {
  const comb = cells === 7 ? HONEYCOMB7 : HONEYCOMB;
  const e = comb[i % comb.length]!;
  const per = Math.ceil(n / comb.length);
  const u = (Math.floor(i / comb.length) + 0.5) / per;
  const x = e[0][0] + (e[1][0] - e[0][0]) * u;
  const y = e[0][1] + (e[1][1] - e[0][1]) * u;
  const th = Math.hypot(x, y) * spread;
  const ph = Math.atan2(y, x);
  const s = norm(cross(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const up = cross(s, d);
  return mul(add(mul(d, Math.cos(th)), add(mul(s, Math.sin(th) * Math.cos(ph)), mul(up, Math.sin(th) * Math.sin(ph)))), R);
}

export type LayerType = "AEGIS WALL" | "RING BARRIER" | "PHALANX GRID" | "DECOY SPIRAL" | "INTERCEPT SCREEN";
/** the layers raised against single attacks (the decoy spiral read as noise, so it is left out) */
export const LAYER_TYPES: LayerType[] = ["AEGIS WALL", "RING BARRIER", "PHALANX GRID", "INTERCEPT SCREEN"];

/** A defence layer's member k of m, raised toward direction d (unit), at time t. */
export function layerAt(type: LayerType, d: V3, k: number, m: number, t: number): V3 {
  const s = norm(cross(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const u = cross(s, d);
  const at = (dist: number, a: number, b: number): V3 => add(mul(d, dist), add(mul(s, a), mul(u, b)));
  if (type === "AEGIS WALL") {
    // a curved hex plate
    const r = Math.sqrt((k + 0.5) / m) * 0.62;
    const a = k * GOLDEN;
    return at(1.95 - r * r * 0.45, Math.cos(a) * r, Math.sin(a) * r);
  }
  if (type === "RING BARRIER") {
    const a = (k / m) * TAU + t * 1.6;
    return at(1.9, Math.cos(a) * 0.55, Math.sin(a) * 0.55);
  }
  if (type === "PHALANX GRID") {
    const side = Math.ceil(Math.sqrt(m / 2));
    const layer = k % 2;
    const j = Math.floor(k / 2);
    return at(1.85 + layer * 0.12, ((j % side) / Math.max(1, side - 1) - 0.5) * 0.85 + layer * 0.06, (Math.floor(j / side) / Math.max(1, side - 1) - 0.5) * 0.85);
  }
  if (type === "DECOY SPIRAL") {
    // decoys spiral out beside the attack's path to draw it off
    const a = k * 0.7 + t * 2.4;
    const r = 0.08 + (k / m) * 0.4;
    return at(2.2, 0.5 + Math.cos(a) * r, Math.sin(a) * r);
  }
  const arc = k % 2;
  const a = (Math.floor(k / 2) / Math.ceil(m / 2) - 0.5) * 2;
  return at(1.75 + arc * 0.22, Math.sin(a) * (0.75 + arc * 0.15), (Math.cos(a) - 0.75) * 0.5 + arc * 0.08);
}

export type EnemyShape = "CHEVRON" | "CLAW" | "SERPENT" | "HIVE" | "WALL" | "BLOCK";
export const ENEMY_SHAPES: EnemyShape[] = ["CHEVRON", "CLAW", "SERPENT", "HIVE", "WALL", "BLOCK"];

/** An enemy formation slot in the group's own frame: x across, y up, z along its heading (forward is +z). */
export function enemySlot(shape: EnemyShape, k: number, m: number, t: number): V3 {
  if (shape === "CHEVRON") {
    // a V of two swept wings, three deep
    const wing = k % 2 ? 1 : -1;
    const j = Math.floor(k / 2);
    const row = j % 3;
    const pos = Math.floor(j / 3);
    return [wing * (pos * 0.09 + row * 0.05), (row - 1) * 0.07, -pos * 0.085 - row * 0.06];
  }
  if (shape === "CLAW") {
    // two curved prongs closing round the target
    const side = k % 2 ? 1 : -1;
    const j = Math.floor(k / 2);
    const a = (j / Math.ceil(m / 2)) * 1.7;
    return [side * (0.15 + Math.sin(a) * 0.75), Math.sin(j * 1.7) * 0.05, -Math.cos(a) * 0.75 + 0.55];
  }
  if (shape === "SERPENT") {
    // a column four abreast, snaking
    const row = Math.floor(k / 4);
    const z = -row * 0.07;
    return [((k % 4) - 1.5) * 0.06 + Math.sin(row * 0.35 - t * 3) * 0.28, Math.cos(row * 0.25 - t * 2) * 0.1, z];
  }
  if (shape === "BLOCK") {
    // a phalanx: eight wide, four high, as many ranks deep as it takes
    return [((k % 8) - 3.5) * 0.09, ((Math.floor(k / 8) % 4) - 1.5) * 0.09, -Math.floor(k / 32) * 0.12];
  }
  if (shape === "HIVE") {
    // a dense turning ball
    return rotY(rotX(fib(k, m, 0.42 + 0.06 * Math.sin(t * 2 + k)), t * 0.7), t * 1.1);
  }
  // a hex-packed wall face-on to its heading
  const side = Math.ceil(Math.sqrt(m));
  const row = Math.floor(k / side);
  return [((k % side) - side / 2 + (row % 2) * 0.5) * 0.08, (row - side / 2) * 0.07, Math.sin(k * 0.9 + t * 4) * 0.02];
}
