"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Instrument, Pulse } from "@/components/home/panel/Instrument";
import { Countdown, ShortAgo, TypeIn } from "@/components/home/panel/Live";
import { ScoreOrDash, SevMeter } from "@/components/home/panel/marks";
import { Num } from "@/components/home/panel/Num";
import { usePanelState } from "@/components/home/panel/PanelState";
import { Drawer } from "@/components/ui/Drawer";
import { dateLabel } from "@/lib/format";
import { LEDGER_DUE_ROWS, LEDGER_NEW_ROWS, LEDGER_PATCH_ROWS } from "@/lib/panel/caps";
import { shortDate } from "@/lib/panel/dates";
import type { DueRow, Ledger as LedgerData, NewRow, PatchRow } from "@/lib/panel/ledger";
import { rowStack, stackHits, type StackHits } from "@/lib/panel/picks";
import { LANE_COLORS } from "@/lib/palette";
import type { IncidentType, Lane } from "@/lib/taxonomy";

/**
 * The ledger (lib/panel/ledger.ts): what is exploited and still needs doing,
 * three groups of one-line rows on one grid: a glyph (the red pulse for open
 * items, a still amber dot for partly patched ones, the severity meter for
 * new records), the name, the CVSS chip, a fact (the CVE id, or the lane and
 * product) and the status over a live sub-line (the time left to a deadline,
 * "since 6 Nov", the age). Rows in the visitor's stack carry a red mark, recomputed
 * in the browser for their own picks; AI records an amber one, and "AI only"
 * keeps only those rows, the group counts dissolving to match. "N later"
 * opens every deadline ahead, "all without a full patch" every record
 * waiting for one. The newest row types itself in once.
 */

const KEV_CATALOG = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog";
const LANE_WORD: Record<Lane, string> = { patch: "patch", breach: "breach", supply_chain: "supply", research: "research" };
const ROW = "grid min-h-[36px] grid-cols-[22px_minmax(0,1fr)_38px_108px] items-center gap-x-2.5 border-t border-line-soft py-1 sm:grid-cols-[22px_minmax(0,1fr)_38px_minmax(0,120px)_132px] sm:gap-x-3";
const NAME = "min-w-0 truncate text-[14px] text-ink hover:text-accent";
const FACT = "hidden truncate font-mono text-[12px] text-dim sm:block";
const STATUS = "text-right font-mono text-[12px] leading-tight whitespace-nowrap";
const SUB = "block text-[11px] text-faint";

function StackMark({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <span data-stack-mark={labels.join(",")} title={`In your stack: ${labels.join(", ")}`} className="inline-flex shrink-0 items-center rounded-[2px] border border-live/45 bg-live/10 px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.06em] text-live">
      <span className="hidden sm:inline lg:hidden xl:inline">your stack · {labels[0]}</span>
      <span className="sm:hidden lg:inline xl:hidden">stack</span>
    </span>
  );
}

function AiMark({ type }: { type: IncidentType }) {
  if (type === "not_ai") return null;
  const on = type === "attack_on_ai";
  return (
    <span data-ai-mark={on ? "on" : "using"} title={on ? "Attack on AI: an AI model, agent or AI-powered product was the thing exploited" : "AI-enabled attack: attackers used AI as a meaningful part of the attack"} className="inline-flex shrink-0 items-center rounded-[2px] border border-accent/40 bg-accent-tint px-1.5 py-px font-mono text-[11px] uppercase tracking-[0.06em] text-accent">
      <span className="hidden sm:inline lg:hidden xl:inline">{on ? "on AI" : "using AI"}</span>
      <span className="sm:hidden lg:inline xl:hidden">AI</span>
    </span>
  );
}

/** The name cell: the link, then the marks, which wait hidden while a visitor's own stack loads. */
function NameCell({ ready, labels, type, children }: { ready: boolean; labels: string[]; type?: IncidentType; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {children}
      <span data-stack={ready ? "ready" : "wait"} className="contents">
        <StackMark labels={labels} />
      </span>
      {type && <AiMark type={type} />}
    </span>
  );
}

