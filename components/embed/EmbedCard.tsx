"use client";

import { useEffect, useState } from "react";
import { RadarGlyph } from "@/components/layout/Wordmark";
import { formatInt, formatPct, monthLabel, timestampLabel } from "@/lib/format";
import { SITE } from "@/lib/site";
import type { Summary, SummaryMonth, SummaryWindow } from "@/lib/summary";

/**
 * The embeddable card (/embed). It renders at build time from the same
 * summary that becomes public/data/summary.json, and draws both windows; the
 * page's options (theme, window, compact) are data attributes on the wrapper,
 * so CSS picks what shows and nothing has to re-render (app/embed/embed.css).
 *
 * A host page can keep an embed cached long after the next deploy, so after
 * mount the card asks for /data/summary.json (an hour's cache at most) and
 * swaps in the newer numbers together with their updated time. The time and
 * the numbers always come from the same file: a fresh time over stale counts
 * would misstate what the card shows. Without JS, or when the fetch fails,
 * the build-time card stands.
 */

const WINDOWS = [
  { key: "12m", months: 12, pick: (s: Summary) => s.trailing_12 },
  { key: "24m", months: 24, pick: (s: Summary) => s.trailing_24 },
] as const;

function isWindow(w: unknown): w is SummaryWindow {
  const x = w as SummaryWindow | null;
  return (
    !!x &&
    typeof x.from === "string" &&
    typeof x.to === "string" &&
    typeof x.incidents === "number" &&
    typeof x.real_world === "number" &&
    typeof x.prior === "number" &&
    (x.delta_pct === null || typeof x.delta_pct === "number")
  );
}

/** A light shape check: the file is ours, but a half-deployed or edited copy must not break the card. */
export function isSummary(v: unknown): v is Summary {
  const s = v as Summary | null;
  return (
    !!s &&
    s.version === 1 &&
    typeof s.generated_at === "string" &&
    (s.last_collector_run === null || typeof s.last_collector_run === "string") &&
    isWindow(s.trailing_12) &&
    isWindow(s.trailing_24) &&
    Array.isArray(s.monthly) &&
    s.monthly.length >= 24 &&
    s.monthly.every((m) => typeof m?.month === "string" && typeof m.incidents === "number" && typeof m.provisional === "boolean")
  );
}

/** Same reading as the dashboard's stat tiles: rises warm, falls cool, flat dim. */
function tone(pct: number | null): string {
  if (pct === null || pct > 0.5) return "text-sev-3";
  if (pct < -0.5) return "text-type-by";
  return "text-dim";
}

function Spark({ months }: { months: SummaryMonth[] }) {
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return null;
  const max = Math.max(1, ...months.map((m) => m.incidents));
  const hasProvisional = months.some((m) => m.provisional);
  return (
    <figure className="embed-spark">
      <div
        className="embed-bars"
        role="img"
        aria-label={`Incidents per month, ${monthLabel(first.month, true)} to ${monthLabel(last.month, true)}: ${months.map((m) => m.incidents).join(", ")}`}
      >
        {months.map((m) => (
          <div
            key={m.month}
            className="embed-col"
            data-prov={m.provisional ? "1" : undefined}
            title={`${monthLabel(m.month, true)}: ${formatInt(m.incidents)} incident${m.incidents === 1 ? "" : "s"}${m.provisional ? " (provisional)" : ""}`}
          >
            <div className="embed-bar" style={{ height: m.incidents ? `${Math.max(5, (m.incidents / max) * 100)}%` : 0 }} />
          </div>
        ))}
      </div>
      <figcaption className="embed-axis num">
        <span>{monthLabel(first.month)}</span>
        {hasProvisional && <span className="embed-prov-key">shaded: provisional</span>}
        <span>{monthLabel(last.month)}</span>
      </figcaption>
    </figure>
  );
}

export function EmbedCard({ initial }: { initial: Summary }) {
  const [summary, setSummary] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/summary.json")
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((next) => {
        if (!cancelled && isSummary(next) && next.generated_at > initial.generated_at) setSummary(next);
      })
      .catch(() => {
        // offline, blocked or not deployed yet: the build-time card stands
      });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const updated = summary.last_collector_run;
  return (
    <article className="embed-card" aria-label={`${SITE.name}: AI cybersecurity incidents`}>
      <header className="flex items-center justify-between gap-3">
        <a href="/" target="_blank" rel="noopener" className="embed-brand">
          <RadarGlyph size={15} className="text-accent shrink-0" />
          <span>{SITE.name}</span>
        </a>
        <span className="num text-[10.5px] text-dim whitespace-nowrap">
          {updated ? (
            <>
              updated <time dateTime={updated}>{timestampLabel(updated)}</time>
            </>
          ) : (
            "collector not yet run"
          )}
        </span>
      </header>

      {WINDOWS.map((w) => {
        const win = w.pick(summary);
        return (
          <section key={w.key} data-w={w.key} className="embed-body">
            <div className="embed-figures">
              <div className="embed-label">AI cybersecurity incidents, last {w.months} months</div>
              <div className="embed-headline">
                <span className="embed-value num">{formatInt(win.incidents)}</span>
                <span className={`num text-[13px] ${tone(win.delta_pct)}`}>{formatPct(win.delta_pct)}</span>
              </div>
              <div className="embed-prior">
                vs <span className="num">{formatInt(win.prior)}</span> in the {w.months} months before
              </div>
              <div className="embed-real">
                <span className="num text-ink">{formatInt(win.real_world)}</span> real-world <span className="text-dim">(severity 3–4)</span>
              </div>
            </div>
            <Spark months={summary.monthly.slice(-w.months)} />
          </section>
        );
      })}

      <footer className="embed-foot">
        <span>
          Unexploited CVEs not counted ·{" "}
          <a href="/methodology#counting" target="_blank" rel="noopener" className="embed-link">
            how we count
          </a>
        </span>
        <a href="/api#attribution" target="_blank" rel="noopener" className="embed-link">
          {SITE.dataLicense.name}
        </a>
      </footer>
    </article>
  );
}
