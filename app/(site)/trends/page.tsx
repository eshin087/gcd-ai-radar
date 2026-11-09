import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { ThreatScope } from "@/components/hero/ThreatScope";
import { HomeCharts } from "@/components/home/HomeCharts";
import { HomeCounters } from "@/components/home/HomeCounters";
import { HomeExtras } from "@/components/home/HomeExtras";
import { AiFlow, AttackSurface, AttackTypes } from "@/components/home/panel/Instruments";
import { PanelMotion } from "@/components/home/panel/PanelMotion";
import { getDashboardData } from "@/lib/dashboard";
import { getHomeData } from "@/lib/home-data";
import { SCOPE_FILE } from "@/lib/scope";

export const metadata: Metadata = {
  title: "Trends",
  description:
    "Security trends over time: CVEs per year, exploitation per month, accounts breached, how fast flaws are exploited, and the AI security records charted by family, severity, target and product. Every number opens its list.",
};

/**
 * Two halves. The whole web: the counters, column charts, exploitation lag
 * and EPSS ten that used to sit on the home page (lib/home.ts, the same
 * drawers), then this week's attack types and the exploited attack surface
 * (lib/panel). AI security: the radar scope, how AI shows up this week and
 * the chart dashboard over the AI records (lib/counting.ts aiLens), where
 * every count and bar opens its incidents. PanelMotion builds the three
 * instruments in as they scroll into view, as on the home page.
 */
export default async function TrendsPage() {
  const [data, home] = await Promise.all([getDashboardData(), getHomeData()]);
  const { days, total, wedges } = home.live.scope;
  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-[28px] font-semibold tracking-tight">Trends</h1>
        <p className="max-w-3xl text-[14px] leading-relaxed text-dim">
          How the numbers move over months and years: first the whole web from NVD, CISA and Have I Been Pwned, then the AI records. Every number and bar opens its list.
        </p>
      </header>

      <section id="web" className="scroll-mt-28 space-y-6">
        <header className="space-y-2">
          <div className="divider">The whole web</div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">CVEs, exploitation and breaches</h2>
        </header>
        <HomeCounters stats={home.stats} />
        <HomeCharts stats={home.stats} />
        <HomeExtras stats={home.stats} recent={home.kevLagRecent} />
        <div className="grid gap-x-12 gap-y-10 pt-2 lg:grid-cols-2">
          <AttackTypes rows={home.panel.types} />
          <AttackSurface rows={home.panel.surface} />
        </div>
      </section>

      <section id="ai-security" className="scroll-mt-28 space-y-6">
        <header className="space-y-2">
          <div className="divider">AI security</div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Trends in AI security</h2>
          <p className="max-w-3xl text-[14px] leading-relaxed text-dim">
            The AI records charted over time: attacks on AI systems and AI-enabled attacks, counted once each and linked to their reporting. Disclosed CVEs with no confirmed
            exploitation are tracked apart.
          </p>
        </header>
        <ThreatScope scope={{ days, total, wedges }} src={SCOPE_FILE} running className="h-[220px] min-[600px]:h-[264px]" />
        <AiFlow ai={home.panel.ai} />
        <Dashboard data={data} />
      </section>
      <PanelMotion />
    </div>
  );
}
