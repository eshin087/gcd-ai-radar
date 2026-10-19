import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryBadge, SeverityBadge, TypeBadge } from "@/components/ui/Badge";
import { isoWeekLabel } from "@/lib/briefing";
import { briefingByWeek, loadBriefings, siteUrl } from "@/lib/data";
import { FAMILY_META } from "@/lib/families";
import { dateLabel, formatPct, timestampLabel } from "@/lib/format";
import type { Briefing } from "@/lib/schema";
import { SITE } from "@/lib/site";
import { TARGET_META } from "@/lib/taxonomy";

export const dynamicParams = false;

export async function generateStaticParams() {
  const briefings = await loadBriefings();
  // A static export needs at least one param; a placeholder week keeps the build valid before the first briefing exists.
  return briefings.length ? briefings.map((b) => ({ week: b.week })) : [{ week: "none" }];
}

function title(b: Briefing): string {
  return `This week in AI security, ${b.week}`;
}

export async function generateMetadata({ params }: { params: Promise<{ week: string }> }): Promise<Metadata> {
  const { week } = await params;
  const b = briefingByWeek(await loadBriefings(), week);
  if (!b) return {};
  const description = b.narrative?.headline ?? `${b.counts.incidents} AI security incidents first reported ${b.start} to ${b.end}.`;
  return {
    title: title(b),
    description,
    openGraph: { title: title(b), description, type: "article", images: ["/og/default.png"] },
  };
}

function sign(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0";
}

function Readout({ b }: { b: Briefing }) {
  const rows: [string, string, string][] = [
    ["incidents", String(b.counts.incidents), `${sign(b.deltas.incidents.change)} (${formatPct(b.deltas.incidents.pct)}) vs ${b.previous.week}`],
    ["real-world", String(b.counts.real_world), `${sign(b.deltas.real_world.change)} vs ${b.previous.week} · severity 3–4`],
    ["attacks on AI", String(b.counts.by_type.attack_on_ai), ""],
    ["AI-enabled attacks", String(b.counts.by_type.ai_enabled_attack), ""],
    ["busiest family", b.busiest_family ? String(b.busiest_family.count) : "—", b.busiest_family ? FAMILY_META[b.busiest_family.family].label : "no incidents"],
    ["top targets", "", b.top_targets.length ? b.top_targets.map((t) => `${TARGET_META[t.target].label} ${t.count}`).join(" · ") : "—"],
    [
      "disclosed CVEs",
      String(b.counts.disclosed_vulnerabilities),
      `${sign(b.deltas.disclosed_vulnerabilities.change)} vs ${b.previous.week} · not counted as incidents`,
    ],
  ];
  return (
    <dl className="panel num text-[12.5px] px-4 py-3 grid grid-cols-[1fr_auto] sm:grid-cols-[9.5rem_3.5rem_1fr] gap-x-3 gap-y-1.5">
      {rows.map(([label, value, note]) => (
        <div key={label} className="contents">
          <dt className="text-dim">{label}</dt>
          <dd className="text-ink text-right">{value}</dd>
          {/* on a phone the note drops under its row; from sm up it is the third column */}
          {note && <dd className="col-span-2 sm:col-span-1 -mt-1 sm:mt-0 mb-1 sm:mb-0 text-[11.5px] sm:text-[12.5px] text-dim min-w-0 break-words">{note}</dd>}
          {!note && <dd className="hidden sm:block" aria-hidden />}
        </div>
      ))}
    </dl>
  );
}

export default async function BriefingPage({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  const briefings = await loadBriefings();
  const b = briefingByWeek(briefings, week);
  if (!b) notFound();
  const idx = briefings.indexOf(b);
  const newer = briefings[idx - 1];
  const older = briefings[idx + 1];
  const url = `${siteUrl()}/briefing/${b.week}`;

  return (
    <article className="max-w-3xl space-y-7">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 num text-[11px] text-dim">
          <Link href="/briefing" className="hover:text-ink">
            briefing
          </Link>
          <span className="text-faint">/</span>
          <span>{b.week}</span>
        </div>
        <div className="label">{isoWeekLabel(b.week)} · {dateLabel(b.start)} to {dateLabel(b.end)}</div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight">{b.narrative?.headline ?? "This week in AI security"}</h1>
      </header>

      <section>
        <h2 className="label mb-2">The week in numbers</h2>
        <Readout b={b} />
        <p className="mt-2 text-[11.5px] text-faint">
          Counted from records first reported this week, as of {timestampLabel(b.generated_at)}. Records found later are not added to a briefing; the
          dashboard recounts from the data and may show more.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="label">The week</h2>
        {b.narrative ? (
          <>
            {b.narrative.text.split(/\n{2,}/).map((p, i) => (
              <p key={i} className="text-[16px] text-soft leading-relaxed">
                {p}
              </p>
            ))}
            <p className="text-[11.5px] text-faint">
              Written by a language model ({b.narrative.model}) from this week&rsquo;s records only, and checked against the numbers above. Read the incident
              pages for the sources.
            </p>
          </>
        ) : (
          <p className="text-[13.5px] text-dim">No narrative this week.</p>
        )}
        {b.notes.map((n) => (
          <p key={n} className="panel px-4 py-2.5 text-[12.5px] text-dim">
            {n}
          </p>
        ))}
      </section>

      <section>
        <h2 className="label mb-2">Most notable incidents</h2>
        {b.notable.length === 0 ? (
          <p className="text-[13px] text-dim">No incidents were first reported this week.</p>
        ) : (
          <ol className="divide-y divide-line-soft border-y border-line-soft">
            {b.notable.map((i, n) => (
              <li key={i.id} className="py-3 grid grid-cols-[1.5rem_1fr] gap-2">
                <span className="num text-[12px] text-faint pt-0.5">{n + 1}</span>
                <div className="min-w-0">
                  <Link href={`/incidents/${i.slug}`} className="text-[14.5px] leading-snug text-ink hover:text-accent">
                    {i.title}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <SeverityBadge severity={i.severity} />
                    <TypeBadge type={i.type} short />
                    <CategoryBadge category={i.category} />
                    <span className="num text-[10.5px] text-faint">
                      {i.first_reported} · {i.source_count} source{i.source_count === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-[11.5px] text-faint">Highest severity first, then most sources. Disclosed CVEs are left out of this list.</p>
      </section>

      <section className="space-y-1.5">
        <h2 className="label">Cite this</h2>
        <p className="num text-[12px] text-soft break-words">
          {SITE.name}, &ldquo;{title(b)}&rdquo;, {url}, {b.generated_at.slice(0, 10)}.
        </p>
        <p className="num text-[11px] text-dim">
          <a href={`/data/briefings/${b.week}.json`} className="hover:text-ink">json</a>
          <span className="text-faint"> · </span>
          <a href="/briefing.xml" className="hover:text-ink">rss</a>
          <span className="text-faint"> · data {SITE.dataLicense.name}</span>
        </p>
      </section>

      <nav aria-label="Other weeks" className="flex justify-between gap-4 num text-[12px] border-t border-line-soft pt-4">
        {older ? (
          <Link href={`/briefing/${older.week}`} className="text-dim hover:text-ink">
            ← {older.week}
          </Link>
        ) : (
          <span />
        )}
        {newer ? (
          <Link href={`/briefing/${newer.week}`} className="text-dim hover:text-ink">
            {newer.week} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}
