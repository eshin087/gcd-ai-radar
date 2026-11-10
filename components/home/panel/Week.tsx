"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BreachLi, CveLi, KevLi } from "@/components/home/HomeCounters";
import { useJson } from "@/components/home/useJson";
import { Num } from "@/components/home/panel/Num";
import { usePanelState } from "@/components/home/panel/PanelState";
import { ListDrawer } from "@/components/ui/ListDrawer";
import { monthLabel } from "@/lib/format";
import { shortDate } from "@/lib/panel/dates";
import { LEVEL_WORDS, ratioLevel, type Level } from "@/lib/panel/levels";
import type { Week as WeekData } from "@/lib/panel/week";
import type { BreachStat, KevStatEntry, RecentCve } from "@/lib/stats-schema";

/**
 * The week (lib/panel/week.ts): six readouts against a typical week, as one
 * quiet strip under the runway's lists. A cell is a name, the number, and
 * exactly one grey comparison beside it; the only colour is amber on a week
 * that runs busy and on a Patch Tuesday that is here. Everything else about
 * a cell (what it counts, last week, the accounts behind the breaches, the
 * AI techniques) sits in its hover note and its drawer. Published follows
 * the live NVD count when the Worker has a newer one, and says "live"
 * beside its name. A name opens the list behind its number (the week's
 * CVEs, the KEV additions, the month's breaches) or leads to /trends.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
const TONE: Record<Level, string> = { 0: "text-dim", 1: "text-dim", 2: "text-accent", 3: "text-live" };
const NVD_NOTE = "NVD, public domain. This product uses data from the NVD API but is not endorsed or certified by the NVD.";
const DAY_MS = 86_400_000;

/**
 * One cell: the name (a button over its list, a link, or plain), then the
 * number with its comparison. `note` is the hover text with the rest;
 * `level` is the site's level for the number (lib/panel/levels.ts), which
 * scripts/check-home.mjs reads. The cell's top and left hairlines draw the
 * strip's grid; the strip clips the outer ones.
 */
function Cell({ k, label, live, level, note, onOpen, href, value, fact, tone = "text-dim" }: { k: string; label: string; live?: boolean; level?: Level | null; note: string; onOpen?: () => void; href?: string; value: ReactNode; fact: ReactNode; tone?: string }) {
  const cls = "text-[13.5px] text-dim";
  return (
    <li data-line={k} data-level={level ?? ""} title={note} className="min-w-0 border-t border-l border-white/[0.06] px-4 py-[18px] xl:px-5">
      <span className="flex items-baseline gap-x-1.5 whitespace-nowrap">
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
        {live && <span className="font-mono text-[13px] text-accent"> · live</span>}
      </span>
      <span className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 whitespace-nowrap">
        {value}
        <span className={`font-mono text-[13.5px] ${tone}`}>{fact}</span>
      </span>
    </li>
  );
}

function Value({ value }: { value: string }) {
  return <Num value={value} className="font-mono text-[22px] font-medium text-ink" />;
}

function Dash() {
  return <span className="font-mono text-[22px] text-dim">—</span>;
}

