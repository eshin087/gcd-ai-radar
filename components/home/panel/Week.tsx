"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BreachLi, CveLi, KevLi } from "@/components/home/HomeCounters";
import { useJson } from "@/components/home/useJson";
import { Instrument } from "@/components/home/panel/Instrument";
import { Countdown } from "@/components/home/panel/Live";
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
 * The week (lib/panel/week.ts): six one-line readouts against a typical
 * week, each a label, the number, the site's level word and a bar of cells
 * on a fixed track, with a hairline where typical sits or a dim band for the
 * usual range. Published follows the live NVD count when the Worker has a
 * newer one. A label opens the list behind its number (the week's CVEs,
 * the KEV additions, the month's breaches) or leads to /trends.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
const WORD_CLASS: Record<Level, string> = { 0: "text-dim", 1: "text-soft", 2: "text-accent", 3: "text-live" };
const NVD_NOTE = "NVD, public domain. This product uses data from the NVD API but is not endorsed or certified by the NVD.";
const DAY_MS = 86_400_000;

function Word({ level, children }: { level?: Level | null; children?: ReactNode }) {
  if (level === null || level === undefined) return children ? <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-soft">{children}</span> : null;
  return <span data-level={level} className={`font-mono text-[12px] uppercase tracking-[0.08em] ${WORD_CLASS[level]}`}>{LEVEL_WORDS[level]}</span>;
}

function Line({ k, label, onOpen, href, children }: { k: string; label: string; onOpen?: () => void; href?: string; children: ReactNode }) {
  const cls = "font-mono text-[12px] uppercase tracking-[0.1em] text-dim";
  return (
    <li data-line={k} className="grid grid-cols-1 gap-y-0.5 border-t border-line-soft pt-[7px] pb-1.5 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-baseline sm:gap-x-3.5">
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
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">{children}</span>
    </li>
  );
}

function Value({ value, tone = "" }: { value: string; tone?: string }) {
  return <Num value={value} className={`font-mono text-[24px] font-medium leading-[1.1] text-ink ${tone}`} />;
}

function Fact({ children }: { children: ReactNode }) {
  return <span className="basis-full font-mono text-[12px] leading-[1.5] text-faint [&_a]:text-accent [&_a:hover]:underline [&_b]:font-normal [&_b]:text-soft">{children}</span>;
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

  return (
    <Instrument id="week" label="The week" sub="against a typical one" source="NVD · CISA KEV · HIBP">
      <ol data-week className="border-b border-line-soft">
        <Line k="patch-tuesday" label="Patch Tuesday">
          <Value value={shortDate(w.patchTuesday)} />
          <Word>{ptDays === 0 ? "today" : ptDays === 1 ? "tomorrow" : `in ${ptDays} days`}</Word>
          <Fact>
            Microsoft, Adobe, SAP release day · <Countdown due={w.patchTuesday} start />
          </Fact>
        </Line>
        <Line k="published" label="Published" onOpen={w.published.n === null ? undefined : () => setOpen("published")}>
          {published === null ? <span className="font-mono text-[24px] text-dim">—</span> : <Value value={fmt(published)} />}
          <Word level={publishedLevel} />
          {published !== null && w.published.typical !== null && <Vs n={published} max={w.published.typical * 2} typical={w.published.typical} />}
          <Fact>
            CVEs in 7 days{w.published.typical !== null && <> · typical week <b>{fmt(w.published.typical)}</b></>} · {pulse ? <span className="text-accent">NVD · live</span> : "NVD"}
          </Fact>
        </Line>
        <Line k="critical" label="Critical" onOpen={w.critical.n === null ? undefined : () => setOpen("critical")}>
          {w.critical.n === null ? <span className="font-mono text-[24px] text-dim">—</span> : <Value value={fmt(w.critical.n)} />}
          {w.critical.typical !== null && <Word level={w.critical.level} />}
          {w.critical.n !== null && w.critical.typical !== null && <Vs n={w.critical.n} max={w.critical.typical * 2} typical={w.critical.typical} />}
          <Fact>
            CVSS 9 or higher{w.critical.n !== null && w.published.n ? <> · {((100 * w.critical.n) / w.published.n).toFixed(1)} % of the week</> : null}
            {w.critical.typical !== null && <> · usual <b>{fmt(w.critical.typical)}</b></>}
          </Fact>
        </Line>
        <Line k="exploited" label="Exploited" onOpen={ex.n === null ? undefined : () => setOpen("exploited")}>
          {ex.n === null ? <span className="font-mono text-[24px] text-dim">—</span> : <Value value={fmt(ex.n)} tone={ex.n ? "!text-accent" : "!text-dim"} />}
          {ex.n !== null && <Word level={ex.level} />}
          {ex.n !== null && ex.band && <Vs n={ex.n} max={Math.max(12, ex.band.p90 * 1.4)} band={[ex.band.p25, ex.band.p75]} p90={ex.band.p90} />}
          <Fact>
            CISA KEV additions{ex.lastWeek !== null && <> · last week <b>{fmt(ex.lastWeek)}</b></>}
            {ex.band && (
              <>
                {" "}
                · usual <b>{fmt(Math.round(ex.band.p25))} to {fmt(Math.round(ex.band.p75))}</b>
              </>
            )}
          </Fact>
        </Line>
        <Line k="breaches" label="Breaches" onOpen={br.n === null ? undefined : () => setOpen("breaches")}>
          {br.n === null ? <span className="font-mono text-[24px] text-dim">—</span> : <Value value={fmt(br.n)} tone={br.n ? "" : "!text-dim"} />}
          {br.n !== null && br.typicalMonth !== null && br.typicalMonth > 0 && <Vs n={br.n} max={br.typicalMonth * 2} typical={br.typicalMonth} />}
          <Fact>
            this month{br.accounts !== null && <> · <b>{(br.accounts / 1e6).toFixed(2)} M</b> accounts</>}
            {br.typicalMonth !== null && <> · usual month <b>{fmt(br.typicalMonth)}</b></>}
          </Fact>
        </Line>
        <Line k="ai" label="AI" href="/trends#ai-security">
          <Value value={fmt(ai.onAi + ai.usingAi)} />
          <Word>of {ai.total} incidents</Word>
          <Fact>
            <b>{ai.onAi}</b> attacks on AI{ai.topTarget && <> ({ai.topTarget.n} {ai.topTarget.label})</>} · <b>{ai.usingAi}</b> using AI{ai.topWeapon && <> ({ai.topWeapon.n} {ai.topWeapon.label})</>} · <b>{ai.cves}</b> CVEs in AI software, <b>{ai.exploited}</b> exploited · <Link href="/trends#ai-security">trends →</Link>
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
