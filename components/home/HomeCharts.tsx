"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Columns, type ColumnPeriod } from "@/components/charts/Columns";
import { BreachLi, KevLi } from "@/components/home/HomeCounters";
import { useJson } from "@/components/home/useJson";
import { ListDrawer } from "@/components/ui/ListDrawer";
import { monthLabel, timestampLabel } from "@/lib/format";
import type { BreachStat, HomeStats, KevStatEntry } from "@/lib/stats-schema";

/**
 * Band 4: the charts everyone should know. Four lean column charts; a column
 * opens its list (a drawer from /stats/*.json, the archive, or the year on
 * NVD), and every panel names its source and when it was fetched.
 */

export function Panel({ title, lede, source, children }: { title: string; lede: string; source: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-line pt-4">
      <header className="mb-3 space-y-1">
        <h3 className="text-[16px] font-semibold leading-tight tracking-tight text-ink">{title}</h3>
        <p className="text-[13px] leading-snug text-dim">{lede}</p>
      </header>
      {children}
      <p className="mt-2 font-mono text-[12px] text-faint">{source}</p>
    </section>
  );
}

export function fetchedLabel(iso: string | null): string {
  return iso ? `fetched ${timestampLabel(iso)}` : "not fetched yet";
}

/** NVD's advanced search for the CVEs published in one year. */
export function nvdYearUrl(year: number): string {
  const p = new URLSearchParams({ form_type: "Advanced", results_type: "overview", search_type: "all", isCpeNameSearch: "false", pub_start_date: `01/01/${year}`, pub_end_date: `12/31/${year}` });
  return `https://nvd.nist.gov/vuln/search/results?${p.toString()}`;
}

const AMBER = "var(--color-accent)";
const RED = "var(--color-live)";
const BLUE = "#7b9dff";
const SLATE = "#6b7389";

