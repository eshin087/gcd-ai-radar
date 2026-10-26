/**
 * Builds lib/globe-data.json for components/internet/Globe.tsx from Natural
 * Earth's 110m countries (public domain; naturalearthdata.com/about/terms-of-use):
 *
 *   rows    land dots on a 2° grid of latitude rows, each row [lat10, lon10, lon10, ...]
 *           (tenths of a degree, longitudes ascending), about 3,000 dots in all
 *   labels  one point per ISO alpha-2 code: [lon10, lat10, name], from the
 *           file's LABEL_X / LABEL_Y, plus a few places too small for the 110m
 *           file (Singapore, Hong Kong, ...) that attack routes name often
 *
 * The GeoJSON (about 840 KB) is downloaded into a scratch directory outside the
 * repository and reused on later runs; only the ~20 KB output is committed.
 *
 *   npx tsx scripts/build-globe.ts            downloads to $TMPDIR/gcd-ai-radar-globe
 *   GLOBE_SCRATCH=/path npx tsx scripts/build-globe.ts
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const OUT = path.join(process.cwd(), "lib", "globe-data.json");
/** Degrees between latitude rows; the longitude step grows with 1/cos(lat) so dots stay evenly spaced on the sphere. */
const STEP = 2;

/** Places absent from the 110m file (too small to draw) that Radar routes name: [lon, lat, name]. */
const EXTRA_LABELS: Record<string, [number, number, string]> = {
  SG: [103.82, 1.35, "Singapore"],
  HK: [114.17, 22.32, "Hong Kong"],
  MO: [113.55, 22.2, "Macao"],
  BH: [50.55, 26.07, "Bahrain"],
  MT: [14.5, 35.9, "Malta"],
  MV: [73.5, 4.2, "Maldives"],
  MU: [57.55, -20.3, "Mauritius"],
  SC: [55.45, -4.65, "Seychelles"],
  BB: [-59.55, 13.2, "Barbados"],
  LI: [9.55, 47.15, "Liechtenstein"],
  MC: [7.42, 43.73, "Monaco"],
  AD: [1.52, 42.5, "Andorra"],
  SM: [12.45, 43.94, "San Marino"],
  GI: [-5.35, 36.14, "Gibraltar"],
  JE: [-2.1, 49.2, "Jersey"],
  GG: [-2.58, 49.45, "Guernsey"],
  IM: [-4.5, 54.2, "Isle of Man"],
  KY: [-81.25, 19.3, "Cayman Islands"],
  BM: [-64.75, 32.3, "Bermuda"],
  VG: [-64.6, 18.45, "British Virgin Islands"],
  AW: [-69.97, 12.52, "Aruba"],
  CW: [-68.95, 12.2, "Curaçao"],
  CV: [-23.6, 15.1, "Cabo Verde"],
  ST: [6.7, 0.3, "São Tomé and Príncipe"],
  KM: [43.3, -11.7, "Comoros"],
  AG: [-61.8, 17.08, "Antigua and Barbuda"],
  DM: [-61.37, 15.42, "Dominica"],
  LC: [-61, 13.9, "Saint Lucia"],
  VC: [-61.2, 13.25, "Saint Vincent and the Grenadines"],
  GD: [-61.68, 12.12, "Grenada"],
  KN: [-62.75, 17.3, "Saint Kitts and Nevis"],
  TO: [-175.2, -21.2, "Tonga"],
  WS: [-172.1, -13.75, "Samoa"],
  FM: [158.2, 6.9, "Micronesia"],
  PW: [134.55, 7.5, "Palau"],
  MH: [171.2, 7.1, "Marshall Islands"],
  KI: [173, 1.4, "Kiribati"],
  NR: [166.93, -0.53, "Nauru"],
  TV: [179.2, -8.5, "Tuvalu"],
  RE: [55.55, -21.1, "Réunion"],
  GP: [-61.55, 16.25, "Guadeloupe"],
  MQ: [-61, 14.65, "Martinique"],
  FO: [-6.9, 62, "Faroe Islands"],
  PF: [-149.5, -17.6, "French Polynesia"],
  GU: [144.8, 13.45, "Guam"],
  MP: [145.75, 15.2, "Northern Mariana Islands"],
  AS: [-170.7, -14.3, "American Samoa"],
  TC: [-71.8, 21.8, "Turks and Caicos Islands"],
  SX: [-63.05, 18.05, "Sint Maarten"],
  BQ: [-68.25, 12.15, "Bonaire"],
  VI: [-64.9, 18.35, "U.S. Virgin Islands"],
  AI: [-63.05, 18.22, "Anguilla"],
  MS: [-62.2, 16.75, "Montserrat"],
  YT: [45.17, -12.83, "Mayotte"],
  CK: [-159.78, -21.23, "Cook Islands"],
};

