import Link from "next/link";
import { RadarCluster } from "@/components/hero/RadarCluster";
import { Verdict } from "@/components/home/panel/Verdict";
import { InternetBand } from "@/components/internet/InternetBand";
import { Ago } from "@/components/ui/Ago";
import type { HomePayload } from "@/lib/home-data";
import { SITE } from "@/lib/site";

/**
 * The home page's first band: the headline and the day's verdict
 * (components/home/panel/Verdict.tsx) on the left, the 2x2 cluster in
 * the middle (lg and up), the live globe with its caption on the right. The
 * gaps widen at xl so the globe keeps its distance from the cluster; the
 * caption column stays narrow (164 to 180 px). Phones stack headline, globe,
 * caption.
 */
export function HomeHero({ data }: { data: HomePayload }) {
  return (
    <section className="grid gap-6 lg:min-h-[300px] lg:grid-cols-[minmax(0,236px)_280px_minmax(0,1fr)] lg:gap-x-8 xl:grid-cols-[minmax(0,272px)_280px_minmax(0,1fr)] xl:gap-x-12">
      <div className="min-w-0 space-y-2.5 self-center">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-dim">
          <span aria-hidden className="live-dot" />
          <span className="uppercase tracking-[0.1em]">Live</span> · <Ago iso={data.lastUpdated} prefix="last sweep" className="text-soft" />
        </p>
        <h1 className="text-[26px] font-semibold leading-[1.08] tracking-tight text-balance sm:text-[28px]">What is being exploited right now.</h1>
        <Verdict v={data.panel.verdict} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 font-mono text-[12px] uppercase tracking-[0.08em]">
          <Link href="/live" className="text-accent hover:underline">
            Live board →
          </Link>
          <Link href="/incidents" className="text-dim hover:text-ink">
            Archive
          </Link>
          <Link href="/methodology" className="text-dim hover:text-ink">
            How we count
          </Link>
        </div>
      </div>
      <div className="hidden h-[300px] lg:block">
        <RadarCluster data={data.cluster} />
      </div>
      <InternetBand apiUrl={SITE.internetApi} />
    </section>
  );
}
