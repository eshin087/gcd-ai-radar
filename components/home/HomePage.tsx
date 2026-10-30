import Link from "next/link";
import { ThreatScope } from "@/components/hero/ThreatScope";
import { HomeCharts } from "@/components/home/HomeCharts";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeCounters } from "@/components/home/HomeCounters";
import { HomeExtras } from "@/components/home/HomeExtras";
import { IncidentRow } from "@/components/incidents/IncidentRow";
import { dateLabel, monthLabel } from "@/lib/format";
import type { HomeColumn } from "@/lib/home";
import type { HomePayload } from "@/lib/home-data";
import { SITE } from "@/lib/site";

/**
 * The home page, top to bottom: the hero (headline, cluster, live globe; see
 * HomeHero), today's numbers, what to act on, the charts everyone should
 * know, two numbers nobody else shows, the AI lens with the radar scope, this
 * week and the machine endpoints. Built at deploy time from
 * lib/home.ts; the drawers fetch /stats/*.json in the browser.
 */

function Kicker({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <h2 className="flex items-baseline gap-3 font-mono text-[12px] uppercase tracking-[0.1em] text-dim">
      <span className="text-accent">{n}</span>
      <span>{children}</span>
      <span aria-hidden className="h-px flex-1 bg-line-soft" />
    </h2>
  );
}

function Column({ col }: { col: HomeColumn }) {
  return (
    <section className="min-w-0">
      <h3 className="flex items-baseline justify-between gap-3 border-t border-line pt-3 pb-1">
        <span className="text-[15px] font-semibold text-ink">{col.label}</span>
        <span className="num text-[12px] text-dim">
          <span className="text-live">{col.live}</span> live · {col.note}
        </span>
      </h3>
      {col.rows.length ? (
        <ol data-home-column={col.lane}>
          {col.rows.map((r) => (
            <IncidentRow key={r.id} row={r} variant="full" showLane={false} />
          ))}
        </ol>
      ) : (
        <p className="border-t border-line-soft py-6 text-[13px] text-dim">Nothing live in this lane.</p>
      )}
      <Link href={col.href} className="label mt-3 inline-block text-accent hover:underline">
        all {col.live} on the live board →
      </Link>
    </section>
  );
}

export function HomePage({ data }: { data: HomePayload }) {
  const s = data.stats;
  return (
    <div className="space-y-10">
      <HomeHero data={data} />

      <HomeCounters stats={s} />

      <section className="space-y-4">
        <Kicker n="01">What to act on</Kicker>
        <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
          <Column col={data.columns.patch} />
          <Column col={data.columns.breach} />
        </div>
        <p className="font-mono text-[12px] text-dim">
          Also live:{" "}
          <Link href="/live?lane=supply_chain" className="hover:text-ink">
            Supply chain <span className="num text-ink">{data.columns.supply_chain}</span>
          </Link>{" "}
          ·{" "}
          <Link href="/live?lane=research" className="hover:text-ink">
            Research <span className="num text-ink">{data.columns.research}</span>
          </Link>
        </p>
      </section>

      <section className="space-y-4">
        <Kicker n="02">The charts everyone should know</Kicker>
        <HomeCharts stats={s} />
      </section>

      <section className="space-y-4">
        <Kicker n="03">Two numbers nobody else shows</Kicker>
        <HomeExtras stats={s} />
      </section>

      <section className="space-y-4">
        <Kicker n="04">The AI lens</Kicker>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <dl className="grid grid-cols-3 border-y border-line">
            {[
              ["Attacks on AI systems", data.aiLens.attacksOnAiMonth, `first reported in ${monthLabel(data.aiLens.month, true)}`, `/incidents?type=attack_on_ai&month=${data.aiLens.month}&by=reported`],
              ["AI-enabled attacks", data.aiLens.aiEnabledMonth, `first reported in ${monthLabel(data.aiLens.month, true)}`, `/incidents?type=ai_enabled_attack&month=${data.aiLens.month}&by=reported`],
              ["AI-software CVEs", data.aiLens.aiCvesQuarter, `records this quarter, ${data.aiLens.quarter.replace("-", " ")}`, `/incidents?kind=all&type=ai&has=cve&quarter=${data.aiLens.quarter}&by=reported`],
            ].map(([label, value, sub, href]) => (
              <div key={String(label)} className="min-w-0 border-l border-line-soft px-4 py-3 first:border-l-0 first:pl-0">
                <dt className="text-[12px] uppercase tracking-[0.08em] text-dim">{label}</dt>
                <dd>
                  <Link href={String(href)} className="num block text-[28px] font-semibold leading-none tracking-tight text-ink hover:text-accent">
                    {Number(value).toLocaleString("en-US")}
                  </Link>
                  <span className="mt-1 block text-[12px] text-faint">{sub}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-[14px] leading-relaxed text-soft">
            Every record carries an AI role: an attack on an AI system, an attack that used AI, or no AI role. The AI counts cover the first two, and the Trends page
            charts them over time. Live news collection started on {dateLabel(data.aiLens.collectionSince)}; earlier AI counts come from seed databases and are sparse.{" "}
            <Link href="/trends" className="link">
              AI trends and charts →
            </Link>
          </p>
        </div>
        <ThreatScope scope={data.live.scope} running className="h-[220px] min-[600px]:h-[264px]" />
      </section>

      <section className="grid gap-6 border-t border-line pt-6 lg:grid-cols-2">
        <div>
          <h2 className="font-mono text-[12px] uppercase tracking-[0.1em] text-dim">This week in AI security</h2>
          {data.briefing ? (
            <p className="mt-2 text-[15px] leading-snug">
              <Link href={`/briefing/${data.briefing.week}`} className="text-ink hover:text-accent">
                {data.briefing.headline}
              </Link>
              <span className="num mt-1 block text-[12px] text-dim">
                {data.briefing.week} · {dateLabel(data.briefing.start)} to {dateLabel(data.briefing.end)}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-[13px] text-dim">The first briefing appears after the next Monday run.</p>
          )}
        </div>
        <div>
          <h2 className="font-mono text-[12px] uppercase tracking-[0.1em] text-dim">For machines</h2>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px] sm:grid-cols-3">
            {[
              ["/feed.xml", "RSS"],
              ["/feed.json", "JSON Feed"],
              ["/changes.json", "changes.json"],
              ["/llms.txt", "llms.txt"],
              ["/live.json", "live.json"],
              ["/stats/home.json", "stats"],
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
            Data {SITE.dataLicense.name}: cite {SITE.name} with a link. Statistics keep their sources&rsquo; terms: NVD public domain, CISA KEV CC0, Have I Been Pwned CC
            BY 4.0, EPSS by FIRST.
          </p>
        </div>
      </section>
    </div>
  );
}
