"use client";

import Link from "next/link";
import { Num } from "@/components/home/panel/Num";
import { usePanelState } from "@/components/home/panel/PanelState";
import type { Verdict as VerdictData } from "@/lib/panel";

/**
 * The hero's three numbers under the headline, one per row, each a link to
 * its list: this week's KEV additions in the visitor's stack (recomputed in
 * the browser when the picks change), exploited records here without a full
 * patch, and new CVEs in 24 hours (the live layer's count when it is newer).
 * The week's KEV total itself is the middle column's (components/hero/
 * ExploitedWeek.tsx), so it is not repeated here.
 */

const fmt = (n: number) => n.toLocaleString("en-US");

function Stat({ href, n, label, aria, wait }: { href: string; n: number; label: string; aria: string; wait?: boolean }) {
  return (
    <Link href={href} aria-label={aria} className="group grid grid-cols-[3.4ch_minmax(0,1fr)] items-baseline gap-x-3">
      <span className="num text-right text-[28px] leading-none text-ink group-hover:text-accent" data-wait={wait ? "" : undefined}>
        <Num value={fmt(n)} />
      </span>
      <span className="text-[14px] leading-snug text-soft group-hover:text-ink">{label}</span>
    </Link>
  );
}

export function Verdict({ v }: { v: VerdictData }) {
  const { pulse, matches, ready } = usePanelState();
  const cves = pulse?.day ?? v.cves24;
  const inStack = matches.length;
  return (
    <div data-build data-verdict data-cves={cves ?? ""} data-stack-match={inStack} data-no-patch={v.noFullPatch} className="space-y-3">
      <Stat href="#stack" n={inStack} wait={!ready} label="hit your stack this week" aria={`${inStack} newly exploited this week in your stack, see My stack`} />
      <Stat href="/live?lane=patch" n={v.noFullPatch} label="exploited, no full patch" aria={`${v.noFullPatch} exploited records without a full patch, the patch lane`} />
      {cves !== null && <Stat href="/trends#web" n={cves} label="new CVEs in 24 h" aria={`${cves} new CVEs in 24 hours`} />}
    </div>
  );
}
