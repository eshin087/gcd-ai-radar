import GLOBE from "@/lib/globe-data.json";

/**
 * Sphere maths for the globe: Earth-fixed unit vectors (x towards 0° E,
 * y towards 90° E, z to the north pole), the camera basis of an orthographic
 * view, the land mask and country cells from scripts/build-globe.ts and the
 * subsolar point.
 * Pure functions, no DOM, so tests/globe.test.ts covers them.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const DEG = Math.PI / 180;

interface GlobeFile {
  res: number;
  mask: number[][];
  labels: Record<string, [number, number, string]>;
  /** Whose land each 1° cell is: per row, [start, end, index into codes] runs. */
  countries: { res: number; codes: string[]; rows: number[][] };
}
// the JSON import types the tuples loosely; the build script guarantees the shape
const FILE = GLOBE as unknown as GlobeFile;

export const RES = FILE.res;
const COLS = Math.round(360 / RES);
const ROWS = Math.round(180 / RES);

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The unit vector of a longitude and latitude in degrees. */
export function lonLat(lonDeg: number, latDeg: number): V3 {
  const l = lonDeg * DEG, p = latDeg * DEG, c = Math.cos(p);
  return { x: c * Math.cos(l), y: c * Math.sin(l), z: Math.sin(p) };
}

/** Longitude and latitude in degrees of a (not necessarily unit) vector. */
export function toLonLat(v: V3): [number, number] {
  const r = Math.hypot(v.x, v.y, v.z) || 1;
  return [Math.atan2(v.y, v.x) / DEG, Math.asin(clamp(v.z / r, -1, 1)) / DEG];
}

export const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Spherical interpolation between two unit vectors. */
export function slerp(a: V3, b: V3, t: number): V3 {
  const ang = Math.acos(clamp(dot3(a, b), -1, 1));
  if (ang < 1e-6) return a;
  const s = Math.sin(ang);
  const wa = Math.sin((1 - t) * ang) / s, wb = Math.sin(t * ang) / s;
  return { x: wa * a.x + wb * b.x, y: wa * a.y + wb * b.y, z: wa * a.z + wb * b.z };
}

/** `v` turned by `angle` radians about the unit axis `k` (Rodrigues). */
export function rotate(v: V3, k: V3, angle: number): V3 {
  const c = Math.cos(angle), s = Math.sin(angle), d = dot3(k, v) * (1 - c);
  return {
    x: v.x * c + (k.y * v.z - k.z * v.y) * s + k.x * d,
    y: v.y * c + (k.z * v.x - k.x * v.z) * s + k.y * d,
    z: v.z * c + (k.x * v.y - k.y * v.x) * s + k.z * d,
  };
}

/** Wraps an angle in radians to [-π, π). */
export const wrap = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

let grid: Uint8Array | null = null;

/** The land mask decoded once into one byte per 0.5° cell, row 0 at the north pole. */
function landGrid(): Uint8Array {
  if (grid) return grid;
  const g = new Uint8Array(COLS * ROWS);
  FILE.mask.forEach((runs, r) => {
    for (let i = 0; i + 1 < runs.length; i += 2) g.fill(1, r * COLS + runs[i]!, r * COLS + runs[i + 1]!);
  });
  return (grid = g);
}

export function isLand(lonDeg: number, latDeg: number): boolean {
  let c = Math.floor((lonDeg + 180) / RES) % COLS;
  if (c < 0) c += COLS;
  const r = clamp(Math.floor((90 - latDeg) / RES), 0, ROWS - 1);
  return landGrid()[r * COLS + c] === 1;
}

/**
 * Land dots about `step` degrees apart on the sphere: rows of latitude, each
 * with as many dots as its circumference holds, alternate rows offset half a
 * step so no columns form. Packed as x, y, z, longitude in degrees.
 */
export function landDots(step: number): Float32Array {
  const out: number[] = [];
  let row = 0;
  for (let lat = -90 + step / 2; lat < 90; lat += step, row++) {
    const n = Math.max(1, Math.round((360 / step) * Math.cos(lat * DEG)));
    const phase = row % 2 ? 0.5 : 0;
    for (let k = 0; k < n; k++) {
      const lon = -180 + ((k + phase) * 360) / n;
      if (!isLand(lon, lat)) continue;
      const v = lonLat(lon, lat);
      out.push(v.x, v.y, v.z, lon);
    }
  }
  return Float32Array.from(out);
}

const C_RES = FILE.countries.res;
const C_COLS = Math.round(360 / C_RES);
const C_ROWS = Math.round(180 / C_RES);
let owners: Uint8Array | null = null;

/** The country grid decoded once: one byte per cell, 0 at sea, else 1 + the code's index. */
function ownerGrid(): Uint8Array {
  if (owners) return owners;
  const g = new Uint8Array(C_COLS * C_ROWS);
  FILE.countries.rows.forEach((runs, r) => {
    for (let i = 0; i + 2 < runs.length; i += 3) g.fill(runs[i + 2]! + 1, r * C_COLS + runs[i]!, r * C_COLS + runs[i + 1]!);
  });
  return (owners = g);
}

