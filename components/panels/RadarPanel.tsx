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

/**
 * Cloudflare Radar sidebar: share of HTTP traffic from bots, top AI crawlers,
 * crawl purpose. Renders nothing when there is no data, so a missing token or
 * a changed API never breaks the page.
 */
export function RadarPanel({ radar, sample = false, variant = "panel", className = "" }: Props) {
  if (!radar) return null;
  const delta =
    radar.bot_share.previous !== null && radar.bot_share.previous !== 0
      ? ((radar.bot_share.value - radar.bot_share.previous) / radar.bot_share.previous) * 100
      : null;
  const stamp = radar.fetched_at.slice(0, 10);

  if (variant === "strip") {
    return (
      <div className={`flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px] ${className}`}>
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

  const maxShare = Math.max(...radar.top_ai_bots.map((b) => b.share), 1);
  return (
    <section className={`${variant === "panel" ? "panel p-4" : ""} space-y-4 ${className}`} aria-label="AI traffic signal">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium">AI traffic signal</h2>
          <p className="label mt-1 normal-case tracking-normal text-[11px]">
            Cloudflare Radar · last {radar.range}
            {sample && <span className="text-accent"> · sample values</span>}
          </p>
        </div>
        <span className="num text-[11px] text-faint">{stamp}</span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="label">bot share of requests</div>
          <div className="num text-2xl leading-none mt-1">{radar.bot_share.value.toFixed(1)}%</div>
          <div className="num text-[11px] text-dim mt-1">{formatPct(delta, 1)} vs prior week</div>
        </div>
        <div>
          <div className="label">AI crawlers ≈ of requests</div>
          <div className="num text-2xl leading-none mt-1">
            {radar.derived_ai_share_of_requests !== null ? `${radar.derived_ai_share_of_requests.toFixed(1)}%` : "—"}
          </div>
          <div className="text-[11px] text-faint mt-1">derived: bot share × AI-crawler share</div>
        </div>
      </div>

      <div>
        <div className="label mb-2">top AI crawlers · share of AI-bot traffic</div>
        <ul className="space-y-1.5">
          {radar.top_ai_bots.slice(0, 5).map((b) => (
            <li key={b.name} className="grid grid-cols-[1fr_auto] gap-2 items-center text-[11px]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate text-soft">{b.name}</span>
                <span className="h-1 rounded-sm" style={{ width: `${(b.share / maxShare) * 100}%`, maxWidth: "60%", background: UI.accent, opacity: 0.8 }} />
              </div>
              <span className="num text-dim">{b.share.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>

      {radar.crawl_purpose.length > 0 && (
        <div>
          <div className="label mb-2">crawl purpose</div>
          <div className="flex h-1.5 w-full overflow-hidden rounded-sm bg-panel-2">
            {radar.crawl_purpose.map((p, i) => (
              <div key={p.name} style={{ width: `${p.share}%`, background: [UI.accent, "#7fdcff", "#a59cff", UI.faint][i % 4] }} title={`${p.name} ${p.share}%`} />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10.5px] text-dim">
            {radar.crawl_purpose.map((p, i) => (
              <span key={p.name} className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-[2px]" style={{ background: [UI.accent, "#7fdcff", "#a59cff", UI.faint][i % 4] }} />
                {p.name} <span className="num">{p.share.toFixed(0)}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10.5px] text-faint">
        Source: <a className="link" href={radar.attribution.url}>{radar.attribution.source}</a> ({radar.attribution.license}). Context only; not part of the incident dataset.
      </p>
    </section>
  );
}