function DueLi({ r, labels, ready, today }: { r: DueRow; labels: string[]; ready: boolean; today: string }) {
  const title = `${r.name}: ${r.cves.join(", ")}${r.ransomware ? " · known ransomware use" : ""}`;
  const cls = `${NAME} font-semibold`;
  return (
    <li data-row="due" data-ai="0" data-name={r.name} className={ROW}>
      <span className="flex justify-center">
        <Pulse />
      </span>
      <NameCell ready={ready} labels={labels}>
        {r.external ? (
          <a href={r.href} target="_blank" rel="noopener noreferrer" title={title} className={cls}>
            {r.name}
          </a>
        ) : (
          <Link href={r.href} title={title} className={cls}>
            {r.name}
          </Link>
        )}
      </NameCell>
      <ScoreOrDash score={r.cvss} />
      <span className={FACT}>
        {r.cves.length > 1 ? `${r.cves.length} CVEs` : r.cves[0]}
        {r.ransomware && <span className="text-live"> · ransomware</span>}
      </span>
      <span className={`${STATUS} text-accent`}>
        due {r.due === today ? "today" : shortDate(r.due)}
        <Countdown due={r.due} className={SUB} />
      </span>
    </li>
  );
}

function PatchLi({ r, labels, ready, hidden }: { r: PatchRow; labels: string[]; ready: boolean; hidden: boolean }) {
  const open = r.patch === "unpatched";
  return (
    <li data-row="patch" data-ai={r.type === "not_ai" ? "0" : "1"} data-name={r.name} hidden={hidden} className={ROW}>
      <span className="flex justify-center">
        {open ? (
          <Pulse />
        ) : (
          <span aria-hidden className="w-[1ch] text-center font-mono text-[13px] leading-none text-partial">
            •
          </span>
        )}
      </span>
      <NameCell ready={ready} labels={labels} type={r.type}>
        <Link href={`/incidents/${r.slug}`} title={r.title} className={`${NAME} font-semibold`}>
          {r.name}
        </Link>
      </NameCell>
      <ScoreOrDash score={r.cvss} />
      <span className={FACT}>{r.cves.length > 1 ? `${r.cves[0]} +${r.cves.length - 1}` : r.cves[0]}</span>
      <span className={`${STATUS} ${open ? "text-live" : "text-partial"}`}>
        {open ? "no patch yet" : "partly patched"}
        <span className={SUB}>since {shortDate(r.reported)}</span>
      </span>
    </li>
  );
}

function NewLi({ r, labels, ready, built, first, hidden }: { r: NewRow; labels: string[]; ready: boolean; built: string; first: boolean; hidden: boolean }) {
  const loss = r.severity >= 4;
  return (
    <li data-row="new" data-ai={r.type === "not_ai" ? "0" : "1"} data-slug={r.slug} hidden={hidden} className={ROW}>
      <span className="flex justify-center">
        <SevMeter severity={r.severity} />
      </span>
      <NameCell ready={ready} labels={labels} type={r.type}>
        <Link href={`/incidents/${r.slug}`} title={r.title} className={NAME}>
          {first ? <TypeIn text={r.title} /> : r.title}
        </Link>
      </NameCell>
      <ScoreOrDash score={r.cvss} />
      <span className={FACT}>
        <span style={{ color: LANE_COLORS[r.lane] }}>{LANE_WORD[r.lane]}</span>
        {r.product && ` · ${r.product}`}
      </span>
      <span className={`${STATUS} ${loss ? "text-live" : "text-accent"}`}>
        {loss ? "confirmed loss" : "exploited"}
        <ShortAgo iso={r.created} built={built} className={SUB} />
      </span>
    </li>
  );
}

