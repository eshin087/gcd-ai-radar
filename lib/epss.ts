import type { EpssStats } from "./stats-schema";

/**
 * EPSS on a record. The Exploit Prediction Scoring System (FIRST) gives
 * every CVE a probability of exploitation in the wild over the next 30 days
 * and a percentile among all scored CVEs; the collector's stats stage keeps
 * the pair for the CVE ids the site shows in data/stats/epss.json, with the
 * date of the model run the numbers come from. A record with several CVEs
 * shows its highest score; a record whose CVEs the file does not know shows
 * nothing, so no row states a number it does not have. Build-time data only.
 */

export const EPSS_URL = "https://www.first.org/epss/";

/** The one-sentence tooltip on the fact's label. */
export const EPSS_TOOLTIP =
  "EPSS, FIRST's Exploit Prediction Scoring System, estimates the probability that a CVE is exploited in the wild within the next 30 days; the percentile ranks it among every CVE scored on the model date";

export interface EpssFact {
  /** The record's CVE with the highest score. */
  cve: string;
  /** Probability of exploitation in the next 30 days, 0 to 1. */
  epss: number;
  /** Share of scored CVEs with the same or a lower score, 0 to 1. */
  percentile: number;
  /** The model run the numbers come from, YYYY-MM-DD. */
  model_date: string;
}

/** The highest-scored of the record's CVEs the file knows, or null when it knows none (the fact then renders nothing). */
export function epssFor(cveIds: readonly string[], stats: Pick<EpssStats, "scores" | "model_date"> | null | undefined): EpssFact | null {
  if (!stats) return null;
  let best: EpssFact | null = null;
  for (const cve of cveIds) {
    const s = stats.scores[cve];
    if (s && (!best || s[0] > best.epss)) best = { cve, epss: s[0], percentile: s[1], model_date: stats.model_date };
  }
  return best;
}

/** The score as the fact prints it: two decimals, and "<0.01" for a score that would round to a zero the model did not give. */
export function epssScoreLabel(epss: number): string {
  return epss < 0.005 ? "<0.01" : epss.toFixed(2);
}

/**
 * "top 1%" for a percentile of 0.99: the share of scored CVEs at or above
 * this one, rounded up so the claim always holds (whole percents from 1%,
 * tenths below; a percentile of 1 reads "top 0.1%", the file's resolution).
 */
export function epssPercentileLabel(percentile: number): string {
  const tenths = Math.max(1, Math.ceil((1 - percentile) * 1000 - 1e-9));
  return tenths >= 10 ? `top ${Math.ceil(tenths / 10)}%` : `top ${(tenths / 10).toFixed(1)}%`;
}
