"use client";

import Link from "next/link";
import { Num } from "@/components/home/panel/Num";
import { usePanelState } from "@/components/home/panel/PanelState";
import type { Verdict as VerdictData } from "@/lib/panel";
import { LEVEL_WORDS, levelOf, type Level } from "@/lib/panel/levels";

/**
 * The hero's sentence: the day's level and the numbers behind it, each a link
 * to its list. The level is the higher of the CVE level and the KEV level
 * (lib/panel/index.ts); when the live layer brings a newer 24-hour CVE count,
 * the CVE level is judged again against the same band.
 */

const fmt = (n: number) => n.toLocaleString("en-US");

function N({ href, n, label }: { href: string; n: number; label: string }) {
  return (
    <Link href={href} className="num font-medium text-ink hover:text-accent" aria-label={label}>
      <Num value={fmt(n)} />
    </Link>
  );
}

export function Verdict({ v }: { v: VerdictData }) {
  const { pulse, matches, ready } = usePanelState();
  const cves = pulse?.day ?? v.cves24;
  const cvesLevel = pulse && v.cvesBand ? levelOf(pulse.day, v.cvesBand) : v.cvesLevel;
  const level = Math.max(cvesLevel, v.kevLevel) as Level;
  const inStack = matches.length;
  const kev = v.kev7 ?? 0;
  return (
    <p data-build data-verdict data-level={level} data-cves={cves ?? ""} data-kev={kev} data-stack-match={inStack} data-no-patch={v.noFullPatch} className="text-[14px] leading-relaxed text-soft">
      <b className="font-semibold text-ink">A {LEVEL_WORDS[level]} day.</b>{" "}
      {v.kev7 === null ? null : kev === 0 ? (
        <>No newly exploited vulnerabilities on CISA&rsquo;s list this week. </>
      ) : (
        <>
          <N href="#sieve" n={kev} label={`${kev} newly exploited this week, see the sieve`} /> newly exploited {kev === 1 ? "vulnerability" : "vulnerabilities"} on CISA&rsquo;s list this week,{" "}
          <span data-stack={ready ? "ready" : "wait"}>
            {inStack === 0 ? "none" : <N href="#stack" n={inStack} label={`${inStack} in your stack`} />} in your stack
          </span>
          .{" "}
        </>
      )}
      {v.noFullPatch === 0 ? (
        <>Every exploited record here has a full patch. </>
      ) : (
        <>
          <N href="/live?lane=patch" n={v.noFullPatch} label={`${v.noFullPatch} exploited without a full patch, the patch lane`} /> exploited {v.noFullPatch === 1 ? "record" : "records"} here without a full patch.{" "}
        </>
      )}
      {cves !== null && (
        <>
          <N href="/trends#web" n={cves} label={`${cves} new CVEs in 24 hours`} /> new CVEs in 24&nbsp;h.{" "}
        </>
      )}
      {v.incidentsWeek > 0 && (
        <>
          AI in <N href="#ai" n={v.aiWeek} label={`${v.aiWeek} incidents with an AI role`} /> of this week&rsquo;s <N href="#ai" n={v.incidentsWeek} label={`${v.incidentsWeek} incidents this week`} /> incidents.
        </>
      )}
    </p>
  );
}
