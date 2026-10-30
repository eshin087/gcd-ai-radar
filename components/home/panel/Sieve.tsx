"use client";

import { useState, type ReactNode } from "react";
import { CveLi, KevLi } from "@/components/home/HomeCounters";
import { useJson } from "@/components/home/useJson";
import { Instrument } from "@/components/home/panel/Instrument";
import { SieveRain } from "@/components/home/panel/Live";
import { Num } from "@/components/home/panel/Num";
import { usePanelState } from "@/components/home/panel/PanelState";
import { ListDrawer } from "@/components/ui/ListDrawer";
import type { Sieve as SieveData } from "@/lib/panel";
import { LEVEL_WORDS, ratioLevel, type Level } from "@/lib/panel/levels";
import { shortDate } from "@/lib/panel/dates";
import type { RecentCve } from "@/lib/stats-schema";

/**
 * The sieve (lib/panel/index.ts): the week from everything NVD published to
 * what touches the visitor's stack, four stages with the type growing from
 * quiet to loud. The first three open their lists; the last lists its
 * matches. Glyphs rain through each stage as it builds, many through the
 * first, few to the last; a live NVD count drops a few more.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
const WORD_CLASS: Record<Level, string> = { 0: "text-dim", 1: "text-soft", 2: "text-accent", 3: "text-live" };
const NVD_NOTE = "NVD, public domain. This product uses data from the NVD API but is not endorsed or certified by the NVD.";

function Stage({ cls, k, value, word, sub, rain, onOpen, label, children }: { cls: string; k: string; value: ReactNode; word?: Level | null; sub: ReactNode; rain: { drops: number; again?: number; color: string }; onOpen?: () => void; label?: string; children?: ReactNode }) {
  const v = (
    <span className="flex min-h-[48px] flex-wrap items-baseline gap-x-3 gap-y-1">
      {value}
      {word !== undefined && word !== null && <small className={`text-[12px] font-normal uppercase tracking-[0.08em] ${WORD_CLASS[word]}`}>{LEVEL_WORDS[word]}</small>}
    </span>
  );
  return (
    <div data-stage={k} className={`relative min-w-0 pr-[22px] ${cls}`}>
      <SieveRain {...rain} />
      <div className="font-mono text-[12px] uppercase tracking-[0.08em] text-dim">{k.replaceAll("-", " ")}</div>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={label} className="mt-3 mb-2.5 block text-left font-mono font-medium leading-none hover:[&_[data-num]]:text-accent">
          {v}
        </button>
      ) : (
        <div className="mt-3 mb-2.5 font-mono font-medium leading-none">{v}</div>
      )}
      <div className="font-mono text-[12px] leading-[1.6] text-faint [&_b]:font-normal [&_b]:text-soft">{sub}</div>
      {children}
    </div>
  );
}

export function Sieve({ s, weekFile }: { s: SieveData; weekFile: string }) {
  const { pulse, matches, ready } = usePanelState();
  const [open, setOpen] = useState<null | "published" | "critical" | "exploited">(null);
  const cves = useJson<{ cves: RecentCve[] }>(open === "published" || open === "critical" ? weekFile : null);
  const published = pulse?.week ?? s.published;
  const level = published === null ? null : pulse ? ratioLevel(pulse.week, s.typicalWeek) : s.publishedLevel;
  const rows = (cves.data?.cves ?? []).filter((c) => (open === "critical" ? c.score !== null && c.score >= 9 : true));
  const count = open === "critical" ? (s.critical ?? 0) : (s.published ?? 0);
  const stack = matches.length;

  return (
    <Instrument
      id="sieve"
      full
      label="The sieve"
      sub="this week, from everything published to what touches you"
      source="NVD · CISA KEV · your stack"
      caption="Most of a week is noise. The two numbers on the right are the ones to act on; the two on the left are for scale."
    >
      <div data-sieve className="grid grid-cols-2 gap-y-[26px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)]">
        <Stage
          cls=""
          k="published"
          value={published === null ? <span className="text-[26px] text-dim">—</span> : <Num value={fmt(published)} className="text-[26px] text-dim" />}
          word={level}
          sub={
            <>
              CVEs in 7 days{s.typicalWeek ? <> · a typical week this year brings <b>{fmt(s.typicalWeek)}</b></> : null} · {pulse ? <span className="text-accent">NVD · live</span> : "NVD"}
            </>
          }
          rain={{ drops: 46, again: pulse?.week ?? 0, color: "#c0c6d4" }}
          onOpen={s.published === null ? undefined : () => setOpen("published")}
          label={`Published: ${s.published ?? 0}, open the list`}
        />
        <Stage
          cls="border-l border-dotted border-line pl-[22px]"
          k="critical"
          value={<Num value={s.critical === null ? "—" : fmt(s.critical)} className="text-[30px] text-soft" />}
          sub="CVSS 9 or higher"
          rain={{ drops: 22, color: "#c0c6d4" }}
          onOpen={s.critical === null ? undefined : () => setOpen("critical")}
          label={`Critical: ${s.critical ?? 0}, open the list`}
        />
        <Stage
          cls="pl-0 md:border-l md:border-dotted md:border-line md:pl-[22px]"
          k="known-exploited"
          value={<Num value={s.exploited === null ? "—" : fmt(s.exploited)} className="text-[42px] text-accent" />}
          word={s.exploited === null ? null : s.exploitedLevel}
          sub="added to CISA KEV this week, whatever the CVE’s age"
          rain={{ drops: 7, color: "#ffb35c" }}
          onOpen={s.exploited === null ? undefined : () => setOpen("exploited")}
          label={`Known exploited: ${s.exploited ?? 0}, open the list`}
        />
        <Stage
          cls="border-l border-dotted border-line pl-[22px]"
          k="in-your-stack"
          value={
            <span data-stack={ready ? "ready" : "wait"} data-stack-match={stack}>
              <Num value={String(stack)} className={stack ? "text-[48px] text-live" : "text-[42px] text-dim"} />
            </span>
          }
          sub={
            <span data-stack={ready ? "ready" : "wait"}>
              {stack ? (
                matches.slice(0, 4).map((m) => (
                  <span key={m.cve} className="block">
                    <a href={`https://nvd.nist.gov/vuln/detail/${m.cve}`} target="_blank" rel="noopener noreferrer" className="text-soft hover:text-accent">
                      {m.name}
                    </a>
                    {m.due && <> · due {shortDate(m.due)}</>}
                  </span>
                ))
              ) : (
                <>nothing exploited touches your stack this week</>
              )}
              {stack > 4 && <span className="block">and {stack - 4} more</span>}
            </span>
          }
          rain={{ drops: 3, color: "#ff5c5c" }}
        />
      </div>

      <ListDrawer
        open={open === "published" || open === "critical"}
        onClose={() => setOpen(null)}
        kicker={open === "critical" ? "CVSS 9.0 and higher, last seven days" : "CVEs published in the last seven days"}
        title={open === "critical" ? "Critical CVEs this week" : "New CVEs, 7 days"}
        count={count}
        unit="CVEs"
        note={NVD_NOTE}
        outbound={{ href: "https://nvd.nist.gov/vuln/search", label: "search NVD →" }}
        loading={cves.loading}
        error={cves.error}
        capNote={rows.length < count ? `Showing the ${rows.length} highest-scored.` : undefined}
      >
        {rows.map((c) => (
          <CveLi key={c.id} c={c} />
        ))}
      </ListDrawer>
      <ListDrawer
        open={open === "exploited"}
        onClose={() => setOpen(null)}
        kicker="KEV additions, last seven days"
        title="Exploited in the wild, this week"
        count={s.exploitedEntries.length}
        unit="additions"
        note="CISA Known Exploited Vulnerabilities catalog, CC0"
        outbound={{ href: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", label: "the catalog →" }}
      >
        {s.exploitedEntries.map((e) => (
          <KevLi key={e.cve} e={e} />
        ))}
      </ListDrawer>
    </Instrument>
  );
}
