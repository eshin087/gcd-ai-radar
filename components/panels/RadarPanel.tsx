import type { ReactNode } from "react";
import type { Radar } from "@/lib/schema";
import { UI } from "@/lib/palette";
import { formatPct } from "@/lib/format";

interface Props {
  radar: Radar | null;
  /** Mark the numbers as illustrative (design phase). */
  sample?: boolean;
  variant?: "panel" | "strip" | "bare";
  className?: string;
}

/** One colour per declared purpose (five today), in the order Cloudflare lists them. */
const PURPOSE_COLORS = [UI.accent, "#7fdcff", "#a59cff", "#6b7fa8", UI.faint];

/** A big figure with its label above and one line of meaning below. */
function Figure({ label, value, note, accent = false }: { label: string; value: string; note: ReactNode; accent?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="text-[14px] text-soft">{label}</div>
      <div className={`text-[44px] font-semibold leading-none tracking-tight ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
      <div className="text-[12px] leading-snug text-dim">{note}</div>
    </div>
  );
}

/** A small heading for one column of the panel: what it shows, then its unit, fainter. */
function ColumnHead({ title, unit }: { title: string; unit: string }) {
  return (
    <h3 className="mb-3 text-[13.5px] text-soft">
      {title} <span className="text-faint">· {unit}</span>
    </h3>
  );
}

/**
 * Cloudflare Radar context: how much HTTP traffic is automated, the AI
 * crawlers' share of it, the top crawlers and why they say they crawl. The
 * panel is three columns on wide screens (figures, crawlers, purpose) over
 * one source line. Renders nothing when there is no data, so a missing token
 * or a changed API never breaks the page.
 */
export function RadarPanel({ radar, sample = false, variant = "panel", className = "" }: Props) {
  if (!radar) return null;
  const stamp = radar.fetched_at.slice(0, 10);

  if (variant === "strip") {
    const delta =
      radar.bot_share.previous !== null && radar.bot_share.previous !== 0
        ? ((radar.bot_share.value - radar.bot_share.previous) / radar.bot_share.previous) * 100
        : null;
    return (
      <div className={`flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px] ${className}`}>
        <span className="label">AI traffic signal</span>
        <span>
          bots <span className="num text-ink">{radar.bot_share.value.toFixed(1)}%</span> of HTTP requests{" "}
          <span className="num text-dim">{formatPct(delta, 1)} w/w</span>
        </span>
        {radar.derived_ai_share_of_requests !== null && (
          <span>
            AI crawlers ≈ <span className="num text-ink">{radar.derived_ai_share_of_requests.toFixed(1)}%</span>{" "}
            <span className="text-faint">(derived)</span>
          </span>
        )}
        <span className="text-dim">
          top: {radar.top_ai_bots.slice(0, 3).map((b) => b.name).join(", ")}
        </span>
        <span className="text-faint">
          Cloudflare Radar · {radar.range} · {stamp}
          {sample ? " · sample" : ""}
        </span>
      </div>
    );
  }

  // the week's change in percentage points, which is what a share moves by
  const pts = radar.bot_share.previous === null ? null : Number((radar.bot_share.value - radar.bot_share.previous).toFixed(1));
  const weekNote = pts === null ? "no reading for the week before" : pts === 0 ? "level with the week before" : `${pts > 0 ? "+" : "−"}${Math.abs(pts).toFixed(1)} pts on the week before`;
  const maxShare = Math.max(...radar.top_ai_bots.map((b) => b.share), 1);
  const days = radar.range.endsWith("d") ? `last ${radar.range.slice(0, -1)} days` : `last ${radar.range}`;

  return (
    <section className={`${variant === "panel" ? "panel" : ""} overflow-hidden ${className}`} aria-label="AI traffic on the web, from Cloudflare Radar">
      <div className="grid divide-y divide-line-soft lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
        <div className="grid grid-cols-2 gap-5 p-5 sm:p-6 lg:grid-cols-1 lg:gap-6">
          <Figure label="Bot traffic" value={`${radar.bot_share.value.toFixed(1)}%`} note={<>of all HTTP requests · {weekNote}</>} />
          <Figure
            label="AI crawlers"
            accent
            value={radar.derived_ai_share_of_requests !== null ? `≈${radar.derived_ai_share_of_requests.toFixed(1)}%` : "—"}
            note={radar.ai_crawler_share_of_bots !== null ? <>of all requests, derived: {radar.ai_crawler_share_of_bots.toFixed(1)}% of bot traffic</> : "of all requests, derived from the bot share"}
          />
        </div>

        <div className="p-5 sm:p-6">
          <ColumnHead title="Top AI crawlers" unit="share of AI-bot traffic" />
          <ul className="space-y-2.5">
            {radar.top_ai_bots.slice(0, 5).map((b) => (
              <li key={b.name} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_3.25rem] items-center gap-3 text-[13px]">
                <span className="truncate text-soft">{b.name}</span>
                <span className="relative h-2">
                  <span className="absolute inset-y-0 left-0 rounded-[2px] bg-accent opacity-85" style={{ width: `${(b.share / maxShare) * 100}%` }} />
                </span>
                <span className="num text-right text-[12.5px] text-ink">{b.share.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>

        {radar.crawl_purpose.length > 0 && (
          <div className="p-5 sm:p-6">
            <ColumnHead title="Why they crawl" unit="declared purpose" />
            <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-[3px]">
              {radar.crawl_purpose.map((p, i) => (
                <div key={p.name} style={{ flexGrow: p.share, flexBasis: 0, background: PURPOSE_COLORS[i % PURPOSE_COLORS.length] }} title={`${p.name} ${p.share.toFixed(1)}%`} />
              ))}
            </div>
            <ul className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
              {radar.crawl_purpose.map((p, i) => (
                <li key={p.name} className="flex items-center gap-2">
                  <span className="inline-block size-2.5 shrink-0 rounded-[2px]" style={{ background: PURPOSE_COLORS[i % PURPOSE_COLORS.length] }} />
                  <span className="truncate text-soft">{p.name}</span>
                  <span className="num ml-auto text-dim">{p.share.toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="border-t border-line-soft px-5 py-3 text-[12px] leading-relaxed text-faint sm:px-6">
        Source: <a className="link" href={radar.attribution.url}>{radar.attribution.source}</a>, {days} to {stamp} ({radar.attribution.license}){sample && <span className="text-accent"> · sample values</span>}. Context only: not incidents, never added to the counts.
      </p>
    </section>
  );
}
