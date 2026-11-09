import Link from "next/link";
import type { ReactNode } from "react";
import { FlowRibbons } from "@/components/home/panel/FlowRibbons";
import { Instrument } from "@/components/home/panel/Instrument";
import { Cells, Units } from "@/components/home/panel/marks";
import { Num } from "@/components/home/panel/Num";
import type { AiFlow as AiFlowData, AttackTypeRow, FlowRole, SurfaceRow } from "@/lib/panel";
import { SITE } from "@/lib/site";
import type { Lane } from "@/lib/taxonomy";

/**
 * The server-rendered instruments in the panel's grammar (rules in
 * lib/panel): the attack types and the attack surface, how AI shows up, and
 * the home page's footer rows. The first three sit on /trends under the
 * web's charts; each is final in the HTML, and the client only builds the
 * marks in and draws the AI flow's ribbons.
 */

/* ---------- Attack types and Attack surface: two tables on one grid ---------- */

/**
 * The two side-by-side tables share one grid (label, marks, two numbers) and
 * one row height, so their labels, bars and numbers sit on the same lines
 * across the gutter. Both start with the same 18 px head row.
 */
const TABLE_COLS = "grid-cols-[minmax(0,150px)_minmax(0,1fr)_30px_30px] gap-x-2 sm:grid-cols-[minmax(0,210px)_minmax(0,1fr)_36px_36px] sm:gap-x-3";
const TABLE_HEAD = `grid h-[18px] items-end ${TABLE_COLS} font-mono text-[12px] tracking-[0.06em] text-faint`;
const TABLE_ROW = `grid h-[30px] items-center ${TABLE_COLS}`;

function TableHead({ a, b }: { a: string; b: string }) {
  return (
    <li aria-hidden className={TABLE_HEAD}>
      <span />
      <span />
      <span className="text-right">{a}</span>
      <span className="text-right">{b}</span>
    </li>
  );
}

const TYPE_CELLS = 26;

export function AttackTypes({ rows }: { rows: AttackTypeRow[] }) {
  const max = Math.max(1, ...rows.map((t) => t.n));
  return (
    <Instrument id="types" label="Attack types" sub="incidents in the last 7 days" source="our records" caption="AI counts the incidents where AI was the target or the weapon. Disclosed CVEs without exploitation are left out.">
      <ol data-types>
        <TableHead a="all" b="AI" />
        {rows.map((t) => (
          <li key={t.key} data-type={t.key} data-n={t.n} data-ai={t.ai} className={TABLE_ROW}>
            <span className="truncate text-[13px] text-soft">{t.label}</span>
            <span className="min-w-0 overflow-hidden">
              <Cells n={Math.max(1, Math.round((t.n / max) * TYPE_CELLS))} />
            </span>
            <Num value={String(t.n)} className="text-right font-mono text-[13px] text-ink" />
            <Num value={String(t.ai)} className={`text-right font-mono text-[13px] ${t.ai ? "text-accent" : "text-faint"}`} />
          </li>
        ))}
      </ol>
    </Instrument>
  );
}

export function AttackSurface({ rows }: { rows: SurfaceRow[] }) {
  return (
    <Instrument id="surface" label="Attack surface" sub="exploited, by technology, 90 days" source="CISA KEV" caption="One square per CVE CISA listed as exploited; bright ones were listed in the last 30 days.">
      <ol data-surface>
        <TableHead a="90 d" b="30 d" />
        {rows.map((s) => (
          <li key={s.label} data-tech={s.label} data-n={s.n} data-recent={s.recent} className={TABLE_ROW}>
            <span className="truncate text-[13px] text-soft">{s.label}</span>
            <span className="min-w-0">
              <Units n={s.n} bright={s.recent} />
            </span>
            <Num value={String(s.n)} className="text-right font-mono text-[13px] text-ink" />
            <Num value={String(s.recent)} className={`text-right font-mono text-[13px] ${s.recent ? "text-accent" : "text-faint"}`} />
          </li>
        ))}
      </ol>
    </Instrument>
  );
}

