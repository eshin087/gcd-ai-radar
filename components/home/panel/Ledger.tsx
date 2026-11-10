"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Countdown, OpenFor, ShortAgo, TypeIn } from "@/components/home/panel/Live";
import { AiTag, CvssNum, ScoreOrDash, StackTag } from "@/components/home/panel/marks";
import { Num } from "@/components/home/panel/Num";
import { usePanelState } from "@/components/home/panel/PanelState";
import { Runway, type DueOnRunway, type OpenOnRunway } from "@/components/home/panel/Runway";
import { Drawer } from "@/components/ui/Drawer";
import { dateLabel } from "@/lib/format";
import { LEDGER_DUE_ROWS, LEDGER_NEW_ROWS, LEDGER_PATCH_ROWS } from "@/lib/panel/caps";
import { shortDate } from "@/lib/panel/dates";
import { dueEnd, foldedOnDeadline } from "@/lib/panel/deadlines";
import type { DueRow, Ledger as LedgerData, NewRow } from "@/lib/panel/ledger";
import { rowStack, stackHits, type StackHits } from "@/lib/panel/picks";
import type { IncidentType } from "@/lib/taxonomy";

/**
 * Needs action (lib/panel/ledger.ts): what is exploited and still needs
 * doing. The runway card leads (Runway.tsx): the nearest deadline as a large
 * countdown beside the two weeks around now. Under it sit three short lists,
 * one question each: what else is due this week, what has no patch yet, what
 * is new. A list is its title and count over a hairline, the link to
 * everything behind the count at the right, and three one-line rows: the
 * name, at most two tags ("your stack", recomputed in the browser for a
 * visitor's own picks, and "AI"), the CVSS score, and one time at the right
 * (the time left to CISA's deadline, how long a record has gone without a
 * patch, the age of a new one). CVE ids sit on the runway's lead, in each
 * row's hover note and in the drawers.
 *
 * The card and the lists read the same rows, in one order: the first
 * deadline is the card's lead and the next three are the list. "AI only"
 * (the switch is on the stack strip) refills everything with AI rows, the
 * counts dissolving to match; a deadline counts as AI when an AI record
 * without a full patch names one of its CVEs. A deadline that has passed
 * since the page was built drops off, and a record without a patch that was
 * folded into it is listed on its own again. The newest row types itself in
 * once.
 */

const KEV_CATALOG = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog";
const DUE_NOTE = "CISA's deadline for US federal agencies to patch; a good yardstick for everyone";
const ROW = "flex h-[42px] items-center gap-2.5 border-b border-white/[0.05]";
const NAME = "min-w-0 truncate text-[14px] font-medium text-ink hover:text-accent";
const TIME = "w-[86px] flex-none text-right font-mono text-[12px] whitespace-nowrap";

/** The visitor's clock, starting from the build's so the first paint matches the server's, then every half minute. */
function useNow(built: number): number {
  const [now, setNow] = useState(built);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const every = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);
  return now;
}

/** The score at the right of a row, in its band's colour; an empty slot keeps the times aligned. */
function Score({ score }: { score: number | null }) {
  return (
    <span className="ml-auto flex-none">
      <CvssNum score={score} />
    </span>
  );
}

function DueLi({ r, ready, today }: { r: DueOnRunway; ready: boolean; today: string }) {
  const title = `${r.name}: ${r.cves.join(", ")}${r.ransomware ? " · known ransomware use" : ""}`;
  return (
    <li data-row="due" data-ai={r.type === "not_ai" ? "0" : "1"} data-name={r.name} className={ROW}>
      {r.external ? (
        <a href={r.href} target="_blank" rel="noopener noreferrer" title={title} className={NAME}>
          {r.name}
        </a>
      ) : (
        <Link href={r.href} title={title} className={NAME}>
          {r.name}
        </Link>
      )}
      <StackTag labels={r.labels} ready={ready} />
      <AiTag type={r.type} />
      {r.ransomware && (
        <span className="flex-none font-mono text-[11.5px] text-live" title="CISA lists known use in ransomware campaigns">
          ransomware
        </span>
      )}
      <Score score={r.cvss} />
      <span className={`${TIME} text-accent`} title={`Patch ${r.due === today ? "today" : `by ${dateLabel(r.due)}`}: ${DUE_NOTE}`}>
        <Countdown due={r.due} fallback={r.due === today ? "today" : `by ${shortDate(r.due)}`} />
      </span>
    </li>
  );
}