/**
 * The alpha-2 code of the country a point lies in, or null at sea. The grid
 * is 1° and the land dots are finer, so a coastal dot whose own cell is sea
 * takes the country of the nearest coded cell around it.
 */
export function countryAt(lonDeg: number, latDeg: number): string | null {
  const g = ownerGrid();
  const c0 = Math.floor((lonDeg + 180) / C_RES), r0 = clamp(Math.floor((90 - latDeg) / C_RES), 0, C_ROWS - 1);
  for (const [dr, dc] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const r = r0 + dr;
    if (r < 0 || r >= C_ROWS) continue;
    const c = (((c0 + dc) % C_COLS) + C_COLS) % C_COLS;
    const v = g[r * C_COLS + c]!;
    if (v) return FILE.countries.codes[v - 1] ?? null;
  }
  return null;
}

/** True when both ends of a route have a place on the map, so the globe can draw it. */
export const onMap = (r: { origin: string; target: string }) => !!FILE.labels[r.origin] && !!FILE.labels[r.target];

/** Where a country's label sits, as a unit vector, or null for a code the file does not hold. */
export function place(code: string): V3 | null {
  const l = FILE.labels[code];
  return l ? lonLat(l[0] / 10, l[1] / 10) : null;
}

/** The country's name as the globe file spells it (Natural Earth's short names), or the code itself. */
export const countryName = (code: string) => FILE.labels[code]?.[2] ?? code;

/**
 * The camera of an orthographic view centred on (lon, lat) in radians:
 * screen right e, screen up n, towards the viewer c. A point p shows at
 * (p·e, p·n) on the unit disc and faces the viewer when p·c > 0.
 */
export interface Basis {
  ex: number; ey: number; ez: number;
  nx: number; ny: number; nz: number;
  cx: number; cy: number; cz: number;
}

export function basis(lon: number, lat: number): Basis {
  const sl = Math.sin(lon), cl = Math.cos(lon), sp = Math.sin(lat), cp = Math.cos(lat);
  return { ex: -sl, ey: cl, ez: 0, nx: -sp * cl, ny: -sp * sl, nz: cp, cx: cp * cl, cy: cp * sl, cz: sp };
}

/** The Earth-fixed point under (sx, sy) on the unit disc, or null outside the sphere. */
export function unproject(b: Basis, sx: number, sy: number): V3 | null {
  const d2 = sx * sx + sy * sy;
  if (d2 > 1) return null;
  const sz = Math.sqrt(1 - d2);
  return { x: sx * b.ex + sy * b.nx + sz * b.cx, y: sx * b.ey + sy * b.ny + sz * b.cy, z: sx * b.ez + sy * b.nz + sz * b.cz };
}

/**
 * The point on Earth with the Sun overhead at `ms` (UTC), [lon, lat] in
 * degrees: NOAA's fractional-year equations for the declination and the
 * equation of time (gml.noaa.gov/grad/solcalc/solareqns.PDF), good to well
 * under a degree, which is finer than the drawing.
 */
export function subsolar(ms: number): [number, number] {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const days = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  const doy = Math.floor((ms - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / days) * (doy - 1 + (hours - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const lon = -15 * (hours - 12 + eqtime / 60);
  return [wrap(lon * DEG) / DEG, decl / DEG];
}

/** Short, plain names for the countries Radar spells formally. */
const PLAIN: Record<string, string> = {
  "Russian Federation": "Russia",
  "Korea, Republic of": "South Korea",
  "Republic of Korea": "South Korea",
  "Korea, Democratic People's Republic of": "North Korea",
  "Iran, Islamic Republic of": "Iran",
  "Viet Nam": "Vietnam",
  "Taiwan, Province of China": "Taiwan",
  "Moldova, Republic of": "Moldova",
  "Tanzania, United Republic of": "Tanzania",
  "Venezuela, Bolivarian Republic of": "Venezuela",
  "Bolivia, Plurinational State of": "Bolivia",
  "Syrian Arab Republic": "Syria",
  "Lao People's Democratic Republic": "Laos",
  "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",
  "United States of America": "United States",
  "Hong Kong SAR": "Hong Kong",
};

export const plainName = (name: string) => PLAIN[name] ?? name;

/** Names that take "the" in running text ("in the Netherlands"). */
const WITH_THE = new Set([
  "United States", "United Kingdom", "Netherlands", "Philippines", "United Arab Emirates", "Czech Republic", "Dominican Republic", "Bahamas",
  "Gambia", "Maldives", "Central African Republic", "Democratic Republic of the Congo", "Republic of the Congo", "Marshall Islands",
  "Solomon Islands", "Cayman Islands", "Faroe Islands", "Seychelles", "Comoros", "British Virgin Islands", "U.S. Virgin Islands",
  "Turks and Caicos Islands", "Northern Mariana Islands", "Isle of Man",
]);

/** The plain name as it reads inside a sentence: "the United States", "Germany". */
export const inSentence = (name: string) => {
  const n = plainName(name);
  return WITH_THE.has(n) ? `the ${n}` : n;
};
