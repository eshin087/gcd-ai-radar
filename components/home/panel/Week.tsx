"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BreachLi, CveLi, KevLi } from "@/components/home/HomeCounters";
import { useJson } from "@/components/home/useJson";
import { Instrument } from "@/components/home/panel/Instrument";
import { Vs } from "@/components/home/panel/marks";
import { Num } from "@/components/home/panel/Num";
import { usePanelState } from "@/components/home/panel/PanelState";
import { ListDrawer } from "@/components/ui/ListDrawer";
import { monthLabel } from "@/lib/format";
import { shortDate } from "@/lib/panel/dates";
import { LEVEL_WORDS, ratioLevel, type Level } from "@/lib/panel/levels";
import type { Week as WeekData } from "@/lib/panel/week";
import type { BreachStat, KevStatEntry, RecentCve } from "@/lib/stats-schema";

/**
 * The week (lib/panel/week.ts): six readouts against a typical week, each
 * one line: a label, the number, the site's level word, a bar of cells on a
 * fixed track with a hairline where typical sits or a dim band for the usual
 * range, and exactly one grey comparison. Everything else about a line (what
 * it counts, last week, the accounts behind the breaches, the AI techniques)
 * sits in its hover note and its drawer. The lines share the panel's height
 * evenly, so the panel stands as tall as Needs action beside it. Published
 * follows the live NVD count when the Worker has a newer one. A label opens
 * the list behind its number (the week's CVEs, the KEV additions, the
 * month's breaches) or leads to /trends.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
const WORD_CLASS: Record<Level, string> = { 0: "text-dim", 1: "text-soft", 2: "text-accent", 3: "text-live" };
const NVD_NOTE = "NVD, public domain. This product uses data from the NVD API but is not endorsed or certified by the NVD.";
const DAY_MS = 86_400_000;

function Word({ level, children }: { level?: Level | null; children?: ReactNode }) {
  if (level === null || level === undefined) return children ? <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-soft">{children}</span> : null;
  return <span data-level={level} className={`font-mono text-[12px] uppercase tracking-[0.08em] ${WORD_CLASS[level]}`}>{LEVEL_WORDS[level]}</span>;
}

/** One line: the label (a button over its list, a link, or plain), then the number, word, bar and fact; `note` is the hover text with the rest. */
function Line({ k, label, note, onOpen, href, children }: { k: string; label: string; note: string; onOpen?: () => void; href?: string; children: ReactNode }) {
  const cls = "font-mono text-[12px] uppercase tracking-[0.1em] text-dim";
  return (
    <li data-line={k} title={note} className="grid grid-cols-1 content-center gap-y-1 border-t border-line-soft py-3 first:border-t-0 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-baseline sm:gap-x-3.5">
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={`${label}, open the list`} className={`${cls} text-left hover:text-accent`}>
          {label}
        </button>
      ) : href ? (
        <Link href={href} className={`${cls} hover:text-accent`}>
          {label}
        </Link>
      ) : (
        <span className={cls}>{label}</span>
      )}
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">{children}</span>
    </li>
  );
}

function Value({ value, tone = "" }: { value: string; tone?: string }) {
  return <Num value={value} className={`font-mono text-[22px] font-medium leading-[1.1] text-ink ${tone}`} />;
}

function Dash() {
  return <span className="font-mono text-[22px] text-dim">—</span>;
}

/** The one comparison under a line's number, in the panel's mono grey; a bold number is the typical mark. */
function Fact({ children }: { children: ReactNode }) {
  return <span className="basis-full font-mono text-[12px] leading-[1.5] text-faint [&_b]:font-normal [&_b]:text-soft">{children}</span>;
}

