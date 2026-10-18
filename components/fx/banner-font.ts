/**
 * Tiny "ANSI Shadow" block font for the letters the site name needs.
 * Each glyph is six rows of equal width.
 */
const FONT: Record<string, string[]> = {
  A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
  D: ["██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "],
  G: [" ██████╗ ", "██╔════╝ ", "██║  ███╗", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
  R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
  " ": ["  ", "  ", "  ", "  ", "  ", "  "],
};

export function bannerLines(text: string): string[] {
  const rows = ["", "", "", "", "", ""];
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT[" "]!;
    for (let r = 0; r < 6; r++) rows[r] += g[r]!;
  }
  return rows;
}
