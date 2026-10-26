/**
 * The counting rules in the words the methodology page uses. The methodology
 * renders this list and the API page quotes it, so a consumer reads exactly
 * what the site states. Words between asterisks are emphasised.
 */
export interface CountingRule {
  id: string;
  text: string;
  /** Bears on reusing the numbers (the rest describe how charts are drawn). */
  forConsumers: boolean;
}

export const COUNTING_RULES: readonly CountingRule[] = [
  {
    id: "per-incident",
    text: "One real-world event is one incident, however many articles cover it. Each article becomes a source on that incident.",
    forConsumers: true,
  },
  {
    id: "disclosed",
    text: "Disclosed vulnerabilities, CVEs and advisories with no confirmed exploitation, are never part of an incident count, chart, tile or the RSS feed. The dashboard shows them as a separate monthly series.",
    forConsumers: true,
  },
  {
    id: "ai-lens",
    text: "Every AI count (the trends charts and their drawers, the weekly briefing, summary.json, the embed card and the chart images) counts records whose type is *attack on AI* or *AI-enabled attack*. Records with no AI role appear in the live lanes, the archive, the feeds and the tag pages, never in those counts.",
    forConsumers: true,
  },
  {
    id: "primary-category",
    text: "Monthly charts count each incident once, under its primary category.",
    forConsumers: true,
  },
  {
    id: "date-axis",
    text: "The default time axis is the *incident date* (when it happened, approximate dates allowed). A toggle switches to *first reported* (earliest source date). Incidents known only to the year are excluded from monthly series but counted in totals.",
    forConsumers: true,
  },
  {
    id: "provisional",
    text: "The most recent two months are marked provisional: reporting lags events, so the latest bars will rise.",
    forConsumers: true,
  },
  {
    id: "comparisons",
    text: "“This month” compares the current month so far with the whole of last month; “year to date” compares the same calendar span of the previous year.",
    forConsumers: true,
  },
  {
    id: "trend",
    text: "The trend line is a least-squares fit over the visible window; the amber line is a three-month centred average.",
    forConsumers: false,
  },
];

/** The exact disclosed-vulnerability rule (methodology, "Vulnerability records"); lib/counting.ts implements it. */
export const DISCLOSED_RULE =
  "A record is a disclosed vulnerability when its severity is below 3 and it either comes from the NVD or GitHub advisory backfills or every one of its sources is a vulnerability database. Anything reported by the press or by researchers counts as an incident.";

/** Splits "*word*" emphasis into segments for rendering. */
export function emphasis(text: string): { text: string; em: boolean }[] {
  return text.split(/(\*[^*]+\*)/).filter(Boolean).map((part) => (part.startsWith("*") && part.endsWith("*") ? { text: part.slice(1, -1), em: true } : { text: part, em: false }));
}
