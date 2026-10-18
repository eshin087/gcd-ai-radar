/** Pure text renderers for ASCII/Unicode data marks. */

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/** Horizontal bar of block characters with eighth-block precision. */
export function blockBar(value: number, max: number, width: number): string {
  if (max <= 0 || value <= 0) return "";
  const cells = (value / max) * width;
  const full = Math.floor(cells);
  const frac = Math.round((cells - full) * 8);
  return "█".repeat(full) + (frac >= 8 ? "█" : (EIGHTHS[frac] ?? ""));
}

const VERT = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** One-row sparkline with vertical eighth blocks. */
export function blockSpark(values: number[]): string {
  const max = Math.max(1, ...values);
  return values.map((v) => VERT[Math.round((v / max) * 8)] ?? " ").join("");
}

// Braille dot bits: column 0 rows 0-3 = 0x01,0x02,0x04,0x40; column 1 = 0x08,0x10,0x20,0x80
const LEFT = [0x40, 0x04, 0x02, 0x01];
const RIGHT = [0x80, 0x20, 0x10, 0x08];

/**
 * Braille sparkline: two values per character, four dot rows of height,
 * filled from the bottom. 24 months -> 12 characters.
 */
export function brailleSpark(values: number[]): string {
  const max = Math.max(1, ...values);
  let out = "";
  for (let i = 0; i < values.length; i += 2) {
    const a = Math.round(((values[i] ?? 0) / max) * 4);
    const b = Math.round(((values[i + 1] ?? 0) / max) * 4);
    let code = 0x2800;
    for (let r = 0; r < a; r++) code |= LEFT[r]!;
    for (let r = 0; r < b; r++) code |= RIGHT[r]!;
    out += String.fromCharCode(code);
  }
  return out;
}

/** Ordinal shade glyph for 1-4 (severity) used as a non-color secondary encoding. */
export const SHADE = ["", "░", "▒", "▓", "█"] as const;

/** Leader dots between a label and a value: "Label ........ 42". */
export function leader(label: string, value: string, width: number): string {
  const dots = Math.max(2, width - label.length - value.length - 2);
  return `${label} ${".".repeat(dots)} ${value}`;
}
