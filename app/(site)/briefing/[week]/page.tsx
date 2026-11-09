import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BriefingNumbers, signed } from "@/components/briefing/BriefingNumbers";
import { CategoryBadge, SeverityBadge, TypeBadge } from "@/components/ui/Badge";
import { briefingStandfirst, isoWeekLabel } from "@/lib/briefing";
import { briefingByWeek, loadBriefings, siteUrl } from "@/lib/data";
import { FAMILY_META } from "@/lib/families";
import { dateLabel, timestampLabel } from "@/lib/format";
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

/**
 * One briefing, laid out as an article: kicker, headline, the narrative's
 * first paragraph as the standfirst, the week's four numbers with one line
 * on where it hit, the rest of the narrative, the five incidents that
 * mattered as cards, then the small print and the weeks either side.
 */

/**
 * The standfirst and the body. Several paragraphs: the first leads, the rest
 * follow. One paragraph (the usual case): its opening sentences lead, cut
 * where briefingStandfirst cuts, and the remainder follows; when no clean
 * sentence end exists the whole paragraph is the body and nothing leads.
 */
function splitNarrative(paragraphs: string[], standfirst: string | null): [string | null, string[]] {
  if (paragraphs.length === 0) return [null, []];
  if (paragraphs.length > 1) return [paragraphs[0]!, paragraphs.slice(1)];
  const only = paragraphs[0]!;
  if (!standfirst || standfirst.endsWith("…") || standfirst.length >= only.length) return [null, [only]];
  return [standfirst, [only.slice(standfirst.length).trim()]];
}

function WeekLink({ b, dir }: { b: Briefing; dir: "older" | "newer" }) {
  return (
    <Link href={`/briefing/${b.week}`} className={`panel group block min-w-0 p-4 hover:border-accent ${dir === "newer" ? "text-right" : ""}`}>
      <span className="block font-mono text-[11.5px] uppercase tracking-[0.1em] text-dim">{dir === "older" ? `← Week before · ${b.week}` : `Week after · ${b.week} →`}</span>
      <span className="mt-1.5 block text-[14.5px] font-semibold leading-snug tracking-tight text-soft group-hover:text-accent">{b.narrative?.headline ?? isoWeekLabel(b.week)}</span>
    </Link>
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
  const paragraphs = (b.narrative?.text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const [lede, body] = splitNarrative(paragraphs, briefingStandfirst(b));
  const where = [
    b.busiest_family ? `Busiest family: ${FAMILY_META[b.busiest_family.family].label} (${b.busiest_family.count})` : null,
    b.top_targets.length ? `Top targets: ${b.top_targets.map((t) => `${TARGET_META[t.target].label} ${t.count}`).join(", ")}` : null,
    `${b.counts.disclosed_vulnerabilities} disclosed CVEs (${signed(b.deltas.disclosed_vulnerabilities.change)}), not counted as incidents`,
  ].filter((s): s is string => s !== null);

  return (
    <article className="mx-auto max-w-4xl space-y-10">
      <header className="space-y-4">
        <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[12px] uppercase tracking-[0.1em] text-dim">
          <Link href="/briefing" className="hover:text-accent">
            Weekly briefing
          </Link>
          <span className="text-faint">·</span>
          <span>{isoWeekLabel(b.week)}</span>
          <span className="text-faint">·</span>
          <span className="normal-case tracking-normal text-faint">
            {dateLabel(b.start)} to {dateLabel(b.end)}
          </span>
        </p>
        <h1 className="text-[30px] font-semibold leading-[1.12] tracking-tight text-balance sm:text-[38px]">{b.narrative?.headline ?? "This week in AI security"}</h1>
        {lede && <p className="max-w-3xl text-[18px] leading-relaxed text-soft">{lede}</p>}
      </header>

      <section aria-label="The week in numbers" className="panel p-5 sm:p-6">
        <BriefingNumbers b={b} className="sm:grid-cols-4" />
        <p className="mt-5 border-t border-line-soft pt-3 font-mono text-[12px] leading-relaxed text-dim">{where.join(" · ")}</p>
      </section>

      {body.length > 0 && (
        <section className="max-w-3xl space-y-4">
          {body.map((p, i) => (
            <p key={i} className="text-[16.5px] leading-[1.7] text-soft">
              {p}
            </p>
          ))}
        </section>
      )}
      {!b.narrative && <p className="text-[14px] text-dim">No narrative this week.</p>}
      {b.notes.map((n) => (
        <p key={n} className="panel px-4 py-2.5 text-[12.5px] text-dim">
          {n}
        </p>
      ))}

      <section>
        <h2 className="label border-t border-line pt-3">What mattered</h2>
        <p className="mt-1 text-[13px] text-dim">The five most notable incidents of the week: highest severity first, then most sources. Disclosed CVEs are left out.</p>
        {b.notable.length === 0 ? (
          <p className="mt-4 text-[13px] text-dim">No incidents were first reported this week.</p>
        ) : (
          <ol className="mt-4 grid gap-3 sm:grid-cols-2">
            {b.notable.map((i, n) => (
              <li key={i.id} className={`panel flex gap-3.5 p-4 ${n === 0 ? "sm:col-span-2 sm:p-5" : ""}`}>
                <span className="num pt-0.5 text-[18px] leading-none text-faint">{n + 1}</span>
                <div className="min-w-0">
                  <Link href={`/incidents/${i.slug}`} className={`block font-semibold leading-snug tracking-tight text-ink hover:text-accent ${n === 0 ? "text-[19px]" : "text-[15px]"}`}>
                    {i.title}
                  </Link>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <SeverityBadge severity={i.severity} />
                    <TypeBadge type={i.type} short />
                    <CategoryBadge category={i.category} />
                    <span className="num text-[11px] text-faint">
                      {dateLabel(i.first_reported)} · {i.source_count} source{i.source_count === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="space-y-5 border-t border-line pt-4">
        <p className="text-[12px] leading-relaxed text-faint">
          Counted from records first reported this week, as of {timestampLabel(b.generated_at)}; records found later are not added, so the dashboard may show
          more.{" "}
          {b.narrative && <>The narrative was written by a language model ({b.narrative.model}) from this week&rsquo;s records only and checked against the numbers; the incident pages hold the sources. </>}
          Cite as &ldquo;{SITE.name}, {title(b)}&rdquo;, {url}, {b.generated_at.slice(0, 10)}.
        </p>
        {(older || newer) && (
          <nav aria-label="Other weeks" className="grid gap-3 sm:grid-cols-2">
            {older ? <WeekLink b={older} dir="older" /> : <span />}
            {newer ? <WeekLink b={newer} dir="newer" /> : <span />}
          </nav>
        )}
      </footer>
    </article>
  );
}
