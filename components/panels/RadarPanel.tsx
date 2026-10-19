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

const PURPOSE_COLORS = [UI.accent, "#7fdcff", "#a59cff", UI.faint];

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

  const maxShare = Math.max(...radar.top_ai_bots.map((b) => b.share), 1);
  return (
    <section className={`${variant === "panel" ? "panel p-5 sm:p-6" : ""} space-y-5 ${className}`} aria-label="AI traffic signal">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-medium">AI traffic signal</h2>
          <p className="label mt-1 normal-case tracking-normal text-[12.5px]">
            Cloudflare Radar · last {radar.range}
            {sample && <span className="text-accent"> · sample values</span>}
          </p>
        </div>
        <span className="num text-[12px] text-faint">{stamp}</span>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="label text-[12px]">bot share of requests</div>
          <div className="num mt-1.5 text-[34px] leading-none sm:text-[38px]">{radar.bot_share.value.toFixed(1)}%</div>
          <div className="num mt-1.5 text-[12.5px] text-dim">{formatPct(delta, 1)} vs prior week</div>
        </div>
        <div>
          <div className="label text-[12px]">AI crawlers ≈ of requests</div>
          <div className="num mt-1.5 text-[34px] leading-none sm:text-[38px]">
            {radar.derived_ai_share_of_requests !== null ? `${radar.derived_ai_share_of_requests.toFixed(1)}%` : "—"}
          </div>
          <div className="mt-1.5 text-[12.5px] text-faint">derived: bot share × AI-crawler share</div>
        </div>
      </div>

      <div>
        <div className="label mb-2.5 text-[12px]">top AI crawlers · share of AI-bot traffic</div>
        <ul className="space-y-2">
          {radar.top_ai_bots.slice(0, 5).map((b) => (
            <li key={b.name} className="grid grid-cols-[1fr_auto] items-center gap-3 text-[13.5px]">
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-[11rem] shrink-0 truncate text-soft">{b.name}</span>
                <span className="h-1.5 rounded-sm" style={{ width: `${(b.share / maxShare) * 100}%`, maxWidth: "60%", background: UI.accent, opacity: 0.85 }} />
              </div>
              <span className="num text-dim">{b.share.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>

      {radar.crawl_purpose.length > 0 && (
        <div>
          <div className="label mb-2.5 text-[12px]">crawl purpose</div>
          <div className="flex h-2 w-full overflow-hidden rounded-sm bg-panel-2">
            {radar.crawl_purpose.map((p, i) => (
              <div key={p.name} style={{ width: `${p.share}%`, background: PURPOSE_COLORS[i % 4] }} title={`${p.name} ${p.share}%`} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-dim">
            {radar.crawl_purpose.map((p, i) => (
              <span key={p.name} className="flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-[2px]" style={{ background: PURPOSE_COLORS[i % 4] }} />
                {p.name} <span className="num">{p.share.toFixed(0)}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-[12px] leading-relaxed text-faint">
        Source: <a className="link" href={radar.attribution.url}>{radar.attribution.source}</a> ({radar.attribution.license}). Context only; not part of the incident dataset.
      </p>
    </section>
  );
}