/* ---------- How AI shows up ---------- */

const PLURAL: Record<string, string> = { framework_or_tooling: "frameworks and tooling", open_weight_model: "open-weight models", enterprise_deployment: "enterprise deployments", individual_victims: "individuals" };

function Node({ cls, n, label, role }: { cls: "t" | "w" | "z"; n: number; label: string; role?: FlowRole }) {
  return (
    <div data-node={cls} data-n={n} className={`min-w-0 border-l-2 py-1 pl-3.5 ${cls === "z" ? "border-line" : "border-accent"}`}>
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <Num value={String(n)} className={`font-mono text-[24px] font-medium leading-[1.1] ${cls === "z" ? "text-dim" : "text-ink"}`} />
        <span className={`text-[13px] ${cls === "z" ? "font-medium text-dim" : "font-semibold text-soft"}`}>{label}</span>
      </div>
      {role && role.techniques.length > 0 && (
        <div className="mt-0.5 truncate font-mono text-[12px] text-dim">
          {role.techniques.map((t, i) => (
            <span key={t.key}>
              {i > 0 && " · "}
              <b className="font-medium text-soft">{t.n}</b> {t.label}
            </span>
          ))}
        </div>
      )}
      {role?.case && (
        <Link href={`/incidents/${role.case.slug}`} title={role.case.title} className="mt-1 block truncate text-[13px] text-soft hover:text-accent">
          {role.case.title}
        </Link>
      )}
    </div>
  );
}

export function AiFlow({ ai }: { ai: AiFlowData }) {
  const hit = ai.target.targets.map((t) => `${PLURAL[t.key] ?? t.label} (${t.n})`).join(" and ");
  const counts = [
    { cls: "t" as const, n: ai.target.n },
    { cls: "w" as const, n: ai.weapon.n },
    { cls: "z" as const, n: ai.none },
  ];
  return (
    <Instrument
      id="ai"
      full
      label="How AI shows up"
      sub="this week's incidents, by the role AI played"
      source="our records · CISA KEV"
      caption={
        <>
          One dotted line per two incidents.{hit ? ` Attacks on AI mostly hit ${hit}.` : ""} Disclosed CVEs without exploitation are left out of the flow and counted as the weak link.
        </>
      }
    >
      <div data-flow className="grid gap-y-3.5 sm:grid-cols-[140px_minmax(0,1fr)_minmax(0,330px)] sm:gap-x-[18px] lg:grid-cols-[168px_minmax(0,1fr)_minmax(0,460px)]">
        <div className="flex items-baseline gap-3 border-b border-line-soft pb-2.5 sm:flex-col sm:items-start sm:justify-center sm:gap-0 sm:border-r sm:border-b-0 sm:pr-2.5 sm:pb-0">
          <Num value={String(ai.total)} className="font-mono text-[40px] font-medium leading-none text-ink" />
          <span className="font-mono text-[12px] leading-normal text-dim sm:mt-2">
            incidents
            <br className="hidden sm:block" /> 7 days, every lane
          </span>
        </div>
        <FlowRibbons counts={counts} />
        <div className="flex flex-col justify-between gap-4">
          <Node cls="t" n={ai.target.n} label="AI is the target" role={ai.target} />
          <Node cls="w" n={ai.weapon.n} label="AI is the weapon" role={ai.weapon} />
          <Node cls="z" n={ai.none} label="no AI role" />
        </div>
      </div>
      <div data-weak className="mt-5 grid items-center gap-2 border-t border-line-soft pt-3.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-x-[18px] lg:grid-cols-[168px_minmax(0,1fr)]">
        <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-dim">AI as the weak link</span>
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 font-mono text-[12px] text-dim">
          <span className="max-w-[260px]">
            <Units n={ai.weak.cves} red={ai.weak.exploited} />
          </span>
          <span>
            <Num value={String(ai.weak.cves)} className="text-[15px] font-medium text-ink" /> CVEs in AI software this week · <Num value={String(ai.weak.exploited)} className="text-[15px] font-medium text-ink" /> exploited
          </span>
          {ai.weak.kevProducts.length > 0 && <span>on CISA&rsquo;s list this year: {ai.weak.kevProducts.join(", ")}</span>}
        </div>
      </div>
    </Instrument>
  );
}

