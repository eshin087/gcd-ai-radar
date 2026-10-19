/** SVG path helpers shared by the line, stream and flow charts. */

export type Pt = [number, number];

/**
 * Monotone cubic interpolation (Fritsch–Carlson): a smooth curve through the
 * points that never overshoots them, so a stacked band can never dip below
 * the band under it.
 */
function tangents(pts: Pt[]): number[] {
  const n = pts.length;
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1]![0] - pts[i]![0];
    d.push(dx === 0 ? 0 : (pts[i + 1]![1] - pts[i]![1]) / dx);
  }
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  return m;
}

/** The "C" segments of the monotone curve, without the leading "M". */
export function monotoneSegments(pts: Pt[]): string {
  const m = tangents(pts);
  let d = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const dx = (x1 - x0) / 3;
    d += `C${(x0 + dx).toFixed(1)},${(y0 + m[i]! * dx).toFixed(1)} ${(x1 - dx).toFixed(1)},${(y1 - m[i + 1]! * dx).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

export function monotonePath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  return `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}${monotoneSegments(pts)}`;
}

/** A closed band between two curves over the same x positions. */
export function bandPath(top: Pt[], bottom: Pt[]): string {
  if (top.length === 0) return "";
  const back = [...bottom].reverse();
  return `${monotonePath(top)}L${back[0]![0].toFixed(1)},${back[0]![1].toFixed(1)}${monotoneSegments(back)}Z`;
}

/** A sankey ribbon between two vertical spans, as a filled cubic shape. */
export function ribbonPath(x0: number, y0a: number, y0b: number, x1: number, y1a: number, y1b: number): string {
  const cx = (x0 + x1) / 2;
  return `M${x0},${y0a}C${cx},${y0a} ${cx},${y1a} ${x1},${y1a}L${x1},${y1b}C${cx},${y1b} ${cx},${y0b} ${x0},${y0b}Z`;
}
