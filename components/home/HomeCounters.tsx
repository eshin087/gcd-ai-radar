"use client";

import Link from "next/link";
import { useState } from "react";
import { ScoreChip } from "@/components/home/ScoreChip";
import { useJson } from "@/components/home/useJson";
import { ListDrawer } from "@/components/ui/ListDrawer";
import { dateLabel, monthLabel } from "@/lib/format";
import type { BreachStat, HomeStats, KevStatEntry, RecentCve } from "@/lib/stats-schema";

/**
 * Band 2: today's numbers. Each counter is a button that opens the list it
 * counts (a drawer fed by /stats/*.json) or a link to the live board. The
 * data-counter and data-value attributes are what scripts/check-home.mjs
 * compares with /stats/home.json; the accessible name follows the
 * "<label>: <value>, open the list" contract of the chart drawers.
 */

type DrawerKey = "cves_24h" | "cves_7d" | "critical_7d" | "kev_7d" | "breaches" | null;

interface CounterProps {
  id: string;
  label: string;
  value: number | null;
  sub?: string;
  href?: string;
  onOpen?: () => void;
  title: string;
}

function Counter({ id, label, value, sub, href, onOpen, title }: CounterProps) {
  const shown = value === null ? "—" : value.toLocaleString("en-US");
  const body = (
    <>
      <span className="num block text-[30px] font-semibold leading-none tracking-tight text-ink sm:text-[34px]">{shown}</span>
      <span className="mt-1.5 block text-[12px] uppercase tracking-[0.08em] text-dim">{label}</span>
      {sub && <span className="num mt-1 block text-[12px] text-faint">{sub}</span>}
    </>
  );
  const cls = "block min-w-0 border-l border-line-soft px-4 py-3 text-left first:border-l-0 first:pl-0 hover:[&>span:first-child]:text-accent";
  const attrs = { "data-counter": id, "data-value": value ?? "", title };
  if (value === null) return <span {...attrs} className={cls}>{body}</span>;
  if (href)
    return (
      <Link href={href} {...attrs} aria-label={`${label}: ${value}, open the list`} className={cls}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={onOpen} {...attrs} aria-label={`${label}: ${value}, open the list`} className={cls}>
      {body}
    </button>
  );
}

function nvdUrl(id: string) {
  return `https://nvd.nist.gov/vuln/detail/${id}`;
}

export function CveLi({ c }: { c: RecentCve }) {
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 border-t border-line-soft py-2.5 first:border-t-0">
      <div className="pt-0.5">
        <ScoreChip score={c.score} version={c.version} />
      </div>
      <div className="min-w-0">
        <a href={nvdUrl(c.id)} target="_blank" rel="noopener noreferrer" className="num text-[13.5px] text-ink hover:text-accent">
          {c.id}
        </a>
        <span className="num ml-2 text-[12px] text-dim">{dateLabel(c.published.slice(0, 10))}</span>
        <p className="mt-0.5 text-[13px] leading-snug text-soft">{c.description || "No description yet."}</p>
      </div>
    </li>
  );
}

export function KevLi({ e }: { e: KevStatEntry }) {
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 border-t border-line-soft py-2.5 first:border-t-0">
      <div className="pt-0.5">
        <ScoreChip score={e.cvss} />
      </div>
      <div className="min-w-0">
        <a href={nvdUrl(e.cve)} target="_blank" rel="noopener noreferrer" className="num text-[13.5px] text-ink hover:text-accent">
          {e.cve}
        </a>
        <span className="ml-2 text-[13px] text-soft">
          {e.vendor} {e.product}
        </span>
        <p className="num mt-0.5 text-[12px] text-dim">
          added {dateLabel(e.added)}
          {e.due && <> · due {dateLabel(e.due)}</>}
          {e.published && <> · published {dateLabel(e.published)}</>}
          {e.ransomware && <span className="ml-2 text-live">ransomware</span>}
        </p>
        <p className="text-[13px] leading-snug text-soft">{e.name}</p>
      </div>
    </li>
  );
}

export function BreachLi({ b }: { b: BreachStat }) {
  return (
    <li className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-t border-line-soft py-2.5 first:border-t-0">
      <div className="num pt-0.5 text-right text-[13.5px] text-ink">{b.accounts.toLocaleString("en-US")}</div>
      <div className="min-w-0">
        <a href={`https://haveibeenpwned.com/Breach/${encodeURIComponent(b.name)}`} target="_blank" rel="noopener noreferrer" className="text-[13.5px] text-ink hover:text-accent">
          {b.title}
        </a>
        {b.domain && <span className="num ml-2 text-[12px] text-dim">{b.domain}</span>}
        <p className="num mt-0.5 text-[12px] text-dim">
          added {dateLabel(b.added)}
          {b.breach_date && <> · breached {dateLabel(b.breach_date)}</>}
          {b.sensitive && <span className="ml-2 text-partial">sensitive</span>}
        </p>
      </div>
    </li>
  );
}