function PatchLi({ r, ready, built }: { r: OpenOnRunway; ready: boolean; built: string }) {
  return (
    <li data-row="patch" data-ai={r.type === "not_ai" ? "0" : "1"} data-name={r.name} className={ROW}>
      <Link href={`/incidents/${r.slug}`} title={`${r.title}${r.cves.length ? ` · ${r.cves.join(", ")}` : " · no CVE id yet"}`} className={NAME}>
        {r.name}
      </Link>
      <StackTag labels={r.labels} ready={ready} />
      <AiTag type={r.type} />
      <Score score={r.cvss} />
      {r.patch === "unpatched" ? (
        <OpenFor since={r.reported} built={built} title={`No patch yet; first reported ${dateLabel(r.reported)}`} className={`${TIME} text-soft`} />
      ) : (
        <span className={`${TIME} text-partial`} title={`Partly patched: a fix covers some versions or only a workaround exists; first reported ${dateLabel(r.reported)}`}>
          partly patched
        </span>
      )}
    </li>
  );
}

function NewLi({ r, labels, ready, built, first }: { r: NewRow; labels: string[]; ready: boolean; built: string; first: boolean }) {
  return (
    <li data-row="new" data-ai={r.type === "not_ai" ? "0" : "1"} data-slug={r.slug} className={ROW}>
      <Link href={`/incidents/${r.slug}`} title={`${r.title}${r.cves.length ? ` · ${r.cves.join(", ")}` : ""}`} className={NAME}>
        {first ? <TypeIn text={r.title} /> : r.title}
      </Link>
      {r.severity >= 4 && (
        <span className="flex-none font-mono text-[11.5px] text-live" title="Harm confirmed: data, money or service lost">
          harm
        </span>
      )}
      <StackTag labels={labels} ready={ready} />
      <AiTag type={r.type} />
      <Score score={r.cvss} />
      <ShortAgo iso={r.created} built={built} suffix=" ago" className={`${TIME} !w-[62px] text-dim`} />
    </li>
  );
}

/**
 * One list: its title and count over a hairline (`data-head`, which
 * scripts/check-home.mjs reads; `hint` is its hover note), the link to
 * everything behind the count at the right, then the rows.
 */
function List({ group, count, title, hint, more, children }: { group: "due" | "patch" | "new"; count: number; title: string; hint: string; more?: ReactNode; children: ReactNode }) {
  return (
    <div data-group={group} className="min-w-0">
      <header data-head title={hint} className="flex items-baseline gap-2 border-b border-white/10 pb-2.5">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <Num value={String(count)} className="font-mono text-[12px] text-dim" />
        {more && <span className="ml-auto font-mono text-[12px] whitespace-nowrap text-dim [&_a:hover]:text-accent [&_button:hover]:text-accent">{more}</span>}
      </header>
      <ol>{children}</ol>
    </div>
  );
}

/** A line where a list has no rows. `quiet` is one that is no finding of its own: the card above already holds the list's only row. */
function Note({ quiet, children }: { quiet?: boolean; children: ReactNode }) {
  return (
    <li {...(quiet ? {} : { "data-note": "" })} className="flex h-[42px] items-center text-[13px] text-dim">
      {children}
    </li>
  );
}

/* ---------- the drawers ---------- */

function DrawerRow({ score, href, external, name, cve, more, children }: { score: number | null; href: string; external?: boolean; name: string; cve?: string; more?: number; children: ReactNode }) {
  const cls = "text-[13.5px] text-ink hover:text-accent";
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 border-t border-line-soft py-2.5 first:border-t-0">
      <div className="pt-0.5">
        <ScoreOrDash score={score} />
      </div>
      <div className="min-w-0">
        {external ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
            {name}
          </a>
        ) : (
          <Link href={href} className={cls}>
            {name}
          </Link>
        )}
        {cve && (
          <span className="num ml-2 text-[12px] text-dim">
            {cve}
            {more ? ` +${more}` : ""}
          </span>
        )}
        <p className="num mt-0.5 text-[12px] text-dim">{children}</p>
      </div>
    </li>
  );
}