export function Week({ week: w, entries, today, weekFile, breachFile }: { week: WeekData; entries: KevStatEntry[]; today: string; weekFile: string; breachFile: string }) {
  const { pulse } = usePanelState();
  const [open, setOpen] = useState<null | "published" | "critical" | "exploited" | "breaches">(null);
  const cves = useJson<{ cves: RecentCve[] }>(open === "published" || open === "critical" ? weekFile : null);
  const breaches = useJson<{ breaches: BreachStat[] }>(open === "breaches" ? breachFile : null);

  const published = pulse?.week ?? w.published.n;
  const publishedLevel = published === null ? null : pulse ? ratioLevel(pulse.week, w.published.typical) : w.published.level;
  const ptDays = Math.round((Date.parse(`${w.patchTuesday}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  const cveRows = (cves.data?.cves ?? []).filter((c) => (open === "critical" ? c.score !== null && c.score >= 9 : true));
  const cveCount = (open === "critical" ? w.critical.n : w.published.n) ?? 0;
  const ex = w.exploited;
  const br = w.breaches;
  const ai = w.ai;
  const criticalShare = w.critical.n !== null && w.published.n ? `; ${((100 * w.critical.n) / w.published.n).toFixed(1)} % of the week's CVEs` : "";
  const aiTechniques = [ai.topTarget && `${ai.topTarget.n} ${ai.topTarget.label}`, ai.topWeapon && `${ai.topWeapon.n} ${ai.topWeapon.label}`].filter(Boolean).join(", ");

  return (
    <Instrument id="week" card="side" label="The week" sub="against a typical one" source="NVD · CISA KEV · HIBP">
      <ol data-week className="grid flex-1 auto-rows-fr">
        <Line k="patch-tuesday" label="Patch Tuesday" note="The second Tuesday of the month, when Microsoft, Adobe and SAP publish their security updates.">
          <Value value={shortDate(w.patchTuesday)} />
          <Word>{ptDays === 0 ? "today" : ptDays === 1 ? "tomorrow" : `in ${ptDays} days`}</Word>
          <Fact>Microsoft, Adobe, SAP release day</Fact>
        </Line>
        <Line k="published" label="Published" note={`CVEs published in the last 7 days (NVD)${pulse ? "; live from the Worker's count, newer than the build" : ""}. Click the label for the list.`} onOpen={w.published.n === null ? undefined : () => setOpen("published")}>
          {published === null ? <Dash /> : <Value value={fmt(published)} />}
          <Word level={publishedLevel} />
          {published !== null && w.published.typical !== null && <Vs n={published} max={w.published.typical * 2} typical={w.published.typical} />}
          <Fact>
            {w.published.typical !== null ? (
              <>
                typical week <b>{fmt(w.published.typical)}</b>
              </>
            ) : (
              "CVEs in 7 days"
            )}
            {pulse && (
              <>
                {" "}
                · <span className="whitespace-nowrap text-accent">live</span>
              </>
            )}
          </Fact>
        </Line>
        <Line k="critical" label="Critical" note={`CVEs scored 9.0 or higher in the last 7 days${criticalShare}. Click the label for the list.`} onOpen={w.critical.n === null ? undefined : () => setOpen("critical")}>
          {w.critical.n === null ? <Dash /> : <Value value={fmt(w.critical.n)} />}
          {w.critical.typical !== null && <Word level={w.critical.level} />}
          {w.critical.n !== null && w.critical.typical !== null && <Vs n={w.critical.n} max={w.critical.typical * 2} typical={w.critical.typical} />}
          <Fact>
            {w.critical.typical !== null ? (
              <>
                typical week <b>{fmt(w.critical.typical)}</b>
              </>
            ) : (
              "CVSS 9 or higher"
            )}
          </Fact>
        </Line>
        <Line k="exploited" label="Exploited" note={`Added to CISA's Known Exploited Vulnerabilities catalog in the last 7 days${ex.lastWeek !== null ? `; last week ${fmt(ex.lastWeek)}` : ""}. Click the label for the list.`} onOpen={ex.n === null ? undefined : () => setOpen("exploited")}>
          {ex.n === null ? <Dash /> : <Value value={fmt(ex.n)} tone={ex.n ? "!text-accent" : "!text-dim"} />}
          {ex.n !== null && <Word level={ex.level} />}
          {ex.n !== null && ex.band && <Vs n={ex.n} max={Math.max(12, ex.band.p90 * 1.4)} band={[ex.band.p25, ex.band.p75]} p90={ex.band.p90} />}
          <Fact>
            {ex.band ? (
              <>
                typical week{" "}
                <b>
                  {fmt(Math.round(ex.band.p25))} to {fmt(Math.round(ex.band.p75))}
                </b>
              </>
            ) : (
              "CISA KEV additions"
            )}
          </Fact>
        </Line>
        <Line k="breaches" label="Breaches" note={`Breaches verified by Have I Been Pwned this month${br.accounts !== null ? `; ${(br.accounts / 1e6).toFixed(2)} M accounts in them` : ""}. Click the label for the list.`} onOpen={br.n === null ? undefined : () => setOpen("breaches")}>
          {br.n === null ? <Dash /> : <Value value={fmt(br.n)} tone={br.n ? "" : "!text-dim"} />}
          {br.n !== null && br.typicalMonth !== null && br.typicalMonth > 0 && <Vs n={br.n} max={br.typicalMonth * 2} typical={br.typicalMonth} />}
          <Fact>
            {br.typicalMonth !== null ? (
              <>
                typical month <b>{fmt(br.typicalMonth)}</b>
              </>
            ) : (
              "verified this month"
            )}
          </Fact>
        </Line>
        <Line k="ai" label="AI" href="/trends#ai-security" note={`This week's incidents where AI was the target or the weapon${aiTechniques ? ` (${aiTechniques})` : ""}; ${ai.cves} CVEs in AI software, ${ai.exploited} exploited. The label leads to Trends.`}>
          <Value value={fmt(ai.onAi + ai.usingAi)} />
          <Word>of {ai.total} incidents</Word>
          <Fact>
            <b>{ai.onAi}</b> attacks on AI · <b>{ai.usingAi}</b> using AI
          </Fact>
        </Line>
      </ol>

      <ListDrawer
        open={open === "published" || open === "critical"}
        onClose={() => setOpen(null)}
        kicker={open === "critical" ? "CVSS 9.0 and higher, last seven days" : "CVEs published in the last seven days"}
        title={open === "critical" ? "Critical CVEs this week" : "New CVEs, 7 days"}
        count={cveCount}
        unit="CVEs"
        note={NVD_NOTE}
        outbound={{ href: "https://nvd.nist.gov/vuln/search", label: "search NVD →" }}
        loading={cves.loading}
        error={cves.error}
        capNote={cveRows.length < cveCount ? `Showing the ${cveRows.length} highest-scored.` : undefined}
      >
        {cveRows.map((c) => (
          <CveLi key={c.id} c={c} />
        ))}
      </ListDrawer>
      <ListDrawer
        open={open === "exploited"}
        onClose={() => setOpen(null)}
        kicker="KEV additions, last seven days"
        title="Exploited in the wild, this week"
        count={entries.length}
        unit="additions"
        note="CISA Known Exploited Vulnerabilities catalog, CC0"
        outbound={{ href: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", label: "the catalog →" }}
      >
        {entries.map((e) => (
          <KevLi key={e.cve} e={e} />
        ))}
      </ListDrawer>
      <ListDrawer
        open={open === "breaches"}
        onClose={() => setOpen(null)}
        kicker={`breaches added in ${monthLabel(br.month, true)}`}
        title="Breaches verified this month"
        count={br.n ?? 0}
        unit="breaches"
        note="Have I Been Pwned, CC BY 4.0; verified breaches only"
        outbound={{ href: "https://haveibeenpwned.com/PwnedWebsites", label: "all breaches on HIBP →" }}
        loading={breaches.loading}
        error={breaches.error}
      >
        {(breaches.data?.breaches ?? []).map((b) => (
          <BreachLi key={b.name} b={b} />
        ))}
      </ListDrawer>
    </Instrument>
  );
}
