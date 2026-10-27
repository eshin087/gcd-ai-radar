import Link from "next/link";
import { ThreatScope } from "@/components/hero/ThreatScope";
import { LiveBoard } from "@/components/live/LiveBoard";
import { LiveHeatmap } from "@/components/live/LiveHeatmap";
import { Ago } from "@/components/ui/Ago";
import { FAMILY_META } from "@/lib/families";
import { monthLabel } from "@/lib/format";
import type { LiveData } from "@/lib/live";
import { SITE } from "@/lib/site";
import { tagHref } from "@/lib/tags";

/**
 * The home page: the headline and the radar scope, the counters, the feed
 * with its lane tabs, and a rail with the calendar, the AI lens, the live
 * tags and the machine-readable endpoints. Everything is built at deploy
 * time from lib/live.ts; the feed's tabs and filters run in the browser.
 */

function Counter({ id, label, value, href, title }: { id: string; label: string; value: number; href?: string; title: string }) {
  const body = (
    <>
      <span className="num block text-[32px] font-semibold leading-none tracking-tight text-ink sm:text-[36px]">{value.toLocaleString("en-US")}</span>
      <span className="mt-1.5 block text-[12px] uppercase tracking-[0.08em] text-dim">{label}</span>
    </>
  );
  const className = "block min-w-0 border-l border-line-soft px-4 py-3 first:border-l-0 first:pl-0";
  return href ? (
    <a href={href} data-counter={id} data-value={value} title={title} className={`${className} hover:text-accent [&>span:first-child]:hover:text-accent`}>
      {body}
    </a>
  ) : (
    <span data-counter={id} data-value={value} title={title} className={className}>
      {body}
    </span>
  );
}

function RailHead({ title, note }: { title: string; note?: string }) {
  return (
    <header className="mb-3 space-y-1">
      <h2 className="font-mono text-[12px] uppercase tracking-[0.1em] text-dim">{title}</h2>
      {note && <p className="text-[13px] leading-snug text-dim">{note}</p>}
    </header>
  );
}

export function LivePage({ data, variant = "home" }: { data: LiveData; variant?: "home" | "board" }) {
  const c = data.counters;
  const longest = c.quiet.longest;
  return (
    <div className="space-y-8">
      {variant === "board" ? (
        <header className="space-y-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-dim">
            <span aria-hidden className="live-dot" />
            <span className="uppercase tracking-[0.1em]">Live</span> · <Ago iso={data.lastUpdated} prefix="last sweep" className="text-soft" />
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">The live board</h1>
          <p className="max-w-3xl text-[14.5px] leading-relaxed text-soft">
            Every live record in the four lanes, grouped by fix status or by how recently it moved. A record stays live for its lane&rsquo;s window after its latest
            activity, then closes into the <Link href="/incidents" className="link">archive</Link>.{" "}
            <Link href="/methodology#lanes" className="link">
              The windows
            </Link>
            .
          </p>
        </header>
      ) : (
        <section className="grid gap-5 lg:min-h-[300px] lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-10">
          <div className="order-2 min-w-0 space-y-3 self-center lg:order-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-dim">
              <span aria-hidden className="live-dot" />
              <span className="uppercase tracking-[0.1em]">Live</span> · <Ago iso={data.lastUpdated} prefix="last sweep" className="text-soft" />
            </p>
            <h1 className="text-[30px] font-semibold leading-[1.08] tracking-tight text-balance sm:text-[34px]">What is being exploited right now.</h1>
            <p className="text-[15px] leading-relaxed text-soft">
              Live security incidents across the web, with an AI lens: what happened, whether there is a fix, and what to do. Every record is counted once and
              linked to the reporting it came from.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 font-mono text-[12px] uppercase tracking-[0.08em]">
              <Link href="/incidents" className="text-accent hover:underline">
                Archive →
              </Link>
              <Link href="/trends" className="text-dim hover:text-ink">
                AI trends
              </Link>
              <Link href="/methodology" className="text-dim hover:text-ink">
                How we count
              </Link>
            </div>
          </div>
          <ThreatScope scope={data.scope} running className="order-1 h-[200px] lg:order-2 lg:h-full" />
        </section>
      )}

      <section aria-label="Live counters" className="grid grid-cols-2 border-y border-line sm:grid-cols-5">
        <Counter id="live" label="Live" value={c.live} href="/incidents?state=live&lane=action" title="Live records in the three action lanes: patch now, breaches & attacks, supply chain" />
        <Counter id="critical" label="Critical" value={c.critical} href="/incidents?state=live&lane=action&severity=4" title="Live records with confirmed real-world loss (severity 4)" />
        <Counter id="unpatched" label="Not fully patched" value={c.unpatched} href="/incidents?state=live&lane=action&patch=unpatched,partial" title="Live patch and supply-chain records with no fix yet, or a partial one" />
        <Counter
          id="quiet"
          label={c.quiet.days === 1 ? "Day without an incident" : "Days without an incident"}
          value={c.quiet.days}
          title={longest ? `Longest quiet run in the last year: ${longest.days} day${longest.days === 1 ? "" : "s"} (${longest.from} to ${longest.to})` : "No quiet run yet"}
        />
        <Counter id="ai" label="AI-related" value={c.ai} href="/incidents?state=live&lane=action&type=ai" title="Live action-lane records where AI was attacked or was the attacker's tool" />
      </section>

      <div className="grid gap-10 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <LiveBoard lanes={data.boards} today={data.now.slice(0, 10)} />
        </div>
        <aside className="min-w-0 space-y-8 lg:col-span-4">
          <section>
            <RailHead title="Twelve months" note="One cell per day, darker is busier." />
            <LiveHeatmap heatmap={data.heatmap} />
          </section>
          <section>
            <RailHead title="The AI lens" />
            <p className="text-[14px] leading-relaxed text-soft">
              <span className="num text-ink">{data.aiLens.live}</span> of <span className="num text-ink">{c.live}</span> live records involve AI, as a target or as the
              attacker&rsquo;s tool.
              {data.aiLens.topFamily && (
                <>
                  {" "}
                  Busiest AI family in {monthLabel(data.aiLens.month, true)}: <span className="text-ink">{FAMILY_META[data.aiLens.topFamily.family].label}</span> (
                  <span className="num">{data.aiLens.topFamily.count}</span>).
                </>
              )}
            </p>
            <Link href="/trends" className="label mt-2 inline-block text-accent hover:underline">
              AI trends and charts →
            </Link>
          </section>
          <section>
            <RailHead title="Live tags" note="Tags with the most live records." />
            {data.topTags.length > 0 ? (
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                {data.topTags.map((t) => (
                  <li key={t.slug} className="flex min-w-0 items-baseline justify-between gap-2">
                    <Link href={tagHref(t.slug)} className="truncate text-soft hover:text-accent">
                      {t.label}
                    </Link>
                    <span className="num shrink-0 text-[12px]">
                      <span className="text-live">{t.live}</span>
                      <span className="text-faint">/{t.total}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-dim">No live tags.</p>
            )}
            <Link href="/tags" className="label mt-2 inline-block hover:text-ink">
              every tag →
            </Link>
          </section>
          <section>
            <RailHead title="For machines" note="Open CORS, five-minute caching, no key." />
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px]">
              {[
                ["/feed.xml", "RSS"],
                ["/feed.json", "JSON Feed"],
                ["/changes.json", "changes.json"],
                ["/llms.txt", "llms.txt"],
                ["/live.json", "live.json"],
                ["/data", "every file"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="link">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-faint">
              Data {SITE.dataLicense.name}: cite {SITE.name} with a link.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