export function HomeCounters({ stats }: { stats: HomeStats }) {
  const [open, setOpen] = useState<DrawerKey>(null);
  const c = stats.counters;
  const cveUrl = open === "cves_24h" ? stats.lists.cves_day.file : open === "cves_7d" || open === "critical_7d" ? stats.lists.cves_week.file : null;
  const kevUrl = open === "kev_7d" ? stats.lists.kev_month.file : null;
  const breachUrl = open === "breaches" ? stats.lists.breaches_month.file : null;
  const cves = useJson<{ cves: RecentCve[] }>(cveUrl);
  const kev = useJson<{ entries: KevStatEntry[] }>(kevUrl);
  const breaches = useJson<{ breaches: BreachStat[] }>(breachUrl);
  const close = () => setOpen(null);
  const weekFrom = new Date(Date.parse(stats.generated_at) - 7 * 86_400_000).toISOString().slice(0, 10);

  const cveRows = (cves.data?.cves ?? []).filter((x) => (open === "critical_7d" ? x.score !== null && x.score >= 9 : true));
  const kevRows = (kev.data?.entries ?? []).filter((e) => e.added > weekFrom);
  const breachRows = breaches.data?.breaches ?? [];
  const nvdNote = "NVD, public domain. This product uses data from the NVD API but is not endorsed or certified by the NVD.";

  return (
    <section aria-label="Today's numbers" className="grid grid-cols-2 border-y border-line sm:grid-cols-3 lg:grid-cols-6">
      <Counter id="cves_24h" label="New CVEs, 24 h" value={c.cves_24h} onOpen={() => setOpen("cves_24h")} title="CVEs NVD published in the last 24 hours" />
      <Counter id="cves_7d" label="New CVEs, 7 days" value={c.cves_7d} onOpen={() => setOpen("cves_7d")} title="CVEs NVD published in the last seven days" />
      <Counter id="critical_7d" label="Critical this week" value={c.critical_7d} onOpen={() => setOpen("critical_7d")} title="CVEs published in the last seven days with a CVSS base score of 9.0 or higher" />
      <Counter
        id="kev_7d"
        label="Exploited, 7 days"
        value={c.kev_7d}
        sub={c.kev_next_due ? `next deadline ${dateLabel(c.kev_next_due)}` : undefined}
        onOpen={() => setOpen("kev_7d")}
        title="Vulnerabilities CISA added to its Known Exploited Vulnerabilities catalog in the last seven days; the deadline is the nearest federal remediation due date"
      />
      <Counter
        id="breached_accounts_month"
        label="Accounts breached this month"
        value={c.breached_accounts_month}
        sub={c.breaches_month !== null ? `${c.breaches_month} breach${c.breaches_month === 1 ? "" : "es"}` : undefined}
        onOpen={() => setOpen("breaches")}
        title="Accounts in verified breaches Have I Been Pwned added this month; spam lists, stealer logs and malware dumps are left out"
      />
      <Counter id="live" label="Live incidents here" value={c.live} href="/live" title="Live records in the three action lanes: patch now, breaches and attacks, supply chain" />

      <ListDrawer
        open={cveUrl !== null}
        onClose={close}
        kicker={open === "cves_24h" ? "CVEs published in the last 24 hours" : open === "critical_7d" ? "CVSS 9.0 and higher, last seven days" : "CVEs published in the last seven days"}
        title={open === "cves_24h" ? "New CVEs, 24 hours" : open === "critical_7d" ? "Critical CVEs this week" : "New CVEs, 7 days"}
        count={(open === "cves_24h" ? c.cves_24h : open === "critical_7d" ? c.critical_7d : c.cves_7d) ?? 0}
        unit="CVEs"
        note={nvdNote}
        outbound={{ href: "https://nvd.nist.gov/vuln/search", label: "search NVD →" }}
        loading={cves.loading}
        error={cves.error}
        capNote={cveRows.length < ((open === "cves_24h" ? c.cves_24h : open === "critical_7d" ? c.critical_7d : c.cves_7d) ?? 0) ? `Showing the ${cveRows.length} highest-scored.` : undefined}
      >
        {cveRows.map((x) => (
          <CveLi key={x.id} c={x} />
        ))}
      </ListDrawer>
      <ListDrawer
        open={kevUrl !== null}
        onClose={close}
        kicker={`KEV additions since ${dateLabel(weekFrom)}`}
        title="Exploited in the wild, last seven days"
        count={c.kev_7d ?? 0}
        unit="additions"
        note="CISA Known Exploited Vulnerabilities catalog, CC0"
        outbound={{ href: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", label: "the catalog →" }}
        loading={kev.loading}
        error={kev.error}
      >
        {kevRows.map((e) => (
          <KevLi key={e.cve} e={e} />
        ))}
      </ListDrawer>
      <ListDrawer
        open={breachUrl !== null}
        onClose={close}
        kicker={`breaches added in ${monthLabel(stats.lists.breaches_month.month, true)}`}
        title="Accounts breached this month"
        count={c.breaches_month ?? 0}
        unit="breaches"
        note="Have I Been Pwned, CC BY 4.0; verified breaches only"
        outbound={{ href: "https://haveibeenpwned.com/PwnedWebsites", label: "all breaches on HIBP →" }}
        loading={breaches.loading}
        error={breaches.error}
      >
        {breachRows.map((b) => (
          <BreachLi key={b.name} b={b} />
        ))}
      </ListDrawer>
    </section>
  );
}
