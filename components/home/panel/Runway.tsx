"use client";

import Link from "next/link";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { AiTag, CvssNum, StackTag, Tag } from "@/components/home/panel/marks";
import { dateLabel } from "@/lib/format";
import { RUNWAY_DUE_LABELS, RUNWAY_OPEN_BARS } from "@/lib/panel/caps";
import { countdownParts, openFor, shortDate, timeLeft } from "@/lib/panel/dates";
import type { DueRow, PatchRow } from "@/lib/panel/ledger";
import type { IncidentType } from "@/lib/taxonomy";

/**
 * The runway: the day sheet's one picture, and its one thing in motion.
 *
 * Left, the most urgent thing: the nearest CISA deadline as a large
 * countdown (hours and minutes, days and hours from two days out), its
 * product, CVE and score, and how much of CISA's window is left. With no
 * deadline in the week it is the record that has waited longest for a patch.
 *
 * Right, a time axis from seven days ago to seven days ahead with NOW in
 * the middle. Past NOW: one dot per new exploited record in its 24-hour
 * window (red for harm confirmed), and a bar for each of the first records
 * without a patch, from its first report to NOW, where it is still growing.
 * Ahead of NOW: a marker where each deadline day ends, the nearest one
 * labelled highest and in amber, the later ones stepping down.
 *
 * Under html.motion the marks arrive once when the card builds, then two
 * things keep moving, slowly: approach lights run along the deadline track
 * toward NOW, and a soft light travels along the open bars (globals.css
 * .rw-*). Nothing blinks. Positions follow the visitor's clock, so a page
 * built hours ago still puts NOW where it is; a deadline that has passed
 * since the build drops off.
 */

const DAY = 86_400_000;
const SPAN = 7 * DAY;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DUE_NOTE = "CISA's deadline for US federal agencies to patch; a good yardstick for everyone";
const LABEL = "font-mono text-[11px] font-medium uppercase tracking-[0.1em]";
const nvdHref = (cve: string) => `https://nvd.nist.gov/vuln/detail/${cve}`;

/** The end of a deadline's UTC day. */
export const dueEnd = (due: string) => Date.parse(`${due}T00:00:00Z`) + DAY;

export type DueOnRunway = DueRow & { type: IncidentType; labels: string[] };
export type OpenOnRunway = PatchRow & { labels: string[] };
export interface RunwayDay {
  n: number;
  harm: number;
}

const vars = (v: Record<string, number | string>) => v as CSSProperties;

/** Time left in the fewest letters, for the chart's deadline labels: "21 h", "2 d". */
const shortLeft = (ms: number) => (ms >= DAY ? `${Math.floor(ms / DAY)} d` : timeLeft(ms));

function RecordLink({ href, external, title, className, children }: { href: string; external?: boolean; title?: string; className?: string; children: ReactNode }) {
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} title={title} className={className}>
      {children}
    </Link>
  );
}

function CveLink({ cves }: { cves: string[] }) {
  const cve = cves[0];
  if (!cve) return null;
  return (
    <span>
      <a href={nvdHref(cve)} target="_blank" rel="noopener noreferrer" title={`${cve} at NVD`} className="hover:text-accent hover:underline">
        {cve}
      </a>
      {cves.length > 1 && ` +${cves.length - 1}`}
    </span>
  );
}

/* ---------- the lead ---------- */

const BIG = "mt-3.5 whitespace-nowrap font-mono text-[56px] font-medium leading-none tracking-[-0.03em] text-white sm:text-[64px]";
const UNIT = "ml-[3px] text-[26px] tracking-normal text-dim";

