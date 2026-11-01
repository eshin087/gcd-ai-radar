import Link from "next/link";
import { ExploitedWeek } from "@/components/hero/ExploitedWeek";
import { Verdict } from "@/components/home/panel/Verdict";
import { InternetBand } from "@/components/internet/InternetBand";
import { Ago } from "@/components/ui/Ago";
import type { HomePayload } from "@/lib/home-data";
import { SITE } from "@/lib/site";

/**
 * The home page's first band: the headline and three numbers
 * (components/home/panel/Verdict.tsx) on the left; this week's newly
 * exploited vulnerabilities as a dot-matrix numeral with the newest three
 * (components/hero/ExploitedWeek.tsx) in the middle; the live globe with its
 * caption on the right. The gaps widen at xl so the globe keeps its distance;
 * the caption column stays narrow (164 to 180 px). Phones stack the three
 * columns.
 */
export function HomeHero({ data }: { data: HomePayload }) {
  return (
    <section className="grid gap-8 lg:min-h-[300px] lg:grid-cols-[minmax(0,236px)_280px_minmax(0,1fr)] lg:gap-x-8 xl:grid-cols-[minmax(0,272px)_280px_minmax(0,1fr)] xl:gap-x-12">
      <div className="min-w-0 space-y-5 self-center">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-dim">
          <span aria-hidden className="live-dot" />
          <span className="uppercase tracking-[0.1em]">Live</span> · <Ago iso={data.lastUpdated} prefix="last sweep" className="text-soft" />
        </p>
        <h1 className="text-[26px] font-semibold leading-[1.08] tracking-tight text-balance sm:text-[28px]">What&rsquo;s being exploited now</h1>
        <Verdict v={data.panel.verdict} />
        <Link href="/live" className="inline-block font-mono text-[12px] uppercase tracking-[0.08em] text-accent hover:underline">
          Live board →
        </Link>
      </div>
      <div className="min-w-0 lg:h-[300px]">
        <ExploitedWeek count={data.stats.counters.kev_7d} entries={data.panel.sieve.exploitedEntries} today={data.today} />
      </div>
      <InternetBand apiUrl={SITE.internetApi} />
    </section>
  );
}
