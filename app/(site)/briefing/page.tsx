import type { Metadata } from "next";
import Link from "next/link";
import { briefingSummaryLine, isoWeekLabel } from "@/lib/briefing";
import { loadBriefings } from "@/lib/data";
import { dateLabel } from "@/lib/format";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "This week in AI security",
  description: `A weekly briefing on AI cybersecurity incidents from ${SITE.name}: the week's counts from the data, the five most notable incidents and a short narrative.`,
};

export default async function BriefingIndexPage() {
  const briefings = await loadBriefings();
  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">This week in AI security</h1>
        <p className="text-[14px] text-soft leading-relaxed">
          One briefing per ISO week, written every Monday for the week that ended on Sunday. The numbers come from the dataset; the narrative is written by a
          language model from that week&rsquo;s records only. <Link href="/methodology#briefing" className="link">How it is made</Link>.
        </p>
        <p className="num text-[11.5px] text-dim">
          <a href="/briefing.xml" className="hover:text-ink">rss →</a>
          <span className="text-faint"> · </span>
          <a href="/data/briefings/index.json" className="hover:text-ink">json →</a>
        </p>
      </header>

      {briefings.length === 0 ? (
        <p className="text-[13px] text-dim">No briefing has been written yet. The first appears after the next Monday run.</p>
      ) : (
        <ol className="divide-y divide-line-soft border-y border-line-soft">
          {briefings.map((b) => (
            <li key={b.week} className="py-4 grid gap-1.5 sm:grid-cols-[8.5rem_1fr]">
              <div className="num text-[12px] text-dim pt-0.5">
                {b.week}
                <div className="text-[10.5px] text-faint">
                  {dateLabel(b.start)} to {dateLabel(b.end)}
                </div>
              </div>
              <div className="min-w-0">
                <Link href={`/briefing/${b.week}`} className="text-[15.5px] leading-snug text-ink hover:text-accent">
                  {b.narrative?.headline ?? isoWeekLabel(b.week)}
                </Link>
                <div className="mt-1 num text-[11.5px] text-dim">{briefingSummaryLine(b)}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
