import type { Metadata } from "next";
import { HomeHero } from "@/components/home/HomeHero";
import { GLOBE_LOOKS } from "@/components/internet/globe/looks";
import { getHomeData } from "@/lib/home-data";

export const metadata: Metadata = {
  title: "Globe looks",
  robots: { index: false, follow: false },
};

/**
 * Unlisted review page: the home page's first band once per globe look, each
 * live from Cloudflare Radar through the Worker, so the looks can be judged
 * in place beside the cluster. The home page uses the look the owner picks.
 * Not linked anywhere.
 */
export default async function InternetLabPage() {
  const data = await getHomeData();
  return (
    <main className="mx-auto w-full max-w-7xl space-y-14 px-4 py-8">
      <header className="space-y-2">
        <p className="label">Lab · globe looks · unlisted</p>
        <p className="max-w-3xl text-[14px] leading-relaxed text-soft">
          The home page&rsquo;s first band in {GLOBE_LOOKS.length} looks, each live from Cloudflare Radar. The globe turns to one attack route at a time and the
          text beside it names the route on screen. Drag a globe to spin it, flick it to keep it turning; the dots under the caption jump between routes.
        </p>
      </header>
      {GLOBE_LOOKS.map((l, i) => (
        <section key={l.id} id={l.id} className="space-y-5 border-t border-line pt-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-mono text-[13px] uppercase tracking-[0.1em] text-accent">
              {String.fromCharCode(65 + i)} · {l.name}
            </h2>
            <p className="text-[13px] text-dim">{l.note}</p>
          </div>
          <HomeHero data={data} look={l.id} />
        </section>
      ))}
    </main>
  );
}
