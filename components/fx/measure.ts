/**
 * Measures the rendered advance width of a glyph inside `host` (block and
 * box-drawing characters often come from a fallback font whose width differs
 * from the monospace face's 0.6em).
 */
export function glyphWidth(host: HTMLElement, glyph = "█", count = 20): number {
  const probe = document.createElement("span");
  probe.textContent = glyph.repeat(count);
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0";
  host.appendChild(probe);
  const w = probe.getBoundingClientRect().width / count;
  probe.remove();
  return w > 0 ? w : 8;
}
