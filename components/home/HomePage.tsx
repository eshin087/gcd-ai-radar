import { HomeCounters } from "@/components/home/HomeCounters";
import { HomeHero } from "@/components/home/HomeHero";
import { AiFlow, ActNow, AttackSurface, AttackTypes, Latest, PanelFoot } from "@/components/home/panel/Instruments";
import { MyStack } from "@/components/home/panel/MyStack";
import { PanelMotion } from "@/components/home/panel/PanelMotion";
import { PanelState } from "@/components/home/panel/PanelState";
import { Sieve } from "@/components/home/panel/Sieve";
import type { HomePayload } from "@/lib/home-data";

/**
 * The home page: the hero (headline and verdict, the cluster, the live globe;
 * see HomeHero), then the instrument panel (lib/panel, components/home/panel):
 * My stack, Act now and Latest, attack types and the attack surface, how AI
 * shows up, the sieve, and the footer rows. Built at deploy time; the browser
 * builds the marks in, runs the clocks, applies a visitor's own stack and the
 * live NVD counts. The web's charts and the radar scope live on /trends.
 */
export function HomePage({ data }: { data: HomePayload }) {
  const p = data.panel;
  const lanes = { patch: data.columns.patch.live, breach: data.columns.breach.live, supply_chain: data.columns.supply_chain, research: data.columns.research };
  return (
    <PanelState defaults={p.stack.tiles} defaultMatches={p.sieve.inStack} nvdFetched={p.sieve.nvdFetched}>
      <HomeHero data={data} />
      <div className="mt-10 grid gap-x-12 gap-y-10 lg:grid-cols-2 lg:gap-y-[52px]">
        <MyStack />
        <ActNow act={p.act} today={data.today} />
        <Latest rows={p.latest} built={data.now} />
        <AttackTypes rows={p.types} />
        <AttackSurface rows={p.surface} />
        <AiFlow ai={p.ai} />
        <Sieve s={p.sieve} weekFile={data.stats.lists.cves_week.file} />
      </div>
      <PanelFoot
        lanes={lanes}
        live={lanes.patch + lanes.breach + lanes.supply_chain + lanes.research}
        breachesMonth={data.stats.counters.breaches_month}
        accountsMonth={data.stats.counters.breached_accounts_month}
        briefing={data.briefing}
      />
      {/* the hero cluster's New CVEs and Breached tiles open these drawers; the charts' series stay off the page */}
      <HomeCounters stats={{ ...data.stats, series: { cves_by_year: [], ai_cves_by_quarter: [], kev_by_month: [], breaches_by_month: [], kev_lag_by_year: [] }, epss_top: [] }} buttonsHidden />
      <PanelMotion />
    </PanelState>
  );
}
