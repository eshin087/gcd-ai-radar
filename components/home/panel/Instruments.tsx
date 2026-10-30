import Link from "next/link";
import { FlowRibbons } from "@/components/home/panel/FlowRibbons";
import { Instrument, Pulse } from "@/components/home/panel/Instrument";
import { Countdown, ShortAgo, TypeIn } from "@/components/home/panel/Live";
import { Cells, ScoreOrDash, SevMeter, Units } from "@/components/home/panel/marks";
import { Num } from "@/components/home/panel/Num";
import { CvssChip } from "@/components/ui/Badge";
import type { ActNow as ActNowData } from "@/lib/panel/act";
import type { AiFlow as AiFlowData, AttackTypeRow, FlowRole, LatestRow, SurfaceRow } from "@/lib/panel";
import { shortDate } from "@/lib/panel/util";
import { LANE_COLORS } from "@/lib/palette";
import { SITE } from "@/lib/site";
import type { Lane } from "@/lib/taxonomy";

/**
 * The panel's server-rendered instruments (rules in lib/panel). Each is final
 * in the HTML; the client only builds the marks in, ticks the clocks and
 * draws the AI flow's ribbons.
 */

/* ---------- Act now ---------- */

export function ActNow({ act, today }: { act: ActNowData; today: string }) {
  return (
    <Instrument id="act" label="Act now" sub="exploited, deadline soon or no patch" source="CISA KEV · our records">
      <ol data-act className="border-b border-line-soft">
        {act.rows.map((r, i) => {
          const fact = r.cves.length > 1 ? `${r.cves.length} CVEs` : (r.cves[0] ?? "");
          return (
            <li key={i} data-act-row={r.kind} className="grid min-h-[40px] grid-cols-[12px_minmax(0,1fr)_38px_112px] items-center gap-x-3 border-t border-line-soft py-1.5 sm:grid-cols-[12px_minmax(0,1fr)_38px_minmax(0,150px)_132px]">
              <Pulse />
              {r.kind === "kev" && r.external ? (
                <a href={r.href} target="_blank" rel="noopener noreferrer" title={`${r.name}: ${r.cves.join(", ")}`} className="truncate text-[14px] font-semibold text-ink hover:text-accent">
                  {r.name}
                </a>
              ) : (
                <Link href={r.href} title={r.kind === "record" ? r.title : `${r.name}: ${r.cves.join(", ")}`} className="truncate text-[14px] font-semibold text-ink hover:text-accent">
                  {r.name}
                </Link>
              )}
              <ScoreOrDash score={r.cvss} />
              <span className="hidden truncate font-mono text-[12px] text-dim sm:block">{fact}</span>
              {r.kind === "kev" ? (
                <span className="text-right font-mono text-[12px] leading-tight whitespace-nowrap text-accent">
                  due {r.due === today ? "today" : shortDate(r.due)}
                  <Countdown due={r.due} className="block text-[11px] text-faint" />
                </span>
              ) : (
                <span className={`text-right font-mono text-[12px] leading-tight whitespace-nowrap ${r.patch === "partial" ? "text-partial" : "text-live"}`}>
                  {r.patch === "partial" ? "partly patched" : "no patch yet"}
                  <span className="block text-[11px] text-faint">since {shortDate(r.reported)}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {act.rows.length === 0 && <p className="py-4 text-[13px] text-dim">Nothing exploited is due or unpatched right now.</p>}
      <Link href="/live" className="mt-3 inline-block font-mono text-[12px] uppercase tracking-[0.08em] text-accent hover:underline">
        all {act.exploitedLive} exploited records →
      </Link>
    </Instrument>
  );
}

/* ---------- Latest ---------- */

const LANE_WORD: Record<Lane, string> = { patch: "patch", breach: "breach", supply_chain: "supply", research: "research" };

export function Latest({ rows, built }: { rows: LatestRow[]; built: string }) {
  return (
    <Instrument
      id="latest"
      label="Latest"
      sub="exploited or worse, every lane"
      source={<Link href="/live">live board →</Link>}
      caption="Bars: severity, three for exploited, four for confirmed loss. CVSS shows when the record has one."
    >
      <ol data-latest className="border-b border-line-soft">
        {rows.map((l, i) => (
          <li key={l.slug} data-row-lane={l.lane} className="grid min-h-[40px] grid-cols-[52px_22px_minmax(0,1fr)] items-center gap-x-2.5 border-t border-line-soft py-1.5 sm:grid-cols-[58px_22px_minmax(0,1fr)_auto]">
            <span className="font-mono text-[12px]" style={{ color: LANE_COLORS[l.lane] }}>
              {LANE_WORD[l.lane]}
            </span>
            <SevMeter severity={l.severity} />
            <Link href={`/incidents/${l.slug}`} title={l.title} className="min-w-0 truncate text-[14px] text-ink hover:text-accent">
              {l.cvss !== null && (
                <span className="mr-2 align-[1px]">
                  <CvssChip score={l.cvss} />
                </span>
              )}
              {i === 0 ? <TypeIn text={l.title} /> : l.title}
            </Link>
            <span className="col-start-3 font-mono text-[12px] whitespace-nowrap text-faint sm:col-start-auto">
              {l.type !== "not_ai" && <span className="mr-2.5 text-accent">{l.type === "attack_on_ai" ? "on AI" : "using AI"}</span>}
              <ShortAgo iso={l.created} built={built} />
            </span>
          </li>
        ))}
      </ol>
    </Instrument>
  );
}

/* ---------- Attack types ---------- */

const TYPE_CELLS = 26;

export function AttackTypes({ rows }: { rows: AttackTypeRow[] }) {
  const max = Math.max(1, ...rows.map((t) => t.n));
  return (
    <Instrument id="types" label="Attack types" sub="incidents in the last 7 days" source="our records" caption="AI counts the incidents where AI was the target or the weapon. Disclosed CVEs without exploitation are left out.">
      <ol data-types>
        <li aria-hidden className="grid h-[18px] grid-cols-[minmax(0,150px)_minmax(0,1fr)_28px_28px] gap-x-2 font-mono text-[11px] tracking-[0.06em] text-faint sm:grid-cols-[minmax(0,210px)_minmax(0,1fr)_32px_32px] sm:gap-x-3">
          <span />
          <span />
          <span className="text-right">ALL</span>
          <span className="text-right">AI</span>
        </li>
        {rows.map((t) => (
          <li key={t.key} data-type={t.key} data-n={t.n} data-ai={t.ai} className="grid h-[30px] grid-cols-[minmax(0,150px)_minmax(0,1fr)_28px_28px] items-center gap-x-2 sm:grid-cols-[minmax(0,210px)_minmax(0,1fr)_32px_32px] sm:gap-x-3">
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

/* ---------- Attack surface ---------- */

export function AttackSurface({ rows }: { rows: SurfaceRow[] }) {
  return (
    <Instrument id="surface" label="Attack surface" sub="exploited, by technology, 90 days" source="CISA KEV" caption="One square per CVE CISA listed as exploited. Bright: listed in the last 30 days.">
      <ol data-surface>
        {rows.map((s) => (
          <li key={s.label} data-tech={s.label} data-n={s.n} className="grid min-h-[30px] grid-cols-[minmax(0,130px)_minmax(0,1fr)_28px] items-center gap-x-3 py-1 sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)_32px]">
            <span className="truncate text-[13px] text-soft">{s.label}</span>
            <Units n={s.n} bright={s.recent} />
            <Num value={String(s.n)} className="text-right font-mono text-[13px] text-ink" />
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

/* ---------- the footer rows ---------- */

export function PanelFoot({ lanes, live, breachesMonth, accountsMonth, briefing }: { lanes: Record<Lane, number>; live: number; breachesMonth: number | null; accountsMonth: number | null; briefing: { week: string; headline: string } | null }) {
  const row = "flex flex-wrap items-baseline gap-x-[18px] gap-y-1.5 border-b border-line-soft py-2.5";
  const key = "min-w-[110px] uppercase tracking-[0.1em] text-faint";
  const n = (v: number) => <span className="num text-ink">{v.toLocaleString("en-US")}</span>;
  return (
    <footer data-panel-foot className="mt-12 border-t border-line font-mono text-[12px] text-dim">
      <div className={row}>
        <span className={key}>Also live</span>
        <Link href="/live?lane=patch" className="hover:text-ink">
          Patch {n(lanes.patch)}
        </Link>
        <Link href="/live?lane=breach" className="hover:text-ink">
          Breaches {n(lanes.breach)}
        </Link>
        <Link href="/live?lane=supply_chain" className="hover:text-ink">
          Supply chain {n(lanes.supply_chain)}
        </Link>
        <Link href="/live?lane=research" className="hover:text-ink">
          Research {n(lanes.research)}
        </Link>
        {breachesMonth !== null && accountsMonth !== null && (
          <Link href="/trends#web" className="hover:text-ink">
            Breaches this month {n(breachesMonth)} · <span className="num text-ink">{(accountsMonth / 1e6).toFixed(1)} M</span> accounts
          </Link>
        )}
        <Link href="/live" className="text-accent hover:underline">
          all {live} on the live board →
        </Link>
      </div>
      {briefing && (
        <div className={row}>
          <span className={key}>This week</span>
          <Link href={`/briefing/${briefing.week}`} className="font-sans text-[14px] text-soft hover:text-accent">
            {briefing.headline}
          </Link>
          <span className="text-faint">{briefing.week}</span>
        </div>
      )}
      <div className={row}>
        <span className={key}>For machines</span>
        {[
          ["/feed.xml", "RSS"],
          ["/feed.json", "JSON Feed"],
          ["/changes.json", "changes.json"],
          ["/llms.txt", "llms.txt"],
          ["/live.json", "live.json"],
          ["/stats/home.json", "stats"],
          ["/data", "every file"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="hover:text-ink">
            {label}
          </a>
        ))}
        <span className="text-faint sm:ml-auto">
          data {SITE.dataLicense.name} · NVD public domain · CISA KEV CC0 · HIBP CC BY 4.0 · EPSS by FIRST
        </span>
      </div>
    </footer>
  );
}