/** A group's head: its name in the panel titles' sans, smaller, and its counts and links in mono at the right. */
function Head({ group, label, sub, children }: { group: string; label: string; sub?: string; children: ReactNode }) {
  return (
    <li data-group={group} className="flex items-baseline justify-between gap-3 pt-6 pb-2 first:pt-0">
      <span className="whitespace-nowrap text-[13px] font-semibold text-soft">
        {label}
        {sub && <span className="ml-2 hidden font-normal text-faint sm:inline">{sub}</span>}
      </span>
      <span className="whitespace-nowrap font-mono text-[12px] text-faint [&_[data-num]]:text-soft [&_a]:text-dim [&_a:hover]:text-accent [&_b]:font-medium [&_b]:text-soft [&_button]:text-dim [&_button:hover]:text-accent">{children}</span>
    </li>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <li data-note className="border-t border-line-soft py-2 text-[13px] text-dim">
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

/* ---------- the instrument ---------- */

export function Ledger({ ledger, today, built }: { ledger: LedgerData; today: string; built: string }) {
  const { picks, isDefault, file, ready } = usePanelState();
  const [filter, setFilter] = useState<"all" | "ai">("all");
  const [open, setOpen] = useState<null | "later" | "patch">(null);
  const hits = useMemo<StackHits | null>(() => (isDefault || !file ? null : stackHits(file, picks)), [isDefault, file, picks]);
  const labelsOf = (row: { cves: string[]; stack: string[] }, href: string) => (hits ? rowStack(hits, { cves: row.cves, href }) : row.stack);

  const ai = filter === "ai";
  const due = ledger.due.slice(0, LEDGER_DUE_ROWS);
  const patchRows = ledger.patch.filter((r) => !r.onDeadlineRow);
  const patch = patchRows.slice(0, LEDGER_PATCH_ROWS);
  const fresh = ledger.fresh.slice(0, LEDGER_NEW_ROWS);
  const patchShown = ai ? patch.filter((r) => r.type !== "not_ai").length : patch.length;
  const newShown = ai ? fresh.filter((r) => r.type !== "not_ai").length : fresh.length;
  const later = ledger.later.length;
  const unpatched = ledger.patch.filter((r) => r.patch === "unpatched").length;

  return (
    <Instrument
      id="ledger"
      card="lead"
      label="Needs action"
      sub="exploited and still open"
      source={
        <>
          <span role="group" aria-label="Filter the ledger" className="mr-3.5 inline-flex">
            {(["all", "ai"] as const).map((f, i) => (
              <button key={f} type="button" data-filter={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={`px-1.5 uppercase tracking-[0.08em] hover:underline ${i ? "border-l border-line-soft" : ""} ${filter === f ? "!text-accent" : "!text-faint"}`}>
                {f === "all" ? "all" : "AI only"}
              </button>
            ))}
          </span>
          CISA KEV · our records
        </>
      }
    >
      <ol data-ledger data-filter={filter}>
        <Head group="due" label="Due this week">
          <Num value={String(ai ? 0 : ledger.due.length)} /> {ledger.due.length === 1 ? "deadline" : "deadlines"}
          {later > 0 && (
            <>
              {" · "}
              <button type="button" onClick={() => setOpen("later")}>
                {later} later →
              </button>
            </>
          )}
        </Head>
        {ai ? <Note>CISA&rsquo;s deadlines carry no AI role.</Note> : due.length === 0 ? <Note>No CISA deadline falls this week.</Note> : due.map((r) => <DueLi key={r.cves[0]} r={r} labels={labelsOf(r, r.href)} ready={ready} today={today} />)}

        <Head group="patch" label="No patch yet">
          <Num value={String(patchShown)} /> of <b>{ledger.noFullPatch}</b> ·{" "}
          <button type="button" onClick={() => setOpen("patch")}>
            <span className="hidden sm:inline">all without a full patch →</span>
            <span className="sm:hidden">all →</span>
          </button>
        </Head>
        {patch.length === 0 && <Note>Every exploited record has a patch.</Note>}
        {patch.map((r) => (
          <PatchLi key={r.slug} r={r} labels={labelsOf(r, `/incidents/${r.slug}`)} ready={ready} hidden={ai && r.type === "not_ai"} />
        ))}
        {ai && patch.length > 0 && patchShown === 0 && <Note>No AI record is waiting for a patch.</Note>}

        <Head group="new" label="New this week" sub="loss first">
          <Num value={String(ai ? ledger.freshAi : ledger.freshTotal)} /> <span className="hidden sm:inline">exploited</span>
          {!ai && (
            <>
              {" · "}
              <b>{ledger.freshLoss}</b> <span className="hidden sm:inline">with loss</span>
              <span className="sm:hidden">loss</span>
            </>
          )}
          {" · "}
          <Link href="/live">
            <span className="hidden sm:inline">all {ledger.exploitedLive} live →</span>
            <span className="sm:hidden">live →</span>
          </Link>
        </Head>
        {fresh.length === 0 && <Note>Nothing new this week.</Note>}
        {fresh.map((r, i) => (
          <NewLi key={r.slug} r={r} labels={labelsOf(r, `/incidents/${r.slug}`)} ready={ready} built={built} first={i === 0} hidden={ai && r.type === "not_ai"} />
        ))}
        {ai && fresh.length > 0 && newShown === 0 && <Note>No new AI record this week.</Note>}
      </ol>

      <LedgerDrawer open={open === "later"} onClose={() => setOpen(null)} kicker="CISA KEV · deadlines ahead" title="Every deadline still ahead" count={`${ledger.due.length + later} deadlines · ${ledger.due.length} this week`} footerLink={{ href: KEV_CATALOG, label: "CISA’s catalog →", external: true }}>
        {[...ledger.due, ...ledger.later].map((r) => (
          <DrawerRow key={r.cves[0]} score={r.cvss} href={r.href} external={r.external} name={r.name} cve={r.cves[0]} more={r.cves.length - 1}>
            listed by CISA {dateLabel(r.added)} · <span className="text-accent">due {dateLabel(r.due)}</span>
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
    </Instrument>
  );
}