type Ring = [number, number][];
interface Feature {
  properties: { ISO_A2_EH?: string; ISO_A2?: string; NAME?: string; LABEL_X?: number; LABEL_Y?: number };
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
}

async function source(): Promise<Feature[]> {
  const dir = process.env.GLOBE_SCRATCH ?? path.join(os.tmpdir(), "gcd-ai-radar-globe");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "ne_110m_admin_0_countries.geojson");
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
    console.log(`using ${file}`);
  } catch {
    console.log(`downloading ${SOURCE}`);
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    text = await res.text();
    await fs.writeFile(file, text);
    console.log(`saved to ${file}`);
  }
  const parsed = JSON.parse(text) as { type: string; features: Feature[] };
  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) throw new Error("not a FeatureCollection");
  return parsed.features;
}

/** Even-odd ray casting in plain lon/lat; the 110m file splits its polygons at the antimeridian, so no wrap handling is needed. */
function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bbox(ring: Ring): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

interface Poly {
  outer: Ring;
  holes: Ring[];
  box: [number, number, number, number];
}

function polygons(features: Feature[]): Poly[] {
  const out: Poly[] = [];
  for (const f of features) {
    const parts = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of parts) {
      const [outer, ...holes] = rings;
      if (!outer || outer.length < 4) continue;
      out.push({ outer, holes, box: bbox(outer) });
    }
  }
  return out;
}

function onLand(lon: number, lat: number, polys: Poly[]): boolean {
  for (const p of polys) {
    const [x0, y0, x1, y1] = p.box;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    if (!inRing(lon, lat, p.outer)) continue;
    if (p.holes.some((h) => inRing(lon, lat, h))) continue;
    return true;
  }
  return false;
}

async function main() {
  const features = await source();
  const polys = polygons(features);
  const rows: number[][] = [];
  let dots = 0;
  for (let lat = -88; lat <= 88; lat += STEP) {
    const n = Math.max(1, Math.round((360 / STEP) * Math.cos((lat * Math.PI) / 180)));
    const row: number[] = [Math.round(lat * 10)];
    // offset alternate rows by half a step so the dots do not line up in columns
    const phase = ((lat / STEP) % 2 === 0 ? 0 : 0.5) * (360 / n);
    for (let k = 0; k < n; k++) {
      const lon = -180 + phase + (k * 360) / n;
      if (onLand(lon, lat, polys)) row.push(Math.round(lon * 10));
    }
    if (row.length > 1) {
      rows.push(row);
      dots += row.length - 1;
    }
  }

  const labels: Record<string, [number, number, string]> = {};
  let skipped: string[] = [];
  for (const f of features) {
    const code = f.properties.ISO_A2_EH;
    const name = f.properties.NAME;
    const { LABEL_X: x, LABEL_Y: y } = f.properties;
    if (!code || !/^[A-Z]{2}$/.test(code) || !name || typeof x !== "number" || typeof y !== "number") {
      skipped.push(`${name ?? "?"}:${code ?? "?"}`);
      continue;
    }
    labels[code] = [Math.round(x * 10), Math.round(y * 10), name];
  }
  for (const [code, [x, y, name]] of Object.entries(EXTRA_LABELS)) {
    if (!labels[code]) labels[code] = [Math.round(x * 10), Math.round(y * 10), name];
  }
  const sorted = Object.fromEntries(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));

  const out = {
    source: "Natural Earth 110m admin 0 countries (public domain), via nvkelso/natural-earth-vector",
    credit: "Made with Natural Earth",
    built: new Date().toISOString().slice(0, 10),
    step: STEP,
    rows,
    labels: sorted,
  };
  const json = JSON.stringify(out);
  await fs.writeFile(OUT, json + "\n");
  console.log(`${dots} land dots in ${rows.length} rows, ${Object.keys(sorted).length} labels (${skipped.length} features skipped: ${skipped.join(", ") || "none"}), ${(json.length / 1024).toFixed(1)} KB -> ${path.relative(process.cwd(), OUT)}`);
  skipped = [];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
