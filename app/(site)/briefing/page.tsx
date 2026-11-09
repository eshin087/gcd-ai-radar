import type { Metadata } from "next";
import Link from "next/link";
import { BriefingNumbers } from "@/components/briefing/BriefingNumbers";
import { briefingStandfirst, briefingSummaryLine, isoWeekLabel } from "@/lib/briefing";
import { loadBriefings } from "@/lib/data";
import { dateLabel } from "@/lib/format";
import type { Briefing } from "@/lib/schema";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "This week in AI security",
  description: `A weekly briefing on AI security incidents (the AI lens) from ${SITE.name}: the week's counts from the data, the five most notable incidents and a short narrative.`,
};

/**
 * The briefing front page: the newest week as the lead story (headline,
 * standfirst, its four numbers), then the earlier weeks as cards. Every
 * headline and the "Read" links open the briefing; nothing else competes.
 */

function Lead({ b }: { b: Briefing }) {
  const href = `/briefing/${b.week}`;
  const dek = briefingStandfirst(b);
  return (
    <article data-lead className="panel grid gap-7 p-5 sm:p-7 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-12">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[12px] uppercase tracking-[0.1em]">
          <span className="text-accent">Latest</span>
          <span className="text-faint">·</span>
          <span className="text-dim">{isoWeekLabel(b.week)}</span>
          <span className="text-faint">·</span>
          <span className="normal-case tracking-normal text-faint">
            {dateLabel(b.start)} to {dateLabel(b.end)}
          </span>
        </p>
        <h2 className="mt-3 text-[26px] font-semibold leading-[1.15] tracking-tight text-balance sm:text-[32px]">
          <Link href={href} className="text-ink hover:text-accent">
            {b.narrative?.headline ?? isoWeekLabel(b.week)}
          </Link>
        </h2>
        {dek && <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-soft">{dek}</p>}
        <p className="mt-5">
          <Link href={href} className="font-mono text-[12px] uppercase tracking-[0.1em] text-accent hover:underline">
            Read the briefing →
          </Link>
        </p>
      </div>
      <BriefingNumbers b={b} className="content-center" />
    </article>
  );
}

function Card({ b }: { b: Briefing }) {
  const href = `/briefing/${b.week}`;
  return (
    <li className="panel flex min-w-0 flex-col p-4 sm:p-5">
      <p className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-dim">
        {isoWeekLabel(b.week)}
        <span className="normal-case tracking-normal text-faint">
          {" "}
          · {dateLabel(b.start)} to {dateLabel(b.end)}
        </span>
      </p>
      <h3 className="mt-2 text-[16.5px] font-semibold leading-snug tracking-tight text-balance">
        <Link href={href} className="text-ink hover:text-accent">
          {b.narrative?.headline ?? isoWeekLabel(b.week)}
        </Link>
      </h3>
      <p className="num mt-3 text-[12px] leading-relaxed text-dim">{briefingSummaryLine(b)}</p>
      <p className="mt-auto pt-4">
        <Link href={href} className="font-mono text-[12px] text-accent hover:underline">
          Read →
        </Link>
      </p>
    </li>
  );
}

export default async function BriefingIndexPage() {
  const briefings = await loadBriefings();
  const [latest, ...earlier] = briefings;
  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
        <div>
          <p className="label">Weekly briefing</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight sm:text-[32px]">This week in AI security</h1>
        </div>
        <p className="max-w-xl text-[13.5px] leading-relaxed text-dim">
          One briefing a week, written every Monday over the AI records: the numbers from the dataset, the five incidents that mattered and a short
          narrative by a language model.{" "}
          <Link href="/methodology#briefing" className="link">
            How it is made
          </Link>
          .
        </p>
      </header>

      {!latest ? (
        <p className="text-[13px] text-dim">No briefing has been written yet. The first appears after the next Monday run.</p>
      ) : (
        <>
          <Lead b={latest} />
          {earlier.length > 0 && (
            <section>
              <h2 className="label border-t border-line pt-3 pb-4">Earlier weeks</h2>
              <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {earlier.map((b) => (
                  <Card key={b.week} b={b} />
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </div>
  );
}
