import { aiLens, isDisclosedIncident } from "./counting";
import type { Incident } from "./schema";
import { SITE } from "./site";
import { headline, isRealWorld, monthlySeries, shiftMonth, toMonthKey, type StatRecord } from "./stats";

/**
 * public/data/summary.json: the headline numbers in one small file, for
 * widgets, newsletters and reports that want to carry the figures without
 * downloading the dataset. Everything here is computed by lib/stats.ts on the
 * same records the dashboard counts, and tests/summary.test.ts checks every
 * number against those functions.
 *
 * Counting: disclosed vulnerabilities (lib/counting.ts) are never incidents;
 * they get their own column in the monthly series. Dates are incident dates,
 * the site's default axis; incidents known only to the year are in the totals
 * but in no month, so a window never adds up to more than the totals.
 */

export const SUMMARY_VERSION = 1 as const;
/** Months in the monthly series. */
export const SUMMARY_MONTHS = 24;

export type SummaryRecord = StatRecord & Pick<Incident, "origin" | "sources">;

export interface SummaryWindow {
  /** First and last month, inclusive (YYYY-MM). */
  from: string;
  to: string;
  incidents: number;
  /** Incidents of severity 3 or 4 in the window. */
  real_world: number;
  /** Incidents in the equal-length window before `from`. */
  prior: number;
  /** Percent change from `prior`; null when prior was zero and incidents were not. */
  delta_pct: number | null;
}

export interface SummaryMonth {
  month: string;
  incidents: number;
  real_world: number;
  disclosed_vulnerabilities: number;
  /** Reporting lags events: a provisional month will still rise. */
  provisional: boolean;
}

export interface Summary {
  version: typeof SUMMARY_VERSION;
  generated_at: string;
  site: string;
  last_collector_run: string | null;
  date_basis: "incident_date";
  counting_rule: string;
  /** Every number here counts AI records only (lib/counting.ts aiLens). */
  scope: "ai";
  scope_note: string;
  totals: {
    records: number;
    incidents: number;
    real_world: number;
    disclosed_vulnerabilities: number;
  };
  this_month: { month: string; incidents: number; last_month: number; delta_pct: number | null };
  year_to_date: { year: number; incidents: number; last_year_same_period: number; delta_pct: number | null };
  trailing_12: SummaryWindow;
  trailing_24: SummaryWindow;
  /** First month still considered provisional. */
  provisional_from: string;
  /** The last SUMMARY_MONTHS months, oldest first, ending with the current month. */
  monthly: SummaryMonth[];
  license: string;
  license_url: string;
  cite_as: string;
}

export const COUNTING_RULE_NOTE =
  "CVEs and advisories with no confirmed exploitation are disclosed vulnerabilities, not incidents; see /methodology#cves";

export const AI_LENS_NOTE =
  "Counts AI records only (type attack_on_ai or ai_enabled_attack); records with no AI role are in the live lanes and the archive, never here; see /methodology#counting";

export interface SummaryOptions {
  now: Date;
  site: string;
  lastUpdated: string | null;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function buildSummary(records: readonly SummaryRecord[], opts: SummaryOptions): Summary {
  const now = opts.now;
  const month = toMonthKey(now);
  // The AI lens: records with no AI role never enter summary.json, so its numbers keep their meaning.
  const ai = aiLens(records);
  const counted = ai.filter((r) => !isDisclosedIncident(r));
  const real = counted.filter(isRealWorld);
  const disclosed = ai.filter((r) => isDisclosedIncident(r));

  const h = headline(counted, { now });

  // 48 months of monthly totals: the 24 shown plus the 24 before them for the prior-window comparison.
  const from48 = shiftMonth(month, -47);
  const all48 = monthlySeries(counted, { from: from48, to: month }).map((p) => p.total);
  const real48 = monthlySeries(real, { from: from48, to: month }).map((p) => p.total);
  const disclosed24 = monthlySeries(disclosed, { from: shiftMonth(month, -(SUMMARY_MONTHS - 1)), to: month }).map((p) => p.total);

  const window = (months: number): SummaryWindow => {
    const incidents = sum(all48.slice(-months));
    const prior = sum(all48.slice(-2 * months, -months));
    return {
      from: shiftMonth(month, -(months - 1)),
      to: month,
      incidents,
      real_world: sum(real48.slice(-months)),
      prior,
      delta_pct: pct(incidents, prior),
    };
  };

  const months = all48.slice(-SUMMARY_MONTHS);
  const realMonths = real48.slice(-SUMMARY_MONTHS);
  const monthly: SummaryMonth[] = months.map((incidents, i) => {
    const key = shiftMonth(month, -(SUMMARY_MONTHS - 1 - i));
    return {
      month: key,
      incidents,
      real_world: realMonths[i] ?? 0,
      disclosed_vulnerabilities: disclosed24[i] ?? 0,
      provisional: key >= h.provisionalFrom,
    };
  });

  return {
    version: SUMMARY_VERSION,
    generated_at: now.toISOString(),
    site: opts.site,
    last_collector_run: opts.lastUpdated,
    date_basis: "incident_date",
    counting_rule: COUNTING_RULE_NOTE,
    scope: "ai",
    scope_note: AI_LENS_NOTE,
    totals: {
      records: ai.length,
      incidents: counted.length,
      real_world: h.realWorld,
      disclosed_vulnerabilities: disclosed.length,
    },
    this_month: { month: h.thisMonthKey, incidents: h.thisMonth, last_month: h.lastMonth, delta_pct: pct(h.thisMonth, h.lastMonth) },
    year_to_date: { year: now.getUTCFullYear(), incidents: h.yearToDate, last_year_same_period: h.lastYearSamePeriod, delta_pct: pct(h.yearToDate, h.lastYearSamePeriod) },
    trailing_12: window(12),
    trailing_24: window(24),
    provisional_from: h.provisionalFrom,
    monthly,
    license: SITE.dataLicense.name,
    license_url: SITE.dataLicense.url,
    cite_as: `${SITE.name}, ${opts.site}, accessed <date>`,
  };
}

/** Same rule as lib/stats.ts pctChange, rounded to one decimal so the file reads cleanly. */
function pct(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return Math.round(((now - before) / before) * 1000) / 10;
}
