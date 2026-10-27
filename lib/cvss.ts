/**
 * CVSS base scores on the site. A record carries `cvss` (0 to 10, one
 * decimal, or null when no source states one; lib/schema.ts). The bands are
 * the CVSS v3 qualitative ratings: critical 9.0 and up, high 7.0 to 8.9,
 * medium 4.0 to 6.9, low below 4.0 (a 0.0 counts as low here rather than
 * "none": a stated zero is still a stated score). Colours per band live in
 * lib/palette.ts CVSS_COLORS.
 */

export const CVSS_BANDS = ["critical", "high", "medium", "low"] as const;
export type CvssBand = (typeof CVSS_BANDS)[number];

export const CVSS_BAND_META: Record<CvssBand, { label: string; range: string }> = {
  critical: { label: "Critical", range: "9.0 and up" },
  high: { label: "High", range: "7.0 to 8.9" },
  medium: { label: "Medium", range: "4.0 to 6.9" },
  low: { label: "Low", range: "below 4.0" },
};

export function cvssBand(score: number): CvssBand {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

/** The score as the chip prints it: one decimal, never a bare integer ("9.0", "7.5"). */
export function cvssLabel(score: number): string {
  return score.toFixed(1);
}