function LedgerDrawer({ open, onClose, kicker, title, count, footerLink, children }: { open: boolean; onClose: () => void; kicker: string; title: string; count: string; footerLink: { href: string; label: string; external?: boolean }; children: ReactNode }) {
  const titleId = useId();
  return (
    <Drawer open={open} onClose={onClose} titleId={titleId} kicker={kicker} footerLink={footerLink} closeLabel="Close the list">
      <header className="space-y-1">
        <h2 id={titleId} className="text-[18px] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h2>
        <p className="num text-[13px] text-dim">{count}</p>
      </header>
      <ol className="border-y border-line-soft">{children}</ol>
    </Drawer>
  );
}

/* ---------- the card and its lists ---------- */

export function Ledger({ ledger, built }: { ledger: LedgerData; built: string }) {
  const { picks, isDefault, file, ready, aiOnly: ai } = usePanelState();
  const [open, setOpen] = useState<null | "later" | "patch">(null);
  const builtMs = useMemo(() => Date.parse(built), [built]);
  const now = useNow(builtMs);
  const today = new Date(now).toISOString().slice(0, 10);
  const hits = useMemo<StackHits | null>(() => (isDefault || !file ? null : stackHits(file, picks)), [isDefault, file, picks]);
  const labelsOf = (row: { cves: string[]; stack: string[] }, href: string) => (hits ? rowStack(hits, { cves: row.cves, href }) : row.stack);

  const isAi = (r: { type: IncidentType }) => r.type !== "not_ai";
  // a deadline has no AI role of its own: it counts as AI when an AI record without a full patch names one of its CVEs
  const aiCves = useMemo(() => new Map(ledger.patch.filter((r) => r.type !== "not_ai").flatMap((r) => r.cves.map((c) => [c, r.type] as const))), [ledger.patch]);
  const dueType = (r: DueRow): IncidentType => r.cves.map((c) => aiCves.get(c)).find(Boolean) ?? "not_ai";

  // deadlines still ahead by the visitor's clock, nearest first: the first is the card's lead, the next ones the list
  const dueAhead = ledger.due.filter((r) => dueEnd(r.due) > now);
  const dueAll: DueOnRunway[] = dueAhead.map((r) => ({ ...r, type: dueType(r), labels: labelsOf(r, r.href) })).filter((r) => !ai || isAi(r));
  // a record without a patch is one of those deadline rows only while its deadline is still ahead
  const aheadCves = new Set(dueAhead.flatMap((r) => r.cves));
  const dueList = dueAll.slice(1, LEDGER_DUE_ROWS);
  const openAll: OpenOnRunway[] = ledger.patch.filter((r) => !foldedOnDeadline(r.cves, aheadCves) && (!ai || isAi(r))).map((r) => ({ ...r, labels: labelsOf(r, `/incidents/${r.slug}`) }));
  const patch = openAll.slice(0, LEDGER_PATCH_ROWS);
  const fresh = (ai ? ledger.fresh.filter(isAi) : ledger.fresh).slice(0, LEDGER_NEW_ROWS);
  const patchAi = ledger.patch.filter(isAi).length;
  const openCount = ai ? patchAi : ledger.noFullPatch;
  const freshCount = ai ? ledger.freshAi : ledger.freshTotal;
  const days = ledger.freshDays.map((d) => (ai ? { n: d.ai, harm: d.aiHarm } : { n: d.n, harm: d.harm }));
  const harm = days.reduce((n, d) => n + d.harm, 0);
  const ahead = ledger.due.length + ledger.later.length;
  const unpatched = ledger.patch.filter((r) => r.patch === "unpatched").length;
  const partial = ledger.noFullPatch - unpatched;

  return (
    <div data-ledger data-filter={ai ? "ai" : "all"} className="flex min-w-0 flex-col gap-5">
      <Runway now={now} built={builtMs} due={dueAll} later={ledger.later.length} onLater={() => setOpen("later")} open={openAll} openCount={openCount} days={days} fresh={freshCount} harm={harm} ai={ai} ready={ready} />

      <section id="ledger" data-build data-instrument="ledger" aria-label="Needs action" className="grid min-w-0 scroll-mt-6 gap-x-10 gap-y-6 lg:grid-cols-3">
        <List
          group="due"
          count={dueAll.length}
          title="Patch due this week"
          hint={DUE_NOTE}
          more={
            ahead > dueAll.length || dueAll.length > LEDGER_DUE_ROWS ? (
              <button type="button" onClick={() => setOpen("later")}>
                all {ahead} →
              </button>
            ) : null
          }
        >
          {dueAll.length === 0 && <Note>{ai ? "No deadline this week is for an AI product." : "No CISA deadline falls this week."}</Note>}
          {dueAll.length > 0 && dueList.length === 0 && <Note quiet>Nothing else is due this week.</Note>}
          {dueList.map((r) => (
            <DueLi key={r.cves[0]} r={r} ready={ready} today={today} />
          ))}
        </List>

        <List
          group="patch"
          count={openCount}
          title="No patch yet"
          hint={`Live exploited records without a full patch: ${unpatched} with no patch, ${partial} partly patched`}
          more={
            <button type="button" onClick={() => setOpen("patch")}>
              all {ledger.noFullPatch} →
            </button>
          }
        >
          {patch.length === 0 && <Note>{openCount ? "Listed under Patch due this week." : ai ? "No AI record is waiting for a patch." : "Every exploited record has a patch."}</Note>}
          {patch.map((r) => (
            <PatchLi key={r.slug} r={r} ready={ready} built={built} />
          ))}
        </List>

        <List
          group="new"
          count={freshCount}
          title="New this week"
          hint={ai ? "Exploited records that entered the dataset in 7 days with AI as the target or the weapon" : `Exploited records that entered the dataset in 7 days, harm first: ${ledger.freshLoss} with harm confirmed (data, money or service lost)`}
          more={<Link href="/live">live board →</Link>}
        >
          {fresh.length === 0 && <Note>{ai ? "No new AI record this week." : "Nothing new this week."}</Note>}
          {fresh.map((r, i) => (
            <NewLi key={r.slug} r={r} labels={labelsOf(r, `/incidents/${r.slug}`)} ready={ready} built={built} first={!ai && i === 0} />
          ))}
        </List>
      </section>

      <LedgerDrawer open={open === "later"} onClose={() => setOpen(null)} kicker="CISA KEV · deadlines ahead" title="Every deadline still ahead" count={`${ahead} deadlines · ${ledger.due.length} this week`} footerLink={{ href: KEV_CATALOG, label: "CISA’s catalog →", external: true }}>
        {[...ledger.due, ...ledger.later].map((r) => (
          <DrawerRow key={r.cves[0]} score={r.cvss} href={r.href} external={r.external} name={r.name} cve={r.cves[0]} more={r.cves.length - 1}>
            listed by CISA {dateLabel(r.added)} · <span className="text-accent">patch by {dateLabel(r.due)}</span>
            {r.ransomware && <span className="ml-2 text-live">ransomware</span>}
          </DrawerRow>
        ))}
      </LedgerDrawer>
      <LedgerDrawer open={open === "patch"} onClose={() => setOpen(null)} kicker="Our records · exploited, no full patch" title="Without a full patch" count={`${ledger.noFullPatch} live exploited records · ${unpatched} with no patch yet`} footerLink={{ href: "/live?lane=patch", label: "the patch lane →" }}>
        {ledger.patch.map((r) => (
          <DrawerRow key={r.slug} score={r.cvss} href={`/incidents/${r.slug}`} name={r.title} cve={r.cves[0]} more={r.cves.length - 1}>
            reported {dateLabel(r.reported)}
            <span className={`ml-2 ${r.patch === "unpatched" ? "text-live" : "text-partial"}`}>{r.patch === "unpatched" ? "no patch yet" : "partly patched"}</span>
          </DrawerRow>
        ))}
      </LedgerDrawer>
    </div>
  );
}