export function HomeCharts({ stats }: { stats: HomeStats }) {
  const router = useRouter();
  const s = stats.series;
  const [kevMonth, setKevMonth] = useState<string | null>(null);
  const [breachMonth, setBreachMonth] = useState<string | null>(null);
  const kev = useJson<{ entries: KevStatEntry[] }>(kevMonth ? `/stats/kev-${kevMonth}.json` : null);
  const breaches = useJson<{ breaches: BreachStat[] }>(breachMonth ? `/stats/breaches-${breachMonth}.json` : null);

  const years: ColumnPeriod[] = s.cves_by_year.map((y) => ({ key: String(y.year), label: String(y.year), short: y.year % 5 === 0 ? String(y.year) : "", values: [y.total], provisional: y.provisional }));
  const quarters: ColumnPeriod[] = s.ai_cves_by_quarter.map((q) => ({ key: q.quarter, label: q.quarter.replace("-", " "), short: q.quarter.endsWith("Q1") ? q.quarter.slice(0, 4) : "", values: [q.total], provisional: q.provisional }));
  const kevMonths: ColumnPeriod[] = s.kev_by_month.map((m) => ({ key: m.month, label: monthLabel(m.month, true), short: m.month.endsWith("-01") ? m.month.slice(0, 4) : "", values: [m.total - m.ransomware, m.ransomware] }));
  const breachMonths: ColumnPeriod[] = s.breaches_by_month.map((m) => ({ key: m.month, label: monthLabel(m.month, true), short: m.month.endsWith("-01") ? m.month.slice(0, 4) : "", values: [m.accounts], note: `${m.breaches} breach${m.breaches === 1 ? "" : "es"}` }));
  const kevRow = s.kev_by_month.find((m) => m.month === kevMonth);
  const breachRow = s.breaches_by_month.find((m) => m.month === breachMonth);
  const nvdSource = <>NVD · {fetchedLabel(stats.fetched.nvd)} · public domain · this product uses data from the NVD API but is not endorsed or certified by the NVD</>;

  return (
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
      <Panel title="CVEs published per year" lede="Every CVE NVD published, by year since 1999; the open year is hatched. A column opens that year's search on NVD." source={nvdSource}>
        {years.length ? <Columns name="cves-by-year" periods={years} colors={[BLUE]} unit="CVEs" labelEvery={5} onPick={(k) => window.open(nvdYearUrl(Number(k)), "_blank", "noopener")} /> : <Empty />}
      </Panel>
      <Panel
        title="CVEs in AI software, per quarter"
        lede="Records here that name a CVE in an AI framework, model server, agent tool or AI product, by quarter of first report since 2016, exploited or not. A column opens the records."
        source={<>{stats.site.replace(/^https?:\/\//, "")} dataset · CC BY-SA 4.0 · CVE records from NVD and the GitHub Advisory Database</>}
      >
        <Columns name="ai-cves-by-quarter" periods={quarters} colors={[AMBER]} unit="CVE records" onPick={(k) => router.push(`/incidents?kind=all&type=ai&has=cve&quarter=${k}&by=reported`)} />
      </Panel>
      <Panel title="Exploited in the wild, per month" lede="Additions to CISA's Known Exploited Vulnerabilities catalog by month, the part known to be used by ransomware in red. A column opens the month's additions." source={<>CISA KEV · {fetchedLabel(stats.fetched.kev)} · CC0</>}>
        <Columns name="kev-by-month" periods={kevMonths} colors={[SLATE, RED]} stackLabels={["other", "ransomware"]} unit="additions" onPick={setKevMonth} active={kevMonth} />
      </Panel>
      <Panel
        title="Accounts exposed in breaches, per month"
        lede="Accounts in verified breaches Have I Been Pwned added each month; spam lists, stealer logs and malware dumps are left out. A column opens the month's breaches."
        source={<>Have I Been Pwned · {fetchedLabel(stats.fetched.hibp)} · CC BY 4.0</>}
      >
        <Columns name="breaches-by-month" periods={breachMonths} colors={[AMBER]} unit="accounts" scale="sqrt" onPick={setBreachMonth} active={breachMonth} />
      </Panel>

      <ListDrawer
        open={kevMonth !== null}
        onClose={() => setKevMonth(null)}
        kicker={`KEV additions · ${kevMonth ? monthLabel(kevMonth, true) : ""}`}
        title={`Exploited in the wild, ${kevMonth ? monthLabel(kevMonth, true) : ""}`}
        count={kevRow?.total ?? 0}
        unit="additions"
        note={kevRow ? `${kevRow.ransomware} known in ransomware · CISA KEV, CC0` : "CISA KEV, CC0"}
        outbound={{ href: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", label: "the catalog →" }}
        loading={kev.loading}
        error={kev.error}
      >
        {(kev.data?.entries ?? []).map((e) => (
          <KevLi key={e.cve} e={e} />
        ))}
      </ListDrawer>
      <ListDrawer
        open={breachMonth !== null}
        onClose={() => setBreachMonth(null)}
        kicker={`breaches added · ${breachMonth ? monthLabel(breachMonth, true) : ""}`}
        title={`Breaches added in ${breachMonth ? monthLabel(breachMonth, true) : ""}`}
        count={breachRow?.accounts ?? 0}
        unit="accounts"
        note={breachRow ? `in ${breachRow.breaches} breach${breachRow.breaches === 1 ? "" : "es"} · Have I Been Pwned, CC BY 4.0` : "Have I Been Pwned, CC BY 4.0"}
        outbound={{ href: "https://haveibeenpwned.com/PwnedWebsites", label: "all breaches on HIBP →" }}
        loading={breaches.loading}
        error={breaches.error}
      >
        {(breaches.data?.breaches ?? []).map((b) => (
          <BreachLi key={b.name} b={b} />
        ))}
      </ListDrawer>
    </div>
  );
}

function Empty() {
  return <p className="border-t border-line-soft py-6 text-[13px] text-dim">Not fetched yet: the collector&rsquo;s next daily run fills this panel.</p>;
}