export function Week({ week: w, entries, today, weekFile, breachFile }: { week: WeekData; entries: KevStatEntry[]; today: string; weekFile: string; breachFile: string }) {
  const { pulse } = usePanelState();
  const [open, setOpen] = useState<null | "published" | "critical" | "exploited" | "breaches">(null);
  const cves = useJson<{ cves: RecentCve[] }>(open === "published" || open === "critical" ? weekFile : null);
  const breaches = useJson<{ breaches: BreachStat[] }>(open === "breaches" ? breachFile : null);

  const published = pulse?.week ?? w.published.n;
  const publishedLevel = published === null ? null : pulse ? ratioLevel(pulse.week, w.published.typical) : w.published.level;
  const over = published !== null && w.published.typical ? Math.round((published / w.published.typical - 1) * 100) : null;
  const ptDays = Math.round((Date.parse(`${w.patchTuesday}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  const cveRows = (cves.data?.cves ?? []).filter((c) => (open === "critical" ? c.score !== null && c.score >= 9 : true));
  const cveCount = (open === "critical" ? w.critical.n : w.published.n) ?? 0;
  const ex = w.exploited;
  const br = w.breaches;
  const ai = w.ai;
  const aiN = ai.onAi + ai.usingAi;
  const criticalShare = w.critical.n !== null && w.published.n ? `; ${((100 * w.critical.n) / w.published.n).toFixed(1)} % of the week's CVEs` : "";
  const aiTechniques = [ai.topTarget && `${ai.topTarget.n} ${ai.topTarget.label}`, ai.topWeapon && `${ai.topWeapon.n} ${ai.topWeapon.label}`].filter(Boolean).join(", ");

  return (
    <section id="week" data-build data-instrument="week" aria-label="The week against a typical one" className="min-w-0 scroll-mt-6 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.015]">
      <ol data-week className="-mt-px -ml-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Cell
          k="published"
          label="Published"
          live={Boolean(pulse)}
          level={publishedLevel}
          note={`CVEs published in the last 7 days (NVD)${w.published.typical !== null ? `; a typical week has ${fmt(w.published.typical)}` : ""}${pulse ? "; live from the Worker's count, newer than the build" : ""}. Click the name for the list.`}
          onOpen={w.published.n === null ? undefined : () => setOpen("published")}
          value={published === null ? <Dash /> : <Value value={fmt(published)} />}
          tone={publishedLevel === null ? "text-dim" : TONE[publishedLevel]}
          fact={over !== null && publishedLevel !== null ? `${over >= 0 ? "+" : "−"}${Math.abs(over)}% · ${LEVEL_WORDS[publishedLevel]}` : "CVEs in 7 days"}
        />
        <Cell
          k="critical"
          label="Critical"
          level={w.critical.typical !== null ? w.critical.level : null}
          note={`CVEs scored 9.0 or higher in the last 7 days${criticalShare}. Click the name for the list.`}
          onOpen={w.critical.n === null ? undefined : () => setOpen("critical")}
          value={w.critical.n === null ? <Dash /> : <Value value={fmt(w.critical.n)} />}
          fact={w.critical.typical !== null ? `typical ${fmt(w.critical.typical)}` : "CVSS 9 or higher"}
        />
        <Cell
          k="exploited"
          label="Newly exploited"
          level={ex.n !== null ? ex.level : null}
          note={`Added to CISA's Known Exploited Vulnerabilities catalog in the last 7 days${ex.lastWeek !== null ? `; last week ${fmt(ex.lastWeek)}` : ""}. Click the name for the list.`}
          onOpen={ex.n === null ? undefined : () => setOpen("exploited")}
          value={ex.n === null ? <Dash /> : <Value value={fmt(ex.n)} />}
          fact={ex.band ? `typical ${fmt(Math.round(ex.band.p25))} to ${fmt(Math.round(ex.band.p75))}` : "CISA KEV additions"}
        />
        <Cell
          k="breaches"
          label="Breaches this month"
          note={`Breaches verified by Have I Been Pwned this month${br.accounts !== null ? `; ${(br.accounts / 1e6).toFixed(2)} M accounts in them` : ""}. Click the name for the list.`}
          onOpen={br.n === null ? undefined : () => setOpen("breaches")}
          value={br.n === null ? <Dash /> : <Value value={fmt(br.n)} />}
          fact={br.typicalMonth !== null ? `typical ${fmt(br.typicalMonth)}` : "verified"}
        />
        <Cell
          k="ai"
          label="Incidents with AI"
          href="/trends#ai-security"
          note={`This week's incidents where AI was the target or the weapon${aiTechniques ? ` (${aiTechniques})` : ""}: ${ai.onAi} attacks on AI, ${ai.usingAi} using AI; ${ai.cves} CVEs in AI software, ${ai.exploited} exploited. The name leads to Trends.`}
          value={<Value value={fmt(aiN)} />}
          fact={`of ${ai.total}`}
        />
        <Cell
          k="patch-tuesday"
          label="Patch Tuesday"
          note="The second Tuesday of the month, when Microsoft, Adobe and SAP publish their security updates."
          value={<Value value={shortDate(w.patchTuesday)} />}
          tone={ptDays <= 1 ? "text-accent" : "text-dim"}
          fact={ptDays === 0 ? "today" : ptDays === 1 ? "tomorrow" : `in ${ptDays} days`}
        />
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
    </section>
  );
}
