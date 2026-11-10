import { HomeCounters } from "@/components/home/HomeCounters";
import { HomeHero } from "@/components/home/HomeHero";
import { PanelFoot } from "@/components/home/panel/Instruments";
import { Ledger } from "@/components/home/panel/Ledger";
import { MyStack } from "@/components/home/panel/MyStack";
import { PanelMotion } from "@/components/home/panel/PanelMotion";
import { PanelState } from "@/components/home/panel/PanelState";
import { Week } from "@/components/home/panel/Week";
import type { HomePayload } from "@/lib/home-data";

/**
 * The home page: the hero (headline and three numbers, this week's
 * exploited vulnerabilities, the live globe; see HomeHero), then the day
 * sheet (lib/panel, components/home/panel): My stack as one strip of chips;
 * the runway card, the nearest deadline as a large countdown beside the two
 * weeks around now; three short lists under it (patch due, no patch yet,
 * new this week); The week as one strip of six numbers against a typical
 * one; then one footer strip.
 * Built at deploy time; the browser builds the marks in, runs the clocks,
 * applies a visitor's own stack and the live NVD count. Attack types, the
 * attack surface and how AI shows up live on /trends with the web's charts.
 */
export function HomePage({ data }: { data: HomePayload }) {
  const p = data.panel;
  const lanes = { patch: data.columns.patch.live, breach: data.columns.breach.live, supply_chain: data.columns.supply_chain, research: data.columns.research };
  return (
    <PanelState defaults={p.stack.tiles} defaultMatches={p.sieve.inStack} nvdFetched={p.sieve.nvdFetched}>
      <HomeHero data={data} />
      <div className="mt-6 flex flex-col gap-5">
        <MyStack />
        <Ledger ledger={p.ledger} built={data.now} />
        <Week week={p.week} entries={p.sieve.exploitedEntries} today={data.today} weekFile={data.stats.lists.cves_week.file} breachFile={data.stats.lists.breaches_month.file} />
      </div>
      <PanelFoot
        lanes={lanes}
        live={lanes.patch + lanes.breach + lanes.supply_chain + lanes.research}
        breachesMonth={data.stats.counters.breaches_month}
        accountsMonth={data.stats.counters.breached_accounts_month}
        briefing={data.briefing}
      />
      {/* the hero's exploited-this-week numeral opens the KEV drawer by clicking its hidden counter button; the charts' series stay off the page */}
      <HomeCounters stats={{ ...data.stats, series: { cves_by_year: [], ai_cves_by_quarter: [], kev_by_month: [], breaches_by_month: [], kev_lag_by_year: [] }, epss_top: [] }} buttonsHidden />
      <PanelMotion />
    </PanelState>
  );
}
