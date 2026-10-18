/**
 * Converts the source images in art/src/ into compact glyph grids that the
 * GlyphImage renderer animates (components/fx/GlyphImage.tsx).
 *
 * Each grid cell stores two bytes: luminance (0-255, midtones lifted) and an
 * edge code from a Sobel pass (0 none, 1 "-", 2 "/", 3 "|", 4 "\") so strong
 * contours render as line glyphs instead of density glyphs.
 *
 *   npx tsx scripts/ascii-art.ts            # all images
 *   npx tsx scripts/ascii-art.ts dish 240   # one image, custom column count
 *
 * Source images were generated with Codex image generation for this project.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SRC = path.join(process.cwd(), "art", "src");
const OUT = path.join(process.cwd(), "public", "art");
/** Character cell width / height for a monospace face. */
const CELL_ASPECT = 0.6;

export interface GlyphGrid {
  cols: number;
  rows: number;
  /** base64 of cols*rows*2 bytes: [luminance, edge] per cell, row-major from the top. */
  data: string;
}

async function convert(name: string, cols: number): Promise<GlyphGrid> {
  const file = path.join(SRC, `${name}.jpg`);
  const meta = await sharp(file).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  const rows = Math.round((H * cols * CELL_ASPECT) / W);
  const sw = cols * 2;
  const sh = rows * 2;
  const { data } = await sharp(file).greyscale().resize(sw, sh, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => data[Math.min(sh - 1, Math.max(0, y)) * sw + Math.min(sw - 1, Math.max(0, x))]! / 255;
  const out = Buffer.alloc(cols * rows * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * 2;
      const y = r * 2;
      const lum = (at(x, y) + at(x + 1, y) + at(x, y + 1) + at(x + 1, y + 1)) / 4;
      // Sobel around the cell centre (y grows downward in the image)
      const gx = at(x + 2, y - 1) + 2 * at(x + 2, y) + at(x + 2, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 2) + 2 * at(x, y + 2) + at(x + 1, y + 2) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const mag = Math.hypot(gx, gy);
      let edge = 0;
      if (mag > 0.55 && lum > 0.1) {
        const gradient = (Math.atan2(-gy, gx) * 180) / Math.PI; // math convention, y up
        const o = (((gradient + 90) % 180) + 180) % 180; // edge runs perpendicular to the gradient
        edge = o < 22.5 || o >= 157.5 ? 1 : o < 67.5 ? 2 : o < 112.5 ? 3 : 4;
      }
      const L = Math.pow(lum, 0.78);
      out[(r * cols + c) * 2] = Math.round(L * 255);
      out[(r * cols + c) * 2 + 1] = edge;
    }
  }
  return { cols, rows, data: out.toString("base64") };
}

async function main() {
  const only = process.argv[2];
  const cols = Number(process.argv[3] ?? 220);
  await fs.mkdir(OUT, { recursive: true });
  const files = (await fs.readdir(SRC)).filter((f) => f.endsWith(".jpg")).map((f) => f.replace(/\.jpg$/, ""));
  for (const name of files.filter((n) => !only || n === only)) {
    const grid = await convert(name, cols);
    const json = JSON.stringify(grid);
    await fs.writeFile(path.join(OUT, `${name}.json`), json);
    const edges = Buffer.from(grid.data, "base64").filter((_, i) => i % 2 === 1 && _ > 0).length;
    console.log(`${name}: ${grid.cols}x${grid.rows} cells, ${edges} edge cells, ${(json.length / 1024).toFixed(1)} KB`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
