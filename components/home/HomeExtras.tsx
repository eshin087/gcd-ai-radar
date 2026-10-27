"use client";

import { Columns } from "@/components/charts/Columns";
import { RankRows, type RankRow } from "@/components/charts/RankRows";
import { Panel, fetchedLabel } from "@/components/home/HomeCharts";
import type { HomeStats } from "@/lib/stats-schema";

/**
 * Band 5: two numbers nobody else shows. The median days from a CVE's
 * publication to its KEV listing, by year of listing; and the ten recently
 * published CVEs most likely to be exploited in the next 30 days (EPSS).
 */
export function HomeExtras({ stats }: { stats: HomeStats }) {
  const lag = stats.series.kev_lag_by_year.map((y) => ({ key: String(y.year), label: String(y.year), values: [Math.round(y.median_days)], note: `${Math.round(y.within_7d * 100)}% listed within a week · ${y.n} entries` }));
  const rows: RankRow[] = stats.epss_top.map((e) => ({
    key: e.cve,
    code: e.cve,
    codeHref: `https://nvd.nist.gov/vuln/detail/${e.cve}`,
    label: e.description || e.cve,
    labelHref: e.slug ? `/incidents/${e.slug}` : undefined,
    title: `Published ${e.published} · EPSS percentile ${Math.round(e.percentile * 100)}`,
    count: Math.round(e.epss * 1000) / 10,
    countName: `${e.cve} EPSS`,
    unit: "% chance of exploitation in 30 days",
    extra: e.score !== null ? { count: e.score, name: `${e.cve} CVSS` } : undefined,
  }));
  return (
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
      <Panel
        title="Days from publication to exploitation"
        lede="For the CVEs CISA listed as exploited within a year of their publication, the days between NVD publication and KEV listing: the median per year of listing, with the share listed within a week in the tooltip. Older backlog listings are left out. Falling columns mean exploitation follows disclosure faster."
        source={<>CISA KEV joined to NVD publish dates · {fetchedLabel(stats.fetched.kev)} · CC0 and public domain</>}
      >
        {lag.length ? <Columns name="kev-lag-by-year" periods={lag} colors={["var(--color-live)"]} unit="days (median)" /> : <p className="border-t border-line-soft py-6 text-[13px] text-dim">Not computed yet.</p>}
      </Panel>
      <Panel
        title="Most likely to be exploited"
        lede="The ten CVEs published in the last two weeks with the highest EPSS score, the probability of exploitation in the next 30 days. A code opens NVD; a description opens our record when we have one."
        source={<>EPSS scores by FIRST (first.org/epss) · {fetchedLabel(stats.fetched.epss)} · attribution requested</>}
      >
        {rows.length ? (
          <RankRows rows={rows} head={{ label: "CVE", count: "EPSS %", extra: "CVSS" }} codeWidth="8.5rem" color="var(--color-live)" chart="epss-top" max={100} />
        ) : (
          <p className="border-t border-line-soft py-6 text-[13px] text-dim">Not fetched yet: the collector&rsquo;s next daily run fills this list.</p>
        )}
      </Panel>
    </div>
  );
}