/* ---------- the footer strip ---------- */

/** One row of the strip: its key, the items with an interpunct between each pair, and an optional tail at the right. */
function FootRow({ k, items, tail }: { k: string; items: ReactNode[]; tail?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-1.5">
      <span className="min-w-[104px] uppercase tracking-[0.1em] text-faint">{k}</span>
      {items.flatMap((item, i) =>
        i
          ? [
              <span key={`dot-${i}`} aria-hidden className="text-faint">
                ·
              </span>,
              item,
            ]
          : [item],
      )}
      {tail && <span className="text-faint sm:ml-auto">{tail}</span>}
    </div>
  );
}

/**
 * The home page's footer strip under the two panels: what else is live, this
 * week's briefing and the machine-readable files, each one quiet mono line
 * without a hairline of its own.
 */
export function PanelFoot({ lanes, live, breachesMonth, accountsMonth, briefing }: { lanes: Record<Lane, number>; live: number; breachesMonth: number | null; accountsMonth: number | null; briefing: { week: string; headline: string } | null }) {
  const n = (v: number) => <span className="num text-ink">{v.toLocaleString("en-US")}</span>;
  const link = "hover:text-ink";
  const also: ReactNode[] = [
    <Link key="patch" href="/live?lane=patch" className={link}>
      Patch {n(lanes.patch)}
    </Link>,
    <Link key="breach" href="/live?lane=breach" className={link}>
      Breaches {n(lanes.breach)}
    </Link>,
    <Link key="supply" href="/live?lane=supply_chain" className={link}>
      Supply chain {n(lanes.supply_chain)}
    </Link>,
    <Link key="research" href="/live?lane=research" className={link}>
      Research {n(lanes.research)}
    </Link>,
  ];
  if (breachesMonth !== null && accountsMonth !== null)
    also.push(
      <Link key="month" href="/trends#web" className={link}>
        Breaches this month {n(breachesMonth)}, <span className="num text-ink">{(accountsMonth / 1e6).toFixed(1)} M</span> accounts
      </Link>,
    );
  also.push(
    <Link key="live" href="/live" className="text-soft hover:text-accent">
      all {live} on the live board →
    </Link>,
  );
  const machines = [
    ["/feed.xml", "RSS"],
    ["/feed.json", "JSON Feed"],
    ["/changes.json", "changes.json"],
    ["/llms.txt", "llms.txt"],
    ["/live.json", "live.json"],
    ["/stats/home.json", "stats"],
    ["/data", "every file"],
  ].map(([href, label]) => (
    <a key={href} href={href} className={link}>
      {label}
    </a>
  ));
  return (
    <footer data-panel-foot className="mt-8 border-t border-line-soft pt-2.5 font-mono text-[12px] text-dim">
      <FootRow k="Also live" items={also} />
      {briefing && (
        <FootRow
          k="This week"
          items={[
            <Link key="headline" href={`/briefing/${briefing.week}`} className="font-sans text-[13px] text-soft hover:text-accent">
              {briefing.headline}
            </Link>,
            <span key="week" className="text-faint">
              {briefing.week}
            </span>,
          ]}
        />
      )}
      <FootRow k="For machines" items={machines} tail={<>data {SITE.dataLicense.name} · NVD public domain · CISA KEV CC0 · HIBP CC BY 4.0 · EPSS by FIRST</>} />
    </footer>
  );
}