function DueLead({ lead, also, now, ready }: { lead: DueOnRunway; also: DueOnRunway[]; now: number; ready: boolean }) {
  const end = dueEnd(lead.due);
  const c = countdownParts(end - now);
  const listed = Date.parse(`${lead.added}T00:00:00Z`);
  const left = Math.min(1, Math.max(0.02, (end - now) / Math.max(DAY, end - listed)));
  const today = new Date(now).toISOString().slice(0, 10);
  const other = also[0];
  return (
    <div data-row="due" data-lead data-ai={lead.type === "not_ai" ? "0" : "1"} data-name={lead.name} className="relative flex min-w-0 flex-[1_1_270px] flex-col lg:max-w-[340px]">
      <p className={`${LABEL} text-accent`}>Next deadline</p>
      <p data-big-countdown={lead.due} title={`Patch by ${dateLabel(lead.due)}: ${DUE_NOTE}`} className={BIG} suppressHydrationWarning>
        {c.a}
        <span className={`${UNIT} mr-3`}>{c.au}</span>
        {c.b}
        <span className={UNIT}>{c.bu}</span>
      </p>
      <h3 className="mt-[18px] text-[18px] font-semibold leading-tight tracking-[-0.01em]">
        <RecordLink href={lead.href} external={lead.external} title={`${lead.name}: ${lead.cves.join(", ")}`} className="text-ink hover:text-accent">
          {lead.name}
        </RecordLink>
      </h3>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-dim">
        <CveLink cves={lead.cves} />
        {lead.cvss !== null && (
          <span>
            CVSS <CvssNum score={lead.cvss} />
          </span>
        )}
        {lead.ransomware && (
          <span className="text-live" title="CISA lists known use in ransomware campaigns">
            ransomware
          </span>
        )}
        <StackTag labels={lead.labels} ready={ready} />
        <AiTag type={lead.type} />
      </p>
      <div className="mt-auto pt-[22px]">
        <div aria-hidden className="relative h-1 rounded-full bg-white/[0.14]">
          <div className="absolute inset-y-0 right-0 rounded-full bg-accent shadow-[0_0_10px_rgba(255,179,92,0.7)]" style={{ width: `${(left * 100).toFixed(1)}%` }} />
        </div>
        <p className="mt-2 flex justify-between font-mono text-[11px] text-dim">
          <span>listed by CISA {shortDate(lead.added)}</span>
          <span className="text-accent">due {shortDate(lead.due)}</span>
        </p>
        {other && (
          <p className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-soft">
            Also {lead.due === today ? "today" : `on ${shortDate(lead.due)}`}:
            <RecordLink href={other.href} external={other.external} className="font-medium text-ink hover:text-accent">
              {other.name}
            </RecordLink>
            {other.labels.length > 0 && (
              <span data-stack={ready ? "ready" : "wait"} className="contents">
                <Tag tone="stack" title={`In your stack: ${other.labels.join(", ")}`}>
                  your stack
                </Tag>
              </span>
            )}
            {also.length > 1 && <span className="font-mono text-[12px] text-dim">+{also.length - 1}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

/** With no deadline in the week: the unpatched record that has waited longest, or a calm line. */
function OpenLead({ open, now }: { open: OpenOnRunway | null; now: number }) {
  if (!open)
    return (
      <div className="relative flex min-w-0 flex-[1_1_270px] flex-col lg:max-w-[340px]">
        <p className={`${LABEL} text-dim`}>This week</p>
        <p className={BIG}>0</p>
        <p className="mt-[18px] text-[15px] leading-snug text-soft">No CISA deadline falls this week, and every exploited record has a patch.</p>
      </div>
    );
  const days = Math.max(0, Math.floor((now - Date.parse(`${open.reported}T00:00:00Z`)) / DAY));
  return (
    <div className="relative flex min-w-0 flex-[1_1_270px] flex-col lg:max-w-[340px]">
      <p className={`${LABEL} text-live`}>Longest without a patch</p>
      <p className={BIG} title={`First reported ${dateLabel(open.reported)}`} suppressHydrationWarning>
        {days}
        <span className={UNIT}>{days === 1 ? "day" : "days"}</span>
      </p>
      <h3 className="mt-[18px] text-[18px] font-semibold leading-tight tracking-[-0.01em]">
        <Link href={`/incidents/${open.slug}`} title={open.title} className="text-ink hover:text-accent">
          {open.name}
        </Link>
      </h3>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-dim">
        <CveLink cves={open.cves} />
        {open.cvss !== null && (
          <span>
            CVSS <CvssNum score={open.cvss} />
          </span>
        )}
        <span>no CISA deadline this week</span>
      </p>
    </div>
  );
}

/* ---------- the chart ---------- */

interface Group {
  end: number;
  rows: DueOnRunway[];
}

/** The level a deadline label sits on, the stem under it and where its marker rides: the nearest highest, each later one a step down. */
const STEP = 22;
const TRACK = 112;

function Chart({ now, built, groups, later, onLater, open, openCount, days, fresh, harm, ai, ready }: { now: number; built: number; groups: Group[]; later: number; onLater: () => void; open: OpenOnRunway[]; openCount: number; days: RunwayDay[]; fresh: number; harm: number; ai: boolean; ready: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  // on a phone the axis is wider than the card: start with NOW in view
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth / 2 - el.clientWidth * 0.4;
  }, []);

  const x = (t: number) => 50 + ((t - now) / SPAN) * 50;
  const midnights: number[] = [];
  for (let t = Math.ceil((now - SPAN) / DAY) * DAY; t <= now + SPAN; t += DAY) midnights.push(t);
  const dayNames = midnights.map((t) => ({ t, at: x(t + DAY / 2) })).filter((d) => d.at > 3 && d.at < 97 && Math.abs(d.at - 50) > 4.5);

  // one dot per record; a very busy week packs more than one into a dot so the tallest stack still fits
  const per = Math.max(1, Math.ceil(Math.max(0, ...days.map((d) => d.n)) / 27));
  const stacks = days.map((d, i) => ({ at: x(built - (days.length - 1 - i + 0.5) * DAY), dots: Math.ceil(d.n / per), red: d.harm ? Math.max(1, Math.round(d.harm / per)) : 0 })).filter((s) => s.dots > 0 && s.at > 1.5);

  const bars = open.slice(0, RUNWAY_OPEN_BARS);
  const count = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div ref={scroller} className="relative min-w-0 flex-[999_1_560px] overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
      <div data-runway className="relative h-[260px] min-w-[600px]">
        {midnights.map((t) => (
          <span key={t} aria-hidden className="absolute bottom-7 top-5 w-px bg-white/[0.045]" style={{ left: `${x(t)}%` }} />
        ))}
        {dayNames.map((d) => (
          <span key={d.t} aria-hidden className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] text-dim" style={{ left: `${d.at}%` }}>
            {WEEKDAY[new Date(d.t).getUTCDay()]} {new Date(d.t).getUTCDate()}
          </span>
        ))}

        <p className={`${LABEL} absolute left-0 top-0.5 whitespace-nowrap text-dim`}>
          {ai ? "New with AI" : "New this week"} <span className="text-ink">{fresh}</span>
          {harm > 0 && (
            <span className="ml-3.5 normal-case tracking-[0.04em]">
              <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full bg-live align-[1px]" />
              {harm} with harm
            </span>
          )}
          {per > 1 && <span className="ml-3.5 normal-case tracking-[0.04em]">1 dot = {per}</span>}
        </p>
        <p className={`${LABEL} absolute left-[54%] top-0.5 whitespace-nowrap text-dim`}>
          Patch due <span className="text-ink">{count}</span>
        </p>
        {later > 0 && (
          <button type="button" onClick={onLater} className="absolute right-0 top-0 font-mono text-[12px] text-dim hover:text-accent">
            {later} later →
          </button>
        )}

        {stacks.map((s, i) => (
          <span key={s.at} aria-hidden data-runway-dots={s.dots} className="rw-in absolute bottom-[154px] -ml-3 flex w-6 flex-wrap-reverse gap-[3px]" style={{ left: `${s.at}%`, ...vars({ "--d": i * 70 }) }}>
            {Array.from({ length: s.dots }, (_, k) => (
              <i key={k} className={`size-1.5 rounded-full ${k < s.red ? "bg-live" : "bg-accent"}`} />
            ))}
          </span>
        ))}

        <span aria-hidden className="absolute inset-x-0 h-px bg-white/10" style={{ top: TRACK }} />
        <span aria-hidden className="rw-lights absolute left-[52%] right-0 h-0" style={{ top: TRACK }}>
          {Array.from({ length: 13 }, (_, i) => (
            <i key={i} style={vars({ "--i": i })} />
          ))}
        </span>

        {groups.length === 0 && <p className="absolute left-[54%] top-10 max-w-[40%] text-[13px] text-dim">{ai ? "No deadline this week is for an AI product." : "No CISA deadline falls in the next seven days."}</p>}
        {groups.map((g, i) => {
          const at = x(g.end);
          const first = i === 0;
          const labelled = i < RUNWAY_DUE_LABELS;
          const top = 22 + i * STEP;
          const names = g.rows.slice(0, 2).map((r) => r.name).join(" · ");
          const title = `Patch by ${dateLabel(g.rows[0]!.due)}: ${g.rows.map((r) => r.name).join(", ")}`;
          const flip = at > 84;
          return (
            <span key={g.end} className="contents">
              {labelled && <span aria-hidden className={`rw-in absolute w-px ${first ? "bg-accent/55" : "bg-white/20"}`} style={{ left: `${at}%`, top: top + 20, height: TRACK - top - 20, ...vars({ "--d": 250 + i * 120 }) }} />}
              <span aria-hidden data-runway-due={g.rows.length} title={title} className={`rw-in absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 ${first ? "bg-accent shadow-[0_0_10px_1px_rgba(255,179,92,0.8)]" : "bg-soft"}`} style={{ left: `${at}%`, top: TRACK, ...vars({ "--d": 250 + i * 120 }) }} />
              {labelled && (
                <span className={`rw-in absolute flex items-baseline gap-2 overflow-hidden whitespace-nowrap text-[13px] ${flip ? "flex-row-reverse" : ""}`} style={{ top, ...(flip ? { right: `calc(${100 - at}% + 9px)`, left: 0 } : { left: `calc(${at}% + 9px)`, right: 0 }), ...vars({ "--d": 250 + i * 120 }) }}>
                  <span className={`font-mono text-[12px] font-semibold ${first ? "text-accent" : "text-soft"}`}>{shortLeft(g.end - now)}</span>
                  <RecordLink href={g.rows[0]!.href} external={g.rows[0]!.external} title={title} className={`min-w-0 truncate font-medium hover:text-accent ${first ? "text-ink" : "text-soft"}`}>
                    {names}
                  </RecordLink>
                  {g.rows.length > 2 && <span className="font-mono text-[12px] text-dim">+{g.rows.length - 2}</span>}
                </span>
              )}
            </span>
          );
        })}

        <p className={`${LABEL} absolute left-[52%] whitespace-nowrap text-dim`} style={{ top: TRACK + 10 }}>
          No patch yet <span className="text-ink">{openCount}</span>
        </p>
        {bars.length === 0 && <p className="absolute left-[52%] top-[146px] text-[13px] text-dim">{!ai ? "Every exploited record has a patch." : openCount ? "Its deadline is on the track above." : "No AI record is waiting for a patch."}</p>}
        {bars.map((p, i) => {
          const from = Math.max(0, x(Date.parse(`${p.reported}T00:00:00Z`)));
          const y = 146 + i * 15;
          const part = p.patch === "partial";
          return (
            <span key={p.slug} className="contents">
              <span aria-hidden data-runway-bar={p.slug} className={`rw-grow absolute h-1 overflow-hidden rounded-full bg-linear-to-r ${part ? "from-partial/10 to-partial" : "from-live/10 to-live"}`} style={{ left: `${Math.min(from, 49)}%`, right: "50%", top: y, ...vars({ "--d": 150 + i * 90 }) }}>
                <span className="rw-flow" style={vars({ "--i": i })} />
              </span>
              <span aria-hidden className={`rw-in absolute -ml-[3px] -mt-px size-1.5 rounded-full ${part ? "bg-partial shadow-[0_0_8px_1px_rgba(242,168,59,0.7)]" : "bg-live shadow-[0_0_8px_1px_rgba(255,92,92,0.7)]"}`} style={{ left: "50%", top: y, ...vars({ "--d": 700 + i * 90 }) }} />
              <span className="rw-in absolute left-[52%] right-0 flex items-baseline gap-2 overflow-hidden whitespace-nowrap text-[12.5px] leading-[14px]" style={{ top: y - 5, ...vars({ "--d": 300 + i * 90 }) }}>
                <Link href={`/incidents/${p.slug}`} title={p.title} className="min-w-0 truncate font-medium text-ink hover:text-accent">
                  {p.name}
                </Link>
                <span className={`font-mono text-[11.5px] ${part ? "text-partial" : "text-dim"}`} suppressHydrationWarning>
                  {part ? "partly patched" : openFor(p.reported, now)}
                </span>
                {p.cvss !== null && (
                  <span className="font-mono text-[11.5px] text-dim">
                    CVSS <CvssNum score={p.cvss} />
                  </span>
                )}
                {p.labels.length > 0 && (
                  <span data-stack={ready ? "ready" : "wait"} title={`In your stack: ${p.labels.join(", ")}`} className="font-mono text-[10.5px] font-medium uppercase tracking-[0.05em] text-ink">
                    your stack
                  </span>
                )}
              </span>
            </span>
          );
        })}

        <span aria-hidden className="rw-now absolute bottom-7 left-1/2 top-2 w-px bg-accent" />
        <span aria-hidden className={`${LABEL} absolute left-1/2 top-0 -translate-x-1/2 rounded-[5px] bg-accent px-[7px] py-[3px] font-semibold leading-none text-ground`}>
          Now
        </span>
      </div>
    </div>
  );
}

/* ---------- the card ---------- */

export function Runway({ now, built, due, later, onLater, open, openCount, days, fresh, harm, ai, ready }: { now: number; built: number; due: DueOnRunway[]; later: number; onLater: () => void; open: OpenOnRunway[]; openCount: number; days: RunwayDay[]; fresh: number; harm: number; ai: boolean; ready: boolean }) {
  const groups: Group[] = [];
  for (const r of due) {
    const end = dueEnd(r.due);
    const g = groups.find((k) => k.end === end);
    if (g) g.rows.push(r);
    else groups.push({ end, rows: [r] });
  }
  const lead = due[0] ?? null;
  const longest = lead ? null : (open.filter((p) => p.patch === "unpatched").sort((a, b) => a.reported.localeCompare(b.reported))[0] ?? null);
  return (
    <section
      id="runway"
      data-build
      data-instrument="runway"
      aria-label="The next deadline, and the two weeks around now"
      className="relative flex min-w-0 scroll-mt-6 flex-wrap gap-x-10 gap-y-7 overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0a0d14] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-7"
    >
      <span aria-hidden className="pointer-events-none absolute -left-[140px] -top-[180px] h-[460px] w-[560px] bg-[radial-gradient(closest-side,rgba(255,179,92,0.11),transparent)]" />
      {lead ? <DueLead lead={lead} also={groups[0]!.rows.slice(1)} now={now} ready={ready} /> : <OpenLead open={longest} now={now} />}
      <Chart now={now} built={built} groups={groups} later={later} onLater={onLater} open={open} openCount={openCount} days={days} fresh={fresh} harm={harm} ai={ai} ready={ready} />
    </section>
  );
}
