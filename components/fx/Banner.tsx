import { bannerLines } from "./banner-font";

/**
 * ANSI block-font banner laid out on a fixed cell grid, so block and
 * box-drawing glyphs (often from a fallback font of a different width) stay
 * aligned. Decorative: hidden from assistive tech, the page has a real h1.
 */
export function Banner({ text, className = "" }: { text: string; className?: string }) {
  const rows = bannerLines(text);
  const cols = Math.max(...rows.map((r) => [...r].length));
  return (
    <div
      aria-hidden
      className={`grid select-none font-mono leading-none ${className}`}
      style={{ gridTemplateColumns: `repeat(${cols}, 0.62em)`, gridAutoRows: "1.02em" }}
    >
      {rows.flatMap((row, r) =>
        [...row.padEnd(cols)].map((ch, c) => (
          <span key={`${r}-${c}`} className="block overflow-hidden text-center" style={{ width: "0.62em" }}>
            {ch === " " ? " " : ch}
          </span>
        )),
      )}
    </div>
  );
}
